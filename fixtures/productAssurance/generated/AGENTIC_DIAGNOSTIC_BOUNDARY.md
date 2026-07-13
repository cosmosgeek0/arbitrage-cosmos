# Agentic Diagnostic Boundary

Generated for `3391dcfba93bdf370859a62559612e5ea0d42a35` at `2026-07-13T00:00:00.000Z`.

Provider state: **NOT_CONFIGURED**. External sandbox: **DENY_BY_DEFAULT**. Runtime authority: **false**. The base §3.9 hierarchy is **REUSED**; there is no second LLM runtime.

## Permission levels

| # | Permission |
| --- | --- |
| 1 | OBSERVE_EXPLAIN |
| 2 | BOUNDED_QUERY_REPLAY |
| 3 | PROPOSE_TYPED_ACTION |
| 4 | PATCH_ISOLATED_AND_TEST |
| 5 | OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY |

## Allowed capability IDs

| # | Capability |
| --- | --- |
| 1 | READ_REDACTED_EVIDENCE |
| 2 | EXPLAIN_CAUSAL_CHAIN |
| 3 | QUERY_BOUNDED_EVIDENCE |
| 4 | RUN_ISOLATED_REPLAY |
| 5 | PROPOSE_REGISTERED_REMEDIATION |
| 6 | PROPOSE_ISOLATED_PATCH |
| 7 | RUN_ISOLATED_TESTS |
| 8 | REQUEST_OWNER_HANDOFF |

## Forbidden capabilities

| # | Capability |
| --- | --- |
| 1 | SIGN_ORDER |
| 2 | CANCEL_ORDER |
| 3 | PLACE_ORDER |
| 4 | BORROW |
| 5 | REPAY |
| 6 | CHANGE_LEVERAGE |
| 7 | CHANGE_MARGIN_MODE |
| 8 | TRANSFER |
| 9 | WITHDRAW |
| 10 | RESERVE_CAPITAL |
| 11 | CHANGE_CAPITAL_POLICY |
| 12 | CHANGE_RISK_POLICY |
| 13 | CHANGE_HARD_CEILING |
| 14 | WRITE_MAIN |
| 15 | WRITE_PRODUCTION_PERSISTENCE |
| 16 | EDIT_GUARDRAILS |
| 17 | EDIT_PERMISSIONS |
| 18 | ARBITRARY_SHELL |
| 19 | ARBITRARY_NETWORK |
| 20 | AUTONOMOUS_MERGE |
| 21 | AUTONOMOUS_DEPLOY |
| 22 | DELETE_EVIDENCE |
| 23 | DECLARE_RECOVERY |

Binding laws: normalized schemas, raw-evidence hashes outside prompts, explicit untrusted-data separation, trace privacy, independent retention, immutable provider workload identity, exact capability checks, cost/rate budgets, audit records, repair-evidence law, Class A–D promotion law, and corpus governance. A diagnostic agent cannot sign, order, cancel, borrow, repay, change leverage/margin, transfer, withdraw, change Capital/Risk/hard ceilings, write Main/production persistence, use arbitrary shell/network, autonomously merge/deploy, delete evidence, execute operational actions, or declare recovery. Provider outage yields `DIAGNOSTIC_PLANE_UNAVAILABLE` without changing deterministic safety or product readiness.
