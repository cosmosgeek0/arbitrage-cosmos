# PROJECT_CONTEXT.md — Cosmos Arbitrage Control Room

**Project:** Cosmos Arbitrage Control Room  
**Private URL target:** `https://arbitrage.cosmosgeek.org`  
**Purpose:** Private Binance account cockpit, strategy-control interface, engine dashboard, risk console, and eventual manual/live execution surface.  
**Audience:** Fable 5 / Claude Code / Codex agents starting fresh without this long chat.  
**Related file:** `ENGINE_CONTEXT.md` gives the deeper engine design. Read both before writing backend engine code.

---

## 0. Read this first

This project will become complicated quickly. Do not try to build the whole thing in one giant pass.

The correct workflow is:

1. Read `PROJECT_CONTEXT.md`.
2. Read `ENGINE_CONTEXT.md`.
3. Inspect the actual repo.
4. Inspect the existing UI folders/components.
5. Inspect the existing `engine/` folder if it already exists.
6. Produce a module map and build order.
7. Build one small module/file at a time.
8. Add tests for that module.
9. Only after tests pass, move to the next module.
10. Do not silently rewrite unrelated systems.

The user does not want vague dashboards or fake buttons. Every visible control should either work or clearly explain why it is disabled.

The user also does not want the engine hidden behind abstract words. The system must show what it is watching, why it cares, what it rejected, what it proposed, and what happened next.

---

## 1. Product identity

This project is **Cosmos Arbitrage Control Room**.

It is a **private Binance account control room** behind Cloudflare Access.

It is not:

- CG Signal Lab.
- Binance Signal Lab.
- A public market dashboard.
- A Binance clone.
- A Bitcoin chart homepage.
- A generic trading bot marketplace.
- A fake “AI bot” demo.

It is:

- A private account cockpit.
- A Binance account dashboard.
- A manual trading control room.
- A risk console.
- A strategy proposal console.
- A ledger/log/audit system.
- A future execution platform.

The first screen should feel like:

- “This is my account.”
- “This is my available balance.”
- “These are my open orders and positions.”
- “These are my strategy proposals.”
- “These are my risk limits.”
- “This is what the engine is thinking.”
- “This is the kill switch.”

The first screen should not feel like:

- “Here is the crypto market.”
- “Here is a giant BTC chart.”
- “Here are 400 public tickers.”
- “Here is Signal Lab again.”

---

## 2. Relationship to CG Signal Lab

CG Signal Lab / Binance Signal Lab is the public market intelligence product. It is public-data-only. It collects Binance public spot/perp/funding data and displays market/basis/funding intelligence.

Cosmos Arbitrage Control Room is private. It is for account state, strategy state, risk state, manual trading, execution history, and logs.

Signal Lab can be used as a design/component donor only.

Use Signal Lab for:

- Better table styling.
- Better token icon resolver.
- Token detail layout ideas.
- Chart styling ideas.
- Settings drawer ideas.
- Network/source health badge ideas.
- Search/command palette ideas.
- UI polish patterns.

Do not copy Signal Lab’s whole app layout. Do not turn Control Room into Signal Lab.

Signal Lab is public-market intelligence. Control Room is private-account operations.

---

## 3. Relationship to old `end.py`

The old `end.py` was a previous Web3 execution script. It matters as a workflow/safety pattern, not as code to reuse.

Useful lessons from `end.py`:

- Build one working thing first.
- Test tiny first.
- Add features one by one.
- Show visible output/scoreboard.
- Keep safety checks near the executor.
- Parallelism is useful, but sequential handling matters for account/order safety.
- Retry logic matters.
- Nonce/order state matters.
- Logs matter.

Do not import `end.py`.

Do not reuse old secrets.

Do not copy hardcoded keys or wallet automation.

Treat any hardcoded key found in old files as burned.

---

## 4. Current project shape expected

The repo is expected to contain a private web app already started, likely with:

- A UI/frontend folder.
- A backend app/server.
- A left-sidebar control-room layout.
- Pages like Dashboard, Account, Wallets/Assets, Markets, Loans/Borrow, Manual Trade, Orders, Positions, Fills, PnL, Strategies, Opportunities, Risk, Ledger/Logs, System Health, Settings.
- An `engine/` folder already created or planned.

Do not assume exact filenames. Inspect the repo.

The UI is being refined separately by Codex. Fable 5 should focus on project architecture and engine design unless explicitly asked to polish UI.

---

## 5. Important mental model

The app has four layers.

### 5.1 Cockpit

The private web dashboard.

It shows:

- Account state.
- Balances.
- Orders.
- Positions.
- Fills.
- PnL.
- Strategy state.
- Opportunity state.
- Risk state.
- Ledger/logs.
- Manual trade controls.
- Kill switch.

### 5.2 Brain

The engine.

It watches Binance market data, computes features, detects candidates, focuses attention, runs strategies, produces proposals, and logs decisions.

### 5.3 Guard

The risk gate.

It decides whether a proposal can even reach the trade ticket/executor.

### 5.4 Hand

The executor.

It sends orders only after the allowed path. In v0, strategy must not directly auto-place live orders. Strategy creates proposals; user/manual path decides.

### 5.5 Memory

The ledger.

Every meaningful action is stored.

---

## 6. Private app security model

This app is private behind Cloudflare Access.

Cloudflare Access can protect self-hosted private applications by adding an identity/access layer in front of the hostname. Official docs describe creating a self-hosted private application under Zero Trust Access and adding a public hostname owned by the Cloudflare zone.

Reference: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

Cloudflare Access is the outer gate. It is not a replacement for good backend design.

The browser must never hold Binance API keys.

The browser must never sign Binance orders.

The browser talks to this app’s backend.

The backend talks to Binance.

Secrets must be server-side only.

AWS Secrets Manager is the preferred production secret store. AWS docs describe Secrets Manager as a service for managing/retrieving/rotating API keys and credentials, encrypted at rest via KMS and transmitted securely when retrieved.

Reference: https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html  
Reference: https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html

Acceptable secret sources:

- AWS Secrets Manager in production.
- Environment variables in local/dev if not committed.
- Local `.env` only if `.env` is ignored and never staged.

Never commit:

- `.env`.
- API keys.
- Binance secrets.
- AWS keys.
- Cloudflare tokens.
- Private keys.
- Seed phrases.
- Old execution scripts with credentials.

---

## 7. Binance permission model

This app may eventually use live manual execution, but permissions must be disciplined.

Expected Binance API permission setup:

- Reading enabled.
- Spot trading enabled only when intentionally configured.
- Futures trading only if intentionally configured.
- Margin permissions only if intentionally configured.
- Withdrawals disabled.
- Internal transfers disabled unless explicitly needed later.
- IP restriction expected for any key beyond read-only.

Binance API key docs show permissions such as reading, withdrawals, transfers, and note that withdrawal via API requires IP access restriction.

Reference: https://developers.binance.com/docs/wallet/account/api-key-permission

Binance support docs also strongly recommend IP restrictions before enabling permissions beyond reading, and unrestricted keys are limited.

Reference: https://www.binance.com/en-IN/support/faq/detail/360002502072

The app must never include withdrawal UI in v0.

The app must never include transfer-out UI in v0.

---

## 8. Binance data capabilities researched

Fable should verify exact endpoint names before coding. This section is the working map.

### 8.1 Spot public WebSocket

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams

Important facts:

- One Spot WebSocket connection can listen to up to 1024 streams.
- Spot WebSocket has 5 incoming control messages per second limit.
- Connections last up to 24 hours and must reconnect.
- There is a 300 connection-attempts-per-5-minutes-per-IP limit.
- Streams include trade, aggregate trade, kline, mini ticker, ticker, book ticker, partial book depth, diff depth.

