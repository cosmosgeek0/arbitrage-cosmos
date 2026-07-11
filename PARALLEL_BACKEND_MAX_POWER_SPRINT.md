# PARALLEL BACKEND MAX-POWER SPRINT

**Project:** Cosmos Arbitrage Control Room  
**Purpose:** Build the missing backend foundation while the long security/stability audit continues in the original `Main` checkout.  
**Director:** one fresh Fable 5 / Claude Code director  
**Builder:** one fresh Codex 5.6 Ultra lead with bounded subagents  
**Mode:** isolated local clone, dormant modules, deterministic tests, no production wiring  
**Outcome:** a feature branch that can be reconciled onto the audit's final checkpoint later without overwriting the audit or the approved UI.

---

## 0. The operating decision

The active audit owns:

```text
/Users/cosmosgeek/Desktop/Main
```

Treat that folder as **read-only** for this sprint.

Do not use its uncommitted working tree.  
Do not wait for the audit.  
Do not create a second writer inside it.  
Do not stash, reset, clean, move, or commit the audit's files.  
Do not create a Git worktree that asks the active audit checkout to share files or ownership decisions.

Instead, take the current **committed HEAD only** from `Main`, create a completely independent local clone, and build new dormant modules there. The audit's uncommitted changes are intentionally excluded. Later, after the audit produces its clean final SHA, a separate integration pass will reconcile the feature branch onto that SHA.

This sprint is construction, not integration.

---

## 1. Director's first action: create the isolated clone

The Fable director must execute this itself. Do not ask the owner to manage the clone manually.

```bash
set -euo pipefail

SOURCE="/Users/cosmosgeek/Desktop/Main"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="/Users/cosmosgeek/Desktop/Main-backend-foundation-$STAMP"
BRANCH="backend-foundation-parallel-$STAMP"

test -d "$SOURCE/.git" || {
  echo "BLOCKED: $SOURCE is not a Git checkout"
  exit 1
}

BASE_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
SOURCE_BRANCH="$(git -C "$SOURCE" branch --show-current)"
REMOTE_URL="$(git -C "$SOURCE" remote get-url origin 2>/dev/null || true)"
SOURCE_DIRTY_COUNT="$(git -C "$SOURCE" status --porcelain | wc -l | tr -d ' ')"

echo "SOURCE=$SOURCE"
echo "SOURCE_BRANCH=$SOURCE_BRANCH"
echo "BASE_SHA=$BASE_SHA"
echo "SOURCE_DIRTY_COUNT=$SOURCE_DIRTY_COUNT"
echo "TARGET=$TARGET"
echo "BRANCH=$BRANCH"

test ! -e "$TARGET" || {
  echo "BLOCKED: target already exists"
  exit 1
}

git clone --no-local "$SOURCE" "$TARGET"

if [ -n "$REMOTE_URL" ]; then
  git -C "$TARGET" remote set-url origin "$REMOTE_URL"
fi

git -C "$TARGET" checkout -b "$BRANCH" "$BASE_SHA"

test -z "$(git -C "$TARGET" status --porcelain)" || {
  echo "BLOCKED: isolated clone is unexpectedly dirty"
  exit 1
}

printf '%s\n' \
  "source=$SOURCE" \
  "source_branch=$SOURCE_BRANCH" \
  "base_sha=$BASE_SHA" \
  "source_dirty_count_at_clone=$SOURCE_DIRTY_COUNT" \
  "target=$TARGET" \
  "feature_branch=$BRANCH" \
  > "$TARGET/PARALLEL_BASE_RECEIPT.txt"

echo "ISOLATED_CLONE_READY"
```

### Why a full clone, not the active folder

This clone has independent working files and independent Git metadata. The audit can continue committing and compacting in `Main` without rewriting this sprint's files. The sprint can commit and optionally push its own feature branch without touching the audit branch.

The clone intentionally contains only committed project state. It does not contain:

- the audit's uncommitted changes;
- `.env`;
- runtime database files;
- `node_modules`;
- generated build output;
- local secrets.

That is correct.

---

## 2. What the Fable director does

The Fable session is the director, not the main coder.

It must:

1. create and verify the isolated clone;
2. save this directive in the clone root as `PARALLEL_BACKEND_MAX_POWER_SPRINT.md`;
3. inspect only the minimum current project context;
4. launch one Codex 5.6 Ultra lead task inside the isolated clone;
5. tell Codex to use bounded subagents with exclusive directory ownership;
6. monitor scope and collisions;
7. require checkpoint commits;
8. require a final component manifest and receipt;
9. never merge the branch into `current-main`;
10. return the exact branch and commit SHAs for later reconciliation.

The director should not fill its own context by performing every implementation step. Codex owns the build. The director owns scope, evidence, and completion.

---

## 3. Minimal read order

Inside the isolated clone, read only:

1. `AGENTS.md`;
2. `MISSION.md`;
3. the current-truth header and active-phase section of `PROJECT_MEMORY.md`;
4. this directive;
5. actual source, tests, package scripts, and TypeScript configuration.

Do not read the entire historical run log unless a concrete code ambiguity requires it.

Do not use old chat history as implementation authority.

The permanent mission remains: improve the system's ability to discover, validate, control, execute, explain, survive, or learn from a real market inefficiency without weakening truth, safety, or operational reliability.

---

## 4. Build topology

All new production code must live under one isolated namespace:

```text
server/src/foundation/
```

All new tests must live under:

```text
server/test/foundation/
```

Allowed root artifacts:

```text
BACKEND_COMPONENTS.md
PARALLEL_BACKEND_RECEIPT.md
PARALLEL_BASE_RECEIPT.txt
PARALLEL_BACKEND_MAX_POWER_SPRINT.md
```

No other existing file should be edited during worker construction.

The lead may make a tiny final edit to a test script or TypeScript export only if it is essential to execute the new tests. Prefer direct test commands and an internal foundation barrel instead. Any edit outside the allowed namespace must be listed separately in the final receipt and justified.

---

## 5. Read-only project territory

The following are read-only for the entire parallel sprint:

```text
web/**
server/src/index.ts
server/src/types.ts
server/src/config.ts
server/src/ledger.ts
server/src/binance/**
server/src/services/**
server/src/engine/basis/**
server/src/engine/volume/**
server/src/engine/v0/**
server/src/engine/scanner.ts
server/src/engine/marketData.ts
package.json
server/package.json
package-lock.json
AGENTS.md
MISSION.md
BLUEPRINT.md
ENGINE.md
PROJECT_MEMORY.md
README.md
DESIGN_PLAYBOOK.md
UI_SURFACE_BASELINE.md
.env
.env.*
data/**
```

The sprint may inspect these files. It may not change them.

No worker may create a second scanner, a second ledger, a second account store, a second runtime cache, or another competing proposal queue.

---

## 6. Hard authority and safety rules

1. No live order placement.
2. No production route registration.
3. No runtime startup hook.
4. No UI/CSS changes.
5. No withdrawal or transfer-out behavior.
6. No borrow, repay, leverage-change, margin-mode-change, or capital-movement behavior.
7. No real credentials, private payloads, database copies, or production account fixtures.
8. No environment reads inside foundation modules.
9. No network call in tests.
10. No autonomous execution.
11. Existing Basis and Volume engines remain the only strategy authorities.
12. Unknown facts remain `null`, `UNKNOWN`, `UNAVAILABLE`, or a named failure.
13. Every module must be side-effect-free at import time.
14. Every state transition must be deterministic and auditable.
15. `EXECUTION_LIVE` must remain explicitly blocked.
16. The only order-like Binance capability permitted is a transport-injected USD-M test-order request builder/client that cannot submit a live order.
17. Progress is measured by tested behavior, not line count.

---

## 7. Anti-garbage gate

A module counts as built only when it:

- contains real deterministic behavior;
- compiles under the repository's TypeScript configuration;
- uses the shared foundation contracts;
- has meaningful success and failure tests;
- uses fixed or injected clocks;
- has no implicit singleton, timer, socket, file write, or environment access;
- has a documented future wiring seam;
- can be integrated independently;
- does not fabricate values.

These do not count:

- empty classes;
- TODO-only services;
- type-only shells without behavior;
- fake-success returns;
- giant generic frameworks;
- duplicate Basis/Volume calculations;
- random manager/supervisor wrappers with no state laws;
- new caches that compete with runtime truth;
- generated code padding;
- decorative documentation without executable proof.

---

# WAVE 0 — CONTRACT KERNEL

## 8. Shared contract kernel

Lead-owned path:

```text
server/src/foundation/contracts/
server/test/foundation/contracts/
```

Only the Codex lead may edit these files after the initial freeze. Workers compile against them.

Required files may be organized as:

```text
contracts/
  authority.ts
  time.ts
  failures.ts
  runtime.ts
  opportunity.ts
  execution.ts
  risk.ts
  reconciliation.ts
  exchange.ts
  diagnostics.ts
  index.ts
```

### Required authority vocabulary

```ts
type DataAuthority =
  | 'LIVE_PUBLIC'
  | 'LIVE_PRIVATE'
  | 'DERIVED_LIVE'
  | 'RECORDED_REPLAY'
  | 'SYNTHETIC_TEST'
  | 'UNAVAILABLE';
```

Every time-sensitive fact must preserve:

- source/exchange observation time when available;
- local receipt time;
- maximum acceptable age;
- authority;
- completeness/availability state;
- source identity.

Local refresh time must never overwrite source event time.

### Runtime vocabulary

```ts
type RunMode =
  | 'INTELLIGENCE'
  | 'EXECUTION_VALIDATE_ONLY'
  | 'EXECUTION_LIVE';

type DesiredRuntimeState =
  | 'STOPPED'
  | 'RUNNING'
  | 'PAUSED';

type RuntimePhase =
  | 'STOPPED'
  | 'VALIDATING'
  | 'STARTING'
  | 'RUNNING'
  | 'DEGRADED'
  | 'PAUSING'
  | 'PAUSED'
  | 'STOPPING'
  | 'BLOCKED'
  | 'FAILED';

type ControlCommand =
  | 'VALIDATE'
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'STOP'
  | 'RESTART';
```

### Stable identity concepts

Freeze deterministic representations for:

- command ID;
- correlation ID;
- source decision ID;
- canonical decision ID;
- source proposal ID;
- canonical proposal ID;
- plan ID;
- leg ID;
- event ID;
- client-order ID;
- state revision;
- configuration version.

IDs must not depend on array position or the current wall clock.

### Structured failure

Every failure must carry:

```text
component
stage
code
message
occurredAt
retryable
safeCurrentState
recommendedOperatorAction
correlationId
```

### Contract conformance tests

Prove:

- timestamps validate;
- unavailable values remain unavailable;
- stable IDs reproduce;
- invalid state variants fail;
- structured failures serialize safely;
- contract imports have no side effects;
- secret-like fields are rejected from diagnostic/replay envelopes.

Commit the frozen contracts before spawning writing workers.

---

# WAVE 1 — CORE FOUNDATION

Run four bounded workers in parallel after the contract checkpoint.

## 9. Lane A — Engine Control Plane

Exclusive path:

```text
server/src/foundation/control/
server/test/foundation/control/
```

Build a deterministic supervisor over injected `ManagedComponent` ports.

Required behavior:

- dependency-ordered validation/start;
- reverse-order stop;
- explicit preflight chain;
- no later gate after a blocking failure;
- per-gate timeout;
- per-component timeout;
- idempotent commands;
- concurrent-command revision protection;
- startup generation counter;
- desired state separate from observed state;
- rollback only for components actually started;
- exact failed component/stage;
- stale source => `DEGRADED` or `BLOCKED`, never fake healthy;
- fatal required child => `FAILED`;
- restart retains previous failure evidence;
- intelligence mode can run without private keys;
- missing borrow truth blocks only borrow-dependent action;
- kill switch blocks risk-increasing startup;
- `EXECUTION_LIVE` returns `LIVE_EXECUTION_NOT_IMPLEMENTED`.

