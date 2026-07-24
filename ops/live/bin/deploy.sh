#!/bin/bash -p
# ops/live/bin/deploy.sh — install a release and switch `current` atomically.
#
# Implements the §24.2 deployment shape as a testable artifact:
#   - immutable release directories under $RELEASES_DIR;
#   - readiness gate BEFORE the switch (candidate booted on a probe port);
#   - atomic `current` symlink switch (rename(2), never rm+ln);
#   - journal/schema compatibility recorded in $DATA_DIR/journal-compat.json;
#   - automatic rollback ONLY before money readiness and only when the
#     exposure state is literally NONE; anything else (ACTIVE, AMBIGUOUS,
#     RECOVERY_REQUIRED, UNKNOWN, or no exposure source) FREEZES deployment
#     and preserves state for incident handling.
#
# This script performs no AWS/Cloudflare/remote action. systemd interaction
# goes through $SYSTEMCTL, which tests replace with a mock.
#
# Usage:
#   deploy.sh --release <dir> [--env-file <file>] [--reinstall] [--skip-probe]
#
# Exit codes:
#   0  deployed and healthy
#   1  refused/failed before the switch (current release untouched)
#   2  FROZEN after the switch — operator incident handling required
#   3  post-switch failure, automatically rolled back to the previous release
#   4  deploy lock busy
set -euo pipefail

unset BASH_ENV ENV CDPATH GLOBIGNORE
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
readonly PATH
case "$0" in
  /*) _I00_ENTRY_DIR="${0%/*}" ;;
  */*) _I00_ENTRY_DIR="$PWD/${0%/*}" ;;
  *) printf '%s\n' 'FATAL: deploy.sh requires an explicit script path' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf '%s\n' 'FATAL: deploy.sh script directory is unavailable' >&2; exit 1; }
unset _I00_ENTRY_DIR
# shellcheck source=common.sh
if [ "${_I00_AUTHORIZED_COMMON_READY:-0}" != 1 ]; then
  . "$SCRIPT_DIR/common.sh"
fi
type require_i00_effect_class >/dev/null 2>&1 \
  || { printf '%s\n' 'FATAL: deploy.sh common bootstrap is unavailable' >&2; exit 1; }
OPS_LOG_TAG=cosmos-deploy

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

RELEASE_SRC="" ENV_FILE="" ENV_DESCRIPTOR="" REINSTALL=0 SKIP_PROBE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_SRC="${2:?--release needs a value}"; shift 2 ;;
    --env-file)
      [ -z "$ENV_FILE" ] && [ -z "$ENV_DESCRIPTOR" ] \
        || die_code 1 "named and descriptor environments are exclusive and single-use"
      ENV_FILE="${2:?--env-file needs a value}"
      shift 2
      ;;
    --i00-effect-environment-fd)
      [ -z "$ENV_FILE" ] && [ -z "$ENV_DESCRIPTOR" ] \
        || die_code 1 "named and descriptor environments are exclusive and single-use"
      [ "${2:-}" = 12 ] || die_code 1 "effect environment descriptor must be 12"
      ENV_DESCRIPTOR=12
      ENV_FILE=/proc/self/fd/12
      shift 2
      ;;
    --reinstall) REINSTALL=1; shift ;;
    --skip-probe) SKIP_PROBE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done
[ -n "$RELEASE_SRC" ] || die_code 1 "--release is required (see --help)"

if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_i00_effect_class SERVICE_RELEASE_SWITCH
fi
require_i00_effect_env_file_binding "$ENV_FILE"
load_env_file "$ENV_FILE"
cosmos_layout_defaults
COSMOS_ROOT="$(exact_raw_canonical_path "$COSMOS_ROOT")" \
  || die_code 1 "COSMOS_ROOT must be one exact raw canonical absolute path"
RELEASES_DIR="$(exact_raw_canonical_path "$RELEASES_DIR")" \
  || die_code 1 "RELEASES_DIR must be one exact raw canonical absolute path"
