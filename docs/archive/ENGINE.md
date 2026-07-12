# ENGINE.md — Arbitrage Capital Control Room Engine

Status (2026-07-12): one convergence application root now owns the existing
Market -> Basis -> Volume lifecycle, shell-first startup, reverse drain,
checkpoint persistence, restart barriers, authenticated supervisor APIs, and
safe READ_ONLY/ADVISORY/VALIDATE_ONLY controls. A keyless acceptance run proved
447-symbol public coverage and live public Market/Basis/Volume truth. The whole
machine remains truthfully DEGRADED because effectful Intelligence Runtime,
continuous Market Intelligence, production Capital/account truth, signed
validation, and live reconciliation/execution are not configured.

The deterministic first vertical slice binds exact proposal/mandate/approval
revisions through Capital, Foundation multi-leg risk, a two-leg VALIDATE_ONLY
plan, sealed in-process dry-run ports, reconciliation fixtures, and the existing
SQLite ledger. No signed, test-order, private, paper-submission, or money-moving
port is reachable from `server/src/systemIntegration/**`; every live mode returns
`LIVE_EXECUTION_NOT_IMPLEMENTED`. Existing audited manual account/order/loan
services still exist outside this convergence authority and keep their own
legacy safety gates. See `SYSTEM_AUTHORITY_MAP.md`,
`SYSTEM_CONVERGENCE_COMPONENTS.md`, and `SYSTEM_CONVERGENCE_RECEIPT.md` for the
accepted boundary and exact evidence.

Last updated: 2026-07-12
Permanent role of this file: engine/algorithm/brain blueprint for Fable, Opus, Claude Code, Codex, or any future agent.

Read `DIRECTOR_RULEBOOK.md` and `BLUEPRINT.md` first. This file is only for the engine. The UI/cockpit exists to expose this engine’s state, not to replace it.

---

## 1. Engine mission

The engine turns Binance market/account data into explainable proposals.

It must answer:

- what symbols exist,
- what symbols are liquid enough,
- where spot/perp basis is executable,
- where funding helps or hurts,
- where reverse basis requires borrow,
- whether borrow is available,
- which quiet tokens are waking up,
- which signals deserve focus,
- what proposal exists,
- why a proposal was rejected,
- what risk allows,
- what the account did,
- what PnL/cost/funding/interest resulted.

The engine is not an AI chat agent. It is not a gambling script. It is not a market manipulator. It is not a Binance clone. It is a deterministic, event-driven scanner/proposal/risk system with a ledger.

---

## 2. Implementation language decision

Default for the current repository: TypeScript inside the existing Node/Express server, unless a fresh repo inspection proves the stack has intentionally changed.

Reason: the existing architecture described `server/` as Node 22 + TypeScript, `web/` as React/Vite, with `server/src/engine/` already present as legacy/early engine feed. The safest path is to evolve the existing TS backend instead of creating a second language/process too early.

Do not blindly create a Python engine because older context mentioned `engine/*.py`. That was an earlier blueprint. If Director/Fable believes a Python sidecar is still better, it must first write an Architecture Decision Record explaining why, how it communicates with the TS server, how it is supervised/deployed/tested, and how data/ledger consistency is maintained. Until that ADR is approved, TS-first.

Current implementation and proof locations:

- `server/src/engine/`
- `server/src/services/risk.ts`
- `server/src/ledger.ts`
- `server/src/binance/`
- `server/test/engine-basis.mjs` and `server/test/engine-volume.mjs`
- focused security, financial-safety, storage, transport, loan, and lifecycle
  regressions under `server/test/`
- `server/test/gates.mjs` as the separate live public-market integration gate

Never confuse `server/src/engine/marketData.ts` / `scanner.ts` legacy feed with the final engine. Keep or refactor carefully, but do not assume old scanner is enough.

---

## 3. External facts the engine depends on

Before coding live network modules, verify current Binance docs. The following design anchors are current enough to guide architecture but still must be verified by the coding agent before hardcoding endpoint behavior.

Spot WebSocket streams support combined market streams, have a control-message limit, and can subscribe many streams per connection. Use WebSockets for live data instead of REST-polling every symbol every second.

USD-M futures market streams should be used for futures book/mark/funding where available. Futures order/account state should use user data stream with REST reconciliation when keys exist.

Cloudflare Access/Tunnel is an outer app gate only. It protects the hostname. It does not replace backend secret discipline.

