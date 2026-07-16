# I00 product build state

Schema version: `I00_PRODUCT_BUILD_STATE_V2`

Updated: `2026-07-15`

Phase: `FINAL_INTEGRATION / PHASE_4_CORRECTIONS_COMPLETE`

Status: `CORRECTION_SOURCE_VERIFIED / C2_LIVE_ACCEPTANCE_BLOCKED / NOT_SELF_VERIFIED`

Candidate state: `NOT_CANDIDATE_READY`

## Identity and authority

| Field | Current truth |
| --- | --- |
| Correction repository | `/Users/cosmosgeek/Desktop/role4-fix` |
| Correction branch | `role4-fix-20260715` |
| Required live-acceptance branch | `i00-product-assembly-20260713`; the separate integration worktree was not touched |
| Initial clean restart baseline | Commit `6b50cca34a5615e828e9606cd7201daf81272ec7`; tree `731dec2404bab0d27a804c634cda1518a6dcef5d` |
| Rejected pre-evidence source-freeze checkpoint | Commit `9bde37bc716194c241fb20bda4fdca4e451b1915`; tree `b7747152c926b688545e6e123ce34b49c1b1198e`; parent `6b50cca34a5615e828e9606cd7201daf81272ec7`. Incomplete PF-001 coverage was found before evidence capture, so this attempted freeze was never sealed and produced no browser, performance, or complete-acceptance receipt. It remains immutable history and is not a Phase 3 `REJECTED_CANDIDATE` verdict. |
| Correction checkpoint | All `15/15` Role 3 findings and `12/12` FIX_AUDIT rows are closed. `docs/archive/i00-phase4/ROLE4_CORRECTION_CLOSURE_CHECKPOINT_RECEIPT.md` binds the final correction-source gates and live-provenance blocker. This checkpoint is not C2. |
| Candidate readiness | Not claimed. `INTEGRATION_CANDIDATE_READY` may appear only in a future S2 and immutable candidate receipt after every exact-C2 measurement passes. |
| Active writer | Role-4 fix owner, limited to the correction branch; no write authority was exercised in another worktree |
| Forbidden authority | No `current-main` write, push, Phase 3 self-certification, private read, signed call, AWS/Cloudflare mutation, deployment, or money authority |
| Final integration order | The requested `/Users/cosmosgeek/Desktop/FINAL_INTEGRATION_AND_INDEPENDENT_VERIFICATION_ORDER.md` path was absent at restart. Role 2 consumed the byte-identical sealed copy at `/Users/cosmosgeek/Desktop/preverify/FINAL_INTEGRATION_AND_INDEPENDENT_VERIFICATION_ORDER.md`; SHA-256 `73615984fa0403a4c0d7ea0db9893292d57ea18614714398684cf9a3062fb05c`. |
| Frozen local Main authority cutoff | `d78be24f4da14632c857ee250b62e3fec33c2743`; tree `ea9113c2bf5fd95d4e39bde214d2ecf1f1e7e995`; parent/prior pin `ac01b5e43830bc681ee7e251749c4d1fab210029` |
| Main freshness boundary | Local `current-main` and its local remote-tracking ref were observed at descendant `2b32317dbf89907bcf529231247f1f9a63235d49`, tree `4b3b079c9133eeb8649a5ecfd13e83ce5061e7a0`, with the frozen cutoff still its ancestor. No fetch was performed; remote freshness is not claimed. The later board state is outside the frozen input and cannot alter the donor table merely by moving a ref. |
| Living QL pins | `QL_DIRECTOR_STATE.md`: latest touch `d78be24f4da14632c857ee250b62e3fec33c2743`, blob `8116ec491fc7fc863dbcb4015be4cdb105a5a1bc`, SHA-256 `77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc`; `QL_PARALLEL_DAG.md`: latest touch `ac01b5e43830bc681ee7e251749c4d1fab210029`, blob `701b3f263e73bf659ba4319c5839e798c1ce7abb`, SHA-256 `cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec` |

### DIRECTOR_AUTHORITY_ACCEPTED

Role 2 accepted exclusive shared write/merge authority on `i00-product-assembly-20260713` in commit `c1266f24c464a49ef1657e2549b06d7a90d6cac7`. The old director had relinquished shared authority and retains only the later landing role. The acceptance grants no write to `current-main`, no push, no Phase 3 certification, and no external/private/signed/deployment/money authority.

