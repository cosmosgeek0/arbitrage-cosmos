# MISSION — Cosmos Arbitrage Control Room

**Status:** Permanent product mission  
**Mission version:** 1.0  
**Pinned:** 2026-07-10  
**Project:** Cosmos Arbitrage Control Room  
**Role of this document:** Define what this project exists to become, why it exists, what economic problem it is trying to solve, what must remain true while it grows, and how any future human or agent should recognize alignment or drift.

This is not a blueprint, implementation plan, repository map, task brief, sprint log, handoff, or current-state report. Those documents describe the route, the machinery, and the present position. This document defines the destination. It should remain understandable even if the codebase, exchange adapters, models, page names, deployment stack, and development agents all change.

When the project accumulates too many documents, this file is the first compass. When two subordinate documents disagree about purpose, this file wins. When an agent proposes a feature and cannot explain how it advances this mission, that feature is not automatically valuable merely because it is technically impressive.

The mission is deliberately ambitious. It is also deliberately falsifiable. It does not promise profit, assume that the first strategies are valid, or claim that software can remove market risk. It defines the machine that must be built to discover whether a narrow edge exists, exploit it only when it survives reality, and preserve enough evidence to abandon it when it does not.

---

## The mission in one statement

Cosmos Arbitrage Control Room exists to become a private, continuously operating market-edge system that takes the owner’s capital, searches crypto markets for narrow and measurable inefficiencies, decides whether those inefficiencies are real, timely, executable, and worth the risk after every known cost, acts only through controlled and observable paths, protects capital when reality differs from expectation, learns from every observation and trade, and gives the owner complete operational control without requiring constant manual surveillance or terminal work.

The shortest version is:

> Discover a real inefficiency before it disappears, prove that it remains tradeable after costs and constraints, express it with controlled capital, survive execution and operational failure, measure the true result, learn from it, and stop when the edge is no longer real.

The system is allowed to reject almost everything. It is allowed to remain quiet. It is allowed to discover that the first two strategy hypotheses fail. It is allowed to change its technical architecture. It is not allowed to fake certainty, manufacture intelligence through decorative dashboards, confuse price movement with opportunity, hide missing data, ignore execution reality, or continue trading a pattern after evidence says the edge has disappeared.

The enduring product is not one basis scanner, one volume detector, one exchange integration, or one website. It is an adaptable operating system for finding, studying, validating, controlling, executing, explaining, and improving narrow market edges.

---

## Why this project exists

The objective is not to build another generic trading bot that predicts whether Bitcoin or the overall market will rise. Broad directional strategies can make money while accepting ordinary market beta and then give that money back when the regime changes. A system that merely adds a small amount of return to passive exposure is not the intended destination. Many existing products already provide charts, alerts, signals, exchange interfaces, technical indicators, and automated trend-following. Copying those products would create software, but not a proprietary edge.

The project begins from a different idea: markets sometimes become temporarily inconsistent with themselves.

Economically related instruments can move at different speeds. Spot and perpetual futures can diverge. Funding can reprice more slowly or more aggressively than the underlying gap. Borrow inventory can make one theoretically obvious arbitrage difficult or impossible. Liquidity can fragment. One side of a market can be easier to push than another. Forced positioning, leverage demand, liquidation pressure, market-maker inventory, exchange-specific constraints, participant attention, and temporary operational frictions can produce short-lived differences. A token that has been dormant can begin changing internally before the public chart looks dramatic. Order flow, spread, depth, trade arrival, spot-versus-perpetual leadership, open interest, and funding may begin to behave differently before the move becomes obvious.

Most visible inefficiencies are competed away quickly. Professional firms, market makers, and automated systems are already looking for them. That fact is not a reason to pretend an edge exists; it is the reason the system must be unusually strict. A visible gap is not profit. A pump is not automatically predictable. A volume spike is not automatically useful. The mission is to isolate the conservative residual that remains after market mechanics, costs, latency, liquidity, borrowing, and failure risk have been accounted for.

The project therefore treats every attractive story as a hypothesis to test, not a belief to protect.

If the first ideas fail, the work is not automatically wasted. A robust market-data layer, rolling feature store, event recorder, replay engine, focus hierarchy, proposal system, risk gate, execution boundary, ledger, control room, and research process can test the next hypothesis far faster than starting from zero. That reusable capability is part of the mission.

---

## The origin of the mission, in order

The mission did not begin as a desire to build a large dashboard. It began with hands-on experience building and running smaller automation systems where visible state, sequential safety, retries, and incremental tests mattered. That earlier experience established an operating lesson: a complex money system becomes trustworthy only when one working loop is made visible, tested at small scale, extended carefully, and protected by explicit safety checks.

The next stage was public market-data work. A separate public-data system proved that Binance spot, perpetual, funding, and market feeds could be collected, cached, stored, and surfaced. It also exposed a recurring failure mode: it is easy to spend enormous effort polishing a market website while the real economic engine remains shallow. The public system can donate data-handling lessons and visual quality, but the private Control Room is not the public Signal Lab and must not become another public-market clone.

The private project then grew around account truth, strategy state, risk, ledgering, and eventual execution. The website was designed because a real system cannot be operated safely through scattered scripts and command lines. However, UI construction began to dominate attention. The correction became clear: the edge, if one exists, lives mostly in the engine and the evidence loop. The cockpit exists to expose, control, and explain that engine. It cannot substitute for it.

