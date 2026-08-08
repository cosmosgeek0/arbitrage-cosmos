# S-2K current official-source research

Checked 2026-07-30 before implementation.

- Binance's official public-data repository says `data.binance.vision` exposes
  daily and monthly public archives, Spot klines derive from `/api/v3/klines`,
  every ZIP has an adjacent `.CHECKSUM`, and archives may later be replaced.
  Therefore S-2K freezes local ZIP bytes, checksum-sidecar bytes, hashes, sizes,
  retrieval timestamps, and response metadata rather than treating URLs as
  immutable.
- Binance documents the twelve Spot kline columns used here: open time, OHLC,
  base volume, close time, quote volume, trade count, taker-buy base volume,
  taker-buy quote volume, and ignore.
- Binance states that Spot archive timestamps from 2025-01-01 onward are
  microseconds. Every S-2K archive is therefore required to use declared
  microseconds; magnitude-based silent inference is forbidden.
- Binance directs public-only REST clients to `data-api.binance.vision`.
  `exchangeInfo` is current state, not a historical eligibility snapshot, and
  is not used to select or validate the S-2K historical cohort.
- Binance's public fee table showed Regular Spot maker/taker at 0.100%/0.100%.
  The commission FAQ states that actual commission can include standard,
  special, tax, buyer/seller, and discount effects and that exact rates are
  account-specific. S-2K therefore uses 10 bp per fill only as a public
  no-BNB proxy and leaves account-effective fees `UNKNOWN`.
- Binance Spot is separate from Margin borrow/repay functionality. A synthetic
  negative Spot weight does not prove borrow availability, rate, collateral,
  or liquidation feasibility.

Pinned official repository tips at research time:

- `binance/binance-public-data` master:
  `5c7f3197591c0d54d85dc43066226bc4c671d47a`
- `binance/binance-spot-api-docs` master:
  `6b8372cad7cecbdf5dd88a3372eafff51988c5cf`

Primary methodology sources:

- Amaya, Christoffersen, Jacobs, and Vasquez (2015), negative next-period
  realized-skewness cross-sectional effect,
  <https://doi.org/10.1016/j.jfineco.2015.02.009>.
- Jia, Liu, and Yan (2021), negative next-day skewness predictability in a
  cryptocurrency cross-section using intraday moments,
  <https://doi.org/10.1016/j.frl.2020.101536>.
- Holm (1979), family-wise multiplicity,
  <https://doi.org/10.2307/4615733>.
- White (2000), dependence-aware data-snooping reality check,
  <https://doi.org/10.1111/1468-0262.00152>.
- Politis and Romano (1994), stationary/block bootstrap,
  <https://doi.org/10.1080/01621459.1994.10476870>.
- Bailey, Borwein, Lopez de Prado, and Zhu (2017), CSCV/PBO,
  <https://doi.org/10.21314/JCF.2016.322>.
