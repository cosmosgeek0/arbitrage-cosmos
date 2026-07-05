# ENGINE_CONTEXT.md — Cosmos Arbitrage Control Room Engine

**Project:** Cosmos Arbitrage Control Room  
**Private URL target:** `arbitrage.cosmosgeek.org`  
**Purpose:** This file gives Fable 5 / Claude Code the full engine context before writing backend engine code. The UI/control room exists or is being refined separately. The engine is the brain behind the cockpit.

---

## 0. How this file should be used

Read this file before writing engine code.

Do not build the whole engine in one giant attempt. This project will get complex quickly. Build it as many small parts, one file or module at a time, with tests after each part.

The correct flow is:

1. Read this file.
2. Inspect the repo and current UI/API folders.
3. Inspect the existing `engine/` folder if it already exists.
4. Do not touch UI unless explicitly asked.
5. Propose the engine file map.
6. Build one module at a time.
7. Add tests for that module.
8. Only after module tests pass, move to the next module.

The user does not want another fake dashboard. The UI is the cockpit. The engine is the actual brain. The engine must explain what it is watching, why it cares, why it rejected something, and what it would propose.

---

## 1. Product identity

This project is **not** CG Signal Lab.

CG Signal Lab / Binance Signal Lab is the public market intelligence dashboard. It is public-data only and exists separately.

This project is **Cosmos Arbitrage Control Room**.

It is a private Binance account control room behind Cloudflare Access. It is intended to show the user account state, strategy state, opportunity state, risk state, orders, positions, fills, PnL, logs, and eventual manual execution controls.

The UI should feel like a serious private account cockpit. The engine should behave like a disciplined market-data and strategy system, not a random bot.

---

## 2. Existing context from prior project

The old public Signal Lab proved the value of:

- Binance public spot/perp/funding data collection.
- Fast background cache instead of slow browser-driven DB scans.
- Basis/funding/radar-style market views.
- Token detail pages, charts, icons, table sorting, filters, and visual inspection.

But Signal Lab is not the engine and should not be copied as the private account product.

The old `end.py` from a previous Web3 project matters only as a historical workflow/safety pattern:

- Start with one working thing.
- Test small.
- Add features one by one.
- Make state visible.
- Keep a visible scoreboard/output.
- Keep safety checks close to the executor.
- Parallelism is useful, but per-account/per-wallet operations were sequential/nonce-safe.
- It contained a hardcoded Alchemy key, so never repeat that mistake.

Do not import `end.py`. Do not reuse its secrets. Do not rebuild fake-volume/wash-trading tooling. Use only the engineering pattern of: small working loops, visible output, safety checks, ledger, and incremental growth.

---

## 3. Core product distinction

**UI cockpit:**

Shows what is happening. Lets the user inspect, approve, pause, configure, and understand.

**Engine brain:**

Collects data, computes features, detects candidates, focuses attention, creates strategy proposals, runs risk checks, records ledger events, and exposes clean APIs to the cockpit.

The browser must never become the brain.

The browser must never hold Binance API keys.

The browser must never talk directly to Binance signed endpoints.

The backend/engine talks to Binance. The UI talks to the backend.

---

## 4. Engineering goal

Build an engine that can eventually answer these questions in real time:

- Which Binance symbols are quiet/dead right now?
- Which symbols suddenly woke up?
- Which symbols have abnormal 1-second, 5-second, 1-minute, or 5-minute volume?
- Which symbols have spot/perp basis opening or closing?
- Which symbols have funding pressure that helps or hurts the edge?
- Which symbols have acceptable spread and depth?
- Which symbols are borrowable for reverse-basis logic?
- Which signals are real enough to enter focus mode?
- Which proposals survive risk checks?
- Which proposals are rejected, and why?
- What did the engine see before a pump/dump?
- What did the engine miss?
- What did the account do?
- What is the current risk state?

The first engine must be built for understanding and proposals. Live/manual execution can be wired later, but the executor interface and risk path should be designed from the start.

---

## 5. Current practical reality

The user is iterating with AI agents. Codex is being used for UI polish and repetitive cleanup. Fable 5 / Claude Code should be used for deeper architecture and engine modules.

This file is intended to reduce prompt waste. A new Fable 5 chat should be able to read this and know the engine shape.

Do not assume the agent has chat history.

Do not assume the agent knows previous angry descriptions.

This file is the compact context source for the engine.

---

