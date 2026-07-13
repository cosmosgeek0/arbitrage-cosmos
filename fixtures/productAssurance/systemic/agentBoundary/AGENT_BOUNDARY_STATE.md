# IP-ASSURANCE S6 agent-boundary satellite state

Schema: `IP_ASSURANCE_AGENT_BOUNDARY_STATE_V1`

- Status: `BLOCKED`
- Branch: `ip-assur-agent-20260713`
- Base: `9785c93102b00389847b77c2f9348c06abc4344b`
- Audited emergency checkpoint: `66a11f99f6a953be6534d3ff6722dce043501a87`
- Binding `IP_ASSURANCE.md` SHA-256: `5f6d4b3b70e384f6123e9ccc01891faf04aef9da7f7cfd1e0c63be5c3ba68803`
- Parent I00 SHA-256: `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5`
- Exclusive writes: `fixtures/productAssurance/systemic/agentBoundary/**` and `test/productAssurance/systemic/agentBoundary/**`
- Protected pre-existing worktree input: untracked `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`; never stage or modify it.
- External actions: `NONE`
- Provider mode: `DETERMINISTIC_STUB_ONLY`; `NOT_CONFIGURED` is valid only when inferred from exact canonical absence.
- Authority posture: reference schemas/evaluators/view models and draft rows only; no production runtime, command, store, supervisor, provider, or cockpit authority.
- Receipt posture: no immutable acceptance/readiness receipt may be emitted while the owner-law blocker below remains.

## Emergency-checkpoint audit disposition — 2026-07-13

- Kept and verified: the current-subject identity-rotation correction; deterministic deny-all and provider-stub seams; workload identity and trace binding; closed top-level schemas; bounded repair/corpus read projections; and the packet's no-network, no-secret, no-command authority boundary.
- Corrected: evaluation invariants can no longer be overwritten by caller extras; non-PASS identity/trace prerequisites cannot authorize provider PASS; provider failures no longer reflect malformed evidence; typed output evidence is provenance-bound; invalid or missing view inputs project fail-closed; control payloads and nested evidence objects are closed; trace policy content and earliest evidence expiry are decision-bound; unsafe integers, secret-shaped values, locale-dependent ordering, and cross-type hash ambiguity are rejected.
- Discarded: checkpoint fragments that asserted detailed Class A-D behavior or cited nonexistent subsection anchors. Those claims are not recoverable from the permitted current owner sources and therefore cannot survive audit.
- Added and passed: the queued regressions for cross-trace replay, identity swap, raw secret-bearing inputs, exact envelope mutation, historical-actor common mode, null kill control, forged `NOT_CONFIGURED`, repair-policy drift, dedup target-content mismatch, and earliest sandbox expiry.

## Verification

- Focused agent-boundary suite: `100 tests; 100 pass; 0 fail`.
- Syntax/import checks: pass.
- `git diff --check`: pass after the state update.
- Direct worktree `npm test`: exit `127` before typecheck because this worktree has no installed `tsc`.
- Direct worktree `npm run test:all`: exit `127` for the same missing local toolchain.
- Disposable verification copy with the current worktree bytes and a dependency donor whose root/package/workspace manifests and lockfile hashes exactly match: `npm test` exit `0`; `npm run test:all` exit `0`.
- The broader gates emitted only the pre-existing Vite chunk-size warning; no test failure was reported.

## Exact blocker

The current permitted binding source, `IP_ASSURANCE.md` section 7, names a `Class A-D promotion law` but does not define the four class taxonomies, their exact triggers, shadow requirements, bounds, or demotion evidence. The current deduplication packet also does not supply that owner law. Historical archive material is evidence only and is prohibited as implementation authority.

Consequently, every otherwise-valid promotion evaluation returns `UNKNOWN` with `CLASS_TAXONOMY_OWNER_LAW_MISSING`, and the cockpit projection remains blocked. The remaining trigger/shadow/bounds/demotion projection cannot be implemented without inventing authority.

Required unblock: the director must fold the exact Class A-D taxonomy and evidence requirements into a current root owner document, or provide another explicitly accepted current owner policy. After that, implement the owner-defined projection, rerun the focused and repository-wide gates, and only then emit a packet-local receipt and readiness state.
