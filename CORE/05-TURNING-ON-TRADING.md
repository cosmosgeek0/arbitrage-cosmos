# 05 — TURNING ON TRADING (the "$10 test")

**Before money work, read `Desktop/run.md` §0/newest §5 and `Desktop/CHANNEL.md`
top; source capability is not live authority.**

## What is actually true

**Legacy Spot send source exists; no live money path is fireable.**

- `server/src/binance/client.ts:568` — `placeOrder()` issues a signed
  `POST /api/v3/order`; REST HMAC-SHA256 signing is at `client.ts:311`.
- `server/src/services/orders.ts:452` — `await this.client.placeOrder(params)` sits inside a
  complete send path: risk evaluation → notional reservation committed **before** send → ledger
  `order_request` event → signed call → response reconciliation (orderId, clientOrderId echo
  compared against the one sent, transactTime, status, exact `executedQty` and
  `cummulativeQuoteQty` parsing).
- `OrderService` is constructed in server source at `index.ts:606`. *(Relayed measurement.)*
- Three flags ship safe by default: kill switch ON, live trading OFF, funds locked.

**Money HTTP routes fail closed; source capability is not live authority.**

- `index.ts:3607` `app.post('/api/trade/test')` → not-implemented
- `index.ts:3611` `app.post('/api/trade/send')` → not-implemented
- `index.ts:3588` preview route refuses: canonical Capital/Risk/execution-ticket authority not mounted
- All ten money / loan / cancel / recovery routes reject; the cap makes the deployment read-only
  **by construction**, not by configuration.

**The handlers were written, wired, and deliberately removed.**
`git log -S "orders.send(" -- server/src/index.ts` returns two commits; the diff at `…2cf0`
("compose pre-L serial integration spine") REMOVES the two order calls. Today `index.ts` calls only
two read-only recovery methods; every mutating method is called by nothing. *(watchdog 3's
git-history measurement.)*

## The three corrections

1. **It is not a build.** Opening the path is re-enablement plus configuration of a finished system.
   Anyone who scopes it as "write the trading system" is wrong.
2. **"Small to restore" and "safe to restore" are different claims, and only the first is measured.**
   The removal was deliberate and part of an architecture migration. Restoring the old call may
   bypass exactly what the newer spine was composed to enforce. **Nobody has measured that.**
3. **Restoring the four handlers does not produce a working product.** Per the read-only audit
   (`Desktop/RUNBOOK/evidence/CODEX-READ-ONLY-AUDIT.md` §5.5): it revives a single-leg legacy Spot
   path, bypasses the canonical Capital/Risk/execution-ticket boundary, **does not create the missing
   perpetual leg**, does not create a canonical arbitrage close, and does not prove restart or private
   reconciliation. It is donor material, not a switch.

## The decision that is still open

**(a)** restore the two handlers on the running OrderService path with limits, or
**(b)** complete and mount the canonical Capital/Risk/execution-ticket authority first.

Both are legitimate. It is a **design decision**, not a discovery — no further measurement settles it.
`capitalFoundation/` and `executionPolicy/` exist; the symbol `executionTicket` appears in **zero**
files under `server/src`. *(watchdog 3's measurement, not re-derived here.)*

## Before any money effect

Rollback `…21a0` restores public availability only; private/account is
`NOT_CONFIGURED/UNKNOWN`, `PRIVATE_READ_READY` is blocked, and money is `$0`.
The packaging Q is pending; no successor retry or M0 is authorized.
