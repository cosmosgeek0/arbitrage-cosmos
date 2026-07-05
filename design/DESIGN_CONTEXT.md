# DESIGN CONTEXT — arbitrage (read FIRST, before the loop; this is the destination)

WHAT THIS IS: Cosmos Arbitrage — a PRIVATE real-money Binance trading cockpit for
ONE trader. Paper-mode default, risk gate, kill switch, no withdrawals ever.
Safety laws in this repo's AGENTS.md override every design ambition.

WHO IT IS FOR: the owner, trading real money. Account truth, orders, positions,
PnL, risk posture — readable in one glance, trustworthy, alive.

THE BAR: professional terminal content (Binance pro, Backpack density, TradingView
charts) with 1Password/Apple-grade settings and chrome craft. Numbers are the
heroes; chrome disappears.

CURRENT STATE (honest): strong bones — honest empty states, posture card, ledger,
50 gates. Diseases to kill: billboard display text ("Control room", "No account
data" oversized), dot-soup status lines, 13k-line legacy styles.css with no token
system, settings as a cramped popup, uneven weights, dead static regions.

WHAT "DONE" LOOKS LIKE: token-driven design system, styles.css near zero; every
page reads like a purpose-built trading instrument; settings is a full page with a
left rail; everything wired to the real server API; the owner trusts it with money
partly BECAUSE it looks that disciplined.


## REFERENCE WALL (the owner's exact stack — study these, page by page)
- **TradingView** — market overview, heatmaps, chart workspace, watchlists.
  Heatmaps use size + color to show market data and outliers; that is what our
  heatmap/bubble surfaces learn from.
- **Binance Markets** (binance.com/en/markets/overview) — clean market overview:
  Hot, New, Top Gainer, Top Volume, categories, prices, 24h change. Dark mode is
  FLAT: surfaces separated by spacing, not bordered boxes, no glare.
- **Coinbase Explore** (coinbase.com/explore) — clean prices table: asset, price,
  chart, change, market cap, volume, actions. Hairline row dividers only.
- **Uniswap Explore / Portfolio** (app.uniswap.org) — separates tokens, pools,
  transactions; real-time prices, volume, TVL, charts. Borderless dark surfaces.
- **CoinGlass** — derivatives analytics: open interest, funding rates,
  liquidation heatmaps, options/spot/derivatives data.
- **Coinalyze** — futures analytics: OI, funding, liquidations, long/short
  ratio, basis, futures statistics.
- **DeFiLlama** — TVL, fees, revenue, volume, yields, stablecoins, protocols,
  chains.
- **CoinGecko** — market/prices data source (simple price + coins/markets
  endpoints).
- **Pyth Terminal** — clean price-feed catalogue across crypto, equities, FX,
  commodities.
- **Kraken Pro / Kraken Desktop** — serious trading interface: active-trader
  layout, multi-window market surfaces.
- **Hyperliquid** — trading venue reference for perp/spot markets and clean
  trading surfaces.

## DARK-MODE LAW (owner feedback, 2026-07-05)
No Apple-glass glare in dark mode: no specular rims, no inner light highlights,
no glowing borders. Dark mode = flat calm surfaces the way Binance/Coinbase/
Uniswap do it: separation by spacing and faint hairlines, tables unboxed, no
boxes-inside-boxes, no bubble/pill word-chips in the chrome.
## RESCUE RULES
Dead UI is the enemy: dashes, duplicate status chips, giant empty panels are bugs.
Missing data = compact honest chip. Pages rescued whole, one per run, queue order.
