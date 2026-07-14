# Q14 acceptance receipt — validation and falsification factory (shard)

Acceptance status: `ACCEPTED`

Date: 2026-07-12

Acceptance authority: shard lead under standing order D-LAUNCH-2 (continuous
self-accepted execution with full evidenced loops; director audits at LANE_READY)
and director order D-LAUNCH-5 (`d0e34f0310ebb5ad67b9c7f1ed4785a49a4bb0f8`).

## Accepted implementation commit

- C14: `4b016e9c0713a07d80e2243cf687fd825c7a5494`
- Tree: `7810eff697f3dddec2717470a988e0ee128465ad`
- Exact parent (Q14 activation): `24aeb1a819813feefccfcc0f38002264519487f4`
- Activation parent (accepted Q06 A6): `24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd`
- Immutable implementation receipt `quant/RECEIPTS/Q14.md` blob SHA-256
  `b0ef9e862a435a00627060ea3ecb27a38aa60f3ec2679766ec5825adf7059b1f`; not rewritten
  after C14.

## Independent exact-commit verification (all passed)

- Exact parent and ancestry: C14 parent is the activation commit; HEAD descends from
  protocol `73e1a1f` and shard base `24ccf58`.
- Scope: exactly 32 changed paths, every one inside the D-LAUNCH-5 exclusive shard
  set (`quant/src/quant_edge/validation/**`, `quant/tests/q14/**`,
  `quant/generated/q14/**`, `quant/TASKS|RECEIPTS|DECISIONS/Q14*`); no out-of-scope
  path; spine-owned `quant/QUANT_EDGE_BUILD_STATE.md` untouched.
- All modes regular `100644`; `git diff-tree --check` clean.
- Frozen paths (`EDGE_PROTOCOL_V1.md`, `packages/edge-protocol*`,
  `quant/DIRECTIVE_INPUTS.lock`) byte-identical to the protocol commit.
- `quant/TASKS/Q14.md` blob `845e2008c18dc0a5df941708abd9572138ebfa0d` byte-identical
  to activation.
- Committed artifact hashes equal the implementation receipt's claims: decision
  `13ead8b3…468f`, golden fixture `539c95b2…20c9`, campaign JSON `a0522034…9f87`,
  campaign Markdown `b490bef7…5ead`.

## Archive-derived clean verification (all passed)

- `git archive` of C14, SHA-256
  `ff05f309908d54c42faf3c05c127ce9b080a1d26a14bad581040054b2a1099f5`, unpacked to a
  clean directory.
- Clean locked install (`uv sync --locked --all-groups`) exit 0; Ruff lint and
  format-check exit 0; strict mypy over `src tests scripts` exit 0.
- Full quant suite under a different timezone (`TZ=Pacific/Kiritimati`):
  `1483 passed`; total `quant_edge` coverage `100.00%` statements and branches
  (9,465 statements / 3,274 branches).
- Campaign artifacts regenerated in the clean tree byte-identical to the committed
  `quant/generated/q14/` bytes.

## §20 Q14 acceptance condition

"A deliberately leaked model is detected and rejected" — proven and committed:

- true-lineage leak → `REJECTED_TEMPORAL_LEAK`;
- lineage-falsified leak → `REJECTED_IMPLAUSIBLE_SKILL`;
- honest baseline and skilled-but-imperfect challenger → `ACCEPTED_FOR_COMPARISON`;
- 8/8 seeded battery datasets reject on both paths with all honest baselines
  accepted (`quant/generated/q14/validation_campaign.v1.json`).

All Q14 task acceptance conditions (split/holdout law under property campaigns,
typed degeneracy, valid-gated PBO/DSR/BH, ledgered trials, stress-to-abstention,
no floats in public contracts, deterministic replay, safety contracts) are satisfied
per the immutable implementation receipt.

## Boundary restated

Q14 is advisory research machinery only: no data source admitted, no model trained,
no economic claim made, no order/capital/risk authority conveyed. All committed
evidence is `SYNTHETIC`. Integration follows the frozen merge order
(Q07→Q08→Q09→Q14 serially onto the Q lane branch by the director).

## Acceptance commit A14

A14 is the commit that first contains this acceptance receipt and the generation-3
shard state; intentionally non-self-referential. Q14 is `ACCEPTED` at A14.
