# L09 immutable blocked-acceptance receipt

Receipt status: `BLOCKED_SHARED_OWNER_DEPENDENCY`

Lane phase disposition: `BLOCKED_AFTER_IMPLEMENTATION_AND_FULL_GATE`

Integrated acceptance: `NO`

Accepted L09 SHA: `NONE`

Seal rule: this receipt becomes immutable in its containing commit. The
subsequent mutable L09 state records that exact receipt cut.

## Frozen chain

- L09 phase base/direct implementation parent:
  `ef931cfdcce8db012e520fb0e42bac52a9c113a7`
- Phase-base tree:
  `03d500438af11e65937c3d81c7950f05a57f82c4`
- Accepted L08.2 immutable receipt cut:
  `1dd33b13288f051f1d7835baea156ebfe0ea8e1e`
- L09 implementation commit:
  `36d5e2a39b013b51d2b932f902ec272c9217c23c`
- L09 implementation tree:
  `1e30868d8b19aed63735150845cdf0ee2eba2b8d`
- Frozen protocol SHA:
  `73e1a1ff7daa48df8dac45713fc5f106842edafc`

This receipt becomes immutable only in its containing commit. A commit cannot
include its own SHA; the subsequent mutable L09 state must record this receipt
cut, and a state-only seal must record the blocked-acceptance commit SHA.

## Exact implementation scope

Implementation `36d5e2a` changes exactly 11 paths from the phase base: six
source files under `server/src/liveEdge/adapters/normalBasis/**` and five test
files under `server/test/liveEdge/normalBasis/**`.

- Source sorted-manifest SHA-256:
  `4fc0031e67a6d62f9767cd832a7f6cb8232bec48eb6ba2752b17856f190d3444`
- Test sorted-manifest SHA-256:
  `00a67a884364b68bdae6b76aea2f85161956c4e2ecc21b9fbe1b0f91480c579f`
- Full 11-path sorted-manifest SHA-256:
  `97096e236fb9274e28baf61efdf2b24aa868a71bccc855b79ab689e17fbbeeda`

No Foundation, L04, L06, L07, L08/L08.1/L08.2, protocol, Capital, Ledger,
System Integration, package, route, service, UI or root-state path changed in
the implementation commit.

## Full acceptance gate

The remaining loop ran serially from an unchanged implementation and test
tree. Interrupted task-local documentation remained uncommitted during the
gate and did not alter executable inputs:

- `npm run build -w server`: exit `0`.
- Focused L09 normal-Basis suite: `21/21`, exit `0`, `51.512s`.
- Accepted L07/L08.2 exchange-twin suite: `78/78`, exit `0`.
- Accepted L08 execution-policy suite: `49/49`, exit `0`.
- Canonical Foundation execution owner: `132/132`, exit `0`.
- Accumulated LiveEdge suite: `1,244/1,244`, exit `0`, `205.300s`.
- Frozen protocol conformance: `22/22`, exit `0`.
- `npm test`: deterministic standard battery `377/377`, exit `0`.
- `npm run test:all`: full repository battery `4,468/4,468`, exit `0`;
  deterministic `377`, app gates `72`, Intelligence Foundation `152`,
  Intelligence Runtime `394`, Capital `433`, Foundation `2,860`, System
  Integration `180`.
- Frozen protocol diff: empty.
- `git diff --check`: pass before documentation.

The only diagnostic was the existing Vite chunk-size advisory. No failed or
contended run is represented as green.

## Independent verification disposition

Independent verification identified `ACCEPTANCE_BLOCKERS_PRESENT`. The
automated suite is therefore evidence of deterministic behavior, not proof of
the required canonical authority chain.

The acceptance-blocking findings are frozen in
`live-edge-receipts/DECISIONS/L09-003-INDEPENDENT-VERIFICATION-BLOCKERS.md`:

1. no canonical Foundation opening-partial refresh prevents later remainder
   fills from drifting exposure after the hedge is sized;
2. restart tests retain pre-crash memory and can advance without cold-start
   reconciliation; crash recovery truth can be projected as filled;
3. tests fabricate Capital/Risk inputs and a duplicate reconciliation result,
   while structural state/recovery inputs can satisfy agreement without owner
   checkpoint lineage;
4. L06 request sequence/fingerprint/hash/private/reconciliation bindings are
   incomplete, causing same-product open/close request-ID reuse;
5. conflict-free one-way net position/open-order truth is not proved, gross
   Spot fills ignore base-asset commission, and request-side reduce-only/
   position-side evidence is not bound;
6. expiry, exact residual arithmetic, terminal status, deep immutability and
   close/recovery matrix gaps remain.

The first two require accepted shared Foundation/L07 composition seams outside
L09. Partially patching the local adapter would not make the phase acceptable
and could create a second lifecycle or reconciliation owner. No post-review
source correction was made.

## Current primary-source check

Official Binance sources were rechecked on `2026-07-13` before the acceptance
loop; no exchange endpoint was called:

- The fixed-price Spot LIMIT form used by L09 requires time-in-force, quantity
  and price; pegged LIMIT orders have separate rules:
  `https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade`
- Spot execution reports expose cumulative/last fill, commission amount/asset
  and order-status/expiry evidence:
  `https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md`
- USD-M new-order rules define one-way `positionSide=BOTH` and the hedge-mode
  restriction on `reduceOnly`:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#new-order`

These sources corroborate the acceptance concerns; they do not authorize a
new transport, signer, private reader or lifecycle owner.

## Scope and hard-boundary proof

- Branch: `l09-normal-basis-20260712`.
- The receipt and its L09-003 decision are inside the exact L09 documentation
  allowlist.
- The two untracked owner directives remain preserved unchanged.
- Static and runtime gates found no production network, filesystem,
  environment, timer, random, signer, credential, private-read, persistence or
  money-action seam in the L09 implementation.
- All generated execution artifacts remain `PAPER`, `SYNTHETIC_FIXTURE`,
  `sendEligible=false`, `actionAuthority=NONE_RECORD_ONLY`, and
  `externalActionAuthorization=NONE`.

No private/account read, signed/test/live order, send/query/cancel, listen key,
Margin action, capital mutation, AWS/Cloudflare/Secrets mutation, deployment,
process restart, merge, push, withdrawal or transfer occurred. No secret was
inspected, retained, logged or committed.

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.

## Exact resume condition

Resume L09 only after the director lands and accepts the shared-owner changes
listed in L09-003 and rebases this branch onto that exact cut. Then correct the
L09 adapter/tests within their existing allowlist, rerun every gate above, and
repeat independent verification.

Until then L09 is `BLOCKED`, not `PARTIAL`, `LANE_READY` or `ACCEPTED`.
