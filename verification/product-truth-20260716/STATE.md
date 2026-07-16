# Product Truth Campaign State

Campaign status: `C3_LOCAL_GATES_PASS_CUSTODY_REQUIRED`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Accepted source candidate C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

C3 tree: `9e54ae92bd3cc4d30d3114590d7da6d81e019f16`

Evidence HEAD: `CONTAINING_EVIDENCE_ONLY_CHILD` — a commit cannot contain its own SHA; the exact evidence HEAD is reported separately by `git rev-parse HEAD` in the custody handoff.

Actor: `ACCOUNT_A_CANDIDATE_WRITER_AND_BUILDER_EVIDENCE_OWNER`

Gate: `C3_CUSTODY_REQUIRED:78f708d6cdb9d1618c53d3f08f71097b4320a63b`

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2 remains immutable and rejected. C3 is the accepted source candidate. The containing evidence-only child is not a replacement C3 and must never be called C3.

## Local gate evidence

- Evidence interval: `2026-07-16T20:51:27.335Z` through `2026-07-16T21:16:54.657Z`.
- Full report: `C3_LOCAL_GATE_REPORT.json`; SHA-256 `c43dc3987777cf4fb716be8f285fc76698d78359d026dc70a32a883111f7d918`.
- All `43` recorded command executions contain the exact command and argv, cwd, start/end UTC, exit code and expected-exit adjudication, stdout/stderr/combined output SHA-256, byte counts, test count and basis, and skip evidence.
- No unexpected skip or todo marker was observed. No required evidence is missing. The report failure field is `null`.

## Live-Git worktree census

Result: `PASS_LIVE_GIT_DERIVED_WITH_REMOVED_SAFE_TOMBSTONES`.

- Exact command: `node verification/product-truth-20260716/generate-worktree-census.mjs 78f708d6cdb9d1618c53d3f08f71097b4320a63b`; exit `0`; count `96`; output SHA-256 `724ddb9e10d1e7dc8699b4c2309bdef9c79c38aaf27d544bbc07b03629a052b`.
- `WORKTREE_CENSUS.json`: SHA-256 `2741f35eeb808e822b7b7c51d75d75048d60d44fdbdab340758427d7c535a5ab`; `279500` bytes.
- Registered count, expected count, and live-policy-name count are all derived from live Git and all equal `96`; there is no numeric expected-count constant.
- Five director-authorized removed helpers are recorded as `REMOVED_SAFE`: `shard-prov`, `shard-sec`, `v-cockpit`, `v-clean`, and `prep-act`.
- Four accepted archive outputs are candidate-tracked byte-exact copies verified against source commit `0e4b364849075a454d7dd624ca068c238f4196c2`, exact source paths, Git blobs, SHA-256 digests, and byte counts.
- `shard-sec` and `v-cockpit` are explicitly `NO_ACCEPTED_OUTPUT` with empty output lists.
- Unknown count: `0`.

## Canonical exact-C3 gate

Result: `PASS` in an exact detached C3 worktree; donor equality mode `LIVE_FULL_WORKSPACE`; equality `16/16/16/16`; final worktree clean.

- `npm ci`: `2026-07-16T20:52:15.777Z` to `2026-07-16T20:52:18.796Z`; exit `0`; output SHA-256 `29a54f3b3eed828f6fd2f77738dcaa7199593632126ad1e097aa077a6c48d816`.
- `npm test`: `2026-07-16T20:52:18.796Z` to `2026-07-16T20:54:10.444Z`; exit `0`; test count `413`; output SHA-256 `4ad9c24f3e8e5cc8e8dcc6f944544ff5be7a039e77dd95a1c9122c7cb657c722`.
- `npm run test:all`: `2026-07-16T20:54:10.446Z` to `2026-07-16T21:04:30.016Z`; exit `0`; test count `2675`; output SHA-256 `709f4986c3106d516ef333a10a5f424770887b848e13dfb4b0910b691e2051ac`.

## Literal builder clean-clone battery

Result: `BUILDER_LOCAL_SOURCE_PASS_NOT_FINAL_LIVE_REMOTE`. This is builder evidence only, not independent Wave-1b verification.

- Clone is single-branch and uses `--no-local --no-hardlinks`; checkout is exact `git checkout --detach 78f708d6cdb9d1618c53d3f08f71097b4320a63b`.
- Clone state: exact detached C3, one local branch, one remote-tracking branch, `current-main` absent, non-shallow, no alternates, three object files inspected, maximum link count `1`, and zero hardlinked object files.
- Donor equality mode: `TRACKED_RECEIPT_SINGLE_BRANCH`; tracked receipt authority is bound to exact commit, path, blob, SHA-256, and sealed proof digest; equality `16/16/16/16`.
- Dashboard donor object `692501587617d4880303fbd747d93e63c376f088` and excluded PREVERIFY object are absent as expected at this exact clone boundary. The reachable merge-donor object remains present. No equality result was fabricated.
- `npm ci`: `2026-07-16T21:04:35.657Z` to `2026-07-16T21:04:38.540Z`; exit `0`; output SHA-256 `29a54f3b3eed828f6fd2f77738dcaa7199593632126ad1e097aa077a6c48d816`.
- `npm test`: `2026-07-16T21:04:38.540Z` to `2026-07-16T21:06:32.688Z`; exit `0`; test count `413`; output SHA-256 `255818e6c9c4aacbe3f7bbfe6ae16afc098a080e5f1bc7f13a94195feb2657c6`.
- `npm run test:all`: `2026-07-16T21:06:32.689Z` to `2026-07-16T21:16:51.184Z`; exit `0`; test count `2675`; output SHA-256 `da789545c26861daa953eb0d1ad0dbcf385c8302678c775bf56e0cb08eb69572`.
- Final clone state is clean.

## C3 remote custody and bundle

- Remote-custody result: `NOT_YET_VERIFIED_FOR_C3`.
- Cached `origin/truth-campaign-20260716` still resolves to immutable C2, not C3. C2 custody does not transfer to C3.
- C3 bundle digest: `NOT_AVAILABLE_PENDING_DIRECTOR_CUSTODY_AND_BUNDLE_RECEIPT`.
- Final live-remote clean-clone battery: `NOT_RUN_AUTHORIZATION_BOUND`.
- No remote fetch, push, merge, or live-remote clone was performed for C3 in this local pass.

## Current-main boundary

Local and cached-origin `current-main` both remained `9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d` before and after the gate. They were not touched or pushed. No branch was merged or pushed.

## Remaining independent-verifier work

- The director must push exact C3 on `truth-campaign-20260716` and return a custody receipt plus verified backup-bundle digest.
- Only after that receipt is recorded may the final literal clean clone be made from the verified live remote, detached at exact C3, and the final live-remote battery run.
- Independent Wave-1b `shard-sec` and `v-cockpit` work remains pending; this builder battery is not a substitute.
- Independent final-verifier adjudication remains pending after Wave-1b and final live-remote evidence.
- No `BASELINE_TRUTH_ACCEPTED`, `INTEGRATED_ACCEPTED`, final acceptance, deployment readiness, or money-path authority is claimed at this pause.