Design implication:

- Use WebSockets for live scanning.
- Do not REST-poll every symbol every second.
- Use combined streams.
- Avoid constant subscribe/unsubscribe spam.
- Maintain connection health/reconnect logic.

### 8.2 Spot public REST market data

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints

Useful pieces:

- Exchange info / symbol metadata.
- Order book snapshots.
- Recent trades.
- Aggregate trades.
- Klines/candles.
- 24h ticker.
- Price ticker.
- Book ticker.

Design implication:

- REST is for bootstrapping, metadata, snapshots, occasional backfill.
- WebSocket is for live updates.

### 8.3 Spot user/account data

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream

Useful events:

- Account update when balances change.
- Balance update.
- Order update via `executionReport`.

Design implication:

- Dashboard account state must use user data stream where possible.
- Polling is fallback, not the main state path.

### 8.4 Spot trading/test order

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints

Useful fact:

- Binance has test-order endpoints that validate order creation/signature/recvWindow but do not send the order into the matching engine.

Design implication:

- Manual trade flow should have preview and validation before live send.
- Test-order validation is not “paper trading”; it is signed order validation.

### 8.5 Symbol filters

Docs/reference: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints  
Reference summary: https://www.binance.com/en/academy/articles/binance-api-responses-price-filter-and-percent-price

Important filters:

- PRICE_FILTER.
- LOT_SIZE.
- MIN_NOTIONAL / NOTIONAL.
- Tick size.
- Step size.
- Min/max quantity.
- Min notional.

Design implication:

- Risk/executor must validate filters before order preview/send.
- Manual trade ticket must show min notional, step size, tick size.

### 8.6 Margin / borrow

Official docs: https://developers.binance.com/docs/margin_trading/best-practice  
Official endpoint docs: https://developers.binance.com/docs/margin_trading/borrow-and-repay/Query-Max-Borrow

Useful facts:

- Binance margin has max-borrowable checks.
- Borrow requests can fail if amount exceeds max borrow.
- Cross and isolated margin are separate concepts.

Design implication:

- Reverse-basis logic cannot assume borrow exists.
- Loan/Borrow page must show borrowable assets, max borrow, liabilities, interest/history where available.
- Strategy must reject reverse-basis proposals when borrow inventory/permissions are unavailable.

### 8.7 Futures public streams

Official docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams

Important facts:

- Futures WebSocket connections can listen to up to 1024 streams.
- Futures WebSocket has 10 incoming control messages per second limit.
- Connections last up to 24 hours and must reconnect.
- User data stream is recommended for order/position status during volatile markets.

Design implication:

- Use futures public streams for mark price, funding, futures book ticker, aggregate trades, and depth.
- Do not rely on REST for live futures state.

### 8.8 Futures funding / mark / open interest / sentiment

Useful docs:

- Funding rate history: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History
- Mark price / premium index docs under USD-M futures market data.
- Open interest docs under USD-M futures market data.
- Top trader long/short position/account ratio docs under futures data.
- Taker buy/sell volume docs under futures data.

Design implication:

- Basis strategy should include funding and mark price.
- Dead-volume / pump-detection strategy can use taker buy/sell and open interest as contextual filters where available.
- These are not needed for the first tiny module, but the engine design should leave slots.

### 8.9 Futures user/account data

Official docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams

Useful facts:

- Listen keys need renewal.
- Account and order updates come through the user data stream.
- Binance recommends user data stream with REST endpoints for timeliness and accuracy of positions.

Design implication:

- Account state should reconcile REST snapshots with stream updates.
- Ledger should record stream disconnect/reconnect and stale-account-state warnings.

---

## 9. Product pages and responsibilities

### 9.1 Dashboard

Purpose: account cockpit, not market homepage.

Shows:

