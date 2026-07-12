# EDGE_PROTOCOL_V1 — frozen Q↔L interchange contract

**Status:** FROZEN at PROTOCOL_SHA (director-owned). Neither lane edits `packages/edge-protocol/**`, `packages/edge-protocol-tests/**`, or this file; lanes submit protocol-change requests to the director.
**Normative representation:** `packages/edge-protocol/schema/edge-protocol-v1.schema.json` (JSON Schema 2020-12, self-contained `$defs`). This prose maps fields to canonical owners; the schema is the law. Generated clients may not contain handwritten semantic copies.

## What this is — and is not

An interchange **boundary** between the Q lane (`quant/**`, advisory research) and the L lane / canonical product. It owns **no semantics**: evidence, freshness, outcomes, health, proposals, decimals, clocks, and errors all keep their canonical owners (ARCHITECTURE.md Part II — the accepted System Authority Map; `SYSTEM_AUTHORITY_MAP.md` itself is archived at `docs/archive/`, and no separate `LIVE_PRODUCT_AUTHORITY_MAP.md` exists — ARCHITECTURE.md Part II is that map).

## Canonical mapping (concept → owner → protocol representation)

| Concept | Canonical owner | Protocol representation | Loss/unknown behavior |
| --- | --- | --- | --- |
| Time & freshness | `foundation/contracts/time.ts` (`SourcedTimestamp`, `evaluateFreshness`, `isValidUtcMillis`) | `*TimeMs` UTC-millisecond integers within foundation's valid range; source event time nullable, receive time required, never merged | absent source time = `null`, never receive time |
| Acquisition authority | `foundation/contracts/authority.ts` (`DataAuthority`) | `truthLabel` (`LIVE`\|`REPLAY`\|`SYNTHETIC`) + `completeness`; adapters map via the convergence table (LIVE→LIVE_PUBLIC etc.); protocol never upgrades authority | unknown → `UNKNOWN` completeness, fail-closed downstream |
| Completeness | Runtime/MI/Foundation tri-dialect (authority map §"Authority and completeness") | enum `COMPLETE`\|`PARTIAL`\|`SAMPLED`\|`UNAVAILABLE`\|`UNKNOWN` | `SAMPLED` carries lower-bound meaning; never coerced to `COMPLETE` |
| Money/quantity values | Capital exact-decimal convention (`capitalFoundation`) | decimal **strings** (`^-?[0-9]{1,24}(\.[0-9]{1,18})?$`) + explicit unit/currency fields | missing value = `null`, never `"0"` |
| Failures | `foundation/contracts/failures.ts` (`StructuredFailure`, 9 frozen fields) | `ProtocolErrorV1` mirrors those nine semantics 1:1; codes UPPER_SNAKE | free-form throws never cross the boundary |
| Reconciliation state | `foundation/reconciliation` vocabulary | verbatim enum `EXACT`\|`PENDING`\|`PARTIAL`\|`AMBIGUOUS`\|`DIVERGED`\|`STALE`\|`UNAVAILABLE` | status is truth, not an exception |
| Proposal identity | Engine IDs (`bp_*`, `vp_*`) stay opaque; ledger stores alias edges | `proposalRef`/`sourceEventIds` are opaque scoped strings; **no proposal authority** — `PROPOSE_CONSIDERATION` only submits to the canonical strategy owner via the authority-map adapter | protocol cannot create/mutate proposals |
| Outcome/ledger truth | Existing `Ledger` (sole durable store) + execution/reconciliation owners | `EdgeOutcomeEnvelopeV1`/`EdgeFeedbackEnvelopeV1` are immutable, deduplicated **projections** with source IDs/revisions + `contentHash` | never a second outcome/ledger authority |
| Component health | Supervisor read-model vocabulary; release labels (`BUILT_AND_TESTED`…`MISSING`) | `EdgeBrainHealthV1` state enum `OK`\|`DEGRADED`\|`STALE`\|`FAILED`\|`UNKNOWN`; silent/stale can never be `OK` | unknown → `UNKNOWN`, not green |
| Instrument identity | Point-in-time instrument master (Q lake) mapped to existing universe/exchange-info owners | `instrumentGraph` {venue, product, symbol, canonicalAsset, spot/perp/borrow legs} | missing leg = `null` with named reason |

## Envelope registry (all defined in the single schema file)

1. `MarketEvidenceEnvelopeV1` — granular evidence record (trade/book/mark/funding/OI/liquidation/context) with full time separation, source lineage, hashes, quality flags.
2. `EdgeAssessmentEnvelopeV1` — versioned research **second opinion**; advisory actions `IGNORE|WATCH|FOCUS|PROPOSE_CONSIDERATION|ABSTAIN_UNKNOWN`; embeds `EconomicAssumptionContextV1`; forbidden fields rejected (see below).
3. `EdgeOutcomeEnvelopeV1` — immutable outcome projection (cohort `ACTED|REJECTED|EXPIRED|MISSED|CONTROL`; label `REAL|HYPOTHETICAL|REPLAY`).
4. `EdgeFeedbackEnvelopeV1` — deduplicated async feedback delivery wrapper (dedupeKey + payloadHash).
5. `EdgeBrainHealthV1` — Q inference/brain health heartbeat for the machine graph.
6. `ProtocolErrorV1` — the only failure shape crossing the boundary.
7. `EconomicAssumptionContextV1` — sanitized economics assumptions (`$defs` embedded; referenced by assessments).

## Hard laws (enforced by schema + tests)

- **Versioning fail-closed:** every envelope carries `schema` (exact name), `version: 1`, integer `revision ≥ 0`. Consumers MUST reject unknown `schema` or `version ≠ 1` with `ProtocolErrorV1` code `PROTOCOL_VERSION_UNSUPPORTED`. Downgrade is never silent.
- **Unknown fields rejected:** `additionalProperties: false` everywhere. An unknown field is a compatibility event, not noise.
- **Forbidden content:** keys matching `/signature|apiKey|api_key|apiSecret|secret|passphrase|password|privateKey|listenKey|credential|approvedCapital|orderRequest|leverageMutation|liveSendPermission/i` are rejected recursively anywhere in any envelope. No balances, account identifiers, permission mutations, or order authority.
- **Size bounds:** one serialized envelope ≤ 262,144 bytes; arrays bounded per schema (`maxItems`); strings bounded (`maxLength`).
- **Idempotency:** outcomes/feedback carry `contentHash`/`dedupeKey`; identical redelivery is a no-op for consumers.
- **Determinism:** canonical serialization = UTF-8 JSON, object keys sorted lexicographically, no NaN/Infinity, decimals as strings. Round-trip must be byte-stable (tested).
- **Advisory-only:** nothing in this protocol authorizes money movement, order creation, capital, risk, or control mutation. Missing fee/funding/borrow/latency/recovery truth in an assessment normally forces `ABSTAIN_UNKNOWN`; Capital/Risk always recompute final economics from current operational truth.

## Tests

`node packages/edge-protocol-tests/protocol.test.mjs` — dependency-free schema-subset validator; validates every fixture (valid AND invalid), forbidden-key rejection, version fail-closed, canonical round-trip stability, and size/array bounds. Run from repo root; exits non-zero on any failure.
