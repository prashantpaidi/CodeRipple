import { formatImpactReport } from '../cli/impact.js';
import { resolveMergeBase } from '../git/merge-base.js';
import { analyzeImpact } from '../impact/impact-analysis.js';
import { MAX_REPORT_BYTES, type PullRequestRevisions } from './pr-comment.js';

/** Render PR-controlled paths and expressions as bounded, inert Markdown text. */
function markdownLiteral(item: string): string {
  const characters = Array.from(item.slice(0, 562));
  const preview = characters.slice(0, 280).join('') + (characters.length > 280 ? '…' : '');
  const text = preview.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`);
  const fence = '`'.repeat(1 + Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)));
  return `${fence} ${text} ${fence}`;
}

export async function buildPullRequestReport(repository: string, revisions: PullRequestRevisions): Promise<string> {
  const { baseTipSha, baseSha, headSha } = await resolveMergeBase(repository, revisions.baseTipSha, revisions.headSha);
  // Compare committed files irrespective of ignore rules in either snapshot.
  const report = await analyzeImpact(repository, { base: baseSha, head: headSha, depth: 3, graphOptions: { respectGitignore: false } });
  const scope = '\nCodeRipple analyzes committed TypeScript and JavaScript with static evidence. Dynamic relationships can be missed. Suggested tests were inferred and remain unrun.\n';
  for (const limit of [20, 10, 5, 1]) {
    const markdown = formatImpactReport(report, 'markdown', limit, markdownLiteral)
      .replace('\n\n', `\n\nPR base tip: ${baseTipSha}\n`) + scope;
    if (Buffer.byteLength(markdown, 'utf8') <= MAX_REPORT_BYTES) return markdown;
  }
  throw new Error('The Markdown impact report exceeds 48 KiB.');
}

if (import.meta.main) {
  const [repository, baseTipSha, headSha] = process.argv.slice(2);
  if (!repository || !baseTipSha || !headSha) {
    console.error('Usage: pr-report <repository> <base-tip-sha> <head-sha>');
    process.exitCode = 1;
  } else {
    buildPullRequestReport(repository, { baseTipSha, headSha }).then((markdown) => {
      process.stdout.write(markdown);
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'CodeRipple pull request analysis failed.');
      process.exitCode = 1;
    });
  }
}
