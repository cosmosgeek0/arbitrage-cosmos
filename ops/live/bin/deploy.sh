#!/bin/bash -p
# ops/live/bin/deploy.sh — install a release and switch `current` atomically.
#
# Implements the §24.2 deployment shape as a testable artifact:
#   - immutable release directories under $RELEASES_DIR;
#   - readiness gate BEFORE the switch (candidate booted on a probe port);
#   - atomic `current` symlink switch (rename(2), never rm+ln);
#   - a floor-raising rollback barrier recorded durably before `current` can
#     expose the candidate to production startup;
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

POST_SWITCH_ACTIVE=0
POST_SWITCH_HANDLING=0
ROLLBACK_BARRIER_ARMED=0
DEPLOY_FAILURE_REASON=""

post_switch_progress() {
  ( ops_log "$@" ) || :
}

record_deploy_frozen_evidence() { # REASON EXPOSURE
  local reason="$1" exposure="$2"
  DEPLOY_FAILURE_REASON="$reason"
  if ! ( json_write "$FROZEN_EFFECT_MARKER" \
      "ts=$(now_utc)" "releaseId=$RELEASE_ID" \
      "exposure=$exposure" "reason=$reason" "operatorAction=required" ); then
    reason="$reason; FROZEN MARKER WRITE FAILED"
    post_switch_progress \
      "could not publish the deploy-frozen marker; continuing the critical alert path"
  fi
  ( alert critical DEPLOY_FROZEN "$reason (exposure=$exposure)" ) || :
  if ! ( log_event FROZEN "$reason; exposure=$exposure" ); then
    post_switch_progress "could not append FROZEN audit event"
  fi
  DEPLOY_FAILURE_REASON="$reason"
  return 0
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
set +e
SCHEMA_VERSION="$(json_get_nonnegative_safe_integer \
  "$RELEASE_READ_SRC/release.json" schemaVersion)"
SCHEMA_VERSION_RC=$?
set -e
case "$SCHEMA_VERSION_RC" in
  0) : ;;
  3|4) die_code 1 "release.json: schemaVersion missing" ;;
  5) die_code 1 "schemaVersion must be a non-negative integer within the exact comparison range: '$SCHEMA_VERSION'" ;;
  *) die_code 1 "release.json: schemaVersion validation failed" ;;
esac
set +e
CANDIDATE_ROLLBACK_FLOOR="$(json_get_nonnegative_safe_integer \
  "$RELEASE_READ_SRC/release.json" rollbackFloor)"
CANDIDATE_ROLLBACK_FLOOR_RC=$?
set -e
case "$CANDIDATE_ROLLBACK_FLOOR_RC" in
  0) : ;;
  3|4) die_code 1 "release.json: rollbackFloor missing" ;;
  5) die_code 1 "rollbackFloor must be a non-negative integer within the exact comparison range: '$CANDIDATE_ROLLBACK_FLOOR'" ;;
  *) die_code 1 "release.json: rollbackFloor validation failed" ;;
esac
BARRIER="$(json_get "$RELEASE_READ_SRC/release.json" rollbackBarrier)" \
  || die_code 1 "release.json: rollbackBarrier missing"
case "$RELEASE_ID" in
  ""|"."|".."|*[!A-Za-z0-9._-]*) die_code 1 "releaseId must be one non-dot [A-Za-z0-9._-] name: '$RELEASE_ID'" ;;
esac
case "$BARRIER" in
  true|false) : ;;
  *) die_code 1 "rollbackBarrier must be true or false: '$BARRIER'" ;;
esac
if [ "$CANDIDATE_ROLLBACK_FLOOR" -gt "$SCHEMA_VERSION" ] \
    || { [ "$CANDIDATE_ROLLBACK_FLOOR" -ne 0 ] \
      && [ "$CANDIDATE_ROLLBACK_FLOOR" -ne "$SCHEMA_VERSION" ]; }; then
  die_code 1 "release rollbackFloor is not representable by its schemaVersion"
fi
if { [ "$BARRIER" = true ] && [ "$CANDIDATE_ROLLBACK_FLOOR" -eq 0 ]; } \
    || { [ "$BARRIER" = false ] && [ "$CANDIDATE_ROLLBACK_FLOOR" -ne 0 ]; }; then
  die_code 1 "release rollbackBarrier does not match its rollbackFloor"
