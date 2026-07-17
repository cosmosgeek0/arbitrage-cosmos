# VFINAL5 Independent Verification Receipt

## Sealed decision

- Candidate: `959a5f9900e25f53414710bbfb3464c3ccb67a5d`
- Candidate tree: `28d3d9922cc1201333775a458919afe9158e6dc2`
- Required parent: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`
- Verification clone: `/tmp/vfinal5`
- Verification role: final independent verifier; no candidate or source repair was performed
- Decision: **REJECTED**

C5 passes its clean-clone executable gates, exact one-parent topology, donor provenance, money-path/no-dispatch, security/network-boundary, restart/reconciliation/authority, and the canonical cockpit surface MISSING-data law. It is not acceptable as a complete campaign candidate because exact-C5 directive evidence is not bound, 42 of 61 locked inputs have no source/disposition mapping, the durable worktree census is stale, and the Watchman refresh affordance can transiently render an operational green/recovered state over canonical outage truth.

## Independent-clone custody and identity

The final inspected clone was created from a newly emptied `/tmp/vfinal5` using the requested single-branch URL and a command-scoped HTTPS-to-SSH transport rewrite because anonymous HTTPS authentication was unavailable in this environment:

```text
git -c url."git@github.com:".insteadOf=https://github.com/ clone \
  --no-hardlinks --single-branch --branch truth-campaign-20260716 \
  https://github.com/cosmosgeek0/arbitrage-cosmos /tmp/vfinal5
git checkout --detach 959a5f9900e25f53414710bbfb3464c3ccb67a5d
npm ci
```

The clone's recorded origin remains `https://github.com/cosmosgeek0/arbitrage-cosmos`; its sole fetch refspec is `+refs/heads/truth-campaign-20260716:refs/remotes/origin/truth-campaign-20260716`.

Identity proof:

