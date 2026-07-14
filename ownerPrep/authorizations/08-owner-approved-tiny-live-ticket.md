# EXTERNAL_ACTION_AUTHORIZATION — one owner-approved tiny live ticket

Status: `DRAFT_OWNER_SIGNOFF_REQUIRED` · Effective: `false` · Result/reconciliation: `NOT_RUN`

| Field | Class-pinned draft value |
| --- | --- |
| Action class | `one owner-approved tiny live ticket` |
| Scope | One exact strategy ticket, symbols, legs, order semantics, invalidation, exit and recovery plan |
| Account / host / environment | `OWNER_MUST_BIND_EXACT_ACCOUNT_FINGERPRINT_MODE_AND_DEPLOYED_TARGET` |
| Candidate/deployed identity | `OWNER_MUST_BIND_VERIFIED_SHA_TREE_DEPLOYED_SHA_RELEASE_CONFIG_RISK_MODEL_AND_ENVELOPE_REVISION` |
| Commands/endpoints/products | `OWNER_MUST_BIND_EXACT_TICKET_PREVIEW_AND_CANONICAL_EXECUTOR_COMMAND` |
| Maximum capital | Hard ceiling `10 USDT equivalent aggregate` |
| Maximum notional/effect | Owner binds exact per-leg and gross limits within the aggregate envelope; one ticket; zero automatic repeats |
| Maximum loss | Hard ceiling `2 USDT aggregate canary loss`, including realized loss, negative unrealized PnL, fees, funding, borrow interest and conservative recovery cost |
| Credentials/permissions | Minimum exact trading permissions for the bound products; withdrawal and transfer disabled; no values |
| Start/expiry | `OWNER_MUST_BIND_SINGLE_TICKET_UTC_WINDOW_AND_ENVELOPE_EXPIRY` |
| Preconditions | All separate private/signed/Margin/deployment authorizations required by the structure are complete; reconciliation ready; fresh sources; no unknown/mismatch; recovery reserve available; exchange-minimum math fits |
| Rollback/recovery | At cap or ambiguity: `HALTED`, no new entry, recovery remains primary, no re-arm without a new owner authorization |
| Result/reconciliation receipts | `OWNER_MUST_BIND_TWO_DISTINCT_TARGETS` |
| Owner confirmation | `UNSIGNED` |

The draft never increases capital to satisfy exchange minimums. If the structure does not fit, the only result is exact `BLOCKED_BY_MIN_NOTIONAL` evidence. Withdrawal and transfer-out remain impossible.
