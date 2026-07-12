# DASHBOARD_TRUTH.md — the owner's screen contract (frozen owner requirement)

Owner ruling, 2026-07-12. This binds the L lane's Control Room phases and the director's combined I00 integration acceptance. The owner does not read terminals, receipts, or SHAs — the Dashboard must answer everything.

## The one-sentence contract

Within ten seconds of opening the Dashboard, the owner can answer: **what is running, what is not, why, what is degraded, what needs my attention, and what would happen if I pressed each control** — with zero terminal archaeology.

## What the Dashboard must show (all from the canonical supervisor snapshot — never recomputed in the browser)

1. **Whole-machine posture strip:** overall state, current mode (READ_ONLY / ADVISORY / VALIDATE_ONLY), kill-switch state, startup generation, last restart, first actionable blocker (root cause, not cascaded symptoms).
2. **Machine graph / component boxes:** every managed component (sources, universe, intelligence, Q brain when integrated, Basis, Volume, capital, risk, execution, reconciliation, ledger, supervisor) with: desired vs observed state, readiness vs liveness, freshness/heartbeat age, restart count, current error, and its honest truth label — LIVE / SHADOW / VALIDATE_ONLY / DRY-RUN / SYNTHETIC / BLOCKED / NOT_CONFIGURED / MISSING. Silent or stale can NEVER render green.
3. **Data-source health:** per source: connection state, last message age, sequence gaps, rate-limit/backoff, coverage counts. Quiet symbols remain visible.
4. **Engines:** Basis and Volume live ages, universe/candidate/focus/proposal counts, latest decisions and rejects WITH exact reason codes.
5. **Q research brain (post-integration):** EdgeBrainHealth state, model/dataset versions, drift state, latest advisory assessments with action (WATCH/FOCUS/PROPOSE_CONSIDERATION/ABSTAIN_UNKNOWN) and abstention reasons.
6. **Capital & exposure:** allocatable truth state, reservations, staged mandates, active exposure (highest visual priority when nonzero), approval states with expiry.
7. **Risk & execution:** latest multi-leg verdicts with blocking codes; dry-run plan/leg lifecycles; reconciliation states; the explicit LIVE_EXECUTION_NOT_IMPLEMENTED barrier visibly labeled.
8. **Attention queue:** everything requiring the operator, ranked (exposed capital first), each with its reason and the control that resolves it.
9. **Trace drill-down:** click any decision/candidate/plan → the full correlated chain (evidence → assessment → decision → capital → risk → plan → reconciliation → ledger) by correlation ID.
10. **Controls:** every control maps to one tested backend mutation (mode, kill switch, pause intake, component desired-state, approval revoke, config revision with bounds). No decorative toggles. Every mutation shows before/after state and is ledgered.

## Hard laws

- One truth source: the supervisor snapshot API. The UI may format, never infer.
- Unknown is rendered as UNKNOWN — never blank, never green, never zero.
- Synthetic/dry-run data is ALWAYS labeled as such — never visually confusable with live.
- Errors and staleness must be *visible degradation* (color/badge/age), not hidden logs.
- House visual system per DESIGN.md; no redesign, extend the existing pages (Dashboard, Health, Opportunities, Risk, Execution/Control, Logs).

## Acceptance (owner test, part of I00)

The owner opens the Dashboard cold and, pointing at the screen only, states: every component's state and why; the newest candidate and why it was accepted/rejected; whether any capital is exposed; what the kill switch would block; which sources are degraded. If any answer requires a terminal, the phase is not accepted.
