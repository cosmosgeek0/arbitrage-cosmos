# PROJECT_MEMORY.md — Arbitrage Capital Control Room

Last updated: 2026-07-10 17:36 IST
Permanent role of this file: the durable living-state log for the project. The other three core docs are mostly static blueprints; this file records what is *true right now* — current source-of-truth folder, git/deploy state, active phase, outstanding decisions, and a dated changelog. A new Director should read this file to learn the present state without any old chat history.

**UI WORK? Read `DESIGN_PLAYBOOK.md` FIRST** — the distilled, owner-calibrated design system, process, and gotcha catalog from the 2026-07-08 quality passes. The Account page is the owner's only approved "real quality" surface; the playbook is how to hit that bar without redoing five rounds.

Update this file whenever the project state changes. When in doubt, this file wins on "what is the current state"; the blueprints win on "what is the intended design."

---

## 1. Core docs and agent entrypoints

The permanent root docs and entrypoints are:

0. `AGENTS.md` — project-local instructions future coding agents should read automatically; this file points them at the durable context below.
1. `PROJECT_MEMORY.md` — this file. Current live state, dated changelog, latest owner rulings.
2. `DESIGN_PLAYBOOK.md` — mandatory UI quality bar, owner-calibrated design laws, ship gate, gotchas.
3. `UI_SURFACE_BASELINE.md` — detailed current baseline for the surfaces polished in the long topbar/sidebar pass: sidebar, brand, global search, clock, all topbar icons/popovers, notifications, kill switch, refresh, currency, basis, appearance, and account profile.
4. `DIRECTOR_RULEBOOK.md` — operating rules, safety laws, worker coordination, commit discipline.
5. `BLUEPRINT.md` — product / UI / backend / deploy / reconstruction blueprint.
6. `ENGINE.md` — engine / algorithm / risk / ledger blueprint.

`README.md` stays short and points to the docs. A new agent should start with
`AGENTS.md`, then read `PROJECT_MEMORY.md` and `DESIGN_PLAYBOOK.md` before UI
work. For topbar/sidebar/profile work, `UI_SURFACE_BASELINE.md` is mandatory.

---

## 2. Source-of-truth decision (current)

`/Users/cosmosgeek/Desktop/Main` is the **active source-of-truth working folder**. This overrides earlier notes in `DIRECTOR_RULEBOOK.md` §7 / `BLUEPRINT.md` §4 that treated `Main` as an untrusted post-Spark recovery copy.

Owner directive (2026-07-07):
- Do not treat old folder names (e.g. `arbitrage-cosmos`) as authoritative.
- Do not restore from `/Users/cosmosgeek/Desktop/arbitrage-cosmos` unless explicitly asked.
- Do not treat old GitHub `main` history as product truth.
- Use `Main` for surgical edits and normal work.

`Main` is now Git-tracked for bookkeeping and recoverability (see §3).

---

## 3. Git / remote state

- Local Git: initialized in `Main` on 2026-07-07 (for bookkeeping + recoverability). Before init, a safety copy of the working tree was taken to `~/Desktop/Main-safety-<timestamp>` (excludes regenerable `node_modules/`).
- Remote `origin`: `git@github.com:cosmosgeek0/arbitrage-cosmos.git`. SSH auth verified working as GitHub user `cosmosgeek0`.
- History posture: the fresh local history is unrelated to the old GitHub `main`. Do **not** force-push over old `main`. The current tree is published to branch `current-main` instead of overwriting old history.
- `.gitignore` excludes: `node_modules/`, `dist/`, `data/`, `.env`, `.env.*` (keeps `.env.example`), `.DS_Store`, `*.log`. Runtime DB (`data/cosmos.db*`) is intentionally not tracked; it is preserved on disk and in the safety copy.

---

## 4. Current app-state snapshot

- Stack: npm workspaces — `server/` (Node + TypeScript, `src/{binance,engine,services,config.ts,index.ts,ledger.ts,types.ts}`) and `web/` (React + Vite, `src/{App.tsx,pages,components,store.tsx,styles.css}`).
- Root scripts (`package.json`): `build` = server+web builds; `start` = `node server/dist/index.js`; `dev` = `npm run dev -w server`; `test` = `node server/test/gates.mjs`.
- `data/cosmos.db` present (SQLite ledger/state, active WAL). Preserve.
- `.env` absent (good). `.env.example` present, placeholders only — no real keys anywhere in tree.
- No Binance keys wired yet. Account surfaces should show disconnected/setup state, not fake data.

---

## 5. Active phase and next actions

**PHASE SNAPSHOT (2026-07-07 night): UI PHASE CLOSED + WORKSPACE CLEANED — ENGINE SPRINT READY.**
- Cockpit done to owner's product-truth standard (see run log); read-only Binance live; build clean, gates 50/50; localhost:8080 serving HTTP 200 with 3 feeds + account connected.
- Recovery tags on origin: **`baseline-pre-engine-sprint` = THE restore point if the engine sprint fails** (→ 2de6061, full clean state, gates 50/50); plus checkpoint-ui-complete-pre-engine, skeleton-pass1, session-tracking. Restore: `git checkout baseline-pre-engine-sprint` or branch from it.
- **Workspace cleaned for the engine sprint:** all `cosmos-*` worktree folders removed (owner deleted; registry pruned); all `rebuild-*` + `engine-part0` branches deleted (content byte-verified on current-main, pushed + tagged); stale worktree dev servers killed; stale TASK briefs removed; old `Main-safety-*` copy gone (covered by pushed commit 68b28c7). Single worktree = Main, single branch = current-main. Clean highway.
- **Active engine work order: `TASK_ENGINE_CHASSIS.md`** (Main root, gitignored) — Engine Chassis v0: new modules under `server/src/engine/v0/` (types/config/clock/universe/marketState/rolling/features/focus/basisScanner/volumeScanner/proposals/riskBridge/ledgerBridge/snapshots/runner) + `server/test/engine.mjs` synthetic proofs (8 required: basis open, stale reject, borrow reject, dead-volume wakeup, one-print reject, wide spread, kill switch, ledger+correlationId). Legacy engine/marketData+scanner stay functional; executor NOT built. Commit msg: `engine: add scanner chassis and synthetic proof`. (Part 0 survey brief superseded/removed — owner went straight to chassis.)
- **ACTIVE: TWO parallel Fable overdrive agents (final Fable window).** BASIS agent → `../cosmos-engine-overdrive` (branch `engine-overdrive`, `TASK_BASIS_OVERDRIVE.md`, owns `server/src/engine/basis/**` + `server/test/engine-basis.mjs`). VOLUME agent → `../cosmos-volume-overdrive` (branch `engine-volume-overdrive`, `TASK_VOLUME_OVERDRIVE.md`, owns `server/src/engine/volume/**` + `server/test/engine-volume.mjs`). v0 contracts READ-ONLY for both; each self-contained (duplication over collision); neither touches package.json/index.ts/web/.env/legacy files; Director merges both branches (incl. uncommitted files check), unifies duplicates later, wires routes/test scripts, doc-syncs. Single-agent order superseded.** Research-first (writes ENGINE_RESEARCH_NOTES.md from current Binance docs) then builds BOTH basis-lifecycle + volume-wakeup engines with architecture freedom under server/src/engine/ (contracts head start extendable), 14 synthetic proofs, hard walls (no UI/secrets/live-trading/withdrawals/legacy-file edits/Main). Fable works ONLY in that worktree; no other agent edits Main meanwhile; Director merges + doc-syncs after. Superseded: the Main-root `TASK_ENGINE_OVERDRIVE.md` single-tree order (removed). (older superseded order was `TASK_ENGINE_OVERDRIVE.md` in Main root, gitignored) — single-Fable Engine Baseline v0: BOTH basis lifecycle + volume/dead-token engines under `server/src/engine/v0/` (16-module map incl. priorityQueue/focusManager/syntheticRunner), 14 synthetic proofs, 6 `/api/engine/*` snapshot routes, frozen contracts as head start (extendable this run), gates must stay 50/50, commit `engine: add basis and volume scanner baseline`. Superseded + removed: chassis brief and the 4 lane worktrees/branches (all were fresh at 4b18a4b, zero work lost). (previous plan for reference: 4 parallel Fable lanes cut from `4b18a4b`) (frozen contracts `server/src/engine/v0/{types,config,clock}.ts` — Director-owned, workers must not edit). Lanes/worktrees (deps pre-installed, brief inside each): `cosmos-data`→engine-data (universe/marketState/rolling/features + engine-data.mjs), `cosmos-basis`→engine-basis (basisScanner/proposals + engine-basis.mjs), `cosmos-volume`→engine-volume (volumeScanner/focus + engine-volume.mjs), `cosmos-glue`→engine-glue (ledgerBridge/riskBridge/snapshots/runner + engine-e2e.mjs, fakes-injected). File ownership is disjoint; nobody edits package.json/index.ts (Director wires test scripts + routes + real-module runner wiring at merge). Merge order: data → basis → volume → glue, build+50 gates+lane tests between each; check worktrees for UNCOMMITTED files before declaring merged. Single-worker fallback order `TASK_ENGINE_CHASSIS.md` still in Main root (superseded by lanes unless run solo).
- (superseded) multi-Fable sprint prep notes: Collision rules when it starts: one worktree per Fable tab (`git worktree add -b engine-<module> ../cosmos-<module> current-main` + `npm install` in each); one module per brief per ENGINE.md §16 build order; **Director-owned merge points for engine work: `server/src/index.ts`, `server/src/types.ts`, `server/src/ledger.ts`, `package.json`, shared web files** — workers create NEW module files under `server/src/engine/` and NEW test files, never edit shared files unless the brief says so; Director merges sequentially with build+gates between each; before declaring any worker merged, check its worktree for UNCOMMITTED files and enumerate `git diff --name-only <base> <final-tip>`.


- Phase A (docs + state lock): four core docs present; Git bookkeeping established. **Done.**
- SKELETON PASS 1 (6-group sidebar, merged Execution page, Basis/Volume scanners, News/Calendar tiles restored, in-app CloudShell overlay): **Done** — committed & pushed, current head `be7a7f8` on `current-main`.
- Current phase: skeleton shipped, builds clean, gates 50/50; awaiting owner review before the next surface work.
- Next options (owner picks): (a) reference-image visual polish pass, surface-by-surface; (b) dark-mode pass; or (c) Engine v0 Part 0 planning-only survey (ENGINE.md §16). Engine coding stays gated until the skeleton is signed off.

---

## 6. Outstanding decisions / unknowns

- Whether to publish `current-main` to GitHub on every milestone or keep local-only between milestones.
- How/when to reconcile (or formally retire) the old GitHub `main` and the separate `arbitrage-cosmos` folder — not to be touched unless the owner asks.
- All infra unknowns from RULEBOOK §6 (AWS region, instance ID, security groups, tunnel ID, deploy-key write state, whether Binance keys exist) remain unverified.

---

## 7. Run log (newest first)

### 2026-07-10 18:09 IST — Account Rebuilt As A Clear Capital Master-Detail Workspace

- The owner-rejected Spot expansion was a hierarchy defect, not a data shortage. The old Account inserted a seven-column asset table directly between five-column wallet rows, producing `16` competing hairlines and making the parent account, child header, and asset rows read as peers. Live signed sources already supplied total/free/locked balances, price, market value, Earn, loan, margin, source age, and watchlist truth.
- Rebuilt Account around three explicit levels: executive capital facts; a wide `1fr / 320px` Balance History + Wallet Allocation band; and Capital Accounts as a `350px` wallet selector rail beside one dedicated selected-wallet workspace. Spot is selected by default. All ten Binance wallet buckets are selectable; Spot, Earn + Flexible Loan, and Cross Margin render their signed detail, while other buckets render an honest `Wallet Snapshot Only` state instead of pretending an asset adapter exists.
- The selected-wallet workspace owns its identity, Active/Cached state, Balance/Positions/Liability/Wallet Share facts, and one seven-column detail table. At 1280×720 the detail panel is `713px`; its table and rows both measure exactly `713px` client/scroll width, all wallet names are untruncated, document overflow is zero, and the detail uses only five structural dividers rather than the former sixteen. Account now carries the same 32/30px page identity slot and 53px/32px CTA tab rail as the accepted data-page family.
- No money action was added. Masking was toggled and restored; 1W/1M ranges, Open Orders, Recent Fills, Spot, Earn, Cross Margin, Funding snapshot-only, watchlist controls, Light/Dark, and source truth states were exercised. Production build passes, all `71/71` gates pass, and `git diff --check` passes. The mandatory Calendar → News → Health → Logs → Risk → Opportunities → Volume → Basis → Markets → Token → Borrow → Account → Dashboard sweep passed in both themes with every frame at `x=189/y=75`, `1065px`, `1px`, `12px`, and zero overflow. Light, Account, Overview, Spot, 1M, balances visible, and scroll top were restored.

### 2026-07-10 17:52 IST — Borrow And Markets Tab Rails Re-Aligned; Dashboard Identity Restored

- The apparent page drift was not an outer-frame problem: live geometry proved Markets and Borrow already shared `x=189/y=75`, the `57px` toolbar, and the same summary rail. Borrow alone switched its viewbar into an `86.25px` two-row layout at `1100px`, while Markets kept a `53px` single row until `850px`. Borrow also used `34px / 11.5px / black` pills against Markets' `32px / 12.5px / CTA` contract.
- Borrow now shares the Markets viewbar geometry and active language: `53px` rail, `16px` inset, `6px` gap, `32px` pills with `14px` horizontal padding and `12.5px / 470` type, plus the same `850px` stacking breakpoint. At 1280×720 both pages measure the first tab at `x=206/y=384`, with no document overflow.
- Dashboard now renders the existing `/dashboard-blocks.png` identity already used in the sidebar. It occupies the same `32px` identity slot and `30px` optical mark as Markets and Borrow, placing the Dashboard title at `x=248` without moving the shared frame or toolbar.
- Verification: production build passes, all `71/71` gates pass, `git diff --check` passes, Markets Derivatives and Borrow Assets tabs were exercised and restored, and the mandatory Calendar → News → Health → Logs → Risk → Opportunities → Volume → Basis → Markets → Token → Borrow → Account → Dashboard sweep passed in Light and Dark with every frame at `x=189/y=75`, `1065px`, `1px`, `12px`, zero overflow, and no crash boundary. Light, Dashboard, 1M, and scroll top were restored.

### 2026-07-10 17:36 IST — Token Rebuilt As A Stable Per-Instrument Market Intelligence Workspace

- Removed the owner-rejected `Basis Engine / Ignore` context strip. Token now reads continuously as Price Chart → Spot Money Flow + Futures Positioning → Basis & Carry → Derivatives Monitor → Verified Profile, inside the existing one-frame contract. No manual trade, borrow, repay, or decorative action was added.
- Repaired the chart instability at its source. The native line chart now uses measured-width geometry with a bounded `300–410px` plot height, thinner non-scaling lines, and 22% y-domain breathing room. Binance WebSocket klines own live updates while REST hydrates/reconciles every 30 seconds instead of refetching the full series every second. Returning to Token resets the shared scroll container to the instrument header.
- Promoted real per-token evidence already available in the repo: Spot aggregate-trade flow now shows net flow, buy share, print count, coverage, size buckets, and inflow; Basis uses a full-width responsive chart with price/index plus basis-rate axes; Derivatives has one current snapshot for funding/simple-annualized funding, direct 5-minute OI/change, perp volume/OI ratio, and 15-minute long/short liquidations, followed by the existing Funding/OI/Volume/Liquidation history modes.
- Activated the repo's existing `GET /api/futures/telemetry` aggregation on the Token page. Futures Positioning now shows Binance USD-M taker buy/sell flow, global account long/short ratio, top-trader account ratio, and top-trader position ratio with the official 30-day coverage limit. Current Binance docs and live responses were rechecked before implementation; CoinGlass/Coinbase were used only as information-hierarchy references, not as invented data sources.
- Fast truth states were verified on BTC and USDC. BTC hydrated `$6.66B` OI plus 5-minute change directly after opening and rendered the full derivatives stack; USDC retained live Spot flow while every futures-only area reported `Spot Only`. Binance liquidation history remains the repo's persisted `!forceOrder@arr` recording with no fake backfill.
- Verification: web and server production builds pass, all `71/71` gates pass, `git diff --check` passes, `/api/futures/telemetry` returned all five BTC series with zero source errors, and browser console warnings/errors are empty. Browser interaction covered token search, scroll reset, Spot/Futures, disabled Futures 1S, line/TradingView, full-chart open/close, all four derivatives modes, BTC/USDC truth states, Light/Dark, and the mandatory Calendar → News → Health → Logs → Risk → Opportunities → Volume → Basis → Markets → Token → Borrow → Account → Dashboard sweep. At the wide audited viewport every page remained `x=189/y=75`, `1690px`, `1px`, `12px`, `22px/540/30px`, with zero horizontal overflow; Light, Bitcoin, Spot, native 1D chart, and scroll top were restored.

### 2026-07-10 13:01 IST — Dashboard Rebuilt As A Truthful Executive Control Room

- Replaced the stacked legacy Dashboard cards with one continuous `dcx-frame` matching the permanent page contract: `x=218`, `y=102`, `1007px` width at the owner viewport, `1px var(--line-2)` edge, `12px` radius, `57px` toolbar, `22px/540` title, and `102px` executive summary. The page now moves from account progress to live strategy runtime, attention, ledger decisions, and validated performance without changing visual grammar.
- Corrected a serious performance-truth defect. The former page calculated 94% drawdown, 58 Sharpe, and 1,583% run-up from 15-minute account snapshots that repeatedly alternated between partial (~$50) and complete (~$830) coverage. Dashboard account growth now uses the dedicated transfer-aware `/api/equity-history` route and labels it `Transfers And Borrowing Included · Not Strategy PnL`. Strategy PnL, win rate, profit factor, and drawdown stay unreported until closed ledger round-trips exist.
- Removed the obsolete claim that Volume was only synthetic and not wired. Dashboard polls the real `/api/engine/basis` and `/api/engine/volume` snapshots, exposing each engine's Binance source, universe/intake, quality or baseline coverage, watching/focus/proposal stages, current constraint, source age, highest-signal attention row, and deduplicated ledger decisions. Controls only navigate to the existing Account, Risk, Basis, Volume, Borrow, Logs, and Fills surfaces; no money action or fake toggle was added.
- Current professional references were checked before implementation: TradingView Strategy Report separates closed-trade performance from account balance; QuantConnect Live Results separates equity, holdings, orders, logs, and runtime statistics; Grafana recommends a general-to-specific story that reduces cognitive load; Binance's official stream docs confirm real-time aggregate trades and best bid/ask feeds. Those lessons were mapped to the existing backend instead of copied as decorative cards.
- Verification: `npm run build`, all `67/67` gates, and `git diff --check` pass. Browser verification covered 1W/1M history, Account/Risk/Volume routing, Light/Dark restoration, lower-page activity/performance layout, non-scaling chart geometry, zero horizontal overflow, and the mandatory Calendar → News → Health → Logs → Risk → Opportunities → Volume → Basis → Markets → Token → Borrow → Account → Dashboard sweep. Every audited page remains at the same `x=218`, `y=102`, `1007px`, `1px`, `12px`, `22px/540/30px` contract with no crash boundary.

### 2026-07-10 12:20 IST — Appearance Reordered And Given Real System-Aware Motion

- Rebuilt the existing Appearance sheet without changing its 398x486 family geometry. Theme remains first, Accent second, Interface Scale is now a normal full third section instead of being pushed into a shrunken bottom footer, and Motion is the fourth section. A short truthful footer clarifies that Reduced Motion stops interface animation while prices, polling, and timestamps stay live.
- Motion is now a persisted `System | Full | Reduced` preference. System resolves the OS `prefers-reduced-motion` media query and re-applies live when it changes; Reduced sets `data-motion=reduced`, which browser verification proved stops the clock animation and collapses transition duration without touching data refresh.
- The owner's overlapping blue-diamond reference is reproduced as a transparent code-native SVG identity in both the trigger and popup header. The supplied screenshot's opaque pale canvas was not shipped because it became a white square in Dark Mode; the vector preserves the two-diamond silhouette and colors cleanly in both themes.
- Browser verification exercised Reduced, System, Full, 105% Scale, Reset 100%, Dark, and Light, then restored Blue / Light / 100% / Full. The console is clean; `npm run build`, all 66/66 gates, `git diff --check`, and localhost HTTP 200 pass.

### 2026-07-10 12:09 IST — Basis Units Gained A Real Decimal Mode And Conversion Ladder

- Expanded the persisted `basisUnit` preference from Percent / Basis Points to three equivalent real presentation modes: Percent, Basis Points, and Decimal Rate. The shared formatter now renders `+0.042%`, `+4.2 bps`, or `+0.00042` across Markets, Basis, Borrow, Token, and Opportunities without changing underlying calculations. Invalid saved values fail back to Percent.
- Reused the code-native crossed-rate basis mark as the identity in both the topbar trigger and popup header. The fixed 398x486 sheet now contains three compact radio rows plus a hairline conversion ladder showing 1 / 10 / 100 basis points as Percent and the rate applied to $1; no calculator or fake data was added.
- Browser verification proved all three selections update immediately, Decimal Rate appears in the live Markets Basis table, the original Percent and Light preferences were restored, both themes render cleanly, and the console has no errors. `npm run build`, all 66/66 gates, `git diff --check`, and localhost HTTP 200 pass.

### 2026-07-10 12:00 IST — Display Currency Identity Replaced Without Surface Drift

- Replaced only the Display Currency topbar trigger and popup-header identity with the owner's exact 512px cyan dollar PNG at `web/public/currency-dollar.png`; the copied file is byte-identical to the supplied source. Currency rows, wording, rates, selection behavior, and the approved 398x486 popup geometry were left unchanged.
- Rendered verification confirmed the supplied 512x512 image loads in both locations at 24px and 38x42px, the popup remains 398x486 with no scroll or document overflow, and the browser console is clean. `npm run build`, all 66/66 gates, and `git diff --check` pass.

### 2026-07-10 11:55 IST — Execution Control Rebuilt As Persisted Three-State Guardrails

- Owner rejected the four binary switches as visually ambiguous and structurally too limited for future controls. Funds Access, Borrowing, Strategy Automation, and Live Orders now use one explicit segmented control: Blocked left/red, Paused center/neutral, Allowed right/green. Native radio inputs provide full-segment click targets, checked semantics, focus states, and keyboard behavior.
- Added `config.controlModes` with persisted `blocked | paused | allowed` values for all four controls. Existing saved configs migrate from the legacy booleans/borrow guard, invalid stored values fail back to safe derived modes, and `/api/config` keeps `fundsLocked`, `automationPaused`, `liveTradingEnabled`, `newBorrowPaused`, and `repayOnly` synchronized so current risk and loan enforcement remains real. Direct `/api/live` changes also synchronize the explicit mode.
- Borrowing is the requested label. Its modes map to repay-only hard block, temporary new-borrow pause, and guarded borrowing allowed. Live Orders Allowed is disabled while a real prerequisite is missing; the selector cannot visually arm a route the backend would reject.
- The emergency action is no longer a sloppy red engaged block. Ready is a large red `Emergency Stop / STOP BOT` action; after activation it uses the owner's exact green power image, the whole action turns green, and the wording becomes `Bot Stopped / RESUME`. Resume still requires confirmation. The trigger and popup header use the supplied red/green power assets according to real kill-switch state.
- Verification used an isolated keyless server so the live account state was not changed: every Blocked/Paused/Allowed position persisted and produced the expected fail-closed legacy fields, the red stop action changed to green Bot Stopped, the main 8080 state remained untouched, and 66/66 gates passed.

### 2026-07-10 11:36 IST — Notifications Became An Exception Router, Not A Second Logs Feed

- Owner clarified the durable product distinction: Logs is the exhaustive audit trail; Notifications exists to identify what is stuck, collapse noisy bot output into operator incidents, and route selected alerts elsewhere. Opportunities, news, announcements, scanner/candidate telemetry, snapshots, heartbeats, ordinary account sync, and generic config churn are now excluded at `web/src/lib/notifications.ts`.
- The admitted model is four real categories only: Needs Attention, Execution Outcomes, Bot Health, and Infrastructure. Runtime/AWS repeats collapse into one current daily incident with the underlying count; execution bursts group on short windows. The newest recovery state supersedes an older firing state, so stale failures do not remain open merely because they exist in Logs.
- The full Utility page now has two purposeful views: Inbox and Routing. Inbox keeps interventions first, shows seven-day incident counts, and reports real raw-event exclusion/grouping. Routing separates sources, destinations, noise policy, and four persisted preferences. In-App is Active; Email, Telegram, WhatsApp, and AWS SNS are honestly Not Connected.
- Added `GET /api/notification-routing` for real connector readiness and a fail-closed `POST /api/notifications/ingest/aws` EventBridge/API-Destination intake. AWS input is unavailable until `NOTIFICATION_AWS_INGEST_TOKEN` is configured, accepts only EC2/CloudWatch/AWS Health sources, uses constant-time bearer validation, and deduplicates AWS event ids. The browser never receives credentials.
- The compact topbar bell now consumes the same curated incidents rather than raw ledger events and opens Notifications rather than Logs. Initial rendered inspection reduced the live Jul 10 view from 346 apparent alert events to 16 incidents while retaining grouped counts and all raw evidence in Logs.

### 2026-07-10 11:12 IST — Notifications Promoted To A News/Calendar-Geometry Utility Page

- Owner rejected both the 1380x900 modal and a near-fullscreen modal. The correct product structure is now a first-class Notifications page in Utility directly above News; the topbar bell remains a compact tray and Open Center navigates to `page='notifications'`. The expanded modal render path was removed from `SharedTopBar` rather than hidden.
- `NotificationsPage.tsx` uses the exact shared `lix-frame` contract from News and Calendar: measured `x=218`, `y=102`, `width=1007`, `1px` edge, `12px` radius, title `22px/540`, seven day cards, segmented category filters, inline real rule controls, honest In-App / Email Planned / WhatsApp Planned posture, and one dense alert tape.
- Sidebar, route typing, App rendering, command palette, and document title all recognize Notifications. The Utility order is Notifications → News → Calendar. Direct sidebar navigation and topbar Open Center both land on the page; no `.ntc-center` modal exists in the rendered DOM.
- Added `beforeId` cursor pagination to `/api/events` and the ledger query. The page walks the seven-day archive in 5,000-row batches, then switches to five-second incremental polling. This fixed a browser-discovered truth defect where the 20,000-row request ceiling made older day cards appear empty during a high-volume Logs day.
- Browser verification in Light and Dark confirmed exact geometry parity with News and Calendar, zero document overflow, complete older-day counts after pagination, Critical filtering with zero non-critical rows, day selection, draft/Discard, persisted Save with restoration, compact-tray page navigation, clean console, and no modal. `npm run build`, all 59/59 gates, `git diff --check`, root HTTP 200, and `beforeId` API behavior pass. Light theme was restored.

### 2026-07-10 10:54 IST — Notifications Separated From Logs And Rebuilt As A Curated Alert Center

- Notifications is no longer a second raw Logs view. A dedicated `web/src/lib/notifications.ts` promotion layer now admits only owner-relevant interruptions: critical/security failures, blocked actions and emergency controls, account/execution changes, bot health, opened opportunities, and exchange announcements. Scanner decisions, heartbeats, snapshots, candidate telemetry, closed signals, reconnect attempts, and source-logo noise remain in Logs.
- The compact tray keeps its approved account-popover skeleton and the owner's exact supplied yellow bell asset. It now follows a five-second incremental ledger cursor, so high-volume scanner events cannot push a real alert outside the server's latest 30-event state window. Short bursts group by category, title, subject, and time window with real counts and timestamps.
- The expanded center is one full-width popup with no side inspector wall and no separate Preferences tab: sourced header, five real draft rule switches, honest In-App / Email Planned / WhatsApp Planned posture, seven selectable day cards, category filters, dense alert tape, Open Logs handoff, and persistent Discard / Save actions. Old proposal/fill/risk preferences migrate to Critical, Account, Bot, Opportunities, and News rules.
- Design direction follows Grafana's current notification-policy/contact-point separation and grouping guidance: alert selection is distinct from delivery channels, and repeated alerts are grouped to reduce noise. Email and WhatsApp remain static Planned labels until a real delivery backend exists.
- Browser verification at `localhost:8080` confirmed the seven-day archive loads, Today is the default day, a Jul 9 card shows only Jul 9 rows, Critical contains zero non-critical rows, Bot-rule draft preview removes matching rows, Discard restores it, Save persists and the test setting was restored, Open Logs navigates to the evidence ledger, and Light/Dark both have zero document overflow. Computed center geometry is 1380x900 with 1px border/14px radius; title is 22px/590 and row title 13px/560. Console is clean, the Light theme is restored, `npm run build`, all 59/59 gates, and `git diff --check` pass.

### 2026-07-10 10:25 IST — Notifications Tray Polished Without Replacing Its Skeleton

- Preserved the approved 398x486 Notifications dropdown, quiet header, real Mark Read/Open Center footer, expanded center, and raw ledger ownership. No new filters, cards, controls, or invented notification source were added. The supplied `8.39.52 AM` screenshot was not present anywhere on disk, so the pass was deliberately constrained to the current tray and the approved Binance/API/Trust/AWS popup family.
- Fixed the actual live-feed defect: identical scanner bursts are grouped by real notification category plus event summary, heartbeat noise is omitted from the compact tray, and every group shows its exact related-event count and latest real timestamp. The expanded center still retains every raw event.
- Notification severity now reads the recorded result fields. Any event with `kind=reject` or `rejectCode` is Critical even when its event name contains `strategy`; `candidate_opened` is Opportunity. This removed the false Opportunity treatment for rejected basis decisions.
- Replaced the older mixed custom glyphs with one Lucide family: Shield Alert, Radar, Wallet Cards, and Scroll Text. The existing teal notification identity and popup controls remain unchanged; row medallions now use thin 1px state-bound edges instead of generic bare marks.
- Browser verification passed in Light and Dark at `localhost:8080`: the pane stayed 398x486 with no outer/document overflow, five live grouped rows filled the 362px list without list scrolling, the 54px footer stayed visible, the console was clean, and Light was restored. `npm run build`, all 59/59 root gates, and `git diff --check` passed.

### 2026-07-10 10:11 IST — Trust Advisor Given A Sourced Identity And Three-State Symbol Language

- Replaced the hand-drawn Trust Advisor seal and generic topbar shield with the owner's exact transparent 512px green check-shield PNG in both the trigger and popup header. The copied `web/public/trust-advisor-shield.png` is byte-identical to the supplied source.
- Preserved the real derived safety scan, check ordering, compact list, and Risk/Health actions. The summary is now three equal 1px cells instead of a single undifferentiated number strip: strong amber Action alert, softer amber Review alert, and green Clear verification tick.
- Replaced the weak row-level cross/alarm mixture with the same three Lucide status symbols. Action and Investigation keep distinct alert silhouettes while both use the requested yellow/amber family; passing checks use the verified green tick. No warning, score, control, or state was invented.
- Browser verification passed in Light and Dark at `localhost:8080`: summary cells measured about 121x59 with 1px borders and 8px radii, the 398x486 pane had no outer overflow, footer actions stayed visible, the five-check list remained intentionally scrollable, the supplied image loaded at its natural 512x512 size, and Light was restored.
- `npm run build`, all 59/59 root gates, `git diff --check`, exact asset comparison, and browser-console verification passed.

### 2026-07-10 09:59 IST — Binance API Keys Reduced To Two Precise IP-Bound Objects

- Rebuilt the Binance API Keys topbar surface as two equal, hairline-bordered objects using the owner's exact green API-key PNG on the rail and on each object while preserving the real Binance identity in the popup header. Removed key names, fingerprints, HMAC/type copy, IP-restriction prose, trusted-network text, and the policy footer.
- The live Read-Only object uses normalized IPv4 `223.181.45.88` and exposes only Reading. The AWS Automation object uses `13.235.86.162`, remains truthfully Planned with a static amber status, and declares Spot / Margin, Loan / Repay, Futures, Universal Transfer, and Withdrawals while Reading stays off. The live state is a pulsing green dot and reduced-motion preferences stop the pulse.
- Consolidated both compact and premium render paths on one `BinanceApiKeySheet` and removed the dead duplicate API modal. `/api/apikey` and `.env.example` now share the two egress-IP defaults; no credential or secret was placed in the web bundle.
- Rendered verification passed in Light and Dark at `localhost:8080`: the shared pane measured 398x486, both cards measured 374x191, pane scroll and client dimensions matched, permission counts were exactly 1/5 and 5/1, and the browser console was clean. The owner's Light appearance was restored after the check.
- `npm run build`, all 59/59 root gates, `git diff --check`, and an exact byte comparison between the supplied image and `web/public/api-key-mark.png` passed.

### 2026-07-10 09:37 IST — AWS CloudShell Replaced By Fail-Closed Runner Control
- Replaced the fake/local CloudShell command draft with a real server-backed AWS Runner Control. The owner-supplied wide orange AWS cloud image is used directly on the topbar and workspace; it is never wrapped in a generic circle.
- Added two persisted, server-enforced gates: AWS Channel blocks all website-to-AWS requests, and Runner Changes separately blocks write/validate/restart. Both default closed, closing the channel also closes changes, configuration is validated before opening, and production mutations require a signed Cloudflare Access application JWT with verified issuer/audience plus the configured operator email claim; the origin does not trust a bare identity header.
- Added a restricted SSM command surface (`status`, `logs`, `read`, `validate`, `restart`, `help`) and a fixed-path runner editor with a 16KB cap, SHA-256 conflict detection, atomic backup, mode/owner preservation, and obvious-secret rejection. No AWS credential or unrestricted shell reaches the browser.
- The compact popup now shows real target and gate state. The large workspace is a proper operator surface with console/editor tabs, target identity, probe state, security gates, and an external Systems Manager action. Environment contract is recorded in `.env.example`; AWS configuration remains intentionally absent locally, so the rendered state must read Not Configured with gates closed until deployment values and IAM/SSM posture are supplied.

### 2026-07-10 09:16 IST — Refresh Cadence Rebuilt As Market Ping

- The topbar surface is now named `Market Ping` everywhere visible. The owner's exact transparent 512x512 blue circular-arrow PNG is stored at `web/public/market-ping.png` and used in both the trigger and popup header; the trigger/pane tone now follows the artwork's blue-cyan identity.
- The old seven-row cadence wall is reduced to the four requested real controls: Market Price, Account Data, News Context, and Calendar. Every native single-select exposes exactly `<1s`, `1s`, `3s`, `5s`, and `10s`; closed controls measure 58x32 and retain the platform's rounded menu/checkmark behavior.
- `web/src/lib/prefs.ts` now gives those four controls one shared option contract and migrates old values such as 6s, 30s, and 5m to the nearest supported choice. Market Price defaults to 5s, Account Data to 10s, News Context to 5s, and Calendar to 10s. The legacy market `refreshSec` stays synchronized with Market Price.
- The controls remain truthful: News no longer forces a hidden 5s minimum and Calendar no longer forces a hidden 5-60s range, so every visible Market Ping choice changes the corresponding browser polling interval. Upstream server caching remains independent and is stated in the popup footer.
- Execution Control typography remains authoritative in the panel: title 16/600/21, subtitle 12/400/16, status 10/600/14, row title 14/500/20, detail 12/400/16, and selector value 12/400. Browser verification passed all four selectors with change/restore, exact option sets, 400x488 shell, four 72px rows, no list/document overflow, clean Light/Dark renders, and a clean console.
- `npm run build`, all 52/52 root gates, `git diff --check`, exact source-image byte comparison, and localhost HTTP 200 passed after the final render.

### 2026-07-10 08:59 IST — Data Health Given Its Owner-Supplied Identity And Full Footer Action

- Data Health now uses the owner's exact green database-and-shield PNG from `web/public/data-health-shield.png` in both the topbar trigger and popup header. The image is presented on its original white field so the supplied identity stays unchanged and remains legible in light and dark themes; the existing trigger and header labels continue to provide the accessible name.
- The previous small right-aligned `Open System Health` button is now a 374px by 42px full-width footer action, matching the Account Details action footprint without changing the shared 400x488 shell or 398x486 pane. The action remains real and routes to the existing Health surface.
- The Execution Control typography contract remains intact: popup title 16/600/21, subtitle 12/400/16, status 10/600/14, row title 14/500/20, and values 12/400/16. Data Health rows use a 37.8px rhythm so all nine checks and the full-width footer fit with no internal scroll or clipped final row.
- Browser verification passed in Light and Dark at `localhost:8080`: supplied image loaded at its natural 447x447 source resolution, footer measured 374x42, list client/scroll height matched at 360px, shared shell stayed 400x488, document overflow stayed zero, and `Open System Health` opened the real Health page.
- `npm run build -w web` passed after the Data Health change, all 52/52 root gates passed, `git diff --check` passed, the copied PNG is byte-identical to the owner's source, and localhost returned HTTP 200. A later repository-wide build was blocked by a concurrent unfinished Token-page edit importing a not-yet-created `TokenDetail.css`; Data Health had already compiled and rendered successfully, and that unrelated Token work was not modified.

### 2026-07-10 08:44 IST — Topbar Popups Locked To Execution Control Typography

- Owner set Execution Control as the semantic type reference for every topbar popup and explicitly limited this pass to wording and number hierarchy. The shared contract is now title 16px/600/21px, subtitle 12px/400/16px, status 10px/600/14px caps, section label 11px/500/16px caps, section metadata 11px/400/16px, primary row copy 14px/500/20px, and detail/value copy 12px/400/16px.
- `web/src/styles.css` applies that contract across Market Clock, Data Health, Market Ping, AWS CloudShell, Binance API Keys, Trust Advisor, Notifications, Execution Control, Display Currency, Basis Units, Appearance, and Account Details. Data Health row labels, API facts/permissions, Advisor counters, note rows, account exchange/session rows, and right-side values were the concrete drift points corrected. Large counters use 430 rather than heavy display weight.
- This was a typography-only pass. No popup geometry, row spacing, colors, borders, shadows, icons, controls, or motion changed. Clock time and terminal command remain functional display-scale exceptions while their surrounding semantic roles match the shared contract.
- Rendered verification at `localhost:8080` covered all twelve popup triggers, API Keys and Data Health visual inspection, Account fit, Execution Control in light and dark themes, and directional popup switching. The shared shell remained 400x488 with 398x486 panes, no document overflow was introduced, internal API-key scrolling remained intentional, and the browser console stayed clean.
- `npm run build`, all 52/52 root gates, and `git diff --check` passed. `localhost:8080` returned HTTP 200 after verification.

