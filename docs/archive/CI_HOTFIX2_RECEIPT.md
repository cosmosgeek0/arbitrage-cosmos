# CI hotfix 2 receipt — deterministic sealed evidence in single-branch clones

- **Status:** `CI_HOTFIX2_READY`
- **Authority:** post-landing D-LAUNCH-53 worker directive
- **Branch:** `ci-hotfix-20260716`
- **Assigned landed base:** `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd`
- **Assigned-base tree:** `da836a961d534234dace7f025f18283196854bfe`
- **Implementation commit:** `01be76d47da7d0f4e97ba3fdd348fcfd40f5e3ed`
- **Tested implementation tree:** `f37fd06585534db8186dc10f3ace8aec35926868`

The receipt-only seal commit cannot name its own SHA without rewriting itself. The final worker report supplies that commit from Git. The implementation commit above is the exact revision used for the post-fix worktree and disposable single-branch clone batteries.

## Base and authority proof

- The worker branch was clean and rebased/verified at exact assigned base `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd` before any edit.
- Implementation commit `01be76d47da7d0f4e97ba3fdd348fcfd40f5e3ed` has exact assigned base `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd` as its sole parent.
- The Main repository's local `current-main` later advanced separately to `787b73d108764d628f925ee630bfe2fbef89458e`; the hotfix branch was not rebased onto that later coordination state.
- No other worktree, `current-main`, remote ref, tag, or release state was modified. No merge or push was performed. Landing remains director-owned.

## Mandatory pre-fix reproduction

Before the correction, the exact requested command was run while Main `current-main` was the assigned landed base:

```sh
rm -rf /tmp/ci2 && git clone --no-hardlinks --single-branch --branch current-main file:///Users/cosmosgeek/Desktop/Main/.git /tmp/ci2 && cd /tmp/ci2 && npm ci && npm test
```

Measured result:

| Observation | Result |
| --- | --- |
| clone HEAD | `6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd` |
| `npm ci` | exit `0`; 229 packages; 0 vulnerabilities |
| dashboard donor `git cat-file -e 692501587617d4880303fbd747d93e63c376f088^{commit}` | nonzero; object unavailable in the single-branch clone |
| `npm test` | exit `1` |
| I00 performance/acceptance contract | `42/43`; sole failure was `sealed report parity reads the exact revision from clean detached checkouts` |
| committed rejected-seal machine report | 518650 bytes; SHA-256 `897da1f0266b04c8f1927ae26ebd6285c8307e45f3bdc573f57294041b5acfd6` |
| regenerated machine report | 518653 bytes; SHA-256 `df80ecc40d498aa0b355df785241db7b16aef56ca51234e73fac3b50d9736fe5` |

The raw difference was the expected three-field live-Git drift for donor `692501587617d4880303fbd747d93e63c376f088`: row `commitExists` changed `true → false`, row `passed` changed `true → false`, and aggregate `receiptProvenanceVerification.passed` changed `true → false`. The dependent top-level evidence digest changed with them. Tracked receipt hash and receipt-claim verification remained true.

## Correction

1. Both machine-report parity entry points now parse canonical JSON and validate each raw report's original `evidenceSha256` before projection or comparison.
2. The tracked-content projection removes only environment-dependent receipt observations: aggregate `baseExists`/`passed`; per-row `commitExists`/`ancestorVerified`/`passed`; and `receiptClaimVerified` only for a `COMMIT_CONTAINING_RECEIPT` row whose claim cannot be evaluated without its commit object. The dependent top-level digest is omitted only after it is validated.
3. Every living-input, repin, observed hash, fixture, receipt hash, and non-live-Git machine-evidence field remains exact. The committed snapshot was not rewritten.
4. Live receipt provenance remains a separate tri-state runtime gate:
   - `VERIFIED` only when available objects and ancestry prove the report;
   - `UNKNOWN` with `passed: null` when a required provenance object is locally unavailable;
   - `FAILED` for malformed observation types, tracked receipt/hash failure, an available-object mismatch, or conclusively disproved ancestry.
5. The regression constructs a fresh bare file-transport source with only `HEAD` published as `current-main`, clones it with `--no-hardlinks --single-branch --branch current-main --no-tags`, directly proves the non-ancestor donor object is absent, and reruns rejected-seal parity from that restricted object store. It uses no prune, clean, or garbage collection.
6. The five Markdown reports remain exact-byte comparisons. Machine parity is explicitly labeled `TRACKED_CONTENT_CANONICAL_V1`, while raw hashes and lengths remain visible.

