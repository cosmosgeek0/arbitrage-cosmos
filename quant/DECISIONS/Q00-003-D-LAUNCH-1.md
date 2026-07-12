# Q00-003 — D-LAUNCH-1 binds the authentic launch digest

Status: `ACCEPTED` for the Q00 launch gate on 2026-07-12.

## Director evidence

- Director commit: `9ca01537f4edda06ee566cd261e612d5c315fb76` (`D-LAUNCH-1`).
- The commit is contained by both `current-main` and `origin/current-main` in the shared object store.
- `git show 9ca0153 -- QL_DIRECTOR_STATE.md quant/DIRECTIVE_INPUTS.lock` explicitly accepts Git blob `587c1b83e8f9d32b9097d88df7fea40d9829b68e` as the authentic `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` and binds it to SHA-256 `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`.
- The director identifies `0cc192e3…d3cc` as a stale pre-resave measurement and instructs both lanes to resume without repeating their verified reuse audits or research.
- The Q worktree file independently hashes to the accepted SHA-256 and hashes as the accepted Git blob.

## Decision

Treat the Q00 launch-file identity gate as `PASSED` using the D-LAUNCH-1 binding. Decision Q00-002 remains immutable historical evidence of the correctly raised discrepancy, but its external blocker is superseded by this decision.

The Q worktree copy of `quant/DIRECTIVE_INPUTS.lock` remains frozen and byte-unchanged at blob `cf414da3b46d46d1807f4c04939c7ee1121f5895`. The director-owned correction is referenced from the shared object store; it is not copied or cherry-picked into this lane.

## Scope

This decision changes no protocol, authority, source, strategy, capital, risk, execution, ledger or supervisor contract. It only resolves the launch-file identity gate and permits Q00 acceptance followed by Q01.
