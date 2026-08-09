# Owner / component health row with provenance — working notes

Element owner: one specialist, one element. Target surface: Watchdog observatory page
(`/Users/cosmosgeek/Desktop/Main/web`). Both themes. No new dependencies.

---

## 1. House tokens actually present (quoted, not invented)

`/Users/cosmosgeek/Desktop/Main/web/src/styles.css` is the token file (the brief said
`index.css`; it does not exist — the real file is `styles.css`, 49,735 lines).

```css
:root, [data-theme="light"] {
  --bg:#ffffff; --panel:#ffffff; --tile:#f5f6f8; --tile-hover:#eff1f4; --hover:#f7f8fa;
  --line:#eef0f3; --line-2:#e4e7ec; --line-strong:#d3d7df;
  --text:#0b0e14; --text-2:#2c313a; --muted:#697180; --muted-2:#858e9b; --faint:#9aa3b2;
  --accent:#2f6bff; --accent-soft:rgba(47,107,255,.13); --accent-line:rgba(47,107,255,.42);
  --up:#0a9b64; --down:#e0414b;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;
  --font:"InterVariable","Inter",…; --mono:"SF Mono","JetBrains Mono",ui-monospace,…;
}
[data-theme="dark"] {
  --bg:#0b0e11; --panel:#15181d; --tile:#1b1f26; --hover:#171b21;
  --line:#181c22; --line-2:#262d38; /* "razor-thin visible edge in dark (owner 2026-07-09)" */
  --text:#e8edf4; --text-2:#aeb7c4; --muted:#717b8a; --faint:#4d5664;
  --up:#2ebd85; --down:#f6465d;
  --depth: 0 0 0 0 rgba(0,0,0,0);   /* dark = flat, no glass, no shadow */
}
```
Body is `13.5px / 1.5`. There is a second font pair used by reference-grade surfaces:
`--ref-ui-font`, `--ref-mono-font`, and label/row/value ink `--ref-label/--ref-row/--ref-value`.

`pages/Health.css` — the closest neighbour my element must sit beside without drifting:

```css
.healthx-table-head, .healthx-source-row {
  display:grid; grid-template-columns:250px 205px 210px 280px 250px minmax(260px,1fr);
  align-items:center; min-width:1455px;
}
.healthx-source-row { min-height:70px; border-top:1px solid var(--line); background:var(--panel);
                      transition:background-color .15s ease; }
.healthx-source-row:hover { background:var(--hover); }
.healthx-source strong,.healthx-current strong { font-size:12.5px; font-weight:510; line-height:16px;
                      text-overflow:ellipsis; white-space:nowrap; }
.healthx-source small,.healthx-current small  { color:var(--muted); font-size:10.5px; font-weight:420;
                      line-height:14px; }
.healthx-current strong { font-family:var(--ref-mono-font,var(--mono)); font-size:11.5px;
                      font-weight:500; font-variant-numeric:tabular-nums; }
.healthx-live i { width:6px; height:6px; border-radius:50%; background:var(--muted); }
.healthx-state.degraded { color:#bd781b; } .healthx-state.degraded i { background:#d6a11d; }
.healthx-source-detail { background:color-mix(in srgb,var(--tile) 48%,var(--panel));
                      animation:healthxDetailIn 150ms ease-out; }
@keyframes healthxDetailIn { from{opacity:.62;transform:translateY(-2px)} to{opacity:1;transform:none} }
```
`pages/Dashboard.css` confirms the same frame language: `.dcx-frame { border:1px solid var(--line-2);
border-radius:12px; background:var(--panel) }`, toolbar `min-height:57px`, `h1 { font-size:22px;
font-weight:540; letter-spacing:-.015em }`.

**There is no named spacing scale in the house.** Values are scattered (6,7,8,10,12,13,14,16,17,18,22,24,48).
That is exactly the L4 violation the owner is complaining about. I introduce a local, explicit scale
whose steps are all multiples of 4 and which *reproduces* the house's real rhythm (8/12/16/24) instead
of inventing a new look. Two house constants are inherited verbatim and labelled as inherited: the
6px status dot and the 12px frame radius.

