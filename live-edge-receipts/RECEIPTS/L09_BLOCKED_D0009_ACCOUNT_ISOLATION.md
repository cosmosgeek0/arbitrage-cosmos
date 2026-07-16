# L09 blocked receipt — D0009 account-isolation dependency

Receipt date: `2026-07-13`

Lane phase disposition: `BLOCKED_AFTER_BOUNDED_CORRECTION_REVIEW`

Implementation acceptance: `NO`

Integrated acceptance: `NO`

Accepted L09 SHA: `NONE`

Correction base:
`a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`

Director state identity:
`3acd1164671ecb8f19b4649455fabbdc17181a9d`

Decision:
`live-edge-receipts/DECISIONS/L09-006-D0009-ACCOUNT-ISOLATION-DEPENDENCY.md`

## Exact blocker evidence

The canonical normalBasis L05 projection was inspected without any private or
network access. Its relevant fact states are:

| Fact | Read state | Completeness | Usable | Gap |
| --- | --- | --- | --- | --- |
| `USDM_ACCOUNT` | `OK` | `COMPLETE` | `true` | none |
| `USDM_POSITIONS` | `OK` | `COMPLETE` | `true` | none |
| `USDM_OPEN_ORDERS` | `OK` | `COMPLETE` | `true` | none |
| `USDM_ALGO_OPEN_ORDERS` | `UNAVAILABLE` | `UNAVAILABLE` | `false` | `UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS` |

`live-edge-receipts/DECISIONS/D0009-l05-private-truth-policy.md` explicitly
states that standard open orders cannot fill this algo-order gap. The granted
D-LAUNCH-12 paths exclude the L02/L05 owners that must resolve it.

## Owner-file justification ledger

All retained implementation changes are uncommitted. Each changed shared-owner
file maps to a named L09-005 finding; nothing below is an acceptance claim.

| File | Named finding and bounded purpose |
| --- | --- |
| `server/src/foundation/execution/types.ts` | terminal-partial close: additive `CANCELLED` submission outcome |
| `server/src/foundation/execution/coordinator.ts` | terminal-partial close: emit existing partial then terminal-cancel events without a second identity |
| `server/test/foundation/execution/execution.mjs` | partial/rejected/terminal-partial close proof against the canonical Foundation owner |
| `server/src/liveEdge/adapters/exchangeTwin/types.ts` | request-semantic binding plus `REJECTED`/`EXPIRED_IN_MATCH` vocabulary |
| `server/src/liveEdge/adapters/exchangeTwin/ownerEvidence.ts` | rerunnable safe L03 request witness; no query, signer or transport retained |
| `server/src/liveEdge/adapters/exchangeTwin/twin.ts` | bind dispatch semantics and retain venue rejection/terminal-partial truth |
| `server/src/liveEdge/adapters/exchangeTwin/index.ts` | expose only the bounded data-only L03 evidence seam |
| `server/test/liveEdge/exchangeTwin/fixtures.mjs` | additive terminal-status fixture input |
| `server/test/liveEdge/exchangeTwin/lifecycle.test.mjs` | explicit rejected and expired-in-match replay/checkpoint proofs |
| `server/test/liveEdge/exchangeTwin/owner-seams.test.mjs` | coherent reduceOnly forgery rejection through owner replay |
| `server/test/liveEdge/exchangeTwin/purity.test.mjs` | allow only the named pure L03 constructor leaf and retain import tripwires |
| `server/src/liveEdge/adapters/normalBasis/types.ts` | fee, terminal-partial and FAILED agreement evidence fields |
| `server/src/liveEdge/adapters/normalBasis/twinAdapter.ts` | fee projection, request binding, expiry and exact-decimal residual bridge |
| `server/src/liveEdge/adapters/normalBasis/ownerOutcome.ts` | preserve terminal partial as canonical CANCELLED and distinguish venue rejection |
| `server/src/liveEdge/adapters/normalBasis/evidence.ts` | fee-adjusted agreement, FAILED outcome and close working-remainder truth |
| `server/test/liveEdge/normalBasis/fixtures.mjs` | safe request witness, fee and terminal status plumbing |
| `server/test/liveEdge/normalBasis/chain.test.mjs` | expiry and request-semantic hostile substitutions |
| `server/test/liveEdge/normalBasis/guards.test.mjs` | direct raw-binary64/exact-decimal seam and fee-summary tamper proofs |
| `server/test/liveEdge/normalBasis/lifecycle.test.mjs` | fee, FAILED, close outcome and cold-restart matrix proofs |

The incomplete standard-only account predicate, flat L05 fixture rewrite and
related tests were discarded before this receipt.

## Measured checks before the blocker stop

| Check | Result |
| --- | --- |
| server build | exit `0` |
| focused Normal Basis | `32/32`, exit `0` |
| focused Exchange Twin | `80/80`, exit `0` |
| focused Execution Policy | `49/49`, exit `0` |
| focused Foundation execution | `178/178`, exit `0` |
| exact L03 coherent-forgery hostile proof | pass |
| exact `0.1 - 0.04` raw-to-`0.06` seam proof | pass |
| frozen protocol | `22/22`, exit `0` |
| `git diff --check` | pass |
| frozen protocol diff | empty |

The accumulated LiveEdge suite, full Foundation battery, `npm test`, full
repository suite and post-correction System Integration isolation were not run
after the final correction because L09 had already reached the precise D0009
shared-owner blocker. They are not represented as green.

## Frozen inputs and Git posture

- Branch: `l09-normal-basis-20260712`.
- HEAD before this receipt:
  `ae6d9e8f3ad01556eb368a620c2fde781d85249e`.
- Protected untracked launch SHA-256:
  `26b1d5ce118982b4b3ba64b44b7fb3e88b0b7ded26a818a775a65bffaa0f2c06`.
- Protected untracked L directive SHA-256:
  `40de1feb6678d8741bd38f7538b2c6f25304c0f64195a596961fdb2539a3b037`.
- Both protected files remain untracked and unstaged.
- No implementation source or test path is staged or committed.
- No merge or push occurred.

## Stop disposition

L09 stops `BLOCKED_SHARED_L02_L05_OWNER_DEPENDENCY`. Resume only from the
exact ruling described by L09-006. The uncommitted surviving correction is a
reviewed working tree, not an accepted phase or integration candidate.