fi
[ -f "$RELEASE_READ_SRC/server/dist/index.js" ] \
  || die_code 1 "release payload incomplete: server/dist/index.js missing (partial build?)"

# Refuse a corrupt or occupied safety-state endpoint before lock publication.
# The state is read again under the lock below; this pass is ordering proof
# only, but it intentionally validates both safety-bearing integer fields.
set +e
JOURNAL_PREFLIGHT_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
JOURNAL_PREFLIGHT_RC=$?
set -e
case "$JOURNAL_PREFLIGHT_RC" in
  0) : ;;
  5) die_code 1 "journal document or rollbackFloor is invalid" ;;
  6) die_code 1 "journal path is occupied by a non-regular or linked endpoint, or exceeds the size limit: $JOURNAL_FILE" ;;
  7) die_code 1 "journal dataSchema is not a nonnegative integer" ;;
  8) die_code 1 "journal rollbackFloor exceeds dataSchema" ;;
  *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to assume a zero rollback floor" ;;
esac
unset JOURNAL_PREFLIGHT_SNAPSHOT

# --- 2. lock -----------------------------------------------------------------
acquire_lock "$DEPLOY_EFFECT_LOCK" \
  || die_code 4 "deploy lock busy: $DEPLOY_LOCK (another deploy/rollback in progress)"
LOCK_HELD=1
PROBE_PID=""
PROBE_DATA_TMP=""
PROBE_LEASES_TMP=""
STAGING=""
CURRENT_SWITCH_ATTEMPTED=0
DEPLOY_COMPLETED=0
cleanup() {
  local rc=$? reason exposure=UNKNOWN
  trap - EXIT HUP INT TERM
  if [ "${CURRENT_SWITCH_ATTEMPTED:-0}" = 1 ] \
      && [ "${POST_SWITCH_ACTIVE:-0}" != 1 ]; then
    reason="current release pointer publication is uncertain after an interrupted atomic switch"
    if ! exposure="$(get_exposure)"; then
      exposure=UNKNOWN
    fi
    ( record_deploy_frozen_evidence "$reason" "$exposure" ) || :
    ( ops_log "FATAL: deployment FROZEN: $reason (exposure=$exposure); operator incident handling required" ) \
      || :
    rc=2
  elif [ "${ROLLBACK_BARRIER_ARMED:-0}" = 1 ] \
      && [ "${POST_SWITCH_ACTIVE:-0}" != 1 ] \
      && [ "${DEPLOY_COMPLETED:-0}" != 1 ] \
      && [ "$rc" -ne 2 ]; then
    reason="unexpected failure after the rollback barrier was armed but before the current release switch (rc=$rc)"
    if ! exposure="$(get_exposure)"; then
      exposure=UNKNOWN
    fi
    ( record_deploy_frozen_evidence "$reason" "$exposure" ) || :
    ( ops_log "FATAL: deployment FROZEN: $reason (exposure=$exposure); operator incident handling required" ) \
      || :
    rc=2
  elif [ "${POST_SWITCH_ACTIVE:-0}" = 1 ] \
      && [ "${DEPLOY_COMPLETED:-0}" != 1 ] \
      && [ "$rc" -ne 2 ] && [ "$rc" -ne 3 ]; then
    reason="unexpected failure after the current release switch (rc=$rc)"
    if ! exposure="$(get_exposure)"; then
      exposure=UNKNOWN
    fi
    ( record_deploy_frozen_evidence "$reason" "$exposure" ) || :
    ( ops_log "FATAL: deployment FROZEN: $reason (exposure=$exposure); operator incident handling required" ) \
      || :
    rc=2
  fi
  # If the deploy is interrupted mid-probe, the candidate process and its
  # throwaway data dir must not outlive us.
  if [ -n "${PROBE_PID:-}" ]; then
    ( kill "$PROBE_PID" 2>/dev/null ) || :
  fi
  if [ -n "${PROBE_DATA_TMP:-}" ]; then
    ( fs_remove_tree "$PROBE_DATA_TMP" ) || :
  fi
  if [ -n "${PROBE_LEASES_TMP:-}" ]; then
    ( fs_remove_tree "$PROBE_LEASES_TMP" ) || :
  fi
  if [ -n "${STAGING:-}" ]; then
    ( fs_remove_tree "$STAGING" ) || :
  fi
  if [ "${LOCK_HELD:-0}" = 1 ]; then
    ( release_lock "$DEPLOY_EFFECT_LOCK" ) || :
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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

# Part 4 #6: bind both safety-bearing fields and the exact endpoint version
# from one under-lock read. Missing fields and true absence default to zero;
# every occupied non-regular, unreadable, or invalid endpoint refuses.
set +e
JOURNAL_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
JOURNAL_SNAPSHOT_RC=$?
set -e
case "$JOURNAL_SNAPSHOT_RC" in
  0) : ;;
  5) die_code 1 "journal document or rollbackFloor is invalid - refusing to evaluate the non-rollback barrier against an uncomparable value" ;;
  6) die_code 1 "journal path is occupied by a non-regular or linked endpoint, or exceeds the size limit: $JOURNAL_FILE" ;;
  7) die_code 1 "journal dataSchema is not a nonnegative integer - refusing to derive post-switch compatibility state" ;;
  8) die_code 1 "journal rollbackFloor exceeds dataSchema - refusing to derive post-switch compatibility state" ;;
  *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to assume a zero rollback floor" ;;