### The actual data (this is not hypothetical)
`src/lib/productIntegration/model.ts`:
```ts
export interface ProductComponentProjection {
  componentId; owner; desiredLifecycle; observedLifecycle; capability; truthLabel;
  freshnessState:'FRESH'|'STALE'|'CLOCK_SKEWED'|'UNAVAILABLE';
  blockerCode; rootCauseComponentId; capitalRelevance:'NONE'|'POTENTIAL'|'EXPOSED'|'RECOVERY';
  supportedControlIds; dependencyIds; correlationId; generation; restartCount; …
}
type ProductTruthLabel = LIVE_PUBLIC|WIRED|BUILT_AND_TESTED|IMPORTED|SYNTHETIC_ONLY|BLOCKED
                        |NOT_CONFIGURED|UNAVAILABLE|MISSING|UNKNOWN;
type ProductLifecycle  = STOPPED|START_REQUESTED|STARTING|WARMING|READY|DEGRADED|PAUSED|DRAINING
                        |RECONCILING|RECOVERY_REQUIRED|BLOCKED|FAILED|STOPPING;
type ProductCapability = LIVE_PUBLIC|LIVE_PRIVATE_READ|LIVE_SIGNED_VALIDATE|LIVE_MANUAL_CAPPED
                        |SHADOW|DRY_RUN|REPLAY|SYNTHETIC|NOT_CONFIGURED|UNAVAILABLE|UNKNOWN;
```

### The exact crime I am here to fix
`src/components/Header.tsx:2417` — the deleted Connection Watchman's metadata line:
```ts
detail: `${component.owner} · Lifecycle ${component.observedLifecycle} · Capability ${component.capability}`
      + ` · Truth ${component.truthLabel}${component.blockerCode ? ` · ${component.blockerCode}` : ''}`,
```
Six facts middot-joined into one gray string, ellipsised at the container edge, so on a 20-row table
the reader gets twenty different-length gray sentences that cannot be compared to each other. Every
fact is at a different x-position on every row. **That is the wall of gray text. The fix is not a
better string — it is to stop it being a string.**

---

## 2. References (11, with the specific mechanic taken)

1. **Rauno Freiberg — Web Interface Guidelines** https://interfaces.rauno.me/
   Taken, verbatim mechanics: `font-variant-numeric: tabular-nums` "particularly in tables or when
   layout shifts are undesirable"; "Focusable elements in a sequential list should be navigable with
   ↑ ↓"; "Box shadow should be used for focus rings, not outline which won't respect radius";
   "Hover states should not be visible on touch press, use `@media (hover: hover)`".
   → my row's focus ring is an inset box-shadow, ↑/↓ roving between rows, hover behind `hover:hover`.

2. **Grafana — No Data and Error states** https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/nodata-and-error-states/
   Taken: Grafana promotes **No Data** and **Error** to first-class states distinct from Alerting,
   and carries a machine-readable `grafana_state_reason` (`"No Data"`, `"Paused"`, `"MissingSeries"`)
   whenever the evaluated state differs from the displayed state.
   → my row has a mandatory reason slot; a row may never show a state without the reason that produced
   it, and "unknown" is never folded into "broken".

3. **Backstage — Well-known annotations / descriptor format**
   https://backstage.io/docs/features/software-catalog/well-known-annotations/ ,
   https://backstage.io/docs/features/software-catalog/descriptor-format/
   Taken: the required Component triad **type + lifecycle + owner**, and the
   `backstage.io/source-location` annotation — "a location reference string that points to the
   location whose registration lead to the creation of the entity".
   → provenance is modelled as *identity + source location* on the primary line, not as trivia in a
   tooltip. Source path is a first-class citizen of the name cell.

4. **Datadog — service ownership / Software Catalog**
   https://www.datadoghq.com/blog/service-ownership-best-practices-datadog/
   Taken: the side-panel discipline — the row surfaces *ownership + source repo + last-deployed +
   on-call*, and everything else lives in a panel. Metadata is tiered, not flattened.
   → my collapsed row carries exactly 6 facts; facts 7-14 live in the disclosure drawer.

5. **NN/g — Data Tables: Four Major User Tasks** https://www.nngroup.com/articles/data-tables/
   Taken: "The (default) first column should be a human-readable record identifier"; "The default
   order of the columns should reflect the importance of the data"; hover-triggered highlighting for
   place-keeping; and the explicit warning that zebra striping is counter-productive on tables that
   are already bordered/interactive.
   → column order is identity → posture → capability → warrant; hairline + hover, **no zebra**.

6. **GitHub Primer — Truncation accessibility pattern**
   https://primer.style/accessibility/patterns/truncation/
   Taken: the implicit/explicit distinction, and the hard rule that a `title` tooltip alone "is not
   available to keyboard-only and speech recognition users" — you must "offer a method such as a
   button or toggle to expand".
   → the middle-truncated source path and correlation id are recoverable *in full, selectable,
   untruncated* inside the keyboard-reachable drawer, not only on hover.

7. **GitHub Primer — Truncate component** https://primer.style/react/Truncate/
   Taken: the `expandable` affordance and "always add a `title` attribute to the truncated element".
   → `title` present as the mouse convenience layer on top of #6's real fix.

