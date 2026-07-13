# S8 stability insertion rows — DRAFT only

Status: `DRAFT_INSERTION_REQUEST` · evidence: `SYNTHETIC_ONLY` · configuration:
`NOT_CONFIGURED` · capability: `SYNTHETIC` · runtime authority: none.

This subtree extends no shared registry or report directly. The machine-readable rows in
`rows.mjs` are proposed inputs for canonical-owner adjudication. Production operation IDs,
operation classes, registered command identities, owners, implementation/runtime paths, and
the insertion SHA are deliberately `null` with `OWNER_CONFIRMATION_REQUIRED` or pending fan-in
status. Packet-local draft row IDs are provenance only; they are not registered operation IDs.

Every row carries the amendment §12 fan-in metadata:

- schema version, draft state, and evidence state;
- canonical target and proposed runtime owner;
- explicit runtime-owner and runtime-path confirmation status;
- a null insertion SHA plus pending-commit/director-fan-in status;
- linked IP-PROOF scenario IDs;
- configuration and capability status;
- supersession disposition.

| Draft family | Rows | Canonical insertion target | Non-claim |
| --- | ---: | --- | --- |
| `RELIABILITY_POLICY_REGISTRY` | 4 | canonical registry generator, then confirmed runtime owners | abstract laws only; no operation or command is registered |
| `RESOURCE_AND_BACKPRESSURE_REPORT` | 8 exact resource families | I00 report plus confirmed resource owners | read-only circuit evidence; no close, reset, throttle, shed, or execute authority |
| `AUTONOMY_CLOSURE_REPORT` | 5 | I00 closure owner | no autonomous action granted |
| `ASSURANCE_INSERTION_REQUEST` | 7 | owner and path confirmed during fan-in | no shared file edited and no composed scenario claimed passed |

The four reliability rows cover:

1. bounded inherited deadlines, child budgets, cancellation intent, and late-result law;
2. long-lived lease/heartbeat/fence evidence;
3. external-mutation cancellation intent, durable late truth, and mandatory authoritative
   reconciliation;
4. the automatic local repair/control-loop contract from amendment §9.2.

The cancellation rows bind the exact law identity
`LATE_EXTERNAL_FACTS_DURABLY_RETAINED_STALE_EPOCH_CANNOT_AUTHORIZE_NEW_WORK_V1`.
The repair row binds
`REPAIR_TRUTH_RETAINED_STALE_LEASE_OR_FENCE_COMPLETION_REJECTED_V1` and
`RESTORE_CAMPAIGN_ATTEMPTS_BUDGETS_COOLDOWN_LEASE_FENCE_AND_LATE_RESULT_LAW_V1`.
These identifiers prevent prose substitutions from silently weakening retained truth,
stale-completion rejection, or restart continuity.

These rows intentionally do not preselect a production operation class or command identity.
The canonical owner must bind those details, reconciliation lookup, retry/circuit budgets,
observability evidence, and runtime paths before insertion. Until then, the rows remain
`NOT_CONFIGURED` and cannot be treated as runtime policy.

The resource rows cover exactly LLM tokens, APIs, Binance rate limits, telemetry storage,
replay compute, database/WAL growth, cloud cost, and background-job concurrency. Each row has
an explicit read-only circuit-evidence draft with unknown burn, budget, forecast, consumers,
throttling observation time and maximum age, circuit freshness/fully ordered transitions plus
independent owner/failure-domain close proof, and canonical response
until the existing owner supplies evidence. Unknown values
remain `null` with `RUNTIME_EVIDENCE_NOT_SUPPLIED_BY_CANONICAL_OWNER`; they never become zero.

Every resource row mechanically denies circuit close/reset, throttling, execution, deletion of
material money or audit evidence, and obstruction of independently safe risk reduction. S8 may
show current circuit evidence and an exact canonical-owner recommendation; it cannot act on it.

Direct composed-proof linkage remains with IP-PROOF/I00 scenarios 4, 5, 8, 9, 18, 19, and 21,
plus scenario 10 for telemetry/WAL evidence preservation. Packet fixtures do not claim those
scenarios passed.