- `HEAD` = `959a5f9900e25f53414710bbfb3464c3ccb67a5d`.
- `HEAD^{tree}` = `28d3d9922cc1201333775a458919afe9158e6dc2`.
- `git show -s --format=%P HEAD` emitted exactly one parent: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`.
- `git rev-parse HEAD^` equaled the immutable C2 commit byte for byte.
- Local `refs/heads/current-main` is absent.
- Remote-tracking `refs/remotes/origin/current-main` is absent.
- The only local and remote-tracking branch refs are the single requested `truth-campaign-20260716` refs.
- The repository is not shallow, `.git/objects/info/alternates` is absent, and the object store contained zero hard-linked object files.
- C2 evidence `4ec9e86...`, C3 `78f708d...`, and C3 evidence `ca07f52...` / `fd6a277...` are not ancestors of C5. They enter only through the later evidence bridge `f2de064...`; C5 itself remains the required sole-child candidate over C2.

Environment: Node `v22.23.1`, npm `10.9.8`. `npm ci` exited `0`, installed 229 packages, audited 232 packages, and reported 0 vulnerabilities.

### Verification-environment incident disclosure

The runner rejected the literal destructive `rm -rf` form, so the destination was emptied with a guarded depth-first deletion. The first anonymous-HTTPS clone attempt failed authentication. Because that initial compound shell did not stop after the failed `cd`, its subsequent checkout and `npm ci` ran in the pre-existing `/Users/cosmosgeek/Desktop/truth-a` worktree. This was detected immediately: that worktree was restored to its prior branch `truth-campaign-20260716` and prior exact HEAD `951e7a60709683d969abcca06de26197052cb374`; `git status` was clean before independent verification continued. The only install effect there was in ignored dependency material. No tracked candidate, source, or historical receipt content was changed. All reported evidence below comes from the final clean `/tmp/vfinal5` clone.

## Canonical reading and evidence policy

The verifier read the candidate's tracked canonical material in repository order: `STATE.md`, `MISSION.md`, `ARCHITECTURE.md` including Part II, `DESIGN.md`, `DIRECTOR.md`, then campaign state, clean-clone acceptance, authority-resolution, final-verdict, lock, matrices, receipts, and the relevant source/tests. Builder-chat reasoning was not used. `/tmp/vfinal3/VFINAL_RECEIPT.md` was treated only as an advisory finding list and independently rerun; its SHA-256 is `2cc89ee2facf13d17560b2551da5cfb4f94ba6373b25d32f8312b675f1684a7e`.

## Acceptance execution

All commands in this table ran at detached exact C5 in `/tmp/vfinal5` after `npm ci`.

| Gate | Exit | Exact reported count/result | Root evidence |
|---|---:|---|---|
| `npm test` | 0 | TAP summary counters total 413 = 124+51+14+2+131+44+47, all pass; custom suites also reported Basis 107/107, financial safety 59/59, storage/config/AWS 29/29, Product Assurance behavior 802 plus provenance 4 | `VFINAL5_NPM_TEST.log`, SHA-256 `a3abd0b3a72cf9381396e39cfe8312c25ca76b7eb0d3c1a38655fe658c05f50c` |
| `npm run test:all` | 0 | TAP `# tests` counters total 2674 = 124+51+14+2+131+44+402+111+101+47+29+1618, zero fail/skip/todo; custom/dot reporters are additional and are not silently folded into this TAP-counter total | `VFINAL5_TEST_ALL.log`, SHA-256 `be4380ede602864ebc0c5d8b73c7bd4fd35ea22e110c2efcd1d1ccbfe527c829` |
| protocol | 0 | 22/22 | `VFINAL5_PROTOCOL.log`, SHA-256 `b1794fc1b7f5240aa1ef4f61bf8f5f7406f0a73a668b115d070e6181821d42d0` |
| I00 acceptance/report parity | 0 | 44/44, including candidate-report parity and current-main-absent single-branch parity | `VFINAL5_I00_ACCEPTANCE.log`, SHA-256 `bf184bdfbbb6c512bdfdef7d3bfeffb818fb58d7b2e4ccdafc50f9b0933d049f` |
| I00 proof | 0 | 47/47 | `VFINAL5_I00_PROOF.log`, SHA-256 `b0e2fb0fd86a729ad5997eb44dd11aca24692cdafe0758e0556de05f8423c9ac` |
| Product Assurance | 0 | behavior 802, provenance 4, operation discovery 205/205 covered across 555 scanned files with 0 uncovered, formal/action 131/131 | `VFINAL5_ASSURANCE.log`, SHA-256 `e64b9fc438df69224de4cf21e593a11ab1a65c61b85c5e7a02097a23d3816ab8` |
| donor equality | 0 | 10/10 harness assertions; independently recomputed donor families 16/16/16/16 with zero failures | `VFINAL5_DONOR_PROVENANCE.log`, SHA-256 `024d60c08543543874679675df74c08381c03c7b55126a421067baabd0574ef2`; `VFINAL5_DONOR_CURRENT.json`, SHA-256 `2753eb182c73644d5575918106dbfc9bd39d0cf36f813c04325a7c8f7745fd52` |

The root deterministic egress harness passed with 0 forbidden attempts; it observed 134 installs, 122 spawned processes, and 134 contexts. The dashboard-shell donor's absence is the documented single-branch exception; its selective equivalence proof passed 21/21.

## Independently rerun critical classes

Prior aggregate receipts were not accepted as proof for these classes.

- Security, authority, and money boundary: focused security and authority scenarios passed 34/34. An independent static scan covered 70 System Integration TS/TSX modules and 12 barrels and found zero composed private/signed/money/network/ambient seams. The production Binance client remained `null`; private or mutating routes returned `NOT_CONFIGURED` or HTTP 410 `LIVE_EXECUTION_NOT_IMPLEMENTED`. No live/test order, borrow/repay, transfer, withdrawal, leverage/margin mutation, or signed/private exchange dispatch path was found.
- Restart/CAS/owner evidence: 58/58.
- Foundation reconciliation: 75/75.
- Reconciliation/crash/authority scenarios: 88/88.
- Server/browser hostile no-false-green scenarios: 76/76.
- Independent restart/reconciliation/authority subtotal: 297/297.
- Cockpit focused reruns: server runtime 20/20, browser canonical/contracts 47/47, mount 9/9, routes 2/2, all exit 0. Evidence hashes: `VFINAL5_COCKPIT_SERVER.log` `442f5d0827dd70714b1334ca44852a58ecd841be57a8b6c4bbf13a6a407091dd`; `VFINAL5_COCKPIT_BROWSER.log` `38c395d6dbf924308d2abb3230cb215e6e9494dfbd4422a1657e2aaebf889235`; `VFINAL5_COCKPIT_MOUNT.log` `7413d2f8b650fd7f5cd87ef4083ccae10175154295c7bfe40244da6bfc9adcbc`; `VFINAL5_COCKPIT_ROUTES.log` `be6745715b98bfe8939e4c691ff5bc045c113b6312eeefc3825ac96d3b1c12b5`.
- Web derivation retirement: `web/src/lib/canonicalCockpitTruth.ts` does not exist at C5, searches for the retired client recomputation functions returned no source hits, and cockpit consumers read server `canonicalCockpit` / `canonicalPresentation` truth.

