# QL_PARALLEL_DAG.md — packet board (director-owned)

Updated: 2026-07-12 (D-LAUNCH-5). States: READY / WORKING / ACCEPTED / PARKED / BLOCKED / WAITING.

| Packet | Worktree | Branch | Base SHA | State |
| --- | --- | --- | --- | --- |
| Q spine Q00–Q06 | quant-edge-research-20260712 | quant-edge-research-factory-20260712 | 73e1a1f | ACCEPTED through Q09-merged — spine SPRINTING Q10 ONLY, parks after (Q11 shard-owned; Q12+ after merges) |
| Q07 microstructure | SPINE-OWNED (shard retired 2026-07-12; spine was already WORKING Q07 at d057373) | quant-edge-research-factory-20260712 | 24ccf58 | ACCEPTED on spine (f0d4448) |
| Q08 derivatives | ~/Desktop/q08-derivatives | q08-derivatives-20260712 | 24ccf58 | ACCEPTED + MERGED onto lane (c00de40, 494d6ce; 1,649 pass) |
| Q09 regime | ~/Desktop/q09-regime | q09-regime-20260712 | 24ccf58 | ACCEPTED + MERGED onto lane (1,842 pass) |
| Q14 validation-infra | ~/Desktop/q14-validation-infra | q14-validation-infra-20260712 | 24ccf58 | WORKING |
| Q11 survival | ~/Desktop/q11-survival | q11-survival-20260712 | 8a5dd09 | READY |
| L spine L00–L08 | live-execution-proof-20260712 | live-execution-control-proof-20260712 | 73e1a1f | L04 ACCEPTED; L05 WORKING (ownership → Fable, D-LAUNCH-4) |
| L09 normal-basis shard | (cut on L08 acceptance) | l09-normal-basis-20260712 | accepted-L08 SHA | WAITING on L08 |
| L10 reverse-basis shard | (cut on L08 acceptance) | l10-reverse-basis-20260712 | accepted-L08 SHA | WAITING on L08 |
| L11 volume shard | (cut on L08 acceptance) | l11-volume-20260712 | accepted-L08 SHA | WAITING on L08 |

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
