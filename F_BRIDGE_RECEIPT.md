# F-BRIDGE canonical Foundation execution bridge receipt

## Verdict

- Status: **F-BRIDGE_ACCEPTED**
- `ACCEPTED_SHA`: `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`
- Accepted tree: `34497d5f984fde9c77a408c2ac7dcc6b85869932`
- Canonical worktree base: `24ac894d4389b30f26810b47e80ee0016f9bca8e`
- Accepted SHA parent: `37c9dce8e8a519dc3d0c94a93b77e27d6da2bf2f`
- Branch: `f-bridge-execution-20260713`
- Canonical implementation commit: `735b4a609da124be14ec7484c5bb5ac909b12ee7`
- Initial blocked-receipt commit: `37c9dce8e8a519dc3d0c94a93b77e27d6da2bf2f`
- D-LAUNCH-11 fixture-acceptance commit: `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`
- Implementation changed-path manifest SHA-256: `cc6b629058fac79b8eacf1e51894cc0da9f586d1c766fee7aa55fb0090139928`
- Implementation binary-patch SHA-256: `2cca54ff4bbe11d3ad871c20a362970e60b6721a00447e79b638730fe69060ff`
- Fixture changed-path manifest SHA-256: `4db8a09b1b0eb4e21210ec474c39f26870f32ed55deb3eb2a79da294e9ce0bca`
- Fixture binary-patch SHA-256: `8a13dde110c4f439195e2a52fdab442f503f7faed61a5ba8e54f087abe218c36`
- Push/merge: **NOT PERFORMED**

The two requested canonical gaps are implemented, the D-LAUNCH-11 fixture corrections reject the pre-fix coordinator, all 24 Foundation test files are green, and `npm test` is green. The accepted SHA contains the implementation, focused failure-mode tests, and the two precisely authorized cross-family fixture corrections.

## Authority and sealed inputs

The required live authority command was run before implementation:

- `git -C /Users/cosmosgeek/Desktop/Main log -1 --format=%H -- QL_DIRECTOR_STATE.md`
- Initial result: `32c6d48ac86ec18dd05bc8a32142eca68be9e0bd`
- Subject: `director: D-LAUNCH-9 — canonical execution bridge worktree + block 17`

It was run again immediately before sealing because Main is living director state:

- Seal-time result: `55e008f0bed8f0ce317828a1f13f8dc551ca37e2`
- Subject: `director: D-LAUNCH-10 — ownership exclusions, satellite discipline, board truth repair`
- D-LAUNCH-10 explicitly retains F-BRIDGE as WORKING and reiterates the full-Foundation-plus-`npm test` acceptance gate; it does not revoke this branch's ownership.

D-LAUNCH-11 was then verified live before the fixture changes:

- Result: `2b6ef003d7e86af8558e1db242c2db6fe906d26b`
- Subject: `director: D-LAUNCH-11 — F-BRIDGE fixture allowlist widening; A-HAZARD ready`
- Ruling: the prior BLOCKED verdict is accepted; the seven failures are stale fixtures asserting pre-fix defective behavior.
- Exact additional write allowlist: `server/test/foundation/integration/compatibility.mjs` and `server/test/foundation/reconciliation/reconciliation.mjs` only.
- Acceptance law: preserve or strengthen coverage, prove the edited fixtures red on the pre-fix coordinator, then obtain all 24 Foundation files green plus `npm test` green.

The L09 blocker worktree was inspected read-only:

- Worktree: `/Users/cosmosgeek/Desktop/l09-normal-basis`
- Branch: `l09-normal-basis-20260712`
- Sealed HEAD: `9069475ffd4d0fc3d4e3d8cc3bd9d4b8b739df08`
- Decision: `live-edge-receipts/DECISIONS/L09-003-INDEPENDENT-VERIFICATION-BLOCKERS.md`
  - Git blob: `f307085699d955551ba35e6eb9ca91ac2d5bbbd8`
  - SHA-256: `67f02bf7d6f8fbac1b4a88c465a24aa889dbd3e9d42991831d693e226d230e4a`