8. **Refactoring UI — hierarchy** https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886
   Taken: de-emphasise with **colour and weight, not size**; "stick to 2-3 colours — dark for primary,
   grey for secondary, lighter grey for tertiary" and two weights.
   → the row uses exactly three inks (`--text`, `--muted`, `--faint`) and two weights (510 / 430).
   Nothing in the row is de-emphasised by shrinking it below the house's 10.5px small.

9. **Vercel Geist — Badge** https://vercel.com/geist/badge
   Taken: the *semantic* colour map (green healthy / red error / amber warning / gray neutral) and
   crucially the `-subtle` suffix that "tones any of these colors down on dense surfaces".
   → I take the semantics and **reject the badge form**: on a dense operator table, five chips per row
   is the failure mode. I keep the semantic map and spend it on ink, not on fills.

10. **Atlassian — Lozenge** https://atlassian.design/components/lozenge
    Taken: "a prominent, compact label used to communicate a meaningful attribute that affects how
    people understand, **prioritize or act on** an object", the bold-vs-subtle split, and the note
    that `color.background.*.subtle` is "intentionally non-interactive only".
    → exactly one element in my row is allowed the "bold" treatment at a time, and it is chosen by
    action-priority. Everything else is subtle/ink.

11. **Emil Kowalski — animation standards**
    https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md
    Taken: "UI animations stay under 300ms"; dropdowns/disclosure 150–250ms; never `ease-in` on UI;
    animate `transform` and `opacity` only because they "skip layout/paint and run on the GPU";
    honour `prefers-reduced-motion` but keep opacity/colour transitions that aid comprehension.
    → drawer is 160ms, opacity+translateY only, `cubic-bezier(.2,0,0,1)`, motion killed under
    reduced-motion while the colour transition survives.

Also consulted for the state model: Sentry's issue schema (`shortId` + `culprit` + `metadata` —
https://docs.sentry.io/api/events/list-a-projects-issues/) which is the canonical
"human name on line 1, machine location on line 2" row; taken directly as the identity-cell shape.

---

## 3. Four variants — the variables actually moved

| | V1 Chip Rack | V2 Provenance Columns | V3 Claim / Warrant | V4 Spine + Slot Grid |
|---|---|---|---|---|
| hierarchy mechanism | chip fills + borders | column position | a vertical rule splitting the row 60/40 | ink weight + a 2px truth spine |
| disclosure | none | none | hover only | explicit drawer (button, `aria-expanded`) |
| alignment | left-flowing, wraps | strict grid, 8 columns | left block + right-aligned block | strict grid, 4 cells, 2 tiers each |
| state encoding | one coloured chip per fact | one dot + text | fill on the truth token | pattern + ink, one saturated element max |
| chrome | very high (5–6 borders/row) | zero | one hairline | one 2px spine |
| density | 64px, unstable | 34px single line | 48px | 56px, fixed |
| motion | none | none | none | 160ms drawer |

**V1 — Chip Rack.** Name on line 1; line 2 is a row of pills: `READY` `LIVE PUBLIC` `WIRED`
`foundation/control`. The obvious answer, therefore the suspect one.

**V2 — Provenance Columns.** Delete the metadata line entirely; every fact is promoted to a real
column with its label printed once in the head. One 34px line per row, all values mono, truth
right-aligned. Maximum honesty, maximum density.

**V3 — Claim / Warrant.** Split the row by epistemology, not by field. Left: what the system *claims*
(name, lifecycle, capability). Right, right-aligned against a rule: what *warrants* the claim (truth
class, evidence age, source path). Reading order becomes "claim… but on what authority".

**V4 — Spine + Slot Grid.** A 2px left spine carries truth class (the fact that governs whether any
other fact may be believed). Four grid cells; each cell is two tiers — ink value over muted qualifier
— with the labels printed once in the sticky head. A chevron discloses the remaining eight facts.

---

## 4. The fight

**V1 loses, hard.** It is precisely "making boxes, filling up those things with random shit". Five
pills means five borders, five radii, five fills competing inside one 56px band → hierarchy comes
from decoration, **L1 dead**. Each chip is a different colour so six facts at the same semantic level
get six different weights, **L10 dead**, and the surface ends up with four accents, **L3 dead**. Worst
of all the chips wrap: a component with a long owner string makes the row 84px while its neighbour is
64px, so the vertical rhythm is data-dependent, **L4 dead**. And chips defeat the actual goal — they
still put every fact at a different x-position on every row, so the reader still cannot scan a column.
It solves nothing and costs everything.

