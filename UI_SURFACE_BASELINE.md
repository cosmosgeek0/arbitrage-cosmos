# UI_SURFACE_BASELINE.md - Current Sidebar, Topbar, Search, Clock, And Profile Lessons

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
  it answers what is stuck, what changed state, what execution needs attention,
  and where the selected alert is delivered.
- The admitted set is intentionally narrow: execution/risk failures, order/fill/
  loan outcomes, emergency/control transitions, bot/runtime dependency state,
  and explicitly connected AWS EC2/CloudWatch/Health state changes.
- Scanner decisions, opportunities, news, announcements, snapshots, heartbeats,
  candidate telemetry, ordinary account sync, watch/config churn, and decoration
  failures stay in Logs. They never enter the notification inbox.
- The topbar client maintains a five-second incremental ledger cursor so a real
  alert cannot disappear merely because scanner telemetry pushed it outside the
  server's latest 30-event state payload.
- Compact tray uses the Coinbase-clean account popover grammar already approved:
  sourced bell identity, quiet heading, curated grouped rows, and real Mark Read
  / Open Center actions. Do not add filter strips or preferences to the tray.
- Repeated runtime and infrastructure transitions collapse into one daily
  incident carrying the exact underlying event count. Execution bursts use a
  shorter grouping window. The newest state wins, so a recovery replaces an old
  firing state instead of leaving both as open blockers. Investigation evidence
  is never lost because the immutable source remains Logs.
- Compact tray must stay in the topbar popover family, close to the clock and
  account-detail footprint. Do not force page-like dimensions or giant empty
  regions.
- The full notification center is a first-class Utility page directly below
  Calendar, not a modal. The topbar bell remains the compact tray and its Open
  Center action navigates to `page='notifications'`.
- Notifications uses the exact News / Calendar one-frame geometry: `x=189`,
  `y=75`, `1px` edge, `12px` radius at the current 1280×720 owner viewport, a `57px` toolbar,
  rolling seven-day cards, segmented filters, and one curated inbox. Route changes
  between Notifications, News, and Calendar must not move the frame.
- Inbox and Routing are the only two page views. Inbox keeps Needs Attention
  first and reports the real number of raw events excluded and repeats grouped.
  Routing owns source readiness, destination readiness, noise policy, and the
  four persisted rules: Needs Attention, Execution Outcomes, Bot Health, and
  Infrastructure.
- In-App is the only active destination. Email, Telegram, WhatsApp, and AWS SNS
  show Not Connected until a real server-side provider exists. They are never
  rendered as working toggles. AWS is an optional real input through
  `/api/notifications/ingest/aws`; it fails closed until the server bearer token
  is configured and accepts only EC2, CloudWatch, and AWS Health sources.
- Seven-day history is fetched from `/api/events` with `beforeId` cursor
  pagination, curated client-side, and grouped only for presentation. This is
  required because a busy ledger can exceed the 20,000-row per-request ceiling;
  never let that cap falsely render an older day as empty.
- Page typography stays restrained and matches News / Calendar: title 22px/540,
  rule and alert titles around 10.5-13px/480-540, metadata around
  9.5-11.5px/410-470, 1px hairlines, and no swollen display counters.
- Category marks are real icons: Critical = Shield Alert, Account = Wallet,
  Bot = operations/log mark, Opportunities = Radar, Announcements = Newspaper.

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

- Market Ping and Data Health no longer exist in the topbar. Their four real
  browser-polling controls and every source-health check live in the single
  bottom-right `RefreshDock` Connection Watchman.
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
  Per-row controls call real reset targets. The outer control calls `all` and
  also rebuilds the browser WebSocket.
- `GET /api/system.connections.watchman` owns the component inventory and
  summary. AWS Runner and Cloudflare remain visibly Planned/Not Configured
  until prerequisites exist. The always-available in-app notification route is
  explicit; external delivery remains honest in Notifications.
- The server logs only status transitions as `connection_alert` or
  `connection_recovered`; these are promoted into Notifications without copying
  raw health logs or spamming every five-second probe. Browser RTT/socket state
  is reported through the sanitized `/api/connections/browser-observation`
  endpoint because that path cannot be measured truthfully from the server.
- Cadence choices are exact persisted radio groups: `<1s`, `1s`, `3s`, `5s`,
  and `10s`. News and Calendar must honor the selected value; never present a
  cadence that the mounted page silently ignores.
- Controls must not repeat recovery as cards or per-view footers. One persistent
  Recovery Target selector owns `all/market/runtime/account/news/calendar/fx`
  and one equal-height `Run Recovery` action calls the existing backend. That
  console stays visible at the bottom of Overview, Connections, and Sources.
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
9. Compare against this file and `DESIGN_PLAYBOOK.md` before replying.

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
