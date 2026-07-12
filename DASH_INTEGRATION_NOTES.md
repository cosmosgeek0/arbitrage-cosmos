# DASH_INTEGRATION_NOTES.md — wiring the systemDashboard library (dashboard-shell satellite)

Satellite: `dashboard-shell-20260712` under D-LAUNCH-5. Everything below
`web/src/features/systemDashboard/` is FIXTURES-ONLY and UNWIRED: no route,
no store import, no fetch. The production bundle was verified to contain zero
bytes of this feature. The director wires it at integration as follows.

## 1. What exists

```
web/src/features/systemDashboard/
  SystemDashboard.tsx        composed owner-contract surface (items 1–10), pure over props
  components/                PostureStrip (+ExposureBanner), MachineGraph, SourceHealthPanel,
                             EnginesPanel, BrainPanel, CapitalPanel, RiskExecutionPanel,
                             AttentionQueuePanel, TraceDrilldown, ControlsPanel, bits (atoms)
  lib/presentation.ts        the single honest-labels authority (tones, truth badges,
                             UNKNOWN rendering, attention ranking, stage mapping,
                             control-consequence copy)
  fixtures/                  9 named states + supervisor-unreachable + builders + fixture mutator
  styles/systemDashboard.css sdx- namespace, cloned from the locked healthx- anatomy
  preview/                   unwired harness (index.html + main.tsx + harness.css)
  RECEIPT.md                 build receipt and verification evidence
```

## 2. Route/nav wiring (director-owned; not done by this satellite)

1. **Mount point.** `SystemDashboard` is designed to replace/extend the body of
   the existing Dashboard page (per DASHBOARD_TRUTH hard law: extend existing
   pages, no redesign). Wire inside `web/src/pages/Dashboard.tsx` (or the page
   the director chooses) as:

   ```tsx
   import { SystemDashboard } from '../features/systemDashboard/SystemDashboard';
   import { useSystemIntegration, mutateSystemControl } from '../lib/systemIntegration';

   const { snapshot, error } = useSystemIntegration();
   const [receipt, setReceipt] = useState<SystemControlReceipt | null>(null);
   const [busy, setBusy] = useState(false);
   const mutate = async (mutation: SystemControlMutation, reason: string) => {
     if (!snapshot) return;
     setBusy(true);
     try { setReceipt(await mutateSystemControl(snapshot.control.revision, reason, mutation)); }
     finally { setBusy(false); }
   };
   <SystemDashboard snapshot={snapshot} nowMs={Date.now()} mutate={mutate}
     lastReceipt={receipt} busy={busy} unavailableReason={error} />
   ```

   `nowMs` should be a ticking value (e.g. 1s interval state) so ages advance;
   the library never calls `Date.now()` itself so views stay deterministic.

2. **No new route or sidebar item is required** if mounted on the existing
   Dashboard tab. If the director instead mounts a dedicated page, follow the
   News/Calendar one-frame geometry rules in DESIGN.md §0.3 — `.sdx-page`
   already provides `container-type: inline-size` and the frame; it expects to
   sit inside the standard route padding (5px shell + 6px route).

3. **CSS**: `SystemDashboard.tsx` imports `styles/systemDashboard.css` itself.
   The `sdx-` namespace collides with nothing in `styles.css` (checked). No
   global styles are modified.

4. **Delete or keep the preview harness** (`preview/`): it is excluded from
   the production build automatically (only `web/index.html` is a Rollup
   input). Safe to keep for future fixture review; it imports the global
   stylesheet read-only.

5. **Relationship to `components/SystemIntegrationSurface.tsx`**: the existing
   compact convergence strips on Dashboard/Health/Opportunities/Risk/Logs are
   untouched. At integration the Dashboard-page instance of that surface can
   be removed in favor of `SystemDashboard` (director's call; both consume the
   same snapshot client).

## 3. Fixture mode vs live mode

- Components are pure: data via `snapshot`, actions via `mutate`. In the
  harness, `fixtures/mutator.ts` applies mutations in memory and returns
  `code: 'FIXTURE_APPLIED', ledgerEventId: null`; the receipt strip then shows
  "NOT LEDGERED — FIXTURE MODE". With the real `mutateSystemControl`, the
  receipt's `ledgerEventId` renders as `ledger evt N` automatically.
- Revision fencing: the mutator (like the real API) rejects when
  `expectedRevision !== control.revision`.

## 4. Snapshot schema v1 gaps the UI states honestly (candidates for supervisor work)

The owner contract asks for facts the current `SystemSupervisorSnapshot` does
not carry. The UI renders each as an explicit `NOT IN SNAPSHOT V1` row or
`UNKNOWN`, never an invented value:

1. **Last restart timestamp** (item 1) — only `restartCount`/`generation`
   exist. Posture strip prints `Last Restart UNKNOWN`.
2. **Per-source sequence-gap / backoff counters** (item 3) — only aggregate
   `sourceCoverage.materialGapCount` exists; rendered as "All Sources".
3. **EdgeBrainHealth model/dataset versions and drift state** (item 5) —
   stated as planned post-integration schema.
4. **Advisory action enum (WATCH/FOCUS/…)** (item 5) — currently derivable
   only from free-form trace `kind` strings; rendered verbatim.
5. **Approval states with expiry** (item 6) — only reservation/mandate counts
   exist.
6. **Approval revoke + config revision bounds controls** (item 10) — the
   mutation union has four commands (safe mode, kill switch, intake pause,
   component restart); only those render. No decorative controls were added.
7. **Truth-label vocabulary**: contract names LIVE/SHADOW/VALIDATE_ONLY/…;
   schema v1 publishes LIVE_PUBLIC/DRY_RUN/SYNTHETIC_ONLY/RECORDED_REPLAY/
   UNAVAILABLE/UNKNOWN. Labels render schema-verbatim (UI formats, never
   infers). MISSING is rendered by the UI only for an expected component
   absent from `snapshot.components`.

## 5. Acceptance-test mapping (owner cold-open test → where the answer is)

- "Every component's state and why" → Machine Graph boxes (+ root-cause ring,
  blocked-via attribution, error line).
- "Newest candidate and why accepted/rejected" → Engines panels, decision rows
  with verbatim reason codes; `Trace` opens the full chain.
- "Is any capital exposed" → red exposure banner directly under the posture
  strip (renders only when nonzero) + Capital panel red stat.
- "What would the kill switch block" → Controls panel consequence line, stated
  before arming; hover previews each safe-mode segment.
- "Which sources are degraded" → Data Sources rows + posture strip first
  actionable blocker.
