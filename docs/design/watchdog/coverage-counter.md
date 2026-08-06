# Watchdog — section header with coverage counter (`wd-sec-`)

**Round 2.** Written after a review panel filed 57 defects against round 1, and after reading the
six roster files round 1 claimed to be coherent with and had not opened.

Target repo: `/Users/cosmosgeek/Desktop/Main`.
Ships to `web/src/features/watchdog/SectionHeader.tsx` + `styles/sectionHeader.css`.

---

## 0. The finding that reframes the element

Round 1 wrote an eight-member state enum (`proven / degraded / failed / unknown / unavailable /
inventory / empty / loading`), a `--wd-*` spacing scale, a `--warn` brown, three motion durations,
a `--faint` ink, a JS `midTruncate()`, and a 2px hue-and-texture state rail.

Every single one of those already ships, better, one directory over — and two of them are now on
their **own** round 2, which round 1 could not have known but which changes the answer completely:

| round 1 invented | already owned by | what the real thing says |
|---|---|---|
| an 8-member state enum | `posture.ts` | a **7-rung ladder** — `proven / unenforced / impaired / waiting / held / failed / absent` — as a *total function* over the **fourteen real state unions** in this codebase, `satisfies Record<Union, Rung>` with no default branch |
| `--wd-s1..s10` spacing | `tokens.md` §7.1 | `--sp-1..9` = 2 4 6 8 12 16 24 32 48; *"≤ --sp-4 is intra-component, ≥ --sp-5 is inter-component, nothing in between"* |
| `11.5px / 10.5px`, weights `420…640` | `tokens.md` §7.2 | *"Every font-size is an integer — no 13.5, no 11.5, no 10.5"*; weights *"450 / 500 / 550 / 600 … no others"* |
| `--warn: #bd781b` + `--warn-soft` | `tokens.md` §7.4 | `--warn` is already defined, `#8f5d07` / `#e6b44f`, measured Lc 72.3 / 64.3, channel-constrained to *ink or tint* |
| `--faint` on five sites | `statusChip.css` | *"`--faint` (2.54:1 light / 2.40:1 dark) appears nowhere in this element"*; the truth floor is `--ink-3` at Lc 64 |
| `--up` on a 14px numerator | `tokens.md` §7.4 | `--ok` is **glyph only, ≤12px, never text, never fill** |
| `.15s` / `150ms` durations | `motion.css` §1 | five durations `0 / 90 / 160 / 200 / 320`; *"Anything else is a bug"* |
| a panel entrance animation | `motion.css` M3 | *"Information appears at 0ms. Only its WITHDRAWAL is eased."* |
| `midTruncate()` in `format.ts` | `field.css` §5 | self-correcting CSS middle truncation, `text-overflow` supplies the ellipsis *only* when overflow occurs; **the full string stays in the DOM** |
| a 2px hue+texture state rail | `statusChip.css` | severity is *fill and only fill*, on a glyph ladder with measured contrast and a runtime reason invariant |
| `--pc-clock-w` equivalent | `statusChip.css` slot 3 | *"the page's one right-aligned numeric column (L5)"* — already reserved, already aligned across every row |

The panel's most damning sentence was right and understated it: round 1 was not merely generic, it
was a **regression against its neighbour while claiming to be the coherent one**. This round
therefore starts from a different question.

**The question.** If `StatusChip` owns the posture, the evidence line, the reason invariant and the
clock; if `tokens.md` owns every size, weight, ink and hue; if `motion.css` owns every duration, the
chevron rotation and the focus ring; and if `field.css` owns identifier truncation — **what is left
that is actually mine?**

Exactly one thing, and it is the element's name: **the counter**. Everything else in this header is
composition. That constraint is the best thing that happened to this element.

---

## 1. References — 13, all fetched this session, mechanic named

The panel's charge (#57) was that round 1's evidence base was entirely generic observability, which
is *why* the result was generic. Four of the thirteen below are now product-domain — financial
infrastructure and exchange status surfaces — and three of those produced **negative** findings that
directly shaped the design.

| # | source | URL | the specific mechanic taken |
|---|---|---|---|
| 1 | **Kubernetes — Deployment** | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ | The single strongest evidence for this round's thesis, and it is a *shipped* product at planetary scale. `kubectl get deployments` prints `READY` as *"the pattern ready/desired"* — and then prints **`UP-TO-DATE` and `AVAILABLE` as two more integer columns beside it**, because the ratio alone is insufficient. Kubernetes did not fix an ambiguous fraction with better typography; it fixed it by **printing the partition as adjacent named integers**. That is the winner's mechanic, taken whole. |
| 2 | **Chainlink — Data Feeds** | https://docs.chain.link/data-feeds | The freshness gate, from the product's own domain. A feed declares a **heartbeat**; consumers *"should track the `latestTimestamp` … to make sure that the latest answer is recent enough"*; and if the answer *"is not updated within the heartbeat … **pause operation or switch to an alternate operation mode**"*. Three things taken: (a) the budget is a **declared per-feed property**, which answers round 1's open question #1 — it is published with the group, not chosen by a designer; (b) it is rendered **beside** the age so the reader can do the comparison; (c) the consequence sentence is the model for the microcopy — *pause operation*, not *please be careful*. |
| 3 | **Coinbase — system status** | https://status.coinbase.com/ | A **negative** finding, in the product's own domain. Component groups carry a rolled-up worst-state word and **no count, and no evaluation timestamp anywhere on the component list** — the page says "All Systems Operational" *without indicating when that assessment was made*. That is the exact lie this element exists to prevent, shipped by the company whose sign-in screens are this fleet's reference standard. |
| 4 | **Kraken — system status** | https://status.kraken.com/ | Triangulation on the same finding: eight component groups, five status words, *"No numerical counts appear next to group headers"*, and *"the overall status page lacks a global 'last updated' timestamp."* Two exchanges, same two absences. |
| 5 | **Cloudflare — system status** | https://www.cloudflarestatus.com/ | Third instance, different vendor, same shape: group status is implicit in the members, there is no per-group count, and the only timestamps belong to incidents. Three independent status surfaces converge on *worst-state word, no count, no freshness* — so the two things this element adds are precisely the two things the category omits. |
| 6 | **W3C — CSS Overflow Module Level 3** | https://www.w3.org/TR/css-overflow-3/ | The load-bearing CSS fact, cited from the spec instead of from a blog (panel #56), **and it overturns the fix round 1 and the panel both proposed**. Normative: *"The visible/clip values of overflow compute to auto/hidden (respectively) if one of overflow-x or overflow-y is neither visible nor clip."* Therefore `overflow: auto clip` computes to **`auto hidden`**, and *"overflow: hidden still allows programmatic scrolling"* — i.e. it **is** a scroll container. `overflow: auto clip` does **not** rescue a sticky descendant. See §7. |
| 7 | **NN/g — Accordions on desktop** | https://www.nngroup.com/articles/accordions-on-desktop/ | Fetched specifically to check round 1's citation, and **the "30–50% faster initial task completion" figure does not exist in the article** — it contains *"no percentage-based performance statistics whatsoever."* Round 1 fabricated a number and used it to justify a load-bearing decision. Deleted. What the article *does* give is the three-part anatomy — *"Heading … Icon … Panel"* — and the rule that labels *"greatly impact the findability, discoverability, and accessibility of your content."* |
| 8 | **W3C WAI-ARIA APG — Accordion** | https://www.w3.org/WAI/ARIA/apg/patterns/accordion/ | The contract verbatim: *"Each accordion header button is wrapped in an element with role heading"*, `aria-expanded`, `aria-controls`; and the constraint that decides against `role="region"` — *"Avoid using the region role in circumstances that create landmark region proliferation, e.g., in an accordion that contains more than approximately 6 panels."* Also confirms only Enter/Space and Tab are required, which is why arrow keys stay unhijacked. |
| 9 | **Linear — display options** | https://linear.app/docs/display-options | *"Beside each group … you will see either the total number of issues in the group or the total estimate"*; *"The grouping header will remain sticky as you scroll down"*; and *"When toggled on, this setting shows groups with no issues"* — empty groups hidden by default. Sticky is taken; hide-empty is **inverted**, because in an evidence-gated app an omitted group is a lie of omission. |
| 10 | **Grafana — view alert state** | https://grafana.com/docs/grafana/latest/alerting/monitor-status/view-alert-state/ | The roll-up rule verbatim: rule state is *"determined by the 'worst state' among its alert instances"*; and *Alert Rule Health* separately *"indicates the status in cases of `Error` or `NoData` events"* — absence kept as a **peer concern**, not a severity. |
| 11 | **Prometheus — Alertmanager configuration** | https://prometheus.io/docs/alerting/latest/configuration/ | `group_by` — *"multiple alerts coming in for cluster=A and alertname=LatencyHigh would be batched into a single group"* — and `group_wait` as *"allows to wait for alerts to arrive"*. The reason a group header exists at all is **de-noising**, which means the header must carry the whole verdict or the de-noising loses information. |
| 12 | **Primer — CounterLabel accessibility** | https://primer.style/product/components/counter-label/accessibility/ | *"Always use CounterLabel with adjacent text that provides supplementary information regarding what the count is for."* Applied **per figure** — every integer in this element carries its own noun, including the timestamp, which round 1 exempted (panel #47). |
| 13 | **Emil Kowalski — Great animations** / **Rauno Freiberg — Web interface guidelines** | https://emilkowal.ski/ui/great-animations · https://interfaces.rauno.me/ | Emil: *"Never animate keyboard initiated actions. These actions are repeated sometimes hundreds of times a day, an animation would make them feel slow."* A disclosure toggle is exactly that, so the panel appears at 0ms. Rauno: *"Where available, tabular figures should be applied with `font-variant-numeric: tabular-nums`"* and *"Hover states should not be visible on touch press, use `@media (hover: hover)`"*. |

