# THE WATCHDOG BIBLE

**One measurement system, one vocabulary, one page.**
Unified from 20 specialist elements. Every number in this document was computed against
`web/src/styles.css` and the shipped tree, not estimated.

- **Canonical path:** `Main/docs/design/watchdog/BIBLE.md`
  *(The calling script passed `undefined/BIBLE.md`. Written here, beside the 20 specialist
  docs it supersedes. If the intended path differs, move it — nothing links to it by path.)*
- **Token file:** `web/src/tokens.css` — exists (327 lines) and **is imported by nothing.**
  Wiring it is task 1 of the migration.
- **Verification:** `ops/tests/design/apca.py` (APCA‑W3 0.1.9, stdlib port, verified against the
  canonical triplet `#000/#fff → 106.0`, `#fff/#000 → −107.9`, `#888/#fff → 63.1`).

---

## §0 · HOW TO READ THIS

Five parts, in dependency order:

| § | Part | What it is |
|---|---|---|
| 1 | **Token system** | The single scale. Real CSS. Nothing below may invent a number. |
| 2 | **Drift report** | 41 places two specialists disagreed, and the one resolved value. |
| 3 | **Pattern library** | Consolidated CSS + markup per element, already snapped. |
| 4 | **Composition rules** | How elements become a page. |
| 5 | **Law sheet** | 24 numbered checks a reviewer holds a built component against. |

### The one sentence

> **A Watchdog surface may render only what evidence proves. Hierarchy comes from fill and
> weight; colour is spent on exceptions; absence is stated in words, never implied by silence.**

### Measured state of the tree (why this document exists)

Run against `web/src/**/*.css` on 2026‑08‑06:

| Drift | Count |
|---|---|
| Distinct `font-size` px values | **75** |
| …of which fractional (`10.5`, `11.5`, `12.5`, `9.75`, `12.75`, …) | **1,367 declarations** |
| Distinct `font-weight` values | **37** |
| Distinct `border-radius` px literals | **25** |
| Distinct hex literals | **466** |
| …in the amber/orange family alone | **81** |
| `var(--warn)` read at call sites | **5** |
| `--warn` defined in a loaded stylesheet | **0** |

Two of those five `var(--warn)` reads have **no fallback**
(`productControlRoom.css:75`, `pages/TokenDetail.css:635`) — they are invalid at computed‑value
time and are **dropped entirely**, so those states currently render with *no colour at all*.

---

# §1 · THE TOKEN SYSTEM

Ships as `web/src/tokens.css`, imported **before** `styles.css`. It adds exactly **one** new
hue (`--warn`) and aliases the rest.

## 1.1 The two measured surfaces

Every contrast figure in this document is APCA **Lc**, computed on the **worst‑case surface of
each theme** — not the flattering one:

| | Worst surface | Hex |
|---|---|---|
| Light | `--tile-hover` | `#eff1f4` |
| Dark | `--tile-hover` | `#20252d` |

Verifying on `--tile` instead silently spends ~3 Lc of headroom. That is how the previous ramp
claimed Lc 64 for a value that measured 61.1.

## 1.2 Spacing — base 2px, split at 8

```css
--sp-1: 2px;  --sp-2:  4px;  --sp-3:  6px;  --sp-4:  8px;   /* INSIDE a component  */
--sp-5: 12px; --sp-6: 16px;  --sp-7: 24px;  --sp-8: 32px;  --sp-9: 48px;  /* BETWEEN */
```

**The law binds gaps between sibling elements. Container padding is exempt.**
(An unenforceable law is worse than none: the previous version was broken by its own row
padding on first application, and the next author cited that as precedent.)

**Nothing exists between 8 and 12.** The hole is the constraint. It forces an author to decide
whether two things are one object or two.

### Derived geometry — the atom is the row, not a ratio

```css
--row-h:        28px;   /* = --lh-4 (16) + 2 x --sp-3 (6)   THE ATOM */
--row-h-tight:  24px;   /* sub-rows, group headers, reason lines     */
--row-h-head:   32px;   /* column head                               */
--gutter-mark:   8px;   /* col 0 — change/advance mark. = --sp-4      */
--gutter-icon:  16px;   /* col 1 — semantic glyph.      = --sp-6      */
--col-num:       9ch;   /* reserved numeric track                    */
--col-age:      10ch;   /* reserved age/clock track                  */
--measure:      72ch;   /* prose cap                                 */
--ctl-sm:       26px;   /* in-row control. Clears WCAG 2.5.8 24px on BOTH axes */
--ctl-md:       32px;   /* default control                           */
--ctl-lg:       40px;   /* page-header control                       */
```

`--gutter-mark + --gutter-icon = 24px = --sp-7`. That sum landing on a scale step is the check
that the two gutters are right. At 6px the mark (x=2–4) touches a row's 2px inset focus ring
(x=0–2); at 8px it spans x=3–5 with 1px clear.

## 1.3 Radius — three, and no fourth

```css
--r-xs:    4px;   /* containers under 20px tall */
--r-sm:    8px;   /* ALL data containers, ALL icon-only square buttons */
--r-pill: 999px;  /* text-labelled actions only */
```

`--r-md` and `--r-lg` are **deprecated** and grep‑gated. `7px`, `9px`, `10px`, `11px`, `13px`,
`14px` (25 literals live in the tree) are all dead.

**The rule that resolves the icon‑button argument:** a *text‑labelled* action is a pill; an
*icon‑only square* action is `--r-sm`, because `--r-pill` on a square renders a circle, which
is a fourth radius language.

## 1.4 Type — six roles, five sizes, four weights

Every size an integer. **Every line-height an even integer in px** — Grafana's
`createTypography.mjs` literally throws on an odd one, and this page has the same alignment
requirement.

```css
--fs-1: 20px; --lh-1: 26px; --ls-1: -.014em;  /* T1 title   */
--fs-2: 14px; --lh-2: 20px; --ls-2: -.006em;  /* T2 section */
--fs-3: 10px; --lh-3: 14px; --ls-3:  .06em;   /* T3 label, UPPERCASE */
--fs-4: 12px; --lh-4: 16px; --ls-4:  0;       /* T4 value  <- THE ANCHOR */
--fs-5: 12px; --lh-5: 16px; --ls-5:  0;       /* T5 reason (consequence) */
--fs-6: 11px; --lh-6: 16px; --ls-6:  .02em;   /* T6 support (spot-read)  */

--fw-support: 450;  --fw-value: 500;  --fw-head: 550;  --fw-label: 600;
```

| Role | Size/LH/Weight | Ink | Carries |
|---|---|---|---|
| **T1** title | 20 / 26 / 600 | `--ink-display` | page title |
| **T2** section | 14 / 20 / 550 | `--ink-2` | section head |
| **T3** label | 10 / 14 / 600 UPPER | `--ink-3` | column head, eyebrow |
| **T4** value | 12 / 16 / 500 | `--ink-1` | every measured value, every state word |
| **T5** reason | 12 / 16 / 450 | `--ink-2` | **why a state is not healthy** |
| **T6** support | 11 / 16 / 450 | `--ink-3` | ages, units, warrants, citations |

### The finding that shapes the whole scale

APCA's own use‑case table gives **Lc 75 to 16px/500** and **Lc 60 to 21px/500**. *Every size in
that table is larger than every size on this page.* At 10–12px the legal ink band is
**Lc 78 → 97 — only 19.2 Lc wide.** Ink contrast therefore **cannot carry hierarchy at this
density.**

So subordinate text splits by **consequence**, which is a truth‑doctrine distinction rather
than a typographic one:

- **T5 REASON** — *why* a state is not healthy. Unique free text, read once, acted on.
  **Same size as the value it qualifies**, receding by weight and one ink step only.
- **T6 SUPPORT** — ages, units, warrants. Predictable format, learned, re‑readable.
  APCA's own "spot readable" category, whose floor is Lc 30; T6 sits at Lc 78.

**T4 and T5 differ by weight and one ink step alone.** That is Law L1 expressed as a scale.
**T1 and T2 differ by size, weight AND ink** — never by size alone.

Tracking decreases monotonically and crosses zero at 12px:
`+.06em (10px) → +.02em (11px) → 0 (12px) → −.006em (14px) → −.014em (20px)`.

**Documented exception:** a text `<input>` uses 16px, to stop iOS zooming on focus.

**`<strong>`/`<b>` emit UA weight 700 — a fifth weight.** Every role clamps them to
`--fw-value` and carries emphasis in **ink**.

> **No webfont is loaded.** `--font` declares `InterVariable` but there is no `@font-face`, no
> `<link>`, and no `.woff2` in the tree. Weights snap on the system fallback (450→400/500,
> 550→600). **Therefore: no tier may be separated by weight alone.** Every role differs from
> its neighbours in at least two of {size, ink, case}. Checked: T4↔T5 collapses on weight but
> keeps a 10 Lc ink gap; T5↔T6 keeps 12px vs 11px plus a 10 Lc gap.

## 1.5 Ink — four tiers, identical Lc in both themes

**Verified. Drift 0.0 Lc.**

| Token | Light | Dark | Lc (both, worst surface) | Carries |
|---|---|---|---|---|
| `--ink-1` | `#0b0e14` | `#eef4f9` | **97.2** | values, titles, **every chip label** |
| `--ink-2` | `#353a40` | `#e1e5ed` | **88.0** | reasons, section heads, promoted spans |
| `--ink-3` | `#515459` | `#d1d5db` | **78.0** | labels, units, ages — **the truth floor** |
| `--ink-mute` | `#9ba2aa` | `#90959c` | **42.0** | **disabled + placeholder ONLY** |

Light `--ink-1` **is** the house `--text`, unchanged — the light theme's primary ink does not
move, which is what keeps the migration small.

```css
--ink-display: var(--ink-1);                    /* light */
[data-theme="dark"] { --ink-display: var(--ink-2); }
```

The **one** legitimate theme divergence, for a stated physical reason: APCA caps dark‑mode
large text near Lc −90 for halation, and a 20px face at Lc 97 on black is a glowing slab. It
aliases an existing tier, so it introduces no new hex.

### What this replaces — measured on the worst surface

| Shipped token | Light Lc | Dark Lc | Drift | Verdict |
|---|---|---|---|---|
| `--muted` | 65.6 | **29.2** | **36.4** | dark is below APCA's Lc 30 absolute text minimum |
| `--muted-2` | 52.1 | **22.3** | 29.8 | fails both |
| `--faint` | 41.4 | **13.4** | 28.0 | below Lc 15 — *invisible even as a non-text mark* |
| `--text-2` | 90.9 | 60.1 | 30.8 | two hierarchies wearing one name |

In dark mode this evidence‑gated app currently renders **the reason a check is unavailable at
Lc 29.2** and its subordinate context at Lc 13.4.

**`--muted`, `--muted-2` and `--faint` are banned inside `.watchdog`.** Not "discouraged" —
banned, with a grep gate.

## 1.6 Semantic colour — four hues, each bound to a channel

A token here is a **(hue, allowed‑channel) pair**, not a hex.

```css
:root, [data-theme="light"] {
  --ok:   var(--up);      /* #0a9b64 — GLYPH <=12px ONLY. Never text, never fill. */
  --warn: #8a5a00;        /* NEW — the one hue this system adds */
  --bad:  #c0271f;
  --held: var(--accent);  /* #2f6bff — TINT ONLY */

  --ok-tint:   #e6f5f0;  --warn-tint: #f3eee6;
  --bad-tint:  #f9e9e9;  --held-tint: #eaf0ff;

  --bad-solid: #c62b39;  --on-solid: #ffffff;
}
[data-theme="dark"] {
  --ok:   var(--up);      /* #2ebd85 */
  --warn: #e0b34e;
  --bad:  #ff9f9a;
  --held: #9fbcfb;        /* CANNOT alias --accent: see below */

  --ok-tint:   #19322e;  --warn-tint: #353125;
  --bad-tint:  #3a2e31;  --held-tint: #2b3241;

  --bad-solid: #c44531;  --on-solid: #ffffff;
}
```

**Measured, worst surface:**

| Hue | Light Lc | Dark Lc | Floor | Channel |
|---|---|---|---|---|
| `--ok` | 54.2 | 52.3 | 45 (fine pictogram) | glyph ≤12px |
| `--warn` | 70.9 | 62.0 | 45 glyph / 60 ink | glyph, tint, ink on untinted |
| `--bad` | 69.5 | 61.9 | 45 / 60 | glyph, tint → escalates to solid |
| `--held` | 62.1 | 63.5 | 45 / 60 | **tint only** |
| `--on-solid` on `--bad-solid` | **81.4** | **78.7** | 75 | the label rides the fill |

`--held` **cannot** alias `--accent` in dark: `#2f6bff` measures **Lc 28.3** on dark surfaces —
below the floor for text *and* for fine pictograms. That is a live shipped bug; `#9fbcfb` is
the lift.

### The load-bearing measurement — hue is never ink on its own tint

| Tint | hue‑as‑ink | `--ink-1`‑as‑ink | Gain |
|---|---|---|---|
| warn light | 69.5 | **95.8** | +26.3 |
| warn dark | 59.5 | **94.7** | +35.2 |
| bad light | 67.0 | **94.7** | +27.7 |
| bad dark | 59.4 | **94.7** | +35.3 |
| held light | 61.5 | **96.6** | +35.1 |
| ok light | 54.7 | **97.6** | +42.9 |

> **A chip label is always `--ink-1`. Hue is always fill.**
> 25–43 Lc, available for free. That is Law L1 proven numerically rather than asserted.

### The severity ladder is FILL MASS, not hue

Perceived byte value of the **background**, ITU‑R BT.601 luma:

| | bare | tint | solid | ratio |
|---|---|---|---|---|
| light | 255.0 | 238.6 | 90.9 | **2.8×** |
| dark | 23.7 | 48.8 | 104.7 | **4.4×** |

Severity survives a **monochrome screenshot** and protanopia, because it is fill mass.
Hue only *confirms* what fill already said.

### The four rules that follow

1. `--ok` is a **≤12px glyph and nothing else** — never text, never a word, never a fill.
   It aliases `--up`, so the product has **one** green, not a proof‑green and a profit‑green
   indistinguishable in greyscale.
