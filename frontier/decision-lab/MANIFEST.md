# F13 DecisionLab manifest

This manifest describes a blocked, fail-closed DecisionLab scaffold. It is not a prestage-ready organ.

## Durable accounting

```text
buildState: BUILDING
disposition: BLOCKED
terminalLabel: BLOCKED_OWNER_POLICY_ARTIFACT_UNAVAILABLE
RESEARCH_ONLY
NO_DECISION_AUTHORITY
```

## File inventory

### Root evidence

- `STATE.md` — authoritative lifecycle state, blocker, proof boundary, and resume condition.
- `RECEIPT.md` — ancestry, directive, Dock, owner, test, research, scope, and independent-review evidence.
- `INSERTION.md` — Q-only future admission request; no shared change is implemented.
- `LIMITATIONS.md` — explicit missing evidence and non-claims.
- `RESEARCH.md` — separately receipted public-documentation research.
- `ARTIFACT_HASHES.sha256` — SHA-256 inventory of every module artifact except itself.

### Contracts

- `contracts/provider-facet-refs.v1.json` — exact usable F0 `EXPERIMENT_PROVIDER` and `COCKPIT_PROJECTION` bindings.
- `contracts/q15-experiment-card.adapter-map.v1.json` — committed lossless identity adapter for the synthetic Q15 fixture.
- `contracts/resource-budget-claim.v1.json` — honest configuration-only limits and unavailable host benchmarks.
- `contracts/insertion-request.v1.json` — Dock-valid single-seam request to canonical Q research.

No portable JSON schema is promoted while blocked. A permissive schema would be a false proof; the closed runtime validators are the executable contract until a strict schema is independently accepted.

### Runtime source

- `src/bounds.mjs` — iterative structural limits; rejects cycles, accessors, symbol keys, non-plain objects, excessive depth/nodes/text/arrays/keys.
- `src/contracts.mjs` — closed V1 record validation, accepted-owner allowlists, temporal cutoff rules, immutable path/cost equality, unavailable-outcome law, bias floors, report recomputation, and authority denials.
- `src/dock.mjs` — exact F13 Dock binding selection, Q15 adapter validation/roundtrip, read-only projection, and insertion validation.
- `src/evaluate.mjs` — deterministic request snapshot and report composition.
- `src/index.mjs` — module-local exports.
- `src/owner-contracts.mjs` — frozen accepted Git refs and content hashes. Where an owner exports no literal version, `contractVersion` is a DecisionLab-local frozen alias; the Git ref, type/schema name, commit, and SHA-256 are the provenance authority.
- `src/policy-manifest.mjs` — seven-item synthetic scenario grammar. Its timestamps are non-authoritative metadata and do not prove historical predeclaration.
- `src/preview.mjs` — strict local read-only preview construction and validation.

The runtime source imports only F0 Dock primitives. It imports no product/core, filesystem, environment, network, timer, randomness, credential, persistence, or mutation facility.

### Fixtures

- `fixtures/factory.mjs` — deterministic bounded fixture factory and synthetic Q15 card.
- `fixtures/synthetic-accepted.v1.mjs` — synthetic accepted-decision shape.
- `fixtures/synthetic-rejected.v1.mjs` — synthetic rejected-decision shape.
- `fixtures/unverified-recorded-shape-abstained.v1.mjs` — structure-only abstained shape; not recorded evidence.
- `fixtures/unverified-recorded-shape-missed.v1.mjs` — structure-only missed-opportunity shape; not recorded evidence or profit proof.

No fixture contains accepted owner record bytes. Every evidence-dependent outcome and ablation remains `UNAVAILABLE`.

### Tests and preview

- `tests/decision-lab.test.mjs` — 62 network-free module-local tests covering deterministic success shapes, hostile temporal/structural/authority failures, owner boundaries, all-unavailable semantics, exact Dock facets, Q15 roundtrip, read-only projection, insertion conformance, and the committed unavailable-prestage resource claim.
- `preview/README.md` — preview posture and bounded generation instructions; no static preview is promoted as recorded truth.

## Implemented scaffold boundary

The code can validate and project a deterministic, immutable one-decision report shape with exactly seven alternatives and the complete one-at-a-time ablation grammar. It refuses to evaluate missing owner policies, invent outcomes, estimate propensities, rank/select alternatives, issue orders, or claim causal/profit authority.

The missing owner artifacts are capability inputs, not optional polish. Their absence is why this module remains `BUILDING / BLOCKED` despite a green focused suite.
