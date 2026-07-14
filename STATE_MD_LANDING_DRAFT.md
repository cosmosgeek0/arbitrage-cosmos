# STATE.md landing draft — director adjustment required

Draft status: **NON-DONOR / NOT LANDING TRUTH / DO NOT COPY UNCHANGED**

Evidence cutoff: `i00-product-assembly-20260713@139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9`, tree `84dd406f40c66c6771daee657a51224393a7d8d6`

Prepared from: `preverify-20260714@0bbf23c06c60c1a4553422f099d8b242f13b6dc5`
Observed living `current-main`: `bf262c08984cf05cb84425e850b187af5f8adf03`, tree `753030474827ab41b957dbb6174353bc818819b3`

The director applies this rewrite atomically only after Role 2 seals one immutable candidate, a different Role-3 session returns exact `VERIFIED_CANDIDATE` for that SHA, and the exact verified bytes land. Every bracketed field is mandatory. Delete this draft banner when copying the adjusted body into root `STATE.md`.

The observed integration ref is pre-L and not a candidate. It does not contain D-LAUNCH-18/19, exact L or A-FORMAL. Its full current-tree tests, runtime/restart/reconciliation, browser ship gate and candidate seal are pending. Historical counts below are evidence inputs, not final landing claims.

---

# STATE.md — what is true right now

**Status:** `INTEGRATED_ACCEPTED`

**Landed:** `[LANDING_UTC]` · branch `current-main` · commit `[LANDING_SHA]` · tree `[LANDING_TREE]`

**Verified candidate:** `[ROLE3_VERIFIED_SHA]` · tree `[ROLE3_VERIFIED_TREE]` · receipt `[ROLE3_RECEIPT_PATH_AND_HASH]`
**Law:** `MISSION.md` owns why; `ARCHITECTURE.md` Part II owns design and authority; this file owns current landed truth. A build, donor, receipt, fixture, prestage label or deployed artifact cannot widen the status recorded here.

## Product and permanent safety boundary

Cosmos Arbitrage Control Room is one private market-edge operating system: public market acquisition and evidence feed Basis/Volume strategy authorities; Capital and Risk bound intent; Foundation owns validate-only execution/reconciliation; the existing SQLite ledger owns durable history; one System Integration composition exposes canonical supervisor truth to the authenticated cockpit.

The landed software cannot move money. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced. No withdrawal or transfer-out code or UI exists. No signed/private exchange adapter is mounted in the composed runtime. Operator modes remain `READ_ONLY`, `ADVISORY`, and `VALIDATE_ONLY`; execution proof is sealed dry-run/synthetic until separately authorized future work establishes otherwise. Secrets remain server-side and untracked.

Software acceptance grants no deployment, private read, signed validation, Margin action, live ticket, capital increase, AWS/Cloudflare/Secrets mutation, service restart, paging action, backup/restore mutation, merge or push authority.

## Exact Git identity

| Fact | Landed truth |
| --- | --- |
| Candidate commit/tree | `[CANDIDATE_SHA]` / `[CANDIDATE_TREE]` |
| Candidate receipt | `[INTEGRATION_CANDIDATE_RECEIPT_PATH_SHA256_AND_BLOB]` |
| Role-3 verified commit/tree | `[ROLE3_VERIFIED_SHA]` / `[ROLE3_VERIFIED_TREE]` — must equal candidate bytes |
| Landing commit/tree | `[LANDING_SHA]` / `[LANDING_TREE]` |
| Landing parent | `[CURRENT_MAIN_PARENT_BEFORE_LANDING]` |
| Local `current-main` | `[LANDING_SHA]` |
| `origin/current-main` | `[REMOTE_SHA_OR_NOT_PUSHED]` |
| Remote | `git@github.com:cosmosgeek0/arbitrage-cosmos.git` |
| Working tree | `[CLEAN_STATUS_AND_COMMAND]` |
| Tested/deployed identity | tested `[ROLE3_VERIFIED_SHA]`; deployed `[DEPLOYED_SHA_OR_NOT_CONFIGURED]` |

The landed tree must contain the exact Role-3-verified candidate content. If the landing process adds a merge commit, prove `[LANDING_TREE] = [ROLE3_VERIFIED_TREE]`; otherwise verification does not transfer.

## Regenerated donor and correction inventory

Final candidate equality, regenerated from the controlling set:

```text
expected=[FINAL_EXPECTED]
discovered=[FINAL_DISCOVERED]
receipt-accepted=[FINAL_RECEIPT_ACCEPTED]
integrated=[FINAL_INTEGRATED]
instrumented=[FINAL_INSTRUMENTED]
```

All five values must be equal and their exact denominator must be named in the candidate receipt. Do not reuse 14, 15 or 16 from an earlier snapshot. At the draft cutoff, D-LAUNCH-19 and Role-2 state disagree on the denominator, and A-FORMAL is blocked.

| Input | Exact immutable identity | Candidate/landing disposition |
| --- | --- | --- |
| Q A17 frozen tip | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`; tree `5c86cebf0966cedd7ba01c56a01704b4f7bd0224`; receipt SHA-256 `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc` | `[Q_ANCESTRY_OR_RECEIPTED_EQUIVALENCE]`; C17 direct parent `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`, tree `1aec7711f64419d50770d9c515d012173e982240`; advisory `ABSTAIN_UNKNOWN` only |
| L lane | `df6b472993ca9659ce09cf5f72004981c6835f0d`; tree `1add5ee43fea623509c20d0990ec9efac2543fc4`; root receipt SHA-256 `0b95db6e0ae8777d3e3bebb1a510561c7dfc9dcba963bd02fbc91025dd784fe2`; acceptance SHA-256 `f23e078fdd1cf8d64585c01b677817d4d4efa3a08f9c4933acae09b399ce2381` | `[EXACT_LAST_MERGE_AND_INSTRUMENTATION_RECEIPT]`; donor boundary is `BUILT_AND_TESTED_UNWIRED`, never private/live authority |
| Dashboard shell | `692501587617d4880303fbd747d93e63c376f088`; tree `61d0c5a3e9146fc0b78d8c7fce3e7ebdfbc3b46d`; receipt SHA-256 `878cc578d88f38ca3bf8edce554b2cb258b4e9309718854f7ba18c33cb50b968` | `[EXACT_21_FILE_SUBTREE_EQUIVALENCE_OR_ANCESTRY]`; count once, prove canonical backend truth and no unknown-to-zero conversion |
| L15 infrastructure | `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`; tree `e401435d6a650aee8a29c3da4495b4db426be017`; receipt SHA-256 `d5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293` | `[ANCESTRY]`; artifacts imported, not installed/deployed/exercised unless separately proved |
| IP-RUNTIME | `8058ab8febb639839333d4e2c604068a0c7390ea`; tree `dd255f23310c846ab0b3ea0c3bebb6a765ecddd0`; receipt SHA-256 `8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb` | `[ANCESTRY_AND_EVOLVED_BLOB_AUDIT]` |
| IP-CONTROL | `56c47dad398c485b6653036c8b90c53f11061b1e`; tree `e335fc95be7a24da828b14c205f39ea3666dd385`; receipt SHA-256 `4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7` | `[ANCESTRY_AND_EVOLVED_BLOB_AUDIT]` |
| IP-OPS | `6bfd543afb693ea18f4baf08e962e6d698f140fb`; tree `572adc3c19d9052fc26398875230437505f5c97e`; receipt SHA-256 `57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922` | `[ANCESTRY_AND_LOCAL_ARTIFACT_DISPOSITION]` |
| IP-PROOF | `23e985c17b9b860fee26be397fa05b26f3daf8f2`; tree `1329fe73139016cf728d47551c75f7ca69daa558`; receipt SHA-256 `569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b` | `[ANCESTRY_AND_EVOLVED_PROOF_AUDIT]`; final proof must be regenerated from candidate, not packet prestage |
| A-CORE | `08a0a09780727e2b4ba59017b5701998abe29b77`; tree `b904ca0f5b6f7c8df294274351611635560f80f7`; receipt SHA-256 `93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e` | `[ANCESTRY_AND_ROOT_DISCOVERY_RESULT]`; exact donor status `CORE_SCAFFOLD_READY` |
| A-HAZARD | `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f`; tree `e33224d4b2e6b018fd39bfdcb403b3d88e74712f`; receipt SHA-256 `ecfca4e7d60d9dca3b07e4e21d4595ebb234dab421924f14226cf39f8a9c85ea` | `[ANCESTRY_AND_INSTRUMENTATION]`; fixture/evidence only |
| A-FORMAL | `89c783bd9e55ce83c21ed1181757122d88e4c980`; tree `bb444b7ea959f086bbc1d1021b6f9b45e0fadf79`; blocked reseal SHA-256 `d693696aa339d490ef58fee2bf4c833ce660d6a265391c5363079b32d62a165f` | `[A_FORMAL_DISPOSITION]`; draft default is `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED / NOT_RECEIPT_ACCEPTED / NOT_INTEGRATED`; a board label is insufficient |
| A-COCKPIT | `d4ff9c94c9fec9477481223c4b33d8f671a34f6d`; tree `bda9b452c9e6564576fa3cd390a5981cd6907c09`; receipt SHA-256 `b75055388f99632f2dc5ebb87d92b6d969f666397014e89a616a6e262f0650dd` | `[ANCESTRY_AND_CANONICAL_BINDING]`; packet-local fixture truth |
| A-AGENT | `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437`; tree `e68ef10d09c11bc5623099a2eb6eb6881054486b`; receipt SHA-256 `c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c` | `[ANCESTRY_AND_CANONICAL_BINDING]`; diagnostic stub, no tools/authority |
| A-STABILITY | `d35674e7f9621320c35e0bc0270efd515cc64dbd`; tree `16c92923b837105471b232df0480d1270bda756e`; receipt SHA-256 `b26f902d90fb82633ac8532d5aa82169801ded3ec6d7bcf3477737a64eab2168` | `[ANCESTRY_AND_RESOURCE_OWNER_DISPOSITION]`; resource truth remains unknown until confirmed |
| S4 assurance case | `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c`; tree `3c773878016f4a56c6b03fe6485a42b002c3f5d2`; receipt SHA-256 `05369b8aa403a4fae6b86143ddcb7d61551d5996838c92b9bc4aba79401a3550` | `[ANCESTRY_AND_CANONICAL_BINDING]`; `SYNTHETIC_ONLY`, authority effect none |

Canonical correction ancestry also includes F-BRIDGE `a0c0c2e5ef3180aa720488463643433cefeb65e5` and SI-RECON `f03ed786a8c5cab50ef27ad33026a74f79f7df87` through their accepted `current-main` merges. Record whether they are prerequisites or counted donors in `[FINAL_DENOMINATOR_DEFINITION]`; never count the same semantic input twice.

S2 action evidence has no accepted donor branch or receipt at the draft cutoff. Its final state is `[S2_DISPOSITION]`, default `NOT_CONFIGURED / MISSING ACCEPTED EVIDENCE`; do not fabricate one.

## Canonical component and release matrix

Release labels are only `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`, `LIVE_PUBLIC`, `SYNTHETIC_ONLY`, `BLOCKED`, `NOT_CONFIGURED`, or `MISSING`. A later label requires all earlier evidence and does not transfer from a donor receipt.

| Component/authority | Landed status | Exact truth boundary |
| --- | --- | --- |
| Existing audited public services and physical Binance producers | `[FINAL_PUBLIC_RUNTIME_LABEL]` | Public/keyless acquisition only; Role-3 freshness, sequence, coverage and restart evidence `[PUBLIC_RUNTIME_EVIDENCE]` |
| Basis and Volume engines | `[FINAL_ENGINE_LABEL]` | Sole strategy authorities; no Q/UI/integration scoring owner; runtime advancement `[ENGINE_RUNTIME_EVIDENCE]` |
| Intelligence Runtime | `[FINAL_INTELLIGENCE_RUNTIME_LABEL]` | Sole semantic public-source lifecycle/freshness/backpressure owner; no second socket/cache |
| Intelligence Foundation | `WIRED` | Evidence/features/attention/thesis/forensics only; never strategy or execution authority |
| Q | `[FINAL_Q_LABEL]` | Advisory `ABSTAIN_UNKNOWN`; edge not established; model payload unavailable; transport/mount `[Q_TRANSPORT_STATE]` |
| L adapters | `[FINAL_L_LABEL]` | Signed kernel/filter/private-truth/execution-realism adapters remain non-sendable until separate future authorization and production binding |
| Capital Foundation | `WIRED` read/advisory | Reservation/staging authority `UNAVAILABLE` without real account truth and valid mandate |
| Foundation Control/Risk | `WIRED` validate-only | One machine-control owner and one final multi-leg risk owner; no integration/UI duplicate |
| Foundation execution | `SYNTHETIC_ONLY` | Sealed dry-run port; live/signed/test transport absent from composition |
| Foundation reconciliation/recovery | `[FINAL_RECONCILIATION_LABEL]` | Synthetic/local until separately authorized private/exchange truth; ambiguity/divergence blocks new risk |
| Existing Ledger | `WIRED` | Sole durable event/checkpoint owner; candidate CAS/quantity bridge dispositions `[CAS_QUANTITY_DISPOSITIONS]` |
| Product Integration/System Integration | `[FINAL_PRODUCT_INTEGRATION_LABEL]` | One composition root, dependency startup, routes, supervisor projection and persistence; runtime/restart evidence `[PRODUCT_RUNTIME_EVIDENCE]` |
| Control Room/cockpit | `[FINAL_COCKPIT_LABEL]` | Canonical APIs only; browser ship gate `[BROWSER_EVIDENCE]`; unsupported controls disabled with blocker |
| Product Assurance | `[FINAL_ASSURANCE_LABEL]` | Source-frozen denominator `[ASSURANCE_DENOMINATOR]`; no fixture/draft can mint live green; Formal/S2 dispositions exact |
| L15/IP-OPS | `IMPORTED` | Local release/backup/restore/watchdog artifacts only; target deployment and readback `[DEPLOYMENT_STATE]` |
| Signed/private exchange actions | `NOT_CONFIGURED` | No mounted private stream, signed test/live order, operational Margin or ambient credentialed client |
| Withdrawal/transfer-out | `MISSING` | Forbidden by design; no code or UI |

## Live, synthetic, unwired and owner-gated truth

| Area | Live/public truth | Synthetic/local truth | Unwired/blocked/owner-gated truth |
| --- | --- | --- | --- |
| Market observation | `[FINAL_PUBLIC_SOURCE_SUMMARY]` | Replay and deterministic fixtures carry explicit source labels | Missing/stale/silent/incompatible facts cannot render green |
| Q and strategy | Basis/Volume `[FINAL_ENGINE_RUNTIME_SUMMARY]` | Q research artifacts and dry-run assessments | Q edge/champion/loadable model not established; Q abstains on insufficient evidence |
| Capital/Risk | Deterministic policy wiring only | Synthetic mandate/risk fixtures | Real account/cost truth, reservation and capital authorization unavailable |
| Execution/reconciliation | None live | Validate-only two-leg coordinator and fixture reconciliation/recovery | Signed/test/live transport and exchange-observed fills not configured; ambiguity fails closed |
| Persistence/restart | `[FINAL_LEDGER_RUNTIME_SUMMARY]` | Local deterministic restart campaigns | Any unproved same-data/cursor/reconciliation condition stays blocked |
| Cockpit/control | `[FINAL_BROWSER_AND_COMMAND_SUMMARY]` | Fixture scenarios persistently labelled `SYNTHETIC` | Decorative/unmapped controls omitted or disabled; no browser truth recomputation |
| Assurance | None live by packet receipt alone | Core/satellite evidence, drafts and render-neutral views | Overall readiness depends on candidate source freeze; S2/Formal/UNKNOWN seams explicit |
| Operations | `[DEPLOYED_SHA_OR_NOT_CONFIGURED]` | Local artifact/schema/template tests | AWS/Cloudflare/Secrets/systemd/watchdog/paging/backup/restore/rollback/target readback owner-gated unless separately proved |
| Money authority | None | 10-USDT envelope policy may be simulated with zero capital | Tiny live ticket, Margin mutation and every capital increase require separate owner authorization |

## Candidate verification

The candidate receipt is the only source for final Role-2 counts. Fill every row with exact command, exit, measured tests/assertions, environment and receipt hash.

| Required candidate gate | Exact result |
| --- | --- |
| Clean install/dependency identity | `[CANDIDATE_INSTALL_RESULT]` |
| Protocol/generated-client parity | `[CANDIDATE_PROTOCOL_RESULT]` |
| Focused Q/L/IP/assurance suites | `[CANDIDATE_FOCUSED_RESULTS]` |
| `npm test` | `[CANDIDATE_NPM_TEST_EXIT_AND_COUNT]` |
| `npm run test:all` | `[CANDIDATE_TEST_ALL_EXIT_AND_COUNT]` |
| Duplicate authority/import purity/scope | `[CANDIDATE_STATIC_AND_RUNTIME_SCAN_RESULTS]` |
| Deterministic I00 scenarios | `[CANDIDATE_SCENARIO_RESULT]` |
| Cold start/shutdown | `[CANDIDATE_START_STOP_RESULT]` |
| Restart/readback/reconciliation/cursor continuity | `[CANDIDATE_RESTART_RESULT]` |
| Browser route/theme/width/console/overflow/control ship gate | `[CANDIDATE_BROWSER_RESULT]` |
| Local ops preflight/backup/isolated restore/rollback templates | `[CANDIDATE_LOCAL_OPS_RESULT]` |
| Expected vs discovered vs instrumented component inventory | `[CANDIDATE_COMPONENT_INVENTORY]` |

### Pre-candidate receipt evidence retained for provenance

These are not final landing results. They tell the director what must be superseded by candidate/Role-3 evidence.

| Evidence source | Receipt-reported measurement |
| --- | --- |
| Q `02b4ecc…` | focused `384/384`, 96.50% branch coverage; full `3,011` passed and six documented shard-only skips; final posture `ABSTAIN_UNKNOWN` |
| L `df6b472…` | scope `35/35`; focused `23/23`; import purity `4/4`; LiveEdge `1,618/1,618`; protocol `22/22`; Risk `884/884`; Control `97/97`; Execution `178/178`; Reconciliation `75/75`; Observability `130/130`; read model `72/72`; SI `180/180`; `npm test` `377/377`; `test:all` `2,479/2,479`; donor remains unwired |
| I00 pre-L state `139d2cf…` | Product Integration `89/89`; Control Room `44/44`; SI `218/218`; focused bridge bundle `36/36`; persistence `38/38`; health/quantity `15/15`; boundaries `69/69 + 146/146`; built app `73/73`; A-CORE `32/32`; operation scan 386 files/143 sites; Hazard `69/69`; Cockpit `50/50 + 100/100`; Agent `111/111`; Stability `212/212`; S4 `233/233`; typecheck/build pass; current-tree `npm test` and `test:all` explicitly pending |

## Independent Role-3 verification

Role 3 ran in a fresh clean worktree pinned to `[CANDIDATE_SHA]`, did not edit, and returned exact `VERIFIED_CANDIDATE` for `[ROLE3_VERIFIED_SHA]`.

| Independent gate | Exact result |
| --- | --- |
| Candidate SHA/tree/status/ancestry and regenerated donor equality | `[ROLE3_GIT_RESULT]` |
| Clean install/build/full tests with real exits | `[ROLE3_BUILD_TEST_RESULT]` |
| Duplicate authorities/import purity/protocol/routes/schema/persistence | `[ROLE3_AUTHORITY_CONTRACT_RESULT]` |
| Runtime cold start/shutdown and source advancement | `[ROLE3_RUNTIME_RESULT]` |
| Restart cuts/reconciliation/ambiguity/fencing/caps/recovery | `[ROLE3_RECOVERY_RESULT]` |
| Cockpit canonical truth and no-false-green inventory | `[ROLE3_COCKPIT_RESULT]` |
| Browser themes/widths/console/overflow/control behavior | `[ROLE3_BROWSER_RESULT]` |
| Reliability/security/external-action tripwires | `[ROLE3_RELIABILITY_SECURITY_RESULT]` |
| Local restore/rollback/deploy-template proof | `[ROLE3_LOCAL_OPS_RESULT]` |

Final observed component totals:

```text
expected=[COMPONENT_EXPECTED]
healthy=[COMPONENT_HEALTHY]
degraded=[COMPONENT_DEGRADED]
stale=[COMPONENT_STALE]
silent=[COMPONENT_SILENT]
missing=[COMPONENT_MISSING]
instrumented=[COMPONENT_INSTRUMENTED]
```

Missing instrumentation, stale/silent data, unknown critical invariant or mismatched deployed SHA makes overall green impossible.

## Deployment, credentials and capital posture

| Capability | Current landed truth |
| --- | --- |
| Deployed SHA/readback | `[DEPLOYED_SHA_OR_NOT_CONFIGURED]`; software acceptance alone is not deployment |
| External authorizations present | `[EXTERNAL_AUTHORIZATION_INVENTORY_OR_NONE]` |
| Private read-only account truth | `[PRIVATE_READ_STATE_OR_NOT_CONFIGURED]` |
| Signed Spot/USD-M validation | `[SIGNED_VALIDATION_STATE_OR_NOT_CONFIGURED]` |
| Margin read/maximum borrowable | `[MARGIN_READ_STATE_OR_NOT_CONFIGURED]` |
| Operational borrow/repay | `[MARGIN_OPERATIONAL_STATE_OR_NOT_CONFIGURED]` |
| Live ticket/capital | `[LIVE_TICKET_STATE_OR_NONE]`; default `NONE`; active ceiling `[ACTIVE_CAPITAL_CEILING_OR_ZERO]` |
| Withdrawal/transfer | `MISSING / FORBIDDEN` |
| AWS/Cloudflare/Secrets/systemd | `[TARGET_ACTIVATION_STATE_OR_OWNER_GATED]` |
| Watchdog/paging | `[WATCHDOG_PAGING_STATE_OR_NOT_CONFIGURED]` |
| Backup/restore/rollback | `[OPS_EVIDENCE_STATE]`; production restore requires its own accepted amendment and authorization |

## Remaining owner-only actions

Unless separately completed with durable evidence, the exact remaining owner work is:

1. Rotate any credential that may have been exposed; prove exact least-privilege permissions, stable identity and no withdrawal capability without recording values.
2. Bind exact AWS account/region/host, Cloudflare tunnel/hostname/Access identities, secret ARN/KMS policy, instance role, stable egress, persistent paths, supported target SQLite, capacity receipt and deployed-SHA readback.
3. Select one out-of-band paging destination and prove end-to-end delivery with a durable receipt and cockpit-visible failure.
4. Execute authorized backup, isolated restore, rollback and watchdog game-days; production restore remains separately blocked/authorized.
5. Authorize and prove private read-only Spot/USD-M/Margin account truth, permissions, fees, liabilities, open orders/positions and REST/stream freshness.
6. Authorize product-specific signed Spot and USD-M test validation separately; preserve exact filter, clock, signature, rate and reconciliation evidence.
7. Authorize Margin read/maximum-borrowable separately from any operational borrow/repay proof.
8. Keep the first real ticket owner-approved, one-shot and non-repeating inside the inherited aggregate 10-USDT/2-USDT-loss envelope. If minimums do not fit, return `BLOCKED_BY_MIN_NOTIONAL`; never increase automatically.
9. Treat `$50` and `$200` only as proposed owner thresholds. Promotion requires rung-specific operational, execution-calibration, effective-sample, clustered-bootstrap, live-shadow, loss/recovery, calibration, capacity, authorization and demotion evidence.
10. Continue forward evidence collection. No engineering gate proves profitability; Q’s edge remains not established until real evidence says otherwise.

Owner preparation drafts live under `ownerPrep/` on the non-donor preverify branch and do not enter the candidate. The director may copy only reviewed, still-current content into the owner’s durable operational system.

## Evidence map

- Final candidate: `[INTEGRATION_CANDIDATE_RECEIPT_PATH_AND_HASH]`
- Independent verification: `[ROLE3_RECEIPT_PATH_AND_HASH]`
- Landing receipt: `[LANDING_RECEIPT_PATH_AND_HASH]`
- Donor provenance: candidate receipt plus independent Role-3 Git audit; preverify `DONOR_PROVENANCE_AUDIT.md` is advisory only.
- Authority: `ARCHITECTURE.md` Part II.
- Product acceptance: I00 candidate/verification artifacts regenerated from `[CANDIDATE_SHA]`.
- Cockpit acceptance: `[FINAL_DASHBOARD_TRUTH_AND_BROWSER_RECEIPTS]`.
- Operations/deployment: `[OPS_AND_DEPLOYMENT_RECEIPTS_OR_NOT_CONFIGURED]`.

## Next safe step

If deployed/private/signed/live work is not separately authorized, the next safe state is continued public/read-only observation and forward evidence collection with live money mechanically blocked. The next mutation, if any, begins only from one exact owner authorization class with narrow scope, expiry, maximum effect, rollback/recovery and distinct result/reconciliation receipts.

---

## Mandatory substitution audit before landing

The director must prove no `[` placeholder remains, the donor denominator conflict is resolved, A-FORMAL/S2 have exact dispositions, candidate and Role-3 SHAs/trees match, every final count comes from the frozen candidate or independent verification, deployed state is not inferred, and the root `STATE.md` update lands atomically with the exact verified bytes and final receipts.
