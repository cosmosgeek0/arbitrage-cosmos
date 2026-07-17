# IP-PROOF — Product Closure Proof

**Parent authority:** `I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md`  
**Status:** subordinate packet; acceptance machinery and closure evidence  
**Purpose:** pre-build the combined I00 harness, mission coverage, no-terminal, autonomy, interface, capacity, and no-surprises checks so the final Fable director spends scarce time integrating and correcting rather than inventing acceptance after Q/L finish

---

## 1. When this may run

IP-PROOF may run in parallel with Q/L against frozen protocols, authority maps, dashboard truth, accepted receipts, and fixtures.

It must not integrate moving lane code or edit production composition.

When final accepted Q/L/IP-RUNTIME/IP-CONTROL/IP-OPS tips exist, the director replaces fixtures with real adapters and reruns the same harness.

## 2. Allowed ownership

Prefer additive equivalents of:

```text
test/i00/**
server/test/i00Acceptance/**
fixtures/i00/**
integration/reports/**
IP_PROOF_STATE.md
IP_PROOF_RECEIPT.md
MISSION_COVERAGE_MATRIX.md
AUTONOMY_CLOSURE_REPORT.md
NO_TERMINAL_DEPENDENCY_REPORT.md
RESOURCE_AND_BACKPRESSURE_REPORT.md
OFFICIAL_INTERFACE_MATRIX.md
IP_PROOF_SHARED_INSERTION_REQUEST.md
```

Forbidden:

```text
production startup/routes/persistence/pages
Q/L implementation
shared package files
external systems
secrets
current-main
```

## 3. Authority and protocol proof

Build checks for:

- duplicate semantic owners/imports;
- one public source producer per semantic stream;
- one Capital/Risk/exchange-hand/ledger/control authority;
- Q protocol/client parity;
- timestamp/freshness/completeness semantics;
- stable identity/correlation graph;
- decimal/filter law;
- invalid/expired/conflicting messages;
- live/synthetic/replay/unknown truth labels.

The harness reports conflicts; it does not choose authority.

## 4. Combined fixture chain

Prove:

```text
public evidence
-> attention/Q
-> existing Basis or Volume decision
-> opportunity
-> Capital
-> Risk
-> ticket/policy
-> exchange twin
-> private truth/reconciliation
-> position/recovery
-> PnL/outcome
-> feedback
-> supervisor/cockpit trace
```

Include at minimum:

- quiet/no-op;
- Q abstention from incomplete data;
- normal Basis pass and invalidation;
- reverse Basis missing borrow;
- reverse Basis residual liability;
- Volume proposal and false-burst rejection;
- stale public/private/Q truth;
- ambiguous submission;
- partial first leg;
- kill during entry;
- crash/restart/reconciliation;
- DB failure before and after request;
- duplicate command and stale revision;
- incident flood grouping;
- deployment mismatch and restore drill.

## 5. Closure reports

### Mission coverage

Trace every binding mission requirement to owner, code, wiring, persistence, API, cockpit, control, test, scenario, SHA, status, and blocker.

### Autonomy closure

Prove or block sensing through learning, operator control, deployment, watchdog, restart, and rollback.

### No terminal dependency

Classify every routine shell/manual operation and require cockpit control or explicit owner runbook.

### Resource/backpressure

Define measurement harness and load-shedding priority. Active-position supervision, reconciliation, recovery, ledger, and operator control outrank optional work.

### Official interfaces

Pin official pages, access dates, hosts/routes, auth, schemas, lifetimes, limits, weights, chosen/rejected implementations, and changelog risks. SBE remains benchmark-first optional.

## 6. No-surprises gate

Generate evidence-backed answers:

```text
Can it run?
Can it see?
Can it think honestly?
Can it control money?
Can it survive failure?
Can the owner operate it without routine terminal work?
Can it run continuously and roll back?
Can it learn from outcomes?
Is any heavyweight mission requirement absent?
```

No missing required row may be called “forgotten.” It is completed or explicitly blocked with owner and impact.

## 7. Acceptance

IP-PROOF is `PROOF_PRESTAGE_READY` only when:

- fixture chain and failure cases run deterministically;
- authority/protocol scans run;
- report templates are generated from evidence, not prose alone;
- capability/page/control matrices are machine-checkable;
- final adapter replacement points are explicit;
- no production or lane source changed;
- all tests pass;
- commit, state, receipt, hashes, and next integration command are recorded.

Only the director’s final real-adapter I00 run may mark `INTEGRATED_ACCEPTED`.

## 8. Exact worker prompt

```text
Read IP_PROOF.md and the parent I00 directive. Work only in the director-created
IP-PROOF worktree and exclusive test/fixture/report paths. Build the authority/protocol
scans, combined fixture chain, failure campaigns, mission/autonomy/no-terminal/
resource/interface closure reports, and no-surprises gate. Do not edit production,
Q/L, shared files, packages, current-main, secrets, or external systems. Finish
with deterministic tests, adversarial review, commit, IP_PROOF_RECEIPT.md, IP_PROOF_STATE.md,
and exact real-adapter insertion request. Stop clean at PROOF_PRESTAGE_READY or a
precise blocker.
```
