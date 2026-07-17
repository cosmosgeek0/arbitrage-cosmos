# IP-RUNTIME — Runtime Assembly Pre-Stage

**Parent authority:** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`  
**Status:** subordinate packet; never a controlling program  
**Purpose:** prepare the server-side adapters, supervisor contracts, lifecycle composition, persistence requests, and insertion plan without touching active Q/L worktrees or director-owned shared files

---

## 1. When this may run

This packet may run while Q and L continue if:

- the shared edge protocol and authority maps are frozen;
- Q/L accepted interfaces needed by this packet can be read from immutable commits;
- the worker uses a separate worktree;
- the worker receives exclusive additive paths;
- no shared startup, route, package, database, Q, L, or current-main file is edited.

If Q/L interfaces are incomplete, build protocol-driven ports, fixtures, conformance tests, and insertion requests. Do not guess final imports or fabricate an implementation.

## 2. Allowed ownership

Prefer an additive equivalent of:

```text
server/src/productIntegration/contracts/**
server/src/productIntegration/adapters/**
server/src/productIntegration/lifecycle/**
server/src/productIntegration/supervisor/**
server/src/productIntegration/commands/**
server/src/productIntegration/fixtures/**
server/test/productIntegration/**
IP_RUNTIME_STATE.md
IP_RUNTIME_RECEIPT.md
IP_RUNTIME_SHARED_INSERTION_REQUEST.md
```

Forbidden:

```text
server/src/index.ts
server/src/ledger.ts
server/src/types.ts
server/package.json
root package files
existing route registries
existing database migrations
web/**
quant/**
live-edge/**
active Q/L worktrees
current-main
```

## 3. Required outputs

### 3.1 Product runtime protocol

Define typed, side-effect-free ports for:

```text
component lifecycle
Q assessment consumer
Basis/Volume snapshot consumer
opportunity authority
Capital/Risk verdict consumer
L ticket/execution/reconciliation consumer
position/recovery consumer
outcome feedback
ledger persistence port
operator command port
machine supervisor projection
operator event stream
```

Preserve unknown/stale/synthetic/live semantics.

### 3.2 Component graph

Implement deterministic graph/projection logic for:

- desired and observed state;
- required and optional dependencies;
- liveness versus readiness versus trade readiness;
- heartbeat and last meaningful advance;
- source/event/processing age;
- queue/backpressure/drop state;
- root blocker propagation;
- exposed-capital severity;
- supported command IDs;
- build/config/schema/model revisions.

No graph node becomes green because an object exists.

### 3.3 Lifecycle planner

Implement pure dependency plans for:

- boot;
- pause intake;
- maintenance drain;
- graceful shutdown;
- safe component restart;
- recovery-only posture;
- restart reconciliation.

The planner emits intended operations. It does not mutate real components in this packet.

### 3.4 Adapter seams

Produce narrow adapter interfaces and fixtures for accepted:

- Q advisory protocol;
- existing Basis/Volume engines;
- Capital/Risk;
- L private/execution/recovery;
- existing ledger/database;
- accepted dashboard client contract.

Never duplicate domain logic.

### 3.5 Persistence plan

Produce exact director-owned schema/migration requests for missing durable objects:

```text
component desired state
commands/idempotency/results
config revisions
opportunity/capital/risk references
tickets/legs/ambiguous mutations
positions/liabilities/recovery
incidents/acknowledgements
model/outcome references
boot/shutdown/deployment revisions
```

Do not edit the canonical DB migration owner.

### 3.6 Shared insertion plan

Record exact minimal edits the director will later make to:

- server composition root;
- startup/shutdown;
- route registration;
- ledger/database registration;
- package exports/scripts;
- WebSocket/SSE delivery;
- current-state documentation.

## 4. Tests

Prove with injected clocks and fixtures:

- dependency ordering;
- root blocker selection;
- stale/unknown truth never green;
- Q unavailable degrades without authorizing money;
- analytical failure preserves recovery;
- duplicate command idempotency;
- stale revision rejection;
- event cursor continuity;
- restart plan blocks entries before reconciliation;
- serialization round trips;
- no network, env, secret, timer, filesystem, or side-effect imports in pure modules.

## 5. Acceptance

IP-RUNTIME is `PRESTAGE_READY` only when:

- all additive code/tests pass;
- no forbidden path changed;
- no Q/L/shared authority was duplicated;
- incomplete interfaces remain explicit ports;
- insertion request lists exact future shared edits;
- state and immutable receipt identify commit and protocol hashes;
- the final director can replace fixtures with accepted Q/L adapters without rewriting IP-RUNTIME.

Do not call IP-RUNTIME integrated, running, or live.

## 6. Exact worker prompt

```text
Read IP_RUNTIME.md and the parent I00 directive. Work only in the director-created
IP-RUNTIME worktree and exclusive additive paths. Q/L are active and read-only. Build the
runtime contracts, pure supervisor/lifecycle projections, protocol adapters,
fixtures, tests, and exact shared insertion request. Do not touch startup, routes,
packages, canonical persistence, web, Q, L, current-main, network, secrets, or any
external system. Finish with code, tests, adversarial review, commit, IP_RUNTIME_RECEIPT.md,
IP_RUNTIME_STATE.md, and stop clean at PRESTAGE_READY or a precise blocker.
```
