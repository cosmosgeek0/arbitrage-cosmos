# Donor provenance audit

**ADVISORY PRE-VERIFICATION EVIDENCE ONLY. ROLE 3 MUST VERIFY EVERY FACT INDEPENDENTLY AGAINST THE FROZEN CANDIDATE.**

Audit role: D-LAUNCH-19 pre-verification worker

Audit branch/base: `preverify-20260714` / `0bbf23c06c60c1a4553422f099d8b242f13b6dc5`

Base tree: `3ed205eab255d230bbc44d0b623b9e500b5ccb69`

Observed integration ref: `i00-product-assembly-20260713@139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9`

Observed integration tree: `84dd406f40c66c6771daee657a51224393a7d8d6`
Method: immutable Git objects and refs only; no network, checkout, merge, build, test, external action, secret access, or other-worktree filesystem inspection.

## Executive verdict

The 15 requested branch tips all resolve and every local branch ref equals the supplied tip. Fourteen tips carry an immutable accepted/prestage/ready receipt consistent with their bounded disposition. **A-FORMAL does not.** Its latest reseal passes a scope audit but preserves terminal `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED`; its packet state is blocked; Role 2 separately refused it. Therefore Git does not support a claim that the requested set is `15/15 receipt-accepted`.

The observed integration ref is not a candidate. For the requested set it contains 12 exact donor ancestors, one explicitly receipted dashboard subtree equivalence, and omits exact L and A-FORMAL. Its own 15-donor denominator uses a different set that includes F-BRIDGE and SI-RECON and excludes L/A-FORMAL. D-LAUNCH-19 says the final regenerated set is 15 including L. The final candidate must reconcile that denominator from Git; this audit does not choose one on Role 3’s behalf.

All mechanically attributable worker path sets are within their recorded ownership. L and S4 contain canonical director-merge history outside their worker roots; those exact paths are identified below and must remain exemptions, not be misreported as worker authorship. Static import-purity/duplicate-authority scans found no new live executor, ledger, exchange transport, strategy owner, capital/risk owner, production socket, or secret boundary in the donor-owned source. Several final-candidate integration risks remain and are listed as findings.

## Source authority

