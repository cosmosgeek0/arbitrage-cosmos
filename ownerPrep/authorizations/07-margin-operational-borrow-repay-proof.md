# EXTERNAL_ACTION_AUTHORIZATION — Margin operational borrow/repay proof

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `Margin operational borrow/repay proof` |
| Scope | `OWNER_MUST_BIND_ONE_EXACT_BORROW_OR_REPAY_OPERATION; NEVER_BOTH_IMPLICITLY` |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT_MODE_AND_RUNTIME_TARGET` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_AND_DEPLOYED_SHA_CONFIG_RISK_LIABILITY_REVISIONS` |
| Commands/endpoints/products | `OWNER_MUST_BIND_ONE_EXACT_COMMAND_ENDPOINT_ASSET_AMOUNT_MODE_AND_PREVIEW_DIGEST` |
| Maximum capital/notional/effect | Draft grants `0`; owner must bind exact principal, interest ceiling, collateral effect, recovery reserve and liability lifetime |
| Credentials/permissions | Exact single-operation Margin permission; orders, transfer and withdrawal disabled; no values |
| Start/expiry | `OWNER_MUST_BIND_SINGLE_USE_UTC_WINDOW` |
| Preconditions | Separate private-read proof current; max-borrowable/cost current; Risk/Capital verdict exact; liability ledger and reconciliation healthy; repay/recovery path proven; nonce unused |
| Rollback/recovery | No blind retry; ambiguous result becomes `RECOVERY_REQUIRED`; reconcile liability before any new action; repay only under its own exact bound |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This draft grants no liability mutation. Borrow never implies order authority, and repay never authorizes transfer-out or withdrawal.
