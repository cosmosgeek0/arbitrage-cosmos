#!/usr/bin/env bash
# ops/tests/test-deploy.sh — full deploy lifecycle in a local sandbox.
#
# A fake loopback app serves health from $CURRENT_LINK/runtime-behavior.env
# (re-read per request), so an atomic symlink switch observably changes the
# served release. systemctl is mocked; no systemd, no network beyond loopback.
TEST_SELF="$(cd -P -- "$(dirname "$0")" && pwd -P)/$(basename "$0")"
if [ "${DF32_DEPLOY_JOURNAL_PUBLISH_HOOK:-}" = 1 ]; then
  set -eu
  if [ ! -e "${DF32_DEPLOY_JOURNAL_PUBLISH_HOOK_ONCE:?}" ]; then
    printf '%s\n' \
      '{"dataSchema":1,"rollbackFloor":0,"externalRevision":"outside-update"}' \
      > "${DF32_DEPLOY_JOURNAL_PUBLISH_HOOK_FILE:?}"
    : > "$DF32_DEPLOY_JOURNAL_PUBLISH_HOOK_ONCE"
  fi
  exit 0
fi
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

note "11b2. unreadable regular journal emits rc4 without a usable token"
remove_journal_endpoint
printf '{"dataSchema":2,"rollbackFloor":0}\n' > "$JOURNAL"
UNREADABLE_JOURNAL_SHA="$(sha256_file "$JOURNAL")"
chmod 000 "$JOURNAL"
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  [ -x /usr/bin/setpriv ] \
    || fail "root unreadable-journal proof requires /usr/bin/setpriv"
  run_bounded_capture "$SANDBOX/journal-snapshot-unreadable-root.out" 20 \
    /usr/bin/setpriv \
      --reuid="$PROBE_EXPECTED_UID" --regid="$PROBE_EXPECTED_GID" \
      --clear-groups --inh-caps=-all --bounding-set=-all --nnp \
      /usr/bin/env -i \
      PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/tmp TMPDIR=/tmp \
      /bin/bash -p -c '
        . "$1"
        journal_state_snapshot "$2"
      ' _ /proc/self/fd/47 /proc/self/fd/48/journal-compat.json \
      47<"$BIN/common.sh" 48<"$DATA_DIR"
  UNREADABLE_SNAPSHOT_RC="$BOUNDED_RC"
  UNREADABLE_SNAPSHOT_OUTPUT="$BOUNDED_OUTPUT"
  [ -x /usr/bin/curl ] \
    || fail "root unreadable-journal deploy proof requires /usr/bin/curl"
  run_bounded_capture "$SANDBOX/deploy-journal-unreadable-root.out" 20 \
    /usr/bin/setpriv \
      --reuid="$PROBE_EXPECTED_UID" --regid="$PROBE_EXPECTED_GID" \
      --clear-groups --inh-caps=-all --bounding-set=-all --nnp \
      /usr/bin/env -i \
      PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/tmp TMPDIR=/tmp \
      NODE=/usr/bin/node CURL=/usr/bin/curl SYSTEMCTL="$SYSTEMCTL" \
      COSMOS_ROOT="$COSMOS_ROOT" RELEASES_DIR="$RELEASES_DIR" \
      CURRENT_LINK="$CURRENT_LINK" PREVIOUS_LINK="$PREVIOUS_LINK" \
      DATA_DIR="$DATA_DIR" OPS_STATE_DIR="$OPS_STATE_DIR" \
      APP_UNIT="$APP_UNIT" HEALTH_BASE="$HEALTH_BASE" \
      READINESS_GATE_PATHS="$READINESS_GATE_PATHS" \
      POST_SWITCH_GATE_PATHS="$POST_SWITCH_GATE_PATHS" \
      GATE_TIMEOUT_SEC="$GATE_TIMEOUT_SEC" LOCK_TIMEOUT_SEC="$LOCK_TIMEOUT_SEC" \
      /bin/bash -p "$DEPLOY" --release "$FLOOR_SRC"
  assert_eq "$BOUNDED_RC" 1 \
    "root privilege-dropped deploy refuses the unreadable journal"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$BOUNDED_OUTPUT" in
    *"journal unreadable"*) ;;
    *) fail "root unreadable-journal deploy omitted its refusal: $BOUNDED_OUTPUT" ;;
  esac
else
  run_bounded_capture "$SANDBOX/journal-snapshot-unreadable.out" 20 \
    /bin/bash -p -c '
      . "$1"
      journal_state_snapshot "$2"
    ' _ "$BIN/common.sh" "$JOURNAL"
  UNREADABLE_SNAPSHOT_RC="$BOUNDED_RC"
  UNREADABLE_SNAPSHOT_OUTPUT="$BOUNDED_OUTPUT"
fi
assert_eq "$UNREADABLE_SNAPSHOT_RC" 4 \
  "unreadable regular journal returns the unstable-or-unreadable status"
assert_eq "$UNREADABLE_SNAPSHOT_OUTPUT" "" \
  "unreadable regular journal emits no usable token"
assert_eq "$(journal_file_mode "$JOURNAL")" 0 \
  "unreadable snapshot leaves journal mode unchanged"
chmod 600 "$JOURNAL"
assert_eq "$(sha256_file "$JOURNAL")" "$UNREADABLE_JOURNAL_SHA" \
  "unreadable snapshot leaves exact journal bytes unchanged"
assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
  "unreadable journal leaves current unchanged"
assert_link_target "$PREVIOUS_LINK" "$FLOOR_PREVIOUS_TARGET" \
  "unreadable journal leaves previous unchanged"
assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
  "unreadable journal never publishes the deploy lock"
assert_eq "$(wc -c < "$MOCK_SYSTEMCTL_LOG" | tr -d ' ')" \
  "$FLOOR_SYSTEMCTL_BYTES" "unreadable journal does not invoke systemctl"
assert_eq "$(wc -c < "$OPS_STATE_DIR/deploy-log.jsonl" | tr -d ' ')" \
  "$FLOOR_DEPLOY_LOG_BYTES" "unreadable journal does not append the deploy log"
assert_eq "$(wc -c < "$MOCK_ALERT_LOG" | tr -d ' ')" \
  "$FLOOR_ALERT_BYTES" "unreadable journal does not alert"
remove_journal_endpoint

note "11c. journal preflight precedes a live deploy-lock wait"
HELD_JOURNAL_LOCK="$OPS_STATE_DIR/locks/deploy.lock"
acquire_lock "$HELD_JOURNAL_LOCK" \
  || fail "could not create held lock for journal preflight ordering"
HELD_JOURNAL_OWNER="$HELD_JOURNAL_LOCK/owner.json"
HELD_JOURNAL_OWNER_SHA="$(sha256_file "$HELD_JOURNAL_OWNER")"
remove_journal_endpoint
mkdir "$JOURNAL"
run_bounded_capture "$SANDBOX/deploy-journal-held-unsafe.out" 20 \
  env LOCK_TIMEOUT_SEC=30 \
    bash "$DEPLOY" --release "$FLOOR_SRC"
assert_eq "$BOUNDED_RC" 1 \
  "unsafe journal refuses before a held-lock wait"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BOUNDED_OUTPUT" in
  *"journal path is occupied by a non-regular or linked endpoint"*) ;;
  *) fail "unsafe journal did not precede the held-lock gate: $BOUNDED_OUTPUT" ;;
esac
assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
  "unsafe journal leaves held-lock owner unchanged"
remove_journal_endpoint
for held_journal_case in invalid-floor invalid-data-schema invalid-relation; do
  case "$held_journal_case" in
    invalid-floor)
      printf '{"dataSchema":2,"rollbackFloor":null}\n' > "$JOURNAL"
      HELD_JOURNAL_REQUIRED="journal document or rollbackFloor is invalid"
      ;;
    invalid-data-schema)
      printf '{"dataSchema":null,"rollbackFloor":0}\n' > "$JOURNAL"
      HELD_JOURNAL_REQUIRED="journal dataSchema is not a nonnegative integer"
      ;;
    invalid-relation)
      printf '{"dataSchema":1,"rollbackFloor":2}\n' > "$JOURNAL"
      HELD_JOURNAL_REQUIRED="journal rollbackFloor exceeds dataSchema"
      ;;
  esac
  run_bounded_capture "$SANDBOX/deploy-journal-held-$held_journal_case.out" 20 \
    env LOCK_TIMEOUT_SEC=30 \
      bash "$DEPLOY" --release "$FLOOR_SRC"
  assert_eq "$BOUNDED_RC" 1 \
    "$held_journal_case refuses before a held deploy-lock wait"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$BOUNDED_OUTPUT" in
    *"$HELD_JOURNAL_REQUIRED"*) ;;
    *) fail "$held_journal_case did not precede the held deploy-lock gate: $BOUNDED_OUTPUT" ;;
  esac
  assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
    "$held_journal_case leaves held-lock owner unchanged"
done
remove_journal_endpoint
run_bounded_capture "$SANDBOX/deploy-journal-held-absent.out" 20 \
  bash "$DEPLOY" --release "$FLOOR_SRC"
