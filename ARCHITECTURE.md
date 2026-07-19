# ARCHITECTURE.md — how the machine is put together and who owns what

Part I is the orientation: code families, the decision chain, and the composed runtime. Part II is the canonical authority map settled at convergence — the law for ownership, adapters, and labels. When code and this file disagree, fix one of them in the same change.

## Part I — Orientation

### The product in one sentence

A private crypto-inefficiency operating machine: it watches the full Binance universe, senses divergence and dormant-token wakeups, explains its evidence, budgets capital, and will one day execute two-leg structures — but today every money path is mechanically blocked (`LIVE_EXECUTION_NOT_IMPLEMENTED`).

### The decision chain

```text
Binance public data
  -> source freshness / sequence / coverage truth      (intelligenceRuntime)
  -> evidence, features, attention, thesis, forensics  (intelligenceFoundation)
  -> Basis + Volume strategy decisions and proposals    (engine — the ONLY strategy authorities)
  -> capital eligibility, reservation, staged mandate   (capitalFoundation)
  -> operator authority: READ_ONLY | ADVISORY | VALIDATE_ONLY
  -> multi-leg risk verdict                             (foundation/risk)
  -> dry-run two-leg execution plan/coordinator         (foundation/execution — sealed fake port)
  -> reconciliation projection                          (foundation/reconciliation)
  -> ledger (SQLite, sole durable store)                (server/src/ledger.ts + data/cosmos.db)
  -> canonical supervisor read model                    (systemIntegration/supervisor)
  -> authenticated APIs -> cockpit pages                (web/)
```

### Code families

| Path | What it is | Runtime posture |
| --- | --- | --- |
| `server/src/engine/**` | Existing Basis + Volume engines, scanner, market data | LIVE_PUBLIC, strategy authority |
| `server/src/services/**`, `server/src/binance/**`, `server/src/ledger.ts` | Audited product services, Binance owners, durable ledger | LIVE_PUBLIC / read-only keys |
| `server/src/foundation/**` | Control plane, canonical read model, multi-leg risk, execution coordinator, reconciliation, USD-M read/test boundary (dormant), replay, diagnostics, contracts | WIRED via adapters; execution dry-run only |
| `server/src/intelligenceFoundation/**` | Evidence normalization, universe graph, feature bank, attention, thesis, forensics, outcomes, topology | WIRED (evidence substrate) |
| `server/src/intelligenceRuntime/**` | Public source lifecycle, broad Spot/USD-M adapters, focus allocator, books, baseline bootstrap, capture, snapshot, no-key smoke | WIRED for composed sources; effectful continuous feed still future work |
| `server/src/capitalFoundation/**` | Capital eligibility, budgets/reservations, staged mandates, approvals, position supervision, PnL attribution, checkpoints, topology | WIRED read/advisory; reservation authority UNAVAILABLE until real account truth |
| `server/src/systemIntegration/**` | Composition root, adapters, supervisor read model, persistence adapter, authenticated routes/controls, vertical slice | The only place that composes the others |
| `web/**` | React/Vite cockpit (Dashboard, Health, Opportunities, Risk, Ledger, …) | Renders canonical supervisor truth only |

### The composed runtime

One composition root (`systemIntegration/composition`) manages ~13 components with dependency-ordered startup (persistence/control shell → public sources → universe/evidence → intelligence → engines → capital advisory → risk/execution/reconciliation validate-only → supervisor READY) and reverse-order shutdown. Restart restores checkpoints and blocks new exposure until truth is fresh. The kill switch is fail-closed for new risk and never hides exposure or blocks risk-reducing recommendations.

Every component/surface uses the cumulative release labels `BUILT_AND_TESTED → IMPORTED → WIRED → LIVE_PUBLIC` (or `SYNTHETIC_ONLY | BLOCKED | NOT_CONFIGURED | MISSING`); no label ever implies the next one.

---

## Part II — System Authority Map (canonical convergence law)

Status: **CANONICAL FOR SYSTEM CONVERGENCE**

This artifact settles overlapping ownership at the accepted convergence base
`87af78285a4b11bc8ca98c4cc9b3bb4a551d2537`. It does not rename or widen any
mature organ contract. Translation is narrow, directional, tested, and explicit
about loss. Integration may compose and project domain truth; it may not become
a strategy, capital-policy, risk, execution, reconciliation, or exchange
authority.

