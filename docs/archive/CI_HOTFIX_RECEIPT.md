# CI hotfix receipt — deterministic S4 tracked inventory and clean-clone provenance

- **Status:** `CI_HOTFIX_READY`
- **Authority:** D-LAUNCH-51 in immutable coordination commit `e619ff18ef159c27061cfaf318036e18a4fac131`
- **Branch:** `ci-hotfix-20260716`
- **Assigned base:** `492e3f69b054c85686bcfc4c09dbff4ababeda3f`
- **Assigned-base tree:** `3adef4d97ab595a8c81a307bac8dce22d037abdb`
- **Implementation commit:** `39ec378d4a7584f3c69436ef5c9f105c56bffb16`
- **Tested hotfix HEAD:** `9c9b521a119e1be6e0a1683c9d2f40bac8f4d17c`
**Tested hotfix tree:** `1762d4892c42cf20f50c17e7c64ac48ea12e88f8`

The receipt-only seal commit cannot name its own SHA without rewriting itself. The final worker report supplies that commit from Git. The tested hotfix HEAD above is the exact revision used for both post-fix root gates.

## Base and authority proof

- The worker branch began clean at exact assigned base `492e3f69b054c85686bcfc4c09dbff4ababeda3f`.
- The implementation commit has that base as its sole parent. The provenance-binding commit has the implementation commit as its sole parent.
- The local `current-main` ref advanced separately to coordination-only D-LAUNCH-51 commit `e619ff18ef159c27061cfaf318036e18a4fac131`; this branch was not rebased onto it. No current-main worktree was modified.
- No merge or push was performed. Landing remains director-owned.

## Reproduction and corrected diagnosis

Pre-fix evidence was taken from a fresh `git clone --no-hardlinks` of Main, detached at exact base `492e3f69b054c85686bcfc4c09dbff4ababeda3f`:

| Command | Exit | Measured result |
| --- | ---: | --- |
| `npm ci` | `0` | 229 packages installed; audit reported 0 vulnerabilities |
| `npm test` | `1` | Exact terminal `PRODUCT_ASSURANCE_RUN_FAILED:A_CASE_S4_NINETEEN_NON_CONTEXT_FILES` |

The failing S4 run measured `226` tests, `225` passed, `1` failed. The failed callback was `accepted S1 branch and all pinned contract blobs are recomputed from Git objects` in `s1-provenance.test.mjs`. The clean clone contained the pinned commit object `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` but not the ambient local branch ref `ip-assur-hazard-20260713`.

The reproduction refined the original diagnosis: the base clone and development repository both contained the same 20 tracked S4 test files and the same explicit 19-file non-context run. The named run failed because one of those files required a local branch ref. Separately, the harness inventory walker did use recursive directory enumeration and therefore could admit untracked or ignored `*.test.mjs` files. That second defect would fail earlier as `PRODUCT_ASSURANCE_INVENTORY_INVALID`. This hotfix closes both environment-dependent paths rather than masking either one.

## Correction

1. `listProductAssuranceTrackedTestFiles` now derives suite inventories from the Git index with NUL-delimited `git ls-files --cached --stage --full-name`. It rejects unsafe paths, non-regular modes, duplicate entries, and unmerged stages; untracked and ignored files cannot enter the denominator.
2. The S4 provenance contract now pins the exact ordered 20-file tracked inventory and exact ordered 19-file non-context run instead of asserting only `20` and `19` cardinalities.
3. The existing four-test provenance callback now creates a dirty temporary Git source containing both untracked and ignored S4 decoys, clones it with `--no-hardlinks`, and proves the source and clean clone expose the identical exact tracked inventory. The fixed provenance count remains four.
4. S1 provenance now verifies the immutable accepted commit object, its ancestry to `HEAD`, and every pinned blob/hash. It retains the declared donor-branch identity as metadata but no longer requires that ambient local ref to exist.
5. The donor merge cut remains exact `193/193`. The S1 test correction is explicitly bound as the fourth post-integration replacement: donor blob `cdea2f5a4c5a1517cdd7e16fbb5c1273ac99cdad` to replacement blob `09d8bedb8b88f901f0ec345381205675be41aa9d` in sole-parent implementation commit `39ec378d4a7584f3c69436ef5c9f105c56bffb16`. Current HEAD therefore measures `189` donor-identical blobs plus `4` exact authorized replacements.

## Changed paths

Tested hotfix HEAD versus assigned base changes exactly these four paths:

1. `fixtures/i00/product-assurance-manifest.v1.json`
2. `test/i00/git-provenance.mjs`
3. `test/i00/product-assurance-provenance.test.mjs`
4. `test/productAssurance/systemic/assuranceCase/s1-provenance.test.mjs`

Their sorted newline-terminated path-set SHA-256 is `35e5aa4aae16a8b86127a1eeff9884a1513fde17be59cef373c2c045290e3ac8`.

The receipt seal adds only `docs/archive/CI_HOTFIX_RECEIPT.md`. The final five-path sorted newline-terminated path-set SHA-256 is `9f78d36ef8e8d6ab0f9c29845bc9158c24db984a85b99f45b6afd36efe1799de`.

No product source, UI source, operations code, package definition, root state, architecture, mission, or owner directive changed.

## Verification

Environment: Node `v22.23.1`, npm `10.9.8`, Git `2.50.1` (Apple Git-155), package-lock SHA-256 `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`.

| Environment and command | Exit | Measured result |
| --- | ---: | --- |
| Worktree: `npm run test:product-assurance` | `0` | `801` donor behavior + `1` live replacement = `802`; provenance `4/4`; S4 non-context `226/226`; S4 safe purity `5/5`; operation scan `205/205`, uncovered `0` |
| Worktree: `npm test` | `0` | Typecheck, server/web build, deterministic suites, Product Assurance, and I00 acceptance contract all passed; I00 acceptance contract `43/43` |
| Fresh post-fix `--no-hardlinks` clone: `npm ci` | `0` | 229 packages installed; audit reported 0 vulnerabilities |
| Fresh post-fix clone detached at `9c9b521a119e1be6e0a1683c9d2f40bac8f4d17c`: `npm test` | `0` | Same Product Assurance `802 + 4`; S4 `226/226`; I00 acceptance contract `43/43`; local S1 donor branch ref absent |
| `git diff --check 492e3f69b054c85686bcfc4c09dbff4ababeda3f..9c9b521a119e1be6e0a1683c9d2f40bac8f4d17c` | `0` | No whitespace errors |

## Safety and limitations

- No product logic changed. No order, test order, borrow, repay, transfer, withdrawal, leverage, margin, private exchange, signed exchange, deployment, cloud, credential, or external-state mutation was attempted.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` was not changed and does not appear in the diff.
- `npm ci` performed the dependency reads explicitly required by D-LAUNCH-51. No credentials were supplied.
- This receipt does not claim root tests are free of every public-egress attempt; D-LAUNCH-22 owns that separate pre-existing test-startup defect in another worktree. It claims only the measured exits and S4 correction above.
- `npm run test:all` was not requested for this S4-only harness correction and is not claimed. The relevant focused Product Assurance suite and the required root `npm test` passed in both mandated environments.
- Root product state was not changed. `STATE.md` and `I00_PRODUCT_BUILD_STATE.md` were left untouched under the explicit S4-only scope; the director owns any landing-time state wording reconciliation.
- No remote freshness beyond locally available Git objects is claimed. No fetch, push, merge, tag, or release action was performed.

`CI_HOTFIX_READY`
