# Resource and Backpressure Report — IP-PROOF prestage

Generated from `fixtures/i00/closure-evidence.json` at 2026-07-13T00:00:00Z. Scope is `FIXTURE_PRESTAGE`; all fixture-chain evidence is permanently `SYNTHETIC`. This report proves the prestage harness and named evidence only. It does not claim real-adapter integration, deployment, private truth, signed validation, or live execution.

The executable measurement-plan contract uses an injected clock, 60000 ms windows, at least 5 samples, and p50/p95/p99/max. The displayed distributions are deterministic `SYNTHETIC` fixtures, not runtime measurements or production SLOs. Plan bounds are initial proxy gates for director replacement, not observed host capacity. Capacity breach must become `DEGRADED` or `BLOCKED` before silent loss. Lower-tier shedding is counted in P4→P3→P2 order; P0 material loss must remain exactly zero and P0/P1 remain available.

## Load-shedding priority

| Priority | Work preserved |
| --- | --- |
| P0 | position supervision,reconciliation,recovery,private truth,ledger,operator control |
| P1 | risk,execution,exposure |
| P2 | canonical public sources and engines |
| P3 | Q advisory enrichment |
| P4 | optional research,replay,news,charts,broad enrichment |

## Measurement matrix

| Metric | Unit | Producer | Method | Plan soft bound | Plan hard bound | Fixture p50/p95/p99/max | Fixture breach | Product status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CPU | percent | process/host telemetry | p50/p95/p99/max | 70 | 90 | 65/80/80/80 | DEGRADED | MEASUREMENT_PENDING |
| EVENT_LOOP | milliseconds | Node runtime | lag distribution | 50 | 200 | 20/75/75/75 | DEGRADED | MEASUREMENT_PENDING |
| MEMORY | bytes | process telemetry | RSS and heap distribution | 536870912 | 805306368 | 400000000/500000000/500000000/500000000 | OK | MEASUREMENT_PENDING |
| PROCESS_GROWTH | bytes_per_hour | soak harness | slope | 10485760 | 52428800 | 3000000/5000000/5000000/5000000 | OK | MEASUREMENT_PENDING |
| DISK_WAL | bytes | SQLite/host | size and growth | 1073741824 | 5368709120 | 14000000/18000000/18000000/18000000 | OK | MEASUREMENT_PENDING |
| EVIDENCE_LOG_GROWTH | bytes_per_hour | retention telemetry | tiered growth | 104857600 | 524288000 | 3000000/5000000/5000000/5000000 | OK | MEASUREMENT_PENDING |
| PUBLIC_RATE | events_per_second | intelligenceRuntime | source rate distribution | 20000 | 50000 | 10000/18000/18000/18000 | OK | MEASUREMENT_PENDING |
| PRIVATE_RATE | events_per_second | accepted L private truth | product-separated rate | 1000 | 5000 | 0/0/0/0 | UNAVAILABLE | OWNER_GATED |
| Q_RATE_LATENCY | milliseconds | accepted Q | rate plus p50/p95/p99 | 250 | 1000 | 40/60/60/60 | UNAVAILABLE | AWAITING_ACCEPTED_Q_TIP |
| QUEUE_DEPTH | items | all bounded queues | depth/capacity | 70 | 100 | 20/60/60/60 | OK | MEASUREMENT_PENDING |
| PROCESSING_LAG | milliseconds | domain components | event-to-processed | 250 | 1000 | 40/60/60/60 | OK | MEASUREMENT_PENDING |
| DROP_COALESCE_SUPERSEDE | count | bounded queues | separate counters | 10 | 100 | 2/8/8/8 | OK | MEASUREMENT_PENDING |
| DB_WRITE_LATENCY | milliseconds | Ledger | commit distribution | 50 | 250 | 6/10/10/10 | OK | MEASUREMENT_PENDING |
| BINANCE_WEIGHT_RATE | weight_per_interval | exchange adapters | header/readback budget | 700000 | 900000 | 300000/500000/500000/500000 | OK | MEASUREMENT_PENDING |
| RECONNECT_RESYNC | count | source lifecycle | fingerprinted counter | 5 | 20 | 1/2/2/2 | OK | MEASUREMENT_PENDING |
| FOCUS_CAPACITY | symbols | focus allocator | ready/capacity | 32 | 64 | 8/16/16/16 | OK | MEASUREMENT_PENDING |
| ACTIVE_TICKET_PRIORITY | priority_invariant | scheduler | P0 preempts P3/P4 | 0 | 0 | invariant | INVARIANT | FIXTURE_PRESTAGED |
| API_BROWSER_PRESSURE | bytes_per_second | API/read model | fanout and cursor load | 5242880 | 20971520 | 300000/500000/500000/500000 | OK | MEASUREMENT_PENDING |
| LOAD_SHED_ORDER | priority_invariant | supervisor | P4 then P3 then P2; P0 preserved | 0 | 0 | invariant | INVARIANT | FIXTURE_PRESTAGED |