The first concrete strategy idea came from observing a large temporary difference between a token’s spot price and perpetual futures price during a fast move. Spot appeared easier to move while perpetual liquidity lagged. That event raised the central economic question: if capital is being spent to force one related market away from another, and if the difference closes before funding, fees, slippage, borrowing, and execution risk consume it, can a machine capture part of the temporary dislocation?

The second concrete strategy idea came from repeatedly seeing dormant tokens suddenly become active and then move violently. An experienced trader may sense that something is changing before the public move is obvious. The owner described this as smell, taste, or the ability to sense blood before the visible event. The machine cannot inherit sixteen years of human experience directly. It can, however, watch hundreds of symbols continuously, preserve the pre-event sequence, compare every symbol with its own normal behavior, and convert useful observations into measurable, testable, revisable features.

Those two ideas—spot–perpetual divergence and dormant-to-active transition—are the first strategy families. They are not the final limits of the project.

The need to watch hundreds of assets without doing maximum-cost analysis on all of them led to the attention hierarchy: broad universe monitoring, candidate ranking, deep focus, opportunity formation, guarded execution, and highest-priority supervision of active capital.

The need to operate a complex system without continually issuing shell commands led to the Control Room: a real behavior interface where every button changes a real backend state, every important subsystem exposes its health, and the owner can halt, isolate, reduce, inspect, and recover the system.

The difficulty of coordinating long AI-assisted development led to a second kind of memory: canonical project documents, narrow task briefs, isolated work ownership, milestone commits, and exact resume points. The owner should be able to replace a development director without retelling the entire history.

This mission file pins all of those intentions into one stable statement.

---

## The economic objective

The economic objective is positive, repeatable, risk-adjusted net returns produced by identifiable market inefficiencies rather than luck, hidden directional beta, unmeasured leverage, or unpriced operational risk.

“Net” is essential. The system must account for every economic drag that can turn an attractive signal into a losing trade:

- entry and exit fees on every leg;
- spot and derivatives spread;
- expected and realized slippage;
- market impact at the intended size;
- funding before, during, and after the expected holding window;
- borrow interest and borrow availability;
- collateral requirements and liquidation risk;
- stale quotes and data-source disagreement;
- latency between observation, decision, approval, and execution;
- partial fills, failed cancellations, and one-leg exposure;
- exchange filters, minimum notional, tick size, and quantity steps;
- infrastructure cost and operational interruption;
- recovery or emergency unwind cost.

The headline percentage difference is not the edge. The edge is the conservative residual after all known costs and risks, adjusted for uncertainty.

The system should prefer no trade to an unmeasured trade. Zero trades can be correct. A quiet dashboard can represent discipline rather than failure. The goal is a money-generating machine, not an activity-generating machine.

The owner’s initial proof target is modest capital and complete evidence. Capital increases only after the full loop demonstrates both positive expectancy and operational reliability over a meaningful sample. A short winning streak, a large codebase, or an eloquent model explanation does not justify larger size.

The commercial aspiration is larger. If the platform becomes genuinely capable, reliable, and independently valuable, it may later support more capital, more venues, or become valuable to a professional firm. That is not the first proof. The first proof is that it can make and protect the owner’s money for reasons that can be reproduced and audited.

---

## The first market: Binance as the first adapter

The project begins with Binance because it offers a finite and observable universe of spot and perpetual instruments, substantial liquidity, public market streams, funding and derivatives context, account interfaces, margin and borrowing capabilities, and test or validation paths.

Binance is the first controlled environment, not the identity of the system. The abstraction is not “a Binance bot.” The abstraction is “a market-edge operating system whose first exchange adapter is Binance.”

The system should eventually be able to add other centralized exchanges, decentralized venues, on-chain liquidity, lending markets, and external data sources when a strategy genuinely requires them. It must not expand merely to look sophisticated. New integrations are justified only when they materially improve detection, validation, borrowing, hedging, execution, or risk.

The first venue should be understood deeply enough that the entire loop—from broad market observation to an economically attributable result—works before the project spreads itself across many venues.

---

## The first edge hypothesis: spot–perpetual divergence

The first strategy family studies temporary divergence between an asset’s spot market and its perpetual futures market during fast movement.

There are four directional conditions:

1. the asset is rising and spot leads perpetuals;
2. the asset is rising and perpetuals lead spot;
3. the asset is falling and spot leads perpetuals;
4. the asset is falling and perpetuals lead spot.

These are economically different. The source of pressure, likely convergence path, available trade structure, funding exposure, borrow requirement, liquidity condition, and danger of the wrong leg can differ in each state.

When perpetual futures are expensive relative to executable spot, a conceptually market-neutral structure may buy spot and short perpetuals. When spot is expensive relative to perpetuals, the neutral construction may require borrowing the base asset, selling it in spot, and buying perpetuals. The second construction does not exist merely because a formula reports a positive number. It exists only when the asset can be borrowed in sufficient size, at an acceptable interest rate, under the correct account mode, with acceptable collateral and liquidation risk, and when both legs can be placed without creating dangerous naked exposure.

The engine must use executable prices, not merely last price, candle close, mark price, or mid-price. It must distinguish:

- raw mid basis;
- executable entry basis in each direction;
- expected exit basis;
- spot and perpetual bid/ask spread;
- intended-size depth;
- funding rate and time to funding;
- open and close fees on both legs;
- expected slippage;
- borrow amount, rate, inventory, and validity window;
- quote freshness and event time;
- estimated latency;
- maximum tolerable one-leg exposure;
- emergency hedge and unwind cost.

The mission is not to wait for a fixed ten-percent difference, enter full size, and hope. Divergence is a path. It can appear gradually, accelerate, pause, widen, converge, or reverse within seconds. The system must know which market caused the change, how long the gap has existed, how quickly it is changing, whether it persists through multiple observations, whether volume and depth confirm it, whether funding already compensates for it, and whether the remaining conservative edge is growing or decaying.

This creates a hypothesis of staged participation. A small initial allocation may be justified when evidence becomes meaningful but uncertain. Additional size may be permitted as persistence, liquidity, and confirming evidence improve. Size may stop increasing when the gap becomes unstable, funding changes, depth disappears, or the expected residual shrinks. Exposure may be reduced in stages as convergence begins instead of waiting for one binary exit. This staged policy is not assumed to be optimal; it must be replayed and compared with alternatives.

The basis subsystem is therefore not merely a spread calculator. It must become:

- a real-time state estimator for related instruments;
- an economic feasibility calculator;
- a candidate prioritizer;
- a borrow-aware trade constructor;
- a proposal generator;
- a staged entry and exit planner;
- and eventually a controlled two-leg execution supervisor.

It must be capable of saying “no trade” for a named reason such as stale data, insufficient depth, edge below costs, funding against the structure, missing borrow, borrow too expensive, gap not persistent, account state unknown, or risk blocked.

---

## The second edge hypothesis: dormant-to-active transition

The second strategy family studies how a quiet or nearly dead token changes before and during a sudden expansion in activity.

A list of highest-volume assets does not solve this problem. It mostly shows assets that are already active. A simple “volume increased” alert also does not solve it. Crypto markets contain routine bursts, repeated false starts, liquidation cascades, market-making noise, wash-like activity, short-lived manipulative events, and mechanical reactions that attract naive bots.

The target is transition, not magnitude.

Every symbol must be understood relative to itself. The same raw volume can be normal for one asset and extraordinary for another. The system should maintain rolling and historical baselines for the variables that describe the asset’s normal state and the way that state changes.

Potential evidence includes:

- quote and base volume across multiple rolling windows;
- trade count and inter-trade time;
- average, median, and tail trade size;
- aggressor-side imbalance;
- price response per unit of aggressive flow;
- spread level and spread compression;
- best-bid and best-ask quantity;
- depth at several distances from the book;
- order-book replenishment and depletion;
- cancellation and replacement behavior where observable;
- spot-versus-perpetual activity and leadership;
- open-interest level and acceleration;
- funding and premium changes;
- volatility and range expansion;
- liquidation activity;
- repeated prior wake-and-fade behavior;
- correlation breakdown against market and sector peers;
- news or scheduled-event context when available;
- data quality and source agreement.

The important question is not only “did volume rise?” It is “how did the market begin to change?”

Did many small aggressive buys arrive after a long quiet period? Did unusually large orders repeatedly absorb offers without moving price much? Did the spread tighten before activity expanded? Did depth appear, vanish, or migrate? Did spot activity lead perpetual activity? Did open interest expand without an equivalent price move? Did selling fail to push the price lower, suggesting absorption? Has this token produced similar false bursts recently? Did the anomaly persist across 1-second, 5-second, 15-second, 1-minute, and 5-minute windows, or was it one isolated event?

The objective is not to claim mystical prediction. It is to create a measurable approximation of expert smell. The system should eventually be able to explain a candidate in a form such as:

> This symbol was dormant relative to its own baseline. Trade arrival accelerated persistently. Spot aggressive buying began before the visible price move. Offers were repeatedly absorbed. Spread remained controlled. Depth was sufficient at the intended size. Perpetual positioning had not yet become crowded. Similar historical states produced more favorable follow-through than the unconditional baseline.

That statement can be wrong. It must be explicit, replayable, versioned, and scored against outcomes.

The system must also distinguish prediction from reaction. Some opportunities may be detectable before visible expansion. Others may be recognized only after movement begins, but still early enough to evaluate whether continuation is real, whether the move is already exhausted, and whether the downside can be bounded. “Before,” “during,” and “too late” are different market stages and must not be mixed in one score.

---

## Beyond the first two strategies

Basis and volume are the first lenses, not the limits of the system.

Future opportunities may involve:

- funding dislocation;
- open-interest acceleration or collapse;
- borrow scarcity;
- liquidation pressure;
- spot–perpetual lead and lag;
- cross-exchange or cross-venue divergence;
- unusual trade-size distribution;
- order-flow imbalance;
- depth migration;
- spread compression or expansion;
- volatility regime change;
- correlation breakdown;
- listing or delisting mechanics;
- scheduled events;
- on-chain liquidity movement;
- lending-market changes;
- or other patterns discovered through the ledger and research process.

The platform must make it possible to add a new lens without creating an untraceable pile of conditions. Every new feature needs:

- a precise definition;
- a source and provenance;
- a freshness expectation;
- a missing-data behavior;
- a known failure mode;
- historical availability;
- computational cost;
- a reason it might add incremental information;
- a version;
- and a test or replay path.

More variables can create an illusion of intelligence. One hundred correlated indicators do not equal one hundred independent signals. Complexity is justified only when it materially improves detection, calibration, economic feasibility, execution, or risk in measured tests.

The mission permits rich instrumentation. It does not permit hiding overfitting behind feature count.

---

## The attention hierarchy

The system must behave like an organization whose attention becomes more expensive as confidence and capital relevance increase.

### Universe observation

The entire eligible market is watched continuously with a lightweight data and feature set. This layer is broad, fast, cheap, and skeptical. It does not decide trades. Its job is to notice change early, maintain clean state, and avoid missing the beginning of an event.

### Candidate ranking

Symbols that become unusual are promoted into a candidate state. This layer combines multiple lenses and asks whether the change is fresh, persistent, unusual relative to the symbol’s own baseline, and potentially executable. It prevents every transient tick from consuming deeper resources.

### Focus analysis

A smaller number of symbols enters focus mode. These symbols receive richer feeds, deeper order-book tracking, aggregate trade analysis, contextual history, more frequent evaluation, and explicit thesis updates. Multiple focus symbols must remain comparable so the system can decide which deserves priority.

Priority cannot be a single largest number. It should reflect expected net edge, confidence calibration, speed of change, time sensitivity, liquidity, capital requirement, borrow feasibility, operational feasibility, downside if wrong, and how much useful information deeper monitoring is likely to produce.

### Opportunity formation

The strongest candidates become structured opportunities. An opportunity states:

- what the system believes is happening;
- which evidence supports it;
- what evidence conflicts with it;
- the market stage;
- the trade structure that would express the thesis;
- the expected conservative net edge;
- the uncertainty;
- the proposed size or staged size;
- the conditions that must remain true;
- the invalidation;
- the entry plan;
- the exit plan;
- the recovery plan;
- and the exact reasons for rejection if it does not pass.

### Guarded execution

Execution acts only after the required gates. It must not reinterpret the strategy casually. It implements an approved intent, detects deviation, and protects the account when fills, latency, exchange behavior, or market movement make the original plan impossible.

### Active-capital supervision

Once capital is exposed, that position becomes the highest-priority object in the system. Monitoring cannot stop after entry. The system must know whether the expected convergence or continuation is occurring, whether funding or borrow cost is changing, whether one leg is exposed, whether liquidity is deteriorating, and whether the safest action is to hold, add, reduce, hedge, or exit.

This hierarchy turns hundreds of eligible symbols into a small number of serious decisions without pretending that every symbol deserves maximum computation at all times.

---

## One operating system, not disconnected pages

The website is the cockpit of the system. It is not a decorative frontend attached to unrelated scripts. Every important page should expose a real part of one canonical backend state. Every meaningful control should map to an actual behavior. The UI and the engine must not disagree because they calculate the same concept independently.

### Dashboard

The Dashboard is the command summary. It should answer “what is happening now?” without making the owner search through logs.

It should reveal:

- whether the system is alive;
- which data feeds and runtime agents are healthy;
- account equity and available capital;
- current PnL and drawdown;
- enabled strategies;
- active universe and focus counts;
- current opportunities;
- open orders and positions;
- risk consumed and remaining;
- recent important decisions;
- system failures or degraded modes;
- and the exact items that require attention.

It should not become a wall of decorative status cards or random quick actions.

### Account

The Account area is the source of capital truth. It should reconcile balances, collateral, spot assets, futures equity, margin state, available capital, and account freshness. It should eventually support multiple exchange accounts without confusing them.

This page does not need to imitate every Binance wallet screen. It must show the account information that changes strategy feasibility, risk, and execution.

### Markets

The Markets page is the first manual intelligence filter and a visible window into the engine’s broad scanner. Its purpose is not to reproduce Binance’s generic price table.

It should allow the owner to sort and filter the full universe by mission-relevant lenses. A basis view should expose executable directional gaps, funding, persistence, slope, liquidity, and cost. A wake-up view should expose dormancy, activity acceleration, transition stage, and false-positive context. Flow, liquidity, and derivatives views should expose the variables that help determine whether a symbol deserves focus.

The Markets page should use the same canonical feature store and ranking logic as the engine so manual inspection and machine reasoning do not contradict one another.

### Token

The Token page is the deep inspection surface for one symbol. It should reconstruct what changed, when it changed, which market led, how current behavior differs from the symbol’s own history, what order flow and liquidity look like, which strategy hypotheses are active, what data is missing, and why confidence changed.

The Token page is where the owner examines the evidence behind the smell. It is not merely a chart plus an order book.

### Basis

The Basis workspace is the strategy surface for spot–perpetual divergence. It should expose:

- the four directional conditions;
- current and historical scanner state;
- candidate ranking;
- executable economics;
- gap age, direction, persistence, and slope;
- funding timing and pressure;
- borrow feasibility;
- staged entry and exit logic;
- current basis positions;
- leg status;
- and every named rejection.

### Volume

The Volume workspace is the strategy surface for dormant-to-active transitions. It should expose:

- quiet-state baselines;
- emerging anomalies;
- candidate and focus symbols;
- event timelines;
- flow confirmation;
- spot/perpetual leadership;
- prior false positives;
- transition stage;
- and what the engine saw before the visible move.

