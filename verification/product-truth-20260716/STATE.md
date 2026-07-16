# Product Truth Campaign State

Pass-0 status: `PRECISE_BLOCKED`

Immutable C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Candidate tree: `5a5486a3b1d50fd22017e22de2378ae9cfd607a0`

Evidence HEAD: `ASSIGNED_BY_CONTAINING_EVIDENCE_ONLY_COMMIT` — the exact child SHA is recorded separately in the handoff because a commit cannot contain its own SHA.

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `PRECISE_BLOCKED:CLEAN_CLONE_TEST_ALL_DONOR_OBJECT_MISSING`

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2 remains the immutable source candidate; the evidence child is not a replacement C2.

## Custody result

- Live remote branch `refs/heads/truth-campaign-20260716` resolves to exact C2: `VERIFIED`.
- Backup bundle `/Users/cosmosgeek/cosmos-arbitrage-backup-20260716.bundle` verifies and exposes the same branch at exact C2.
- Bundle SHA-256: `4c36d73fcef5e065c8b416e9e3f64da3a93981abde0b4d40e0b4daa26b799d1b`.
- Exact custody command records, timestamps, exits, and output digests are in `C2_CUSTODY_RECEIPT.json` and `C2_GATE_REPORT.json`.

## Canonical exact-C2 gate

Result: `PASS`.

- `npm ci`: exit `0`; output SHA-256 `29a54f3b3eed828f6fd2f77738dcaa7199593632126ad1e097aa077a6c48d816`.
- `npm test`: exit `0`; emitted test-summary count `413`; output SHA-256 `f70904ab78795cadf4241b701b36f9d9ae6df086621f3e179f712251c895ec5a`.
- `npm run test:all`: exit `0`; emitted test-summary count `2674`; output SHA-256 `24594935436ea8020824528d2981abc70ba761f969d64703351b5eed50db0063`.
- No positive skip or todo marker was observed. The detached exact-C2 worktree was clean after the gate.

## Literal builder clean-clone battery

Result: `BLOCKED` — builder evidence only; no independent Wave-1b token.

- Clone transport: live remote, `--no-hardlinks`, `--single-branch`, branch `truth-campaign-20260716`.
- Checkout command: `git checkout --detach dea2d2a5c2b5e83d3aea75b0e368f0a478596561`.
- Topology: one local branch, one remote-tracking branch, `current-main` absent, detached HEAD exact C2, zero hardlinked object files, no alternates.
- `npm ci`: exit `0`; output SHA-256 `25bb96b9420d86c25ca0550e62dcd3bf1c4357412875370b5870495c9212aef8`.
- `npm test`: exit `0`; emitted test-summary count `413`; output SHA-256 `301c769da1f06e700c1f21f1ee56e327a5ca198cd504bbcc1d33a288a9a1ff1c`.
- `npm run test:all`: exit `1`; emitted test-summary count before failure `1048`; output SHA-256 `08ea52f3afd000d8ca7baa6bcff14f4397a4fa56e829cbf112746cbd30832d4f`.
- First causal error: `DONOR_EQUALITY_BLOCKED:COLLECTION_FAILED:GIT_COMMAND_FAILED:cat-file:128`.
- The diagnostic command `node test/i00/donor-equality.mjs --candidate-ref HEAD` exited `1` with output SHA-256 `36ec0a8d2f2ae9859d87aa24ef96e5705227b5cbd76ef3608000ada9aa4f0fca`.
- The first absent donor object is dashboard donor tip `692501587617d4880303fbd747d93e63c376f088`; direct `git cat-file -t` exits `128` with `fatal: git cat-file: could not get object info` in the single-branch clone.

## Worktree census

Exact-C2 regeneration is `BLOCKED`. Command:

`node verification/product-truth-20260716/generate-worktree-census.mjs dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Start/end UTC: `2026-07-16T19:06:52.430Z` / `2026-07-16T19:06:52.487Z`; exit `1`; test count `0`; output SHA-256 `4f6a30d0d31a75692f43a4ddb1430dcc9e63622a0c570751dadd2cbc1a848e21`; first causal error: `Expected 101 registered worktrees, observed 96`. The older `WORKTREE_CENSUS.json` is not relabeled as C2 evidence.

## Current-main boundary

Local, cached origin, and live origin `current-main` remained `f0c030d37b762198b1e34d6b689112a433efa4c8` before and after this pass. Account A did not touch or push it. No branch was merged or pushed.

## Remaining work

- Restore clone-stable donor proof inputs without weakening `npm run test:all`; then rerun the entire literal clean-clone battery from a new clone.
- Reconcile the current 96 registered worktrees against the explicit 101-worktree census contract; do not silently drop missing rows.
- Regenerate the exact-C2 census, exact evidence package, binding, and manifest only after both blockers are resolved.
- Wave 1b `shard-sec` and `v-cockpit` remain pending, followed by independent final verification.
- No `BASELINE_TRUTH_ACCEPTED`, `INTEGRATED_ACCEPTED`, final acceptance, deployment readiness, or money-path authority is claimed.