### Canonical domain owners

| Concept | Canonical owner/path | Consumers | Alternatives found | Directional adapter and loss behavior | Persistence owner | Runtime owner | Proving test | Retired duplicate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Basis decisions, proposal lifecycle, score, direction, invalidation | `BasisEngine`, lifecycle and proposal store under `server/src/engine/basis/**` | Capital intake, Foundation canonical read model, supervisor/cockpit | Foundation canonical opportunity; Capital proposal compatibility view | Engine-native record -> Foundation canonical read projection -> Capital intake. Preserve raw engine ID, correlation, source lifecycle, timestamps and revision when present. A canonical projection never recomputes edge/score. Missing engine revision remains `null`/unknown. | Existing ledger records material engine events | Existing `BasisRuntime`; managed by Foundation Control through an adapter | `server/test/engine-basis.mjs`; new engine-adapter integration tests | Any integration-side Basis scoring/proposal store is forbidden |
| Volume decisions, proposal lifecycle, confidence, focus | `VolumeEngine`, `FocusManager`, proposal store under `server/src/engine/volume/**` | Capital advisory intake, intelligence hints, supervisor/cockpit | Foundation canonical opportunity; Capital proposal compatibility view | Same one-way projection as Basis. Volume remains `ADVISORY`/`VALIDATE_ONLY`; translation cannot grant reservation or live authority. Missing source TTL/revision stays explicit. | Existing ledger | Existing `VolumeRuntime`; managed by Foundation Control through an adapter | `server/test/engine-volume.mjs`; new adapter scenarios | Any integration-side detector/confidence/proposal owner is forbidden |
| Cross-engine crowding/decay measurement, reduction, disablement, retirement and research redirection | Basis and Volume strategy authorities through the pure contract under `server/src/engine/decay/**` | Capital/supervisor projections and reviewed research intake | Capital position reduction policy; Foundation observational calibration; Intelligence Foundation outcomes | The measurement consumes version-isolated Foundation calibration reports, trusted Capital `CLOSED_OUTCOME` economic reports and directly observed competitor-displacement counts across policy-sized, non-overlapping chronological windows. Calibration reliability, closed-outcome net value and direct crowding remain separate named axes; sample overlap, low counts, non-production authority or absent direct crowding yields `UNKNOWN`. Engine alone emits monotonic `HOLD_UNKNOWN`/`REDUCE`/`DISABLE`/`RETIRE` strategy decisions. Recovery never silently re-enables a restricted strategy, and research redirection stops at `PENDING_REVIEW` with automatic promotion and execution authority absent. | Sole existing Ledger through exact config CAS plus one decision event; bounded restart snapshots hash-chain compacted entries while Ledger events preserve the full durable history | Pure measurement/governance is `BUILT_AND_TESTED`; Basis/Volume owner invocation, production corpus binding and direct-crowding producer remain `NOT_CONFIGURED` pending a narrow composition adapter | `server/test/engine-decay.mjs`; `server/test/engine-decay-measurement.mjs` | Capital, integration, UI or research-side decay/retirement decisions, proxy-derived crowding and autonomous research promotion are forbidden |
| Cross-engine read/proposal projection | `CanonicalOpportunity` plus `foundation/readModel/**` | Integration supervisor, Capital compatibility adapter, cockpit | Engine-local snapshot shapes | `basis|volume -> readModel ports -> canonicalize*`. Rejected malformed records stay in rejected-record output; strategy-local rank is not compared across engines. | Existing ledger stores aliases/material transitions, not a second proposal DB | Integration captures owner snapshots | `server/test/foundation/readModel/read-model.mjs` | Ad-hoc UI proposal normalization is retired for convergence truth |
| Market evidence, features, attention, thesis, forensics, outcomes | `server/src/intelligenceFoundation/**` | Existing engines through evidence-only ports, Capital references, supervisor | Runtime source records; engine feature snapshots | Runtime public evidence -> MI normalizers/feature bank/attention. Engine hints are read-only. MI facts may enrich engine evidence but never replace an engine decision. | Existing ledger/capture adapter stores bounded material references | Intelligence Runtime supplies public facts; integration composes | `server/test/intelligenceFoundation/**/*.test.mjs` | No third scanner or integration thesis/forensics clone |
| Public acquisition, source lifecycle, freshness/sequence/backpressure, focus delivery | `server/src/intelligenceRuntime/**` | Market Intelligence, existing engines, supervisor | Existing audited `MarketEngine`, `BasisRuntime`, `VolumeRuntime`, UI `BookStreamHub` physical producers | The runtime source catalog owns semantic publication. Existing audited physical producers are injected/adapted; integration opens no competing socket/cache. UI-local viewed-book delivery is not broad authority. Missing raw delivery remains `BLOCKED`/`MISSING`, never fabricated as wired. | Existing ledger for material lifecycle/gap events; runtime capture/checkpoint via adapter | Managed integration composition | `server/test/intelligenceRuntime/**/*.test.mjs`; new source-registry tests | A second Binance public producer in `systemIntegration` is forbidden |
| Opportunity capital eligibility, portfolio budget, reservation, staged mandate, scoped approval evaluation | `server/src/capitalFoundation/**` | Foundation multi-leg risk, supervisor/cockpit | Legacy order notional holds; engine proposals | Canonical proposal/evidence/account truth -> existing Capital functions. Capital exact-decimal values remain strings. Legacy floats/MI numbers are never silently money; a separately bound exact source is required. Missing account/cost truth blocks reservation. | Existing ledger through `CapitalPersistencePort` adapter | Integration calls pure Capital owners; no Capital timer/singleton | `server/test/capitalFoundation/**/*.test.mjs`; new vertical-slice scenarios | No integration allocator/reservation/approval boolean authority |
| Active-position economic policy, supervision, exact attribution | Capital `positions`, `supervision`, `actions`, `economics` | Risk-reducing plan input, supervisor/cockpit | Foundation mechanical lifecycle; legacy UI PnL | Foundation execution/reconciliation references -> Capital projection and policy. Unknown/divergent external truth becomes `UNKNOWN`/`RECOVERY_REQUIRED`; exposure is never erased. | Existing ledger/checkpoint adapter | Integration supplies read-only external references | Capital positions/supervision/economics tests | Integration never infers flatness/PnL |
| Desired/observed whole-machine state and control validation | `DeterministicSupervisor`, `ManagedComponent`, Foundation runtime contracts under `foundation/control/**` and `foundation/contracts/runtime.ts` | Integration controls and supervisor read model | Runtime source lifecycle; MI topology; Capital topology | Promise-based audited runtime ports -> synchronous poll-style `ManagedComponent`. Domain lifecycle remains evidence; only Control Plane projects machine `RuntimePhase`. External safe modes map to Foundation control `INTELLIGENCE`; dry-run authority is gated separately. | Existing ledger state/checkpoint adapter | Single integration composition root | `server/test/foundation/control/control.mjs`; new composition scenarios | No second lifecycle/control plane |
| Final multi-leg risk verdict | `evaluateMultiLegRisk` in `server/src/foundation/risk/**` | Validate-only coordinator and supervisor | Legacy single-order `RiskService`; Capital eligibility | Exact staged mandate plus explicit evidence -> Foundation risk input. Capital never self-approves. Legacy risk remains owner of its legacy manual single-order boundary only and is not imported by convergence. Exact-decimal -> binary64 projection must be finite, bounded, round-trip checked and labeled `BINARY64_PROJECTION`. | Existing ledger stores verdict/reference | Validate-only orchestrator invokes the pure evaluator | `server/test/foundation/risk/risk.mjs`; new SC-13/15/16 | No integration risk policy/verdict synthesis |
| Mechanical two-leg plan/leg lifecycle and recovery state | `server/src/foundation/execution/**` | Reconciliation, Capital external lifecycle port, supervisor | Capital economic target/stage; legacy manual OrderService | Allowed Foundation verdict -> deterministic Foundation plan -> coordinator using sealed in-process dry-run port only. External operator mode remains `VALIDATE_ONLY`; all events are labeled dry-run/synthetic. No signed/test/live method exists on the port. | Existing ledger/checkpoint adapter | Validate-only orchestrator/coordinator | `server/test/foundation/execution/execution.mjs`; new vertical-slice scenarios | Legacy manual OrderService is isolated, not adapted into convergence |
| Exchange-versus-local truth | `server/src/foundation/reconciliation/**` | Capital position projection, intake barrier, supervisor | Capital reconciliation reference; legacy account reconciliation | Dry-run intended state + observed fixture/read-only evidence -> Foundation reconciliation. Status is truth, not an exception. `PARTIAL`, `AMBIGUOUS`, `DIVERGED`, `STALE`, or `UNAVAILABLE` blocks new/increasing convergence exposure while risk-reducing recommendations remain visible. | Existing ledger/checkpoint adapter | Validate-only orchestrator and restart reconciliation | Foundation reconciliation tests; new SC-20/21/25 | No integration comparison/reconciliation algorithm |
| Durable event and checkpoint history | Existing `Ledger` in `server/src/ledger.ts` and `data/cosmos.db` | Every domain adapter, supervisor/API/logs, restart | Capital checkpoint port; Runtime capture storage port; Foundation replay storage | One bounded adapter uses `logEvent`, `logEventsAtomically`, `getConfigValue`, and atomic `setConfigValueAndLogEvent`. Domain occurrence/source/evaluation times stay in payload; SQLite row `ts` is commit/receipt time. No second DB/file store. | Existing Ledger is sole owner | Persistence managed first and stopped last | Existing storage hardening; new persistence/restart scenarios | Any new SQLite/file/event store is forbidden |
| Product notification incidents, local routing, acknowledgement, and recovery proof | `server/src/productIntegration/incidents/**`, composed into `server/src/productIntegration/runtime/**` | Product supervisor/API, shared Header tray, Notifications page | Legacy browser `/api/events` grouping/cursors; raw ledger rows; notification-routing capability response | Authenticated canonical source event -> deterministic Product incident router -> exact routed disposition/episode transition -> supervisor projection. The router owns grouping, source high-water, severity/state/count relationships, route receipts, and recovery proof. ACK uses the exact incident/revision/control identity and records acknowledgement without clearing root cause. Browser consumers strictly decode capability readback and render supervisor incidents one-to-one; malformed, stale, or contradictory truth becomes unavailable. | Existing `Ledger` is sole owner of incident rows, immutable source/disposition chain, bounded checkpoint, rotation proof, ACK evidence, and recovery evidence | Product integration bootstraps only the bounded suffix after the durable checkpoint; the supervisor publishes at most 200 canonical episodes | `server/test/productIntegration/incidents/**`; runtime incident gates; `web/test/productControlRoom/incident-notification-hardening.test.mjs` | Client-side grouping/recovery inference and any second incident cache, queue, cursor, checkpoint, or paging owner are forbidden |
| Whole-machine read projection, root-cause graph, attention queue, trace index | `server/src/systemIntegration/supervisor/**` | Authenticated API and cockpit | Foundation read model, runtime snapshot, MI/Capital topology | Read-only composition of owner snapshots. It may aggregate severity/dependencies and preserve first root blocker; it cannot decide strategy, eligibility, risk, execution, or reconciliation. | Existing ledger supplies recent trace material; bounded checkpoint stores control state | Integration composition root | New supervisor/route scenarios | Client-side integration health/strategy recomputation is retired |
| Signed exchange actions in convergence | Future separately audited adapters; **absent** | None in this sprint | Existing legacy manual Binance client/order/loan services; dormant Foundation USD-M test boundary | No adapter exists. `LIVE`, `LIVE_MANUAL`, `MANUAL_ARMED`, `EXECUTION_LIVE`, and autonomous variants fail before any port mutation with `LIVE_EXECUTION_NOT_IMPLEMENTED`. `systemIntegration` may not import signed/private/test-order boundaries. | None | None | New static authority scan, egress tripwire, SC-17 | Foundation test-order boundary is not wired; legacy manual services remain outside convergence |

