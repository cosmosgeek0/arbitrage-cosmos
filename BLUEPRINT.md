# BLUEPRINT.md — Cosmos Arbitrage Control Room

Last updated: 2026-07-06  
Permanent role of this file: full product/system/UI blueprint for rebuilding or steering the whole project without old chats.

Read this after `DIRECTOR_RULEBOOK.md`. Engine internals live in `ENGINE.md`.

---

## 1. Product identity

Cosmos Arbitrage Control Room is a private, single-owner Binance account cockpit and engine control system.

It is not a public crypto website. It is not CG Signal Lab. It is not Binance Signal Lab. It is not a Binance clone. It is not a giant chart page. It is not a generic “AI bot” dashboard. It is not a marketing landing page. It is not a place to show all possible Binance services.

It is an operating room for a private trading engine:

- account state,
- capital state,
- strategy scanner state,
- opportunities,
- risk gate,
- execution truth,
- PnL,
- ledger,
- system health.

The first screen should make the owner immediately understand: where is my money, what is the engine seeing, what is actionable, what is blocked, what did the system do, what is the risk, and can I stop everything now.

The product should feel clean, fast, serious, and operator-grade. It can borrow visual craft from Binance, Coinbase, Backpack, Kraken Pro, TradingView, CoinGlass, 1Password, and macOS settings, but it must not become a clone of any of them.

---

## 2. Hard boundaries

No withdrawals. No transfer-out. No bridge. No cash-out. No such UI. No such backend method. No future placeholder.

No frontend Binance keys. No browser key input. No localStorage secrets. No keys in screenshots. No keys in logs. No keys in docs. No keys in GitHub. No keys in prompts.

No autonomous live execution in v0. The engine produces proposals. Risk evaluates. The owner opens a manual ticket. Execution happens only through a guarded, explicit, server-side route.

No fake data. Disconnected account means disconnected UI. Missing permission means missing. No “demo balance” in the real cockpit unless it is clearly marked demo/paper in a separate mode.

No market manipulation tooling. No fake volume, wash trading, spoofing, hidden liquidity games, or deception features.

No public Signal Lab scope creep. The private app may use public market data, but the purpose is account/engine/execution control, not public analytics.

---

## 3. Current factual infrastructure

Target private URL: `https://arbitrage.cosmosgeek.org`.

Cloudflare domain/zone: `cosmosgeek.org`.

Cloudflare Tunnel name: `cosmosgeek-arbitrage`.

Tunnel target: `http://localhost:8601`.

Cloudflare Access app: appears as `arbitrage`, product name `CG Arbitrage` / `Cosmos Arbitrage Control Room`.

Access policy target: allow only `cosmosgeek@proton.me`. Avoid the previously broken `Require Authentication Method = mfa` rule; use application-specific MFA/security-key posture instead.

EC2 intended instance name: `cg-arbitrage-01`.

EC2 runtime path: `/opt/arbitrage-cosmos`.

EC2 user: `ubuntu`.

Mac/local repo intended path: `/Users/cosmosgeek/Desktop/arbitrage-cosmos`.

GitHub repo: `cosmosgeek0/arbitrage-cosmos`.

Remote: `git@github.com:cosmosgeek0/arbitrage-cosmos.git` or HTTPS `https://github.com/cosmosgeek0/arbitrage-cosmos.git`.

The old public Signal Lab URL is `https://radar.cosmosgeek.org`; keep that separate.

The active repo may currently be a restored or relocated copy. Before acting, inspect the actual folder containing `data/`, `server/`, `web/`, `package.json`, and `package-lock.json`.

---

## 4. Trusted baseline and recovery state

The clean Git baseline from old Director memory is `main @ 80c234f`, described as clean and test-passing at that time.

`~/Desktop/Main` was reported as a post-Spark recovery copy with no `.git`; it is not a trusted baseline. It can contain useful unpushed 5.5 UI changes and broken Spark changes. Use it only as reference/diff source, never as the repo of record.

Pre-Spark/post-5.5 visual references were reported as screenshots at `~/Desktop/Screenshot 2026-07-06 at 1.14–1.16*.png` plus one around 4.22 AM. These screenshots represent useful visual direction, not guaranteed safe code.

The correct reconstruction approach is not “replay everything.” It is:

1. Start from clean Git / active repo.
2. Install durable docs.
3. Screenshot current app.
4. Compare to target screenshots.
5. Rebuild skeleton deliberately.
6. Commit after each safe milestone.