## 6. External research summary — Binance data capabilities

Fable should still open the docs and verify exact endpoint names before coding. This section is the researched map.

### Spot WebSocket

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams

Important facts:

- A single Spot WebSocket connection can listen to up to 1024 streams.
- Spot WebSocket has a limit of 5 incoming control messages per second.
- Connections last up to 24 hours and must reconnect.
- There is a 300 connection-attempts-per-5-minutes-per-IP limit.
- Streams include trades, aggregate trades, klines, book ticker, partial book depth, diff depth, and all-market ticker-style streams.

Design implication:

Use WebSocket for live market scanning. Do not REST-poll every symbol every second. Use combined streams. Avoid constant subscribe/unsubscribe spam. Group streams carefully.

### Spot REST market data

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints

Useful pieces:

- Exchange info / symbol filters.
- Order book snapshots.
- Recent trades.
- Aggregate trades.
- Klines/candles.
- 24h tickers.
- Price ticker.
- Book ticker.

Design implication:

Use REST for snapshots, metadata, bootstrapping, and occasional backfill. Use WebSocket for live updates.

### Binance market-data-only endpoint

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only

Binance has market-data-only URLs that do not require authentication and serve public market data.

Design implication:

Public market feeds should not require keys. Signed keys are only for account/order/margin actions.

### Futures WebSocket

Official docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams

Important facts:

- USD-M futures WebSocket connections can listen to up to 1024 streams.
- Futures WebSocket control limit is 10 incoming messages per second.
- Connections last up to 24 hours.
- Binance recommends user data streams for order/position status during volatile markets.

Design implication:

Use futures public streams for mark price, funding, futures book ticker, aggregate trades, and depth. Use user data streams for account/order reality later.

### Mark price and funding stream

Official docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Mark-Price-Stream

Mark price and funding can be pushed every 3 seconds or every 1 second.

Design implication:

Funding data does not need millisecond treatment, but 1-second/3-second futures mark/funding updates are enough for strategy scoring.

### Funding history

Official docs: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History

Funding history can be queried, with recent records returned if no time range is sent.

Design implication:

Use funding history for context. The engine should know whether current funding is normal/extreme compared to recent history.

### Futures trading data: long/short, open interest, taker buy/sell

Official docs examples:

- Open interest statistics: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics
- Long/short ratio: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio
- Top trader long/short ratio: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Top-Trader-Long-Short-Ratio
- Taker buy/sell volume: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Taker-BuySell-Volume

Design implication:

These are not every-second feeds for all symbols. They are context enrichers, usually lower-frequency. They help answer: Is futures interest expanding? Are top traders crowded long/short? Is taker pressure one-sided? Use cache and slow polling.

### Margin borrow / loan capability

Official docs:

- Margin best practice: https://developers.binance.com/docs/margin_trading/best-practice
- Max borrowable: https://developers.binance.com/docs/margin_trading/borrow-and-repay/Query-Max-Borrow

Design implication:

Reverse-basis trades depend on borrowability. If spot is high and perp is low, the neutral construction may require borrowing the asset, selling spot, and going long perp. If max borrowable is zero, that signal is not executable. Borrow inventory, borrow cost, interest, margin state, and account permissions matter.

### Spot account/user data

Official docs:

- Spot account endpoints: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints
- Spot user data stream: https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream

Useful events include balance/account changes and order execution updates.

Design implication:

The ledger should listen to account/user streams once private keys are configured. Do not depend only on polling for account state.

### Futures account/user data

Official docs:

- USD-M futures user data stream: https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams
- Order update event: https://developers.binance.com/docs/derivatives/usds-margined-futures/user-data-streams/Event-Order-Update

Futures user events include account and order updates. Same event type messages have ordering guarantees on the user stream.

Design implication:

For live/futures account state, use user streams to reconcile real fills, orders, positions, margin, and balances.

### Trading endpoints and test order

Official docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints

The trading endpoints support new orders, cancel orders, open orders, and test-order validation.

Design implication:

Executor must be isolated. Strategy never directly sends orders. Order filters from exchange info must be checked before sending: min notional, tick size, step size, precision, allowed order types.

---

## 7. What the engine is not

The engine is not a random AI agent.

The engine is not a Binance clone.

The engine is not a chart pattern bot.

The engine is not a gambling script.

The engine is not a market manipulation system.

