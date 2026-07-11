# Capital Supervision Component Manifest

Status: **DORMANT / NOT WIRED**

This manifest describes a pure Opportunity-to-Position Operating Kernel. It has
no runtime composition, route, timer, network transport, database adapter, order
sender, borrow/repay operation, or live automation authority.

## Repository identity

- Repository: `/Users/cosmosgeek/Desktop/Main-capital-supervision-20260711`
- Branch: `capital-supervision-main-20260711`
- Accepted base: `c4ae7a9aee51050da2076bf4a454988b1d372bc4`
- Accepted Market Intelligence ancestor: `3340f75270049de96846d153672b91f065844eef`

## Mandatory source ownership and reuse audit

| Concept | Existing owner | This sprint's role | Future adapter seam | Duplication avoided |
| --- | --- | --- | --- | --- |
| Basis proposal and lifecycle | `server/src/engine/basis/**`; public barrel `basis/index.ts`; `BasisProposal` and `BasisEngine.openProposals()` | Preserve the child ID, correlation, direction, timestamps, validity, expiry and exact-loss report; never rescore or revive a rejected/expired proposal | Read-only `BasisProposal` translator into a canonical intake port | No second Basis scanner, score, proposal store, or invalidation engine |
| Volume proposal and lifecycle | `server/src/engine/volume/**`; public barrel `volume/index.ts`; exported `EngineProposal` reads | Preserve child facts and keep directional Volume advisory/validate-only unless an explicit calibration policy permits capital consideration | Read-only `EngineProposal` translator plus caller-supplied TTL/config provenance | No second Volume detector, confidence model, proposal store, or private-rule cast |
| Canonical cross-engine proposal projection | `server/src/foundation/contracts/opportunity.ts` and `foundation/readModel/ports.ts` | Consume `CanonicalProposal` as the core proposal reference and add only capital eligibility facts | `ProposalIntakePort` supplies immutable canonical proposals | No parallel canonical proposal vocabulary |
| Normalized evidence and source truth | `server/src/intelligenceFoundation/contracts/**` and `evidence/**` | Reference evidence IDs/kinds/truth; omit floating financial payloads and require separately correlated exact decimals | `IntelligenceEvidencePort` with explicit completeness/loss reporting | No second normalizer, evidence store, source-quality engine, or fabricated evidence |
| Thesis and forensics | `server/src/intelligenceFoundation/thesis/**` and `forensics/**` | Consume evidence-only hypothesis/stage/reasons; own only the position's capital thesis revision and supervision policy | `IntelligenceThesisPort` keyed by packet ID | No second thesis classifier, probability, strategy score, or tradeability authority |
| Observed outcomes | `server/src/intelligenceFoundation/outcomes/**` | Accept outcome IDs as context only; never treat theoretical floating outcome metrics as position PnL | `OutcomeReferencePort` | No second intelligence outcome engine and no outcome/PnL conflation |
| Intelligence topology | `server/src/intelligenceFoundation/topology/**` | Build a separate read projection for active-capital state and optionally map it later with declared semantic loss | Future render adapter | No second Market Intelligence component registry or fake component health |
| Structured operational failures | `server/src/foundation/contracts/failures.ts` | Reuse `StructuredFailure` and `ContractResult` at every authority boundary | Direct type/value import from `foundation/contracts/index.js` | No parallel error envelope |
| Source authority and freshness | `server/src/foundation/contracts/authority.ts` and `time.ts` | Reuse `DataAuthority`, `SourcedTimestamp`, `FreshnessReport`, and `evaluateFreshness`; conservatively project the broader capital truth states | Truth-bearing input ports | No second source clock or freshness calculator |
| Final multi-leg risk verdict | `server/src/foundation/risk/**` and frozen `RiskVerdict` | Emit `AWAITING_RISK`; consume only a bound external verdict reference. A bare verdict is insufficient and Capital never calls the evaluator | `RiskDecisionPort` binding verdict ID, mandate digest/revision, plan reference, correlation and expiry | No second risk gate or self-approval |
| Execution mechanics and lifecycle | `server/src/foundation/execution/**`; frozen `PlanLifecycle`, `LegLifecycle`, correlation IDs | Emit economic targets and consume external lifecycle/reference slices only | `ExecutionStatePort` | No order plan mechanics, retry/cancel sequencing, client-order IDs, or executor |
| Reconciliation | `server/src/foundation/reconciliation/**`; frozen `ReconciliationStatus` | Consume the canonical status/reference and preserve ambiguity/divergence as unknown or recovery-required | `ReconciliationStatePort` | No exchange/local comparison, reconciliation engine, or false-flat projection |
| Runtime pause/kill posture | `server/src/foundation/control/**` and runtime contracts | Consume a read-only posture projection; block open/add while preserving reduce/exit/recovery | `ControlPosturePort` | No second control plane or supervisor |
| Borrow availability and rate truth | `server/src/foundation/borrow/**`; exported `BorrowTruth` exact strings | Consume read-only borrow truth for account eligibility and Basis supervision | `BorrowTruthPort` | No second borrow evidence derivation or risk-lane borrow vocabulary |
| Venue account DTOs and risk account snapshot | Foundation USD-M boundary and `foundation/risk/**` | Translate exact-string venue facts or narrow semantic references; reject floating financial fields at Capital boundaries | Future signed-account read adapters | No private exchange client and no claim that a risk snapshot is allocatable-capital truth |
| Aggregate allocatable capital | No canonical existing owner; legacy account/loan services are runtime-bound and float-based | **BUILD** conservative multi-source projection with explicit unavailable/unknown amounts | Caller-supplied account, position, liability, valuation and commitment ports | Does not replace account services, venue reads, or Foundation risk evidence |
| Portfolio budgets and reservations | No existing portfolio reservation owner; legacy order notional holds in `services/orders.ts` are execution commitments | **BUILD** deterministic economic budgets/reservations while consuming existing holds as commitments | Commitment port plus persistence event/checkpoint port | No reuse of random order reservation IDs and no double allocation |
| Position PnL/cost attribution | Existing UI/account PnL is partial/float-based; Foundation calibration is outcome-specific | **BUILD** exact-decimal component accounting with explicit missing/estimated/divergent states | Ledger/fill/funding/borrow/valuation input ports | No second ledger, no forced residual, and no incomplete economics presented as profit |
| Durable events/database | Existing ledger/database | Define serializable payloads and a persistence port only | Future ledger adapter | No file, SQLite, or database write |

