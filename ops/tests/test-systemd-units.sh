#!/usr/bin/env bash
# ops/tests/test-systemd-units.sh — structural lint of the unit templates.
# systemd-analyze does not exist on macOS, so the invariants that matter are
# checked directly: sections, supervision, hardening, journal bounds, no
# secrets, loopback discipline, and the release/watchdog separation.
. "$(dirname "$0")/helpers.sh"

SYSD="$OPS_LIVE/systemd"

unit_get() { # file key -> last value
  grep -E "^$2=" "$1" | tail -1 | cut -d= -f2-
}

note "all units: sections present, no secret-looking Environment= lines"
for u in "$SYSD"/*.service "$SYSD"/*.timer; do
  assert_grep '^\[Unit\]' "$u" "$(basename "$u") has [Unit]"
  assert_grep '^Description=' "$u" "$(basename "$u") has Description"
  case "$u" in
    *.service)
      assert_grep '^\[Service\]' "$u" "$(basename "$u") has [Service]"
      assert_grep '^ExecStart=' "$u" "$(basename "$u") has ExecStart"
      assert_grep '^NoNewPrivileges=yes' "$u" "$(basename "$u") hardened: NoNewPrivileges"
      assert_grep '^ProtectSystem=strict' "$u" "$(basename "$u") hardened: ProtectSystem"
      assert_grep '^SyslogIdentifier=' "$u" "$(basename "$u") journal identity"
      ;;
    *.timer)
      assert_grep '^\[Timer\]' "$u" "$(basename "$u") has [Timer]"
      assert_grep '^\[Install\]' "$u" "$(basename "$u") has [Install]"
      ;;
  esac
  assert_not_grep '^Environment=.*(TOKEN|SECRET|PASSWORD|KEY)=' "$u" "$(basename "$u") no inline secrets"
  assert_not_grep '0\.0\.0\.0' "$u" "$(basename "$u") no wildcard bind"
done

note "cosmos-app.service: supervised loopback app under a non-root user"
APP="$SYSD/cosmos-app.service"
assert_eq "$(unit_get "$APP" User)" cosmos "runs as cosmos"
assert_eq "$(unit_get "$APP" Restart)" on-failure "supervised restart"
assert_eq "$(unit_get "$APP" WorkingDirectory)" /opt/cosmos/current "runs from current release"
assert_eq "$(grep -c '^ExecStart=' "$APP")" 1 "one application entrypoint"
assert_eq "$(unit_get "$APP" ExecStart)" "/usr/bin/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases /usr/bin/node server/dist/index.js" "pins logical lease root after EnvironmentFile precedence"
assert_grep '^EnvironmentFile=/etc/cosmos/' "$APP" "config from /etc/cosmos"
assert_eq "$(unit_get "$APP" RuntimeDirectory)" cosmos-app "same-host lease runtime shared across PrivateTmp"
assert_eq "$(unit_get "$APP" RuntimeDirectoryMode)" 0700 "lease runtime is owner-only"
assert_eq "$(unit_get "$APP" RuntimeDirectoryPreserve)" restart "lease runtime survives supervised restart"
assert_not_grep '^Environment=DATA_DIR_LOGICAL_LEASE_ROOT=' "$APP" "EnvironmentFile cannot override a misleading Environment assignment"
private_pids_absent() {
  ! grep -Eq '^[[:space:]]*PrivatePIDs[[:space:]]*=' "$1"
}
assert_rc 0 private_pids_absent "$APP"
for private_pids in yes true on 1; do
  private_pids_fixture="$SANDBOX/cosmos-app-private-pids-$private_pids.service"
  cp "$APP" "$private_pids_fixture"
  printf '\nPrivatePIDs=%s\n' "$private_pids" >> "$private_pids_fixture"
  assert_rc 1 private_pids_absent "$private_pids_fixture"
done
assert_grep '^StartLimitIntervalSec=' "$APP" "restart storm bounded"
assert_grep '^StartLimitBurst=' "$APP" "restart storm bounded (burst)"
assert_grep '^LogRateLimitIntervalSec=' "$APP" "journal rate bounded"
assert_grep '^ReadWritePaths=.*/var/lib/cosmos' "$APP" "state dir writable"
assert_grep '^ReadWritePaths=.*/run/cosmos-app' "$APP" "logical lease runtime writable"
assert_grep '^WantedBy=multi-user.target' "$APP" "installable"

note "cloudflared.service: separate supervised tunnel, no autoupdate"
CF="$SYSD/cloudflared.service"
assert_grep '^ExecStart=.*--no-autoupdate' "$CF" "no autoupdate"
assert_grep '^ExecStart=.*--config /etc/cloudflared/config\.yml' "$CF" "explicit config"
assert_eq "$(unit_get "$CF" User)" cloudflared "runs as cloudflared"

note "watchdog/backup/drill: oneshot units OUTSIDE the release path"
for pair in "cosmos-watchdog.service:watchdog.sh" "cosmos-backup.service:backup.sh" "cosmos-restore-drill.service:restore-drill.sh"; do
  u="$SYSD/${pair%%:*}"; script="${pair##*:}"
  assert_eq "$(unit_get "$u" Type)" oneshot "$(basename "$u") oneshot"
  assert_grep "^ExecStart=/usr/local/lib/cosmos-ops/bin/$script" "$u" "$(basename "$u") external to releases"
  # directives (non-comment lines) must not reference the release path
  ASSERTIONS=$((ASSERTIONS + 1))
  ! grep -v '^#' "$u" | grep -q '/opt/cosmos/current' \
    || fail "$(basename "$u") directive references the current release path"
done

note "timers: cadences declared"
assert_grep '^OnUnitActiveSec=1min' "$SYSD/cosmos-watchdog.timer" "watchdog every minute"
assert_grep '^OnCalendar=hourly' "$SYSD/cosmos-backup.timer" "backup hourly"
assert_grep '^OnCalendar=weekly' "$SYSD/cosmos-restore-drill.timer" "drill weekly"

note "journald drop-in: bounded logs"
J="$SYSD/journald-cosmos.conf.template"
assert_grep '^\[Journal\]' "$J" "journal section"
assert_grep '^SystemMaxUse=' "$J" "disk bound"
assert_grep '^MaxRetentionSec=' "$J" "retention bound"

finish
