# S-1R official-source research — frozen 2026-07-29

Research was completed before implementation. The experiment uses only public
Binance archive data and current Binance-owned documentation for field and
custody semantics.

## Canonical sources

- Binance public-data README:
  <https://github.com/binance/binance-public-data/blob/master/README.md>
- Binance public archive root:
  <https://data.binance.vision/>
- Current USD-M public market-data reference:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
- Current Spot REST reference:
  <https://developers.binance.com/en/docs/products/spot/rest-api>
- Binance trading-fee page:
  <https://www.binance.com/en/fee/trading>
- USD-M account commission endpoint, cited only to prove that exact account
  commission is private account data:
  <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate>

The archive README states that daily/monthly ZIPs have adjacent checksum files,
that archived files can later be updated, and that Spot archive timestamps from
2025-01-01 use microseconds. USD-M archive timestamps in this packet use
milliseconds. S-1R therefore normalizes Spot timestamps exactly and stops on an
ambiguous or mixed unit.

The monthly funding archive schema in the frozen files is
`calc_time,funding_interval_hours,last_funding_rate`. The current REST response
adds fields such as `fundingTime`, `fundingRate`, `markPrice`, and `rateType`;
those current-response fields are not retroactively invented for archive rows.
Each archived interval is used as published rather than assuming eight hours.

## Causal boundary

The signal uses the current settled row and strictly prior settled rows only.
Entry is the first common traded Spot/USD-M five-minute open strictly later than
`calc_time + 60 seconds`. This proves event-time ordering in the archive.

Binance does not publish a historical record-receipt timestamp or a historical
publication-latency distribution for each funding row. The fixed delay is
therefore a conservative research convention, not proof that a live consumer
could observe the settled row before the selected open. `publicationLatency`
remains `UNMEASURED` and blocks execution/capital authority.

Spot and USD-M traded klines are price/turnover proxies, not bid/ask quotes,
depth, atomic paired fills, queue position, or filter-valid order receipts.
Capacity derived from prior complete quote volume is a public participation
proxy only. Executable capacity remains `UNMEASURED`.

## Cost truth

The primary schedules apply explicit public proxies to all four fills. Exact
historical/account-effective Spot and USD-M commissions, promotions, discounts,
taxes, and regional differences are `UNKNOWN`. Maker results are sensitivity
only because fill probability and adverse selection are not measured.

## Research context

The economic framing is consistent with:

- He, Manela, Ross, and von Wachter, *Fundamentals of Perpetual Futures*:
  <https://arxiv.org/abs/2212.06888>
- Bailey et al., *The Probability of Backtest Overfitting*:
  <https://papers.ssrn.com/sol3/Papers.cfm?abstract_id=2326253>
- White, *A Reality Check for Data Snooping*:
  <https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-0262.00152>

These references motivate testing; they do not supply Binance source truth or
override the packet's measured result.
