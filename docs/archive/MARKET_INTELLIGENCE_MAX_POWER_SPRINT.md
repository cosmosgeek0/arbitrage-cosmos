# MARKET INTELLIGENCE MAX-POWER SPRINT

**Project:** Cosmos Arbitrage Control Room  
**Builder:** one Codex 5.6 Ultra lead using bounded parallel agents  
**Working checkout:** `/Users/cosmosgeek/Desktop/Main`  
**Purpose:** Build the missing full-universe market-sensing, evidence, attention, and Volume-intelligence organs described in `What-i-want.txt`.  
**This is construction:** implement real deterministic TypeScript modules and tests now. Do not produce another planning-only report.

---

## 1. Start immediately, but protect Main

Before editing:

1. Work only in `/Users/cosmosgeek/Desktop/Main`.
2. Confirm no other writer is using Main. The separate backend-foundation Codex owns its isolated clone, not Main.
3. Require `git status --porcelain` to be empty.
4. Record current branch and HEAD SHA.
5. Create and switch to a new branch named `market-intelligence-main-20260711` (add a numeric suffix if it already exists).
6. Run the current build and complete bounded test command once. Record the result.
7. If Main is dirty or another writer is active, stop before editing and report the exact blocker. Do not stash, reset, clean, move, or overwrite anything.

Do not wait for routine clarification. Inspect the actual post-audit source, make safe decisions, and continue through the acceptance gate.

---

## 2. Read only what matters

Read:

1. applicable `AGENTS.md` files;
2. `What-i-want.txt` completely;
3. `MISSION.md`;
4. current-truth header of `PROJECT_MEMORY.md`;
5. existing `server/src/engine/volume/**` and its tests;
6. existing `server/src/engine/basis/**` only to understand shared evidence needs;
7. existing market-data/runtime adapters and package/test configuration;
8. this directive.

Do not spend the sprint reading the entire historical journal.

Before creating a module, search current source for equivalent behavior. Existing Basis and Volume engines remain strategy authorities. Extend the evidence substrate around them; do not create another scanner, proposal queue, ledger, control plane, risk engine, execution coordinator, or runtime cache.

---

## 3. Exclusive write territory

All new production code:

```text
server/src/intelligenceFoundation/**
```

All new tests:

```text
server/test/intelligenceFoundation/**
```

Allowed root receipts:

```text
MARKET_INTELLIGENCE_COMPONENTS.md
MARKET_INTELLIGENCE_RECEIPT.md
```

Everything else is read-only, including:

```text
web/**
server/src/index.ts
server/src/binance/**
server/src/services/**
server/src/engine/**
server/src/foundation/**
server/src/ledger.ts
server/src/types.ts
package.json
server/package.json
package-lock.json
.env*
data/**
MISSION.md
BLUEPRINT.md
ENGINE.md
PROJECT_MEMORY.md
```

Only the Codex lead may stage, commit, or modify the Git index. Subagents may edit only their assigned exclusive subdirectory and tests. Subagents may not spawn additional writing agents.

---

## 4. Hard safety and anti-garbage rules

1. No live orders, test orders, borrow, repay, transfer, withdrawal, leverage change, or margin-mode change.
2. No network calls in production modules or tests. Use injected ports and official-shaped synthetic fixtures.
3. No credentials, environment reads, private payloads, database copies, or secret-like fixtures.
4. No routes, startup hooks, UI/CSS changes, AWS changes, or production wiring.
5. No side effects at import time: no sockets, timers, file writes, global runtime, or background tasks.
6. Existing Basis and Volume engines own strategy decisions and proposals.
7. Existing ledger owns durable audit truth.
8. Existing/current foundation work owns control, execution, risk, reconciliation, replay, and generic diagnostics.
9. Unknown values remain `null`, `UNKNOWN`, `UNAVAILABLE`, or a named failure. Never manufacture zero, confidence, or “pump probability.”
10. Every timestamp preserves exchange/source event time separately from local receipt time.
11. Every output carries authority, provenance, completeness, configuration/feature version, and freshness.
12. Every implemented component must compile and have meaningful deterministic success and failure tests.

Types-only shells, TODO files, fake-success results, copied engine logic, generic manager classes, and line-count padding do not count.

---

## 5. Outcome

Build a reusable intelligence substrate for this funnel:

