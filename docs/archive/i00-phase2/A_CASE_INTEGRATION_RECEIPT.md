# A-CASE / S4 integration receipt

Status: `A_CASE_INTEGRATED / CASE_PRESTAGE_READY_PRESERVED`

Date: `2026-07-14`

This receipt closes one newly resealed accepted donor row only. The packet is a deterministic, read-only, `SYNTHETIC_ONLY` assurance projection with `authorityEffect=NONE`. It does not claim production ownership, whole-program assurance readiness, deployment, live operation, or I00 acceptance.

## Immutable donor

- Branch: `ip-assur-case-20260713`.
- Accepted tip: `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c`.
- Donor tree: `3c773878016f4a56c6b03fe6485a42b002c3f5d2`.
- Assigned base: `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6`.
- D-LAUNCH-16 baseline merge: `2d840599c716b5da8f5c42a272fc2232792f868c`.
- Accepted source: `c2201cf91a60387d2cd6901cb42f1c3532ca9b53`.
- Receipt: `fixtures/productAssurance/systemic/assuranceCase/receipts/CASE_ACCEPTANCE_RECEIPT.md`; Git blob `0a10dd8b21b52b40a392a2fa8b11dc949aea649c`; SHA-256 `05369b8aa403a4fae6b86143ddcb7d61551d5996838c92b9bc4aba79401a3550`; terminal `CASE_PRESTAGE_READY`.
- Donor delta from the exact integration common ancestor `f72c531f766d3f8ffa52e0f0e3fc77ef8345913b`: 41 paths; sorted newline-terminated path-set SHA-256 `cf1c711e8688e5d00382b244566d210f5eabbfad30d622ae49a33b6380d358cc`; every path is inside the two assigned S4 roots.
- Donor worktree had no staged or modified tracked path; its protected untracked I00 directive was not copied, staged, removed, or used as implementation.

## Integration identity and scope

- Merge commit: `86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1`.
- Merge tree: `db4708ef5bdd261f4493885a770aa3ff670bf674`.
- Parents in order: pre-S4 integration `7b1a93215df726d98a39ec05588d06f0badf8afe`; exact donor `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c`.
- First-parent delta: 41 paths; sorted newline-terminated path-set SHA-256 `cf1c711e8688e5d00382b244566d210f5eabbfad30d622ae49a33b6380d358cc`.
- All 41 donor paths were compared by Git blob: 41 checked, 0 mismatches.
- Exact donor ancestry, assigned-base ancestry, accepted-source ancestry, S1 accepted identity, and `git diff --check` pass.

## Measured verification

| Gate | Measured result |
| --- | --- |
| Exact focused command at immutable donor tip | Exit 0; `233/233` |
| Exact focused command on accumulated integration branch | Expected context-only exit 1; `231/233`; the two failures are the immutable S4 branch identity and post-director-merge exclusive-lane path-scope assertions |
| Twenty non-context test files | Exit 0; `226/226` |
| Five positive-selected non-lane assertions from `purity-scope.test.mjs` | Exit 0; `5/5` |
| Combined integration-safe behavior | Exit 0; `231/231` |
| Git-backed integration provenance | Exact merge second parent, 41/41 blob equality, exact path-set hash, accepted receipt identity, and required ancestry all pass |
| `npm test` | Exit 0; typecheck/build green; deterministic `377/377`; existing Vite chunk-size warning only |
| `npm run test:all` | Exit 0; deterministic 377, application runtime 72, intelligence 152, intelligence runtime 394, capital 433, Foundation 871, System Integration `180/180` |

The two lane-only assertions are not weakened, rewritten, or reported green on the integration branch. Their valid donor-tip result and replacement Git-object proof are recorded separately. The two earlier blocked receipts remain immutable history and are superseded only by the accepted sibling receipt.

## Honest gaps

- Generated insertion and report rows remain `DRAFT`; serial-spine production owner wiring is pending.
- This packet remains a derived read-only assurance projection and never grants control, repair, runtime, or effect authority.
- External deployment/sentinel evidence and absent S2 action-evidence input remain `NOT_CONFIGURED` or missing.
- The packet is still outside current root-script discovery; integration-safe Product Assurance harness wiring remains pending.
- Overall `ASSURANCE_PRESTAGE_READY`, live operation, and I00 acceptance are not claimed.

## Ruling

Expected S4 donor = discovered immutable tip = receipt-accepted donor = integrated donor by exact merge ancestry. All 41 donor paths are byte-identical, all 233 donor-tip proofs and all 231 integration-safe behavior proofs pass, the immutable lane-context differences are explicitly proven rather than suppressed, and repository-wide gates are green.