The engine must not fake volume, wash trade, spoof orders, or attempt to manipulate markets.

The engine is a disciplined event-driven market scanner and proposal generator with risk gates and ledger memory.

---

## 8. High-level architecture

Use one long-running service, split into modules.

One process is okay at the beginning. One giant file is not okay.

Target module structure:

- `engine/__init__.py`
- `engine/config.py`
- `engine/models.py`
- `engine/clock.py`
- `engine/logging_utils.py`
- `engine/binance_universe.py`
- `engine/binance_public.py`
- `engine/binance_private.py`
- `engine/streams.py`
- `engine/state.py`
- `engine/rolling.py`
- `engine/features.py`
- `engine/focus.py`
- `engine/strategies/__init__.py`
- `engine/strategies/basis.py`
- `engine/strategies/dead_volume.py`
- `engine/strategies/funding.py`
- `engine/risk.py`
- `engine/executor.py`
- `engine/ledger.py`
- `engine/api.py`
- `engine/runner.py`
- `engine/replay.py`
- `tests/test_engine_*.py`

If the existing repo has a different convention, adapt the names, but preserve the boundaries.

---

## 9. Engine data flow

The system should flow like this:

Binance public data enters.

Universe state updates.

Rolling features update.

Candidate detector checks all symbols lightly.

Focus manager promotes interesting symbols.

Focused symbols receive deeper streams and richer calculations.

Strategy modules create proposals.

Risk engine approves/rejects proposals.

Approved proposals appear in the dashboard.

Manual trade ticket can be opened from proposal.

Executor sends only if explicitly allowed by live/manual path.

Ledger records everything.

Dashboard API exposes current state.

---

## 10. The attention model

Do not deep-monitor every symbol equally.

Use levels.

### Level 0 — Universe scanner

All symbols get lightweight monitoring.

Fields:

- symbol
- base asset
- quote asset
- spot exists
- perp exists
- margin/borrow possible if known
- last spot price
- last futures price
- spot bid/ask
- futures bid/ask
- 24h volume
- 1s volume
- 5s volume
- 1m volume
- trade count
- spread
- basis
- funding
- mark price
- age/staleness
- status

Goal:

Cheaply detect “normal” vs “interesting.”

### Level 1 — Candidate

A symbol becomes candidate when one or more abnormal conditions appear:

- dead-volume activation
- basis opening
- basis widening quickly
- funding extreme
- spread remains tradable
- price acceleration
- trade count expansion
- futures open interest context becomes interesting

Goal:

Promote only candidates into stronger scrutiny.

### Level 2 — Focus mode

Focused symbols get deeper monitoring.

Fields:

- spot depth / book imbalance
- futures depth / book imbalance
- aggregate trades
- recent trade bursts
- large trade detection
- taker buy/sell inference
- spot/perp book quality
- slippage estimate
- price slope
- basis slope
- funding context
- open interest context
- long/short context if available
- borrow availability if needed

Goal:

Decide whether the signal is real enough to create a proposal.

### Level 3 — Proposal

A strategy produces a structured proposal.

Fields:

- strategy id
- symbol
- direction
- entry idea
- exit idea
- basis
- funding
- spread
- depth score
- volume score
- borrow state
- estimated fees
- estimated slippage
- expected edge
- confidence
- invalidation reason
- suggested size
- risk result
- timestamp

Goal:

The proposal can be inspected and manually acted on.

### Level 4 — Active order / position

If eventually executed, active symbols require strict monitoring.

Fields:

- order state
- fill state
- partial fill state
- position state
- unrealized PnL
- current exit edge
- stop condition
- funding exposure
- borrow exposure
- time in trade

Goal:

Never lose state of a live position.

---

## 11. Strategy A — Spot/perp basis monitor

This is the cleaner first strategy.

It watches symbols that have both spot and perpetual futures.

The strategy must calculate executable basis, not chart/last-price basis.

### Perp above spot

Possible construction:

- buy spot at spot ask
- short perpetual at futures bid

Executable basis estimate:

`perp_bid - spot_ask`, divided by spot ask, converted to bps or percent.

Need to subtract/consider:

- spot trading fee
- futures trading fee
- spread
- estimated slippage
- funding over expected hold time
- data staleness
- depth available at intended size
- partial-fill risk

### Spot above perp

This is harder.

Possible neutral construction often requires:

- borrow asset
- sell spot at spot bid
- long perpetual at futures ask

Executable reverse basis estimate:

