# DESIGN.md — the cockpit design system, quality bar, and locked surface baselines

> One file, two parts. **Part I** is how UI gets built here: the ship gate, the owner-calibrated method, locked type voices, product rulings, and the gotcha catalog. **Part II** is the measured baseline for the shared surfaces (sidebar, topbar, search, clock, popovers, profile). Read Part I before ANY web/src work; read Part II before touching a shared surface. These are measurements and rulings, not suggestions.

---

# PART I — HOW UI GETS BUILT HERE

READ THIS BEFORE TOUCHING ANY web/src FILE. It was earned over ~20 brutal
iterations on 2026-07-08. The Account page is the owner's ONLY explicitly
approved surface ("that's what I call real quality, the real deal") — every
rule below is what produced it. A fresh agent that follows this file can hit
that bar on the first try; one that free-styles will produce what the owner
calls garbage and will redo the work five times.

---

## 0. THE SHIP GATE (run before claiming ANY surface done — all measurements)

1. Judge in REAL Chrome at the owner's window (2940 CSS px, app zoom 1.25) —
   the preview tool's small viewport is for wiring only; it hid a half-width
   page and 25 bogus row lines in one day.
2. Copy = measure: run the bottom-up reference sweep in §0.3 and compare live
   computed styles. Never use one upper-navigation page as its own reference.
3. One-frame operator type contract: page title `22/540/30`; summary label
   `10.5/560` with `.055em` tracking; summary value `18/510`; persistent row
   primary `12.5-13.25/470-510`; row secondary `10.5-11.5/410-420`.
   Large numeric displays may be larger only with a thinner weight.
4. ONE left rail: getBoundingClientRect().left of every block = one x.
   Wrappers get zero horizontal padding; tables flush first/last cell;
   header text over the icon column.
5. Lines: use razor-thin hairlines to stabilize dense tapes/tables; never box
   individual rows or add decorative rails. Section boundaries remain singular.
6. Asset tables always carry: Star watchlist column (shared Star in
   components/PillSelect.tsx + toggleWatch/config.watchlist), 36px TokenIcon,
   name-over-fullname, Title Case heads, PillSelect chrome, Coinbase pager.
   Markets defines the leading table rails: `46px` star track with `8px` left
   inset, then a fixed `220px` asset track with `12px` inset. Borrow Positions,
   Loan Market, and Assets must use explicit column tracks and leave remaining
   data columns flexible; independent table canvases must never proportionally
   rescale the star or asset tracks.
7. Monitor + kill-switches only — NO manual money-action UI ever (trading,
   borrow, repay, collateral). Action routes belong to the engine.
8. Click every control in real Chrome; restore any state you flipped.
9. Log the pass in STATE.md before moving on.

### 0.1 News And Calendar Are Daily Tape Surfaces (2026-07-10)

The owner explicitly reopened News after the first TradingView-reference pass.
The current daily-tape implementation is the permanent reference. Do not add
hero statistics, sparklines, ten-row pagination, large headline type, example-
filled search copy, blue priority rails, URL subcopy, or decorative source cards.

- Both pages use one Account/Markets/Borrow-style outer surface: `1px` neutral
  border, `12px` radius, no nested page card, and the same left/right geometry.
- Calendar keeps its functional seven-day navigator, compact Today/week controls,
  real Economic counts, High/Medium/Low filters, grouped release tape, importance
  bars, and aligned Actual/Forecast/Prior columns.
- News exposes exactly the rolling seven timezone-aware days ending Today—no
  previous-week range. Day membership starts at `00:00` in the selected timezone;
  changing Local Time/UTC repartitions honestly. Each day prints Total plus exact
  H/M/L counts from the retained archive.
- News rows carry time, a free-standing publisher logo plus publisher name,
  impact bars, headline, category, and the outbound link. The Source column must
  have Calendar-country spacing: 24px mark, 9px gap, restrained 12px name. Never
  print domains, summaries, or URLs beneath the headline. A date-only source must
  show an honest dash rather than invent an exact time.
- Visible category tabs are All News, Crypto, Macro, Markets, Regulation,
  Exchange, and On-Chain / Security. Impact is an independent rail: All Impact,
  High, Medium, Low. Do not collapse either axis into a generic dropdown.
- Impact is a semantic three-bar phone-signal glyph: High = three green bars,
  Medium = two blue bars, Low = one yellow bar. Server scoring combines source
  authority, event type, affected scope, explicit scale, and low-signal wording;
  a source tier or generic `Security` tag is never sufficient on its own.
- Source identity belongs in the enlarged searchable source directory, where
  source health and selected-day counts are useful. Coverage is 100 visible
  sources as of this ruling; additions must be verified, relevant, and non-spammy.
- Typography: page title 22/540; tape headlines and events 13–13.25/470–480;
  times and values 12.5/430–490; secondary metadata 10.5/410. Hairlines stabilize
  the dense chronological rows; the Markets zero-row-border rule does not apply.
- Motion is limited to a short day-content entrance, incoming-data wash, and the
  6px two-wave live beacon immediately after News while SSE is connected.
  Persistent text never shifts, fades, or transforms; reduced motion disables it.
- The backend refresh owner belongs to the server and runs with zero browsers so
  EC2 retains an uninterrupted week. Clients only subscribe and merge deltas.
  Keep publisher-specific fetch floors, the slow history/small live relay split,
  the bounded persisted archive, and Calendar stale-while-revalidate prewarm.

Only an explicit owner request may reopen this information architecture. Normal
bug fixes must preserve the `lix-`, `calx-`, and `newsx-` geometry in
`web/src/pages/LiveIntelligence.css`.

### 0.2 Logs Is A Seven-Day Activity Tape (2026-07-10)

The owner explicitly rejected the first Logs skeleton's permanent left facet
wall and right inspector wall. Logs now uses the full News daily-tape anatomy:

- One `lix-frame` at the shared page rail: `1px` neutral border, `12px` radius,
  `57px` toolbar, `22px / 540` title, live state, and `286px × 34px` Search.
- The rolling seven timezone-aware day cards are mandatory. Every card shows
  the complete daily total plus Critical, Warning, Info, and Debug counts. A
  zero is honest when the ledger had not started collecting on that day.
- No permanent facet rail, inspector wall, nested feed card, selected-row
  accent rail, shadow, or gap between pseudo-cards. Filters stay in one compact
  band and the chronological activity tape owns the full frame width.
- Severity is one complete three-bar signal glyph, never partial bars or a red
  dot repeated on every row: Critical = red, Warning = amber, Info = green,
  Debug = blue. The color applies to all three bars.
- Selecting a row expands its real fields, related actions, and Raw JSON inline
  beneath that row; selecting it again collapses the detail. Do not restore a
  separate inspector. Rows keep the compact `46px` News rhythm.
- A complete day can be large. Keep the totals complete but mount the tape in
  progressive 200-row windows with an honest `Load Older Logs` control so day
  navigation and filters stay responsive.
- Future content edits may change fields, names, filters, grouping, or detail
  logic when the owner directs them, but must preserve this `logx-` one-frame,
  seven-day, full-width geometry unless explicitly reopened.

### 0.3 Bottom-Up Uniformity / No Quality Gradient (2026-07-10)

This is a mandatory ship gate, not a suggestion. The owner identified a repeated
failure where Calendar was polished first and quality progressively degraded on
pages higher in the sidebar. Before any surface is called done, review in this
exact order: **Calendar → News → Health → Logs → Risk → Opportunities → Volume
→ Basis → Markets → Token → Borrow → Account → Dashboard**. Start again from
Calendar after any correction that changes shared type, color, or geometry.

- Compare the rendered page, not declared CSS. Capture `getBoundingClientRect`
  and `getComputedStyle` for frame, title, summary, row primary, and row secondary.
- Stable one-frame geometry now uses a `5px` shell edge plus `6px` route padding
  on both axes, leaving an 11px visual gap from sidebar/header to content and
  the same compact edge on the right. At 1280×720 the first real page surface
  starts at `y=75`, 11px below the fixed 64px header. Frame `x/y` must not move
  when switching; `1px var(--line-2)`
  edge; `12px` radius; `57px` toolbar; summary
  begins at the same y and is exactly `102px` high where that role exists.
- Markets and Borrow share one secondary-view rail: `53px` high, `16px`
  horizontal padding, `6px` tab gap, and `32px` pills at `12.5px / 470` with
  the same CTA active treatment. Both remain a single row above the shared
  `850px` container breakpoint and stack only below it. Do not give Borrow an
  earlier breakpoint or a separate black/undersized tab language.
- Dashboard uses the same `/dashboard-blocks.png` identity as its sidebar item
  in the standard `32px` slot with a `30px` optical mark. Keep its heading on
  the same icon/title rail as Markets and Borrow.
- Use the role contract in §0 item 3. An upper page may not become smaller,
  darker, heavier, denser, or more tightly tracked than the accepted page below.
  Persistent data rows must not use `600+` weights.
- All audited pages use `var(--font)` with antialiasing. Do not introduce a
  second page font through a local token or a legacy component stylesheet.
- Secondary ink must use a declared shared token. An undefined custom property
  silently drops the declaration and inherits dark primary ink; search every
  touched stylesheet for undefined variables when text looks muddy.
- Wide evidence belongs on a real internal canvas with its own horizontal
  scroller. Do not shrink type or cram all columns into the left corner. Use
  container queries so sidebar width and UI scale do not make pages reflow at
  different points.
- Light and dark are both required. Verify exact primary/secondary weights and
  colors in both, restore the owner's theme and every toggled control, then leave
  the browser on the completed surface.