```text
Entire Binance universe
→ coverage and data-quality truth
→ per-symbol multi-horizon memory
→ cheap anomaly scout
→ candidate ranking
→ focused enrichment plan
→ Spot/Perpetual/derivatives evidence
→ supporting and conflicting thesis evidence
→ BEFORE / DURING / TOO_LATE market stage
→ evidence packet for the existing Basis or Volume engine
→ frozen pre-event record
→ later outcome and false-positive attribution
```

This sprint supplies richer evidence and attention plans. It does not decide trades or execute them.

---

# WAVE 0 — LEAD-OWNED SHARED CONTRACTS

## 6. Intelligence contract kernel

Lead-owned path:

```text
server/src/intelligenceFoundation/contracts/**
server/test/intelligenceFoundation/contracts/**
```

Freeze small contracts for:

- source authority and provenance;
- source event time, receive time, sequence, freshness, and completeness;
- instrument identity across Spot, USD-M Perpetual, margin, and borrow;
- normalized trade, book, depth, mark price, funding, open interest, liquidation, borrow, and contextual evidence;
- feature value and feature version;
- baseline state;
- candidate/focus state;
- attention/enrichment request;
- thesis/evidence packet;
- market stage;
- outcome label;
- component/topology descriptor;
- stable structured failure.

Required market stages:

```text
QUIET
EARLY_CHANGE
BEFORE_VISIBLE_MOVE
VISIBLE_EXPANSION
CONTINUATION
EXHAUSTION
REVERSAL
TOO_LATE
UNCLASSIFIED
```

Required evidence polarity:

```text
SUPPORTING
CONFLICTING
NEUTRAL
UNAVAILABLE
```

Stable IDs must not depend on array position or current wall-clock time.

Contract tests must prove deterministic serialization, timestamp separation, missingness preservation, stable IDs, invalid variant rejection, secret-field rejection, and import purity.

Commit the contract kernel before starting writing workers.

---

# WAVE 1 — PARALLEL CORE ORGANS

Run bounded agents with exclusive directories after the contract checkpoint.

## 7. Lane A — Market evidence envelope and data-quality truth

Path:

```text
server/src/intelligenceFoundation/evidence/**
server/test/intelligenceFoundation/evidence/**
```

Implement pure normalization and validation for injected records representing:

- Spot and Perpetual trades;
- best bid/ask and L2 depth snapshots/deltas;
- mark/index price;
- funding rate, interval, and time to funding;
- open interest and OI changes;
- liquidations;
- borrow availability, rate, amount, and evidence age;
- market-wide/context facts when supplied.

Detect and name:

- stale source;
- missing source;
- out-of-order event;
- duplicate event;
- sequence gap;
- timestamp skew;
- malformed/negative/non-finite values;
- crossed or impossible book;
- partial/incomplete evidence.

Never replace source time with refresh time.

## 8. Lane B — Full-universe instrument and coverage graph

Path:

```text
server/src/intelligenceFoundation/universe/**
server/test/intelligenceFoundation/universe/**
```

Build a deterministic graph joining, when supplied:

- Spot symbol;
- USD-M Perpetual symbol;
- base/quote assets;
- trading status;
- quantity/price/notional evidence;
- margin/borrow eligibility;
- public-data coverage;
- focused-data coverage;
- explicit reason for ineligibility or missing truth.

The graph must preserve quiet/low-volume symbols rather than silently dropping the exact dormant universe the Volume strategy wants to study. Eligibility for expensive focus is separate from visibility in the broad universe.

Test symbol joins, delist/status changes, missing Perpetual, missing borrow, duplicate aliases, coverage loss, and deterministic updates.

## 9. Lane C — Multi-horizon baseline and feature bank

Path:

```text
server/src/intelligenceFoundation/features/**
server/test/intelligenceFoundation/features/**
```

Implement bounded, pure, injected-clock feature computation. When data is supplied, support:

- 1s, 5s, 15s, 1m, 5m, 1h and longer historical windows;
- per-symbol normal/dead activity baselines;
- time-of-day/session normalization;
- trade-arrival rate and acceleration;
- quote/base volume and relative volume;
- trade-size distribution and large-trade clustering;
- taker/aggressor imbalance;
- price response per unit flow;
- spread and spread stability;
- depth, depth imbalance, book slope, replenishment/absorption evidence;
- Spot/Perpetual lead-lag and divergence;
- funding, OI, liquidation and crowding changes;
- symbol-specific movement versus market-wide movement;
- feature completeness and quality.

Every feature carries its version, window, observation range, authority, source set, and completeness. Use bounded memory structures. No hidden unbounded maps.

