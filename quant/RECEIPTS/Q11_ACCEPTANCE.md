# Q11 acceptance receipt — survival and competing-risk models (shard)

Phase status: `ACCEPTED` (single-phase shard acceptance under standing order
D-LAUNCH-2 continuous self-accepted execution; director audit at LANE_READY).

Date: 2026-07-12

Shard worktree/branch: `~/Desktop/q11-survival` / `q11-survival-20260712` under
director order `D-LAUNCH-5` (Q11 cut `0f2bb884daf5b67981ea04f38298d89c1a980de7`).

## Accepted implementation commit

- Implementation commit C-Q11: `a6563a73decbefd20403cedf6f16eb60082550c4`
- Exact parent (Q lane with Q07+Q08+Q09 merged): `8a5dd092b73ba0069a67f3a3bead0561f3269370`
- Tree: `b398cfb074dbeac88aef1a6deeee3f29c91e16c2`
- Immutable implementation receipt `quant/RECEIPTS/Q11.md` SHA-256
  `4b5e613bc5cfce3e519ccdadd0b426fa997a21fcbe494307c0df589e4fb199c5`, first contained
  in C-Q11 and never rewritten after it.

## Independent exact-commit verification (all passed)

- Exact parent equals the Q09-merged lane head `8a5dd09`; HEAD descends from protocol
  commit `73e1a1f`.
- Changed paths: exactly 23, every one inside the D-LAUNCH-5 Q11 shard write scope
  (`quant/src/quant_edge/survival/**`, `quant/tests/q11/**`, `quant/generated/q11/**`,
  `quant/TASKS|RECEIPTS|DECISIONS/Q11*`); all regular `100644` modes;
  `git diff-tree --check` clean.
- Frozen protocol/input paths byte-identical to the protocol commit
  (`EDGE_PROTOCOL_V1.md`, `packages/edge-protocol*`, `quant/DIRECTIVE_INPUTS.lock`).
- Committed blob SHA-256s equal the values recorded inside the immutable receipt for
  the task, decision, golden fixture and both campaign artifacts.
- Scope gate `Q_EXPECTED_BRANCH=q11-survival-20260712 bash quant/scripts/check-scope.sh`:
  `Q_SCOPE_OK`, 23 staged paths at C-Q11 staging.

## Archive-derived verification (all passed)

From a clean `git archive` of C-Q11 (extraction digest
`a0735993b0c480454d1cc1ce3883d7aee9b6305654c423a43bdda4612c4de5b0`):

- Clean locked install (`uv sync --locked --all-groups`, CPython `3.13.14`,
  `uv 0.11.28`, 51 packages): exit 0; Ruff lint/format: exit 0 (198 files); strict
  mypy (`uv run mypy .`): exit 0, 198 source files.
- Full accumulated Q suite: `1972 passed, 4 skipped` (the four skips are the
  pre-existing Q08 in-worktree scope tests); total `quant_edge` coverage `100.00%`
  statements and branches (14,020 statements / 4,790 branches).
- Campaign regeneration inside the archive is byte-identical to all three committed
  `quant/generated/q11/` artifacts.

## Measured acceptance conditions (from the immutable receipt, re-verified)

- Survival curves and time-dependent metrics pass deterministic fixtures: the
  Freireich KM golden matches hand-computed exact mantissas and an independent
  product-limit reference; the competing-risk golden matches hand-computed
  Aalen-Johansen incidences with terminal conservation (0 + 7/18 + 11/18 = 1); the
  IPCW Brier, IBS, concordance and calibration goldens are asserted at exact
  quantized values, and a 300-trial randomized probe against an independent
  Graf-style reference found 0 mismatches.
- Censored subjects remain censored end-to-end; the quality gate excludes and counts
  every gap-class subject (property-tested; never a normal negative).
- The hazard model never fabricates a hazard: thin bins and unseen strata yield
  explicit `UNKNOWN` (golden and unit-tested); life-table/KM equivalence holds
  exactly on aligned grids (property-tested).
- Probability outputs ship only next to calibration evidence: the oracle passes the
  declared budget, the deliberately miscalibrated predictor fails with all three
  measured reasons, and the seeded held-out model measurements (recovery gap
  0.032099, model IBS 0.146188 vs marginal 0.207712, concordance 0.767056, ECE
  0.028710 at grid end) carry an honest `PASS` verdict against the declared budget.
- All evidence is honestly `SYNTHETIC`; determinism proven across processes with
  different CWD/TZ/hash seed; frozen protocol `22/22`; Q00 scope guard `6/6`;
  `npm test` exit 0 unchanged.

## Durable state note (shard-scoped)

`quant/QUANT_EDGE_BUILD_STATE.md` is spine-owned and intentionally untouched; this
acceptance receipt is the shard's durable state. Q11 is `ACCEPTED` at C-Q11
`a6563a73decbefd20403cedf6f16eb60082550c4`; the acceptance commit A-Q11 is the commit
that first contains this file. Next mechanical step per the frozen order: the director
serially merges accepted Q shards onto the Q lane branch with the full Q suite after
each; nothing further is executed on this shard, and the shard never pushes.
