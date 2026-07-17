# ORGAN PORTFOLIO — parallel pre-build for the free-compute window (v1.0, research-hardened)

**From:** the read-only supervising commander (Fable 5), at the owner's direct order to stop reporting and start proposing big organs.
**Date:** 2026-07-15. **Status:** advisory design portfolio. Five organs are web-research-hardened with sources (Twin, Narrator, Multi-Venue, Edge-Instrument, CLI-Harness); five are design-grade pending a second research pass (Replay, Chaos, Invariant, On-Chain Senses, Governor) — flagged honestly per organ.
**To:** owner → ChatGPT commander → Director (as a shadow-lane build wave).
**One line:** while `role4-fix` grinds C2 (slow, but it will land), spend the rare unlimited-compute window pre-building large, pluggable **organs** that make the existing half-million-line brain *survivable, legible, and provable* — each built against an already-frozen interface, parked in shadow, ported after `INTEGRATED_ACCEPTED`.

---

## 0. The two things that make this safe and not a fantasy

**1. The socket is already specced — stop worrying about the amperage.** The interface every organ plugs into is already frozen: `POST_I00 §13` defines **35 typed data contracts**; `§4.3` freezes the **maximum-authority envelope**; the canonical **SQLite ledger** (`data/cosmos.db`), the **event/telemetry contract**, and the **market-data/execution adapter seam** are existing, stable seams. So each organ binds to a *known* contract — you build its whole body against that contract (the 80%), leave a **thin adapter** for wire-in (the 20%), and plug it in after landing. This is textbook **ports-and-adapters** — exactly your "build the 16-amp block, fit the plug later" instinct, and it is correct engineering.

**2. Parallel speculative building is already legal in your own project.** `D-LAUNCH-29` (SPECULATIVE_SHADOW_PRESTAGE) already ruled that you accept duplicate compute for wall-clock: worktrees build shadow artifacts against a frozen base, mark them `SHADOW_SPECULATIVE`, and **port at `INTEGRATED_ACCEPTED`**. Six shadow lanes run under that law right now. This portfolio aims that same blessed mechanism at the highest-value targets. **So: nothing is wrong, you are not blocked, and you are not breaking a rule.**

## 1. The reframe — which organs, and why not "more strategies"

*More compute → more strategies → more money* is the trap that already cascaded this to 500k lines. The binding constraint is the one **you** named: "when it fails live and you can't understand it, all this is gone," and "too many buttons to track." So the highest-value organs are the **senses and survival faculties** — which are also the most compute-hungry (a market twin eats thousands of CPU-hours; a strategy tweak eats minutes) and the safest (pure sandbox, zero money path). Perfect shape for a one-off window: burn it on what's expensive to run and impossible to fake.

## 2. The selection law (anti-cascade discipline)

An organ earns a slot **only if it passes all four**: (1) **pure-additive** — no money path, no authority, only reads/records/simulates/advises; (2) **independently valuable** even if never fully wired; (3) **binds to a frozen contract** with a thin adapter; (4) **compute-hungry** enough to justify the window. Anything failing one waits. This law is the whole difference between *strengthening* and *cascading*.

---

## 3. BUILD THIS FIRST — the multiplier

