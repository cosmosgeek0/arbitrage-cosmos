# Role 3 independent verification receipt — frozen candidate C2

Date: `2026-07-16`  
Repository: `/Users/cosmosgeek/Desktop/role3-c2`  
Role: fresh independent Role 3 verifier; not integrator, fix owner, or prior verifier  
Mutation boundary: read-only candidate verification; no source fix, merge, push, deployment, private/signed exchange call, money action, AWS/Cloudflare action, or remote-ref mutation  
Candidate verdict scope: local, keyless, bounded acceptance only; not production capacity, deployment, or live-trading authorization

## 1. Governing inputs and exact source identity

- Required first operation: `git checkout --detach 74eb452efab89ca92ec9ff5cb192b723b5f198f3` — exit `0`.
- Final and tested `HEAD`: `74eb452efab89ca92ec9ff5cb192b723b5f198f3`.
- Candidate tree: `6930f71f1191394ffaf317279c9e43f15bf672cf`.
- Candidate sole parent: `449350d60ab30a385edeccdf4d91716ef8550537`.
- Final symbolic branch: empty (`DETACHED`).
- Status before this receipt: zero tracked or untracked entries.
- `git diff --check`: exit `0`.
- Governing order: `/Users/cosmosgeek/Desktop/preverify/FINAL_INTEGRATION_AND_INDEPENDENT_VERIFICATION_ORDER.md`, SHA-256 `73615984fa0403a4c0d7ea0db9893292d57ea18614714398684cf9a3062fb05c`.
- Independent fix audit: `/Users/cosmosgeek/Desktop/fix-audit/FIX_AUDIT.md`, SHA-256 `31ef720ed5e031034415b0a1eeb32a509e7c05fbce01ec24c04a76c9b626ee28`.
- Toolchain: Node `v22.23.1`; npm `10.9.8`; Git `2.50.1`; uv `0.11.28`; accepted Q interpreter `Python 3.13.14`.

## 2. Role-4 source, C2/C2R, and sole-child S2 topology

The literal Role-4 ref is a correction-source recovery point, not the candidate/seal branch. I do not relabel the seal as being on `role4-fix-20260715`.

| Object/ref | Exact identity and relationship |
| --- | --- |
| local `role4-fix-20260715` | `37eeb5b006169ad1362ceaf060df678586738869`, tree `58904993ee0d73576dc2715a78e7e249d1179fe7` |
| remote-tracking `origin/role4-fix-20260715` | same locally available ref tip `37eeb5b006169ad1362ceaf060df678586738869`; no fetch or live-remote freshness claim |
| C2 merge | `449350d60ab30a385edeccdf4d91716ef8550537`; parents historical seal `517bd636d799c983ecddc9bda1985d0619b652d7` then Role-4 tip `37eeb5b006169ad1362ceaf060df678586738869`; tree equals Role-4 tree `58904993ee0d73576dc2715a78e7e249d1179fe7` |
| C2R candidate C | `74eb452efab89ca92ec9ff5cb192b723b5f198f3`; sole parent C2 `449350d60ab30a385edeccdf4d91716ef8550537` |
| sole child/seal S2 | `cf3416bed284ffcd596f451a091985755f5e239b`; sole parent C; tree `0228c9816c368557d58af277d03e69ef5ee7aa22`; subject `chore(i00): seal C2R evidence as S2` |
| seal ref | local and remote-tracking `i00-product-assembly-20260713` both resolve locally to S2 |

`git rev-list --all --children` returned exactly the chain `37eeb5b0 -> 449350d6 -> 74eb452e -> cf3416b`; C has exactly one visible child and S2 has none. The canonical detached validator independently returned `sealParents=[C]`, `directChildren=[S2]`, `commitCount=1`, and `202` bounded seal-diff paths. Thus the governing sole-child invariant is satisfied. The inverse statement “C is contained by the Role-4 branch ref” is false and is not a required canonical topology invariant: Role-4 is carried into C2 as its exact second parent, while C2R and S2 live on the integration branch.

## 3. All 15 governing Role-3 findings

