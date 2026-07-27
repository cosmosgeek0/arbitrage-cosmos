#!/usr/bin/env bash
# ops/tests/test-deploy.sh — full deploy lifecycle in a local sandbox.
#
# A fake loopback app serves health from $CURRENT_LINK/runtime-behavior.env
# (re-read per request), so an atomic symlink switch observably changes the
# served release. systemctl is mocked; no systemd, no network beyond loopback.
TEST_SELF="$(cd -P -- "$(dirname "$0")" && pwd -P)/$(basename "$0")"
if [ "${DF32_DEPLOY_BARRIER_RESTART_WITNESS:-}" = 1 ]; then
  set -eu
  if [ "${1:-}" = restart ]; then
    cp "${DF32_DEPLOY_BARRIER_JOURNAL:?}" \
      "${DF32_DEPLOY_BARRIER_WITNESS:?}"
  fi
  exit 0
fi
if [ "${DF32_DEPLOY_RACE_NODE_WRAPPER:-}" = 1 ]; then
  set -u
  if [ "${1:-}" = - ] && [ "${2:-}" = recover ] && [ "${3:-}" = "$RACE_LOCK" ]; then
    : > "$RACE_LOCK_ATTEMPT"
  fi
  exec "$RACE_REAL_NODE" "$@"
fi
. "$(dirname "$0")/helpers.sh"
. "$BIN/common.sh"

export COSMOS_ROOT="$SANDBOX/opt"
export RELEASES_DIR="$COSMOS_ROOT/releases"
export CURRENT_LINK="$COSMOS_ROOT/current"
export PREVIOUS_LINK="$COSMOS_ROOT/previous"
export DATA_DIR="$SANDBOX/data"
export OPS_STATE_DIR="$SANDBOX/ops"
export APP_UNIT=df32-fixture-app.service
APP_PORT="$(pick_port)"
PROBE_PORT="$(pick_port)"
export PROBE_PORT
export HEALTH_BASE="http://127.0.0.1:$APP_PORT"
export READINESS_GATE_PATHS="/health/live /health/ready"
export POST_SWITCH_GATE_PATHS="/health/live /health/ready"
export GATE_TIMEOUT_SEC=4
export LOCK_TIMEOUT_SEC=2
export SYSTEMCTL="$FIXTURES/mock-systemctl.sh"
export MOCK_SYSTEMCTL_LOG="$SANDBOX/systemctl.log"
touch "$MOCK_SYSTEMCTL_LOG"
export ALERT_CMD="$FIXTURES/mock-alert.sh"
export MOCK_ALERT_LOG="$SANDBOX/alerts.log"
touch "$MOCK_ALERT_LOG"
export EXPOSURE_CMD="cat $SANDBOX/exposure"
echo NONE > "$SANDBOX/exposure"
export MONEY_READY_MARKER="$OPS_STATE_DIR/money-ready"
# Probe boots the fake app against the candidate's probe-behavior.env.
PROBE_FIXTURE="$FIXTURES/fake-app.mjs"
PROBE_EXPECTED_UID=""
PROBE_EXPECTED_GID=""
PROBE_IDENTITY_WITNESS=""
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  [ "$(uname -s)" = Linux ] || fail "root deploy proof requires Linux"
  PROBE_EXPECTED_UID="$(/usr/bin/id -u cosmos 2>/dev/null)" \
    || fail "root deploy proof requires the fixed cosmos user"
  PROBE_EXPECTED_GID="$(/usr/bin/id -g cosmos 2>/dev/null)" \
    || fail "root deploy proof requires the fixed cosmos group"
  chmod 755 "$SANDBOX"
  PROBE_FIXTURE="$SANDBOX/fake-app.mjs"
  cp "$FIXTURES/fake-app.mjs" "$PROBE_FIXTURE"
  chmod 444 "$PROBE_FIXTURE"
  PROBE_IDENTITY_DIR="$SANDBOX/probe-identity"
  mkdir "$PROBE_IDENTITY_DIR"
  chown "$PROBE_EXPECTED_UID:$PROBE_EXPECTED_GID" "$PROBE_IDENTITY_DIR"
  chmod 700 "$PROBE_IDENTITY_DIR"
  PROBE_IDENTITY_WITNESS="$PROBE_IDENTITY_DIR/effective.json"
  PROBE_IDENTITY_LAUNCHER="$SANDBOX/probe-identity-launcher.mjs"
  cat > "$PROBE_IDENTITY_LAUNCHER" <<'NODE'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [witness, target] = process.argv.slice(2);
fs.writeFileSync(witness, `${JSON.stringify({
  uid: process.getuid(),
  gid: process.getgid(),
  groups: process.getgroups(),
})}\n`, { flag: 'w', mode: 0o600 });
await import(pathToFileURL(target).href);
NODE
  chmod 444 "$PROBE_IDENTITY_LAUNCHER"
  printf -v PROBE_CMD \
    'BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node %q %q %q' \
    "$PROBE_IDENTITY_LAUNCHER" "$PROBE_IDENTITY_WITNESS" "$PROBE_FIXTURE"
else
  PROBE_CMD='BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node '"$PROBE_FIXTURE"
fi
export PROBE_CMD

DEPLOY="$BIN/deploy.sh"
ROLLBACK="$BIN/rollback.sh"
MAKE_RELEASE="$FIXTURES/make-release.sh"
SRC="$SANDBOX/src"
JOURNAL="$DATA_DIR/journal-compat.json"

# One long-lived fake app on the production port; behavior follows `current`.
start_fake_app "$APP_PORT" "$CURRENT_LINK/runtime-behavior.env" >/dev/null