assert_eq "$BOUNDED_RC" 4 \
  "absent journal reaches the held-lock gate"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BOUNDED_OUTPUT" in
  *"deploy lock busy"*) ;;
  *) fail "absent journal did not reach the held-lock gate: $BOUNDED_OUTPUT" ;;
esac
assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
  "absent journal leaves held-lock owner unchanged"
write_floor_journal value 0
run_bounded_capture "$SANDBOX/deploy-journal-held-regular.out" 20 \
  bash "$DEPLOY" --release "$FLOOR_SRC"
assert_eq "$BOUNDED_RC" 4 \
  "regular journal reaches the held-lock gate"
assert_eq "$(sha256_file "$HELD_JOURNAL_OWNER")" "$HELD_JOURNAL_OWNER_SHA" \
  "regular journal leaves held-lock owner unchanged"
release_lock "$HELD_JOURNAL_LOCK" \
  || fail "could not release held journal-ordering lock"
assert_no_path_entry "$HELD_JOURNAL_LOCK" \
  "journal-ordering lock is released by its exact owner"

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

note "11b. safety-state publisher accepts only absent or single-link regular endpoints"
WRITER_ROOT="$SANDBOX/journal-writer"
WRITER_ENDPOINT="$WRITER_ROOT/state.json"
WRITER_TARGET="$WRITER_ROOT/target.json"
mkdir "$WRITER_ROOT"
printf '{"dataSchema":0,"rollbackFloor":0}\n' > "$WRITER_TARGET"
WRITER_TARGET_SHA="$(sha256_file "$WRITER_TARGET")"

assert_writer_refuses_endpoint() { # directory|fifo|symlink|hardlink|socket
  local kind="$1" rc endpoint_pid="" endpoint_deadline
  local expected_snapshot="ABSENT|0|0|-|-|-|-|-|-"
  if [ -d "$WRITER_ENDPOINT" ] && [ ! -L "$WRITER_ENDPOINT" ]; then
    rmdir "$WRITER_ENDPOINT"
  else
    rm -f -- "$WRITER_ENDPOINT"
  fi
  case "$kind" in
    directory) mkdir "$WRITER_ENDPOINT" ;;
    fifo) mkfifo "$WRITER_ENDPOINT" ;;
    symlink) ln -s "$WRITER_TARGET" "$WRITER_ENDPOINT" ;;
    hardlink)
      ln "$WRITER_TARGET" "$WRITER_ENDPOINT"
      expected_snapshot="$(
        "$NODE" -e '
          const crypto = require("node:crypto");
          const fs = require("node:fs");
          const file = process.argv[1];
          const stat = fs.lstatSync(file, { bigint: true });
          const bytes = fs.readFileSync(file);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 2n) {
            process.exit(1);
          }
          process.stdout.write([
            "PRESENT", "0", "0", String(stat.dev), String(stat.ino),
            String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs),
            crypto.createHash("sha256").update(bytes).digest("hex"),
          ].join("|"));
        ' "$WRITER_ENDPOINT"
      )"
      ;;
    socket)
      "$NODE" -e '
        const net = require("node:net");
        const path = require("node:path");
        const server = net.createServer();
        const endpoint = process.argv[1];
        process.chdir(path.dirname(endpoint));
        server.listen(path.basename(endpoint));
      ' "$WRITER_ENDPOINT" &
      endpoint_pid=$!
      register_pid "$endpoint_pid"
      endpoint_deadline=$(( $(date -u +%s) + 5 ))
      while [ ! -S "$WRITER_ENDPOINT" ]; do
        kill -0 "$endpoint_pid" 2>/dev/null \
          || fail "safety-state writer socket fixture exited before binding"
        [ "$(date -u +%s)" -lt "$endpoint_deadline" ] \
          || fail "safety-state writer socket fixture did not bind"
        sleep 0.1
      done
      ;;
    *) fail "unknown safety-state writer endpoint kind: $kind" ;;
  esac
  run_bounded_capture "$SANDBOX/journal-writer-$kind.out" 20 \
    bash -c '
      . "$1"
      json_write_exact_regular_or_absent \
        "$2" "$3" dataSchema=1 rollbackFloor=0
    ' _ "$BIN/common.sh" "$WRITER_ENDPOINT" "$expected_snapshot"
  rc="$BOUNDED_RC"
  assert_eq "$rc" 1 "safety-state writer refuses $kind endpoint"
  assert_eq "$(sha256_file "$WRITER_TARGET")" "$WRITER_TARGET_SHA" \
    "safety-state writer leaves $kind peer target unchanged"
  case "$kind" in
    directory)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -d "$WRITER_ENDPOINT" ] && [ ! -L "$WRITER_ENDPOINT" ] \
        || fail "safety-state writer changed directory endpoint"
      ;;
    fifo)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -p "$WRITER_ENDPOINT" ] || fail "safety-state writer changed FIFO endpoint"
      ;;
    symlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -L "$WRITER_ENDPOINT" ] || fail "safety-state writer changed symlink endpoint"
      ;;
    hardlink)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ "$WRITER_ENDPOINT" -ef "$WRITER_TARGET" ] \
        || fail "safety-state writer changed hardlink endpoint"
      ;;
    socket)
      ASSERTIONS=$((ASSERTIONS + 1))
      [ -S "$WRITER_ENDPOINT" ] \
        || fail "safety-state writer changed socket endpoint"
      ;;
  esac
  if [ -n "$endpoint_pid" ]; then
    kill "$endpoint_pid" 2>/dev/null || true
    wait "$endpoint_pid" 2>/dev/null || true
    unregister_pid "$endpoint_pid"
  fi
}

for writer_endpoint_kind in directory fifo symlink hardlink socket; do
  assert_writer_refuses_endpoint "$writer_endpoint_kind"
done
if [ -d "$WRITER_ENDPOINT" ] && [ ! -L "$WRITER_ENDPOINT" ]; then
  rmdir "$WRITER_ENDPOINT"
else
  rm -f -- "$WRITER_ENDPOINT"
fi
WRITER_ABSENT_SNAPSHOT="ABSENT|0|0|-|-|-|-|-|-"
WRITER_PRESENT_WHILE_ABSENT="$(journal_state_snapshot "$WRITER_TARGET")"
WRITER_ABSENT_CAS_ROWS=(
  "present-on-absent=$WRITER_PRESENT_WHILE_ABSENT"
  "noncanonical-absent=${WRITER_ABSENT_SNAPSHOT}|extra"
)
for writer_cas_row in "${WRITER_ABSENT_CAS_ROWS[@]}"; do
  writer_cas_label="${writer_cas_row%%=*}"
  writer_cas_token="${writer_cas_row#*=}"
  run_bounded_capture \
    "$SANDBOX/journal-writer-cas-$writer_cas_label.out" 20 \
    bash -c '
      . "$1"
      json_write_exact_regular_or_absent \
        "$2" "$3" dataSchema=3 rollbackFloor=0
    ' _ "$BIN/common.sh" "$WRITER_ENDPOINT" "$writer_cas_token"
  assert_eq "$BOUNDED_RC" 1 \
    "safety-state writer refuses $writer_cas_label"
  assert_no_path_entry "$WRITER_ENDPOINT" \
    "safety-state writer leaves $writer_cas_label endpoint absent"
done
unset WRITER_PRESENT_WHILE_ABSENT WRITER_ABSENT_CAS_ROWS
unset writer_cas_row writer_cas_label writer_cas_token
assert_rc 0 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_ABSENT_SNAPSHOT" \
  dataSchema=1 rollbackFloor=0
assert_eq "$(json_get "$WRITER_ENDPOINT" dataSchema)" 1 \
  "safety-state writer publishes an absent endpoint"
assert_eq "$(journal_file_mode "$WRITER_ENDPOINT")" 644 \
  "safety-state writer absent publication mode"
WRITER_REGULAR_SNAPSHOT="$(journal_state_snapshot "$WRITER_ENDPOINT")"
assert_rc 0 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_REGULAR_SNAPSHOT" \
  dataSchema=1 rollbackFloor=2 \
  updatedAtUtc=2026-07-27T00:00:00Z \
  updatedBy=deploy.sh.prestart-barrier
WRITER_PENDING_SNAPSHOT="$(journal_state_snapshot "$WRITER_ENDPOINT")"
case "$WRITER_PENDING_SNAPSHOT" in
  PENDING\|1\|2\|*) ASSERTIONS=$((ASSERTIONS + 1)) ;;
  *) fail "safety-state writer did not publish the exact pending transition" ;;
esac
assert_rc 0 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_PENDING_SNAPSHOT" \
  dataSchema=2 rollbackFloor=2 \
  updatedAtUtc=2026-07-27T00:00:01Z updatedBy=deploy.sh
assert_eq "$(json_get "$WRITER_ENDPOINT" dataSchema)" 2 \
  "safety-state writer atomically replaces one regular endpoint"
assert_eq "$(json_get "$WRITER_ENDPOINT" rollbackFloor)" 2 \
  "safety-state writer finalizes the pending floor without lowering it"
