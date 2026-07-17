# QUANT EDGE RESEARCH FACTORY — 12-HOUR SUSTAINED BUILD

**Director:** Claude Code / Fable 5  
**Builder:** one logical Codex 5.6 Sol/Ultra lead across bounded phase sessions, with exclusive-path workers  
**Program:** Q-lane — data, evidence, labels, research, models, calibration, drift, inference  
**Write territory:** `quant/**` only, plus director-frozen protocol fixtures explicitly listed below  
**Time posture:** sustained implementation; checkpoint by capability, not by chat length  
**Final output:** a tested local quant research-and-inference factory that emits advisory edge assessments and cannot authorize money

---

## 0. Controlling instruction

Execute this as an implementation program, not a planning exercise and not another audit.

The repository already contains or is integrating:

- the existing Node/TypeScript product and cockpit;
- the existing Basis and Volume engines;
- Market Intelligence Foundation;
- Live Intelligence Runtime;
- Capital Supervision;
- Backend Foundation;
- system convergence and canonical authority work;
- live-product/private-exchange/control/deployment work under a separate program.

Do **not** rebuild any of those systems. Read their canonical contracts, consume their output through adapters, and leave their authority intact.

This program builds the missing deep research and market-perception machinery:

```text
versioned exchange evidence
-> point-in-time datasets
-> no-look-ahead labels and matched controls
-> microstructure, derivatives, regime and anomaly features
-> specialist statistical/ML models
-> calibrated ensemble and uncertainty
-> historical analogues
-> champion/challenger and drift
-> bounded inference service
-> advisory EdgeAssessmentEnvelopeV1
```

The output is a research assessment. It may recommend `IGNORE`, `WATCH`, `FOCUS`, `PROPOSE_CONSIDERATION`, or `ABSTAIN_UNKNOWN`. It may never allocate capital, approve risk, choose leverage, sign an exchange request, or place/cancel an order.

Do not claim an edge because code compiles, a paper exists, a backtest is green, or line count is large. The factory exists to discover, measure, falsify, compare, and retire hypotheses.

---

## 1. What the owner must receive

At completion, the owner should not receive “a model folder.” The owner should receive a working machine that can answer:

1. What exactly changed in this symbol relative to its own normal state?
2. Did the change begin in Spot, perpetuals, the book, trades, funding, open interest, liquidations, or the broader market?
3. Is this a first transition, continuation, exhaustion, reversal, false burst, or unknown state?
4. How similar is this state to earlier states, and what happened after those states?
5. What do several different models believe, where do they disagree, and are their probabilities calibrated?
6. Does the predicted opportunity survive spread, fees, funding, borrow, slippage, latency, and executable-size assumptions?
7. Is the evidence complete and fresh enough to act on, or should the system abstain?
8. Which dataset, feature, label, model, calibration, and policy versions produced the answer?
9. What later happened to every acted, rejected, expired, and quiet-control event?
10. Is a model improving, decaying, drifting, or only overfitting a historical period?

The final demonstrator must run this chain on deterministic fixtures and on whatever real historical/live evidence the current repository can lawfully supply:

```text
raw records
-> validated local book/evidence
-> point-in-time feature vector
-> labels when their horizons mature
-> specialist predictions
-> calibrated assessment
-> stored outcome feedback
```

---

## 2. Relationship to current programs

Do not assume that any file named `MISSION.md` is canonical merely because it is at repository root. Authority order is:

1. the mission path and blob SHA explicitly accepted in the final System Convergence receipt;
2. the accepted `SYSTEM_AUTHORITY_MAP.md`;
3. the accepted `LIVE_PRODUCT_AUTHORITY_MAP.md`, once live-product integration exists;
4. explicit current owner authorization for external effects/capital;
5. the director-frozen protocol compatibility decision;
6. this Q-lane directive;
7. older sprint documents as historical input only.

In the supplied snapshot the intended mission source is `project_sources/01-MISSION-2-.md`, but the target repository may have a reviewed root copy. Q00 must record the resolved path, blob SHA, authority-map path/SHA, convergence SHA, and live-product source SHA. If these are absent or contradictory, end Q00 as `PARTIAL_AUTHORITY_BLOCKED`; do not invent a new authority.

It does not replace:

- `SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md`;
- `LIVE_PRODUCT_COMPLETION_MAX_POWER_SPRINT.md`;
- `FULL_PRODUCT_EDGE_BRAIN_AND_TINY_LIVE_BRINGUP.md`;
- any completed branch receipt accepted by the director.

It makes the broad “edge brain” objective implementation-grade.

### Read-only existing authorities

The Q-lane may inspect but must not edit:

```text
server/src/engine/**
server/src/foundation/**
server/src/intelligenceFoundation/**
server/src/liveIntelligence/**
server/src/capitalSupervision/**
server/src/services/**
server/src/binance/**
server/src/index.ts
server/src/ledger.ts
server/src/types.ts
web/**
ops/**
data/** containing private/account information
.env*
```

If actual paths differ, the director records the resolved equivalents before launch. The Q-lane remains additive under `quant/**`.

### Explicit non-goals

Do not create another:

- universe scanner;
- Basis engine;
- Volume engine;
- proposal queue;
- capital allocator;
- risk gate;
- order service;
- ledger;
- control plane;
- dashboard application;
- exchange account client;
- runtime supervisor.

The quant factory supplies advisory assessments to those authorities.

---

## 3. Mandatory director launch gate

Fable performs this once before the Q-lane and L-lane branches start.

### 3.1 Resolve the canonical base

Verify from Git, not chat or screenshots:

```text
canonical integration branch
canonical HEAD SHA
security/audit SHA included
convergence SHA included
accepted intelligence/runtime/capital/foundation SHAs included or intentionally adapted
working-tree state
active writers and worktrees
```

Create `quant/DIRECTIVE_INPUTS.lock` containing every accepted input path, Git blob ID, SHA-256, accepted commit and supersedes relationship. A basename is not enough. Freeze one `CANONICAL_BASE_SHA`; `PROTOCOL_SHA` must descend from it, and both lane branches must descend from `PROTOCOL_SHA`. Test ancestry.

No agent works directly in a dirty shared checkout. Never base this program on a pre-audit or pre-convergence commit merely because an older directive names it.

### 3.2 Freeze one shared protocol commit

Do not create `packages/edge-protocol/**` merely because this directive names it.

First map every proposed field to the canonical contracts selected in `SYSTEM_AUTHORITY_MAP.md`. For each concept record:

```text
canonical owner/path
canonical type and revision
Q-lane adapter
loss/unknown behavior
compatibility test
genuinely missing interchange field, if any
```

The director alone, in a dedicated integration commit, may add a missing cross-language schema or adapter. The package is an interchange boundary, not a new semantic owner of evidence, freshness, outcomes, health, proposals, decimals, clocks or errors. If an existing contract cannot express a required field, amend the authority map before either lane proceeds.

The director, not either lane, owns:

```text
packages/edge-protocol/**
packages/edge-protocol-tests/**
EDGE_PROTOCOL_V1.md
```

Freeze and commit:

- `MarketEvidenceEnvelopeV1`;
- `EdgeAssessmentEnvelopeV1`;
- `EdgeOutcomeEnvelopeV1`;
- `EdgeFeedbackEnvelopeV1`;
- `EdgeBrainHealthV1`;
- `ProtocolErrorV1`;
- representative valid/invalid fixtures;
- JSON Schema or another deterministic cross-language schema;
- compatibility and round-trip tests.

Record the protocol SHA. Both agents treat it as read-only.

### 3.3 Create isolated worktrees

“Live lane” means the exact worktree, branch, source SHA, director and write territory recorded in the accepted live-product build state. If no accepted live-product state exists, launch Q alone and create L only after the director establishes it. The lanes share only the frozen protocol and read-only canonical contracts; they never share a writable checkout, state file, package manifest, route/composition file, ledger schema or generated-output directory.

Create from the exact protocol SHA:

```text
quant-edge-research-<timestamp>
live-execution-proof-<timestamp>
```

The Q-lane worktree receives this directive. The live lane receives its separate directive.

### 3.4 Enforce changed-path ownership

Before each commit, automatically fail if the Q-lane changed anything outside:

```text
quant/**
QUANT_EDGE_RESEARCH_FACTORY_12H.md
```

The director may later wire package manifests or shared composition in a dedicated integration branch. The Q-lane must not “temporarily” edit shared files.

---

## 4. Compaction-proof operating protocol

The agent will run long enough to compact context. Assume this will happen and make the repository the memory.

### 4.1 Persistent state file

Create and overwrite after every accepted checkpoint:

```text
quant/QUANT_EDGE_BUILD_STATE.md
```

Keep it concise, factual, and below roughly 300 lines. It must always contain:

```text
program name
canonical base SHA
protocol SHA
mission/authority-map/protocol blob hashes
branch and worktree
last accepted phase
latest director acceptance commit
current phase
exact current-task path and hash
monotonic state generation
status: WORKING | READY_FOR_REVIEW | ACCEPTED | BLOCKED_DATA | BLOCKED_EXTERNAL | SUPERSEDED
exclusive write paths
framework adoption decisions
dataset versions and coverage
feature/label/model registry versions
tests and actual pass counts
benchmarks and actual measurements
known defects
data insufficiencies
external blockers
next exact task
next exact command
files a fresh session must read
work that must not be repeated
```

### 4.2 One phase brief at a time

Create:

```text
quant/tasks/Q00_*.md
quant/tasks/Q01_*.md
...
```

Each brief is bounded to one checkpoint and records:

- purpose;
- inputs and canonical types;
- exclusive paths;
- code artifacts;
- tests;
- acceptance conditions;
- forbidden shortcuts;
- final receipt path.

### 4.3 Immutable receipts

For every phase create:

```text
quant/receipts/Qxx_<name>.md
```

Each ready-for-review receipt records actual files, commands, test counts, measurements, limitations, decisions, parent SHA and canonical tree/input hashes. The later acceptance record names the implementation commit. Never say “verified” without a command or deterministic inspection.

A receipt cannot truthfully contain the SHA of the same commit that contains the receipt. Use two commits for an accepted phase:

1. phase commit `C` contains implementation, tests and a `READY_FOR_REVIEW` receipt recording the parent SHA, tree/input hashes, commands, results and limitations;
2. after independent verification, director acceptance commit `A` records `C`, verification results and `ACCEPTED` in the state/acceptance index.

Corrections create a superseding receipt and acceptance record; never rewrite an accepted receipt.

### 4.4 Checkpoint rhythm

For each phase:

1. verify mission/authority/protocol/state/task hashes, Git status and ancestry; inspect the current task and directly relevant source/contracts;
2. implement;
3. run the phase tests;
4. run the accumulated quant suite;
5. perform an adversarial self-review;
6. correct failures;
7. write the ready-for-review receipt;
8. create phase commit `C`;
9. independently verify `C`;
10. update state/acceptance index and create acceptance commit `A`;
11. start the next brief.

Do not accumulate twelve hours of uncommitted work.

### 4.5 Resume instruction after compaction or usage stop

The director may start a fresh Codex session with this bounded bootstrap:

```text
Read the accepted mission/authority references, quant/QUANT_EDGE_BUILD_STATE.md,
the exact current-task path recorded there, EDGE_PROTOCOL_V1.md, and the latest
accepted receipt. Verify pwd, worktree/branch, git status, HEAD ancestry from
the protocol SHA, latest director acceptance commit, and every recorded blob
hash. Inspect directly relevant source/tests as needed. Stop on mismatch.
Continue the exact phase; do not redo accepted work, change protocol/authority,
edit outside quant/**, or return a planning-only response.
```

### 4.6 Internal worker topology

The Codex lead may use internal workers only after Q00/Q01 freeze interfaces and exclusive ownership. Suggested lanes:

```text
Q-A  ingest/lake/book/quality
Q-B  labels/matched controls/leakage fixtures
Q-C  microstructure/liquidity/intensity features
Q-D  derivatives/Basis/cross-market features
Q-E  change/regime/anomaly/analogue models
Q-F  tabular/survival/calibration ensemble
Q-G  validation/registry/benchmark adversarial review
```

The lead alone owns package locks, common contracts, build state, registry composition, inference composition, task/receipt acceptance and commits. A worker receives one bounded task and exclusive files. No two workers edit a shared registry/index. Workers return a patch plus test evidence; the lead inspects and integrates it before accepting the phase.

Parallelism may shorten independent work. It may not bypass phase dependencies: labels require temporal truth, model claims require labels, and promotion requires validation.

---

## 5. Safety and scientific integrity boundaries

### Money and authority

- No API secret, private key, account token, or credential enters `quant/**`.
- No production quant module imports private Binance, order, loan, transfer, capital, approval, or risk mutation APIs.
- No assessment contains a signed request, executable order, leverage command, or capital approval.
- No withdrawal, transfer-out, spoofing, wash trading, fake volume, market manipulation, or coordinated pump tooling.
- An LLM may summarize offline evidence; it may not score or authorize the hot path.

### Truth

- Unknown remains unknown; never coerce it to zero or false.
- Stale, gapped, reconstructed, sampled, synthetic, replay, and live evidence are distinct.
- An arbitrary score is not a probability.
- A calibrated probability is not a guarantee.
- A backtest is not realized PnL.
- A model benchmark is not executable edge.
- A paper result is not transferable proof on current Binance data.
- A large codebase is not a brain.

### Anti-garbage gate

- Do not vendor external repositories or generated dependencies into the codebase to inflate line count.
- Do not create disconnected algorithms that never enter a tested experiment or inference path.
- Every implemented algorithm needs an `AlgorithmCard`, unit/property tests, an ablation, and a baseline comparison.
- Every production path must have deterministic fixture coverage.
- Every model must be versioned and reproducible.
- Failed hypotheses remain recorded. Do not delete them to make reports look better.

---

## 6. Frozen advisory protocol

If canonical contracts already express these fields, adapt rather than duplicate.

The prose field lists below are requirements, not a second normative schema. The director-frozen interchange contract at `PROTOCOL_SHA` is the sole normative cross-language representation. It must define decimal strings plus units, timestamp epoch/unit/precision, identifier scope, bounded payload references, expiry, size limits, idempotency, compatibility/downgrade rules, unknown-field behavior and fail-closed unsupported-version behavior. Generated clients may not contain handwritten semantic copies.

### 6.1 `MarketEvidenceEnvelopeV1`

Minimum semantics:

```text
schema/version/revision
evidence ID and trace ID
venue/product/symbol/canonical asset identities
instrument graph (Spot, USD-M perpetual, borrow asset where relevant)
exchange event time
local receive time
normalization time
feature cutoff time
source connection/session/sequence identities
source type and endpoint/stream class
raw payload hash and normalized schema hash
live/replay/synthetic label
freshness, completeness, gap, duplicate and reconstruction status
exact/scaled numeric fields
book snapshot/delta/trade/mark/index/funding/OI/liquidation/context payload
```

### 6.2 `EdgeAssessmentEnvelopeV1`

`EdgeAssessmentEnvelopeV1` is a versioned research second opinion. It does not create or mutate canonical Market Intelligence attention/thesis state, a Basis/Volume proposal, capital eligibility, approval, Risk or execution state. `PROPOSE_CONSIDERATION` means “submit this assessment to the canonical strategy owner for evaluation.” Only the authority-map-selected adapter may translate it into strategy input.

Every net-edge/actionability estimate references a sanitized `EconomicAssumptionContextV1` containing:

```text
as-of and expiry times
live/hypothetical state
intended size and quote currency
fee tier/source and uncertainty
spread/slippage model and version
funding rate, schedule, interval and source
borrow availability, quantity, rate, interest convention and expiry
latency and recovery-cost scenarios
missing/unknown fields
source snapshot IDs/revisions
```

It contains no secret, balance, account identifier, permission mutation or order authority. Missing fee, funding, borrow, latency or recovery truth remains unknown and normally forces `ABSTAIN_UNKNOWN`. Capital/Risk recompute final economics from current operational truth.

Minimum semantics:

