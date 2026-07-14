# EXTERNAL_ACTION_AUTHORIZATION — Margin read/maximum-borrowable proof

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `Margin read/maximum-borrowable proof` |
| Scope | One exact account mode, asset, product and read-only maximum-borrowable/cost/freshness proof |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT_MODE_AND_RUNTIME_TARGET` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_AND_DEPLOYED_SHA_CONFIG_REVISION` |
| Commands/endpoints/products | `OWNER_MUST_BIND_EXACT_MARGIN_READ_COMMANDS_AND_ENDPOINTS` |
| Maximum capital/notional/effect | `0` / `0` / capability read only; no liability created |
| Credentials/permissions | Exact Margin read permissions only; borrow/repay, order, transfer and withdrawal disabled; no values |
| Start/expiry | `OWNER_MUST_BIND_SHORT_UTC_WINDOW` |
| Preconditions | Account mode and collateral realm exact; permission readback exact; stable egress; source TTL defined; no stale/unknown substitution |
| Rollback/recovery | Revoke session/materialization; mark borrow truth `UNAVAILABLE` after TTL; preserve liabilities as unknown rather than zero |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This class cannot authorize an operational borrow, repay, order, transfer, withdrawal, or live ticket.