assert_eq "$(journal_file_mode "$WRITER_ENDPOINT")" 644 \
  "safety-state writer replacement mode"
WRITER_CAS_SNAPSHOT="$(journal_state_snapshot "$WRITER_ENDPOINT")"
WRITER_CAS_SHA="$(sha256_file "$WRITER_ENDPOINT")"
WRITER_CAS_PREFIX="${WRITER_CAS_SNAPSHOT%|*}"
WRITER_CAS_DIGEST="${WRITER_CAS_SNAPSHOT##*|}"
WRITER_CAS_REST="${WRITER_CAS_SNAPSHOT#PRESENT|2|2|}"
case "$WRITER_CAS_DIGEST" in
  0*) WRITER_CAS_WRONG_DIGEST="1${WRITER_CAS_DIGEST#?}" ;;
  *) WRITER_CAS_WRONG_DIGEST="0${WRITER_CAS_DIGEST#?}" ;;
esac
WRITER_REGULAR_CAS_ROWS=(
  "empty="
  "unknown-state=UNKNOWN|${WRITER_CAS_SNAPSHOT#PRESENT|}"
  "short-present=$WRITER_CAS_PREFIX"
  "long-present=${WRITER_CAS_SNAPSHOT}|extra"
  "schema-invalid=PRESENT|INVALID|2|$WRITER_CAS_REST"
  "floor-invalid=PRESENT|2|INVALID|$WRITER_CAS_REST"
  "short-digest=${WRITER_CAS_PREFIX}|${WRITER_CAS_DIGEST%?}"
  "nonhex-digest=${WRITER_CAS_PREFIX}|g${WRITER_CAS_DIGEST#?}"
  "wrong-digest=${WRITER_CAS_PREFIX}|$WRITER_CAS_WRONG_DIGEST"
  "absent-on-regular=$WRITER_ABSENT_SNAPSHOT"
)
for writer_cas_row in "${WRITER_REGULAR_CAS_ROWS[@]}"; do
  writer_cas_label="${writer_cas_row%%=*}"
  writer_cas_token="${writer_cas_row#*=}"
  run_bounded_capture \
    "$SANDBOX/journal-writer-cas-$writer_cas_label.out" 20 \
    bash -c '
      . "$1"
      json_write_exact_regular_or_absent \
        "$2" "$3" dataSchema=3 rollbackFloor=2
    ' _ "$BIN/common.sh" "$WRITER_ENDPOINT" "$writer_cas_token"
  assert_eq "$BOUNDED_RC" 1 \
    "safety-state writer refuses $writer_cas_label"
  assert_eq "$(journal_state_snapshot "$WRITER_ENDPOINT")" \
    "$WRITER_CAS_SNAPSHOT" \
    "safety-state writer preserves $writer_cas_label snapshot"
  assert_eq "$(sha256_file "$WRITER_ENDPOINT")" "$WRITER_CAS_SHA" \
    "safety-state writer preserves $writer_cas_label bytes"
done
unset WRITER_CAS_SNAPSHOT WRITER_CAS_SHA WRITER_CAS_PREFIX
unset WRITER_CAS_DIGEST WRITER_CAS_REST WRITER_CAS_WRONG_DIGEST
unset WRITER_REGULAR_CAS_ROWS writer_cas_row writer_cas_label writer_cas_token
WRITER_GENERATED_VALUE_SHA="$(sha256_file "$WRITER_ENDPOINT")"
WRITER_GENERATED_VALUE_SNAPSHOT="$(journal_state_snapshot "$WRITER_ENDPOINT")"
assert_rc 1 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_GENERATED_VALUE_SNAPSHOT" \
  dataSchema=1 rollbackFloor=2
assert_rc 1 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_GENERATED_VALUE_SNAPSHOT" \
  dataSchema=null rollbackFloor=0
assert_rc 1 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_GENERATED_VALUE_SNAPSHOT" \
  dataSchema=3
assert_eq "$(sha256_file "$WRITER_ENDPOINT")" "$WRITER_GENERATED_VALUE_SHA" \
  "safety-state writer rejects invalid generated compatibility values"
WRITER_STALE_SNAPSHOT="$(journal_state_snapshot "$WRITER_ENDPOINT")"
WRITER_STALE_SNAPSHOT_REST="${WRITER_STALE_SNAPSHOT#PRESENT|2|2|}"
WRITER_LYING_SNAPSHOT="PRESENT|4|1|$WRITER_STALE_SNAPSHOT_REST"
WRITER_BOUND_SHA="$(sha256_file "$WRITER_ENDPOINT")"
assert_rc 1 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_LYING_SNAPSHOT" \
  dataSchema=4 rollbackFloor=1
assert_eq "$(sha256_file "$WRITER_ENDPOINT")" "$WRITER_BOUND_SHA" \
  "safety-state writer rejects snapshot fields not bound to the hashed bytes"
unset WRITER_STALE_SNAPSHOT_REST WRITER_LYING_SNAPSHOT WRITER_BOUND_SHA
json_write "$WRITER_ENDPOINT" \
  dataSchema=3 rollbackFloor=7 externalRevision=outside-update
WRITER_NEWER_SHA="$(sha256_file "$WRITER_ENDPOINT")"
assert_rc 1 json_write_exact_regular_or_absent \
  "$WRITER_ENDPOINT" "$WRITER_STALE_SNAPSHOT" \
  dataSchema=4 rollbackFloor=1
assert_eq "$(sha256_file "$WRITER_ENDPOINT")" "$WRITER_NEWER_SHA" \
  "safety-state writer preserves bytes newer than its bound snapshot"
assert_eq "$(json_get "$WRITER_ENDPOINT" rollbackFloor)" 7 \
  "safety-state writer preserves the newer rollback floor"
assert_eq "$(
  find "$WRITER_ROOT" -maxdepth 1 -name '.state.json.write-*' -print \
    | wc -l | tr -d ' '
)" 0 "safety-state writer leaves no staging path"

note "11d. stale journal after switch refuses publication and auto-rolls back"
PUBLISH_ROOT="$SANDBOX/journal-publish/root"
PUBLISH_RELEASES="$PUBLISH_ROOT/releases"
PUBLISH_CURRENT="$PUBLISH_ROOT/current"
PUBLISH_PREVIOUS="$PUBLISH_ROOT/previous"
PUBLISH_DATA="$SANDBOX/journal-publish/data"
PUBLISH_OPS="$SANDBOX/journal-publish/ops"
PUBLISH_JOURNAL="$PUBLISH_DATA/journal-compat.json"
PUBLISH_SYSTEMCTL_LOG="$SANDBOX/journal-publish/systemctl.log"
PUBLISH_ALERT_LOG="$SANDBOX/journal-publish/alerts.log"
PUBLISH_EXPOSURE="$SANDBOX/journal-publish/exposure"
PUBLISH_HOOK_ONCE="$SANDBOX/journal-publish/hook.once"
PUBLISH_EXPECTED_JOURNAL="$SANDBOX/journal-publish/expected-newer-journal.json"
PUBLISH_BASE_SRC="$SRC/JOURNAL-PUBLISH-BASE"
PUBLISH_CANDIDATE_SRC="$SRC/JOURNAL-PUBLISH-CANDIDATE"
PUBLISH_PORT="$(pick_port)"
PUBLISH_HOOK="$(canonical_path "$0")" \
  || fail "test could not canonicalize journal publication hook"
mkdir -p "$PUBLISH_ROOT" "$(dirname "$PUBLISH_SYSTEMCTL_LOG")"
: > "$PUBLISH_SYSTEMCTL_LOG"
: > "$PUBLISH_ALERT_LOG"
printf '%s\n' NONE > "$PUBLISH_EXPOSURE"
printf '%s\n' \
  '{"dataSchema":1,"rollbackFloor":0,"externalRevision":"outside-update"}' \
  > "$PUBLISH_EXPECTED_JOURNAL"
PUBLISH_EXPECTED_JOURNAL_SHA="$(sha256_file "$PUBLISH_EXPECTED_JOURNAL")"
bash "$MAKE_RELEASE" "$PUBLISH_BASE_SRC" rel-journal-publish-base 1 false
bash "$MAKE_RELEASE" \
  "$PUBLISH_CANDIDATE_SRC" rel-journal-publish-candidate 1 false
start_fake_app "$PUBLISH_PORT" \
  "$PUBLISH_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 env \
  COSMOS_ROOT="$PUBLISH_ROOT" RELEASES_DIR="$PUBLISH_RELEASES" \
  CURRENT_LINK="$PUBLISH_CURRENT" PREVIOUS_LINK="$PUBLISH_PREVIOUS" \
  DATA_DIR="$PUBLISH_DATA" OPS_STATE_DIR="$PUBLISH_OPS" \
  DEPLOY_LOCK="$PUBLISH_OPS/locks/deploy.lock" \
  DEPLOY_LOG="$PUBLISH_OPS/deploy-log.jsonl" \
  FROZEN_MARKER="$PUBLISH_OPS/deploy-frozen.json" \
  MONEY_READY_MARKER="$PUBLISH_OPS/money-ready" \
  JOURNAL_FILE="$PUBLISH_JOURNAL" \
  HEALTH_BASE="http://127.0.0.1:$PUBLISH_PORT" GATE_TIMEOUT_SEC=2 \
  MOCK_SYSTEMCTL_LOG="$PUBLISH_SYSTEMCTL_LOG" \
  MOCK_ALERT_LOG="$PUBLISH_ALERT_LOG" \
  EXPOSURE_CMD="cat $PUBLISH_EXPOSURE" \
  bash "$DEPLOY" --release "$PUBLISH_BASE_SRC"
