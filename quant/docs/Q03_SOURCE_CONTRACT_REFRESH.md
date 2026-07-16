# Q03 source-contract refresh

Retrieved 2026-07-12 before Q03 implementation. This refresh is deliberately limited to
the mutable archive and forward-bridge facts used by Q03. It does not repeat Q00 strategy
research and it does not admit or register a production source.

## Official Binance public archive

- Repository: `binance/binance-public-data` at commit
  `5c7f3197591c0d54d85dc43066226bc4c671d47a`.
- Pinned README SHA-256:
  `085ab91377aa9325d44f4c7ad27cce4ab381e158403e1d7df2bad39d1a66f7c6`.
- Official access root: <https://data.binance.vision/>.
- Selected Q03 family: Spot daily aggregate trades, eight columns in the official order:
  aggregate trade ID, price, quantity, first trade ID, last trade ID, timestamp, buyer-maker,
  best-price-match. Daily archive files have adjacent `.CHECKSUM` SHA-256 sidecars.
- The README says archived files can later be replaced. URL identity is therefore insufficient:
  Q03 binds URL, exact sidecar bytes, archive digest, extracted-member digest and immutable lake
  revision. A changed official checksum creates a correction revision and never rewrites history.
- Spot archive timestamps before 2025-01-01 are declared milliseconds; files from 2025-01-01
  are declared microseconds. Q03 still treats unit as a per-file contract, preserves the raw
  integer and rejects mixed or implausible values instead of guessing from digit count or date.
- The repository README says `Licence: MIT`, but the observed root has no `LICENSE` file and no
  explicit archive-data redistribution grant. Q03 records `MIT_IN_README_ONLY`, archive-data
  license `NOT_EXPLICIT`, and raw redistribution `UNKNOWN_REQUIRES_APPROVAL`. Only hashes,
  bounded aggregate coverage and derived registry evidence enter Git; raw ZIP/CSV/rows do not.

### Selected bounded real sample

- ZIP: <https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip>
- Sidecar: <https://data.binance.vision/data/spot/daily/aggTrades/BNBUSDT/BNBUSDT-aggTrades-2017-11-06.zip.CHECKSUM>
- Exact sidecar text, excluding the terminating newline:
  `2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893  BNBUSDT-aggTrades-2017-11-06.zip`
- ZIP SHA-256: `2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893`.
- Probe measurements: 12,440 ZIP bytes; one regular member
  `BNBUSDT-aggTrades-2017-11-06.csv`; 49,263 uncompressed bytes; 832 newline-terminated rows;
  eight fields per row; no header; aggregate IDs 0 through 831.
- Source-time coverage: raw milliseconds
  `1509940463590..1510012550791`, or 2017-11-06T03:54:23.590Z through
  2017-11-06T23:55:50.791Z. There is no local receive clock, sequence-complete L2, queue
  position, live latency, complete liquidation flow, borrow truth or intent evidence.
- Probe-only transport metadata: HTTP Last-Modified `Tue, 06 Jun 2023 03:30:26 GMT`; ETag
  `aa0348e21445f6fbd58668453d4b2b0a`. These are observations, not authenticity or immutability
  guarantees.

## Official Spot forward contract

- Repository: `binance/binance-spot-api-docs` at commit
  `31643ed390e2aa450ce872981556186acf96a195`.
- Pinned `web-socket-streams.md` SHA-256:
  `32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a`.
- Pinned `CHANGELOG.md` SHA-256:
  `3c87303c7ba632d7240d34a7271652aaa8a4f5aebe8023eec6ab36a13bd10f8a`.
- A Spot `bookTicker` update has `u,s,b,B,a,A` and no documented `E` or `T`. Its source event
  and transaction times must remain null. Q03's nullable-source-time schema uses an explicitly
  declared receive-wall partition/order basis; it never relabels receive time as exchange time.
- Spot aggregate trade is one taker-order aggregation; raw trade is fill-level evidence. They
  are distinct event families and must not be summed together.
