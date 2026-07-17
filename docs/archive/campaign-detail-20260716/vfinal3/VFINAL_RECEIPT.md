# VFINAL independent verification receipt — candidate C3

Candidate: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`  
Candidate tree: `9e54ae92bd3cc4d30d3114590d7da6d81e019f16`  
Role: final independent verifier; not candidate builder, truth-a owner, director, fixer, or prior-shard verdict owner  
Verification clone: `/tmp/vfinal3`  
Sealed at: `2026-07-17T01:22:51Z`

## Final ruling

**REJECTED.** All canonical executable gates returned zero, but executable green is not sufficient to waive campaign topology, exact directive custody, or cockpit anti-false-green law. Three independently sufficient acceptance blockers were reproduced:

1. C3 is not a direct child of immutable C2.
2. exact-C3 directive evidence is stale/incomplete, including a byte-mismatched canonical `STATE.md` lock;
3. the cockpit envelope validator accepts a `LIVE_PUBLIC / BINDING_READY` surface while a required datum is `MISSING`, and the renderer can paint the accepted surface truth green.

No prior shard conclusion was adopted as a verdict. Prior receipts were treated as advisory inventories only. Every critical money-path, restart, reconciliation, authority, and no-false-green class reported below was rerun or directly reprobed in this clone.

## Clone and candidate identity

- `/tmp/vfinal3` was confirmed absent before cloning. The environment rejected the requested destructive pre-delete command; no prior directory was reused.
- Direct anonymous HTTPS authentication failed because the repository is private. The successful network clone used the same requested HTTPS URL and a command-scoped Git `insteadOf` rewrite to SSH transport. `origin` remains `https://github.com/cosmosgeek0/arbitrage-cosmos`.
- Fetch scope is exactly `+refs/heads/truth-campaign-20260716:refs/remotes/origin/truth-campaign-20260716`.
- `HEAD` is detached at exact C3; `HEAD^{tree}` is the tree above.
- `git rev-parse --is-shallow-repository` => `false`.
- alternates => absent.
- `.git/objects` files with link count greater than one => `0`; this is not a hardlinked local clone.
- exact local `refs/heads/current-main` => absent, verification exit `1`.
- exact local `refs/remotes/origin/current-main` => absent, verification exit `1`.
- package manager/runtime: Node `v22.23.1`, npm `10.9.8`.
- `package.json` SHA-256 `ef7a99bb8f3e9bc7a667c28d7de0bcee1252e248824c1a2b5740c7781131fb7e`; `package-lock.json` SHA-256 `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf`; both remained tracked-byte clean.

Primary identity/provenance transcript: `VFINAL_PROVENANCE_AUDIT.log`, SHA-256 `fd58fbcd7d21156459e6cbd7023df28c7f11eddf7b423fa033fdaccd5d7d1c82`.

## Findings

### VFINAL-PROV-001

- **Severity:** CRITICAL
- **Invariant:** exact C3 must have immutable rejected C2 `dea2d2a5c2b5e83d3aea75b0e368f0a478596561` as its sole direct parent; campaign evidence must be a separate later child.
- **Evidence:** `git rev-list --parents -n 1 78f708d6cdb9d1618c53d3f08f71097b4320a63b` returns parent `4ec9e8640a22661f7e1649204348a212d94163e1`. That intervening commit is titled `evidence: record blocked C2 pass-0 closure` and itself has sole parent immutable C2. The actual chain is `dea2d2a5 -> 4ec9e864 -> 78f708d6 -> ca07f524`. The later evidence child `ca07f5240b1a656cf3e76fcce9eae6064e3d6934` is correctly separate and has exact C3 as sole parent. Its gate runner records C3's parent but checks only `merge-base --is-ancestor C2 C3`; it never asserts direct-parent equality.
- **Repro:** `git show -s --format='%H|%P|%T|%s' dea2d2a5c2b5e83d3aea75b0e368f0a478596561 4ec9e8640a22661f7e1649204348a212d94163e1 78f708d6cdb9d1618c53d3f08f71097b4320a63b ca07f5240b1a656cf3e76fcce9eae6064e3d6934`; then `git rev-list --parents -n 1 78f708d6cdb9d1618c53d3f08f71097b4320a63b`.
- **Expected / actual:** expected `C3^ = dea2d2a5...`; actual `C3^ = 4ec9e864...`.
- **Correction boundary:** topology cannot be repaired in-place. A replacement candidate must be created as a direct sole child of immutable C2, with evidence in a later child, and all acceptance/custody gates must be rerun. The verifier made no fix.

