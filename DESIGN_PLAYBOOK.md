# DESIGN_PLAYBOOK.md — how this cockpit's UI actually gets built

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
7. Monitor + kill-switches only — NO manual money-action UI ever (trading,
   borrow, repay, collateral). Action routes belong to the engine.
8. Click every control in real Chrome; restore any state you flipped.
9. Log the pass in PROJECT_MEMORY.md before moving on.

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
   `AGENTS.md`, `PROJECT_MEMORY.md`, and this playbook. External memory may
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
repeat runtime/infrastructure transitions into incidents and retain the exact
underlying count; a later recovery replaces the old firing state in the inbox.
The compact topbar tray shows only the same curated incidents and opens the
full Utility page. The page keeps News/Calendar geometry and has two purposeful
views only: Inbox and Routing. Routing separates sources, delivery destinations,
noise policy, and persisted alert rules. In-App may show Active; Email, Telegram,
WhatsApp, AWS SNS, and AWS intake must show Not Connected or Connector Required
until their real server-side capability exists. No fake delivery toggles, no
browser-held credentials, and no second Logs tape disguised as notifications.

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
(24px optical marks; bell 25px), search = Coinbase pill 42px r21 "Search for an asset" + ⌘K
chip, sidebar currently 178px with 36px Flow-style rows and 27-29px marks, content stretches
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
- Related commands get one control grammar. If six backend targets perform the
  same recovery operation, use one target selector plus one action; do not
  repeat them as a card grid and again in a footer. Buttons sharing one action
  group must use equal height and one spacing token; empty space is preferable
  to duplicate navigation or decorative filler.

**G. Current surface baseline:** before editing the left sidebar, brand/topbar,
global search, clock, AWS CLI, API key, Trust Advisor,
Notifications, Kill Switch / Trading Mode, Connection Watchman, Display Currency,
Basis Display, Appearance, or Account Details profile, read
`UI_SURFACE_BASELINE.md`. It records the measured current geometry, text sizes,
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
  (no Asset View tab) with ALL nine Binance buckets listed; allocation is ONE
  big donut. Hero: eye-mask, ≈BTC line, Today's PnL from equity snapshots
  (`account.dayChangeUsd`), 1W/1M/3M/6M chart.
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
9. Preview/server traps: launch.json `cosmos` has autoPort → a STALE server
   can serve OLD dist on a random port with the preview attached. Before
   debugging "broken" behavior: `preview_list` + check which port the page's
   network requests hit. Vite (5273, "web") proxies /api→8080. After editing
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
- Gates: `server/test/gates.mjs` (`npm test` from root, 50 must pass).

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
3. `npm run build` (web and/or server) + `npx tsc --noEmit` (vite doesn't
   typecheck!). Server changes: rebuild dist + restart the 8080 process.
4. Verify in preview: computed styles on glyph spans, click every control,
   screenshot at 125% AND 100%, 1440 AND 1920, light AND dark.
5. Nav crash sweep (click all sidebar items, check for error boundary),
   console errors, `npm test` → 50/50.
6. Log the pass in PROJECT_MEMORY.md (what/why/gotchas) BEFORE moving on —
   update as you move, not at the end.