- Blocked receipt: `live-edge-receipts/RECEIPTS/L09_BLOCKED_INDEPENDENT_VERIFICATION.md`
  - Git blob: `0636dcd7afa33a8039213adb21e4912e6f413f1a`
  - SHA-256: `31c209c4fa57b7ff4945cbf1fa737768696f616d6379b55d4f0236b4e1f60222`

Both files are tracked by sealed L09 HEAD. No L09 or Main file was written.

## Exact implementation scope

Implementation commit `735b4a609da124be14ec7484c5bb5ac909b12ee7` changes exactly these five authorized paths:

1. `server/src/foundation/execution/coordinator.ts`
2. `server/src/foundation/execution/recovery.ts`
3. `server/src/foundation/execution/reducer.ts`
4. `server/src/foundation/execution/types.ts`
5. `server/test/foundation/execution/execution.mjs`

D-LAUNCH-11 fixture commit `1e9d28a565935d3cb1aa6c98a209697d9fabdf05` changes exactly the two newly authorized paths:

6. `server/test/foundation/integration/compatibility.mjs`
7. `server/test/foundation/reconciliation/reconciliation.mjs`

The root receipt is the explicit receipt-file exception required by the task. No other repository path was edited. The pre-existing untracked owner inputs `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` and `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` remain untouched and uncommitted.

`STATE.md` was not edited because it is outside the exclusive write allowlist; the director owns state integration after acceptance.

## Canonical gap 1 — terminalize a working opening leg before hedge sizing

Implemented behavior:

- A dependent opening hedge cannot be submitted from an `ACKNOWLEDGED`, `PARTIALLY_FILLED`, or `CANCEL_PENDING` predecessor observation.
- The coordinator performs injected read-only lookup before dependent hedge sizing.
- A still-working remainder records explicit cancellation/finalization intent and remains blocked; no cancellation or send capability was added.
- Later partial observations update cumulative fill without falsely terminalizing a cancel-pending leg.
- Only terminal `FILLED` or `CANCELLED` owner truth can authorize progression, and the hedge quantity must exactly match the normalized final predecessor fill.
- Concurrent progression shares one refresh; a concurrent lifecycle/reconciliation change is checked again after the awaited lookup and blocks a stale hedge.
- The reducer independently rejects early, stale-sized, or terminal-predecessor-mutating event streams, including forged checkpoint replay.

This closes the sealed drift cut: an opening leg cannot move from a stale partial after the dependent hedge has already been sized.

## Canonical gap 2 — cold-restart hydration and reconciliation

Implemented behavior:

- Restored coordinators with any submitted nonterminal leg enter a restart-recovery barrier.
- Restored `SUBMITTING` is converted to durable pre-ack ambiguity and looked up by deterministic client-order ID through the newly injected ports.
- All submitted working, ambiguous, and terminal legs are refreshed or verified from fresh owner lookup before aggregate reconciliation.
- Progression is permitted only after all per-leg owner recovery and aggregate reconciliation complete in order.
- `PROVEN_ABSENT` is explicit durable evidence for a pre-venue dispatch/crash cut: null venue order, zero fill, distinct ambiguity resolution, and no fabricated venue rejection or resubmission.
- Missing, divergent, malformed, null, structurally invalid, or throwing lookup outcomes fail closed into durable `RECOVERY_REQUIRED` evidence.
- Restart recovery and dependent progression are single-flight.
- Checkpoint serialization, replay validation, and byte-stable round-trip remain intact.

No pre-crash in-memory port observation is reused by the cold process.

## Preserved laws

