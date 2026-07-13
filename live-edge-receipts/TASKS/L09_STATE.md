# L09 state — normal Basis lifecycle shard

Generation: `6`

Status: `L09_ACCEPTED`

Acceptance class: `LANE_READY_BUILT_AND_TESTED_UNWIRED`

Implementation acceptance: `YES`

Integrated acceptance: `NO`

## Git and frozen inputs

- Worktree: `/Users/cosmosgeek/Desktop/l09-normal-basis`
- Branch: `l09-normal-basis-20260712`
- Director rebase parent:
  `ecd800679ded1fe21e3d9e97774bbfcaa9341070`
- Accepted F-BRIDGE seam cut:
  `c9009079b0c27c2a7e2d1a0111a022bceb2e61db`
- Prior L09 implementation:
  `36d5e2a39b013b51d2b932f902ec272c9217c23c`
- Accepted L09 correction:
  `a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`
- Accepted L09 correction tree:
  `27c688759a74026a15ea63c3300545c191c10cc2`
- Frozen protocol SHA:
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`

The correction changes exactly ten allowed implementation paths: six under
`server/src/liveEdge/adapters/normalBasis/**` and four under
`server/test/liveEdge/normalBasis/**`. No Foundation or shared source changed.

The owner inputs remain preserved byte-for-byte, untracked and unstaged:

- `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` SHA-256:
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`
- `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` SHA-256:
  `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`

Both identities match `live-edge-receipts/DIRECTIVE_INPUTS.lock`.

## Accepted owner truth

- Proposal, allocation, reservation, staged-plan and mandate identities are
  created by their existing deterministic owners.
- Foundation checkpoint bytes are restored by the injected canonical hydration
  seam and bound to their envelope, checksum, plan, revision, event stream and
  leg definitions.
- Partial entry is terminalized through Foundation lookup before the dependent
  hedge is sized.
- Cold restart restores into fresh ports and proves lookup, canonical
  reconciliation, then hedge without a pre-crash in-memory progression input.
- Agreement consumes the complete canonical Foundation reconciliation result;
  the prior local fill-ratio shortcut and caller-shaped owner state are absent.
- Recovery recommendations retain complete plan/phase/leg/client-order/reason
  and checkpoint/owner/reconciliation/recommendation revision lineage.
- Each submitted semantic leg binds one positive request sequence, request ID,
  intent fingerprint, sanitized-request hash, private-projection revision and
  reconciliation revision. Sequence zero and every single-field substitution
  fail closed.

## Measured verification evidence

- `npm run build -w server`: exit `0`.
- Focused L09 normal-Basis suite: `23/23`, exit `0`.
- Accepted L07/L08.2 exchange-twin suite: `78/78`, exit `0`.
- Accepted L08 execution-policy suite: `49/49`, exit `0`.
- Canonical Foundation execution owner: `173/173`, exit `0`.
- Accumulated LiveEdge suite: `1,246/1,246`, exit `0`.
- Frozen protocol conformance: `22/22`, exit `0`.
- `npm test`: deterministic standard battery `377/377`, exit `0`.
- Import-purity checks: `4/4`, exit `0`.
- `git diff --check`: pass before the implementation commit.
- Three fresh independent verification passes: `ACCEPT`.

`npm run test:all` completes all stages through System Integration, then exits
`1` at `179/180` in that unchanged shared group. The sole mismatch is
`authority.scenarios.test.mjs:521`: expected `PARTIAL`, actual `DIVERGED`.
A clean archive of `ecd8006` builds successfully and reproduces the exact
isolated `28/29` failure. The scenario has no normalBasis dependency, and the
relevant blobs are unchanged from `ecd8006`. The full repository battery is
therefore not claimed green; the result is an evidenced shared baseline
exception and not an L09 correction regression.

## Durable disposition

- Decision:
  `live-edge-receipts/DECISIONS/L09-004-INDEPENDENT-VERIFICATION-ACCEPTANCE.md`
- Receipt:
  `live-edge-receipts/RECEIPTS/L09_ACCEPTANCE.md`

This generation cannot record the SHA of its own containing acceptance commit.
A following state-only seal records that exact acceptance cut without changing
the immutable decision or receipt.

## Current posture and non-claims

- L09: `ACCEPTED`
- Implementation: `BUILT_AND_TESTED`
- Wiring: `UNWIRED`
- Money authority: `NONE`
- External actions: `NONE`
- Secrets inspected: `NONE`
- Live/test/signed orders or private reads: `NONE`
- Reverse Basis, Margin/liability and Volume work: `NONE`
- Push: `NONE`

All execution artifacts remain PAPER/synthetic, non-sendable,
`NONE_RECORD_ONLY`, with external authorization `NONE`.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.

## Emergency resume checkpoint

- Current step: `6/7` — implementation and independent verification complete;
  durable acceptance documentation and final state seal are in progress.
- Exact next sub-task: inspect the emergency documentation commit, complete
  the immutable L09 acceptance record without changing implementation, then
  create the state-only seal that records the acceptance-documentation SHA.
- Half-finished: `L09.md`, this state file, `L09-004` and
  `L09_ACCEPTANCE.md` were drafted after implementation commit `a7a0f7c`; they
  have not received their acceptance-documentation SHA/content-hash seal and
  must not yet be treated as final phase closure.
- Verified before the emergency stop: implementation commit
  `a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`; focused normal Basis `23/23`;
  exchange twin `78/78`; execution policy `49/49`; Foundation execution
  `173/173`; accumulated LiveEdge `1,246/1,246`; protocol `22/22`; `npm test`
  `377/377`; import purity `4/4`; three independent verification results
  `ACCEPT`. `npm run test:all` has the unchanged shared baseline exception
  recorded above and is not claimed green.
- Protected owner inputs remain pre-existing untracked files and are not part
  of this worker's current changes; preserve them byte-for-byte on resume.
