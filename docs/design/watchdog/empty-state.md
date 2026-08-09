# Watchdog — panel-level empty / not-yet-measured state

**Round 2.** Written after a review panel filed 29 defects against round 1, and after reading the
four roster files round 1 claimed to harmonise with but had not opened.

---

## 0. The finding that reframes the element

Round 1 built a parallel universe. It invented `--wde-1..8` spacing, a `9.75/10.5/11.5` type
ramp, a `.wde-fact dt/dd` label-value row, a `midTrunc()` helper, a `.wde-token` state
vocabulary, a `.wde-sr` utility, and a focus-ring system.

Every one of those already ships in `web/src/features/watchdog/`:

| round 1 invented | already owned by | evidence |
|---|---|---|
| `--wde-1..8` spacing | `tokens.md` §7.1 `--sp-1..9` | 2px sub-grid ≤ 8, 4px grid ≥ 12 |
| `9.75 / 10.5 / 11.5px` | `tokens.md` §7.2 T1–T6 | *"Every font-size is an integer — no 13.5, no 11.5, no 10.5"* |
| `430 / 520 / 560` weights | `tokens.md` §7.2 | *"450 / 500 / 550 / 600, step 50, four values, no others"* |
| `.wde-fact dt/dd` row | `field.css` `.wd-field` | shared **subgrid** numeric track, not a per-row `auto` |
| `midTrunc()` in JS | `field.css` §5 `.wd-field-id b` | self-correcting CSS middle-truncation, no ResizeObserver |
| `.wde-token` states | `statusChip.css` | *"ONE vocabulary … One state vocabulary on this page, not two"* |
| `.wde-sr` | `field.css` §12 `.sr-only` | already promoted to root scope for exactly this reason |
| focus rings | `motion.css` §5 | `.watchdog :focus-visible` + the inset variant for clipped rows |

`field.css` states the boundary outright:

> *"It does NOT own state. Where a fact has no value, `<StatusChip>` renders in the value's own
> cell. One state vocabulary on this page, not two."*

So the panel-level empty state does not own rows, tokens, words, truncation, or motion.

**What it owns is the obligation set:** which facts a panel is *required* to state when it has
nothing to show, who is required to author that claim, and the rule that decides whether a control
exists at all. It is a composition contract, not a widget. Round 1's real defect was not any of
the 29 items filed — it was building pixels where it should have been writing obligations.

---

## 1. Verification of the panel's 29 defects

Computed with an sRGB WCAG implementation (`scratchpad/c.py`) against the real token root
(`styles.css:7–117`).

### Upheld — 24 of 29

| # | claim | verified |
|---|---|---|
| 1 | `#b06a12` = 4.27:1 on white, fails AA | **4.27** ✓ |
| 2 | dark `--muted` on `--panel` fails 4.5 | **4.15** ✓ (panel wrote 4.28; `statusChip.css` wrote 4.15 — the chip is right) |
| 3 | `--faint` 2.54 light / 2.40 dark, fails even 3:1 | **2.54 / 2.40** ✓ |
| 4 | `NOT LEDGERED` and `ControlsPanel.tsx` do not exist | ✓ zero hits; real file is `ControlRegistryPanel.tsx`; real labels are `DRY-RUN` / `SYNTHETIC` / `REPLAY` (`presentation.ts:227`) |
| 5 | `.sdx-tag` is 9px, not 10px | ✓ `systemDashboard.css:426` |
| 6 | `.sdx-node-facts` is `gap:3px`, weight `420`, `gap:10px` | ✓ `systemDashboard.css:370–399` |
| 7 | `no-observer` is computable; house word is **MISSING** | ✓ `presentation.ts:51` + 5 render sites |
| 8 | `.watchdog * { transition-property: none }` kills unnamed transitions | ✓ `motion.css:96` |
| 9–10 | motion tokens off-scale; settle inverts M1 | ✓ conceded in full |
| 11 | two focus systems | ✓ `motion.css:195` |
| 12 | conflicting second status vocabulary | ✓ conceded in full |
| 14 | accent double-spend | ✓ `statusChip.css:46` |
| 15 | verdict column ragged by 6px | ✓ self-refuting from round 1's own CSS |
| 16–21, 23–25 | geometry, colour-budget hole, truncation, dead container query, skeleton shift, gated-absence, `title` as sole carrier, `aria-labelledby`, `:first-child` | ✓ all upheld |
| 27–29 | three variants were one slider; four decorative references; **element does not know money is at risk** | ✓ upheld, and #29 is the one that matters |

### Corrected — 5 of 29, with evidence

The panel did not read `docs/design/watchdog/tokens.md`. Five of its fixes migrate the element
*backwards* into the drift the token file exists to end.

