# SYSTEM CONVERGENCE + FIRST VERTICAL SLICE MAX-POWER SPRINT

**Project:** Cosmos Arbitrage Control Room  
**Mode:** implementation and integration, not another isolated-foundation build  
**Director:** Claude Code / Fable 5  
**Builder:** one Codex lead using bounded subagents and a fresh integration worktree  
**Money authority:** none; live execution remains mechanically blocked

---

## 0. Controlling instruction

Stop creating additional disconnected organs.

The project now reportedly contains:

- the audited Main product and security/stability hardening;
- existing live Basis and Volume engines;
- Market Intelligence Foundation;
- Live Intelligence Runtime;
- Capital Supervision Foundation;
- a separately built Backend Foundation containing control, read-model, risk, execution-coordination, reconciliation, exchange-boundary, replay, and diagnostics components.

This sprint must verify those claims from Git and receipts, converge them into one authoritative code line, reconcile overlapping contracts, and wire the first complete **read-only / advisory / validate-only vertical slice**.

The target chain is:

```text
Binance public data
  -> source freshness / sequence / coverage truth
  -> Market Intelligence evidence and attention
  -> existing Basis and Volume strategy decisions/proposals
  -> Capital Supervision eligibility, reservation, and staged mandate
  -> operator authority in VALIDATE_ONLY mode
  -> Backend Foundation multi-leg risk
  -> dry-run execution plan/coordinator
  -> reconciliation projection
  -> existing ledger/database
  -> canonical supervisor/read model
  -> authenticated API
  -> existing cockpit status/control surfaces
```

At the end, the owner must be able to start the application locally and see what is running, warming, live, stale, blocked, rejected, or degraded; follow one decision through the chain; activate/deactivate safe components; operate a kill switch; and inspect exact reasons—without terminal archaeology and without any route capable of sending money.

Do not return a plan-only response. Build, integrate, test, run, inspect, commit, and produce exact receipts.

---

## 1. What is believed to exist—and what must be proved

Treat the following as reported starting evidence, not unquestionable truth.

### Audited Main

Known historical anchor:

```text
b272049b1e482ff75de27fbdaece7be5a7bbcc5d
```

The audit reportedly completed security/stability hardening and expanded the existing suite. Verify the current authoritative branch and whether this SHA is still its relevant anchor.

### Existing product

Reported in source/audit history:

- live Basis runtime and `/api/engine/basis`;
- live Volume runtime and `/api/engine/volume`;
- existing risk and ledger behavior;
- account, market, borrow, opportunities, risk, health, logs, notification, and token-detail UI consumers;
- manual Spot order validation/send boundary;
- no completed coordinated live two-leg Basis executor.

Verify all of it from source and tests.

### Market Intelligence Foundation

Known accepted historical tip:

```text
branch: market-intelligence-main-20260711
commit: 3340f75
reported: 152/152 intelligence checks and 12/12 scenario harness
```

Read its actual manifest and receipt. Verify ancestry, diff scope, tests, and final tip.

### Live Intelligence Runtime

Expected branch family:

```text
live-intelligence-runtime-main-20260711*
```

Expected ownership:

```text
server/src/intelligenceRuntime/**
server/test/intelligenceRuntime/**
LIVE_INTELLIGENCE_RUNTIME_COMPONENTS.md
LIVE_INTELLIGENCE_RUNTIME_RECEIPT.md
```

Verify the actual final branch, SHA, implemented lanes, current-source research, deterministic tests, public smoke result, and whether it remained dormant.

### Capital Supervision

Expected branch family:

```text
capital-supervision-main-20260711*
```

Expected ownership:

```text
server/src/capitalFoundation/**
server/test/capitalFoundation/**
CAPITAL_SUPERVISION_COMPONENTS.md
CAPITAL_SUPERVISION_RECEIPT.md
```

Verify the actual final branch, SHA, implemented lanes, deterministic tests, scenario harness, and whether it remained dormant.

### Backend Foundation

Known separate checkout/branch family:

```text
/Users/cosmosgeek/Desktop/Main-backend-foundation-20260711-070056
backend-foundation-parallel-20260711-070056
```

Known historical pre-audit base:

```text
75c55ec2f9bb8f8a96fe6d788e877dd6fe4a8240
```

Known setup/frozen-contract checkpoints from the earlier handoff:

```text
99fb3e9
503b96a
```

Do not assume these are the final tips. Read the actual manifest, receipt, branch log, scope diff, and tests.

Because this line began before the security audit finished, it must **not** be merged wholesale into audited Main.

---

## 2. Completion target

