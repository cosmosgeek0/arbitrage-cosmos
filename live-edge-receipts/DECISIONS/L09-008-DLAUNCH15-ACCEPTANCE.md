# L09-008 — D-LAUNCH-15 acceptance

Decision: `ACCEPT`

Lane disposition: `L09_ACCEPTED`

Integrated acceptance: `NO`

Accepted L09 SHA: the full SHA of the commit containing this decision. A
commit cannot contain its own identity, so the immediately following immutable
receipt records that full SHA without amending this decision.

## Accepted cut

- Tested rebased HEAD:
  `97e43acce5335e351b6a66a54c0c7ca8dfafcb6b`.
- Tested rebased tree:
  `ffb1cd8e007d2d0a790fb97dce6f545d3f5d8fb6`.
- D-LAUNCH-14 correction:
  `73030fab20234d3812e3445c024d21dbc2d3222b`.
- Director SI-RECON ruling-A merge:
  `c43262af78b43de0ac5ec819e82f04af60f1f255`.
- D-LAUNCH-15 rebase parents:
  `7894cf01de27a2d283b9c5e36dbc283de966a1b2` and
  `c43262af78b43de0ac5ec819e82f04af60f1f255`.
- Frozen protocol SHA:
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`.

The D-LAUNCH-14 correction remains an ancestor of the tested head. All 34
correction paths are byte-identical to `73030fa`: 17 source paths, 17 test
paths, `3087/231` insertions/deletions.

## Fresh acceptance gates

The complete D-LAUNCH-12 sequence was run serially on the tested rebased tree.

| Gate | Result |
|---|---|
| authoritative server build | exit `0` |
| focused Normal Basis | `35/35`, exit `0` |
| focused Exchange Twin | `84/84`, exit `0` |
| focused Execution Policy | `49/49`, exit `0` |
| Foundation execution | `178/178`, exit `0` |
| accumulated LiveEdge | `1274/1274`, exit `0` |
| full Foundation runner | `24/24` sorted files, exit `0` |
| frozen protocol | `22/22`, exit `0` |
| `npm test` | deterministic `377/377`, exit `0` |
| `npm run test:all` | exit `0`; final System Integration `180/180` |
| `git diff --check` and cached diff check | pass |

The prior SI `179/180` stop is resolved by ruling A. The corrected shared
scenario now accepts canonical `DIVERGED` truth while retaining execution
authority `NONE`.

## Independent review

Fresh read-only post-gate review returned `ACCEPT / NO ACCEPTANCE BLOCKERS`
against the exact 34-path correction on `97e43ac`.

It accepted contract and hash integrity, account isolation, position and
standard/algo-order truth, lifecycle/recovery behavior, request-boundary
security, exact identity/decimal/fee lineage, purity and false-green posture.
The review confirmed:

- source aggregate SHA-256:
  `94bcf3c1bdd9d0c04c79323106f0d906b8314d14e0701e728354e154e40d8b9e`;
- test aggregate SHA-256:
  `d11def5b0928544efc2eeb99babd7c90f0e29e802344ab37eac8113b2dfda8c1`;
- combined 34-path SHA-256:
  `ca24a7cd524ee65d62291b50ed3df78194af628c23bfee304f71f6ded4d8bdc1`;
- stable D14 patch ID:
  `f1cf87e7c174919193bd6fac500774f8b17a530b`.

An inverse-rounding hypothesis was investigated and rejected as unreachable
under canonical replay. A close submission requires a closing leg in
`VALIDATED`, which originates only from initial `PLANNED` state with zero
cumulative close fill. Partial and terminal legs cannot transition back to
`VALIDATED`; working legs refresh the same client-order ID; checkpoint restore
fully replays and exact-compares its event state.

## Scope and non-claims

This acceptance adds no implementation or shared-file change. The accepted
lane remains `LANE_READY_BUILT_AND_TESTED_UNWIRED`; integrated acceptance is
`NO`. No merge, push, deployment, process restart or external action is
performed.

No private/account read, credential access, signer call, signed/test/live
order, cancel, Margin action, capital mutation, withdrawal, transfer, network
call or money authority exists here. All artifacts remain PAPER/synthetic,
non-sendable and `NONE_RECORD_ONLY`. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains
enforced.