release_served() { curl -fsS "http://127.0.0.1:$APP_PORT/release" | node -e '
  let d = ""; process.stdin.on("data", (c) => d += c);
  process.stdin.on("end", () => process.stdout.write(JSON.parse(d).releaseId));
'; }

assert_no_path_entry() { # path label
  ASSERTIONS=$((ASSERTIONS + 1))
  if [ -e "$1" ] || [ -L "$1" ]; then
    fail "${2:-expected absent path entry}: $1"
  fi
}

assert_empty_file() { # path label
  ASSERTIONS=$((ASSERTIONS + 1))
  [ ! -s "$1" ] || fail "${2:-expected empty file}: $1"
}

journal_file_mode() {
  "$NODE" -e '
    const fs = require("node:fs");
    const stat = fs.lstatSync(process.argv[1], { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
      process.exit(1);
    }
    process.stdout.write((stat.mode & 0o7777n).toString(8));
  ' "$1"
}

note "1. first deploy: happy path, immutability, journal, restart, gate"
bash "$MAKE_RELEASE" "$SRC/A" rel-A 1 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/A"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-A" "current after A"
assert_eq "$(release_served)" rel-A "served release after A"
assert_grep 'restart df32-fixture-app.service' "$MOCK_SYSTEMCTL_LOG" "app restarted"
assert_eq "$(json_get "$JOURNAL" dataSchema)" 1 "journal dataSchema"
assert_eq "$(json_get "$JOURNAL" rollbackFloor)" 0 "journal rollbackFloor"
assert_eq "$(journal_file_mode "$JOURNAL")" 644 "deployed journal mode"
assert_grep '"result":"SUCCESS"' "$OPS_STATE_DIR/deploy-log.jsonl" "deploy logged"
assert_rc 1 touch "$RELEASES_DIR/rel-A/tamper" 2>/dev/null
assert_no_file "$PREVIOUS_LINK"
if [ -n "$PROBE_IDENTITY_WITNESS" ]; then
  assert_eq "$(json_get "$PROBE_IDENTITY_WITNESS" uid)" "$PROBE_EXPECTED_UID" \
    "root probe effective uid"
  assert_eq "$(json_get "$PROBE_IDENTITY_WITNESS" gid)" "$PROBE_EXPECTED_GID" \
    "root probe effective gid"
  assert_eq "$(json_get "$PROBE_IDENTITY_WITNESS" groups)" "[$PROBE_EXPECTED_GID]" \
    "root probe supplementary groups cleared"
fi

note "2. probe gate failure: candidate rejected BEFORE switch, current untouched"
bash "$MAKE_RELEASE" "$SRC/B" rel-B 1 false 1 1 1 0   # probe-ready fails
assert_rc 1 bash "$DEPLOY" --release "$SRC/B"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-A" "current still A"
assert_eq "$(release_served)" rel-A "served release unchanged"
assert_grep '"result":"REJECTED_BY_PROBE"' "$OPS_STATE_DIR/deploy-log.jsonl" "probe rejection logged"

note "3. second deploy: previous link maintained"
bash "$MAKE_RELEASE" "$SRC/C" rel-C 1 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/C"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "current after C"
assert_link_target "$PREVIOUS_LINK" "$RELEASES_DIR/rel-A" "previous after C"

note "4. post-switch failure with exposure=NONE pre-money: automatic rollback"
bash "$MAKE_RELEASE" "$SRC/D" rel-D 1 false 0 1   # runtime live fails, probe fine
assert_rc 3 bash "$DEPLOY" --release "$SRC/D"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "auto-rolled back to C"
assert_eq "$(release_served)" rel-C "served release after auto-rollback"
assert_grep '"result":"AUTO_ROLLBACK"' "$OPS_STATE_DIR/deploy-log.jsonl" "auto-rollback logged"
assert_no_file "$OPS_STATE_DIR/deploy-frozen.json"

note "5. post-switch failure with ACTIVE exposure: FREEZE, no rollback"
echo ACTIVE > "$SANDBOX/exposure"
bash "$MAKE_RELEASE" "$SRC/E" rel-E 1 false 0 1
assert_rc 2 bash "$DEPLOY" --release "$SRC/E"
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
assert_eq "$(json_get "$OPS_STATE_DIR/deploy-frozen.json" exposure)" ACTIVE "frozen records exposure"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-E" "frozen state preserved (no flip)"
assert_grep 'critical DEPLOY_FROZEN' "$MOCK_ALERT_LOG" "freeze alerted"
# operator recovery: exposure cleared, manual rollback, marker cleared by hand
echo NONE > "$SANDBOX/exposure"
assert_rc 0 bash "$ROLLBACK"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "manual rollback to C"
rm -f "$OPS_STATE_DIR/deploy-frozen.json"

note "6. post-switch failure after money readiness: FREEZE even with exposure=NONE"
mkdir -p "$OPS_STATE_DIR" && touch "$MONEY_READY_MARKER"
bash "$MAKE_RELEASE" "$SRC/F" rel-F 1 false 0 1
assert_rc 2 bash "$DEPLOY" --release "$SRC/F"
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
rm -f "$MONEY_READY_MARKER" "$OPS_STATE_DIR/deploy-frozen.json"
assert_rc 0 bash "$ROLLBACK"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-C" "recovered to C"

note "7. concurrent deploy: lock refused quickly"
mkdir -p "$OPS_STATE_DIR/locks/deploy.lock"
echo "$$" > "$OPS_STATE_DIR/locks/deploy.lock/pid"
assert_rc 4 bash "$DEPLOY" --release "$SRC/A"
rm -rf "$OPS_STATE_DIR/locks/deploy.lock"

note "8. dirty target: pre-existing release dir refused unless --reinstall"
bash "$MAKE_RELEASE" "$SRC/G" rel-G 1 false
mkdir -p "$RELEASES_DIR/rel-G"
echo garbage > "$RELEASES_DIR/rel-G/leftover"
assert_rc 1 bash "$DEPLOY" --release "$SRC/G"
assert_rc 0 bash "$DEPLOY" --release "$SRC/G" --reinstall
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-G" "current after reinstall"
assert_no_file "$RELEASES_DIR/rel-G/leftover"

note "9. partial/invalid release sources refused"
mkdir -p "$SRC/nojson/server/dist" && touch "$SRC/nojson/server/dist/index.js"
assert_rc 1 bash "$DEPLOY" --release "$SRC/nojson"
bash "$MAKE_RELEASE" "$SRC/nodist" rel-nodist 1 false
chmod -R u+w "$SRC/nodist" && rm -rf "$SRC/nodist/server"
assert_rc 1 bash "$DEPLOY" --release "$SRC/nodist"
assert_rc 1 bash "$DEPLOY" --release "$SRC/does-not-exist"

note "9a. release rollback-floor metadata is exact and internally consistent"
RELEASE_METADATA_CURRENT="$(readlink "$CURRENT_LINK")"
RELEASE_METADATA_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"
assert_release_metadata_refusal() { # NAME MUTATION REQUIRED
  local name="$1" mutation="$2" required="$3" source output rc
  source="$SRC/release-metadata-$name"
  bash "$MAKE_RELEASE" "$source" "rel-metadata-$name" 2 false
  "$NODE" - "$source/release.json" "$mutation" <<'NODE'
const fs = require('node:fs');
const [file, mutation] = process.argv.slice(2);
const release = JSON.parse(fs.readFileSync(file, 'utf8'));
if (mutation === 'missing-floor') delete release.rollbackFloor;
else if (mutation === 'partial-floor') release.rollbackFloor = 1;
else if (mutation === 'barrier-mismatch') release.rollbackBarrier = true;
else process.exit(1);
fs.writeFileSync(file, `${JSON.stringify(release, null, 2)}\n`);
NODE
  set +e
  output="$(bash "$DEPLOY" --release "$source" 2>&1)"
  rc=$?
  set -e
  assert_eq "$rc" 1 "inconsistent release compatibility metadata refuses"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$required"*) ;;
    *) fail "release metadata refusal omitted [$required]: $output" ;;
  esac
  assert_link_target "$CURRENT_LINK" "$RELEASE_METADATA_CURRENT" \
    "release metadata refusal leaves current unchanged"
  assert_no_path_entry "$RELEASES_DIR/rel-metadata-$name" \
    "release metadata refusal installs no target"
}
assert_release_metadata_refusal missing-floor missing-floor \
  "release.json: rollbackFloor missing"
assert_release_metadata_refusal partial-floor partial-floor \
  "release rollbackFloor is not representable by its schemaVersion"
assert_release_metadata_refusal barrier-mismatch barrier-mismatch \
  "release rollbackBarrier does not match its rollbackFloor"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$RELEASE_METADATA_SYSTEMCTL_BYTES" \
  "release metadata refusals never invoke systemctl"

note "10. dirty host: current exists as a real directory -> hard refuse"
mkdir -p "$SANDBOX/opt2/current"
assert_rc 1 env CURRENT_LINK="$SANDBOX/opt2/current" \
  RELEASES_DIR="$SANDBOX/opt2/releases" PREVIOUS_LINK="$SANDBOX/opt2/previous" \
  bash "$DEPLOY" --release "$SRC/A"

note "11. non-rollback barrier recorded; older schema then refused"
bash "$MAKE_RELEASE" "$SRC/H" rel-H 2 true
BARRIER_RESTART_WITNESS="$SANDBOX/barrier-at-restart.json"
assert_rc 0 env \
  MOCK_RESTART_HOOK="$TEST_SELF" \
  DF32_DEPLOY_BARRIER_RESTART_WITNESS=1 \
  DF32_DEPLOY_BARRIER_JOURNAL="$JOURNAL" \
  DF32_DEPLOY_BARRIER_WITNESS="$BARRIER_RESTART_WITNESS" \
  bash "$DEPLOY" --release "$SRC/H"
assert_file "$BARRIER_RESTART_WITNESS"
assert_eq "$(json_get "$BARRIER_RESTART_WITNESS" dataSchema)" 1 \
  "floor-raising deploy preserves the applied schema before candidate restart"
assert_eq "$(json_get "$BARRIER_RESTART_WITNESS" rollbackFloor)" 2 \
  "floor-raising deploy commits its rollback floor before candidate restart"
assert_eq "$(json_get "$BARRIER_RESTART_WITNESS" updatedBy)" \
  deploy.sh.prestart-barrier \
  "floor-raising deploy exposes the exact PENDING sentinel at restart"
assert_eq "$(json_get "$JOURNAL" dataSchema)" 2 "journal dataSchema after barrier"
assert_eq "$(json_get "$JOURNAL" rollbackFloor)" 2 "journal rollbackFloor after barrier"
assert_eq "$(json_get "$JOURNAL" updatedBy)" deploy.sh \
  "healthy barrier deploy finalizes the steady journal state"
assert_eq "$(journal_file_mode "$JOURNAL")" 644 \
  "real barrier deploy retains the replaced journal mode"
bash "$MAKE_RELEASE" "$SRC/I" rel-I 1 false
assert_rc 1 bash "$DEPLOY" --release "$SRC/I"
assert_grep '"result":"REFUSED_SCHEMA"' "$OPS_STATE_DIR/deploy-log.jsonl" "schema refusal logged"

note "11a. rollback-floor operands refuse before any deploy mutation"
FLOOR_SRC="$SRC/FLOOR"
FLOOR_TARGET="$RELEASES_DIR/rel-floor"
FLOOR_TARGET_SENTINEL="$FLOOR_TARGET/preexisting"
FLOOR_PROBE_MARKER="$SANDBOX/floor-probe-ran"
FLOOR_INJECTION_MARKER="$SANDBOX/floor-injection-ran"
FLOOR_SCHEMA_INJECTION_MARKER="$SANDBOX/floor-schema-injection-ran"
bash "$MAKE_RELEASE" "$FLOOR_SRC" rel-floor 3 false
mkdir -p "$FLOOR_TARGET"
printf '%s\n' unchanged > "$FLOOR_TARGET_SENTINEL"
FLOOR_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"

write_floor_journal() { # missing|value|barrier-value|raw-value|raw-barrier|raw-root [value]
  case "$1" in
    missing) json_write "$JOURNAL" dataSchema=2 ;;
    value) json_write "$JOURNAL" dataSchema=2 "rollbackFloor=$2" ;;
    barrier-value) json_write "$JOURNAL" "dataSchema=$2" "rollbackFloor=$2" ;;
    raw-value) printf '{"dataSchema":2,"rollbackFloor":%s}\n' "$2" > "$JOURNAL" ;;
    raw-barrier) printf '{"dataSchema":%s,"rollbackFloor":%s}\n' "$2" "$2" > "$JOURNAL" ;;
    raw-root) printf '%s\n' "$2" > "$JOURNAL" ;;
    *) fail "unknown rollback-floor journal fixture kind: $1" ;;
  esac
}

