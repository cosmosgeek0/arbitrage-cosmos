# S-1P official-source freeze

Retrieved at `2026-07-29T16:14:26Z`. Only current, public, official Binance
documentation and Binance-owned public-data repositories were used. No account,
signed, private, order, test-order, host, UI, transfer, withdrawal, or money
endpoint was called.

## Frozen source contracts

1. **Historical public archives and checksums**
   - Authority: <https://data.binance.vision/>
   - Pinned specification:
     <https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md>
   - Pinned official downloader utility:
     <https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/python/utility.py>
   - Binance publishes Spot and USD-M daily/monthly ZIP archives with adjacent
     `.CHECKSUM` SHA-256 sidecars. Archives can later be replaced after a data
     issue, so S-1P binds every URL, sidecar hash, and ZIP hash rather than
     treating a URL as immutable.
   - Spot archive timestamps from 2025-01-01 onward are microseconds. USD-M
     timestamps remain documented in milliseconds. The evaluator must normalize
     these units explicitly and reject timestamps outside the frozen sample.

2. **Spot klines**
   - Current REST contract:
     <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market#kline-candlestick-data>
   - Public endpoint: `GET /api/v3/klines`, security type `NONE`.
   - The tuple identifies a kline by open time and defines open/high/low/close,
     base volume, close time, quote-asset volume, trade count, taker-buy base
     volume, and taker-buy quote volume. S-1P uses only open, close, and
     quote-asset volume. Trade count and taker-buy fields are forbidden signal
     inputs.
   - Default limit is 500 and maximum is 1000. Evaluation is network-free and
     uses checksum-bound archives, not live pagination.

3. **USD-M perpetual klines, mark price, and funding**
   - Current consolidated public market-data contract:
     <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data>
   - Public standard kline endpoint: `GET /fapi/v1/klines`; its first eleven
     defined fields align with the Spot kline tuple, and S-1P again uses only
     open, close, and quote-asset volume.
   - Public mark-price klines are used only to value an actual funding settlement.
     Mark, index, or premium series are forbidden from the signal.
   - Public funding history is used only to book realized funding during a held
     short-perpetual leg. Funding rate, funding sign, funding forecast,
     next-funding time, and settlement clock are forbidden from signal,
     selection, entry, exit, and parameter choice.
   - The public-data README does not publish a normative funding-archive CSV
     table. S-1P therefore freezes its accepted parser contract narrowly as
     exactly `calc_time,funding_interval_hours,last_funding_rate`, requires
     nonempty on-hour rows and requires leading, trailing, and internal
     coverage gaps not exceed the applicable declared interval. Because no
     normative transition law is frozen, any within-month interval change is
     also terminal `UNMEASURED`. S-1P never guesses a column or silently treats
     absent funding as zero.

4. **Dynamic exchange filters**
   - Spot exchange information and filters:
     <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/general-endpoints#exchange-information>
     and
     <https://developers.binance.com/en/docs/binance-spot-api-docs/filters>
   - USD-M exchange information and filter definitions:
     <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#exchange-information>
     and
     <https://developers.binance.com/en/docs/derivatives/usds-margined-futures/common-definition>
   - Current exchange information is not a historical symbol/filter snapshot.
     Historical `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL`/`NOTIONAL`, status,
     and contract-state continuity are therefore unavailable. S-1P reports only
     a quote-volume participation proxy; executable capacity remains
     `UNMEASURED`.

5. **Commissions are private account truth**
   - Spot commission FAQ:
     <https://developers.binance.com/en/docs/products/spot/faqs/commission_faq>
   - Spot account commission endpoint:
     <https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account#account-commission-rates-user_data>
   - USD-M user commission endpoint:
     <https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account#user-commission-rate>
   - Binance states that commission examples are fictional and that promotions
     and discounts can alter standard rates. Both actual commission endpoints are
     signed `USER_DATA`. S-1P makes no signed request, so Spot and USD-M
     account-effective fees, taxes, discounts, and historical promotion state are
     `UNKNOWN`. The frozen 10/5 bps and stressed alternatives are explicit
     research proxies only.

## Frozen archive reuse boundary

S-1P may read only:

- `/private/tmp/cosmos-s1h-btc-eth-rv-basis-v1/DISCOVERY.v1.json`
- the exact checksum-addressed ZIP files referenced by that discovery under
  `/private/tmp/cosmos-s1h-btc-eth-rv-basis-v1/archives/`

The discovery SHA-256 is
`5fd5924a63fd31c08378002e3d508d6de5d895383c3322ce3cd82caad35b1c0f`.
All shared files are read-only. S-1P must never read sibling result, candidate,
run-marker, acquisition, or freeze artifacts. Development ZIP members may be
opened only after S-1P consumes its sole run marker. Holdout ZIP members may be
opened only after S-1P seals a development champion and writes its holdout-open
marker.

## Frozen hypothesis meaning

“Lead” in S-1P means strict event order: a same-bar USD-M-minus-Spot
seasonally adjusted quote-volume **intensity** event must occur first, and a new
own-symbol positive normal-basis crossing must occur one to six completed bars
later. It does not claim that USD-M volume predicts future Spot volume. It does
not trade a volume-leadership spread, a cross-symbol volume rank, or a
directional return. The volume event only arms the later, paired own-basis
reversion setup.

Before any archive member may open, S-1P must compare the final V-G9 protocol.
If V-G9 also requires the same later own-symbol basis crossing and the same
paired basis-reversion trade, S-1P stops `UNMEASURED` without opening data.

## Exact limitations

- Public archives do not provide historical executable bid/ask depth, queue
  position, latency, impact, borrow/margin state, or historical exchange-filter
  snapshots.
- Archive cadence is documented, but immutability, complete retention, and
  first-available history are not guaranteed.
- No sanitized account evidence is in this scope. Account-effective Spot and
  USD-M commissions remain `UNKNOWN`.
- USDT is treated as USD at a frozen 1:1 reporting proxy; depeg and conversion
  risk are not measured.
- A positive public proxy cannot authorize capital or establish account-effective
  profitability. It is capped at `UNMEASURED`; capital verdict remains `NO_GO`.