- Binance connection state.
- Total equity.
- Available balance.
- Spot wallet value.
- Futures wallet value if configured.
- Margin wallet value if configured.
- Today realized PnL.
- Unrealized PnL.
- Open exposure.
- Open orders.
- Recent fills.
- Strategy state.
- Risk state.
- Manual quick trade.
- System status.
- Event timeline.

Must not show a giant BTC chart as the hero.

### 9.2 Account

Purpose: Binance account connection and permissions.

Shows:

- Connected/disconnected state.
- Read permission status.
- Trade permission status.
- Futures permission status if configured.
- Margin permission status if configured.
- Withdrawal disabled/unknown status.
- IP-restriction status if detectable.
- User data stream status.
- Last account update.

Never show key values.

### 9.3 Wallets / Assets

Shows asset balances across:

- Spot.
- Futures if configured.
- Margin if configured.
- Funding/Earn later only if implemented.

For each asset:

- Icon.
- Asset.
- Free.
- Locked.
- Borrowed/liability if margin.
- Interest if margin.
- Approx USDT value.
- Recent account changes.

### 9.4 Markets

This is not the homepage, but it exists for inspection.

Shows Binance universe:

- Spot status.
- Futures status.
- Margin/borrow status if known.
- Price.
- 24h change.
- Volume.
- Basis if spot+perp exists.
- Funding if futures exists.
- Min notional.
- Tick size.
- Step size.
- Open detail.

### 9.5 Token Detail

Shows everything useful about one symbol/token:

- Large icon.
- Symbol/name.
- Spot price.
- Futures price if exists.
- Basis.
- Funding.
- Spread.
- 24h volume.
- Recent trades.
- Depth/order book.
- Current account balance/exposure for this symbol.
- Open orders for this symbol.
- Recent fills for this symbol.
- Borrowability/max borrow if available.
- Strategy signals for this symbol.
- Risk notes.
- Charts: price, basis, funding, spread, volume, depth.

### 9.6 Loans / Borrow

Important page for reverse-basis logic.

Shows:

- Margin account status.
- Cross margin assets.
- Isolated margin assets.
- Borrowable assets.
- Max borrow by asset.
- Current liabilities.
- Interest/history if available.
- Borrow/repay history if available.
- Reverse-basis candidates requiring borrow.
- Rejections because borrow unavailable.

No borrow/repay execution buttons unless deliberately implemented with confirmation.

### 9.7 Manual Trade

Purpose: visible manual execution ticket.

Fields:

- Symbol.
- Side.
- Order type.
- Quantity.
- Quote amount if supported.
- Limit price if limit.
- Time in force.
- Preview.
- Test/validate.
- Send live.

Send live requirements:

- Kill switch off.
- Live manual mode enabled.
- Risk pass.
- Confirmation modal.
- Exact symbol/side/type/qty/notional shown.
- User explicitly confirms.
- Ledger records intent/request/response.

### 9.8 Orders

Shows:

- Open orders.
- Order history.
- Cancel order.
- Cancel all for symbol later if implemented.
- Status.
- Source: manual/strategy.
- Risk decision link.
- Ledger link.

### 9.9 Positions

Shows:

- Spot holdings.
- Futures positions if configured.
- Margin liabilities if configured.
- Entry.
- Mark/current price.
- Unrealized PnL.
- Liquidation data if available.
- Basis/funding exposure.
- Time open.

### 9.10 Fills

Shows trade execution history:

- Symbol.
- Side.
- Price.
- Quantity.
- Fee.
- Fee asset.
- Order ID.
- Manual/strategy source.
- Time.

### 9.11 PnL

Shows:

- Daily PnL.
- Equity curve.
- Realized/unrealized PnL.
- Fees.
- Funding paid/received.
- Borrow interest.
- PnL by strategy.
- PnL by symbol.
- Drawdown.

### 9.12 Strategies

Shows strategy modules:

- Basis monitor.
- Dead-volume activation.
- Borrow/reverse-basis monitor.
- Funding monitor.

Each strategy shows:

- Running/paused.
- Manual-only/live-capable state.
- Symbols watched.
- Current candidates.
- Last signal.
- Accepted/rejected proposals.
- Reasons.
- Config.
- Ledger/event history.

### 9.13 Opportunities

Shows strategy proposals.

Each opportunity:

- Symbol.
- Strategy.
- Reason.
- Basis.
- Funding.
- Borrow needed.
- Borrow available.
- Spread.
- Depth score.
- Estimated edge.
- Confidence.
- Risk decision.
- Open trade ticket.
- Reject/watch actions.

### 9.14 Risk

Shows:

- Kill switch.
- Live manual enabled/disabled.
- Max notional per order.
- Max daily notional.
- Max daily loss.
- Max open orders.
- Allowed symbols.
- Blocked symbols.
- Cooldown.
- Spread max.
- Depth minimum.
- Stale data max.
- Close-only mode later.

Every risk rejection must produce a visible reason.

### 9.15 Ledger / Logs

Full audit log.

Shows:

- Account snapshots.
- Balance updates.
- User stream events.
- Strategy signals.
- Risk decisions.
- Order intents.
- Order requests.
- Order responses.
- Fills.
- Cancels.
- Errors.
- Config changes.
- Manual actions.
- System heartbeats.
- WebSocket reconnects.

Search/filter by:

- Event type.
- Symbol.
- Strategy.
- Time.
- Status.
- Accepted/rejected.
- Manual/system.

### 9.16 System Health

Shows:

- Binance public market WebSocket status.
- Binance account/user stream status.
- REST API latency.
- Server time sync.
- Rate limit state if tracked.
- Last account call.
- Last order call.
- Last market tick.
- Database status.
- Ledger write status.
- Strategy loop status.
- Risk engine status.
- Executor status.
- Cloudflare Access user header if available.
- App version.
- Environment.

### 9.17 Settings

Settings include:

- Theme.
- Motion.
- Refresh rate.
- Default page.
- Time zone.
- Currency.
- Basis units.
- Table density.
- Chart type.
- Default token-detail tab.
- Strategy defaults.
- Risk defaults.
- Source visibility.
- Reset preferences.

Persist local UI preferences.

---

## 10. Engine summary

The deeper engine details live in `ENGINE_CONTEXT.md`.

Short version:

The engine should be one long-running backend service, split into many modules.

Do not make one giant file.

Do not make 50 microservices on day one.

One process, modular files:

- `engine/runner.py` starts everything.
- `engine/config.py` loads safe config.
- `engine/binance_public.py` handles public market streams/snapshots.
- `engine/binance_account.py` handles signed account data if keys exist.
- `engine/state.py` keeps in-memory symbol/account state.
- `engine/features.py` computes volume, basis, spread, staleness, depth scores.
- `engine/focus.py` promotes symbols into focus mode.
- `engine/strategies/basis.py` creates spot/perp basis proposals.
- `engine/strategies/volume_spike.py` creates dead-volume activation proposals.
- `engine/risk.py` accepts/rejects proposals.
- `engine/executor.py` previews/validates/sends manual orders only after risk path.
- `engine/ledger.py` persists events.
- `engine/api.py` exposes state/proposals/logs to UI.

Build one file/module at a time.

---

## 11. Strategy summary

### 11.1 Basis strategy

Goal:

Find executable spot/perp gaps after fees, spreads, slippage, funding, staleness, and borrow constraints.

Use bid/ask, not last price.

Cases:

- Perp above spot: possible buy spot + short perp structure.
- Spot above perp: reverse structure usually needs borrow; must verify max borrow and borrow cost.

Proposal should include:

- Symbol.
- Direction.
- Spot bid/ask.
- Futures bid/ask.
- Executable gap.
- Funding.
- Spread.
- Depth estimate.
- Fees/slippage estimate.
- Borrow needed yes/no.
- Borrow available yes/no.
- Confidence.
- Reason.
- Risk result.