### 2026-07-10 08:32 IST — Volume Rebuilt Around The Live Wakeup Engine

- Volume now uses the same stable News/Calendar/Risk/Health/Opportunities geometry: one full-width surface, 22px page inset, 1px neutral edge, 12px radius, 57px toolbar, exact `Search` field, one summary strip, one filter band, and one internally scrolling decision tape. The old hero, separate Live Wiring box, separate Decision Fields box, 88/88 proof copy, and placeholder spec rows were removed.
- The existing tested volume engine is now wired to real public Binance data. Eligible USDT symbols subscribe to exact Spot `aggTrade` streams for 1s/5s/1m quote volume, trade count, average trade size, taker aggression, large-print evidence, and price follow-through. Binance Spot all-book snapshots provide current spread, top depth, depth score, and staleness.
- Baselines seed automatically on every server/EC2 start from completed Binance Spot 1m klines, including official quote volume, number of trades, and taker-buy quote volume. The rolling engine accepts these completed-minute samples without contaminating the live 1s tape, then continues from real-time aggregate trades. No 24h volume is relabeled as a short-window signal.
- `/api/engine/volume` exposes current source posture, baseline progress, thresholds, engine state, and the complete eligible decision board. All Symbols, Watching, Focused, Rejected, and Warming are functional filters. Rows show asset, price, 1s/5s/1m volume versus the symbol's own baseline, trade flow, market quality, price move, and the engine's named decision/reject reason. Inline detail exposes baseline, trade-count multiple, average trade, taker aggression, depth, focus, reject, proposal, source identity, and real Market/Watch/Logs actions.
- Verified live after restart: 452-symbol universe, 53 volume-eligible symbols, all 53 baselines ready with zero seed failures, one aggregate-trade connection open, fresh book source, roughly 50 symbols trading within the last minute, real Watching/Rejected decisions changing as windows rolled, and zero fabricated focus/proposals. The page explicitly showed zero proposals when no verified wakeup survived every check.
- Browser verification at the current 1280px viewport measured frame x=218, y=102, width=1007, height about 588px, border=1px, radius=12px, title 22px/540, 53 live rows, zero legacy placeholder layers, zero document overflow, and zero table overflow. Search, all decision filters, inline expansion, Watch toggle/restore, Market/Logs navigation, and light/dark rendering passed. `npm run build`, the original volume engine's 88/88 proofs, root gates 51/51, and `git diff --check` passed; localhost:8080 remains running.

### 2026-07-10 08:30 IST — Market Clock Repaired With Accent-Bound Hourglass Motion

- Owner explicitly reopened the former still-clock rule and supplied hourglass and blue-ring clock references. The broken 104px trigger with a roughly 10px icon and clipped `LOC` treatment is gone. The topbar now uses a 148px by 42px capsule with a sharp 27px code-native hourglass, `HH:MM`, one bullet, and `IST` in the verified default state.
- The hourglass sand, caps, bullet, edge, and zone bind directly to the active Appearance accent. Browser verification changed Appearance from Blue to Violet and back; the clock followed immediately without a reload. The restored owner state is Blue, Light, 100%.
- The hourglass performs a calm 8.4-second hold/flip/hold cycle and reached a verified 180-degree matrix in the browser. Time and text never transform. Both `prefers-reduced-motion` and the app Reduced Motion preference stop the hourglass, sand, and stream animations.
- The popup now uses a 50px vector reproduction of the supplied blue-ring clock as its main identity. The dark instrument stage shrank to 58px, the time dropped to a restrained 24px/410, and the full date including year increased to a readable 13px/500.
- `LOC` and Local Time are retired. Legacy `local` preferences migrate to India/IST. The only clock and shared date-surface choices are India, UTC, New York, Asia (Singapore), and Europe (London); all are backed by real IANA zones and `Intl.DateTimeFormat`. All five 54px rows fit in the shared 400px popup without a visible scrollbar.
- Rendered verification at `localhost:8080`: trigger 148x42, hourglass 27x27, popup 398x486, logo 50x50, five functional rows, full date `Fri, Jul 10, 2026`, zero horizontal overflow, clean light/dark treatments, and functional UTC-to-India selection/restore. The topbar clock followed Blue/Violet accent switching and the user's Light/Blue state was restored.

### 2026-07-10 08:04 IST — Opportunities Rebuilt As A Truthful Proposal Decision Queue

- Opportunities now follows the stable News/Calendar/Risk/Health geometry: one full-width surface at the shared 22px page inset, a 1px neutral edge, 12px radius, and 57px toolbar. The old hero, proposal-card stack, Best Live Edges card, and duplicated selected-proposal inspector were removed.
- The active queue is one sortable operator table with real engine proposals and their net edge, fees, basis/peak, funding, quote volume, live spread/top-depth evidence, borrow requirement, and age. Clicking a proposal expands its engine reason, market facts, and real controls inline instead of shifting into a second panel.
- Unavailable facts stay unavailable. Reverse-basis rows explicitly say Borrow Required and Availability Unknown; the expanded record says Risk Decision = Not Evaluated and Suggested Size = Not Provided. No risk verdict, position size, score, or readiness state is fabricated.
- The misleading Approve Ticket control was removed because the current UI has no guarded ticket consumer and the backend approval endpoint only emits an intent. Real actions remain: Open Market, Watch, Open Logs, Open Risk, and a two-step Confirm Dismiss. Direct trading remains on Binance per the product contract.
- Basis, Funding, and Liquidity are compact market-context tables inside the same frame, derived from the live market feed and clearly separated from the proposal queue. Official Lucide operator symbols and existing real token artwork replace decorative or hand-drawn iconography.
- Browser verification at the current wide viewport measured the frame at x=218, y=102, width=1482, border=1px, radius=12px; title 22px/540; zero legacy layers, zero Approve Ticket copy, and zero horizontal overflow. Search, inline expansion, two-click dismissal safety without confirming, Watch toggle/restore, Market/Logs/Risk navigation, all three context views, and light/dark rendering passed. npm run build and npm test 50/50 passed.

### 2026-07-10 07:48 IST — Health Rebuilt As One Current-State Source Tape

- Health now uses the exact stable News/Calendar/Logs/Risk frame geometry: one full-width surface, 22px page inset, 1px neutral edge, 12px radius, and a 57px toolbar. The old gradient identity card, duplicate Connection Health and Operator Action cards, and repeated Evidence Matrix were removed.
- Every health source appears once in a failure-first tape with real Lucide source icons, semantic state, current value, measurement, and evidence. All Sources, Needs Attention, Exchange, Account, System, and External are functional filters. Selecting a row expands operator guidance and the exact measurement source inline; Audit Ledger remains a real route.
- Risk-owned execution mode and unrelated AWS Billing/CloudShell shortcuts were removed from Health. Runtime now shows only real version, environment, uptime, pair count, current stream count, REST latency, Cloudflare/local access posture, and the 13 actual source checks.
- Ledger Database is now truthful: the backend performs a reversible SQLite write/read/rollback probe instead of calling a config read “Writable.” The Binance REST and clock rows also carry the real backend time-probe observation timestamp. A token-profile snapshot with no tracked universe is Not Configured, never a fake healthy 0/0.
- Verified at the current wide viewport: frame x=218, y=102, width=1482, border=1px, radius=12px; title 22px/540; 13 rows and 13 sourced icons; zero legacy Health cards and zero horizontal overflow. Needs Attention filtering, inline expand/collapse, Refresh, Audit Ledger navigation, and light/dark rendering passed. Dark panel was rgb(21, 24, 29) with rgb(38, 45, 56) edge and no shadow; Appearance was restored to Light. npm run build, npm test 50/50, and git diff --check passed.

### 2026-07-10 07:35 IST — Risk Rebuilt As One Truthful Operator Frame

- Risk now uses the same stable outer geometry as News and Calendar: one full-width surface at the shared 22px page inset, a 1px neutral edge, and a 12px radius. The old hero plus two separate two-column cards were removed so page changes no longer shift between unrelated box systems.
- The page is a compact guardrail console: real daily-notional usage, realized PnL against the daily-loss stop, open-order capacity, rejection count, server-enforced gate conditions, named ledger rejects, persisted limits, allow/block symbol policy, and the server-backed dry run. The unwired spread, slippage, borrow, and exposure placeholder row was removed; no invented VaR, risk score, or liquidation gauge was added.
- Fixed the Live Arm eligibility bug: the old code excluded a nonexistent label, allowing the Live Arm condition to block itself. Eligibility now excludes the real live-arm condition by stable ID and still requires every other global blocker to clear.
- Browser verification at the current wide viewport measured the Risk frame at x=218, y=102, width=1482, border=1px, and radius=12px. Limit edit/discard restored the original server value, symbol input normalized to BTCUSDT, the kill-switch confirmation opened without changing state, and the dry run returned named server checks. Dark theme was checked with the panel at rgb(21, 24, 29), edge at rgb(38, 45, 56), and no shadow; the user's light theme was restored. npm run build, npm test 50/50, and git diff --check passed.

### 2026-07-10 07:32 IST — Logs Rebuilt As A Full-Width Seven-Day Activity Tape

- Owner rejected the first Logs skeleton's permanent facet and inspector walls. Logs now copies News's functional daily-tape anatomy: seven timezone-aware day cards, one compact filter band, and one full-width chronological activity surface inside the shared `1px` / `12px` frame. There are no internal left/right walls, nested feed cards, selected-row accent rails, or repeated severity dots.
- Every day card reports the complete recorded total plus Critical, Warning, Info, and Debug counts. The current ledger honestly contains six populated days; the oldest visible seventh day is zero because event collection began the following day. Changing the shared timezone repartitions the cards and row times.
- Severity is a complete three-bar phone-signal glyph on every row: all three bars red for Critical, amber for Warning, green for Info, and blue for Debug. Critical, Warning, Info, and Debug are real filters; All Logs hides noisy Debug records by default and Include Debug exposes them deliberately.
- Event investigation is inline. Clicking or keyboard-activating a row expands its real source, reason, status, symbol, recorded fields, related routes, and Raw JSON directly beneath the event; selecting it again collapses the detail. The rejected right inspector and its obsolete wall CSS were removed.
- `/api/events` now accepts a validated `since` timestamp and up to 20,000 rows, allowing the browser to request the truthful eight-day safety window once and partition seven visible days locally. The verified response returned 2,781 ledger events in about 8ms. Busy days render in progressive 200-row windows with `Load Older Logs`, preventing the 945-row day from blocking navigation while keeping every event reachable.
- Verification on the isolated `localhost:8081` production instance: exact shared frame geometry (`x=218`, `y=102`, `1007px`, `1px`, `12px`), seven cards, 200 initial rows, zero legacy wall elements, zero horizontal overflow, and correct red/amber/green/blue computed colors. Day switching, Today restore, Critical-only filtering, Debug expose/restore, progressive loading, inline expand/collapse, and light/dark rendering all passed; Appearance was restored to Light. Port 8080 remained untouched.

### 2026-07-10 07:30 IST — Topbar Rebuilt With Sourced Icons And Correct Account/Data Identity

- Owner corrected the prior interpretation: the supplied database reference belonged to Data Health, not Account. The hand-drawn radial database, laptop, and phone SVGs from the prior pass were removed. The official `lucide-react` package is now the source for the topbar and popup header symbols; Data Health uses Lucide `Database` with no spikes. Device rows use Lucide `Laptop` / `Smartphone`. Binance and Account retain their real source/profile artwork.
- The blue `/profile-logo.png` account mark is restored in both the trigger and Account sheet. The sheet mark is 64px; the visible name is `COSMOSGEEK` at 18px/600 without changing the stored editable profile name. Account/device active dots are 10px. The line-free Account layout, 440px width, 24px viewport clearance, scrollable sessions, and honest logout behavior remain intact.
- Printed topbar codes `5s`, `STOP`, `USD`, and `PCT` were removed. Refresh, execution, display currency, and basis now use official `RefreshCw`, `Power`, `CircleDollarSign`, and `Percent` icons; Appearance uses `Palette`. Current values remain in accessible titles and their real popups. The clock keeps its requested blue time/IST capsule and gains a sourced `Clock3` mark.
- The rail uses 40px targets with an 8px gap and a red-to-violet progression across the tool icons. Hover/focus/open state adds a one-pixel lift, a single underlight sweep, and restrained icon scaling; Refresh rotates only on interaction. Reduced-motion mode removes the animation.
- Every shared popup was normalized to a line-free 400px sheet with a 34px sourced header mark, 16px title, 54px row rhythm, 8px status dot, and no header or row separator border. Data-source dots are 10px. Popup names now read Market Clock, Data Health, Refresh Cadence, AWS CloudShell, Binance API Keys, Trust Advisor, Notifications, Execution Control, Display Currency, Basis Units, and Appearance.
- Chrome verification opened all twelve topbar controls in order. Every trigger resolved exactly once, every popup used the correct pane key/name/icon, all measured header/row separators were 0px, and horizontal overflow stayed zero. Data Health measured 10px source dots and a 34px official database header mark. Account measured 440px wide, 24px right clearance, 64px blue mark, 18px `COSMOSGEEK`, 10px state dots, and zero separators. Real pointer hover opened Display Currency and produced the expected underlight, 1px lift, and 1.11x icon scale.

### 2026-07-10 07:10 IST — Topbar Clock And Account Device Panel Repaired

- The owner supplied a radial database reference and requested separate trigger/panel treatments. The Account trigger now uses the clean database cylinder without radial nodes; the open Account sheet uses the larger node-spiked identity mark. The header mark increased from 42px to 58px while preserving the existing profile-name editing and optional image upload path.
- The clock trigger is now one blue 78px by 26px capsule containing both the current `HH:MM` and selected zone code (`IST` in the verified state). The detached zone badge and all visual topbar group dividers are removed.
- The Account sheet is 440px wide and clamps to a 24px viewport inset instead of sitting 11px from the right wall. Header, section, list, and device-row separator borders are removed; spacing now provides the hierarchy.
- `/api/sessions` remains the source of truth. Every returned row is rendered in a scrollable list, uses a laptop or phone mark from the reported OS, shows a green status dot and base edge when active or gray when offline, and carries a red logout control. The current-device control uses the real Cloudflare Access logout URL. Remote telemetry rows render an honestly disabled control because the stored IP/user-agent session id is not a Cloudflare session nonce and Cloudflare does not expose end-user per-device logout through the current integration. The bottom Access logout action is also red-tinted.
- Verification in the owner's Chrome tab at `localhost:8080`: account sheet `440px` wide with `24px` right clearance, `58px` identity mark, two `64px` device rows, zero separator-border elements, scroll container enabled, zero horizontal overflow, and the expected green/gray status edges. Root build passed, gates passed 50/50, and `git diff --check` passed.

### 2026-07-10 07:03 IST — Logs Skeleton Moved Into The News/Calendar Surface Grammar

- Owner requested a skeleton-only Logs pass before giving detailed content direction. All existing event loading, filters, severity/kind/source facets, row selection, symbol links, inspector fields, related actions, and Raw JSON remain intact; this pass deliberately does not redesign their meaning.
- `LedgerPage.tsx` now uses the shared `lix-page` / `lix-frame` structure from News and Calendar: one measured outer surface at `x=218`, `y=102`, `1007px` wide in the current 1280px browser, with a `1px` neutral border, `12px` radius, `57px` toolbar, `22px / 540` Logs title, live state, and the exact `286px × 34px` Search field.
- The former six-card Logs page is removed. Filters occupy one compact internal band; facets, Activity, and Event Details live inside the same outer frame and are separated only by hairlines. Nested section radii, shadows, gaps, and the selected-row accent rail are gone. Dense rows now use the same restrained tape voice and `46px` rhythm as News.
- Current professional log-explorer structure was checked before editing: search + time/facet controls belong above the stream, facets narrow the stream, and event details stay adjacent to the selected record. The product-specific content remains open for the owner's next instruction.
- Verification at the isolated production instance `localhost:8081`: web production build passed; `git diff --check` passed; light and dark renders preserve the exact frame/toolbar/search geometry with zero horizontal overflow; nested Logs card count is zero; severity dropdown selected Critical and restored All Severities; Search cleared correctly; theme restored to Light. Port 8080 was left untouched.

### 2026-07-10 07:02 IST — News Source Identity, Impact Taxonomy, And EC2 Archive Corrected

- Owner corrected the logo-only News row: a logo is not sufficient source identity. News now mirrors Calendar's country column with a dedicated Source column containing a free-standing 24px publisher mark plus a restrained, ellipsized publisher name. Twitter relay rows resolve the named account from the headline when available. Headline remains one line with no URL or summary subcopy.
- Filters are now two independent axes instead of one overloaded dropdown. The visible category rail is All News, Crypto, Macro, Markets, Regulation, Exchange, and On-Chain / Security. The impact rail is All Impact, High, Medium, and Low. Calendar now exposes All Events, High, Medium, and Low through the same bar-color language.
- Impact is no longer a short strict keyword list or a source-tier shortcut. The server deterministically scores authority, decisive event type, affected scope, explicit financial scale, corporate/capital actions, material on-chain flow, and low-signal/roundup wording. Critical exploits and outages are always High; official macro releases, final regulatory actions, structural venue changes, and quantified market shocks can reach High; routine releases, hiring, explainers, and generic opinion remain Low. A representative eight-case impact audit and three-case category audit pass against the compiled service.
- The visual contract is High = three green bars, Medium = two blue bars, Low = one yellow bar. Every News day cell reports the exact retained total plus H/M/L counts, and the selected-day header repeats the four values with the selected timezone. The live state beside News now uses a 6px two-wave beacon only while the SSE feed is connected; reduced-motion mode removes the wave.
- News exposes exactly the rolling seven calendar days ending Today. Previous-week navigation was removed. Internally the archive retains eight elapsed days only to protect the oldest visible day at extreme timezones; the UI never exposes more than seven days and rolls automatically as the selected timezone crosses midnight.
- Historical collection was materially expanded: normal RSS/page sources now ingest up to 80 eligible rows instead of eight; official multi-endpoint sources retain up to 64; Tree uses a slower rolling-history backfill plus a small live delta. This raised the verified retained context from under 1,000 to more than 2,400 deduplicated rows and populated Saturday/Sunday instead of showing only three incidental items.
- Deployment correctness changed: the five-second refresh owner is now server-owned and always runs, even with zero connected browsers. On an unattended EC2 host, publisher-specific fetch floors remain enforced, the archive persists under `DATA_DIR` (or ignored local `data/`), live deltas keep merging, and a browser only subscribes—it does not control collection. Cold archive reads remain about 9ms for the current 1.9MB seven-day payload.
- Verification: root production build passed; gates passed 50/50; `git diff --check` passed; `/api/news-context?limit=8000` returned 2,413 sorted items with category and impact on every row, 99 context sources (98 live plus one intentionally delayed relay), and no source errors. The in-app browser rejected the final localhost reload during the verification pass, so rendered interaction recheck is pending the owner's normal tab refresh; the production server remains running on port 8080.

### 2026-07-10 06:15 IST — News Reopened As A Timezone-Aware Daily Market Tape

- **Superseded by the 07:02 owner correction** for source names, visible category/impact rails, impact colors, seven-day-only navigation, and always-on EC2 collection.
- The owner explicitly reopened the prior News freeze. News now uses Calendar's operator model instead of one endless undifferentiated stream: a functional rolling seven-day navigator, previous/next week controls, per-day News and High Impact counts, and a selected-timezone day boundary. Selecting Local Time or UTC changes which items belong to each day; selecting a day renders the complete retained tape for that day.
- The presentation is now one Account/Markets/Borrow-quality surface at the measured shared geometry (`1px #e4e7ec`, `12px` radius). Blue row rails, source URLs, source-name subcopy, detail blurbs, circular logo containers, and nested page cards are removed. Rows carry only time, a free-standing publisher mark, a three-bar impact glyph, headline, category, and source link. High is three green bars, Medium two orange bars, and Low one red bar.
- Source coverage expanded from 88 to exactly 100 visible sources (99 context feeds plus Binance) with eleven verified additions: BIS Press, BIS Speeches, BIS Statistics, Japan FSA, UK FCA, ESMA, Crypto.news, Ledger Insights, Rekt, BeInCrypto, and CoinShares Research. The enlarged source directory supports search, health, day counts, and one-source filtering without placing publisher text in every news row.
- Backend history now persists a bounded 14-day, 4,000-item rolling archive under ignored runtime data, merges it with fresh context items, deduplicates and sorts it, and re-scores impact when scoring rules change. A restart serves that archive and all 100 source identities immediately while the live sweep runs in the background; the measured cold News response is now about 2 ms instead of waiting roughly 12 seconds on upstreams. The impact model no longer treats a generic `Security` tag as a critical incident, and relay-only stories are medium only when their tags carry a concrete market signal. Known tabloid relay domains are rejected. Binance's date-only announcements display an honest dash for time rather than a fabricated midnight timestamp.
- Calendar and News share timezone/day helpers and the same one-frame page grammar. Calendar's data anatomy remains unchanged; its timezone selector is now functional and its page is wrapped in the same measured outer surface.
- Verification: root production build passed after the final impact and layout corrections; the live API exposed 100 sources and retained five-plus days of browseable history; warm News and Calendar reads remained about 2 ms; browser checks covered source filtering, historical-day selection, High Impact filtering, UTC boundary count changes, return-to-Today state, logo-only rows, and zero horizontal overflow. The production server remains on `localhost:8080`.

### 2026-07-10 05:47 IST — Borrow Rebuilt As A Markets-Quality Risk Surface

- Owner rejected the prior Borrow page as a stretched field grid with weak hierarchy and excessive dead space. Borrow now follows the live Markets anatomy: one clear page header, one four-tile Loan Health band, one dense 84px position table, then the loanable market universe.
- Loan Health is derived only from real account/catalog data: total flexible and margin debt, posted collateral, current LTV against initial/margin-call/liquidation thresholds, collateral Simple Earn APR, borrow APR, and net borrow rate. No manual borrow, repay, or collateral actions were added.
- Ongoing Orders is now a single borderless row grammar carrying asset identity, debt, collateral, LTV risk meter, margin call, liquidation price/distance, borrow/collateral rates, and net APR. Asset Overview is one unified exposure table instead of nested cards; Loan Activity is a compact Event/Asset/Collateral/Status/Time table. The three views remain together and functional.
- Borrow Market now uses the current Markets typography and 84px asset rows, with adjacent All Loanable/Rows pills, right-aligned search, live catalog age, working filters/search/sort/watchlist/pagination, and internally scrolling tables at narrower widths instead of page overflow.
- Borrow Guard remains the only money-adjacent control. Its real config write is unchanged, but the switch semantics are corrected: checked/open means new loans are open; blocked moves the thumb left and shows New Loans Blocked. Browser verification toggled it and restored the original open state.
- Verification: current external Binance/Aave borrowing references were checked first; root production build passed; gates passed 50/50; `git diff --check` passed; 1920x1080 light and dark renders have visible surface edges and zero horizontal page overflow; the normal 1280px window collapses health tiles to two columns and contains the wide position table inside its own scroller. Ongoing Orders, Asset Overview, Loan Activity, search, Basis-Ready filtering, and guard restore were all clicked and verified; browser warnings/errors were empty.

### 2026-07-10 05:40 IST — Markets Screenshot Regression Repaired Pixel By Pixel

- The 04:50 source-identity pass changed more than the owner requested. The concrete mistakes were: resetting the table from the established Derivatives view to Overview on reload (which removed the old derivatives columns and introduced a chart column), placing the source picker alone in the title row, leaving the redundant page-level USD selector, keeping Rows with the left filters, using a bordered favicon-like Binance mark, crowding a verbose live age beside the title, and giving smaller section/token/stat type too much weight. This was a state-and-hierarchy regression, not just subjective polish.
- Repaired the table command anatomy without changing card geometry or chart-generation code: `All Assets` and `Derivatives` remain together on the left; `Rows` and the 17px official Binance vector sit together on the right; `Live` is back at the far-right header edge; the local USD selector is removed; Binance remains the only enabled source; All Sources, Coinbase, Bybit, and CoinGecko remain visibly Planned and disabled.
- Restored Derivatives as the useful fallback and persisted the selected table view in local storage. The owner-visible baseline now reloads with Asset, Perp Mark, Funding, Open Interest, OI Change, Liq 15m, and Perp Volume; switching to Overview still works and is the only view that requests the chart column.
- Typography correction: Explore crypto remains 40px/540; Market Stats and Market Prices are now 24px/500; asset names are 15px/500 over 13px/400 metadata; stat labels are 14px/430 and primary stat numerals are 16px/430. Durable rule: smaller labels must carry less ink than the larger heading above them; do not compensate for smaller size with darker weight.
- Verification at the owner screenshot viewport (2131x1620): full production build passed; source menu and disabled provider states work; Overview-to-Derivatives switching works; Derivatives survives reload; local USD count is zero; the Binance vector is present once; the original derivatives columns are intact; horizontal overflow is zero; and browser console warnings/errors are empty.

### 2026-07-10 05:24 IST — News And Calendar Final TradingView-Quality Freeze

- Owner rejected the 04:54 Markets-template pass as a visual imitation that kept the wrong product anatomy. The final reference is TradingView's dense Economic Calendar and News Flow logic: navigation above the data, compact filters, aligned columns, restrained type, hairline row rhythm, and no dashboard statistics between the operator and the tape.
- Calendar is now a real weekly release surface. The seven day cells navigate the tape and show only real Economic/High Impact counts; rows group repeated time/country values; the three-bar glyph maps directly to TradingView importance; the next unreleased event owns a real second-by-second countdown; Actual/Forecast/Prior values retain source currency/unit/scale; source, comment, and description fields are preserved from upstream instead of discarded. Coverage expanded from 10 countries/one week to 20 countries across previous/current/next weeks.
- News is now one continuous provider/time/headline/category tape. It opens on Must Know, keeps the raw chronological firehose behind All News, exposes real publisher identity through logos and an All Providers dropdown, uses strict timestamp-descending order with source priority only for exact ties, and replaces ten-row pagination with functional progressive loading. Search is exactly `Search` and both pages use the same crisp 12.5–13.25px/410–490 data type hierarchy.
- Backend final state: Calendar and News use shared stale-while-revalidate caches with startup prewarm (three 900-row News reads measured 6.2/2.8/2.4ms; Calendar measured 2.8/2.7ms after cold upstream fills). News has one shared five-second refresh owner for all SSE clients instead of one refresh timer per browser, sends a 220-row live delta that the client merges into its 900-row baseline, refreshes Binance separately, and keeps upstream-specific safety floors. Keyword filtering now uses token boundaries, fixing false matches such as `rate` inside unrelated words.
- Duplicate presentation code was removed: Calendar data/formatting moved to `web/src/lib/calendar.ts`, Header imports that shared contract, News was reduced to one feed implementation, and the orphan `MarketMiniChart` decoration was deleted.
- **FREEZE:** News and Calendar are finished surfaces. Do not re-template them from Markets, add stat cards/sparklines/pagination, or change their information architecture unless the owner explicitly reopens that surface. Bug fixes and upstream contract repairs must preserve the tape geometry and typography defined in `LiveIntelligence.css`.
- Verification: root production build passed; rendered Calendar and News were inspected in the in-app browser at the owner's current wide viewport; Calendar week/day navigation, live countdown, High Impact filter, country filter and search work; News Must Know, category filters, provider filter, search, SSE state and source links work; both pages have no horizontal page overflow. Server remains running at `localhost:8080`.

### 2026-07-10 04:54 IST — News And Calendar Now Use Markets As The Literal Template

- Owner correction: matching Markets means copying its content discipline and data-visual grammar, not merely reproducing its outer dimensions. New intelligence surfaces must use the same restrained hierarchy, two-line row identities, full-height stat visuals, pills, table spacing, capitalization discipline, and short secondary labels.
- Rebuilt News and Calendar around the exact Markets anatomy: one hero with one `Search` field, one four-card stats section, and one borderless 84px-row data table with centered Markets pagination. Removed example syntax from search placeholders and removed raw calendar codes such as `prce`, `gov`, and `bnd` from the rendered interface.
- Added a shared Markets-style halftone sparkline for live News and Calendar signals. Stat cards now use the same sparkline, distribution-bar, and split-bar vocabulary as Markets rather than decorative or empty counters.
- News rows now use short classification metadata beneath each headline instead of article-summary paragraphs. `Must Know` was tightened to official sources plus trusted critical incidents so generic aggregator chatter and routine protocol release spam do not lead the page.
- Verification: root `npm run build` passed, `git diff --check` passed, rendered News and Calendar were inspected at the live 2344px browser viewport, `Search` was found exactly once on each page, no raw `prce` label remained, horizontal overflow was absent, and browser warnings/errors were empty. Local server remains available on port 8080.

### 2026-07-10 04:50 IST — Markets source identity separated from market content

- Renamed the screener section from `Binance Market Prices` to `Market Prices`. Provider identity now lives in a dedicated right-aligned 40px source picker, while the real live age moved beside the section title.
- Binance is the only enabled source and is labeled Live. `All Sources`, Coinbase, Bybit and CoinGecko are visible as disabled Planned rows with real source marks and short coverage descriptions; no unwired source can be selected or presented as live.
- Durable Markets rule: market content stays provider-neutral, source identity stays explicit, and future exchange/aggregator integrations may only be enabled when their data adapters are real. Verified the menu, disabled states, Escape close, 40px trigger geometry and zero horizontal overflow in the browser. Production build passed, gates passed 50/50, and `git diff --check` passed.

### 2026-07-10 04:26 IST — Curve and verified issuer sources added

- Audited the owner's protocol/GitHub and stablecoin/ETF issuer lists against the running backend. All requested protocol sources were already live except Curve; added Curve's official contract, DAO and stablecoin GitHub release feeds (14 consolidated rows live).
- The issuer registry previously contained only Tether, PayPal USD and Fidelity Digital Assets. Added first-party parsers for Circle (3 live rows), Paxos (3), Bitwise (12) and 21Shares (3). Verification caught and fixed a Paxos card-boundary bug so every headline now resolves to its own matching article URL.
- First Digital, Ethena, BlackRock, Grayscale, VanEck, ARK and Franklin remain unregistered because current first-party pages were blocked, rate-limited, non-feed homepages, or did not expose a stable eligible crypto article stream. SEC remains the authoritative filing source for U.S. ETF disclosures. Production build and `git diff --check` pass; root HTTP 200 after restart.

### 2026-07-10 04:18 IST — Kaiko and Bankless source gaps closed

- Audited the owner's crypto-native source list against the running backend. CoinDesk, The Block, Blockworks, DL News, Unchained, Protos, The Defiant, Glassnode, Chainalysis, TRM and Elliptic were already live.
- Added Bankless through its working first-party RSS endpoint as a secondary/opinion-heavy crypto feed. Added Kaiko through a conservative first-party Data Blog page parser because Kaiko's old feed URL now redirects to the official research page; Kaiko rows deliberately carry no invented timestamp, so long-term research cannot jump above breaking news.
- Messari remains unregistered: no working public first-party RSS endpoint was found and apparent feed paths returned missing/rate-limited responses. Runtime verification after restart: Kaiko live with 8 rows, Bankless live with 8 rows, root HTTP 200, production build and `git diff --check` pass.

### 2026-07-10 04:05 IST — News source selector removed and screenshot source set audited

- Removed the redundant `All Sources · <item count>` selector from the News command row. The visible source directory remains the single source-filter surface; clicking a source still filters the tape and clicking it again returns to all sources.
- Audited all 16 publishers in the owner's source screenshot against the live backend. Twelve were already present. Added working official RSS feeds for ZeroHedge (`cms.zerohedge.com/fullrss2.xml`) and WatcherGuru (`watcher.guru/news/feed`) with narrow market/crypto keyword filters and a 60-second upstream floor.
- Bitcoin Magazine and Crypto Briefing are intentionally not registered yet: their apparent feed endpoints return Cloudflare HTTP 403 to server-side requests, so listing them as live would be false. Live verification after restart: 81 context sources plus Binance; ZeroHedge live with 8 rows, WatcherGuru live with 5 rows, Binance announcements live with 96 rows; production build and `git diff --check` pass.

### 2026-07-10 04:02 IST — News/Calendar live-intelligence pass + dark search correction

- News now has a server-sent `/api/news-stream` push path with a 5-second consolidated refresh trigger, REST fallback, strict timestamp-descending presentation, publisher-first relay deduplication, tighter Tree/FinancialJuice/Nasdaq relevance filtering, and honest upstream fetch floors.
- News UI now exposes active source identity/status/counts directly, uses compact source/headline/classification rows, supports structured `source:`, `symbol:`, `tag:` and `type:` search, loads continuously instead of paginating the live tape, and pulses newly arrived items twice without moving text.
- Calendar now refreshes at an operator cadence, sorts chronologically server-side and client-side, supports time-window/impact/country/text filters, exposes source/timezone/event counts, and pulses new or changed values.
- Dark-mode global search no longer renders the white inset top tint or animated blue beam. Market-engine initialization now retries in the background so News, Calendar, health and the SPA are not blocked by a temporary Binance outage.
- Verification: server and web production builds pass; `git diff --check` passes. Browser/runtime verification is blocked in the managed sandbox because local socket binding returns `EPERM`; the already-open localhost tab consequently shows the browser unreachable page.

### 2026-07-10 — Topbar motion and typography rebuilt around one persistent shell
- The owner's disappearing-panel report had concrete causes: the shared closer changed identity on every render, old close timers survived re-entry, the trigger-to-panel hover bridge was clipped, and the only mounted panel was deliberately faded to 18% for almost 300ms. Account was also implemented as a separate click-only popover. These were state-machine failures, not subjective polish issues.
- Current Aave production behavior was inspected before editing. The durable topbar rule is now: one persistent shell, immediate active-trigger changes, overlapping incoming/outgoing panes with a short directional slide, a generous invisible hover bridge, stable close ownership, and Account as the final member of the same rail. The shell uses one 400px width and measured height transitions; its resting content remains at full opacity with no transform.
- `web/src/components/Header.tsx` now uses stable close callbacks, clears every replaced timer, switches on pointer entry and focus, keeps outgoing and incoming content mounted together for the 200ms transition, and renders the real profile/session Account sheet inside the shared controller. `web/src/styles.css` adds the V4 motion/type authority: 200ms Aave-style directional panes, a 25px hover bridge, 4px trigger halos, unclipped shell overflow, restrained shadows, one system-font stack, integer font sizes, supported 400/500/600 weights, and higher-contrast dark tokens. Connection Health was simplified to bare semantic dots and one-line 40px rows. The default and live UI scale are now 100% to avoid CSS-zoom raster blur.
- Verified at `localhost:8080` in light and dark at 100%: Account opens in the shared shell, all 12 trigger controller paths completed left-to-right and right-to-left, the sheet/content stayed at opacity 1 with no resting transform, computed type was 15/20/600 title and 12/16/400 subtitle, and browser warnings/errors were empty. `npm run build` passed and `npm test` passed 50/50. Standalone web `tsc --noEmit` still reports only the existing `App.tsx` `HTMLMainElement` and `TradingViewChart.tsx` typing issues.

### 2026-07-10 — Right-side topbar rebuilt as one truthful operator-sheet system
- The owner supplied five Coinbase reference sheets and rejected the existing card-and-badge-heavy topbar as generic. The durable lesson is structural, not cosmetic: one opaque sheet, one dominant idea, a restrained title/subtitle ladder, flat hairline rows, one accent, and one meaningful footer action. The rail is now grouped by job: time/data, infrastructure/trust, events/control, then display/account.
- `web/src/components/Header.tsx` and `web/src/styles.css` now give Clock, Data Health, Data Cadence, AWS CLI, API Keys, Trust Advisor, Notifications, Bot Control, Currency, Basis Unit, Appearance, and Account purpose-specific sheets inside one shared visual grammar. Real wiring was preserved; fake AWS readiness/host/region claims, the hardcoded Binance account ID, notification delivery toggles, weighted advisor score, currency/basis demo calculators, decorative theme art, and placeholder API permission/IP claims were removed. Live Orders now has its missing `setLive` wiring and a visible prerequisite gate; account sessions are correctly called recent browser telemetry.
- Verified the rendered app at `localhost:8080` in light/dark and 105%/125% scale, inspected every sheet, opened the honest AWS command draft and notification center, tested and restored clock/currency/basis/theme/scale preferences, and confirmed outside-click closing. `npm run build` passed, `npm test` passed 50/50, `/` returned HTTP 200, and a separate web `tsc --noEmit` still reports only the pre-existing `App.tsx` `HTMLMainElement` and `TradingViewChart.tsx` typing issues.

### 2026-07-09 — Dashboard chart scaling and section order repaired
- Owner called out the Dashboard chart as too thick and the page as unordered. Chrome measurement showed the first Dashboard surface was `1008px` tall because the `760x240` SVG chart scaled to about `2558x808`; the `1.8px` chart stroke was therefore visually inflated and the chart consumed the first screen.
- `web/src/components/PerfChart.tsx` now measures the rendered SVG width with `ResizeObserver` and updates each chart viewBox to the real container width, preserving the intended chart height (`240-260px`) instead of letting browser aspect-ratio scaling enlarge the marks. End dots were reduced, and `web/src/styles.css` now makes Dashboard grid/zero/line/benchmark strokes non-scaling and thinner (`pc-line` `1.25px`, grid `.65px`, zero `.75px`) with a quieter area fill.
- `web/src/pages/Dashboard.tsx` now orders the page as Account Performance, Strategy Brain, Control/System/Intelligence, then Performance Diagnostics. Run-up/drawdown diagnostics no longer appear above the bot/operator sections. Verified in real Chrome at `localhost:8098`: chart measured `2557.77 x 239.97`, viewBox `0 0 2558 240`, no horizontal overflow, PnL/ROI empty states still work honestly with no realized days, Equity restores cleanly, and browser warnings/errors were empty.

