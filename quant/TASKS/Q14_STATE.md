# Q14 shard — durable state

State generation: `3`

Updated: 2026-07-12

Status: `ACCEPTED`

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

## Phase position (generation 3)

- Q14 activation commit: `24aeb1a819813feefccfcc0f38002264519487f4`
  (parent `24ccf58`); task SHA-256
  `f3942a301a8c3ded1b9e49e4c9fa5ac993ee484509918c7bf860eb0d28fb7342`, byte-unchanged
  through acceptance.
- Implementation commit C14: `4b016e9c0713a07d80e2243cf687fd825c7a5494`; tree
  `7810eff697f3dddec2717470a988e0ee128465ad`; exact parent the activation commit;
  32 changed paths, all inside the exclusive shard set; immutable
  `quant/RECEIPTS/Q14.md` blob SHA-256
  `b0ef9e862a435a00627060ea3ecb27a38aa60f3ec2679766ec5825adf7059b1f`.
- Acceptance commit A14: the commit that first contains
  `quant/RECEIPTS/Q14_ACCEPTANCE.md` and this generation-3 state; intentionally
  non-self-referential. Q14 is `ACCEPTED` at A14.
- Measured at C14 (re-proven from a clean C14 archive with a different timezone):
  focused Q14 `111 passed`, `quant_edge.validation` 100.00% statements/branches
  (1,636/570); accumulated quant `1483 passed`, total 100.00% (9,465/3,274);
  Ruff/format and strict mypy (138 files) clean; protocol `22/22`; Q00 scope `6/6`;
  `npm test` exit 0; campaign artifacts byte-deterministic across
  process/CWD/TZ/hash-seed changes and equal to committed bytes.
- §20 Q14 acceptance evidence: the deliberately leaked model is rejected on both
  detection paths (temporal audit; implausible-skill bound under falsified lineage),
  honest baselines accepted, 8/8 battery datasets; committed under
  `quant/generated/q14/`.

## Exact next step

None for this shard. Q14 is `ACCEPTED`; the shard stops per D-LAUNCH-5. The director
merges accepted Q shards serially (Q07→Q08→Q09→Q14) onto the Q lane branch with the
full Q suite after each merge. Never rewrite the immutable Q14 receipts; never touch
other shards, lane branches or Main; never push.