This sprint succeeds only if it delivers all P0 outcomes.

### P0 — mandatory

1. A verified Git/source/test inventory for every source branch.
2. A fresh integration branch/worktree from current audited Main.
3. Market Intelligence integrated and green.
4. Live Intelligence Runtime integrated and green.
5. Capital Supervision integrated and green.
6. Selected Backend Foundation components adapted onto audited Main one checkpoint/domain at a time.
7. One canonical authority map and explicit adapters for every unavoidable contract boundary.
8. One managed runtime composition with deterministic startup/shutdown ordering.
9. One full live-public-data-to-dry-run vertical slice.
10. One canonical engine supervisor/read model.
11. Authenticated read/control APIs with live execution still blocked.
12. Existing ledger/database persistence for lifecycle decisions and checkpoints.
13. Restart reconciliation that blocks new exposure until truth is restored.
14. Minimal wiring into existing cockpit surfaces without redesigning them.
15. One complete test command and an end-to-end acceptance harness.
16. Clean commits, exact integration manifest, exact receipt, and exact remaining-money-path gaps.
17. A concise current-truth header in canonical project documentation so a fresh agent does not need historical chat.

### P1 — after P0 is fully green

- public no-key live smoke through the integrated chain;
- browser verification of every touched cockpit surface;
- bounded runtime performance/soak proof;
- read-only EC2 deployment preparation, but no production deployment unless separately authorized.

### Explicitly not part of this sprint

- live Spot, Futures, Margin, borrow, repay, transfer, or withdrawal actions;
- autonomous trading;
- production credential changes;
- AWS deployment or service restart;
- strategy retuning;
- UI redesign;
- a new scanner, engine, proposal system, ledger, database, or cache;
- claiming profitability from unit tests.

---

## 3. Mandatory Git safety gate

The director must first prove no writer is active in any checkout that will be touched.

Collect, for Main and every feature checkout/branch:

```bash
pwd
git status --short
git branch --show-current
git rev-parse HEAD
git log --oneline --decorate -20
git remote -v
```

Also record:

```bash
git worktree list --porcelain
git branch --all --contains <each-reported-tip>
git merge-base <audited-main-tip> <feature-tip>
git diff --stat <merge-base>..<feature-tip>
git diff --name-only <merge-base>..<feature-tip>
```

Rules:

1. Never integrate from screenshots or chat prose.
2. Every source line needs an actual branch/tip, manifest, receipt, scope diff, and green focused suite.
3. Preserve the source branches unchanged as recovery points.
4. Push source feature branches as backup only if authorized and not already pushed.
5. Create a fresh integration worktree/clone from the current audited Main tip.
6. Suggested branch:

```text
system-convergence-vertical-slice-20260711
```

7. Never develop this integration directly on `current-main`.
8. Never use `git reset --hard`, destructive clean, force push, or overwrite an unexplained working tree.
9. Preserve known input directives; do not accidentally include them in production commits.
10. Record every source and integration SHA in `SYSTEM_CONVERGENCE_RECEIPT.md`.

If any claimed branch has uncommitted implementation, finish/verify/commit it in its own source checkout before integration. Do not smuggle uncommitted patches into the integration worktree.

---

## 4. Integration order

Do not merge all branches and repair the explosion afterward.

Use this order:

### Step 1 — audited Main baseline

- clean build;
- complete current test suite;
- local application startup;
- record current routes and runtime status;
- security/perimeter regression baseline.

Commit only a baseline receipt if the directive itself is intentionally tracked. No production change yet.

### Step 2 — Market Intelligence

Integrate the verified Market Intelligence delta from its audited merge base.

Then run:

- build;
- all pre-existing suites;
- all Market Intelligence suites;
- its scenario harness;
- scope and static scans.

Checkpoint before continuing.

### Step 3 — Live Intelligence Runtime

Integrate only its delta after the verified Market Intelligence tip/merge base. Do not duplicate the Market Intelligence commits if the branch is stacked.

Then run:

- build;
- existing suites;
- Market Intelligence suites;
- all Live Runtime suites;
- its compatibility harness;
- no-network deterministic proof;
- optional public no-key smoke only after deterministic gates pass.

Checkpoint before continuing.

### Step 4 — Capital Supervision

Integrate only its delta after the verified Market Intelligence merge base. If it is a sibling of Live Runtime, use Git ancestry to integrate the unique commits without replaying the shared base.

Then run:

- build;
- existing suites;
- Market Intelligence and Live Runtime suites;
- all Capital Supervision suites;
- its cross-lane scenario harness;
- forbidden-authority/static scans.