| Source | Git identity |
| --- | --- |
| I00 parent directive | blob `58e6fbfb1369b4721e0fcd2f94495221ec67f30d`; SHA-256 `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| IP-RUNTIME directive | blob `430a2727e0e74712f6b67c2148961075e2fe86b8`; SHA-256 `6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810` |
| IP-CONTROL directive | blob `63df166f8d61fa3b84faf061e4c78dd9a31736c7`; SHA-256 `5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278` |
| IP-OPS directive | blob `a25cbd1d1a695296c635560c962840d579a16a04`; SHA-256 `2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779` |
| IP-PROOF directive | blob `a72e951378584735655c7a1a2a625527dbfee1f8`; SHA-256 `e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6` |
| Canonical authority map at audit base | `ARCHITECTURE.md` blob `93d7604599b43109eb67433e85101009c3f82b8e`; SHA-256 `beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db` |
| Living director ruling | `current-main@bf262c08984cf05cb84425e850b187af5f8adf03` (`D-LAUNCH-19`) |

The protected directives are owner inputs rather than donor payload. Their blob and raw hashes bind the law; they are not counted as donor paths.

## Exact donor identity and receipt ledger

| # | Donor/ref | Recorded base | Exact tip | Exact tree | Terminal receipt and disposition |
| ---: | --- | --- | --- | --- | --- |
| 1 | Q / `quant-edge-research-factory-20260712` | `73e1a1ff7daa48df8dac45713fc5f106842edafc` | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` | `5c86cebf0966cedd7ba01c56a01704b4f7bd0224` | `quant/RECEIPTS/Q17_ACCEPTANCE.md`; `ACCEPTED — LANE_READY` |
| 2 | L / `live-execution-control-proof-20260712` | `73e1a1ff7daa48df8dac45713fc5f106842edafc` | `df6b472993ca9659ce09cf5f72004981c6835f0d` | `1add5ee43fea623509c20d0990ec9efac2543fc4` | `live-edge-receipts/RECEIPTS/L17_ACCEPTANCE.md`; `L17 ACCEPTED / LANE_READY_BUILT_AND_TESTED_UNWIRED` |
| 3 | Dashboard shell / `dashboard-shell-20260712` | `0f2bb884daf5b67981ea04f38298d89c1a980de7` | `692501587617d4880303fbd747d93e63c376f088` | `61d0c5a3e9146fc0b78d8c7fce3e7ebdfbc3b46d` | `web/src/features/systemDashboard/RECEIPT.md`; fixtures-only/unwired accepted shell |
| 4 | L15 infrastructure / `l15-deploy-infra-20260712` | `0f2bb884daf5b67981ea04f38298d89c1a980de7` | `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` | `e401435d6a650aee8a29c3da4495b4db426be017` | `ops/live/RECEIPT.md`; `ACCEPTED`, artifact-only |
| 5 | IP-RUNTIME / `ip-runtime-20260713` | `420cc83e5512d54ca1b1c064c1041d89b23914a0` | `8058ab8febb639839333d4e2c604068a0c7390ea` | `dd255f23310c846ab0b3ea0c3bebb6a765ecddd0` | `IP_RUNTIME_RECEIPT.md`; `PRESTAGE_READY` |
| 6 | IP-CONTROL / `ip-control-20260713` | `420cc83e5512d54ca1b1c064c1041d89b23914a0` | `56c47dad398c485b6653036c8b90c53f11061b1e` | `e335fc95be7a24da828b14c205f39ea3666dd385` | `IP_CONTROL_RECEIPT.md`; `BINDING_READY` |
| 7 | IP-OPS / `ip-ops-20260713` | `420cc83e5512d54ca1b1c064c1041d89b23914a0` | `6bfd543afb693ea18f4baf08e962e6d698f140fb` | `572adc3c19d9052fc26398875230437505f5c97e` | `IP_OPS_RECEIPT.md`; `OPS_READY` |
| 8 | IP-PROOF / `ip-proof-20260713` | `420cc83e5512d54ca1b1c064c1041d89b23914a0` | `23e985c17b9b860fee26be397fa05b26f3daf8f2` | `1329fe73139016cf728d47551c75f7ca69daa558` | `IP_PROOF_RECEIPT.md`; `PROOF_PRESTAGE_READY — FIXTURE ONLY` |
| 9 | A-CORE / `ip-assurance-20260713` | `9785c93102b00389847b77c2f9348c06abc4344b` | `08a0a09780727e2b4ba59017b5701998abe29b77` | `b904ca0f5b6f7c8df294274351611635560f80f7` | `fixtures/productAssurance/receipts/IP_ASSURANCE_RECEIPT.md`; `CORE_SCAFFOLD_READY`, overall assurance ready not claimed |
| 10 | A-HAZARD / `ip-assur-hazard-20260713` | `9785c93102b00389847b77c2f9348c06abc4344b` | `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` | `e33224d4b2e6b018fd39bfdcb403b3d88e74712f` | `.../HAZARD_D_LAUNCH_10_AUDIT_RECEIPT.md`; `HAZARD_PRESTAGE_READY` |
| 11 | A-FORMAL / `ip-assur-formal-20260713` | `9785c93102b00389847b77c2f9348c06abc4344b` | `89c783bd9e55ce83c21ed1181757122d88e4c980` | `bb444b7ea959f086bbc1d1021b6f9b45e0fadf79` | `.../D_LAUNCH_10_COMPLIANCE_RESEAL.md`; **`BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED`** |
| 12 | A-COCKPIT / `ip-assur-cockpit-20260713` | `9785c93102b00389847b77c2f9348c06abc4344b` | `d4ff9c94c9fec9477481223c4b33d8f671a34f6d` | `bda9b452c9e6564576fa3cd390a5981cd6907c09` | `.../COCKPIT_PRESTAGE_RECEIPT.v1.json`; `COCKPIT_PRESTAGE_READY` |
| 13 | A-AGENT / `ip-assur-agent-20260713` | `9785c93102b00389847b77c2f9348c06abc4344b` | `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437` | `e68ef10d09c11bc5623099a2eb6eb6881054486b` | `.../AGENT_BOUNDARY_PRESTAGE_RECEIPT.v1.json`; `AGENT_PRESTAGE_READY` |
| 14 | A-STABILITY / `ip-assur-stability-20260713` | `9785c93102b00389847b77c2f9348c06abc4344b` | `d35674e7f9621320c35e0bc0270efd515cc64dbd` | `16c92923b837105471b232df0480d1270bda756e` | `.../STABILITY_ACCEPTANCE_RECEIPT.md`; `STABILITY_PRESTAGE_READY` |
| 15 | S4 assurance case / `ip-assur-case-20260713` | `c57610cb5f7d56efb61e53ae27057fbe92a6a2f6` | `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c` | `3c773878016f4a56c6b03fe6485a42b002c3f5d2` | `.../CASE_ACCEPTANCE_RECEIPT.md`; `CASE_PRESTAGE_READY` |

