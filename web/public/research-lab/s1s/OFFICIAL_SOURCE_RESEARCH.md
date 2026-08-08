# Current official-source research

Research was completed before evaluator construction on 2026-07-29.

## Binance USD-M funding mechanics

Official funding FAQ:

<https://www.binance.com/en/support/faq/detail/360033525031>

- Default settlements are at 00:00, 08:00, and 16:00 UTC, but Binance may
  adjust funding intervals.
- A position is liable only when open at the funding time.
- The actual funding transaction can deviate by about 15 seconds.
- The displayed funding rate before settlement is an estimate built from
  Premium Index observations; it is not the future settled archive row.
- Binance documents automatic interval changes and may expose them after the
  preceding settlement without a separate historical announcement record.

These facts prohibit both a universal fixed-eight-hour backtest and use of the
target event's realized funding row as a pre-event feature.

## Public market-data endpoints

Funding-rate history:

<https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History>

The endpoint exposes settled `fundingTime`, `fundingRate`, associated
`markPrice`, and `rateType`. It does not expose the historical time at which the
next schedule became visible.

Current funding information:

<https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-Info>

The endpoint exposes current adjusted cap, floor, and interval information. It
has no historical/as-of query and therefore cannot validate a 2025 or early
2026 pre-entry schedule.

Current mark-price/premium snapshot:

<https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price>

The current snapshot includes `nextFundingTime`, but it cannot be queried for a
historical timestamp. A new prospective capture could satisfy the missing S-1S
input; a current call cannot repair the sealed historical experiment.

## Public archives

Official public-data repository:

<https://github.com/binance/binance-public-data/blob/master/README.md?plain=1>

The repository documents `data.binance.vision`, adjacent checksum files, and
the possibility that archive files are later replaced. S-1S binds every reused
archive by the official discovery manifest and SHA-256 without opening a CSV
member during preparation.

The monthly USD-M funding archive schema observed in the official corpus is:

```text
calc_time,funding_interval_hours,last_funding_rate
```

Those are realized settlement records. The interval column does not prove the
historical publication time of the next schedule or preserve the missing
`nextFundingTime` snapshot.

## Fee and capacity limits

The account commission endpoint is signed `USER_DATA`; its documentation
examples are not owner fee truth:

<https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/User-Commission-Rate>

The logged-out futures fee page does not provide an account-effective rate:

<https://www.binance.com/en/fee/futureFee>

Accordingly, protocol fees are sensitivities only. Kline quote volume is a
coarse public participation proxy, not historical spread, order-book depth,
fill probability, queue position, or impact.

## Causal conclusion

No historical `nextFundingTime` or as-of `/fundingInfo` corpus exists in the
searched shared public archives. Exact event alignment is therefore missing
before any outcome access. The only truthful terminal state is:

```text
RESEARCH_VERDICT=UNMEASURED
CAPITAL_DISPOSITION=NO_GO
EXECUTION_AUTHORITY=NONE
```

Realized settlement timestamps are retained as future outcomes and are not
repurposed as pre-settlement knowledge.