Test cold start, insufficient history, irregular event spacing, outliers, zero-trade windows, session normalization, stale/missing Futures, market-wide versus symbol-specific movement, and deterministic replay.

## 10. Lane D — Attention and enrichment-budget planner

Path:

```text
server/src/intelligenceFoundation/attention/**
server/test/intelligenceFoundation/attention/**
```

Build a deterministic resource planner for:

```text
UNIVERSE → WATCH → CANDIDATE → FOCUS → DEEP_FOCUS → RELEASED
```

It owns resource allocation, not strategy decisions.

Required behavior:

- cheap coverage for the full relevant universe;
- configurable hard caps per tier;
- explicit reason for promotion/demotion;
- requested richer feeds/features for each focused symbol;
- deterministic priority and eviction;
- cooldown/hysteresis to prevent focus thrashing;
- active-position symbols are protected from eviction;
- stale/failed sources reduce or block promotion;
- Basis/Volume candidate hints can be consumed through narrow injected ports without importing concrete engines;
- no proposal creation.

Test budget exhaustion, ties, thrashing, stale candidates, protected active capital, source failure, deterministic eviction, and release.

---

# WAVE 2 — INTELLIGENCE AND LEARNING ORGANS

## 11. Lane E — Evidence/thesis packet builder

Path:

```text
server/src/intelligenceFoundation/thesis/**
server/test/intelligenceFoundation/thesis/**
```

Build an explainable evidence packet answering:

- what changed first;
- when it changed;
- whether Spot or Perpetual led;
- whether volume/flow persisted;
- whether price responded;
- whether depth supported intended size;
- whether activity looks symbol-specific or market-wide;
- whether Futures/OI/funding/liquidation evidence supports or conflicts;
- whether the move is early, underway, exhausted, reversing, or too late;
- which required facts are unavailable;
- which historical analogue IDs are relevant when supplied.

Support named, evidence-backed classifications such as:

```text
DEAD_VOLUME_WAKEUP
ACCUMULATION_TO_EXPANSION
SPOT_LED_EXPANSION
PERPETUAL_LED_SQUEEZE
LIQUIDATION_DRIVEN_MOVE
MARKET_WIDE_BETA_MOVE
THIN_BOOK_DISLOCATION
CHURN_WITHOUT_FOLLOW_THROUGH
EXHAUSTED_MOVE
UNCLASSIFIED_ANOMALY
```

These are hypotheses, not truth or trade instructions. Output supporting evidence, conflicting evidence, missing evidence, stage, tradeability evidence, and stable reason codes. Do not output “pump probability.”

## 12. Lane F — False-positive forensics

Path:

```text
server/src/intelligenceFoundation/forensics/**
server/test/intelligenceFoundation/forensics/**
```

Implement deterministic evidence checks for:

- one-print/one-participant spike;
- wash-like balanced ping-pong churn;
- volume without price response;
- price jump on disappearing/thin depth;
- already-exhausted move;
- fake follow-through;
- repeated wake-up/fade pattern when history is supplied;
- market-wide move misclassified as token-specific;
- liquidation-only burst;
- stale or incomplete evidence masquerading as confidence.

Every check returns `PASS`, `FAIL`, or `UNKNOWN`, supporting evidence, timestamp range, and whether it blocks or merely warns. Unknown required evidence fails closed for any downstream tradeability claim.

## 13. Lane G — Pre-event freeze and outcome attribution

Path:

```text
server/src/intelligenceFoundation/outcomes/**
server/test/intelligenceFoundation/outcomes/**
```

Build pure schemas/reducers that:

- freeze the evidence available at trigger time;
- prohibit future information from entering the frozen decision record;
- attach later observations only after configured horizons;
- calculate, when supplied, forward return, maximum favorable excursion, maximum adverse excursion, fade, time-to-peak, liquidity/depth survival, and theoretical execution feasibility;
- record whether an accepted or rejected candidate later moved;
- group outcomes by feature/configuration version;
- retain incomplete outcomes as incomplete;
- recommend no automatic production threshold changes.

Do not duplicate the generic replay recorder if the foundation sprint already owns it. Consume replay envelopes through an injected port and own only intelligence-specific frozen evidence and outcome labels.

## 14. Lane H — Render-ready intelligence topology

Path:

```text
server/src/intelligenceFoundation/topology/**
server/test/intelligenceFoundation/topology/**
```