```text
schema/version/revision
assessment ID, trace ID and parent evidence IDs
strategy family and hypothesis
instrument graph
event/receive/generation/expiry times
market stage probabilities
regime probabilities
prediction targets and horizons
calibrated distributions and quantiles
epistemic/model/data uncertainty
out-of-distribution and drift states
gross economic estimates
fee/spread/slippage/funding/borrow/latency/recovery estimates
net expected-value distribution
capacity and executable-size evidence
supporting, conflicting and missing evidence
feature attribution
historical analogue references and their later outcomes
dataset/feature/label/model/calibration lineage
source freshness/completeness/gaps
advisory action
abstention and reason codes
invalidation conditions
```

Allowed advisory actions:

```text
IGNORE
WATCH
FOCUS
PROPOSE_CONSIDERATION
ABSTAIN_UNKNOWN
```

Forbidden fields:

```text
exchange signature
API secret
approved capital
venue order request
leverage mutation
live-send permission
```

### 6.3 Feedback loop

The authority map must separately identify the market/event outcome owner, execution/PnL attribution owner, durable operational ledger owner and research projection owner. Existing operational owners create and persist truth. `EdgeOutcomeEnvelopeV1` and `EdgeFeedbackEnvelopeV1` are immutable, deduplicated, data-minimized projections carrying source event IDs/revisions, reconciliation state and hashes—not a second outcome or ledger authority.

The projections contain:

- acted/rejected/expired/missed/control cohort;
- real or hypothetical label;
- fills and executable prices when real;
- fees, funding, borrow, interest, slippage, latency, recovery cost;
- MFE/MAE and time-to-event;
- final PnL attribution;
- decision/model lineage;
- completeness and reconciliation state.

Quant learning consumes feedback asynchronously. It never modifies the historical assessment record.

Real, hypothetical, replay, rejected, missed and quiet-control outcomes remain distinct. Feedback carries no secret, balance, account identity or unnecessary raw exchange identifier.

---

## 7. Required architecture under `quant/**`

Create a coherent package, not a flat collection of notebooks.

```text
quant/
  README.md
  pyproject.toml
  uv.lock or pinned equivalent
  QUANT_EDGE_BUILD_STATE.md
  config/
  contracts/
  ingest/
  lake/
  book/
  quality/
  labels/
  features/
    core/
    microstructure/
    intensity/
    liquidity/
    anomaly/
    cross_market/
    derivatives/
    basis/
    regimes/
    quality/
  models/
    baselines/
    ranking/
    regression/
    quantile/
    survival/
    anomaly/
    changepoint/
    regimes/
    analog/
    sequence/
    ensemble/
    calibration/
  validation/
  simulation/
  registry/
  online/
  inference/
  research/
  cli/
  generated/
  fixtures/
  tests/
    unit/
    property/
    contract/
    replay/
    leakage/
    integration/
    benchmark/
  tasks/
  receipts/
  docs/
    algorithms/
    datasets/
    models/
    experiments/
```

Optional Rust belongs only in measured bottlenecks:

```text
quant/crates/**
```

Do not introduce Rust because it looks sophisticated. Benchmark Python/Polars first; migrate only a proven hot path with identical golden outputs.

---

## 8. Framework and paper adoption law

Research current stable versions, licenses, maintenance status, security posture, and exact fit before adding dependencies.

For every candidate write an `AlgorithmCard` or `FrameworkCard`:

```text
name and version
primary source / official repository
license
economic hypothesis
inputs and outputs
assumptions
known failure modes
historical data requirements
live latency fit
memory/CPU/GPU cost
overlap with current repository
ADOPT / ADAPT / REFERENCE_ONLY / REJECT
implementation seam
test and ablation plan
measured result
```

### 8.1 Initial framework decision set

The agent must verify, not blindly obey, these starting decisions.

#### Expected `ADOPT`

- **Polars** — high-throughput dataframe/query engine: <https://github.com/pola-rs/polars>
- **Apache Arrow / Parquet** — columnar interchange and storage: <https://github.com/apache/arrow>
- **DuckDB** — local analytical SQL over Parquet: <https://github.com/duckdb/duckdb>
- **scikit-learn** — transparent baselines, calibration, pipelines, metrics.
- **one or more of LightGBM/XGBoost/CatBoost** after comparative fit:
  - <https://github.com/lightgbm-org/LightGBM>
  - <https://github.com/dmlc/xgboost>
  - <https://github.com/catboost/catboost>
- **River** — streaming models, progressive validation and drift: <https://github.com/online-ml/river>
- **ruptures** — offline change-point segmentation: <https://github.com/deepcharles/ruptures>
- **STUMPY** — Matrix Profile motifs/discords/streaming analogues: <https://github.com/stumpy-dev/stumpy>
- **Optuna** with bounded trial budgets: <https://github.com/optuna/optuna>
- **MLflow**, minimally, for experiment lineage and registry: <https://github.com/mlflow/mlflow>

#### Expected `ADAPT`

- **Feast** only when point-in-time offline/online feature consistency adds measured value: <https://github.com/feast-dev/feast>
- **FAISS** for earlier-only analogue retrieval at scale: <https://github.com/facebookresearch/faiss>
- **PyOD** for a selected anomaly subset, not every detector: <https://github.com/yzhao062/pyod>
- **scikit-survival or XGBoost AFT** for censored time-to-event targets: <https://github.com/sebp/scikit-survival>
- **hmmlearn** behind a narrow interface because maintenance is limited: <https://github.com/hmmlearn/hmmlearn>
- **PyTorch** only for data-sufficient sequence challengers.
- **Tardis.dev** only if the owner accepts cost and license for historical L2: <https://docs.tardis.dev/historical-data-details/binance>

#### Expected `REFERENCE_ONLY`

- **NautilusTrader** for deterministic event/research-live semantics, not a replatform: <https://nautilustrader.io/docs/latest/>
- **Microsoft Qlib** for workflow and model-comparison patterns: <https://github.com/microsoft/qlib>
- **Hummingbot** for connector/execution patterns, not a second runtime authority: <https://github.com/hummingbot/hummingbot>
- **DeepLOB** and **TLOB** until L2 sufficiency and cost-aware uplift are proved.

#### Expected `REJECT` for initial production authority

- online reinforcement learning with live capital;
- an LLM in inference or order flow;
- naive random train/test split;
- naive SMOTE across adjacent time windows;
- full repository replatforming;
- copying a framework’s entire source tree;
- any abandoned/archived connector as a new critical dependency;
- any model that cannot reproduce its feature cutoff and label horizon.

### 8.2 Primary research anchors

At minimum, read and convert the following into implement/test/ablate decisions:

- Cont, Kukanov, Stoikov — Order Flow Imbalance: <https://arxiv.org/abs/1011.6402>
- Gould and Bonart — Queue Imbalance: <https://arxiv.org/abs/1512.03492>
- Cont, Cucuringu, Zhang — multi-level/cross-asset OFI: <https://arxiv.org/abs/2112.13213>
- queue-reactive/Hawkes order-flow modeling: <https://arxiv.org/abs/1901.08938>
- Adams and MacKay — Bayesian Online Changepoint Detection: <https://arxiv.org/abs/0710.3742>
- DeepLOB: <https://arxiv.org/abs/1808.03668>
- TLOB: <https://arxiv.org/abs/2502.15757>
- fill-time survival modeling: <https://arxiv.org/abs/2306.05479>
- perpetual futures pricing: <https://arxiv.org/abs/2310.11771>
- pump-and-dump anatomy: <https://arxiv.org/abs/1811.10109>
- real-time pump detection after onset: <https://arxiv.org/abs/2105.00733>
- adaptive conformal inference: <https://arxiv.org/abs/2106.00170>
- time-series adaptive conformal work: <https://arxiv.org/abs/2202.07282>
- Probability of Backtest Overfitting: <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253>
- Deflated Sharpe Ratio: <https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551>

These are research starting points, not claims that their results transfer to Binance.

---

## 9. Data-source reality

### 9.1 Free historical bootstrap

Use Binance’s official public archive where available:

<https://github.com/binance/binance-public-data>

It supports trades, aggregate trades, and klines for Spot and Futures. Verify checksums and record archive revisions. Treat timestamp unit, coverage, schema and corrections as verified per-file properties, not a timeless date-only rule. Preserve the raw integer and declared/inferred unit; validate against plausible dates, manifests and neighboring records. Reject ambiguous or mixed-unit partitions rather than silently multiply, divide or truncate.

