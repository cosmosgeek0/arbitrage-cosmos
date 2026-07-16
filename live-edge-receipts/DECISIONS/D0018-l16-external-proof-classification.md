# D0018 — L16 classifies proof; it does not perform external work

Decision: `ACCEPTED_FOR_IMPLEMENTATION`

Date: `2026-07-14`

## Ruling and scope

D-LAUNCH-16 remains controlling for worker-only scope. The latest qualifying
lane baseline is the two-parent `director:` merge
`3a8e17be71d21df14f6b236a563cb0595f9eb824`. The latest canonical director
state is `7ff1fd05584779672690f5058a01b1de573b4ccd` (`D-LAUNCH-17`), which leaves
the L finale and external-action boundary unchanged.

L16 is a pure evidence classifier under
`server/src/liveEdge/adapters/externalProofEvidence/**`. It validates the full
accepted L13 snapshot against the original full L12 snapshot, retains only one
compact lineage binding, binds exact accepted L15 satellite artifact identity,
and derives a closed classification from each closed evidence kind.

It owns no runner, authorization service, deployment state, runtime health,
private/account truth, filter decision, readiness decision, test-order path,
credential boundary or exchange action. A caller cannot supply the derived
classification.

## Proof taxonomy

```text
LOCAL_VERIFICATION          -> PROVED_LOCAL
DETERMINISTIC_REPLAY        -> SYNTHETIC_REPLAY
ADAPTER_INTEGRATION_STATE   -> UNWIRED
L15_SATELLITE_ACCEPTANCE    -> ACCEPTED_SATELLITE
EXTERNAL_AUTHORIZATION_GAP  -> OWNER_GATED
ABSENT_RUNTIME_EVIDENCE     -> UNPROVEN
REPOSITORY_POLICY_BLOCK     -> PROHIBITED
EXTERNAL_NON_PERFORMANCE    -> NOT_PERFORMED
I00_INTEGRATION_DEFERRAL    -> DEFERRED_TO_I00
CURRENT_OWNER_FILTER_VERDICT -> FILTER_BLOCKED
```

The L15 artifact binding is exact:

- receipt commit: `2cec412927fa2f64f05a0b2774b18e45f8ce4fa5`;
- receipt tree: `e401435d6a650aee8a29c3da4495b4db426be017`;
- work commit: `9a82d4715c73ebe4156638c2bf5e8a2c02373bbf`;
- receipt blob: `7fc3520d4fede577937c6dd48c191b1e5d212061`;
- receipt raw SHA-256:
  `d5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293`;
- local assertion count: `347`.

This means only `ACCEPTED_SATELLITE`, never merged, deployed, wired, live or
ready. Production fan-in remains I00-owned.

## Current primary-source check

Official primary guidance was checked before implementation on `2026-07-14`:

- AWS EC2/CloudWatch status and alarm guidance distinguishes infrastructure
  status from application evidence and warns that status transitions can
  precede completion of startup work:
  `https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/monitoring-system-instance-status-check.html`.
- AWS Secrets Manager retrieval returns secret material to the caller; this
  phase therefore models only a missing owner-authorized proof and never calls
  the retrieval API:
  `https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-javascript.html`.
- Cloudflare Tunnel status proves connector-to-Cloudflare connectivity, not
  reachability or correctness of the private origin application:
  `https://developers.cloudflare.com/tunnel/troubleshooting/`.
- Cloudflare Access application proof separately requires JWT signature,
  issuer and application-audience validation:
  `https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/`.
- Binance Spot and USD-M test-order endpoints are signed TRADE requests that
  validate parameters without entering the matching engine; that is not a
  fill, live trade or deployed cockpit proof:
  `https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints`,
  `https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order-Test`.

No endpoint, credential store, instance, tunnel, process or exchange account
was contacted.

## Fail-closed interpretation

- Local build/test evidence proves only the local bytes and command outcome.
- Synthetic replay proves only deterministic fixture behavior.
- L13 role evidence for EC2, Cloudflare or watchdog nodes remains synthetic and
  unwired; it cannot substitute for L16 external proof.
- EC2 `OK`, a healthy tunnel, or a CloudWatch alarm state cannot prove the app,
  authenticated cockpit, private truth, restart recovery or readiness.
- `FILTER_BLOCKED` requires a current, complete, exact-subject and
  revision-bound canonical owner verdict. L16 must validate the complete L04
  registry, replay the exact sizing request through the canonical L04 owner and
  reproduce the retained result. Only closed price/grid/quantity/notional
  arithmetic rejection codes qualify; stale truth, Margin owner gaps, revision
  mismatch, unsupported precision, TIF/capability gaps and missing/rejected
  reference evidence remain unproven or owner-gated. Generic absence or
  min-notional text is never enough.
- Canonical L04 documentary external requirements remain visible on a genuine
  arithmetic rejection and cannot be interpreted as readiness. The plain-data
  budget accepts L04's exact 10,000-instrument owner boundary while narrower
  L16 catalogs retain their own stricter bounds.
- Signed test orders, live orders, Margin borrow/repay and every money action
  are prohibited/not performed by repository law. L16 adds no path to perform
  them.

## Non-claim

L16 does not prove live public advancement, private/account truth, deployed
application or cockpit behavior, Cloudflare authorization, service restart,
degraded-state recovery, test-order acceptance, filter admission, canary
readiness or a combined Q/L chain. It grants no authorization and performs no
external action. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