## Reuse decisions and known contract loss

- Foundation money/quantity fields in risk, execution, and reconciliation use
  JavaScript numbers. Capital consumes only their identifiers, lifecycles,
  statuses, reasons and authority references; every Capital financial value is
  an exact decimal string.
- Market Intelligence financial evidence also uses numbers. Compatibility
  adapters preserve evidence identity/truth and report numeric payload omission;
  exact financial values must be supplied separately and correlated to evidence.
- `CanonicalProposal` has no true engine source revision. Capital records the
  source revision as unknown and may derive a separate immutable intake digest;
  it never relabels `updatedTs` or a content hash as an engine revision.
- Basis exposes a machine expiry. Volume does not expose its private TTL rule;
  a Volume expiry requires caller-supplied versioned policy provenance or remains
  unknown/advisory.
- Foundation `RiskVerdict` is intentionally not bound to a plan. Capital wraps
  it only in a reference envelope that proves the exact mandate/revision/digest;
  it does not copy or widen the verdict.

## Measured implementation inventory

The implementation checkpoint contains 59 production TypeScript files with
14,222 lines and 20 test/support modules with 10,851 lines. The aggregate
barrel is `server/src/capitalFoundation/index.ts`; no runtime composition root
imports it.

| Component | Production files | Test/support files | Measured checks |
| --- | --- | --- | ---: |
| Aggregate barrel | `index.ts` | None | Included through all suites |
| Contracts | `contracts/{index,decimal,identity,truth,lifecycle,economics,actions,opportunity,capital,approvals,positions,ports}.ts` | `contracts/contracts.test.mjs`; `contracts/vocabulary.test.mjs` | 32/32 |
| Account Truth | `accountTruth/{index,project,types}.ts` | `accountTruth/accountTruth.test.mjs` | 24/24 |
| Opportunities | `opportunities/{index,eligibility,types}.ts` | `opportunities/opportunities.test.mjs` | 36/36 |
| Budgets | `budgets/{index,fromAccount,validate,types}.ts` | `budgets/budgets.test.mjs` | 18/18 |
| Allocation and reservations | `allocation/{index,allocator,reservations,types}.ts` | `allocation/allocation.test.mjs`; `allocation/reservation-closure.test.mjs` | 55/55 |
| Staged mandates | `stages/{index,policy,types}.ts` | `stages/stages.test.mjs` | 25/25 |
| Scoped approvals | `approvals/{index,validation,reducer,types}.ts` | `approvals/approvals.test.mjs` | 27/27 |
| Active positions | `positions/{index,projection,types}.ts` | `positions/projection.test.mjs` | 39/39 |
| Position supervision | `supervision/{index,common,basis,volume,types}.ts` | `supervision/supervision.test.mjs` | 44/44 |
| Economic action intents | `actions/{index,planner,types}.ts` | `actions/actions.test.mjs` | 17/17 |
| Exact economics | `economics/{index,compose,types}.ts` | `economics/economics.test.mjs` | 22/22 |
| Checkpoints and restart | `checkpoint/{index,events,projector,types}.ts` | `checkpoint/checkpoint.test.mjs`; `checkpoint/officialMandateFixture.mjs` | 21/21 |
| Active-capital topology | `topology/{index,projector,types}.ts` | `topology/topology.test.mjs` | 24/24 |
| Compatibility adapters | `scenarios/{index,proposalCompatibility,intelligenceCompatibility,types}.ts` | `compatibility/compatibility.test.mjs` | 19/19 |
| Cross-lane scenarios | No production runner; adapters above only | `scenarios/{fixtures,harness,scenarios.test}.mjs` | 30/30 |
| **Total** | **59 files** | **20 files** | **433/433** |

