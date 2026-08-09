# Watchdog — dependency topology: node & wire

Element owner notes, **panel round 2 (rebuild)**. Supersedes `docs/design/graph-node.md`,
which was written before the sibling elements shipped and is now wrong in its premises.
File: `web/src/features/watchdog/styles/dependencyGraph.css`. Prefix `--wd-topo-*`.

---

## 0. What changed, and why the element is different now

The panel's verdict was correct: *"strip the doctrine and this node is the Grafana node."*
It was. The rebuild does not polish that node — it changes what the element is **for**.

Reading the tree turned up two shipped roster specs the first submission did not know about:

- `web/src/features/watchdog/StatusChip.tsx` + `styles/statusChip.css` — the state
  vocabulary, the eight glyph topologies, the fill ladder, the `REASON_REQUIRED` runtime
  invariant, and the stale-demotion rule, **already implemented**.
- `docs/design/watchdog/tokens.md` — `--sp-1..9`, six type levels, a four-tier ink ramp
  pinned to APCA, and four semantic hues each constrained to an allowed channel.
- `web/src/features/watchdog/styles/motion.css` — five durations, two curves, the focus
  language, and a **feed-state vocabulary** (`[data-feed="late|stale|dead|held"]`).

Once those exist, ~60% of the first submission was reimplementation. What is genuinely left
for this element to own is one question, and it is the only question a topology can answer
that the health table cannot:

> **A component's claim is only as good as the weakest proof on any path feeding it.
> Where does the doubt come from, and how far has it spread?**

That is the thesis. Everything below is derived from it.

**Consequences, stated up front:**

1. There is **no metric on the node face**. Vizceral's own argument — quoted and then
   ignored by the first submission — taken to its conclusion.
2. There is **no `kind` label on the node**. In a *layered* graph the layer is the kind;
   printing `INGEST` on four nodes in the ingest column is three redundant labels. One
   column header carries it once.
3. The node therefore has exactly **two rows**: identity+state, and the **warrant**.
4. The **edge reports the channel, never the component.** An edge is a proof channel with
   two facts: contract (width) and proof (solid / dashed / severed). Component health is
   the node's job. This kills the old three-channel overload and reduces the canvas to
   **one hue, spent only on severed channels**.
5. **Doubt materialises the container.** A proven node has no box at all.

---

## 1. Panel round 2 — disposition of all 46 defects

### Accepted and fixed (the substantive ones)

