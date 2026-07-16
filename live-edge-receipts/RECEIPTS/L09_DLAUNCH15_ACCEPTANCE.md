# L09 D-LAUNCH-15 acceptance receipt

Status: `L09_ACCEPTED`

**Accepted L09 SHA:**
`e77b2aeb8789d51694c9827092abc1d5269d9ad6`

Accepted L09 tree:
`7bd75c51636e8b9a95ec868c2e76d9572d5c21bc`

Acceptance decision:
`live-edge-receipts/DECISIONS/L09-008-DLAUNCH15-ACCEPTANCE.md`

Acceptance decision SHA-256:
`aaab1025fbb70e622ea152798faa45f0e3d0fcf181d0e67d73f74aae738bb7e5`

Implementation status: `ACCEPTED`

Lane posture: `LANE_READY_BUILT_AND_TESTED_UNWIRED`

Integrated acceptance: `NO`

Merge/push/external actions: `NONE`

## Identity and ancestry receipt

The accepted documentation commit has parent
`97e43acce5335e351b6a66a54c0c7ca8dfafcb6b`, the exact rebased tree on which
the full acceptance battery and final review ran.

| Identity | Full SHA |
|---|---|
| accepted L09 commit | `e77b2aeb8789d51694c9827092abc1d5269d9ad6` |
| accepted L09 tree | `7bd75c51636e8b9a95ec868c2e76d9572d5c21bc` |
| tested rebased head | `97e43acce5335e351b6a66a54c0c7ca8dfafcb6b` |
| tested rebased tree | `ffb1cd8e007d2d0a790fb97dce6f545d3f5d8fb6` |
| retained D14 correction | `73030fab20234d3812e3445c024d21dbc2d3222b` |
| D14 correction parent | `4b1f8907de2be873c45c72adcaede4d18e1ca826` |
| D14 correction tree | `008b07b7132755061d1a2b8ed74117456e9ffcb3` |
| D15 L09 parent | `7894cf01de27a2d283b9c5e36dbc283de966a1b2` |
| SI-RECON ruling-A implementation | `33c708a332f78ff3d79c28c0e796040b6277a64f` |
| SI-RECON immutable receipt | `f03ed786a8c5cab50ef27ad33026a74f79f7df87` |
| director SI-RECON ruling-A merge | `c43262af78b43de0ac5ec819e82f04af60f1f255` |
| frozen protocol | `73e1a1ff7daa48df8dac45713fc5f106842edafc` |

At the acceptance start, exact `git log --oneline -2` was:

```text
97e43ac director: rebase L09 on SI-RECON ruling A (D-LAUNCH-15)
c43262a director: merge SI-RECON ruling A — DIVERGED is correct post-F-BRIDGE truth (D-LAUNCH-15)
```

The D14 correction is an ancestor of the tested head. The 34 correction paths
at `97e43ac` are byte-identical to their `73030fa` blobs: 17 source paths, 17
test paths, `3087/231` insertions/deletions.

While the serial gates were running, `current-main` and `origin/current-main`
advanced from `c43262a` to
`f72c531f766d3f8ffa52e0f0e3fc77ef8345913b`. That later commit changes only
shared `QL_PARALLEL_DAG.md` and `WORKER_PROMPTS.md`. It is not merged or rebased
into L09; it does not alter the tested tree, correction blobs or merge-base
identity recorded here.

## Exact D-LAUNCH-12 acceptance battery

The gates ran serially and uncontended on `97e43ac` with Node `v22.23.1` and
npm `10.9.8`.

| Order | Command | Measured result |
|---:|---|---|
| 1 | `npm run build -w server` | exit `0` |
| 2 | `node --test --test-concurrency=1 --test-reporter=spec "server/test/liveEdge/normalBasis/**/*.test.mjs"` | `35/35`, exit `0` |
| 3 | `node --test --test-concurrency=1 --test-reporter=spec "server/test/liveEdge/exchangeTwin/**/*.test.mjs"` | `84/84`, exit `0` |
| 4 | `node --test --test-concurrency=1 --test-reporter=spec "server/test/liveEdge/executionPolicy/**/*.test.mjs"` | `49/49`, exit `0` |
| 5 | `node server/test/foundation/execution/execution.mjs` | `178/178`, exit `0` |
| 6 | `node --test --test-concurrency=1 --test-reporter=spec "server/test/liveEdge/**/*.test.mjs"` | `1274/1274`, exit `0` |
| 7 | `npm run test:foundation` | all `24/24` sorted files, exit `0` |
| 8 | `node packages/edge-protocol-tests/protocol.test.mjs` | `22/22`, exit `0` |
| 9 | `npm test` | deterministic `377/377`, exit `0` |
| 10 | `npm run test:all` | exit `0` |
| 11 | `git diff --check` | pass |

