# S-1G public Basis carry experiment

Status: `PREDECLARED_HOLDOUT_CLOSED`

S-1G tests one public-only BTCUSDT cash-and-carry family: buy Spot and
short the USD-M perpetual when a causal, positive perpetual premium plus a
conservative forecast of future funding clears the complete modeled all-taker
round-trip cost. The maker entry is an observation-only attempt. Because the
public archives do not establish queue position, depth, or fill probability,
the primary model always records `MAKER_NONFILL`, waits exactly 60 seconds,
then executes both entry legs as takers. Every exit is a taker.

This packet is a predeclaration, not a result. No S-1G outcome archive was
downloaded or opened while these files were written.

## Frozen scope

- Instrument: Binance BTCUSDT Spot and BTCUSDT USD-M perpetual.
- Public custody interval: exactly
  `[2020-01-01T00:00:00Z, 2021-02-01T00:00:00Z)`.
- Development custody: 12 monthly product groups from January through December
  2020: exactly 48 ZIP archives plus 48 sibling checksum objects.
- Development scores and walk-forward: 52 half-open UTC weeks, exactly 364
  days, in `[2020-01-01T00:00:00Z, 2020-12-30T00:00:00Z)`. Candidate
  authorization uses continuous-state paths; the diagnostic selection path is
  an executable flat-to-flat weekly switched portfolio that carries realized
  equity, running peak/drawdown stop, and residual cooldown across switches.
- Holdout custody: the separately rooted January 2021 product group: exactly
  four ZIP archives plus four sibling checksums.
- Untouched holdout scores: four half-open UTC weeks in
  `[2021-01-01T00:00:00Z, 2021-01-29T00:00:00Z)`.
- Capital: USD-equivalent $1,000, consisting of a fully funded $400 Spot leg
  and $600 futures collateral supporting an equal-base-quantity, approximately
  $400-notional short. No borrow and no leverage mutation.
- Candidate family: exactly 12 trials, the Cartesian product
  `L ∈ {6, 18}` settled funding observations,
  `H ∈ {1, 3, 7}` calendar days, and
  `buffer ∈ {0, 5}` basis points.

The formal values and the complete trial ledger are in `protocol.v1.json` and
`trial_ledger.v1.json`. `source_plan.v1.json` binds the exact 52
archive/checksum pairs (104 fetched objects), distinct collision-safe paths, fixed
roots, expected members, counts, and a canonical expanded-matrix digest.
Method, accounting, validation, capacity, drawdown, and stop rules are in
`METHODOLOGY.md`.

## Evidence boundary

The study uses checksummed Binance public monthly archives only. It makes no
signed or private request and has no account, order, transfer, withdrawal,
host, provider, UI, or execution authority. Account-effective fees, maker fill
probability, order-book depth, historical symbol filters, and USD/USDT parity
remain `UNKNOWN`.

The 10 bp fee on every venue/fill is a deliberately conservative modeling
proxy, not a claim about the account's current or historical fee tier. Public
one-minute bars can support a causal costed proxy, but they cannot prove an
executable maker fill or account-realized edge.

The final evidence class can be only `HISTORICAL_VALIDATION`. Under this
public-only protocol:

- invalid/missing custody or an unusable holdout is `UNMEASURED`;
- measured nonpositive economics, insufficient sample, failed multiplicity,
  failed PBO, failed stress, excessive drawdown, or insufficient volume-proxy
  capacity is `NO_GO`;
- even a positive proxy is not `GO` while account-effective fees, maker/depth
  truth, and an untouched sealed-forward observation remain unavailable.

The four-week holdout has only one approximate effective block under the
predeclared four-week dependence length. Its 95% bootstrap interval is
descriptive only: a proxy-positive observation remains `UNMEASURED`, while a
measured proxy failure remains `NO_GO`. N3-compatible verified and credible
positive counts remain JSON `null` under global `UNKNOWN`; proxy counts are
reported separately.

## Sources

Official source definitions and access limits are pinned in
`official_sources.v1.json`. Core references include:

- [Binance public archive and checksum specification](https://github.com/binance/binance-public-data/blob/master/README.md?plain=1)
- [Binance USD-M funding-rate history](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#get-funding-rate-history)
- [Binance Spot market-data-only endpoints](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only)
- [Schmeling, Schrimpf, and Todorov, “Crypto Carry”](https://doi.org/10.1287/mnsc.2024.05069)
- [He, Manela, Ross, and von Wachter, “Fundamentals of Perpetual Futures”](https://arxiv.org/abs/2212.06888)
- [Albers et al., “The Market Maker's Dilemma”](https://arxiv.org/abs/2502.18625)

## Authority

These artifacts are research inputs for the owner profitability verdict. They
do not alter the Basis engine, grant capital authority, or authorize live
execution. N3 `…03db` supplies result vocabulary and evidence-gate shape only;
it is not an economic threshold or source authority.