Every recorded base above is an ancestor of its donor tip. The four IP tips are linear two-commit descendants of their common base. The base trees are: protocol `165a6fa46ebe124e7ddc5002fb1c5794ff4e2264`; satellite cut `ef97c25df61081efa56ea75074a2e0cc2f9e0e70`; IP packet base `e96f3d472556ba99bef6205952d7a4a104b66e59`; assurance base `2273a2a2a64a9c6c2b5e97d00dc85e2e9b0d09c0`; S4 base `581688a61fe9f4be6cc585b915a5e3619721ecfa`.

## Receipt object hashes

| Donor | Receipt blob | Raw SHA-256 |
| --- | --- | --- |
| Q A17 | `3dad68c9dc52e97aadaec173930388e3404769e7` | `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc` |
| L root / L17 acceptance | `befcc4c216baba0460985b37b8085e043b012a97` / `8176840928b59e9df7477f18b76238bc38459c97` | `0b95db6e0ae8777d3e3bebb1a510561c7dfc9dcba963bd02fbc91025dd784fe2` / `f23e078fdd1cf8d64585c01b677817d4d4efa3a08f9c4933acae09b399ce2381` |
| Dashboard shell | `4a7b289d91290cacd44a11ce8f987a4dec5a38a8` | `878cc578d88f38ca3bf8edce554b2cb258b4e9309718854f7ba18c33cb50b968` |
| L15 infrastructure | `7fc3520d4fede577937c6dd48c191b1e5d212061` | `d5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293` |
| IP-RUNTIME | `2278409e39302ada6f54e00c76eb9d89144d7538` | `8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb` |
| IP-CONTROL | `b746b439430c24176cd52e82eaa3380ea9dcf93a` | `4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7` |
| IP-OPS | `b5363f10dacd5534d56d511ddc3ec48499667ff0` | `57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922` |
| IP-PROOF | `6529ff56033c04dfc9d47646352d11a418771f3a` | `569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b` |
| A-CORE | `ad22f9ab75deffcb62fa2a6986dbed6ac61595b2` | `93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e` |
| A-HAZARD audit | `5dc3bd4bafe7eb9a42e9547989cd7f488eb72c74` | `ecfca4e7d60d9dca3b07e4e21d4595ebb234dab421924f14226cf39f8a9c85ea` |
| A-FORMAL blocked reseal | `d4130e0b41262e1fe387c1433fd1af0021d957d6` | `d693696aa339d490ef58fee2bf4c833ce660d6a265391c5363079b32d62a165f` |
| A-COCKPIT | `e02c7f40eec4aad271ee47461e1c8a313709b588` | `b75055388f99632f2dc5ebb87d92b6d969f666397014e89a616a6e262f0650dd` |
| A-AGENT | `1c2fb625a3d90ece61a44c56adc9788063badb99` | `c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c` |
| A-STABILITY | `d441a5d23bf87178af47b143e4a955d826aeb711` | `b26f902d90fb82633ac8532d5aa82169801ded3ec6d7bcf3477737a64eab2168` |
| S4 case | `0a10dd8b21b52b40a392a2fa8b11dc949aea649c` | `05369b8aa403a4fae6b86143ddcb7d61551d5996838c92b9bc4aba79401a3550` |

The A-FORMAL row is a receipt of a blocked terminal, not an acceptance receipt.

## Q C17 → A17 mapping

