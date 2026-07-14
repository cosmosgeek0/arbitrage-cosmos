# Conditional donor re-audit receipt

Status: `L_REFUSED_DIRTY_UNSEALED / A_FORMAL_REFUSED_BLOCKED`

Recorded: `2026-07-14T05:32:30Z`

This immutable Phase 2 snapshot was taken immediately after all 15 currently accepted donors were integrated and receipted. It freezes refusal evidence only; it does not modify, copy, clean, stage, or adopt either donor worktree.

## L lane — refused

- Branch: `live-execution-control-proof-20260712`.
- Discovered tip: `13e5e3f4695c926bae513d3f254e4924970d36df`.
- Discovered tree: `336dc0632060943bff8c3b37dcaa99d688688691`.
- Committed state: `LIVE_EXECUTION_BUILD_STATE.md` Git blob `d3bf3e93365eaf4ffe919bb37063e9a415f540fc`; SHA-256 `051e20e45220907311e5050ed97e9baf8b76497d4135de9eefa8a32184c2da09`; generation 19; current phase `L16`; phase status `ISSUED`; lane status `L_SPINE_FINALE_ACTIVE`.
- Latest immutable phase acceptance is only L13: `live-edge-receipts/RECEIPTS/L13_ACCEPTANCE.md`; Git blob `2536490094c06ca6731c48067d732f63d0bdb183`; SHA-256 `8a87d3a3ab7ac4f7aabe85aaa6cb3b1ff4e85883d83682a7ffb3aa1b2b2d7062`; it preserves `SYNTHETIC_ONLY_UNWIRED` and `LIVE_EXECUTION_NOT_IMPLEMENTED`.
- `LIVE_EDGE_RECEIPT.md` is absent; L16 and L17 acceptance receipts are absent; exact terminal `L LANE_READY` is absent.
- Tracked and staged paths are clean, but the worktree contains nine donor-owned untracked L16 paths beyond the two protected owner directives. Their sorted newline-terminated path-set SHA-256 is `884b3ad3e81cf683430dd781fc7bc624787d3864eddcf3dc8c1428a60c9c6040`.
- The nine partial paths comprise the D0018 decision, three `server/src/liveEdge/adapters/externalProofEvidence/**` files, and five `server/test/liveEdge/externalProofEvidence/**` files.
- Refusal: `DIRTY_PARTIAL_L16 / FINAL_RECEIPT_ABSENT / L_LANE_READY_NOT_SEALED`.

The L branch is not an accepted donor and is not merged. Its committed L patch requests remain separate I00 integration inputs and do not confer lane acceptance.

## A-FORMAL — refused

- Branch: `ip-assur-formal-20260713`.
- Discovered tip: `89c783bd9e55ce83c21ed1181757122d88e4c980`.
- Discovered tree: `bb444b7ea959f086bbc1d1021b6f9b45e0fadf79`.
- Worktree has no staged or modified tracked path and only the protected untracked I00 directive.
- Latest reseal: `fixtures/productAssurance/systemic/formal/receipts/D_LAUNCH_10_COMPLIANCE_RESEAL.md`; Git blob `d4130e0b41262e1fe387c1433fd1af0021d957d6`; SHA-256 `d693696aa339d490ef58fee2bf4c833ce660d6a265391c5363079b32d62a165f`.
- Exact terminal: `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED` from the preexisting D-LAUNCH-8 run-boundary event.
- No superseding accepted receipt exists. A board label cannot override the immutable terminal receipt.
- Refusal: `TERMINAL_BLOCKER_PRESERVED / ACCEPTANCE_RECEIPT_ABSENT`.

## Ruling

The currently accepted donor set remains exactly 15 and is fully integrated. L and A-FORMAL are not silently counted, copied, or partially adopted. Shared I00 serial-spine wiring may proceed with both gaps explicit; the hard external boundary and all `NOT_CONFIGURED`, `OWNER_GATED`, `UNKNOWN`, and `LIVE_EXECUTION_NOT_IMPLEMENTED` states remain controlling.
