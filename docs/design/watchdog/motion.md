# Watchdog — motion, hover, focus and live-data micro-interaction

Element owner notes. Round 2, after the panel. One element: **what moves on this page, when, and
what its stillness means.** Nothing else here is mine.

---

## 0. The panel round

The panel filed 34 defects. Two of them (#1 flatline, #3 the rail's third truth) were not defects in
the CSS — they were defects in what I had *read*. Fixing them properly meant going back to the
model, and the model turned out to already contain the answer. That reframed the whole element, so
this is a rebuild, not a patch.

### 0.1 The finding that reframed the element

`lib/productIntegration/model.ts:223-224`, on every component projection:

```ts
readonly heartbeatAtMs: number | null;
readonly lastAdvanceAtMs: number | null;
```

Two timestamps, not one. **`heartbeatAtMs` = "I am alive." `lastAdvanceAtMs` = "I made progress."**
The health surface's field id for the pair is literally `'heartbeat-advance'` (`model.ts:790`).

And the system already treats the difference as load-bearing. `model.ts:2257-2266` refuses to let the
owner view declare readiness unless a *meaningful advance* was published in the same evaluation:

```ts
const advance = health.evidence.find((d) => d.fieldId === 'heartbeat-advance');
const meaningfulAdvancePublished = ... advance.value.length > 0
  && advance.unavailableReason === null
  && !['UNKNOWN','MISSING','UNAVAILABLE','NOT_CONFIGURED','BLOCKED'].includes(advance.truthLabel)
  && health.evaluatedAtMs === value.dashboard.evaluatedAtMs;
if (ownerReady && !meaningfulAdvancePublished) errors.push('OWNER_MEANINGFUL_ADVANCE_REQUIRED');
```

`OWNER_MEANINGFUL_ADVANCE_REQUIRED` is this application's readiness invariant, and it says:
**a heartbeat is not proof; only an advance is proof.**

My round-1 element rendered "a field on screen differs from last poll" — a *render* fact, computed
on the client, with no producer, and the subject of two of my own unresolved open questions. The
panel's defect #1 was that such a predicate is structurally incapable of expressing a wedged
component. It is worse than that: it marks a row when a latency digit jitters by 1ms, and it is
silent when the ledger writer stops writing. It was measuring the wrong thing entirely.

The element now renders the advance clock. The predicate is server-supplied, the invariant already
exists in the codebase, and defect #1 stops being a missing state and becomes the subject.

### 0.2 The second finding: the poller already publishes the states I was inventing

`lib/polling.ts` — `createSettledPoll`, the real polling primitive, used by `store.tsx`,
`Header.tsx`, `OrderBook.tsx`, `DepthChart.tsx`.

```ts
running: () => active !== null,                        // a request is IN FLIGHT
timer = window.setTimeout(() => void run(), Math.max(250, options.intervalMs));
finally { ... if (!stopped && requestGeneration === generation) schedule(); }   // schedule AFTER settle
const timeoutMs = Math.max(250, options.timeoutMs ?? 10_000);
... new ApiRequestError({ status: 408, code: 'POLL_TIMEOUT', message: `Refresh timed out after ${timeoutMs}ms` })
refresh() { clearTimer(); generation += 1; active?.abort(); void run(); }
```

Five things fall out, and each one closes a panel defect with real code instead of a decision:

| panel | what the poller already provides |
|---|---|
| **#3** the rail lies for one RTT | `running()` **is** the in-flight predicate. `awaiting` is not a state I invent; it is a method on the API. And because the next tick is scheduled in `finally`, the true cycle is `intervalMs + RTT` — the panel's diagnosis was exactly right and the fix is to read `running()`. |
| **#10** Manual has no state | `refresh()` already exists. Manual mode is `stop()` plus a button bound to `refresh()`. |
| **#11** no first-paint state | `generation === 0 && running()` is precisely "never loaded, request in flight". |
| **#26** dead must state a reason | `onError` hands me an `ApiRequestError` with `.code` and `.message` (`lib/http.ts:8-20`). The reason is produced, not authored. |
| **#33** the region cannot repeat itself | `generation` is already monotonic. It is the utterance sequence. |

I had specified a `data-feed` ladder with thresholds I chose. The poller had already decided them.
`timeoutMs` (default 10s) is the real boundary between "late" and "dead", because at `timeoutMs` the
request is *aborted* — there is no such thing as later than that.

### 0.3 Boundary violations in my round-1 spec, now withdrawn

`docs/design/watchdog/` has six owners. Reading them, my round-1 file was painting in three other
people's columns:

| I had specified | actual owner | resolution |
|---|---|---|
| §5 control-registry mutation: knob travel, `data-pending`, `aria-disabled`, `Enabling…`, busy glyph, `--mo-busy-appear/-min` | `toggle.md` (794 lines — *"the switch for a real gated control where DESIRED and EFFECTIVE can disagree"*), which already bans optimistic rendering and already cites Geist for *"motion means non-terminal"* | **Withdrawn.** I publish a motion contract they consume; the busy tokens leave my file. This also deletes defect #23's unconsumed `--mo-busy-min` at the root rather than patching it. |
| the focus ring's paint | `tokens.md` §6.3 defines `--focus-ring` *"tokenised here so nobody re-derives it"* | **Consumed.** I own *when* it appears, that it never transitions, and that it survives a poll. Not its colour. |
| `font-variant-numeric` on four selectors | `tokens.md` §7.2 numeric modifier | **Deleted** (panel #21). |
| `.wd-row { padding-inline-start }` | `owner-row.md` | **Withdrawn**; I paint inside a gutter I do not own the padding of. |
| a second state vocabulary for unknown/unavailable/not-configured (panel #28) | `status-chip.md` — eight hueless glyph topologies, `REASON_REQUIRED` as a runtime invariant | **Not mine.** See §6.4: rendering a second copy of a state the chip already owns is the L10 violation, not the fix. |

`owner-row.md` §0.2 independently caught the same class of collision from the other side, and named
my file as the one that reserved the left gutter. That collision is resolved in §5.3.

### 0.4 Panel findings: disposition

Sustained and fixed: 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
24, 25, 26, 27, 29, 31, 32, 33, 34, and the genericness charge.
Sustained but **out of scope**, handed to the named owner with a written contract: 7, 30 (`toggle.md`),
28 (`status-chip.md`).
Contested with evidence: **#5** and **#25** are real but the panel's fixes are worse than the
structural one (§6.6); **#16**'s cascade-layer fix is right in principle and wrong in mechanism, and
the corrected version is in §6.5.

---

## 1. What the house actually ships (read, not assumed)

Root sheet is `web/src/styles.css`, 49,735 lines. **There is no `web/src/index.css`** — the work
order's path is wrong; `status-chip.md` and `toggle.md` both independently verified this.

Verified, with line numbers:

```css
styles.css:146   :focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; border-radius: 4px; }
styles.css:147   .num { font-variant-numeric: lining-nums tabular-nums; font-feature-settings: "tnum" 1,"lnum" 1; font-weight: 620; }
styles.css:13239 .lg-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent-line); }
styles.css:3736  .flash-up  { animation: cgFlashUp 1.4s ease-out; }
styles.css:3740  .cell-up   { animation: cellUp .8s ease-out; border-radius: 6px; }
styles.css:519   .nwx-line.fresh { animation: intelArrival 760ms ease-out 2; }
Health.css:15-22 .healthx-frame { width:100%; overflow:hidden; border:1px solid var(--line-2);
                                  border-radius:12px; background:var(--panel); box-shadow:var(--shadow-sm); }
```

Two of these are load-bearing for what follows.

**`.healthx-frame { overflow: hidden }` is real.** It is why a row focus ring must be an inset
box-shadow and not an outline (the house already solved this at `.lg-row:focus-visible`), and it is
why an absolutely-positioned hover payload inside the frame **is clipped** — panel #4, confirmed
against the actual rule, not assumed.

**`.flash-up / .cell-up / .nwx-line.fresh` are the green/red value flash already shipping.**
They are variant V1's ancestor and they are deleted by this element (§7.7).

Peer convention already established in `features/watchdog/styles/dependencyGraph.css:37-54`:
tokens are consumed as `var(--sp-4, 8px)` / `var(--ink-3, var(--muted))` — the `tokens.md` scale with
a house fallback, so the sheet is correct before and after that migration lands. I match it exactly.

From `tokens.md` (the measurement owner), consumed not re-derived:
`--sp-1..9` = 2/4/6/8/12/16/24/32/48 · `--row-h: 28px` · `--gutter-icon: 16px` ·
`--ink-1/2/3/-mute` · `--ok/--warn/--bad/--held` · `--focus-ring`.

---

## 2. References

Twelve, all fetched this round. Each line names the specific mechanic taken. Two round-1 citations
were decoration; both are corrected below rather than quietly dropped.

**1. Vercel Geist — Status Dot** — https://vercel.com/geist/status-dot
Verbatim: *"The dot animates while `BUILDING` or `QUEUED` and goes static once the deployment reaches
a terminal state."* This is M1 and it is the governing law of the element. Also taken verbatim:
*"Color is not the only signal: every state ships with a distinct title and label so colorblind users
get the same information"* — which is M4 stated by someone else, and it is why every mark in §5 has a
text carrier in the same row. And: mark the indicator `aria-hidden` when adjacent text already names
the state.

**2. `lib/polling.ts` — `createSettledPoll` (this repo)**
Not a web reference and the most important one. Taken: `running()` as the in-flight predicate, the
schedule-after-settle shape that makes the real cycle `intervalMs + RTT`, `timeoutMs: 10_000` as the
non-negotiable dead boundary, `refresh()` as the manual affordance, `ApiRequestError.message` as the
dead reason, and `generation` as the utterance sequence. Five panel defects close on this file.

**3. `lib/productIntegration/model.ts` (this repo)**
Taken: `heartbeatAtMs` vs `lastAdvanceAtMs` as two distinct clocks; `freshnessState:
'FRESH'|'STALE'|'CLOCK_SKEWED'|'UNAVAILABLE'` (line 225) — **CLOCK_SKEWED** is a first-class state I
had never handled and it is the honest "we cannot compute this"; `retryState: 'RETRYING'|'BACKING_OFF'|
'COOLDOWN'` as the enumeration of what is *licensed* to move under M1; `capitalRelevance:
'EXPOSED'|'RECOVERY'` as the escalation key for §5.6; and `OWNER_MEANINGFUL_ADVANCE_REQUIRED`
(line 2266) as the invariant the element renders.

**4. Prometheus — Querying basics / staleness** — https://prometheus.io/docs/prometheus/latest/querying/basics/
Verbatim: *"If a target scrape or rule evaluation no longer returns a sample for a time series that was
previously present, this time series will be marked as stale"* and *"Such time series will disappear
from graphs at the times of their latest collected sample."* Taken: the refusal to keep drawing a
flat line forward from the last known sample. A monitoring system that extends a stuck value is
lying, and Prometheus solves it by *removing* rather than *flattening*. That is the direct argument
for §5.2: an advancing row and a wedged row must not render as the same stillness.

**5. Datadog — Monitor configuration** — https://docs.datadoghq.com/monitors/configuration/
Taken as a **negative** reference, which is why it earns its place. Datadog has a first-class
`NO DATA` state for a metric that stops reporting, and the docs are explicit that *"Monitors do not
auto-resolve from an ALERT or WARN state if data is still reporting"* — continuous reporting at an
unchanged value is treated as active transmission. So the industry default has a name for *silence*
and no name for *stuck*. That gap is the gap panel #1 identified, and this app is unusual in having
the data to close it.

**6. Nagios Core — Flap detection** — https://assets.nagios.com/downloads/nagioscore/docs/nagioscore/4/en/flapping.html
Taken: the rolling window of **21 historical checks**, and *"the newest possible state change carry
50% more weight than the oldest possible state change,"* plus the two-threshold shape — start
flapping above a *high* threshold, stop below a *low* threshold. Taken twice: (a) the 21-sample
window is where §5.2's wedge threshold comes from, so the threshold is **measured from the row's own
history** rather than decreed by me; (b) the high/low split is the hysteresis in §6.2's velocity gate.

**7. Healthchecks.io — Configuring checks** — https://healthchecks.io/docs/configuring_checks/
Verbatim, grace time is *"the additional time to wait before sending an alert when a check is late."*
Taken: grace is a **named, first-class interval**, not slack hidden in a threshold. In §4 the
`awaiting` state *is* grace — the window covering one RTT — and it gets its own rendering rather than
being folded into `late`. This is panel #3's fix with a product that already shipped it.

**8. MDN — `Element.getAnimations()`** — https://developer.mozilla.org/en-US/docs/Web/API/Element/getAnimations
Verbatim on the `subtree` option: *"a boolean value, which if `true`, causes animations that target
descendants of Element to be returned as well. This includes animations that target any CSS
pseudo-elements attached to Element."* Default `false`. **Panel #2 confirmed against the spec**: my
round-1 `railRef.current.getAnimations().forEach(a => a.cancel())` cancelled nothing, and the
`fill: "forwards"` animations accumulated at 1,800/hour. Taken: the fix is not `{subtree: true}` — it
is to stop animating a pseudo-element (§4.2).

**9. MDN — Popover API** — https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
Verbatim: `showPopover()` *"shows a popover element by adding it to the top layer."* Taken: the top
layer is how a payload escapes `.healthx-frame { overflow: hidden }` — `z-index` cannot, because
`z-index` does not defeat a clip. Also taken: `popover="hint"`, which is the state designed for
hover-triggered transient content and does not close other `auto` popovers.

**10. MDN — Using CSS anchor positioning** — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning/Using
Taken: `anchor-name` / `position-anchor`, `position-area` for the 3×3 placement grid, and
`position-try-fallbacks` for flipping. Taken specifically because the payload's placement is not
known in advance, which is what makes round-1's `transform-origin` citation a no-op — see #12.

**11. Emil Kowalski — Great animations** — https://emilkowal.ski/ui/great-animations
Verbatim: *"Never animate keyboard initiated actions. These actions are repeated sometimes hundreds
of times a day, an animation would make them feel slow and disconnected from user's actions"* → the
focus ring and ↑/↓ navigation transition at 0ms, and the payload opens at 0ms from focus. Verbatim:
*"If the main thread is busy, you should animate using hardware-accelerated animations like CSS or
WAAPI... will remain smooth, no matter how busy the main thread is"* — decisive for a page diffing a
projection every 2s. Also *"shorter than 300ms"* and `ease-out`, never `ease-in`.

**12. Rauno Freiberg — Web Interface Guidelines** — https://interfaces.rauno.me/
Verbatim and load-bearing: *"Animation duration should not be more than 200ms for interactions to
feel immediate"*; *"Actions that are frequent and low in novelty should avoid extraneous
animations"* → the row tint has no transition at all; *"Switching themes should not trigger
transitions and animations on elements"*; *"Looping animations should pause when not visible on the
screen"*; *"Font weight should not change on hover or selected state to prevent layout shift"*;
*"Box shadow should be used for focus rings, not outline which won't respect radius"*;
*"Focusable elements in a sequential list should be navigable with ↑ ↓"*;
*"Tooltips triggered by hover should not contain interactive content"*;
*"Hover states should not be visible on touch press, use `@media (hover: hover)`"*.

**13. W3C — Understanding SC 1.4.11 Non-text Contrast** — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
Verbatim: 3:1 minimum for *"Graphical Objects — Parts of graphics required to understand the content"*,
and the scoping rule *"only those that are required for a user to understand what the graphic is
conveying."* Panel #14 is sustained without qualification: the advance mark is the **only** sighted
carrier of its state, so the "accompanying text conveys the same information" exemption does not
apply to it. `color-mix(… 34%, transparent)` was ~1.5:1. §7.2 solves it with full-opacity `--ink-3`
and measured numbers.

**14. W3C — Understanding SC 2.2.2 Pause, Stop, Hide** — https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
Normative: for auto-updating information presented in parallel with other content there must be a
mechanism to pause, stop, hide, or control the frequency. A 2s polling wall is exactly that, so Hold
and the cadence selector are conformance, not convenience.

**15. MDN — ARIA live regions** — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
Taken: the warning against live regions for frequently-updating content that floods screen readers →
the grid is explicitly `aria-live="off"` and exactly one coalesced polite region exists.

**16. Vercel — Web Interface Guidelines** — https://vercel.com/design/guidelines
Verbatim: *"If you show a spinner/skeleton, add a short show-delay (~150–300 ms) & a minimum visible
time (~300–500 ms) to avoid flicker"*; *"Delay the first tooltip in a group; subsequent peers have no
delay"*; *"Never `transition: all`"*; *"Prefer `:focus-visible` over `:focus`"*; ellipsis on in-flight
labels; `aria-label` on icon-only controls; and *"Empty, sparse, dense, & error states"* as a
required design surface — panel #12.
**Correction to round 1:** I cited this page for *"anchor motion to where it physically starts"* and
tokenised it as `--mo-origin`. The actual guideline is `transform-box: fill-box; transform-origin:
center` **for SVG elements**. I misquoted it, and then implemented it as a no-op on a `translate`.
Both errors are fixed: the citation is corrected to what the page says, and the mechanic is replaced
in §6.3 by directional entry, which is the honest way to anchor a translate.

**Round-1 citation withdrawn.** I quoted Rauno's *Invisible Details of Interaction Design* on
interruptibility and the lightweight-commits-mid-gesture / destructive-commits-on-gesture-end split,
and then implemented it nowhere — there is no gesture on this page. The panel is right. The real
mechanism, stated plainly: a native `<button>` already commits on pointerup-inside and cancels on
drag-off, which *is* destructive-commits-on-gesture-end, for free. Every activation in this element
is a real `<button>` for that reason. That is worth one sentence, not a reference slot.

---

## 3. Four variants — what design variable each moves

All four are on the reframed element. The axes actually moved: **predicate source** (client render
diff vs server timestamp), **signal location** (row vs page), **state vs history**, **aggregation
level**, **chrome**.

### V1 — Change-diff gutter (round 1's winner)
*Predicate:* a rendered field of this row differs from the previous poll. Computed on the client.
*Location:* reserved row gutter. *State, not history.* *Chrome:* one reserved track.
One hueless 2×14 mark per changed row, present for the poll interval, withdrawn on the next quiet
poll.

### V2 — Advance-clock gutter
*Predicate:* the server's two timestamps. `lastAdvanceAtMs` fresh relative to **this row's own
measured advance cadence** (Nagios 21-sample window) → advancing. Heartbeat fresh but advance stale →
wedged. *Location:* same reserved gutter. *State.* *Chrome:* same one track.
The mark's polarity is inverted relative to V1: the **expected** case renders nothing.

### V3 — Per-row cadence strip
*Predicate:* same as V2. *Location:* an in-row 24×8px strip. **History, not state** — the last 21
poll outcomes as a static bar sequence (advanced / heartbeat-only / no evidence).
*Chrome:* maximal — 504 persistent marks across a 24-row wall. Zero motion.

### V4 — Clock-disagreement header
*Predicate:* same as V2. *Location:* **page scope only** — three stacked hairlines (poller /
heartbeat / advance) plus a named list of every row whose clocks disagree.
*Aggregation:* total. *Chrome:* minimal. Zero motion in the data region.

---

## 4. The fight

**V1 loses, and it loses on the thing it was built to do.** Its predicate is a render fact, not a
domain fact. It fires when a latency digit jitters 12→13ms and it is *silent* when the ledger writer
wedges — the row keeps rendering the same values, so nothing differs, so no mark, forever. Panel #1
is not a missing state in V1; it is V1's defining blind spot, and the blindness points at the most
urgent event on an operational wall. Secondarily: V1 needs a client-side diff over a declared
render-field manifest, which had no producer and was two of my own unresolved open questions, while
V2's predicate is on the projection already with server truth. And V1's polarity is wrong — on a
healthy wall nearly every row changes every poll, so nearly every row is marked, and a mark that is
usually present is wallpaper.

**V3 loses on L1 and on the DNA.** 21 bars × 24 rows is 504 marks of persistent ink, which makes the
*history* louder than the *state* — hierarchy from quantity, which L1 forbids. Screen 3's law is a
single meaningful glyph on a fixed gutter, not a chart in a column. And it is slower at the only
question that matters at 3am: "which row is stuck *right now*" is one saccade against a single mark
and a scan-and-decode against a bar sequence. **But its window is the right idea in the wrong place**
— see below.

**V4 loses for the reason a wall exists.** A wall's whole function is that the eye finds the row
without reading. Replacing 24 rows with a list of six names is a regression to a printout, and it
hides per-row liveness so a quiet component and a dead one read identically — the exact truth failure
this element exists to prevent. **But its escalation is right** — see below.

**V2 wins**, and it takes one donation from each loser:

- **from V3, the window**: the wedge threshold is not a number I choose. It is `3 × p50` of *this
  row's own* observed advance intervals over a Nagios-style 21-sample window, and it is
  **not computable below 5 samples** — in which case the row is `cadence-unknown` and renders **no
  mark**, with the evidence cell reading `Advance cadence unknown (2 of 5 samples)`. You may not
  claim a component is stuck until you have measured what moving looks like. That is the truth
  doctrine applied to a threshold.
- **from V4, the escalation**: a hollow glance-signal is right for a wedged utility component and
  wrong for a wedged component with `capitalRelevance: 'EXPOSED' | 'RECOVERY'`. Those also raise a
  header line and a polite announcement. The mark is the glance; the header is the alarm.

---

## 5. Refinement pass 1 — adversarial

### 5.1 The hollow mark the panel prescribed does not render
Panel #1's fix is a *"hollow 2×14 bar (1px border, transparent fill)"*. At 2px wide a 1px border
leaves a 0px interior: it renders as a solid bar. The two states would be pixel-identical — the exact
failure the fix was written to cure.

Fill cannot be the differentiator at this width, and neither can size (two widths in one track reads
as two weights, breaking L10) or hue (M2 forbids it). **Topology can.** The wedged mark is the same
2px width, the same 12px height, the same ink, the same position — rendered **dashed** instead of
solid:

```
advancing   (nothing)
wedged      ┆   2px wide, dashed
```

And that is not a new vocabulary, because the rail's `dead` state is already dashed (§4 / §7.7).
**Dashed means interrupted, at two scales, page and row.** One idea, used twice, rather than two
decisions. It also survives `forced-colors` (border colours are remapped, background images are
stripped) and it survives print — which the panel's gradient-based `dead` rail did not (#26).

### 5.2 The mark's polarity was wrong, and inverting it fixes panel #1 at the root
V1 marked the *expected* case. On a healthy wall that is 24 marks per poll — wallpaper — and it left
stillness meaning two different things ("unchanged" and "flatlined"), which is precisely the overload
panel #1 named.

Inverted: **advancing on schedule renders nothing.** Stillness now means exactly one thing, and it is
the thing M1 already said: *proven, terminal, nothing to report*. The only row-scope mark that exists
is the exception.

The obvious objection — "then the operator loses liveness at a glance" — is answered by division of
labour, not by compromise. Page liveness is the **rail's** job (§7.5). Per-row liveness is already
rendered as **text** in the evidence-age column, which is the M4 carrier and survives a screenshot.
The row-scope mark is therefore free to carry only the exception, and it should.

The consequence is the strongest sentence in this document: **on a healthy wall this element renders
zero moving pixels, and every mark on screen is a component that is alive and not making progress.**

### 5.3 The gutter collision (panel #29), resolved with arithmetic
Three claimants for the row's leading space: `status-chip`'s state glyph, `owner-row`/`info-row`'s
icon column, and my mark. `tokens.md` already defines `--gutter-icon: 16px` (`--sp-6`) as *"fixed left
icon column (L6)"*.

Precedence, proposed here and owned by `tokens`:

```
column 0   --mo-gutter-advance : 8px  (--sp-4)   advance mark ONLY. Mine.
column 1   --gutter-icon       : 16px (--sp-6)   state glyph. status-chip's. Semantics win the icon slot.
                                 -----
row leading inset               : 24px (--sp-7)  owned by owner-row; I never set padding.
```

8px is not a preference. At a 6px gutter a centred 2px mark spans x=2–4 and the row's inset focus
ring occupies x=0–2 — they touch. At 8px the mark spans x=3–5 with 1px clear of the ring. And the two
gutters sum to `--sp-7`, a scale value, so the wall, the header, the info rows and the empty state
all key off one number.

### 5.4 Every dimension is now derived, not guessed (panel #19, #20)
Round 1's 14px mark height came from a row height I admitted was a guess. `tokens.md` publishes
`--row-h: 28px`.

```
--mo-mark-h : calc(var(--row-h) - var(--sp-4) * 2)   =  12px
--mo-mark-w : var(--sp-1)                             =   2px
--mo-rail-w : calc(var(--sp-9) + var(--sp-7))         =  72px
--mo-rail-h : var(--sp-1)                             =   2px
border-radius: calc(var(--mo-mark-w) / 2)             =   1px   ← the pill law at 2px, stated in code
```

The bare `border-radius: 1px` that read as an invented third radius is now the house pill law
(`radius = height/2`, Screen 1) written as arithmetic so an auditor can see it (#20).

### 5.5 `--mo-3` and `--mo-soft` have no consumers left — delete them
Panel #17 is right that animating `height` on the disclosure contradicts every performance argument
in this document, on a page whose contents mutate every 2s so the transition target can change
mid-flight. The consistent answer for an action performed hundreds of times a day is **no transition
at all**: instant open, chevron rotates at `--mo-fast`.

That removes the only consumer of `--mo-3` (200ms) and the only consumer of `--mo-soft`. Both are
deleted. **Four durations, one curve**, and every one has a call site.

Round 1's M6 said "five durations, five delays, two curves". It was a rule about *counting*. The
replacement rule is about *consumption*: **a token with no call site is a defect.** That is
checkable, which the old rule was not — and it is what made the unconsumed `--mo-busy-min` (#23)
survive a round.

The four are renamed from `--mo-1..4` to roles, because they are not interchangeable steps you can
move up and down — they are four distinct jobs, and a numeric name invites reaching for the next one:

```
--mo-instant 0ms    keyboard, focus, information arriving
--mo-fast   90ms    opacity
--mo-base  160m s   translate; == statusChip's --wd-motion; == Health.css .15s
--mo-decay 320ms    withdrawal only. Never an interaction.
```

### 5.6 Hold erases what Hold was pressed to read (panel #8), and `held` is not a feed state (#9)
Sustained on both. Hold freezes the frame so a human can study it; deleting the marks from the frozen
frame is deleting the thing they froze it for. Marks now **freeze with the values** — they are part
of the frozen frame. Only `stale` and `dead` clear them, because only those two mean *these marks are
no longer true*.

And `data-poll` and `data-held` are separate attributes, so "the feed died while I was holding" is
representable. It was not before, and it is the dangerous case.

---

## 6. Refinement pass 2 — adversarial

### 6.1 The rail is still continuous motion on a healthy page
This is the sharpest surviving tension with §5.2. I have just argued that a healthy wall is
motionless, and the rail drains continuously at 2s.

It cannot be deleted (that is V4's failure: a dead poll and a quiet poll must not look alike), and
it cannot loop (an infinite CSS animation keeps playing after the data dies). But a *linear* drain is
also dishonest in a smaller way: a continuously sliding bar implies continuous knowledge, and we only
know discrete seconds.

**The drain is stepped, not linear**: `steps(n)` where `n` = the interval in whole seconds. A 2s
cadence ticks twice. A 5s cadence ticks five times. It reads as a clock rather than as an animation,
each step corresponds to a real elapsed second, and it costs 2–5 composited frames per cycle instead
of ~120. Honesty and calm land on the same implementation, which is usually the sign it is right.

### 6.2 The velocity gate is unopenable (panel #6) — sustained, with the threshold sourced
`armIntent` on `pointerenter` fires **once**. Flick to a row, stop, read — the canonical gesture —
never re-arms. The feature reads as broken.

Fixed as the panel prescribes: sample pointer velocity on the **document** over a ~50ms rAF-coalesced
window (the trigger never sees the approach, which is the sample that matters), arm on `pointermove`
inside the trigger whenever windowed speed is below the arm threshold and no timer is pending. The
two thresholds are Nagios's high/low hysteresis, cited rather than invented: **arm below 600 px/s,
cancel above 1200 px/s**, so a jittery hand cannot oscillate.

These remain reasoned rather than measured, and that is flagged in §9, not hidden.

### 6.3 `transform-origin` on a `translate` is inert (panel #15) — sustained
`transform-origin` has no effect on `translate`. The citation was also a misquote (§2 #16). Both are
fixed by anchoring **by direction**, which is what you can actually do with a translate: the payload
placed below its anchor enters from `translate: 0 -2px`; placed above, from `0 2px`; inline-end, from
`-2px 0`. The placement resolver sets `--mo-enter`, and since placement is resolved by
`position-try-fallbacks` the direction has to come from the resolver anyway. `transform-origin` and
`--mo-origin` are deleted.

### 6.4 Four states, one appearance (panel #28) — sustained, and it is not mine to fix
The panel is right that UNKNOWN / UNAVAILABLE / NOT_CONFIGURED / probe-broken must not be one
appearance differentiated only by free text. But `status-chip.md` owns that vocabulary — eight
hueless glyph topologies with `REASON_REQUIRED` as a runtime invariant — and shipping a second set of
glyphs from a motion sheet is the L10 drift the finding is complaining about, relocated.

What is mine is the **motion consequence**, and it is a real one: none of those four states is
non-terminal, so under M1 **none of them may move, and none of them may shimmer.** A shimmer promises
"loading, and it will succeed"; UNKNOWN is not loading. Shimmer is licensed in exactly one place on
this page — `data-poll="initial"`, where a request is genuinely in flight (§7.5) — and that is the
connection panel #11 correctly noted I had never made.

Filed to `status-chip.md` as a requirement, with the finding attached.

### 6.5 The cascade-layer fix is right in principle and wrong in mechanism (panel #16)
Sustained: `.watchdog * { transition-property: none }` is (0,1,0), `.wd-chip { transition: … }` is
(0,1,0), load order decides, and I had load order filed as an open question. The backstop could
silently delete the sibling element's motion.

But the panel's fix — put the backstop in a low layer — **does not work**, because unlayered styles
beat every layer for normal declarations, and `styles.css` (49,735 lines, the source of the
`transition: all` leakage the backstop existed to catch) is entirely unlayered. A layered universal
backstop would stop catching the thing it was for while still being able to break siblings.

The correct instrument for "no `transition: all` and no stray `animation` inside
`features/watchdog/`" is **a lint rule, not a selector.** That is the panel's own reasoning from #22
("defensive CSS that fires on the wrong element is worse than a lint failure") applied consistently.
The universal backstop is deleted. The two known offenders are named, line-numbered, and deleted
outright in `styles.css` (§7.7) rather than suppressed at a distance.

Layers are still used, but only for what they are actually good at here: **ordering the three global
kill switches against each other.** For `!important` declarations, *earlier* layers win — so the kill
switches go in the first-declared layer and their mutual precedence is declared rather than
accidental. That closes the "unmanaged `!important` war" half of panel #24. And `!important` remains
necessary on exactly those three, because they must beat unlayered `styles.css`; important
declarations from a layer do beat unlayered normal ones.

### 6.6 `will-change` on 24 elements, and the `::after` gap — both dissolve structurally
Panel #5 sustained: `.mo-payload` was rendered inside every row, so `will-change` promoted 24 layers.
Panel #25 sustained: `@media (update: slow)` enumerated `*` and `*::before` and missed `::after`,
which is what both the rail fill and the chip wash were.

The panel proposes patching each. Both vanish instead:

- the payload becomes **one** node with `popover="hint"` in the top layer — which is also panel #4's
  fix, since `z-index` cannot escape a clip and the top layer can;
- the rail fill becomes a **real child** rather than `::after` — which is also panel #2's fix, since
  `getAnimations()` on a real element needs no options and no `pseudoElement` feature detection.

After both, `will-change` is on exactly two elements — a checkable claim rather than an aspiration —
and `@media (update: slow) { .watchdog * }` is sufficient with no pseudo-element enumeration at all.
The dead line `const fill = railRef.current;` is gone with the function it was in.

### 6.7 Absence is never taught — the genericness charge, sustained
The panel's strongest point: this interface's primary signal is absence, and absence is never taught,
so a new operator reads an empty rail as a rendering bug.

Two fixes, and the first is the one that makes this element specific to this product:

**(a) The header's status line is always a consequence sentence, never a status label.** Not
`overdue 7s` but `Overdue 7s — values below may not be current.` One `formatAge()`, one sentence
shape, capital-first, em-dash throughout (panel #34 — four formatters and three dash styles in five
adjacent lines was L10 violated inside one component).

**(b) A permanent `What the marks mean` disclosure in the header** — a disclosure, not a tooltip,
because it must survive a screenshot pasted into an incident ticket. Five rows:

```
┆   dashed mark   Alive, but not advancing for 3× its own measured cadence
    (no mark)     Advancing on schedule — or cadence not yet measurable
▇▇▁ stepped rail  Our poll cycle is on schedule
▏   cap only      Request in flight
┄   dashed rail   Poll failed — reason shown beside it
```

That legend cannot be dropped into another dashboard, because it names *advance*, and advance is this
system's readiness invariant (`OWNER_MEANINGFUL_ADVANCE_REQUIRED`). The panel's charge was that the
artifact was generic while only the reasoning was specific. The artifact is now the invariant.

### 6.8 The remaining panel items, closed
**#12 empty states** — three, each naming cause and next action; the rail keeps telling the truth
about the poll independently of row count, so zero rows never renders as "everything is fine".
Jointly owned with the table; the *policy* is mine.
**#13 two clocks** — now three, and they are named as such: poller (page), heartbeat (row), advance
(row). Per-row `data-evidence` from `freshnessState`, so mark-clearing is per row, not global.
**#18** — inline `minWidth: '7ch'` and the missing `text-align: right` deleted; the numeric column is
consumed from its owner.
**#22** — `font-weight: inherit` deleted outright rather than swapped for `revert-layer`; it would
have *caused* a shift on a legitimately bold cell. Enforced by lint.
**#24** — `[data-instant]` now zeroes `transition-delay` and `animation-delay`, and the JS dwell
timers read the attribute.
**#27 print** — `@media print` renders the feed state as a sentence, the absolute timestamp of the
data, and a textual `Advance` column; a printed or screenshotted held wall is self-identifying.
**#31** — losing the active row no longer destroys the tab stop.
**#32** — `onBlurCapture` defers to rAF and checks `relatedTarget` containment; window `blur`
fallback; and I own the "N rows will reorder" counter rather than punting it, because without it the
freeze is a silent lie.
**#33** — `role="treegrid"` since rows carry `aria-expanded`; the payload is referenced by
`aria-describedby`; and the region carries a visually-hidden monotonic sequence so a flapping
component re-announces. The sequence source is `createSettledPoll`'s `generation`, which already
exists.

---

## 7. The element (winner, final)

### 7.1 Laws

```
M1  Motion means NON-TERMINAL. A proven, settled state never moves. READY has no pulse.
    The only things licensed to move are: a request in flight, retryState RETRYING/BACKING_OFF,
    and a mutation awaiting readback.
M2  Motion NEVER encodes severity. Every signal in this element is hueless.
M3  Information appears at 0ms. Only WITHDRAWAL is eased.
M4  Every information-bearing motion has a non-motion carrier in the same component.
    prefers-reduced-motion therefore costs zero information.
M5  Nothing renders a value that was not measured. No odometers, no interpolation, no optimistic
    state, and no threshold I chose where the data can measure one.
M6  Every token has a call site. A token nothing reads is a defect.
M7  Stillness means exactly one thing: advancing on schedule. Any other reading of stillness is
    a bug in this element.
```

M7 is new and it is the panel's finding #1 turned into a law.

### 7.2 Anatomy — four objects

**1 · The advance mark** (row scope) — `--sp-4` reserved gutter, `--sp-1` × 12px, `--ink-3` full
opacity, dashed. Present iff the row is **wedged**. Appears at `--mo-instant`, withdrawn over
`--mo-decay`. A state with a transition, never a keyframe — which is what makes reduced motion free.

*Predicate, entirely from server fields:*
```
advancing        now - lastAdvanceAtMs  <=  3 x p50(this row's advance intervals, 21-sample window)
wedged           heartbeatAtMs fresh  AND  now - lastAdvanceAtMs  >  that threshold      -> DASHED MARK
cadence-unknown  fewer than 5 advance samples          -> no mark; cell reads "Advance cadence unknown (n of 5)"
clock-skewed     freshnessState === 'CLOCK_SKEWED'     -> no mark; cell reads "Clock skewed — advance not computable"
no evidence      lastAdvanceAtMs === null | UNAVAILABLE -> no mark; the status chip owns this state
```

**2 · The cadence rail** (page scope) — 72×2px. Fill is a **real child**, stepped drain, WAAPI,
restarted per settled poll. Six states, each with a real predicate in `lib/polling.ts`.

**3 · Hover, two tiers** — the row tint (no transition, ever) and one shared `popover="hint"` payload
in the top layer, anchor-positioned, opened by a velocity-gated dwell.

**4 · Focus and keyboard** — `:focus-visible` only, never transitioned, roving-tabindex composite,
focus survives the poll by construction, order frozen while a pointer or focus is inside.

### 7.3 The rail's six states

| `data-poll` | predicate (`createSettledPoll`) | rail | header sentence |
|---|---|---|---|
| `initial` | no success yet, `running()` | 12px segment traversing, 1.2s linear — the page's **only** loop, licensed by M1, paused when hidden | `Loading first update…` |
| `draining` | last settle succeeded, timer pending | fill `scaleX 1→0`, `steps(n)`, n = interval seconds | `Next in 4s.` (bare — a healthy state has no consequence) |
| `awaiting` | `running()` after a prior success | fill at 0 **plus a 2px cap at the origin** — distinct from empty | `Refreshing…` |
| `late` | in flight longer than measured p95 RTT (≥5 samples; falls back to `intervalMs`) | cap only | `Overdue 7s — values below may not be current.` |
| `dead` | `onError` fired; `.code` / `.message` in hand | track becomes `border-block-start: 2px dashed` — survives forced-colors **and** print | `Feed down — Refresh timed out after 10000ms.` |
| `manual` | operator selected Manual; poller stopped | flat static track + a real `Refresh` button bound to `poll.refresh()` | `Manual — last updated 4m 12s ago.` |

`data-held` is **orthogonal** and renders on its own line (L9): `Held — values frozen 42s ago; the
wall is not live.` A feed that dies while held shows both lines. Marks freeze with the values; only
`stale` and `dead` clear them.

`late` and `dead` are not thresholds I chose. `dead` is `timeoutMs` because at `timeoutMs` the
request is aborted — there is no later. `late` is measured p95 RTT, or nothing.

### 7.4 CSS

```css
/* ============================================================================
   web/src/features/watchdog/styles/motion.css
   M1 non-terminal · M2 hueless · M3 0ms in, eased out · M4 non-motion carrier
   M5 never render the unmeasured · M6 every token has a call site
   M7 stillness means exactly one thing: advancing on schedule
   ============================================================================ */

/* Kill switches go in the FIRST layer: for !important declarations, earlier
   layers WIN. That makes their mutual precedence declared, not accidental.
   They carry !important because they must beat unlayered styles.css. */
@layer wd-kill, wd-motion;

@layer wd-motion {

/* ---- 1. tokens ---------------------------------------------------------- */
:root, [data-theme="light"] {
  /* four durations. Role-named: they are four jobs, not interchangeable steps,
     and a numeric name invites reaching for the next one up. */
  --mo-instant: 0ms;
  --mo-fast:   90ms;   /* opacity */
  --mo-base:  160ms;   /* translate; == statusChip --wd-motion == Health.css .15s */
  --mo-decay: 320ms;   /* WITHDRAWAL ONLY. Never an interaction. */

  /* one curve. No ease-in (Emil). No spring: overshoot renders positions the
     data never occupied, which on this surface is a lie. */
  --mo-out: cubic-bezier(.22, 1, .36, 1);

  /* dwell is a DECISION scale (whether to show), not a duration scale (how it
     arrives). The two are never compared, so a shared numeric value is not a
     system claim. */
  --mo-dwell-arm:   320ms;
  --mo-dwell-warm:  480ms;   /* peers open at 0ms inside this window (Vercel) */
  --mo-dwell-close: 120ms;   /* grace to travel into the payload */

  /* geometry — every value derived from tokens.md, none chosen here */
  --mo-gutter-advance: var(--sp-4, 8px);
  --mo-mark-w: var(--sp-1, 2px);
  --mo-mark-h: calc(var(--row-h, 28px) - var(--sp-4, 8px) * 2);   /* 12px */
  --mo-rail-w: calc(var(--sp-9, 48px) + var(--sp-7, 24px));       /* 72px */
  --mo-rail-h: var(--sp-1, 2px);

  /* INFORMATION, not chrome: SC 1.4.11 graphical object, >= 3:1, and it is the
     only sighted carrier of its state so no exemption applies. Full opacity —
     size is the dial, opacity is not.
     light #717b8d : 4.27:1 on --bg, 4.08:1 on --hover, 4.05:1 on --tile
     dark  #b6bcc7 : 9.26:1 on --panel, 8.96:1 on --hover                     */
  --mo-ink: var(--ink-3, var(--muted));
  --mo-rail-track: var(--line-2);
}

/* one clock for the sibling element; one edit changes both */
.watchdog .wd-chip { --wd-motion: var(--mo-base); }

/* ---- 2. the advance mark ------------------------------------------------
   Renders the disagreement between heartbeatAtMs and lastAdvanceAtMs. It is
   present ONLY when a component is alive and not progressing (M7), so on a
   healthy wall this element renders zero moving pixels.
   Dashed = interrupted. The rail's dead state uses the same word (§7.7): one
   vocabulary at two scales. */
.watchdog .mo-mark {
  inline-size: var(--mo-mark-w);
  block-size: var(--mo-mark-h);
  margin-inline: calc((var(--mo-gutter-advance) - var(--mo-mark-w)) / 2);
  border-radius: calc(var(--mo-mark-w) / 2);   /* the pill law at 2px: r = w/2 */
  border-inline-start: var(--mo-mark-w) dashed var(--mo-ink);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--mo-decay) var(--mo-out);   /* WITHDRAWAL only */
}
.watchdog .mo-mark[data-advance="wedged"] {
  opacity: 1;
  transition-duration: var(--mo-instant);              /* M3 */
}
/* Only stale and dead mean "these marks are no longer true". HELD keeps them —
   the frozen frame is exactly where they are most valuable (panel #8). */
.watchdog[data-poll="dead"] .mo-mark,
.watchdog .wd-row[data-evidence="STALE"] .mo-mark,
.watchdog .wd-row[data-evidence="UNAVAILABLE"] .mo-mark { opacity: 0; }

/* ---- 3. hover -----------------------------------------------------------
   Tier 0 — row tint, NO transition in or out. A 90ms background fade across a
   dense table leaves a three-row comet trail on a fast traverse. Rauno
   ("frequent and low in novelty") and Emil ("hundreds of times a day") land on
   the same answer independently. */
@media (hover: hover) and (pointer: fine) {
  .watchdog .wd-row:hover { background: var(--hover); }
}

/* Tier 1 — ONE payload, top layer via popover="hint", so it escapes
   .healthx-frame { overflow: hidden } (Health.css:17). z-index cannot. */
.watchdog .mo-payload {
  position: fixed;
  position-anchor: --mo-active;      /* JS moves anchor-name onto the trigger */
  position-area: block-end span-inline-end;
  position-try-fallbacks: flip-block, flip-inline;
  margin: var(--sp-2, 4px);
  opacity: 0;
  /* anchored BY DIRECTION — transform-origin does nothing to a translate, and
     the placement is only known after position-try resolves. */
  translate: var(--mo-enter, 0 -2px);
  transition:
    opacity   var(--mo-fast) var(--mo-out),
    translate var(--mo-base) var(--mo-out),
    overlay   var(--mo-base) allow-discrete,
    display   var(--mo-base) allow-discrete;
  will-change: opacity, translate;   /* ONE of the two elements in this sheet */
}
.watchdog .mo-payload:popover-open { opacity: 1; translate: 0 0; }
@starting-style { .watchdog .mo-payload:popover-open { opacity: 0; translate: var(--mo-enter, 0 -2px); } }
/* A keystroke has already declared intent. Making the accessible path wait is
   not accessibility. */
.watchdog .mo-payload[data-source="keyboard"] { transition-duration: var(--mo-instant); }

@media (hover: none) { .watchdog .wd-row:hover { background: transparent; } }

/* ---- 4. focus -----------------------------------------------------------
   :focus-visible only (Vercel). NEVER transitioned: keyboard actions repeat
   hundreds of times a day (Emil) and a fading ring reads as lag.
   The ring's PAINT is tokens.md's (--focus-ring); when it appears, that it
   never animates, and that it survives a poll, are mine. */
.watchdog :focus-visible { transition: none; }

/* Rows sit inside .healthx-frame { overflow: hidden }, which clips an outline
   on the first and last row. Inset ring — the house already does exactly this
   at styles.css:13239 (.lg-row:focus-visible), and Rauno prefers box-shadow
   over outline anyway because outline does not respect radius. */
.watchdog .wd-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 var(--sp-1, 2px) var(--accent-line);
  background: var(--hover);
}

/* ---- 5. the cadence rail ------------------------------------------------
   A single-shot STEPPED drain restarted by each settled poll. Not a loop: an
   infinite animation keeps playing after the data dies, and a liveness
   indicator that lies is worse than none. The animation IS the evidence.
   steps(), not linear: a sliding bar implies continuous knowledge; we only know
   whole elapsed seconds. It reads as a clock, not as an animation, and costs
   2-5 composited frames per cycle instead of ~120. */
.watchdog .mo-rail {
  position: relative;
  inline-size: var(--mo-rail-w);
  block-size: var(--mo-rail-h);
  border-radius: calc(var(--mo-rail-h) / 2);
  background: var(--mo-rail-track);
  overflow: hidden;
}
.watchdog .mo-rail-fill {           /* a REAL child, not ::after: getAnimations()
                                       on an element needs no options, and this
                                       deletes the pseudoElement support question,
                                       the accumulation bug and the update:slow gap */
  position: absolute; inset: 0;
  background: var(--mo-ink);
  transform: scaleX(0);             /* empty until a poll proves otherwise */
  transform-origin: left center;
  will-change: transform;           /* the SECOND and last will-change */
}
/* awaiting/late: not empty, not draining — a 2px cap at the origin. Three
   truths, three renderings (panel #3). */
.watchdog[data-poll="awaiting"] .mo-rail-fill,
.watchdog[data-poll="late"]     .mo-rail-fill { transform: scaleX(0); }
.watchdog[data-poll="awaiting"] .mo-rail::before,
.watchdog[data-poll="late"]     .mo-rail::before {
  content: ""; position: absolute; inset-block: 0; inset-inline-start: 0;
  inline-size: var(--sp-1, 2px); background: var(--mo-ink);
}
/* dead: a dashed BORDER, not a repeating-gradient. Backgrounds-as-images are
   stripped by forced-colors and dropped by most print settings — and "the feed
   is down" is the one state that must survive a screenshot (panel #26). */
.watchdog[data-poll="dead"] .mo-rail {
  background: none;
  border-block-start: var(--sp-1, 2px) dashed var(--mo-ink);
}
.watchdog[data-poll="manual"] .mo-rail-fill { display: none; }

/* the ONLY loop on the page. Licensed by M1: a request in flight is by
   definition non-terminal. Ends the moment the first success lands. */
@keyframes moSeek { from { transform: translateX(-100%); } to { transform: translateX(500%); } }
.watchdog[data-poll="initial"] .mo-rail-fill {
  transform: scaleX(0);
  animation: moSeek 1.2s linear infinite;
  inline-size: calc(var(--sp-5, 12px)); inset-inline: auto;
}
.watchdog[data-visible="false"] .mo-rail-fill { animation-play-state: paused; }

/* ---- 6. disclosure ------------------------------------------------------
   No height transition. Animating a layout property inside a table whose
   contents mutate every 2s means the target can change mid-flight, and this is
   an action performed hundreds of times a day. Instant. */
.watchdog .mo-chevron { transition: rotate var(--mo-fast) var(--mo-out); }
.watchdog [aria-expanded="true"] .mo-chevron { rotate: 90deg; }

/* ---- 7. never animate, enforced ---------------------------------------- */
.watchdog .num,
.watchdog .wd-chip-label,
.watchdog .mo-age { transition: none; animation: none; }
/* No idle pulse on a healthy state, anywhere (M1). */
.watchdog .wd-chip[data-tone="affirmative"],
.watchdog .wd-chip[data-tone="affirmative"] * { animation: none; }
/* Row order never animates and is never FLIPped. */
.watchdog .wd-row { transition-property: none; view-transition-name: none; }

/* ---- 8. reduced motion --------------------------------------------------
   NOT a blanket `animation: none` — that deletes the change signal, which here
   is information. Every signal is a state with a transition, so removing the
   transition preserves all of it (M4). */
@media (prefers-reduced-motion: reduce) {
  .watchdog .mo-mark    { transition: none; }        /* on/off, no fade */
  .watchdog .mo-payload { transition: none; translate: 0 0; }
  .watchdog .mo-chevron { transition: none; }
  .watchdog .mo-rail-fill { animation: none; }       /* JS renders "Next in Ns" */
  .watchdog .mo-payload, .watchdog .mo-rail-fill { will-change: auto; }
}

/* ---- 9. forced colors ---------------------------------------------------
   The OS drops backgrounds. Border-based marks survive; that is why both the
   mark and the dead rail are borders. */
@media (forced-colors: active) {
  .watchdog .mo-mark { border-inline-start-color: CanvasText; }
  .watchdog .mo-rail { border: 1px solid CanvasText; background: Canvas; }
  .watchdog .mo-rail-fill, .watchdog .mo-rail::before { background: Highlight; }
  .watchdog[data-poll="dead"] .mo-rail { border-block-start-color: CanvasText; }
  .watchdog .wd-row:focus-visible { box-shadow: inset 0 0 0 2px Highlight; }
}

/* ---- 10. print ----------------------------------------------------------
   The most common way this page's content leaves the browser is a screenshot
   pasted into an incident ticket. A printed held wall must be self-identifying. */
@media print {
  .watchdog .mo-rail, .watchdog .mo-hold, .watchdog .mo-payload { display: none; }
  .watchdog .mo-print-state { display: block; }     /* feed sentence + absolute timestamp */
  .watchdog .mo-advance-text { display: table-cell; } /* textual Advance column */
  .watchdog .mo-mark { opacity: 1; }
}
.watchdog .mo-print-state, .watchdog .mo-advance-text { display: none; }

}  /* @layer wd-motion */

/* ---- 11. global kill switches — FIRST layer, so important precedence is
   declared. !important is required to beat unlayered styles.css. ---------- */
@layer wd-kill {
  /* Rauno: "Switching themes should not trigger transitions and animations." */
  [data-theme-switching] .watchdog,
  [data-theme-switching] .watchdog * { transition: none !important; animation: none !important; }

  /* operator + E2E escape hatch. Delays too, or the hatch still races (panel #24). */
  .watchdog[data-instant] *, .watchdog[data-instant] *::before, .watchdog[data-instant] *::after {
    transition-duration: var(--mo-instant) !important;
    animation-duration:  var(--mo-instant) !important;
    transition-delay: 0s !important;
    animation-delay:  0s !important;
    animation-iteration-count: 1 !important;
  }

  /* e-ink and low-refresh panels. `*` alone suffices now that the rail fill and
     the mark are real elements rather than pseudo-elements. */
  @media (update: slow) {
    .watchdog * { transition: none !important; animation: none !important; }
  }
}

/* ---- 12. utility -------------------------------------------------------- */
.watchdog .mo-vh {
  position: absolute; inline-size: 1px; block-size: 1px; margin: -1px;
  padding: 0; border: 0; overflow: hidden; white-space: nowrap; clip-path: inset(50%);
}
```

### 7.5 Markup

```jsx
<div className="watchdog"
     data-poll={poll}            /* initial | draining | awaiting | late | dead | manual */
     data-held={held || undefined}          /* ORTHOGONAL to data-poll (panel #9) */
     data-visible={visible}
     data-order-frozen={orderFrozen || undefined}>

  <div className="wd-header">
    <div className="mo-cadence" role="group" aria-label="Update cadence">
      <div className="mo-rail" aria-hidden="true"><div className="mo-rail-fill" ref={railRef} /></div>

      {/* The M4 carrier, and the teacher. ALWAYS a consequence sentence, never a
          status label — one formatAge(), capital-first, em-dash (panel #34). */}
      <span className="mo-age">{pollSentence}</span>
      {held && <span className="mo-age">Held — values frozen {formatAge(heldSince)} ago; the wall is not live.</span>}

      <button type="button" className="mo-hold" aria-pressed={held} onClick={toggleHold}>Hold</button>
      {poll === "manual" && <button type="button" onClick={() => pollRef.current.refresh()}>Refresh</button>}
      <label className="mo-vh" htmlFor="wd-cadence">Update frequency</label>
      <select id="wd-cadence" value={intervalMs} onChange={onCadenceChange}>
        <option value={2000}>2s</option><option value={5000}>5s</option>
        <option value={15000}>15s</option><option value={0}>Manual</option>
      </select>

      {/* An interface whose primary signal is ABSENCE must teach that absence
          once, explicitly — and a disclosure survives a screenshot, a tooltip
          does not. This is the most product-specific object on the page. */}
      <details className="mo-legend">
        <summary>What the marks mean</summary>
        <dl>
          <dt>Dashed mark</dt><dd>Alive, but not advancing for 3× its own measured cadence</dd>
          <dt>No mark</dt>    <dd>Advancing on schedule — or its cadence is not yet measurable</dd>
          <dt>Stepped rail</dt><dd>Our poll cycle is on schedule</dd>
          <dt>Cap only</dt>   <dd>A request is in flight</dd>
          <dt>Dashed rail</dt><dd>The poll failed — the reason is shown beside it</dd>
        </dl>
      </details>
    </div>

    {/* Exactly ONE polite region, in the DOM from first paint. Consequence
        transitions only — a component leaving READY, a component wedging, a
        component vanishing, a registry mutation settling — coalesced to at most
        one utterance per poll, and SILENT when nothing of consequence happened.
        The sequence span exists because aria-atomic with an identical
        consecutive string does not re-announce, and flapping is the
        highest-signal behaviour on this page (panel #33). */}
    <p className="mo-vh" role="status" aria-live="polite" aria-atomic="true">
      {consequenceSentence}<span className="mo-vh">{` (${utteranceSeq})`}</span>
    </p>
  </div>

  {/* treegrid, because rows carry aria-expanded. Explicitly NOT a live region. */}
  <div className="healthx-frame" role="treegrid" aria-label="Component health"
       aria-live="off" aria-busy={committing || undefined}
       tabIndex={rows.length === 0 ? 0 : -1}
       onKeyDown={onGridKeyDown} onFocusCapture={freezeOrder} onBlurCapture={maybeReleaseOrder}>

    {rows.length === 0 && <EmptyState kind={emptyKind} />}   /* three kinds, §7.6 */

    {rows.map((r) => (
      <div key={r.componentId}          /* STABLE ID. An index key throws a keyboard
                                           user to <body> every 2 seconds. */
           role="row" className="wd-row"
           data-evidence={r.freshnessState}       /* FRESH|STALE|CLOCK_SKEWED|UNAVAILABLE */
           tabIndex={r.componentId === activeRowId ? 0 : -1}
           aria-expanded={r.componentId === openRowId}
           aria-describedby={r.advance === "wedged" ? `${r.componentId}-adv` : undefined}>

        {/* column 0 — the advance gutter. Mine, and nothing else paints here. */}
        <span className="mo-mark" data-advance={r.advance} aria-hidden="true" />
        {r.advance === "wedged" && (
          <span id={`${r.componentId}-adv`} className="mo-vh">
            Alive but not advancing for {formatAge(r.sinceAdvance)}; expected every {formatAge(r.cadenceP50)}.
          </span>
        )}

        {/* column 1 — the state glyph gutter. status-chip's. */}
        <span role="gridcell"><WdStatusChip {...r.chip} /></span>

        <span role="gridcell" className="wd-name">{r.name}</span>
        <span role="gridcell" className="wd-num">{r.p99}</span>   {/* numeric owner's class */}

        <span role="gridcell" className="mo-evidence"
              style={{ anchorName: openRowId === r.componentId ? "--mo-active" : "none" }}
              onFocus={() => openPayload(r, "keyboard")} onBlur={closePayload}>
          <span className="mo-age">{formatAge(r.evidenceAge)}</span>
          <span className="mo-advance-text">{r.advance}</span>   {/* print only */}
        </span>
      </div>
    ))}
  </div>

  {/* ONE payload node, in the top layer. Not inside the clipping frame; not 24
      promoted layers. No interactive content (Rauno). */}
  <div className="mo-payload" popover="hint" ref={payloadRef} id="mo-payload"
       role="tooltip" data-source={payloadSource} />
</div>
```

```
── keyboard (roving tabindex composite: ONE tab stop, so focus survives polls) ──
   ↑ ↓ move active row · Home/End first/last · Enter/Space toggle disclosure
   Esc close payload, focus returns to the owning row · Tab leaves the wall
   scrollIntoView({ block: "nearest", behavior: "instant" }) — never "smooth" for key nav.

   If the active component DISAPPEARS from the feed — among the most important
   events possible on a watchdog — activeRowId moves to the nearest surviving row
   by prior index, DOM focus moves if the grid had it, and the removal is
   announced (panel #31). If the list empties, the grid container itself takes
   tabindex=0 and hosts the empty state.

── order freeze ──
   :hover or :focus-within inside the table sets data-order-frozen; pending
   reorders are counted in the header ("3 rows will reorder") and applied on
   leave/blur. onBlurCapture defers to rAF and checks relatedTarget containment
   before releasing, or ↑/↓ navigation reorders rows under the keyboard user
   (panel #32). Window blur is a fallback for alt-tab.
   ESCALATION: a row entering a wedged or non-terminal state WHILE frozen still
   gets its mark, plus a header line — "1 row moved to critical — release to
   reorder" — because suppressing that is the case where the freeze causes the
   incident. I own this counter; without it the freeze is a silent lie.

── hover intent ──
   Velocity is sampled on the DOCUMENT over a ~50ms rAF-coalesced window: the
   trigger only sees moves once the pointer is already inside it, so the sample
   that matters — the approach — is never seen there (panel #6).
   arm   on pointermove inside the trigger when windowed speed < 600 px/s and no timer pending
   cancel when windowed speed > 1200 px/s        (Nagios high/low hysteresis)
   open  after --mo-dwell-arm, or at 0ms if a peer closed within --mo-dwell-warm
   close after --mo-dwell-close; entering the payload cancels the close
   Never arm on an aria-disabled control (Rauno). All timers read [data-instant].

── rail restart (WAAPI on a REAL element) ──
   onSettled(intervalMs) {
     const el = railRef.current;
     el.getAnimations().forEach(a => a.cancel());   // works: real element, no options
     el.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
       { duration: intervalMs, easing: `steps(${Math.max(1, Math.round(intervalMs / 1000))})`,
         fill: "forwards" });
   }
   No settle -> no restart -> the rail stops and the header says why.
   The animation IS the evidence; nothing in CSS can fake it.

── visibility ──
   hidden  -> pause polling, data-visible="false", loops paused (Rauno).
   visible -> render the HELD age FIRST; clear only when a real poll lands. Never
              silently render fresh-looking data that predates the hidden period.
```

### 7.6 Contracts published to other owners

Handed over rather than annexed. Each is a requirement with the finding attached.

**To `toggle.md`** (panel #7, #30) — the mutation motion contract:
`--mo-base` for knob travel, `--mo-out`, and the law *the knob's motion is the receipt*, which is a
motion law rather than a data law precisely so it will be obeyed. Busy-glyph timings, quoted from
Vercel: show-delay 240ms, minimum visible 480ms. Plus the two findings I cannot fix from here:
(a) **a registry mutation IS a consequence transition** and must be routed into my `role="status"`
region — the non-optimistic doctrine is correct and, uncorrected, it makes the blind path *worse*
than an optimistic one, because there is no state change to announce;
(b) a **gated** control must not be pixel-identical to a broken one, and Rauno's no-tooltip-on-
disabled rule removes the usual escape, so it needs a permanently rendered owner line with a real
next action (L9), and the click guard must cover `pending || gated`.

**To `status-chip.md`** (panel #28) — UNKNOWN / UNAVAILABLE / NOT_CONFIGURED / probe-broken need
distinct **static** carriers, not one appearance plus free text. The motion consequence is mine and
it is absolute: none of the four is non-terminal, so none may move and **none may shimmer**. Shimmer
promises "loading, and it will succeed"; UNKNOWN is not loading. Shimmer is licensed on this page in
exactly one place — `data-poll="initial"`, where a request is genuinely in flight.

**To `tokens.md`** (panel #29) — `--mo-gutter-advance: --sp-4` at column 0 and `--gutter-icon: --sp-6`
at column 1, summing to `--sp-7`; every element on the page keys its left edge off that sum.

**To `owner-row.md`** — the row owns `padding-inline-start`; I only paint inside column 0.

**To the numeric owner** (panel #18) — `text-align: right`, `tabular-nums`, `min-inline-size` from
the scale. My round-1 inline `minWidth: '7ch'` is deleted.

**To the table owner** — three empty states, each naming cause and next action, because zero rows
plus a happily draining rail asserts "everything is fine" and three different truths produce it:
`No components registered — register one` / `No components match this filter — clear filter` /
`Query returned no rows — {reason}`. The rail keeps telling the truth about the poll independently of
row count. The policy is mine; the markup is theirs.

### 7.7 Deletions and gates

Delete outright, verified line numbers:
`styles.css:3736-3741` — `.flash-up / .flash-down / .cell-up / .cell-down` (V1's ancestor: a
green/red value flash whose 0.8–1.4s decay never completes at a 2s cadence, so it is a permanent
coloured strobe, not a flash — SC 2.2.2 moving content with no pause mechanism — and it asserts an
up/down polarity that latency data does not carry).
`styles.css:519` and `:26740-26748` — `.nwx-line.fresh { animation: intelArrival 760ms ease-out 2 }`.

CI gates (the backstop is a lint rule, not a universal selector — §6.5):
no `transition: all` and no `animation` under `web/src/features/watchdog/` except the three named in
this file; no duration literal in TS (all read from computed style at boot); no `font-weight` inside
a `:hover` or `[aria-selected]` block anywhere.

---

## 8. States

Default · wedged · wedged-withdrawing · cadence-unknown · clock-skewed · row hover · row
focus-visible · hover+focus simultaneously · expanded · order-frozen · row removed while focused ·
payload closed/arming/warm-open/open-pointer/open-keyboard/closing/suppressed · poll
initial/draining/awaiting/late/dead/manual · held (× any poll state) · returning from a hidden tab ·
three empty states · reduced-motion · forced-colors · update:slow · print · theme-switching ·
tab-hidden · `[data-instant]`.

Full behaviour for each is in §7.3 and §7.5.

---

## 9. Open questions

1. **The advance cadence window needs a home.** 21 samples per row × 24 rows is a small ring buffer,
   but it must survive a remount or the wedge predicate resets to `cadence-unknown` on every
   navigation. It belongs in the store beside the poll, not in component state. Needs the data-layer
   owner.
2. **`3 × p50` is the one threshold still chosen by me.** Everything else in this file is measured or
   server-supplied. If the projection ever grows a per-component `advanceBudgetMs`, this element
   should read it and the constant should be deleted. Worth asking for.
3. **600 / 1200 px/s velocity thresholds are reasoned, not measured.** The shape is Nagios's
   hysteresis; the magnitudes should be validated against a trackpad and a mouse at the real 28px row
   height before they are treated as constants.
4. **`popover="hint"` and CSS anchor positioning support.** Both are recent. The fallback is
   `position: fixed` + `getBoundingClientRect()`, which is a real code path that must be tested, not
   an assumption. Needs a browser-support floor from the platform owner.
5. **There is still no `.watchdog` root class in the codebase** — `features/watchdog/` currently
   contains only `StatusChip.tsx` and four CSS files. Everything here is scoped to `.watchdog`; the
   page shell owner must add it or the sheet is inert.
6. **Hold: stop the network poll, or keep polling and buffer?** Buffering is better (release shows
   true current state instantly) but costs memory over a long hold. Recommend buffering with a cap
   and a `held 12 updates` count. `createSettledPoll` supports either via `stop()`/`start()`.
7. **`.mo-vh` is the fourth visually-hidden class in this codebase** (`.aiox-page .sr-only`,
   `.pcr-visually-hidden`, and `owner-row.md`'s `.wd-vh`). Two Watchdog specialists have now
   independently shipped one. It should be one utility in `tokens.md`.
