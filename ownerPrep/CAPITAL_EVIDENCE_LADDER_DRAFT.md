# Capital–evidence ladder policy draft

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — ZERO EXTERNAL ACTIONS**

This is an owner-proposed `$10 → $50 → $200` ladder. Only the inherited 10-USDT canary is source law. `$50` and `$200` are proposed owner thresholds from D-LAUNCH-19; they are not universal strategy truth, cannot be reached automatically, and do not change Capital/Risk ownership.

## Permanent policy

- Each rung is a hard aggregate ceiling, not a target and not a per-leg/per-strategy allowance.
- Promotion requires a new reviewed configuration/deployment revision, exact evidence bundle, explicit owner authorization, expiry, rollback and demotion state.
- Q supplies advisory evidence only. Capital owns allocation/position policy; Foundation Risk owns final multi-leg risk; the canonical executor remains the only mutation boundary.
- No Kelly rule, profit target, calendar duration, fixed trade count, winning streak, code volume or model narrative promotes a rung.
- Unknown, stale, incomplete, inconsistent, unreconciled, recovery-required or missing evidence blocks promotion and new exposure.
- Demotion/halt is automatic only toward less authority; promotion is never automatic.
- Loss caps for `$50` and `$200` are deliberately `OWNER_MUST_SET`. They must not be inferred proportionally from the 2-USDT canary cap.

## Evidence bundle required for every promotion

| Evidence family | Required owner-bound proof |
| --- | --- |
| Operational correctness | Acknowledgements, fills, reconciliation, restart and recovery across an owner-set effective sample; zero unresolved ambiguity, liability or authority violation |
| Execution calibration | Predicted versus realized fees, slippage, latency and adverse selection, with error distributions and conservative bias |
| Effective sample size | Independent events across owner-set symbols, time windows and regimes; clustered observations never counted as independent trades |
| Uncertainty | Clustered/block-bootstrap interval and owner-set lower-bound acceptance rule; no IID shortcut |
| Live versus shadow | Version-bound divergence distribution and owner-set maximum tolerated drift |
| Loss and recovery | Drawdown, tail loss, one-leg exposure, failure, recovery-time and recovery-cost distributions |
| Model behavior | Calibration, abstention, missing-data and regime-disagreement behavior; edge remains falsifiable |
| Capacity/liquidity | Strategy-specific depth, impact, borrow, funding, filters, min-notional, rate-limit and operational capacity at the proposed ceiling |
| Governance | Exact verified/deployed/config/risk/model/envelope revisions, owner authorization, expiry, rollback and demotion receipt |

Every numerical threshold above remains an explicit owner field until evidence exists. Absence is a failed gate, not permission to improvise.

## Rung 1 — inherited canary: maximum 10 USDT aggregate

State before owner authorization: `OWNER_GATED / NO_LIVE_TICKET`.

Hard inherited envelope:

```text
maximum allocated capital: 10 USDT equivalent aggregate
maximum active strategy tickets: 1
maximum automatic repeat entries: 0 until owner re-arm
maximum aggregate canary loss: 2 USDT
unknown/stale/mismatch: no new entry
withdrawal/transfer: impossible
```

Entry requires independently verified and deployed bytes, private/account truth under its own authorization, product-specific signed validation under separate classes, current reconciliation, recovery proof, exact exchange-minimum math, one ticket preview, one owner-approved tiny-live authorization and zero unresolved P0/P1 safety finding. Reaching 2 USDT aggregate loss forces `HALTED`; a new owner authorization is required to re-arm.

## Rung 2 — proposed owner ceiling: maximum 50 USDT aggregate

State before promotion: `OWNER_PROPOSED / NOT_AUTHORIZED`.

Promotion requires all nine evidence families measured from the complete 10-USDT loop, plus:

- `OWNER_MUST_SET` minimum effective independent events/symbols/regimes;
- `OWNER_MUST_SET` clustered-bootstrap lower-bound rule after all costs;
- `OWNER_MUST_SET` maximum live-shadow divergence;
- `OWNER_MUST_SET` drawdown, tail-loss, one-leg-duration and recovery-time limits;
- zero unresolved ambiguity, missing liability, blind resend, authority violation or false-green incident;
- capacity and min-notional proof at 50 USDT aggregate without leverage/capital inflation;
- successful source-loss, recovery-required, loss-cap, watchdog-delivery and rollback/restore evidence for the exact deployed revision;
- owner-bound maximum loss, ticket count, repeat policy, per-strategy/per-symbol caps, recovery reserve, expiry and immediate demotion triggers.

No 50-USDT action is authorized by this file.

## Rung 3 — proposed owner ceiling: maximum 200 USDT aggregate

State before promotion: `OWNER_PROPOSED / NOT_AUTHORIZED`.

Promotion requires all nine evidence families measured from the complete 50-USDT loop, plus:

- evidence across owner-defined non-overlapping market regimes and independent event clusters;
- capacity/impact/borrow/funding proof at 200 USDT aggregate with conservative depth haircuts;
- stable deployed operation across owner-defined observation windows without hiding downtime or stale evidence;
- restart/reconciliation, external watchdog, backup, isolated restore and rollback proof for the exact release/schema/config/model set;
- reviewed incident record and closed corrective evidence for every selected capital, reconciliation, recovery, security, deployment or prolonged-availability incident;
- owner-bound maximum loss, gross/notional/leverage/liability ceilings, ticket/repeat policy, recovery reserve, expiry and immediate demotion triggers;
- a new one-class authorization for every money or external action. This rung is a ceiling policy, not standing order authority.

No 200-USDT action is authorized by this file.

## Demotion and stop law

Immediately halt new exposure or demote to the last proven rung on any loss ceiling, stale/private mismatch, sequence gap without continuity, calibration breach, live-shadow divergence breach, capacity breach, unexpected authority path, unreconciled incident, watchdog/paging failure, backup/restore failure, deployed-SHA mismatch or expired authorization. Existing exposure remains visible and exit/recovery stays available. Re-promotion requires a new evidence bundle and owner sign-off; prior approval never transfers automatically.

## Owner decision record

```text
current_rung: NOT_AUTHORIZED
proposed_rung: UNSET
evidence_bundle_sha256: UNSET
verified_sha: UNSET
deployed_sha: UNSET
config_risk_model_envelope_revisions: UNSET
maximum_loss_and_ticket_policy: UNSET
starts_at_utc: UNSET
expires_at_utc: UNSET
rollback_demotion_state: UNSET
owner: UNSET
durable_reference: UNSET
```
