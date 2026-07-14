# EXTERNAL_ACTION_AUTHORIZATION — signed Spot test order

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `signed Spot test order` |
| Scope | One exact Spot validation request with confirmed non-matching test semantics |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT_AND_RUNTIME_TARGET` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_AND_DEPLOYED_SHA_CONFIG_RISK_FILTER_REVISIONS` |
| Commands/endpoints/products | `OWNER_MUST_BIND_ONE_EXACT_SIGNED_TEST_COMMAND_ENDPOINT_SYMBOL_SIDE_TYPE_TIF_AND_FILTER_PREVIEW` |
| Maximum capital/notional/effect | `0` / exact validation payload bound by owner / validation only, no matching-engine entry |
| Credentials/permissions | Exact Spot test-validation permission only; withdrawal, transfer, Margin and live order disabled; no values |
| Start/expiry | `OWNER_MUST_BIND_SINGLE_USE_UTC_WINDOW` |
| Preconditions | Current official test semantics reverified; clock/rate/filter preview exact; account permissions match; no stale/unknown fact; nonce unused |
| Rollback/recovery | No resend on ambiguity; reconcile by deterministic request identity; expire nonce and authorization; keep live execution blocked |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This class cannot authorize a live order, USD-M request, Margin action, repeat, capital increase, withdrawal, or transfer.
