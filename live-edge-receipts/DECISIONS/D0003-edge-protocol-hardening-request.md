# D0003 — EDGE_PROTOCOL_V1 hardening request

Status: `REQUESTED_FROM_DIRECTOR`

Phase: `L01`

Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`

## Constraint

`EDGE_PROTOCOL_V1.md`, `packages/edge-protocol/**` and `packages/edge-protocol-tests/**` remain frozen and unchanged. L01 implements conservative consumer-side protection under `server/src/liveEdge/**`; it does not silently redefine the cross-lane protocol.

## Findings

1. The dependency-free frozen subset validator uses inherited membership for schema properties. A schema-invalid own key such as `constructor`, `__proto__` or `toString` can be mistaken for a declared property. The L consumer uses `Object.hasOwn` and rejects dangerous object keys.
2. The invalid fixture named `float-money-rejected` contains invalid `payloadHash: "zzzz"`; that earlier error can mask whether numeric money is independently rejected. L01 adds a local numeric-money case.
3. Frozen tests do not independently exercise the 262,144-byte boundary, schema array maxima, canonical duplicate-key ambiguity or unsafe-integer values. L01 adds local cases.
4. The protocol does not freeze transport framing, heartbeat TTL, queue/backpressure policy, assessment fingerprint algorithm, conflict semantics or immutable route fields across revisions.
5. `EdgeOutcomeEnvelopeV1.contentHash` and feedback payload-hash construction/coverage are not defined strongly enough for two independent lanes to reproduce them without an adapter policy.
6. `EdgeBrainHealthV1.modelVersions` and `driftState` are optional in the schema, while safe readiness needs explicit unknown/degraded behavior.

## Requested director action

At a separately coordinated future protocol revision:

- replace inherited property membership with own-property checks;
- add isolated numeric-money, byte/array, inherited-key, duplicate-key and unsafe-integer fixtures;
- freeze cross-lane fingerprint/hash coverage and revision-conflict semantics if Q and L must reproduce them independently;
- decide whether transport framing/health lineage fields belong in protocol or remain per-lane adapter policy;
- issue a new protocol SHA and compatibility instructions to both lanes.

## Current L01 behavior

Until that revision, L01 fails conservatively using labeled `L_ADAPTER_POLICY_V1` configuration, validates against the exact frozen schema bytes, and remains an additive advisory `LANE_READY` seam. This request does not block L01 and grants no proposal, capital, risk, control, execution or order authority.