Checkpoint before continuing.

### Step 5 — Backend Foundation, adapted rather than wholesale-merged

The Backend Foundation began on a pre-audit base. Treat its source branch as a component donor, not the new trunk.

For each component family:

1. inspect its exact diff and tests;
2. compare against post-audit Main owners;
3. select one canonical authority;
4. port/cherry-pick only the new component paths or reapply the minimal delta;
5. adapt its contracts to the integrated authority map;
6. run focused and complete tests;
7. commit that component separately;
8. continue only after green.

Recommended component order:

```text
foundation contracts/conformance
-> control plane
-> canonical read-model projection
-> multi-leg risk evaluator
-> execution planning/coordinator in dry-run only
-> reconciliation
-> USD-M read/test boundary with all actions disabled
-> diagnostics
-> replay/capture only after duplicate-owner review
-> optional borrow/calibration components only if complete and non-duplicative
```

Never reintroduce pre-audit versions of shared services, routes, account/order code, stream lifecycle, security middleware, cache/storage, or frontend files.

---

## 5. Canonical authority convergence

Before runtime wiring, create:

```text
SYSTEM_AUTHORITY_MAP.md
```

This is a required integration artifact, not general project history.

For every overlapping concept, record:

```text
concept
canonical owner/path
consumers
source branch alternatives found
adapter/translation path
loss/completeness behavior
persistence owner
runtime owner
test proving the choice
retired duplicate, if any
```

At minimum settle these authorities:

| Concept | Intended canonical owner |
|---|---|
| Basis/Volume strategy decision and proposal | existing strategy engines |
| market evidence/features/attention/thesis/outcome | Market Intelligence |
| public source acquisition/freshness/sequence/backpressure | Live Intelligence Runtime |
| opportunity capital eligibility/reservation/staging | Capital Supervision |
| active-position economic policy and attribution | Capital Supervision |
| desired/observed component state and control validation | Backend Foundation Control Plane |
| final multi-leg risk verdict | Backend Foundation multi-leg risk |
| mechanical order/leg lifecycle | Backend Foundation execution coordinator |
| exchange-versus-local truth | Backend Foundation reconciliation |
| durable event/checkpoint history | existing ledger/database |
| whole-machine canonical read model | integration supervisor projection over domain owners |
| signed exchange actions | future adapters; absent/blocked in this sprint |

Hard rules:

- one concept gets one canonical owner;
- domain modules may retain their own local statuses only through explicit adapters;
- no permanent duplicate stable-ID, decimal, timestamp, failure, freshness, lifecycle, approval, execution-leg, or reconciliation languages without a documented translation boundary;
- missing or lossy translation must remain explicit;
- do not rewrite all mature domain modules merely to make type names identical;
- adapters must be narrow, tested, and directional;
- integration code must not become a new strategy or risk authority.
- one canonical source registry must identify the owner of every semantic market stream;
- only one producer may publish a given semantic source stream into the composed runtime;
- existing and new Binance adapters may not both create competing sockets/caches for the same authority.

Every component and surface must use these release-status labels consistently:

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

`BUILT_AND_TESTED` never implies `WIRED`, and `WIRED` never implies `LIVE_PUBLIC`.

---

## 6. Allowed integration territory

Prefer a new namespace:

```text
server/src/systemIntegration/**
server/test/systemIntegration/**
```

Suggested structure:

```text
server/src/systemIntegration/
  contracts/
  adapters/
  composition/
  supervisor/
  persistence/
  routes/
  controls/
  verticalSlice/
  index.ts

server/test/systemIntegration/
  contracts/
  adapters/
  composition/
  supervisor/
  persistence/
  routes/
  controls/
  verticalSlice/
  fixtures/
```

Shared existing files may be edited only by the lead and only when required to connect verified components. Before editing each shared file, record the reason and expected behavior in the receipt draft.

Possible lead-only shared edits:

- the smallest server startup/composition seam;
- route registration;
- existing ledger/storage adapters;
- package scripts for the unified test command;
- narrow exports/barrels;
- existing frontend API types/hooks and page insertion points;
- current-truth documentation.

Do not make opportunistic cleanup, formatting, refactoring, component renaming, or visual changes during shared-file edits.

No subagent may edit a shared existing file. Subagents own disjoint new integration directories only.

---

## 7. Managed runtime composition

Build one explicit composition root. Imports must remain side-effect-free.

Required managed component identities should cover, where actually implemented:

```text
public-spot-source
public-usdm-source
market-universe
intelligence-runtime
market-intelligence
basis-engine
volume-engine
capital-supervision
multileg-risk
execution-coordinator-validate-only
reconciliation
ledger-persistence
engine-supervisor
```

