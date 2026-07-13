# LIVE_EDGE_COMPONENTS

Schema version: 1

Program: `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H`

This file is the additive L-lane delta manifest. It does not replace the
canonical authority registry in `ARCHITECTURE.md` Part II and grants no new
strategy, Capital, Risk, control, execution, reconciliation, ledger or outcome
authority.

## L01 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Frozen-schema runtime | `server/src/liveEdge/adapters/edgeProtocol/schemaValidator.ts` | `BUILT_AND_TESTED` | explicit schema-text injection required | Validates only the exact frozen schema SHA; no protocol ownership |
| Canonical protocol client | `server/src/liveEdge/adapters/edgeProtocol/client.ts` | `BUILT_AND_TESTED` | `UNWIRED` | Decode/validate/fail-closed only; no transport or action authority |
| Assessment identity memory | `server/src/liveEdge/integration/identityRegistry.ts` | `BUILT_AND_TESTED` | local bridge utility | Bounded in-memory dedupe/conflict state; not a durable store |
| Advisory assessment bridge | `server/src/liveEdge/integration/assessmentBridge.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Calls only an injected read/advisory owner port; cannot mint decisions, proposals, Capital/Risk verdicts, controls, tickets or orders |
| Outbound projection guard | `server/src/liveEdge/adapters/edgeProtocol/projectionGuard.ts` | `BUILT_AND_TESTED` | `UNWIRED` | Validates/sanitizes canonical-owner outcome/feedback projections; does not own outcome truth |
| Local transport policy | `server/src/liveEdge/adapters/edgeProtocol/localTransport.ts` | `BUILT_AND_TESTED` | policy only | Validates literal loopback/Unix endpoints and observations; opens no socket and performs no I/O |
| Recording-health seam | `CanonicalRecordingHealthPort` in `assessmentBridge.ts` | `BUILT_AND_TESTED` | `UNWIRED` | Read-only projection from canonical Intelligence Runtime; recording degradation has no recovery dependency edge |

## L02 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Dated Binance source manifest | `server/src/liveEdge/adapters/binanceContracts/manifest.ts` | `BUILT_AND_TESTED` | documentary input only | 34 official-source records with independently checked evidence/content hashes; no acquisition or permanent source authority |
| Binance contract matrix | `server/src/liveEdge/adapters/binanceContracts/matrix.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | 112 inert Spot/USD-M/Margin records across production/demo/testnet, exact selected private mechanisms, explicit account-status/mode gates and unknown/non-applicable/conflict posture; grants no external action |
| Closed matrix validator | `server/src/liveEdge/adapters/binanceContracts/validate.ts` | `BUILT_AND_TESTED` | local documentary guard | Rejects unregistered/cross-product/cross-environment/obsolete/conflicting contracts, hostile data and hash drift; performs no I/O and is not an exchange client |
| Checked source fixtures | `server/test/liveEdge/sourceContracts/**` | `43/43` focused source checks | test-only | Hand-authored current tuples plus obsolete/wrong-route and adversarial failures; network-free |