---

## 5. System mental model

The system has five layers.

Cockpit: React/Vite web UI. It shows state, lets the owner inspect/approve/configure, and makes the engine’s thinking visible. It is not the brain.

Backend API: Node/TypeScript Express server in the current repo pattern, unless the repo inspection proves otherwise. It serves the UI, REST endpoints, WebSocket updates, account state, risk services, orders services, ledger, and engine snapshots.

Engine/Brain: market data ingestion, rolling features, basis scanner, volume spike scanner, focus manager, proposals, risk pre-evaluation, and event output.

Guard: deterministic risk gate. It rejects with named reasons before any live send.

Hand: executor. It sends Binance orders only after approved order intent, manual confirmation, and risk checks. It does not make strategy decisions.

Memory: SQLite ledger/state database. If it is not in the ledger, it did not happen.

---

## 6. Final information architecture

### Implemented sidebar skeleton (SKELETON PASS 1 — 2026-07-07)

The sidebar source-of-truth (Product Truth Pass, 2026-07-07) — **Settings is NOT a Control page; it is bottom utility**:

- **OVERVIEW** — Dashboard
- **CAPITAL** — Account, Wallets, **Borrow** (Borrow lives with capital, not Market — reverse-basis borrowability is a capital question)
- **MARKET** — Markets
- **ENGINE** — Basis Scanner, Volume Scanner, Opportunities
- **EXECUTION** — Execution (one page, internal tabs: Ticket, Orders, Positions, Fills, PnL)
- **CONTROL** — Risk, Logs, Health (three real operator pages — no Settings)
- **BOTTOM / UTILITY** (`snav-utils`) — News, Calendar, **Settings** (local UI preferences, utility not a brain page)

Control section responsibilities (three operator pages — never merged; Settings is utility, not Control):
- **Risk** — "can anything act?" Execution guard controls only: kill switch, live/paper mode, order/daily-notional/daily-loss/symbol-exposure caps, max open orders/positions, cooldown, order rate, spread/slippage/borrow guards, allowlist/blocklist, dry-run probe, save/reset. No API-key info (→ Account), no local UI prefs (→ Settings), no governance essays. Links to Logs for rejected decisions.
- **Logs** (page id `ledger`, title may stay "Ledger / Logs") — "what happened and why?" Operator audit surface with a severity model (Critical/Warning/Info/Debug); **debug/system-noise (heartbeats, ws.open) is hidden by default** behind a toggle; filters by severity/kind/symbol/text/time/accepted-rejected/group; summary counts; useful selected-event detail. Not a raw spam feed.
- **Health** (page id `system`, title may stay "System Health") — "can we trust the data/system?" Streams, account read/user-stream-or-polling, REST latency, clock drift, rate budget, DB/ledger writable, cache/sync age, last error, engine heartbeat, AWS/CloudShell admin area. State colors: green healthy / amber degraded-or-stale / red broken / gray not-configured.
**Settings** (bottom utility, page id `settings`) — "how does this browser display the cockpit?" **Local UI preferences ONLY**: theme, density, motion, table density, ticker tape, refresh cadence, timezone, currency, basis units, default page, keyboard note, reset local preferences, plus a small "keys are server-only" reminder. No API/security dashboard, no permission map, no session/security center, no risk controls, no source-health table (those live in Account/Health/Risk).

Bottom-right **Sync / Health bubble = the existing `RefreshDock`** (one component, not a separate SyncHub). Fixed bottom-right; hover opens a status micro-panel (browser→server latency, Binance REST latency, live socket, market feed, account sync age, user stream state, clock drift, rate budget, Ledger DB writable, last error); click refreshes + reconnects (`refresh()` → `/api/refresh`) with a smooth spin then green-check/red-cross. Never invents latency (shows "—"/"offline" if unmeasured). The overall colour deliberately excludes the read-only user-stream (`failed` is expected — server polls) so the button isn't perpetually red. It owns detailed refresh/health; the topbar keeps only compact indicators. A standalone `SyncHub` component is NOT used — do not add a second bottom-right bubble.