### VFINAL-DIR-001

- **Severity:** CRITICAL
- **Invariant:** `verification/product-truth-20260716/INPUTS.lock` must byte-bind the canonical tracked law used for exact C3.
- **Evidence:** all 34 candidate-backed relative lock records were independently rehashed. Thirty-three match; `STATE.md` does not. The lock expects SHA-256 `54f37fc6501feaef7e1947ccf24af9094540769ba69c79f7b40d1b4be1a5d2c2`, `11689` bytes. Exact C3 contains SHA-256 `73be76252f3f231e747cc973d62499bdd70a74d40770eccbb48dc3b3720dface`, `13625` bytes, Git blob `d0f25a482bf033e1e846e6ceb34abfdc9c31841d`.
- **Repro:** `shasum -a 256 STATE.md`; `wc -c STATE.md`; `git rev-parse HEAD:STATE.md`; `jq '.candidate_tracked_law_and_locks[] | select(.id=="STATE")' verification/product-truth-20260716/INPUTS.lock`.
- **Expected / actual:** expected exact byte equality for every candidate-backed lock row; actual one mismatch in the root state authority.
- **Correction boundary:** regenerate the exact-C3 campaign evidence/lock under the evidence owner and reverify it; do not alter this frozen candidate under verifier ownership.

### VFINAL-DIR-002

- **Severity:** HIGH
- **Invariant:** no authority-bearing input may be silently omitted from source-to-disposition traceability, including superseded inputs.
- **Evidence:** declared inventory arithmetic is internally correct and unique: `17 + 14 + 4 + 18 + 8 = 61`. However, exact `source_file` mapping from the 153-row coverage matrix reaches only `19/61`: controlling `11/17`, tracked law/locks `6/14`, defect-wave inputs `0/4`, superseded-available `2/18`, superseded-named-absent `0/8`. Material unmapped rows include `SAFETY_AMENDMENT`, `ROLE_CORRECTION`, `Q_L_LAUNCH`, `DESIGN`, `EDGE_PROTOCOL`, every defect-wave input, and most superseded inputs.
- **Repro:** `ruby VFINAL_DIRECTIVE_AUDIT.rb`; inspect `directly_mapped_lock_ids` and `unmapped_lock_ids` in `VFINAL_DIRECTIVE_AUDIT.log`.
- **Expected / actual:** expected an explicit locked source and auditable disposition for every one of 61 inputs; actual enumeration is complete but cross-artifact traceability is explicit for only 19.
- **Correction boundary:** campaign evidence/authority-map regeneration only unless the authoritative owner decides a product-law change is required. The verifier made no source change.

### VFINAL-DIR-003

- **Severity:** HIGH
- **Invariant:** the no-omission coverage artifact used to accept C3 must be bound to exact C3 rather than an earlier candidate phase.
- **Evidence:** the matrix parses as 153 unique, fully populated, 14-column rows. Its status-column gate passes with `MISSING=0` and `CONFLICTING=0`. Nevertheless, all 153 `candidate_sha` cells are `SELF_COMMIT_UNBOUND_USE_EXACT_EVIDENCE_DESCENDANT`, exact C3 appears zero times, 97 rows mention C2, and five rows remain `C2_NOT_YET_FROZEN`: `AUTH-003`, `CAMP-05-CENSUS`, `CAMP-07-PASS0`, `CAMP-20-LADDER`, `CAMP-21-STOP`. The separate C3 evidence child leaves both the lock and matrix unchanged.
- **Repro:** `ruby VFINAL_DIRECTIVE_AUDIT.rb`; inspect `c3_sha_cells`, `self_unbound_cells`, `c2_not_yet_frozen_rows`, `status_missing`, and `status_conflicting`.
- **Expected / actual:** expected a separate evidence descendant to bind coverage to exact C3 while preserving C3 bytes; actual the evidence descendant does not perform that binding.
- **Correction boundary:** generate a new exact-C3 evidence descendant; do not rewrite C3 under verifier ownership.

