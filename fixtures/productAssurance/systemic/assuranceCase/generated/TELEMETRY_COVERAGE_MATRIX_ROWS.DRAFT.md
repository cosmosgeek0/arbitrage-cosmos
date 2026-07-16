# TELEMETRY_COVERAGE_MATRIX rows — DRAFT insertion evidence

Target owner: accepted IP-ASSURANCE telemetry-coverage manifest. Status: `DRAFT`; no shared file was edited.

| Draft row | Dedup class | Expected evidence | Missing/expiry behavior | Owner/wiring state |
| --- | --- | --- | --- | --- |
| `PA-S4-COVERAGE-001` required inventory graph | `EXTENDED` | Release-bound explicit dispositions for all 13 mandatory claim IDs | Missing mandatory ID is visible coverage `FAIL`; no denominator shrink | `IP-ASSURANCE.invariant-atlas-owner`; `SYNTHETIC_ONLY` fixture |
| `PA-S4-COVERAGE-002` instrumentation/denominator chain | `EXTENDED` | `CLAIM-001 -> 002 -> 003 -> 004`, with direct inventory and telemetry evidence plus structured component-to-owner-to-evidence bindings | Missing, silent, expired, unsupported, or unbound leaf propagates `UNKNOWN` through every ancestor | `I08.machine-supervisor` consumption is an insertion request; not wired |
| `PA-S4-COVERAGE-003` S1 assumption seam | `EXTENDED` | Exact `ab33b37...` provenance and stable `PA-S1-AS-*` result identities | Missing, changed-owner, stale, `FAIL`, or `UNKNOWN` assumption input makes each affected derived claim `UNKNOWN`; no S1 mutation | S1 read-only input; fan-in pending |
| `PA-S4-COVERAGE-004` evidence independence | `EXTENDED` | Separate producer/verifier; typed clock, store, network, credential, code-path, telemetry-exporter, model-family, process, host, and organization domains; explicit common-mode list; reciprocal one-basis-to-one-evidence certification | Self-verification, shared domain, declared common mode, missing basis, non-reciprocal link, or basis fan-out is `UNKNOWN` for positive support | Packet reference evaluator only |
| `PA-S4-COVERAGE-005` sentinel/paging | `EXTENDED` | Current out-of-band receipt and declared independent failure domains | Expiry or common mode invalidates `CLAIM-012` and dependent posture; no cached green | External configuration remains owner-controlled |
| `PA-S4-COVERAGE-006` diagnostic posture | `EXTENDED` | Explicit `NOT_CONFIGURED`, `SHADOW`, `OWNER_GATED`, or `ACTIVE`; configured states bind five semantically independent evidence families | `NOT_CONFIGURED` is valid and cannot degrade deterministic product readiness; a configured missing, aliased, expired, or non-independent family is `UNKNOWN` | `IP-ASSURANCE.diagnostic-boundary` remains canonical; no runtime added |

Insertion requires the existing manifest owner's release-binding and `I08.machine-supervisor` projection mapping. This packet supplies no telemetry producer, exporter, store, socket, or supervisor. An LLM may explain but cannot restore support. The projection issues no halt, close, repair, demotion, deployment, capital, order, borrow, repay, transfer, or withdrawal commands.
