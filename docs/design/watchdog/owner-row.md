# Watchdog — Owner / component health row with provenance

Specialist working notes. One element: **the per-component provenance row and the owner group it
lives in**. Round 2, after the panel. Nothing else on the page is mine.

---

## 0. The panel round — what was verified, what was fixed, where the panel is wrong

Every claim below re-checked against `/Users/cosmosgeek/Desktop/Main/web/src/`.

### 0.1 The finding that reframed the element

`lib/productIntegration/model.ts:1418`:

```ts
function fixtureOwner(componentId: string): string {
  if (componentId === 'q-inference') return 'quant/src/quant_edge/inference/**';
  if (componentId.includes('basis') || componentId.includes('volume')) return 'server/src/engine/**';
  if (componentId.includes('capital')) return 'server/src/capitalFoundation/**';
  …
  return 'server/src/systemIntegration/**';
}
```

**`owner` IS the source location.** It is a CODEOWNERS-shaped glob, already on the projection
(`model.ts:219`). My previous round invented a `sourcePath` prop with no producer (panel #25,
sustained) while the field it was imitating was sitting on the model the whole time.

And 14 components resolve to ~6 owners. So `owner` is not a *field*, it is a **grouping key** — the
panel's untested variant direction turns out to be the one the data was already shaped for.

### 0.2 Three neighbour files I had not read, that own things I was re-inventing

| file | owns | what my round-1 spec did |
|---|---|---|
| `docs/design/watchdog/tokens.md` | `--sp-1..9`, T1–T6 type, `--ink-1/2/3/-mute`, `--ok/--warn/--bad/--held`, `--row-h: 28px` | invented `--ow-1..7`, 12.5/11.5/10.5px, weights 510/430/560, and a local `--ow-warn` |
| `docs/design/watchdog/motion.md` | `--mo-*`, **a reserved 12px left change gutter**, "row tint: no transition", "information at 0ms", "no shimmer placeholder", roving-tabindex composite, `data-order-frozen` | put a **2px truth spine in the left gutter** — a direct collision with another specialist's reserved track — plus a row-tint transition, a drawer entrance animation, and a shimmer skeleton, all three of which that file explicitly bans |
| `features/watchdog/StatusChip.tsx` + `statusChip.css` | the entire state vocabulary, `REASON_REQUIRED` as a runtime invariant, sentence-case `LABEL`, 8 hueless glyph topologies, `--wd-col: 108px` | wrote a second, weaker one |

The panel called this "the worst category". It was right, and it understated it: the left-gutter
collision means two specialists were about to paint the same 12–16px of every row.

**All three are now consumed, not re-implemented.** The element's scope shrank and got sharper.

### 0.3 Panel findings sustained and fixed