Exact-set comparison among `STATE.md`, the correction closure receipt, the individual correction receipts, and candidate ancestry produced `15 fixed / 0 evidence-refused / 0 pending`. Every final correction/adjudication commit below exists and is an ancestor of C.

| Finding | Severity | Disposition | Final correction/adjudication commit | Receipt SHA-256 | Regression evidence retained/freshly covered |
| --- | --- | --- | --- | --- | --- |
| `R3-VAL-001` | Critical | `FIXED` | `53b3b65b36ea645e7c0f98e5c660db2112197736` | `2d64958f73b6517ac5a945db23c339afb0349b8b613d0b72da2a07e4426ffabe` | named exact-S `1/1`; all six regenerated artifacts equal; fresh acceptance contract `43/43`; canonical C/S validate-only pass |
| `R3-D-EGRESS-012` | Critical | `FIXED` | `003199ccd73672973bbe22513bac66d7a0a68a1d` | `d05da42152c2690ddf2f81429521a676d3ed0107695e4eaedf97e437852a7623` | fresh stream `14/14`, perimeter `2/2`, composition/ports `33/33`, app `82/82` with `0` prohibited attempts |
| `R3-D-SHA-014` | Critical | `FIXED` | `730d3f277b00b37b0f557da258e32abbba9914d5` | `f40cd956d04ad02f2ac9e6b926012fbf47009875b122b356bc76cc62d4621502` | correction `16/16` plus `52/52`; fresh I00 commands `28/28` and candidate/seal SHA binding pass |
| `R3-A-CHAIN-002` | High | `FIXED` | `e935559a4390d04cbd0f636ba8bac110d671cf26` | `60df6e5cd102c48aaa26c36d43261f4cc2ce21c9ba7606cc35e586571540e41d` | correction `85/85`; fresh System Integration `401/401`; six durable transitions, no venue send |
| `R3-B-RESTART-003` | High | `FIXED` | `96b5ad576bbe96f4ad03ef1aa07b5554e54c22dd` | `673507438cddf869764eba82dcab60092b8c2de72864a5a2158908eb288633f1` | correction `59/59`; fresh three-boot 503/restart/crash/recovery campaign pass |
| `R3-CPT-010` | High | `FIXED` | `cdc3d75a38f74411eecb9ec9736dc404bc0a4cd1` | `48e3ca13f1a9e8994d046e21bf75b5a2ad699e03dcc82f232b5707c1abce9631` | correction `4/4`, exact inventory `14`; fresh runtime inventory validated |
| `R3-CPT-011` | High | `FIXED` | `68bc44eac17e0196f0a18bbfd14b567860821058` | `b9b4cbe0a3980dbb3096931841021510959581e7427a009c37884fa586b15706` | correction `10/10`; fresh product-control and browser receipt validators pass |
| `R3-D-CRASH-015` | High | `FIXED` | `ce01f198a2d2585f85d7eb053966dcd8ec2b89d4` | `bc3e0ad2743d8882adc249b8e85ccdcdf71e4c6567fc280ce4b40272571ce263` | correction server `2/2`, browser `2/2`; fresh Product Integration `111/111`, Control `102/102`, SIGKILL recovery pass |
| `R3-A-CLIENT-004` | High | `FIXED` | `88d5719c2c4b6b63c1dc98078980f301aedc1f06` | `ce9bd36dffc01f76fa9fd70b6ec9b747c5fd02917938e5b0f42656b37d78afe0` | correction `6/6`, `33` expected identities / `14` canonical components; fresh inventory exact |
| `R3-A-ROUTE-005` | High | `FIXED` | `2da9b20b479449e603d20643e3db6726aed85939` | `27f962652d03999500532e3855dda624639d0831a62b525843cae8f04eaf444e` | correction `13/13`; sealed browser `126` route observations validated; app `82/82` fresh |
| `R3-D-RETRY-006` | High | `FIXED` | `5eeeb7dd465ad838cf10a17a829837706df1f5e6` | `f4e33f686c2025b3f6db180092d846c7e9cd909dd71c668d6fcc7887a9225a67` | correction `14/14 + 18/18`, max attempts `8`; fresh stream/scenario/live-edge suites pass |
| `R3-D-WATCHDOG-007` | High | `FIXED` | `b1a8af0edd3c847a382078985374e45bcd28f849` | `256746130d1433948be724f2bea4b1c2573893a53282dac3311a3148e68c15d2` | hostile `177/177`; unchanged watchdog `34/34`, deploy `52/52`, rollback `27/27`; fresh I00 aggregate includes `177/177` |
| `R3-D-BACKUP-008` | High | `FIXED` | `bc39e9b989d37d12c77ed3854adca97a847f51de` | correction `b7641a1986cf961b3b4a80f9c950e5264e6881d266a2f52cecb402f61390859e`; audit closure `c81a74ecb9bab5a6a517e18eed90dcd429dfd6dbf21e96fd8a4f071a2cb1f5e3` | fresh hostile staged-byte suite `109/109`; donor backup/restore `30/30`, restore drill `11/11`, scanner `13/13` |
| `R3-D-CLEAN-009` | High | `FIXED` | `35bcfe96314f5047957bdff251831ab309c9be19` | correction `3be8cfbdd7af78e50bba925b0548e075bfd86fe3dcad82cd330eaa7dc4dd146d`; audit closure `65ec81320e01faaf208ee7810c3a446ac69510dc038c2b490b1b70748538e953` | historical independent `12/12`, `725`, 186590-byte performance closure; fresh C campaign independently rerun and validated |
| `R3-STATE-013` | Medium | `FIXED` | `643d2e3e4d123edeaef550b4f050b7f7db7bbfaa` | `bb27b79b8bb5b51ee0f05517c48cf758e6482407ef0dfd8d362ecac03175bc75` | current exact totals: focused `155`, ops `384`, I00 `725`, Product Assurance `802+4`; fresh totals match |