The immutable donor is its committed Git object, never a dirty donor worktree. Donor branches remain recovery points. A protected untracked owner directive is not donor implementation and is never copied, staged, deleted, or used to justify a source claim.

### Protected owner inputs

| Path | SHA-256 |
| --- | --- |
| `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| `IP_RUNTIME.md` | `6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810` |
| `IP_CONTROL.md` | `5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278` |
| `IP_OPS.md` | `2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779` |
| `IP_PROOF.md` | `e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6` |

All five are absent in this correction checkout. They remain protected live owner inputs and must not be reconstructed from the tracked verifier-only package. A future integration/pre-seal run requires them as the exact physical regular `??` inputs on the required integration branch.

## Exact Phase 2 donor table

`expected = discovered = receipt-accepted = integrated = 16/16/16/16`.

| Donor | Immutable tip / tree | Integration method / cut | Acceptance receipt SHA-256 | Integration receipt SHA-256 |
| --- | --- | --- | --- | --- |
| F-BRIDGE | `a0c0c2e5ef3180aa720488463643433cefeb65e5` / `b29f0b50841ae921b0a0dfa65b71d224d6a7b5ec` | Merge ancestry `0670f533840f415b612fb290d2c944f94af50d82` | `e01a614d89755553e5e86db657b8f2ed804060b68f8088c3f34b9c27d76bbba4` | `2cdd156ba4510f49e9b192795aea756afbea55ee359e41e33ff15f4bc65810f9` |
| SI-RECON | `f03ed786a8c5cab50ef27ad33026a74f79f7df87` / `c88cb7a566daf858e73cebc77122409e96d0ffcd` | Merge ancestry `ba965fb0fbb5e10819d5a704e99153892fe94031` | `a0ac1bd8da362999e93d0b10094a4791f900e2a245e66b115a78128030574585` | `a36a0d67b4efdc47dfd03f47bed243d445cc9e5156d66d33924a6fff860fc4f1` |
| Q-LANE | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` / `5c86cebf0966cedd7ba01c56a01704b4f7bd0224` | Merge ancestry `042dc9897d04bed2b0de3043cbdcbac408251412` | `9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc` | `daa8c219227322df1e7a71e6d8b2815256b040fbacac8fbb7d492c00651bb7a4` |
| DASHBOARD-SHELL | `692501587617d4880303fbd747d93e63c376f088` / `61d0c5a3e9146fc0b78d8c7fce3e7ebdfbc3b46d` | Receipted 21/21 equivalence at `d04fdc71ffbd9c8266c969524a56e325ec68b1f8` | `878cc578d88f38ca3bf8edce554b2cb258b4e9309718854f7ba18c33cb50b968` | `d36bb026b54510c0d9853a5e0a32e0d29837cc8677082bd37261bb2107d37e43` |
| L15-INFRASTRUCTURE | `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5` / `e401435d6a650aee8a29c3da4495b4db426be017` | Merge ancestry `35672dcc448d2ca55b17c24344fb413b4d1e14a7` | `d5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293` | `92affcb7dd520a0d7f9cf1b9a1ca8c2a4c77e4b98451c98293bf7b54edfde656` |
| IP-RUNTIME | `8058ab8febb639839333d4e2c604068a0c7390ea` / `dd255f23310c846ab0b3ea0c3bebb6a765ecddd0` | Merge ancestry `f5523e63efcb0a5434341cf9328162be1482fc38` | `8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb` | `8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb` |
| IP-CONTROL | `56c47dad398c485b6653036c8b90c53f11061b1e` / `e335fc95be7a24da828b14c205f39ea3666dd385` | Merge ancestry `d50de1dd1b23a40b3895b29fee5486bc069597af` | `4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7` | `4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7` |
| IP-OPS | `6bfd543afb693ea18f4baf08e962e6d698f140fb` / `572adc3c19d9052fc26398875230437505f5c97e` | Merge ancestry `a6a12b943c77c54e60072f755beca984432bffa8` | `57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922` | `57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922` |
| IP-PROOF | `23e985c17b9b860fee26be397fa05b26f3daf8f2` / `1329fe73139016cf728d47551c75f7ca69daa558` | Merge ancestry `1d9b1a3a5e859501c4c0c47e6b2c8d0d82bc4698` | `569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b` | `569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b` |
| A-CORE | `08a0a09780727e2b4ba59017b5701998abe29b77` / `b904ca0f5b6f7c8df294274351611635560f80f7` | Merge ancestry `3ee0eda6b0da01b6fae441c684fa53829cab15be` | `93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e` | `6741509d67eb622f913661e1ea0e277b01a29ebb3a0e9318e3025882122ba0fa` |
| A-HAZARD | `ab33b3712cddd67c3ec91cfa1dd232c75226cd9f` / `e33224d4b2e6b018fd39bfdcb403b3d88e74712f` | Merge ancestry `bfb813ba1c15a23c7f4f0bff6a8da2f13d5c2729` | `ecfca4e7d60d9dca3b07e4e21d4595ebb234dab421924f14226cf39f8a9c85ea` | `3190610ddf4ea7c47d3483769ed6983a4f821ba91ec38cb9c5260310edbf9c3e` |
| A-COCKPIT | `d4ff9c94c9fec9477481223c4b33d8f671a34f6d` / `bda9b452c9e6564576fa3cd390a5981cd6907c09` | Merge ancestry `0204687d8c65875c99d17ae7bee1c61707f0be0f` | `b75055388f99632f2dc5ebb87d92b6d969f666397014e89a616a6e262f0650dd` | `f11e706995c1156b82f6c1f7aaa8bcb29b0c76c8dbc9364087a973ccd7514555` |
| A-AGENT | `97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437` / `e68ef10d09c11bc5623099a2eb6eb6881054486b` | Merge ancestry `251d901e2a38c7b3b9634ab1728098655f0104bb` | `c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c` | `e47be0f081b15859b2d8509e2fd0e2a611c48dcca50a8640f39dc86be717e7d0` |
| A-STABILITY | `d35674e7f9621320c35e0bc0270efd515cc64dbd` / `16c92923b837105471b232df0480d1270bda756e` | Merge ancestry `332208e64fb9b54ef2b6320c7609e53833da469f` | `b26f902d90fb82633ac8532d5aa82169801ded3ec6d7bcf3477737a64eab2168` | `bc527367b7b05f78e4be4dd4a916be59029316fa671f1d2ea1ed91f7a0f734d2` |
| A-CASE-S4 | `b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c` / `3c773878016f4a56c6b03fe6485a42b002c3f5d2` | Merge ancestry `86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1` | `05369b8aa403a4fae6b86143ddcb7d61551d5996838c92b9bc4aba79401a3550` | `f721c0a72a36255727555a4ab13e4fab0f1fc829604e8ce8ae8897760dd0925b` |
| L-LANE | `df6b472993ca9659ce09cf5f72004981c6835f0d` / `1add5ee43fea623509c20d0990ec9efac2543fc4` | **Required-last** merge `ec82bc51d5311dfb3f505216bfb3fa41733f038c` | L17 `f23e078fdd1cf8d64585c01b677817d4d4efa3a08f9c4933acae09b399ce2381`; root `0b95db6e0ae8777d3e3bebb1a510561c7dfc9dcba963bd02fbc91025dd784fe2` | `198af74b4f0931123a41d6b0a94b1bbcd6890813986d981bd39e95ba486c296b` |