CURRENT_LINK="$(exact_raw_canonical_pointer_path "$CURRENT_LINK")" \
  || die_code 1 "CURRENT_LINK must be one exact raw canonical pointer path"
PREVIOUS_LINK="$(exact_raw_canonical_pointer_path "$PREVIOUS_LINK")" \
  || die_code 1 "PREVIOUS_LINK must be one exact raw canonical pointer path"
DATA_DIR="$(exact_raw_canonical_path "$DATA_DIR")" \
  || die_code 1 "DATA_DIR must be one exact raw canonical absolute path"
OPS_STATE_DIR="$(exact_raw_canonical_path "$OPS_STATE_DIR")" \
  || die_code 1 "OPS_STATE_DIR must be one exact raw canonical absolute path"
DEPLOY_LOCK="$(exact_raw_canonical_path "$DEPLOY_LOCK")" \
  || die_code 1 "DEPLOY_LOCK must be one exact raw canonical absolute path"
DEPLOY_LOG="$(exact_raw_canonical_path "$DEPLOY_LOG")" \
  || die_code 1 "DEPLOY_LOG must be one exact raw canonical absolute path"
FROZEN_MARKER="$(exact_raw_canonical_path "$FROZEN_MARKER")" \
  || die_code 1 "FROZEN_MARKER must be one exact raw canonical absolute path"
MONEY_READY_MARKER="$(exact_raw_canonical_path "$MONEY_READY_MARKER")" \
  || die_code 1 "MONEY_READY_MARKER must be one exact raw canonical absolute path"
JOURNAL_FILE="$(exact_raw_canonical_path "$JOURNAL_FILE")" \
  || die_code 1 "JOURNAL_FILE must be one exact raw canonical absolute path"
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_all_authorized_write_root_bindings
  require_authorized_write_root_binding cosmosRoot "$COSMOS_ROOT"
  require_authorized_write_root_binding releasesDir "$RELEASES_DIR"
  require_authorized_write_root_binding currentLinkParent "$(path_dirname "$CURRENT_LINK")"
  require_authorized_write_root_binding previousLinkParent "$(path_dirname "$PREVIOUS_LINK")"
  require_authorized_write_root_binding opsStateDir "$OPS_STATE_DIR"
  require_authorized_write_root_binding dataDir "$DATA_DIR"
fi
RELEASES_EFFECT_DIR="$(authorized_write_effect_path releasesDir "$RELEASES_DIR")"
CURRENT_EFFECT_LINK="$(authorized_write_effect_path \
  currentLinkParent "$CURRENT_LINK")"
PREVIOUS_EFFECT_LINK="$(authorized_write_effect_path \
  previousLinkParent "$PREVIOUS_LINK")"
DEPLOY_EFFECT_LOCK="$(authorized_write_effect_path opsStateDir "$DEPLOY_LOCK")"
DEPLOY_EFFECT_LOG="$(authorized_write_effect_path opsStateDir "$DEPLOY_LOG")"
FROZEN_EFFECT_MARKER="$(authorized_write_effect_path \
  opsStateDir "$FROZEN_MARKER")"
MONEY_READY_EFFECT_MARKER="$(authorized_write_effect_path \
  opsStateDir "$MONEY_READY_MARKER")"
JOURNAL_EFFECT_FILE="$(authorized_write_effect_path dataDir "$JOURNAL_FILE")"

# The inherited class is the authorization-bound wrapper dispatch. Never
# accept a different class merely because a staging layout is configured.
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
    || any_path_effectively_intersects_protected_union \
      "$COSMOS_ROOT" "$RELEASES_DIR" \
      "$DATA_DIR" "$OPS_STATE_DIR" "$DEPLOY_LOCK" "$DEPLOY_LOG" \
      "$FROZEN_MARKER" "$MONEY_READY_MARKER" "$JOURNAL_FILE" \
      "${TMPDIR:-/tmp}/cosmos-probe" \
    || pointer_path_effectively_intersects_protected_union "$CURRENT_LINK" \
    || pointer_path_effectively_intersects_protected_union "$PREVIOUS_LINK"; then
  require_i00_effect_class SERVICE_RELEASE_SWITCH