Shared closure receipt: `docs/archive/i00-phase4/ROLE4_CORRECTION_CLOSURE_CHECKPOINT_RECEIPT.md`, SHA-256 `253dd036f99f8631b06b914a0c4d2a55a8803f3b514e71a7b84a5347ab75eb87`.

## 4. Four named FIX_AUDIT adjudications

| Audit item | Original audit ruling | Final adjudication and exact evidence |
| --- | --- | --- |
| `VAL-001` | `PARTIAL`; named test did not assert overall parity | `COVERED`: regression now asserts `result.passed === true`, six artifacts, and every equality bit; exact historical S and current C/S validate-only both pass |
| `WATCHDOG-007` | `REGRESSION_RISK`; mutation guard could orphan a lock | `COVERED`: token/inode claims, visible age-gated legacy guard, two-contender handoff, dead/incomplete/live claim cases; `177/177` fresh |
| `BACKUP-008` | `REGRESSION_RISK`; staged bytes could change before publication | `COVERED`: exact private snapshot plus pre/post publication proof for database/evidence/report and sparse-growth cases; `109/109` fresh. A later same-UID post-publication mutation is explicitly `NO_CHANGE` and outside the per-object publication invariant, not hidden |
| `CLEAN-009` | `PARTIAL`; original aggregate/performance commands not executed by the audit | `COVERED`: historical exact detached aggregate/performance byte receipt plus this verifier's new clean-detached `12/12`, `725`, and three-boot performance/semantic-validation pass |

Independent closure total: `12 COVERED / 0 PARTIAL / 0 REGRESSION_RISK`.

## 5. Candidate receipt, donor equality, exclusions, money dispositions, and Q ancestry