## L03 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Exact signed-contract gate | `server/src/liveEdge/adapters/binanceSignedKernel/contract.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Resolves only hash-locked current Spot/USD-M production REST contracts and a selected HMAC profile; returns documentary identity with no action authority |
| Canonical signed-request constructor | `server/src/liveEdge/adapters/binanceSignedKernel/request.ts` | `BUILT_AND_TESTED` | construction only | Separates inspectable unsigned construction from the raw-input signed gate, produces bounded query-only sensitive material through a call-scoped signer, and blocks identity-free broad cancels; owns no credential, endpoint, transport, retry, execution or persistence |
| UTC/monotonic clock estimator | `server/src/liveEdge/adapters/binanceSignedKernel/clock.ts` | `BUILT_AND_TESTED` | caller-supplied evidence only | Bounded median, 250 ms outlier, 100 ms fresh-dispersion, RTT/freshness and small-`recvWindow` policy; no clock, timer, sync loop or source acquisition authority |
| Deterministic transport identity adapter | `server/src/liveEdge/adapters/binanceSignedKernel/identity.ts` | `BUILT_AND_TESTED` | local construction utility | Reuses Foundation `deriveClientOrderId` and correlation format exactly; closed local request IDs are not commands, plans, tickets, events or durable identities |
| Endpoint rate/cooldown reducer | `server/src/liveEdge/adapters/binanceSignedKernel/rateBudget.ts` | `BUILT_AND_TESTED` | caller-owned immutable state | Consumes exact L02 endpoint costs with V2 header-primed state, worst conditional costs and separately injected capacities/observations; no global budget, transport, scheduler or mutation-retry authority |
| Mutation ambiguity reducer | `server/src/liveEdge/adapters/binanceSignedKernel/ambiguity.ts` | `BUILT_AND_TESTED` | documentary hand-off state only | Preserves submitted timeout/disconnect/5xx as `UNKNOWN`, binds closed ID forms and blocks duplicate send; terminal references never prove reconciliation or create an execution event, result or store |
| Safe failure and diagnostic projection | `server/src/liveEdge/adapters/binanceSignedKernel/safety.ts` | `BUILT_AND_TESTED` | local boundary utility | Reuses Foundation structured failures and recursively drops signatures, payloads, credentials, URLs, account values, causes and stacks |
| Offline signed-kernel proofs | `server/test/liveEdge/signedKernel/**` | `161/161` focused checks | test-only | Public illustrative vectors, hostile inputs, purity tripwires and exact failure/clock/rate/ambiguity boundaries; no network or real credential |