Create a product/event/date capability matrix with retrieval time, URL, checksum, schema fingerprint, gaps and revisions. Coverage is not assumed uniform across Spot, USD-M, event types, symbols or dates. Archive data without local receive times cannot validate live latency, queue position or opportunity-decay claims.

The archive does **not** provide the full historical L2 event history required for credible LOB sequence training. Do not fabricate it from candles.

### 9.2 Forward evidence capture

Live Intelligence Runtime remains the sole production owner of Binance sockets, REST snapshots, reconnects, sequence state, rate budgets and operational book completeness. Quant consumes an asynchronous append-only canonical capture and may run an offline/reference reconstructor for replay/parity. It may request resynchronization through a bounded typed request; it may not open a competing production socket, poller, cache or snapshot loop unless the authority map explicitly makes it the sole producer.

Capture queues must be bounded and must never backpressure the money-critical runtime. Every drop/gap is manifested. Resnapshot requests are coalesced, globally rate-budgeted, backoff-controlled and protected from universe-wide reconnect storms.

Start retaining public Spot and USD-M evidence immediately through that canonical read-only bridge:

- trades/aggregate trades;
- book ticker;
- depth snapshot plus sequenced deltas;
- mark/index/premium/funding;
- open interest where supplied/polled;
- liquidation stream with sampling limitations labeled;
- receive and processing timestamps;
- connection generation and gaps.

Capture the official Binance contract revision used by each canonical adapter. Spot and USD-M depth sequencing remain separate versioned implementations; do not reuse one generic overlap predicate. Model planned WebSocket session turnover, subscription budgets, REST request-weight budgets, open-interest polling cadence and the documented sampling semantics of liquidation feeds. Reverify limits during Q03 rather than copying them as permanent constants.

Do not create a competing public stream manager. Prefer an append-only adapter from normalized canonical events.

### 9.3 Optional paid/deeper history

Tardis documents historical Binance L2 deltas, snapshots, trades and local timestamps. Treat it as optional. The factory must remain operable with free data and forward capture, while clearly gating algorithms that need historical L2.

### 9.4 Realistic latency

Public Binance depth is not colocated microsecond feed data. The realistic first target is:

- early seconds-to-minutes state transitions;
- persistent dislocations after full costs;
- better universe prioritization than manual monitoring;
- reliable abstention as evidence decays;
- measured public-API reaction latency.

Any millisecond claim requires the complete timestamp chain from exchange event through fill. Without it, label the latency unknown.

### 9.5 External evidence expansion

Binance is the first deep venue, not the only possible evidence source. Build a versioned `DataSourceCard` and narrow adapter interface so a later experiment can add a source without contaminating canonical Binance truth.

Evaluate, but do not blindly integrate, current public/paid sources for:

- other CEX Spot/perpetual trades, books, funding, OI and liquidations;
- cross-venue price discovery and leader/follower changes;
- exchange listing/delisting and scheduled maintenance announcements;
- on-chain exchange inflows/outflows and large token transfers where economically relevant;
- token supply/unlock/vesting context;
- licensed news and social evidence;
- richer historical L2 and local receive timestamps.

Start research with official interfaces such as:

- OKX API: <https://www.okx.com/docs-v5/en/>
- Bybit V5 API: <https://bybit-exchange.github.io/docs/v5/intro>
- Coinbase Exchange API: <https://docs.cdp.coinbase.com/exchange/docs/welcome>
- Hyperliquid API: <https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api>
- Tardis multi-exchange history: <https://docs.tardis.dev/historical-data-details/binance>

For every source record:

```text
license and redistribution rights
historical/live coverage
timestamp and sequence semantics
sampling and aggregation
expected latency
rate/cost budget
asset/instrument identity mapping
completeness and outage history
specific hypothesis it can test
incremental value versus Binance-only evidence
ADOPT / ADAPT / REFERENCE_ONLY / REJECT
```

Do not add five feeds merely to vote on the same price. Add a source only when it can improve early detection, source disagreement, borrow/funding truth, cross-venue leadership, manipulation-risk filtering, execution feasibility, or falsification.

---

## 10. Data contracts and lake invariants

### 10.0 Point-in-time instrument master

Maintain validity-interval records for:

```text
venue/product/symbol and canonical asset identity
base/quote/settlement/contract identity
listing, trading, halt and delisting status
symbol/asset migrations
price/quantity precision
tick, step, min-notional/notional and relevant filters
margin/borrow eligibility when lawfully supplied
first/last observed times
source exchangeInfo snapshot and hash
```

Universe construction must be as-of-time correct. Never infer the historical universe from today’s `exchangeInfo`, today’s archive directory or symbols that survived to the end. A missing archive file is `UNKNOWN/UNAVAILABLE`, not zero activity.

Tests cover new listing, delisting, halt, filter revision, symbol migration, missing archive day and a label horizon crossing a lifecycle boundary.

### 10.1 Raw record invariants

Every record preserves:

```text
venue
product
symbol
canonical base and quote asset IDs
instrument version
exchange event time
trade/update time if distinct
local receive monotonic and wall times
normalization and persistence times
connection/session ID
stream ID
first/final sequence IDs where supplied
raw payload hash
normalized schema version
source endpoint/stream
snapshot/delta/trade/context kind
live/replay/synthetic state
gap/duplicate/late status
exact scaled integer or decimal values
```

### 10.2 Partitioning

Use immutable Parquet partitions or an equally justified columnar layout by:

```text
schema version / venue / product / event kind / date / symbol shard
```

Each partition gets:

- manifest;
- row count;
- min/max exchange and receive times;
- source sessions;
- gap/duplicate counts;
- checksum;
- code/config version;
- parent input hashes;
- retention class.

Never silently rewrite a partition. Corrections create a new dataset revision with lineage.

### 10.3 Operational versus research storage

- Raw/high-rate evidence belongs in the quant lake, not the operational SQLite ledger.
- Operational decisions, controls, orders, and outcomes remain in the existing canonical ledger.
- Quant artifacts reference operational events by stable IDs and hashes.
- Deleting expired raw partitions must preserve manifests, derived lineage, and required regulatory/audit evidence.

### 10.4 Data quality states

Use explicit states:

```text
COMPLETE
PARTIAL
GAPPED
STALE
RECONSTRUCTING
SAMPLED
UNAVAILABLE
SYNTHETIC
UNKNOWN
```

Models see quality features and may abstain. They may not treat an unavailable stream as a real zero.

### 10.5 Book reconstruction

Implement Binance’s documented snapshot/delta sequencing for each product. A book becomes usable only after overlap and sequence rules pass.

On a gap:

1. mark the book `GAPPED`;
2. stop model-eligible feature emission for that symbol/product;
3. discard invalid local state;
4. fetch a new snapshot through the canonical runtime boundary;
5. replay buffered overlapping deltas;
6. restore `COMPLETE` only after validation;
7. emit a quality transition event.

Required tests include duplicate, out-of-order, skipped, stale-snapshot, reconnect, and resnapshot cases.

---

## 11. Label and outcome factory

Do not build one binary `pump=true` target.

### 11.1 Point-in-time identity

Every sample records:

```text
sample ID
event/cohort ID
symbol and instrument graph
feature cutoff time
label start time
label end time
horizon
feature lookback interval
source completeness interval
dataset/feature/label versions
cost and execution assumption versions
```

### 11.2 Multi-horizon numeric outcomes

Generate, where data supports them:

- future mid, executable bid/ask, and market/sector-residual returns;
- 1s, 5s, 15s, 30s, 60s, 5m, 15m, and 1h horizons;
- MFE, MAE, time-to-MFE, and time-to-MAE;
- first-passage time to volatility/liquidity-adjusted barriers;
- realized spread/depth deterioration;
- opportunity decay between detection and hypothetical submission;
- executable capacity at intended sizes;
- gross and conservative net outcomes under cost/latency scenarios.

### 11.3 Stage labels

Separate:

```text
DORMANT
IGNITION
EARLY_EXPANSION
CONTINUATION
EXHAUSTION
FADE
UNWIND
DISORDER
NO_EVENT
UNKNOWN
```

