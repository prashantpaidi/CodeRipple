# CLI reference

Use `coderipple --help` for command syntax and `coderipple --version` for the
installed package version. In a source build, substitute
`node dist/cli/index.js` for `coderipple`.

| Command | Input | Output |
| --- | --- | --- |
| `analyze <repository-path>` | Current files on disk. Git history is optional. | Graph summary and optional graph JSON |
| `diff <repository-path> --base <ref> --head <ref>` | Two Git commits | Changed files, ranges, and mapped symbols |
| `impact <repository-path> --base <ref> --head <ref>` | Two Git commits | Impact paths, tests, heuristic risk, and uncertainty |
| `index <repository-path>` | Current files and configured Neo4j instance | Indexed graph summary and repository ID |
| `graph <query> ...` | Repository ID and one or two node IDs in Neo4j | Bounded graph query results |
| `mcp <repository-path>` | One local Git repository at startup | [MCP stdio](mcp.md) |

## Analyze

```bash
coderipple analyze ./repo --output graph.json
```

- `-o, --output <file>` writes the full graph JSON. The summary still goes to
  standard output.
- `--no-gitignore` bypasses the root `.gitignore`. Built-in directory exclusions
  still apply.

## Diff and impact

```bash
coderipple diff ./repo --base main --head HEAD --json
coderipple impact ./repo --base main --head HEAD --format markdown
```

Both commands resolve `--base` and `--head` to commit IDs. Branches, tags, and
SHA values work when present locally. Local comparisons use the two refs
directly. To compare a branch from its common ancestor with `main`, pass
`git merge-base main HEAD`'s result as the base ref. The [GitHub Action](github-actions.md)
automatically uses the PR merge base.

| Command | Option | Meaning |
| --- | --- | --- |
| `diff` | `--json` | Emit the complete changed-symbol report as JSON. |
| `impact` | `--format text\|markdown\|json` | Default `text`. JSON uses the canonical `ImpactReport` with `schemaVersion: "1"`. |
| `impact` | `--depth <n>` | Maximum call hops, default 3. Zero reports changed symbols, structural context, and uncertainty while omitting caller and importer impact. |
| `impact` | `--limit <n>` | Positive number of items per human-readable section, default 50. JSON includes all items. |
| `impact` | `--no-gitignore` | Bypass the analyzed root's `.gitignore` in both snapshots. |
| `impact` | `--explain` | Request an [opt-in OpenAI explanation](graphrag.md#opt-in-openai-explanations). JSON uses `{ report, explanation }`. |
| `impact` | `--explain-exclude <glob>` | Repeatable path exclusion for evidence shared with OpenAI. |

Call paths are written in edge direction, from caller to callee. Changed symbols
use their head revision for additions and modifications, and their base
revision for deletions. Risk levels are heuristic. A completed report exits
with status 0 regardless of risk, uncertainty, empty changes, or an unavailable
optional explanation. Usage and command failures exit with status 1. Error
diagnostics are sent to standard error.

`HIGH` risk indicates a deletion, a potential API entry point, or at least 10
affected files or detected dependents. Otherwise, `MEDIUM` flags detected
dependents, importing modules, unresolved calls, analysis limitations, or a
change without a suggested test. `LOW` means none of those indicators fired.

## Neo4j commands

```bash
coderipple index ./repo --repository-id my-repo
coderipple graph callers my-repo 'src/order.mjs::createOrder'
coderipple graph callees my-repo 'src/order.mjs::createOrder'
coderipple graph dependencies my-repo 'src/order.mjs::createOrder' --depth 2
coderipple graph dependents my-repo 'src/pricing.mjs::shippingFee' --depth 2
coderipple graph paths my-repo 'src/checkout.mjs::checkout' 'src/pricing.mjs::shippingFee' --depth 5 --max-paths 5
```

- `index` accepts `--repository-id <id>`, `--force`, and `--no-gitignore`.
  If you omit the ID, use the one printed by `index`. `--force` authorizes
  replacement when an explicit ID is already stored for a different path.
- `callers` and `callees` are direct, one-hop queries. `dependencies` follows
  outgoing edges and `dependents` follows incoming edges. Both default to
  depth 1. `paths` defaults to depth 5 and returns up to 5 paths by default.
  Traversal depth ranges from 1 to 5. `--max-paths` accepts a positive safe
  integer.
- All graph queries accept `--relationships <a,b>` with values from
  `CALLS`, `IMPORTS`, and `CONTAINS`. The default is `CALLS`.

See [Neo4j setup and troubleshooting](neo4j.md).