assert_rc 3 env \
  COSMOS_ROOT="$PUBLISH_ROOT" RELEASES_DIR="$PUBLISH_RELEASES" \
  CURRENT_LINK="$PUBLISH_CURRENT" PREVIOUS_LINK="$PUBLISH_PREVIOUS" \
  DATA_DIR="$PUBLISH_DATA" OPS_STATE_DIR="$PUBLISH_OPS" \
  DEPLOY_LOCK="$PUBLISH_OPS/locks/deploy.lock" \
  DEPLOY_LOG="$PUBLISH_OPS/deploy-log.jsonl" \
  FROZEN_MARKER="$PUBLISH_OPS/deploy-frozen.json" \
  MONEY_READY_MARKER="$PUBLISH_OPS/money-ready" \
  JOURNAL_FILE="$PUBLISH_JOURNAL" \
  HEALTH_BASE="http://127.0.0.1:$PUBLISH_PORT" GATE_TIMEOUT_SEC=2 \
  MOCK_SYSTEMCTL_LOG="$PUBLISH_SYSTEMCTL_LOG" \
  MOCK_ALERT_LOG="$PUBLISH_ALERT_LOG" \
  MOCK_RESTART_HOOK="$PUBLISH_HOOK" \
  DF32_DEPLOY_JOURNAL_PUBLISH_HOOK=1 \
  DF32_DEPLOY_JOURNAL_PUBLISH_HOOK_FILE="$PUBLISH_JOURNAL" \
  DF32_DEPLOY_JOURNAL_PUBLISH_HOOK_ONCE="$PUBLISH_HOOK_ONCE" \
  EXPOSURE_CMD="cat $PUBLISH_EXPOSURE" \
  bash "$DEPLOY" --release "$PUBLISH_CANDIDATE_SRC"
assert_link_target "$PUBLISH_CURRENT" \
  "$PUBLISH_RELEASES/rel-journal-publish-base" \
  "journal publication failure auto-rolls back to the prior release"
assert_eq "$(sha256_file "$PUBLISH_JOURNAL")" \
  "$PUBLISH_EXPECTED_JOURNAL_SHA" \
  "automatic rollback preserves the externally newer journal bytes"
assert_eq "$(json_get "$PUBLISH_JOURNAL" externalRevision)" outside-update \
  "automatic rollback preserves the external journal revision"
assert_grep 'journal publication failed before atomic replacement after the release switch' \
  "$PUBLISH_OPS/deploy-log.jsonl" \
  "journal publication failure records its post-switch cause"
assert_grep '"result":"AUTO_ROLLBACK"' "$PUBLISH_OPS/deploy-log.jsonl" \
  "journal publication failure records automatic rollback"
assert_no_path_entry "$PUBLISH_OPS/deploy-frozen.json" \
  "successful automatic rollback does not freeze deployment"
assert_no_path_entry "$PUBLISH_OPS/locks/deploy.lock" \
  "journal publication failure cleans the deploy lock"
assert_eq "$(
  find "$PUBLISH_DATA" -maxdepth 1 \
    -name '.journal-compat.json.write-*' -print \
    | wc -l | tr -d ' '
)" 0 "journal publication failure leaves no staging path"

note "11e. post-rename publication uncertainty freezes without auto-rollback"
POST_RENAME_ROOT="$SANDBOX/journal-post-rename/root"
POST_RENAME_RELEASES="$POST_RENAME_ROOT/releases"
POST_RENAME_CURRENT="$POST_RENAME_ROOT/current"
POST_RENAME_PREVIOUS="$POST_RENAME_ROOT/previous"
POST_RENAME_DATA="$SANDBOX/journal-post-rename/data"
POST_RENAME_OPS="$SANDBOX/journal-post-rename/ops"
POST_RENAME_JOURNAL="$POST_RENAME_DATA/journal-compat.json"
POST_RENAME_SYSTEMCTL_LOG="$SANDBOX/journal-post-rename/systemctl.log"
POST_RENAME_ALERT_LOG="$SANDBOX/journal-post-rename/alerts.log"
POST_RENAME_EXPOSURE="$SANDBOX/journal-post-rename/exposure"
POST_RENAME_BASE_SRC="$SRC/JOURNAL-POST-RENAME-BASE"
POST_RENAME_CANDIDATE_SRC="$SRC/JOURNAL-POST-RENAME-CANDIDATE"
POST_RENAME_BIN="$SANDBOX/journal-post-rename/bin"
POST_RENAME_DEPLOY="$POST_RENAME_BIN/deploy.sh"
POST_RENAME_PORT="$(pick_port)"
mkdir -p "$POST_RENAME_ROOT" "$POST_RENAME_BIN" \
  "$(dirname "$POST_RENAME_SYSTEMCTL_LOG")"
: > "$POST_RENAME_SYSTEMCTL_LOG"
: > "$POST_RENAME_ALERT_LOG"
printf '%s\n' NONE > "$POST_RENAME_EXPOSURE"
cp "$BIN/common.sh" "$BIN/deploy.sh" "$BIN/rollback.sh" "$POST_RENAME_BIN/"
chmod 0755 "$POST_RENAME_BIN/common.sh" \
  "$POST_RENAME_BIN/deploy.sh" "$POST_RENAME_BIN/rollback.sh"
"$NODE" - "$POST_RENAME_BIN/common.sh" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = '      published = true;\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(
  needle,
  `${needle}      throw new Error("injected post-rename durability failure");\n`,
));
NODE
bash "$MAKE_RELEASE" \
  "$POST_RENAME_BASE_SRC" rel-journal-post-rename-base 1 false
bash "$MAKE_RELEASE" \
  "$POST_RENAME_CANDIDATE_SRC" rel-journal-post-rename-candidate 2 true
start_fake_app "$POST_RENAME_PORT" \
  "$POST_RENAME_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 env \
  COSMOS_ROOT="$POST_RENAME_ROOT" RELEASES_DIR="$POST_RENAME_RELEASES" \
  CURRENT_LINK="$POST_RENAME_CURRENT" PREVIOUS_LINK="$POST_RENAME_PREVIOUS" \
  DATA_DIR="$POST_RENAME_DATA" OPS_STATE_DIR="$POST_RENAME_OPS" \
  DEPLOY_LOCK="$POST_RENAME_OPS/locks/deploy.lock" \
  DEPLOY_LOG="$POST_RENAME_OPS/deploy-log.jsonl" \
  FROZEN_MARKER="$POST_RENAME_OPS/deploy-frozen.json" \
  MONEY_READY_MARKER="$POST_RENAME_OPS/money-ready" \
  JOURNAL_FILE="$POST_RENAME_JOURNAL" \
  HEALTH_BASE="http://127.0.0.1:$POST_RENAME_PORT" GATE_TIMEOUT_SEC=2 \
  MOCK_SYSTEMCTL_LOG="$POST_RENAME_SYSTEMCTL_LOG" \
  MOCK_ALERT_LOG="$POST_RENAME_ALERT_LOG" \
  EXPOSURE_CMD="cat $POST_RENAME_EXPOSURE" \
  bash "$DEPLOY" --release "$POST_RENAME_BASE_SRC"
assert_rc 2 env \
  COSMOS_ROOT="$POST_RENAME_ROOT" RELEASES_DIR="$POST_RENAME_RELEASES" \
  CURRENT_LINK="$POST_RENAME_CURRENT" PREVIOUS_LINK="$POST_RENAME_PREVIOUS" \
  DATA_DIR="$POST_RENAME_DATA" OPS_STATE_DIR="$POST_RENAME_OPS" \
  DEPLOY_LOCK="$POST_RENAME_OPS/locks/deploy.lock" \
  DEPLOY_LOG="$POST_RENAME_OPS/deploy-log.jsonl" \
  FROZEN_MARKER="$POST_RENAME_OPS/deploy-frozen.json" \
  MONEY_READY_MARKER="$POST_RENAME_OPS/money-ready" \
  JOURNAL_FILE="$POST_RENAME_JOURNAL" \
  HEALTH_BASE="http://127.0.0.1:$POST_RENAME_PORT" GATE_TIMEOUT_SEC=2 \
  MOCK_SYSTEMCTL_LOG="$POST_RENAME_SYSTEMCTL_LOG" \
  MOCK_ALERT_LOG="$POST_RENAME_ALERT_LOG" \
  EXPOSURE_CMD="cat $POST_RENAME_EXPOSURE" \
  bash "$POST_RENAME_DEPLOY" --release "$POST_RENAME_CANDIDATE_SRC"