fi
require_nonroot_direct_effect_or_i00_class
require_i00_effect_node_binding

# F-107: two deployment paths exist with materially different safety
# properties. Only the I00 wrapper (ops/i00/bin/release-switch.sh), which
# sanitizes and force-locks the donor env, is authorized against the
# production root; it sets the marker below. Direct deploy.sh use stays
# available for staging roots.
if path_effectively_within "$COSMOS_ROOT" /opt/cosmos \
    && [ "${COSMOS_DEPLOY_VIA_I00_WRAPPER:-}" != 1 ]; then
  die_code 1 "direct deploy.sh against the production root /opt/cosmos is refused: use ops/i00/bin/release-switch.sh (the authorized production path)"
fi

if [ "${I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES+x}" = x ]; then
  die_code 1 "I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES is forbidden for deployment"
fi
if [ "${I00_PUBLIC_SOURCE_STARTUP_EGRESS+x}" = x ] \
    && [ "$I00_PUBLIC_SOURCE_STARTUP_EGRESS" != 1 ]; then
  die_code 1 "I00_PUBLIC_SOURCE_STARTUP_EGRESS must be absent or exactly 1"
fi

require_staging_supervisor_mock_or_i00_class
require_staging_app_unit_or_i00_class
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_trusted_effect_executable "$SYSTEMCTL" SYSTEMCTL
fi

: "${READINESS_GATE_PATHS:=/health/live /health/ready}"
: "${POST_SWITCH_GATE_PATHS:=$READINESS_GATE_PATHS}"
: "${GATE_TIMEOUT_SEC:=60}"
: "${PROBE_ENABLED:=1}"
: "${PROBE_PORT:=8091}"
: "${PROBE_BASE:=http://127.0.0.1:$PROBE_PORT}"
: "${PROBE_CMD:=}"

require_cmd "$NODE" "$CURL" "$SYSTEMCTL"
configure_i00_bash

RELEASE_ID="unknown"
log_event() { # RESULT DETAIL
  jsonl_append "$DEPLOY_EFFECT_LOG" "ts=$(now_utc)" "tool=deploy" \
    "releaseId=$RELEASE_ID" "result=$1" "detail=$2"
}

# --- 1. validate the release source (before taking the lock: read-only) ------
RELEASE_SRC="$(exact_existing_directory_path "$RELEASE_SRC")" \
  || die_code 1 "release source must be one exact raw canonical non-symlink directory"
require_authorized_release_source_binding "$RELEASE_SRC"
RELEASE_READ_SRC="$(authorized_release_source_effect_path "$RELEASE_SRC")"
[ -f "$RELEASE_READ_SRC/release.json" ] \
  || die_code 1 "release.json missing in $RELEASE_SRC"
RELEASE_ID="$(json_get "$RELEASE_READ_SRC/release.json" releaseId)" \
  || die_code 1 "release.json: releaseId missing"
SCHEMA_VERSION="$(json_get "$RELEASE_READ_SRC/release.json" schemaVersion)" \
  || die_code 1 "release.json: schemaVersion missing"
BARRIER="$(json_get "$RELEASE_READ_SRC/release.json" rollbackBarrier || echo false)"
case "$RELEASE_ID" in
  ""|"."|".."|*[!A-Za-z0-9._-]*) die_code 1 "releaseId must be one non-dot [A-Za-z0-9._-] name: '$RELEASE_ID'" ;;
esac
case "$SCHEMA_VERSION" in
  ""|*[!0-9]*) die_code 1 "schemaVersion must be a non-negative integer: '$SCHEMA_VERSION'" ;;
esac
case "$BARRIER" in
  true|false) : ;;
  *) die_code 1 "rollbackBarrier must be true or false: '$BARRIER'" ;;
esac
[ -f "$RELEASE_READ_SRC/server/dist/index.js" ] \
  || die_code 1 "release payload incomplete: server/dist/index.js missing (partial build?)"

# --- 2. lock -----------------------------------------------------------------
acquire_lock "$DEPLOY_EFFECT_LOCK" \
  || die_code 4 "deploy lock busy: $DEPLOY_LOCK (another deploy/rollback in progress)"