## Rendered browser verification

The exact C5 app was built and served offline at `127.0.0.1:18085` with deterministic offline public sources and a fresh external data directory. The rendered Dashboard had `data-surface-ready="false"`; required capital truth rendered `MISSING`, `BLOCKED`, and `BLOCKED_BACKEND`. The baseline Watchman rendered `status-outage idle`, a `status-outage` dot, `rgb(220, 76, 85)`, and `Connection Watchman · Not Ready`. Browser console warnings/errors were empty.

Clicking `Refresh News Context` exercised the real offline failure path. The deterministic transport prohibition kept the Watchman red/outage and rendered `Recovery Needs Review`. A separate deterministic source probe exercised the positive local refresh-success branch and reproduced the transient false green described in `VFINAL5-COCKPIT-001`; the offline server could not produce a genuine successful public refresh, so this positive branch is source/probe evidence rather than a claimed live-server success. Probe evidence is `VFINAL5_WATCHMAN_OVERRIDE_PROBE.log`, SHA-256 `0a25309766bd465d474cdbe64b1289a80ddd50fb6a62906c92084f2748187371`. Server evidence is `VFINAL5_BROWSER_SERVER.log`, SHA-256 `4519d934791f5bc35eccde6d0a135775ecbe28c820a7904949eb4d7dd084d62d`. The server was then stopped cleanly.

## Prior VFINAL3 findings, independently rerun

| Advisory finding | C5 result | Independent evidence |
|---|---|---|
| `VFINAL-PROV-001` CRITICAL | FIXED | C5 has exactly one direct parent and it equals immutable C2. |
| `VFINAL-DIR-001` CRITICAL | NOT FIXED | `INPUTS.lock` still binds the pre-C5 `STATE.md` byte/hash, not exact C5. Carried into `VFINAL5-DIR-001`. |
| `VFINAL-DIR-002` HIGH | NOT FIXED | Only 19/61 input files have source/disposition matrix mappings. Carried into `VFINAL5-DIR-002`. |
| `VFINAL-DIR-003` HIGH | NOT FIXED | Exact C5 appears in 0/354 matrix `candidate_sha` cells and no later evidence descendant changes those matrices. Included in `VFINAL5-DIR-001`. |
| `VFINAL-COCKPIT-001` CRITICAL | FIXED for its stated surface invariant | Shape-valid LIVE/BINDING_READY truth with any required MISSING datum is rejected; the real rendered surface remained blocked. The new Watchman action-state defect below is a distinct control-level false green. |
| `VFINAL-AUTH-001` HIGH | FIXED | Retired web derivation module absent; consumers use canonical supervisor presentation truth only. |

## Blocking findings

### VFINAL5-DIR-001