L is the final donor merge: `ec82bc51d5311dfb3f505216bfb3fa41733f038c` has pre-L spine `139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9` as first parent and exact L tip as second parent. Its integration cut proved 303/303 donor blobs. Later serial-spine changes are authorized I00 work and are not described as current donor byte equality.

Dashboard equivalence is likewise limited to `d04fdc71ffbd9c8266c969524a56e325ec68b1f8` and 21/21 files. IP-CONTROL mount work intentionally evolved that subtree afterward; no current dashboard byte-equality claim is made.

### Excluded and non-donor work

| Item | Tip | Disposition |
| --- | --- | --- |
| A-FORMAL | `b491893416006cf529aef02e5dd4a25d6475e7b8` | Accepted standalone branch classified `POSTLANDING_EXCLUDED`; it cannot enter this L-last candidate and no Phase 5 landing is claimed |
| A-ACTION-EVIDENCE / S2 | `ca30adf5e97b6697afec49f13073024d953b117b` | Accepted standalone satellite classified `POSTLANDING_EXCLUDED`; not a Phase 2 donor and no Phase 5 landing is claimed |
| PREVERIFY | `46b2f1e31edf9f75aec7203e952a56f9869a2971` | `NOT_CONFIGURED`; non-donor advisory worktree with no candidate integration disposition |