LOCK_HELD=1
PROBE_PID=""
PROBE_DATA_TMP=""
PROBE_LEASES_TMP=""
STAGING=""
cleanup() {
  # If the deploy is interrupted mid-probe, the candidate process and its
  # throwaway data dir must not outlive us.
  if [ -n "${PROBE_PID:-}" ]; then kill "$PROBE_PID" 2>/dev/null || true; fi
  if [ -n "${PROBE_DATA_TMP:-}" ]; then fs_remove_tree "$PROBE_DATA_TMP"; fi
  if [ -n "${PROBE_LEASES_TMP:-}" ]; then fs_remove_tree "$PROBE_LEASES_TMP"; fi
  if [ -n "${STAGING:-}" ]; then fs_remove_tree "$STAGING"; fi
  if [ "${LOCK_HELD:-0}" = 1 ]; then release_lock "$DEPLOY_EFFECT_LOCK"; fi
}
trap cleanup EXIT

# FIRST-HOST-001: the I00 wrapper may request an additional under-lock proof
# that this is still a clean first host. The marker is refusal-only: it cannot
# bypass any existing donor check, and every set value other than exact `1`
# fails closed. Test both existence and link identity so dangling symlinks are
# treated as occupied paths too.
if [ "${I00_REQUIRE_FIRST_HOST_NO_CURRENT+x}" = x ]; then
  [ "$I00_REQUIRE_FIRST_HOST_NO_CURRENT" = 1 ] \
    || die_code 1 "I00_REQUIRE_FIRST_HOST_NO_CURRENT must be absent or exactly 1"
  if [ -e "$CURRENT_EFFECT_LINK" ] || [ -L "$CURRENT_EFFECT_LINK" ]; then
    die_code 1 "first-host deploy refused under lock: current path is not absent: $CURRENT_LINK"
  fi
  if [ -e "$PREVIOUS_EFFECT_LINK" ] || [ -L "$PREVIOUS_EFFECT_LINK" ]; then
    die_code 1 "first-host deploy refused under lock: previous path is not absent: $PREVIOUS_LINK"
  fi
fi

# --- 3. host sanity + journal/schema floor, before any mutation --------------
assert_link_sane "$CURRENT_EFFECT_LINK"
assert_link_sane "$PREVIOUS_EFFECT_LINK"

ROLLBACK_FLOOR=0
if [ -f "$JOURNAL_EFFECT_FILE" ]; then
  # Part 4 #6: a corrupt journal must never default a SAFETY BARRIER to its
  # most permissive value. Key absent (rc 3) legitimately means floor 0; an
  # unreadable journal (any other failure) refuses the deploy.
  set +e; FLOOR_VALUE="$(json_get "$JOURNAL_EFFECT_FILE" rollbackFloor)"; FLOOR_RC=$?; set -e
  case "$FLOOR_RC" in
    0) ROLLBACK_FLOOR="$FLOOR_VALUE" ;;
    3) ROLLBACK_FLOOR=0 ;;
    *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to assume a zero rollback floor" ;;
  esac
fi
if [ "$SCHEMA_VERSION" -lt "$ROLLBACK_FLOOR" ]; then
  log_event REFUSED_SCHEMA "candidate schema $SCHEMA_VERSION is behind the non-rollback barrier $ROLLBACK_FLOOR"
  die_code 1 "candidate schemaVersion $SCHEMA_VERSION is behind the non-rollback barrier (rollbackFloor=$ROLLBACK_FLOOR); this release can no longer read the journal"
fi

# --- 4. install into an immutable release directory --------------------------
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
RELEASE_DIR="$(require_exact_direct_child \
  "$RELEASES_DIR/$RELEASE_ID" "$RELEASES_DIR" "$RELEASE_ID")" \
  || die_code 1 "release target is outside the canonical release root"
