# PARALLEL CAPABILITY FOUNDRY AND SENSE PACKS

**Project:** Cosmos Arbitrage Control Room  
**Directive type:** Parallel-safe capability prestage program  
**Purpose:** Use temporary high compute availability to build major optional “senses,” memory, experimentation, and audit capabilities without disturbing the active Q/L/I00 product assembly  
**Status:** `PRESTAGE_ONLY_UNTIL_I00_INTEGRATED_ACCEPTED`  
**Controlling authorities:** current accepted Mission, Q lane, L lane, I00, IP-ASSURANCE, and current Post-I00 AI Operations directive  
**Important:** This file does not create another strategy engine, another executor, another Risk system, another Capital allocator, another control plane, or another dashboard.

---

## 0. The ruling

The owner’s instinct is correct:

A working organism can survive with fewer senses, but additional well-designed senses, memory, and experimentation can materially improve what it can detect, explain, test, and learn.

The wrong response is to add random features directly into the active product while Q, L, I00, and assurance are still moving.

The correct response is:

```text
freeze stable contracts
→ build independent capability packs in isolated worktrees
→ prove each pack against fixtures and compatibility harnesses
→ leave each pack UNWIRED
→ integrate only after I00 accepts the canonical product
```

The immediate goal is not line count.

The goal is to create reusable, well-tested organs that:

- do not require current shared files;
- do not depend on private credentials;
- do not touch live money;
- do not create duplicate truth;
- can be abandoned without damaging the product;
- can be adapted later through a small integration adapter;
- improve sensing, replay, explanation, experimentation, or learning.

---

## 1. What is already covered and must not be rebuilt

### Q already owns

- point-in-time evidence;
- historical bootstrap;
- labels and matched controls;
- feature registry;
- microstructure;
- activity transition;
- derivatives and basis context;
- regime detection;
- anomalies and analogues;
- model battery;
- calibration;
- abstention;
- model registry;
- drift and retirement;
- advisory inference;
- external evidence expansion contract.

### L already owns

- private account truth;
- signing;
- exchange filters;
- rate budgets;
- journal and idempotency;
- exchange twin;
- order policy;
- normal basis;
- reverse basis;
- volume lifecycle;
- capital/risk integration;
- execution;
- positions;
- recovery;
- controls;
- machine graph;
- deployment proof.

### I00 already owns

- final composition root;
- shared wiring;
- canonical read model;
- command system;
- cockpit mounting;
- restart/reconciliation;
- deployment activation;
- combined acceptance.

### IP-ASSURANCE already owns

- expected inventory;
- no-false-green;
- safety invariants;
- remediation policies;
- Failure Atlas;
- telemetry coverage;
- external sentinel;
- fault campaigns.

### Post-I00 AI Operations already owns

- event-driven AI diagnosis;
- isolated code repair;
- independent verification;
- provider budgets;
- AI cockpit;
- approval and rollback;
- AI-plane failure containment.

No capability pack in this file may duplicate those owners.

---

# PART I — THE UNIVERSAL SOCKET

## 2. Why the socket matters

The owner’s “6A / 12A / 16A socket” analogy is correct.

Independent organs are only useful if they share stable mechanical and electrical interfaces.

The project therefore needs one additive extension contract kit that allows future modules to declare:

- what they consume;
- what they produce;
- what authority they do not have;
- what latency they expect;
- what data they require;
- how they fail;
- how they degrade;
- what resources they consume;
- how they are tested;
- how they appear in the cockpit;
- how they are disabled or removed.

This kit is not a runtime plugin loader and must not dynamically execute arbitrary packages.

It is a compile-time and integration-time compatibility standard.

## 3. Capability descriptor

```text
CapabilityDescriptorV1
- capabilityId
- displayName
- version
- ownerDomain
- capabilityClass
- implementationLanguage
- packagePath
- inputContracts[]
- outputContracts[]
- requiredCapabilities[]
- optionalCapabilities[]
- forbiddenAuthorities[]
- latencyClass
- freshnessRequirement
- completenessRequirement
- determinismClass
- replayClass
- resourceProfile
- dataClassifications[]
- licensing
- provenance
- failureModes[]
- degradationBehavior
- healthContract
- cockpitProjection
- testEntryPoints[]
- compatibilityRevision
- buildSha
```