esac
JOURNAL_SNAPSHOT_REST="${JOURNAL_SNAPSHOT#*|}"
DATA_SCHEMA="${JOURNAL_SNAPSHOT_REST%%|*}"
JOURNAL_SNAPSHOT_REST="${JOURNAL_SNAPSHOT_REST#*|}"
ROLLBACK_FLOOR="${JOURNAL_SNAPSHOT_REST%%|*}"
unset JOURNAL_SNAPSHOT_REST
INITIAL_BARRIER_ARMED=0
case "$JOURNAL_SNAPSHOT" in
  PENDING\|*) INITIAL_BARRIER_ARMED=1 ;;
esac
ROLLBACK_BARRIER_ARMED="$INITIAL_BARRIER_ARMED"
if [ "$INITIAL_BARRIER_ARMED" = 1 ] \
    && [ "$CANDIDATE_ROLLBACK_FLOOR" -lt "$ROLLBACK_FLOOR" ]; then
  die_code 1 \
    "pending rollback barrier requires a fix-forward candidate whose rollbackFloor preserves the armed floor"
fi

set +e
[ "$SCHEMA_VERSION" -lt "$ROLLBACK_FLOOR" ]
BARRIER_COMPARISON_RC=$?
set -e
case "$BARRIER_COMPARISON_RC" in
  0)
    log_event REFUSED_SCHEMA "candidate schema $SCHEMA_VERSION is behind the non-rollback barrier $ROLLBACK_FLOOR"
    die_code 1 "candidate schemaVersion $SCHEMA_VERSION is behind the non-rollback barrier (rollbackFloor=$ROLLBACK_FLOOR); this release can no longer read the journal"
    ;;
  1) : ;;
  *) die_code 1 "release schemaVersion and journal rollbackFloor are not safely comparable - refusing to evaluate the non-rollback barrier" ;;
esac

# Compute the compatibility publication from the one under-lock snapshot
# before any release switch. A newly raised floor first commits as an exact
# PENDING state with the still-applied dataSchema, then finalizes dataSchema
# only after the candidate is healthy.
NEW_SCHEMA="$DATA_SCHEMA"
[ "$SCHEMA_VERSION" -gt "$NEW_SCHEMA" ] && NEW_SCHEMA="$SCHEMA_VERSION"
NEW_FLOOR="$ROLLBACK_FLOOR"
if [ "$CANDIDATE_ROLLBACK_FLOOR" -gt "$NEW_FLOOR" ]; then
  NEW_FLOOR="$CANDIDATE_ROLLBACK_FLOOR"
fi
PRESTART_BARRIER_REQUIRED=0
if [ "$NEW_FLOOR" -gt "$ROLLBACK_FLOOR" ]; then
  PRESTART_BARRIER_REQUIRED=1
fi