Status snapshot must expose:

```text
revision
generation
runMode
desiredState
phase
commandCorrelationId
startedAt
lastTransitionAt
heartbeatAt
blockedAtGate
components[]
preflight[]
lastError
```

Test:

- dependency order;
- blocking preflight;
- skipped later gates;
- double-start;
- concurrent start;
- partial rollback;
- timeout versus thrown failure;
- stale degradation;
- fatal child;
- double-stop;
- restart generation;
- stale command revision;
- keyless intelligence;
- kill-switch block;
- live mode block.

---

## 10. Lane B — Canonical Basis/Volume read model

Exclusive path:

```text
server/src/foundation/readModel/
server/test/foundation/readModel/
```

Build pure adapters around injected child snapshots.

Do not import concrete engine implementations in the core. Define narrow ports and use synthetic official-shaped fixtures. Concrete post-audit adapters come later.

The read model:

- owns no strategy logic;
- owns no timer;
- owns no proposal lifecycle;
- owns no cache;
- creates no signal;
- mutates no child input;
- preserves child authority and provenance.

Canonical decision/proposal records preserve:

- `BASIS` or `VOLUME`;
- original source IDs;
- symbol;
- strategy-specific direction;
- lifecycle;
- observed/expiry times;
- authority/freshness;
- source-local rank;
- net edge only when supplied;
- confidence only when supplied;
- borrow state;
- evidence;
- named rejection reasons;
- config version.

Do not invent one cross-strategy score. Deterministic ordering may use lifecycle, source, and source-local rank only.

Test:

- stable IDs;
- exact deduplication;
- distinct proposal preservation;
- no input mutation;
- no invented values;
- stale Basis does not poison healthy Volume;
- source disappearance is explicit;
- malformed timestamp rejection;
- count reconciliation;
- deterministic ordering;
- strategy-local ranks remain local.

---

## 11. Lane C — Two-leg execution coordinator

Exclusive path:

```text
server/src/foundation/execution/
server/test/foundation/execution/
```

Build:

- a pure event reducer;
- a coordinator over injected ports;
- deterministic checkpoints;
- recovery recommendations;
- no concrete network adapter.

Modes:

```text
VALIDATE_ONLY
PAPER
LIVE_MANUAL
```

`LIVE_MANUAL` exists only as a blocked future-compatible type.

Global lifecycle:

```text
CREATED
AWAITING_APPROVAL
PREFLIGHTING
READY
OPENING
ONE_LEG_EXPOSED
HEDGED_OPEN
CLOSE_REQUESTED
CLOSING
RECONCILING
CLOSED
RECOVERY_REQUIRED
FAILED
CANCELLED
EXPIRED
```

Per-leg lifecycle:

```text
PLANNED
VALIDATED
SUBMITTING
ACKNOWLEDGED
PARTIALLY_FILLED
FILLED
CANCEL_PENDING
CANCELLED
REJECTED
AMBIGUOUS
```

Required laws:

- one correlation ID per plan;
- deterministic client-order ID;
- duplicate event suppression;
- monotonic revision;
- stale proposal rejection;
- expired approval rejection;
- validate-only cannot submit;
- response loss becomes `AMBIGUOUS`;
- partial/filled first leg plus failed unknown second leg becomes `ONE_LEG_EXPOSED`;
- naked-duration expiry becomes `RECOVERY_REQUIRED`;
- checkpoint round-trip preserves exact logic;
- close lifecycle is independent;
- recovery actions differ from risk-increasing actions;
- unresolved exposure is never silently discarded.

Test both Basis directions plus:

- validate-only;
- fake open/close;
- approval expiry;
- duplicate/out-of-order events;
- first-leg reject;
- partial fill;
- second-leg reject;
- lost acknowledgement resolved;
- lost acknowledgement unresolved;
- naked-duration expiry;
- restart between legs;
- checkpoint restore;
- emergency close;
- no test can reach a real network transport.

---

## 12. Lane D — Multi-leg risk evaluator

Exclusive path:

```text
server/src/foundation/risk/
server/test/foundation/risk/
```

Pure input-to-verdict evaluator.

Verdict:

```text
allowed
evaluatedAt
expiresAt
checks[]
blockingCodes[]
```

Each check:

```text
code
status: PASS | FAIL | UNKNOWN
blocking
detail
observed
limit
evidenceTimestamp
```

Evaluate:

- kill switch;
- approval and expiry;
- proposal and expiry;
- authority;
- spot/perp freshness and skew;
- permission posture;
- symbol filters;
- min/max per-leg notional;
- gross notional;
- hedge-ratio tolerance;
- residual delta;
- maximum naked duration;
- edge/cost/spread/depth/slippage evidence;
- margin/headroom;
- liquidation-distance policy;
- borrow amount/rate/availability/freshness;
- daily loss/notional;
- duplicate active plan;
- open-order limits;
- cooldown.

All required unknowns fail closed.

Risk-reducing close/recovery must be distinguishable from risk-increasing entry. The kill switch blocks new risk but must not accidentally prevent an explicitly authorized risk-reducing recovery evaluation.

---

# WAVE 2 — TRUTH AND EXCHANGE BOUNDARIES

## 13. Lane E — Reconciliation engine

Exclusive path:

```text
server/src/foundation/reconciliation/
server/test/foundation/reconciliation/
```

Compare intended plan/checkpoint state with normalized observed evidence.

Statuses:

```text
EXACT
PENDING
PARTIAL
AMBIGUOUS
DIVERGED
STALE
UNAVAILABLE
```

Data-only recommendations:

```text
WAIT
REFRESH
CANCEL_REMAINDER
HEDGE_RESIDUAL
CLOSE_POSITION
MANUAL_REVIEW
NO_ACTION
```

The engine never executes its recommendation.

Test:

- exact fill;
- partial fill;
- duplicate/out-of-order fills;
- missing response;
- order versus position disagreement;
- unexpected residual;
- duplicate client-order ID;
- rounding tolerance;
- stale snapshot;
- incomplete history window;
- missing private source;
- close reconciliation;
- restart reconciliation.

---

## 14. Lane F — USD-M Futures read/test-order boundary

Exclusive path:

```text
server/src/foundation/exchange/binanceUsdM/
server/test/foundation/exchange/binanceUsdM/
```

This is dormant and transport-injected.

Use current official Binance documentation during implementation.

Allowed operations:

- server time;
- exchange info and filters;
- mark/funding context;
- account/balance reads;
- position reads;
- open-order/order lookup reads;
- trade/fill history reads;
- signed test-order validation.

Forbidden:

- concrete live place-order method;
- cancel/replace production method;
- leverage/margin-mode mutation;
- borrow/repay;
- transfer;
- withdrawal;
- direct environment reads.

Requirements:

- injected clock;
- injected HTTP transport;
- dummy deterministic HMAC fixtures;
- server-time offset;
- bounded `recvWindow`;
- decimal-string normalization;
- filter validation;
- position-side/reduce-only validation;
- time-in-force validation;
- timeout and abort;
- rate-limit/cooldown metadata;
- typed error normalization;
- redacted safe serialization;
- retry only proven idempotent reads;
- ambiguous transport result;
- malformed-response rejection.

No test reaches Binance.

---

## 15. Lane G — Bounded replay capture

Exclusive path:

```text
server/src/foundation/replay/
server/test/foundation/replay/
```

Build:

- bounded ring buffer;
- pre-trigger and post-trigger capture;
- versioned envelope;
- explicit authority;
- deterministic event ordering;
- virtual-clock replay;
- checksum;
- corruption/truncation handling;
- schema validation;
- no core disk writes;
- injected storage port;
- strict secret/private-payload rejection.

Use synthetic fixtures only.

Test bounds, round-trip, deterministic replay, gaps, truncation, checksum mutation, and forbidden-key rejection.

---

## 16. Lane H — Diagnostics model

Exclusive path:

```text
server/src/foundation/observability/
server/test/foundation/observability/
```

Pure derived diagnostics:

- heartbeat age;
- last successful cycle;
- last error;
- consecutive failures;
- event/message rate;
- reconnect count;
- sequence gaps;
- source freshness;
- universe/candidate/focus/proposal counts;
- rejection counts;
- baseline state;
- borrow coverage;
- supervisor phase;
- failed preflight;
- authority labels;
- deterministic overall health.

No timers, sockets, state ownership, or mutation.

---

# OPTIONAL WAVE 3 — ONLY AFTER CORE PASSES

## 17. Deterministic scenarios

Path:

```text
server/src/foundation/scenarios/
server/test/foundation/scenarios/
```

Provide seeded scenarios for:

- spot leads perp;
- perp leads spot;
- gap widens then closes;
- funding consumes edge;
- stale spot/fresh futures;
- out-of-order frame;
- dead-volume wakeup;
- one-print spike;
- open-but-silent socket;
- proposal expiry;
- kill switch during two-leg plan;
- partial fill and second-leg reject;
- clock drift;
- capture truncation.

---

## 18. Read-only borrow truth

Path:

```text
server/src/foundation/borrow/
server/test/foundation/borrow/
```

States:

```text
AVAILABLE
UNAVAILABLE
UNKNOWN
STALE
PERMISSION_MISSING
ACCOUNT_MODE_MISMATCH
RATE_LIMITED
SOURCE_ERROR
```

No action methods. Evidence expires. Zero is distinct from unknown.

---

## 19. Outcome attribution and calibration

Path:

```text
server/src/foundation/calibration/
server/test/foundation/calibration/
```

Record proposal outcomes without automatically changing strategy thresholds.

Incomplete outcomes remain incomplete. Missing costs are not zero. Metrics group by configuration version and exclude incompatible records.

---

# LEAD-OWNED COMPATIBILITY

## 20. Compatibility harness

Path:

```text
server/test/foundation/integration/
server/test/foundation/fixtures/
```

Using fake ports, prove:

```text
control validation
-> preflight
-> Basis/Volume readiness
-> canonical Basis proposal
-> execution plan
-> risk verdict
-> simulated leg one
-> simulated leg two
-> hedged open
-> close request
-> simulated close
-> reconciliation
-> ledger-shaped events
-> diagnostic snapshot
```

Inject:

1. missing dependency;
2. stale market data;
3. malformed timestamp;
4. preflight timeout;
5. kill switch;
6. risk rejection;
7. first-leg rejection;
8. first-leg partial fill;
9. second-leg rejection;
10. ambiguous acknowledgement;
11. restart from checkpoint;
12. naked-duration expiry;
13. incomplete history;
14. reconciliation divergence;
15. private data unavailable while intelligence remains usable;
16. live-execution attempt blocked.

Every failure must expose:

```text
component
stage
code
timestamp
retryable
safeCurrentState
recommendedOperatorAction
correlationId
```

---

## 21. State-authority manifest

Create `BACKEND_COMPONENTS.md`.

For every component:

```text
name
path
status: BUILT_TESTED_DORMANT | EXISTING_REUSED | SKIPPED | BLOCKED
responsibility
authoritative inputs
outputs
owned state
explicitly non-owned state
tests
failure modes
live authority: NONE | READ_ONLY | TEST_ORDER_ONLY
future wiring point
```

One state owner per category:

- Basis strategy state -> existing Basis engine;
- Volume strategy state -> existing Volume engine;
- desired/observed runtime state -> Control Plane;
- browser/read state -> canonical read model;
- execution lifecycle -> execution coordinator;
- risk verdict -> multi-leg risk evaluator;
- intended-versus-observed truth -> reconciliation;
- venue evidence -> exchange boundary;
- durable audit truth -> existing ledger;
- diagnostics -> derived observability model.

---

## 22. Test procedure

Install dependencies in the isolated clone:

```bash
cd "/Users/cosmosgeek/Desktop/Main-backend-foundation-<STAMP>"
npm ci
```

Run baseline build/tests once. Record any pre-existing failure without fixing unrelated old code.

During construction:

- run focused lane tests;
- run TypeScript build after each wave;
- do not repeatedly run the entire suite after every small change.

At checkpoints:

```bash
npm run build
npm test
git diff --check
```

Run every foundation test using the repository's actual test convention. If no script exists and shared package files remain read-only, run the test files directly after build.

Final checks:

- no test network access;
- no `.env` access;
- no secret-like fixture;
- no import side effects;
- no edits outside allowed paths;
- no live order method;
- no capital-movement method;
- no UI change;
- no duplicated strategy calculations.

---

## 23. Checkpoint commits

Required commits:

1. frozen contracts;
2. Wave 1 complete;
3. Wave 2 complete;
4. optional Wave 3 complete;
5. final manifest/receipt.

Suggested messages:

```text
foundation: freeze backend contracts
foundation: add control read model execution and risk
foundation: add reconciliation exchange replay and diagnostics
foundation: add deterministic research support
docs: record dormant backend component inventory
```

Push only the feature branch. Never touch the default branch.

```bash
git push -u origin "<feature-branch>"
```

If push is not permitted, leave the branch committed locally and report every SHA.

---

## 24. Final receipt

Create `PARALLEL_BACKEND_RECEIPT.md`, concise and factual.

Include:

- source folder;
- captured base SHA;
- source dirty count at clone time;
- isolated clone path;
- branch;
- commits;
- modules completed;
- modules skipped;
- files changed;
- build result;
- baseline test result;
- focused test counts;
- compatibility result;
- adversarial review result;
- secret/network/live-action proof;
- exact integration requirements;
- known incompatibilities with the pre-audit baseline;
- exact next action after the audit ends.

Do not copy project history into this receipt.

---

# LATER INTEGRATION — NOT PART OF THIS SPRINT

## 25. Reconcile after the audit finishes

When the audit reports its final clean SHA:

1. keep the audit branch as source of truth;
2. create a new integration worktree/clone from the audit SHA;
3. fetch the parallel feature branch;
4. compare any post-audit equivalent component before importing;
5. prefer audited existing code when it is already authoritative;
6. adapt foundation ports to final post-audit types;
7. merge/cherry-pick one checkpoint at a time;
8. run the full post-audit suite after every checkpoint;
9. wire no production route until all contracts reconcile;
10. update canonical project memory only after integration succeeds.

The parallel builder must not perform this merge automatically.

---

## 26. Completion priority

If capacity ends early, finish in this order:

1. contracts;
2. Control Plane;
3. execution coordinator;
4. multi-leg risk;
5. reconciliation;
6. canonical read model;
7. Futures read/test-order boundary;
8. diagnostics;
9. replay;
10. scenarios;
11. borrow truth;
12. calibration.

A module is complete only if it compiles and its focused tests pass.

---

## 27. Final report format

```text
PARALLEL BACKEND SPRINT — RESULT

Source committed SHA:
Source dirty count at clone:
Isolated clone:
Feature branch:
Ending commit:
Contracts:
Control Plane:
Canonical read model:
Execution coordinator:
Multi-leg risk:
Reconciliation:
Futures boundary:
Replay:
Diagnostics:
Optional modules:
Build:
Baseline tests:
Foundation tests:
Compatibility harness:
Files outside allowed scope:
Secrets touched:
Network used by tests:
Live actions added:
Push status:
Exact later-integration step:
```
