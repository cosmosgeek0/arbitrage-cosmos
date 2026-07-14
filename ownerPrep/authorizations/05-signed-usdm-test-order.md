# EXTERNAL_ACTION_AUTHORIZATION — signed USD-M test order

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `signed USD-M test order` |
| Scope | One exact USD-M validation request with confirmed non-matching test semantics |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT_MODE_AND_RUNTIME_TARGET` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_AND_DEPLOYED_SHA_CONFIG_RISK_FILTER_REVISIONS` |
| Commands/endpoints/products | `OWNER_MUST_BIND_ONE_EXACT_SIGNED_TEST_COMMAND_ENDPOINT_SYMBOL_POSITION_SIDE_TYPE_TIF_REDUCE_ONLY_AND_FILTER_PREVIEW` |
| Maximum capital/notional/effect | `0` / exact validation payload bound by owner / validation only, no position or matching-engine entry |
| Credentials/permissions | Exact USD-M test-validation permission only; withdrawal, transfer, Margin and live order disabled; no values |
| Start/expiry | `OWNER_MUST_BIND_SINGLE_USE_UTC_WINDOW` |
| Preconditions | Current official test semantics reverified; account/position mode exact; clock/rate/filter preview exact; no exposure ambiguity; nonce unused |
| Rollback/recovery | No resend on ambiguity; reconcile by deterministic client identity; expire nonce and authorization; keep live execution blocked |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This class cannot authorize a live order, Spot request, Margin action, leverage mutation, repeat, capital increase, withdrawal, or transfer.
