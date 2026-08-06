# V-G6 official-source research freeze

Retrieved 2026-07-29 before evaluator implementation and before any outcome
archive member was opened.

## Public market data

Binance's official public-data repository documents the Spot archive layout,
the companion `.CHECKSUM` files, and the 12-field kline schema. It also warns
that archive files can later be replaced, so V-G6 freezes the exact local ZIP
and sidecar SHA-256 digests before outcomes. Spot archive timestamps from
2025-01-01 onward are microseconds.

- Specification:
  https://github.com/binance/binance-public-data/blob/master/README.md?plain=1
- Public market-data-only REST endpoint:
  https://developers.binance.com/en/docs/products/spot/faqs/market_data_only
- Spot REST rules:
  https://developers.binance.com/en/docs/products/spot/rest-api

The current `exchangeInfo` snapshot is not used to construct or backfill the
historical universe because that would introduce point-in-time survivorship.
The universe instead comes from the checksum-bound archive listing observed
before the measurement period.

## Public fee truth

The current regular Binance.com Spot maker/taker schedule is 0.10% per fill
for the base public scenario. That is 10 basis points per fill and
approximately $2 per $1,000 constant-notional round trip before price movement.

- Official fee table: https://www.binance.com/en/fee/trading
- Official commission fields and account/symbol variability:
  https://developers.binance.com/en/docs/products/spot/faqs/commission_faq
- Official BNB fee-discount conditions:
  https://www.binance.com/en/support/faq/detail/115000583311

V-G6 does not assume VIP status, BNB opt-in, sufficient BNB, promotions, tax
rules, or symbol-specific discounts. Account-effective fees therefore remain
`UNKNOWN`. The 20-basis-point-per-fill fee stress is a declared synthetic
research stress, not a claim that Binance publishes that as the user's tier.

Daily klines do not measure spread, queue position, fill probability, market
impact, or historical executable depth. The 5/10-basis-point adverse-price
assumptions and the one-basis-point quote-volume capacity proxy are synthetic
sensitivity laws. Actual execution costs and executable capacity remain
`UNMEASURED`.

## Frozen local byte source

- Read-only root:
  `/private/tmp/cosmos-s1f-weekly-momentum-cash-v1`
- Discovery SHA-256:
  `b4a8f7abd36df19eff0510dfcc3c61fd0df9fdcab5f4d248892ee10010fb21c3`
- Acquisition-manifest SHA-256:
  `01f58272602e43bfb914b649adc00d8273b2d423492220a55f86443bb6441176`

V-G6 verifies each admitted ZIP against both its frozen acquisition-manifest
digest and the official checksum sidecar before decompression. The shared root
is never mutated.