`spot_bid - perp_ask`, divided by perp ask, converted to bps or percent.

Need to check:

- borrow exists
- max borrowable amount
- borrow interest/cost
- margin account state
- liquidation/margin risk
- spot liquidity
- futures liquidity
- funding
- fees/slippage

If borrow is unavailable, reverse-basis proposal should be rejected or marked non-executable.

### Basis signal stages

Stage 0: no signal.

Stage 1: visible basis gap.

Stage 2: gap exceeds fees/slippage threshold.

Stage 3: gap persists for N seconds.

Stage 4: focus mode begins.

Stage 5: book/depth/funding/borrow checks pass.

Stage 6: proposal created.

Stage 7: risk gate approves/rejects.

Stage 8: dashboard shows proposal.

### Basis strategy should log

- symbol
- spot bid/ask
- futures bid/ask
- raw basis
- executable basis
- funding
- fees estimate
- slippage estimate
- borrow required yes/no
- borrow available yes/no/unknown
- decision
- reason

---

## 12. Strategy B — Dead-volume activation monitor

This is the aggressive scanner.

The goal is to detect quiet Binance symbols that suddenly wake up before they become obvious on 1m/5m charts.

The engine should not simply buy because volume jumped.

It should detect, focus, verify, propose.

### Define “dead”

A symbol is dead or quiet when:

- recent 1s/5s/1m volume is low relative to its own history
- trade count is low
- price range is flat
- candles have gaps or flat periods
- spread may be wider but not untradeable
- volatility baseline is low

This must be per-symbol. Do not compare small alts to BTC directly.

### Maintain rolling baselines

For every symbol, keep rolling stats:

- 1-second quote volume
- 5-second quote volume
- 15-second quote volume
- 1-minute quote volume
- 5-minute quote volume
- trade count per second
- average trade size
- taker buy/sell imbalance estimate
- price change 1s/5s/15s/1m
- spread
- volatility
- last update age

### Activation triggers

A symbol may enter candidate/focus when:

- 1s quote volume is much higher than normal
- 5s quote volume confirms continuation
- trade count rises, not just one tiny print
- price begins to move
- spread remains tradable
- book depth is not instantly vanishing
- aggressive taker side is one-sided
- move is not already too late

### Fake spike filters

Reject or downgrade if:

- one isolated trade with no follow-through
- spread too wide
- price instantly mean-reverts
- depth disappears
- volume is wash-looking/noisy but not executable
- data is stale
- symbol has known restrictions or bad liquidity

### Output

Dead-volume strategy should produce a proposal only after focus confirmation.

Proposal fields:

- symbol
- baseline volume
- current 1s/5s/1m volume
- volume multiple
- trade count multiple
- price acceleration
- taker imbalance
- spread
- depth score
- signal age
- reason
- suggested size
- invalidation condition

---

## 13. Focus manager

Focus manager is crucial.

It prevents the engine from trying to deep-watch everything.

The focus manager decides:

- which symbols are hot
- which symbols get depth/trade streams
- which symbols get richer REST/context calls
- which symbols should expire from focus
- which symbols should remain under active monitoring

### Focus entry reasons

- basis gap opens
- volume spike
- funding extreme
- price acceleration
- open interest expansion
- user manually pins symbol
- position/open order exists

### Focus exit reasons

- signal expired
- gap closed
- volume returned to baseline
- spread too wide
- no follow-through
- rejected by risk
- max focus time reached

### Focus limits

Use caps.

Example:

- max 10 active focus symbols by default
- max 25 hard cap
- active positions always stay focused
- manually pinned symbols can reserve slots

Do not make focus unlimited.

---

## 14. Feature engine

The feature engine turns raw events into useful metrics.

It should calculate:

### Price and spread

- last trade price
- spot best bid/ask
- futures best bid/ask
- spot mid
- futures mid
- spread bps
- age/staleness

### Basis

- spot_to_perp executable basis
- perp_to_spot executable basis
- mid basis only as secondary display
- basis slope
- basis persistence duration
- basis percentile vs recent history

### Funding

- current funding
- predicted/next funding if available
- time to funding
- funding history context
- funding percentile
- funding cost over expected hold

### Volume

- quote volume per 1s/5s/15s/1m/5m
- rolling mean
- rolling std
- z-score
- activation multiple
- trade count
- average trade size
- burst score

### Trade imbalance

