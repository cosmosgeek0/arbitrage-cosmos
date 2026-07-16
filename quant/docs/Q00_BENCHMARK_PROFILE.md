# Q00 benchmark profile

Measured 2026-07-12. Labels are deliberate: `OBSERVED_NOW`, `HISTORICAL_RECEIPT`, `SYNTHETIC_MODEL`, `PROVISIONAL_BUDGET`, or `UNKNOWN`.

## Host and dependency lock

| Item | Value | Class |
| --- | --- | --- |
| Host | MacBook Pro, Apple M4 Max, 16 cores (12 performance, 4 efficiency), 48 GB RAM | `OBSERVED_NOW` |
| OS | macOS 26.5.2, build 25F84 | `OBSERVED_NOW` |
| Node / npm | Node `v22.23.1`; npm `10.9.8` | `OBSERVED_NOW` |
| Root package contract | Node `22.x`; `npm@10.9.8` | `OBSERVED_NOW` from tracked `package.json` |
| Dependency lock | npm lockfile v3, 306 package entries, SHA-256 `3c97820f912390fcad3dab57b436319b95c15bc7877384dd98032d7751ec2fcf` | `OBSERVED_NOW` |
| Python lock | absent | `OBSERVED_NOW`; Q01 must create it before any Python dependency claim |
| Repository footprint | 233 MB total; 211 MB `node_modules`; built server 5.0 MB; built web 3.4 MB | `OBSERVED_NOW` |
| Workspace disk | 926 GiB volume, 648 GiB available at measurement | `OBSERVED_NOW` |

No serial number, hardware UUID, credential, environment value, or private/account fact belongs in this profile.

## Universe and evidence traces

| Profile | Fact | Class and limitation |
| --- | --- | --- |
| Point-in-time historical universe | no retained validity-interval master or archive manifest exists | `UNKNOWN`; Q02 must build it; today's `exchangeInfo` cannot backfill history |
| Runtime capacity model | fixed synthetic universe 452; watch 452; candidate 128; focus 25; deep focus 10 | `SYNTHETIC_MODEL`; not current exchange coverage |
| Manual runtime smoke, 2026-07-11 | 3,848 graph nodes; 15 Spot broad frames; 1,113/1,336 USD-M books accepted; 14/28 mark/funding accepted; 208 focused aggregate trades; 143 depth messages; 17,881 normalized records in 15 seconds | `HISTORICAL_RECEIPT`; finite, changed-only, not retained and not a throughput claim |
| Convergence public smoke | 447-symbol universe observed | `HISTORICAL_RECEIPT`; current branch has no retained event trace |
| Current Q event-rate trace | absent | `UNKNOWN`; Q00 makes no live-rate claim |

The capacity model's default synthetic inputs are starting load shapes only: mini ticker 20/s, USD-M book ticker 500/s, mark/funding 20/s, focused Spot aggregate trades 200/s, focused Spot depth 200/s, and optional liquidation 50/s. Q benchmarks must record real trace provenance before replacing these assumptions.

## Current cadences and caps to preserve as inputs

| Concern | Current fact | Treatment |
| --- | --- | --- |
| Engine loop | 2,000 ms tick; 30,000 ms heartbeat | current engine default, not Q-owned |
| Engine attention | soft focus 10; hard focus 25; protected/pinned active symbols survive weaker candidates | canonical strategy behavior; Q cannot allocate |
| Runtime capacity attention | watch 452; candidate 128; focus 25; deep focus 10; protected symbols max 25 | synthetic workload contract |
| Runtime focus allocator | 4,096 total streams; 1,024 pending controls; 200 streams/control; 1,000 ms control interval; bounded route connections/streams | implementation bound, not an exchange guarantee |
| Spot reducer | 10,000 symbols/frame, 64 recent trades/symbol, inbound 4,096, payload 2,000,000 bytes; drop/quality counters | implementation bound |
| Capture coordinator | 2,048 pre-rings; 256 records/ring; 256 active and 1,024 retained captures; 2 MiB evidence and 128 MiB checkpoint ceilings | implementation bound; Q consumes, never owns production capture |
| Official Spot depth | 1,000 ms or 100 ms options | current official contract; Q03 repins revision |
| Current USD-M depth migration | standard and RPI streams have different paths/cadences/coverage; RPI observed at 500 ms | current official contract; do not collapse variants |
| Liquidation | sampled per-symbol 1,000 ms stream; selection wording currently conflicts across official pages | treat completeness as sampled and selection as `UNKNOWN` pending pinned clarification |

