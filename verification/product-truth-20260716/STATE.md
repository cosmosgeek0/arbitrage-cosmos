# Product Truth Campaign State

Campaign status: `DEFECT_WAVE_3_C4_LOCAL_GATE_REJECTED_CUSTODY_WITHHELD`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

Immutable C4 source candidate: `4c9143a0bcc331aa170e9e26b741240b39df8b9e`

C4 tree: `164c5e812f609364ce6cd3fa37fb91530a226db2`

Evidence HEAD: the containing evidence-only descendant; it does not change or replace C4.

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `REJECTED_LOCAL_CANONICAL_AND_SINGLE_BRANCH_PARITY`

Custody: `WITHHELD`; no `C4_CUSTODY_REQUIRED` token was issued.

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2, C3, and C4 are immutable. Any later source correction is C5; evidence descendants may not repair candidate source.

## Defect Wave 3 ruling

- `VFINAL-PROV-001` — `FIXED`: C4 has exactly one direct parent, and that parent byte-equals immutable C2. C2 evidence commit `4ec9e8640a22661f7e1649204348a212d94163e1`, C3, and every C3 evidence descendant are outside C4 ancestry. `C4_TOPOLOGY.json` asserts direct-parent equality; merge-base ancestry is explicitly insufficient.
- `VFINAL-COCKPIT-001` — `FIXED_IN_C4_SOURCE`: server projection, browser contract, surface renderer, CSS, and hostile tests enforce relational readiness. A missing or blocking required datum forces `BLOCKED_BACKEND`, a blocker, and non-green output.
- `VFINAL-AUTH-001` — `FIXED_IN_C4_SOURCE`: the canonical server Product supervisor owns component presentation, market-feed readiness, strategy runtime presentation, and Watchman posture. The retired browser derivation module cannot mint those truths.
- `VFINAL-DIR-001` — `FIXED_IN_EVIDENCE`: `INPUTS.lock` v4 binds C4 and recomputes all 34 candidate-backed entries—including `STATE.md`—from exact C4 blobs and bytes.
- `VFINAL-DIR-002` — `FIXED_IN_EVIDENCE`: 61/61 inventory entries have one explicit `LOCK-001` through `LOCK-061` source and disposition row. This includes 17 controlling external, 14 candidate-law/lock, 4 defect-wave, 18 superseded-available, and 8 superseded-absent inputs.
- `VFINAL-DIR-003` — `FIXED_IN_EVIDENCE`: all 215 directive-matrix and 23 capability-matrix `candidate_sha` cells equal exact C4. No `SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT` or `C2_NOT_YET_FROZEN` placeholder remains in either matrix.

## Exact-C4 local evidence

- Focused gates passed twice, once in a clean detached exact-C4 worktree and once in a literal local no-hardlink single-branch clone: typecheck exit 0, build exit 0, Product Integration `111/111`, Product Control `101/101`, and I00 commands `29/29`.
- The literal clone was detached at C4 with exactly one local branch and one matching remote-tracking branch, no `current-main` ref, a non-shallow repository, no alternates, zero hardlinked object files, and a clean final status.
- The live census recorded 96/96 registered worktrees, unknown 0, and no Account B reasoning or artifact read. The one protected Account B worktree remains `BLOCKED` from Git status metadata only.
- Local and cached `current-main` stayed byte-identical at `3bf7bb25830df85dcbc978bfcecf16216a02d265` throughout the rerun. Account A did not modify, merge, or push `current-main`.
- Canonical `npm test` and `npm run test:all` each exited 1 in both clean contexts. The same two acceptance-contract tests failed: exact-HEAD candidate report parity and sole-branch parity. `integration/reports/i00-proof-evidence.json` is stale in immutable C4 (`8c45974c…`) versus deterministic regeneration (`8968726a…`); the acceptance-contract suite is `42/44`.

## Exact boundaries

- C4 custody: `WITHHELD_C4_LOCAL_GATE_REJECTED`.
- C2 or C3 custody transfer: `false`.
- Independent final verification: `BLOCKED`; no final-verifier token is issued.
- Product Assurance real soak and incident corpus: `NOT_RUN` / `UNKNOWN_EMPTY`.
- Deployment, external sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private, signed, test-order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, and capital paths: `DEFERRED_OWNER_GATE` or permanently unavailable under `LIVE_EXECUTION_NOT_IMPLEMENTED`.

## Exact next action

Do not amend C4. A source repair must be a separately named C5 that deterministically refreshes `integration/reports/i00-proof-evidence.json`, updates project state in the same source commit, and reruns every focused, canonical, and literal local single-branch gate before any new custody request. This C4 evidence child is a rejection record, not a custody authorization.