RELEASE_EFFECT_DIR="$(authorized_write_effect_path releasesDir "$RELEASE_DIR")"
if [ -e "$RELEASE_EFFECT_DIR" ] || [ -L "$RELEASE_EFFECT_DIR" ]; then
  if [ "$REINSTALL" = 1 ]; then
    ops_log "reinstall: replacing existing $RELEASE_EFFECT_DIR"
    fs_adjust_tree_write_bits "$RELEASE_EFFECT_DIR" owner-write
    fs_remove_tree "$RELEASE_EFFECT_DIR"
  else
    die_code 1 "release directory already exists (dirty target): $RELEASE_EFFECT_DIR — pass --reinstall to replace it"
  fi
fi
fs_mkdir_p "$RELEASES_EFFECT_DIR"
# We hold the exclusive deploy lock, so any leftover staging dir is debris
# from a crashed deploy on a dirty host — clear it.
fs_remove_release_staging "$RELEASES_EFFECT_DIR"
STAGING_NAMED="$RELEASES_DIR/.staging-$RELEASE_ID-$$"
STAGING="$(authorized_write_effect_path releasesDir "$STAGING_NAMED")"
require_authorized_release_source_binding "$RELEASE_SRC"
copy_authorized_release_source "$RELEASE_SRC" "$STAGING" "$STAGING_NAMED"
fs_rename "$STAGING" "$RELEASE_EFFECT_DIR"
STAGING=""
fs_adjust_tree_write_bits "$RELEASE_EFFECT_DIR" remove-write
require_authorized_release_source_binding "$RELEASE_SRC"
require_authorized_release_destination_tree "$RELEASE_DIR"
ops_log "installed immutable release $RELEASE_ID at $RELEASE_DIR"

