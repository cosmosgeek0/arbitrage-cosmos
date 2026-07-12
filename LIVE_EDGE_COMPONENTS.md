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

## Director-owned integration still required

- owner-approved Basis/Volume advisory intake;
- production composition and lifecycle binding;
- canonical supervisor/API read projection;
- stable package-script insertion from
  `live-edge-receipts/patches/L01-package-scripts.patch`;
- I00 combined compatibility, authority and runtime proof.

Until those gates pass, L01 is never `WIRED`, `LIVE_PUBLIC` or
`INTEGRATED_ACCEPTED`.

## Explicitly absent

- private account reads, signed/test/live orders and exchange mutations;
- automatic capital changes or an assessment-to-order path;
- deployment, restart, AWS, Cloudflare or Secrets mutations;
- a second strategy, proposal, risk, control, ledger, reconciliation or
  outcome authority;
- timers, background loops, filesystem/environment reads or network egress in
  the L01 implementation.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced by the canonical
Foundation execution barrier and the L01 regression proof.