## 4. Capability classes

```text
SOURCE_ADAPTER
EVIDENCE_PROCESSOR
FEATURE_PROVIDER
ADVISORY_ASSESSOR
REPLAY_PROVIDER
COUNTERFACTUAL_PROVIDER
SCENARIO_PROVIDER
LINEAGE_PROVIDER
EXPERIMENT_PROVIDER
VISUALIZATION_PROVIDER
LABELING_PROVIDER
RESOURCE_ADVISOR
```

No extension class may become:

```text
CAPITAL_OWNER
RISK_OWNER
EXCHANGE_MUTATION_OWNER
PRIVATE_TRUTH_OWNER
POSITION_OWNER
RECONCILIATION_OWNER
DEPLOYMENT_OWNER
ROOT_SUPERVISOR
```

## 5. Standard provider contracts

### 5.1 Evidence provider

```text
EvidenceProviderV1
- describeSource()
- health()
- coverage()
- fetchHistorical(bounds)
- subscribeForward(request)
- checkpoint()
- resume(checkpoint)
- normalize(record)
- provenance(record)
```

### 5.2 Derived feature provider

```text
DerivedFeatureProviderV1
- describeFeatureSet()
- requiredEvidence()
- computeBatch(request)
- computeStreaming(event)
- featureLineage()
- quality()
- replayParity()
```

### 5.3 Advisory assessor

```text
AdvisoryAssessmentProviderV1
- describeAssessment()
- evaluate(evidenceEnvelope)
- explain(assessmentId)
- calibrate(datasetRevision)
- shadowOnly()
```

### 5.4 Replay provider

```text
ReplayScenarioProviderV1
- describeScenarioSet()
- listScenarios(filter)
- materializeScenario(id)
- runScenario(request)
- compareRuns(a, b)
- exportTrace(runId)
```

### 5.5 Cockpit projection provider

```text
CockpitPanelProviderV1
- describePanel()
- requiredReadModelFields()
- renderContract()
- emptyState()
- unavailableState()
- syntheticState()
```

### 5.6 Experiment provider

```text
ExperimentProviderV1
- describeExperiment()
- assignTreatment(context)
- recordExposure()
- recordOutcome()
- stopRules()
- promotionRules()
```

## 6. Compatibility harness

Every pack must pass:

- schema compatibility;
- unknown-field behavior;
- version negotiation;
- missing dependency behavior;
- stale evidence behavior;
- resource exhaustion behavior;
- replay determinism;
- provider disable/remove test;
- cockpit unavailable-state test;
- no-authority test;
- no-secret test;
- no-live-network unit tests;
- exact package/path ownership.

## 7. Suggested additive paths

```text
extensions/contracts/**
extensions/testkit/**
extensions/manifests/**
extensions/generated/**
extensions/docs/**
```

The director maps these to actual current repository paths and may choose another additive root.

No shared root file may be edited by a capability worker.

---

# PART II — PACK A: UNIFIED PRODUCT TIME MACHINE

## 8. Why it is high value

Q has market replay.

L has an exchange twin and execution replay.

I00 has restart and fault acceptance.

Those are necessary but separate.

The missing high-value abstraction is a product-wide time machine that can reconstruct:

- market evidence;
- Q assessments;
- strategy decisions;
- opportunities;
- Capital and Risk decisions;
- command changes;
- exchange requests and responses;
- fills;
- positions;
- liabilities;
- recovery;
- configuration;
- code/model/data revisions;
- incidents;
- deployment events;
- cockpit state.

This is the system’s memory and forensic camera.

## 9. Canonical replay envelope

```text
ProductEventEnvelopeV1
- eventId
- correlationId
- causationId
- eventType
- domain
- entityId
- occurredAt
- observedAt
- logicalSequence
- producerRevision
- dataRevision
- configRevision
- modelRevision
- deploymentRevision
- evidenceSource
- liveReplaySynthetic
- payloadSchema
- payload
- provenanceHash
```

## 10. Required outputs

```text
PRODUCT_TIME_MACHINE_COMPONENTS.md
PRODUCT_EVENT_ENVELOPE_V1.md
PRODUCT_EVENT_CATALOG.md
REPLAY_CHECKPOINT_SCHEMA.md
REPLAY_SCENARIO_MANIFEST.md
REPLAY_TRACE_SCHEMA.md
PRODUCT_TIME_MACHINE_RECEIPT.md
```

