# GitHub Actions

Save this caller as `.github/workflows/coderipple-impact.yml` in the target
repository's default branch. Replace `CODERIPPLE_COMMIT_SHA` with the full
commit SHA for the trusted CodeRipple version containing the reusable workflow.

```yaml
name: CodeRipple PR impact
on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited, ready_for_review]
permissions: {}
jobs:
  impact:
    uses: prashantpaidi/CodeRipple/.github/workflows/reusable-pr-impact.yml@CODERIPPLE_COMMIT_SHA
    permissions:
      contents: read
      pull-requests: write
    with:
      comment: false
```

Open or update a pull request and look for the Markdown summary and
`coderipple-impact-*` artifact in the workflow run. To also maintain one
bot comment per PR, set `comment: true`. The caller's permissions are the
ceiling for the reusable jobs. The analysis job uses only `contents: read`,
and only the optional comment job requests `pull-requests: write`. The
CodeRipple repository's own caller uses the Actions
variable `CODERIPPLE_PR_COMMENT` for this toggle.

The report compares the PR merge base to the PR head, so updates unique to
the base branch are outside that comparison. It labels the event base, merge
base, and head SHAs. The report includes changed symbols, dependents, impact
paths, suggested tests, heuristic risk, and uncertainty. The workflow uses a
call depth of three and truncates large Markdown reports to fit 48 KiB.

The workflow uses `pull_request_target` so its configuration comes from a
trusted revision. The analysis job checks out the pinned analyzer and fetches
the target Git history without checking out the PR. It analyzes source from
Git objects in a network-disabled container. Preserve this arrangement when
enabling the optional write permission. The isolated publisher receives the
Markdown report and checks that the open PR still points to the analyzed
revisions before updating a comment. See [security and privacy](security.md).
