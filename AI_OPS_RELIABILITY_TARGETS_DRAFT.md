# AI-Ops reliability targets - owner-decision draft

Status: `DRAFT-REQUIRES-OWNER-SIGNATURE / NON_DONOR_ADVISORY_ONLY / WAITING_INTEGRATED_ACCEPTED`

This is a numerical recommendation sheet, not the owner-accepted `AI_OPS_RELIABILITY_TARGETS.md` required by activation Section 15 P1. No value below is measured, active, accepted, or a permission. Every row must be accepted or revised by the human owner after the immutable accepted base exists and before implementation begins.

Evidence cutoff used only to inform recommendations: `i00-product-assembly-20260713@03857dcdaff8d8b12627d27ddcc97505da1f2f86`, tree `92a2ec21b060eb0da3c98e3d6b16fad9843bbf89`. Current observed engine thresholds are not owner acceptance for AI Ops.

## Required P1 numerical targets

| Target | Unit | Recommended value | Measurement boundary | Rationale | Decision status |
| --- | ---: | --- | --- | --- | --- |
| Evidence age | milliseconds | Required current safety, health, reconciliation and queue evidence: finite `0 <= ageMs <= 5,000`; any stricter canonical-owner threshold wins | `bundleFrozenAt - canonical freshness-basis timestamp`, using the oldest required current datum; historical evidence is separately windowed; a future timestamp fails temporal validation | Aligns with the observed 5-second live-market stale boundary without weakening any domain owner. Negative, stale or missing age cannot validate a diagnosis. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Temporal skew | milliseconds | Required correlated evidence span `<=2,000`; absolute host clock offset `<=100` | Maximum minus minimum normalized occurrence time across required evidence for one correlation window; host offset measured independently | Keeps evidence coherent within the observed 2-second processing rhythm and inside the current Basis owner's 2.5-second leg-skew ceiling. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Mean time to detect (MTTD) | seconds | `SEV0/SEV1`: p95 `<=5`, hard maximum `10`; `SEV2`: p95 `<=30`, hard maximum `60` | Canonical `occurredAt`, or first deterministically observable receipt when occurrence time is unavailable, through persisted `DETECTED` | Critical containment and paging cannot wait for model diagnosis. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Page delivery | seconds | `SEV0/SEV1`: p95 `<=15`, hard maximum `30` | Persisted page decision through independently read-back destination acceptance; human acknowledgement excluded | Sets an external delivery bar without falsely claiming a person has read the page. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Queue lag | seconds | Critical page, audit and case-admission queues: p99 `<=2`, hard maximum `5`; background AI jobs: p95 `<=5`, hard maximum `30` | Durable enqueue time through consumer lease/start time, measured per queue and priority class | Reserves critical capacity while permitting bounded background diagnosis. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Diagnosis deadline | minutes | `SEV0/SEV1`: `5`; `SEV2`: `15`; `SEV3`: `60` | Persisted `BUDGET_ADMITTED` after `EVIDENCE_FROZEN` through the first persisted `DIAGNOSIS_READY`, `INSUFFICIENT_EVIDENCE`, or `PROVIDER_UNAVAILABLE` disposition | Prevents endless model sessions. Expiry becomes an honest terminal disposition and never delays deterministic containment/page delivery. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| AI-plane recovery time objective (RTO) | minutes | Restored deterministic harness, case intake and canonical health readback `<=5`; unavailable/quarantine state detection and projection `<=30 seconds` | First confirmed harness/gateway loss through canonical healthy post-restart readback; an unavailable/quarantine transition is measured separately and does not satisfy RTO | Provider recovery is excluded; the deterministic product continues and provider unavailability remains visible while harness recovery is pursued. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| AI-plane recovery point objective (RPO) | authoritative records | `0` committed case transitions, approvals, attempts, effects, audit records or evidence hashes lost | Last acknowledged canonical-ledger commit compared with reconstructed post-restart state | Append-only workflow/effect state must survive process loss; disposable provider/chat caches do not count. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Rollback time | minutes | `<=5`; rollback failure detected, locked and externally paged within `30 seconds` | Owner-authorized or exactly pre-authorized rollback activation through last-known-good revision plus independent health readback | Measures completed recovery, not command submission. A failed rollback becomes a new critical incident. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Maximum dropped events | events / percent | `0` material or unaccounted events; explicitly coalescible `SEV4` telemetry `<=0.01%` per 24 hours, with every drop/coalescence counted | Producer sequence/inventory compared with canonical inbox, consumer, DLQ and disposition receipts | Audit, approval, policy, incident, effect, page and workflow events never use the informational allowance. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Maximum unavailable audit interval | seconds / minutes | `0 seconds` tolerated for admission of any new AI-originated effect; detect and page within `30 seconds`; verified restoration `<=5 minutes` | First failed independent append-only/WORM delivery or readback through verified restoration | Audit unavailability fails closed immediately. Durable local buffering does not authorize effects while independent delivery is unavailable. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Case-cost ceilings | USD per case lineage | P1 and every unsigned route: `$0.00`; proposed post-owner-authorized provider-route ceilings: `L0 $0`, `L1 $0.10`, `L2 $1`, `L3 $3`, `L4 $10`, `L5 $3`; lineage hard cap `$15` | All provider, tool, retrieval and worker charges attributable to one stable lineage, including retries and children | Pre-admission and mid-run breakers enforce the ceiling. Subscription routes incur no API spend and may never fall back to paid API/another account. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| AI-plane CPU overhead | vCPU / concurrency | Resident plane p95 `<=0.25 vCPU`; hard production-host cap `0.50 vCPU`; repair/browser workers prohibited on the deterministic production host; each isolated disposable worker hard cap `2 vCPU`, concurrency `1` | Matched AI-enabled minus AI-disabled workload plus cgroup/service accounting for every resident and disposable process | Keeps material-event routing lightweight and gives repair/browser workers a separate numerical ceiling outside deterministic-owner capacity. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| AI-plane memory overhead | MiB RSS / GiB / concurrency | Resident delta p95 `<=512 MiB`; hard production-host cap `1,024 MiB`; each isolated disposable worker hard cap `4 GiB`, concurrency `1` | Matched enabled/disabled RSS plus cgroup peak, with disposable workers separately and aggregately metered | Creates killable resident and worker bounds before Risk, reconciliation, Ledger or position supervision can be starved. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| AI-plane disk overhead | GiB capacity / MiB per 24h / percent free | Production local hard cap `10 GiB`; net growth `<=500 MiB/24h`; preserve `>=30%` filesystem free; each disposable worker scratch cap `10 GiB` and cleanup readback required | AI-owned WAL, outbox, cache, evidence and temp paths, including retained crash artifacts; canonical Ledger regression measured separately | Bounds leak/retention failures and worker scratch while reserving capacity for canonical durability and rollback. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| AI-plane network overhead | MiB per case / GiB per day / MiB per second / connections | Provider/research egress `<=50 MiB/case` and `<=1 GiB/day`; attributable throughput p95 `<=1 MiB/s`; added exchange-endpoint connections `0`; isolated-worker concurrency `1` | Credential-proxy receipts plus host/interface counters in matched enabled/disabled runs, with resident and worker totals | Bounds spend and saturation while enforcing that AI never creates or shares an exchange path. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |
| Core-path non-degradation guard | percent / milliseconds / count | Per-route paired-run p99 relative increase `<=2%` and absolute increase `<=10 ms`, each with `>=10,000` seeded samples per phase; added exchange disconnects, reconciliation gaps, Ledger durability failures or missed position-supervision cycles `0` | Same route, seed set, host allocation and workload phase compared disabled then enabled at baseline, expected, peak, burst, provider outage and sustained soak | Makes Section 15's material-degradation gate numerical and reproducible; passing resource caps cannot excuse a core regression. | `DRAFT-REQUIRES-OWNER-SIGNATURE` |

