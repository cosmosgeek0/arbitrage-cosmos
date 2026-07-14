# L09-003 — independent verification blockers after implementation

Decision status: `BLOCKED_SHARED_OWNER_DEPENDENCY`

Decision date: `2026-07-13`

Implementation reviewed:
`36d5e2a39b013b51d2b932f902ec272c9217c23c`

## Decision

Do not accept or partially repair L09 at the current cut. The implementation
is deterministic, non-sendable and inside the L09 allowlist, and every
requested automated gate passes. Independent verification nevertheless
found that the test harness and adapter can claim canonical lifecycle truth
without proving the complete accepted-owner chain required by L09.

At least two corrections require shared owners outside the L09 shard:

1. canonical Foundation must expose an accepted way to refresh a working
   opening partial before or while the next opening leg is considered;
2. canonical Foundation/L07 composition must define cold-restart hydration and
   reconciliation before an observed pre-crash fill can advance the hedge.

Additional binding gaps must be corrected only after those owners are fixed,
because an L09-only patch cannot make the phase acceptable and must not create
a second execution or reconciliation owner.

## Acceptance blockers

### 1. Working opening partials can advance and later drift

`server/src/foundation/execution/coordinator.ts` sizes the hedge from the first
positive opening fill. Its working-leg refresh is private and is invoked for
close legs, not for a still-working opening leg. A Spot `0.04/0.10` partial may
therefore cause a `0.04` hedge, after which the remaining `0.06` can fill while
canonical Foundation exposure remains `0.04/0.04`.

The L09 partial-fill test recommends a manual cancel but does not prove that
the remainder is canceled or refreshed before progression. Repair requires a
canonical Foundation lifecycle seam; the adapter may not invent one.

### 2. Restart and crash progression is not cold-start proof

The restart tests reuse one in-memory `TwinBackedFoundationPorts` instance, so
pre-crash observations and artifacts survive outside the serialized
checkpoint. The restored coordinator immediately submits the hedge without a
fresh reconciliation. A cold process would not have the prior Spot observation
that `runNormalBasisTwinLeg` requires.

A checkpoint captured while the first submission promise is pending restores
the opening Spot leg as `SUBMITTING`. Foundation's restart recovery handles
only `AMBIGUOUS`, performs no lookup for this state, and cannot progress. The
current L09 matrix has no accepted hydration path for this crash cut.

Separately, L07 sets `recoveryRequired` on crash while retaining prior local
truth. L09 classification ignores the crash flag and can project `FILLED`, so
entry can advance before restart reconciliation. A pre-venue
dispatch/crash/proven-absent path is also unrepresentable because L09 requires
exactly one venue-arrival event.

### 3. The required canonical owner chain is not proved

The positive lifecycle fixtures fabricate proposal, mandate and reservation
identities, make preflight/risk validation unconditionally pass, and implement
a local fill-ratio reconciliation function. That function independently emits
`CLOSED`, `HEDGED_OPEN` or `ONE_LEG_EXPOSED` instead of consuming canonical
Foundation reconciliation plus current private/exchange truth.

The adapter also accepts a structural Foundation state with an arbitrary
`rev_*` identifier and a shape-reduced recovery recommendation. It does not
prove the state from an owner checkpoint, and the recommendation drops owner
plan, phase, leg, client-order ID, reason and revision lineage. Caller-shaped
objects can therefore satisfy agreement/recovery gates.

### 4. Block-10 mutation identity is not exact

The L06 alias check does not bind the request sequence, request ID, intent
fingerprint, sanitized-request hash, private-projection revision or
reconciliation revision. L09 fixtures inherit sequence `0` and a constant
intent fingerprint. Spot open and close therefore reuse one derived transport
request ID; USD-M open and close reuse another.

This does not prove one unique persist-before-mutation identity per leg
attempt. It cannot be accepted under the unchanged block-10 laws.

### 5. One-way USD-M and fee truth can hide residual exposure

L09 validates `positionSide=BOTH` labels but does not require a conflict-free
baseline. Its accepted positive fixture already contains a target `+0.01`
USD-M position and an active BUY order. In one-way mode those facts share one
net position, so the planned SELL and later reduce-only BUY are not isolated
or proved to restore the baseline.

L07 also retains fill commission amount and asset, including base-asset fees.
L09 sizes and reconciles from gross Spot fill only. A base-denominated Spot fee
can therefore leave a silent residual even when the agreement reports zero.
The L07 order fixture does not carry `reduceOnly` or `positionSide`; L09 derives
those labels rather than binding them to accepted request evidence.

### 6. Remaining integrity and matrix gaps are acceptance-significant

- an expired L08 plan can reach a later venue-arrival time without a fresh
  expiry check;
- exact decimal residual `0.06` can reject Foundation binary residual
  `0.060000000000000005` during a legitimate partial close;
- `REJECTED` and `EXPIRED_IN_MATCH` are absent from the L07 status vocabulary;
- terminal partials lose terminality in the Foundation projection;
- first-leg `FAILED` has no terminal L09 agreement representation;
- tests omit required close/recovery partial, rejection, ambiguity and
  cold-restart combinations;
- retained owner/position/prior-observation structures are not deeply copied
  before the outer observation is frozen.

Any one of the first five groups blocks acceptance. Their combination makes an
L09-only correction unsafe and incomplete.

## Rejected corrections

- Do not add a local reconciliation reducer, ticket state machine, checkpoint
  owner, private-truth cache or opening-leg refresh loop under `normalBasis/**`.
- Do not relabel fixtures as canonical Capital, Risk, Foundation or exchange
  truth.
- Do not weaken L06/L07 identities, accepted status vocabularies, expiry laws,
  one-way-position rules, fee accounting or recovery gates.
- Do not expand L09 into shared Foundation, L06, L07, Ledger, package, route,
  service, UI or root-state paths.

## Required resolution

The director must first land and accept the narrow shared-owner changes that:

1. refresh or terminalize a working opening remainder before progression;
2. hydrate and reconcile cold restart/crash state before any next-leg action;
3. preserve exact request identity and request/private/reconciliation lineage;
4. provide conflict-free one-way position/open-order truth and fee-adjusted
   exposure semantics;
5. close the accepted status and recovery-state vocabulary needed by the L09
   matrix.

After rebase onto that exact accepted cut, L09 may correct only its adapter and
tests, prove the complete canonical chain, rerun the full gate, and undergo a
new independent verification.

## Preserved boundary

No runtime/test network call or exchange/private-account action occurred.
Public read-only documentation was checked; no exchange API endpoint was
called. No signer, credential, signed/test/live order, send/query/cancel,
Margin, capital, cloud, deployment, process-restart, withdrawal or transfer
action occurred. The implementation remains PAPER, synthetic, non-sendable,
`NONE_RECORD_ONLY`, and external authorization `NONE`.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
