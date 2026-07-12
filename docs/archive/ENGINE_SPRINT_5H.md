# ENGINE SPRINT — FIVE-HOUR DIRECTIVE

**Project:** Cosmos Arbitrage Control Room  
**Purpose:** Turn the already-built Basis and Volume engines into one verified, observable, resumable engine system.  
**Operator expectation:** One Codex 5.6 session acts as lead, uses narrow internal agents, integrates their work, and leaves the repository in a clean, testable state.  
**This is not:** a UI redesign, a new bot from zero, a live-order sprint, a documentation-writing exercise, or an excuse to generate large amounts of disconnected code.

---

## 1. Current repository truth that must be verified before editing

The source archive already contains substantial engine work. Do not start over.

Existing engine areas:

- `server/src/engine/basis/` — a deterministic basis lifecycle engine with executable two-direction gaps, funding/carry, fees, slippage models, borrow preflight, liquidity/data-quality checks, persistence, priority, lifecycle, proposals, replay, snapshots, and event tracing.
- `server/src/engine/volume/` — a deterministic dead-to-active/wakeup engine with rolling windows, robust baselines, raw trade tape, fake-spike and wash-like-pattern rejection, book quality, priority, focus management, proposals, replay, snapshots, and event tracing.
- `server/src/engine/v0/` — shared contracts, clock, defaults, decisions, proposals, events, and snapshots.
- `server/src/services/basisRuntime.ts` — live Binance adapter for Basis.
- `server/src/services/volumeRuntime.ts` — live Binance adapter for Volume.
- `server/test/engine-basis.mjs` — synthetic Basis proof suite.
- `server/test/engine-volume.mjs` — synthetic Volume proof suite.
- `/api/engine/basis` and `/api/engine/volume` are already wired into the server and consumed by the UI.

Before any edits, independently verify this against the actual working tree. Do not trust old status headers that say “engine not started.”

---

## 2. Five-hour outcome

At the end of this sprint, the operator must have:

1. One verified account of what the engine actually contains and what is live versus synthetic.
2. One command that runs every application and engine test.
3. One unified engine supervisor exposing Basis and Volume health, state, candidates, focus, proposals, decisions, errors, and freshness.
4. One durable current-state record that lets a fresh agent continue without reading old chats.
5. At least one meaningful runtime hardening improvement in Basis and one in Volume, chosen from the highest-value gaps discovered by inspection.
6. No live order automation, no secret handling changes, no withdrawal/transfer code, and no UI redesign.
7. Clean builds and tests, or a precise failure report with no false completion claim.

Do not measure success by line count. Measure success by verified engine behavior and operator visibility.

---

## 3. Safety and scope walls

Never edit or print `.env` values.

Do not add, expose, copy, log, or commit secrets.

Do not touch withdrawal or transfer-out behavior.

Do not add autonomous live execution.

Do not weaken the existing risk gate, kill switch, allowlist, typed confirmation, or ledger requirements.

Do not redesign frontend pages. A very small API-consumer adjustment is allowed only if required to expose a new supervisor endpoint, and it must not alter the approved visual system.

Do not delete the existing Basis or Volume engines and replace them with a generic framework.

Do not create another parallel engine language/process.

Do not create permanent planning documents beyond the existing canonical set. Temporary `TASK_*.md` files may be used and deleted at sprint completion.

Do not let multiple agents edit the same working tree or shared file concurrently.

---

## 4. Canonical project memory

The permanent read order after this sprint must be:

1. `MISSION.md` — why the product exists.
2. `AGENTS.md` — short operating rules and exact read order.
3. `PROJECT_MEMORY.md` — concise current truth at the top; historical log below or archived.
4. `BLUEPRINT.md` — product and system structure.
5. `ENGINE.md` — engine architecture and current engine boundaries.

Other design/history files may remain, but a fresh engine agent must not need to read all of them.

During this sprint:

- Correct the stale “engine not started” statement in `ENGINE.md`.
- Correct outdated `README.md` and `AGENTS.md` claims about gate counts or Volume being unbuilt.
- Put a compact **CURRENT ENGINE TRUTH** section near the top of `PROJECT_MEMORY.md`.
- Do not expand `PROJECT_MEMORY.md` with another giant narrative. Record only verified current facts, commits, tests, gaps, and next step.

---

## 5. Agent execution model

One Codex 5.6 session is the lead/integrator.

The lead may launch internal agents, but every writing agent must have:

- one isolated Git worktree or branch;
- one narrow file territory;
- one acceptance contract;
- no authority over shared integration files.

Shared files owned only by the lead/integrator:

- `package.json`
- `server/package.json`
- `server/src/index.ts`
- `server/src/types.ts`
- `server/src/ledger.ts`
- `AGENTS.md`
- `ENGINE.md`
- `BLUEPRINT.md`
- `PROJECT_MEMORY.md`
- `README.md`

