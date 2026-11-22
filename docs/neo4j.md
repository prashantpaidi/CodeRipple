# Neo4j setup and troubleshooting

Use Neo4j 5 for `index` and `graph` commands. For a disposable local database,
start a container bound to loopback.

```bash
docker run --rm --name coderipple-neo4j \
  -p 127.0.0.1:7687:7687 \
  -e NEO4J_AUTH=neo4j/coderipple-local-demo \
  neo4j:5-community
```

In another shell, set the connection values. The example password is for the
disposable local container.

```bash
export NEO4J_URI=bolt://127.0.0.1:7687
export NEO4J_USERNAME=neo4j
export NEO4J_PASSWORD=coderipple-local-demo
export NEO4J_DATABASE=neo4j
```

| Variable | Default |
| --- | --- |
| `NEO4J_URI` | Required. Use the server's `bolt://` or `neo4j://` URI and appropriate TLS scheme. |
| `NEO4J_PASSWORD` | Required |
| `NEO4J_USERNAME` | `neo4j` |
| `NEO4J_DATABASE` | `neo4j` |

The CLI reads `.env` from its current directory for `index` and `graph`.
Exported values take precedence. Put one `KEY=VALUE` per line and keep the file
out of version control. The checkout includes an `.env.example` template.

## Index and query

Set up the checkout demo, then index it and query the stored graph.
[Install guide](install.md#run-an-installed-release-candidate)

```bash
coderipple index ./checkout-demo --repository-id checkout-demo
coderipple graph callers checkout-demo 'src/pricing.mjs::shippingFee'
coderipple graph paths checkout-demo 'src/checkout.mjs::checkout' 'src/pricing.mjs::shippingFee'
```

The caller query finds `createOrder`. The path query finds a two-hop call
chain via `createOrder`. Query IDs are the repository-relative IDs used in the
impact report. For flags and defaults see the [CLI reference](cli.md#neo4j-commands).

If you omit `--repository-id`, the CLI derives one from the normalized
`origin` URL and the project's path within the Git working tree, or from
the canonical absolute path when an origin is unavailable. Code entities are
namespaced by repository ID. Each index run replaces that repository's graph
in one transaction. A failed write rolls back and preserves the previous
graph. A different path using an existing explicit ID requires `--force`.

The schema has a unique `Repository.id`, a unique `CodeEntity.ref` of the
form `repositoryId::nodeId`, and an index on `CodeEntity.repositoryId`.
`BELONGS_TO` records repository membership. Graph edge types are stored as
Neo4j relationships. The store initializes its constraints and index idempotently
when it opens, including when opened by a query.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Missing configuration | Set `NEO4J_URI` and `NEO4J_PASSWORD` in the shell or the current directory's `.env`. |
| Malformed environment file | Correct the reported line numbers to use `KEY=VALUE`. |
| Connection refused or unavailable | Wait for the server to start and check Docker logs, the published Bolt port, and the URI scheme. |
| Authentication failure | Verify the username and password against the running database. Use the matching TLS URI for a hosted service. |
| Schema or write failure | Check the database name and permissions for schema initialization and the operation. |
| Existing repository ID at another path | Use a different ID, or use `--force` if you intend to replace that graph. |
| Empty graph query | Verify the database, repository ID, node ID, relationship type, and traversal depth. Re-index to reflect source changes. |

Run `pnpm test:integration` from a checkout to exercise the Neo4j adapter with
Testcontainers. Local impact analysis uses a separate in-memory path.