### Opportunities

The Opportunities page is where intelligence becomes a decision. It is the proposal queue and explanation layer. It should contain only structured opportunities with evidence, uncertainty, expected net value, trade construction, risk, invalidation, current stage, and status.

Rejection is part of the product. The owner must be able to see why the engine refused a tempting signal. A system that only displays approvals hides most of its intelligence.

### Borrow

The Borrow area is the source of borrowing truth. It answers whether a reverse-basis structure is possible, how much can be borrowed, at what cost, under which account mode, with what collateral and inventory constraints, and how fresh that information is.

A visible reverse basis without verified borrow is not an opportunity.

### Execution, Orders, Positions, Fills, and PnL

Execution truth must remain connected to strategy intent.

Every order and fill should be attributable to a proposal, strategy, model version, approval, and risk decision. Every position should show why it exists, what condition keeps it valid, how it should be exited, and what recovery policy applies if the original structure breaks.

PnL must decompose the result rather than show one number. It should distinguish:

- directional movement;
- basis convergence;
- funding;
- borrow interest;
- trading fees;
- spread;
- slippage;
- execution error;
- one-leg exposure;
- and infrastructure or operational loss where relevant.

### Risk

Risk is the deterministic guard. It should expose current limits, utilization, concentration, daily loss, open exposure, liquidity constraints, stale data, failed-leg risk, cooldowns, symbol permissions, strategy permissions, and the global halt state.

It should explain the exact gate that blocks an action. “Risk rejected” is not sufficient.

### Health

Health is operational truth. It should show feed freshness, connection state, clock drift, queue lag, CPU and memory pressure, storage health, API latency, database lag, exchange errors, runtime-agent heartbeat, reconciliation state, and degraded mode.

A process being alive does not mean the system is healthy. Health means the component is receiving current data, advancing calculations, producing plausible outputs, and able to perform its responsibility.

### Logs and Ledger

Logs are the full auditable history. They must preserve market decisions, state transitions, candidate promotions, focus assignments, proposals, rejection reasons, risk outcomes, configuration changes, order intents, exchange responses, fills, errors, repairs, and manual interventions.

The log interface should summarize by severity and importance without flooding the owner with meaningless connection chatter. Debug noise can exist, but it should not dominate normal operation.

### Notifications

Notifications are the compressed attention layer. They should surface only events that require awareness or action. They are not a duplicate of every log entry.

### Control Room

The Control Room is the direct behavior interface. It may eventually contain many controls because the system has many behaviors. The count is not the problem. Unmapped, duplicated, unsafe, or fake controls are the problem.

The owner should be able to:

- pause one strategy without stopping all monitoring;
- stop new proposals while continuing to supervise open positions;
- reduce permitted size;
- block or allow a symbol;
- adjust a threshold within safe bounds;
- force paper or read-only mode;
- isolate a failing data source;
- restart or recover a subsystem safely;
- acknowledge an alert;
- and trigger a controlled diagnostic or repair path.

Every control needs ownership, validation, safe ranges, defaults, persistence, versioning, change history, and a clear explanation of whether it applies immediately or requires a staged restart. A control that does nothing is worse than no control.

### News and Calendar

News and Calendar are contextual inputs, not the core edge. They may explain anomalies, prevent trading into scheduled risk, or become features in a future model. They must not turn the product into a generic content dashboard.

---

## Control must be designed into the engine

The owner must not be forced to operate a live system through shell commands, manual file edits, or emergency Git commits.

The cockpit should become the normal operational interface. This does not mean every internal parameter should be exposed. Some parameters are dangerous, interdependent, or meaningful only within a versioned strategy configuration. The system must decide which controls are operator-facing and which require a reviewed deployment.

The global kill switch must remain immediately reachable and gate every new order action. Subsystem controls must support graceful degradation:

- stop one strategy but keep the others;
- stop new entries but continue exit supervision;
- switch to read-only;
- preserve account reconciliation while market intelligence is degraded;
- isolate one data source;
- continue ledgering during partial analytical failure;
- and recover durable state before resuming.

The system may automate diagnosis and repair preparation. An AI agent may inspect logs, propose a change, open a branch, run tests, and prepare a deployment. It must not silently change live risk, enable trading, or send orders. Operational automation and capital authority remain separate.

---

## Reliability is part of the edge

A theoretical opportunity is worthless if the system is stale, disconnected, overloaded, unable to borrow, unable to place both legs, unable to reconcile the account, or unable to exit.

Reliability is not an infrastructure side quest. It is part of the economic calculation.

The system must assume:

- WebSocket connections disconnect;
- exchange interfaces change;
- events arrive late or out of order;
- data becomes stale;
- rate limits are reached;
- clocks drift;
- databases lock;
- queues back up;
- processes crash;
- networks partition;
- APIs partially fail;
- and exchange state can differ from local state.

Every important component needs a defined state, heartbeat, freshness threshold, retry and backoff policy, reconciliation method, durable checkpoint, and degraded behavior.

A failure in a nonessential page must not stop risk supervision. A failure in one analytical lens must not necessarily stop market collection. A failure in new-signal generation must not stop supervision and exit of open positions. A primary-process failure must be detected externally. After restart, the system must reconcile with the exchange before taking new action.