| # | Defect | Fix |
|---|---|---|
| 1 | Healthy louder than unknown | **Accepted, mechanism corrected.** See §2.3. |
| 2 | `data-stale` recoloured a lie | **Accepted.** `[data-stale]` CSS deleted. Feed state is `[data-feed]` (motion.css) and it is a **data-layer** override. §5.1 |
| 3 | A healthy wire could sever a fault wire | **Accepted.** Paint-order contract, §4.4. |
| 4 | Two first-paint states | **Accepted.** `loading` deleted. `StatusChip` already resolves `undefined → UNKNOWN`. |
| 5 | Four radii, 9px misderived | **Accepted.** `var(--r-sm)` only. `.dcx-runtime-engine` verified: no `border-radius`. |
| 6 | "4px grid" was fiction | **Accepted.** Consumes `--sp-1..9` from `tokens.md`. §3. |
| 7 | Amber token debt | **Accepted, and the panel undercounted.** §1.2. |
| 8 | House `.warn` is blue | **Accepted.** Resolved by the node holding **no degraded hue at all**. §1.2 |
| 9 | Warrant rendered quietest | **Accepted, fix rejected.** Promoted by deletion and position, not ink. §1.3 |
| 10 | L5 column argument didn't survive | **Accepted.** No number on the node face ⇒ no broken column. Numbers live in the layer footer and the ledger, on one column. |
| 11 | JS char-budget truncation | **Accepted.** CSS two-span middle truncation, §2.5. |
| 12 | `--faint` used for text/glyph | **Accepted.** `--faint` / `--ink-mute` appear nowhere. |
| 13 | Dark `--muted` at 10.5px | **Accepted.** Sizes are integers from the type scale (11px / 12px); ink is `--ink-3`. |
| 14 | `--warn` fails 4.5:1 light | **Moot.** No amber in this element. |
| 15 | Focus/selection ring ~1.9:1 | **Accepted.** Inherits `.watchdog :focus-visible`; selection is a distinct inset ring. §1.4 |
| 16 | Edge stroke 1.85:1 | **Accepted.** Wire ink is `--ink-3` — **4.82:1 light / 4.15:1 dark**, computed in §6. Opacity multiplier deleted. |
| 17 | Dashed border imperceptible + undashable | **Accepted, mechanism replaced.** Hueless states use a **tile fill**, not a dashed border. Dash is now exclusively a wire channel. §2.3 |
| 18 | No forced-colors block | **Accepted.** §5.4 |
| 19 | Accessible name was the truncation | **Accepted.** `aria-label` carries id + state + reason. |
| 20 | No live region | **Accepted.** One coalesced `role="status"`. §5.3 |
| 21 | `.wd-sr` blob = second source of truth | **Accepted, and pushed further.** One DOM, two presentations. §2.1 |
| 22 | Node 2px short (border) | **Accepted.** Every node carries a 1px **transparent** border in all states so the box never changes size. §3 |
| 23 | SVG scaled 0.955 × 0.846 | **Accepted.** No `viewBox`, no `width`/`height` attributes, no padding on the canvas. §4.1 |
| 24 | Hardcoded canvas height | **Accepted.** Computed from the widest layer. |
| 25 | hit-width == edge separation | **Accepted.** Invariant `hit < separation`: 12 < 16. |
| 26 | Casing colour could diverge | **Accepted.** Element declares its own background and the casing reads the same custom property. |
| 27 | Two states inert on hover | **Accepted.** One `--wd-topo-surface` property per state, set twice. |
| 28 | `overflow:hidden` breaks baseline | **Accepted.** `align-items: center` + both rows at `line-height: 16px`; the two-span truncation removes `overflow` from the flex item anyway. |
| 29 | em-dash not a figure; two inks for one meaning | **Accepted.** U+2012 FIGURE DASH, one ink (`--ink-3`), in the ledger. |
| 30 | Skeleton bars 0px | **Moot** (loading deleted). |
| 31 | `transform-origin` without `transform-box` | **Moot** (no local spinner; `proving` is the chip's). |
| 32 | `context-stroke` with no fallback | **Accepted.** MDN's `marker-end` page does not document `context-stroke` at all. Two explicit markers. §4.3 |
| 33 | 384px dead band | **Accepted.** Breakpoint **derived** from canvas width (1040px), plus `prefers-reduced-data`. |
| 34 | Fallback didn't exist | **Accepted, and reframed.** It is not a fallback; it is the DOM. §2.1 |
| 35 | Generic Grafana node | **Accepted.** §0. |
| 36 | Two strawman variants | **Accepted.** Four new ones, §7. |
| 37 | Two decorative references | **Accepted (a), rejected (b).** §1.5 |
| 38 | Parallel state vocabulary | **Accepted.** Consumes `WatchdogState` verbatim. |
| 39 | Two glyph languages | **Accepted.** Renders `StatusChip`'s glyph. No new shapes. |
| 40 | Namespace fork | **Accepted.** `features/watchdog/styles/dependencyGraph.css`, `--wd-topo-*`. |
| 41 | New hex literals | **Accepted.** Zero hex literals in the file. |
| 42 | Reimplementing roster elements | **Accepted.** ~55% composition now. §8 |
| 43 | Focus language fork | **Accepted, and Rauno's premise corrected.** §1.4 |
| 44 | Hover vs selection undefined | **Accepted.** §5.2 |
| 45 | `--wdg-dim: .30` too aggressive | **Accepted, fix rejected.** There is **no opacity change anywhere** in this element. §4.5 |
| 46 | Two decisions deferred | **Accepted.** Both answered: §2.4 (primary datum) and §2.4 (TTL). |

### 1.2 Where the panel was right but did not go far enough — amber

The panel counted 10 amber sites. `tokens.md` §1 counts **17 distinct amber/orange hex
literals**. I confirmed by grep: 59 matching lines across `Health.css`,
`systemDashboard.css`, `LiveIntelligence.css`, `Risk.css`, `Opportunities.css`,
`Dashboard.css`, plus a **`var(--warn, #b45309)`** fallback at `styles.css:15225`,
`Dashboard.css:687`, `Risk.css:750` — an eighteenth amber hiding inside the fallback of a
variable that is defined nowhere.

But the more important finding is a **roster conflict the panel missed**:

- `statusChip.css:37-39` — *"Amber is deliberately absent: amber-vs-red is the tightest pair
  in the Okabe-Ito CVD-safe canon and the two sit at near-identical luminance."* DEGRADED
  is a **tinted red**.
- `tokens.md` §7.4 — `--warn` **is** amber (`#8f5d07` / `#e6b44f`) and is the degraded hue.

Two shipped roster specs disagree about the colour of DEGRADED. **This element does not
arbitrate it and does not pick a side.** The node renders `<StatusChip>`; whatever the
roster settles, the node inherits, with zero edits here.

And the panel's proposed fix — *"the node consumes `var(--hp-amber-ink)`"* — is **rejected**:
that would make this element the eighteenth consumer of a hue that the roster's own chip
element explicitly refuses. Filed, not adopted.

The wire, which *is* mine, resolves L3 by removing the question: **degraded gets no hue on
an edge.** A degraded channel is still a proven channel and stays neutral. Only a **severed**
channel takes `--bad`. One hue on the canvas, spent on the two or three wires that are
actually cut.

### 1.3 Where the panel's diagnosis was right and its fix was wrong — promoting the warrant

Panel #9 is correct: the warrant was the element's only original idea and was rendered as
the quietest text on the node. The proposed fix — *"move the warrant to row 2 at `--text-2`
weight 470"* — is rejected, because `tokens.md` §7.2/§7.3 assign reason lines to **T5 /
`--ink-3`**, and lifting one element's reason line to `--ink-2` forks the roster's ink ramp
for a local emphasis effect. That is hierarchy-from-colour-bump: the exact L1 failure the
sign-in screen warns against.

**Promotion is by deletion and by position.** The warrant went from *third of three, competing
with a metric and an uppercase kind label*, to *one of two, with nothing competing.* Same
ink, same size, radically more weight — because weight is what is present, not what is loud.

One surgical exception, and it has sibling precedent (`statusChip.css:225`,
`.wd-chip-reason b { color: var(--text-2) }`): when the doubt is **inherited**, the upstream
component's id inside the sentence renders at `--ink-2`. The load-bearing token gets the
lift; the sentence does not.

### 1.4 Where the panel was right and its own reference is stale — the focus ring

Panel #43 is correct: this element must not be the only box-shadow focus ring on the page.
`motion.css:195-209` already settles it — `outline: 2px solid var(--mo-ring); outline-offset: 2px`,
never transitioned, with an **inset** ring for rows clipped by `.healthx-frame { overflow: hidden }`.

Worth recording *why* the first submission forked: it cited Rauno's *"Box shadow should be
used for focus rings, not outline which won't respect radius."* That guideline's premise is
now **stale** — `outline` has followed `border-radius` in Chrome 94+, Firefox 88+ and
Safari 16.4+. The house global is correct on current engines and this element inherits it
unchanged. Selection is distinguished from focus by being **inset** rather than outset, so
a focused-and-selected node composites two visually distinct rings.

### 1.5 One reference charge accepted, one rejected

**Accepted (37a):** WCAG was cited for the easy criterion (1.4.1) and the measurable ones
were never run. §6 now contains computed ratios for every ink this element ships, and
1.4.11's *"2.999:1 would not meet the 3:1 threshold — rounding is not permitted"* is treated
as a hard gate.

**Rejected (37b):** Rauno's *"interactive elements in a vertical or horizontal list should
have no dead areas between each element"* is a rule about **lists**. A layered DAG cannot
have zero space between nodes — ELK's `edgeNodeSpacing` exists because wires must route
*through* that space. Applying a list rule to a canvas would be the misreading. The rule is
applied where it actually belongs: the **ledger presentation**, whose rows are edge-to-edge
with no dead gutters.

---

## 2. The element

### 2.1 One DOM, two presentations

This is the structural answer to panel #21 and #34 together, and it is stronger than either
fix proposed.

The element renders **one** document: an `<ol>` of components in **topological order**, each
`<li>` containing its identity, its `<StatusChip>`, its warrant, and its dependency list as
real text. That list is the truth.

- **≥ 1040px** — each `<li>` is absolutely positioned onto the canvas by layer/row, and an
  `aria-hidden` `<svg>` paints the wires *underneath* it. The dependency list stays in the
  DOM, visually clipped by `.mo-sr` (motion.css:335) — never `display:none`, which would
  remove it from assistive technology.
- **< 1040px, or `prefers-reduced-data: reduce`** — positioning is dropped. The list falls
  into normal flow as a **rail ledger**: rows edge-to-edge, dependencies as an indented rail,
  zero crossings by construction, one right-aligned numeric column across all 14 rows.

The breakpoint is **derived, not chosen**: 4 layers × 176 node + 3 × 96 lane = 992, plus
2 × 24 page padding = **1040px**. There is no dead band.

The `.wdg-sr` prose blob is deleted. There is no second source of truth to drift.

### 2.2 Node anatomy — two rows, one container

```
┌ 1px transparent border, always present, so the box never resizes ────────┐
│  ▢          exec-rou…-primary          Unknown                           │  row 1  T4 12/16/500
│  ↑ 16px     ← middle-truncated →       ← StatusChip word ─┘              │
│  glyph      the IN-PORT is the glyph                                     │
│  gutter                                                                  │
│             stale 4m12s over 30s budget                                  │  row 2  T5 11/16/450
└──────────────────────────────────────────────────────────────────────────┘
   176 × 48
```

- **The glyph gutter is the wire's in-port.** Every incoming proof channel terminates on the
  state mark. That is the thesis rendered as geometry: proof arrives at the state.
  Out-port is the container's right edge. Left → right = consumer → dependency
  (Datadog's axis: *"services on the left are closer to your customers, and the ones on the
  right are more likely root causes"*).
- The glyph is **`StatusChip`'s glyph component**, at its own 12px `--wd-glyph`. No new
  shapes. Eight topologies already exist; inventing a ninth would fork the feature.
- Row 1 right slot holds the chip's **word**, not a number.
- Row 2 is the **warrant**, and it has two grammars:
  - *self-warranted* — `via ws-heartbeat · 2s`
  - *inherited doubt* — `↤ exec-router-primary: stale 4m12s`
  The grammar tells the operator instantly whether the doubt is local or imported. No other
  topology tool in the reference set distinguishes these.
- Row 2 is **never blank and never a platitude**. `StatusChip`'s `REASON_REQUIRED` set is a
  runtime invariant — a DEGRADED / BLOCKED / UNAVAILABLE / NOT_CONFIGURED / OWNER_GATED or
  stale node with no reason renders the `defect` tone and logs an error in DEV.

### 2.3 Ink ladder — doubt materialises the container

`statusChip.css:12-13`: *"READY is the QUIETEST state on the page. A healthy wall spends
almost no ink. Only DEGRADED, BLOCKED and OWNER_GATED draw a container."* The first
submission inverted this. The rebuild obeys it, and extends it by one step because a
topology has more room than a chip:

| state | container | glyph | ink cost |
|---|---|---|---|
| READY | **none** — transparent border, transparent fill | `--ok`, 12px | ~0 |
| UNKNOWN · UNAVAILABLE · NOT_CONFIGURED | `--tile` fill, transparent border | hueless, chip topology | low |
| OWNER_GATED | `--held` tint | held ink | medium |
| DEGRADED | `--warn` tint + hairline | degraded ink | high |
| BLOCKED | `--bad` tint + hairline, chip renders **solid** | on-solid | highest |

Fourteen proven components render as **fourteen bare labels on an empty canvas**. That is
the truthful picture of a healthy system: nothing to look at. The instant a component stops
proving itself, a box appears under it. The eye is drawn to doubt by construction, not by
a colour the operator has to learn.

**Two corrections to the panel's proposed fix (#1):**

1. The panel wanted the *glyph* ink budget inverted (healthy → 1px hairline ring). Rejected:
   `tokens.md` §7.4 permits `--ok` *"glyph only, ≤12px, never text, never fill"*, and
   `statusChip.css:33` calls its green *"the only green in the vocabulary, and it is 6px of
   it."* The glyph is **identity**, not weight. The **container** is the ink budget. Moving
   the budget to the container satisfies the panel's actual requirement — unknown must never
   read quieter than healthy — completely, because healthy has *zero* container.
2. The panel wanted a dashed border as the unknown texture. Rejected on the panel's own
   grounds (#17): CSS gives no control over border dash length, and `--line-strong` measures
   ~1.4:1 light / ~1.75:1 dark. A **tile fill** is the house's own tinted-tile language, is a
   surface rather than a boundary (so 1.4.11 does not bite), and is legible at a glance
   across a canvas in a way a 1px dash never is. **Dash is freed to be a wire channel and
   nothing else.**

### 2.4 The two deferred decisions, answered (panel #46)

**Primary datum.** There is none, and that is the answer. The node face carries *identity,
state word, warrant.* A latency number on 14 nodes forms four short columns of ~3.5 values
each, which is not a scannable column (the panel's #10, correctly aimed). Numbers belong
where they align: the **layer footer** (`INGEST · 4 · p99 18 / 24 / 31 / ‒`) and the ledger's
single right-aligned tabular column. Vizceral: *"exact numbers stop being as important and
relative information is much more actionable."* This element finally acts on the sentence it
quoted.

**Freshness TTL.** If a component has no configured freshness budget, the warrant must not
render `stale 4m12s over 30s budget` against a constant. It renders
**`no freshness budget configured`** and the state is `NOT_CONFIGURED`, not `UNKNOWN`.
That is itself a true, consequence-bearing warrant and it makes an unconfigured budget
*visible* rather than papered over by a plausible-looking comparison. This is the doctrine
applied to the element's own credibility.

### 2.5 Identifier truncation

Ids are tail-discriminated (`exec-router-primary` vs `exec-router-shadow`), so tail ellipsis
destroys the only distinguishing byte (L8). Truncation is **CSS-only**, two spans:

```html
<span class="wd-topo-name">
  <b>exec-router-</b><i>primary</i>
</span>
```

`<b>` is `min-width:0; overflow:hidden; text-overflow:ellipsis`; `<i>` is `flex:none`. It is
self-measuring, resolution-independent, produces a real ellipsis, works at any container
width, and — because the overflow now sits on `<b>` and not on the flex item — it also fixes
the synthesised-baseline bug (#28). The head/tail split is the **`identifier`** element's
job; this element consumes it.

---

## 3. Geometry — every value on the roster scale

From `tokens.md` §7.1: `--sp-1..9` = 2, 4, 6, 8, 12, 16, 24, 32, 48. Law: *≤ `--sp-4` is
intra-component, ≥ `--sp-5` is inter-component, nothing in between.*

```
node width  176px = --sp-6 × 11
            derived: gutter 16 + gap 8 + longest real id at T4
            ("exec-router-primary", 19ch ≈ 126px Inter 12/500) + 2×8 pad + 2×1 border = 176
node height  48px = --sp-9
            = 16 (T4 lh) + 2 (--sp-1) + 16 (T5 lh) + 2×6 (--sp-3) + 2×1 border   ✔ border counted
row gap      24px = --sp-7      ELK nodeNode default 20 → next step ON THE SCALE
lane gap     96px = --sp-9 × 2  two orthogonal bends + a wire label
bend radius   8px = --sp-4
glyph gutter 16px = --gutter-icon
wire sep     16px = --sp-6      ELK edgeEdge default 10 → the step that keeps hit < sep
wire hit     12px = --sp-5      INVARIANT: hit (12) < sep (16), 4px of margin
canvas       992 × computed     4×176 + 3×96 wide; height = max over layers, never a literal
breakpoint  1040px              = 992 + 2 × --sp-7 page padding. Derived.
```

**The border law:** every node carries `border: 1px solid transparent` in every state
(`statusChip.css:127`'s own trick). Only the *colour* changes. A READY node and a BLOCKED
node are the same 176 × 48 box, so a live poll flipping state can never reflow the canvas —
and the height arithmetic includes the border, which is what panel #22 caught.

**Type** (`tokens.md` §7.2) — integers only. No 13.5, no 12.5, no 10.5.
T4 12/16/500 for the name and the state word; T5 11/16/450 for the warrant; T3 10/14/600
uppercase for the layer header. Both node rows share `line-height: 16px`, which with
`align-items: center` makes the baseline question moot.

**Radius** — `var(--r-sm)` (8px) for the node and the wire label. Two radii in the whole
feature: `--r-sm` for data, `--r-pill` for actions. Matches `--wd-radius` exactly.

---

## 4. The wire

### 4.1 One origin, no scaling

Panel #23 was a first-render bug, and the fix is stricter than the one proposed:

- `.wd-topo-canvas` has **no padding**. Page padding lives on `.wd-topo`.
- The `<svg>` carries **no `viewBox`, no `width` attribute, no `height` attribute**. An SVG
  without a `viewBox` uses its own CSS pixel box 1:1, so a scale mismatch is not merely
  avoided, it is *unrepresentable*. Path coordinates are CSS pixels, identical to the
  coordinate space the `<li>`s are positioned in.

### 4.2 Two channels, and the edge never reports the component

```
stroke-width  = CONTRACT     required 1.5px · optional 1px      (no opacity multiplier)
dash          = PROOF        proven solid · unproven 4 4
hue           = SEVERED ONLY --bad, plus a mid-path break glyph
```

Dropping the opacity multiplier is not cosmetic: `.62 × 4.82:1` put optional wires at
~1.4:1, under SC 1.4.11's floor. Contract is now width alone, and both widths sit at the
same ink.

**Degraded wires stay neutral.** A slow channel is a *proven* channel; impairment is a
property of the component, and the component has a chip. This is the single change that
collapses the old three-channel overload into two and gives the canvas one hue.

Dash `4 4` = `--sp-2 --sp-2`. (The first submission's `stroke-dasharray: 2 2.15` had no
derivation anywhere and is deleted.)

### 4.3 Direction markers

MDN's `marker-end` page documents `markerUnits` and `orient` but **does not document
`context-stroke` at all**, and the first submission claimed fallbacks that did not exist in
its own CSS. Two explicit markers, selected by `data-proof`:
`#wdTopoArrow` (fill `--wd-topo-wire-ink`) and `#wdTopoArrowSevered` (fill
`--wd-topo-sever`). Two, not three, because degraded no longer has a hue.

### 4.4 Bridged crossings — with a fault-priority paint contract

Each wire draws a casing in `--wd-topo-bg` at `stroke-width + --sp-2`, so the later wire
carves a clean gap out of the earlier one and a crossing reads unambiguously as over/under.
Honeycomb: *"Early versions of the map looked more like a tangle of spaghetti than anything
else!"* — crossing legibility is the whole problem. Sugiyama's own literature confirms it:
crossing minimisation is NP-hard even for a single layer, so a renderer cannot assume zero
crossings and must make the ones it has readable.

**In SVG there is no "upper" edge, only *later*.** So paint order is a contract, not an
accident:

```
pass 1  every casing
pass 2  every neutral line + marker
pass 3  every severed line, its break glyph, and its marker   ← LAST, always
```

> **A fault wire is never the lower edge of a crossing.**

The casing colour is `var(--wd-topo-bg)`, which the element also sets as its own
`background` — the two read the same custom property and cannot diverge onto a `--bg` or
`--tile` backdrop (#26).

Routing: orthogonal (ELK `EdgeRouting.ORTHOGONAL`, its default), `NodePlacementStrategy.BRANDES_KOEPF`
— which guarantees *"at most two bends per edge"*, the fact the lane width is sized against —
`CrossingMinimizationStrategy.LAYER_SWEEP`, `LayeringStrategy.NETWORK_SIMPLEX`,
`PortConstraints.FIXED_SIDE` so wires only ever leave a right face and land on a left glyph.

### 4.5 Highlighting: promote, never dim

**This element contains no opacity change anywhere.** That is a checkable law.

Panel #45 correctly identified that dimming 70% of the graph to `.30` destroys the operator's
orientation. The proposed fix (`.45`, nodes and edges at different values) is rejected for a
harder reason: dimming a `--ink-3` wire to any value under ~1.0 pushes it below SC 1.4.11's
3:1 floor, and a topology's wires are the definitional *"parts of graphics required to
understand the content."* You cannot de-emphasise a wire without making it non-compliant.

So the mechanism inverts: hover or select a node and the **doubt path** — the chain of wires
from that node back to its least-proven ancestor — goes from 1.5px to 2.5px and reveals its
label. Nothing else changes. Nothing is hidden, nothing fades, nothing repaints 14 nodes,
and there is no transition to suppress under reduced motion. Datadog's click-to-isolate
without Datadog's dimming.

The wire label is HTML in an overlay layer (React Flow's `EdgeLabelRenderer` mechanic), so it
gets real ellipsis and real tabular numerals, and it is **inert** — Rauno: *"Tooltips
triggered by hover should not contain interactive content."*

---

## 5. States, feed, focus, forced colors

### 5.1 Feed staleness is a data-layer override, not CSS

The `[data-stale="true"]` block is deleted. It swapped a border and muted a metric while the
glyph still said READY and the warrant still said *"via ws-heartbeat"* — recolouring a lie.
And CSS cannot swap an inline `<svg>` glyph anyway.

`motion.css` already ships the vocabulary: `[data-feed="late|stale|dead|held"]` on the
`.watchdog` root, and it already clears change marks on stale/dead/held. The renderer passes
`stale` into `StatusChip`, and `StatusChip.tsx:77-83` **already implements the rule**:

> *"A stale chip may never render the affirmative tone… Staleness demotes toward neutral and
> never promotes… A stale BLOCKED is still blocked — a proven failure does not soften."*

READY + stale → tone `absent`, glyph `STALE` (ring + clock hand), label `Stale`, and a reason
is mandatory. One code path, no CSS papering, and it comes free from composing the sibling —
which is itself the argument for composing it.

### 5.2 Hover versus selection (panel #44)

- **Selection owns the doubt path.** Click sets `aria-pressed="true"`; the path stays lit.
- **Hover on a non-selected node** changes only that node's own surface. It does **not**
  re-light the path. A selected investigation is not interrupted by a passing pointer.
- **Hover with nothing selected** lights that node's path.
- **Escape** clears selection; hover behaviour resumes.
- Focus follows hover's rule, and per `motion.css:194` is never transitioned.

Keyboard: roving `tabindex`, one node tabbable. `↑ ↓` within a layer, `← →` **along a wire**
(the topology-native axis), `Home`/`End` first/last in layer, `Enter`/`Space` toggle
selection, `Escape` clears. React Flow's own a11y model adds one mechanic worth taking:
*"When a node receives focus, React Flow automatically pans the canvas to bring that node
into view"* — required here, because the canvas scrolls between 1040px and the layout width.

### 5.3 One live region, coalesced

`StatusChip.tsx:118-120` states the rule: *"Twenty aria-live regions repainting on every poll
would flood a screen reader. Only the single lede instance is a live region."* So the graph
gets **exactly one** `role="status" aria-live="polite"`, and it announces the **coalesced
delta per poll**, in the warrant's own voice:

> "2 changes. exec-router-primary is now Unknown: stale 4 minutes 12 seconds over its 30
> second budget. venue-gw-binance is now Blocked: handshake refused."

No announcement on first paint. No announcement when nothing changed.

### 5.4 Forced colors

Ports `statusChip.css:282`'s block and extends it to the canvas. Under Windows HCM every
fill is dropped, so the tile-fill ladder collapses — the containers therefore gain
`border-color: CanvasText`, wires take `stroke: CanvasText`, and severed wires are
distinguished by `Highlight` **plus** the break glyph and the dash pattern, both of which
survive HCM. The encoding never depended on hue; this is where that gets proven.

---

## 6. Measured contrast (SC 1.4.11: *"2.999:1 would not meet the 3:1 threshold"*)

Computed, not remembered — sRGB relative luminance per WCAG 2.x.

| ink | surface | ratio | gate | verdict |
|---|---|---:|---|---|
| wire `--ink-3` → `--muted` `#697180` | light `--panel` `#ffffff` | **4.82:1** | 3:1 graphics | ✔ |
| wire `--ink-3` → `--muted` `#717b8a` | dark `--panel` `#15181d` | **4.15:1** | 3:1 graphics | ✔ |
| severed `--bad` → `--down` `#e0414b` | light `#ffffff` | **3.84:1** | 3:1 graphics | ✔ |
| severed `--bad` → `--down` `#f6465d` | dark `#15181d` | > 4:1 | 3:1 graphics | ✔ |
| name `--ink-1` → `--text` | both | ≫ 7:1 | 4.5:1 text | ✔ |
| warrant `--ink-3` → `--muted` (dark, lifted per `--wd-absent-ink`) | dark `--tile` | 4.55:1 | 4.5:1 text | ✔ |
| focus/selection `--mo-ring` | — | inherits house | 3:1 non-text | filed with `tokens` |

Banned outright in this element: `--faint`, `--ink-mute`, every raw hex literal, and any
opacity multiplier on a truth-bearing stroke. `tokens.md` §7.3: *"no truth-bearing text
below Lc 60; `--ink-mute` never carries truth."*

The one ratio this element does **not** own is the focus ring — `--accent-line`
`rgba(47,107,255,.42)` composites to ≈1.9:1 on white. Panel #15 is correct and it is a
**house-global** defect at `styles.css:146` and `motion.css:196`. Filed against `tokens`;
forking it here would make this element the only page object with a different focus ring,
which is exactly the drift #43 objects to.

---

## 7. Four variants (the previous set had two strawmen)

| variant | design variables moved | verdict |
|---|---|---|
| **W1 — Warrant node, doubt materialises the box** | Hierarchy: presence of a container, not size/hue. Density: 2 rows, no metric, no kind. Disclosure: everything on the face, path promoted on hover. State: chip glyph + container fill + mandatory reason. Chrome: zero for proven nodes. Motion: none. | **WINNER** |
| **W2 — Provenance ribbon** | Node reduced to a bare text label; state moved off the node entirely and onto a stacked micro-bar at the in-port, one segment per incoming proof channel. Density: very high. Chrome: none. | **LOSES.** A ribbon is a *proportion*, and unknown has no proportion — the same kill that took the old arc variant, in new geometry. Worse, it hover-gates the reason, and `REASON_REQUIRED` is a **runtime invariant** in shipped code, not a preference. It would render the `defect` tone by construction. |
| **W3 — Adjacency matrix** | Abandons node-link entirely: 14 × 14 grid, rows = consumers, columns = dependencies, cell = channel proof. Zero crossings *by construction*. Perfect L5: one aligned column per dependency, all 14 rows. Scales to ~100 nodes with no relayout. | **LOSES on the task, not on quality.** Crossing minimisation is NP-hard and is the dominant readability cost, so a zero-crossing representation is a serious contender. But this element's thesis is **path-following** — *where does the doubt come from, how far has it spread* — and following a multi-hop path in a matrix means hopping row→column→row across the grid, which is the one task matrices are worst at. At 4 layers with Brandes-Köpf's ≤2 bends per edge, 14 nodes is also small enough that crossings stay tractable. If the topology grows past ~40 nodes this becomes the right answer and should be revisited. |
| **W4 — Topological ledger with proof rails** | No canvas at all. Ordered list in topological order, dependencies as an indented rail, one right-aligned tabular column across every row, zero crossings. | **LOSES as the visual answer — WINS as the document.** A DAG is not a tree: a dependency consumed by four components must be duplicated (breaking L10) or cross-referenced (re-inventing edges with a worse affordance). But it is the correct **DOM**, and it is what renders below 1040px, under `prefers-reduced-data`, and to assistive technology at every width. Not a fallback. Half the element. |
| **W5 — the incumbent (192×60 boxed tile, metric + kind + warrant)** | Kept as the control. | **LOSES.** Every node draws a box, so the container carries no information; the metric forms four ~3.5-value columns that are not a column; `kind` restates the layer 14 times; and the warrant — the only original idea — competes with two things that the layout and the ledger already said. |

**Why W1 wins in one sentence:** it is the only variant where the *absence* of chrome is the
healthy signal, so the canvas gets quieter as the system gets more proven, and every pixel
that exists on it is doubt.

---

## 8. Composition (panel #42): what this element does NOT implement

| owned by | consumed how |
|---|---|
| `status-chip` | `<StatusChip>` — state vocabulary, all 8 glyph topologies, fill ladder, `REASON_REQUIRED`, stale demotion, change flash |
| `tokens` | `--sp-1..9`, T3/T4/T5, `--ink-1/2/3`, `--ok/--warn/--bad/--held`, `--r-sm` |
| `motion` | `--mo-*` durations and curves, `:focus-visible`, `[data-feed]`, `.mo-sr`, `.mo-payload`, the never-animate list |
| `identifier` | head/tail split for middle truncation |
| `numeric` | tabular figures in the layer footer and the ledger column |
| `metric-cell` | the layer-footer roll-up |
| `card-frame` | the `--r-md` frame this element nests inside at `--r-sm` |

What is left, and is genuinely this element's: **the node's two-row warrant anatomy with the
glyph-as-in-port**, **the doubt-materialises-the-container ink ladder**, **the wire's
two-channel contract/proof encoding with fault-priority paint order**, **the promote-never-dim
doubt path**, and **the one-DOM/two-presentation structure**. Roughly 45% of the element;
the rest is composition, which is what it should have been the first time.

---

## 9. Open items filed elsewhere (not this element's to decide)

1. **`tokens` must arbitrate the DEGRADED hue.** `statusChip.css:37` (amber deliberately
   absent, degraded is tinted red) vs `tokens.md` §7.4 (`--warn` is amber). Two shipped
   specs, one contradiction. This element inherits either.
2. **`tokens` must ship `--sp-*` / `--ink-*`.** They are spec-only today; this element
   consumes them with house-token fallbacks (`var(--sp-5, 12px)`) so it works before and
   after the migration, with no edit.
3. **`tokens` must define `--warn`** — `styles.css:15225`, `Dashboard.css:687` and
   `Risk.css:750` already read `var(--warn, #b45309)` against a variable defined nowhere.
   Then migrate the 17 amber literals.
4. **`tokens`/`motion` must fix the focus ring contrast** (`--accent-line` ≈ 1.9:1). House
   global, not element-local.
5. **Layout engine.** `elkjs` is ~500KB. For 14 nodes / 4 layers a hand-rolled layer-sweep is
   feasible; the bridged casing then becomes load-bearing rather than polish. Decide before
   implementation.
6. **Position stability.** Layer assignment must be pinned and ordering re-run only when the
   *edge set* changes. A graph that relayouts every poll is unreadable regardless of node craft.
7. **Group rollups** are unnecessary at 14 nodes. If the topology passes ~24, switch on
   Grafana's hidden-node marker pattern — and the rollup **floors at the least-proven child**,
   never `max()`, never an average.
