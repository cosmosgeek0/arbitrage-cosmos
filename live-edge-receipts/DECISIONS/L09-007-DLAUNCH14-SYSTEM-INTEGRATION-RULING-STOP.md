# L09-007 — D-LAUNCH-14 correction complete; System Integration ruling stop

Decision status: `STOP_FOR_DIRECTOR_SYSTEM_INTEGRATION_RULING`

Decision date: `2026-07-13`

Director ruling verified:
`0f48f3b667a9f9f7570fee624eb1e3e712c3dc50`

Correction base:
`a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`

Committed correction:
`73030fab20234d3812e3445c024d21dbc2d3222b`

## Decision

D-LAUNCH-14 clears the L09-006 owner dependency by granting exact L02/L05
authority for one additional private-truth fact class:
`USDM_ALGO_OPEN_ORDERS`.

The committed correction uses that grant narrowly. It adds a separately
hash-locked, read-only USD-M `GET /fapi/v1/openAlgoOrders` contract extension,
projects the fact through L05, permits injected fixtures to supply it and
keeps unavailable/null truth fail-closed. Standard `USDM_OPEN_ORDERS` and
`USDM_ALGO_OPEN_ORDERS` remain independent requirements. Neither can
substitute for the other.

The stage-aware normal-Basis isolation proof now requires one current,
complete and usable `USDM_ACCOUNT`, `USDM_POSITIONS`, `USDM_OPEN_ORDERS` and
`USDM_ALGO_OPEN_ORDERS` fact. It rejects target-symbol standard or algo open
orders, proves entry flatness, and independently binds close/recovery account
and position truth to the exact signed checkpoint residual.

Independent read-only review accepts all 34 source/test paths. The retained
fee-adjusted exposure, request-semantic binding, expiry, exact-decimal close,
terminal/FAILED outcome and close/restart corrections also survive review.
No money path, signer, transport, private read, secret, ambient effect or
external-action authority was added.

L09 is nevertheless not accepted. D-LAUNCH-12 and D-LAUNCH-14 explicitly
retain the `179/180` System Integration stop-for-ruling condition. The full
repository gate reproduces it after all authorized corrections:

- suite: `server/test/systemIntegration/**/*.test.mjs`;
- test: `synthetic helper coverage: partial and ambiguous states remain explicit data-only truth`;
- source: `server/test/systemIntegration/verticalSlice/authority.scenarios.test.mjs:516`;
- assertion: line `521`;
- expected: `PARTIAL`;
- actual: `DIVERGED`;
- full System Integration result: `179/180`;
- isolated scenario-file result: `28/29`.

The System Integration test blob is
`5c3d23db891ba64f286988b3022cca09a835a14c` both at `a7a0f7c` and in the
committed correction. No System Integration path occurs in the 34-path diff.
L09 therefore does not edit or reinterpret the shared reconciliation owner.

## Required director ruling

The director must rule whether the synthetic helper fixture should represent
the current owner result as `DIVERGED`, or whether the shared System
Integration owner/test requires a separately assigned correction so the
scenario canonically yields `PARTIAL`.

No exception, waiver or expected-result rewrite is inferred. Resume only from
an exact director ruling that disposes this scenario and assigns any permitted
owner path. Until then the honest phase disposition is
`STOP_FOR_DIRECTOR_SYSTEM_INTEGRATION_RULING`, not L09 acceptance.

## Preserved boundary

No private/account read, credential access, signer call, signed/test/live
order, real send/query/cancel, Margin action, capital mutation, network call,
cloud mutation, deployment, process restart, merge, push, withdrawal or
transfer was performed. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