---

## 2. The fight, re-run — because the panel was right that round 1 rigged it

Panel #8 was correct: round 1's four variants moved the counter-form variable across three values
(fraction / bar / pips) and then the winner introduced a **fourth** value (words) that was never
fought. These four fight the winner's own mechanic.

### R1 — Fraction, annotated *(round 1's winner, "Coverage Ledger")*
**Variables:** counter form = fraction; hierarchy = typographic promotion of the ratio; the partition
demoted to an 11px support line.
`5/8` at the value register, right-aligned in a fixed numeric column; `2 unproven · 1 unreachable —
collector … offline since 09:41` beneath it.

**Verdict: loses, and its own thesis is the murder weapon.** Round 1 wrote *"`n/d` is the wrong data
structure"* and then rendered `n/d` as the most-scanned object on the header while whispering the
correction underneath. **Kubernetes settles it empirically**: `READY 3/5` is shipped, and it is
shipped *with two more integer columns beside it*, because the ratio does not say which two are
missing or why. If the fix for an ambiguous number is a sentence in a quieter ink, the number is
still the thing being read. Also loses on `488`: a cardinal with no denominator needs a whole second
rendering mode, which is L10 drift at the same semantic level.

### R2 — Remainder-primary
**Variables:** which end of the subtraction is promoted. Print only the deficit: `3 unproven of 8`.
Sorting the header by what is wrong rather than by what is right.

**Verdict: loses on asymmetry, and it is the most interesting loss.** A healthy section renders
`0 unproven`, and the doctrine forbids a rendered zero from doing an affirmative's job: `0 unproven`
on a proven section and `0 unproven` on a section whose first poll has not returned are the same
pixels. That is round 1's V1 defect re-created from the other side. It also deletes the scale — *3
unproven of what, and is the population 3 or 488?* — so it must re-import the denominator, at which
point it **is** R1 with the numerator flipped. **Donates the principle that survives into the
winner:** the deficit must be a *typed integer with its own noun*, never implied by subtraction.

### R3 — Posture-only, no count
**Variables:** whether a count exists at all. The header is the section name plus a composed
`StatusChip` and its evidence line. Zero numbers. Maximum neighbour coherence, zero new vocabulary.

**Verdict: loses, and it is the control experiment.** It is genuinely tempting — every fact it
renders is already owned and measured by a sibling. But a section header has a second job the chip
cannot do: **scale**. An operator deciding whether to open a chevron needs to know whether there are
3 lanes or 488 symbols behind it, and the worst-state word is identical for both. Primer's rule is
about *supplementing* a count with adjacent text, not deleting the count. And it collapses the two
states the doctrine cares most about: `Not configured` on a 488-row inventory and `Not configured` on
an empty section render identically. **Donates the whole warrant channel** — R3 is why the winner
composes `StatusChip` verbatim instead of building a rail.

### R4 — Class Ledger *(winner)*
**Variables:** the counter's **data structure** (fraction → an exhaustive partition of the
population); the **alignment strategy** (one right-aligned column → fixed left-packed tracks, with a
*separate* right-aligned column shared with the rows below); **who owns state** (mine → delegated
entirely to `StatusChip`); **how the reader verifies the counter** (trust → a self-auditing sum);
**how much of the element is new** (an invented rail and enum → zero colour tokens, zero durations,
zero new type sizes).

```
▸  Network lanes     8 lanes   5 proven   1 withheld   1 failing   1 unknown            1s heartbeat
   ◐ Impaired   3 lanes past heartbeat · collector cx-7f3a…b219 offline since 09:41        410ms
```

The counter is a **total partition of the population across four epistemic classes**, printed as
named integers on fixed tracks, whose visible values **must sum to the population printed at the
head of the same row**. Zero classes are omitted; their tracks stay reserved, so the position of an
integer is itself legible before the noun is read.

**Why it wins:** it is the only variant in which `5/8-with-three-unchecked` and
`5/8-with-three-on-fire` are *different pixels in different tracks* rather than the same number with
a different sentence underneath; the only one whose rendering of `488 symbols · 488 unknown` needs no
special case; the only one where the operator can **verify the counter with their own arithmetic**
instead of trusting it; and the only one that adds no colour, no duration, no type size and no state
vocabulary to a feature that already has all four.

---

## 3. What the counter actually is

### 3.1 Four classes, total over the real ladder

`posture.ts` is the vocabulary. Not an enum invented in a brief — a closed 7-rung ladder that is a
total function over the fourteen state unions this page really renders. The coverage class is a
total function over *that*:

```ts
export type CoverageClass = 'proven' | 'withheld' | 'failing' | 'unknown';

const CLASS_OF = {
  proven:     'proven',    // evidence proves it works AND the work is authoritative
  unenforced: 'withheld',  // shadow / dry-run / validate-only — executing, not in force
  held:       'withheld',  // a person or a policy is deliberately withholding
  waiting:    'withheld',  // halted with a KNOWN resume time; the clock owns the answer
  impaired:   'failing',   // serving, but not wholly
  failed:     'failing',   // proven failure
  absent:     'unknown',   // there is no state to report
} as const satisfies Record<Rung, CoverageClass>;
```

`satisfies Record<Rung, CoverageClass>` with no default branch: **add a rung upstream and the build
fails here**, at the one place that has to decide how it counts. This is the direct fix for the
panel's Tier-0 defect #1, where round 1's lowercase `RANK` table indexed the SCREAMING_SNAKE enum,
returned `undefined` for every real member, and therefore reduced to its seed — rendering **every
group green**. The seed problem is gone too, because there is no reduce over a rank: each member is
classified independently and the four counts are histogram buckets.

The four classes are not a taste call. They are the four answers to *"is this thing doing its job,
authoritatively, right now?"* — **yes**; **no, and somebody chose that**; **no, and something is
wrong**; **no idea**. Rendering `unenforced` as anything other than not-proven is the worst lie
available on this page: `posture.ts` says it outright — *"the worst available lie is to paint it
green: it claims an authority the system is deliberately not exercising."*

`withheld` is the panel's defect #2 (`OWNER_GATED` had no honest rendering) answered structurally: a
held control counts in a class whose noun means *deliberate*, and the composed chip renders it in
`--held` tint, never red and never green.

### 3.2 The self-auditing sum — the mechanic that makes the counter verifiable

```
8 lanes    5 proven    1 withheld    1 failing    1 unknown
└──────┘   └────────────────── 5 + 1 + 1 + 1 = 8 ──────────────────┘
```

The population is printed **first**, in the section's own unit noun. The four class counts follow.
Zero classes print nothing. The invariant is that **the visible integers sum to the printed
population** — so an operator can check the counter without trusting it, and a mis-derived counter
is visible as arithmetic that does not close, not as a plausible wrong number.

That is reference Screen 3's address rule (`0xb0bD…5f5415` — *both ends preserved so a human can
verify it*) applied to a number instead of a hash. L8 generalised.

It also disposes of the panel's #50: **filtering may not change any of the five integers.** `n` and
`d` are always the registered population; a filter affects only the rows below and says so in words,
in the row-1 slack track: `filter hides 5 of 8 rows below`.

### 3.3 The population noun is the product's, not ops-generic

`8 lanes`, `488 symbols`, `12 controls`, `4 venues`. The unit noun is **required** in the group
definition and CI-checked; there is no `items` fallback, because a generic fallback noun is exactly
the genericness the panel's verdict named ("nothing in the element knows it is watching an arbitrage
system"). `posture.ts` already establishes this law for the state word — *"the vocabulary stays the
product's rather than a generic ops taxonomy"* — and the counter obeys the same law for its nouns.

