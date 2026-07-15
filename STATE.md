# STATE.md — what is true right now

**Phase:** `FINAL_INTEGRATION / PHASE_2_CANDIDATE_SEAL`

**Status:** `INTEGRATION_CANDIDATE_READY / PARKED_READ_ONLY / INDEPENDENT_VERIFICATION_REQUIRED`

**Candidate state:** `INTEGRATION_CANDIDATE_READY`

This file is committed in sole-child evidence seal **S**. S binds replacement source-freeze **C** `098f7b9449ab3b1c26bda19f51537bfea01d4c48` (tree `e665f37197ffff97a5973e60777c99e60b6e7ea2`) to the complete local-acceptance evidence and immutable candidate receipt using only allowed evidence/seal paths. S cannot self-name its own commit SHA; Git topology establishes it. This is Role 2 candidate readiness, not Phase 3 certification; a different Role 3 session remains required.

**Law:** this file wins on current product state; `ARCHITECTURE.md` Part II wins on ownership; `MISSION.md` wins on purpose. State is evidence, not a chronological diary.

## Product posture

Cosmos Arbitrage Control Room is one local, observable, validate-only product assembled from the accepted Q, L, dashboard, infrastructure, IP, and Product Assurance donors. Existing Basis and Volume engines remain the only strategy authorities; the existing Ledger remains the only durable-history owner; Foundation/System Integration remain the control, risk, dry-run execution, reconciliation, lifecycle, and supervisor owners. Product Integration composes and projects those owners without creating a second scanner, ledger, command plane, socket, or strategy.

No money path exists in the composed product. Live/test orders, borrow/repay, leverage or margin mutation, transfer, withdrawal, private exchange reads, signed calls, AWS/Cloudflare mutation, deployment, and push were not authorized or exercised. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.

## Git, authority, and frozen inputs

- Integration worktree: `/Users/cosmosgeek/Desktop/i00-assembly`; branch: `i00-product-assembly-20260713`.
- Initial clean restart baseline: `6b50cca34a5615e828e9606cd7201daf81272ec7`; tree `731dec2404bab0d27a804c634cda1518a6dcef5d`.
- Replacement source-freeze C: `098f7b9449ab3b1c26bda19f51537bfea01d4c48`; tree `e665f37197ffff97a5973e60777c99e60b6e7ea2`. No source mutation occurred after C.
- Rejected pre-evidence source-freeze checkpoint: `9bde37bc716194c241fb20bda4fdca4e451b1915`; tree `b7747152c926b688545e6e123ce34b49c1b1198e`; parent `6b50cca34a5615e828e9606cd7201daf81272ec7`. Role 2 rejected that attempted freeze after the browser-capture preflight exposed incomplete PF-001 coverage. It remains immutable history, was never sealed, and produced no browser, performance, or complete-acceptance receipt. This source disposition is not a Phase 3 `REJECTED_CANDIDATE` verdict.
- Role 2 accepted exclusive shared write/merge authority on this branch only in commit `c1266f24c464a49ef1657e2549b06d7a90d6cac7`. It has no authority over `current-main`, push, Phase 3 certification, private/signed/cloud activity, deployment, or money.
- The frozen local Main authority cutoff is `d78be24f4da14632c857ee250b62e3fec33c2743`, tree `ea9113c2bf5fd95d4e39bde214d2ecf1f1e7e995`, parent `ac01b5e43830bc681ee7e251749c4d1fab210029`. At the latest source-freeze audit, local `current-main` and its local remote-tracking ref were observed at descendant `2b32317dbf89907bcf529231247f1f9a63235d49`, tree `4b3b079c9133eeb8649a5ecfd13e83ce5061e7a0`; no fetch was performed and no remote-freshness claim is made. The frozen cutoff remains its ancestor and later board state does not alter the Phase 2 donor table.
- The living authority pins are: `QL_DIRECTOR_STATE.md` blob `8116ec491fc7fc863dbcb4015be4cdb105a5a1bc`, SHA-256 `77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc`; `QL_PARALLEL_DAG.md` blob `701b3f263e73bf659ba4319c5839e798c1ce7abb`, SHA-256 `cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec`. D-LAUNCH-27 pre-stages the future Role 3 block but remains trigger-locked; it changes no donor or D-LAUNCH-1..17 acceptance fact.
- Five owner directives remain protected untracked inputs and are excluded from C and S: `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`, `IP_RUNTIME.md`, `IP_CONTROL.md`, `IP_OPS.md`, and `IP_PROOF.md`. Their exact hashes are recorded in `I00_PRODUCT_BUILD_STATE.md`.
- The final integration order is SHA-256 `73615984fa0403a4c0d7ea0db9893292d57ea18614714398684cf9a3062fb05c`.
- The candidate receipt is `docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md`. The source-freeze receipt, `fixtures/i00/closure-evidence.json`, and five root closure reports remain exact C-bound `PHASE2_SOURCE_CLOSURE` evidence; they are not current readiness authority and remain byte-identical to C.

