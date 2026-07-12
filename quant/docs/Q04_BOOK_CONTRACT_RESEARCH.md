# Q04 book-contract research

Retrieved 2026-07-12 before Q04 implementation. This refresh is deliberately limited to the
official local order-book laws, depth event payloads and REST snapshot shapes that Q04
types and implements. It reuses and re-verifies the same-day Q03 pins; it does not repeat
Q00 strategy research and it does not admit or register a production source.

## Verified artifact identities

| Artifact | Verification | SHA-256 |
| --- | --- | --- |
| `binance-spot-api-docs` `web-socket-streams.md` at Q03-pinned commit `31643ed390e2aa450ce872981556186acf96a195` | re-fetched 2026-07-12, byte-hash equals Q03 pin | `32bf73a0bed3b75e3ca981fdbaf48c53544bbdfb5944ef8ed1c4d7af9aceba0a` |
| `https://developers.binance.com/en/docs/llms-full.txt` | re-fetched 2026-07-12, byte-hash equals Q03 pin | `c72e3a3d9c840cf7db9ce5df5844106dda9a4b681d5d6539ff79e9c90ce0cbe0` |

Two additional catalog pages were read on 2026-07-12 through in-app browser text
extraction (no raw-byte pin is possible for the rendered application pages; facts below
are recorded as observed page text of that date):

- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public`
- `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data`

## Official Spot local order-book law

Source: pinned `web-socket-streams.md`, section "How to manage a local order book
correctly", byte-verified above. Exact procedure:

1. Open the diff-depth stream (`<symbol>@depth` or `<symbol>@depth@100ms`).
2. Buffer received events; note the `U` of the first buffered event.
3. Get a REST depth snapshot (`GET /api/v3/depth`, limit up to 5000).
4. If the snapshot `lastUpdateId` is strictly less than the first buffered `U`, the
   snapshot is too old: go back to step 3.
5. Discard buffered events where `u <= lastUpdateId`. The first remaining buffered event
   should now have `lastUpdateId` within its `[U;u]` range.
6. Set the local book to the snapshot; its update ID is `lastUpdateId`.
7. Apply the update procedure to all buffered events, then to all subsequent events.

Update procedure (verbatim semantics):

- If the event `u` is less than the local book update ID, **ignore** the event.
- If the event `U` is greater than the local book update ID plus 1, events were missed:
  **discard the local book and restart the process from the beginning**.
- Normally, `U` of the next event equals `u + 1` of the previous event.
- Level updates are absolute quantities; quantity zero removes the price level; a level
  absent from the local book is inserted.
- After applying, set the book update ID to the event `u`.

Notes recorded honestly:

- The Spot law tolerates overlap: an event with `U <= bookUpdateId + 1 <= u` applies at
  any time. Stale events (`u < bookUpdateId`) are ignored without resynchronization; only
  a forward gap (`U > bookUpdateId + 1`) forces a restart. Q04 implements exactly this
  and classifies ignored events as duplicate/late evidence.
- The Spot diff-depth payload carries `e`, `E` (event time, ms), `s`, `U`, `u`, `b`, `a`.
  There is no transaction time `T` on the Spot diff-depth event.
- Snapshot depth is bounded (max 5000 per side); levels outside the initial snapshot are
  unknown until they change. A reconstructed Spot book is therefore a bounded window,
  never proven full venue depth.

## Official USD-M local order-book law

Source: hash-pinned `llms-full.txt` document
`/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly`.
Exact procedure:

1. Open the diff-depth stream (`<symbol>@depth` on the `/public` route).
2. Buffer events. For the same price, the latest received update covers the previous one.
3. Get a REST depth snapshot (`GET /fapi/v1/depth`, limit up to 1000).
4. Drop any buffered event where `u < lastUpdateId` of the snapshot (strictly less; an
   event with `u == lastUpdateId` is retained, unlike Spot's `u <= lastUpdateId`
   discard).
5. The first processed event must have `U <= lastUpdateId` AND `u >= lastUpdateId`.
6. While listening, each new event's `pu` must equal the previous event's `u`; otherwise
   reinitialize from step 3.
7. Quantities are absolute; quantity zero removes the level; removal of a level absent
   from the local book can happen and is normal.

Notes recorded honestly:

- The official USD-M text does not state an explicit stale-snapshot retry rule like Spot
  step 4. If the bridge condition in step 5 is unsatisfiable (for example every retained
  buffered event has `U > lastUpdateId`, or the buffer ended before `lastUpdateId` was
  covered and the next live event violates the bound), the only lawful continuation is a
  new snapshot. Q04 implements that as a derived necessity and records it as derived, not
  as quoted official text.
- The official USD-M text has no explicit "ignore stale event while synced" rule: after
  synchronization, any event whose `pu` differs from the previous `u` — including
  re-delivered older events — forces reinitialization. Q04 implements exactly this
  fail-closed law and only classifies the anomaly kind as evidence.
- Exact-boundary subtlety recorded honestly: an event beginning exactly at
  `lastUpdateId + 1` does not satisfy the official bridge condition
  (`U <= lastUpdateId AND u >= lastUpdateId`) and therefore forces a new snapshot, even
  though its data is contiguous with the snapshot. The official step-4 strict drop
  (`u < lastUpdateId`) exists precisely so the event ending at or spanning
  `lastUpdateId` remains the lawful bridge. Q04 follows the official text exactly;
  convergence at the boundary comes from retaining already-received events across an
  internal restart (a derived, evidence-preserving choice documented below), and any
  residual boundary livelock risk is inherited from the official text and left to the
  production integration owner.
- The USD-M law differs from Spot in every load-bearing detail (drop bound, bridge bound,
  continuity field). The two laws must never be blended.

## Depth event payloads

- Spot diff-depth (`depthUpdate`): `e`, `E` (event time ms), `s`, `U` (first update ID),
  `u` (final update ID), `b` (bid updates `[price, qty]` decimal strings), `a` (ask
  updates). Verified in the pinned `web-socket-streams.md`.
- USD-M diff-depth (`depthUpdate`): `e`, `E` (event time ms), `T` (transaction time ms),
  `s`, `U`, `u`, `pu` (final update ID of the previous event), `b`, `a`; after the
  2026-06-30 CM/UM integration payloads append `st` (1 = UM, 2 = CM) and `ps` (pair
  symbol). Observed on the catalog ws-streams page on 2026-07-12; field semantics for
  `U/u/pu` also appear in the hash-pinned llms-full collection. Standard depth excludes
  RPI orders.

## REST depth snapshot shapes

- Spot `GET /api/v3/depth`: response is `lastUpdateId`, `bids`, `asks` only — no exchange
  clock fields. Bids are sorted highest to lowest price, asks lowest to highest (verified
  in the hash-pinned llms-full Spot document). Maximum limit 5000.
- USD-M `GET /fapi/v1/depth`: response is `lastUpdateId`, `E` (message output time, ms),
  `T` (transaction time, ms), `bids`, `asks`. Maximum limit 1000. Observed on the catalog
  REST market-data page on 2026-07-12. RPI orders are excluded.

## Derived choices beyond the quoted texts

Both official procedures say "restart the process from the beginning" without stating
what happens to stream events already received when the restart triggers. Q04 retains
the triggering event and every already-received subsequent event as the new
synchronization buffer (they are genuine, in-order stream evidence of the same
subscription); a reconnect instead discards the old connection's buffer entirely. Q04
additionally holds a freshly accepted snapshot in `RECONSTRUCTING` until at least one
stream event lawfully bridges it, so `COMPLETE` always asserts proven snapshot-stream
continuity, and during that bridging window Spot events ending at or before the
snapshot identity are discarded under the official sync-phase rule (`u <=
lastUpdateId`) rather than the streaming ignore rule (`u < book`). All three choices
are strictly fail-closed refinements: they never accept evidence the official law
rejects.

## Implementation consequences

1. Two separate product state machines with the exact laws above; anomaly classification
   (duplicate/late, overlap, forward gap, `pu` mismatch, reconnect, crossed book, invalid
   or stale snapshot, buffer overflow) is evidence only and never weakens the law.
2. Spot snapshots have no exchange clocks; their acquisition clocks are injected receive
   truth. USD-M snapshots preserve `E`/`T` as exchange truth. Neither is fabricated for
   the other product.
3. Spot deltas carry `E` only; USD-M deltas carry `E` and `T`. No field is copied across
   products, and receive time never impersonates either.
4. Books are bounded windows over exchange-limited snapshots plus applied deltas; a
   `COMPLETE` local book state asserts sequence-law compliance only, never full venue
   depth, latency truth or execution feasibility.
5. Update IDs are unsigned 64-bit integers in transport JSON; Q04 stores them as strict
   bounded integers and never coerces through floats.