assert_deploy_floor_case() { # kind value rc required-fragment forbidden-fragment
  local kind="$1" value="$2" expected_rc="$3"
  local required="$4" forbidden="$5" output rc
  write_floor_journal "$kind" "$value"
  set +e
  output="$(
    env FLOOR_PROBE_MARKER="$FLOOR_PROBE_MARKER" \
      PROBE_CMD=': > "$FLOOR_PROBE_MARKER"; exit 1' \
      bash "$DEPLOY" --release "$FLOOR_SRC" 2>&1
  )"
  rc=$?
  set -e
  assert_eq "$rc" "$expected_rc" "rollback-floor deploy refusal code"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$required"*) ;;
    *) fail "deploy output omitted rollback-floor proof [$required]: $output" ;;
  esac
  if [ -n "$forbidden" ]; then
    ASSERTIONS=$((ASSERTIONS + 1))
    case "$output" in
      *"$forbidden"*) fail "deploy reached forbidden later gate [$forbidden]: $output" ;;
      *) ;;
    esac
  fi
  assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
    "rollback-floor refusal leaves current unchanged"
  assert_file "$FLOOR_TARGET_SENTINEL"
  assert_no_path_entry "$FLOOR_PROBE_MARKER" \
    "rollback-floor refusal does not invoke the probe"
  assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
    "rollback-floor refusal cleans the deploy lock"
}

assert_deploy_floor_case barrier-value 7 1 \
  "candidate schemaVersion 3 is behind the non-rollback barrier" \
  "release directory already exists"
assert_deploy_floor_case missing "" 1 \
  "release directory already exists" \
  "journal document or rollbackFloor is invalid"
assert_deploy_floor_case value 0 1 \
  "release directory already exists" \
  "journal document or rollbackFloor is invalid"
for invalid_floor in "" null '"7"' "not-a-number" \
  "0; : > $FLOOR_INJECTION_MARKER" -1 3.5 9223372036854775808; do
  assert_deploy_floor_case value "$invalid_floor" 1 \
    "journal document or rollbackFloor is invalid" \
    "release directory already exists"
done
for precision_edge_floor in 1.0000000000000001 9007199254740990.5 \
  9007199254740991.1 1e-4000 -0 9007199254740992; do
  assert_deploy_floor_case raw-value "$precision_edge_floor" 1 \
    "journal document or rollbackFloor is invalid" \
    "release directory already exists"
done
assert_deploy_floor_case raw-barrier 9007199254740991 1 \
  "candidate schemaVersion 3 is behind the non-rollback barrier" \
  "journal document or rollbackFloor is invalid"
for invalid_root in null '[]' 0 '"journal"'; do
  assert_deploy_floor_case raw-root "$invalid_root" 1 \
    "journal document or rollbackFloor is invalid" \
    "release directory already exists"
done

remove_journal_endpoint() {
  if [ -d "$JOURNAL" ] && [ ! -L "$JOURNAL" ]; then
    rmdir "$JOURNAL"
  else
    rm -f -- "$JOURNAL"
  fi
}

FLOOR_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK")"
FLOOR_DEPLOY_LOG_BYTES="$(wc -c < "$OPS_STATE_DIR/deploy-log.jsonl" | tr -d ' ')"
FLOOR_ALERT_BYTES="$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')"
FLOOR_SYMLINK_TARGET="$SANDBOX/journal-symlink-target.json"
printf '{"dataSchema":2,"rollbackFloor":0}\n' > "$FLOOR_SYMLINK_TARGET"
FLOOR_SYMLINK_TARGET_SHA="$(sha256_file "$FLOOR_SYMLINK_TARGET")"
FLOOR_HARDLINK_TARGET="$SANDBOX/journal-hardlink-target.json"
printf '{"dataSchema":2,"rollbackFloor":0}\n' > "$FLOOR_HARDLINK_TARGET"
FLOOR_HARDLINK_TARGET_SHA="$(sha256_file "$FLOOR_HARDLINK_TARGET")"

