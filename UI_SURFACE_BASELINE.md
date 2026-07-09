# UI_SURFACE_BASELINE.md - Current Sidebar, Topbar, Search, Clock, And Profile Lessons

Last audited: 2026-07-09 06:46 IST

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
- Current root zoom/prefs make measured browser rectangles about 1.05x the CSS
  values. The CSS intent matters more than the raw screenshot pixels.

Important code trap:

- `SharedTopBar()` renders `content(active)`.
- `contentClean()` still exists in `Header.tsx`, but it is not the rendered
  topbar panel path. Do not copy or edit that branch unless the render call is
  changed deliberately.
- `styles.css` contains many older named blocks. The effective sidebar/search/
  clock/profile rules are mostly the late override blocks near the bottom. When
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
| Header | 64px high | about 67px at current zoom | White, flat, no tint band. |
| Sidebar | 178px wide | about 187px at current zoom | White nav rail, no gradient/tint exterior. |
| Sidebar Row | 40px high | about 42px | Flow-style calm row rhythm. |
| Sidebar Label | 14px / 20px, 500 | active 560 | Crisp text matters more than background. |
| Sidebar Group | 9px / 12px, 720, uppercase | muted caps | Small section labels, not huge category banners. |
| Topbar Search | 42px high, about 440px wide | 44px x 462px | Coinbase pill aligned to content start. |
| Topbar Icon | 38px target | about 40px | Icon-first, transparent hit target, color identity. |
| Shared Popover | 14px padding, 12px radius | width from `MENU_W` | Same chrome for every topbar panel. |
| Account Popover | 438px wide, 24px pad | about 460px | Binance/Coinbase profile menu spacing. |

Never judge these from memory. Use `getComputedStyle()` on the exact element and
`getBoundingClientRect()` at the user's current zoom.

## 3. Sidebar Lesson

The owner compared this directly against a Flow sidebar. The lesson was text
quality, not background decoration.

Current sidebar standard:

- White panel background, no exterior tint, no gradient wash.
- Group spacing: 12px group gap, group title margin 12px 11px 8px.
- Group title: 9px, 12px line-height, 720, uppercase, letter spacing 0.16em,
  muted gray.
- Row: 40px high, 8px radius, 11px horizontal padding, 22px icon column, 9px
  gap.
- Label: 14px, 20px line-height, weight 500 normal, 560 active.
- Inactive icon: bare glyph in a 22px slot, transparent background, 18px glyph,
  stroke about 2.05.
- Active row: subtle warm fill (`#f0ede6`), not a loud blue block. Hover uses
  `#f5f2ec`.
- No `translateX(1px)` or subpixel text movement on persistent nav labels.
  That made the type look soft/blurry.
- No boxed inactive icon tiles. They made the sidebar look heavier and less
  premium.
- No random dots, active lines, or side rails unless the owner asks for a new
  nav language.

If the sidebar looks blurry, inspect in this order:

1. Root zoom and browser zoom.
2. Font family actually applied to `.snav-item`.
3. Font size, line-height, and weight.
4. Whether a transform is applied to the text or row.
5. Whether icon boxes or tinted backgrounds are creating visual noise.

## 4. Brand Lockup Lesson

The brand is a restrained control-room identity, not a landing-page hero.

Current standard:

- Header brand hit area: 48px high.
- Mark: 37px, subtle drop shadow, only tiny hover lift.
- Name: "Arbitrage", 18px, weight about 740, tight but not decorative.
- Sub: "CONTROL ROOM", 10px mono/caps, 680, letter spacing about 0.135em.
- No huge sidebar masthead, no extra decorative line collisions around the
  brand, no tint block behind the logo.

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

The clock is a precision instrument, not an animated toy.

Current trigger:

- Pill, about 168px wide CSS, 36px high measured at zoom.
- Shows full time with AM/PM and short zone label, for example `06:40:25 AM LOC`.
- Seconds stay in the same line as hour/minute, not in a separate weird box.
- No printed `UTC+5:30` in the trigger.

Current motion:

- Keep the small orbit because it gave the clock character.
- Orbit is slow: about 28s.
- Inner sweep is calm: about 18s.
- No purple orbit, no aggressive one-second spinning ring.

Popover:

- Width from `MENU_W.clock = 360`.
- Hero says Execution Time, then full time, zone/date, and Live.
- UTC and Local are paired in the same section.
- Zone rows are about 49px CSS / 51px measured, with code, city/offset, and
  current time.

## 7. Topbar Trigger Law