Code:

```text
timeMachine/contracts/**
timeMachine/recorder/**
timeMachine/catalog/**
timeMachine/replay/**
timeMachine/trace/**
timeMachine/tests/**
timeMachine/fixtures/**
```

## 11. Initial scenario library

- cold start;
- public source disconnect;
- private source disconnect;
- stale account truth;
- basis candidate;
- reverse-basis borrow unknown;
- volume false burst;
- volume continuation;
- partial first leg;
- unknown order response;
- process crash;
- kill switch during entry;
- liability remains after close;
- deployment rollback;
- model revision change;
- control revision change;
- telemetry loss;
- AI provider outage.

## 12. Acceptance

- same event set replays to the same canonical state;
- snapshots and event replay reconcile;
- unknown/missing events remain visible;
- code/config/model/data revisions are preserved;
- replay never calls live exchange;
- live and replay states can never be confused;
- one selected replay can drive the existing cockpit fixture adapter;
- pack remains fully removable.

---

# PART III — PACK B: COUNTERFACTUAL AND DECISION-TWIN LAB

## 13. Why it is high value

A real system learns from more than trades it took.

It must also study:

- trades it rejected;
- trades it missed;
- trades it entered too early;
- trades it entered too late;
- different staged-entry choices;
- different exit choices;
- different Capital allocations;
- different order policies;
- no-trade outcomes.

Q already has labels and matched controls.

L already has execution simulation.

This pack joins them into one shadow-only counterfactual laboratory.

It never changes live decisions.

## 14. Counterfactual contract

```text
CounterfactualRunRequest
- sourceDecisionId
- frozenEvidenceRevision
- frozenMarketWindow
- frozenInstrumentSpec
- frozenCostModel
- alternativePolicyIds[]
- alternativeThresholdSets[]
- alternativeEntrySchedules[]
- alternativeExitSchedules[]
- alternativeExecutionPolicies[]
- randomSeed
- bounds
```

```text
CounterfactualResult
- runId
- sourceDecisionId
- alternativeId
- feasibility
- theoreticalOutcome
- simulatedExecutionOutcome
- costs
- maximumFavorableExcursion
- maximumAdverseExcursion
- timeInExposure
- residualLiability
- invalidationReason
- uncertainty
- evidenceLimitations
```

## 15. Required experiments

For every accepted, rejected, missed, and closed opportunity:

- no-trade;
- current policy;
- delayed entry;
- earlier/later exit;
- smaller/larger staged entry within fixed research bounds;
- passive-first versus taker-first;
- stricter versus looser evidence threshold;
- Q-assisted versus market-only;
- funding/borrow stress;
- worse latency;
- worse fill;
- one source removed;
- one feature family removed.

## 16. Causal honesty

The pack must not label hypothetical PnL as real profit.

Every result is one of:

```text
HISTORICAL_OBSERVED
REPLAY_SIMULATED
COUNTERFACTUAL_ESTIMATE
UNIDENTIFIABLE
DATA_INSUFFICIENT
```

## 17. Required outputs

```text
COUNTERFACTUAL_LAB_COMPONENTS.md
DECISION_TWIN_CONTRACT.md
POLICY_COMPARISON_REGISTRY.md
COUNTERFACTUAL_DATA_LIMITATIONS.md
COUNTERFACTUAL_LAB_RECEIPT.md
```

## 18. Acceptance

- never touches Capital/Risk/execution;
- replay provenance is complete;
- no future leakage;
- transaction costs and latency are explicit;
- unidentifiable outcomes remain unidentifiable;
- results link to source decision and evidence;
- output can feed Q research only through accepted advisory contracts.

---

# PART IV — PACK C: EXTERNAL SENSOR FABRIC

## 19. Why it is high value

The current product begins with Binance, but the Mission allows other sources when they materially improve:

- early detection;
- source disagreement;
- cross-venue leadership;
- borrow/funding truth;
- manipulation-risk filtering;
- event explanation;
- falsification.

Q already defines the external-evidence boundary.

This pack builds the reusable adapters and source governance, not another decision engine.

## 20. Source classes