assert_deploy_journal_endpoint_case() { # kind rc required forbidden
  local kind="$1" expected_rc="$2" required="$3" forbidden="$4" output rc
  local endpoint_pid="" endpoint_deadline endpoint_sha=""
  local snapshot_expected_rc=6 snapshot_output
  remove_journal_endpoint
  case "$kind" in
    absent) : ;;
    directory) mkdir "$JOURNAL" ;;
    fifo) mkfifo "$JOURNAL" ;;
    symlink) ln -s "$FLOOR_SYMLINK_TARGET" "$JOURNAL" ;;
    dangling-symlink) ln -s "$SANDBOX/missing-journal-target" "$JOURNAL" ;;
    hardlink) ln "$FLOOR_HARDLINK_TARGET" "$JOURNAL" ;;
    unreadable)
      printf '{"dataSchema":2,"rollbackFloor":0}\n' > "$JOURNAL"
      endpoint_sha="$(sha256_file "$JOURNAL")"
      chmod 000 "$JOURNAL"
      snapshot_expected_rc=4
      ;;
    oversized)
      "$NODE" -e '
        require("node:fs").writeFileSync(process.argv[1], Buffer.alloc(1048577, 65));
      ' "$JOURNAL"
      endpoint_sha="$(sha256_file "$JOURNAL")"
      ;;
    socket)
      "$NODE" -e '
        const net = require("node:net");
        const path = require("node:path");
        const server = net.createServer();
        const endpoint = process.argv[1];
        process.chdir(path.dirname(endpoint));
        server.listen(path.basename(endpoint));
      ' "$JOURNAL" &
      endpoint_pid=$!
      register_pid "$endpoint_pid"
      endpoint_deadline=$(( $(date -u +%s) + 5 ))
      while [ ! -S "$JOURNAL" ]; do
        kill -0 "$endpoint_pid" 2>/dev/null \
          || fail "journal socket fixture exited before binding"
        [ "$(date -u +%s)" -lt "$endpoint_deadline" ] \
          || fail "journal socket fixture did not bind"
        sleep 0.1
      done
      ;;
    *) fail "unknown deploy journal endpoint kind: $kind" ;;
  esac
  [ "$kind" = absent ] && snapshot_expected_rc=0
  run_bounded_capture "$SANDBOX/journal-snapshot-$kind.out" 20 \
    bash -c '
      . "$1"
      journal_state_snapshot "$2"
    ' _ "$BIN/common.sh" "$JOURNAL"
  snapshot_output="$BOUNDED_OUTPUT"
  assert_eq "$BOUNDED_RC" "$snapshot_expected_rc" \
    "journal snapshot classifies $kind endpoint"
  if [ "$kind" = absent ]; then
    assert_eq "$snapshot_output" "ABSENT|0|0|-|-|-|-|-|-" \
      "journal snapshot emits the exact absent token"
  else
    assert_eq "$snapshot_output" "" \
      "unsafe journal snapshot emits no usable token"
  fi
  run_bounded_capture "$SANDBOX/deploy-journal-$kind.out" 20 \
    env FLOOR_PROBE_MARKER="$FLOOR_PROBE_MARKER" \
      PROBE_CMD=': > "$FLOOR_PROBE_MARKER"; exit 1' \
      bash "$DEPLOY" --release "$FLOOR_SRC"
  output="$BOUNDED_OUTPUT"
  rc="$BOUNDED_RC"
  assert_eq "$rc" "$expected_rc" "deploy journal endpoint $kind refusal code"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$required"*) ;;
    *) fail "deploy journal endpoint $kind omitted [$required]: $output" ;;
  esac
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$forbidden"*) fail "deploy journal endpoint $kind reached [$forbidden]: $output" ;;
    *) ;;
  esac
  assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
    "deploy journal endpoint $kind leaves current unchanged"
  assert_link_target "$PREVIOUS_LINK" "$FLOOR_PREVIOUS_TARGET" \
    "deploy journal endpoint $kind leaves previous unchanged"
  assert_file "$FLOOR_TARGET_SENTINEL"
  assert_no_path_entry "$FLOOR_PROBE_MARKER" \
    "deploy journal endpoint $kind does not invoke probe"
  assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
    "deploy journal endpoint $kind does not publish a lock"
  assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
    "$FLOOR_SYSTEMCTL_BYTES" "deploy journal endpoint $kind does not invoke systemctl"
  assert_eq "$(wc -c < "$OPS_STATE_DIR/deploy-log.jsonl" | tr -d ' ')" \
    "$FLOOR_DEPLOY_LOG_BYTES" "deploy journal endpoint $kind does not append the deploy log"
  assert_eq "$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')" \
    "$FLOOR_ALERT_BYTES" "deploy journal endpoint $kind does not alert"
  case "$kind" in
    absent)
      assert_no_path_entry "$JOURNAL" "absent deploy journal remains absent"
      ;;
    directory)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -d "$JOURNAL" ] && [ ! -L "$JOURNAL" ] \
        || fail "deploy changed the journal directory endpoint"
      ;;
    fifo)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -p "$JOURNAL" ] || fail "deploy changed the journal FIFO endpoint"
      ;;
    symlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -L "$JOURNAL" ] || fail "deploy changed the journal symlink endpoint"
      assert_eq "$(sha256_file "$FLOOR_SYMLINK_TARGET")" \
        "$FLOOR_SYMLINK_TARGET_SHA" "deploy leaves journal symlink target unchanged"
      ;;
    dangling-symlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -L "$JOURNAL" ] || fail "deploy changed the dangling journal symlink endpoint"
      ;;
    hardlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ "$JOURNAL" -ef "$FLOOR_HARDLINK_TARGET" ] \
        || fail "deploy changed the journal hardlink endpoint"
      assert_eq "$(sha256_file "$FLOOR_HARDLINK_TARGET")" \
        "$FLOOR_HARDLINK_TARGET_SHA" "deploy leaves journal hardlink peer unchanged"
      ;;
    oversized)
      assert_file "$JOURNAL"
      assert_eq "$(sha256_file "$JOURNAL")" "$endpoint_sha" \
        "deploy leaves oversized journal bytes unchanged"
      ;;
    unreadable)
      assert_file "$JOURNAL"
      assert_eq "$(journal_file_mode "$JOURNAL")" 0 \
        "deploy leaves unreadable journal mode unchanged"
      chmod 600 "$JOURNAL"
      assert_eq "$(sha256_file "$JOURNAL")" "$endpoint_sha" \
        "deploy leaves unreadable journal bytes unchanged"
      ;;
    socket)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -S "$JOURNAL" ] || fail "deploy changed the journal socket endpoint"
      ;;
  esac
  if [ -n "$endpoint_pid" ]; then
    kill "$endpoint_pid" 2>/dev/null || true
    wait "$endpoint_pid" 2>/dev/null || true
    unregister_pid "$endpoint_pid"
  fi
  remove_journal_endpoint
}

assert_deploy_journal_endpoint_case absent 1 \
  "release directory already exists" \
  "journal path is occupied"
assert_deploy_journal_endpoint_case directory 1 \
  "journal path is occupied by a non-regular or linked endpoint" \
  "release directory already exists"
assert_deploy_journal_endpoint_case fifo 1 \
  "journal path is occupied by a non-regular or linked endpoint" \
  "release directory already exists"
assert_deploy_journal_endpoint_case symlink 1 \
  "JOURNAL_FILE must be one exact raw canonical absolute path" \
  "release directory already exists"
assert_deploy_journal_endpoint_case dangling-symlink 1 \
  "JOURNAL_FILE must be one exact raw canonical absolute path" \
  "release directory already exists"
assert_deploy_journal_endpoint_case hardlink 1 \
  "journal path is occupied by a non-regular or linked endpoint" \
  "release directory already exists"
assert_deploy_journal_endpoint_case oversized 1 \
  "or exceeds the size limit" \
  "release directory already exists"
assert_deploy_journal_endpoint_case socket 1 \
  "journal path is occupied by a non-regular or linked endpoint" \
  "release directory already exists"
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  assert_deploy_journal_endpoint_case unreadable 1 \
    "journal unreadable:" \
    "release directory already exists"
fi

note "11c2. journal change after validation refuses before the deploy switch"
SWITCH_SRC="$SRC/JOURNAL-SWITCH-STALE"
bash "$MAKE_RELEASE" "$SWITCH_SRC" rel-journal-switch-stale 2 false
write_floor_journal value 0
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  chown "$PROBE_EXPECTED_UID:$PROBE_EXPECTED_GID" "$DATA_DIR" "$JOURNAL"
  chmod 0700 "$DATA_DIR"
  chmod 0600 "$JOURNAL"
else
  chmod 0666 "$JOURNAL"
fi
SWITCH_CURRENT_TARGET="$(readlink "$CURRENT_LINK")"
SWITCH_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK")"
SWITCH_SYSTEMCTL_BYTES="$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')"
printf -v SWITCH_PROBE_CMD \
  'printf "%%s\\n" %q > %q; BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec %q %q' \
  '{"dataSchema":3,"rollbackFloor":0,"externalRevision":"before-switch"}' \
  "$JOURNAL" "$NODE" "$PROBE_FIXTURE"
set +e
SWITCH_OUTPUT="$(
  env PROBE_CMD="$SWITCH_PROBE_CMD" \
    bash "$DEPLOY" --release "$SWITCH_SRC" 2>&1
)"
SWITCH_RC=$?
set -e
assert_eq "$SWITCH_RC" 1 \
  "journal change after validation refuses the deploy switch"
ASSERTIONS=$((ASSERTIONS + 1))
case "$SWITCH_OUTPUT" in
  *"journal changed after under-lock validation - refusing to switch releases"*) ;;
  *) fail "deploy pre-switch journal change omitted exact refusal: $SWITCH_OUTPUT" ;;
esac
assert_link_target "$CURRENT_LINK" "$SWITCH_CURRENT_TARGET" \
  "deploy pre-switch journal change leaves current unchanged"
assert_link_target "$PREVIOUS_LINK" "$SWITCH_PREVIOUS_TARGET" \
  "deploy pre-switch journal change leaves previous unchanged"
assert_eq "$(json_get "$JOURNAL" externalRevision)" before-switch \
  "deploy pre-switch refusal preserves newer journal bytes"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$SWITCH_SYSTEMCTL_BYTES" "deploy pre-switch refusal does not invoke systemctl"
assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
  "deploy pre-switch refusal cleans the deploy lock"
chmod 0644 "$JOURNAL"
write_floor_journal value 0