- C17 implementation: `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a`; tree `1aec7711f64419d50770d9c515d012173e982240`.
- A17 frozen/accepted tip: `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`; tree `5c86cebf0966cedd7ba01c56a01704b4f7bd0224`.
- C17 is A17’s exact direct parent. A17 changes only `quant/QUANT_EDGE_BUILD_STATE.md` and adds `quant/RECEIPTS/Q17_ACCEPTANCE.md`.
- C17 changes exactly 28 declared Q17 paths; path-set SHA-256 `604cdd885b4b61211b5408bf6abadb36382fb79b2b52d015ba459521fd33f8c6` using the receipt’s no-final-newline convention.
- C17 implementation receipt blob `8f4cf9cea5f1751ae30d4b00e552825de54a9a9c`, SHA-256 `057617ed928bc61964a38efc22e185a65f2b5c4a14215928c8d228b4626db32f`.
- At the observed integration tip, merge `042dc9897d04bed2b0de3043cbdcbac408251412` has exact Q tip as second parent. All Q paths are byte-identical except `quant/DIRECTIVE_INPUTS.lock`, whose D-LAUNCH-1 authentic-digest correction is explicitly receipted. Role 3 must verify this equivalence; whole-subtree equality would be false.
- Q remains `ABSTAIN_UNKNOWN`, `DATA_INSUFFICIENT`, edge `NOT_ESTABLISHED`, model payload unavailable/non-loadable, and execution authority false.

## Changed-path ownership proof

Path hashes below are SHA-256 of `git diff --name-only <base> <tip> | LC_ALL=C sort`, including the final newline.

| Donor | Changed paths | Sorted path-set SHA-256 | Ownership result |
| --- | ---: | --- | --- |
| Q | 504 | `e8cf75f00380d265671227553c7019741fa0feb2004cfe37be56d66c592c11d8` | All under `quant/**`; pass |
| L, full protocol-base delta | 318 | `2e791215fc8313452043940b663a33bd2171cd35199eff1f43b8fce06ea116e4` | 300 lane paths + 18 exact director-imported canonical paths; see exception proof below |
| L, final worker baseline `3a8e17b…` to tip | 52 | `1a30b6083fc2870bb7d42d2a3f7684005cdcba95a613dc72d2afd99277c7b00f` | Every path allowlisted; pass |
| Dashboard shell | 22 | `49400222f70044a8fe851b26123a59cba7cc973f8a346de20aceb0e60f70419c` | 21 `web/src/features/systemDashboard/**` + one integration note; pass |
| L15 infrastructure | 49 | `53eb561436e17552056ce5e2c0f063494e8b9182fa629b2a1eef9bcd69d80b9f` | `ops/live/**`, `ops/tests/**`, one integration note; pass |
| IP-RUNTIME | 28 | `31278fc1db060f1d2c8c7757ce3d039e2c285d756f21ef3fd9b4335904549290` | 28/28 frozen packet territory; pass |
| IP-CONTROL | 46 | `9d2843ef96fd70db985c1bade1538229eb4c33731c6b5ce7aab5b3e7a8276937` | 46/46 frozen packet territory including exact shell exception; pass |
| IP-OPS | 72 | `644e6af40aa27b1ab508ea515aa8bc92c50e7ceea45a2af801c0aaf0500eb9e0` | 72/72 frozen packet territory; pass |
| IP-PROOF | 24 | `b50872d2c91948694b14b60d871f5572bb9ceb06ff39e011699fa0881bd655dc` | 24/24 frozen packet territory; pass |
| A-CORE | 36 | `9ee8554b60e5e580169b65671baf9899d53d46a79e500a1004230ece81c9af5e` | Core production-assurance/fixture/test roots only; zero satellite paths; pass |
| A-HAZARD | 24 | `f715f96f1a77bd37acc5810acf6121af622cf404441345eeca4f28b0129946e2` | Hazard fixture/test roots only; pass |
| A-FORMAL | 49 | `7a2287a413eca5d9a51c0b29559685592466c2614be434291955f4f29fdd2dcf` | Formal fixture/test roots only; scope pass does not cure blocked terminal |
| A-COCKPIT | 53 | `870d23aebb1d60b12eabb91364a134b97569dc21ba4345618282b1355d39e01d` | Cockpit/observability fixture/test roots only; pass |
| A-AGENT | 20 | `11a0a317f05371d5a9378776cc0d7343a5d4a622c5f19dce2c2f6dbe8a5d6b27` | Agent-boundary fixture/test roots only; pass |
| A-STABILITY | 19 | `84b18ffcfd1893442eedacad74d4ef94823a4f5d846a1a5362e859ed6c5cc117` | Stability fixture/test roots only; pass |
| S4, full assigned-base delta | 46 | `b8166a464b29abe060874b32976aa79445fa58e4c8b327a216537be45f3ffc4e` | 41 owned + five exempt director-merge paths |
| S4, owned subset | 41 | `cf1c711e8688e5d00382b244566d210f5eabbfad30d622ae49a33b6380d358cc` | All under assuranceCase fixture/test roots; pass |