### VFINAL-COCKPIT-001

- **Severity:** CRITICAL
- **Invariant:** a surface with any required `MISSING` evidence cannot validate or render as a live/ready surface; cockpit truth must be hostile to false green.
- **Evidence:** `web/src/lib/productIntegration/model.ts:1750-1779` validates surface and datum shapes independently but has no relational constraint between surface truth/readiness and required-datum truth. `server/src/productIntegration/runtime/projection.ts:630-729` computes surface `bindingState` from surface truth alone while individual required values independently become `MISSING`. `SurfaceBindingPanel.tsx:46-75` renders both independently, and `productControlRoom.css:360` colors `truth-live-public` with the positive `--up` color. The independent hostile probe produces surface `LIVE_PUBLIC`, `BINDING_READY`, blocker `null`, required datum `overall-posture=null/MISSING`, validator `errors=[]`, and `falseGreenAccepted=true`.
- **Repro:** `node --import tsx VFINAL_COCKPIT_HOSTILE_PROBE.mjs`; exit `0`; inspect `VFINAL_COCKPIT_HOSTILE_PROBE.log`, SHA-256 `02d94a7c5d8c87947cc395e35cacd82fdde3b552a9a852cee2f020e55076eec8`.
- **Expected / actual:** expected at least one relational validation error and a blocked surface; actual zero errors and an accepted live/ready surface containing required missing truth.
- **Correction boundary:** the Product envelope contract, server surface projection, browser renderer, and hostile tests must move together in a replacement candidate. The verifier made no fix.

### VFINAL-AUTH-001

- **Severity:** HIGH
- **Invariant:** `web/**` renders canonical supervisor truth only; client-side integration health and strategy recomputation is retired (`ARCHITECTURE.md:39,76`).
- **Evidence:** `web/src/lib/canonicalCockpitTruth.ts:78-112` derives operational/degraded/outage posture from component fields; lines `119-161` derive market-feed readiness; lines `164-178` derive an aggregate strategy runtime label; lines `180-199` derive Watchman overall status. Dashboard, System Health, Notifications, and Header consume these browser-derived verdicts.
- **Repro:** `nl -ba web/src/lib/canonicalCockpitTruth.ts | sed -n '74,200p'`; `rg -n 'canonical(Component|MarketFeed|Strategy|Watchman).*Presentation' web/src`.
- **Expected / actual:** expected server-owned canonical display posture/health/strategy truth; actual browser code creates new aggregate status and tone verdicts from lower-level fields.
- **Correction boundary:** the canonical supervisor owner and browser consumers must be corrected together under architecture ownership in a replacement candidate. The verifier made no fix.

### VFINAL-EVIDENCE-001

- **Severity:** LOW; evidence-child-only and not independently responsible for rejection.
- **Invariant:** campaign evidence summaries preserve exact recorded digests.
- **Evidence:** evidence-child `verification/product-truth-20260716/STATE.md:30` records a 63-character census output digest ending `...a052b`; `C3_LOCAL_GATE_REPORT.json` records the full digest ending `...a052b3`.
- **Repro:** compare `git show ca07f5240b1a656cf3e76fcce9eae6064e3d6934:verification/product-truth-20260716/STATE.md` line 30 with `.census.commands[0].output_sha256` in the evidence-child report.
- **Expected / actual:** expected `724ddb9e10d1e7dc8699b4c2309bdef9c79c38aaf27d544bbc07b03629a052b3`; actual state summary omits the terminal `3`.
- **Correction boundary:** evidence-child `STATE.md` only; never candidate C3 source.

## Independent clean-clone acceptance results

All commands below returned exit `0`. Exact emitted counts are reported; compilation alone was not counted as acceptance.

