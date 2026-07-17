# Product Truth Campaign State

Campaign status: `C5_LIVE_REMOTE_GATE_ATTEMPT_2_STAGED`

Immutable rejected C2: `dea2d2a5c2b5e83d3aea75b0e368f0a478596561`

Rejected C3: `78f708d6cdb9d1618c53d3f08f71097b4320a63b`

Immutable rejected C4: `4c9143a0bcc331aa170e9e26b741240b39df8b9e`

Immutable C5 source candidate: `959a5f9900e25f53414710bbfb3464c3ccb67a5d`

C5 source tree: `BOUND_BY_C5_LIVE_REMOTE_GATE_REPORT`

Custody bridge: `f2de0647b3a96dbf747c2a9c576eafeec9bfb9d6`

Attempt 1 evidence child: `9e4005535691bb1ddb8a51c3d95394e0920832bc`

Evidence HEAD: `ATTEMPT_2_RECORDER_CONTAINING_EVIDENCE_ONLY_CHILD` — the exact containing SHA is measured after the corrected recorder is committed.

Actor: `ACCOUNT_A_CANDIDATE_CUSTODIAN`

Gate: `ATTEMPT_2_NOT_RUN`

Custody: `C5_REACHABLE_ON_LIVE_CAMPAIGN_BRANCH; FULL_LIVE_REMOTE_BATTERY_NOT_RUN`

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

## Attempt 1 measured result

- Full report: `C5_LIVE_REMOTE_GATE_REPORT.json`; SHA-256 `32b5fcd13c53c04e5708b63459b3ce4cd026fad436968ccfb28348c3d5a30edf`; `78123` bytes; `58` recorded command executions.
- The authorized non-force push succeeded: live `origin/truth-campaign-20260716` advanced from historical C3 evidence tip `fd6a277057fb5b360bd297cfcbdffcaaa915ba64` to custody bridge `f2de0647b3a96dbf747c2a9c576eafeec9bfb9d6`, exactly matching the local campaign tip.
- `current-main` remained `3bf7bb25830df85dcbc978bfcecf16216a02d265` locally, in the cached origin ref, and on the live remote. No `current-main` mutation command was executed.
- The bundle was rebuilt as complete history with campaign head `f2de0647b3a96dbf747c2a9c576eafeec9bfb9d6`, current-main head `3bf7bb25830df85dcbc978bfcecf16216a02d265`, SHA-256 `8f6c0497c13fb890b30b25caebd1bdb8454984753632a47f4e3294585ede4fc0`, and byte length `63400622`.
- The bundle clone reached exact detached C5 and proved C3 is not a C5 ancestor. It then encountered `git merge-base --is-ancestor <C4> <C5>` exit `128` because the rejected C4 object is absent from the single-branch clone. The recorder expected only exit `1`, so it failed closed before any live-remote clone or npm command.
- The absence of the rejected C4 object is compatible with and stronger than the required non-ancestry boundary; the defect is in the evidence probe, not in C5 source. The failed report is preserved immutably before the recorder is corrected.

## Attempt 2 correction

- Attempt 1 is immutable in evidence commit `9e4005535691bb1ddb8a51c3d95394e0920832bc`; its report is not rewritten out of history.
- The corrected single-branch probe now requires `git cat-file -e 4c9143a0bcc331aa170e9e26b741240b39df8b9e^{commit}` to exit exactly `128`, proving rejected C4 is absent at the clone boundary. Local full-repository preflight separately retains the exact `merge-base --is-ancestor C4 C5` exit-`1` proof.
- The recorder now distinguishes immutable custody bridge `f2de0647b3a96dbf747c2a9c576eafeec9bfb9d6` from the later campaign evidence tip. It accepts only a campaign tip that contains the bridge, differs from C5 solely under the campaign directory, and is a normal fast-forward of the live remote ref.

## Exact boundaries

- Exact-C5 live-remote custody gate: `ATTEMPT_1_BLOCKED_BEFORE_NPM; ATTEMPT_2_PENDING`.
- C5 off-machine custody: `LIVE_CAMPAIGN_BRANCH_REACHABLE_AT_BRIDGE`; authoritative live-remote battery remains pending.
- Independent final verification: `BLOCKED` until Account A emits the exact baseline token, then reserved for a different fresh session.
- Deployment, external sentinel, paging, restore, rollback: `NOT_CONFIGURED`.
- Private, signed, test-order, borrow, repay, transfer, withdrawal, leverage, margin, deployment, credential, and capital paths: `DEFERRED_OWNER_GATE` or permanently unavailable under `LIVE_EXECUTION_NOT_IMPLEMENTED`.

## Exact next action

Commit the corrected recorder as a new evidence child without rewriting the custody bridge or Attempt 1, then rerun `node verification/product-truth-20260716/run-c5-live-remote-gate.mjs`. Emit `BASELINE_TRUTH_ACCEPTED:959a5f9900e25f53414710bbfb3464c3ccb67a5d` and stop only if every recorded gate is green.
