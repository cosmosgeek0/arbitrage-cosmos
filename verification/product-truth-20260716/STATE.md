# Product Truth Campaign State

Campaign status: `DEFECT_WAVE_3_C4_SOURCE_FROZEN_PENDING_EXACT_EVIDENCE`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

C4 source candidate: `ASSIGNED_BY_CONTAINING_SOURCE_COMMIT` — the exact SHA is recorded by the later evidence child because a commit cannot contain its own SHA.

Evidence HEAD: `PENDING_EXACT_C4_LOCAL_GATE_EVIDENCE_CHILD`

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `NOT_RUN_FOR_EXACT_C4`

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2 and C3 remain immutable and rejected. The containing source commit becomes C4; no evidence child may be called a replacement C4 or amend C4 source.

## Candidate transition

- The final-verifier receipt on fetched `current-main` rejects C3 for six governing findings: `VFINAL-PROV-001`, `VFINAL-COCKPIT-001`, `VFINAL-AUTH-001`, `VFINAL-DIR-001`, `VFINAL-DIR-002`, and `VFINAL-DIR-003`.
- C3 is excluded from C4 ancestry. C4 must have exactly one direct parent, and that parent must byte-equal immutable C2 `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`.
- The accepted Defect Wave 2 census and donor-equality corrections are reapplied directly onto C2. C2 evidence commit `4ec9e8640a22661f7e1649204348a212d94163e1`, C3, and every C3 evidence descendant remain outside C4 ancestry.
- Source base Main remains `2ae812624f20b9bc93fc4ad66cb568929101110f`. Later director records are controlling evidence inputs, not candidate ancestry. Account A does not modify or push `current-main`.
- C2 and C3 custody do not transfer. If exact-C4 local gates pass, Account A stops at `C4_CUSTODY_REQUIRED:<full-C4-SHA>` for director custody.

## Defect Wave 3 source adjudication

- `VFINAL-COCKPIT-001`: server projection, browser contract, surface renderer, CSS, and hostile tests now enforce relational readiness. Any required datum that is null or has blocking truth forces `BLOCKED_BACKEND`, a blocking truth label, a named blocker, and non-green visible output.
- `VFINAL-AUTH-001`: the canonical server Product supervisor now owns component presentation, market-feed readiness, strategy runtime presentation, and Watchman overall posture. The browser derivation module is retired; browser consumers render the supplied canonical fields or fail closed on unproven continuity.
- Product focused proof passes pre-freeze at server `111/111` and browser `101/101`. The rendered browser ship gate shows all 18 surface rows blocked with zero false-green rows in light and dark presentation, completes the Calendar-to-Dashboard sweep, and records no browser errors.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No private, signed, order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, or credential path is added or exercised.

## Exact-C4 evidence requirements

- `VFINAL-PROV-001`: assert exact direct-parent equality and exactly one parent; merge-base ancestry alone is not a pass.
- `VFINAL-DIR-001`: regenerate `INPUTS.lock` from exact candidate-backed C4 bytes so every candidate-backed row, including `STATE.md`, byte-matches C4.
- `VFINAL-DIR-002`: map all 61 locked inputs—including defect-wave, superseded-available, and superseded-absent inputs—to one explicit locked source and disposition in the coverage matrix.
- `VFINAL-DIR-003`: bind every coverage-matrix `candidate_sha` cell to exact C4 and remove every `C2_NOT_YET_FROZEN` placeholder.
- Evidence changes are confined to campaign evidence-owner paths. The exact-C4 descendant records focused gates, the canonical gate, literal local no-hardlink single-branch preflight, manifest integrity, and post-C4 diff containment without changing C4 source.

## Exact boundaries

- Exact-C4 canonical and local single-branch gates: `NOT_RUN` in this source commit; the evidence descendant owns the results.
- C4 off-machine custody: `PENDING`; C2 and C3 custody are historical only.
- Independent final verification: `BLOCKED` until exact-C4 custody exists.
- Product Assurance real soak and incident corpus: `NOT_RUN` / `UNKNOWN_EMPTY`.
- Deployment, external sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private/signed/test-order/capital paths: `DEFERRED_OWNER_GATE`; no authority granted.

## Exact next action

Freeze this containing source commit as exact C4, prove its sole direct parent is immutable C2, create a separate evidence-only child, regenerate exact-C4 lock and 61/61 coverage, run focused plus canonical plus literal local single-branch gates, and stop at `C4_CUSTODY_REQUIRED:<full-C4-SHA>` if and only if every local gate is green.