| Scope | Exact result | Evidence log SHA-256 |
|---|---:|---|
| `npm ci` | 229 packages added; 232 audited; 0 vulnerabilities | `425aec1d52e7c2b70bd1c0f521ce143ad6ad2b0a2f4c293ba22b72bda0409e43` |
| `npm test` | 413 tests; 0 failed; 0 unexpected skips/todos; deterministic egress audit PASS, 0 forbidden attempts | `07d9042d93188d159d8de11023da49bea3d4ebb2465f7656f492880321440fb9` |
| `npm run test:all` | 2675 tests; 0 failed; 0 unexpected skips/todos | `d025a6d7417e1f076f5a0db80e867081973bd80e3c749a0acf21f4d0e45f3a0e` |
| `npm run test:protocol:built` | 22/22 protocol checks | `b1794fc1b7f5240aa1ef4f61bf8f5f7406f0a73a668b115d070e6181821d42d0` |
| `npm run test:i00:proof:built` | 47/47 | `ad1ed0b5db34aed25c41652431798a586ca04b898120f9778f14a56f646e1a15` |
| `npm run test:product-assurance:built` | behavior 802; provenance 4; operations 205/205 across 555 files; uncovered 0; formal/action 131/131 | `acd7ebc26ac36506987d3d64ac02cfe806965dcbbef2976139981903fc85ff9b` |
| `node test/i00/donor-equality.mjs --candidate-ref HEAD` | expected/discovered/accepted/integrated = 16/16/16/16; failures `[]`; proof `2e7a8c5f...` | `5043d29670c2ec5d600ef53db869b2d03d152219d94b34aa4ade3d7f37f899a1` |

Count recomputation transcript: `VFINAL_COUNT_AUDIT.log`, SHA-256 `659589e88e773a88d548d80292c1a785a661ece16a37384818c64da478743cdd`. The assurance harness's `skipped_callbacks=6` is a harness classification with separately replaced context proofs, not a Node test skip; emitted test skip counts were zero.

## Security, network boundary, and money-path no-dispatch

| Independent rerun | Result | Evidence log SHA-256 |
|---|---:|---|
| strict perimeter with hostile negative controls | 3/3 | `92936c9129674c1448e2b87bdcfb3862a99c69081a85ed7c2af62bc30eb73fb6` |
| system-integration security regressions | 5/5 | `4ce53a2e8fbafaa91e75f639f9fc4911aaf9ed158f47073ff046cf32871eb54e` |
| private-truth + signed-kernel purity/safety/request classes | 108/108 | `33ab33302ab3d041dcdaeeb8c662fda4d1e70295cc3d8609b4df4c001dd84a08` |
| I00 security boundary | 7/7 | `ffc7f6e45992174d68f5a865743c6224d4863b7ee377258184289574026071db` |
| `bash ops/tests/test-secret-scanner.sh` | OK, 13 assertions | `182b3bbceee56ef6b82c99948fc3ef45c0f41254ea39e5f354120efb9530c1eb` |
| system-integration control routes/live barrier | 1/1 | `029c70e3d9321fa0248a641d86d872cf40c4c4bfd4a50c9c5f990597e84b4964` |

Source inspection independently confirmed that the documentary signed-request constructor exposes no transport dispatch; the durable mutation decision remains `syntheticOnly: true`, `sendAuthorized: false`, `externalActionAuthorization: NONE`; the production control binding exposes no dispatch owner; and all live/manual/autonomous spellings fail at `LIVE_EXECUTION_NOT_IMPLEMENTED`. No live/test order, borrow/repay, leverage/margin mutation, transfer-out, or withdrawal dispatch was exercised.

## Critical restart, reconciliation, authority, and cockpit classes