Each managed component must expose through canonical adapters:

- stable component ID and owner;
- desired state;
- observed lifecycle state;
- readiness versus mere liveness;
- last source event time;
- last receive/process/success times where relevant;
- freshness/completeness;
- dependency state;
- queue/backpressure state where relevant;
- current errors and named blockers;
- restart count/generation;
- supported controls;
- whether capital is exposed;
- whether operator attention is required.

### Startup order

The control/ledger/supervisor shell must exist before data-driven components report ready.

Use dependency-driven startup, not arbitrary sleeps:

```text
persistence/control shell
-> public source lifecycle
-> universe and broad evidence
-> Market Intelligence warm-up
-> existing Basis/Volume engines
-> Capital Supervision advisory state
-> risk/execution/reconciliation validate-only services
-> supervisor READY only when required dependencies are truthfully ready
```

### Shutdown order

Reverse dependency order, with active/exposed state preserved for restart and no new decisions accepted during drain.

### Failure containment

- one optional enrichment failure cannot kill broad observation;
- one strategy engine failure cannot erase the other;
- an intelligence failure blocks new capital decisions that require it;
- active-position supervision must remain visible even when new entries are paused;
- reconciliation uncertainty blocks new/increasing exposure;
- the whole app must not report green because the Node process exists;
- every degraded state must identify the first actionable blocker.

---

## 8. First complete vertical slice

Build one end-to-end path using real public data and blocked/dry-run downstream authority.

### 8.1 Broad observation

- start explicitly managed public Spot and USD-M sources;
- establish universe/coverage truth;
- separate source, receive, process, and snapshot time;
- surface silent/stale/gap/rate-limit states;
- retain quiet symbols;
- do not create a second canonical cache if existing source state is authoritative.

### 8.2 Intelligence

- feed normalized evidence into Market Intelligence;
- update broad features and attention;
- request and fulfill bounded focus enrichment;
- create thesis/forensics input only when evidence is sufficient;
- preserve correlation from source event through intelligence output;
- capture pre/post-trigger evidence through the correct existing owner.

### 8.3 Existing engines

- consume Basis and Volume decisions/proposals from their existing owners;
- never recalculate their strategy scores in integration code;
- expose accepted/rejected/invalidated decisions with exact reasons;
- map proposals into canonical integration references without losing source IDs or revision.

### 8.4 Capital Supervision

- derive allocatable truth only from supplied account/capital snapshots;
- maintain advisory/reservation/staged-mandate state;
- keep unknown account/cost truth explicit;
- keep Volume in advisory/validate-only unless its own verified policy grants more;
- generate active-position policy only from observed/reconciled exposure;
- never self-approve risk or execute.

### 8.5 Operator authority

Support only:

```text
READ_ONLY
ADVISORY
VALIDATE_ONLY
```

`LIVE_MANUAL` and autonomous modes must return a stable blocked result such as:

```text
LIVE_EXECUTION_NOT_IMPLEMENTED
```

Approval must remain scoped, expiring, revocable, versioned, and bound to the exact proposal/mandate/config revision.

### 8.6 Risk and dry-run execution planning

- submit the exact staged mandate through an adapter to multi-leg risk;
- produce approve/reject/cap truth from the canonical risk owner;
- if permitted in `VALIDATE_ONLY`, produce a deterministic two-leg execution plan;
- drive the coordinator only with fake/dry-run venue ports;
- expose planned legs, filters, dependencies, recovery states, and correlation IDs;
- no signed request or test order may leave the process.

### 8.7 Reconciliation projection

- compare intended plan/fake events with observed fixtures;
- prove partial, ambiguous, one-leg, and divergent states;
- block new exposure during unresolved truth;
- preserve risk-reducing recommendations;
- persist the checkpoint and reason.

### 8.8 Ledger and read model

Write the existing ledger/database events for:

- source lifecycle and material gaps;
- evidence/thesis/proposal references;
- capital eligibility/allocation/reservation;
- approval/config revision;
- risk verdict;
- dry-run execution plan/state;
- reconciliation result;
- supervisor/control transition;
- failures and operator actions.

Do not persist raw high-rate market events into the operational ledger unless an existing bounded capture owner explicitly requires them.

### 8.9 Cockpit truth

Expose the complete trace through one canonical supervisor snapshot and existing pages. The UI must not recompute engine, risk, capital, or health truth independently.

---

## 9. Canonical supervisor and dependency graph

