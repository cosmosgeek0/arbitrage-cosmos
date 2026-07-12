# ops/live — deployment infrastructure artifacts (L15 satellite)

Testable artifacts implementing the deployment-infrastructure portion of
`LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` §24 (with launch-file §7
amendment L-B for the latency harness). **Nothing here executes against
AWS, Cloudflare, Secrets Manager, systemd, or any remote system.** Every
external interaction is behind an injectable seam (`SYSTEMCTL`, `CURL`,
`NODE`, `SQLITE`), every hostname/credential is a documented
`REPLACE_ME_*` placeholder, and the whole set is proven by local tests:

```sh
bash ops/tests/run-all.sh      # loopback + mocks only; passes on macOS/Linux
```

The live deployment PROOF itself (real EC2/tunnel/secrets activation) is
owned by the L spine under separate owner authorization.

## Contents

```text
bin/
  common.sh          shared helpers (locking, gates, JSON, atomic symlink swap)
  deploy.sh          immutable release install -> pre-switch readiness probe ->
                     atomic `current` switch -> post-switch gate -> §24.2
                     failure policy (auto-rollback only pre-money + exposure
                     NONE; otherwise FREEZE)
  rollback.sh        schema-barrier-checked rollback; exposure-gated automation
  backup.sh          application-consistent SQLite online backup + evidence
                     archives + retention + --verify-latest staleness probe
  restore.sh         integrity-verified restore into an EXPLICIT target;
                     triple-guarded against the live state store
  restore-drill.sh   periodic isolated restore test (never touches DATA_DIR)
  watchdog.sh        external supervision: bounded restarts on live-failure,
                     alert-only on ready-failure, tunnel/backup/frozen alarms
  alert-log.sh       default ALERT_CMD (journald-friendly local logging)
  latency-bench.mjs  L-B region/full-chain latency harness (plan-mode default;
                     network runs require --confirm-network + OPS_ALLOW_NETWORK=1)
systemd/             hardened unit + timer templates, journald bounds
env/                 documented .env templates (placeholders only)
cloudflare/          tunnel + Access operator-boundary templates
aws/                 exact-ARN IAM policy template + identity invariants
bench/               benchmark targets template + harness docs
```

## Target host layout (parameterized; defaults shown)

```text
/opt/cosmos/releases/<releaseId>/   immutable release dirs (chmod a-w)
/opt/cosmos/current -> releases/…   atomic symlink, swapped via rename(2)
/opt/cosmos/previous -> releases/…  rollback candidate
/var/lib/cosmos/data/               DATA_DIR (cosmos.db + journal-compat.json)
/var/lib/cosmos/ops/                deploy log, locks, markers, watchdog state
/var/backups/cosmos/                published backups + drills
/etc/cosmos/*.env                   installed env files (root-owned, 0640)
/usr/local/lib/cosmos-ops/bin/      these scripts, OUTSIDE the release path
```

## Release contract

A release source directory must contain `server/dist/index.js` and a
`release.json`:

```json
{ "releaseId": "r20260712-abc1234", "gitSha": "abc1234",
  "builtAtUtc": "2026-07-12T00:00:00Z",
  "schemaVersion": 1, "rollbackBarrier": false }
```

`deploy.sh` maintains `$DATA_DIR/journal-compat.json`
(`dataSchema` = highest schema that has run; `rollbackFloor` = highest
schema deployed with `rollbackBarrier:true`). Rollback to any release whose
`schemaVersion` is below the floor is refused absolutely — that is the
explicit non-rollback barrier of §24.2. Ownership of this marker should
move into the app/ledger at integration (see `OPS_INTEGRATION_NOTES.md`).

## Deploy failure policy (§24.2, exact)

| condition after a failed post-switch gate | action | exit |
|---|---|---|
| money-readiness never reached AND exposure == `NONE` AND a previous release exists | automatic rollback | 3 |
| anything else (`ACTIVE`/`AMBIGUOUS`/`RECOVERY_REQUIRED`/`UNKNOWN`, money reached, no previous, or the auto-rollback itself fails) | FREEZE: marker + alert, state preserved for incident handling | 2 |

Exposure comes from `EXPOSURE_CMD` (unset/failed ⇒ `UNKNOWN` ⇒ freeze-safe).
The deploy gate uses `/health/live` + `/health/ready` only — **never**
`/health/trade-ready`; the cockpit must stay reachable while trade
readiness is red (§24.3).

## Watchdog policy (§23/§24)

Live-gate failure: restart after `LIVE_FAIL_THRESHOLD` consecutive misses,
at most `MAX_RESTARTS_PER_WINDOW` per window, then page. Ready-gate failure
(incl. `TRADE_UNSAFE`): **alert only** — restarting cannot fix degraded
inputs and may destroy recovery state. The watchdog performs **no trading
action of any kind** and never auto-liquidates on infrastructure alarms.
It also alarms on tunnel-down, deploy-frozen, and backup-stale/missing.

## What activation (owner-authorized, spine-owned) still requires

Filling `REPLACE_ME_*` values, creating users/dirs, installing units,
creating the tunnel/Access app, attaching the IAM policy, enabling timers,
and the live §24 proof run. None of that is performed — or performable —
from this artifact set.
