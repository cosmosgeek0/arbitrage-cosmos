# RECEIPT — dashboard-shell satellite (D-LAUNCH-5)

Branch `dashboard-shell-20260712`, base `0f2bb88`. Contract:
`docs/DASHBOARD_TRUTH.md` rendered per DESIGN.md Part I method + ship gate and
Part II baselines. Scope: fixtures-only component library under
`web/src/features/systemDashboard/**` + `DASH_INTEGRATION_NOTES.md`. No other
file touched; no push.

## Gates

- `npm run typecheck` (server + web): GREEN (re-run after every correction).
- `npm run build` (server + web): GREEN. Pre-existing >500kB chunk warning
  only; production bundle verified to contain ZERO bytes of this feature
  (`grep -c 'sdx-'` on dist css/js = 0) — the library is genuinely unwired.
- Preview harness (Vite dev, `/src/features/systemDashboard/preview/index.html`):
  renders with zero console errors (one React HMR createRoot warning found and
  fixed by caching the root; verified no new warning on forced HMR).

## Measured ship-gate evidence (browser, 1600×900, computed styles on the glyph owners)

- Title `22px/540/30px` −.014em InterVariable ✓ · caps labels `10.5/560`
  .055em ✓ · summary value `18/510/23` tabular ✓ · summary sub `11.5/420` ✓ ·
  row primary `12.5/510/16` ✓ · row secondary `10.5/420/14` ✓ · mono values
  `11.5/500` SF Mono tabular ✓ · truth badge mono `9.75/500` ✓ ·
  chip `11.5/470` ✓. Nothing above 560 on persistent data.
- Anatomy: toolbar 57px ✓ · summary band 102px ✓ · section bands 34px ✓ ·
  frame 1px var(--line-2) radius 12 ✓ · ONE left rail (frame x=12, every
  section/row content x=13) ✓ · frame stretches full width (stretch law) ✓.
- Both themes verified by screenshot + computed styles; dark hairlines
  visible; light restored and browser left on the completed surface.
- Container queries: 700px → summary 2-col, duo 1-col, NO horizontal
  overflow; 1600px → 5-col summary, duo 2-col. Reduced-motion rules present.
- NOTE for director integration: judged in the Browser pane at 1600×900 and
  700×900. The DESIGN.md §0.1 real-Chrome pass at the owner's window
  (2940px/1.25 zoom) must be repeated at I00 when the surface is wired to a
  real route — the harness URL works in real Chrome for that pass.

## DASHBOARD_TRUTH item-by-item (adversarial pass, corrections applied)

1. Posture strip: overall/mode/kill/intake/generations/first-actionable-
   blocker (root cause code + message, never the cascade). Last-restart is a
   stated schema gap (renders UNKNOWN). ✓
2. Machine graph: all 13 managed components as boxes — desired→observed,
   readiness + freshness/liveness age, restarts·gen, queue, current error,
   truth label, ROOT CAUSE ring, CAPITAL EXPOSED / NEEDS OPERATOR tags,
   blocked-via attribution; absent component ⇒ explicit MISSING box. ✓
3. Sources: per-source connection state, last message age, queue/drops,
   rate-limit blockers; coverage incl. quiet symbols retained; aggregate gap
   row labeled honestly (per-source gaps = stated schema gap). ✓
4. Engines: heartbeat/candidates/proposals/accepted/rejected + universe &
   focus counts in the band (correction #1); last decision age; decision rows
   with VERBATIM reason codes; Trace links. ✓
5. Q brain: state rows for both intelligence components, counts incl.
   abstained; advisory assessments from traces incl. ABSTAIN_UNKNOWN with
   INSUFFICIENT_EVIDENCE_WINDOW reason (correction #2); model/dataset/drift =
   stated NOT IN SNAPSHOT V1. ✓
6. Capital: allocatable/reserved/exposure amounts + counts, account truth
   state verbatim, checkpoint revision, blocker codes; nonzero exposure ⇒
   red banner directly under the posture strip (highest priority). Approval
   expiry = stated gap. ✓
7. Risk & execution: verdict + blocking codes verbatim, plan/leg lifecycle,
   recovery state, reconciliation status + BLOCKS NEW EXPOSURE, permanent
   LIVE_EXECUTION_NOT_IMPLEMENTED barrier strip. Plan and verdict rows link
   into the trace drill-down via reference-id lookup (correction #3). ✓
8. Attention queue: capital-exposed first then severity (verified order);
   reason codes verbatim; resolving control taken from supportedControls,
   otherwise honest NO MAPPED CONTROL. ✓
9. Trace drill-down: correlation groups expand to the full staged chain
   (Evidence→…→Ledger, 8 stages verified); reachable from engine, plan, and
   verdict rows. ✓
10. Controls: safe-mode 3-position seg (Execution-Control-law colors), kill
    switch with confirm (engaged = safe green achieved state), intake radio,
    restart console (custom selector, 13 targets, consequence stated before
    arming); every control shows its consequence and the fired receipt shows
    before/after + revision fence + honest NOT LEDGERED — FIXTURE MODE. ✓

Hard laws verified in-browser: UNKNOWN renders literally (warming fixture:
all engine stats UNKNOWN, not zero) · synthetic/replay/dry-run always badged
(synthetic fixture: 28 amber badges on a green-READY machine) · READY+STALE ⇒
amber (incl. the publisher-lied-FRESH trap, demoted by contract age) ·
READY+SILENT ⇒ red · freshness-null ⇒ AGE UNKNOWN idle · null snapshot ⇒
UNAVAILABLE frame, never optimistic.

## Fixtures (10)

healthy · warming · degraded · stale · silent (incl. omitted component) ·
blocked (root + cascade) · synthetic/dry-run · capital-exposed (+kill
engaged) · attention-required (4-severity ranking) · supervisor-unreachable
(13 MISSING boxes), plus harness-level "No Snapshot" null case. Fixture
mutator enforces revision fencing (FIXTURE_REVISION_CONFLICT) and honest
receipts.

## Known limits

- Real-Chrome owner-window pass deferred to integration (see above).
- Truth-label vocabulary is schema-verbatim; contract synonyms mapped only
  where lossless (see DASH_INTEGRATION_NOTES §4.7).
- `nowMs` is a prop; the integrator supplies a ticking clock.

Status: satellite scope COMPLETE — stopping clean at commit (no push).
