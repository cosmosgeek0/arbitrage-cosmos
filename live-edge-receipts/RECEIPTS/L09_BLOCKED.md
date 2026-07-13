# L09 immutable blocker receipt — normal Basis lifecycle

Receipt status: `BLOCKED_SHARED_OWNER_DEPENDENCY`

Lane phase disposition: `BLOCKED_BEFORE_IMPLEMENTATION`

Integrated acceptance: `NO`

Accepted L09 SHA: `NONE` — the phase is blocked and no implementation is
claimed accepted.

## Commit and input chain

- Frozen L09 base:
  `4ae270ac70fb819a706f94e85dfc2b6805edda9b`
- Frozen base tree: `6d9c5f44b2800839e0154b70dcd9e0ae7a77c577`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Accepted L08 implementation:
  `0ea48414dcc7ab5fcf4ccd4ff295b4bec7ee222f`
- Accepted L08 lane state:
  `86ab1b9d6bd3ea5604d0c61dd2d3b2cb902cd282`
- Merged L14 parent:
  `04e50f43ab18b1a0e4b03effcb70f0d7ea5a0e28`
- L09 blocker evidence commit:
  `7602a4eff627baf3c11bd938de82973a39778013`
- L09 blocker evidence tree:
  `34896df389923929a458e52a16cd92d5e6fd3c4a`
- D-LAUNCH-5 board commit:
  `1fec867fa3f62d17829543b3776dc768506ae8ac`

This receipt references the preceding blocker evidence commit. It cannot
contain the SHA of its own containing commit.

## Frozen input and artifact hashes

- L directive SHA-256:
  `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`
- L08 task SHA-256:
  `ce8e5ac3df5f395830675173f4ccb7fac4582c586f9adce027cc53e1baeba061`
- L08 receipt SHA-256:
  `e232f9180c2933f6677965ed66341177dce8fe5353d37b0627747661a23bedc9`
- L08 policy decision SHA-256:
  `ed904e8e2bf9f7e9c3047cfa6d360aa7682d05c6bb1b3deeff97273b467449cd`
- Existing Spot bridge request SHA-256:
  `a80a5f5d70ed2345fc9fc2b085aeab56ff9734ac4afc7e719ea8d5f5d985c0c6`
- L09 task SHA-256:
  `b2c601acd9505610cf5fa35b1c825dfd0a7912506006aca7881184c1494543f9`
- L09 blocker decision SHA-256:
  `ced18872d60377c58fee9b39cecec93e70a8f32084c32bd23fba6c0e6cdaafca`
- Pre-receipt L09 task/state/decision aggregate SHA-256:
  `76033e9c3795089ad4458e5f8ae8921fe9a81d629e3b26383c48dc27232a6b4a`

## Exact blocker

The required accepted-owner chain contains an L08 ordered plan with one Spot
leg and one USD-M leg. Accepted L08 cannot emit that plan:

1. its strict leg validator permits `SPOT` only when accepted L04 truth is
   `BLOCKED` and the TIF set is empty;
2. its evaluator rejects every non-`PASS` leg with
   `INSTRUMENT_OR_FILTER_UNAVAILABLE`;
3. presenting a Spot leg as `PASS` violates accepted owner truth and returns
   `INPUT_REJECTED`;
4. both paths return `selectedPlan=null`.

The exact compiled reproduction produced:

```json
{
  "acceptedOwnerSpot": {
    "disposition": "REJECTED",
    "reasonCodes": ["INSTRUMENT_OR_FILTER_UNAVAILABLE"],
    "selectedPlan": null
  },
  "forgedSpotPass": {
    "disposition": "REJECTED",
    "reasonCodes": ["INPUT_REJECTED"],
    "selectedPlan": null
  }
}
```

The accepted L08 test fixture's `leg-spot` is actually a
`USD_M_PERPETUAL` product and cannot be relabeled as normal-Basis proof.

## Why implementation stopped