Git worktrees are mandatory for parallel coding because each worktree is a separate working directory and branch sharing repo history. Parallel agents in one shared `styles.css` already caused damage.

---

## 4. Engine top-level architecture

At first, keep one backend service with clean internal modules, one DB, one dashboard. Do not split into microservices until one-process architecture hurts.

Data flow:

Binance public WS/REST → Market Data Engine → Feature Store → Strategy Modules → Risk Gate → Proposal Queue → Manual Ticket/Executor → Binance signed endpoints only after approval.

Binance user data stream / polling → Account State → Ledger → Dashboard API.

Everything important writes to Ledger.

React UI reads backend API and WebSocket snapshots. Browser never talks directly to Binance signed endpoints.

Core modules:

- `config`
- `models/types`
- `clock/time`
- `binance/universe`
- `binance/public streams`
- `binance/private account`
- `market data state`
- `rolling windows`
- `features`
- `focus manager`
- `basis strategy`
- `volume spike strategy`
- `borrow/margin preflight`
- `risk gate`
- `proposal store`
- `executor interface`
- `ledger`
- `api snapshots`
- `runner`

---

## 5. Engine states

Every symbol should move through a simple state machine.

`IDLE` means nothing interesting.

`WATCHING` means a lightweight signal is near threshold.

`FOCUS` means the symbol receives deeper data and stricter checks.

`PROPOSED` means a strategy produced a proposal.

`REJECTED` means the strategy/risk rejected with a named reason.

`ACTIVE` means an approved/manual position/order is being monitored.

`COOLDOWN` means the symbol is temporarily ignored after rejection, fill, loss, expiry, or stale signal.

Every transition must be ledgered or at least counted and explainable.

---

## 6. Data tiers

Do not deep-monitor all symbols equally.

### Universe tier

All relevant Binance USDT symbols get lightweight monitoring.

Fields:
- symbol,
- base,
- quote,
- spot exists,
- perp exists,
- margin/borrow status if known,
- last spot bid/ask,
- last perp bid/ask,
- mark price,
- funding,
- 24h volume,
- spread,
- basis,
- staleness,
- eligibility.

### Candidate tier

A symbol becomes candidate when something crosses a threshold:
- basis opens,
- basis widens,
- funding extreme,
- volume spike,
- trade count spike,
- dead symbol wakes,
- user pins,
- open order/position exists.

### Focus tier

Focused symbols receive deeper data:
- depth,
- aggTrades,
- order book imbalance,
- large trade bursts,
- taker buy/sell inference,
- slippage estimate,
- basis slope,
- volume baseline deviation,
- borrow precheck,
- lower-frequency futures context if useful.

### Proposal tier

Strategy emits a structured proposal:
- strategy,
- symbol,
- direction,
- reason,
- evidence,
- edge,
- confidence,
- suggested size,
- invalidation,
- risk inputs.

### Active tier

If manually approved/tested/executed:
- order state,
- fill state,
- position state,
- PnL,
- exit condition,
- funding/borrow exposure,
- partial-fill recovery.

---

## 7. Rolling feature model

Do not query 10 days of DB every tick. Use rolling windows.

For each symbol maintain rolling buckets:

- current 1 second,
- last 5 seconds,
- last 15 seconds,
- last 60 seconds,
- last 5 minutes,
- last 1 hour,
- longer baseline if available from compressed history.

Features:
- quote volume per bucket,
- trade count per bucket,
- average trade size,
- price move per bucket,
- volatility,
- spread,
- basis,
- basis slope,
- staleness,
- taker buy/sell estimate,
- large-trade count,
- depth quality for focused symbols.

The engine should compare a symbol to itself, not compare small alts directly to BTC.

---

## 8. Basis scanner

This is the first serious strategy.

It must use executable bid/ask, not candle close, not last price, not mark alone.

### Direction A — perp expensive relative to spot

Potential structure:
- buy spot at spot ask,
- short perp at futures bid.

Executable basis:
`(perp_bid - spot_ask) / spot_ask`.

Estimate net edge after:
- spot fee,
- futures fee,
- expected close fees,
- spread,
- slippage,
- funding over expected hold,
- staleness,
- depth at intended size.

Proposal only if edge survives all checks and persists.

### Direction B — spot expensive relative to perp

Potential structure:
- borrow base asset,
- sell spot at spot bid,
- long perp at futures ask.

