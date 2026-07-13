# IP-ASSURANCE S6 agent-boundary satellite state

Schema: `IP_ASSURANCE_AGENT_BOUNDARY_STATE_V1`

- Status: `IMPLEMENTATION_IN_PROGRESS`
- Branch: `ip-assur-agent-20260713`
- Base: `9785c93102b00389847b77c2f9348c06abc4344b`
- Binding `IP_ASSURANCE.md` SHA-256: `5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803`
- Parent I00 SHA-256: `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`
- Exclusive writes: `fixtures/productAssurance/systemic/agentBoundary/**` and `test/productAssurance/systemic/agentBoundary/**`
- Protected pre-existing worktree input: untracked `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`; never stage or modify it.
- External actions: `NONE`
- Provider mode: `DETERMINISTIC_STUB_ONLY`; `NOT_CONFIGURED` is valid.
- Authority posture: reference schemas/evaluators/view models and draft rows only; no production runtime, command, store, supervisor, provider, or cockpit authority.
- Next exact task: complete focused adversarial tests, run the required verification gates, commit implementation, then add an immutable packet-local receipt and final state.

## Emergency checkpoint — 2026-07-13

- Current step: `1/5` — residual policy, evidence-binding, replay, privacy, and independence closure.
- Checkpoint status: `WIP_COMMITTED_UNVERIFIED`; this is deliberately not `AGENT_PRESTAGE_READY`.
- Exact next sub-task on resume: run the complete focused `agentBoundary` suite once to validate the final current-subject identity-binding patch, then add the still-missing adversarial regression cases before any further implementation.
- Half-finished: exact Class A-D semantics and owner-bound policy projections are implemented; provider/sandbox workload-subject binding, exact trace-decision replay binding, closed PASS-envelope semantics, raw-evidence secret rejection, §3.9 contract-name checks, and resource-digest checks are implemented but the final one-line rotation/current-subject correction has not been retested.
- Still not implemented: the remaining explicit §7.6 trigger/shadow/bounds/demotion evidence projection expansion and the queued focused regressions for cross-trace replay, identity swap, raw secret-bearing inputs, exact PASS-envelope mutations, historical retention actors, null kill control, `NOT_CONFIGURED` sanitization, repair-policy drift, dedup target-content mismatch, and earliest sandbox expiry.
- Last executed focused result before the final correction: `85 tests; 84 pass; 1 fail`; the sole failure was the valid rotation fixture being compared against every historical subject rather than the current subject. The corrective patch now compares the expected subject only to the terminal identity event, but no post-patch test was run because of this emergency stop.
- Previously verified before the latest hardening pass: branch/base and binding hashes; exclusive-write scope; deterministic/offline purity; 85/85 focused suite on the earlier packet snapshot. Repository gates remain environmentally blocked before build by missing `tsc` (`npm test` and `npm run test:all`, exit `127`).
- Resume prohibition: do not treat this checkpoint commit as a completed implementation or immutable receipt.
