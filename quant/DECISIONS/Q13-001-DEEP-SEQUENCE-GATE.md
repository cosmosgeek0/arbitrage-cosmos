# Q13-001 — fail the deep-data gate before constructing a model

Status: `ACCEPTED_FOR_Q13_IMPLEMENTATION`

Date: 2026-07-13

## Decision

Q13 fails the Section 14.8 data-sufficiency gate and implements deterministic
interfaces and fixtures only. The exact frozen gap is:

`HISTORICAL_L2_SEQUENCE_COVERAGE_MISSING: atlas contains only 832 BNBUSDT Spot aggTrades on 2017-11-06; zero complete sequenced L2 rows, zero real point-in-time labels/outcomes, no cost/actionability truth, no independent multi-day/regime cohort, and no untouched chronological holdout.`

The simple temporal MLP, DeepLOB-style model, and TLOB-style model are separate
reference records. Each uses the existing Q10 `BatteryDisposition.REFERENCE_ONLY`
vocabulary with an empty implemented-ID set and carries the exact gap above. None is
implemented, trained, benchmarked, shadow-scored, calibrated, registered, or eligible
for promotion.

## Contract shape

- `DeepSequenceWindowV1` content-addresses a bounded sequence payload while preserving
  sample/group identity, sequence start, feature cutoff, label end, every frame as-of
  time, feature IDs, known/unknown level and gap counts, quality, evidence posture,
  and optional costs/outcome. It rejects a frame after cutoff. It projects only these
  facts into Q14 `ValidationSampleV1`; unknown costs remain `None`.
- `DeepFoldLineageV1` records a future candidate's training sample/groups, maximum
  training-label end, embargo, split-plan digest, and feature/label manifests. It
  rejects sample/group overlap and training labels that violate the embargo. This is
  necessary because Q14 validates prediction as-of lineage but does not claim to
  prove fold-specific fitting.
- `DeepDataSufficiencyEvidenceV1` accepts seven explicit receipt facts and immutable
  evidence digests. `False` fails, `None` is `UNKNOWN`, and only seven `True` values
  yield `SUFFICIENT`. No arbitrary event-count threshold is invented.
- `bind_q14_validation` creates no score or model. It can bind a future candidate to
  Q14 digests only after `SUFFICIENT`; the actual Q13 report raises
  `DEEP_DATA_SUFFICIENCY_GATE_FAILED`.

## Q14 falsification evidence

The synthetic interface fixture exists only to attack the temporal gate. A deliberate
future-value injection carries `max_feature_asof_ns=label_end_ns` and Q14 rejects it
as `REJECTED_TEMPORAL_LEAK`. If the fixture lies and moves that as-of time back to the
cutoff, Q14 rejects its perfect skill as `REJECTED_IMPLAUSIBLE_SKILL`. Missing gross
edge/base cost produces `ABSTAIN_UNKNOWN` for all synthetic samples under cost stress.
None of these probes is a model result or market benchmark.

## Research basis

- DeepLOB uses structured L2 spatial convolution plus recurrent temporal processing
  and reports a realistic experiment on one year of LSE quotes. That data condition
  is absent here: <https://arxiv.org/abs/1808.03668>.
- TLOB reports that a simple MLP can outperform complex architectures on its
  benchmarks and that spread-aware labeling reduces apparent predictability. This
  supports simple-baseline-first and cost-aware evaluation, not transfer of its
  result: <https://arxiv.org/abs/2502.15757>.
- The 2025 microstructural guide reports that forecasting metrics need not correspond
  to actionable trades: <https://doi.org/10.1080/14697688.2025.2522911>.

## Rejected alternatives

- Add PyTorch and implement architecture stubs: rejected because a dependency and
  callable model would imply evidence support that does not exist.
- Train on Q05/Q10/Q14 synthetic fixtures: rejected because a deterministic interface
  proof is not a market benchmark.
- Reconstruct L2 from aggregate trades or candles: forbidden by the Q directive.
- Emit neutral/unknown deep predictions: Q14 predictions require real exact scores;
  no prediction is more truthful than a fabricated neutral score.
- Reuse Q10's internal split as validation authority: rejected; Q14 is the accepted
  chronological validation owner.
- Open the Q14 holdout to prove fixture behavior: rejected; reference-only Q13 has no
  candidate eligible for holdout evaluation.

## Re-entry conditions

A later Q13 revision may implement a simple MLP and exactly one shadow challenger only
after a new immutable receipt proves all seven requirements on the same cohort:
complete L2 sequences; independent events/regimes; point-in-time labels; realistic
cost/actionability targets; measured compute budget; untouched chronological holdout;
and an established simple baseline. Even then, Q14 chronological comparison, leakage
controls, cost stress, calibration, resource budget, shadow evidence, and an auditable
promotion decision remain mandatory; benchmark accuracy alone never promotes.