- S2 candidate receipt path: `cf3416bed284ffcd596f451a091985755f5e239b:docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md`.
- Git blob: `49cacfc4c67ec264dd445209d435d0d262cd8542`.
- Raw bytes: `187307`; SHA-256 `ce1d7d386a017bb1359a17d139e1d126200d85f9d2c0cd674be7f3081c028ecc`.
- Independent validator regenerated exact donor equality `expected=16 / discovered=16 / accepted=16 / integrated=16`; proof SHA-256 `4087828b10afb1291eeed1dbed77e14639581d23496f1766033ed5cbc556842c`; no donor-proof failures.
- Required-last L merge: `ec82bc51d5311dfb3f505216bfb3fa41733f038c`; the only authorized later donor merge is the exact C2 correction-source merge `449350d60ab30a385edeccdf4d91716ef8550537`.
- `A-FORMAL` tip `b491893416006cf529aef02e5dd4a25d6475e7b8`: `POSTLANDING_EXCLUDED`, not an ancestor of C.
- `A-ACTION-EVIDENCE-S2` tip `ca30adf5e97b6697afec49f13073024d953b117b`: `POSTLANDING_EXCLUDED`, not an ancestor of C.
- Q C17 `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`, tree `1aec7711f64419d50770d9c515d012173e982240`, is the sole/direct parent of A17 `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`, tree `5c86cebf0966cedd7ba01c56a01704b4f7bd0224`; both are ancestors of C. Q17 receipt SHA-256: `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc`.
- Ledger CAS request SHA-256 `79740ff5ef2951e96b5e3ea26acdc4aa786425ca3341335e55cef23d230c4f6f`: `IMPLEMENTED_EXISTING_LEDGER_NO_SEND_AUTHORITY`; `sendAuthorized=false`; external authorization `NONE`.
- Foundation quantity bridge request SHA-256 `9db092975a34c001f04412ef94644078009f90e5efc62ed258ced00aa38c4cb0`: `IMPLEMENTED_CONTRACT_NO_AUTHORIZED_PRODUCTION_CONSUMER`; `sendAuthorized=false`; external authorization `NONE`.

Canonical detached validation command:

```sh
npm run test:i00:complete -- --validate-only \
  --candidate-sha 74eb452efab89ca92ec9ff5cb192b723b5f198f3 \
  --seal-sha cf3416bed284ffcd596f451a091985755f5e239b \
  --performance-receipt test/i00/performance/evidence/local-proxy-performance-20260716022242828-76436.json \
  --browser-receipt test/i00/performance/evidence/browser/c2r-74eb452efab89ca92ec9ff5cb192b723b5f198f3/iab-c2r-20260716T020828574Z/local-browser-acceptance-74eb452efab89ca92ec9ff5cb192b723b5f198f3.json \
  --complete-receipt test/i00/performance/evidence/local-complete-acceptance-20260716022242828-76436.json
```

Result: exit `0`, `passed=true`, external actions `NONE`; log `/tmp/role3-c2-validate-only.log`, `173142` bytes, SHA-256 `69cc1c4490b0ae51bdd8868efeaa0f3e3931075b08416dcea20c3be7c6cf57d2`. It validated S2 topology, all `202` seal paths, the donor proof, six regenerated report-equality artifacts, the exact browser/performance/complete evidence, and the candidate receipt.

Sealed artifacts validated from S2:

| Artifact | Exact result |
| --- | --- |
| complete acceptance | SHA-256 `86758e950579d4a2af650c06e5d25e72f7fce4972bda947237e91803bb7deb2d`; `275994` bytes; `11/11` steps |
| performance | SHA-256 `5cd2484e6d9ca47548db1cf14684752e1a0005e301301e2aaa88eb8bd4aada21`; `186589` bytes; semantic pass |
| browser | SHA-256 `4276832ea8a8f4ebf1983dfe7409e6dddc7d579ade8573180ed182d80a6e5404`; `119003` bytes; six runs, `126` route observations, `194` artifacts, light/dark at all three widths, restart 1012 proof |
| generated reports | six of six regenerated byte-identical, including proof evidence SHA-256 `455e7b088aa9af7f65d57fe0d6e8886b13e1565232b0143775d9f77499bf6e3b` |

No new browser transcript was fabricated. Phase-3 validate-only independently read and validated every immutable browser artifact from S2, while the application and Product Control gates were freshly rerun below.

## 6. Fresh install and independent acceptance reruns

Fresh root hydration: `npm ci` exit `0`; `229` packages added, `232` audited, `0` vulnerabilities. Log `/tmp/role3-c2-npm-ci.log`, `293` bytes, SHA-256 `425aec1d52e7c2b70bd1c0f521ce143ad6ad2b0a2f4c293ba22b72bda0409e43`.