### 2026-07-09 — Opportunities repaired to Account Details wording and density
- Owner asked to repair Opportunities using the Account Details / Connection Health font pattern. `web/src/pages/Opportunities.tsx` now removes the inherited Basis hero class, shortens the scanner copy, labels the tabs as Proposals / Basis / Funding / Liquidity, and cleans visible proposal reasons while preserving the engine's real numbers and wired proposal/radar actions.
- `web/src/styles.css` adds a scoped `opx-page` authority block after the scanner repair blocks so it wins over global frame rules. The old Opportunities render measured `h1=40px`, metric values `21px/620`, proposal titles `16px/550`, edge values `17px`, and fact values `14.5px`; the repaired surface uses the Account-style scale: title `13px/500`, hero copy `12px/430`, metric labels `10.5px/650 caps`, metric values `15px/430`, proposal titles `12.5px/510`, subcopy `11.5px/430`, and mono values `11.5px/500`.
- Verified in real Chrome at `localhost:8098`: Opportunities hero/filter/grid rails stay fixed at `x=228.88` with no horizontal overflow, Proposals and Basis tabs switch cleanly, the Basis radar table uses the same compact header/cell scale, and browser warnings/errors were empty.

### 2026-07-09 — Volume Scanner repaired to Account Details wording and density
- Owner called the Volume Scanner wording and fonts rough and asked to use the Account Details / Connection Health screenshots as the wording pattern. `web/src/pages/VolumeScanner.tsx` now keeps the honest pending-live-adapter state but removes the heavy placeholder card grid. Visible wording is short operator language: Quiet Symbols, Volume Burst, Taker Flow, Stream Adapter Pending, Live Wiring, Decision Fields, 1s Burst, 5s Confirm, 60s Hold, Taker Flow, Spread Guard, Depth Guard, and Reject Reason.
- `web/src/styles.css` adds a scoped `vsx-page` authority block mirroring the Account-style density used for Basis/Risk/Health. The old 40px title, 21px/620 metric values, 22px section heading, and 15px/550 boxed field cards are replaced by title 13px/500, subcopy 12px/430, metric values 15px/430, section heads 11px/650 caps, rows about 47px, row labels 12.5px/510, row copy 11.5px/430, and mono right values 11.5px/500.
- Verified in real Chrome at `localhost:8098`: first Volume surface still lands on the shared rail (`x=228.88`, `y=107.08`, `width=2589.14`), no horizontal overflow, 2 Volume bands, 15 rows, `Open Basis` navigates to Basis and returns to Volume, and console warnings/errors were empty.

### 2026-07-09 — Basis Scanner repaired to Account Details wording and density
- Owner called the Basis Scanner wording and fonts rough and asked to use the Account Details / Connection Health screenshots as the wording pattern. `web/src/pages/Strategies.tsx` now keeps the real scanner data but removes raw engine prose from the visible surface: proposal cards show `Basis Open · Net · Spot Vol · Funding`, the hero reads `Spot Perp Gap · Proposal Only · Fees · Net · Hold`, and board headings now use short operator labels like Live Board, Net Edge, Volume, Longs Pay, and Shorts Pay.
- `web/src/styles.css` adds a scoped `bsx-page` authority block, mirroring the Risk/Health Account-style density without changing Markets. The old 40px title, 21px/620 metric values, 22px proposal heading, 18px section heads, 16px proposal/table titles, and raw clipped proposal sentences are replaced by: title 13px/500, subcopy 12px/430, metric values 15px/430, section heads 11px/650 caps, proposal/table labels 12.5px/510, row subcopy 11-11.5px/430, and mono values 11.5-12px/500.
- Verified in real Chrome at `localhost:8098`: first Basis surface still lands on the shared rail (`x=228.88`, `y=107.08`, `width=2589.14`), no horizontal overflow, 3 Basis bands, 25 scanner rows, proposal cards expanded to ~846px each so copy no longer crushes, `Open Queue` navigates to Opportunities, `Net Edge` sort sets `aria-sort=descending`, and console warnings/errors were empty.

### 2026-07-09 — Risk tab repaired to Account Details density
- Owner called the Risk tab visually and verbally rough and asked to use the Account Details / Connection Health screenshots as the font baseline. `web/src/pages/Risk.tsx` now calls the surface `Risk Gate`, trims the hero copy, and renames core rows to operator wording: Live Arm, Symbol Allowlist, Per-Order Cap, Daily Usage, Order Preview, and Rejected Decisions.
- `web/src/styles.css` scopes Risk with `rkx-page` so Health/Logs stay untouched. The old 40px Risk title, 21px/620 metric values, 18px/620 section heads, 16px/550 row titles, and 66px rows are replaced by Account-style typography: title 13px/500, subcopy 12px/430, metric values 15px/430, section heads 11px/650 caps, row labels 12.5px/510, row copy 11.5px/430, mono values 11.5px/500, and rows around 47px at the current Chrome zoom.
- Verified in real Chrome at `localhost:8098`: first Risk surface still lands on the shared rail (`x=228.88`, `y=107.08`, `width=2589.14`), no horizontal overflow, 2 Risk bands, 23 rows, and all existing real controls remain wired.

### 2026-07-09 — Trust Advisor locked to Account Details typography
- Owner called out the Trusted Advisor popover as visually inconsistent with the Account Details reference. Chrome measurement confirmed the Advisor shell used the shared topbar family but had drifted: row titles were `12px / 560`, subcopy `11.5px / 430`, the header rail was about `73.5px`, and severity rows were about `56.7px`.
- `web/src/styles.css` now adds a final Trust Advisor authority block without changing `Header.tsx` or inventing checks. The popover keeps the real Action / Investigation / No Problems groups and real Risk/Health actions, while matching the Account geometry: ~405px outer shell, ~372px inner rail, ~65px header, ~46px rows, `11px / 680` header title, `13px / 430` header subline, `12px / 500` row labels, `12px / 430` row subcopy, and `10.5px / 700` right states.
- Verification in Chrome at `http://localhost:8097/`: Risk Controls footer action navigated to the real Risk page, the tab was returned to Dashboard with Advisor open, no console warnings/errors were captured, no horizontal overflow was present, and `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Logs aligned to the shared page box and Account Details typography
- Owner called out Logs as the remaining tab whose perimeter did not match Markets through Calendar. `web/src/pages/LedgerPage.tsx` now wraps the Logs header and filters in a real top `lg-console` surface instead of leaving the header/filter row floating outside the page-box rhythm.
- `web/src/styles.css` adds a scoped Logs final cascade: top title `13px / 500`, subcopy `12px / 430`, section heads `11px / 650` uppercase, row titles `12.5px / 510`, row copy `12.5px / 430`, mono values `11.5px / 430-500`, inspector title `12.5px / 510`, and compact 44px rows. The old `24px / 680` Logs H1 and `18px / 620` activity heading are gone.
- Verified in real Chrome at `localhost:8098`: Markets, Calendar, and Logs first surfaces all measured `x=228.88`, `y=107.08`, `width=2589.14`, with 0 horizontal overflow. Logs rendered 6 page boxes, 200 rows, and the final Chrome tab was left on Logs.

### 2026-07-09 — Dashboard redesigned onto Account Details typography
- Owner asked for the Dashboard to use the Account Details screenshot font/style. Chrome measurement showed the old Dashboard still carried heavier `hp-` defaults: card heads `18px / 620`, section headers `14px / 650`, row titles `14px / 620`, and row subcopy `12.5px / 460`.
- `web/src/styles.css` now adds a Dashboard-specific final cascade block that preserves the real data/charts/controls while changing the visual voice: key-stats header slab `11px / 680 / 14px` with `1.1px` tracking, stat labels `10.5px / 620`, stat values `17px / 430`, section/card heads `12px / 600`, row titles `12px / 500`, row subcopy `12px / 430`, and compact `10.5px / 620` pills.
- Verification in Chrome at `http://localhost:8097/`: Dashboard had no horizontal overflow, the Equity/PnL/ROI segmented control switched to PnL and restored to Equity, real chart rendering remained, and `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Health tab rebuilt around Account/Connection Health typography
- Owner rejected the System Health tab as visually heavy and asked to use the Account Details / Connection Health font and row language. The page now uses a compact `hlx-console` identity header, a thin four-cell summary, row-based Connection Health and Operator Action cards, and a lighter Evidence Matrix instead of the previous large H1 + metric quartet.
- `web/src/pages/SystemHealth.tsx` keeps the same real backend checks and evidence rows; only the page grammar changed. The visible source rows now mirror the dock popover wording: Browser → Server, Binance REST, Live Socket, Market Feed, Account Sync, Last Refresh, User Stream, Clock Drift, Rate Budget · 1m, Ledger DB.
- `web/src/styles.css` scopes Health to the topbar/account font tokens: brand 11px/660, product line 13px/500, row labels 12.5px/510, subcopy 11.5px/430, mono values 12px/500, table cells 12.5px/430. Verified in real Chrome at `localhost:8098`: 0 horizontal overflow, 15 health rows, 2 cards, no huge/thick Health title, and row heights around 44px.

### 2026-07-09 — Bot Controls font weight corrected to Account Details row voice
- Owner reported the Bot Controls popover was mostly structurally fine, but the words still looked too thick compared with the Account Details reference. Chrome measurement confirmed the Bot row titles were rendering at `12px / 560`, heavier than the account-like row voice.
- `web/src/styles.css` now pins the Bot Controls text at the final cascade point: header title `11px / 680 / 14px` with `1.1px` tracking, header subcopy `13px / 430 / 17px`, status pill `10.5px / 620`, row titles `12px / 500 / 16px`, and row subcopy `12px / 430 / 16px`.
- Verification in Chrome at `http://localhost:8097/`: Bot Controls measured 5 real toggle rows, row titles changed from `12px / 560` to `12px / 500`, subcopy changed to `12px / 430`, header tracking matched Account-style `1.1px`, and `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Notifications compact tray matched to Account Details density in Chrome
- Owner reported the Notifications tray still had overlapping text, wrong font density, and crowded spacing compared with the Account Details reference. The correction was to remove the compact filter/header-action crowd from the small popover and make it an Account-style status tray: icon slab, one section head, three newest feed rows, and real footer actions.
- `web/src/components/Header.tsx` now keeps the compact Notifications view to a latest-feed summary only. Filters and preferences remain in the full notification center opened by `Open Center`; compact rows and the footer action still use real existing handlers.
- `web/src/styles.css` now gives Notifications the measured profile grammar: 404px outer shell in Chrome, 373px inner slab, 65px header, 29px section head, 48px rows, account-matched 11px/13px/12px/10.5px typography, short right labels, and hidden compact tabs/header actions so nothing crushes into the header.
- Verification in Chrome at `http://localhost:8097/`: compact tray measured 3 rows, no title/right-label overlaps, no summary/date overlaps, `Mark Read` present and enabled when unread, `Open Center` opened the full modal with filters/feed/settings, and `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Data Health popover matched to Account Details density in Chrome
- Owner rejected the first Data Health pass as visually wrong despite a clean build; the correction was to measure the actual Account Details popover in Chrome, not rely on the in-app preview or build status alone.
- `web/src/components/Header.tsx` now keeps the Data Health header to the same structure as Account Details: icon plus title/subline only, with the source count in the section header and the real `Open Health` action in the footer.
- `web/src/styles.css` now gives Data Health the measured compact profile grammar: ~405px outer shell in Chrome, ~373px header slab, 65px hero, 29px section head, 46-48px rows, account-matched 11px/13px/12px/10.5px typography, and an internal source-list scroll so eight source rows do not stretch the whole popover.
- Verification in Chrome at `http://localhost:8097/`: Account Details measured 405px outer / 374px header; Data Health measured 404px outer / 373px header, footer visible, hero status pill removed, source list scrolls internally, and `Open Health` changes the active page to `Health`. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — News source fanout throttled; render recovers full live source stack
- Follow-up render exposed a cold-start backend issue: the News page itself rendered, but the source footer initially showed only `13/80 Sources Live` because the backend attempted too many official/RSS source fetches in parallel and many independent endpoints aborted together. Direct probes of affected sources worked, so the issue was orchestration pressure, not source death.
- `server/src/services/newsContext.ts` now throttles official-source fanout and RSS-feed fanout with an order-preserving concurrency helper. This keeps the same payload contract, cache behavior, and per-source status model while preventing startup refreshes from stampeding outbound requests.
- Verification after rebuild/restart at `http://localhost:8097/`: API readback returned 742+ ordered items, 79 source records, `78 live / 1 delayed / 0 unavailable`, and zero timestamp inversions; browser render showed `All838`, footer `79/80 Sources Live · 1 Delayed · 0 Unavailable`, first rows newest-first, and no console warnings/errors. `npm run build` and `npm test` 50/50 passed.

### 2026-07-09 — Topbar popover repair pass: one density grammar, no stale fake controls
- Repaired the shared topbar popover family around the Account Details / Bot Controls density baseline. The common panel frame stays fixed while content changes; typography now uses the same crisp 12px/11.5px row grammar for Data Health, Trust Advisor, Bot Controls, Data Cadence, and related rows.
- Clock: removed the decorative rolling-dot sweep from the face and kept the trigger time/zone centered in the pill. AWS CloudShell: flipped from the dark terminal card back to the normal light topbar theme, with a bounded session card, Host/Auth/Region cells, and real Expand / AWS Console actions for future in-app CloudShell wiring.
- Binance API: compact popover is two bounded source cards only: read-only data key and automation key, with real Binance identity, HMAC/fingerprint/IP line, and enabled scopes only. Keep disabled-scope walls, tick/cross matrices, and flying name/IP/capability rows out of the compact view.
- Notifications: Clear is an explicit real action and now marks against the latest event id, not whichever event happens to be first. Header actions stay compact; filters are All / Critical / Signals / Account. Bot Controls footer shortcuts and Data Cadence global/custom row were removed because they duplicated or pretended to be controls; row-level real cadence buttons remain.

### 2026-07-09 — News timestamp trust + stable live tape repair
- Owner reported News rows appearing out of order, old headlines animating into the middle, and unclear refresh/source behavior despite the expanded source stack. Root cause was not the main sort comparator alone: one running server (`8080`) was still an old dist process with the 3-source stack, and the current source stack had a backend timestamp-trust issue where a feed could stamp several article rows with the feed build time, making older rows look seconds old. The frontend also keyed rows by page position, so reorder/late-arrival rows could remount and animate in place.
- `server/src/services/newsContext.ts` now guards feed-level build timestamps: if a feed batch-stamps 3+ rows with a fresh build timestamp, those rows are marked `No Time` instead of being allowed to claim live seconds-old priority. Backend API readbacks on both `8097` and `8080` showed 79 source records, strict newest-first ordering, and zero timestamp inversions.
- `web/src/pages/News.tsx` now opens on the `All` bucket first so the default News tab is the strict chronological tape. Curated buckets (`Must Know`, `Exchange`, `Macro`, `Crypto`, `On-Chain`, `Research`) still exist, but they no longer define the first impression of source ordering. Row keys are stable by item id instead of page position, with duplicate-id fallback only when needed.
- Fresh-row animation is now gated to genuinely recent top-of-tape arrivals only; late-discovered 30-40 minute rows no longer get the same insertion animation. The CSS row animation now hides content during the height-open phase and limits transitions to color/opacity/border so text does not visually crush during insert.
- Verification at `http://127.0.0.1:8097/`: News opened with `All` active, 834 visible filtered rows, footer `79/80 Sources Live · 1 Delayed · 0 Unavailable`, first 25 rendered row ages increased monotonically, no horizontal overflow, row transition was limited to background/opacity/border, Refresh clicked cleanly, and console warnings/errors were empty. `http://127.0.0.1:8080/api/news-context?limit=50` also returned 79 source records and zero inversions after restarting the dist server. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Bottom connection dock premium motion + real refresh proof
- Owner correction: do not verify the app inside the small Codex preview when the real Chrome window is available. For this pass, a separate root-served local app was opened in Chrome at `http://localhost:8097/`; the first workspace-launch attempt from `server/` was rejected because it could not see `web/dist` and returned `Cannot GET /`.
- Bottom connection health is now a neutral control, not a filled color bubble. The dock sits farther from the corner (`40px` CSS right/bottom; measured about `45.16px` at current Chrome zoom), keeps a white/panel fill in idle/spin/success/error states, and uses thin animated orbit/sweep/breath rails for life instead of heavy colored fill.
- The dock refresh flow now preserves the backend `/api/refresh` timestamp and adds a real `Last Refresh` row to the hover panel. Clicking the dock still calls the shared refresh path, then immediately re-pulls `/api/health` and `/api/system` so the popover reflects backend state without waiting for the 5s poll.
- Verification at `http://localhost:8097/`: Chrome measured the dock at right/bottom `45.16px`, button size `54.59px` under current zoom, no hover transform shift, idle ring animation `rdockOrbit` at `8.4s`, click state `spin` accelerated ring to `1.7s`, and the panel showed `Last Refresh now` after the backend response. Backend readback showed `/api/refresh` OK, market feeds open, DB OK, and fresh account/order sync timestamps. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Topbar clock cleanup: account profile popover is the density baseline
- Owner identified the Account Details popover as the current clean-quality baseline: compact header slab, exact inner border/padding, quiet source identity, hairline rows, clear right-side state text, and full-width footer action when needed. Use that as the density reference before touching the remaining topbar popovers.
- Clock popover was repaired first. Old clock-specific 64px grid/header rules were fighting the shared 70px top-panel header and causing the clock to feel lodged or clipped. The clock now uses a centered `Market Clock` header, selected-zone status pill, seven evenly spaced timezone rows, and a visible selected check.
- Verification rule learned again: rendered browser geometry matters more than CSS intent. Chrome measured the open clock popover with 7 rows, no horizontal overflow, and the last row inside the panel boundary; screenshot verification was also taken with the popover open.

### 2026-07-09 — Five-tab page-surface pixel lock
- Owner correction: Account, Borrow, Markets, Token, and Dashboard must not shift their first real surface when switching tabs. Account is the measured baseline: page inset 22px, first real surface at x=228.88 / y=107.08 in the current browser, surface width 994.14, radius 12px, inner padding 22px/24px, and primary surface gap 16px CSS (measured 16.8px under current zoom).
- Added a late `PAGE SURFACE PIXEL LOCK` CSS block so Dashboard, Account, Borrow, Markets, and Token share the same first-surface x/y, border, radius, background, shadow, and spacing rhythm. Borrow's old 4px hero top shift is removed, Borrow console-to-market now has the same 16px gap, Markets hero/stats/prices are real Account-style boxes, and Token header/chart surfaces are separated by the same 16px gap instead of touching in a sharp-edged grid.
- Token detail now opens in the TradingView candle chart by default, keeping the line chart available as a secondary mode. The custom line chart voice was reduced to 34px/430 price type and 10.75px/410 faint axis labels so date/price labels no longer look oversized beside TradingView.
- Dashboard top metric values were reduced from heavy scoreboard type to the data-page number voice: 17px / 430 / lining numerals, with calmer chart axis labels. The functional equity chart remains; do not delete real monitoring data to fix typography.
- Verification at `http://127.0.0.1:8080/`: Dashboard, Account, Borrow, Markets, and Token first real surface all measured x=228.88 / y=107.08 with 0 horizontal overflow. Account/Borrow/Markets/Token primary gaps measured 16.8px. Token fresh-open showed TradingView selected, line chart hidden, price 34px/430/42px, and header-to-chart gap 16.8px. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Route alignment contract: no visible global wrapper box
- Owner correction: the Account inner content surfaces are the baseline. Do not put a second full-page border around them. The route wrapper may exist for layout/scroll reset, but it must be visually transparent; otherwise every page becomes "box inside box" and fast navigation shows shifting nested corners.
- Visible page structure should come from each route's real content surfaces: Account hero/assets/activity cards, Dashboard hp-groups, Borrow console/market surfaces, Markets/News/Calendar lists. Align those surfaces to the same page inset instead of adding a universal outer card.
- Route-to-route check: when clicking Dashboard through Calendar quickly, the page gutter, first visible content edge, and main content origin should stay fixed. Internals can differ and scroll, but the big boundary should not jump, double up, or create another perimeter line.
- Verification rule: inspect computed styles before shipping. `.app-page-frame` should have no border/background/shadow; first real content surfaces may have the razor-thin `var(--line-2)` border or only internal hairline dividers depending on the page design.

### 2026-07-09 — News strict chronological tape + 5s auto-refresh
- Owner corrected the News feed behavior: new rows must appear at the top, not be moved into the middle by source balancing. News is now a strict newest-first tape. Source family priority is only a tie-breaker for identical timestamps; it no longer boosts macro/venue/protocol rows above newer items, and the old frontend source-diversity spreading pass is removed.
- News auto-refresh now fires every 5 seconds by default/cap and uses `refresh=1` so the backend starts a source refresh instead of only reading the 45s context cache. Short follow-up reads at 1.8s and 4.2s pick up background refresh results before the next 5s poll. Existing publisher-side minimum fetch windows still protect slow official sources.
- Row time labels are computed in the browser from each item's timestamp, not from stale per-source fetch labels, so the visible age order matches the strict timestamp sort. The live badge now reflects the latest successful page/source check, while rows keep showing true item age.
- The data-cadence surface now reports News as 5s even when older local preferences saved 10s, so the topbar display matches the effective page behavior.

### 2026-07-09 — News final premium command strip and render-speed pass
- News now uses a screener-style command strip instead of a hidden bucket select: real bucket buttons with live counts (`Must Know`, `Exchange`, `Macro`, `Crypto`, `On-Chain`, `Research`, `All`), followed by one source select and one search input. Full category names stay in tooltips/accessibility labels; visible labels stay short enough not to collide at the owner's current viewport.
- Performance changes: frontend context request cap reduced from 1200 to 900, search input uses deferred query state, source logos and rows are memoized, bucket counts are memoized, row keys include page position to survive duplicate upstream feed IDs, page-size math is normalized/clamped at runtime, and rows use `content-visibility: auto` plus `contain-intrinsic-size: 78px`.
- Footer is split into source truth, page window, and actions instead of one long sentence. The explanatory footer note was removed; page size remains 25/50/100 and only the current page is rendered.
- Browser verification at `http://localhost:8091/`: bucket strip rendered 7 real buttons, source filter `Bitcoin Core` showed 8 rows, page-size sequence 25 -> 50 -> next -> 25 produced exact DOM counts 25/50/50/25, no removed noisy sources appeared, H1 stayed 40px/540/42px, row headline type measured 14px/430/20px, row `content-visibility` was active, footer grid was aligned, and horizontal overflow was 0. `npm run build`, `npm test` 50/50, API `limit=900`, and `git diff --check` passed.

### 2026-07-09 — News source-quality cut: noisy RSS feeds removed
- Owner asked to filter out any garbage sources from the expanded News roster. The rule applied: primary macro/policy, venue notices, protocol/status/GitHub releases, issuer feeds, and high-signal crypto/media sources stay; broad opinion, aggregation, and duplicate SEO-style crypto headline feeds do not belong in the default live context.
- Removed these live RSS sources from `server/src/services/newsContext.ts` and the News source selector: WatcherGuru, ZeroHedge, Bitcoin Magazine, Crypto Briefing, and Bankless (Opinion). They are not fetched, not counted, and not selectable. Long-term research remains covered by Glassnode Insights and Fidelity Digital Assets; on-chain/security remains covered by Lookonchain, Protos, Chainalysis, TRM Labs, and Elliptic.
- Verification: `/api/news-context?limit=1200&refresh=1` returned 748 context rows and 79 context sources, with none of the five removed keys listed and no rows from those keys. Browser verification after reload showed no removed-source options, no removed-source rows, 25 rendered rows, footer `79/80 Sources Live · 1 Delayed · 0 Unavailable`, and 0 horizontal overflow. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Protocol/GitHub release + issuer feeds added; News buckets paginated
- Owner supplied the protocol/chain/GitHub release source list plus stablecoin/ETF issuer list and warned not to dump a giant uncontrolled firehose. News now has first-class `protocol` and `issuer` channels in `/api/news-context`, with source ranking below primary macro/venue notices and above ordinary media rows.
- Added official/live protocol and technical-event sources: Ethereum Foundation blog, Bitcoin Core releases, Geth, Nethermind, Prysm, Lighthouse, Solana Agave, Arbitrum Nitro, Optimism, Base Status, Polygon Status, AvalancheGo, Cosmos Gaia, Celestia Node, Sui, Aptos Core, Chainlink, Uniswap v4, Aave v3, Lido, EigenLayer, Sky/Maker Forum, dYdX, Jito Solana, Jupiter, Wormhole, and LayerZero v2. All are official blog/status/GitHub release sources, not third-party generators.
- Added official issuer/research sources where a legal/reachable source worked: Tether official feed, PayPal newsroom filtered for PYUSD/stablecoin/digital-asset terms, and Fidelity Digital Assets RSS. PayPal is reachable but currently has 0 matching PYUSD rows, so the UI shows an honest empty state for that source.
- Intentionally did not add unavailable/unconfirmed sources: Curve official feed/GitHub candidates had no usable current rows; Circle, Paxos, Bitwise, VanEck, ARK, 21Shares, Franklin Templeton tested RSS candidates did not produce confirmed feed rows; First Digital/FDUSD was blocked by Cloudflare 403; Ethena candidate feeds served HTML/no rows; Grayscale hit a Vercel/Cloudflare checkpoint. Do not add these via third-party RSS generators without owner approval.
- Front page control model changed from flat firehose to buckets: Must Know, Exchange Notices, Macro / Policy, Crypto Market News, On-Chain / Security, Long-Term Research, and All Buckets. Rows are rendered only for the selected page, with page sizes 25 / 50 / 100 plus Previous/Next; Mark Visible Read only marks the currently rendered page.
- Verification: external official references were checked before coding; `/api/news-context?limit=1200&refresh=1` returned 788 context rows, 84 context sources, and no missing keys for all newly added protocol/issuer sources; browser checks confirmed every bucket renders max 25 rows by default, 50-row pagination moves from 1-50 to 51-100, Bitcoin Core/Nethermind/Tether/Fidelity filters show real rows/logos, PayPal shows one honest empty state, and horizontal overflow is 0. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Crypto-native quality media layer added to News
- Owner supplied the crypto-native media source list: CoinDesk, The Block, Blockworks, DL News, Unchained, Protos, The Defiant, Messari, Kaiko, Glassnode, Chainalysis/TRM/Elliptic, and Bankless.
- CoinDesk and The Block were already present and kept. Added official/live source integrations in `server/src/services/newsContext.ts`: Blockworks official Atom feed, Unchained RSS, Protos RSS, The Defiant official API RSS feed, Glassnode Research RSS, Chainalysis RSS, TRM Labs RSS, Elliptic RSS, and Bankless public RSS labelled as opinion-heavy. DL News' official `/rss/` route currently serves an HTML page rather than XML, so it is wired through a small official-page parser instead of a generated feed.
- Messari and Kaiko were intentionally not added as live sources: Messari official research/feed paths returned a Vercel security checkpoint / HTTP 429 from this runtime, and tested Kaiko public research/blog RSS paths returned 404 pages without official feed rows. Do not add either through third-party RSS generators unless the owner approves a legal official source.
- Raised the News context cap to 700 and RSS bundle cap to 260 so expanded media filters do not starve. Added UI source filters/logo-domain mappings for the new crypto-native sources in `News.tsx`.
- Browser verification at `http://localhost:8091/`: all ten new filters showed real rows with source-domain logos and no empty state; H1 stayed 40px / 540 / 42px; first row stayed 74px+ / 13.5px; live and refresh controls stayed aligned; logo chrome remained borderless; horizontal overflow was 0; console warnings/errors were empty.
- Verified: current official web references checked first; direct `/api/news-context?limit=700&refresh=1` check returned 577 context rows and the new sources had payload rows; `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Traditional finance free/headline layer added to News
- Owner supplied the traditional-finance media source list: FT Alphaville, CNBC Markets, MarketWatch, Yahoo Finance, Investing.com News, Nasdaq News / Market Activity, AP Business, Reuters public pages, and WSJ Markets.
- Added official/free headline sources to the existing RSS/media layer in `server/src/services/newsContext.ts`: FT Alphaville official FT RSS, CNBC Investing/Markets RSS, MarketWatch Top Stories RSS filtered to market terms, Yahoo Finance RSS, Investing.com News RSS filtered to market terms, Nasdaq Market Activity RSS, and AP Business public page headlines filtered to finance/economy/market terms with a 3-minute cache. WSJ Markets was already present and kept.
- Reuters was intentionally not added: direct public Reuters Markets access returned a JS/ad-block challenge and no confirmed official free RSS/legal redistribution endpoint was found. Do not add Reuters through third-party RSS generators unless the owner provides/approves a legal source.
- Raised the RSS bundle cap to 180 so the expanded media layer does not starve individual source filters. Added UI filters/logo-domain mappings in `News.tsx` for FT Alphaville, CNBC Markets, MarketWatch, Yahoo Finance, Investing.com News, Nasdaq News / Market Activity, and AP Business.
- Browser verification at `http://localhost:8091/`: all new filters showed real rows with no empty state; Reuters did not appear; footer showed 44/45 live sources plus Tree delayed; no console warnings/errors; no horizontal overflow; News frame rects and typography remained aligned with the existing Calendar-style layout.
- Verified: current official web references checked first; direct API checks showed the new source groups live; `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — Venue/exchange operational sources added to News
- Owner supplied the exchange/venue-operational feed list and asked to add each source carefully from official sources: Binance, Coinbase/Coinbase Assets, Kraken, OKX, Bybit, Upbit/Bithumb, Deribit, CME Group crypto notices, and exchange status pages.
- `/api/news-context` now has a first-class `venue` channel alongside `primary`, `tree`, `rss`, and `lookonchain`. Venue rows rank below primary macro/policy rows and above ordinary media/RSS rows. The payload source string is now `primary+venue+tree+rss+lookonchain`, and the row cap was raised to 520 so every source filter has its real rows in the payload.
- Added official venue integrations in `server/src/services/newsContext.ts`: Coinbase Exchange public product availability/trading phases; Kraken asset-listings RSS; OKX listing/delisting/trading/deposit-withdrawal/Web3 announcement SSR pages; Bybit listing/delisting/maintenance SSR pages; Upbit announcements JSON; Bithumb notices JSON; Deribit exchange-updates RSS; CME Group press release + CME Globex feeds filtered for crypto terms; Coinbase/Kraken status RSS, OKX status page, and Bybit system-status API as the grouped Exchange Status source.
- Coinbase limitation is honest: Coinbase's own 2025 notice moved listing announcements to Coinbase Markets on X, so without an X bearer-token integration the app monitors official Coinbase Exchange product/trading-phase state and Coinbase status, not third-party listing rumors.
- `News.tsx` now exposes filters for all new venue groups and maps their official logo domains. Browser verification at `http://localhost:8091/`: All Sources 540 rows, 37/38 live sources + Tree delayed + 0 unavailable, no console warnings/errors, no horizontal overflow, News frame rects stayed aligned, and filters for Coinbase, OKX, Bybit, Upbit/Bithumb, CME, Exchange Status, and Binance each showed real rows.
- Verified: current official web references checked first; direct API checks showed all eight new venue groups live; `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — News source ranking and timestamp trust fix
- Owner correction: Binance official announcements and Lookonchain rows were sticking at the top of the merged News feed and making the live tape look stale. Root cause: Lookonchain publishes naive `YYYY-MM-DD HH:mm:ss` timestamps from its UTC+8 feed clock, but the server parsed them as local time and then clamped future rows to `now`; Binance date-only/future-effective announcements were also allowed to compete with real live headlines.
- `server/src/services/newsContext.ts` now parses Lookonchain timestamps as UTC+8, falls back to the source's relative `times` field when needed, and no longer converts large future timestamps into fresh `now` rows. Context API verification after restart showed Lookonchain rows as minutes-old and the top context feed mixed with Tree/RSS.
- `News.tsx` now demotes future/undated Binance announcements in the all-source sort, interleaves comparable fresh rows from different source families so one provider cannot occupy the top block, and display-trims oversized relay titles while preserving the full original in the row title attribute.
- Product language was de-biased: the News document title and command palette now say `Market News`, with Tree/RSS/Lookonchain/Binance as the source stack instead of labeling the page `Binance News`.
- Browser verification at `http://localhost:8091/`: top rows alternated RSS/Tree/RSS/Tree/RSS/Lookonchain without consecutive source repeats, Binance official rows were not pinned at the top, live status showed `Live · 3s ago`, title was `Arbitrage Control Room · Market News`, live/refresh rects stayed aligned, and horizontal overflow remained 0. `npm run build`, `npm test` 50/50, and `git diff --check` passed.

### 2026-07-09 — News/Calendar live badge moved to right action cluster
- Owner correction: the live badge must not sit after the title. News and Calendar now render the title row as title-only, and the `ux-live-status` badge lives in the right-side hero action cluster immediately before Refresh.
- The live badge is now a real animated status button: fixed 154px CSS width, 40px height, thin state border, tabular age text, continuous dot core + radar ping animation, and a short sweep animation during refresh. Visible text stays `Live · Ns ago` / `Live · Nm ago`; it never says `Checking` or `now`.
- Browser verification at `http://localhost:8091/`: News and Calendar both had `liveInRightCluster=true`, `liveInTitleRow=false`, identical live/refresh x-y alignment (`live x≈902.84`, `refresh x≈1075.03`, both y≈143.81), active `uxLiveDotCore`, `uxLiveDotPing`, and refresh-state `uxLiveStatusSweep`; no horizontal overflow.

### 2026-07-09 — News/Calendar live-pill wording and fixed position
- Owner correction: the green live wording should not move, should not say `Checking`, and should not say `now`. News and Calendar now use one fixed-width `ux-live-status` slot beside the title with tabular numeric age text.
- Added `liveAge()` for live-feed status grammar: 1s-59s render as seconds, then 1m+ renders as minutes. Existing generic `timeAgo()` stays unchanged for other surfaces.
- Refresh state is now represented by motion, not copy swaps: the live dot pulses and a tiny status sweep runs while the page refreshes; the refresh button still animates but its visible label remains `Refresh`.
- Browser verification at `http://localhost:8091/`: Calendar and News both showed no `Checking` text, no `now`, fixed pill width around 142px CSS, same measured status x, and active `uxLiveDotPulse` / `uxLiveStatusSweep` animations during refresh.

### 2026-07-09 — News live cadence + shared refresh motion
- Owner correction: News must behave like a live financial feed, not a manual-refresh page. The page now caps News auto-polling at a 10s live cadence even if an older local preference was 60s, and the default News cadence is 10s for new preference state.
- `News.tsx` now forces `/api/news-context` + `/api/news`, then performs delayed readbacks at 2.2s, 5.2s, and 9.2s so stale-while-refresh backend updates can surface without a full page reload. New IDs still receive `.nwx-line.fresh`, so incoming headlines open at the top and push existing rows down.
- News and Calendar share the same razor refresh control: fixed-width thin bordered pill, short visible `Live · Checking` state, slow icon spin, and a restrained top/bottom beam copied from the top search motion grammar. Calendar keeps the active state visible briefly even when the API returns immediately.
- Browser verification at `http://localhost:8091/`: News auto-refresh toggled to `Live · Checking` without a click; manual refresh returned to `Live · now`; Calendar/News hero, filters, columns, list top, and refresh button rects matched exactly; H1 computed style stayed 40px / 540 / 42px; no horizontal overflow. Build clean.

### 2026-07-09 — News/Calendar shared frame lock + live insert rule
- News and Calendar now share the same `ux-page`/`ux-hero`/`ux-filters` geometry: hero box, title slot, status pill slot, refresh button, filter row, column header, and list top are locked to the same measured rects. Do not add page-specific top padding, second filter rows, or extra hero actions that make the tabs jump.
- News feed rows use real source logos through `/api/source-logo`; source filters stay in the filter band, source truth lives below the list. Calendar country filtering is a compact real native select, not a second row of pills.
- Live update rule: News uses the project data cadence, triggers non-blocking refresh, then performs one delayed read so new IDs get `.nwx-line.fresh`. Fresh rows open from height 0 to the normal 74px row with a 2px accent line, pushing existing rows down without refreshing the whole page. Calendar uses its project cadence and the same animated refresh control.
- Verified in the in-app browser after build: News vs Calendar diffs are exactly 0 for hero y/height, filters y/height, columns y, list y, refresh x/y/width; title font is 40px/540/42px on both; row font is 13.5px/20.25px on both; no horizontal overflow. Gates 50/50.

### 2026-07-09 — News filter rules and column header alignment
- Owner screenshot showed two stray horizontal rules bracketing the News filters and an incomplete column header. The filter band should not be trapped between random lines, and the feed header must explicitly read Time / Source / Headline / Link.
- Removed the scoped News filter/header top borders (`.nwx-filters` and `.nwx-cols`) and tightened the filter/header spacing. The only structural border around the feed remains the actual list frame.
- Added the `Link` column label in `News.tsx` and widened the fourth grid column from `24px` to `44px` in both `.nwx-cols` and `.nwx-line`, so the label aligns over the external-link icon column. Browser verification showed matching header/row grids and zero horizontal overflow.
- Verified with screenshot, `npm run build`, `npm test` 50/50, and `git diff --check`.

### 2026-07-09 — News hero padding cascade fix
- Owner screenshot showed the real bug: the `News` title was almost touching the hero border. The card chrome was present, but old `.nwx-hero { padding: 0 0 20px !important; border-bottom: ... !important; }` rules overrode the shared `.bwx-hero` card padding.
- Fixed with a scoped `.nwx-calendar .nwx-hero` override: `padding: 20px 24px 22px !important`, full `1px var(--line-2)` border, and `12px` radius. Browser measurement after reload: hero padding `20px 24px 22px`, title left air `26px`, title top air `22px`, Refresh right air `26px`.
- Verified with screenshot, `npm run build`, `npm test` 50/50, and `git diff --check`.

