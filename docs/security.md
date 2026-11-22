# Security and privacy

## Local analysis and MCP

By default, CodeRipple reads local source or committed Git snapshots and
produces results on the local machine through static analysis. Git and tar
are invoked to materialize the two revisions in
temporary directories. CodeRipple removes these directories when the
operation finishes normally or reports an error.

Run local analysis on repositories and Git configuration you trust. Local
CLI and MCP processes run with the user's filesystem permissions. Use an
isolated, network-disabled environment without credentials for untrusted
input, as the GitHub workflow does.

Reports can contain repository names, absolute paths, commit IDs, symbols,
and raw source expressions from unresolved calls. Treat files, logs, and
MCP client transcripts containing this evidence as repository data. MCP
limits each server process to one repository selected at launch. The client
receives the canonical report and controls its own storage or sharing.

## Neo4j

`index` sends repository metadata and the graph's paths, names, line ranges,
and relationships to the configured database. Use an authorized instance
and a TLS connection for remote servers. Manage the Neo4j password through
environment variables or a local `.env` ignored by Git. Repository identity
scopes graph operations within the database. Database permissions determine
who can read and write the stored evidence.

## GitHub

The reusable workflow fetches Git objects with read-only credentials and
analyzes them as data in an offline container with read-only mounts. The
optional comment job
has separate write permission and receives bounded Markdown. The job
summary, report artifact, and optional PR comment are visible under the
repository's GitHub access and retention settings. The report can include
source expressions and symbol names. See the [workflow guide](github-actions.md).

## Retrieval and OpenAI

The built-in retrieval API without embeddings is local. If you supply an
embedding provider, it receives the question and candidate symbol names,
paths, and snippets. Protect this input according to the provider and
repository's data policies.

The built-in OpenAI adapter makes a request only when you opt in to an
explanation and supply provider configuration. It sends a bounded projection
of relationship evidence, commit IDs, opaque IDs, source ranges, and
syntax snippets with aliases for identifiers. Comments, literal values,
raw diagnostics, repository names, and absolute paths stay local. Hidden
paths and common credential or secret filenames and directories are
excluded. Repeat `--explain-exclude` to add repository-relative exclusions.
If a path in a chain is excluded, that chain is withheld from the provider.

The provider has no tools and returns IDs and review concerns for validation
against supplied evidence. The request sets `store: false`. Review your
provider's data handling terms and repository policy before sharing even
filtered evidence. Repository syntax and structural metadata can still be
sensitive.
