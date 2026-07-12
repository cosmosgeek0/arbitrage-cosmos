# Q15 shard — durable state

State generation: `2`

Updated: 2026-07-13

Status: `READY_FOR_INDEPENDENT_COMMIT_VERIFICATION`

## Frozen shard identity

- Worktree: `/Users/cosmosgeek/Desktop/q15-registry`
- Branch: `q15-registry-20260712`
- Shard base: `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- Protocol ancestor: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Director order: D-LAUNCH-5, verified at `72dee36` through
  `QL_PARALLEL_DAG.md`.
- Owner directive copies remain untracked and byte-pinned; no push is permitted.

## Accepted implementation candidate

- C15: `6b18928c282f19128a033ed33910754cbdc2cbe0`
- C15 tree: `04f78c5100f12979311cfb0c0608c2baab753863`
- Exact C15 parent: `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- C15 has 24 changed paths, all inside the Q15 exclusive write set.
- Generated experiment evidence is pinned to C15 and all final gates are recorded
  in `quant/RECEIPTS/Q15.md`.

## Measured final candidate

- Focused Q15 `59 passed`; unit + Q15 `1207 passed`; dependencies `340 passed`.
- Full quant `2241 passed`, `4` Q08 scope skips, 98.07% coverage.
- Ruff/format and strict mypy clean over 265 files; registry verify exit 0;
  protocol `22/22`; Q00 scope `6/6`; `npm test` exit 0 (377/377 checks).
- Independent adversarial audit found no remaining implementation blocker after all
  reproduced exploits were corrected and regression-tested.

## Exact next step

Commit this C15-pinned immutable receipt/state, independently verify its exact
parent, scope, blobs, generated hashes and gates, then write
`quant/RECEIPTS/Q15_ACCEPTANCE.md`, advance this state to generation 3 `ACCEPTED`,
commit the acceptance record and stop. Never merge or push from this shard.