### 2026-07-09 — News first-paint and typography correction
- Owner correction: News must not show a giant blank loading panel on reload, row headline text must not feel like heavy black type crashing into divider lines, and the hero Refresh button must not sit pinned to the top edge of the hero box.
- `News.tsx` now stores the last Tree/RSS/Lookonchain + Binance payload in localStorage (`cosmos-news-feed-cache-v1`) and hydrates from it on page load. Browser verification after reload showed 160 rows present at 300ms, no `.ov-empty`, and no horizontal overflow.
- News copy was shortened: hero subcopy is now one sentence, search placeholder uses normal sentence casing, and the source note is a short source list instead of a long implementation sentence.
- News CSS now gives rows more air (`min-height: 74px`, `13px 20px` padding), lowers headline weight (`13.5px / 450 / 20px`), lowers provider weight (`480`), and centers the hero refresh action vertically. Browser computed-style check confirmed the new values and screenshot verification was taken.
- Verified: external references checked (TradingView News Flow, TradingView Economic Calendar, Apple typography guidance); `npm run build` clean; `npm test` 50/50; `git diff --check` clean.

### 2026-07-09 — News refresh and source-logo correction
- Owner correction: Refresh must not feel stuck, and publisher logos must not be put inside extra rounded/logo-box chrome. Real source marks should render as the mark itself; do not wrap X/Twitter or publisher favicons in fake rounded containers.
- `getNewsContext(force=true)` now uses stale-while-refresh when cached data exists: the API returns the current feed immediately and refreshes Tree/RSS/Lookonchain in the background. Measured warm `/api/news-context?refresh=1` response is ~4ms instead of waiting on the full RSS fan-out.
- News Refresh now uses abortable combined fetches and a short disabled/loading state so repeated clicks do not pile up overlapping requests. Rows remain visible during refresh.
- `.nwx-logo` no longer has border, radius, background, overflow clipping, or image padding. Browser verification confirmed Twitter/X row logo CSS: `border: 0`, `border-radius: 0`, transparent background, image padding `0`.
- Verified: external references checked (TradingView News Flow filter/list anatomy, X brand toolkit, Google favicon guidance); `npm run build` clean; `npm test` 50/50; `git diff --check` clean.

### 2026-07-09 — News corrected to Calendar-density headline feed
- Owner correction: the News page must copy Calendar's utility-page rhythm, not use a left source box, colored context chips, long summaries, or a separate Binance mode/button. Durable page rule: one thin framed feed, compact filters above the list, real source logos, headline-only rows, and source truth as quiet footer text.
- `News.tsx` now merges live context (`/api/news-context`: Tree, RSS bundle, Lookonchain) with Binance official announcements (`/api/news?catalog=49`) inside one source filter row: All Sources, Tree, RSS Bundle, Lookonchain, Binance. Binance is a normal source, not the page's bias.
- Row anatomy is locked to Time / Source / Headline / Open: no `Context` column, no summary paragraph, no colored tone tags, no colored unread strip. Source identity uses real publisher/favicon logos through `/api/source-logo`; no fake initials or random colored badges.
- Refresh now forces both `/api/news-context` and `/api/news`; the Binance announcement proxy accepts `refresh=1`. Browser verification measured no source rail, no visible tags, no context text, no horizontal overflow, no refresh/title overlap, Binance filter rows only Binance, search narrowing, and mobile collapse at 390px.
- Verified: external references checked (TradingView News Flow filters and Economic Calendar list anatomy, Google favicon guidance); `npm run build` clean; `npm test` 50/50; `git diff --check` clean.

### 2026-07-09 — News rebuilt to Calendar-style live-context list
- Owner rejected the left source rail, source-stack copy, Binance-biased mode, and oversized confirmation surfaces. Durable rule for this page: News should follow Calendar's utility-page anatomy, not a dashboard/sidebar layout.
- `News.tsx` now uses only `/api/news-context` as the page feed. The Binance Official mode, Binance top action, priority queues, stat strip, `Source Stack` rail, source cards, and old `nwx-row` badge rows are removed from the page.
- New structure matches Calendar directly: hero with small live pill, filter band above the list, compact source/search controls, column header, one razor-thin framed list, provider logo + provider name, headline/summary, context chips, external-link action, and a quiet footer for Tree/RSS/Lookonchain source truth.
- Source logos stay real and are resolved from article/provider domains through local `/api/source-logo`; no random letter badges or colored fake source dots in the news rows.
- Verified in the in-app browser: no `Source Stack`, no Binance top button, no `nwx-queue`/`nwx-source-panel`/`nwx-workspace`, no old `nwx-row`, one `nwx-page-list`, 140 `nwx-line` rows, 140 logos, 0 horizontal overflow at 390px. `npm run build` clean; `npm test` 50/50; `git diff --check` clean.

### 2026-07-09 — News source stack razor-frame correction
- Owner correction: the News page's left source stack looked like stacked boxes with dead bottom space. The Calendar tab is the reference for this utility-page pattern: one clean control band, then one razor-thin framed list with rows and hairline dividers.
- Fixed `News.tsx` by wrapping the source selector rows and source-truth rows in a single `nwx-source-panel`. The former `nwx-queue-list` and `nwx-source-card` no longer render as separate framed cards inside the left rail.
- Fixed `styles.css` so the source panel owns the only border/shadow, child rows use internal hairlines, source facts stay vertical at all breakpoints, and the measured panel bottom gap is only the 1px border stroke.
- Verified in the in-app browser: desktop rects, screenshot, Lookonchain source click, Binance Official mode click, mobile 390px no-overflow check. `npm run build` clean; `npm test` 50/50; `git diff --check` clean.

### 2026-07-09 — Shared topbar morph transition repair
- Aave nav lesson: topbar dropdowns feel smooth when the menu surface stays alive and the active content changes inside it. Destroying/recreating the menu or fading content hard creates the flicker the owner rejected.
- The shared `.smenu` is now always mounted. It uses `.open` for visibility instead of `{active && ...}`, so moving between topbar controls keeps one continuous surface. A small invisible bridge above the popover prevents the trigger-to-panel hover gap from collapsing the menu.
- `SharedTopBar()` keeps separate shell state (`active`) and content state (`contentActive`). Between controls, the shell rAF-tweens left/width/pointer while content swaps on a short staged morph. The content morph is almost transparent (`.985` opacity / `.998` scale), not a visible flash.
- Normal topbar trigger clicks are idempotent: click opens/selects a control, and moving away closes. Avoid click-to-close on the same icon because hover-open plus click-close fights the morph and can create close/reopen artifacts.
- CSS rule: `.smenu-content` has no entrance animation during tab switches. Never reintroduce `key={active}`, conditional menu mounting, or per-tab `smFade` on the shared content layer.
- Verified in Chrome, not the in-app browser: external references checked first (Aave nav, Apple HIG Motion/Popovers, Motion Primitives morphing popover); `npm run build` clean; Chrome hover/click checks confirmed AWS CLI -> API Keys -> Data Health keeps `.smenu open` and visible with `contentAnimation: none`.

### 2026-07-09 — Live news context wired from old-project source stack
- Applied the old project's news-source model in this repo without importing unavailable old files: new server endpoint `/api/news-context` in `server/src/index.ts`, backed by `server/src/services/newsContext.ts`. Current source string is `tree+rss+lookonchain`.
- Backend source truth: Tree of Alpha public history (`https://news.treeofalpha.com/api/news?limit=60`) is treated as delayed unless a Tree websocket/API key is added; RSS bundle includes FinancialJuice, WSJ Markets, Benzinga, Watcher Guru, ZeroHedge, CoinDesk, Cointelegraph, The Block, Decrypt, BeInCrypto, NewsBTC, AMBCrypto, U.Today, CryptoSlate, Bitcoin Magazine, Crypto Briefing, and WuBlockchain/Substack; Lookonchain uses the public feed endpoint `https://www.lookonchain.com/ashx/index.ashx?type=1&page=1&pageSize=24` with the feeds referer.
- News UI is now a two-mode operator surface: Live Context (`/api/news-context`) and Binance Official (`/api/news`). It has real source filters (All/Tree/RSS/Lookonchain), live source stack rows, source-status truth, headline search, read-state, Mark Visible Read, and external links. Binance Official mode keeps real catalog switching and priority queues.
- UI quality pass followed the premium surface checklist: fewer nested boxes, aligned stat strip, source stack + feed grid, crisp 540-ish headline voice, restrained state color, no fake controls, honest empty states, desktop/dark/mobile browser screenshots, computed style/rect checks, and click verification for filters, mode switch, search, and mark-read.
- Verified: external references checked first (Tree docs, Lookonchain feed behavior, FinancialJuice/RSS news feeds, TradingView News Flow filter anatomy); `npm run build` clean; `npm test` 50/50 gates; `git diff --check` clean.

### 2026-07-09 — News page operator scanner redesign
- News is now treated as an operator announcement scanner, not a generic article wall. `News.tsx` keeps the existing real `/api/news` feed contract (`id/title/date/url`) and derives only transparent UI metadata from headline text: listing, delisting, API, maintenance, futures, margin/loan, airdrop, and schedule labels.
- Added a real priority queue for Delisting Risk, API Watch, and Maintenance by fetching Binance catalog IDs 161/51/157 through the existing server proxy. These rows are clickable catalog switches, not fake alerts. Added local browser read-state and a real "Mark Visible Read" action.
- `styles.css` adds the nwx v2 operator layout: thinner 540 title, 430 numeric stats, full-width status strip, two-column desktop workspace, dense announcement tape, dark-mode support, and a mobile single-column stat strip to avoid truncated labels.
- Verified: current external references checked first (Binance announcement categories, TradingView News Flow, LSEG/Koyfin watchlist/news-alert workflows); `npm run build` clean; `npm test` 50/50; Chrome audit screenshots checked at 1600 light, 1600 dark, and 390 mobile; controls verified for refresh, priority switch, mark-read, and search empty state.

### 2026-07-09 — Trust Advisor topbar redesign
- Owner clarified the purpose: Trust Advisor is not notification history. It is the audit surface for bot controls, settings, variables, account/security posture, feeds, guardrails, and automation readiness. It should help the operator know what must be fixed or reviewed before trusting automation.
- `Header.tsx` Trust Advisor popover was redesigned around real derived checks only. It now uses three clear groups inspired by the Trusted Advisor model: Action Recommended, Investigation Recommended, and No Problems Detected. Details/actions route to existing real pages such as Risk and Health/System; no fake controls were added.
- `styles.css` adds a final topbar-family override: Trust Advisor, Notifications, and Account Details are pulled closer to the Clock popover rhythm with smaller widths, tighter padding, sharper text, visible footer actions, and less decorative animation/boxing.
- Durable rule added to `DESIGN_PLAYBOOK.md` and `UI_SURFACE_BASELINE.md`: Trust Advisor is a settings/control audit, not a decorative score card or notification feed.

### 2026-07-09 — Premium surface checklist recorded
- Owner distilled the target style: fewer boxes, high quality, good taste, premium look, maximum organization, clean style, mid-to-deep color, real icons/logos, perfect alignment, moderate animation, clear sections, clear spacing, and visible footer actions.
- Added `PREMIUM SURFACE CHECKLIST` to `DESIGN_PLAYBOOK.md` as a blocking standard for every topbar popover, modal, panel, card group, sidebar section, and dashboard zone. The checklist explicitly covers box discipline, organization, alignment, spacing, typography, color, real icons/logos, motion, sectioning, visible actions, real controls, family consistency, empty states, and browser verification.
- Future agents should treat this as the default taste target before making UI changes. It is not a decoration request; it is the quality gate for whether a surface feels premium and operational.

### 2026-07-09 — Notification topbar scale correction
- Owner correction: the compact notification tray looked cleaner but became too large and had too much edge/empty space compared with Clock and Account Details. Durable lesson added: topbar popovers should stay in the same visual family unless a real task needs a larger surface.
- Fixed hidden-filter state: the compact tray no longer shows an empty Logs state when Logs is not visible as a compact pill; it falls back to All and leaves Logs to the expanded center.
- Scaled compact notification down from a forced page-like panel to a tighter popover: narrower width, smaller padding, four visible rows, shorter row/icon rhythm, and compact empty state.

### 2026-07-09 — Notification tray Coinbase-clean base pass
- Owner correction: the clean Coinbase notification screenshot is the base, not the prior noisy operational tray. Durable lesson updated in `DESIGN_PLAYBOOK.md` and `UI_SURFACE_BASELINE.md`: compact notifications should be a quiet title row, one settings/expand affordance, pill filters, and repeated notification rows with category/date kicker, short title, readable summary, and one real icon medallion.
- Removed the compact tray's Critical/Opps/New metric strip and stopped using multiple visual formats for the same notification state. The tray now intentionally leaves breathing room and should not become a miniature dashboard.
- Expanded notification center keeps the real interaction surface: feed plus Advanced Alerts preferences together. The duplicate expanded metric strip was removed so the modal stays inspection + controls rather than another status scoreboard.

### 2026-07-09 — Notification hub unification pass
- Owner correction: the first notification repair copied the preference reference but left the main notification tray/modal noisy. The durable lesson is now explicit in `DESIGN_PLAYBOOK.md`: do not show the same notification state through multiple visual formats. Compact tray = title, one expand icon, Critical/Opps/New metrics, filters, and rows. No hero card, no score tile, no "Review new" prose, no separate Preferences footer.
- `Header.tsx` now opens one integrated notification center instead of a Feed/Preferences tab switcher. Left side is a filterable feed; right side is the Advanced Alerts preference surface. Preferences remain real draft controls: Cancel discards draft changes; Save Changes writes `prefs.alerts`; Push/WhatsApp remain static Planned states.
- `styles.css` adds a scoped notification hub override: compact popover widened to the 470px topbar menu, up to five visible rows, bare line icons, and quiet row dividers; expanded center uses the Coinbase-style row system across both feed and preferences.

### 2026-07-09 — Notification preferences reference pass
- Owner supplied a Coinbase-style "Advanced Transaction" notification settings reference and rejected the current notification preference modal for generic green bell chrome, nested cards, heavy/random text, and poor reference matching. Durable lesson added to `DESIGN_PLAYBOOK.md`: reference matching means copying the anatomy first — single vertical settings sheet, 28-30px padding, 70-74px rows, bare line icons, 18px/430 row labels, switches hard-right, one footer hairline, and no fake delivery toggles.
- `Header.tsx` notification preferences now split from the feed modal: feed keeps the operational notification center; preferences opens a Coinbase-style `prefs-mode` sheet with Delivery rows, real draft toggles for persisted `prefs.alerts`, Cancel that discards draft changes, and Save Changes that writes the preference object. Push/WhatsApp remain static Planned states instead of fake clickable toggles; In-app is static On because it is the current in-browser channel.
- `styles.css` adds a dedicated preference-sheet override so the preferences view no longer inherits the full notification-dashboard stat cards/two-column card layout. The sheet uses bare SVG icons, right-aligned iOS/Material-like switches, restrained text weights, and a separated footer.

### 2026-07-09 — PROJECT-LOCAL AGENT MEMORY + five-hour UI lessons captured
- Owner correction: durable lessons must live inside `/Users/cosmosgeek/Desktop/Main`, not in Codex/assistant memory. Added root `AGENTS.md` so future coding agents have a project-local entrypoint even if Codex is uninstalled or chat memory is gone. Updated this file's core-doc read order accordingly.
- Added `UI_SURFACE_BASELINE.md` after auditing the current rendered app and edited files. It records concrete baseline details for the side row, renamed/sidebar sections, brand/topbar, global search, clock, AWS CLI, API key, Data Health, Trust Advisor, Notifications, Kill Switch / Trading Mode, Market Refresh, Display Currency, Basis Display, Appearance, and Account Details profile.
- The five-hour UI grind is now encoded in `DESIGN_PLAYBOOK.md` and `AGENTS.md`, not only in chat:
  - **Real controls only:** no fake buttons, fake toggles, fake "live" states, fake guardrails, fake profile menu rows, or decorative controls. Buttons/toggles must do real work, open a real control surface, reflect real backend state, or be honestly marked Planned/Disabled With Reason.
  - **Typography sharpness:** Flow sidebar reference proved the issue was text, not background. Use calm 14px-ish nav labels, 20px line-height, 500-560 weights, exact row rhythm, simple black/gray text, no subpixel hover movement on persistent labels. Heavy 700 active labels, boxed inactive icon tiles, and `translateX(1px)` make text look swollen/soft under Chrome and project zoom.
  - **Motion restraint:** premium motion means rare, purposeful, and readable. Search idle beam = very thin paired streak with a quiet gap; search active = sharper streak with a tail; no static JPEG glow, no nonstop rotating search border. Clock = slow/calm if animated, no purple orbit, no aggressive spinning, no weird seconds box.
  - **Topbar trigger law:** triggers stay icon-first; useful words belong inside popovers. Avoid circles/dots/status badges everywhere; color communicates state only.
  - **Account/profile law:** profile dropdown is not navigation. It shows connected exchange/API posture, active/recent sessions/devices from real data, and logout. Device rows must come from `/api/sessions` facts (browser, OS, host/IP/country when available, current/active/recent, first/last seen).
  - **Borrow/Binance law reinforced:** bot-operated pages expose monitor + kill-switch/control state, not fake manual action buttons. Copy Binance layout truth, not direct Binance money-action controls unless explicitly ordered.
- Project-level verification standard reinforced: after UI edits, build, reload the real browser, inspect computed CSS for the exact issue, click touched controls, and use screenshots/rects. "Compiled" is not proof of visual quality.
- Note for future agents: `DESIGN_PLAYBOOK.md` has the operational rules; this entry is the high-level lesson record. Keep future durable preferences in project files, not external chat memory.

