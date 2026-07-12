# OPS_INTEGRATION_NOTES — wiring the L15 deploy-infra artifacts

Satellite: `l15-deploy-infra-20260712` (D-LAUNCH-5). Scope delivered:
`ops/live/**` (artifacts) + `ops/tests/**` (local proofs). This file lists
exactly what the L spine / director must wire at integration. Everything
below is deliberately NOT done by the satellite (authority boundary).

## 1. Health endpoint split (§24.3) — blocking dependency

The runtime currently exposes only `/api/health` (`server/src/index.ts:771`).
The artifacts default to the §24.3 contract (`/health/live`,
`/health/ready`) and are configurable:

- until the spine lands the split endpoints, set
  `READINESS_GATE_PATHS=/api/health`, `POST_SWITCH_GATE_PATHS=/api/health`,
  `LIVE_PATH=/api/health` (and accept degraded semantics);
- when the spine lands them, the defaults are already correct.
  `/health/trade-ready` must NEVER enter a deploy/watchdog gate.

## 2. Exposure state source (§24.2 auto-rollback authority)

`deploy.sh`/`rollback.sh` consume `EXPOSURE_CMD` — any command printing
`NONE|ACTIVE|AMBIGUOUS|RECOVERY_REQUIRED|UNKNOWN`. Unset/failure collapses
to `UNKNOWN`, which freezes deployment (safe default). The spine should
provide a small read-only client of the supervisor's exposure truth and set
`EXPOSURE_CMD` in `/etc/cosmos/cosmos-deploy.env`. Until then, every
post-switch failure freezes rather than auto-rolls-back — correct per spec.

## 3. Money-readiness marker

`$OPS_STATE_DIR/money-ready` — its presence permanently disables automatic
rollback (§24.2). Creating it is part of the separately owner-authorized
live activation, never done by deploy tooling. The spine must create it in
the same recorded step that first arms money paths.

## 4. journal-compat ownership

`deploy.sh` maintains `$DATA_DIR/journal-compat.json` (`dataSchema`,
`rollbackFloor`). Long-term this belongs to the app/ledger (which actually
knows its schema); migrate ownership there and have `release.json`'s
`schemaVersion`/`rollbackBarrier` emitted by the release build step. Until
then the deploy-side bookkeeping is authoritative and tested.

## 5. Frozen-deployment handshake

On FREEZE, `$OPS_STATE_DIR/deploy-frozen.json` is written and the watchdog
alerts `DEPLOY_FROZEN` every pass. "Halt new entries" is app authority: the
supervisor should read this marker (or an equivalent signal) and surface it
in the cockpit; clearing it is a recorded operator action. A later healthy
deploy also clears it.

## 6. Release packaging

`deploy.sh --release <dir>` consumes an unpacked release directory
containing `server/dist/index.js` + `release.json` (schema in
`ops/live/README.md`). The spine's build/CI step must produce that
directory (typecheck/build/test gates first). Tarball unpacking is the
caller's job by design.

## 7. Installation (owner-authorized activation checklist)

1. Users `cosmos`, `cloudflared`; dirs per `ops/live/README.md` layout.
2. Copy `ops/live/bin/*` to `/usr/local/lib/cosmos-ops/bin` (watchdog must
   live OUTSIDE the release path — a broken release cannot supervise itself).
3. Fill `ops/live/env/*.env.template` → `/etc/cosmos/*.env` (0640).
4. Install `ops/live/systemd/*` units + journald drop-in; enable timers
   (watchdog 1min, backup hourly, restore-drill weekly).
5. Cloudflare: `ops/live/cloudflare/README.md` checklist (tunnel, Access
   app, `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` into the app env).
6. AWS: instance profile + `ops/live/aws/iam-secrets-policy.json.template`
   (exact secret ARN, no static credentials, no inbound SG rules, SSM only).
7. Latency benchmark (L-B): run `latency-bench.mjs` per candidate region
   with real targets before final deployment acceptance; region moves only
   via reviewed deployment decision with rollback proof.

## 8. Out of scope here, still owed by the spine for full §24

CloudWatch agent config + composite `TRADE_UNSAFE` alarms (§23), the
Secrets Manager fetch-into-service-env mechanism (§24.4 activation), AWS
Backup vault policy, and the live deployment proof itself.

## 9. Documentation law

Per the satellite's exclusive-write boundary, `STATE.md` was NOT touched.
The director should fold "ops deployment artifacts landed (ops/live,
ops/tests; local suite green)" into `STATE.md` at integration.

## Verification

```sh
bash ops/tests/run-all.sh   # 11 files, 347 assertions, network-free
```