The topbar is for expert operator controls. It should look alive, but not noisy.

Current trigger pattern:

- Topbar triggers are icon-first.
- Trigger targets are 38px CSS, transparent background, no visible box by
  default.
- Use color identity across the row, roughly ROYGBIV from AWS CLI through
  Appearance:
  - AWS CLI: red/salmon terminal tone.
  - API Key: orange/vault tone.
  - Data Health: yellow/ops tone.
  - Trust Advisor: green/security tone.
  - Notifications: teal/account feed tone.
  - Kill Switch/Trading Mode: blue control tone.
  - Market Refresh: blue/indigo refresh tone.
  - Currency: indigo money tone.
  - Basis: violet percentage tone.
  - Appearance: purple/violet display tone.
- No words on the trigger itself except compact meaningful symbols like `$`,
  `%`, or `bp`.
- Words belong in title/aria and inside the popover.
- Avoid adding random status dots around every icon. A tiny status mark is only
  allowed when it carries real state and is visually integrated with the glyph.
- Do not wrap every icon in a visible circle or box. The hit target can be 38px;
  the visible object should stay light.

## 8. Shared Popover Anatomy

All topbar panels use the same base chrome:

- `.smenu`: 14px padding, 12px radius, 1px `var(--line-2)` border, opaque white
  panel, compact shadow.
- Width comes from `MENU_W` in `Header.tsx`:
  - clock 360
  - shell 320
  - api 320
  - data 320
  - advisor 320
  - notifications 340
  - power 270
  - market refresh 300
  - currency 280
  - basis 260
  - appearance 260
- Popovers may morph between triggers but should not become huge boxes that add
  a page scrollbar.
- Use a hero/instrument area only when it communicates state.
- Rows are usually 34-50px CSS depending on content density.
- Labels and words are allowed when they clarify state or controls. "Less words"
  means remove filler, not remove necessary labels.

## 9. Individual Topbar Panel Lessons

### AWS CLI / CloudShell

What makes it work:

- It is allowed to be dark because it is a terminal metaphor.
- It uses AWS CLI language: `AWS CLI`, host, path, auth, command line.
- The dark stage is compact and contained; the surrounding panel stays white.
- It has real actions: open in-app CloudShell overlay and open AWS console.
- It must not pretend an attached shell exists. Copy in code already says it is
  a launcher, not an attached session.

### API Key

What makes it useful:

- Data comes from `/api/apikey`.
- Shows key count, live count, IP lock posture.
- Shows read-only and planned/full key rows.
- Shows a compact permission matrix with R/F columns.
- Withdrawals are a special risk row.
- Avoid fake "secure" badges; show actual permissions and status.

### Data Health

What makes it useful:

- Data comes from `/api/system`, `/api/news`, `/api/calendar`, and `/api/fx`.
- Compact score and counters: streams, latency, request weight.
- Rows are short but meaningful: Feed, Account, News, Calendar, FX, Drift,
  Pairs.
- Do not turn this into verbose prose. Do not reduce it to unlabeled dots.

### Trust Advisor

What makes it useful:

- It is a bot-control and settings audit, not a notification inbox. It answers:
  which automation controls, account/security settings, feeds, and guardrails
  need attention before the bot is trusted.
- It is a derived safety scan from real state: withdrawal posture, account sync,
  socket, market feeds, read key, allowlist, kill switch, Cloudflare gate.
- It uses the Trusted Advisor severity model: Action Recommended, Investigation
  Recommended, and No Problems Detected. These three groups must stay visible.
- Counts action/review/pass, then shows one or two focus checks from real state.
- Details/footer actions navigate to relevant existing pages such as Risk and
  Health/System. Do not create fake control pages.
- Do not invent fake warnings. If there is no real check, do not show it.
- Keep this panel in the same topbar family as Clock: compact header card,
  hairline severity rows, real icons, visible footer actions, no giant score
  tile, no decorative status animation.

### Notifications

What makes it useful:

- Uses `state.events`; compact topbar rows open the notification modal instead
  of dumping the operator into the ledger.
- Compact tray uses the Coinbase notification screenshot as the base: a quiet
  title row, one settings/expand affordance, rounded pill filters, and one
  repeated notification row grammar. Do not add a counter strip, score tile,
  hero card, "Review new" prose, footer action strip, or multiple visual ways
  of saying the same alert state.
- Compact rows use category/date kicker, short title, and a readable summary
  beside one real icon medallion. The tray is allowed to leave empty white
  space; do not cram it into a mini-dashboard.
