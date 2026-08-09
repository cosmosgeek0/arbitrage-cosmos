# Watchdog — status / posture chip

**Round 2.** Round 1 designed against the enum in the brief instead of the enum in the code. The
panel was right, and the fix is larger than the panel proposed.

---

## 0. The panel round

### 0.1 The finding that reframed the element

The panel said the real union has fifteen members instead of eight. It has more than that, and the
plural is the point. The Watchdog page renders **fourteen distinct state unions**:

| union | where | members |
|---|---|---:|
| `runtimeState` | `aiOps/types.ts:436` | 14 |
| `activationState` | `aiOps/types.ts:426` | 5 |
| `AiOpsPosture` | `aiOps/types.ts:1` | 12 |
| `policyResult` | `aiOps/types.ts:289` | 3 |
| `ProductLifecycle` (desired **and** observed) | `model.ts:40` | 13 |
| `ProductCapability` | `model.ts:55` | 11 |
| `ProductTruthLabel` | `model.ts:28` | 10 |
| `ControlWiringState` | `model.ts:79` | 5 (**2 carry a payload in the type**) |
| `ControlResultStatus` | `model.ts:86` | 14 |
| `freshnessState` | `model.ts:225` | 4 |
| `dataQualityState` | `model.ts:237` | 4 |
| `retryState` | `model.ts:239` | 6 |
| `checkpointState` | `model.ts:247` | 6 |
| `restartState` / parity / `credentialPosture` | `model.ts:249`, `types.ts:452-454` | 4 / 3 / 4 |

A closed eight-member vocabulary is not "a closed vocabulary" here — it is a closed vocabulary over
the wrong set, and every member it lacks gets bucketed by whoever writes the next call site.

**So the element is no longer a chip with an enum. It is a total function from every one of those
unions onto one closed seven-rung ladder, with an exhaustive `satisfies Record<Union, Posture>` per
union and no default branch.** Adding a member upstream breaks the build in `posture.ts`, at the one
place that has to decide what it looks like. The panel proposed this for one union; it is worth
doing only if it is done for all of them.

**The rung never appears as text.** The word the operator reads is the system's own enum member,
sentence-cased mechanically (`SHADOW` → "Shadow", `RATE_LIMITED` → "Rate limited"). That is the
answer to the panel's genericness charge (#27): the vocabulary is the product's, and the seven rungs
are machinery that is never read.

### 0.2 Three things in the tree that were already true, and that round 1 re-invented badly

1. **`model.ts:1905-1944` already enforces reason-required at the schema level.**
   `COMPONENT_RETRY_COOLDOWN_EVIDENCE_REQUIRED`, `COMPONENT_CHECKPOINT_EVIDENCE_REQUIRED`,
   `COMPONENT_DATA_QUALITY_GOOD_EVIDENCE_REQUIRED`, and — the mirror image —
   `COMPONENT_RETRY_UNKNOWN_CONFLICT`, which rejects a snapshot that reports retry *details* for a
   retry state it claims not to know. The evidence line is therefore **derived, not authored**.
   There is no "the author forgot the `reason` prop" path to design around, which dissolves panel #6
   at the root rather than patching it.
2. **`presentation.ts` is already the honest-labels authority**, and already ships the anti-green
   law in code: *"stale demotes to warn, silent demotes to bad, unknown freshness demotes to idle.
   Green is only reachable by fresh, known, ready."* Round 1 presented this as its own discovery.
   It is the house law; this element's job is to render it, and to match `componentTone` exactly so
   the two cannot diverge.
3. **`ControlWiringState` puts the reason inside the type**: `` `UNAVAILABLE:${string}` `` and
   `` `PENDING_BACKEND:${string}` ``. The codebase's own type system already says an unavailable
   control must carry its reason. The chip **parses** it instead of asking for it.

### 0.3 The state class round 1 missed, and the one the panel also missed

