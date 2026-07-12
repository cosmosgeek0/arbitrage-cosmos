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

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced by the canonical
Foundation execution barrier and the L01 regression proof.