| # | finding | resolution |
|---|---|---|
| 1 | `.sr-only` doesn't exist | Sustained with a correction: it exists **scoped** as `.aiox-page .sr-only` (`aiOps/aiOps.css:43`) and as `.pcr-visually-hidden` (`productControlRoom.css:367`). Neither is in scope on a Watchdog page. I ship `.wd-vh` and flag it as the **third** copy — see §8 open questions. |
| 2 | `--faint` is 2.5:1 and carries the mandatory honesty text | Sustained. But the panel's own fix is wrong — see §0.4. Resolved by `tokens.md`'s hard rule instead. |
| 3 | `#bd781b` fails in **light** too (3.58:1 re-derived) | Sustained and moot: `tokens.md` defines `--warn` = `#8f5d07` light (5.62:1 on `--panel`) / `#e6b44f` dark (9.32:1). I ship no amber literal at all. |
| 4 | owner-gating painted as breakage | Sustained. Held-vs-stopped is now StatusChip's `TONE` map (`held` → `--held`, tint only), and my warrant axis is **hueless by construction**, so it cannot repaint a held state as broken. |
| 5 | one-saturated-element rule not implemented; CSS can't enforce a data invariant | Sustained, and fixed structurally rather than by selector: **no element in my row is permitted a hue token except the StatusChip.** One colour site per row is now a fact of the stylesheet, not a computed `data-emphasis`. `data-emphasis` is deleted. |
| 6 | `data-emphasis="live"` is a no-op | Deleted with the whole mechanism. |
| 7 | sticky head never sticks (`overflow: hidden` is a scrollport) | Sustained. Frame is `overflow: clip`. Grid minima now sum to 728px so there is no horizontal scroll rail at all. |
| 8 | `:first-of-type` double hairline | Sustained. Rows carry `border-bottom`, not `border-top`; the head owns the only top edge. No `:first-of-type` anywhere. |
| 9 | drift equation overflows its own column (`Start Requested → Recovery Required` = 35 chars) | Sustained. Drift is no longer a value — it is a **consequence sentence on its own line**. See §5.4. |
| 10 | `ProductCapability` and `ProductTruthLabel` share `LIVE_PUBLIC`; cells 3 and 4 can render the same string | Sustained, fixed **grammatically**: capability is a noun value, warrant is a prepositional attestation (`on wired evidence`). They can no longer be confused at any width. |
| 11 | `ROOT` tag ellipsised out of existence | Deleted. Root-cause is now structural — see §5.5. |
| 12 | double truncation: JS mid-truncate re-truncated at the end by CSS | Sustained. Middle-truncation now applies only to the **owner glob in the group header**, whose column is `1fr` of a 728px grid and has no `text-overflow`, so a miscalculation clips visibly instead of silently faking correctness. |
| 13 | truncated path is what a screen reader reads | Sustained. Visual span is `aria-hidden`; the group row carries `aria-label={owner}` with the full string. |
| 14 | `UNAVAILABLE` folded into `BLOCKED`, `MISSING` into `UNKNOWN` | Sustained. Ten truth labels now get **ten distinct warrant phrases**. Grafana's own docs separate `DatasourceNoData` from `MissingSeries` — the citation for why MISSING ≠ UNKNOWN. |
| 15 | `status: 'planned'` and `capability: 'NOT_CONFIGURED'` untreated | Sustained. `planned` maps to `NOT_CONFIGURED` on the chip (void tone, hueless). Capability `NOT_CONFIGURED`/`UNAVAILABLE`/`UNKNOWN` render at `--ink-3` with a warrant phrase, never at value ink. |
| 16 | `?? 'unknown'` fallback is a landmine | Sustained. `satisfies Record<ProductTruthLabel, …>`, no runtime default. |
| 17 | claimed 2 weights, shipped 5 | Sustained and moot: weights are now `tokens.md`'s four (450/500/550/600) and **no weight varies with data** (Rauno: "font weight should not change on hover or selected state"; StatusChip: "weight is CONSTANT across all eight states"). |
| 18 | "no fact de-emphasised by shrinking" was false | Sustained. Claim withdrawn. Type level = semantic rank, explicitly: T4 value, T5 support, T6 micro. Identity outranking support is stated, not denied. |
| 19 | claimed 3 inks, used 4 | Moot: four named tiers, `--ink-1/2/3/-mute`, and `--ink-mute` never carries truth. |
| 20 | drifts from `.healthx-source small` on weight and line-height | Sustained and superseded: I now quantise to `tokens.md`, not to a sibling page's literals. Where they disagree, the scale wins and the divergence is listed in §8 as a migration item. |
| 21 | off-scale literals | Sustained. §6 has a grep gate. |
| 22 | drawer "aligned to the same x-positions" — it isn't | **The panel is right that the claim was false and wrong about the fix.** See §0.4. |
| 23 | 860px fold is arbitrary; minima sum to 792px | Sustained. Fold is now the computed sum, 728px, arithmetic shown. |
| 24 | narrow layout broken as written | Sustained. Explicit `grid-template-areas`, no auto-placement. |
| 25 | element named `OwnerRow`, owner not in the row | Sustained and inverted: owner is now the **structure**. |
| 26 | checkpoint silently dropped | Sustained as a fact, rejected as a defect: `ComponentOperationalHealthTable.tsx:68` already ships a `Checkpoint / Restart` column. Duplicating it is the drift, not the fix. Boundary stated in §7. |
| 27 | `role="cell"` on a `<button>` destroys button semantics; roving tabindex is a grid model on table semantics | Sustained. Now `role="treegrid"`. W3C APG: *"Each parent row has the aria-expanded state set on either the row element or on a cell contained in the row."* Roving tabindex is the **fleet's** decision (`motion.md` pass 1 item 1: "the row list is a roving-tabindex composite so there is one tab stop that survives re-render") — so the model was right and only the role was wrong. |
| 28 | the CORE MOVE had no a11y story | Sustained. Real `columnheader` cells, `aria-colindex` on every cell, and first cell is `role="rowheader"` (Primer `rowHeader: true`) so the component name is announced with each cell. |
| 29 | `display: contents` on a role-bearing element | Sustained. Drawer is a `role="row"`-free `<dl>` inside one `gridcell` with `aria-colspan`. |
| 30 | copy button has no accessible name and no confirmation | Sustained. `aria-label`, `role="status"` region, 2s label swap. |
| 31 | 24px copy button is tight | Sustained. 32px (`--sp-8`), glyph 12px. |
| 32–37 | neighbour incoherence, case doctrine, radius inversion, `REASON_REQUIRED` reimplemented, two column systems, `--wd-col` has no slot | All sustained. All resolved by **consuming StatusChip** rather than paraphrasing it. Case is now the sibling's `LABEL` map. Radius: `--r-sm` is the data-container language, `--r-pill` is actions — my row has **no interactive radius at all** because the row itself is the target. `--wd-col: 108px` is a named track in my grid. |

### 0.4 Where the panel is wrong, proved

