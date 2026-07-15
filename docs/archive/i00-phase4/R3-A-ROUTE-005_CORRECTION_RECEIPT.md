# R3-A-ROUTE-005 correction receipt

**Finding:** `R3-A-ROUTE-005`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `88d5719c2c4b6b63c1dc98078980f301aedc1f06`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction and red proof

The verifier's exact method-inventory probe was rerun at the correction base.
It reported:

```json
{"methods":["previewCommand","readMaterialEvents","readSupervisor","readTrace","submitCommand"],"hasReadCommandResult":false}
```

and exited `7`. Before production code changed, the first focused regression
also exited `1`: `client.readCommandResult` was `undefined` instead of a
function.

## Smallest safe correction

- The browser client and transport now expose the server's existing canonical
  `GET /v1/commands/:commandId/result` owner. The request is same-origin,
  `no-store`, and contains exactly the bounded `commandId`, `idempotencyKey`,
  and `controlId` identity expected by the server route.
- The browser deterministically derives the canonical server command ID from
  the schema, idempotency key, and control ID, then persists that exact bounded
  query identity before sending the POST. A committed command whose response
  times out therefore remains blocked and recoverable across reload.
- Client decoding requires an exact nine-field, bounded, non-synthetic result
  with canonical IDs, correlation, receipt syntax, UTC milliseconds, and HTTP
  pairing: `202 + ACCEPTED_ASYNC` is `PENDING`; `200 + APPLIED` or
  `ALREADY_APPLIED` is `TERMINAL`; `503 + FAILED_ATTENTION_REQUIRED` remains
  `AMBIGUOUS`. All mismatches and malformed shapes fail closed.
- The Control Room permits at most one unresolved identity, stores each command
  under its own versioned key, detects competing-tab records without overwrite,
  observes cross-tab storage changes, and rejects stale or nonterminal clears.
  StrictMode-safe mount and abort/generation cancellation prevent a stale read
  from clearing or resurrecting state, while cross-tab events cannot clear the
  shared busy flag unless an actual result read is active. One read occurs
  after mount, a real `Recheck Result` action is exposed, and there is no
  polling timer.
- `404`, `409`, `503`, timeout, unavailable storage, malformed durable bytes,
  unverifiable writes, uncleared state, and canceled stale reads retain the
  honest blocked state instead of manufacturing terminal success. Only exact
  canonical terminal truth removes the matching stored identity. A production
  `FAILED_ATTENTION_REQUIRED` submit result also remains in readback.

The browser record is only unresolved query identity and presentation state;
it is not a second command, receipt, control, or lifecycle owner. The server
router, durable command owner, Ledger, and command semantics are unchanged.
No control was confirmed during verification. `LIVE_EXECUTION_NOT_IMPLEMENTED`,
donor-cut equality, serial dispositions, Q ancestry receipts, and protected
owner-input boundaries remain unchanged.

## Focused green proof

```sh
npm --prefix web run typecheck
npm run build -w web
node --import tsx --test --test-concurrency=1 \
  web/test/productControlRoom/command-result-readback.test.mjs
npm run test:product-control:built
npm run test:product-integration:built
npm test
node --test --test-concurrency=1 --test-reporter=spec \
  test/i00/commands/donor-equality.test.mjs
node --test --test-concurrency=1 --test-reporter=spec \
  server/test/i00Acceptance/authority-protocol.test.mjs
node --import tsx --input-type=module - <<'NODE'
// Verifier's exact R3-A-ROUTE-005 probe.
NODE
```

Measured results:

- focused command-result client/transport/persistence/mount contract: exit
  `0`, `13/13`;
- web typecheck and build: exit `0`; Vite transformed 1,883 modules, with only
  its pre-existing advisory large-chunk warning;
- complete Product Control family: exit `0`, `99/99`;
- complete Product Integration family: exit `0`, `109/109`, including the
  existing server route's not-found, pending, terminal, fail-closed, and
  restart-stable owner proofs;
- clean root `npm test`: exit `0`; typecheck, build, deterministic engines,
  focused safety, Product Assurance (`802` behavior plus `4` provenance), and
  the acceptance contract (`42/42`) passed;
- verifier exact probe: exit `0`; the sorted client inventory contains the new
  `readCommandResult` method;
- Git-backed donor proof: exit `0`, `9/9`, including exact `16/16/16/16`,
  required-last L, and dashboard equality limited to its sealed 21-file cut;
- clean-candidate authority protocol: exit `0`, `14/14`;
- Product Assurance operation manifest remains exact at `518` files,
  `205/205` discovered/covered sites, and zero uncovered;
- diff hygiene: exit `0`.

## Rendered browser proof

The built UI was opened directly from the same-origin production server at
`http://127.0.0.1:8080/`. The Control Room retained canonical Product binding
state `OBSERVED`, rendered one Control Registry, had no unresolved-result panel
or recheck action when no durable identity existed, and had zero document
horizontal overflow. The real `Set Read Only` preview opened its confirmation
surface without an alert; it was canceled, so no command or mutation occurred,
the confirmation disappeared, and no durable-result state was created.

An exact, read-only GET using a syntactically valid but absent identity returned
HTTP `404` with stable code `COMMAND_RESULT_NOT_FOUND`, proving the mounted
canonical result route without creating a command.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind this correction's exact commit SHA.