```text
CROSS_VENUE_MARKET
OFFICIAL_EXCHANGE_EVENT
OFFICIAL_PROJECT_EVENT
DERIVATIVES_CONTEXT
ON_CHAIN_CONTEXT
TOKENOMICS_EVENT
NEWS_CONTEXT
SOCIAL_EXPERT_CONTEXT
MACRO_EVENT
BORROW_LENDING_CONTEXT
```

## 21. Source card

```text
DataSourceCardV1
- sourceId
- sourceClass
- owner
- license
- terms
- authentication
- transport
- instruments
- coverageStart
- coverageEnd
- forwardLatency
- timestampSemantics
- sequenceSemantics
- completeness
- knownGaps
- retention
- cost
- rateLimits
- dataClassification
- allowedUses
- prohibitedUses
- qualityChecks
- fallback
- health
- provenance
```

## 22. Initial adapters to build

Build adapters only where legal/public/licensed.

Recommended first set:

1. Binance historical bulk-data importer.
2. One read-only cross-venue public market adapter.
3. Official Binance announcement/event adapter.
4. Generic approved-news adapter contract with fixture provider.
5. Generic expert/social claim contract with fixture provider.
6. Generic on-chain provider contract with fixture provider.

Do not automate private Discord or restricted sources without authorization.

## 23. Normalized external evidence

```text
ExternalEvidenceEnvelopeV1
- sourceId
- sourceEventId
- receivedAt
- publishedAt
- sourceTimestamp
- assetIds[]
- evidenceClass
- structuredFacts
- claims
- confidenceFromSource
- independentVerificationState
- copiedOrDependentSourceGroup
- alreadyPricedEstimate
- expiry
- provenance
- rawReference
```

## 24. Source independence graph

The pack must detect likely dependence:

- copy/repost;
- same original announcement;
- same chart;
- same source URL;
- same publication cluster;
- same language/template;
- same upstream venue event.

Twenty copies do not count as twenty independent confirmations.

## 25. Required outputs

```text
EXTERNAL_SENSOR_FABRIC_COMPONENTS.md
DATA_SOURCE_CARD_V1.md
EXTERNAL_EVIDENCE_ENVELOPE_V1.md
SOURCE_INDEPENDENCE_GRAPH.md
SOURCE_LICENSE_AND_RETENTION_MATRIX.md
EXTERNAL_SENSOR_FABRIC_RECEIPT.md
```

## 26. Acceptance

- source-specific failures do not affect canonical Binance truth;
- external evidence is always advisory;
- missing licensing blocks use;
- timestamps and receipt latency are preserved;
- copied sources are grouped;
- source removal does not break Q;
- no external content can invoke tools or controls;
- pack has no private exchange authority.

---

# PART V — PACK D: LIVING SYSTEM GRAPH AND LINEAGE

## 27. Why it is high value

The codebase is too large for the owner or a fresh agent to understand by reading files manually.

The system needs one continuously generated graph connecting:

```text
mission requirement
→ authority
→ component
→ code
→ data source
→ feature
→ model
→ decision
→ command
→ execution
→ persistence
→ cockpit panel
→ test
→ incident
→ deployment
```

This is not another supervisor.

It is a searchable map of the machine.

## 28. Node types

```text
MISSION_REQUIREMENT
CAPABILITY
AUTHORITY
COMPONENT
SERVICE
ROUTE
COMMAND
CONTROL
DATA_SOURCE
DATASET
FEATURE
MODEL
STRATEGY
DECISION
OPPORTUNITY
TICKET
ORDER
POSITION
LIABILITY
RECOVERY
OUTCOME
FILE
PACKAGE
TEST
RECEIPT
INCIDENT
RUNBOOK
DEPLOYMENT
COCKPIT_PANEL
```

## 29. Edge types

```text
IMPLEMENTS
OWNS
CONSUMES
PRODUCES
DEPENDS_ON
CALLS
PERSISTS_TO
EXPOSES
CONTROLS
BLOCKS
VERIFIES
DEPLOYS
DERIVED_FROM
SUPERSEDES
FAILED_BY
RECOVERED_BY
VISIBLE_IN
```

## 30. Graph outputs

- machine-readable graph;
- static generated HTML explorer;
- missing-owner report;
- orphaned-code report;
- untested-capability report;
- hidden-control report;
- duplicate-authority report;
- mission-coverage report;
- dependency-impact query;
- fresh-agent onboarding bundle;
- cockpit drill-down contract.

