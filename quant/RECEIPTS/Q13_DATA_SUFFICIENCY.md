# Q13 deep-sequence data-sufficiency receipt

Status: `FAIL_DATA_INSUFFICIENT`

Evaluated on: 2026-07-13

Branch: `q13-deep-gate-20260712`

Evaluation base: `f756f3b582f24857811e6ec4c0d08a3a61026b74`

Evaluation tree: `ba260ca5114587225e31b9dd3666467e5f89582e`

## Decision

Q13 may implement deterministic deep-sequence interfaces and synthetic fixtures only.
It must not fit, benchmark, serialize, register, shadow-run, or promote an MLP,
DeepLOB, TLOB, TCN, Transformer, or other learned sequence model from the evidence in
this tree. Every declared deep family remains `REFERENCE_ONLY`.

Exact evidence gap carried by every Q13 model reference:

`HISTORICAL_L2_SEQUENCE_COVERAGE_MISSING: atlas contains only 832 BNBUSDT Spot aggTrades on 2017-11-06; zero complete sequenced L2 rows, zero real point-in-time labels/outcomes, no cost/actionability truth, no independent multi-day/regime cohort, and no untouched chronological holdout.`

## Actual lake and atlas evidence

The checksum-bound historical tier contains one symbol, one Spot product, and one UTC
date: BNBUSDT Spot aggregate trades for 2017-11-06. It contains 832 rows, 20 retained
candidate windows, and 143 retained controls. The 0 observed internal discontinuities,
invalid rows, and duplicates are facts about this bounded archive member only; the
source report explicitly leaves archive boundary/upstream completeness unknown.

The atlas says:

- `truthPosture=RESEARCH_ONLY` and `laterOutcomesStatus=UNAVAILABLE`;
- historical tier `REAL_CHECKSUM_VERIFIED_ARCHIVE`, containing aggregate trades rather
  than complete L2 book sequences;
- forward high-fidelity tier `SYNTHETIC_CONTRACT_ONLY`, real coverage `MISSING`, and
  delivery `BLOCKED`;
- point-in-time instrument economics `UNAVAILABLE` on every retained window.

The source coverage matrix reports real `depthDelta`, `bookTicker`, and optional Tardis
historical L2 rows as `UNAVAILABLE`. Its named omissions include
`COMPLETE_L2_UNAVAILABLE`, `SEQUENCE_COMPLETE_CAPTURE_MISSING`,
`LOCAL_RECEIVE_CLOCK_UNAVAILABLE`, `QUEUE_POSITION_UNAVAILABLE`, and
`BORROW_TRUTH_UNAVAILABLE`.

The Q05 label campaign is `SYNTHETIC_ONLY`: its 24 seeded samples and 177 available
horizon statuses prove deterministic label interfaces, not real market labels. The
real atlas has no later outcomes. Q10/Q11/Q14 therefore provide reusable model,
survival, and validation machinery but no current real deep-training cohort.

## Section 14.8 gate

| Required proof | Result | Evidence |
| --- | --- | --- |
| Enough complete historical L2 sequences | `FAIL` | Zero observed complete sequenced L2 rows; only one day of Spot aggregate trades. |
| Enough independent events and regimes | `FAIL` | One symbol/product/day cannot establish independent multi-period or multi-regime evidence; atlas candidates overlap one bounded day. |
| Stable point-in-time labels | `FAIL` | Real atlas later outcomes are `UNAVAILABLE`; populated Q05 labels are synthetic fixtures only. |
| Realistic cost/actionability targets | `FAIL` | Atlas economics are `UNAVAILABLE`; fees, spread/depth actionability, funding, borrow, slippage, and latency truth are absent. |
| Declared GPU/CPU budget | `UNPROVEN` | No data-supported Q13 training/inference campaign exists to benchmark; no PyTorch dependency is admitted. |
| Untouched chronological holdout | `FAIL` | A single unlabeled historical day cannot supply an independent untouched chronological holdout. |
| Simpler baselines established on the same evidence | `FAIL` | Q10 baselines are established on deterministic synthetic campaigns, not this absent L2/label/cost cohort. |

Because all seven proofs are jointly required, Q13 fails before any deep dependency,
training, accuracy benchmark, or promotion comparison is permitted.

## Frozen evidence digests

| Artifact | SHA-256 |
| --- | --- |
| `quant/generated/q03/event_atlas.v1.json` | `f8d59dea19be7a4f633f73deaccc3910b086c5a50fa03c07a1b4147ba297b21c` |
| `quant/generated/q03/source_coverage.v1.json` | `f2f23bbb394e6547222bfde5ed4bc8ed9551a771ad5bfe18c4c239ca70429104` |
| `quant/generated/q05/label_campaign.v1.json` | `9a5e5dcc7f7f6425c43e4e82c4ed51217284f39d361c0f0e45e7220226780c7e` |
| `quant/generated/q14/validation_campaign.v1.json` | `a0522034a97c2676d4af31c7b22c10412ebb06a115df4de72f307081b23d9f87` |
| `quant/RECEIPTS/Q14_ACCEPTANCE.md` | `362cc25553c9b886f8dda0c4c41a416d97568e15bbe7ef30897a38e1eb5026dc` |
| `quant/pyproject.toml` | `a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81` |
| `quant/uv.lock` | `716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29` |

## Research decision

The current primary sources reinforce the repository's fail-closed law:

- DeepLOB uses convolutional spatial processing plus an LSTM and reports its realistic
  experiment on one year of LSE quotes, not one day of aggregate trades:
  <https://arxiv.org/abs/1808.03668>.
- TLOB reports that a simple MLP can beat more complex models on its benchmarks and
  that spread-aware labeling materially reduces apparent predictability:
  <https://arxiv.org/abs/2502.15757>.
- The 2025 microstructural guide warns that high forecasting metrics do not
  necessarily become actionable trading signals:
  <https://doi.org/10.1080/14697688.2025.2522911>.

These papers are design references only. Their datasets, benchmark results, and model
claims are not transferable evidence for current Binance execution economics.

## Q13 implementation boundary created by this receipt

Permitted:

- bounded immutable sequence/input/model-card/gate contracts;
- deterministic `SYNTHETIC_ONLY` fixtures that exercise temporal lineage and unknown
  propagation;
- explicit MLP, DeepLOB-style, and TLOB-style `REFERENCE_ONLY` declarations;
- a narrow adapter into the accepted Q14 validation factory proving leaked
  `max_feature_asof_ns` is rejected before comparison;
- generated Q13 receipt projections that make the failed gate and evidence gap
  machine-readable.

Forbidden:

- importing or adding PyTorch for Q13;
- fitting weights or calling synthetic output a benchmark;
- claiming probability, edge, calibration, actionability, or promotion evidence;
- opening the Q14 untouched holdout for a deep model;
- creating any source, scanner, label owner, validation clone, registry authority, or
  money path.