# --- 4. install into an immutable release directory --------------------------
installed_release_matches_source() {
  if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
    authorized_release_source_binding_is_exact "$RELEASE_SRC" \
      && authorized_release_destination_tree_is_exact "$RELEASE_DIR"
    return
  fi
  i00_guard_node - "$RELEASE_READ_SRC" "$RELEASE_EFFECT_DIR" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const roots = process.argv.slice(2);
const snapshot = (root) => {
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
      || fs.realpathSync.native(root) !== root) process.exit(1);
  const entries = [];
  const visit = (relative) => {
    const directory = relative === '' ? root : path.join(root, relative);
    for (const name of fs.readdirSync(directory).sort()) {
      if (!name || name === '.' || name === '..' || name.includes('/')) process.exit(1);
      const next = relative === '' ? name : `${relative}/${name}`;
      const target = path.join(root, next);
      const before = fs.lstatSync(target, { bigint: true });
      if (before.isSymbolicLink()) process.exit(1);
      if (before.isDirectory()) {
        entries.push(`d\0${next}`);
        visit(next);
        continue;
      }
      if (!before.isFile() || before.nlink < 1n || before.size > 1073741824n
          || (before.mode & 0o7000n) !== 0n) process.exit(1);
      const executable = before.mode & 0o111n;
      if (executable !== 0n && executable !== 0o111n) process.exit(1);
      const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (opened.dev !== before.dev || opened.ino !== before.ino
            || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs
            || opened.ctimeNs !== before.ctimeNs) process.exit(1);
        const bytes = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor, { bigint: true });
        const named = fs.lstatSync(target, { bigint: true });
        if (after.dev !== before.dev || after.ino !== before.ino
            || after.size !== before.size || after.mtimeNs !== before.mtimeNs
            || after.ctimeNs !== before.ctimeNs || named.dev !== before.dev
            || named.ino !== before.ino || named.size !== before.size
            || named.mtimeNs !== before.mtimeNs || named.ctimeNs !== before.ctimeNs) {
          process.exit(1);
        }
        entries.push([
          'f', next, executable === 0o111n ? '100755' : '100644',
          crypto.createHash('sha256').update(bytes).digest('hex'),
        ].join('\0'));
      } finally {
        fs.closeSync(descriptor);
      }
      if (entries.length > 100000) process.exit(1);
    }
  };
  visit('');
  return entries;
};
const left = snapshot(roots[0]);
const right = snapshot(roots[1]);
if (JSON.stringify(left) !== JSON.stringify(right)) process.exit(1);
NODE
}

RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
RELEASE_DIR="$(require_exact_direct_child \
  "$RELEASES_DIR/$RELEASE_ID" "$RELEASES_DIR" "$RELEASE_ID")" \
  || die_code 1 "release target is outside the canonical release root"
RELEASE_EFFECT_DIR="$(authorized_write_effect_path releasesDir "$RELEASE_DIR")"
RESUME_INSTALLED_RELEASE=0
RESUME_CURRENT_IS_CANDIDATE=0
if [ -e "$RELEASE_EFFECT_DIR" ] || [ -L "$RELEASE_EFFECT_DIR" ]; then
  if [ "$INITIAL_BARRIER_ARMED" = 1 ] \
      && installed_release_matches_source; then
    RESUME_INSTALLED_RELEASE=1
    if [ -L "$CURRENT_EFFECT_LINK" ] \
        && [ "$(read_symlink "$CURRENT_EFFECT_LINK")" = "$RELEASE_DIR" ]; then
      RESUME_CURRENT_IS_CANDIDATE=1
    fi
    ops_log "resuming exact installed release $RELEASE_ID under the pending rollback barrier"
  elif [ "$REINSTALL" = 1 ]; then
    if { [ -L "$CURRENT_EFFECT_LINK" ] \
          && [ "$(read_symlink "$CURRENT_EFFECT_LINK")" = "$RELEASE_DIR" ]; } \
        || { [ -L "$PREVIOUS_EFFECT_LINK" ] \
          && [ "$(read_symlink "$PREVIOUS_EFFECT_LINK")" = "$RELEASE_DIR" ]; }; then
      die_code 1 "reinstall refuses to replace a release selected by current or previous"
    fi
    ops_log "reinstall: replacing existing $RELEASE_EFFECT_DIR"
    fs_adjust_tree_write_bits "$RELEASE_EFFECT_DIR" owner-write
    fs_remove_tree "$RELEASE_EFFECT_DIR"
  else
    die_code 1 "release directory already exists (dirty target): $RELEASE_EFFECT_DIR — pass --reinstall to replace it"
  fi
fi
if [ "$RESUME_INSTALLED_RELEASE" != 1 ]; then
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
fi

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

# Once `current` moves, every failure must pass through the §24.2 policy. Keep
# progress-only stderr best-effort, contain helpers that may call `exit`, and
# make the terminal freeze code independent of marker/log/alert availability.
ROLLBACK_BARRIER_ARMED="$INITIAL_BARRIER_ARMED"