## Donor closure

Expected = discovered = receipt-accepted = integrated is exactly **16/16/16/16**. The Git-backed table, donor trees, acceptance hashes, integration commits, and integration-receipt hashes are in `I00_PRODUCT_BUILD_STATE.md`.

- The required-last donor remains L: merge `ec82bc51d5311dfb3f505216bfb3fa41733f038c`, with pre-L spine `139d2cf07ffd3167bd54a3c14c0fc6671c2f02e9` as first parent and exact L tip `df6b472993ca9659ce09cf5f72004981c6835f0d` as second parent. `docs/archive/i00-phase2/L_LANE_INTEGRATION_RECEIPT.md` has SHA-256 `198af74b4f0931123a41d6b0a94b1bbcd6890813986d981bd39e95ba486c296b`.
- Donor equality is proved at each recorded integration cut. It is not a claim that later authorized shared-spine work stayed byte-identical to every donor.
- Dashboard equality is specifically limited to cut `d04fdc71ffbd9c8266c969524a56e325ec68b1f8`, where 21/21 donor feature files were equivalent. The current dashboard has intentionally evolved under the accepted IP-CONTROL mount requests; current byte equality is not claimed.
- A-FORMAL `b491893416006cf529aef02e5dd4a25d6475e7b8` and A-ACTION-EVIDENCE/S2 `ca30adf5e97b6697afec49f13073024d953b117b` are accepted standalone branches classified `POSTLANDING_EXCLUDED` by the L-last ordering law; no Phase 5 landing is claimed. PREVERIFY `46b2f1e31edf9f75aec7203e952a56f9869a2971` is a non-donor. None changes the 16-donor denominator.

## Integrated source truth

