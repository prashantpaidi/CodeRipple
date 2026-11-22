# 0001 — Keep analysis independent of adapters

**Status** Accepted

## Context

A local impact report must work on two Git revisions with no database,
workflow runner, MCP client, or model credentials.

## Decision

Parse files into a validated `CodeGraph`. Map Git changes onto revision
graphs and feed both graphs to the in-memory impact engine. CLI, MCP, and
GitHub consume the resulting `ImpactReport`. Neo4j implements the separate
`GraphStore` contract. Explanations add a provider interpretation after the
report is complete.

## Consequences

The default analysis and its tests run without services. Adapters share a
report schema and can set their own presentation and resource limits.
Indexing adds persistent graph queries and operates on a separate data path.
