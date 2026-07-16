# Agentic Diagnostic Boundary

Generated for f67db03293b184473f7f8e79b8872c6f6697f264 at 2026-07-13T14:29:41.020Z.

The locally owned boundary remains deny-by-default, redacts untrusted evidence, forbids money capabilities, and grants no authority. A-CORE no longer implements diagnostic governance, action-evidence evaluation, assurance-case graph evaluation, promotion classes, corpus governance, or provider identity authority.

| Surface | Owner | State | Verdict | Target | Blocker | Authority |
| --- | --- | --- | --- | --- | --- | --- |
| ACTION_EVIDENCE | ACTION_EVIDENCE_SATELLITE | WAITING | UNKNOWN | fixtures/productAssurance/systemic/actionEvidence/** | DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING | false |
| ASSURANCE_CASE | ASSURANCE_CASE_SATELLITE | WAITING | UNKNOWN | fixtures/productAssurance/systemic/assuranceCase/** | DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING | false |
| DIAGNOSTIC_GOVERNANCE | A_AGENT_DIAGNOSTIC_GOVERNANCE | WAITING | UNKNOWN | fixtures/productAssurance/systemic/agentBoundary/** | DIRECTOR_ACCEPTED_SATELLITE_COMMIT_MISSING | false |

## Local deny list

| # | Forbidden capability |
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

Provider outage does not change deterministic safety, execution, money authority, or product readiness.