- No new order-send, cancel-send, borrow, repay, transfer, withdrawal, leverage, or margin-mutation capability exists.
- No concrete transport, environment read, wall clock, timer, filesystem access, socket, fetch, or ambient randomness was added to the execution domain.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` and mode tripwires remain enforced.
- All behavior is driven by injected ports and injected clocks.
- Unknown facts remain explicit ambiguity/unavailability rather than fabricated zero or success.
- Reducer and checkpoint replay remain deterministic and fail closed.
- Tests are network-free.

## Research basis

Current official Binance documentation was reviewed before implementation and refreshed before the D-LAUNCH-11 fixture edits. It confirms the owner evidence needed by this seam: client-order-ID query, explicit order status, and cumulative filled quantity, including working, partial, terminal, cancelled, rejected, and expired states. It also states that an unknown execution result must be queried rather than treated as failure or success.

- Spot API docs repository: `https://github.com/binance/binance-spot-api-docs`
- Spot REST API: `https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api.md`
- Spot user-data execution reports: `https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md`
- Spot order-status enums: `https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/enums.md`
- USD-M Futures Query Order: `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#query-order`

No exchange endpoint or private/signed action was exercised.

## Red-to-green evidence

Failure-mode tests for both gaps were added first and run against the pre-fix compiled execution implementation:

- Red result: `132/153 execution checks passed`, exit `1`.
- The failures reproduced both sealed cuts: stale partial hedge sizing and cold restart progression without fresh owner hydration/reconciliation.

### D-LAUNCH-11 isolated pre-fix fixture proof

An isolated archive of pre-fix parent `24ac894d4389b30f26810b47e80ee0016f9bca8e` was built successfully. The exact two edited fixture files were copied into that archive without any current execution source. Both fixtures then failed as required.

Compatibility against pre-fix source: `127/131 compatibility checks passed`, exit `1`:

1. `8 lookup terminalization precedes the dependent hedge`
2. `8 still-working partial blocks the hedge and retains explicit risk-reducing recovery`
3. `8 terminal final fill sizes the exact dependent hedge`
4. `11 fresh restart orders owner lookup then reconciliation then dependent hedge`

Reconciliation against pre-fix source: `71/75 reconciliation checks passed`, exit `1`:

1. `working opening partial is refreshed through owner lookup before dependent progression`
2. `dependent hedge remains unsubmitted when working-partial owner truth is unresolved`
3. `acknowledged opening leg is refreshed through owner lookup before dependent progression`
4. `unresolved acknowledged-leg lookup blocks progression without a dependent submission`

This proves all four edited fixture cuts are anti-regressions: compatibility injection 8, compatibility injection 11, the reconciliation partial cut, and the reconciliation acknowledged cut each fail on the pre-fix coordinator.

### Final green evidence at the accepted SHA

- Server TypeScript build: exit `0`.
- Focused execution suite: `173/173 execution checks passed`, exit `0`.
- Execution import-purity suite: `30/30 execution import-purity checks passed`, exit `0`.
- Compatibility suite: `131/131 compatibility checks passed`, exit `0`.
- Reconciliation suite: `75/75 reconciliation checks passed`, exit `0`.
- Full Foundation battery: `npm run test:foundation`, all `24/24` sorted test files reached and passed, exit `0`.
- `npm test`: exit `0`.
  - Server and web typecheck/build passed.
  - Deterministic engine and focused server gates passed.
  - Existing Vite large-chunk warning remains non-fatal and unrelated.
- `git diff --check`: exit `0` before the fixture commit.

## Superseded blocked-gate evidence

Before D-LAUNCH-11 widened the allowlist, `npm run test:foundation` correctly exited `1`.

- The execution owner suite passed `173/173`.
- Execution import purity passed `30/30`.
- The runner then stopped at `server/test/foundation/integration/compatibility.mjs` with `126/130 compatibility checks passed`.
- Because the canonical runner is fail-fast, that result was not a complete green battery. No false-green claim was made.

The four failing compatibility assertions are:

1. Line 405: `8 first-leg partial fill never claims fully hedged completion`
2. Line 406: `8 second leg is scaled to evidence-backed first fill`
3. Line 407: `8 partial remainder has explicit risk-reducing recovery`
4. Line 475: `11 restart resumes at leg two without replaying leg one`

