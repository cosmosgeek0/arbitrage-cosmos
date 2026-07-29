# S-1U — USD-M settlement-anchored lagged taker-buy imbalance

S-1U is one sealed, Binance-public-only research packet. It asks whether a
strictly lagged cross-sectional USD-M taker-buy imbalance has a short
contrarian response after an observed USD-M funding settlement.

This is not a funding-carry strategy. Funding value, sign, rank, acceleration,
premium, basis, open interest, Spot data, and future settlement schedules do
not select direction. The published funding row supplies only the event clock.
The event funding cash flow is not booked.

## Frozen question

At a common observed settlement of the six fixed USD-M contracts, rank each
contract by taker-buy quote imbalance from fully closed five-minute bars ending
at least five minutes before its actual settlement timestamp. Long the two
lowest-imbalance contracts and short the two highest-imbalance contracts,
equal-dollar and market-neutral. Enter at the frozen UTC grid open at least four
minutes after every selected contract's observed settlement and exit after the
frozen short horizon. The candidate denominator is the union of published
settlement buckets across the fixed universe: a missing, duplicate, or
over-deviation member remains a candidate and makes the entire cohort exactly
cash. The same all-cash law applies to any invalid bar, boundary, prior day, or
later-settlement guard.

The nine predeclared trials are:

- lag: 30, 60, or 180 minutes;
- response horizon: 15, 30, or 45 minutes;
- direction: contrarian only;
- tail size: two contracts per side.

## Fixed custody

- Point-in-time study window: `2025-07-01T00:00:00Z` through
  `2026-07-01T00:00:00Z`.
- Development: first nine months, ending `2026-04-01T00:00:00Z`.
- Sealed holdout: final three months. Its bodies are not requested, hashed,
  decompressed, or parsed unless every development gate passes.
- Fixed universe: `BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `SOLUSDT`, `XRPUSDT`,
  `DOGEUSDT`.
- Prehistory: June 2025, used only for lag and prior-UTC-day evidence at the
  first development boundary.
- Raw custody root: supplied explicitly at the one allowed invocation and kept
  outside Git.
- The external `RUN_CONSUMED.v1.json` marker is created before the first source
  body is requested. A second invocation refuses.

The binding definitions and gates are in
[`protocol.v1.json`](protocol.v1.json). The official-source research record is
[`OFFICIAL_SOURCE_RESEARCH.md`](OFFICIAL_SOURCE_RESEARCH.md), and the exact
S-1C through S-1T separation is recorded in
[`DISTINCTNESS.md`](DISTINCTNESS.md).

## Frozen public cost and capacity disclosures

Every entry and exit is modeled as taker. The base proxy is 5 bp public fee plus
2 bp adverse execution per fill; stress is 8+5 bp; severe is 10+10 bp. These
are public research proxies, not the account's effective commission, discount,
spread, slippage, depth, latency, fill probability, or impact.

The capacity statistic is only a prior-complete-UTC-day quote-volume proxy at
one basis point of participation. It is not executable capacity. Capital
authorization remains `NO_GO` while private account-effective fees and
execution evidence are unknown, even if public-proxy statistical gates pass.

## Commands

From `quant/`, before the sealed run:

```sh
PYTHONPATH=. /Users/cosmosgeek/.local/bin/uv run --frozen pytest -q \
  research/s1u/test_experiment.py research/s1u/test_verifier.py
/Users/cosmosgeek/.local/bin/uv run --frozen ruff check research/s1u
/Users/cosmosgeek/.local/bin/uv run --frozen ruff format --check research/s1u
MYPYPATH=. /Users/cosmosgeek/.local/bin/uv run --frozen mypy --strict \
  --explicit-package-bases research/s1u/experiment.py \
  research/s1u/verifier.py
```

The operator then commits the frozen packet and invokes exactly once:

```sh
PYTHONPATH=. /Users/cosmosgeek/.local/bin/uv run --frozen python \
  research/s1u/experiment.py \
  --raw-root /private/tmp/cosmos-s1u-funding-imbalance-v1 \
  --freeze-commit <exact-clean-freeze-commit>
```

After the result is created:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. \
  /Users/cosmosgeek/.local/bin/uv run --frozen python -B \
  research/s1u/verifier.py \
  --raw-root /private/tmp/cosmos-s1u-funding-imbalance-v1
(cd research/s1u && shasum -a 256 -c SHA256SUMS)
```

No command in this packet places, cancels, or simulates an exchange order. It
does not use credentials, private endpoints, providers, cloud hosts, transfers,
withdrawals, UI, or canonical-branch mutation.
