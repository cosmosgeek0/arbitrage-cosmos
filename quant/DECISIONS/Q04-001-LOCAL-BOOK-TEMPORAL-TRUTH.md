# Q04-001 — fail-closed local book reference model and temporal truth

Status: `ACCEPTED_FOR_Q04_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Q04 implements the deterministic Spot and USD-M local order-book reconstruction reference
model as a pure library: exact-decimal ladders, the two official product sequence laws
implemented separately and exactly as researched in
`quant/docs/Q04_BOOK_CONTRACT_RESEARCH.md`, explicit injected clock separation, typed
snapshot request intents, fail-closed anomaly handling and byte-identical deterministic
replay.

The engine owns no transport. Snapshot acquisition is expressed as a versioned request
intent addressed to the canonical `intelligenceRuntime` boundary; the caller supplies
snapshots and deltas as typed evidence. Real forward depth delivery remains
`MISSING/BLOCKED` from Q03, so every executable Q04 proof runs on `SYNTHETIC` or `REPLAY`
fixtures that are labeled as such and never presented as observed market evidence.

## Fail-closed law

- A book is model-eligible only in `COMPLETE` state after a fully validated
  synchronization.
- Spot follows the official law exactly: stale events (`u < bookUpdateId`) are ignored
  and counted; overlap events (`U <= bookUpdateId + 1 <= u`) apply; a forward gap
  (`U > bookUpdateId + 1`) discards the book, transitions to `GAPPED`, halts
  model-eligible emission and emits a snapshot request intent.
- USD-M follows its official law exactly: after synchronization any event whose `pu`
  differs from the previous `u` — including re-delivered older events — forces
  reinitialization. There is no Spot-style stale-ignore rule for USD-M because the
  official text grants none.
- Reconnects (connection generation change), crossed ladders, invalid snapshots, buffer
  overflow and every other anomaly likewise discard local state and require full
  resynchronization. Anomaly classification is evidence, never a repair path.
- The stale-snapshot retry for USD-M (bridge condition unsatisfiable → new snapshot) is a
  derived necessity, recorded as derived in the research note, not quoted official text.

## Temporal truth

- Library code reads no ambient clock, environment or randomness. Exchange event time
  (`E`), transaction time (`T`, USD-M only), receive wall/monotonic clocks, receive
  ordinal and processing step are injected and preserved separately.
- Spot snapshots carry no exchange clock and none is fabricated; USD-M snapshots preserve
  `E`/`T`. Receive time never impersonates exchange time.
- Transitions and applied events carry full clock evidence plus a monotonic engine step
  counter, making replay evidence exactly ordered and hashable.

## Rejected alternatives

- One shared product-agnostic sequence law: blends two officially distinct laws and
  invents semantics neither document grants.
- Silently dropping USD-M duplicates while synced: officially a `pu` violation; ignoring
  it would fabricate continuity the venue did not assert.
- Repairing gaps from buffered partial evidence without a snapshot: violates §10.5 and
  fabricates book state.
- Emitting features/labels from `RECONSTRUCTING` books: violates the model-eligibility
  law of the directive.
- Floating-point prices/quantities: destroys exactness; ladders use exact scaled
  decimals.
- A Q-owned snapshot REST client: duplicates canonical runtime ownership; Q04 emits
  intents only.
