# Known limitations

## Static analysis

- Supported source extensions are `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`,
  `.mjs`, and `.cjs`. Discovery uses the analyzed directory's root
  `.gitignore` and root `tsconfig.json`. It skips symlinks, declarations,
  minified files, and directories such as `node_modules`, `dist`, `build`,
  `coverage`, `.next`, and `.git` at any depth. Nested ignore files and
  multiple project-specific tsconfigs are outside the current discovery model.
- Computed member calls are recorded as `DYNAMIC_PROPERTY_ACCESS`.
  Unresolved references mark uncertainty. They can occur anywhere in a
  revision used by an impact report.
- Dynamic imports, CommonJS `require`, `new` invocations, runtime dependency injection,
  reflection, monkey patching, `eval`, and calls to nested declarations
  can be absent from the graph.
- Impact compares committed snapshots. Snapshots use
  `git archive` and omit untracked dependencies and submodule contents.
  Archive attributes can affect local snapshots. Binary, unsupported, or
  range-free changes may have no mapped symbol.
- Depth limits the caller chain. Imports suggest possible module impact.
  Risk levels are rule-based review cues. Even a low-risk or empty report
  leaves unobserved runtime behavior to review.

## Frameworks and tests

NestJS route metadata recognizes supported named imports and aliases from
`@nestjs/common`, where the controller and HTTP method decorators each use
a string literal path or omit the path. Dynamic paths, arrays, namespace and
indirect decorators, global prefixes, runtime registration, and reachability
are outside that model. Express routes have no special classification.
File and symbol naming heuristics can still flag potential entry points.

Test recommendations use supported files named `*.test.*` or `*.spec.*`,
or located in `__tests__`. A `static-call` recommendation follows resolved
edges. A `module-import` recommendation identifies a lower-confidence file
relationship. Run the suggested tests separately to check behavior and coverage.
`changesWithoutDetectedTests` means the analyzer found no recommendation
under the selected discovery rules and depth.

## Storage and integrations

- Neo4j indexing replaces a whole repository graph. Graph queries use
  bounded traversal and default to `CALLS`. They return graph structure.
- Path-derived repository IDs change when the checkout moves. Repositories
  with a Git origin use its normalized identity and the analyzed subdirectory.
- MCP bounds request size, traversal depth, and response size. The
  [GitHub workflow](github-actions.md) compares the PR merge base and can
  truncate long reports.
- OpenAI explanations depend on shareable evidence and provider availability.
  The model's selections are review suggestions, and the static findings
  remain available if the explanation fails.