### 11.2 Dead-volume activation strategy

Goal:

Find quiet symbols that suddenly wake up before the obvious public candle.

Use rolling baselines:

- 1-second volume.
- 5-second volume.
- 1-minute volume.
- Trade count.
- Average trade size.
- Spread.
- Price velocity.
- Volatility.

Candidate triggers:

- Current volume many times baseline.
- Trade count jumps.
- Price starts moving.
- Spread still acceptable.
- Taker imbalance appears.
- Book depth is not useless.

Do not instantly treat one print as a valid buy.

Use stages:

- Normal.
- Warming.
- Focus.
- Proposal.
- Risk accepted/rejected.
- Manual ticket.

### 11.3 Focus mode

Do not deep-track all symbols equally.

All symbols get light monitoring.

Candidates get focus mode.

Focused symbols get deeper data:

- Depth.
- AggTrades.
- Order book imbalance.
- Spread.
- Slippage estimate.
- Basis movement.
- Funding.
- Open interest if available.
- Taker buy/sell if available.
- Borrow availability if needed.

---

## 12. Storage model

Use layers.

### In memory

Fast rolling state:

- Current price.
- Current book ticker.
- Rolling 1s/5s/1m/5m volume.
- Trade count.
- Candidate state.
- Focus state.
- Latest basis/funding.

### SQLite/Postgres database

Persistent summaries:

- 1-second feature snapshots.
- Strategy signals.
- Risk decisions.
- Order intents.
- Order responses.
- Fills.
- Ledger events.
- Config changes.

SQLite is okay for early v0 if app is single-host. Postgres/Timescale can come later if write volume grows.

### Raw event storage

Do not store raw tick/trade/depth for every symbol forever.

Store raw detail only around triggers/focus windows.

Example:

- 10 minutes before/after a trigger if available.
- Full detail for active/focused symbols.
- Compressed summaries for the rest.

---

## 13. Agent workflow

### Fable 5 / Claude Code

Use for:

- Architecture.
- Engine modules.
- Big backend structures.
- Strategy/risk/ledger design.
- Module-by-module implementation.

Do not use it for long repetitive page-by-page CSS grind unless needed.

### Codex

Use for:

- UI refinements.
- Page-by-page polish.
- Test audits.
- Browser click audits.
- Repo hygiene.
- Commit/push/deploy discipline.
- Security scans.

### Integration rule

If multiple agents run in parallel, do not use the same folder.

Use Git worktrees.

Git officially supports multiple working trees from one repository, and Claude Code docs recommend separate worktrees so parallel sessions do not touch the same files.

Reference: https://git-scm.com/docs/git-worktree  
Reference: https://code.claude.com/docs/en/worktrees

Suggested worktrees:

- `control-main` integration.
- `control-ui-dashboard` dashboard/account/wallets/loans.
- `control-ui-trading` manual trade/orders/positions/fills/PnL.
- `control-ui-system` strategies/opportunities/risk/ledger/system/settings.
- `control-engine-v0` engine modules.

Only one integration pass merges branches back.

Only one branch should own global design tokens/theme.

---

## 14. Project build order

Do not ask Fable to build everything at once.

### Step 0 — Survey only

First prompt should be:

“Read PROJECT_CONTEXT.md and ENGINE_CONTEXT.md. Inspect repo. Do not code. Produce module map, current file map, missing files, and build order.”

### Step 1 — Context/docs inside repo

Ensure repo contains:

- `PROJECT_CONTEXT.md`.
- `ENGINE_CONTEXT.md`.
- maybe `DESIGN_CONTEXT.md`.
- maybe `DEPLOY_CONTEXT.md`.

### Step 2 — Engine config and types

Build config, environment handling, core dataclasses/schemas, enums, status types.

No Binance calls yet.

### Step 3 — Ledger

Build ledger first or very early.

Reason: every later system must be observable.

### Step 4 — Binance public metadata