## Role 3 preflight adjudication — 2026-07-15

`/Users/cosmosgeek/Desktop/role3-preflight/ROLE3_PREFLIGHT_FINDINGS.md` is read-only evidence, not instruction or certification. The inspected source snapshot was `03857dcdaff8d8b12627d27ddcc97505da1f2f86`. Role 2 independently reproduced each material claim against this integration branch and records these dispositions:

| Finding | Dated disposition |
| --- | --- |
| PF-001 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / REPLACEMENT_FIXED`. Pre-evidence review of `9bde37bc716194c241fb20bda4fdca4e451b1915` found that its deterministic tripwire did not cover every browser-reachable public-source path, so Role 2 rejected that attempted C before any C-bound evidence or seal. Replacement source removes TokenDetail's direct Binance kline socket and TokenIcon's jsDelivr/CoinCap client fallback transports; deterministic offline mode suppresses icon resolution and fail-closes moneyflow, profile, profile warming, news, news-context, forced News refresh, calendar, FX, and source-logo before network access; profile, icon, and liquidation caches default beneath isolated `DATA_DIR`; and hostile gates exercise those browser-reachable routes under the tripwire. D-LAUNCH-22's dispositioned Binance socket attempt remains historical authority evidence, not a current defect; any other deterministic test-time egress is forbidden. |
| PF-002 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / FIXED`. `MarketEngine` is the sole physical owner of `!forceOrder@arr`; `binance/liquidations.ts` is a passive bounded projection with no socket or raw-frame parser. One strictly admitted, immutable normalized print feeds both the Market view and the projection. |
| PF-003 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / FIXED`. Generated evidence normalizes only verified live owner-file transport modes and omits a moving descendant tip only after strict Git reachability. Missing, invalid, or unreachable tips remain explicitly classified rather than normalized away. |
| PF-004 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / FIXED`. Ledger inventory now reconciles global reserved journal/audit counts against the complete canonical registry, validates every lineage before capacity classification, and downgrades concurrent or unavailable count/lineage evidence without manufacturing corruption or availability. Hostile orphan and independently moving-registry races are covered. |
| PF-005 | `2026-07-15 MANDATORY_RECEIPT_LAW / FIXED`. Candidate receipt schema v2 encodes regenerated donor equality `16/16/16/16`; A-FORMAL and A-ACTION-EVIDENCE/S2 exclusions; Q C17 `4cc83f43edd9a50ff2d3e20970a57e2d0a57e92a` as the sole direct parent of A17 `02b4eccc8d2ef53b830cafae06e5175715fa6ebb`; and explicit Ledger CAS plus Foundation quantity-bridge dispositions. Render and validate-only paths independently re-read the bound Git objects, introduction ancestry, request bytes, implementation blobs, and no-send/no-external-authority boundaries. |
| PF-006 | `2026-07-15 ACCEPTED_DOCUMENTATION_CORRECTION / NON_CODE_BLOCKING`. The `fqie` SHA-256 is a deterministic structural/content binding over caller-supplied canonical-format `instrumentId`, step, and tolerance; it is not a signature or owner/source-authority grant. Recomputed self-consistent metadata is intentionally accepted. No production consumer exists. |
| PF-007 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / FIXED`. Production construction validates the exact immutable seven-record public-source authority catalog before lifecycle admission. Duplicate, missing, counterfeit producer/path/class/consumer, or non-passive liquidation ownership fails closed; no static registry record can mint current liveness. |
| PF-008 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / FIXED`. Canonical Ledger `writable:false`, unknown writability, or non-available schema compatibility downward-normalizes the Ledger component to blocked/unavailable truth, strips `LIVE_PUBLIC`, requires operator attention, and propagates a root blocker; stronger failed/stopped truth is preserved. |
| PF-009 | `2026-07-15 REFUSED_SEMANTIC_MISCLASSIFICATION / NON_BLOCKING`. `BINDING_READY` is the accepted IP-CONTROL adapter/package mount state (`IP_CONTROL.md` lines 171–181; `IP_CONTROL_RECEIPT.md` lines 122–137), expressly not required-field completeness, production readiness, or `LIVE_PUBLIC`. Runtime renders binding state and truth label separately; absent data remains `MISSING`/`UNKNOWN` with `CANONICAL_OWNER_FIELD_NOT_CONFIGURED`. Neutral binding CSS and separate truth colors preserve the distinction. No code or UI change is warranted. |
| PF-010 | `2026-07-15 ACCEPTED_CANDIDATE_BLOCKER / HONEST_LABEL_FIXED`. Legacy `/api/state` feed sockets explicitly report readiness semantics `NOT_EVALUATED` and can no longer produce a green market-feed claim. Trust Advisor now says `Market Feed Readiness Proven` only from canonical continuity, owner machine readiness, freshness, and exactly one admitted Spot plus one USD-M source at `READY / LIVE_PUBLIC / LIVE_PUBLIC`; every missing, duplicate, stale, non-live, or unproven case is unproven. |

