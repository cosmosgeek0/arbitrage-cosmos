# Clean Clone Gate — TruthA Pass 0

Status: `BLOCKED`

Candidate: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Actor: `ACCOUNT_A_CANDIDATE_WRITER`; independent acceptance authority: `false`.

The live-remote clone used `--no-hardlinks --single-branch --branch truth-campaign-20260716`, then ran the literal command `git checkout --detach dea2d2a5c2b5e83d3aea75b0e368f0a478596561`. It had one local branch, one remote-tracking branch, no `current-main`, no alternates, zero hardlinked object files, and exact detached C2.

- `npm ci`: exit `0`; output SHA-256 `25bb96b9420d86c25ca0550e62dcd3bf1c4357412875370b5870495c9212aef8`.
- `npm test`: exit `0`; test-summary count `413`; output SHA-256 `301c769da1f06e700c1f21f1ee56e327a5ca198cd504bbcc1d33a288a9a1ff1c`.
- `npm run test:all`: exit `1`; test-summary count before failure `1048`; output SHA-256 `08ea52f3afd000d8ca7baa6bcff14f4397a4fa56e829cbf112746cbd30832d4f`.

First causal error: `DONOR_EQUALITY_BLOCKED:COLLECTION_FAILED:GIT_COMMAND_FAILED:cat-file:128`. The single-branch clone does not contain dashboard donor object `692501587617d4880303fbd747d93e63c376f088`; `git cat-file -t` exits `128`.

This is builder-side blocked evidence. No independent `CLEAN_CLONE_ACCEPTED` or later token is issued.