Two-leg trades require special treatment. The system must never assume simultaneity. It must model:

- one leg fills and the other does not;
- partial fills on either leg;
- price movement between legs;
- rejected or delayed orders;
- cancellation failure;
- lost or delayed acknowledgements;
- restart during execution;
- and unavailable borrow after a proposal was formed.

Every multi-leg proposal must define the maximum allowed naked exposure, leg order, timeout, retry policy, hedge or unwind path, and ledgered recovery state.

No subsystem should report “healthy” merely because its process exists.

---

## Money, authority, and safety boundaries

Real money requires authority to narrow as an action moves closer to execution.

Market-data collection can be automatic. Feature computation can be automatic. Candidate promotion can be automatic. Deep analysis can be automatic. Proposals can be automatic. Live execution begins manually and remains behind deterministic gates until substantial evidence supports any later increase in automation.

The permanent safety boundaries are:

- no withdrawal capability;
- no transfer-out capability;
- no secrets in the browser;
- no secrets in the repository;
- no secrets in logs, screenshots, task briefs, or coding-agent prompts;
- production keys restricted to the minimum permissions and network scope required;
- strategy modules cannot call exchange order endpoints directly;
- one controlled executor boundary;
- a global kill switch before every new order action;
- account reconciliation before live action;
- fresh market data before live action;
- exchange-filter validation;
- strategy and symbol permission checks;
- deterministic risk checks;
- and required human confirmation during the manual phase.

Paper mode is the default. Replay, simulation, test orders, and testnet precede small live capital. Capital should begin small enough that a failure teaches rather than destroys. Larger size requires evidence from the complete operating loop, not confidence created by code volume or model language.

The system must never become a tool for market manipulation. It must not create fake volume, wash trade, spoof, coordinate pumps, deceive other participants, or use nonpublic stolen information. The system studies and responds to lawful market data; it does not manufacture the anomaly it seeks to trade.

---

## The ledger is the machine’s memory

The running system must not depend on the owner remembering what happened, a chat transcript surviving, or an agent recalling last week’s decisions.

The ledger should preserve enough information to reconstruct the complete evidence chain:

- raw or normalized market observations required for replay;
- feature snapshots;
- source provenance and freshness;
- symbol state transitions;
- candidate promotions;
- focus assignments;
- strategy evaluations;
- named rejection reasons;
- proposal content;
- confidence and model versions;
- risk decisions;
- configuration changes;
- approvals;
- order intents;
- exchange requests and responses;
- fills and positions;
- funding and borrow interest;
- fees and slippage;
- errors and recoveries;
- manual interventions;
- and final outcomes.

This memory must answer:

- What did the system know before the event?
- Which feature changed first?
- Why was a symbol promoted?
- Why did it enter or reject?
- Which cost was underestimated?
- Which opportunity was missed?
- Which false positives repeat?
- Did a code change improve live behavior or only a backtest?
- Is the strategy degrading?
- Did an operational failure create or erase the economic result?

Project documentation is a second kind of memory. Its roles must remain distinct:

- `MISSION.md` explains the stable destination and why the project exists.
- The blueprint explains the intended product shape.
- Engine and architecture documents explain current technical design.
- Project memory and build-state files explain what exists now and what comes next.
- Architecture Decision Records explain major choices.
- Task briefs are temporary work instructions.

Agents must update the correct canonical memory after meaningful work. They must not create endless overlapping files to appear thorough. The project should accumulate intelligence, not documentation entropy.

This mission file changes rarely. It is not a run log.

---

## The development hierarchy

There are two different kinds of agents in this project and they must not be confused.

### Development agents

The owner speaks at the mission and product level. A primary manager translates that intent into a bounded outcome. A coding director inspects the repository and canonical documents, then decomposes the outcome into narrow tasks. Specialized workers research, implement, test, audit, or verify those tasks.

The owner should not need to tell the full story to every worker. A narrow worker receives:

- the mission-relevant objective;
- its exact subsystem or files;
- the contracts it must preserve;
- current state;
- acceptance criteria;
- tests;
- and the exact output expected.

Frontier agents are encouraged to research, challenge assumptions, discover additional variables, and propose better means. They are not restricted to only what the owner happened to imagine. Their freedom exists inside the mission and safety boundaries. They may improve the means; they may not replace the mission with a generic product or grant themselves live capital authority.

Parallel work is allowed only where ownership boundaries prevent collisions. Shared core files require sequential work, isolated worktrees, or a director-owned merge. Every meaningful slice should leave a working state, tests, observability, updated canonical memory, a milestone commit, and an exact resume point.

### Runtime agents

The runtime system may also contain specialized analytical agents or loops: universe watchers, candidate rankers, focus monitors, basis analyzers, volume-transition analyzers, opportunity evaluators, active-position supervisors, risk guards, and recovery monitors.

These runtime agents are not unrestricted AI personalities. They are bounded components with typed inputs, explicit outputs, state, freshness, reason codes, and authority limits. Their behavior must remain observable and replayable.

---

## The correct build philosophy

The system will take days, weeks, and repeated trials. The correct response is neither a tiny toy nor an unbounded code dump.

A toy is dangerous because it creates false confidence and becomes a weak foundation. A massive one-shot build is also dangerous because untested complexity hides incorrect economics, duplicated state, dead code, and contradictory assumptions.