Exchange info, spot/futures symbol universe, filters, precision, min notional, pairs.

### Step 5 — Market data engine skeleton

WebSocket connector shell, reconnect, state updates, testable mock input.

### Step 6 — Feature engine

Rolling windows, basis, spread, staleness, volume baselines.

### Step 7 — Focus manager

Promote/demote symbols based on feature triggers.

### Step 8 — Strategies

Start with basis and dead-volume strategies.

They create proposals only.

### Step 9 — Risk gate

Run proposals through risk checks.

### Step 10 — API endpoints

Expose engine status, candidates, proposals, ledger, symbol features to UI.

### Step 11 — Account read-only

If keys are configured safely, read balances/open orders/fills/account state.

If not configured, show disconnected state.

### Step 12 — Manual trade preview/test-order

Build preview and validation path.

Live send only later and only through explicit manual confirmation.

### Step 13 — Execution path

Manual-only execution path.

No autonomous strategy execution in v0.

---

## 15. First Fable 5 prompt should not ask for code

The first prompt to Fable 5 should only ask it to read and plan.

Use this:

“Read PROJECT_CONTEXT.md and ENGINE_CONTEXT.md fully. Inspect the repo, especially the existing UI folders, API/server files, and engine/ folder. Do not write code yet. Produce the module map, current repo map, exact build order, and the first module to implement. Identify where the UI expects engine APIs, where Binance keys should be loaded server-side, and which files must not be touched.”

Only after that should it implement the first module.

---

## 16. Safety and execution boundaries

Live manual execution is in scope for this private project.

Autonomous strategy execution is not v0.

The correct v0 flow:

Strategy finds candidate.
Risk gate evaluates.
Proposal appears in UI.
User opens manual trade ticket.
User previews.
User validates/test-orders if available.
User confirms.
Executor sends.
Ledger records.
User data stream confirms.

The v0 strategy must not directly fire live orders.

The executor must not bypass risk.

The kill switch must block live sends.

No withdrawals.

No transfer-out UI.

No fake volume/wash trading/manipulation tooling.

No hidden automation that uses funds without a visible state.

---

## 17. Tests and acceptance gates

Every module should have tests.

Minimum tests:

- Config loads without secrets.
- Ledger writes/reads events.
- Symbol filters parse.
- Rolling volume updates correctly.
- Basis calculation uses bid/ask.
- Stale data rejects basis.
- Wide spread rejects basis.
- Borrow-needed proposal rejects if borrow unavailable.
- Dead-volume spike enters focus mode.
- Fake one-tick spike can be rejected by persistence rules.
- Kill switch blocks order path.
- Manual trade preview respects min notional/step size/tick size.
- User data event updates account state.
- API endpoint returns engine status.
- UI pages do not blank.

Acceptance gates:

- App boots.
- No secrets in frontend.
- No `.env` staged.
- No old `end.py` committed.
- Every sidebar page renders.
- Manual trade cannot bypass risk.
- Kill switch works.
- Ledger records all major events.
- Engine status visible.
- Strategy proposals explain themselves.
- Tests pass.
- Browser console clean.

---

## 18. Deployment and runtime context

The exact production details for this private app may differ from CG Signal Lab. Do not assume `radar.cosmosgeek.org` settings.

Known target:

- Private hostname: `arbitrage.cosmosgeek.org`.
- Protected by Cloudflare Access.
- EC2 already prepared or being prepared in another chat.
- GitHub repo likely private.
- Binance API keys should live server-side only.
- Production should eventually use AWS Secrets Manager.

If exact EC2 path, systemd service names, or deploy commands are unknown, ask user or inspect docs in repo. Do not invent.

Recommended service split later:

- Web/API service.
- Engine service.
- Optional worker/collector service.

For v0, one app process plus background engine task is acceptable if clearly structured.

For serious money later, split engine/executor into dedicated service.

---

## 19. Git and deployment discipline

Use private GitHub only.

Do not push secrets.

