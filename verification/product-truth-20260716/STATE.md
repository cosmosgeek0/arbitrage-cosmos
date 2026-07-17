# Product Truth Campaign State

Campaign status: `DEFECT_WAVE_4_C5_SOURCE_FROZEN_PENDING_EXACT_EVIDENCE`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

Immutable rejected C4: `4c9143a0bcc331aa170e9e26b741240b39df8b9e`

C4 rejection evidence child: `8265614af972a00fdbc85cb22a6b5d627687e80f` — historical evidence only and not C5 ancestry.

C5 source candidate: `ASSIGNED_BY_CONTAINING_SOURCE_COMMIT` — the exact SHA is recorded only after creation because a commit cannot contain its own SHA.

Evidence HEAD: `PENDING_EXACT_C5_LOCAL_GATE_EVIDENCE_CHILD`

Actor: `ACCOUNT_A_CANDIDATE_WRITER`

Gate: `NOT_RUN_FOR_EXACT_C5`

Custody: `WITHHELD_PENDING_EXACT_C5_LOCAL_GATES`

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2, C3, and C4 remain immutable and rejected. The containing source commit becomes C5; no evidence child may be called a replacement C5 or amend C5 source.

## Candidate transition

- Exact C4 focused gates passed, but canonical `npm test` and `npm run test:all` failed the same two report-parity tests. The acceptance contract stopped at `42/44` because C4 tracked `integration/reports/i00-proof-evidence.json` at SHA-256 `8c45974c2b27f1c92fb7bb53b2a50f3146233614015b218105374863dff7a9b7` while restricted tracked-only regeneration produced `8968726acf2edd47326da3c61b9ba983ac74d28c4d92fda5cb82018b5f3f71f8`.
- C5 must have exactly one direct parent, and that parent must byte-equal immutable C2 `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`. C3, C4, the C2 evidence commit, and every evidence descendant are excluded from C5 ancestry.
- C5 squashes the correction source required by all six VFINAL3 findings plus this tracked-only report regeneration into one correction commit directly on C2. Exact candidate bindings, gate reports, lock regeneration, and custody evidence remain a separate later child.
- Source base Main remains `2ae812624f20b9bc93fc4ad66cb568929101110f`. Later director records are controlling evidence inputs, not candidate ancestry. Account A does not modify or push `current-main`.
- C2, C3, and C4 custody do not transfer. If every exact-C5 local gate passes, Account A stops at `C5_CUSTODY_REQUIRED:<full-C5-SHA>` for owner custody.

## Defect Wave 4 source adjudication

- `VFINAL-PROV-001`: the exact direct-parent-equality law is preserved; merge-base ancestry is not accepted as a substitute.
- `VFINAL-COCKPIT-001`: server projection, browser contract, surface renderer, CSS, and hostile tests preserve relational readiness. Missing or blocking required truth forces `BLOCKED_BACKEND`, a named blocker, and non-green output.
- `VFINAL-AUTH-001`: the canonical server Product supervisor remains the sole owner of component presentation, market-feed readiness, strategy runtime presentation, and Watchman posture. Browser consumers render supplied canonical truth or fail closed.
- `VFINAL-DIR-001`, `VFINAL-DIR-002`, and `VFINAL-DIR-003`: the source-side census, donor/topology, and exact-candidate evidence generation corrections are preserved. Their exact-C5 lock, 61/61 source/disposition coverage, and matrix bindings are evidence-child outputs and are not embedded in C5.
- `integration/reports/i00-proof-evidence.json` now carries the tracked-only regenerated declaration locations and matching self-digest. Its sealed content is derived from candidate-tracked bytes, not richer ambient refs or unreachable objects.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No private, signed, order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, or credential path is added or exercised.

## Exact-C5 evidence requirements

- Assert exactly one C5 parent and exact direct-parent equality to immutable C2; C3 and C4 must not be ancestors.
- Regenerate `INPUTS.lock` from exact C5 blobs, map all 61 locked inputs to one explicit source/disposition, and bind every matrix `candidate_sha` cell to exact C5.
- Record focused gates, canonical `npm test`, canonical `npm run test:all`, and a literal local `--no-local --no-hardlinks --single-branch` preflight against exact C5.
- Confine evidence changes to a later campaign evidence child. Any later source correction is C6; C5 must never be amended.

## Exact boundaries

- Exact-C5 focused, canonical, and local single-branch gates: `NOT_RUN` in this source commit; they execute only after C5 is immutable.
- C5 off-machine custody: `PENDING`; prior candidate custody is historical only.
- Independent final verification: `BLOCKED` until exact-C5 custody exists.
- Product Assurance real soak and incident corpus: `NOT_RUN` / `UNKNOWN_EMPTY`.
- Deployment, external sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private, signed, test-order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, and capital paths: `DEFERRED_OWNER_GATE` or permanently unavailable under `LIVE_EXECUTION_NOT_IMPLEMENTED`.

## Exact next action

Freeze this containing source commit as exact C5, assert direct-parent equality to immutable C2, run the focused battery plus both canonical gates and the literal local no-hardlink single-branch preflight, and stop at `C5_CUSTODY_REQUIRED:<full-C5-SHA>` if and only if every local gate is green. The owner performs custody push; Account A does not push.
