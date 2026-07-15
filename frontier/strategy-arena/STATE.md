# F3 StrategyArena state

## Authoritative state

```text
module: F3 StrategyArena
verifiedAt: 2026-07-16T04:10:23+0530 IST
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

The final source commit SHA is intentionally not embedded in its own contents. The post-commit readback in the worker handoff and Git history is authoritative.

## Current truth

- The accepted-source/scout search found a real gap: no accepted owner compared complete frozen Basis and Volume strategy packages across one declared campaign. Existing owners retain every strategy, Q, L, Capital, Risk, recovery, outcome, lifecycle, and cockpit authority.
- StrategyArena is an isolated, unmounted, fixture-only module. Its source imports only module-local files and the inherited read-only Dock implementation.
- The campaign accepts only `ITERATION` plus `WALK_FORWARD_VALIDATION`. It consumes four validation-safe Q14 leaves only. Campaign-bound whole-strategy trial/multiplicity evidence is unavailable, and the final holdout remains separately sealed until Q issues a new whole-strategy grant and immutable replay bundle bound to the exact campaign, policy, seed, snapshots, models, and facts, with Q enforcing global one-use.
- Basis and Volume snapshots bind exact canonical strategy tree object/content identities. Their rule-based fixtures claim no Q model linkage. Q15 is tested only as an exact Dock adapter conformance fixture.
- The accepted L type ref is an immutable assumption and its scenario lineage is not executed. A canonical L evidence projection remains an insertion request.
- Economics, exposure, outcome, and capacity values are synthetic fixture facts. Exact accounting is reconciled, missing truth remains unknown, and no attribution or decision alternative is computed.
- Reports are accepted only when they exactly equal deterministic re-evaluation of their originating campaign through a caller-supplied pinned-identity resolver. Runtime validates reference shapes and projection digests but does not independently retrieve accepted-source bytes.
- Different projections from the same Q artifact count as one correlated evidence family. No single metric selects a winner.
- Because campaign-bound whole-strategy trial/multiplicity evidence is unavailable, every lifecycle advisory is `ABSTAIN_UNKNOWN / SELECTION_PRESSURE_UNAVAILABLE`; meta-allocation is `NO_PROPOSAL`, or `ABSTAIN_UNKNOWN` when no candidate is comparable. No weights, amounts, mutation, reservation, or allocation are produced.
- The product-surface artifact is sealed, synthetic, unmounted, control-free, bound to the fixture report hash, and exposes six evidence rows, including explicit `MISSING` selection-pressure and final-holdout blockers.

## Local proof

```text
command: node --test --test-concurrency=1 frontier/strategy-arena/tests/strategy-arena.test.mjs
tests: 46
passed: 46
failed: 0
skipped: 0
cancelled: 0
```

The suite covers accepted Q source identity plus validation-safe leaf readback, exact Git/projection identities, Q semantics, frozen snapshots, unknown propagation, accounting, exposure, same-event and same-strategy overlap comparison, Pareto scoring, source correlation, abstention advisories, resolver/callback/Proxy immutability, Dock facets, runtime/schema parity vectors, artifact hashes, resource preflight, static imports, secret scanning, and hermetic import/crash/removal behavior.

No full repository, I00, browser, integration, replay campaign, live transport, credential, or deployment check was run.

## Resource state

- Maximum fixture rate: `64` events per injected `1000ms` window.
- Queue capacity: `1` event.
- At `64`: all `64` deterministic fixture events are processed.
- At `65`: state is `DEGRADATION_REQUESTED`, accepted events are `0`, processed events are `0`, and no silent loss or forged green is reported.
- Queue burst `2`: state is `DEGRADATION_REQUESTED`, processed events are `0`.
- Network bytes: `0`; model calls: `0`; runtime storage transport: absent.
- Production CPU, memory, and disk claims remain `UNAVAILABLE` because no mounted process exists.

## Open limitations

- No final-holdout implementation or Q whole-strategy grant/replay bundle.
- No Q-owner-issued campaign-bound whole-strategy trial/multiplicity selection-pressure bundle.
- No accepted frozen strategy-package export from Basis or Volume; current snapshots pin their accepted trees.
- No owner-issued canonical economics, capacity, risk, recovery, L scenario/effect, or realized-outcome facts.
- No decision-level counterfactuals, treatment assignment, canonical attribution, or exposure/outcome ledger.
- No strategy registry, promotion, retirement, allocation, canary, early-stop, rollback, execution, route, persistence, or deployment authority.
- No F12 accepted provider artifact; the Dock ScenarioReference exemplar remains conformance-only.
- No product mount, production isolation, runtime safety, forward edge, live readiness, or profitability proof.

## Next authorized action

Stop at prestage. A fresh coordinator may read this module and its receipt. Any later shared-system work must first adjudicate `INSERTION.md`, obtain canonical-owner approval, and follow the Frontier post-acceptance port law. This worker has no merge, mount, deploy, push-to-Main, or mutation authority.