Executable reverse basis:
`(spot_bid - perp_ask) / perp_ask`.

This is not executable if borrow is unavailable or too expensive.

Reject reasons:
- `borrow_status_unknown`,
- `borrow_unavailable`,
- `max_borrow_too_low`,
- `borrow_cost_too_high`,
- `margin_permission_missing`,
- `liquidation_risk_unknown`.

### Required basis decision fields

Each symbol decision should include:

- symbol,
- timestamp,
- spot bid/ask,
- perp bid/ask,
- mark price,
- raw mid basis,
- executable long-spot/short-perp gap,
- executable short-spot/long-perp gap,
- funding rate,
- time to funding,
- fee estimate,
- slippage estimate,
- spread bps spot,
- spread bps perp,
- depth score,
- staleness,
- gap age,
- gap direction,
- borrow needed,
- borrow status,
- gross edge,
- net edge,
- decision: `ignore`, `watch`, `focus`, `proposal`, `reject`,
- reason code,
- human reason.

### Basis named reject reasons

Use stable codes. Do not invent new words every run.

- `data_stale`
- `spot_missing`
- `perp_missing`
- `book_missing`
- `edge_below_fees`
- `edge_below_threshold`
- `spread_too_wide`
- `depth_too_thin`
- `gap_not_persistent`
- `funding_against_trade`
- `borrow_required`
- `borrow_unknown`
- `borrow_unavailable`
- `borrow_too_small`
- `borrow_cost_too_high`
- `symbol_blocked`
- `risk_blocked`
- `account_not_connected`
- `kill_switch_on`

---

## 9. Volume spike / dead-volume scanner

This is the second serious strategy.

Goal: detect quiet symbols that wake up before the move is obvious on slow charts.

The engine must not buy just because volume spiked. It should detect, focus, verify, propose, and reject false positives.

### Dead state

A symbol is “dead/quiet” relative to itself when:
- 1s/5s/1m volume is below its rolling norm,
- trade count is low,
- price range is flat,
- volatility is low,
- spread is not permanently untradeable,
- it has enough baseline history.

### Activation triggers

Candidate if:
- 1s quote volume multiple exceeds threshold,
- 5s confirms continuation,
- trade count rises,
- average trade size changes,
- price starts moving,
- spread remains tradable,
- taker imbalance appears,
- depth does not vanish.

### Focus checks

When in focus:
- subscribe or collect deeper depth/trades,
- calculate taker buy/sell imbalance,
- calculate book/depth quality,
- identify one-print fake spikes,
- check price follow-through,
- check move is not already too late,
- keep raw event window briefly.

### Reject reasons

- `baseline_missing`
- `volume_not_abnormal`
- `one_print_spike`
- `trade_count_too_low`
- `spread_too_wide`
- `depth_too_thin`
- `price_no_followthrough`
- `move_already_extended`
- `taker_imbalance_missing`
- `data_stale`
- `symbol_blocked`
- `risk_blocked`

### Proposal fields

- symbol,
- baseline volume,
- current 1s/5s/1m volume,
- volume multiple,
- trade count multiple,
- taker imbalance,
- price acceleration,
- spread,
- depth score,
- focus duration,
- suggested direction,
- invalidation condition,
- confidence,
- risk result.

---

## 10. Focus manager

Focus is scarce. Do not monitor everything deeply.

Default caps:
- soft focus cap: 10 symbols,
- hard focus cap: 25 symbols,
- active/open position symbols always stay focused,
- owner-pinned symbols can reserve slots,
- low-quality candidates expire quickly.

Focus entry reasons:
- basis gap,
- volume activation,
- funding extreme,
- price acceleration,
- user pin,
- open order,
- open position.

Focus exit reasons:
- signal expired,
- gap closed,
- volume returned to baseline,
- spread/depth invalid,
- risk rejected,
- max focus time,
- cooldown started.

Focus score should be explainable and sortable.

---

## 11. Borrow / margin preflight

Reverse basis depends on borrowability. Do not pretend otherwise.

Borrow preflight should eventually read:
- margin account enabled,
- cross margin eligibility,
- isolated margin eligibility,
- max borrowable by asset,
- current borrowed amount,
- borrow interest,
- collateral/LTV if available,
- borrow blocked reason.

Until keys/permissions exist, reverse-basis proposals requiring borrow must be rejected or marked not executable with a clear reason.

The Borrow/Preflight UI should show why a signal is blocked instead of pretending the opportunity can be executed.

