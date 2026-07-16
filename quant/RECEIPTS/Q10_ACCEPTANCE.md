# Q10 acceptance receipt — transparent and boosted model battery

Acceptance state: `ACCEPTED` (D-LAUNCH-2 self-accepted evidenced loop; director audit due at LANE_READY)

Accepted on: 2026-07-12

## Exact accepted commit

- Implementation commit C10: `f25648ace7f7adf8cd9c59ba459d1099ffdc7638`
- C10 tree: `b89ef4eabe6d729a83009982c5b705266559b4cf`
- C10 parent (activation): `79f6621985a5f38ae254ea45109a8e3f01f79e4d`
- Activation parent (generation-25 merge-record state): `cc75e9bbde18f536297ea5f166c08ac4d266dcca`
- Lane base at resume (director Q09 merge): `8a5dd092b73ba0069a67f3a3bead0561f3269370`
- Immutable implementation receipt: `quant/RECEIPTS/Q10.md`, SHA-256
  `d9261dbdc5cb141e529b2978182563acd4754a2c0003b43236f23a58d7c89f37`, first contained in C10.

## Independent exact-commit verification (all passed)

1. Exact parent and protocol ancestry: C10's sole parent is the activation commit and
   HEAD descends from protocol commit `73e1a1ff7daa48df8dac45713fc5f106842edafc`.
2. Scope: exactly 36 changed paths, every one under `quant/**`, all regular `100644`
   modes; `git diff-tree --check` clean; the frozen protocol/input paths are untouched
   (scope gate re-verified at commit time: `Q_SCOPE_OK … staged_paths=36`).
3. Accepted-work emptiness: no accepted receipt, task, decision or accepted-package
   source path is touched; the single declared amendment outside `q10` files is the
   `tests/contract/test_q02_golden.py` live-lock pin (implementation receipt, finding 2),
   with the Q02 fixture itself byte-untouched.
4. Task identity: `quant/TASKS/Q10.md` blob is identical at activation and C10
   (SHA-256 `709e611ee4a8f6a62a13d659e90a0bed36375d7eb78af347a523ee0bfd2c20df`).
5. Blob hashes at C10 equal the implementation receipt's recorded digests for the
   golden fixture, campaign JSON/Markdown, dependency evidence, campaign script,
   decision/design records and `uv.lock` (`716a9d02…859d29`, 68 packages).

## Archive-derived clean re-verification (all passed)

- `git archive` of C10 (full repository) SHA-256
  `70b8dae90b8fc918e7ff304ddc751fbe8615814599ede825c9aa0b4f270328a4`, extracted to a
  disposable root outside the worktree.
- Fresh `uv sync --all-extras --frozen` environment from the committed lock
  (CPython 3.13.14, 68 packages; `uv lock --check` exit 0 in the archive tree).
- Documented host prerequisite exercised for real: the rebuild resolved uv's default
  managed-Python root, whose `lib/` lacked `libomp.dylib`, and the first collection
  failed LOUDLY with XGBoost dlopen errors — extras-installed-but-broken environments
  error rather than silently skip (the honest `importorskip` skip fires only when the
  `models` extra is genuinely absent). The sklearn-vendored runtime was linked into
  that root (`~/.local/share/uv/python/cpython-3.13.14-macos-aarch64-none/lib/`), as
  `DECISIONS/Q10-001` prescribes for every environment rebuild, and verification
  proceeded.
- Ruff lint and format-check: exit 0. Strict mypy: exit 0, 205 files.
- Full Q suite under hostile environment (`TZ=Pacific/Kiritimati`,
  `PYTHONHASHSEED=987654`, foreign CWD): `1941 passed, 4 skipped` (the four honest
  Q08 shard scope skips); total `quant_edge` coverage `100.00%` statements and
  branches (13,819 / 4,642). The suite internally regenerates the campaign artifacts
  byte-identically against the committed goldens and re-runs the campaign script in
  hostile subprocesses.

## Acceptance conditions (task §Acceptance, all measured)

- All trials logged: four bounded studies, `12/12` logged trials each, all `COMPLETE`,
  exact objectives, fail-closed short-log and best-index laws proven by tests.
- Complex challengers may honestly lose: on the frozen seed the regression report's
  winner is `ols:v1` and both boosted challengers' losses are preserved verbatim in the
  fixture and named in the campaign's `honestChallengerLosses`.
- Calibrated linear baselines exist for every target kind; classifier probabilities are
  isotonic-calibrated on the validation slice only with ECE measured before and after;
  controls remain `UNCALIBRATED_SCORE`; non-probability outputs are labeled so.
- Monotone constraints only where defensible: derived exclusively from declared planted
  directions, fail-closed on contradiction, property-tested on classifier/regressor/
  ranker; the measured multi-quantile violation is recorded and that challenger runs
  unconstrained.
- The Q14 validation factory is `WAITING_Q14` (five disposition records), never
  reimplemented; the internal split is typed non-authoritative everywhere.
- Everything is honest `SYNTHETIC` machinery evidence; no edge claim, no probability
  semantics without calibration evidence, no model authority, no persistence, no
  network/env/clock access in library code.

Q10 is `ACCEPTED`. The spine PARKS per the director board
`0f2bb884daf5b67981ea04f38298d89c1a980de7`: Q11 is shard-owned at
`8a5dd092…`, Q14 is shard-owned and `WORKING`, and Q12+ resume only on director order
after the Q11/Q14 merges.
