# CodeRipple

**Trace the impact of every code change.**

CodeRipple analyzes relationships within a codebase so that developers can
understand how changes propagate through functions, services, APIs, databases,
and tests. Ask "what breaks if I change this?" and CodeRipple wants to answer
with a graph, not a guess.

> **Current state — static analysis + graph storage.** CodeRipple performs
> deterministic static analysis of JavaScript/TypeScript repositories, emits a
> code graph, persists it in **Neo4j**, and answers deterministic dependency
> queries over it. It does **not** yet include Git-diff analysis, blast-radius
> scoring, GraphRAG, LLMs, or GitHub integration — those are deliberately
> deferred (see [Roadmap](#roadmap)).

## Purpose

Large codebases make change impact hard to reason about. CodeRipple's end goal
is to answer questions such as:

- What could break if I modify `AuthService`?
- Which API endpoints depend on `UserRepository`?
- Which modules are affected by this change?
- Which tests should I run after modifying this function?
- What is the dependency path between two components?

## Architecture

```
Repository
   ↓
Static Analyzer      (ts-morph, deterministic, storage-independent)
   ↓
CodeGraph            (validated, deterministic JSON model)
   ↓
GraphStore           (storage/query boundary)
   ↓
Neo4jGraphStore      (official Neo4j driver)
   ↓
Deterministic Graph Queries
```

The **analyzer has no knowledge of Neo4j**: it produces a `CodeGraph` and can be
used entirely on its own. Persistence and queries sit behind the `GraphStore`
interface, and the Neo4j implementation maps the graph to/from Neo4j internally
so no driver objects ever leak into application code.

## Repository

```
src/
  index.ts                # public library entry point (barrel)
  cli/
    index.ts              # argument parsing + command dispatch
    analyze.ts            # analysis entry point + summary formatting
    index-repository.ts   # `index` command (analyze + persist)
    graph-commands.ts     # `graph` queries + formatting
  config/
    repository-config.ts  # validates the repo path, finds tsconfig.json
  parser/
    repository-parser.ts  # file discovery (.gitignore aware)
    file-parser.ts        # builds the ts-morph project
    symbol-extractor.ts   # FILE/CLASS/METHOD/FUNCTION nodes + CONTAINS edges
    import-resolver.ts    # IMPORTS edges (relative + alias resolution)
    call-resolver.ts      # CALLS edges + unresolved references
  graph/
    graph-types.ts        # TypeScript graph model
    graph-schema.ts       # Zod schemas + structural validation
    graph-builder.ts      # orchestration, sorting, metadata
    ids.ts                # deterministic ID builders
  storage/
    graph-store.ts        # GraphStore interface + query/result types
    repository-identity.ts# deterministic repository identity
    errors.ts             # ConfigurationError / ConnectionError / ...
    neo4j/
      neo4j-config.ts     # environment configuration (validated)
      neo4j-client.ts     # driver creation + connectivity check
      neo4j-schema.ts     # idempotent constraints/indexes
      neo4j-mapper.ts     # CodeRipple types <-> Neo4j property maps
      neo4j-persistence-plan.ts  # batched write plan (no N+1)
      neo4j-graph-store.ts# GraphStore implementation
  utils/
    paths.ts              # path + string helpers
```

### Analysis phases

The graph is built in ordered phases so cross-file resolution sees every
declaration:

1. **Discover** files (respecting ignored directories and `.gitignore`).
2. **Parse** them into a single ts-morph project, loading `tsconfig.json`
   compiler options when present.
3. **Extract** symbols and `CONTAINS` edges for every file.
4. **Resolve imports** into `IMPORTS` edges.
5. **Resolve calls** against the global declaration table into `CALLS` edges and
   unresolved references.
6. **Sort** nodes and edges, compute metadata, and **validate** the graph before
   returning/writing it.

### Design principles

- **Correctness over graph size.** A missing edge can be added later; a false
  edge would corrupt future impact analysis. When unsure, CodeRipple records an
  unresolved reference.
- **Deterministic by construction.** IDs derive only from repository-relative
  paths and symbol names, and all collections are sorted. No timestamps, no
  UUIDs, no randomness — the same repository always yields the same JSON.
- **Storage is a boundary, not the domain model.** Neo4j adapts to the
  CodeRipple graph model; the graph model is not reshaped for Neo4j.

## Code graph model

**Nodes**

| Type       | Description                                                      | Example ID                                  |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `FILE`     | A source file                                                     | `src/services/user.ts`                      |
| `CLASS`    | A top-level class                                                 | `src/services/user.ts::UserRepository`      |
| `METHOD`   | A class member: method, constructor, accessor, or function field  | `src/services/user.ts::UserRepository.save` |
| `FUNCTION` | A top-level function or function-valued variable                  | `src/utils/token.ts::generateToken`         |

Member IDs are qualified so declarations that share a name stay distinct:
`UserRepository.save` (instance method), `Factory.static:build` (static method),
and accessors — `Temperature.get:value` / `Temperature.set:value` (instance)
and `Temperature.static:get:value` / `Temperature.static:set:value` (static).

**Edges**

| Type       | Shape                                                  |
| ---------- | ------------------------------------------------------ |
| `CONTAINS` | `FILE -> CLASS`, `FILE -> FUNCTION`, `CLASS -> METHOD` |
| `IMPORTS`  | `FILE -> FILE`                                         |
| `CALLS`    | `FILE/FUNCTION/METHOD -> FUNCTION/METHOD`              |

`FILE` appears as a `CALLS` source for module-level executable code, so a
top-level call is never dropped silently.

**Resolution supported**

- Relative imports (`./foo`, `../lib/bar`).
- `tsconfig.json` `baseUrl` + `paths` aliases (e.g. `@/*` -> `src/*`).
- Same-file function calls.
- Imported function calls, including namespace imports (`import * as utils`).
- `this.method()` self-calls, including inherited methods.
- Cross-file / cross-class calls when the receiver type is statically known.
- Calls at module top level, attributed to the enclosing `FILE`.
- Calls inside callbacks and nested arrows, attributed to the nearest enclosing
  function or method.

**Symbol identity and overloads**

- Getter/setter pairs (instance and static), static vs. instance methods, and
  same-named symbols in different files always become distinct nodes.
- An overloaded function or method collapses into a single logical node whose
  line range spans the first signature through the implementation.

**Unresolved references**

Anything that cannot be resolved with confidence is recorded instead of guessed:

| Reason                    | Meaning                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `TARGET_NOT_RESOLVED`     | The callee exists but its target could not be determined.     |
| `DYNAMIC_PROPERTY_ACCESS` | A computed member access such as `obj[key]()`.                |
| `EXTERNAL_DEPENDENCY`     | The callee resolves to a declaration outside the repository.  |
| `AMBIGUOUS_SYMBOL`        | More than one in-repository declaration could be the target.  |

A call becomes an edge only when *every* declaration of its symbol maps to a
single in-repository node; otherwise it is recorded as unresolved.

## Neo4j model

Persistence maps the graph into Neo4j without changing the graph schema:

- `(:Repository { id, name, rootPath })` — one per repository, unique on `id`.
- Code nodes carry a shared `:CodeEntity` label plus a type label
  (`:File`, `:Class`, `:Function`, `:Method`). Properties: `ref`
  (`repositoryId::nodeId`, unique), `id`, `repositoryId`, `type`, `name`, plus
  `path` (files) or `file`/`startLine`/`endLine`/`parent` (symbols).
- Membership is explicit: `(:CodeEntity)-[:BELONGS_TO]->(:Repository)`.
- Graph edges become relationships reusing the graph's own vocabulary:
  `:CONTAINS`, `:IMPORTS`, `:CALLS` (each carrying the deterministic CodeRipple
  edge `id`).

**Repository isolation.** CodeRipple node IDs are repository-relative paths, so
`src/auth.ts::validateToken` in two repositories would otherwise collide. Every
node is namespaced by a stable repository identity (`ref = repositoryId::nodeId`)
and scoped by `repositoryId`, so multiple repositories can coexist in one
database without interfering.

**Repository identity** is deterministic — re-indexing the same repository
always resolves to the same identity:

1. an explicit `--repository-id` value, if given;
2. otherwise the normalized git `origin` remote combined with the analyzed
   directory's path within the working tree (so clones match, and two
   directories of one git repository stay distinct);
3. otherwise `sha256` of the canonical absolute path.

A **non-git** repository therefore gets a different identity if it is moved.

**Schema initialization** is idempotent (constraints use `IF NOT EXISTS`), and
uniqueness is enforced by the database:

- `Repository.id` is unique;
- `CodeEntity.ref` is unique (one entity per repository + node ID);
- `CodeEntity.repositoryId` is indexed for efficient scoped lookups.

## Neo4j setup

Requires Docker for the integration tests and a running Neo4j 5 instance for the
CLI. A container is the quickest way to try it:

```bash
docker run --rm -p 7687:7687 -e NEO4J_AUTH=neo4j/coderipple-password neo4j:5-community
```

Configuration comes from environment variables (see `.env.example`):

| Variable          | Required | Default  | Description                          |
| ----------------- | -------- | -------- | ------------------------------------ |
| `NEO4J_URI`       | yes      | —        | e.g. `bolt://localhost:7687`          |
| `NEO4J_PASSWORD`  | yes      | —        | Password for the Neo4j user           |
| `NEO4J_USERNAME`  | no       | `neo4j`  | Neo4j user                            |
| `NEO4J_DATABASE`  | no       | `neo4j`  | Target database                       |

`.env` files are loaded automatically when present, but values already exported
in the environment take precedence. **Never commit credentials** — `.env` is
gitignored; only `.env.example` with placeholders is versioned.

## CLI usage

```bash
# Analyze a repository (unchanged, no Neo4j required)
pnpm coderipple analyze <repository-path> [--output <file>] [--no-gitignore]

# Analyze and persist into Neo4j
pnpm coderipple index <repository-path> [--repository-id <id>] [--no-gitignore]

# Query the persisted graph
pnpm coderipple graph callers      <repository-id> <node-id>
pnpm coderipple graph callees      <repository-id> <node-id>
pnpm coderipple graph dependencies <repository-id> <node-id> [--depth <n>]
pnpm coderipple graph dependents   <repository-id> <node-id> [--depth <n>]
pnpm coderipple graph paths        <repository-id> <from-node-id> <to-node-id> [--depth <n>]
```

All graph commands accept `--relationships <a,b>` (default `CALLS`) to choose
which edge types to traverse.

### Indexing

```bash
pnpm coderipple index ./fixtures/basic-project
```

```
CodeRipple

Repository:            basic-project
Repository ID:         repo_ab12cd34ef56ab78
Files analyzed:        3
Nodes indexed:         15
Edges indexed:         24
Unresolved references: 4
Database:              Neo4j
Status:                indexed
```

The printed **Repository ID** is what the `graph` commands take as their first
argument.

### Queries

```bash
pnpm coderipple graph callers repo_ab12cd34ef56ab78 src/service.ts::createUser
```

```
Callers of src/service.ts::createUser in repository repo_ab12cd34ef56ab78: 2 result(s)
- src/admin.ts::seedUsers (FUNCTION, depth 1)
- src/controller.ts::register (FUNCTION, depth 1)
```

```bash
pnpm coderipple graph dependencies repo_ab12cd34ef56ab78 src/service.ts::createUser --depth 2
```

```
Dependencies of src/service.ts::createUser in repository repo_ab12cd34ef56ab78: 2 result(s)
- src/service.ts::saveUser (FUNCTION, depth 2)
- src/service.ts::validateUser (FUNCTION, depth 1)
```

```bash
pnpm coderipple graph paths repo_ab12cd34ef56ab78 src/controller.ts::register src/service.ts::saveUser
```

```
Paths from src/controller.ts::register to src/service.ts::saveUser in repository repo_ab12cd34ef56ab78: 1 path(s)
Path 1 (3 hop(s)):
  src/controller.ts::register -> src/service.ts::createUser -> src/service.ts::validateUser -> src/service.ts::saveUser
```

**Query semantics**

- `callers` / `callees` are **direct** (one hop).
- `dependencies` walks *downstream* (`A depends on ...`), `dependents` walks
  *upstream* (`... depends on A`).
- Traversal depth is bounded: default `1`, maximum `5`. `LIMIT`/`SKIP`-style
  unbounded walks are not possible.
- Results are **deterministic**: nodes are sorted by ID (ties by depth), paths by
  length then node sequence, and duplicates are removed. Re-running a query
  against unchanged data yields identical output.

## Re-indexing semantics

Re-indexing a repository **atomically replaces** its stored graph, inside a
single Neo4j transaction:

```
BEGIN
  delete the existing graph for repository X
  insert the newly generated graph
COMMIT
```

If persistence fails partway through, the transaction rolls back and Neo4j is
left with the **previous** graph — never a half-old/half-new mix. Deleting a
symbol in source and re-indexing therefore makes the stale symbol (and its
edges) disappear.

Writes are **batched** (a fixed number of statements: one per node label and one
per edge type, using `UNWIND`), so indexing does not issue one round trip per
node or edge. Incremental graph diffing is intentionally **not** implemented yet.

## Testing

```bash
pnpm test             # unit tests (no Docker)
pnpm test:integration # real Neo4j via Testcontainers (requires Docker)
pnpm typecheck        # tsc --noEmit, strict mode
pnpm lint             # ESLint
```

Unit tests run against real fixture repositories and exercise identity,
configuration, mapping, and the batched persistence plan. Integration tests
start a single Neo4j container and verify persistence, queries, re-indexing,
repository isolation, and a generated 1,000-node / 2,000+-edge scale
sanity check. `pnpm test` never requires Docker.

## Supported languages

- TypeScript: `.ts`, `.tsx`
- JavaScript: `.js`, `.jsx`

CodeRipple currently analyzes **JavaScript/TypeScript repositories only**. It
does not claim support for arbitrary programming languages.

Discovery ignores `node_modules/`, `dist/`, `build/`, `coverage/`, `.next/`,
and `.git/`, honors the repository root `.gitignore`, and skips declaration
(`.d.ts`) and minified (`.min.*`) files.

## Known limitations

Analyzer resolution (unchanged from the static-analysis phase) does **not**
attempt to resolve:

- dynamic `import()` (skipped entirely)
- `eval()` and other runtime code generation
- reflection / metaprogramming
- runtime dependency injection and framework DI containers
- monkey patching
- highly dynamic property access (`obj[key]()`) — recorded as
  `DYNAMIC_PROPERTY_ACCESS`
- constructor invocations (`new Foo(...)`) — not modelled as `CALLS` edges
- CommonJS `require('./x')` / `import x = require('./x')`
- functions nested inside other functions (calls *to* them are unresolved)

Discovery-related limitations:

- Only the repository-root `.gitignore` is honored; nested ones are ignored.
- Only a root `tsconfig.json` is read; monorepos with multiple tsconfigs are not
  yet supported.
- Default ignored directory names are skipped at **any** depth.

Storage/query limitations:

- Traversal depth is capped at `5`; deeper dependency chains require raising the
  bound deliberately.
- Dependency/dependent traversal defaults to `CALLS` only (imports and
  containment are opt-in via `--relationships`).
- Re-indexing replaces the whole repository graph; there is no incremental
  synchronisation, so unchanged nodes are rewritten.
- Repository identity for a **non-git** repository is tied to its absolute path;
  moving it changes the identity.
- Queries return graph structure only — no ranking, scoring, or impact
  interpretation.

## Roadmap

- ✅ Deterministic JS/TS static analysis and code graph.
- ✅ Neo4j persistence and deterministic dependency queries.
- **Git diff → changed-symbol detection.**
- **Blast-radius analysis** built on `dependents`/`dependencies` and path queries.
- **Hybrid retrieval** and **GraphRAG** for impact analysis.
- **LLM**-assisted explanations.
- **GitHub PR** analysis and change-impact reports.
- Additional language analyzers.

None of the deferred items above are implemented yet.

[ts-morph]: https://ts-morph.com/