2. **The icon gutter is `--ink-3`, always.** Hue lives only inside the chip, where an entire
   container separates the rungs. Colouring the gutter is what previously put `--ok` and
   `--warn` 0.3 Lc apart in dark — one state, in greyscale and under protanopia.
3. `--bad` hue is held at **8–14° (vermilion)** — protanope‑safe (Okabe‑Ito) — and never drifts
   toward orange, where it would collide with `--warn`.
4. **Unknown / unavailable / not‑configured have no hue.** `--ink-3` plus a mandatory reason.
   Green is earned; grey is honest.

## 1.7 Motion — four durations, one curve, two licensed loops

```css
--mo-instant:   0ms;   /* keyboard, focus, INFORMATION ARRIVING */
--mo-fast:     90ms;   /* colour / opacity on a control          */
--mo-base:    160ms;   /* translate                              */
--mo-decay:   320ms;   /* WITHDRAWAL ONLY. Never an interaction. */
--mo-spin:    700ms;   /* licensed loop: in-flight rotation      */
--mo-seek:   1200ms;   /* licensed loop: first-load rail traverse */
--mo-out: cubic-bezier(.22, 1, .36, 1);

/* dwell is a DECISION scale (whether to show), not a duration scale (how it arrives) */
--mo-arm:   320ms;  --mo-warm: 480ms;  --mo-close: 120ms;
```

**No ease-in. No spring** — overshoot renders positions the data never occupied.
**Every token has a call site**; a token nothing reads is a defect, not a spare.

Four governing laws:

- **M1 · Motion means non-terminal.** A settled state never moves. No pulse on healthy, ever.
- **M2 · Motion never encodes severity.**
- **M3 · Information appears at 0ms. Only its withdrawal is eased.**
- **M4 · Every information-bearing motion has a non-motion carrier**, so
  `prefers-reduced-motion` costs **zero information**. Signals are *states with transitions*,
  never keyframes — removing the transition removes the fade and keeps the fact.

## 1.8 Focus — one ring, two forms

```css
--focus-ring: var(--accent);   /* WCAG 4.50 light / 3.95 dark — clears the 3:1 non-text floor */
--focus-gap:  var(--panel);
```

`--accent-line` composites to **1.79 : 1** light / **1.68 : 1** dark. It is invisible in
*normal* mode and must never be a ring.

```css
/* (a) default */
.watchdog :focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: inherit;   /* defeats styles.css:146, which forces 4px and squares a pill */
  transition: none;         /* keyboard actions repeat hundreds of times a day */
}
/* (b) inset — for anything inside a clipping container (.healthx-frame is overflow:hidden,
   which CLIPS an outline on the first and last row) */
.watchdog .is-clipped:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--focus-ring);
}
```

`box-shadow` is **dropped entirely in Windows High Contrast Mode**, so form (b) must restore a
real `outline: 2px solid Highlight; outline-offset: -2px` under `forced-colors: active`.

## 1.9 The complete token file

```css
/* =============================================================================
   web/src/tokens.css — imported BEFORE styles.css.
   Adds ONE new hue (--warn). Everything else aliases an existing house token.
   Verified with ops/tests/design/apca.py on the WORST surface of each theme.
   ========================================================================== */
:root, [data-theme="light"] {
  /* spacing */
  --sp-1:2px; --sp-2:4px; --sp-3:6px; --sp-4:8px;
  --sp-5:12px; --sp-6:16px; --sp-7:24px; --sp-8:32px; --sp-9:48px;

  /* derived geometry */
  --row-h:28px; --row-h-tight:24px; --row-h-head:32px;
  --gutter-mark:8px; --gutter-icon:16px;
  --col-num:9ch; --col-age:10ch; --measure:72ch;
  --ctl-sm:26px; --ctl-md:32px; --ctl-lg:40px;
  --sticky-top:0px;     /* `.app-main main` IS the scroll container; the app header
                           is a SIBLING ABOVE it. NEVER use --header-h as an offset. */

  /* radius */
  --r-xs:4px; --r-sm:8px; --r-pill:999px;

  /* type */
  --fs-1:20px; --lh-1:26px; --ls-1:-.014em;
  --fs-2:14px; --lh-2:20px; --ls-2:-.006em;
  --fs-3:10px; --lh-3:14px; --ls-3:.06em;
  --fs-4:12px; --lh-4:16px; --ls-4:0;
  --fs-5:12px; --lh-5:16px; --ls-5:0;
  --fs-6:11px; --lh-6:16px; --ls-6:.02em;
  --fw-support:450; --fw-value:500; --fw-head:550; --fw-label:600;

  /* ink */
  --ink-1:#0b0e14; --ink-2:#353a40; --ink-3:#515459; --ink-mute:#9ba2aa;
  --ink-display:var(--ink-1);

  /* semantic */
  --ok:var(--up); --warn:#8a5a00; --bad:#c0271f; --held:var(--accent);
  --ok-tint:#e6f5f0; --warn-tint:#f3eee6; --bad-tint:#f9e9e9; --held-tint:#eaf0ff;
  --bad-solid:#c62b39; --on-solid:#ffffff;

  /* motion */
  --mo-instant:0ms; --mo-fast:90ms; --mo-base:160ms; --mo-decay:320ms;
  --mo-spin:700ms; --mo-seek:1200ms;
  --mo-out:cubic-bezier(.22,1,.36,1);
  --mo-arm:320ms; --mo-warm:480ms; --mo-close:120ms;

  /* focus */
  --focus-ring:var(--accent); --focus-gap:var(--panel);
}

[data-theme="dark"] {
  --ink-1:#eef4f9; --ink-2:#e1e5ed; --ink-3:#d1d5db; --ink-mute:#90959c;
  --ink-display:var(--ink-2);
  --ok:var(--up); --warn:#e0b34e; --bad:#ff9f9a; --held:#9fbcfb;
  --ok-tint:#19322e; --warn-tint:#353125; --bad-tint:#3a2e31; --held-tint:#2b3241;
  --bad-solid:#c44531; --on-solid:#ffffff;
}

/* ---- type roles: pick a ROLE, never an individual property ---------------- */
.wd-t1,.wd-t2,.wd-t3,.wd-t4,.wd-t5,.wd-t6 { margin:0; font-family:var(--font); font-optical-sizing:auto; }
.wd-t1{font-size:var(--fs-1);line-height:var(--lh-1);letter-spacing:var(--ls-1);font-weight:var(--fw-label);color:var(--ink-display);}
.wd-t2{font-size:var(--fs-2);line-height:var(--lh-2);letter-spacing:var(--ls-2);font-weight:var(--fw-head);color:var(--ink-2);}
.wd-t3{font-size:var(--fs-3);line-height:var(--lh-3);letter-spacing:var(--ls-3);font-weight:var(--fw-label);color:var(--ink-3);text-transform:uppercase;}
.wd-t4{font-size:var(--fs-4);line-height:var(--lh-4);letter-spacing:var(--ls-4);font-weight:var(--fw-value);color:var(--ink-1);}
.wd-t5{font-size:var(--fs-5);line-height:var(--lh-5);letter-spacing:var(--ls-5);font-weight:var(--fw-support);color:var(--ink-2);}
.wd-t6{font-size:var(--fs-6);line-height:var(--lh-6);letter-spacing:var(--ls-6);font-weight:var(--fw-support);color:var(--ink-3);}
:where(.wd-t1,.wd-t2,.wd-t3,.wd-t4,.wd-t5,.wd-t6) :where(strong,b){font-weight:var(--fw-value);color:var(--ink-1);}

/* ---- numeric: TWO orthogonal modifiers ------------------------------------
   .wd-col-num = ALIGNMENT, belongs to the COLUMN (headers get it too).
   .wd-num     = FIGURES, applied ONLY to cells containing digits.
   Fusing them strips tracking from 10px uppercase column heads. */
.wd-col-num { text-align: right; }
.wd-num {
  font-variant-numeric: lining-nums tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  letter-spacing: 0;   /* MECHANICAL: CSS `ch` is the advance of "0" and does NOT
                          include letter-spacing, so tracking silently
                          under-reserves a ch-sized column and clips. */
}

/* ---- identifier: takes the SIZE and COLOUR of its host register ----------- */
.wd-id {
  display:inline-flex; min-width:0;
  font-family:var(--mono); font-size:inherit; font-weight:var(--fw-value);
  color:inherit; font-variant-numeric:tabular-nums; letter-spacing:0;
}
.wd-id > b { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:inherit; }
.wd-id > i { flex:none; font-style:normal; }   /* NO literal ellipsis in the markup */

/* ---- absence -------------------------------------------------------------- */
.wd-nodata     { color:var(--ink-3); }        /* TRUTH: "no proof", "never"  */
.wd-placeholder{ color:var(--ink-mute); }     /* NON-TRUTH: empty, disabled  */

/* ---- the ONE screen-reader utility in the codebase ------------------------ */
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;
  overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;}

/* ---- focus ---------------------------------------------------------------- */
.watchdog :focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;
  border-radius:inherit;transition:none;}
.watchdog .is-clipped:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--focus-ring);}

/* ---- accessibility modes: RE-SOLVED, never renamed ------------------------ */
@media (prefers-contrast: more){
  :root,[data-theme="light"]{
    --ink-1:#000000;--ink-2:#313438;--ink-3:#464a50;--ink-mute:#797d84;
    --ok:#00542a;--warn:#664100;--bad:#8a1200;--held:#0037b8;--line:var(--line-2);}
  [data-theme="dark"]{
    --ink-1:#ffffff;--ink-2:#e5e8ef;--ink-3:#d6dce1;--ink-mute:#b4b6bb;
    --ok:#00fa7d;--warn:#ffd48a;--bad:#ffd1c9;--held:#ccdbff;--line:var(--line-2);}
}
@media (forced-colors: active){
  /* GrayText is the OS DISABLED colour. Reasons and labels are TRUTH and must
     never render as disabled — that is the single worst a11y defect this
     document fixes, and it was committed INSIDE the query meant to prevent it. */
  .wd-t1,.wd-t2,.wd-t3,.wd-t4,.wd-t5,.wd-t6{color:CanvasText;}
  .wd-placeholder,[disabled] .wd-t4,[aria-disabled="true"] .wd-t4{color:GrayText;}
  .watchdog .is-clipped:focus-visible{outline:2px solid Highlight;outline-offset:-2px;box-shadow:none;}
}
```

**This system ships no shadow, no gradient, no glass and no blur.** Hierarchy is fill and
weight. That is why there is nothing to disable under `prefers-reduced-transparency`, and why
none of the house `--glass-*` / `--depth` tokens are consumed.

---

# §2 · THE DRIFT REPORT

**41 conflicts.** Format: what disagreed → the one resolved value → the deciding argument.

## Geometry

**D1 · Action radius — 6 claimants, 6 answers.**
`button-system` 7px · `toggle`/`select`/`empty-state` `--r-pill` · `field-pair`/`identifier`
`--r-sm` · `card-frame` `--r-md` · tree has **25 distinct radius literals**.
→ **THREE radii: `--r-xs` 4 / `--r-sm` 8 / `--r-pill` 999.** Text‑labelled action = pill;
icon‑only square action = `--r-sm`. 7px dead; `--r-md`/`--r-lg` deprecated.
*Why:* a pill on a square renders a circle — a fourth radius language. The house 7px is not on
any scale and exists only because two legacy button classes share it.

**D2 · Row height.** `data-row` 44px (measured off `.hp-table`, a *less dense* table) ·
everyone else 28px.
→ **`--row-h: 28px`.** With a reason line: 28 + 24 = 52px.
*Why:* the Watchdog row is the dense row. `data-row`'s mechanism survives verbatim
(`min-height` + `grid-template-rows: var(--row-h) auto`) — only the constant changes. A fixed
`height` on a grid puts the reason line in an implicit track that **overflows into the next
row**; that was `data-row`'s own Tier‑1 defect.

**D3 · Icon gutter.** 20px (`data-row`) · 16px (`status-chip`, `graph-node`, `info-row`) ·
12px (`motion` change mark) · 28px (`empty-state`, `unknown-state`).
→ **Two gutters: col 0 = `--gutter-mark` 8px (change/advance), col 1 = `--gutter-icon` 16px
(semantic glyph).** 8 + 16 = 24 = `--sp-7`.
*Why:* the sum landing on a scale step is the check. At 6px the mark touches a row's inset
focus ring; at 8px it clears by 1px.

**D4 · Glyph size.** 12px (most) · 14px (`button-system`) · 16px (`info-row`).
→ **12px for every semantic and affordance glyph. 16px only at panel/page scale.**
*Why:* one size is enforceable; "14px inside buttons, 12px in rows" is drift with a rationale.

**D5 · Icon→label gap.** `button-system` 7px "house optical value" · everyone else `--sp-3`.
→ **`--sp-3` (6px).** One documented casualty; 7 is on no scale.

**D6 · Control heights.** 26/32/40 (`button-system`) · 28 (`select`) · 28/30 (`toggle`) ·
24/32 (`field-pair`) · 26/30 (`identifier`).
→ **`--ctl-sm` 26 / `--ctl-md` 32 / `--ctl-lg` 40.** Icon‑only: square at the same height,
min 24 fine‑pointer, 32 coarse.
*Why:* 26 clears WCAG 2.5.8's 24px floor on **both** axes with no reliance on the spacing
exception, and a 26px control inside a 28px row leaves 1px each side.

**D7 · Section gap.** `card-frame` tight 24 / loose 48.
→ **Adopted, expressed as `calc(var(--sp-7) * 2)`** so the *ratio* is in the source and cannot
drift into two unrelated numbers.

**D8 · Reserved age/clock column.** `status-chip` `--pc-clock-w: 76px` · `tokens`
`--col-age: 10ch` · `coverage-counter` inherits statusChip's.
→ **`--col-age: 10ch`**, and `--pc-clock-w` aliases it.
*Why:* `ch` scales with the face; 76px does not, and the column is sized by the **wider of
header and content** ("Proof age" is wider than "52m").

## Type

**D9 · Section‑head size.** 13/600 (`card-frame`) · 14/550 (`tokens`, `coverage-counter`).
→ **T2 = 14 / 20 / 550.**