- Compact tray must stay in the topbar popover family, close to the clock and
  account-detail footprint. Do not force page-like dimensions or giant empty
  regions. Hidden compact filters must not control the visible state; if Logs
  is only available in the expanded center, the compact tray falls back to All.
- Expanded modal uses a blurred backdrop and should use most of the available
  page: about `min(1220px, 100vw - 68px)` CSS wide and
  `calc((100vh - 48px) / var(--uiz, 1))` tall so it fits under the app zoom.
  It stays a popup, not a route/page, but it must not feel cramped. It starts
  near the top and keeps actions inside the surfaces that own them.
- The event feed must not stretch rows just because the modal is tall. Use a
  scroll/feed area that aligns content to the top; rows should keep their own
  height and the footer must remain visible.
- Current expanded modal is one integrated center, not a Feed/Preferences tab
  switcher and not a duplicate status dashboard: left side = filterable
  notification feed, right side = Advanced Alerts / Delivery / Types Of
  Notifications. This is where interactive preference editing belongs.
- Modal typography follows the crisp type law: title about 28px / 520, large
  counters about 31px / 430, row titles about 16px / 520, subcopy about
  13-15px / 420. Do not reintroduce 680-760 weights here.
- Feed category marks are real icons, not random letters like A/O/L. Current
  mapping: Critical = Shield, Opportunity = Radar, Account = Wallet, Logs =
  Receipt.
- Preference toggles are real `prefs.alerts` switches: Opportunity Alerts,
  Account Activity, Critical Risk, Binance Announcements.
- Preferences use Coinbase-style wording and rhythm: "Advanced Alerts" plus
  "Select preferred channels and contents for control-room notifications."
  Current baseline uses the same row system inside the expanded center: bare
  line icons, roughly 64-74px rows, 18px / 430 labels, switch column hard-right,
  and Cancel / Save Changes inside the settings column.
- In-app delivery is shown as current; WhatsApp Agent can be shown as Planned
  only until it is wired. Do not create fake delivery toggles.
- Preferences are edited as a draft: Cancel discards, Save Changes writes
  `prefs.alerts`. Verify this behavior before changing the surface.
- The panel is an account/control-room alert inbox: opportunities, account
  issues, risk blocks, and log/system signals. It is not random token spam.

### Kill Switch / Trading Mode

What makes it useful:

- Real controls only:
  - Halt calls `setKill(true)`.
  - Manual calls `saveConfig({ killSwitch: false, liveTradingEnabled: false })`.
  - Live calls `saveConfig({ killSwitch: false, liveTradingEnabled: true })`.
- Live can be disabled based on real prerequisites.
- This is the model for bot guardrails. Do not create fake "blocked" toggles
  that only change text.

### Market Refresh

What makes it useful:

- Presets are real: 3s, 6s, 12s, 30s.
- Custom input clamps to 3-120 seconds.
- Plus/minus adjusts the real preference.
- "Now" calls the real `refresh()` path.
- Keep the panel compact; no separate settings page for this.

### Display Currency

What makes it useful:

- Uses `/api/fx` for rates.
- Options are real display preferences: USD, INR, EUR, JPY.
- Trigger can show the currency symbol, but the popover must show code/rate.
- Do not name this "Color" or another unrelated setting.

### Basis Display

What makes it useful:

- Only switches the real basis unit preference: percent or basis points.
- Two options are enough.
- Keep examples: `+0.042%` and `+4.2`.
- Do not make a large decorative panel for two states.

### Appearance

What makes it useful:

- Real controls: theme mode, accent dots, zoom scale.
- Keep accent choices as small circles/dots, not named color cards.
- Theme buttons may use compact symbols, but do not remove all context if the
  owner says it feels like symbol soup.
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
- Devices shown are current, active, or seen in the last 90 seconds, capped at
  10.
- Logout goes to Cloudflare Access:
  - Localhost links to `https://arbitrage.cosmosgeek.org/cdn-cgi/access/logout`.
  - Deployed host uses `/cdn-cgi/access/logout`.

Current profile layout:

- Panel: 438px CSS wide, 24px padding, 16px radius, white, soft shadow.
- Header: 58px avatar, 22px gap to identity text.
- Name: 23px, weight 720.
- Sub line: 15px, weight 470.
- Sections:
  - Connected Exchange with real key row.
  - Linked Devices with real session rows.
  - Log Out full-width bar.
- Exchange/device rows are about 58px CSS high with a hairline divider.
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
9. Compare against this file and `DESIGN_PLAYBOOK.md` before replying.
