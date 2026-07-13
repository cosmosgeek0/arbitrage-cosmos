# QL_PARALLEL_DAG.md — packet board (director-owned)

Updated: 2026-07-12 (D-LAUNCH-5). States: READY / WORKING / ACCEPTED / PARKED / BLOCKED / WAITING.

| Packet | Worktree | Branch | Base SHA | State |
| --- | --- | --- | --- | --- |
| Q spine Q00–Q06 | quant-edge-research-20260712 | quant-edge-research-factory-20260712 | 73e1a1f | ACCEPTED through Q09-merged — Q10 ACCEPTED; Q11+Q14 merged; Q12 ACCEPTED; Q13+Q15 merged; spine SPRINTING Q16→Q17 to LANE_READY |
| Q07 microstructure | SPINE-OWNED (shard retired 2026-07-12; spine was already WORKING Q07 at d057373) | quant-edge-research-factory-20260712 | 24ccf58 | ACCEPTED on spine (f0d4448) |
| Q08 derivatives | ~/Desktop/q08-derivatives | q08-derivatives-20260712 | 24ccf58 | ACCEPTED + MERGED onto lane (c00de40, 494d6ce; 1,649 pass) |
| Q09 regime | ~/Desktop/q09-regime | q09-regime-20260712 | 24ccf58 | ACCEPTED + MERGED onto lane (1,842 pass) |
| Q14 validation-infra | ~/Desktop/q14-validation-infra | q14-validation-infra-20260712 | 24ccf58 | ACCEPTED + MERGED (2,182 pass) |
| Dashboard shell satellite | ~/Desktop/dash-shell | dashboard-shell-20260712 | 0f2bb88 | ACCEPTED (6925015 + RECEIPT.md) — wire at integration |
| Q13 deep-gate shard | ~/Desktop/q13-deep-gate | q13-deep-gate-20260712 | f756f3b | ACCEPTED + MERGED (2,455 pass) |
| Q15 registry shard | ~/Desktop/q15-registry | q15-registry-20260712 | f756f3b | ACCEPTED + MERGED (2,342 pass) |
| L15 deploy-infra satellite | ~/Desktop/l15-infra | l15-deploy-infra-20260712 | 0f2bb88 | ACCEPTED (2cec412; 347 assertions) — merge at integration |
| Q11 survival | ~/Desktop/q11-survival | q11-survival-20260712 | 8a5dd09 | ACCEPTED + MERGED (2,182 pass with Q14) |
| L spine L00–L08 | live-execution-proof-20260712 | live-execution-control-proof-20260712 | 73e1a1f | L00–L08 + L08.1 + L08.2 (9f133ac) + L14 ACCEPTED; spine PARKED until L09/L10/L11 merge, then L12→L13→L16→L17; Codex left auditable uncommitted L06 work; TWO director decisions DEFERRED to I00: ledger compare-and-set primitive + Foundation quantity-bridge contract (see live-edge-receipts/patches/) |
| L14 controls shard | ~/Desktop/l14-controls | l14-controls-20260712 | 39ebd98 | ACCEPTED + MERGED (51/51 liveEdge suites) |
| L09 normal-basis shard | ~/Desktop/l09-normal-basis | l09-normal-basis-20260712 | f79247a | re-based on L08.2 (9f133ac) — READY, resume block 10 |
| L10 reverse-basis shard | ~/Desktop/l10-reverse-basis | l10-reverse-basis-20260712 | 4ae270a | READY |
| L11 volume shard | ~/Desktop/l11-volume | l11-volume-20260712 | 4ae270a | READY |

| IP-RUNTIME packet | ~/Desktop/ip-runtime | ip-runtime-20260713 | 420cc83 | PRESTAGE_READY — fan-in at I00 spine |
| IP-CONTROL packet | ~/Desktop/ip-control | ip-control-20260713 | 420cc83 | BINDING_READY (56c47da) — fan-in at I00 spine |
| IP-OPS packet | ~/Desktop/ip-ops | ip-ops-20260713 | 420cc83 | OPS_READY — fan-in at I00 spine |
| IP-PROOF packet | ~/Desktop/ip-proof | ip-proof-20260713 | 420cc83 | PROOF_PRESTAGE_READY (23e985c) — fan-in at I00 spine |

| I00-VERIFY | ~/Desktop/i00-assembly | i00-product-assembly-20260713 | 1fec867 | I00_PRESTAGE_VERIFIED (635ad83) — awaits director real-adapter I00 after lanes |

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
