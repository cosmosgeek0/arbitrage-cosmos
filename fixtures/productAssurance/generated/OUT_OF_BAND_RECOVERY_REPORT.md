# Out-of-Band Recovery Report

Generated for f67db03293b184473f7f8e79b8872c6f6697f264 at 2026-07-13T14:29:41.020Z.

Disposition: **CONTRACTS_AND_FIXTURES_ONLY**. Controller mounting, persistence, service restart, deployment, external mutation, and money paths are NOT_CONFIGURED.

## Remediation actions

| # | Action |
| --- | --- |
| 1 | RECONNECT |
| 2 | RESUBSCRIBE |
| 3 | RESNAPSHOT_SEQUENCE_GAP |
| 4 | ROTATE_STREAM |
| 5 | RESYNC_CLOCK |
| 6 | REFRESH_FILTERS |
| 7 | FAILOVER_ACCEPTED_SOURCE |
| 8 | RATE_LIMIT_COOLDOWN |
| 9 | QUARANTINE_POISON_EVENT |
| 10 | RESTART_BOUNDED_WORKER |
| 11 | RECOVER_DB_CHECKPOINT |
| 12 | INVALIDATE_CACHE |
| 13 | RECOVER_TELEMETRY_EXPORT |
| 14 | WATCHDOG_RESTART |
| 15 | MAINTENANCE_DRAIN |

## Durable lifecycle states

| # | State |
| --- | --- |
| 1 | DETECTED |
| 2 | CONTAINING |
| 3 | DIAGNOSING |
| 4 | PLANNED |
| 5 | EXECUTING |
| 6 | VERIFYING |
| 7 | RECOVERED |
| 8 | AWAITING_AUTHORIZATION |
| 9 | AUTH_REJECTED_OR_EXPIRED |
| 10 | CANCELLING |
| 11 | SUPERSEDED |
| 12 | ROLLING_BACK |
| 13 | COMPENSATED |
| 14 | COMPENSATION_FAILED |
| 15 | QUARANTINED |
| 16 | FAILED_ATTENTION_REQUIRED |

## Rate-budget owner seam

| Owner | State | Verdict | Target | Blocker | Authority |
| --- | --- | --- | --- | --- | --- |
| INTELLIGENCE_RUNTIME_RATE_BUDGET | WAITING | UNKNOWN | server/src/intelligenceRuntime lifecycle and aggregate snapshot contract | AGGREGATE_RATE_BUDGET_OWNER_CONTRACT_NOT_CONFIGURED | false |

A-CORE no longer allocates or projects aggregate rate budget. Recovery stays bounded by durable identity, leases, attempts, authorization, cancellation, rollback, independent postconditions, and quiet periods, without granting execution or money authority.
