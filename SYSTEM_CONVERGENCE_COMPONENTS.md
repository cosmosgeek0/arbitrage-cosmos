# System Convergence Components

This manifest describes the canonical convergence boundary on
`system-convergence-vertical-slice-20260711`. Domain libraries keep their own
types, IDs, lifecycle vocabularies, and decision authority; integration exposes
only narrow directional projections. Runtime truth is reported separately from
build/import status.

## Lineage key

- **AUDITED** — audited Main integration base
  `87af78285a4b11bc8ca98c4cc9b3bb4a551d2537` on `current-main`.
- **MI** — `market-intelligence-main-20260711` at
  `3340f75270049de96846d153672b91f065844eef`.
- **RUNTIME** — `live-intelligence-runtime-main-20260711` at
  `e28b4c13c2f57f181cc6ea61508089719c7ff59c`.
- **CAPITAL** — `capital-supervision-main-20260711` at
  `963538d3cc9da74b51b70347a70a017b6eab2910`.
- **FOUNDATION** — donor `backend-foundation-parallel-20260711-070056` at
  `db30569b116f5d9282b186da2ab4727e04a7f244`, adapted onto audited Main
  through `c4ae7a9aee51050da2076bf4a454988b1d372bc4` and present at
  `87af78285a4b11bc8ca98c4cc9b3bb4a551d2537`.
- **CONVERGENCE** — this branch through code/UI checkpoint
  `b62225254ef5f2087f4044183723a4918dfbbe08`; exact checkpoint SHAs are
  recorded in `SYSTEM_CONVERGENCE_RECEIPT.md`.

## Accepted keyless runtime evidence

The isolated `SKIP_DOTENV=1` acceptance run proved the distinction between
artifact status and current runtime truth. Both public source nodes,
`market-universe`, `basis-engine`, and `volume-engine` reached `LIVE_PUBLIC`;
the existing SQLite ledger and supervisor were READY/observable. The snapshot
was correctly **DEGRADED**, with 6/13 nodes READY, because the effectful
Intelligence Runtime, continuous Market Intelligence, production Capital
owner input, signed account truth, live reconciliation, and any execution port
were absent. The public universe contained 447 symbols. No proposal was
fabricated to make the smoke appear end-to-end.

## Canonical component records

### `public-spot-source`

- **Owner/path/lineage:** Audited app; `server/src/engine/marketData.ts` and
  `server/src/services/volumeRuntime.ts`; AUDITED.
- **Responsibility / non-responsibility:** Own the existing public Spot
  transports and raw event truth. They do not own strategy scores, capital,
  risk, or execution.
- **Inputs / outputs / persistence:** Binance public mini-ticker, aggregate
  trade, and best-bid/ask data -> existing bounded caches and passive canonical
  source projection. Material lifecycle/gap transitions only go to the existing
  Ledger; high-rate ticks do not.
- **Lifecycle / dependencies / controls:** Physical transport remains owned by
  MarketEngine/VolumeRuntime under the outer application root. Depends on
  `ledger-persistence`; safe managed restart only.
- **Health semantics:** Open transport is not enough. READY requires a current
  raw source timestamp, aligned freshness, coverage, and no named gap/blocker.
- **Tests / consumers:** Engine tests, adapter scenarios SC-02/04-08, managed
  composition, 30-scenario harness; supervisor, Dashboard, Health.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; add
  `LIVE_PUBLIC` only when the current runtime probe proves live public truth.

### `public-usdm-source`

- **Owner/path/lineage:** Audited app; `server/src/engine/marketData.ts` and
  `server/src/services/basisRuntime.ts`; AUDITED.
- **Responsibility / non-responsibility:** Own public USD-M mark/funding,
  liquidation, and best-bid/ask acquisition. No private account, signed order,
  test-order, or money authority.
- **Inputs / outputs / persistence:** Public USD-M events -> existing caches and
  passive source projection; only bounded material transitions persist.
- **Lifecycle / dependencies / controls:** MarketEngine owns the physical
  producer; BasisRuntime reuses it and its public book adapter. Depends on
  `ledger-persistence`; safe managed restart only.
- **Health semantics:** Spot and Futures remain independently observable;
  missing one degrades dependent capabilities without erasing its sibling.
- **Tests / consumers:** Adapter SC-02/03/05/09, Basis suite, composition,
  supervisor; Dashboard and Health.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; runtime
  `LIVE_PUBLIC` is conditional on current source evidence.

### `market-universe`

