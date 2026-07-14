# Zero-capital game-day — recovery required

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — NOT EXECUTED**

Inherits `00-zero-capital-common-safety.md`.

## Objective

Prove that partial/ambiguous two-leg fixture state becomes the machine’s primary concern, survives restart, and cannot be blindly resent or rendered flat.

## Candidate-bound plan

1. Bind `BIND_AT_CANDIDATE_ONE_LEG_RECOVERY_SCENARIO` and create one synthetic validate-only plan with deterministic client identities.
2. Inject a partial first-leg observation, then an absent or ambiguous second-leg acknowledgement.
3. Assert `RECOVERY_REQUIRED`/`AMBIGUOUS` is durable; new entries and additions stop; kill/intake gates cannot hide the existing exposure.
4. Attempt the same command identity twice. Assert idempotent prior result or deterministic rejection, never a second mutation.
5. Cut the local process at each accepted lifecycle boundary, restart from the same persisted fixture state, and reconcile before readiness.
6. Inject conflicting local/exchange observations. Assert divergence remains explicit and no `CLOSED`, zero exposure, cleared liability, or healthy status is fabricated.
7. Complete only the accepted synthetic recovery path; require an independent postcondition and quiet-period proof before recovered/ready.

## Required pass evidence

- no duplicate mutation or reservation;
- no lost exposure/liability and no false flat/closed state;
- reconciliation precedes readiness after every restart;
- bounded recovery attempts, fencing and stale-owner rejection;
- exit/recovery remains available while new risk stays blocked;
- cockpit and ledger preserve the full causal trace;
- capital/notional/external effects remain exactly zero.