### Organ J — The CLI-Agent Resident Harness  ★ web-hardened · build first
**Why first:** this is not just an organ, it's the **mechanism that converts your two accounts' rolling reset windows into unattended queued work** — it multiplies the value of every other organ. You were exactly right, and it's independently validated three ways: both vendors ship their CLIs as *one-session-to-completion-then-exit* tools (`codex exec` "processes a single session to completion… and exits"; `claude -p` runs non-interactive and returns); Anthropic's own long-running-agent guidance says break work into discrete tasks with **fresh context per task**, rehydrating state from git + progress files; and the documented `codex exec` production pattern is literally a systemd-timer "wake / work / record / exit" loop.
**What:** a deterministic supervisor that dequeues one task, spawns a fresh `codex exec`/`claude -p` process to completion, captures structured output + token/cost, records to SQLite, and exits — never a long-lived chat.
**Build shape (from research):** durable **SQLite task queue** (atomic claim via `UPDATE … RETURNING`, visibility-timeout lease, `received`-counter fencing token, dead-letter after N attempts, WAL); a **runner** that shells `codex exec --json --sandbox read-only --ask-for-approval never` / `claude -p --output-format json --max-turns N --permission-mode dontAsk --allowedTools …` into a fresh scratch worktree and persists JSONL + `total_cost_usd` + `session_id`; a **supervisor** = `Type=oneshot` systemd `.service` on a `.timer` (default) or thin `Type=notify` daemon with `WatchdogSec`/`Restart=on-failure`/`StartLimitBurst`; a **two-account budget governor** tracking each account's 5-hour rolling window + weekly cap with rotation and reserved headroom; **auth** via 1-year `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) + a **credential-health monitor** (the silent-stall footgun below); a **rehydration layer** injecting git log + progress file + ledger rows per fresh session.
**Binds to:** the SQLite ledger (`ai_ops_tasks`/`ai_ops_runs` tables) — the whole AI-ops↔harness contract is `enqueue(task)` + `poll(runs)`; the authority map (task-kind allow-list, read-only); the watchdog (heartbeat); the cockpit (queue depth/cost feed). It **is** the execution substrate the POST_I00 AI-ops plane was designed against.
**Safety:** holds **no** Binance credential, cannot unblock live execution; default read-only sandbox on a scratch worktree.
**Sharp edges to design for (research-surfaced):** login-based creds warn only ~5 days out and an unattended agent **silently stalls** on expiry — monitor and alert *before* runs stall (and note `--bare` does **not** read `CLAUDE_CODE_OAUTH_TOKEN`); the 5-hour/weekly caps are **pooled** across Claude Code + chat + Cowork, so the governor must reserve headroom or your own interactive use starves the agent; `codex exec` hard-fails on any approval prompt unless auto-approve is set; cap `--max-turns` + OS `RuntimeMaxSec` or one runaway loop drains a day's quota; scope credentials to the runner, never job-level env when untrusted code runs.

---

## 4. TIER 1 — Survival & Sense organs

### Organ B — Proprioception · The Digital Twin / "Exchange Twin"  ★ web-hardened · flagship soak
**What:** research reframes this precisely as an **exchange twin** — a deterministic, event-sourced Binance emulator (spot LOB + USDT-perp LOB + funding/mark-price engine + latency/queue/partial-fill layer) that consumes the exact order-intents the live executor emits and returns fills/funding through the same adapter seam. The whole stack exercises against a synthetic exchange with zero money exposure.
**State of the art to fuse (named):** **ABIDES / ABIDES-gym** (JPMorgan) for *reactive* background agents that make your own orders move the book and impact **persist** (a non-reactive replay lets price snap back and understates slippage), fused with **HftBacktest** for tick-accurate Binance L2/L3 book reconstruction with **queue-position** fill models (a queue-blind model manufactures fantasy PnL).
**The load-bearing faculty for a basis strategy:** a faithful **funding + mark-price engine** implementing Binance's exact clamped-premium formula (`avg(Premium Index) + clamp(Interest − Premium, ±0.05%)`, 8h→hourly escalation, ±0.75×-MMR caps), *versioned* (Binance has changed it). This lets the twin **synthesize funding regimes** — inversions, cap-pinning, premium blowups — that the 2–3 years of real tape never contained, which is exactly the regime your strategy trades.
**The compute soak:** an **adversarial scenario battery** — parametric library (flash crash à la May-19-2021, USDC depeg to ~$0.88, funding spikes, exchange outage / websocket stall, liquidity holes, latency storms) **plus an adversarial-search agent** that perturbs market state to *minimize* your PnL and hunt configs that trip risk limits. Embarrassingly parallel; unbounded appetite.
**Binds to:** one `ExchangeTransport` interface with two impls — `LiveBinance` vs `Twin` — selected by config, so strategy/risk/ledger/cockpit never know which they're talking to; twin writes every run to a **parallel ledger reusing the live SQLite schema** so the cockpit and risk supervisor consume twin output unchanged. Only new schema surface: the scenario descriptor + the deflated-verdict record.
**Non-negotiable anti-lie gate:** pair generation with **deflation** — deflated Sharpe / Probability of Backtest Overfitting / combinatorial-purged-CV — and a **stylized-facts self-validation suite** (fat tails, vol clustering, long-memory order flow, concave-then-reverting impact, KS/Jarque-Bera) that fails the twin loudly on calibration drift. Without this, more compute makes you **more** wrong (see §9).
**Measure your real EC2→Binance RTT** — do not assume co-location; latency error propagates straight into fill error.