## Protocol and configuration hashes

| ID | Kind | Hash |
| --- | --- | --- |
| FINAL-INTEGRATION-ORDER | SHA-256 | `73615984fa0403a4c0d7ea0db9893292d57ea18614714398684cf9a3062fb05c` |
| I00-CONTROLLING-DIRECTIVE | SHA-256 | `9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5` |
| IP-RUNTIME-DIRECTIVE | SHA-256 | `6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810` |
| IP-CONTROL-DIRECTIVE | SHA-256 | `5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278` |
| IP-OPS-DIRECTIVE | SHA-256 | `2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779` |
| IP-PROOF-DIRECTIVE | SHA-256 | `e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6` |
| QL-EDGE-PROTOCOL-COMMIT | Git SHA-1 | `73e1a1ff7daa48df8dac45713fc5f106842edafc` |
| QL-EDGE-PROTOCOL-DOCUMENT | SHA-256 | `951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1` |
| EDGE-PROTOCOL-SCHEMA | SHA-256 | `229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c` |
| EDGE-PROTOCOL-FIXTURES | SHA-256 | `c42a4257ea5f46abb38ec9ab4e56983e7049cdf5b448150a4d4647a6234d99a4` |
| ARCHITECTURE-AUTHORITY-MAP | SHA-256 | `beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db` |
| Q-DIRECTIVE-LOCK | SHA-256 | `d4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24` |
| QL-DIRECTOR-STATE | SHA-256 | `77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc` |
| QL-PARALLEL-DAG | SHA-256 | `cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec` |

The current living-input authority protocol passes `14/14` against immutable cutoff `d78be24f4da14632c857ee250b62e3fec33c2743`. A later board-only descendant is acceptable only if the cutoff remains an ancestor; it cannot change the donor denominator or silently replace protocol/config input.

## Integrated source state

### Serial-spine dispositions

| Deferred seam | Current disposition |
| --- | --- |
| L06 ledger compare-and-set request | Implemented in the existing Ledger as bounded `compareAndSetConfigValueAndLogEvents`; atomic state plus one/two audit events, exact expected-value conflict, deadline, independent-writer race, crash rollback, post-commit recovery, and replay proofs; no send authority |
| Foundation quantity request | Caller-supplied canonical-format instrument ID plus SHA-256 content revision structurally bind exact identity, step, and tolerance while bridging exact journal text to bounded Foundation binary64; stale-revision substitution, exponent text, non-finite, negative-zero, overflow, underflow, non-roundtrip, and off-step inputs fail closed; the revision grants no source authority; no production consumer |
| L12 | Owner availability only. Without canonical active subject and authorized private truth, status is `HALTED`/`UNKNOWN`/`OWNER_GATED`; accepted projector is not invoked. |
| L13 | Exact 27-role disposition: 11 bound, 13 owner-gated, 3 missing. Accepted projector is not invoked without validated L12 truth. |
| L14 | Structural integration and persistence contracts exist; production persistence is null, command dispatch is false, and activation remains owner-gated. |
| Dashboard mount | Accepted donor mounted into the existing app through the canonical Product provider and IP-CONTROL insertion requests; no duplicate shell or browser strategy truth. |
| Startup | Dependency-driven production composition replaces arbitrary startup delays; owner evidence is projected through canonical components. |
| Public-source browser boundary | TokenDetail candle reads use the same-origin server route and own no exchange WebSocket; TokenIcon has no jsDelivr/CoinCap fallback transport. Deterministic offline mode fails browser-reachable GET and forced-refresh owners closed before transport creation and isolates profile, icon, and liquidation caches under `DATA_DIR`. Validated server-resolved CoinGecko image URLs may exist outside deterministic offline mode, so the future exact-C2 browser network campaign remains mandatory. |
| Command result | `GET /api/product-integration/v1/commands/:commandId/result` requires exact command/idempotency/control identity and server-derived authentication; durable result is 200 terminal, 202 pending, 404 absent/substituted, or 503 unavailable/fail-closed. |
| WebSocket | Canonical `/ws` emits supervisor deltas and bounded seven-field material pages; retention/gap requires backfill; raw log/metric floods are excluded. Browser close truth is generation-bound: unopened retry failures retain the last established-socket close, and a later established close replaces or fail-closed clears it. Focused in-app-browser proof observed clean `1012 / service restart` surviving a failed retry, followed by a real established crash surfacing unclean `1006`; complete C2-bound browser evidence remains pending. |
| Restart terminalization | Production durably refreshes one conservative restart projection from an exact canonical supervisor cut plus exact canonical ops readback; passive reads do not refresh, malformed/stale/ambiguous/recovery truth remains blocking, and success still requires exact supervisor correlation, accepted revision, target generation, and correlated `RUNNING`/`DEGRADED`. |
| Assurance insertion requests | Applied only through canonical source/runtime/control/ledger owners. Fixture evidence remains non-authoritative and cannot mint live green. |