**D10 · Reason size & ink.** 11/450/`--ink-3` (`status-chip`, `field-pair`, `numeric`,
`card-frame`) · 11.5/460 (`info-row`) · 12/450/`--ink-2` (`tokens`).
→ **T5 = 12 / 16 / 450 / `--ink-2`.**
*Why:* APCA gives Lc 88 to 16px/500 — nothing on this page is that big, so shrinking the one
string an operator must **act on** is not affordable. Ages and units go to T6.

**D11 · Label size.** 10/600/.06em (`tokens`, `coverage-counter`) · 11/600/.05em (`data-row`,
`card-frame`).
→ **T3 = 10 / 14 / 600 / +.06em UPPERCASE.**

**D12 · Weight scale.** 450/500/550/600 (`tokens`) · +590/620/680 (`data-row`) ·
+460/510/520 (`owner-row`) · +680 (`card-frame`) · tree has **37 distinct weights**.
→ **FOUR: 450 / 500 / 550 / 600.** T1 is 600, not 680.
*Why:* no webfont is loaded, so 620/680 snap to 600 on the fallback and the "hierarchy from
weight" mechanism silently stops existing. Hence the hard rule: **no tier separated by weight
alone.**

**D13 · Line-height parity.** `info-row` 18px · `tokens` 16px.
→ **Even integers only: 14 / 16 / 20 / 26.** 18px dies.

**D14 · Fractional sizes.** 1,367 declarations across 10.5 / 11.5 / 12.5 / 9.75 / 12.75 …
→ **Integers only.** Grafana's build throws on odd line-heights for exactly this reason.

**D15 · Unit tier.** 10px (`numeric`, `select`) · 11px (`tokens` T6).
→ **T6 = 11px.** Still below T4's 12px, so the value still dominates.

## Colour

**D16 · Amber — the sharpest conflict in the roster.**
`status-chip` refuses amber entirely (Okabe‑Ito: amber‑vs‑red is the tightest CVD pair) and
makes DEGRADED a **tinted red**. `tokens` says `--warn` **is** amber and **is** the degraded
hue. `graph-node` explicitly declined to arbitrate. `button-system` measured `#b06a12` at
4.27:1 and refused to define it. `empty-state` consumed the undefined token and rendered
**no colour at all**. The tree carries **81 amber‑family hexes**.
→ **`--warn` = `#8a5a00` / `#e0b34e`, defined once at `:root`. Amber IS the degraded hue.**
*Why `status-chip` loses on its own terms:* the CVD collision it fears only bites when **hue is
the sole channel**. The fill ladder forbids that — degraded is a **tint**, blocked is a
**solid**, and the greyscale separation is 2.8× (light) / 4.4× (dark). Degraded and blocked are
never at the same fill weight, so the amber/red pair is **structurally never adjacent**. And a
tinted‑red degraded is *indistinguishable from a not‑yet‑escalated blocked* in any monochrome
screenshot — which is worse than the risk it was avoiding. `--warn` must be defined regardless:
five call sites already read it.

**D17 · Hue as ink on its own tint.** `status-chip` sets `color: var(--pc-warn)` on tinted
chips.
→ **A chip label is always `--ink-1`.** Worth **+25 to +43 Lc**, free.

**D18 · Green.** `coverage-counter` fills a proven disc in `--ok` · `metric-cell` bans green
outright · `status-chip`/`tokens` say glyph‑only.
→ **`--ok` is a ≤12px glyph, never text, never a word, never a fill.** It aliases `--up` so
there is **one** green in the product.

**D19 · Icon gutter hue.** `data-row`, `graph-node` colour the state glyph in its severity hue ·
`tokens`, `motion` say hueless.
→ **The gutter is `--ink-3`, always.** Hue lives only inside the chip.
*Why:* colouring the gutter put `--ok` and `--warn` **0.3 Lc apart** in dark — one state, in
greyscale and under protanopia.

**D20 · `--held` in dark.** `status-chip` aliases `--accent` · `select` uses `--held` ·
`tokens` lifts it.
→ **`--held` = `--accent` in light, `#9fbcfb` in dark.**
*Why:* `#2f6bff` measures **Lc 28.3** on dark surfaces — below the floor for text *and* fine
pictograms. Live shipped bug.

**D21 · Banned inks.** `--faint` used by `data-row`, `card-frame`, `info-row` (round 1);
`--muted-2` by `coverage-counter`, `unknown-state`; `--muted` broadly.
→ **All three banned inside `.watchdog`.** Measured 41.4/13.4, 52.1/22.3, 65.6/29.2.

**D22 · Accent budget.** `motion` exempts the ring · `status-chip` spends it once on
OWNER_GATED · `card-frame` spends it on `:target` · `select` deliberately routes around it.
→ **One persistent accent role per surface (`--held` tint) + transient chrome (focus ring,
`:target` arrival mark), which is exempt because at most one exists at a time.**

**D23 · Blast radius / consequence.** `graph-node` proposed `--bad` for system scope ·
`card-frame` proposed neutral mass.
→ **Neutral 2px `--ink-1` left rule, always present, transparent by default.**
*Why:* `--bad` means *failed*. A system‑scoped control is not failed, it is **consequential**.
Painting consequence in the failure hue re‑commits the shipped sin of
`.pcr-emergency-control.engaged { background: var(--up) }` — **an engaged kill switch rendered
green.**

**D24 · Forced-colors GrayText.** Several elements put reasons on `GrayText`.
→ **Reasons and labels = `CanvasText`. `GrayText` only for `[disabled]`, `[aria-disabled]`,
`.wd-placeholder`.** `GrayText` is the OS *disabled* colour; using it for a mandatory reason
renders truth as disabled inside the query meant to protect it.

## Motion & interaction

**D25 · Duration scale.** 120/150/700 (`button-system`) · 140/150 (`card-frame`, `numeric`,
`sparkline`) · 0/90/160/200/320 (`motion`).
→ **`--mo-instant` 0 / `--mo-fast` 90 / `--mo-base` 160 / `--mo-decay` 320, + two named loops
(`--mo-spin` 700, `--mo-seek` 1200). One curve.** 120/140/150/200 deleted.

**D26 · Hover transition.** `motion` says none, in or out · `button-system`/`data-row`/`select`
transition 90–150ms.
→ **Row hover: no transition. Control hover: `--mo-fast` on colour/background/border only.**
*Why:* a fade across a dense table leaves a three‑row comet trail on a fast traverse. A button
is not a row.

**D27 · Sticky.** `card-frame` ships **zero** sticky and publishes `--sticky-top: 0px` ·
`coverage-counter` stickies section headers at `--header-h` · `owner-row` stickies group
headers · `data-row` stickies the column head at 0.
→ **`--sticky-top: 0px`. Exactly ONE sticky object per scroll container: the table's own
column header row.**
*Why (verified):* `styles.css:158-160` makes `.app-main main` the scroll container with the app
header a **sibling above it, outside the scroller**. `top: var(--header-h)` therefore produces
**58px of dead band**, not clearance. A two‑tier sticky ladder would have shipped 90px of empty
gap above every pinned header. NN/g's actual requirement is to freeze **column meaning**, which
is the header row — not the section title.

**D28 · Optimistic rendering.** Rauno and Vercel both *prescribe* it.
→ **Never, under `.watchdog`.** Documented divergence with the reason: their premise is
"success is likely," and here `REJECTED_AUTHORITY`, `REJECTED_EXPOSURE`, `REJECTED_DEPENDENCY`
and `AMBIGUOUS` are all **defined outcomes**.

**D29 · Disabled attribute.** `button-system` allows native `disabled` for `incomplete` ·
`toggle`/`select`/`tabs`/`empty-state` allow none.
→ **Never the native `disabled` attribute, with one narrow exception:** when the enabling input
is in the **same viewport and visibly labelled**. Everything else is `aria-disabled` + a
handler guard, or renders **no control at all**.
*Why:* `disabled` removes the control from the tab order, which makes the reason unreachable —
and Rauno forbids tooltips on disabled controls, removing the usual escape.

**D30 · Live regions.** one per cluster (`button-system`) · one per band (`metric-cell`) · one
per module (`identifier`) · one per page (`status-chip`, `motion`).
→ **ONE `role="status" aria-live="polite"` per PAGE**, in the header, present from first paint,
coalesced, consequence transitions only, silent when nothing of consequence happened.
Exception: a destructive arm may use a transient per‑cluster `role="alert"` — user‑initiated
and singular.

**D31 · Change signal.** `data-row` 2×14px change mark on render diff · `motion` 2×12px dashed
advance mark on `heartbeatAtMs` vs `lastAdvanceAtMs`.
→ **`motion`'s advance mark: 2 × 12px, dashed `border-inline-start`, `--ink-3`, 8px gutter,
polarity inverted (the expected case renders nothing).**
*Why:* a render diff fires when a latency digit jitters 1ms and is **silent forever when a
writer wedges** — the most urgent event on the wall. And on a healthy wall nearly every row
changes every poll, so a change mark is present on nearly every row, which is wallpaper.

## Structure & semantics

**D32 · Container.** `card-frame` ships **no** section border/radius/fill/shadow · `data-row`
uses a frame with radius + shadow · `metric-cell` uses a tinted band.
→ **Sections have no container.** Exactly **one** bounded surface per page: the region that
**mutates the system**, at `--r-sm` on `--tile`, with `margin-inline` and `padding` that
**cancel exactly** so its contents stay on the page axis.

**D33 · Table semantics.** `role="treegrid"` on divs (`data-row`, `owner-row`) · native
`<table>` + `<colgroup>` (`tokens`).
→ **Native `<table>` + `<colgroup>` + `table-layout: fixed`.** Add `role="treegrid"` +
`aria-expanded` **only** when rows genuinely expand.
*Why:* `display:grid` on `<tr>` makes every row an independent formatting context, so
"right‑aligned on a numeric column" degrades to right‑aligned inside N differently‑sized boxes
and **L5 evaporates**.

**D34 · Column widths.** grid `minmax()` (`data-row`) · `<colgroup>` ch (`tokens`) · fixed ch
tracks (`coverage-counter`).
→ **`<colgroup>` with ch widths from the numeric contract, `table-layout: fixed`.**

**D35 · Truncation.** literal `…` in the string (`owner-row`, round 1) · head/tail spans with
CSS‑supplied ellipsis (`identifier`, `field-pair`, `graph-node`).
→ **`identifier` owns it: `<b>{head}</b><i>{tail}</i>`, no literal ellipsis, full string in the
DOM, `text-overflow` supplies the mark only on real overflow. Never `title`.**
*Why:* a literal ellipsis renders a truncation that did not happen when the container is wide —
an operator failing an address verification that should have passed.

**D36 · Truncation budgets.** per‑kind table (`identifier`) · 18/14 (`owner-row`) · tail 6
(`field-pair`).
→ **`identifier`'s kind table is canonical. Tail ≥ head, always.**
*Why:* the differentiating end is the collision‑resistant end — the documented mechanism behind
$83.8M of address‑poisoning losses.

**D37 · Absence glyph.** em dash (`data-row`, `metric-cell`, `numeric`, `field-pair`) · dotted
hairline (`unknown-state`) · the words "no proof" (`tokens`).
→ **Never an em dash as the sole carrier.** Slot scale = 3ch dotted hairline on the baseline +
`.sr-only` text. Column scale = the literal words `no proof` / `never` at `--ink-3`.
*Why:* NVDA reads a dash as **nothing at all**. On an evidence‑gated surface, silence is the
most complete form of the lie.

**D38 · Absence vocabulary.** `unknown-state` 3 kinds · `empty-state` 12 causes · `numeric` 7
states · `metric-cell` composes the chip.
→ **Three scales.** SLOT = `unknown-state`'s 3 kinds. ROW/CELL = the chip's word.
PANEL = `empty-state`'s causes mapped onto chip words. **All reason strings come from one
`REASON_COPY` map keyed by the server's reason code**, with a build‑time exhaustiveness check.

**D39 · State vocabulary.** `button-system` gates · `owner-row` `data-truth` · `metric-cell` 6
truth values · `toggle` postures · `info-row` registers · `tabs` 6 states.
→ **ONE vocabulary — `status-chip`'s `WatchdogState` + `STALE` as a modifier.** Every other
element **composes** `<StatusChip>`; nobody re‑implements a word, a tone or a glyph.

**D40 · `sr-only`.** At least **8** implementations (`.mo-vh`, `.wd-vh`, `.wdb-sr`,
`.pcr-visually-hidden`, `.aiox-page .sr-only`, …).
→ **ONE `.sr-only` at root in `tokens.css`.** All others deleted.

**D41 · Density hook.** `data-row` left it as an open question · `card-frame` ignores it.
→ **`.dense-tables` is NOT honoured by Watchdog.** Watchdog has one density. Stated so it stops
being an open question.

### Casualties, named

7px radius · 9/10/11/13/14px radii · 44px row · 20px & 28px icon gutters · 14px & 16px glyphs ·
7px icon gap · 620/680/590/560/520/510/470/460/430/420 weights · 18px line-height ·
10.5/11.5/12.5/9.75/12.75px sizes · 120/140/150/200ms · `--faint` · `--muted-2` · `--muted` ·
`--accent-line` as a ring · `--r-md` · `--r-lg` · `#b06a12` · 80 amber literals · the em dash ·
the render‑diff change mark · every section border · every section sticky · seven `sr-only`
classes · `.flash-up`/`.flash-down` (`styles.css:3736`) · `hbPulse` on healthy states ·
`.pcr-emergency-control` colour overrides (`productControlRoom.css:200-203`).

---

# §3 · THE PATTERN LIBRARY

Every element below is snapped to §1. **No element declares a size, weight, ink, duration,
radius or hue of its own.** Where an element previously owned something a neighbour owns
better, it now composes.

## 3.0 The composition graph (read this before any element)

```
tokens.css ────────────────────────────► everything
motion.css ────► durations, curves, focus, the advance mark, the poll rail
StatusChip ────► every state word, tone, glyph, and reason-required invariant
Identifier ────► every middle-truncation and copy affordance
Numeric    ────► every character grid and reserved numeric track
```

An element that re‑implements one of those five is **wrong by construction**, not by taste.

## 3.1 `StatusChip` — the state vocabulary

**Owns:** the seven states, the tone ladder, eight glyph topologies, the mandatory‑reason
runtime invariant, the stale demotion. **Everyone else composes it.**

