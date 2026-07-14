# EXTERNAL_ACTION_AUTHORIZATION — service restart/deploy

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `service restart/deploy` |
| Scope | One exact immutable release switch or one exact service restart; owner must choose one |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_TARGETS` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_SHA_TREE_RELEASE_SCHEMA_CONFIG_MODEL_AND_ROLLBACK_FLOOR` |
| Commands/endpoints/products | `OWNER_MUST_BIND_EXACT_ARGV_UNIT_AND_LOOPBACK_PROBES` |
| Maximum capital/notional/effect | `0` / `0` / switch or restart one enumerated application unit |
| Credentials/permissions | Exact local operator/session type and one unit permission; no secret values |
| Start/expiry | `OWNER_MUST_BIND_SHORT_UTC_WINDOW` |
| Preconditions | Clean trusted build; backup; schema compatibility; drain; exposure `NONE`; ambiguity false; recovery false; readiness and rollback candidate valid |
| Rollback/recovery | Atomic switch to the exact prior compatible release; restart only the same unit; reconcile tested/deployed SHA and durable state |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This class does not authorize infrastructure/vendor activation, a production restore, private/signed exchange access, or capital.