# --- 5. readiness gate BEFORE the switch --------------------------------------
# The candidate is booted on a probe port against a throwaway data dir; the
# production state store is never handed to an unproven build. PROBE_CMD (if
# set) must `exec` its server so the recorded pid is the server itself.
run_probe_as_app_identity() { # MODE PROBE_DATA PROBE_LEASES PROBE_COMMAND
  local probe_mode="$1" probe_data="$2" probe_leases="$3" probe_command="$4"
  # The fixed wrapper binds the application unit to User=cosmos, Group=cosmos
  # immediately around this effect. The donor does not accept caller-selected
  # identity values. A root invocation starts only this sealed launcher as
  # root; it drops permanently before importing or spawning candidate bytes.
  exec "$I00_ENV" -i \
    PATH="${_I00_GUARD_NODE%/*}:/usr/local/bin:/usr/bin:/bin" \
    HOME=/nonexistent TMPDIR="${TMPDIR:-/tmp}" \
    PORT="$PROBE_PORT" HOST=127.0.0.1 \
    DATA_DIR="$probe_data" PROBE_DATA_DIR="$probe_data" \
    DATA_DIR_LOGICAL_LEASE_ROOT="$probe_leases" \
    RELEASE_DIR="$RELEASE_DIR" PROBE_PORT="$PROBE_PORT" \
    SKIP_DOTENV=1 NODE_ENV=production \
    I00_PUBLIC_SOURCE_STARTUP_EGRESS=1 \
    "$NODE" --input-type=module - \
      "$probe_mode" "$RELEASE_DIR" "$probe_data" "$probe_leases" \
      "$NODE" "$I00_BASH" "$probe_command" <<'NODE'
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [
  mode, releaseDir, dataDir, leasesDir, nodePath, bashPath, command,
] = process.argv.slice(2);
const APP_USER = 'cosmos';
const APP_GROUP = 'cosmos';
const fail = (message) => {
  process.stderr.write(`FATAL: candidate identity launcher refused: ${message}\n`);
  process.exit(1);
};
if (!['default', 'command'].includes(mode)
    || !path.isAbsolute(releaseDir)
    || !path.isAbsolute(dataDir)
    || !path.isAbsolute(leasesDir)
    || !path.isAbsolute(nodePath)
    || !path.isAbsolute(bashPath)
    || (mode === 'command' && command.length === 0)
    || (mode === 'default' && command.length !== 0)) {
  fail('launcher inputs are not exact');
}
let spawnNodePath = nodePath;
if (nodePath === '/proc/self/fd/16') {
  if (fs.realpathSync.native('/proc/self/exe') !== fs.realpathSync.native(nodePath)) {
    fail('current Node executable differs from its retained capability');
  }
  spawnNodePath = '/proc/self/exe';
}
const exactDirectory = (target) => {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || fs.realpathSync.native(target) !== target) {
    fail('probe directory identity is invalid');
  }
  return stat;
};
let expectedUid = process.getuid();
let expectedGid = process.getgid();
if (expectedUid === 0) {
  const resolver = spawnSync(spawnNodePath, ['-e', [
    'process.setgroups([]);',
    `process.setgid(${JSON.stringify(APP_GROUP)});`,
    `process.setuid(${JSON.stringify(APP_USER)});`,
    'process.stdout.write(`${process.getuid()}:${process.getgid()}`);',
  ].join('')], {
    encoding: 'utf8',
    env: {
      HOME: '/nonexistent',
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (resolver.error || resolver.signal || resolver.status !== 0
      || !/^[1-9][0-9]*:[1-9][0-9]*$/u.test(resolver.stdout)) {
    fail('bound application identity cannot be resolved');
  }
  [expectedUid, expectedGid] = resolver.stdout.split(':').map(Number);
  for (const target of [dataDir, leasesDir]) {
    const before = exactDirectory(target);
    if (before.uid !== 0) fail('root-created probe directory owner changed');
    fs.chownSync(target, expectedUid, expectedGid);
    fs.chmodSync(target, 0o700);
  }
  process.setgroups([]);
  process.setgid(APP_GROUP);
  process.setuid(APP_USER);
} else {
  for (const target of [dataDir, leasesDir]) {
    const before = exactDirectory(target);
    if (before.uid !== expectedUid) fail('probe directory owner changed');
    fs.chmodSync(target, 0o700);
  }
}
if (process.getuid() !== expectedUid || process.getgid() !== expectedGid
    || process.getuid() === 0 || process.getgid() === 0) {
  fail('effective uid/gid does not match the bound application identity');
}
for (const target of [dataDir, leasesDir]) {
  const after = exactDirectory(target);
  if (after.uid !== expectedUid || after.gid !== expectedGid
      || (after.mode & 0o777) !== 0o700) {
    fail('probe directory does not belong to the bound application identity');
  }
}

process.chdir(releaseDir);
if (mode === 'default') {
  const entrypoint = path.join(releaseDir, 'server/dist/index.js');
  process.argv = [spawnNodePath, entrypoint];
  await import(pathToFileURL(entrypoint).href);
} else {
  const commandStdio = ['inherit', 'inherit', 'inherit'];
  if (bashPath === '/proc/self/fd/17') {
    for (let descriptor = 3; descriptor <= 17; descriptor += 1) {
      commandStdio[descriptor] = 'ignore';
    }
    commandStdio[17] = 17;
  }
  const child = spawn(bashPath, ['-p', '-c', command], {
    cwd: releaseDir,
    env: process.env,
    stdio: commandStdio,
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      try {
        child.kill(signal);
      } catch {
        // The child may already have completed.
      }
    });
  }
  const result = await new Promise((resolve) => {
    child.once('error', () => resolve({ code: 1, signal: null }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  process.exit(result.code ?? 1);
}
NODE
}

run_probe_gate() {
  if [ "$PROBE_ENABLED" != 1 ]; then
    ops_log "probe gate disabled by configuration (PROBE_ENABLED=$PROBE_ENABLED)"
    return 0
  fi
  if [ "$SKIP_PROBE" = 1 ]; then
    # F-108: on a first deploy no previous release exists, so auto-rollback
    # cannot undo a bad candidate - skipping the only remaining gate would
    # make the failure unrecoverable. Refuse the flag when there is nothing
    # to fall back to.
    [ -L "$CURRENT_EFFECT_LINK" ] \
      || die_code 1 "--skip-probe is refused on a first deploy: no previous release exists to roll back to"
    ops_log "probe gate SKIPPED by --skip-probe (emergency use only; recorded)"
    log_event PROBE_SKIPPED "operator passed --skip-probe"
    return 0
  fi
  local probe_data probe_leases probe_pid ok=0
  probe_data="$(fs_mkdtemp "${TMPDIR:-/tmp}/cosmos-probe.")"
  probe_data="$(canonical_path "$probe_data")" \
    || die_code 1 "probe data directory cannot be canonicalized"
  PROBE_DATA_TMP="$probe_data"
  # F-023: the lease namespace must be a SIBLING of the data dir - either
  # nesting direction throws DATA_DIR_LOGICAL_LEASE_NAMESPACE_INVALID.
  probe_leases="$probe_data.leases"
  fs_mkdir_p "$probe_leases"
  probe_leases="$(canonical_path "$probe_leases")" \
    || die_code 1 "probe lease directory cannot be canonicalized"
  PROBE_LEASES_TMP="$probe_leases"
  if [ -n "$PROBE_CMD" ]; then
    run_probe_as_app_identity command "$probe_data" "$probe_leases" "$PROBE_CMD" &
  else
    # F-023: the gate exists to prove the candidate boots in PRODUCTION
    # configuration. env -i closes the environment (no ambient variable can
    # leak in), and NODE_ENV=production plus the lease root make the probe
    # exercise the same code path production takes.
    run_probe_as_app_identity default "$probe_data" "$probe_leases" "" &
  fi
  probe_pid=$!
  PROBE_PID="$probe_pid"
  if gate_wait "$PROBE_BASE" "$READINESS_GATE_PATHS" "$GATE_TIMEOUT_SEC" "$probe_pid"; then
    ok=1
  else
    # F-108(b): capture each gate path's body while the candidate is still
    # up - the readiness reasonCodes array is the difference between a
    # five-minute and a five-hour diagnosis.
    local diag_path diagnostic
    for diag_path in $READINESS_GATE_PATHS; do
      diagnostic=""
      IFS= read -r -n 2000 diagnostic \
        < <("$CURL" -sS -m "$HTTP_TIMEOUT_SEC" "${PROBE_BASE}${diag_path}" 2>&1 || true) \
        || true
      ops_log "probe diagnostic ${PROBE_BASE}${diag_path}: $diagnostic"
    done
  fi
  kill "$probe_pid" 2>/dev/null || true
  wait "$probe_pid" 2>/dev/null || true
  PROBE_PID=""
  fs_remove_tree "$probe_data"
  PROBE_DATA_TMP=""
  fs_remove_tree "$probe_leases"
  PROBE_LEASES_TMP=""
  if [ "$ok" != 1 ]; then
    log_event REJECTED_BY_PROBE "readiness gate failed before switch; current release untouched"
    die_code 1 "readiness probe failed for $RELEASE_ID; aborted before switch — running release untouched"
  fi
  ops_log "probe gate passed for $RELEASE_ID"
}
run_probe_gate

# --- 6. atomic switch ----------------------------------------------------------
require_authorized_release_source_binding "$RELEASE_SRC"
require_authorized_release_destination_tree "$RELEASE_DIR"
OLD_TARGET=""
if [ -L "$CURRENT_EFFECT_LINK" ]; then
  OLD_TARGET="$(read_symlink "$CURRENT_EFFECT_LINK")"
fi
atomic_symlink "$RELEASE_DIR" "$CURRENT_EFFECT_LINK"
if [ -n "$OLD_TARGET" ]; then
  atomic_symlink "$OLD_TARGET" "$PREVIOUS_EFFECT_LINK"
fi
require_all_authorized_write_root_bindings
ops_log "current -> $RELEASE_DIR (previous -> ${OLD_TARGET:-none})"

# --- 7. restart + post-switch gate, with §24.2 failure policy -----------------
post_switch_failure() {
  local reason="$1" exposure
  exposure="$(get_exposure)"
  if [ ! -e "$MONEY_READY_EFFECT_MARKER" ] && [ "$exposure" = "NONE" ] && [ -n "$OLD_TARGET" ]; then
    local rollback_ok=0
    log_event AUTO_ROLLBACK "$reason; exposure=NONE; money readiness not reached"
    set -- --auto
    [ -n "$ENV_FILE" ] && set -- "$@" --env-file "$ENV_FILE"
    if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
      if run_authorized_automatic_rollback; then
        rollback_ok=1
      fi
    else
      # A caller-supplied DEPLOY_LOCK_HELD marker is never trusted by the
      # staging rollback donor. Relinquish this staging lock and let rollback
      # acquire its own exact owner-bound lock.
      if release_lock "$DEPLOY_EFFECT_LOCK"; then
        LOCK_HELD=0
        if "$I00_BASH" -p "$SCRIPT_DIR/rollback.sh" "$@"; then
          rollback_ok=1
        fi
      fi
    fi
    if [ "$rollback_ok" = 1 ]; then
      die_code 3 "deploy of $RELEASE_ID failed ($reason); automatically rolled back to previous release"
    fi
    reason="$reason; AUTOMATIC ROLLBACK ALSO FAILED"
  fi
  json_write "$FROZEN_EFFECT_MARKER" "ts=$(now_utc)" "releaseId=$RELEASE_ID" \
    "exposure=$exposure" "reason=$reason" "operatorAction=required"
  alert critical DEPLOY_FROZEN "$reason (exposure=$exposure)"
  log_event FROZEN "$reason; exposure=$exposure"
  die_code 2 "deployment FROZEN: $reason (exposure=$exposure); no automatic rollback; halt new entries and begin incident handling"
}

if ! "$SYSTEMCTL" restart "$APP_UNIT"; then
  post_switch_failure "systemctl restart $APP_UNIT failed"
fi
if ! gate_wait "$HEALTH_BASE" "$POST_SWITCH_GATE_PATHS" "$GATE_TIMEOUT_SEC"; then
  post_switch_failure "post-switch health gate failed"
fi
if ! authorized_release_source_binding_is_exact "$RELEASE_SRC" \
    || ! authorized_release_destination_tree_is_exact "$RELEASE_DIR"; then
  post_switch_failure "authorized release source/destination binding changed after switch"
fi

# --- 8. success: record journal compatibility ---------------------------------
DATA_SCHEMA=0
if [ -f "$JOURNAL_EFFECT_FILE" ]; then
  # Part 4 #6: an unreadable journal must not be rewritten from defaults.
  set +e; SCHEMA_VALUE="$(json_get "$JOURNAL_EFFECT_FILE" dataSchema)"; SCHEMA_RC=$?; set -e
  case "$SCHEMA_RC" in
    0) DATA_SCHEMA="$SCHEMA_VALUE" ;;
    3) DATA_SCHEMA=0 ;;
    *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to rewrite it from defaults after the switch" ;;
  esac
fi
NEW_SCHEMA="$DATA_SCHEMA"
[ "$SCHEMA_VERSION" -gt "$NEW_SCHEMA" ] && NEW_SCHEMA="$SCHEMA_VERSION"
NEW_FLOOR="$ROLLBACK_FLOOR"
if [ "$BARRIER" = "true" ] && [ "$SCHEMA_VERSION" -gt "$NEW_FLOOR" ]; then
  NEW_FLOOR="$SCHEMA_VERSION"
fi
json_write "$JOURNAL_EFFECT_FILE" "dataSchema=$NEW_SCHEMA" "rollbackFloor=$NEW_FLOOR" \
  "updatedAtUtc=$(now_utc)" "updatedBy=deploy.sh"

if [ -e "$FROZEN_EFFECT_MARKER" ]; then
  ops_log "clearing stale deploy-frozen marker after healthy deploy"
  fs_remove_file "$FROZEN_EFFECT_MARKER"
fi
require_all_authorized_write_root_bindings
log_event SUCCESS "healthy on $POST_SWITCH_GATE_PATHS; dataSchema=$NEW_SCHEMA rollbackFloor=$NEW_FLOOR"
ops_log "deploy of $RELEASE_ID complete"
exit 0
