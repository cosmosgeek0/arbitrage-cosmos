# R3-A-CLIENT-004 correction receipt

**Finding:** `R3-A-CLIENT-004`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `cdc3d75a38f74411eecb9ec9736dc404bc0a4cd1`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction and red proof

The verifier's exact inline browser-model probe was rerun at the correction
base. It reported:

```json
{"schemaVersion":"product-supervisor.v1","hasManagedInventory":false,"validationErrors":[]}
```

and exited `7`. Before production code changed, the initial two-case focused
regression exited `1`: the healthy fixture had no managed-inventory field, and
deleting the absent field did not produce `MANAGED_INVENTORY_MISSING`.

## Smallest safe correction

- The Product v1 browser type and decoder now require the server-owned
  `i00-managed-inventory.v1` projection. The wire contract preserves the exact
  33 ordered identities, owners, directional component mappings, unavailable
  dispositions, counts, and evidence-reference grammar already emitted by the
  server owner.
- The decoder rejects omission, unsupported schema, reordered or forged
  identities, owner/mapping drift, invalid or contradictory dispositions,
  forged evidence source/component/index, count drift, unknown projected
  components, and ready envelopes that omit canonical evidence.
- Browser fixtures emit the same synthetic wire shape. The Product Control
  fixture rebuilds evidence against its final donor-projected component array,
  so every evidence index dereferences the exact named component.
- `createProductIntegrationClient().readSupervisor()` uses the existing
  envelope validator and therefore rejects an incomplete server response
  before it reaches presentation state.

No server inventory, topology, scanner, cache, proposal queue, risk gate,
store, socket, lifecycle, or readiness owner was added or changed. The browser
table is only the strict v1 wire-decoder expectation. Production remains
honest at `14 EVIDENCE_PRESENT / 13 OWNER_GATED / 3 NOT_CONFIGURED / 3
MISSING`. `LIVE_EXECUTION_NOT_IMPLEMENTED`, donor-cut equality, serial
dispositions, Q ancestry receipts, and protected owner-input boundaries are
unchanged.

## Focused green proof

```sh
npm --prefix web run typecheck
node --import tsx --test --test-concurrency=1 \
  web/test/productControlRoom/managed-inventory.test.mjs
npm run test:product-control
npm test
node --import tsx --input-type=module - <<'NODE'
// Verifier's exact R3-A-CLIENT-004 probe.
NODE
node --test --test-concurrency=1 --test-reporter=spec \
  test/i00/commands/donor-equality.test.mjs
```

Measured results:

- focused managed-inventory contract: exit `0`, `6/6`;
- web typecheck and build: exit `0`; Vite transformed 1,880 modules, with only
  its pre-existing advisory large-chunk warning;
- complete Product Control family: exit `0`, `86/86`;
- root `npm test`: exit `0`; typecheck, build, deterministic engines, focused
  safety, Product Assurance (`802` behavior plus `4` provenance), and `42/42`
  acceptance contracts passed;
- verifier exact probe: exit `0`, `hasManagedInventory: true`, empty validation
  errors;
- Git-backed donor proof: exit `0`, `9/9`, including exact `16/16/16/16`,
  required-last L, and dashboard equality limited to its sealed 21-file cut;
- clean-candidate authority protocol: exit `0`, `14/14`;
- Product Assurance live-operation denominator: `518` files scanned,
  `205/205` discovered/covered sites, zero uncovered;
- diff hygiene: exit `0`.

The living-input authority protocol is intentionally clean-candidate gated.
An uncommitted check failed only its two expected clean-candidate checks; after
the atomic correction commit, the same protocol passed all `14/14` cases.

## Rendered browser proof

The production-backed Vite page reloaded successfully at
`http://127.0.0.1:5273/`, retained the canonical Product binding state
`OBSERVED`, and had no document horizontal overflow (`1990 / 1990` CSS pixels).
The same-origin supervisor readback returned schema
`i00-managed-inventory.v1`, `33` entries, expected identity count `33`, and
canonical/observed counts `14 / 14`, from `operator-auth` through
`cloudflare-tunnel-access`.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind this correction's exact commit SHA.
