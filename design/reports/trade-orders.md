# PAGE
ManualTrade + Orders rescue pass for the private Binance cockpit.

# WHAT WAS BROKEN
- Manual Trade had the right safety model, but mode, keys, and live-send lock state were repeated in separate zones instead of summarized where the trader builds the order.
- Disabled ticket controls did not show a full reason chain inline, especially paper mode, missing keys, and preview prerequisites.
- The ticket form was tall and loose; the risk gate was visible, but the immediate next action was not obvious.
- Orders had strong desk content, but locked history/cancel states still looked like ordinary controls in the toolbar.
- The blotter did not show remaining quantity as a first-class execution-history field.
- Empty Orders state did not explicitly say that paper mode is not simulating order rows.

# CHANGES
1. Added a compact Manual Trade mode strip showing paper/live mode, per-order risk cap, daily room, and live-send lock state.
2. Added a ticket review panel that summarizes side, type, symbol, estimated notional, and the next required step before the action buttons.
3. Added a visible action-reason line explaining why Preview, Validate, and Live Send are disabled; muted disabled primary buttons in dark mode.
4. Tightened Manual Trade spacing, inputs, and hero scale so the ticket reads more like a professional order form and less like a marketing page.
5. Added an Orders readiness strip for paper mode, cancel capability, and history source, with locked reasons in the keyless state.
6. Changed the history loader to say "History locked" and "Keys required" when server-side Binance keys are absent.
7. Added a Remaining column to the Orders table for clearer working/history interpretation.
8. Disabled cancel/cancel-all buttons with explicit key-required reasons instead of leaving potentially live-looking controls.
9. Added a paper-mode truth line to the empty blotter: no simulated order rows are fabricated.
10. Flattened Manual Trade and Orders dark-mode surfaces under the trade rescue CSS block to reduce glare and keep separation by hairlines.

# REFERENCES USED
1. [Kraken Pro trading interface guide](https://support.kraken.com/articles/kraken-pro-trading-interface-guide) - borrowed the order form sequence: buy/sell selector, order type, price/quantity fields, quantity slider, account details, order summary, and book-price-to-ticket behavior.
2. [Hyperliquid Order Types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types) - borrowed the explicit order-type/trigger/options discipline so the ticket calls out the next required step instead of implying execution readiness.
3. [Binance Spot trading website guide](https://www.binance.com/en-JP/support/faq/detail/115003765031) - borrowed the spot ticket structure: order type, buy/sell order section, order book context, and open orders/order history grouping.

# FILES TOUCHED
- `web/src/pages/ManualTrade.tsx`
- `web/src/pages/Orders.tsx`
- `web/src/styles.css`
- `design/reports/trade-orders.md`

# GATES RUN + RESULTS
- `npm run build -w web` - PASS.
- `npm test` - PASS, 50/50 gates.
- Render check via Playwright on `http://127.0.0.1:5183/` - PASS for Manual Trade and Orders in light and dark, zero console errors, new state strips present, locked buttons disabled.

# SCREENSHOTS
- Before Manual Trade light: `design/screenshots/2026-07-05-trade-orders-before-manual-light-1440.png`
- Before Manual Trade dark: `design/screenshots/2026-07-05-trade-orders-before-manual-dark-1440.png`
- Before Orders light: `design/screenshots/2026-07-05-trade-orders-before-orders-light-1440.png`
- Before Orders dark: `design/screenshots/2026-07-05-trade-orders-before-orders-dark-1440.png`
- After Manual Trade light: `design/screenshots/2026-07-05-trade-orders-after-manual-light-1440.png`
- After Manual Trade dark: `design/screenshots/2026-07-05-trade-orders-after-manual-dark-1440.png`
- After Orders light: `design/screenshots/2026-07-05-trade-orders-after-orders-light-1440.png`
- After Orders dark: `design/screenshots/2026-07-05-trade-orders-after-orders-dark-1440.png`
- Additional render check Manual Trade light 1920: `design/screenshots/2026-07-05-trade-orders-after-manual-light-1920.png`
- Additional render check Orders dark 1920: `design/screenshots/2026-07-05-trade-orders-after-orders-dark-1920.png`
