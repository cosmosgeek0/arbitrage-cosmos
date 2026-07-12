# CAPITAL SUPERVISION MAX-POWER SPRINT

## Controlling instruction

This is an implementation sprint. Start building immediately after the mandatory repository and scope checks. Do not return a planning-only response, another audit report, UI redesign, or speculative architecture essay.

Build the missing **Opportunity-to-Position Operating Kernel**: the pure, deterministic backend organ that decides how much capital may be reserved for competing opportunities, converts a valid proposal into a staged capital mandate, continuously supervises exposed capital, recommends hold/add/reduce/hedge/exit/recovery actions, and explains the complete economics of the position.

It must never place an order. It must never borrow. It must never approve its own risk. It must never invent missing account, cost, market, or reconciliation truth.

The sprint is successful only when production code, deterministic tests, cross-lane scenarios, a component manifest, and an exact receipt are committed on the designated feature branch.

---

## 1. Why this organ is next

The repository already has, or has active isolated work for, these major territories:

- Existing Basis and Volume engines own strategy calculations and proposals.
- Existing live runtimes already provide partial Binance public-data operation for those engines.
- The completed Market Intelligence branch owns normalized evidence, universe reasoning, features, attention, thesis, forensics, outcomes, and topology primitives.
- The separate Backend Foundation sprint owns the control plane, canonical read model, multi-leg risk evaluation, two-leg execution coordination, reconciliation, USD-M read/test boundaries, replay, and diagnostics.
- The existing ledger/database remains the durable system-of-record boundary.

The largest missing semantic organ is what happens **between a strategy proposal and an executable request, and after capital becomes exposed**.

The mission explicitly requires:

1. conservative opportunity comparison;
2. capital scarcity and portfolio allocation;
3. staged entry and staged reduction;
4. explicit operator authority;
5. active capital becoming the system's highest-priority object;
6. thesis-aware hold/add/reduce/hedge/exit decisions;
7. funding, borrow, liquidity, hedge drift, and one-leg-exposure supervision;
8. exact PnL and cost attribution;
9. restart-safe, explainable state;
10. a render-ready machine graph that later lets the cockpit show what is blocking capital.

Neither current sprint owns that full lifecycle. This sprint builds it as a dormant, pure, integration-ready organ.

This is not a promise of profit. It is the missing decision and supervision layer required before capital can be operated safely or evaluated honestly.

---

## 2. Required starting state and branch

Work in the real Main repository selected by the owner. Expected local repository path is:

```text
/Users/cosmosgeek/Desktop/Main
```

Resolve the actual path from the Codex session rather than guessing if it differs.

Known audited and completed state at the time this directive was written:

```text
audited current-main base:              b272049b1e482ff75de27fbdaece7be5a7bbcc5d
completed Market Intelligence branch:   market-intelligence-main-20260711
completed Market Intelligence commit:   3340f75
existing repository checks:             377/377
Market Intelligence checks:             152/152
Market Intelligence scenario harness:   12/12
```

Before editing:

1. Run `git status --short`, `git branch --show-current`, and `git log --oneline --decorate -12`.
2. Verify commit `3340f75` exists locally and is the accepted Market Intelligence tip or identify its exact successor if Claude made a documentation-only completion commit after it.
3. Verify no other agent or process is writing to this checkout.
4. Preserve these known input documents if they remain untracked; they are not sprint output:
   - `ENGINE_SPRINT_5H.md`
   - `MARKET_INTELLIGENCE_MAX_POWER_SPRINT.md`
   - `PARALLEL_BACKEND_MAX_POWER_SPRINT.md`
   - `What-i-want.txt`
5. Do not stash, delete, move, overwrite, or commit those four input documents.
6. If there are any other unexplained changes, stop and report them. Do not clean them.
7. Create or resume this feature branch from the accepted Market Intelligence tip:

```text
capital-supervision-main-20260711
```

8. If creating it, branch directly from `3340f75` or its explicitly verified accepted successor—not from an older pre-audit commit.
9. Record the exact base SHA in the final receipt.

This is intentionally a stacked branch:

```text
audited Main -> Market Intelligence -> Capital Supervision
```

The later integrator must land Market Intelligence before applying the Capital Supervision delta.

Do not merge into `current-main`. Do not push unless the owner or Claude Code explicitly asks. Commit locally in coherent checkpoints.

---

## 3. Exclusive write scope

Production code may be created only under:

```text
server/src/capitalFoundation/**
```

Tests and fixtures may be created only under:

```text
server/test/capitalFoundation/**
```

The only permitted root artifacts are:

```text
CAPITAL_SUPERVISION_COMPONENTS.md
CAPITAL_SUPERVISION_RECEIPT.md
```

Everything else is read-only, including:

```text
server/src/engine/**
server/src/intelligenceFoundation/**
server/src/foundation/**
server/src/services/**
server/src/routes/**
server/src/index.ts
server/src/storage/**
server/src/ledger/**
server/src/binance/**
server/test/engine-*.mjs
web/**
package.json
server/package.json
all lockfiles
all existing documentation
all secrets and environment files
```

If the repository convention makes the allowed test directory impossible to execute without editing a package script, run the tests directly with the repository's existing test/runtime tool. Do not edit package files merely for convenience.

At every checkpoint, verify the sprint delta:

```bash
git diff --name-only <accepted-market-intelligence-base>...HEAD
```

Every changed path must be inside the exclusive scope above.

---

## 4. Mandatory source audit before production edits

This is a focused reuse audit, not a six-hour repository security audit.

Inspect the actual source for existing owners of:

- Basis proposals and lifecycle;
- Volume proposals and lifecycle;
- account and portfolio snapshots;
- risk gates and safety configuration;
- execution ticket/order/leg states;
- reconciliation states;
- ledger event contracts;
- Market Intelligence evidence, thesis, outcome, and topology contracts;
- existing PnL calculations;
- existing position or reservation concepts.

Create a short ownership table in `CAPITAL_SUPERVISION_COMPONENTS.md` before implementing the lanes. For every overlapping concept, record:

```text
concept | existing owner | this sprint's role | future adapter seam | duplication avoided
```

Rules:

- Reuse stable exported contracts where they are genuinely canonical.
- Otherwise consume them through narrow input ports and translation functions.
- Never copy a whole existing module into the new namespace.
- Never create a second strategy score, second risk gate, second executor, second reconciliation engine, second ledger, or second market-intelligence engine.
- If an equivalent capability already exists, adapt to it, extend it only inside this sprint's exclusive namespace, or explicitly mark the lane `ALREADY_OWNED` in the manifest.

Do not weaken the scope simply to claim completion. Do not duplicate code merely to increase output.

---

## 5. Permanent authority boundaries

These boundaries are architectural law.

### Existing Basis and Volume engines

Own:

- strategy-specific detection;
- strategy-specific score/confidence;
- strategy-specific proposal creation;
- proposal invalidation reasons;
- strategy-specific market interpretation.

This sprint may consume proposals. It may not silently reinterpret a rejection as an opportunity or manufacture a new strategy proposal.

### Market Intelligence

Owns:

- evidence normalization;
- universe and attention facts;
- features;
- thesis and forensic evidence;
- observed outcomes;
- evidence topology.

This sprint may consume evidence and thesis packets. It may not fabricate missing evidence or train a confidence model.

### Capital Supervision, built here

Owns:

- cross-opportunity eligibility for capital consideration;
- deterministic capital budgeting and reservations;
- proposal-to-capital-mandate conversion;
- staged exposure policy;
- operator approval envelopes;
- active-position thesis supervision;
- economic hold/add/reduce/hedge/exit/recovery recommendations;
- PnL and cost decomposition;
- serializable checkpoints and capital-lifecycle events;
- render-ready active-capital dependency state.

It emits recommendations and typed intents. It never sends an order.

### Backend Foundation multi-leg risk

Owns:

- final pre-trade risk approval, rejection, or size cap for a concrete plan;
- hard limits and safety posture.

Capital Supervision must not self-approve risk.

### Backend Foundation execution coordinator

Owns:

- exact order and leg mechanics;
- exchange order state;
- retries, cancels, leg sequencing, and mechanical recovery;
- execution correlation.

Capital Supervision may request an economic action. It does not own how orders accomplish it.

### Backend Foundation reconciliation

Owns:

- exchange-versus-local truth comparison;
- ambiguous or divergent order/position truth.

Capital Supervision must treat reconciliation uncertainty as uncertainty.

### Future exchange adapters

Own:

- signed Spot, Futures, Margin, borrow, repay, and user-data calls.

None are built or invoked in this sprint.

### Existing ledger/database

Owns durable truth. This sprint defines serializable event and checkpoint payloads plus persistence ports; it performs no filesystem or database I/O.

---

## 6. Anti-garbage and safety laws

All production modules in this sprint must obey these rules:

1. No network calls.
2. No Binance SDK or endpoint calls.
3. No order, test-order, cancel, borrow, repay, transfer, or withdrawal call.
4. No filesystem or database access.
5. No environment-variable reads.
6. No process-global mutable singleton.
7. No implicit wall-clock reads; inject a clock or `now` value.
8. No `Math.random()` or unstable IDs.
9. No floating-point arithmetic for money, quantity, rate, or PnL. Use the repository's exact-decimal convention or implement a bounded integer/decimal value object inside scope.
10. No `any` at authority boundaries.
11. No missing value represented as zero.
12. No stale value represented as fresh.
13. No incomplete economics represented as profitable.
14. No configuration value without bounds, version, source, and effective time.
15. No approval without scope, revision/hash, maximum authority, expiry, and revocation semantics.
16. No stage increase without fresh evidence, available reservation, approval, and a future risk recheck.
17. No averaging down by accident.
18. No action loop hidden in a timer.
19. No strategy-specific magic threshold without an explicit named policy input.
20. No action result called successful before execution and reconciliation owners confirm it.
21. `UNKNOWN`, `PARTIAL`, `STALE`, `DIVERGENT`, and `RECOVERY_REQUIRED` must remain first-class states.
22. New-entry pause or kill posture must block `OPEN` and `ADD`, but must never disable supervision or suppress risk-reducing `REDUCE`, `EXIT`, or recovery recommendations.

Prefer small modules with one owner. Avoid a single multi-thousand-line file.

---

## 7. Required top-level module layout

Use this shape unless the actual repository convention justifies a narrowly documented variation:

```text
server/src/capitalFoundation/
  contracts/
  accountTruth/
  opportunities/
  budgets/
  allocation/
  stages/
  approvals/
  economics/
  positions/
  supervision/
  actions/
  checkpoint/
  topology/
  scenarios/
  index.ts

server/test/capitalFoundation/
  contracts.*
  accountTruth.*
  opportunities.*
  budgets.*
  allocation.*
  stages.*
  approvals.*
  economics.*
  positions.*
  supervision.*
  actions.*
  checkpoint.*
  topology.*
  compatibility.*
  scenarios.*
```

Every directory must expose a narrow public barrel. Keep internal helpers internal.

---

## 8. Wave 0 — frozen contracts and invariants

Build and test contracts before parallel implementation lanes.

### Identity and revision contracts

Define stable, serializable, branded identities for at least:

- strategy proposal;
- evidence packet;
- opportunity consideration;
- capital mandate;
- allocation decision;
- capital reservation;
- staged plan;
- operator approval;
- position thesis;
- active position;
- action intent;
- execution correlation reference;
- reconciliation reference;
- checkpoint;
- config revision.

IDs must be deterministic or supplied by the caller. Replaying the same input and clock must produce byte-equivalent canonical output.

### Required truth/completeness states

At minimum:

```text
COMPLETE | PARTIAL | STALE | UNKNOWN | DIVERGENT
```

Every truth-bearing snapshot must include:

- source identity;
- source timestamp where available;
- received/evaluated timestamp;
- freshness policy/result;
- completeness;
- reasons/evidence references;
- revision or sequence where applicable.

### Capital lifecycle states

At minimum:

```text
OBSERVED
ELIGIBLE
BLOCKED
ADVISORY
RESERVED
PLANNED
AWAITING_APPROVAL
AWAITING_RISK
READY_FOR_EXECUTION
ENTERING
PARTIALLY_EXPOSED
HEDGED
ACTIVE
REDUCING
EXITING
RECOVERY_REQUIRED
CLOSED
CANCELLED
EXPIRED
UNKNOWN
```

Define legal transitions. Illegal stage jumps must fail with typed reasons.

### Position action intents

At minimum:

```text
HOLD
ADD_STAGE
REDUCE
REQUEST_HEDGE
REQUEST_EXIT
REQUEST_EMERGENCY_UNWIND
FREEZE_NEW_ACTIONS
NO_ACTION_UNKNOWN
```

Each intent must include:

- why;
- source position/thesis revision;
- target exposure or delta, never a vague verb alone;
- urgency;
- hard deadline if one exists;
- supporting/conflicting evidence;
- required future risk/approval/reconciliation gates;
- completeness and blocking facts;
- idempotency/correlation key.

### Economics completeness

Define components for:

- mark-to-market leg PnL;
- realized leg PnL;
- basis convergence/divergence contribution;
- directional contribution;
- funding paid/received;
- borrow interest and fees;
- trading commissions;
- entry and exit spread cost;
- estimated and realized slippage;
- execution shortfall;
- one-leg/naked-exposure contribution;
- conversion/valuation contribution;
- operational/recovery cost;
- residual unexplained amount.