### Organ A — The Eyes · Deterministic Replay / Flight Recorder  ◑ design-grade (research lane failed; keep design, harden later)
**What:** snapshots the full input state behind every decision and replays any incident/trade **frame-by-frame, offline, deterministically** — when it fails live you re-run the exact tick sequence and *watch* it. (The Narrator organ's FDR spine below, which **did** harden, is the same event backbone — build A and E as one spine.)
**Binds to:** ledger + event contract; emits `IncidentEvidenceBundle` (§13), so it becomes the corpus the AI-ops brain eats. **Safety:** read/record only.

### Organ C — The Immune System · Chaos & Fault-Injection Range  ◑ design-grade (partially covered by the Twin's fault layer)
**What:** continuously *attacks* the system — drops feeds, corrupts messages, kills processes, skews clocks, floods alerts, fires **prompt-injection payloads** at the ops plane — and asserts safety invariants never break. Research from the Twin lane already validates the pattern: mirror **LSEG's AWS-FIS game-day** approach on trading infra, and crucially **break the DATA and CONTROL paths, not just prices** — the real May-19-2021 loss was inability to *act*, not the price move. **Safety:** sandbox only.

### Organ D — The Inner Ear · Machine-Checked Invariant Constitution  ◑ design-grade (research lane returned a stub; keep design)
**What:** safety laws turned into **executable properties** fuzzed relentlessly — no naked leg, exactly-one-mutator, conservation of funds, idempotency, no unhedged exposure, ledger monotonicity — in the spirit of deterministic-simulation shops (TigerBeetle / FoundationDB / Antithesis). **Compute-hungry** (fuzzing is unbounded). **Safety:** test-only. Upgrades safety from "we wrote it down" to "a machine tried a billion violations and failed."

### Organ E — The Narrator · Flight-Data-Recorder + Glass Cockpit  ★ web-hardened · kills the button-wall
**What:** the system's black box + glass cockpit — a read-only **FDR** capturing every state transition as an append-only, correlation-ID'd event stream, plus a condenser turning the 120-control panel + logs into a **5-second GO / DEGRADED / NO-GO** safety view and a **plain-English daily story**.
**State of the art fused (named):** golden-signals / RED telemetry with **multi-window multi-burn-rate SLO alerting** (burn rates 14.4 / 6 / 1, paired 1h+5m, 6h+30m windows) so alerts are actionable, not noise; event-sourcing for time-travel ("what did state look like at 14:32?"); **aviation "dark cockpit"** (quiet = normal) + **ECAM color grammar** (red = danger, amber = attention, always show fault **and** its remediation together); 2025-era AI-SRE auto-timelines with glass-box citations.
**Two-tier narrative (the trust trick):** a **deterministic data-to-text skeleton** where every number is traceable to an event ID, wrapped by an **optional LLM layer that only rewrites and explains**, gated by a faithfulness eval that rejects any claim not backed by a cited event. It never invents numbers, never emits a money action.
**Golden signals mapped to a TRADING plane** (not a web server): latency = market-data staleness / decision-loop tick; traffic = signals/min, opportunities evaluated; errors = rejected intents, reconciliation mismatches; saturation = Binance API-weight budget, capital-vs-cap, risk headroom, event-loop lag.
**Binds to:** a frozen event envelope (align to OpenTelemetry semantic-convention names); write-side is one `recorder.emit()` shim at existing decision boundaries (or bootstrap as a pure read-only tap over current logs + ledger); read-side is one new top cockpit pane + one AI-ops read hook. Store in a **separate WAL-mode SQLite** so recording never contends with money-path writes.
**Fail conservative:** unknown/missing invariant resolves to **amber, never green** — the master GO/NO-GO is only as good as the declared invariant set.

## 5. TIER 2 — New sensory faculties (advisory only)

### Organ F — Wider Eyes · Multi-Venue Read-Only Basis Sensor  ★ web-hardened · genuinely new capability
**What:** widen vision from Binance-only to a **cross-venue** spot-perp basis + funding surface (Binance, OKX, Bybit, Hyperliquid, dYdX, Coinbase Intl) as a **read-only advisory sensor** — never cross-venue execution.
**The killer use research surfaced (elevate this):** a cross-venue surface tells your Binance basis engine whether a dislocation is **idiosyncratic to Binance** (a likely real mean-reverting edge) or **market-wide** (all venues dislocated — a regime/risk event to stand down on). *No single-venue system can know this.* It also gives dead-volume-wakeup a new sense: a dormant instrument often **wakes on a leading venue first**, so cross-venue OI/volume/basis becomes an early-warning tripwire.
**Build shape (named tools):** **cryptofeed** (40+ venues, already normalizes FUNDING / OPEN_INTEREST / index / liquidations) + **CCXT Pro** for the CEX legs; thin native adapters for **Hyperliquid** (`info` ws: allMids/activeAssetCtx) and **dYdX v4** (indexer); **Tardis/Kaiko** normalized history for offline replay. Plus a **unified symbology registry** and a **data-quality/skew health channel** with explicit bands (event-ts skew <100ms normal / 100–300ms degraded / >300ms unsafe) that *self-reports when the surface is untrustworthy*.
**Binds to:** the cockpit event bus as another read-only sensor feed (same event shape, `source=multi-venue, mode=advisory`); a **separate** read-only market-data store (never the money ledger); registered zero-authority in the authority map.
**Honesty pitfalls:** funding is **not comparable raw** (Binance 8h vs Hyperliquid/dYdX 1h, different clamps/caps) — convert to a common cadence; no aggregated cross-exchange book exists (align it yourself); a single timestamp fabricates a consensus book that never existed; one mis-mapped symbol silently corrupts the basis.

### Organ G — New Senses · On-Chain / Funding / Liquidation-Map Sensors  ◑ design-grade (research lane returned a stub; keep design)
**What:** dead-volume-wakeup is *begging* for these — on-chain flow, token-unlock calendars, funding-regime, liquidation-cluster heatmaps (Coinglass-style) have documented predictive links to volume spikes and basis moves. Build as **versioned advisory features** with leakage controls, feeding the existing Volume/Basis engines through the **Q-lane governance pipeline** (the non-bypassing path) — never live signals until governed promotion. **Safety:** advisory only.

### Organ H — The Honest Edge Instrument · Forward-Only Edge Meter  ★ web-hardened · your day-one peace of mind
**What:** the organ that answers the one question the system can't ask about itself — **"does a real, tradeable edge exist yet, or is this the best of many noise draws?"** — the scoreboard the instant shadow data flows, long before the $10 canary.
**Four-layer stack (named):** (1) a **bitemporal, append-only shadow-intent ledger** (`data_as_of_ts ≤ decision_ts` enforced at write time + hash chain) that makes look-ahead **structurally impossible**; (2) a **Perold implementation-shortfall** engine splitting every unit of PnL into signal / delay / spread / slippage-impact / fees / **funding carry** (two-legged, basis-aware); (3) forward-only significance — **Probabilistic & Deflated Sharpe** with the False-Strategy-Theorem trials penalty and a **Minimum-Track-Record-Length countdown** ("edge not yet real: 43 more shadow-days needed"); (4) **calibration** (Brier + reliability curve + ECE) checking whether the system's own confidence numbers are honest. On top: a **mandatory trials registry** + White's Reality Check / Hansen's SPA / **Probability of Backtest Overfitting** so neither you nor the AI-ops plane can cherry-pick a config.
**Binds to:** read-only reader of the ledger + append-only writer of its own namespaced tables; one passive event subscriber (engines just stamp each signal with `config_hash` + optional `predicted_edge_bps`); one new cockpit Edge Panel; stats in the Python sidecar.
**Why it matters:** your stated peace-of-mind — "see money-making, baseline set, improve daily" — literally depends on this existing on day one, plus a **canary parity harness** that later scores each real $10 fill against its shadow prediction to prove the whole edifice is trustworthy before any scale-up.
**Hard truth it enforces:** a dead-volume strategy fires rarely → small N → MinTRL may be long → the instrument will (correctly) **refuse to confirm an edge early**, and resist any human/automated pressure to do so. That honesty is the point.

## 6. TIER 3 — depends on the Twin first

### Organ I — Homeostasis · Capital-Graduation Governor  ◑ design-grade (research lane failed; keep design)
**What:** a deterministic governor that graduates capital **only on measured forward evidence** — fractional-Kelly / vol-target / drawdown-gated ladder from the $10 canary upward, backtested against the Twin (B) and gated by the Edge Instrument (H). Proposes ladders; never sets a live limit itself. **Build after** the twin and edge-meter exist.

---

## 7. How to sprint these without touching role4-fix

- **One shadow worktree per organ**, cut from the current clean base, **disjoint namespaces** (`server/src/organs/<x>/**`, `test/organs/<x>/**`, `fixtures/organs/<x>/**`) — zero overlap with `role4-fix` (canonical `server`/`web`/`ops`) or the aiOps namespaces. One writer each.
- **Static/focused compute on the candidate's machine; the heavy soaks (twin batteries, fuzzing, bootstrap stats) run on the spare Codex accounts** — the same-machine rule from D-LAUNCH-37 already reserves heavy suites for the candidate.
- Each organ marks output `SHADOW_SPECULATIVE`, seals an immutable receipt, and **parks** — it ports into a fresh worktree at `INTEGRATED_ACCEPTED`, is checked against the *accepted* interfaces, and only then becomes real. Shadow receipts never count as acceptance.
- **Nothing here merges now** — and that's the win: when C2 lands you have finished organs waiting to be ported, not a two-week build ahead of you.

## 8. Recommended build order for the reset windows

1. **Organ J (CLI-Agent Harness)** — the multiplier; build it first so the two accounts become unattended queued labor for everything else.
2. **Organs A+E as one FDR spine (Replay + Narrator)** — everything downstream needs replayable ground truth and the 5-second view.
3. **Organ B (Exchange Twin)** — start its long adversarial batteries early so they soak the whole window; build the funding engine first.
4. **Organ D (Invariant Constitution)** — cheap to start, finds real bugs immediately.
5. **Organ C (Chaos Range)** — once the twin is its arena.
6. **Organ H (Edge Instrument)**, then **F (Multi-Venue)** and **G (On-Chain senses)**, then **I (Governor)** last (needs B+H).

## 9. The one honest caution — and it's sharper than "complexity is costly"

Research made this concrete and it's the intellectually honest counter to "infinite compute = just run everything": **running thousands of simulations GUARANTEES spurious winners — the expected best Sharpe grows with the number of trials.** Without the deflation gate (deflated Sharpe / PBO / CPCV in the Twin, and the trials registry + SPA in the Edge Instrument), *more compute makes you more wrong, not less* — you'd manufacture confidence in a config that only won because you tried ten thousand. So the window's discipline is twofold: build only organs that pass the §2 selection law, **and** spend the compute on *generation AND deflation in tandem*, never generation alone. Used that way, the window buys a system you can see, prove, and survive when it goes live. Used carelessly, it buys expensive self-deception.

## Appendix A — research status (honest)

**Web-hardened with primary sources:** Twin (B), Narrator (E), Multi-Venue (F), Edge-Instrument (H), CLI-Harness (J).
**Design-grade, second pass owed:** Replay (A, research lane failed the output cap), Chaos (C, partially covered by the Twin fault layer), Invariant (D, lane returned a stub), On-Chain Senses (G, lane returned a stub), Governor (I, lane failed). Their designs stand on my own reasoning + adjacency from the hardened lanes; a follow-up research pass would sharpen them.

## Appendix B — key sources by organ

**Twin (B):** ABIDES/ABIDES-gym (par.nsf.gov/servlets/purl/10185795; arxiv 2110.14771), JPMorgan IABS (jpmorgan.com AI research pdf-12), HftBacktest (github.com/nkaz001/hftbacktest), Binance funding (binance.com/support/faq/detail/360033525031), deflated Sharpe (davidhbailey.com/dhbpapers/deflated-sharpe.pdf), LSEG chaos-on-AWS (aws.amazon.com/blogs/architecture/london-stock-exchange-group-uses-chaos-engineering…), May-19 outage (cnbc.com 2021/08/19), USDC depeg (cybrid.xyz/blog/2023-usdc-depeg-explained).
**Narrator (E):** Google SRE monitoring + SLO alerting (sre.google/sre-book/monitoring-distributed-systems; sre.google/workbook/alerting-on-slos), RED method (grafana.com/blog/the-red-method…), event sourcing (learn.microsoft.com/azure/architecture/patterns/event-sourcing), ECAM/dark-cockpit (en.wikipedia.org/wiki/Electronic_centralised_aircraft_monitor; airflow.blog dark-cockpit), AI-SRE timelines (incident.io/blog/what-is-ai-sre-complete-guide-2026), OTel semconv (opentelemetry.io/docs/specs/semconv).
**Multi-Venue (F):** cryptofeed (github.com/bmoscon/cryptofeed), CCXT Pro (github.com/ccxt/ccxt/wiki/ccxt.pro), Tardis (docs.tardis.dev), Binance mark-price (developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price), Hyperliquid ws (hyperliquid.gitbook.io), dYdX funding (docs.dydx.xyz/concepts/trading/funding), single-timestamp trap (dev.to/markettrace/why-a-single-timestamp-breaks-real-time-aggregation), normalization/latency (coinapi.io/blog/live-crypto-data…).
**Edge-Instrument (H):** deflated Sharpe + backtest-overfitting (davidhbailey.com/dhbpapers/deflated-sharpe.pdf; …/backtest-prob.pdf), PSR/MinTRL (portfoliooptimizer.io/blog/the-probabilistic-sharpe-ratio…), CPCV (insightbig.com/post/traditional-backtesting-is-outdated-use-cpcv-instead), White Reality Check (users.ssc.wisc.edu/~bhansen/718/White2000.pdf), Stepwise-SPA (homepage.ntu.edu.tw/~ckuan/pdf/Step-SPA…), implementation shortfall (ryanoconnellfinance.com/implementation-shortfall), Brier/calibration (en.wikipedia.org/wiki/Brier_score; scikit-learn.org/stable/modules/calibration.html), point-in-time correctness (towardsdatascience.com/point-in-time-correctness…).
**CLI-Harness (J):** codex exec headless (deepwiki.com/openai/codex/4.2-headless-execution-mode; developers.openai.com/codex/noninteractive), claude -p headless + auth (code.claude.com/docs/en/headless; …/authentication), Anthropic long-running-agent harness (anthropic.com/engineering/effective-harnesses-for-long-running-agents), codex scheduled tasks (codex.danielvaughan.com/2026/03/27/codex-cli-automations-scheduled-tasks), systemd oneshot/timer (redhat.com/en/blog/systemd-oneshot-service), SQLite agent queue (dev.to/minnzen/building-a-durable-message-queue-on-sqlite…), Claude Code limits (truefoundry.com/blog/claude-code-limits-explained).

*Advisory only. I remain read-only; this is a menu for the owner and commander to choose from, not a build order I execute.*
