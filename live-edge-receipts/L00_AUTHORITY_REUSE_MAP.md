# L00 authority and reuse map

Status: source-and-test inventory complete; L00 acceptance blocked by input integrity.

Classification axes are independent: `buildState`, `wiringState`, `evidenceSource`, `moneyAuthority`, and `proofState`. `RUNNING` below is used only where accepted runtime/integration receipts support it; no private runtime was exercised in L00.

| Responsibility | Canonical owner and proof | Current classification | Narrow L seam or proven gap | Duplicate forbidden |
| --- | --- | --- | --- | --- |
| Public acquisition, source lifecycle and recording | `server/src/intelligenceRuntime/**`, especially `capture/**`, `bridge/**`, `lifecycle/**`; tests under `server/test/intelligenceRuntime/**` | `TESTED / RUNNING / LIVE_PUBLIC / IMPOSSIBLE / PROVED` | Expose capture gaps, quotas, storage pressure and health through an adapter. Recording failure degrades research truth, never reconciliation/recovery. | New socket, public cache, capture store or source lifecycle |
| Basis decisions and proposals | `server/src/engine/basis/**`; `server/test/engine-basis.mjs`; existing system adapter capture | `TESTED / RUNNING / LIVE_PUBLIC / IMPOSSIBLE / PROVED` | Translate Q protocol output to advisory evidence only. No current assessment input port; any owner insertion is a director patch. | Basis detector, score, proposal store or lifecycle |
| Volume decisions, focus and proposals | `server/src/engine/volume/**`; `server/test/engine-volume.mjs` | `TESTED / RUNNING / LIVE_PUBLIC / IMPOSSIBLE / PROVED` | Same advisory-only translation; no protocol-to-proposal or protocol-to-order shortcut. | Volume detector, confidence, focus manager or proposal store |
| Cross-engine canonical projection | `server/src/foundation/readModel/**` and `server/src/systemIntegration/adapters/engineCapture.ts`; focused read-model/adapter tests | `TESTED / WIRED / LIVE_PUBLIC / IMPOSSIBLE / PROVED` | Reuse one-way owner projection; preserve rejected malformed records and unknown fields. | L/UI proposal normalization or ranking |
| Q/L protocol compatibility | Frozen `EDGE_PROTOCOL_V1.md` and `packages/edge-protocol/**`; protocol test 22/22 | `TESTED / UNWIRED / REPLAY / IMPOSSIBLE / PARTIAL` | No production assessment/health/outcome/feedback consumer exists. L01 may validate, bound, expire and backpressure messages, but owns no strategy/capital semantics. | Handwritten schema fork, model authority or direct execution path |
| Capital eligibility, reservation, stages and position economics | `server/src/capitalFoundation/**`; capital tests 433/433 | `TESTED / WIRED / SYNTHETIC / BLOCKED / PARTIAL` | Feed exact coherent cached cuts via existing account-truth adapter. Fixed 10-USDT canary remains unchanged; later ladder is an evidence seam only and cannot auto-promote. | Allocator, sizing, reservation queue, approval, ladder authority or PnL owner |
| Final risk verdict | `server/src/foundation/risk/**`; `server/test/foundation/risk/risk.mjs` | `TESTED / WIRED / SYNTHETIC / BLOCKED / PROVED` | Adapter supplies current exact evidence and invokes `evaluateMultiLegRisk`. | Risk policy, gate or verdict synthesis |
| Mechanical execution and recovery state | `server/src/foundation/execution/**`; execution tests | `TESTED / WIRED / SYNTHETIC / IMPOSSIBLE / PROVED` for sealed paper path | Current coordinator is Basis-only, binary64 and exposes sealed paper submission. Future ticket/journal work must project/extend this owner via director-approved authority, not shadow it. | Ticket reducer, coordinator, signed hand or recovery state owner |
| Exchange/local reconciliation | `server/src/foundation/reconciliation/**`; reconciliation tests | `TESTED / WIRED / SYNTHETIC / BLOCKED / PROVED` | Normalize private evidence into owner states; partial, ambiguous, divergent, stale and unavailable remain blockers. | Comparison/reconciliation algorithm |
| Borrow truth | `server/src/foundation/borrow/**`; borrow tests | `TESTED / WIRED / SYNTHETIC / BLOCKED / PROVED` for read-only derivation | Legacy Margin reads may be physical inputs. Reverse-Basis liability reducer/borrow-repay lifecycle is absent and requires director authority resolution. | Borrow cache, liability truth or mutation owner |
| Durable history | `server/src/ledger.ts`; `server/src/systemIntegration/persistence/ledgerAdapter.ts`; storage and restart tests | `TESTED / RUNNING / LIVE_PUBLIC / IMPOSSIBLE / PROVED` | Add bounded persistence ports and director wiring patches only. Ledger event time remains commit/receipt time. | SQLite database, JSON journal, file store, ticket DB or outcome DB |
| Machine control and supervisor truth | `server/src/foundation/control/**`; `server/src/systemIntegration/{composition,controls,supervisor,routes}/**`; focused tests | `TESTED / RUNNING / LIVE_PUBLIC / BLOCKED / PROVED` | L provides component/read adapters; graph nodes, commands, routes and composition are director patches. Q regime is advisory and `UNKNOWN` fails conservative. | Control plane, machine lifecycle, supervisor, regime supervisor or UI truth calculation |
| Cockpit | Existing system-integration web client/surfaces and accepted pages | `TESTED / WIRED / LIVE_PUBLIC / BLOCKED / PARTIAL` | Only additive feature adapters; existing pages/types require director patches and rendered ship-gate verification in L14. | Client recomputation, decorative controls or fake health |
| Deployment/rollback/backup | No `ops/**` tree exists; audit documents and storage hardening are evidence only | `ABSENT / UNWIRED / NONE / IMPOSSIBLE / UNPROVED` | `ops/live/**` may later add inert manifests/tests/runbooks. Actual region measurement, deploy, cloud mutation or restart is owner-gated. | Claimed deployed authority or unapproved cloud operations |

