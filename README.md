# CodeRipple

CodeRipple traces the impact of committed JavaScript and TypeScript changes. Give
it two Git revisions to see which symbols changed, which callers and files may
be affected, which tests to run, and where static analysis could not determine
the target of a call.

The local CLI and MCP server run without Neo4j, API keys, or an AI provider.
Neo4j is available for storing and querying graphs. GitHub Actions can produce
an impact report for a pull request.

## Try the release candidate

Run the following commands from a CodeRipple checkout. You'll need Node.js,
Git, tar, Bash, and pnpm 12.14.0. [Install guide](docs/install.md)

```bash
pnpm install --frozen-lockfile
pnpm build
demo_dir="$(mktemp -d)/checkout"
bash examples/checkout-demo/setup.sh "$demo_dir"
node dist/cli/index.js impact "$demo_dir" --base demo-base --head demo-head
```

The demo changes the free-shipping threshold in a small checkout application.
The report identifies `shippingFee`, follows its callers, recommends a test,
and shows why a runtime dispatch call remains unresolved. The
[demo walkthrough](examples/checkout-demo/README.md) explains how to read the
report and run the suggested test. The [install guide](docs/install.md) also
covers installing the release candidate tarball and running the demo from it.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Install and build](docs/install.md) | Requirements, local tarball install, and reproducible packaging |
| [CLI reference](docs/cli.md) | Commands, options, output formats, and exit codes |
| [MCP tool reference](docs/mcp.md) | Local stdio setup and the `analyze_impact` tool |
| [Architecture](docs/architecture.md) | Graph model, revision analysis, and adapters |
| [Neo4j](docs/neo4j.md) | Setup, indexing, graph queries, and troubleshooting |
| [GitHub Actions](docs/github-actions.md) | A reusable workflow and pull request reports |
| [GraphRAG and LLM configuration](docs/graphrag.md) | Local evidence retrieval, embeddings, and opt-in OpenAI explanations |
| [Security and privacy](docs/security.md) | What stays local, what can be shared, and trust boundaries |
| [Known limitations](docs/limitations.md) | Static analysis coverage and how to interpret uncertainty |
| [Architecture decisions](docs/adr/README.md) | Decisions that shape the analysis and release |

## Development

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm test:integration
```

The default checks run without Docker or credentials. The Neo4j integration
suite uses Testcontainers and requires a running Docker daemon.

See the [changelog](CHANGELOG.md) and [1.0.0-rc.1 release notes](docs/releases/1.0.0-rc.1.md).