post_switch_failure() {
  local reason="$1" allow_rollback="${2:-1}" exposure=UNKNOWN rollback_ok=0
  if [ "$POST_SWITCH_ACTIVE" != 1 ]; then
    post_switch_progress "FATAL: post-switch handler invoked before current moved: $reason"
    exit 1
  fi
  if [ "$POST_SWITCH_HANDLING" = 1 ]; then
    post_switch_progress "FATAL: recursive post-switch failure: $reason"
    exit 2
  fi
  if [ "${ROLLBACK_BARRIER_ARMED:-0}" = 1 ]; then
    allow_rollback=0
    reason="$reason; rollback barrier was armed before candidate start"
  fi
  POST_SWITCH_HANDLING=1
  if ! exposure="$(get_exposure)"; then
    exposure=UNKNOWN
  fi
  if [ "$allow_rollback" = 1 ] \
      && [ ! -e "$MONEY_READY_EFFECT_MARKER" ] \
      && [ "$exposure" = "NONE" ] && [ -n "$OLD_TARGET" ]; then
    if ! ( log_event AUTO_ROLLBACK \
      "$reason; exposure=NONE; money readiness not reached" ); then
      post_switch_progress "could not append AUTO_ROLLBACK audit event"
    fi
    set -- --auto
    [ -n "$ENV_FILE" ] && set -- "$@" --env-file "$ENV_FILE"
    if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
      if ( run_authorized_automatic_rollback ); then
        rollback_ok=1
      fi
    else
      # A caller-supplied DEPLOY_LOCK_HELD marker is never trusted by the
      # staging rollback donor. Relinquish this staging lock and let rollback
      # acquire its own exact owner-bound lock.
      if ( release_lock "$DEPLOY_EFFECT_LOCK" ); then
        LOCK_HELD=0
        if "$I00_BASH" -p "$SCRIPT_DIR/rollback.sh" "$@"; then
          rollback_ok=1
        fi
      fi
    fi
    if [ "$rollback_ok" = 1 ]; then
      post_switch_progress \
        "FATAL: deploy of $RELEASE_ID failed ($reason); automatically rolled back to previous release"
      exit 3
    fi
    reason="$reason; AUTOMATIC ROLLBACK ALSO FAILED"
  fi
  record_deploy_frozen_evidence "$reason" "$exposure" || :
  reason="$DEPLOY_FAILURE_REASON"
  post_switch_progress \
    "FATAL: deployment FROZEN: $reason (exposure=$exposure); no automatic rollback; halt new entries and begin incident handling"
  exit 2
}

post_switch_required() { # REASON ALLOW_ROLLBACK COMMAND...
  local reason="$1" allow_rollback="$2"
  shift 2
  if ! ( "$@" ); then
    post_switch_failure "$reason" "$allow_rollback"
  fi
}

publish_bound_journal_compatibility() { # DATA_SCHEMA ROLLBACK_FLOOR UPDATED_BY
  local published_schema="$1" published_floor="$2" updated_by="$3"
  json_write_exact_regular_or_absent \
    "$JOURNAL_EFFECT_FILE" "$JOURNAL_SNAPSHOT" \
    "dataSchema=$published_schema" "rollbackFloor=$published_floor" \
    "updatedAtUtc=$(now_utc)" "updatedBy=$updated_by"
}

pre_switch_barrier_failure() {
  local reason="$1" exposure=UNKNOWN
  ROLLBACK_BARRIER_ARMED=1
  if [ "$POST_SWITCH_HANDLING" = 1 ]; then
    post_switch_progress "FATAL: recursive pre-switch barrier failure: $reason"
    exit 2
  fi
  POST_SWITCH_HANDLING=1
  if ! exposure="$(get_exposure)"; then
    exposure=UNKNOWN
  fi
  record_deploy_frozen_evidence "$reason" "$exposure" || :
  reason="$DEPLOY_FAILURE_REASON"
  post_switch_progress \
    "FATAL: deployment FROZEN: $reason (exposure=$exposure); rollback barrier may be live while current is still the prior release; operator completion is required"
  exit 2
}

post_switch_release_binding_is_exact() {
  authorized_release_source_binding_is_exact "$RELEASE_SRC" \
    && authorized_release_destination_tree_is_exact "$RELEASE_DIR"
}

current_pointer_matches_pre_switch_state() {
  if [ -n "$OLD_TARGET" ]; then
    [ -L "$CURRENT_EFFECT_LINK" ] \
      && [ "$(read_symlink "$CURRENT_EFFECT_LINK")" = "$OLD_TARGET" ]
  else
    [ ! -e "$CURRENT_EFFECT_LINK" ] && [ ! -L "$CURRENT_EFFECT_LINK" ]
  fi
}

