# R3-D-RETRY-006 correction receipt

**Finding:** `R3-D-RETRY-006`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `2da9b20b479449e603d20643e3db6726aed85939`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction and red proof

The verifier's exact built-server command was rerun at the correction base. In
one measured run it reported:

```json
{"socketFactoryCalls":25,"declaredPolicyMaximumAttempts":8,"exceeded":true}
```

and continued until the command called `stop()`. Timing explains why the
independent receipt observed 24 and hostile rechecks observed 26: there was no
attempt or elapsed bound.

The focused regressions were authored before the production correction. The
attempt-bound case exited `1` with 30 constructions instead of 8, and the
elapsed-budget case ended at `closed` instead of visible `exhausted`. A hostile
generation case also failed with one socket construction after a synchronous
`connecting` observer had already stopped that generation.

## Smallest safe correction

- `BinanceStream` remains the sole physical socket/reconnect owner and retains
  its one generation-fenced reconnect timer. It now exports its effective
  policy snapshot and the focused contract proves exact equality with the
  unchanged donor-owned `OP_PUBLIC_WEBSOCKET_STREAM` catalog row: `30,000 ms`
  operation deadline, 8 total attempts, 250/15,000 ms exponential backoff,
  0.35 symmetric jitter, and `90,000 ms` total retry budget.
- Every `socketFactory` invocation counts, including a synchronous throw. The
  initial connection is attempt 1; attempt 9 is never constructed. Test-only
  attempt/time overrides may narrow the production ceilings but are clamped
  when they try to widen them.
- Elapsed law is checked before scheduling and again when the timer fires, so
  a delayed callback cannot dispatch after either the operation deadline or
  retry budget. Invalid or throwing clock reads and negative active-campaign
  retry elapsed time fail closed.
- Scheduled backoff emits `cooldown`. Attempt or elapsed exhaustion clears the
  retry timer, emits latched `exhausted`, and never starts another campaign on
  its own. A short TCP open does not reset the campaign. Only the existing
  stable-connection timer resets the next campaign, or an explicit
  `stop()`/`start()` begins a fresh generation.
- Generation ownership is rechecked after synchronous status delivery. A
  status consumer that stops the generation cannot be followed by a socket
  construction.
- Existing Market and Volume owners retain the exact status and log
  `ws.cooldown`/`ws.exhausted`. The production projection recognizes both
  rather than collapsing them to `missing`: cooldown is non-green
  `BACKING_OFF / SOURCE_TRANSPORT_COOLDOWN`; exhausted is always
  `FAILED / BLOCKED / SOURCE_RETRY_BUDGET_EXHAUSTED`, even when cached evidence
  is stale.
- The UI-local viewed-book fanout inherits the same bounded physical stream but
  remains outside broad source authority as required by ARCHITECTURE Part II;
  its page already labels a quiet source non-live and falls back to same-origin
  REST. No second lifecycle owner, retry scheduler, scanner, cache, or socket
  was added.

The Product Assurance donor catalog is byte-identical to the correction base;
no donor replacement or source-file denominator change was introduced.
`LIVE_EXECUTION_NOT_IMPLEMENTED`, donor-cut equality, serial dispositions, Q
ancestry receipts, and protected owner-input boundaries remain unchanged.

## Focused green proof

```sh
npm run typecheck -w server
npm run build -w server
node --import tsx --test --test-concurrency=1 server/test/stream-lifecycle.mjs
node --test --test-concurrency=1 --test-reporter=spec \
  server/test/systemIntegration/production/production-ports.test.mjs
node --test --test-concurrency=1 --test-reporter=dot \
  "server/test/systemIntegration/**/*.test.mjs"
node --test --test-concurrency=1 --test-reporter=spec \
  test/i00/product-assurance-provenance.test.mjs
node --test --test-concurrency=1 --test-reporter=spec \
  test/i00/commands/donor-equality.test.mjs
node test/i00/product-assurance-operation-overlay.mjs --fail-on-uncovered
node --input-type=module - <<'NODE'
// Verifier's exact R3-D-RETRY-006 command.
NODE
```

Measured results:

- server typecheck and build: exit `0`;
- stream lifecycle: exit `0`, `14/14`, covering exact catalog equality,
  attempt 9 denial, deadline, independently shortened retry budget, late timer,
  widening clamps, short/stable connections, explicit restart, synchronous
  stop, and generation non-resurrection;
- production ports: exit `0`, `18/18`, including stale-cache exhaustion truth;
- complete System Integration family: exit `0`, `401/401`;
- exact verifier command: exit `0` with
  `{"socketFactoryCalls":8,"declaredPolicyMaximumAttempts":8,"exceeded":false}`;
- Product Assurance donor provenance: exit `0`, `4/4`, retaining 190
  donor-identical HEAD blobs and exactly the existing three authorized
  replacements;
- Git-backed donor proof: exit `0`, `9/9`, including exact `16/16/16/16` and
  required-last L/Q ancestry law;
- effective operation overlay: exit `0`, 518 files, `205/205` covered sites,
  zero uncovered;
- diff hygiene: exit `0`.

The required root `npm test` and cross-family `npm run test:all` were both run
and both exited nonzero at the same already accepted pending finding. Before
that stop, each passed typecheck, both builds, Basis `107/107`, Volume
`124/124`, financial safety `59/59`, storage/AWS `29/29`, Node focused `51/51`,
this stream family `14/14`, perimeter `2/2`, Product Assurance provenance, and
every earlier Product Assurance group. `A_CASE_S4_SAFE_PURITY` was `4/5`
because the dirty correction worktree still required a physically present
protected owner directive. That is `R3-D-CLEAN-009`; no protected input was
copied, created, or fabricated to turn this unrelated gate green.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind this correction's exact commit SHA.