## Active-position priority load

The synthetic workload allows at most 25 protected symbols and rejects a plan where protected active capital exceeds focus capacity. The mission and authority map make active capital the highest-priority observation class. Q therefore adopts this invariant for later load tests:

- protected/active symbols are never evicted to admit a research candidate;
- optional research evidence sheds before protected focus;
- Q capture failure cannot backpressure the canonical runtime;
- every dropped, coalesced, truncated, late, or gapped record is manifested;
- a missing protected feed produces abstention/degraded health, never an inferred quiet market.

Q00 has no active-position data and makes no measured active-load claim.

## Queue policy and overload targets

Reuse the runtime's priority classes conceptually: `CORE_BROAD`, `PROTECTED_FOCUS`, `FOCUS`, `OPTIONAL`. Existing synthetic thresholds provide provisional targets:

| State | Queue trigger | Lag trigger | Required behavior |
| --- | --- | --- | --- |
| nominal | every queue below 65%, with no drop/resync trigger | global p95 below 250 ms | process normally |
| pressured | any queue at least 65% | global p95 at least 250 ms | expose pressure and bound admission |
| optional shed | any queue at least 80%, or a Focus/Optional drop, or Focus resync | global p99 at least 750 ms | shed optional evidence first and manifest it |
| core degraded | Core Broad or Protected Focus at least 95%, or either drops/requires resync | global p99 at least 2,000 ms | fail closed; preserve protected truth; abstain |
| one-step recovery | every queue at most 50%, no drops/resync, for 5 ticks | global p95 at most 100 ms for the same ticks | recover one overload state per sustained window |

These are `PROVISIONAL_BUDGET` values inherited from the deterministic capacity model, not measured Q service performance.

## Memory and disk ceilings

- Q01/Q02 local test and metadata processes: provisional peak RSS ceiling 8 GiB on this host; exceeding it is a benchmark failure until deliberately revised with evidence.
- Q16 local inference: same 8 GiB hard benchmark ceiling; per-universe/focus RSS must be reported, not assumed.
- Q lake working-set disk: provisional hard admission ceiling is the smaller of 256 GiB or 40% of currently free workspace bytes. Downloads/partitions must reserve headroom before write and fail closed when the budget is unknown or exceeded.
- No historical data is downloaded in Q00. Q02 must turn these budgets into deterministic config and manifest facts before Q03 retrieval.

These are explicit `PROVISIONAL_BUDGET` guardrails, not observed consumption or claims that the final design needs this much memory/disk.

## Target SLO measurement contract

Q00 freezes what must be measured; it does not invent model latency numbers:

1. per-symbol feature update p50/p95/p99 at expected and stress traces;
2. single and bounded-batch inference p50/p95/p99, cold and warm;
3. peak/RSS and retained bytes by universe, focus, feature set and model;
4. queue depth, high-watermark, drops, coalescing, gap count and assessment age;
5. cold/warm startup and graceful shutdown integrity;
6. stable semantic replay hashes for inputs, lineage, decisions and reason codes;
7. zero runtime backpressure from Q and zero protected-focus drops;
8. any timeout, unknown economics, stale/gapped evidence, unsupported version, or resource breach returns `ABSTAIN_UNKNOWN`/degraded health rather than a late assessment.

Numeric inference latency promotion targets remain `UNKNOWN` until Q16 measures transparent baseline behavior on the pinned Q01 environment. The queue pressure/lag thresholds above are the only provisional numeric service targets at Q00.