The implementation follows current official Git semantics: [`--single-branch`](https://git-scm.com/docs/git-clone#Documentation/git-clone.txt---single-branch) limits fetched history to the selected branch; [`git cat-file -e`](https://git-scm.com/docs/git-cat-file#Documentation/git-cat-file.txt--e) reports local object availability; and [`git merge-base --is-ancestor`](https://git-scm.com/docs/git-merge-base#Documentation/git-merge-base.txt---is-ancestor) distinguishes exit `1` (conclusively not an ancestor) from other errors. Node child-process status, signal, and start failure are retained separately under the [official child-process contract](https://nodejs.org/api/child_process.html).

## Changed paths

Implementation commit versus assigned base changes exactly these four paths:

1. `STATE.md`
2. `test/i00/performance/README.md`
3. `test/i00/performance/acceptance-contract.test.mjs`
4. `test/i00/performance/local-acceptance.mjs`

Their sorted newline-terminated path-set SHA-256 is `438df8c194b8970e5293feaa194271a1865a1c61c34c99df35239d276d2e0b7e`.

The receipt seal adds only `docs/archive/CI_HOTFIX2_RECEIPT.md`. The final five-path sorted newline-terminated path-set SHA-256 is `35afa2b08470d3f37f6b0db8dc0be643dff28e92b35b2be071ade73ce785d1da`. No product source, UI source, fixture, committed report snapshot, package definition, owner directive, mission, or architecture file changed.

## Post-fix verification

Environment: Node `v22.23.1`, npm `10.9.8`, Git `2.50.1` (Apple Git-155), package-lock SHA-256 `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.

| Environment and command | Exit | Measured result |
| --- | ---: | --- |
| Worktree: `npm run test:i00:acceptance-contract` | `0` | `44/44`, including both sealed-parity tests |
| Worktree at exact implementation commit: `npm test` | `0` | Typecheck/build; Basis `107/107`; Volume `124/124`; financial safety `59/59`; storage/config/AWS `29/29`; Product Assurance `802` behavior + `4` provenance with `205/205` operation coverage; I00 acceptance `44/44` |
| Disposable post-fix source: bare fetch of exact implementation HEAD as sole `refs/heads/current-main` | `0` | source and clone contained only local/remote `current-main`; no tags |
| Disposable post-fix clone: `git cat-file -e 692501587617d4880303fbd747d93e63c376f088^{commit}` | `128` | donor object genuinely absent |
| Disposable post-fix clone: `npm ci` | `0` | 229 packages; 0 vulnerabilities |
| Disposable post-fix clone at exact `01be76d47da7d0f4e97ba3fdd348fcfd40f5e3ed`: `npm test` | `0` | Same root gate and Product Assurance counts; I00 acceptance `44/44` |
| Direct restricted-source parity receipt | `0` | five Markdown artifacts raw-exact; machine raw mismatch preserved; both canonical SHA-256 values `90d84e488f27dc3f80b8f001c58c2cfaa992a4b3c052c27971b958f67732a42`; diagnostic `UNKNOWN`, `passed: null`; both historical checkouts detached and clean |
| `git diff --check 6c6d1edd3e7bd7aecb3330d4cca3df087659f5dd..01be76d47da7d0f4e97ba3fdd348fcfd40f5e3ed` | `0` | no whitespace errors |

## Director landing gate

The hard-coded post-fix command against `/Users/cosmosgeek/Desktop/Main/.git` cannot select this unlanded worker commit without moving or merging `current-main`, which this worker is expressly forbidden to do. The disposable source above gives the hotfix commit the exact `current-main` single-branch transport topology and proves the required root exit `0` with the donor object absent.

After landing, the director must rerun the exact requested command against the landed Main `current-main`:

```sh
rm -rf /tmp/ci2 && git clone --no-hardlinks --single-branch --branch current-main file:///Users/cosmosgeek/Desktop/Main/.git /tmp/ci2 && cd /tmp/ci2 && npm ci && npm test
```

This receipt does not claim that director-only post-landing observation before the landing exists.

## Safety and limitations

- No product logic changed. No live/test order, borrow, repay, transfer, withdrawal, leverage/margin mutation, private exchange read, signed exchange call, deployment, cloud mutation, or credential use occurred.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains unchanged.
- No protected owner input was created, copied, edited, staged, or committed.
- No committed proof snapshot or fixture was rewritten to match the current environment.
- No Git reset, clean, prune, merge, push, remote-network fetch, tag, or release action was performed.
- The root `npm test` gate requested by D-LAUNCH-53 passed in both the clean worker worktree and a genuine refs/object-restricted single-branch clone.

`CI_HOTFIX2_READY`
