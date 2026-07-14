# QL_PARALLEL_DAG.md — packet board (director-owned)

Updated: 2026-07-12 (D-LAUNCH-5). States: READY / WORKING / ACCEPTED / PARKED / BLOCKED / WAITING.

| Packet | Worktree | Branch | Base SHA | State |
| --- | --- | --- | --- | --- |
| Q spine Q00–Q06 | quant-edge-research-20260712 | quant-edge-research-factory-20260712 | 73e1a1f | ACCEPTED through Q09-merged — Q10 ACCEPTED; Q11+Q14 merged; Q LANE_READY (frozen HEAD 02b4ecc; 3,011 pass; protocol 22/22) — awaits director receipt audit at I00 |
| Q07 microstructure | SPINE-OWNED (shard retired 2026-07-12; spine was already WORKING Q07 at d057373) | quant-edge-research-factory-20260712 | 24ccf58 | ACCEPTED on spine (f0d4448) |
| Q08 derivatives | ~/Desktop/q08-derivatives | q08-derivatives-20260712 | 24ccf58 | ACCEPTED + MERGED onto lane (c00de40, 494d6ce; 1,649 pass) |
| Q09 regime | ~/Desktop/q09-regime | q09-regime-20260712 | 24ccf58 | ACCEPTED + MERGED onto lane (1,842 pass) |
| Q14 validation-infra | ~/Desktop/q14-validation-infra | q14-validation-infra-20260712 | 24ccf58 | ACCEPTED + MERGED (2,182 pass) |
| Dashboard shell satellite | ~/Desktop/dash-shell | dashboard-shell-20260712 | 0f2bb88 | ACCEPTED (6925015 + RECEIPT.md) — wire at integration |
| Q13 deep-gate shard | ~/Desktop/q13-deep-gate | q13-deep-gate-20260712 | f756f3b | ACCEPTED + MERGED (2,455 pass) |
| Q15 registry shard | ~/Desktop/q15-registry | q15-registry-20260712 | f756f3b | ACCEPTED + MERGED (2,342 pass) |
| L15 deploy-infra satellite | ~/Desktop/l15-infra | l15-deploy-infra-20260712 | 0f2bb88 | ACCEPTED (2cec412; 347 assertions) — merge at integration |
| Q11 survival | ~/Desktop/q11-survival | q11-survival-20260712 | 8a5dd09 | ACCEPTED + MERGED (2,182 pass with Q14) |
| L spine L00–L08 | live-execution-proof-20260712 | live-execution-control-proof-20260712 | 73e1a1f | L00–L08 + L08.1 + L08.2 (9f133ac) + L14 ACCEPTED; ALL SHARDS MERGED (L09/L10/L11/L14) + current-main synced; L LANE_READY / BUILT_AND_TESTED_UNWIRED (df6b472) — donor ready; Codex left auditable uncommitted L06 work; TWO director decisions DEFERRED to I00: ledger compare-and-set primitive + Foundation quantity-bridge contract (see live-edge-receipts/patches/) |
| L14 controls shard | ~/Desktop/l14-controls | l14-controls-20260712 | 39ebd98 | ACCEPTED + MERGED (51/51 liveEdge suites) |
| L09 normal-basis shard | ~/Desktop/l09-normal-basis | l09-normal-basis-20260712 | rebased on c900907 | ACCEPTED (10cb9d2) + MERGED onto lane (72/72 liveEdge, foundation green) |
| L10 reverse-basis shard | ~/Desktop/l10-reverse-basis | l10-reverse-basis-20260712 | 4ae270a | ACCEPTED + MERGED (63/63 liveEdge suites) |
| L11 volume shard | ~/Desktop/l11-volume | l11-volume-20260712 | 4ae270a | ACCEPTED + MERGED (68/68 liveEdge) |