No sub-agent edits those files.

Suggested worktrees/lanes:

- `engine-audit` — read-only audit, test inventory, contradiction report.
- `engine-supervisor` — new files under `server/src/engine/supervisor/` plus focused tests.
- `engine-basis-hardening` — only `server/src/engine/basis/**`, `server/src/services/basisRuntime.ts`, and new Basis tests.
- `engine-volume-hardening` — only `server/src/engine/volume/**`, `server/src/services/volumeRuntime.ts`, and new Volume tests.
- `engine-replay` — only new files under `server/src/engine/replay/**` and focused tests, if time remains.

The lead merges sequentially after inspecting every diff.

---

## 6. Phase A — exact reality audit

Timebox: 30–45 minutes.

Do not edit engine logic during this phase.

Inspect:

- actual file tree and line counts;
- current branch, commit, dirty files, remotes, tags;
- root/server/web package scripts;
- Basis and Volume module exports;
- live runtime adapters;
- server routes;
- test suites and whether root `npm test` runs them;
- existing API consumers in Dashboard, Basis, Volume, Opportunities, Borrow, Health, and Notifications;
- actual `.gitignore` behavior;
- documentation contradictions.

Run, if dependencies exist:

- `npm run build`
- `npm test`
- `node server/test/engine-basis.mjs`
- `node server/test/engine-volume.mjs`
- `git diff --check`

If dependencies are absent, install them using the lockfile before judging source health.

Audit output must classify each area:

- **live and wired**;
- **implemented but synthetic-only**;
- **implemented but not wired**;
- **placeholder**;
- **missing**;
- **unsafe or contradictory**.

The lead must not proceed from vague assumptions.

---

## 7. Phase B — make testing impossible to forget

Timebox: 20–30 minutes.

The repository currently has dedicated engine proof files, but the root test script may not run them. Fix this.

Required scripts, using names compatible with the existing package layout:

- `test:app`
- `test:engine:basis`
- `test:engine:volume`
- `test:engine`
- `test:all`

`test:all` must run application gates plus both engine proof suites.

Do not alter engine thresholds merely to make tests pass.

Add a compact test summary to the current-state docs only after verified execution.

---

## 8. Phase C — unified Engine Supervisor

Timebox: 60–90 minutes.

Create a real internal supervisor rather than another UI page.

Preferred new territory:

- `server/src/engine/supervisor/types.ts`
- `server/src/engine/supervisor/supervisor.ts`
- `server/src/engine/supervisor/snapshots.ts`
- `server/test/engine-supervisor.mjs`

The supervisor does not replace Basis or Volume. It observes them.

It must expose one coherent snapshot containing:

- overall running/degraded/stopped state;
- Basis runtime state;
- Volume runtime state;
- current universe sizes;
- eligible symbols;
- watching/candidate counts;
- focused symbols;
- open proposals;
- recent decisions and named rejects;
- last market update;
- last engine tick;
- data/source ages;
- stream connection counts;
- baseline readiness;
- borrow truth coverage;
- error counts and latest error;
- ledger/event throughput;
- kill-switch state;
- engine build/version identifier;
- which features are live, synthetic, unavailable, or warming.

The lead integrates read-only endpoints after the supervisor lane merges:

- `GET /api/engine/status`
- `GET /api/engine/proposals`
- `GET /api/engine/decisions`

Do not duplicate the complete payloads already available from `/api/engine/basis` and `/api/engine/volume`; aggregate and link them.

Acceptance proof:

- healthy Basis + Volume returns healthy supervisor;
- one stale runtime returns degraded;
- one stopped runtime is visible;
- kill switch is visible;
- proposal and decision counts reconcile with child runtimes;
- missing data is `null`/unknown, never fabricated zero;
- test is deterministic and network-free.

---

## 9. Phase D — Basis runtime hardening

Timebox: one isolated lane, approximately 90 minutes.

First inspect, then choose the highest-value feasible improvements. Do not rewrite the mathematical engine if it is already correct.

Current likely gaps to verify:

- all-symbol spot/futures book tickers are polled through REST instead of consumed through a durable stream;
- reverse basis fails closed because borrow is always unknown;
- live runtime may only have top-of-book quantities rather than focused depth ladders;
- funding-history context may exist in the deterministic engine but not be seeded live;
- estimated slippage may be weak without focused depth;
- there may be no explicit dropped-update/skew metric in the live adapter.

Prioritized improvements:

1. Add live data-quality counters and exact source ages.
2. Reuse or add a durable all-book-ticker stream rather than 1.5-second REST polling, if compatible with the current Binance adapter and current docs.
3. Add an injected cached borrow provider interface that remains `unknown` unless signed account data proves availability and cost. No borrowing action.
4. Seed funding history at controlled frequency for focused candidates only.
5. Add focused depth/slippage enrichment for the highest-priority candidates only.

