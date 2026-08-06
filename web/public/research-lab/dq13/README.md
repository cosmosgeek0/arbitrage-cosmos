# DQ-13 causal as-of clock validator

DQ-13 is one deterministic, network-free validator for the clocks that make a
multi-feed research decision causally usable. It covers Binance public kline,
mark-price, index-price, settled-funding, and current-metadata evidence. It is a
portable Python 3.13 package with a strict mapping/JSON boundary and no imports
from mutable research application code.

Only `VALID` is admissible. `UNKNOWN` is retained rather than dropped or
converted to zero. `INVALID` means the supplied contract contains a definite
structural or causal-policy violation.

DQ-13 is prospective source infrastructure for future S-1/V-G and N3 final
convergence only. It does not reopen or reclassify a consumed run, fetch data,
inspect private state, price an order, calculate an economic result, or grant
capital authority.

## Frozen clock contract

Every timestamp carries an explicit `MILLISECOND` or `MICROSECOND` unit,
clock identity, optional uncertainty bound, and optional same-clock sequence.
There is no magnitude-based unit inference. Milliseconds normalize to a
microsecond range, not a fabricated within-millisecond point:

```text
raw ms n  -> [n * 1000, n * 1000 + 999] us
raw us n  -> [n, n] us
```

An uncertainty bound widens both ends. Ordering is proven when the entire left
range is at or before the entire right range. An overlapping range is
`UNKNOWN` unless both stamps share a clock and their declared sequences order
the overlap. The caller is responsible for freezing defensible clock error
bounds; zero is a claim, not an estimate made by DQ-13.

The selected decision chain is:

```text
semantic event/end <= observed availability <= decision <= executed fill
```

Availability means persisted evidence usable by the strategy. An exchange
event timestamp, kline close, funding time, next-funding schedule, server time,
archive path, or later download is not silently relabelled as availability.

Selection is an exact-key, backward as-of operation:

- filter by venue, product, instrument, feed kind, and interval identity;
- exclude anything not provably available by the decision;
- select the latest provable semantic event among the remaining records;
- collapse only duplicates whose payload, endpoint, semantic clocks,
  availability clock, availability basis, and availability evidence are
  identical;
- return `UNKNOWN` for ambiguous order or conflicting payloads.

Later observations may coexist in the input pool, but they cannot replace an
available predecessor. A late-arriving older event also cannot replace a newer
semantic event. A same-effective payload conflict remains `UNKNOWN` even when
same-clock sequences differ. A cyclic dominance relation is also `UNKNOWN`;
every public entrypoint converts any unexpected implementation exception to a
stable `INVALID` receipt.

## Feed-specific rules

- Kline, mark-kline, and index-kline records use
  `[open, closeInclusive + one native unit)`. Stream intervals require
  `isFinal=true`, an exchange event clock, and an observed receipt at or after
  the exclusive end; the event clock itself need not follow the close.
  REST/archive intervals forbid an invented event clock or final flag and use
  the supplied receipt or frozen-release availability evidence. Every fixed
  step is checked against its declared UTC or UTC+08:00 phase: subday/daily
  bars use the local epoch grid, three-day bars use the local day-one modulo
  three-day grid, and weekly bars begin local Monday. Calendar-month edges
  must be adjacent local month starts. Zone acceptance is endpoint-specific:
  Spot REST klines and the documented Spot `@+08:00` kline streams accept both
  frozen zones; Spot public archives and every USD-M interval profile are
  UTC-only in v1.
- Instant mark and index records use the exchange event as semantic time and a
  separate observed availability time.
- `FUNDING` means settled USD-M REST funding history. `fundingTime` is the
  semantic event; a receipt or separately frozen release proof is still
  required. Projected/current rates belong in metadata, not settled funding.
- `CURRENT_EXCHANGE_INFO` and `CURRENT_FUNDING_INFO` are current REST
  snapshots. Because current `exchangeInfo`/`fundingInfo` responses do not
  provide a historical
  last-modified clock, the snapshot is conservatively effective only from its
  observed receipt and only until its right-open receipt-freshness expiry. It
  never backfills an earlier decision.
- Spot REST/stream millisecond and microsecond profiles are distinct. Spot
  public archives use the documented pre-2025 millisecond/from-2025
  microsecond profiles. USD-M source fields are millisecond-only in v1.

Both semantic-event age and knowledge/receipt age are checked. Equality at a
freshness expiry is stale and therefore `UNKNOWN`.

## Result authority

Every receipt is canonical JSON plus LF and is domain-separated SHA-256 bound.
Input ordering cannot change it. The receipt fixes normalized clocks, exact
selected record IDs and payload digests, availability basis/evidence, exact
freshness thresholds, reasons, consumer scope, and `authority="NONE"`.

`VALID` proves only that the supplied, digest-bound evidence satisfies this
clock policy. It does not prove source completeness, exchange authenticity,
clock synchronization, label isolation outside the supplied frame, fee truth,
execution, profitability, or safety.

## Strict JSON entrypoint

The import API is frozen in `PUBLIC_API_V1`. The stdin CLI accepts at most
2 MiB, rejects malformed UTF-8, duplicate keys, nonfinite values, extra keys,
ambiguous units, and invalid scalar types, then emits one canonical receipt:

```sh
PYTHONPATH=src:. python -B -m research.dq13 < decision-frame.json
```

Exit `0` is `VALID`, `2` is `UNKNOWN`, and `3` is `INVALID`.

## Focused proof

From `quant/`, with the exact locked development environment available:

```sh
uv lock --check
PYTHONPATH=src:. PYTHONHASHSEED=0 uv run --locked --no-sync \
  python -B -m pytest -q -p no:cacheprovider research/dq13/test_validator.py
uv run --locked --no-sync ruff format --check research/dq13
uv run --locked --no-sync ruff check research/dq13
MYPYPATH=src:. uv run --locked --no-sync mypy --strict \
  --explicit-package-bases \
  research/dq13/validator.py research/dq13/__init__.py \
  research/dq13/__main__.py research/dq13/fixture_support.py \
  research/dq13/verify.py research/dq13/test_validator.py
PYTHONPATH=src:. PYTHONHASHSEED=1 uv run --locked --no-sync \
  python -B -m research.dq13.verify
PYTHONPATH=src:. PYTHONHASHSEED=987654321 uv run --locked --no-sync \
  python -B -m research.dq13.verify
```

The verifier is read-only and network-free. It removes inherited pytest
addopts/plugins, disables plugin autoload and conftest loading, uses a dedicated
config plus explicit proof plugin, and requires exit zero. The proof binds the
exact executed call-phase count and a deterministic digest of node IDs and
outcomes without binding timing text. It also replays every fixture twice,
checks declared outcomes, checks permutation equivalence, compares exact
known-answer bytes, and binds the validator, hostile fixture, policy, source
research, tests, proof config, package surface, and `quant/uv.lock`.

The full normative policy is [policy.v1.json](policy.v1.json). Current primary
source research and the official/project boundary are in
[REFERENCES.md](REFERENCES.md).
