# Production Audit — 2026-07-11

## Verdict

The repository-wide source review and remediation pass is complete at the code
level. The frontend design language was preserved; changes focus on backend
safety, financial truth, bounded resource use, failure handling, and honest UI
states. Production deployment remains conditional on the release gates and
operator-owned controls below. This is not a claim that an uninspected cloud
deployment or exchange account is safe merely because the repository passes.

## Scope and findings

The audit covered application and test source, configuration, build metadata,
HTTP and WebSocket boundaries, Binance REST/stream clients, account/order/loan
services, risk controls, engines, SQLite persistence, runtime shutdown, caches,
and frontend polling/mutation/error paths.

Codex Security scan `cf28a10b-ff42-4c1b-8c79-2cc8979e0028` produced 21
canonical findings before remediation: 2 high, 15 medium, and 4 low. The main
classes were remote trust-boundary bypasses, ambiguous financial outcomes,
incomplete account/PnL truth, stale or malformed upstream data, unbounded
inputs/resources, retry storms, and frontend states that could imply success
after a failed mutation.

## Remediation summary

- Centralized local-versus-remote access decisions, verified Cloudflare Access
  identity for remote HTTP/WebSocket traffic, exact same-origin checks for
  remote mutations, bounded bodies/queries/clients, private no-store API
  responses, and graceful connection shutdown.
- Hardened Binance transport with bounded responses and timeouts, redirect and
  content validation, redacted errors, shared time correction, rate-limit
  handling, and migration to the current signed WebSocket API private-stream
  subscription protocol.
- Made account, order, fill, PnL, and equity completeness explicit. Financial
  sends are serialized and correlated; malformed acknowledgements, partial
  terminal states, prior-day uncertainty, or ambiguous network outcomes do not
  become silent success.
- Persisted the current UTC day's configured/requested/observed fill-symbol
  universe without claiming it is account-wide. Binance trade history is
  symbol-scoped, so the daily-loss/live-send gate stays closed when account-wide
  completeness cannot be proven. Unresolved orders now have fair scheduled
  reconciliation plus an authenticated, evidence-backed operator recovery path;
  terminal recovery transitions commit atomically with their financial result.
- Added fail-closed loan controls for account/key posture, live/control state,
  price/catalog freshness, LTV/APR/product limits, application notional caps,
  typed confirmations, durable mutation IDs, and explicit reconciliation of
  unknown outcomes.
- Hardened basis/volume runtime freshness, startup recovery, event timestamps,
  market parsing, cache writes, SQLite decoding/search bounds, AWS runner input
  validation, and lifecycle cleanup.
- Corrected frontend races and false-success paths across polling, news/token
  refresh, notification recovery, risk/live controls, cancel actions, and
  incomplete account/PnL presentation. No visual-system redesign was made.
- Pinned Node 22 and npm 10.9.8, made server builds remove stale compiled output,
  separated deterministic tests from the live-market integration gate, and
  added least-privilege GitHub CI for `current-main` and pull requests.

## Settled-tree verification

The final working tree passed the release evidence run on 2026-07-11:

- `npm test`: server/web typechecks and clean production builds passed; basis
  107/107, volume 124/124, financial 59/59, storage/AWS 29/29, focused safety
  50/50, stream lifecycle 7/7, and perimeter 1/1 passed.
- `npm run test:integration`: 72/72 live-market integration checks passed
  against 447 current Binance markets, including 359 spot-plus-perpetual pairs.
- `npm audit --omit=dev --json`: zero known vulnerabilities across 305 audited
  dependencies.
- SQLite read-only verification: `quick_check` returned `ok`, foreign-key
  violations were zero, and the event table remained under active bounded
  retention without pruning financial or audit event classes.
- `git diff --check`: passed.
- The rendered app passed the mandatory page sweep below with zero horizontal
  body overflow, no browser console warnings/errors, and no ARIA alerts.
  Every topbar panel also passed the required left-to-right audit at its exact
  `398 x 486` shell size with no overflow. Changed safe controls and the honest
  disabled live-trading state were exercised; the final handoff state is the
  Dashboard with no popover open.

The Vite production build reports one advisory for the existing 607.01 kB app
chunk (177.39 kB gzip). It is a performance follow-up, not a failed build or a
correctness/security gate.

For future releases, rerun these gates on the exact candidate commit:

```bash
npm ci
npm test
npm run test:integration
npm audit --omit=dev
git diff --check
```

Also verify SQLite integrity against a safe copy or read-only connection, then
exercise the rendered app in the project-mandated page order:

`Calendar → News → Health → Logs → Risk → Opportunities → Volume → Basis → Markets → Token → Borrow → Account → Dashboard`

Audit the topbar left-to-right after any shared UI change, confirm browser
console/network health, click every changed control, verify honest disabled and
failure states, and restore the operator's theme/page/state before handoff.

## Operator-owned residuals

- Verify the real Cloudflare Access application, audience, operator email,
  tunnel route, TLS boundary, and origin exposure. `HOST=0.0.0.0` must not be
  used as a substitute for authenticated private ingress.
- Verify Binance key scopes and IP restrictions directly at Binance. Keep
  withdrawals and universal transfer disabled. Leave manual order/loan
  capability halted until paper/testnet and operational soak evidence justify
  enabling it; autonomous strategy-to-order execution is out of scope.
- Binance's account trade-list endpoint requires a symbol. The application now
  reports configured/observed scope truthfully but does not treat that as
  account-wide daily-loss evidence. Keep live sending halted unless a future
  account-wide ingestion/control design closes that limitation.
- Configure encrypted database backups, restore drills, disk/retention alerts,
  process supervision, log shipping, and alert delivery in the deployed
  environment. Repository code cannot prove those controls exist.
- Treat live Binance/news/profile/market integrations as external dependencies.
  Preserve stale/unavailable labels and fail-closed behavior during outages;
  never replace missing production truth with synthetic success.
- Enable branch protection and required CI checks on GitHub. Run the separate
  live-market integration gate during release because deterministic CI does not
  depend on third-party availability.