assert_link_target "$POST_RENAME_CURRENT" \
  "$POST_RENAME_RELEASES/rel-journal-post-rename-candidate" \
  "post-rename uncertainty leaves the candidate current"
assert_link_target "$POST_RENAME_PREVIOUS" \
  "$POST_RENAME_RELEASES/rel-journal-post-rename-base" \
  "post-rename uncertainty retains the prior release as previous"
assert_eq "$(json_get "$POST_RENAME_JOURNAL" dataSchema)" 2 \
  "post-rename uncertainty exposes the candidate schema publication"
assert_eq "$(json_get "$POST_RENAME_JOURNAL" rollbackFloor)" 2 \
  "post-rename uncertainty exposes the raised rollback floor"
assert_eq "$(journal_file_mode "$POST_RENAME_JOURNAL")" 644 \
  "post-rename uncertainty retains the published journal mode"
assert_grep 'atomic replacement completed but durability or final verification failed' \
  "$POST_RENAME_OPS/deploy-frozen.json" \
  "post-rename uncertainty records the exact freeze cause"
assert_grep '"result":"FROZEN"' "$POST_RENAME_OPS/deploy-log.jsonl" \
  "post-rename uncertainty records a frozen deploy"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$POST_RENAME_OPS/deploy-log.jsonl" \
  "post-rename uncertainty suppresses automatic rollback"
assert_grep 'critical DEPLOY_FROZEN' "$POST_RENAME_ALERT_LOG" \
  "post-rename uncertainty raises the critical alert"
assert_no_path_entry "$POST_RENAME_OPS/locks/deploy.lock" \
  "post-rename uncertainty cleans the deploy lock"
assert_eq "$(
  find "$POST_RENAME_DATA" -maxdepth 1 \
    -name '.journal-compat.json.write-*' -print \
    | wc -l | tr -d ' '
)" 0 "post-rename uncertainty leaves no staging path"

note "11e2. freeze evidence failures never suppress the critical alert or exit 2"
POST_RENAME_EVIDENCE_SRC="$SRC/JOURNAL-POST-RENAME-EVIDENCE"
bash "$MAKE_RELEASE" \
  "$POST_RENAME_EVIDENCE_SRC" rel-journal-post-rename-evidence 3 true
rm -f "$POST_RENAME_OPS/deploy-frozen.json"
mv "$POST_RENAME_OPS/deploy-log.jsonl" \
  "$POST_RENAME_OPS/deploy-log.before-evidence-failure.jsonl"
mkdir "$POST_RENAME_OPS/deploy-frozen.json" \
  "$POST_RENAME_OPS/deploy-log.jsonl"
POST_RENAME_ALERT_BYTES="$(wc -c < "$POST_RENAME_ALERT_LOG" | tr -d ' ')"
run_bounded_capture "$SANDBOX/journal-post-rename/evidence-failure.out" 30 \
  env \
    COSMOS_ROOT="$POST_RENAME_ROOT" RELEASES_DIR="$POST_RENAME_RELEASES" \
    CURRENT_LINK="$POST_RENAME_CURRENT" PREVIOUS_LINK="$POST_RENAME_PREVIOUS" \
    DATA_DIR="$POST_RENAME_DATA" OPS_STATE_DIR="$POST_RENAME_OPS" \
    DEPLOY_LOCK="$POST_RENAME_OPS/locks/deploy.lock" \
    DEPLOY_LOG="$POST_RENAME_OPS/deploy-log.jsonl" \
    FROZEN_MARKER="$POST_RENAME_OPS/deploy-frozen.json" \
    MONEY_READY_MARKER="$POST_RENAME_OPS/money-ready" \
    JOURNAL_FILE="$POST_RENAME_JOURNAL" \
    HEALTH_BASE="http://127.0.0.1:$POST_RENAME_PORT" GATE_TIMEOUT_SEC=2 \
    MOCK_SYSTEMCTL_LOG="$POST_RENAME_SYSTEMCTL_LOG" \
    MOCK_ALERT_LOG="$POST_RENAME_ALERT_LOG" \
    EXPOSURE_CMD="cat $POST_RENAME_EXPOSURE" \
    bash "$POST_RENAME_DEPLOY" --release "$POST_RENAME_EVIDENCE_SRC"
assert_eq "$BOUNDED_RC" 2 \
  "post-rename evidence failure retains the frozen exit code"
ASSERTIONS=$((ASSERTIONS + 1))
case "$BOUNDED_OUTPUT" in
  *"FROZEN MARKER WRITE FAILED"*) ;;
  *) fail "post-rename evidence failure omitted its marker-write cause: $BOUNDED_OUTPUT" ;;
esac
assert_link_target "$POST_RENAME_CURRENT" \
  "$POST_RENAME_RELEASES/rel-journal-post-rename-evidence" \
  "evidence failure never rolls back the uncertain publication"
assert_eq "$(json_get "$POST_RENAME_JOURNAL" rollbackFloor)" 3 \
  "evidence failure leaves the newly raised floor published"
ASSERTIONS=$((ASSERTIONS + 1))
[ "$(wc -c < "$POST_RENAME_ALERT_LOG" | tr -d ' ')" \
    -gt "$POST_RENAME_ALERT_BYTES" ] \
  || fail "post-rename evidence failure did not attempt the critical alert"
ASSERTIONS=$((ASSERTIONS + 1))
if ! "$NODE" - "$POST_RENAME_ALERT_LOG" \
    "$POST_RENAME_ALERT_BYTES" <<'NODE'
const fs = require('node:fs');
const [file, offsetRaw] = process.argv.slice(2);
if (!/^(?:0|[1-9][0-9]*)$/u.test(offsetRaw)) process.exit(1);
const offset = Number(offsetRaw);
const bytes = fs.readFileSync(file);
const expected = Buffer.from(
  'critical DEPLOY_FROZEN journal atomic replacement completed but durability '
  + 'or final verification failed; FROZEN MARKER WRITE FAILED (exposure=NONE)\n',
  'utf8',
);
if (!Number.isSafeInteger(offset) || offset > bytes.length
    || !bytes.subarray(offset).equals(expected)) process.exit(1);
NODE
then
  fail "post-rename evidence failure did not append exactly one critical alert"
fi
assert_no_path_entry "$POST_RENAME_OPS/locks/deploy.lock" \
  "post-rename evidence failure cleans the deploy lock"

assert_deploy_data_schema_case() { # raw-value required [rollback-floor]
  local raw_value="$1" required="$2" rollback_floor="${3:-0}" output rc
  printf '{"dataSchema":%s,"rollbackFloor":%s}\n' \
    "$raw_value" "$rollback_floor" > "$JOURNAL"
  set +e
  output="$(bash "$DEPLOY" --release "$FLOOR_SRC" 2>&1)"
  rc=$?
  set -e
  assert_eq "$rc" 1 "invalid journal dataSchema refuses"
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"$required"*) ;;
    *) fail "invalid journal dataSchema omitted [$required]: $output" ;;
  esac
  ASSERTIONS=$((ASSERTIONS + 1))
  case "$output" in
    *"release directory already exists"*)
      fail "invalid journal dataSchema reached release installation: $output"
      ;;
    *) ;;
  esac
  assert_link_target "$CURRENT_LINK" "$RELEASES_DIR/rel-H" \
    "invalid journal dataSchema leaves current unchanged"
  assert_link_target "$PREVIOUS_LINK" "$FLOOR_PREVIOUS_TARGET" \
    "invalid journal dataSchema leaves previous unchanged"
  assert_no_path_entry "$OPS_STATE_DIR/locks/deploy.lock" \
    "invalid journal dataSchema does not publish a lock"
}

for invalid_data_schema in null '"2"' -1 2.5 9007199254740992; do
  assert_deploy_data_schema_case "$invalid_data_schema" \
    "journal dataSchema is not a nonnegative integer"
done
assert_deploy_data_schema_case 3 \
  "journal rollbackFloor exceeds dataSchema" 7
printf '{"rollbackFloor":0}\n' > "$JOURNAL"
set +e
FLOOR_MISSING_DATA_SCHEMA_OUTPUT="$(
  bash "$DEPLOY" --release "$FLOOR_SRC" 2>&1
)"
FLOOR_MISSING_DATA_SCHEMA_RC=$?
set -e
assert_eq "$FLOOR_MISSING_DATA_SCHEMA_RC" 1 \
  "missing journal dataSchema keeps the documented zero default"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_MISSING_DATA_SCHEMA_OUTPUT" in
  *"release directory already exists"*) ;;
  *) fail "missing journal dataSchema did not reach the later dirty-target gate" ;;
esac
printf '{"rollbackFloor":1}\n' > "$JOURNAL"
set +e
FLOOR_MISSING_SCHEMA_RELATION_OUTPUT="$(
  bash "$DEPLOY" --release "$FLOOR_SRC" 2>&1
)"
FLOOR_MISSING_SCHEMA_RELATION_RC=$?
set -e
assert_eq "$FLOOR_MISSING_SCHEMA_RELATION_RC" 1 \
  "missing journal dataSchema with a positive floor refuses"
