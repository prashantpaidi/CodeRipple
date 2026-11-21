# CodeRipple reliability benchmark

Measured on 2026-11-21 with Linux 7.0.0-42-generic on x64, two available logical
CPUs, an Intel Haswell-class virtual CPU, Node.js 24.22.0, Git 2.53.0, and pnpm
12.14.0. Each row uses one worker process. Each stage has one warm-up and seven
timed repetitions. Latencies are p50 in milliseconds.

| Files | Nodes | Edges | Analysis | Revision extraction | Graph build | In-memory impact | Impact report | Retrieval | Peak Node RSS (KiB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 | 24 | 34 | 365.921 | 74.761 | 2.711 | 4.961 | 774.133 | 87.377 | 498852 |
| 96 | 192 | 286 | 433.519 | 68.614 | 10.355 | 8.192 | 978.744 | 865.645 | 518740 |
| 384 | 768 | 1150 | 510.357 | 138.993 | 39.708 | 16.036 | 1285.402 | 2986.711 | 584360 |

The benchmark generates two deterministic Git commits for each size, with one
TypeScript function per file and an import and call to the preceding module.
The head changes 12 function bodies. Impact and retrieval use a depth of three.

- **Analysis** discovers, parses, builds, and validates one worktree graph.
- **Revision extraction** resolves refs, extracts both Git archives to temporary
  directories, and removes the directories.
- **Graph build** extracts symbols and resolves edges from an existing parsed
  project. The warm-up populates the TypeScript program and resolution caches.
- **In-memory impact** starts from prebuilt graphs and mapped changes.
  **Impact report** includes diffing, extracting, and analyzing both revisions.
- **Retrieval** builds a lexical and call-graph evidence package from prebuilt
  revision graphs and a Git-backed source reader.
- **Peak RSS** is the Linux high-water mark of the Node worker across all stages,
  including warm-ups. Git, tar, and Neo4j use separate processes.

At 384 files the pre-change CPU profile attributed about 19.9 seconds of
sampled time to Node's subprocess spawn routine. Each retrieval read 383 base
blobs and 384 head blobs. The base reads could contribute evidence only when
the comparison contained a deletion. Skipping them reduced the read count to
384 head blobs per retrieval. The three profiled pre-change samples had a
retrieval median of 7476.516 ms. The seven post-change samples above were taken
without the profiler. Head-revision blob reads remain part of the workload.

## Reproduce

```bash
pnpm install --frozen-lockfile --ignore-scripts
NODE_OPTIONS=--max-old-space-size=1536 pnpm --silent benchmark
node --max-old-space-size=1536 --cpu-prof --import tsx benchmarks/run.ts --sizes=384 --runs=3
```

`--sizes=12,96,384` and `--runs=7` are the defaults. The JSON output includes
commit IDs, source-read counts, and machine details. The runner uses
nearest-rank p95 at 20 or more observations and p99 at 100 or more.

## Neo4j stages

```bash
pnpm --silent benchmark --neo4j
```

This starts a disposable Neo4j 5.26.33 Community container. The runner measures
reindexing after a warm-up write, then measures node lookup and a three-hop
dependent query over 200 repetitions each. The query results include p50, p95,
and p99. The PR integration job uploads the JSON as `coderipple-benchmark`.

The measurement environment denied access to the Docker socket. Neo4j indexing
and query timings remain unmeasured here, and the local benchmark emits
`neo4j: null` for each size.
