# Backend Component and State-Authority Manifest

This manifest records the parallel sprint boundary only. All new foundation
components are dormant: they are not imported by a production composition
root, route, timer, worker, or live transport. Check counts below are explicit
script assertions, not `node:test` case counts.

## State-owner map

| State category | Sole owner |
| --- | --- |
| Basis strategy state | Existing Basis engine |
| Volume strategy state | Existing Volume engine |
| Desired/observed runtime state | Control Plane |
| Browser/read state | Canonical Basis/Volume read model |
| Execution lifecycle | Two-leg execution coordinator |
| Risk verdict | Multi-leg risk evaluator |
| Intended-versus-observed truth | Reconciliation engine |
| Venue evidence | Binance USD-M boundary |
| Durable audit truth | Existing ledger |
| Diagnostics | Derived observability model |

## 1. Frozen foundation contracts

- **name:** Frozen foundation contracts
- **path:** `server/src/foundation/contracts/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Define the frozen authority, time, failure, identity, runtime, opportunity, execution, risk, reconciliation, exchange, and diagnostic vocabulary used by every foundation lane.
- **authoritative inputs:** Explicit caller values only.
- **outputs:** Validated immutable contract values, deterministic identifiers, freshness reports, failure values, and diagnostic envelopes.
- **owned state:** Contract law and serialized shapes; no runtime state.
- **explicitly non-owned state:** Strategy, runtime, execution, account, venue, ledger, and diagnostic runtime state.
- **tests:** `server/test/foundation/contracts/` — 226 behavior + 78 import-purity = 304 checks.
- **failure modes:** Malformed values, unknown fields, invalid transitions, unsupported live mode, secret-like diagnostics, and unavailable/unknown evidence remain named and fail closed.
- **live authority:** `NONE`
- **future wiring point:** Compile-time and runtime contract boundary for the post-audit composition root.

## 2. Existing Basis engine

- **name:** Existing Basis engine
- **path:** `server/src/engine/basis/`
- **status:** `EXISTING_REUSED`
- **responsibility:** Remain the sole authority for Basis market state, features, decisions, proposal lifecycle, and strategy-local rank.
- **authoritative inputs:** Existing market, funding, liquidity, borrow, and configuration inputs owned by the audited engine.
- **outputs:** Existing Basis decisions, proposals, events, and snapshots.
- **owned state:** Basis strategy state.
- **explicitly non-owned state:** Canonical browser projection, cross-strategy ranking, execution lifecycle, risk verdict, reconciliation, and venue account truth.
- **tests:** `server/test/engine-basis.mjs` — 73 checks.
- **failure modes:** Existing engine rejection codes, incomplete/stale source state, configuration failure, and unavailable strategy evidence.
- **live authority:** `READ_ONLY`
- **future wiring point:** A narrow post-audit snapshot adapter into `foundation/readModel`; no concrete engine import exists in the foundation core.

## 3. Existing Volume engine

- **name:** Existing Volume engine
- **path:** `server/src/engine/volume/`
- **status:** `EXISTING_REUSED`
- **responsibility:** Remain the sole authority for Volume baseline, tape/depth state, wakeup decisions, proposal lifecycle, and strategy-local rank.
- **authoritative inputs:** Existing trade, depth, baseline, universe, and configuration inputs owned by the audited engine.
- **outputs:** Existing Volume decisions, proposals, events, and snapshots.
- **owned state:** Volume strategy state.
- **explicitly non-owned state:** Canonical browser projection, cross-strategy ranking, execution lifecycle, risk verdict, reconciliation, and venue account truth.
- **tests:** `server/test/engine-volume.mjs` — 88 checks.
- **failure modes:** Existing detector rejection codes, stale/silent streams, incomplete baseline, and unavailable strategy evidence.
- **live authority:** `READ_ONLY`
- **future wiring point:** A narrow post-audit snapshot adapter into `foundation/readModel`; no concrete engine import exists in the foundation core.

## 4. Control Plane

- **name:** Deterministic engine Control Plane
- **path:** `server/src/foundation/control/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Validate and supervise injected components with dependency order, preflight gates, timeouts, command revisions, rollback, restart, scoped exclusion, and hard live-mode blocking.
- **authoritative inputs:** Injected component ports, preflight gates, control environment facts, command revisions, run mode, and caller time.
- **outputs:** Command receipts, component exclusions, transition/failure history, and runtime status snapshots.
- **owned state:** Desired and observed runtime state, command revision, startup generation, transition history, and component lifecycle view.
- **explicitly non-owned state:** Strategy calculations, venue/account facts, execution fills, risk policy, ledger truth, and wall-clock scheduling.
- **tests:** `server/test/foundation/control/control.mjs` — 97 checks; section 20 compatibility coverage also exercises dependency, timeout, kill-switch, keyless, and live-mode boundaries.
- **failure modes:** Missing/cyclic dependency, blocking or timed-out gates, malformed/throwing ports, stale/fatal children, stale commands, missing scoped evidence, kill switch, and `LIVE_EXECUTION_NOT_IMPLEMENTED`.
- **live authority:** `NONE`
- **future wiring point:** An audited composition root may wrap existing engine/services as `ManagedComponent` ports and explicitly issue commands.