Earn belongs in Wallets/Capital, not Control: Simple Earn flexible/locked positions are a future read-only Wallets adapter (signed, high request-weight — cache, don't poll aggressively).

Kept below the nav (bottom-left `snav-utils`): News and Calendar full-page tiles (owner restored 2026-07-07 — they coexist with the topbar quick-views).

Removed from the sidebar: Tokens (Token Detail opens from Markets rows / search only) and Rules (folded into Risk as "Rules & governance" section).

Topbar (fixed set — do not add more buttons): search, clock, currency, news quick-view, calendar quick-view, **AWS Runner Control**, network signal, data health, alerts, notifications, kill/power, zoom, settings, theme, account/profile.

Refresh dock: a persistent bottom control (`RefreshDock`) that re-pulls shared state/markets and forces a server-side resync (`POST /api/refresh`), broadcasting a global `fireRefresh` signal so any page can re-pull; it shows connection health with success/fail marks.

Key manifest / permissions: `GET /api/apikey` returns a masked key manifest (fingerprint + first-8 prefix only — never the full key/secret). Per-key scope comes from the authoritative `/sapi/v1/account/apiRestrictions` (client `apiRestrictions()`), which is the real "can this key trade/withdraw" — unlike account-level `canWithdraw`. `state.binance` exposes `keyPermissions` (raw flags) + a derived `keyPosture` (`read_only`/`trading`/`elevated`/`unsafe`, with `ipRestricted`); the fingerprint is first-6 + last-4. The Account page shows the full per-key permission map and posture badge; System Health shows an "API key scope" row. `canTrade`/`canWithdraw` are sourced from the key flags, not account-level.

AWS Runner Control: the wide AWS cloud mark opens a compact control sheet and a large in-app operator workspace through the existing `openOverlay('cloudshell')` route. The server integrates through Systems Manager Run Command; it exposes no browser credentials and no arbitrary remote shell. AWS Channel blocks every website-to-AWS control request. Runner Changes separately blocks file writes, validation, and service restart while allowing read-only status/log operations. Both default closed and are persisted in the ledger. The command map is restricted to `status`, `logs`, `read`, `validate`, `restart`, and `help`; the editor is fixed to `AWS_CONTROL_RUNNER_PATH`, uses optimistic SHA-256 conflict detection plus an atomic backup, caps source size, and rejects obvious secret material. Production mutations require a cryptographically verified Cloudflare Access application JWT (issuer, audience, signature) whose email claim matches the configured operator; identity headers alone are not trusted. The external AWS action opens Systems Manager Session Manager for deeper administration.

### Content responsibilities (8-surface reference)

### 1. Command Center

This is the homepage. It replaces “Dashboard.”

Purpose: immediate operational state.

Must show:
- total equity,
- available USDT,
- spot/futures/margin value if available,
- borrowed amount,
- today PnL,
- open exposure,
- open orders,
- open positions,
- active proposals,
- latest basis signal,
- latest volume signal,
- latest rejection,
- risk state,
- kill switch,
- live/manual/paper mode,
- engine heartbeat,
- account stream state,
- recent ledger events.

Must not show:
- giant BTC chart,
- public market homepage,
- generic token wall,
- random Binance services,
- stale placeholder essays.

Primary actions:
- open opportunities,
- open risk,
- open execution ticket,
- halt/resume if allowed,
- open ledger.

### 2. Capital

Combines old Account and Wallets/Assets.

Purpose: where is the money and what permissions exist.

Sections/tabs:
- Account connection,
- Permissions,
- Spot,
- Cross Margin,
- Isolated Margin,
- USD-M Futures,
- Funding wallet read-only/later,
- API setup checklist.

Must show:
- key status without exposing key,
- read permission status,
- trade permission status,
- withdrawal disabled/unknown,
- IP restriction unknown/verified,
- user stream/polling state,
- total equity,
- available USDT,
- asset, free, locked, borrowed, interest, collateral value, USDT value, strategy-used flag,
- borrowed amount and liabilities if margin exists.

Must not show:
- API key input in browser,
- transfer-out,
- withdrawal,
- consumer Binance services.

### 3. Scanners

Replaces old Strategies as the primary engine surface.

Purpose: show what the engine is scanning and why.

Subsections:
- Basis Scanner,
- Volume Spike Scanner,
- Borrow/Reverse-Basis Preflight,
- Funding context if useful,
- Scanner configuration.

Basis Scanner must show:
- symbol,
- spot bid/ask,
- perp bid/ask,
- executable gap,
- gap direction,
- funding,
- funding-adjusted edge,
- fees/slippage estimate,
- gap age,
- widening/closing,
- spot spread,
- perp spread,
- depth quality,
- borrow needed,
- borrow available,
- max borrow,
- risk status,
- proposal status,
- named reject reason.

Volume Spike Scanner must show:
- symbol,
- current price,
- 1s volume vs baseline,
- 5s volume vs baseline,
- 1m volume vs baseline,
- trade count spike,
- average trade size,
- taker buy/sell aggression,
- spread,
- depth,
- price move,
- focus state,
- proposal/reject reason.

Must not show:
- 10 fake strategy cards,
- “AI bot running” without real engine state,
- market table as the main content if it does not show engine decisions.

### 4. Opportunities

Purpose: proposal queue. This is where scanner output becomes inspectable action.

Each proposal must show:
- strategy,
- symbol,
- direction,
- reason,
- edge,
- basis/funding/volume evidence,
- borrow requirement,
- borrow status,
- spread/depth quality,
- risk decision,
- suggested size,
- reject reason if blocked,
- open manual ticket,
- watch,
- dismiss/reject.

Approve does not send an order. It opens a guarded ticket.

### 5. Execution

Combines Manual Trade, Orders, Positions, Fills, PnL.

Purpose: what the account actually does and what can be manually sent.

Subsections:
- Manual ticket,
- Orders,
- Positions,
- Fills,
- PnL.

Manual ticket must be guarded:
- symbol,
- side,
- order type,
- quantity/notional,
- price,
- time in force,
- preview,
- validate/test order if available,
- typed confirmation,
- send live only when armed and risk-passed.

Orders must show:
- open orders,
- history,
- cancel readiness,
- source manual/strategy,
- status,
- risk link,
- ledger link.

Positions must show:
- spot holdings,
- futures positions if configured,
- margin liabilities,
- entry/cost basis,
- mark/current,
- unrealized/realized PnL,
- funding/borrow exposure.

Fills must show:
- time,
- symbol,
- side,
- price,
- quantity,
- fee,
- fee asset,
- order ID,
- source,
- ledger event.

PnL must show:
- today,
- daily,
- by strategy,
- by symbol,
- realized/unrealized,
- fees,
- funding,
- borrow interest,
- equity curve,
- drawdown.

### 6. Risk

Purpose: the guardrail console.

Must show:
- kill switch,
- live arm/manual-only state,
- max order notional,
- max daily notional,
- max daily loss,
- max open orders,
- max open positions,
- symbol allowlist,
- symbol blocklist,
- cooldown,
- stale data threshold,
- spread limit,
- depth/slippage guard,
- borrow cap,
- close-only mode later,
- last rejects with named reasons,
- gate probe/dry run.

Risk is the only place for risk config. Settings must not duplicate operational risk controls.

### 7. Ledger

Purpose: truth timeline.

Must show:
- all events,
- filters by type,
- filters by symbol,
- filters by strategy,
- decisions,
- orders,
- fills,
- errors,
- config changes,
- system events,
- correlation trace,
- export later if safe.

No raw JSON dumps as primary UI. The ledger can have an inspect panel for payload details.

### 8. System

Combines System Health and Settings.

Purpose: source health, environment health, local UI preferences.

System Health:
- Binance public streams,
- account stream,
- REST latency,
- DB/ledger status,
- engine loop,
- last tick,
- stale data warnings,
- rate limit headers if tracked,
- key presence/permission status without values,
- Cloudflare Access identity header if available,
- app version,
- deployment status.

Settings:
- theme,
- density,
- motion,
- refresh interval,
- default page,
- timezone display,
- basis units,
- table density,
- command palette shortcuts,
- reset local preferences.

No trade/risk operational settings under Settings; those belong under Risk.

---

## 7. Legacy 17-page mapping

Old pages and their destination:

- `Dashboard` → Command Center.
- `Account` → Capital / Account tab.
- `Wallets` or `Wallets / Assets` → Capital / Wallets tab.
- `Markets` → Scanners / Reference Universe or secondary reference page.
- `Token Detail` → Symbol Detail overlay/route from Scanners/Opportunities, not a primary surface unless proven useful.
- `Loans` or `Loans / Borrow` → Scanners / Borrow Preflight and Capital / Margin tabs.
- `ManualTrade` → Execution / Manual Ticket.
- `Orders` → Execution / Orders.
- `Positions` → Execution / Positions.
- `Fills` → Execution / Fills.
- `Pnl` → Execution / PnL.
- `Strategies` → Scanners.
- `Opportunities` → Opportunities.
- `Risk` → Risk.
- `LedgerPage` → Ledger.
- `SystemHealth` → System / Health.
- `Settings` → System / Settings.

The sidebar should not list all 17 by default. The old pages can exist as internal routes during transition, but the product shell should present 8 surfaces.

---

## 8. Visual design rules

The UI should be calm, precise, and information-dense without becoming noisy.

Typography:
- data values are dark/clear, not muted grey,
- labels are small uppercase/muted,
- one hero number per page at most,
- no thick oversized text everywhere,
- no cramped word-soup status lines,
- tabular numbers for tables and metrics.

Spacing:
- use consistent vertical rhythm,
- compact dense data areas,
- no giant blank filler panels,
- no nested boxes for no reason,
- no rows clipped or hidden by sidebars.

Color:
- blue can be the product accent,
- green/red only for up/down or pass/fail states,
- yellow/orange only for warning/pending,
- danger/red used sparingly,
- no neon toy palette,
- light mode must be clean white/near-white,
- dark mode must be checked if available.

Cards:
- use surfaces only where they group meaning,
- avoid boxed-card farms,
- avoid useless KPI tiles,
- do not turn every number into a card,
- do not create button farms.

Buttons:
- primary button only for the main action,
- secondary buttons for real secondary actions,
- disabled buttons must say why,
- no decorative buttons,
- no duplicate actions across the page.

Missing data:
- one compact chip or setup block,
- not a wall of dashes,
- not 20 placeholder cards.

Data:
- show what Binance does not package cleanly: executable basis, funding-adjusted edge, borrowability, risk reason, proposal state, ledger trace, engine heartbeat.
- do not recreate Binance charts/order book as the main value. Secondary chart/order book is okay only when it supports execution or verification.

---

## 9. UI recovery plan from current base

The target is not “make it pretty.” The target is “make it useful and clean enough to support engine work.”

Order:

1. Install docs.
2. Commit docs.
3. Run current app.
4. Screenshot every current page.
5. Load old target screenshots.
6. Write a one-page visual gap report.
7. Skeleton pass: 8 surfaces and sidebar simplification.
8. Page group pass: only critical content stays.
9. Remove duplicate/dead components.
10. Build/test.
11. Commit.
12. Final visual pass with reference images.

Critical removals:
- giant BTC chart as homepage hero,
- Binance trading-terminal clone as primary app structure,
- random service/account buttons that do not execute a distinct needed workflow,
- fake running statuses,
- dead action buttons,
- repeated setup essays,
- dashboards that are just boxes and dashes,
- market pages dominating the app.

Critical additions:
- clear account/capital summary,
- clear scanner decision table,
- clear opportunity queue,
- clear risk rejection reasons,
- clear execution truth,
- clear ledger timeline,
- clear system heartbeat,
- clear kill switch.

---

## 10. Backend/API expectations

The frontend should read backend truth, not invent it.

Expected API groups:

Account:
- connection status,
- permissions,
- balances,
- wallets,
- open orders,
- fills,
- positions,
- account stream state.

Market:
- symbol universe,
- spot/futures availability,
- book ticker state,
- funding/mark,
- depth/quotes for focused symbols.

Engine:
- status,
- scanner status,
- symbol decisions,
- candidates,
- focus list,
- proposals,
- risk decisions,
- latest rejects.

Execution:
- manual preview,
- test/validate order,
- guarded send route,
- cancel route later,
- order/fill sync.

Risk:
- config,
- gate probe,
- allowlist/blocklist,
- kill switch,
- live arm.

Ledger:
- event feed,
- filter/search,
- correlation trace.

System:
- WebSocket health,
- REST latency,
- DB status,
- app version,
- source freshness.

The UI must show backend absence honestly. If an endpoint is missing, the page should show “not wired” and the next setup step, not fake values.

---

## 11. Database and storage

Early state may use `data/cosmos.db` with SQLite and `better-sqlite3`. Preserve `data/cosmos.db*` if present; it can contain ledger/state. Do not delete runtime data unless backed up and explicitly approved.

Do not store every tick forever. Normal mode stores summaries/rolling features. Event/focus mode can store detailed raw windows around triggers.

Suggested persisted categories:
- ledger events,
- proposals,
- risk decisions,
- order intents,
- order events,
- fills,
- account snapshots,
- config changes,
- engine snapshots/features.

---

## 12. Deployment blueprint

Local/dev app:
- expected current stack likely npm workspaces with server + web,
- root `package.json`,
- server in `server/`,
- web in `web/`,
- run commands must be inspected from `package.json`.

Old Director commands if matching repo:
- `npm install`
- `npm test`
- `npm run start`
- `cd web && npx vite --port 5173`
- API health at `http://localhost:8080/api/health`

EC2 deploy target:
- path `/opt/arbitrage-cosmos`,
- service eventually `cg-arbitrage.service`,
- bind to `127.0.0.1:8601`,
- Cloudflare route to `http://localhost:8601`.

Do not assume exact service command until repo inspection. If Node/TS server serves built web, systemd likely runs `node server/dist/index.js` with `PORT=8601` or app-specific env. If another stack exists, use repo docs/package scripts.

Deploy flow:
1. local build/tests pass,
2. Git commit,
3. push to private GitHub,
4. EC2 pull,
5. install deps,
6. build/test on EC2,
7. restart service,
8. `curl -I http://127.0.0.1:8601`,
9. open `https://arbitrage.cosmosgeek.org`,
10. verify Cloudflare Access and app.

---

## 13. Security blueprint

Outer security: Cloudflare Access protects the hostname. That is not enough by itself.

App security:
- no frontend secrets,
- server-side key loading,
- `.env` ignored,
- production secrets preferably AWS Secrets Manager,
- strict CSP/security headers,
- no withdrawal routes,
- no transfer-out routes,
- no broad logs of account/private data,
- no old scripts committed.

Binance key posture:
- start no keys,
- then read-only,
- withdrawals disabled,
- IP-restricted if possible,
- trading permission only when manual execution path is fully tested,
- testnet before real live send.

AI tool boundary:
- agents can write code/tests/docs,
- agents do not get real production secrets,
- agents do not receive AWS root/admin keys,
- agents do not deploy live-money changes without explicit approval,
- agents cannot bypass risk layer.

Machine boundary:
- Mac is clean cockpit,
- Windows is public-data/dirty only,
- high-value secrets stay off Windows.

---

## 14. Acceptance gates

A skeleton milestone is accepted only if:
- root docs exist,
- repo has clean Git status after commit,
- app builds/tests,
- sidebar has 8 clear surfaces or a documented transition state,
- every visible primary page renders,
- no dead buttons without reason,
- no fake data,
- no huge market/chart homepage,
- no console errors in checked pages,
- kill switch visible,
- risk state visible,
- ledger path visible,
- system health path visible.

An engine milestone is accepted only if:
- tests exist,
- no network dependency in unit tests,
- named reject reasons exist,
- ledger event shape exists,
- UI/API can expose engine state,
- no autonomous live send,
- risk path remains required.

A key-integration milestone is accepted only if:
- no secrets in git,
- no frontend key input,
- app works disconnected,
- read-only account sync works with server-side keys,
- risk/execution remains blocked until intentionally armed.

A deploy milestone is accepted only if:
- local tests pass,
- EC2 build/tests pass or documented reason,
- service runs on intended local port,
- Cloudflare hostname loads through Access,
- no secret files pushed.

---

## 15. Permanent roadmap

Current immediate target:
1. install docs,
2. fresh Director no-code survey,
3. commit docs,
4. rebuild UI skeleton into 8 surfaces,
5. recover useful pre-Spark visual quality from screenshots,
6. commit page groups,
7. add read-only account integration server-side,
8. begin Engine v0 planning,
9. build engine modules,
10. connect engine APIs,
11. testnet execution path,
12. tiny manual live only after proof.

Engine-first doctrine:
The cockpit is important, but the edge lives in the engine. Once the skeleton is clean and no longer confusing, stop grinding pixels and build scanner truth.

---

## 16. What to rebuild from zero if lost

If the whole repo disappears, rebuild from these docs and this order:

1. Create npm workspace with `server/` and `web/`.
2. Server: Node 22 + TypeScript + Express + ws + SQLite/better-sqlite3.
3. Web: React 18 + Vite.
4. Create `data/` ignored.
5. Create routes for health, account status, market universe, risk, ledger.
6. Build 8-surface sidebar shell.
7. Implement disconnected states.
8. Implement ledger first.
9. Implement public Binance market data.
10. Implement basis scanner decisions.
11. Implement risk gate.
12. Implement opportunities.
13. Implement manual ticket preview.
14. Add read-only account keys server-side.
15. Add user stream/poll fallback.
16. Add engine v0 modules.
17. Deploy behind Cloudflare Access/Tunnel.

Do not rebuild a public market website first. That repeats the wrong direction.