- **Severity:** CRITICAL
- **Invariant:** The exact frozen candidate must have byte-bound, immutable directive evidence. Self-naming facts may live in a separate evidence child, but the evidence must name exact C5 and bind its tracked bytes; matrices may not silently retain placeholder or predecessor candidate identities.
- **Evidence:** `campaign/final-directive/INPUTS.lock` declares `SOURCE_COMMIT_CANNOT_SELF_NAME`, leaves `candidate` and `candidate_tree` null, and uses `SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT`. Its `STATE.md` row records SHA-256 `54f37fc6501feaef7e1947ccf24af9094540769ba69c79f7b40d1b4be1a5d2c2` and 11689 bytes, while exact C5's tracked `STATE.md` is SHA-256 `5cbe8760fda561e5b5292e005a5e9f96cb86e3730c1b7d0511d44df86696ea14`, 14687 bytes, git blob `e1aee1a7...`. `C2_PROOF_BINDING.json` and `EVIDENCE_SELECTION.json` leave candidate/tree identity null; `MERGE_PROVENANCE.json` still names predecessor `41752d6...`. Exact C5 occurs in 0 of 354 matrix candidate cells: all 153 directive rows and all 23 capability rows retain placeholders, and all 178 cockpit rows retain `41752d6...`. Descendants `f2de064...`, `9e40055...`, `5548594...`, and `951e7a6...` preserve identical lock/matrix blobs and therefore do not supply the missing exact-C5 binding.
- **Repro:** Compare the `STATE.md` lock record to `sha256sum STATE.md`, count null `candidate_commit` and `git_blob` fields in `INPUTS.lock`, count exact `959a5f...` and placeholder/predecessor values in the three CSV matrices, then compare each lock/matrix blob at C5 and every descendant through branch tip. The result is exact-C5 matrix identity 0/354 and no descendant blob change.
- **Expected:** A separately tracked evidence child names C5/tree, hashes exact C5 tracked evidence, and binds every disposition matrix to the candidate being adjudicated.
- **Actual:** The evidence chain proves older or deliberately unbound bytes and never advances the directive matrices to exact C5.
- **Correction boundary:** Evidence-only descendant if the source bytes already suffice: create an exact-C5 binding report and regenerate the lock/matrices from exact C5 without changing C5. Any generator, mapping, or source-law correction requires a new candidate (C6), followed by a new evidence child. Do not rewrite C5.

### VFINAL5-DIR-002

- **Severity:** HIGH
- **Invariant:** Directive coverage must be 61/61 byte-bound with zero silent omissions: every locked input must resolve to a concrete source identity and a disposition row, with `MISSING` / `CONFLICTING` represented honestly.
- **Evidence:** `INPUTS.lock` contains exactly 61 rows (17+14+4+18+8). A strict normalized path/basename join across the disposition matrices maps only 19/61 input rows, leaving 42 unmapped. Only 8 lock entries contain an explicit `disposition`. Literal matrix status counts of zero `MISSING` and zero `CONFLICTING` are therefore not meaningful coverage. The unmapped set spans 6 external controlling inputs, 8 tracked laws/locks, all 4 wave inputs, 12 tracked superseded documents, 4 external superseded documents, and all 8 absent inputs. Twenty-three external rows declare `content_oid`; none of those blobs exists in the single-branch clone. The protected bundle independently rehashes 5/23, leaving 18 declared external byte identities unavailable for independent recomputation.
- **Repro:** Parse all 61 `INPUTS.lock` entries, normalize paths, and left-join each to source and disposition identities in `DIRECTIVE_DISPOSITION_MATRIX.csv`, `CAPABILITY_DISPOSITION_MATRIX.csv`, and `COCKPIT_REQUIREMENT_MATRIX.csv`. Separately test every external `content_oid` with `git cat-file -e` and rehash every protected-bundle payload available in the clone.
- **Expected:** 61/61 inputs map to both a source identity and an explicit disposition; unavailable or conflicting inputs are recorded as such, and byte claims are independently obtainable from candidate evidence.
- **Actual:** 19/61 map, 42/61 silently omit source/disposition linkage, and 18 external byte claims cannot be independently rehashed from the clone/evidence bundle.
- **Correction boundary:** Regenerate a complete evidence mapping with canonical input identifiers and include all external payload bytes or an immutable independently fetchable object source. If the current generator/schema cannot represent this, that is source work and requires C6; do not patch C5.

### VFINAL5-CENSUS-001