Do not implement every item blindly. Implement the most valuable safe subset that can be built and verified during the sprint.

Required tests must prove new behavior without live Binance dependency.

---

## 10. Phase E — Volume runtime hardening

Timebox: one isolated lane, approximately 90 minutes.

First inspect, then choose the highest-value feasible improvements. Preserve the existing deterministic wakeup engine and its false-positive rejection logic.

Current likely gaps to verify:

- the live runtime may monitor only volume-eligible symbols rather than keeping lightweight state for the full Binance universe;
- the baseline may be one-hour kline seeding rather than a deeper multi-regime history;
- the runtime is spot-led and may not enrich focus symbols with futures OI, funding, liquidations, or spot/perp leadership;
- top-of-book quality may be used without focused depth reconstruction;
- replay capture from real live sequences may be absent;
- stream message drops/gaps may not be explicit.

Prioritized improvements:

1. Maintain lightweight eligibility/state for the full supported universe while retaining a bounded deep-monitor set.
2. Add source-gap, message-rate, and stale-symbol diagnostics.
3. Enrich only focused symbols with futures context already present elsewhere in the repo: funding, mark/index basis, OI, liquidation pressure, and spot/perp leadership.
4. Add focused depth/slippage evidence where feasible.
5. Add a multi-horizon baseline contract without loading ten days of data every tick.
6. Record enough live pre-event evidence for later replay/calibration.

Do not pretend these features predict a pump. They produce explainable anomaly evidence and named rejects.

Required tests must prove new behavior without live Binance dependency.

---

## 11. Phase F — live capture and replay foundation, only if time remains

Preferred territory:

- `server/src/engine/replay/types.ts`
- `server/src/engine/replay/recorder.ts`
- `server/src/engine/replay/reader.ts`
- `server/test/engine-replay.mjs`

Purpose:

- capture bounded, redacted market/decision sequences for focused symbols;
- preserve pre-event and post-event windows;
- replay them deterministically into Basis/Volume engines;
- compare the recorded engine decision with the replay decision;
- never record secrets or private credentials;
- keep storage bounded and observable.

This is more valuable than adding another speculative signal because it enables future calibration and falsification.

If this cannot be completed cleanly, document it as the next sprint rather than shipping a partial recorder.

---

## 12. Integration order

The lead merges in this order:

1. Audit conclusions, no code merge.
2. Test-script integration.
3. Engine Supervisor.
4. Basis hardening.
5. Volume hardening.
6. Replay foundation if complete.
7. Shared route integration in `server/src/index.ts`.
8. Canonical document corrections.

After every merge:

- run build;
- run the relevant focused test;
- run `test:all` before the next major merge;
- inspect `git diff --check`;
- record one concise milestone in `PROJECT_MEMORY.md`;
- commit the verified milestone.

No agent may claim success based only on code generation.

---

## 13. Final acceptance gate

The sprint is complete only if:

- the repository builds;
- application gates pass;
- Basis proofs pass;
- Volume proofs pass;
- Supervisor proofs pass;
- `test:all` exists and passes;
- live/public runtime still starts locally when network access is available;
- no secret changed or entered Git;
- no withdrawal/transfer/live-auto-order path was added;
- `/api/engine/basis` and `/api/engine/volume` remain compatible;
- unified supervisor endpoints return truthful state;
- documentation no longer says the engine is unbuilt;
- `PROJECT_MEMORY.md` has a concise current-engine snapshot;
- a fresh agent can read `MISSION.md`, `AGENTS.md`, `PROJECT_MEMORY.md`, and `ENGINE.md` and accurately explain what exists and what comes next;
- working tree is clean or every remaining dirty file is named and explained;
- a checkpoint commit/tag is created only after all gates pass.

---

## 14. Final report required from Codex

Keep the report concise and factual:

- starting commit and ending commit;
- worktrees/agents used;
- files created and modified;
- exact engine modules that were already present;
- exact improvements added;
- tests and numerical pass counts;
- live versus synthetic capabilities;
- remaining gaps in priority order;
- current local run command and URL;
- checkpoint/tag created;
- next single engine sprint.

Do not report line count as progress unless accompanied by verified behavior.

---

## 15. Operator-visible meaning after the sprint

The operator should be able to open the cockpit and understand:

- Is the engine running?
- Are Basis and Volume receiving fresh data?
- How many symbols are observed, candidates, focused, proposed, rejected, or cooling down?
- Which proposal is open and why?
- Which proposal was rejected and why?
- Is borrow truth known or unknown?
- Are baselines ready?
- Is any data source stale?
- Is the kill switch blocking execution?
- What did the engine just do?
- What is implemented live versus still synthetic?

That visibility is the bridge between a complex engine and a controllable product.