| IP-RUNTIME packet | ~/Desktop/ip-runtime | ip-runtime-20260713 | 420cc83 | PRESTAGE_READY — fan-in at I00 spine |
| IP-CONTROL packet | ~/Desktop/ip-control | ip-control-20260713 | 420cc83 | BINDING_READY (56c47da) — fan-in at I00 spine |
| IP-OPS packet | ~/Desktop/ip-ops | ip-ops-20260713 | 420cc83 | OPS_READY — fan-in at I00 spine |
| IP-PROOF packet | ~/Desktop/ip-proof | ip-proof-20260713 | 420cc83 | PROOF_PRESTAGE_READY (23e985c) — fan-in at I00 spine |

| I00-VERIFY | ~/Desktop/i00-assembly | i00-product-assembly-20260713 | 1fec867 | I00_PRESTAGE_VERIFIED (635ad83) — awaits director real-adapter I00 after lanes |

| F-BRIDGE canonical execution | ~/Desktop/f-bridge | f-bridge-execution-20260713 | 24ac894 | ACCEPTED (1e9d28a) + MERGED to current-main c900907 (24/24 foundation, npm test green) |
| A-CORE IP-ASSURANCE | ~/Desktop/ip-assurance | ip-assurance-20260713 | 9785c93 | CORE_SCAFFOLD_READY (08a0a09) — full READY after director fan-in |
| A-HAZARD S1 | ~/Desktop/ip-assur-hazard | ip-assur-hazard-20260713 | 9785c93 | HAZARD_PRESTAGE_READY (ab33b37, D-LAUNCH-10 resealed) |
| A-FORMAL S3 | ~/Desktop/ip-assur-formal | ip-assur-formal-20260713 | 9785c93 | FORMAL_PRESTAGE_READY (89c783b, D-LAUNCH-10 resealed) |
| A-COCKPIT S5 | ~/Desktop/ip-assur-cockpit | ip-assur-cockpit-20260713 | 9785c93 | COCKPIT_PRESTAGE_READY (d4ff9c9) |
| A-AGENT S6 | ~/Desktop/ip-assur-agent | ip-assur-agent-20260713 | 9785c93 | AGENT_PRESTAGE_READY (97e87bd, D-LAUNCH-13 taxonomy) |
| A-STABILITY S8 | ~/Desktop/ip-assur-stability | ip-assur-stability-20260713 | 9785c93 | STABILITY_PRESTAGE_READY (d35674e) |
| S2 actionEvidence satellite | (cut after L lane freeze) | — | — | WAITING (dependency law §11) |
| S4 assuranceCase satellite | ~/Desktop/ip-assur-case | ip-assur-case-20260713 | c57610c | READY |

| SI-RECON ruling | ~/Desktop/si-recon | si-recon-ruling-20260714 | e25fd5d | ACCEPTED ruling A + MERGED to current-main c43262a (SI 180/180, npm test green) |

## Frozen merge/integration order (mechanical)

1. Director serially merges accepted Q shards (Q07→Q08→Q09→Q14) onto the Q lane branch, full Q suite after each.
2. Q spine resumes (any model) for remaining Q phases only after shard merges — or stays parked; Q is advisory and never blocks the product.
3. Director serially merges accepted L shards (L09→L10→L11) onto the L lane branch after L08, full L suite after each; L spine continues L12→L17.
4. At each LANE_READY: director audits all receipts, freezes lane HEAD.
5. Integration branch from canonical Main: adapt Q first, then L; canonical adapters over duplicates; full combined battery; DASHBOARD_TRUTH.md owner test; director-owned I00; land + push; lane SHAs preserved.

## I00 checklist (pre-staged)

- protocol compatibility + generated-client parity; authority/duplicate-owner scan clean
- public evidence → assessment → strategy → capital/risk → ticket → simulated outcome → feedback chain green
- restart/chaos campaigns; canonical API/UI truth; docs/DASHBOARD_TRUTH.md acceptance test
- security/perimeter regressions; zero external actions; live execution still mechanically blocked
- STATE.md + capability map updated in the landing commit