## Component responsibilities, public surface, and boundaries

All exports below are reachable through the aggregate barrel unless explicitly
described as module-internal. Type declarations associated with each component
are re-exported through its local `index.ts`.

### Contracts

Public surface: branded exact-decimal normalization and arithmetic; deterministic
ID, digest, config revision, and correlation derivation; truth assessment;
lifecycle and stage vocabularies/transitions; economics and action validators;
opportunity, allocation, reservation, approval, mandate, position, and port
contracts; and type-only re-exports of Foundation `ActionRiskClass`,
`ContractResult`, `DataAuthority`, `FreshnessReport`, `LegLifecycle`,
`PlanLifecycle`, `ReconciliationStatus`, `SourcedTimestamp`, and
`StructuredFailure`.

Responsibility: freeze a float-free Opportunity-to-Position vocabulary and
preserve canonical Foundation types. Exact values are canonical strings with a
96-digit public bound and bounded division scale. Lifecycle receipts explicitly
carry `authority: 'NONE'` and `executionReady: false`; edges owned by external
risk/execution systems fail closed.

Non-responsibility: price/FX discovery, source authentication, risk evaluation,
execution, reconciliation, persistence, or runtime composition.

### Account Truth

Public surface: `deriveAccountCapitalProjection`, `ACCOUNT_SNAPSHOT_KEYS`, and
the account input/provenance/projection types.

Responsibility: derive one immutable conservative coherent cut across supplied
Spot, Futures, liability, valuation, hard-reserve, borrow, exposure, and
commitment facts. It partitions pools without overlap, de-duplicates claims,
keeps borrow capacity observable but outside owned capital, and leaves exposure
visible when truth is incomplete.

Non-responsibility: exchange reads, valuations, borrow derivation, risk, or
allocation. Future input owner: signed read-only Spot/USD-M/Margin adapters,
valuation/commitment readers, and Foundation Borrow Truth.

### Opportunities

Public surface: `deriveOpportunityEligibilityPolicyRevision` and
`evaluateOpportunityEligibility` plus policy, structure, conflict, and candidate
types.

Responsibility: content-address eligibility policy; preserve engine proposal IDs,
correlations, lifecycles, and expiry; validate evidence/thesis/truth/configuration;
detect declared opportunity conflicts; and keep Volume advisory or validate-only.

