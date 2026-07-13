# F-BRIDGE canonical Foundation execution bridge receipt

## Verdict

- Status: **BLOCKED_OUT_OF_SCOPE_ACCEPTANCE_GATE**
- `ACCEPTED_SHA`: **NONE**
- Implementation commit: `735b4a609da124be14ec7484c5bb5ac909b12ee7`
- Implementation tree: `bb52f29ba872dd7d1b30834a359a9d528324484d`
- Parent/base: `24ac894d4389b30f26810b47e80ee0016f9bca8e`
- Branch: `f-bridge-execution-20260713`
- Implementation changed-path manifest SHA-256: `cc6b629058fac79b8eacf1e51894cc0da9f586d1c766fee7aa55fb0090139928`
- Implementation binary-patch SHA-256: `2cca54ff4bbe11d3ad871c20a362970e60b6721a00447e79b638730fe69060ff`
- Push/merge: **NOT PERFORMED**

The two requested canonical gaps are implemented and green in their owner suite. The branch is not accepted because the mandatory full Foundation battery exits nonzero in compatibility and reconciliation tests outside this worktree's exclusive write allowlist. This receipt does not relabel an implementation commit as an accepted SHA.

## Authority and sealed inputs

The required live authority command was run before implementation:

- `git -C /Users/cosmosgeek/Desktop/Main log -1 --format=%H -- QL_DIRECTOR_STATE.md`
- Initial result: `32c6d48ac86ec18dd05bc8a32142eca68be9e0bd`
- Subject: `director: D-LAUNCH-9 — canonical execution bridge worktree + block 17`

It was run again immediately before sealing because Main is living director state:

- Seal-time result: `55e008f0bed8f0ce317828a1f13f8dc551ca37e2`
- Subject: `director: D-LAUNCH-10 — ownership exclusions, satellite discipline, board truth repair`
- D-LAUNCH-10 explicitly retains F-BRIDGE as WORKING and reiterates the full-Foundation-plus-`npm test` acceptance gate; it does not revoke this branch's ownership.

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

Current official Binance documentation was reviewed before implementation. It confirms the owner evidence needed by this seam: client-order-ID query, explicit order status, and cumulative filled quantity, including working, partial, terminal, cancelled, rejected, and expired states.

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

Final implementation evidence:

- Server TypeScript build: exit `0`.
- Focused execution suite: `173/173 execution checks passed`, exit `0`.
- Execution import-purity suite: `30/30 execution import-purity checks passed`, exit `0`.
- `git diff --check`: exit `0` before commit.
- `npm test`: exit `0` against the final implementation.
  - Server and web typecheck/build passed.
  - Existing Vite large-chunk warning remains non-fatal and unrelated.

## Mandatory gate blockers

Final `npm run test:foundation` result: exit `1`.

- The execution owner suite passes `173/173`.
- Execution import purity passes `30/30`.
- The runner then stops at `server/test/foundation/integration/compatibility.mjs` with `126/130 compatibility checks passed`.
- Because the canonical runner is fail-fast, its result is not a complete green battery. No false-green claim is made.

The four failing compatibility assertions are:

1. Line 405: `8 first-leg partial fill never claims fully hedged completion`
2. Line 406: `8 second leg is scaled to evidence-backed first fill`
3. Line 407: `8 partial remainder has explicit risk-reducing recovery`
4. Line 475: `11 restart resumes at leg two without replaying leg one`

The section 8 fixture supplies a still-working `PARTIALLY_FILLED` Spot response and expects an immediate 0.4 Perp hedge without any owner lookup/finalization. The section 11 fixture restores with the same pre-crash fake ports and supplies neither fresh client-order lookup evidence nor aggregate reconciliation. Those are the exact unsafe assumptions this canonical fix is required to remove.

`server/test/foundation/integration/compatibility.mjs` is outside the exclusive write allowlist. Making production code satisfy those stale assertions would restore one or both sealed defects. The safe implementation therefore remains committed while acceptance remains blocked.

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

`server/test/foundation/reconciliation/reconciliation.mjs` is also outside the exclusive write allowlist. Thus all 24 files were executed, but the full battery is not green.

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

Two broader advisory observations were intentionally not changed because the directive authorizes exactly two gaps: a possible close/reconciliation interleaving and acceptance of stale validation events after a terminal aggregate. They require a separate director-owned scope decision and are not used to claim acceptance here.

## Resume conditions

The blockers can be removed only by the compatibility/reconciliation test owners or director, outside this branch's write scope:

1. Update compatibility injection 8 to stage exactly one partial first-leg submission, queue a fresh still-working lookup and assert `CANCEL_PENDING`/`CANCEL_REMAINDER` with no Perp submission, then queue terminal `CANCELLED` or `FILLED` owner evidence and assert that the exact final cumulative fill sizes the hedge after lookup.
2. Update compatibility injection 11 to restore with fresh ports, provide deterministic client-order lookup evidence plus aggregate reconciliation, and assert `lookup -> reconcile -> dependent hedge` with no Spot resubmission.
3. Update the two reconciliation state fixtures so they intentionally capture a bounded intermediate working-leg checkpoint, rather than calling high-level `open()` without the lookup evidence that method now requires for progression.
4. Rerun the complete `npm run test:foundation` battery and `npm test` against the resulting integration tree.
5. Only after both exit `0` may the director record a real accepted SHA in a new acceptance receipt. This immutable blocked receipt must not be rewritten.

Until then: **F-BRIDGE BLOCKED**.
