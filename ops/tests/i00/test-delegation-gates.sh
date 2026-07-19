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
chmod +x "$FAKE_ROOT"/*.sh
touch "$SIMULATION_ROOT/systemctl.log" "$SIMULATION_ROOT/data/mutable-state"
node "$I00_ROOT/bin/seal-simulation-root.mjs" --root "$SIMULATION_ROOT" --commands "$FAKE_ROOT/systemctl.sh,$FAKE_ROOT/curl.sh,$FAKE_ROOT/probe.sh,$FAKE_ROOT/exposure.sh" >/dev/null

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
EOF
cat > "$TEST_TMP/runtime.env" <<'ENV'
HOST=127.0.0.1
PORT=8080
DATA_DIR=/var/lib/cosmos/data
EVIDENCE_DIR=/var/lib/cosmos/evidence
MODEL_DIR=/var/lib/cosmos/models
BACKUP_DIR=/var/backups/cosmos
CONTROL_ROOM_OPERATOR_EMAIL=operator@private.invalid
CF_ACCESS_TEAM_DOMAIN=https://team.cloudflareaccess.com
CF_ACCESS_AUD=audience_12345678
I00_TESTED_SHA=abcdef0123456789abcdef0123456789abcdef01
I00_CONFIG_REVISION=config-1
I00_MODEL_REVISION=UNAVAILABLE
I00_PUBLIC_SOURCE_STARTUP_EGRESS=1
ENV

COMMON_ENV=(env SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh")
SWITCH_COMMON=(--env-file "$TEST_TMP/env" --runtime-env "$TEST_TMP/runtime.env" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now 2026-07-13T00:01:00Z)

note "installed I00 wrapper runs without Git and executes its embedded accepted donor"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_A" "${SWITCH_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$SIMULATION_ROOT/target/releases/i00-$SHA_A"
assert_file "$SIMULATION_ROOT/data/mutable-state"
sed "s/$SHA_A/$SHA_B/" "$TEST_TMP/runtime.env" > "$TEST_TMP/runtime-b.env"
SWITCH_COMMON[3]="$TEST_TMP/runtime-b.env"
"${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${SWITCH_COMMON[@]}"
assert_eq "$(readlink "$SIMULATION_ROOT/target/current")" "$SIMULATION_ROOT/target/releases/i00-$SHA_B"
assert_eq "$(readlink "$SIMULATION_ROOT/target/previous")" "$SIMULATION_ROOT/target/releases/i00-$SHA_A"
assert_file "$SIMULATION_ROOT/data/mutable-state"
assert_contains "$(cat "$SIMULATION_ROOT/systemctl.log")" 'restart cosmos-app.service'

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
INJECTED_COMMON=(--env-file "$TEST_TMP/injected.env" --runtime-env "$TEST_TMP/runtime-b.env" --host "$TEST_TMP/host.json" --supervisor "$TEST_TMP/supervisor.json" --simulation --simulation-root "$SIMULATION_ROOT" --simulation-probe "$FAKE_ROOT/probe.sh" --now 2026-07-13T00:01:00Z)
assert_failure_contains 'simulation env key UNRELATED is not in the closed donor allowlist' "${COMMON_ENV[@]}" "$INSTALLED_I00/bin/release-switch.sh" --release "$RELEASE_B" "${INJECTED_COMMON[@]}"
assert_not_file "$TEST_TMP/escaped"
rm -rf "$TEST_TMP/outside-lock"
env DEPLOY_LOCK="$TEST_TMP/outside-lock" SYSTEMCTL="$FAKE_ROOT/systemctl.sh" CURL="$FAKE_ROOT/curl.sh" "$INSTALLED_I00/bin/rollback-switch.sh" --release "$RELEASE_A" "${ROLLBACK_COMMON[@]}" >/dev/null
assert_not_file "$TEST_TMP/outside-lock"
chmod u+w "$FAKE_ROOT/curl.sh"
printf '\n# changed after sealing\n' >> "$FAKE_ROOT/curl.sh"
assert_failure node "$INSTALLED_I00/bin/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$FAKE_ROOT/curl.sh"
finish