## Early-phase reuse and gaps

### L01 protocol seam

- Reuse frozen protocol schema/fixtures plus `intelligenceRuntime/contracts/boundedJson.ts`, Foundation time/authority/failure contracts and existing system dialect adapters.
- No `EdgeAssessmentEnvelopeV1`, `EdgeBrainHealthV1` or feedback consumer exists in production source; no `server/src/liveEdge/**` tree exists.
- Expected additive seam: `server/src/liveEdge/adapters/edgeProtocol/**` and `server/src/liveEdge/integration/assessmentBridge.ts`, followed by an inert director patch for production composition.

### L02 official source matrix

- Existing route declarations are scattered across Runtime source catalog/smoke/universe, dormant Foundation USD-M types, and legacy Binance files.
- `buildSystemSourceRegistry` already enforces one semantic producer but is not production-wired.
- No dated machine-readable Spot/USD-M/Margin realm/route/auth/lifecycle/weight matrix or path contract test exists.
- Expected additive seam: `server/src/liveEdge/adapters/binanceSourceMatrix/**`; canonical source catalog changes remain director-owned.

### L03 signing, clock and budgets

- Reuse dormant exact injected USD-M kernel in `server/src/foundation/exchange/binanceUsdM/**`, deterministic client IDs from Foundation exchange contracts, and Runtime rate-budget concepts.
- Do not promote legacy `server/src/binance/client.ts` as canonical: it reads environment state, exposes mutation methods and can retry signed requests under clock error.
- Missing: common product kernel, supported key-algorithm abstraction, robust clock estimator, monotonic request sequence, endpoint-specific budget ledger and durable mutation ambiguity.

### L04 filters

- Runtime universe parser preserves raw exact filter JSON and a stable listing fingerprint; dormant USD-M validation has exact decimal support for a subset; Foundation Risk remains the final gate.
- Legacy number/rounding paths are not sufficient.
- Missing: director-approved cross-product registry authority, full current filter/status coverage, revision invalidation, down-rounding/capital revalidation and property tests.

### L05 private truth

- Reuse Capital account projection, Foundation borrow/risk owners, system account-truth adapter and dormant exact USD-M parsers.
- Legacy Spot reads/stream and Margin reads exist outside convergence and may donate narrow cached read-only facts only.
- No independently fresh Spot/USD-M/Margin composite truth exists; no USD-M or Margin private stream lifecycle exists; current production Capital/account truth is unavailable or synthetic.
- No private reads were attempted in L00.

## Authority amendments required before implementation that would otherwise create owners

1. Exact point-in-time cross-product filter registry.
2. Cross-product private-source lifecycle/coherent cut.
3. Volume mechanical execution lifecycle.
4. Reverse-Basis liability reducer and borrow/repay lifecycle.
5. Any future live submission path; current Foundation live mode is mechanically blocked.
6. Exact signed Spot/Margin kernel authority where legacy and dormant owners overlap.

Until the director resolves these, L may build only narrow stateless adapters, deterministic fixtures and patch proposals; it may not silently choose an owner.
