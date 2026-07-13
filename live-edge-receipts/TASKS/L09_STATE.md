# L09 state — normal Basis lifecycle shard

Generation: `2`

Status: `BLOCKED_SHARED_OWNER_DEPENDENCY`

## Git and accepted inputs

- Worktree: `/Users/cosmosgeek/Desktop/l09-normal-basis`
- Branch: `l09-normal-basis-20260712`
- Director re-base merge / current phase base:
  `219b4d02a02aec60e8d093079ad502d2108b9ae4`
- Base tree: `d8f93665d8fc4061a7c8b5ab6918cd811778fa10`
- Re-base parents:
  - prior immutable L09 blocker: `e315ef5e9599c7d0a1da0958bacae25f147276a9`
  - accepted L08.1 state: `f79247a759720555064754d0e6fd72573e189f32`
- Accepted L08.1 receipt cut:
  `ada6e344b6707638ec6c44e43534f45ab3babfec`
- Accepted L08.1 implementation:
  `2754d16e9bf59bbe6965ae83d8283592d2e48195`
- New L09 blocker evidence commit:
  `ad397169ec2ccc554548bfe253678fd1c33861e3`
- New L09 blocker evidence tree:
  `80e558836d8875da672a110ff323a6f8886c4bf7`
- Immutable blocker receipt:
  `live-edge-receipts/RECEIPTS/L09_BLOCKED_L07_SPOT_BINDING.md`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`

The tracked tree and index were clean at resume. The only untracked inputs are
the preserved owner directives `DIRECTOR_Q_L_TWO_LANE_LAUNCH.md` and
`LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md`.

## Cleared resume condition

After `npm run build -w server`, the exact accepted L08.1 bridge proof passes
`4/4`. Its positive case proves:

- `PLANNED`, `ORDERED`;
- Spot `BUY LIMIT GTC` first;
- USD-M `SELL` second, sourced from `ACTUAL_FILL_OF_LEG` on the Spot leg;
- capability revision and exclusive expiry retained;
- `sendEligible=false`, `actionAuthority=NONE_RECORD_ONLY`, and
  `externalActionAuthorization=NONE` on decision and plan.

The previous L09-001 blocker is cleared. This generation records a new blocker
at the next required owner boundary; it does not reopen or dispute L08.1.

## Exact new blocker

Accepted L07 reruns `preflightInstrumentSizing` for every twin fixture and has
no input for `bindSpotOrderTifCapability`. The exact accepted Spot `LIMIT GTC`
request therefore returns owner `BLOCKED/TIME_IN_FORCE_NOT_ADVERTISED`, and L07
maps it to `BLOCKED/PREFLIGHT_NOT_EXACT` with zero fill. The paired compiled
probe yields:

```json
{"product":"SPOT","venueStatus":"BLOCKED","localTruth":"OBSERVED","filledQuantity":"0","blockedReasonCodes":["PREFLIGHT_NOT_EXACT"]}
{"product":"USD_M_PERPETUAL","venueStatus":"FILLED","localTruth":"ACKNOWLEDGED","filledQuantity":"0.03","blockedReasonCodes":[]}
```

There is no accepted injection seam in L07 that an L09-only adapter can use.
Forging owner state, changing the accepted Spot order mechanics, duplicating
the twin or bypassing L07 would violate the L09 chain and authority map.

The accumulated live-edge purity gate separately rejects direct Foundation,
Capital, engine, reconciliation or Ledger imports from
`server/src/liveEdge/**`. A resumed implementation needs an accepted
composition/injection seam; L09 may not weaken this gate itself.

## Exclusive implementation route

- Source: `server/src/liveEdge/adapters/normalBasis/**`
- Matching tests: `server/test/liveEdge/normalBasis/**`
- Local state/receipts/decisions:
  `live-edge-receipts/TASKS|RECEIPTS|DECISIONS/L09*.md`

Both source and test implementation directories remain absent. No partial
lifecycle, handcrafted policy, forged twin result or duplicate owner was
created.

## Measured verification evidence

- `npm run build -w server`: exit `0`.
- Exact L08.1 Spot bridge proof: `4/4`, exit `0`.
- Full L08/L08.1 execution-policy suite: `49/49`, exit `0`.
- Accepted L07 exchange-twin suite: `69/69`, exit `0`.
- Canonical Foundation execution owner: `132/132`, exit `0`.
- Live-edge security/import-purity proof: `4/4`, exit `0`.
- Compiled L04 paired entrypoint probe:
  legacy `BLOCKED/TIME_IN_FORCE_NOT_ADVERTISED`; bridge `PASS/GTC/NONE`, exit
  `0`.
- Compiled L07 paired-product probe: Spot
  `BLOCKED/PREFLIGHT_NOT_EXACT/0`; USD-M `FILLED/0.03`, exit `0`.
- `npm test`: deterministic standard gate `377/377`, exit `0`; only the
  existing Vite chunk-size advisory was observed.
- `git diff --check`: pass before blocker documentation.

The L09 focused, accumulated liveEdge, protocol and `npm run test:all` gates
were not run as acceptance gates because no permissible L09 implementation can
be created before the shared owner dependency is resolved. Green owner
regressions are not relabeled as L09 acceptance.

## Current posture and non-claims

- L09: `BLOCKED_SHARED_OWNER_DEPENDENCY`
- Implementation: `ABSENT`
- Wiring: `UNWIRED`
- Money authority: `NONE`
- External actions: `NONE`
- Secrets inspected: `NONE`
- Live/test/signed orders or private reads: `NONE`
- Reverse Basis, Margin/liability and Volume work: `NONE`

`LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced. No synthetic policy plan,
ticket state machine, send path, control authority or persistence owner was
invented.

## Exact resume

Resume this same L09 task only after the director:

1. lands and accepts a shared L07 owner-binding seam that reruns the exact
   L08.1 Spot capability for the twin without changing legacy default behavior;
2. resolves an accepted Foundation composition/injection boundary consistent
   with the live-edge purity gate;
3. rebases `l09-normal-basis-20260712` onto that exact accepted cut and provides
   the new SHA.

Then first prove the exact Spot `BUY LIMIT GTC` L07 fixture is no longer
`PREFLIGHT_NOT_EXACT`, reprove the ordered non-sendable L08.1 plan, and resume
only inside the exclusive implementation/test paths above.