The full repository gate passed its preceding families and final System
Integration family. The recorded full-family evidence includes deterministic
`377`, app `72`, Intelligence Foundation `152`, Intelligence Runtime `394`,
Capital `433`, all Foundation runner files, and System Integration `180/180`.
No aggregate assertion count is inferred for the 24-file Foundation runner.

The D-LAUNCH-14 SI stop is therefore resolved. Ruling A changes the shared
scenario expectation from `PARTIAL` to canonical `DIVERGED`; the scenario
continues to prove execution authority `NONE`.

## Final independent review

Two fresh read-only post-gate audits reviewed the exact tested head and made no
edits:

1. Evidence/topology audit: `ACCEPT`.
   It independently verified ancestry, both D15 parents, all 34 blob
   identities, aggregate hashes, protected-input hashes, the SI ruling-A blob
   and clean tracked/index state.
2. Whole-diff semantic/security audit: `ACCEPT / NO ACCEPTANCE BLOCKERS`.
   It reviewed contract/hash integrity, account isolation, standard and algo
   order evidence, positions, lifecycle and recovery, request semantics,
   exact identity/decimal/fee lineage, determinism, purity, security and
   false-green posture.

The semantic review investigated the inverse-rounding example where
`0.3 - 0.2` is binary64 `0.09999999999999998` but exact venue residual is
`0.1`. Canonical reachability proof showed that pair cannot coexist at a valid
submission cut:

- `LEG_SUBMISSION_STARTED` requires the closing leg to be `VALIDATED`;
- that `VALIDATED` state originates only from initial `PLANNED` with zero
  cumulative close fill;
- `PARTIALLY_FILLED`, `CANCELLED` and other terminal states cannot transition
  back to `VALIDATED`;
- a working partial refreshes the same client-order ID rather than resubmitting;
- checkpoint restore fully replays and exact-compares the event-derived state;
- Normal Basis additionally requires the replayed checkpoint's last event to
  be the exact current `LEG_SUBMISSION_STARTED`.

An independent minimal in-memory coordinator reproduction confirmed that a
terminal partial `.2` close becomes `CANCELLED`; a second close performs no
validation, submission or lookup and preserves the original single close
submission. The hypothesis was withdrawn, not waived.

Review integrity:

- source aggregate SHA-256:
  `94bcf3c1bdd9d0c04c79323106f0d906b8314d14e0701e728354e154e40d8b9e`;
- test aggregate SHA-256:
  `d11def5b0928544efc2eeb99babd7c90f0e29e802344ab37eac8113b2dfda8c1`;
- combined 34-path SHA-256:
  `ca24a7cd524ee65d62291b50ed3df78194af628c23bfee304f71f6ded4d8bdc1`;
- stable patch ID:
  `f1cf87e7c174919193bd6fac500774f8b17a530b`.

## Protected inputs and worktree truth

The owner inputs remain untracked, unstaged and unchanged:

- `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` SHA-256:
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`;
- `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` SHA-256:
  `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`.

Both match `live-edge-receipts/DIRECTIVE_INPUTS.lock`. Before acceptance
documentation, tracked worktree and index were clean; only these two protected
untracked inputs were present.

## Acceptance and authority boundary

The accepted L09 state is `LANE_READY_BUILT_AND_TESTED_UNWIRED`. Acceptance
does not claim integration, route/UI wiring, deployment or live readiness. No
shared root/director file, source file, test file, package file or protected
input is changed by the acceptance documentation.

No private/account read, credential access, signer call, signed/test/live
order, real send/query/cancel, borrow/repay, leverage or Margin mutation,
capital change, withdrawal, transfer, network call, cloud mutation, process
restart, merge, push or external action is authorized or performed. Money
authority remains `NONE`; external action authority remains `NONE`.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.

This receipt is immutable. Its containing commit identity and SHA-256 are
recorded by the following L09-state-only seal; this file is not amended to
self-reference.