Stage labels must be generated by versioned definitions, not manually relabeled after seeing a successful trade.

### 11.4 Basis labels

For normal and reverse Basis separately:

- executable entry basis;
- maximum executable net edge during event;
- convergence/divergence path;
- time-to-partial/full convergence;
- right-censored non-convergence;
- funding paid/received at actual schedule;
- borrow availability/rate/liability assumptions;
- four-leg open/close fees;
- intended-size spread/slippage;
- recovery cost;
- failure-to-remain-executable;
- normal/reverse construction feasibility.

### 11.5 Event disposition labels

Retain:

```text
ACTED
REJECTED
EXPIRED
MISSED
QUIET_CONTROL
DATA_INVALID
```

Rejected and quiet-control states are essential. Without them, the system cannot measure false positives or missed opportunities.

### 11.6 Matched controls

Match non-events by:

- same symbol;
- liquidity and activity bucket;
- market and volatility regime;
- time-of-day/funding-cycle context;
- data completeness;
- no overlap with the event’s feature or label interval.

Never allow future event membership to leak into feature selection.

### 11.7 Label tests

Required:

- future-value injection cannot alter earlier features;
- moving label end cannot change earlier raw/feature hashes;
- adjacent windows from one event stay in one evaluation group;
- censored cases remain censored;
- cost version changes create a new label version;
- gapped evidence creates `DATA_INVALID`, not a normal negative;
- acted/rejected/control cohorts are reproducible from manifests.

---

## 12. Feature registry and common law

Every feature has:

```text
stable name and version
economic hypothesis
inputs and exact time windows
clock/event/trade/volume-time domain
normalization cohort
missing/stale behavior
units and bounds
incremental update rule
batch reference implementation
streaming implementation
provenance
computational cost
expected failure modes
tests and golden vectors
```

Streaming and batch computations must agree within declared numeric tolerance. If they differ, the feature is not production-ready.

### 12.1 Sampling domains

Support deliberately:

- wall/clock time;
- event time;
- trade-count time;
- volume time;
- volatility-triggered/event bars where justified.

Do not force every phenomenon into one-minute candles.

### 12.2 Self-relative normalization

Each symbol requires robust baselines conditioned by appropriate context:

- rolling median/MAD;
- EWMA mean/variance;
- quantiles/t-digest;
- time-of-day and funding-cycle seasonality;
- liquidity/volatility regime;
- listing age and history sufficiency.

Raw volume ranks alone are not smell.

### 12.3 Redundancy, stability and attribution

The registry must stop correlated feature count from masquerading as intelligence.

Implement research diagnostics for:

- rank/Pearson/distance correlation by regime;
- hierarchical clustering of redundant features;
- variance and near-constant checks;
- mutual information estimated only inside training folds;
- permutation importance on chronological holdouts;
- SHAP or equivalent attribution for supported tree challengers, used as explanation rather than causality proof;
- feature-sign and monotonicity stability across folds/regimes;
- missingness-as-signal detection;
- adversarial removal/ablation of each family;
- incremental value after existing engine features.

No feature is retained merely because it occasionally appears important in one successful event.

---

## 13. Required feature families

Every bullet below is an evaluation obligation, not a command to ship every algorithm regardless of evidence. For each candidate record `ADOPT`, `ADAPT`, `REFERENCE_ONLY`, `REJECT`, or `BLOCKED_DATA`. Implement only candidates with sufficient source semantics, coverage, independent events and a credible incremental-value test. Phase acceptance rewards a coherent supported baseline, not a disconnected algorithm count.

### 13.1 Order flow and book pressure

Implement/test/ablate:

- L1 order-flow imbalance from limit additions, cancellations, and executions;
- multi-level OFI across depth bands;
- queue imbalance by level and cumulative bands;
- depth-weighted microprice and displacement from mid;
- signed trade/aggressor imbalance using exchange maker flags;
- trade-arrival rate, acceleration, burstiness, inter-arrival distribution and entropy;
- trade-size distribution shifts, tail mass, clustering and concentration;
- book slope, convexity and imbalance;
- depth depletion, replenishment, resiliency and migration;
- cancellation/addition intensity where reconstructable from L2;
- repeated level interaction and wall persistence;
- effective spread and intended-size executable VWAP;
- price response per unit signed flow;
- local impact/Kyle-style slope and Amihud-style illiquidity where meaningful;
- absorption proxies: aggressive flow with limited adverse price response plus replenishment;
- failed breakout/breakdown and failed response features;
- adverse-selection and opportunity-decay proxies.

Do not claim individual spoofing from public L2. Use `possible_spoof_like_pattern` with evidence and limitations.

### 13.2 Activity transition

- activity surprise at multiple horizons;
- persistence across 1s/5s/15s/60s/5m windows;
- one-print and one-burst rejection;
- transition from quiet spread/depth/trade regime;
- controlled-spread activity expansion;
- spot-led versus perp-led activation;
- price efficiency per unit flow;
- compression-before-expansion and liquidity-arrival patterns;
- repeated wake-and-fade history;
- ignition/continuation/exhaustion competing evidence;
- cross-sectional abnormality versus market/sector peers;
- data-quality-aware manipulation/fade risk.

### 13.3 Point-process/intensity features

Start with bounded, interpretable variants:

- rolling Poisson/intensity baselines;
- exponential-decay buy/sell/add/cancel intensities;
- excitation ratios and branching proxies;
- multivariate Hawkes challengers for selected focused symbols;
- time-rescaling residual diagnostics;
- stability checks to reject explosive/ill-conditioned fits.

Full Hawkes calibration must not block baseline inference. It remains a challenger until its incremental value and latency are measured.

### 13.4 Change and regime

- two-sided CUSUM;
- Page-Hinkley;
- ADWIN/KSWIN where supported;
- offline PELT segmentation;
- Bayesian Online Changepoint Detection with bounded run length;
- HMM/HSMM-like soft regimes behind a stable interface;
- volatility/liquidity/activity joint regimes;
- transition probabilities and detection delay;
- disorder/out-of-distribution state.

Evaluate false-alarm rate and detection delay, not merely plot quality.

### 13.5 Cross-sectional and lead/lag

- BTC/ETH/market/sector factor residuals;
- breadth and concentration;
- dynamic correlation/beta breakdown;
- Spot/perpetual cross-correlation by event and wall time;
- lagged OFI/trade-intensity transfer;
- Granger/transfer-entropy-like methods only as controlled research challengers with multiple-testing corrections;
- cross-venue evidence only after a licensed source is added;
- leader/follower stability and decay.

### 13.6 Basis and derivatives

- crossed executable Spot/perp basis in both constructions;
- mid/mark/index/premium differences kept distinct;
- gap velocity, acceleration, persistence and path shape;
- which leg caused each change;
- funding level/change/schedule/time-to-funding;
- open-interest level/change/acceleration and price/OI quadrants;
- liquidation context labeled sampled/partial;
- intended-size depth and hedge ratio;
- borrow availability, inventory, rate, interest timing and validity where known;
- total entry/exit/recovery cost distribution;
- convergence half-life estimates with uncertainty;
- state-space/Kalman latent fair-value challengers;
- error-correction/OU/cointegration diagnostics as hypotheses, never assumptions;
- survival/hazard estimates for convergence and non-convergence.

### 13.7 Data and latency as model features

- source age;
- exchange-to-receive delay;
- processing lag;
- gap/reconnect/resnapshot state;
- sampled/partial source flags;
- completeness score;
- inference duration;
- decision age at consumption.

Poor data should increase uncertainty or force abstention.

---

## 14. Specialist model battery

Build specialists, not one mystical predictor.

### 14.1 Mandatory transparent baselines

- robust heuristic baselines already used by current engines;
- calibrated logistic/elastic-net classification;
- linear/quantile regression;
- GAM/spline challenger where useful;
- liquidity-only and activity-only rankers;
- random-rank and no-trade controls.

Every complex model must beat these on untouched chronological evidence after costs and calibration.

### 14.2 Ranking

Build learning-to-rank or cost-sensitive ranking for attention allocation:

- top-`k` candidate recall;
- precision at focus budget;
- detection lead time;
- expected information gain from promotion;
- expected conservative net value;
- compute/stream cost.

