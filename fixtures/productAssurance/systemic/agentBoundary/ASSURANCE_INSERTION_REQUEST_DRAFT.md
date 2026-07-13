# Agent-boundary assurance insertion requests — DRAFT only

These rows are packet-local handoff material. They create no command, route,
runtime, persistence, supervisor, provider, or UI authority. The canonical
owners must independently review, implement, test, and read back any insertion.
The machine-readable rows are in `ASSURANCE_INSERTION_REQUEST_DRAFT.json`.

| Row | Requested owner | Target seam | Wiring state |
| --- | --- | --- | --- |
| `agent-boundary.draft.diagnostic-kill-control` | L14/IP-CONTROL + I09 canonical Control Plane registry owner | Separate diagnostic-plane latch; never overload financial `SET_KILL_SWITCH` | `PENDING_BACKEND:SET_DIAGNOSTIC_PLANE_KILL` |
| `agent-boundary.draft.provider-workload-identity` | I03 lifecycle + I08 supervisor + I13 deployment/configuration owners | Existing provider boundary and lifecycle projection; `NOT_CONFIGURED` valid | `PENDING_BACKEND:MOUNT_DIAGNOSTIC_PROVIDER_WORKLOAD_IDENTITY_PROJECTION` |
| `agent-boundary.draft.diagnostic-worker-cockpit` | I08 supervisor + IP-CONTROL/I10 cockpit adapter owner | Existing Health, Control Room, Logs, and incident surfaces; no new component or shell | `PENDING_BACKEND:PROJECT_DIAGNOSTIC_WORKER_ASSURANCE_FIELDS` |

The kill-control draft immediately revokes diagnostic capability, blocks new
provider/tool/isolated-patch work, commands bounded cancellation of in-flight
work, rejects late results, and requires a durable cancellation receipt. It
preserves append-only trace retention, ledgering, deterministic safety,
reconciliation, risk reduction, exposure visibility, and product readiness.
The diagnostic plane cannot re-enable itself. The machine-readable row carries
the proposed control ID and group, target type, closed payload schema, safe
bounds, default, effect, required posture/authority, confirmation, expiry,
reversibility, preview provider, invariants, telemetry, and pending wiring.
Only an owning implementation with preview, exact revision/digest, durable
receipt, and independent readback may ever change the row from
`DRAFT`/`PENDING_BACKEND`.