ASSERTIONS=$((ASSERTIONS + 1))
case "$FLOOR_MISSING_SCHEMA_RELATION_OUTPUT" in
  *"journal rollbackFloor exceeds dataSchema"*) ;;
  *) fail "missing dataSchema relation omitted its exact refusal" ;;
esac

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

note "18. previous-pointer failure after current switch freezes with literal exit 2"
FAULT_ROOT="$SANDBOX/post-switch-previous/root"
FAULT_RELEASES="$FAULT_ROOT/releases"
FAULT_CURRENT="$FAULT_ROOT/current"
FAULT_PREVIOUS="$FAULT_ROOT/previous"
FAULT_DATA="$SANDBOX/post-switch-previous/data"
FAULT_OPS="$SANDBOX/post-switch-previous/ops"
FAULT_SYSTEMCTL_LOG="$SANDBOX/post-switch-previous/systemctl.log"
FAULT_ALERT_LOG="$SANDBOX/post-switch-previous/alerts.log"
FAULT_EXPOSURE="$SANDBOX/post-switch-previous/exposure"
FAULT_BIN="$SANDBOX/post-switch-previous/bin"
FAULT_DEPLOY="$FAULT_BIN/deploy.sh"
FAULT_BASE_SRC="$SRC/POST-SWITCH-PREVIOUS-BASE"
FAULT_CANDIDATE_SRC="$SRC/POST-SWITCH-PREVIOUS-CANDIDATE"
FAULT_PORT="$(pick_port)"
FAULT_PROBE_PORT="$(pick_port)"
mkdir -p "$FAULT_ROOT" "$FAULT_BIN" "$(dirname "$FAULT_SYSTEMCTL_LOG")"
: > "$FAULT_SYSTEMCTL_LOG"
: > "$FAULT_ALERT_LOG"
printf '%s\n' NONE > "$FAULT_EXPOSURE"
cp "$BIN/common.sh" "$BIN/deploy.sh" "$BIN/rollback.sh" "$FAULT_BIN/"
chmod 0755 "$FAULT_BIN/common.sh" "$FAULT_BIN/deploy.sh" "$FAULT_BIN/rollback.sh"
"$NODE" - "$FAULT_DEPLOY" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = '    atomic_symlink "$OLD_TARGET" "$PREVIOUS_EFFECT_LINK"\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(needle, '    false\n'));
NODE
bash "$MAKE_RELEASE" "$FAULT_BASE_SRC" rel-post-switch-previous-base 1 false
bash "$MAKE_RELEASE" \
  "$FAULT_CANDIDATE_SRC" rel-post-switch-previous-candidate 1 false
start_fake_app "$FAULT_PORT" "$FAULT_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_BASE_SRC"
FAULT_JOURNAL_SHA="$(sha256_file "$FAULT_DATA/journal-compat.json")"
assert_rc 2 run_post_switch_fault_deploy "$FAULT_DEPLOY" "$FAULT_CANDIDATE_SRC"
assert_link_target "$FAULT_CURRENT" \
  "$FAULT_RELEASES/rel-post-switch-previous-candidate" \
  "previous-pointer failure preserves the switched candidate"
assert_no_path_entry "$FAULT_PREVIOUS" \
  "previous-pointer failure does not invent a rollback target"
assert_eq "$(sha256_file "$FAULT_DATA/journal-compat.json")" \
  "$FAULT_JOURNAL_SHA" \
  "previous-pointer failure occurs before journal publication"
assert_file "$FAULT_OPS/deploy-frozen.json"
assert_grep 'previous release pointer update failed after the current switch' \
  "$FAULT_OPS/deploy-frozen.json" \
  "previous-pointer failure records its exact freeze cause"
assert_grep 'critical DEPLOY_FROZEN' "$FAULT_ALERT_LOG" \
  "previous-pointer failure raises the critical alert"
assert_grep '"result":"FROZEN"' "$FAULT_OPS/deploy-log.jsonl" \
  "previous-pointer failure records a frozen deploy"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FAULT_OPS/deploy-log.jsonl" \
  "previous-pointer failure never trusts the stale rollback pointer"
assert_no_path_entry "$FAULT_OPS/locks/deploy.lock" \
  "previous-pointer failure cleans the deploy lock"

note "19. stale frozen-marker removal failure after publication freezes without rollback"
FAULT_ROOT="$SANDBOX/post-publication-marker/root"
FAULT_RELEASES="$FAULT_ROOT/releases"
FAULT_CURRENT="$FAULT_ROOT/current"
FAULT_PREVIOUS="$FAULT_ROOT/previous"
FAULT_DATA="$SANDBOX/post-publication-marker/data"
FAULT_OPS="$SANDBOX/post-publication-marker/ops"
FAULT_SYSTEMCTL_LOG="$SANDBOX/post-publication-marker/systemctl.log"
FAULT_ALERT_LOG="$SANDBOX/post-publication-marker/alerts.log"
FAULT_EXPOSURE="$SANDBOX/post-publication-marker/exposure"
FAULT_BASE_SRC="$SRC/POST-PUBLICATION-MARKER-BASE"
FAULT_CANDIDATE_SRC="$SRC/POST-PUBLICATION-MARKER-CANDIDATE"
FAULT_PORT="$(pick_port)"
FAULT_PROBE_PORT="$(pick_port)"
mkdir -p "$FAULT_ROOT" "$(dirname "$FAULT_SYSTEMCTL_LOG")"
: > "$FAULT_SYSTEMCTL_LOG"
: > "$FAULT_ALERT_LOG"
printf '%s\n' NONE > "$FAULT_EXPOSURE"
bash "$MAKE_RELEASE" "$FAULT_BASE_SRC" rel-post-publication-marker-base 1 false
bash "$MAKE_RELEASE" \
  "$FAULT_CANDIDATE_SRC" rel-post-publication-marker-candidate 2 false
start_fake_app "$FAULT_PORT" "$FAULT_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_BASE_SRC"
mkdir "$FAULT_OPS/deploy-frozen.json"
assert_rc 2 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_CANDIDATE_SRC"
assert_link_target "$FAULT_CURRENT" \
  "$FAULT_RELEASES/rel-post-publication-marker-candidate" \
  "marker-removal failure preserves the published candidate"
assert_link_target "$FAULT_PREVIOUS" \
  "$FAULT_RELEASES/rel-post-publication-marker-base" \
  "marker-removal failure retains the prior release as previous"
assert_eq "$(json_get "$FAULT_DATA/journal-compat.json" dataSchema)" 2 \
  "marker-removal failure occurs after journal publication"
assert_eq "$(json_get "$FAULT_DATA/journal-compat.json" rollbackFloor)" 0 \
  "marker-removal failure preserves the published rollback floor"
assert_dir "$FAULT_OPS/deploy-frozen.json"
assert_grep 'stale deploy-frozen marker removal failed after journal publication; FROZEN MARKER WRITE FAILED' \
  "$FAULT_OPS/deploy-log.jsonl" \
  "marker-removal and marker-write failures preserve their exact taxonomy"
assert_grep 'critical DEPLOY_FROZEN' "$FAULT_ALERT_LOG" \
  "marker-removal failure still raises the critical alert"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FAULT_OPS/deploy-log.jsonl" \
  "marker-removal failure never rolls back published state"
assert_no_path_entry "$FAULT_OPS/locks/deploy.lock" \
  "marker-removal failure cleans the deploy lock"

note "20. SUCCESS audit failure after publication freezes and records FROZEN independently"
FAULT_ROOT="$SANDBOX/post-publication-audit/root"
FAULT_RELEASES="$FAULT_ROOT/releases"
FAULT_CURRENT="$FAULT_ROOT/current"
FAULT_PREVIOUS="$FAULT_ROOT/previous"
FAULT_DATA="$SANDBOX/post-publication-audit/data"
FAULT_OPS="$SANDBOX/post-publication-audit/ops"
FAULT_SYSTEMCTL_LOG="$SANDBOX/post-publication-audit/systemctl.log"
FAULT_ALERT_LOG="$SANDBOX/post-publication-audit/alerts.log"
FAULT_EXPOSURE="$SANDBOX/post-publication-audit/exposure"
FAULT_BIN="$SANDBOX/post-publication-audit/bin"
FAULT_DEPLOY="$FAULT_BIN/deploy.sh"
FAULT_BASE_SRC="$SRC/POST-PUBLICATION-AUDIT-BASE"
FAULT_CANDIDATE_SRC="$SRC/POST-PUBLICATION-AUDIT-CANDIDATE"
FAULT_PORT="$(pick_port)"
FAULT_PROBE_PORT="$(pick_port)"
mkdir -p "$FAULT_ROOT" "$FAULT_BIN" "$(dirname "$FAULT_SYSTEMCTL_LOG")"
: > "$FAULT_SYSTEMCTL_LOG"
: > "$FAULT_ALERT_LOG"
printf '%s\n' NONE > "$FAULT_EXPOSURE"
cp "$BIN/common.sh" "$BIN/deploy.sh" "$BIN/rollback.sh" "$FAULT_BIN/"
chmod 0755 "$FAULT_BIN/common.sh" "$FAULT_BIN/deploy.sh" "$FAULT_BIN/rollback.sh"
"$NODE" - "$FAULT_DEPLOY" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = '  log_event SUCCESS \\\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(needle, '  false \\\n'));
NODE
bash "$MAKE_RELEASE" "$FAULT_BASE_SRC" rel-post-publication-audit-base 1 false
bash "$MAKE_RELEASE" \
  "$FAULT_CANDIDATE_SRC" rel-post-publication-audit-candidate 2 false