## 5. Canonical Basis/Volume read model

- **name:** Canonical Basis/Volume read model
- **path:** `server/src/foundation/readModel/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Project injected child snapshots into one canonical, deterministic browser/read representation without importing engines or inventing cross-strategy values.
- **authoritative inputs:** Narrow Basis and Volume snapshot ports with explicit provenance, authority, completeness, age budget, and caller time.
- **outputs:** Canonical decisions/proposals, source sections, freshness/presence, rejections, reconciliation counts, and deterministic ordering.
- **owned state:** The canonical browser/read snapshot produced for a call; no cache or persistent state.
- **explicitly non-owned state:** Strategy logic, proposal lifecycle, source-local ranks, timers, execution plans, risk decisions, and engine storage.
- **tests:** `server/test/foundation/readModel/read-model.mjs` — 72 checks; compatibility harness covers fresh, stale, malformed, and cross-source isolation.
- **failure modes:** Undeclared source presence, invalid snapshots/records, malformed timestamps, duplicate/conflicting records, stale/unavailable authority, and explicit source disappearance.
- **live authority:** `NONE`
- **future wiring point:** Post-audit adapters translate existing Basis/Volume snapshots into the narrow input ports; routes consume only the canonical output.

## 6. Two-leg execution coordinator

- **name:** Two-leg execution coordinator
- **path:** `server/src/foundation/execution/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Own a deterministic two-leg PAPER/validation aggregate, pure event reducer, checkpoint/restart, close lifecycle, ambiguity handling, and data-only recovery recommendations.
- **authoritative inputs:** Canonical proposal reference, explicit plan terms, injected clock, identity registry, preflight/validation ports, PAPER submission port, read-only lookup, and reconciliation port.
- **outputs:** Immutable execution state, event stream, deterministic checkpoint, structured failures, and recovery recommendations.
- **owned state:** Execution plan/leg lifecycle, revision, event history, approval/preflight state, exposure timing, and checkpoint representation.
- **explicitly non-owned state:** Strategy proposal truth, risk verdict policy, venue transport, durable ledger, account truth, and live/manual order execution.
- **tests:** `server/test/foundation/execution/` — 132 behavior + 30 import-purity = 162 checks; compatibility harness covers open, close, failures, ambiguity, checkpoint restart, and naked deadline.
- **failure modes:** Stale proposal/approval, invalid transition, validation/rejection, partial or ambiguous response, lookup uncertainty, naked-duration expiry, unresolved exposure, corrupt checkpoint, and any live/manual attempt.
- **live authority:** `NONE`
- **future wiring point:** A post-audit orchestrator may provide validated PAPER/read-only ports after a fresh risk verdict; live transport remains absent.

## 7. Multi-leg risk evaluator

