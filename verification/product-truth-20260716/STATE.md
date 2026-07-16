# Product Truth Campaign State

Pass-0 status: `INTEGRATED`

Next-gate status: `BLOCKED` — Account B exact-C verification

Actor: `ACCOUNT_A`

Gate: `BASELINE_TRUTH_ACCEPTED:41752d6a87dc1cb1b933bb4460c9cabfc15ff694`

This file is the sole campaign-status authority. Root `STATE.md` at candidate C is the current product-state authority.

## Frozen source candidate

- Candidate C: `41752d6a87dc1cb1b933bb4460c9cabfc15ff694`.
- Candidate tree: `a770f9f393e6229252731cd5247e9a1abfd2e509`.
- Candidate parent: `f11531e6637979d6e173f6eb25d04c10a76d20c8`.
- Branch: `truth-campaign-20260716`.
- Durable Main observed at candidate freeze: `2ae812624f20b9bc93fc4ad66cb568929101110f`.
- D-LAUNCH-61 director custody receipt: `b4d9f22d3732003f2cc5cec1f11a87833a933209`, whose parent is the freeze-time Main and whose source scope is only `QL_DIRECTOR_STATE.md` plus `WORKER_PROMPTS.md`.
- Custody/evidence head: `d2c4f43caf9ad7a84cfde8da8760cc9895384538`; it is not a replacement candidate.
- Source C is immutable. Every later commit is evidence-only and may change only `verification/product-truth-20260716/**`.
- The custody push did not merge C to `current-main`. Later director-only coordination commits advanced `current-main` after custody; they are not candidate inputs and do not change C.

## Pass 0 state

- §2.1 contradictions: `9/9` explicitly dispositioned; none is `UNKNOWN`.
- Worktrees: 101 registered; `UNKNOWN=0`; `ACTIVE_DIRTY=0`; `SEALED_UNMERGED=0`; unexplained tracked source dirt `0`. The five post-freeze D-LAUNCH-61 shards are detached at exact C, read-only toward candidate source, and non-binding advisory preparation pending independent adjudication; they have no candidate-write or acceptance authority.
- Donors: 12 admitted post-Main lanes; 326 unique paths; 326/326 exact donor blobs at C; zero overlaps and zero grant violations.
- Landed core: 1,687-path denominator; 1,666 donor-identical at C; all 21 adaptations are explicit.
- AI-Ops: `INTEGRATED` source, 161 exact paths; runtime/product/paging states remain separately `NOT_CONFIGURED` or `UNWIRED`.
- A-FORMAL: `INTEGRATED`; runtime `REFERENCE_ONLY`; TLA execution `NOT_CONFIGURED`.
- S2 action evidence: `INTEGRATED`; supporting-only; production consumer `NOT_CONFIGURED`.
- Ledger CAS/read inventory: `WIRED_LOCAL`; production append producer `NOT_CONFIGURED`; no send authority.
- Quantity bridge: `INTEGRATED` comparison contract; production consumer `NOT_CONFIGURED`; no action authority.
- Exact-C clean clone: Account-A `npm ci` and `npm test` exits 0; later independent/full Pass-3 gate `BLOCKED`.
- Off-machine custody: `SEALED` at GitHub `refs/heads/truth-campaign-20260716` = `d2c4f43caf9ad7a84cfde8da8760cc9895384538`; a fresh single-branch bare clone contains exact C, proves C ancestry, and passes `git fsck --full --strict`.

## Pass 0 custody resolution

The D-LAUNCH-61 director custody receipt confirms and durably records the completed off-machine custody through the GitHub campaign ref. Independent `ls-remote` and fresh-clone checks resolve that ref to `d2c4f43caf9ad7a84cfde8da8760cc9895384538`; exact C is its ancestor, and both post-C commits change only campaign evidence.

The separate full-repository bundle `/Users/cosmosgeek/cosmos-arbitrage-backup-20260716.bundle` is a supporting local recovery artifact: SHA-256 `775c55d26474578100b03d0cb45575b9cf95cc6ab012c709c963e4dd6b8ffe37`, 154,783,860 bytes, `git bundle verify` exit `0`, complete history, 388 advertised refs. It is not described as off-machine.

All Pass-0 duties are now explicitly dispositioned with zero `UNKNOWN`, so Account A issues only `BASELINE_TRUTH_ACCEPTED:41752d6a87dc1cb1b933bb4460c9cabfc15ff694`. No later token is implied or issued.

## Later gates

- Account B fresh exact-C provenance and independent verification: `BLOCKED`, ready for handoff.
- Canonical cockpit independent browser truth: `BLOCKED`.
- Composed runtime and soak: `BLOCKED`.
- Staging, sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private/signed bring-up: `DEFERRED_OWNER_GATE`.
- Test-order/canary capability: `NOT_CONFIGURED`.
- Forward economic edge: `ABSTAIN_UNKNOWN`.

## Exact next action

Hand only exact candidate C — never evidence head `d2c4f43…` — to a brand-new clean Account-B verifier. The five D-LAUNCH-61 read-only shard outputs remain advisory/non-binding until adjudicated. Account A waits for exact-C findings and may not issue `PROVENANCE_ACCEPTED`, `CLEAN_CLONE_ACCEPTED`, `VERIFIED_ACCEPTED`, or any later token.

## Receipt fields

- Command/operator action: D-LAUNCH-61 Account-A custody verification, 101-worktree census refresh, and Pass-0 reassessment; no source mutation after C.
- Environment/toolchain digest: `8261c1fcbc27b3a2384abc506a285768333d4f4d5350fec83cd5364211a763ca`.
- Dependency lock SHA-256: `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.
- Start/end UTC: `2026-07-16T12:16:57Z` / `2026-07-16T12:17:05Z` for custody probes; the refreshed census has its own timestamps.
- Exit code: `0`; custody verification probes `10`; new test count `0`; the earlier exact-C clean-clone root test remains exit `0` in `CLEAN_CLONE_ACCEPTANCE.md`.
- Artifact hashes: `MANIFEST.sha256` is generated last and excludes itself.
- Actor: `ACCOUNT_A`; source write permission after C freeze: `false`.
- Deviations/skips/unavailable: Account B material not read; the local bundle is supporting rather than off-machine evidence; later director coordination moved `current-main` without merging C; an auxiliary audit imported a bundle pack into the shared Git object database without changing refs/index/worktrees; independent/runtime/staging/private/money gates are not claimed.
