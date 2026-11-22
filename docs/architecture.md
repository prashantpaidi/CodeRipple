# Architecture

```text
Working tree or Git revision snapshots
  -> static analyzer
  -> CodeGraph
  -> changed-symbol detection using the Git diff
  -> in-memory impact engine
  -> ImpactReport
  -> CLI, MCP, and GitHub adapters
```

The analyzer produces a `CodeGraph` from files and compiler options. Its
dependencies are independent of Neo4j, GitHub, MCP, and LLMs. The impact engine
works on in-memory graphs. Neo4j is a separate branch for persistence and
queries, and explanations run after an impact report is complete.
See the [architecture decisions](adr/README.md).

## Analyzer and graph

`src/config`, `src/parser`, and `src/graph` handle discovery, parsing, and graph
construction. They discover eligible files, load options from the root
`tsconfig.json` when available, and parse them in one ts-morph project. Once
declarations are known, the analyzer resolves imports and calls, sorts the
nodes, edges, and unresolved references, and validates the graph.

| Node | Meaning | Example ID |
| --- | --- | --- |
| `FILE` | Source file | `src/order.ts` |
| `FUNCTION` | Top-level function or function-valued variable | `src/order.ts::createOrder` |
| `CLASS` | Top-level class | `src/order.ts::OrderService` |
| `METHOD` | Method, constructor, accessor, or function field | `src/order.ts::OrderService.create` |

IDs are derived from repository-relative paths and qualified symbol names. A
move or rename can change a symbol's ID. Instance and static members, getters,
and setters have distinct IDs. Overloaded declarations share a logical node
whose line range spans the signatures and implementation.

The graph uses `CONTAINS` for declaration ownership, `IMPORTS` between files,
and `CALLS` from files or callable symbols to in-repository functions or
methods. Module-level calls belong to the source file. Calls inside callbacks
and nested arrows belong to their nearest modeled enclosing declaration or
file. Relative imports, configured aliases, and calls with a statically
resolved receiver can yield edges. Unresolved calls carry a reason such as
`DYNAMIC_PROPERTY_ACCESS`, `AMBIGUOUS_SYMBOL`, `EXTERNAL_DEPENDENCY`, or
`TARGET_NOT_RESOLVED`.

Graphs use version 1 by default. Version 2 adds route metadata for supported
NestJS controller and handler declarations. It records decorator paths
separately from each other. The metadata describes the declaration itself.
See the [framework limits](limitations.md#frameworks-and-tests).

## Git and impact

`src/git` resolves both refs to immutable commit IDs and materializes the
snapshots in temporary directories using Git archives. `src/impact` maps diff
hunks to symbol line ranges. Additions and modifications use the head graph.
Deletions use the base graph. Missing mappings for some changes can produce
limitations.

For each changed symbol the engine follows incoming `CALLS` edges up to the
configured depth and records a deterministic shortest path to each caller.
`CONTAINS` adds structural context and `IMPORTS` supplies potential
module-level impact. Unresolved references remain separate from edge evidence.
The engine applies heuristic risk rules and uses call and import evidence to
recommend tests.

`ImpactReport` schema version 1 includes both commit IDs, changed symbols,
affected symbols and files, revision-labeled paths, test recommendations,
unresolved references, limitations, and risk indicators. For identical refs,
options, repository metadata, and analyzer versions, local results are
deterministic. In JSON, repository identity and root path can vary across
checkouts.

## Integration boundaries

- `src/cli` formats and dispatches analysis, diff, persistence, and queries.
  `src/mcp` exposes the same canonical impact report through a local tool.
- `src/github` selects a PR merge base and formats a bounded report for the
  workflow summary, artifact, and optional comment.
- `src/storage` defines a `GraphStore` contract and stable repository identity.
  Its Neo4j adapter maps graph types to Neo4j records internally.
- `src/retrieval` gathers bounded evidence from commit objects.
  `src/explanation` enriches a completed report through a provider interface.

The package exports `analyzeRepository` for working tree analysis,
`analyzeImpact` for Git revisions, and `analyzeImpactGraphs` for callers
with existing graphs and changed symbols. `codeGraphSchema` and
`impactReportSchema` validate their respective data contracts.