States: `READY · DEGRADED · BLOCKED · UNAVAILABLE · UNKNOWN · NOT_CONFIGURED · OWNER_GATED`,
with `STALE` as an orthogonal **modifier** (a component can be READY *and* STALE; forcing a
choice makes either answer a lie).

| Rung | Fill | Hue | Label ink |
|---|---|---|---|
| READY | none | `--ok` glyph only | `--ink-1` |
| UNKNOWN / UNAVAILABLE / NOT_CONFIGURED | none | **none** | `--ink-1` |
| OWNER_GATED | `--held-tint` | held | `--ink-1` |
| DEGRADED | `--warn-tint` | warn | `--ink-1` |
| BLOCKED | `--bad-solid` | bad | `--on-solid` |

```css
.wd-chip{
  display:inline-flex; align-items:center; gap:var(--sp-3);
  padding:var(--sp-1) var(--sp-4);
  border:1px solid transparent; border-radius:var(--r-sm);
  background:transparent; color:var(--ink-1);
  font-size:var(--fs-4); font-weight:var(--fw-value); line-height:var(--lh-4);
  letter-spacing:0; text-transform:none;   /* a status is a VALUE, not a column head */
  white-space:nowrap; cursor:default; user-select:text;
}
.wd-chip-glyph{flex:none;width:12px;height:12px;color:currentColor;}

/* the fill ladder — the ONLY hierarchy mechanism */
.wd-chip[data-rung="gated"]  {background:var(--held-tint);border-color:color-mix(in srgb,var(--held) 26%,transparent);}
.wd-chip[data-rung="warn"]   {background:var(--warn-tint);border-color:color-mix(in srgb,var(--warn) 26%,transparent);}
.wd-chip[data-rung="blocked"]{background:var(--bad-solid);color:var(--on-solid);border-color:transparent;}
.wd-chip[data-rung="ready"] .wd-chip-glyph{color:var(--ok);}
/* absent rungs: glyph one step quieter, LABEL at full legibility */
.wd-chip[data-rung="absent"] .wd-chip-glyph{color:var(--ink-3);}

/* the reason — T5, its own line, never a tooltip, never truncated to nothing */
.wd-chip-reason{
  color:var(--ink-2);
  font-size:var(--fs-5);font-weight:var(--fw-support);line-height:var(--lh-5);
  font-variant-numeric:tabular-nums;
}
.wd-chip-reason b{color:var(--ink-1);font-weight:var(--fw-value);}

/* the doctrine as a RUNTIME invariant, shipped in production */
.wd-chip[data-defect="true"]{
  border:1px dashed var(--line-strong);
  background:repeating-linear-gradient(135deg,transparent 0 5px,var(--tile) 5px 10px);
}

@media (forced-colors: active){
  .wd-chip[data-rung="warn"],.wd-chip[data-rung="gated"]{border-color:CanvasText;background:Canvas;}
  .wd-chip[data-rung="blocked"]{background:Highlight;color:HighlightText;border-color:Highlight;}
}
```

```tsx
// REASON_REQUIRED is a runtime invariant, not a review convention.
const REASON_REQUIRED = new Set(['DEGRADED','BLOCKED','UNAVAILABLE','UNKNOWN','NOT_CONFIGURED','OWNER_GATED']);

<StatusChip state="UNAVAILABLE" reason={<>Collector <code className="wd-id">…</code> offline since 09:14 UTC</>} />
// undefined resolves to UNKNOWN — there is NO null render path, because an empty
// gutter is indistinguishable from a chip that failed to render.
// stale + READY  -> tone `absent`, glyph STALE, label "Stale", reason mandatory.
// stale + BLOCKED -> unchanged. A proven failure does not soften.
```

## 3.2 `Identifier` — middle truncation with copy

**Owns:** every hash, revision, address, path and correlation id on the page.

| kind | prefix | head | tail | renders |
|---|---|---|---|---|
| `rev` | — | 7 | 8 | `4f9a2c1…6b3d0a92` |
| `digest` | `sha256:` | 8 | 8 | `sha256:9f86d081…b0f00a08` |
| `corr` | — | 6 | 8 | `01JQ8Z…6R8T1W5Y` |
| `addr` | `0x` | 6 | 8 | `0xb0bD1c…5f5415` |
| `ref` | — | 14 | 18 | `release/2026-0…-fable5-clean-b` |
| `path` | — | — | trailing segments to 36ch | `…/engine/basis` |
| *unregistered* | — | — | — | **rendered in full, never elided** |

Invariants: **tail ≥ head, always** · structural prefixes never elided · elide only when
`len > prefix + head + tail + 4` · the budget is a function of `kind` only, **never of column
width** · separators in a path are **selectable** (`user-select:none` on them silently turns
`server/src/engine/basis` into `serversrcenginebasis` on copy).

```css
.wd-idbtn{
  display:inline-flex;align-items:center;gap:var(--sp-4);
  height:var(--ctl-sm);margin:0 calc(var(--sp-4) * -1);padding:0 var(--sp-4);
  border:0;border-radius:var(--r-sm);background:transparent;color:inherit;font:inherit;cursor:pointer;
}
@media (hover:hover) and (pointer:fine){
  .wd-idbtn:hover{background:var(--tile);color:var(--ink-1);}
}
/* the elided middle stays in DOM ORDER so a drag-selection traverses it and the
   clipboard receives the COMPLETE value */
.wd-id-mid{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.wd-id > i::before{content:"\2026";color:var(--ink-3);user-select:none;}  /* generated: never copied */
.wd-id[data-elided="no"] > i::before{content:none;}
.wd-id-ico{flex:none;width:12px;height:12px;color:var(--ink-3);}
.wd-id-ok{opacity:0;transition:opacity var(--mo-decay) var(--mo-out);}
.wd-idbtn[data-copied="true"] .wd-id-ok{opacity:1;color:var(--ok);transition-duration:var(--mo-instant);}
.wd-idbtn[data-copy-failed="true"] .wd-id-ico{color:var(--bad);}  /* never a check on failure */
```

```tsx
// data-copy carries the FULL value, explicitly — never scraped from rendered text.
<button className="wd-idbtn" data-copy={full} aria-label={`Copy ${KIND[kind].label}`}>
  <span className="wd-id">
    <b>{head}</b><span className="wd-id-mid">{mid}</span><i>{tail}</i>
  </span>
  <CopyIcon className="wd-id-ico" aria-hidden />
</button>
// Announce through the ONE page-level polite region with a CHARACTER COUNT:
//   "Copied 40-character revision."   "Copied full sha256 digest, 71 characters."
// No clipboard API (HTTP / sandboxed iframe) -> select the full range instead and say so.
// A module-level token guarantees exactly ONE check on screen at a time.
```

## 3.3 `Numeric` — the character grid

**Owns:** every number's internal geometry. **Precision is published, never chosen.**

Five tracks, and nothing after the unit — that is what makes every column terminate on the
page's shared right edge:

```
[sign 1ch][int minmax(N,max-content)][point max-content][frac Nch][unit Nch]
                                     ^^^^^^^^^^^^^^^^^^
                                     THE ANCHOR is this boundary
```

```css
.numx{
  display:inline-grid;
  grid-template-columns: 1ch minmax(var(--numx-int,4ch),max-content) max-content var(--numx-frac,0ch) var(--numx-unit,2ch);
  align-items:baseline;
  font-size:var(--fs-4);font-weight:var(--fw-value);line-height:var(--lh-4);letter-spacing:0;
  white-space:nowrap;
  font-variant-numeric:lining-nums tabular-nums;
  font-feature-settings:"tnum" 1,"lnum" 1;
}
.numx-s{grid-column:1;text-align:right;}   /* - + <  — costs no digit slot */
.numx-i{grid-column:2;text-align:right;}
.numx-p{grid-column:3;}                     /* the browser measures the glyph: no constant */
.numx-f{grid-column:4;text-align:left;}
.numx-u{grid-column:5;padding-left:1ch;color:var(--ink-3);
        font-size:var(--fs-6);font-weight:var(--fw-support);font-variant-numeric:normal;}

.numx.is-breach,.numx.is-breach>*{color:var(--bad);}   /* server verdict only */
.numx.is-stale >:is(.numx-s,.numx-i,.numx-p,.numx-f){box-shadow:0 1px 0 0 var(--warn);}
.numx-dash{grid-column:2;text-align:right;color:var(--ink-3);font-weight:var(--fw-support);}
.numx-reason{grid-column:1/-1;text-align:right;color:var(--ink-3);
  font-size:var(--fs-6);font-weight:var(--fw-support);white-space:nowrap;}
```

**Laws:**
1. **One column, one unit, one precision.** `1.2 s` in an `ms` column reads as *smaller* than
   `950`. The shipped `duration()` helper switches units mid‑column — that is a lie told by a
   formatter.
2. **Precision is published** (venue `pair_decimals` / `tick_size`). Rendering BTC at 8dp when
   the venue publishes 2dp fabricates six digits.
3. A column whose precision is **per‑instrument** forfeits the decimal‑anchor claim **in its own
   header** (`per instrument · ragged fraction`).
4. Below resolution renders `<0.1` with `<` in the **sign** track. Never `0`.
5. **Absence: dash XOR reason, never both.** `unknown` → dash alone (no reason exists).
   `unavailable` / `failed` / `gone` → the reason alone, right‑aligned to the shared edge.
6. **No injected characters** — no `U+2007`, no NBSP padding, no `content:` in a selection.
   Selecting a cell yields exactly `312.4ms`. This page exists so an operator can paste
   evidence into an incident ticket.

## 3.4 `DataRow` — the dense operational row

```
[8px mark][16px glyph][name 1fr][value 9ch][age 10ch]
                       ↳ reason line spans cols 3..5 on row 2
```

```css
.wd-table{width:100%;table-layout:fixed;border-collapse:collapse;font-family:var(--font);}
.wd-table :where(th,td){padding:var(--sp-3) var(--sp-5);vertical-align:top;text-align:left;}
.wd-table :where(th,td):first-child{padding-inline-start:0;}
.wd-table :where(th,td):last-child {padding-inline-end:0;}
.wd-table th{white-space:nowrap;}                       /* a head must never wrap */
.wd-table :where(th,td).wd-col-num{text-align:right;}   /* MUST come after the base rule */

.wd-row{min-height:var(--row-h);border-bottom:1px solid var(--line);}
.wd-row:last-child{border-bottom:0;}
@media (hover:hover) and (pointer:fine){ .wd-row:hover{background:var(--hover);} }  /* NO transition */
.wd-row[aria-selected="true"]{background:var(--tile);box-shadow:inset 2px 0 0 var(--line-strong);}

/* THE HONEST-HEIGHT MECHANISM — min-height + an explicit first track.
   `height` puts the reason line in an implicit track that OVERFLOWS the row. */
.wd-row-grid{display:grid;grid-template-rows:var(--row-h) auto;min-height:var(--row-h);}
.wd-why{grid-row:2;grid-column:3/-1;min-height:var(--row-h-tight);
  color:var(--ink-2);font-size:var(--fs-5);font-weight:var(--fw-support);line-height:var(--lh-5);}

/* the change/advance gutter — hueless, reserved, polarity INVERTED */
.wd-mark{inline-size:2px;block-size:12px;
  margin-inline:calc((var(--gutter-mark) - 2px)/2);
  border-radius:1px;border-inline-start:2px dashed var(--ink-3);
  opacity:0;transition:opacity var(--mo-decay) var(--mo-out);}
.wd-mark[data-advance="wedged"]{opacity:1;transition-duration:var(--mo-instant);}
```

**The row's thesis, unchanged from `data-row` but re‑based on `--row-h`:**
a row that **cannot prove itself is taller**, because it is carrying the reason. Height is an
honesty signal no configuration can suppress. A healthy table is a flat wall of 28px rows; an
unhealthy one physically grows in proportion to how much is wrong.

**The advance mark's predicate** (from `motion`, entirely server‑side):

```
advancing        now - lastAdvanceAtMs <= 3 x p50(this row's own 21-sample cadence)  -> NO MARK
wedged           heartbeat FRESH but advance older than that threshold                -> DASHED MARK
cadence-unknown  fewer than 5 samples  -> no mark; cell reads "Advance cadence unknown (2 of 5)"
clock-skewed     freshnessState CLOCK_SKEWED -> no mark; "Clock skewed — advance not computable"
```

The domain already says a heartbeat is not proof: `model.ts:2266` enforces
`OWNER_MEANINGFUL_ADVANCE_REQUIRED`. This renders that invariant as ink.

## 3.5 `FieldPair` — two-tier label/value

```css
.wd-fields{container-type:inline-size;container-name:wd-fields;
  display:grid;grid-template-columns:minmax(0,1fr);align-items:start;
  column-gap:0;row-gap:var(--sp-4);margin:0;}
.wd-field{display:grid;grid-template-columns:minmax(0,1fr) auto auto;
  align-items:baseline;column-gap:0;row-gap:var(--sp-1);min-width:0;}
.wd-field-body{display:grid;grid-template-columns:subgrid;grid-column:1/-1;margin:0;}

@container wd-fields (min-width:320px){         /* content-measured, not a round number */
  .wd-fields{grid-template-columns:auto minmax(0,1fr) auto auto;row-gap:var(--sp-3);}
  .wd-field{grid-column:1/-1;grid-template-columns:subgrid;}
  .wd-field-label{grid-column:1;grid-row:1;padding-inline-end:var(--sp-5);}
  .wd-field-body {grid-column:2/-1;grid-row:1;grid-template-columns:subgrid;}
}
.wd-field-label{/* .wd-t3 */ overflow-wrap:break-word;}   /* NEVER ellipsised */
.wd-field-value{/* .wd-t4 */}
.wd-field-value.wd-num{display:inline-block;min-inline-size:var(--wd-digits,auto);text-align:right;}
.wd-field-note {/* .wd-t5 */ overflow-wrap:anywhere;}      /* WRAPS. Never clamped away. */
.wd-field[data-proof="qualified"] .wd-field-value{color:var(--ink-2);}
```

**Three states only** — `direct` (proven, `--ink-1`), `qualified` (real number, unclean
provenance, `--ink-2`, **note structurally required**), and *no value at all* → `<StatusChip>`
renders **in the value's own cell**.

`qualified` deliberately **merges** stale, derived and substituted: at this element's altitude
they are the same fact — *the number is real, its provenance is not clean* — and they differ in
the only channel that can carry the difference at reading distance, **the sentence**.