**Panel #2's fix is wrong.** It prescribes `--ow-absent: var(--muted-2)`. I derived `--muted-2`
(`#858e9b`) on `--panel` (`#ffffff`) at **3.31:1** — which is what the sibling itself measured, and
`statusChip.css:56-62` says in the same breath that `--muted-2` clears the **3:1 graphics** floor
and belongs on the *glyph*, "never on the label, which must stay readable in every state."
`REASON UNPUBLISHED` is a **label**. Moving it from 2.54:1 to 3.31:1 moves it from illegible to
still-below-4.5:1. The fix is `tokens.md`'s hard rule, which is stronger than either: *"no
truth-bearing text below Lc 60; `--ink-mute` never carries truth"* → the string sits at `--ink-3`,
the truth floor (Lc 64 in both themes, 4.91:1 light).

**Panel #22's fix is wrong.** It asks that the drawer either be honestly labelled a reflow *or* be
made `grid-template-columns: var(--ow-grid)`. Vercel Geist's table guidance is explicit that
*"key/value metadata on detail pages should use Description components, not two-column tables."*
Forcing nine key/value pairs onto a five-track operational grid would make the drawer impersonate a
row — a value pretending to be a record. The drawer is a `<dl>`, deliberately, and the round-1 claim
that it aligned to the row grid is withdrawn as the false part.

**Panel #27 is half wrong.** It offers "pick one: grid semantics, or drop `role="table"` for a
list." The fleet has already picked: `motion.md` requires a roving-tabindex composite so keyboard
focus survives a 2s poll. A `role="list"` with 20 tab stops would re-introduce exactly the
focus-destruction bug that file calls "the single worst bug this page can have". Treegrid keeps the
fleet contract and legalises `aria-expanded`.

**Panel #26 is wrong on the merits.** Checkpoint is not missing from my element; it is *another
element's column* (`ComponentOperationalHealthTable.tsx:67`). Adding it would be duplication.

---

## 1. References — 12, all fetched this session, mechanic named

