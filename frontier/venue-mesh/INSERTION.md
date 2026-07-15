# F1 VenueMesh future insertion request

This file is a non-authoritative request. It implements no shared edit, registration, mount, transport, retention, deployment, control, or mutation.

Machine-readable request: `contracts/v1/insertion-request.v1.json`.

## Intended shared seams

| Seam | Canonical owner decision required |
|---|---|
| Q `DataSourceCard` and external-evidence governance | Approve exact source, hypothesis value, lawful access, geography, authentication, sampling, retention, redistribution, point-in-time capture, and observable failure state. |
| `intelligenceRuntime` public acquisition/lifecycle | Own any future read-only live acquisition, schema versioning, rate state, gap/reconnect/resnapshot, source health, and checkpoint semantics. |
| `intelligenceFoundation/evidence` | Accept a lossless adapter into canonical `MarketEvidenceEnvelopeV1`; F1 must not become a second canonical evidence producer. |
| `systemIntegration/sourceRegistry` | Enforce one semantic producer and reject duplicate venue/source ownership. |
| L executable semantics | Decide product/settlement/multiplier conversion, venue availability, executable depth, costs, and any future order feasibility. |
| existing `newsContext` collector | Provide an adapter over already-owned official venue/news/status output; do not add a second collector/cache. |
| product/cockpit integration | Grant a future release recipe/facet and canonical projection owner before any mounted UI exists. F1 currently has no cockpit facet. |

Every intended seam is named in the machine-readable request; no other seam is requested.

Exact blocker: `CANONICAL_SOURCE_HEALTH_MAPPING_OWNER_REQUIRED`. Prestage maps every fixture to canonical runtime posture `STOPPED/UNKNOWN` while losslessly preserving its extension source-health state; only `intelligenceRuntime` may define a future live lifecycle/health mapping.

## Future owner-gated tests

- exact legal/source/geography approval readback and expiry behavior;
- canonical source-registration uniqueness;
- public live-transport isolation with zero credential/private-endpoint reachability;
- rate-limit, maintenance, reconnect, gap, resnapshot, restart, and removal proof under canonical lifecycle ownership;
- point-in-time capture, retention, redistribution, and deletion-policy proof;
- L-owned executable identity, settlement, multiplier, tick/size, depth, cost, and feasibility proof;
- post-mount product-assurance isolation and removal proof;
- optional cockpit projection only after the release recipe grants that facet.

## Explicit non-request

This prestage does not request or implement live credentials, signed/private calls, deposits, withdrawals, transfer-out, borrow/repay, orders, leverage/margin mutation, canonical writes, source admission, persistence, deployment, or Main integration.

`mutationImplemented: false`; `authorityClass: NO_AUTHORITY`; `networkMode: FIXTURE_ONLY`.
