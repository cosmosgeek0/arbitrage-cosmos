# R3-B-RESTART-003 correction receipt

**Finding:** `R3-B-RESTART-003`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `e935559a4390d04cbd0f636ba8bac110d671cf26`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction

The verifier's exact source commands were rerun at the correction base:

```sh
rg -n 'readRestartTruth' server/src --glob '!*.test.*'
rg -c 'readRestartTruth' server/src/index.ts
```

Only facade and persistence declarations were found. The index count was `0`
and the second command exited `1`; production had no reader. A focused facade
regression was then made red before production correction: starting the real
application shell caused zero effectful restart-truth owner calls where one
durable post-start refresh was required.

The process-level regression was also authored against the correction base.
The old built server emitted only the startup fallback restart-truth event on
each boot and therefore could not satisfy the required startup-plus-refresh
evidence delta.

## Smallest safe correction

- Production now binds one coordinator to the existing canonical System
  supervisor cut and passes that exact cut to the existing canonical ops
  readback. It creates no second supervisor, reconciliation owner, cache,
  store, socket, exchange client, or private reader.
- The four restart-truth authorities are accepted only from the canonical
  14-component supervisor shape, their existing application-owned component
  owners, and the exact nine-field canonical ops schema. Duplicate components,
  wrong owners, malformed freshness or timestamps, truncated ops evidence,
  stale observations, clock regression, active exposure, ambiguity, recovery,
  and semantically bogus owner summaries all remain non-green.
- A post-read injected clock evaluates the completed supervisor/ops cut. A
  normal async clock advance, including a UTC-second boundary, no longer
  rejects valid evidence merely because the request began earlier.
- Passive `readRestartTruth` stays on the passive lifecycle read port. The
  effectful refresh has a separate capability port, runs only after a durable
  `RUNNING` startup, defaults to half of the 60-second freshness lease, and is
  promise-coalesced so concurrent requests perform one owner read and one
  Ledger commit.
- Throwing or malformed owner evidence is durably written as
  `UNKNOWN / UNAVAILABLE / UNKNOWN`. A persistence failure installs an
  application and restart-barrier failure until an exact later commit
  succeeds.
- Drain admission fences and detaches any in-flight refresh before the first
  asynchronous admission read. Direct or queued refresh calls cannot start a
  new owner read during admission; a refused drain explicitly re-arms a new
  epoch, while an admitted drain prevents late writes before the final
  checkpoint.
- HTTP and other projection reads remain passive. Unknown, unavailable,
  synthetic, stale, ambiguous, and recovery-required truth cannot open the
  restart barrier.

The keyless production campaign still reports HTTP `503`; its account truth is
`UNAVAILABLE`, reconciliation is not `FRESH`, and no readiness or managed
restart authority is fabricated. No live/test order, signed/private exchange
path, money path, donor equality, disposition, Q ancestry, or protected owner
input changed.

## Focused green proof

```sh
npm run typecheck -w server
npm run build -w server
node --test --test-concurrency=1 --test-reporter=spec \
  server/test/systemIntegration/application/production-facade.test.mjs \
  server/test/systemIntegration/ops/restart-truth.test.mjs \
  server/test/systemIntegration/security/security-regressions.test.mjs \
  server/test/systemIntegration/production/restart-truth-process.test.mjs
npm run test:integration:built
```

Measured results:

- server typecheck and build: exit `0`;
- combined focused application, coordinator, process, and security set: exit
  `0`, `59/59`;
- two real built-server boots reused one actual Ledger/data directory:
  generation advanced `1 → 2`, boot 2's `restoredFromRevision` exactly equaled
  boot 1's final revision, each boot added startup plus post-start
  `RESTART_TRUTH` evidence, both readiness reads stayed `503`, both clean
  `SIGTERM` exits were `0`, and the network/private tripwire files remained
  absent;
- hostile regressions prove exact owner identity, exact ops shape, async clock
  advance, persistence failure recovery, passive reads, coalescing, freshness
  lease behavior, and both admitted and refused drain fencing;
- the verifier's exact source commands now find the production binding in
  `server/src/index.ts`; the index count is `1`, and both commands exit `0`;
- complete System Integration family: exit `0`, `400/400`;
- diff hygiene: exit `0`.

This receipt is committed atomically with the correction. The final Phase 4
closure receipt will bind this correction's exact commit SHA.