- **name:** Multi-leg risk evaluator
- **path:** `server/src/foundation/risk/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Purely evaluate entry or explicitly risk-reducing intent against approval, proposal, market, account, borrow, exposure, limits, and cooldown evidence.
- **authoritative inputs:** Complete immutable evidence snapshot, exact intent binding, explicit policy, and caller time.
- **outputs:** Frozen fail-closed `RiskVerdict` with checks, expiry, allowed flag, and blocking codes.
- **owned state:** The verdict for one evaluation; no persisted policy or account state.
- **explicitly non-owned state:** Execution decisions, strategy thresholds, account mutation, order submission, venue reads, and automatic recovery.
- **tests:** `server/test/foundation/risk/risk.mjs` — 884 checks; compatibility harness proves an allowed plan and a policy rejection.
- **failure modes:** Any blocking `FAIL` or `UNKNOWN`, stale/misaligned evidence, bad permissions/filters/notional/hedge, edge or depth insufficiency, margin/liquidation/borrow limits, daily limits, duplicate plan, open-order limit, cooldown, and kill switch.
- **live authority:** `NONE`
- **future wiring point:** The audited orchestrator builds one evidence snapshot and requires a current allowed verdict before PAPER entry; risk-reducing evaluations remain separately identified.

## 8. Reconciliation engine

- **name:** Intended-versus-observed reconciliation engine
- **path:** `server/src/foundation/reconciliation/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Normalize injected order/fill/position evidence and compare it with the execution aggregate without executing any recommendation.
- **authoritative inputs:** Execution checkpoint/state, observed evidence collections with coverage/freshness metadata, explicit tolerance policy, and caller time.
- **outputs:** Status, reasons, per-leg/position comparisons, source reports, and a data-only recommendation.
- **owned state:** The derived intended-versus-observed truth result for a call; no persisted venue or execution state.
- **explicitly non-owned state:** Order placement/cancel, risk authorization, venue/account mutation, checkpoint lifecycle, and durable ledger writes.
- **tests:** `server/test/foundation/reconciliation/` — 71 behavior + 27 import-purity = 98 checks; compatibility harness covers exact close, incomplete history, and divergence.
- **failure modes:** Ambiguous identity, partial/missing evidence, stale/unavailable coverage, order/fill/checkpoint disagreement, residual positions, duplicate IDs, future/invalid timestamps, and invalid checkpoint binding.
- **live authority:** `NONE`
- **future wiring point:** The post-audit composition root supplies checkpoint plus normalized read-only exchange evidence and separately interprets the recommendation.

## 9. Binance USD-M boundary

- **name:** Binance USD-M read/test-order boundary
- **path:** `server/src/foundation/exchange/binanceUsdM/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Normalize official USD-M reads and signed test-order validation through injected transport, clock, signer, timeout, and abort seams.
- **authoritative inputs:** Injected HTTP responses, server time, caller request values, deterministic signer, and explicit client policy.
- **outputs:** Typed server/exchange/funding/account/balance/position/order/trade evidence, test-order acceptance, safe metadata, and redacted errors.
- **owned state:** Normalized venue-evidence response/provenance and bounded cooldown metadata; no venue/account state is persisted.
- **explicitly non-owned state:** Live order placement, production cancel/replace, leverage or margin mutation, borrow/repay, transfer, withdrawal, credentials, and environment configuration.
- **tests:** `server/test/foundation/exchange/binanceUsdM/` — 251 behavior + 59 import-purity = 310 checks.
- **failure modes:** Timeout/abort, offset/`recvWindow` violation, rate limiting/cooldown, typed transport ambiguity, malformed response, signature/test-order rejection, filter/position-side/reduce-only/time-in-force violations, and safe redaction rejection.
- **live authority:** `TEST_ORDER_ONLY`
- **future wiring point:** An audited adapter may inject a concrete transport and credential signer; allowlisted methods remain reads plus Binance `/fapi/v1/order/test` only.

## 10. Bounded replay capture

- **name:** Bounded replay capture
- **path:** `server/src/foundation/replay/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Capture bounded pre/post-trigger synthetic or supplied events, validate a versioned envelope, detect corruption/truncation, and replay deterministically with a virtual clock.
- **authoritative inputs:** Explicit replay events, trigger, authority, capture bounds, injected evaluation time, storage port, and handler.
- **outputs:** Capture snapshot/envelope, checksum/integrity report, deterministic replay dispatch, and typed failures.
- **owned state:** In-memory bounded capture/ring state and virtual replay clock during an instance.
- **explicitly non-owned state:** Core disk/network I/O, production event ownership, cryptographic authenticity, private payloads, execution authority, and wall clock.
- **tests:** `server/test/foundation/replay/` — 132 behavior + 34 import-purity = 166 checks.
- **failure modes:** Bound exhaustion, invalid chronology/schema, gaps/truncation, checksum mutation, corrupt storage bytes, secret/private keys, oversized/deep payload, handler/storage failure, and incompatible envelope version.
- **live authority:** `NONE`
- **future wiring point:** The audited composition root may inject an approved storage adapter and event source; checksum remains corruption detection, not authentication.