- Spot depth uses product-specific `U/u` snapshot overlap and gap handling. Q03 may preserve
  these fields but does not reconstruct a book or implement Q04 resynchronization.
- The current Spot connection contract documents 24-hour connection lifetime, a five-message
  per-second inbound control limit and up to 1,024 streams. These are contract evidence for the
  owner, not constants implemented by Q03.

## Official USD-M forward contract

The retrieved official Binance documentation collection is anchored by
<https://developers.binance.com/en/docs/llms-full.txt>, SHA-256
`c72e3a3d9c840cf7db9ce5df5844106dda9a4b681d5d6539ff79e9c90ce0cbe0`.
Relevant current pages include the
[connection rules](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect),
[routing migration](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice),
[local-book algorithm](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly),
[public streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public),
[market streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market),
[REST market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data),
and [change log](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/change-log).

- Since the 2026-04-23 migration, depth/book ticker use the `/public` route, while aggregate
  trade, mark price and liquidation use `/market`; old unrouted market streams are retired.
- After CM/UM stream integration effective 2026-06-30, merged all-market records include `st`;
  `st=1` is USD-M and `st=2` is COIN-M. Product identity and official `ps` must be preserved.
- USD-M depth uses `U/u/pu`; after the snapshot bridge, `pu` must equal the preceding `u` or the
  owner resynchronizes. This is not the Spot algorithm. Q03 stores sequence evidence only.
- USD-M aggregate trades group same-price/same-taking-side fills over 100 ms. `q` includes RPI
  and `nq` excludes RPI, while standard depth/BBO excludes RPI. Any volume-versus-visible-depth
  analysis must carry that coverage mismatch.
- The current connection rules document 24-hour sessions, 10 client messages per second and
  1,024 streams. Q03 implements no socket, scheduler or rate budget.
- The liquidation endpoint prose and dated change log disagree on whether the per-symbol
  1,000 ms sample is the latest or largest order. Q03 records provider-selected sampled
  liquidation evidence as incomplete; it never treats it as total flow.
- Open-interest history is limited to the latest month. Funding history and funding-info share
  a rate budget; current funding-info is not a historical instrument-rule ledger.

## Canonical repository owner seam

Read-only source identities at Q03 activation:

| Canonical file | Git blob | SHA-256 | Q03 use |
| --- | --- | --- | --- |
| `server/src/intelligenceRuntime/contracts/types.ts` | `f3d080d0aaaa9e5d6830c795636a61471dada2a0` | `482573f7d78901e9119a98075ec5ed7f900b224ae6555df0e1bf0c7b4623349e` | `RuntimeSourceEvent`, nullable source clocks, receive time, generation, stream and sequence |
| `server/src/intelligenceRuntime/spot/types.ts` | `1a6d260dae1b2719d9c651268b7bd2d8334169f7` | `75033425d4ba59f30181ba7ac8df7d928fdb382284c1943ddbb06121c6879f3e` | bounded drop/coalesce metrics and Spot normalized emissions |
| `server/src/intelligenceRuntime/futures/types.ts` | `6d1ad3d26b1a4d935805307bb6935c3ec1cfa43f` | `94fee5bedf7b3e20b0d69121bda8bedb4c2a59eabb5b1347c5e42d202e17322c` | USD-M product identity, clocks, sample posture and emissions |
| `server/src/intelligenceRuntime/capture/types.ts` | `6ee6ff018e5f95c56ff7bb23fbfc4c54e550ae02` | `e9c9984df9d566ee6c5bf01ed43f6181ab2f2817f83ac099d293ff8e2af28d5c` | bounded capture/truncation/completeness evidence; operational storage stays owner-controlled |
| `server/src/intelligenceRuntime/bridge/types.ts` | `718573c1925e29067a109aec921896ce5f6cf004` | `d09f5a9ebd5cfafb542531c3b4318396492bd30e5de8c386319387c788274e46` | normalized evidence-only bridge semantics; no live money authority |
| `server/src/intelligenceFoundation/contracts/types.ts` | `e601d79f436b023303baba1223f394695dd0ae13` | `7eb6b169cdf3a2d59e2ceccc000c8c9668d79a3b2aac6fbbe21c32e836f5d60d` | normalized evidence truth, versions, provenance, nullable clocks and exact owner boundary |
| `server/src/intelligenceFoundation/evidence/types.ts` | `eb268ccfa608f4ce17a4a3dd88779df21fbb2429` | `0b08c20fff4ebffac8cf289b0ecc88d560b534b5fa6b05e8182da9f7ae3ae38e` | evidence normalization context and source-fact semantics |