### Cross-domain contract dialects

### Time and freshness

Cross-domain consumption time uses Foundation
`SourcedTimestamp`/`evaluateFreshness` from
`server/src/foundation/contracts/time.ts`.

- Runtime -> Market Intelligence is lossless for event time, transaction time,
  receive time, sequence range and coverage.
- Market Intelligence -> Foundation may be lossy:
  `sourceTimeMs = sourceEventTimeMs ?? sourceTransactionTimeMs`,
  `receivedAtMs = receivedTimeMs`. Transaction-time fallback and sequence loss
  are named in the trace. `maxAgeMs` must come from validated MI freshness or
  explicit adapter policy; absence yields `UNAVAILABLE`, never a made-up age.
- Engine `ts`, `createdTs`, and `updatedTs` stay source-domain times. The
  integration capture site supplies its own receipt time.
- Ledger event `ts` is database commit/receipt time. Domain occurrence, source,
  process and evaluation times remain separate payload facts.
- A cross-domain adapter applies Foundation `isValidUtcMillis`; wider MI/runtime
  timestamps that do not fit fail with `UTC_MILLIS_INVALID`.

### Authority and completeness

Foundation `DataAuthority` is the only cross-domain acquisition authority.
Similarly named fields are not cast:

- MI `SourceAuthority` is semantic source identity.
- Runtime `RuntimeAuthority` is coverage/completeness.
- Capital `CapitalTruthState` is capital-domain truth.