The section 8 fixture supplies a still-working `PARTIALLY_FILLED` Spot response and expects an immediate 0.4 Perp hedge without any owner lookup/finalization. The section 11 fixture restores with the same pre-crash fake ports and supplies neither fresh client-order lookup evidence nor aggregate reconciliation. Those are the exact unsafe assumptions this canonical fix is required to remove.

`server/test/foundation/integration/compatibility.mjs` was outside the original exclusive write allowlist. Making production code satisfy those stale assertions would have restored one or both sealed defects. The safe implementation therefore remained committed under blocked receipt `37c9dce8e8a519dc3d0c94a93b77e27d6da2bf2f` until D-LAUNCH-11 authorized test-only correction.

An explicit continuation sweep then ran every Foundation test file despite failures:

- Files executed: `24/24`.
- Passing files: `22`.
- Failing files: `2`.
- Sole failures: `server/test/foundation/integration/compatibility.mjs` and `server/test/foundation/reconciliation/reconciliation.mjs`.

The reconciliation owner result is `68/71 reconciliation checks passed`, exit `1`. Its three failing assertions are:

1. `partial venue/checkpoint truth yields PARTIAL`
2. `partial working remainder recommends CANCEL_REMAINDER`
3. `ACKNOWLEDGED checkpoint versus CANCELED venue order diverges`

Those fixtures also create their checkpoint state by calling the high-level `open()` method with a working `PARTIALLY_FILLED` or `ACKNOWLEDGED` first leg and no lookup evidence. The corrected coordinator now immediately enters the required refresh/finalization seam instead of leaving the stale intermediate state those reconciliation assertions intended to inspect. The reconciliation tests must capture the intermediate leg after a single bounded leg submission, or supply the owner lookup transition explicitly; weakening `open()` would reintroduce gap 1.

An independent read-only blocker audit verified the safe fixture correction: `preflight() -> beginOpen() ->` exactly one `submitNextOpeningLeg()` produces the intended `PARTIAL` plus `CANCEL_REMAINDER` proof for the partial cut, and `DIVERGED` plus `ORDER_LIFECYCLE_DISAGREEMENT` when cancelled venue evidence is compared with the acknowledged cut. No production change is warranted for these three assertions.

`server/test/foundation/reconciliation/reconciliation.mjs` was also outside the original exclusive write allowlist. Thus all 24 files were executed at the blocked cut, but the full battery was not green until D-LAUNCH-11.

## D-LAUNCH-11 expectation-by-expectation justification

No production source changed in the D-LAUNCH-11 commit. Only stale fixture setup and its directly affected assertions changed.

### Compatibility injection 8 — sealed defect 1

1. **Old:** `first-leg partial fill never claims fully hedged completion` accepted a high-level `open()` result after a nonterminal 0.4 partial. **Accepted:** `lookup terminalization precedes the dependent hedge` requires owner lookup before Perp submission. This directly enforces the sealed ordering defect and fails pre-fix because no lookup occurs.
2. **Old:** `second leg is scaled to evidence-backed first fill` treated the working 0.4 partial as final sizing truth. **Accepted:** `terminal final fill sizes the exact dependent hedge` requires terminal `CANCELLED` truth at 0.7 and exact Perp 0.7. This rejects stale sizing and fails pre-fix, which immediately hedges 0.4.
3. **Old:** `partial remainder has explicit risk-reducing recovery` was evaluated after the unsafe immediate hedge. **Accepted:** `still-working partial blocks the hedge and retains explicit risk-reducing recovery` proves 0.6 then 0.65 remains `CANCEL_PENDING`, submits no Perp, and exposes only non-risk-increasing recovery. This is strictly stronger and fails pre-fix.

### Compatibility injection 11 — sealed defect 2

4. **Old:** `restart resumes at leg two without replaying leg one` restored with the pre-crash fake port object and required immediate progression. **Accepted:** the fixture uses a distinct cold port instance, fresh deterministic `FOUND/FILLED` first-leg truth, and `ONE_LEG_EXPOSED` aggregate reconciliation; it asserts `lookup -> reconcile -> Perp submit`. This fails pre-fix because the old coordinator has no restart barrier. The separate zero-Spot-resubmission assertion preserves the non-replay half of the old coverage.

