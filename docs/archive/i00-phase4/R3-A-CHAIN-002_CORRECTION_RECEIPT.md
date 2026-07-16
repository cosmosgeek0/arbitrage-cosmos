# R3-A-CHAIN-002 correction receipt

**Finding:** `R3-A-CHAIN-002`

**Severity:** `High`

**Disposition:** `FIXED`

**Correction base:** `730d3f277b00b37b0f557da258e32abbba9914d5`

**Rejected candidate C:** `098f7b9449ab3b1c26bda19f51537bfea01d4c48`

**Role 3 receipt SHA-256:** `90613c8273e5c866603dbaa74106f2ff436c06e320a95a0cbdbc4c55c0d5ae1d`

## Exact reproduction

The verifier's four exact source-inspection commands were rerun against the
correction base. There was no production call to `executeValidateOnly` outside
its facade/type declarations. SC-22 manually appended a handwritten stage
array, while validate-only persistence emitted only one execution trace.

Two focused regressions were made red before changing production source:

- SC-22 was changed to execute the existing validate-only orchestrator and
  query its durable correlation. It failed because the persisted trace had
  `1` event instead of the required `6` reached owner transitions.
- a production-route regression called
  `POST /api/system-integration/validate-only`; it failed `404` instead of
  expected `200` because no production consumer was mounted.

## Smallest safe correction

- The existing authenticated System Integration router now exposes one
  JSON-only validate-only route and replaces any caller time with the injected
  server clock before delegating to the existing application facade.
- The existing orchestrator invokes Foundation's canonical data-only recovery
  recommendation after reconciliation; it adds no send, venue, strategy,
  supervisor, or persistence owner.
- The existing Ledger adapter commits every reached owner transition as six
  singular audit events in one bounded compare-and-set transaction. This
  preserves Product operator-event projection, deterministic replay, and the
  one-Ledger law.
- Trace construction derives reached stages from actual owner invocation
  counts. Terminal failures attach to their actual owner stage. The successful
  Ledger stage is labeled `RECORDED_REPLAY / WIRED` even when a domain stage is
  blocked.
- Validate-only checkpoint schema v2 records bounded canonical recovery
  evidence and uses a distinct idempotency namespace. A hostile regression
  proves that a durable v1 receipt replays and cannot conflict with v2.
- Recovery output is recomputed from canonical persisted inputs during
  validation. Forged action/state pairs, malformed failures, impossible owner
  counts, duplicate trace IDs, and over-bound batches fail before any write.
- The existing Ledger's atomic event bound moves from two to eight; nine still
  fails closed. No new store, queue, socket, scanner, strategy, or execution
  authority exists.
- The exact canonical route inventory moves from fourteen to fifteen and its
  generated report source is updated. Historical sealed receipts are unchanged.

All venue submission, lookup, and reconciliation-call counters remain zero.
No live/test order, private or signed exchange path, money path, donor equality,
disposition, Q ancestry, or protected owner input changed.

## Focused green proof

```sh
npm run typecheck -w server
npm run build -w server
node --test \
  server/test/systemIntegration/persistence/ledger-cas.test.mjs \
  server/test/systemIntegration/persistence/ledger-adapter.test.mjs \
  server/test/systemIntegration/persistence/validate-only-adapter.test.mjs \
  server/test/systemIntegration/routes/control-routes.test.mjs \
  server/test/systemIntegration/scenarios/acceptance.scenarios.test.mjs \
  server/test/systemIntegration/security/security-regressions.test.mjs \
  server/test/i00Acceptance/authority-protocol.test.mjs \
  server/test/i00Acceptance/closure-evidence.test.mjs
npm run test:integration:built
```

Measured results:

- server typecheck and build: exit `0`;
- focused behavior set: `85` tests, with all `81` executable dirty-tree
  behavior checks passing and only the four known uncommitted-candidate checks
  blocked by clean protected-owner hash fallback or then-stale generated
  Markdown;
- after report regeneration, the reduced chain/routes/scenarios/report set:
  `47/48`, with the sole non-behavior failure exactly
  `SEALED_OWNER_FALLBACK_REQUIRES_CLEAN_CANDIDATE:IP_PROOF.md` while the
  correction remained uncommitted;
- complete System Integration family: exit `0`, `391/391`;
- production validate-only persistence: six reached events, one checkpoint
  revision, one checkpoint checksum, one atomic CAS, zero venue actions;
- exact source reproduction now finds production calls in `server/src/index.ts`
  and `server/src/systemIntegration/routes/router.ts`; SC-22 reads the durable
  production-generated chain and appends nothing itself;
- diff hygiene: exit `0`.

The clean-candidate protected-owner and generated machine-evidence checks are
rerun after this atomic correction commit exists. No absent directive is copied
or fabricated to force that boundary green. The final Phase 4 closure receipt
will bind this correction's exact commit SHA.