Non-responsibility: scanning, scoring, confidence, proposal creation, evidence
classification, or proposal resurrection. Future input owner: existing engines,
Market Intelligence, and trusted policy delivery.

### Budgets

Public surface: `projectPortfolioBudgetSnapshotFromAccount`,
`deriveCapitalBudgetPolicyRevision`, `validateCapitalBudgetPolicy`,
`validatePortfolioBudgetSnapshot`, `validateBudgetContext`, commitment vocabulary,
and budget types.

Responsibility: bridge Account Truth without caller restatement; bind the full
account digest; prove the exact collateral partition; derive commitment and
concurrency counts; enforce gross/net/collateral/margin/strategy/symbol/venue and
borrow limits; and re-age every required truth fact.

Non-responsibility: account reads, policy authenticity, durable commitments, or
capital optimization. Future owner: trusted configuration plus the account and
portfolio-commitment read models.

### Allocation and reservations

Public surface: `deriveAllocationSizingAuthorityRevision`,
`validateAllocationCandidate`, `allocateCapital`, `reduceReservationBook`,
`EMPTY_RESERVATION_BOOK`, reservation vocabularies, and allocation/reservation
types.

Responsibility: deterministic scarcity ordering; exact conservative sizing;
complete consideration and sizing-authority binding; every applicable capital,
liquidity, correlation, and concurrency cap; auditable remainders; exclusive
claims; idempotent reserve/consume/renew/release/expire transitions; and exact
release-on-close.

Closure requires a complete content-addressed mandate, a canonically re-projected
closed zero-exposure position, closed Foundation execution, current exact
same-plan reconciliation, no outstanding intent, and exact consumed/reserved
bindings. Self-asserted legacy closure fields fail closed.

Non-responsibility: Kelly/optimizer logic, policy signatures, persistence, final
risk, or execution. Future owner: trusted sizing policy, a serialized single
writer reservation journal, and Foundation execution/reconciliation readers.

### Staged mandates

Public surface: `validateStagedPlanConfiguration`,
`createStagedPlanConfiguration`, `isStagedPlanConfigurationEffective`,
`validateGovernedStages`, `buildStagedPlan`, `reviseStagedPlan`,
`evaluateStageTransition`, `buildCapitalMandate`, and `reviseCapitalMandate`.

Responsibility: content-bound stage configurations and plans; immutable completed
prefixes; explicit next/skip/cancel rules; exact reservation consumption; fresh
same-clock proposal/config/evidence/liquidity checks; actual approval state and
mandate binding for ADD; and an authorization only for external risk evaluation.
Every successful transition remains `executionReady: false`.

Non-responsibility: operator authentication, final risk, execution, or durable
state. Future owner: authenticated control/policy adapters followed by Foundation
risk and execution.

### Scoped approvals

Public surface: `validateOperatorApproval`, `validateApprovalPolicyBounds`,
`deriveApprovalPolicyDigest`, `evaluateOperatorApproval`,
`createOperatorApprovalState`, and `reduceOperatorApprovalState`.

Responsibility: validate exact proposal, mandate, plan, configuration, symbol,
instrument, action, stage, notional, time-window, revocation, and use-scope
bindings; content-address policy semantics; and project an idempotent revisioned
approval state. Recording use is audit state, never authorization.

Non-responsibility: identity/authentication, durable approval storage, risk, or
execution. Future owner: authenticated operator control API plus trusted policy
distribution and persistence.

### Active positions

Public surface: `summarizePositionExposure` and `projectActivePosition` plus
projection and issue types.

Responsibility: validate runtime identities, revisions, times, thesis, lifecycle,
Foundation plan/reconciliation vocabularies, exact leg exposure, correlation, and
truth; re-project a frozen active position; retain exposed capital; and convert
unknown, inconsistent, or late external state into `UNKNOWN` or
`RECOVERY_REQUIRED`, never false flatness.

Non-responsibility: execution/reconciliation calculation, venue position reads,
or PnL. Future owner: Foundation Execution and Reconciliation ports.

### Position supervision

Public surface: common policy constants and revision/truth helpers;
`deriveBasisSupervisionPolicyRevision`, `basisSupervisionPolicyIsValid`,
`superviseBasisPosition`; `deriveVolumeSupervisionPolicyRevision`,
`volumeSupervisionPolicyIsValid`, and `superviseVolumePosition`; plus supervision
types.

