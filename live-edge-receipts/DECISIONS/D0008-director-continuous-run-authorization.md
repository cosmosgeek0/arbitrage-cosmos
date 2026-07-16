# D0008 — director continuous-run authorization

Status: `ACCEPTED`

Acceptance ID: `D-LAUNCH-2`

Recorded: `2026-07-12T05:11:32Z`

Director commit: `84d2ff65fd8d2b200821126dd17b4ba75f3c131c`

Director state blob at that commit:
`da70fa36527bbaf9d08dd1bca7bd29b0f0325e22`

Director state SHA-256 at that commit:
`a479f76b08a2e6846f5a876b6fdf7c6223a7aebdd79be9d8231b279b00d99d78`

Parent director acceptance:
`9ca01537f4edda06ee566cd261e612d5c315fb76` (`D-LAUNCH-1`)

## Verification

- `git show 84d2ff6 -- QL_DIRECTOR_STATE.md` was read directly from the
  shared object store.
- The commit changes only `QL_DIRECTOR_STATE.md` and adds the exact
  `D-LAUNCH-2` standing continuous-run acceptance entry.
- The commit descends from `D-LAUNCH-1` and is contained by the director's
  current-main history in the shared object store.
- The current L-lane remains on
  `live-execution-control-proof-20260712`, descends from canonical base
  `7010499170e24b31c9c0be2c9d73a536e680c6fe` and frozen protocol
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`.
- No frozen input, protocol, authority or external-boundary conflict was
  introduced.

## Controlling effect

- The launch Section 8 one-hour caution and per-phase director-stop language
  are superseded.
- The lane continues in strict order from the durable current phase through
  L17 without routine acknowledgment or per-phase director waiting.
- A phase self-accepts only after its entire durable loop is complete:
  implementation, focused tests, accumulated lane tests, adversarial review,
  corrections, implementation commit, immutable receipt and state update.
- Context compaction is not a stopping condition; execution resumes from the
  hash-locked build state, current task and latest receipt.
- The only stopping conditions are a genuine frozen-input/protocol/authority
  conflict, the hard external-action boundary or full `LANE_READY` completion.

## Non-effects

- D-LAUNCH-2 does not reopen or repeat accepted L00-L04 work.
- It does not accept L05 or any later phase in advance.
- It does not broaden the exclusive write allowlist or permit shared-file,
  frozen-protocol, Main/Q-worktree or current-main writes.
- It does not authorize a private/account read, credential access, signed or
  test/live order, Margin action, capital change, deployment, restart,
  AWS/Cloudflare/Secrets mutation, push or any other external action.
- It does not weaken the scope gate, deterministic-test, canonical-owner,
  immutable-receipt or `LIVE_EXECUTION_NOT_IMPLEMENTED` laws.