assert_no_file "$FLOOR_INJECTION_MARKER"
assert_eq "$(sed -n '1p' "$FLOOR_TARGET_SENTINEL")" unchanged \
  "dirty target sentinel remains unchanged"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "rollback-floor cases do not invoke systemctl"

FLOOR_BAD_SCHEMA_SRC="$SRC/FLOOR-BAD-SCHEMA"
bash "$MAKE_RELEASE" "$FLOOR_BAD_SCHEMA_SRC" rel-floor-bad-schema \
  "\"0; : > $FLOOR_SCHEMA_INJECTION_MARKER\"" false
write_floor_journal value 2
set +e
FLOOR_BAD_SCHEMA_OUTPUT="$(
  env FLOOR_PROBE_MARKER="$FLOOR_PROBE_MARKER" \
    PROBE_CMD=': > "$FLOOR_PROBE_MARKER"; exit 1' \
    bash "$DEPLOY" --release "$FLOOR_BAD_SCHEMA_SRC" 2>&1
)"
FLOOR_BAD_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_BAD_SCHEMA_RC" 1 "malformed deploy schema refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_BAD_SCHEMA_OUTPUT" in
  *"schemaVersion must be a non-negative integer"*) ;;
  *) fail "malformed deploy schema omitted exact refusal: $FLOOR_BAD_SCHEMA_OUTPUT" ;;
esac
assert_no_file "$FLOOR_SCHEMA_INJECTION_MARKER"
assert_no_path_entry "$RELEASES_DIR/rel-floor-bad-schema" \
  "malformed schema is not installed"
assert_no_path_entry "$FLOOR_PROBE_MARKER" \
  "malformed schema does not invoke the probe"
assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
  "malformed schema does not acquire the deploy lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "malformed schema does not invoke systemctl"

FLOOR_HUGE_SCHEMA_SRC="$SRC/FLOOR-HUGE-SCHEMA"
bash "$MAKE_RELEASE" "$FLOOR_HUGE_SCHEMA_SRC" rel-floor-huge-schema \
  9223372036854775808 false
set +e
FLOOR_HUGE_SCHEMA_OUTPUT="$(
  env FLOOR_PROBE_MARKER="$FLOOR_PROBE_MARKER" \
    PROBE_CMD=': > "$FLOOR_PROBE_MARKER"; exit 1' \
    bash "$DEPLOY" --release "$FLOOR_HUGE_SCHEMA_SRC" 2>&1
)"
FLOOR_HUGE_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_HUGE_SCHEMA_RC" 1 "oversized deploy schema refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_HUGE_SCHEMA_OUTPUT" in
  *"schemaVersion must be a non-negative integer"*) ;;
  *) fail "oversized deploy schema omitted exact refusal: $FLOOR_HUGE_SCHEMA_OUTPUT" ;;
esac
assert_no_path_entry "$RELEASES_DIR/rel-floor-huge-schema" \
  "oversized schema is not installed"
assert_no_path_entry "$FLOOR_PROBE_MARKER" \
  "oversized schema does not invoke the probe"
assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
  "oversized schema does not acquire the deploy lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "oversized schema does not invoke systemctl"

FLOOR_STRING_SCHEMA_SRC="$SRC/FLOOR-STRING-SCHEMA"
bash "$MAKE_RELEASE" "$FLOOR_STRING_SCHEMA_SRC" rel-floor-string-schema \
  '"3"' false
set +e
FLOOR_STRING_SCHEMA_OUTPUT="$(
  env FLOOR_PROBE_MARKER="$FLOOR_PROBE_MARKER" \
    PROBE_CMD=': > "$FLOOR_PROBE_MARKER"; exit 1' \
    bash "$DEPLOY" --release "$FLOOR_STRING_SCHEMA_SRC" 2>&1
)"
FLOOR_STRING_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_STRING_SCHEMA_RC" 1 "numeric-string deploy schema refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_STRING_SCHEMA_OUTPUT" in
  *"schemaVersion must be a non-negative integer"*) ;;
  *) fail "numeric-string deploy schema omitted exact refusal: $FLOOR_STRING_SCHEMA_OUTPUT" ;;
esac
assert_no_path_entry "$RELEASES_DIR/rel-floor-string-schema" \
  "numeric-string schema is not installed"
assert_no_path_entry "$FLOOR_PROBE_MARKER" \
  "numeric-string schema does not invoke the probe"
assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
  "numeric-string schema does not acquire the deploy lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "numeric-string schema does not invoke systemctl"

FLOOR_PRECISION_SCHEMA_INDEX=0
for precision_edge_schema in 1.0000000000000001 9007199254740990.5 1e-4000; do
  FLOOR_PRECISION_SCHEMA_INDEX=$((FLOOR_PRECISION_SCHEMA_INDEX + 1))
  FLOOR_PRECISION_SCHEMA_SRC="$SRC/FLOOR-PRECISION-SCHEMA-$FLOOR_PRECISION_SCHEMA_INDEX"
  FLOOR_PRECISION_SCHEMA_ID="rel-floor-precision-schema-$FLOOR_PRECISION_SCHEMA_INDEX"
  bash "$MAKE_RELEASE" "$FLOOR_PRECISION_SCHEMA_SRC" \
    "$FLOOR_PRECISION_SCHEMA_ID" "$precision_edge_schema" false
  set +e
  FLOOR_PRECISION_SCHEMA_OUTPUT="$(
    env FLOOR_PROBE_MARKER="$FLOOR_PROBE_MARKER" \
      PROBE_CMD=': > "$FLOOR_PROBE_MARKER"; exit 1' \
      bash "$DEPLOY" --release "$FLOOR_PRECISION_SCHEMA_SRC" 2>&1
  )"
  FLOOR_PRECISION_SCHEMA_RC=$?
  set -e
  assert_eq "$FLOOR_PRECISION_SCHEMA_RC" 1 \
    "precision-edge deploy schema refuses"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$FLOOR_PRECISION_SCHEMA_OUTPUT" in
    *"schemaVersion must be a non-negative integer"*) ;;
    *) fail "precision-edge deploy schema omitted exact refusal: $FLOOR_PRECISION_SCHEMA_OUTPUT" ;;
  esac
  assert_no_path_entry "$RELEASES_DIR/$FLOOR_PRECISION_SCHEMA_ID" \
    "precision-edge schema is not installed"
  assert_no_path_entry "$FLOOR_PROBE_MARKER" \
    "precision-edge schema does not invoke the probe"
  assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
    "precision-edge schema does not acquire the deploy lock"
  assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
    "$FLOOR_SYSTEMCTL_BYTES" "precision-edge schema does not invoke systemctl"
done
write_floor_journal value 2

note "12. stale lock from a crashed deploy (dead owner pid) is reclaimed"
mkdir -p "$OPS_STATE_DIR/locks/deploy.lock"
echo 999999 > "$OPS_STATE_DIR/locks/deploy.lock/pid"
bash "$MAKE_RELEASE" "$SRC/K" rel-K 2 false
assert_rc 0 bash "$DEPLOY" --release "$SRC/K"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-K" "deployed through stale lock"
assert_no_file "$OPS_STATE_DIR/locks/deploy.lock"

note "13. auto-rollback itself failing escalates to FREEZE"
# dirty host: the previous release (rel-K's predecessor is now rel-K itself
# after this deploy) gets deleted from disk while still linked
chmod -R u+w "$RELEASES_DIR/rel-K" && rm -rf "$RELEASES_DIR/rel-K"
bash "$MAKE_RELEASE" "$SRC/J" rel-J 2 false 0 1   # runtime live fails
echo NONE > "$SANDBOX/exposure"
assert_rc 2 bash "$DEPLOY" --release "$SRC/J"
assert_file "$OPS_STATE_DIR/deploy-frozen.json"
assert_grep 'AUTOMATIC ROLLBACK ALSO FAILED' "$OPS_STATE_DIR/deploy-frozen.json" "escalation recorded"

note "14. first-host marker refuses every occupied current/previous path before mutation"
bash "$MAKE_RELEASE" "$SRC/FIRST-HOST-GUARD" rel-first-host-guard 1 false