## 31. Lineage law

Adopt the conceptual model of job, run, dataset, and extensible facets.

Do not require a heavy external lineage platform for the first implementation.

Start with:

- JSON/NDJSON lineage events;
- SQLite or local graph representation;
- generated views;
- deterministic tests.

## 32. Required outputs

```text
LIVING_SYSTEM_GRAPH_COMPONENTS.md
SYSTEM_GRAPH_SCHEMA.md
SYSTEM_LINEAGE_EVENT_SCHEMA.md
SYSTEM_GRAPH_GENERATOR.md
FRESH_AGENT_ONBOARDING_BUNDLE.md
LIVING_SYSTEM_GRAPH_RECEIPT.md
```

## 33. Acceptance

- every current component has an owner;
- every cockpit control maps to a backend command or NOT_WIRED;
- every required mission row maps to code/test/visibility or explicit blocker;
- every model maps to data/features/experiment;
- every deployment maps to source SHA;
- graph generation is deterministic;
- graph can be regenerated from repository truth;
- it does not become a runtime authority.

---

# PART VI — PACK E: EXPERIMENT, SHADOW, AND CANARY FOUNDRY

## 34. Why it is high value

The project needs a safe way to compare new ideas without rewriting production logic or turning every experiment into a new branch of permanent code.

The system already has Q champion/challenger and L canary concepts.

This pack generalizes them across:

- feature sets;
- models;
- ranking policies;
- thresholds;
- strategy policies;
- source adapters;
- execution policies;
- cockpit views.

## 35. Experiment contract

```text
ExperimentDefinitionV1
- experimentId
- hypothesis
- owner
- treatment
- control
- assignmentUnit
- inclusionRules
- exclusionRules
- start
- stop
- maximumExposure
- metrics
- guardrails
- sampleSizePolicy
- earlyStopRules
- promotionRules
- rollback
- dataRevision
- codeRevision
```

## 36. Modes

```text
OFFLINE_REPLAY
SHADOW
MIRROR
OWNER_GATED_CANARY
```

No experiment may directly introduce a new money authority.

## 37. Feature flag provider abstraction

Use a provider abstraction so the underlying flag source can change without rewriting experiment consumers.

Initial implementation may be local and version-controlled.

Do not install a feature-flag SaaS by default.

## 38. Required outputs

```text
EXPERIMENT_FOUNDRY_COMPONENTS.md
EXPERIMENT_DEFINITION_V1.md
EXPERIMENT_ASSIGNMENT_SCHEMA.md
SHADOW_RESULT_SCHEMA.md
EXPERIMENT_GUARDRAIL_SCHEMA.md
EXPERIMENT_FOUNDRY_RECEIPT.md
```

## 39. Acceptance

- deterministic assignment;
- no future leakage;
- experiment exposure is recorded;
- guardrails stop treatment;
- active-position supervision outranks experiments;
- experiment removal leaves baseline intact;
- promotion requires current authority;
- all results link to code/data/config/model revisions.

---

# PART VII — PACK F: OWNER AND EXPERT LABELING STUDIO

## 40. Why it is high value

The owner’s “smell” cannot be encoded if judgments remain only in chat.

A small labeling studio can collect:

- early/late;
- real/fake;
- continuation/exhaustion;
- obvious/noisy;
- good rejection/bad rejection;
- understandable/unknown;
- expert-source value;
- incident severity;
- repair quality.

This does not replace objective outcomes.

It creates a separate owner-annotation layer.

## 41. Annotation contract

```text
OwnerAnnotationV1
- annotationId
- targetType
- targetId
- owner
- createdAt
- labelSchema
- labels
- freeText
- confidence
- evidenceViewed
- outcomeVisibleAtAnnotation
- leakageClass
- revision
```

## 42. Expert-source calibration

For any followed analyst or external source:

- claim;
- publication time;
- receipt time;
- asset;
- horizon;
- condition;
- market state;
- already-moved amount;
- later outcome;
- incremental value over market-only baseline.

No fixed “trusted expert = +20% confidence” rule.

## 43. Required outputs