**The jitter lock:** `tabular-nums` equalises per‑glyph advance, **not string width when the
digit count changes**. `9.8 → 12.4 → 112.4` slides `ms` sideways on a 1 Hz tick.
`min-inline-size` from the projection's **declared** display width fixes it.

**No `<input>`, no commit, no dirty flag, no disabled control.** This app is
`preview → confirm → submit → durable readback`; an Enter‑commits field would be a lie about
the control plane.

## 3.6 `Button` — the action system

**The Label Law:** *a control's label AND its accessible state must both describe what pressing
it does. If pressing does something different, it is a DIFFERENT CONTROL.*

```css
.wdb{
  --wdb-fill:var(--panel); --wdb-edge:var(--line-2); --wdb-ink:var(--ink-2);
  --wdb-edge-style:solid;
  position:relative;display:inline-flex;align-items:center;justify-content:center;
  gap:var(--sp-3);min-height:var(--ctl-md);padding:0 var(--sp-5);
  border:1px var(--wdb-edge-style) var(--wdb-edge);border-radius:var(--r-pill);
  background:var(--wdb-fill);color:var(--wdb-ink);
  font-family:var(--font);font-size:var(--fs-4);font-weight:var(--fw-value);line-height:var(--lh-4);
  font-variant-numeric:lining-nums tabular-nums;white-space:nowrap;user-select:none;
  transition:background-color var(--mo-fast) var(--mo-out),
             border-color     var(--mo-fast) var(--mo-out),
             color            var(--mo-fast) var(--mo-out),
             transform        var(--mo-fast) var(--mo-out);
}
.wdb--sm{min-height:var(--ctl-sm);padding:0 var(--sp-4);}
.wdb--lg{min-height:var(--ctl-lg);padding:0 var(--sp-6);}
.wdb--icon{width:var(--ctl-md);padding:0;gap:0;border-radius:var(--r-sm);}  /* square, not a circle */

/* HIERARCHY FROM FILL ALONE. Geometry and weight identical at every level. */
.wdb--primary    {--wdb-fill:var(--cta-bg);--wdb-edge:transparent;--wdb-ink:var(--cta-fg);}
.wdb--secondary  {}
.wdb--tertiary   {--wdb-fill:transparent;--wdb-edge:transparent;--wdb-ink:var(--ink-3);}
.wdb--destructive{--wdb-edge:color-mix(in srgb,var(--bad) 42%,var(--line-2));--wdb-ink:var(--bad);}
.wdb--restorative{--wdb-edge:color-mix(in srgb,var(--ok)  38%,var(--line-2));--wdb-ink:var(--ok);}

/* non-actionable RECEDES VIA SUNKEN FILL + DASHED EDGE. Ink stays at full contrast.
   A washed-out control is indistinguishable from a crashed render. */
.wdb[aria-disabled="true"]{--wdb-fill:var(--tile);--wdb-edge:var(--line-strong);
  --wdb-ink:var(--ink-2);--wdb-edge-style:dashed;cursor:not-allowed;}
@media (hover:hover){
  .wdb:not([aria-disabled="true"]):not(.is-pending):hover{background:var(--hover);border-color:var(--line-strong);color:var(--ink-1);}
  .wdb[aria-disabled="true"]:hover{background:var(--wdb-fill);border-color:var(--wdb-edge);color:var(--wdb-ink);}
}
.wdb:not([aria-disabled="true"]):not(.is-pending):active{transform:scale(.98);}

/* armed destructive: fill flips, LABEL NEVER CHANGES, and it becomes the ONLY
   filled object in the cluster (Grafana's pairing rule, enforced not spaced) */
.wdb--destructive.is-armed{--wdb-fill:var(--bad-solid);--wdb-edge:transparent;--wdb-ink:var(--on-solid);--wdb-edge-style:solid;}
.wdb-cluster:has(.is-armed) .wdb:not(.is-armed){--wdb-fill:transparent;--wdb-edge:transparent;--wdb-ink:var(--ink-3);}

/* in-flight: label width RESERVED (visibility:hidden, not display:none) */
.wdb.is-pending>:is(.wdb-glyph,.wdb-label){visibility:hidden;}
.wdb-spin{position:absolute;inset:0;margin:auto;width:12px;height:12px;
  border:1.5px solid color-mix(in srgb,currentColor 24%,transparent);border-top-color:currentColor;
  border-radius:50%;opacity:0;pointer-events:none;}
.wdb.is-pending>.wdb-spin{opacity:1;animation:wdb-spin var(--mo-spin) linear infinite;}
@keyframes wdb-spin{to{transform:rotate(360deg);}}
@media (prefers-reduced-motion:reduce){
  .wdb{transition:none;} .wdb:active{transform:none;}
  /* rotation KEPT: it is the only evidence a mutation is in flight */
  .wdb.is-pending>.wdb-spin{opacity:1;animation-duration:1.2s;}
}
```

**Gate model:**

| gate | renders | `aria-disabled` |
|---|---|---|
| `ready` | fires on press | no |
| `preview-required` | **the Preview control**, correctly labelled, fully enabled | **no** |
| `unknown` / `unavailable` / `blocked-by-sibling` | sunken + dashed, reason in a visible note | **yes** |
| `incomplete` | the one legitimate native `disabled` | native |

**Severity ladder, implemented:** `low` → renders as *secondary*, not red, does not arm.
`med` → arm in place; press 1 sets `.is-armed` + a `role="alert"` note with the consequence and
a 5s countdown; press 2 fires; Escape or focus leaving the **cluster** cancels.
`high` → **the type will not compile without `onRequestConfirm`.**

## 3.7 `Toggle` — control bound to server readback

**It is not a toggle.** `aria-checked` carries **one** boolean; this control has **two** that
may disagree (`currentDesiredValue`, `currentEffectiveValue`). A one‑bit channel cannot carry a
two‑bit fact, so `role="switch"` is unrepresentable — a screen reader would announce
"Kill switch, switch, on" while the machine is CLEAR.

A **non-interactive readout rail** + **explicit verb buttons**:

```css
.wdt-rail{position:relative;width:60px;height:20px;   /* 3:1; travel = 2h EXACTLY, borders cancel */
  border:1px solid var(--line-2);border-radius:var(--r-sm);}
.wdt-rail[data-lease="expired"],.wdt-rail[data-lease="synthetic"]{border-style:dashed;}
.wdt-mark{position:absolute;top:50%;inset-inline-start:var(--sp-1);
  width:14px;height:14px;border-radius:var(--r-sm);translate:var(--wdt-x,0) -50%;
  transition:translate var(--mo-base) var(--mo-out);}
.wdt-mark--effect{background:var(--ink-1);}            /* pure f(currentEffectiveValue) */
.wdt-mark--intent{border:1.5px solid var(--ink-1);}    /* drawn ONLY on disagreement */
[data-intent-held="staged"] .wdt-mark--intent{border-style:dashed;}  /* not yet at the server */
[data-effect="far"] .wdt-mark--effect{--wdt-x:40px;}
[data-intent="far"] .wdt-mark--intent{--wdt-x:40px;}
[data-effect="unknown"] .wdt-mark--effect{display:none;}  /* NO mark. Never parked mid-travel. */
[data-mounted="false"] .wdt-mark--effect{transition:none;}
```

**Four silhouettes for four categorically different facts:**
solid rail + marks = live, in lease · dashed rail + marks = lease expired, **mark stays solid
and full‑ink at its last proven position** · dashed rail + **no marks** = AMBIGUOUS (there is a
control, we commanded it, we cannot read the result) · **no rail at all** = UNWIRED (there is
no control here).

**Freshness is a lease, not an age:**
`proofExpired = envelope.evaluatedAtMs >= Date.parse(opsReadback.validUntilUtc)` — two
**server‑stamped** numbers. The component never calls `Date.now()` outside the preview
countdown, and that countdown is explicitly *not* evidence.