Every component requires `KNOWN`, `ESTIMATED`, `MISSING`, or `NOT_APPLICABLE`. `MISSING` is never zero.

### Wave 0 gate

Create focused contract tests and freeze the public contract surface in a checkpoint commit before launching implementation lanes. Record that SHA.

---

## 9. Wave 1 — independent implementation lanes

Use internal agents only for exclusive directories. The lead owns contract changes, integration, and all commits.

### Lane A — Account and allocatable-capital truth

Build a canonical input-side projection for capital decisions. It consumes caller-supplied account/position/open-order/liability snapshots; it never fetches them.

Required outputs:

- total and available collateral by asset;
- conservative valuation status;
- spot balances and locked funds;
- futures wallet, margin, and position exposure supplied by adapters;
- liabilities and borrow availability supplied by adapters;
- outstanding order, plan, and reservation commitments;
- gross exposure, net directional exposure, and hedge imbalance;
- source freshness/completeness;
- allocatable amount after hard reserves;
- exact reasons an amount is unavailable or unknown.

An incomplete, stale, contradictory, or unvalued required snapshot must block new allocation. It must not erase supervision of already exposed capital.

### Lane B — Opportunity intake and capital eligibility

Consume existing Basis/Volume proposal references and optional Market Intelligence evidence/thesis references.

Required behavior:

- preserve original proposal ID, strategy, revision, and authority;
- reject expired or invalidated proposals;
- detect stale/missing evidence and config-version mismatch;
- identify conflicting proposals for the same asset/instrument/capital;
- distinguish executable Basis structures from directional Volume intelligence;
- allow policy to keep Volume in `ADVISORY` or `VALIDATE_ONLY` until outcome calibration permits more;
- compute conservative economic inputs without changing the engine's strategy score;
- produce typed eligibility or block reasons;
- never turn a rejected engine proposal into an eligible one.

### Lane C — Portfolio budget, allocation, and reservations

Build a deterministic allocator for scarce capital across simultaneous eligible opportunities.

Required constraints:

- portfolio gross and net exposure;
- collateral and margin headroom;
- per-strategy budget;
- per-symbol and correlated-asset budget;
- per-venue/instrument budget;
- maximum concurrent plans and active positions;
- borrow inventory/capacity where required;
- liquidity and intended-size capacity;
- risk-reduction reserve that cannot be allocated to new entries;
- existing orders, reservations, and partially exposed positions;
- deterministic priority/tie breaking;
- no double reservation;
- reservation TTL, renewal, release, and idempotency;
- exact audit trail from requested size to granted/capped/blocked size.

Do not implement Kelly sizing or an opaque optimizer. Start with bounded, explainable policies. Unknown required inputs fail closed.

### Lane D — Staged capital mandate and sizing policy

Build a staged plan that separates economic intent from mechanical order execution.

Required stages:

```text
OBSERVE -> PROBE -> CONFIRM -> ADD/HOLD -> REDUCE -> EXIT
```

Not every opportunity must use every stage. Legal transitions and skip conditions must be explicit.

Each stage must specify:

- maximum additional and total exposure;
- reservation consumed;
- evidence and freshness prerequisites;
- economic thesis condition;
- invalidation condition;
- maximum time in stage;
- required operator approval scope;
- required future risk gate;
- liquidity/depth requirement;
- maximum naked-leg amount and duration supplied to the future executor;
- stop-adding conditions;
- next-stage and reduction conditions;
- cancellation semantics for unentered future stages.

No `ADD` may occur merely because price moved against the position. Every increase requires explicit current evidence and authority.

### Lane E — Versioned operator approval and configuration authority

Build pure validation and state-reduction logic, not routes or storage.

An approval must bind to:

- operator identity reference;
- proposal and capital-mandate ID/revision/hash;
- strategy and symbols/instruments;
- allowed action classes;
- maximum notional/exposure;
- mode (`READ_ONLY`, `ADVISORY`, `VALIDATE_ONLY`, `MANUAL_ARMED`);
- config revision;
- issue and expiry times;
- revocation state;
- optional stage limits;
- reason/comment reference.

Required behavior:

- expired approval rejects;
- revoked approval rejects;
- changed plan/config/proposal requires reapproval;
- approval cannot increase limits beyond validated policy bounds;
- one approval cannot silently authorize repeated unrelated entries;
- read-only/advisory/validate-only can never produce an execution-ready mandate;
- `MANUAL_ARMED` still requires the external risk and execution owners;
- operator pause and kill posture block new/increasing exposure while preserving reduction, exit, and recovery intents.

