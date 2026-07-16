# D0017 — L13 carries owner evidence; it does not own the machine graph

Decision: `ACCEPTED_FOR_IMPLEMENTATION`

Date: `2026-07-14`

## Ruling and scope

`D-LAUNCH-16` was verified in the canonical director state at commit
`a4a8ebd349e638e047a9ebf20bf6ec170376d08e`. The worker scope baseline is the
latest qualifying two-parent `director:` merge,
`3a8e17be71d21df14f6b236a563cb0595f9eb824`. Imported director history is
canonical and exempt from the lane allowlist; worker-authored commits after
that baseline remain subject to §3.3.

The later canonical director-state commit
`7ff1fd05584779672690f5058a01b1de573b4ccd` records `D-LAUNCH-17` and the
Phase-1 final-integration handoff. It leaves this lane order and external-action
boundary unchanged: I00 waits for the L lane last, after `L LANE_READY`.

L13 is a pure data-only adapter under `server/src/liveEdge/adapters/**`. It
accepts injected evidence for the exact §22 machine-role catalog, the §23
metric/alarm catalog, the accepted L14 action discriminants and one validated
copy of the L12 subject/snapshot binding. It validates closed shape, identity,
ordering, provenance, time/window evidence and boundedness, then returns an
inert deeply frozen snapshot.

The ownership boundary remains unchanged:

- System Integration owns canonical topology, graph edges, whole-machine read
  projection and first-root-cause selection;
- Foundation Control owns desired/observed whole-machine behavior and control
  validation;
- Foundation Observability owns metric derivation, health and alarm
  evaluation;
- Capital, Risk, execution, reconciliation, Ledger and strategy owners retain
  their existing truths;
- L13 owns no health calculation, graph, trace index, queue, cache, store,
  alarm evaluator, readiness decision, command persistence or action route.

Every action is advertised `UNAVAILABLE`. The existing Foundation lifecycle
mapping for `SET_COMPONENT_DESIRED_STATE` and `SAFE_RESTART_COMPONENT` may be
identified only as `PROVEN_CONTROL_PLANE_RUNTIME_ONLY`; that label does not
make either action production-available. Alarm evidence is record-only:
automatic action is `NONE`, liquidation and Capital mutation are impossible,
and `HALT` remains a recommendation for the canonical owner to evaluate.

Canonical Foundation desired-state, runtime-phase and rate-state catalogs are
consumed directly rather than copied as drifting local literals. Injected
Foundation rate diagnostics are not re-derived, but their closed arithmetic
and freshness invariants must be internally consistent before they can be
retained. Foundation Control evidence contains only the fields its canonical
runtime snapshot owns; process restart count remains separate typed
System-Integration/observability evidence. The exact 36-metric catalog also has
closed unit and instrument-kind maps: counter windows are mandatory for
observed/stale counters and impossible on gauges, versions, revisions or
status values.

The snapshot therefore declares:

```text
projectionAuthority=OWNER_EVIDENCE_ADAPTER_ONLY
graphAuthority=SYSTEM_INTEGRATION
observabilityAuthority=FOUNDATION_OBSERVABILITY
controlAuthority=NONE_RECORD_ONLY
rootCauseAuthority=NONE_RECORD_ONLY
readinessAuthority=NONE_RECORD_ONLY
alarmEvaluationAuthority=NONE_RECORD_ONLY
externalActionAuthorization=NONE
automaticActionAuthorization=NONE
truthClass=SYNTHETIC_ONLY_UNWIRED
```

## Current primary-source check

Official primary guidance was checked before implementation on `2026-07-14`:

- OpenTelemetry's Metrics Data Model preserves metric identity, timestamps,
  aggregation temporality and reset/gap semantics:
  `https://opentelemetry.io/docs/specs/otel/metrics/data-model/`.
- Prometheus instrumentation guidance calls for bounded, meaningful labels and
  warns that each label set creates another time series:
  `https://prometheus.io/docs/practices/instrumentation/`.
- Prometheus alerting guidance favors actionable symptom-based alerts and
  advises against paging when no human action is available:
  `https://prometheus.io/docs/practices/alerting/`.

The resulting contract uses exact closed metric IDs, independent literal
oracles for units and instrument kinds, fixed empty label sets, one
logical-writer window record, explicit nullable unknowns and injected owner
alarm state. It does not emit telemetry or evaluate an alarm. No remote
service was called.

## Integration boundary

Canonical owner composition, persistence, authenticated routes, topology
edges, first-root-cause selection, actual control behavior and UI rendering
remain an I00/System Integration task. The inert request in
`live-edge-receipts/patches/L13-system-integration-machine-graph.request.md`
records that dependency without editing any shared owner.

## Non-claim

L13 proves deterministic validation and projection of synthetic injected
owner evidence. It does not prove live private acquisition, deployed metrics,
CloudWatch alarms, authenticated controls, restart behavior, a rendered
cockpit, trade readiness, deployed shadow operation or canary readiness.