---

## 12. Risk gate

Risk is deterministic and visible.

Every proposal or manual ticket must pass risk before live send.

Risk input:
- order plan,
- strategy,
- symbol,
- side,
- order type,
- notional,
- price,
- quantity,
- account state,
- current market state,
- borrow state,
- config limits,
- live/paper/kill state.

Required checks:
- kill switch,
- live mode armed,
- manual-only mode,
- symbol allowlist,
- symbol blocklist,
- max order notional,
- max symbol exposure,
- max daily notional,
- max daily loss,
- max open orders,
- max open positions,
- cooldown,
- min notional,
- tick size,
- step size,
- price filters,
- spread max,
- depth/slippage minimum,
- stale data,
- borrow needed/available,
- funding cost,
- existing conflicting exposure,
- account balance,
- partial-fill/two-leg risk.

Risk output:
- approved / rejected / needs review,
- reason code,
- human reason,
- max allowed size,
- required confirmation,
- snapshot of decisive inputs,
- correlation ID.

Risk decisions are ledger events.

---

## 13. Executor

Executor does not think. Strategy does not execute.

Executor responsibilities:
- order preview,
- exchange filter validation,
- client order ID generation,
- test-order validation if configured,
- live send only after approved path,
- order response capture,
- cancel order if implemented,
- fill reconciliation,
- partial-fill state,
- ledger events.

V0 executor posture:
- manual ticket only,
- no strategy-to-live direct path,
- no autonomous order placement,
- no withdrawals,
- no transfer-out,
- no hidden retries that increase exposure without a ledgered plan.

Two-leg basis executor later:
- testnet first,
- each leg has explicit plan,
- no naked leg without recovery state,
- partial fills handled,
- stale orders cancelled or marked,
- both legs ledgered with correlation ID.

---

## 14. Ledger

Ledger is the engine’s memory.

Event shape:
- id,
- timestamp,
- event type,
- severity,
- source,
- symbol,
- strategy,
- status,
- reason code,
- message,
- correlation ID,
- payload JSON,
- created_at.

Event types:
- `engine_started`
- `engine_stopped`
- `heartbeat`
- `source_connected`
- `source_disconnected`
- `stream_reconnect`
- `universe_refreshed`
- `feature_snapshot`
- `candidate_opened`
- `candidate_rejected`
- `focus_opened`
- `focus_closed`
- `strategy_decision`
- `proposal_created`
- `proposal_updated`
- `risk_approved`
- `risk_rejected`
- `manual_preview`
- `manual_confirm`
- `order_intent`
- `order_request`
- `order_response`
- `order_error`
- `fill`
- `cancel`
- `account_update`
- `balance_update`
- `position_update`
- `config_change`
- `kill_switch_changed`
- `system_error`

Correlation ID:
One signal/proposal/order path must be traceable end-to-end.

Do not create a scanner that only logs final accepted proposals. Rejections are just as important; they are how the engine learns and how the owner trusts it.

---

## 15. API snapshots for cockpit

The UI should read stable snapshots, not scrape raw logs.

Recommended endpoints/concepts:

- `/api/engine/status`
- `/api/engine/universe`
- `/api/engine/decisions`
- `/api/engine/features?symbol=...`
- `/api/engine/candidates`
- `/api/engine/focus`
- `/api/engine/proposals`
- `/api/engine/proposals/:id`
- `/api/engine/risk-decisions`
- `/api/engine/ledger`
- `/api/engine/strategies`
- `/api/engine/settings`
- `/api/risk/evaluate`
- `/api/risk/config`
- `/api/risk/kill-switch`
- `/api/account/status`
- `/api/execution/preview`
- `/api/execution/validate`
- `/api/execution/send`

If existing route style differs, adapt names but keep concepts.

---

## 16. Initial build order (implemented; retained as architecture history)

This staged order explains how the engine was decomposed. It is not the current
work queue; inspect the implementation and `PROJECT_MEMORY.md` before planning
new work.

### Part 0 — Planning-only survey

No code. Inspect repo. Identify actual stack, engine files, API routes, tests, build commands, and the correct implementation location. Resolve TypeScript-vs-Python decision. Return module map and first module plan.

### Part 1 — Types/models/config

Define typed models for:
- symbol metadata,
- book ticker,
- mark/funding,
- rolling buckets,
- feature snapshot,
- decision,
- candidate,
- focus session,
- proposal,
- risk decision,
- ledger event,
- order intent.