Ranking does not authorize a trade.

### 14.3 Tabular predictions

Compare selected LightGBM/XGBoost/CatBoost challengers for:

- dormant-to-active transition;
- continuation conditional on stage;
- exhaustion/fade;
- executable Basis convergence;
- maximum favorable/adverse excursion;
- quantiles of net edge;
- actionability/capacity;
- false-positive/manipulation-like risk.

Use monotonic/interaction constraints only where the economic direction is defensible. Record all trials.

### 14.4 Survival and competing risks

Use survival/hazard models for:

- time to ignition;
- time to continuation/fade;
- time to Basis convergence;
- time to invalidation;
- fill/actionability window;
- right-censored no-event states.

Consider AFT/Cox/gradient survival models. Compare calibration of survival curves and integrated Brier score, not only concordance.

### 14.5 Anomaly/OOD

Evaluate a bounded set:

- robust MAD/quantile baseline;
- Isolation Forest;
- ECOD/COPOD or similarly justified lightweight detectors;
- Half-Space Trees/online anomaly where appropriate;
- robust covariance/PCA residual;
- one-class model only if it beats simple baselines;
- autoencoder only after data sufficiency and stable reconstruction targets.

An anomaly score is a promotion signal, not `buy`.

### 14.6 Regime mixture

Specialists may be mixed by soft regime probability. Do not use hard regime labels if boundary uncertainty matters.

Require:

- fallback when regime model is unavailable;
- model disagreement;
- per-regime calibration;
- prevention of unseen-regime overconfidence.

### 14.7 Historical analogues

Build earlier-only retrieval using Matrix Profile and/or FAISS:

- normalize by symbol and regime;
- store exact source windows and feature versions;
- exclude future, overlapping and same-event windows;
- return outcome distributions, not cherry-picked examples;
- expose distance, cohort size and data completeness;
- degrade gracefully when no close analogue exists.

### 14.8 Deep sequence challengers

DeepLOB/TLOB/TCN/Transformer-like models are optional shadow challengers only after a written data-sufficiency gate proves:

- enough complete historical L2 sequences;
- enough independent events/regimes;
- stable point-in-time labels;
- realistic cost/actionability targets;
- GPU/CPU budget;
- untouched holdout;
- simpler baselines already established.

Benchmark an MLP/simple temporal baseline. The TLOB paper itself warns that cost-aware labels materially reduce apparent predictability.

### 14.9 What not to build yet

- live-capital RL exploration;
- a generic foundation model called “the brain”;
- a single cross-stage “pump probability”;
- a neural model trained on reconstructed candles pretending to be L2;
- a model that selects its own test window;
- automatic model promotion based only on recent wins.

### 14.10 Mandatory hypothesis programs

The research factory must run named hypothesis programs rather than an undifferentiated model search.

#### H1 — dormant-to-active early transition

Null: apparent precursors do not improve future event ranking beyond self-relative activity/liquidity baselines after costs and multiple testing.

Test whether combinations of change-point probability, trade intensity, OFI, absorption, spread/depth behavior, Spot/perp leadership, cross-sectional residuals and historical motifs improve:

- precision at the limited focus budget;
- detection lead time;
- calibrated probability of ignition;
- MFE/MAE distribution;
- net actionability after latency/costs.

Keep `before`, `during`, and `too_late` targets separate.

#### H2 — continuation versus exhaustion

Conditional on an already active event, test separate continuation and exhaustion/false-burst hazards. Inputs may include flow-price response, replenishment, liquidity deterioration, acceleration decay, OI/funding crowding, divergence between venues/products and analogue outcomes.

The model must be allowed to say that the event is real but already untradeable.

#### H3 — executable normal Basis convergence

Null: raw Spot/perp gaps are fully consumed by spreads, fees, funding, slippage, timing and failure risk.

Model the path, leader, persistence, liquidity and convergence hazard. Evaluate net outcome under actual funding times and realistic two-leg execution assumptions, not mark-to-mid convergence.

#### H4 — reverse Basis feasibility

Treat borrow availability/rate/inventory/liability and four-leg execution as part of the target. If historical borrow truth is unavailable, label the strategy `DATA_INSUFFICIENT` rather than assuming it was available.

#### H5 — false burst/manipulation-risk filtering

Test whether repeated wake-and-fade history, low breadth, one-print concentration, spread/depth collapse, flow-impact inconsistency, possible spoof-like L2 patterns, OI/liquidation context and analogue outcomes reduce false positives. Do not claim criminal intent from public data.

#### H6 — cross-source leadership

Only after source adoption, test whether another venue/product consistently leads Binance by enough time to survive measured receive, inference and execution latency. Correct for the large number of symbols, lags and source combinations tried.

Each program must publish:

```text
null and alternative hypothesis
predeclared primary metrics
data and cohort requirements
baseline
specialist challengers
cost/latency assumptions
negative controls
multiple-testing family
result and confidence interval
ADOPT / CONTINUE_RESEARCH / REJECT / DATA_INSUFFICIENT
```

---

## 15. Calibration, uncertainty, ensemble and abstention

### 15.1 Probability calibration

For every probability-bearing model compare, as applicable:

- Platt/logistic calibration;
- isotonic calibration;
- temperature scaling for neural outputs;
- beta or quantile calibration if justified.

Calibration data must be chronological and separate from fitting data.

Report:

- Brier score;
- log loss;
- Expected Calibration Error with bin sensitivity;
- calibration intercept/slope;
- reliability diagrams;
- coverage by regime, symbol/liquidity cohort, stage and horizon.

### 15.2 Conformal uncertainty

Adapt conformal methods for nonstationary time series cautiously:

- rolling conformalized quantiles;
- adaptive conformal inference;
- coverage monitoring per regime/horizon;
- interval width and undercoverage;
- abstain when coverage collapses.

Do not claim exchangeability where it does not hold.

### 15.3 Uncertainty decomposition

Represent separately where possible:

- data/source uncertainty;
- out-of-distribution distance;
- model/ensemble disagreement;
- aleatoric outcome dispersion;
- cost/fill uncertainty;
- timing/decay uncertainty.

### 15.4 Ensemble policy

Use chronological out-of-fold predictions for stacking. Prevent a meta-model from seeing in-sample base predictions.

The ensemble must expose:

- each specialist’s output;
- calibrated combined output;
- conflicts;
- missing specialists;
- stability under cost/latency stress;
- explicit abstention reason.

---

## 16. Validation and anti-overfitting law

### 16.1 Chronological splitting

Require:

- chronological train/validation/test;
- grouped event identity;
- purging of overlapping feature/label intervals;
- embargo at least maximum dependent label horizon plus justified lookback;
- rolling/expanding walk-forward;
- final untouched chronological holdout;
- symbol/liquidity/regime stratified reports without leaking future group labels.

### 16.2 Negative controls

Every model family must face:

- shuffled labels;
- permuted within safe chronological blocks;
- lagged/stale features;
- future-value injection test that must fail loudly;
- random rank;
- activity-only/liquidity-only baseline;
- intentionally incomplete data;
- synthetic false burst;
- fee/slippage/funding/borrow/latency perturbation.

### 16.3 Multiple testing

Record every attempted trial, including failed and abandoned trials.

Use, where statistically appropriate:

- PBO/CPCV-style analysis;
- Deflated Sharpe Ratio;
- block bootstrap confidence intervals;
- false discovery or family-wise correction;
- effective number of correlated trials;
- minimum track-record/sample sufficiency.

Optuna or any automated search counts as many trials, not one clever model.

### 16.4 Metrics that matter

Report at least:

- PR-AUC for rare events;
- ROC-AUC only as secondary context;
- precision/recall at focus and capital budgets;
- top-`k` recall;
- detection lead time;
- opportunity decay;
- Brier/log loss/ECE/calibration slope;
- MFE/MAE and tail outcomes;
- expected versus realized net edge;
- capacity and turnover;
- cost/latency sensitivity;
- per-regime and per-stage performance;
- false-positive and missed-opportunity rate;
- abstention coverage and performance conditional on acting.

Do not optimize raw accuracy for a rare event.

### 16.5 Promotion gate

A challenger cannot become champion unless it:

1. reproduces from immutable inputs and manifests;
2. passes leakage/negative controls;
3. improves a declared primary metric on untouched chronological evidence;
4. retains or improves calibration;
5. survives realistic costs and latency;
6. meets inference resource budget;
7. is not materially worse in critical regimes/tails;
8. has an AlgorithmCard and ModelCard;
9. passes shadow comparison;
10. receives an auditable promotion record.

---

## 17. Online learning, drift and retirement

### 17.1 Shadow-first learning

- Production champion is immutable during its deployment revision.
- Challengers score the same events in shadow.
- Delayed labels update evaluation records after horizon maturity.
- No online learner rewrites champion weights in place.
- A drift response may warn, freeze, abstain, or demote; it may not increase capital authority.

A quant “champion” is a reproducible `RESEARCH_ONLY` inference artifact, not an operational deployment decision. Quant may recommend freeze/demotion and emit `ABSTAIN_UNKNOWN`; it may not hot-swap a model, change product mode, alter capital/risk or self-promote a challenger. The live product explicitly pins an approved artifact hash and policy revision through canonical deployment/config authority after shadow, compatibility, rollback and integration tests.

### 17.2 Drift layers

Track:

- input feature distribution drift;
- missingness/quality drift;
- prediction distribution drift;
- residual/error drift;
- calibration drift;
- regime mix drift;
- net utility/edge decay;
- inference latency/resource drift.

Use a justified subset of ADWIN, Page-Hinkley, KSWIN, PSI, KS, Wasserstein/JS distance, and rolling calibration tests.

### 17.3 Delayed outcomes

Support labels that mature at different horizons. Prevent a 1s label from masquerading as final 1h outcome.

### 17.4 Retirement

Retiring a model or feature preserves:

- artifact;
- evidence;
- reason;
- last valid regime/cohort;
- successor or fallback;
- rollback path.

An edge that disappears should be disabled, not cosmetically retuned forever.

---

## 18. Experiment, dataset and model registry

### 18.1 Registry identities

Every run records:

```text
experiment ID
hypothesis
code commit
environment/dependency lock hash
input dataset manifests/hashes
feature/label versions
split/fold identities
parameters and seed
all attempted trial identities
metrics and confidence intervals
artifacts
latency/resource benchmark
model card
promotion/rejection decision
```

### 18.2 Model cards

Required fields:

- intended use and forbidden use;
- training/validation/test periods;
- symbols/products/cohorts;
- data sufficiency and missingness;
- feature and label versions;
- algorithm and hyperparameters;
- calibration method;
- cost assumptions;
- performance by regime/stage/liquidity;
- known failures and drift triggers;
- inference budget;
- champion/challenger/retired state.

### 18.3 Dataset cards

- sources/licenses;
- date and symbol coverage;
- stream cadence and timestamps;
- gaps/revisions/checksums;
- survivorship/delisting limitations;
- L2 availability;
- feature/label lineage;
- retention and privacy state.

---

## 19. Bounded inference service

Build a local-only service or equivalent stable process boundary under `quant/inference/**`.

### 19.1 Requirements

- binds only to loopback or Unix-domain socket by default;
- no public internet listener;
- no secrets or private exchange access;
- versioned protocol validation;
- loaded champion and shadow challengers;
- health/readiness/model-lineage endpoints;
- batch and streaming assessment where justified;
- bounded queues and backpressure;
- strict feature cutoff and expiry;
- deterministic timeout/failure vocabulary;
- structured metrics;
- graceful shutdown and artifact integrity;
- safe fallback to `ABSTAIN_UNKNOWN`.
- allowlisted artifact formats and verified hashes only;
- no untrusted pickle/joblib/remote URI/plugin deserialization;
- bundle model, code, feature schema and dependency-lock hashes together;
- bounded request bytes, symbol count, horizons, rows, concurrency and time;
- Unix-socket permissions or authenticated local peer;
- reject downgrade, path traversal, unknown model ID, NaN/Inf and decompression bombs;
- keep MLflow/tracking listeners local and non-authoritative;
- no raw private/account evidence in metrics or errors.

### 19.2 SLO measurements

Benchmark, do not invent:

- per-symbol feature update latency;
- single and batch inference p50/p95/p99;
- memory by universe/focus size;
- cold/warm startup;
- queue depth and drop policy;
- throughput at expected and stress rates;
- assessment age on consumption;
- canonical semantic replay hash stability for inputs, lineage, decisions, reason codes and exact decimal/integer outputs. Floating outputs use declared tolerances and record CPU/platform/library metadata; do not require byte-identical Parquet/model artifacts across hardware unless explicitly canonicalized.

### 19.3 Generated consumers

Generate or provide tested protocol clients/fixtures under `quant/generated/**`. Shared Node wiring remains a later director integration action.

---

## 20. Phase-by-phase sustained build

The builder must progress in order unless a receipt proves an existing phase is already fully implemented and compatible.

Twelve hours is a work tranche, not a promise that Q00–Q17 can honestly become production-complete in one session. Milestones span as many clean resumable sessions as needed. At a capacity boundary, stop at the last director-accepted checkpoint and report each phase `COMPLETE`, `PARTIAL`, `BLOCKED_DATA`, `BLOCKED_EXTERNAL`, `REFERENCE_ONLY`, or `SUPERSEDED`. Never replace missing data, ablations, benchmarks or untouched evidence with stubs/cards/fixtures merely to advance a phase number.

### Q00 — actual-source and reuse matrix

Implement no duplicate organs.

Deliver:

- actual Git/base/protocol proof;
- canonical type/import map;
- current evidence availability;
- current test commands/counts;
- exact gap/reuse matrix;
- benchmark profile: hardware/CPU, dependency lock, point-in-time universe, event-rate traces, stream cadences, candidate/focus caps, active-position priority load, memory/disk ceilings, queue policy and target SLOs;
- changed-path guard;
- Q00 receipt and commit.

Acceptance: each claimed reusable component is proved from source/test, and no existing authority is scheduled for replacement.

### Q01 — package, determinism and framework intake

Deliver:

- pinned Python workspace;
- deterministic config/clock/randomness interfaces;
- lint/type/test/coverage commands;
- framework/license/adoption matrix;
- dependency security/license receipt;
- minimal CLI;
- Q01 commit.

Acceptance: clean install, import, test and deterministic seed fixture from the locked environment.

### Q02 — lake, manifests and quality

Deliver:

- immutable Parquet/Arrow writer/reader;
- manifest/checksum/provenance model;
- quality state engine;
- exact decimal/scaled numeric handling;
- DuckDB query helpers;
- retention/revision behavior;
- property/golden tests.

Acceptance: identical input produces identical partition/manifests; corruption or schema mismatch fails closed.

### Q03 — historical bootstrap and forward capture seam

Deliver:

- checksum-verified Binance archive importer;
- canonical event normalization;
- read-only bridge fixtures for current live runtime;
- source coverage report;
- optional Tardis adapter interface without requiring a subscription;
- gap/restart/session evidence.

Acceptance: a real public sample is imported end-to-end and limitations are explicit.

### Q04 — local book and temporal truth

Deliver:

- Spot and USD-M book reconstructor/reference model;
- sequence/gap/resnapshot rules;
- exchange/receive/processing clocks;
- late/duplicate/out-of-order handling;
- deterministic replay.

Acceptance: gap campaigns never emit an actionable complete book before resynchronization.

### Q05 — label and matched-control factory

Deliver all Section 11 targets with point-in-time lineage, censoring, event grouping and leakage tests.

Acceptance: no feature can observe its own future label interval; controls are reproducible and non-overlapping.

### Q06 — feature registry and robust baselines

Deliver:

- registry law;
- streaming/batch equivalence harness;
- robust symbol-relative baselines;
- time-domain/window primitives;
- feature freshness and quality propagation.

Acceptance: streaming and batch golden vectors agree within declared tolerances.

### Q07 — microstructure and liquidity library

Deliver and test the OFI, queue, microprice, depth, spread, flow, impact, absorption, replenishment, depletion and intended-size feature families.

Acceptance: each feature has an AlgorithmCard, golden examples, failure cases and incremental-update benchmark.

### Q08 — derivatives, Basis and cross-market library

