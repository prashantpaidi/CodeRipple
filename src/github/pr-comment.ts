import { TextDecoder } from 'node:util';

export const MAX_REPORT_BYTES = 48 * 1024;
const MAX_ENCODED_LENGTH = 4 * Math.ceil(MAX_REPORT_BYTES / 3);
const MARKER = '<!-- coderipple-pr-impact -->';
const PR_SHA = /^[a-f0-9]{40}$/;

export interface PullRequestRevisions {
  baseTipSha: string;
  headSha: string;
}

export function decodeReport(encoded: string, revisions: PullRequestRevisions): string {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_LENGTH) {
    throw new Error('The transferred report is empty or exceeds 48 KiB.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_REPORT_BYTES || bytes.toString('base64') !== encoded) {
    throw new Error('The transferred report is not valid bounded Base64.');
  }
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const [title, blank, baseTip, base, head] = markdown.split('\n', 5);
  if (title !== '# CodeRipple impact report' || blank !== '' ||
      baseTip !== `PR base tip: ${revisions.baseTipSha}` ||
      !base?.startsWith('Base: ') || !PR_SHA.test(base.slice(6)) ||
      head !== `Head: ${revisions.headSha}`) {
    throw new Error('The transferred report does not match the pull request revisions.');
  }
  return markdown;
}

interface IssueComment {
  id: number;
  user: { login: string; type: string } | null;
  body?: string;
}

interface Publication extends PullRequestRevisions {
  apiUrl: string;
  repository: string;
  pullNumber: number;
  token: string;
  markdown: string;
}

/** Recheck the event revisions and upsert the first Actions bot comment with our marker. */
export async function publishComment(publication: Publication, fetcher: typeof fetch = fetch) {
  const { apiUrl, repository, pullNumber, token, markdown, baseTipSha, headSha } = publication;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(pullNumber) || pullNumber < 1 ||
      !PR_SHA.test(baseTipSha) || !PR_SHA.test(headSha) || !token) {
    throw new Error('Missing or invalid GitHub pull request context.');
  }

  async function request<T>(route: string, method = 'GET', body?: string): Promise<T> {
    const response = await fetcher(`${apiUrl}/repos/${repository}/${route}`, {
      method, body, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${method} failed with HTTP ${response.status}.`);
    return response.json() as Promise<T>;
  }

  const commentsRoute = `issues/${pullNumber}/comments`;
  let existing: IssueComment | undefined;
  for (let page = 1; ; page++) {
    const comments = await request<IssueComment[]>(`${commentsRoute}?per_page=100&page=${page}`);
    existing = comments.find((comment) => comment.user?.login === 'github-actions[bot]' &&
      comment.user.type === 'Bot' && comment.body?.startsWith(`${MARKER}\n`));
    if (existing || comments.length < 100) break;
  }

  const current = await request<{ state: string; base: { sha: string }; head: { sha: string } }>(`pulls/${pullNumber}`);
  if (current.state !== 'open' || current.base.sha !== baseTipSha || current.head.sha !== headSha) return 'stale';

  const body = `${MARKER}\n${markdown}`;
  if (existing?.body === body) return 'unchanged';
  const payload = JSON.stringify({ body });
  if (existing) {
    await request(`issues/comments/${existing.id}`, 'PATCH', payload);
    return 'updated';
  }
  await request(commentsRoute, 'POST', payload);
  return 'created';
}

async function main(env: NodeJS.ProcessEnv): Promise<void> {
  const revisions = { baseTipSha: env.PR_BASE_SHA ?? '', headSha: env.PR_HEAD_SHA ?? '' };
  const unavailable = [
    '# CodeRipple impact report unavailable', '',
    `Head: ${revisions.headSha}`, '',
    `This run could not publish an impact report. See the [workflow run](${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}).`, '',
  ].join('\n');
  let markdown = unavailable;
  let transferError: unknown;
  if (env.ANALYSIS_RESULT === 'success') {
    try {
      markdown = decodeReport(env.ENCODED_REPORT ?? '', revisions);
    } catch (error) {
      transferError = error;
    }
  }
  const outcome = await publishComment({
    ...revisions, markdown, apiUrl: env.GITHUB_API_URL ?? '', repository: env.GITHUB_REPOSITORY ?? '',
    pullNumber: Number(env.PR_NUMBER), token: env.GH_TOKEN ?? '',
  });
  console.log(`CodeRipple comment: ${outcome}.`);
  if (transferError) throw transferError;
}

if (import.meta.main) {
  main(process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'CodeRipple comment publication failed.');
    process.exitCode = 1;
  });
}
