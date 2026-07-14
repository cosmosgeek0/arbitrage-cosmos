# L09 immutable blocker receipt — L07 Spot owner binding

Receipt status: `BLOCKED_SHARED_OWNER_DEPENDENCY`

Lane phase disposition: `BLOCKED_BEFORE_IMPLEMENTATION`

Integrated acceptance: `NO`

Accepted L09 SHA: `NONE` — no lifecycle implementation is claimed accepted.

## Commit and accepted-input chain

- Director re-base merge / L09 phase base:
  `219b4d02a02aec60e8d093079ad502d2108b9ae4`
- Phase-base tree:
  `d8f93665d8fc4061a7c8b5ab6918cd811778fa10`
- Prior immutable L09 blocker parent:
  `e315ef5e9599c7d0a1da0958bacae25f147276a9`
- Accepted L08.1 state parent:
  `f79247a759720555064754d0e6fd72573e189f32`
- Accepted L08.1 receipt cut:
  `ada6e344b6707638ec6c44e43534f45ab3babfec`
- Accepted L08.1 implementation:
  `2754d16e9bf59bbe6965ae83d8283592d2e48195`
- Frozen protocol SHA:
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- New L09 blocker evidence commit:
  `ad397169ec2ccc554548bfe253678fd1c33861e3`
- New L09 blocker evidence tree:
  `80e558836d8875da672a110ff323a6f8886c4bf7`

This receipt references the preceding blocker evidence commit. It cannot
contain the SHA of its own containing commit.

## Frozen input and artifact hashes

- L09 task SHA-256:
  `b2c601acd9505610cf5fa35b1c825dfd0a7912506006aca7881184c1494543f9`
- Evidence-commit L09 state SHA-256:
  `c432079adccf7393bc336465fe03151aae35dae99961103b53cec1177b4f5a65`
- L09-002 decision SHA-256:
  `8ea54009dbf0e87c6092d2e9ed3b8da1e49c3da6d9897c858e8707414459f990`
- L09 task/state/decision sorted-manifest aggregate SHA-256:
  `3e738518d24cd53da183cf2e8a0b91eb83801a3a85eb822c269f43b66213c1ec`
- Accepted L08.1 task SHA-256:
  `5446db24ccf2b9f02b479681f0ba9e9f3c6ec85b7e33b2b598597fbc471a6888`
- Accepted L08.1 receipt SHA-256:
  `b361cc6f2362e543f6f7e8e4b80c98bee06ce1432578378b8b1e730497716158`
- L07 owner-evidence adapter SHA-256:
  `ee6fb9872764250527fd852d27d7ecc09dcba77924ac651461545eff7b20bbde`
- L04 sizing/preflight owner SHA-256:
  `30090d76b3914507275cf895b865cfcc3c546b6d90811fded945250bbf4e2272`
- L07 twin SHA-256:
  `607c155625bd35c2a8ed6b78f4f41fe584ae9492f0c599c22b018aa9c695cbc5`
- Live-edge import-purity proof SHA-256:
  `487e7844103aa9a79c0b7a912c9a2670e92daa7faef8c6691c27eac0d7198760`
- Four owner-path sorted-manifest aggregate SHA-256:
  `44155f9e2ff04e0a6709ccc095bc2451e40315ba28c69144f88477ed88ae1d43`

## Previous blocker cleared

After a clean server build, the exact accepted L08.1 bridge proof passes
`4/4`. Its positive case emits a deeply frozen, non-sendable `ORDERED`
normal-Basis plan with:

1. Spot `BUY LIMIT GTC` first;
2. USD-M perpetual `SELL` second;
3. second-leg quantity sourced from `ACTUAL_FILL_OF_LEG` on the Spot leg;
4. capability revision and exclusive expiry retained;
5. `sendEligible=false`, `actionAuthority=NONE_RECORD_ONLY`, and
   `externalActionAuthorization=NONE` on decision and plan.

The L09-001 resume condition was therefore mechanically satisfied. This
receipt records a distinct blocker at the next required accepted-owner seam.

## Exact new blocker

Accepted L07 constructs each fixture's owner evidence by calling only the
legacy `preflightInstrumentSizing(registry, request)` entrypoint. Accepted L04
intentionally keeps that entrypoint fail-closed for Spot TIF; only the additive
`bindSpotOrderTifCapability(registry, request)` path can bind the exact L08.1
Spot `LIMIT GTC` capability.

L07 has no input that carries that binding. Its exact preflight gate requires
`staticState=PASS` with no reasons and maps the accepted Spot owner result to
`PREFLIGHT_NOT_EXACT` at venue arrival. The paired compiled probe produced:

```json
{"product":"SPOT","venueStatus":"BLOCKED","localTruth":"OBSERVED","filledQuantity":"0","blockedReasonCodes":["PREFLIGHT_NOT_EXACT"],"authority":["SYNTHETIC_FIXTURE","NONE_RECORD_ONLY","NONE"]}
{"product":"USD_M_PERPETUAL","venueStatus":"FILLED","localTruth":"ACKNOWLEDGED","filledQuantity":"0.03","blockedReasonCodes":[],"authority":["SYNTHETIC_FIXTURE","NONE_RECORD_ONLY","NONE"]}
```