No network calls. Tests for serialization/defaults.

### Part 2 — Ledger foundation

Ensure ledger can append/query/filter events with correlation IDs. Add tests.

### Part 3 — Universe and exchange filters

Load/parse Binance spot/futures exchange info or mocked fixtures. Build symbol universe with min notional, tick, step, status, spot/perp availability. Tests use fixtures.

### Part 4 — Market data state and public stream adapters

Create testable adapters for mini tickers, book tickers, mark/funding, trades, and depth. No real Binance dependency in tests.

### Part 5 — Rolling windows and feature engine

Implement rolling buckets, spread, executable basis, staleness, volume multiple, z-score/basic anomaly, basis persistence. Tests for all math.

### Part 6 — Focus manager

Promote/demote symbols, caps, reasons, expiry. Tests for caps and replacement.

### Part 7 — Basis scanner v2

Produce decisions/proposals/rejects from features. Use bid/ask. Include fees/funding/borrow placeholders. Tests for perp>spot, spot>perp borrow-required, stale, wide spread, edge below fees.

### Part 8 — Borrow preflight

Wire borrow state model. If keys unavailable, return unknown/unavailable cleanly. Tests for reverse-basis reject behavior.

### Part 9 — Risk gate

Evaluate proposals and manual intents. Tests for kill switch, allowlist/blocklist, notional caps, stale, spread, borrow.

### Part 10 — Proposal API

Expose proposal/decision snapshots to UI. Tests for response shape.

### Part 11 — Volume spike scanner

Implement baseline/focus/proposal/reject logic. Tests for dead symbol waking, one-print fake spike, persistence, wide spread.

### Part 12 — Runner

Run synthetic loop. Do not require Binance in tests. Prove event → feature → decision → proposal/reject → ledger.

### Part 13 — Account synchronization

Implemented with server-side credentials, signed REST reconciliation, a signed
private WebSocket API subscription, fill/order/account truth, and explicit
stale or partial states. Credentials never enter the browser.

### Part 14 — Guarded manual execution boundary

Implemented as manual-only order/cancel and loan mutation services behind
account, permission, control-mode, kill/live, risk, confirmation, and audit
gates. Unknown outcomes fail closed for reconciliation. This does not authorize
an autonomous strategy-to-order loop.

---

## 17. Historical initial planning prompt

Retained only to explain the original planning phase. Do not use it as a current
work order; the engine and its tests now exist.

```text
You are in the Arbitrage Capital Control Room repo.

Read DIRECTOR_RULEBOOK.md, BLUEPRINT.md, and ENGINE.md fully.
Inspect server/, web/, package files, tests, current engine-related code, current API routes, and docs.
Do not write code yet.

Return:
1. current repo map
2. current test/build commands
3. current engine-related files and whether they are real engine or legacy UI feed
4. recommended engine implementation location
5. whether TypeScript-first is correct here or whether a Python sidecar needs an explicit ADR
6. module build order
7. first module to implement
8. exact files you will touch in the first coding pass
9. tests you will add or update
10. files you will not touch
11. risks/unknowns that must be verified

Do not start coding until the Director approves the plan.
```

---

## 18. What engine workers must not do

Do not touch UI in engine pass unless explicitly listed.

Do not make a Binance clone.

Do not create a fake “AI bot” card.

Do not hide rejects.

Do not fake profitability.

Do not create live autonomous order loop.

Do not add withdrawal/transfer.

Do not hardcode keys.

Do not stage `.env`.

Do not import old `end.py`.

Do not create one 5000-line file.

Do not add network calls to unit tests.

Do not change risk/executor boundaries casually.

---

## 19. Proof requirements

Each engine module must produce proof:

- tests,
- sample fixture,
- named reasons,
- ledger events if applicable,
- API snapshot if UI-facing,
- no secrets,
- build passes.

The Director should reject any engine result that says “done” but only creates UI cards or unaudited logic.

---

## 20. Long-term improvement loop

The engine will improve by ledger evidence, not vibes.

For every strategy:
1. define signal,
2. define feature inputs,
3. define reject reasons,
4. run paper,
5. log outcomes,
6. inspect missed/wrong cases,
7. add one named filter,
8. test,
9. repeat.

New “intuition” becomes a named filter and a ledgered reason. That is how the system gets smarter without becoming random.