The exact A17 donor was exported to an isolated temporary archive. uv installed managed Python `3.13.14` and synchronized `65` distributions from `pyproject.toml` SHA-256 `a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81` and `uv.lock` SHA-256 `716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29`. Python binary SHA-256 is `091704d2238fa5d3d95299894a24d02fa0cf0f874d7b1cd019f9a19b767628ab`; `pip check` reported no broken requirements (log SHA-256 `9261363b733079a641c2e4cc9bc46ffa1d8336945a87f807b6cf68847dbc9b09`).

| Command/family | Exit and exact outcome | Evidence log SHA-256 |
| --- | --- | --- |
| exact Q17 donor suite | `0`; `384 passed`; branch coverage `96.50%` | `5e015ba643f9a2970c6cbff62618895c92221c83d65fec123cd80a12f073639e` (`2135` bytes) |
| exact full Q donor suite, frozen plugin policy, fresh-venv OpenMP path | `0`; `3011 passed`, `6 skipped` in `75.18s` | `de37f7fe04ff39e93f4e178264aee065ecf5bde59ac92f71c40719d77e8b592f` (`4146` bytes) |
| `npm test` | `0`; focused `155`; Product Assurance `518` files, `205/205` operation sites, `802` behavior + `4` provenance; acceptance `43/43` | `04c5b5dcb921f8e05e26a5015a3401fdb919601bc349defd4b5fc6602b35b743` (`45114` bytes) |
| `npm run test:all` | `0`; typecheck/build; app `82/82`; System `401/401`; Product Integration `111/111`; Product Control `102/102`; I00 proof `47/47`; commands `28/28`; live-edge `1618/1618` | `2e8f9cf94b6f93caf8fad39c0c865c75fdb3688415fde3538763827a90eacf8d` (`434024` bytes) |
| `bash ops/tests/run-all.sh` | `0`; `12/12`; exact footer sum `384` | `e9e1542acc1f92ed982110b6f85754214534404a0b88ccf843d00d9933fcb52f` (`31322` bytes) |
| `bash ops/tests/i00/run-all.sh` | `0`; `12/12`; `725` additive assertions, including backup `109` and watchdog `177` | `f2b5f7764fd097714190b2525bc243a463dbf934462c88da9de5668f5d1eed89` (`12094` bytes) |
| deterministic system scenarios | `0`; `SC-01..SC-30`, `30/30` | `9425eaadb1d18c817276455eeb32015648d36cf3caca66d7a151df7ed85ab882` (`2692` bytes) |
| focused financial/storage/access/stream/perimeter | `0`; `59 + 29 + 51 + 14 + 2 = 155` | `bf2de1e3db73d46ecc64e3ad2076af30c11b55821d10836705a27eb220b95815` (`21295` bytes) |
| System Integration | `0`; `401/401` | `7579da3992ad31311366237dc9c69c241985db70a7a8a8a655abaa71505c7622` |
| Product Integration | `0`; `111/111` | `3dbbd85d120df9f84bf4719da32f1f4332e33227c6fae1935553a761286bb5f6` |
| Product Control | `0`; `102/102` | `0d21f8993b7ef23eadc259b2861a518509f4f268aa02a735945f21e88a1026c0` |
| application gates | `0`; `82/82`; hostile ambient credentials caused `0` prohibited attempts | `10c1d1a0960588505cb5f8b511aad77a2f5a1a50593fdc3556ba14c26efcfd6d` (`6274` bytes) |
| I00 proof | `0`; `47/47` | `2c74817f2af766ef8312c156d744d7758f1b1ccefec1a16bfdb31810c875fb5b` |
| I00 commands | `0`; `28/28` | `ebdee0a5fe51e67c45911523953400558e6e0f6d9fad86355efdab85ced66c91` |
| acceptance contract | `0`; `43/43` | `3341bfe3cd252d93aa7e80700554f8133abe00368d078e7fc4c455a0218999d8` |
| composition + production ports | `0`; `33/33` | `d43cbb4c8d353af978dfb18f197114358fa63522f6a32ea19e53982bfcb70a99` (`3410` bytes) |
| direct Foundation reconciliation plus quantity bridge, Ledger CAS, restart truth/control, and authority slice | `0`; reconciliation `75/75`, Node `62/62` | `685ab73f7db61920b372ef9cc433dc26ab7dee2aa79024cfb44674132734a856` |
| direct live-edge crash/restart/reconciliation/ambiguity slice | `0`; `34/34` | `c865d4970463634f9ea75e6638a2268ce3a1fcf2d1e690142654972ddec6e21f` |