`intelligenceRuntime` remains the sole producer owner. Its current types expose source event and
transaction times, receive wall time, connection generation and sequence, plus bounded drop/gap
metrics. They do not expose a Q append-only delivery, receive monotonic timestamp, receive
ordinal, persistence timestamp or an exact-decimal payload contract. Real Q delivery therefore
remains `MISSING/BLOCKED`; Q03 creates a pure typed fixture seam and a drop-new bounded queue
contract only. It does not import a production client, register a sink or mutate operational
storage. The MI bridge itself accepts Spot book ticker with null source clocks, but the current
operational outcome-capture coordinator rejects evidence with a null source event time. Q03
therefore records Spot book ticker as `MI_BRIDGE_COMPATIBLE` and
`OPERATIONAL_OUTCOME_CAPTURE_INCOMPATIBLE`; it does not overstate capture readiness.

## Optional Tardis reference

Exact retrieved HTML artifacts, kept outside Git, were hashed on 2026-07-12:

| Official page | Bytes | SHA-256 |
| --- | ---: | --- |
| <https://docs.tardis.dev/historical-data-details/binance> | 632,048 | `21ca9ac6d54b82237dccdbe894058e73281d0be3ea38cee8d2b9cc06f0525749` |
| <https://docs.tardis.dev/historical-data-details/binance-futures> | 725,913 | `996509b3b8c26cc43454005d01ee7fa9a9bc5acc1aef68f121eefb4164f6cce1` |
| <https://docs.tardis.dev/faq/data> | 1,528,722 | `1964e67f23b21b89ac74fdbcb119fba006ee27c77ea91c5e04ab406bee7cf639` |
| <https://docs.tardis.dev/legal/terms-of-service> | 874,154 | `c23ffa7e3a8dd8d2d1302929af9eded290e38d8eb7098766fe1da13135e1cd92` |

Tardis documents raw and normalized Binance history, collector-local timestamps, generated
snapshots, possible gaps and daily restart gaps. Its terms restrict redistribution of raw data
and permit only limited aggregated/calculated disclosure. Q03 keeps Tardis `REFERENCE_ONLY` as
a typed capability card: no dependency, credential, subscription, download or adapter runtime.

## Implementation consequences

1. The archive importer is pure over caller-supplied bytes and explicit provenance. It verifies
   the exact sidecar before bounded ZIP inspection and CSV parsing.
2. The selected archive family alone is normalized in Q03. No directory listing implies
   coverage, and missing files remain `UNKNOWN/UNAVAILABLE`.
3. Historical rows use the accepted Q02 event-timestamped lake contract with exact decimal
   strings and injected normalization/persistence times.
4. The forward seam has a separate nullable-source-time schema. Spot book ticker remains null
   on exchange clocks and uses declared receive-wall ordering.
5. Source cards are review evidence only. Archive use is scoped to local/derived research under
   the directive; unresolved identity and redistribution gates prevent any admission claim.
6. The early Event Atlas has `HISTORICAL_COARSE` and `FORWARD_HIGH_FIDELITY` tiers. The real
   sample binds only the first; the second binds synthetic fixtures while real coverage stays
   `MISSING/BLOCKED`.
