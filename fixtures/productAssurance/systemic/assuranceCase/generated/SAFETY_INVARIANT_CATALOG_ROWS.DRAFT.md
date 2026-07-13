# SAFETY_INVARIANT_CATALOG rows — DRAFT insertion evidence

Target owner: accepted IP-ASSURANCE invariant catalog. Status: `DRAFT`; no shared file was edited.

Every row has dedup classification `EXTENDED` and is a derived, read-only `SYNTHETIC_ONLY` projection with `authorityEffect=NONE`, `missingDataBehavior=UNKNOWN`, required dependency mode `ALL`, evidence-expiry result `UNKNOWN`, and machine response owned by the named existing owner. Its structured component drill-down binds component ID and scope to canonical owner and direct supporting evidence IDs, then exposes source identity, validator, producer, verifier, common-mode domains, assumptions, dependent path, age, expiry, and existing owner without recomputing owner truth.

| Claim ID | Dedup class | Mandatory proposition | Canonical owner | Result consumer | Invariant projection |
| --- | --- | --- | --- | --- | --- |
| `PA-S4-CLAIM-001` | `EXTENDED` | Required inventory has an explicit disposition. | `IP-ASSURANCE.invariant-atlas-owner` | `I08.machine-supervisor` | `PA-S4-INVARIANT-001` |
| `PA-S4-CLAIM-002` | `EXTENDED` | Each enabled required component is discovered and instrumented. | `IP-ASSURANCE.invariant-atlas-owner` | `I08.machine-supervisor` | `PA-S4-INVARIANT-002` |
| `PA-S4-CLAIM-003` | `EXTENDED` | No missing or unsupported required component is hidden by the denominator. | `IP-ASSURANCE.invariant-atlas-owner` | `I08.machine-supervisor` | `PA-S4-INVARIANT-003` |
| `PA-S4-CLAIM-004` | `EXTENDED` | Telemetry completeness is sufficient for the exact claimed posture. | `IP-ASSURANCE.invariant-atlas-owner` | `I08.machine-supervisor` | `PA-S4-INVARIANT-004` |
| `PA-S4-CLAIM-005` | `EXTENDED` | Spot, Futures, and account inputs are temporally coherent for the exact action. | `foundation.multi-leg-risk` | `foundation.multi-leg-risk` | `PA-S4-INVARIANT-005` |
| `PA-S4-CLAIM-006` | `EXTENDED` | Authoritative account and exchange truth is reconciled. | `foundation.reconciliation` | `foundation.reconciliation` | `PA-S4-INVARIANT-006` |
| `PA-S4-CLAIM-007` | `EXTENDED` | Only a current fenced epoch may enter canonical mutation state. | `foundation.execution-coordinator` | `foundation.control-plane` | `PA-S4-INVARIANT-007` |
| `PA-S4-CLAIM-008` | `EXTENDED` | Live controls map to canonical commands. | `foundation.control-plane` | `foundation.control-plane` | `PA-S4-INVARIANT-008` |
| `PA-S4-CLAIM-009` | `EXTENDED` | Required rollback and recovery paths have current scenario-bounded evidence. | `foundation.reconciliation` | `foundation.execution-coordinator` | `PA-S4-INVARIANT-009` |
| `PA-S4-CLAIM-010` | `EXTENDED` | Model evidence matches the approved cohort and version. | `Q.advisory-inference` | `engine.strategy-authority` | `PA-S4-INVARIANT-010` |
| `PA-S4-CLAIM-011` | `EXTENDED` | Displayed, tested, and deployed SHAs agree. | `I00.deployment-authority` | `I08.machine-supervisor` | `PA-S4-INVARIANT-011` |
| `PA-S4-CLAIM-012` | `EXTENDED` | Independent sentinel and paging evidence is current. | `I00.external-watchdog` | `I08.machine-supervisor` | `PA-S4-INVARIANT-012` |
| `PA-S4-CLAIM-013` | `EXTENDED` | Diagnostic-plane posture is explicit. `NOT_CONFIGURED` is valid and cannot degrade deterministic product readiness. If posture is `SHADOW`, `OWNER_GATED`, or `ACTIVE`, containment, permission, provider-outage, privacy, and independent evidence must be current. | `IP-ASSURANCE.diagnostic-boundary` | `I08.machine-supervisor` | `PA-S4-INVARIANT-013` |

Every positive support record names one independent-basis evidence ID; that basis certifies exactly the same supported evidence ID, so reused, orphaned, fanned-out, or non-reciprocal certifications cannot support a claim. Insertion requires director fan-in, accepted production-schema mapping, and the existing catalog owner's review. These rows do not mount the reference evaluator. An LLM may explain a projection but cannot restore support. The projection never issues halt, close, repair, demotion, deployment, capital, order, borrow, repay, transfer, or withdrawal commands.