| # | source | URL | what I took |
|---|---|---|---|
| 1 | **Rauno Freiberg, Web Interface Guidelines** | https://interfaces.rauno.me/ | Four mechanics, all newly applied. *"Interactive elements in a vertical or horizontal list should have no dead areas between each element, instead, increase their `padding`"* → round 1 made only the identity cell clickable, leaving 60% of every row dead; the **whole row** is now the target. *"Font weight should not change on hover or selected state to prevent layout shift"* → deleted my `font-weight: 560` exposure promotion. *"Box shadow should be used for focus rings, not outline which won't respect radius"* → inset ring. *"Focusable elements in a sequential list should be navigable with ↑ ↓"* → treegrid row navigation. |
| 2 | **W3C WAI-ARIA APG — Treegrid pattern** | https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/ | *"A `row` that can be expanded or collapsed to show or hide a set of child rows is a parent row. Each parent `row` has the aria-expanded state set on either the `row` element or on a cell contained in the row."* This is the exact shape of owner→components, and it is what makes `aria-expanded` legal — which `role="cell"` never was. Also the ←/→ collapse-and-move-to-parent keys, Home/End, Ctrl+Home/End. |
| 3 | **Vercel Geist — Table** | https://vercel.com/geist/table | Three takes and one **documented rejection**. Take: *"Render a dash (—) for unknown or inapplicable values rather than 'N/A,' 'null,' or empty strings"* — adopted for **inapplicable only**. Take: *"key/value metadata on detail pages should use Description components, not two-column tables"* → the drawer is a `<dl>`, and this is the citation that defeats panel #22. Take: canonical short relative-time in cells. **Reject:** Geist collapses unknown and inapplicable into one dash. On an evidence-gated surface those are different truths — "we did not measure" and "there is nothing to measure" cannot share a glyph. Inapplicable gets `—`; unknown gets a word. |
| 4 | **Nielsen Norman Group — Data Tables: Four Major User Tasks** | https://www.nngroup.com/articles/data-tables/ | *"Freeze header rows and header columns"* → sticky column head **and** sticky group headers, so the owner stays on screen while you scan its members. *"The (default) first column should be a human-readable record identifier"* → why variant W2 (warrant-first) loses. The eye-tracking finding — users *"move eyes between multiple columns before advancing to the next row"* — is why the row must be one line: a two-tier cell forces a vertical excursion mid-traverse. |
| 5 | **GitHub Primer — DataTable** | https://primer.style/product/components/data-table/ | `rowHeader: true` on the first column — the semantic that makes every subsequent cell announce with the component name, which is the answer to "a screen-reader user hears an unlabelled string of values". Also *"If you have multiple actions for a row, start by pulling them into a dropdown… Do not pull out more than 1 action"* → one disclosure affordance per row, nothing else. |
| 6 | **Grafana — No Data and Error states** | https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/nodata-and-error-states/ | Verbatim: *"Stale alert instances in the `Normal` state include the `grafana_state_reason` annotation with the value **MissingSeries**"* — separate from `DatasourceNoData`. That is the citation for panel #14: **MISSING ("evidence existed and vanished") ≠ UNKNOWN ("evidence class never established")**, and they get different warrant phrases. Also: Paused → Normal + reason, mapped to `NOT_CONFIGURED`. |
| 7 | **Emil Kowalski — Great Animations** | https://emilkowal.ski/ui/great-animations | *"Never animate keyboard initiated actions"* — users perform them repeatedly and animation makes them feel slow. My drawer opens on Enter as often as on click, so it has **no entrance animation at all**. Combined with the house `motion.md` M3 ("information appears at 0ms; only its withdrawal is eased"), the round-1 160ms `translateY` drawer is deleted rather than tuned. Also: `transform`/`opacity` only, <300ms, `prefers-reduced-motion`. |
| 8 | **W3C — WCAG 2.2 SC 2.5.8 Target Size (Minimum)** | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | *"The size of the target for pointer inputs is at least 24 by 24 CSS pixels."* My 28px row clears it on the primary axis without exception-hunting. The copy button moves 24 → 32px because the *spacing* exception does not apply inside a dense `<dl>`. |
| 9 | **MDN — CSS subgrid** | https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid | Baseline Widely Available since Sept 2023. One `grid-template-columns` declaration on the table; head, group rows and component rows all `grid-template-columns: subgrid`. This is the mechanism that makes "two column systems on one page" (panel #36) structurally impossible **within** my element, and it deletes the round-1 pattern of repeating `var(--ow-grid)` on three selectors. |
| 10 | **Backstage — well-known annotations** | https://backstage.io/docs/features/software-catalog/well-known-annotations/ | `backstage.io/source-location` — *"a location reference string that points to the location whose registration lead to the creation of the entity"*. This is what `owner` already is in this model. Taken: source location is **identity**, and identity that is shared by N components is a **group**, not a repeated field. |
| 11 | **Atlassian Design System — Lozenge** | https://atlassian.design/components/lozenge | Kept only for the action-priority framing, and then **rejected in implementation**: round 1 turned it into a computed `data-emphasis` winner. Atlassian's own point is that priority should be legible without computation. So priority is now structural — exactly one element in the row may carry a hue, by stylesheet construction. |
| 12 | **Sentry — issue list schema** | https://docs.sentry.io/api/events/list-a-projects-issues/ | `culprit` — the machine code path beneath the human title. Round 1 stacked it as tier 2 of every row. Sentry can do that because each issue has a *different* culprit; here 14 components share 6, so the same idea is better served by hoisting it to a group header. Cited for what it taught me to stop doing. |

Internal references, which round 1 had **zero** of and the panel correctly called disqualifying:
`docs/design/watchdog/tokens.md` (scale), `docs/design/watchdog/motion.md` (motion + the reserved
change gutter), `features/watchdog/StatusChip.tsx` + `statusChip.css` (state vocabulary),
`pages/ComponentOperationalHealthTable.tsx` (the adjacent table and my scope boundary),
`pages/Health.css` (frame, hover, detail surface), `lib/productIntegration/model.ts` (every enum).

---

## 2. Four variants — the design variables actually moved

Round 1's four all silently agreed on *one row per component, left-to-right, disclosure below*.
The panel named that. These four break it.

### W1 — Ownership Ledger *(winner)*
**Variables moved:** information architecture (flat → two-level tree keyed on `owner`); the
mechanism that removes the gray wall (column alignment → **structural deduplication**); density
(56px two-tier rows → 28px single-line rows + 24px group headers); state channel (my own vocabulary
→ the sibling `StatusChip`); disclosure (one level → two); alignment (repeated grid → subgrid).

Owner is printed **once per group**, not once per row. The 14 components collapse under ~6 owner
globs; the group header carries the roll-up (count, worst warrant, capital posture) and is the
collapse control for its subtree. Component rows lose the owner tier entirely and become one line at
`--row-h` (28px). Subordinate context — the reason, the drift, the downstream attribution — gets its
own full-width 24px line beneath the row, per L9.

### W2 — Warrant-first inversion
**Variables moved:** reading order and what counts as the record identifier. Column 1 is the truth
warrant; rows sort by believability, worst first. "What can I believe?" is asked before "what is
it?".

**Verdict: loses.** NN/g's eye-tracking result (fetched this session) is that users perform a
hierarchical search across columns and *then* advance rows — so a reader must locate identity in
column 3 on every single row, which is the "mystery meat identifier" failure that article names
explicitly. Worse epistemically: the warrant is a *judgement about* the record, not the record. Made
first, it becomes the identifier, and two components with the same warrant become indistinguishable
at a glance. **Donates one thing, and it is important:** the warrant needs its own *register*, not
just its own column — which became the prepositional-phrase treatment that fixes panel #10.

### W3 — Chip-channel flat table
**Variables moved:** how much of the element is *new*. Adopt `StatusChip` verbatim as the state
column at its own reserved `--wd-col: 108px`; every other fact demotes to plain text; invent nothing.
The control experiment: maximum neighbour coherence, zero new vocabulary.

**Verdict: loses, and it is the most important loser.** `StatusChip`'s vocabulary is
`WatchdogState` — READY / DEGRADED / BLOCKED / UNAVAILABLE / UNKNOWN / NOT_CONFIGURED / OWNER_GATED.
That is the **posture** axis. This element's hard problem is `ProductTruthLabel` — LIVE_PUBLIC /
WIRED / BUILT_AND_TESTED / IMPORTED / SYNTHETIC_ONLY / … — the **evidence-class** axis. They are
orthogonal, and their most dangerous combination is *READY on SYNTHETIC_ONLY*: a component
reporting perfect health on evidence that proves nothing. One chip cannot render two orthogonal
axes, so W3 renders the safe-looking half and drops the half that matters.
**Donates the whole state channel:** I consume `StatusChip` for posture and build only the missing
warrant axis. That division of labour is what cashes the panel's entire Tier 5.

### W4 — Two-line block list
**Variables moved:** abandon the grid entirely. Each component is a 40px prose block; ownership is a
left rail label; no columns at all.

**Verdict: loses badly, and it is the strawman risk — so, briefly and concretely.** Without column
tracks nothing right-aligns, so L5 has no surface to apply to; and the reason it actually fails is
that it *re-creates the original defect*. The problem this element exists to solve is
`Header.tsx:2419`, which joins the provenance facts into one middot string:
`` `${owner} · Lifecycle ${observedLifecycle} · Capability ${capability} · Truth ${truthLabel}` ``.
A prose block is that string with line breaks. Twenty variable-length gray sentences is what a wall
of gray *is*.

---

## 3. The fight

| | W1 ledger | W2 warrant-first | W3 chip-flat | W4 blocks |
|---|---|---|---|---|
| L1 hierarchy from fill/weight | ✓ one chip carries fill; everything else is ink tier | ✓ | ✓ | ✗ hierarchy from position only, and position varies |
| L2 one action radius, one data radius | ✓ **zero** interactive radii — the row is the target | ✓ | ✓ | ✓ |
| L3 one accent per surface | ✓ structurally: only the chip may hold a hue | ✓ | ✓ | ✗ needs colour to separate blocks |
| L4 every value on a fixed scale | ✓ `--sp-*`, T1–T6, minima all ×`--sp-6` | ✓ | ✓ | ✗ block height is content-dependent |
| L5 numbers right-aligned, tabular | ✓ evidence age + group counts on one rail | ✓ | ✓ | ✗ no rail exists |
| L6 icons on a fixed gutter | ✓ `--gutter-icon: 16px`, chevron + chip glyph | ✓ | ✓ | ✗ |
| L7 microcopy states the consequence | ✓ reason line is mandatory and full-width | ✓ | ~ reason squeezed into 108px | ~ |
| L8 middle-truncate identifiers | ✓ owner glob, once per group | ✓ | — | — |
| L9 subordinate context its own line | ✓ the reason sub-row **is** this law | ~ | ✗ crammed under a 108px chip | ✗ crammed |
| L10 same rank = same weight | ✓ type level = semantic rank, no data-driven weight | ✓ | ✓ | ✗ |
| Truth: unknown ≠ unavailable ≠ broken ≠ absent | ✓ ten labels, ten phrases | ✓ | ✗ ten labels collapsed into seven states | ~ |
| Truth: never render unproven health | ✓ evidence class gates the chip **before render** | ✓ | ✗ READY on SYNTHETIC_ONLY renders green | ✗ |
| Kills the repeated-owner gray | ✓ by structure | ✗ still repeated per row | ✗ | ✗ |
| Neighbour coherence | ✓ consumes chip, scale, motion | ~ | ✓✓ | ✗ |
| Fits without a second scroll axis | ✓ 728px | ✓ | ✓ | ✓ |

**W1 wins.** It is the only variant that deletes the repeated provenance string by *structure*
rather than by alignment, the only one whose name matches what it does, and the only one that makes
root-cause deduplication a property of the layout instead of a special case in a ternary.

---

## 4. Refinement pass 1 — adversarial

**Q: Is the group header decorative chrome?**
It would be if it only repeated the owner. It carries the roll-up (component count, worst warrant,
capital posture) which exists nowhere else, and it is the collapse control for its subtree. But the
budget matters: 6 headers × 24px = 144px of chrome against 14 rows × 28px = 392px is **27% chrome**,
which is too much to hand-wave. So grouping is **gated by a computed rule, not by taste**:

```
group when  components / distinct owners >= 2
```

14 / 6 = 2.33 → grouped. If the ratio falls below 2, the headers cost more than they save and the
table renders flat with `owner` as a middle-truncated column. Same component, one branch, stated.

**Q: Why did the row lose its second tier?**
Because the second tier existed *only* to carry the owner string, and grouping deleted that need.
Dropping to one line is the payoff of the winner, not a density preference — and NN/g's eye-tracking
result says a two-tier cell forces a vertical excursion in the middle of a horizontal traverse.
`--row-h: 28px` is `tokens.md`'s stated atom.

**Q: Then where does the reason go?**
Its own full-width line at `--row-h-tight` (24px), indented to the name column, spanning to the
right edge. Not truncatable, not behind disclosure, not squeezed under a 108px chip. This is L9
executed literally, and it is what `.wd-status`'s own `display: grid` stacking already implies at
chip scale — I am applying the sibling's structure at row scale.

**Q: Doesn't that make row height data-dependent — the exact thing I killed variant V1 for in round 1?**
Yes, and here it is the design. V1's heights varied with *string length*, which is noise. These vary
with *whether the component has something to say*, which is signal: **a healthy table is a flat wall
of 28px rows and almost no ink; an unhealthy table physically grows in proportion to how much is
wrong.** Height becomes an honest aggregate you can read from across the room.

**Q: Anything at the wrong visual weight?**
Round 1 promoted the capital-exposure flag to `font-weight: 560` under emphasis. Rauno forbids
weight changes that cause layout shift, and `statusChip.css` states the reason precisely — *"a live
poll flipping READY → BLOCKED must never reflow the row"*. Capital exposure is now carried in the
reason sentence, where it belongs: `Capital exposed — one leg filled, hedge did not.` No weight
varies with data anywhere in the element.

**Q: Is anything still off-scale?**
Column minima were 200/148/232 — on no scale. Re-derived as multiples of `--sp-6` (16px) and then
**checked against the longest real string**, not rounded to taste:

```
name       208px  (13 x 16)   longest: "Execution Coordinator Validate Only"  -> wraps to rowheader ellipsis, acceptable (identity, recoverable in drawer)
state      108px  (--wd-col, inherited from statusChip.css: sized for "Not configured")
capability 160px  (10 x 16)   longest: "Live signed validate"  = 20ch @ T4 12px Inter ~6.4px/ch = 128px + 14px pad = 142px  -> fits, 18px slack
warrant    240px  (15 x 16)   longest: "on imported evidence, not re-verified" = 37ch @ T5 11px ~5.6px/ch = 207px + 14px pad = 221px -> fits, 19px slack
change      12px  (RESERVED for the motion specialist — not mine to paint)
--------------------------------------------------------
sum        728px   <- this is the container-query fold point. Not 860.
```

**Q: What did I forget?**
1. **The left gutter is already owned.** `motion.md` reserves a 12px left track for the per-row
   change predicate. My round-1 2px truth spine sat in it. The spine is **deleted** — truth moves to
   the warrant phrase and the chip's glyph topology, both of which already exist.
2. **`freshnessState` had no home.** It is `StatusChip`'s `stale` prop, which already demotes a stale
   READY to the hueless `absent` tone and forces a reason. Zero new code.
3. **`--ok` could still leak.** `tokens.md`: *"`--ok` — glyph only, ≤12px. Never text, never fill."*
   The only green in my row is the chip's 12px READY glyph, owned by the sibling. See §5.2 for why
   it cannot render on unproven evidence.
4. **Group ordering must be deterministic** or the list reorders under the cursor on every poll.
   Order: worst warrant → capital relevance → owner string. Plus `data-order-frozen` on
   `:hover`/`:focus-within` per `motion.md`, joining the fleet contract instead of writing a second.
5. **A row with nothing to disclose must not show a chevron**, or the affordance lies. No
   `correlationId`, no `supportedControlIds`, `generation === 0`, `restartCount === 0` → no chevron,
   and `aria-expanded` is **omitted** rather than set to `false` (omitted = not expandable;
   `false` = collapsed, which would be a lie).
6. **Shimmer.** `motion.md`: *"A shimmer says 'loading, and it will succeed.' UNKNOWN is not
   loading."* Deleted. A component with no evidence yet renders UNKNOWN with a reason.

---

## 5. Refinement pass 2 — the parts that are still soft

### 5.1 The one that decides the element: evidence class gates the state *before render*

The panel's #5 ends with the correct observation that **CSS cannot enforce a data invariant**. Round
1's honesty gate was `[data-truth="proven"] .owner-dot[data-status="operational"] { background: var(--up) }`
— a selector, defeated by any caller who passes a different status.

Now the gate is a pure function, upstream of the chip:

```ts
/* A component may not present an affirmative posture on evidence that does not
   prove it. This is StatusChip's own stale rule generalised from TIME to
   EVIDENCE CLASS: expired evidence is not evidence, and synthetic evidence was
   never evidence. */
if (state === 'READY' && truthClass !== 'proven') → state = 'UNKNOWN'
```

`READY` on `SYNTHETIC_ONLY` can no longer reach the renderer. It is testable, it is one line, and it
is the reason this round is not the previous one.

### 5.2 One colour site per row — structural, not computed

`data-emphasis` is deleted. The rule is now a property of the stylesheet: **no selector in
`ownerRow.css` references `--ok`, `--warn`, `--bad`, `--held`, `--up`, `--down` or `--accent` except
the focus ring.** Every hue on the row is inside `<StatusChip>`, which enforces its own single-fill
ladder. There is nothing to compute and nothing to forget.

The focus ring is the one deliberate exception, and `motion.md` soft-spot 5 already defended it:
the accent budget governs *persistent data ink*; a focus ring is transient, user-summoned, and never
co-present with more than one element. Deviating from `styles.css:146` would create the cross-page
drift L10 forbids.

### 5.3 The warrant register — fixing the `LIVE_PUBLIC` collision grammatically

`ProductCapability` and `ProductTruthLabel` share the member `LIVE_PUBLIC` (`model.ts:55` and `:227`).
Widening a column does not fix two adjacent cells reading `Live public`. Register does:

- **Capability is a noun value.** T4, `--ink-1`. `Live public`. What it is allowed to do.
- **Warrant is a prepositional attestation.** T5, `--ink-3`, always beginning `on …` or naming an
  absence. `on wired evidence`. Why you may believe the row.

The row reads as a sentence: *Basis Engine · Ready · Live public · on wired evidence.* The two can
never be confused at any width, because one is a thing and one is a claim about the thing.

Ten labels, ten phrases — panel #14 and #16 closed:

| `truthLabel` | class | warrant phrase | why distinct |
|---|---|---|---|
| `LIVE_PUBLIC` | proven | `on live public evidence` | |
| `WIRED` | proven | `on wired evidence` | |
| `BUILT_AND_TESTED` | partial | `on test evidence only` | proven in a lab, not in production |
| `IMPORTED` | partial | `imported, not re-verified` | |
| `SYNTHETIC_ONLY` | simulated | `synthetic — not real evidence` | |
| `MISSING` | expected-absent | `evidence expected, absent` | Grafana `MissingSeries`: it existed and vanished |
| `UNKNOWN` | never-established | `evidence class never established` | Grafana `DatasourceNoData`: never evaluated |
| `NOT_CONFIGURED` | not-required | `no evidence required` | the slot is deliberately empty |
| `UNAVAILABLE` | withheld | `evidence channel unavailable` | we asked, we could not reach it |
| `BLOCKED` | withheld | `evidence blocked` | we asked, we were refused |

Every one of these is `--ink-3`, hueless, per `tokens.md`: *"Unknown / unavailable / not-configured
have no hue — `--ink-3` plus a mandatory reason."* Held-vs-stopped colour lives on the chip, where
`TONE.OWNER_GATED = 'held'` already renders it as tint-accent rather than red — panel #4 closed.

### 5.4 The drift equation survives, and improves

The panel called it the strongest idea in round 1 and then proved it does not fit its column:
`Start Requested → Recovery Required` is 35 characters.

**Drift is not a value. It is a reason.** When `desiredLifecycle !== observedLifecycle`, the chip
renders what is *true* (observed) and the reason line states the gap with its consequence:

> `Asked for Ready 41s ago; still Warming. Not accepting work yet.`

Better than `READY → DEGRADED` on four counts: it fits any width because it owns a line; it cannot
be ellipsised; it names the consequence (L7) instead of implying it; and it needs no invented arrow
glyph. The operational fact the model publishes and the old code discarded is preserved — the
*rendering* is what changed.

One consequence, stated as a doctrine call for the owner rather than smuggled in: **drift is itself
a reason-requiring condition**, extending `REASON_REQUIRED`. And an observed `READY` that disagrees
with a desired `STOPPED` is a component running against intent — it maps to `DEGRADED`, not `READY`,
because "ready" would assert an approval the supervisor did not give. See §8.

### 5.5 Root-cause deduplication became structural

Round 1 wrote `↳ downstream of Basis Engine` into a text slot. Now it uses the sibling's tone ladder:

- the root row → `BLOCKED` → `adverse-stop` → the **only solid fill on the page**
- every downstream row → `UNAVAILABLE` → `absent` → **hueless**, reason `Downstream of Basis Engine (server/src/engine/**)`

One alarm, twenty attributions, and the twenty are physically incapable of shouting because their
tone has no fill. `statusChip.css` says it itself: *"On a 20-row wall this is the ONLY filled object."*

### 5.6 The drawer, re-earned

Round 1's drawer held facts 7–14. Half of them are another element's job:
`ComponentOperationalHealthTable.tsx:64-68` already ships Heartbeat/Freshness, Lag/Backlog/Drops,
Quality/Retry, **Checkpoint/Restart**, Dependencies. Repeating them is the drift, not the fix.

The drawer keeps exactly four facts, all of them provenance and none rendered anywhere else:

1. **Owner** — full, untruncated, selectable, with copy
2. **Correlation id** — middle-truncated with copy; this is the operator's route from this row into
   `PRODUCT_TRACE_STAGES`, which is the point of an evidence-gated app
3. **Supported controls** — the ids, which hand off to the control-registry specialist
4. **Generation / restarts** — tabular, and `0 / 0` is a real measured value, not a null

Plus, when gated, the blocker code and its consequence sentence. Marked up as a `<dl>` on Geist's
Description rule, not force-fitted to the row grid.

### 5.7 What is still generic — named, not hidden

The chevron disclosure, the `<dl>`, the sticky header and the hover tint are stock. They are stock
*in this house too*, which is the justification: `.healthx-source-row > svg.expanded` (chevron,
`Health.css:406`), `.healthx-source-detail` surface (`Health.css:408`), `.healthx-source-row:hover`
(`Health.css:324`), NN/g freeze-headers. Using the house's existing pattern is correct; claiming
novelty for it would be the lie. What is *not* generic: evidence-class gating the state before
render, the warrant-as-prepositional-phrase register, ten labels to ten phrases, drift-as-consequence,
tone-ladder root-cause dedup, and the group-ratio rule.

### 5.8 The last question: best, or merely finished?

The remaining doubt is the 27% chrome cost of group headers at N=14. I gated it on a computed ratio
rather than defending it. The second doubt was whether ceding the state channel to `StatusChip`
loses the drift equation — it does not; drift became a consequence sentence, which is strictly
better. The third was whether a single-line row can hold six facts — the arithmetic in §4 says yes
with 18–19px of slack on the two tight columns, measured against the longest real enum member rather
than a round number. I am satisfied this is the version, not merely a finished one.

---

## 6. Scale discipline

Every value in `ownerRow.css` comes from `docs/design/watchdog/tokens.md` or is inherited from a
named neighbour and commented as such. The complete list of non-token values and their provenance:

```
--wd-col        108px   INHERITED  statusChip.css (sized for "Not configured")
--gutter-icon    16px   tokens.md 7.1 derived geometry
--row-h          28px   tokens.md 7.1  (the atom)
--row-h-tight    24px   tokens.md 7.1  (sub-rows only)
--row-h-head     32px   tokens.md 7.1
1px                     the house hairline; --line / --line-2 / --line-strong
728px                   COMPUTED: 12 + 208 + 108 + 160 + 240, arithmetic in §4
208/160/240px           13 / 10 / 15 x --sp-6, each checked against the longest enum member
```

Grep gate for CI: no fractional `font-size`; no `font-weight` outside 450/500/550/600; no
`gap`/`padding` outside `--sp-*`; no hex literal; no `--ok|--warn|--bad|--held|--up|--down` outside
`StatusChip`; no `text-overflow: ellipsis` on a JS-truncated string.

---

## 7. Scope boundary

| surface | owns |
|---|---|
| `ComponentOperationalHealthTable` | runtime telemetry: heartbeat, lag, backlog, drops, quality, retry, **checkpoint/restart**, dependencies |
| `StatusChip` | the posture vocabulary, tone ladder, `REASON_REQUIRED`, glyph topology |
| motion specialist | the 12px left change gutter, all durations, the poll/liveness contract |
| toggle specialist | `supportedControlIds` → actual mutations |
| **this element** | identity, **ownership as structure**, capability, the truth warrant, the reason, and the route to the trace |

The two tables **stack**; neither replaces the other. Mine is 728px and does not scroll horizontally,
so it sits above the 1455px telemetry table without inheriting its scroll rail.

---

## 8. Open questions — owner decisions, not design decisions

1. **`ownerKind` should be published, not inferred.** `owner` is polymorphic in the fixtures: a glob
   (`server/src/engine/**`), a team (`foundation/control`), and an authority
   (`I00 director + external authorization`, `model.ts:1556`). I derive the kind structurally to pick
   mono-vs-sans and the sort bucket. The supervisor should publish `ownerKind` instead. I will not
   pretend the inference is authoritative.
2. **Drift-as-reason-requiring** extends `REASON_REQUIRED` beyond the set `StatusChip.tsx:40` ships.
   And mapping `observed READY + desired ≠ READY` to `DEGRADED` is a doctrine call: it asserts that
   running against intent is not readiness. Owner's call, not mine. If accepted, it belongs **in
   StatusChip**, not in my row, so both elements cannot diverge.
3. **`IMPORTED` is classed `partial`.** If it means "copied from another system and never
   re-verified", it belongs at `never-established`. Doctrine call.
4. **One visually-hidden utility.** Three now exist: `.aiox-page .sr-only` (`aiOps.css:43`),
   `.pcr-visually-hidden` (`productControlRoom.css:367`), and my `.wd-vh`. One `.u-visually-hidden`
   should be promoted into `styles.css` and the other three deleted — one decision, made once.
5. **`tokens.md` migration is not landed.** `--sp-*`, T1–T6, `--ink-*`, `--warn`, `--held` are
   specified but not yet in `styles.css`. My CSS declares local fallbacks pinned to the documented
   hex values so it is correct before the migration and inherits automatically after. Someone must
   own landing step 1 of `tokens.md` §8 (`--warn` is currently read with a fallback at
   `styles.css:15225` and never defined).
6. **The left gutter needs one arbiter.** `motion.md` reserves 12px for the change predicate; I
   consume it as a track and paint nothing in it. If the graph-node or toggle specialist also wants
   it, that is three claims on one 12px column and it should be settled once, in `tokens.md`.
7. **Group ratio threshold.** I gate grouping at `components / owners >= 2`. If the supervisor grows
   to 40 components across 6 owners the ratio is 6.7 and grouping is obviously right; if a
   deployment has 8 components across 7 owners, flat is right. The threshold is defensible but it is
   a product judgement, and it should be confirmed rather than inherited from my arithmetic.