**One verb when the lease is valid; two when it is not** (Home Assistant's rule fired on Home
Assistant's precondition), **none** where no command is legal. The ellipsis is load‑bearing:
`Engage…` opens a preview, it does not engage.

## 3.8 `Select` — the cadence reconciliation ledger

Two headed columns, not one number with a caption:

```
SOURCE            REQUESTED      EFFECTIVE
Market prices     5s ▾           4.9s
  └ reason line spanning cols 2..4
```

`REQUESTED` is a preference (always known, carries the borderless combobox).
`EFFECTIVE` is a **measurement** — it may render a number **only** when
`observedGeneration === requestGeneration && completions >= 2`. **Two**, not one: an interval
is a *difference* between timestamps, so one sample yields none. That arithmetic is why
`measuring` exists as a state separate from `accepted`.

**There is no code path from `requestedSec` into the EFFECTIVE cell.** Verify by grep.

```css
.wdc-row{display:grid;
  grid-template-columns: 2px minmax(0,1fr) 52px 40px var(--sp-7);
  grid-template-rows:var(--row-h);align-items:center;
  padding:0 var(--sp-6);border-top:1px solid var(--line);}
.wdc-rail{grid-row:1/-1;align-self:stretch;width:2px;background:transparent;}
.wdc-row[data-changed="true"] .wdc-rail{background:var(--held);}  /* "a person set this" */
.wdc-trigger{display:grid;grid-template-columns:var(--sp-4) 40px;align-items:center;gap:var(--sp-2);
  height:var(--ctl-sm);border:1px solid transparent;border-radius:var(--r-sm);
  background:transparent;color:var(--ink-1);font:inherit;text-align:right;}
@media (hover:hover){.wdc-trigger:hover{border-color:var(--line-2);background:var(--hover);}}
.wdc-trigger[data-state="open"]{border-color:var(--line-strong);background:var(--hover);}
.wdc-eff{justify-self:end;color:var(--ink-1);}
.wdc-row[data-state="diverged"] .wdc-eff,
.wdc-row[data-state="throttled"] .wdc-eff{color:var(--warn);}
.wdc-why{grid-column:2/5;grid-row:2;padding-block:0 var(--sp-3);white-space:normal;}
```

The popover **must be portalled** — these rows sit inside `.healthx-frame { overflow: hidden }`
and z‑index cannot defeat a clip. Manual activation (APG permits automatic only when panels
display "without noticeable latency"; these re‑fetch). `tabIndex={selected ? 0 : -1}` per APG.

## 3.9 `Tabs`

Chrome‑free, indicator = a 2px accent segment **of the row's own hairline**, and a permanently
reserved 12px state gutter on **every** tab in **every** state.

```css
.wd-tabs{--tab-pad:var(--sp-5);
  position:relative;display:flex;align-items:stretch;gap:0;
  min-height:var(--ctl-lg);padding:0 var(--sp-2);
  box-shadow:inset 0 -1px 0 var(--line-2);overflow-x:auto;scrollbar-width:none;}
.wd-tab{position:relative;flex:none;display:inline-flex;align-items:center;gap:var(--sp-3);
  height:var(--ctl-lg);padding:0 var(--tab-pad);border:0;border-radius:var(--r-sm);
  background:none;color:var(--ink-3);font:inherit;
  font-size:var(--fs-4);font-weight:var(--fw-value);   /* CONSTANT in every state */
  white-space:nowrap;cursor:pointer;
  transition:color var(--mo-fast) var(--mo-out);}
.wd-tab::after{content:"";position:absolute;left:var(--tab-pad);right:var(--tab-pad);bottom:0;
  height:2px;border-radius:0;background:transparent;}   /* ONE value drives pad AND inset */
.wd-tab[aria-selected="true"]{color:var(--ink-1);}
.wd-tab[aria-selected="true"]::after{background:var(--focus-ring);}
@media (hover:hover) and (pointer:fine){.wd-tab[aria-selected="false"]:hover{color:var(--ink-2);}}
/* the state the extra keystroke buys: where Enter will land */
.wd-tab[aria-selected="false"]:focus-visible::after{background:currentColor;}
```

**The gutter is what licenses the tab bar to exist.** NN/g's harm condition for tabs is that
users must *switch* to compare. The gutter renders the STATE of all regions simultaneously and
hides only the DETAIL. **`.wd-tabs` without a state gutter must not be used for evidence‑gated
regions** — strip it and the correct answer is one long scrolling page.

**Manual activation** (panels re‑fetch). **Two overflow pins**, absolutely positioned as
**siblings outside** the tablist (a focusable non‑tab child makes AT announce "tab 6 of 5"), so
a non‑healthy tab scrolled off either edge is reachable. Plus an unconditional 24px edge mask,
because a row that scrolls with zero indication that it scrolls is its own defect.

## 3.10 `MetricCell` — the headline band

Three shared subgrid rows: name (T3) / reading (T1) / warrant (`<StatusChip>`), baseline‑aligned.

```css
.mx{container-type:inline-size;container-name:mx;}
.mx-band{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  grid-template-rows:auto auto auto;row-gap:0;
  border-block:1px solid var(--line-2);background:var(--panel);}
.mx-cell{grid-row:span 3;display:grid;grid-template-rows:subgrid;align-items:baseline;
  min-width:0;padding:var(--sp-6);border-radius:0;background:transparent;}
.mx-cell + .mx-cell{border-inline-start:1px solid var(--line-2);}
@supports not (grid-template-rows:subgrid){
  .mx-cell{display:flex;flex-direction:column;}
  .mx-name{min-block-size:var(--lh-3);} .mx-reading{min-block-size:var(--lh-1);} .mx-warrant{min-block-size:var(--lh-4);}
}
.mx-num{display:inline-block;min-inline-size:var(--mx-digits,auto);text-align:right;}
.mx-reading[data-reading="absent"]{color:var(--ink-mute);}
/* THE INSIGHT: when there is no number, the CONSEQUENCE takes the reading register */
.mx-reading[data-reading="reason"]{
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;
  color:var(--ink-2);font-size:var(--fs-5);font-weight:var(--fw-support);
  line-height:var(--lh-5);letter-spacing:0;white-space:normal;}
.mx-reading[data-tone="warn"]{color:var(--warn);}
.mx-reading[data-tone="bad"] {color:var(--bad);}
@container mx (max-width:1120px){ .mx-band{grid-template-columns:repeat(2,minmax(0,1fr));} }
@container mx (max-width:620px) { .mx-band{grid-template-columns:minmax(0,1fr);} }
```

**PRECONDITION, and it is the only way to break the rail:** a subgrid's block padding insets
its tracks, so **every cell's `padding-block` must be identical.**

**Band-level facts** — the layer that stops four cells reciting a reason the server never sent.
`transport-failed` (Grafana's *Error*, not *No Data*) renders four em‑dashes, every chip
`UNKNOWN`, and **one spanning note** replacing all four warrants. It is never derived from four
coincident cell failures — that is `shared-cause`, a different sentence.

## 3.11 `InfoRow` — guidance on a fixed gutter

Placed **inside the surface it describes**, never at the page foot (NN/g, Polaris and Geist all
say the message goes next to its source).

```
[16px inset][16px glyph][12px gap][sentence 1fr][12px gap][provenance 12ch][16px inset]
                                   ^ text edge = 44px on EVERY row
```

```css
.gdx-list{display:grid;
  grid-template-columns:var(--sp-6) var(--gutter-icon) var(--sp-5) minmax(0,1fr) var(--sp-5) 12ch var(--sp-6);
  margin:0;padding:0;list-style:none;font-family:var(--mono);}  /* `ch` must resolve in MONO */
.gdx-row{position:relative;display:grid;grid-column:1/-1;grid-template-columns:subgrid;
  align-items:start;padding-block:var(--sp-3);padding-inline:0;}  /* NEVER set: subgrid eats it */
.gdx-row + .gdx-row::before{content:"";position:absolute;inset-block-start:0;
  inset-inline:44px 0;height:1px;background:var(--line);}
.gdx-glyph{grid-column:2;align-self:start;display:grid;place-items:center;
  width:var(--gutter-icon);height:var(--lh-5);color:var(--ink-3);}
.gdx-body{grid-column:4;min-width:0;font-family:var(--font);}
.gdx-say{/* .wd-t5 */ text-wrap:pretty;overflow-wrap:break-word;}
.gdx-why{/* .wd-t6 */ margin-top:var(--sp-1);}
.gdx-prov{grid-column:6;justify-self:end;direction:ltr;unicode-bidi:isolate;
  color:var(--ink-3);font-family:var(--mono);font-size:var(--fs-6);
  font-weight:var(--fw-value);line-height:var(--lh-6);
  font-variant-numeric:tabular-nums;white-space:nowrap;}
.gdx-prov[data-prov="stale"]{color:var(--warn);}
.gdx-row[data-register="binding"]{--gdx-ink:var(--ink-1);}
```

**Severity is replaced by two REGISTERS distinguished by grammatical mood and ink — zero hue:**

- **binding** — imperative, 2nd person: *"Don't retry a control that returned a timeout."*
  `--ink-1`.
- **advisory** — declarative or predictive: *"Mutations queued while the primary lane is
  draining expire after 90 s."* `--ink-2`.

Mood is **text**, which satisfies WCAG 1.4.1 for the **eye** — a screen‑reader‑only severity
word does not. It survives greyscale, translation and print, and costs zero pixels.

**Provenance has no absent case.** measured → an age · measured past window → the same age in
`--warn` · asserted → a source ref · unknown/unavailable → the `nk` mark with a visible reason
code. `na` is excluded **at the type level**: if a sentence claims something about the system,
something proves it.

**Max 3 rows per host surface.** A 4th throws in development. `3 × 38px` is the most guidance
may cost inside a panel body.

## 3.12 `UnknownState` — the four scales of absence

**SLOT** (three treatments, zero words):

```css
.st-none{/* inherits — a measured empty set is a COMPLETE ANSWER, no demotion */}
.st-void,.st-na{display:inline-block;width:3ch;height:.7em;vertical-align:baseline;}
.st-void{border-bottom:1px dotted var(--ink-3);}   /* the slot exists and is unwritten */
/* .st-na has NO rule: NOT-APPLICABLE is the ONLY visually blank state — the exact
   inversion of what ships everywhere else. Its sr-only text says "Not applicable." */
```

3ch is deliberately narrower than any real value (it can never imply magnitude) and
**identical in every column**, so the rules align into a countable grid — the page's blindness
becomes a visible regular structure instead of noise.

**COLUMN** — when 100% of a column's primary slots are one kind, the `columnheader` grows a
second line: `Not measured · all 15`. **In `role=table`, AT re‑announces the column header with
every cell**, so all 60 dark cells get their reason with **zero extra DOM, zero ARIA and zero
interaction**. That single mechanism is why there is no tooltip and no drawer.

**100% or silence.** A header claiming "unavailable" while 14 of 15 rows are dark lies about
the fifteenth.

**TABLE** — one roll‑up line, aggregated on `rootCauseComponentId` then failure *kind*, ≥3 rows,
hard cap of exactly one line.

**PANEL** — left‑aligned, `min-height` from a declared **row count**, kind line → headline →
consequence + recovery (≤52ch) → evidence line → at most one tertiary action.
`role="status"`, **not** `aria-live` (a dozen simultaneous announcements on a wide outage is a
flood). **No illustration, ever.**

## 3.13 `EmptyState` — the unmet measurement contract

The block's subject is not the missing data but **what this panel promised to measure, against
which window, on whose authority, and what is at stake while it cannot.**

Mandatory row set, fixed order:
`EXPOSURE · WINDOW · LAST PROOF · SOURCE · UNMEASURED FOR · NEXT · REASON · ACTION`

```css
.wd-empty{display:grid;align-content:start;justify-items:start;   /* NEVER place-items:center */
  gap:var(--sp-5);padding:var(--sp-5) var(--sp-6) var(--sp-6);
  text-align:left;color:var(--ink-3);}
.wd-empty[data-flush="true"]{padding-block-start:0;}
.wd-empty .wd-field[data-obligation="exposure"][data-exposure="active"] .wd-field-value{
  padding-inline:var(--sp-2);border-radius:var(--r-sm);
  background:var(--bad-solid);color:var(--on-solid);}   /* the ONLY hue an empty panel may carry */
.wd-empty-byline{display:flex;flex-wrap:wrap;column-gap:var(--sp-4);row-gap:var(--sp-1);
  width:100%;padding-block-start:var(--sp-4);border-block-start:1px solid var(--line);
  color:var(--ink-3);font-family:var(--mono);font-size:var(--fs-6);
  font-weight:var(--fw-support);line-height:var(--lh-6);
  font-variant-numeric:lining-nums tabular-nums;user-select:text;}
@media print{ .wd-empty-action{display:none;} .wd-empty{break-inside:avoid;} }
```

**Exposure goes first, on evidence grounds:** the *query* failed; the *component record* is a
different object and usually still present. **Exposure is renderable precisely when nothing
else is.**

`ACTIVE` → the exposure value goes **solid `--bad`** (precedent: the house's own
`.sdx-tag.exposed`). `UNKNOWN` → the verdict chip escalates; the word stays hueless.
`NONE` (proven zero) → **hueless**.

**Control rule table** — two of four rows render **nothing**:

| operator can… | renders |
|---|---|
| cause it to populate | ONE secondary action, verb + noun |
| see why but not fix | ONE disclosure in the existing inspector |
| only wait on a clock | **no control** + `ACTION: NONE — CLOCK ONLY` |
| nothing, ever | **no control** + `ACTION: NONE — REQUIRES ROLE …` |

The `ACTION` row makes the refusal *legible* rather than merely absent.

## 3.14 `CoverageCounter` — the section header

The counter is an **exhaustive partition whose visible integers sum to the printed
population** — Kubernetes' `READY 3/5` shipped *with* `UP-TO-DATE` and `AVAILABLE`, because the
ratio does not say which are missing or why.

```
▸  Network lanes   8 lanes  5 proven  1 withheld  1 failing  1 unknown        1s heartbeat
   ◐ Impaired   3 lanes past heartbeat · collector 7f3a…b219 offline since 09:41      410ms
```

```css
.wd-sec{--sec-track:96px;}
.wd-sec-head{display:grid;
  grid-template-columns:var(--gutter-icon) 224px calc(5 * var(--sec-track)) minmax(0,1fr) var(--col-age);
  grid-template-rows:auto auto;column-gap:var(--sp-5);row-gap:var(--sp-1);align-items:center;
  min-height:var(--row-h-head);padding-block:var(--sp-3);padding-inline:0;
  background:var(--panel);border-block-end:1px solid var(--line-2);}
.wd-sec-count{grid-column:3;display:grid;grid-template-columns:repeat(5,var(--sec-track));
  column-gap:0;align-items:baseline;}     /* the TRACK is the separation — no middots */
.wd-sec-fig{display:grid;grid-template-columns:4ch auto;column-gap:var(--sp-2);align-items:baseline;}
.wd-sec-fig .n{/* .wd-t4 + .wd-num */ text-align:right;}
.wd-sec-fig .u{/* .wd-t6 */}
.wd-sec-fig[data-measured="false"] .n{color:var(--ink-mute);}   /* an em dash, never 0 */
.wd-sec-hb{grid-column:5;width:var(--col-age);text-align:end;white-space:nowrap;}
```

**Four classes, total over the ladder, `satisfies Record<Rung, CoverageClass>` with no default
branch:** `proven` · `withheld` (unenforced, held, waiting) · `failing` (impaired, failed) ·
`unknown` (absent).

`unenforced` (shadow / dry‑run) counting as **proven** is the worst lie available — it claims
an authority the system is deliberately not exercising.

**The vertical gate:** the declared heartbeat sits on row 1 at the right edge; the measured
oldest‑member age sits **directly beneath it** in the same `--col-age` track. Both tabular,
both in the section's declared unit. The comparison is vertical and needs **no hue**.

Age is `max(member ages)` — **a section is only as fresh as its stalest member**. Staleness
demotes `proven → absent`, never toward a failure.

**Default collapse is derived, never chosen:** `counts.proven === population && population > 0`.
So *"the page looks fine"* acquires a precise meaning — everything you cannot see is proven, and
every section you can see has something to say. **A collapsed section flipping out of
all‑proven auto‑expands**: the page physically opens the thing that broke. Stronger than any
wash, costs no duration, survives reduced motion. One‑way; deferred while a pointer or focus is
inside the region.

## 3.15 `Sparkline` — commitment-anchored micro history

**It does not plot latency. It plots distance from a declared commitment.**

```
ratio = (v - good) / (fuse - good)
```

`good` defaults to 0, reproducing plain `v/fuse` for a ceiling lane. A **recovery** lane
declares `good:100, fuse:90`, and 60% yields `(60-100)/(90-100) = 4.0` — clipped, capped,
unmissable. One geometry, both directions, no branch. Plotting `v/fuse` would have drawn 60%
recovery as a short, calm column: **a healthy render of a broken lane.**

**No declared fuse → no anchored scale → NO CHART.** Such a lane gets a deliberately weaker
`unscaled` mark and may not borrow the commitment‑scaled one's authority.

```css
.wdspark{--col:var(--sp-4);--gap:var(--sp-2);--h:var(--sp-7);
  display:block;flex:none;
  inline-size:calc(var(--n) * (var(--col) + var(--gap)) - var(--gap));  /* n=6 -> 68px */
  block-size:20px;}
.wdspark-col           {fill:var(--ink-3);}
.wdspark-col.is-latest {fill:var(--ink-2);}     /* ONE step: "this is now" */
.wdspark-col.is-breach {fill:var(--bad);}
.wdspark-slot          {fill:var(--ink-3);}     /* expected, NOT received — half width */
.wdspark-fuse          {fill:var(--ink-3);}     /* painted LAST, so it CUTS the column it caught */
.wdspark-evidence-end  {fill:var(--warn);}
.wdspark:not([data-wiring="LIVE"]) .wdspark-col{fill:none;stroke:var(--ink-3);stroke-width:1;}
```

Geometry: fuse at 12 of 18 plot px (ratio 1.00), clip at 1.5×. The fuse is painted **last**, so
a breaching column is visibly **cut by the line it broke**. Missing samples keep their slot as
a half‑width stub; slots that predate the **retention horizon** draw **nothing at all** and are
excluded from the n‑of‑m count — *a slot that could never be filled is not a missing sample,
and the mark must not blame the pipeline for a policy.*

**In‑budget has no colour.** Warn is spent on the evidence‑end rule only — never on burn rate,
because `--warn` already means "the evidence is old" one cell away. Burn thickens the fuse
1px → 2px: **weight, not hue**.

Warn fires only on `shortWindowBurn > 1 AND longWindowBurn > 1`. Two states follow whose
**correct rendering is nothing**: *unconfirmed spike* (short only) and *recovering* (long only).

**Wiring beats posture.** `ProjectedSource.wiring` has **no `LIVE` member**, so every lane
renders hollow today. That is correct, and it is the pressure needed. *A hollow page is not a
bug report; it is the app telling the truth about itself.*

## 3.16 `GraphNode` — dependency topology

**Doubt materialises the container.** A `READY` node draws **no box at all** — fourteen proven
components render as fourteen bare labels on an empty canvas, and the instant one stops proving
itself a box appears under it.

```css
.wd-topo-node{
  position:absolute;left:var(--x);top:var(--y);
  display:grid;grid-template-columns:var(--gutter-icon) minmax(0,1fr);
  column-gap:var(--sp-4);align-items:center;
  width:176px;height:48px;                     /* 48 = 16 + 2 + 16 + 2*6 + 2*1 border */
  padding:var(--sp-3) var(--sp-4);
  border:1px solid transparent;                /* PRESENT in every state: never reflows */
  border-radius:var(--r-sm);background:var(--surface,transparent);
  color:var(--ink-1);text-align:left;}
.wd-topo-node[data-state="READY"]{--surface:transparent;}   /* NO CONTAINER AT ALL */
.wd-topo-node[data-state="UNKNOWN"],
.wd-topo-node[data-state="UNAVAILABLE"],
.wd-topo-node[data-state="NOT_CONFIGURED"]{--surface:var(--tile);}
.wd-topo-node[data-state="OWNER_GATED"]{--surface:var(--held-tint);border-color:color-mix(in srgb,var(--held) 26%,transparent);}
.wd-topo-node[data-state="DEGRADED"]  {--surface:var(--warn-tint);border-color:color-mix(in srgb,var(--warn) 28%,transparent);}
.wd-topo-node[data-state="BLOCKED"]   {--surface:var(--bad-tint); border-color:color-mix(in srgb,var(--bad)  28%,transparent);}

/* THE WIRE REPORTS THE CHANNEL, NEVER THE COMPONENT */
.wd-topo-wire{fill:none;stroke:var(--ink-3);stroke-width:1.5px;}          /* required   */
[data-contract="optional"] .wd-topo-wire{stroke-width:1px;}               /* NO opacity */
[data-proof="unproven"]    .wd-topo-wire{stroke-dasharray:4 4;}
[data-proof="severed"]     .wd-topo-wire{stroke:var(--bad);}
.wd-topo-casing{fill:none;stroke:var(--panel);stroke-width:5.5px;stroke-linejoin:round;}
[data-path="lit"] .wd-topo-wire{stroke-width:2.5px;}   /* PROMOTE, never dim */
```

**The glyph gutter IS the wire's in-port** — every incoming proof channel terminates on the
state mark. The thesis rendered as geometry: *proof arrives at the state.*

**Paint order is a contract, not document order:** pass 1 every casing, pass 2 every neutral
line + marker, pass 3 every **severed** line last. In SVG there is no "upper", only "later" —
**a fault wire is never the lower edge of a crossing.**

**No opacity change anywhere.** A dependency wire is the definitional "graphical object required
to understand the content"; dimming an `--ink-3` wire to any value under 1.0 puts it below the
3:1 floor. Emphasis **promotes the doubt path**; nothing is ever hidden.

**Degraded wires stay neutral.** A slow channel is a *proven* channel; impairment is a property
of the component, which has a chip. That collapse is what leaves the canvas **one hue**.

**One DOM, two presentations.** An `<ol>` in topological order, each `<li>` carrying identity,
chip, warrant and its dependency list **as real text**. ≥1040px it is absolutely positioned with
an `aria-hidden` SVG beneath; below that the positioning drops and the same list is a rail
ledger. The dependency list stays in the DOM at every width, clipped with `.sr-only`, **never
`display:none`.**

## 3.17 `OwnerRow` — the ownership ledger

`owner` is not a field, it is the **structure**: a CODEOWNERS‑shaped source location
(`server/src/engine/**`) shared by ~2.3 components each, so it is printed **once per group**.

**Grouping is gated by arithmetic, not taste:** group when `components / distinct owners >= 2`.

```css
.owner-ledger{display:grid;
  grid-template-columns:var(--gutter-mark) minmax(208px,1.6fr) 108px minmax(160px,.9fr) minmax(240px,1.2fr);
  container-type:inline-size;container-name:owner;overflow:clip;   /* clip, NOT hidden */
  border:1px solid var(--line-2);border-radius:var(--r-sm);background:var(--panel);}
.owner-head,.owner-group,.owner-row{display:grid;grid-column:1/-1;
  grid-template-columns:subgrid;align-items:center;}
.owner-group{position:sticky;top:var(--row-h-head);z-index:1;min-height:var(--row-h-tight);
  background:color-mix(in srgb,var(--tile) 62%,var(--panel));border-bottom:1px solid var(--line);}
.owner-row{min-height:var(--row-h);border-bottom:1px solid var(--line);}
.owner-rail{grid-row:1/-1;align-self:stretch;width:2px;background:transparent;}
.owner-row[data-changed="true"] .owner-rail{background:var(--held);}
.owner-reason{grid-column:2/-1;min-height:var(--row-h-tight);
  padding-inline-start:calc(var(--sp-6) + var(--gutter-icon) + var(--sp-2));}
```

**The load-bearing rule — evidence class gates the state BEFORE render:**

```ts
if (state === 'READY' && truthClass !== 'proven') state = 'UNKNOWN';
```

**READY on SYNTHETIC_ONLY can no longer reach the renderer.** This is `StatusChip`'s own stale
rule generalised from **time** to **evidence class**. One line, and testable.

**Capability is a NOUN VALUE; warrant is a PREPOSITIONAL ATTESTATION.** `ProductCapability` and
`ProductTruthLabel` share the member `LIVE_PUBLIC`, so widening a column cannot stop two
adjacent cells reading "Live public". **Register** can:

> Basis Engine · Ready · **Live public** · *on wired evidence.*

Ten labels, ten phrases — `MISSING` ("evidence expected, absent") is not `UNKNOWN` ("evidence
class never established"); `UNAVAILABLE` ("channel unavailable") is not `BLOCKED` ("evidence
blocked"). All ten are hueless.

**Root-cause deduplication is structural:** the root row is `BLOCKED` (the only solid fill on
the page); every downstream row is `UNAVAILABLE` (hueless) with reason *"Downstream of Basis
Engine"*. One alarm, twenty attributions, and the twenty are **physically incapable of
shouting** because their tone has no fill.

## 3.18 `CardFrame` — the section frame

**There are no cards.** A section is a header row, one hairline, and content on the page canvas.

```css
.wdf-page{container-type:inline-size;container-name:wdf;
  display:grid;gap:calc(var(--sp-7) * 2);      /* the RATIO is in the source */
  padding-block:var(--sp-7) calc(var(--sp-7) * 3);}
.wdf-cluster{display:grid;gap:var(--sp-7);}     /* tight = 24, loose = 48 */
.wdf-cluster-label{/* .wd-t3 */ margin:0;}

.wdf-section,.wdf-section:hover{           /* explicit, named reset of .card */
  display:block;position:relative;background:transparent;
  border:0;border-radius:0;box-shadow:none;}
.wdf-section{scroll-margin-top:var(--sp-6);}   /* NOT calc(--header-h + …) */

.wdf-head{display:grid;
  grid-template-columns:minmax(0,1fr) max-content;align-items:center;
  column-gap:var(--sp-6);min-height:var(--ctl-lg);   /* a FLOOR, not a constant */
  padding-block:var(--sp-4);padding-inline:0;
  border-block-end:1px solid var(--line-2);}
.wdf-body{padding-block-start:var(--sp-5);padding-inline:0;}  /* CONTRACT: rows bleed to the gutter */
.wdf-body[data-measure="prose"]{max-width:var(--measure);}
.wdf-body[data-pending="true"]{--wde-reserve:calc(var(--wdf-rows,6) * var(--row-h));}

/* the ONE bounded surface: a region that MUTATES the system.
   margin and padding CANCEL EXACTLY, so contents stay on the page axis. */
.wdf-region{margin-inline:calc(var(--sp-5) * -1);padding:var(--sp-5);
  border-radius:var(--r-sm);background:var(--tile);}

.wdf-section:target .wdf-head::before{content:"";position:absolute;
  left:calc(var(--sp-5) * -1);top:var(--sp-4);bottom:var(--sp-4);
  width:2px;border-radius:var(--r-pill);background:var(--focus-ring);}
```

### The receipt — this element's own contribution

Every section header reserves **three fixed tracks, on every section, always**:

```css
.wdf-receipt{display:grid;grid-template-columns:13ch 18ch max-content;
  align-items:center;column-gap:var(--sp-6);
  font-size:var(--fs-6);font-weight:var(--fw-value);line-height:var(--lh-6);}
/* state (composes StatusChip) | source (mono, MIDDLE-truncated) | age (composes .numx) */

/* THE VETO: the chip ASSERTS; the frame REFUSES TO PAINT.
   Specificity 0,5,1 — no !important. A container that can only DOWNGRADE is
   exactly the right amount of power for a container to have. */
.wdf-head:not([data-source]) .wdf-receipt .wd-chip{color:var(--ink-3);}
.wdf-head:not([data-source]) .wdf-receipt .wd-chip-glyph{color:var(--ink-3);}
.wdf-head:not([data-source]) .wdf-source{color:var(--warn);}
```

**The hard limit, stated:** a stylesheet can refuse to **paint** a claim; it cannot refuse to
**write** one. No truth‑bearing word may live in `content:` — untranslatable, unselectable,
absent from the DOM. The word comes from `stateWord(claim, evidence)` in the component.

**Age format law** — ONE unit, INTEGER, max 3 digits (`<60→Ns`, `<100m→Nm`, `<100h→Nh`, else
`Nd`). Never `1h 04m`: mixed units put the unit glyph at three different x positions, so the
column right‑aligns and is **still unreadable as a column** — the exact failure L5 exists to
prevent.

## 3.19 `Motion` — the live-data layer

Four objects, and nothing else.

```css
/* 1. the advance mark — see §3.4 */
/* 2. the cadence rail — SIX states, every predicate a real method on createSettledPoll */
.mo-rail{position:relative;inline-size:72px;block-size:2px;
  border-radius:1px;background:var(--line-2);overflow:hidden;}
.mo-rail-fill{position:absolute;inset:0;background:var(--ink-3);
  transform:scaleX(0);transform-origin:left center;will-change:transform;}
[data-poll="awaiting"] .mo-rail::before,[data-poll="late"] .mo-rail::before{
  content:"";position:absolute;inset-block:0;inset-inline-start:0;width:2px;background:var(--ink-3);}
[data-poll="dead"] .mo-rail{background:none;border-block-start:2px dashed var(--ink-3);}
@keyframes moSeek{from{transform:translateX(-100%);}to{transform:translateX(500%);}}
[data-poll="initial"] .mo-rail-fill{inline-size:var(--sp-5);animation:moSeek var(--mo-seek) linear infinite;}
[data-visible="false"] .mo-rail-fill{animation-play-state:paused;}

/* 3. hover — ONE shared payload in the TOP LAYER (escapes overflow:hidden; z-index cannot) */
.mo-payload{position:fixed;position-anchor:--mo-active;
  position-area:block-end span-inline-end;position-try-fallbacks:flip-block,flip-inline;
  margin:var(--sp-2);opacity:0;translate:var(--mo-enter,0 -2px);
  transition:opacity var(--mo-fast) var(--mo-out),translate var(--mo-base) var(--mo-out),
             overlay var(--mo-base) allow-discrete,display var(--mo-base) allow-discrete;}
.mo-payload:popover-open{opacity:1;translate:0 0;}
@starting-style{.mo-payload:popover-open{opacity:0;translate:var(--mo-enter,0 -2px);}}
.mo-payload[data-source="keyboard"]{transition-duration:var(--mo-instant);}

@media (prefers-reduced-motion:reduce){
  .wd-mark{transition:none;}                    /* on/off — ZERO information lost */
  .mo-payload{transition:none;translate:0 0;}
  .mo-rail-fill{animation:none;}                /* JS renders "Next in Ns" */
}
```

**The rail is a stepped drain**, `steps(n)` where n = the interval in whole seconds. A sliding
bar implies continuous knowledge; we only know **whole elapsed seconds**. It reads as a clock,
costs 2–5 composited frames per cycle instead of ~120, and honesty and calm land on the same
implementation. It is a **single‑shot restart per settled poll**, never a loop — an infinite
animation keeps playing after the feed dies, and **a liveness indicator that lies is worse than
none. The animation IS the evidence.**

Six states, thresholds not chosen by anyone: `dead` is the poller's own `timeoutMs` (at
`timeoutMs` the request is aborted and there is no later); `late` is measured p95 RTT or
nothing.

**`data-held` is a separate attribute, orthogonal to `data-poll`**, so "the feed died while I
was holding" is representable — and that is the dangerous case.

**Order freeze:** hover or focus‑within sets `data-order-frozen`; reorders are **counted in the
header** and applied on leave. `onBlurCapture` defers to rAF and checks `relatedTarget`
containment, or ↑/↓ navigation reorders rows under the keyboard user. **Escalation:** a row
going critical while frozen still gets its mark **plus a header line** — suppressing that is
the case where the freeze causes the incident.

**Focus must survive the poll.** Rows keyed by stable `componentId`, never index, never
unmounted. If the active component **disappears** from the feed, `activeRowId` moves to the
nearest surviving row by prior index and the removal is announced.

## 3.20 The two shared kill switches

```css
@layer wd-kill, wd-motion;   /* for !important, EARLIER layers win: precedence DECLARED */
@layer wd-kill{
  [data-theme-switching] .watchdog,[data-theme-switching] .watchdog *{
    transition:none !important;animation:none !important;}
  .watchdog[data-instant] *,.watchdog[data-instant] *::before,.watchdog[data-instant] *::after{
    transition-duration:var(--mo-instant) !important;animation-duration:var(--mo-instant) !important;
    transition-delay:0s !important;animation-delay:0s !important;animation-iteration-count:1 !important;}
  @media (update:slow){ .watchdog *{transition:none !important;animation:none !important;} }
}
```

`[data-instant]` zeroes **delays too**, and the JS dwell timers read the attribute — otherwise
the escape hatch still races the 320ms arm timer.

**There is no universal `transition-property: none` backstop.** It is specificity roulette
against sibling files, and moving it into a low cascade layer does not help: **unlayered styles
beat every layer** for normal declarations, and `styles.css` is entirely unlayered. The correct
instrument is a **lint rule**, not a selector.

---

# §4 · THE COMPOSITION RULES

## 4.1 The page

```
<main class="watchdog wdf-page">           container-type: inline-size
  <header class="wdf-page-head">           T1 + T5 + tally + ONE live region
  <div class="wdf-cluster">                gap --sp-7 (24)
     <h2 class="wdf-cluster-label">        T3 uppercase eyebrow
     <section class="wdf-section">         NO container
     <section class="wdf-section">
  <div class="wdf-cluster">                gap between clusters: calc(--sp-7 * 2) = 48
     …
```

**Two tiers — cluster > section — and no third.** A section frame never contains another
section frame.

## 4.2 What stops 8 sections becoming a card grid

Five mechanisms, and only three of them are visual:

1. **No section draws a container.** No border, radius, fill, shadow or hover, in either theme,
   via an explicit named reset that covers every property `.card` sets. Eight cards means eight
   interior right edges, so **no numeric column on the page can ever share an x** — and on a
   comparing surface that is the entire job.
2. **The gap ratio is 2×, expressed as `calc()`.** Eight peers become four clusters of two.
   Rhythm falls out of **DOM nesting**, never `:nth-child`, so re‑ordering cannot produce an
   arbitrary gap. Tested: 1.5× loses (a 10px difference separated by 300–1,300px of table
   varies without encoding); 3× loses (pays ~180px of scroll to restate what the eyebrow says).
3. **One semantic device + one reinforcement per level, never two competing semantic devices.**
   The eyebrow *names* the cluster and the gap *reinforces* it; the title *names* the section
   and the hairline *reinforces* it. Same relation at both scales.
4. **The hairline is reinforcement, not structure.** Measured: `--line-2` is **1.24:1** light /
   **1.28:1** dark; `--line-strong` reaches only **1.44:1**. *No hairline in this house can
   reach 3:1, and no house token can make one.* So grouping is carried by type weight, the
   uppercase eyebrow and the gap ratio — all content‑contrast devices.
   **Shipped acceptance test: set `--wdf-rule: transparent`. The page MUST still parse into 4
   clusters and 8 sections.** If it does not, the design is wrong, not the token.
5. **Exactly one bounded surface per page**, and it marks the region that **mutates the
   system** — `--r-sm` on `--tile`, with `margin-inline` and `padding` cancelling exactly so its
   contents stay on the page axis.

## 4.3 The column contract

Every table on the page shares the same left gutters and the same right edge:

```
[8px mark][16px glyph][identity 1fr][… value 9ch][age 10ch]
 --gutter-mark --gutter-icon                       ^^^^^^^^
                                                   ONE right edge = the page gutter
```

- `.wdf-body` has **`padding-inline: 0`**. That is a contract with the table and numeric
  specialists: rows bleed to the page gutter, so every `.wd-col-num` lands on the same right
  edge as `.wdf-age` **for free**.
- Column widths come from `<colgroup>` in `ch`, with `table-layout: fixed` — which also kills
  live column jitter: `no proof` must not resize the p99 column mid‑poll.
- A reserved column is sized by the **wider of header and content**. `Proof age` at T3 is wider
  than `52m` at T6.

**The payoff, and it is a truth argument:** with no frames, the section receipts, every numeric
column in every table, and the page tally all terminate on the **same right edge**. Eight
evidence ages read as **one tabular column down the page**, so *"which section has the stalest
evidence"* is answerable by eye in a single scan. Eight cards make that physically impossible.

## 4.4 Which container, when

| You have | Use | Never |
|---|---|---|
| A page region with a title | `.wdf-section` — no container | `.card`, a border, a radius |
| A region that MUTATES the system | `.wdf-region` — `--tile`, `--r-sm`, cancelling margin | a border or a shadow |
| Tabular truth | `<table>` + `<colgroup>` + `table-layout:fixed` | `display:grid` on `<tr>` |
| Hierarchical rows that expand | the same, + `role="treegrid"` + `aria-expanded` | nested `role="region"` |
| Key/value metadata | `<dl>` + `.wd-fields` subgrid | a two‑column table |
| Guidance about a surface | `.gdx-list` **inside that surface** | a page‑foot list |
| A whole panel with nothing to show | `.wd-empty` — left‑aligned obligation rows | `place-items:center` + an icon |
| 4–7 peer views | `.wd-tabs` **with a state gutter** | tabs without one |
| 8+ sections | clusters + the 2× gap | more tabs, or a card grid |

## 4.5 Rhythm summary

| Between | Gap |
|---|---|
| Two tiers inside one cell (value / reason) | `--sp-1` (2) |
| Label and its value | `--sp-2` – `--sp-3` (4–6) |
| Icon and its label | `--sp-3` (6) |
| Cells in a row | `--sp-4` – `--sp-5` (8–12) |
| Rows | 0 — the hairline is the separation |
| Header and its body | `--sp-5` (12) |
| Sections inside a cluster | `--sp-7` (24) |
| Clusters | `calc(--sp-7 * 2)` (48) |

## 4.6 Order

Sections are ordered by the sequence an operator walks during an incident, which is also
general → specific:

**SURFACE** (component health · lane latency) → **TOPOLOGY** (dependency graph · upstream
contracts) → **CONTROL** (control registry · mutation ledger — kept together because reading a
control without its audit trail is how you make the same mutation twice) → **EVIDENCE** (source
freshness · scrape log — **last**, because it is the meta‑tier that audits the other three, and
a page that opens on its own trustworthiness has already lost the operator).

## 4.7 Sticky, live regions, focus — the page-level singletons

- **Sticky:** exactly ONE object per scroll container — the table's own column header row, at
  `top: var(--sticky-top)` (= `0`). Never `--header-h`.
- **Live region:** exactly ONE `role="status" aria-live="polite" aria-atomic="true"` in the page
  header, present from first paint, at most one utterance per poll, consequence transitions
  only, **silent when nothing of consequence happened** — never "no change". It carries a
  visually‑hidden monotonic sequence, because `aria-atomic` with an identical consecutive string
  does not re‑announce and **flapping is the highest‑signal behaviour on this page**.
- **Focus:** one tab stop per table (roving tabindex, ↑/↓/Home/End). Forty rows must never be
  forty tab stops — **and must not be zero**, which is what a roving index with nothing at 0
  produces.

---

# §5 · THE LAW SHEET

Hold any built component against these 24. Each is checkable.

### Truth

1. **Never render a value that was not measured.** No `0` for a null, no last‑known value
   carried forward, no interpolation across a gap, no threshold you chose where the data can
   measure one.
2. **Absence is stated, never implied.** An em dash alone is silence (NVDA reads it as nothing).
   Slot scale = a dotted hairline + `.sr-only` text. Column scale = the words `no proof` /
   `never` at `--ink-3`.
3. **Every adverse state carries a reason, enforced at runtime.** A `REASON_REQUIRED` state with
   no reason renders the hatched `defect` tone in **production**, plus a dev console error. The
   reason states the **consequence**, not a platitude.
4. **The reason is real DOM text in reading order.** Never a `title`, never a tooltip, never a
   toast, never `content:`. It must survive a screenshot pasted into an incident ticket.
5. **Green is earned, grey is honest.** `--ok` is a ≤12px glyph and nothing else. There is no
   green number, no green word, no green fill, no pulsing healthy dot.
6. **Evidence class gates the state before render.** `READY && truthClass !== 'proven'` →
   `UNKNOWN`, as a pure function upstream of the renderer, not a CSS selector.
7. **Never optimistic.** This app is `preview → confirm → submit → durable readback`. A control
   that shows a state the server has not confirmed is a lie, and the rollback is a second one.

### Hierarchy

8. **Hierarchy from FILL and WEIGHT — never from size, radius or colour variation.** The
   severity ladder is bare → tint → solid, and it survives a monochrome screenshot at 2.8×
   (light) / 4.4× (dark) separation.
9. **A chip label is always `--ink-1`. Hue is always fill.** Worth 25–43 Lc, free.
10. **No tier is separated by weight alone.** No webfont is loaded; weights snap. Every role
    differs from its neighbours in ≥2 of {size, ink, case}.
11. **Same semantic level = same visual weight, everywhere.** A state transition must never
    reflow a row, change a font weight, or move a control.

### Measurement

12. **Every length is a token.** `--sp-1…9`, `--row-h*`, `--gutter-*`, `--col-*`, `--ctl-*`.
    The only literals permitted in a rule body are the 1px hairline and the 1.5px spinner rim,
    both declared.
13. **Three radii, and no fourth.** `--r-xs` 4 / `--r-sm` 8 / `--r-pill` 999. Text action =
    pill; icon‑only square = `--r-sm`.
14. **Six type roles, four weights, integer sizes, EVEN integer line-heights.** Pick a role,
    never four properties.
15. **Four inks, pinned to identical Lc in both themes.** `--faint`, `--muted-2` and `--muted`
    are banned. `--ink-mute` never carries truth.
16. **One accent budget: `--held` tint (one persistent use per surface) + transient chrome.**

### Alignment

17. **Numbers right-aligned on a SHARED grid track, tabular, letter-spacing 0.** `text-align`
    alone is not a column. `ch` excludes letter-spacing, so tracking silently under‑reserves and
    clips.
18. **Nothing insets content.** Section receipts, every numeric column and the page tally all
    terminate on the page gutter. `.wdf-body` has `padding-inline: 0`, permanently.
19. **Icons on a fixed gutter; the gutter is `--ink-3`, always.** Col 0 = 8px mark, col 1 = 16px
    glyph, glyph size 12px. Reserved even when empty.
20. **Truncate identifiers in the MIDDLE, in CSS, tail ≥ head, full string in the DOM.** No
    literal ellipsis in the markup. Labels and section names are **never** truncated — a
    truncated value is a bug; a truncated **name** is an incident.

### Behaviour

21. **Motion means non-terminal, appears at 0ms, and eases only on withdrawal.** Every signal is
    a *state with a transition*, never a keyframe, so `prefers-reduced-motion` costs **zero
    information**. No keyboard-initiated action animates.
22. **Never the native `disabled` attribute** (one narrow exception: the enabling input is in the
    same viewport and visibly labelled). Where no action is legal, render **no control** — and
    say why in a visible row.
23. **One live region per page, one sticky object per scroll container, one `sr-only` utility,
    one state vocabulary, one truncation helper, one duration scale.** An element that
    re‑implements a neighbour is wrong by construction.
24. **Compose, don't invent.** Before writing a declaration, check `tokens.css`, `motion.css`,
    `StatusChip`, `Identifier` and `Numeric`. A well‑designed island is still an island.

---

## §6 · MIGRATION — ordered, and the first four are blocking

| # | Change | Blast radius |
|---|---|---|
| **1** | **Import `tokens.css`** before `styles.css`. It exists (327 lines) and is imported by nothing, so every token above currently resolves to its fallback. | 1 line |
| **2** | Define `--warn` at `:root`. Two live call sites (`productControlRoom.css:75`, `TokenDetail.css:635`) read it with **no fallback** and are dropped at computed‑value time — those states render with no colour today. | 2 lines + 81 literal migrations |
| **3** | Lift `--held` in dark to `#9fbcfb`. `--accent` measures **Lc 28.3** on dark surfaces. | 1 line |
| **4** | `.watchdog :focus-visible { border-radius: inherit }`. `styles.css:146` forces `4px` and squares every pill on keyboard focus. | 1 line, whole app |
| 5 | Delete `styles.css:3736-3741` (`.flash-up`/`.flash-down`) — an 0.8–1.4s green/red decay at a 2s cadence is a permanent strobe, SC 2.2.2 moving content with no pause mechanism, asserting an up/down polarity latency data does not carry. | 6 lines |
| 6 | Delete `productControlRoom.css:200-203`. Specificity (0,3,1) repaints a neutral `Engage…` solid red and — once engaged — **solid green**. An engaged kill switch, rendered green, by inheritance. | 4 lines |
| 7 | Delete `LedgerPage.css:24-26` (`opacity: .45` on unknown). Opacity de‑emphasises a mark without changing what it **claims**. | 3 lines |
| 8 | Consolidate 8 `sr-only` classes into the one in `tokens.css`. | 8 files |
| 9 | Ink migration: `--muted`/`--muted-2`/`--faint` → `--ink-2`/`--ink-3` per call site (an audit, not a rename — some current uses carry truth, some are decoration). | app‑wide |
| 10 | Retire `--r-md`/`--r-lg` and the 25 radius literals; retire the 37 weights and 1,367 fractional sizes. | app‑wide, behind the CI gate |

### CI gates that ship with this document

```
ops/tests/design/apca.py            APCA-W3 0.1.9 port (verified 106.0 / -107.9 / 63.1)
ops/tests/design/contrast.json      every (token, surface, theme) pair + the shipped values it forbids
ops/tests/design/contrast_gate.py   floors AND theme drift <= 1.5 Lc; non-zero exit
ops/tests/test-design-contrast.sh   picked up by run-all.sh's test-*.sh glob
```

Plus grep gates: no hex literal outside `tokens.css` · no fractional `font-size` · no
`font-weight` outside 450/500/550/600 · no `--faint`/`--muted-2`/`--muted` under `.watchdog` ·
no `transition: all` · no `--header-h` in any sticky offset · no `border-radius` px literal ·
no `title=` on a truth-bearing string.

**Proven to FAIL, not merely to pass:** re‑injecting the shipped dark `--muted` as `--ink-3`
yields `--ink-3 [dark] #717b8a: Lc 29.2 < required 77.5` and `theme drift 48.8 Lc > 1.5`,
exit 1.

### The one thing no gate can catch

**A scale cannot be signed off from source.** Three specificity/reservation traps in this
system's history — `.wd-num` stripping tracking from uppercase heads, `.wd-table th` (0,1,1)
beating `.wd-col-num` (0,1,0), and a `:where()` tie lost on source order — **all failed
silently, in the direction that makes the stylesheet look correct.** Numeric columns rendered
left‑aligned with L5 dead on the page while the CSS read as if it were satisfied.

Render the page headless in both themes at 2× before signing anything off.

---

## §7 · OPEN QUESTIONS — the ones that need an owner, not more reasoning

1. **Per-component advance cadence needs a home.** The 21‑sample window must survive a remount
   or the wedge predicate resets to `cadence-unknown` on every navigation — silent exactly when
   an operator navigates in to investigate. It belongs in the store, not component state.
2. **`ProjectedSource.wiring` has no `LIVE` member.** Every lane renders hollow today. Correct,
   and it needs an owner and a date.
3. **The freshness/heartbeat budget must be published per section**, on the wire. It is the
   entire greenness gate. `3 × p50` is the last threshold in this system still chosen by a
   designer rather than measured or served.
4. **`expectedEvery` / probe schedule** does not exist on the projection. Without it the
   sparkline's expiry‑clock variant is unbuildable and `awaiting` has no countdown.
5. **The retention horizon** is not on any type. Without it the mark cannot distinguish *lost*
   from *impossible*, and will keep blaming the pipeline for a policy.
6. **`opsReadback.validUntilUtc` is envelope-scoped**, so one lease covers every control. Honest
   today; per‑control leases are strictly better and are a backend question.
7. **`MISSING` is a fourth managed-inventory state** not in `StatusChip`'s seven. Eighth member,
   or an alias of `NOT_CONFIGURED`?
8. **`body { font-size: 13.5px }`** should become 12px so the cascade stops being fiction —
   every page already overrides it. Needs a full render pass across all 14 pages.
9. **Two cadence controls ship today** (`styles.css:47336` segmented rail, `:47969` select) for
   one job. Pick one; delete the other.
10. **`.pcr-surface-evidence`, `.kv`, `.rail-ticket-field`** are rename targets for `.wd-field`.
    Shipping alongside them is worse than shipping neither.

---

*Twenty specialists. Forty‑one resolved conflicts. One system.*