### Managed inventory

The exact 33 I00 identities reconcile to 14 `EVIDENCE_PRESENT`, 13 `OWNER_GATED`, 3 `NOT_CONFIGURED`, and 3 `MISSING`. The 14 evidence-present roles reference every canonical System component without widening its graph:

```text
public-spot-source, public-usdm-source, market-universe, intelligence-runtime,
market-intelligence, q-inference, basis-engine, volume-engine, capital-supervision,
multileg-risk, execution-coordinator-validate-only, reconciliation,
ledger-persistence, engine-supervisor
```

`EVIDENCE_PRESENT` means an exact canonical projection exists, not that the component is externally configured, live, fresh, or trade-ready. In particular, Q production transport remains `NOT_CONFIGURED` and private truth remains `OWNER_GATED`.

### Control and route inventory

- Canonical System/Product route inventory: 15 exact routes, including the authenticated server-clocked validate-only owner seam.
- Product control catalog: 14 exact entries.
- Source-wired runtime controls: exactly four — `global.safe-mode.read-only`, `global.kill-switch.engage`, `global.intake.pause`, `component.engine-supervisor.restart`.
- All broader or reverse mutations stay disabled with exact `NOT_CONFIGURED`, `OWNER_GATED`, or unavailable reasons.

## Correction-source verification measured before lawful complete local acceptance