The first full-Q collection under the frozen plugin policy but without a macOS OpenMP loader path failed honestly with seven collection errors; log SHA-256 `fa63b3f5ab660b0a0f9a939896ee0f7171ec01a49cd3542ff64fb5a36a503f04` (`20424` bytes). The fresh virtualenv itself contains `sklearn/.dylibs/libomp.dylib`, SHA-256 `7fe04d06d824817d39e4c99ec44e837fd6b5f0f75f2cc3e77a384c298f3f1709`; rerunning with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` and `DYLD_LIBRARY_PATH` pointed only at that fresh-venv directory produced the governing `3011 + 6` pass above. This records the platform loader prerequisite and does not claim a path-free macOS Q environment.

## 7. Fresh runtime/restart/recovery campaign

Exact command:

```sh
npm run test:i00:performance -- \
  --duration-seconds 60 \
  --tested-sha 74eb452efab89ca92ec9ff5cb192b723b5f198f3 \
  --out role3-c2-fresh-performance-20260716.json
```

Generator exit `0`; log SHA-256 `14f7e1281b7190f4949633385c194e997837c40541e81e1299824de49ef22ec2`. Exact receipt copied outside the repository for this receipt's evidence: `/tmp/role3-c2-fresh-performance-20260716.json`, `186616` bytes, SHA-256 `dcd2449600f3fdd89ffad6fad8affd34ac298d2107858b758a6e7f9a36dea5d3`. It was then placed only in ignored dependency storage for canonical validation and removed; no runtime JSON remains in the repository.

Canonical receipt validation: exit `0`; schema valid, semantic failures `[]`, secret findings `[]`, `passed=true`; log SHA-256 `0c1bee06e811d8b9f7ace40f1003a18e7e0cdc6c14b1cfc75d9e536eb53d9f13`.

| Phase | Exact observations |
| --- | --- |
| generation 1 `CANONICAL_RESTART_GATE` | `481/481` HTTP responses, `0` unexpected, `0` network errors; four WS `1012`; graceful SIGTERM exit `0`; SQLite quick/full checks `ok`; owner-gated restart persisted rejection audit, no success receipt, code `RESTART_EXPOSURE_NONE_NOT_PROVEN` |
| generation 2 `UNCLEAN_TERMINATION` | `481/481`, `0` unexpected/errors; four WS `1006`; expected SIGKILL; no clean marker; WAL retained for application-first recovery |
| generation 3 `POST_CRASH_RECOVERY` | `481/481`, `0` unexpected/errors; four WS `1012`; graceful SIGTERM exit `0`; quick/full checks `ok`, zero foreign-key violations; three boot rows with crash-pending generation `2` preserved; events nondecreasing `96 -> 236` |

All continuity booleans passed; every boot projected exact C; deployed SHA remained absent; readiness and trade-readiness remained honestly `503`; ops interlock remained blocking; external-action authorization remained `NONE`. SLO result `PASS`, invariant failures `[]`, secret scan `10` artifacts / `0` findings. Observed bounds: CPU p95 `2.256%`; event-loop p99 `31.015ms`; RSS max `453853184`; WAL max `2488512`; HTTP p95 `26.402ms`; unexpected responses `0%`. Production capacity remains `UNKNOWN`; short-window RSS slope and other unexercised production metrics remain `NOT_CONFIGURED`.

## 8. Phase-3 A–D ruling matrix

### A. Integration completeness

| Invariant | Independent ruling |
| --- | --- |
| accepted donor equality and omission | `PASS`: regenerated `16/16/16/16`; proof SHA bound; zero proof failures |
| dirty/partial promotion and ownership paths | `PASS`: detached clean C; exact receipt/path inventories; Role-4 correction tree carried by exact merge; six generated reports equal |
| duplicate authority/lifecycle | `PASS`: architecture owner map plus `33/33` composition/ports and `401/401` System Integration; no competing send, ledger, risk, reconciliation, socket, or supervisor owner found |
| protocols/routes/persistence/types | `PASS`: Product Integration `111/111`, Product Control `102/102`, I00 proof `47/47`, commands `28/28`, browser receipt pass |

### B. Product behavior

| Invariant | Independent ruling |
| --- | --- |
| one build/start and real public Basis/Volume progress | `PASS`: fresh typecheck/build; fresh runtime saw advancing Spot/USD-M, Basis, Volume, and public BTCUSDT messages on each boot |
| Capital/Risk/execution/reconciliation/recovery/ledger chain | `PASS WITH HONEST NON-LIVE POSTURE`: System `401/401`; scenarios `30/30`; direct reconciliation `75/75`; external authority `NONE`; live execution absent |
| ambiguity/idempotency/restart/reconciliation | `PASS`: direct money/restart slice `62/62`, live-edge slice `34/34`; restart blocks before truth and crash generation remains visible |
| kill switch/caps/failure closure/product distinctions/temporal evidence | `PASS`: scenarios SC-11..SC-25, focused `155`, live-edge `1618`, Product Integration `111` |

### C. Cockpit truth

| Invariant | Independent ruling |
| --- | --- |
| expected/current/stale/silent/missing comparison and no false green | `PASS`: exact managed inventory below; overall ready/trade-ready `503`; missing instrumentation cannot become green |
| controls map to backend command/durable result | `PASS`: four canonical controls are `WIRED_LIVE`; keyless restart attempt was rejected and durably audited, never presented as accepted |
| routes and unsupported states | `PASS`: sealed six-run browser receipt validates 21 pages per run, all themes/widths, `126` route observations and explicit non-green truth; app `82/82` fresh |
| safety/dependency/recovery/money/forensic views | `PASS`: browser `194`-artifact inventory plus Product Control `102/102`; unsupported owner-gated controls remain disabled/labeled |

### D. Reliability, operations, and security

| §D invariant | Independent evidence and ruling |
| --- | --- |
| operation-specific bounded retry, idempotency, ambiguity | `PASS`: stream `14/14`, scenarios `30/30`, direct live-edge `34/34`, live-edge full `1618/1618`; ambiguous outcomes stay unknown and are not resent |
| fencing and stale completion | `PASS`: Ledger CAS/quantity/restart slice `62/62`; watchdog `177/177`; System `401/401`; stale writers/owners and post-commit listener failures cannot forge results |
| repair cannot increase capital, clear liability, hide incident, or bypass owner | `PASS`: reconciliation `75/75`, Product `111/111`, I00 proof `47/47`, System `401/401`; recovery remains risk-reducing/owner-gated |
| gaps, rotation, rate limits, backpressure, WAL/disk, telemetry/provider failure visible | `PASS`: SC-01..SC-30, stream `14`, Product `111`, acceptance `43`, fresh WAL/crash performance. Slow-consumer close `1013` was not reached and is not claimed; bounded pause is recorded `NOT_OBSERVED` |
| watchdog/out-of-band evidence independent of app survival | `PASS`: I00 watchdog `177/177`, donor watchdog `34/34`, frozen/missing-backup/dead-lock evidence survives app-owner failure |
| backup, isolated restore, rollback, graceful shutdown, crash restart | `PASS`: backup hostile `109`, donor backup/restore `30`, restore drill `11`, rollback `27`, ops `12/12`, I00 `12/12`; fresh SIGTERM/SIGKILL/recovery campaign passes |
| no secrets/private keys/withdrawal-transfer/public port/unauthorized mutation | `PASS`: app `82/82` with zero prohibited attempts, focused perimeter `2/2`, secret scanner `13/13`, fresh receipt secret scan zero; no private/signed/money/cloud/deploy action run |
| reported/deployed SHA cannot silently differ from candidate | `PASS`: all three fresh boots report exact C; deployed SHA absent; candidate/seal validator, I00 commands `28/28`, acceptance `43/43`, and sole-child proof pass |

## 9. Advisory V1–V5 shard aggregation

These receipts are advisory and were not used as substitutes for the independent critical reruns above.

| Shard | Receipt SHA-256 / bytes | Advisory state | Adjudication |
| --- | --- | --- | --- |
| V1 | `c724078f1948e967182f0cfdb01614efbda793e9a89d089bb28d2e9146a8538f` / `6092` | `BLOCKED_PRECONDITION`; no build/tests | stopped on literal Role-4 branch containment, not a product failure |
| V2 | `bc288c48d16ee0d67b36cb5dd1c5b4d465764565baa26c65fad474fb0e7c2383` / `12563` | `BLOCKED_PRECHECK_BRANCH_CONTAINMENT`; no campaigns | same over-literal containment interpretation |
| V3 | `c757cfe9a91af7f63d05431f8850efb9482d03c782e81448e1bbc060f06494f9` / `7970` | `BLOCKED_PRECONDITION`; no browser campaign | same topology precondition; canonical browser evidence was independently validated here |
| V4 | `e9e0d212dde399d4f33f2ec65eb0ceec4a51396a043970e409c064ed40edc2c7` / `6837` | `BLOCKED:ROLE4_BRANCH_DOES_NOT_CONTAIN_CANDIDATE`; no security campaign | same topology precondition; security/authority classes independently rerun here |
| V5 | `436ea50e720069a7add4864b73354efecfc66c149a5423ae6699f43ab8250ab4` / `21887` | `V5_RECEIPT_READY` | corroborates fresh performance and both ops aggregates |

The shard disagreement is resolved by immutable Git facts and the canonical validator: `role4-fix-20260715` is the exact correction-source ancestor merged into C2; C/S2 belong to the integration branch. I did not mutate any shard or ref.

## 10. Honest live/synthetic/unwired/blocked inventory

Fresh runtime managed inventory: `33` expected identities; `14` evidence-present, `13` owner-gated, `3` not configured, `3` missing. The `14` canonical components are `8 READY`, `2 DEGRADED`, `3 BLOCKED`, `1 RECOVERY_REQUIRED`, `0 STALE`, and `0 SILENT` in the measured snapshots.

- Live public/ready: Spot source, USD-M source, market universe, intelligence runtime, market intelligence, Basis engine, Volume engine.
- Ready replay: existing ledger persistence.
- Degraded/non-green: Q inference `NOT_CONFIGURED / ABSTAIN_UNKNOWN`; engine supervisor `UNKNOWN / EFFECTIVE_INTAKE_PAUSED`.
- Blocked/unwired: Capital supervision, multileg risk, and validate-only execution owner projections.
- Recovery-required: reconciliation owner projection.
- Expected identities explicitly missing from the local managed process: backup/restore, external watchdog, Cloudflare tunnel/access. Their local simulation/ops artifacts pass; no live deployment claim is made.
- Four canonical controls are wired to the real server owner. Managed restart remains owner-gated under keyless unknown-exposure truth and produced only a durable rejection audit.
- Active capital ceiling: `UNKNOWN / UNAVAILABLE` because private account truth and production capital authority were not authorized.
- Execution mode: `VALIDATE_ONLY` contract evidence only; `LIVE_EXECUTION_NOT_IMPLEMENTED`; money action authorization `NONE`.
- Deployed SHA: absent/not run. Verified SHA: C. External deployment, private reads, signed calls, live/test orders, borrow/repay, leverage/margin mutation, transfer/withdrawal, AWS/Cloudflare mutation, and push remain outside this verdict.
- Remaining owner-only configuration includes operator identity, private/account truth, Q production transport/champion, capital/risk/execution projections, production restart authorization, incident routing, external watchdog/backup/tunnel lifecycle, and real deployment readback.

## 11. Findings and verdict boundary

No rejection finding survived independent reproduction. Therefore no finding ID/severity/invariant/evidence/repro/expected-actual/correction-boundary record is emitted.

This verdict certifies only the exact frozen candidate and sole-child seal under the documented local acceptance boundary. It does not authorize landing, deployment, private/signed validation, money paths, or production capacity claims. The sole director must still perform Phase 5.

VERIFIED_CANDIDATE