current_pointer_matches_candidate() {
  [ -L "$CURRENT_EFFECT_LINK" ] \
    && [ "$(read_symlink "$CURRENT_EFFECT_LINK")" = "$RELEASE_DIR" ]
}

# --- 6. atomic switch ----------------------------------------------------------
require_authorized_release_source_binding "$RELEASE_SRC"
require_authorized_release_destination_tree "$RELEASE_DIR"
OLD_TARGET=""
if [ "$RESUME_CURRENT_IS_CANDIDATE" = 1 ]; then
  if [ -L "$PREVIOUS_EFFECT_LINK" ]; then
    OLD_TARGET="$(read_symlink "$PREVIOUS_EFFECT_LINK")"
    [ "$OLD_TARGET" != "$RELEASE_DIR" ] \
      || pre_switch_barrier_failure \
        "pending-barrier resume found previous pointing at the candidate"
  fi
elif [ -L "$CURRENT_EFFECT_LINK" ]; then
  OLD_TARGET="$(read_symlink "$CURRENT_EFFECT_LINK")"
fi
set +e
JOURNAL_SWITCH_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
JOURNAL_SWITCH_SNAPSHOT_RC=$?
set -e
[ "$JOURNAL_SWITCH_SNAPSHOT_RC" -eq 0 ] \
  && [ "$JOURNAL_SWITCH_SNAPSHOT" = "$JOURNAL_SNAPSHOT" ] \
  || die_code 1 "journal changed after under-lock validation - refusing to switch releases"

# A reboot can start whichever release `current` names without returning
# control to this shell. For a newly raised floor, commit the barrier before
# changing that pointer. A crash in the resulting conservative availability
# window leaves the prior release selected but unable to restart; it never
# exposes a migration-capable candidate behind a stale rollback floor.
if [ "$PRESTART_BARRIER_REQUIRED" = 1 ]; then
  PRESTART_JOURNAL_STATE=PRESENT
  PRESTART_UPDATED_BY=deploy.sh
  if [ "$NEW_FLOOR" -gt "$DATA_SCHEMA" ]; then
    PRESTART_JOURNAL_STATE=PENDING
    PRESTART_UPDATED_BY=deploy.sh.prestart-barrier
  fi
  # From this point until the writer proves rc1/no publication, a signal may
  # arrive after the atomic rename. Cleanup must therefore treat the floor as
  # potentially live before invoking the mutating writer.
  ROLLBACK_BARRIER_ARMED=1
  set +e
  publish_bound_journal_compatibility \
    "$DATA_SCHEMA" "$NEW_FLOOR" "$PRESTART_UPDATED_BY"
  JOURNAL_PUBLICATION_RC=$?
  set -e
  case "$JOURNAL_PUBLICATION_RC" in
    0)
      set +e
      JOURNAL_SNAPSHOT="$(
        journal_state_snapshot "$JOURNAL_EFFECT_FILE"
      )"
      JOURNAL_SNAPSHOT_RC=$?
      set -e
      if [ "$JOURNAL_SNAPSHOT_RC" -ne 0 ]; then
        pre_switch_barrier_failure \
          "armed rollback barrier could not be rebound before the current switch"
      fi
      case "$JOURNAL_SNAPSHOT" in
        "$PRESTART_JOURNAL_STATE|$DATA_SCHEMA|$NEW_FLOOR|"*) : ;;
        *)
          pre_switch_barrier_failure \
            "armed rollback barrier did not rebind as the exact committed-forward state"
          ;;
      esac
      post_switch_progress \
        "rollback barrier armed before current switch (appliedDataSchema=$DATA_SCHEMA rollbackFloor=$NEW_FLOOR)"
      ;;
    1)
      ROLLBACK_BARRIER_ARMED="$INITIAL_BARRIER_ARMED"
      die_code 1 \
        "rollback-barrier publication failed before atomic replacement; current release pointer remains untouched"
      ;;
    2)
      pre_switch_barrier_failure \
        "rollback-barrier atomic replacement completed but durability or final verification failed before the current switch"
      ;;
    *)
      pre_switch_barrier_failure \
        "rollback-barrier publisher returned an unknown failure before the current switch"
      ;;
  esac
fi