The mission requires a large eventual capability built through coherent, complete, testable increments.

Each increment should be structurally real:

- a universe module should represent the full eligible universe;
- a rolling feature layer should support the windows strategies need;
- a scanner should produce real state transitions and reason codes;
- an API should expose canonical truth;
- a control should change real behavior;
- a page should render real backend state;
- a strategy should support replay before capital;
- and an executor should support recovery before scale.

Testing cannot be postponed until the end. At the same time, development must not become trapped polishing a tiny component while the foundational system is missing. The rhythm is:

1. establish the necessary skeleton;
2. complete one meaningful vertical slice;
3. test its contracts;
4. integrate it;
5. verify runtime and UI truth;
6. update canonical memory;
7. checkpoint it;
8. move forward.

Line count is not a measure of intelligence. The codebase should become large only because the product contains many real capabilities.

The long-term effort doctrine is engine-first. UI matters when it exposes engine truth, operator control, risk, execution, health, or learning. UI that merely reproduces information available on Binance is secondary.

---

## Research, falsification, and realism

The first two strategies are plausible hypotheses, not proven laws.

Professional firms already compete for arbitrage and short-horizon signals. A visible spread may compensate for a risk not yet modeled. A pre-pump pattern may exist only in hindsight. Borrow can disappear exactly when it is needed. A symbol can gap through the planned exit. Public data may not contain enough information to infer intent.

The system must therefore be designed to disprove its own ideas.

Every strategy needs:

- a baseline;
- a precise target;
- a versioned feature set;
- calibrated scores;
- named reject reasons;
- a replay path;
- out-of-sample evaluation;
- realistic execution simulation;
- paper operation;
- and a controlled live promotion path.

Backtests must guard against look-ahead bias, survivorship bias, data selection, repeated-trial overfitting, leakage, unrealistic fills, and ignoring delisted or unavailable symbols. Simulation must include latency, spreads, order constraints, funding timing, slippage, partial fills, and unavailable borrow.

The engine must separate prediction from execution. A highly predictive event may be untradeable. A modestly predictive event can be valuable if losses are small and the upside is asymmetric. The objective is conservative expected net value under constraints, not an attractive win rate or impressive confidence number.

Missed trades and rejected trades matter. False positives must be preserved. Failure cases must not be deleted to make a model look better.

---

## Learning and adaptation

The system should improve continuously, but self-improvement does not mean a model may rewrite live strategy code or risk limits without review.

Improvement begins with measurement. The platform should compare predicted and realized outcomes, track feature attribution, identify recurring rejection and failure patterns, and produce research candidates. Offline research can test alternative thresholds, ranking functions, staged-entry policies, and models against replay data.

A proposed change receives:

- a hypothesis;
- an evidence report;
- a version;
- tests;
- out-of-sample evaluation;
- paper deployment;
- observed comparison with the prior version;
- review;
- and a promotion or rejection decision.

Human intuition becomes machine taste one explicit piece at a time. When an experienced observer identifies absorption, repeated failed breakdowns, spot leadership, unusual order-size distribution, or another behavior, the project attempts to define it, measure it, test its incremental value, and record where it fails.

Strategy retirement is also improvement. If an edge becomes crowded or no longer survives costs, the correct action is to reduce size, disable it, preserve its history, and direct the platform toward a better hypothesis.

---

## What success means

The first proof of success is not a polished interface, a large codebase, thousands of signals, or a model-generated confidence score.

The first proof is a complete evidence chain from observation to economic result.

A successful opportunity should be traceable as follows:

The system observed a specific change and knew when it began. It compared that change with relevant history. It promoted the symbol for a named reason. It moved from broad monitoring to focused analysis. It calculated executable prices rather than theoretical prices. It included fees, funding, borrow, liquidity, spread, slippage, timing, and operational risks. It either rejected the event for a named reason or created a structured proposal. Risk determined how much capital, if any, was allowed. Execution handled fills, delay, cancellation, recovery, and each leg. The ledger recorded the expected and actual path. PnL was decomposed. The result was evaluated against the original thesis. The system used the record to improve without rewriting history.

The long-term product succeeds when that loop becomes repeatable across many hypotheses.

It should know not only gross PnL but net PnL by:

- strategy;
- market regime;
- symbol class;
- confidence bucket;
- entry stage;
- holding period;
- reason code;
- execution path;
- and model version.

It should measure:

- detection lead time;
- candidate precision and recall where definable;
- score calibration;
- false-positive rate;
- missed-opportunity rate;
- conservative expected value versus realized value;
- execution shortfall;
- maximum one-leg exposure duration;
- data freshness and source reliability;
- risk-limit utilization;
- drawdown;
- strategy decay;
- system uptime;
- recovery time;
- and number of unintended order or authority violations, which should remain zero.

The system is not successful merely because it traded. It is successful when it can explain why it acted, why it refused, how much it truly made or lost, and whether the same reasoning remains valid.

---

## What this project must never become

It must never become a generic Binance clone whose primary achievement is displaying prices available elsewhere.

It must never become a card-filled dashboard that looks sophisticated while the backend lacks meaningful intelligence.

It must never become an opaque AI oracle that announces trades without reproducible evidence and deterministic risk controls.

It must never become a chart-pattern casino that confuses direction with inefficiency.

