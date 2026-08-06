# V-G3 official public-source perimeter

Frozen on 2026-07-29 UTC before any outcome archive was decompressed.

## Accepted sources

- [Binance Spot market-data-only endpoints](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/faqs/market_data_only.md)
  document that `data-api.binance.vision` is public and does not require
  authentication. V-G3 does not call a signed or private endpoint.
- [Binance public-data archive contract](https://github.com/binance/binance-public-data/blob/5c7f3197591c0d54d85dc43066226bc4c671d47a/README.md)
  documents daily and monthly Spot kline archives, all supported kline intervals,
  SHA-256 `.CHECKSUM` sidecars, the 2025-01-01 Spot timestamp transition to
  microseconds, and the fact that Binance may replace archive files after finding
  an issue.
- [Binance Spot kline endpoint documentation](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/rest-api.md#klinecandlestick-data)
  defines kline open time as the unique row identity and identifies the close,
  high, low, base volume, quote volume, trade count, and taker-buy volume fields.
- [Binance Spot filter documentation](https://github.com/binance/binance-spot-api-docs/blob/6b8372cad7cecbdf5dd88a3372eafff51988c5cf/filters.md)
  defines `LOT_SIZE`, `MARKET_LOT_SIZE`, `MIN_NOTIONAL`, and `NOTIONAL`. Only
  current filters are public through `exchangeInfo`; the reviewed official sources
  did not expose a historical filter-snapshot archive.
- [Binance Spot trading-fee schedule](https://www.binance.com/en/fee/trading)
  displayed Regular User Spot maker/taker fees of 0.100%/0.100% on 2026-07-29.
  The displayed 0.075% BNB-payment rate is not used because V-G3 has no evidence
  that the discount would apply.

## Frozen interpretation

The archive and checksum sidecar are both fetched. The downloaded ZIP SHA-256 must
equal the sidecar value, and the result binds the exact verified byte identities.
`source-receipts.v1.json` additionally binds the bytes fetched from the two
commit-pinned official documentation repositories. Binance's rendered fee row is
a manual transcription from the OpenAI web reader, not publisher-response bytes,
because the raw fee-page response was empty behind its anti-bot boundary. The
attestation explicitly records that limitation, evidence class, transport, and
reader line used.
Outcome ZIPs may be downloaded and hashed before their partition opens, but their
members may not be listed, decompressed, parsed, or inspected before the applicable
one-use marker.

The 10 basis-point-per-fill Regular User row is a nominal public scenario, not
account truth or a conservative upper bound. Account-effective standard, special,
tax, buyer, seller, VIP, BNB, and promotion rates remain `UNKNOWN`. Historical
order-book depth, spread, queue position, realized slippage, and historical
filters also remain `UNKNOWN`.

V-G3 therefore estimates a public historical research rule under checksum-bound
prices, adverse public-kline execution windows, and a nominal public fee
attestation. The result distinguishes quote-valued transaction-time commission
from terminal PnL drag. It cannot prove executable account profit or authorize
capital.

## Primary method references

- White, *A Reality Check for Data Snooping*,
  [Econometrica (2000)](https://doi.org/10.1111/1468-0262.00152), motivates the
  synchronized familywise test over the complete trial family.
- Romano and Wolf, *Stepwise Multiple Testing as Formalized Data Snooping*,
  [Econometrica (2005)](https://doi.org/10.1111/j.1468-0262.2005.00615.x),
  supports dependence-aware max-statistic correction.
- Bailey et al., *The Probability of Backtest Overfitting*,
  [CSCV/PBO paper](https://escholarship.org/uc/item/4w1110bb), is used only for
  the frozen diagnostic. PBO is not treated as a p-value or allowed to rescue a
  failed multiplicity gate.
- Cawley and Talbot, *On Over-fitting in Model Selection and Subsequent
  Selection Bias in Performance Evaluation*,
  [JMLR (2010)](https://www.jmlr.org/papers/v11/cawley10a.html), motivates the
  expanding walk-forward separation between parameter selection and validation.

## Sources deliberately rejected

- Current `exchangeInfo` is not used to construct a past universe or certify past
  eligibility.
- Third-party symbol histories, fee tables, market-cap lists, and reconstructed
  order books are not accepted.
- Private commission endpoints, account data, API keys, orders, fills, and balances
  are outside scope.
- The BNB fee discount, a VIP tier, a promotion, rebates, and zero slippage are not
  assumed.