Runtime coverage maps conservatively:

| Runtime | MI | Foundation |
| --- | --- | --- |
| `COMPLETE` | `COMPLETE` | `COMPLETE` |
| `PARTIAL` | `PARTIAL` | `PARTIAL` |
| `SAMPLED` | `PARTIAL` plus lower-bound reason | `PARTIAL` |
| `UNAVAILABLE` | `MISSING` | `UNAVAILABLE` |
| `UNKNOWN` | `UNKNOWN` | `UNAVAILABLE` |

MI authority becomes Foundation authority only with acquisition context:

- exchange primary plus proven live public transport -> `LIVE_PUBLIC`;
- derived/contextual facts -> `DERIVED_LIVE`, weakened by every upstream fact;
- replay -> `RECORDED_REPLAY`;
- deterministic fixtures -> `SYNTHETIC_TEST`;
- operator-supplied, unknown, inconsistent, stale, or missing provenance ->
  `UNAVAILABLE`.

Adapters use `weakestAuthority` and `downgradeAuthority`. Release state is
separate: one live fact does not make a component `LIVE_PUBLIC`; the component
must also be wired, active, fresh, complete enough, and ready.

### Stable identity and aliases

- Foundation identity helpers own system, command, correlation, configuration,
  plan, leg, event and canonical read IDs.