Use aggregate trades and maker flag to infer aggressor side carefully.

Track:

- estimated taker buy notional
- estimated taker sell notional
- taker imbalance ratio
- large trade count
- large trade notional

### Order book / depth

Only for focus symbols initially.

Track:

- top of book
- top N depth
- depth imbalance
- slippage estimate for intended size
- walls/large resting liquidity if available from local book
- book age

### Context enrichers

Lower frequency:

- open interest
- open interest change
- long/short ratio
- top trader long/short ratio
- taker buy/sell volume
- margin borrow availability
- max borrowable
- interest/borrow cost

---

## 15. Risk engine

Risk engine is not optional.

Every proposal must go through risk before manual ticket or execution.

Risk engine must be simple, strict, explainable, and logged.

### Required risk checks

- kill switch
- live enabled flag
- manual-only mode
- allowed symbols
- blocked symbols
- max notional per order
- max total exposure
- max daily notional
- max daily loss
- max open orders
- max open positions
- cooldown after order
- symbol filters from exchange info
- min notional
- step size
- tick size
- spread max
- depth minimum
- stale data maximum
- funding cost limit
- borrow availability if reverse-basis
- borrow cost limit
- account balance enough
- no conflicting position/order
- no partial-fill unsafe plan

### Risk output

Risk does not just say yes/no.

It returns:

- approved / rejected / needs manual review
- reason codes
- human-readable reason
- max allowed size
- required confirmation level
- snapshot of key input values

### Important

Do not build risk as hidden Boolean checks.

Risk decisions must be visible in UI and ledger.

---

## 16. Executor interface

Executor should not think.

It receives an already approved order plan.

Executor is responsible for:

- order preview
- exchange filter validation
- optional test-order validation
- live send only when allowed
- order response capture
- cancel order
- cancel all for symbol if explicitly called
- fill reconciliation through user stream
- partial-fill state
- idempotency/client order IDs
- ledger events

### V0 executor posture

V0 should expose executor interface and manual ticket integration.

Do not let strategy modules call live orders directly.

A proposal can open a manual ticket.

Manual confirmation can call executor if live mode is enabled and risk passes.

No withdrawals.

No transfer-out UI.

No API keys in frontend.

No secrets in Git.

---

## 17. Ledger

Ledger is the memory and audit system.

Without ledger, the engine is useless.

### Events to store

- engine started
- engine stopped
- heartbeat
- source connected
- source disconnected
- websocket reconnect
- symbol universe refreshed
- symbol became candidate
- focus opened
- focus updated
- focus closed
- feature snapshot
- strategy signal
- proposal created
- risk approved
- risk rejected
- manual preview
- manual confirmation
- order intent
- order request
- order response
- order error
- fill event
- cancel event
- account update
- balance update
- position update
- config change
- kill switch change
- error

### Ledger fields

Each event should have:

- id
- timestamp
- event type
- severity
- symbol
- strategy
- source
- status
- message
- reason code
- JSON payload
- correlation id

### Correlation IDs

Use correlation IDs.

One candidate/proposal/order path should be traceable from market event to risk decision to order response.

---

## 18. Storage design

Do not store every raw tick forever.

Use tiers.

### In memory

Rolling windows and hot state.

- symbol state
- rolling buckets
- current best bid/ask
- focus sessions
- latest proposal list
- recent events

### SQLite/Postgres database

At beginning SQLite is fine if code is careful. If throughput grows, move heavy time-series data to Postgres/Timescale or another proper store later.

Tables:

- `engine_events`
- `symbol_universe`
- `symbol_features_1s`
- `symbol_features_1m`
- `focus_sessions`
- `strategy_proposals`
- `risk_decisions`
- `order_intents`
- `order_events`
- `fills`
- `account_snapshots`
- `settings_history`

### Raw event storage

Store raw trades/depth only for focus symbols and around triggered windows.

For example:

- keep all raw focus events for 10–30 minutes around a trigger
- summarize into 1s/1m features for longer-term history

---

## 19. Dashboard APIs for engine

The UI should be able to read engine state without scraping logs.

Add API endpoints such as:

- `/api/engine/status`
- `/api/engine/universe`
- `/api/engine/features?symbol=...`
- `/api/engine/candidates`
- `/api/engine/focus`
- `/api/engine/proposals`
- `/api/engine/proposals/{id}`
- `/api/engine/risk-decisions`
- `/api/engine/ledger`
- `/api/engine/strategies`
- `/api/engine/settings`
- `/api/engine/kill-switch`

