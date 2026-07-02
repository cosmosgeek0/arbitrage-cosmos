# AGENTS.md — read this fully before touching anything

You are working on **Cosmos Arbitrage Control Room**. This file is the single
source of truth for how to work here. Read it every session. It fits in your
context on purpose — do not skip it. `CLAUDE.md` and `ARCHITECTURE.md` hold
deeper detail; this file is the operating manual.

---

## 1. What this is (the purpose — never lose this)

A **private, single-owner Binance trading cockpit**. Real money. The owner
starts with ~$10 live and grows it by manually approving spot/perp basis and
funding trades. It sits behind Cloudflare Access (YubiKey + email). It is:

- **NOT** a public product, market website, Bitcoin-chart homepage, or token wall.
- **NOT** CG Signal Lab (that is the owner's *separate public* dashboard — you may
  study its design *quality* as a donor, never copy its public-dashboard nature).
- **NOT** a Hyperliquid/Binance clone.

It **IS** an account cockpit: watch balances, see what strategies propose, approve
manually, send live orders through a hard risk gate, and audit every decision.

The homepage is the **account control room** (equity, PnL, orders, fills,
strategy state, manual trade, risk, kill switch, event log). Never a market chart.

---

## 2. Non-negotiables (breaking any of these is a failure)

1. **No withdrawals or transfers-out. Ever.** No such code, no such UI, no such
   API method — not in `web/`, not in `server/`. `binance/client.ts` has no
   withdraw/transfer method by design. Keep it that way.
2. **API keys are server-only.** Read from env / `.env` on the server. Never in
   the frontend bundle, never in git, never logged. There is deliberately no key
   input field in the UI. `.env` is gitignored (`.env.example` is the template).
3. **The risk gate sits before every live order.** `services/risk.ts` →
   `evaluate(intent, ctx, {forLiveSend:true})` must pass before `orders.ts`
   calls Binance. No code path may place an order without it. No exceptions "for
   testing".
4. **Live send requires ALL of:** kill switch off + live trading armed + symbol
   on the allowlist + typed-symbol confirmation + server-side re-check. Never
   weaken this chain.
5. **Kill switch is instant and always reachable** (top bar). It gates every send.
6. **Everything is ledgered.** Signals, risk decisions, order intents/requests/
   responses, fills, manual actions, config changes, errors. If it isn't in the
   ledger, it didn't happen.
7. **Run `npm test` (48 gates) before considering any change done.** It boots an
   isolated instance and asserts these invariants. If it fails, you broke
   something — fix it, don't push.
8. **Verify UI changes in the browser preview** (both light and dark, no console
   errors) before committing. Do not claim a visual change works from code alone.

---

## 3. Stack & how to run

- npm workspaces. `server/` = Node 22 + TypeScript (ESM, express, ws,
  better-sqlite3). `web/` = React 18 + Vite. One backend process serves the API,
  the WebSocket, and the built `web/dist` on port 8080.
- **Node lives at `~/.local/node22/bin`** (this machine had no toolchain). Export
  it: `export PATH="$HOME/.local/node22/bin:$PATH"`.

```bash
npm install
npm run build           # builds server then web
npm start               # http://localhost:8080  (PORT env to change)
npm test                # 48 gate tests — MUST pass
npm run build -w web    # web only (fast iteration)
npm run build -w server # server only
```

- Preview verification: the harness has a browser preview on :8080. After a web
  build, reload it, screenshot in light AND dark, check console for errors,
  click through the changed page. Never skip this for UI work.
- Deploy target (do NOT deploy yourself): owner's EC2 + Cloudflare tunnel behind
  Access. `README.md` has the systemd unit.

---

## 4. Repo map (where things live)

