# Product Truth Campaign State

Campaign status: `BASELINE_TRUTH_ACCEPTED_C3`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Accepted source candidate C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

C3 tree: `9e54ae92bd3cc4d30d3114590d7da6d81e019f16`

Evidence HEAD: `E3_CONTAINING_EVIDENCE_ONLY_CHILD` — a commit cannot contain its own SHA; the exact E3 SHA is reported separately by `git rev-parse HEAD` after the evidence commit is created.

Actor: `ACCOUNT_A_CANDIDATE_CUSTODIAN_AND_E3_EVIDENCE_OWNER`

Gate: `BASELINE_TRUTH_ACCEPTED:78f708d6cdb9d1618c53d3f08f71097b4320a63b`

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2 remains immutable and rejected. C3 is the immutable baseline source candidate accepted by Account A at Pass 0. E3 is evidence-only, is not a replacement C3, and must never be called C3. This gate does not grant Account B's later `VERIFIED_ACCEPTED`, deployment, private-read, signed-test, order, canary, or money-path authority.

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

## C3 live-remote custody, bundle, and authoritative literal clean clone

Result: `BASELINE_TRUTH_ACCEPTED_C3`. This is Account A Pass-0 baseline custody evidence only; it is not Account B final verification.

- Evidence interval: first recorded command `2026-07-16T21:40:06.769Z`; last recorded command `2026-07-16T22:03:18.283Z`; temporary-clone cleanup completed `2026-07-16T22:03:19.898Z`.
- Full report: `C3_LIVE_REMOTE_GATE_REPORT.json`; SHA-256 `89a22cbb8f7aaf4ecf8afba2385c912b52f16cf656bc59f700c52aaf241f8a0a`; `130534` bytes. Recorder: `run-c3-live-remote-gate.mjs`; SHA-256 `db80e429f5411977e7dfe2e1cca3ea594f0e039fc114fe4b7b5d8e664e8b497b`; `40729` bytes.
- All `81` recorded command executions contain exact command and argv, cwd, start/end UTC, exit code and expected-exit adjudication, stdout/stderr/combined output SHA-256, byte counts, test count and basis, and skip evidence. Receipt audit found zero missing/invalid records, zero unexpected exits, zero remote-mutation commands, and failure `null`.
- Toolchain: Git `2.50.1 (Apple Git-155)`, Node `v22.23.1`, npm `10.9.8`, macOS `26.5.2`, `arm64`; normalized environment SHA-256 `f378f48f08ba23d7f2b67e528a2921b3ede08f4d297563d5120c7080a9dcb1f0`.
- Live `origin/truth-campaign-20260716` resolved to evidence child `ca07f5240b1a656cf3e76fcce9eae6064e3d6934` both before and after the gate. Its exact parent is C3, and C3 is reachable on the live remote.
- Bundle `~/cosmos-arbitrage-C3-20260717.bundle`: observed SHA-256 `d98dc3af075f08bb07d382351ad32d8fa46b564cebf03ace347d625dbea396df`; `155047399` bytes; Git reported complete history. Its campaign head was `ca07f5240b1a656cf3e76fcce9eae6064e3d6934`; a fresh independent `--no-hardlinks --single-branch` clone proved exact C3 and tree, strict fsck exit `0`, one worktree, `current-main` absent, no alternates, maximum object link count `1`, and final clean state.
- Authoritative live-remote clone used `git clone --no-hardlinks --single-branch --branch truth-campaign-20260716` against the SSH origin, then exact `git checkout --detach 78f708d6cdb9d1618c53d3f08f71097b4320a63b`. It proved exact detached C3 and tree, evidence-child parent C3, one local branch, one remote-tracking branch, one worktree, non-shallow history, no `current-main` ref, no alternates, three object files inspected with maximum link count `1`, zero hardlinked objects, and strict fsck exit `0`.
- Dependency lock: `package-lock.json` SHA-256 `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`; Git blob `54efede0fbadd309ca38375349075affc347cb51`.
- `npm ci`: `2026-07-16T21:51:28.142Z` to `2026-07-16T21:51:30.762Z`; exit `0`; output SHA-256 `29a54f3b3eed828f6fd2f77738dcaa7199593632126ad1e097aa077a6c48d816`.
- `npm test`: `2026-07-16T21:51:30.762Z` to `2026-07-16T21:53:12.533Z`; exit `0`; test count `413`; output SHA-256 `741cdf7e03e6308ec67610c8a4760aaa8f8f6c2bfb170067b421447389eb6b83`; no unexpected skip/todo marker.
- `npm run test:all`: `2026-07-16T21:53:12.535Z` to `2026-07-16T22:03:09.520Z`; exit `0`; test count `2675`; output SHA-256 `10b451bfc87c8262c6532dd35bc6b1185750b455ebc855dda4c0b2a9b0d29cca`; no unexpected skip/todo marker.
- Donor equality independently passed in `TRACKED_RECEIPT_SINGLE_BRANCH` mode at `16/16/16/16`. The final live clone remained clean at exact C3. The report aggregate and baseline-token permission are both `true`.

## Current-main boundary

Local, cached-origin, and live-remote `current-main` all remained `9c8c9f98c7fbd491fb97fce70d723b6c8bed2a4d` before and after the gate. It was not checked out, fetched, merged, modified, or pushed. No remote-mutation command was executed; no branch was pushed.

## Remaining independent-verifier work

- Exact next action: Account B starts from a fresh clean clone/detached worktree at exact C3 and executes the campaign Passes 2-5 read-only. Account B may reject but may not fix or write candidate evidence.
- Independent Wave-1b `shard-sec` and `v-cockpit` work remains pending; Account A's local and live-remote batteries are not substitutes.
- Only Account B may issue `VERIFIED_ACCEPTED:78f708d6cdb9d1618c53d3f08f71097b4320a63b`; later cockpit, composed-runtime, staging, private-read, signed-test, test-order, canary, and edge gates remain separate.
- `INTEGRATED_ACCEPTED`, final verification, deployment readiness, and money-path authority are not claimed by E3.
