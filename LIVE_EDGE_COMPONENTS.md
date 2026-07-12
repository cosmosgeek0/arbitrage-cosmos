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

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced by the canonical
Foundation execution barrier and the L01 regression proof.