- **Owner/path/lineage:** Audited `MarketEngine`; AUDITED.
- **Responsibility / non-responsibility:** Own canonical tradable-symbol/filter
  universe. Integration never creates a second universe or silently drops quiet
  symbols.
- **Inputs / outputs / persistence:** Existing public exchange-info acquisition
  -> bounded symbol/filter maps -> source/coverage summaries. No raw-universe
  duplicate store.
- **Lifecycle / dependencies / controls:** First physically managed data
  component. Starts only after the persistence/control shell; Basis and Volume
  depend on it. STOP/START/RESTART are managed by the outer root.
- **Health semantics:** Init is generation-owned and atomically committed; a
  timed-out or stopped fetch cannot publish late state. READY requires a
  populated current universe and admitted runtime generation.
- **Tests / consumers:** Managed composition cold-start, timeout, required-fatal,
  drain, and SC-01/06/30; all engines and supervisor.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; runtime
  `LIVE_PUBLIC` only after the admitted public init succeeds.

### `intelligence-runtime`

- **Owner/path/lineage:** `server/src/intelligenceRuntime/**`; RUNTIME.
- **Responsibility / non-responsibility:** Own normalized public-source
  lifecycle, coverage, queues, focus/capture evidence, and runtime failures. It
  does not own engine proposals, Capital decisions, risk, or execution.
- **Inputs / outputs / persistence:** Existing-producer structural snapshots ->
  directional coverage/lifecycle/observation projections. Integration does not
  open a second socket or canonical cache.
- **Lifecycle / dependencies / controls:** Passive in the current application
  root unless an effectful runtime port is explicitly supplied; depends on
  public sources and universe. No implicit refresh from reads.
- **Health semantics:** Runtime coverage never becomes DataAuthority. Silent,
  stale, sequence-gap, queue, and resync evidence remain explicit.