### L director-imported path proof

The 18 full-base exceptions exactly equal director merge `d0fdfccabfed57d3ee763904e338ffd1b6cbad75`’s first-parent import. They are canonical board/receipt/assurance material plus Foundation/SI corrections, not unexplained L worker expansion. Three Foundation paths were later changed under the explicit D-LAUNCH-12 L09 owner widening and sealed through accepted L09; the remaining 15 were unchanged after the director merge. D-LAUNCH-16 sets final worker baseline `3a8e17be71d21df14f6b236a563cb0595f9eb824`; every subsequent path is allowlisted.

The full-base `git diff --check` reports only inherited trailing whitespace in `IP_ASSURANCE.md`, whose blob is identical before the L worker range and at the audit base. The final worker-range diff check is clean.

### S4 director-merge proof

The five non-S4 paths are exactly `QL_DIRECTOR_STATE.md`, `QL_PARALLEL_DAG.md`, `SI_RECON_RECEIPT.md`, `WORKER_PROMPTS.md`, and `server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs`. Two-parent `director:` merge `2d840599c716b5da8f5c42a272fc2232792f868c` introduced them; they are byte-identical to its second parent. Every worker-authored path is inside the two S4 roots.

## Dashboard and infrastructure equivalence

Dashboard shell is not an ancestor of IP-CONTROL. Both contain the exact 21-file `web/src/features/systemDashboard/**` tree `d3d899db3b0395532a3cf12b2304e91a2ce528ce`; IP-CONTROL’s receipt records 21/21 exact blobs. The shell’s 22nd path, `DASH_INTEGRATION_NOTES.md`, is not present in IP-CONTROL and is explicitly superseded at integration. Count this as receipted equivalence once, not two donors or two UI authorities.

L15 is not an ancestor of IP-OPS. IP-OPS pins L15 tip/work/base, `ops/live` tree `584163858a0333cb1ccb9eff756e91a851b1cb71`, `ops/tests` tree `f3348a74ef22d9ca2faee431ea8cc5df63f552af`, and delegates to those artifacts without copying their paths. Final activation must retain one governed deployment chain; raw L15 tools and IP-OPS wrappers cannot become competing operators.

## Static duplicate-authority and import-purity scan

The audit scanned immutable changed-source blobs for cross-owner imports, production inbound imports, filesystem/network/socket/database/process/timer/environment/random/ambient-clock primitives, dynamic import/eval, credential/action-client identifiers, new executor/store/cache/queue/server constructors, symlink/gitlink modes, and forbidden money/withdrawal/transfer surfaces. It also compared recorded subtree hashes and receipt artifacts.