Build one whole-machine read projection owned by integration, composed from domain-owned snapshots.

It must expose:

```text
overall posture
current mode and kill-switch posture
startup generation
component nodes and dependency edges
desired versus observed state
readiness, freshness, and completeness
universe and source coverage
Basis/Volume heartbeat and counts
intelligence attention/focus state
candidate/proposal/rejection counts
capital budget/reservation/active exposure state
risk/execution/reconciliation state
ledger/persistence state
current blockers and root causes
recent correlated decisions
operator-attention queue
live/synthetic/dry-run/unavailable labels
```

Health aggregation laws:

- `READY` is not inferred from process existence;
- optional degradation is not total failure;
- required dependency failure blocks only dependent capability;
- exposed capital raises severity and priority;
- unknown truth cannot be green;
- root cause is preserved rather than replaced by cascaded symptoms;
- synthetic/dry-run events can never be labeled live;
- old events cannot masquerade as current state.

The graph must be serializable and render-ready for the existing cockpit.

---

## 10. API and safe control surface

Use the audited authentication, same-origin, bounded-input, and operator-middleware conventions already present in Main.

Final route names should follow existing repository style, but the capability set must include:

### Read APIs

```text
GET supervisor snapshot
GET component/dependency graph
GET recent correlated decisions/events
GET current controls/config revisions
GET vertical-slice trace by correlation ID
```

### Mutation APIs

```text
set desired component state
pause/resume new strategy intake
set READ_ONLY / ADVISORY / VALIDATE_ONLY mode
activate/deactivate kill switch
apply bounded versioned configuration
revoke an approval/reservation
request safe component restart
```

Mutation requirements:

- authenticated operator only;
- same-origin/CSRF posture consistent with audited Main;
- strict schema and bounds;
- idempotency key;
- optimistic config revision;
- reason/comment;
- ledger event;
- before/after snapshot;
- exact applied/rejected result;
- no arbitrary command, shell, file, environment, or network target;
- no control capable of enabling live execution.

Control asymmetry:

- pause/kill blocks new and risk-increasing activity;
- it never hides active exposure;
- it never disables supervision;
- it never silently prevents a separately authorized risk-reducing recommendation;
- mechanical recovery remains external and blocked unless explicitly available through canonical Foundation policy.

---

## 11. Persistence and restart truth

Adapt new domains to the existing ledger/database. Do not create a second persistent store.

Persist or reconstruct at minimum:

- component desired state and generation;
- mode and kill-switch transitions;
- config revisions;
- proposal/capital-mandate references;
- reservations and releases;
- approvals/revocations/expiry;
- dry-run execution checkpoints;
- reconciliation results;
- active-position policy checkpoints if any observed exposure exists;
- recent correlated trace index;
- last clean shutdown/startup result.

Restart behavior:

1. load persisted desired/config state;
2. start control, ledger, and read shell;
3. restore domain checkpoints;
4. refresh live public source truth;
5. refresh account/private truth only through existing safe read adapters;
6. reconcile any planned/exposed/ambiguous state;
7. block new/increasing exposure until required truth is fresh and consistent;
8. continue displaying and supervising any existing exposure;
9. only then mark dependent capabilities ready.

Prove crash/restart at multiple lifecycle points. No reservation, approval, or action may execute twice because of replay.

---

## 12. Minimal cockpit wiring

Do not redesign the UI. Use the existing visual system and pages.

Wire the smallest truthful surfaces:

### Dashboard

- overall posture;
- component chain summary;
- Basis/Volume/Intelligence live ages;
- opportunity/proposal/capital counts;
- active exposure and operator attention;
- last material blocker.

### Health

- full dependency graph/list;
- desired versus observed state;
- source freshness/gaps/backpressure;
- restart generation;
- root-cause details;
- explicit live/dry-run/synthetic/unavailable labels.

### Opportunities

- source proposal identity;
- eligibility/allocation/reservation/stage;
- approval and risk status;
- exact block/reject reasons;
- correlation link to evidence and trace.

### Risk

- canonical kill switch and safe mode;
- bounded config revision;
- multi-leg verdicts;
- rejected decisions;
- no duplicate risk controls.

### Execution

- dry-run/validate-only plan;
- legs and coordinator state;
- reconciliation status;
- explicit `LIVE_EXECUTION_NOT_IMPLEMENTED` barrier.

### Logs

- correlated domain events and failures;
- filter by component, proposal, mandate, execution, reconciliation, and correlation ID.

If a dedicated Control page already exists, use it. Otherwise add only the smallest integration surface needed to expose real bounded controls. Do not create decorative buttons.

