# Checkout demo

The demo is a small JavaScript checkout application with a Node test suite.
Between `demo-base` and `demo-head`, the minimum order subtotal for free
shipping increases from 50 to 75.

## Run the analysis

Follow the [install guide](../../docs/install.md) for either an installed CLI
or a source build. For a source build, use `node dist/cli/index.js` wherever the
commands below say `coderipple`. Run the setup script shipped with the
package or checkout, passing a new directory path.

```bash
bash node_modules/coderipple/examples/checkout-demo/setup.sh ./checkout-demo
coderipple impact ./checkout-demo --base demo-base --head demo-head
```

In a source checkout the same script is at `examples/checkout-demo/setup.sh`.
The script creates a separate Git repository with the two example revisions and
leaves `demo-head` checked out.

The report shows these findings.

| Section | What to look for |
| --- | --- |
| Changed symbols | `MODIFIED src/pricing.mjs::shippingFee` |
| Affected dependents | `createOrder` calls `shippingFee` directly. `checkout` reaches it through `createOrder`. |
| Suggested tests | `test/checkout.test.mjs` has a `static-call` path to the change. |
| Uncertainty | `quoteHandlers[name](subtotal)` in `src/dispatch.mjs::quoteByName` is marked `DYNAMIC_PROPERTY_ACCESS`. |
| Affected files | `src/dispatch.mjs` imports the changed module, so it has `potential-module-impact`. The dynamic call has no resolved call path. |

Run the suggested test with Node's test runner.

```bash
node --test ./checkout-demo/test/checkout.test.mjs
```

The tests pass. They exercise subtotals of 30 and 90, which give the same
shipping cost in both revisions. A subtotal of 60 falls between the old and
new thresholds. The suggested test file reaches the changed function, and
checking the new boundary still requires a test case.

Repeat the analysis at depth zero to see the effect of the traversal bound.

```bash
coderipple impact ./checkout-demo --base demo-base --head demo-head --depth 0
```

The changed symbol and unresolved references still appear. The caller chain,
potential import impact, and suggested test disappear at depth zero.