```text
OWNER_LABELING_STUDIO_COMPONENTS.md
OWNER_ANNOTATION_V1.md
EXPERT_CLAIM_SCHEMA.md
ANNOTATION_LEAKAGE_POLICY.md
OWNER_LABELING_STUDIO_RECEIPT.md
```

## 44. Acceptance

- owner labels never overwrite hard truth;
- labels record whether outcome was already known;
- expert performance is conditional by asset/horizon/regime;
- copied sources do not multiply confidence;
- annotations are versioned and removable;
- Q may consume labels only through accepted research paths.

---

# PART VIII — PACK G: ADVERSARIAL MARKET SCENARIO LIBRARY

## 45. Why it is high value

The project already has technical fault injection.

It also needs market-behavior stress fixtures:

- false breakout;
- one-print spike;
- slow accumulation;
- sudden liquidity withdrawal;
- funding jump;
- spot-led pump;
- perp-led move;
- cross-venue disagreement;
- liquidation cascade;
- repeated wake-and-fade;
- already-extended move;
- borrow disappears;
- spread explodes;
- market-wide correlation shock;
- regime change.

This pack extends the existing digital exchange twin and Q validation with reusable scenario definitions.

It does not create a new simulator.

## 46. Scenario contract

```text
MarketScenarioV1
- scenarioId
- economicDescription
- source
- instruments
- eventSequence
- bookBehavior
- tradeBehavior
- fundingBehavior
- openInterestBehavior
- borrowBehavior
- latencyBehavior
- expectedInvariants
- expectedStrategyPosture
- expectedRecoveryPosture
- seed
- provenance
```

## 47. Required outputs

```text
ADVERSARIAL_MARKET_SCENARIO_COMPONENTS.md
MARKET_SCENARIO_V1.md
MARKET_SCENARIO_LIBRARY.md
SCENARIO_EXPECTATION_MATRIX.md
ADVERSARIAL_MARKET_SCENARIO_RECEIPT.md
```

## 48. Acceptance

- deterministic seeds;
- scenario provenance;
- no claim that synthetic scenario proves profit;
- Q, strategy, Risk, execution, and recovery expectations are explicit;
- scenario library can run through existing replay/twin adapters;
- failures become named regression fixtures.

---

# PART IX — PACK H: RESOURCE AND ATTENTION ADVISOR

## 49. Why it is high value

The machine cannot process every symbol at maximum depth continuously.

The Mission already defines:

```text
Universe
→ Candidate
→ Focus
→ Opportunity
→ Active
```

This pack builds an advisory scheduler that measures and recommends how compute should be allocated.

It does not own the runtime scheduler until I00 explicitly adapts it.

## 50. Inputs

- event rates;
- queue depth;
- CPU/memory/disk;
- feature cost;
- model latency;
- candidate value;
- active exposure;
- recovery needs;
- source health;
- provider budgets;
- data-capture budgets.

## 51. Output

```text
AttentionBudgetRecommendation
- symbol
- currentTier
- recommendedTier
- reason
- expectedCompute
- expectedDataRate
- urgency
- capitalRelevance
- expiry
```

## 52. Permanent priority law

```text
active exposure
→ recovery
→ reconciliation
→ private truth
→ operator control
→ opportunity execution
→ focused analysis
→ candidate analysis
→ broad universe
→ optional research
```

## 53. Acceptance

- advisory only;
- never starves active exposure;
- deterministic fallback;
- resource model measured;
- degradation sequence explicit;
- removal leaves existing hierarchy intact.

---

# PART X — WHAT TO BUILD NOW

## 54. Highest-value immediate packs

Build now:

1. **Universal Socket / Capability Contracts**
2. **Unified Product Time Machine**
3. **Living System Graph and Lineage**
4. **Counterfactual and Decision-Twin Lab**
5. **External Sensor Fabric prestage**
6. **Experiment/Shadow Foundry prestage**

These are independent enough to build while Q/L/I00 continue.

## 55. Build after the above stabilize

7. Owner/Expert Labeling Studio
8. Adversarial Market Scenario Library
9. Resource and Attention Advisor

## 56. Do not build now

- another Basis engine;
- another Volume engine;
- another Q brain;
- another L executor;
- another Risk gate;
- another ledger;
- another root supervisor;
- another control room;
- another AI Ops plane;
- a new live exchange adapter that signs orders;
- a large distributed platform merely for prestige;
- an LLM hot-path trader;
- dynamic loading of arbitrary third-party plugins.

