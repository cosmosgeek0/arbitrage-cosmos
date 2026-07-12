# Q01 framework and research adoption matrix

Evidence cutoff/retrieval: 2026-07-12. `ADOPT` permits a bounded implementation at the named seam; it does not mean installed in Q01. `ADAPT` requires a narrower wrapper or changed method. `REFERENCE_ONLY` permits design/ablation study but no dependency or copied authority. `REJECT` forbids initial Q-lane adoption. No card asserts profitable edge.

Card field convention: every framework card explicitly names source/version/license and maintenance/security posture; economic hypothesis plus inputs/outputs; assumptions, failure modes and historical-data requirements; live-latency fit, CPU/memory/GPU cost and owner overlap; decision and implementation seam; and test/ablation/measured result. `UNAVAILABLE` means Q01 performed no economic, latency or resource measurement. A source link without a dedicated security-policy/advisory link is not a claim that no advisory exists.

## Locked toolchain decision

| Item | Exact Q01 decision | Reason |
| --- | --- | --- |
| CPython | `3.13.14`, PSF-2.0, `ADOPT` | Newest 3.13 bugfix release; supported through 2029-10; every immediate native dependency publishes an Apple arm64-compatible wheel. Python 3.14.6 is newer, but Polars metadata still declares only through 3.13. [Release](https://www.python.org/downloads/release/python-31314/), [lifecycle](https://devguide.python.org/versions/). |
| `uv` / `uv-build` | `0.11.28`, MIT OR Apache-2.0, `ADOPT` | Exact tool/backend pin, universal hash lock, managed Python and current ZIP hardening. `required-version` fails closed. [Release](https://github.com/astral-sh/uv/releases/tag/0.11.28), [locking](https://docs.astral.sh/uv/concepts/projects/sync/), [security](https://github.com/astral-sh/uv/security). |
| Dev gates | Ruff `0.15.21`; mypy `2.2.0`; pytest `9.1.1`; pytest-cov `7.1.0`; Hypothesis `6.156.6`; pip-audit `2.10.1`; pip-licenses `5.5.5` | Exact versions are in the dev lock. They supply format/lint, strict typing, tests/coverage, deterministic properties, hashed vulnerability queries and installed-graph license inventory. Primary metadata: [Ruff](https://pypi.org/project/ruff/), [mypy](https://pypi.org/project/mypy/), [pytest](https://pypi.org/project/pytest/), [pytest-cov](https://pypi.org/project/pytest-cov/), [Hypothesis](https://pypi.org/project/hypothesis/), [pip-audit](https://pypi.org/project/pip-audit/), [pip-licenses](https://pypi.org/project/pip-licenses/). |

The host `/usr/bin/python3` is unsupported Python 3.9.6 and is not used. The verified `uv` Apple-arm64 archive SHA-256 is `33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232`.

## Immediate data framework cards

### Polars 1.42.1 — `ADOPT`, locked now

- Source/version/license/maintenance/security: [PyPI 1.42.1](https://pypi.org/project/polars/1.42.1/) and [official repository/security policy](https://github.com/pola-rs/polars/security); MIT; current release and policy observed at cutoff.
- Economic hypothesis and I/O: no economic hypothesis by itself; admitted typed tables in, deterministic feature/quality tables out.
- Assumptions/failures/historical data: explicit schema/order; randomized operations need `polars.set_random_seed`; lazy/streaming row order needs a final sort. Requires only already-admitted local historical tables; it acquires none.
- Live latency/resources/overlap: offline or bounded advisory transforms only, never a money hot path; CPU/Arrow, no GPU required; actual memory/CPU are `UNAVAILABLE` until Q02. It owns neither evidence nor features.
- Decision/seam: `ADOPT`; pure transforms over admitted local data, without cloud/database extras or source acquisition.
- Test/ablation/measured: Q01 exact import/version passed. Q02 golden parity, order/canonicalization, memory and Polars-versus-simple-Python ablation are pending; economic result `UNAVAILABLE`.

### Apache Arrow / PyArrow 25.0.0 — `ADOPT`, locked now

- Source/version/license/maintenance/security: [PyPI 25.0.0](https://pypi.org/project/pyarrow/25.0.0/) and [Apache security](https://arrow.apache.org/security/); Apache-2.0; current release observed. Historical PyArrow/IPC advisories cited there are fixed in earlier releases, but corrupt input still fails closed.
- Economic hypothesis and I/O: no economic hypothesis; typed Arrow/Parquet batches and metadata in/out for canonical interchange and future storage.
- Assumptions/failures/historical data: explicit schema, decimal/timestamp units, metadata and checksum; requires admitted immutable tables/files, never unmanifested market data.
- Live latency/resources/overlap: storage/interchange path, not live inference; native CPU/memory and no GPU required; actual cost `UNAVAILABLE`. It is not the lake/provenance authority by itself.
- Decision/seam: `ADOPT`; immutable manifest-bound Arrow/Parquet adapters in Q02. The release was two days old at intake, so compatibility proof remains mandatory.
- Test/ablation/measured: Q01 exact import/version passed. Q02 byte/golden round trips, corruption, decimal and schema-drift denial are pending; performance/economic result `UNAVAILABLE`.

### DuckDB 1.5.4 — `ADOPT`, locked now

- Source/version/license/maintenance/security: [release 1.5.4](https://duckdb.org/2026/06/17/announcing-duckdb-154), [PyPI](https://pypi.org/project/duckdb/1.5.4/) and [security policy](https://github.com/duckdb/duckdb/security); MIT; current maintained release observed.
- Economic hypothesis and I/O: no economic hypothesis; immutable local Parquet/Arrow plus generated SQL in, bounded analytical rows out.
- Assumptions/failures/historical data: allowlisted local paths/generated SQL only; extension autoload/network/community extensions disabled; canonical tests use explicit order and one thread. Requires admitted local partitions.
- Live latency/resources/overlap: offline/local analytical helper, not live authority; native CPU/memory, no GPU; actual resources `UNAVAILABLE`. It is not a database, ledger or registry owner.
- Decision/seam: `ADOPT`; read-only Q02 query helper with hardened settings.
- Test/ablation/measured: Q01 exact import/version passed. Q02 query parity, path/extension denial and Polars-scan comparison are pending; performance/economic result `UNAVAILABLE`.

### scikit-learn 1.9.0 — `ADOPT`, deferred lock

- Source/version/license/maintenance/security: [PyPI 1.9.0](https://pypi.org/project/scikit-learn/1.9.0/) and [security policy](https://github.com/scikit-learn/scikit-learn/security); BSD-3-Clause; current release observed, not installed.
- Economic hypothesis and I/O: transparent classification/regression/calibration baselines; frozen features/labels in, scores/distributions/metrics out.
- Assumptions/failures/historical data: explicit seed, time-aware folds and train-only transforms; representative calibration evidence is not assumed. Requires later point-in-time features/labels; foreign pickle/joblib is forbidden.
- Live latency/resources/overlap: offline fit and bounded CPU advisory inference only; NumPy/SciPy/joblib/thread cost and latency are `UNAVAILABLE`; no GPU required. It supplies models, never promotion/strategy authority.
- Decision/seam: `ADOPT`, deferred to a Q07/Q10 phase-scoped extra with bounded threads.
- Test/ablation/measured: not installed in Q01; compare dummy/linear/tree/calibration baselines on chronological evidence. All model/economic measurements `UNAVAILABLE`.

## Model, validation and registry framework cards

### XGBoost 3.3.0 — `ADOPT`, deferred

- Source/version/license/maintenance/security: [PyPI 3.3.0](https://pypi.org/project/xgboost/3.3.0/) and [security policy](https://github.com/dmlc/xgboost/security); Apache-2.0; current release observed, not installed.
- Economic hypothesis and I/O: nonlinear boosted challenger for classification, ranking, quantile and AFT targets; frozen feature/label tables in, bounded scores/distributions out.
- Assumptions/failures/historical data: CPU `hist`, one thread and explicit seed; trees can exploit leakage/missingness. Requires point-in-time chronological labels with complete cost targets; platform/GPU paths may differ.
- Live latency/resources/overlap: offline training and bounded CPU shadow/advisory inference; ~98 MB package, actual CPU/memory/latency `UNAVAILABLE`, GPU disabled initially. Replaces rather than duplicates three boosters and owns no model authority.
- Decision/seam: `ADOPT`, deferred Q10 optional extra.
- Test/ablation/measured: compare transparent baselines and later LightGBM/CatBoost with identical folds/costs; not installed, so all model/economic measurements `UNAVAILABLE`.

### LightGBM 4.6.0 — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [PyPI 4.6.0](https://pypi.org/project/lightgbm/4.6.0/) and [security policy](https://github.com/lightgbm-org/LightGBM/security); MIT; active maintenance observed after the 2026 organization move, not installed.
- Economic hypothesis and I/O: alternate compact boosted-tree challenger over the same frozen tabular targets as XGBoost.
- Assumptions/failures/historical data: fixed CPU histogram strategy/seeds; cross-platform equality is not guaranteed. Requires the same point-in-time chronological feature/label/cost tables.
- Live latency/resources/overlap: offline fit and bounded shadow inference; CPU/memory/latency `UNAVAILABLE`, GPU unnecessary initially; directly overlaps XGBoost.
- Decision/seam: `REFERENCE_ONLY`; no dependency unless a Q10 comparative ablation earns promotion.
- Test/ablation/measured: identical folds/features/costs versus XGBoost and transparent baselines; not installed, measurements `UNAVAILABLE`.

### CatBoost 1.2.10 — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [PyPI 1.2.10](https://pypi.org/project/catboost/1.2.10/) and [security policy](https://github.com/catboost/catboost/security); Apache-2.0; current release observed, not installed.
- Economic hypothesis and I/O: categorical/ranking boosted challenger if genuine point-in-time categorical features add value.
- Assumptions/failures/historical data: GPU nondeterminism and training-file side effects must be disabled; mostly numeric Q data may remove its advantage. Requires frozen chronological features/labels/costs.
- Live latency/resources/overlap: offline fit/shadow inference; ~100 MB package, actual CPU/memory/latency `UNAVAILABLE`, GPU rejected initially; overlaps XGBoost.
- Decision/seam: `REFERENCE_ONLY`; Q10 ablation only.
- Test/ablation/measured: identical folds and categorical-feature removal against XGBoost/baselines; not installed, measurements `UNAVAILABLE`.

### River 0.25.0 — `ADOPT`, deferred

- Source/version/license/maintenance/security: [PyPI 0.25.0](https://pypi.org/project/river/0.25.0/) and [official docs](https://riverml.xyz/latest/); BSD-3-Clause; current release observed, no Q01 runtime exposure.
- Economic hypothesis and I/O: progressive validation, incremental baselines and drift evidence; ordered matured feedback in, pre-update scores/drift states out.
- Assumptions/failures/historical data: strict event order, maturity and seeds; update-before-score leaks and gaps can trigger detectors. Requires replayable ordered feedback with gap flags.
- Live latency/resources/overlap: research replay or bounded advisory state only, no listener; CPU/memory/latency `UNAVAILABLE`, no GPU. It never owns deployment/promotion truth.
- Decision/seam: `ADOPT`, deferred narrow Q09/Q15 adapter.
- Test/ablation/measured: replay against batch baselines, update-order and drift fixtures; not installed, measurements `UNAVAILABLE`.

### ruptures 1.1.10 — `ADOPT`, deferred

- Source/version/license/maintenance/security: [PyPI 1.1.10](https://pypi.org/project/ruptures/1.1.10/) and [repository](https://github.com/deepcharles/ruptures); BSD-2-Clause; current release supports Python `<3.14`, no dedicated security claim made.
- Economic hypothesis and I/O: retrospective segment boundaries as evidence features, never canonical regime truth; bounded historical series in, change points out.
- Assumptions/failures/historical data: explicit cost/penalty/model; exact/kernel methods may be expensive and hindsight-only. Requires admitted chronological series and separate causal evaluation.
- Live latency/resources/overlap: offline only; method-dependent CPU/memory, potentially superlinear, actual values `UNAVAILABLE`; no GPU. Overlaps simpler detector evidence, not authority.
- Decision/seam: `ADOPT`, deferred optional Q09 extra.
- Test/ablation/measured: compare EWMA/CUSUM/BOCPD at matched false-alarm budgets; not installed, measurements `UNAVAILABLE`.

### STUMPY 1.14.1 — `ADAPT`, deferred

- Source/version/license/maintenance/security: [PyPI 1.14.1](https://pypi.org/project/stumpy/1.14.1/) and [docs](https://stumpy.readthedocs.io/); BSD-3-Clause; current release observed, no dedicated security claim made.
- Economic hypothesis and I/O: motifs/discords and earlier-only analogues; bounded time series in, distances/indices out.
- Assumptions/failures/historical data: batch profile can be quadratic, Numba has cold cost and incremental history revision can leak hindsight. Requires sufficiently long stationary-scaled earlier windows.
- Live latency/resources/overlap: offline or bounded left-only research, not hot path; CPU/RAM and JIT latency `UNAVAILABLE`, no GPU required. Never owns analogue truth.
- Decision/seam: `ADAPT`, deferred narrow Q09 adapter.
- Test/ablation/measured: exact versus naive/approximate distances and proof all neighbors precede cutoff; not installed, measurements `UNAVAILABLE`.

### Optuna 4.9.0 — `ADOPT`, deferred

- Source/version/license/maintenance/security: [PyPI 4.9.0](https://pypi.org/project/optuna/4.9.0/) and [security policy](https://github.com/optuna/optuna/security); MIT; current release observed, not installed.
- Economic hypothesis and I/O: bounded hyperparameter search over a frozen chronological trial; parameter space/metric in, complete trial records out.
- Assumptions/failures/historical data: parallel studies are nondeterministic; fixed seed, sequential trials, hard budgets and all failed/pruned attempts are required. Consumes registered trial data, not raw market input.
- Live latency/resources/overlap: offline only; search multiplies model CPU/memory, exact cost `UNAVAILABLE`, GPU follows model policy. Optimizer never becomes registry/promoter.
- Decision/seam: `ADOPT`, deferred local Q10/Q14 study adapter.
- Test/ablation/measured: synthetic optimum, restart and budget/missing-trial tests; not installed, measurements `UNAVAILABLE`.

### MLflow 3.14.0 — `ADAPT`, deferred

- Source/version/license/maintenance/security: [PyPI 3.14.0](https://pypi.org/project/mlflow/3.14.0/) and [security advisories](https://github.com/mlflow/mlflow/security/advisories); Apache-2.0; active release with historical critical server/UI advisories, not installed.
- Economic hypothesis and I/O: no economic hypothesis; optional experiment-lineage projection from Q-native records to a local view.
- Assumptions/failures/historical data: no listener, remote URI, autologging or untrusted artifact load; consumes metadata/artifacts already admitted, not market sources.
- Live latency/resources/overlap: offline only; very large dependency/server surface, CPU/memory/disk `UNAVAILABLE`; strongly overlaps the authoritative Q registry.
- Decision/seam: `ADAPT`, deferred local SQLite-only Q15 projection if measured value exceeds cost.
- Test/ablation/measured: restart/path-escape/redaction and Q-registry parity tests; not installed, measurements `UNAVAILABLE`.

## Deferred infrastructure and sequence cards

### Feast 0.64.0 — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [PyPI 0.64.0](https://pypi.org/project/feast/0.64.0/) and [FAQ](https://github.com/feast-dev/feast/blob/master/docs/getting-started/faq.md); Apache-2.0; current release observed, provider-dependent security/access control, not installed.
- Economic hypothesis and I/O: no economic hypothesis; study point-in-time entity/feature joins from historical rows to training/serving projections.
- Assumptions/failures/historical data: needs stable entity/event timestamps and provider controls; registry/store/materialization drift can leak. Requires point-in-time feature history not present in Q01.
- Live latency/resources/overlap: online serving is forbidden; infrastructure cost/latency `UNAVAILABLE`. Registry, stores and serving duplicate Q lake/feature/registry owners.
- Decision/seam: `REFERENCE_ONLY`; copy no code and deploy no service, reproduce only point-in-time semantics natively.
- Test/ablation/measured: later Q-native as-of join/leakage fixtures; no dependency, all measurements `UNAVAILABLE`.

### FAISS / faiss-cpu 1.14.3 — `ADAPT`, deferred

- Source/version/license/maintenance/security: [PyPI 1.14.3](https://pypi.org/project/faiss-cpu/1.14.3/) and [releases](https://github.com/facebookresearch/faiss/releases); MIT; current release observed, no dedicated security claim made, not installed.
- Economic hypothesis and I/O: earlier-only vector analogue retrieval; registered embeddings/cutoffs in, neighbor IDs/distances out.
- Assumptions/failures/historical data: stable scaling/distance and cutoff filtering; foreign serialized indexes, OOM and approximate nondeterminism fail closed. Requires sufficiently large earlier-only embedding history.
- Live latency/resources/overlap: offline/bounded advisory retrieval only; CPU/RAM scale with index, GPU rejected initially, actual cost `UNAVAILABLE`. Never owns evidence, clustering or persistence.
- Decision/seam: `ADAPT`, deferred Q09 exact-vector adapter.
- Test/ablation/measured: brute-force parity, cutoff enforcement, corrupt-index denial and exact/approximate comparison; not installed, measurements `UNAVAILABLE`.

### PyOD 3.6.1 — `ADAPT`, deferred

- Source/version/license/maintenance/security: [PyPI 3.6.1](https://pypi.org/project/pyod/3.6.1/) and [repository](https://github.com/yzhao062/pyod); BSD-2-Clause; current release observed, no dedicated security claim made, not installed.
- Economic hypothesis and I/O: selected classical anomaly challengers; frozen feature rows in, explicitly `UNCALIBRATED_SCORE` out.
- Assumptions/failures/historical data: contamination and scaling are model assumptions; optional network/agent extras and foreign pickle/joblib are forbidden. Requires train-only transforms and chronological normal/event cohorts.
- Live latency/resources/overlap: offline research only; cost varies by selected detector, CPU/memory `UNAVAILABLE`, GPU not required. It cannot become anomaly or calibration authority.
- Decision/seam: `ADAPT`, deferred minimal Q09 subset.
- Test/ablation/measured: transparent baselines plus contamination/regime/feature ablations; not installed, measurements `UNAVAILABLE`.

### scikit-survival 0.28.0 — `REJECT`

- Source/version/license/maintenance/security: [PyPI 0.28.0](https://pypi.org/project/scikit-survival/0.28.0/); GPL-3.0-or-later; current release observed, compiled surface and reciprocal-license review unresolved, not installed.
- Economic hypothesis and I/O: censored time-to-event models over feature/event/censoring tables; survival distributions out.
- Assumptions/failures/historical data: correct censoring/event identity and survival assumptions; requires point-in-time fill/event histories unavailable in Q01.
- Live latency/resources/overlap: offline fit/advisory only; compiled CPU/memory `UNAVAILABLE`, no initial GPU; overlaps XGBoost AFT and simpler survival baselines.
- Decision/seam: `REJECT` due avoidable license/distribution risk and compiled surface; use published targets/metrics or XGBoost AFT.
- Test/ablation/measured: later survival targets compare Kaplan-Meier/parametric/XGBoost AFT; package not installed, measurements `UNAVAILABLE`.

### hmmlearn 0.3.3 — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [PyPI 0.3.3](https://pypi.org/project/hmmlearn/0.3.3/) and [repository](https://github.com/hmmlearn/hmmlearn); BSD-3-Clause; explicitly limited maintenance, no Q01 runtime exposure.
- Economic hypothesis and I/O: latent-state baseline over ordered observations; posterior/state sequences out, never canonical regime truth.
- Assumptions/failures/historical data: Markov/emission assumptions, label switching, local optima and state identifiability; needs bounded chronological series across later regimes.
- Live latency/resources/overlap: offline challenger only; CPU/memory/latency `UNAVAILABLE`, no GPU; overlaps regime/changepoint evidence.
- Decision/seam: `REFERENCE_ONLY`; no dependency until a bounded comparative test.
- Test/ablation/measured: seeded restarts, permutation/identifiability and regime-shift baselines; not installed, measurements `UNAVAILABLE`.

### PyTorch 2.13.0 — `ADAPT`, deferred

- Source/version/license/maintenance/security: [PyPI 2.13.0](https://pypi.org/project/torch/2.13.0/) and [serialization security](https://docs.pytorch.org/docs/stable/notes/serialization.html); composite permissive expression; current release observed, not installed.
- Economic hypothesis and I/O: later data-sufficient sequence challengers; bounded tensors in, shadow scores/distributions out.
- Assumptions/failures/historical data: deterministic-algorithm support, device variance and checkpoint code-execution risk; requires sufficient sequence-correct L2/labels and trusted weights-only artifacts.
- Live latency/resources/overlap: CPU-first offline/shadow only; large RAM/disk and possible GPU cost, all `UNAVAILABLE`; never inference/order authority.
- Decision/seam: `ADAPT`, deferred optional `ml` extra after Q12 sufficiency.
- Test/ablation/measured: deterministic CPU repeat, device parity, simple-baseline and checkpoint-denial tests; not installed, measurements `UNAVAILABLE`.

### Tardis.dev — `ADAPT`, externally blocked

- Source/version/license/maintenance/security: [Binance history docs](https://docs.tardis.dev/historical-data-details/binance-futures) and [terms](https://docs.tardis.dev/legal/terms-of-service); paid licensed service with restricted raw redistribution; service version is external and owner approval absent.
- Economic hypothesis and I/O: no edge claim; optional licensed historical L2/collector-time evidence in, manifest-bound source records out.
- Assumptions/failures/historical data: generated snapshots and documented daily restart gaps; identity, retention and redistribution terms remain controlling. Requires paid history and checksum/license manifests.
- Live latency/resources/overlap: historical intake only, not live producer; acquisition/storage/cost `UNAVAILABLE`. Canonical runtime remains forward source owner.
- Decision/seam: `ADAPT`, `BLOCKED_EXTERNAL`; metadata-only card until owner approval, raw licensed data never enters Git.
- Test/ablation/measured: later checksum/gap/schema/source-comparison tests if approved; no acquisition, measurements `UNAVAILABLE`.

### NautilusTrader 1.230.0 — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [PyPI 1.230.0](https://pypi.org/project/nautilus-trader/1.230.0/) and [releases](https://github.com/nautechsystems/nautilus_trader/releases); LGPL-3.0-or-later, beta; current release observed, not installed.
- Economic hypothesis and I/O: none; reference deterministic event/replay and research/live parity patterns only.
- Assumptions/failures/historical data: adopting its engine assumes ownership it does not have here; historical data requirement `N/A` because no implementation is admitted.
- Live latency/resources/overlap: no live use; resource result `N/A`. Trading engine, adapters, risk, cache, execution and persistence are forbidden duplicate/money authorities.
- Decision/seam: `REFERENCE_ONLY`; no dependency, copied code or connector.
- Test/ablation/measured: compare only Q-native semantic invariants if useful; implementation and measurements `N/A`.

### Microsoft Qlib 0.9.7 — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [PyPI 0.9.7](https://pypi.org/project/pyqlib/0.9.7/) and [security policy](https://github.com/microsoft/qlib/security); MIT, alpha; current release observed, not installed.
- Economic hypothesis and I/O: none; reference workflow/model-comparison patterns only.
- Assumptions/failures/historical data: its data/recorder/backtest abstractions assume ownership Q/product already assigns; data requirement `N/A` because no import is admitted.
- Live latency/resources/overlap: no live use; resources `N/A`; data, recorder, strategy and executor directly overlap existing owners.
- Decision/seam: `REFERENCE_ONLY`; never import executor/backtest authority.
- Test/ablation/measured: compare documentation patterns only; implementation and measurements `N/A`.

### Hummingbot 2.15.x — `REJECT`

- Source/version/license/maintenance/security: [2.15 release notes](https://hummingbot.org/release-notes/) and [API warning](https://hummingbot.org/hummingbot-api/installation/); Apache-2.0; maintained release observed, security-sensitive key/wallet surface, not installed.
- Economic hypothesis and I/O: none accepted; connectors, strategies and orders are outside Q authority.
- Assumptions/failures/historical data: requires keys, balances/wallets and operational ownership; data requirement `N/A` because adoption is forbidden.
- Live latency/resources/overlap: forbidden live money path; resources `N/A`; duplicates source, strategy, order and execution owners.
- Decision/seam: `REJECT`; canonical product owners remain unchanged and Q imports no code/connector.
- Test/ablation/measured: no implementation; rejection is authority-based, measurements `N/A`.

### DeepLOB — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [paper](https://arxiv.org/abs/1808.03668); method has no package version; official notebook repository has no license/release/lock, so code cannot be copied and software security is `UNKNOWN`.
- Economic hypothesis and I/O: ten-level sequence architecture reference; 100-state L2 tensors in, future-move class scores out.
- Assumptions/failures/historical data: needs large gap-free sequence-correct L2 and purged future labels; equity mid-price simulations omit executable Binance costs.
- Live latency/resources/overlap: shadow challenger only, never hot path; paper used GPU and Q CPU/GPU/memory/latency are `UNAVAILABLE`; model role only.
- Decision/seam: `REFERENCE_ONLY`, `BLOCKED_DATA`; bounded later reimplementation, not copied code.
- Test/ablation/measured: after Q12 sufficiency compare transparent/simple temporal baselines with full costs; Q01 result `UNAVAILABLE`.

### TLOB — `REFERENCE_ONLY`

- Source/version/license/maintenance/security: [paper](https://arxiv.org/abs/2502.15757) and [repository](https://github.com/LeonardoBerti00/TLOB); MIT repository, no tag and weak/unportable lock; software security posture `UNKNOWN`, not installed.
- Economic hypothesis and I/O: dual temporal/spatial attention challenger over L2 sequences; book tensors in, horizon-specific class scores out.
- Assumptions/failures/historical data: sufficient gap-free L2, train-only thresholds and purged labels; one short BTC-perpetual sample and worse spread-aware results limit transfer.
- Live latency/resources/overlap: offline shadow only; GPU/CPU/memory/latency `UNAVAILABLE`; overlaps DeepLOB/simple temporal challenger seam.
- Decision/seam: `REFERENCE_ONLY`, `BLOCKED_DATA`; bounded later reimplementation.
- Test/ablation/measured: ablate each attention axis against MLPLOB/DeepLOB with symbol holdouts and full costs; Q01 result `UNAVAILABLE`.

## Primary paper implement/test/ablate decisions

| Anchor | Decision | Required implementation/test/ablation and transfer limit |
| --- | --- | --- |
| [Cont–Kukanov–Stoikov OFI](https://arxiv.org/abs/1011.6402) | `ADAPT` | Causal L1 OFI over gap-free books; predict future executable outcomes and ablate trades/depth/price-changing events. The headline result is contemporaneous US-equity evidence, not a forecast. |
| [Gould–Bonart queue imbalance](https://arxiv.org/abs/1512.03492) | `ADAPT` | Simple logistic baseline stratified by tick/spread/liquidity; replace interleaved random split with purged chronology and ablate microprice/OFI/deeper levels. |
| [Multi-level/cross-asset OFI](https://arxiv.org/abs/2112.13213) | `ADAPT` | Adopt own-symbol multi-level OFI; cross-asset terms remain sparse challengers. Fit PCA/LASSO/peer universe on earlier data only; reported PnL omitted costs. |
| [Queue-reactive Hawkes](https://arxiv.org/abs/1901.08938) | `REFERENCE_ONLY`, `BLOCKED_DATA` | Binance batched deltas do not faithfully identify limit/cancel/trade marks. Test only coarse bounded intensity proxies against Poisson/queue baselines and reset on gaps. |
| [BOCPD](https://arxiv.org/abs/0710.3742) | `ADAPT` after test | Bounded causal run-length/surprise against EWMA, rolling-z and CUSUM at matched false alarms; tune hazards on past data and stress heavy tails/autocorrelation. |
| [DeepLOB](https://arxiv.org/abs/1808.03668) | `REFERENCE_ONLY`, `BLOCKED_DATA` | Wait for sufficient sequence-correct ten-level history; purge future-smoothed labels and compare simple models under queue/spread/impact/fill costs absent from the paper simulation. |
| [TLOB](https://arxiv.org/abs/2502.15757) | `REFERENCE_ONLY` | Ablate each attention axis against MLPLOB/DeepLOB on symbol holdouts and purged walk-forward evidence; one short BTC-perp sample does not transfer. |
| [Fill-time survival](https://arxiv.org/abs/2306.05479) | `ADAPT` target, defer deep model | Preserve censoring/partial fill/adverse selection; start Kaplan–Meier/parametric/MLP. Aggregated Binance depth cannot reproduce Nasdaq order identity or true queue position. |
| [Perpetual-futures pricing](https://arxiv.org/abs/2310.11771) | `ADAPT` | Shadow fair-basis residual using only contemporaneous funding/rates, passed to the existing Basis owner. Stress fees, borrow, collateral, liquidation and leg risk omitted by frictionless theory. |
| [Pump anatomy](https://arxiv.org/abs/1811.10109) | `ADAPT` hypotheses; reject strategy/probability | EventAtlas feature hypotheses with event/coin/venue chronology; ablate static metadata and favorable exit assumptions. Cryptopia/static-market-cap evidence is not Binance edge. |
| [Real-time pump detection](https://arxiv.org/abs/2105.00733) | test `ONSET_NOW` only | Same-millisecond fills are burst proxies, not orders. Event-grouped chronology replaces random/K-fold chunks; no pre-onset or probability claim. |
| [Adaptive Conformal Inference](https://arxiv.org/abs/2106.00170) | `ADAPT` | Deterministic delayed-label update; measure long-run/rolling/regime coverage and width against fixed conformal. Long-run marginal coverage is not conditional validity. |
| [Time-series AgACI](https://arxiv.org/abs/2202.07282) | `REFERENCE_ONLY` ablation | Compare expert aggregation with fixed-step ACI and non-adaptive sequential methods; electricity evidence and unproved AgACI validity require heavy-tail/outage/delay stress. |
| [Probability of Backtest Overfitting](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253) | `ADAPT` diagnostic | CSCV/PBO over every attempted comparable net trial, tested on null/planted fixtures. It never replaces chronological purged untouched holdouts. |
| [Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) | `ADAPT` secondary gate | Test Gaussian/skew/heavy-tail/autocorrelation fixtures; requires truthful effective trial count and stable moments, which sparse event returns may not supply. |

## Initial hard rejects

- Online reinforcement learning with capital and any LLM in inference/order flow: `REJECT`; non-deterministic authority and safety mismatch.
- Random train/test splits, adjacent-window SMOTE, unrecorded trials and any feature without a reproducible cutoff/label horizon: `REJECT` as leakage/selection machinery.
- Full replatforming, copied framework trees, abandoned connectors and foreign pickle/joblib/model/index loads: `REJECT`.
- Measurement status: only Q01 locked install/import and tooling gates are measured. Every performance, latency, memory, uplift, calibration and profitability result remains `UNAVAILABLE` until its phase supplies actual evidence.
