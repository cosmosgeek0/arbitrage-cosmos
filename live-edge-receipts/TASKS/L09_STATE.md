# L09 state — normal Basis lifecycle shard

Generation: `1`

Status: `BLOCKED_SHARED_OWNER_DEPENDENCY`

## Git and frozen inputs

- Worktree: `/Users/cosmosgeek/Desktop/l09-normal-basis`
- Branch: `l09-normal-basis-20260712`
- Frozen phase base/current pre-blocker HEAD:
  `4ae270ac70fb819a706f94e85dfc2b6805edda9b`
- D-LAUNCH-5 board commit:
  `1fec867fa3f62d17829543b3776dc768506ae8ac`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Accepted L08 implementation: `0ea48414dcc7ab5fcf4ccd4ff295b4bec7ee222f`
- Accepted L08 lane state: `86ab1b9d6bd3ea5604d0c61dd2d3b2cb902cd282`
- Merged L14 parent: `04e50f43ab18b1a0e4b03effcb70f0d7ea5a0e28`
- L directive SHA-256:
  `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`
- L08 receipt SHA-256:
  `e232f9180c2933f6677965ed66341177dce8fe5353d37b0627747661a23bedc9`
- Existing Spot bridge request SHA-256:
  `a80a5f5d70ed2345fc9fc2b085aeab56ff9734ac4afc7e719ea8d5f5d985c0c6`

The tracked tree and index were clean at launch. The only untracked inputs are
the preserved owner directives `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` and
`LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md`.

## Exact exclusive implementation route

- Source module: `server/src/liveEdge/adapters/normalBasis/**`
- Matching tests: `server/test/liveEdge/normalBasis/**`
- Local receipt/state: `live-edge-receipts/TASKS|RECEIPTS|DECISIONS/L09*.md`

No source or test file has been created because the required upstream owner
output is mechanically unavailable.

## Canonical owners to reuse after unblock

- Basis strategy/proposal: `server/src/engine/basis/**`
- Capital mandate/reservation/staging: `server/src/capitalFoundation/**`
- Risk, ticket/leg lifecycle, checkpoint and recovery:
  `server/src/foundation/**`
- Mutation identity and ambiguity: accepted L06
- Deterministic venue/local truth: accepted L07
- Execution mechanics: accepted L08 after the director-owned Spot bridge
- Durable control evidence: accepted L14, read-only
- Persistence: existing Ledger only

## Blocker proof

- Current accepted-owner Spot projection (`BLOCKED`, no TIF) returns
  `REJECTED`, reason `INSTRUMENT_OR_FILTER_UNAVAILABLE`, `selectedPlan=null`.
- A forged Spot `PASS` projection returns `REJECTED`, reason `INPUT_REJECTED`,
  `selectedPlan=null`.
- Accepted L08 regression gate passes `45/45`, including the named test
  `accepted L04 capability/readiness projections fail closed for Spot TIF`.
- Accepted L07 twin passes `69/69`.
- Canonical Foundation execution owner passes `132/132` and already proves
  the generic PAPER normal-Basis state machine; L09 must adapt it, not replace
  it.

## Commands and measured results

- `npm ci`: exit `0`, 229 packages added, audit reports 0 vulnerabilities.
- `npm run build -w server`: exit `0`.
- Focused L08 execution policy: `45/45`, exit `0`.
- Focused L07 exchange twin: `69/69`, exit `0`.
- Foundation execution owner: `132/132`, exit `0`.
- Explicit compiled L08 Spot reproduction: accepted-owner input rejects with
  `INSTRUMENT_OR_FILTER_UNAVAILABLE`; forged `PASS` rejects with
  `INPUT_REJECTED`; exit `0`.

The L09 focused, accumulated, protocol, `npm test` and `npm run test:all`
acceptance gates were not run because no acceptable L09 implementation can be
created before the owner bridge exists. Existing focused owners remain green;
this state does not claim L09 implementation or acceptance.

## Current posture and non-claims

- L09: `BLOCKED_SHARED_OWNER_DEPENDENCY`
- Implementation: `ABSENT`
- Wiring: `UNWIRED`
- Evidence: accepted L08 blocker reproduction plus accepted L07/Foundation
  regression proofs
- Money authority: `NONE`
- External actions: `NONE`
- Secrets inspected: `NONE`
- Live/test/signed orders or private reads: `NONE`
- Reverse Basis, Margin/liability and Volume work: `NONE`

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No synthetic policy plan,
ticket state machine, send path, control authority or persistence owner was
invented.

## Exact resume

After the director accepts and lands the existing Spot capability bridge:

1. verify the new assigned base/HEAD and ancestry from
   `0ea48414dcc7ab5fcf4ccd4ff295b4bec7ee222f`;
2. verify the accepted L08 evaluator now emits a non-sendable ordered plan
   with exact `SPOT` and `USD_M_PERPETUAL` legs;
3. update this state to generation `2`, status `WORKING`;
4. implement only `server/src/liveEdge/adapters/normalBasis/**` and matching
   tests;
5. run the full L09 gate and seal implementation, immutable receipt and
   single-phase acceptance commits.

Do not repeat the root-doc/owner-map audit unless the assigned base changed.