- MI `stableId`/`stableSetId` own evidence/artifact/topology IDs; Runtime reuses
  that namespace for source/runtime component IDs.
- Capital domain-specific ID functions reuse the Foundation canonical/hash
  kernel and remain Capital-owned.
- Engine IDs (`bp_*`, `vp_*`, correlations) stay opaque and are preserved.
- SQLite integer IDs are storage identities only.

The ledger stores alias edges rather than recomputing a foreign ID:

```text
system ID
owner namespace
source/domain ID
canonical projection ID, when present
correlation ID
revision/digest, when present
```

### Failures and outcomes

Foundation `StructuredFailure`/`ContractResult` is the only operational failure
shape crossing integration, control or API boundaries.

- MI `StableFailure` and Runtime `RuntimeError` stay origin records. An adapter
  supplies occurrence time, correlation, safe state and operator action, while
  retaining origin ID/field/evidence IDs in the trace.
- Engine reject codes and read-model rejected records are strategy/read
  outcomes, not system failures.
- Reconciliation status is truth, not an exception.
- Caught legacy/runtime throws become named adapter failures; no free-form throw
  crosses a managed port.
- The frozen nine-field `StructuredFailure` shape is not widened.

### Lifecycles

No lifecycle is cross-cast:

| Scope | Owner vocabulary |
| --- | --- |
| Whole machine | Foundation `DesiredRuntimeState` / `RuntimePhase` |
| Public source | Runtime `RuntimeLifecycleState` |
| Strategy | Engine `SymbolState`, decision kind, proposal status |
| Cross-engine read | Foundation `CanonicalLifecycle` |
| Mechanical execution | Foundation `PlanLifecycle` / `LegLifecycle` |
| Capital economics | Capital lifecycle/stage/position state |

Source `LIVE` is only readiness evidence when freshness and completeness also
pass. `CONNECTING`/`WARMING` remain warming; silent, stale, degraded, backing
off, rate-limited and failed states remain explicit. Control Plane alone
projects the whole-machine phase.