The canonical Foundation execution owner already implements plan/leg
lifecycle, actual-fill-sized second-leg submission, one-leg exposure,
ambiguity resolution, close, checkpoint/restart and data-only recovery
recommendations. Creating another L09 lifecycle would violate the authority
map. Handcrafting a positive L08 decision would bypass the accepted policy
owner. Editing L04/L08 would violate this shard's exclusive paths.

The existing director-owned request
`live-edge-receipts/patches/L08-spot-tif-capability.request.md` is the exact
unblock path. It remains `DIRECTOR_REVIEW_REQUIRED` at this receipt.

## Current official-source check

Official public sources were rechecked on `2026-07-13`; no Binance endpoint,
account, credential, signed action, test order, socket or private stream was
called.

- Spot status and fill semantics:
  `https://github.com/binance/binance-spot-api-docs/blob/master/enums.md#order-status-status`
- Spot cumulative fill evidence:
  `https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md#order-update`
- Spot 5xx outcome remains `UNKNOWN`:
  `https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#general-api-information`
- USD-M one-way/hedge `positionSide` and `reduceOnly` rules:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#new-order`

Current venue semantics reinforce the required actual-fill, ambiguity and
one-way/reduce-only invariants but do not create the missing accepted Spot
capability binding.

## Measured verification evidence

- `npm ci`: exit `0`; 229 packages added; audit reported 0 vulnerabilities.
- `npm run build -w server`: exit `0`.
- L08 execution-policy suite:
  `node --test --test-concurrency=1 --test-reporter=spec
  "server/test/liveEdge/executionPolicy/**/*.test.mjs"`: `45/45`, exit `0`.
- L07 exchange-twin suite:
  `node --test --test-concurrency=1 --test-reporter=spec
  "server/test/liveEdge/exchangeTwin/**/*.test.mjs"`: `69/69`, exit `0`.
- Canonical Foundation execution owner:
  `node server/test/foundation/execution/execution.mjs`: `132/132`, exit `0`.
- Explicit compiled L08 legal/forged Spot reproduction: exit `0`, exact JSON
  recorded above.
- `npm test`: deterministic standard gate `377/377`, exit `0`.
- `git diff --check`: pass.

The L09 focused, accumulated liveEdge, protocol and `npm run test:all` gates
were not run because L09 has no permissible implementation before the shared
owner dependency is resolved. This receipt does not convert green owner
regressions into L09 acceptance.

## Scope and working-tree proof

- Branch: `l09-normal-basis-20260712`.
- Base `4ae270a` is the exact D-LAUNCH-5 L09 base.
- Blocker evidence commit changes only:
  - `live-edge-receipts/TASKS/L09.md`
  - `live-edge-receipts/TASKS/L09_STATE.md`
  - `live-edge-receipts/DECISIONS/L09-001-NORMAL-BASIS-BLOCKER.md`
- The receipt commit adds this receipt and updates only `L09_STATE.md` with
  the blocker evidence commit and standard-gate result.
- No source, test, Foundation, L04, L08, shared barrel, Ledger, package,
  route, service, UI, reverse-Basis or Volume path changed.
- The two untracked owner directives remain preserved unchanged.

## Explicit non-claims

- No L09 lifecycle implementation, policy plan, trade ticket, coordinator,
  reducer, control, journal, ledger or persistence owner was created.
- No proposal was approved, no Capital/Risk authority was minted or changed,
  and no recovery action was executed.
- No private/account read, signer, credential, signed request, test/live
  order, send/query/cancel, listen key, socket, Margin action or capital
  change occurred.
- No AWS, Cloudflare, Secrets, deployment, process restart or push occurred.
- No withdrawal or transfer capability was added.
- No secret value was inspected, retained, logged or committed.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.

## Exact resume condition

Resume this same L09 task only after the director lands an accepted L04/L08
Spot order/TIF capability bridge and provides a new exact L09 base. First
prove the accepted evaluator emits a non-sendable ordered normal-Basis plan;
then implement only `server/src/liveEdge/adapters/normalBasis/**` and matching
`server/test/liveEdge/normalBasis/**` proofs. Until then L09 remains
`BLOCKED`, not `PARTIAL`, `LANE_READY` or `ACCEPTED`.
