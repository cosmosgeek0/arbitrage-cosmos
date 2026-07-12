# Q14 shard — durable state

State generation: `1`

Updated: 2026-07-12

Status: `WORKING`

## Frozen shard identity

- Worktree: `/Users/cosmosgeek/Desktop/q14-validation-infra`
- Branch: `q14-validation-infra-20260712`
- Shard base (accepted Q06 A6): `24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd`
- Canonical base: `7010499170e24b31c9c0be2c9d73a536e680c6fe`
- Protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- Director order: `D-LAUNCH-5` at `d0e34f0310ebb5ad67b9c7f1ed4785a49a4bb0f8`
  (`QL_PARALLEL_DAG.md`: Q14 validation-infra READY on this worktree/branch/base).
- Q directive blob `eebe7b0c751c065e06d0bf817b86c144541adff3`;
  SHA-256 `198f131d4b04c1edab728b85ea6a5e5c5f7f80875866e407a3c93a24aafa5ab4`
  (byte-identical untracked owner copy preserved in the shard root, never staged).
- Frozen input lock `quant/DIRECTIVE_INPUTS.lock` untouched
  (SHA-256 `410010ef635a5e44b205e56c6b38f2d06e5b8e72312f5d63edcb24a5086355e1`).

## Phase position

- Current phase: `Q14` (validation and falsification factory), activated by the
  commit that first contains this state file and `quant/TASKS/Q14.md`.
- Prior phases Q00–Q06: `ACCEPTED` on the spine at `24ccf58`; not re-run, not edited.
- Q07 is spine-owned (D-LAUNCH-5); Q08/Q09 belong to sibling shards. This shard
  reads none of their work and writes only the Q14 exclusive paths.

## Ownership and safety

- Exclusive write paths: `quant/src/quant_edge/validation/**`, `quant/tests/q14/**`,
  `quant/generated/q14/**`, `quant/TASKS/Q14*`, `quant/RECEIPTS/Q14*`,
  `quant/DECISIONS/Q14*`.
- `quant/QUANT_EDGE_BUILD_STATE.md` is spine-owned and read-only for this shard.
- Read-only: root docs/directives, frozen protocol files, all existing source/tests,
  Main, lane worktrees and other shards. Never checkout/commit/merge/push
  `current-main` or lane branches; never push.
- No secrets/env reads, no network in tests, injected clocks only, unknowns stay
  `UNKNOWN`, advisory-only; no money/order/capital/risk authority.

## Environment (measured 2026-07-12)

- `npm ci` exit 0 (node_modules restored in this worktree).
- `uv python install 3.13.14` + `uv sync --locked --all-groups` exit 0;
  `uv lock --check` exit 0 (51 packages).
- Baseline quant suite at `24ccf58`: `1372 passed` (PYTHONHASHSEED=0,
  hypothesis seed 20260712).

## Exact next step

Implement the Q14 task brief (`quant/TASKS/Q14.md`, unchanged from this activation)
through the full evidenced loop: implementation → focused tests → family + quant
unit suites → adversarial review → corrections → implementation commit with the
immutable `quant/RECEIPTS/Q14.md` → independent exact-commit verification →
`quant/RECEIPTS/Q14_ACCEPTANCE.md` + state advance in an acceptance commit.
