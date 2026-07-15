# R3-CPT-010 correction receipt

**Finding:** `R3-CPT-010`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `96b5ad576bbe96f4ad03ef1aa07b5554e54c22dd`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction and red proof

The verifier's exact inline source parser was rerun at the correction base. It
reported:

```json
{"canonicalCount":14,"machineGraphExpectedCount":13,"webTypeCount":13,"missingFromMachineGraph":["q-inference"],"missingFromWebType":["q-inference"]}
```

and exited `7`. The initial focused regression was then authored before the
production correction. Both cases failed: the complete fixture contained 13
components instead of 14, and omitting Q still rendered `13 reported · 0
missing` instead of one explicit missing node.

## Smallest safe correction

- The browser `SystemComponentId` union and explicit Machine Graph expected
  order now match the server's existing canonical 14-ID authority exactly.
  No server inventory, supervisor, cache, scanner, socket, or store was added.
- Q is projected through its existing `Q_INFERENCE` owner at
  `quant/src/quant_edge/inference`, depends only on `market-intelligence` in
  the dashboard fixture graph, and groups under the Assessment trace stage.
  Basis and Volume dependencies were not widened because this fixture edge
  model represents required edges and the server's Q engine edges are
  optional.
- Both browser fixture families include Q, while the focused renderer proves
  that a server-shaped `UNAVAILABLE / BLOCKED / UNKNOWN /
  Q_CLIENT_NOT_CONFIGURED` Q node cannot receive a green chip.
- The existing `MachineGraph` component was not rewritten. Its canonical-list
  iteration and existing explicit missing-node path now receive the complete
  type/list contract.

Production readback remains honest: Q is `NOT_CONFIGURED`, stopped, unknown
age, and non-green. `LIVE_EXECUTION_NOT_IMPLEMENTED`, donor-cut equality,
serial dispositions, Q ancestry receipts, and the five protected owner-input
hashes are unchanged. No private/signed exchange, order, borrow, transfer,
withdrawal, cloud, deployment, push, or money path was exercised.

## Focused green proof

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=spec \
  web/test/productControlRoom/machine-graph-inventory.test.mjs
npm --prefix web run typecheck
npm --prefix web run build
npm run test:product-control:built
node --test --test-concurrency=1 --test-reporter=spec \
  test/i00/commands/donor-equality.test.mjs
node --test --test-concurrency=1 --test-reporter=spec \
  server/test/i00Acceptance/authority-protocol.test.mjs
```

Measured results:

- focused canonical inventory/rendering regression: exit `0`, `4/4`;
- web typecheck and build: exit `0`; Vite transformed 1,880 modules, with only
  its pre-existing advisory large-chunk warning;
- complete Product Control family: exit `0`, `80/80`;
- Git-backed donor proof: exit `0`, `9/9`, including exact `16/16/16/16`,
  required-last L, and dashboard equality limited to its sealed 21-file cut;
- clean-candidate authority protocol: exit `0`, `14/14`, preserving the
  immutable Q transition, current authority pins, and sealed owner inputs;
- verifier exact source parser: exit `0`, `14 / 14 / 14`, empty missing arrays;
- diff hygiene: exit `0`.

## Rendered browser proof

The real Vite surface and production-backed local server were inspected with
the in-app browser. The visible fixture Machine Graph rendered 14 nodes,
`14 reported · 0 missing`, and a Q node. Production rendered 14 Component
Authority rows and its canonical hidden donor graph also contained 14 nodes;
production Q remained `NOT_CONFIGURED / STOPPED / UNAVAILABLE / UNKNOWN` with
an idle, non-green chip.

Light and Dark were checked at `390×844`, `1600×900`, and `2940×1200` CSS
viewports. Production was additionally checked at `2940×1200` with the app's
scale set to `125%`. Machine Graph, graph container, page, and production
workspace reported no horizontal overflow; Q remained present; the browser
console reported zero warnings/errors. Theme, scale, and viewport were
restored to Light, `100%`, and browser defaults.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind this correction's exact commit SHA.
