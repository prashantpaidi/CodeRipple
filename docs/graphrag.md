# GraphRAG and LLM configuration

CodeRipple provides a programmatic retrieval API for questions about code and
a separate opt-in explanation for an impact report. The local CLI can produce
the report without either feature.

## Retrieve evidence locally

Run this example from a project with the candidate and checkout demo installed.

```js
import { retrieveRevisionEvidence } from 'coderipple';

const result = await retrieveRevisionEvidence(
  './checkout-demo',
  'demo-base',
  'demo-head',
  'What calls shippingFee?',
  { depth: 3, maxResults: 10 },
);
console.log(result.evidence.map(({ path, startLine, revision }) => ({
  path, startLine, sha: revision.sha,
})));
```

The API returns revision-tagged source snippets, line ranges, symbol IDs,
resolved relationships, unresolved references, and retrieval limitations.
It reads committed source from Git objects. Deleted symbols can seed a
search in the base revision, and results for other search terms start from
the head revision. Incoming calls can add relevant dependents.

| Option | Default | Range |
| --- | --- | --- |
| `depth` | 3 | 0–10 call hops |
| `maxResults` | 30 | 0–500 items |
| `maxSnippetChars` | 2,000 | 0–20,000 characters per snippet |
| `maxContextChars` | 24,000 | 0–200,000 snippet characters in total |

An integration can pass already-built graphs, mapped changes, and a
commit-aware `readSource(sha, path)` to `retrieveEvidence(input, question, options)`.
An optional `embeddings` provider implements async `embed(texts)` and returns
one finite vector of the same dimension per input. This adds cosine
similarity to lexical ranking and graph traversal. CodeRipple keeps vectors
in memory for the request. Use a local provider to keep all input local.
An external implementation can receive raw question text, names, paths,
and snippets. See [security and privacy](security.md#retrieval-and-openai).

## Opt-in OpenAI explanations

Set `OPENAI_API_KEY` and `CODERIPPLE_OPENAI_MODEL` in the process environment.
Choose a model available to your OpenAI project that supports Structured
Outputs on the Responses API. Set the key through your shell or secret
manager. The impact command reads the process environment directly.

```bash
coderipple impact ./checkout-demo --base demo-base --head demo-head \
  --format markdown --explain --explain-exclude 'internal/**'
```

Use repeatable `--explain-exclude` flags for additional repository-relative
paths. The provider receives bounded, filtered evidence from the existing
report. It selects review priorities and concerns using supplied path IDs.
CodeRipple renders the static relationships, test recommendations, and
citations from the report and source revisions. Review priorities can vary
between provider runs.

Text and Markdown append an explanation section. JSON emits
`{ report, explanation }` when the flag is set and a canonical
`ImpactReport` otherwise. The explanation is `available` or `unavailable`.
Missing configuration, no shareable evidence, invalid results, and provider
errors or timeouts leave the original report usable. A configured key alone
leaves analysis local.

For integrations, `explainImpactReport(report, { enabled: true, provider,
excludePaths })` accepts an `ExplanationProvider` and an optional
commit-aware `readSource`. The provider receives filtered context and an
abort signal and returns review concerns for supplied path IDs.
