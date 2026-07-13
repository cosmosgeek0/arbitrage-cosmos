# Q16 local inference and generated protocol kit

## Acceptance chain

```text
Q16 synthetic raw fixture
  -> accepted Q04 deterministic replay
  -> frozen MarketEvidenceEnvelopeV1
  -> accepted Q06/Q07 feature implementations
  -> verified Q13/Q15 model availability
  -> accepted Q12 calibration lineage
  -> frozen EdgeAssessmentEnvelopeV1
```

The six Q16 stages are `RAW`, `EVIDENCE`, `FEATURES`, `MODELS`, `CALIBRATION` and
`ASSESSMENT`. Each stage has a deterministic SHA-256 digest and binds its immediate
parent. Stage metadata stays in Q16 evidence; it is never added as an unknown field
to a frozen envelope.

## Truth and ownership

- Raw input is `SYNTHETIC_ONLY` and binds the accepted Q04 Spot script digest.
- Market event and receive times are derived from Q04 steps. The generated cutoff
  and generation times may only follow those source times.
- Five feature values are produced by existing `quant_edge.features` and
  `quant_edge.micro` owners. Their golden registries and imported source closure are
  hash- and size-pinned by the serving manifest.
- Q15 supplies registry identity and posture, not a fitted payload. Q13 supplies an
  insufficient-data gate, not a deep score. Q12 supplies accepted synthetic
  calibration lineage, not a Q16 probability.
- The final assessment is `ABSTAIN_UNKNOWN`; predictions are empty, calibrated
  probability is absent and net expected value is `UNKNOWN`.

## Boundary contracts

The local request supports `ASSESS`, `BATCH_ASSESS`, `HEALTH`, `READINESS`,
`LINEAGE` and `METRICS`. Request and response frames, batch rows, symbols, horizons,
queue capacity, concurrency and time are explicitly bounded. JSON decoding rejects
invalid UTF-8, duplicate keys, non-finite and negative-zero values, excessive depth,
unknown request fields and forbidden secret/order-authority keys.

The frozen protocol validator resolves only local schema references and implements
the schema subset used by the frozen protocol. Its canonical bytes match the frozen
Node implementation over valid fixtures and deterministic numeric vectors. Integers
outside JavaScript's safe range and unsupported high-precision floats reject.

The assessment semantic gate is stricter than shape alone: unknown economics,
missing or conflicting evidence, empty predictions, non-stable drift/OOD truth,
stale/partial/gapped source quality, or any abstention reason makes every action
except `ABSTAIN_UNKNOWN` invalid.

## Service and transport lifecycle

The service processes one request at a time. Concurrent local handlers wait in a
bounded application queue and retain their own response correlation. Queue overflow
returns `QUEUE_FULL`; bounded wait expiry returns `REQUEST_TIMEOUT`; a closed service
returns non-retryable `SERVICE_CLOSED`. Completion is counted only after the response
passes its byte limit. Protocol, transport, timeout, saturation and shutdown counters
remain distinct.

The transport resolves an injected trusted clock for every request. UDS nodes use a
private owner-only parent and owner read/write socket. Startup never removes a race
winner, and shutdown removes only a socket whose device/inode matches the identity
captured after this process bound it. Closing the handle stops `serve_forever`, closes
handlers, closes the service and then performs identity-safe cleanup.

Optional TCP is limited to literal IPv4/IPv6 loopback. Hostnames, wildcard binds and
public addresses reject before bind.

## Generated kit

`quant/generated/q16/` contains:

- exact request, wrapped response, evidence and assessment fixtures;
- a full serving manifest and deterministic inference campaign;
- strict Python and Node UDS clients;
- integration instructions in campaign Markdown; and
- a protocol-kit manifest that hashes every generated file except the manifest
  itself.

The clients offer raw file/byte request APIs so JavaScript never parses and rounds
the accepted Q04 nanosecond integers before sending. Object request APIs reject
unsafe integers. Both clients use strict bounded response decoding, embed the frozen
protocol schema, recursively validate the returned frozen envelope and enforce the
same fail-closed assessment invariant.

## Integration posture and limitations

Q16 has no product wiring. A director may later launch the local process and consume
the generated kit, but must inject a real trusted clock and preserve UDS or literal
loopback containment. No public listener, streaming claim or shared Node mutation is
part of Q16.

This phase proves deterministic plumbing and safe abstention only. It does not prove
edge, model accuracy, calibration quality on observed markets, latency suitability,
capacity, production availability or permission to act. It adds no order, capital,
risk, borrow/repay, transfer, withdrawal, leverage, margin or execution authority.