## 11. Derived observability model

- **name:** Derived observability model
- **path:** `server/src/foundation/observability/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Derive one guarded diagnostic snapshot from supervisor, source, count, baseline, and borrow evidence with explicit freshness and health policy.
- **authoritative inputs:** Injected evidence snapshots, source timestamps/counters, explicit diagnostic policy, correlation, and caller time.
- **outputs:** Guarded diagnostic envelope with heartbeat/cycle/rate health, failures, counts, coverage, authority labels, and deterministic overall health.
- **owned state:** The derived diagnostic snapshot for a call; no timer, socket, singleton, or persistence.
- **explicitly non-owned state:** Runtime supervision, engine state, venue/account facts, ledger truth, remediation, alerts, and source counters.
- **tests:** `server/test/foundation/observability/` — 130 behavior + 25 import-purity = 155 checks; compatibility harness derives a healthy terminal snapshot.
- **failure modes:** Invalid evidence/policy, stale/skewed/unknown time, bad/reset/stale counters, missing required sources, failed preflight/component, partial borrow/baseline state, and secret/non-serializable diagnostic payload.
- **live authority:** `NONE`
- **future wiring point:** The post-audit composition root captures existing component snapshots and calls this pure model for a route or telemetry adapter.

## 12. Deterministic scenarios

- **name:** Deterministic synthetic scenario generator
- **path:** `server/src/foundation/scenarios/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Produce the 14 required seeded, versioned, replay-compatible market/control/execution scenarios.
- **authoritative inputs:** Explicit scenario kind, bounded seed, base time, and optional versioned parameters.
- **outputs:** Immutable synthetic scenario bundle, canonical serialization, catalog, and replay inputs.
- **owned state:** Deterministic PRNG state only while generating; generated evidence is explicitly synthetic.
- **explicitly non-owned state:** Production market truth, venue/account truth, strategy state, execution authority, timers, network, and storage.
- **tests:** `server/test/foundation/scenarios/` — 80 behavior + 33 import-purity = 113 checks.
- **failure modes:** Invalid/zero seed, unknown scenario, malformed base time/input, fact bound overflow, forbidden private/secret fields, accessor/symbol/unknown fields, and replay projection mismatch.
- **live authority:** `NONE`
- **future wiring point:** Test/replay tooling may request a named seeded bundle; production runtime must never treat synthetic authority as live truth.

## 13. Read-only borrow truth

