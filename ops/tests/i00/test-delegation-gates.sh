#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

SHA_A=abcdef0123456789abcdef0123456789abcdef01
SHA_B=bcdef0123456789abcdef0123456789abcdef012
RELEASE_A="$(assemble_fixture_release "$TEST_TMP/release-a" "$SHA_A")"
RELEASE_B="$(assemble_fixture_release "$TEST_TMP/release-b" "$SHA_B")"
REAL_TMP="$(node -e 'const fs=require("fs"),os=require("os");process.stdout.write(fs.realpathSync(os.tmpdir()))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" --root "$REAL_TMP/ip-ops-i00-sim-delegation-$$")"
cleanup_delegation_test() {
  chmod -R u+w "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp
}
trap cleanup_delegation_test EXIT
INSTALLED_I00="$SIMULATION_ROOT/installed-i00"
"$I00_ROOT/bin/install-ops-bundle.sh" --release "$RELEASE_A" --destination "$INSTALLED_I00" --simulation --simulation-root "$SIMULATION_ROOT" >/dev/null
assert_file "$INSTALLED_I00/accepted-ops-live/bin/deploy.sh"
assert_not_file "$INSTALLED_I00/.git"
FAKE_ROOT="$SIMULATION_ROOT/fakes"
mkdir -p "$FAKE_ROOT" "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/ops-state"

