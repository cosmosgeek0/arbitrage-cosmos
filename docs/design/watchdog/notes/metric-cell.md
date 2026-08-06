# Headline metric cell — Watchdog instrument cluster

**Round 2 — rebuilt against the panel.** The previous version survived as doctrine and failed as
a rendering. This one is smaller, because the honest answer to half the panel's findings was
"another element already owns that, delete yours."

Element owned: the four readings at the top of Watchdog — **loop lag**, **envelope build**,
**transport RTT**, **delivery channel** — and the band that fuses them into one instrument.

Repo root: `/Users/cosmosgeek/Desktop/Main`. Files read for this round:
`web/src/styles.css`, `web/src/pages/Health.css`, `web/src/pages/MetricTiles.css`,
`web/src/features/watchdog/styles/statusChip.css`, `web/src/features/watchdog/StatusChip.tsx`,
`web/src/features/watchdog/styles/motion.css`, `docs/design/watchdog/tokens.md`,
`web/src/lib/productIntegration/model.ts`, `web/index.html`.

---

## 0. What reading the neighbours changed

The previous round designed in isolation and invented a parallel language. Four neighbouring
elements had already landed, and three of them own things I had built badly:

| I had | Owner | What actually happens now |
|---|---|---|
| Uppercase `STALE` / `UNAVAILABLE` tokens, my own 3-shape 6px mark, my own tone→ink map | `features/watchdog/StatusChip.tsx` + `styles/statusChip.css` | **Deleted. Register 3 renders `<StatusChip inline>`.** I own no state presentation at all. |
| `.mx-unread` — a 6px `--accent` dot | `features/watchdog/styles/motion.css` (`--mo-gutter/--mo-mark-w/--mo-mark-h`) | **Deleted. The cell takes `.wd-row` and `data-changed`; motion.css draws a 2px bar in a reserved 12px inline-start track.** |
| `midTruncate()`, `title=` disclosure | `statusChip.css` `.wd-chip-reason` — *"CSS truncation only: the FULL text stays in the DOM for AT and copy. Never truncate the string in JS."* | **Deleted both.** See §5.7. |
| `.mx-sr` | `motion.css` `.watchdog .mo-sr` | **Deleted.** (Closes previous open question #6: `styles.css` ships no `sr-only`; motion.css does.) |
| `font-feature-settings` on my value | `motion.css` §9 already applies `lining-nums tabular-nums` to `.watchdog .num` | **Deleted.** Compose `.num`. |
| 10.5 / 11.5 / 12 / 24px, weights 420/430/470/560, `--faint`, `#bd781b`, `#d6a11d` | `docs/design/watchdog/tokens.md` | **All abolished.** See §1. |

And `tokens.md` §1 measured the thing that invalidates the previous round's entire ink layer:

> `--faint` — light **Lc 49.9**, dark **Lc −15.2**. APCA: Lc 15 is where *"designers should treat
> anything below this level as invisible."*
> **Hard rule: no truth-bearing text below Lc 60. `--ink-mute` never carries truth.**

My previous spec rendered the reason a probe is unavailable in `--faint` at 11.5px. In dark
theme that is Lc −15 — the reason was **invisible**, in the one state where it is the only
information on the cell. The panel called this "the lightest ink, at the smallest size, ellipsed"
(defect 9). It was worse than that. It was a truth-doctrine breach expressed as a number.

---

## 1. The scale I am now bound by (`docs/design/watchdog/tokens.md`)

`tokens.md` is the owner of measurement: *"Every other Watchdog element quantises to this file."*

**Spacing** — `--sp-1 2 / --sp-2 4 / --sp-3 6 / --sp-4 8` (intra-component) ·
`--sp-5 12 / --sp-6 16 / --sp-7 24 / --sp-8 32 / --sp-9 48` (inter-component).
*"≤ `--sp-4` is intra-component, ≥ `--sp-5` is inter-component, and nothing exists in between."*
Derived: `--row-h 28`, `--row-h-tight 24`, `--row-h-head 32`, `--gutter-icon 16`.

**Type** — six levels, five sizes, four weights, **integer sizes and even integer line-heights only**:

| | role | size/lh | weight | tracking |
|---|---|---:|---:|---:|
| T1 | page title | 20/26 | 550 | −.014em |
| T2 | section header | 14/20 | 550 | −.006em |
| T3 | column head / micro-label, UPPERCASE | 10/14 | 600 | +.06em |
| T4 | value | 12/16 | 500 | 0 |
| T5 | support / subordinate context (L9) | 11/16 | 450 | +.01em |
| T6 | micro — evidence age, **unit suffix** | 10/14 | 450 | +.015em |

**Ink** — `--ink-1` |Lc| 98 · `--ink-2` 80 · `--ink-3` 64 (truth floor) · `--ink-mute` 48
(*"non-truth only — placeholder, disabled"*).

**Semantic colour** — `--ok` **glyph only, ≤12px, never text, never fill** · `--warn` ink or tint ·
`--bad` tint→solid · `--held` tint only. *"Unknown / unavailable / not-configured have no hue —
`--ink-3` plus a mandatory reason."*

### Two consequences that reshape the element

**(a) There is no headline-number level on this page.** The scale tops out at T1 20px — the page
title. A latency reading is not larger than the page it sits on. The previous spec's 24px value in
a 30px line box was off-scale in both axes and its 30px line box would have clipped descenders
(panel defect 21) — a defect that simply cannot occur once the register is a published level.
**The reading is T1 20/26/550.** That is a 20% reduction from the previous round, and it is the
single change that makes the panel's central critique (defect 6) fixable: at 20px there is room
for the reason to be legible in the same cell; at 30px there is not.

**(b) Weights 450/500/550/600, step 50 — and that is load-bearing, not stylistic.**
`web/index.html` loads **no webfont**; there is no `@font-face` and no `.woff` in the tree
(verified). `--font` declares `"InterVariable", "Inter", "SF Pro Text", -apple-system, …`, so in
practice the app renders on the system fallback, where font-weight snaps to the family's discrete
weights. The panel was right (defect 29): my 420 / 430 / 470 / 560 collapsed to 400 / 400 / 500 /
500 and the "hierarchy from weight" mechanism quietly stopped existing. A 50-point ladder survives
snapping; a 10-point one does not. **Open question to the tokens owner: the webfont is declared and
never loaded — that is a live bug, not my element's to fix.**

---

## 2. References — fetched this round, with the specific mechanic taken

1. **Grafana — Stat visualization** · https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/
   *"When a stat has no data, Grafana displays a hyphen (-)"*, and the text-mode ladder
   (`Auto / Value / Value and name / Name / None`) proving name and value are independently
   addressable registers. Taken: the **occupied-slot rule** — an absent reading holds its slot.
   Explicitly **rejected**: `Background Gradient` / `Background Solid` colour modes. A coloured
   background on a metric is a claim, and this app may not make claims.

2. **Datadog — SLO widget** · https://docs.datadoghq.com/dashboards/widgets/slo/
   *"the SLO widget shows time periods with missing data as '-'… the '-' is displayed for any time
   window where the entire window is missing data."* Two platforms independently converged on the
   hyphen, and Datadog states the reason I needed: it *"provides clear visual distinction between
   absent data and calculated zero-performance scenarios."* Absent ≠ zero. That is the em-dash's
   whole job.

3. **Grafana — Alert rule state and health** · https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/state-and-health/
   The distinction I had implemented only half of. **No Data**: *"the alert rule query runs
   successfully but returns no data points at all."* **Error**: *"the alert rule fails to evaluate
   its query or queries successfully."* They are separate states because they represent
   *"query execution problems rather than threshold breaches."* Taken directly: the panel's defect 3
   is correct, and §5.8's band-level `transport-failed` is this distinction rendered.

4. **Rauno Freiberg — Web Interface Guidelines** · https://interfaces.rauno.me/
   Verbatim: *"tabular figures should be applied with `font-variant-numeric: tabular-nums`,
   particularly in tables or when layout shifts are undesirable, like in timers"*;
   *"Box shadow should be used for focus rings, not outline which won't respect radius"*;
   *"Hover states should not be visible on touch press, use `@media (hover: hover)`"*;
   *"Disabled buttons should not have tooltips, they are not accessible"*;
   *"Font weight should not change on hover or selected state to prevent layout shift."*
   The focus-ring line carries its own precondition — **radius** — which my radius-0 cell does not
   have. See §5.6: I keep the inset ring for a different, better-evidenced reason and I say so.

5. **Vercel — Geist Skeleton** · https://vercel.com/geist/skeleton
   *"Set `width` and `height` to match the final content so the layout doesn't shift when data
   resolves… A 200×20 block becoming an 80×16 string reads as a glitch."*
   *"Skeletons are decorative; avoid placing focusable controls inside them while loading."*
   *"Wrap the loading region in `aria-busy="true"` and announce completion with
   `aria-live="polite"` on the destination container, not the skeleton itself."*
   *"Don't use Skeleton as… a placeholder for empty states."*
   The last two are new to me and both fix real defects (§5.9). The first is the rule my previous
   round quoted and then violated by a factor of 3 (panel defect 12).

6. **W3C — Understanding SC 1.4.4 Resize Text** · https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html
   *"text can be resized without assistive technology up to 200 percent without loss of content or
   functionality"*, and the allowance that makes my truncation legal:
   **"truncation is acceptable if the component's full content is available on focus or after user
   activation."** This is why §5.10 *decides* the cell's destination instead of leaving it open —
   the activation path is load-bearing for conformance, not a nicety.

7. **APCA / Myndex — Easy Intro to APCA** · https://git.apcacontrast.com/documentation/APCAeasyIntro.html
   The readability ladder: Lc 90 for *"fluent text… no smaller than 14px/weight 400"*; Lc 60 needs
   *"24px normal weight (400) or 16px/700"*; Lc 30 is *"the absolute minimum… placeholder text and
   disabled element text"*; Lc 15 is *"the absolute minimum for any non-text that needs to be
   discernible."* Used two ways: it condemns `--faint` outright, **and** it says `--ink-3`'s Lc 64
   at 10px is thinner cover than the number suggests — which is why the metric name takes `--ink-2`
   (§5.2), one step above the house floor, deliberately.

8. **MDN — ARIA live regions** · https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
   *"Start with an empty live region, then – in a separate step – change the content inside the
   region"*; `role="status"` should carry *"a redundant `aria-live="polite"`"*; and `aria-atomic="true"`
   *"ensures that each time the live region is updated, the entirety of the content is announced in
   full"*, with the alternative *"first clear all the contents of the live region… and then inject
   the new content."* This is the concrete repair for panel defect 33 — the previous round's
   `{transition ?? ''}` could neither repeat a transition nor survive two inside one coalescing window.

9. **Adrian Roselli — My Priority of Methods for Labeling a Control** · https://adrianroselli.com/2020/01/my-priority-of-methods-for-labeling-a-control.html
   The order: native HTML → `aria-labelledby` → **visibly-hidden content still in the page** →
   `aria-label`. `aria-label` *"overrides other methods for providing an accessible name"* and
   costs voice-control target matching and automatic translation.
   **This overturns the panel's own fix for defect 30.** The panel said "always compose `aria-label`
   in prose; mark the visible text `aria-hidden`." That reaches for the *lowest*-priority technique
   and detaches the accessible name from the visible one. §5.11 does it with visually-hidden
   expansion spans instead — priority 3, not priority 4.

10. **Nielsen Norman Group — Preattentive Visual Properties in Dashboards** · https://www.nngroup.com/articles/dashboards-preattentive/
    *"There are a variety of visual attributes that people perceive very quickly, without fully
    engaging their attention"* — including **2D position**, of which *"we can also accurately
    estimate position in a 2D space."* And: *"Color should not be used to communicate information
    about quantitative values or magnitude."* This is the empirical warrant for the whole thesis:
    a shared baseline is a *preattentive* channel, so the alignment contract is a perceptual
    mechanism rather than a tidiness preference — and it is why the rail earns its cost while a
    colour ramp on latency would not.

11. **Refactoring UI — 7 practical tips** · https://medium.com/refactoring-ui/7-practical-tips-for-cheating-at-design-40c736799886
    *"try using color or font weight to do the same job"* rather than font size, and the
    de-emphasis principle — *"Making the text closer to the background color is what actually helps
    create hierarchy."* This is L1 restated, and it is the licence for §5.4's level step
    (T5→T4 at a constant 16px line box) instead of pumping the reading larger.

12. **Honeycomb — Handle unruly outliers with log-scale heatmaps** · https://www.honeycomb.io/blog/handle-unruly-outliers-with-log-scale-heatmaps
    *"numbers like min, max, and average can hide important and rich detail"*, and
    *"multimodal data is almost always generated by multiple causes. Processes with singular causes
    tend to produce smooth curves."* Consequence for me: a single latency scalar is lossy by
    construction, so the cell is **obliged to name its reducer and window** rather than presenting a
    bare number as the truth. It is also the technical kill-shot on any sparkline in this band.

13. **Emil Kowalski — What makes a great animation** · https://emilkowal.ski/ui/great-animations
    *"never animate keyboard initiated actions. These actions are repeated sometimes hundreds of
    times a day"*, and *"Before you add an animation, you should also consider how often the user
    will see it."* Taken as a refusal: this element ships **zero transitions and zero keyframes** of
    its own. It also convicts the previous round, which transitioned `box-shadow` — the focus ring —
    for 120ms (panel defect 15), having quoted this exact sentence.

14. **Linear — Dashboards best practices** · https://linear.app/now/dashboards-best-practices
    *"Dashboards built without a specific purpose tend to collect random charts and quickly lose
    their value"*; *"Using consistent, minimal visuals reduces cognitive load."* Used as the
    acceptance test on register 3: every segment must answer *"can I trust this number right now?"*

---

## 3. Four variants — what design variable each one moves

The panel was right that the previous round shipped five variants of which one was the incumbent,
and that none of them questioned the cell's anatomy. These four move anatomy.

### V-A — **Reading Rail** (subgrid; register 2 holds *the reading*, which is not always a number)
*Variables moved:* **alignment mechanism** (CSS subgrid + baseline groups, replacing arithmetic
fixed heights) · **disclosure model** (when there is no number, the consequence sentence takes the
reading register rather than being exiled to the smallest line) · **ownership** (state presentation
delegated wholesale to `<StatusChip>`) · **chrome** (zero; no radius, no shadow, no per-cell fill) ·
**motion** (none of its own).
Three shared subgrid rows: **name / reading / warrant**. Every cell subgrids the same three tracks,
so labels share a baseline, readings share a baseline, warrants share a baseline — enforced by the
layout engine, at any content length, at any text zoom, in either theme.

### V-B — **Verdict Rail** (state-primary — the variant the panel demanded)
*Variables moved:* **which register carries state.** Register 2 holds the *state word* at T1
("Stale", "Unavailable", "Ready"); the number demotes to T4 in register 3 as supporting evidence.
This is what the doctrine literally implies: the trustworthiness is the point, so put it where the
eye lands.

### V-C — **Asymmetric band** (the panel's other demand: hierarchy from inequality)
*Variables moved:* **symmetry.** `2fr 1fr 1fr 1fr`; loop lag as lead at T1 with a full warrant,
the other three at T4 with an age only. Screen 1's lesson — hierarchy comes from making things
unequal — applied to the band itself.

### V-D — **Dense ledger** (Bloomberg move, re-argued)
*Variables moved:* **orientation and density.** The band becomes four stacked `--row-h` (28px) rows
instead of four side-by-side cells: name left, reading right-aligned on **one shared numeric
column**, warrant inline. 4 × 28 + head = ~120px. Note this is *not* the previous round's V4 — a
stacked column genuinely does produce a shared digit origin and true decimal alignment, which four
side-by-side cells never can. The previous round dismissed it with an argument that was wrong.

### The fight

**V-C loses first, and on a principle rather than a preference.** It requires knowing which reading
is the lead — and on a watchdog that changes with the incident. During a transport outage the RTT
cell is the lead; during a build stall the envelope cell is; during a channel failover the delivery
cell is. A statically-privileged cell is the wrong cell exactly when it matters, and the three
demoted cells lose their warrant line — which is where the mandatory reason lives. Screen 1's
unequal-hierarchy lesson governs a form with one primary *action*; these are four independent facts
with no natural primary, and manufacturing one is fabrication of the same species as inventing a
latency budget. L10 says same semantic level = same visual weight; these four are the same
semantic level. Explored, rejected, on the record.

**V-D loses second, and it is a closer call than the previous round admitted.** Its L5 compliance is
real: four numbers stacked in one right-aligned tabular column are genuinely decimal-aligned and
genuinely comparable. That is exactly the problem. **These four quantities are not comparable** — a
loop lag in ms, an envelope build in ms, a transport RTT in ms and a channel *name*. A shared
numeric column is an affordance that invites "which is worst" scanning across four values whose
magnitudes have no relationship, and one of which is not a number at all. L5's *intent* is
comparability; literal L5 compliance here manufactures a false one. Secondly, four 28px rows is
the network-lane table's grammar — the band would become a small table sitting on top of a large
table, and the page already owns that element. Rejected for being the wrong element, not for being
badly built.

**V-B loses third, and this is the fight that mattered.** It is the variant the doctrine implies
and it is the reason panel defect 6 existed, so it got the longest hearing. It loses on two
counts, both external evidence rather than taste:

1. *The largest type on the band would be four identical words, all day.* For three of the four
   readings the state is `READY` in normal operation. Linear's test — a constant answers nothing —
   applied to the T1 register instead of the T5 register. V-B does not solve the noise problem; it
   promotes it to the loudest register on the surface.
2. *It collides head-on with `statusChip.css`, whose own doctrine is that* **"READY is the QUIETEST
   state on the page. A healthy wall spends almost no ink."** Rendering `Ready` at 20px/550 across
   four cells would be the single loudest affirmative claim on an evidence-gated surface — the exact
   christmas tree that element was built to kill, reintroduced one element over.

**But V-B's good idea is correct and survives into the winner.** Its insight is that register 2 is
not "the number slot", it is "the truth slot". The winner takes precisely that and applies it only
where it is true: **when there is no number, the reason takes the reading register.** That is the
structural repair for panel defect 9 — the previous round argued about the em-dash's ink colour when
the real defect was that a 30px em-dash carrying zero information outranked the only sentence on
the cell that carried any.

**Winner: V-A, amended by V-B.**

---

## 4. Where the panel is wrong, proved

Four findings do not survive contact with the files.

**Defect 16 — "Rauno's box-shadow rule does not apply; your radius is 0; use `outline`."**
The precondition critique is right and the conclusion is wrong. The house does not use the inset
ring because of radius. `Health.css:15` — `.healthx-frame { width:100%; overflow:hidden; … }` —
**clips**, and `motion.css` §5 states the actual reason: *"Rows sit inside `.healthx-frame
{ overflow: hidden }`, which CLIPS an outline on the first and last row. Inset ring instead."*
An `outline` with positive `outline-offset` on the band — which is the frame's first child — would
be clipped away on three sides. The ring stays inset.
**The panel's forced-colors half is right and uncovers a bug in the neighbour**: forced-colors mode
drops `box-shadow`, so `motion.css`'s own `@media (forced-colors: active) { .watchdog
.wd-row:focus-visible { box-shadow: inset 0 0 0 2px Highlight } }` **does not render**. §5.6 uses
`outline: 2px solid Highlight; outline-offset: -2px` — negative offset, so it lands inside the clip.
Filed against motion.css.

**Defect 44 — "square 1px corners will show outside the frame's rounded corner."**
No. Verified: `.healthx-frame { overflow: hidden }`. The frame clips. No change.

**Defect 7 — "`FRESH` printed on all four cells is wallpaper; omit the word at rest."**
Diagnosis right, fix wrong, and the neighbour has already litigated it. `StatusChip.tsx`:
*"undefined resolves to UNKNOWN, never to nothing. There is **NO null render path** — an empty
gutter would be indistinguishable from a chip that failed to render (the Grafana #42868 defect)."*
Omitting the word at rest makes "everything is fine" and "the state renderer broke" pixel-identical
— on the one surface that may not do that. The word stays. The noise is answered the way the chip
answers it: `READY` is the cheapest possible rendering (bare, no container, no hue), and the
*escalation* is what carries signal.

**Defect 30 — "always compose `aria-label` in prose; mark the visible text `aria-hidden`."**
Half right. The glyph-soup diagnosis is correct. The fix reaches for the lowest-priority labelling
technique. Roselli: `aria-label` is 4th of 4, it *"overrides other methods"*, and it breaks
voice-control target matching and automatic translation. §5.11 uses priority 3 — visually-hidden
expansion spans inside the button — so the accessible name is the visible name plus expansions, and
"click Loop lag" still works.

---

## 5. The winner, specified

### 5.1 The band and the rail

The thing that fuses four cells into one instrument is an **alignment contract**, not a border —
and NN/g supplies the reason it works: 2D position is *preattentive*, so a shared baseline is read
before attention is engaged.

The previous round asserted the contract in arithmetic (`16+14+6+30+4+16+16 = 102`) and enforced it
nowhere: `min-height` sat on the band, not the cell (panel defect 20), fixed `height` + `overflow:
hidden` clipped at 200% zoom (defect 19), and any cell whose warrant wrapped broke the rail outright.

**The contract is now enforced by the layout engine.** The band declares three rows; each cell
`grid-row: span 3` with `grid-template-rows: subgrid`. All four cells share the same three tracks
by construction. Add `align-items: baseline` and the shared tracks become shared *baselines* —
CSS Grid Level 2 specifies that subgridded items participate in the parent grid's baseline
alignment groups. There is not one fixed pixel height anywhere in the element.

*The contract's only precondition, stated so it cannot be violated accidentally:* a subgrid's own
block padding insets its tracks, so **every cell's `padding-block` must be identical.** Four equal
paddings inset four equal amounts and the rail holds. This is the one rule that would break it.

**Height.** Derived, not asserted: `16 + 14 + 6 + 26 + 6 + 16 + 16 = 100px`. The house band is
`min-height: 102px`, but that 102 was never a contract — `.healthx-summary` pairs it with
`padding: 17px 18px` and `justify-content: center`, i.e. a number chosen to look right on top of
off-grid padding doing the real work. 100 is the first value where **every term is on the published
spacing and type scale.** Two pixels, and no page stacks a Watchdog band against a Health band.
*Open question to the tokens owner: publish `--row-h-band: 100px`, or lift T1's line-height to 28
(`--row-h`) and land on 102?* Recorded rather than silently resolved.

**The container.** Panel defect 42 was correct and worse than stated: nothing in the previous CSS
established `container-type`, and `.watchdog` does not declare one anywhere in the tree (verified),
so every `@container` block was dead and the band would never have wrapped. The wrapper now
declares `container-type: inline-size; container-name: mx` **itself**, and the queries name that
container. The element cannot silently no-op on a page that forgot. Breakpoints 1120 / 620 are
`MetricTiles.css`'s, verbatim — that file is the owner of this band grammar. (`Health.css` uses
920/620 for a different composition; not mine to copy.)

### 5.2 Register 1 — the name

**T3: 10/14/600/+.06em/UPPERCASE, `--ink-2`.** Carries the metric name and nothing else:
`LOOP LAG`, `ENVELOPE BUILD`, `TRANSPORT RTT`, `DELIVERY CHANNEL`. Never the reducer, never the
window, never a parenthetical (L9).

`--ink-2` (Lc 80), not the `--ink-3` the scale assigns to labels. Deliberate, one step above the
house floor, for a reason APCA supplies: Lc 60 is calibrated for *"24px normal weight or 16px/700"*.
At 10px, Lc 64 is thinner cover than the number implies, and the name is permanent truth-bearing
text that identifies which reading you are looking at. Recorded as a deviation with its warrant.

`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. End-ellipsis is correct here and
only here — a name is prose, not an identifier.

### 5.3 Register 2 — the reading

**This register holds the truth, and the truth is not always a number.** Three modes, one register.

**`data-reading="scalar"`** — the number at **T1 20/26/550/−.014em, `--ink-1`**, composing `.num`
(`motion.css` §9 already supplies `lining-nums tabular-nums`; I declare nothing). Unit as an inline
sibling in the same line box at **T6 10/14/450, `--ink-3`, `font-variant-numeric: normal`** — so the
tabular run never picks up the unit's glyphs and the unit never steals weight from the number.

*The jitter fix (panel defect 18, which was correct and is the best catch in the review).*
`tabular-nums` equalises per-glyph advance; it does **not** equalise string width when the digit
count changes. `9.8 → 12.4 → 112.4` moves `ms` sideways on a 1 Hz tick — jitter in the one register
the whole alignment contract exists to protect. Fix: the numeric run sits in
`.mx-num { display:inline-block; min-inline-size: var(--mx-digits); text-align: right }` with
`--mx-digits` set per metric **from the projection's declared display width**, not eyeballed and
not derived from observed values (which would drift). The unit becomes immovable and the decimal
column is stable.
*Cost, stated:* right-alignment inside a fixed box means the reading's left edge is inset from the
name's when the value is shorter than its declared width. Accepted — the rail is the **baselines**,
not the left edges, and a fixed word that jumps every second reads as a glitch. *If the projection
ever ships a fixed-width pre-formatted string, drop `--mx-digits` entirely; it is then redundant.*

**`data-reading="absent"`** — an em-dash at T1 in **`--ink-mute`**. It occupies its slot and claims
nothing (Grafana and Datadog SLO, independently). `--ink-mute` is the token whose published job is
*"non-truth only — placeholder"* — so the demotion is the scale's own vocabulary, not a tweak.
Never blank, never `0`, never `N/A`.

**`data-reading="reason"`** — **V-B's idea, applied where it is true.** When the reading is absent
*and* the state carries a consequence sentence, that sentence renders **in this register**, at
**T4 12/16/500, `--ink-2`**, `-webkit-line-clamp: 2` (32px). The em-dash moves inline ahead of it at
T6 in `--ink-mute` so the slot is still visibly occupied.
This is the structural repair for panel defect 9. The previous round argued about the em-dash's ink
while a 30px glyph carrying zero information outranked the only sentence on the cell that carried
any. Now: **the register renders whatever the truth is.** Because the rows are subgrid, one cell
growing to two lines grows the shared track and all four warrants move down together — the rail
survives its own hardest case.

**Categorical readings are not deformed.** `WebSocket` renders at the same T1/`--ink-1` as `12.4`.
Same semantic level, same visual weight (L10).

*Answering the previous round's open question #2:* **delivery channel is an identity, never a
verdict, and it renders the channel's short name — never a URL.** `ws://edge-3.iad.internal:8443`
does not belong in a 20px register at any truncation. The endpoint lives in the evidence payload the
cell opens. This deletes panel defects 22 and 23 rather than engineering around them, and it means
`midTruncate()` is gone: L8 still governs identifiers, and `statusChip.css` already owns the
implementation (`.wd-chip-reason code`, CSS truncation only, *"Never truncate the string in JS"*).

### 5.4 Register 3 — the warrant: `<StatusChip inline>`

**I own no state presentation.** Register 3 is the neighbouring component. That single change
retires panel defects 1, 2, 4, 5, 8, 11, 25, 35, 45 and 46 at once, because each of them was a
symptom of having built a second, worse state language.

What comes with it: eight glyph topologies at 12px on `currentColor` (survive forced-colors,
survive desaturation); sentence-case labels (*"uppercase in this house is reserved for column
headers and eyebrows; a status is a VALUE"*) — which retires my SCREAMING_SNAKE tokens; the
`REASON_REQUIRED` runtime invariant; the `DEFECT` tone for a state that owes a reason and has none,
*"Deliberately ugly and unmistakable for a real state"*; and hierarchy from **fill** (bare → tinted
→ solid), never hue.

**`STALE` is a modifier, not a peer.** `StatusChip.tsx`: *"a component can be READY and STALE, and
forcing the caller to pick one makes either choice a lie."* The previous round's single flat
`Evidence` enum with `STALE` as a member was wrong on the neighbour's own reasoning. The model is
now `state × stale`, and the chip's demotion rule applies for free: *"A stale chip may never render
the affirmative tone… A stale BLOCKED is still blocked — a proven failure does not soften."*

**The gutter.** `--gutter-icon: 16px` (tokens.md, *"fixed left icon column (L6)"*) holding the
chip's own **12px** glyph. Panel defect 24 was right that 6-in-12 was neither a gutter nor a hang;
the answer was not to pick a number but to use the published gutter and the published glyph size.
Defect 25 — three shapes indistinguishable at 6px, with hue silently doing the work — is retired by
construction: eight topologies at 12px, all on one `currentColor`, verifiable by desaturating a
screenshot.

**The warrant's content**, in the chip's `reason` slot, fixed order, `·`-separated:

```
[scope]                       p95 · 60s          — omitted entirely if the projection ships no reducer
[age]                         2s ago             — omitted when the age is not computable
[consequence]                 <sentence>         — required whenever the state owes one
```

Resting: `[Ready] p95 · 60s · 2s ago`. The chip renders `Ready` as its cheapest possible object —
bare, no container, no hue.

*The one deliberate escalation.* When the state is anything other than the quiet default, the
warrant steps **T5 → T4** (11/16/450/+.01em → 12/16/500/0) and **`--ink-3` → `--ink-2`**. Both are
published levels; both have a **16px line-height**, so the step costs **zero vertical reflow** and
the rail is untouched.
*Why this is legal against tokens.md's "states never change weight (prevents layout shift)":* that
rule protects a value inside a dense row whose neighbours would shift. The warrant is the terminal
register on its own line, with the full cell inline-size and nothing after it — its growth displaces
nothing. And it fires on a **state transition**, which is rare, not on the 1 Hz tick. *It would be
wrong if the warrant were ever placed inline with a sibling to its right; if that happens, this
step must be deleted, not adjusted.*
This is panel defect 6 answered in the mechanism the reference screens teach: **hierarchy from
weight and ink, geometry unchanged** (Refactoring UI: *"try using color or font weight to do the
same job"*).

### 5.5 Consequence microcopy — panel defect 8, conceded in full

`SUPERVISOR_ENVELOPE_NOT_MOUNTED` is a machine enum. The previous round defended it as
"verbatim, never softened," which conflated *translating* with *softening* — a false dichotomy that
licensed the laziest possible string and called it rigour. Against
*"Don't send Bitcoin on any other network or it may be lost,"* it is not microcopy at all.

An exhaustive `reasonCode → sentence` map, with the raw code surviving verbatim in the evidence
payload the cell opens. Fidelity preserved; consequence stated. Unmapped codes fall through to the
raw enum **and are logged** — the fallback is visible, never silent.

| code | rendered |
|---|---|
| `SUPERVISOR_ENVELOPE_NOT_MOUNTED` | Not measured — the supervisor envelope isn't mounted. |
| `PROBE_NOT_REGISTERED` | Not measured — no probe is registered for this metric. |
| `TRANSPORT_DOWN` | Not measured — the transport is down, so round-trip can't be timed. |
| `CLOCK_SKEW_DETECTED` | Age unknown — clocks disagree, so this reading may be old. |
| `NO_SAMPLE_YET` | First sample expected within 60s. |
| *(unmapped)* | `Server sent an unmapped reason: <CODE>` + `console.warn` |

Both of the panel's specific catches (defect 10) are conceded: *"waiting for first advance"* merely
restated *"no sample yet"*, and *"age not computable"* named the engineering fact while omitting the
consequence — **the reader's loss is that the reading may be old**, and that is now what it says.

### 5.6 Colour law, focus, motion

**Colour on a reading means "we have evidence and the evidence is bad." Absence of colour never
means good. There is no green on a reading, ever.** `--ok` is not referenced on register 2 in any
state. tokens.md permits `--ok` on a ≤12px glyph, and the chip's `READY` glyph is exactly that — but
**this element narrows it: the resting glyph stays hueless.** Reason: the chip's `--ok` means
*"proven healthy"*, a claim about the system. My input is a **freshness/quality fact**, not a health
verdict, and rendering "the evidence arrived" in the token that means "the system is well" silently
conflates two different truths. A deliberate narrowing of a shared vocabulary, documented so the
next author does not "fix" it toward the chip.
Panel defect 11 conceded: **colour is spent once.** In an adverse state the ink lands on the
reading; the chip's own fill ladder carries the rest. Glyph and word do not each independently
re-encode the same boolean.

**Focus.** `outline: none; box-shadow: inset 0 0 0 2px var(--mo-ring)` — the frame clips outlines
(§4). **No transition** (Emil, verbatim). `@media (forced-colors: active)` swaps to
`outline: 2px solid Highlight; outline-offset: -2px`, because forced-colors drops `box-shadow`.

**Hover.** `@media (hover: hover) and (pointer: fine)`, `background: var(--hover)`, **no
transition in or out** — motion.css's rule and its reason: *"a 90ms background fade across a dense
table leaves a three-row comet trail on a fast traverse."* Scoped to `button.mx-cell` so a skeleton
never lights up under the cursor and never shows a hand (panel defect 14).
*Panel defect 39 conceded and fixed properly:* the previous round picked `--tile` from a dark-only
calculation. `--hover` is `#f7f8fa` light / `#171b21` dark, and it is what `motion.css` already uses
for the row hover on this exact surface. Using the house's own hover token on the house's own band
surface is the answer; inventing a per-theme token was the previous round's error.

**Motion.** This element ships **no transition and no keyframe of its own.** Its only moving part is
motion.css's change mark, which is a *state with a transition* rather than an animation — so
`prefers-reduced-motion` deletes the fade and keeps every bit of information (motion.css M4).
The value-change flash was designed and cut in round 1 and stays cut.

### 5.7 Changed-since-last-poll — deleted and inherited

The previous round's `.mx-unread` 6px `--accent` dot is gone. Panel defect 26 was right — two 6px
dots with different meanings, 100px apart, after three paragraphs explaining they were different
registers.

`motion.css` already owns this signal and owns it better. The cell carries `class="wd-row"` and
`data-changed`; motion.css draws a **2px × 14px bar** in a reserved 12px inline-start track. Utterly
distinct primitive from a 12px glyph. Its lifetime is *"the poll interval, not a number I chose"* —
so panel defects 31 and 32 dissolve: there is no 400ms dwell to implement, no clearing on transient
focus, and a keyboard user Tabbing across the band is no longer punished by having the information
destroyed before it can be perceived. The mark also self-clears under
`[data-feed="stale"|"dead"|"held"]`, so a stalled poll can never leave a lying "just changed" mark.
Track geometry: the mark centres at 5px from the cell's inline start, inside the cell's 16px
`padding-inline` — 4px clearance from the first glyph, no collision, no reflow.
For AT: a visually-hidden `Changed` inside the button (Roselli priority 3), since a `::before` is
invisible to a screen reader.

### 5.8 Band-level states — the whole missing layer

Panel defects 3, 52 and 53 were the most valuable finding in the review, and they are one thing: the
previous element had **no concept of a fact that is true of the band rather than of a cell.** A dead
projection rendered as four independent `UNAVAILABLE` cells, each politely reciting a reason the
server never sent — a fabrication produced by the element's own shape.

A `<p class="mx-band-note">` spanning `grid-column: 1 / -1` below the rail, present **only** in
these states, `border-block-start: 1px solid var(--line-2)`, `--row-h-tight` (24px), T4/`--ink-2`:

| band state | trigger | rendering |
|---|---|---|
| `transport-failed` | the projection could not be reached at all | four em-dashes; every chip **`UNKNOWN`** (not `UNAVAILABLE` — we did not ask and get refused, we could not ask); spanning note replaces all four warrants: **`Cannot reach the projection · last successful read 4m ago · retrying`** |
| `shared-cause` | ≥3 cells report the same `reasonCode` | the shared sentence hoists to the note; per-cell chips carry only what differs |
| `shared-stale` | the whole projection last advanced N ago | the age hoists to the note; cells annotate only their own deviation |

`transport-failed` is Grafana's **Error** vs **No Data** distinction rendered — *"the alert rule
fails to evaluate its query"* vs *"runs successfully but returns no data points."* Conflating them
is the bug, and one spanning line is visually unmistakable against four independent per-cell
warrants.

*Guard, so the layer cannot itself fabricate:* the band never **derives** `transport-failed` from
four coincident cell failures. It renders it only when the fetch layer reports that the projection
was unreachable. Four cells that each independently report `UNAVAILABLE` with the same reason are
`shared-cause`, which is a different sentence.

### 5.9 Loading

- Skeletons render from a **static four-entry descriptor constant**, never from `cells` — panel
  defect 13 was correct and consequential: mapping over the payload at first paint renders zero
  skeletons when `cells` is `[]`, collapsing the band to a bare rule and then popping four cells in.
  That is precisely the layout shift the skeleton exists to prevent.
- Per-register bar widths come from that descriptor — `--mx-sk-name` from the authored label length,
  `--mx-sk-read` from the metric's declared digit width, `--mx-sk-warrant` from its typical warrant.
  Panel defect 12 was right and its diagnosis was sharper than the defect: `4ch / 6ch / 12ch` were
  eyeballed numbers wearing `ch` units so they would *look* derived. `DELIVERY CHANNEL` is ~16ch,
  not 4. Nothing about these four metrics is unknown at build time.
- Cells render as `<div>`, never `<button>` (Vercel: *"avoid placing focusable controls inside
  them"*). All interactivity is scoped to `button.mx-cell`.
- `aria-busy="true"` on the band, plus a visually-hidden `Loading Watchdog metrics` so a screen
  reader does not land on a labelled group containing nothing (defect 34). Completion is announced
  on the destination container, not the skeleton (Vercel).
- Radius 0, **no shimmer, ever**.
- Vercel's other rule, honoured: *"Don't use Skeleton as a placeholder for empty states."* A metric
  with no data is not loading — it is `absent`, and it renders the em-dash.

### 5.10 Interaction — the destination is decided

Panel defect 54 was right: shipping four `<button>`s with hover and focus rings whose result is
"the page owner's call" is a promise the page may not keep.

**Activating a cell opens that metric's evidence in the page's `.mo-payload`** — which
`motion.css` already ships, with intent timing, a velocity gate, and keyboard opening at 0ms
(*"a keystroke already declared intent"*). It carries the raw `reasonCode`, the full channel
endpoint, and the untruncated reason.

This is load-bearing for conformance, not decoration: SC 1.4.4's allowance is that
*"truncation is acceptable if the component's full content is available on focus or after user
activation."* No activation path, no allowance.

**Rule: `interactive = evidenceAvailable`.** A metric with no evidence payload renders as a `<div>`
— not a dead button. A control that might do nothing is worse than no control.

**The `UNAVAILABLE` cell is never disabled and never gets `aria-disabled`.** Its reason is its whole
reason to exist, and a disabled control leaves the tab order — Rauno: *"Disabled buttons should not
have tooltips, they are not accessible."* (Kept from round 1; the panel agreed.)

### 5.11 Accessibility

**Accessible name via Roselli priority 3, not 4** (§4). The button's name is its own text; purely
typographic separators are `aria-hidden`; abbreviations carry visually-hidden expansions:

```
Loop lag, 12.4 milliseconds. Ready. 95th percentile over 60 seconds, 2 seconds ago.
```

No `aria-label` anywhere in the element. Voice control ("click Loop lag") still matches, and the
text still translates.

**Live region.** The band is `aria-live="off"` — announcing a 1 Hz latency tick is torture. One
sibling `<p role="status" aria-live="polite" aria-atomic="true" class="mo-sr">` announces **state
transitions only**, in full sentences. Per MDN: it is rendered **empty on mount** and filled in a
separate step; `aria-atomic="true"` so a repeated identical transition still announces; and
transitions are queued with a monotonic key so two inside one coalescing window do not collapse to
one (defect 33).

**Contrast.** Every ink traces to a token measured in tokens.md against the worst-case surface, in
both themes. `--faint` is not referenced. `--ink-mute` appears exactly once — on the em-dash, which
is a placeholder and not truth, which is that token's published job.

**RTL.** Logical properties throughout: `padding-inline`, `border-inline-start`,
`inset-inline-start`, `margin-inline-start`. No physical inset survives.

**Text scaling.** No fixed `height`, no `overflow: hidden` on a text register in the block axis. At
200% the registers grow and the rail holds, because the rows are shared subgrid tracks rather than
arithmetic.

---

## 6. Refinement pass — what got cut on the last read

- **`--mx-gap-vn` reused as the unit's horizontal margin** (defect 27). Gone: `--sp-2` is used
  directly on both axes because it is a scale value, not a re-purposed vertical rhythm variable.
  Retuning one axis can no longer move the other.
- **`--mx-flag-reserve: 14px`, undeclared as `6 + 8`** (defect 28). Gone with the unread dot.
- **Two hardcoded ambers copied out of `Health.css`** (defect 40). Gone. tokens.md counted **17
  distinct amber hex literals** across page CSS spanning **Lc 34.5 → 85.4** — L10 violated by 2.5×.
  This element ships zero hex literals and references `--warn`.
- **`color-mix()` with no fallback** (defect 43). `background: var(--panel); background:
  color-mix(…)`.
- **The `[data-quality="UNKNOWN"]` no-op rule that only existed to create a specificity collision
  with `[data-evidence="STALE"]`** (defect 4). Gone with the whole hand-rolled cascade; the chip
  resolves one tone from one input.
- **Third radius.** Still none of mine: the cell is radius 0, and the only radius inside it is the
  chip's `--r-sm`, which is the house's data-container language (L2 satisfied — one action radius,
  one data-container radius, and the cell is not a container).

---

## 7. The final question: best, or merely finished?

The honest answer is that this round is *smaller* than the last one, and that is the improvement.
Round 1's failure mode was building a complete parallel universe — its own state words, its own
marks, its own truncation, its own screen-reader utility, its own ambers — and defending each piece
individually. Every one of those was worse than the thing already in the repo.

What is genuinely mine after this round: the rail (subgrid + shared baselines), the reading
register's three modes and the rule that the reason takes the register when there is no number,
the numeric width lock, the band-level fact layer, and the refusal of green on a reading. Five
things. That is what one element should be.

The two open risks I will not paper over: **(1)** the band's derived 100px vs the house's asserted
102px needs the tokens owner's ruling; **(2)** the app declares `InterVariable` and loads no
webfont, so every weight in every Watchdog element is currently snapping to a system fallback —
which is survivable on a 50-point ladder and was fatal on round 1's 10-point one, but it is a live
bug and somebody owns it.

---

## 8. CSS — `web/src/features/watchdog/styles/metricCell.css`

```css
/* ═════════════════════════════════════════════════════════════════════════
   Watchdog — headline metric cluster.  Round 2.

   THE RAIL IS ENFORCED BY THE LAYOUT ENGINE, NOT BY ARITHMETIC.
   The band declares three rows; every cell subgrids the same three tracks and
   baseline-aligns into them. Labels share a baseline, readings share a
   baseline, warrants share a baseline — at any content length, at any text
   zoom, in either theme. There is not one fixed pixel height in this file.

   PRECONDITION, and the only way to break it: a subgrid's block padding insets
   its tracks, so EVERY CELL'S padding-block MUST BE IDENTICAL.

   COLOUR LAW: colour on a reading means "we have evidence and the evidence is
   bad." Absence of colour never means good. --ok and --up are not referenced.
   The browser never derives readiness (lib/productIntegration/model.ts:210).

   NOT IN THIS FILE, ON PURPOSE — owned by neighbours, composed not copied:
     state word / glyph / tone  -> features/watchdog/StatusChip.tsx
     changed-since-last-poll    -> styles/motion.css  (.wd-row + data-changed)
     tabular figures            -> styles/motion.css §9 (.watchdog .num)
     focus ring token           -> styles/motion.css  (--mo-ring)
     sr-only                    -> styles/motion.css  (.mo-sr)
     identifier truncation      -> styles/statusChip.css (.wd-chip-reason)
   ═══════════════════════════════════════════════════════════════════════ */

/* ---- 0. scale bridge — TEMPORARY -----------------------------------------
   docs/design/watchdog/tokens.md owns every number below and is a landed SPEC,
   not landed CSS: --sp-*, --ink-*, --warn, --gutter-icon are NOT yet defined in
   styles.css (verified). Values quoted from tokens.md §7.1/§7.3/§7.4.
   DELETE THIS BLOCK the day tokens.md lands. It must never become a second
   source of truth — that is the defect that produced 17 ambers spanning Lc 51. */
:root,
[data-theme="light"] {
  --sp-2:  4px;  --sp-3:  6px;  --sp-6: 16px;
  --row-h-tight: 24px;
  --ink-1: #181e2b;  --ink-2: #4d566a;  --ink-3: #717b8d;  --ink-mute: #969ba7;
  --warn:  #8f5d07;  --bad:   #c62b39;
}
[data-theme="dark"] {
  --ink-1: #f1f3f8;  --ink-2: #d2d7df;  --ink-3: #b6bcc7;  --ink-mute: #989fab;
  --warn:  #e6b44f;  --bad:   #ffa8b3;
}

/* ---- 1. wrapper: owns its own query container ---------------------------
   Round 1 shipped @container blocks and nothing in the tree declared a
   container — every one of them was dead and the band would never have
   wrapped. The element now supplies the container itself and names it, so it
   cannot silently no-op on a page that forgot. */
.watchdog .mx {
  container-type: inline-size;
  container-name: mx;
}

/* ---- 2. band ------------------------------------------------------------
   100px = 16 + 14 + 6 + 26 + 6 + 16 + 16. Every term is on the published
   spacing/type scale. The house 102 was min-height paired with 17px padding
   and justify-content:center — a number chosen to look right, never a
   contract. See §5.1: open for the tokens owner to rule on. */
.watchdog .mx-band {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: auto auto auto;
  row-gap: 0;                    /* register margins carry the rhythm, so a
                                    wrapped row's hairline stays clean */
  column-gap: 0;
  min-block-size: 100px;
  border-block: 1px solid var(--line-2);
  background: var(--panel);      /* fallback first */
  background: color-mix(in srgb, var(--tile) 44%, var(--panel));
}

/* ---- 3. cell ------------------------------------------------------------ */
.watchdog .mx-cell {
  grid-row: span 3;
  display: grid;
  grid-template-rows: subgrid;   /* THE alignment contract */
  align-items: baseline;         /* Grid L2: subgridded items join the parent's
                                    baseline groups, so the rail is baselines
                                    and not box tops */
  min-inline-size: 0;
  padding-block: var(--sp-6);    /* IDENTICAL ON EVERY CELL — see precondition */
  padding-inline: var(--sp-6);
  margin: 0;
  border: 0;
  border-radius: 0;              /* the frame owns 12px; never a third radius */
  background: transparent;
  box-shadow: none;
  color: inherit;
  font: inherit;
  text-align: start;
  appearance: none;
}

.watchdog .mx-cell + .mx-cell { border-inline-start: 1px solid var(--line-2); }

/* Browsers without subgrid keep the rail approximately, via min-block-size —
   never `height`, so 200% text zoom grows instead of clipping (SC 1.4.4). */
@supports not (grid-template-rows: subgrid) {
  .watchdog .mx-cell { display: flex; flex-direction: column; }
  .watchdog .mx-name    { min-block-size: 14px; }
  .watchdog .mx-reading { min-block-size: 26px; }
  .watchdog .mx-warrant { min-block-size: 16px; }
}

/* Interactivity is scoped to the ELEMENT that is actually interactive, so a
   skeleton never shows a hand and never lights up under the cursor. */
.watchdog button.mx-cell { cursor: pointer; }

/* No transition, in or out (motion.css: a background fade across a dense
   surface leaves a comet trail on a fast traverse). --hover is the house's own
   hover token, already used by motion.css on this exact surface. */
@media (hover: hover) and (pointer: fine) {
  .watchdog button.mx-cell:hover { background: var(--hover); }
}

/* Inset ring because .healthx-frame { overflow: hidden } CLIPS an outline on
   the frame's first child — NOT because of radius (this cell has none).
   Never transitioned: "never animate keyboard initiated actions." */
.watchdog .mx-cell:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--mo-ring);
  transition: none;
}

/* ---- 4. register 1 — the name ------------------------------------------
   T3, but at --ink-2 rather than the scale's --ink-3: APCA calibrates Lc 60
   for 24px/400 or 16px/700, so Lc 64 at 10px is thinner cover than it looks,
   and the name is permanent truth-bearing text. Deliberate, one step up. */
.watchdog .mx-name {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: .06em;
  text-transform: uppercase;
  text-overflow: ellipsis;       /* end-ellipsis: correct here and ONLY here.
                                    A name is prose; an identifier is not. */
  white-space: nowrap;
}

/* ---- 5. register 2 — the reading ---------------------------------------
   This register holds the TRUTH, and the truth is not always a number. */
.watchdog .mx-reading {
  min-inline-size: 0;
  margin-block-start: var(--sp-3);
  color: var(--ink-1);
  font-size: 20px;               /* T1. There is no larger level on this page:
                                    a latency reading is not louder than the
                                    page title. */
  font-weight: 550;
  line-height: 26px;
  letter-spacing: -.014em;
  white-space: nowrap;
}

/* tabular figures arrive from motion.css §9 via .num — not redeclared here.
   min-inline-size is what tabular-nums CANNOT do: it holds the string width
   when the DIGIT COUNT changes, so `ms` cannot slide on a 1 Hz tick.
   --mx-digits comes from the projection's declared display width. */
.watchdog .mx-num {
  display: inline-block;
  min-inline-size: var(--mx-digits, auto);
  text-align: right;
}

.watchdog .mx-unit {
  margin-inline-start: var(--sp-2);
  color: var(--ink-3);
  font-size: 10px;               /* T6 — the scale's declared "unit suffix" */
  font-weight: 450;
  line-height: 14px;
  letter-spacing: .015em;
  font-variant-numeric: normal;  /* keep tabular metrics off the unit glyphs */
}

/* Absent: occupies the slot, claims nothing. --ink-mute is the token whose
   published job is "non-truth only — placeholder", so the demotion is the
   scale's own vocabulary rather than a tweak. Never blank, never 0, never N/A. */
.watchdog .mx-reading[data-reading="absent"] { color: var(--ink-mute); }

/* The reason takes the reading register when there is no number. A 26px glyph
   carrying zero information must not outrank the only sentence on the cell
   that carries any. Subgrid grows the shared track, so all four warrants move
   down together and the rail survives its hardest case. */
.watchdog .mx-reading[data-reading="reason"] {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 12px;               /* T4 */
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0;
  white-space: normal;
}
.watchdog .mx-reading[data-reading="reason"] .mx-dash {
  margin-inline-end: var(--sp-2);
  color: var(--ink-mute);
  font-size: 10px;
}

/* THE ONLY COLOURED READING STATES. Server verdict, never client-derived.
   There is no --ok and no --up in this file: a latency under budget is not
   "healthy", it is a number, and a green resting band is a continuous
   unproven claim. */
.watchdog .mx-reading[data-tone="warn"] { color: var(--warn); }
.watchdog .mx-reading[data-tone="bad"]  { color: var(--bad); }

/* ---- 6. register 3 — the warrant: <StatusChip inline> ------------------
   I own no state presentation. The chip supplies the glyph topology, the
   sentence-case word, the fill ladder, the DEFECT tone and forced-colors
   survival. All this file does is set its size and step its reason. */
.watchdog .mx-warrant { min-inline-size: 0; margin-block-start: var(--sp-3); }

.watchdog .mx-warrant .wd-status--inline { --wd-fs: 11px; --wd-lh: 16px; }

/* resting — T5 at the truth floor */
.watchdog .mx-warrant .wd-chip-reason {
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 450;
  line-height: 16px;
  letter-spacing: .01em;
}

/* escalated — T5 -> T4. Both are published levels and BOTH HAVE line-height
   16px, so the step costs zero vertical reflow and the rail is untouched.
   Legal against "states never change weight" because the warrant is the
   terminal register on its own line and displaces nothing, and because it
   fires on a state transition, not on the 1 Hz tick. If this register is ever
   given a sibling to its inline-end, DELETE this rule rather than tune it. */
.watchdog .mx-cell[data-quiet="false"] .mx-warrant .wd-chip-reason {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0;
}

/* ---- 7. band-level fact: one line, spanning ---------------------------
   A fact that is true of the BAND, not of a cell. Four cells each reciting a
   reason the server never sent is a fabrication produced by the element's own
   shape. Present ONLY in transport-failed / shared-cause / shared-stale. */
.watchdog .mx-band-note {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: var(--sp-2);
  min-block-size: var(--row-h-tight);
  margin: 0;
  padding-inline: var(--sp-6);
  border-block-start: 1px solid var(--line-2);
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}

/* ---- 8. loading --------------------------------------------------------
   Bar widths come from a STATIC per-metric descriptor set inline, never from
   the payload — nothing about these four metrics is unknown at build time,
   and round 1's 4ch/6ch/12ch were eyeballed numbers wearing ch units.
   Radius 0 (text has no radius, the cell has no radius). No shimmer, ever. */
.watchdog .mx-band[aria-busy="true"] :is(.mx-name, .mx-reading, .mx-warrant) {
  border-radius: 0;
  background: color-mix(in srgb, var(--ink-1) 8%, transparent);
  color: transparent;
}
.watchdog .mx-band[aria-busy="true"] .mx-name    { inline-size: var(--mx-sk-name); }
.watchdog .mx-band[aria-busy="true"] .mx-reading { inline-size: var(--mx-sk-read); }
.watchdog .mx-band[aria-busy="true"] .mx-warrant { inline-size: var(--mx-sk-warrant); }

/* ---- 9. wrapping — MetricTiles.css's breakpoints, against a real container
   Each wrapped row is its own rail: cells 1-2 subgrid rows 1-3, cells 3-4
   subgrid rows 4-6. Two independent rails, both exact. */
@container mx (max-width: 1120px) {
  .watchdog .mx-band { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .watchdog .mx-cell:nth-child(odd)   { border-inline-start: 0; }
  .watchdog .mx-cell:nth-child(n + 3) { border-block-start: 1px solid var(--line-2); }
}
@container mx (max-width: 620px) {
  .watchdog .mx-band { grid-template-columns: minmax(0, 1fr); }
  .watchdog .mx-cell                  { border-inline-start: 0; }
  .watchdog .mx-cell:nth-child(n + 2) { border-block-start: 1px solid var(--line-2); }
}

/* ---- 10. forced colors ------------------------------------------------
   forced-colors DROPS box-shadow, so motion.css's own
   `box-shadow: inset 0 0 0 2px Highlight` focus fallback does not render —
   filed against that file. outline IS honoured; negative offset keeps it
   inside .healthx-frame's clip. */
@media (forced-colors: active) {
  .watchdog .mx-cell:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: -2px;
    box-shadow: none;
  }
  .watchdog .mx-band[aria-busy="true"] :is(.mx-name, .mx-reading, .mx-warrant) {
    border: 1px solid CanvasText;
    background: Canvas;
  }
}

/* ---- 11. motion --------------------------------------------------------
   This element ships NO transition and NO keyframe of its own. Its only
   moving part is motion.css's change mark, which is a state with a transition
   rather than an animation — so prefers-reduced-motion deletes the fade and
   keeps every bit of the information. Nothing to disable here.
   The value-change flash was designed in round 1 and cut. It stays cut. */
```

---

## 9. Markup — `web/src/features/watchdog/MetricBand.tsx`

```tsx
import { StatusChip, type WatchdogState } from './StatusChip';
import './styles/metricCell.css';

/* ── The four metrics are known at build time. Skeleton widths, digit widths
      and labels all come from HERE and never from the payload — rendering
      skeletons from `cells` means zero skeletons when cells is [], which is
      exactly the layout shift the skeleton exists to prevent. */
export const MX_DESCRIPTORS = [
  { id: 'loopLag',     name: 'LOOP LAG',         digits: '5ch', sk: ['8ch',  '5ch', '20ch'] },
  { id: 'envelope',    name: 'ENVELOPE BUILD',   digits: '5ch', sk: ['14ch', '5ch', '20ch'] },
  { id: 'transport',   name: 'TRANSPORT RTT',    digits: '5ch', sk: ['13ch', '5ch', '20ch'] },
  { id: 'deliveryCh',  name: 'DELIVERY CHANNEL', digits: null,  sk: ['16ch', '9ch', '18ch'] },
] as const;

/* ── Consequence microcopy (L7). Round 1 shipped the raw enum and called it
      rigour; translating is not softening. The raw code survives verbatim in
      the evidence payload the cell opens. Unmapped codes fall through
      VISIBLY and are logged — never silently. */
const REASON: Record<string, string> = {
  SUPERVISOR_ENVELOPE_NOT_MOUNTED: "Not measured — the supervisor envelope isn't mounted.",
  PROBE_NOT_REGISTERED:            'Not measured — no probe is registered for this metric.',
  TRANSPORT_DOWN:                  "Not measured — the transport is down, so round-trip can't be timed.",
  CLOCK_SKEW_DETECTED:             'Age unknown — clocks disagree, so this reading may be old.',
  NO_SAMPLE_YET:                   'First sample expected within 60s.',
};
function consequence(code: string | null): string | null {
  if (!code) return null;
  const mapped = REASON[code];
  if (mapped) return mapped;
  console.warn(`[MetricBand] unmapped reasonCode: ${code}`);
  return `Server sent an unmapped reason: ${code}`;
}

/* ── The chip's vocabulary is the ONLY state vocabulary. STALE is a MODIFIER,
      never a peer: a reading can be READY *and* STALE, and forcing the caller
      to pick one makes either choice a lie (StatusChip.tsx). */
const KNOWN: ReadonlySet<string> = new Set<WatchdogState>([
  'READY', 'DEGRADED', 'BLOCKED', 'UNAVAILABLE', 'UNKNOWN', 'NOT_CONFIGURED', 'OWNER_GATED',
]);

export interface MetricModel {
  readonly id: string;
  readonly state: string;            // WIRE value — validated, never trusted
  readonly stale: boolean;
  readonly reasonCode: string | null;
  readonly value: string | null;     // '12.4' | 'WebSocket' | null
  readonly unit: string | null;      // 'ms' | null — the channel cell has none
  readonly unitSpoken: string | null;// 'milliseconds'
  readonly reducer: string | null;   // 'p95'  — printed, never assumed (Honeycomb)
  readonly reducerSpoken: string | null;
  readonly window: string | null;    // '60s'
  readonly ageLabel: string | null;  // '2s ago' — NULL when not computable
  readonly tone: 'neutral' | 'warn' | 'bad';   // server verdict. never 'ok'.
  readonly changed: boolean;
  readonly evidenceAvailable: boolean;
}

const SEP = <span aria-hidden="true"> · </span>;   /* typographic, never spoken */

function MetricCell({ m, d, onOpen }: {
  m: MetricModel;
  d: (typeof MX_DESCRIPTORS)[number];
  onOpen: (id: string) => void;
}) {
  /* Fail CLOSED. A projection field is a network value, not a type: an
     unrecognised string must never fall through to the healthiest rendering.
     (StatusChip's own TONE map indexes undefined for an unknown string — a
     fail-open in the neighbour, filed separately. Guarded here.) */
  const state = (KNOWN.has(m.state) ? m.state : 'UNKNOWN') as WatchdogState;
  const unrecognised = !KNOWN.has(m.state);

  const sentence = unrecognised
    ? `Server sent an unrecognised state: ${m.state}`
    : consequence(m.reasonCode);

  const absent  = m.value === null;
  const asReason = absent && sentence !== null;
  const quiet    = state === 'READY' && !m.stale && m.tone === 'neutral' && !unrecognised;

  /* The chip's reason slot: scope · age · consequence. Scope is OMITTED when
     the projection ships no reducer — never assumed. Age is omitted when it is
     not computable — a number is never printed where the age goes. */
  const warrant = (
    <>
      {m.reducer && (<>
        <span aria-hidden="true">{m.reducer}</span>
        <span className="mo-sr">{m.reducerSpoken ?? m.reducer}</span>
        {m.window && (<>{SEP}<span aria-hidden="true">{m.window}</span>
          <span className="mo-sr">over {m.window}</span></>)}
      </>)}
      {m.ageLabel && (<>{m.reducer && SEP}{m.ageLabel}</>)}
      {sentence && !asReason && (<>{(m.reducer || m.ageLabel) && SEP}{sentence}</>)}
    </>
  );

  /* A control that might do nothing is worse than no control. No evidence
     payload -> not a button. Round 1 shipped four buttons whose destination
     was "the page owner's call". */
  const Tag = (m.evidenceAvailable ? 'button' : 'div') as 'button' | 'div';

  return (
    <Tag
      className="mx-cell wd-row"
      {...(m.evidenceAvailable
        ? { type: 'button' as const, onClick: () => onOpen(m.id) }
        : {})}
      data-quiet={quiet}
      data-changed={m.changed || undefined}
      style={{ ['--mx-digits' as string]: d.digits ?? undefined }}
      /* NO aria-label anywhere. Roselli's priority 3 (visibly-hidden content
         still in the page) beats priority 4 (aria-label, which overrides the
         visible name and costs voice-control matching and translation). */
    >
      <span className="mx-name">{d.name}</span>

      {asReason ? (
        <span className="mx-reading" data-reading="reason">
          <span className="mx-dash" aria-hidden="true">—</span>
          <span className="mo-sr">No reading. </span>
          {sentence}
        </span>
      ) : absent ? (
        <span className="mx-reading" data-reading="absent">
          <span aria-hidden="true">—</span>
          <span className="mo-sr">No reading</span>
        </span>
      ) : (
        <span className="mx-reading" data-reading="scalar" data-tone={m.tone}>
          <span className="mx-num num">{m.value}</span>
          {m.unit && (<>
            <span className="mx-unit" aria-hidden="true">{m.unit}</span>
            <span className="mo-sr"> {m.unitSpoken ?? m.unit}</span>
          </>)}
        </span>
      )}

      <span className="mx-warrant">
        <StatusChip state={state} stale={m.stale} reason={warrant} inline />
      </span>

      {m.changed && <span className="mo-sr">, changed since last poll</span>}
    </Tag>
  );
}

export function MetricBand({ cells, loading, band, transitions, onOpen }: {
  cells: readonly MetricModel[];
  loading: boolean;
  band: null | { kind: 'transport-failed' | 'shared-cause' | 'shared-stale'; text: string };
  transitions: readonly { key: number; text: string }[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="mx">
      <div
        className="mx-band"
        role="group"
        aria-label="Watchdog headline metrics"
        aria-busy={loading || undefined}
        aria-live="off"   /* deliberate: announcing a 1 Hz tick is torture */
      >
        {loading ? (
          <>
            <span className="mo-sr">Loading Watchdog metrics</span>
            {MX_DESCRIPTORS.map((d) => (
              /* <div>, never <button>: "skeletons are decorative; avoid
                 placing focusable controls inside them while loading" */
              <div className="mx-cell" key={d.id} aria-hidden="true" style={{
                ['--mx-sk-name' as string]: d.sk[0],
                ['--mx-sk-read' as string]: d.sk[1],
                ['--mx-sk-warrant' as string]: d.sk[2],
              }}>
                <span className="mx-name" /><span className="mx-reading" /><span className="mx-warrant" />
              </div>
            ))}
          </>
        ) : (
          MX_DESCRIPTORS.map((d) => {
            const m = cells.find((c) => c.id === d.id);
            return m ? <MetricCell key={d.id} m={m} d={d} onOpen={onOpen} /> : null;
          })
        )}

        {/* A fact true of the BAND, not of a cell. transport-failed is
            Grafana's Error (could not evaluate) vs No Data (evaluated, empty).
            NEVER derived from four coincident cell failures — that is
            shared-cause, a different sentence. */}
        {band && <p className="mx-band-note" data-band={band.kind}>{band.text}</p>}
      </div>

      {/* Transitions ONLY, never value ticks. Rendered EMPTY on mount and
          filled in a separate step (MDN); aria-atomic so a repeated identical
          transition still announces; keyed so two inside one coalescing
          window do not collapse to one. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="mo-sr">
        {transitions.length ? transitions[transitions.length - 1].text : ''}
      </p>
    </div>
  );
}

/* KEYBOARD
   - Native <button>s in natural tab order; Enter/Space open that metric's
     evidence in the page's .mo-payload (motion.css opens keyboard-sourced
     payloads at 0ms — "a keystroke already declared intent").
   - No roving tabindex: it would pull three of four cells out of the tab order
     for zero benefit.
   - The UNAVAILABLE cell is NEVER disabled and never gets aria-disabled. Its
     reason is its whole reason to exist, and a disabled control leaves the tab
     order — which would make that reason unreachable by keyboard.
   - Focus does NOT clear the change mark. Its lifetime is the poll interval
     (motion.css), so Tabbing across the band no longer destroys the
     information before it can be perceived. */
```

---

## 10. Filed against neighbours

1. **`StatusChip.tsx` fails open on an unrecognised wire string.** `props.state ?? 'UNKNOWN'`
   catches `undefined` only; a string like `'PROBE_RESTARTING'` indexes `TONE[state] → undefined`,
   so `data-tone` is absent and the chip renders bare — the quietest rendering, for the least
   trusted input. Suggested: `const s = TONE[state] ? state : 'UNKNOWN'`, with the raw value in the
   reason. Guarded on my side meanwhile.
2. **`motion.css` forced-colors focus fallback does not render.** `@media (forced-colors: active)
   { .watchdog .wd-row:focus-visible { box-shadow: inset 0 0 0 2px Highlight } }` — forced-colors
   drops `box-shadow`. Use `outline: 2px solid Highlight; outline-offset: -2px`.
3. **`--warn`, `--ink-*`, `--sp-*`, `--gutter-icon`, `--surface-tile` are specified in `tokens.md`
   and defined nowhere in CSS.** Every Watchdog element is currently shipping a private bridge.
   `tokens.md` §8 Migration needs to land.
4. **No webfont is loaded.** `--font` declares `InterVariable`; there is no `@font-face`, no
   `<link>`, no `.woff` in the tree. Every weight is snapping to a system fallback.
5. **`sparkline.md` exists in the `cosmos-merge` worktree, not in `Main`.** `Health.css:2` states
   the page law — *"no history visualization without stored history."* Either history exists (and
   my V3-class rejection needs a weaker argument) or that element is in violation. Someone must
   reconcile; it is not mine to decide unilaterally.
6. **`.healthx-summary` band height (102px) vs the derived scale height (100px).** Tokens owner's
   ruling requested: publish `--row-h-band`, or lift T1's line-height to 28.
