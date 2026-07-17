# Product Truth Campaign State

Campaign status: `C5_CUSTODY_BRIDGE_STAGED_PENDING_LIVE_REMOTE_GATE`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

Immutable rejected C4: `4c9143a0bcc331aa170e9e26b741240b39df8b9e`

Immutable C5 source candidate: `959a5f9900e25f53414710bbfb3464c3ccb67a5d`

C5 source tree: `BOUND_BY_C5_LIVE_REMOTE_GATE_REPORT`

Evidence HEAD: `C5_CUSTODY_BRIDGE_CONTAINING_EVIDENCE_ONLY_MERGE` — the exact bridge SHA is measured after this commit is created.

Actor: `ACCOUNT_A_CANDIDATE_CUSTODIAN`

Gate: `NOT_RUN_FOR_EXACT_C5_LIVE_REMOTE`

Custody: `AUTHORIZED_FOR_TRUTH_CAMPAIGN_BRANCH_ONLY_PENDING_MEASURED_GATE`

This file is the sole campaign-status authority. Root `STATE.md` owns product state. C2, C3, and C4 remain immutable and rejected. C5 is the immutable source candidate; neither this evidence bridge nor any later receipt is a replacement C5. Any source correction after C5 is C6 and must again be a single correction commit whose sole direct parent is immutable C2.

## Governing standing authorization

- Account A may push only `truth-campaign-20260716` to `origin` for candidate custody.
- The push must be a normal fast-forward. Force-push, branch deletion/recreation, merge to `current-main`, and every push to `current-main` remain forbidden.
- Account A may rebuild and verify the backup bundle, run the authoritative live-remote clean-clone gate, and seal campaign evidence without a director round-trip.
- The independent final verifier remains reserved for a different fresh session. Account A may emit only `BASELINE_TRUTH_ACCEPTED:<C5>` after every custody and live-remote gate is green.
- Final landing to `current-main` remains director-only.

## Immutable candidate topology

- C5 has exactly one parent, and it is byte-equal to immutable C2 `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`.
- Rejected C3, rejected C4, the C2 evidence commit, and every rejected-candidate evidence child are absent from C5 ancestry.
- The existing live campaign ref is historical C3 evidence tip `fd6a277057fb5b360bd297cfcbdffcaaa915ba64`. Because force-push is forbidden, custody advances it through one evidence-only merge whose first parent is exact C5 and whose second parent is that historical tip.
- The evidence merge preserves rejected history for audit while keeping the source candidate unchanged. Every tree difference from C5 is confined to `verification/product-truth-20260716/**`.

## C5 source adjudication

- The six VFINAL3 correction-source findings remain fixed: exact direct-parent law, canonical server-owned component/cockpit truth, fail-closed relational readiness, hostile browser-contract coverage, source-side census/topology corrections, and exact-candidate evidence-generation corrections.
- `integration/reports/i00-proof-evidence.json` carries the tracked-only regenerated declaration locations and matching self-digest. Its sealed bytes depend on candidate-tracked content rather than richer ambient refs or unreachable objects.
- C5 never self-names inside its source commit. Exact SHA, tree, parent, custody, bundle, and command evidence are later-child facts.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No private, signed, order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, or capital path is authorized or exercised.

## Authoritative custody and live-remote gate

The fail-closed recorder is `run-c5-live-remote-gate.mjs`. It must:

1. Prove exact C5 parent equality to C2 and prove C3/C4 are not C5 ancestors.
2. Prove the evidence bridge is a campaign-only fast-forward descendant of the old remote evidence tip.
3. Push only `refs/heads/truth-campaign-20260716` without force and prove live `origin` equals the local campaign tip while `current-main` is unchanged.
4. Rebuild `~/cosmos-arbitrage-C5-20260717.bundle`, verify its digest, complete-history status, exact heads, and an independent no-hardlink single-branch clone.
5. Clone the live SSH remote with `--no-hardlinks --single-branch --branch truth-campaign-20260716`, detach exact C5, and prove `current-main` is absent.
6. Run exactly `npm ci`, `npm test`, and `npm run test:all` in that order. Every command record must include argv, cwd, UTC start/end, actual and expected exit codes, byte counts, stdout/stderr/combined SHA-256, emitted test counts and bases, and skip evidence.
7. Leave the detached live clone clean at exact C5, prove the remote refs remained stable, and permit the baseline token only when the aggregate is fully green.

The measured output belongs in `C5_LIVE_REMOTE_GATE_REPORT.json` as a later campaign evidence child. The report is Account A custody evidence, not independent final verification.

## Exact boundaries

- Exact-C5 live-remote custody gate: `NOT_RUN`.
- C5 off-machine custody: `PENDING_AUTHORIZED_PUSH`.
- Independent final verification: `BLOCKED` until Account A emits the exact baseline token, then reserved for a different fresh session.
- Deployment, external sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private, signed, test-order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, and capital paths: `DEFERRED_OWNER_GATE` or permanently unavailable under `LIVE_EXECUTION_NOT_IMPLEMENTED`.

## Exact next action

Commit this campaign-only bridge with first parent C5 and second parent the historical live campaign tip, advance local `truth-campaign-20260716` to it, run `node verification/product-truth-20260716/run-c5-live-remote-gate.mjs`, and seal the measured report. Emit `BASELINE_TRUTH_ACCEPTED:959a5f9900e25f53414710bbfb3464c3ccb67a5d` and stop only if every recorded gate is green.