**V2 loses on the page, not on principle.** It is the most honest layout here and it obeys L5 and L10
cleanly. It dies for two reasons. (a) Eight columns puts the table past ~1900px min-width on a page
whose existing `.healthx-table` is already `min-width:1455px` and horizontally scrolling — a second
scroll axis for the same table is an operator hazard, and the "component name" column would scroll out
of view exactly when you need it (NN/g: the human-readable identifier must stay put). (b) Epistemically
it is wrong: it renders truth class as *one more column of equal weight*, when truth class is the thing
that decides whether the other seven columns mean anything. **L9** — subordinate/governing context gets
its own treatment, never crammed onto the same rank.

**V3 loses narrowly and donates its best organ.** The claim/warrant split is the single best *idea* in
this set and the winner steals it: the rightmost cell of V4 is V3's warrant block. But as a layout it
breaks two laws. Right-aligning the **source path** creates a ragged left edge down 20 rows that reads
as visual noise, and it puts a non-numeric string on the numeric rail — **L5** says numbers right-align,
labels left. And the 60/40 split point is an arbitrary value justified by nothing on any scale — **L4**.
It also has no disclosure model, so facts 7-14 (dependencies, correlation id, controls, restart
generation) simply have nowhere to live and get dropped — **L9**.

**V4 wins.** It is the only variant that actually kills the wall of gray, and it kills it by changing
the *category* of the gray text: because every qualifier sits at a fixed x-position in a fixed-width
slot, the gray stops being twenty different sentences and becomes **a matrix you read down**. Labels
are printed once in the head, so per-row label repetition — the thing that generates the wall — is
zero. Hierarchy is ink weight and one 2px spine: **L1**. Two radii total, `--r-md` on the frame and
`--r-sm` on the two controls, nothing else: **L2**. Truth class costs 2px of ink instead of a colour:
**L3**. The disclosure gives facts 7-14 a home instead of dropping or cramming them: **L9**.

---

## 5. Adversarial pass 1 — hunting decoration, generic, wrong weight

**Q: is a coloured spine decoration?** It is, if it duplicates something else or if it is coloured for
mood. Two fixes. (i) It is the *only* place truth class is colour-coded, and it always has a text
equivalent in the warrant cell — never colour alone (WCAG 1.4.1). (ii) It must not be green for
`LIVE_PUBLIC`. Green means *healthy*; truth class is not health. So the spine uses a **neutral ramp plus
pattern**, and spends the danger colour only on genuine gating:

| truth class | spine | why |
|---|---|---|
| `LIVE_PUBLIC`, `WIRED` | solid `--text` | proven — full-strength ink, the row may be believed |
| `BUILT_AND_TESTED`, `IMPORTED` | solid `--muted` | partial warrant, demoted ink |
| `SYNTHETIC_ONLY` | 4/4 dashed `--muted` | pattern = "this is a simulation", legible without colour |
| `UNKNOWN`, `MISSING` | 2/2 dotted `--faint` | unknown is lighter *and* finer than synthetic |
| `NOT_CONFIGURED` | hollow — 1px inset outline, no fill | absence rendered as absence |
| `BLOCKED`, `UNAVAILABLE` | solid `--down` **+ mandatory reason** | the only place danger colour is spent |

Six visually distinct treatments from three neutral inks, one danger ink and two patterns. **Unknown,
unavailable and broken now look different from each other**, which the truth doctrine demands, and the
difference survives greyscale and colour-blindness because two of them are patterns.

**Q: can the row ever lie green?** Yes, in the old code — `canonicalPresentation.status === 'operational'`
painted a green dot regardless of `truthLabel`. Closed structurally, in CSS, not in a code path someone
can forget: the green dot only exists inside `[data-truth="proven"]`. Everywhere else the dot is
neutral, and under `synthetic`/`unknown` it is a **hollow ring** — visibly "we are not asserting this".

**Q: what did the old row throw away?** `desiredLifecycle`. It rendered observed only. The gap between
desired and observed *is* the operational fact — a component that is `READY` and wants to be `READY` is
not the same as one that wants to be `READY` and is `DEGRADED`. So the posture cell renders the drift
equation `DESIRED → OBSERVED` and shows the arrow **only when they differ**; when they agree it is one
token and the cell is quiet. Zero extra chrome, one more real fact.

**Q: twenty rows all screaming?** When one component fails, every downstream component also reports a
blocker, and the table becomes twenty red rows. The model already knows: `rootCauseComponentId`. So the
root-cause row carries a small `ROOT` tag in `--down`; every downstream row's warrant cell reads
`↳ downstream of Basis Engine` in `--muted` instead of repeating the blocker. One alarm, not twenty.

