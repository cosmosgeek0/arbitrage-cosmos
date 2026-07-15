# F0 Dock insertion request

No shared change is implemented. Any future integrator must obtain canonical-owner decisions and use exactly these seams:

1. `foundation/control:canonical-capability-egress-policy-decision`
   - Approve or deny requested capabilities, egress, retention, resource budgets, and lifecycle requests.
   - Dock grants no permission itself.
2. `product-assurance:post-mount-isolation-and-removal-proof`
   - Prove mounted import/process isolation, crash containment, restart behavior, disable, rollback, removal, and uninstall.
   - Dock conformance is not this proof.
3. `systemIntegration/supervisor:read-only-module-inventory-projection`
   - Consume `ModuleInventoryProjectionV1` without recomputing or mutating canonical product truth.
   - Mounting and controls remain director/canonical-owner work.

## Blocked annotation facet

- `ANNOTATION_ADAPTER`: the canonical Q owner must freeze one lossless point-in-time annotation contract that preserves source, cutoff, revision, and retraction lineage. Until then, blocker `CANONICAL_Q_ANNOTATION_REVISION_RETRACTION_CONTRACT_UNRESOLVED` remains and only F11 is blocked.

## Product incident owner

- `PRODUCT_INCIDENT`: the director must ratify one canonical owner and versioned contract for incident identity, grouping, fingerprint, severity, lifecycle, acknowledgement, and resolution. Until then, `INCIDENT_OWNER_NOT_CONFIGURED` remains. This shared-owner gap does not block or weaken an unrelated provider facet; no projection, Ledger record, or speculative AI-Ops artifact may impersonate lifecycle authority.

Non-requested and forbidden: product wiring, routes, persistence, live/test orders, credentials, transports, runtime mounting, canonical writes, scenario execution, cockpit mutation, model promotion, canary, rollback control, and deployment changes.