**#1 fix is wrong in mechanism.** The panel says adopt `#a3660f` (4.70:1 — it does pass). But
tokens.md §8 step 4 specifies a CI gate: *"no hex literal in any file except the token root."*
`#a3660f` in a feature file is the same class of defect as `#b06a12`, just a luckier number.
tokens.md §1 finding (2) counts **17 amber literals** already loose in the tree and §8 step 1 is
"Define `--warn`". The correct fix is `var(--warn)` — and then, per §4 below, not to use it at all.

**#5 fix is wrong.** The panel prescribes `9px` to match `.sdx-tag`. 9px is not on the type
scale either; T3 and T6 are **10px/14px**, separated by weight and case. `.sdx-tag`'s 9px is
legacy that §8 migrates away from. Matching it is drift with a citation.

**#6 fix is wrong, and the panel says so itself.** It concedes the house's `3px/10px/420` are
off-scale, then recommends adopting them anyway "because a mismatched baseline is more visible
than an off-scale token." That trade only exists if this element sits beside `.sdx-node-facts`.
It does not — it sits inside the watchdog roster and composes `.wd-field`, whose rows are already
`--sp-*` on a shared subgrid. There is no baseline to mismatch. The dilemma dissolves.

**#13 is right about the outcome, wrong about the reason.** The panel says amber is "banned by
name on CVD grounds." tokens.md §7.4 sanctions `--warn` as one of four hues (`#8f5d07` light /
`#e6b44f` dark, channel "ink or tint"). `statusChip.css` declined amber *for the chip's own tone
ladder*, which is an element-scoped choice, not a system ban. The real reason amber is wrong here
is sharper — see §4.

**#3 fix is superseded.** The panel prescribes `--muted-2`. tokens.md §8 step 3 collapses
`--muted-2` and `--muted` both into `--ink-3`. The separator question disappears entirely once
the glyphs are deleted, which is what §6 does.

### Missed by the panel

- **`field.css` exists and forbids this element from owning label/value rows.** Larger than any
  filed defect.
- **`data-proof="qualified"`** (`field.css` §9) is the house's *substitution* mechanism — "stale,
  derived, or substituted for a failed primary," rendered at `--ink-2` with a **mandatory** reason
  enforced in production. The panel called substitution an unexplored axis; it is half-built.
- **`.sr-only` already exists** at root scope.
- **`exposureVerdict()` is tri-state** — `ACTIVE / NONE / UNKNOWN`, where *"absence is proven only
  by explicit zero count and amount"* (`presentation.ts:28`). This is the spine of §4.
