# EXTERNAL_ACTION_AUTHORIZATION — common draft template

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED`

Authorization effective: `false`

Result: `NOT_RUN`

Reconciliation: `NOT_RUN`

Copy this template for exactly one I00 §20 class. Do not mark it `APPROVED` until every placeholder is exact, the independently verified candidate is bound, the owner signs durably, and the canonical validator accepts the record.

## Required binding

| Field | Draft value |
| --- | --- |
| Authorization ID | `OWNER_MUST_SET_UNIQUE_DURABLE_ID` |
| Action class | `OWNER_MUST_SELECT_EXACTLY_ONE_I00_CLASS` |
| Scope | `OWNER_MUST_BIND_NARROW_SCOPE` |
| Account | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT` |
| Host | `OWNER_MUST_BIND_EXACT_HOST_OR_NOT_APPLICABLE_WITH_REASON` |
| Environment | `OWNER_MUST_BIND_EXACT_ENVIRONMENT` |
| Verified candidate SHA/tree | `OWNER_MUST_BIND_FULL_SHA_AND_TREE` |
| Deployed SHA/release/config/risk revision | `OWNER_MUST_BIND_OR_MARK_NOT_APPLICABLE_WITH_REASON` |
| Commands | `OWNER_MUST_BIND_EXACT_ARGV; NO_SHELL_WILDCARDS` |
| Endpoints | `OWNER_MUST_BIND_EXACT_PRODUCT_ENDPOINTS` |
| Products | `OWNER_MUST_BIND_EXACT_PRODUCT_REALMS` |
| Maximum capital | `OWNER_MUST_BIND_EXACT_BOUND` |
| Maximum notional | `OWNER_MUST_BIND_EXACT_BOUND` |
| Maximum operational effect | `OWNER_MUST_BIND_ONE_BOUNDED_EFFECT` |
| Credential types | `OWNER_MUST_NAME_TYPES_ONLY; NEVER_VALUES` |
| Credential permissions | `OWNER_MUST_BIND_MINIMUM_EXACT_PERMISSIONS` |
| Start / expiry | `OWNER_MUST_BIND_ORDERED_UTC_TIMESTAMPS` |
| Preconditions | `OWNER_MUST_BIND_HASHED_CURRENT_EVIDENCE` |
| Preview digest / nonce | `OWNER_MUST_BIND_SERVER_PREVIEW_AND_SINGLE_USE_NONCE` |
| Rollback | `OWNER_MUST_BIND_EXACT_ROLLBACK` |
| Recovery | `OWNER_MUST_BIND_EXACT_FAIL_CLOSED_RECOVERY` |
| Owner confirmation | `UNSIGNED — OWNER_ID, UTC, DURABLE_REFERENCE REQUIRED` |
| Result receipt | `OWNER_MUST_BIND_EXACT_TARGET` |
| Reconciliation receipt | `OWNER_MUST_BIND_DISTINCT_EXACT_TARGET` |

## Global deny list

No withdrawal, transfer-out, broad credential, secret value, unbounded retry, automatic capital increase, implicit class escalation, or action after expiry. Missing or mismatched preconditions invalidate the record before mutation.

## Owner sign-off

```text
owner: UNSET
approved_at_utc: UNSET
durable_reference: UNSET
status: DRAFT_OWNER_SIGNOFF_REQUIRED
```
