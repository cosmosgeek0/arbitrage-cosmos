# DQ-8 NAV/drawdown coordinate validator

DQ-8 is a prospective, deterministic intake boundary for research NAV paths. It
does not repair an experiment, choose a strategy, authenticate an exchange
source, or authorize capital. Its receipt always carries `authority=NONE`.

The validator accepts one closed, flat-to-flat path and independently replays
its cash, positions, NAV, endpoint return, cash duration, and maximum drawdown.
It returns a domain-separated SHA-256 receipt only when every claimed economic
value and every coordinate agrees with that replay.

## Coordinate contract

- The clock is immutable and strictly increasing. Every mark binds an integer
  microsecond coordinate to its canonical UTC RFC 3339 label and UTC date.
  Intervals must be an exact number of hours.
- Every entry, exit, and held-position valuation consumes one unique price
  coordinate. A coordinate binds the source artifact digest, source row,
  source field, instrument, venue, lot, clock mark, timestamp labels, use, and
  exact decimal price. Orphaned, duplicated, nearest, shifted, interpolated,
  or role-substituted prices fail closed.
- Each lot has exactly one entry and one later exit, and must flatten exactly.
  The first and final NAV marks must have no positions.
- Economic cash events are endogenous and explicit. Fees, funding, borrow
  interest, rebates, and other costs affect both replayed cash and endpoint
  economics. Contributions and withdrawals are intentionally outside v1.
- Each NAV mark must equal replayed cash plus the exact marked value of every
  open lot. Missing held marks, stale marks, and unbound position values fail.
- Cash duration is the sum of whole clock intervals whose post-event position
  set is empty. `cashHours` means portfolio cash-only hours, not exchange
  session hours.
- Endpoint return is the exact fraction
  `(ending NAV - starting NAV) / starting NAV`; the numerator and denominator
  are retained separately, so no rounded return can pass.
- Maximum drawdown is derived from that same ordered NAV path. It retains the
  peak/trough NAV mark IDs, UTC timestamps, and dates. Strict comparison keeps
  the earliest coordinate pair when a later pair has the same loss-to-peak
  ratio.

Canonical decimals are finite strings without exponent notation, leading
zeroes, redundant fractional zeroes, or negative zero. Floating-point JSON
numbers are rejected.

## Known answer and hostile fixtures

`fixtures/valid_path.v1.json` binds a synthetic source artifact and proves:

- 10 portfolio cash-only hours;
- endpoint result `-50/1000`;
- drawdown `300/1200`, from exactly `2026-01-01T12:00:00Z` to
  `2026-01-01T18:00:00Z`.

`fixtures/hostile_manifest.v1.json` changes one or more bound coordinates or
economic claims. It includes the previously observed one-day-late
peak/trough-label defect as a rejection case; no prior experiment is imported,
rerun, repaired, or reinterpreted.

## Verification

Run from `quant/`:

```sh
PYTHONPATH=src:. uv run --locked --no-sync pytest -q research/dq8/test_validator.py
PYTHONPATH=src:. uv run --locked --no-sync python research/dq8/verify_known_answer.py
uv run --locked --no-sync ruff check research/dq8
uv run --locked --no-sync ruff format --check research/dq8
MYPYPATH=src:. uv run --locked --no-sync mypy --strict --explicit-package-bases \
  research/dq8/validator.py research/dq8/__init__.py \
  research/dq8/known_answer.py research/dq8/verify_known_answer.py
```

## Boundaries

This package verifies internal coordinate and arithmetic consistency. It does
not prove that a source artifact was authentic or captured before analysis,
that costs are account-complete, or that an experiment is profitable. A
consumer such as N3 or a future research intake must separately enforce source
provenance, holdout, fee, and strategy policy.

The implementation is standard-library-only and performs no network, provider,
private-account, order, transfer, withdrawal, deployment, host, or UI action.
See [REFERENCES.md](REFERENCES.md) for the primary sources that informed the
contract.
