# IP-ASSURANCE — Reliability and Cockpit Completeness

**Status:** subordinate integration packet; never a controlling product program  
**Authority:** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`  
**Purpose:** make resilience, safety invariants, telemetry completeness, independent proof, and owner-visible self-healing machine-checkable before I00 can claim that green is trustworthy  
**Not:** another strategy brain, Risk engine, Capital authority, executor, ledger, dashboard shell, deployment system, or permission to use private/external/live capabilities

---

## 1. Why this packet exists

The current product program already names lifecycle, health, retries, recovery, a machine graph, controls, incidents, chaos tests, deployment, and a cockpit.

The remaining blind spot is **coverage**:

```text
ten reporting components may look green
while an expected eleventh component never reports at all
```

The system therefore needs one formal assurance layer that proves:

- every expected capital-critical component and dependency exists;
- every external operation has an explicit retry/idempotency/reconciliation/circuit law;
- every safety invariant is continuously evaluated;
- every important failure has telemetry, an incident, containment, recovery, and an owner-visible trace;
- the monitoring pipeline and cockpit are themselves monitored;
- one independently probed critical path agrees with self-reported health;
- only one fenced runtime may mutate capital;
- overall green is impossible when required evidence is missing, stale, silent, incompatible, or unknown.

This packet may prepare those capabilities in additive paths. Only the I00 director mounts them into shared composition, persistence, routes, pages, deployment, and final acceptance.

---

## 2. Entry and collision gate

Before writing:

1. Read current `MISSION.md`, I00, canonical architecture/authority map, Q/L protocols and accepted build-state/receipts, `docs/DASHBOARD_TRUTH.md`, and all accepted IP packet receipts.
2. Verify actual worktree, branch, HEAD, ancestry, status, and exclusive path ownership.
3. Record accepted donor SHAs and protocol/schema revisions.
4. Search for existing retry policies, circuit breakers, exchange schedulers, time/clock owners, fencing leases, invariant monitors, telemetry exporters, watchdogs, and machine inventory manifests.
5. Reuse/adapt accepted owners. Do not duplicate them under new names.

If any active writer owns a proposed path, choose a new additive path or stop only that conflicting subpart. Continue every collision-free item.

Allowed additive territory, adjusted only by the director to actual repository conventions:

```text
server/src/productAssurance/**
server/test/productAssurance/**
test/productAssurance/**
fixtures/productAssurance/**
```

Forbidden writes:

```text
quant/**
live-edge-receipts/**
server/src/liveEdge/**
accepted dashboard-shell donor paths
server/src/productIntegration/** while IP-RUNTIME owns it
web/src/features/productControlRoom/** while IP-CONTROL owns it
ops/i00/** while IP-OPS owns it
server/test/i00Acceptance/** while IP-PROOF owns it
startup/composition roots
existing routes
existing persistence/migrations
root packages/lockfiles
App/router/store/navigation/pages/shared styles
current-main
external AWS/Cloudflare/Binance/secrets/services/capital
```

Any shared need becomes a precise `ASSURANCE_INSERTION_REQUEST.md` row with owner, target seam, reason, contract, tests, and expected behavior. Do not make a “temporary” shared edit.

Keep generator/template output and insertion requests under `fixtures/productAssurance/generated/**`; keep packet state/receipt under `fixtures/productAssurance/receipts/**`. The I00 director alone emits final root/current-main closure artifacts.

---

## 3. Required outputs

### 3.1 Machine-readable operation policy registry

Define one versioned schema and registry covering every external call, stream, queue consumer, database action, inference request, command, exchange action, and deployment operation.

Operation classes:

```text
PURE_READ
REPLAYABLE_SUBSCRIPTION
IDEMPOTENT_COMMAND
NON_IDEMPOTENT_MUTATION
MULTI_LEG_SAGA
RISK_REDUCING_RECOVERY
```

Each operation records:

```text
stable operation ID
canonical owner and implementation path
deadline/timeout
transient/permanent/ambiguous errors
maximum attempts
backoff/jitter and total retry-time budget
rate-budget/cooldown behavior
idempotency identity and lifetime
authoritative reconciliation lookup
circuit open/half-open/reset law
concurrency/bulkhead limit
poison-event quarantine
fallback/failover eligibility
degraded/blocked result
durable restart checkpoint
automatic remediation allowed
operator escalation/control/runbook
metric, trace, material event, incident, cockpit location, and fault test
```

The scanner must identify unregistered production network/stream/queue/database/mutation paths and emit an exact uncovered list.

Blind retry of a possibly accepted mutation is forbidden. `UNKNOWN_SUBMISSION` and equivalent ambiguity must resolve through durable identity and authoritative reconciliation.

### 3.2 Expected-inventory and telemetry-coverage manifest

Build a versioned manifest derived from accepted composition, authority, capability, control, and deployment registries.

Required projections:

```text
expected component and dependency IDs
discovered component and dependency IDs
instrumented/current/stale/silent/unavailable/missing counts and IDs
expected/live/disabled/unimplemented controls
telemetry schema compatibility
last complete correlation trace
last independent black-box probe
unobserved capital-critical dependencies
observability coverage percentage
```

Coverage is calculated from expected inventory, never from reporters only.

Add a coverage scanner mapping every managed component, invariant, failure mode, operation policy, and owner-required question to metric, structured log, ledger/material event, trace, incident, freshness/hysteresis, missing-data law, severity, cockpit surface, repair/control, fixture, and proof.

### 3.3 Read-only safety-invariant evaluator

Define a versioned invariant schema and pure evaluator over canonical snapshots. It emits pass/fail/unknown plus evidence; it never edits domain state or becomes a second Risk authority.

Minimum invariant families:

- durable intent and mutation identity;
- execution fencing epoch;
- reconciliation before new exposure;
- public/private freshness, completeness, continuity, and temporal coherence;
- local versus exchange order/fill/position/liability truth;
- reservation, exposure, loss, leverage, concentration, and recovery reserve;
- halt/kill coverage of all risk-increasing routes;
- risk-reducing cancel/close/recovery/repay availability;
- one exchange hand and one active execution lease;
- withdrawal/transfer impossibility;
- live/synthetic/replay/unknown truth separation;
- instrument filters, clock, account mode, permission, leverage, and margin-mode compatibility;
- rate-budget reserve for reconciliation/risk reduction;
- ledger/database/event/supervisor/telemetry advancement;
- build/config/schema/model/protocol compatibility;
- expected critical inventory and telemetry completeness;
- backup/watchdog/independent-probe freshness.

Each invariant records owner, expression, evidence, cadence, severity, capital relevance, missing-data behavior, fail-safe action, incident, cockpit surface, repair/control/runbook, and adversarial test.

Critical `UNKNOWN` blocks trade readiness exactly like failure.

### 3.4 Durable remediation projection

Define pure contracts and fixtures for safe self-healing campaigns:

```text
RECONNECT
RESUBSCRIBE
RESNAPSHOT_SEQUENCE_GAP
ROTATE_STREAM
RESYNC_CLOCK
REFRESH_FILTERS
FAILOVER_ACCEPTED_SOURCE
RATE_LIMIT_COOLDOWN
QUARANTINE_POISON_EVENT
RESTART_BOUNDED_WORKER
RECOVER_DB_CHECKPOINT
INVALIDATE_CACHE
RECOVER_TELEMETRY_EXPORT
WATCHDOG_RESTART
MAINTENANCE_DRAIN
```

Every attempt records stable ID, cause, policy revision, attempt/budget, before state, action, after state, result, next retry, circuit state, material-event/ledger reference, and cockpit trace. Restart cannot erase an unfinished campaign.

Automatic remediation cannot increase capital authority, raise a risk limit, clear liability/ambiguity, mark a source healthy manually, or hide an incident.

Automatic policies cover only in-process/supervised local child-worker actions already owned by the canonical Control Plane command registry. A system service/host/deployment/configuration/AWS/Cloudflare/Secrets/external-environment mutation always remains I00 §20 owner-authorized; this packet only models its proposal, proof, and blocked state.

Add the explicit reconcile lifecycle:

```text
DETECTED -> CONTAINING -> DIAGNOSING -> PLANNED -> EXECUTING -> VERIFYING -> RECOVERED
or -> AWAITING_AUTHORIZATION -> AUTH_REJECTED_OR_EXPIRED
or -> CANCELLING -> SUPERSEDED
or -> ROLLING_BACK -> COMPENSATED
or -> ROLLING_BACK -> COMPENSATION_FAILED
or -> QUARANTINED -> FAILED_ATTENTION_REQUIRED
```

Each managed component and remediation policy records desired, observed, last-known-good and allowed-degraded state; dependencies and invariants; trigger evidence; failure fingerprint; diagnostic confidence; preconditions; maximum scope; capital posture; predicted result; action identity/fencing owner; local/global attempt, time, cost and concurrency budgets; rollback/compensation; independent postconditions; quiet/hysteresis period; promotion-to-healthy law; and escalation/quarantine law.

Action completion never equals recovery. `RECOVERED` requires independent readback and stable postconditions. Fence repair campaigns by exclusive resource lease; multi-resource campaigns atomically acquire an ordered set or do not start. A repair-conflict graph prevents different fingerprints from acting concurrently on one resource. Reject stale completion after lease expiry/handoff; prevent conflicting repairs, alternating loops, and restart/resnapshot/failover storms; reserve reconciliation/risk-reduction capacity; and never close a circuit solely from the repaired producer's self-report.

This packet builds contracts, pure evaluation, fixtures, render-neutral view models, and insertion requests only. The runtime controller is mounted by I03 through the canonical Control Plane and command registry; campaign persistence is integrated by I04 into existing DB/ledger owners; I08 owns the active supervisor projection. IP-ASSURANCE never creates a second desired state, command authority, executor, incident store, or persistent database.

### 3.5 Operational truth adapters

Build narrow pure ports/adapters or insertion requests for existing owners:

- one aggregate exchange rate-budget gateway with risk-reducing priority reserve;
- time/temporal-coherence projection including host and exchange offset, monotonic deadlines, event/receive/process/send/ack times, cross-market skew, and continuity watermark;
- execution lease/fencing projection with epoch, process/release identity, renewal/expiry, and stale-owner rejection;
- independent sentinel projection over public source, private truth when configured, engine snapshot, ledger/event cursor, DB read/write, cockpit delivery, command round-trip, deployed SHA, backup, and telemetry;
- telemetry-pipeline health including queue, drops, retries, persistent buffer/WAL, last export, retention, and schema compatibility.

Do not build a second exchange client, clock, executor, supervisor, or telemetry platform. Adapt accepted owners and return insertion requests where shared wiring is required.

### 3.6 Cockpit assurance package

Against fixtures and accepted read contracts, build additive render-neutral view models/adapters for IP-CONTROL to render:

1. five-second safety invariants;
2. expected-versus-observed inventory/dependency/control coverage;
3. retry/circuit/cooldown/fallback/remediation state;
4. exchange rate-budget and emergency reserve;
5. temporal coherence and stream continuity epochs;
6. active execution lease/fencing owner;
7. money-mutation lifecycle and ambiguity/reconciliation timeline;
8. telemetry-pipeline health and last independent proof;
9. out-of-band watchdog/notification state;
10. incident cause/effect and correlation drill-down.
11. bounded autonomic campaign and optional agentic-diagnostics trace, permissions, cost, approval, verifier, postcondition, and outage state.

No flat thousand-gauge wall. Use top-level actionable annunciators and progressive drill-down. No state appears green solely because its producer reported an object.

Do not mount into App/store/router/pages. Return exact insertion notes to the director.

### 3.7 Fault-injection fixtures and harness

Prepare deterministic campaigns for:

- request accepted but response lost;
- duplicate/missing/delayed/out-of-order event;
- stream rotation, server shutdown, ping/pong failure, reconnect storm;
- local-book sequence gap and resnapshot;
- Spot/USD-M temporal skew;
- stale clock and excessive server offset;
- throttle, ban, overload, and cooldown;
- lost borrow/repay response;
- partial fill of either leg and lost cancel acknowledgement;
- DB failure before and after external mutation;
- process death at every mutation transition;
- two simultaneous executor processes;
- disk full/WAL/log growth;
- telemetry exporter failure and dropped records;
- Secrets/KMS/permission failure;
- stale filter/account mode/leverage/margin-mode change;
- Cloudflare/dashboard disconnect and cursor resume;
- app/host/tunnel/watchdog loss;
- backup/restore/rollback with incomplete recovery.
- conflicting repair campaigns, atomic multi-resource conflict, retry amplification, restart storm, alternating repair loop, controller crash at every campaign transition, lease expiry/handoff with stale completion, lost/corrupt campaign record, rollback/compensation failure, common-mode verifier/telemetry false proof, failed postcondition, and false self-reported healthy state;
- malicious log/market/news/retrieval text, prompt injection, tool escalation, hallucinated diagnosis, stale evidence, provider outage, cost exhaustion, failed patch verification, and attempted money mutation by a diagnostic agent.

Each fixture proves containment, exact root cause, no duplicate mutation, no lost liability, preserved risk reduction, correct readiness, durable remediation, and visible cockpit truth.

### 3.8 Runtime-assurance and operational failure corpus

Define pure fixtures for an advanced-controller/safety-kernel decision gate. Q, learned models, adaptive challengers, and optional LLM advice are advanced controllers. Capital, Risk, fencing, exchange reconciliation, hard ceilings, halt/kill, and risk-reducing recovery remain the deterministic safety kernel. Any unavailable, drifting, contradictory, insufficient, temporally incoherent, or unsafe advanced output must deterministically fall back to no new exposure while reconciliation, supervision, evidence, and bounded risk reduction continue.

Prepare an operational Failure Atlas schema populated from actual test/fault/soak/incident evidence. It is a sanitized, retention/access-controlled, stable-ID/deduplicated read projection over existing canonical incident/ledger/material-event/test/soak/postmortem evidence, never a second store or hand-maintained Markdown truth:

```text
failure fingerprint and exact timeline
component/dependency and revisions
trigger, symptoms, and failed invariant
capital/exposure/liability/ambiguity impact
containment and repair attempts
successful/false repair and independent postconditions
root/contributing causes
regression fixture and fault seed
playbook/model revisions
reviewer/postmortem/actions/recurrence
```

### 3.9 Subordinate LLM diagnostic-plane boundary

Build additive contracts, strict schemas, deterministic stubs, redaction/provenance fixtures, permission evaluation, audit projection, cost/rate budgets, and adversarial tests for an optional diagnostic plane. Do not call a real provider, add secrets, or give it runtime authority in this packet.

Hierarchy:

```text
deterministic redacted incident bundle
-> deterministic sentinel/invariant truth
-> read-only triage agent
-> typed RemediationProposal
-> isolated replay/test/fault verifier
-> human/director approval for patch/config/merge/deploy
-> canonical deterministic command/remediation controller
-> independent readback/rollback/escalation
-> incident/regression/postmortem record
```

Permission levels are `OBSERVE_EXPLAIN`, `BOUNDED_QUERY_REPLAY`, `PROPOSE_TYPED_ACTION`, `PATCH_ISOLATED_AND_TEST`, and `OWNER_APPROVED_HANDOFF_FOR_NON_MONEY_MERGE_OR_DEPLOY`. No agent may sign/cancel/order/borrow/repay/change leverage or margin mode/transfer/withdraw/reserve/change Capital or Risk/change hard ceilings/write Main or production persistence/edit its guardrails or permissions/use arbitrary shell or network/merge or deploy autonomously/delete evidence/declare recovery. The diagnostic plane never executes an operational action; the deterministic controller may act only when its registered policy is independently satisfied without relying on the model proposal.

Treat logs, symbols, market/news/exchange text, issues, pages and retrieved documents as untrusted data. Keep instructions separate, validate normalized schemas, hash raw evidence outside the prompt, apply blocking tool guardrails and capability checks, require approval, and test prompt/tool injection. Provider unavailability must yield `DIAGNOSTIC_PLANE_UNAVAILABLE` without changing product readiness, deterministic safety, or execution.

Every approval binds exact artifact/action, environment, immutable hash, policy revision, capability, maximum effect, expiry, rollback, and approver. Every agent run records provider/model/version, prompt/policy revision, evidence hashes/provenance, retrieval IDs, typed output, tool inputs/results, approvals, diff, tests, postconditions, token/cost/latency budget, incident/correlation ID, and disposition.

---

## 4. Mandatory generated closure artifacts

This packet pre-stages generators/templates and fixture evidence for:

```text
RELIABILITY_POLICY_REGISTRY.md
SAFETY_INVARIANT_CATALOG.md
TELEMETRY_COVERAGE_MATRIX.md
OUT_OF_BAND_RECOVERY_REPORT.md
FAULT_INJECTION_AND_SOAK_REPORT.md
OPERATIONAL_FAILURE_ATLAS.md
AGENTIC_DIAGNOSTIC_BOUNDARY.md
ASSURANCE_INSERTION_REQUEST.md
IP_ASSURANCE_RECEIPT.md
```

Only final I00 real-runtime/browser/deployment evidence may mark them integrated or proven.

---

## 5. Tests and acceptance

Tests are deterministic, network-free, secret-free, and clock-injected.

Required focused proof:

- every fixture operation has a valid policy;
- uncovered production operation scanner reports exact paths;
- ambiguous mutation forbids blind retry;
- retry budget and circuit transitions are bounded;
- risk-reducing work outranks optional work under rate saturation;
- missing expected component/edge/control/telemetry blocks overall green;
- silent and stale remain distinct;
- critical invariant unknown blocks trade readiness;
- duplicate executor loses the fencing race;
- cross-market skew invalidates a decision;
- sequence gap requires resnapshot/continuity proof;
- remediation attempts survive restart and exhaust visibly;
- telemetry-pipeline failure is visible without losing ledger evidence;
- self-reported green disagrees with sentinel failure and overall posture degrades;
- notification/watchdog fixture requires delivery receipt;
- repaired action cannot become recovered before independent postcondition and quiet-period proof;
- two repair owners affecting the same resource cannot execute concurrently, regardless of fingerprint, and multi-resource acquisition is atomic;
- controller crash/restart at every campaign transition preserves state, and an expired/handoff owner cannot apply or report a stale completion;
- rollback/compensation and common-mode verifier/telemetry failures remain visible and cannot promote healthy;
- authorization wait/reject/expiry, cancellation/supersession, rollback/compensation, and compensation failure survive restart with unambiguous cockpit state;
- an unsafe/unavailable advanced controller falls back to deterministic no-new-exposure posture;
- untrusted evidence cannot issue instructions or expand a diagnostic agent's tools;
- a diagnostic agent cannot request or execute money, Risk, Capital, secret, Main, autonomous merge/deploy, or evidence-deletion actions;
- diagnostic provider outage/cost exhaustion leaves deterministic product behavior unchanged and visible;
- cockpit assurance components label every fixture source and wiring state honestly;
- no import from Q/L/exchange clients creates a duplicate authority;
- path-scope and import-purity scans pass.

Packet acceptance state:

```text
ASSURANCE_PRESTAGE_READY
```

It must never claim:

```text
INTEGRATED
LIVE
DEPLOYED_PROVED
I00_ACCEPTED
```

Acceptance requires a clean packet worktree, focused tests, build/typecheck as applicable, adversarial self-review, immutable receipt, exact insertion requests, and no external mutation.

---

## 6. Exact worker prompt

```text
Read IP_ASSURANCE.md and the current I00 reliability closure completely. You are
one subordinate assurance packet builder, not a product director. Verify actual
Git state, accepted protocols/donor SHAs, current writers, and exclusive paths
before editing. Reuse accepted canonical owners and build only additive assurance
contracts, registries, pure evaluators/projections, fixtures, render-neutral
assurance view models, focused fault harnesses, generators, and director-owned insertion
requests under the packet-local generated/receipt paths in §2. Do not emit final
root closure documents. Do not edit Q/L, other IP packet paths, startup, routes, persistence,
packages, App/store/router/pages/styles, Main, secrets, AWS/Cloudflare/Binance, or
capital. Do not create a second Risk, Capital, exchange, clock, supervisor,
telemetry, dashboard, ledger, or control authority. Run deterministic focused
tests, adversarially attack false-green/retry/ambiguity/fencing/coverage behavior,
commit only clean accepted packet work, write the immutable receipt, and stop at
ASSURANCE_PRESTAGE_READY or one exact BLOCKED path. Begin implementation now.
```

---

## 7. Director-accepted systemic deltas (folded per SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md, D-LAUNCH-8, 2026-07-13)

The following amendment requirements are ACCEPTED and binding for the IP-ASSURANCE worker, exactly as scoped by the dedup matrix at `fixtures/productAssurance/generated/SYSTEMIC_ASSURANCE_DEDUP_MATRIX.md` and by amendment §11's path/owner map (packet-local `fixtures/productAssurance/systemic/**` + matching `test/productAssurance/systemic/**` subtrees only):

- S1 hazard/assumption projection + Atlas expected-family denominator (amendment §2);
- S2 action-safety evidence envelope, PASS/FAIL/UNKNOWN only, never authority (amendment §3);
- S3 bounded critical-protocol models + triage + conformance law; tooling by insertion request (amendment §4);
- S4 derived read-only claim graph with producer/verifier independence and expiry invalidation (amendment §5);
- S5 observability conservation, release-bound expected manifest, panel contract, five-level projections into existing I00 §15 surfaces, SLO law (amendment §6);
- S6 narrow extensions only: external deny-by-default sandbox, trace privacy/independent retention, Class A–D promotion law, repair-evidence law, corpus governance — the base §3.9 hierarchy is REUSED, no second LLM runtime (amendment §7);
- S7 read-only accepted-Q coverage matrix generator + independence/holdout UNKNOWN laws; never writes quant/** (amendment §8);
- S8 cancellation semantics, repair/control-loop contract, cost/resource evidence without throttling authority (amendment §9);
- amendment §10 scenarios 1–26 as IP-PROOF insertion-request fixtures;
- handoff §4 residuals 1–4 as narrow rows; §4.5 already covered by I00 law.

The amendment source is archived as superseded provenance; no worker reads it. This section widens no path beyond §2 + amendment §11 and creates no new authority.

### 7.1 Class A–D self-correction taxonomy (director-folded owner law, D-LAUNCH-13)

Folded verbatim-in-substance from the superseded amendment §7.5–7.6 as the binding owner definition:

**Class A — automatically eligible only when already registered.** Only an already-registered deterministic, local, non-capital Control Plane command class may be automatically executed (examples: reconnect, resubscribe, bounded resnapshot, bounded cache rebuild, bounded child-worker restart, diagnostic collection). Each class requires: deterministic trigger; preconditions; attempt/rate/resource budget; fencing; idempotence/replay safety where applicable; reconstructibility or a declared compensation/rollback path; explicit residual effects; independent postcondition; cooldown; anti-oscillation law; immutable receipt; automatic demotion on changed assumptions. No Class A command may mutate capital or an external environment.

**Class B — canonical recovery, never agent repair.** Unknown exchange outcome, accounting mismatch, position ambiguity, partial fill, borrow/funding liability, and other capital-affecting states enter canonical reconciliation/recovery. They never enter an automatic or agent repair allowlist.

**Class C — owner-approved normal release.** Any agent- or human-generated code change follows the owner-approved, hash-bound release pipeline; configuration/deployment/service/host/AWS/Cloudflare/Secrets/provider-activation additionally requires separate I00 §20 authorization. None can be promoted into the automatic allowlist.

**Class D — abstain/demote.** Model/label drift, unsupported cohorts, calibration loss, strategy underperformance, and unknown research evidence cause the accepted Q/runtime boundary to abstain or recommend demotion through existing owners.

**Promotion evidence law (all nine required for a Class A eligibility claim):** (1) deterministic failure reproduction; (2) exact registered command identity; (3) focused/regression/fault tests; (4) shadow or no-authority exercise; (5) independent verifier confirms the declared postcondition; (6) no recurrence during a declared quiet period (bounded past evidence, never future proof); (7) owner-preauthorized narrow class; (8) bounded rate/resource/attempt/exposure effects; (9) recurrence/drift/changed assumptions automatically demote. Clock repair never steps in-process wall clock; queue/export recovery preserves material events or records a visible gap; backup-path switch requires current proof, coherence, identity, and same truth semantics.