Responsibility: revalidate hostile position boundaries before geometry; re-age
all truth; apply pause/kill asymmetry; prioritize one-leg exposure,
reconciliation uncertainty, and recovery; keep Basis convergence/widening,
funding, borrow, hedge, liquidation, margin, and remaining-edge policy distinct
from Volume continuation, leadership, crowding, exhaustion, reversal, and
calibration policy; and emit exact deterministic action decisions.

Non-responsibility: timers, fetching, evidence classification, final risk,
execution, or orders. Future owner: runtime composition supplying exact
market/account/cost facts.

### Economic action intents

Public surface: `planEconomicAction`, `targetExposureChange`,
`resultingExposure`, and action planning/authority types.

Responsibility: convert a supervision decision into an economic target only.
ADD requires the unchanged same-clock stage authorization and matching incumbent
plan/reservation/approval/gates. REDUCE and hedge prove signed absolute risk
reduction; exit/emergency target exact zero; control truth is re-aged; provenance
is canonical.

Non-responsibility: order plan construction, client order IDs, retries, cancels,
submission, or recovery mechanics. Future owner: Foundation risk, execution, and
reconciliation.

### Exact economics

Public surface: `deriveEconomicAccountingPolicyRevision`,
`validateEconomicAccountingPolicy`, `composeEconomicReport`, and
`rollUpEconomicReports` plus policy, component, dimension, identity, and report
types.

Responsibility: exact component identity; explicit known/estimated/missing/not
applicable/divergent states; prevention of price-PnL and execution-cost double
counting; provenance and dimension consistency; exact net identity; and child
roll-up by recomposition rather than summing child nets.

Non-responsibility: fill, fee, funding, borrow, conversion, or valuation source
calculation and ledger persistence. Future owner: Foundation execution/fill facts,
account cost/valuation sources, and the existing ledger.

### Checkpoints and restart

Public surface: versioned checkpoint/event schemas;
`createCapitalCheckpointEvent`, `validateCapitalCheckpointEvent`,
`decodeCapitalCheckpointEventRecord`, `createEmptyCapitalCheckpointState`,
`applyCapitalCheckpointEvent`, `replayCapitalCheckpointEvents`,
`createCapitalCheckpoint`, `serializeCapitalCheckpoint`,
`projectRestartSafety`, and `restoreCapitalCheckpoint`.

Responsibility: canonical serializable events; deep dependency/digest/authority
validation; monotonic sequence/revision/time; duplicate idempotency and conflict
detection; no resurrection; byte-stable replay/serialization; canonical position
reprojection; and restart policy that preserves exposed positions and safe
reductions while blocking unsafe opens/adds.

Non-responsibility: file/database I/O or event transport. Future owner:
`CapitalPersistencePort` implemented over the existing ledger/database.

### Active-capital topology

Public surface: `projectActiveCapitalTopology` and topology node, edge, blocker,
owner, freshness, evidence, supervisor, checkpoint, economics, and snapshot types.

Responsibility: deterministic render-ready projection; explicit missing
dependencies; precise local root blockers; truth re-aging; exposed-capital-first
attention; and critical-path correlation across opportunity, mandate, approval,
risk, execution, reconciliation, position, action, and economics.

Non-responsibility: UI, runtime health probes, controls, or graph persistence.
Future owner: canonical read model/control API and cockpit renderer.

### Compatibility adapters

Public surface: `adaptCanonicalProposalToCapitalIntake`,
`adaptBasisProposalToCapitalCandidate`, `adaptVolumeProposalToCapitalCandidate`,
`adaptMarketIntelligenceEvidenceReference`, and
`adaptMarketIntelligenceThesisReference` plus float-free public input/output views.

Responsibility: consume only public engine/Foundation/Market Intelligence
contracts; preserve source IDs, lifecycle, correlation, and expiry; validate MI
truth through its public validator; explicitly report omitted upstream numeric
and scoring fields; accept exact financial strings only from a separately bound
caller source; and keep Volume without capital authority.