cat > "$FAKE_ROOT/systemctl.sh" <<SH
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$SIMULATION_ROOT/systemctl.log"
exit 0
SH
cat > "$FAKE_ROOT/curl.sh" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$FAKE_ROOT/probe.sh" <<'SH'
#!/usr/bin/env bash
trap 'exit 0' TERM INT
while :; do sleep 1; done
SH
cat > "$FAKE_ROOT/exposure.sh" <<'SH'
#!/usr/bin/env bash
printf 'NONE\n'
SH
cat > "$FAKE_ROOT/sqlite-safe.sh" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = --version ] || exit 9
printf '3.53.3 fixture-safe\n'
SH
cat > "$FAKE_ROOT/systemctl-inactive.sh" <<'SH'
#!/usr/bin/env bash
[ "$*" = 'is-active cosmos-app.service' ] || exit 9
printf 'inactive\n'
exit 3
SH
chmod +x "$FAKE_ROOT"/*.sh
touch "$SIMULATION_ROOT/systemctl.log"
node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$SIMULATION_ROOT" --commands "$FAKE_ROOT/systemctl.sh,$FAKE_ROOT/curl.sh,$FAKE_ROOT/probe.sh,$FAKE_ROOT/exposure.sh" >/dev/null
mkdir -m 700 "$SIMULATION_ROOT/evidence"

cat > "$TEST_TMP/host.json" <<'JSON'
{"source":"TARGET_HOST_OWNER_READBACK","account":"simulation-account","targetHost":"fixture-host.internal","environment":"simulation","freeBytes":10000000,"backupReserveBytes":1000,"sqliteVersion":"3.53.3","evidenceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","observedAtUtc":"2026-07-13T00:00:00Z"}
JSON
cat > "$TEST_TMP/supervisor.json" <<'JSON'
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:45Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":1,"rollbackFloor":1}
JSON
cat > "$TEST_TMP/env" <<EOF
COSMOS_ROOT=$SIMULATION_ROOT/target
RELEASES_DIR=$SIMULATION_ROOT/target/releases
CURRENT_LINK=$SIMULATION_ROOT/target/current
PREVIOUS_LINK=$SIMULATION_ROOT/target/previous
DATA_DIR=$SIMULATION_ROOT/data
OPS_STATE_DIR=$SIMULATION_ROOT/ops-state
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:18080
PROBE_BASE=http://127.0.0.1:18081
READINESS_GATE_PATHS=/health/live
POST_SWITCH_GATE_PATHS=/health/live
GATE_TIMEOUT_SEC=2
EXPOSURE_CMD=$FAKE_ROOT/exposure.sh
ALERT_CMD=
FROZEN_MARKER=$SIMULATION_ROOT/ops-state/deploy-frozen.json
MONEY_READY_MARKER=$SIMULATION_ROOT/ops-state/money-ready
EOF
cat > "$TEST_TMP/runtime.env" <<'ENV'
HOST=127.0.0.1
PORT=8080
DATA_DIR=/var/lib/cosmos/data
DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases
EVIDENCE_DIR=/var/lib/cosmos/evidence
MODEL_DIR=/var/lib/cosmos/models
BACKUP_DIR=/var/backups/cosmos
CONTROL_ROOM_OPERATOR_EMAIL=operator@private.invalid
CF_ACCESS_TEAM_DOMAIN=https://team.cloudflareaccess.com
CF_ACCESS_AUD=audience_12345678
I00_TESTED_SHA=abcdef0123456789abcdef0123456789abcdef01
I00_DEPLOYED_SHA=abcdef0123456789abcdef0123456789abcdef01
I00_CONFIG_REVISION=config-1
I00_MODEL_REVISION=UNAVAILABLE
I00_PUBLIC_SOURCE_STARTUP_EGRESS=1
ENV

COMMON_ENV=(env SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh")
SWITCH_COMMON=(--env-file "$TEST_TMP/env" --runtime-env "$TEST_TMP/runtime.env" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --sqlite "$FAKE_ROOT/sqlite-safe.sh" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now 2026-07-13T00:01:00Z)
FIRST_HOST_COMMON=(--env-file "$TEST_TMP/env" --runtime-env "$TEST_TMP/runtime.env" --sqlite "$FAKE_ROOT/sqlite-safe.sh" --recovery-target NO_PRIOR_RELEASE_FIRST_HOST --account simulation-account --target-host fixture-host.internal --environment simulation --backup-reserve-bytes 1 --evidence-root "$SIMULATION_ROOT/evidence" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --simulation-systemctl-readback "$FAKE_ROOT/systemctl-inactive.sh" --now 2026-07-13T00:01:00Z)

note "the first-host wrapper interface is mutually exclusive and exact"
assert_failure_contains 'rejects caller-supplied --host and --supervisor' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_COMMON[@]}" --host "$TEST_TMP/host.json"
WRONG_TARGET_COMMON=("${FIRST_HOST_COMMON[@]}")
for index in "${!WRONG_TARGET_COMMON[@]}"; do
  if [ "${WRONG_TARGET_COMMON[$index]}" = --recovery-target ]; then WRONG_TARGET_COMMON[$((index + 1))]=FIRST_HOST; fi
done
assert_failure_contains '--recovery-target must be exactly NO_PRIOR_RELEASE_FIRST_HOST' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${WRONG_TARGET_COMMON[@]}"
assert_failure_contains 'normal deploy requires --host and --supervisor' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" \
  --env-file "$TEST_TMP/env" --runtime-env "$TEST_TMP/runtime.env" --sqlite "$FAKE_ROOT/sqlite-safe.sh"
assert_failure_contains 'duplicate singleton argument --sqlite' \
  "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_COMMON[@]}" --sqlite "$FAKE_ROOT/sqlite-safe.sh"
for invalid_reserve in 01 1x not-a-number; do
  INVALID_RESERVE_COMMON=("${FIRST_HOST_COMMON[@]}")
  for index in "${!INVALID_RESERVE_COMMON[@]}"; do
    if [ "${INVALID_RESERVE_COMMON[$index]}" = --backup-reserve-bytes ]; then
      INVALID_RESERVE_COMMON[$((index + 1))]="$invalid_reserve"
    fi
  done
  assert_failure_contains '--backup-reserve-bytes must be a canonical non-negative integer' \
    "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${INVALID_RESERVE_COMMON[@]}"
done

note "installed I00 wrapper derives an honest clean first-host readback and deploys without synthetic canonical JSON"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$SIMULATION_ROOT/target/releases/i00-$SHA_A"
assert_not_file "$SIMULATION_ROOT/target/previous"
assert_contains "$(cat "$SIMULATION_ROOT/systemctl.log")" 'restart cosmos-app.service'
FIRST_HOST_BUNDLE="$(find "$SIMULATION_ROOT/evidence" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
assert_file "$FIRST_HOST_BUNDLE/host.json"
assert_file "$FIRST_HOST_BUNDLE/supervisor.json"
assert_file "$FIRST_HOST_BUNDLE/collected-evidence.json"
assert_file "$FIRST_HOST_BUNDLE/sqlite-readback.json"

note "a second first-host request refuses and leaves the established current release unchanged"
CURRENT_BEFORE_SECOND_FIRST_HOST="$(readlink "$SIMULATION_ROOT/target/current")"
assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$CURRENT_BEFORE_SECOND_FIRST_HOST"
assert_not_file "$SIMULATION_ROOT/target/previous"

touch "$SIMULATION_ROOT/data/mutable-state"
assert_file "$SIMULATION_ROOT/data/mutable-state"
sed "s/$SHA_A/$SHA_B/" "$TEST_TMP/runtime.env" > "$TEST_TMP/runtime-b.env"
SWITCH_COMMON[3]="$TEST_TMP/runtime-b.env"
note "a later canonical deployment preserves normal readback semantics and creates previous"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${SWITCH_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$SIMULATION_ROOT/target/releases/i00-$SHA_B"
assert_eq "$(readlink "$SIMULATION_ROOT/target/previous")" "$SIMULATION_ROOT/target/releases/i00-$SHA_A"
assert_file "$SIMULATION_ROOT/data/mutable-state"

note "rollback delegates the exact preflighted release ID, not an implicit previous target"
ROLLBACK_COMMON=(--env-file "$TEST_TMP/env" --runtime-env "$TEST_TMP/runtime.env" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --simulation --simulation-root "$SIMULATION_ROOT" --now 2026-07-13T00:01:00Z)
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/rollback-switch.sh" --release "$RELEASE_A" "${ROLLBACK_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$SIMULATION_ROOT/target/releases/i00-$SHA_A"
assert_file "$SIMULATION_ROOT/data/mutable-state"

note "established current release is untouched by every canonical freeze input"
CURRENT_BEFORE="$(readlink "$SIMULATION_ROOT/target/current")"
for mutation in exposure ambiguity recovery frozen; do
  node -e '
    const fs=require("fs"), p=process.argv[1], kind=process.argv[2], v=JSON.parse(fs.readFileSync(p,"utf8"));
    if (kind === "exposure") v.exposureState="ACTIVE";
    if (kind === "ambiguity") v.ambiguityState="AMBIGUOUS";
    if (kind === "recovery") v.recoveryState="RECOVERY_REQUIRED";
    if (kind === "frozen") v.deploymentFrozen=true;
    fs.writeFileSync(p,JSON.stringify(v));
  ' "$TEST_TMP/supervisor.json" "$mutation"
  assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${SWITCH_COMMON[@]}"
  assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$CURRENT_BEFORE"
  cat > "$TEST_TMP/supervisor.json" <<'JSON'
{"source":"CANONICAL_SUPERVISOR_READBACK","observedAtUtc":"2026-07-13T00:00:45Z","validUntilUtc":"2026-07-13T00:10:00Z","deploymentFrozen":false,"exposureState":"NONE","ambiguityState":"NONE","recoveryState":"NONE","currentSchemaVersion":1,"rollbackFloor":1}
JSON
done

note "every release switch pins a canonical live SQLite identity and refuses ambient or divergent executables"
cat > "$FAKE_ROOT/sqlite-different-safe.sh" <<'SH'
#!/usr/bin/env bash
printf '3.51.3 safe-but-different\n'
SH
cat > "$FAKE_ROOT/sqlite-unsafe.sh" <<'SH'
#!/usr/bin/env bash
printf '3.45.1 unsafe-branch\n'
SH
cat > "$FAKE_ROOT/sqlite-malformed.sh" <<'SH'
#!/usr/bin/env bash
printf 'not-a-version\n'
SH
cat > "$FAKE_ROOT/sqlite-stderr.sh" <<'SH'
#!/usr/bin/env bash
printf 'unexpected\n' >&2
printf '3.53.3\n'
SH
cat > "$FAKE_ROOT/sqlite-nonzero.sh" <<'SH'
#!/usr/bin/env bash
printf '3.53.3\n'
exit 7
SH
cat > "$FAKE_ROOT/sqlite-timeout.sh" <<'SH'
#!/usr/bin/env bash
sleep 2
printf '3.53.3\n'
SH
cat > "$FAKE_ROOT/sqlite-changed.sh" <<'SH'
#!/usr/bin/env bash
printf '\n# changed during readback\n' >> "$0"
printf '3.53.3\n'
SH
cp "$FAKE_ROOT/sqlite-safe.sh" "$FAKE_ROOT/sqlite-nonexec.sh"
chmod 755 "$FAKE_ROOT"/sqlite-different-safe.sh "$FAKE_ROOT"/sqlite-unsafe.sh \
  "$FAKE_ROOT"/sqlite-malformed.sh "$FAKE_ROOT"/sqlite-stderr.sh \
  "$FAKE_ROOT"/sqlite-nonzero.sh "$FAKE_ROOT"/sqlite-timeout.sh "$FAKE_ROOT"/sqlite-changed.sh
chmod 644 "$FAKE_ROOT/sqlite-nonexec.sh"
ln -s "$FAKE_ROOT/sqlite-safe.sh" "$FAKE_ROOT/sqlite-symlink.sh"

assert_sqlite_refused() {
  local replacement="$1" index
  local -a hostile=("${SWITCH_COMMON[@]}")
  for index in "${!hostile[@]}"; do
    if [ "${hostile[$index]}" = --sqlite ]; then hostile[$((index + 1))]="$replacement"; fi
  done
  assert_failure "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${hostile[@]}"
}

SQLITE_SYSTEMCTL_LINES="$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')"
assert_sqlite_refused "$FAKE_ROOT/sqlite-missing.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-symlink.sh"
assert_sqlite_refused "$FAKE_ROOT/../fakes/sqlite-safe.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-nonexec.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-changed.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-malformed.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-stderr.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-unsafe.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-different-safe.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-timeout.sh"
assert_sqlite_refused "$FAKE_ROOT/sqlite-nonzero.sh"
NO_SQLITE_COMMON=()
skip_next=0
for index in "${!SWITCH_COMMON[@]}"; do
  if [ "$skip_next" = 1 ]; then skip_next=0; continue; fi
  if [ "${SWITCH_COMMON[$index]}" = --sqlite ]; then skip_next=1; continue; fi
  NO_SQLITE_COMMON+=("${SWITCH_COMMON[$index]}")
done
assert_failure env SQLITE="$FAKE_ROOT/sqlite-safe.sh" SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh" \
  "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${NO_SQLITE_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$CURRENT_BEFORE"
assert_eq "$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')" "$SQLITE_SYSTEMCTL_LINES"

note "authorization endpoints and result evidence bind the exact live SQLite and first-host identities"
WRAPPER_SOURCE="$(cat "$INSTALLED_I00/bin/release-switch.sh")"
for binding in 'backup-reserve-bytes:' 'sqlite-path:' 'sqlite-sha256:' 'sqlite-version:' \
  'sqlite-identity:' 'recovery-target:' 'first-host-evidence-sha256:' 'donor-env-sha256:'; do
  assert_contains "$WRAPPER_SOURCE" "$binding"
done
assert_contains "$WRAPPER_SOURCE" 'deployment receipt authorization evidence is not the exact authorization file already validated'

note "a deterministic post-preflight race is refused by the donor under the shared lock before mutation"
RACE_TARGET="$SIMULATION_ROOT/race-target"
RACE_DATA="$SIMULATION_ROOT/race-data"
RACE_OPS="$SIMULATION_ROOT/race-ops"
RACE_EVIDENCE="$SIMULATION_ROOT/race-evidence"
mkdir -m 700 "$RACE_EVIDENCE"
cat > "$TEST_TMP/race.env" <<EOF
COSMOS_ROOT=$RACE_TARGET
RELEASES_DIR=$RACE_TARGET/releases
CURRENT_LINK=$RACE_TARGET/current
PREVIOUS_LINK=$RACE_TARGET/previous
DATA_DIR=$RACE_DATA
OPS_STATE_DIR=$RACE_OPS
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:18082
PROBE_BASE=http://127.0.0.1:18083
READINESS_GATE_PATHS=/health/live
POST_SWITCH_GATE_PATHS=/health/live
GATE_TIMEOUT_SEC=2
LOCK_TIMEOUT_SEC=2
EXPOSURE_CMD=$FAKE_ROOT/exposure.sh
ALERT_CMD=
FROZEN_MARKER=$RACE_OPS/deploy-frozen.json
MONEY_READY_MARKER=$RACE_OPS/money-ready
EOF
RACE_FIRST_HOST=(--env-file "$TEST_TMP/race.env" --runtime-env "$TEST_TMP/runtime.env" --sqlite "$FAKE_ROOT/sqlite-safe.sh" --recovery-target NO_PRIOR_RELEASE_FIRST_HOST --account simulation-account --target-host fixture-host.internal --environment simulation --backup-reserve-bytes 1000 --evidence-root "$RACE_EVIDENCE" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --simulation-systemctl-readback "$FAKE_ROOT/systemctl-inactive.sh" --now 2026-07-13T00:01:00Z)
BARRIER_DIR="$SIMULATION_ROOT/barrier-bin"
RACE_READY="$SIMULATION_ROOT/race-preflight-ready"
RACE_CONTINUE="$SIMULATION_ROOT/race-preflight-continue"
REAL_NODE_PATH="$(command -v node)"
mkdir -m 700 "$BARRIER_DIR"
cat > "$BARRIER_DIR/node" <<SH
#!/usr/bin/env bash
if [ "\${1:-}" = "$INSTALLED_I00/bin/preflight.mjs" ]; then
  "$REAL_NODE_PATH" "\$@"
  rc=\$?
  if [ "\$rc" = 0 ]; then
    : > "$RACE_READY"
    count=0
    while [ ! -e "$RACE_CONTINUE" ] && [ "\$count" -lt 200 ]; do
      sleep 0.05
      count=\$((count + 1))
    done
    [ -e "$RACE_CONTINUE" ] || exit 98
  fi
  exit "\$rc"
fi
exec "$REAL_NODE_PATH" "\$@"
SH
chmod 755 "$BARRIER_DIR/node"
RACE_SYSTEMCTL_LINES="$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')"
env PATH="$BARRIER_DIR:$PATH" SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh" \
  "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${RACE_FIRST_HOST[@]}" \
  >"$TEST_TMP/race.log" 2>&1 &
RACE_PID=$!
RACE_WAIT=0
while [ ! -e "$RACE_READY" ] && kill -0 "$RACE_PID" 2>/dev/null && [ "$RACE_WAIT" -lt 200 ]; do
  sleep 0.05
  RACE_WAIT=$((RACE_WAIT + 1))
done
[ -e "$RACE_READY" ] || fail_test "race wrapper did not reach the post-preflight barrier: $(cat "$TEST_TMP/race.log")"
mkdir -p "$SIMULATION_ROOT/competing-release" "$RACE_TARGET"
ln -s "$SIMULATION_ROOT/competing-release" "$RACE_TARGET/current"
touch "$RACE_CONTINUE"
set +e
wait "$RACE_PID"
RACE_RC=$?
set -e
[ "$RACE_RC" -ne 0 ] || fail_test "post-preflight competing current unexpectedly deployed"
pass_assertion
assert_contains "$(cat "$TEST_TMP/race.log")" 'first-host deploy refused under lock: current path is not absent'
assert_eq "$(readlink "$RACE_TARGET/current")" "$SIMULATION_ROOT/competing-release"
[ ! -e "$RACE_TARGET/previous" ] && [ ! -L "$RACE_TARGET/previous" ] || fail_test "race invented previous"
pass_assertion
assert_not_file "$RACE_TARGET/releases"
assert_not_file "$RACE_OPS/locks/deploy.lock"
assert_eq "$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')" "$RACE_SYSTEMCTL_LINES"

note "receipted containment stops the donor-proved frozen first host, proves clean baseline, and reinstalls the same sealed release"
# ops/tests/test-deploy.sh owns the preceding post-switch-failure proof: frozen,
# alerted, and no invented rollback target. This installed-wrapper proof starts
# at the corresponding containment action and uses only the marked simulation.
SEALED_SYSTEMCTL="$(node "$INSTALLED_I00/bin/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$FAKE_ROOT/systemctl.sh")"
CONTAINMENT_SYSTEMCTL_LINES="$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')"
CONTAINMENT_RESTARTS="$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")"
CONTAINMENT_EVIDENCE_BEFORE=()
while IFS= read -r bundle; do CONTAINMENT_EVIDENCE_BEFORE+=("$bundle"); done \
  < <(find "$SIMULATION_ROOT/evidence" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
"$SEALED_SYSTEMCTL" stop cosmos-app.service
assert_contains "$(tail -n 1 "$SIMULATION_ROOT/systemctl.log")" 'stop cosmos-app.service'

rm "$SIMULATION_ROOT/target/current" "$SIMULATION_ROOT/target/previous"
chmod -R u+w "$SIMULATION_ROOT/target/releases/i00-$SHA_A" "$SIMULATION_ROOT/target/releases/i00-$SHA_B"
rm -rf "$SIMULATION_ROOT/target/releases/i00-$SHA_A" "$SIMULATION_ROOT/target/releases/i00-$SHA_B"
rmdir "$SIMULATION_ROOT/target/releases" "$SIMULATION_ROOT/target"
chmod -R u+w "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/ops-state"
rm -rf "$SIMULATION_ROOT/data" "$SIMULATION_ROOT/ops-state"

[ ! -e "$SIMULATION_ROOT/target/current" ] && [ ! -L "$SIMULATION_ROOT/target/current" ] \
  || fail_test "containment clean baseline retained current"
pass_assertion
[ ! -e "$SIMULATION_ROOT/target/previous" ] && [ ! -L "$SIMULATION_ROOT/target/previous" ] \
  || fail_test "containment clean baseline retained previous"
pass_assertion
assert_not_file "$SIMULATION_ROOT/target"
assert_not_file "$SIMULATION_ROOT/data"
assert_not_file "$SIMULATION_ROOT/ops-state"

"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${FIRST_HOST_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$SIMULATION_ROOT/target/releases/i00-$SHA_A"
[ ! -e "$SIMULATION_ROOT/target/previous" ] && [ ! -L "$SIMULATION_ROOT/target/previous" ] \
  || fail_test "containment reinstall invented previous"
pass_assertion
assert_file "$SIMULATION_ROOT/target/releases/i00-$SHA_A/release.json"
assert_eq "$(wc -l < "$SIMULATION_ROOT/systemctl.log" | tr -d ' ')" "$((CONTAINMENT_SYSTEMCTL_LINES + 2))"
assert_eq "$(grep -c '^restart cosmos-app.service$' "$SIMULATION_ROOT/systemctl.log")" "$((CONTAINMENT_RESTARTS + 1))"

CONTAINMENT_BUNDLE=""
while IFS= read -r bundle; do
  already_present=0
  for prior in "${CONTAINMENT_EVIDENCE_BEFORE[@]}"; do
    if [ "$bundle" = "$prior" ]; then already_present=1; break; fi
  done
  if [ "$already_present" = 0 ]; then
    [ -z "$CONTAINMENT_BUNDLE" ] || fail_test "containment reinstall created multiple evidence bundles"
    CONTAINMENT_BUNDLE="$bundle"
  fi
done < <(find "$SIMULATION_ROOT/evidence" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
[ -n "$CONTAINMENT_BUNDLE" ] || fail_test "containment reinstall did not retain a new evidence bundle"
pass_assertion
for evidence_name in host.json supervisor.json collected-evidence.json sqlite-readback.json; do
  assert_file "$CONTAINMENT_BUNDLE/$evidence_name"
done

note "mutable donor bytes and real command paths cannot enter simulation"
cp -R "$INSTALLED_I00/accepted-ops-live" "$SIMULATION_ROOT/mutated-donor"
chmod u+w "$SIMULATION_ROOT/mutated-donor/bin/deploy.sh"
printf '\n# mutation\n' >> "$SIMULATION_ROOT/mutated-donor/bin/deploy.sh"
assert_failure env DONOR_ROOT="$SIMULATION_ROOT/mutated-donor" SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${SWITCH_COMMON[@]}"
assert_failure env SYSTEMCTL=/usr/bin/systemctl CURL="$FAKE_ROOT/curl.sh" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${SWITCH_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$CURRENT_BEFORE"

note "raw shell input, inherited mutation paths, and post-seal command edits are rejected or ignored"
cp "$TEST_TMP/env" "$TEST_TMP/injected.env"
printf 'UNRELATED=$(touch %s)\n' "$TEST_TMP/escaped" >> "$TEST_TMP/injected.env"
INJECTED_COMMON=(--env-file "$TEST_TMP/injected.env" --runtime-env "$TEST_TMP/runtime-b.env" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --sqlite "$FAKE_ROOT/sqlite-safe.sh" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now 2026-07-13T00:01:00Z)
assert_failure_contains 'simulation env key UNRELATED is not in the closed donor allowlist' "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${INJECTED_COMMON[@]}"
assert_not_file "$TEST_TMP/escaped"
rm -rf "$TEST_TMP/outside-lock"
env DEPLOY_LOCK="$TEST_TMP/outside-lock" SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh" "$INSTALLED_I00/bin/rollback-switch.sh" --release "$RELEASE_A" "${ROLLBACK_COMMON[@]}" >/dev/null
assert_not_file "$TEST_TMP/outside-lock"
chmod u+w "$FAKE_ROOT/curl.sh"
printf '\n# changed after sealing\n' >> "$FAKE_ROOT/curl.sh"
assert_failure node "$INSTALLED_I00/bin/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$FAKE_ROOT/curl.sh"
printf 'FIRST_HOST_ARTIFACT_MANIFEST_SHA256=%s\n' \
  "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE_A/artifact-manifest.json")"
printf 'FIRST_HOST_EVIDENCE_SHA256=%s\n' \
  "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$CONTAINMENT_BUNDLE/collected-evidence.json")"
finish
