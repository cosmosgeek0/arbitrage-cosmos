# DQ-3 statistical-coordinate validator

DQ-3 is a pure, network-free coordinate seal for future S-1 and V-G research
families. It fixes the recurring identity and coordinate class of defects before
statistics are scored. It does not calculate an economic verdict, open a holdout,
or validate any historical packet.

## Frozen v1 contract

The public names in `PUBLIC_API_V1` are the complete v1 API. A consumer supplies:

- one exact attempted-trial ledger with `COMPLETED`, `FAILED`, or `ABANDONED`
  status;
- one exact multiplicity identity containing every attempted trial;
- raw-p-value identities containing completed trials only;
- the identical ordered development observation grid for every attempted trial;
- one deterministic shared White max-T coordinate plan and one witness per
  attempted trial;
- one complete CSCV/PBO block-and-split plan and one witness per attempted trial;
- `holdout_opened=False` and `holdout_feedback_count=0`.

The validator returns a canonical, SHA-256-bound `CoordinateReceiptV1`. Input
trial order cannot change the receipt.

## Coordinate rules

### White max-T

`build_white_max_t_coordinates_v1` derives one family-level seed and one shared
circular fixed-block resample coordinate for each replicate. The required
consumer loop is replicate-first:

1. expand replicate `b` once;
2. apply that exact ordered index vector to every attempted trial that completes;
3. calculate each frozen null statistic on that joint resample;
4. take the cross-trial maximum for replicate `b`;
5. retain replicate order.

Independent per-trial bootstrap calls, trial-ordinal seed offsets, and sorting
each trial's bootstrap statistics before cross-trial pairing violate the
contract. DQ-3 freezes coordinates only. The consumer must separately freeze its
null transform, centering, studentization, one- or two-sided statistic, and
Monte Carlo p-value rule.

### Derived seeds

`derive_seed_v1` hashes domain-separated canonical JSON containing the master
seed, family, phase, purpose, and optional semantic trial ID. The shared White
plan uses no trial ID, so adding or reordering trials cannot change its seed.
There is no `seed + ordinal` or `seed + 1` path.

### Multiplicity

The multiplicity family is the exact attempted ledger, including failed and
abandoned trials. Completed trials own raw p-values. Every noncompleted trial is
retained with an effective p-value of exactly `1`; it is never silently removed
from the family. DQ-3 cannot discover an undisclosed trial, so the consumer must
bind the complete attempted-trial registry before scoring.

### CSCV/PBO

Every attempted trial must declare the same ordered development observation grid.
The grid is divided into an even number of equal, nonempty, contiguous blocks.
DQ-3 enumerates all `C(S, S/2)` in-sample block combinations and their exact
complements while retaining original observation order. Per-trial block or split
permutation is rejected.

If any attempted trial is failed or abandoned, DQ-3 preserves its multiplicity
identity and coordinate witness but marks PBO
`UNMEASURED_INCOMPLETE_TRIAL_FAMILY`; a reduced PBO matrix is forbidden.

The frozen tie policy is `FAIL_CLOSED`; `validate_pbo_rank_row_v1` requires the
intact DQ-3 receipt, derives the exact score identity from that receipt, and
rejects ties, nonfinite scores, and incomplete trial families. A caller cannot
substitute a reduced identity list. PBO is development-only, diagnostic-only
evidence. It is not a p-value, a multiplicity correction, a lower confidence
bound, a holdout result, or capital authority. Invalid PBO is `UNMEASURED`,
never numeric zero.

### Holdout boundary

DQ-3 accepts development coordinates only. Any holdout phase coordinate,
previous holdout open, or prior holdout feedback fails closed. A valid receipt
grants no authority to open the holdout. The consumer may open a separately
sealed holdout only after:

- the complete development family is frozen;
- all development gates are final;
- one champion and its single-trial holdout statistic are frozen;
- no further model, family, threshold, cost, or coordinate choice can change.

Holdout outcomes never re-enter White max-T, PBO, family selection, or
development tuning.

## Consumer rule

Every future S-1/V-G family must freeze and persist a DQ-3 receipt before
statistical scoring, then use the receipt-bound shared White and PBO coordinates
without regeneration or reordering. A failed validation yields no inference.
Past packets remain untouched and receive no retroactive validation.

## Known limits

DQ-3 proves coordinate, identity, seed, and phase integrity only. It cannot prove:

- that the trial registry is complete beyond the supplied sealed registry;
- exchange-data custody, point-in-time universe validity, or data quality;
- independence, stationarity, block-length suitability, or model assumptions;
- the correctness of a statistic, null transform, bootstrap method, or p-value;
- fees, capacity, executable edge, profitability, or capital safety;
- holdout eligibility or permission to open a holdout.

Authority is always `NONE`.

## Focused proof

From `quant/`:

```text
PYTHONPATH=src:. uv run --locked --no-sync pytest -q research/dq3/test_validator.py
PYTHONPATH=src:. uv run --locked --no-sync python research/dq3/verify_known_answer.py
uv run --locked --no-sync ruff check research/dq3
MYPYPATH=src:. uv run --locked --no-sync mypy --strict --explicit-package-bases research/dq3/validator.py research/dq3/__init__.py research/dq3/known_answer.py research/dq3/verify_known_answer.py
```

The proof covers the seed known answer, joint White replicate pairing, White
plan self-authentication, complete PBO enumeration, receipt-bound full-family
ranking, trial-order invariance, exact multiplicity identities, asynchronous
grids, malformed coordinates, ties, and sealed-holdout failures.