- A successful build is not visual proof. If a mounted row is absent from the
  screenshot, inspect live geometry; circular `max-content`/percentage sizing can
  produce million-pixel canvases while the DOM and accessibility tree look valid.

### 0.4 Topbar Popover Canon / No Internal Quality Gradient (2026-07-10)

The owner supplied the clean Logs `Strategy Decision` row as the type and data
rhythm reference, then required every topbar popup to be audited left-to-right.
This is now one shared system, not ten independently styled mini-apps.

1. **Fixed shell:** every popup is `398 × 486px` inside the shared `400px`
   shell. Operational headers are `70px`; Account is the one `84px` identity
   header. Popup width, height, top edge, and type roles cannot change while
   moving across the rail.
2. **Type roles:** header title `16/540/21`; subtitle `11.25/400/16`; row
   primary `12.75/470/18`; row secondary `10.5/400/15`; right-side values
   `11.5/450/16` mono with tabular lining numerals. Status labels are
   `9.75/500/14` mono/caps. Persistent popup data must not use `600+` weights.
3. **One data grammar:** rows use a `14px` content rail, free-standing identity
   marks, one hairline between rows, and the same primary/secondary/value
   alignment as the Logs tape. Dense numbers are mono; descriptions are UI
   text. A selected row may receive a quiet wash, never a nested card.
4. **Symmetric, not equal:** measure left, right, top, and bottom distances on
   the element that owns the content. Optical icon compensation is allowed;
   arbitrary one-sided padding is not. A full-height list distributes its
   real rows to the available track instead of leaving a false footer trench.
5. **No bottom action bars:** topbar popovers do not use `ops-sheet-foot` or a
   large two-button footer. A real action lives beside the object it controls
   as a hairline tool row. Duplicate navigation is removed. Account logout is
   the only destructive terminal action and is a plain full-width row—not a
   tinted rounded button card.
6. **No card-inside-card evidence:** API keys are two continuous evidence
   sections; permissions are a structured two-column hairline list. Trust
   counts are one three-cell summary band. Currency/Basis/Appearance notes are
   flat provenance rows. Do not restore individual rounded cards or gray note
   boxes inside the popover shell.
7. **Truth before fill:** preserve real state, provenance, device/IP facts,
   permission posture, disabled reasons, and actual controls. Do not invent a
   row merely to occupy vertical space and do not repeat the same action in a
   header, body, and footer.
8. **Audit order:** Clock → AWS Runner → API Keys → Trust Advisor →
   Notifications → Execution Control → Currency → Basis Units → Appearance →
   Account Details. After any shared selector change, restart at Clock. For
   every panel record shell/header rects, exact computed type roles, overflow,
   footer count, and the rendered Light/Dark screenshot before moving right.

This topbar-specific ruling supersedes any earlier generic instruction that a
popover must keep footer actions visible. Actions remain visible by living next
to their owner; bottom footer bars are retired.

## 0.5 KNOWN FAILURE MODES OF THE AGENT (the owner should not have to babysit these)

Each of these happened repeatedly on 2026-07-08 and cost a rage round. The
countermeasure column is the ONLY known fix — apply it mechanically.

1. SHIPS BLIND. Verifies wiring in the preview tool, never opens the owner's
   real Chrome. Hid: a half-width page, four left rails, 25 bogus row lines.
   → Countermeasure: no "done" without real-Chrome screenshots + measurements
   at his window (§0.1).
2. INVENTS DECORATION. Adds lines, borders, paddings, underlines the
   reference does NOT have (row hairlines, quartet vertical dividers,
   full-width tab underline, 26px hero padding). The reference is minimal;
   every addition is noise. → Countermeasure: if Markets doesn't show the
   element, it does not exist. Measure Markets first, then write CSS.
3. STYLES FROM RECALL. Drifts sizes/weights within hours (15px cells, 480
   weights, 12px labels against a written 16/430/14/440 law).
   → Countermeasure: only the five §0.3 values; measure, never remember.
4. ADDS UNASKED FEATURES. Repay buttons, Adjust-LTV modal, a dustbin
   chip-wall — all deleted on sight. The product is monitor + kill-switches.
   → Countermeasure: no new control without an explicit owner order.
5. FIXES THE INSTANCE, NOT THE CLASS. Aligns the pointed-at element, leaves
   the same violation elsewhere on the page (hero fixed, table indents kept;
   one line removed, others kept). → Countermeasure: when one violation of a
   rule is found, sweep the ENTIRE page for that rule before replying.
6. TRUSTS COMPRESSED SCREENSHOTS. 800px JPEGs "look fine" while geometry is
   broken. → Countermeasure: rects and computed styles are the only proof;
   screenshots are illustration.
7. WRITES DIARIES, NOT GATES. Logged what happened instead of what to check
   next time. → Countermeasure: every lesson becomes a numbered, measurable
   item in §0 or this list — nothing else counts as "recorded".
8. STORES LESSONS OUTSIDE THE PROJECT. Saves owner taste and product laws in
   assistant/Codex memory only; the next fresh agent loses five hours of
   calibration. → Countermeasure: durable lessons go into project files:
   `AGENTS.md`, `STATE.md`, and this playbook. External memory may
   summarize, but the repo is the source of truth.
9. OVER-STRIPS WORDS. Interprets "less words, more style" as removing useful
   labels/context until panels become symbol soup. → Countermeasure: remove
   filler and fake text only; keep words needed to understand state, controls,
   and risk.

## 1. How the owner judges quality (the meta-skill)

- **"Copy" means MEASURE.** When given a reference screenshot (Coinbase,
  Binance, Flow, the RefreshDock), extract per-element sizes/weights/colors
  and apply them verbatim. "Looks about right" one weight-notch off reads as
  *random and thick* to him. He zooms into screenshots and compares glyphs.
- **Verify on the element that OWNS the text node.** Wrappers override
  context (the global `.num` class forces weight 620/tabular — measure the
  span, not the cell). `getComputedStyle` on the glyph span is the only proof.
- **Click every control and look at what opens before claiming done.** He
  found the native `<select>` popup, the dead PnL buttons, the empty-inspector
  card, and the invisible 6M chart — all things a click test catches in
  seconds.
- **Screenshot and judge with your own eyes at HIS viewing conditions**:
  1920+ width AND 100% AND 125% zoom, light and dark. `.hp-page.wide` was
  strangled to 1240px for weeks because nobody looked at a big monitor.
- **Real data beats derived data, and honesty beats decoration.** When an
  upstream source publishes NO history (Binance liquidations), RECORD YOUR OWN
  from the live stream, persist it, and print "Recording since <ts>" — never
  fake a backfill, never show an unexplained empty chart. The balance
  was "wrong" until /api/earn asked Binance directly. A red "−$0.00" is a lie
  of rounding; a zero-row Futures bucket is fine but a fabricated $0.00 for
  an unreadable wallet is not (use `--` + tooltip). A range button must never
  render an empty-looking chart — clamp to real data and say why.
- **Few exact decisions repeated > many approximate ones.** Coinbase's entire
  order is a two-weight system. When something looks "designed", find the
  small rule-set behind it and encode it; never sprinkle values.

## 2. The locked type voices (do not invent new ones)

**CASING LAW (owner directive, non-negotiable):** every label, heading,
button, column header, stat caption, chip, and pill is TITLE CASE — first
letter of every word capitalized, exactly like Binance ("Total Debt",
"Margin Call", "Low Risk", "All Loanable", "25 Rows"). Sentence-form subs and
notes get a capital first letter. Lowercase label soup ("bot-operated",
"loanable coins") is what gets work thrown back. Sole exception: the small
lowercase MONO status values inside dock/topbar panels (live / synced /
writable) — that treatment was explicitly owner-approved.

**THIN-NUMERALS LAW (owner ruling 2026-07-09, repeated rage):** numbers always
wear LESS weight than words at the same size. Large price displays are weight
430 even at 40px — the "h1 40/520" rule applies to WORD titles only. Range
chips 13.5/440, card h3 17/560, stat values 16/440. When the owner says
"thick", the only answer is less weight. Chart lines never fill their box
edge-to-edge: pad the y-domain ~22% (Coinbase headroom). Card cells: measure
cell-bottom minus content-bottom in real Chrome and tune chart heights until
slack ≤ 16px — no dead space, no overflow.

**CRISP TYPE LAW (owner ruling 2026-07-09, notification sprint):** the default
answer to "premium" is not bigger/bolder text. Use thinner, sharper system text:
large headings may be bigger only when their weight drops into the 500-560 band;
large numbers should sit around 430; body/subcopy should sit around 420-440.
Avoid fuzzy mixed-color text, heavy 650-760 headings, and random bold emphasis.
Before finishing any UI surface, inspect computed font size/weight/line-height
in the browser and compare to the rendered screenshot. If text feels blurry,
swollen, or childish, reduce weight first before changing layout.

**BOX DISCIPLINE LAW (owner ruling 2026-07-09):** every boundary creates an
obligation. If you draw a card, row, pill, modal, or tray, inspect whether the
text and controls have clear air from every edge, whether labels align to a
grid, whether footer/actions are visible, and whether the box is necessary at
all. No words may crash into a border, sit visually on the bottom line, or hide
behind an action bar. After any boxed UI edit, take a real browser screenshot
and measure the element rects; do not call it done from code alone.

**PREMIUM SURFACE CHECKLIST (owner ruling 2026-07-09):** every topbar popover,
modal, panel, card group, sidebar section, and dashboard zone must pass this
before it is considered owner-grade:
1. Fewer boxes: use one surface and row rhythm before adding nested cards. A
   box must group, protect, or frame an action; otherwise remove it.
