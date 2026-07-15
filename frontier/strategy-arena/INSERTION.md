# F3 StrategyArena future insertion request

## Request posture

```text
requestId: strategy-arena.future-mount.v1
extensionId: frontier.strategy-arena
requestVersion: 1.0.0
authorityClass: NO_AUTHORITY
networkMode: FIXTURE_ONLY
mutationImplemented: false
egressDeclaration: NONE
retentionRequest: FIXTURE_ONLY_NO_CANONICAL_RETENTION
```

This document requests future canonical-owner decisions. It is not permission to edit a shared path, mount a surface, open a transport, retain canonical state, promote a strategy, allocate capital, or execute anything.

The exact machine-readable request is `fixtures/insertion-request.v1.json`, raw SHA-256 `6d3456b562b8ecf7bc658e7e037f6c4d426575d0e3d1b6537e5d9230a4e87c5b`.

## Exact future seams

| Seam | Requested read-only capability | Canonical decision required | Required future proof |
|---|---|---|---|
| `frontier/scenario-bank` / F12 | Accepted `ScenarioReferenceV1` provider artifact replacing the sealed Dock exemplar | F12 owner plus coordinator | Exact provider identity, lineage, clock/seed binding, non-execution, and removal proof |
| accepted L `df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin/**` | Immutable scenario, latency, effect, and recovery evidence projection | L owner | Exact accepted-L object/content identity, read-only adapter, no twin execution, no transport, and unknown propagation |
| accepted Q validation owner | Exact folds, dataset digest, plan status, and plan-spec/holdout-policy validation-safe leaf projections | Q owner | Rehash exact accepted leaf projections; no whole-plan, holdout membership, grant, trial ledger, or multiplicity payload in runtime inputs |
| accepted Q selection owner | New campaign-bound whole-strategy trial/multiplicity bundle | Q owner | Bind exact campaign, policy, seed, ordered snapshot hashes, and validation slice; include owner trial ledger and DSR/PBO/multiple-testing evidence; F3 creates no ledger |
| accepted Q holdout owner | New whole-strategy final-holdout grant and immutable replay bundle | Q owner only | Grant bound to exact campaign, policy, seed, snapshots, models, facts, and replay bundle; Q-enforced global one-use; no F3-created grant |
| Basis owner | Frozen whole-strategy package export | Basis owner | Exact tree/package identity, policy, seed, evidence, assumptions, and optional Q lineage; no inferred strategy behavior |
| Volume owner | Frozen whole-strategy package export | Volume owner | Exact tree/package identity, policy, seed, evidence, assumptions, and optional Q lineage; no inferred strategy behavior |
| `capitalFoundation/allocation` | Read-only capacity, contention, and allocation-assumption projection | Capital owner | Exact units, GRANTED/CAPPED/BLOCKED truth, missingness, no reservation or allocation mutation |
| `capitalFoundation/economics` | Read-only cost/economic-assumption projection | Capital owner | Exact decimal unit, complete cost identity, unknown/divergent handling, no canonical accounting write |
| `foundation/risk` | Read-only risk-assumption projection | Risk owner | Exact version/identity and fail-closed unknowns; no verdict or approval authority for F3 |
| `foundation/execution/recovery` | Read-only recovery-burden assumption projection | Foundation execution owner | Exact mechanical recovery identity and units; no plan, coordinator, or execution effect |
| `intelligenceFoundation/outcomes` | Read-only realized-outcome/cohort contract projection | Outcome owner | Exact outcome identity and ambiguity; attribution remains owner-produced, never inferred by F3 |
| Q/strategy advisory intake | Any future owner-reviewed StrategyArena retirement/demotion advisory intake | Strategy owners and Q owner | Advisory hash/target/campaign/scorecard binding, explicit human/owner review, no automatic lifecycle mutation; current output abstains because selection evidence is unavailable |
| Capital/Risk advisory intake | Any future owner-reviewed relative research-set/meta-allocation advisory intake | Capital and Risk owners | No weights, amounts, reservation, sizing, or allocation until separately authorized and owner-produced; current output is no-proposal or abstention |
| `systemIntegration/supervisor` and product projection owner | Read-only StrategyArena comparison/evidence projection | Fresh post-acceptance integrator, supervisor owner, and product owner | No recomputed truth, no controls, exact report correlation, synthetic/unknown labels, and director mount authorization |

## Owner decisions required before any port

1. Q must explicitly decide whether a new final-holdout whole-strategy contract exists. The runtime evaluator and serialized iteration inputs never receive or carry final-holdout membership. The build-time suite reads only owner-selected validation-safe leaves plus the opaque artifact content hash, not holdout membership.
2. Q must retain global one-use enforcement; StrategyArena must not implement a second holdout gate, registry, or trial ledger.
3. Basis and Volume must define the canonical frozen package shape. The current accepted tree refs are honest prestage references, not owner-approved package exports.
4. L must approve an immutable read-only scenario/recovery/effect projection. The current accepted-L type ref and ScenarioReference lineage are assumptions only.
5. Capital, Risk, Foundation execution/recovery, and outcome owners must approve every assumption projection and its units/missingness. F3 must never turn them into canonical facts.
6. Strategy and Q owners decide whether any retirement or demotion review has lifecycle consequence.
7. Capital and Risk owners decide whether any meta-allocation review proceeds; a later system must never treat the current null weights/amounts as an allocation.
8. F12 must publish an accepted scenario-provider artifact before its definitions replace the conformance exemplar.
9. A fresh integrator must re-run ownership/dedup and post-acceptance port gates before mounting anything.

## Required future tests

- Q validation-safe leaf readback against exact folds, dataset digest, plan status, and plan-spec/holdout-policy projection bytes.
- Separate Q selection-bundle readback against an owner-issued campaign-bound whole-strategy trial ledger plus DSR/PBO/multiple-testing evidence; no F3-created ledger.
- Hostile proof that iteration inputs cannot contain final-holdout sample IDs, grants, or whole-artifact payloads.
- New Q whole-strategy grant/replay-bundle scope, expiry/revocation, exact campaign binding, and global one-use proof before any final replay implementation.
- Basis and Volume package identity, seed, policy, evidence, assumptions, and optional Q-lineage readback.
- Accepted L scenario/latency/effect/recovery assumption readback with no scenario execution, socket, credential, transport, or retained state.
- Capital allocation/economics, Risk, Foundation recovery, and outcome readback with exact units and no canonical mutation.
- Unknown, divergent, stale, missing, and source-hash mismatch propagation through every adapter.
- Strategy/Q advisory review with no registry write, promotion, retirement, canary, early-stop, or rollback effect.
- Capital/Risk advisory review with no weight, amount, reservation, exposure, sizing, or allocation effect.
- Read-only supervisor/product projection with exact report correlation, no controls, and no client recomputation.
- Post-mount import, process, bounded-load, crash, restart, disable, uninstall, and removal proof showing no product write or dependency.
- Fresh scope audit showing the port changed only paths explicitly authorized by the canonical owners.

## Disable and removal request

Any future mount must be optional and idempotently removable. Disabling or uninstalling it must remove only the mounted StrategyArena adapter/projection, retain canonical owner evidence, leave no timers/sockets/processes/routes/stores, and prove the existing product behaves without the module. Production isolation remains unproven until that post-mount test exists.

## Explicit non-requests

This request does not ask for credentials, private exchange access, a real transport, orders, test orders, borrow/repay, transfer, withdrawal, leverage, margin mutation, signed calls, strategy/model registries, treatment assignment, exposure/outcome ledgers, canary control, early-stop control, rollback, persistence, deployment, or execution.
