# Unmerged Delta Report

Status: `INTEGRATED` for candidate-source containment and Pass 0; Account-B exact-C verification remains `BLOCKED`.

Candidate: `41752d6a87dc1cb1b933bb4460c9cabfc15ff694`

The authoritative denominator is `WORKTREE_CENSUS.json` over all 101 worktrees registered by `/Users/cosmosgeek/Desktop/Main`.

| Classification | Count | Ruling |
|---|---:|---|
| `ACTIVE_DIRTY` | 0 | No active dirty source writer remains. |
| `SEALED_UNMERGED` | 0 | Every mandatory sealed admission has an exact C disposition. |
| `MERGED_RETAINED` | 42 | Candidate, landed core, and admitted donor vessels are retained. |
| `BLOCKED` | 6 | `truth-b` remains at pre-freeze `787b73d…`; five D-LAUNCH-61 read-only shards are detached at exact C with zero tracked/source changes. Authorized untracked advisory outputs are preserved and censused. None has candidate-write or acceptance authority. Filenames and Git metadata were censused; Account A did not read verifier reasoning or artifacts. |
| `SUPERSEDED_SAFE` | 33 | Includes CI hotfix #2 as `REFERENCE_ONLY`. |
| `ABANDONED_SAFE` | 20 | Frontier/scout work remains parked and excluded. |
| `DUPLICATE_PATCH` | 0 | No exact duplicate delta identity was found. |
| `UNKNOWN` | 0 | Gate condition satisfied. |

Tracked source dirt is zero. Preserved untracked inputs are enumerated per tree and per path in the census; none is admitted silently. No worktree was cleaned, pruned, reset, or deleted.

The 12 admitted post-Main lanes have 326 unique changed paths, zero cross-lane overlaps, zero grant violations, and 326/326 exact donor blobs at C. `MERGE_PROVENANCE.json` is the machine-readable proof.

## Receipt fields

- Command/operator action: `git -C /Users/cosmosgeek/Desktop/Main worktree list --porcelain -z`, per-tree Git status, ancestry, receipt, and diff identity probes.
- Environment/toolchain digest: `8261c1fcbc27b3a2384abc506a285768333d4f4d5350fec83cd5364211a763ca`.
- Dependency lock SHA-256: `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.
- Start/end UTC: the exact census timestamps are stored in `WORKTREE_CENSUS.json`.
- Exit code: `0`; test count: `101/101` worktree records.
- Artifact hashes: `MANIFEST.sha256` is generated last and excludes itself.
- Actor: `ACCOUNT_A`; candidate source write permission after freeze: `false`.
- Deviations/skips/unavailable: Account B filenames only; no Account B content read; no destructive worktree action.