2. Maximum organization: one clear hierarchy per surface: header, primary
   content, secondary controls, footer actions. Do not show the same state in
   two different formats.
3. Perfect alignment: icons, labels, values, switches, and actions sit on a
   shared grid. Left/right/top/bottom air must look intentional and match the
   sibling surfaces in the same topbar/page family.
4. Clean spacing: compact does not mean cramped; premium does not mean huge.
   Empty space is allowed only when it is balanced and scaled to the component.
   Never leave a page-sized blank region inside a small popover.
   Do not solve duplication by shrinking the surviving controls into chips.
   Preserve the spacing scale: 8px for related control gaps, 12-16px for
   section air, and 40-44px for primary operator controls.
5. Crisp typography: thinner and sharper beats bigger and heavier. Titles
   usually 520-560, labels 430-560, numbers 430-440. Keep casing consistent;
   do not mix random title case, lowercase, and all-caps without a role.
6. Mid-to-deep color: use white/neutral structure with controlled mid/deep
   accent color for state, not pastel tint everywhere and not neon decoration.
   Color must mean something: live, risk, selected, disabled, planned.
7. Real icons/logos: use recognizable product logos or truthful line icons.
   No random letters, fake badges, decorative dots, or icon containers that
   hide the glyph. If a logo is known, use it; if not, use a clean line icon.
8. Moderate animation: motion should guide attention or confirm interaction.
   It must be calm, short, and rare. No constant toy spinning, static fake
   glows, or motion that competes with the data.
9. Clear sections: section labels must answer what the group is for. Rows must
   use one repeated grammar, then vary only the content and state.
10. Visible footer actions: save/cancel/open/close actions live inside the
    visible surface, aligned to the edge, never hidden below scroll or floating
    randomly outside the box.
11. Real controls only: buttons and toggles must do real work, open a real
    control surface, reflect real backend state, or be explicitly marked
    Planned/Disabled with reason. No fake operational buttons.
12. Family consistency: surfaces in the same area should be roughly the same
    size, density, radius, typography, and edge system unless the task truly
    needs a larger modal. Topbar popovers should feel like siblings.
13. Empty-state discipline: empty states are short, useful, and scaled to the
    component. They should not create a giant blank area or expose hidden filter
    state.
14. Verify in Chrome: inspect computed font/spacing, compare sibling sizes,
   click every touched control, and take/measure a screenshot before final.

**MARKET CLOCK LAW (owner ruling 2026-07-10):** the clock is the only topbar
trigger with a persistent illustrative motion. Its code-native hourglass is
large enough to read, uses the active Appearance accent, and performs a slow
hold/flip/hold cycle while the time and zone stay perfectly still. Reduced
Motion stops it. The trigger reads `HH:MM · ZONE`; never show `LOC`, browser
time, seconds, a hardcoded color, an orbit, or a spinning border there. The
popup uses the owner-supplied blue-ring clock anatomy as its large identity,
keeps the dark time stage compact, makes the full date/year readable, and shows
only India, UTC, New York, Asia, and Europe as truthful IANA-backed desks.

**TRUST ADVISOR LAW (owner ruling 2026-07-09):** Trust Advisor is not a
notification feed and not a decorative score tile. It is the audit surface for
bot controls, settings, variables, account/security posture, feeds, guardrails,
and automation readiness. It must show three severity groups clearly: Action
Recommended, Investigation Recommended, and No Problems Detected. Every row
comes from real state; if the backend does not expose a check, do not invent
one. The compact topbar panel should follow the Clock rhythm: compact header
card, hairline severity rows, real icons, visible footer actions, moderate/no
animation, and roughly the same size family as sibling topbar popovers.

**REFERENCE-MATCH LAW (owner ruling 2026-07-09, Coinbase notification photo):**
when the owner gives a high-quality reference image, copy the anatomy before
inventing new chrome. A Coinbase-style preferences modal is a single vertical
settings sheet: 28-30px outer padding, 70-74px option rows, bare black line
icons in a narrow column, 18px/430 row labels, small inline info marks, switches
hard-aligned to the far right, and a 96px footer separated by one hairline with
rounded Cancel / Save buttons. Do not wrap the same content in stat cards,
nested boxes, colored bell tiles, fake channel toggles, or dashboard counters.
If a channel is not wired, show Planned as static state; only real persisted
preferences get switches.

**NOTIFICATION-HUB LAW (owner ruling 2026-07-10):** Logs is exhaustive evidence;
Notifications is curated interruption plus routing. If a row does not answer
"what is stuck, what changed, or what execution needs attention," it belongs in
Logs. Never admit opportunities, news, scanner decisions, candidate telemetry,
snapshots, heartbeats, ordinary sync chatter, or decorative failures. Collapse
repeat runtime/infrastructure transitions only in the canonical Product incident
router and retain the exact underlying count in the sole Ledger; a proven server
recovery resolves the durable episode without erasing its source evidence. The
compact topbar tray and full Utility page render the same supervisor incidents
one-to-one. The browser never regroups source events or infers recovery. Active
retains every unresolved episode without an age cutoff. The page keeps
News/Calendar geometry and has two purposeful views only: Inbox and Routing.
Routing separates sources, delivery destinations, noise policy, and persisted
alert rules. In-App may show `WIRED_LOCAL` only when fresh canonical incident
truth and a strictly decoded routing readback agree; Email, Telegram, WhatsApp,
AWS SNS, AWS intake, and the Execution producer remain `NOT_CONFIGURED` or
owner-gated until their real server-side capability exists. No fake delivery
toggles, no browser-held credentials, and no second Logs tape disguised as
notifications.

**EXECUTION-CONTROL LAW (owner ruling 2026-07-10):** operational permissions
are not vague binary switches. Every extensible guard row uses the same explicit
three-position selector: Blocked left/red, Paused center/neutral, Allowed
right/green. Each state is persisted and server-backed; Blocked and Paused fail
closed through the existing risk fields, while Allowed opens only that one gate.
Use a labelled radio group with visible focus and full-segment click targets.
Emergency Stop is a separate, unmistakable action: red `STOP BOT` while ready,
green `Bot Stopped` after activation, and confirmed Resume. A stopped bot is a
safe achieved state, so do not leave the engaged action red or disguise it as a
small switch. Future control rows must reuse this model rather than inventing a
new toggle language.

**A. Data pages (Coinbase voice — Markets, Account, any table surface):**
- Font: InterVariable (loaded; variable weights are honored exactly).
- Two-weight discipline: REGULAR (430–440) for every number and secondary
  label; MEDIUM (550–560) for identity (names). NOTHING above 560 on a data
  surface. Numbers are proportional `lining-nums` — NEVER tabular on display
  tables (tabular Inter reads condensed/thick). Sizes: numbers 16/430,
  names 16/550 (ls -0.006em), table headers 14/440 muted, subs 13.5/430
  muted, page h1 40/520 (-0.018em), section h2 28/560, card h3 17-18/620,
  body 15/430 lh1.55. Rows 66–84px, borderless, hover wash, radius on hover
  row ends. Values that round to 0.00% → plain neutral, no arrow/color.
- App-wide weight ceiling: 680 (the global flatten). Never reintroduce 700+.

**B. Panels/popovers (dock voice — tbp- classes, every topbar panel):**
- Tracked-caps header 11/600 + colored status tag (10/620 pill), dot rows
  (7px dot · 12/500 label · 11px mono tabular value right, colored by state),
  faint centered 11px footer, quiet tile buttons 34px (primary=accent,
  danger=red). Opaque `var(--panel)` ALWAYS — never frosted (see §4).
- For the current shared topbar sheet family, Execution Control is the semantic
  type reference: title 16/600/21, subtitle 12/400/16, status 10/600/14 caps,
  section label 11/500/16 caps, section metadata 11/400/16, row title
  14/500/20, row detail and normal values 12/400/16. Large counters use a
  thinner 430 weight. These are roles, not popup-specific decoration; preserve
  them across Clock, Health, Refresh, Shell, API Keys, Advisor, Notifications,
  Execution, Currency, Basis, Appearance, and Account.
- When a sheet has one real contextual action, that action may own the trailing
  header slot instead of a passive status pill. Execution Control is the
  reference: exactly one `Stop Bot`/`Resume` button in the header, with no
  duplicate state/action row below it.
- Typography-only corrections must not silently alter panel width, height,
  row spacing, icon treatment, color, border, shadow, or motion. Display-scale
  exceptions such as the live clock time or terminal command do not create a
  second hierarchy for the surrounding copy.

**C. Account-v3 row recipe (the approved gold standard, acb-bl-row):**
- Bare 19px glyph (no tile box) · name 16/550 -0.006em var(--text) · nothing
  else on the line · right: value 16/430 + 13.5 muted sub · unreadable = faint
  `--` + title tooltip. SMALL-SIZE SCALING: at 13.5px (sidebar) the same
  recipe becomes weight 500 + ink `color-mix(in srgb, var(--text-2) 62%,
  var(--muted))` — small glyphs pack more ink; full ink/550 "pops too much".
  Active nav item: full var(--text) at 550.

**C2. Flow sidebar typography lesson (owner screenshot, 2026-07-09):**
- Sidebar quality is typography first, not background. Use calm labels around
  14px / 20px line-height, weights 500 regular and 560 active, system/SF Pro
  first, black/gray ink, exact row rhythm, subtle active fill. Inactive icons
  are bare glyphs, not boxed tiles. Do not animate persistent nav text with
  `translateX()` or any subpixel transform. Under project CSS zoom, that makes
  Chrome text look soft. If a sidebar feels blurry, inspect: font-size,
  weight, line-height, transform, icon background, and root zoom before changing
  colors.