## L04 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Runtime instrument projection normalizer | `server/src/liveEdge/adapters/binanceInstrumentSpecs/normalize.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Consumes only injected, exact-owner-identity `RuntimeListingMetadata`; creates one immutable value snapshot and no acquisition, cache, registry service or persistence owner |
| Current filter/capability schema | `server/src/liveEdge/adapters/binanceInstrumentSpecs/filterSchemas.ts`, `capabilities.ts` | `BUILT_AND_TESTED` | documentary validation only | Closed Spot/Margin and USD-M vocabularies, exact raw/canonical values, content digests, current route intersection and mandatory evidence losses; unknown/malformed/disabled/contradictory filters are non-actionable |
| Immutable snapshot/revision guard | `server/src/liveEdge/adapters/binanceInstrumentSpecs/snapshot.ts` | `BUILT_AND_TESTED` | local value boundary | Validates frozen plain data, exact L02 contract/product/source posture, filter schemas and source/capability losses; semantic instrument/registry revisions stay receipt-stable while separate source-evidence/snapshot revisions bind temporal receipt truth; no store or refresh owner |
| Exact static sizing preflight | `server/src/liveEdge/adapters/binanceInstrumentSpecs/exact.ts`, `sizing.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Reuses only Capital's exact-decimal leaf; price is never adjusted, quantity can only reduce, and approved/intended/official limits plus a literal USDT-denominated 10-USDT ceiling are rechecked; every result is non-sendable |
| Revision-bound reference evidence | `BinanceFilterReferenceEvidence` and `deriveFilterReferenceEvidenceRevision` | `BUILT_AND_TESTED` | injected owner projection only | Requires exact product/symbol/instrument revision, reference kind/window, Runtime producer identity, a maximum 5-second validity interval and no action authority; does not acquire prices |
| Waiting revision/expiry decision | `server/src/liveEdge/adapters/binanceInstrumentSpecs/waiting.ts` | `BUILT_AND_TESTED` | pure hand-off utility | Injected-time decision binds prior semantic/source/snapshot revisions, exact LIMIT/MARKET TIF, USDT denomination and full closed reference evidence; change/expiry invalidates and every result has `sendEligible=false`; creates no proposal queue or lifecycle owner |
| Offline instrument/filter proofs | `server/test/liveEdge/instrumentSpecs/**` | focused deterministic suite | test-only | Official-shaped Runtime fixtures, product/filter boundaries, hostile data, exact/property invariants, coherent snapshot attacks, expiry and import-purity proofs; network-free |

## L05 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Closed private-evidence normalizer | `server/src/liveEdge/adapters/binancePrivateTruth/normalize.ts`, `freshness.ts`, `exact.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Consumes only bounded injected plain data, exact L02 contracts and injected time; preserves exact decimal strings, closed active Spot order enums/relations including non-working `PENDING_NEW`, non-secret Binance client IDs, fixed receipt causality, official Margin trade fields and closed interest types with separately named asset/raw-asset truth; owns no credential, account read, cache or transport |
| Exact query-coverage witness | `PrivateFactQueryCoverage` and `PrivateHistoryCoverageRequirement` in `types.ts`, enforced by `normalize.ts` and `projection.ts` | `BUILT_AND_TESTED` | injected Foundation comparison metadata only | Enforces exact Spot/USD-M/Margin documentary history spans and binds zero-balance inclusion, current cuts, terminal pages, Margin pagination/mode/asset/VIP selectors, source/row times and Foundation-required horizon to realm/posture/target/fact/source-cut revisions; caller-chosen, default, cursor, full-page, duplicate or mismatched cuts cannot claim complete truth |
| Secret and owner-identifier boundary | `server/src/liveEdge/adapters/binancePrivateTruth/bounds.ts`, `index.ts` | `BUILT_AND_TESTED` | local input guard only | Rejects semantic credential roots with version/storage/encoding prefixes or suffixes, token/password/passphrase/mnemonic/seed shapes and bare bearer-like values before retention; admits only exact documentary exceptions and exact fact, receipt, L04/L05, Foundation and foreign-evidence namespaces while keeping unsafe graph helpers private |
| Permission-profile evidence evaluator | `server/src/liveEdge/adapters/binancePrivateTruth/permissions.ts` | `BUILT_AND_TESTED` | owner-review evidence only | Requires distinct read and execution profile identities plus exact realm/fingerprint/IP/egress/mode posture; never grants account-read, mutation, Capital, Risk or action authority |
| Product-private-truth projection | `server/src/liveEdge/adapters/binancePrivateTruth/projection.ts` | `BUILT_AND_TESTED` | canonical-owner hand-off only | Keeps Spot, USD-M and Margin completeness independent; binds exact L04-form target symbol, query scope/selectors, read-profile identity, regenerated source cut, Foundation history requirements and per-product reconciliation cuts; required standard open-order completeness is all-symbol and the separately documented USD-M algo-order family remains an explicit L02 contract gap, so foreign/manual/conditional orders cannot be hidden and no account store or verdict is created |
| Spot signature lifecycle reducer | `server/src/liveEdge/adapters/binancePrivateTruth/spotLifecycle.ts` | `BUILT_AND_TESTED` | documentary value state only | Models the selected current Spot WebSocket API signature subscription with content-, realm-, generation-, semantic- and time-bound event/REST revisions, account-bound markers/cuts, a five-minute owner-REST ceiling, exact retained-marker replay/accounting, canonical content/state comparison, conservative retention-loss posture and exclusive cutoffs; no legacy listen key, socket, credential, timer or generic readiness flag |
| USD-M private lifecycle reducer | `server/src/liveEdge/adapters/binancePrivateTruth/usdmLifecycle.ts` | `BUILT_AND_TESTED` | documentary value state only | Keeps the 60-minute listen-key lease, exclusive 24-hour connection, planned reconnect, exact routed private forms, content-, realm-, generation-, semantic- and time-bound replay-derived event/cut evidence and account-bound owner REST cuts separate; lease-expiry and connection-generation resets fence old coverage yet permit fresh owner-cut recovery, with no listen-key value, request or scheduler |
| Margin risk lifecycle reducer | `server/src/liveEdge/adapters/binancePrivateTruth/marginLifecycle.ts` | `BUILT_AND_TESTED` | risk-evidence only | Models only the selected Cross Margin risk stream with namespaced account-realm fencing and replay-derived latest risk summary; stale/caller-cleared/truncated state stays blocked, while account/trading truth and the conflicting close contract remain unavailable |
| Regenerated lifecycle witness | `server/src/liveEdge/adapters/binancePrivateTruth/lifecycleBinding.ts` | `BUILT_AND_TESTED` | comparison evidence only | Regenerates a deterministic unkeyed SHA-256 content identifier over each validated full product state and binds matrix/product/source/account realm, injected cuts, exclusive cutoff/reconnect posture and owner-comparison revision; this is comparison integrity only, not a source signature, attestation, durable history or previous-state anchor, and Margin remains risk-only blocking |
| Reconciliation comparison hand-off | `server/src/liveEdge/adapters/binancePrivateTruth/handoff.ts` | `BUILT_AND_TESTED` | Foundation input candidate only | Emits sanitized immutable comparison facts and named mismatches; Foundation remains the sole canonical reconciliation owner |
| Private waiting-evidence guard | `server/src/liveEdge/adapters/binancePrivateTruth/waiting.ts` | `BUILT_AND_TESTED` | pure hand-off utility | Canonically builds and rechecks exact-namespaced L04 symbol/instrument evidence against the target-bound private projection, full lifecycle witnesses, permissions and per-product reconciliation cuts on every decision; reconnect/expiry/change invalidates, `persistenceProven=false`, and every result remains non-sendable |
| Offline private-truth proofs | `server/test/liveEdge/privateTruth/**` | focused deterministic suite | test-only | Synthetic official-shaped facts, independent freshness, product-specific lifecycles, hostile-data and static/dynamic purity proofs; network-free and secret-free |

## L06 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Durable mutation journal value adapter | `server/src/liveEdge/adapters/durableMutationJournal/journal.ts`, `types.ts`, `exact.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Constructs/replays only immutable injected journal values; bounds per-kind and total capacity, reserves recovery slots and owns no database, Ledger write, execution, retry or reconciliation verdict |
| Canonical Ledger CAS protocol | `validateMutationAppendRequest`, `applyMutationAppendRequest`, request/ACK contracts | `BUILT_AND_TESTED` | injected ACK only; I00 CAS deferred | Exact expected-version append with content-bound idempotency and acknowledgement validation; failed/stale/partial acknowledgements cannot cross the synthetic boundary, while `persistenceProven=false` prevents a production persistence claim |
| L03/L05 observation lineage and ambiguity reduction | content-bound request-attempt and Spot/USD-M event-marker adapters | `BUILT_AND_TESTED` | comparison integrity only | Reuses accepted L03 attempts and L05 realm/generation/event/content/time helpers; timeout/disconnect/408/5xx and non-408 4xx remain `UNKNOWN` until exact owner reconciliation, private axes remain visible, and unkeyed injected commitments are not signatures or source attestations |
| Foundation reconciliation projection | `buildFoundationReconciliationObservation` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED`; fractional bridge deferred to I00 | Consumes a bounded canonical Foundation result and exact L05 post-action result/product cuts, separates the full-result commitment from an independently reproducible closed projection commitment, validates quantity/status components, selects one matching leg and derives only an L06 projection; contradictory terminal truth conflicts and the safe-integer intersection is the only local comparison subset |
| Section 7 capital/latency/regime/recording seams | `server/src/liveEdge/adapters/durableMutationJournal/section7.ts` | `BUILT_AND_TESTED` | injected evidence only | Fixed 10-USDT ceiling cannot rise; timing preserves clock-domain boundaries and fails closed when a historical durable-intent ACK is unavailable; empirical region benchmark remains not performed; regime advisory and Runtime recording owners stay canonical |
| Offline journal/race/recovery proofs | `server/test/liveEdge/mutationJournal/**` | focused `79/79`; accumulated live-edge `1052/1052` | test-only | Persist failures, CAS/replay, event/HTTP permutations, ambiguity preservation, compatible versus impossible cancel/fill timing, private/owner terminal conflicts, projection tampering, provenance, Section 7, bounds and static purity; network-free |

The director resolved both requests in
`live-edge-receipts/patches/L06-canonical-ledger-cas.request.md` and
`live-edge-receipts/patches/L06-foundation-quantity-bridge.request.md` as
`DEFERRED_TO_I00` in D0011. They do not block injected-port L06 acceptance;
canonical persistence and fractional Foundation comparison remain unclaimed.

## L07 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Deterministic exchange-twin reducer | `server/src/liveEdge/adapters/exchangeTwin/twin.ts`, `types.ts`, `exact.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Reduces only closed injected synthetic fixtures with exact-decimal books, TIF, latency, status, cancel, crash and local-versus-venue truth; no connector, transport, retry, canonical fill or action authority |
| Canonical owner-evidence adapters | `server/src/liveEdge/adapters/exchangeTwin/ownerEvidence.ts` | `BUILT_AND_TESTED` | injected comparison only | Reuses the L03 rate owner, L04 static sizing owner and L06 journal validator; retained owner inputs and results are reproduced on every committed-state validation without creating a second limiter, registry or journal |
| Replay/checkpoint and calibration evidence | `checkpointExchangeTwin`, `restoreExchangeTwin`, `compareExchangeTwinOutcome` | `BUILT_AND_TESTED` | value-only evidence | Retains exact canonical events, reconstructs state before reuse, bounds aggregate fills and preserves fee/cost/calibration missing values; hashes are commitments rather than persistence or model-promotion authority |
| Offline exchange-twin proofs | `server/test/liveEdge/exchangeTwin/**` | focused `69/69`; accumulated live-edge `1121/1121` | test-only | Conservative depth/queue allocation, TIF, ambiguity, fee units/conversion, owner lineage, crash/restart, every durable state, exact resource boundaries and hard external-boundary proofs; network-free |

## L08 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Deterministic execution-mechanics policy | `server/src/liveEdge/adapters/executionPolicy/policy.ts`, `types.ts`, `exact.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Compares bounded injected candidates for an already-authorized intent only; four owner-specific constraint envelopes, L04 capability cuts and current dependency revisions remain exact, while every output is advisory, synthetic-only and non-sendable |
| Exact distribution and conservative objective | `evaluateExecutionPolicy`, exact PPM/CVaR evidence | `BUILT_AND_TESTED` | immutable value only | Retains signed fee/rebate, adverse selection, opportunity decay, cancel/race, unhedged/recovery loss, fill latency, naked exposure and per-leg fill evidence; exact partial-atom CVaR and the declared lexicographic objective introduce no predictor, trainer or calibration threshold owner |
| Causal multi-leg documentary plan | content-addressed action/candidate/plan values | `BUILT_AND_TESTED` | later lifecycle input candidate only | Ordered second-leg quantity is explicitly actual-fill-derived and capped; concurrent per-leg transitions are explicit; cancel/replacement is separate, same-leg, single-use and deadline-monotonic; recovery is exact-exposure-bound and risk-reducing only |
| Offline order-policy proofs | `server/test/liveEdge/executionPolicy/**` | focused `45/45` | test-only | Owner-envelope non-widening, L04 Spot fail-closed posture, bounded USD-M GTC/IOC/FOK mechanics, MARKET rejection, exact CVaR/ranking, latency, sequence, recovery, cancel graph, hostile input, deep-freeze and hard-boundary proofs; network-free |

At the historical accepted L08 cut, L04 could not prove Spot execution rules
or Spot TIF from its Runtime-owned metadata seam. L08 therefore preserved that
`BLOCKED` truth and recorded the director-owned bridge request in
`live-edge-receipts/patches/L08-spot-tif-capability.request.md`; it does not
cross-cast USD-M capability or silently widen L04. L08.1 resolves only the
exact Spot LIMIT/TIF join below.

## L08.1 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Exact Spot LIMIT/TIF capability binding | `server/src/liveEdge/adapters/binanceInstrumentSpecs/spotOrderTifCapability.ts`, `sizing.ts`, `types.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Binds pinned documentary `LIMIT` plus `GTC`/`IOC`/`FOK` to one exact current L04 Runtime snapshot and sizing result; preserves the registry's empty Spot TIF list and original losses, resolves only the exact TIF join, retains remaining gaps, and is deeply frozen/non-sendable |
| Opt-in Spot policy owner-binding seam | `evaluateExecutionPolicyWithOwnerBindings` in `server/src/liveEdge/adapters/executionPolicy/policy.ts` | `BUILT_AND_TESTED` | documentary plan candidate only | Receives the current frozen L04 Runtime snapshot plus complete sizing/reference request, rebinds the capability internally on every evaluation, then requires an exact matching Spot leg, content-bound `INSTRUMENT_FILTER` dependency and unexpired evidence; a receipt/source/snapshot/preflight/reference change invalidates the prior policy, the accepted one-argument evaluator remains fail-closed, and no binding can create Capital/Risk/send authority |
| Ordered normal-Basis policy proof | `server/test/liveEdge/executionPolicy/spot-order-tif-bridge.test.mjs` | execution-policy suite `49/49` | test-only | Proves Spot BUY first, USD-M SELL second, second-leg `ACTUAL_FILL_OF_LEG`, exact TIF/expiry/revision gates, hostile binding rejection and `sendEligible=false`; no lifecycle or order is created |
| Spot bridge owner proofs | `server/test/liveEdge/instrumentSpecs/spot-order-tif-capability.test.mjs` | instrument-spec suite `248/248` | test-only | Proves unchanged legacy rejection, exact official pins, GTC/IOC/FOK, Runtime revision and expiry invalidation, content/arithmetic tamper rejection, deep freeze and import purity; network-free |

L08.1 resolves only the L09 Spot order/TIF capability blocker. It does not
wire L09, alter strategy ownership, or add a live/test order route. Director
must rebase L09/L10/L11 from the exact accepted L08.1 receipt cut.

## L08.2 delta

| Component | Path | Lane build proof | Integration state | Authority / limitation |
| --- | --- | --- | --- | --- |
| Explicit Spot capability preflight event | `SPOT_ORDER_TIF_PREFLIGHT_EVIDENCE` in `server/src/liveEdge/adapters/exchangeTwin/types.ts`, `twin.ts` | `BUILT_AND_TESTED` | `LANE_READY_UNWIRED` | Accepts only a fixture ID, current L04 registry snapshot, complete sizing request and expected L08.1 capability revision for one Spot `LIMIT` fixture; caller-supplied results are impossible, legacy Spot preflight stays blocked, and every mismatch remains `PREFLIGHT_NOT_EXACT` with zero economic effect |
| Current-owner replay seam | `evaluateExchangeTwinSpotOrderTifPreflight` in `server/src/liveEdge/adapters/exchangeTwin/ownerEvidence.ts` | `BUILT_AND_TESTED` | injected comparison only | Reruns the accepted L08.1/L04 binder and validator at event ingestion, venue arrival and checkpoint validation with exact injected-time binding; it owns no registry, policy, order, transport, action or persistence truth |
| Spot LIMIT/TIF twin proofs | `server/test/liveEdge/exchangeTwin/spot-order-tif-bridge.test.mjs` | exchange-twin suite `78/78` | test-only | Proves exact Spot BUY LIMIT GTC, GTC/IOC/FOK mechanics, passive trade-through, legacy Spot and USD-M regression, revision/request/expiry/quantity tamper rejection, replay/checkpoint integrity, closed events, frozen legacy hashes and equal-time ambiguity; network-free |

L08.2 resolves only the L09-002 L07-consumption blocker. It consumes the exact
accepted L08.1 Spot `LIMIT` plus `GTC`/`IOC`/`FOK` surface without changing
L04, L08.1 or the accepted L07 fill mechanics. It adds no sender, order route,
policy authority or production wiring. Director must rebase L09/L10/L11 from
the exact accepted L08.2 receipt cut.

## Director-owned integration still required

- owner-approved Basis/Volume advisory intake;
- production composition and lifecycle binding;
- canonical supervisor/API read projection;
- stable package-script insertion from
  `live-edge-receipts/patches/L01-package-scripts.patch`;
- I00 combined compatibility, authority and runtime proof.

Until those gates pass, L01 is never `WIRED`, `LIVE_PUBLIC` or
`INTEGRATED_ACCEPTED`.

L02 is likewise documentary and `UNWIRED`. L03 consumes the hash-locked matrix
inside the lane and remains construction-only, `UNWIRED` and without a
credential or transport owner. Later L04-L05 adapters may consume these
lane-ready seams; any production composition, package script or supervisor/API
projection remains director-owned.

L04 consumes the L02 contract matrix, Runtime owner evidence and the Capital
exact-decimal leaf without taking their authority. It remains static,
documentary, `UNWIRED` and non-sendable. L05 private truth and any later
production composition remain separate phases and director-owned integration.

L05 consumes only injected evidence and exact accepted L02/L04 identities. It
does not perform a private read, establish a stream, reconcile an account or
create readiness. Production acquisition, owner composition and supervisor/API
projection remain director-owned.

L07 consumes only injected synthetic fixtures and accepted L03/L04/L06 owner
evidence. It remains `UNWIRED`, non-sendable and non-authoritative; Foundation
still owns canonical execution/reconciliation truth, and production order
policy/composition begins no earlier than director-controlled later phases.

L08/L08.1/L08.2 consume only injected owner projections and accepted L04/L07
revisions; L08.1 and L08.2 rerun the current L04 binding rather than trusting a
caller's self-sealed projection.
They create no Capital/Risk decision, order, ticket, coordinator, lifecycle,
reconciliation or persistence owner. Production composition remains
director-owned; L09/L10/L11 must rebase from the exact accepted L08.2 receipt
cut.

## Explicitly absent

- private account reads, signed/test/live orders and exchange mutations;
- automatic capital changes or an assessment-to-order path;
- deployment, restart, AWS, Cloudflare or Secrets mutations;
- a second strategy, proposal, risk, control, ledger, reconciliation or
  outcome authority;
- timers, background loops, filesystem/environment reads or network egress in
  the L01/L02 implementation;
- a Binance client, signer, credential loader, private reader, socket, order
  builder, rate-budget runtime, filter registry or Margin action in L02.
- a credential/key owner, exchange transport, private/account reader, signed
  validation call, runtime scheduler, durable retry store, execution event,
  reconciliation result or automatic mutation resubmission in L03.
- an exchange-info/reference-price fetcher, mutable registry/cache, FX owner,
  account/filter-count reader, proposal queue, Capital/Risk verdict, order
  constructor, execution/reconciliation action or capital increase in L04.
- a credential loader, private REST reader, listen-key value, socket, stream
  scheduler, account cache, reconciliation verdict, Margin action, test/live
  order, capital change or generic cross-product readiness owner in L05.
- a database, SQLite connection, Ledger writer, outbox daemon, exchange call,
  private query, retry authority, dispatcher consume lease, Foundation verdict,
  fractional quantity bridge, empirical region benchmark or production wiring
  in L06.
- an exchange client, private/account read, signer, socket, retry scheduler,
  canonical fill/position/reconciliation verdict, model trainer, persistence
  owner or production execution-policy binding in L07.
- an order sender, market-price bypass, blind retry, atomic cancel-replace,
  recovery mutation, second strategy/coordinator, Capital/Risk override,
  calibration owner, store, ticket, canonical lifecycle or production binding
  in L08.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced by the canonical
Foundation execution barrier and the L01 regression proof.
