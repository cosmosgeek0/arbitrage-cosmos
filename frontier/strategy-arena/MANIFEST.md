# F3 StrategyArena manifest

## Terminal record

```text
module: F3 StrategyArena
extensionId: frontier.strategy-arena
branch: f-arena-0715f
immutableBaseSha: f0168cb37bd04d21bc90591ab2256770de3b75bc
dockContractSha: e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5
directiveSha256: 4bb325b23c70e56103ee1553f0ea4396774ce0950d7abc9c73faa01f7006e1ad
buildState: PRESTAGE_READY
disposition: ACTIVE
terminalLabel: STRATEGY_ARENA_PRESTAGE_READY
RESEARCH_ONLY
NO_REGISTRY_AUTHORITY
NO_PROMOTION_AUTHORITY
NO_EXECUTION
```

The source commit containing this manifest is resolved and printed after commit. A Git commit cannot embed its own SHA without changing that SHA. The descriptor `sourceSha` therefore remains the inherited sealed Dock SHA, following the F0 prestage contract convention.

## Owned delta

StrategyArena owns deterministic fixture campaigns over F3-frozen evaluation snapshots that pin accepted Basis and Volume tree identities; these snapshots are not owner-approved canonical package exports. It emits comparative fixture reports only.

It does not own or recreate strategy behavior, Q splits or model lifecycle, L scenarios or recovery, Capital allocation or economics, Foundation risk or execution, realized outcome truth, the supervisor projection, product mounting, persistence, transport, execution, or promotion.

## Module inventory

| Path | Purpose |
|---|---|
| `src/constants.mjs` | Sealed limits, Dock identities, authority boundaries, metrics, and limitations |
| `src/validation.mjs` | Exact bounded validation, canonical code-unit ordering, hashes, exact micros, and immutable refs |
| `src/contracts.mjs` | Frozen snapshots, events, observations, Q validation-only authority, policies, and campaigns |
| `src/tournament.mjs` | Shadow scorecards, Pareto tiers, dependence checks, advisories, evidence, and campaign-derived report validation |
| `src/adapters.mjs` | Exact released-Dock facet adapters and caller-supplied pinned-identity owner-reference attestation validation; runtime does not independently fetch source bytes |
| `src/preview.mjs` | Unmounted read-only cockpit and sealed product-surface fixture projections |
| `src/resources.mjs` | Preflight-first deterministic fixture resource proof and fail-closed degradation |
| `src/index.mjs` | Module-only public exports |
| `contracts/v1/` | Closed Draft 2020-12 schema, three exact adapter maps, and extension descriptor |
| `contracts/CONTRACT_HASHES.sha256` | Raw SHA-256 manifest for every serialized JSON artifact |
| `fixtures/` | Q14 validation-safe owner leaf slices, Q validation projection, tournament campaign, resource claims, and insertion request |
| `preview/` | Deterministic scorecard and product-surface fixtures; never mounted truth |
| `tests/fixtures.mjs` | Exact immutable owner refs and deterministic fixture builders |
| `tests/schema-fixture.mjs` | Closed schema generator used by the hostile schema proof |
| `tests/generate-artifacts.mjs` | Deterministic artifact generator; no runtime network |
| `tests/strategy-arena.test.mjs` | Sole module-local verification entry point |

The only module-root records are this manifest, `STATE.md`, `RECEIPT.md`, and `INSERTION.md`.

## Pinned owner inputs

| Owner | Immutable source | F3 use |
|---|---|---|
| F0 Dock | `e0ace68de5d56bdfe51bb30cf74e44c6f109dfd5` | Exact `EXPERIMENT_PROVIDER`, `SCENARIO_REFERENCE`, and `COCKPIT_PROJECTION` bindings |
| Accepted Main | `f0168cb37bd04d21bc90591ab2256770de3b75bc` | Basis/Volume trees and Capital/Risk/Foundation/outcome contracts, read-only |
| Accepted Q | `02b4eccc8d2ef53b830cafae06e5175715fa6ebb` | Exact Q14 validation-safe folds/dataset/status/spec leaves, EventDisposition owner ref, and Q15 conformance refs; campaign-bound whole-strategy trial/multiplicity evidence is explicitly unavailable |
| Accepted L | `df6b472993ca9659ce09cf5f72004981c6835f0d` | Immutable exchange-twin scenario/recovery type assumption only; no twin execution |
| Coordinator scout | `88722141` with content hash `c5564a9a179c8d3dbe2c2b34e952f9f731de3a83c2209cd3e20244546b207c40` | Approved real-delta and owner-boundary ruling |

## Serialized identities

- Campaign hash: `f5c46cbc3bc88e03f4d956b10ccfbdcd8c9a189b3614f700648eee7a97d6b4fe`
- Report hash: `064f43563206d9190d30c62943c2e29913a822355ad44cfc45b3ee51b48ed65d`
- Product-surface canonical hash: `746e3f733402f875b44167d68128b9fa0670c8bfc864a817e45cfc9cb9b56763`
- Raw artifact hashes: `contracts/CONTRACT_HASHES.sha256`

## Verification entry point

```sh
node --test --test-concurrency=1 frontier/strategy-arena/tests/strategy-arena.test.mjs
```

Only this module-local suite is authorized for the prestage worker. No root, full-repository, I00, browser, integration, transport, or deployment battery is part of this manifest.

## Honest boundary

This package proves deterministic fixture contracts and local adversarial behavior only. It proves no final holdout, production isolation, mounted behavior, runtime safety, canonical attribution, decision alternative, allocation, live readiness, edge, profitability, or trading authority.