This is also what deletes round 1's `inventory` state. `488 symbols · 488 unknown` is the ordinary
grammar, not a special case, and it is a far better sentence than round 1's *"observed, no coverage
claim"* — which was designer language no operator thinks in (panel #46).

### 3.4 What the counter deliberately does **not** encode

Stated, because round 1 overstated its own mechanism and the panel caught it (#54).

**The counter encodes epistemic class only. It never encodes severity.** `impaired` and `failed`
both count as `failing`; `unenforced`, `held` and `waiting` all count as `withheld`. Which rung
produced the count is the composed chip's job (fill ladder: bare → tint → solid) and the panel's job
(one row per member). A four-integer summary that tried to be a seven-integer summary would be a
worse chip.

Consequence, stated rather than hidden: **two sections with an identical counter can have different
chips**, and that is correct — the counter answers *how much*, the chip answers *how bad*.

---

## 4. Anatomy

Two rows. Row 1 is the **claim** — what this section contains and how much of it is proven. Row 2 is
the **warrant** — a composed `StatusChip` in its `--standalone` three-slot form: posture, evidence,
clock.

```
grid-template-columns:
  [chev]   var(--gutter-icon)     /*  16px  the one icon gutter (L6)            */
  [name]   var(--sec-name)        /* 224px  fixed, so every counter shares an x  */
  [count]  var(--sec-count)       /* 480px  5 x --sec-track                      */
  [slack]  minmax(0, 1fr)         /*        filter note; and it pins the clock   */
  [clock]  var(--pc-clock-w)      /*  76px  INHERITED from statusChip slot 3     */
grid-template-rows: auto auto;
column-gap: var(--sp-5);   /* 12 */
row-gap:    var(--sp-1);   /*  2 */
```

| cell | col / row | content |
|---|---|---|
| chevron | 1 / 1 | 12px `.mo-disclose-chevron`, rotation owned by `motion.css` §8 |
| section name | 2 / 1 | T2 — 14/20/550, −.006em, `--ink-1` |
| coverage counter | 3 / 1 | five fixed 96px tracks; population + four classes |
| filter note | 4 / 1 | T6, `--ink-3`, right-aligned; rendered only when a filter is active |
| heartbeat | 5 / 1 | T6 tabular, right-aligned — the **budget** |
| `<StatusChip standalone>` | 2 / -1 / row 2 | chip · evidence · clock, its own three-slot grid |

**Why the chevron sits on row 1 and not centred across both** — panel #40, accepted. Reference
Screen 1's law is that icon and label are optically centred *together as one group*; NN/g binds the
indicator to the *heading*. `grid-row: 1; align-self: center`.

**Why the slack track exists** — panel #11 correctly killed round 1's undocumented `(free)` column.
This one has two jobs and both are load-bearing: it hosts the filter note, and it is the only way to
pin the clock track to the right edge so that **the header's clock lands in the same 76px column as
every row's clock beneath it**. All fixed tracks first, all slack last, is also the only arrangement
under which every section's counter shares one x at every viewport width.

**Why the age is far right and the counter is not.** Panel #10 was right that round 1's grid put the
evidence age ~1050px from the number it licensed, across a dead column, and then called that
adjacency. The resolution is that these are two different objects with two different correct
alignments: the **counter** is left-packed hard against the name it qualifies (12px, not 1000px),
and the **age** is right-aligned because it shares a real column with twenty clocks directly below
it — which `statusChip.css` already declares as *"the page's one right-aligned numeric column
(L5)"*. Alignment follows what the thing is compared against.

### 4.1 The vertical pair that gates greenness

```
                                                              1s heartbeat     <- row 1, the budget
   ◐ Impaired   3 lanes past heartbeat · collector …           410ms           <- row 2, the measurement
```

Both figures render **in the unit the group declares**, both tabular, both right-aligned in the same
76px track, one directly above the other. The comparison is vertical and needs no hue: the reader
sees `410` under `1s` (or `41m` under `30s`) and the breach is legible as digit shape.

This is panel #47 taken further than the panel asked. `evidence 4s ago` is a bare counter — Primer's
own rule, which round 1 cited and then exempted the timestamp from. And it answers round 1's open
question #1 with Chainlink's model rather than a shrug: **the heartbeat is a declared property of the
group, published on the wire, not a designer's number.** A group that ships without one cannot gate
greenness at all, so every member is classified `unknown` with the evidence line reading *"no
heartbeat declared for this section"* — an honest failure mode, matching `statusChip.css`'s
`[data-defect]` precedent, instead of an open question in a design doc.

Sub-second precision (panel #48): the unit is declared per group, so a lane section renders `410ms`
against `1s`, and a topology section renders `4m` against `15m`. This is an arbitrage control room;
`4s ago` on a lane is generic-ops formatting on a surface where 900ms is dead capital.

### 4.2 The age is the section's **oldest** member, and it is labelled that way

Panel #5, accepted without argument. Round 1 used the newest member's evidence — seven members at 2s
and one at 41m rendered "evidence 2s ago" and passed the greenness gate. `evidenceAgeMs =
max(memberAges)`. A section is only as fresh as its stalest member.

This composes correctly with the classification: a member past the heartbeat is demoted before it is
counted, so **every member counted `proven` is fresh by construction**, and the printed age is the
number that explains why the others are not.

---

## 5. Staleness — demotes toward absent, never toward a failure

Panel #4 was the sharpest finding in the review and it is accepted in full. `StatusChip.tsx:73`
already states the law:

> *"A stale chip may never render the affirmative tone… Staleness demotes toward **neutral** and
> never promotes, because only the affirmative tone is a claim that decays into a lie."*

Round 1 turned stale-`proven` into **`degraded`** — amber, an active assertion that something is
wrong. Nothing is known to be wrong; a claim expired. The rule here:

```
stale(member) ≡ memberAgeMs > group.heartbeatMs

rung === 'proven'  &&  stale   ->   absent (cause 'never-asked' for this window)   -> class 'unknown'
rung !== 'proven'  &&  stale   ->   rung unchanged, `stale` modifier set on the chip
```

A stale `failed` stays `failed` — *"a proven failure does not soften"* — and counts in `failing`,
while the chip carries the STALE glyph and the evidence line leads with the age. That is panel #6:
"it is broken now" and "it was broken when we last looked and we have stopped looking" differ by the
glyph, by the leading clause of the evidence, and by the clock, in three redundant channels. They
never differ by hue, because they are the same severity.

---

## 6. States

Every state below is a *derived* state. The component never receives a colour, a tone or a rung; it
receives counts, a heartbeat and a member list, and derives.

| state | counter | chip (composed) | interactive |
|---|---|---|---|
| **fully proven** | `8 lanes  8 proven` — the audit closes visibly, 8 = 8 | `proven`, `--ok` on a 12px mark and nowhere else | yes, and **collapsed by default** (§8) |
| **mixed** | `8 lanes  5 proven  1 withheld  1 failing  1 unknown` | worst rung present (Grafana) | yes, expanded by default |
| **nothing proven** | `8 lanes  8 unknown` | `absent`, cause-subtyped | yes, expanded |
| **withheld whole** | `12 controls  12 withheld` | `held`, `--held` tint, evidence names *who* and *since when* | yes, expanded |
| **inventory** | `488 symbols  488 unknown` | `absent`, cause `not-wired` | yes |
| **empty** (population 0) | `0 lanes` — no class figures; the sum closes at 0 | `absent`, cause `not-wired`, reason mandatory | **no** — plain heading, no chevron, no button |
| **not yet measured** | every integer `—` at `--ink-mute`; nouns still render | `absent`, cause `never-asked`; evidence: *"first poll in flight since 09:44:02"* | **no** |
| **clock unmeasurable** | counter renders normally | `.pc-clock[data-unmeasurable]` → em dash; heartbeat still prints | yes |
| **no heartbeat declared** | `8 lanes  8 unknown` | `absent`; evidence: *"no heartbeat declared for this section — coverage cannot be proven"* | yes |
| **filtered** | **unchanged**; slack track reads `filter hides 5 of 8 rows below` | unchanged | yes |
| hover | `background: var(--hover)`, **no transition** (`motion.css` §4 Tier 0), `@media (hover: hover) and (pointer: fine)` | — | — |
| focus-visible | `box-shadow: inset 0 0 0 2px var(--mo-ring)` — the inset variant `motion.css` §5 already ships for clipped rows | — | — |
| collapsed | chevron 0°, panel unmounted; **row 2 stays visible** | — | — |
| reduced motion / `update: slow` / forced colors | inherited wholesale from `motion.css` §10–11 | — | — |

**Not-yet-measured never renders `0`.** A zero you have not measured is the same class of lie as a
green you have not proven, and it is the one place the self-auditing sum would otherwise close
falsely (`0 = 0`). Em dashes at `--ink-mute` — which is precisely `tokens.md`'s stated job for that
tier: *"non-truth only — placeholder, disabled"*, and *"`--ink-mute` never carries truth."*

The evidence string for that state is *"first poll in flight since 09:44:02"*, not round 1's
*"reading…"* — a platitude, and the exact thing L7 bans (panel #44). Likewise *"no evidence in this
window"* is deleted: which window? (panel #45). The window is the declared heartbeat and it is
printed on the header, so the sentence can name it: *"no evidence inside the 30s heartbeat."*

**Empty and not-yet-measured render as a plain `<h2>` with no `<button>` and no `role`** — not a
disabled button (a disabled control implies *later*), and **not** round 1's `role="text"`, which is
not a real ARIA role and is Safari-only (panel #32). The visible DOM text says everything; the
heading is read as a heading.

---

## 7. Sticky — and the fix everyone had wrong

Round 1 and the panel both prescribed `overflow: auto clip` on the rows wrapper. **Per the CSS
Overflow spec, that does not work.**

> *"The visible/clip values of overflow compute to auto/hidden (respectively) if one of overflow-x or
> overflow-y is neither visible nor clip."* — CSS Overflow 3

`overflow: auto clip` sets `overflow-x: auto`, which is neither `visible` nor `clip`, so the `clip`
on the y axis **computes to `hidden`** — and the spec is equally explicit that `hidden` *"still
allows programmatic scrolling"*, i.e. it is a scroll container, i.e. it becomes the sticky containing
block. The header would still silently never stick.

**The only portable answer is structural, and it is the one this element ships:**

- `.wd-sec-sticky` is a **sibling above** the rows region, never a descendant of it.
- `position: sticky; top: calc(var(--header-h) + var(--sp-6));` — 58 + 16. The house currently ships
  three values for this one job (`+14` at `styles.css:4093/4715/4857`, `+16` at `:5551`, `+18` at
  `:2652/2775/12290`); `--sp-6` is the on-scale one and it matches an existing site exactly, so this
  is adoption, not invention. `scroll-margin-top` uses the same expression.
- `z-index: 2`. The ordering contract, stated because the next person will not infer it:
  `.wd-sec-sticky` (2) **<** `.mo-payload` (20, `motion.css` §4) **<** the page topbar. A row's hover
  payload must render over a sticky section header.
- The verified latent bug is still there: `web/src/pages/Health.css:274` — `.healthx-table {
  overflow-x: auto }` — would trap any sticky descendant. Keeping the header outside it is not a
  style preference; it is the only thing that works.
- **Row-level overlays must render in a portal.** Stated in the spec because `overflow` on the rows
  region will clip context menus regardless of which value it takes (panel #37).

Both rows are inside the sticky block, so **the warrant stays pinned with the claim** while the
section's rows scroll underneath. Round 1's rule — *collapsing must never hide the reason* — is
thereby extended: **scrolling must not hide it either.**

No `backdrop-filter`. No condense-on-stick morph. No "is it stuck" detection: the bottom hairline is
permanent. All three refusals from round 1 survive, and the panel agreed with all three.

---

## 8. Collapse — and the change signal, without motion

**The default-collapse rule is derived, not chosen** (round 1's open question #3, answered):

```
collapsedByDefault  ≡  proven === population  &&  population > 0
```

A section is collapsed on first paint **iff** its counter closes entirely into `proven`. That is
exactly the condition under which the header already tells the whole truth and the panel adds only
detail. Any non-zero `withheld`, `failing` or `unknown` opens the section. So "the page looks fine"
acquires a precise meaning: *everything you cannot see is proven, and every section you can see has
something to say.*

**The change signal is a state change, not an animation.** `statusChip.css` round 2 delegates all
motion to `motion.css`, whose row change mark is scoped to `.wd-row` and whose law M2 is that motion
never encodes severity. A collapsed section flipping `proven → failed` therefore has no flash to
give it — and it needs none, because the derived rule above becomes false and **the section
auto-expands**. The page physically opens the thing that broke. That is a stronger signal than any
wash, costs no token and no duration, and cannot be missed by a reduced-motion user.

Two guards, both borrowed from precedent already in the file:
- auto-expand is **deferred while a pointer or focus is inside the table region** and applied on
  leave — the same guard `motion.css` §9 uses for `data-order-frozen`, and for the same reason (never
  move a live surface out from under a cursor mid-click);
- auto-expand is **one-way**. An operator's manual expand is never undone, and an auto-expand is
  never auto-re-collapsed. A surface that closes itself is a surface that hides evidence.

`Alt`-click for expand-all is **deleted** (panel #41): undiscoverable, `Alt+Enter` is Properties on
Windows, and round 1 explicitly chose "zero added chrome", which meant zero discovery. Expand-all
belongs in the page's `?` shortcut sheet as a real, listed command, owned by the page.

---

## 9. Accessibility

- **APG structure**: `<button>` inside `<h2 id>` with `aria-expanded` and `aria-controls`.
- **No `role="region"`** on the panel — APG's landmark-proliferation warning at *"more than
  approximately 6 panels"*, and this page carries ~9. **No `role` at all** on the panel: round 1's
  `role="group"` would insert a generic container between the heading and a grid-based table and
  break its semantics (panel #36). `aria-labelledby` pointing at the heading is sufficient.
- **`id` lives on the `<h2>`**, referenced by both branches, so the interactive and non-interactive
  cases cannot dangle (panel #33).
- **The accessible name is the section name and nothing else.** Round 1 composed a ~20-word label
  that repeated the expanded state the button already announces and destroyed voice-control
  targeting ("click Network lanes"). The counter is exposed via `aria-describedby` pointing at the
  counter element, which is real text (`8 lanes 5 proven 1 withheld 1 failing 1 unknown`), and the
  warrant is real text in reading order immediately after the heading.
- **Not a live region.** Nine live counters must not be nine live regions. `statusChip.css` already
  reserves exactly one `role="status"` for the page lede; section transitions are announced there or
  not at all. The contract with that region is named in the open questions rather than assumed.
- **`{expanded && children}`** — round 1 rendered `hidden` panels, mounting a full live-subscribing
  row tree (one section holds 488) for every collapsed and every non-interactive section (panel #34).
- **RTL**: logical properties throughout — `padding-inline`, `margin-inline-start`,
  `inset-inline-start`, `text-align: end`. There is no physical `left`/`right` in the file.
- **Semantic elements**: `<span class="n">` / `<span class="u">`, never `<b>/<i>/<em>` as styling
  hooks (panel #43).
- **Focus ring**: the inset `box-shadow` variant, because a full-bleed sticky header's outline would
  bleed over the neighbouring section. `motion.css` §5 already ships this exact declaration for
  `.wd-row`; the correct migration is to add this selector to that rule, not to redeclare it here.

---

## 10. Colour, contrast, scale

**This element defines zero colour tokens, contains zero hex literals, and spends no hue.** The
counter is `--ink-1` for every integer and `--ink-3` for every noun, in every state, at every rung.
The only colour on the header is inside the composed chip, which is where `tokens.md` §7.4 and
`statusChip.css` have already measured it.

That single decision dissolves the panel's entire Tier 2 (defects 13–22): there is no seventh brown,
no `--warn-soft` dead token, no `--faint`, no `--muted-2` on a reason, no `--up` on 14px text, no
invisible neutral rail, no sub-perceptible 2px dash texture, and no 1px pill cap on a 2px bar.

It also removes the one place round 1 was tempted to add hue this round. **The evidence age never
turns amber.** Staleness is already carried by (a) the chip's glyph and demoted rung, (b) the stale
members moving out of `proven` into `unknown` in the counter, and (c) the leading clause of the
evidence line. A fourth channel, in a hue, on the same header as the chip's hue, would break L3 for
zero information.

### Scale audit — the complete list of non-`--sp-*` values and their provenance

Round 1's spec heading claimed *"every value on the declared scale"* and was immediately followed by
`300px 72px 57px 11.5px 10.5px 37px`, none of which were (panel #53). This is the honest list.

```
--gutter-icon    16px   tokens.md §7.1 derived geometry (= --sp-6)
--pc-clock-w     76px   INHERITED verbatim from statusChip.css slot 3 — must never be
                        redeclared here; the whole point is that it is one column
--sec-name      224px   = --sp-6 x 14.  DERIVED: longest published section name at T2
                        (14/550 Inter) + headroom. Needs the real name list — open question 4
--sec-track      96px   = --sp-6 x 6.  DERIVED: 4ch tabular @ T4 (~29px) + --sp-2 (4)
                        + longest class noun "unknown" @ T5 (~52px) = 85px, next step up
--sec-count     480px   = 5 x --sec-track. COMPUTED, never typed as a literal
--sec-num         4ch   tabular figure advance; 3 digits today (488), one of headroom
header height    54px   COMPUTED: 2 x --sp-3 + 20 (T2 lh) + --sp-1 + 20 (chip height)
                        = 6+20+2+20+6. There is NO min-height: the content computes it,
                        so nothing can silently stop binding (panel #55)
1px                     the house hairline: --line-2
```

Type: **T2** 14/20/550 −.006em (name); **T4** 12/16/500 (integers); **T5** 11/16/450 +.01em (nouns,
inherited by the chip's evidence); **T6** 10/14/450 +.015em (heartbeat, filter note). Integers only.
Weights: **450 / 500 / 550** — three, all from `tokens.md`'s four. Round 1 shipped eight weights
including `420/430/470/520/540/560/640`, several of which collapse to the same rendered weight on a
static font fallback, taking the name-vs-numerator distinction — its *primary* hierarchy mechanism —
with them (panel #38, sustained).

Radii: **zero declared.** The header is itself the control and needs none; the chip brings `--r-sm`.
No third radius exists in this feature.

Durations: **zero declared.** The chevron uses `motion.css`'s `.mo-disclose-chevron`; the panel
appears at `--mo-0` by law; hover has no transition by law.

CI grep gate (extends `owner-row.md` §6 and `tokens.md` §8): no fractional `font-size`; no
`font-weight` outside 450/500/550/600; no `gap`/`padding` outside `--sp-*`; no hex literal; **no
`--ok|--warn|--bad|--held|--up|--down|--faint` anywhere in this file**; no physical `left`/`right`;
no `overflow-x: auto` on any ancestor of `.wd-sec-sticky`.

---

## 11. Where the panel is wrong — two rejections, with proof

**Panel #39 — "`letter-spacing: -.006em` at 14px is 0.084px, below the rendering floor, a
'deliberate' value that does nothing."** Rejected, with arithmetic. Letter-spacing is applied to
*every inter-glyph gap and accumulates*; it is not rounded per glyph in any modern engine. Over the
20-character section name "Dependency topology" that is 19 × 0.084 = **1.6px** of cumulative line
width, which changes the rendered measure and the truncation point. More importantly the value is not
mine to relitigate: `tokens.md` §7.2 sets T2 tracking at −0.006em as part of a monotonic ramp that
*"crosses zero between 12px and 14px"*, calibrated for Inter. Deleting it in one element is the L10
drift the scale exists to prevent.

**Panel #52 — "the rail's 'single vertical scan channel' does not exist in the default view."**
Sustained against round 1's rail, which is deleted; but the panel's implied fix (extend the rail down
the panel) is rejected in favour of a better one that the panel's own #29 unblocked. The channel that
survives is not a rail — it is the **clock column**. `statusChip.css` reserves `--pc-clock-w` as
*"the page's one right-aligned numeric column"* on every row, and this header places its clock in the
same track. So there **is** a continuous vertical channel from a section header down through all of
its member rows, it is made of real measurements rather than decoration, and it works with panels
expanded, which is the default view the panel correctly said the rail claim failed in.

---

## 12. Refinement pass 1 — hunting the decorative

1. **The `·` separators between the counter figures are deleted.** With five fixed tracks the
   position already separates the figures; a middot between them was punctuation doing a job the grid
   had already done. One decorative glyph per section × 4 × 9 sections = 36 marks removed. The middot
   survives only inside the chip's evidence prose, where `statusChip.css` already owns it.
2. **The population is `8 lanes`, not `of 8`.** `of` broke the element's one grammar rule —
   **`<integer> <noun>`, every figure, no exceptions**, including the heartbeat (`1s heartbeat`) and
   the age. A grammar with one exception is not a grammar.
3. **The chevron is 12px, not 14px** — `= --gutter-icon - 2 × --sp-1`, which is `statusChip.css`'s
   own derivation of `--pc-glyph`. The two icons on this header are then the same size, which is what
   "same semantic level, same visual weight" means when one icon is disclosure and the other is
   state.
4. **A zero class renders nothing, and its track stays reserved.** Rendering `0 failing` is noise on
   eight of nine sections; omitting the *track* would let the remaining figures slide and destroy the
   column channel. Reserved-and-empty is also information: an occupied track at position 4 is legible
   before its noun is read.
5. **The counter is placed before the chip, not after it.** Every dashboard puts the badge first.
   Here the verdict is *derived from* the counts, so the counts are printed first and the judgement
   second — the epistemically honest order, and the one that puts the numbers 12px from the name they
   qualify.

## 13. Refinement pass 2 — hunting the wrong weight and the remaining lie

1. **Every integer is `--ink-1`, including `failing`.** The temptation was to tint the `failing`
   count. It is wrong twice: `tokens.md` constrains `--bad` to tint-escalating-to-solid, not to a
   4-character text run; and severity on a count would make the count compete with the chip, which is
   the one object licensed to carry severity. `statusChip.css` states the law this obeys —
   *"severity is FILL and only fill"*. The counts are all the same semantic level, so they are all
   the same weight, in every state, forever.
2. **The header height is constant at 54px across all nine sections**, because row 2 always renders —
   `StatusChip` always emits an evidence slot. Round 1's earlier idea of a header that *grew* when it
   had something to say would have been drift at the same semantic level. Constant height, no
   `min-height`, arithmetic in §10.
3. **The evidence line must never truncate before the reason.** Panel #51, and the fix is not mine:
   `statusChip.css` already ships `.pc-actor` — *"the actor lead — first two words, never buried, so
   the ellipsis can never eat the token that decides who acts"* — and CSS-only truncation that keeps
   the full string in the DOM. The header's job is only to give that slot the row's `1fr` track,
   which the `--standalone` grid does. Round 1 would have reimplemented all of this, one size and one
   weight off (panel #26).
4. **The identifier inside a reason is `field.css`'s `.wd-field-id`,** which middle-truncates in CSS
   with `text-overflow` supplying the ellipsis only on actual overflow, keeps the full string
   selectable and copyable, and pairs with a 24px copy target that meets WCAG 2.2 SC 2.5.8. Round 1's
   `midTruncate()` in `format.ts` destroyed the value in JS (panel #27) and shipped truncation with
   no copy affordance, which is exactly the half of Screen 3 that makes truncation acceptable
   (panel #28).
5. **Is this generic?** The honest test is to strip the words. A template header is
   `Name [badge] 3/8 ⌄`. This is `Name · population-in-the-product's-own-noun · a four-class partition
   that sums to it · a declared heartbeat with the measurement directly beneath it · a warrant line
   naming an actor`. None of those five is in any dashboard template, and three of them
   (`unenforced`→`withheld`, the declared heartbeat, the product's unit nouns) exist only because this
   system has shadow execution, per-lane budgets and 488 symbols.
   **What remains generic, named rather than hidden:** the left chevron, the sticky behaviour, and
   the two-row header shape. All three are the house pattern already shipped in `motion.css` §8 and
   `field.css`; inventing a different disclosure affordance to look distinctive would be L10 drift
   with no operator benefit.
6. **Best, or merely finished?** The one thing still soft is `--sec-name: 224px`. It is derived
   arithmetic against a name list I do not have, and if a real section name overruns it, the name
   truncates — which for a *record identifier* is the failure `field.css` calls an incident, not a
   bug. Filed as open question 4 with the CI check that would catch it, not papered over with a
   `title` attribute (which is not keyboard-reachable and would be a false accessibility fix).

---

## 14. Scope boundary

| surface | owns |
|---|---|
| `posture.ts` | the 7-rung ladder and the total mapping from all fourteen state unions |
| `StatusChip` | the posture chip, the evidence line, the actor lead, the defect invariant, **the clock** |
| `motion.css` | every duration, the chevron rotation, hover, the focus ring, the poll rail |
| `tokens.md` | every size, weight, ink tier, hue and the channel each hue may use |
| `field.css` | label/value fields, identifier middle-truncation, the copy target, `.sr-only` |
| `owner-row` | the ownership tree and its own 24px intra-table owner bands |
| **this element** | the **section landmark**, the **coverage counter** and its self-auditing sum, the **heartbeat/age pair**, the **disclosure contract**, and the **default-collapse rule** |

Explicitly **not** this element: any state vocabulary, any colour, any duration, any type size, any
identifier formatting, any per-member rendering. Round 1 owned all six and got four of them wrong.

Boundary note vs `owner-row.md`: that element's group headers are **24px owner bands inside its own
728px table**. This is the **page-level section landmark** above whole surfaces. They stack; neither
replaces the other, and they must never both render for the same grouping.

---

## 15. Open questions — owner decisions, not design decisions

1. **The heartbeat must be published per section, on the wire.** Chainlink's model, and the whole
   greenness gate depends on it. A section without one renders `unknown` throughout — that is
   specified and shippable, but it is a degraded product, and the number is the data owner's.
2. **The unit noun must be published per section** (`lanes`, `symbols`, `controls`, `venues`), CI
   gated. There is deliberately no generic fallback.
3. **Who owns the page-level `role="status"`, and which transitions are worth announcing?**
   `statusChip.css` reserves exactly one live region for the page lede. The contract between it and
   nine section headers — which transitions, at what rate, coalesced how — needs an owner or it will
   either announce nothing or announce constantly.
4. **The real list of section names, to size `--sec-name`.** 224px is derived arithmetic against an
   assumed longest name. If any published name overruns it, the fix is a wider track, not truncation.
5. **Should `failing` split into `impaired` and `failed` at high N?** Four tracks is the budget I
   defend at nine sections. If the page grows to twenty, the summary may need the extra resolution —
   and at that point a two-level grouping is probably the real answer, which is a different element.
6. **Does the auto-expand-on-break rule need a page-level ceiling?** If eleven sections break at once
   the page opens eleven panels. My instinct is that this is correct and alarming, but it is an
   operator call, not a designer's.

---

# APPENDIX A — CSS

```css
/* =========================================================================
   Watchdog — section header with coverage counter.
   File: web/src/features/watchdog/styles/sectionHeader.css

   It carries ONE claim: how much of this section is proven, and on evidence
   how old, against a budget the section itself declares.

   Doctrine encoded here:
   - This file declares ZERO colour tokens, ZERO hex literals, ZERO durations,
     ZERO radii and ZERO font sizes not named in tokens.md. Every one of those
     is owned by a neighbour, and round 1 got four of them wrong by owning them.
   - The counter is a PARTITION, not a fraction, and its visible integers must
     SUM to the printed population. The reader verifies it; they do not trust it.
   - The counter encodes epistemic CLASS. Severity is the chip's, and only the
     chip's ("severity is FILL and only fill", statusChip.css).
   - The clock cell is INHERITED, not invented: --pc-clock-w is statusChip's
     "one right-aligned numeric column", so the header's age lands in the same
     column as every row's clock beneath it.

   DEPENDS ON (hard):
     posture.ts            the Rung ladder — CLASS_OF is total over it
     statusChip.css        .pc--standalone, --pc-clock-w, --pc-glyph, the
                           evidence slot, the defect invariant
     motion.css            .mo-disclose-chevron, --mo-ring, every duration
     tokens.md §7          --sp-*, --ink-*, T2/T4/T5/T6
     field.css             .wd-field-id for identifiers inside a reason
   DECLARES: nothing another element could want. There are no exports here.
   ========================================================================= */

.watchdog .wd-sec {
  /* Content measurement with its arithmetic, never a spacing value in costume.
     Same method as statusChip's `--wd-col: 108px /* "Not configured" */`. */

  /* = --sp-6 x 14. Longest published section name at T2 (14/550 Inter) plus
     headroom. If a real name overruns this the fix is a wider track: the
     section name is the record identifier and it is never truncated. */
  --sec-name:  224px;

  /* = --sp-6 x 6. 4ch tabular @ T4 (~29px) + --sp-2 + "unknown" @ T5 (~52px)
     = 85px -> the next step on the scale. One width for all five figures, so
     the population and the four classes share one rhythm (L10). */
  --sec-track: 96px;

  /* COMPUTED. Never typed as a literal, so adding a class cannot desync it. */
  --sec-count: calc(5 * var(--sec-track));

  /* the tabular figure field: 3 digits today (488 symbols), one of headroom */
  --sec-num:   4ch;
}

/* ---- 1. the sticky block -------------------------------------------------
   BOTH rows are inside it, so the warrant stays pinned with the claim while
   the section's rows scroll underneath. Collapsing must never hide the reason;
   neither may scrolling.

   STRUCTURAL LAW — the reason this is a sibling and not a child:
   CSS Overflow 3 — "The visible/clip values of overflow compute to auto/hidden
   (respectively) if one of overflow-x or overflow-y is neither visible nor
   clip." So `overflow: auto clip` on a rows wrapper computes to `auto hidden`,
   and `hidden` IS a scroll container ("overflow: hidden still allows
   programmatic scrolling"). It would become the sticky containing block and
   this header would silently never stick. There is no CSS fix. The header must
   not be a descendant of the horizontally-scrolling rows region — see
   web/src/pages/Health.css:274 `.healthx-table { overflow-x: auto }` for a
   live instance of the trap. */
.watchdog .wd-sec-sticky {
  position: sticky;
  /* 58 + 16. The house ships +14, +16 and +18 for this one job; --sp-6 is the
     on-scale one and it matches styles.css:5551 exactly. */
  top: calc(var(--header-h) + var(--sp-6));
  /* ORDERING CONTRACT: 2 < .mo-payload (20, motion.css) < the page topbar.
     A row's hover payload must render OVER a sticky section header. */
  z-index: 2;

  display: grid;
  grid-template-columns:
    var(--gutter-icon)          /* 1  chevron — the one icon gutter (L6)      */
    var(--sec-name)             /* 2  name    — fixed, so counters share an x  */
    var(--sec-count)            /* 3  counter — five reserved figure tracks    */
    minmax(0, 1fr)              /* 4  slack   — filter note; pins the clock    */
    var(--pc-clock-w);          /* 5  clock   — INHERITED from statusChip      */
  grid-template-rows: auto auto;
  column-gap: var(--sp-5);
  row-gap: var(--sp-1);
  align-items: center;

  /* height = 2 x --sp-3 + 20 (T2 lh) + --sp-1 + 20 (chip) = 54px, COMPUTED.
     No min-height: a declaration that never binds is a claim nothing defends. */
  padding-block: var(--sp-3);
  padding-inline: 0;            /* the page owns page padding; a full-bleed
                                   header's hairline must reach both edges */
  background: var(--panel);     /* opaque. No backdrop blur behind live digits. */
  border-block-end: 1px solid var(--line-2);   /* permanent: nothing has to
                                                  detect "stuck" */
}

/* ---- 2. the heading and the control ------------------------------------- */

.watchdog .wd-sec-h {
  grid-column: 1 / -1;
  grid-row: 1;
  display: grid;
  grid-template-columns: subgrid;   /* the house idiom — field.css:104 */
  align-items: center;
  margin: 0;
  font: inherit;
}

.watchdog .wd-sec-head {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  padding: 0;
  padding-inline-end: var(--sp-6);
  border: 0;
  border-radius: 0;             /* the header IS the control: no third radius */
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

/* motion.css §4 Tier 0: NO transition, in or out. A background fade across a
   dense page leaves a comet trail on a fast traverse. */
@media (hover: hover) and (pointer: fine) {
  .watchdog .wd-sec-head:hover { background: var(--hover); }
}

/* A full-bleed sticky ring would bleed over the neighbouring section, so the
   inset variant motion.css §5 already ships for clipped rows. MIGRATION: add
   this selector to that rule rather than keeping this duplicate. */
.watchdog .wd-sec-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--mo-ring);
  background: var(--hover);
}

/* Nothing to disclose -> a plain heading. NOT a disabled button (that implies
   "later"), and NOT role="text" (not a real ARIA role; Safari-only). */
.watchdog .wd-sec-h[data-static="true"] { padding-inline-end: var(--sp-6); }

/* ---- 3. chevron ---------------------------------------------------------
   The only icon this element owns. Rotation, duration and curve all belong to
   motion.css §8 (.mo-disclose-chevron); this file sets size and ink only.
   12px = --gutter-icon - 2 x --sp-1, which is statusChip's own --pc-glyph
   derivation: the disclosure mark and the state mark are the same size. */
.watchdog .wd-sec-chev {
  grid-column: 1;
  grid-row: 1;               /* row 1 ONLY: the indicator binds to the heading
                                (NN/g anatomy), not to the block's optical
                                centre between the two tiers */
  justify-self: center;
  align-self: center;
  width: var(--pc-glyph);
  height: var(--pc-glyph);
  color: var(--ink-3);
}

/* ---- 4. the section name — the record identifier ------------------------
   T2, tokens.md §7.2: "section header — Network lanes", 14/20/550, -.006em.
   Tracking is NOT deleted: letter-spacing accumulates across every inter-glyph
   gap (19 gaps x .084px = 1.6px on a 20-char name), and the value belongs to a
   monotonic ramp that crosses zero between 12 and 14px. */
.watchdog .wd-sec-name {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  color: var(--ink-1);
  font-size: var(--fs-2, 14px);
  font-weight: var(--fw-section, 550);
  line-height: var(--lh-2, 20px);
  letter-spacing: var(--ls-2, -.006em);
  /* Deliberately NO text-overflow. The name is the record identifier; a
     truncated name is an incident, not a bug (field.css). If it overflows,
     it overflows VISIBLY and the track gets widened. */
  white-space: nowrap;
}

/* ---- 5. the counter — a partition whose integers sum to the population ---
   Five reserved tracks, always. A zero class emits no markup and its track
   stays empty, because the POSITION of an integer is legible before its noun
   is read, and because an omitted track would slide every figure after it. */
.watchdog .wd-sec-count {
  grid-column: 3;
  grid-row: 1;
  display: grid;
  grid-template-columns: repeat(5, var(--sec-track));
  column-gap: 0;               /* the track IS the separation. A gap here would
                                  double-count it, and a middot would be
                                  punctuation doing a job the grid already did. */
  align-items: baseline;
}

/* one figure = <integer><noun>. Two tiers inside one container, which is
   reference Screen 2's law with the stack laid on its side. */
.watchdog .wd-sec-fig {
  display: grid;
  grid-template-columns: var(--sec-num) auto;
  column-gap: var(--sp-2);
  align-items: baseline;
  min-width: 0;
}

/* T4 — the VALUE register. Same size and same weight for the population and
   for all four classes, in every state, at every rung: they are one semantic
   level (L10), and severity is the chip's job and only the chip's. */
.watchdog .wd-sec-fig .n {
  color: var(--ink-1);
  font-size: var(--fs-4, 12px);
  font-weight: var(--fw-value, 500);
  line-height: var(--lh-4, 16px);
  font-variant-numeric: lining-nums tabular-nums;
  letter-spacing: 0;           /* tokens.md numeric modifier */
  text-align: end;
}

/* T5 — the support register. Primer: a counter always carries adjacent text
   saying what it counts. Every figure here does, including the timestamps. */
.watchdog .wd-sec-fig .u {
  color: var(--ink-3);
  font-size: var(--fs-5, 11px);
  font-weight: var(--fw-support, 450);
  line-height: var(--lh-5, 16px);
  letter-spacing: var(--ls-5, .01em);
  white-space: nowrap;
}

/* Not yet measured. --ink-mute is tokens.md's "non-truth only — placeholder";
   it NEVER carries truth, which is exactly why an unmeasured figure may use it
   and a measured one may not. A zero you did not measure is the same class of
   lie as a green you did not prove, so this renders an em dash, never 0. */
.watchdog .wd-sec-fig[data-measured="false"] .n { color: var(--ink-mute); }

/* ---- 6. the filter note -------------------------------------------------
   Filtering may NOT change any of the five integers: n and d are always the
   registered population. The filter acts on the rows below and says so here. */
.watchdog .wd-sec-filter {
  grid-column: 4;
  grid-row: 1;
  justify-self: end;
  color: var(--ink-3);
  font-size: var(--fs-6, 10px);
  font-weight: var(--fw-support, 450);
  line-height: var(--lh-6, 14px);
  letter-spacing: var(--ls-6, .015em);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---- 7. the heartbeat — the budget, directly above the measurement -------
   Row 1 col 5 sits exactly above .pc-clock on row 2, in the same 76px track,
   both tabular and right-aligned and both in the unit the section declares.
   The comparison is vertical and needs no hue: 410 under 1s, or 41m under 30s.
   Chainlink: a feed publishes a heartbeat, and a consumer that finds the answer
   older than it must "pause operation". */
.watchdog .wd-sec-hb {
  grid-column: 5;
  grid-row: 1;
  width: var(--pc-clock-w);
  color: var(--ink-3);
  font-size: var(--fs-6, 10px);
  font-weight: var(--fw-support, 450);
  line-height: var(--lh-6, 14px);
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
  text-align: end;
  white-space: nowrap;
}

/* ---- 8. the warrant — a composed StatusChip, not a reimplementation ------
   .pc--standalone is statusChip's own three-slot grid: chip | evidence | clock,
   with identical track sizes to the row context so the two cannot drift.
   Spanning cols 2..-1 makes its trailing --pc-clock-w track coincide exactly
   with this grid's own clock track, which is what puts the section's age in the
   same column as every member row's clock. No subgrid and no display:contents
   hack is needed for this row. */
.watchdog .wd-sec-warrant {
  grid-column: 2 / -1;
  grid-row: 2;
  min-width: 0;
}

/* ---- 9. the panel -------------------------------------------------------
   No entrance animation, by two independent laws: motion.css M3 ("Information
   appears at 0ms. Only its WITHDRAWAL is eased") and Emil Kowalski ("Never
   animate keyboard initiated actions ... an animation would make them feel
   slow"). A disclosure toggle is a keyboard-initiated action pressed hundreds
   of times a day. There is deliberately no .mo-disclose height transition here:
   the panel is unmounted when collapsed, so there is no height to animate.

   The panel is NOT a scroll container in the block axis. If its rows need a
   horizontal rail, that rail lives on an inner element, and every row-level
   overlay renders in a PORTAL — otherwise it is clipped, whichever overflow
   value is chosen. */
.watchdog .wd-sec-panel { min-width: 0; }

/* ---- 10. narrow ---------------------------------------------------------
   Below the roster breakpoint the five figure tracks cannot hold their x, so
   the counter wraps to its own row rather than shrinking its tracks: a figure
   whose noun ellipsises is a counter that stopped saying what it counts. */
@container (max-width: 1040px) {
  .watchdog .wd-sec-sticky {
    grid-template-columns: var(--gutter-icon) minmax(0, 1fr) var(--pc-clock-w);
    grid-template-rows: auto auto auto;
  }
  .watchdog .wd-sec-h,
  .watchdog .wd-sec-head { grid-column: 1 / -1; }
  .watchdog .wd-sec-name { grid-column: 2; grid-row: 1; }
  .watchdog .wd-sec-hb   { grid-column: 3; grid-row: 1; }
  .watchdog .wd-sec-count {
    grid-column: 2 / -1;
    grid-row: 2;
    grid-template-columns: repeat(auto-fit, var(--sec-track));
  }
  .watchdog .wd-sec-filter { grid-column: 2 / -1; grid-row: 2; justify-self: start; }
  .watchdog .wd-sec-warrant { grid-row: 3; }
}

/* ---- 11. reduced motion, forced colors, e-ink ---------------------------
   Nothing to declare. This file owns no animation, no transition and no
   colour, so motion.css §10-11 and statusChip.css's forced-colors block cover
   it entirely. The only element-specific concern is the permanent hairline,
   which the OS keeps because it is a border and not a background. */
```

---

# APPENDIX B — component

```tsx
// web/src/features/watchdog/SectionHeader.tsx
//
// STRUCTURAL: renders as a SIBLING above the rows region, never inside it.
// See sectionHeader.css §1 for the CSS Overflow 3 proof that there is no CSS
// fix for a sticky header trapped inside a horizontally scrolling wrapper.

import { useId } from 'react';
import { StatusChip } from './StatusChip';
import type { Rung, Posture } from './posture';
import './styles/sectionHeader.css';

/* ---- the coverage class: a TOTAL function over the real ladder ---------- */

export type CoverageClass = 'proven' | 'withheld' | 'failing' | 'unknown';

/* `satisfies Record<Rung, ...>` with no default branch: add a rung to
   posture.ts and the build fails HERE, at the one place that must decide how it
   counts. Round 1 shipped a lowercase RANK table keyed against a
   SCREAMING_SNAKE enum, so every lookup was `undefined`, every comparison was
   false, and the reduce returned its seed -- rendering EVERY section green. */
export const CLASS_OF = {
  proven:     'proven',
  unenforced: 'withheld',   // executing, deliberately not in force. Never green.
  held:       'withheld',   // a person or policy withholds. Deliberate, not broken.
  waiting:    'withheld',   // halted with a KNOWN resume time; the clock answers.
  impaired:   'failing',
  failed:     'failing',
  absent:     'unknown',
} as const satisfies Record<Rung, CoverageClass>;

const CLASS_ORDER = ['proven', 'withheld', 'failing', 'unknown'] as const;

export interface SectionMember {
  readonly posture: Posture;
  readonly evidenceAgeMs: number | null;   // null = never measured
}

export interface Coverage {
  readonly population: number;
  readonly counts: Readonly<Record<CoverageClass, number>>;
  /** MAX over members. A section is only as fresh as its stalest member. */
  readonly oldestEvidenceMs: number | null;
}

/* Staleness DEMOTES toward absent and never toward a failure.
   StatusChip.tsx: "only the affirmative tone is a claim that decays into a
   lie." A 3/3 on 40-minute-old evidence is not degraded -- nothing is known to
   be wrong. A stale `failed` stays failed: a proven failure does not soften. */
export function tally(members: readonly SectionMember[] | null,
                      heartbeatMs: number | null): Coverage | null {
  if (members === null) return null;                       // not measured: never a 0
  const counts = { proven: 0, withheld: 0, failing: 0, unknown: 0 };
  let oldest: number | null = 0;

  for (const m of members) {
    const age = m.evidenceAgeMs;
    if (age === null || oldest === null) oldest = null;
    else oldest = Math.max(oldest, age);

    // No declared heartbeat => greenness cannot be gated => nothing is proven.
    const stale = heartbeatMs === null || age === null || age > heartbeatMs;
    const rung: Rung = (stale && m.posture.rung === 'proven') ? 'absent' : m.posture.rung;
    counts[CLASS_OF[rung]] += 1;
  }
  return { population: members.length, counts, oldestEvidenceMs: oldest };
}

/* ---- props -------------------------------------------------------------- */

export interface SectionHeaderProps {
  /** The section's own name. The record identifier: never truncated. */
  name: string;
  /** REQUIRED, CI-gated, no generic fallback: "lanes", "symbols", "controls". */
  unit: string;
  coverage: Coverage | null;
  /** Declared per section, published on the wire (Chainlink's model). */
  heartbeat: { ms: number; label: string } | null;
  /** Formats an age in the unit the section declares: 410ms / 1s / 4m. */
  formatAge: (ms: number) => string;
  /** The composed warrant. The chip owns posture, evidence, actor and clock. */
  posture: Posture;
  evidence: React.ReactNode;
  stale?: boolean;
  /** Never shrinks any integer above; it acts on the rows below and says so. */
  filterNote?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function SectionHeader(p: SectionHeaderProps) {
  const uid     = useId();
  const headId  = `wd-sec-h-${uid}`;
  const countId = `wd-sec-c-${uid}`;
  const panelId = `wd-sec-p-${uid}`;

  const measured = p.coverage !== null;
  // Nothing to disclose -> a plain heading. Not a disabled button.
  const canExpand = measured && p.coverage!.population > 0;

  const figures = (
    <span className="wd-sec-count" id={countId}>
      {/* The population leads: it is the audit anchor, and it is the one number
          that does not change on every poll, so the eye gets a stable first x. */}
      <Figure n={p.coverage?.population} u={p.unit} />
      {CLASS_ORDER.map(c => (
        // A zero class emits NOTHING; its track stays reserved, so position
        // stays legible and no later figure slides.
        <Figure key={c} n={p.coverage?.counts[c] || undefined} u={c} />
      ))}
    </span>
  );

  const head = (
    <>
      {canExpand && (
        <svg className="wd-sec-chev mo-disclose-chevron" viewBox="0 0 12 12"
             fill="none" stroke="currentColor" strokeWidth="1.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 2.5 8 6 4.5 9.5" />
        </svg>
      )}
      <span className="wd-sec-name">{p.name}</span>
      {figures}
      {p.filterNote && <span className="wd-sec-filter">{p.filterNote}</span>}
      {p.heartbeat && (
        <span className="wd-sec-hb">
          {p.heartbeat.label} heartbeat
        </span>
      )}
    </>
  );

  return (
    <section className="wd-sec">
      <div className="wd-sec-sticky">
        {/* APG: the button is wrapped in an element with role heading. The id
            lives on the HEADING so both branches can be referenced and neither
            can dangle. The accessible name is the section name and nothing
            else -- short enough for voice control ("click Network lanes") --
            and the counter is exposed by description, as real text. */}
        <h2 className="wd-sec-h" id={headId} data-static={!canExpand || undefined}>
          {canExpand ? (
            <button type="button" className="wd-sec-head"
                    aria-expanded={p.expanded}
                    aria-controls={panelId}
                    aria-describedby={countId}
                    onClick={p.onToggle}>
              {head}
            </button>
          ) : head}
        </h2>

        {/* The warrant. The chip owns the posture, the actor lead, the reason
            invariant (a REASON_REQUIRED rung with no reason renders the defect
            treatment in the evidence slot, in dev AND prod) and the clock. */}
        <StatusChip
          className="wd-sec-warrant"
          standalone
          posture={p.posture}
          stale={p.stale}
          evidence={p.evidence}
          ageLabel={p.coverage?.oldestEvidenceMs != null
            ? p.formatAge(p.coverage.oldestEvidenceMs)
            : undefined}
        />
      </div>

      {/* No role="region" (APG: landmark proliferation past ~6 panels; this page
          has ~9) and no role at all (role="group" would break the grid table's
          semantics). Unmounted when collapsed: a hidden panel of live-subscribing
          rows -- one section holds 488 -- pays a full subscription for nothing. */}
      {p.expanded && canExpand && (
        <div id={panelId} className="wd-sec-panel" aria-labelledby={headId}>
          {p.children}
        </div>
      )}
    </section>
  );
}

/* <integer> <noun>. ONE grammar for every figure on this header, including the
   heartbeat and the age -- Primer: a counter always carries adjacent text
   saying what it counts, and round 1 exempted the timestamp from its own rule. */
function Figure({ n, u }: { n?: number; u: string }) {
  if (n === undefined) return <span className="wd-sec-fig" aria-hidden="true" />;
  return (
    <span className="wd-sec-fig" data-measured={n !== null}>
      <span className="n">{n === null ? '—' : n}</span>
      <span className="u">{u}</span>
    </span>
  );
}

/* ---- default collapse: DERIVED, never authored --------------------------
   A section is collapsed on first paint iff its counter closes entirely into
   `proven`. That is exactly when the header already tells the whole truth.

   export const collapsedByDefault = (c: Coverage | null) =>
     c !== null && c.population > 0 && c.counts.proven === c.population;

   The change signal is this rule going false: the section AUTO-EXPANDS. The
   page physically opens the thing that broke -- a stronger signal than any
   wash, costing no duration and no token, and it survives reduced motion.
   Two guards: deferred while a pointer or focus is inside the table region
   (motion.css's data-order-frozen precedent), and one-way -- an auto-expand is
   never auto-re-collapsed, and a manual expand is never undone.
------------------------------------------------------------------------- */

/* ---- call sites --------------------------------------------------------- */

<SectionHeader
  name="Network lanes" unit="lanes"
  coverage={{ population: 8,
              counts: { proven: 5, withheld: 1, failing: 1, unknown: 1 },
              oldestEvidenceMs: 410 }}
  heartbeat={{ ms: 1000, label: '1s' }} formatAge={ms => `${ms}ms`}
  posture={{ rung: 'impaired', actor: 'ours' }}
  evidence={<>3 lanes past heartbeat · collector <span className="wd-field-id"><b>collector-7f3ab4c19d2e5</b><i>b219</i></span> offline since 09:41</>}
  expanded onToggle={t}><LaneRows /></SectionHeader>
// -> 8 lanes  5 proven  1 withheld  1 failing  1 unknown        1s heartbeat
//    (o) Impaired  3 lanes past heartbeat · collector collector-7f3…b219 …   410ms

<SectionHeader
  name="Symbol universe" unit="symbols"
  coverage={{ population: 488,
              counts: { proven: 0, withheld: 0, failing: 0, unknown: 488 },
              oldestEvidenceMs: null }}
  heartbeat={null} formatAge={fmt}
  posture={{ rung: 'absent', actor: 'nobody', cause: 'not-wired' }}
  evidence={<>No coverage is configured for this section — 488 symbols are registered and none are monitored.</>}
  expanded onToggle={t}><SymbolRows /></SectionHeader>
// -> 488 symbols                                    488 unknown
//    ( ) Not configured  No coverage is configured ...                          —

<SectionHeader
  name="Control registry" unit="controls"
  coverage={{ population: 12,
              counts: { proven: 0, withheld: 12, failing: 0, unknown: 0 },
              oldestEvidenceMs: 6000 }}
  heartbeat={{ ms: 30000, label: '30s' }} formatAge={ms => `${Math.round(ms/1000)}s`}
  posture={{ rung: 'held', actor: 'ours' }}
  evidence={<><span className="pc-actor">We hold</span> — control-plane token expired 08:12; no mutation can be attempted until it is re-issued.</>}
  expanded onToggle={t}><RegistryRows /></SectionHeader>
// -> 12 controls                12 withheld                     30s heartbeat
//    (||) Disabled  We hold — control-plane token expired 08:12 ...              6s
```
