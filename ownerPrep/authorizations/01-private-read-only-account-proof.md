# EXTERNAL_ACTION_AUTHORIZATION — private read-only account proof

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `private read-only account proof` |
| Scope | Exact Spot/USD-M/Margin account facts named by owner; reads only |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT`, `OWNER_MUST_BIND_HOST`, `OWNER_MUST_BIND_ENVIRONMENT` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_SHA_TREE_DEPLOYED_SHA_CONFIG_REVISION` |
| Commands/endpoints/products | `OWNER_MUST_BIND_EXACT_READ_COMMANDS_AND_ENDPOINTS` |
| Maximum capital/notional/effect | `0` / `0` / one bounded read-and-reconcile session |
| Credentials/permissions | Types and exact read permissions only; trade, borrow/repay, transfer and withdrawal disabled; no values |
| Start/expiry | `OWNER_MUST_BIND_SHORT_UTC_WINDOW` |
| Preconditions | Fresh stable-egress readback; exact permission readback; account mode/fingerprint match; no exposure ambiguity; candidate verified |
| Rollback/recovery | Revoke the session/materialization, return private truth to `NOT_CONFIGURED`, preserve last-good facts as stale—not live |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

This class cannot sign a request that mutates account state and cannot imply either Margin class, signed test validation, deployment, or a live ticket.