| Donor family | Git-backed result | Final-candidate checkpoint |
| --- | --- | --- |
| Q | No executable environment read or ambient randomness. Network use is confined to the declared Q16 UDS/literal-loopback boundary; bounded subprocess use is protocol/benchmark tooling. Research queues/stores/`TrialLedgerV1`/risk-shaped types are advisory research objects, not production owners. | Ensure no public listener, production ledger/store, strategy decision, Capital/Risk or execution authority is mounted from Q. |
| L | 98 TypeScript source files; only ambient Node import is deterministic `node:crypto`; zero source imports of fs/net/http/child process/process/timers, zero `process.env`, `Date.now`, `Math.random`, `fetch` or `WebSocket`. Cross-owner imports are contracts/types or Capital exact-decimal leaf. | Keep journal/policy/control/lifecycle modules as injected non-sendable projections. The signed kernel has an injected `sign()` port but no credential/transport access; do not wire it without separate authority. |
| Dashboard shell | Runtime imports are React/ReactDOM and local/type-only contracts; no fetch/socket/storage/timer/env/server import. It is fixture-only. | `presentation.ts` contains inventory/freshness/attention/control consequence derivation, and `ExposureBanner` can map parse failure/null to zero. Role 3 must prove final live binding consumes canonical backend truth and cannot hide unknown exposure. |
| L15 | No secret or money path. Effectful deployment/rollback/systemd/backup tools are intentional ops artifacts; optional network benchmark requires two explicit guards. | Keep artifact-only until owner authorization. Sanitize sourced env and `bash -c` probe seams; production restore remains blocked; raw and wrapped entrypoints must not compete. |
| IP-RUNTIME | Imports only canonical contracts, intra-packet modules and deterministic Node utilities. Zero effectful ambient boundary in `server/src/productIntegration/**`; memory ledger exists only in fixtures. | Ensure Product supervisor projection composes the canonical supervisor and never becomes a second lifecycle/domain owner. |
| IP-CONTROL | Same-origin HTTP only; no server/private/domain-owner import or socket/database/env primitive. Fixture command mutation is fixture-only and controls default disabled. | Only authenticated server-returned `WIRED_LIVE` commands may enable; no browser strategy/risk/readiness recomputation. |
| IP-OPS | Expected filesystem/child-process effects live only in the ops adapter; no domain imports. Wrappers validate and delegate to L15. | External mutation remains exact authorization-gated; artifact existence is not deployed truth. |
| IP-PROOF | No production path changes/imports; scanner hits are hostile strings/regex definitions. Its own catalog records `authorityConverged=false`. | Do not promote `PROOF_PRESTAGE_READY` into final authority convergence without candidate rerun. |
| A-CORE | Outside-family imports are deterministic crypto plus canonical time/constants contracts. No Q/L/Binance/Capital/intelligence import, effectful ambient primitive or inbound production wiring. Authority-like retry/circuit/lease/repair evaluators are pure assurance contracts with authority false. | Keep observer/contract-only. Tip follows the named tested commit with generated/receipt/state-only changes; rerun exact tip and resolve remaining insertion seams. |
| Assurance satellites | Hazard/Formal/Cockpit/Agent/Stability/S4 source is packet-relative (plus deterministic `node:crypto` where stated), with no production/Q/L/exchange imports, ambient clocks/randomness/timers/network/env or mutation authority. | Keep packet-local/synthetic. Stability resource owner remains `UNKNOWN`; Agent provider remains deterministic stub/not configured; S4 authority effect remains none. |

Committed import-purity proof identities include L’s `server/test/liveEdge/security/import-purity.test.mjs` blob `9876eb8546f07ace7e871727d32918c43e4f5373`, SHA-256 `eeb9ee6bae7ababe146b55707850ecb76ad16947ff08a74369400aa20acef0bd`. Receipt-reported gates were not executed by this worker.

## Presence in the observed integration ref

| Requested donor | `139d2cf…` disposition |
| --- | --- |
| Q | Exact ancestor via merge `042dc9897d04bed2b0de3043cbdcbac408251412`; one receipted lock correction |
| L | Not ancestor; exact eligible last merge still pending at cutoff |
| Dashboard shell | Not ancestor; exact 21-file subtree equivalence through IP-CONTROL |
| L15 | Exact ancestor via `35672dc…`; artifact-only |
| IP-RUNTIME | Exact ancestor via `f5523e63efcb0a5434341cf9328162be1482fc38` |
| IP-CONTROL | Exact ancestor via `d50de1dd1b23a40b3895b29fee5486bc069597af` |
| IP-OPS | Exact ancestor via `a6a12b943c77c54e60072f755beca984432bffa8` |
| IP-PROOF | Exact ancestor via `1d9b1a3a5e859501c4c0c47e6b2c8d0d82bc4698` |
| A-CORE | Exact ancestor via `3ee0eda…` |
| A-HAZARD | Exact ancestor via `bfb813b…` |
| A-FORMAL | Not ancestor; immutable blocked terminal and Role-2 refusal |
| A-COCKPIT | Exact ancestor via `0204687…` |
| A-AGENT | Exact ancestor via `251d901e2a38c7b3b9634ab1728098655f0104bb` |
| A-STABILITY | Exact ancestor via `332208e64fb9b54ef2b6320c7609e53833da469f` |
| S4 | Exact ancestor via `86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1` |