If route conventions differ, adapt, but keep these concepts.

---

## 20. Engine UI integration points

The control room should show:

### Dashboard

- engine status
- account status
- current mode
- kill switch
- active proposals
- recent risk rejections
- open orders
- recent fills
- ledger timeline

### Strategies

- strategy status
- scanned symbols
- current candidates
- active focus symbols
- proposals
- last rejection reason

### Opportunities

- proposal table
- basis proposal cards
- volume-spike proposal cards
- risk result
- open trade ticket

### Risk

- risk settings
- risk rejections
- kill switch
- daily limits
- symbol allow/block lists

### Ledger / Logs

- full event feed
- filters
- search
- correlation trace

### System Health

- websocket status
- stream count
- reconnects
- message rates
- REST latency
- database write state
- engine loop lag
- last heartbeat

---

## 21. Two first strategies

Build only two first strategies. Do not build ten fake strategy cards.

### Strategy A: Basis monitor

Goal:

Find executable spot/perp basis opportunities.

Inputs:

- spot bid/ask
- futures bid/ask
- funding
- mark price
- spread
- depth
- fees
- slippage estimate
- borrow availability if reverse
- recent basis history

Outputs:

- no signal
- candidate
- focus
- proposal
- rejected reason

### Strategy B: Dead-volume activation

Goal:

Find dead/quiet Binance symbols that suddenly show abnormal activity before the move is obvious on slow charts.

Inputs:

- rolling volume baseline
- current 1s/5s/1m volume
- trade count
- average trade size
- price acceleration
- taker imbalance
- spread
- focus depth/trades

Outputs:

- no signal
- candidate
- focus
- proposal
- rejected reason

---

## 22. Basis strategy logic in human words

Every second:

Check every symbol that has both spot and perp.

Calculate two executable gaps:

1. If perp is expensive relative to spot: could buy spot at ask and short perp at bid.
2. If spot is expensive relative to perp: could require borrowing spot, selling spot at bid, and long perp at ask.

Then ask:

- Is the gap real using bid/ask?
- Is it bigger than fees?
- Is it bigger than expected slippage?
- Is data fresh?
- Is spread acceptable?
- Is funding helping or hurting?
- If borrow needed, is borrow available?
- Has the gap persisted or is it a one-tick artifact?
- Is volume/depth enough?

Only then create proposal.

---

## 23. Dead-volume strategy logic in human words

Every second:

Every symbol updates its rolling baseline.

Most symbols are ignored.

If a dead symbol suddenly wakes up:

- volume spikes
- trade count spikes
- price moves
- spread remains tradable
- aggressive side appears one-sided

Then focus mode starts.

In focus mode, the engine watches deeper data.

If the signal continues and does not look like one fake candle, create proposal.

If the signal dies, close focus and log rejection.

---

## 24. How to compare current data to past data

Do not query 10 days of DB every second.

Use rolling windows.

For each symbol keep buckets:

- current 1 second
- previous 5 seconds
- previous 15 seconds
- previous 60 seconds
- previous 5 minutes
- previous 1 hour
- baseline from longer history

Each incoming trade updates the relevant symbol state.

At each engine tick, the feature engine computes ratios:

- current 1s volume / normal 1s volume
- current 5s volume / normal 5s volume
- current trade count / normal trade count
- current spread / normal spread
- current price movement / normal volatility

This is how the engine knows a dead chart woke up.

---

## 25. Important implementation choices

### Use async/event-driven code

WebSockets and timers should not block each other.

Use async tasks for:

- spot public stream
- futures public stream
- user stream later
- feature tick
- strategy tick
- ledger writer
- API state snapshot

### Do not REST-poll everything

REST is for:

- exchange info
- symbol filters
- depth snapshot bootstrapping
- funding history
- borrow state
- account state
- reconciliation

WebSocket is for:

- live price
- book ticker
- trades
- depth updates
- mark/funding updates

### Use bounded queues

If event flow is faster than processing, do not allow memory explosion.

Use bounded queues and drop/aggregate low-priority events if needed.

### Use snapshots for UI

The UI should not read raw engine internals.

The engine should produce clean snapshots:

- status snapshot
- candidate snapshot
- focus snapshot
- proposal snapshot
- ledger recent events

---

## 26. Live-money posture

This project is live-capable, but first engine implementation should be proposal-first.

