# IP-CONTROL — Control Room Binding

**Parent authority:** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`  
**Status:** subordinate packet; presentation and client binding only  
**Purpose:** turn the one accepted fixture dashboard/control-room shell into a canonical client package ready for director mounting, without rebuilding the visual design or inventing backend truth

---

## 1. Donor and collision law

There is exactly one shell donor.

If a dashboard/F-lane shell is active, wait for its accepted clean checkpoint before consuming its paths.

If it is already accepted, use its actual branch/receipt as the donor.

Do not create another dashboard shell, another state file, or another component catalog.

Q/L and current-main remain read-only.

## 2. When this may run

IP-CONTROL may run in parallel with Q/L against:

- frozen `docs/DASHBOARD_TRUTH.md`;
- accepted design tokens/components;
- accepted shell donor;
- frozen product supervisor/client contract or IP-RUNTIME fixtures;
- frozen command registry schema.

Real mounting into `App`, router, store, existing pages, and shared styles remains director-owned after adapter contracts freeze.

## 3. Allowed ownership

Use the accepted shell paths when they already exist. Otherwise the director assigns additive equivalents under:

```text
web/src/features/productControlRoom/**
web/src/lib/productIntegration/**
web/test/productControlRoom/**
IP_CONTROL_STATE.md
IP_CONTROL_RECEIPT.md
IP_CONTROL_MOUNT_REQUEST.md
```

Forbidden:

```text
web/src/App.tsx
web/src/store.tsx
router/navigation owners
existing page source
shared global styles
server/**
quant/**
live-edge/**
package manifests
current-main
```

## 4. Required output

### 4.1 Five-second owner view

Show from fixtures/contracts:

- machine running/ready/trade-ready;
- desired/effective mode;
- exposed capital and unresolved recovery;
- data freshness;
- top root blocker;
- active opportunity/ticket/position;
- latest material change;
- tested/deployed/model/config revision.

### 4.2 Machine graph

Render nodes and dependency edges with:

- desired/observed lifecycle;
- capability posture;
- heartbeat/last advance;
- source/event/processing age;
- queue/backpressure;
- blocker and root cause;
- capital relevance;
- supported controls;
- correlation trace.

### 4.3 Control registry UI

Every rendered control includes:

```text
controlId
backendCommandId
wiringState
owner
safe bounds
current desired/effective value
authority
preview
digest/revision confirmation
result/receipt
```

Only `WIRED_LIVE` is functional in the final route. Fixture controls remain visibly `SYNTHETIC`. Pending/unavailable/owner-gated controls are disabled with reason.

### 4.4 Complete surface adapters

Prepare page-ready bindings for:

```text
Dashboard
Control Room
Account
Markets
Token
Basis
Volume
Opportunities
Borrow
Execution/Orders/Positions/Fills/PnL
Risk
Health
Logs/Ledger
Notifications
```

Do not redesign these pages. Produce the smallest mount request for each existing insertion point.

### 4.5 Log-flood protection

The client consumes:

- one versioned supervisor snapshot;
- a gap-free monotonic material-event cursor;
- bounded trace/log queries;
- grouped incidents/notifications.

Do not stream every market tick or raw debug log into React.

### 4.6 Required fixtures

```text
HEALTHY_OBSERVE
DEGRADED_STALE_SOURCES
VALIDATE_ONLY_SLICE_RUNNING
RECOVERY_REQUIRED_ONE_LEG
TINY_LIVE_CANARY_OWNER_GATED
```

Fixtures tick and transition. All fixture surfaces carry a persistent synthetic label.

## 5. Acceptance

Run:

```text
typecheck
build
focused component/contract tests
light and dark browser checks
representative desktop and narrow layouts
zero overflow
zero console errors
reduced-motion check
truth-label adversarial review
```

IP-CONTROL is `BINDING_READY` only when:

- one shell donor exists;
- every control has stable wiring truth;
- active exposure/recovery cannot be missed;
- one correlation trace is readable;
- every existing operational surface has an adapter/mount row;
- unsupported capability is visibly unavailable;
- no shared file was edited;
- mount requests are exact and minimal;
- commit, state, receipt, screenshots, and donor SHA are recorded.

## 6. Exact worker prompt

```text
Read IP_CONTROL.md and the parent I00 directive. Verify and use the one accepted
dashboard shell donor; do not rebuild it. Work only in the director-created IP-CONTROL
worktree and exclusive additive paths. Build canonical supervisor/command client
bindings, machine graph, control lifecycle, full surface adapter package, fixtures,
tests, and exact App/store/router/page mount requests. Preserve the existing design.
Do not edit server, Q/L, App, store, existing pages, shared styles, packages, or
current-main. Finish with browser evidence, commit, IP_CONTROL_RECEIPT.md, IP_CONTROL_STATE.md,
and stop clean at BINDING_READY or a precise blocker.
```
