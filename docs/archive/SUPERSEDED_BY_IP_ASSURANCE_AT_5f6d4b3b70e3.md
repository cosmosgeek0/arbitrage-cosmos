# IP-ASSURANCE SYSTEMIC AMENDMENT

## System safety, recoverability, cockpit truth, and bounded-agent closure

**Status:** candidate amendment to `IP_ASSURANCE.md`; not independently executable

**Sole controlling authority:** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`

**Canonical implementation owner:** `IP_ASSURANCE.md`

**Activation:** none. Builders continue to receive only I00 and the five integration
packets named by I00. The requirements below become binding only after the I00 director:

1. resolves actual Git, accepted receipts, active writers, and durable state;
2. deduplicates every requirement against I00, accepted Q/L, and all five integration
   packets;
3. assigns each accepted delta to an existing owner, path, phase, and closure artifact;
4. folds accepted deltas only into a director-accepted revision of `IP_ASSURANCE.md`;
   any genuine I00-law gap becomes a director-only insertion request adjudicated separately
   under I00's amendment authority, and no worker or requirement in this source may directly
   modify or extend I00;
5. records the amended `IP_ASSURANCE.md` SHA and input digest; and
6. archives this source as `SUPERSEDED_BY_IP_ASSURANCE_AT_<SHA>`.

No worker executes this file directly. It creates no sixth I00 packet, third Q/L lane,
runtime owner, registry, state machine, supervisor, Risk or Capital authority, executor,
cockpit, telemetry platform, proof harness, deployment authority, or status vocabulary.

An IP-ASSURANCE worker still stops at `ASSURANCE_PRESTAGE_READY`. Only the I00 director may
claim `INTEGRATED_ACCEPTED` after composed runtime, browser, deployment, and external-boundary
proof.

---

## 0. Honest outcome and non-goals

This amendment addresses one structural failure class that component-by-component work can
miss: every organ can pass its own tests while their interaction still creates an unsafe or
unobservable machine.

It does not and cannot guarantee:

- profit;
- proprietary alpha from public research;
- prediction of every new market regime;
- absence of unknown failure;
- recovery from every possible physical, exchange, account, network, or software state;
- that an LLM can safely operate money paths;
- that more code creates more edge;
- that a green cockpit proves future safety.

It must make the following claims testable:

1. A required component cannot disappear from the denominator and leave a false green.
2. Missing, stale, contradictory, incoherent, or unbounded evidence cannot support a green
   capital-critical claim.
3. For each fenced resource/domain, at most one epoch may authorize or commit a new capital
   transition. A stale actor or callback cannot authorize or commit a new transition. Facts
   durably received by canonical reconciliation are not rejected solely because the reporting
   process is stale; absent proven receipt and persistence, posture remains `UNKNOWN`.
4. Unknown exchange outcomes enter reconciliation and remain durably unresolved until
   authoritative truth resolves them; they are never blindly repeated.
5. A risk-increasing action reaches canonical owners only with current, bounded supporting
   evidence; that evidence never grants authority by itself.
6. Automatic recovery is limited to registered local non-capital operations that are
   bounded, idempotent/replay-safe where applicable, reconstructible or
   compensatable/rollback-capable, and independently verified. Irreversibility and residual
   effects must be declared; no automatic capital or external-environment mutation is added.
7. Ambiguous, capital-affecting, or unbounded faults contain risk increase, preserve truth,
   and enter canonical recovery rather than being “self-healed” by guesswork.
8. The application, host, tunnel, and telemetry plane can fail without silencing the
   independent out-of-band detector.
9. The cockpit shows current posture, missing inventory, causal dependencies, recovery
   state, money lifecycle, and forensic evidence at the correct abstraction level.
10. An LLM may investigate and propose inside a bounded environment; it never becomes a
    truth, safety, capital, execution, deployment, or self-approval authority.

The system is allowed to say `UNKNOWN`, `UNAVAILABLE`, `UNSUPPORTED`, `NOT_CONFIGURED`,
`BLOCKED`, or `ABSTAIN`. Honest unavailability is better than fabricated certainty.

---

## 1. Director deduplication and anti-sprawl gate

Before any implementation worker starts, the director creates this packet-local artifact:

`fixtures/productAssurance/generated/SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md`

Each requirement row contains:

- amendment requirement ID;
- classification: `REUSED`, `EXTENDED`, `MISSING`, `EXTERNAL_CONFIGURATION`, or
  `NOT_APPLICABLE`;
- canonical target artifact;
- canonical runtime owner;
- accepted owner SHA and schema version;
- current implementation and proof paths;
- collision or duplicate-authority risk;
- amendment disposition;
- exact insertion-request ID where a shared seam is required;
- IP-PROOF scenario or I00 phase that will prove the mounted behavior;
- supersession disposition.

The matrix is a packet-local receipt, not a runtime registry or root source of truth.

Forbidden outcomes:

- clone an existing supervisor, health graph, incident store, Risk gate, Capital service,
  executor, ledger, proposal queue, remediation registry, telemetry store, Q registry,
  cockpit, proof harness, or LLM runtime;
- invent a second clock, canonical ID, authority map, desired-state owner, persistence owner,
  or status vocabulary;
- reopen accepted Q or L to add optional research;
- let a worker edit Main, startup, routes, shared persistence, migrations, shared types,
  packages, App/router/store/pages, deployment, or final receipts;
- treat a file name, line count, test count, model count, or large diff as proof of wiring;
- treat `PASS` from a pure evidence evaluator as permission to trade, repair, deploy, or
  promote anything;
- add a generic exception or waiver path around a non-bypassable I00 law.

If a requirement does not fit IP-ASSURANCE's accepted territory, it becomes an insertion
request to the existing canonical owner. The director does not silently widen a worker's
paths.

---

## 2. S1 — System hazard and assumption projection

### 2.1 Purpose and authority

Extend the existing `SAFETY_INVARIANT_CATALOG.md` and IP-ASSURANCE evidence model with a
generated system-interaction view. This creates no second invariant authority, desired
state, Risk rule, Capital rule, health owner, persistence owner, or runtime registry.

Use STPA-style control analysis to find unsafe interactions even when each component is
locally correct. Examples include:

- Spot and Futures data are independently fresh but mutually time-skewed;
- a deployment rolls back while an old process remains alive;
- a cancel is locally acknowledged while a later fill arrives from the exchange;
- a recovery action is safe alone but unsafe while reconciliation is incomplete;
- a model is valid for one cohort but consumed for another;
- every reporting component is green while an expected silent component was omitted;
- an agent proposes a correct patch against stale evidence or the wrong release;
- a backup path exists in configuration but is unavailable for the exact account/product;
- two individually safe controllers oscillate when composed;
- a host or tunnel dies and the in-app dashboard cannot report its own death.

### 2.2 Hazard record

Each active hazard projection includes:

- stable hazard and unacceptable-loss IDs;
- control structure and canonical owners;
- unsafe control action;
- triggering context;
- causal scenario;
- affected capital, truth, security, availability, evidence, or cost boundary;
- safety constraint expressed in existing I00 vocabulary;
- finite referenced assumptions;
- detector and declared detection SLO;
- canonical containment or recovery owner;
- deterministic fixture or exact proof gap;
- cockpit projection and drill-down;
- residual risk and owner disposition.

Minimum unacceptable-loss families:

- unintended, duplicated, or unbounded exposure;
- inability to reduce or close exposure;
- hidden order, fill, position, borrow, interest, funding, or other liability;
- divergence between local financial truth and authoritative exchange/account truth;
- loss of durable intent, evidence, or reconciliation history;
- false green, missing instrumentation, or stale evidence represented as current;
- corrupt promotion, cohort misuse, leakage, or silent strategy drift;
- secret/private-account disclosure or authorization escalation;
- stale process, deployment overlap, or duplicate capital mutator;
- uncontrolled repair, API, token, storage, process, or cloud-cost burn.

### 2.3 Finite assumption registry projection

Register every assumption referenced by an active capital-critical hazard, invariant,
assurance claim, recovery path, deployment claim, model-use claim, or external-operation
policy. This is not a claim to enumerate every possible assumption in the universe.

An unregistered dependency used by a capital-critical claim is itself a coverage failure.

Each assumption record contains:

- stable ID and statement;
- scope and canonical owner;
- supporting source and evidence IDs;
- first-valid, last-verified, maximum-age, and expiry times;
- validation method and version;
- dependent hazards, claims, controls, models, actions, and cockpit projections;
- invalidation conditions;
- evaluator result: `PASS`, `FAIL`, or `UNKNOWN`;
- bounded reason code such as expired, contradicted, weak, missing, or incoherent;
- consequence emitted to canonical owners;
- required owner response and residual risk.

Examples:

- Binance filters are current for the exact product and symbol;
- API credentials have only the expected permissions and no withdrawal capability;
- Spot, Futures, and account observations satisfy the declared coherence budget;
- borrow evidence refers to the exact asset, account mode, and time window;
- a model is approved only for named symbols, horizons, liquidity, and regimes;
- a fallback exit path is currently available and sufficiently independent;
- displayed, tested, and deployed SHAs match;
- the external sentinel is independent of the application process;
- the agent sandbox cannot reach secrets or money mutation tools.

`FAIL` or `UNKNOWN` on a critical assumption invalidates dependent assurance claims. The
existing I00 lifecycle, capability posture, Risk, Capital, execution, Control, and release
owners determine the machine response.

### 2.4 Expected Failure Atlas coverage

During dedup, verify the existing `OPERATIONAL_FAILURE_ATLAS.md` has an owner-reviewed
expected failure-family denominator for every live operation class. It covers at least:

- source/data identity, sequence, skew, and availability failure;
- exchange ambiguity, partial fill, cancel/fill race, and late external truth;
- borrow, interest, funding, liability, and account-mode failure;
- persistence, restart, replay, duplicate executor, fencing, and deployment overlap;
- telemetry loss, missing inventory, stale evidence, and false green;
- retry/control oscillation, resource exhaustion, and budget/cost runaway;
- model drift, cohort misuse, leakage, correlated confirmations, and calibration failure;
- agent/tool/secret/trace boundary violation; and
- external host, tunnel, DNS, sentinel, paging, restore, and rollback failure.

Each row distinguishes `OBSERVED`, `SYNTHETIC`, `PUBLIC_REFERENCE`, and `UNTESTED`, and
records provenance, reproduction fixture or exact gap, detector, containment owner,
canonical recovery path, independent postcondition, cockpit projection, and residual risk.
The denominator is finite and versioned for the accepted release; it is never described as
an exhaustive catalog of every future failure. Reuse the existing Atlas owner. Missing rows
are a narrow extension/insertion request, not a new failure subsystem.

### 2.5 Packet-local outputs

- `fixtures/productAssurance/systemic/hazard/**`
- `test/productAssurance/systemic/hazard/**`
- generated rows for `SAFETY_INVARIANT_CATALOG.md`
- generated rows for `AUTONOMY_CLOSURE_REPORT.md`
- insertion requests for shared runtime or cockpit seams

---

## 3. S2 — Forward-looking action-safety evidence envelope

### 3.1 Pure evidence, never authority

I00 already owns Capital, Risk, execution policy, repair policy, deployment authority,
fencing, reconciliation, and asymmetric safety. This section defines a pure, read-only,
expiring evidence envelope consumed by those canonical owners.

It is not:

- an authorization;
- a permit;
- a command gate;
- a Risk or Capital decision;
- an execution, repair, model-promotion, or deployment policy;
- a replacement for re-evaluation at send and commit time.

The evaluator returns exactly:

- `PASS` — the declared evidence contract is complete and current;
- `FAIL` — one or more declared requirements are contradicted;
- `UNKNOWN` — evidence is missing, stale, expired, incoherent, or unbounded.

The evaluator only returns `PASS`, `FAIL`, or `UNKNOWN`; it never forwards, blocks,
authorizes, restores, or widens authority. `PASS` is necessary supporting evidence only where
an existing canonical policy already requires it for a risk-increasing action, promotion,
live enablement, or deployment. Existing owners consume the result and make their own
decision at send/commit time. This envelope never creates a new prerequisite for
independently safe reconciliation or risk-reducing recovery.

### 3.2 Covered evidence families

Use a discriminated union so irrelevant trade fields are never mandatory for model or
deployment evidence:

- `TRADE_OR_ACCOUNT_MUTATION_EVIDENCE`;
- `MODEL_OR_POLICY_PROMOTION_EVIDENCE`;
- `LIVE_ENABLEMENT_EVIDENCE`;
- `DEPLOYMENT_OR_ROLLBACK_EVIDENCE`;
- `REGISTERED_LOCAL_REPAIR_EVIDENCE`.

Trade/account evidence covers only operation classes already authorized by I00. It grants no
withdrawal, transfer, collateral, cross-account, or other mutation authority not already
present in the canonical operation registry.

### 3.3 Common envelope fields

- immutable action/intent ID and action class;
- release, policy, model, schema, and authority versions;
- evidence creation, maximum-age, expiry, and evaluation times;
- input event, receipt, availability, and processing times;
- cross-source temporal-coherence assessment. For every multi-source decision this records
  the reference decision time; exact venue/product/symbol/account identity; each source's
  event, receipt, availability, and processing time; sequence/snapshot identity;
  sequence-gap state; clock-quality state; maximum age; maximum pairwise skew; join/watermark
  policy; and the disposition of late, reordered, duplicate, future-dated, or discontinuous
  events. Independent freshness is not coherence. Missing identity, a sequence discontinuity,
  unbounded clock error, or skew beyond the declared strategy budget deterministically yields
  `UNKNOWN`;
- fencing epoch and current-owner evidence where relevant;
- canonical Capital/Risk/command/owner/§20 decisions referenced by ID, never recreated;
- finite active assumptions and invariant results;
- declared scenario/stress envelope;
- excluded or unbounded states explicitly labeled;
- fallback/readiness evidence within that declared envelope;
- bounded reason vocabulary and deterministic result.

### 3.4 Trade/account branch

When relevant, bind:

- exact account, venue, product, symbol, side, and quantity;
- position, open orders, balances, borrow, interest, funding, and liabilities;
- worst-case fill and partial-fill states inside the declared stress envelope;
- maximum exposure and unresolved liability inside that envelope;
- fees, spread, slippage, impact, funding, borrow cost, and recovery-cost assumptions;
- rate-limit, source-loss, filter, balance, and liquidity headroom;
- preferred fallback sequences already registered and approved by the canonical
  execution/recovery owner and supported by current scenario-bounded evidence;
- time to last declared safe intervention;
- cancellation and late-result law.

If the scenario is outside the declared envelope, return `UNKNOWN` with reason
`UNKNOWN_UNBOUNDED`; never manufacture a safe-state guarantee.

### 3.5 Scenario-bounded recoverability assessment

Expose a recoverability assessment, not a universal “margin of safety”:

- declared disturbance and stress envelope;
- referenced assumptions and evidence ages;
- model and coverage versions;
- known liability and bounded possible additional liability;
- available, degraded, unsupported, or unknown recovery paths;
- time and rate-limit headroom;
- whether an already-authorized deterministic recovery class is currently eligible;
- exact condition that makes canonical owners deny risk increase;
- residual unknowns and owner action.

Forward recoverability is claimed only within declared conservative disturbance, evidence,
clock, and implementation bounds.

The evidence evaluator cannot approve or certify a fallback.

### 3.6 Mandatory counterexamples

Create deterministic fixtures for:

- individually fresh Spot/Futures/account data that fail mutual time coherence;
- filter, fee, funding, or borrow truth changes after proposal creation;
- partial fill with the preferred recovery path rate-limited;
- no owner-registered fallback with current scenario-bounded evidence inside the declared
  scenario envelope;
- stale approval replayed against another SHA, symbol, amount, account, or policy;
- lease loss after signing but before acknowledgment;
- late fill after local timeout/cancel;
- backup-path evidence expiry;
- unbounded liability or recovery cost;
- Capital/Risk/owner decision absent even though evidence evaluation returns `PASS`.

### 3.7 Packet-local outputs

- `fixtures/productAssurance/systemic/actionEvidence/**`
- `test/productAssurance/systemic/actionEvidence/**`
- `fixtures/productAssurance/generated/ACTION_SAFETY_EVIDENCE_REPORT.md`
- rows for existing invariant, autonomy, and IP-PROOF insertion artifacts

---

## 4. S3 — Small critical-protocol models

### 4.1 Scope

Do not formally specify the whole application. Use TLA+/PlusCal or another explicit-state
method only for money/recovery/concurrency protocols where interleavings, crash/restart,
ambiguity, and stale callbacks are otherwise hard to exhaust.

Model sources live only under:

`fixtures/productAssurance/systemic/formal/**`

No worker changes a root package or lockfile to install a model checker. Use an existing
toolchain or return an exact tooling insertion request.

### 4.2 Required bounded models

1. Durable intent -> send -> timeout -> ambiguous response -> authoritative reconciliation
   -> resend prohibition.
2. Two-leg execution -> partial fill -> cancel/fill race -> fallback/recovery -> terminal or
   durable unresolved accounting.
3. Execution lease -> monotonic fencing epoch -> deployment overlap -> stale callback -> old
   process resurrection.
4. Repair campaign -> retry budget -> crash/restart -> rollback/compensation -> quarantine or
   durable unresolved state.
5. Borrow/short/repay -> interest accrual -> ambiguous mutation -> liability reconciliation.
6. Halt -> risk-reduction-only operation -> prevention of new exposure while preserving
   canonical risk reduction.
7. Cancellable child work versus non-cancellable external mutation and detached fenced
   reconciliation.

### 4.3 Properties

Safety properties include:

- for each fenced resource/domain, at most one epoch may authorize or commit a new
  transition;
- stale/non-current actors and callbacks cannot authorize or commit a new transition;
- facts durably received by canonical reconciliation are not rejected solely because their
  reporting process context is stale; absent proven receipt/persistence, posture is `UNKNOWN`;
- no mutation without durable intent;
- no blind resend after ambiguity;
- no local success without authoritative postcondition;
- every known liability and every liability state represented within the declared scenario
  envelope is authoritatively reconciled or remains durably explicit and unresolved; an
  unmodeled liability possibility makes the dependent claim `UNKNOWN`;
- no risk increase when canonical posture denies it;
- no incident cleared before independent postcondition;
- no approval reused outside its bound identity/scope/version.

Liveness is asserted only under declared observability, fairness, store, lease, exchange,
and clock assumptions. Within those bounds:

- an acknowledged mutation becomes reconciled or durably unresolved/quarantined;
- a lost owner loses current authority;
- restart reconstructs equivalent durable state or blocks;
- a bounded repair campaign terminates in success, rollback, quarantine, escalation, or
  durable unresolved state;
- cancellation prevents a locally controlled child from initiating new side effects only
  after that child observes cancellation and before effect commitment;
- non-cancellable external operations and fenced recovery contexts reconcile or become
  explicitly unresolved.

### 4.4 Counterexample conversion

Every counterexample is triaged as:

- implementation-relevant and validated;
- specification/model defect;
- assumption violation;
- spurious/unreachable under implementation constraints;
- unresolved.

Only a validated implementation-relevant trace becomes a runtime fixture and Failure Atlas
entry. Model-only or spurious results update the model and limitation record rather than
polluting the production failure corpus.

### 4.5 Model-to-implementation conformance

A bounded model is supporting evidence only when the report records:

- model version and content hash;
- implementation release, schema, and command/storage-transition versions;
- an explicit mapping from model states/actions/invariants to implementation states,
  commands, durable records, and postconditions;
- replay of model counterexample and representative success traces through the ordinary
  implementation harness; and
- mismatches, unreachable abstractions, omitted environment behavior, and residual
  assumptions.

Without that mapping and replay evidence, a formal result is `REFERENCE_ONLY` or `UNKNOWN`
for implementation assurance. It may guide design, but cannot close a runtime claim.

Accepted counterexamples flow to existing:

- `FAULT_INJECTION_AND_SOAK_REPORT.md`;
- `OPERATIONAL_FAILURE_ATLAS.md`;
- `SAFETY_INVARIANT_CATALOG.md`;
- IP-PROOF insertion requests.

Packet-local sources and generated evidence remain under:

- `fixtures/productAssurance/systemic/formal/**`
- `test/productAssurance/systemic/formal/**`
- `fixtures/productAssurance/generated/CRITICAL_PROTOCOL_MODEL_CHECK_REPORT.md`

---

## 5. S4 — Derived dynamic-assurance projection

### 5.1 Authority boundary

Extend the accepted IP-ASSURANCE pure invariant evaluator with a derived, read-only claim
graph. I08's canonical supervisor remains the only runtime health projection. The graph has
no desired state, command authority, persistence owner, repair authority, Risk/Capital
authority, deployment authority, or independent green decision.

### 5.2 Claim node

Each derived claim contains:

- stable claim ID, scope, and canonical owner;
- required subclaims and finite assumption IDs;
- supporting and counterevidence IDs;
- validator/version;
- evidence creation, age, expiry, and source identity;
- evaluator result `PASS`, `FAIL`, or `UNKNOWN`;
- bounded reason code;
- canonical invariant/event/incident projection;
- cockpit projection and per-component drill-down;
- existing owner that consumes the result.

Evidence can include accepted tests, runtime probes, exchange/account readback,
configuration/permission verification, deployment SHA, model evaluation, fault injection,
browser checks, independent-sentinel receipts, formal-model results, and owner
authorization records.

For each capital-critical claim, record evidence producer, verifier, and declared
failure-domain/independence class. A producer cannot be its only verifier. A claim graph may
not certify itself through a strongly connected evidence cycle. Shared clocks, stores,
networks, credentials, code paths, telemetry exporters, or model families are explicit
common-mode dependencies; loss of required independence makes the affected claim `UNKNOWN`.

### 5.3 Mandatory derived claims

- required inventory has an explicit disposition;
- each enabled required component is discovered and instrumented;
- no missing/unsupported required component is hidden by the denominator;
- telemetry completeness is sufficient for the exact claimed posture;
- Spot/Futures/account inputs are temporally coherent for the exact action;
- authoritative account/exchange truth is reconciled;
- only a current fenced epoch may enter canonical mutation state;
- live controls map to canonical commands;
- required rollback/recovery paths have current scenario-bounded evidence;
- model evidence matches approved cohort and version;
- displayed, tested, and deployed SHAs agree;
- independent sentinel/paging evidence is current;
- diagnostic-plane posture is explicit. `NOT_CONFIGURED` is valid and cannot degrade
  deterministic product readiness. If posture is `SHADOW`, `OWNER_GATED`, or `ACTIVE`,
  containment, permission, provider-outage, privacy, and independent evidence must be
  current.

### 5.4 Expiry and transitive invalidation

When critical evidence expires or an assumption changes:

1. cached support becomes ineligible at the defined invalidation boundary and the affected
   derived claim is projected as `UNKNOWN` within its declared propagation SLO; until then,
   the prior `PASS` is not usable as current support for a new action;
2. recomputation completes within the declared assurance SLO;
3. cached green cannot persist as current;
4. the projection returns an invariant result plus material-event and incident
   recommendations to their existing canonical owners;
5. existing Control/Risk/Capital/execution/Q/release owners decide posture;
6. this projection does not block independently safe canonical reconciliation or risk
   reduction; actual availability remains canonical-owner truth, and unavailable or unknown
   recovery capability remains visibly `UNKNOWN`/`UNAVAILABLE` and may block dependent
   readiness;
7. cockpit aggregation shows the invalidator, dependent path, age, and owner;
8. an LLM may explain but cannot restore support.

This is a derived assurance projection. It never issues a halt, close, repair, demotion,
deployment, or capital command.

### 5.5 Packet-local outputs

- `fixtures/productAssurance/systemic/assuranceCase/**`
- `test/productAssurance/systemic/assuranceCase/**`
- generated rows for `SAFETY_INVARIANT_CATALOG.md`
- generated rows for `TELEMETRY_COVERAGE_MATRIX.md`
- generated rows for `AUTONOMY_CLOSURE_REPORT.md`

---

## 6. S5 — Observability conservation and cockpit truth

### 6.1 Ownership and abstraction

This amendment creates schemas, pure adapters, fixtures, and render-neutral view models
only. IP-RUNTIME/I08 own the supervisor snapshot. Accepted telemetry owners collect/export
data. IP-CONTROL renders into the existing website. IP-PROOF owns browser and composed
acceptance. Standard trace context extends canonical correlation identity but never replaces
intent, transaction, order, fill, position, incident, remediation, or ledger IDs.

The browser must not receive one hundred thousand equal-priority raw wires. The existing
IP-RUNTIME/I08 supervisor performs the condensation; this amendment prepares only the
render-neutral schemas, fixtures, and adapters for:

- a versioned supervisor snapshot;
- expected-versus-discovered-versus-instrumented inventory;
- material events and grouped incidents;
- bounded correlation traces;
- historical operational metrics;
- evidence-age and coherence summaries;
- raw bounded evidence only on drill-down.

### 6.2 Inventory completeness and no-false-green law

For every required component, dependency, source, command path, capital path, recovery path,
sentinel, and cockpit projection, the expected manifest records orthogonal facts mapped into
existing I00 vocabulary rather than forcing unlike dimensions into one invented status:

- support/configuration posture;
- discovery/identity posture;
- instrumentation/telemetry posture;
- freshness and temporal-coherence posture;
- lifecycle/authority posture;
- live/synthetic/shadow data mode; and
- independent-probe posture where required.

The expected manifest is independent of runtime self-reporting. It is owner-reviewed and
hash-bound to the accepted release, Mission Coverage Matrix, accepted authority/component
registrations, and intended deployment topology. Runtime discovery, telemetry arrival, or a
component reporting itself may populate observed axes but cannot add to or remove from the
expected denominator. If the manifest SHA does not match the tested, running, and deployed
release, dependent completeness claims are `UNKNOWN`; they can never render green.

The existing canonical owner derives the displayed aggregate posture from those axes. For
example, discovered-but-uninstrumented and current-but-unreconciled are distinct fixtures;
neither may collapse into green. This amendment introduces no new lifecycle or capability
enum.

Every enabled required component must be discovered and instrumented. A missing,
unsupported, silent, or uninstrumented required component blocks only the dependent posture
defined by existing owners; it cannot disappear from the denominator.

### 6.3 Trace and conservation accounting

Each stage exposes service/component/instance, release SHA, environment, authority owner,
schema version, accepted/refused/queued/processed/exported/dropped/in-flight counts, queue
age/capacity, event/receipt/availability/processing times, and a bounded reason vocabulary.

Conservation is evaluated per `(stable logical event ID, stage ID, accounting window)`.
The record retains state transitions and current disposition, such as:

- completed;
- refused;
- explicitly dropped/coalesced with reason;
- in-flight/late;
- quarantined;
- unresolved and incident-bound;
- duplicated/replayed and reconciled.

This is not a claim of global exactly-once transport. Duplicates are counted and reconciled.

Canonical ledger/audit evidence, money mutations, ambiguous responses, reconciliation,
invariant failures, owner authorization, repairs, and incidents are never sampled away.
If export fails, the system preserves/buffers/replays within its declared budget or creates a
visible evidence gap. Routine public traffic may be sampled only under an explicit budget.

### 6.4 Machine-checkable panel contract

Every panel, gauge, graph, table, badge, and control declares:

- owner question answered;
- canonical source/schema and aggregation path;
- expected component, invariant, SLO, claim, or money-lifecycle stage;
- unit, window, freshness, and temporal-coherence law;
- green/yellow/red/unknown/stale/silent/missing/synthetic rules;
- denominator plus hidden/filtered counts;
- minimum evidence required for green;
- current owner and action authority;
- automatic action or explicit absence of automatic action with an existing bounded reason
  code;
- owner response, runbook, incident, trace, and evidence drill-down;
- last independent proof time.

One named aggregation may represent many components, but per-component drill-down and
denominator completeness remain mandatory. No decorative or orphan gauge is allowed.

### 6.5 Five-level information hierarchy

These are information levels projected into existing I00 §15 surfaces, not five new pages or
a second cockpit.

**Level 1 — immediate safety view**

- overall canonical posture and reason;
- live/synthetic/shadow/unavailable labels;
- exposure and unresolved liability;
- current execution owner/fencing epoch;
- source age and cross-source coherence;
- scenario-bounded recoverability;
- critical unsupported claims;
- incidents/pages and one-click drill-down.

The target is five seconds only for registered failures whose detector, telemetry path, and
browser are connected and whose SLO declares five seconds. App/host/tunnel-dead conditions
are proved through the independent out-of-band path, not the dead browser.

**Level 2 — inventory and dependency graph**

- expected/discovered/instrumented/current/stale/silent/missing;
- startup/runtime dependencies;
- blocked-by/degraded-by edges;
- component owner, version, SHA, and hidden/filtered counts.

**Level 3 — automation and resilience**

- retry/circuit/quarantine and repair-campaign state;
- progress/no-progress, cadence, cooldown, and attempt budget;
- deadlines, leases, cancellation, and late-result handling;
- rollback/fallback readiness;
- SLO/error-budget burn and historical trends;
- external sentinel and paging receipts.

**Level 4 — money and decision lifecycle**

- evidence -> features -> accepted Q/strategy -> proposal -> Risk/Capital -> action evidence
  -> legs -> orders/fills -> position -> funding/borrow -> exit -> reconciliation -> PnL;
- predicted versus realized cost, slippage, impact, funding, and borrow;
- ambiguity, liability, abstention, rejection, model, and policy versions.

**Level 5 — incident and forensic drill-down**

- exact timeline and bounded correlation trace;
- assumptions/claims and causal dependencies;
- raw bounded evidence and immutable references;
- recovery/repair proposals and approvals;
- deployment/agent provenance;
- counterexample or Failure Atlas fixture;
- post-incident corrective actions.

### 6.6 SLO and historical-trend law

Versioned safety/truth SLOs cover source/coherence age, queue/backpressure, processing and
command latency, ambiguity duration, reconciliation lag, evidence expiry, telemetry
completeness, recovery verification, sentinel/paging delivery, restart RTO/RPO, and resource
budgets.

Historical cockpit views include:

- p50/p95/p99 source and processing age;
- cross-source skew;
- queue depth/backpressure and dropped/coalesced events;
- reconciliation-gap and ambiguity duration;
- automatic-recovery result rates;
- execution costs, slippage, funding, borrow interest, and impact;
- incident frequency and recurring failed invariants;
- CPU, memory, disk, WAL, API/rate, telemetry, token, and cost budgets.

Safety/truth SLO evaluators emit canonical invariant/event/incident evidence and recommended
posture. Existing owners enforce blocks. The SLO subsystem never freezes, cancels, closes,
repays, promotes, demotes, releases, repairs, or mutates capital directly.

Availability SLOs may not block independently safe risk reduction. Authorized rollback or
safety hotfix paths remain governed by their canonical owners and §20.

### 6.7 Packet-local outputs

- `fixtures/productAssurance/systemic/cockpit/**`
- `fixtures/productAssurance/systemic/observability/**`
- `test/productAssurance/systemic/cockpit/**`
- `test/productAssurance/systemic/observability/**`
- generated rows for `TELEMETRY_COVERAGE_MATRIX.md`
- generated rows for `RESOURCE_AND_BACKPRESSURE_REPORT.md`
- insertion requests for the existing I17 page matrix and IP-PROOF browser sweep

---

## 7. S6 — Bounded LLM investigator and deterministic self-correction

### 7.1 Dedup and hierarchy

IP_ASSURANCE already owns the diagnostic-plane hierarchy, schemas, provider-outage posture,
budgets, permissions, and attack fixtures. Classify those as `REUSED`. This amendment may
extend only missing systemic evidence, privacy, independent retention, and repair-promotion
proof. It must not create another LLM runtime.

Required hierarchy:

1. deterministic telemetry/invariant layer detects and preserves evidence;
2. canonical Control/Risk/Capital/execution owners contain or act;
3. an optional configured LLM investigator receives sanitized, bounded evidence;
4. the LLM produces hypotheses, tests, explanations, or an isolated patch proposal;
5. an independent deterministic verifier and an existing approving owner review the result
   through the accepted release process; no agent can be the approving owner, and director
   review never means model self-approval;
6. only the existing owner-approved, hash-bound release pipeline can merge/deploy;
7. post-deploy readback, fencing, rollback, and immutable audit prove the outcome.

No agent directly edits live production, regardless of cockpit color or test result.

### 7.2 Allowed agent work

- read sanitized bounded supervisor/evidence snapshots;
- correlate incidents, traces, assumptions, and Failure Atlas entries;
- produce typed hypotheses with evidence for/against and explicit uncertainty;
- recommend deterministic tests;
- create a patch only in an isolated worktree;
- create fixtures and run bounded offline tests;
- produce a content-addressed, provenance-attested evidence package through the existing
  receipt authority.

The agent holds no signing key and creates no new trust authority.

### 7.3 Forbidden agent work

- secrets or raw private-account access;
- exchange signing or money mutation;
- orders, borrow, repay, transfer, withdrawal, collateral, or account movement;
- Risk/Capital limit or policy changes;
- lease/fencing changes;
- incident/evidence deletion or rewriting;
- Main, deployment, service/host, AWS, Cloudflare, Secrets, or external-environment mutation;
- model self-promotion;
- permission escalation;
- approval of its own proposal;
- direct production editing under any condition.

Agent/provider network execution requires the distinct I00 §20 provider authorization.
Without it, only network-free deterministic stubs run and the cockpit shows
`NOT_CONFIGURED` or accepted `SHADOW` posture.

### 7.4 External sandbox and trace privacy

Prompt/function-tool guardrails do not automatically cover every shell, browser/computer,
hosted, or patch surface. Use a deny-by-default external sandbox binding role, immutable
policy version, provider/model, sanitized input manifest, allowed tools/paths/network,
time/token/cost/process/file/tool-call budgets, expiry, output schema, and independent
verifier.

Audit evidence is sanitized before provider submission, free of secrets/raw account
payloads, content-addressed, tamper-evident, append-only outside agent credentials,
independently retained, and linked to prompts, tools, diffs, tests, approvals, costs, and
disposition. Fault tests must prove the proposing agent cannot delete or rewrite it.

Sensitive tracing is disabled or redacted. Raw financial evidence remains local unless
separately authorized.

### 7.5 Self-correction classes

**Class A — automatically eligible only when already registered**

Only an already-registered deterministic, local, non-capital Control Plane command class may
be automatically executed. Examples may include reconnect, resubscribe, bounded resnapshot,
bounded cache rebuild, bounded child-worker restart, or diagnostic collection.

Each class requires deterministic trigger, preconditions, attempt/rate/resource budget,
fencing, idempotence/replay safety where applicable, reconstructibility or a declared
compensation/rollback path, explicit residual effects, independent postcondition, cooldown,
anti-oscillation law, immutable receipt, and automatic demotion on changed assumptions.
No Class A command may mutate capital or an external environment.

**Class B — canonical recovery, not LLM repair**

Unknown exchange outcome, accounting mismatch, position ambiguity, partial fill, borrow or
funding liability, and other capital-affecting states enter canonical reconciliation and
recovery. They never enter an agent repair allowlist.

**Class C — owner-approved normal release**

Any agent- or human-generated code change follows the normal owner-approved, hash-bound
release pipeline. Configuration, deployment, service, host, AWS, Cloudflare, Secrets,
provider activation, or another external mutation additionally requires the separate I00
§20 authorization. None can ever be promoted into the automatic repair allowlist.

**Class D — abstain/demote**

Model/label drift, unsupported cohorts, calibration loss, strategy underperformance, and
unknown research evidence cause the accepted Q/runtime boundary to abstain or recommend
demotion through existing owners. An LLM cannot claim renewed edge.

### 7.6 Repair evidence law

For an eligible Class A command, prove:

1. deterministic failure reproduction;
2. exact registered command identity;
3. focused/regression/fault tests;
4. shadow or no-authority exercise;
5. independent verifier confirms the declared postcondition;
6. no recurrence was observed during a declared quiet period;
7. owner-preauthorized narrow class;
8. bounded rate/resource/attempt/exposure effects;
9. recurrence, drift, or changed assumptions automatically demote eligibility.

Specific repair rules:

- clock repair refreshes offset and may request canonical host resynchronization; it never
  performs an unsafe in-process wall-clock step;
- queue/export recovery preserves material events or records a visible evidence gap;
- backup-path switch requires current proof, temporal coherence, correct identity, and the
  same canonical truth semantics;
- a quiet period is bounded past evidence, never proof of future non-recurrence.

### 7.7 Failure-corpus governance

Validated incidents, near misses, counterexamples, and failed repairs may become fixtures
only under retention, privacy, licensing, access, and deletion/tombstone policy. A deleted or
restricted source remains represented by a tombstone and affected evidence is invalidated;
it is not silently retained or silently removed.

### 7.8 Existing closure targets

- `AGENTIC_DIAGNOSTIC_BOUNDARY.md`
- `OPERATIONAL_FAILURE_ATLAS.md`
- `AUTONOMY_CLOSURE_REPORT.md`
- packet-local fixtures under `fixtures/productAssurance/systemic/agentBoundary/**`

---

## 8. S7 — Accepted-Q evidence disposition only

Q remains the sole owner of datasets, point-in-time manifests, labels, targets, cohorts,
experiments, models, calibration, challengers, promotion, drift, capacity, research
evidence, and quant failure fixtures.

At I01, the director reads immutable accepted-Q receipts and produces the existing
`PUBLIC_QUANT_CANDIDATE_DISPOSITION.md` using I00's established vocabulary.

This amendment may only:

- map accepted Q evidence into I00 assurance claims and cockpit projections;
- identify missing proof or incompatible accepted contracts;
- issue an insertion request to the Q owner/I00 director;
- test that unsupported, stale, drifting, uncalibrated, or incompatible Q evidence causes
  existing abstention/degradation behavior;
- test that no raw Q score shortcuts Capital, Risk, execution, or owner authority.

It creates no Q schema, registry, fixture corpus, dataset, label, experiment, model,
challenger, promotion rule, or research cockpit and never writes `quant/**`.

Missing optional evidence becomes post-I00 `MODEL_RESEARCH_ITERATION`. Only a missing
disposition, false integration claim, incompatible accepted contract, or unsafe
score-to-order shortcut blocks I00.

Public methods—including order-flow imbalance, queue imbalance, microprice, change-point,
survival/time-to-event, Hawkes, boosted-tree, and deep-order-book methods—remain candidate
priors governed solely by accepted Q evidence law. They are not preloaded profit and cannot
be called edge until point-in-time, cost-aware, forward evidence supports the exact traded
cohort.

Accepted-Q assurance also records confirmation lineage for every decision contributor:
dataset/source, label/target, feature family, training cohort/window, model family, calibration
path, and material shared failure domains. The accepted Q owner determines the effective
independent evidence/confirmation count. Correlated indicators or models may improve fit, but
they cannot multiply confidence or satisfy a multi-confirmation gate merely by agreeing when
they share the same biased source, labels, features, regime exposure, or implementation path.
If required independent support is absent, the exact claim remains `UNKNOWN` with an existing
bounded reason identifying insufficient independent evidence.

Validation provenance is equally explicit: generator and validator identity/provider,
validation method and scope, relevant competence evidence, incentives/conflicts, data and
tooling independence, challenge findings, unresolved limitations, and owner disposition.
Another agent from the same provider or the same prompt/tool/data lineage is useful review,
but it is not represented as fully independent effective challenge. More tests from the same
blind spot cannot substitute for a genuinely different method/provider or qualified human
review where the claim's risk requires one. Missing qualified independent validation keeps an
“edge proven” claim `UNKNOWN` with an existing bounded reason identifying insufficient
qualified independent validation; existing Capital/Risk/live-policy owners determine any
resulting cap or abstention. This amendment creates no validator authority and cannot promote
the claim itself.

Accepted-Q assurance must also expose holdout governance already owned by Q: developer and
search processes cannot repeatedly tune against the untouched final holdout; access/release
count and purpose are durable evidence; final evaluation is one-shot or sequestered; and
forward shadow evidence remains separate. If accepted Q receipts cannot establish that
separation, the assurance result is `UNKNOWN` with an existing bounded reason identifying
insufficient holdout separation—not "proven edge". This amendment records the disposition
only and never creates or reads a new Q dataset.

Packet-local read-only output only:

`fixtures/productAssurance/generated/Q_ASSURANCE_COVERAGE_MATRIX.md`

Each row maps an accepted Q artifact/claim to SHA/schema, evidence age, approved scope,
cockpit projection, runtime-assurance result, and exact blocker/insertion request.

---

## 9. S8 — Deadlines, cancellation, and control-loop stability

### 9.1 Cancellation semantics

Every bounded internal request tree that can safely be cancelled carries an inherited
deadline, child budget, cancellation context, owner, and late-result law.

Long-lived streams/controllers use leases and heartbeats rather than one root deadline.
Durable reconciliation, authoritative evidence ingestion, and already-authorized risk
reduction may detach only through an already-registered operation class under its canonical
owner into a fenced recovery context; they must not stop merely because the initiating
request timed out.

Locally controlled cancellable children stop initiating new side effects. External or
already-accepted mutations use only the existing command/operation schema to record that a
cancel was requested, whether cancellation is supported, and that authoritative
reconciliation remains required. This amendment invents no cancellation status.
Cancellation is intent, never proof that an exchange/account mutation did not occur.

Late acknowledgments, fills, cancels, funding, borrow, repay, account events, and other
external facts are durably ingested. A stale epoch can prevent them from authorizing new
work but cannot erase truth.

### 9.2 Repair/control-loop contract

Every automatic local repair policy extends the existing `RELIABILITY_POLICY_REGISTRY.md`
and declares:

- controlled state and observed signals;
- registered command identity and canonical owner;
- prerequisites and forbidden contexts;
- evaluation cadence and observation horizon;
- actuation delay;
- deadband/hysteresis;
- cooldown;
- maximum step/slew;
- success predicate and independent verifier;
- progress metric and no-progress threshold;
- maximum attempts, backoff, rate/resource budget, and convergence deadline;
- oscillation signature and conflicting controllers;
- rollback/compensation/quarantine/escalation;
- late-result and restart behavior.

No-progress, contradictory progress, repeated rollback, or alternating repairs terminate in
quarantine, escalation, or durable unresolved state within the declared control budget only
when the required durable store, clock, lease/fence, and observability assumptions hold. If
those assumptions fail, posture becomes `UNKNOWN`/unbounded and the independent watchdog or
existing budget circuit must surface it; the system must not claim guaranteed termination.

### 9.3 Cost and resource circuit

Prepare evidence and insertion requests for existing owners to apply bounded-control law to
LLM tokens, APIs, Binance rate limits, telemetry storage, replay compute, database/WAL
growth, cloud cost, and background-job concurrency. IP-ASSURANCE does not create a resource
controller or throttling authority.

The cockpit shows current burn, budget, forecast or `UNKNOWN`, top consumers, throttling,
and exact canonical action/recommendation. Resource controls may not discard material money
or audit evidence and may not block independently safe risk reduction.

### 9.4 Packet-local outputs

- `fixtures/productAssurance/systemic/stability/**`
- `test/productAssurance/systemic/stability/**`
- generated rows for `RELIABILITY_POLICY_REGISTRY.md`
- generated rows for `RESOURCE_AND_BACKPRESSURE_REPORT.md`
- generated rows for `AUTONOMY_CLOSURE_REPORT.md`

---

## 10. Composed-acceptance insertion specifications

This amendment prepares deterministic fixtures, expected outcomes, and insertion requests
only. IP-PROOF owns the composed integration harness. The I00 director alone runs composed
runtime, browser, deployment, independent-watchdog, and final acceptance. No amendment
worker claims a scenario passed against the composed product.

Required insertion scenarios:

1. A deterministic fixture derived from an identified unsafe control action is rejected or
   contained by the canonical owner; STPA itself is not a runtime blocker.
2. Individually fresh Spot/Futures/account observations fail mutual coherence; dependent
   proposal/action evidence becomes unavailable and the cockpit names the skew.
3. Eleven components are expected but only ten report; overall dependent green is
   impossible and the missing component is named. Companion fixtures prove that
   discovered-but-uninstrumented and current-but-unreconciled remain distinct non-green
   facts rather than disappearing into one aggregate status.
4. A stale process callback arrives after fencing ownership changed; the external fact is
   reconciled but the stale epoch cannot commit canonical authority/state.
5. A send times out and the exchange later fills; restart reconciles without blind resend.
6. A two-leg action partially fills and preferred recovery rate-limits; the canonical
   executor follows an owner-registered fallback supported by current scenario-bounded
   evidence, or records unresolved liability and existing posture. Halting alone is not
   called recovery.
7. Critical assurance evidence expires while the UI is open; the claim becomes `UNKNOWN`
   and recomputes within its SLO without a refresh trick.
8. Two repair controllers oscillate; the existing canonical remediation owner applies its
   stability law, quarantines/escalates, and preserves evidence.
9. Parent cancellation reaches cancellable children while a non-cancellable exchange
   mutation is in flight; children stop new effects and the external result is reconciled or
   becomes explicitly unresolved.
10. Telemetry export fails; material evidence is buffered/replayed or an evidence-gap
    incident is visible, and no false observable claim survives.
11. App/host/tunnel dies; an independent out-of-band destination receives the tested page
    and durable delivery receipt.
12. Prompt-injected evidence asks an agent to use a forbidden tool/path; external sandbox
    denies it and append-only evidence survives.
13. An agent produces a plausible patch; it cannot edit Main/live, deploy, self-approve, or
    enter an automatic allowlist.
14. A registered local repair passes its fixture but fails independent postcondition; it is
    rejected/demoted.
15. Accepted Q evidence performs globally but is stale or uncalibrated for the exact cohort;
    existing runtime boundary abstains/degrades.
16. Expected research evidence or losing trials are missing from an accepted claim;
    disposition becomes limited/unknown rather than fabricated.
17. Rollback restores an old SHA while an old process is alive; fencing prevents dual
    capital authority.
18. Exchange-native dead-man support is unsupported or not configured for a specific
    product; cockpit says so and never claims global protection.
19. Versioned capital/truth SLO burns; canonical owners enforce their existing asymmetric
    posture while independently safe reconciliation/risk reduction remains.
20. A critical assumption or required evidence-independence claim is contradicted, including
    a common-mode producer/verifier dependency; affected claims become `UNKNOWN`/failed
    within the declared assurance SLO and the causal path is visible.
21. Two simultaneous executors attempt the same mutation; only the current fenced epoch may
    authorize or commit the new transition. Facts durably received by canonical reconciliation
    are not rejected solely because their reporting process lost the lease; unproved receipt
    remains `UNKNOWN`, and the collision is incident-bound.
22. Agent audit-deletion or trace-exfiltration is attempted; deny/fault tests prove evidence
    remains and sensitive data does not leave the boundary.
23. A formal protocol model passes but its implementation mapping, release hash, or replay
    evidence is missing; the model remains `REFERENCE_ONLY`/`UNKNOWN` and cannot close the
    runtime claim.
24. Five models trained from one biased source and substantially shared labels/features all
    agree; the dependency graph counts one effective evidence family rather than five
    independent confirmations, and the dependent claim remains `UNKNOWN` with an existing
    bounded reason identifying insufficient independent support.
25. Runtime discovery and telemetry both omit the same required component; the release-bound
    expected manifest still names it, makes green impossible, and exposes the exact mismatch.
26. A model is built and reviewed by several agents sharing one provider, prompt lineage,
    dataset, and evaluation harness; the reviews are recorded as related evidence rather than
    independent effective challenge, and the edge claim remains `UNKNOWN` with an existing
    bounded reason identifying absent distinct validation.

The IP-PROOF insertion request requires each registered important failure to expose:

- detection within its declared SLO, not a universal five-second promise;
- plain-language reason and affected dependency path;
- canonical posture and authority owner;
- registered automatic action or explicit absence with an existing bounded reason code;
- remaining owner action/runbook;
- incident, trace, and evidence drill-down.

---

## 11. Safe preparation and canonical fan-in

After the director accepts and freezes an amended IP_ASSURANCE SHA, collision-free workers
may prepare only exclusive subtrees inside IP-ASSURANCE's accepted territory:

- `fixtures/productAssurance/systemic/hazard/**`
- `fixtures/productAssurance/systemic/actionEvidence/**`
- `fixtures/productAssurance/systemic/formal/**`
- `fixtures/productAssurance/systemic/assuranceCase/**`
- `fixtures/productAssurance/systemic/cockpit/**`
- `fixtures/productAssurance/systemic/observability/**`
- `fixtures/productAssurance/systemic/agentBoundary/**`
- `fixtures/productAssurance/systemic/stability/**`
- matching exclusive `test/productAssurance/systemic/<owner>/**`

Owner map:

- S1/S2/S4/S5/S6/S8 packet-local schemas, pure reference evaluators, fixtures, tests, model
  sources, reports, and insertion requests: IP-ASSURANCE allowed preparation paths;
- S3 model sources: packet-local formal subtree; IP-PROOF consumes accepted
  counterexamples and owns composed acceptance;
- S5 rendering/browser behavior: IP-CONTROL and IP-PROOF through insertion requests;
- S7: director-owned I01 disposition over immutable accepted-Q receipts; no worker task;
- provider activation, sandbox deployment, external watchdog, host, Cloudflare, Secrets,
  and other environment configuration: IP-OPS/I00 under §20 authorization.

No systemic worker writes Q, L, root artifacts, shared barrels/schemas, packages, Main,
startup, routes, persistence, migrations, App/router/store/pages, live controls, exchange
clients, deployment, or final receipts.

No satellite implements a production evaluator. If the amended IP_ASSURANCE requires
production code under its already accepted `server/src/productAssurance/**` territory, one
canonical IP-ASSURANCE worker owns that entire production subtree after fixture contracts are
frozen; satellites return packet-local evidence and insertion requests only.

Dependency order:

1. director dedup and amended-IP_ASSURANCE freeze;
2. hazard/assumption, protocol-model, cockpit/SLO, agent-boundary, and stability fixtures may
   prepare concurrently in exclusive paths;
3. pure assurance projection waits for accepted invariant/assumption contracts;
4. action-safety evidence waits for frozen exported Q/L/Capital/Risk/execution interfaces;
5. all shared insertion requests wait for the canonical owner;
6. IP-PROOF consumes accepted fixture contracts;
7. I00 performs its existing ordered fan-in and external proof.

Each worker returns only immutable commit, packet-local receipt, focused tests, dedup
findings, insertion requests, and blockers. The director resolves semantics and integration.

---

## 12. Mapping into existing closure truth

Do not create fourteen competing root artifacts. Only the I00 director may fold accepted
evidence into the existing I00 §21A closure suite:

- hazards, assumptions, action evidence, and derived claims ->
  `SAFETY_INVARIANT_CATALOG.md` and `AUTONOMY_CLOSURE_REPORT.md`;
- protocol models and validated counterexamples -> `FAULT_INJECTION_AND_SOAK_REPORT.md`
  and `OPERATIONAL_FAILURE_ATLAS.md`;
- inventory, observability, panels, and SLOs -> `TELEMETRY_COVERAGE_MATRIX.md`,
  `RESOURCE_AND_BACKPRESSURE_REPORT.md`, and existing I17 page matrix;
- agent boundary/evidence -> `AGENTIC_DIAGNOSTIC_BOUNDARY.md`;
- accepted-Q disposition -> `PUBLIC_QUANT_CANDIDATE_DISPOSITION.md`;
- cancellation/stability -> `RELIABILITY_POLICY_REGISTRY.md` and
  `AUTONOMY_CLOSURE_REPORT.md`;
- dedup/insertion -> existing Mission Coverage Matrix and
  `ASSURANCE_INSERTION_REQUEST.md`;
- completion evidence -> ordinary IP-ASSURANCE and I00 phase/final receipts.

Intermediate files stay under `fixtures/productAssurance/generated/**` and never become
root runtime truth.

Every mapped item records canonical target, runtime owner, insertion SHA, IP-PROOF scenario,
configuration state, live/synthetic/shadow/unsupported/unavailable status, and supersession
disposition.

---

## 13. Owner/external configuration residuals

These are real closure requirements but not new architecture programs:

1. Rotate any Binance, Alchemy, or other key that ever appeared in source, a ZIP, logs, or
   screenshots; prove the new key's exact permissions and no withdrawal capability.
2. Select one out-of-band paging destination and prove end-to-end delivery with durable
   receipt and cockpit-visible failure.
3. Configure an AWS estimated-charge alarm as an external cost/security control; it is not
   trading authority.
4. Mount bounded historical operational trend views from the accepted telemetry owner.
5. For each exchange/product, classify exchange-native countdown/dead-man support as
   `SUPPORTED`, `UNSUPPORTED`, or `NOT_CONFIGURED`; when supported and separately
   owner-authorized, record symbol/product coverage, renewal, expiry, confirmations,
   uncovered orders, cockpit state, and fault test. Never call it universally global.
6. Require a reviewed post-incident record for incidents selected by a versioned policy,
   including capital impact, reconciliation/recovery, security, deployment, and prolonged
   availability cases.
7. Prove deployment, restore, rollback, tunnel, DNS/Cloudflare, Secrets, and external
   sentinel behavior through their existing IP-OPS/I00 owners.

A post-incident record includes impact, exact timeline, failed invariant, root/contributing
causes, detector, earlier missing detector, containment/recovery, corrective actions, owner,
deadline, and the regression/fault test preventing recurrence.

---

## 14. Exact director handoff

Read `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`, `IP_ASSURANCE.md`, accepted Q/L
state and receipts, active writer ownership, and actual Git truth.

Treat `IP_ASSURANCE_SYSTEMIC_AMENDMENT.md` as a candidate amendment only. Do not hand it to
builders as a sixth packet.

First produce the packet-local dedup matrix. Fold only `MISSING` or narrow `EXTENDED`
requirements into an amended `IP_ASSURANCE.md`, record its accepted SHA/input digest, and
archive this source as `SUPERSEDED_BY_IP_ASSURANCE_AT_<SHA>`. Any proposed change to I00
remains a separate director-only insertion request under I00's own amendment law.

Do not create a new packet, state file, runtime owner, registry, Q/L task, cockpit,
supervisor, Risk/Capital gate, executor, persistence owner, telemetry platform, proof
harness, or deployment authority.

After the amended IP-ASSURANCE SHA is frozen, cut only the collision-free packet-local
fixture/evaluator work permitted by Section 11. Q and L remain under their current owners.
IP-CONTROL owns rendering. IP-PROOF owns composed harness/browser proof. IP-OPS/I00 own
external activation. I00 owns shared wiring, deployment evidence, final closure, and
`INTEGRATED_ACCEPTED`.

Bounded self-correction means:

- known registered local non-capital fault -> an already registered, owner-preauthorized
  canonical Control Plane command executed by the existing deterministic controller, with
  bounded budget, idempotence/replay safety where applicable, reconstructibility or
  compensation/rollback, declared residual effects, and independent verification;
- ambiguous/capital-affecting fault -> contain risk increase, preserve truth, reconcile,
  and use canonical recovery authority;
- model drift/unsupported cohort -> existing abstention/demotion path;
- unknown fault -> no risk increase, immutable evidence, owner page, optional bounded LLM
  investigation only if configured and authorized.

An LLM/agent never edits live production. An accepted agent patch can reach production only
through the existing owner-approved, hash-bound deterministic release pipeline with
independent tests, deployment fencing, readback, rollback, and immutable audit.

Stop the IP-ASSURANCE worker only at `ASSURANCE_PRESTAGE_READY` or one exact blocker. The
director then performs I00's existing fan-in and may claim completion only after measured
runtime, browser, deployment, and external-boundary evidence supports
`INTEGRATED_ACCEPTED`.

---

## 15. Research basis

Primary sources informing this amendment:

- MIT STPA Handbook — system losses can arise from unsafe interactions without a component
  failure:
  https://psas.scripts.mit.edu/home/get_file.php?name=STPA_handbook.pdf
- AWS experience with TLA+ — small formal specifications expose subtle distributed-system
  design errors before implementation:
  https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf
- Black-Box Simplex — advanced controller separated from a verified safety controller:
  https://arxiv.org/abs/2102.12981
- ACCESS dynamic assurance — runtime claims supported by evolving evidence:
  https://arxiv.org/abs/2403.15236
- Google SRE automation — automation needs bounded failure behavior and operator leverage:
  https://sre.google/sre-book/automation-at-google/
- Google SRE cascading failures — deadlines, retries, overload, and cancellation require
  end-to-end design:
  https://sre.google/sre-book/addressing-cascading-failures/
- Google SRE SLO alerting — actionable, multi-window, symptom-oriented alerting:
  https://sre.google/workbook/alerting-on-slos/
- Google SRE monitoring — combine white-box and black-box evidence; keep paging simple,
  actionable, and comprehensible:
  https://sre.google/sre-book/monitoring-distributed-systems/
- Kubernetes controller pattern — continuously reconcile observed state toward declared
  desired state while reporting current state:
  https://kubernetes.io/docs/concepts/architecture/controller/
- OpenTelemetry context propagation:
  https://opentelemetry.io/docs/concepts/context-propagation/
- OpenTelemetry Collector resiliency:
  https://opentelemetry.io/docs/collector/resiliency/
- OpenAI Agents guardrails — tool guardrails do not automatically cover every hosted tool
  surface:
  https://openai.github.io/openai-agents-python/guardrails/
- OpenAI Agents tracing — sensitive trace capture requires deliberate policy:
  https://openai.github.io/openai-agents-python/tracing/
- NIST AI 600-1 — unknown risk, confabulation, component-integration risk, governance,
  pre-deployment testing, and incident disclosure:
  https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
- FINRA Regulatory Notice 15-09 — algorithmic-trading change control, pre-production
  testing, pilot sizing, real-time monitoring, and post-implementation scrutiny:
  https://www.finra.org/sites/default/files/notice_doc_file_ref/Notice_Regulatory_15-09.pdf
- SEC Rule 15c3-5 release — documented pre-trade controls, authorized access, direct control,
  immediate post-trade reporting, and regular effectiveness review (used here as a strong
  control-design reference, not as a claim that this private project is a broker-dealer):
  https://www.sec.gov/files/rules/final/2010/34-63241.pdf
- Binance USD-M auto-cancel endpoint — signed and symbol-scoped, with approximate countdown
  checking; it is not a universal dead-man switch:
  https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#auto-cancel-all-open-orders
- Run Time Assurance tutorial — separate an advanced controller from a smaller safety
  monitor/backup controller:
  https://arxiv.org/abs/2110.03506
- Federal Reserve SR 11-7 — model risk, independent validation, effective challenge, and
  ongoing monitoring:
  https://www.federalreserve.gov/supervisionreg/srletters/sr1107.htm
- Order-flow imbalance as a public research prior, not guaranteed alpha:
  https://arxiv.org/abs/1011.6402
- Multiple testing in finance:
  https://academic.oup.com/rfs/article/29/1/5/1843824
- Probability of backtest overfitting:
  https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253
- Perpetual futures under market frictions:
  https://arxiv.org/abs/2212.06888

---

## 16. Supersession statement

This amendment does not prove that no future architecture gap exists and creates no new
terminal law. Once accepted deltas are folded into IP_ASSURANCE, and any separately approved
I00 insertion request is adjudicated under I00's own amendment law, future work is governed
solely by I00's Mission Coverage Matrix, classification, authority, amendment, and
acceptance laws.

This source becomes an archived provenance receipt and must not direct future workers.
