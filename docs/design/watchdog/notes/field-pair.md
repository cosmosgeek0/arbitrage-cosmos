# `.wd-field` — the two-tier label/value field

Element owner notes. One element: the field that carries **one named fact** on Watchdog —
its name, its value, and the qualification that makes the value honest.

Formerly specced as `.fpair`. Renamed and rebuilt after the design panel. The rename is not
cosmetic: the element changed owner-scope, and the old name no longer describes what it does.

Surface: `/Users/cosmosgeek/Desktop/Main/web` — Watchdog observatory, both themes.

---

## 0. The finding that rebuilt the element

The panel's blocking items were #31 ("run the position variant; it may delete half of this"),
#33 ("this cannot land as a fourth label/value pair") and #30 ("strip the state enum and this is a
Tailwind field"). All three are answered by one discovery, which I made by reading the repo instead
of the brief:

**Three sibling specialists have already shipped, and between them they own most of what my
previous spec claimed.**

| file | owner | what it already owns |
|---|---|---|
| `web/src/features/watchdog/styles/statusChip.css` + `StatusChip.tsx` (291 + 232 lines, live) | status specialist | the **entire state vocabulary** — `READY · DEGRADED · BLOCKED · UNAVAILABLE · UNKNOWN · NOT_CONFIGURED · OWNER_GATED`, `STALE` as a modifier, the `defect` tone, and a runtime `REASON_REQUIRED` invariant |
| `docs/design/watchdog/tokens.md` (446 lines) | measurement specialist | the **spacing, type and ink scales** — `--sp-1..9`, `T1..T6`, `--ink-1/2/3/mute`, `--ok/--warn/--bad/--held`, `--focus-ring`, and the migration plan |
| `web/src/features/watchdog/styles/motion.css` (339 lines, live) | motion specialist | every duration and curve, the row-scope change mark, and a **scope law** |
| `docs/design/watchdog/toggle.md` (794 lines) | control specialist | control posture — `desired` vs `effective`, `preview → confirm → submit → readback` |

Three consequences, each of which deletes a large part of my previous spec:

**(a) I do not own state.** My old six-value `data-truth` enum (`known/stale/unknown/unavailable/
failed/synthetic`) is a second, incompatible vocabulary for a thing the page already renders. That
is defect #33 and #34 in their most literal form. **Deleted.** Where a fact has no value, the field
renders `<StatusChip>` *in the value's own cell* — same position, the fleet's words, the fleet's
`defect` guard, inherited rather than duplicated.

**(b) I do not own mutation.** `toggle.md` §3 establishes, from the code, that

> This app: nothing takes effect immediately, ever. `preview → confirm → submit → durable readback`.

My old spec shipped `<input>`s that commit on Enter, with `data-dirty`, `data-commit="pending"`,
`data-conflict`, a gated `readonly` state and a commit flash. **None of that is how this control
plane works.** An inline-committing text field would be a lie about the mutation model. All of it
is **deleted** — and with it defects #3, #9, #11, #14, #15, #17, #27, #28 and #36, which existed
only to defend a mechanism that should not exist. This is variant E, and it deleted more than the
panel predicted.