assert_injected_path_unchanged() { # kind path target-or-marker
  local kind="$1" path="$2" witness="$3"
  case "$kind" in
    valid-symlink|dangling-symlink)
      assert_link_target "$path" "$witness" "$kind remains unchanged"
      ;;
    regular-file)
      assert_file "$path"
      assert_eq "$(sed -n '1p' "$path")" "$witness" "regular file remains unchanged"
      ;;
    directory)
      assert_dir "$path"
      assert_file "$path/$witness"
      ;;
    *) fail "unknown injected-path kind: $kind" ;;
  esac
}

run_first_host_occupied_case() { # current|previous kind
  local which="$1" kind="$2"
  local case_id="$which-$kind"
  local case_root="$SANDBOX/first-host-guard/$case_id/root"
  local case_releases="$case_root/releases"
  local case_current="$case_root/current"
  local case_previous="$case_root/previous"
  local case_data="$SANDBOX/first-host-guard/$case_id/data"
  local case_ops="$SANDBOX/first-host-guard/$case_id/ops"
  local case_systemctl="$SANDBOX/first-host-guard/$case_id/systemctl.log"
  local case_probe="$SANDBOX/first-host-guard/$case_id/probe-ran"
  local injected="$case_current" other="$case_previous" witness=""

  mkdir -p "$case_root" "$(dirname "$case_systemctl")"
  : > "$case_systemctl"
  if [ "$which" = previous ]; then
    injected="$case_previous"
    other="$case_current"
  fi
  case "$kind" in
    valid-symlink)
      witness="$case_root/injected-target"
      mkdir -p "$witness"
      ln -s "$witness" "$injected"
      ;;
    dangling-symlink)
      witness="$case_root/missing-target"
      ln -s "$witness" "$injected"
      ;;
    regular-file)
      witness="FIRST_HOST_INJECTED_REGULAR_FILE"
      printf '%s\n' "$witness" > "$injected"
      ;;
    directory)
      witness="FIRST_HOST_INJECTED_DIRECTORY_MARKER"
      mkdir -p "$injected"
      : > "$injected/$witness"
      ;;
    *) fail "unknown first-host occupied-path kind: $kind" ;;
  esac

  assert_rc 1 env \
    COSMOS_ROOT="$case_root" RELEASES_DIR="$case_releases" \
    CURRENT_LINK="$case_current" PREVIOUS_LINK="$case_previous" \
    DATA_DIR="$case_data" OPS_STATE_DIR="$case_ops" \
    MOCK_SYSTEMCTL_LOG="$case_systemctl" \
    GUARD_PROBE_MARKER="$case_probe" \
    PROBE_CMD=': > "$GUARD_PROBE_MARKER"; exit 1' \
    I00_REQUIRE_FIRST_HOST_NO_CURRENT=1 \
    bash "$DEPLOY" --release "$SRC/FIRST-HOST-GUARD"
  assert_injected_path_unchanged "$kind" "$injected" "$witness"
  assert_no_path_entry "$other" "uninjected peer link remains absent"
  assert_no_path_entry "$case_releases" "release root is not installed"
  assert_no_path_entry "$case_probe" "probe is not invoked"
  assert_empty_file "$case_systemctl" "systemctl is not invoked"
  assert_no_path_entry "$case_ops/locks/deploy.lock" "deploy lock is cleaned"
}

for first_host_link in current previous; do
  for first_host_kind in valid-symlink dangling-symlink regular-file directory; do
    run_first_host_occupied_case "$first_host_link" "$first_host_kind"
  done
done

note "15. any set marker other than exact 1 refuses before mutation"
run_wrong_first_host_marker_case() { # case-id marker-value
  local case_id="$1" marker_value="$2"
  local case_root="$SANDBOX/first-host-marker/$case_id/root"
  local case_releases="$case_root/releases"
  local case_current="$case_root/current"
  local case_previous="$case_root/previous"
  local case_data="$SANDBOX/first-host-marker/$case_id/data"
  local case_ops="$SANDBOX/first-host-marker/$case_id/ops"
  local case_systemctl="$SANDBOX/first-host-marker/$case_id/systemctl.log"
  local case_probe="$SANDBOX/first-host-marker/$case_id/probe-ran"

  mkdir -p "$case_root" "$(dirname "$case_systemctl")"
  : > "$case_systemctl"
  assert_rc 1 env \
    COSMOS_ROOT="$case_root" RELEASES_DIR="$case_releases" \
    CURRENT_LINK="$case_current" PREVIOUS_LINK="$case_previous" \
    DATA_DIR="$case_data" OPS_STATE_DIR="$case_ops" \
    MOCK_SYSTEMCTL_LOG="$case_systemctl" \
    GUARD_PROBE_MARKER="$case_probe" \
    PROBE_CMD=': > "$GUARD_PROBE_MARKER"; exit 1' \
    I00_REQUIRE_FIRST_HOST_NO_CURRENT="$marker_value" \
    bash "$DEPLOY" --release "$SRC/FIRST-HOST-GUARD"
  assert_no_path_entry "$case_current" "wrong marker leaves current absent"
  assert_no_path_entry "$case_previous" "wrong marker leaves previous absent"
  assert_no_path_entry "$case_releases" "wrong marker does not install release"
  assert_no_path_entry "$case_probe" "wrong marker does not invoke probe"
  assert_empty_file "$case_systemctl" "wrong marker does not invoke systemctl"
  assert_no_path_entry "$case_ops/locks/deploy.lock" "wrong-marker lock is cleaned"
}

run_wrong_first_host_marker_case empty ""
run_wrong_first_host_marker_case zero 0
run_wrong_first_host_marker_case leading-zero 01
run_wrong_first_host_marker_case word true

note "16. deterministic TOCTOU: path created while donor waits for lock is refused"
RACE_ROOT="$SANDBOX/first-host-race/root"
RACE_RELEASES="$RACE_ROOT/releases"
RACE_CURRENT="$RACE_ROOT/current"
RACE_PREVIOUS="$RACE_ROOT/previous"
RACE_DATA="$SANDBOX/first-host-race/data"
RACE_OPS="$SANDBOX/first-host-race/ops"
RACE_LOCK="$RACE_OPS/locks/deploy.lock"
RACE_SYSTEMCTL_LOG="$SANDBOX/first-host-race/systemctl.log"
RACE_PROBE_MARKER="$SANDBOX/first-host-race/probe-ran"
RACE_LOCK_ATTEMPT="$SANDBOX/first-host-race/lock-attempt"
RACE_RC_FILE="$SANDBOX/first-host-race/deploy.rc"
RACE_OUTPUT="$SANDBOX/first-host-race/deploy.log"
RACE_NODE_WRAPPER="$(canonical_path "$0")" \
  || fail "test could not canonicalize deterministic race Node wrapper"
RACE_REAL_NODE="$(command -v node)"
mkdir -p "$RACE_ROOT" "$(dirname "$RACE_SYSTEMCTL_LOG")"
RACE_LOCK="$(canonical_path "$RACE_LOCK")" \
  || fail "test could not canonicalize deterministic race lock"
: > "$RACE_SYSTEMCTL_LOG"
acquire_lock "$RACE_LOCK" || fail "test could not acquire deterministic race lock"
(
  set +e
  env \
    COSMOS_ROOT="$RACE_ROOT" RELEASES_DIR="$RACE_RELEASES" \
    CURRENT_LINK="$RACE_CURRENT" PREVIOUS_LINK="$RACE_PREVIOUS" \
    DATA_DIR="$RACE_DATA" OPS_STATE_DIR="$RACE_OPS" DEPLOY_LOCK="$RACE_LOCK" \
    MOCK_SYSTEMCTL_LOG="$RACE_SYSTEMCTL_LOG" \
    GUARD_PROBE_MARKER="$RACE_PROBE_MARKER" \
    PROBE_CMD=': > "$GUARD_PROBE_MARKER"; exit 1' \
    I00_REQUIRE_FIRST_HOST_NO_CURRENT=1 \
    DF32_DEPLOY_RACE_NODE_WRAPPER=1 \
    NODE="$RACE_NODE_WRAPPER" RACE_LOCK="$RACE_LOCK" \
    RACE_LOCK_ATTEMPT="$RACE_LOCK_ATTEMPT" RACE_REAL_NODE="$RACE_REAL_NODE" \
    bash "$DEPLOY" --release "$SRC/FIRST-HOST-GUARD" \
    >"$RACE_OUTPUT" 2>&1
  printf '%s\n' "$?" > "$RACE_RC_FILE"
) &
RACE_DEPLOY_PID=$!
register_pid "$RACE_DEPLOY_PID"
RACE_DEADLINE=$(( $(date -u +%s) + 60 ))
while [ ! -f "$RACE_LOCK_ATTEMPT" ]; do
  kill -0 "$RACE_DEPLOY_PID" 2>/dev/null \
    || fail "racing deploy exited before attempting the held lock"
  [ "$(date -u +%s)" -lt "$RACE_DEADLINE" ] \
    || fail "timeout waiting for racing deploy to attempt the held lock"
  sleep 0.1
