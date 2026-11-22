# 0003 — Package and verify a release candidate first

**Status** Accepted

## Context

Users need a runnable CLI without the source checkout or TypeScript tooling.
Public distribution requires an owner decision.

## Decision

Compile the production source to Node ESM using the locked toolchain.
Package the compiled CLI, public declarations, documentation, and demo.
Build from a clean output directory, compare two generated tarballs, and
exercise the installed candidate in a separate directory. Keep the package
private during candidate verification.

## Consequences

Users can install a local tarball and reproduce the acceptance demo.
Consumers resolve runtime dependencies through their own package manager
and lockfile. The owner authorizes any public package publication or
GitHub release.
