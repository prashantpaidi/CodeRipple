# Changelog

## 1.0.0-rc.1

- Added an installable CLI tarball with a compiled Node ESM entry point,
  TypeScript declarations for the public API, and `coderipple --version`.
- Exposed the canonical impact report through a local, read-only
  `analyze_impact` MCP tool.
- Added a runnable checkout demo showing resolved calls, a test suggestion,
  and uncertainty around dynamic dispatch.
- Included documentation in the package for CLI, MCP, Neo4j, GitHub Actions,
  retrieval, and optional explanations, with security notes and ADRs.

This candidate includes deterministic JavaScript and TypeScript analysis,
Neo4j indexing and graph queries, Git change detection, caller and test impact,
NestJS route metadata, source evidence retrieval, opt-in OpenAI explanations,
and GitHub pull request reporting.

[Release notes](docs/releases/1.0.0-rc.1.md)
