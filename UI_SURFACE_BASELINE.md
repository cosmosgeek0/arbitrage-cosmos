# UI_SURFACE_BASELINE.md - Current Sidebar, Topbar, Search, Clock, And Profile Lessons

Last audited: 2026-07-10 08:30 IST

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
| Sidebar Row | 40px high | about 40px | Flow-style calm row rhythm. |
| Sidebar Label | 14px / 20px, 500 | active 560 | Crisp text matters more than background. |
| Sidebar Group | 9px / 12px, 720, uppercase | muted caps | Small section labels, not huge category banners. |
| Topbar Search | 42px high, about 440px wide | 44px x 462px | Coinbase pill aligned to content start. |
| Topbar Icon | 34px target + 4px halo | about 34px | Icon-first, transparent hit target, semantic color. |
| Shared Popover | 400px, 14px radius | measured height | One persistent shell for every panel. |
| Account Sheet | 400px shared shell | same as every trigger | Real profile, exchange, session, and logout rows. |

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

The owner explicitly reopened the former still-clock rule on 2026-07-10. The
clock remains a precision instrument, but now has one deliberate animated mark.

Current trigger:

- `148px × 42px` at 100%, containing a `27px` code-native hourglass, `HH:MM`,
  one small bullet, and the short market-desk code, for example `08:25 · IST`.
- The trigger color comes from the live Appearance accent. Never hardcode the
  old red rail tone or blue pill; changing Accent must recolor the hourglass,
  bullet, zone, edge, and popup identity immediately.
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
- Trigger targets are 34px CSS with a 4px invisible halo, transparent background, no visible box by
  default.
- Use color identity across the row, roughly ROYGBIV from AWS CLI through
  Appearance:
  - AWS CLI: red/salmon terminal tone.
  - API Key: orange/vault tone.
  - Data Health: yellow/ops tone.
  - Trust Advisor: green/security tone.
  - Notifications: teal/account feed tone.
  - Kill Switch/Trading Mode: blue control tone.
  - Market Ping: blue/cyan refresh tone.
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

- The owner-supplied orange AWS cloud image is the identity on both the rail and
  opened surface. Keep its native wide silhouette; do not put it in a circle.
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
- The Binance brand remains the popup identity. The owner-supplied green API
  key artwork is used directly on the rail trigger and as the key-object mark;
  do not redraw it as a generic glyph or wrap it in a circular badge.
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

### Data Health

What makes it useful:

- The owner-supplied green database-and-shield artwork is the Data Health
  identity in both the trigger and popup header. Keep it source-exact; do not
  swap it back to a generic database glyph.
- Data comes from `/api/system`, `/api/news`, `/api/calendar`, and `/api/fx`.
- Compact score and counters: streams, latency, request weight.
- Rows are short but meaningful: Feed, Account, News, Calendar, FX, Drift,
  Pairs.
- All measured rows fit inside the fixed 400px popup. `Open System Health` is a
  real 374px by 42px full-width footer action, matching the Account Details
  action footprint and routing to the real Health surface.
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
  evidence ledger. Notifications is the much smaller owner-interruption layer:
  failures, blocked actions, emergency controls, account/execution changes, bot
  health, opened opportunities, and exchange announcements.
- Scanner decisions, snapshots, heartbeats, reconnect attempts, candidate
  telemetry, closed strategy signals, and logo/network decoration failures stay
  in Logs. They never enter the notification inbox.
- The topbar client maintains a five-second incremental ledger cursor so a real
  alert cannot disappear merely because scanner telemetry pushed it outside the
  server's latest 30-event state payload.
- Compact tray uses the Coinbase-clean account popover grammar already approved:
  sourced bell identity, quiet heading, curated grouped rows, and real Mark Read
  / Open Center actions. Do not add filter strips or preferences to the tray.
- Short bursts are grouped by category, alert title, subject, and time window;
  rows show the exact grouped count and latest real timestamp. Investigation
  evidence is never lost because the immutable source remains Logs.
- Compact tray must stay in the topbar popover family, close to the clock and
  account-detail footprint. Do not force page-like dimensions or giant empty
  regions.
- Expanded view is one full-width popup, never a route and never a split feed /
  inspector wall. It contains the sourced bell header, real notification rules,
  honest delivery posture, seven selectable day cards, category filters, one
  dense alert tape, and an always-visible footer.
- The five persisted rule switches are Critical & Security, Account & Execution,
  Bot Health, Opportunities, and Announcements. Old proposal/fill/risk settings
  migrate into this schema. Draft changes preview the tape immediately; Discard
  restores saved state and Save Changes writes `prefs.alerts`.
- In-App is the only active channel. Email and WhatsApp remain static Planned
  labels until a real contact-point backend exists. Never render them as working
  toggles.
- Seven-day history is fetched from `/api/events`, curated client-side, and
  grouped only for presentation. Day cards show truthful total and critical
  counts. Open Logs is a real navigation action back to the full evidence page.
- Modal typography stays restrained: title around 22px/590, rule and row titles
  around 12-13px/560, metadata around 9.5-11.5px/420-540, 1px hairlines, and no
  swollen display counters.
- Category marks are real icons: Critical = Shield Alert, Account = Wallet,
  Bot = operations/log mark, Opportunities = Radar, Announcements = Newspaper.

### Kill Switch / Trading Mode

What makes it useful:

- Real controls only:
  - Halt calls `setKill(true)`.
  - Manual calls `saveConfig({ killSwitch: false, liveTradingEnabled: false })`.
  - Live calls `saveConfig({ killSwitch: false, liveTradingEnabled: true })`.
- Live can be disabled based on real prerequisites.
- This is the model for bot guardrails. Do not create fake "blocked" toggles
  that only change text.

### Market Ping

What makes it useful:

- The owner-supplied blue circular-arrow PNG is the identity in both the
  trigger and popup header. Do not replace it with a generic refresh glyph.
- The popup controls exactly four real browser-polling surfaces: Market Price,
  Account Data, News Context, and Calendar.
- Every selector exposes the same exact values: `<1s`, `1s`, `3s`, `5s`, and
  `10s`. Old saved values migrate to the nearest supported choice.
- Closed selectors are 58px by 32px. Keep the native single-select menu so the
  open state retains the platform's smooth rounded list, selected checkmark,
  and keyboard behavior.
- News and Calendar must honor their selected values. Do not show a timing
  option if the corresponding page silently clamps it to a different cadence.
- Keep the panel compact and truthful; no separate settings page or duplicate
  FX, Health, or Token cadence rows in this popup.

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

- Panel: the same 400px shared shell used by Appearance and every other trigger.
- Header: 42px avatar, 11px gap to identity text, 70px overall.
- Name: 15px / 20px, weight 600.
- Sub line: 12px / 16px, weight 400.
- Sections:
  - Connected Exchange with real key row.
  - Linked Devices with real session rows.
  - Log Out full-width bar.
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
9. Compare against this file and `DESIGN_PLAYBOOK.md` before replying.