Do not build autonomous strategy-to-order sending in the first engine module.

The right path:

strategy finds signal
risk checks signal
proposal appears
user inspects
manual ticket opens
user confirms if desired
executor sends only through explicit path
ledger records everything

This allows small live testing without letting a brand-new strategy fire blindly.

---

## 27. What Fable must not do

Do not touch UI in engine pass.

Do not make a Binance clone.

Do not create a fake “AI bot” card.

Do not create strategy code that cannot explain itself.

Do not create live autonomous order loop in v0.

Do not add withdrawals.

Do not add transfer-out.

Do not hardcode keys.

Do not stage `.env`.

Do not import old `end.py`.

Do not make a single huge 5000-line file.

Do not hide rejected decisions.

Do not fake edge.

---

## 28. Build plan — split into small parts

Build in this order.

### Part 0 — Inspection and file plan

Fable should inspect repo and existing `engine/` folder.

Output only:

- current files
- proposed engine module map
- tests to create
- which existing UI/API endpoints should read engine state
- what it will not touch

Do not code in Part 0 unless asked.

### Part 1 — Models and config

Create/update:

- `engine/config.py`
- `engine/models.py`
- `engine/clock.py`

Define data models for:

- symbol metadata
- ticker state
- book state
- rolling feature state
- candidate
- focus session
- proposal
- risk decision
- ledger event
- order intent

Tests:

- model serialization
- defaults
- risk config defaults

### Part 2 — Ledger

Create/update:

- `engine/ledger.py`

Must support:

- append event
- query recent events
- query by symbol
- query by strategy
- query by correlation id
- SQLite table creation

Tests:

- append event
- read event
- filter event
- correlation trace

### Part 3 — Binance universe and metadata

Create/update:

- `engine/binance_universe.py`

Build universe from:

- Spot exchange info
- Futures exchange info
- margin/borrow info if keys/permissions are present later

Must output:

- spot symbols
- futures symbols
- symbols with both
- filters: min notional, tick size, step size
- quote asset
- base asset
- status

Tests using mocked API responses.

### Part 4 — Public market stream skeleton

Create/update:

- `engine/binance_public.py`
- `engine/streams.py`
- `engine/state.py`

Build stream client abstractions.

Do not require real Binance connection in tests.

Tests with synthetic events.

### Part 5 — Rolling windows and feature engine

Create/update:

- `engine/rolling.py`
- `engine/features.py`

Implement:

- rolling volume buckets
- trade count buckets
- spread calculation
- basis calculation
- staleness checks
- volume z-score/activation multiple
- basis slope/persistence

Tests:

- dead symbol baseline
- volume spike detection
- executable basis using bid/ask
- stale data reject flag

### Part 6 — Focus manager

Create/update:

- `engine/focus.py`

Implement:

- promote symbol
- expire focus
- cap focus count
- preserve active positions/pinned symbols later
- focus reasons

Tests:

- candidate enters focus
- focus expires
- focus cap works
- stronger candidate replaces weaker one if cap full

### Part 7 — Strategy A: Basis

Create/update:

- `engine/strategies/basis.py`

Implement proposal generation only.

Tests:

- perp > spot proposal
- spot > perp needs borrow
- no borrow rejects reverse proposal
- wide spread rejects
- stale data rejects
- funding too costly rejects or downgrades

### Part 8 — Strategy B: Dead-volume

Create/update:

- `engine/strategies/dead_volume.py`

Implement candidate/proposal logic.

Tests:

- dead market wakes up
- one isolated fake spike rejected
- persistent volume produces proposal
- wide spread blocks
- stale data blocks

### Part 9 — Risk gate

Create/update:

- `engine/risk.py`

Implement:

- risk config
- approve/reject decision
- reason codes
- max size calculation
- kill switch
- symbol allow/block
- stale data
- spread/depth
- borrow requirement
- min notional/step/tick checks

Tests:

- kill switch blocks
- oversized order blocks
- allowed symbol passes
- blocked symbol rejects
- stale data rejects
- borrow required but missing rejects

### Part 10 — Executor interface

Create/update:

- `engine/executor.py`

V0 executor should support:

- preview order plan
- validate filters
- generate client order id
- create order intent
- optionally call test-order if configured later
- no autonomous send from strategy

Tests:

- preview valid order
- reject invalid quantity/step
- reject min-notional
- kill switch blocks send path

