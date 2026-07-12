# Q09 acceptance receipt — change, regime, anomaly and analog layer (shard)

Phase status: `ACCEPTED` (single-phase shard acceptance under standing order
D-LAUNCH-2 continuous self-accepted execution; director audit at LANE_READY).

Date: 2026-07-12

Shard worktree/branch: `~/Desktop/q09-regime` / `q09-regime-20260712` under director
order `D-LAUNCH-5` (`d0e34f0310ebb5ad67b9c7f1ed4785a49a4bb0f8`).

## Accepted implementation commit

- Implementation commit C-Q09: `8c5bf3486e3bab28fd8c1865cc607765b8877af3`
- Exact parent (accepted Q06 A6): `24ccf5880cbce8b1ee81ddd7d33f7c9c7271aacd`
- Tree: `b5704f8703ba3ef4501424d6432a55d008564fa2`
- Immutable implementation receipt `quant/RECEIPTS/Q09.md` SHA-256
  `71a437f3545e2ec7f808850a42889352b775a9f4c2b49e1385748d0c899d20c3`, first contained
  in C-Q09 and never rewritten after it.

## Independent exact-commit verification (all passed)

- Exact parent equals A6; HEAD descends from protocol commit `73e1a1f`.
- Changed paths: exactly 30, every one inside the D-LAUNCH-5 shard write scope
  (`quant/src/quant_edge/regime/**`, `quant/tests/q09/**`, `quant/generated/q09/**`,
  `quant/TASKS|RECEIPTS|DECISIONS/Q09*`); all regular `100644` modes;
  `git diff-tree --check` clean.
- Frozen protocol/input paths byte-identical to the protocol commit
  (`EDGE_PROTOCOL_V1.md`, `packages/edge-protocol*`, `quant/DIRECTIVE_INPUTS.lock`).
- Committed blob SHA-256s equal the values recorded inside the immutable receipt for
  the task, decision, golden fixture and both campaign artifacts.
- Scope gate `Q_EXPECTED_BRANCH=q09-regime-20260712 bash quant/scripts/check-scope.sh`:
  `Q_SCOPE_OK`, 30 staged paths at C-Q09 staging.

## Archive-derived verification (all passed)

From a clean `git archive` of C-Q09 (extraction digest
`b5312555a01e263a9698e37235c4be1fb670dbb0c7dbbd95e84819f3f1894fc5`):

- Clean locked install (`uv sync --locked --all-groups`, CPython `3.13.14`,
  `uv 0.11.28`, 51 packages): exit 0; Ruff lint/format: exit 0; strict mypy
  (`uv run mypy .`): exit 0, 136 source files.
- Full accumulated Q suite: `1565 passed`; total `quant_edge` coverage `100.00%`
  statements and branches (9,830 statements / 3,338 branches).
- Campaign regeneration inside the archive is byte-identical to all three committed
  `quant/generated/q09/` artifacts.

## Measured acceptance conditions (from the immutable receipt, re-verified)

- False alarms and detection delay are measured for CUSUM, Page-Hinkley and BOCPD:
  golden 2/2 detections per detector with zero false alarms; seeded 33/33 detections
  per detector with 0 false alarms over 3,975 in-control bars and measured delay
  sums 6/22/66; all recorded in hash-bound artifacts and asserted by tests.
- PELT is exactly optimal for its declared quantized objective (brute-force parity
  property) and recovers the golden boundaries (80, 160) exactly.
- OOD/disorder behavior is measured on injected outliers (golden 3/3 hits, zero false
  flags; seeded aggregate hit ratio 1/1, false-flag ratio 0) and degrades to
  `UNKNOWN` on ineligible input.
- Earlier-only, non-overlapping, non-same-event law holds for every Matrix Profile
  neighbor and analog retrieval (property-tested); exclusions are measured per reason
  (profile totals 46,992/7,140/792/0; analog totals include COHORT 96, FUTURE 108,
  SAME_EVENT 36) with an exact pair-conservation law.
- Soft-regime probabilities are exactly normalized fixed-point distributions with the
  declared floor; BOCPD posterior matches an exact-Fraction reference within 1 ulp.
- All evidence is honestly `SYNTHETIC`; determinism proven across processes with
  different CWD/TZ/hash seed; frozen protocol `22/22`; Q00 scope guard `6/6`;
  `npm test` exit 0 unchanged.

## Durable state note (shard-scoped)

`quant/QUANT_EDGE_BUILD_STATE.md` is spine-owned and intentionally untouched; this
acceptance receipt is the shard's durable state. Q09 is `ACCEPTED` at C-Q09
`8c5bf3486e3bab28fd8c1865cc607765b8877af3`; the acceptance commit A-Q09 is the commit
that first contains this file. Next mechanical step per the frozen order: the director
serially merges accepted Q shards (Q07 -> Q08 -> Q09 -> Q14) onto the Q lane branch
with the full Q suite after each; nothing further is executed on this shard, and the
shard never pushes.
