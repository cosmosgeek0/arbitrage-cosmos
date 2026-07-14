# Q13 shard — durable state

State generation: `2`

Updated: 2026-07-13

Status: `ACCEPTED`

## Frozen shard identity

- Worktree: `/Users/cosmosgeek/Desktop/q13-deep-gate`
- Branch: `q13-deep-gate-20260712`
- Shard base/parent: `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- Protocol ancestor: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Director order: D-LAUNCH-5, verified from
  `git show fc267a3 -- QL_PARALLEL_DAG.md`.

## Phase position

- Current and only phase: Q13 deep-sequence gate and optional challengers.
- Data sufficiency: `FAIL_DATA_INSUFFICIENT`.
- Implementation: interfaces/fixtures only; simple MLP, DeepLOB-style, and
  TLOB-style records are all `REFERENCE_ONLY` with one exact evidence gap.
- Implementation commit C13: `d28131c7745dda884a8918aa8bf5279004615c05`;
  tree `8f491ff65489e0c4740338f648c43d0aab1b1ebc`; exact parent/base `f756f3b`.
- Immutable implementation receipt SHA-256:
  `b3108cb60401999581174ab6c8ecd8d17219ac8d44d98574673faa34620235be`.
- Independent clean-archive verification passed; archive SHA-256
  `d9d049fb981f6fb46bfed448554531d3a565cfc7300b2b70cd77354c6e38d618`.
- Acceptance commit A13: the commit that first contains
  `quant/RECEIPTS/Q13_ACCEPTANCE.md` and this generation-2 state; intentionally
  non-self-referential. Q13 is `ACCEPTED` at A13.

## Evidence and verification

- Actual atlas: BNBUSDT Spot aggTrades, one day (2017-11-06), 832 rows,
  20 candidates, 143 controls; no historical L2 or real later outcomes.
- Focused Q13: 69 passed; `quant_edge.deep` 100% statement/branch coverage
  (425/114).
- Q13 + unit: 1217 passed.
- Full quant: 2251 passed, 4 expected Q08 shard-scope skips; total 100%
  statement/branch coverage (17,342/5,868).
- Ruff/format and strict mypy: clean over 262 files.
- Protocol 22/22; Q00 scope 6/6; registry verify clean; `npm test` exit 0.
- Q14 attack evidence: `REJECTED_TEMPORAL_LEAK`, then
  `REJECTED_IMPLAUSIBLE_SKILL` under forged lineage; unknown cost 32/32 abstains.

## Ownership and safety

- Exclusive paths: `quant/src/quant_edge/deep/**`, `quant/tests/q13/**`,
  `quant/generated/q13/**`, `quant/TASKS|RECEIPTS|DECISIONS/Q13*`.
- Everything else read-only. `quant/QUANT_EDGE_BUILD_STATE.md` untouched.
- No dependency/protocol/registry/shared change; no `SHARED_CHANGE_REQUEST.md`.
- No model, training, score, benchmark, probability, holdout grant, promotion,
  network, env/secret, private call, order, money, capital, risk, or execution path.

## Exact next step

None for this shard. Q13 is `ACCEPTED`. Report C13 and the resulting A13 SHA to the
director, preserve both immutable receipts, and stop. Never push or merge; later
integration is director-owned.
