# S-2A — USD-M idiosyncratic one-hour reversal

S-2A is one sealed, Binance-public-only research packet. It asks whether an
extreme one-hour return that remains after a causal BTC market-factor fit
reverses over the next two, four, or eight hours when the contract's preceding
hour already showed elevated quote volume.

The strategy is not a pair-spread study, funding strategy, price continuation
study, or Spot liquidity-shock study. It trades one negative-residual USD-M
contract, one positive-residual USD-M contract, and an aggregate BTC USD-M
factor hedge. The frozen weights have zero estimated BTC-return beta and gross
notional of exactly one. The two idiosyncratic legs are symmetric and the BTC
hedge is mechanical.

## Frozen question

For each fully closed UTC hour:

1. Fit each non-BTC contract's intercept and BTC beta on the previous 336
   hourly returns, excluding the signal hour.
2. Standardize the signal-hour residual by the fitted window's residual
   standard deviation.
3. Confirm each tail only when its immediately preceding completed hour's
   quote volume is above a threshold relative to the earlier 168-hour median.
   The confirmation hour and its baseline both precede the residual-return
   hour.
4. Select the most negative and most positive qualifying residuals, reject
   boundary ties, add the mechanical BTC factor hedge, normalize gross
   notional to one, and enter at the next UTC-hour open.
5. Exit at the exact open two, four, or eight hours later. A trial ignores new
   signals while its prior cohort remains open. Entry and exit must remain on
   one UTC day, preventing an accepted label from crossing a daily or CSCV
   block boundary.

The 12 predeclared trials are:

- absolute residual z threshold: 1.5 or 2.0;
- lagged quote-volume multiple: 1.25 or 1.5;
- hold: 2, 4, or 8 hours.

## Fixed custody

- Study window: `2025-07-01T00:00:00Z` through
  `2026-07-01T00:00:00Z`.
- Development: first nine months, ending `2026-04-01T00:00:00Z`.
- Sealed holdout: final three months. Its bodies are not requested, hashed,
  decompressed, or parsed unless every development gate passes.
- Fixed factor: `BTCUSDT`.
- Fixed idiosyncratic cohort: `ETHUSDT`, `BNBUSDT`, `XRPUSDT`, `ADAUSDT`,
  `DOGEUSDT`, `SOLUSDT`, `TRXUSDT`, `LTCUSDT`, `BCHUSDT`, `LINKUSDT`,
  `AVAXUSDT`.
- No retrospective substitution, current-volume ranking, or post-outcome
  universe change is allowed.
- Raw custody is outside Git at an explicit operator path.
- The external `RUN_CONSUMED.v1.json` marker is atomically published first,
  followed by the packet start marker, before the first archive body request.
  Any later failure consumes the sole run.
- Every fixed symbol/month binds three checksum-verified public archives:
  standard `klines` for signal prices and lagged quote volume,
  `markPriceKlines` for funding-time mark notional, and `fundingRate` for the
  observed rate and schedule.

The exact signal, clock, cost, inference, custody, and verdict laws are in
[`protocol.v1.json`](protocol.v1.json). Current official-source research is in
[`OFFICIAL_SOURCE_RESEARCH.md`](OFFICIAL_SOURCE_RESEARCH.md), and the complete
S-1/V-G comparison is summarized in [`DISTINCTNESS.md`](DISTINCTNESS.md).

## Public cost and capacity disclosure

The gross series includes observed public funding rows and no fee or adverse
execution charge. Funding uses fixed contract quantity and the official hourly
mark-price open at each canonicalized funding hour. The checksum-bound funding
archive does not carry the exact settlement mark, so this remains a named
hourly proxy. Publisher funding timestamps are rounded to their nearest UTC
hour only within a frozen one-second tolerance. Every row for a symbol must
declare one unchanged interval and every canonical gap must equal it; an
interval transition is treated as ambiguous and terminal `UNMEASURED`.

Base uses a 5 bp public fee proxy plus 5 bp adverse execution per fill; stress
uses 8+10 bp; severe uses 10+20 bp. Entry and exit notional are both charged.
These are public research proxies, not the account's effective commission,
discounts, spread, slippage, latency, queue, impact, or fill probability.

Capacity is only a one-basis-point participation proxy from the lagged
confirmation-hour quote volume of every nonzero leg. It is not executable
capacity. Capital authority remains `NO_GO` while account-effective fees and
live execution evidence are unknown, even if the public research verdict is
`GO`.

## Commands

From `quant/`, before the sealed run:

```sh
PYTHONPATH=. /Users/cosmosgeek/.local/bin/uv run --frozen pytest -q \
  research/s2a/test_experiment.py research/s2a/test_verifier.py
/Users/cosmosgeek/.local/bin/uv run --frozen ruff check research/s2a
/Users/cosmosgeek/.local/bin/uv run --frozen ruff format --check research/s2a
MYPYPATH=. /Users/cosmosgeek/.local/bin/uv run --frozen mypy --strict \
  --explicit-package-bases research/s2a/experiment.py \
  research/s2a/verifier.py
```

After committing the frozen packet, invoke exactly once:

```sh
PYTHONPATH=. /Users/cosmosgeek/.local/bin/uv run --frozen python \
  research/s2a/experiment.py \
  --raw-root /private/tmp/cosmos-s2a-idio-reversal-v1 \
  --freeze-commit <exact-clean-freeze-commit>
```

After the result:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. \
  /Users/cosmosgeek/.local/bin/uv run --frozen python -B \
  research/s2a/verifier.py \
  --raw-root /private/tmp/cosmos-s2a-idio-reversal-v1
(cd research/s2a && shasum -a 256 -c SHA256SUMS)
```

No command places, cancels, or simulates an order. The packet uses no
credential, private endpoint, provider, host, UI, transfer, withdrawal, or
canonical-branch mutation.