| Command or suite | Measured result |
| --- | --- |
| `npm run typecheck` | Exit 0; server and web pass |
| `npm run build` | Exit 0; server and web pass; Vite 1,883 modules; advisory large-chunk warning only |
| Product Integration | `111/111`, including real-process crash-pending Product readback and explicit hostile/unavailable history projection |
| Product Control | `102/102`, including durable status-bound command-result readback across reload, commit-then-timeout and competing-tab identity preservation, exact ordered 14-component browser inventory, exact server-owned 33-role managed-inventory decoding, bounded browser crash-history validation, explicit missing-Q and non-green unavailable-Q projection, canonical read-only attention facts without controls or browser re-ranking, established-socket restart retention, later established-failure replacement, and automatic token-rendering transport ownership |
| System Integration | `401/401` after traced validate-only production binding, durable canonical restart-truth refresh, retry-exhaustion projection, restart-terminalization, and independently advancing Ledger-inventory race hardening |
| L06 / L12 / L13 / L14 | `79/79`; `21/21`; `37/37`; `38/38` |
| Foundation quantity bridge / Ledger CAS | `12/12`; `9/9` |
| Authority protocol | `14/14` against D-LAUNCH-27 cutoff |
| I00 proof / command contracts | Exit 0; `47/47` proof and `28/28` command contracts |
| Hostile repository/application gate | `82/82`; browser-reachable GET and forced-refresh owners attempted zero external public calls, and profile/icon/liquidation default caches were behaviorally read only beneath `DATA_DIR` |
| Production runtime temporal/restart focus | `16/16`; each Product supervisor envelope reuses one validated canonical System snapshot for ops and exact last-200 embedded traces, while freeze-marker and identity truth remain freshly read; one exact market row/timestamp cut is reused by both source freshness and due projection, with one exact-step sibling refresh handoff; hostile advancing-clock, projection-cadence, stale-source, USD-M disconnect, and concurrent clock-regression proofs; same-data dirty-cache replay restored all seven required public/engine owners to `READY / LIVE_PUBLIC` with Q `ABSTAIN_UNKNOWN` and honest safety degradation |
| Intelligence Runtime bridge focus | `23/23`; oversized failure batches retain the exact comparator-defined survivors with one bounded eviction pass |
| I00 performance / acceptance contract | `43/43`; exact 14-component `OWNER:ownerPath` projections, `blockerCode` capture, owner-forgery rejection, bounded hydrated-baseline timeout refusal, short-window RSS-slope nonclaim, and direct 10 ms reset/acknowledge/snapshot phase event-loop measurement with interval-substitution rejection |
| Focused security / I00 scope-security | 155 assertions (`59 + 29 + 51 + 14 + 2`); `7/7` |
| Product Assurance hostile / provenance | `2/2`; `4/4` |
| Root Product Assurance | 518 files scanned; 205 discovered; 205 covered; 0 uncovered; 802 behavior plus 4 provenance |
| `bash ops/tests/i00/run-all.sh` | Exit 0; 12/12 files; 725 additive assertions; complete fixture binds 33 managed identities, 14 canonical components, four Product controls, browser receipt v2, capture transcript v3, and 194 browser artifacts |
| `bash ops/tests/run-all.sh` | Exit 0; 12/12 files; exact footer sum 384 assertions, including 35 durable lane-scope cases |
| `npm test` | Exit 0; typecheck, build, deterministic engine/security, Product Assurance, and acceptance-contract gates pass |
| `npm run test:all` | Exit 0; Product Assurance `518` files and `205/205` operation sites with `802 + 4` proofs; app `82/82`; System Integration `401/401`; Product Integration `111/111`; Product Control `102/102`; I00 proof `47/47`; I00 commands `28/28`; live-edge `1618/1618` |
| Generated report parity | Exit 0; all five Markdown reports and `integration/reports/i00-proof-evidence.json` were regenerated twice with byte-identical SHA-256 values; machine report raw SHA-256 `d3a67b8658c7ea441a086c11e84e1147633c15ed037c05527154ba4354f05df5` |
| `npm run test:i00:complete` | Exit 0 only as `PLAN_ONLY`. Effectful `--run` exits 1 before any measured step with `INTEGRATION_BRANCH_REQUIRED:role4-fix-20260715` |
| `git diff --check` | Exit 0 at latest source audit |

Root `npm test`, `npm run test:all`, both ops aggregates, and generated-report parity pass on correction source `35bcfe96314f5047957bdff251831ab309c9be19`, tree `82c359b0baaeb1ec5c605340addaa1bb487384fd`. They do not replace exact-C2 Q, browser, performance, source-freeze, complete-receipt, and sole-child validation. The effectful complete runner rejected this branch before those steps, so no C2/S2 evidence is claimed.

The exact-Q acceptance archive preserves the complete accepted donor root, without Git metadata, so Q17's frozen root protocol and schema inputs remain available inside the isolated archive. A `quant/`-only pathspec is regression-tested as forbidden.

Product Assurance donor equality remains exact at the recorded merge cuts: 193/193 blobs. At the current correction-source HEAD, 190 remain donor-identical and exactly three authorized serial-spine replacements are bound to one-parent restoration commit `9a6ec938ef45716379d4f4f4972102ef85cb7271`: A-CORE is 34 unchanged plus two replacements, and A-CASE-S4 is 40 unchanged plus one replacement. Those replacements preserve the explicit News GET disposition and fail-closed sealed-owner evidence needed by a clean detached verifier; every other donor path and all donor/integration receipts remain exact.

## Runtime and external measurements

| Evidence class | Current value |
| --- | --- |
| Complete local acceptance | `BLOCKED_BY_INTEGRATION_BRANCH_AND_LIVE_OWNER_INPUT_PROVENANCE` |
| Runtime startup and deterministic scenario receipt | `PENDING_EXACT_C2_MEASUREMENT` |
| Restart/reconciliation receipt | `PENDING_EXACT_C2_MEASUREMENT` |
| Six-run browser/no-false-green receipt | `PENDING_EXACT_C2_MEASUREMENT` |
| Local-proxy performance receipt | `FIX_AUDIT_ONLY_ARTIFACT_PRESENT / PENDING_EXACT_C2_MEASUREMENT` |
| Deployed runtime | `UNKNOWN / NOT_CONFIGURED`; no target or readback |
| External actions performed | `NONE` |
| External authorizations present | `NONE` |

