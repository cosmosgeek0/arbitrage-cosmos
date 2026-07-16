# Q15 shard — durable state

State generation: `3`

Updated: 2026-07-13

Status: `ACCEPTED`

## Frozen shard identity

- Worktree: `/Users/cosmosgeek/Desktop/q15-registry`
- Branch: `q15-registry-20260712`
- Shard base: `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- Protocol ancestor: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Director order: D-LAUNCH-5, verified at `72dee36` through
  `QL_PARALLEL_DAG.md`.
- Owner directive copies remain untracked and byte-pinned; no push is permitted.

## Accepted implementation

- C15: `6b18928c282f19128a033ed33910754cbdc2cbe0`
- C15 tree: `04f78c5100f12979311cfb0c0608c2baab753863`
- Exact C15 parent: `f756f3b582f24857811e6ec4c0d08a3a61026b74`
- C15 has 24 changed paths, all inside the Q15 exclusive write set.
- Generated experiment evidence is pinned to C15 and all final gates are recorded
  in `quant/RECEIPTS/Q15.md`.
- Receipt/evidence R15: `e1e1238b4af4be01b875a29667b76f1b8a81e565`
- R15 tree: `693fc2b4f2c9a7f125258afc401fc6efb1bd9fb4`
- R15 exact parent: C15
- Immutable receipt SHA-256:
  `baa20476a37867bb5d6fcef062918d50f80c5058d1be4a63ba6163ace24f346a`
- Acceptance commit A15 is the commit that first contains
  `quant/RECEIPTS/Q15_ACCEPTANCE.md` and this generation-3 state; intentionally
  non-self-referential.

## Measured final candidate

- Focused Q15 `59 passed`; unit + Q15 `1207 passed`; dependencies `340 passed`.
- Full quant `2241 passed`, `4` Q08 scope skips, 98.07% coverage.
- Ruff/format and strict mypy clean over 265 files; registry verify exit 0;
  protocol `22/22`; Q00 scope `6/6`; `npm test` exit 0 (377/377 checks).
- Independent adversarial audit found no remaining implementation blocker after all
  reproduced exploits were corrected and regression-tested.

## Exact next step

None for this shard. Q15 is `ACCEPTED`; stop per D-LAUNCH-5. The director alone may
merge the accepted commit. Never merge or push from this shard, and never rewrite
the immutable Q15 receipts.
