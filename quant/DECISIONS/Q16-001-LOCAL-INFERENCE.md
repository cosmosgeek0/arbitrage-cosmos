# Q16-001 — bounded local inference over verified accepted truth

Status: `DECIDED`

Date: 2026-07-13

## Context

Q16 must prove the complete raw-fixture-to-protocol-envelope serving path without
creating a second strategy, feature, model, calibration, registry, risk, capital or
execution authority. The accepted Q15 champion is `logistic:v1`, but its accepted
card explicitly says `loadableModelPayload=false` and the accepted registry posture
is `ABSTAIN_UNKNOWN`. Q13 also keeps deep candidates at
`FAIL_DATA_INSUFFICIENT` / `REFERENCE_ONLY`.

The only truthful serving result is therefore a protocol-valid advisory assessment
with no model score, no calibrated probability, unknown net economics and explicit
abstention reasons.

## Decision

1. Q16 is an additive local-process adapter. It invokes the accepted Q04 replay and
   Q06/Q07 feature owners, then consumes verified Q12/Q13/Q15 evidence. It does not
   recompute or replace any owner.
2. The serving manifest is an exact allowlist. It pins path, kind, media type,
   schema, version, size and digest for every controlling artifact, the dependency
   lock, both accepted Q06/Q07 golden registries and the full imported Q06/Q07 source
   closure. A loaded manifest must also match current accepted bytes.
3. Serving lineage can only be constructed by the verified artifact loader. Model
   and calibration availability both participate in readiness. Safe abstention
   serviceability is reported separately from advisory readiness.
4. Source event and receive times come from accepted Q04 event truth. Caller cutoff,
   request generation and trusted evaluation time cannot rewrite those timestamps.
   Every consumed event precedes receive, cutoff and generation; stale or expired
   consumption remains a valid `ABSTAIN_UNKNOWN` result.
5. The service is one-process, concurrency-one and request-correlated. Threaded local
   handlers exercise an application-level bounded wait queue; saturation, timeout
   and shutdown have distinct errors and counters. A trusted clock is injected and
   resolved per request.
6. Unix-domain sockets are the default transport. The parent is owner-only `0700`,
   the socket is `0600`, collisions are rejected, and cleanup occurs only when the
   captured device/inode still identifies the socket this process created. Optional
   TCP accepts only literal `127.0.0.1` or `::1`.
7. Frozen protocol bytes are validated without changing the frozen schema or its
   Node harness. Q16's serializer admits only a deterministic cross-language numeric
   subset. Booleans cannot satisfy numeric constants, unsafe integers reject, and
   unavailable or ambiguous assessment truth must be `ABSTAIN_UNKNOWN`.
8. Generated Python and Node clients preserve the committed raw request bytes,
   enforce time and frame bounds, reject duplicate/non-finite/unsafe/forbidden
   content, embed the frozen schema, recursively validate the complete returned
   envelope, and apply Q16's fail-closed advisory invariant.

## Consequences

- Q16 is serviceable as a local safe-abstention process, not as a ready model server.
- No streaming, public listener, model deserializer, environment read, network
  source, account source or private/signed exchange path is introduced.
- No score, probability, expected value, edge claim or production-readiness claim is
  fabricated.
- A later accepted loadable model and calibration artifact would require a new
  accepted manifest/lineage generation; it cannot be smuggled through this decision.

## Primary implementation guidance reviewed

- Python 3.13 `socketserver`, `socket`, `os`, `stat`, `json` and `hashlib`
  documentation.
- RFC 8785 canonical JSON requirements and errata. Q16 deliberately calls its
  bounded implementation protocol canonicalization, not full JCS.
- NIST AI RMF Core guidance for explicit knowledge limits and fail-safe outcomes.