## Exact known limitations

| ID | Status | Reason |
| --- | --- | --- |
| A_ACTION_EVIDENCE_S2 | `POSTLANDING_EXCLUDED` | Accepted post-landing tip `ca30adf5e97b6697afec49f13073024d953b117b`; excluded by candidate ordering law |
| A_FORMAL | `POSTLANDING_EXCLUDED` | Accepted post-landing tip `b491893416006cf529aef02e5dd4a25d6475e7b8`; excluded by L-last ordering |
| DEPLOYMENT_TARGET | `OWNER_GATED` | Deployment authorization and real target readback required |
| FOUNDATION_QUANTITY_PRODUCTION_CONSUMER | `NOT_CONFIGURED` | Contract and hostile proofs exist; no authorized production consumer |
| L12_ACTIVE_SUBJECT_PRIVATE_TRUTH | `OWNER_GATED` | Canonical active subject and private account truth are not authorized; accepted projector not invoked |
| L13_ACCEPTED_PROJECTOR | `OWNER_GATED` | Validated L12 active-subject truth unavailable; accepted projector not invoked |
| L14_PRODUCTION_ACTIVATION | `OWNER_GATED` | Numeric configuration, checkpoint, and reservation owners unavailable; production persistence null; no dispatch |
| LIVE_EXECUTION | `NOT_CONFIGURED` | `LIVE_EXECUTION_NOT_IMPLEMENTED` |
| MANAGED_RESTART_EFFECT | `OWNER_GATED` | Keyless managed-restart effect and external process-manager authority are not authorized or proved |
| PREVERIFY_WORKTREE | `NOT_CONFIGURED` | Non-donor worktree excluded from Phase 2 candidate; no integration disposition |
| PRIVATE_SIGNED_EXCHANGE | `NOT_CONFIGURED` | Private-read and signed-validation authorization required; no such path was constructed or run |
| PRODUCT_ASSURANCE_PRODUCTION_PROJECTION | `NOT_CONFIGURED` | Passive source projection only; production assurance activation not configured |
| PRODUCTION_CAPACITY | `UNKNOWN` | Local bounded acceptance only; production load/capacity not measured |
| Q_PRODUCTION_TRANSPORT | `NOT_CONFIGURED` | No accepted production Q transport is mounted |

## C2 to S2 transition and resume

Next exact task:

1. Preserve this correction branch as a closed fix checkpoint; do not relabel it C2 and do not rewrite rejected checkpoint `9bde37bc716194c241fb20bda4fdca4e451b1915` or the historical replacement source-freeze receipt.
2. An authorized integrator must carry the correction source onto `i00-product-assembly-20260713` while preserving the five genuine hash-exact physical untracked owner directives, then commit the new source-freeze C2.
3. Run `npm run test:i00:complete -- --run ...` from exact C2 with immutable browser/performance evidence. Only if every step passes may the integrator create sole-child S2, run validate-only against exact C2, render `INTEGRATION_CANDIDATE_READY`, and park read-only.

Files a replacement integrator must read, in order:

1. `STATE.md`
2. `MISSION.md`
3. `ARCHITECTURE.md` Part II
4. `/Users/cosmosgeek/Desktop/FINAL_INTEGRATION_AND_INDEPENDENT_VERIFICATION_ORDER.md`, or its byte-identical sealed fallback `/Users/cosmosgeek/Desktop/preverify/FINAL_INTEGRATION_AND_INDEPENDENT_VERIFICATION_ORDER.md` when the requested path is absent
5. `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`
6. this file, the living QL files, `fixtures/i00/closure-evidence.json`, `fixtures/i00/proof-catalog.json`, and `test/i00/performance/README.md`
7. the 16 immutable integration receipts or packet receipts named in the donor table

Work that must not be repeated: no donor rebuild or re-merge; no post-L donor; no duplicate scanner/ledger/control/socket; no hand edit of generated closure reports; no weakening of scope, receipt, inventory, browser, or no-false-green gates; no claim of current dashboard donor byte equality; no private/signed/deployed/live/canary claim from fixtures or local artifacts.

The authorized integrator may create C2 and S2 but may not verify its own candidate. A different Role 3 session must independently return `VERIFIED_CANDIDATE` or `REJECTED_CANDIDATE`.