### Part 11 — Engine runner

Create/update:

- `engine/runner.py`

This starts:

- universe load
- streams
- feature tick
- strategy tick
- risk evaluation
- ledger writer
- status snapshot

Tests:

- synthetic run loop
- event creates candidate
- candidate creates proposal
- risk decision stored
- API snapshot sees it

### Part 12 — API integration

Create/update:

- engine API routes in existing backend convention

Expose:

- status
- candidates
- focus
- proposals
- ledger
- strategies
- risk config

Tests:

- routes respond
- no keys required for public status
- no fake data

### Part 13 — Replay and diagnostics

Create/update:

- `engine/replay.py`

Support replay from synthetic fixtures or saved snapshots.

This lets strategies be tested without waiting for live market events.

Tests:

- replay dead-volume fixture
- replay basis fixture
- ledger output matches expected stages

---

## 29. Acceptance gates for Engine v0

Engine v0 is not done until:

- module tests pass
- engine can start without Binance keys
- engine can run on synthetic data
- symbol universe can be loaded or mocked
- basis proposal can be created from synthetic events
- dead-volume proposal can be created from synthetic events
- fake one-candle spike can be rejected
- stale data is rejected
- wide spread is rejected
- risk kill switch blocks
- ledger records every stage
- dashboard API exposes status/proposals/logs
- no secrets in repo
- no `.env` staged
- no old `end.py` import
- no withdrawals/transfer-out

---

## 30. How to judge whether the strategy is working

Do not judge by immediate profit first.

Judge by:

- did it detect the right token early?
- did it detect it before human eyes?
- did it avoid stale/broken data?
- did it avoid fake one-tick noise?
- did it explain why it cared?
- did risk explain rejection?
- did ledger preserve enough context?
- did it estimate fees/spread/slippage realistically?

Profitability comes only after data, logging, and replay show that signals are real.

---

## 31. Specific examples Fable should model as tests

### Example 1 — Basis opens

Synthetic symbol `ABCUSDT`:

- spot ask = 1.000
- perp bid = 1.025
- funding acceptable
- spread tight
- data fresh

Expected:

- basis candidate created
- proposal created
- risk approved if size within limits

### Example 2 — Basis fake due to stale data

- spot update is 20 seconds old
- futures update is fresh
- visible basis looks large

Expected:

- no proposal
- risk/feature says stale data
- ledger records rejection

### Example 3 — Reverse basis but no borrow

- spot bid much higher than perp ask
- borrow required
- max borrowable = 0 or unknown

Expected:

- proposal rejected or non-executable
- reason: borrow unavailable

### Example 4 — Dead volume wakes up

- baseline 1s volume = 50 USDT
- current 1s volume = 5000 USDT
- trade count rising
- price moving
- spread acceptable
- follow-through for 5 seconds

Expected:

- candidate
- focus
- proposal

### Example 5 — One-candle fake spike

- current 1s volume high
- no follow-through
- spread widens
- price returns

Expected:

- candidate maybe
- focus expires
- no proposal
- ledger says fake/expired

---

## 32. Coding style expectations

Use typed Python where possible.

Keep modules small.

Keep strategy logic explainable.

Use dataclasses or Pydantic depending on project conventions.

Use async carefully.

Avoid global mutable chaos.

Use one clear engine state object.

Use bounded memory.

Use correlation IDs.

Use exact reason codes.

Do not hide exceptions.

Do not spam logs.

Do not let one failed API call kill the whole engine.

---

## 33. What to ask Fable after this context

After placing this file in the repo, start with:

“Read ENGINE_CONTEXT.md and inspect the repo. Do not code yet. Produce the engine module map and build order for Engine v0. Identify existing engine files, UI/API integration points, and first module to implement.”

Then ask one module at a time:

“Implement Part 1: models/config/clock only. Add tests. Do not touch UI.”

Then:

“Implement Part 2: ledger only. Add tests. Do not touch UI.”

Continue part by part.

This prevents Fable from rushing and building a half-baked monster.

---

## 34. Final principle

The engine must become a system that sees, explains, rejects, proposes, records, and then eventually executes through a controlled path.

If it cannot explain why it cared, it should not trade.

If it cannot record what it saw, it cannot be trusted.

If it cannot be replayed, it cannot be improved.

If risk can be bypassed, the architecture is wrong.

If UI is the only thing that looks good, the product is fake.

Build the brain in small verified pieces.

