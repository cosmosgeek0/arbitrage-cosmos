# SI-RECON receipt — D-LAUNCH-15 reconciliation ruling

## Verdict

- Status: **SI-RECON_ACCEPTED**
- Ruling: **A — `DIVERGED` is the correct truth for the exact System Integration payload.**
- Branch: `si-recon-ruling-20260714`
- Verified `current-main` base: `e25fd5d973d99cbaff18dfd86f3fd8cdcce6370a`
- Verified director-state identity: `e25fd5d973d99cbaff18dfd86f3fd8cdcce6370a`
- Implementation commit: `33c708a332f78ff3d79c28c0e796040b6277a64f`
- Implementation tree: `ab597c73a76e55acdab2f4aec8d7f29dd01985ad`
- Implementation parent: `e25fd5d973d99cbaff18dfd86f3fd8cdcce6370a`
- Merge: **NOT PERFORMED**
- Push: **NOT PERFORMED**

The implementation changes exactly one stale assertion in
`server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs`:
the expected reconciliation status is `DIVERGED`, not `PARTIAL`. No execution
or reconciliation production source changed. This receipt is the required
root-file exception to the exclusive source/test write scope.

## Required context and authority

The required live authority command was run before investigation:

```text
git -C /Users/cosmosgeek/Desktop/Main log -1 --format=%H -- QL_DIRECTOR_STATE.md
e25fd5d973d99cbaff18dfd86f3fd8cdcce6370a
```

The assigned branch was fast-forwarded to that exact `current-main` identity
before reproduction. The pre-existing untracked owner input
`I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md` remained untouched and
unstaged.

L09-007 was read from the sealed L09 worktree. It proves that the `179/180`
failure is reproducible outside L09, that L09 changed no System Integration
path, and that the shared owner required this separate ruling. No L09 or other
worktree was written.

## Current primary-source check

Current Binance primary documentation was checked on 2026-07-14 before the
edit:

- [Spot User Data Streams](https://developers.binance.com/en/docs/products/spot/user-data-stream)
  keeps original order quantity, cumulative filled quantity, current order
  status, execution type, and working-book state as separate facts. A trade
  update may represent part or all of an order fill.
- [Official Spot API source documentation](https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md)
  identifies `q` as original quantity, `z` as cumulative filled quantity, and
  `X` as current order status.
- [Spot REST reliability guidance](https://developers.binance.com/en/docs/products/spot/rest-api)
  treats an uncertain execution response as unknown and requires an order
  status query rather than assuming failure.

Those contracts support the F-BRIDGE law: a `0.4/1.0` working order can still
add exposure, so its final cumulative quantity must be refreshed and
terminalized before the dependent hedge is sized.

## Root cause attribution

The reconciliation engine is unchanged by F-BRIDGE:

- last engine change:
  `c7a851b6f591d6cbe14af8d7e8170a312ff2ffa1`;
- engine blob at pre-F-BRIDGE parent and current implementation:
  `56750199f06549df340a8585d222e671b9df8f3c`.

The failing SI file was also unchanged across the F-BRIDGE transition:

- SI blob at pre-F-BRIDGE parent `24ac894d4389b30f26810b47e80ee0016f9bca8e`:
  `5c3d23db891ba64f286988b3022cca09a835a14c`;
- SI blob at D-LAUNCH-15 base `e25fd5d973d99cbaff18dfd86f3fd8cdcce6370a`:
  `5c3d23db891ba64f286988b3022cca09a835a14c`.

The relevant execution identities are:

- pre-F-BRIDGE parent:
  `24ac894d4389b30f26810b47e80ee0016f9bca8e`;
- F-BRIDGE implementation:
  `735b4a609da124be14ec7484c5bb5ac909b12ee7`;
- F-BRIDGE accepted cut:
  `1e9d28a565935d3cb1aa6c98a209697d9fabdf05`;
- director merge:
  `c9009079b0c27c2a7e2d1a0111a022bceb2e61db`.

Current execution blobs exactly match the accepted F-BRIDGE cut:

| Owner file | Blob |
| --- | --- |
| `coordinator.ts` | `4136210ac77730c2a1df695fae1590f0146c0d3d` |
| `reducer.ts` | `c620fa0b3dd415e2a500734bb0ca440d0779511e` |
| `types.ts` | `cdb837181c3f1709fb8160202dac2a31710b4973` |

The direct state-changing owner is the F-BRIDGE coordinator:

1. `open()` submits the first Spot leg and receives a working partial at `0.4`.
2. Before considering Perp, current `coordinator.ts` refreshes any
   `ACKNOWLEDGED`, `PARTIALLY_FILLED`, or `CANCEL_PENDING` opening predecessor.
3. The SI fake lookup returns `UNRESOLVED`.
4. The coordinator emits `LEG_RESPONSE_AMBIGUOUS` and
   `LEG_AMBIGUITY_UNRESOLVED`.
5. The reducer preserves the known `0.4` fill, changes the Spot lifecycle to
   `AMBIGUOUS`, and changes the plan lifecycle to `RECOVERY_REQUIRED`.
6. Perp remains `VALIDATED`, submitted `0`, filled `0`; no Perp port call occurs.

The F-BRIDGE reducer's terminal-predecessor and exact-final-quantity checks are
defence in depth for forged/replayed event streams. The F-BRIDGE type additions
support restart evidence. Neither is the immediate trigger in this trace; the
new coordinator refresh call is.

## Why the exact result is `DIVERGED`

The state immediately before reconciliation was measured as:

| Fact | Value |
| --- | --- |
| Plan lifecycle | `RECOVERY_REQUIRED` |
| Opening Spot | `AMBIGUOUS`, submitted `1`, filled `0.4`, venue order present |
| Opening Perp | `VALIDATED`, submitted `0`, filled `0` |
| Spot position | expected `+0.4`, observed `+0.4`, `EXACT` |
| Perp position | expected `0`, observed `0`, `EXACT` |

`syntheticEvidenceForState()` maps any leg that is neither `FILLED` nor
`PARTIALLY_FILLED` to observed order status `NEW`, while retaining the leg's
cumulative fill. For this post-F-BRIDGE state it therefore supplies:

```text
observed order status = NEW
cumulative filled quantity = 0.4
```

That is internally contradictory complete order evidence. The unchanged
reconciliation owner correctly returns:

- status: `DIVERGED`;
- sole reason: `ORDER_STATUS_QUANTITY_DISAGREEMENT`;
- recommendation: `MANUAL_REVIEW`;
- execution authority: `NONE`.

This is not an `ORDER_POSITION_DISAGREEMENT`; both position comparisons are
exact. It is an order-status-versus-filled-exposure contradiction exposed only
after F-BRIDGE stopped the unsafe dependent progression.

A truthful bounded intermediate partial still reconciles as `PARTIAL` with
`CANCEL_REMAINDER`. That law remains explicitly covered in
`server/test/foundation/reconciliation/reconciliation.mjs`, which captures the
snapshot after exactly one bounded leg submission before invoking dependent
progression. No reconciliation classification was broadened.

## Proof that the old expectation masked the F-BRIDGE defect

An archive of the exact pre-F-BRIDGE parent was built and tested under `/tmp`;
no Git worktree was created and no repository file was changed. The unchanged
SI test blob passed its old `PARTIAL` expectation:

```text
commit: 24ac894d4389b30f26810b47e80ee0016f9bca8e
authority.scenarios.test.mjs: 29/29 passed
exit: 0
```

The measured pre-F-BRIDGE trace was:

```text
submit OPEN:SPOT quantity 1
submit OPEN:PERP quantity 0.4
Spot: PARTIALLY_FILLED, submitted 1, filled 0.4
Perp: FILLED, submitted 0.4, filled 0.4
reconciliation: PARTIAL / CANCEL_REMAINDER
```

The pre-F coordinator used the nonterminal `0.4` observation immediately to
size Perp. The Spot remainder was still working and could later fill from
`0.4` to `0.6`, `0.7`, or `1.0` after Perp had already been frozen at `0.4`.
The old `PARTIAL` assertion therefore passed while failing to distinguish a
safe one-leg intermediate snapshot from an unsafe progressed hedge sized from
nonterminal truth.

Current Foundation execution coverage proves the exact repaired cut:

- a partial changing from `0.4` to `0.6` is refreshed before hedge sizing;
- a still-working remainder submits no dependent hedge;
- cancellation/fill races retain newer cumulative truth;
- only terminal `FILLED` or `CANCELLED` truth can size the hedge;
- the reducer rejects stale pre-finalization hedge quantities.

This is the exact defect F-BRIDGE was commissioned to fix. Restoring the old SI
expectation by weakening execution or reconciliation would reintroduce or hide
that defect.

## Coverage disposition

Only the stale expected value changed. Coverage was not deleted, skipped, or
weakened:

- the test still proves `executionAuthority === NONE`;
- the test still proves the recommendation is not `NO_ACTION`;
- the adjacent ambiguity case still requires `AMBIGUOUS`, `MANUAL_REVIEW`, and
  `NONE` authority;
- Foundation reconciliation still proves a normal bounded partial is
  `PARTIAL / CANCEL_REMAINDER`;
- Foundation execution still proves no dependent hedge can use a working
  partial.

`DIVERGED` is the stricter correct classification for the payload actually
passed by this high-level helper after F-BRIDGE.

## Measured verification

| Gate | Result |
| --- | --- |
| Original D-LAUNCH-15 reproduction | `28/29`, expected `PARTIAL`, actual `DIVERGED`, exit `1` |
| Pre-F-BRIDGE unchanged SI file | `29/29`, old `PARTIAL` expectation passes, exit `0` |
| Post-ruling authority scenario file | `29/29`, exit `0` |
| Full System Integration | `180/180`, exit `0` |
| Full Foundation battery | all `24/24` sorted files passed, exit `0` |
| Foundation execution | `173/173`, exit `0` |
| Foundation compatibility | `131/131`, exit `0` |
| Foundation reconciliation | `75/75`, exit `0` |
| Foundation risk | `884/884`, exit `0` |
| `npm test` | typecheck/build green; deterministic `377/377`, exit `0` |
| Full repository `npm run test:all` | exit `0` |
| Full-repository lane evidence | deterministic `377`, app gates `72`, intelligence `152`, intelligence runtime `394`, capital `433`, Foundation `24/24` files, System Integration `180` |
| `git diff --check` | pass |

The existing Vite chunk-size warning is non-fatal and unrelated. No historical
whole-repository aggregate was reused; the receipt records the current live
lane counts and real exit codes.

## Safety and scope

- No live, test, signed, private, borrow, repay, transfer, withdrawal,
  leverage, margin, or order action was added or invoked.
- `LIVE_EXECUTION_NOT_IMPLEMENTED` remains unchanged.
- No secret, environment access, networked test, timer, random source, or
  second owner was added.
- No production execution, reconciliation, integration, UI, package, state,
  or architecture file changed.
- No other worktree was created or written.
- No merge or push was performed.

**SI-RECON ACCEPTED.**