The paired L04 entrypoint probe independently produced:

```json
{"legacy":{"staticState":"BLOCKED","reasonCodes":["TIME_IN_FORCE_NOT_ADVERTISED"]},"bridge":{"ok":true,"state":"PASS","timeInForce":"GTC","sendEligible":false,"authority":["NONE_RECORD_ONLY","NONE"]}}
```

The USD-M control proves that the deterministic twin is operational. The Spot
failure proves that the accepted L08.1 binding stops before L07; it is not an
L09 lifecycle state that can be repaired inside the exclusive adapter path.

## Why implementation stopped

The required §17 lifecycle must replay the accepted ordered plan through the
accepted L07 twin. Creating `normalBasis/**` while its first exact leg is
mechanically blocked would either encode a knowingly impossible path or require
one of these prohibited substitutions:

- forge a Spot owner `PASS` result;
- change Spot `LIMIT GTC` to a different product, order type or TIF;
- duplicate or bypass the accepted L07 twin;
- import or recreate Foundation, Capital, strategy, reconciliation or Ledger
  authority inside `liveEdge/**`;
- edit L04, L07, L08.1 or the accumulated purity gate from the L09 shard.

All are rejected by the authority map, exclusive-path law or accepted-owner
chain. No partial source or test implementation was created.

## Current official-source check

Official public sources were rechecked on `2026-07-13`; no Binance endpoint,
account, credential, signed action, test order, socket or private stream was
called.

- Spot order status and `GTC`/`IOC`/`FOK` semantics:
  `https://developers.binance.com/en/docs/products/spot/enums`
- Spot execution reports retain last and cumulative fill quantities:
  `https://developers.binance.com/en/docs/products/spot/user-data-stream`
- Spot timeout and server-error outcomes can remain unknown:
  `https://developers.binance.com/en/docs/products/spot/rest-api`
- USD-M `positionSide` and `reduceOnly` mode rules:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade`

These semantics reinforce the required actual-fill, ambiguity, partial-fill
and one-leg-exposure invariants. They do not create the missing L07 binding
seam.

## Measured verification evidence

- `npm run build -w server`: exit `0`.
- Exact L08.1 Spot bridge proof: `4/4`, exit `0`.
- Full L08/L08.1 execution-policy suite: `49/49`, exit `0`.
- Accepted L07 exchange-twin suite: `69/69`, exit `0`.
- Canonical Foundation execution owner: `132/132`, exit `0`.
- Live-edge security/import-purity proof: `4/4`, exit `0`.
- Compiled L04 paired-entrypoint probe: exit `0`; exact JSON recorded above.
- Compiled L07 paired-product probe: exit `0`; exact JSON recorded above.
- `npm test`: deterministic standard gate `377/377`, exit `0`; only the
  existing Vite chunk-size advisory was observed.
- `git diff --check`: pass before blocker documentation and on the evidence
  commit.

The L09 focused, accumulated liveEdge, protocol and `npm run test:all` gates
were not run as acceptance gates because no permissible L09 implementation can
be created before the shared owner dependency is resolved. Green owner
regressions are not relabeled as L09 acceptance.

## Scope and working-tree proof

- Branch: `l09-normal-basis-20260712`.
- Evidence commit `ad397169` changes only:
  - `live-edge-receipts/DECISIONS/L09-002-L07-SPOT-BINDING-BLOCKER.md`
  - `live-edge-receipts/TASKS/L09_STATE.md`
- This receipt commit adds only this L09 receipt and updates `L09_STATE.md`
  with the evidence commit and receipt path.
- `server/src/liveEdge/adapters/normalBasis/**` remains absent.
- `server/test/liveEdge/normalBasis/**` remains absent.
- No source, test, Foundation, L04, L07, L08.1, shared barrel, Ledger, package,
  route, service, UI, reverse-Basis or Volume path changed.
- The two untracked owner directives remain preserved unchanged.

## Explicit non-claims

- No L09 lifecycle, strategy, policy, ticket, proposal, coordinator, reducer,
  control, journal, store, outbox, Ledger or persistence owner was created.
- No Capital/Risk authority was minted, changed or bypassed, and no recovery
  action was executed.
- No private/account read, signer, credential, signed request, test/live order,
  send/query/cancel, listen key, socket, Margin action or capital change
  occurred.
- No AWS, Cloudflare, Secrets, deployment, process restart or push occurred.
- No withdrawal or transfer capability was added.
- No secret value was inspected, retained, logged or committed.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.

## Exact resume condition

Resume this same L09 task only after the director lands and accepts:

1. a shared L07 owner-binding seam that reruns the exact L08.1 Spot capability
   without changing legacy L04 default behavior; and
2. an approved Foundation composition/injection boundary consistent with the
   live-edge purity gate.

Rebase this branch onto that exact cut. First prove the exact Spot
`BUY LIMIT GTC` L07 fixture no longer returns `PREFLIGHT_NOT_EXACT`, then
reprove the non-sendable ordered L08.1 plan and resume only inside:

- `server/src/liveEdge/adapters/normalBasis/**`
- `server/test/liveEdge/normalBasis/**`

Until then L09 remains `BLOCKED`, not `PARTIAL`, `LANE_READY` or `ACCEPTED`.
