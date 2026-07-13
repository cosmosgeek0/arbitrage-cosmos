# Out-of-Band Recovery Report

Generated for `3391dcfba93bdf370859a62559612e5ea0d42a35` at `2026-07-13T00:00:00.000Z`.

Disposition: **CONTRACTS_AND_FIXTURES_ONLY**. Controller mounting, persistence, service/host restart, AWS, Cloudflare, Secrets, deployment, external mutation, private exchange access, and money mutation are **NOT_CONFIGURED** and grant no authority.

## Remediation actions (15)

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

## Durable lifecycle states (16)

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

Binding laws:

- campaigns preserve stable identity, cause, policy revision, before/after evidence, attempt/time/cost budgets, restart checkpoints, and cockpit correlation;
- ordered multi-resource leases are atomic; the repair-conflict graph prevents concurrent owners on one resource;
- lease expiry or handoff rejects stale completion;
- action completion never equals recovery;
- recovery requires independent postconditions plus a positive quiet/hysteresis period;
- authorization, cancellation, supersession, rollback, compensation, compensation failure, quarantine, and exhaustion stay explicit;
- automatic work cannot widen capital authority, raise risk limits, clear liability, fabricate health, or close an incident;
- owner-authorized external operations remain blocked at I00 §20.
