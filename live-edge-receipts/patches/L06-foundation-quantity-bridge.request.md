# L06 director integration request — Foundation quantity dialect bridge

Status: `LANE_READY_ONLY`

L06 consumes a closed slice of an injected canonical Foundation
`ReconciliationResult` and an exact L05 Foundation reconciliation observation.
Foundation quantities are binary64 numbers; the mutation journal's money truth
is an exact canonical decimal string. Accepted decision D0009 reserves any
general conversion/integration bridge to the director.

## Lane-safe subset

The L06 adapter compares the two dialects only when both values are the same
non-negative JavaScript safe integer in canonical base-10 form. This subset is
mathematically exact and is labelled `BINARY64_ROUND_TRIP_PROJECTION`.
Fractional, exponent-form, unsafe or mismatched quantities remain `UNKNOWN` and
cannot produce `RECONCILED`.

The adapter never takes a Foundation number as journal money truth. Exact
cumulative quantity always comes from the validated append-only journal's L05
private order/fill evidence. The Foundation slice supplies owner status and
identity only; L06 derives its versioned projection and carries no
reconciliation authority.

## Required director decision

Before production composition can reconcile fractional quantities, the
director should add one explicit conversion contract owned by Foundation or
System Integration that:

1. accepts the exact journal decimal plus the canonical Foundation binary64
   quantity and instrument step/tolerance evidence;
2. returns a closed comparison result with both original values retained;
3. proves rounding/tolerance direction and rejects exponent, overflow,
   underflow, non-finite, negative-zero and non-round-tripping values;
4. cannot mint fills, replace journal truth, clear ambiguity, execute a
   recommendation or authorize retry;
5. is covered by exact decimal, boundary, substitution and fractional tests;
6. remains inside the canonical Foundation/System Integration ownership map.

Until that decision and I00 acceptance, L06 is `BUILT_AND_TESTED` / `UNWIRED`.
No private read, query, signed/test/live order, capital action, deployment,
restart or cloud mutation is authorized by this request.
