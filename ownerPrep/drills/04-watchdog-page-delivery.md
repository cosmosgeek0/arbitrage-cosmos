# Zero-capital game-day — watchdog and page delivery

Status: **DRAFT — OWNER SIGN-OFF REQUIRED — NOT EXECUTED**

Inherits `00-zero-capital-common-safety.md`.

## Objective

Prepare proof that application death, missing heartbeat and readiness failure reach one independent out-of-band paging path, while notification flood is grouped and the ledger retains material events.

## Offline phase authorized by this draft

1. Bind `BIND_AT_CANDIDATE_WATCHDOG_FIXTURE_SCENARIO` to the local deterministic watchdog/notification harness.
2. Use a fake local sink and synthetic destination identifier; never a real webhook, address, action ARN or token.
3. Inject application-dead, heartbeat-missing, readiness-failed and telemetry-pipeline-failed cases separately.
4. Assert watchdog truth does not depend on the application reporting itself healthy.
5. Assert application-dead may consume only the accepted bounded restart budget; readiness failure remains alert-only; no trading action or liquidation is possible.
6. Inject a notification flood and assert one incident/page group plus complete material ledger history.
7. Require a durable synthetic delivery receipt. Missing delivery receipt keeps the drill failed and makes cockpit assurance degraded.

## Owner-gated real-delivery phase

No real message is authorized here. Later, the owner must bind the single destination through `PAGING_DESTINATION_SETUP_DRAFT.md`, create the separate AWS/Cloudflare activation authorization if required, then record provider readback, send/delivery/ack timestamps, destination fingerprint, receipt hash and cockpit-visible failure. The real destination must remain out-of-band and secret values must never enter the receipt.