Non-responsibility: live singleton reads, rescoring, numeric conversion,
evidence generation, or runtime orchestration. Future owner: read-only engine/MI
adapters plus an exact economics/valuation source.

## Ports and future owners

No port has a runtime implementation in this namespace.

| Port/input seam | Input to Capital | Capital output | Future owner/adapter |
| --- | --- | --- | --- |
| `ProposalIntakePort` | Immutable canonical proposal | Capital intake/eligibility reference | Existing Basis/Volume engines plus Foundation canonical-proposal reader |
| `IntelligenceEvidencePort` | Evidence identity, kind, truth, and loss report | Evidence reference on consideration/thesis/topology | Market Intelligence evidence read model |
| `IntelligenceThesisPort` | Evidence-only hypothesis/stage/reasons | Thesis reference and position thesis binding | Market Intelligence thesis read model |
| `OutcomeReferencePort` | Observed outcome identity/context | Non-PnL contextual reference | Market Intelligence outcomes read model |
| `BorrowTruthPort` | Exact Foundation borrow truth | Account/Basis availability and cost evidence | Backend Foundation Borrow Truth |
| `ControlPosturePort` | Read-only pause/kill posture | New-risk block while reductions remain available | Backend Foundation control runtime |
| `RiskDecisionPort` | Plan-bound external risk decision | Bound risk reference on mandate/action/checkpoint | Backend Foundation multi-leg risk |
| `ExecutionStatePort` | Canonical plan lifecycle/correlation slice | Position/checkpoint execution reference | Backend Foundation execution coordinator read model |
| `ReconciliationStatePort` | Canonical reconciliation status/reference | Position/closure/restart/topology truth | Backend Foundation reconciliation read model |
| `CapitalPersistencePort` | Capital event envelope | Append result | Existing ledger/database event journal; a separate future reader supplies replay streams |
| Account snapshot inputs | Spot, USD-M, Margin, liabilities, valuations, reserves, commitments | `AccountCapitalProjection` | Future signed read-only private-account and valuation adapters |
| Economics component inputs | Fill, fee, funding, borrow, conversion, valuation facts | Exact economic report | Foundation/account fact adapters and existing ledger |
| Policy inputs | Budget, sizing, approval, stage, supervision, accounting policy | Content-addressed policy decision | Authenticated control API and trusted configuration distribution |
| Topology output | Pure domain state | `CapitalTopologySnapshot` | Future control API/canonical read model/cockpit |

## Cross-cutting invariants

- Financial values are canonical exact-decimal strings. Production contains no
  floating conversion or tolerance-based money comparison.
- Every time is caller-supplied and validated; there is no wall clock, timer, or
  random source.
- Content digests and revisions bind complete semantics and reject drift. They
  prove content integrity, not source authentication or signature authority.
- Missing, stale, partial, unavailable, malformed, or divergent truth blocks new
  or increasing exposure while retaining existing exposure and safe reduction,
  exit, hedge, and recovery intent.
- A bare risk verdict, approval boolean, stage boolean, lifecycle string, or
  closure assertion cannot mint authority.
- No Capital transition is execution-ready. Foundation owns final risk,
  execution, and reconciliation.
- Reservation claims are exclusive and replay-safe; terminal release is exact
  and can occur only once with complete canonical closure proof.
- Replay is deterministic, ordered, idempotent for exact duplicates, and rejects
  same-identity content conflicts or resurrection.
- Economic net is an exact included-component identity or explicitly
  incomplete/divergent; missing values never become zero.
- Topology blockers are materialized at the precise dependency and propagated to
  the position critical path without hiding exposed capital.
- Public vocabularies and projected collections are cloned, canonicalized, and
  frozen.

## Test inventory and counts

