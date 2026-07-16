# Clean Clone Acceptance Evidence

Status: `INTEGRATED` Account-A Pass-0 evidence.

Later `CLEAN_CLONE_ACCEPTED` gate: `BLOCKED` pending Account B and the complete Pass-3 classes.

## Identity and topology

- Candidate: `41752d6a87dc1cb1b933bb4460c9cabfc15ff694`.
- Tree: `a770f9f393e6229252731cd5247e9a1abfd2e509`.
- Clone: `/Users/cosmosgeek/Desktop/product-truth-clean-clones-20260716/account-a/41752d6a87dc1cb1b933bb4460c9cabfc15ff694/repo`.
- Source: `file:///Users/cosmosgeek/Desktop/truth-a` with `--no-local --single-branch --branch truth-campaign-20260716 --no-tags`, followed by detached checkout of exact C.
- Repository: non-shallow, 544 reachable commits, no tags, no object alternates, one candidate branch/ref only, no `current-main` ref.
- Final Git state: detached at C, clean tracked/untracked status, tree exact.

## Commands and results

| Command/action | Start UTC | End UTC | Exit | Result |
|---|---|---|---:|---|
| fresh single-branch clone and detached exact-C checkout | `2026-07-16T11:17:11Z` | `2026-07-16T11:17:27Z` | 0 | `INTEGRATED` topology proof |
| `npm ci` | `2026-07-16T11:17:27Z` | `2026-07-16T11:17:30Z` | 0 | 229 packages, 0 vulnerabilities |
| `npm test` | `2026-07-16T11:17:37Z` | `2026-07-16T11:18:43Z` | 0 | root deterministic command passed |

Observed suite counts: Basis `107/107`; Volume `124/124`; financial safety `59/59`; storage/config/AWS `29/29`; focused Node `51/51`; stream lifecycle `14/14`; perimeter `2/2`; Product Assurance `802` behavior plus `4` provenance with 555 production files and `205/205` covered operation sites; I00 acceptance contract `44/44`. Deterministic egress recorded 0 forbidden attempts across 111 installs, 99 processes, and 111 execution contexts.

## Exact limitations

- This is Account-A builder evidence, not independent `VERIFIED` evidence.
- Hosted CI declares `ubuntu-latest`; this run used macOS 26.5.2 arm64, so it is command-equivalent, not environment-equivalent.
- Raw top-level clone/install/test stdout was not retained. Surviving command transcript and child exits support the result, but this deviation is explicit.
- Full Pass 3 remains `BLOCKED`: quant environment/suites, exact-C browser light/dark gates, backup/restore/release/rollback, composed-runtime classes, and Account-B repetition were not executed here.
- `.nvmrc` pins Node major 22, not an exact patch.
- The local clone origin is mutable; future independent reproduction should use the complete bundle and detach exact C.

## Receipt fields

- Environment/toolchain: macOS 26.5.2 arm64; Node `v22.23.1`; npm `10.9.8`; Git `2.50.1 Apple Git-155`.
- Environment/toolchain digest: `8261c1fcbc27b3a2384abc506a285768333d4f4d5350fec83cd5364211a763ca`.
- Dependency lock SHA-256: `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.
- Artifact hashes: `MANIFEST.sha256` is generated last and excludes itself.
- Actor: `ACCOUNT_A`; candidate source write permission during this acceptance run: `false` after C freeze.
- Skips/unavailable evidence: listed above; no Account B artifact was read.