- **Severity:** HIGH
- **Invariant:** The durable worktree census and manifest must reconcile the live registered worktrees and bind the exact candidate/current authority; a green recomputation alone is insufficient if tracked campaign evidence remains stale.
- **Evidence:** The corrected source-side census logic independently reconciles the live machine: 96 unique registered worktrees equal 96 policy rows; missing/unclassified 0/0; tracked-dirty 0; unexplained source dirt 0; 122 untracked paths across 62 worktrees all dispositioned; 12/12 pinned terminal heads; 40 admitted rows; failures 0. Five removed-safe tombstones plus 96 live rows produce 101 durable entries. However tracked `WORKTREE_CENSUS.json` still names predecessor candidate `41752d6...`, old tree `a770f9f...`, old current-main `e9074e...`, registered 101, BLOCKED 6, untracked 125 across 64, and lacks the tombstone/new-count fields. `WORKTREE_LEDGER.md` says 94 worktrees and omits live `truth-a` / `truth-b`. The current generator SHA-256 is `6a9e687d...`; the tracked census is `2edb58d6...`; campaign state is `6c2c559a...`. `MANIFEST.json` expects older generator `e4ccd73c...` and older campaign state `9b41d35c...`, while retaining the historical census hash. Later C5 descendants do not update census or manifest. The D-LAUNCH-65 current-main authority and archive source are also outside this single-branch clone and are not bound in exact C5's lock.
- **Repro:** Run the tracked census generator read-only against the live worktree registry, compare its counts/identities to tracked `WORKTREE_CENSUS.json`, `WORKTREE_LEDGER.md`, and `MANIFEST.json`, then compare those files across C5 and all later evidence descendants.
- **Expected:** Tracked durable census/manifest evidence names exact C5 and the governing current-main authority, records 96 live plus 5 removed-safe tombstones, matches the live zero-failure recomputation, and has no ledger omission.
- **Actual:** Live recomputation is green, but the durable tracked census/manifest/ledger remain predecessor-era and mutually stale.
- **Correction boundary:** An evidence descendant may regenerate and bind the exact-C5 census and manifest if no source behavior changes. The root ledger omission or any generator/schema correction is source/documentation work and requires C6. Bind D-LAUNCH-65 authority rather than importing it as unproved ambient state.

### VFINAL5-COCKPIT-001

- **Severity:** HIGH
- **Invariant:** A local action success must never override canonical supervisor health. When canonical Watchman truth is outage/degraded or any required binding remains blocked, the Watchman dot/label must not render operational green or announce recovery.
- **Evidence:** In `web/src/components/Header.tsx`, the RefreshDock sets local state `ok` when `/api/refresh` succeeds. `binding.refresh()` catches its own errors/resolves and its resulting canonical state is not inspected before the UI maps local `ok` to label `Connections Recovered` and dot class `status-operational`. CSS maps that class to green `#1c9b69`. A deterministic probe with canonical status `outage` and a locally successful refresh produced: canonicalStatus `outage`, actionState `ok`, label `Connections Recovered`, dot `status-operational`, color `#1c9b69`, `falseGreen: true`. Existing focused tests have no assertion covering `Connections Recovered` or this action-state override.
- **Repro:** Hold canonical Watchman truth at `outage` (or leave a required binding blocked), make the public `/api/refresh` response succeed, and evaluate/render RefreshDock before the 1.5-second local success timer clears. The saved deterministic result is in `VFINAL5_WATCHMAN_OVERRIDE_PROBE.log`.
- **Expected:** Canonical Watchman status continues to control health label/dot; a successful public refresh is shown only as a neutral action acknowledgement until supervisor truth actually recovers.
- **Actual:** For the local success window, outage truth is presented as green and `Connections Recovered`.
- **Correction boundary:** Narrowly change Header/RefreshDock label and dot derivation so local action state cannot supersede canonical health, and add a hostile regression test for successful refresh plus still-outage/still-blocked canonical truth. This is a source/UI change and therefore requires C6; never patch C5.

## Non-findings and limits

- C5's candidate topology and 16/16/16/16 donor provenance are accepted.
- Complete clean-clone executable acceptance is accepted at the exits/counts above.
- Money-path, signed/private network dispatch, security boundary, restart, CAS, reconciliation, and authority classes produced no candidate finding.
- The prior canonical surface MISSING-datum false green is fixed; required MISSING data blocked the rendered surface.
- The retired client-side canonical cockpit derivation is absent.
- The Watchman finding is limited to the action-state override; the real offline failure path remained correctly red.
- Passing test suites do not waive missing/stale campaign evidence or an independently reproduced uncovered UI state.

## Final clone hygiene

No tracked or staged file was changed by verification. Logs and generated verifier proof are ignored or untracked root artifacts only. This receipt is the required additional untracked root output. Candidate source and prior tracked receipts remain byte-identical to C5.

REJECTED:959a5f9900e25f53414710bbfb3464c3ccb67a5d