**`SHADOW` / `ACTIVE_DIAGNOSTIC` / `WIRED_FIXTURE` / `SYNTHETIC_ONLY` / `VALIDATE_ONLY` — executing
correctly, deliberately not authoritative.** Fowler: dark launching "does all the work it would do
when it's released, but nobody can see that it's doing it." Round 1 spent two thousand words proving
a stale green is a lie because the evidence expired, then missed the case where the evidence is
perfect and the *authority* is absent. Same failure, one level up. `unenforced` is now a rung, it is
**bare and hueless** (shadow mode is a correct configuration, not an incident — tinting it would
make a deliberate choice read as a fault), and its mark is a disc inside a ring: the work is
happening, inside a boundary it cannot cross.

**What the panel also missed: `freshnessState` includes `CLOCK_SKEWED` (`model.ts:225`).** Staleness
is not a boolean and not even a two-valued modifier. When the clock is skewed, *the age itself is
unmeasurable*, and printing "41m ago" is a fabricated number — the worst output available to an
element whose entire job is freshness honesty. `CLOCK_SKEWED` demotes to `absent / unmeasurable`,
the clock cell renders an em dash, and the reason says why. **It is the one case where the correct
behaviour is refusing to compute a number.**

### 0.4 Panel findings sustained and fixed

| # | finding | fix |
|---|---|---|
| 1 | enum is fiction | fourteen exhaustive tables in `posture.ts`, no default branch |
| 2 | `SHADOW` mapped to READY is the worst lie | `unenforced` rung, bare, disc-in-ring mark |
| 3 | no concept of a self-clearing state | `waiting` rung + a reserved right-aligned clock column |
| 4 | `BLOCKED` is two facts in one word | `failed·ours` / `failed·theirs`: same fill, different silhouette, actor leads the evidence |
| 5 | STALE implemented as a peer, collapsing four topologies to one | modifier composes: base mark and word untouched, tone demotes one step |
| 6 | DEFECT demoted a proven failure to a grey box | posture/glyph/word untouched; the defect lands in the evidence slot and names the validator rule |
| 7 | the reason was clipped to nothing at the only call site | `display: contents` — chip, evidence and clock become tracks of the **row's** grid |
| 8, 13 | the age truncated first; L5 claimed, not delivered | the clock is its own reserved right-aligned tabular column |
| 9 | `user-select: none` killed the stated copy affordance | `user-select: text` everywhere; the row handler guards on `getSelection()` |
| 10, 11, 12 | contrast measured on the wrong background; dark held at 3.38:1; the reason line left on raw `--muted` | stop declaring local colours: consume `--ok/--warn/--bad/--held` and `--ink-1..3` from `tokens.md`, which measures every value in APCA on the worst-case surface |
| 14 | a 24% glyph size ramp indexed to severity | one silhouette: every mark inscribes in exactly ⌀11 in the 16-box |
| 15 | the ink arithmetic used a disc that did not exist | recomputed below from the shipped paths, with the derivation printed |
| 17 | off-scale values (1.8 stroke, 1.75 in the lede, 200ms vs 160ms, a raw `#fff`) | stroke derived from `--pc-glyph`; every duration delegated to `motion.css`; `--on-solid` consumed as a token |
| 20, 21 | the change wash painted over the word; flapping went silent | an **outline** transition on an attribute — arrival at 0ms, withdrawal eased; nothing to restart |
| 22, 23 | `proving` invisible where it matters; rotation destroyed glyph semantics | **deleted.** A fetch in flight belongs to the poll, not the state; `motion.css` already owns the liveness rail |
| 24 | the migration was asserted and never happened | the four deletions land in the same commit; listed in §6 |
| 28 | a feature file wrote thirteen properties into `:root` | everything scoped to `.watchdog`; identifiers and numbers delegate to their roster elements |
| 29 | the label could ellipsise | `.pc-chip { flex: none }`; the evidence absorbs all overflow |
| 30 | a negative margin broke the column contract it was negotiating | deleted — with `display: contents` there is no box to margin |
| 31 | forced-colors collapsed three rungs into one | stated honestly: the ladder falls back to **two** steps plus `border-style`; do not claim three |

### 0.5 Where the panel is wrong, proved