**(c) I do not own the scale.** Every number in my old spec — `10.5px`, `11.5px`, `14.5px`,
weights `560/540/460`, `38px` slot, `10px` radius, `140ms`, `260ms` — is off the published scale.
`tokens.md` §7 fixes all of it, and fixes the five WCAG failures (defect #8) at the token layer
where they belong, not with a private `--muted-aa`.

And `motion.css` ships a scope law that my commit flash violated outright:

> Numeric fields get **NO** field-scope signal, ever.

Plus a hard guard — `.watchdog * { transition-property: none; }` — so any transition must be
named explicitly to exist at all.

**What is left is the actual element**, and it is smaller and sharper than what I had:
tier-1 label typography and its truncation policy; tier-2 value with the numeric column, the unit
column and identifier truncation; tier-3 subordinate line (L9); and the geometry that keeps forty
of these on one rhythm.

---

## 1. What binds me (read, quoted, verified)

Verified against the live repo. `web/src/index.css` **does not exist** — the root sheet is
`web/src/styles.css`. There is no `LedgerPage.css`.

### 1.1 The published Watchdog scale — `docs/design/watchdog/tokens.md` §7

```
--sp-1  2  --sp-2  4  --sp-3  6  --sp-4  8      <- INSIDE a component
--sp-5 12  --sp-6 16  --sp-7 24  --sp-8 32  --sp-9 48   <- BETWEEN components
--row-h 28  --row-h-tight 24  --row-h-head 32  --gutter-icon 16
```

| level | role | size | line-height | weight | tracking | case |
|---|---|---:|---:|---:|---:|---|
| T3 | column head / micro-label | 10px | 14px | 600 | +0.06em | UPPERCASE |
| T4 | **value** | 12px | 16px | 500 | 0 | — |
| T5 | support / reason line | 11px | 16px | 450 | +0.01em | — |
| T6 | micro — unit suffix, evidence age | 10px | 14px | 450 | +0.015em | — |

Ink, pinned to identical |Lc| in both themes: `--ink-1` Lc 98 (values) · `--ink-2` Lc 80
(secondary truth) · `--ink-3` Lc 64 (**truth floor** — labels, reasons, ages) · `--ink-mute`
Lc 48 (**never truth**). Plus the hard rule: *no truth-bearing text below Lc 60.*

Semantic hue: `--ok` is **glyph-only, never text, never fill**. `--warn` ink-or-tint. `--bad`
tint→solid. `--held` tint only. **Unknown / unavailable / not-configured have no hue** — `--ink-3`
plus a mandatory reason.

### 1.2 The sibling status chip — `statusChip.css` (live)

```css
.wd-status { display: grid; justify-items: start; gap: 2px; }   /* the two-tier stack, already shipped */
.wd-chip-reason {
  color: var(--muted); font-size: 11px; font-weight: 430; line-height: 15px;
  font-variant-numeric: tabular-nums;   /* the age ticks 41m -> 42m without jitter */
  text-overflow: ellipsis; white-space: nowrap;   /* CSS truncation only: the FULL text
                                                     stays in the DOM for AT and copy. */
}
.wd-chip-reason b { color: var(--text-2); font-weight: 500; }
.wd-chip-reason code { font-family: var(--mono); font-size: 10.5px; color: var(--text-2); }
.wd-chip[data-tone="defect"] {           /* "Reason missing" */
  border-color: var(--line-strong); border-style: dashed;
  background: repeating-linear-gradient(135deg, transparent 0 5px, var(--tile) 5px 10px);
}
```

Two things I take verbatim, because taking them is L10 and re-deciding them is drift:
**the subordinate line has no icon** (it is text, with `<b>` for a prior state and `<code>` for an
identifier), and **the defect treatment and its operator-facing words are `Reason missing`.**

### 1.3 The motion law — `motion.css` (live)

```
--mo-0 0 · --mo-1 90 · --mo-2 160 · --mo-3 200 · --mo-4 320
--mo-out: cubic-bezier(.22,1,.36,1)   --mo-soft: cubic-bezier(.2,.8,.2,1)
.watchdog * { transition-property: none; }        /* nothing moves unless named */
/* Scope law: row-scope = the change mark. Field-scope = the chip's wash, on status
   transitions only. Numeric fields get NO field-scope signal, ever. */
```

### 1.4 The house root — `styles.css`

```css
/* :41 */  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;
/* :146 */ :focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; border-radius: 4px; }
/* :148 */ .num { font-variant-numeric: lining-nums tabular-nums; }
/* :250 */ [data-motion="reduced"] * { animation-duration:.01ms!important; transition-duration:.01ms!important; }
```

---

## 2. Panel defect #1, verified and answered properly

The panel is **right and under-stated**. I checked, and there is no `@font-face` in `styles.css`,
no font `<link>` in `web/index.html` (13 lines, quoted in full below), no `.woff2`/`.ttf` anywhere
outside `node_modules`, and **no Inter package in `web/package.json`** — the dependencies are
`lightweight-charts`, `lucide-react`, `react`, `react-dom`. Nothing else.

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/svg+xml" href="/arbitrage-capital-mark.svg" />
  <title>Arbitrage Capital Control Room</title>
</head>
```

`--font: "InterVariable", "Inter", "SF Pro Text", -apple-system, …` therefore resolves to
`-apple-system` / SF Pro, a **static-instance** family. Applying the CSS Fonts 4 matching algorithm
to the published weight ramp:

| declared | renders as | why |
|---|---|---|
| 450 | **500** | target in (400,500) → search that range ascending; 500 exists |
| 500 | 500 | exact |
| 550 | **600** | target > 500 → search ≥ target ascending; 600 exists |
| 600 | 600 | exact |

So `tokens.md`'s four-step ramp collapses to **two** weights in production. T5 (450) and T4 (500)
become the same weight; T2 (550) and T3 (600) become the same weight.

**The panel's proposed fix — "collapse the component to the weights the fallback has" — is wrong
for this element, and I am not taking it.** Collapsing would mean re-deciding a scale that is not
mine, in one component, which is the exact drift `tokens.md` exists to stop. The correct answer is
a design constraint I can enforce inside my own element:

> **No tier in this field is separated by weight alone. Every tier differs from its neighbours in
> at least two of {size, ink, case}.**

Checked, tier by tier:

| pair | size | ink | case | weight | survives font loss? |
|---|---|---|---|---|---|
| label ↔ value | 10 vs 12 | Lc 64 vs 98 | UPPER vs — | 600 vs 500 | **yes** — 3 channels spare |
| value ↔ note | 12 vs 11 | Lc 98 vs 64 | — | 500 vs 500 *(collapsed)* | **yes** — size + 34 Lc |
| note ↔ unit | 11 vs 10 | same | — | 500 vs 500 *(collapsed)* | **yes** — size + position (own column) |

The field renders correctly today, and improves when the font lands. That is a stronger position
than either shipping a fiction or amputating the scale.

**Still a blocking bug for the app, filed upward, not silently absorbed:** `InterVariable.woff2`
with `font-weight: 100 900` belongs in `/public` with an `@font-face`. Until then `tokens.md`'s
T2/T3 distinction and its T5/T4 distinction are decorative *for every element that leans on weight
alone*. Mine does not. **Open question #1.**

---

## 3. References

Fetched this round unless marked. Each line is the specific mechanic taken.

**1. Rauno Freiberg — Web Interface Guidelines** — https://interfaces.rauno.me/
Verbatim: *"Where available, tabular figures should be applied with `font-variant-numeric:
tabular-nums`, particularly in tables or when layout shifts are undesirable, like in timers"* —
the note's ticking age (`41m → 42m`) carries `tabular-nums`, matching `.wd-chip-reason`.
*"Hover states should not be visible on touch press, use `@media (hover: hover)"* — the only hover
in this element is wrapped. And the rule I used to **delete** work: *"Font size for inputs should
not be smaller than 16px to prevent iOS zooming on focus"* only binds elements with inputs. This
element has none, so the whole coarse-pointer divergence (defect #9) is gone rather than patched.

**2. MDN — CSS subgrid** — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid
Taken: the mechanism that makes the shared numeric column real — *"instead of creating a new track
listing, the nested grid uses the tracks defined on the parent"*, gaps inherited, Baseline since
September 2023. **Also taken: the reason to reject it on rows.** I planned `grid-template-rows:
subgrid` to fix the panel's ragged-row defect (#32) until I checked what it buys: every tier in
this field has a fixed line box (14/16/16px), so `align-items: start` produces byte-identical
alignment with no gap-override subtlety and no engine risk. Columns get subgrid because that is
load-bearing; rows do not, because there it is sophistication. Documented so nobody re-adds it.

**3. IBM Carbon — Read-only states pattern** *(carried from the previous round; this round's fetch
returned a truncated page, so I claim only what I can defend)* —
https://carbondesignsystem.com/patterns/read-only-states-pattern/
Taken: read-only maintains the enabled component's structure and spacing, drops to a transparent
background, de-emphasises the border, and **keeps text colour at full contrast**. That last clause
survives the rebuild as this element's central rule: *the value's ink encodes confidence in the
data, and nothing else may touch it.*

**4. Adrian Roselli — Don't Disable Form Controls** — https://adrianroselli.com/2024/02/dont-disable-form-controls.html
Verbatim: *"Default styles are a terrible signal a field is disabled"*, disabled controls are
*"exempt from WCAG contrast requirements"*, and disabling is *"no replacement for good instructions
and error messages."* Used to justify the deletion rather than the styling: with mutation delegated
to the control element, this field never disables anything, and the panel's `aria-disabled`
contradiction (#27) has no surface left to occur on.

**5. GOV.UK Design System — Error message** — https://design-system.service.gov.uk/components/error-message/
Verbatim: *"Do not clear form fields when displaying errors"*; describe what happened **and how to
fix it**; avoid *"valid/invalid"* and jargon; wire with `aria-describedby`; ship a visually hidden
`Error:` prefix. Applied to the note as a **copy rule**, which is where it still binds: a note may
never say "unavailable" or "invalid" — it says the consequence and the remedy.

**6. Grafana — Alert state and health** — https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/state-and-health/
Verbatim distinction: **No Data** is *"the alert rule query runs successfully but returns no data
points at all"*; **Error** is *"the alert rule fails to evaluate its query or queries
successfully."* Plus `grafana_state_reason`, which surfaces the cause when the rendered state
differs from the evaluated one. This is the argument that "no value" is a **state**, not a value —
which is precisely why it belongs to `StatusChip` and not to me. It is also where my one remaining
field-level distinction comes from: a *substituted* value is Grafana's state-reason case — the
engine is acting on a number, so the field must show that number and name its provenance.

**7. Datadog — Troubleshooting No Data** — https://docs.datadoghq.com/monitors/guide/troubleshooting-no-data/
Verbatim: *"no groups found"* means *"the monitor has no active entities to evaluate"*, whereas
*"No Data"* concerns *"the metric itself being empty."* Two different absences that must not render
alike — confirmation that the chip's `UNKNOWN` / `UNAVAILABLE` / `NOT_CONFIGURED` split is right
and that collapsing it into a field-local enum would have destroyed information.

**8. GitHub Primer — TextInput** — https://primer.style/product/components/text-input/
Taken, quoted: *"For context, prefer icons but use text (e.g. '$' or '%') if helpful"* — the unit
is **text in its own column**, never an icon, never inline after the digits. And the `monospace`
prop's stated purpose — *"code-related inputs, such as configuration tokens"* — is the exact rule
that settles the panel's #16: mono is for identifiers and hashes, not for numbers.

**9. Emil Kowalski — Animation standards** — https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md
Verbatim: hover/colour → `ease`, 100–160ms; *"Never `ease-in` on UI"*; *"Animate only `transform`
and `opacity`."* The single transition in this element (copy-button colour) is `--mo-1` (90ms) with
`--mo-out`. Everything else is static — enforced upstream by `.watchdog * { transition-property:
none }`, so this is a fact about the file rather than a promise.

**10. W3C — WCAG 2.2 SC 2.5.8 Target Size (Minimum)** — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
Verbatim: *"The size of the target for pointer inputs is at least 24 by 24 CSS pixels"*, with a
spacing exception measured by a 24px circle centred on each target's bounding box. The copy button
is 24×24 (`--sp-7`) and 32×32 (`--sp-8`) on coarse pointers, and no two copy targets are closer
than `--sp-4` — the panel's #29 bullet, sized to the actual criterion instead of "by a hair".

**11. Nielsen Norman Group — Data tables** — https://www.nngroup.com/articles/data-tables/
Verbatim: *"The (default) first column should be a human-readable record identifier instead of a
'mystery meat' automatically generated ID."* Generalised to the label column: the field's name is
the record identifier of the row, so it is the one thing that may **never** be truncated (panel #5,
and it is why I made labels wrap instead of raising a grid minimum).

**12. The three live siblings** — `statusChip.css`, `motion.css`, `tokens.md`, `toggle.md`
in this repo. The most consequential references in the list, and the ones the previous round did
not read. Taken: the state vocabulary, the reason-line treatment (no icon, `<b>`, `<code>`,
tabular), the `Reason missing` defect words and its dashed/hatched treatment, every number in the
scale, the motion scope law, and the mutation model that deleted my input.

---

## 4. Four variants — the design variables actually moved

The panel was right that A and D last round were strawmen and that **position was never explored.**
Position is the axis this round. With state and mutation delegated, the only real question left is
*what geometry relates a name to its value, and to the thirty-nine fields beside it.*

### A — Stacked card grid
*Variables:* alignment across siblings = **none**; tier mechanism = vertical stack; chrome =
container edge; density ≈ 50px/field; disclosure = none.
Fields are cards in `repeat(auto-fill, minmax(176px, 1fr))`. Label above value, each card
independent. (This is last round's winner, minus the parts the siblings deleted.)

### B — Ledger rows
*Variables:* alignment = **one global column set**; tier mechanism = horizontal position; chrome =
hairline only; density = `--row-h` 28px/field.
Every field is a row of one grid: `[label | value | unit | copy]`. All digits terminate on one
edge. Screen 4's ledger, literally.

### C — Width-derived dual configuration
*Variables:* alignment, tier mechanism **and** density are all **derived from measured container
width** rather than declared; chrome = none; disclosure = none.
One component. Below a measured threshold it is A's stack; at or above it, it is B's ledger,
sharing tracks with its siblings via column subgrid. The threshold is content-measured, not chosen.

### D — Inline baseline run
*Variables:* tier mechanism = **ink only**; alignment = reading order; chrome = zero; density =
maximum (~20px/field); the subordinate line becomes a subordinate *span*.
`Latency p99 184 ms · 12s ago`, one baseline, hierarchy entirely from `--ink-3` vs `--ink-1`.

### The fight

**D loses, on L9 and on the doctrine.** It deletes the second tier, which deletes the element —
but the fatal part is subtler. L9 requires subordinate context to get *its own line*. With the
reason on the value's line, the two compete for one line box, and the only escape for a long reason
is truncation. On an evidence-gated surface **a truncated reason is a hidden reason**, which is the
same breach as a tooltip'd one. D makes the doctrine's worst outcome the default behaviour of its
happy path.

**A loses, and it loses on the panel's #2, which cannot be patched inside A.** In an
`auto-fill` card grid there is *no shared track to align to* — each card is its own formatting
context, so forty values form no numeric edge no matter what `text-align` I set. That is not an
oversight in A; it is A's geometry. It also has to pick a card minimum, and at 176px
`Kill-switch arm delay` (21 characters at T3) does not fit, so A must either truncate the field's
name — NN/g's record identifier, panel #5, an incident — or raise the minimum until the grid is two
columns wide, at which point A *is* B with wasted space. And it spends ~50px per field on a page
whose published atom is 28px.

**B loses only where it is narrow, but it loses badly there.** Below ~320px the label gutter, a
9-digit value and a 4-character unit do not coexist, and B's single escape is to truncate the
label. B is also simply not the Screen-2 element in a rail, a drawer or on a phone, where the app
genuinely needs the stack. B is right and I want it — but only when the container can pay for it.

**C wins.** It is B wherever B is affordable and A's stack wherever it is not, and the switch is a
**measured** threshold rather than an author's flag. That matters more than it sounds:

- It is the only variant that satisfies **L5 whenever L5 is physically satisfiable**, and it does
  so structurally — the unit is a shared `auto` track sized by the widest unit in the group, which
  is the real fix for the panel's `--fpair-suffix-w: 34px` collision (#3). No constant to get wrong.
- **No label is ever truncated, at any width** (#5): in ledger mode the label column is `auto`, so
  it is exactly as wide as the longest label present; in stacked mode the label wraps.
- It **deletes `data-density`** (#10). Density was a per-field attribute — a loaded gun that let
  30px sit beside 48px in one group. It is now a property of measured width, and a field cannot
  disagree with its neighbours because it cannot see anything they cannot.
- Both configurations are the same DNA: Screen 2 stacks, Screen 3 puts the label left with the
  value on its row, Screen 4 aligns a numeric column. C is not a compromise between the reference
  screens — it is the observation that they are one element at three widths.

The cost is two configurations to verify. I bound that cost in §5.1.

---

## 5. Refinement — adversarial pass 1

### 5.1 Two configurations is a drift risk, so the configuration surface is capped at three rules
If the container query could change type, ink, spacing or any state rule, C would be two components
wearing one name. **Law: the container query may only change grid track definitions.** It changes
exactly three declarations — `.wd-fields`'s columns, `.wd-field`'s subgrid opt-in, and
`.wd-field-body`'s subgrid opt-in. Every type, ink, state and enforcement rule lives outside the
query and is therefore provably identical in both configurations. Enforceable by grep.

### 5.2 The threshold must be measured, and there is house precedent for how
`tokens.md` has no width scale — and correctly so; a spacing scale does not govern breakpoints. But
`statusChip.css` already solved this exact problem in this exact house:

```css
--wd-col: 108px;   /* widened from .healthx-state 86px: "Not configured" */
```

Same method. `--wd-fld-ledger: 320px` = longest registry label (`Kill-switch arm delay`, 21ch at
T3 ≈ 139px) + `--sp-5` + a 9-digit tabular value at T4 (≈ 72px) + `--sp-3` + `USDC` at T6 (≈ 30px)
≈ 259px, plus headroom for a copy target and a wider unit. It is a **content measurement, with its
arithmetic shown**, not a number from the spacing scale wearing a costume.

### 5.3 The dirty dot was solving a problem the toggle already solved better
Last round: a 5px accent dot on the label meant "uncommitted". The panel killed it twice — clipped
by the label's own `overflow: hidden` (#4), and a second, geometrically different dot beside the
house's existing typographic bullet (#14). Both true, but the deeper error is that a dot is *one
mark decorated*, and `toggle.md` §3 already proved that wrong for this app:

> A conventional switch is a single mark on a single axis… When there are two facts, one mark must
> lie.

A scalar setting has the same two facts as a boolean control: `desired` and `effective`. So the
field does what the toggle does — **it draws both.** The effective value is the value (server
truth, `--ink-1`); the desired value goes on the subordinate line as text:
`Requested 500 ms · not yet effective · rev 4471`.

This deletes the dot, deletes the accent from the element entirely, and answers #15 ("one accent,
spent three times") by spending it **zero** times. The only accent left is the house focus ring,
which `motion.css` already declares exempt: *"Transient chrome, not data ink: exempt from the L3
accent budget."*

It also fills a real gap in the fleet: `toggle` covers **boolean** controls; nothing covered
**scalar** ones, which have identical desired/effective semantics. That is this element's
product-specific job, and it is the answer to #30.

### 5.4 The semantic icon set was drift, and deleting it is L10
Last round put a 14px icon (clock / question / plug-off / flask / triangle / lock) on a 16px gutter
on every note. `.wd-chip-reason` — the page's *other* subordinate line, already shipped — has no
icon. Two subordinate-line treatments on one page is the drift L10 exists to prevent, and the
sibling shipped first. **The note has no icon.** It adopts `.wd-chip-reason` exactly: T5, `--ink-3`,
`tabular-nums`, `<b>` for a prior state, `<code>` for an identifier.

This also disposes of the panel's #21 ("flask vs clock is ~4 differentiated pixels, and zero from
three metres"). The panel is right that a 14px glyph is invisible at distance — but so is a 12px
number. **Wall legibility belongs to the chip**, which is built for it with a three-step fill
ladder. **The field is a reading-distance element.** That is the correct division of labour between
two elements, not a concession.

### 5.5 The ink tiers *are* the confidence ladder — I don't need a parallel one
`tokens.md` names `--ink-1` "values" and `--ink-2` "**secondary truth**". That is the vocabulary I
was about to reinvent. So the field's whole confidence model is three tiers, not six states:

| | ink | note | meaning |
|---|---|---|---|
| `data-proof="direct"` (default) | `--ink-1` (Lc 98) | optional | measured, fresh, canonical |
| `data-proof="qualified"` | `--ink-2` (Lc 80) | **required** | a real number the engine is acting on, whose provenance is not clean — stale, derived, or substituted |
| no value at all | — | — | not a value; renders `<StatusChip>` in the cell |

This also repairs the panel's #20 without argument. Their complaint was that `--text-2` vs `--text`
is 1.48:1 — the same colour. `--ink-2` vs `--ink-1` is **18 APCA Lc apart** and pinned to that gap
in both themes. The measurement specialist fixed it at the layer where it was broken.

`qualified` deliberately **merges** last round's `stale`, `synthetic` and the panel's requested
`fallback` (#23). All three are the same fact at the field's altitude — *the number is real, its
provenance is not clean* — and they differ in the only way that can carry the difference at reading
distance: **the sentence**. `Last proven 14m ago · budget 60s` / `30-block median · primary oracle
blocklisted 09:41` / `Fixture data · not a live reading`. Three states rendered as one shape plus
three consequences beats three shapes nobody can tell apart.

### 5.6 The enforcement guard shrinks, and speaks the sibling's words
One rule survives: `qualified` without a note. The `unavailable`/`failed`/`gated` cases are
`StatusChip`'s, and it already enforces them with `REASON_REQUIRED` + a `defect` tone + a DEV
`console.error`. My guard reuses the sibling's exact hatched-dashed treatment and its exact
operator-facing words — **`Reason missing`** — instead of last round's
`TRUTH DOCTRINE VIOLATION · REASON REQUIRED`, which was 43 characters of engineer-facing mono shown
to a trader mid-incident (#25). The developer-facing message goes to `console.error`, matching
`StatusChip.tsx` line-for-line.

---

## 6. Refinement — adversarial pass 2

### 6.1 `<output>` was making the whole page a live region — and `display: contents` was the trap
Panel #26 is correct: `<output>` carries an implicit `role="status"`, so forty of them queue forty
polite announcements per poll tick. Fixed to plain elements.

But fixing it exposed a worse one. To get the shared numeric track, the value/unit/copy must be
grid items of the group's track set — while `<dl>` semantics want them inside one `<dd>`. The
obvious escape is `display: contents` on the `<dd>`, and that is a **bug**: `<dd>` carries an
implicit `definition` role, and `display: contents` removes it from the accessibility tree.

The correct answer is **nested subgrid**, which costs nothing and keeps the markup honest:
`.wd-fields` (the `<dl>`) defines four tracks → `.wd-field` (the `<div>` group) subgrids them →
`.wd-field-body` (the `<dd>`) subgrids tracks 2–4. Full `<dl>/<div>/<dt>/<dd>` semantics, a shared
column set, no `display: contents`, no ARIA patch. This is the one place sophistication earned its
place, and §4/ref 2 is where I refused it when it hadn't.

### 6.2 Empty tracks were about to cost 12px of trailing gutter
With four tracks and a `column-gap`, a group containing no units and no copy buttons still pays two
gaps. **Fix: `column-gap: 0`, and spacing carried as `padding-inline-start` on the unit and copy
cells.** An absent cell then costs exactly zero, and the digits still terminate on track 2's right
edge. This is how a ledger is actually built, and it removes a whole class of "why is there a gap
there" bugs.

### 6.3 I deleted the hero variant rather than invent a seventh type level
Last round had `data-scale="hero"` at 18px/48px — not on any scale. The obvious repair was a
`--lede` modifier mirroring `.wd-status--lede`. I checked what it would cost: a hero value wants T2's
14/20 at value weight 500, which is a **seventh** combination in a system whose own rule is *"a
consumer picks a role, never four independent values."* **Deleted.** If a value must be large it is
a page summary, and that belongs to the summary element. One less thing, one law kept.

### 6.4 The false ellipsis, and why the fix is the better idea
Panel #6: `<b>0xb0bD2c91Ae7731</b><i>…5f5415</i>` hard-codes the ellipsis, so a fully-visible
address still reads as truncated — an operator failing a verification that should have passed.
Fixed exactly as proposed: no literal `…`; `text-overflow: ellipsis` on the head supplies it *only*
on overflow. Self-correcting, deterministic, no `ResizeObserver`. This is the version of L8 I was
reaching for and missed.
Tail length becomes `--wd-fld-tail`, because 6 characters is right for an address and too few for a
commit SHA — last round's open question, now a token.

### 6.5 The value's ink must never move for a reason that is not about the data
Stated as a law because three separate defects last round were violations of it: the gated state
dimmed nothing (correct), the commit-pending state dimmed the value to `--muted` (**wrong** — that
is *your* action, not the data's confidence), and `--text-2` for stale was right in intent and
imperceptible in fact. The commit state is gone with the input. The law stays:

> **`--ink-1` → `--ink-2` is the only permitted movement of the value's ink, and only
> `data-proof` may cause it.** Not focus, not hover, not permission, not a pending write.

### 6.6 This element blocks on the token PR, and says so instead of degrading quietly
`--ink-1/2/3` are specified in `tokens.md` but not yet in `styles.css`. The tempting move is
`var(--ink-3, var(--muted))`. I will not ship that: `--muted` in dark measures **Lc −30.9**, which
`tokens.md` demonstrates is *disabled-text* contrast, and rendering the reason a check failed at
disabled-text contrast is a truth-doctrine breach expressed as a number. **No fallback is provided
for truth-bearing ink.** Fallbacks are provided only for non-truth chrome (hover fill). The element
lands after, or in, the token PR. Stated as a dependency, not smuggled as a degradation.

---

## 7. The element (final)

### 7.1 Anatomy

```
.wd-fields                <dl>   the group. Owns the container query and the shared track set.
└─ .wd-field              <div>  one named fact. data-proof carries the only state it owns.
   ├─ .wd-field-label     <dt>   TIER 1 · T3 10/14/600 UPPERCASE +.06em · --ink-3 · NEVER truncated
   └─ .wd-field-body      <dd>   subgrids tracks 2-4
      ├─ .wd-field-value         TIER 2 · T4 12/16/500 · --ink-1 · numeric -> tabular + right
      │  └─ .wd-field-id         mono, middle-truncated, no literal ellipsis
      ├─ .wd-field-unit          T6 10/14/450 · --ink-3 · own track, shared width, baseline-aligned
      ├─ .wd-field-copy   <button> 24px (32 coarse) · --r-sm · the only focusable thing here
      └─ .wd-field-note          TIER 3 · T5 11/16/450 · --ink-3 · == .wd-chip-reason · no icon
```

Where a fact has **no value**, `.wd-field-value` contains `<StatusChip>` instead of text. Same
cell, same column, the fleet's vocabulary, the fleet's reason guard.

### 7.2 The two configurations

| | stacked (< `--wd-fld-ledger`) | ledger (≥ `--wd-fld-ledger`) |
|---|---|---|
| `.wd-fields` columns | `minmax(0,1fr)` | `auto minmax(0,1fr) auto auto` |
| `.wd-field` | own 3 columns | `grid-column: 1/-1` + `subgrid` |
| `.wd-field-body` | own 3 columns | `subgrid` |
| label | row 1, spans | column 1, same row as value |
| numeric edge | per field | **shared across the whole group** |
| label truncation | wraps | never (column is `auto`) |

Nothing else differs. Not one type, ink, state or enforcement rule.

### 7.3 Ownership boundaries (so the next agent doesn't re-litigate them)

| concern | owner |
|---|---|
| state words, tones, reason-required for states | `StatusChip` |
| boolean control posture, preview/confirm/submit | `toggle` |
| row height, zebra, row-scope change mark | table owner + `motion.css` |
| every number in the scale, every ink | `tokens.md` |
| **name↔value geometry, numeric column, provenance line, identifier truncation** | **this element** |

---

## 8. Open questions

1. **The font is not loaded.** Blocking for the app, not for this element (§2). Needs
   `InterVariable.woff2` + `@font-face { font-weight: 100 900 }` in `/public`. Until it lands, any
   sibling whose hierarchy rests on a 50-weight step is rendering a fiction; mine is not, by
   construction, but I cannot fix theirs.
2. **`--ink-*` are specified, not shipped.** This element blocks on the `tokens.md` §8 PR (§6.6).
   Someone must own the sequencing.
3. **`.pcr-surface-evidence` migration.** Still the most expensive item, and still not mine to
   schedule. `.wd-field` is a rename target for it (`dt` 10/560 uppercase → T3; `strong` mono
   10.5 → T4; `min-height: 48px` → the group's own rhythm). Shipping alongside it is worse than
   shipping neither. Acceptance criterion, not an open question — but the *owner* is open.
4. **`--wd-fld-ledger: 320px` assumes `Kill-switch arm delay` is the longest label in the
   registry.** I measured against the control names I could find. If the registry can produce a
   40-character label, the threshold needs re-measuring — and it should be a **generated** constant,
   computed from the registry at build time, not a hand-measured one.
5. **Does the copy affordance belong to every transcribable value, or only identifiers?** I ruled:
   every identifier and every value an operator would transcribe **must** carry one, because
   declining `tabindex="0"` on forty read-only values (correct) leaves no keyboard path otherwise.
   The list of "transcribable" fields is a product decision I made by proxy.
6. **`--r-sm` (8px) vs the live 7px row action.** `statusChip.css` chose `--r-sm` for containers;
   the house's newest action button (`.healthx-button`) ships a raw `7px`. My copy button uses
   `--r-sm` because 7px is a literal no token sanctions. Someone should retire the 7px.