Use `.gitignore` for:

- `.env`.
- `.venv`.
- `data/`.
- SQLite runtime DB.
- cache files.
- tarballs/zips.
- screenshots unless explicitly needed.
- old historical executor files.

Use Git worktrees for parallel agents.

Use a clean integration branch.

Use Codex as release manager:

- Inspect diff.
- Run safety scan.
- Run tests.
- Browser check.
- Commit.
- Push.
- Deploy only via established deploy path.

GitHub deploy keys can give a server read-only access to a single repository; GitHub docs describe deploy keys as SSH keys attached to one repository, with the private key staying on the server.

Reference: https://docs.github.com/en/rest/deploy-keys/deploy-keys

---

## 20. UI direction summary

The UI must remain a control room.

Do not let UI agents make it a public market dashboard.

The left sidebar is correct for this product.

Dashboard = account cockpit.

Markets = secondary inspection page.

Token Detail = deep view.

Manual Trade = clear execution ticket.

Risk = visible guardrails.

Ledger/Logs = truth.

System Health = Binance/API/engine status.

Settings = preferences/config.

Visual reference categories:

- Binance account/trading controls for account/order structure.
- Coinbase for clean account/asset surfaces.
- Backpack for compact trading controls.
- Ledger/MetaMask for private account/asset cockpit feel.
- Signal Lab for token tables/charts/icons/settings only.

---

## 21. What Fable should not do

Do not:

- Build a public market homepage.
- Build a giant BTC chart homepage.
- Show all 400 symbols on dashboard.
- Turn this into Signal Lab.
- Put Binance keys in frontend.
- Commit `.env`.
- Add withdrawal UI.
- Add transfer-out UI.
- Build autonomous live execution in v0.
- Put strategy direct-to-order path in v0.
- Store raw ticks for every symbol forever.
- Use REST polling for every symbol every second.
- Add fake AI strategy labels.
- Use fake data without labeling.
- Hide risk decisions.
- Hide rejected proposals.
- Skip ledger.

---

## 22. What Fable should do first

First response after reading this should be a plan, not code.

It should produce:

- Current repo map.
- Existing UI/API map.
- Existing engine folder map.
- Proposed module/file map.
- Missing docs/config.
- First module to implement.
- Test plan for first module.
- List of files it will not touch.

Then, when asked, implement one file/module at a time.

---

## 23. Source list for Fable to verify before coding

Fable should open and verify these before using endpoint names:

Binance Spot WebSocket streams:  
https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams

Binance Spot REST market data:  
https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints

Binance Spot user data stream:  
https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream

Binance Spot trading endpoints / test order:  
https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints

Binance API key permissions:  
https://developers.binance.com/docs/wallet/account/api-key-permission

Binance API key IP restriction/support FAQ:  
https://www.binance.com/en-IN/support/faq/detail/360002502072

Binance margin best practice / max borrow:  
https://developers.binance.com/docs/margin_trading/best-practice

Binance margin borrow/repay max borrow:  
https://developers.binance.com/docs/margin_trading/borrow-and-repay/Query-Max-Borrow

Binance USD-M futures WebSocket streams:  
https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams

Binance futures user data streams:  
https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams

Binance futures funding history:  
https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History

Cloudflare Access self-hosted private app:  
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

AWS Secrets Manager overview:  
https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html

AWS Secrets Manager best practices:  
https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html

Git worktree docs:  
https://git-scm.com/docs/git-worktree

Claude Code worktree docs:  
https://code.claude.com/docs/en/worktrees

GitHub deploy keys:  
https://docs.github.com/en/rest/deploy-keys/deploy-keys

---

## 24. One-sentence mission

Build Cosmos Arbitrage Control Room as a private Binance account cockpit where a modular engine watches public/account data, creates explainable opportunities, passes everything through a visible risk gate, records everything in a ledger, and exposes a clean UI for manual control and future disciplined execution.