**Q: L3 — one accent per surface, but I now have a status dot, a spine, a drift arrow, an exposure flag
and a blocker, all potentially saturated at once.** This is the "color chaos" the owner named. Rule,
enforced by a single computed attribute:

> **The row has exactly one saturated element at a time.** `data-emphasis` is computed once, by
> priority: `exposure` (capital at risk) > `gated` (blocked/unavailable) > `drift` (desired ≠ observed)
> > `live` (proven + operational) > `none`. Whichever wins is the only element allowed colour;
> everything else falls back to `--text-2` / `--muted`.

---

## 6. Adversarial pass 2 — scale audit, forgotten states, neighbour check

**Every value on the scale.** Scale is `--ow-1..7` = 2/4/8/12/16/24/32, row 56 (14×4), line 16, all
grid minimums divisible by 4 (232/168/148/196). Two constants are *inherited, not invented*, and are
commented as such: the 6px status dot (`.healthx-live i` in Health.css) and the 12px frame radius
(`.dcx-frame`, `.healthx-frame`). Type sizes are the house's exact existing values — 12.5/510 for the
value tier and 10.5/420 for the qualifier tier, lifted from `.healthx-source strong/small` so my row
cannot drift beside its neighbour. Nothing else numeric exists in the stylesheet.

**Contrast bug inherited from Health.css.** `#bd781b` on `--panel:#15181d` in dark is ~3.4:1 — below
4.5:1 for the 10.5px qualifier tier. Health.css ships that bug. I do not: `--ow-warn` is `#bd781b` in
light and `#e0a63a` in dark. Flagged so the fleet can fix Health.css too.

**States I had forgotten and have now enumerated:** loading/skeleton (three shimmer bars at the real
column positions, so nothing reflows when data lands — never a spinner, never fake values); empty
table; `freshnessState:'CLOCK_SKEWED'` (must not read as fresh *or* stale — its own token `CLOCK SKEW`,
and the age number is suppressed because a skewed clock cannot produce a trustworthy age); `UNAVAILABLE`
freshness with `blockerCode === null` → the row prints `REASON UNPUBLISHED` in `--faint`, **never blank**;
`restartState:'RESTART_REQUIRED'`; `capitalRelevance:'EXPOSED'`; row is root cause vs downstream;
`supportedControlIds.length === 0` → `no controls` in `--faint`, not an empty cell; selected; expanded;
focus-visible; hover; forced-colors.

**Neighbour check.** Placed next to `.healthx-source-row` (70px, 12.5/510 + 10.5/420, hairline
`--line`, hover `--hover`, 150ms) my row is 56px with the same two type tiers, the same hairline, the
same hover, the same 160ms — it reads as the same family, denser. The only new visual primitive on the
page is the 2px spine, and it is load-bearing.

**Zebra?** No. NN/g endorses striping for dense tables but warns it "may introduce unnecessary
complexity or cause usability issues" when the table already has borders and interactive rows. This
table has both, plus a spine in the same left region — a stripe would fight it. Hairline + hover only.

**Truncation, both ends (L8).** `middleTruncate()` in TS, never CSS ellipsis, for the two identifiers
that must stay verifiable: source path `productIntegration/…/basisEngine.ts` and correlation id
`c8f1a0…9e42`. Head/tail counts are fixed so the ellipsis lands at the same x on every row. Full value
lives untruncated and selectable in the drawer (Primer), with `title` as the mouse shortcut.

**Copy.** Consequence, not platitude. `SOURCE_STALE — no tick accepted for 41s; positions shown are
last-known, not live.` Not "Attention required".

---

## 7. Anatomy of the winner

```
head:  │   COMPONENT · SOURCE          LIFECYCLE          CAPABILITY        WARRANT ·  FRESHNESS
       ├───────────────────────────────────────────────────────────────────────────────────────
row:   │▌  ● Basis Engine              READY → DEGRADED   LIVE PUBLIC              WIRED   ⌄
       │▌    productIntegration/…/basisEngine.ts          3 controls        stale 41s
       ├───────────────────────────────────────────────────────────────────────────────────────
row:   │┊  ○ Margin Private Truth      READY              LIVE PRIVATE READ     OWNER GATED  ⌄
       │┊    productIntegration/…/margin.ts               no controls   PRIVATE_READ_AUTHORIZATION_REQUIRED
```
Cell 1 identity (dot + name / source path), cell 2 posture (drift equation / control count),
cell 3 capability, cell 4 warrant right-aligned (truth token / freshness or reason), cell 5 chevron.
Labels appear once, in the sticky head. Full spec, CSS and markup: see the structured deliverable.