## Measurement and failure law

1. Canonical source/event/receipt/evaluation times remain distinct. The AI plane never invents or substitutes timestamps.
2. Percentiles are calculated separately per workload phase, severity and queue class; quiet periods cannot dilute a burst failure.
3. Unknown, missing, stale, unreadable or revision-mismatched measurements fail closed. They are not converted to zero.
4. A canonical owner's stricter freshness, skew, durability or resource threshold always overrides this draft.
5. MTTD/page/queue/diagnosis clocks use persisted canonical transitions, not provider timestamps or UI render time.
6. `RPO=0` applies to acknowledged canonical records, not disposable provider conversation IDs, prompt caches or compaction summaries.
7. `0` maximum material drops includes audit, approval, denial, policy/control change, action, deployment, rollback, incident, page and workflow transitions.
8. Subscription workers consume only the explicitly configured subscription's normal limits. Limit/auth loss transitions to `DIAGNOSTIC_PLANE_UNAVAILABLE`; it never resets a budget or selects paid fallback.
9. No target authorizes an effect. Policy, role, tool, owner approval, lease/fence, exact artifact hash and current preconditions remain separate gates.

## Required proof matrix before signature and activation

| Workload | AI state comparison | Minimum evidence required |
| --- | --- | --- |
| Baseline idle | Disabled vs enabled/idle | Resident CPU/memory/disk/network deltas; zero core behavior change |
| Expected load | Disabled vs deterministic harness/fake provider | Every target percentile and queue class; canonical owner health unchanged |
| Peak load | Disabled vs admitted maximum concurrency | Resource caps, queue reservation, no starvation or control-path regression |
| Burst | Alert/event storm with duplicate and out-of-order inputs | Dedupe/inhibition, bounded queues, zero material drops, critical capacity retained |
| Provider outage/quota/auth loss | Provider absent before boot and lost mid-case | Honest unavailable transition; deterministic product and paging continue |
| Sustained soak | Disabled and enabled `24-hour` expected-load runs with recorded burst windows | No leak, budget reset, drift, missing audit interval, retry storm or hidden backlog |
| Saturation/fault | CPU, memory, disk, network, queue, DLQ, WAL, audit and policy faults | AI quarantines/fails closed before deterministic product owners are starved |

Activation fails if the AI-enabled result breaches any signed hard maximum, adds any forbidden core failure, or materially degrades exchange connectivity, reconciliation, Ledger durability, position supervision, existing refresh/control paths or trading/control-path p99 beyond the signed budget.

## Owner decision record

| Field | Current value |
| --- | --- |
| Decision | `NOT_SIGNED` |
| Owner identity | `MISSING` |
| Accepted/revised target-set digest | `MISSING` |
| Accepted base SHA | `MISSING` |
| Evidence run IDs | `MISSING` |
| Signature/time | `MISSING` |

The owner must sign the eventual canonical target set row by row or supply a signed revision. Silence, chat context, a provider response, worker consensus or director review does not count as owner acceptance.