- **name:** Read-only borrow truth derivation
- **path:** `server/src/foundation/borrow/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Derive exact, scoped borrow availability/rate/permission/account-mode truth with explicit freshness and unknown handling.
- **authoritative inputs:** Explicit source/account/scope identity, permission/account/rate/max-borrow evidence, caller time, and declared age policy.
- **outputs:** One of eight borrow states with exact decimal strings, provenance, freshness, and reasons; batch derivation preserves scope isolation.
- **owned state:** The immutable derived borrow-truth value for a call; no cache.
- **explicitly non-owned state:** Borrow/repay actions, transfers, account mutation, execution sizing, invented zero, credentials, and network access.
- **tests:** `server/test/foundation/borrow/` — 179 behavior + 31 import-purity = 210 checks.
- **failure modes:** Unavailable/unknown/stale source, missing permission, account-mode mismatch, rate limit, source error, invalid exact decimals, identity mismatch, malformed/accessor-bearing evidence, and batch duplicates.
- **live authority:** `READ_ONLY`
- **future wiring point:** A post-audit private-read adapter supplies account-scoped evidence; risk consumes only current compatible truth.

## 14. Outcome attribution and calibration

- **name:** Outcome attribution and calibration
- **path:** `server/src/foundation/calibration/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Record immutable proposal outcomes and aggregate exact, isolated calibration cohorts without tuning strategy thresholds.
- **authoritative inputs:** Canonical proposal/outcome evidence, explicit schema/configuration/source/direction/unit/horizon context, exact decimal facts, and caller time.
- **outputs:** Complete or explicitly incomplete outcome records, exclusions/conflicts, exact integer/fraction metrics, and non-authoritative reports.
- **owned state:** Immutable attribution record/report values supplied to a caller; no mutable registry or policy state.
- **explicitly non-owned state:** Strategy thresholds, automatic tuning, execution decisions, account/ledger mutation, timers, environment, storage, and network.
- **tests:** `server/test/foundation/calibration/` — 105 behavior + 25 import-purity = 130 checks.
- **failure modes:** Missing cost/outcome evidence, incompatible cohort dimensions, duplicate identity conflict, invalid revision/schema/exact decimal, excessive records/issues, malformed/accessor-bearing values, and zero-denominator metrics.
- **live authority:** `NONE`
- **future wiring point:** An audited attribution pipeline may supply durable records and publish reports for research review; any strategy change remains a separate human/audited action.

## 15. Existing ledger

- **name:** Existing durable ledger
- **path:** `server/src/ledger.ts`
- **status:** `EXISTING_REUSED`
- **responsibility:** Remain the sole durable audit store for existing events, fills, signals, configuration, and browser-session records.
- **authoritative inputs:** Existing audited runtime event/fill/config/session writes.
- **outputs:** Durable and queryable ledger records.
- **owned state:** Durable audit truth.
- **explicitly non-owned state:** Strategy state, runtime desired state, execution authorization, risk verdict, venue truth, and foundation compatibility projections.
- **tests:** Existing baseline `server/test/gates.mjs` — 71 checks; the compatibility harness creates ledger-shaped values only and never instantiates or writes this ledger.
- **failure modes:** Existing database/open/query/write failures and malformed caller payloads; no new behavior was added in this sprint.
- **live authority:** `NONE`
- **future wiring point:** After post-audit reconciliation, an explicit adapter may append selected foundation events without replacing existing ledger ownership.

## 16. Lead-owned compatibility harness

- **name:** Lead-owned foundation compatibility harness
- **path:** `server/test/foundation/integration/` and `server/test/foundation/fixtures/`
- **status:** `BUILT_TESTED_DORMANT`
- **responsibility:** Prove the complete fake-port chain and all 16 required injections without production wiring, wall clocks, network, or live actions.
- **authoritative inputs:** Synthetic fixtures, injected clock, fake ports, and current foundation public barrels.
- **outputs:** 130 deterministic compatibility checks, 29 cross-lane import-purity checks, and test-only section 20 failure projections.
- **owned state:** Test-local aggregate/fixture state only.
- **explicitly non-owned state:** Any production state, durable audit truth, real secrets, network transport, and live execution authority.
- **tests:** `server/test/foundation/integration/compatibility.mjs` — 130 checks; `server/test/foundation/integration/import-purity.mjs` — 29 checks.
- **failure modes:** Any broken cross-lane shape, ordering, safety invariant, failure schema, timestamp projection, injection outcome, network attempt, or live-like fake-port method exits nonzero.
- **live authority:** `NONE`
- **future wiring point:** Re-run unchanged while adapting post-audit ports; it is evidence for integration, never a production composition root.

## Authority conclusion

No foundation module duplicates Basis or Volume strategy calculations, replaces
the existing ledger, or owns live execution. The only transport boundary with
order-shaped capability is dormant, injected, and restricted to Binance's
test-order endpoint. `EXECUTION_LIVE` and `LIVE_MANUAL` remain blocked.