start_fake_app "$FAULT_PORT" "$FAULT_CURRENT/runtime-behavior.env" >/dev/null
assert_rc 0 run_post_switch_fault_deploy "$DEPLOY" "$FAULT_BASE_SRC"
assert_rc 2 run_post_switch_fault_deploy "$FAULT_DEPLOY" "$FAULT_CANDIDATE_SRC"
assert_link_target "$FAULT_CURRENT" \
  "$FAULT_RELEASES/rel-post-publication-audit-candidate" \
  "SUCCESS-audit failure preserves the published candidate"
assert_link_target "$FAULT_PREVIOUS" \
  "$FAULT_RELEASES/rel-post-publication-audit-base" \
  "SUCCESS-audit failure retains the prior release as previous"
assert_eq "$(json_get "$FAULT_DATA/journal-compat.json" dataSchema)" 2 \
  "SUCCESS-audit failure occurs after journal publication"
assert_file "$FAULT_OPS/deploy-frozen.json"
assert_grep 'SUCCESS audit publication failed after journal publication' \
  "$FAULT_OPS/deploy-frozen.json" \
  "SUCCESS-audit failure records its exact freeze cause"
assert_grep 'critical DEPLOY_FROZEN' "$FAULT_ALERT_LOG" \
  "SUCCESS-audit failure raises the critical alert"
assert_grep '"result":"FROZEN"' "$FAULT_OPS/deploy-log.jsonl" \
  "SUCCESS-audit failure still records FROZEN independently"
assert_not_grep '"result":"AUTO_ROLLBACK"' "$FAULT_OPS/deploy-log.jsonl" \
  "SUCCESS-audit failure never rolls back published state"
assert_no_path_entry "$FAULT_OPS/locks/deploy.lock" \
  "SUCCESS-audit failure cleans the deploy lock"

terminal_deploy_run() { # DEPLOY_SCRIPT RELEASE_SOURCE [ENV=VALUE...]
  local deploy_script="$1" release_source="$2"
  shift 2
  env \
    COSMOS_ROOT="$TERMINAL_ROOT" RELEASES_DIR="$TERMINAL_RELEASES" \
    CURRENT_LINK="$TERMINAL_CURRENT" PREVIOUS_LINK="$TERMINAL_PREVIOUS" \
    DATA_DIR="$TERMINAL_DATA" OPS_STATE_DIR="$TERMINAL_OPS" \
    DEPLOY_LOCK="$TERMINAL_OPS/locks/deploy.lock" \
    DEPLOY_LOG="$TERMINAL_OPS/deploy-log.jsonl" \
    FROZEN_MARKER="$TERMINAL_OPS/deploy-frozen.json" \
    MONEY_READY_MARKER="$TERMINAL_OPS/money-ready" \
    HEALTH_BASE="http://127.0.0.1:$TERMINAL_PORT" GATE_TIMEOUT_SEC=2 \
    MOCK_SYSTEMCTL_LOG="$TERMINAL_SYSTEMCTL_LOG" \
    MOCK_ALERT_LOG="$TERMINAL_ALERT_LOG" \
    EXPOSURE_CMD="cat $TERMINAL_EXPOSURE" \
    PROBE_PORT="$TERMINAL_PROBE_PORT" \
    "$@" \
    bash "$deploy_script" --release "$release_source"
}

prepare_terminal_deploy_case() { # CASE
  local case_name="$1"
  TERMINAL_DIR="$SANDBOX/terminal-deploy-$case_name"
  TERMINAL_ROOT="$TERMINAL_DIR/root"
  TERMINAL_RELEASES="$TERMINAL_ROOT/releases"
  TERMINAL_CURRENT="$TERMINAL_ROOT/current"
  TERMINAL_PREVIOUS="$TERMINAL_ROOT/previous"
  TERMINAL_DATA="$TERMINAL_DIR/data"
  TERMINAL_OPS="$TERMINAL_DIR/ops"
  TERMINAL_SYSTEMCTL_LOG="$TERMINAL_DIR/systemctl.log"
  TERMINAL_ALERT_LOG="$TERMINAL_DIR/alerts.log"
  TERMINAL_EXPOSURE="$TERMINAL_DIR/exposure"
  TERMINAL_BIN="$TERMINAL_DIR/bin"
  TERMINAL_DEPLOY="$TERMINAL_BIN/deploy.sh"
  TERMINAL_COMMON="$TERMINAL_BIN/common.sh"
  TERMINAL_BASE_ID="rel-terminal-$case_name-base"
  TERMINAL_CANDIDATE_ID="rel-terminal-$case_name-candidate"
  TERMINAL_BASE_SRC="$SRC/TERMINAL-$case_name-BASE"
  TERMINAL_CANDIDATE_SRC="$SRC/TERMINAL-$case_name-CANDIDATE"
  TERMINAL_OTHER_TARGET="$TERMINAL_DIR/other-current-target"
  TERMINAL_PORT="$(pick_port)"
  TERMINAL_PROBE_PORT="$(pick_port)"
  mkdir -p "$TERMINAL_ROOT" "$TERMINAL_BIN" "$TERMINAL_OTHER_TARGET"
  : > "$TERMINAL_SYSTEMCTL_LOG"
  : > "$TERMINAL_ALERT_LOG"
  printf '%s\n' NONE > "$TERMINAL_EXPOSURE"
  bash "$MAKE_RELEASE" "$TERMINAL_BASE_SRC" "$TERMINAL_BASE_ID" 1 false
  bash "$MAKE_RELEASE" \
    "$TERMINAL_CANDIDATE_SRC" "$TERMINAL_CANDIDATE_ID" 1 false
  start_fake_app "$TERMINAL_PORT" \
    "$TERMINAL_CURRENT/runtime-behavior.env" >/dev/null
  assert_rc 0 terminal_deploy_run "$DEPLOY" "$TERMINAL_BASE_SRC"
  cp "$BIN/common.sh" "$BIN/deploy.sh" "$BIN/rollback.sh" "$TERMINAL_BIN/"
  chmod 0755 "$TERMINAL_COMMON" "$TERMINAL_DEPLOY" \
    "$TERMINAL_BIN/rollback.sh"
}

inject_deploy_switch_termination() { # DEPLOY_SCRIPT attempted-term|confirmed-term|confirmed-exit-zero
  "$NODE" - "$1" "$2" <<'NODE' \
    || fail "could not inject deploy switch termination fixture"
const fs = require('node:fs');
const [file, mode] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const attempted = [
  'CURRENT_SWITCH_ATTEMPTED=1',
  'if atomic_symlink "$RELEASE_DIR" "$CURRENT_EFFECT_LINK"; then',
].join('\n');
const confirmed = [
  'if atomic_symlink "$RELEASE_DIR" "$CURRENT_EFFECT_LINK"; then',
  '  POST_SWITCH_ACTIVE=1',
  '  CURRENT_SWITCH_ATTEMPTED=0',
].join('\n');
let needle;
let replacement;
if (mode === 'attempted-term') {
  needle = attempted;
  replacement = attempted.replace(
    '\n',
    '\nkill -TERM "$$"\n',
  );
} else if (mode === 'confirmed-term' || mode === 'confirmed-exit-zero') {
  needle = confirmed;
  const action = mode === 'confirmed-term' ? '  kill -TERM "$$"' : '  exit 0';
  replacement = `${confirmed}\n${action}`;
} else {
  process.exit(1);
}
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(needle, replacement));
NODE
}

inject_atomic_symlink_nonzero_classifier() { # COMMON_SCRIPT
  "$NODE" - "$1" <<'NODE' \
    || fail "could not inject atomic-symlink nonzero classifier"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'atomic_symlink() {\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
const injection = [
  '  if [ "${DF32_ATOMIC_SYMLINK_CASE:-}" != "" ] \\',
  '      && [ "$2" = "$CURRENT_LINK" ]; then',
  '    case "$DF32_ATOMIC_SYMLINK_CASE" in',
  '      preimage) return 91 ;;',
  '      candidate) test_atomic_target="$1" ;;',
  '      other) test_atomic_target="${DF32_ATOMIC_OTHER_TARGET:?}" ;;',
  '      *) return 92 ;;',
  '    esac',
  '    i00_guard_node - "$test_atomic_target" "$2" "$$" <<\'ATOMIC_NODE\'',
  'const fs = require("node:fs");',
  'const [target, link, pid] = process.argv.slice(2);',
  'const temporary = `${link}.test-atomic-${pid}`;',
  'try { fs.rmSync(temporary, { force: true }); } catch {}',
  'fs.symlinkSync(target, temporary);',
  'fs.renameSync(temporary, link);',
  'ATOMIC_NODE',
  '    return 91',
  '  fi',
].join('\n') + '\n';
fs.writeFileSync(file, source.replace(needle, needle + injection));
NODE
}

