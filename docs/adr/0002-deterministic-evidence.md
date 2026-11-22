# 0002 — Preserve deterministic graph evidence and uncertainty

**Status** Accepted

## Context

Incorrect call edges can produce misleading blast-radius paths and test
recommendations. Runtime dispatch can be ambiguous in static code.

## Decision

Use repository-relative paths and qualified names for graph IDs. Resolve
Git refs once per report and sort graph and report collections
deterministically. Only emit call edges backed by statically resolved
declarations. Record unresolved references with reasons and preserve
revision and edge types on impact paths.

## Consequences

Identical inputs yield stable IDs and repeatable evidence. Renames can
change IDs. The report distinguishes a statically resolved call from a
possible module impact, and callers can review uncertainty separately.