| Area | Current source truth | Honest boundary |
| --- | --- | --- |
| Managed product inventory | Exact 33 I00 identities: 14 `EVIDENCE_PRESENT`, 13 `OWNER_GATED`, 3 `NOT_CONFIGURED`, 3 `MISSING`; all 14 canonical System component IDs are referenced without widening the graph | A mapped identity is owner evidence, not automatic liveness; Q production transport, private truth, and external ops remain separately unavailable |
| Controls | Four exact fail-closed Product controls are source-wired: enter `READ_ONLY`, engage kill, pause intake, and request restart of `engine-supervisor`; the complete catalog contains 14 entries | All reverse, broader, private, recovery, configuration, capital, strategy, focus, and incident mutations remain disabled, `NOT_CONFIGURED`, or `OWNER_GATED` |
| Public source authority | Production admits one exact immutable seven-record catalog before lifecycle start; `MarketEngine` solely owns USD-M liquidation transport and the liquidation cache is a passive projection. TokenDetail candle reads use the same-origin server route and own no exchange WebSocket; TokenIcon has no jsDelivr/CoinCap fallback transport. Deterministic offline mode returns no icon URL, fails browser-reachable public endpoints before transport creation, and isolates profile, icon, and liquidation caches beneath `DATA_DIR`. The exact-C six-run browser campaign passed without unadjudicated external egress. | Catalog admission and local keyless browser evidence prove built/imported/wired ownership and tested no-egress behavior, not current production liveness or unrestricted live-public truth |
| Persistence | Existing Ledger owns the L06 compare-and-set primitive, command/idempotency receipts, operator-event cursor, identity graph, incidents, and boot/release evidence. Mutation-journal inventory reconciles global reserved row counts to every validated canonical lineage; orphan, contradictory, or independently moving count/lineage evidence never becomes available or becomes mislabeled as durable corruption. Ledger non-writability or incompatible/unknown schema downward-normalizes canonical supervisor truth. | No second database or file store; production L14 owners remain null/owner-gated |
| Quantity bridge | Caller-supplied canonical-format instrument identity plus content-derived SHA-256 revision structurally bind exact identity, step, and tolerance while bridging exact journal text to bounded Foundation binary64; stale revisions and lossy/invalid values fail closed. The revision is not a signature or source-authority grant. | No authorized production consumer; `NOT_CONFIGURED` |
| Surface binding | `BINDING_READY` reports the accepted adapter/package mount state separately from each datum's canonical truth label and blocker code | It is not required-field completeness, production readiness, or `LIVE_PUBLIC`; absent values remain `MISSING`/`UNKNOWN` |
| L12/L13/L14 | L12 owner availability is fail-closed; L13 exposes 27 roles as 11 bound, 13 owner-gated, 3 missing; L14 is structurally integrated | No canonical active subject/private truth, no accepted projector invocation, no production persistence instance, no dispatch |
| Runtime/API | Dependency-driven startup, 14 canonical System/Product routes, durable material events, trace APIs, and exact command-result readback are source-built; production validates one immutable seven-record source-admission catalog before lifecycle start, with `MarketEngine` as the sole physical liquidation-stream owner and the retained liquidation view as a passive projection; each Product supervisor envelope binds ops and exact last-200 embedded traces to its one validated canonical System snapshot while still refreshing freeze-marker and identity truth; public-intelligence receipt, evaluation, and due projection are bound to one supervisor step and one shared Spot/USD-M market-cache/timestamp cut, projection is capped to the bridge-owned 640-node universe and sampled at least twice per configured freshness window, while stale/disconnected truth and concurrent clock regression fail closed; exact-C local startup, three-boot continuity, restart/reconciliation, and unclean recovery passed | Measurements are local and keyless; ready/trade-ready remained honest 503, managed restart effect remained owner-gated, and no production/private authority is inferred |
| Restart truth | A restart publishes terminal success only for the exact supervisor correlation, accepted revision, target generation, and correlated `RUNNING`/`DEGRADED` transition; active, failed, or boot-lost work stays pending/attention-required; exact replay does not reissue | The managed restart effect is owner-gated in the keyless campaign |
| WebSocket | Canonical `/ws` emits supervisor deltas and seven-field durable material pages; retention gaps require backfill; raw logs/metrics are not broadcast. Browser close truth is reduced by connection generation: failed retries that never opened cannot erase the last established-socket close, while every later established-socket close replaces or fail-closed clears it | The exact-C browser receipt observed clean `1012 / service restart`, reconnect generation 1, and post-restart render; this is local browser continuity, not production reconnect authority |
| Cockpit | The accepted dashboard donor is mounted in the existing app through the canonical Product provider; shared pages render canonical owner truth and unsupported controls remain non-functional. Trust Advisor proves market-feed readiness only from canonical continuity, machine readiness, freshness, and exactly one admitted live Spot plus USD-M source; legacy socket-open state cannot mint green. Six runs, 126 route captures, bottom-up and topbar sweeps, both themes, restart continuity, and no-false-green checks passed. | The 194-artifact browser receipt is local/keyless evidence; it does not configure missing owners, enable controls, or certify production readiness |
| Product Assurance | Current manifest covers 517 files, 205 discovered operation sites, 205 covered, and 0 uncovered; the fresh full harness proves 802 behavior plus 4 provenance checks | Production assurance projection is not configured; no overall/live assurance-ready label |

## Candidate-bound verification

The focused source results and the complete exact-C local acceptance are:

| Command or suite | Measured result |
| --- | --- |
| Root typecheck and build | Exit 0; server/web pass; Vite 1,880 modules; advisory large-chunk warning only |
| Product Integration | `108/108` |
| Product Control | `76/76`, including established-socket restart retention, later established-failure replacement, and automatic token-rendering transport ownership |
| System Integration | `373/373` after restart-terminalization and independently advancing Ledger-inventory race hardening |
| L06 / L12 / L13 / L14 | `79/79`; `21/21`; `37/37`; `38/38` |
| Foundation quantity bridge / Ledger CAS | `12/12`; `9/9`, including independent-writer race, crash rollback, recovery, and replay proofs |
| Living-input authority protocol | `14/14` against immutable D-LAUNCH-27 cutoff `d78be24f4da14632c857ee250b62e3fec33c2743` |
| I00 proof / command / acceptance contracts | `47/47`; `28/28`; `34/34` |
| Hostile repository/application gate | `82/82`; browser-reachable GET and forced-refresh owners attempted zero external public calls, and profile/icon/liquidation default caches were behaviorally read only beneath `DATA_DIR` |
| Production runtime temporal/restart focus | `16/16`; one exact market row/timestamp cut is reused by both source freshness and due projection, with exact-step sibling refresh handoff plus hostile advancing-clock, projection-cadence, stale-source, USD-M disconnect, and concurrent clock-regression proofs; same-data dirty-cache replay restored all seven required public/engine owners to `READY / LIVE_PUBLIC` with Q `ABSTAIN_UNKNOWN` and honest safety degradation |
| Intelligence Runtime bridge focus | `23/23`; oversized failure batches retain the exact comparator-defined survivors with one bounded eviction pass |
| I00 performance contract | `41/41`, including exact canonical `OWNER:ownerPath` binding, owner-forgery rejection, bounded hydrated-baseline timeout refusal, short-window RSS-slope nonclaim, and a direct 10 ms reset/acknowledge/snapshot phase event-loop histogram that rejects interval substitution |
| Security and I00 scope-security | `148` focused security assertions; `7/7` scope-security |
| Root Product Assurance | 517 files; 205/205 discovered/covered; 0 uncovered; 802 behavior plus 4 provenance |
| `bash ops/tests/i00/run-all.sh` | Exit 0; 10/10 files; 394 assertions |
| `bash ops/tests/run-all.sh` | Exit 0; 12/12 files; 386 assertions including the 35-case durable lane-scope gate |
| `npm test` | Exit 0; typecheck, build, deterministic engine/security, Product Assurance, and acceptance-contract gates pass |
| `npm run test:all` | Exit 0; all configured family suites pass, including the 1,618-test live-edge campaign |
| Canonical `npm run test:i00:complete -- --run ...` | Exit 0; 11/11 required layers passed; zero missing; 1,104,333 ms; exact C/tree and 2,014-file source freeze bound |
| Complete acceptance receipt | PASS; `test/i00/performance/evidence/local-complete-acceptance-20260715035012040-66611.json`; SHA-256 `8a62f378268c4cf6c15ea57e0442698539097b6578aaadc87f97b2f35e171446`; 218,897 bytes |
| Local-proxy performance | PASS; `test/i00/performance/evidence/local-proxy-performance-20260715035012040-66611.json`; SHA-256 `b1905dfd2adac84680ca79e8807829a23a9ac37a1b0630181fa71df9e58205c7`; 60.09-second measured campaign, continuity and unclean recovery PASS, seven numeric SLOs PASS, RSS slope `NOT_CONFIGURED` |
| Six-run browser/no-false-green | PASS; `test/i00/performance/evidence/browser/local-browser-acceptance-098f7b9.json`; SHA-256 `21e115fb220181a0627b5fdc5b5fa91eea68b64cb4712e2b0720ff9c1f90ca03`; 126 route captures, 194 artifacts, fake controls 0, semantic failures 0, observed 1012 and post-restart render |
| Diff hygiene | `git diff --check` exit 0 at the latest source audit |

The canonical exact-C command passed final `npm test`, `npm run test:all`, Q donor runs, generated-report parity, deterministic scenarios, runtime startup, restart/reconciliation, performance, browser validation, source-freeze validation, and diff hygiene. The receipts record zero secret findings and no private/signed/cloud/deploy/push/money action. The five Markdown closure reports stayed byte-identical; only the machine proof was regenerated for the C-bound proof-catalog binding.

The exact-Q acceptance archive preserves the complete accepted donor root, without Git metadata, so Q17's frozen root protocol and schema inputs remain available inside the isolated archive. A `quant/`-only pathspec is regression-tested as forbidden.

Product Assurance donor equality remains exact at the recorded merge cuts: 193/193 blobs. At the candidate HEAD, 190 remain donor-identical and exactly three authorized serial-spine replacements are bound to one-parent restoration commit `9a6ec938ef45716379d4f4f4972102ef85cb7271`: A-CORE is 34 unchanged plus two replacements, and A-CASE-S4 is 40 unchanged plus one replacement. Those replacements preserve the explicit News GET disposition and fail-closed sealed-owner evidence needed by a clean detached verifier; every other donor path and all donor/integration receipts remain exact.

## Known limitations

- `NOT_CONFIGURED`: live execution, private/signed exchange boundary, Q production transport, Foundation quantity production consumer, Product Assurance production projection, and PREVERIFY candidate admission.
- `OWNER_GATED`: deployment target, L12 active-subject/private truth, L13 accepted projector, L14 production activation, and managed restart effect.
- `UNKNOWN`: production capacity.
- `POSTLANDING_EXCLUDED`: A-FORMAL and A-ACTION-EVIDENCE/S2.

The exact reason-coded list is in `I00_PRODUCT_BUILD_STATE.md` and `fixtures/i00/closure-evidence.json`. Unknown, missing, stale, synthetic, blocked, and owner-gated states never become green.

## Read-only park and independent verification

The branch is parked at sole-child S. Role 2's detached post-commit validate-only run checks exact C/S topology, immutable receipt hashes, generated parity, and the allowed seal path set; it is not independent certification. The only next task is a different Role 3 session independently returning `VERIFIED_CANDIDATE` or `REJECTED_CANDIDATE` against exact C and S.

Role 2 may not certify its own candidate. No `current-main` write, push, deployment, private/signed call, cloud mutation, or money action is authorized or performed.
