# Watchdog — spacing, type and colour scale

Owner: measurement-system specialist. Every other Watchdog element quantises to this file.
Nothing here is decreed; every number is either measured out of the existing app or solved
against a published contrast model. Where I chose, I say what I chose against.

---

## 1. What the house actually ships (measured, not remembered)

Token root lives in `web/src/styles.css` lines 7–117. There is **no `index.css`**; `styles.css`
is the root. It defines 44 custom properties in `:root, [data-theme="light"]` and overrides 35 in
`[data-theme="dark"]`.

Quoted verbatim:

```css
:root, [data-theme="light"] {
  --bg:#ffffff; --panel:#ffffff; --tile:#f5f6f8; --tile-hover:#eff1f4; --hover:#f7f8fa;
  --line:#eef0f3; --line-2:#e4e7ec; --line-strong:#d3d7df;
  --text:#0b0e14; --text-2:#2c313a; --muted:#697180; --muted-2:#858e9b; --faint:#9aa3b2;
  --accent:#2f6bff; --accent-ink:#1d4ed8; --accent-soft:rgba(47,107,255,.13);
  --up:#0a9b64; --down:#e0414b;
  --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;
  --font:"InterVariable","Inter",…; --mono:"SF Mono","JetBrains Mono",…;
}
[data-theme="dark"] {
  --bg:#0b0e11; --panel:#15181d; --tile:#1b1f26;
  --line:#181c22; --line-2:#262d38; --line-strong:#2b3139;
  --text:#e8edf4; --text-2:#aeb7c4; --muted:#717b8a; --muted-2:#626c79; --faint:#4d5664;
  --accent:#2f6bff; --accent-ink:#2f6bff;   /* note: NO lift vs light's #1d4ed8 */
  --up:#2ebd85; --down:#f6465d;
}
body { font-size:13.5px; line-height:1.5; }
```

### The four findings that set the brief

**(1) There is no spacing scale and no type scale. At all.**
Zero spacing tokens exist — `--r-*` (radius), `--maxw`, `--header-h` are the only geometry.
Histogram across `styles.css` + all page CSS + all feature CSS:

| axis | distinct values in use | worst offenders |
|---|---|---|
| `font-size` | **30+** | 12px (414), 10.5px (408), 11px (319), 11.5px (300), 12.5px (269), 13px (250), 9.75px, 12.75px |
| `font-weight` | **20+** | 500, 430, 650, 600, 620, 560, 520, 420, 470, 450, 640, 680, 440, 550, 540, 510 |
| `gap` | every integer 1–28 | 8(279) 10(225) 12(195) 7(191) 6(169) 2(148) 9(125) |
| `padding` | every integer 2–24 | 8(117) 10(115) 12(82) 9(77) 6(77) 7(76) |
| `line-height` | 12–30px + 9 unitless ratios | 16, 15, 14, 13, 1, 18, 17, 1.45, 1.35, 1.15 |
| `letter-spacing` | 15+ | .04 .055 .06 .08 .045 .05 .035 −.01 .03 .02 −.014 −.012 |

Fractional sizes (13.5, 11.5, 10.5, 9.75, 12.75px) are the single most corrosive item: they
guarantee sub-pixel glyph positioning that differs per size, so no two text columns share a
baseline. `body{font-size:13.5px}` is fiction — every page immediately overrides to 11/12.
**The real body size of this app is 12px.** The scale should say so.

**(2) `--warn` is referenced but never defined.**

```
web/src/styles.css:15225:  .akx-status.s-declared { color: var(--warn, #b45309); }
```

That is the *only* occurrence of `--warn` in the codebase, and it is a read with a fallback.
Because the token does not exist, every page that needed a "degraded" tone invented its own.
I count **17 distinct amber/orange hex literals** hardcoded across page CSS:

`#d98a25 #bd781b #d6a11d #f0b45d #eaa64a #c57921 #a87517 #9b610e #d5962e #d39425 #b45309
#a3660f #7a4b08 #e0a13a #a57b19 #8a5a00 #2ca36b`