| Independent rerun | Result | Evidence log SHA-256 |
|---|---:|---|
| Product Integration | 111/111 | `86b7b26aa12db4a9e88282936d7892da7484931eae0fcbae5a8ff68111b10739` |
| Product Control browser contract | 102/102 | `831903b98ce3dea27cce1c49d69356ce2ed0ff75e12911e6fb1c2947c2ccfe98` |
| cockpit assurance | 50/50 | `06b60b76572693b56fcbb78e798e9ee9ade32f2ce70fcbc5c57d816545058162` |
| Foundation risk/execution/reconciliation | 884/884 + 178/178 + 75/75 | `0f6c5322374607e5025f9461a95dab353835895a482b9daba72ab6fcd585b2db` |
| focused crash/restart/reconciliation/supervisor/authority scenarios | 127/127 | `aced428bf9246c56fcdbe2ebb0e41cd8978a3c79b0adda2c5bf9b03a7be59e52` |
| hostile cross-field cockpit probe | contradiction accepted; rejection finding reproduced | `02d94a7c5d8c87947cc395e35cacd82fdde3b552a9a852cee2f020e55076eec8` |

The focused 127-test command covered exact crash matrix, mutation-journal reconciliation, reverse-basis restart, Product lifecycle/restart/supervisor false-green, canonical restart truth, supervisor projection/truth, and vertical-slice authority scenario files. The Foundation command directly executed `server/test/foundation/risk/risk.mjs`, `server/test/foundation/execution/execution.mjs`, and `server/test/foundation/reconciliation/reconciliation.mjs`.

## Rendered cockpit inspection

The Browser verifier mounted the built candidate with `SKIP_DOTENV=1`, a fresh `/tmp` data directory, and loopback `127.0.0.1:18080`.

- Title: `Arbitrage Control Room · Dashboard`.
- Document reached `complete`; console warnings/errors: `0`.
- Header truth included `Execution Control — BLOCKED`, private exchange `OWNER GATED · NOT CONFIGURED`, and Account Details `OWNER GATED · NOT CONFIGURED`.
- Dashboard showed `Canonical Runtime Unavailable`, `OWNER_GATED`, and `LIVE_EXECUTION_NOT_IMPLEMENTED` rather than fabricated money truth.
- The ordinary projection also visibly placed `BINDING_READY` beside six currently visible required `MISSING` evidence rows. This corroborates the cross-field contract gap; the separate hostile probe demonstrates the same gap can validate with `LIVE_PUBLIC`, whose CSS tone is positive.
- Startup/shutdown were clean. `VFINAL_BROWSER_SERVER.log` SHA-256: `80b4565e746ae07cd1d7b369b89c673f33a6a9091df27687e7836f4d571843d8`.

## Worktree census reconciliation

The census was checked from the separate evidence child because exact C3 source intentionally predates its final evidence package.

- Evidence child `ca07f5240b1a656cf3e76fcce9eae6064e3d6934` has sole parent exact C3 and changes only four `verification/product-truth-20260716/**` paths.
- expected/registered/live-policy counts: `96/96/96`; `UNKNOWN=0`.
- classifications: `42 MERGED_RETAINED`, `33 SUPERSEDED_SAFE`, `20 ABANDONED_SAFE`, `1 BLOCKED`.
- exactly five live-disjoint `REMOVED_SAFE` tombstones: `prep-act`, `shard-prov`, `shard-sec`, `v-clean`, `v-cockpit`.
- `shard-sec` and `v-cockpit` are exactly `NO_ACCEPTED_OUTPUT` with zero outputs.
- all four nonempty accepted outputs match candidate Git blob, SHA-256, and byte count.
- census transcript: `VFINAL_CENSUS_AUDIT.log`, SHA-256 `7682b772ce3feb1565ee58615e910de849e35737deaa64557cdb19102e3514ae`.

Limitation: archive source commit `0e4b364849075a454d7dd624ca068c238f4196c2` is absent from the required single-branch clone, so archive commit-to-source-path linkage and the historical empty-output assertion could not be re-derived from that object. Candidate bytes, evidence declarations, generator behavior, and all tracked nonempty output identities are internally consistent.

## Custody and hygiene

- Candidate tracked diff: empty.
- Index diff: empty.
- No source, canonical document, tracked receipt, branch, tag, or remote ref was changed.
- All verifier artifacts are untracked root-level `VFINAL_*` files; build products and dependencies remain ignored.
- No merge, commit, push, deployment, credential use, signed/private exchange dispatch, or money mutation occurred.

The exact terminal token follows and is the last line of this receipt.

REJECTED:78f708d6cdb9d1618c53d3f08f71097b4320a63b
