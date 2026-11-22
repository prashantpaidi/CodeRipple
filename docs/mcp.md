# MCP tool reference

CodeRipple runs as a local Model Context Protocol server over stdio. Use the
following server launch command in your MCP client's configuration. Supply an
absolute CLI path if the client has its own `PATH`.

```bash
coderipple mcp /absolute/path/to/repository
```

For a source build or a local installation, configure the command as `node`
with the following argument list.

```json
[
  "/absolute/path/to/CodeRipple/dist/cli/index.js",
  "mcp",
  "/absolute/path/to/repository"
]
```

For a package install the script path is
`/absolute/path/to/consumer/node_modules/coderipple/dist/cli/index.js`.
Use a Git repository with both refs already available locally. The server
advertises MCP protocol version `2025-11-25`. Standard output carries only
newline-delimited JSON-RPC during a server session. Startup diagnostics go to
standard error.

## `analyze_impact`

This read-only tool analyzes two committed revisions within the Git
repository selected when the server starts. It needs Git and tar.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `base` | String | Yes | Base branch, tag, or commit ID available locally |
| `head` | String | Yes | Head branch, tag, or commit ID available locally |
| `depth` | Integer | No | Maximum call hops from 0 through 10, default 3 |

The checkout demo uses these arguments. [Checkout demo](../examples/checkout-demo/README.md)

```json
{ "base": "demo-base", "head": "demo-head", "depth": 3 }
```

The result's `content[0].text` contains the canonical `ImpactReport` as JSON
text, with the same fields as `coderipple impact --format json`. Invalid
arguments, missing revisions, and analysis failures return a tool error.
Individual requests are limited to 64 KiB and serialized reports to 4 MiB. If
a report exceeds the limit, compare a smaller revision range or reduce depth.

The server uses in-memory analysis without Neo4j, external embeddings, or
LLM calls. The MCP client receives repository metadata and analysis evidence.
See [security and privacy](security.md).