Measured with APCA on `#ffffff`, they span **Lc 34.5 → Lc 85.4**. Seventeen values, all meaning
"degraded", spread across a 51-point contrast range. This is L10 ("same semantic level = same
visual weight, everywhere") violated by a factor of 2.5×. `Health.css:88` even hardcodes two
different ambers for the *same* state — `color:#bd781b` for the text and `background:#d6a11d`
for the dot.

**(3) The neutral ramp is not a theme pair. It is two different information hierarchies.**
I implemented APCA-W3 0.1.9 and measured the shipped ramp:

| token | light on `--panel` | dark on `--panel` |
|---|---:|---:|
| `--text`    | **Lc 105.6** | **Lc −94.7** |
| `--text-2`  | Lc  99.3 | Lc −61.9 |
| `--muted`   | Lc  74.1 | Lc **−30.9** |
| `--muted-2` | Lc  60.5 | Lc **−24.1** |
| `--faint`   | Lc  49.9 | Lc **−15.2** |

Read the `--muted` row. The same token is **Lc 74 in light and Lc −31 in dark.**
Per the APCA readability criteria, Lc 30 is *"the absolute minimum for any text… placeholder
text and disabled element text"* and Lc 15 is where *"designers should treat anything below this
level as invisible."*

`--muted` is what carries evidence timestamps and reason strings. `--faint` is used for
subordinate context. **In dark mode this app renders the reason a check is unavailable at
disabled-text contrast, and its subordinate context at the threshold of invisibility.**
That is not a styling nit — on an evidence-gated surface it is a truth-doctrine breach expressed
as a number. It is the single strongest argument in this document.

Note also the tier *spacing* inverts: in light, `--text`→`--text-2` differ by 6 Lc (not
distinguishable — effectively one tier), while in dark they differ by 33 Lc. Light has ~4 usable
tiers bunched at the top; dark has 2 usable tiers and 3 unreadable ones.

**(4) `--accent-ink` gets a lift in light and none in dark.**
Light lifts `#2f6bff → #1d4ed8`. Dark sets `--accent-ink: #2f6bff` — identical to `--accent`.
Measured, dark `--accent` as ink on `--panel` is **Lc −30.1**. The already-shipped
`features/watchdog/styles/statusChip.css` binds `--wd-held-ink: var(--accent)` in dark, so the
OWNER_GATED chip's label is currently rendered at disabled-text contrast. My ramp has to fix the
token that chip reads, not the chip.

Existing house conventions I am **keeping** (they are good and other agents already build on them):
`--r-sm/--r-md/--r-lg/--r-pill` radius language; `--font`/`--mono`; the `[data-theme="dark"]`
attribute switch; `statusChip.css`'s doctrine that radius `--r-sm` = data containers and
`--r-pill` = actions; `font-variant-numeric: tabular-nums` (already used in 15 of 17 CSS files).

---

## 1b. ROUND 2 — what the panel broke, and the one finding that changed the design

The panel found 35 defects. Most were real. Three classes:

**(a) The artifact did not run.** `display:grid` on `<tr>` with 3 tracks and 5 cells; `.wd-row-value`
never emitted so `data-stale` was dead; `.wd-ctl`/`.wd-panel`/`.wd-table` referenced and undefined.
All accepted, all fixed by going to a native table with `<colgroup>` + `table-layout:fixed`.

**(b) The scale had grown components it should not own.** It shipped a focus ring, a MISSING-REASON
badge, and a truncation technique — all three of which the neighbour elements had *already shipped
better*. `motion.css` §5 owns the ring (and correctly uses an inset box-shadow because `.healthx-frame`
clips outlines). `statusChip.css` owns the defect treatment (and correctly keeps the posture visible
instead of replacing a proven failure with a grey box). `field.css` and `dependencyGraph.css` both
independently ship the `<b>`/`<i>` middle-truncation pair, with the refinement that there is **no
literal ellipsis in the markup** — `text-overflow` supplies it exactly when overflow occurs, so a
fully visible address never reads as truncated. **The fix for all three is deletion.** A measurement
system owns measurements and the one atom everything quantises to. Nothing else.

**(c) One finding the panel did not make, which changed the design.**
Re-reading APCA's actual use-case ladder rather than my memory of it:

> Lc 75 — minimum for body text at "24px/300 weight, 18px/400, 16px/500 and 14px/700"
> Lc 60 — content text at "48px/200, 36px/300, 24px normal weight (400), 21px/500, 18px/600, 16px/700"
> — <https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html>

Every size in that table is **larger than every size on this page.** Round 1 set a "truth floor" of
Lc 60 and rendered 11px reasons at it. By APCA's own table Lc 60 buys you 21px/500. An 11px/450
string at Lc 60 is not near a floor; it is in the "spot readable" category whose floor is Lc 30.

The consequence is structural, not cosmetic: **at 10–12px, ink contrast cannot carry hierarchy,
because the legal band is too narrow.** Measured — at 12px the usable range is Lc 78→97, nineteen
points, ~6.4 Lc per step across four tiers. This scale's tiers step 9.2 and 10.0 Lc. Round 1 bought
its value/reason hierarchy with a 34-point ink gap it could not afford.

So round 2 splits subordinate text by **consequence**, which is a truth-doctrine distinction, not a
typographic one:

| register | what it is | why it may sit where it sits |
|---|---|---|
| **T5 reason** 12px/450/`--ink-2` Lc 88 | *why* a state is not healthy | unique free text, read once, an operator acts on it. Fluent. Same size as the value it qualifies; recedes by weight and one ink step only. |
| **T6 support** 11px/450/`--ink-3` Lc 78 | ages, units, warrants, citations | predictable format, learned, recoverable from context, re-readable at leisure. APCA's own "spot readable" category — and Lc 78 is 48 points above that category's floor. |

Round 1 put both at `--ink-3` Lc 61. It treated a one-off failure explanation and a unit suffix as
the same tier. That is the defect, and it is exactly the kind the truth doctrine exists to catch.

**And the load-bearing measurement of the whole round.** Hue-as-ink on its own tint, every case tested:

```
             hue as ink on its own tint      --ink-1 on the same tint
  warn light          Lc 69.5                       Lc 95.8
  warn dark           Lc 59.5                       Lc 94.7
  bad  light          Lc 67.0                       Lc 94.7
  held light          Lc 67.8                       Lc 96.0
  ok   light          Lc 54.7                       Lc 97.6
```

A chip label is therefore **always `--ink-1`**, and hue is **always fill**. That is not a preference;
it is a 25–43 Lc improvement available for free. It is also law L1 — *"hierarchy comes from fill
alone"* — proven numerically rather than asserted, and it settles the panel's #6/#7 by removing the
channel that collided instead of re-solving it.

---

## 2. References

Every claim below was fetched this round, not recalled. Where a source contradicted round 1, round 1 lost.

| # | source | what was taken |
|---|---|---|
| 1 | [APCA — Easy Intro](https://git.apcacontrast.com/documentation/APCAeasyIntro.html) and [APCA in a Nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html) | The real Lc ladder, quoted above — the finding that reset the design. Also **"Lc 45 … the minimum for pictograms with fine details"**, which is the floor every semantic glyph is now gated on; and **"Lc 30 … placeholder text and disabled element text"**, which is what confines `--ink-mute`. |
| 2 | [Myndex/apca-w3 `src/apca-w3.js`](https://raw.githubusercontent.com/Myndex/apca-w3/master/src/apca-w3.js) | The SA98G constants and operation order, ported exactly into `ops/tests/design/apca.py` — `mainTRC 2.4`, `normBG .56 / normTXT .57`, `revTXT .62 / revBG .65`, `blkThrs .022 / blkClmp 1.414`, `scaleBoW/WoB 1.14`, `loClip .1`, offsets `.027`. Verified against the canonical triplet: `#000/#fff → 106.0`, `#fff/#000 → −107.9`, `#888/#fff → 63.1`. Note APCA linearises with a **simple 2.4 power curve, not the piecewise sRGB transfer function** — getting that wrong shifts every number. |
| 3 | [MDN — `<system-color>`](https://developer.mozilla.org/en-US/docs/Web/CSS/system-color) | `GrayText` is defined as **"Text color for disabled items (for example, a disabled control)"**. Round 1 put labels, reasons and proof ages on `GrayText` in forced-colors — rendering every mandatory reason as *disabled* in Windows HCM, in the one media query meant to protect them. Panel #19 confirmed by primary source; reasons now take `CanvasText`. |
| 4 | [MDN — `prefers-contrast`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast) | `more` **"indicates that user has notified the system that they prefer an interface that has a higher level of contrast"** and guarantees nothing numerically — the implementation is the author's. Also that `custom` is what `forced-colors: active` users match, so `more` and `forced-colors` are separate branches and must both be written. Round 1's `more` block *collapsed* `--ink-3` onto `--ink-2`'s exact value; the ramp is now re-solved, four tiers stay four. |
| 5 | [Evil Martians — OKLCH in CSS](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) | Used to run variant D **honestly** after the panel showed round 1's critique of it was wrong. `L` is *"perceived lightness"* and OKLCH is *"better for color modifications and palette generation"* — both true, and both compatible with solving to APCA targets. So I implemented Oklab mixing and measured it head-to-head against sRGB mixing (table in §4). It ties within 0.4–1.1 Lc. The panel was right that round 1 rejected D for the wrong reason; D still loses, for a new and much smaller one. |
| 6 | [IBM Carbon `@carbon/layout` `_spacing.scss`](https://unpkg.com/@carbon/layout@11.31.0/scss/generated/_spacing.scss) | The spacing ramp shape verbatim — `$spacing-01: 0.125rem` (2px) then 4, 8, 12, 16, 24, 32, 48: fine 2/4px steps at the bottom, doubling at the top. Kept the non-linearity and the 2px floor; dropped the 40px step as unused at this density. Also Carbon's tracking law (`letter-spacing .32px @12px`, `.16px @14px`, `0 @16px+`) — positive tracking *below* 14px, the opposite of the tighten-everything reflex. |
| 7 | [Grafana `@grafana/data` `createTypography.mjs`](https://unpkg.com/@grafana/data@11.6.0/dist/esm/themes/createTypography.mjs) | A runtime invariant, not advice: their source *throws* — `if (lineHeight % 2 !== 0 \|\| size % 2 !== 0) throw new Error("Font size and line height should be integer multiples of 2 to prevent issues with alignment")`. A shipping observability product refuses to build an odd line-height. That is the justification for killing the house's 13.5/11.5/10.5/9.75/12.75px sizes and for every line-height here being an even integer in px. |
| 8 | [Radix Colors — Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) | That a ramp step is defined by its **job**, not its lightness (*"Steps 11 and 12 are designed for text"*), and — diffing raw `slate.css` against `slate-dark.css` — that Radix does **not** mirror lightness between themes; the two are chosen to hit the same *contrast target*. That is precisely the fix for the shipped ramp, where `--muted` is Lc 65.6 light and Lc 29.2 dark. |
| 9 | [Rauno Freiberg — Web Interface Guidelines](https://interfaces.rauno.me/) | *"Font weight should not change on hover or selected state to prevent layout shift"* (weights are fixed per role; state never moves between them); *"Font weights below 400 should not be used"* (floor is 450, deliberately above 400, because APCA's spatial rule penalises thin+small); *"Where available, tabular figures should be applied with `font-variant-numeric: tabular-nums`"*. |
| 10 | [Okabe & Ito — Color Universal Design](https://jfly.uni-koeln.de/color/) | *"For red, vermilion is used since it is recognizable also to protanopes"* — `--bad-solid` is hue 8–14°, never a pure crimson and never allowed to drift to orange, where it would collide with `--warn` under protanopia. *"Colors between yellow and green are all avoided"* — there is no yellow-green caution tone; the set jumps amber to green with nothing between. *"For thin lines and small objects, use darker blue and orange"* — light `--warn` is `#8a5a00`, not a bright amber. |
| 11 | [Vercel Geist — Text](https://vercel.com/geist/text) | The structural model: a small closed set of *named roles* that pre-set size, line-height, tracking and weight together, so a consumer picks a role and never four independent values. Six roles here, one class each, none of the four properties individually exposed. (Geist withholds its numbers to Figma; I took the structure, not the values, and say so.) |
| 12 | The shipped roster itself — `statusChip.css`, `motion.css`, `field.css`, `dependencyGraph.css` | The strongest reference available, because it is what actually renders. A `grep` of every `var(--…)` in `features/watchdog/styles/` produced the real consumption contract: `--fw-value`/`--fw-support` (**not** round 1's `--w-*`), `--ls-5` (**not** `--tr-5`), `--on-solid` (read, never defined), `--sp-1…9`, `--ink-1…3`, `--row-h`, `--gutter-icon`. Round 1 invented names the roster does not use. Round 2 takes the roster's names. |

---

## 3. Four variants — what design variable each one moves

The panel called round 1's A and D straw men and it was right: A was a design-system undergraduate
error, and D bundled four independent variables and then lost on the weakest. Both are re-run here as
variants that could plausibly win, and both are decided by **measurement**, not assertion.

| | A — Monotone | B — Instrument | C — Baseline | D — OKLCH-solved |
|---|---|---|---|---|
| hierarchy from | **ink tier alone** | **weight + case + fill** | **spatial position** | weight + case + fill |
| type sizes | **one** (12px) | five (20/14/12/11/10) | five | five |
| colour space | sRGB → APCA | sRGB → APCA | sRGB → APCA | **Oklab → APCA, tints via `color-mix`** |
| alignment | row | row + `colgroup` | **global 4px baseline grid** | row + `colgroup` |
| chrome | minimal | hairlines only | **rules everywhere** | hairlines only |
| density | highest | high | lowest | high |

---

## 4. The fight, decided by measurement

**A — Monotone loses on a number.** All text at 12px, hierarchy purely from ink tier. At 12px the
legal band is Lc 78 (spot-readable comfort at this size) to Lc 97 (maximum on the worst surface) —
**19.2 Lc for four tiers, 6.4 Lc per step.** The winner's tiers step 9.2 and 10.0. Measured candidate:

```
  A 4-tier: Lc [97.2, 90.3, 82.0, 78.0]   steps [6.8, 8.3, 4.1]
  B 4-tier: Lc [97.2, 88.0, 78.0, 42.0]   steps [9.2, 10.0, 36.0]
```

And the kill: A's bottom tier is pinned at the truth floor, so **A has no non-truth tier at all.** It
cannot express disabled or placeholder without either lying (rendering them as truth-weight) or
dropping below the floor it just set. A single-size scale cannot afford a `--ink-mute`.

**C — Baseline loses on cost/benefit.** A global baseline grid earns its rigidity in long-form
editorial. This is a table: alignment comes from the row, which already enforces it, and now from
`<colgroup>` + `table-layout: fixed`, which enforces the columns. C pays for something already free,
and charges for it — on a 4px baseline a 10px micro-label takes line-height 12 (too tight for
descenders on "Not configured") or 16 (identical to the value's box). C also maximises chrome to make
its own grid legible, directly against the house header comment *"surfaces, not boxes: structure =
whitespace + hairlines"*.

**D — OKLCH-solved loses by 0.4 Lc, and that is the honest verdict.** The panel was right that round 1
rejected D wrongly: OKLCH is a colour *space*, and APCA targets can be solved in it exactly as in
sRGB. What round 1 actually rejected was **even-lightness stepping**, which is a *method*. So D was
re-run properly: Oklab mixing implemented, tints generated by `color-mix(in oklab, …)`, label
contrast measured head-to-head.

```
  hue   theme   sRGB tint   label Lc      Oklab tint   label Lc
  warn  light   #f3eee6        95.8       #f3eee7         95.9
  warn  dark    #353125        94.7       #302e28         95.4
  bad   light   #f9e9e9        94.7       #fcebe8         95.8
  bad   dark    #3a2e31        94.7       #352b2f         95.5
  held  light   #eaeffb        96.0       #e9f0fd         96.4
  held  dark    #2b3241        94.5       #282e3b         95.4
```

D is **better, by 0.4 to 1.1 Lc.** It loses anyway, for one reason that only exists because this round
shipped a gate: a `color-mix()` tint is computed by the browser at paint time and **cannot be asserted
at build time.** `contrast.json` asserts on literal hexes; 30 assertions currently run in CI. Trading
an auditable invariant for ≤1.1 Lc is a bad trade on a product whose entire doctrine is that claims
must be provable. If `color-mix` ever becomes statically evaluable in the build, D wins and the
migration is mechanical — the targets are identical.

**B — Instrument wins**: five sizes, four weights, four ink tiers pinned to identical |Lc| in both
themes on the *worst* surface, and hue confined to fill.

---

## 5. Refinement pass 1 — the scale stops owning components

Adversarial question: *what is in this file that another element already does better?*

| deleted | now owned by | why theirs is better |
|---|---|---|
| `--focus-ring`, `:focus-visible` rule | `motion.css` §5 | It uses `box-shadow: inset` because rows sit inside `.healthx-frame { overflow: hidden }`, which **clips an outline on the first and last row**. Mine used `outline` and would have been invisible exactly where it matters. It also solves the panel's "two blues" (#16) for free — there is now one ring token, `--mo-ring`, and my second blue is gone. |
| MISSING-REASON badge | `statusChip.css` | Mine fired on `:not(:has(.wd-reason))` — a *class-name typo* would ship a red badge to an operator mid-incident. The chip's version keys off the data and, crucially, **keeps the posture, glyph and word intact** and puts the defect marker in the evidence slot, so a proven failure is never demoted to a grey box. |
| middle-truncation implementation | `field.css` + `dependencyGraph.css` | Both already ship the `<b>`/`<i>` pair, and both do the thing I had not thought of: **no literal ellipsis in the markup**, so `text-overflow` supplies it only on actual overflow and a fully visible address never *looks* truncated. The scale now only defines `.wd-id`'s type and states the contract. |
| `.wd-ctl` | `field.css` / `toggle.md` | Controls are not the measurement system's business. Panel #4 said "define it or delete it". Delete. |

Net: the scale introduces **one** new hue (`--warn` — the token `styles.css:15225` already *reads*
and never defines). `--ok` aliases house `--up`; `--held` aliases house `--accent` in light. Panel
#24's "two greens" is resolved by there being one green. Measured: `--up` as a fine-detail glyph is
Lc 54.2 light / 52.3 dark, both clear APCA's Lc 45 pictogram floor.

`--held` **cannot** alias `--accent` in dark: `#2f6bff` measures **Lc 28.3** on dark surfaces — below
the floor for text *and* for fine pictograms. That is a live shipped bug, and it is why the dark value
diverges to `#9fbcfb` (Lc 63.5). A token that diverges in exactly one theme for a stated, measured
physical reason is the opposite of arbitrary.

---

## 6. Refinement pass 2 — the mechanisms L5 and L8 actually depend on

Adversarial question: *which claims are asserted but not mechanically true?*

**`letter-spacing: 0` on numerics — round 1's justification was wrong.** It claimed tracking makes
decimal points "drift between rows". False: right-aligned tabular figures receive the same per-glyph
advance in every row, so uniform tracking cannot misalign them. The *real* reason is mechanical and
was hiding in the column reservation: **CSS `ch` is the advance of "0" and does not include
`letter-spacing`.** A column reserved at `9ch` holds nine figures at zero tracking and *fewer* at
positive tracking — so tracking on a `ch`-reserved column silently under-reserves and clips. Hence
the precise rule: **tracking is positive below 12px, zero at 12px and above, and zero inside any
`ch`-reserved column regardless of size.** (The `.` fits inside the slack: Inter's period advance is
~0.26em against a figure's ~0.6em.)

**`.wd-num` was silently stripping tracking from the 10px uppercase column heads** (panel #13) — both
rules are specificity 0-1-0 and `.wd-num` came later. Split: `.wd-col-num` carries *alignment* (and
belongs to the column, via `colgroup`), `.wd-num` carries *figures* and is applied only to cells that
contain digits. Headers get alignment without the tracking reset.

**Live column jitter** (panel #32). "not measured" at 12px is ~2.4× the width of "318.0"; when a value
goes unmeasured mid-poll the column resizes and every row reflows horizontally on a live table. Fixed
three ways at once: `table-layout: fixed` + `<colgroup>`, `--col-num: 9ch`, and a placeholder short
enough to fit — **"no proof"** (~8 chars at 11px ≈ 44px, against 9ch at 12px ≈ 65px). It renders at
`--ink-3` Lc 78, **not** `--ink-mute` — "not measured" is the highest-stakes assertion the table makes,
because it is what stops an operator reading absence as zero (panel #11).

**The spacing law was unenforceable as written** (panel #15). `padding: var(--sp-3) var(--sp-5)` broke
"≤ sp-4 inside, ≥ sp-5 between" on its first application. The law is restated to bind **gaps between
sibling elements**, with container padding explicitly exempt. An unenforceable law is worse than none,
because the next author cites it as precedent.

**`--r-sm` (8px) on a 16px-tall badge is a pill** (panel #26) — the *action* language on a thing that
is not an action. Added `--r-xs: 4px` for sub-20px containers, with the clamp `border-radius:
min(var(--r-sm), 25%)` available where height is dynamic.

**`<strong>` emits 700** — a fifth weight, in round 1's own demo (panel #21). Reset inside every role.
The roster already does this (`font-weight: inherit` on `b` in three files); the scale now makes it law.

---

## 6b. Refinement pass 3 — rendering the page, which is the only pass that found these

Passes 1 and 2 were readings. This one built the scale into a standalone page, rendered it headless
in both themes at 2x, and looked. It found three defects that no amount of re-reading had surfaced —
all three of the *same shape*, and that shape is the finding:

1. **`.wd-col-num` never applied.** `.wd-table th` is specificity 0-1-1 and beat `.wd-col-num` at
   0-1-0, so every numeric column rendered **left-aligned**. L5 was dead on the page while the
   stylesheet read as if it were satisfied.
2. **Fixing that by wrapping the base rule in `:where()`** (0-0-0) produced a *tie* at 0-1-0, which
   `.wd-col-num` then lost on **source order**, because the numeric section is declared above the
   table section. Still left-aligned. Fixed properly by re-stating the rule table-scoped and after
   the base: `.wd-table :where(th, td).wd-col-num { text-align: right; }`.
3. **`--col-age: 7ch` wrapped its own header.** The track was sized against its content ("52m") and
   not against its label ("Proof age"), so the header wrapped to two lines and retitled the column.
   A reserved column is sized by the **wider of header and content**, and `th { white-space: nowrap }`
   makes the failure impossible rather than merely unlikely.

The shape: **this file has now produced three specificity/reservation traps, and every one of them
failed silently in exactly the direction that makes the stylesheet look correct.** Panel #13 was the
first (`.wd-num` stripping tracking from the uppercase heads). None was visible by reading. A scale
whose entire authority rests on alignment and contrast cannot be signed off from source — the CSS
must be rendered, and the contrast must be asserted by a program. Both now happen.

Also caught in the render and fixed: the demo used an em dash for a never-measured proof age, which
is this document's *own* anti-pattern (an em dash reads as data). It renders "never".

---

## 7. Provenance — the measurements now survive the session

Panel #33: *"every Lc figure dies with the session… nobody else can own it."* Correct. Converted from
an open question into a deliverable, **in this change**:

```
ops/tests/design/apca.py           APCA-W3 0.1.9 port, stdlib only, verified against the
                                   canonical triplet (106.0 / -107.9 / 63.1)
ops/tests/design/contrast.json     every (token, surface, theme) pair + its required |Lc|,
                                   plus the four shipped values this gate exists to forbid
ops/tests/design/contrast_gate.py  30 assertions; non-zero exit on failure
ops/tests/test-design-contrast.sh  picked up by run-all.sh's test-*.sh glob
```

Proven to fail, not just to pass — re-injecting the shipped dark `--muted` as `--ink-3`:

```
watchdog contrast gate: 30 assertions
FAIL
  --ink-3 [dark] #717b8a: Lc 29.2 < required 77.5
  --ink-3: theme drift 48.8 Lc > 1.5 (tiers must be pinned to equal |Lc|)
exit code: 1
```

The gate asserts contrast floors **and theme parity**, because parity is the actual product: the
shipped ramp's failure is not that any one value is dark, it is that `--muted` is Lc 65.6 in light and
29.2 in dark — two different hierarchies wearing one name.

---

## 8. The scale (winner, final)

Worst-case surface per theme is `--tile-hover` (`#eff1f4` light, `#20252d` dark) — the *darkest* light
surface and the *lightest* dark one. Round 1 verified against `--tile` and lost 2.9 Lc of the headroom
it had claimed (panel #17, confirmed: `--ink-3` measured 61.1, not the stated 64.0).

### 8.1 Spacing — base grid 2px, split at 8

```
--sp-1 2   --sp-2 4   --sp-3 6   --sp-4 8      gaps INSIDE a component
--sp-5 12  --sp-6 16  --sp-7 24  --sp-8 32  --sp-9 48   gaps BETWEEN components
```

The law is the boundary, not the numbers: **nothing exists between 8 and 12.** That hole forces an
author to decide whether two things are one object or two. Binds *gaps between siblings*; container
padding is exempt. The 2px sub-grid exists because this page's atom is a 28px row, not Carbon's 48px
control.

Derived geometry, tokenised so nobody re-derives it:
`--row-h 28` (= 16px line box + 2×`--sp-3`), `--row-h-tight 24`, `--row-h-head 32`,
`--gutter-icon 16`, `--col-num 9ch`, `--col-age 7ch`.

### 8.2 Type — six roles, five sizes, four weights

| role | px / lh / weight / tracking | ink | job |
|---|---|---|---|
| T1 title | 20 / 26 / 600 / −.014em | `--ink-display` | page title |
| T2 section | 14 / 20 / 550 / −.006em | `--ink-2` | section head |
| T3 label | 10 / 14 / 600 / +.06em UPPER | `--ink-3` | column label |
| T4 value | 12 / 16 / 500 / 0 | `--ink-1` | **the anchor** |
| T5 reason | 12 / 16 / 450 / 0 | `--ink-2` | consequence-bearing subordinate |
| T6 support | 11 / 16 / 450 / +.02em | `--ink-3` | age, unit, warrant, citation |

T4 and T5 share size and line box and are separated by **weight and one ink step alone** — L1
expressed as a scale. T1 and T2 differ by size, weight *and* ink (panel #8: round 1 separated them by
size alone, breaking its own thesis at the top of its own scale). Every size is an integer; every
line-height is an **even** integer in px (Grafana's runtime throw).

Weights `450 / 500 / 550 / 600` — four values, no others. `--fw-support 450`, `--fw-value 500`,
`--fw-head 550`, `--fw-label 600`. Names taken from what the roster already consumes. **A state change
never moves an element between weights.**

Tracking decreases monotonically and crosses zero at 12px: `+.06em` (10px, uppercase gets extra) →
`+.02em` (11px) → `0` (12px) → `−.006em` (14px) → `−.014em` (20px). Zero inside any `ch`-reserved
column regardless of size.

Documented exception: text `<input>` uses 16px to stop iOS zoom on focus. A platform constraint, the
only place the value role is not 12px.

### 8.3 Ink — four tiers pinned to identical |Lc| in both themes

| token | light | dark | \|Lc\| | permitted use |
|---|---|---|---|---|
| `--ink-1` | `#0b0e14` | `#eef4f9` | **97.2** | values, titles, **every chip label** |
| `--ink-2` | `#353a40` | `#e1e5ed` | **88.0** | reasons, section heads, promoted spans |
| `--ink-3` | `#515459` | `#d1d5db` | **78.0** | labels, units, ages, `no proof` — **truth floor** |
| `--ink-mute` | `#9ba2aa` | `#90959c` | **42.0** | **disabled and placeholder only. Never truth.** |

Theme drift ≤ 0.04 Lc on every tier. Light `--ink-1` is the house's own `--text`, unchanged — the light
theme's primary ink does not move at all, which is what keeps the migration small.

`--ink-display` = `--ink-1` in light, `--ink-2` in dark. The one legitimate theme divergence: APCA caps
dark-mode large text near Lc −90 for halation, and a 20px face at Lc 97 on black is a glowing slab. No
new hex — it aliases.

**What this fixes**, measured on the worst surface:

```
  --muted    light 65.6  dark 29.2   drift 36.4   below APCA's Lc 30 absolute text minimum
  --muted-2  light 52.1  dark 22.3   drift 29.7   below APCA's Lc 30 absolute text minimum
  --faint    light 41.4  dark 13.4   drift 28.0   below APCA's Lc 15 NON-TEXT discernibility floor
```

In dark mode this evidence-gated app currently renders the *reason a check is unavailable* at Lc 29.2
and its subordinate context at Lc 13.4 — below the threshold at which a **non-text** element is
required to be merely discernible.

### 8.4 Semantic colour — (hue, channel) pairs, and the channel table is now obeyed

| token | light | dark | legal channels | forbidden |
|---|---|---|---|---|
| `--ok` = `--up` | `#0a9b64` | `#2ebd85` | **glyph ≤12px only** | text, fill |
| `--warn` | `#8a5a00` | `#e0b34e` | glyph, tint, ink **on an untinted surface** | ink on its own tint |
| `--bad` | `#c0271f` | `#ff9f9a` | glyph, tint → escalates to `--bad-solid` | ink on its own tint |
| `--held` = `--accent` (light) | `#2f6bff` | `#9fbcfb` | glyph, tint | solid (reserved for the CTA) |

Round 1 stated this table and then broke three of four rows 40 lines later by colouring the row-icon
gutter (panel #6). And that duplication is exactly what created panel #7's collision: as bare glyphs
in one gutter, `--ok` and `--warn` sat 0.3 Lc apart in dark — one state in greyscale and under
protanopia.

**The fix is deletion, not re-solving. The icon gutter is `--ink-3`, always.** Hue lives only in the
chip, where an entire *container* separates the rungs. Published, as the panel asked:

```
severity as greyscale background — what a monochrome screenshot shows
  light   bare 255.0 → tint 238.5 → solid  77.0    steps 16.5 / 161.5   ratio 10.8×
  dark    bare  23.7 → tint  49.0 → solid  94.6    steps 25.3 /  45.6   ratio  2.8×
```

`--bad-solid`: `#c62b39` light, `#c44531` dark, white label riding at Lc 81.4 / 78.7. Hue held at 8–14°
(vermilion, protanope-safe per Okabe–Ito) and never allowed to drift toward orange, where it would
collide with `--warn`. A measured constraint worth recording: **reds are luminance-poor** — the red
coefficient is 0.213, so a saturated red sits in the luminance middle where *both* text polarities are
mediocre (`#ff4d4d`: white Lc 64.1, near-black Lc 44.9). White is the only workable label, and the fill
must be dark enough to carry it.

Unknown / unavailable / not-configured have **no hue**. They render at `--ink-3` and are distinguished
from each other by glyph topology and by a mandatory reason line. Green is earned; grey is honest.

### 8.5 Accessibility modes — both re-solved

`prefers-contrast: more` — round 1 assigned `--ink-3` the exact value of `--ink-2`, collapsing four
tiers to three in the mode that exists to *increase* differentiation (panel #18). Re-solved:

```
  --ink-1  #000000 / #ffffff   Lc 97.6 / 105.0
  --ink-2  #313438 / #e5e8ef   Lc 90.0
  --ink-3  #464a50 / #d6dce1   Lc 82.0
  --ink-mute #797d84 / #b4b6bb Lc 60.0
```

Hues raise to Lc 82 in the same block, so they are never left below raised body text:
`--ok` `#00542a` / `#00fa7d`, `--warn` `#664100` / `#ffd48a`, `--bad` `#8a1200` / `#ffd1c9`,
`--held` `#0037b8` / `#ccdbff`.

`forced-colors: active` — reasons and labels take **`CanvasText`**. `GrayText` is the OS *disabled*
colour and is confined to `[disabled]`, `[aria-disabled]` and `.wd-placeholder`.

---

## 9. Migration

Landing order, smallest blast radius first.

1. **`web/src/tokens.css`, imported before `styles.css`.** Additive; nothing overridden yet. The
   contrast gate goes green here.
2. **`--warn` gains a definition.** `styles.css:15225` reads `var(--warn, #b45309)` and no `--warn`
   exists — this alone retires 17 hardcoded amber literals spanning Lc 34.5–85.4.
3. **Alias the old ink names onto the new tiers**, then grep-gate hex literals outside the token root:
   `--text → --ink-1`, `--text-2 → --ink-2`, `--muted → --ink-3`, `--muted-2 → --ink-3`,
   `--faint → --ink-mute` *(non-truth only — audit each call site; several currently carry truth)*.
4. **Three one-line neighbour edits**, listed exactly:
   - `statusChip.css` — none. It consumes `var(--fs-5)`/`var(--lh-5)`/`var(--ls-5)`/`var(--fw-*)`
     already and picks up T5's promotion to 12px automatically. It should stop setting
     `color: var(--pc-warn)` on tinted chips and use `--ink-1` (+25–43 Lc, §1b).
   - `field.css:240–243` — `.wd-field-note` is consequence-bearing → T5 (12/16/450, `--ink-2`).
     `.wd-field-unit` at 10px stays support → T6 (11/16/450, `--ink-3`).
   - `dependencyGraph.css:256–259` — `.wd-topo-warrant` is a *citation* of where a proven value came
     from → T6 (11px, `--ink-3`). Its `--wd-topo-row-lh: 16px` comment *"T4 and T5 share it"* stays
     true, and becomes truer: they now share a size too.
5. `body { font-size: 13.5px }` → `12px`. The declaration is already fiction — every page overrides it.

### Open questions (three, all genuinely open)

- **`--faint`'s call sites need a per-site audit, not a rename.** It maps to `--ink-mute` (Lc 42,
  non-truth), but some current uses carry timestamps and units, which are truth. Each needs a decision:
  promote to `--ink-3` or confirm it is decoration. I can produce the list; the calls are not mine.
- **Raising `--ink-3` from Lc 65.6 to 78.0 in light will visibly darken secondary text on all 14 other
  pages.** In dark it is a 48.8 Lc correction and unambiguously right. Ship system-wide, or namespace
  to `.watchdog` for this pass and roll out behind the gate afterwards?
- **Inter's optical-sizing metrics were not retrievable** (rsms.me did not serve the table; the
  WebSearch budget was spent at 200/200 this session). My tracking values take their *shape* from
  Carbon and Grafana — monotonic, crossing zero at 12px — with magnitudes calibrated down for Inter's
  tighter sidebearings. The shape is sourced and the `ch` rule is mechanical; the exact magnitudes at
  T1 and T3 deserve an optical check on a real panel before lock.