if [ "$RESUME_CURRENT_IS_CANDIDATE" = 1 ]; then
  POST_SWITCH_ACTIVE=1
  post_switch_progress \
    "resuming with current already bound to $RELEASE_DIR (previous -> ${OLD_TARGET:-none})"
else
  # Once a barrier is armed, preserve the old current in `previous` before
  # making the candidate boot-selectable. A crash on either side of the
  # current rename therefore retains the true recovery lineage.
  if [ "$ROLLBACK_BARRIER_ARMED" = 1 ] && [ -n "$OLD_TARGET" ]; then
    if ! atomic_symlink "$OLD_TARGET" "$PREVIOUS_EFFECT_LINK"; then
      pre_switch_barrier_failure \
        "previous release pointer could not be durably prepared before the current switch"
    fi
  fi
  CURRENT_SWITCH_ATTEMPTED=1
  if atomic_symlink "$RELEASE_DIR" "$CURRENT_EFFECT_LINK"; then
    POST_SWITCH_ACTIVE=1
    CURRENT_SWITCH_ATTEMPTED=0
  else
    if ( current_pointer_matches_pre_switch_state ); then
      CURRENT_SWITCH_ATTEMPTED=0
      if [ "$ROLLBACK_BARRIER_ARMED" = 1 ]; then
        pre_switch_barrier_failure \
          "current release pointer update failed after the rollback barrier was armed"
      fi
      die_code 1 "current release pointer update failed before the switch"
    elif ( current_pointer_matches_candidate ); then
      POST_SWITCH_ACTIVE=1
      CURRENT_SWITCH_ATTEMPTED=0
      post_switch_failure \
        "current release pointer update reported failure after publication" 0
    fi
    die_code 1 \
      "current release pointer update failed with publication state uncertain"
  fi
  if [ -n "$OLD_TARGET" ] && [ "$ROLLBACK_BARRIER_ARMED" != 1 ]; then
    post_switch_required \
      "previous release pointer update failed after the current switch" 0 \
      atomic_symlink "$OLD_TARGET" "$PREVIOUS_EFFECT_LINK"
  fi
fi
post_switch_required \
  "authorized write-root binding changed after the current switch" 0 \
  require_all_authorized_write_root_bindings
post_switch_progress "current -> $RELEASE_DIR (previous -> ${OLD_TARGET:-none})"

# --- 7. restart + post-switch gate, with §24.2 failure policy -----------------
if ! "$SYSTEMCTL" restart "$APP_UNIT"; then
  post_switch_failure "systemctl restart $APP_UNIT failed"
fi
if ! gate_wait "$HEALTH_BASE" "$POST_SWITCH_GATE_PATHS" "$GATE_TIMEOUT_SEC"; then
  post_switch_failure "post-switch health gate failed"
fi
post_switch_required \
  "authorized release source/destination binding changed after switch" 0 \
  post_switch_release_binding_is_exact

# --- 8. success: finalize the pre-switch-bound compatibility -----------------
set +e
publish_bound_journal_compatibility "$NEW_SCHEMA" "$NEW_FLOOR" deploy.sh
JOURNAL_PUBLICATION_RC=$?
set -e
case "$JOURNAL_PUBLICATION_RC" in
  0) : ;;
  1) post_switch_failure \
       "journal publication failed before atomic replacement after the release switch" ;;
  2) post_switch_failure \
       "journal atomic replacement completed but durability or final verification failed" 0 ;;
  *) post_switch_failure \
       "journal publisher returned an unknown failure after the release switch" 0 ;;
esac

if [ -e "$FROZEN_EFFECT_MARKER" ]; then
  post_switch_progress "clearing stale deploy-frozen marker after healthy deploy"
  post_switch_required \
    "stale deploy-frozen marker removal failed after journal publication" 0 \
    fs_remove_file "$FROZEN_EFFECT_MARKER"
fi
post_switch_required \
  "authorized write-root binding changed after journal publication" 0 \
  require_all_authorized_write_root_bindings
post_switch_required \
  "SUCCESS audit publication failed after journal publication" 0 \
  log_event SUCCESS \
  "healthy on $POST_SWITCH_GATE_PATHS; dataSchema=$NEW_SCHEMA rollbackFloor=$NEW_FLOOR prestartBarrier=$PRESTART_BARRIER_REQUIRED"
post_switch_progress "deploy of $RELEASE_ID complete"
DEPLOY_COMPLETED=1
exit 0