Every control shown must map to a tested mutation. Every state shown must come from the canonical supervisor snapshot.

---

## 13. Required integration scenarios

Build one deterministic no-network integration harness covering at least:

1. clean cold start through READY in dependency order;
2. public Spot unavailable while Futures remains live;
3. public Futures unavailable while Spot remains live;
4. socket open but silent becomes degraded/stale;
5. sequence gap invalidates focused book and requests resync;
6. quiet symbol remains in universe;
7. dormant-to-active evidence promotes bounded focus;
8. one-print noise is rejected;
9. Basis proposal preserves engine identity/revision;
10. Volume proposal remains advisory under restricted policy;
11. insufficient/stale account truth blocks capital reservation;
12. competing opportunities cannot double-reserve capital;
13. scoped approval reaches VALIDATE_ONLY risk evaluation;
14. approval expiry/revocation/config mismatch blocks progression;
15. multi-leg risk reject stops before the coordinator;
16. accepted risk produces a dry-run plan only;
17. any attempted live mode remains mechanically blocked;
18. kill switch blocks new/add activity;
19. kill switch leaves supervision and reduction/exit recommendations visible;
20. partial/one-leg fixture produces recovery-required truth;
21. reconciliation divergence blocks new exposure;
22. ledger trace contains every material transition exactly once;
23. restart before reservation restores safely;
24. restart after reservation does not allocate twice;
25. restart after dry-run partial event requires reconciliation;
26. optional enrichment failure does not kill broad observation;
27. one engine failure does not erase the other;
28. root-cause graph identifies the first real blocker;
29. UI/API snapshot labels dry-run and synthetic truth correctly;
30. graceful shutdown closes transports and persists final checkpoints.

Add a bounded public no-key smoke after deterministic tests:

```text
real public message
-> source health
-> normalized evidence
-> intelligence update
-> engine snapshot/proposal observation where naturally available
-> supervisor/API/cockpit display
```

Do not fabricate a proposal merely to make the public smoke look complete. The deterministic harness proves the entire downstream chain; the public smoke proves the real-data prefix and honest state.

---

## 14. Unified tests and commands

Create or repair explicit scripts following repository conventions:

```text
test:app
test:engine:basis
test:engine:volume
test:intelligence
test:intelligence:runtime
test:capital
test:foundation
test:integration
test:all
```

Do not assume historical counts remain exact after integration. Record baselines and require that no suite silently disappears.

Final verification order:

1. clean install state already present; do not upgrade dependencies casually;
2. clean server and web build;
3. each focused suite independently;
4. deterministic integration harness;
5. unified `test:all`;
6. unified `test:all` a second time to expose order dependence;
7. static forbidden-authority/import scan;
8. security/perimeter regression suite;
9. local application startup;
10. authenticated API checks;
11. browser page-by-page verification of touched surfaces;
12. restart/recovery run;
13. optional bounded public no-key smoke;
14. final diff and receipt verification.

Tests must fail with scenario/invariant context, not only counts.

---

## 15. Security and financial safety regression gate

The integration must preserve the completed audit hardening.

Explicitly verify:

- loopback/default binding posture;
- operator authentication for private APIs;
- same-origin mutation checks;
- bounded JSON and pagination;
- WebSocket/SSE authentication and backpressure;
- bounded ledger/event queries;
- strict control/config inputs;
- no implicit network refresh from read routes;
- graceful shutdown;
- no secrets in source, logs, receipts, snapshots, or client bundles;
- no browser-held Binance credentials;
- no route to arbitrary AWS/system commands;
- live execution mode cannot be enabled by environment, config, API, or UI;
- all outbound private/money-moving calls remain absent or hard-blocked;
- kill switch is fail-closed for new risk;
- unknown reconciliation/account truth blocks new exposure;
- dry-run/synthetic state cannot be mistaken for exchange truth.

Run a focused diff/security review over the entire integration branch before acceptance.

---

## 16. Commit and review sequence

Recommended checkpoints:

1. `integration: record verified source branches and authority map`
2. `integration: converge market intelligence and live runtime`
3. `integration: converge capital supervision`
4. `integration: adapt foundation control risk execution and reconciliation`
5. `integration: compose managed runtime and persistence`
6. `integration: wire supervisor APIs and validate-only vertical slice`
7. `web: expose truthful engine supervisor and controls`
8. `test: prove convergence vertical slice and restart safety`
9. `docs: record convergence manifest receipt and remaining gaps`

After every checkpoint:

- review the entire diff;
- run affected focused suites;
- run build;
- run the current unified regression command;
- verify no unintended files;
- record the SHA and checks in the receipt draft.

