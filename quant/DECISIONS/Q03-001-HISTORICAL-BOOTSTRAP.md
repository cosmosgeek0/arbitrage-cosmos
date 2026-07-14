# Q03-001 — bounded historical bootstrap and owner-correct forward seam

Status: `ACCEPTED_FOR_Q03_IMPLEMENTATION`

Date: 2026-07-12

## Decision

Q03 will import exactly one official Binance Spot daily aggregate-trade archive into a temporary
accepted Q02 lake revision and commit only immutable hashes, counts, time bounds and derived
EventAtlas evidence. The selected source is BNBUSDT on 2017-11-06, bound to official ZIP digest
`2de38a97c23e86d2aafc4edabbd891646210a69a6194cb65d0ab9e8c88fda893`.

The archive is permitted only as directive-scoped, local/derived research evidence. It is not
called an admitted production source because archive-data licensing, raw redistribution and a
complete point-in-time instrument identity remain unresolved. Raw external bytes never enter
Git.

Forward evidence remains owned by `intelligenceRuntime`. Q03 creates only a pure read-only
fixture envelope, a nullable-source-time schema and a bounded drop-new queue contract. It does
not create or attach a socket, REST poller, runtime sink, cache, snapshot loop, operational store
or rate budget. Real Q delivery remains `MISSING/BLOCKED` until a later accepted integration
supplies the missing clocks, ordinals, exact payload and persistence evidence.

Tardis remains `REFERENCE_ONLY`: no subscription, dependency, credential, download or licensed
raw data is required by Q03.

## Source admission posture

- Official access does not prove redistribution rights.
- A checksum proves byte agreement with the published sidecar, not economic truth or permanence.
- URL plus a changed official checksum creates a new immutable revision.
- Source-card review is `REVIEW_ONLY_NO_ADMISSION` and cannot register a producer.
- Synthetic bridge fixtures prove the contract only, never live market coverage.

## EventAtlas posture

The registry begins with two versioned tiers. `HISTORICAL_COARSE` binds the real sample campaign;
`FORWARD_HIGH_FIDELITY` binds only synthetic bridge fixtures and reports real coverage
`MISSING/BLOCKED`. Multiple absolute and relative candidate rules are versioned discovery
descriptors, not event truth. Zero candidates is valid. Later outcomes, objective labels,
probabilities, profitability, causal intent and actionability remain unavailable.

## Rejected alternatives

- Downloading a broad symbol/date archive corpus: exceeds the bounded phase and worsens license
  exposure without adding contract proof.
- Treating an archive directory as historical universe truth: violates point-in-time identity.
- Using candle data as historical L2 or receive-time evidence: fabricates unavailable truth.
- Opening a Q-owned production socket or REST loop: duplicates canonical runtime ownership.
- Calling a synthetic fixture live coverage or implementing Q04/Q05 logic early: violates phase
  order and evidence posture.

## Evidence

See `quant/docs/Q03_SOURCE_CONTRACT_REFRESH.md`. This decision adds no authority and does not
modify the frozen protocol, lock or canonical runtime.
