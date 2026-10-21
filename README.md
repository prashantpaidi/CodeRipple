# CodeRipple

**Trace the impact of every code change.**

CodeRipple analyzes relationships within a codebase so that developers can
understand how changes propagate through functions, services, APIs, databases,
and tests. Ask "what breaks if I change this?" and CodeRipple wants to answer
with a graph, not a guess.

> **This is PR #1 — the static-analysis foundation only.** It performs
> deterministic static analysis of TypeScript/JavaScript repositories and emits
> a code graph as JSON. It does **not** use Neo4j, LLMs, GraphRAG, LangGraph,
> MCP, embeddings, or the GitHub API yet — those are deliberately deferred to
> future PRs (see [Roadmap](#roadmap)).

## Purpose

Large codebases make change impact hard to reason about. CodeRipple's end goal
is to answer questions such as:

- What could break if I modify `AuthService`?
- Which API endpoints depend on `UserRepository`?
- Which modules are affected by this change?
- Which tests should I run after modifying this function?
- What is the dependency path between two components?

To get there, it needs a reliable lower layer: a **code graph** extracted
directly from source. PR #1 builds exactly that layer.

## Current capabilities (PR #1)

Given a local repository, CodeRipple discovers supported source files, parses
them with [ts-morph], extracts symbols, resolves imports, resolves statically
identifiable calls, and writes a deterministic JSON graph.

**Nodes**

| Type       | Description                                              | Example ID                                |
| ---------- | -------------------------------------------------------- | ----------------------------------------- |
| `FILE`     | A source file                                             | `src/services/user.ts`                    |
| `CLASS`    | A top-level class                                         | `src/services/user.ts::UserRepository`    |
| `METHOD`   | A class method, constructor, accessor, or function field  | `src/services/user.ts::UserRepository.save` |
| `FUNCTION` | A top-level function or function-valued const             | `src/utils/token.ts::generateToken`       |

**Edges**

| Type       | Shape                        |
| ---------- | ---------------------------- |
| `CONTAINS` | `FILE -> CLASS`, `FILE -> FUNCTION`, `CLASS -> METHOD` |
| `IMPORTS`  | `FILE -> FILE`               |
| `CALLS`    | `FUNCTION/METHOD -> FUNCTION/METHOD` |

**Resolution supported**

- Relative imports (`./foo`, `../lib/bar`).
- `tsconfig.json` `baseUrl` + `paths` aliases (e.g. `@/*` -> `src/*`).
- Same-file function calls.
- Imported function calls, including namespace imports (`import * as utils`).
- `this.method()` self-calls.
- Cross-file / cross-class calls when the receiver type is statically known.

**Unresolved references**

Anything that cannot be resolved with confidence is recorded instead of guessed,
with a typed reason:

| Reason                    | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `TARGET_NOT_RESOLVED`     | The callee exists but its target could not be determined.       |
| `DYNAMIC_PROPERTY_ACCESS` | A computed member access such as `obj[key]()`.                  |
| `EXTERNAL_DEPENDENCY`     | The callee resolves to a declaration outside the repository.   |
| `AMBIGUOUS_SYMBOL`        | More than one in-repository declaration could be the target.    |

## Architecture

```
src/
  cli/
    index.ts              # argument parsing + terminal output
    analyze.ts            # programmatic entry point + summary formatting
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
    graph-schema.ts       # Zod schemas + validation
    graph-builder.ts      # orchestration, sorting, metadata
    ids.ts                # deterministic ID builders
  utils/
    paths.ts              # path + string helpers
```

The graph is built in ordered phases so cross-file resolution sees every
declaration:

1. **Discover** files (respecting ignored directories and `.gitignore`).
2. **Parse** them into a single ts-morph project, loading `tsconfig.json`
   compiler options when present.
3. **Extract** symbols and `CONTAINS` edges for every file.
4. **Resolve imports** into `IMPORTS` edges.
5. **Resolve calls** against the global declaration table into `CALLS` edges and
   unresolved references.
6. **Sort** nodes and edges, compute metadata, and **validate** the graph with
   Zod before returning/writing it.

**Design principles**

- **Correctness over graph size.** A missing edge can be added later; a false
  edge would corrupt future impact analysis. When unsure, CodeRipple records an
  unresolved reference.
- **Deterministic by construction.** IDs derive only from repo-relative paths
  and symbol names, and all collections are sorted. No timestamps, no UUIDs, no
  randomness — the same repository always yields the same JSON.

[ts-morph]: https://ts-morph.com/

## Installation

Requires **Node.js 22+** and **pnpm**.

```bash
pnpm install
```

## CLI usage

```bash
pnpm coderipple analyze <repository-path>
pnpm coderipple analyze <repository-path> --output <file>
```

Options:

- `-o, --output <file>` — write the code graph JSON to `<file>`.
- `--no-gitignore` — do not honor the repository root `.gitignore`.
- `-h, --help` — show usage.

Examples:

```bash
pnpm coderipple analyze ./fixtures/basic-project
pnpm coderipple analyze ./fixtures/basic-project --output ./coderipple.json
```

### Example output

```
CodeRipple

Repository: basic-project

Files analyzed:     3
Classes:            2
Functions:          4
Methods:            6

Import relationships:3
Calls resolved:     9
Calls unresolved:   4
```

## Generated graph

```json
{
  "version": "1",
  "repository": { "name": "basic-project" },
  "nodes": [
    { "id": "src/auth.ts::AuthService", "type": "CLASS", "name": "AuthService", "file": "src/auth.ts", "startLine": 3, "endLine": 19 },
    { "id": "src/auth.ts::AuthService.login", "type": "METHOD", "name": "login", "file": "src/auth.ts", "parent": "src/auth.ts::AuthService", "startLine": 6, "endLine": 14 }
  ],
  "edges": [
    {
      "id": "CALLS:src/auth.ts::AuthService.login->src/user.ts::UserRepository.findByEmail",
      "type": "CALLS",
      "from": "src/auth.ts::AuthService.login",
      "to": "src/user.ts::UserRepository.findByEmail"
    }
  ],
  "unresolvedReferences": [
    {
      "caller": "src/dynamic.ts::notify",
      "expression": "mailer.send('hello')",
      "line": 19,
      "reason": "TARGET_NOT_RESOLVED"
    }
  ],
  "metadata": {
    "filesAnalyzed": 3,
    "classes": 2,
    "functions": 4,
    "methods": 6,
    "resolvedCalls": 9,
    "unresolvedCalls": 4
  }
}
```

## Supported languages

- TypeScript: `.ts`, `.tsx`
- JavaScript: `.js`, `.jsx`

Discovery ignores `node_modules/`, `dist/`, `build/`, `coverage/`, `.next/`,
and `.git/`, honors the repository root `.gitignore`, and skips declaration
(`.d.ts`) and minified (`.min.*`) files.

## Development

```bash
pnpm test        # Vitest (fixture-based)
pnpm typecheck   # tsc --noEmit, strict mode
pnpm lint        # ESLint
```

Tests run CodeRipple against real fixture repositories under `fixtures/` and
inspect the resulting graphs, rather than mocking the AST.

## Known limitations

PR #1 intentionally does **not** attempt to resolve:

- dynamic `import()`
- `eval()` and other runtime code generation
- reflection / metaprogramming
- runtime dependency injection and framework DI containers
- monkey patching
- highly dynamic property access (e.g. `obj[key]()`)
- runtime-generated functions
- indirect runtime dependencies
- calls made at module top level (no caller node exists for module scope)
- functions nested inside other functions (their calls are attributed to the
  nearest enclosing function or method)

CodeRipple prefers reporting an unresolved reference over producing an incorrect
graph edge.

## Roadmap

Future PRs will build on this static-analysis foundation:

- Persist the graph in **Neo4j** and query it.
- **Hybrid retrieval** and **GraphRAG** for impact analysis.
- **LLM**-assisted explanations.
- **LangGraph**-based analysis agents.
- An **MCP** server exposing the graph to agents.
- **GitHub PR** analysis and change-impact reports.

None of these are implemented in PR #1.
