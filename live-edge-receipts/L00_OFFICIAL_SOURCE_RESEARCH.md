# L00 official Binance source research

Revision: `L00-BINANCE-2026-07-12-PARTIAL`

Checked: `2026-07-12T04:23:40Z`

Posture: public official documentation and the official Binance Spot documentation repository only. No private/account endpoint, signed request, test order or exchange mutation was called. This is the dated L00 research/source inventory; L02 still owns the machine-readable fixture, content hashes and negative route-contract tests.

## Dated drift that changes the implementation

- Official Spot documentation head observed as `31643ed390e2aa450ce872981556186acf96a195`. The July 2026 changelog adds symbol status `CANCEL_ONLY` and advances current SBE to 3:5. Unknown status/schema/filter values must fail closed.
- Spot REST signing now requires percent-encoding the payload before signing. The old Spot REST/WebSocket listen-key management methods were removed in February 2026; current Spot private user data uses WebSocket API subscription.
- Legacy unrouted USD-M WebSocket `/ws` and `/stream` endpoints were decommissioned in April 2026. Current routes are separated under `/public`, `/market` and `/private`; wrong-route fixtures must fail.
- Old Margin `/sapi/v1/userDataStream*` and isolated variants were removed in February 2026. The Margin changelog directs clients to a listen token plus WebSocket API subscription.
- Current official Margin sources conflict: the April changelog records `GET /sapi/v1/margin/maxBorrowable` as weight 750 UID while a catalog page still shows 50 IP, and catalog listen-key material conflicts with the newer listen-token migration. L02 must encode `OFFICIAL_DOC_CONFLICT` and fail closed; it must not silently select or fall back.
- Binance publishes no matching-engine region. Section 7's region/latency work must be empirical and owner-gated; no Tokyo or other location assumption is valid.

## Product source snapshot

| Product | Production realm and current transport | Private mechanism | Critical lifecycle/ambiguity facts | Primary official sources |
| --- | --- | --- | --- | --- |
| Spot | REST `https://api.binance.com`; public WS `wss://stream.binance.com:9443` or `:443`, raw `/ws/<stream>`, combined `/stream?streams=...`; market-data-only host cannot carry private data | WebSocket API `wss://ws-api.binance.com:443/ws-api/v3`; authenticated `userDataStream.subscribe` or signed `userDataStream.subscribe.signature` | 24h connection; documented ping/pong and subscription/session caps; 10s matching-engine timeout and HTTP 5xx may be `UNKNOWN`, requiring stream/order-query reconciliation before new intent | [REST/signing](https://developers.binance.com/en/docs/products/spot/rest-api), [WS API](https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/web-socket-api.md), [user data](https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/user-data-stream.md), [streams](https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/web-socket-streams.md) |
| USD-M | REST `https://fapi.binance.com`; test realm `https://demo-fapi.binance.com`; WS `wss://fstream.binance.com/{public|market|private}` with raw `/ws/<stream>` or combined `/stream?streams=...` suffix | REST listen-key lifecycle `/fapi/v1/listenKey`; private WS `/private/ws/<listenKey>` | Token 60m; planned keepalive; connection 24h; public/private health independent. Timeout, `-1007`, relevant 503 and connection loss remain `UNKNOWN`; never blind-retry a mutation | [general/signing](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info), [route notice](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice), [connect](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect), [user data](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams) |
| Margin | REST family `https://api.binance.com`; exact private WS route/lifecycle remains conflict-tagged pending L02 fixture resolution | Current changelog: `POST /sapi/v1/userListenToken` plus `userDataStream.subscribe.listenToken`; older catalog routes must not be revived silently | Borrow/repay is high-weight, stateful and serialized. Account, liability, inventory, interest, modes and permissions require independent freshness. Conflicting max-borrow/listen-token documentation blocks arming | [Margin changelog](https://developers.binance.com/en/docs/products/margin-trading/change-log), [borrow/repay](https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/borrow-repay), [account](https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/account), [API-key permissions](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/account#get-api-key-permission) |

## Matrix fields frozen for L02

Every route/operation record must pin:

- matrix revision, checked UTC time, product, realm and transport;
- exact base host, route category, method/path or WebSocket method and stream name;
- security type, permitted key types, signing algorithm, canonical encoding, timestamp unit and `recvWindow` policy;
- required parameters, request-weight scope/value, order-count costs and response rate headers;
- data source, mutation class, ambiguity class and safe-retry class;
- response schema revision/hash, official URL, changelog/last-modified signal, source commit/content hash and conflict state;
- connection/token lifetime, renewal method/cadence, ping/pong, message/connection/subscription caps, ordering guarantee, unsubscribe/termination behavior and JSON/SBE revision;
- exact raw exchange-info/filter snapshot hash and fetched time; unknown filters/statuses are preserved then fail closed;
- independent Spot/USD-M/Margin private-truth freshness/completeness, history windows, pagination and reconciliation identifiers.

## Current filters and permissions posture

- Preserve the entire raw Spot filter set, including price/percent/lot/notional/iceberg/order-count/position/trailing/amend/order-list, exchange-wide and asset filters; do not discard unknown types.
- USD-M filter values remain exact decimal strings; `pricePrecision` and `quantityPrecision` are not tick/step substitutes.
- Permission truth must pin read, Spot/Margin trading, Futures, Margin, withdrawal, internal/universal transfer, portfolio/mode and IP-restriction fields. Missing or conflicting permission truth blocks entry.

## Section 7 integration notes

- The fixed 10-USDT canary envelope remains unchanged; this source research grants no capital authority.
- Region selection and the full event-to-private-confirmation latency chain remain future empirical measurements; official docs do not disclose matching-engine geography.
- Q regime is advisory to existing strategy/Capital/Risk owners; `UNKNOWN`, stale, unsupported or disagreeing inputs produce conservative posture.
- Recording health comes from the canonical Intelligence Runtime capture bridge; no duplicate production feed is authorized.