Build a pure registry/read model for the intelligence boxes created in this sprint.

Each node must expose:

```text
stable ID
name and responsibility
authoritative owner
dependencies
inputs and outputs
desired/observed state
authority and freshness
last success/error
blocking reason
metrics
safe controls supported later
UI surface
```

Typed edges:

```text
DATA
EVIDENCE
ATTENTION
DECISION_INPUT
CONTROL
RECOVERY
```

This is not a second supervisor and has no runtime. It produces the truthful backend model a later UI can render as part of the owner's 40–70-box machine graph.

---

# LEAD-OWNED COMPOSITION

## 15. Deterministic compatibility harness

Path:

```text
server/test/intelligenceFoundation/integration/**
server/test/intelligenceFoundation/fixtures/**
```

Using fake injected ports, prove:

```text
instrument coverage
→ normalized evidence
→ baseline/features
→ anomaly candidate
→ focus allocation
→ enriched evidence
→ thesis + forensics
→ frozen pre-event packet
→ later outcome attribution
```

Required deterministic scenarios:

1. genuinely dormant symbol begins persistent Spot-led activity;
2. one-print fake spike;
3. wash-like churn without price response;
4. Spot leads while Perpetual lags;
5. OI/liquidation-driven Futures move;
6. depth disappears before intended trade size;
7. market-wide move versus symbol-specific anomaly;
8. stale Futures source;
9. missing borrow evidence;
10. sequence gap/out-of-order event;
11. candidate is already too late;
12. accepted and rejected candidates receive later no-look-ahead outcomes.

The final output is an evidence packet compatible through a narrow adapter with the existing engines. It must not create a proposal or execute anything.

---

## 16. Component manifest and receipt

Create `MARKET_INTELLIGENCE_COMPONENTS.md` containing for every component:

```text
path
responsibility
authoritative inputs
outputs
owned state
non-owned state
tests
failure modes
live authority: NONE
future adapter to existing Basis/Volume engine
future UI surface
```

Create `MARKET_INTELLIGENCE_RECEIPT.md` containing:

- starting SHA and branch;
- checkpoint commits;
- existing behavior reused;
- modules built;
- modules skipped;
- focused test counts;
- integration-scenario results;
- build and full baseline result;
- files changed outside allowed paths;
- proof of no network/secrets/live actions;
- exact future integration seams;
- honest remaining intelligence gaps.

---

## 17. Priority when capacity ends

Finish in this order:

1. contracts;
2. evidence/data-quality truth;
3. universe graph;
4. baseline/feature bank;
5. attention planner;
6. thesis/evidence packet;
7. false-positive forensics;
8. pre-event/outcome attribution;
9. topology read model;
10. compatibility harness and receipt.

Never leave a partially implemented lane in the final checkpoint. Finish its focused tests or remove only that incomplete lane before committing.

---

## 18. Acceptance gate

Do not claim completion unless:

- Main began clean and no second writer touched it;
- existing build and post-audit bounded tests remain green;
- every implemented intelligence module compiles;
- every implemented lane has deterministic success/failure tests;
- no existing engine, runtime, route, UI, package, ledger, foundation, secret, or data file changed;
- no network call, credential read, live action, timer, socket, or import side effect exists;
- full-universe visibility does not silently discard dormant symbols;
- feature outputs preserve source time, authority, version, completeness, and provenance;
- no pump probability or fabricated confidence exists;
- strategy decisions remain owned by existing Basis/Volume engines;
- the compatibility harness passes for completed lanes;
- component manifest and receipt are complete;
- changes are committed on the feature branch;
- working tree is clean;
- nothing is merged into the default branch.

---

## 19. Exact first message to Codex

> Execute `MARKET_INTELLIGENCE_MAX_POWER_SPRINT.md` as the lead builder inside `/Users/cosmosgeek/Desktop/Main`. Start by proving Main is clean, recording HEAD, and creating the isolated feature branch required by Section 1. Build real deterministic TypeScript organs and tests under the exclusive intelligenceFoundation paths; do not return a planning-only answer. Use bounded parallel agents with exclusive directories after freezing the shared contracts. Inspect and reuse current engine behavior without editing or duplicating it. Do not touch the separate foundation clone, existing engines, routes, UI, secrets, network, live actions, or default branch. Continue through as many priority lanes as capacity allows, checkpoint only tested work, run all acceptance gates, and finish with the component manifest, receipt, commit SHAs, and a clean tree.