Only the lead stages and commits shared integration work.

---

## 17. Required artifacts

Create:

```text
SYSTEM_AUTHORITY_MAP.md
SYSTEM_CONVERGENCE_COMPONENTS.md
SYSTEM_CONVERGENCE_RECEIPT.md
```

After every acceptance gate passes, update only the concise current-truth portions of:

```text
ENGINE.md
PROJECT_MEMORY.md
```

If the repository has no bounded current-state entry point, create a concise `CURRENT_STATE.md` and link it from `README.md`/`AGENTS.md` using the smallest possible edit. Do not append another enormous chronological diary. The current-state entry must identify each component as built, imported, wired, live-public, synthetic-only, blocked, not configured, or missing.

### `SYSTEM_CONVERGENCE_COMPONENTS.md`

For every component include:

- canonical component ID;
- owner/path;
- source branch/SHA;
- responsibility/non-responsibility;
- inputs/outputs;
- persistence owner;
- desired/observed lifecycle;
- dependencies;
- controls;
- health/freshness semantics;
- tests;
- UI/API consumer;
- live/synthetic/dry-run status;
- remaining wiring.

### `SYSTEM_CONVERGENCE_RECEIPT.md`

Include measured facts:

- all source repository paths, branches, bases, and tips;
- merge bases and unique deltas;
- exact integration branch/worktree;
- every integration checkpoint SHA;
- conflicts and how authority was resolved;
- exact files changed;
- shared-file justification list;
- build command/result;
- every focused test command/count;
- both unified test runs;
- static/security scan results;
- runtime startup/shutdown evidence;
- public smoke result;
- API/browser verification;
- restart/reconciliation evidence;
- dormant/blocked/live capability matrix;
- exact remaining path to signed validation and money;
- final Git status and push state.

No line-count victory report. No claim is accepted without Git/test/runtime evidence.

---

## 18. Acceptance gate

Do not report complete unless every P0 statement is true:

- all claimed source branches and receipts were verified;
- integration began from current audited Main;
- source branches remain recoverable and unchanged;
- Market Intelligence is integrated and green;
- Live Intelligence Runtime is integrated and green;
- Capital Supervision is integrated and green;
- selected Backend Foundation components were adapted without reverting audit fixes;
- one authority map exists and every duplicate concept is resolved or explicitly adapted;
- one managed composition root owns startup/shutdown;
- the public-data-to-dry-run chain works in deterministic integration tests;
- real public data reaches the integrated supervisor during optional smoke when network access permits;
- Basis and Volume retain their strategy authority;
- Volume cannot silently gain live-money authority;
- Capital Supervision cannot self-approve risk or execute;
- multi-leg risk and coordinator have one canonical owner;
- reconciliation uncertainty fails closed;
- ledger/checkpoint events persist and replay idempotently;
- restart blocks unsafe new exposure until truth is restored;
- supervisor/API exposes exact live/stale/blocked/degraded state;
- every mutation is authenticated, bounded, versioned, and ledgered;
- live execution remains mechanically unreachable;
- existing cockpit surfaces render canonical truth without strategy duplication;
- build and every focused suite pass;
- `test:all` passes twice;
- security/perimeter regression passes;
- local startup, shutdown, and restart pass;
- manifests/receipts match actual Git and runtime state;
- the integration working tree is clean;
- nothing is merged to the default branch or deployed without separate owner authorization.

If a source branch is incomplete, a contract cannot be safely converged, or a mandatory P0 gate fails, report `PARTIAL` with the exact blocker. Do not create fake adapters or weaken safety to claim completion.

---

## 19. What remains after this sprint

If this sprint succeeds, the project will finally be one observable validate-only system rather than several tested organ libraries.

The remaining major work will be narrower and concrete:

1. **Complete authenticated private account truth** — Spot, USD-M, Margin, permissions, balances, liabilities, fees, funding, borrow capacity/cost, source freshness, and user-data reconciliation.
2. **Concrete signed exchange adapters** — Spot and USD-M order/test-order/cancel plus Margin borrow/repay boundaries, exact filters, clock synchronization, idempotency, and rate limits.
3. **Two-leg live-recovery validation** — partial fills, ambiguous submissions, one-leg exposure, hedge/reduce-only recovery, emergency unwind, and exchange reconciliation.
4. **Real outcome collection/calibration** — preserve live event windows, realistic fill/cost assumptions, false positives, missed opportunities, out-of-sample/no-look-ahead validation, and strategy promotion/retirement gates.
5. **Full operator control room** — expand from the first truthful graph into every safe bounded control required by the mission; no decorative toggles.
6. **Deployment and external watchdog** — EC2/systemd, Cloudflare operator boundary, backups, data retention, alerting, rollback, and out-of-process liveness.
7. **Signed validation mode** — exchange-valid test requests with zero matching-engine exposure.
8. **Smallest manually approved capital trial** — only after every preceding safety, reconciliation, supervision, and recovery gate is proven.