---

# PART XI — FRAMEWORK INTAKE

## 57. Adopt concepts, not complexity

### OpenFeature-style provider abstraction

Useful for:

- swappable experiment/feature providers;
- consistent evaluation API;
- domain-scoped providers;
- no-op defaults;
- multi-provider compatibility.

Initial classification:

```text
ADAPT_CONCEPTS
```

### OpenLineage-style lineage model

Useful for:

- jobs;
- runs;
- datasets;
- extensible facets;
- interoperability.

Initial classification:

```text
ADAPT_CONCEPTS
```

### Feast-style feature contracts

Useful for:

- consistent offline/online feature schemas;
- point-in-time historical retrieval;
- streaming/batch feature sources;
- feature services and lineage.

Initial classification:

```text
REFERENCE_AND_ADAPT
```

Do not install Feast automatically.

### MLflow-style registry

Useful for:

- model lineage;
- versions;
- tags;
- champion/challenger aliases;
- controlled promotion and rollback.

Initial classification:

```text
REFERENCE_AND_ADAPT
```

Do not make MLflow a runtime dependency until measured.

### Temporal-style durable workflows

Useful for:

- long-running replayable workflows;
- event history;
- crash-resume;
- durable activities.

Current project already has durable state machines.

Initial classification:

```text
REFERENCE_ONLY_UNTIL_GAP_PROVED
```

### Flink-style stateful streaming

Useful for:

- event-time;
- checkpoints;
- replay;
- stateful stream processing;
- backpressure monitoring.

Initial classification:

```text
REFERENCE_ONLY_UNTIL_CAPACITY_GAP_PROVED
```

Do not replace the current Node/TypeScript runtime automatically.

### ClickHouse / Iceberg

Useful for:

- high-volume time-series analytics;
- historical trends;
- immutable snapshots/time travel;
- large replay datasets.

Initial classification:

```text
OPTIONAL_STORAGE_EVALUATION
```

Start with current storage plus Parquet/DuckDB-compatible outputs unless measured scale requires more.

### NautilusTrader

Useful as:

- an external reference implementation;
- a compatibility oracle for backtest/replay concepts;
- execution realism comparison;
- event-driven architecture reference.

Initial classification:

```text
REFERENCE_ONLY
```

Do not replace Q/L with it.

---

# PART XII — PARALLEL WORKTREE PLAN

## 58. Worktrees

Suggested:

```text
capability-contracts-<date>
product-time-machine-<date>
counterfactual-lab-<date>
external-sensor-fabric-<date>
living-system-graph-<date>
experiment-foundry-<date>
owner-labeling-<date>
market-scenarios-<date>
attention-advisor-<date>
```

Each starts from the director-selected frozen protocol/canonical base.

## 59. One-writer law

Each worker writes only its pack root, tests, generated fixtures, state, and receipt.

Never touch:

```text
server/src/index.ts
server/src/types.ts
server/src/ledger.ts
package.json
package-lock.json
web/src/App.tsx
web/src/store.tsx
web/src/styles.css
current Q paths
current L paths
current I00 paths
current AI Ops paths
```

## 60. Worker loop

```text
read authority
→ verify base
→ freeze scope
→ implement contracts
→ implement fixture provider
→ focused tests
→ adversarial tests
→ compatibility harness
→ docs
→ receipt
→ commit
→ stop
```

## 61. Required state file

Every worktree maintains:

```text
PACK_BUILD_STATE.md
- pack
- baseSha
- currentSha
- scope
- owner
- completed
- tests
- blockers
- external assumptions
- next exact step
```

## 62. Required receipt

```text
PACK_ACCEPTANCE_RECEIPT.md
- changed paths
- contracts
- tests
- fixture coverage
- authority proof
- secret scan
- network scan
- determinism
- remove/disable test
- performance
- limitations
- integration request
- commit Sha
```

---

# PART XIII — ACCEPTANCE LAW

## 63. A pack is not active merely because it compiles

Allowed statuses:

```text
DESIGNED
PRESTAGE_READY
COMPATIBILITY_PROVED
DIRECTOR_REVIEWED
ADAPTER_READY
WIRED_SHADOW
WIRED_ACTIVE
REJECTED
DEFERRED
```