### Reconciliation partial cut — sealed defect 1

5. **Existing expectation retained:** `partial venue/checkpoint truth yields PARTIAL`. The fixture now captures the intended intermediate state after `beginOpen()` and exactly one leg submission instead of accidentally invoking the dependent-progression seam. Adjacent new coverage requires owner lookup before progression and fails pre-fix.
6. **Existing expectation retained:** `partial working remainder recommends CANCEL_REMAINDER`. The same bounded intermediate snapshot preserves this data-only reconciliation law. Adjacent new coverage proves unresolved owner truth submits no hedge and fails pre-fix.

### Reconciliation acknowledged cut — sealed defect 1

7. **Existing expectation retained:** `ACKNOWLEDGED checkpoint versus CANCELED venue order diverges`. The fixture now captures the acknowledged intermediate state after exactly one submission. Adjacent new coverage requires lookup and blocks dependent submission on `LOOKUP_UNRESOLVED`; both new checks fail pre-fix.

Coverage was strengthened, not weakened:

- Compatibility increased from 130 checks at the blocked cut to 131 passing checks.
- Reconciliation increased from 71 checks at the blocked cut to 75 passing checks.
- All original 16 compatibility injections still execute.
- All original reconciliation status/recommendation assertions remain present.

## Adversarial review

Independent inspect-only review was performed over lifecycle progression, reducer/checkpoint semantics, restart ordering, hostile lookup outcomes, and capability boundaries.

Corrections made from review before the final commit included:

- post-await lifecycle revalidation for a reconciliation race;
- single-flight restart/progression and working-leg refresh;
- terminal evidence immutability and exact dependent quantity guards;
- status/cumulative-fill consistency checks;
- strict ambiguity-resolution event semantics;
- durable handling of null, malformed `PROVEN_ABSENT`, and malformed/oversized/whitespace failure evidence.

Final review verdict: no remaining P1 or P2 within either requested canonical gap or the authorized changed paths.

A separate gate-blocker audit classified all seven cross-family failures as stale test setup/assertions and found no P1/P2 production defect. It confirmed that changing execution source to satisfy them would reintroduce one or both sealed gaps.

The D-LAUNCH-11 fixture edits received independent read-only adversarial review:

- Compatibility review: no P1/P2/P3; confirmed terminal lookup ordering, working-partial no-hedge behavior, exact terminal sizing, fresh cold ports, reconciliation ordering, and zero first-leg resubmission.
- Reconciliation review: no P1/P2/P3; confirmed bounded intermediate snapshots, preserved reconciliation expectations, lookup-before-progression, no dependent submission on unresolved truth, and pre-fix sensitivity.
- Final scope review: exactly the two D-LAUNCH-11 test files changed; no assertion family, injection, safety boundary, or no-send check was removed.

Two broader advisory observations were intentionally not changed because the directive authorizes exactly two gaps: a possible close/reconciliation interleaving and acceptance of stale validation events after a terminal aggregate. They remain separate director-owned scope decisions and do not alter the D-LAUNCH-11 acceptance result.

## Acceptance

Every D-LAUNCH-11 acceptance condition is satisfied:

1. Exactly the two widened fixture files changed.
2. Every stale expectation is justified against sealed defect 1 or 2.
3. Coverage increased and no existing safety assertion was removed.
4. Both edited fixture files fail against the isolated pre-fix coordinator.
5. All 24 Foundation test files pass.
6. `npm test` passes.
7. Independent fixture reviews report no P1/P2/P3.

`ACCEPTED_SHA` is `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`. The receipt update is committed separately after this accepted code/test SHA and does not alter that accepted tree. No merge or push was performed. The two pre-existing untracked owner directives remain untouched.

**F-BRIDGE ACCEPTED.**