- **#18 — "font-weight 500 matches nothing; use 470."** `.healthx-state`'s 470 is one of the four
  vocabularies this element deletes. Matching the weight of the thing you are replacing is not scale
  discipline, it is inheriting the drift. `tokens.md` §7.2 is the roster's scale authority and
  restricts weights to **450 / 500 / 550 / 600**, with T4 (the value register) at 12px/16px/**500**.
  470 is not on that scale.
- **#19 — "gap 6px against the 7px it replaces."** Same argument: `--sp-3` is 6px and the sub-grid is
  2px. 7 is off-grid. The panel's *real* point — a 1px gutter shift during a partial migration — is
  answered by landing the four deletions in the same commit, which §6 does.
- **#25 — the `.chip-tag` characterisation was stale.** Conceded; verified against `styles.css:3091`.
  The rejection of the hue-per-state scheme no longer rests on casing at all — it rests on the ink
  arithmetic in §3, which is casing-independent.

---

## 1. References — twelve, all fetched this session, mechanic named

| product | url | taken |
|---|---|---|
| Vercel Geist StatusDot | https://vercel.com/geist/status-dot | "every state ships with a distinct title and label so colorblind users get the same information" — the word is the accessibility primitive, so no icon-only mode exists in the API. And "the dot animates while `BUILDING` or `QUEUED` and goes static once the deployment reaches a terminal state" — motion means non-terminal. Round 2 applies it by **deleting** the `proving` prop: the deployment is non-terminal in Geist's case; here it is the *fetch* that is in flight, and that is a different object. |
| MDN `Retry-After` | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After | "A non-negative decimal integer indicating the seconds to delay" on 429 and 503. Proof that a resume time is a protocol-level fact, not a UI invention — the whole justification for the `waiting` rung and the clock column. |
| GitHub REST rate limits | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | `x-ratelimit-reset` — "the time at which the current rate limit window resets, in UTC epoch seconds", and "you should not retry your request until after the time specified". The countdown target is *published*, so rendering it is reporting, not guessing. Mirrored in this codebase as `retryAtMs` / `cooldownUntilMs`. |
| Stripe error handling | https://docs.stripe.com/error-handling.md?lang=node | `outcome.type === 'blocked'` (our fraud system refused) is a **different object** from `card_declined` (the issuer refused), and Stripe says both "can occur when your integration is working correctly." That is the `failed·ours` / `failed·theirs` split, with production precedent. Also: on a connection error, "treat the result of the API call as **indeterminate**" — the canonical definition of a first-class unknown that is neither success nor failure. |
| Martin Fowler — Dark Launching | https://martinfowler.com/bliki/DarkLaunching.html | "does all the work it would do when it's released, but nobody can see that it's doing it." The definition of `unenforced`, and the reason a shadow lane may never render green. |
| Grafana — alert state & health | https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rules/state-and-health/ | `grafana_state_reason`: Grafana ships a machine-readable **reason alongside the state**, precisely because the state alone lies about why. Corroborates the evidence slot as structure rather than decoration. Round 1's negative reference (state-timeline renders absence with the base threshold colour, #42868) still stands as the reason there is no null render path. |
| TypeScript handbook — exhaustiveness | https://www.typescriptlang.org/docs/handbook/2/narrowing.html | `const _exhaustiveCheck: never = shape` — "Type 'Triangle' is not assignable to type 'never'." The mechanism that makes fourteen mapping tables a build-time contract instead of a code-review convention. `satisfies Record<Union, Posture>` for the plain unions; a `never` assertion for `ControlWiringState`, whose template-literal members cannot be `Record`-keyed. |
| Nord — Badge | https://nordhealth.design/components/badge/ | "the badge height comes from its line height alone" with `padding-block: 0` — height is derived (16 + 2×2 = 20) and 20 appears nowhere as a literal. Plus "sentence case, not title case" and "use a single word... only use two words if you need to describe a complex state", which is what forces the label-override table to shorten rather than rewrite. |
| GitHub Primer — Label | https://primer.style/product/components/label/ | Counter-example, verified: ten hue-only appearances (`default, primary, secondary, accent, success, attention, severe, danger, done, sponsors`), no icons. Ten hues works on an issue page showing two labels and fails on a wall of twenty. Primer's size discipline (exactly two sizes) is kept; its variant count is rejected. |
| Rauno Freiberg — Web Interface Guidelines | https://github.com/raunofreiberg/interfaces | "Font weight should not change on hover or selected state to prevent layout shift" — generalised to *constant across all seven rungs*, which is what makes hierarchy-from-fill literally rather than approximately true. "Disabled buttons should not have tooltips, they are not accessible" — the evidence is never a `title=`. "`font-variant-numeric: tabular-nums`... in tables or when layout shifts are undesirable, like in timers" — but tabular figures fix jitter *within* a string, not alignment *across* rows, which is why the clock is a reserved column. |
| Emil Kowalski — Great Animations | https://emilkowal.ski/ui/great-animations | `ease-out` "starts fast and slows down at the end, which gives the impression of a quick response", under 300ms, and "these actions are repeated sometimes hundreds of times a day, an animation would make them feel slow." Applied by delegation: this file declares no duration; `motion.css` owns the clock. |
| WCAG 2.2 — Non-text Contrast (1.4.11) | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | The 3:1 floor, and the **redundant-graphic exemption**: contrast need not be met where "a graphic with text embedded or overlaid conveys the same information." That is the formal licence for the mark — and only the mark — to carry the one-step-quieter signal while the label stays at the truth floor. The label is never downgraded, because an unreadable "Unavailable" is a hidden truth. |
| GitHub `relative-time-element` | https://github.com/github/relative-time-element | The machine-readable instant stays in the DOM via `datetime` even when the rendering is relative; and `no-title` exists "since titles are inaccessible to screen readers and keyboard users." The clock cell is a `<time dateTime={iso}>` with no `title`. |

Roster inputs consumed rather than re-derived: `docs/design/watchdog/tokens.md` (scale, ink tiers,
the four semantic hues and their allowed channels, every APCA measurement),
`docs/design/watchdog/motion.md` + `styles/motion.css` (all durations, the row change gutter, the
poll-liveness rail, the focus ring), `docs/design/watchdog/owner-row.md` §7 (this element owns the
posture vocabulary; the row owns identity, ownership and the warrant, and contains no hue at all).

---

## 2. Four variants — the design variables actually moved

### V1 — Cell chip on a three-slot row grid **(winner)**
Chip in the status cell; evidence and clock promoted onto the **row's** tracks via
`display: contents`. Hierarchy from fill (bare → tint → solid); identity from glyph topology; actor
from silhouette; time from a reserved right-aligned numeric column.
*Variables: hierarchy = fill · disclosure = all inline on three fixed tracks · alignment = mixed
(word left, number right) · chrome = scales with severity · motion = delegated.*

### V2 — Row rail
The posture is a 2px severity rail on the row's leading edge; the cell carries only the word, no
container. Zero horizontal cost — which is exactly what round 1's open question #1 was begging for.
*Variables: chrome = none · encoding = position + a single 2px mark · density = maximum.*

**Lost, on the schema rather than on taste.** Two reasons, both fatal. (1) `motion.css` already
reserves `--mo-gutter: 12px` on `.wd-row::before` for the change mark; a severity rail in the same
gutter is two marks in one track, and the motion element owns that track. (2) Decisive: a rail is
**per-row**, but a component row carries *nine* independent state fields — `observedLifecycle`,
`desiredLifecycle`, `freshnessState`, `dataQualityState`, `retryState`, `checkpointState`,
`restartState`, `truthLabel`, `capability`. A row-level rail forces one posture per row and destroys
the multiplicity the types exist to express. The very thing that made it attractive is what kills it.

### V3 — Sentence
No chip. One T4 sentence on a fixed grammar: *Basis Engine · Ready · Live public · on wired
evidence.* Absence-as-affirmative taken to its endpoint — `proven` renders no status object at all.
*Variables: chrome = none · hierarchy = grammatical position · disclosure = one line.*

**Lost twice.** It is `owner-row`'s element, verbatim (`owner-row.md` §5.3 ships that exact
sentence) — shipping it here duplicates a neighbour and manufactures the L10 drift the panel
flagged. And a sentence has no fixed x-position for a number, so twenty countdowns never align: it
fails L5 structurally, which is the one law round 1 claimed and did not deliver. Its
absence-as-affirmative idea is *partly* kept: `proven` draws no container and spends colour only on
an 8.25px mark.

### V4 — Ledger
Posture right-aligned on a fixed column, Reference Screen 4's mechanic: names left, values right,
tabular, no containers, hierarchy from column position and ink tier alone.

**Lost on a misreading it exposed.** Screen 4's rule is *numbers right, labels left* — right-aligning
a **word** produces a ragged left edge across twenty rows, and words are read left-to-right, so the
eye loses its anchor. Applying the mechanic to a word inverts it. But V4 donated the winner's best
part: the fixed right-aligned numeric track, which V1 adopts as the clock column and which is how
L5 finally becomes true.

---

## 3. The fight, quantified — recomputed from the shipped paths

Round 1's headline number cited "one 8.25px disc" while shipping `r=4.25` (6.375px). Recomputed, and
the geometry corrected so the claim and the code agree:

```
every mark inscribes in O11 in the 16-box; rendered at 12px -> 11 x 12/16 = 8.25px

proven mark          pi x 4.125^2                    =    53.5 px2
20 proven                                            = 1,070 px2   of --ok, total

failed chip   glyph 12 + gap 6 + "Blocked" ~46 + 2x8 =    80 px wide, 20 px tall
                                                     = 1,600 px2   of solid --bad
2 failed                                             = 3,200 px2

  ratio, winner            3,200 : 1,070  =  3.0 : 1   in favour of the failures
```

Against the default answer — a tinted pill per state, which is what "8 enum members" produces when
read as "8 colours":

```
tinted "Ready" chip   12 + 6 + ~33 + 16 = 67 px wide x 20 px = 1,340 px2
20 of them                                                   = 26,800 px2 of tinted green
2 solid failures                                             =  3,200 px2

  ratio, hue-per-state    3,200 : 26,800  =  1 : 8.4   the failures are OUTVOTED
```

That is the christmas tree, stated as arithmetic: in the hue-per-state scheme the healthy screen is
the loudest screen and two real failures are outvoted more than eight to one by the successes. In
the winner, the failures are the only objects on the page with a background at all. The conclusion
survives the correction and improves; the number is now derivable from the paths in the file.

`tokens.md` measures the same thing perceptually and agrees: greyscale mass, tinted-warn vs
solid-bad chip, **4.81×** light / **3.65×** dark.

---

## 4. Refinement pass 1 — adversarial

- **Is `waiting`'s arc decorative?** No: it is drawn to the measured fraction of the wait elapsed,
  quantised to the same steps the clock cell prints, so the two carriers cannot disagree — the
  non-motion carrier `motion.md` M4 requires. It does **not** animate (Geist: motion means
  non-terminal; twenty sweeping arcs is the christmas tree in motion). It steps at the poll. When the
  fraction is unmeasurable there is no arc, which is consistent with the em-dash rule.
- **Two rungs on one tint (`impaired` and `waiting`).** Deliberate. Both mean *not right now*; they
  differ by whether there is a deadline, and the deadline is visible in a dedicated column. Adding a
  fifth hue to separate them would spend the budget to say something the layout already says.
- **The change signal, re-mechanised.** An `outline` transition on an attribute, not a keyframe on a
  fill overlay. It reads identically on bare, tinted and solid; it never sits over the label; arrival
  is at 0ms and only the withdrawal is eased, so reduced motion costs zero information; and a
  component flapping twice inside the window simply stays marked, with no animation to restart. The
  panel's #20 and #21 are fixed by the same three lines.
- **`proving` deleted outright.** The panel proved rotation was invisible on the three states where
  "is this still being checked?" is urgent, and that rotating a 4-fold-symmetric dashed ring reads as
  a stutter while an 8-fold ring reads as static. The right fix is not a better spinner: a fetch in
  flight is a property of the *poll*, and `motion.css` already ships `.mo-rail` as the one liveness
  object on the page. Fewer parts.
- **Weight and size held constant across all seven rungs**, so a poll flipping `proven → failed`
  cannot reflow the row and fill remains the only hierarchy mechanism.

## 5. Refinement pass 2 — the parts that were still soft

- **I tried a conditional weight on the clock and cut it.** For `waiting`, the countdown is arguably
  the payload, so I raised it to `--ink-2`. Rejected: a rung-conditional type register is drift by
  construction, and twenty loud numbers is a new christmas tree. The clock stays at exactly one
  register (T5 / `--ink-3`) in every rung, and its **fixed right-aligned position** is what makes it
  findable. That is L5 doing the work colour was being asked to do.
- **The tightest tolerance in the set was `never-asked` vs `not-wired`** — round 1 had a 4-dash ring
  against an 8-dot ring, and admitted it. Replaced: `not-wired` is now an **open socket**, one
  asymmetric gap at 3 o'clock. One break against four breaks is separable at any size, in any theme,
  desaturated. The dotted ring is gone.
- **`held` still covers three facts** — `OWNER_GATED` (a person is withholding pending a decision),
  `DISABLED` (we turned it off), `PAUSED` (it is stopped on purpose). They differ in whether anyone
  is expected to act. Splitting would mean an eighth rung; instead the distinction rides on the
  evidence line's grammar — *"held by ops-2 since 14:02"* vs *"disabled by config on 2026-07-02"*.
  That grammar is the element's real contract, and it is logged as open question 3 rather than
  quietly papered over.
- **Best, or merely finished?** The honest remaining softness is that `posture.ts` mirrors the source
  unions rather than importing them, so a drift between the mirror and `types.ts` is caught only at
  the call site's `satisfies`. A generated table would be strictly better. Logged as open question 1.

---

## 6. Migration — lands in the same commit, or the accent argument is false on day one

1. Delete `.healthx-state.degraded { color: #bd781b }` and `i { background: #d6a11d }`
   (`Health.css:88-90`, `:184`) and the `.healthx-state` / `.healthx-live` / `.healthx-summary-cell`
   tone classes.
2. Delete `.state-pill.ok|bad|warn` (`styles.css:2544-2549`) — note `.warn` is **blue**, because it
   reuses `--accent`.
3. Delete `.chip-tag.ok|bad|gold|purple` (`styles.css:3091-3101`).
4. Delete the `hbPulse` loops on `.mode-pill.m-live .dot`, `.health-badge.ok .hb-dot`,
   `.hdr-ic.m-live`, `.net-btn.ok|bad` — a settled state never moves.

Until (2) ships, blue means "warning" in `.state-pill` and "held by a person" in this element, on the
same page. That is not a migration risk; it is the current state of the tree.

---

## 7. Open questions — owner decisions, not design decisions

1. **Generate `posture.ts`'s mirrored unions from the source types** rather than hand-mirroring them.
   Until then the `satisfies` clauses catch drift only where a table is consumed.
2. **`--on-solid` belongs in `tokens.md`**, not in this file. It is declared locally with a fallback
   only so the chip ships before the token migration lands.
3. **`held` covers withheld / disabled / paused.** Does the owner want three rungs, or is the
   evidence grammar sufficient? I believe the grammar is sufficient; it is not my call.
4. **Who owns the freshness contract?** The chip renders whatever `freshnessState` says.
   `presentation.ts:127` already overrides a publisher's `FRESH` that exceeds its own `maxAgeMs` —
   "the UI may format, never soften." That threshold must be published per component class, not
   guessed.
5. **`ControlResultStatus` (14 members) is mapped but unexercised** — mutation results may want a
   transient presentation (a result is an event, not a standing state). Needs the toggle specialist's
   ruling before the table locks.
6. **True column cost.** With `display: contents` the chip needs `auto`, the evidence `minmax(0,1fr)`
   and the clock a fixed `76px` track on `.wd-row`. That is the real ask of the table owner — stated
   plainly, unlike round 1's negative margin, which quietly consumed 8px outside the column it was
   negotiating for.