inject_deploy_alert_exit() { # COMMON_SCRIPT
  "$NODE" - "$1" <<'NODE' \
    || fail "could not inject deploy alert-exit containment fixture"
const fs = require('node:fs');
const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const needle = 'alert() {\n';
if (source.split(needle).length - 1 !== 1) process.exit(1);
fs.writeFileSync(file, source.replace(
  needle,
  needle
    + '  : > "${DF32_ALERT_EXIT_WITNESS:?}"\n'
    + '  exit 91\n',
));
NODE
}

note "21. TERM during an attempted or confirmed current switch is bounded and freezes rc2"
prepare_terminal_deploy_case attempted-term
inject_deploy_switch_termination "$TERMINAL_DEPLOY" attempted-term
run_bounded_capture "$TERMINAL_DIR/result.out" 30 \
  terminal_deploy_run "$TERMINAL_DEPLOY" "$TERMINAL_CANDIDATE_SRC"
assert_eq "$BOUNDED_RC" 2 \
  "TERM during the deploy switch attempt maps to terminal rc2"
assert_link_target "$TERMINAL_CURRENT" \
  "$TERMINAL_RELEASES/$TERMINAL_BASE_ID" \
  "attempted-switch TERM leaves the exact preimage current"
assert_no_path_entry "$TERMINAL_PREVIOUS" \
  "attempted-switch TERM leaves the first-host previous pointer absent"
assert_file "$TERMINAL_OPS/deploy-frozen.json"
assert_eq "$(json_get "$TERMINAL_OPS/deploy-frozen.json" releaseId)" \
  "$TERMINAL_CANDIDATE_ID" \
  "attempted-switch TERM freezes the exact candidate release"
assert_grep 'publication is uncertain after an interrupted atomic switch' \
  "$TERMINAL_OPS/deploy-frozen.json" \
  "attempted-switch TERM records publication uncertainty"
assert_no_path_entry "$TERMINAL_OPS/locks/deploy.lock" \
  "attempted-switch TERM cleans the deploy lock"

prepare_terminal_deploy_case confirmed-term
inject_deploy_switch_termination "$TERMINAL_DEPLOY" confirmed-term
run_bounded_capture "$TERMINAL_DIR/result.out" 30 \
  terminal_deploy_run "$TERMINAL_DEPLOY" "$TERMINAL_CANDIDATE_SRC"
assert_eq "$BOUNDED_RC" 2 \
  "TERM after confirmed deploy publication maps to terminal rc2"
assert_link_target "$TERMINAL_CURRENT" \
  "$TERMINAL_RELEASES/$TERMINAL_CANDIDATE_ID" \
  "confirmed-switch TERM preserves the published candidate"
assert_no_path_entry "$TERMINAL_PREVIOUS" \
  "confirmed-switch TERM occurs before the previous pointer update"
assert_file "$TERMINAL_OPS/deploy-frozen.json"
assert_eq "$(json_get "$TERMINAL_OPS/deploy-frozen.json" releaseId)" \
  "$TERMINAL_CANDIDATE_ID" \
  "confirmed-switch TERM freezes the exact candidate release"
assert_grep 'unexpected failure after the current release switch' \
  "$TERMINAL_OPS/deploy-frozen.json" \
  "confirmed-switch TERM records the terminal freeze"
assert_no_path_entry "$TERMINAL_OPS/locks/deploy.lock" \
  "confirmed-switch TERM cleans the deploy lock"

note "22. a direct exit 0 after confirmed current publication cannot report success"
prepare_terminal_deploy_case confirmed-exit-zero
inject_deploy_switch_termination "$TERMINAL_DEPLOY" confirmed-exit-zero
run_bounded_capture "$TERMINAL_DIR/result.out" 30 \
  terminal_deploy_run "$TERMINAL_DEPLOY" "$TERMINAL_CANDIDATE_SRC"
assert_eq "$BOUNDED_RC" 2 \
  "direct exit 0 after confirmed deploy publication maps to terminal rc2"
assert_link_target "$TERMINAL_CURRENT" \
  "$TERMINAL_RELEASES/$TERMINAL_CANDIDATE_ID" \
  "direct exit 0 preserves the published candidate"
assert_no_path_entry "$TERMINAL_PREVIOUS" \
  "direct exit 0 occurs before the previous pointer update"
assert_file "$TERMINAL_OPS/deploy-frozen.json"
assert_grep 'unexpected failure after the current release switch' \
  "$TERMINAL_OPS/deploy-frozen.json" \
  "direct exit 0 records the terminal freeze"
assert_not_grep \
  "\"releaseId\":\"$TERMINAL_CANDIDATE_ID\",\"result\":\"SUCCESS\"" \
  "$TERMINAL_OPS/deploy-log.jsonl" \
  "direct exit 0 cannot publish candidate success"
assert_no_path_entry "$TERMINAL_OPS/locks/deploy.lock" \
  "direct exit 0 cleans the deploy lock"

note "23. atomic-symlink nonzero results are classified from exact pointer state"
prepare_terminal_deploy_case atomic-preimage
inject_atomic_symlink_nonzero_classifier "$TERMINAL_COMMON"
run_bounded_capture "$TERMINAL_DIR/result.out" 30 \
  terminal_deploy_run "$TERMINAL_DEPLOY" "$TERMINAL_CANDIDATE_SRC" \
    DF32_ATOMIC_SYMLINK_CASE=preimage
assert_eq "$BOUNDED_RC" 1 \
  "atomic-symlink nonzero with the exact preimage remains pre-switch rc1"
assert_link_target "$TERMINAL_CURRENT" \
  "$TERMINAL_RELEASES/$TERMINAL_BASE_ID" \
  "preimage classification leaves current unchanged"
assert_no_path_entry "$TERMINAL_OPS/deploy-frozen.json" \
  "preimage classification does not invent a freeze"
assert_grep 'current release pointer update failed before the switch' \
  "$TERMINAL_DIR/result.out" \
  "preimage classification reports the pre-switch refusal"

prepare_terminal_deploy_case atomic-candidate
inject_atomic_symlink_nonzero_classifier "$TERMINAL_COMMON"
inject_deploy_alert_exit "$TERMINAL_COMMON"
TERMINAL_ALERT_EXIT_WITNESS="$TERMINAL_DIR/alert-exit-called"
TERMINAL_ALERT_BYTES="$(wc -c < "$TERMINAL_ALERT_LOG" | tr -d ' ')"
run_bounded_capture "$TERMINAL_DIR/result.out" 30 \
  terminal_deploy_run "$TERMINAL_DEPLOY" "$TERMINAL_CANDIDATE_SRC" \
    DF32_ATOMIC_SYMLINK_CASE=candidate \
    DF32_ALERT_EXIT_WITNESS="$TERMINAL_ALERT_EXIT_WITNESS"
assert_eq "$BOUNDED_RC" 2 \
  "atomic-symlink nonzero after exact candidate publication freezes rc2"
assert_link_target "$TERMINAL_CURRENT" \
  "$TERMINAL_RELEASES/$TERMINAL_CANDIDATE_ID" \
  "candidate classification preserves the published candidate"
assert_file "$TERMINAL_OPS/deploy-frozen.json"
assert_grep 'reported failure after publication' \
  "$TERMINAL_OPS/deploy-frozen.json" \
  "candidate classification records known publication"
assert_file "$TERMINAL_ALERT_EXIT_WITNESS"
assert_grep '"result":"FROZEN"' "$TERMINAL_OPS/deploy-log.jsonl" \
  "explicit alert exit is contained before the frozen audit"
assert_grep 'deployment FROZEN' "$TERMINAL_DIR/result.out" \
  "explicit alert exit is contained before the terminal diagnostic"
assert_eq "$(wc -c < "$TERMINAL_ALERT_LOG" | tr -d ' ')" \
  "$TERMINAL_ALERT_BYTES" \
  "explicit alert exit cannot append a false successful alert"

prepare_terminal_deploy_case atomic-other
inject_atomic_symlink_nonzero_classifier "$TERMINAL_COMMON"
run_bounded_capture "$TERMINAL_DIR/result.out" 30 \
  terminal_deploy_run "$TERMINAL_DEPLOY" "$TERMINAL_CANDIDATE_SRC" \
    DF32_ATOMIC_SYMLINK_CASE=other \
    DF32_ATOMIC_OTHER_TARGET="$TERMINAL_OTHER_TARGET"
assert_eq "$BOUNDED_RC" 2 \
  "atomic-symlink nonzero with a third pointer state freezes rc2"
assert_link_target "$TERMINAL_CURRENT" "$TERMINAL_OTHER_TARGET" \
  "third-state classification preserves the observed pointer"
assert_file "$TERMINAL_OPS/deploy-frozen.json"
assert_grep 'publication is uncertain' "$TERMINAL_OPS/deploy-frozen.json" \
  "third-state classification records publication uncertainty"
assert_no_path_entry "$TERMINAL_OPS/locks/deploy.lock" \
  "third-state classification cleans the deploy lock"

finish