IP integration has evolved 14 of 46 IP-CONTROL paths and 17 of 24 IP-PROOF paths after exact donor fan-in; none is missing. Ancestry proves provenance, not correctness of the evolved blobs. Role 3 must audit those candidate bytes independently.

## Role-3 finding register

### PVA-001 — A-FORMAL is not receipt-accepted

Severity: candidate-completeness blocker. `89c783b…` is scope-compliant but its latest immutable reseal and state remain `BLOCKED_NO_NETWORK_BOUNDARY_VIOLATED`; root `npm test` is recorded exit 127, formal tooling is not configured, conformance is `MISMATCH 2 / UNKNOWN 5`, and runtime corpus eligibility is zero. The board label cannot override this. Require a newer explicit owner ruling plus immutable accepted receipt or exclude it with an exact disposition and regenerate the denominator.

### PVA-002 — donor denominator conflict

Severity: candidate-completeness blocker. D-LAUNCH-19 says 15 including L; Role-2 state at `139d2cf…` counts a different 15 including F-BRIDGE/SI-RECON and says L would become 16; the user-specified set includes blocked Formal. Candidate receipt must prove `expected = discovered = receipt-accepted = integrated = instrumented` from one named set, not reuse any prior number.

### PVA-003 — dashboard equivalence and truth hazards

Severity: high candidate check. Count the exact 21-file subtree only once. Prove production binding does not use fixture time, browser-owned inventory/readiness/ranking/control consequences, or unknown-to-zero exposure conversion. Unsupported controls must remain disabled with blockers.

### PVA-004 — integration-evolved IP bytes

Severity: high candidate check. Runtime/Ops donor paths remain exact at cutoff; 14 Control and 17 Proof paths evolved. Verify final path ownership, import direction, generated-client/route/schema parity, no second supervisor, and no weakened proof gate on the frozen candidate.

### PVA-005 — object-bound dependencies

Severity: medium. IP packet assignment commit `c418bbe…`, A-AGENT owner law `c57610c…`, S4 accepted S1 `ab33b37…`, and D-LAUNCH-16 `a4a8ebd…` are explicit Git-object dependencies rather than donor ancestors. Candidate receipt must bind the exact objects/hashes and their disposition.

### PVA-006 — synthetic/artifact truth must not widen

Severity: high truth check. Q remains advisory, L remains built/tested/unwired at donor boundary, assurance satellites remain packet-local/synthetic, and L15/IP-OPS remain artifact-only/owner-gated. Integration, UI, deployment, private, signed, canary, or live labels require separate candidate/runtime/owner evidence.

### PVA-007 — A-CORE final-tip and insertion closure

Severity: medium. A-CORE’s receipt names tested commit `f67db032…`; tip `08a0a09…` adds only generated/receipt/state material, not source/tests, but exact-tip tests were not independently run here. Overall `ASSURANCE_PRESTAGE_READY` is absent and integration seams remain. Verify final root discovery/source-frozen denominator and every surviving adapter/WAITING seam.

### PVA-008 — no candidate existed at cutoff

Severity: boundary. No `INTEGRATION_CANDIDATE_READY` receipt/ref existed. Full current-tree tests, L-last integration, runtime/restart/reconciliation, browser ship gate, expected-vs-instrumented component inventory and independent verification remain outside this audit.

## Reproduction command family

```bash
git show -s --format='%H|%T|%P|%s' <object>
git rev-parse <branch>^{commit} <commit>:<receipt-path>
git merge-base <base> <tip>
git merge-base --is-ancestor <base> <tip>
git diff --name-status --no-renames <base> <tip>
git diff --name-only <base> <tip> | LC_ALL=C sort | shasum -a 256
git ls-tree -r <tip> <owned-path>
git cat-file blob <receipt-blob> | shasum -a 256
git grep -n -E <purity-or-authority-pattern> <tip> -- <owned-source-paths>
git diff --check <worker-baseline> <tip>
```

## Advisory boundary

This report proves only reproducible Git-object provenance and static donor-scope/purity observations at the stated cutoff. It does not certify worktree cleanliness, execute receipt commands, validate runtime behavior, approve an external action, or certify a future candidate. Role 3 must begin from a clean worktree pinned to the exact candidate SHA, regenerate the inventory, rerun accepted commands with real exits, audit evolved bytes, and issue only the controlling exact verification token or a reproducible rejection.
