# Zero-capital game-day — rollback and isolated restore

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — NOT EXECUTED**

Inherits `00-zero-capital-common-safety.md`.

## Objective

Prove locally that failed preflight preserves the current release, rollback respects the schema floor, and restore uses isolated data without production mutation.

## Candidate-bound plan

1. Bind `BIND_AT_CANDIDATE_ROLLBACK_RESTORE_SCENARIOS` to accepted local fixture tools only.
2. Create fixture release A, candidate release B, an exact synthetic database/evidence/model set, checksums and a distinct isolated restore root inside the disposable checkout.
3. Inject a B preflight digest or readiness failure. Assert A remains selected and no service/vendor action occurs.
4. Simulate an atomic local release switch to B, then inject post-switch health failure. Assert rollback selects only the exact compatible A and records tested/deployed simulation identities.
5. Reject rollback below the ledger-owned schema/rollback floor, during exposure/ambiguity/recovery, or with stale/missing backup evidence.
6. Create and verify one fixture backup, restore it only into the isolated root, and prove the source fixture bytes remain unchanged.
7. Inject corruption/missing evidence/model and assert restore rejection before any switch.
8. Restart the local fixture against the isolated set and reconcile cursor, schema, ledger and model revisions before readiness.

## Required pass evidence

- current release survives failed preflight;
- prior release and production-like fixture data are never overwritten in place;
- restore target is demonstrably isolated;
- schema/config/model identities and checksums match;
- result and reconciliation receipts are distinct;
- actual production restore remains `BLOCKED` until its donor amendment and a separate owner authorization exist;
- capital/notional/external effects remain exactly zero.