done
mkdir -p "$RACE_ROOT/injected-current-target"
ln -s "$RACE_ROOT/injected-current-target" "$RACE_CURRENT"
release_lock "$RACE_LOCK" || fail "test could not release deterministic race lock"
wait "$RACE_DEPLOY_PID" || true
assert_file "$RACE_RC_FILE"
assert_eq "$(sed -n '1p' "$RACE_RC_FILE")" 1 "racing deploy refuses injected current"
assert_link_target "$RACE_CURRENT" "$RACE_ROOT/injected-current-target" "racing current remains unchanged"
assert_no_path_entry "$RACE_PREVIOUS" "racing deploy leaves previous absent"
assert_no_path_entry "$RACE_RELEASES" "racing deploy does not install release"
assert_no_path_entry "$RACE_PROBE_MARKER" "racing deploy does not invoke probe"
assert_empty_file "$RACE_SYSTEMCTL_LOG" "racing deploy does not invoke systemctl"
assert_no_path_entry "$RACE_LOCK" "racing deploy lock is cleaned"

note "17. clean first-host post-switch failure freezes without inventing rollback"
FIRST_FAIL_ROOT="$SANDBOX/first-host-post-switch/root"
FIRST_FAIL_RELEASES="$FIRST_FAIL_ROOT/releases"
FIRST_FAIL_CURRENT="$FIRST_FAIL_ROOT/current"
FIRST_FAIL_PREVIOUS="$FIRST_FAIL_ROOT/previous"
FIRST_FAIL_DATA="$SANDBOX/first-host-post-switch/data"
FIRST_FAIL_OPS="$SANDBOX/first-host-post-switch/ops"
FIRST_FAIL_SYSTEMCTL_LOG="$SANDBOX/first-host-post-switch/systemctl.log"
FIRST_FAIL_ALERT_LOG="$SANDBOX/first-host-post-switch/alerts.log"
FIRST_FAIL_EXPOSURE="$SANDBOX/first-host-post-switch/exposure"
FIRST_FAIL_PROBE_MARKER="$SANDBOX/first-host-post-switch/probe-passed"
FIRST_FAIL_PORT="$(pick_port)"
mkdir -p "$FIRST_FAIL_ROOT" "$(dirname "$FIRST_FAIL_SYSTEMCTL_LOG")"
: > "$FIRST_FAIL_SYSTEMCTL_LOG"
: > "$FIRST_FAIL_ALERT_LOG"
printf '%s\n' NONE > "$FIRST_FAIL_EXPOSURE"
bash "$MAKE_RELEASE" "$SRC/FIRST-HOST-POST-SWITCH" rel-first-host-post-switch 1 false 0 1 1 1
start_fake_app "$FIRST_FAIL_PORT" "$FIRST_FAIL_CURRENT/runtime-behavior.env" >/dev/null
printf -v FIRST_FAIL_PROBE_CMD \
  ': > %q; BEHAVIOR_FILE="$RELEASE_DIR/probe-behavior.env" PORT="$PROBE_PORT" exec node %q' \
  "$FIRST_FAIL_PROBE_MARKER" "$FIXTURES/fake-app.mjs"
assert_rc 2 env \
  COSMOS_ROOT="$FIRST_FAIL_ROOT" RELEASES_DIR="$FIRST_FAIL_RELEASES" \
  CURRENT_LINK="$FIRST_FAIL_CURRENT" PREVIOUS_LINK="$FIRST_FAIL_PREVIOUS" \
  DATA_DIR="$FIRST_FAIL_DATA" OPS_STATE_DIR="$FIRST_FAIL_OPS" \
  DEPLOY_LOCK="$FIRST_FAIL_OPS/locks/deploy.lock" \
  DEPLOY_LOG="$FIRST_FAIL_OPS/deploy-log.jsonl" \
  FROZEN_MARKER="$FIRST_FAIL_OPS/deploy-frozen.json" \
  MONEY_READY_MARKER="$FIRST_FAIL_OPS/money-ready" \
  HEALTH_BASE="http://127.0.0.1:$FIRST_FAIL_PORT" GATE_TIMEOUT_SEC=2 \
  MOCK_SYSTEMCTL_LOG="$FIRST_FAIL_SYSTEMCTL_LOG" \
  MOCK_ALERT_LOG="$FIRST_FAIL_ALERT_LOG" \
  EXPOSURE_CMD="cat $FIRST_FAIL_EXPOSURE" \
  FIRST_FAIL_PROBE_MARKER="$FIRST_FAIL_PROBE_MARKER" \
  PROBE_CMD="$FIRST_FAIL_PROBE_CMD" \
  I00_REQUIRE_FIRST_HOST_NO_CURRENT=1 \
  bash "$DEPLOY" --release "$SRC/FIRST-HOST-POST-SWITCH"
assert_file "$FIRST_FAIL_PROBE_MARKER"
assert_link_target "$FIRST_FAIL_CURRENT" "$FIRST_FAIL_RELEASES/rel-first-host-post-switch" "failed first-host candidate remains current"
assert_no_path_entry "$FIRST_FAIL_PREVIOUS" "failed first-host has no rollback target"
assert_file "$FIRST_FAIL_OPS/deploy-frozen.json"
assert_grep 'critical DEPLOY_FROZEN' "$FIRST_FAIL_ALERT_LOG" "first-host freeze alerted"
assert_grep 'restart df32-fixture-app.service' "$FIRST_FAIL_SYSTEMCTL_LOG" "first-host candidate restarted"
assert_grep '"result":"FROZEN"' "$FIRST_FAIL_OPS/deploy-log.jsonl" "first-host freeze logged"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FIRST_FAIL_OPS/deploy-log.jsonl" "first-host never auto-rolls back"
assert_no_path_entry "$FIRST_FAIL_OPS/locks/deploy.lock" "first-host failure lock is cleaned"

run_post_switch_fault_deploy() { # DEPLOY_SCRIPT RELEASE_SOURCE
  local deploy_script="$1" release_source="$2"
  env \
    COSMOS_ROOT="$FAULT_ROOT" RELEASES_DIR="$FAULT_RELEASES" \
    CURRENT_LINK="$FAULT_CURRENT" PREVIOUS_LINK="$FAULT_PREVIOUS" \
    DATA_DIR="$FAULT_DATA" OPS_STATE_DIR="$FAULT_OPS" \
    DEPLOY_LOCK="$FAULT_OPS/locks/deploy.lock" \
    DEPLOY_LOG="$FAULT_OPS/deploy-log.jsonl" \
    FROZEN_MARKER="$FAULT_OPS/deploy-frozen.json" \
    MONEY_READY_MARKER="$FAULT_OPS/money-ready" \
    HEALTH_BASE="http://127.0.0.1:$FAULT_PORT" GATE_TIMEOUT_SEC=2 \
    MOCK_SYSTEMCTL_LOG="$FAULT_SYSTEMCTL_LOG" \
    MOCK_ALERT_LOG="$FAULT_ALERT_LOG" \
    EXPOSURE_CMD="cat $FAULT_EXPOSURE" \
    PROBE_PORT="$FAULT_PROBE_PORT" \
    bash "$deploy_script" --release "$release_source"
}

