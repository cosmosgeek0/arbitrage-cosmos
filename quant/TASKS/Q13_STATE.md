# Q13 shard — durable state

State generation: `1`

Updated: 2026-07-13

Status: `IMPLEMENTATION_COMPLETE_AWAITING_ACCEPTANCE`

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
- Implementation commit C13: the commit that first contains the immutable
  `quant/RECEIPTS/Q13.md`; intentionally non-self-referential in this generation.
- Acceptance requires independent exact-C13 verification plus
  `quant/RECEIPTS/Q13_ACCEPTANCE.md` and state generation 2.

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

Stage only the 24 Q13 paths, run the Q13 allowlist and whitespace gates, create C13,
then independently verify the exact commit from Git/archive. If all evidence remains
green, add the immutable acceptance receipt, advance this state to generation 2
`ACCEPTED`, create A13, record its SHA, and stop. Never push or merge.