```
server/src/
  index.ts            express routes + WS broadcast + boot (ALL endpoints here)
  config.ts           AppConfig + defaults (risk limits, scanner params, watchlist)
  ledger.ts           SQLite: events / fills / signals / config (the audit store)
  types.ts            shared server types
  binance/
    client.ts         SIGNED spot REST — keys here only, NO withdrawal methods
    rest.ts           public REST: exchangeInfo, klines, depth, trades, funding
    ws.ts             reconnecting market WS wrapper
    userStream.ts     user-data stream (listenKey) — optional, 30s polling fallback
  engine/
    marketData.ts     spot miniTicker + futures markPrice ingest, basis, sparks
    scanner.ts        basis monitor → produces PROPOSALS (never places orders)
  services/
    account.ts        balances, equity, positions, PnL (avg-cost from fills)
    risk.ts           THE GATE — evaluate() runs before every send
    orders.ts         the ONLY module that hits Binance trading endpoints
    loans.ts          flexible loans + cross-margin visibility, gated borrow/repay

web/src/
  App.tsx             shell: sidebar + topbar + page switch
  store.tsx           global state, WS, prefs, page routing, all API calls
  styles.css          the whole design system (glass tokens, cards, grouped list)
  format.ts           fmtPrice/fmtPct/fmtBasis/fmtQty/time — adaptive precision
  lib/prefs.ts        local UI prefs (theme/motion/density/tape/basis units…)
  lib/eventText.ts    humanizes ledger events into sentences (no raw JSON in UI)
  components/
    ui.tsx            Group / GRow / StatePill / StatTile / EmptyState / chips
    Header.tsx        Sidebar + Topbar + BottomNav + brand mark
    TokenIcon.tsx     logo resolver (spothq→coincap→brand-hued monogram)
    BigChart.tsx      hand-built SVG chart (dotted fade + crosshair + draw-in)
    Donut.tsx Spark.tsx Num.tsx Modal.tsx Palette.tsx HealthBadge.tsx Tape.tsx
    Icons.tsx RiskIcons.tsx
  pages/              Dashboard, Account, Wallets, Markets, TokenDetail, Loans,
                      ManualTrade, Orders, Positions, Fills, Pnl, Strategies,
                      Opportunities, Risk, LedgerPage, SystemHealth, Settings
```

---

## 5. The design system (the LOOK — hold this bar)

Apple / iOS 26 "Liquid Glass" + macOS System Settings, applied to a serious
trading terminal. Tokens and classes live in `web/src/styles.css`. Reuse them —
do not invent parallel styles.

- **Surfaces = frosted-glass cards.** `.card` = translucent fill + backdrop blur
  + hairline `--glass-border` + inner light highlight + layered `--depth` shadow
  + 18px radius. Every content section gets a bounded card — no floating text in
  whitespace, no unstyled divs.
- **Specular rim** (`::after` on `.card`, `.stat-tile`, `.mcard`, buttons): a 1px
  light-catching edge, bright top-left, fading round the curve. This is what
  reads as *crystal*, not a flat frosted box. Pure CSS (no SVG filter — SVG
  feDisplacementMap refraction is Chrome-only and too heavy for a data terminal).
- **macOS grouped list** for config/status pages: `<Group title>` + `<GRow icon
  color label sub control>` + `<StatePill tone>`. Rounded glass container,
  colored rounded-square icon per row, label + sublabel, control/status right,
  inset dividers. Already on Settings, System Health, Account. Use it for any new
  list/settings surface.
- **Typography hierarchy (TradingView-grade).** Values/prices = near-black
  `--text`, weight 700–720. Grey (`--muted`) is for LABELS ONLY — never data.
  Real size contrast: page titles 29px, section titles 19px, metric values 19px,
  stat-tile values 22px, table values 14px, labels 10–11px uppercase. Deltas are
  always colored green/red. Numbers use `.num` (tabular).
- **Token icons:** always `<TokenIcon>`. Coverage is solved by a server-side
  resolver (`server/binance/icons.ts` → `/api/icons`): for any base without a
  bundled logo it hits CoinGecko `/search`, exact-symbol matches, caches the URL
  to disk (`data/icon_cache.json`). Client `lib/iconManifest.ts` batches +
  re-polls; chain is resolved-logo → spothq → coincap → brand-hued monogram.
  Monograms upgrade to the real logo in place. `img-src` CSP allows the CDNs —
  do not remove CoinGecko/coincap from the CSP or icons break.
- **Buttons:** `.cta-pill` (dark primary), `.cta-pill.buy/.danger` (gradient +
  inner sheen + glow + press state), `.mini-btn` (quiet), `.seg` (segmented),
  `.switch` (toggle). Every button must DO something or be disabled with a reason.