**D. Shell scale (8px rhythm):** topbar 64px, 42px topbar icon targets
(18px optical operational marks), search = Coinbase pill 42px r21 "Search for an asset" + ⌘K
chip, sidebar currently 178px with 40px Flow-style rows and 19-20px marks, content stretches
with constant gutters, RefreshDock 28px off both edges. Footer = 12.5px
all-muted whisper
(navigation words carry ink; chrome/legal lines carry gray — never reversed).

**D2. Owner identity system (2026-07-10):** screenshots define geometry and
color, not a raster implementation. Rebuild supplied marks as transparent,
code-native SVG with geometric precision; use the same component in its topbar
trigger, popup header, and repeated object rows. Never ship the screenshot's
white/pale canvas, never put a second shape behind the mark, and verify every
identity in Dark Mode. Current family: neural brain brand, AWS cube, gold API
key, red/green Execution power, green Currency dollar, and blue Appearance sun.
Adjust only for optical weight, not arbitrary per-icon size drift.

Connection Watchman is the explicit owner exception: its launcher uses the
alpha-extracted pixels from the supplied dual-arrow image because the vector
reconstruction changed the anatomy and color. The pale screenshot canvas is
removed, the original pixels are preserved, and the old dock breathing outline
plus all inner artwork masks remain disabled.

**THE STRETCH LAW (owner 2026-07-09):** no page caps its width — `.container`
has `max-width: none`. Stretching the window stretches the CONTENT (fluid
minmax grids, width:100% charts); the gutters (sidebar→content, edges,
card gaps) stay constant-pixel. Fixed gaps + fluid boxes = the Account feel,
everywhere. Never reintroduce a --maxw cap on a page.