note "17a. restart failure after floor prearm is fix-forward-only and freezes"
FAULT_ROOT="$SANDBOX/barrier-restart-failure/root"
FAULT_RELEASES="$FAULT_ROOT/releases"
FAULT_CURRENT="$FAULT_ROOT/current"
FAULT_PREVIOUS="$FAULT_ROOT/previous"
FAULT_DATA="$SANDBOX/barrier-restart-failure/data"
FAULT_OPS="$SANDBOX/barrier-restart-failure/ops"
FAULT_SYSTEMCTL_LOG="$SANDBOX/barrier-restart-failure/systemctl.log"
FAULT_ALERT_LOG="$SANDBOX/barrier-restart-failure/alerts.log"
FAULT_EXPOSURE="$SANDBOX/barrier-restart-failure/exposure"
FAULT_BASE_SRC="$SRC/BARRIER-RESTART-BASE"
FAULT_CANDIDATE_SRC="$SRC/BARRIER-RESTART-CANDIDATE"
FAULT_PORT="$(pick_port)"
FAULT_PROBE_PORT="$(pick_port)"
mkdir -p "$FAULT_ROOT" "$(dirname "$FAULT_SYSTEMCTL_LOG")"
: > "$FAULT_SYSTEMCTL_LOG"
: > "$FAULT_ALERT_LOG"
printf '%s\n' NONE > "$FAULT_EXPOSURE"
bash "$MAKE_RELEASE" "$FAULT_BASE_SRC" rel-barrier-restart-base 1 false
bash "$MAKE_RELEASE" "$FAULT_CANDIDATE_SRC" rel-barrier-restart-candidate 2 true
start_fake_app "$FAULT_PORT" "$FAULT_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_BASE_SRC"
export MOCK_RESTART_RC=9
assert_rc 2 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_CANDIDATE_SRC"
unset MOCK_RESTART_RC
assert_link_target "$FAULT_CURRENT" \
  "$FAULT_RELEASES/rel-barrier-restart-candidate" \
  "restart failure preserves the committed-forward candidate"
assert_link_target "$FAULT_PREVIOUS" \
  "$FAULT_RELEASES/rel-barrier-restart-base" \
  "restart failure retains the prior release only as previous"
BARRIER_FAILURE_SNAPSHOT="$(
  journal_state_snapshot "$FAULT_DATA/journal-compat.json"
)"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BARRIER_FAILURE_SNAPSHOT" in
  PENDING\|1\|2\|*) ;;
  *) fail "restart failure did not preserve the exact PENDING barrier: $BARRIER_FAILURE_SNAPSHOT" ;;
esac
assert_file "$FAULT_OPS/deploy-frozen.json"
assert_grep 'rollback barrier was armed before candidate start' \
  "$FAULT_OPS/deploy-frozen.json" \
  "restart failure records the committed-forward rollback policy"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FAULT_OPS/deploy-log.jsonl" \
  "restart failure after floor prearm never auto-rolls back"
assert_no_path_entry "$FAULT_OPS/locks/deploy.lock" \
  "restart failure after floor prearm cleans the deploy lock"

note "17b. health failure after floor prearm preserves PENDING and never rolls back"
FAULT_ROOT="$SANDBOX/barrier-health-failure/root"
FAULT_RELEASES="$FAULT_ROOT/releases"
FAULT_CURRENT="$FAULT_ROOT/current"
FAULT_PREVIOUS="$FAULT_ROOT/previous"
FAULT_DATA="$SANDBOX/barrier-health-failure/data"
FAULT_OPS="$SANDBOX/barrier-health-failure/ops"
FAULT_SYSTEMCTL_LOG="$SANDBOX/barrier-health-failure/systemctl.log"
FAULT_ALERT_LOG="$SANDBOX/barrier-health-failure/alerts.log"
FAULT_EXPOSURE="$SANDBOX/barrier-health-failure/exposure"
FAULT_BASE_SRC="$SRC/BARRIER-HEALTH-BASE"
FAULT_CANDIDATE_SRC="$SRC/BARRIER-HEALTH-CANDIDATE"
FAULT_PORT="$(pick_port)"
FAULT_PROBE_PORT="$(pick_port)"
mkdir -p "$FAULT_ROOT" "$(dirname "$FAULT_SYSTEMCTL_LOG")"
: > "$FAULT_SYSTEMCTL_LOG"
: > "$FAULT_ALERT_LOG"
printf '%s\n' NONE > "$FAULT_EXPOSURE"
bash "$MAKE_RELEASE" "$FAULT_BASE_SRC" rel-barrier-health-base 1 false
bash "$MAKE_RELEASE" \
  "$FAULT_CANDIDATE_SRC" rel-barrier-health-candidate 2 true 0 1 1 1
start_fake_app "$FAULT_PORT" "$FAULT_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_BASE_SRC"
assert_rc 2 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_CANDIDATE_SRC"
assert_link_target "$FAULT_CURRENT" \
  "$FAULT_RELEASES/rel-barrier-health-candidate" \
  "health failure preserves the committed-forward candidate"
BARRIER_FAILURE_SNAPSHOT="$(
  journal_state_snapshot "$FAULT_DATA/journal-compat.json"
)"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BARRIER_FAILURE_SNAPSHOT" in
  PENDING\|1\|2\|*) ;;
  *) fail "health failure did not preserve the exact PENDING barrier: $BARRIER_FAILURE_SNAPSHOT" ;;
esac
assert_grep 'post-switch health gate failed; rollback barrier was armed' \
  "$FAULT_OPS/deploy-frozen.json" \
  "health failure records why automatic rollback is forbidden"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FAULT_OPS/deploy-log.jsonl" \
  "health failure after floor prearm never auto-rolls back"

note "17c. a compatible fix-forward deploy finalizes an existing PENDING barrier"
FAULT_ROOT="$SANDBOX/barrier-fix-forward/root"
FAULT_RELEASES="$FAULT_ROOT/releases"
FAULT_CURRENT="$FAULT_ROOT/current"
FAULT_PREVIOUS="$FAULT_ROOT/previous"
FAULT_DATA="$SANDBOX/barrier-fix-forward/data"
FAULT_OPS="$SANDBOX/barrier-fix-forward/ops"
FAULT_SYSTEMCTL_LOG="$SANDBOX/barrier-fix-forward/systemctl.log"
FAULT_ALERT_LOG="$SANDBOX/barrier-fix-forward/alerts.log"
FAULT_EXPOSURE="$SANDBOX/barrier-fix-forward/exposure"
FAULT_BASE_SRC="$SRC/BARRIER-FIX-FORWARD-BASE"
FAULT_CANDIDATE_SRC="$SRC/BARRIER-FIX-FORWARD-CANDIDATE"
FAULT_PORT="$(pick_port)"
FAULT_PROBE_PORT="$(pick_port)"
mkdir -p "$FAULT_ROOT" "$(dirname "$FAULT_SYSTEMCTL_LOG")"
: > "$FAULT_SYSTEMCTL_LOG"
: > "$FAULT_ALERT_LOG"
printf '%s\n' NONE > "$FAULT_EXPOSURE"
bash "$MAKE_RELEASE" "$FAULT_BASE_SRC" rel-barrier-fix-forward-base 1 false
bash "$MAKE_RELEASE" \
  "$FAULT_CANDIDATE_SRC" rel-barrier-fix-forward-candidate 2 true
start_fake_app "$FAULT_PORT" "$FAULT_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_BASE_SRC"
json_write "$FAULT_DATA/journal-compat.json" \
  dataSchema=1 rollbackFloor=2 \
  updatedAtUtc=2026-07-27T00:00:00Z \
  updatedBy=deploy.sh.prestart-barrier
json_write "$FAULT_OPS/deploy-frozen.json" \
  ts=2026-07-27T00:00:00Z \
  releaseId=rel-barrier-fix-forward-candidate \
  exposure=NONE reason=pending operatorAction=required
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_CANDIDATE_SRC"
assert_link_target "$FAULT_CURRENT" \
  "$FAULT_RELEASES/rel-barrier-fix-forward-candidate" \
  "fix-forward deploy publishes the compatible candidate"
assert_eq "$(json_get "$FAULT_DATA/journal-compat.json" dataSchema)" 2 \
  "fix-forward deploy finalizes the applied schema"
assert_eq "$(json_get "$FAULT_DATA/journal-compat.json" rollbackFloor)" 2 \
  "fix-forward deploy preserves the armed floor"
assert_eq "$(json_get "$FAULT_DATA/journal-compat.json" updatedBy)" deploy.sh \
  "fix-forward deploy returns the journal to steady PRESENT"
assert_no_path_entry "$FAULT_OPS/deploy-frozen.json" \
  "healthy fix-forward completion clears the stale frozen marker"
assert_grep '"result":"SUCCESS"' "$FAULT_OPS/deploy-log.jsonl" \
  "fix-forward completion records success"

finish