Only I00 or a later accepted integration authority may mark:

```text
WIRED_SHADOW
WIRED_ACTIVE
```

## 64. No speculative truth

Every pack must visibly label:

```text
LIVE
REPLAY
SYNTHETIC
REFERENCE
UNAVAILABLE
UNKNOWN
```

## 65. Removal proof

For every pack prove:

- the product runs without it;
- no shared state becomes orphaned;
- no active authority depends on it;
- cockpit shows unavailable cleanly;
- package can be deleted without breaking core tests.

## 66. Performance proof

Every pack reports:

- CPU;
- memory;
- disk;
- network;
- queue/backpressure;
- storage growth;
- p50/p95/p99 latency;
- degradation behavior;
- maximum safe input rate.

---

# PART XIV — EXACT DIRECTOR ORDER

## 67. Director prompt

```text
Read PARALLEL_CAPABILITY_FOUNDRY_AND_SENSE_PACKS.md completely.

This is a parallel prestage program, not another product rewrite. Preserve every
active Q/L/I00/IP/AI-Ops writer. Do not modify Main or shared files. Do not create
duplicate Capital, Risk, execution, ledger, supervisor, control, deployment, or
AI-Ops authorities.

First produce CAPABILITY_PACK_DEDUP_MATRIX.md against the actual repository and
accepted directives. Classify each pack and sub-capability as REUSED, EXTENDED,
MISSING, DUPLICATE, DEFERRED, or NOT_APPLICABLE.

Build the Universal Socket contract/test kit first. Freeze its accepted SHA.

Then create isolated worktrees for the approved high-value packs:
- Unified Product Time Machine
- Living System Graph and Lineage
- Counterfactual and Decision-Twin Lab
- External Sensor Fabric prestage
- Experiment/Shadow Foundry prestage

Use one writer per worktree. Each pack may write only to its additive root, tests,
fixtures, state, receipts, and integration request. No shared-file edits, no live
exchange access, no secret reads, no money authority, no deployment, no browser
mounting, and no direct Q/L/I00 edits.

Require every pack to:
- implement stable contracts;
- include a deterministic fixture provider;
- pass compatibility, replay, security, remove/disable, resource, and no-authority
  tests;
- produce PACK_BUILD_STATE.md and PACK_ACCEPTANCE_RECEIPT.md;
- commit and stop cleanly.

Classify frameworks as ADOPT, ADAPT, REFERENCE_ONLY, OPTIONAL_EVALUATION, or REJECT.
Do not install Temporal, Flink, Feast, MLflow, ClickHouse, Iceberg, OpenFeature,
OpenLineage, NautilusTrader, or any other platform merely because it is mentioned.

After the current canonical product reaches INTEGRATED_ACCEPTED, the director may
adapt accepted packs one at a time through explicit integration requests and
shadow acceptance. Until then, every pack remains PRESTAGE_READY or
COMPATIBILITY_PROVED.

Do not return planning only. Return:
- actual dedup matrix;
- Universal Socket worktree and SHA;
- approved worktrees;
- exclusive paths;
- current writer for each;
- next acceptance event;
- blockers;
- exact commits.
```

---

# PART XV — FINAL DECISION

## 68. What this program buys

If executed correctly, the project gains:

- a standard way to add future senses without rewiring the whole machine;
- a full forensic time machine;
- counterfactual learning from decisions not taken;
- external data and context adapters;
- a living graph of the entire system;
- a safe experiment/canary framework;
- structured owner/expert feedback;
- adversarial market scenarios;
- advisory compute allocation.

## 69. What it does not buy

It does not guarantee:

- profit;
- perfect predictions;
- a proprietary institutional strategy;
- unlimited capacity;
- error-free integration;
- safe use of arbitrary third-party code;
- a reason to skip I00.

## 70. The correct use of temporary unlimited compute

Spend temporary compute on assets that remain valuable even if integration waits:

- contracts;
- adapters;
- fixture corpora;
- replay scenarios;
- compatibility tests;
- lineage manifests;
- source cards;
- labels;
- counterfactual runs;
- adversarial scenarios;
- receipts;
- performance measurements.

Do not spend it creating random tightly coupled code that only one unfinished
branch can understand.

The lasting advantage is not maximum code volume.

It is maximum tested optionality.