**THE EDGE LAW (owner 2026-07-09, "the edge looks so high quality"):** every
major page surface wears the SAME razor-thin boundary — 1px var(--line-2),
panel background, radius 12, 14px margins between cards — in BOTH themes.
Dark --line-2 must stay visible (#262d38); never theme-strip borders
(`border-color: transparent` in dark was the "quality dropping" bug). No page
ships with floating borderless sections.

**E. Color:** semantic dictionary only (red=danger/kill, green=money/ok,
orange=caution/keys, blue=connectivity, indigo=engine, teal=volume,
slate=neutral). ROYGBIV accent pref drives --accent/--cta. Charts: smooth
Catmull-Rom bezier 2px round stroke, downsample ~26pts — never raw tick
polylines; stablecoin sparks flat-line when range/mean < 0.1%.

Account balance-history geometry is an explicit fluid-chart exception: use a
normalized plotting plane with `preserveAspectRatio="none"`, keep value/date
labels in CSS-owned HTML rails, and keep strokes non-scaling. Do not restore a
measured viewBox with an optimistic fallback; if its measurement freezes, SVG
`meet` scaling centers a narrow chart inside the wide Account band while the
HTML axis stays full width. Wallet Allocation uses one CSS conic circle plus a
theme-matched circular hole; do not restore rotated SVG dash arcs and seams.

**F. Topbar/profile motion and control law (owner-calibrated 2026-07-09):**
- Topbar triggers are icon-first. Do not add words to triggers just to explain
  them; put useful words inside popovers. Do not surround every topbar icon in
  circles, dots, or tinted badges. State color only when it carries real state.
- Motion must be rare and purposeful. No constant toy spinning. Clock motion,
  if present, is slow/calm; no purple orbit, no separate weird seconds box.
  Search idle motion is a very thin paired beam with a quiet interval; focused
  search gets a sharper streak with a tail. Never use a static glow strip and
  never use a nonstop rotating search border.
- Profile/account popover is not a nav menu. It must show connected exchange
  and key posture from `/api/apikey`, active/recent devices from `/api/sessions`,
  and a real logout path. No Dashboard/Assets/Orders/Risk/Settings filler rows.
- Recent Devices identity is a random first-party browser-profile token hashed
  by the server. IP and User-Agent are evidence only; they may not be used as a
  unique device key because shared NAT and identical browser versions are
  normal. Keep the response no-store and current/active/newest ordered.
- Related commands get one control grammar. If six backend targets perform the
  same recovery operation, use one target selector plus one action; do not
  repeat them as a card grid and again in a footer. Buttons sharing one action
  group must use equal height and one spacing token; empty space is preferable
  to duplicate navigation or decorative filler.

**G. Current surface baseline:** before editing the left sidebar, brand/topbar,
global search, clock, AWS CLI, API key, Trust Advisor,
Notifications, Kill Switch / Trading Mode, Connection Watchman, Display Currency,
Basis Display, Appearance, or Account Details profile, read
Part II of this file. It records the measured current geometry, text sizes,
motion timing, real endpoints, and old-code traps from the 2026-07-09 audit.

## 3. Product decisions (owner rulings — do not relitigate)

- NO trading anywhere ("I can trade on Binance") — no tickets, no Trade/Buy/
  Sell buttons. Execution tab deleted; Orders/Positions/Fills/PnL ids route
  to Account. The withdrawal GATE bans `capital/withdraw/apply` (action);
  read-only `withdraw/history` is allowed for the equity chart.
- NO Settings page/gear — currency/basis remain topbar triggers; market refresh,
  source health, lag/outage alerts, and the four polling cadences live in the
  single bottom Connection Watchman. Theme+accent live in the profile popover.
  Dead prefs forever: zoom/interface-size, motion, density, timestamps,
  default page, reset.
- Account = money only (keys/connection/permissions/sessions live in the
  API-keys panel, RefreshDock, Health, profile popover). Account View only
  (no Asset View tab) with all ten signed Binance wallet buckets listed.
  Overview keeps the eye-mask, ≈BTC line, explicitly non-PnL Spot Balance
  History, 1W/1M/3M/6M ranges, and one compact wallet-allocation donut.
- Account capital hierarchy is one full-width disclosure ledger, never a split
  selector rail or partial side workspace. Each wallet row spans the frame and
  carries Balance, Positions, Liability, and Wallet Share. Spot is expanded by
  default; its complete signed asset table sits immediately beneath the Spot
  row at the identical left/right edges, followed by Earn and the remaining
  wallet rows. Earn and Cross Margin use the same click-to-expand pattern and
  only one wallet is open at a time. Unsupported adapters remain truthful
  read-only rows without invented asset detail. The disclosure panel owns a
  `760px` minimum internal grid and horizontal scroller only when the viewport
  is genuinely narrower than the evidence.
- Markets = the differentiated screener: sortable asset/price/chart-growth/
  change/volume/OI/funding; tick-flash cells pulse in the TICK direction with
  a matching arrow then revert to 24h truth (arrow may never contradict
  flash); Coinbase Explore anatomy (mkx- classes) with PillSelect dropdowns
  (never native selects in visible chrome).

## 4. Gotcha catalog (each one cost real time)

1. `:root zoom` family (owner runs 125%): CSS transitions freeze, color
   keyframes freeze (remove flash classes via setTimeout), sticky paints
   wrong (hence fixed shell: window never scrolls, `main` scrolls),
   backdrop-filter samples a MISALIGNED region → ghost text: floating
   surfaces are always opaque. Media queries see the UNZOOMED window —
   responsive column hiding must use container queries
   (`container-type: inline-size` on the page root).
2. Equal-width segmented controls: grid `auto-flow: column; auto-columns:
   1fr` — `flex: 1 1 0` in a shrink-wrapped track under-sizes and clips.
3. `display:flex` on a `<td>` + `text-overflow: ellipsis` paints a stray "…"
   dot (Chrome) → tds get `clip`; inner spans ellipsize.
4. The `.num` flash wrapper forces 620/tabular globally — neutralize inside
   any new surface (`font-weight/variant: inherit`). TODO: someday remove
   weight from `.num` app-wide with a full visual sweep.
5. LEGACY !IMPORTANT PINS (~styles.css 10890 & 11063): sidebar width, row
   size, bullet width. When a shell override "doesn't take": enumerate
   `document.styleSheets` + `getPropertyPriority`, then edit the legacy pin
   IN PLACE. Never stack another !important.
6. Hooks ABOVE loading early-returns, always ("Rendered more hooks" crash).
7. `fmtPct` defaults withSign=true — beside a direction arrow always pass
   `(abs, 2, false)` or you print "down +0.82%".
8. fmtPrice/fmtMoney are FX-converted (fxRate/fxSymbol); any NEW money
   formatter must route through them (fmtPrice was FX-blind for weeks).
9. Preview/server traps: `.claude/launch.json` pins the built server to 8080
   and Vite to 5173 with auto-port disabled. If either port is occupied, find
   and stop the stale process instead of silently attaching to old dist on a
   random port. Before debugging "broken" behavior, check which port the page's
   network requests hit. Vite proxies `/api` to 8080. After editing
   the 390KB styles.css an immediate reload can race the rebuild — rebuild,
   reload again before concluding a fix failed. Preview tab is HIDDEN: rAF/
   CSS motion can't be sampled; verify timing via getAnimations/computed.
10. CoinGecko: keyless search throttles hard (4.5s gap) and its index DRIFTS
    ("stepn" stopped returning GMT) — verify aliases against live search;
    exact-symbol match only; ambiguous symbols (4× "BROCCOLI") stay monogram
    rather than risk the wrong logo. LD-prefixed assets are Simple-Earn
    wrappers: share qty ≠ underlying amount — value via /api/earn, never
    derive.
11. Binance API truths: accountSnapshot = 30 days max (the 6M chart is
    reconstructed backward from deposit/withdraw history, zero-clamped,
    labeled honestly); earn positions need /sapi/v1/simple-earn/flexible/
    position; per-key flags come from apiRestrictions (account.canWithdraw
    is account-level and lies about keys).
12. When a reconstruction/algorithm misbehaves: DUMP THE RAW DATA first
    (node --env-file=.env with the built client) — the data explains itself.

## 5. Where everything lives

- `web/src/components/px.tsx` — shared kit (PageHead/Sec/Group/Row/Pill/Seg/
  Empty + TINT). `Header.tsx` — topbar, sidebar NAV, all tbp- panels, search,
  account popover, RefreshDock. `TokenIcon.tsx` — logo chain + monogram +
  stock badges + LD/rename ALIAS. `Donut.tsx`, `Num.tsx` (flash), `PerfChart.tsx`.
- `web/src/pages/Markets.tsx/.css` (mkx-), `Account.tsx` (acb-, gold
  standard), `lib/tokenNames.ts` (display names), `lib/iconManifest.ts`.
- `web/src/styles.css` — hp- system + appended blocks (SHELL SCALE, tbp-,
  acb-, GLOBAL TYPE DISCIPLINE at EOF). Later blocks win; beware §4.5 pins.
- `server/src/binance/icons.ts` — logo resolver (aliases/gap/disk cache at
  data/icon_cache.json, cwd-relative). `client.ts` — signed endpoints incl.
  earnFlexiblePositions, accountSnapshots, deposit/withdrawHistory.
  `index.ts` — /api/earn (60s cache), /api/equity-history (1h cache, flow
  reconstruction), CSP img-src hosts.
- Verification: root `npm test` runs typecheck, clean production builds,
  engine proofs, and focused deterministic regressions. The live public-market
  app gate is `npm run test:integration`; `npm run test:all` runs both. Never
  hardcode an expected test count in this playbook because the suite grows.

### 5.1 Current page map (2026-07-09, all 13 tabs)
- Prefixes: `mkx` Markets · `acb` Account (gold standard) · `bwx` Borrow (card
  voice) · `tdx` Token (Coinbase clone + Binance base cards + `cgx` Coinglass
  panel) · `bsx` Basis · `vsx` Volume (honest spec tiles) · `opx` Opportunities
  · `rsx` Risk (+ shared control-page recipe) · `hlx` Health · `lg` Logs ·
  `nwx` News · `clx` Calendar. Shared: bwx-hero = page-hero recipe;
  bwx-guard/switch2 = kill-switch tile; rsx-band = carded section;
  PillSelect/Star/pageList in components/PillSelect.tsx.
- Server data sources added 07-08/09: binance/profile.ts (CoinGecko two-tier
  warm, 452/452), binance/moneyflow.ts (aggTrades buckets), binance/
  liquidations.ts (!forceOrder recorder — no upstream history), rest.ts
  fetchOiHist/fetchBasisHist/fetchFundingHist. Status: /api/token/profiles/
  status surfaces in Health → Token Data.

## 6. The loop (run it EVERY pass, no exceptions)

1. Reference in hand → extract exact values (or reuse §2 voices).
2. Edit. Imports FIRST when scripting edits (HMR executes mid-edit states).
3. `npm run typecheck`, then `npm run build`. Vite transpilation alone does not
   typecheck. Server changes: rebuild dist + restart the 8080 process.
4. Verify in preview: computed styles on glyph spans, click every control,
   screenshot at 125% AND 100%, 1440 AND 1920, light AND dark.
5. Nav crash sweep (click all sidebar items, check for error boundary),
   console errors, then run `npm test`. For a release or backend/network change,
   also run `npm run test:integration`; investigate external-feed failure rather
   than replacing it with fake data.
6. Log the pass in STATE.md (what/why/gotchas) BEFORE moving on —
   update as you move, not at the end.

---

# PART II — LOCKED SURFACE BASELINES

Last audited: 2026-07-10 12:43 IST

Purpose: this file preserves the hard-won UI calibration for the surfaces that
were edited repeatedly in the long polish pass: left sidebar, brand lockup,
global search, clock, topbar icons, topbar popovers, and account profile. A new
agent should read this before touching `web/src/components/Header.tsx` or the
late topbar/sidebar blocks in `web/src/styles.css`.

This is not a claim that the current UI is perfect. It is the baseline that
must not be lost. Improve from here; do not return to fake buttons, random
boxes, heavy typography, huge scroll panels, or decorative icon soup.

## 1. Evidence Snapshot

Audited files:

- `web/src/components/Header.tsx`
- `web/src/styles.css`

Audited rendered app:

- `http://localhost:8080/`
- The topbar typography baseline is measured at 100% root scale. Do not judge
  text sharpness through fractional CSS `zoom`; 100% is now the default.

Important code trap:

- `SharedTopBar()` renders `premiumContent(contentActive)` inside overlapping
  `.smenu-pane` layers. Account is the final shared `MK` key, not a separate
  profile popover.
- `contentClean()` still exists in `Header.tsx`, but it is not the rendered
  topbar panel path. Do not copy or edit that branch unless the render call is
  changed deliberately.
- `styles.css` contains many older named blocks. The effective sidebar/search/
  clock/profile rules are mostly the late V4 override block at the bottom. When
  in doubt, inspect computed styles in the browser instead of trusting a section
  header in CSS.

External anchors checked before recording this:

- Apple HIG treats toolbars as horizontally grouped control sets and sidebars as
  navigation areas.
- Material Design treats navigation drawers/sidebars as destination switching.
- NN/g icon guidance says labels reduce ambiguity; this app applies that as:
  sidebar navigation keeps labels visible, topbar expert controls can stay
  icon-first only when the popover/title/aria supplies clear context.

## 2. Current Pixel Baseline

Use these as first-pass guardrails before taking screenshots:

| Surface | CSS Target | Current Measured Shape | Lesson |
| --- | ---: | ---: | --- |
| Header | 64px high | about 64px at 100% | Flat, no tint band. |
| Sidebar | 178px wide | about 178px at 100% | Calm nav rail, no gradient/tint exterior. |
| Sidebar Row | 40px high (`36px` only below 731px viewport height) | measured 40px | Icon scale does not control breathing room. |
| Sidebar Label | 14px / 20px, 500 | active 560 | Crisp text matters more than background. |
| Sidebar Group | 9px / 12px, 720, uppercase | muted caps | Small section labels, not huge category banners. |
| Topbar Search | 42px high, about 440px wide | 44px x 462px | Coinbase pill aligned to content start. |
| Topbar Icon | 18px optical mark in 42px target | 18px across the operational rail | Quiet controls remain subordinate to the 30px product identity. |
| Shared Popover | 400px, 14px radius | measured height | One persistent shell for every panel. |
| Account Sheet | 400px shared shell | same as every trigger | Real profile, exchange, session, and logout rows. |

Never judge these from memory. Use `getComputedStyle()` on the exact element and
`getBoundingClientRect()` at the user's current zoom.

## 3. Sidebar Lesson

The owner compared this directly against a Flow sidebar. The lesson was text
quality, not background decoration.

Current sidebar standard:

- White panel background, no exterior tint, no gradient wash.
- Shell padding is 4px top / 5px sides; the old 15px top and 10px side trench is retired.
- Group spacing: 8px group gap, group title margin 7px 7px 7px. The compact
  `<=730px` height fallback returns to 6px and 6px/7px/5px so every Utility
  destination still fits at the verification viewport.
- Group title: 9px, 12px line-height, 720, uppercase, letter spacing 0.16em,
  muted gray.
- Row: 40px high, 8px radius, 7px horizontal padding, 28px icon column, 8px
  gap. The icon column remains stable while the artwork shrinks; active/hover
  backgrounds stretch symmetrically across the rail.
- Label: 14px, 20px line-height, weight 500 normal, 560 active.
- Navigation images: 19px optical mark in a 28px alignment slot, transparent
  background, no transform. Calendar and Notifications may reach 20px to
  compensate for their lighter source canvases. This is 30% below the former
  27-29px marks; the 40px row preserves air instead of shrinking with the art.
- Active row: subtle warm fill (`#f0ede6`), not a loud blue block. Hover uses
  `#f5f2ec`.
- No `translateX(1px)` or subpixel text movement on persistent nav labels.
  That made the type look soft/blurry.
- No boxed inactive icon tiles. They made the sidebar look heavier and less
  premium.
- No random dots, active lines, or side rails unless the owner asks for a new
  nav language.
- Utility order is fixed in both themes and every active state: Logs → News →
  Calendar → Notifications. The DOM exposes `data-nav-group` and `data-nav-id`
  so future CSS cannot visually move Notifications above the audit surfaces.

If the sidebar looks blurry, inspect in this order:

1. Root zoom and browser zoom.
2. Font family actually applied to `.snav-item`.
3. Font size, line-height, and weight.
4. Whether a transform is applied to the text or row.
5. Whether icon boxes or tinted backgrounds are creating visual noise.

## 4. Brand Lockup Lesson

The brand is a restrained control-room identity, not a landing-page hero.

Current standard:

- Product lockup: `ARBITRAGE` over `CONTROL ROOM`; the browser title,
  accessible home label, and footer use the shorter identity.
- Header brand hit area: 160px × 48px at the desktop baseline.
- Mark: the owner's supplied concentric blue Control Room `C`, reconstructed as
  a 30px transparent three-ring SVG. It now carries the product hierarchy
  instead of reading smaller than the operational rail, while retaining its
  full artboard and no screenshot canvas in either theme. The rejected
  folded-file and `</>` experiments are retired.
- Name: 18px / 20px, weight 670, uppercase, `.055em` tracking.
- Sub: 10.5px / 12px mono/caps, weight 650, `.16em` tracking.
- Search begins at `sidebar width + 10px`, leaving a compact gap after the
  shorter brand and aligning with the tightened route rail.
- No huge sidebar masthead, no extra decorative line collisions around the
  brand, no tint block behind the logo.

Watchman overlay rule: `/connection-reset-mark.svg` packages the alpha-extracted
pixels from the owner's supplied image, including its original `#588DF2` blue,
long-arc anatomy, and `264:230` aspect ratio. It renders inside a borderless 76px
theme-matched circular button. The global `.rdock-btn::before` breathing outline
must stay disabled for this launcher and no inner mask may cover the arrows.
The circle blocks prices or metrics underneath without creating the rejected
rounded-square tile or changing the supplied artwork.

## 5. Global Search Lesson

Search became a real global command field, not only a token filter.

Real behavior:

- Searches pages, settings/actions, spot tokens, and perpetuals.
- Tabs: Top, Crypto, Perpetuals, Settings.
- Results open token detail or navigate to a page/setting.
- Outside click closes the panel even when the query is empty.
- Escape clears and closes.
- `Cmd+K` chip opens the full command palette.

Current search UI:

- Position starts at the content start, not inside the logo area.
- Pill: 42px high, 999px radius, white panel background, 1px line, inset white
  highlight.
- Input: 13.5px, weight 500; placeholder weight about 480.
- Search dropdown: about 720px wide in CSS, 16px radius, 0 padding, opaque
  panel, 24px/70px soft shadow, no backdrop blur.
- Tabs: 32px pills; active tab is black with white text.
- Result row: 58px high CSS; desktop grid is icon, asset, middle data, right
  price/change.
- Search result labels: token name 14px, weight about 690; sub labels 12px,
  weight about 470; price value 14px, weight about 620.

Search beam rule:

- There must be a real moving beam, not a static glow.
- Idle state: very thin paired top/bottom streaks, 10s cycle, long quiet gap,
  low opacity.
- Active search: brighter paired streak, about 4.8s cycle, visible tail, still
  controlled.
- Motion direction should read left-to-right along the field, not chaotic
  border spinning.
- No purple/blue carnival glow, no constant rotating border, no fat moving
  lines.

## 6. Clock Lesson

The owner explicitly reopened the former still-clock rule on 2026-07-10. The
clock remains a precision instrument, but now has one deliberate animated mark.

Current trigger:

- `130px × 42px` at 100%, containing a `24px` code-native hourglass, `HH:MM`,
  one small bullet, and the short market-desk code, for example `08:25 · IST`.
- The inner instrument is a 32px-high, 10px-radius near-square capsule with a
  neutral hairline and transparent fill. Never restore the blue/white tint.
- The accent applies to the hourglass, bullet, zone, and popup identity; the
  capsule surface itself stays neutral. IST is 11.5px and the time stays 14px.
- `LOC` and Local Time are retired. A legacy local preference migrates to
  India/IST. The supported market desks are India, UTC, New York, Asia
  (Singapore), and Europe (London).

Current motion:

- The sand-filled hourglass holds, flips to `180deg`, holds, then returns over
  an `8.4s` cycle. Time and text never move. No orbit, glow, spinning border,
  or animated popup logo.
- Both the OS `prefers-reduced-motion` setting and the app's Reduced Motion
  preference stop the hourglass and sand animations completely.

Popover:

- Width is the shared 400px shell.
- Header says Market Clock and uses the owner's blue-ring clock reference as a
  sharp 50px vector identity mark; its ring follows the Appearance accent.
- The dark stage is a compact 58px instrument: 24px time plus a clearly visible
  13px full date including year.
- Exactly five 54px zone rows fit without a scrollbar. Every row carries its
  code, human desk name, truthful IANA-backed time, and live seconds.

## 7. Topbar Trigger Law

The topbar is for expert operator controls. It should look alive, but not noisy.

Current trigger pattern:

- Topbar triggers are icon-first.
- Trigger targets are 42px CSS, transparent background, no visible box by
  default. Visible operational marks are 18px across the rail. Their source
  colors remain recognizable without competing with the 30px product mark.
- Use source-driven color identity across the row:
  - AWS Runner: orange three-face cube.
  - API Key: yellow-to-orange key.
  - Trust Advisor: green/security tone.
  - Notifications: teal/account feed tone.
  - Execution Control: red ready-to-stop / green bot-stopped power mark.
  - Currency: green dollar.
  - Basis: violet percentage tone.
  - Appearance: blue radial display/sun mark.
- No words on the trigger itself except compact meaningful symbols like `$`,
  `%`, or `bp`.
- Words belong in title/aria and inside the popover.
- Avoid adding random status dots around every icon. A tiny status mark is only
  allowed when it carries real state and is visually integrated with the glyph.
- Do not wrap every icon in a visible circle or box. The hit target can be 38px;
  the visible object should stay light.

## 8. Shared Popover Anatomy

All topbar panels use the same base chrome:

- `.smenu`: 400px wide, 14px radius, 1px neutral border, opaque sheet, and a
  restrained light/dark shadow. It keeps `overflow: visible`; only the content
  viewport clips so the 25px trigger bridge remains interactive.
- All `MENU_W` entries are 400. Continuity matters more than saving 20px on a
  short panel.
- Moving between triggers changes the active key immediately. Incoming and
  outgoing panes overlap for 200ms and slide 16px in travel direction. Never
  fade the only mounted content, never fade the shared parent, and never use a
  changing callback identity as the global closer.
- Shell height is measured from the incoming pane and transitions for 200ms;
  long panes scroll inside the viewport without adding a page scrollbar.
- Use a hero/instrument area only when it communicates state.
- Rows are usually 34-50px CSS depending on content density.
- Labels and words are allowed when they clarify state or controls. "Less words"
  means remove filler, not remove necessary labels.

### Shared Typography Contract

Execution Control is the reference type hierarchy for every topbar popup. Keep
the shell-specific artwork and controls, but do not invent a new font scale for
each panel:

- Popup title: 16px / 600 / 21px.
- Header subtitle: 12px / 400 / 16px.
- Header status: 10px / 600 / 14px, uppercase.
- Section label: 11px / 500 / 16px, uppercase; section metadata is 11px / 400
  / 16px.
- Primary row copy: 14px / 500 / 20px.
- Row detail: 12px / 400 / 16px.
- Right-side values and times: 12px / 400 / 16px unless a denser timestamp
  needs 11px / 400 / 16px.
- Large informational counters use 18px / 430 / 27px so numbers remain crisp
  rather than turning into heavy scoreboard type.

The clock time and terminal command can retain their functional display scale.
Their surrounding title, subtitle, section, row, detail, and status roles still
follow this contract. Do not change popup geometry, color, borders, icons, or
motion to solve a typography-only inconsistency.

## 9. Individual Topbar Panel Lessons

### AWS Runner Control

What makes it work:

- The owner's orange three-face cube is reconstructed as transparent SVG and
  is the identity on both the rail and opened surface. It has no square service
  tile, raster canvas, or generic cloud/cog glyph.
- The compact popup is a connection-control sheet, not a decorative terminal.
  It shows the configured region, SSM instance, service, AWS Channel gate, and
  Runner Changes gate from `/api/aws-control/status`.
- The large workspace may use a dark terminal/editor stage, while its header,
  tabs, target facts, and security controls remain in the shared panel theme.
- Both gates are server-enforced and default closed. Closing AWS Channel also
  closes Runner Changes. Configuration or operator failures remain visible.
- The console accepts only `status`, `logs`, `read`, `validate`, `restart`, and
  `help`; arbitrary shell input is rejected. The editor only reads/writes the
  fixed configured runner file with size, hash-conflict, backup, and secret
  checks. Do not broaden either surface into a browser-exposed shell.
- Production mutations require a signed Cloudflare Access application JWT with
  verified issuer/audience and the configured operator email claim. An email
  header by itself is never trusted. AWS credentials and SSM session material
  never enter browser state.

### API Key

What makes it useful:

- Data comes from `/api/apikey`.
- The owner's yellow-to-orange key is reconstructed as transparent SVG and is
  used on the rail, popup header, and key objects. It replaces both the former
  Binance tile and every opaque screenshot canvas; the connected objects remain
  truthfully named Read-Only and AWS Automation.
- The body is exactly two equal, sharp, hairline-bordered key objects:
  `Read-Only` and `AWS Automation`. Each object shows only its role, one egress
  IP, truthful state, and the six permission labels. Do not restore key names,
  fingerprints, HMAC/type copy, restriction prose, trusted-network copy, or a
  policy footer.
- Live is a small green pulsing dot. Planned is a static amber dot. A declared
  future permission may be shown green inside the planned AWS object, but that
  must never make the key appear connected or live.
- The Read-Only object enables only Reading. The planned AWS Automation object
  declares Spot / Margin, Loan / Repay, Futures, Universal Transfer, and
  Withdrawals while Reading stays off.
- Keep both cards symmetric and fully visible inside the shared 400px shell;
  no internal API-key scrollbar is part of the approved baseline.

### Data Health ownership

Data Health is not a topbar trigger or a second compact popup. Its source
evidence, readiness grade, lag/outage state, and link to full System Health are
owned by bottom-right Connection Watchman. Do not restore the removed topbar
button or duplicate its request probes.

### Trust Advisor

What makes it useful:

- It is a bot-control and settings audit, not a notification inbox. It answers:
  which automation controls, account/security settings, feeds, and guardrails
  need attention before the bot is trusted.
- It is a derived safety scan from real state: withdrawal posture, account sync,
  socket, market feeds, read key, allowlist, kill switch, Cloudflare gate.
- It uses the Trusted Advisor severity model: Action Recommended, Investigation
  Recommended, and No Problems Detected. These three groups must stay visible.
- The owner-supplied green check shield is the source-exact identity on both the
  rail and popup header. Do not replace it with the former hand-drawn scanner
  seal or a generic line shield.
- Action, Review, and Clear are three equal, separate 1px summary cells. Each
  combines a thin number with a real symbol: strong amber triangle alert,
  softer amber circular alert, and green verified tick. The same three-symbol
  language is repeated on check rows; never restore the old cross mark.
- Details/footer actions navigate to relevant existing pages such as Risk and
  Health/System. Do not create fake control pages.
- Do not invent fake warnings. If there is no real check, do not show it.
- Keep this panel in the same topbar family as Clock: compact header card,
  hairline severity rows, real icons, visible footer actions, no giant score
  tile, no decorative status animation.

### Notifications

What makes it useful:

- Notifications and Logs have deliberately different jobs. Logs is the complete
  evidence ledger. Notifications is the operator exception and routing layer:
  it answers what is stuck, what changed state, and where the selected alert is
  delivered. It never substitutes for the evidence ledger.
- The admitted set is the bounded canonical Product incident projection. The
  server Product incident router alone authenticates source events, groups
  repeats into durable episodes, advances state, and proves recovery. The sole
  Ledger owns source/disposition checkpoint history, episode rows, immutable ACK
  evidence, routing receipts, and recovery proof. The browser owns none of those
  decisions.
- Scanner decisions, opportunities, news, announcements, snapshots, heartbeats,
  candidate telemetry, ordinary account sync, watch/config churn, and decoration
  failures stay in Logs. They never enter the notification inbox.
- Header and page consume `ProductSupervisorReadModel.incidents` only when
  supervisor continuity is `PROVEN` and incident availability is `AVAILABLE` /
  `BUILT_AND_TESTED`. They apply one shared, one-to-one presentation selector;
  neither surface reads `/api/events`, opens a second cursor, groups source rows,
  recomputes severity, or infers a recovery.
- Compact tray uses the Coinbase-clean account popover grammar already approved:
  sourced bell identity, quiet heading, canonical incident rows, and real Mark Read
  / Open Center actions. Do not add filter strips or preferences to the tray.
- Canonical order is `OPEN` then `ACKNOWLEDGED` then `RESOLVED`, severity highest
  first inside each state, then newest evidence. Preserve that order in Header,
  Active, and calendar buckets. Active includes every `OPEN` or `ACKNOWLEDGED`
  episode without an age cutoff; an incident older than seven days remains there
  until the server proves it resolved.
- Compact tray must stay in the topbar popover family, close to the clock and
  account-detail footprint. Do not force page-like dimensions or giant empty
  regions.
- The full notification center is a first-class Utility page directly below
  Calendar, not a modal. The topbar bell remains the compact tray and its Open
  Center action navigates to `page='notifications'`.
- Notifications uses the exact News / Calendar one-frame geometry: `x=189`,
  `y=75`, `1px` edge, `12px` radius at the current 1280×720 owner viewport, a `57px` toolbar,
  one bounded Active card plus seven equal calendar cards, segmented filters,
  and one curated inbox. The eight-card grid uses shrinkable tracks and must not
  overflow the frame. Route changes between Notifications, News, and Calendar
  must not move the frame.
- Inbox and Routing are the only two page views. Inbox keeps Needs Attention
  first and reports the exact durable episode count and server-grouped repeat
  count. Routing owns source readiness, destination readiness, noise policy, and
  persisted rules. Execution is visibly `NOT_CONFIGURED`: its rule and category
  filter are disabled, it is excluded from enabled counts, and Header exposes no
  Execution notification tab until a canonical producer exists.
- The routing capability response is decoded from `unknown` with exact top-level,
  connector, endpoint, policy, and cross-field relationships. Malformed or extra
  fields fail closed without crashing. In-App is `WIRED_LOCAL` only when that
  strict readback and fresh canonical Product incident availability agree.
  Email, Telegram, WhatsApp, and AWS SNS stay `NOT_CONFIGURED`; no browser toggle
  or optimistic API response may make them active. AWS intake remains owner-gated
  at `/api/notifications/ingest/aws`.
- The seven calendar buckets are presentation windows over the canonical bounded
  incident projection, not a client-curated event history. Active is separate and
  has no age cutoff. Never restore `/api/events` pagination or browser grouping as
  notification authority.
- Acknowledgement is an incident-specific canonical command. The browser verifies
  the exact server-compatible SHA-256 control ID, previews the current incident
  revision, and durably persists command identity before submit. On mount and
  cross-tab storage changes it reconciles a pending result; stale reads are
  abortable and ignored, and a manual Recheck remains available. Pending,
  ambiguous, or invalid durable state blocks another command and is never cleared
  optimistically. Only a proven terminal result clears identity and refreshes
  supervisor truth. Confirm receives focus; Cancel, expiry, failure, and submit
  completion restore focus to the remounted Acknowledge button.
- Page typography stays restrained and matches News / Calendar: title 22px/540,
  rule and alert titles around 10.5-13px/480-540, metadata around
  9.5-11.5px/410-470, 1px hairlines, and no swollen display counters.
- Category marks are real icons: Critical = Shield Alert, Bot = operations/log
  mark, Infrastructure = network/source mark. Do not render categories without a
  canonical producer.

### Kill Switch / Trading Mode

What makes it useful:

- Emergency Stop remains one immediate action. The aligned `102×36` real action
  owns the header's trailing slot: red `Stop Bot` while running, green `Resume`
  while stopped. Never pair that control with a redundant `Limited`/`Ready`
  badge or a second Bot Running state row. The subtitle carries the current
  blocker, the mode rows start immediately below the header, and Resume still
  requires confirmation.
- Funds Access, Borrowing, Strategy Automation, and Live Orders use one real
  three-position radio control: Blocked on the left, Paused in the middle, and
  Allowed on the right. Blocked is red, Paused is neutral, Allowed is green.
  The entire segment is clickable and keyboard-operable; never restore vague
  binary switches.
- `config.controlModes` persists the four explicit operator intentions. Legacy
  fail-closed fields remain synchronized for the existing risk/loan services:
  Blocked and Paused both prevent the relevant new action, while Allowed opens
  only that configured gate. Borrowing maps Blocked to repay-only, Paused to
  new-borrow pause, and Allowed to guarded borrowing.
- Live Orders Allowed remains disabled when a real prerequisite is missing.
  Never let visual green bypass the kill switch, key posture, funds gate,
  automation state, or symbol allowlist.
- The layout is deliberately extensible: future control rows reuse the same
  labelled three-state component and persisted server mode rather than adding
  unrelated toggle styles.

### Connection Watchman

What makes it useful:

- Market Ping and Data Health no longer exist in the topbar. Their browser-local
  snapshot/socket controls and every source-health check live in the single
  bottom-right `RefreshDock` Connection Watchman. A visible control is enabled
  only when its canonical owner is mounted; a legacy route returning
  `CONTROL_PREVIEW_REQUIRED` is not a usable recovery control.
- The launcher uses the owner's supplied solid-blue two-arrow refresh identity,
  reconstructed as code-native SVG with the same separated arrows. The visible
  mark is 68px inside a 76px target — about 30% larger than the previous 52px
  identity — with a slow one-turn pause cycle and a deliberate recovery spin.
  It has no visible circle, screenshot canvas, tile, or tinted container in
  either theme.
  The popup header keeps the separate shield/radar Watchman mark. Reduced Motion
  freezes the launcher, header scan, and live wave.
- At 1280×720 the panel resolves to `900×566`; on taller workstations it caps at
  `900×650`. It keeps a 1px edge, 15px radius, no document overflow, and fixed
  header, five-fact summary, three-view rail, scrolling evidence area, and a
  76px recovery console fixed to the panel bottom.
- The five summary facts remain one continuous hairline tape. Overview is the
  working control plane: the six-stage connection path is a compact evidence
  list on the left and the four browser polling controls are aligned on the
  right. Connections and Sources remain the deeper scrollable inventories.
  Do not restore a fourth Controls tab or a decorative transition queue.
- Live rows come from current evidence: browser RTT/socket; server control API; public market
  streams; Binance REST latency/clock/rate weight; account sync; Basis and
  Volume runtimes; News; Calendar; FX; Ledger DB; optional user-stream fallback.
  News, Calendar, and FX may call their exact public-only refresh owners.
  Browser snapshot refresh and WebSocket rebuild remain browser-local. Managed
  `all`, `market`, `runtime`, and `account` resets stay visible but disabled and
  labelled `CONTROL_PREVIEW_REQUIRED`/`OWNER_GATED` until a canonical preview,
  commit, and readback path exists; they must never fall through to the retired
  legacy refresh mutation.
- `GET /api/system.connections.watchman` owns the component inventory and
  summary. AWS Runner and Cloudflare remain visibly Planned/Not Configured
  until prerequisites exist. The in-app notification route is explicit, but it
  may claim `WIRED_LOCAL` only while fresh canonical incident truth and strict
  routing-capability readback agree; otherwise it fails closed. External
  delivery remains honest in Notifications.
- The server logs only status transitions as `connection_alert` or
  `connection_recovered`; these are promoted into Notifications without copying
  raw health logs or spamming every five-second probe. Browser RTT/socket state
  is reported through the sanitized `/api/connections/browser-observation`
  endpoint because that path cannot be measured truthfully from the server.
- Cadence choices are exact persisted radio groups: `<1s`, `1s`, `3s`, `5s`,
  and `10s`. News and Calendar must honor the selected value; never present a
  cadence that the mounted page silently ignores.
- Controls must not repeat recovery as cards or per-view footers. One persistent
  Recovery Target selector presents `all/market/runtime/account/news/calendar/fx`;
  only the exact public-only `news/calendar/fx` targets may enable `Run
  Recovery`. Managed targets remain an honest disabled boundary until their
  canonical control owner is wired. That console stays visible at the bottom of
  Overview, Connections, and Sources.
  The target and action are balanced `182×42` controls with 12px separation.
  Every Overview cadence row is 64px with a `112×38` selector and a distinct
  34px targeted refresh action; Defaults is a restrained `86×28` header action.

### Route Edge

- The shared page shell uses 5px outer padding plus 6px route padding on every
  edge. At 1280×720 the first real surface is `y=75`, exactly 11px below the
  fixed 64px header, on Dashboard through Notifications in both themes.
- Do not restore the former stacked 16px + 22px top inset. It created a 38px
  empty trench above every page and was especially visible in Dark Mode.

### Display Currency

What makes it useful:

- Uses `/api/fx` for rates.
- Options are real display preferences: USD, INR, EUR, JPY.
- Trigger can show the currency symbol, but the popover must show code/rate.
- The green dollar reference is a transparent code-native SVG in the trigger
  and popup header; never restore the white screenshot canvas.
- Do not name this "Color" or another unrelated setting.

### Basis Display

What makes it useful:

- Switches one real persisted basis-unit preference across every formatter:
  Percent, Basis Points, or Decimal Rate. The equivalent example is
  `+0.042%` = `+4.2 bps` = `+0.00042`.
- Decimal Rate is the calculation ratio, not a second percentage. It equals
  Percent divided by 100.
- Keep the compact conversion ladder: 1 / 10 / 100 basis points map to their
  Percent and Per-$1 effects. This is explanatory evidence, not a calculator.
- The code-native crossed-rate mark is the identity in both the trigger and
  popup header. Keep the panel inside the shared 400px shell; do not expand it
  into a decorative explainer page.

### Appearance

What makes it useful:

- Real controls, in this order: Theme mode, Accent dots, Interface Scale, and
  Motion. Scale is a full third section in normal flow; never push it into a
  shrunken footer with `margin-top: auto`.
- Motion is a persisted `System / Full / Reduced` control. System resolves the
  OS `prefers-reduced-motion` setting and updates live when that setting changes;
  Reduced stops the app's transitions and animations through `data-motion`.
- Keep accent choices as small circles/dots, not named color cards.
- Theme buttons may use compact symbols, but do not remove all context if the
  owner says it feels like symbol soup.
- The owner-supplied blue radial sun/display geometry is the identity in both
  the trigger and popup header. It is implemented as a transparent code-native
  mark with eight balanced rays and a two-level blue center, so the pale
  screenshot canvas never becomes a white tile in Dark Mode.
- The box should fit without scroll in the same window.

## 10. Account Profile Lesson

The profile popover is not a generic navigation menu.

Real behavior:

- Profile data comes from `state.config.profile`.
- Avatar can be uploaded and downscaled to a small data URL.
- Display name can be edited and saved to config.
- Linked exchange rows are loaded from `/api/apikey` only while the popover is
  open.
- Device rows are loaded from `/api/sessions` only while the popover is open.
- `/api/sessions` is persisted browser-request telemetry: real browser user
  agents only, the last 24 hours returned (up to 100 rows), two minutes defining
  `Active`, and thirty days retained in SQLite. Command-line probes, bots, and
  API tools are excluded so health checks never appear as fake devices.
- A random first-party `cosmos_device` identity is created once per browser
  profile and hashed server-side. This is the durable device key; IP and
  User-Agent are evidence, not identity. Separate devices behind the same NAT
  with the same Chrome version must therefore remain separate. Privacy-blocked
  browsers may use the old IP/User-Agent fallback, but that fallback is hidden
  as soon as the matching token-backed profile exists so one device never
  appears twice. The response is `private, no-store`, the current profile sorts
  first, then active profiles, then newest `lastSeen`.
- This telemetry survives a server restart and records first seen, last seen,
  request count, browser, OS, IP, and country whenever those facts are actually
  available. It is not presented as Cloudflare's authenticated-session
  inventory; that API is not wired in the current deployment.
- Logout goes to Cloudflare Access:
  - Localhost links to `https://arbitrage.cosmosgeek.org/cdn-cgi/access/logout`.
  - Deployed host uses `/cdn-cgi/access/logout`.

Current profile layout:

- Panel: the same 400px shared shell used by Appearance and every other trigger.
- Topbar trigger: 42px hit target with a 34px circular photograph, exactly 30%
  smaller than the former 48px photograph.
- Header: 84px-high identity row with a 42px circular avatar, exactly half the
  former 84px avatar, and a 12px gap to identity text.
- Name: 15px / 20px, weight 600.
- Sub line: 12px / 16px, weight 400.
- Sections:
  - Connected Exchange with real key row.
  - Recent Browser Sessions with every returned 24-hour row in a bounded,
    scrollable list and a visible thin scrollbar when the list overflows.
  - Log Out full-width bar.
- Live dots use a restrained 1.65-second signal pulse. Reduced Motion disables
  the animation.
- Exchange/device rows are 52-56px with a hairline divider.
- No Dashboard, Assets, Orders, Risk, or Settings filler rows in this popover.

## 11. Failures To Avoid

These exact failures already cost time:

- Creating fake buttons/toggles that only change text.
- Removing useful words until controls become icon soup.
- Adding boxes around everything in the topbar.
- Adding decorative dots around every icon.
- Turning the sidebar into tinted cards or boxed icon tiles.
- Using heavy active nav text (700+) instead of 560.
- Moving persistent text with transforms, causing blurry labels.
- Adding huge topbar panels that create a page scrollbar.
- Using static glow where the owner asked for a moving beam.
- Making clock motion fast or purple.
- Forgetting that the search must close on outside click.
- Inspecting compressed screenshots but not computed styles.
- Editing old CSS blocks that are overridden later.
- Editing `contentClean()` and expecting the rendered topbar to change.

## 12. Verification Checklist For Future UI Work

Before saying a topbar/sidebar/search/profile change is done:

1. Run the build/test command relevant to the change.
2. Reload `http://localhost:8080/`.
3. Measure these selectors:
   - `.snav-item`
   - `.topbar-search .snav-search-box`
   - `.clock-pro-btn`
   - `.smenu`
   - `.acct-pop.cb-acct-pop`
4. Click every touched trigger and capture panel geometry.
5. For search, test focus, type a token, Escape, and outside click.
6. For account, verify `/api/apikey`, `/api/sessions`, and logout href.
7. Verify no page scrollbar was introduced by a topbar popover.
8. Verify the control is real or honestly disabled/planned.
9. Compare against this file and Part I of this file before replying.

## 13. Shared Topbar Popover Baseline (2026-07-10 16:44 IST)

The rendered topbar is now one left-to-right family. These measurements are the
live baseline, not design suggestions:

| Role | Measured Value |
| --- | --- |
| Sheet | `398 × 486px`, zero document or sheet overflow |
| Operational Header | `70px`; Account identity header `84px` |
| Header Title | `16px / 540 / 21px` |
| Header Subtitle | `11.25px / 400 / 16px` |
| Persistent Row Primary | `12.75px / 470 / 18px` |
| Persistent Row Secondary | `10.5px / 400 / 15px` |
| Numeric / Right Value | mono `11.5px / 450 / 16px`, tabular lining figures |
| Status | mono/caps `9.75px / 500 / 14px` |
| Content Rail | `14px` left/right; hairline row boundaries |
| Footer Bars | `0` visible across all ten popovers |

Panel-specific contracts:

- Clock has one 58px precision stage and five equal timezone tracks.
- AWS keeps target facts, two inline destinations, two real gates, and one
  truthful channel note. Destination actions are adjacent to the target—not a
  footer.
- API Keys uses two continuous key sections; six permissions per key form a
  two-column structured list with no outer key cards or permission pills.
- Trust uses one continuous three-cell summary band and five equal check rows.
  The duplicate Risk/Health footer navigation is removed.
- Notifications has one compact inline tool row followed by the live alert
  tape. Mark Read and Open Center are not repeated at the bottom.
- Execution preserves the emergency control at the top and distributes four
  real mode rows to the remaining height.
- Currency, Basis, and Appearance provenance is a flat hairline row with
  transparent background, zero margin, and zero radius.
- Account keeps real profile, exchange posture, browser IP/device/request
  telemetry, and one plain destructive logout row. It contains no generic
  navigation or filler features.

The mandatory visual sweep is Clock → AWS → API → Trust → Notifications →
Execution → Currency → Basis → Appearance → Account in Light, then Dark. Test
Clock zone, display currency, basis unit, and Open Center controls; restore IST,
USD, Percent, Light, and the original page before handoff.