Even then, software correctness does not prove positive expectancy. Capital promotion requires observed outcomes and operational reliability.

---

## 20. Exact instruction to give Claude Code

```text
Act as the director for SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md. The reported Market Intelligence, Live Intelligence Runtime, Capital Supervision, and separate Backend Foundation builds must be verified from actual Git branches, manifests, receipts, diffs, and test runs before integration. Do not trust screenshots or chat claims. Ensure no checkout has an active writer, preserve every source branch unchanged, and create a fresh system-convergence-vertical-slice-20260711 worktree from the current audited Main tip. Launch one Codex lead to execute the directive using bounded collision-free subagents. Integrate Market Intelligence, Live Runtime, and Capital deltas in verified ancestry order. Never merge the pre-audit Backend Foundation wholesale; adapt its components one authority at a time while preserving all audit hardening. Build one canonical authority map, one managed composition root, one live-public-data-to-VALIDATE_ONLY dry-run vertical slice, one ledgered supervisor/API/control surface, restart-safe persistence, minimal truthful cockpit wiring, and one complete test command. No live/test order may leave the process, no money action, no deployment, no secret change, and no UI redesign. Require build, every focused suite, two full unified runs, security regressions, local startup/browser/restart checks, exact checkpoint commits, and the final manifest/receipt. Stop only for a real source-of-truth, safety, or unexplained-working-tree blocker; otherwise continue through the P0 acceptance gate.
```

---

## 21. Exact instruction for the Codex lead

```text
Execute SYSTEM_CONVERGENCE_VERTICAL_SLICE_MAX_POWER_SPRINT.md completely in a fresh integration worktree from the verified current audited Main tip. Start with Git/receipt/test discovery for every claimed source branch and write the authority map before production wiring. Preserve all source branches. Integrate only verified unique deltas in ancestry order. Treat the pre-audit Backend Foundation as a component donor and adapt it one domain at a time; never merge it wholesale or overwrite audit fixes. Then build the systemIntegration adapters, managed composition, persistence, supervisor, authenticated safe controls, VALIDATE_ONLY vertical slice, and minimal existing-cockpit wiring. Existing engines remain strategy authorities; Intelligence owns evidence; Live Runtime owns source truth; Capital owns allocation/position policy; Foundation owns control/risk/execution/reconciliation; the existing ledger owns durable history. Live execution must remain mechanically unreachable, and no private/money-moving call may leave the process. Use bounded subagents only for exclusive new directories; the lead alone edits shared files and commits. Run every focused suite plus test:all twice, security regressions, local startup/browser/shutdown/restart checks, and the optional public no-key smoke. Finish with clean commits, SYSTEM_AUTHORITY_MAP.md, SYSTEM_CONVERGENCE_COMPONENTS.md, SYSTEM_CONVERGENCE_RECEIPT.md, and an exact list of remaining signed-validation/live-money gaps. Do not claim success from line count or compilation alone.
```

---

## 22. Final response format

```text
SYSTEM CONVERGENCE + VERTICAL SLICE — RESULT

Audited Main path/branch/tip:
Market Intelligence branch/tip/receipt:
Live Runtime branch/tip/receipt:
Capital Supervision branch/tip/receipt:
Backend Foundation path/branch/base/tip/receipt:
Integration worktree/branch/base:

Source-branch verification:
Authority conflicts found:
Authority decisions/adapters:
Integrated components:
Skipped/rejected components:
Shared files changed and why:

Build:
Existing app tests:
Basis tests:
Volume tests:
Market Intelligence tests:
Live Runtime tests:
Capital tests:
Foundation tests:
Integration scenarios:
First test:all:
Second test:all:
Security/perimeter regressions:

Local startup:
Public no-key smoke:
Supervisor/API:
Browser surfaces:
Shutdown/restart/reconciliation:
Ledger/checkpoint proof:

Live-money authority:
Private calls made:
Secrets touched:
Deployment performed:

Checkpoint SHAs:
Final SHA:
Git status:
Push status:

What is now genuinely live:
What remains dry-run/synthetic:
What remains unavailable:
Exact remaining signed-validation/live-money work:
```