| Test module | Result | Principal coverage |
| --- | ---: | --- |
| `accountTruth/accountTruth.test.mjs` | 24/24 | Coherent cuts, pools, exactness, truth, valuation, borrow, de-duplication, immutability |
| `actions/actions.test.mjs` | 17/17 | Exact targets, authority, control asymmetry, reduction geometry, determinism |
| `allocation/allocation.test.mjs` | 50/50 | Scarcity, caps, ordering, sizing binding, double claims, TTL, replay, UTC |
| `allocation/reservation-closure.test.mjs` | 5/5 | Canonical closure proof, cross-chain/forgery/stale/legacy rejection, release once |
| `approvals/approvals.test.mjs` | 27/27 | Modes, scope, policy digest/effectivity, revocation, re-aging, idempotency |
| `budgets/budgets.test.mjs` | 18/18 | Account bridge, partition, policy, coverage, claims, counts, breaches |
| `checkpoint/checkpoint.test.mjs` | 21/21 | Payload/replay monotonicity, no resurrection, deep forgery, restart |
| `compatibility/compatibility.test.mjs` | 19/19 | Public adapters, float omission, bindings, MI validator, deep freeze |
| `contracts/contracts.test.mjs` | 30/30 | Decimal, IDs, truth, lifecycle, economics, actions, ports |
| `contracts/vocabulary.test.mjs` | 2/2 | Exported vocabularies are immutable and validators cannot widen |
| `economics/economics.test.mjs` | 22/22 | Policy digest, identity, completeness, no double count, provenance, dimensions |
| `opportunities/opportunities.test.mjs` | 36/36 | Structure, evidence, config, conflicts, policy, freshness, Volume mode |
| `positions/projection.test.mjs` | 39/39 | Exact projection and hostile external enum/reference/time/lifecycle cases |
| `scenarios/scenarios.test.mjs` | 30/30 | CS-01 through CS-30 cross-lane terminals |
| `stages/stages.test.mjs` | 25/25 | Configuration, plans, revisions, transitions, approval/mandate/gates |
| `supervision/supervision.test.mjs` | 44/44 | Runtime boundary, Basis/Volume, re-aging, control/recovery/add authority |
| `topology/topology.test.mjs` | 24/24 | Nodes, blockers, roots, hostile fields, locality, priority |
| **Total** | **433/433** | Serial full suite, reproduced twice |

Support-only modules are `checkpoint/officialMandateFixture.mjs`,
`scenarios/fixtures.mjs`, and `scenarios/harness.mjs`.

## Overlap analysis

- Existing Basis and Volume engines retain detection, confidence/score, proposal
  creation, lifecycle, invalidation, and market interpretation. Capital only
  adapts and consumes their public proposal views.
- Market Intelligence retains normalization, facts/features, thesis, outcomes,
  and intelligence topology. Capital consumes IDs/truth and explicitly drops
  unsafe numeric payloads.
- Backend Foundation retains control, hard risk verdicts, borrow truth, execution
  mechanics/lifecycles/correlation, and reconciliation. Capital reuses public
  types/guards and never self-approves, submits, or reconciles.
- The existing ledger/database retains durable truth. Capital defines pure event,
  reducer, checkpoint, and persistence-port contracts only.
- Future exchange adapters retain signed Spot/Futures/Margin reads, order/test
  order/cancel, borrow/repay, transfer/withdraw, and user-data authority. No such
  adapter exists or is invoked here.
- Capital uniquely owns cross-opportunity eligibility, conservative allocatable
  budget, economic reservation, staged mandate, scoped approval evaluation,
  active-position policy, economic intent, exact attribution composition,
  checkpoint projection, and active-capital topology.

The reuse audit therefore found no duplicate canonical owner and no need to edit
an existing owner.

## Required integration order

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

## Deliberately deferred work

1. Live market-data and durable state fabric.
2. Runtime composition across Market Intelligence, existing engines, Capital
   Supervision, and Backend Foundation.
3. Complete private Spot, USD-M, Margin, liability, fee, funding, borrow capacity,
   borrow cost, permission, and freshness truth.
4. Concrete guarded signed exchange adapters, including test order, order/cancel,
   borrow/repay, user-data events, and two-leg recovery, manually armed first.
5. Durable execution journal and reconciliation wiring to the existing
   ledger/database.
6. Real control API and the 40–70-box visual machine graph.
7. Offline replay and calibration lab with captured sequences and no-look-ahead
   promotion gates.
8. External watchdog, deployment, rollback, backup, retention, and protected
   operator access.
9. Final integration, security, and capital-promotion gates before any tiny
   manually approved capital test.

Green pure tests do not make the system money-ready. The entire namespace remains
**DORMANT / NOT WIRED**.