It must never become a manipulation system. It must not fake volume, wash trade, spoof, coordinate pumps, or deceive participants.

It must never expose secrets to the browser, repository, logs, screenshots, or development agents.

It must never contain withdrawal or transfer-out behavior.

It must never place a live order through an unguarded path.

It must never treat missing data as valid data, stale data as live data, a disabled feature as running, a backtest as realized performance, or a visible spread as guaranteed profit.

It must never make the owner depend on one giant chat context to understand the project.

It must never allow documentation volume, agent chatter, line count, or UI polish to substitute for a working and measurable economic loop.

It must never continue a strategy because of sunk cost after evidence says the edge is gone.

---

## The end state

The final system is a private market-edge operating room.

It watches the full eligible market continuously without drowning in it. It notices early changes across multiple lenses. It promotes a small number of symbols into deeper attention. It reconstructs what is happening across spot, perpetuals, funding, flow, liquidity, open interest, borrow, external context, and account state. It distinguishes an exciting move from an economically executable opportunity. It ranks opportunities by conservative expected value, urgency, and downside. It produces a trade thesis with evidence, uncertainty, staged size, invalidation, exit, and recovery. It gives the owner control over the decision. It executes through one guarded hand. It remains aware while capital is exposed. It records everything. It survives partial failure. It explains PnL. It learns from outcomes. It can test a new edge without being rebuilt from zero.

In daily use, the owner should not need to stare at hundreds of charts, manually compare hundreds of symbols, monitor every funding timer, query borrowability, calculate fees, watch two order books simultaneously, or search raw logs for every problem. The system performs the continuous mechanical work and presents only the decisions and failures that deserve attention. When the owner chooses to inspect deeply, the complete evidence should already exist.

The product is mature only when it can be trusted not merely to find opportunities, but to refuse bad ones, survive operational problems, account for every unit of capital, and stop itself when its assumptions are no longer true.

That is the mission.

---

## The permanent mission test

Whenever the owner, a manager, a coding director, or a worker is unsure what to build, remove, or prioritize, ask:

> Does this change materially improve the system’s ability to discover, validate, execute, control, explain, survive, or learn from a real market inefficiency—without weakening safety, truth, or operational reliability?

If the answer is yes, the work belongs.

If the answer is no, it is probably decoration, duplication, premature expansion, or drift.

---

## Reality and research anchors

This mission is ambitious, but the first-stage mechanics are technically feasible.

Binance’s official documentation exposes public Spot and USD-M Futures market streams, best bid and ask updates, mark price and funding updates, aggregate trade and depth data, derivatives context such as open interest and taker buy/sell statistics, signed margin queries for current maximum borrowable amounts, user-data order updates, and order-validation paths. These capabilities support broad market scanning, progressive focus, executable basis calculations, borrow-aware reverse-basis feasibility, account reconciliation, and guarded execution. Exact endpoints, limits, schemas, hostnames, and exchange behavior must be reverified before each implementation because exchange interfaces change.

The research literature supports the need for realism rather than the certainty of profit:

- Igor Makarov and Antoinette Schoar, *Trading and Arbitrage in Cryptocurrency Markets*, documents persistent but constrained crypto price deviations and emphasizes that limits to arbitrage matter.
- Rama Cont, Arseniy Kukanov, and Sasha Stoikov, *The Price Impact of Order Book Events*, finds that short-horizon price changes are strongly related to order-flow imbalance and market depth in the studied markets. This supports measuring flow and depth, but it is not proof that the same model transfers unchanged to every crypto token.
- Joshua Kamps and Bennett Kleinberg, *To the Moon: Defining and Detecting Cryptocurrency Pump-and-Dumps*, shows that anomalous behavior can be used to flag pump-and-dump events. Detection of anomalous activity is not the same as guaranteed profitable early prediction.
- Research on cryptocurrency pump-and-dump ecosystems shows that coordinated events can create abnormal volume and price behavior, while also demonstrating why such events are dangerous, adversarial, and full of false positives.

These sources justify building instrumentation and tests. They do not prove that the basis or volume hypotheses will be profitable.

Canonical implementation references should remain in technical documents rather than dominate this mission. At minimum, implementation agents should verify the current official Binance documentation for:

- Spot WebSocket streams;
- USD-M Futures WebSocket market streams;
- all-symbol book tickers;
- mark price and funding streams;
- aggregate trades;
- depth streams;
- open interest and taker buy/sell statistics;
- margin maximum borrowable and interest-rate history;
- user-data order updates;
- exchange filters;
- and test-order or testnet behavior.

---

## Change policy for this mission

This file is intended to be stable.

It should not be rewritten after every feature, UI change, commit, strategy parameter adjustment, exchange endpoint change, or agent run. Those belong in blueprints, architecture records, engine documents, build-state files, and project memory.

This mission changes only when the owner changes the destination, the permanent safety boundaries, the central economic objective, or the fundamental identity of the product.

Any change should:

1. preserve the previous version in Git history;
2. state why the mission itself changed;
3. distinguish a real mission change from an implementation change;
4. update the version and date;
5. identify which subordinate documents must be reconciled;
6. and avoid silently deleting prior constraints.

A new director should be able to read this file first, then inspect the current-state documents and repository, and immediately understand both where the project is going and where it currently stands.
