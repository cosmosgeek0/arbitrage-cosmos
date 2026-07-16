# Q10-001 — Model battery: activate the deferred adoptions, keep every number exact

Status: accepted (Q10 implementation).

## Decision

1. **Activate exactly the Q01 deferred-`ADOPT` framework cards** as the phase-scoped
   optional extra `models`: `scikit-learn==1.9.0` (BSD-3-Clause), `xgboost==3.3.0`
   (Apache-2.0), `optuna==4.9.0` (MIT). The transitive closure is pinned in `uv.lock`
   (51 → 68 entries under the frozen `exclude-newer`). LightGBM and CatBoost stay
   `REFERENCE_ONLY` (no dependency without an ablation-earned promotion),
   scikit-survival stays `REJECT` (license/compiled-surface), MLflow and deep
   frameworks stay deferred. Fresh pip-audit/pip-licenses evidence over the changed
   environment lives in `quant/generated/q10/` (64 dependencies, 0 indexed
   vulnerabilities, 0 unknown licenses on 2026-07-12; scanner results are
   time-varying). Notable license facts: tqdm is `MPL-2.0 AND MIT` (file-level
   copyleft, unmodified use only), numpy bundles `BSD-3-Clause AND 0BSD AND MIT AND
   Zlib AND CC0-1.0`.
2. **Host toolchain fact:** XGBoost's macOS wheel links OpenMP at
   `@rpath/libomp.dylib` and ships none. Rather than install a system package, the
   scikit-learn wheel's vendored `libomp.dylib` is symlinked into the Q01-managed
   toolchain's `lib/` directory (one of the two loader probe paths). Single shared
   runtime file, reversible, no system mutation. Any environment rebuild must
   re-create this link; recorded in the receipt as a provisioning prerequisite.
3. **Binary64 dies at one boundary.** Engines (sklearn/xgboost) compute in floats
   inside `quant_edge.models.engine` only. `quantize_binary64` performs the single
   documented half-even quantization per public value via `Fraction.from_float`
   (lossless) onto the Q06 fixed-point scale. All public metrics are exact rationals
   of quantized predictions except `log_loss`, which is honestly labeled `BINARY64`
   with a one-grid-unit clip law.
4. **Bounded, fully-logged, exactly-replayable studies.** Optuna runs sequentially
   with seeded TPE over finite exact spaces (integer ranges, categorical grids of
   integers/decimal strings). No continuous distribution is allowed, so logged
   parameters are exact and refits are replayable from records. Every trial is logged
   with its exact objective mantissa; `StudyRecordV1` fails closed on a short log or a
   best-index law violation. `mypy` overrides exist only for untyped `sklearn.*` and
   `threadpoolctl`.
5. **Validation is not reimplemented.** The battery's internal chronological split is
   typed `BATTERY_INTERNAL_NON_AUTHORITATIVE`; the Q14 factory pieces
   (purged/embargoed walk-forward, untouched holdout, negative-control factory,
   cost/latency stress, PBO/DSR) are recorded `WAITING_Q14` in the machine-checkable
   disposition table because no frozen Q14 interface exists at this base.

## Why

The Q01 framework law already made the selection (XGBoost over LightGBM/CatBoost;
Optuna as the bounded-search adapter; scikit-learn for transparent baselines), so Q10
activates decisions instead of relitigating them. The single-quantization law keeps
the lane's no-floats contract intact while letting real ML frameworks do real
fitting. Exact-parameter search spaces turn "all trials logged" from a log file into
a replayable contract. The synthetic planted-structure datasets are designed so the
acceptance sentence is measurable: the boosted challenger wins where nonlinearity is
planted and honestly loses where noise dominates — and the loss is frozen in the
golden fixture rather than smoothed away.

## Consequences

- The `models` extra is required for engine/studies/battery tests; those test modules
  skip honestly (visible reason) when it is absent, and the canonical verification
  command installs `--all-extras`.
- Determinism claims are host-scoped (Apple M4 Max, single-threaded) as everywhere in
  this lane; cross-platform bit-equality of sklearn/xgboost is not claimed.
- Nothing in Q10 carries probability semantics without calibration evidence (Q-D):
  calibrated classifier outputs are `CALIBRATED` with measured before/after ECE;
  everything else is `UNCALIBRATED_SCORE` or `NOT_PROBABILITY`.