### Safe-mode translation

The operator-facing convergence mode owns exactly:

```text
READ_ONLY
ADVISORY
VALIDATE_ONLY
```

| Convergence mode | Foundation Control mode | Capital posture | Coordinator |
| --- | --- | --- | --- |
| `READ_ONLY` | `INTELLIGENCE` | `READ_ONLY` | unavailable |
| `ADVISORY` | `INTELLIGENCE` | `ADVISORY` | unavailable |
| `VALIDATE_ONLY` | `INTELLIGENCE` for keyless managed lifecycle | observation/approval `VALIDATE_ONLY`; reservation `UNAVAILABLE` | internal Foundation dry-run/PAPER mechanics through sealed fake port only after an externally supplied staged mandate |

Foundation Control's `EXECUTION_VALIDATE_ONLY` dialect expects private-key
evidence; convergence must not claim keys exist. Managed lifecycle therefore
remains `INTELLIGENCE`. The separate validate-only orchestrator gates an exact
mandate through Foundation risk and sealed dry-run execution. This translation
is intentionally named in the supervisor/trace.

Capital has a second deliberate dialect boundary. Its allocator rejects a
`VALIDATE_ONLY` consideration with `MODE_VALIDATE_ONLY_CANNOT_RESERVE`, and its
increasing stage transition requires a `MANUAL_ARMED` approval. Integration
must not cast or forge around those guards. Production convergence therefore
observes/evaluates Capital in `VALIDATE_ONLY` but reports reservation/staging
authority `UNAVAILABLE` unless the Capital owner supplies an already valid
staged mandate. The deterministic full-chain harness may build that mandate
inside an explicitly `SYNTHETIC_ONLY` Capital fixture using Capital's local
`MANUAL_ARMED` eligibility dialect; the system/operator approval remains exact
`VALIDATE_ONLY`, `executionReady=false`, and the local label is never exposed
as system mode or execution authority. `evaluateStageTransition` is not called
by this slice.

Effective kill/intake posture is the most restrictive combination of existing
audited `AppConfig` facts and convergence control state. Disengaging one gate
never bypasses another. Existing `/api/live` is not called or exposed by the
convergence API.

### Canonical semantic source registry

| Dataset | Physical producer | Semantic publisher/owner | Consumers | Duplicate rule |
| --- | --- | --- | --- | --- |
| Spot mini ticker and universe projection | Existing `MarketEngine` | Intelligence Runtime source catalog / Spot broad adapter | Market Intelligence, Markets, engines, supervisor | No new integration socket or cache |
| Spot aggregate trades | Existing `VolumeRuntime` | Intelligence Runtime Spot evidence publication | Volume engine, Market Intelligence, supervisor | One existing producer; no second broad trade stream |
| Spot/Perpetual best bid/ask for Basis | Existing `BasisRuntime` fetch/delivery | Intelligence Runtime evidence/source projection; Basis retains strategy cache | Basis engine, Market Intelligence | Do not publish UI `BookStreamHub` as broad authority |
| USD-M mark/funding and liquidation | Existing `MarketEngine` current tiered feeds | Intelligence Runtime Futures adapter | Basis, Market Intelligence, supervisor | No legacy-host or duplicate tiered socket |
| Viewed-symbol depth | Existing `BookStreamHub` | UI-local read service only | Token detail | Not a broad/intelligence authority |
| Runtime manual public smoke | Runtime smoke transport | Acceptance tooling only | Receipt | Never mounted at application startup |

Only one producer may publish a semantic stream. A source lacking an approved
single physical producer stays `SYNTHETIC_ONLY`, `BLOCKED`, `NOT_CONFIGURED`, or
`MISSING`.

### Release and truth labels

All component artifacts and cockpit projections use only:

```text
BUILT_AND_TESTED
IMPORTED
WIRED
LIVE_PUBLIC
SYNTHETIC_ONLY
BLOCKED
NOT_CONFIGURED
MISSING
```

These labels are cumulative evidence, not synonyms. `BUILT_AND_TESTED` does
not imply `WIRED`; `WIRED` does not imply `LIVE_PUBLIC`; dry-run output is never
exchange-observed truth.