### Lane F — Active position and thesis supervisor

Once any exposure exists, it becomes higher priority than unopened opportunities.

Build a pure supervisor that consumes caller-supplied position truth, reconciliation state, market evidence, original thesis, costs, control posture, and time.

Required position states include:

```text
ENTERING
PARTIALLY_EXPOSED
HEDGED
ACTIVE
REDUCING
EXITING
RECOVERY_REQUIRED
CLOSED
UNKNOWN
```

Required universal checks:

- reconciliation completeness and divergence;
- leg presence, quantity, side, and hedge ratio;
- one-leg exposure amount and duration;
- source freshness;
- spread, depth, and exit capacity;
- current and projected cost;
- thesis age and invalidation;
- target, time, and risk limits;
- outstanding action intents;
- control/kill posture;
- whether an action reduces or increases risk.

Required Basis-specific supervision inputs:

- entry and current executable basis;
- convergence/divergence path;
- expected remaining edge after exit costs;
- funding rate, direction, next funding time, and accrued funding;
- borrow availability, rate, accrued cost, and recall/unavailability state;
- leg hedge drift;
- liquidation/margin distance supplied by account truth;
- spot/perpetual liquidity deterioration;
- original convergence horizon and invalidation.

Required Volume-specific supervision inputs:

- original dormant-to-active thesis and stage;
- continuation, acceleration, exhaustion, and reversal evidence;
- spot/perpetual leadership change;
- liquidity/spread/depth change;
- crowding/funding/open-interest evidence when supplied;
- time-in-thesis and maximum holding horizon;
- observed false-follow-through or wash-like evidence;
- outcome-calibration policy/mode.

Outputs are typed intents only. The supervisor must never send an order or call the risk gate itself.

### Lane G — Economic action and exit planner

Convert supervision results into explainable economic targets:

- hold current target exposure;
- add only the next authorized stage;
- reduce to an exact target exposure;
- request a hedge delta;
- request orderly exit;
- request emergency unwind;
- freeze new actions and demand reconciliation.

Every action must answer:

1. Why now?
2. What exact exposure should change?
3. What evidence or invariant triggered it?
4. What is the economic cost of waiting?
5. What is the expected cost/risk of acting?
6. Which external approvals are still required?
7. What would invalidate or cancel the intent?

Mechanical order sequence, retries, cancels, and failed-leg recovery remain owned by the Backend Foundation execution coordinator. This lane provides the economic target and urgency, not exchange mechanics.

### Lane H — PnL and cost attribution

Build exact, composable economics for opportunities, mandates, stages, legs, active positions, and closed outcomes.

Required outputs:

- gross price PnL;
- basis convergence/divergence PnL;
- directional residual;
- realized/unrealized split;
- fees;
- spread and slippage;
- funding;
- borrow interest/fees;
- execution shortfall;
- one-leg exposure result;
- recovery/operational cost;
- FX/valuation result;
- unexplained residual;
- net known result;
- net estimated result range where defensible;
- completeness and confidence of accounting;
- attribution by strategy, opportunity, config revision, stage, symbol, leg, and correlation ID.

Required accounting invariant:

```text
reported net = sum(all included components)
```

If the identity cannot be proven, report `DIVERGENT` or `INCOMPLETE`; never force the residual to zero.

### Lane I — Checkpoint and restart projection

Define serializable, versioned checkpoints and pure restore/project functions for:

- reservations;
- mandates and remaining stage budgets;
- approvals and revocations;
- active positions and original thesis;
- last reconciliation reference;
- outstanding action intents;
- cumulative economic components;
- lifecycle revision.

Required behavior:

- deterministic replay;
- schema versioning;
- duplicate-event idempotency;
- monotonic revisions;
- no resurrection of expired approval/reservation;
- restart defaults to no new/increasing exposure until account and reconciliation truth are fresh;
- already exposed capital remains visible and supervised;
- conflicting checkpoint and reconciliation truth yields `UNKNOWN`/`RECOVERY_REQUIRED`.

This lane defines ports/events only. It performs no disk or database I/O.

### Lane J — Active-capital topology and operator read model

Build a render-ready data model—not UI—for the later 40–70-box Control Room graph.

Represent nodes and edges for:

- strategy proposal;
- evidence/thesis references;
- capital budget;
- reservation;
- mandate and stages;
- operator approval;
- future risk decision;
- future execution correlation;
- position and legs;
- reconciliation state;
- supervisor decision;
- action intent;
- economics/PnL completeness;
- checkpoint state.

Each node must expose:

- stable ID and kind;
- authority owner;
- status;
- freshness/completeness;
- blocking and degraded reasons;
- upstream/downstream IDs;
- last transition time;
- supported future controls;
- whether capital is exposed;
- whether operator attention is required.

Required graph behavior:

- identify the critical path for every active position;
- propagate root-cause blocking/degradation without calling the entire machine dead;
- distinguish strategy rejection, capital block, approval block, risk block, execution uncertainty, reconciliation divergence, and economic invalidation;
- prioritize exposed capital over unopened opportunities;
- never claim a component is healthy merely because an object exists.

This is not a second control plane or supervisor. It is a read projection over supplied domain state.

---

## 10. Wave 2 — compatibility adapters and cross-lane scenarios

After every lane passes independently, build narrow in-scope adapters that consume existing exported Basis/Volume and Market Intelligence contracts without modifying their owners.

Do not import runtime singletons. Do not reach into private module internals. If an existing type is unsuitable, define an explicit translator with completeness and loss reporting.

Create one deterministic scenario harness covering at least these cases:

1. Two valid opportunities compete for insufficient capital.
2. Tie-breaking is stable across replay and input order changes.
3. Same-symbol opposing opportunities are detected as conflict rather than both funded blindly.
4. Incomplete account snapshot blocks allocation.
5. Same capital cannot be double-reserved.
6. Reservation expiry/release is exact and idempotent.
7. Normal Basis and reverse Basis structures retain correct legs and borrow requirements.
8. Volume proposal remains advisory when calibration policy forbids capital authority.
9. Proposal expires between eligibility and approval.
10. Approval expires or is revoked before risk evaluation.
11. Changed proposal/config/stage invalidates the old approval.
12. Illegal stage jump and unauthorized add are rejected.
13. Kill/pause blocks opening or adding while active supervision continues.
14. Kill/pause still permits reduce/exit/recovery intent.
15. Partial fill/one-leg exposure produces urgent hedge or recovery intent.
16. Reconciliation divergence produces `UNKNOWN`/`RECOVERY_REQUIRED`, never false flatness.
17. Basis converges as expected and produces staged reduction/exit.
18. Basis widens beyond invalidation.
19. Funding direction or projected cost flips the remaining economics.
20. Borrow cost jumps or availability disappears.
21. Spread/depth collapses and exit capacity degrades.
22. Volume continuation remains valid.
23. Volume evidence exhausts or reverses.
24. Stale evidence blocks add but does not hide the position.
25. Restart before and after a fill preserves idempotency and blocks unsafe new actions.
26. Closed capital releases exactly once.
27. Fees, funding, borrow, spread, slippage, directional, and basis components sum exactly.
28. Missing valuation or cost keeps PnL incomplete.
29. Active-capital graph identifies the real blocking/root-cause node.
30. Multiple active positions are prioritized by exposed-capital urgency, not decorative score.

The full harness must terminate at:

```text
capital decision + position action intent + economic attribution + topology projection
```

It must never terminate at a live or test order.

---

## 11. Test requirements

Tests must be behavioral, deterministic, and hostile to false green states.

Required categories:

- contract and canonical-serialization tests;
- exact-decimal and accounting-identity tests;
- property/invariant tests where repository tooling allows;
- lifecycle transition tests;
- stale/partial/unknown/divergent truth tests;
- duplicate/reordered event tests;
- approval/config revision tests;
- reservation concurrency/idempotency tests;
- strategy-specific supervision tests;
- kill/pause asymmetry tests for new risk versus risk reduction;
- checkpoint/restart tests;
- topology/root-cause tests;
- the 30-case cross-lane harness.

Every failure must print the violated invariant and scenario identity. A count without readable failure context is insufficient.

Before final acceptance, run in this order:

1. clean production build;
2. all Capital Supervision tests;
3. the complete Market Intelligence suite (`152/152` baseline or higher);
4. its 12-scenario harness;
5. all existing repository suites (`377/377` baseline or higher);
6. static forbidden-import and scope scans;
7. a clean second full run to expose order dependence.

Counts may legitimately rise. They may not fall without a precisely documented upstream change and owner approval.

---

## 12. Required static scans

Prove that production code under `server/src/capitalFoundation/**` has no forbidden authority or nondeterminism.

Scan for at least:

- `fetch`;
- WebSocket/socket clients;
- filesystem imports;
- database imports;
- `process.env` and process-control calls;
- timers;
- `Date.now()`/`new Date()` outside explicitly injected parsing/value helpers;
- `Math.random()`;
- Binance signed/private clients;
- order/borrow/repay/transfer/withdraw calls;
- imports from route/UI/startup modules;
- floating-point conversion of financial values;
- `any` at public boundaries;
- secret-like literals.

Fixtures may use deterministic test helpers, but production must remain pure.

---

## 13. Commit sequence

Commit in this order unless a test-driven correction requires a narrowly explained variation:

1. `capital: freeze opportunity-to-position contracts`
2. `capital: build account truth allocation and staged mandates`
3. `capital: add approvals and active position supervision`
4. `capital: add action economics checkpoints and topology`
5. `test: prove capital supervision compatibility scenarios`
6. `docs: record capital supervision manifest and receipt`

After each commit:

- run the lane's tests;
- verify exclusive scope;
- record the SHA and exact check count in the receipt draft.

Do not squash away meaningful checkpoints before Claude has reviewed integration risk.

---

## 14. Component manifest

`CAPITAL_SUPERVISION_COMPONENTS.md` must contain:

1. exact base and branch;
2. source ownership/reuse table;
3. every component and file;
4. responsibility and non-responsibility;
5. public exports;
6. input/output ports;
7. invariants;
8. tests and counts;
9. current runtime status, explicitly `DORMANT / NOT WIRED`;
10. future owner/adaptor for every port;
11. overlap analysis against Market Intelligence, existing engines, Backend Foundation, ledger, and future exchange adapters;
12. exact integration order;
13. deliberately deferred work.

Required future integration map:

```text
Market evidence / engine proposal
  -> Capital Supervision eligibility and allocation
  -> staged capital mandate + operator approval
  -> Backend Foundation multi-leg risk
  -> Backend Foundation execution coordinator
  -> future signed exchange adapters
  -> Backend Foundation reconciliation
  -> Capital Supervision active-position policy and economics
  -> existing ledger / canonical read model / cockpit
```

Do not label a dormant module live, connected, healthy, or production-ready.

---

## 15. Final receipt

`CAPITAL_SUPERVISION_RECEIPT.md` must contain measured facts, not claims:

- repository absolute path;
- branch;
- accepted base SHA;
- every checkpoint SHA;
- final SHA;
- exact changed-file list and line totals;
- proof that all changed paths are in scope;
- clean build command and result;
- every test command and exact pass count;
- first and second full-run results;
- static scan commands and results;
- compatibility/harness scenario list and results;
- known warnings;
- known limitations;
- `DORMANT / NOT WIRED` statement;
- exact remaining integration work;
- `git status --short` output;
- push status.

The receipt must clearly state that no network call, order, test order, borrow, repay, transfer, withdrawal, route, UI, database write, startup hook, or live automation was added.

---

## 16. Acceptance gate

The sprint is complete only when all statements below are true:

- The accepted Market Intelligence tip is the recorded branch base.
- All production changes live under `server/src/capitalFoundation/**`.
- All test changes live under `server/test/capitalFoundation/**`.
- Only the two allowed root artifacts exist.
- Existing engine and Market Intelligence owners remain unchanged.
- Capital scarcity cannot double-allocate funds.
- Missing/stale account truth blocks new allocation.
- Strategy proposals retain their source authority and IDs.
- Staged exposure cannot jump or add without fresh authority.
- Approval is scoped, versioned, expiring, and revocable.
- Active exposure receives higher supervision priority than unopened opportunities.
- Kill/pause blocks new or increasing exposure but never hides or disables reduction/exit/recovery intent.
- Basis and Volume active-thesis policies are distinct and tested.
- One-leg and reconciliation uncertainty fail closed.
- PnL/cost attribution is exact or explicitly incomplete/divergent.
- Checkpoint replay is deterministic and idempotent.
- The topology projection identifies precise blockers and root causes.
- No component can execute or call the exchange.
- Clean build passes.
- Capital Supervision suite passes twice.
- Market Intelligence remains at least `152/152` plus `12/12`.
- Existing repository suites remain at least `377/377`.
- Manifest and receipt match measured source reality.
- Coherent commits exist and the working tree is clean except the four preserved input documents.

If any item fails, report `PARTIAL` and state the exact failing gate. Do not relabel partial work as complete.

---

## 17. What remains after this sprint

Do not expand into these areas during this run. They are the next integration/build families:

1. **Live market-data and durable state fabric** — enrich and unify full-universe Spot/USD-M data, sequence/gap/reconnect truth, focused depth/OI/funding/liquidation evidence, warm starts, and bounded event-window persistence without creating a second canonical cache.
2. **Runtime composition** — wire live data -> Market Intelligence -> existing engines -> Capital Supervision -> Backend Foundation with one authority per concept.
3. **Complete private account/borrow truth** — Spot, USD-M, Margin liabilities, permissions, fees, funding, borrow capacity/cost, and freshness.
4. **Concrete guarded exchange hand** — signed Spot/Futures/Margin adapters, test-order validation, borrow/repay, order/cancel, user-data events, and two-leg recovery; manually armed first.
5. **Durable execution journal and reconciliation wiring** — connect events/checkpoints to the existing ledger/database.
6. **Control API and visual machine graph** — real bounded controls plus the 40–70-box Control Room projection, not fake toggles.
7. **Offline replay/calibration lab** — real captured sequences, fill assumptions, false positives, missed trades, out-of-sample/no-look-ahead promotion gates.
8. **Watchdog and deployment** — external liveness, EC2/systemd, rollback, backup, data retention, and Cloudflare-protected operator access.
9. **Final integration/security/capital promotion gates** — verify the full machine before any tiny manually approved capital test.

These remain substantial. A large codebase and green pure-unit tests do not mean the bot is ready for money.

---

## 18. Lead-agent execution protocol

The lead Codex agent must:

1. inspect and freeze contracts itself;
2. assign only collision-free directories to internal agents;
3. keep at most one writer per directory;
4. review every returned diff instead of trusting summaries;
5. compile centrally after each lane closes;
6. run deterministic suites serially for final acceptance;
7. reject code-volume theater, duplicate owners, and fake health;
8. commit each verified checkpoint;
9. stop on unexplained repository changes;
10. finish with the exact receipt, not a narrative victory claim.

Speed comes from parallel isolated construction and precise contracts, not skipped verification.

---

## 19. Exact message to give Codex

```text
Execute CAPITAL_SUPERVISION_MAX_POWER_SPRINT.md completely. Work in the real Main repository, verify the accepted Market Intelligence tip at commit 3340f75 (or its explicitly verified documentation-only successor), and create/resume branch capital-supervision-main-20260711 from that tip. Start implementation immediately after the mandatory repository/scope/reuse checks; do not return a planning-only response. Write only under server/src/capitalFoundation/**, server/test/capitalFoundation/**, CAPITAL_SUPERVISION_COMPONENTS.md, and CAPITAL_SUPERVISION_RECEIPT.md. Preserve the four known untracked input documents untouched. Existing engines own strategy proposals, Market Intelligence owns evidence, and the separate Backend Foundation owns risk/execution/reconciliation. Build capital allocation, reservations, staged mandates, scoped approvals, active-position supervision, economic action intents, exact PnL attribution, deterministic checkpoints, and the active-capital topology projection. No network, live/test orders, borrow/repay, routes, UI, DB writes, startup wiring, secrets, or edits outside scope. Use isolated internal agents for collision-free lanes, commit verified checkpoints, run every required existing and new suite twice where directed, and finish only with the measured manifest and receipt. Do not merge into current-main and do not claim the dormant organ is live.
```

---

## 20. Handoff to Claude Code after completion

Claude must verify actual Git state rather than screenshots:

1. read `CAPITAL_SUPERVISION_COMPONENTS.md` and `CAPITAL_SUPERVISION_RECEIPT.md`;
2. verify the branch descends from the accepted Market Intelligence tip;
3. compare the entire delta against the base;
4. rerun the complete test matrix;
5. confirm there are no scope violations or duplicate authorities;
6. push the feature branch as backup if authorized;
7. do not merge it before Market Intelligence;
8. do not merge the pre-audit Backend Foundation wholesale;
9. create a fresh integration branch from audited Main;
10. land Market Intelligence first, then Capital Supervision, then adapt selected Backend Foundation checkpoints one authority at a time;
11. after every integration step, rerun existing, intelligence, capital, and foundation suites;
12. resolve overlapping contracts with one canonical owner or narrow adapters, never two permanent sources of truth.

The target integration order is:

```text
audited Main
  -> Market Intelligence
  -> Capital Supervision
  -> carefully adapted Backend Foundation components
  -> live-data/state fabric
  -> runtime wiring
  -> private account and guarded exchange adapters
  -> ledger/control-room/deployment integration
```