- **Tests / consumers:** Runtime 394 corpus, adapter scenarios SC-02-08,
  supervisor truth tests, 30-scenario harness; Health and Dashboard.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`,
  `NOT_CONFIGURED`; the deterministic adapter seam is tested, but no effectful
  Intelligence Runtime owner port is mounted in the production root. Runtime
  truth is `UNAVAILABLE`, never `WIRED`, synthetic, or live.

### `market-intelligence`

- **Owner/path/lineage:** `server/src/intelligenceFoundation/**`; MI.
- **Responsibility / non-responsibility:** Own evidence semantics, attention,
  bounded focus, thesis/forensics inputs, and semantic source authority. It may
  advise existing engines but cannot create engine-owned proposals or action.
- **Inputs / outputs / persistence:** Normalized evidence -> tested intelligence
  records/adapters; material references may enter the convergence trace. Raw
  high-rate evidence remains with its owner.
- **Lifecycle / dependencies / controls:** Pure/passive canonical node dependent
  on `intelligence-runtime`; no transport or money control.
- **Health semantics:** Missing upstream/source time, sequence, age budget, or
  acquisition authority is a named loss and cannot become live truth.
- **Tests / consumers:** MI 152 corpus, dialect and adapter tests, SC-07-10;
  supervisor summaries and canonical traces.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`,
  `NOT_CONFIGURED`; dialect adapters and synthetic evidence paths are tested,
  but continuous production evidence/thesis generation is not mounted.

### `basis-engine`

- **Owner/path/lineage:** `server/src/engine/basis/**` plus
  `server/src/services/basisRuntime.ts`; AUDITED.
- **Responsibility / non-responsibility:** Sole Basis strategy decision/proposal
  owner. Integration never recalculates edge, priority, direction, or rejection.
- **Inputs / outputs / persistence:** Existing public books/mark/funding/borrow
  truth -> exact decisions/proposals -> bounded defensive capture -> canonical
  opaque references. Existing Ledger remains event owner.
- **Lifecycle / dependencies / controls:** Physically managed after universe;
  optional failure does not erase Volume. Safe restart/drain through outer root.
- **Health semantics:** Raw book/mark timestamps determine freshness. Snapshot
  capture time is never relabeled as source time. Missing revisions remain
  `REVISION_UNAVAILABLE`.
- **Tests / consumers:** Basis 107, adapter SC-09, composition and 30-scenario
  harness; Dashboard, Opportunities, Health, traces.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; current
  public runtime may be `LIVE_PUBLIC`, while downstream action authority is none.

### `volume-engine`

- **Owner/path/lineage:** `server/src/engine/volume/**` plus
  `server/src/services/volumeRuntime.ts`; AUDITED.
- **Responsibility / non-responsibility:** Sole Volume/wakeup strategy owner.
  Integration cannot grant reservation, approval, risk, or execution authority.
- **Inputs / outputs / persistence:** Existing aggregate-trade/books/baselines ->
  exact decisions/proposals -> bounded capture and opaque references.
- **Lifecycle / dependencies / controls:** Physically managed after universe;
  optional failure does not erase Basis. Safe restart/drain through outer root.
- **Health semantics:** Trade/book source ages and stream coverage are distinct
  from process/tick liveness. Volume remains advisory under every convergence
  mode.
- **Tests / consumers:** Volume 124, adapter SC-10, composition and 30-scenario
  harness; Dashboard, Opportunities, Health, traces.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; public
  observation may be `LIVE_PUBLIC`, action authority remains none.

### `capital-supervision`

- **Owner/path/lineage:** `server/src/capitalFoundation/**`; CAPITAL.
- **Responsibility / non-responsibility:** Own eligibility, allocation,
  reservation, staged mandate, approvals, economics, and position policy. It
  cannot self-approve Foundation risk or execute.
- **Inputs / outputs / persistence:** Supplied account/cost/proposal truth ->
  Capital owner records -> existing-ledger checkpoint references. Unknown or
  stale account truth blocks allocation.
- **Lifecycle / dependencies / controls:** Passive pure owner dependent on MI and
  engine proposals; revocation is bounded/versioned/ledgered. Production
  reservation remains unavailable under the current mode dialect.
- **Health semantics:** Capital `VALIDATE_ONLY` approval is non-executable;
  reservation/staging requires its local MANUAL_ARMED dialect and is never
  forged by integration.
- **Tests / consumers:** Capital 433, vertical SC-11-19, persistence/restart and
  30-scenario harness; Opportunities, Risk, supervisor.
- **Status / remaining wiring:** Production is `BUILT_AND_TESTED`, `IMPORTED`,
  `BLOCKED`, with truth `UNAVAILABLE` because no complete Capital owner/account
  port is mounted. The deterministic full-chain proof is explicitly
  `SYNTHETIC_ONLY`; production reservation/staging remains unavailable until a
  valid owner mandate exists.

### `multileg-risk`

- **Owner/path/lineage:** `server/src/foundation/risk/**`; FOUNDATION.
- **Responsibility / non-responsibility:** Sole multi-leg risk verdict/cap owner.
  It consumes an exact staged mandate and scoped approval; it never approves
  itself or submits an action.
- **Inputs / outputs / persistence:** Exact plan intent, proposal, approval,
  public/synthetic account/market evidence -> verdict and bound risk reference
  -> existing-ledger validate-only trace.
- **Lifecycle / dependencies / controls:** Pure validate-only service dependent
  on Capital. Kill/intake/reconciliation barriers fail closed.
- **Health semantics:** Any stale, incomplete, mismatched, expired, revoked, or
  unknown input rejects before the coordinator.
- **Tests / consumers:** Foundation risk corpus, vertical SC-13-19, 30-scenario
  harness; Risk and trace APIs.
- **Status / remaining wiring:** The invoked deterministic path is
  `BUILT_AND_TESTED`, `WIRED`, `SYNTHETIC_ONLY`. The production supervisor is
  `NOT_CONFIGURED`/`UNAVAILABLE` until an exact mandate is supplied internally;
  there is no HTTP invocation route and no private/live evidence authority.

### `execution-coordinator-validate-only`

- **Owner/path/lineage:** `server/src/foundation/execution/**`; FOUNDATION.
- **Responsibility / non-responsibility:** Own deterministic multi-leg plan and
  coordinator lifecycle. Integration stops at READY; it does not open or submit.
- **Inputs / outputs / persistence:** Allowed risk verdict and exact plan terms
  -> two-leg VALIDATE_ONLY plan/preflight -> checkpoint/trace. Venue ports are
  sealed dry-run ports only.
- **Lifecycle / dependencies / controls:** Passive/invoked service dependent on
  risk and persistence. Only READ_ONLY/ADVISORY/VALIDATE_ONLY are reachable.
- **Health semantics:** `LIVE_EXECUTION_NOT_IMPLEMENTED` is permanent. Any
  submission/lookup/reconcile venue seam call invalidates persistence.
- **Tests / consumers:** Foundation execution corpus, vertical SC-15-17,
  persistence tripwire, 30-scenario harness; Risk and Execution Control sheet.
- **Status / remaining wiring:** The invoked deterministic path is
  `BUILT_AND_TESTED`, `WIRED`, `SYNTHETIC_ONLY`; the production supervisor is
  `NOT_CONFIGURED`/`UNAVAILABLE`. Live, signed-validation, test-order, and paper
  submission remain mechanically `BLOCKED`.

### `reconciliation`

- **Owner/path/lineage:** `server/src/foundation/reconciliation/**`; FOUNDATION.
- **Responsibility / non-responsibility:** Own intended-vs-observed execution
  truth, divergence, recovery-required status, and risk-reducing recommendation.
  It cannot hide ambiguity or authorize new exposure while unresolved.
- **Inputs / outputs / persistence:** Coordinator checkpoint plus injected
  observed fixtures -> reconciliation result -> durable reference/barrier.
- **Lifecycle / dependencies / controls:** Dependent on coordinator and Ledger;
  recovery remains data-only unless a separately authorized mechanical owner
  exists.
- **Health semantics:** Partial, one-leg, ambiguous, or divergent truth blocks
  new/increasing exposure while preserving supervision/reduction advice.
- **Tests / consumers:** Foundation reconciliation corpus, persistence restart,
  SC-19-25, 30-scenario harness; Risk, Health, traces.
- **Status / remaining wiring:** The fixture-backed deterministic path is
  `BUILT_AND_TESTED`, `WIRED`, `SYNTHETIC_ONLY`; production exchange
  reconciliation is `NOT_CONFIGURED`/`UNAVAILABLE`.

### `ledger-persistence`

- **Owner/path/lineage:** Existing `server/src/ledger.ts` with
  `server/src/systemIntegration/persistence/**`; AUDITED + CONVERGENCE.
- **Responsibility / non-responsibility:** Sole durable convergence checkpoint,
  trace, idempotency, control audit, and restart-barrier adapter. No second store
  and no domain-policy inference.
- **Inputs / outputs / persistence:** Bounded checkpoint/control/validate-only
  records -> existing SQLite config+event transaction -> readback/replay/trace.
- **Lifecycle / dependencies / controls:** Constructed and startup-checkpointed
  before data components; final clean/failed shutdown checkpoint commits before
  existing Ledger close.
- **Health semantics:** Corruption, write/read failure, revision conflict,
  duplicate allocation, or exhausted bounded receipts fail closed.
- **Tests / consumers:** Focused persistence/vertical 44, storage 29,
  restart/controls, exact replay/CAS, and the 30-scenario harness; router,
  supervisor, Logs.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; local
  durable truth, never market/live-money authority.

### `engine-supervisor`

- **Owner/path/lineage:** `server/src/systemIntegration/{application,supervisor}/**`;
  CONVERGENCE.
- **Responsibility / non-responsibility:** Own the whole-machine read projection,
  dependency/root-cause graph, safe control state, attention queue, and outer
  lifecycle ordering. It does not recalculate strategy, Capital, risk, or
  reconciliation truth.
- **Inputs / outputs / persistence:** Domain-owned snapshots plus Foundation
  runtime status and existing-ledger trace -> serializable supervisor/API/UI
  snapshot. Control mutations commit before publication.
- **Lifecycle / dependencies / controls:** Outer root owns shell-first startup,
  the one physical Market/Basis/Volume coordinator, reverse drain, and final
  checkpoint. Supports only bounded closed control commands.
- **Health semantics:** Process existence is never READY; optional degradation is
  scoped; required/root blocker and exposed capital determine priority; old,
  synthetic, dry-run, unknown, or forged-live facts cannot become green.
- **Tests / consumers:** Application root 7, production ports 10, supervisor,
  controls/routes, and the 30-scenario harness inside the 180-test integration
  corpus; all five cockpit surfaces and authenticated APIs.
- **Status / remaining wiring:** `BUILT_AND_TESTED`, `IMPORTED`, `WIRED`; overall
  posture remains degraded/blocked wherever owner truth is unavailable.

## Global money-authority statement

The convergence slice exposes no live-money authority. No production file in
`server/src/systemIntegration/**` owns a signed Binance client, private account
refresh, order/test-order call, borrow/repay call, or arbitrary system/network
target. Existing audited legacy manual/private services remain outside this
slice and are not relabeled as absent. Signed validation, exchange
reconciliation, recovery mechanics, and any smallest-capital trial remain
separate future work.