- **Themes:** full light + dark via `data-theme`. **Reduced-motion** and
  **reduced-transparency** fallbacks exist — keep them working.
- **Number-flash on change** (`<Num>`): flash the value green/red, never the row.
- Marquee tape is optional (Settings toggle, off by default). ⌘K / "/" command
  palette. Bottom-right health badge. Security headers (CSP etc.) set server-side.

**Banned:** bordered card-farms with no hierarchy, equal KPI-tile grids as the
main layout, boxed tabs, dead buttons, fake "running" states, raw JSON dumped in
the UI, grey-on-grey monotone, a public market homepage, giant BTC chart.

---

## 6. The improvement loop (how to work each session)

Work in tight, verifiable iterations. One surface at a time. Never a giant
multi-page rewrite in one unverified pass.

**Each iteration:**
1. **Pick ONE surface** (a page, or a component used across pages). Prefer the
   least-polished one, or whatever the owner named.
2. **Look at it in the preview**, light and dark, at ~1440px. Screenshot it.
   Find the specific weaknesses (flat cards, grey monotone, a dead/plain button,
   drift on zoom, a raw value that should be humanized, an icon that's wrong).
3. **Polish to the bar in §5.** Real cards, specular rim, grouped rows where it
   fits, black values + grey labels, colored deltas, glass buttons with states,
   correct icons, good empty states. Improve *each button and detail* — hover,
   press, disabled reasons, spacing, alignment.
4. **Rebuild web, reload, verify:** screenshot light + dark, check console = no
   errors, click every button on the surface (each works or is disabled with a
   reason), test at 1440px and 1920px (no drift).
5. **`npm test`** — 48 gates must still pass.
6. **Commit** with a clear message (`vX.Y: <what>`). Then pick the next surface.
7. **Repeat** until the whole app is at the bar, then start reshuffling/refining
   the highest-traffic surfaces further (Dashboard, Markets, Token Detail, Manual
   Trade). There is always a next detail.

**While polishing UI, do NOT touch backend logic.** Styling and JSX structure
only. If a change needs a new field, add it minimally to the API and keep every
§2 invariant. After ANY server edit, run `npm test`.

---

## 7. Status: done vs. next

**Done (v0 → v2.3):**
- Backend: market-data engine (correct 2026 tiered futures WS host — legacy
  fstream `/ws` is silently dead), basis scanner producing explained proposals,
  full SQLite ledger, signed spot client (no withdrawals), account/risk/orders/
  loans services, user-stream + polling, margin/loan visibility, system health,
  49 gate tests.
- Frontend: sidebar cockpit + control-room topbar, 17 pages, liquid-glass card
  system + specular rim, macOS grouped list (Settings/SystemHealth/Account/Risk),
  TradingView typography, token badges, humanized ledger, allocation donut,
  Markets (full ~440-symbol universe), deep Token Detail (price/basis/funding/
  volume charts, depth, trades), light+dark.

**Next (in rough priority):**
- UI polish sweep of the trading surfaces to the §5 bar: Manual Trade, Orders,
  Positions, Fills, then Loans and Strategies.
- Backend Phase 2: live-verify the with-keys paths once real read-only keys are
  added (balances, margin, order history); then Binance **testnet** executor for
  the two-leg basis ticket; margin borrow pre-checks; volume-spike monitor.
- Never start live auto-execution. v0 stays manual-approval only.

---

## 8. If you edit the backend, do not break

- `services/risk.ts`: the check order and that it runs on `forLiveSend`.
- `services/orders.ts`: it is the only trading path; keep preview→gate→send.
- `binance/client.ts`: no withdrawal/transfer methods, keys from `credsFromEnv()`.
- `ledger.ts`: every action still writes an event.
- Kill switch + `liveTradingEnabled` gating in `config.ts` / `index.ts`.
- Security-header middleware and the `.env`/gitignore setup in `index.ts`.
- Run `npm test` after. If a gate fails, you regressed an invariant.

When in doubt: this is real money, safety beats polish. Ship nothing that could
place an unintended order or leak a key.
