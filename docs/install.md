# Install and build

## Requirements

- Node.js 22 or later and pnpm 12.14.0.
- Git and tar on `PATH` for `diff`, `impact`, and MCP. The demo setup uses Bash.
- Use the same Node and pnpm versions when comparing build artifacts. The
  release candidate uses Node 24.22.0.

Dependency installation normally needs registry access. After installation,
local analysis needs no network access, database, or credentials.

## Run an installed release candidate

Use a candidate tarball from the owner, or create it from a checkout using the
packaging instructions below. In a Bash shell, replace the path on the first
line with the absolute path to your tarball.

```bash
candidate=/absolute/path/to/coderipple-1.0.0-rc.1.tgz
mkdir coderipple-local
cd coderipple-local
npm init -y
pnpm add --ignore-scripts "$candidate"
export PATH="$PWD/node_modules/.bin:$PATH"
coderipple --version
```

Expect `1.0.0-rc.1`. Create the bundled checkout demo and compare its two revisions.

```bash
bash node_modules/coderipple/examples/checkout-demo/setup.sh ./checkout-demo
coderipple impact ./checkout-demo --base demo-base --head demo-head
node --test ./checkout-demo/test/checkout.test.mjs
```

The report identifies a changed function, resolved callers, a suggested test,
and a dynamic call it cannot confirm. See the [walkthrough](../examples/checkout-demo/README.md)
for the expected output and a second comparison at depth zero.

For your own repository, point the CLI at a local checkout and provide two refs
that exist there. `impact` compares the two commits directly.

```bash
coderipple impact /path/to/repository --base HEAD~1 --head HEAD --format markdown
```

If Git reports an invalid ref, fetch the missing branch or deepen a shallow
clone. Commit any edits you want included. Use `analyze` for the current files
on disk. See the [CLI reference](cli.md).

## Build from source

Run these commands from the CodeRipple checkout. If needed, install the pinned
package manager with `npm install --global pnpm@12.14.0`.

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/cli/index.js --version
```

The build clears `dist/` and emits Node ESM and declarations for `src/`.
`pnpm coderipple --help` also works in the checkout and runs TypeScript through
the development dependency `tsx`.

## Reproduce the package

From the checkout, use the pinned toolchain and the frozen lockfile above.
Packing rebuilds `dist/` through the `prepack` hook. Keep the output directories
outside the checkout.

```bash
first="$(mktemp -d)"
second="$(mktemp -d)"
pnpm pack --pack-destination "$first"
pnpm pack --pack-destination "$second"
cmp "$first/coderipple-1.0.0-rc.1.tgz" "$second/coderipple-1.0.0-rc.1.tgz"
```

A successful `cmp` produces no output. The package contains compiled code,
documentation, and the runnable demo. It installs production dependencies
according to the consumer's package manager and lockfile. Record the tarball
checksum and keep the consumer lockfile when repeating an installation.
