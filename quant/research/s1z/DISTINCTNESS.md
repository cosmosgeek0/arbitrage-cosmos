# S-1Z material-distinctness record

The S-1A through S-1Y and V-G1 through V-G38 protocol/result families were compared
before this worktree was created.

S-1Z is frozen as `USD_M_REGULAR_KLINE_TWO_FACTOR_RESIDUAL_PRICE_CONTINUATION`.
Its only ranking input is lagged, standardized USD-M contract-return residuals versus
BTCUSDT and ETHUSDT. It trades a projected dollar/BTC/ETH-beta-neutral long-winner,
short-loser USD-M portfolio and books settled funding only as P&L.

Nearest existing families are materially different:

- S-1F is raw Spot weekly momentum and long/cash.
- S-1I is Premium Index residual mean reversion controlled for funding.
- S-1H and S-1Y are pair/basis residual mean reversion.
- S-1D, S-1N, and S-1V rank funding levels or funding innovations.
- V-G3 is Spot negative-return residual mean reversion and long/cash.
- V-G21 and V-G24 residualize volume, not price returns.
- V-G9 reads USD-M volume but positions a long-Spot portfolio.

Hard collision rule: any earlier protocol found to rank residualized USD-M regular
contract returns in the continuation direction and form a two-sided neutral portfolio
would stop S-1Z before outcome access. No such protocol was found.

Funding, Premium Index, basis, open interest, volume, and order-flow fields are
forbidden from signal selection. Quote volume is used only for a public capacity
proxy.
