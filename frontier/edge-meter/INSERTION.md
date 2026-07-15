# F8 EdgeMeter future insertion request

## Current ruling

No shared insertion is implemented in this prestage. F8 remains a removable fixture adapter under `frontier/edge-meter/**`. The machine-readable request is `contracts/v1/insertion-request.v1.json`, and its `mutationImplemented` value is `false`.

The current product-composition owner is moving. That does not block this isolated fixture build, but it does make a mount decision premature. The director must schedule any later read-only product projection only after the composition owner freezes and every canonical owner below accepts the exact seam.

## Requested owner decisions

1. Capital must supply stable immutable-reference projections of its existing `EconomicReport`, accounting policy, and `AccountCapitalProjection` liability/account-truth evidence. Capital remains the only economic taxonomy, net, component-inclusion, residual, account-capital, and liability authority.
2. Q must supply stable references for forward partition, holdout/embargo, point-in-time join, calibration, abstention, uncertainty, multiplicity, deflated performance, and selection pressure. F8 must not recompute any of them.
3. L must supply a read-only adapter for the accepted immutable `ExecutionEvent` fill and execution-path reference. F8 must not open transport or create persistence to discover it.
4. The existing Ledger must supply a read-only adapter for its immutable outcome event. F8 must not create a parallel ledger or outcome store.
5. The product supervisor owner must decide whether a read-only `pnl` surface projection is accepted. A later adapter may project this module's explicit states, but it must not mount controls, recompute health, or make the fixture projection canonical.

## Requested seams

| Seam | Requested input | F8 behavior | Owner-gated future proof |
|---|---|---|---|
| Capital economics | immutable report, policy, revision, content hash, event/availability times | exact reference projection only | canonical readback and component/residual completeness |
| Capital account truth | immutable `AccountCapitalProjection` liability/account-truth reference | exact reference projection only | canonical liability completeness and account-truth readback |
| Q evidence | immutable typed references and owner-produced display values | no split, calibration, abstention, uncertainty, PBO, DSR, or selection computation | cutoff, embargo, forward-only, and owner-hash proof |
| L execution path | immutable accepted `ExecutionEvent` fill/path identity and completeness | reference-only timing path input | missing/partial/divergent path remains explicit |
| Ledger outcome | immutable accepted outcome-event identity and maturity | reference-only horizon outcome input | premature, missing, or divergent outcome remains explicit |
| Product supervisor | accepted read-only surface contract | inert projection with no controls or effects | mount/removal test owned by director and product owner |

## Hard stop

This request grants no authority, changes no shared path, creates no route, and performs no mutation. Until a director-owned integration task accepts every seam, the committed previews remain `SYNTHETIC_ONLY` and `DIRECTOR_MOUNT_REQUIRED`.
