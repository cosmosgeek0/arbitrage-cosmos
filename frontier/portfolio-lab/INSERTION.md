# PortfolioLab future insertion request

This file is a request to future canonical owners. It implements no shared edit, route, storage, transport, credential, mount, control, or mutation.

## Requested seams

1. Capital: an immutable, versioned whole-portfolio snapshot adapter for positions, proposals, liabilities, collateral, venue exposure, and strategy clusters. Capital retains allocation and sizing authority.
2. Risk: immutable references to accepted Risk outputs and caller-supplied liquidation-distance or headroom facts. Risk retains limit, verdict, and action authority.
3. Q: immutable references to accepted forecasts, model evidence, stress inputs, and uncertainty. Q retains model, dataset, calibration, and evidence authority.
4. L: immutable references to accepted fill, execution-cost, liability, open-order, venue, and recovery outputs. L retains exchange, order, execution, liability, and recovery truth.
5. Replay/source owners: an accepted recorded historical owner-output table and exact immutable adapter. The current bootstrap archive proves deterministic resampling only and preserves its hypothetical/synthetic source origins; it is explicitly not observed history.
6. ScenarioBank/F12 through Dock: an accepted immutable provider artifact at the future `frontier/scenario-bank` seam for Dock `SCENARIO_REFERENCE`. PortfolioLab must never define canonical scenarios, execute a twin, or redefine expected truth.
7. Advisory owner: an exact portfolio-level canonical advisory-output decision. The prestage report is not represented as `EdgeAssessmentEnvelopeV1`; only the Dock request envelope is mapped losslessly today.
8. Product supervisor: a read-only mount decision for the synthetic projection. The current product surface contract has no accepted PortfolioLab surface identity, so this packet does not invent one or mount to an unrelated surface.
9. Canonical control, deployment, and Product Assurance: capability/resource/retention approval; mount, disable, rollback, and uninstall decisions; and post-mount isolation, crash containment, and removal proof.

The machine-readable exact seam set is [fixtures/insertion-request.v1.json](fixtures/insertion-request.v1.json).

## Current prestage evidence boundary

Every PortfolioLab owner-output record is an explicit, hash-bound, unaccepted synthetic fixture stub. Contract refs are schema lineage only; field-level canonical-owner adapters are future insertion work. The local `f12.*` references are consumer-side scenario stubs marked `UNACCEPTED_SYNTHETIC_F12_REFERENCE_STUB`; they are not accepted F12 artifacts. The bootstrap archive is not observed history and cannot upgrade any row to `HISTORICAL`. Fixture validation through the three accepted Dock facets is available, but future canonical insertion remains blocked on accepted owner adapters, an accepted recorded historical table, an accepted F12 artifact, a portfolio-level advisory-output decision, and a product surface/mount decision. None of those blockers reduces the fixture-only prestage boundary or authorizes a shared edit.

## Explicitly not requested or implemented

- no live or test order, signing, borrow, repay, transfer, withdrawal, leverage, or margin mutation;
- no sizing, allocation, reserve, Risk verdict, execution, reconciliation, recovery, or health authority;
- no network, credentials, environment reads, persistence, route, socket, timer, deployment, or canonical state write;
- no direct import of `server`, `web`, `quant`, shared packages, or another Frontier module;
- no mounting or product UI change in prestage.

Until every owner decision and future test is complete, PortfolioLab remains `FIXTURE_ONLY`, `ADVISORY_ONLY`, `NO_AUTHORITY`, `UNWIRED`, and `DIRECTOR_MOUNT_REQUIRED`.