- **Round 1's Honeycomb citation was partly fabricated.** Re-fetched: the docs do *not* enumerate
  "bad API token" or "retention window." The real causes are throttling (*"discard 9 out of 10
  spans after receiving too many spans for several days"*) and restrictive time ranges, where
  *"spans started before that range begins will appear missing."* Corrected in §2 — the real cause
  is better than the invented one.

---

## 2. References

Re-fetched this round. Round 1's four "design-system" references were cited at length and then
overruled; they are cut to the single line of each that survives.

1. **Prometheus — `absent()` / `absent_over_time()`**
   <https://prometheus.io/docs/prometheus/latest/querying/functions/>
   *"This is useful for alerting on when no time series exist for a given metric name and label
   combination."* Taken: absence is a **first-class queryable object that carries the selector's
   own labels** — the formal basis for "emptiness is a claim with an author." `absent_over_time()`
   adds *"for a certain amount of time"*, which is why **UNMEASURED FOR** is a mandatory row and
   not an optional nicety.

2. **Prometheus — staleness**
   <https://prometheus.io/docs/prometheus/latest/querying/basics/>
   *"If a target scrape or rule evaluation no longer returns a sample for a time series that was
   previously present, this time series will be marked as stale"* and a query after that point
   returns nothing. Taken: a panel that *had* data is categorically different from one that never
   did, and the last value is never carried forward. Maps onto the house's own `SILENT`.

3. **Grafana — alert rule state and health**
   <https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/state-and-health/>
   *"The No Data state occurs when the alert rule query runs successfully but returns no data
   points at all"* vs *"The Error state is triggered when the alert rule fails to evaluate its
   query."* Taken: two states, never one rendering. The `DatasourceNoData` instance carries
   `alertname`, `datasource_uid`, `rulename` — the literal field list of the byline. And *"Keep
   Last State … preventing alerts from unintentionally firing"* is named as the forbidden one.

4. **Grafana — standard options, "No value"**
   <https://grafana.com/docs/grafana/latest/panels-visualizations/configure-standard-options/>
   *"Enter what Grafana should display if the field value is empty or null. The default value is a
   hyphen (-)."* Taken as the **named anti-pattern**: the industry default for an unmeasured field
   is a hyphen. `presentation.ts` already forbids it (`UNKNOWN_TEXT`, "never blank, never green,
   never zero"). Round 1 asserted this rule; this round can cite the exact default it rejects.

5. **Datadog — `on_missing_data`**
   <https://docs.datadoghq.com/monitors/guide/on_missing_data/>
   Four options verbatim: `show_and_notify_no_data`, `show_no_data`, `resolve` = *"Show OK"*, and
   `default` = *"Evaluate as 0 (or other default value)"* for sum/count, *"Show last known
   status"* otherwise. Taken: the last two are the productised forms of the lie this app forbids,
   so the empty state may never render a numeral as a measurement.

6. **Datadog — troubleshooting No Data**
   <https://docs.datadoghq.com/monitors/guide/troubleshooting-no-data/>
   Group-by tags combine with AND, so one absent tag yields No Data; metrics with past timestamps
   trigger No Data although visible elsewhere. Taken: these are **unguessable**, so REASON carries
   a greppable machine code as selectable text, never prose alone.

7. **Honeycomb — common issues with data**
   <https://docs.honeycomb.io/troubleshoot/common-issues/data-in-honeycomb/>
   *"discard 9 out of 10 spans after receiving too many spans for several days"*; and on time
   range, *"spans started before that range begins will appear missing."* Taken: a cause where
   **the query window itself manufactures the emptiness** — the data exists. Its control moves the
   window; it does not retry a query that cannot succeed. (Round 1's "retention window" citation
   was wrong; this is the real one.)

8. **Google SRE Workbook — Alerting on SLOs**
   <https://sre.google/workbook/alerting-on-slos/>
   Cited as a **negative result**, checked deliberately. Six alerting strategies, all burn-rate
   based, and no treatment of telemetry that stops arriving. The canonical framework assumes
   reliable collection. Taken: there is no borrowable prior art for "the observer failed", which
   is why §4 derives the rule from this app's own domain rather than importing one.

9. **Rauno Freiberg — Web Interface Guidelines**
   <https://interfaces.rauno.me/>
   *"Empty states should prompt to create a new item, with optional templates"* — named as the
   guideline this element **rejects** for 11 of 13 causes (§7). Adopted verbatim: *"tabular
   figures … particularly in tables or when layout shifts are undesirable, like in timers"*;
   *"Disabled buttons should not have tooltips, they are not accessible"*; *"Icon only interactive
   elements should define an explicit `aria-label`."*

10. **Nielsen Norman Group — Designing Empty States**
    <https://www.nngroup.com/articles/empty-state-interface-design/>
    The one surviving line: name the filter in the message — *"There are no records to display for
    the selected date range"* — hence WINDOW is mandatory in every cause. Plus the loading trap:
    showing "No records" before content arrives is *"particularly harmful."*

11. **AWS Cloudscape — Empty states**
    <https://cloudscape.design/patterns/general/empty-states/>
    One line: the zero-results action label is the fixed string **"Clear filter"**, used verbatim
    rather than inventing a synonym. Their "always use secondary button style" is why the single
    control is never solid.

12. **Vercel Geist — Empty State**
    <https://vercel.com/geist/empty-state>
    One line: *"The CTA must be a real Button or Link, not an onClick div."* Their "cap at one
    primary CTA" survives only as the cap; §7 renders zero in most cases.

**In-tree, load-bearing:** `tokens.md` §7.1/§7.2/§7.4 (scale, type, hue channels), `field.css`
(rows, subgrid, truncation, `data-proof`, `.sr-only`), `statusChip.css` (tone vocabulary, fill
ladder, CVD reasoning), `motion.css` (M1/M3/M6, the `transition-property: none` guard),
`presentation.ts` (`exposureVerdict`, `freshnessOf`, `truthBadge`, `EXPECTED_COMPONENTS`),
`DASHBOARD_TRUTH.md` (*"The UI may format, never infer"*).

---

## 3. Four variants — genuinely different variables

The panel was right that round 1's A/B/D were three points on a density slider. These four move
different variables, and two of them are the axes the panel named as never explored.

### E · Delegation — *variable: where the claim lives*
Panel bodies render nothing at all. Every emptiness aggregates into one page-level coverage line:
*"4 of 14 components unmeasured — capital-supervision, multileg-risk, …"* One claim, authored
once, instead of twelve.

**Verdict: loses, but takes the roster's best idea with it.** Twelve panels each repeating its own
byline is genuinely redundant, and a page-level coverage statement is something this app currently
lacks. But delegation makes *per-panel* absence invisible at the point of use: an operator reading
the basis-engine panel must look elsewhere to learn it is blind. Worse, it cannot express
per-panel exposure, which is the one fact that varies most between panels. **Surviving idea:**
`EXPECTED_COMPONENTS` diffing belongs at page level as a coverage line — filed as a separate
element, not folded in here.

### F · Substitution — *variable: whether a value is shown at all*
Render the last known values, dimmed, with an explicit invalidation overlay and an age.

**Verdict: loses as an empty state, and the tree proves why it must not be one.** `field.css` §9
already implements exactly this as `data-proof="qualified"` — *"stale, derived, or substituted for
a failed primary"* at `--ink-2`, with a mandatory reason enforced in production. So substitution is
**not this element's job**: if a value exists at all, the panel is not empty, and `.wd-field`
handles it. This is a boundary discovery, not a rejection. **Consequence:** round 1's `stale-gone`
state was wrong — a panel with a last-known value must render qualified fields, not an empty
state. The empty state is reached only when there is nothing to qualify.

### G · Obligation ledger — *variable: the subject of the message*
The block is not about the missing data. It is about the **unmet measurement contract**: what this
panel promised to measure, against what window, on whose authority, and what is at stake while it
cannot. Composed entirely from `.wd-field` + `<StatusChip>`.

**Verdict: WINNER.** It is the only variant whose subject is a thing the app can actually prove.
Data absence is unprovable in detail; the contract is a known object. It composes rather than
invents. And it is the only one with a natural slot for exposure, which §4 shows is the element's
reason to exist.

### H · Byline-only inversion — *variable: what the minimum viable claim is*
Strip everything except one mono line: `engine-supervisor · rev 4182 · 0 rows · 04:12:07Z`. No
words, no chrome. Maximum density, maximum honesty, zero interpretation.

**Verdict: loses, narrowly, and it is the one that nearly won.** It is beautifully non-generic and
it cannot lie. But it fails L7 — it states facts and never the consequence, so an operator must
already know what "0 rows" implies for this panel. It also has nowhere to put exposure without
becoming G. **Surviving idea:** its discipline sets the byline's format exactly, and its "no
interpretation" rule is why the byline sits below a hairline, visually separated from the
interpreted rows above it.

### Sub-variant killed in refinement
**G′ · with a coloured state rail.** A 2px left rail encoding cause family, for cross-panel
scanning. Killed: it duplicates the verdict chip, puts a colour on every surface (L3), and
manufactures hierarchy from a stripe rather than fill (L1). `statusChip`'s fill ladder already
gives cross-panel scanning for free.

---

## 4. The rule that makes this element non-generic

The panel's defect #29 is the only one that matters: *"Strip the trading nouns out of the copy and
this element drops unchanged into any Grafana clone."* True of round 1. Here is the fix, derived
from the tree rather than asserted.

`presentation.ts:29` — exposure is **tri-state**, and *"absence is proven only by explicit zero
count and amount."* `MachineGraph.tsx:76` renders `CAPITAL EXPOSED` per component. So the app
already knows, per component, whether money is at risk — and already knows it might not know.

Cross that with an unmeasured panel and the matrix is:

| exposure | unmeasured panel means | rendering |
|---|---|---|
| `NONE` (proven zero) | a blind spot with nothing behind it | **hueless** |
| `UNKNOWN` | blind, and the loss is unbounded | verdict escalates to **tinted `--bad`** |
| `ACTIVE` | money is at risk *and* nobody is watching it | exposure value goes **solid `--bad`** |

Three consequences:

**(a) The absence itself is always hueless.** tokens.md §7.4: *"Unknown / unavailable /
not-configured have no hue — `--ink-3` plus a mandatory reason."* And `--warn` means *"degraded,
still serving"* — **an empty panel is by definition not serving**, so `--warn` is structurally
unavailable to this element. That is a stronger reason than the panel's CVD argument, it reaches
the same place, and it deletes round 1's five-state amber tier outright (defects #13, #17, #22).

**(b) The only hue an empty panel may carry is `--bad`, and only exposure or the house's own
`componentTone()` may spend it.** `freshnessOf` → `SILENT` already maps to `bad` in
`presentation.ts:202`; that is inherited, not invented. Everything else is `--ink-3`. The colour
budget is now enforced by *which row is allowed to be coloured at all*, closing the hole the panel
found at #17 — and the accent is never spent, so `held` keeps its exclusivity (#14).

**(c) The solid fill is earned by money, not by taxonomy.** Round 1 gave its only solid fill to
`no-observer` on the argument that "an unobserved component is worse than a broken one." That is a
slogan. The house already made this decision: `.sdx-tag.exposed { background: var(--down);
color: #fff }` — the legacy dashboard spends its one solid fill on **CAPITAL EXPOSED**. Inheriting
that judgement is both non-arbitrary and precedented.

And the structural argument that makes exposure the **first** row rather than a footnote:
the panel's query is what failed; the component record is a different object and is usually still
present. **Exposure is renderable precisely when nothing else is.** It is the fact that survives
the panel's own failure — which is exactly why it goes first, on evidence grounds rather than
drama. It is also the row that makes the consequence sentence unwritable in any other product:

> *"Capital is exposed on this lane and no probe has confirmed the position since 04:12."*

---

## 5. Anatomy

Anchored top-left. The card stretches; the block does not. Space below stays honestly blank —
`.sdx-unavailable { place-items: center; min-height: 220px }` (`systemDashboard.css:980`) is
deleted, along with its 47 siblings.

```
<section class="wd-empty">                          role/live per §9
  1  VERDICT       <StatusChip>            statusChip.css — tone + word + reason. NOT mine.
  2  OBLIGATION    <dl class="wd-fields">  field.css — shared subgrid, mandatory row set below
  3  CONTROL       0 or 1                  rule table §7
  ─────────────── hairline ───────────────
  4  BYLINE        who authored the claim of emptiness
</section>
```

### The mandatory row set

Rows are `.wd-field`. Order is fixed — a stable row order across twelve panels is what makes a
grid of empty panels scannable, and it costs nothing.

| row | when | value | why mandatory |
|---|---|---|---|
| `EXPOSURE` | unless `exposureVerdict` is proven `NONE` | `ACTIVE · 3 positions` / `UNKNOWN` | §4 — survives the panel's own failure |
| `WINDOW` | **always** | `last 5m` | NN/g: name the range. Datadog: inherit the query's own window, never invent a second |
| `LAST PROOF` | **always** | age, or `NEVER` | Prometheus staleness — an age, never the value |
| `SOURCE` | **always** | mid-truncated id via `.wd-field-id` | who was asked |
| `UNMEASURED FOR` | when `LAST PROOF` ≠ `NEVER` | duration | `absent_over_time()` — absence has a length |
| `NEXT` | only if a clock exists | tabular countdown | replaces variant C's animated rail with one row |
| `REASON` | mandatory for `unavailable`/`denied`/`error`/`not-configured` | `E_SOURCE_UNREACHABLE` | Datadog: causes are unguessable; greppable, selectable |
| `ACTION` | **always** | `NONE — CLOCK ONLY` / `NONE — REQUIRES ROLE ops.reader` | defect #21: absence stated, never inferred |

A fact that does not exist **omits its row**. It never prints a hyphen — that is Grafana's
documented default for a null field and this app's `UNKNOWN_TEXT` law forbids it.

`ACTION` being mandatory is the fix for the panel's sharpest logical catch: with no positive
marker, "nothing to press by design" and "someone forgot the button" look identical.

### Enforcement, in production

Adopted from `field.css` §10, which renders a hatched `"Reason missing"` when a qualified value
lacks its note. Same treatment, same words, same `console.error` path:

- a cause in `{unavailable, denied, error, not-configured}` with no `REASON` row
- any `.wd-empty` with no byline

Both render `statusChip`'s `defect` tone. The doctrine is a runtime invariant, not a code-review
convention.

---

## 6. CSS

```css
/* =========================================================================
   Watchdog — panel-level empty / not-yet-measured state.
   Deletes .sdx-unavailable (systemDashboard.css:980) and its 47 siblings.

   OWNS: the block frame, the exposure escalation, the byline, one control.
   DOES NOT OWN: rows (field.css), state words (statusChip.css), motion and
   focus (motion.css), scale (tokens.md). Composition, not invention.

   Declares ONE custom property. Every length, size, weight, ink and hue is a
   token from tokens.md §7. Zero hex literals, per §8 step 4's CI gate.
   ========================================================================= */

:root, [data-theme="light"] {
  /* Optional. Set per-panel ONLY when the grid is masonry; a CSS grid with
     align-items:stretch makes it unnecessary. Space below stays BLANK — it is
     never padded, divided or decorated. */
  --wd-e-reserve: auto;
}

/* ---- 1. the block ------------------------------------------------------- */
.wd-empty {
  display: grid;
  align-content: start;          /* the CARD stretches; the BLOCK does not */
  justify-items: start;          /* never centred */
  gap: var(--sp-5);
  padding: var(--sp-5) var(--sp-6) var(--sp-6);
  min-block-size: var(--wd-e-reserve);
  text-align: left;
  color: var(--ink-3);
}

/* Sits below a band header that already draws a hairline. Attribute, not
   :first-child — the panel's #25 catch: a header sibling gave a double rule. */
.wd-empty[data-flush="true"] { padding-block-start: 0; }

/* ---- 2. obligation rows ------------------------------------------------
   .wd-fields owns its own container query, subgrid, truncation and note line.
   Round 1's @container (max-width:420px) was dead code anyway — container-type
   sat on .sdx-page, not the panel. It is not fixed here; it is DELETED, because
   field.css already scopes `container-name: wd-fields` to the group. */
.wd-empty .wd-fields { width: 100%; }

/* ---- 3. the exposure escalation — the only hue in the element -----------
   §4: the absence is hueless; --warn ("degraded, still serving") is structurally
   unavailable because an empty panel is not serving. --bad reaches SOLID on one
   condition only: unmeasured while capital is exposed. Precedent is the house's
   own .sdx-tag.exposed, which already spends its solid fill on this exact fact. */
.wd-empty .wd-field[data-obligation="exposure"][data-exposure="active"] .wd-field-value {
  padding-inline: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bad-solid);
  color: var(--bad-on);
}
/* UNKNOWN exposure gets NO hue on the word — presentation.ts's UNKNOWN law and
   tokens.md §7.4 both forbid it. The escalation lands on the verdict chip
   (tone="adverse-stop"), set by the component, not by CSS. */

/* ---- 4. the control — zero or one, per the §7 rule table ---------------
   --r-pill is the ACTION language (statusChip: "--r-pill stays reserved for
   actions, so a value never impersonates a control"). field.css's --r-sm copy
   button is an icon SQUARE, where a pill would render a circle — that is the
   reconciliation, and it keeps L2 at exactly two radii. */
.wd-empty-action {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  min-block-size: var(--row-h);            /* 28px, the page atom; > SC 2.5.8 */
  padding-inline: var(--sp-5);
  border: 1px solid var(--line-2);
  border-radius: var(--r-pill);
  background: var(--panel);
  color: var(--ink-2);
  font: 500 12px/16px var(--font);         /* T4 */
  white-space: nowrap;
}
@media (pointer: coarse) { .wd-empty-action { min-block-size: var(--sp-8); } }

/* motion.css ships `.watchdog * { transition-property: none }`, so a transition
   must be NAMED to exist at all. Chrome only, never truth ink. Same pattern and
   same clock as .wd-field-copy. */
.watchdog .wd-empty-action {
  transition-property: color, background-color, border-color;
  transition-duration: var(--mo-1);
  transition-timing-function: var(--mo-out);
}
@media (hover: hover) {
  .wd-empty-action:hover {
    border-color: var(--line-strong);
    background: var(--hover);
    color: var(--ink-1);
  }
}
/* NO :focus-visible rule. motion.css §5 owns the ring. The residual house bug
   (styles.css:146 sets border-radius:4px inside :focus-visible, which snaps this
   pill on keyboard focus) is filed against motion.css as
   `.watchdog :focus-visible { border-radius: inherit }` — fixed once, for the
   whole roster, not re-solved per element. */

/* ---- 5. the byline — emptiness is a claim, and a claim has an author ----
   Fields: Grafana's DatasourceNoData instance carries alertname, datasource_uid
   and rulename. Format discipline from variant H: facts only, no interpretation,
   which is why the hairline separates it from the interpreted rows above.
   No separator glyphs — gap does the work, so there is no --faint decision to
   get wrong (--faint is 2.54:1) and a copy-paste yields clean text. */
.wd-empty-byline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: var(--sp-4);
  row-gap: var(--sp-1);
  width: 100%;
  padding-block-start: var(--sp-4);
  border-block-start: 1px solid var(--line);
  color: var(--ink-3);                      /* truth floor, Lc 64 — never --ink-mute */
  font-family: var(--mono);                 /* identifiers, per tokens.md §7.2 */
  font-size: 10px;                          /* T6 */
  font-weight: 450;
  line-height: 14px;
  letter-spacing: .015em;
  font-variant-numeric: lining-nums tabular-nums;
  user-select: text;
}
/* Nothing is measuring this component at all: EXPECTED_COMPONENTS diff. The
   house word is MISSING (presentation.ts:50), not round 1's invented NO OBSERVER. */
.wd-empty-byline b { color: var(--bad-ink); font-weight: 500; }

/* ---- 6. loading — never accompanied by any no-data wording -------------
   NN/g: showing "No records" before content arrives is "particularly harmful".
   Only the four ALWAYS rows render, so nothing appears or disappears on
   resolution (the panel's #20: round 1's skeleton guessed its row count).
   No pulse: motion.css already ships the non-terminal signal as the chip's
   data-proving glyph, and a second liveness animation is a second signal. */
.wd-empty[data-cause="loading"] .wd-field-value {
  min-inline-size: var(--wd-e-skel, var(--sp-9));
  border-radius: var(--r-sm);
  background: var(--tile);
  color: transparent;
}

/* ---- 7. motion ---------------------------------------------------------
   Deliberately empty, exactly as field.css §11. M1: a settled verdict never
   moves. M3: information appears at 0ms; only withdrawal is eased — and the
   verdict IS the information, so round 1's 150ms arrival settle was M1 and M3
   inverted at once. Reduced-motion, [data-instant] and [data-theme-switching]
   are all handled upstream; repeating them here would be dead CSS. */

/* ---- 8. forced colors --------------------------------------------------- */
@media (forced-colors: active) {
  .wd-empty .wd-field[data-obligation="exposure"][data-exposure="active"] .wd-field-value {
    background: Highlight;
    color: HighlightText;
    forced-color-adjust: none;
  }
}

/* ---- 9. print — a printed incident page is never a dead end ------------- */
@media print {
  .wd-empty-action { display: none; }
  .wd-empty { break-inside: avoid; }
}
```

---

## 7. The control rule table

| the operator can… | renders |
|---|---|
| cause it to populate — configure, clear their own filter, move the window, retry a failed query | ONE `.wd-empty-action`, secondary weight, verb + noun, real `<button>`/`<a>` |
| not cause it, but can see why | ONE disclosure in the panel's existing inspector — never a button-shaped control |
| only wait on a clock | NO control. A `NEXT` row **and** `ACTION: NONE — CLOCK ONLY` |
| nothing, ever — denied, missing observer | NO control. `ACTION: NONE — REQUIRES ROLE …` / `NONE — NO OBSERVER TO QUERY` |

Two of four rows render nothing, against the unanimous advice of NN/g, Cloudscape, Geist and
Rauno (*"Empty states should prompt to create a new item"*). Those systems are written for
content applications where emptiness is the user's to fill. In an evidence-gated observatory most
emptiness is not the operator's to fix, and a button that cannot change the outcome is theatre.
The `ACTION` row is what makes the refusal legible rather than merely absent.

---

## 8. Causes → house vocabulary

Eleven causes, mapped onto `statusChip`'s existing tones and the house's existing words. No second
vocabulary (defect #12). Round 1's `stale-gone` is deleted — a panel with a last-known value is
not empty, it is `data-proof="qualified"` (variant F). Round 1's `fixture` is deleted — the house
ships three distinct labels, and a dry-run is not a replay.

| cause | word (source) | tone | control |
|---|---|---|---|
| `loading` | `Checking…` | `absent` + `data-proving` | none |
| `awaiting` | `Awaiting first sample` | `absent` | none — clock |
| `silent` | `Silent` (`freshnessOf`) | `adverse-stop` (`componentTone`) | inspect |
| `filtered` | `No match` | `absent` | **Clear filter** (Cloudscape's fixed string) |
| `window-excludes` | `Outside window` | `absent` | move the window |
| `unavailable` | `Unavailable` (`truthBadge`) | `absent` — hueless per §7.4 | inspect |
| `denied` | `Owner gated` | `held` — accent is the chip's, not mine | none |
| `not-configured` | `Not configured` | `void` | configure |
| `error` | `Query failed` | `adverse-stop` | retry |
| `missing` | `MISSING` (`EXPECTED_COMPONENTS`) | `adverse-stop` | none |
| `unknown` | `UNKNOWN` (`UNKNOWN_TEXT`) | `absent` | none |
| `synthetic` | `DRY-RUN` / `SYNTHETIC` / `REPLAY` (`truthBadge`) | `absent` + `TRUTH` row | none |

Any of these crossed with `exposureVerdict !== NONE` escalates per §4.

---

## 9. Accessibility

- **Name.** `aria-labelledby={[panelHeadingId, chipId]}` — never the chip alone. Round 1 gave
  twelve panels the accessible name "UNAVAILABLE" (defect #24).
- **Live region, tiered by consequence.** The incumbent uses `role="alert"`
  (`SystemDashboard.tsx:68`); twelve assertive announcements on load is a screen-reader denial of
  service. So: `role="status"` (polite) while the cause can still change; no live region when
  terminal; and `role="alert"` **only** for unmeasured ∧ exposure `ACTIVE`. The downgrade is
  stated, not silent, and assertiveness is spent on money rather than on taxonomy.
- **Countdown.** The `NEXT` value is `aria-hidden` beside a static `.sr-only` phrase, so a polite
  region announces once rather than sixty times a minute.
- **Identifiers.** `.wd-field-id` keeps the full string in the DOM and truncates in CSS. No
  `title`, no JS slicing — so the middle of an id is reachable by copy, print and AT (defect #23).
- **No disabled controls anywhere.** An impossible action is absent, and its reason is the
  `ACTION` row (Rauno: disabled buttons must not carry tooltips).
- **Contrast.** Every text ink is `--ink-3` or better — the truth floor, Lc 64, pinned in both
  themes. `--ink-mute` never appears: it is non-truth ink by definition.

---

## 10. Adversarial pass 1 — what I still disliked

- **Was the byline a fifth `.wd-field`?** It would be more uniform. Kept separate: a field is a
  *measured fact about the system*; the byline is *provenance of this rendering*. Collapsing them
  would let the byline sort into the numeric column as though it were data. The hairline is the
  boundary, and variant H is why it carries no interpretation.
- **`--bad-solid` / `--bad-on` / `--bad-ink` are referenced but not yet emitted.** tokens.md §7.4
  documents the measured values (`#c62b39` light, white at Lc 81.4; `#d93a51` dark at Lc 75.3) but
  §8's migration has not yet written them as custom properties. Referencing them is correct; the
  file must not inline the hexes. Filed in §12.
- **`--sp-4` between byline segments.** Intra-component, on the scale, and it matches `.wd-status`
  using gap rather than glyphs. Kept, and stated rather than assumed.
- **Eleven causes is a lot.** But each maps to an existing house word and an existing tone; none
  invents a rendering. The count is the domain's, not the element's.

## 11. Adversarial pass 2 — hunting for anything still generic

- **"Emptiness is a claim with an author."** Round 1's best line, and it was still a slogan —
  sourced to a Grafana implementation detail. It is now sourced to `absent()`, which returns a
  series *carrying the selector's own labels*. Absence as an attributed object is a real
  primitive, not a metaphor.
- **The consequence sentence.** Test applied to every cause: *could this sentence appear in any
  other product?* Every one that could was rewritten until it named the window, the source, or the
  exposure. *"Capital is exposed on this lane and no probe has confirmed the position since
  04:12"* passes. *"No data available"* is the failure mode, and it is now structurally impossible
  because WINDOW and SOURCE are mandatory rows.
- **The solid fill.** Round 1 justified it with a slogan ("an unobserved component is worse than a
  broken one"). It is now inherited from `.sdx-tag.exposed`, an existing house decision about what
  deserves the only solid fill on the page.
- **Anything decorative?** The element ships no icon of its own, no illustration, no rail, no
  animation, and one custom property. The remaining chrome is one hairline, which separates
  interpretation from provenance and therefore carries meaning.
- **Anything at the wrong weight?** `ACTION: NONE — CLOCK ONLY` renders at the same T4/500 as
  every other value. A refusal is the same semantic level as an answer (L10). It is not dimmed to
  look subordinate, because it is not subordinate — it is the answer to the operator's actual
  question.

## 12. Open questions

1. **Emit `--warn`, `--bad-solid`, `--bad-on`, `--ink-1..3` as real custom properties.**
   tokens.md §7 measured them; §8 has not yet written them into the token root. Until then this
   file references properties that do not resolve. Blocking.
2. **`.watchdog :focus-visible { border-radius: inherit }` in motion.css.** `styles.css:146`
   rewrites the radius of any focused element; the pill control snaps on keyboard focus. One line,
   fixed once for the roster.
3. **Does the snapshot expose `nextEvaluationAt` and the panel's own `window`?** If not, the
   `NEXT` row is omitted and `awaiting` becomes a silent state with no clock — which changes the
   control rule table's third row. Needs the real shape from `lib/systemIntegration`.
4. **Page-level coverage line** (variant E's surviving idea): `EXPECTED_COMPONENTS` diffed against
   the snapshot, stated once at page level. Belongs to a separate element; filing it here so it is
   not lost.
5. **`--r-pill` for the control vs `--r-sm` for `.wd-field-copy`.** Reconciled in §6 as
   "text-labelled action = pill, icon square = `--r-sm`". Wants the roster owner's ruling so it
   becomes a stated law rather than my reading of two files.
6. **Does the inspector payload carry a venue credential or API token?** If so it needs a
   redaction pass, and the redaction must itself be visible (`[redacted: api_key]`) rather than
   silent.
7. **Is `exposureVerdict` available on the panel's own props**, or only on the component snapshot?
   §4's entire argument depends on exposure being renderable when the panel's query has failed. If
   the panel cannot reach the component record, the element's spine does not work.
