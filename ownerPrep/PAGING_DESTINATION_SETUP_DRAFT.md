# Out-of-band paging destination setup draft

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — ZERO EXTERNAL ACTIONS — NO MESSAGE SENT**

Select exactly one primary destination that remains reachable when the application is dead. A destination address, webhook, token or credential value must never appear in Git, a unit, a script, a prompt or a receipt. Store only an opaque destination fingerprint/ARN/ID through the canonical secret/config boundary.

## Owner inputs

```text
provider: UNSET
opaque_destination_id_or_fingerprint: UNSET
owner_and_primary_responder: UNSET
secondary_escalation_owner: UNSET
AWS_region_namespace_log_group_retention: UNSET
alarm_names_and_action_ARN_fingerprints: UNSET
heartbeat_owner_and_interval: UNSET
watchdog_readback_command: UNSET
quiet_hours_and_severity_policy: UNSET
acknowledgement_deadline: UNSET
result_receipt_target: UNSET
reconciliation_receipt_target: UNSET
```

## Preparation

- [ ] Bind exact verified/deployed SHA, host, environment and canonical watchdog/telemetry owners.
- [ ] Confirm destination is out-of-band from the application and is not the application’s own UI/log store.
- [ ] Bind one exact external-action class and owner authorization for provider/alarm activation. Service restart/deploy, secret materialization and vendor activation remain separate where applicable.
- [ ] Configure minimum permissions and one exact destination; keep alarm actions disabled until owner authorization and target readback.
- [ ] Define heartbeat-missing, process-dead, readiness-failed, recovery-required, telemetry-loss and deployment-SHA-mismatch policies.
- [ ] Keep readiness failure alert-only. Watchdog may use only the accepted bounded restart budget for process liveness; it never trades, liquidates, changes capital or hides recovery.

## Offline proof first

- [ ] Complete `drills/04-watchdog-page-delivery.md` against a fake local sink.
- [ ] Prove missing delivery receipt degrades cockpit assurance.
- [ ] Prove flood grouping sends one incident while the ledger retains every material event.
- [ ] Prove sentinel failure overrides application self-reported green.
- [ ] Record zero network, credential, capital and external effects.

## Owner-gated end-to-end proof

No step below is authorized by this draft.

1. Activate only the exact destination/alarm bindings inside the authorization window.
2. Read back provider, alarm, destination fingerprint, action state, heartbeat owner and deployed SHA.
3. Inject one approved non-money test incident from the independent watchdog boundary.
4. Record send, provider-accept, delivery and human-ack timestamps plus correlation/incident IDs.
5. Assert the cockpit shows delivery success; then simulate one approved delivery failure and assert visible degraded/failed status.
6. Reconcile provider history, watchdog receipt, cockpit incident and ledger correlation.
7. Disable the test condition, preserve the active production policy, and close distinct result/reconciliation receipts.

## Acceptance and abort

Accept only if the destination receives the page within the owner-set deadline, application death is not required for receipt storage, failure is cockpit-visible, flood is bounded, and no trading authority exists. Abort and keep paging `NOT_CONFIGURED` on any secret exposure, broad destination, missing provider readback, stale SHA, absent receipt, false green, unbounded restart or unexpected external effect.

```text
status: DRAFT_OWNER_SIGNOFF_REQUIRED
authorization_effective: false
end_to_end_result: NOT_RUN
reconciliation: NOT_RUN
owner_signoff: UNSIGNED
```