Deliver executable Basis/cost/funding/OI/liquidation/lead-lag/borrow-knownness/state-space/convergence feature and target support.

Acceptance: normal and reverse constructions remain distinct; missing borrow or funding never becomes zero.

### Q09 — change, regime, anomaly and analog layer

Deliver CUSUM/Page-Hinkley/PELT/BOCPD, soft regime, selected anomaly, Matrix Profile and earlier-only retrieval baselines.

Acceptance: false alarms, detection delay, OOD and future/overlap exclusions are measured.

### Q10 — transparent and boosted model battery

Deliver calibrated linear baselines plus selected boosted rank/classification/regression/quantile models with bounded Optuna studies.

Acceptance: all trials logged; complex challengers may honestly lose.

### Q11 — survival and competing-risk models

Deliver time-to-event/convergence/fade/actionability models with censored labels and calibration reports.

Acceptance: survival curves and time-dependent metrics pass deterministic fixtures.

### Q12 — ensemble, calibration and abstention

Deliver out-of-fold stacking, calibration, conformal/adaptive interval challenger, uncertainty decomposition and abstention.

Acceptance: stale, OOD, conflicting or cost-negative evidence can deterministically produce `ABSTAIN_UNKNOWN`.

### Q13 — deep sequence gate and optional challengers

First write the data-sufficiency receipt. If it fails, implement only interfaces/fixtures and mark deep models `REFERENCE_ONLY`. If it passes, implement a simple MLP plus one DeepLOB/TLOB-style shadow challenger.

Acceptance: no deep model is promoted on benchmark accuracy without current cost-aware chronological evidence.

### Q14 — validation and falsification factory

Deliver purged/embargoed walk-forward, untouched holdout, negative controls, cost/latency stress, PBO/DSR diagnostics where valid, bootstrap intervals and comparison reports.

Acceptance: a deliberately leaked model is detected and rejected.

### Q15 — registry, champion/challenger, drift and retirement

Deliver experiment/model/data cards, artifact hashes, promotion/demotion/rollback, shadow scoring, delayed feedback and drift alarms.

Acceptance: restart restores the exact champion; a drift fixture demotes to advisory/abstain without self-promoting a challenger.

### Q16 — inference service and generated protocol kit

Deliver local inference, protocol validation, queue/backpressure, health, metrics, model lineage and generated fixtures/clients.

Acceptance: raw fixture -> evidence -> features -> models -> calibrated `EdgeAssessmentEnvelopeV1` with deterministic hashes.

### Q17 — end-to-end proof, benchmark and final receipt

Run:

- all unit/property/contract/leakage/replay/integration tests;
- deterministic replay twice;
- data corruption and sequence-gap campaigns;
- model baseline/ablation reports;
- calibration and untouched-holdout reports;
- performance/memory stress;
- secret/network/order import scans;
- changed-path scope check.

Deliver final component manifest, receipts, exact SHAs, limitations, and integration instructions.

---

## 21. Required test commands

Choose exact tools during Q01, but expose stable commands equivalent to:

```text
quant lint
quant typecheck
quant test:unit
quant test:property
quant test:contract
quant test:replay
quant test:leakage
quant test:integration
quant test:benchmark
quant test:all
quant research:baseline
quant research:walk-forward
quant registry:verify
quant protocol:verify
```

The final receipt records exact executed commands and counts. Do not hardcode aspirational counts in advance.

---

## 22. Acceptance gate

This program is accepted only if all are true:

- changes are contained to allowed paths;
- dependencies are pinned, licensed and justified;
- real source limitations are recorded;
- raw evidence/manifests are immutable and checksummed;
- local books fail closed on gaps;
- point-in-time features and labels pass leakage tests;
- acted, rejected, expired, missed and quiet controls can receive outcomes;
- feature batch/streaming parity is tested;
- model trials and failed hypotheses are preserved;
- transparent baselines exist;
- probability outputs are calibrated or explicitly uncalibrated/non-actionable;
- historical analogues are earlier-only and non-overlapping;
- cost/latency stress can turn an attractive prediction into abstention;
- champion/challenger, drift, demotion and rollback work after restart;
- inference emits a versioned advisory envelope with full lineage;
- no quant module can touch secrets, account mutations, risk approval or orders;
- deterministic end-to-end replay is reproducible;
- performance is measured against the actual expected universe/focus budget;
- final receipt states what is implemented, reference-only, data-insufficient, disproved, or still unknown.

The program may finish with no proven profitable edge. That is an honest scientific result. It must not finish without the machinery to test the next hypothesis correctly.

`QUANT_COMPLETE` means only that the isolated advisory lane is ready for controlled integration. It does not mean the mission or live product is complete. No artifact is canonical, wired, money-relevant or live until the integration branch pins it, updates the authority map, passes cross-language/stale/timeout/abstention/restart/rollback tests and exposes truthful supervisor/cockpit state.

---

## 23. Exact instruction to give Fable 5

```text
Execute QUANT_EDGE_RESEARCH_FACTORY_12H.md as the acceptance director of the isolated Q-lane. Verify exact directive inputs, canonical authority/base ancestry and create or reuse one director-owned protocol interchange commit only after mapping existing canonical types. Create a dedicated worktree and enforce quant/** ownership. Keep one logical Codex 5.6 Sol/Ultra technical lead for continuity, but issue only one bounded Q-phase brief per session; allow workers only on exclusive quant subdirectories. Accept a phase only through implementation commit, immutable receipt and director acceptance/state commit. This is implementation, not another audit or planning response. Do not rebuild/edit the engines, runtime, capital, risk, execution, ledger, routes, UI or private clients. Build the evidence lake, point-in-time instrument/data/label truth, matched controls, feature registry, data-supported microstructure/Basis/regime/anomaly/analogue algorithms, specialist models, anti-leakage validation, calibration/uncertainty/abstention, registry, shadow comparison, drift/retirement and bounded inference. Evaluate sources/frameworks honestly; never vendor or inflate code. Continue phase-by-phase without routine questions and checkpoint cleanly at capacity. Never use secrets, private APIs, live orders, withdrawals, transfers, LLM hot-path decisions or code-volume theater. Return exact SHAs, phase statuses, actual evidence and integration seam.
```

---

## 24. Exact instruction for the Codex lead

```text
You are the current bounded-phase builder for QUANT_EDGE_RESEARCH_FACTORY_12H.md. Work only in the director-provided Q worktree and quant/**. Verify all recorded mission/authority/base/protocol/task hashes and Git ancestry. Execute only the exact current Q-phase brief; do not return a plan or redo accepted work. Run focused/accumulated tests, adversarially review, correct failures, create the implementation commit and ready receipt, then return it for director acceptance. Reuse canonical contracts read-only and never create a competing source, scanner, strategy, ledger, capital/risk, executor, UI or private client. Research official repositories/primary papers, implement only data-supported candidates, and preserve negative results. Build the current phase toward immutable evidence, point-in-time labels, microstructure/derivatives features, calibrated specialist models, uncertainty/abstention, earlier-only analogues, anti-leakage validation, lineage, shadow/drift/rollback and local advisory inference. EdgeAssessmentEnvelopeV1 can never authorize an order. If time or data ends, leave a clean PARTIAL/BLOCKED checkpoint with the exact next task; never fabricate completion.
```

---

## 25. Final report format

```text
QUANT EDGE RESEARCH FACTORY — RESULT

Overall status:
Per-phase status/evidence:
Canonical base SHA:
Protocol SHA:
Branch/worktree:
Phase commits Q00-Q17:
Changed-path scope result:
Environment/dependency lock:
Framework adoption matrix:
Historical sources and coverage:
Forward evidence seam:
Dataset/manifests:
Book/data-quality proof:
Labels and controls:
Feature families implemented:
Algorithms implemented/reference-only/rejected:
Models and baselines:
Calibration/uncertainty:
Analog retrieval:
Validation and leakage proof:
PBO/DSR/multiple-testing state:
Champion/challenger/drift:
Inference service and protocol:
Actual test counts:
Actual benchmarks:
Data-insufficient capabilities:
Disproved/failed hypotheses:
Any measured incremental value:
What is not evidence of edge:
Integration instructions:
Remaining blockers:
Final commit SHA:
Working-tree status:
```
