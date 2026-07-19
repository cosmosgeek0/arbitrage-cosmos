# DEPLOY-READINESS-001 correction receipt — deployment-rehearsal hardening of the effective L15 operations tree

Status: `CORRECTED_AND_REGRESSION_TESTED`

This amendment carries the donor-file corrections adjudicated from the
line-by-line deployment dress rehearsal (`DEPLOY_REHEARSAL.md`, second-pass
solution designs §40) into the effective L15 operations tree. One amendment,
one receipt, one additive byte regression, per the §40.3.0 bundling guidance.
Fourteen donor files change; every change is a modification (no additions,
no removals; `fileCount` remains 31).

Corrections bound by this amendment, by finding:

- **F-017** `systemd/cosmos-app.service`: `TimeoutStopSec=30 → 75`. The stop
  budget was shorter than the application's 45 s drain plus its 8 s internal
  HTTP close deadline, so systemd SIGKILLed mid-drain and left an untruncated
  WAL. The unit records the arithmetic; the donor unit test now asserts the
  floor.
- **F-111** `systemd/cosmos-app.service`: preventive comment — `PrivatePIDs=`
  must never be added; the DATA_DIR lease classifies owners via `kill(pid,0)`
  and `/proc/<pid>/stat` and requires a shared PID namespace.
- **Part 4 #11** `systemd/cosmos-{watchdog,backup,restore-drill}.service`:
  every oneshot declares an explicit `TimeoutStartSec` (300 / 1800 / 3600)
  instead of inheriting the 90 s stock default that would SIGTERM a long
  backup or drill mid-run.
- **F-040** three `ExecStart` lines and two `ALERT_CMD` defaults retargeted
  from the never-created `/usr/local/lib/cosmos-ops/bin/` to the path
  `install-ops-bundle.sh` actually creates,
  `/usr/local/lib/cosmos-ops/i00/accepted-ops-live/bin/`; README layout line
  corrected to match. (The stronger F-045 variant — pointing the scheduled
  units at the I00 verify wrappers — remains a recorded director decision.)
- **F-025 / F-043** `bin/deploy.sh`, `bin/rollback.sh`, `bin/watchdog.sh`
  check `"$NODE" "$CURL" "$SYSTEMCTL"` up front; `bin/backup.sh` adds `tar`.
  A missing binary now names itself instead of surfacing as a misleading
  downstream failure.
- **F-026** `bin/common.sh` `gate_wait` refuses an empty gate path list — an
  empty list previously iterated zero paths and passed every gate.
- **F-027** both env templates stop claiming only `/api/health` exists.
- **F-028** `env/cosmos-deploy.env.template` documents the exact
  `EXPOSURE_CMD` the wrapper force-sets; `bin/common.sh` `get_exposure` no
  longer discards the probe's stderr (UNKNOWN silently disables
  auto-rollback, so the reason must reach the journal).
- **Part 4 #5** `bin/watchdog.sh` runs `systemctl reset-failed` before
  restart (a latched `StartLimitBurst` made every restart fail until a human
  intervened) and moves the restart record and streak reset inside the
  success branch, so a failed restart neither consumes the bounded budget nor
  pretends recovery.
- **Part 4 #6** `bin/common.sh` `json_get` distinguishes "key absent"
  (exit 3) from "file unreadable / invalid JSON" (exit 4); the three barrier
  call sites in `bin/deploy.sh` and `bin/rollback.sh` keep the floor-0
  default only for a genuinely absent key and refuse an unreadable journal —
  a corrupt journal can no longer erase the non-rollback barrier.
- **Part 4 #7** `bin/watchdog.sh`: a present-but-unreadable streak file
  alerts `WATCHDOG_STATE_UNREADABLE` and assumes the live-fail threshold is
  reached (fail toward acting); an absent file remains a legitimate first
  run.
- **F-105** `bin/backup.sh`: an unreadable events count fails the backup run
  instead of publishing `result=SUCCESS` with `eventsCount=-1`.
- **F-106** `bin/backup.sh`: `BACKUP_DIR` containing a quote, backslash, or
  newline is refused before it can corrupt the single-quoted SQLite
  `.backup` literal.
- **F-044** `env/cosmos-backup.env.template`: `EVIDENCE_PATHS=/etc/cosmos`,
  so a restore drill can recover the installed non-secret deployment
  configuration. Landed together with F-043's `tar` check, which this
  default makes reachable for the first time (Part 11.5 ordering trap).
- **F-108** `bin/deploy.sh`: `--skip-probe` is refused on a first deploy (no
  previous release exists to roll back to), and a failed probe captures each
  gate path's response body while the candidate is still up.
- **F-023** `bin/deploy.sh`: the default pre-switch probe boots under
  `env -i` with `NODE_ENV=production` and a `DATA_DIR_LOGICAL_LEASE_ROOT`
  that is a sibling of the throwaway data dir, so the gate proves the code
  path production actually takes. The `PROBE_CMD` injection branch used by
  the donor tests is unchanged.
- **F-107** `bin/deploy.sh` refuses to run directly against the production
  root `/opt/cosmos` unless invoked through the I00 wrapper, which sets
  `COSMOS_DEPLOY_VIA_I00_WRAPPER=1` in its sanitized env
  (`ops/i00/bin/sanitize-donor-env.mjs`, non-donor).
- **F-035** `env/cosmos-app.env.template` folds in the validator-required
  non-secret keys so the one file claiming to be the production app
  environment passes `ops/i00/bin/validate-config.mjs` up to `REPLACE_ME`
  placeholders.
- **F-031** `README.md` doc reference repointed to
  `docs/archive/i00-phase2/L15_OPS_INTEGRATION_NOTES.md`. The equivalent
  dangling references inside `ops/live/RECEIPT.md` are deliberately NOT
  corrected: that file is the immutable accepted-donor receipt pinned by
  `IMMUTABLE_DONOR.acceptedReceipt`.

The correction is proved by one additive I00 regression:

```text
bash ops/tests/i00/test-deploy-readiness-001-l15-bytes.sh
```

No deployment, private exchange call, signed action, or money path was
performed or authorized by this correction. Deployment remains
`NOT_CONFIGURED` pending separate owner approval.

## Donor-owned test evolution

F-017, Part 4 #11 and F-040 changed what the donor-owned generic proof
`ops/tests/test-systemd-units.sh` asserts, so that test evolved with them:
the retargeted `ExecStart` pattern, a `TimeoutStopSec` floor assertion, and a
`TimeoutStartSec` presence assertion for every oneshot. The amendment binds
this evolution's exact before/after bytes (`changedTestFiles`); the
strengthened test replaces, and never weakens, the donor's original
assertions.