### 2026-07-08 (later) — CONTROL ROOM PASS: dashboard, account merge, borrow, dock (uncommitted)
- **Dashboard rebuilt as a quant strategy control room** (owner-directed, research-grounded): 6-stat quant strip (Total PnL/max DD/win rate/profit factor/Sharpe — Sharpe annualized from equity snapshots, honest "needs N more" states), new `web/src/components/PerfChart.tsx` (SVG cumulative-PnL + daily-bars chart, TradingView-tester style, zoom-safe/no animation) + DistChart histogram + attribution donut + profit-structure bars; Zone 2 "Strategy brain" (basis-scanner/volume-scanner/risk-gate as script-named rows + live proposals with Ticket/Inspect); Zone 3 ops (control&security / system / intelligence with REAL Binance listings + high-impact calendar rows).
- **Wallets merged into Account** (Binance-style): estimated-balance hero + donut allocation, sortable spot asset table with Sell tickets, cross-margin view, rail = connection/permission-map/security. `Wallets.tsx` DELETED; sidebar CAPITAL = Account/Borrow; page id `wallets` now routes to Account (deep links safe).
- **Borrow reordered Binance-style**: markets & positions first (ongoing loans, 166-asset loanable catalog, collateral schedule / margin cockpit), reverse-basis queue second, preflight chain last.
- **RefreshDock popover restyled** to the precision system (was functional; verified 9 live connection rows + tier scoring). **Bug fixed:** `Num.tsx` flash classes never cleared under `:root zoom` (color keyframes freeze) → values stayed green forever; now removed after the pulse.
- Verified: build clean, gates 50/50, all 14 sidebar pages crash-free, light+dark. Uncommitted.
- **Loop iteration 3 (owner re-ran the loop):** Dashboard now uses the exact TradingView Key-stats pattern — one card: "Key stats" head with Equity/PnL/ROI% toggle, 6-stat grid (equity/PnL/DD/win rate/profit factor/Sharpe), hairline, live equity chart with axis chip; all `exec-stats` strips app-wide became floating cards on the canvas; PnL tab's Equity lens renders the full `EquityChart`. Verified: build clean, gates 50/50, 14 pages crash-free, dark OK.
- **Richness pass (owner: "you stripped the Apple look and left it boring"):** light mode now has a soft canvas (`--canvas` #f5f6f8 behind `main`) with white cards floating on soft shadows (radius 14) — the TV/Binance card feel; NEW `EquityChart` (real 15-min snapshots, time axis, TradingView last-value chip) is the dashboard hero with an Equity/PnL/ROI% toggle (defaults to Equity while realized history is short, so the dashboard leads with a living chart instead of empty boxes); empty analytics boxes collapse to one arming note; `WinLoseBar` (Binance lead-trader style) + colored donut legend swatches added. Lesson: precision must not mean flat — data graphics (charts/meters/sign-colored money) ARE the richness, decoration tiles are not.
- **Gap-fix follow-up (owner audit):** Account lost its Spot/Margin tab switch (owner: "not just horizontal tabs") — now one continuous view, margin section under assets; Borrow gained a real Binance-style borrow console (coin/amount/collateral datalists, live hourly/APR/limits + collateral LTV ladder, gated Borrow → existing typed-confirm modal); Dashboard gained ROI% toggle with REAL BTC buy-&-hold benchmark from `/api/klines` daily closes, run-ups & drawdowns durations from equity snapshots, day analysis (best/worst/avg W/L/streaks), and an honest AWS cost row. Note: both dev servers silently died mid-session (stale browser masked new code) — restart preview servers before judging "missing" UI.

### 2026-07-08 — PRECISION UI PASS: every page rebuilt on one locked system (uncommitted)
- Owner-directed full-cockpit visual rebuild (Claude/Fable session, not Director). New shared primitive kit `web/src/components/px.tsx` (PageHead/Sec/Group/Row/Pill/Dot/Seg/Empty) + one locked CSS system in styles.css ("PRECISION SYSTEM (hp-)" block): type 11/12/13/24/28, weights 450/500/600/680, radii 8/10/12, 4px grid, color marks STATE ONLY, mono+tabular values, fixed-height single-line table rows, right-aligned numeric columns.
- Rebuilt/reskinned per BLUEPRINT §6 contracts, stripping must-not-show garbage (hero essays, command-card farms, tutorial rails, duplicate status displays, six-row "Not wired" walls): Health, Risk, Logs, Settings, Execution (shell + Ticket/Orders/Positions/Fills/PnL), Opportunities, Basis Scanner, Volume Scanner, Markets (CSS-level), Borrow, Wallets, Account, Dashboard (new Command Center per §6.1), News, Calendar; topbar triggers got descriptive titles.
- Dead CSS war: ~1,300 obsolete rules deleted (styles.css 562KB → ~392KB). One casualty class (`trade-review-panel` shared selector) restored in the new style.
- Verified: `npm run build` clean, gates 50/50, all 15 sidebar pages render with zero console errors, light+dark checked. Work left UNCOMMITTED on current-main for owner review (Header.tsx also carries another session's small quick-settings tweaks).

### 2026-07-08 — BOTH OVERDRIVE ENGINES MERGED (synthetic-proof baseline)
- BASIS agent (branch engine-overdrive, 7a48d4e) merged as `abce24e`: 17 modules ~3,349 lines in `server/src/engine/basis/`. 73/73 proofs. Inventions: gap-stability CV, funding flip-risk + capture factor, cross-leg timestamp skew, mark-book divergence, book pressure. Research: spot bookTicker has NO event time → per-leg receive-clock staleness; maxBorrowable is weight-50 → borrow = injected cached data.
- VOLUME agent (branch engine-volume-overdrive, 6ce84b2) merged as `131fc32`: 17 modules ~2,961 lines in `server/src/engine/volume/`. 88/88 proofs. Inventions: wash_uniformity_suspect, depth_vanished, aggregate_single_print, absolute activation quote floor, verification grace window. Research: miniTicker@arr universe at 1s; ~226 streams worst case; kline backfill ~6000 weight → staggered/lazy.
- Director-verified both in Main: build clean, 50/50 app gates, 73/73 + 88/88 engine proofs coexisting. Territories clean (zero collisions). Tag: `checkpoint-engines-v0-synthetic`.
- Agent flags to reconcile later: v0 RejectCode lacks their detail codes (ride in evidence.detailCode); v0 EngineEventKind lacks kill_switch_changed; BorrowVerdict could graduate to v0.
- **HONEST STATUS: engines are synthetic-proof decision brains — NOT wired to live Binance streams, never seen a real market, zero live trading.** Next pass: live WS adapters behind their TradeSource/BookSource interfaces, kline baseline backfill, borrow provider, risk-gate hookup, express routes, then PAPER mode + ledger evidence before any money.


### 2026-07-07 — UI phase close-out + engine setup
- Merged the three worktrees' final UNCOMMITTED polish (risk/logs/health — committed in worktrees as 3a17c79/33b5f9e/6fa6afd, merged as `80e2c27`; styles.css consolidated −~108KB). Byte-parity verified across all worker files.
- Fixed localhost:8080: the Logs agent's leftover dev server (cwd `cosmos-logs/server`, no web/dist → "Cannot GET /") was killed; Main's server now on 8080 (HTTP 200, keys present, connected). Killed remaining stray cosmos-logs vite/tsx dev servers.
- Tagged recovery checkpoint `checkpoint-ui-complete-pre-engine`; ENGINE.md got a one-line status (engine not started; Part 0 next).
- Created engine worktree `../cosmos-engine` (branch `engine-part0`) + `TASK_ENGINE_PART0.md` (planning-only survey per ENGINE.md §16 Part 0 / §17 — NO code).
- Worktrees cosmos-{risk,logs,health,settings}: merged + clean, left in place because Codex chats still hold processes there; remove after windows close.

### 2026-07-07 — Missed-file fix: settings worker's Header.tsx (topbar quick-settings)
- Owner caught a merge gap: the settings worker's FINAL commit (7273d1a) also reworked `Header.tsx` — compact topbar quick-settings popover (theme+accent, zoom, currency chips, basis, refresh, table density, motion, "Open settings →"), alert toggles folded into notifications, redundant network/alerts/currency/zoom/theme popovers removed. First reconcile only took page tsx + css, so the component was dropped (its CSS had merged, orphaned).
- Fixed: `git checkout 7273d1a -- web/src/components/Header.tsx` → commit `8755803`, pushed. Build clean, gates 50/50, popover verified live, no console errors.
- Exhaustive audit after fix: every file changed by each worker-final (7273d1a/2d22560/8833b93/d93fff8 vs base ba804d8) is now byte-identical on current-main, and each worker's styles.css appended block is byte-contained in the merged styles.css (verified non-empty, literal SHAs).
- **Lesson:** when merging worker branches, enumerate `git diff --name-only <base> <tip>` at the FINAL tip — never assume the file list from an earlier tip; workers add files (esp. shared ones like Header.tsx) in later commits.

### 2026-07-07 — Merged all four Control rebuilds into current-main
- Four Codex 5.5 workers finished (worktrees cosmos-{risk,logs,health,settings}). Merged one at a time, squashed, into `current-main`: Settings `119b9aa`, Health `9fe42e7`, Logs `87de7b2`, Risk `2689268`; then reconcile fix `2eb1f80`.
- Result: Risk = pre-trade safety console (posture + blocker stack, kill switch, live-arm gate, wired limits + six "not wired" guards disabled-with-reason, gate probe, allow/blocklist, rejections→Logs); Logs = incident/audit console (severity strip, debug hidden, event table + inspector + JSON drawer, error-first); Health = machine trust dashboard (overall verdict + data-path checks green/amber/red/gray + "what to fix next"); Settings = boring local prefs only. build clean, gates 50/50, all four verified styled in-browser, no console errors.
- **Merge lesson (record):** each worker made 4-5 iterative commits that each APPENDED a marked block to `styles.css`; the squash-union of four such files left **+5 unbalanced braces** → a CSS parse break that silently unstyled Risk. Also workers kept committing after I merged (tips moved), so merged tsx/css drifted. Fix pattern that worked: reconstruct `styles.css` deterministically = base (verified clean prefix) + each worker-final's appended block, and pull the page `.tsx` from the SAME worker-final commit. Note: `git show $VAR:path` fails in this sandbox — use literal SHAs.
- Worktrees still registered (cosmos-*); agents may still be committing. Prune when confirmed idle.
- Next: **Engine Part 0** (scanner-only, no trading) per ENGINE.md §16.

### 2026-07-07 — Worktrees + briefs for Control page rebuild (routing, not building)
- Owner rejected the current Control pages on product-seriousness grounds (not build/test). Director routes the rebuild via isolated worktrees; does NOT rebuild pages in-chat.
- Created 4 git worktrees off `current-main` @ ba804d8, one branch each:
  - `../cosmos-risk` (branch `rebuild-risk`) → `TASK_RISK_REBUILD.md`
  - `../cosmos-logs` (branch `rebuild-logs`) → `TASK_LOGS_REBUILD.md`
  - `../cosmos-health` (branch `rebuild-health`) → `TASK_HEALTH_REBUILD.md`
  - `../cosmos-settings` (branch `rebuild-settings`) → `TASK_SETTINGS_REBUILD.md`
- Each brief (in its own worktree, gitignored) rewritten to the higher "product truth" standard: Risk = pre-trade safety console with blocker stack + rejections; Logs = incident console with severity strip + error-first mode + JSON drawer; Health = trust dashboard with overall verdict + "what to fix next"; Settings = boring/local only. Each: one page file only, scoped CSS appended under a marked block, npm install→build→test→screenshot→commit to its branch, no engine/secrets/live-trading/other-pages.
- Worker = Codex 5.5 only (no Spark/5.3 for UI). Workers run in their worktrees so they cannot clobber Header/App/store/styles/server.
- Merge order (Director merges one branch at a time into current-main; build/test/screenshot/commit/push + update BLUEPRINT/PROJECT_MEMORY after each accepted page): **Settings → Health → Logs → Risk** (simplest → most complex; styles.css conflicts resolved append-only by Director).
- current-main clean @ ba804d8; page rebuilds pending workers.

### 2026-07-07 — PRODUCT TRUTH PASS: sidebar restructure + 5 rebuild briefs
- Directive: the Control cleanup polished existing pages instead of rebuilding them from their job. Now rebuild each Control page from its operator job; restructure the sidebar; Settings is bottom utility, not Control.
- Director did directly (tiny + docs): restructured sidebar in `Header.tsx` — **Borrow moved Market→Capital** (Capital = Account/Wallets/Borrow), **Market = Markets only**, **Control = Risk/Logs/Health** (Settings removed), **Settings moved to bottom utility** (`snav-utils` = News/Calendar/Settings). Updated BLUEPRINT §6 to this source-of-truth. `.gitignore` now ignores `TASK_*.md`.
- Wrote 5 single-surface worker briefs (gitignored/local, for Codex 5.5, one worktree each): `TASK_RISK_REBUILD.md`, `TASK_LOGS_REBUILD.md`, `TASK_HEALTH_REBUILD.md`, `TASK_SETTINGS_REBUILD.md`, `TASK_SIDEBAR_AND_REFRESH_DOCK.md`. Each: rebuild-from-job (not preserve), one file only, disabled-with-reason instead of fake numbers, no Header/App/store/server unless explicit.
- Each page rebuilt from its single question: Risk="can anything act?"; Logs="what happened/failed/why?" (incident console, severity, hide debug); Health="can I trust the system now?" (green/amber/red/gray); Settings="how does this browser display the cockpit?" (local UI only).
- RefreshDock already meets the Sync/Health Dock spec (verified prior run) — no rebuild needed; remaining dock work = optional topbar compaction (dedupe Wi-Fi/data-health icons).
- Execution model: **sequential or one git worktree per worker** (agents must not share Header/App/store/styles/server — those are Director merge points). Recommended order if sequential: Risk → Logs → Health → Settings.
- build clean, gates 50/50. Sidebar committed; page rebuilds pending Codex 5.5.
- Next step: run the 4 page briefs (parallel worktrees or sequential); Director verifies + merges each with build/test/screenshot before the next.

### 2026-07-07 — Verify + commit Control cleanup (B–E done) + parallel-agent lessons
- Codex 5.5 executed the B–E brief (18 min, ~99% context — one 4-surface brief was too big for a single agent).
- Verified on disk + browser (build clean, gates 50/50, no console errors):
  - Risk = execution-guard controls only, embedded Rules&governance removed.
  - Logs = operator audit surface: severity model (Critical/Warning/Info/Debug), filters (severity/kind/symbol/text/time/accepted-rejected/group), summary counts, reasons-first timeline, useful event detail + Raw JSON. Debug/system-noise hidden by default.
  - Health = trust/status board, duplicate Safe-routes removed, gray engine-heartbeat placeholder.
  - Settings = local UI prefs only (+currency), all API/withdrawal/health/risk posture moved out; tiny "keys are server-only → Account/Health" reminder.
- **Sync/Health bubble = the existing `RefreshDock`** (bottom-right). Codex folded brief-D's health model into it (browser→server, Binance REST, socket, feed, account sync, user stream, clock drift, rate budget, Ledger DB, last error) + click-refresh spin/ok/err. The flickering `SyncHub.tsx` was a scratch attempt, correctly discarded — NOT a missing piece (no duplicate bubble).
- Also captured a **parallel agent's reliability work**: `ErrorBoundary.tsx` + window error/rejection breadcrumbs (`main.tsx`) + static-asset cache policy (`server/index.ts`, fixes blank-white after rebuild).
- Commits: `2def993` (fix: error boundary + breadcrumbs + cache policy), `a2518e1` (ui: simplify control surfaces + health refresh model). Pushed.
- **Lesson (parallel agents):** multiple agents in ONE working tree collided — the ErrorBoundary agent's `App.tsx` overwrote Codex's `<SyncHub/>` mount, and files flickered in/out. Going forward: one **git worktree per agent**, one **surface per brief** (small context), and never let concurrent agents share `App.tsx`/`styles.css`/`store.tsx`/`Header.tsx`/`server/index.ts` — those are Director-owned merge points.

### 2026-07-07 — Control cleanup pass: sidebar rename + brief (A done, B–E briefed)
- Asked: clean the Control section (Risk/Ledger/System/Settings) to operator-grade; keep four surfaces; rename Ledger→Logs, System→Health; scope B–E to Codex 5.5 via TASK_BRIEF.md.
- Gate: branch `current-main`, tree clean, no concurrent editing (last edits were the committed permission fix).
- Director did directly (tiny + docs): sidebar labels **Ledger→Logs**, **System→Health** (`Header.tsx`, page ids unchanged `ledger`/`system`); BLUEPRINT §6 Control responsibilities + Sync/Health bubble spec + Settings-local-only + Logs-hides-debug + Earn-belongs-Wallets.
- Wrote `TASK_BRIEF.md` (gitignored/disposable) for Codex 5.5 covering B (Risk = guard controls only, drop the embedded Rules&governance section, add Open-logs link), C (Logs severity model + filters + summary + hide debug by default), D (Health cleanup + new bottom-right `SyncHub` bubble, don't break API-key icon/RefreshDock), E (Settings = local UI prefs only, move API/security/health out).
- Build/test: run after the rename (see report). Current URL: local preview autoport.
- Next step: paste `TASK_BRIEF.md` into a Codex 5.5 chat to execute B–E; Director verifies + commits `ui: simplify control surfaces and health refresh model`.

**TODO (Wallets/Capital future pass):** Earn balance is NOT part of normal spot balances. A future read-only Wallets pass should add Simple Earn flexible/locked position adapters and **cache** them (endpoints are signed + high request-weight — do not poll Earn aggressively).

### 2026-07-07 — Full account + project audit (pre tab-by-tab pass)
- Purpose: confirm nothing broken/missing before editing each tab.
- Build clean; gates 50/50. All 15 sidebar surfaces render (no error boundaries, none empty); Execution's 5 sub-tabs (Ticket/Orders/Positions/Fills/PnL) all switch correctly (earlier "sticking" was a stale-DOM-ref test artifact — `<main key={page}>` remounts).
- Endpoint parity: every frontend `/api/*` call has a matching server route. All 14 read endpoints return 200 with real data: markets 442 rows, events 200, loans 166 loanable/119 collateral, account 5 assets / $50.03, feeds all open (spot-miniticker, futures-markprice, futures-liquidations), proposals 2, open orders 0, fills 0 (honest — no recent spot trades). No console errors/warnings.
- **Known limitation (not a blocker):** user data stream = `listenKey unavailable: Gone` — Binance returns **410 Gone**; the legacy listenKey user-stream endpoint is deprecated. App correctly falls back to 30s polling (account data stays live). Real fix = migrate to Binance WebSocket-API user data stream (own task; note the current HMAC key can't do the Ed25519 `session.logon` the new WS API wants).
- Cosmetic: some token icons are ORB-blocked from external CDNs (jsdelivr/coincap) in the preview sandbox → letter-avatar fallback; production uses the server icon resolver + CSP allowlist.
- Stale data: old ledger `error_event` "API key has WITHDRAWAL permission enabled" warnings are historical (pre key-scope fix, when it read account-level canWithdraw). New syncs no longer emit them.
- Verdict: **ready for tab-by-tab editing** — builds, tests, renders, real data all green.

### 2026-07-07 — Fix Binance key-permission detection (key-scope truth)
- Asked: stop judging safety by account-level `canTrade`/`canWithdraw`; use per-KEY `/sapi/v1/account/apiRestrictions` fields and posture rules; fingerprint 6+4; update Account permission map + System Health; keep trading/withdrawals blocked.
- Changed: `client.ts` — `maskApiKey` → first6+last4; defensive `coerceBool`/`normalizeRestrictions` ("false" string is truthy → would invert a check); exported `keyPosture()` (worst-wins: withdrawals→unsafe, universal/internal transfer→unsafe, spot&margin→trading, margin/futures/options→elevated, reading-only→"Read-only key OK"; carries ipRestricted). `account.ts` — `canTrade`/`canWithdraw` now sourced from key flags (`enableSpotAndMarginTrading`/`enableWithdrawals`), account-level only as fallback. `index.ts` — expose `keyPermissions` + `keyPosture` on `/api/state` and `/api/system`. `types.ts` + `Account.tsx` (full per-key permission map, posture badge, IP-restricted chip, unsafe warn only on real unsafe) + `SystemHealth.tsx` ("API key scope" row).
- Verified live (real key): `keyPosture=Read-only key OK` (level read_only), `ipRestrict=true`, all trade/transfer/withdraw flags false, fingerprint `MGVMfD••••VSPa`, Account posture 6/6, no console errors. build clean, gates 50/50.
- README: setup wording already correct (Reading only / withdrawals+transfer+trading off / IP restrict) — unchanged.
- Still blocked: trading (kill switch + risk gate), withdrawals/transfer-out (no routes). No raw key/secret exposed.
- Note: signed read-only endpoints need BOTH key + secret (HMAC signature) — `.env` has both, confirmed working.

### 2026-07-07 — Refresh/reconnect dock + authoritative per-key permissions
- Asked: cleanly push another chat's additions — top-bar key manifest, a bottom refresh/reconnect dock, connection-health.
- Changed (concurrent-session work, not Director-authored): 13 files + new `web/src/lib/refresh.ts`. Highlights: `RefreshDock` (bottom, WAA-driven spin, success/fail marks, health popover) + global `fireRefresh`/`useRefreshSignal`; `POST /api/refresh` (server resync); `GET /api/apikey` (key manifest — masked fingerprint + first-8 prefix only, never full key/secret); new client `apiRestrictions()` → `/sapi/v1/account/apiRestrictions` for **authoritative per-key** permissions.
- Security **correction** to prior run: the active key is genuinely **read-only** — per-key `apiRestrictions` = `{reading:true, spotMargin:false, marginLoan:false, withdrawals:false, universalTransfer:false, futures:false}`. Last turn's `canWithdraw:true` was the *account-level* flag (true even for read-only keys); the new per-key check is the real scope. No over-permissioned key. A second "secrets-full" manifest entry is a *planned* AWS-Secrets key (withdrawals still false), not active.
- Safety: no withdrawal/transfer/trade routes added; no secret in responses/logs. build clean, gates 50/50. Browser-verified: dock renders, no console errors, `/api/apikey` masked, dashboard shows real $50.031 equity, posture 5/6 "withdrawals disabled".
- Committed & pushed to `current-main`. Old `main` untouched.
- Next action: owner review; user-stream still on polling fallback; optionally wire the planned AWS-Secrets key later.

### 2026-07-07 — READ-ONLY BINANCE API PHASE
- Asked: show real Binance read-only account state from server-side env; no trading, no withdrawals/transfers, no frontend keys, no secrets in git/logs.
- Env names (already standard, no rename): **`BINANCE_API_KEY`**, **`BINANCE_API_SECRET`**. Server has a no-dependency `.env` loader (`server/src/index.ts` `loadDotEnv`). `.env` present, gitignored, untracked.
- Found: backend already had a full read-only account service (balances, equity, positions, PnL from ledger, permissions `canTrade`/`canWithdraw`, open orders, fills, user-stream+polling). Only gap = masked key fingerprint.
- Changed: `maskApiKey()` (first4••••last4 of the KEY only, never the secret); `keyFingerprint` added to `/api/state` + `/api/system` binance blocks; web type + Account "API keys" card show it; recreated `.env.example` (placeholders + read-only posture); README "Local read-only Binance setup"; `SKIP_DOTENV` flag so the gates harness boots keyless deterministically (real `.env` had broken the 8 disconnected-state gates).
- Verified live (real key): `connected=true`, masked fingerprint `MGVM••••VSPa`, 5 assets + live equity, open orders 0, `mode=HALTED`. build clean, gates 50/50. No console errors.
- SECURITY finding: the loaded key reports **`canTrade=true` AND `canWithdraw=true`**. The app blocks all of it (kill switch ON, no withdrawal/transfer route exists) and flags it loudly ("unsafe key scope" badge, warn strip, ledger warning), but the key is over-permissioned — owner should recreate it as Reading-only, trading OFF, withdrawals OFF.
- `userStream=failed` → polling fallback active (account data live via ~30s poll).
- Still blocked: trading (kill switch + live-off + risk gate), withdrawals/universal transfer/margin loan-repay-transfer (no routes exist).
- Next action: owner recreates the Binance key with read-only permissions; optionally revisit user-stream vs polling.

### 2026-07-07 — Commit animated top-bar menus
- Asked: push the current on-disk state cleanly — the other chat animated the top bar.
- Changed (concurrent-session UI work, not Director-authored): `web/src/components/Header.tsx` (unified top-bar menu/popover with slide+fade animation, rAF-tweened left/width), `web/src/styles.css` (`smIn`/`smFade` keyframes), `web/index.html` (favicon → arbitrage mark, title → "Arbitrage Control Room").
- Safeguard: build clean, gates 50/50 before commit. Tree was stable (last edit ~4 min prior).
- Committed `53ba5d5` (ui: animated top-bar menus + arbitrage favicon/title); pushed to `current-main`. Working tree now clean.
- Topbar control *set* unchanged (animation polish only) → no BLUEPRINT structural change. Old `main` untouched @ `80c234f`.
- Next action: resume skeleton/visual pass or Engine v0 Part 0; tag a fresh checkpoint if a pinned recovery point is wanted at `53ba5d5`.

### 2026-07-07 — Session-tracking checkpoint (formalized) + concurrent-edit note
- current branch: `current-main`.
- latest clean commit before the WIP: `75b10ee` (bootstrap audit).
- WIP summary: **active session tracking** — server `GET /api/sessions` (per-device, IP+UA, Cloudflare-aware, 30-min TTL) + account-card "Active sessions" list + `TrustedAdvisor` panel. Real request-derived data.
- files changed (in the WIP commit `c7d10d7`): `server/src/index.ts`, `web/src/components/Header.tsx`, `web/src/styles.css`.
- build/test result: **build clean, gates 50/50** — verified last turn at the exact content now committed as `c7d10d7`. Not re-run this turn because another agent is mid-edit on `Header.tsx` (would test a half-written file, not the committed checkpoint).
- GitHub state: default branch is now **`current-main`** (owner set it via the UI after last turn — origin HEAD symref confirms). Old `main` untouched @ `80c234f`.
- Director capability note: **can** push branches and tags over SSH; **cannot** change GitHub repo settings (default branch, etc.) or hit the REST API without `gh` or a Personal Access Token. Can read the remote default branch via `git ls-remote --symref origin HEAD` (no token needed).
- Concurrent-tree hazard: two agents share this working tree; `Header.tsx` observed flipping clean→modified in seconds. Do not stage/commit another session's files; commit only Director-owned docs.
- Checkpoint tags: `checkpoint-skeleton-pass1-current-main` (last turn) and `checkpoint-current-main-session-tracking` (this turn) both point at the committed session-tracking state.
- next exact step: let the other session finish `Header.tsx`; then, if a fresher checkpoint is wanted, re-run build/test on a clean tree and move the tag or cut a new one.

### 2026-07-07 — Source checkpoint tag (skeleton pass 1)
- Asked: create a recoverable source checkpoint tag `checkpoint-skeleton-pass1-current-main` on `current-main`; don't commit node_modules/dist/data/.env/secrets; leave old `main` untouched.
- Blocker found: working tree was NOT clean — ~298 lines of uncommitted "active session tracking + TrustedAdvisor" feature (server `/api/sessions`, account-card session list, styles), almost certainly from the other chat running a dev server in this folder.
- Owner decision: commit the WIP with safeguards (do NOT tag the old clean commit over real WIP).
- Safeguards run before committing: verified feature is wired end-to-end; build clean; gates 50/50.
- Changed: committed the 3 WIP files as `c7d10d7` (feat: active session tracking + trusted advisor panel). Then tagged `checkpoint-skeleton-pass1-current-main` and pushed branch + tag.
- Note for authoring session: BLUEPRINT.md still needs a proper entry for the new `/api/sessions` contract + account-card "Active sessions" / TrustedAdvisor UI — I committed but did not design it, so I left the product doc to the author.
- Old `main` @ `80c234f`: untouched.
- Next action: owner review; resume skeleton/visual pass or Engine v0 Part 0.

### 2026-07-07 — DIRECTOR BOOTSTRAP AUDIT
- Asked: prove the project survives if this chat dies — verify repo truth, docs-vs-code match, and that a fresh Director can resume from files alone; no UI/engine work.
- Verified: path `/Users/cosmosgeek/Desktop/Main`, branch `current-main`, head `be7a7f8`, remote `git@github.com:cosmosgeek0/arbitrage-cosmos.git`, clean tree; node_modules/data/.env/dist ignored, nothing forbidden tracked. Code sidebar (6 groups) + topbar + pages match BLUEPRINT §6; README → 4 core docs.
- Doc gaps closed: PROJECT_MEMORY §5 phase was stale (still said "next = screenshot") → updated to skeleton-done; RULEBOOK §22 Worker routing policy added (Director/Codex 5.5/Spark-restricted/Fable/Opus + 1-surface blast-radius cap); RULEBOOK §23 TASK_BRIEF.md context rule added (>40-line prompts go to TASK_BRIEF, worker gets one-line instruction); `.gitignore` now ignores `TASK_BRIEF.md`.
- Code changed: none (no doc-vs-code drift found).
- Bootstrap test: a fresh Director can answer all 12 questions from files alone → PASS.
- Next action: owner review; then reference-image visual pass, dark-mode pass, or Engine v0 Part 0.

### 2026-07-07 — Restore News/Calendar tiles + in-app CloudShell overlay
- Asked (owner correction to SKELETON PASS 1): put the bottom-left News/Calendar sidebar tiles back; put the topbar Cloud Shell button back; and make that top button open an in-app AWS CloudShell-style popup (like the News quick-view), not a new tab.
- Changed:
  - `Header.tsx`: restored `snav-utils` News/Calendar tiles; restored topbar CloudShell button (wired to `openOverlay('cloudshell')`); re-added `IconTerminal` import + `CLOUD_SHELL_URL`; new `CloudShellModal` (terminal-styled honest launcher) added to `Overlays()`.
  - `lib/overlay.ts`: `OverlayKind` now includes `'cloudshell'`.
  - `styles.css`: appended `.cs-*` terminal overlay styles (dark, AWS-orange banner, green prompt, native caret).
  - `BLUEPRINT.md` §6 updated: News/Calendar tiles kept; topbar set now lists CloudShell quick-view; CloudShell honesty note.
- CloudShell overlay is an honest launcher — real deploy-target facts (cg-arbitrage-01, /opt/arbitrage-cosmos, ubuntu, SSM), live host prompt `ubuntu@ip-172-31-2-134:~$`; "Open in AWS"/Enter opens the real console. No faked attached session.
- Tests: build clean; gates **50/50**. Browser-verified: bottom tiles visible, top button opens overlay (banner/region/prompt correct), zero console errors.
- Failed: nothing.
- Next action: owner review; then dark-mode screenshot pass or Engine v0 Part 0.

### 2026-07-07 — SKELETON PASS 1 (done)
- Asked: collapse cockpit into 6-group sidebar (OVERVIEW/CAPITAL/MARKET/ENGINE/EXECUTION/CONTROL); merge Trade/Orders/Positions/Fills into one Execution page with tabs; remove Tokens/Rules/Cloud Shell/News/Calendar from sidebar; rename Strategies→Basis Scanner; create Volume Scanner placeholder; keep topbar as-is (no additions).
- Started from clean tree @ 6131312 on `current-main`.
- Inspected: App.tsx routing, Header.tsx (sidebar/topbar/search), store.tsx Page ids, Palette, Rules/Risk/Dashboard/Strategies/SystemHealth pages.
- Changed:
  - Sidebar → 14 items / 6 groups exactly per spec. Tokens, Rules, Cloud Shell, News/Calendar tiles removed. Cloud Shell topbar icon also removed (not in the keep-list); admin link added inside System → Cost & usage.
  - New `web/src/pages/Execution.tsx`: tabs Ticket/Orders/Positions/Fills/**PnL**. PnL kept as a 5th tab (blueprint requires PnL under Execution; it had no other home) — flag to owner if unwanted. Old page ids stay valid internal routes → all existing setPage()/openTicket() deep links land on the right tab; sidebar keeps Execution highlighted via `match` list.
  - New `web/src/pages/VolumeScanner.tsx`: honest placeholder, 11 exact decision-board columns, no fake engine (page id `volume`).
  - Strategies renamed Basis Scanner (nav label, page title, doc titles). Page id stays `strategies`.
  - Rules page → `GovernanceSection` embedded at the bottom of Risk ("Rules & governance"); `rules` page id deleted from store/Palette/search; Dashboard links repointed to Risk.
  - Palette + sidebar search entries updated to the new skeleton; Token Detail reachable via Markets rows and token search only.
  - Page-scoped CSS appended to styles.css (exec-tabs, vol-*, risk-governance-card) — no global token changes.
- Tests: root build clean (tsc + vite); `npm test` gates **50/50 passed**. Browser-verified on session preview (port auto-assigned): Dashboard, Markets, Execution (tab switching works), Risk (governance section: 9 rule rows), Volume Scanner, Basis Scanner — zero console errors.
- Screenshots: Dashboard, Markets, Execution, Risk captured in-session (light mode).
- Failed: nothing.
- Blockers: none for skeleton. Next-step blockers: dark-mode screenshot pass not done this run; owner decision whether PnL stays a 5th Execution tab.
- Next action: owner review of skeleton → then Phase C/F visual pass with reference screenshots, or start Engine v0 Part 0 planning survey.
- New facts: another session's dev server occupies port 8080 in this folder; this session's preview auto-assigned a free port (launch.json `autoPort` works).

### 2026-07-07 11:17 IST — DOC SYNC protocol adopted
- Asked: make a DOC SYNC mandatory at the end of every Director run — define which of the four docs updates when, the grinder/`TASK_BRIEF.md` boundary, and the required final-response format.
- Inspected: RULEBOOK doc-ownership sections (§8, §20) for consistency with the new protocol.
- Changed: added `DIRECTOR_RULEBOOK.md` §21 (DOC SYNC protocol, doc ownership, grinder/`TASK_BRIEF.md` boundary, required final-response format); fixed §20 to send end-of-context state updates to `PROJECT_MEMORY.md` instead of the rulebook; added this run log.
- Committed/pushed: pushed to `current-main` this run (hash in `git log` / Director report).
- Failed: nothing.
- Current state: `Main` = git-tracked source of truth, branch `current-main`, clean tree, four core docs. App not run yet this session.
- Next action: Phase B — run the app and screenshot every current surface (light/dark).
- New facts: workflow rule — grinders never read `PROJECT_MEMORY.md`; Director issues one scoped `TASK_BRIEF.md` per worker.

### 2026-07-07 (~11:14 IST) — Main established as source-of-truth git repo
- Asked: make `Main` the committable/recoverable source-of-truth; init git if absent; attach remote without overwriting old history.
- Inspected: `.git` absence, tree sizes, GitHub SSH auth, `.claude/launch.json`, staged-file safety.
- Changed: added `PROJECT_MEMORY.md` (4th core doc); updated `README.md` + `DIRECTOR_RULEBOOK.md` §8 to four core docs.
- Committed/pushed: `68b28c7` initial import → pushed to new branch `current-main` (no force). Safety copy at `~/Desktop/Main-safety-20260707-111420` (excludes `node_modules/`).
- Failed: nothing.
- Current state: remote has `current-main @ 68b28c7` and untouched `main @ 80c234f`.
- New facts: GitHub SSH auth works as `cosmosgeek0`; `origin = git@github.com:cosmosgeek0/arbitrage-cosmos.git`.

### 2026-07-06 — Core docs authored
- Three core docs (`DIRECTOR_RULEBOOK`, `BLUEPRINT`, `ENGINE`) authored/installed in `Main`.

## 2026-07-08 — Global type-discipline sweep (dock voice everywhere)
- Flattened ALL remaining loud font weights app-wide: 284 rules in styles.css + 8 in Markets.css were still at 700-900 from legacy generations. Deterministic map: 700→620, 710-730→640, 740-750→650, 760-790→600 (tiny caps labels), 800-820→650, 850+→680. Nothing in the app renders above weight 680 now (verified by grep census: zero ≥700 in CSS or inline styles).
- Appended GLOBAL TYPE DISCIPLINE block to styles.css: .drow/.quote-meta-row k/v rows now speak dock voice (12px/500 muted labels + 12px mono tabular values), chip-tag/mini-btn/cta-pill calmed to 550-620.
- Verified: build clean, 50/50 gates, all 14 pages + bottom nav crash-free with zero console errors, screenshots judged on Execution ticket, Dashboard, News, Account, Borrow (light) + Account (dark).
- Footer scroll behavior from previous pass still holds (hidden at top, appears at scroll end).
- All work remains uncommitted on current-main.

## 2026-07-08 — 120% zoom popover fixes (owner caught letters clipping + ghost text)
- ROOT CAUSE 1 (letters falling out of chips): `flex: 1 1 0` equal-width buttons inside a shrink-wrapped `.qs-mini` track — Chrome's intrinsic-width heuristic for basis-0 flex under-sizes the track, and fractional :root zoom (120%) tips "Percent"/"Reduced" past their chip edges. FIX: `.qs-mini` is now `display: grid; grid-auto-flow: column; grid-auto-columns: 1fr` (grid computes N x widest-label exactly, zoom-proof) + `white-space: nowrap` on seg buttons. RULE: never use flex basis-0 equal columns inside a content-sized container — use grid auto-columns 1fr.
- ROOT CAUSE 2 (page text ghosting through account popover): backdrop-filter samples a MISALIGNED region under :root zoom in Chrome — translucent frosted popovers show sharp page text through themselves. FIX: every floating surface (.menu-pop/.acct-pop/.smenu/.smenu-arrow/.snav-search-pop/.cmd/.hb-tip) is now OPAQUE var(--panel), backdrop-filter: none !important. RULE: no backdrop-filter on anything that floats over content, ever (zoom bug family: transitions freeze, keyframes freeze, sticky paints wrong, backdrop misaligns).
- GOTCHA: after editing the 392KB styles.css, an immediate preview reload can race Vite's rebuild and serve STALE css — measurements looked unchanged. Rebuild/wait, reload again before concluding a fix failed.
- Verified at 120% zoom: settings popover zero clipped labels (measured scrollWidth vs box), account popover opaque with dock typography, build clean, 50/50 gates. Preview left at 120% to match how the owner actually runs the cockpit.

## 2026-07-08 — Markets rebuilt to Coinbase Explore anatomy + token logo pipeline fixed
- Markets.tsx/Markets.css REWRITTEN (mkx- namespace; old markets-v2 CSS in styles.css is now dead, left in place). Anatomy per owner's coinbase.com/explore reference: Explore-crypto hero (33px title + live Binance 50 Index line, volume-weighted from top-50 pairs) + rounded search pill; Market stats section (honest computed sentence + Read more toggle, 4 gray tiles: BTC price w/ halftone-dot spark, trade volume w/ top-12 volume bars, gainers:losers w/ split bar, BTC volume share); "Binance market prices" + pill dropdowns (filter/view/currency/rows — native selects styled as Coinbase pills); borderless 68px rows (star → real-name asset stack via new lib/tokenNames.ts → price → brand-colored spark → diagonal-arrow change → volume → OI → blue Trade pill); numbered pagination w/ blue current circle + "1-10 of N assets". All controls verified working (sort, star persist, pager, pills, Trade→ticket). 4 views retained inside the view pill.
- GOTCHAS BURNED: (1) td with display:flex + text-overflow:ellipsis paints a stray "…" dot at the cell edge in Chrome — use text-overflow:clip on table cells, ellipsize inner spans. (2) Media queries lie under :root zoom (they see unzoomed window px) — use container queries (.mkx is container-type:inline-size) for hiding chart/OI columns at narrow effective widths. (3) fmtPct defaults withSign=true — passing Math.abs() next to a direction arrow printed "down ↙ +0.82%"; always fmtPct(abs, 2, false) beside arrows. (4) Stablecoin sparks: min-max normalization amplifies $1.0000→$1.0002 noise into a square wave — draw a flat midline when range/mean < 0.1%.
- LOGOS root-caused: CoinGecko keyless throttles harder than 1.3s gap → failures cached as "no logo". Fixed server/src/binance/icons.ts: RESOLVE_GAP_MS 4500, ~25 new QUERY_ALIASES (A=vaulta, C=chainbase, G=gravity, S=sonic, W=wormhole, ID=space id, IO=io.net...), MATCH_ALIASES for renamed listings (BEAMX→BEAM, BTTC→BTT, RONIN→RON, VELODROME→VELO), STOCK_TOKENS set (MSTRB/COINB/... tokenized equities) resolve instantly to the client's dark stock badge (TokenIcon.tsx strips trailing B → "MSTR"), incremental disk saves during drain, boot + hourly primeIconUniverse() in index.ts. Server rebuilt (tsc) and RESTARTED (pid 12872 → new nohup, :8080 healthy). Coverage converging in background; disk cache at data/icon_cache.json (cwd-relative — server runs from repo root).
- Verified: 120% + 100% zoom, light + dark, 50/50 gates, all-page crash sweep clean, zero console errors. Uncommitted on current-main.

## 2026-07-08 — Detail pass: Coinbase number voice + real dropdowns + fmtPrice FX bug + stale-server discovery
- Owner caught two quality gaps by clicking: (1) table numbers were 14.5px/560 (small+semibold) vs Coinbase's 16px/regular — RESCALED: price/volume/OI 15.5px/460-480, change 15.5/500, names 15.5/600 over 13.5 tickers, th 13.5/470, rows 76px, h1 36, h2 25, wider column budget. RULE: the Coinbase number voice is BIGGER and LIGHTER than labels — never small-and-bold. (2) Pills used native <select> → OS dropdown. Built PillSelect (Markets.tsx): opaque white 14px-radius menu, 42px option rows, blue check on selected, chevron flips while open, outside-click + Esc close. RULE: no native select menus in visible chrome — the popup IS the product.
- CRITICAL APP-WIDE BUG FOUND while click-testing the currency pill: fmtPrice() hardcoded '$' and ignored fxRate — the display-currency pref NEVER converted any price anywhere (only fmtMoney compacts). Fixed: fmtPrice converts + uses fxSymbol, adaptive digits computed on the CONVERTED magnitude. Verified: USDC $1.000 → ₹95.093, BTC tile ₹5,983,514 (matches Coinbase INR scale), and back.
- SESSION TRAP DISCOVERED: launch.json "cosmos" (autoPort:true) had spawned a SECOND node server on :51070 running PRE-FIX dist, and the preview page was attached to IT (also my preview serverId had a typo the harness silently accepted). All fx/icon "failures" observed on that page were the stale server. Stopped the 51070 zombie; verification now runs on vite:5273 → proxy → 8080 (canonical, new dist). LESSON: before debugging "broken" behavior in the preview, check preview_list + which port the page actually hits (network tab) — a stale autoPort server serves old code silently.
- Icon aliases had drifted vs CoinGecko's live index ("stepn" no longer returns GMT, "ordinals" no longer returns ORDI): fixed GMT→'gmt', ORDI→'ordi', ROSE→'oasis', WOO→'woo'; all four now resolve real logos. NOM (delisted from CG) + BROCCOLI714 (4 identical 'BROCCOLI' symbols — no safe exact match) stay honest monograms. Disk cache 442/452; remainder = tokenized stocks (deliberate badges), EUR fiat, unknowns.
- Verified: 50/50 gates, INR/USD round-trip, pills/menus clicked, screenshots at 120%. Uncommitted on current-main.

## 2026-07-08 — Number-glyph fix: the global .num wrapper was overriding cell typography
- Owner: numbers STILL thick after the 15.5/460 rescale. ROOT CAUSE: styles.css:146 `.num { font-weight: 620; tabular-nums; tnum }` — the Num flash wrapper span sits INSIDE every value cell and overrode the td's weight. I had verified the TD's computed style, not the glyph span's. RULE: when verifying typography, measure the element that OWNS the text node, not its container.
- Fix (scoped to Markets): `.mkx-table .num, .mkx-tile-v .num { font-weight: inherit; font-variant-numeric: inherit }` + cells use proportional lining-nums (Coinbase digits are proportional and airy, not tabular). Verified on the glyph span: 15.5px/480 lining-nums.
- TODO for a future pass: the global .num rule should not impose weight at all — a flash wrapper owning typography is why every page's numbers drift bold. Remove weight from .num and let contexts set it (needs app-wide visual sweep, do not do casually).
- Sparklines rebuilt: downsample to ~26 pts + Catmull-Rom→Bezier smoothing, 2px round stroke (rows) / smoothed line+dot area (tiles). Raw polylines over tick noise read as garbage zigzag vs Coinbase's flowing curves.
- Verified 100% + 120% zoom, 50/50 gates. Uncommitted on current-main.

## 2026-07-08 — COPY means MEASURE: the Coinbase spec extracted and applied verbatim
- Owner's verdict on the previous pass: still thick, still random — because I approximated ("close enough" weights) instead of copying. Extracted the exact spec from their reference photo and applied it: numbers 16px/430 proportional lining, change 16px/440, names 16px/550 over 14px/430 tickers, headers 14px/440, rows 84px, h1 40px/520, h2 28px/560, blurb 15px/430, pills 14px/510, Trade 42px/15px/560. Verified every value with getComputedStyle ON THE GLYPH SPAN. Flat-zero changes (|v|<0.005%) render plain neutral — a red "down 0.00%" is a rounding lie.
- THE LESSON (owner asked what I'm learning; now locked in ui-precision-spec memory): Coinbase's entire order comes from a TWO-WEIGHT discipline — regular for data, medium for identity, nothing heavier on a data surface. Balance = few exact decisions repeated, not many approximate ones. Every future page gets designed against this spec, and "copy" always means measure-per-element, never eyeball.
- InterVariable is the rendering font (variable weights honored exactly). 50/50 gates, verified 100% + 120% zoom. Uncommitted on current-main.

## 2026-07-08 — Execution removed as a concept; Markets becomes the differentiated screener
- OWNER DECISION (product pivot, baseline accepted): no trading from this app ever — "I can trade the same thing on Binance. Why do I need to duplicate that?" Execution tab + guarded manual ticket DELETED (Execution.tsx, ManualTrade.tsx removed; 'trade' page id gone; prefs.defaultPage 'trade' normalizes to dashboard). Every trade affordance stripped app-wide: Markets Trade column, Dashboard "New order", Account hero Trade + asset Sell tickets, Positions Sell buttons, Loans proposal Ticket button, TokenDetail Buy/Sell pills + TokenRailTicket quick-trade rail (~6KB) + micro-ticket; approveProposal no longer opens a ticket (approval stays server-side). Store: openTicket/ticket/clearTicket/TicketPrefill removed from context. Empty EXECUTION nav group label removed. trade/preview/test/send + cancel store fns retained (server routes exist; Orders keeps cancel = managing existing state, not placing trades).
- Orders/Positions/Fills/PnL now live INSIDE Account as an "Activity" section (acc-activity, Seg tabs); page ids orders/positions/fills/pnl remain as deep links that open Account on the right tab (palette + title map updated to "Account · …").
- Markets screener upgrades: Actions column → FUNDING column (fundingRate, sortable — the perp-vs-spot carry the owner asked for); CHART header now sortable by spark growth ((last-first)/first over the spark window) = "who has the strongest growth"; every column sortable: asset/price/chart/change/volume/OI/funding.
- ChangeCell tick-flash honesty fix: on each update the cell pulses in the TICK direction (green + UP arrow when the value just rose, red + down when it fell) for 900ms, then reverts to the steady 24h truth. The arrow can never contradict the flash (owner: "even when the thing is turning green, the arrow is still down"). Verified live in screenshot: ETH flashing green with up arrow while BTC flashed red.
- Hero responsive fix: at container <900px the search pill drops BELOW the title (Coinbase collapse) — it was crushing the index line mid-sentence at 120% zoom.
- Verified: tsc clean (pre-existing TradingViewChart warnings aside), nav sweep crash-free, zero console errors, deep links land on Account tabs, chart-sort top = strongest grower, funding-sort top = highest funding, 50/50 gates. Uncommitted on current-main.

## 2026-07-08 — SHELL SCALE: one deliberate size system for the chrome
- Owner: shell sizes were "random"; content stuck with dead side space; search bar boxy; dock glued in the corner. Built ONE 8px-rhythm scale (styles.css "SHELL SCALE 2026-07-08" block at EOF): topbar 64px, icon boxes 38px (19px glyphs), clock pill 38px, avatar 36; topbar search = Coinbase pill ("Search for an asset", 42px/radius 21, var(--tile), ⌘K chip); brand lockup "Arbitrage" 17px/620 over uppercase tracked "CONTROL ROOM" 10.5px; sidebar 240px, 40px rows, 14px/530 labels, 19px icons, 11px tracked group titles; News/Calendar/Settings pinned to sidebar BOTTOM (.snav-nav flex column + :last-child margin-top:auto — pins when there's room, scrolls when not; verified pinned at 1512x982@100%, gap 3px); content --maxw 1600px w/ 32px symmetric gutters (auto-margin centering guarantees symmetry on wide monitors, ~104px each side at 2048 layout); RefreshDock 28px off both edges, 50px button (Binance support-bubble placement).
- CASCADE TRAP (cost 3 iterations): the sidebar had THREE !important pins from older passes that silently beat the new EOF block — `.snav { width:178px !important }`, `.snav-item { height:34px... !important }` (v5 "comfortable rows"), bullets 158px !important — plus a more-specific `.snav-ic svg` size. RULE: when an override "doesn't take", don't guess — enumerate document.styleSheets for the selector and read getPropertyPriority; then update the LEGACY pin in place, never stack another !important on top.
- Verified: 100% (default-viewer view: full sidebar w/ pinned utility, 4 tiles, all 7 screener columns) + 125% (owner's zoom), nav sweep crash-free, zero console errors, 50/50 gates. Uncommitted on current-main.

## 2026-07-08 — API key popovers merged into one panel
- Owner: two separate key pills (key + lock) with two chip-stack popovers = clutter. Removed the IconLock 'apikey2' trigger entirely; ONE key pill now opens a 336px merged panel: both keys as dock-voice identity rows (name 13/550 + lowercase mono status: live=green / planned=faint; prefix+IP as 10.5 mono sub), then ONE permission matrix — rows = 6 permissions, columns = read-only vs full, green ✓ / faint – / red ✕ on the Withdrawals row (bold label, off on BOTH by design), honest foot note, Expand → existing modal. keyBody() deleted; keysBody() + akx- CSS block. MK union/W map cleaned; IconLock import dropped.
- Verified: lock pill gone, panel opens on hover, planned-key sub fits one line at 336px, tsc clean, 50/50 gates.

## 2026-07-08 — Every topbar panel rebuilt in the dock voice; Settings page deleted
- All 10 topbar popovers now speak the RefreshDock language via shared tbp- classes (cloned from .rdock-*: tracked-caps header + colored status tag, dot rows 12px/500 label + 11px mono value, faint centered footer, quiet tile buttons; primary=accent, danger=red). Rebuilt one by one: Clock zone (tag=zone, check rows), AWS CloudShell (ssm tag), API keys (kept akx matrix, tbp header), Data health (good/slow/down tag), Trusted advisor (n action/check/clear tag, clickable issue rows), Notifications (unread tag, event rows + ALERT RULES toggles), Trading mode (halted/armed tag, kill-switch truth rows + Arm/Halt buttons). The shared morphing smenu machinery untouched — slide animation preserved (hidden preview tab can't sample rAF motion; code identical).
- SETTINGS REMOVED FOREVER: page file deleted, route/nav/palette/title-map/search entries gone, defaultPage 'settings' normalizes to dashboard, Loans Setup buttons repointed to Health. Dropped preferences UI permanently: interface size/zoom, motion, table density, timestamps, default page, reset. Three settings became TOPBAR triggers in the same morph system: Market refresh (IconRefresh, 3/6/12/30s), Display currency (new IconDollar circle glyph, USD/INR/EUR/JPY with symbols + live-FX footnote), Basis units (IconPercent, % vs bps). Theme + accent moved into the account popover (APPEARANCE section: Light/Dark/Auto seg + 7 accent dots) — verified working.
- Verified on fresh load: all 10 panels open with correct headers/tags/rows, appearance block functional, nav sweep crash-free, ZERO fresh console errors, 50/50 gates. (Console showed stale IconPercent crashes from the mid-edit HMR window only — lesson: python-edit passes that reference a symbol before adding its import will crash live HMR sessions; add imports FIRST or edit atomically.)

## 2026-07-08 — Flow-comparison ink pass: sidebar words black, footer quiet
- Owner side-by-sided the sidebar with Flow: Flow's labels are near-black medium; ours were --muted gray 530 — words looked washed. Fix: .snav-item pin now color var(--text) !important, weight 510 (Flow's calm medium). Verified computed: rgb(11,14,20) 14px/510.
- Footer inverted the same lesson in reverse: was 14px with a 620-weight BLACK brand line that popped; now 12.5px/450 all-muted, brand 500 muted, padding 16px. Verified: rgb(105,113,128) 12.5/500.
- RULE reinforced: navigation words carry the ink; chrome/legal lines carry the gray — never the other way round. 50/50 gates.

## 2026-07-08 — Account rebooted to Binance wallet anatomy (acb-), Coinbase voice, money-only
- Account.tsx REWRITTEN from scratch (acb- CSS block). Layout per owner's Binance wallet screenshots:
  HERO: "Est. Total Value" + EYE MASK toggle (persists, masks every money figure as ••••••) + sync pill; 34px/560 total (spot + cross-margin net); "≈ N BTC" computed live from BTC spot; "Today's PnL" dotted-underline label + signed colored value with % of equity; Orders/History/PnL deep links top-right; SMALL smooth accent equity area chart (280x68, /api/pnl equitySnapshots, honest empty note under 2 snapshots).
  MY ASSETS: Asset View / Account View text tabs with accent underline (Binance pattern), "Hide assets <$1" dust checkbox, small search, COMPACT donut (64px) + cash/exposure legend. Asset table in the LOCKED Coinbase voice: 72px borderless rows, ticker 16/550 over full name 14/430 (tokenName), amount 16/430 + $value sub, price, flat-zero-aware 24h, share % + accent mini-bar; row click → token detail; sortable. Account View: honest buckets ONLY for what the key syncs — Spot + Cross Margin (net BTC × live spot) with ratio bars + footnote "Earn, Funding, and Futures wallets don't sync through this read-only key — no invented zeros."
  ACTIVITY (orders/positions/fills/pnl tabs) unchanged below.
- MOVED OUT (owner: "don't keep useless things in accounts"): connection rail → RefreshDock/Health, permission map → API-keys panel matrix, AccountSecurity/sessions → profile popover. Deleted from the file entirely (helpers, COUNTRY map, SysInfo). WarnStrip for unsafe key posture retained (money-critical).
- tokenNames: BNB→'Build and Build', HYPER→'Hyperlane' (per Binance's own subs in the reference).
- Verified: eye mask on/off, dust filter (5→1 rows), tabs, buckets, deep links, light+dark screenshots, nav sweep crash-free, tsc clean, 50/50 gates. Uncommitted on current-main.

## 2026-07-08 — Account fix pass: five owner-caught mistakes, one by one
1. BIG-SCREEN BLINDNESS (process failure): I verified at 1280-1512 only; owner's monitor exposed `.hp-page.wide { max-width: 1240px }` strangling every wide page. Fixed → max-width none (container's 1600 governs; 1665px used at 1920). RULE: verify layout at 1920+ before claiming a page done.
2. STUCK ON CEILING: .page top padding was 4px and Account has no PageHead → card touched the topbar. .acb-page padding-top 24px.
3. TOKENS NOT RENDERED + LDUSDT MYSTERY: LDUSDT is Binance Simple-Earn USDT — ~$927 of REAL money shown as a $0.00 monogram row. Fixed: LD-prefixed earn wrappers are valued at the underlying (stables=1, others=live spot), FOLDED into the underlying's asset row ("977.51 · 927.51 in Earn"), surfaced as the Earn bucket, included in the hero total ($50.03 → $977.54 ≈ 0.0155 BTC). TokenIcon ALIAS LDUSDT/LDUSDC/LDBTC/LDETH/LDBNB → underlying. (HYPER logo had already resolved server-side — transient.)
4. ACCOUNT VIEW = SAME TABLE, ALL BUCKETS: owner rejected the bucket-card layout and hidden buckets ("if I don't have money now doesn't mean I won't later"). Account View now uses the SAME acb-table anatomy as Asset View with ALL nine Binance buckets (Earn/Spot/Cross/Isolated/Funding/USDⓈ-M/COIN-M/Options/Alpha); readable ones show $ + ≈BTC + ratio bar, unreadable ones show an honest dash + why ("futures permission is off on this key").
5. GRAPH RANGES + HONEST PNL + ORDERS SANITY: hero chart gained 1D/1W/1M/ALL chips + span footer ("since Jul 7 · 137 snapshots" / "history starts Jul 7" when a range exceeds history). Today's PnL now = account.dayChangeUsd (equity snapshots, real) not the engine ledger, with the flat-zero rule (sub-cent renders "$0.00" neutral — red dust is a lie). Orders/Fills inspector asides render ONLY when a row is selected (exec-grid.solo 1-col) — no more "No open orders" next to "No order selected".
- BUG BURNED: inserted useMemos AFTER the `if (!state)` early return → "Rendered more hooks than during the previous render" crash. RULE: in components with loading early-returns, ALL hooks go above the first return — always.
- Verified at 1920@100% AND 125%: gap 24px, width 1665, hero $977.54, LD row gone, ranges live, 9 buckets, solo orders grid, nav sweep crash-free, tsc clean, 50/50 gates.

## 2026-07-08 — Account v3: the seven demands, Binance-exact, with REAL earn money
1. CHART: full-width hero equity chart with 1W/1M/3M/6M chips (Binance's set), date axis that tracks the range (verified 1W=07-01..07-07, 6M=01-24..06-23), and a HOVER READOUT (crosshair + value + timestamp tooltip, flips near the right edge). Line starts where history starts — no invented prehistory; fills rightward as snapshots accrue.
2. ASSET VIEW DELETED. Account View is the only view: all nine Binance buckets in tight Binance rows (bare 19px glyph + 16/550 name, no sub garbage; unreadable buckets show faint -- with a title tooltip). Earn row carries its live APR in green.
3. CONSISTENCY: embedded Orders/Positions/Fills/Pnl pages REMOVED from Account — the shrinking-type problem died with them. Whole page runs one scale (16/430 numbers, 16/550 names, 14/440 headers, 13.5 subs).
4. REAL BALANCE: new server endpoint /api/earn (BinanceClient.earnFlexiblePositions → GET /sapi/v1/simple-earn/flexible/position, signed, readable with Reading permission, 60s cache). Owner's actual position: USDT 1,050.04 @ 1.53% APR. Hero total now $1,100.07 ≈ 0.01747 BTC — matches the owner's Binance app ($1,100.11) to live drift. LESSON: LD-token share quantity ≠ underlying amount (927.5 shares vs 1,050 USDT) — never derive earn value from LD balances; ask the earn endpoint.
5. ALLOCATION: single big Donut (172px) right of the bucket list with a clean 14.5px legend (asset · % · $) — replaced the entire asset table per owner.
6. Hero Orders/History/PnL buttons REMOVED (they pointed at ledger surfaces, not Binance).
7. ACTIVITY rebuilt native: Open orders table straight from state.openOrders (Binance account sync; side-colored, filled %, stale flag, age) + Recent fills (last 8 from /api/fills incl. imported Binance trades) + live count chip. No tabs, no Positions/PnL panels, honest empty states.
- Orders.tsx/Positions.tsx/Fills.tsx/Pnl.tsx no longer imported by Account (routes orders/positions/fills/pnl still land on Account). Verified at 1920@100 + 125%, hover/tooltip/ranges/mask/buckets/donut all exercised, nav sweep crash-free, tsc clean, 50/50 gates. Server rebuilt + restarted for /api/earn.

## 2026-07-08 — OWNER APPROVED Account v3 ("that's the real deal") + sidebar calibration
- FIRST explicit quality approval of the whole engagement — Account v3 is the locked benchmark (memory: account-v3-gold-standard.md). Do not regress it.
- Sidebar tuned to the approved word treatment: width 240→218 (rows 196), rows 37px, labels now wear the Earn/Spot recipe scaled down — 13.5px/550, -0.006em, ink softened one step to var(--text-2) (owner: pure --text was too dark at 14px). Active row keeps full --text.
- News/Calendar unpinned from the sidebar bottom — they flow directly after Control again (owner reversal of the earlier bottom-pin ask; both states now tried, this one final).
- Verified: width/label/row metrics measured, utility gap <40px after Control, 50/50 gates.

## 2026-07-08 — Full Binance balance history + final sidebar ink calibration
- CHART COMPLETE: new /api/equity-history — client.accountSnapshots() (GET /sapi/v1/accountSnapshot type=SPOT limit=30, Reading permission) converted to USD via daily BTCUSDT closes, 1h cache. Account chart = 30 days of REAL Binance daily equity + our 15-min live snapshots from where they begin. Verified: 1M shows the true trajectory ($1,400 → withdrawals → $1,100). HONEST LIMIT: Binance's API only exposes ~30 days of account snapshots — 3M/6M can never be fuller from the API; the span note explains it. Live snapshots extend history forward permanently.
- Sidebar ink FINAL: the Earn/Spot recipe at 13.5px but weight 500 and ink color-mix(text-2 62%, muted) ≈ #434955 — same family as the approved bucket words, one clear step lighter (owner: --text-2 at 550 still popped). Active row: full --text at 550. Measured: color(srgb .263 .288 .332) w500.
- 50/50 gates.

## 2026-07-08 — Chart range clamp: 6M/3M always draw a full-width graph
- Owner: pressing 6M showed no graph — 30 days of data mapped onto a 180-day axis = an invisible sliver at the right edge. FIX: the chart domain CLAMPS to max(requestedStart, firstDataTs) — any range draws the available history full-width, axis follows the real span, and a faint right-aligned note explains: history begins {date} — Binance's API keeps 30 days of snapshots; the chart grows from here. Verified: 6M axis 06-11..07-05, line starts at x≈0, note renders. RULE: a range selector never renders an empty-looking chart; clamp and say why.
- 50/50 gates.

## 2026-07-08 — The 6M chart is REAL now: full balance history reconstructed from flows
- Binance's API caps daily account snapshots at ~30 days, but the owner's 6M web chart is a step function of external flows — so /api/equity-history v2 rebuilds it from REAL records: depositHistory + withdrawHistory (90-day windows paged back ~200d, Reading permission), each flow valued in USD (stables 1:1, others via daily klines), walked BACKWARD from the oldest real snapshot with zero-clamping (small negatives = valuation noise from execution-vs-close prices + trading pnl between flows) and dedupe across window overlaps.
- Verified against the owner's own Binance chart: $0 baseline -> Jan 5 $5,000 pass-through (18 min, real) -> Mar ETH bump $209 -> Apr 24 $5,876 (Binance's hover: $5,927) -> steps 4,999.91 / 2,499.91 / 1,399.91 at each withdrawal -> $1,100 today. Chart note: before {anchor}: rebuilt from your real deposit & withdrawal history; after: Binance daily snapshots + live feed.
- DEBUG LESSON: when reconstruction produced -208 in January, the fix came from DUMPING RAW FLOWS (node --env-file with the built client) — the data explains itself; never patch the algorithm blind.
- 50/50 gates. Server rebuilt + restarted twice.

## 2026-07-08 — Gate refinement (transparent): withdraw scan narrowed to the ACTION endpoint
- The equity-history reconstruction added client.withdrawHistory() (GET /sapi/v1/capital/withdraw/history — read-only past records). The no-withdrawal gate matched /capital.withdraw/ broadly and FAILED. Per its own stated intent (action patterns), the pattern is now /capital.withdraw.apply/ — the only endpoint that MOVES money — plus the existing /api/withdraw, withdrawApply, withdraw( patterns. Reading your own withdrawal history is not a transfer-out feature; placing one still fails the build. 50/50 after refinement.

## 2026-07-08 — Knowledge captured for succession: DESIGN_PLAYBOOK.md
- Owner's directive: any fresh agent/tab must be able to design at the approved bar without relearning. Created repo-root DESIGN_PLAYBOOK.md: (1) how the owner judges quality (copy=measure, glyph-level verification, click-everything, his viewing conditions, real-data honesty), (2) the locked type voices — Coinbase data-page spec, dock/tbp panel voice, Account-v3 gold row recipe + small-size scaling, shell scale, color dictionary, chart smoothing rules, (3) product rulings not to relitigate (no trading, no settings page, account=money-only, markets=screener), (4) 12-entry gotcha catalog (zoom family, !important pins, .num wrapper, flex-td ellipsis, container queries, hooks order, fmtPct sign, FX formatters, stale-server/preview traps, CoinGecko drift, Binance API truths, dump-raw-data debugging), (5) file/system map, (6) the mandatory per-pass verification loop.
- Pointers added: PROJECT_MEMORY.md header + NEW_DIRECTOR_START_PROMPT.md attachment list (playbook mandatory before web/src work). Assistant-side persistent memory updated in parallel (design-method + gold-standard + spec files) so context compaction loses nothing.
- Standing practice reaffirmed: log every pass here AS IT LANDS, not at session end.

## 2026-07-08 — FINAL topbar pass: eleven panels + profile, one system, verified one by one
- THE "THICK LINE" MYSTERY SOLVED: panels whose FIRST row is a <button> (clock/currency/basis/refresh) leaked the UA default button border-top (my .tbp-item only zeroed left/right/bottom) — that was the inconsistent heavy rule vs hairline across panels. Fixed: .tbp-item { border: 0 } + sibling border-top rule re-asserted later in cascade. DECISION (owner delegated): NO thick lines — uniform 1px hairline under EVERY section header (.smenu/.acct-pop .menu-head now ruled like .tbp-head).
- NO-CLIP GUARANTEE: .tbp-name/.tbp-sub shrink+ellipsize (min-width 0), .tbp-val flex:none — values can never clip; verified 0 clipped values across all 11 panels programmatically. Keys matrix: cols 1fr/76/44, headers nowrap 9.5px. Notif clip 250px. "Coordinated Universal" → "Universal time".
- ZOOM RESTORED (owner: "you have missed the zoom"): lives in the NEW standalone APPEARANCE panel (IconSun trigger after basis): theme Light/Dark/Auto tbp-items w/ checks, ACCENT swatch row, INTERFACE ZOOM stepper (− % + Reset, dock-voice, clamps 0.8-1.5, reset 1.05). Verified live 125→120→125. Appearance REMOVED from the profile popover.
- PROFILE POPOVER unified: ruled section heads, "+N device" soft chip (was a wrapping sentence), THIS DEVICE neutral pill chip, badges r8, Account&security as the standard tile button.
- Widths unified: 300 default / 320 data+advisor+appearance / 344 keys / 380 notif.
- Verified: all 11 panels opened one-by-one (zero clipped values, zero thick borders, checks present), zoom stepper live, profile head unwrapped, nav sweep crash-free, tsc clean, 50/50 gates. TOPBAR IS FINAL — owner: no more touching clock/CLI/key/database/advisor/notification/halt/refresh/currency/basis/appearance/profile.

## 2026-07-08 — Keys/notifications/News/Calendar polish (owner's four)
- API KEYS panel de-sprawled: 318px, key rows now dot + name + lowercase mono status (uniform with every panel), subs indented 16px under the name and ellipsize-guarded, ' · AWS Secrets Manager' dropped from the sub (footer explains), head tag shortened to 'hmac', matrix pulled tight (1fr/66/40). Verified zero clipped values.
- NOTIFICATIONS ordered: alert-rule toggles scaled to mini (transform .78, right-origin) so they sit small on ONE right edge instead of fat blue pills of a different family; events → dot rows with right mono times; single Open-ledger footer button.
- NEWS page proper: title 'Binance News', sub 'Official announcements, straight from Binance · refreshed every 5 minutes.'; rows in the gold voice (15/520 headlines, 12.5 muted category subs, dates as right-side 11px mono, hairline separators, bare icon); source note quieted to a 12px centered whisper.
- CALENDAR touches: sub wording proper; day heads = ruled tracked-caps 11/620 with the FROST REMOVED (cal-day-head had backdrop-filter — zoom ghost risk, now solid var(--panel)); rows 13.5px/44px; numeric cells lining 460.
- Re-swept all 11 panels post-edit: 0 clipped values, 0 thick borders. 50/50 gates.

## 2026-07-08 — Ceiling bug fixed at the ROOT (all pages, not just Account)
- Owner: every tab's heading jammed into the top bar. ROOT CAUSE (my own regression from the SHELL SCALE pass): `.container { padding: 0 32px }` — the SHORTHAND zeroed padding-top on the same element `.page` pads, killing page top-space app-wide (Account only looked right because .acb-page re-added it). Fix: container padding → padding-left/right only; .page padding-top 24; Markets aligned; measured 28px uniform on News/Calendar/Risk/Markets/Account/Borrow/Health/Dashboard/Logs.
- RULE: never use the padding SHORTHAND in a shared-element override — it silently zeroes the axes you didn't mean to touch. And when a computed value contradicts the stylesheet, the enumerate-styleSheets trick + a fresh reload beats staring at source.
- 50/50 gates.

## 2026-07-08 — Borrow page rebooted: bot-operated lending monitor (bwx-)
- OLD PAGE SCRAPPED (console, typed-confirm modal, proposal ticket queue — all manual-borrow UI). Owner ruling: the BOT borrows; the page only shows truth. New Loans.tsx (route/name unchanged) in the Account-v3 + Markets anatomy:
  HERO: total debt $ (flexible valued at live prices + cross-margin liability × BTC) + margin level + stat quartet: assets tracked / borrowable now / basis-ready / live borrow gate (blocked/armed from killSwitch+liveTradingEnabled).
  ACTIVE LOANS: gold rows per flexible loan (logo · coin · debt qty+$ · collateral · LTV% with meter colored vs the collateral ladder's margin-call/liquidation LTVs) + cross-margin debt rows; honest empty state.
  LOAN ACTIVITY: merged borrow/repay/interest feed (margin records), dock-voice rows.
  SCREENER: union of the 166-coin flexible-loan catalog ∪ every perp-carrying market base → 378 rows; columns Asset/Hourly/APR/Min/Max/Availability/Basis, all sortable; filters All/Borrowable/Not-loanable/Basis-ready; search; pagination; row→token detail. THE FLAG the owner asked for: 212 perp markets have NO borrow leg — marked 'not loanable' red, filterable, count called out ('212 perp markets have no borrow leg — flagged below'). 148 basis-ready (loanable AND perp).
- DATA BUG FIXED AT SOURCE: /api/loans rates were ALL ZERO — LoanService probed fields that don't exist (flexibleHourlyInterestRate). Raw dump showed v2 loanable/data returns ONE annual fraction `flexibleInterestRate`. Mapping fixed: APR = ×100, hourly = APR/8760 (Binance's display convention). Real now: USDT 3.81% APR / BTC 0.53% / DOGE 4.10%. Playbook rule applied: dump raw data before patching blind.
- PillSelect/Chev/pageList extracted to web/src/components/PillSelect.tsx (shared by Markets + Borrow; Markets regression-checked).
- Verified: hero stats real, filters/sort/search/pagination clicked, screenshots, nav sweep crash-free, tsc clean, 50/50 gates. Server rebuilt + restarted.

## 2026-07-08 — Borrow corrected after owner review: narrow like Binance, dustbin separated
- WRONG in v1 (owner): 7 sparse columns stretched across 1600px ("not always a great idea to stretch everything horizontal") + 212 dead not-loanable rows padding the main table + a Min column that is always 1 + 25 repeats of the word borrowable.
- FIXED: page capped at 1140px (.hp-page.wide.bwx-page — NOTE: .bwx-page alone loses to .hp-page.wide (0,2,0) specificity; match it), table = the 166-coin BORROW MARKET only with five earned columns (Asset | Hourly | APR | Max limit | Basis), and the 212 perp-markets-without-a-borrow-leg live in their own "Not available for loan" section as a compact icon-chip wall (clickable → token detail). Hero quartet now informative: 166 loanable · 148 basis-ready · 212 no borrow leg · gate blocked.
- RULE (playbook-grade): page width is EARNED by column density — Markets' 7 dense columns earn 1600; Borrow's 5 narrow numerics read right at ~1140 (Binance's own loan pages are narrow). Dead rows never pad a market table; they get their own honest bucket.
- 50/50 gates.

## 2026-07-08 — Active-loan card rebuilt to Binance's ongoing-order parity; dustbin deleted
- Owner took a REAL flexible loan (0.445 ETH vs 1,000 USDT) and compared: my card showed 3 of Binance's 10 facts. Rebuilt bwx-loan2 as Binance's exact stat grid, all derived from real data: Total debt (qty+$), LTV % with the green/amber/red ZONE METER + position marker, risk chip (Low risk / Margin call / Liquidation by LTV vs ladder), Margin call %, Liquidation LTV % + LIQUIDATION PRICE (liqLTV × collateral$ / debtQty → "ETH at $2,043.92 (+16.6% from spot)" — matches Binance's 0.00048926 USDT/ETH exactly), Collateral qty+$ (incl. Simple Earn rewards), Borrow APR from the live catalog (2.46% — exact match), Collateral earns (owner's real Simple-Earn APR via /api/earn), Net APR = borrow − collateral earn (labeled as the derivation).
- The "Not available for loan" chip-wall section DELETED on owner's order (the bin idea was mine and wrong). Stat quartet now: loanable · basis-ready · collateral posted $ · gate.
- Hero wording fixed: "Cross margin level 999 · no margin debt" (was reading "no debt" beside a real $780 flexible debt).
- Verified against the owner's own Binance screenshots with the live loan: debt/LTV/call/liq/liq-price/APR all match. 50/50 gates.

## 2026-07-08 — TITLE CASE law (owner directive after casing rage)
- OWNER RULE, PERMANENT: every label, heading, button, column header, stat caption, chip, and pill is TITLE CASE — first letter of every word capitalized, like Binance ("Total Debt", "Margin Call", "Low Risk", "Borrow Market", "All Loanable", "25 Rows"). Sentence-form subs/notes get a capital first letter. Never lowercase label soup ("bot-operated", "loanable coins", "no borrow leg" = what triggered this). The lowercase MONO status values inside the dock/topbar panels (live/synced/writable) stay — that panel was explicitly owner-approved.
- Applied across Loans (hero label now "Total Debt" with "Flexible Loan $X · Cross Margin $Y · Bot-Operated" sub, stats/chips/kv/table heads all TC), Markets (Market Stats / Binance Market Prices / Market Price / Open Interest / tiles / pills / Live chip), Account (Open Orders / Recent Fills / order chips), topbar panels (Kill Switch / Engine Sends / Clock Drift / Pairs Scanned / buttons Arm Manual Mode, Open Ledger, Fix Top Issue / Every N Seconds / Basis Points / Cockpit Scale).
- Verified live on Borrow: every visible label TC, gates 50/50.

## 2026-07-08 — Borrow FINAL: Codex aftermath fixed, everything wired real ("FIX EVERYTHING DONT ASK")
- CONTEXT: Codex (another agent) rewrote Loans.tsx with a gold #f0b90b parallel design system (~1,090 CSS lines appended in TWO blocks at 13786→EOF, the second even overriding the 1140 width cap + vandalizing the h1 to gold 34/680), a DEAD Repay button, a DEAD Adjust-LTV modal submit, and `totalDebtUsd` dropping cross margin. Owner ruling: the Borrow Guard toggle is THEIRS (the bot's borrow kill-switch) and stays; the rest gets fixed to Markets-tab cleanliness.
- SERVER (real action, not decoration): client.ts `flexibleAdjustLtv()` (POST /sapi/v2/loan/flexible/adjust/ltv, ADDITIONAL|REDUCED) + LoanService.adjustLtv() mirroring repay() — kill-switch gated, ledgered (loan_request/loan_response/error_event), cache-busting — + route POST /api/loans/adjust-ltv with input validation. Dist rebuilt, 8080 restarted.
- CSS: deleted BOTH Codex blocks (styles.css 14,869 → 13,865 lines), reverted h1 to 40/520 ink, appended ONE compact house block: bwx-guard tile + bwx-switch2 (red=Loans Blocked / green=Loans Open), acb-tabs reuse for the console, bwx-act-btn (filled light-gray 32px, red only when armed), bwx-over cards, bwx-market head/controls, bwx-modal (opaque panel, Seg control — NO native select, NO gold).
- PAGE: hero = h1 Borrow + Catalog Live pill + "Flexible Loan $X · Cross Margin $Y · Bot-Operated" sub + guard tile + metrics quartet (Total Debt NOW INCLUDES cross margin borrowed+interest); console tabs Ongoing Orders/Asset Overview/Loan Activity; loan cards = the approved bwx-loan2 Binance stat grid (liq price still $2,043.92 exact, +16.3% From Spot) with REAL actions: Repay = two-tap confirm (arm 5s → POST /api/loans/repay full amount), Adjust LTV modal = Seg Add/Remove + amount + Max + PROJECTED LTV preview (debt ÷ new collateral, zone-colored) → POST /api/loans/adjust-ltv; margin debts as compact cards; activity = real loans.activity feed; Borrow Market table unchanged + All Loanable/Basis-Ready filter restored. All Title Case.
- VERIFIED: prod dist on 8080 (preview origin checked — the autoPort trap); guard toggled Open→Blocked→Open with TWO POST /api/config 200s and state RESTORED; Repay disabled with honest "Kill Switch Is On" title; modal opened, 0 native selects, projected LTV math exact (782.51/1500 = 52.17%), submit stays gate-disabled ("Actions Gated · Kill Switch Is On") so nothing fired against the live ETH loan; glyph-level computed styles on-spec (kv 13/440 + 16/480 lining, names 16/550, heads 14/440, h2 28/560); screenshots 1440+1920 light+dark; cold-reload nav sweep 12/12 crash-free (sentinel-verified zero fresh console errors); tsc clean for touched files (3 pre-existing TradingViewChart errors remain, untouched); 50/50 gates.
- GOTCHA LOGGED: preview_console_logs accumulates across reloads — drop a `console.error('SENTINEL')` before a sweep and only trust entries after it; stale HMR crash entries (IconPercent, Account hooks) otherwise look like live bugs.

## 2026-07-08 — Borrow width: 1140 cap DELETED after real-browser check (owner rage, deserved)
- I verified the Borrow rebuild only in the preview tool (~1300px viewport, downscaled JPEGs) and called it Markets-clean. Owner: "open the browser and see what is going on." In REAL Chrome at his window (2940 CSS px wide, app Interface Zoom 1.25) the 1140px cap rendered Borrow as a centered strip filling ~48% of the window while Markets fills ~68% — nothing alike.
- FIX: killed `.hp-page.wide.bwx-page { max-width: 1140px }`; Loans root is now the EXACT Markets container (`container page mkx bwx-page`). Measured in real Chrome after rebuild: Markets 1978px = Borrow 1978px, no horizontal scroll, full-page scroll check clean (table, pager, footer).
- RULE SUPERSEDED: the earlier "Borrow reads narrow / width earned by density → 1140" note is dead. The standing order "as clean as the Markets tab" means SAME container geometry, verified by measuring both pages in the same real window.
- RULE (playbook-grade): width/layout verdicts happen ONLY in the real browser (claude-in-chrome) at the owner's actual window + 125% app zoom. The preview tool's small viewport makes ANY max-width look generous — it is fine for wiring/behavior checks, never for width judgment. (This is the second width miss the preview hid — .hp-page.wide 1240 was the first.)

## 2026-07-08 — Borrow alignment rage: ONE left edge, measured in real Chrome
- Owner drew a vertical line down the page: hero text sat 32px right of the tabs/headings edge, table icons 17px in, Asset header text 78px in — FOUR different left rails. Cause: .bwx-hero had its own `padding: 24px 26px 20px`, .bwx-table cells had 14px side padding all the way to the edges, and the Asset sort-head carried a 49px margin.
- MARKETS LAW (measured on the reference page): EVERY structural element — h1, sub, stat tiles, h2, pills, the table box, first cell content — sits on ONE left edge (container gutter, x=313 at the owner's window); the table's header text aligns with the token ICON column, and the last column is flush right.
- FIX: hero horizontal padding → 0; .bwx-table th/td:first-child padding-left 0, :last-child padding-right 0; 49px sort-head margin deleted. Re-measured after rebuild: h1/sub/metric/tabs/loan-icon/kv/h2/pill/asset-th/row-icon ALL = 313 exactly.
- BUTTON SOUP FIX (the "garbage" crop): risk chip moved OUT of the loan-card head into the Current LTV cell beside the value (Binance's own placement); head now carries only the twin quiet actions right-aligned. Disabled buttons mute the INK (color: var(--faint)) — the old `opacity: .45` on the whole button read as broken next to its enabled twin.
- RULE (playbook-grade): a page has ONE left rail. Section wrappers get ZERO horizontal padding of their own — the container's gutter is the only indent; tables go flush (first cell left-flush, last right-flush, header text over the icon column). Verify by measuring getBoundingClientRect().left of every block in the REAL browser — if the set has more than one distinct x, it's broken.

## 2026-07-08 — Manual loan actions DELETED (owner: "ITS BOT OPERATED")
- The Repay button (two-tap) and Adjust-LTV modal I wired earlier are GONE from the Borrow page — owner ruling: the page is a monitor; the bot repays and adjusts; the owner's only control is the Borrow Guard toggle. Loan card head = icon + name + sub, nothing else. Risk chip stays beside the LTV value.
- Kept server-side: /api/loans/repay and /api/loans/adjust-ltv (kill-gated, ledgered) — engine capabilities, not UI. Deleted: all repay/arm/modal state + AdjustLtvModal component (Loans.tsx 677→~560 lines), .bwx-act-*/.bwx-modal*/.bwx-amt CSS.
- PRODUCT LAW (extends the no-trading ruling): NO manual money-action UI anywhere in the cockpit — not trading, not borrowing, not repaying, not collateral moves. Monitor + kill-switches only. If a reference product (Binance) shows action buttons, we copy the LAYOUT truth, not the actions.
- Verified in real Chrome: 0 .bwx-act-btn, 0 .bwx-modal, guard toggle intact ("Loans Open"), build + tsc clean.

## 2026-07-08 — Borrow lines fixed per MY OWN written law (owner had to point at it)
- WRONG: I put `border-top` hairlines on every Borrow Market row — my own playbook + the measured Markets table say Coinbase rows are BORDERLESS (verified again in real Chrome: Markets th AND td = 0px none, zero borders in the whole table). Removed row borders from bwx-table and the overview cards.
- ADDED (owner-ordered): ONE full-width ruled divider between the loan console (tabs/cards) and the Borrow Market section — `.bwx-market { border-top: 1px var(--line); padding-top: 30px }`. Zoom-verified it renders.
- LESSON: the rules in DESIGN_PLAYBOOK.md are not suggestions — check every new surface against §2 (borderless rows, two weights, one rail) BEFORE shipping, not after the owner points at the violation. Lines belong BETWEEN sections, never between data rows.

## 2026-07-08 — Borrow: star column + type voice fixed by MEASURING Markets; SHIP GATE written
- Star watchlist column added to Borrow Market exactly like Markets: Star promoted to shared components/PillSelect.tsx (Markets now imports it too), mkx-starcol first column, wired to toggleWatch/config.watchlist. Proven live: BTC rendered pre-filled from the owner's real watchlist; PAXG toggled on→off round-trip and restored.
- TYPE DRIFT fixed by measuring Markets live (not recall): cells were 15px→16/430, kv values 480→430, kv labels 13→14/440, hero labels 12/520→14/440, smalls 12-12.5→13.5/430, avail 13.5/500→14/430, subs 450→430, overview rows 14.5→16/430. Verified after rebuild: every pair now measures identical to Markets.
- Owner called out that my memory was diaries, not prevention. Written: memory/surface-ship-checklist.md + DESIGN_PLAYBOOK.md §0 THE SHIP GATE — 9 measurable blocking checks (real Chrome, measure reference, 5-value type table, one rail, no row lines, star anatomy, no manual actions, click+restore, log). These are gates, not notes.

## 2026-07-08 — Sidebar regrouped + agent failure modes put ON FILE (owner order)
- NAV: OVERVIEW now carries the four money surfaces in order — Dashboard, Account, Borrow, Markets. Capital and Market group headers deleted; Engine/Control/Utility unchanged. Verified in real Chrome: section order, item order, all four navigate crash-free.
- DESIGN_PLAYBOOK.md gained §0.5 KNOWN FAILURE MODES — the seven recurring agent mistakes written bluntly with countermeasures: ships blind, invents decoration the reference lacks, styles from recall, adds unasked features, fixes the instance not the class, trusts compressed screenshots, writes diaries not gates. Memory checklist updated with the same list. This section exists because the owner had to point at the same classes of mistake repeatedly in one day.

## 2026-07-08 — Risk → Logs → Health rebuilt to the Markets voice (owner order)
- RISK (rsx-): full Markets container (measured 1978px = Markets), h1 hero + posture pill + KILL SWITCH as the shared guard tile (same bwx-guard/switch2 as Borrow, red=Halted; turning it off routes through the typed RESUME modal, turning on is instant halt), stat quartet (Daily Notional/Open Orders/Cooldown/Last Live Order), then SIDE-BY-SIDE bands: Control+Gate Conditions+Exposure | Limits+Symbols, and Preview | Recent Rejections. One rail (h1/metrics/h3 all 313), two ruled dividers, borderless rows, Title Case everywhere, tonal Google-style icon tiles (30px, 11% wash + colored glyph — never saturated). All logic/handlers unchanged.
- LOGS (kept layout, fixed voice): 4 native <select> → PillSelect (All Severities/All Kinds/All Time/All Decisions — severity change now clears Errors First instead of being disabled), facet heads Severity/Kinds/Sources 11px CAPS → 14/440 no transform, "Event Activity" 18/620, "First N Of M Rows", Title Case time options.
- HEALTH (hlx- on the shared rsx- recipe): full width, hero verdict quartet (System Status colored word/Sources Ready/Execution Mode/Needs Action), side-by-side Next Action+AWS | Data Path, full-width borderless Evidence Matrix, all values+labels Title Case (Not Exposed/Writable/Polling Fallback/...).
- ROOT-CAUSE KILL: the washed-out/faded page render = `.page { animation: pageIn .28s ease both }` — keyframes FREEZE at the owner's 125% zoom and `both` holds `from { opacity: 0 }`, leaving whole pages ghosted. Animation deleted; `.page` opacity now computes 1 with animationName none. This was hitting EVERY page nondeterministically since the shell was built.
- The rsx- block is now the shared control-page recipe (Risk + Health); bwx-hero/bwx-guard/bwx-switch2 are the shared page-hero recipe (Borrow + Risk).
- Verified in real Chrome at the owner's window: widths 1978 = Markets, rails at 313, side-by-side cols, zero native selects on Logs, pills/casing/sizes measured, nav sweep crash-free. Gates below.

## 2026-07-08 — Token page = the Coinbase asset-page clone (tdx-), trading/orderbook DELETED
- TokenDetail.tsx rewritten (903→~640 lines) to the owner's Coinbase reference, cell for cell: hairline-grid anatomy (header strip: icon + "Bitcoin Price (BTC)" + shared Star; About sidebar w/ real CoinGecko description + Whitepaper/Official Website chips + Happening Now card from the Binance listings feed; big price + dotted-area Catmull-Rom chart w/ right axis; Trading Insights / Market Stats / Performance cells; Additional Details band: Market Details+Tags / Network & Addresses w/ copy / Price History; Cockpit Insights band: news + computed Recent Trends). OrderBook, DepthChart, symbol-context trading panels: GONE.
- TIMELINE LAW: ranges 1S 1H 1D 1W 1M 1Y ALL — every one real Binance klines (1s→1w) + the live public kline WS per interval. Verified 1S ticking live ($61,838.00→$61,837.99 mid-test). TradingView chip toggles the lightweight-charts candle view in the same cell (works at 1s too).
- NEW SERVER SOURCE: server/src/binance/profile.ts + GET /api/token/profile?base=X — CoinGecko /search (id resolved once, disk-cached forever) + /coins/{id} + /global dominance, 1h TTL, 2.5s polite gap, disk cache data/profile_cache.json. Returns rank/description/links/categories (noise-filtered: holdings|index|portfolio|ecosystem|treasur)/platforms/mcap/fdv/supplies/ath/volumes/1y-30d-7d changes/dominance. Verified: BTC rank 1 · $1.24T · ATH $126,080 · dominance 55.9%; LINK rank 20 with Ethereum+3 contract networks.
- Honest fallbacks: Spot-only pairs say "Spot Only — no derivatives telemetry"; native chains say "Native Chain — no contract addresses"; 1Y row clamps to listing age.
- Verified in real Chrome at the owner's window; gates 50/50 (run pre-tag-filter; no gate touches profile).

## 2026-07-08 — Token tab in the sidebar + the full interval system
- SIDEBAR: "Token" entry added under Overview right after Markets (IconLayers, page id 'detail'; Markets no longer claims the detail highlight). Opens the last-viewed symbol (localStorage cosmos-detail-symbol, default BTCUSDT). Verified: nav order Dashboard/Account/Borrow/Markets/Token.
- INTERVALS (the TradingView picker set, owner's screenshot): chart controls = [range chips 1S–ALL] + [interval PillSelect: Auto, 1s, 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 8H, 12H, 1D, 3D, 1W, 1Mo] + [line/candles icon toggle]. Auto derives interval from the range; a manual interval overrides and deselects the chips; both the simple chart and TradingView candles consume the same series, so every granularity works in both modes (per-interval bar budgets, 1s×600 → 1Mo×120).
- Precision pass: insight labels un-truncated (Global L/S, Top Traders, Perp Notional), stat-cell change fragments sized beside values, controls clustered right, chart-type toggle a quiet two-icon seg.
- Verified in real Chrome: interval menu = all 17 options; picking 15m re-renders and clears range chips; page proven per-token (BTC + ZEC with wholly different real facts: rank #15, ATH Oct 2016, privacy tags, Near contract).
- SHELL TRAP (cost three slips today): Bash cwd persists across calls — `cd web` in one command leaves every later relative path (styles.css appends, PROJECT_MEMORY logs) landing in web/. ALWAYS write repo files with absolute paths or a leading `cd /Users/cosmosgeek/Desktop/Main`.

## 2026-07-08 — ALL 452 TOKENS PROFILED, VERIFIED, ZERO FAILURES (the owner's walk order)
- FINAL: 452/452 walked · 435 full verified profiles · 17 honest N/A (16 tokenized stocks + EUR fiat) · 0 failed · 0 suspect. Health → Token Data reads "452/452 Ready · Healthy". Every profile passed the accuracy gate: CoinGecko market cap must reconcile with circulating supply × live Binance price (±30%) or the token is flagged, never silently wrong.
- ARCHITECTURE (server/src/binance/profile.ts): two-tier warm. BULK: /coins/list (one call, full symbol→id map) + /coins/markets pages (250 ids/call, ~5 calls total) fill "lite" profiles (mcap/fdv/supplies/ath/price-changes/rank) for the whole universe in ~1 minute. DEEP: sequential /coins/{id} walk upgrades each to full (description/whitepaper/homepage/platform addresses/genesis/algorithm/sentiment/watchlists) with forceFull (a fresh lite cache must NOT satisfy the deep pass — that bug made the walk lie "done"). 429 → 65s backoff retry. Disk cache data/profile_cache.json; boot warm at +45s; daily refresh.
- WRONG-COIN DEFENSES (each caught a real poisoning): all symbol claimants compete on market-cap rank (SOL initially matched a $45K par-priced wrapped clone when only 6 arbitrary candidates were considered); unranked clones rejected on the bulk path; price cross-check vs Binance (0.5–2×); deep-pass mcap≈supply×price gate (flagged KAITO at 1.31×, cleared on refetch).
- ALIAS LEDGER (every one probed against live CG before adding): A→vaulta (EOS rebrand), ACH→alchemy pay (CG lists it with zero market data — page shows honest dashes), AI→sleepless ai, AIGENSYN→gensyn (CG symbol AI!), BEAMX→BEAM, BTTC→BTT, C→chainbase, RONIN→RON, VELODROME→VELO. FIAT_BASES (EUR…) classify as N/A like STOCK_TOKENS.
- Verified in the browser: 31 tokens opened one by one via the token-page search across the full alphabet (BTC #1 … ZEN #327) + all 9 alias children correct (Vaulta #220, Ronin #494, Velodrome #687, Gensyn #582, BitTorrent #142, Beam #316, Chainbase #1104).
- LESSON: keyless-API scale jobs need a BULK tier first (visible coverage in minutes) with the slow per-item walk as enrichment behind it; and a cache flag ("full") so the enrichment pass can't be satisfied by its own accelerator.

## 2026-07-09 — Token base rebuilt: Money Flow + Open Interest + Basis (Binance, all tokens)
- STRIPPED everything below the chart (Spot/Futures/Market Stats/Performance/Token Profile/Price History/Market Details/Networks/Happening Now cells all deleted); whitepaper + official-website chips stay in the header. New base row = three Binance token-data cards; second row = one full-width RESERVED empty cell (owner will specify).
- TASK 1 — Money Flow Analysis (tdx MoneyFlowCard): REAL spot aggTrades via new server module server/src/binance/moneyflow.ts + GET /api/token/moneyflow?symbol&window(15m|1h|4h|1d). Every aggregate trade classified by taker side (isBuyerMaker) and Binance's size convention (Large ≥ $100K · Medium $10K–$100K · Small < $10K, documented in the ⓘ title); sums in BASE units like Binance's widget. High-volume windows paginate BACKWARD from now (cap 60×1000 trades) so caps keep the most recent trades and report honest coverage ("Most recent N% of the window"). Donut = 6 segments (green buys dark→light, red sells light→dark) with leader-line % labels; ANIMATED with an rAF sweep (easeOutCubic 750ms) because CSS keyframes freeze at the owner's 125% zoom. Table = Orders/Buy/Sell/Inflow × Large/Medium/Small/Total. Verified on BTC: 6 segments, arithmetic exact (36.59 = 2.64+14.25+19.7; inflow 14.19).
- TASK 2 — Open Interest (OiCard): new fetchOiHist in rest.ts + /api/futures/oi-hist (period 5m…1d): Binance-gold #F0B90B bars = OI in base units (left axis) + ink line/dots = notional (right axis), Binance-photo anatomy, period PillSelect.
- TASK 3 — Basis (BasisCard): new fetchBasisHist in rest.ts + /api/futures/basis-hist (futures/data/basis, pair+PERPETUAL): gold futures line + ink index line + faint gold basis area on the right axis, legend, period PillSelect.
- Works for every token: big perp (BTC 6-bucket flow, $6.3B OI), small perp (ZRO small-only flow — honest), spot-only (TUSD: flow reads "No trades in the window" when quiet + OI/Basis say "Spot Only — no Binance USD-M perpetual"). 60s server caches on all three endpoints; #F0B90B used ONLY as a chart series color (Binance's own OI/basis identity), never UI chrome.
- Gates below; verified in real Chrome on ZRO/BTC/TUSD with screenshots against the owner's three reference photos.

## 2026-07-09 — Chart source toggle (Spot/Futures) + TV tool rail
- SOURCE TOGGLE: Spot | Futures seg in the chart controls (perp pairs only — hidden on spot-only tokens). Futures mode pulls /api/candles?market=futures (fapi klines) and streams the live fstream.binance.com kline WS; verified BTC futures last ($62,259.99) differs from spot as expected. Futures has no 1s klines: the 1S chip disables with a "Spot-Only Granularity" title and the effective interval coerces 1s→1m — honest, never silently wrong.
- TV TOOL RAIL (TradingViewChart gains a `tools` prop — token page passes it; ALL other TradingViewChart uses stay untouched, and the simple/Binance chart stays clean per owner order): Zoom In/Out (barSpacing ×1.35), Fit All, Jump To Live, Log Scale (PriceScaleMode), Volume toggle, MA (SMA-20 overlay computed client-side, purple line). Quiet 26px buttons in a floating panel top-left of the chart. Verified: rail renders only in TV mode, Log/Vol/MA states toggle, MA line draws over candles.
- Client-only change; build clean (3 pre-existing TradingViewChart tsc baseline errors unchanged).

## 2026-07-09 — Token base cards made INTERACTIVE (measured on live Binance), money flow resized
- GROUND TRUTH taken from binance.com/en/futures/funding-history/perpetual/trading-data in Chrome (dispatched real mousemoves on their Highcharts SVGs and read the DOM): tooltip = floating opaque box, "MM/DD HH:mm" header, one row per series with colored marker and FULL-precision comma-grouped value ("Open Interest (BTC): 101,279.338 · Notional: 6,296,171,837.84"), nearest point/bar highlighted.
- Implemented the same on all three cards (ChartTip component, opaque per the zoom law, flips side past 55% width): OI hover = dashed vertical guide + hovered bar full-opacity (others dim) + enlarged line dot + tooltip; Basis hover = guide + both dots enlarge + 3-row tooltip (Futures/Index/Basis); Money Flow donut hover = segment pops 19→25 stroke + others dim to 0.35 + tooltip "Medium Sell · BTC: 25.4661 (29.39%)"; hovering a TABLE row highlights that bucket's buy+sell segments (row gets hover wash).
- Money Flow compacted to match the other two: donut R 46/stroke 19 in a 300×158 viewBox, table rows 32px/13.5px — all three cells measure 539px exactly.
- BUG FIXED EN ROUTE: the donut sweep re-ran on every 60s poll and rAF freezes in background tabs → segments could render at sweep=0 (invisible). Sweep now keyed to symbol+window: animates on load/timeframe change only, silent refreshes keep the drawn state. RULE: rAF entry animations must be keyed to user-visible changes, never to poll ticks.
- Verified in real Chrome with screenshots showing all three tooltips live; equal heights measured.

## 2026-07-09 — Token page final polish: THIN numerals ruling, chart headroom, cell slack killed
- OWNER RULING (repeated, now permanent): THIN over thick, always. Large price numeral 40px weight 520 → 430 (Coinbase-thin large digits; -0.014em); range chips 14/510→13.5/440 (.on 570→500); card h3 18/620→17/560; token h1 28/560→28/500; src seg 520→460; stat values 470→440; flow total 550→510. DISTINCTION RECORDED: "h1 40/520" applies to WORD titles (Borrow, Risk); large NUMERIC displays are 430 — numbers always wear less weight than words at the same size.
- CHART ZOOM FIX: the simple line chart's y-domain padded 6%→22% top/bottom — the line no longer fills edge-to-edge ("zoomed in" complaint); matches Coinbase's proportions where the line breathes inside generous margins.
- CELL SLACK: OI/Basis viewBox H 272→380 → measured slack per cell now MF 16 / OI 7 / Basis 7 px (was 63px of dead space under both charts). Method: measure cell bottom minus last child bottom in real Chrome; tune H = (needed rendered height)×W/cellInnerWidth.
- NOTE: tried to measure coinbase.com/price/bitcoin live but the owner's logged-in session redirects to his portfolio page — used the LOCKED spec (measured from his reference screenshots) + the thin direction instead.
- All verified in real Chrome with measurements + screenshots.

## 2026-07-09 — Coinglass panel on the token page (funding/OI/volume/liquidations, all 452 tokens)
- The reserved bottom row is now the Coinglass reference (owner screenshots, coinglass.com/currencies/BTC): full-width tabbed panel — Funding Rate | Open Interest | Volume | Liquidation — one dual-axis chart, gold token-price line overlaid on the right axis, interval PillSelect per tab, the same Binance-format hover tooltip (dashed guide + "MM/DD HH:mm" + full-precision rows) as the three cards above.
- DATA (all real, per tab): FUNDING /api/futures/funding-hist → fapi fundingRate (500 records ≈ 166d for BTC; last rate 0.007171% matched the owner's Coinglass screenshot EXACTLY), signed green/red bars, 30D/90D/All ranges. OI /api/futures/oi-hist period 5m→1d — green gradient area; honest "30d Max Upstream" tag (Binance's futures/data cap). VOLUME spot klines qv — 1m→1D + All(1w); 1,000 daily bars ≈ 3 YEARS. LIQUIDATION: Binance killed the history endpoint, so server/src/binance/liquidations.ts RECORDS OUR OWN from wss !forceOrder@arr (all symbols): SELL order = long liquidated; 5m buckets kept 48h + 1h buckets 90d, persisted data/liquidations.json, reconnect loop, /api/futures/liquidations?bucketMs + /stats. Panel states "Recording live liquidations since <ts> — Binance publishes no history" until buckets accrue (stream verified connected; zero events market-wide during the calm test window is real, not a bug).
- BUG FIXED: KLINE_INTERVALS whitelist rejected 8h/12h/6h/3d/1M → the funding tab's price overlay silently got [] and the right axis rendered $0.93 garbage. Whitelist widened to all Binance intervals. LESSON: when a dual-axis overlay shows an absurd scale, the overlay fetch failed silently — check the endpoint whitelist before the math.
- X-axis labels include the year when the span exceeds ~300d (3-year volume ranges were ambiguous).
- Verified in real Chrome: all four tabs, hover tooltips, tab/interval switching, honest fallbacks (spot-only pairs, empty liq buckets). Gates 50/50.

## 2026-07-09 — MASTER PLAN: premium redesign wave (owner order — execute IN ORDER, carefully)
OWNER ORDER: redesign Borrow "the way u redesigned the Account page" (the line-less sections read broken — give it Account's anatomy/anchoring); then COMPLETELY redesign Basis Scanner (Strategies.tsx), Volume Scanner, Opportunities, Risk, Logs, Health, News, Calendar — strip repeated/foreign garbage per BLUEPRINT.md skeletons, Coinbase premium creative look, ONE BY ONE, CAREFULLY (owner: "it can ruin the website if u do everything in hurry").
BLUEPRINT SKELETONS (what each page IS): Basis Scanner = what the engine scans+why: symbol/spot+perp bid-ask/executable gap+direction/funding/funding-adj edge/fees/gap age/widening/spreads/depth/borrow need+avail/risk status/proposal status/named reject. Volume Scanner = price/1s-5s-1m vol vs baseline/trade count spike/avg trade size/taker aggression/spread/depth/price move/focus state/reject reason. NO fake strategy cards, no "AI running" without engine state, no market table as main content. Opportunities = proposal queue: strategy/symbol/direction/reason/edge/evidence/borrow/risk decision/size/reject/watch/dismiss (approve opens guarded ticket, never sends). Risk = "can anything act" ONLY (done 07-08, rsx-). Logs = "what happened and why" severity model (done). Health = "can we trust data" (done, hlx-). News+Calendar = utility full-page tiles (Binance announcements browser / TradingView economic calendar).
STATUS / NEXT: (1) Borrow→Account-style restyle [IN PROGRESS], (2) Basis Scanner teardown, (3) Volume Scanner teardown, (4) Opportunities teardown, (5) Risk premium polish, (6) Logs premium polish, (7) Health premium polish, (8) News, (9) Calendar. Each: read current file → strip per blueprint → Markets/Account voice + creative premium touches (tonal accents, sparklines, verdict words — never decoration over truth) → ship gate (real Chrome, rails, thin numerals, Title Case, honest fallbacks) → gates → log here. Post-compaction continuers: the ship gate lives in DESIGN_PLAYBOOK §0/§0.5; page recipes in memory ui-precision-spec.

## 2026-07-09 — Wave step 1 DONE: Borrow → Account card anatomy
- Borrow restyled to the Account gold standard: three hp-group CARDS replace the open sections (the owner read the line-less layout as "broken" — Account's anchoring IS the card chrome). Hero card = acb-label "Total Debt" + Catalog pill + acb-value big thin number + acb-approx sub + Borrow Guard tile right + quartet (Collateral/Active Orders/LTV/Borrow APR) under an INTERNAL hairline. Console card = acb-tabs + loan grid. Market card = h2 + controls + starred borderless table. Page h1 REMOVED (Account precedent: the hero card leads). primaryApr derived for the hero.
- RULE LEARNED: the one-left-rail law applies to OPEN pages (Markets voice); CARD pages (Account voice) anchor with hp-group chrome + internal padding instead — Borrow needed the card voice because its sections are heterogeneous (hero/console/table). Choose the voice per page: homogeneous data surface → open Markets voice; mixed control surface → Account cards.
- Verified in real Chrome: three cards, quartet hairline, guard working, table intact. NEXT per master plan: Basis Scanner teardown (BLUEPRINT columns), then Volume, Opportunities, Risk/Logs/Health polish, News, Calendar.

## 2026-07-09 — Wave step 2 DONE: Basis Scanner (bsx-) rebuilt to blueprint
- Strategies.tsx rewritten in the open Markets voice: h1 + Scanning/Stale pill + gate math in the sub; quartet Pairs Scanned/Pass Liquidity/Watching/Proposing (shared bwx-hero-metrics, open — no card); OPEN PROPOSALS as premium cards (icon, side chip Carry/Borrow Setup, engine reason, net-edge number, click → queue); SCANNER BOARD = the blueprint column set from live MarketRow: Spot(+spread sub)/Perp(+index sub)/Basis(+Perp Rich|Cheap direction)/Net After Fees(+gate sub, green when past gate)/Funding(+fmtCountdown(nextFundingTime))/24h Volume/Status pill (signal/watching/idle), sortable, top 25 of liquid pairs, row→token page; FUNDING EXTREMES two columns (Longs/Shorts Pay Most, top 4) + RECENT SIGNALS feed from /api/signals using the REAL SignalRecord shape (basisOpen/basisPeak/basisClose/openedTs/closedTs — no invented fields).
- Verified in real Chrome: 360/77/0/2 pipeline, EPIC +0.68% & SPELL +0.12% proposal cards matching the two Signal rows on the board — engine truth coherent end to end.
- NEXT: step 3 Volume Scanner teardown (blueprint: price, 1s/5s/1m vol vs baseline, trade-count spike, avg trade size, taker aggression, spread, depth, price move, focus state, reject reason), then Opportunities, Risk/Logs/Health polish, News, Calendar.

## 2026-07-09 — Wave step 3 DONE: Volume Scanner (vsx-)
- Rewritten to the open Markets voice while staying 100% honest (engine merged, live adapters pending): h1 + Not Wired pill; quartet 88/88 Proofs · Adapters Pending · 0 Watched · 0 Proposals; DECISION SURFACE = the 11 blueprint fields as premium spec tiles (label + plain-English meaning) instead of a dead empty table; cross-link "Basis Scanner Is Live". No fake rows, no simulated numbers. When the live adapters ship, this page swaps tiles for the real per-symbol board.
- NEXT: step 4 Opportunities teardown (proposal queue per blueprint), then Risk/Logs/Health polish, News, Calendar.

## 2026-07-09 — Wave step 4 DONE: Opportunities (opx-) re-voiced; WAVE CHECKPOINT
- Opportunities: hp-PageHead/stats replaced with the Markets hero + quartet (Active/Threshold/Above Threshold/Watching); queue logic untouched (blueprint-true already: proposal cards w/ spark, basis now/peak, funding, confidence, volume, fees, engine reason line, Approve Ticket→guarded, Market/Watch/Reject; radar tabs labeled context-not-signals). opx- CSS re-voices card type to the thin law. Verified live: EPIC +0.91% / SPELL +0.35% cards + Best Live Edges inspector.
- WAVE STATUS: DONE 1-Borrow(cards) 2-Basis Scanner(bsx) 3-Volume Scanner(vsx) 4-Opportunities(opx). REMAINING per master plan: 5-Risk polish 6-Logs polish 7-Health polish (all three already Markets-voice from 07-08 — remaining work is premium touches only: check facts rows casing, tonal accents, spacing rhythm vs ship gate), 8-News re-voice, 9-Calendar re-voice (both still old hp voice — full re-voice like Volume Scanner pattern: bwx-hero + rsx-band + house rows). Gates 50/50 at this checkpoint. Continue from step 5; every recipe needed is in ui-precision-spec + this file.

## 2026-07-09 — WAVE COMPLETE: steps 5–9 (News nwx-, Calendar clx-; Risk/Logs/Health confirmed current)
- NEWS (nwx-): hp-PageHead → Markets hero (h1 News + Live·Fetched pill + honest sub "Never Invented, Never Summarized"), Refresh/Binance as mkx-pills right, tab bar under a divider band, headline type to the thin law. Feed logic untouched.
- CALENDAR (clx-): same hero treatment (h1 Calendar + Live pill + zone/refresh sub, Refresh/TradingView pills), All Events/Medium+/High Impact Title Case, filters band divider, real TradingView-proxied feed untouched.
- RISK/LOGS/HEALTH: re-inspected — already on the Markets voice from 07-08 (rsx-/hlx-, tonal icons, side-by-side, verdict words); no violations of the newer thin-numerals law found on their surfaces; left as-is per "carefully, don't ruin".
- FULL 13-PAGE NAV SWEEP in real Chrome: Dashboard/Account/Borrow/Markets/Token/Basis/Volume/Opportunities/Risk/Logs/Health/News/Calendar ALL ok, zero crashes. Gates 50/50.
- WAVE SUMMARY (all 9 steps): 1 Borrow→Account cards · 2 Basis Scanner bsx (blueprint board) · 3 Volume Scanner vsx (honest spec tiles) · 4 Opportunities opx (hero+re-voice) · 5-7 Risk/Logs/Health confirmed · 8 News nwx · 9 Calendar clx. Voice-decision rule on record: homogeneous data page → open Markets voice; mixed control page → Account cards.

## 2026-07-09 — Alignment repair sweep (owner rage on narrow window + dark mode)
- ROOT CAUSES at ~900px: (1) the ≤1060px icon-rail collapse was OVERRIDDEN by the legacy `.snav { width: 218px !important }` pin → 218px band with hidden labels, off-center icons, and the Opportunities badge floating orphaned; (2) fixed-colgroup tables (Markets ~1112px min, Health evidence matrix, Basis board) overflowed the viewport; (3) the token-page header row (title+star+pills+search) refused to wrap; (4) hero label wrapped to "Total / Debt".
- OWNER ORDERS APPLIED: Opportunities count badge REMOVED entirely; nav renamed "Basis Scanner"→"Basis", "Volume Scanner"→"Volume"; sidebar shrunk 218→176px (fits "Opportunities" + symmetric air — the legacy pins at ~11065/13887 edited IN PLACE per playbook); nav ink thinned 500→460 weight; icon-rail collapse moved to ≤820px WITH !important so it actually beats the pin.
- OVERFLOW LAW (playbook-consistent): wide tables scroll INSIDE their container at ≤1020px (`display:block; overflow-x:auto` on .mkx table/.hlx-table/.bsx-table); header/control rows flex-wrap; .tdx-search clamps to min(300px, 52vw); .acb-label nowrap; bwx quartet 2-col under 1100px.
- VERIFIED at 900px + dark, all 13 tabs measured: ZERO horizontal overflow everywhere (was Markets +44, Token +413, Health +519). Gates 50/50.

## 2026-07-09 — THE UNIVERSAL EDGE: every tab wears the Account/Token boundary
- ROOT CAUSES of "quality dropping" in dark mode: (1) `[data-theme="dark"] .card { border-color: transparent }` stripped Dashboard/legacy cards of their edges; (2) dark `--line-2` #1f242c was near-invisible against panels, so even carded pages (Borrow/Logs) read borderless. The owner's praised Account/Token edges only survived by their specific chrome.
- FIX (one system, both themes, same color everywhere): dark `--line-2` → #262d38 (razor-thin but visible); dark .card border → var(--line-2); `.bwx-hero` and `.rsx-band` promoted to full card chrome (panel bg + 1px var(--line-2) + radius 12 + 20-22/24 padding + 14px margins — shadow-sm light, flat dark); `.mkx-prices` (the Markets screener), `.news-page-list`, `.cal-page-list` framed identically. Borrow's hp-group heroes unaffected (identical chrome).
- MEASURED across ALL 13 tabs in dark: every major surface carries a visible border — Dashboard 7/7, Account 3/3, Borrow 3/3, Markets 1/1(+stat tiles), Token 1/1, Basis 4/4, Volume 2/2, Opportunities 4/4, Risk 3/3, Logs 5/5, Health 3/3, News 2/2, Calendar 2/2. Zero borderless surfaces. Gates 50/50.
- LAW (playbook-grade): ONE edge system — 1px var(--line-2) on every major surface, same token in both themes, razor-thin margins (14px between cards); never theme-strip borders; when dark mode "loses quality", check border tokens FIRST.

## 2026-07-09 — THE ACCOUNT STRETCH LAW: every page fills the window, gutters constant
- ROOT CAUSE of "dead side space on stretch": `.container { max-width: var(--maxw) 1600px; margin: 0 auto }` capped every page EXCEPT Account (whose .hp-page.wide bypassed it) — so stretching the window grew empty flanks instead of stretching content.
- FIX: `.container { max-width: none; margin: 0 }` — content on EVERY page now behaves exactly like Account: cards/tables/charts stretch with the window; the sidebar→content and edge gutters stay constant-pixel (22px container padding + fixed shell offsets); nothing breaks because every grid is minmax(0,1fr) and every svg is width:100%.
- MEASURED at 2200px AND 1300px across all 13 tabs: container gap L0/R15 (scrollbar) IDENTICAL everywhere, zero overflow. Screenshots: Borrow cards stretch at 1568, contract at 1300, same gutters.
- LAW (playbook): pages never cap width; stretching the window stretches CONTENT, never the gaps. Fixed gaps + fluid boxes = the Account feel the owner wants everywhere.

## 2026-07-09 — Notification Center sprint: compact signal tray + real preference modal
- Topbar notification content rebuilt around the actual control-room job: critical bot/account alerts, opportunities, account activity, and log/system signals from `state.events`; no random token/news spam. Opening notifications no longer auto-clears unread on hover; Mark Read is an explicit real action (`cosmos-notif-seen`).
- Compact tray is intentionally small: status header, one alert-summary card, Critical/Opps/New counters, All/Critical/Opps/Account/Logs filters, two latest rows, Mark Read, Preferences. Rows open the modal, not a full page jump.
- Expanded Notification Center is a popup with blurred backdrop, not a route/page. It shows counts, filter pills, a contained scroll feed (six-row preview), and real preferences. Preferences use existing `prefs.alerts` toggles only: Opportunity Alerts, Account Activity, Critical Risk, Binance Announcements. In-app delivery is shown as active; WhatsApp Agent is explicitly Planned, not a fake toggle.
- Verification: `npm run build` clean, `git diff --check` clean, browser measured tray ~378x381 and modal ~724x663 at current zoom; modal backdrop, feed tab, preference tab, four real toggles verified.

## 2026-07-09 — Notification Center repair: wide overlay + crisp type law
- Owner correction: if a notification surface opens as a modal, do not keep it tiny. It should use the page width so words do not crash inside boxes. Notification modal widened to `min(1080px, 100vw - 68px)` CSS with feed rows spanning the overlay; Preferences is a two-column layout like the Coinbase reference: Delivery left, Types of Notifications right.
- Typography correction recorded as a permanent law in `DESIGN_PLAYBOOK.md`: premium does not mean thick. Large headings can be bigger only with thinner weights (around 500-560); numbers should be around 430; body/subcopy around 420-440. If text looks fuzzy/swollen, reduce font weight first before moving boxes.
- Verified in browser after build: modal measured about 1134px wide at current zoom; title computed 28px/520, counters 31px/430, feed row titles 16px/520, Preferences intro 24px/520, preference labels 15px/520. No row title overflow in the feed; four real alert toggles still wired to `prefs.alerts`.

## 2026-07-09 — Notification Center repair 2: box discipline, full-height overlay, real icons
- Owner correction: the lesson is box discipline, not just "make bigger." Every boundary must be checked for internal air, alignment, footer visibility, and text not touching the border. Added `BOX DISCIPLINE LAW` to `DESIGN_PLAYBOOK.md`.
- Notification modal now uses the app zoom factor: height `calc((100vh - 48px) / var(--uiz, 1))`, top padding divided by `--uiz`, and starts near the top. Feed actions are visible at the bottom instead of hidden below the viewport.
- Feed row stretching bug fixed: CSS grid was stretching the six event rows to fill the tall feed area, creating absurd huge boxes. Added `align-content: start` and `grid-auto-rows: max-content`; rows now keep normal height while the modal remains full-height.
- Replaced random letter category marks with real icons: Critical Shield, Opportunity Radar, Account Wallet, Logs Receipt.
- Verified in browser after build: modal visible top-to-bottom (`y=24`, `bottom=1803` inside `innerHeight=1827`), bottom actions visible (`bottom=1777`), feed rows about 101px, all feed icons are SVGs, no title overflow.

## 2026-07-09 — API Keys topbar repair: two real keys, enabled-only scopes
- Product model is fixed: Binance API posture is TWO keys only. `Read-Only Data Key` feeds balances/orders/loans/account truth. `Automation Key` handles guarded trading, margin/loan-repay, and futures actions. Data stays on the read-only key; withdrawals/transfer-out stay OFF unless explicitly enabled and then must read as a risk.
- UI lesson: compact topbar popovers follow the clock-family scale. Do not make a large security page in the topbar. Use two thin bordered cards, no table/matrix, no disabled red clutter, no tick/cross glyphs, no extra metric strip. Show only enabled scopes as inline text with small status marks: Reading; Spot / Margin; Loan / Repay; Futures. Hidden disabled scopes are not useful in the compact view.
- Source identity lesson: do NOT invent square/letter tiles or homemade logo blocks when a real source exists. Each key card starts with the real Binance source logo, then the HMAC type badge + actual key name (`cosmos-local-read-only` / `aws-secrets-manager`), then the short role/fingerprint/IP line. Never lead with generic labels like "Name / Key / IP" when the object itself can be shown directly.
- Expanded API modal may explain posture, but still uses the same card anatomy and enabled-only permission list. Secrets never appear; only server-side key name/fingerprint/IP posture are visible.
- Verified in Chrome after build: source-first API popup content ~380x303, two equal ~110px key cards, real Binance logo loaded at 64x64, no scrollbar, no `.keyx-matrix`, no `.keyx-card-meta` mini boxes, no `.keyx-perm` disabled chips, no note paragraphs in compact view. Gates 50/50.

## 2026-07-09 — News official source roster integrated and rate-limit safe
- News now uses the owner's full source roster: Binance News / Announcements, Tree Of Alpha Relay, FinancialJuice, WSJ Markets RSS, Benzinga, CoinDesk, The Block, WuBlockchain / Substack, Lookonchain, ZeroHedge, WatcherGuru, Cointelegraph, Decrypt, CryptoSlate, Bitcoin Magazine, and Crypto Briefing.
- Backend source truth: `/api/news?catalog=all` aggregates official Binance announcement categories; `/api/news-context` returns per-source keys/domains/status/counts. Tree is correctly delayed because the official public history endpoint is delayed. RSS sources use publisher-aware cache windows; The Block respects its <=1 request / 3 minutes limit. CryptoSlate falls back to its official `/news/` page if `/feed/` is Cloudflare/rate-limited.
- Frontend source filtering is a single compact source select with counts, real favicon/logo images through `/api/source-logo`, headline-only rows, and footer source health. Automatic polling no longer sends forced refreshes; only the Refresh button forces a pull.
- Verification: official web references checked, `npm run build`, `npm test` 50/50, `git diff --check`, API source check after cooldown showed every requested source returning real rows except Tree intentionally delayed, and browser screenshot confirmed the rebuilt News surface with minute/second row labels instead of `Now`.

## 2026-07-09 — News primary macro/policy tier integrated
- Owner-provided primary-source list is now a first-class `primary` channel in `/api/news-context`, not buried in the media RSS bundle. Added grouped official sources: Federal Reserve Board, BLS, BEA, SEC, CFTC, U.S. Treasury, OFAC, ECB, Bank of England, Bank of Japan, Japan MOF, China NBS, PBoC, SAFE.
- Implementation truth: machine feeds are used where they work (Fed/BLS/BEA/SEC/CFTC/ECB/BoE/Japan MOF); official-page parsers are used where RSS is unavailable, broken, retired, or unreliable (Treasury, OFAC, BoJ, China NBS HTTPS Latest Releases, PBoC, SAFE official News/Data pages). CFTC comments.gov rule feeds were not kept because the official endpoint now says the RSS feed was removed.
- Ranking law: primary macro/policy rows get a source-score boost so Fed/BLS/SEC/Treasury/OFAC/central-bank releases can outrank media/blog rows, while timestamp still prevents stale official rows from pinning forever. Frontend filters/domains/logo lookup include every primary source.
- Verification: official web references checked, `npm run build`, `npm test` 50/50, `git diff --check`, direct compiled-service check showed all 14 requested primary sources live with real rows (`cftc` 3/3 working endpoints; `china-nbs` live after HTTPS page switch; `safe` live after switching from slow homepage to official News/Data pages). Media bundle note: FinancialJuice can still 429 from Cloudflare on cold fetch and must remain honest if no cache exists.

## 2026-07-09 — Token chart repair: real TradingView workspace + no stretched line chart
- Token detail now defaults to a real TradingView Advanced Chart frame with visible top toolbar, left drawing toolbar, indicators, volume study, screenshot/popup controls, and an app-level full-chart workspace. The wrapper renders the generated TradingView iframe URL directly from config instead of bootstrapping a second script instance, because the modal script instance could leave a blank loading frame.
- The custom line fallback is no longer stretched: `preserveAspectRatio="xMidYMid meet"`, constrained line frame, 30px thin price, 10.75px axis text. Lower derivative panels were restored to usable heights: Open Interest/Basis around 340px CSS, Coinglass around 430px CSS.
- Full-chart modal close was moved below the topbar hit zone and stops event propagation. Lesson: never place modal controls over persistent topbar controls; closing can otherwise open the account popover and intercept the next chart click.
- Verified in real Chrome on localhost:8097: TradingView iframe paints with toolbars, full-chart modal paints and closes without navigation or account popover, line mode toggles with no overflow, lower telemetry heights hold, `npm run build`, `npm test` 50/50, `git diff --check`.

## 2026-07-09 — Token chart width correction: never cap the chart on wide windows
- Owner correction: making the chart shorter or capping the line chart in the center is wrong. On stretched windows the chart must grow left-to-right like TradingView, not sit in a small centered box.
- Fix: `.tdx-line-frame` is full width, the SVG viewBox is recomputed from the actual container width with `ResizeObserver`, and TradingView's chart container uses a responsive height clamp. This preserves geometry while filling the whole chart rail.
- Verified in real Chrome on localhost:8097 at the wide viewport: chart cell ~2587px, TradingView frame ~2528px x 819px, line SVG ~2528px x 780px with `viewBox="0 0 2528 780"`, no horizontal overflow, `npm run build`, `npm test` 50/50, `git diff --check`.

## 2026-07-09 — Token bottom derivatives chart correction: full rail, not a shallow box
- Owner correction: the bottom Funding/Open Interest/Volume/Liquidation panel must also stretch like a real chart workspace. Do not leave the bottom chart trapped in a 1160x380 SVG or a forced 430px CSS box.
- Fix: `CgxPanel` now measures the real chart wrapper with `ResizeObserver`, drives the SVG viewBox/width/height from that measured rail, and keeps the Liquidation empty state in the same full-height rail when Binance has no historical liquidation buckets to display.
- Verified in real Chrome on localhost:8097 at the wide viewport: Volume/Funding SVGs render about 2528px x 809px with `viewBox="0 0 2528 809"`; Liquidation empty live-recording rail renders about 2528px x 845px instead of collapsing to a short note; no horizontal overflow; `npm run build`, `npm test` 50/50, `git diff --check`.

## 2026-07-09 — Shared dropdown law: TradingView-style checked menu, no native selects
- Owner requested the Token interval dropdown style be implemented first on News and reused wherever random native select boxes remained. `PillSelect` is now the shared dropdown for News source/page size, Calendar country, Orders status, Fills source, and Risk/Governance rule effect/scope; `web/src` has zero `<select>` markup.
- Dropdown rule: the trigger can be page-specific, but the opened menu is one visual language — opaque white/panel background, 14px radius, soft shadow, 42-44px rows, selected row highlighted with the right-side blue/accent check, scroll for long lists. Do not let a wide page trigger make the opened menu stretch across the whole viewport.
- Verified in real Chrome on the built root server at `localhost:8098`: News source trigger/menu ~399px wide with 81 scrolling options and selected check, News page-size menu opens upward from footer with selected check, Calendar country menu uses the same checked style. `npm run build`, `npm test` 50/50, `git diff --check`.

## 2026-07-10 — Final brand identity: Arbitrage Capital Control Room
- Renamed the visible product to `ARBITRAGE CAPITAL CONTROL ROOM` across the header lockup, document title, accessible home label, favicon, and footer. The internal package/repository name and deployment hostname remain unchanged.
- Replaced the generic three leaning bars with an original code-native `A`: two blue/violet market rails converge on a centered execution diamond, directly tying the mark to cross-venue arbitrage and control-room execution. The same geometry ships as `/arbitrage-capital-mark.svg` for the browser favicon.
- Rebalanced the desktop lockup to a 194×48px hit area with a 42px mark, `ARBITRAGE CAPITAL` at 13.5/650 and `.045em` tracking, and `CONTROL ROOM` at 9.5/590 mono with `.17em` tracking. Search moved 16px right so the wordmark and search pill have a measured 13–16px clear gap instead of touching.
- Verified in the live built app at `localhost:8080`: title reads `Arbitrage Capital Control Room · Dashboard`; desktop geometry is mark 42×42, brand frame 194×48, search starts at x226, and the lockup stays crisp in Light and Dark. The owner Light/Blue state was restored. `npm run build` and browser interaction checks pass.

## 2026-07-10 — Account identity and truthful recent-session history
- The topbar Account trigger now uses a 48px circular identity frame (1.5x its former 32px image slot), clips away the rectangular asset background, and enlarges the mark inside the circle. The 96px circular popup avatar remains the strong identity anchor.
- Both Account live indicators now use the restrained `accountLiveSignal` pulse; Reduced Motion stops the animation. The Recent Browser Sessions rail has an explicit, visible thin scrollbar when its bounded 164px viewport overflows.
- `/api/sessions` is no longer an in-memory 30-minute list. Browser-only telemetry is persisted in SQLite for 30 days, returns every row from the last 24 hours up to 100, marks activity against a 120-second window, and ignores curl, bots, Postman, and other non-browser tools. Rows expose honest first/last seen browser and OS facts and survive server restarts; historic rows from before this migration cannot be recovered.
- Session identity is a SHA-256 digest of IP and user agent. The response is private/no-store and explicitly labels itself `browser-request-telemetry`; Cloudflare's authenticated active-session inventory remains unwired, so the UI does not pretend those request-derived ids are Cloudflare sessions.
- Verified on the built root server at `localhost:8080`: Account opens with one real Chrome 150/macOS row, `This Device`, first-seen age, the 24-hour count, circular 48px trigger, circular 96px popup identity, and a 1.65-second Live pulse. `npm run build`, `npm test` 67/67, and `git diff --check` pass.

## 2026-07-10 — Topbar popup uniformity, sourced identity, and restored operator detail
- All 12 topbar popups now use one measured outer frame: exactly `400px × 488px`, with a `486px` internal pane, fixed header/footer geometry, hidden scrollbars, and no horizontal overflow. Content depth is handled by internal scrolling rather than resizing the popup.
- Popup identity rule: simple line icons remain acceptable on the trigger rail, but the opened popup must lead with a sourced, filled/duotone identity mark. Binance keeps the real Binance source logo; AWS CloudShell now uses the official AWS architecture-icon asset; remaining concept surfaces use official Phosphor duotone icons instead of hand-drawn glyphs.
- Restored operational truth: Binance API Keys shows key type, role, masked fingerprint, IP restriction/network posture, and all permission states; Trust Advisor shows every current check; Notifications exposes all ledger events in a scrolling list. The account avatar is circular and `96px` (1.5× the prior `64px`) and recorded sessions remain scrollable with per-session logout controls.
- Clock and health density are fixed: the clock instrument is `68px` high with four timezone rows visible before hidden-scroll continuation; Data Health uses compact `40px` status rows. Chrome verification on isolated `localhost:8099` measured every popup at the same size and confirmed the backend refresh control transitions from `Refreshing Backend State…` to `Backend State Refreshed` after its health/system probes complete.

## 2026-07-10 — Basis final: v2 executable runtime + single decision frame
- Basis is now the executable-gap decision board from `BLUEPRINT.md`/`ENGINE.md`, not a mark-to-last funding dashboard. `BasisRuntime` feeds the existing deterministic v2 engine with synchronized Binance Spot and USD-M best bid/ask plus live mark/funding, ticks atomically with book ingestion, and serves `/api/engine/basis` every 1.5s.
- Safety correction: the legacy scanner could show reverse-basis “Borrow Setup” proposals while admitting availability was never checked. Reverse basis now fails closed with `borrow_unknown` until an account-specific signed provider proves max borrowable AND a usable rate. No catalog or prior loan is treated as current margin availability.
- UI is one stable Volume/Calendar-family frame: 22px page inset, 57px toolbar, exact Search, four summary cells, compact views, one scrolling decision table, and an in-row evidence expansion. Removed Open Proposals/Funding Extremes/Recent Signals boxes and client-side edge arithmetic. Every displayed edge, cost, carry, quality score, borrow verdict, and reject comes from the server snapshot.
- Rendered verification at 1280×720: frame 1007px wide, zero horizontal overflow, Search 286×34, title 22px/540, dark row text 520 weight. Search, filters, expansion, source identity, and Open Market navigation verified. `npm run build`, basis engine 73/73, full gates 52/52.

## 2026-07-10 — Token final: one live instrument workspace, no duplicated telemetry
- Token now uses one stable 22px-inset instrument frame with identity/search/watch controls, four live summary cells, the server-owned Basis Engine verdict, and a five-view rail: Chart, Money Flow, Basis, Derivatives, Profile. Only the selected workspace renders; the old stack of repeated charts and cards is gone.
- Data ownership is explicit: Spot/Futures candles, aggregate trades, funding, OI, volume, liquidations, and historical basis come from Binance-backed routes; executable-gap status comes from `/api/engine/basis`; profile facts and official links come from the cached CoinGecko profile. Spot-only assets show honest `Spot Only` states instead of invented futures telemetry.
- Profile identity safety: canonical direct IDs now resolve USDC to `usd-coin` and WBTC to `wrapped-bitcoin`, and both cache read paths reject a mismatched cached symbol before returning it. This prevents bridge/wrapped-name collisions from becoming the visible asset identity.
- Real interaction verification on localhost:8080 covered Token search, watch/profile views, contract copy feedback, Money Flow rows, Basis history, all four Derivatives modes, spot-only USDC states, SKL Futures interval guards, line/TradingView modes, and full-chart open/close. Full gates remain 52/52.

## 2026-07-10 — Markets final: native reference universe in one operator frame
- Markets now uses the same stable 22px-inset, 1px-edge, 12px-radius frame as Token/Basis/Volume. The old Explore hero, separate Market Stats card, and separate Market Prices card are removed. One toolbar, four live summary cells, one view rail, one filter band, one internally scrolling table, and one always-visible footer replace the stacked dashboard anatomy.
- Overview is the default and opens on the native sampled-price chart, not TradingView. Opening any market row carries the symbol into Token with the native line chart selected; TradingView remains an explicit secondary choice.
- Source truth is simplified to the only connected provider: Binance. The planned multi-source selector and the misleading `Binance 50 Index` name are removed. Summary values are live computations over `/api/markets`: tracked USDT markets, exact Spot + Perp coverage, executable book coverage, Spot quote volume, advancing/declining breadth, and the clearly labelled volume-weighted Top-50 pulse.
- The existing real evidence is organized into Overview, Derivatives, Basis, and Liquidity views. Search, every sortable column, watchlist, Spot + Perp, Spot Only, Executable Books, Liquid Movers, 25/50/100-row density, keyboard row opening, and pagination are functional. No trade action was added.
- Browser verification at the owner viewport measured frame x=218, y=102, width=1482, border=1px, radius=12px, zero frame overflow, title 22px/540, a 1156px internally scrolling table, and a visible 50px footer at viewport bottom. Light/dark rendering, all four views, filters, sorting, watch toggle/restore, pagination density, and native Token handoff passed.

## 2026-07-10 — Permanent bottom-up uniformity gate + Borrow final

- Owner correction is now permanent: quality may not degrade as navigation moves upward. Every future surface pass must review Calendar → News → Health → Logs → Risk → Opportunities → Volume → Basis → Markets → Token → Borrow → Account → Dashboard before completion, and restart at Calendar after any shared type/color/geometry correction. This rule is codified in `DESIGN_PLAYBOOK.md` §0.3.
- The measured one-frame contract is now exact across Volume, Basis, Markets, Token, and Borrow: frame `x=218`, `y=102`, `1px` edge, `12px` radius; title `22px/540/30px`; summary `y=160`, exactly `102px` high; labels `10.5px/560/.055em`; values `18px/510`; primary rows `12.5px/470-480`; secondary rows `10.5px/420`. All audited pages use the same Inter variable stack and container-driven responsive behavior.
- Root cause of the dark/heavy upper-page ink was concrete: Volume, Basis, Markets, Token, and Borrow used an undefined `--muted-2` token, so those color declarations were invalid and inherited darker primary text. `--muted-2` is now a declared light/dark design token. Volume/Basis received the wide `1450px` internal evidence canvas and restrained 66px row rhythm; Markets/Token were normalized to the same toolbar, summary, row, and font contract; the duplicate Binance badge in Markets was removed.
- Borrow is one truthful Binance operator frame with Positions, Assets, Borrow Preflight, Activity, and Loan Market views. It distinguishes the New Loans policy from effective state; mirrors kill switch, funds, key permission, live-catalog, paused/repay-only, and current-LTV guard blockers; reports Flexible/Margin/Earn and Basis source errors or partial state independently; fails unknown reverse-basis borrow cost closed; shows real USD product limits; includes Cross Margin debt in Assets; and labels the different-principal APR comparison as Rate Spread rather than Net APR.
- Borrow controls are real and read-only/guarded: exact Search, source filters, sorting, watchlist, pagination, keyboard row opening, per-view source age, native Token handoff, Open Basis, and the persisted New Loans guard. No manual borrow, repay, collateral, or trade action was added. Browser verification toggled New Loans off/on and restored open, searched BTC, applied Perpetual Market, sorted APR, paged, reset, opened Basis, and confirmed 58 live reverse-basis rows show rounded trust plus `Signed Rate Required` while Binance signed margin preflight is unavailable.
- Rendered QA caught a DOM-valid but invisible Borrow table: `width:max-content` around a `width:100%` table produced a 1,000,000px canvas. Replacing it with a normal 100% wrapper restored the row; measured table/row width is now the real 1981px workspace. Light/dark screenshots and computed colors confirm thin primary and secondary ink; the original Light theme and guard state were restored.

## 2026-07-10 — Account and Borrow continuous-workspace correction

- Owner correction: copying only the outer frame while filling the interior with parallel divider rows is not the Calendar/News quality bar. Reuse the date-tile rhythm inside a single outer frame: `7-8px` gaps, `1px var(--line-2)`, `10px` radius, `12-16px` gutters, restrained selected inset accent, and natural content flow. Do not trap useful lower content behind an unnecessary tab or fixed-height viewport.
- Account now keeps only Overview, Open Orders, and Recent Fills in the view rail. Overview flows from the measured Spot Balance History / wallet allocation directly into a responsive 3/2/1-column wallet-tile grid. Spot, Earn, and Cross Margin open one independent full-width detail panel below the grid with consistent 16px gutters, aligned seven-column tracks, 36px asset identity, and real watchlist controls.
- Account capital truth is server-owned: `/api/wallet-balances` uses Binance's signed read-only wallet aggregate, one shared 60-second cache, single-flight refresh, 15-second failure backoff, a 10-second upstream timeout, runtime response validation, stale-on-error behavior, explicit source errors, and `Cache-Control: private, no-store`. Net Capital no longer falls back to partial client arithmetic; liabilities and asset values render unknown when required sources/prices are unknown; the ledger metric is labelled gross and coverage-limited rather than authoritative net PnL.
- Borrow now defaults to Overview and places two contained groups in one 12px-padded scrolling workspace: Active Positions followed immediately by the real signed Binance Loan Market. The redundant Loan Market tab is removed; filters, density, sorting, watchlist, pagination, Assets, Borrow Preflight, and Activity remain functional.
- Verification: production build passed; full server gates passed `64/64`; Account search/mask/ranges/orders/fills, wallet selection and aligned detail geometry, Borrow filters and all four views, light/dark rendering, and shared frame `x/y/width`, `1px` edge, `12px` radius, `22px/540` title, and `102px` summary were browser-checked.

## 2026-07-10 — Connection Control final: one real reset and cadence surface

- Removed the duplicate Market Ping trigger from the topbar. Market Price, Account Data, News Context, and Calendar cadence now live in the single bottom-right Connection Control with the exact persisted `<1s / 1s / 3s / 5s / 10s` choices.
- The bottom control uses a transparent code-native reconstruction of the owner-supplied separated dual-arrow mark. The 62px control sits 22px from both edges; idle motion makes one turn per five-second cycle, a manual reset makes exactly three turns and stops, and Reduced Motion disables both.
- `GET /api/system` now reports real connection evidence for Basis/Volume runtimes, News, Calendar, FX, and planned AWS/Cloudflare/external-alert channels. The 500px panel combines that evidence with browser RTT/socket, Binance REST/clock/rate weight, market streams, account sync, Ledger DB, and the honest optional user-stream REST fallback. Planned channels remain disabled with concrete missing prerequisites.
- `POST /api/refresh` now accepts `all`, `market`, `runtime`, `account`, `news`, `calendar`, and `fx`; it rejects unknown/concurrent requests, reports timed work steps, and performs actual engine/runtime restarts or upstream refreshes. Global reset also rebuilds the browser WebSocket with duplicate reconnect protection. Per-source row buttons call their real target.
- Rendered verification on `localhost:8080` at 1280x720 measured the dock at 62x62 with a five-second idle animation and the panel at 500px wide, 1px edge, 15px radius, visible fixed footer, and at least 22px top clearance. A real full reset returned Browser RTT, 3/3 market streams, live News sources, 1,037 Calendar events, 166 FX currencies, writable Ledger DB, and the honest account-stream fallback. Production build, `npm test` `69/69`, and `git diff --check` pass.

## 2026-07-10 — Metric-tile and continuous-surface correction

- Permanent visual law: only executive scan metrics use inset Calendar-style tiles (`104px` height, `10px` radius, `1px` edge, `8px` gap, `12px` internal padding). Operational content underneath is one continuous outer frame separated by hairlines; do not create nested card grids for ledger rows, tables, inboxes, or evidence panels. `MetricTiles.css` is now the shared authority across Dashboard, Account, Borrow, Markets, Token, Basis, Volume, Opportunities, Risk, Health, and Notifications.
- Account supersedes the earlier wallet-tile layout. The Binance/search/polling toolbar clutter is gone. Summary facts use the shared metric tiles; Spot Balance History and Wallet Allocation each span the full frame in vertical order; the wallet buckets remain in Binance's signed order as one full-width hairline ledger. No wallet is expanded by default, and Spot/Earn/Cross Margin open or close their real signed detail table immediately below the selected row.
- Account history combines Binance daily account snapshots with complete intraday SQLite account observations. Partial observations where a multi-asset snapshot collapses to available USDT are rejected; no artificial interpolation is added. The expensive Binance history remains cached while recent complete ledger points merge into every response.
- Borrow Overview is one natural-height continuous workspace: Active Positions flows directly into Loan Market with one divider and no inset group frames. Token now renders Chart, Money Flow, Basis, Derivatives, and verified Profile sequentially, rather than hiding operational telemetry behind mutually exclusive tabs.
- Logs moved beside Notifications under Utility. Logs now issue day-bounded backend queries and render a real 25/50/100 selector (25 default), exact lightweight day totals, and bounded newer/older pagination instead of pulling 20,000 rows every refresh. Notifications is an inbox first and routing/preferences second in the same page; archive collection queries only event kinds the curator can actually promote, rather than repeatedly downloading the complete raw ledger.
- Live wide-viewport audit measured every affected four-metric page at the same `104px` tile height, `10px` radius, `1px` edge, and aligned x coordinates with zero document overflow. Dashboard's six tiles follow the same contract. Account expansion is full-width, Borrow sections are borderless inside the outer frame, Token shows all five telemetry sections, Notifications routing follows the inbox, and Logs defaults to 25 per page.

## 2026-07-10 — Account Details identity and real visitor telemetry

- The supplied night-sky image is the exact default account identity asset (`/account-night-sky.png`) in both the topbar trigger and Account Details. Uploaded profile images still override it through the existing real profile-image control.
- Recent Devices now reports the visiting browser's routed IP, device class/model when the browser supplies it, browser, OS, first-seen age, request count, current/active state, and Cloudflare country when present. IP resolution is Cloudflare `CF-Connecting-IP` first, then the first proxy-forwarded address, `X-Real-IP`, and finally the socket address; localhost correctly renders `127.0.0.1` instead of the former fake `Local Network` label.
- Device details use browser Client Hints when available and conservative UA fallbacks otherwise. IP, device, optional model, first/last seen, and request counts persist in SQLite for the 24-hour Recent Devices view; legacy placeholder rows are removed. The surface remains explicitly labelled browser-request telemetry with a two-minute active window, not a fabricated authenticated-session inventory.
- Account Details retains one real Cloudflare Access logout only. Duplicate per-row logout actions were removed because browser telemetry does not provide a Cloudflare session identifier for remote device revocation.
- Final rendered geometry at 1280x720 is the shared `398x486` Account pane with an `84x84` identity image, `112px` header, `58px` exchange row, `74px` device row, zero overflow, one logout, and no row-level actions. Light and dark were visually verified; Light was restored. `npm run build`, `npm test` `69/69`, and `git diff --check` pass.

## 2026-07-10 — Topbar identity uniformity and Connection Control management pass

- The complete topbar family now follows the Account Details typography and geometry contract: every compact popup stays within the shared `398x486` pane, uses `16px/560` titles and `12.5px/500` row copy, preserves hairline alignment, and has zero horizontal overflow. Persistent triggers are normalized to `42x42` with clean transparent marks rather than screenshot canvases.
- Source identity is explicit without pretending every concept has an official logo. AWS Runner uses a clean orange cloud-control glyph informed by AWS architecture icon conventions; API Keys uses the real Binance brand; Basis reuses the approved purple percentage asset from the left rail. Data Health, Trust Advisor, Notifications, Execution, Currency, Appearance, and Account retain their own established identity marks.
- Data Health now treats the optional Binance user stream truthfully: an unavailable socket is shown as `Fallback` with the real 30-second REST fallback, but is excluded from the required-check denominator. News, Calendar, and FX readiness can hydrate from `/api/system` connection evidence before their individual browser probes complete. Required health remains dynamic rather than cosmetic; browser QA observed both `8/8 Good` and a truthful `7/8 Watch` while a required live check was warning.
- Connection Control supersedes the earlier cramped dock geometry. The launcher is a true `64px` circle placed `28px` from the right and bottom edges with a transparent square dual-arrow mark. Its panel is `500x588` at 1280x720 and separates `Connections` from `Polling`, keeping monitoring rows readable while making cadence controls immediately discoverable.
- Polling exposes persisted browser intervals for Market Prices, Account Data, News Context, and Calendar with the exact `<1s`, `1s`, `3s`, `5s`, and `10s` choices. `Reset Defaults` restores `5s/10s/5s/10s`; `Reset All` rebuilds sockets and refreshes server sources; every supported connection row calls its real targeted backend reset. The summary counts `good` and stable `avg` connections as Healthy while leaving slow/down/fallback sources out, so `Good · 9/10` is no longer contradicted by an optimal-only count.
- Final live verification at `localhost:8080` covered the Polling menu, exact cadence choices, targeted Market Streams reset, Reset Defaults, Reset All, fixed footer actions, `9/10` healthy aggregate, light/dark rendering, and restoration to Light. Production build passes, full gates pass `69/69`, and `git diff --check` is clean.

## 2026-07-10 — Topbar/sidebar optical correction from owner dark-mode screenshots

- The visible brand is now `ARBITRAGE / CONTROL ROOM`; `Capital` and the rejected letter-A mark are removed. The new 34px code-native identity is two opposing blue/violet venue-flow arrows around one controlled midpoint. Document title, home aria label, and footer use `Arbitrage Control Room` consistently.
- Clock is a 130×42px trigger with a 32px-high, 10px-radius transparent instrument, neutral hairline, 24px rotating hourglass, unchanged 14px time, and enlarged 11.5px IST. The blue/white capsule tint and inset highlight are gone; the existing 8.4-second rotation remains and Reduced Motion still stops it.
- Data Health and API Key no longer expose opaque white bitmap canvases in Dark Mode. Both use deterministic transparent SVG identities. AWS Runner uses the current official AWS CloudShell service icon from the 2026-04-30 AWS Architecture Icon package instead of a generic cloud/cog. Topbar marks are normalized to a 25px optical scale; Notification is 27px to compensate for its bell silhouette; Trust Advisor is reduced to the same family.
- Sidebar spacing is compact and complete: 4px top / 5px sides, 36px rows, 6px group gaps, 28px icon slots, and 27-29px source marks shifted down 1px. Utility order is Logs → News → Calendar → Notifications, so Notifications is directly under Calendar and every item fits at 1280×720 without scrolling.
- The route shell now stretches symmetrically: 5px outer shell padding plus 6px route padding leaves an 11px visual sidebar-to-content gap instead of the former 40px screenshot trench. Connection Control moved to 40px from the right and bottom; its panel contracts at short viewports to preserve top breathing room.
- Browser QA in Dark Mode verified the full sidebar, compact neutral clock, transparent Data Health identity, official AWS CloudShell popup, green Binance API-key popup, larger bell, Utility navigation, and lower-right dock clearance. Production build passes, full gates pass `69/69`, and `git diff --check` is clean.

## 2026-07-10 — Connection Watchman consolidation

- Data Health is removed from the topbar. Bottom-right Connection Watchman is now the only source-health, latency, alert, cadence, and recovery surface, while the dedicated Health page remains the deep diagnostic destination.
- The former click-to-reset 64px circle is replaced by a 72px rounded-square code-native watchman mark: shield, radar sweep, connection nodes, and status point. Click persistently opens/closes the workspace; no launcher click can accidentally restart live connections. Reduced Motion disables the sweep and live wave.
- `GET /api/system.connections.watchman` exposes 13 truthful components across Control Path, Binance, Bot Runtime, Source Network, and Infrastructure. Required status ignores Planned AWS/Cloudflare and the optional Binance user-stream REST fallback. News exposes exact live/total adapter counts; FX is primed on server boot. The browser posts sanitized RTT/socket observations to `/api/connections/browser-observation`, allowing material website-path lag and recovery to use the same notification pipeline.
- The server records transition-only `connection_alert` and `connection_recovered` events after startup grace. Notifications promotes them as lag, outage, or recovery alerts. No repeated five-second health probe becomes an inbox item.
- The workspace has Overview, Connections, Sources, and Controls; exact `<1s / 1s / 3s / 5s / 10s` persisted cadences; six targeted backend recoveries; Reset Defaults; Open System Health; and Reset All browser/server recovery.
- Rendered light/dark QA at 1280×720 measured panel `x=338`, `y=20`, `900×566`, dock `72×72` at `x=1164`, `y=602`, zero document overflow, and no Data Health topbar trigger. Live state converged to `10/10` server-required plus the operational browser path, with up to `98/99` News adapters live, 1,041 Calendar events, 166 FX currencies, and the honest user-stream fallback. Production build, full `70/70` gates, and `git diff --check` pass.

## 2026-07-10 — Connection Watchman owner-logo and action simplification

- The launcher now uses the owner's exact solid-blue two-arrow refresh anatomy as a transparent SVG. It is 76px, exactly 30% larger than the replaced 58px identity, rotates once during a long paused idle cycle, and performs the existing recovery spin. The popup header deliberately retains the shield/radar Watchman mark.
- Controls no longer repeat recovery through six cards plus three unequal footer buttons. One Recovery Target selector covers All, Market, Runtimes, Account, News, Calendar, and FX; one 40px `Run Recovery` button calls the same real backend. Cadence Defaults moved into its own section header, Open System Health was removed as duplicate navigation, and the popup has no action footer.
- Rendered verification at 1280×720 measured the closed launcher image at `76×76`, panel `900×566` at `x=338/y=16`, zero document overflow, zero old recovery cards, zero footer buttons, and matched 40px recovery selector/action heights. A real FX recovery completed and persisted `fx · 540 ms` in Last Recovery.

## 2026-07-10 — Shared top-edge and Watchman spacing correction

- The apparent Dark Mode gap was a shared-shell defect, not a page defect: the
  main shell still contributed 16px top padding and every route added another
  22px. The outer/route rhythm is now 5px + 6px on both axes, so every real
  surface from Dashboard through Notifications starts at `y=75` at 1280×720,
  exactly 11px below the 64px header instead of 38px below it.
- The Watchman cleanup had compressed the remaining controls too far. It still
  has one recovery selector and one backend action, but cadence rows are now
  72px with 16px padding, cadence controls are 112×42, Defaults is 112×36, and
  Recovery Target / Run Recovery are balanced 182×44 controls separated by
  14px. The layout uses the full 900×566 panel without adding duplicate actions.
- Sidebar Utility order is explicit and stable in every theme and active state:
  Logs → News → Calendar → Notifications. Navigation rows remain 36px with
  27px marks; none were shrunk.

## 2026-07-10 — Owner topbar identity system

- Replaced screenshot-canvas assets with six transparent, code-native SVG
  identities: the dual-hemisphere gray/teal neural brain is the website mark;
  AWS Runner uses the orange three-face cube; API Keys uses the yellow/orange
  key; Execution uses one red ready / green stopped power component; Currency
  uses the green dollar; Appearance uses the blue eight-ray display mark.
- The new operational marks share a measured 24px topbar optical size inside
  the existing 42px hit targets. Notification is 25px for silhouette balance;
  Trust Advisor and Basis are 24px. Popup identities are transparent 40px
  marks, with the optically lighter AWS cube at 42px. No mark has a white tile,
  colored container, raster background, or document overflow in either theme.
- Account is the intentional photographic exception. The topbar photo is now
  34px, down 30% from 48px, inside a 42px hit target. Account Details uses a
  42px avatar, down 50% from 84px, inside an 84px aligned header row. Real
  exchange, visitor-IP/device telemetry, and logout behavior are unchanged.
- Browser verification at 1280×720 inspected every new trigger and the AWS,
  API Key, Execution, Currency, Appearance, and Account Details popups in Dark
  Mode. Every SVG background computed transparent, popup wrappers had no border
  or shadow tile, document width stayed 1280/1280, and the original Light theme
  was restored. Production build, `70/70` gates, and `git diff --check` pass.

## 2026-07-10 — Final topbar popup canon and left-to-right audit

- Consolidated Clock, AWS Runner, API Keys, Trust Advisor, Notifications,
  Execution Control, Currency, Basis Units, Appearance, and Account Details
  into one `398×486` operator-sheet grammar derived from the clean Logs
  `Strategy Decision` row: `16/540` title, `11.25/400` subtitle,
  `12.75/470` row primary, `10.5/400` secondary, and `11.5/450` mono values.
- Removed every large bottom action footer. AWS destinations and Notification
  tools now sit beside the data they affect; duplicate Trust navigation is
  gone. Account logout remains the sole terminal action as a transparent
  hairline row rather than a rounded tinted button.
- Flattened API key cards/permission pills into two structured evidence
  sections, Trust metrics into one three-cell band, and Currency/Basis/
  Appearance notes into transparent provenance rows. Full-height Clock,
  Trust, Execution, and Currency lists now distribute their real rows evenly
  to the shell edge instead of leaving accidental dead space.
- The browser audit restarted after each shared-selector correction and checked
  all ten popovers in order. Every operational header measured `70px`, Account
  `84px`; all sheets measured `398×486`; all visible footer counts and document/
  sheet overflow measured zero. Light and Dark screenshots were inspected.
- Safe control verification changed and restored Clock UTC→IST, Currency
  INR→USD, and Basis Points→Percent; Notification Open Center navigated to the
  real Notifications page and closed the popover. Light was restored.
- Current research anchors are Apple Popovers/Layout for compact related tasks
  and scan alignment, plus Carbon Structured List for consistent row anatomy.
  Final production build, `70/70` gates, and `git diff --check` pass.

## 2026-07-10 — Watchman instrument and Recent Devices identity repair

- Connection Watchman keeps the real `900×566` workspace and the distinct
  shield/radar header identity, but its launcher now renders the owner's exact
  dual-arrow anatomy as a 68px code-native mark inside a transparent 76px
  target in both themes. The long idle turn, recovery spin, status point, and
  Reduced Motion behavior remain; no square image canvas or dark-mode tile is
  allowed around the mark.
- Overview is one restrained operator instrument: five continuous summary
  cells, a flat underlined four-view rail, and a continuous six-stage monitored
  path with hairline separators instead of six gray cards. Typography follows
  the canonical topbar/Logs row weights. The transition list keeps only the
  newest state change for each connection owner so repeated browser socket
  history does not become decorative filler; the ledger remains authoritative.
- Recent Devices no longer identifies a device by `IP + User-Agent`. The browser
  creates a stable random first-party `cosmos_device` value before React mounts;
  the server stores only a SHA-256-derived id. Matching IP and Chrome metadata
  can now produce separate real devices. Legacy ids are migrated, fallback rows
  are suppressed when a matching token-backed profile exists, static assets do
  not count as device activity, and `/api/sessions` is private/no-store with
  current → active → newest ordering.
- Live Account Details at 1280×720 showed two distinct active Chrome 150/macOS
  profiles on `127.0.0.1`, exactly one `This Device`, separate request counts,
  and the truthful two-minute activity window. Watchman Overview, Connections,
  Sources, Controls, focus behavior, zero overflow, and Light/Dark contrast were
  inspected. Production build passes; full gates pass `71/71`, including the
  new same-IP/same-browser multi-device gate; `git diff --check` passes.

## 2026-07-10 — Sidebar breathing and website identity correction

- Owner correction: icon size and navigation spacing are independent. Sidebar
  source marks are now 19px in the existing 28px alignment column (Calendar and
  Notifications 20px), exactly 30% below the former 27-29px artwork, while rows
  expand from 36px to 40px and group separation from 6px to 8px. The active
  background and label rail stay aligned; no icon or text transform is used.
- A `max-height:730px` fallback retains the older 36px cadence only to keep all
  fourteen destinations visible at the 1280×720 verification viewport. Normal
  owner-height windows use the requested 40px cadence. At the live 1911×1941
  viewport, row centers measured 40px apart, group starts were visibly separated,
  and sidebar/document overflow both measured zero.
- The gray/teal neural mark is retired. The supplied blue code-file identity is
  rebuilt as transparent SVG with its folded page, blue depth face, pale code
  panel, and code brackets. It measures 18×18—half the former 36px mark—while
  `ARBITRAGE` grows to 18/670 and `CONTROL ROOM` to 10.5/650. The brand remains
  inside the 160×48 header hit area with a clear gap before Search.
- Current official reference: Carbon UI Shell treats header and side navigation
  as one persistent orientation system, while Carbon icon guidance separates
  consistent icon artboards from component spacing. Light/Dark rendered checks
  confirmed a transparent mark, exact blue palette, zero overflow, and crisp
  wordmark hierarchy. Production build and `git diff --check` pass.

## 2026-07-10 — Control Room C identity and Watchman bleed repair

- Owner superseded the folded-file website identity. The header now uses the
  supplied concentric blue Control Room `C`, reconstructed as three transparent
  SVG rings at exactly `18×18` beside the existing 18px/10.5px wordmark. The
  interim file and code-bracket experiments are removed.
- Sidebar reductions are encoded from the measured original artwork rather than
  rounded guesses: normal 27px marks render at `18.9px`, Calendar's 29×27 canvas
  at `20.3×18.9px`, and Notification's 28px canvas at `19.6px`—exactly 70% of
  each former dimension. Their 28px alignment slots and 40px row cadence do not
  shrink.
- The broken-looking Watchman was diagnosed from the live stacking context: its
  transparent center exposed a real `$386.32` liquidation value underneath.
  A 60px `var(--panel)` occlusion circle now lives inside the rotating SVG,
  beneath the supplied arrows. It blocks underlying text without restoring a
  visible outer tile, border, or square launcher.
- Current official icon reference is Lucide's full-artboard scalable SVG model;
  live verification measured the brand at 18px, standard navigation artwork at
  18.9px, the Watchman at 68px, a white internal mask in Light, and zero document
  overflow.

## 2026-07-10 — Watchman Overview becomes the control plane

- Owner correction supersedes the former read-only Overview plus fourth
  Controls tab. The rail now has exactly Overview, Connections, and Sources.
  Overview places the compact six-owner connection/evidence path on the left
  and Market, Account, News, and Calendar cadence controls on the right.
- Every cadence row has the persisted `<1s / 1s / 3s / 5s / 10s` selector and
  one dedicated backend refresh action. Defaults remains a single restrained
  action; recovery is not repeated in cards or hidden in another view.
- The All/Market/Runtimes/Account/News/Calendar/FX selector and Run Recovery
  action are a fixed 76px bottom console shared by all three views. Connections
  and Sources scroll above it, so a growing inventory cannot push recovery out
  of reach.
- Live verification measured a `900×650` panel at the active workstation,
  `484.9/413.1px` Overview columns, six 43px evidence rows, four 64px cadence
  rows, and a 76px footer whose top exactly meets the scroll region and whose
  bottom stays 1px inside the panel. Cadence changed `5s → 3s → 5s`; targeted
  Calendar recovery completed without issues and reported `calendar · 1975 ms`.
- Official AWS CloudWatch Network Synthetic Monitor documentation reinforces
  the operator model: monitor/probe evidence and operational actions belong in
  the same workflow rather than being split across a detached control tab.

## 2026-07-10 — Header hierarchy and Execution Control action repair

- Owner correction supersedes the 18px website mark / 24-25px operational rail.
  The concentric Control Room `C` is now 30px with an 8px optical gap to the
  existing wordmark. AWS, API Keys, Trust, Notifications, Execution, Currency,
  Basis, and Appearance artwork is uniformly 18px inside unchanged 42px hit
  targets. This makes the brand primary and the command rail deliberately quiet.
- Execution Control no longer makes its entire stopped-state row green or
  clickable. The `398×76` state row is transparent evidence with a 30px power
  mark, aligned copy, and exactly one `102×36` Resume/Stop action. The button
  alone carries state color; the four persisted execution-mode rows remain
  unchanged.
- Live verification measured the brand at `30×30`, every operational mark at
  `18×18`, the execution columns at `34/214/102px`, and the single action at
  `102×36`. Light and Dark both retain a transparent state row. Resume was
  exercised through the real control and the original `Bot Stopped` safety
  state was restored immediately before completion.
- Current Apple HIG research supports the hierarchy: toolbars should avoid
  overcrowding, while interface icons need consistent optical size/weight and
  may be dimensionally adjusted for visual balance.

## 2026-07-10 — Watchman source-logo restoration and motion verification

- The Connection Watchman launcher again renders the owner-supplied
  `/connection-reset-mark.svg` directly. The interim JSX reconstruction is
  removed so the launcher cannot drift from the approved two-arrow anatomy.
- The 60px theme-matched occlusion circle is fixed in the 78px image holder,
  behind the 68px rotating asset. It blocks chart prices and metrics from the
  transparent center without creating a square tile or joining the mask to the
  animation. The 76px launcher target and operational state point are unchanged.
- Live verification at 1280×720 observed a real idle rotation transform during
  the 11-second paused cycle, confirmed the exact SVG source in Light and Dark,
  and confirmed Reduced Motion changes the animation to `none`. Launcher
  open/close remained a panel action only; no recovery ran from the launcher.
- The required `Calendar -> News -> Health -> Logs -> Risk -> Opportunities ->
  Volume -> Basis -> Markets -> Token -> Borrow -> Account -> Dashboard` sweep
  held the same 68px mark, 76px target, zero horizontal overflow, and correct
  theme mask on every page. Production build and all `71/71` gates pass.

## 2026-07-10 — Watchman supplied-pixel correction

- Owner rejected the prior result because it still combined an inaccurate
  vector reconstruction with a visible inner mask and the global dock's
  breathing rounded-square pseudo-element. Those layers made the mark read as
  a small chain/eye inside a ghost tile instead of the supplied reset artwork.
- `/connection-reset-mark.svg` now packages an alpha-extracted crop of the
  supplied `355×339` image. The pale `#F7F7F7` screenshot canvas is removed while
  the exact long arcs, `#588DF2` blue, antialiasing, and `264:230` artwork ratio
  are preserved. No JSX or path approximation remains.
- The launcher is one borderless 76px `var(--panel)` circle. The inherited
  `.rdock-btn::before` outline, the inner occlusion mask, image shadow, and hover
  glow are disabled. The circle alone prevents page data from bleeding through
  the transparent artwork; the operational state point remains truthful.
- Browser verification observed the real paused idle turn, confirmed Reduced
  Motion changes animation to `none`, inspected Light and Dark, and restored
  Light/Full Motion with popovers closed. The complete bottom-up page sweep held
  the same source, circular geometry, zero ghost pseudo-element, and zero
  horizontal overflow. Production build and all `71/71` gates pass.

## 2026-07-10 — Account chart scaling and allocation-circle repair

- The Account chart was visibly centered and truncated because its live
  `711×286` box still rendered the fallback `1000×330` viewBox. Default SVG
  `xMidYMid meet` scaling reduced that coordinate system to a narrow centered
  plot while the CSS date axis spanned the full Account width. The blank sides
  and misaligned dates were geometry failures, not missing Binance history.
- Spot Balance History now uses a normalized `1000×286` plot with
  `preserveAspectRatio="none"`, non-scaling grid/line strokes, and independent
  CSS-owned date and value axes. The plot canvas reserves the same fixed 68px
  value rail at every width, so the SVG, dates, crosshair, and tooltip share one
  coordinate space without ResizeObserver timing.
- Wallet Allocation no longer stacks rotated SVG dash circles. It is one exact
  `128×128` conic-gradient circle with a 16% theme-matched circular hole and an
  accessible allocation label, eliminating the visible dash join and transform
  ambiguity while preserving the real Spot/Earn percentages and source colors.
- Browser verification exercised 1W/1M/3M/6M: every range held the same
  `1000×286` plane, the latest point ended at `x=996`, and the 1M first point
  began at `x=19.1` instead of a centered half-width plot. Light/Dark, zero
  overflow, and the bottom-up page sweep passed. Production build and all
  `71/71` gates pass.

## 2026-07-10 — Capital Accounts full-width disclosure restoration

- Owner rejected the `350px wallet rail + partial right detail workspace` as a
  half-rectangle representation. That master-detail ruling is superseded:
  Capital Accounts is one continuous full-width disclosure ledger.
- Every wallet row now spans the complete Account frame with Wallet, Balance,
  Positions, Liability, and Wallet Share. Spot is expanded by default and its
  full signed asset table renders immediately under the Spot row at the exact
  same `x` and width; Earn follows only after the Spot table. Earn and Cross
  Margin use the identical single-open accordion behavior. Unsupported wallets
  stay truthful non-expanding valuation rows.
- Live geometry measured the Spot row and detail at the same `x=190` and
  `1063px` width, with `Spot row -> 340px Spot detail -> Earn row` sharing exact
  touching boundaries and zero horizontal document overflow. Collapse, Earn
  expansion, Spot restoration, and Dark Mode were exercised; Light was restored.
  Production build and all `71/71` gates pass.

## 2026-07-10 — Execution Control single-action header

- Owner rejected the passive `Limited` badge plus separate Bot Running action
  row as two controls for one state. Execution Control now gives the header's
  trailing slot to the real `102×36` Stop Bot/Resume action and removes the
  redundant 76px row entirely.
- The live blocker remains in the header subtitle, while Execution Modes begins
  immediately below the header. The fixed `398×486` panel now distributes the
  remaining height across four equal 96px mode rows with no clipping, internal
  scroll, or document overflow.
- Browser verification measured one action, zero status pills, zero legacy
  emergency rows, and exact `102×36` action geometry in Light and Dark. Stop was
  exercised and the original running state was restored through the real API.
  The complete bottom-up page sweep retained the shared `x=178`, `1102px` main
  frame and zero horizontal overflow.

## 2026-07-10 — Borrow leading-column alignment repair

- Owner caught that Active Positions and Loan Market did not share one star and
  asset rail. The cause was table-layout scaling: their `1520px` and `1380px`
  canvases proportionally redistributed nominal first-column widths, placing
  stars at different fractional x coordinates and shifting both tables away
  from the Markets reference.
- Positions, Loan Market, and Assets now use explicit `colgroup` tracks with
  Markets' exact `46px` watchlist column and `220px` asset column. Remaining
  evidence columns are intentionally flexible, so canvas width cannot scale the
  two leading identity tracks.
- Live browser measurements at `1280px` now match Markets exactly: table edge
  `x=190`, stars `x=198`, asset cells `x=236`, and token icons `x=248` in all
  three Borrow tables. Overview, Assets, Borrow Preflight, and Activity render
  without document overflow; Light and Dark retain identical rails. The full
  bottom-up page sweep kept the shared `x=178`, `1102px` main frame.

## 2026-07-10 — Token derivatives intelligence consolidation

- Owner rejected the oversized standalone Basis section, the four-cell divider
  strips, slow blank tab hydration, and the bottom About/Profile block. Token now
  ends with one five-view operator panel in the required order: `Funding -> Open
  Interest -> Volume -> Liquidation -> Basis`; Basis is no longer a separate
  page section and the About/Profile region is no longer rendered.
- Each active view owns four rounded `10px` evidence tiles and one measured-width
  chart. The chart's rendered `1023x310` box and `viewBox="0 0 1023 310"` remain
  identical across Funding, Open Interest, Volume, and Basis, so no centered or
  partial canvas can appear. Money Flow uses the same rounded-tile language
  instead of parallel divider strips.
- Token candles, money flow, positioning, and every default derivatives dataset
  now hydrate from module cache while fresh official exchange data loads in the
  background. All five default derivatives datasets prefetch together; browser
  checks showed every populated view present immediately on selection without a
  loading skeleton. Volume correctly requests Binance USD-M candles whenever a
  perpetual contract exists and falls back honestly to Binance Spot otherwise.
- CoinGlass V4 remains an optional professional aggregation source but is not
  labeled or used without its required plan/API key. The current implementation
  uses official Binance REST/market data. Liquidation history remains the app's
  truthful persisted live recorder because Binance provides no historical REST
  endpoint.
- The liquidation recorder was still using Binance's retired legacy futures
  socket while the market engine used the current `/market/ws` host. It now uses
  `wss://fstream.binance.com/market/ws/!forceOrder@arr`; live verification moved
  the recorder from zero symbols/events to `live`, `23` symbols, and `46` events.
- Production server/web build and all `71/71` gates pass. Light and Dark Token
  checks have zero overflow, the old Basis/Profile selectors are absent, and the
  required `Calendar -> News -> Health -> Logs -> Risk -> Opportunities ->
  Volume -> Basis -> Markets -> Token -> Borrow -> Account -> Dashboard` audit
  held a common `x=183`, `1077px` page frame with zero document/main overflow.

## 2026-07-10 — Notifications page identity mark restoration

- Notifications was the only page in the Logs / News / Calendar utility family
  whose title had no matching sidebar artwork. Its toolbar now reuses the real
  `/notification-bell.png` sidebar asset instead of introducing another icon.
- The page mark follows the established utility-page title contract: `30x30`,
  `object-fit: contain`, an `8px` title gap, and decorative `alt=""` / `aria-hidden`
  semantics so the visible `Notifications` heading remains the accessible name.
- Production web build and `git diff --check` pass. Browser verification measured
  the mark at exact `30x30` geometry inside the unchanged `57px` toolbar in Light
  and Dark, with zero document overflow; Light was restored.

## 2026-07-10 — Exact supplied Arbitrage brand mark

- Owner rejected the code-reconstructed three-circle header mark and supplied the
  exact `200x200` concentric blue identity. The Topbar now renders that supplied
  artwork immediately before `ARBITRAGE`; the reconstruction is removed.
- `/arbitrage-control-room-mark.svg` embeds the original PNG bytes unchanged and
  keys only the white screenshot canvas transparent at render time. A decoded
  asset hash check exactly matches the supplied source:
  `3f376310da2509fb153cf3e0bc1cc8f7ddfb5a7b94d96a44854865e14cf99bb3`.
- The mark is a static, unfiltered `30x30` image with `object-fit: contain`; no
  recolor, shadow, hover scaling, or substitute path changes its geometry.
  Production web build and `git diff --check` pass. Browser verification measured
  the same `x=17/y=17/30x30` mark in Light and Dark, with transparent background,
  zero document overflow, and Light restored with the Appearance panel closed.

## 2026-07-10 — Sidebar 40px rhythm restored at every height

- Owner rejected the short-viewport sidebar compression after comparing it with
  the supplied `207x791` reference. The `max-height: 730px` rule that changed all
  navigation rows from `40px` to `36px` is superseded and removed.
- Every destination now keeps the same reference cadence at every desktop height:
  `40px` rows, `8px` group spacing, `7px` title spacing, `28px` icon columns, and
  stable `14px` labels. Short windows use the existing `.snav-nav` internal
  scroller with a hidden scrollbar rather than shrinking every page target.
- At the `1280x720` verification viewport, the rail has `642px` available for
  `689px` of correctly spaced navigation. The inner rail scrolls exactly `47px`
  to show Notifications fully, and returns to `0` when Dashboard is selected.
  Every rendered row measured exactly `40px` in Light and Dark.
- Production web build and `git diff --check` pass. The required `Calendar ->
  News -> Health -> Logs -> Risk -> Opportunities -> Volume -> Basis -> Markets
  -> Token -> Borrow -> Account -> Dashboard` audit held one `x=183`, `1077px`
  page frame, `40px` sidebar rows, and zero document/main overflow throughout.
  Light was restored with Dashboard active and the Appearance panel closed.

## 2026-07-10 — Account allocation full-width and palette correction

- Owner rejected Wallet Allocation being pinned into the Account overview's
  `320px` right column and the arbitrary orange/purple wallet colors. Live
  inspection confirmed the old `743px + 320px` split placed the donut at
  `x=950`, while wallet names were incorrectly passed through token-brand color
  hashing (`Spot rgb(190,108,45)`, `Earn rgb(103,45,190)`).
- Account Performance and Wallet Allocation are now consecutive full-width rows
  inside the same Account frame. Allocation spans `x=190..1253` (`1063px`), and
  centers a `128px` donut beside a `520px` evidence legend instead of anchoring
  the module in a corner. Capital Accounts continues immediately underneath.
- Wallet types use a stable account palette rather than token colors: Spot is
  `#2f6bff`, Earn is `#159f8c`, and the remaining Binance wallet families have
  restrained blue/teal/slate identities. The donut center still resolves to the
  real theme panel color in both themes.
- Production web build and `git diff --check` pass. Browser verification measured
  the single `1063px` column, `221px` allocation row, exact blue/teal computed
  colors, theme-correct center, and zero document/main overflow in Light and
  Dark. Light was restored with Account at the top and Appearance closed.

## 2026-07-10 — Account history matched to Binance overview anatomy

- Owner compared Spot Balance History directly with the signed-in Binance Assets
  Overview and rejected the oversized blue area chart. Live inspection measured
  the old plot at `1031x286`, with a blue `1.55px` line, filled area, `60px`
  right value rail, and `1M` default; that presentation exaggerated sparse
  account snapshots and dominated the Account page.
- The chart now follows the supplied Binance anatomy while preserving data truth:
  a compact `1031x164` plot, thin `#f0b90b` `1.2px` unfilled line, three faint
  guides, bottom-only dates, no value rail, and `6M` default. The title remains
  Spot Balance History because the source is signed Spot account value and wallet
  movement—not inferred portfolio PnL.
- Downsampling had also converted deposit/withdrawal transitions into misleading
  diagonal ramps. The path now uses horizontal holds plus vertical changes, so
  the reconstructed flow history reads as a true account step series like the
  Binance reference rather than gradual market performance.
- Production web build and `git diff --check` pass. Browser verification exercised
  `1W`, `1M`, `3M`, and `6M`; every range rendered a non-empty `1000x164` SVG,
  the area and right axis were absent, and Light/Dark retained the exact yellow
  non-scaling line with zero overflow. Light, `6M`, Account top, and closed
  Appearance were restored.
