#!/bin/bash -p
# ops/live/bin/rollback.sh — switch `current` back to a compatible release.
#
# §24.2 rules enforced here:
#   - rollback only to a journal/schema-compatible release: the target's
#     schemaVersion must not be behind the recorded non-rollback barrier
#     (rollbackFloor). This refusal is absolute — there is no override flag,
#     because a release behind the barrier cannot read the journal;
#   - automatic rollback (--auto, called by deploy.sh) additionally requires
#     exposure == NONE and that money readiness has never been reached;
#   - manual rollback with exposure/unknown state requires an explicit
#     --force-with-exposure and is intended only as recorded incident
#     handling, never routine operation.
#
# Usage:
#   rollback.sh [--to <releaseId>] [--env-file <file>] [--auto] [--force-with-exposure]
#
# Exit codes:
#   0  rolled back and healthy
#   1  refused/failed before the switch (no target, bad target, dirty host)
#   2  reserved (kept distinct from deploy.sh FROZEN)
#   3  switch attempted; safe completion is failed or uncertain — CRITICAL
#   4  deploy lock busy
#   5  target is behind the non-rollback barrier (schema-incompatible)
#   6  exposure/money-readiness policy refused the rollback
set -euo pipefail

unset BASH_ENV ENV CDPATH GLOBIGNORE
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
readonly PATH
case "$0" in
  /*) _I00_ENTRY_DIR="${0%/*}" ;;
  */*) _I00_ENTRY_DIR="$PWD/${0%/*}" ;;
  *) printf '%s\n' 'FATAL: rollback.sh requires an explicit script path' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf '%s\n' 'FATAL: rollback.sh script directory is unavailable' >&2; exit 1; }
unset _I00_ENTRY_DIR
# shellcheck source=common.sh
if [ "${_I00_AUTHORIZED_COMMON_READY:-0}" != 1 ]; then
  . "$SCRIPT_DIR/common.sh"
fi
type require_i00_effect_class >/dev/null 2>&1 \
  || { printf '%s\n' 'FATAL: rollback.sh common bootstrap is unavailable' >&2; exit 1; }
OPS_LOG_TAG=cosmos-rollback

TO_ID="" ENV_FILE="" ENV_DESCRIPTOR="" AUTO=0 FORCE_EXPOSURE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO_ID="${2:?--to needs a value}"; shift 2 ;;
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
    --auto) AUTO=1; shift ;;
    --force-with-exposure) FORCE_EXPOSURE=1; shift ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done

if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  if [ "$AUTO" = 1 ]; then
    require_i00_effect_class SERVICE_RELEASE_SWITCH
  else
    require_i00_effect_class SERVICE_ROLLBACK
  fi
fi
require_i00_effect_env_file_binding "$ENV_FILE"
load_env_file "$ENV_FILE"
cosmos_layout_defaults
COSMOS_ROOT="$(exact_raw_canonical_path "$COSMOS_ROOT")" \
  || die_code 1 "COSMOS_ROOT must be one exact raw canonical absolute path"
RELEASES_DIR="$(exact_existing_directory_path "$RELEASES_DIR")" \
  || die_code 1 "RELEASES_DIR must be one exact raw canonical non-symlink directory"
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
[ "$(path_dirname "$FROZEN_MARKER")" = "$OPS_STATE_DIR" ] \
  || die_code 1 "FROZEN_MARKER must be one exact direct child of OPS_STATE_DIR"
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
OPS_EFFECT_STATE_DIR="$(authorized_write_effect_path opsStateDir "$OPS_STATE_DIR")"
FROZEN_EFFECT_MARKER="$(authorized_write_effect_path \
  opsStateDir "$FROZEN_MARKER")"
MONEY_READY_EFFECT_MARKER="$(authorized_write_effect_path \
  opsStateDir "$MONEY_READY_MARKER")"
JOURNAL_EFFECT_FILE="$(authorized_write_effect_path dataDir "$JOURNAL_FILE")"
REUSE_DEPLOY_LOCK=0

if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ] \
    || any_path_effectively_intersects_protected_union \
      "$COSMOS_ROOT" "$RELEASES_DIR" \
      "$DATA_DIR" "$OPS_STATE_DIR" "$DEPLOY_LOCK" "$DEPLOY_LOG" \
      "$FROZEN_MARKER" "$MONEY_READY_MARKER" "$JOURNAL_FILE" \
    || pointer_path_effectively_intersects_protected_union "$CURRENT_LINK" \
    || pointer_path_effectively_intersects_protected_union "$PREVIOUS_LINK"; then
  if [ "$AUTO" = 1 ]; then
    require_i00_effect_class SERVICE_RELEASE_SWITCH
  else
    require_i00_effect_class SERVICE_ROLLBACK
  fi
fi
require_nonroot_direct_effect_or_i00_class
require_i00_effect_node_binding
if [ "${DEPLOY_LOCK_HELD:-0}" = 1 ]; then
  if { [ "$AUTO" = 1 ] && i00_effect_class_is SERVICE_RELEASE_SWITCH; } \
      || { [ "$AUTO" != 1 ] && i00_effect_class_is SERVICE_ROLLBACK; }; then
    classify_lock "$DEPLOY_EFFECT_LOCK"
    [ "$LOCK_STATE" = LIVE ] && [ "$LOCK_OWNER_PID" = "$PPID" ] \
      || die_code 1 "held deploy lock does not belong to the exact parent process generation"
    REUSE_DEPLOY_LOCK=1
  else
    die_code 1 "DEPLOY_LOCK_HELD does not match the authorized rollback mode and class"
  fi
elif [ "$AUTO" = 1 ] && i00_effect_class_is SERVICE_RELEASE_SWITCH; then
  die_code 1 "authorized automatic rollback requires the held release-switch lock"
fi

require_staging_supervisor_mock_or_i00_class
require_staging_app_unit_or_i00_class
if [ "$_I00_AUTHORIZED_EFFECT_PRESENT" = 1 ]; then
  require_trusted_effect_executable "$SYSTEMCTL" SYSTEMCTL
fi

: "${POST_SWITCH_GATE_PATHS:=/health/live /health/ready}"
: "${GATE_TIMEOUT_SEC:=60}"
require_cmd "$NODE" "$CURL" "$SYSTEMCTL"
configure_i00_bash

TARGET_ID="unknown"
log_event() { # RESULT DETAIL
  jsonl_append "$DEPLOY_EFFECT_LOG" "ts=$(now_utc)" "tool=rollback" \
    "releaseId=$TARGET_ID" "result=$1" "detail=$2"
}

ROLLBACK_SWITCHED=0
ROLLBACK_SWITCH_ATTEMPTED=0
ROLLBACK_CURRENT_SWITCHED=UNKNOWN
PREVIOUS_UPDATE_STATE=NOT_APPLICABLE
ROLLBACK_TERMINAL=0
ROLLBACK_FAILURE_REASON=""
ROLLBACK_COMPLETED=0

record_rollback_frozen_evidence() { # REASON
  local reason="$1" event_time marker_written=0
  if ! event_time="$(now_utc)"; then
    event_time=UNKNOWN_TIME
  fi
  if ( json_write "$FROZEN_EFFECT_MARKER" \
      "ts=$event_time" "releaseId=$TARGET_ID" "exposure=$EXPOSURE" \
      "reason=rollback: $reason" "operatorAction=required" \
      "currentSwitched=$ROLLBACK_CURRENT_SWITCHED" \
      "previousUpdateState=$PREVIOUS_UPDATE_STATE" ); then
    marker_written=1
  else
    reason="$reason; FROZEN MARKER WRITE FAILED"
    ( ops_log "rollback frozen marker could not be published; continuing independent critical evidence" ) \
      || :
  fi
  if [ "$marker_written" = 1 ] \
      && ! ( fs_seal_file_readonly \
        "$FROZEN_EFFECT_MARKER" "$OPS_EFFECT_STATE_DIR" ); then
    reason="$reason; FROZEN MARKER SEAL FAILED"
    ( ops_log "rollback frozen marker could not be sealed; continuing independent critical evidence" ) \
      || :
  fi
  if ! (require_authorized_write_root_binding opsStateDir "$OPS_STATE_DIR"); then
    reason="$reason; WRITE-ROOT BINDING RECHECK FAILED"
    ( ops_log "rollback write-root binding recheck failed; continuing independent critical evidence" ) \
      || :
  fi
  (alert critical ROLLBACK_GATE_FAILED \
    "$reason after switching to $TARGET_ID") \
    || ( ops_log "could not emit ROLLBACK_GATE_FAILED alert" ) || :
  (log_event CRITICAL "$reason") \
    || ( ops_log "could not append CRITICAL rollback audit event" ) || :
  ROLLBACK_FAILURE_REASON="$reason"
  return 0
}

rollback_post_switch_failure() { # REASON
  local reason="$1"
  if [ "$ROLLBACK_SWITCHED" != 1 ]; then
    ( ops_log "FATAL: internal rollback failure handler invoked before the current switch: $reason" ) \
      || :
    exit 1
  fi
  ROLLBACK_TERMINAL=1
  record_rollback_frozen_evidence "$reason" || :
  ( ops_log "FATAL: rollback switched to $TARGET_ID but did not complete safely ($ROLLBACK_FAILURE_REASON); frozen for incident handling" ) \
    || :
  exit 3
}

# Refuse an occupied or corrupt safety-state endpoint before publishing or
# reusing a deploy lock. The authoritative state is read again under that lock.
set +e
JOURNAL_PREFLIGHT_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
JOURNAL_PREFLIGHT_RC=$?
set -e
case "$JOURNAL_PREFLIGHT_RC" in
  0)
    case "$JOURNAL_PREFLIGHT_SNAPSHOT" in
      PENDING\|*)
        die_code 5 \
          "rollback is refused while a prestart barrier is pending; complete a compatible fix-forward deployment"
        ;;
    esac
    ;;
  7|8) : ;;
  5) die_code 1 "journal document or rollbackFloor is invalid" ;;
  6) die_code 1 "journal path is occupied by a non-regular or linked endpoint, or exceeds the size limit: $JOURNAL_FILE" ;;
  *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to assume a zero rollback floor" ;;
esac
unset JOURNAL_PREFLIGHT_SNAPSHOT

# --- lock (deploy.sh already holds it when it calls us with --auto) -----------
LOCK_HELD=0
if [ "$REUSE_DEPLOY_LOCK" != 1 ]; then
  acquire_lock "$DEPLOY_EFFECT_LOCK" \
    || die_code 4 "deploy lock busy: $DEPLOY_LOCK (another deploy/rollback in progress)"
  LOCK_HELD=1
fi
cleanup() {
  local rc=$? release_failed=0
  trap - EXIT HUP INT TERM
  if [ "$ROLLBACK_SWITCH_ATTEMPTED" = 1 ] \
      && [ "$ROLLBACK_SWITCHED" != 1 ]; then
    ROLLBACK_TERMINAL=1
    ( record_rollback_frozen_evidence \
      "current rollback pointer publication is uncertain after an interrupted atomic switch (rc=$rc)" ) || :
    rc=3
  elif [ "$ROLLBACK_SWITCHED" = 1 ] \
      && [ "$ROLLBACK_COMPLETED" != 1 ] && [ "$rc" -ne 3 ]; then
    ROLLBACK_TERMINAL=1
    ( record_rollback_frozen_evidence \
      "unexpected failure after the current rollback switch (rc=$rc)" ) || :
    rc=3
  fi
  if [ "$LOCK_HELD" = 1 ] \
      && ! ( release_lock "$DEPLOY_EFFECT_LOCK" ); then
    release_failed=1
  fi
  if [ "$release_failed" = 1 ]; then
    if [ "$ROLLBACK_SWITCHED" = 1 ] \
        || [ "$ROLLBACK_SWITCH_ATTEMPTED" = 1 ]; then
      if [ "$ROLLBACK_TERMINAL" != 1 ]; then
        ROLLBACK_TERMINAL=1
        ( record_rollback_frozen_evidence \
          "deploy lock release failed after the current rollback switch" ) || :
      else
        ( ops_log "could not release the deploy lock after terminal rollback handling" ) \
          || :
      fi
      rc=3
    else
      ( ops_log "could not release the deploy lock" ) || :
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# --- resolve and validate the target release ----------------------------------
assert_link_sane "$CURRENT_EFFECT_LINK"
assert_link_sane "$PREVIOUS_EFFECT_LINK"

RELEASES_CANON="$RELEASES_DIR"
if [ -n "$TO_ID" ]; then
  case "$TO_ID" in
    ""|"."|".."|*[!A-Za-z0-9._-]*)
      die_code 1 "--to must be one non-dot [A-Za-z0-9._-] release name"
      ;;
  esac
  TARGET_DIR="$RELEASES_DIR/$TO_ID"
  TARGET_DIR="$(exact_existing_directory_path "$TARGET_DIR")" \
    || die_code 1 "rollback --to target must be one exact raw canonical non-symlink directory"
  TARGET_EFFECT_DIR="$(require_exact_direct_child \
    "$TARGET_DIR" "$RELEASES_DIR" "$TO_ID")" \
    || die_code 1 "rollback --to target is outside the canonical release root"
  TARGET_PATH_ID="$TO_ID"
else
  [ -L "$PREVIOUS_LINK" ] \
    || die_code 1 "no previous release recorded at $PREVIOUS_LINK and no --to given"
  TARGET_DIR="$(read_symlink "$PREVIOUS_LINK")"
  TARGET_EFFECT_DIR="$(require_exact_direct_child "$PREVIOUS_LINK" "$RELEASES_DIR")" \
    || die_code 1 "previous release target is outside the canonical release root"
  TARGET_PATH_ID="$(i00_guard_node -e '
    process.stdout.write(require("path").basename(process.argv[1]));
  ' "$TARGET_EFFECT_DIR")"
fi
require_authorized_release_source_binding "$TARGET_DIR"
TARGET_READ_DIR="$(authorized_release_source_effect_path "$TARGET_DIR")"
[ -d "$TARGET_READ_DIR" ] || die_code 1 "rollback target does not exist: $TARGET_DIR"
[ -f "$TARGET_READ_DIR/release.json" ] || die_code 1 "rollback target has no release.json: $TARGET_DIR"
[ -f "$TARGET_READ_DIR/server/dist/index.js" ] || die_code 1 "rollback target payload incomplete: $TARGET_DIR"
TARGET_ID="$(json_get "$TARGET_READ_DIR/release.json" releaseId)" \
  || die_code 1 "rollback target release.json: releaseId missing"
case "$TARGET_ID" in
  ""|"."|".."|*[!A-Za-z0-9._-]*)
    die_code 1 "rollback target releaseId is not one safe direct-child name"
    ;;
esac
[ "$TARGET_ID" = "$TARGET_PATH_ID" ] \
  || die_code 1 "rollback target directory and releaseId do not match"
set +e
TARGET_SCHEMA="$(json_get_nonnegative_safe_integer \
  "$TARGET_READ_DIR/release.json" schemaVersion)"
TARGET_SCHEMA_RC=$?
set -e
case "$TARGET_SCHEMA_RC" in
  0) : ;;
  3|4) die_code 1 "rollback target release.json: schemaVersion missing" ;;
  5) die_code 1 "target release schemaVersion is not a nonnegative integer within the exact comparison range" ;;
  *) die_code 1 "rollback target release.json: schemaVersion validation failed" ;;
esac

# --- journal/schema compatibility: absolute ------------------------------------
# Part 4 #6: bind the barrier and exact endpoint version from one under-lock
# read. Missing fields and true absence default to zero; corrupt or occupied
# state never defaults to the most permissive value.
set +e
JOURNAL_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
JOURNAL_SNAPSHOT_RC=$?
set -e
case "$JOURNAL_SNAPSHOT_RC" in
  0)
    case "$JOURNAL_SNAPSHOT" in
      PENDING\|*)
        die_code 5 \
          "rollback is refused while a prestart barrier is pending; complete a compatible fix-forward deployment"
        ;;
    esac
    ;;
  7) ops_log "journal dataSchema is invalid; rollback is using the independently valid rollbackFloor" ;;
  8) ops_log "journal rollbackFloor exceeds dataSchema; rollback is enforcing the independently valid rollbackFloor" ;;
  5) die_code 1 "journal document or rollbackFloor is invalid - refusing to evaluate the non-rollback barrier against an uncomparable value" ;;
  6) die_code 1 "journal path is occupied by a non-regular or linked endpoint, or exceeds the size limit: $JOURNAL_FILE" ;;
  *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to assume a zero rollback floor" ;;
esac
JOURNAL_SNAPSHOT_REST="${JOURNAL_SNAPSHOT#*|}"
JOURNAL_SNAPSHOT_REST="${JOURNAL_SNAPSHOT_REST#*|}"
ROLLBACK_FLOOR="${JOURNAL_SNAPSHOT_REST%%|*}"
unset JOURNAL_SNAPSHOT_REST
set +e
[ "$TARGET_SCHEMA" -lt "$ROLLBACK_FLOOR" ]
BARRIER_COMPARISON_RC=$?
set -e
case "$BARRIER_COMPARISON_RC" in
  0)
    log_event REFUSED_SCHEMA "target schema $TARGET_SCHEMA behind non-rollback barrier $ROLLBACK_FLOOR"
    die_code 5 "rollback to $TARGET_ID refused: schemaVersion $TARGET_SCHEMA is behind the non-rollback barrier (rollbackFloor=$ROLLBACK_FLOOR); the target cannot read the journal — a data migration, not a rollback, is required"
    ;;
  1) : ;;
  *) die_code 1 "target release schemaVersion and journal rollbackFloor are not safely comparable - refusing to evaluate the non-rollback barrier" ;;
esac

# --- exposure / money-readiness policy -----------------------------------------
EXPOSURE="$(get_exposure)"
if [ "$AUTO" = 1 ]; then
  if [ -e "$MONEY_READY_EFFECT_MARKER" ]; then
    log_event REFUSED_POLICY "auto-rollback after money readiness"
    die_code 6 "auto-rollback refused: money readiness has been reached; rollback is an operator decision now"
  fi
  if [ "$EXPOSURE" != "NONE" ]; then
    log_event REFUSED_POLICY "auto-rollback with exposure=$EXPOSURE"
    die_code 6 "auto-rollback refused: exposure=$EXPOSURE (only literal NONE permits automation)"
  fi
else
  if [ "$EXPOSURE" != "NONE" ] && [ "$FORCE_EXPOSURE" != 1 ]; then
    log_event REFUSED_POLICY "manual rollback with exposure=$EXPOSURE and no --force-with-exposure"
    die_code 6 "rollback refused: exposure=$EXPOSURE. If this is recorded incident handling, re-run with --force-with-exposure; recovery capability must be preserved"
  fi
  if [ "$FORCE_EXPOSURE" = 1 ]; then
    log_event FORCED_WITH_EXPOSURE "operator override; exposure=$EXPOSURE"
    alert critical ROLLBACK_FORCED "manual rollback forced with exposure=$EXPOSURE"
  fi
fi

# --- atomic switch + restart + gate --------------------------------------------
rollback_pointer_matches_pre_switch_state() {
  if [ -n "$OLD_TARGET" ]; then
    [ -L "$CURRENT_EFFECT_LINK" ] \
      && [ "$(read_symlink "$CURRENT_EFFECT_LINK")" = "$OLD_TARGET" ]
  else
    [ ! -e "$CURRENT_EFFECT_LINK" ] && [ ! -L "$CURRENT_EFFECT_LINK" ]
  fi
}

rollback_pointer_matches_target() {
  [ -L "$CURRENT_EFFECT_LINK" ] \
    && [ "$(read_symlink "$CURRENT_EFFECT_LINK")" = "$TARGET_DIR" ]
}

OLD_TARGET=""
if [ -L "$CURRENT_EFFECT_LINK" ]; then
  OLD_TARGET="$(read_symlink "$CURRENT_EFFECT_LINK")"
  PREVIOUS_UPDATE_STATE=PENDING
fi
set +e
JOURNAL_SWITCH_SNAPSHOT="$(
  journal_state_snapshot "$JOURNAL_EFFECT_FILE"
)"
JOURNAL_SWITCH_SNAPSHOT_RC=$?
set -e
[ "$JOURNAL_SWITCH_SNAPSHOT_RC" -eq "$JOURNAL_SNAPSHOT_RC" ] \
  && [ "$JOURNAL_SWITCH_SNAPSHOT" = "$JOURNAL_SNAPSHOT" ] \
  || die_code 1 "journal changed after under-lock validation - refusing to switch releases"
ROLLBACK_SWITCH_ATTEMPTED=1
if atomic_symlink "$TARGET_DIR" "$CURRENT_EFFECT_LINK"; then
  ROLLBACK_CURRENT_SWITCHED=true ROLLBACK_SWITCHED=1
  ROLLBACK_SWITCH_ATTEMPTED=0
else
  if ( rollback_pointer_matches_pre_switch_state ); then
    ROLLBACK_SWITCH_ATTEMPTED=0
    die_code 1 "current rollback pointer update failed before the switch"
  elif ( rollback_pointer_matches_target ); then
    ROLLBACK_CURRENT_SWITCHED=true ROLLBACK_SWITCHED=1
    ROLLBACK_SWITCH_ATTEMPTED=0
    rollback_post_switch_failure \
      "current rollback pointer update reported failure after publication"
  fi
  die_code 1 \
    "current rollback pointer update failed with publication state uncertain"
fi
if [ -n "$OLD_TARGET" ]; then
  if ! atomic_symlink "$OLD_TARGET" "$PREVIOUS_EFFECT_LINK"; then
    rollback_post_switch_failure \
      "current switched to $TARGET_ID but previous pointer update failed"
  fi
  PREVIOUS_UPDATE_STATE=COMPLETE
fi
if ! (require_all_authorized_write_root_bindings); then
  rollback_post_switch_failure \
    "authorized write-root binding changed after the rollback switch"
fi
( ops_log "current -> $TARGET_DIR (previous -> ${OLD_TARGET:-none})" ) || :

GATE_FAIL_REASON=""
if ! "$SYSTEMCTL" restart "$APP_UNIT"; then
  GATE_FAIL_REASON="systemctl restart $APP_UNIT failed"
elif ! gate_wait "$HEALTH_BASE" "$POST_SWITCH_GATE_PATHS" "$GATE_TIMEOUT_SEC"; then
  GATE_FAIL_REASON="post-rollback health gate failed"
fi

if [ -n "$GATE_FAIL_REASON" ]; then
  rollback_post_switch_failure "$GATE_FAIL_REASON"
fi

if ! authorized_release_source_binding_is_exact "$TARGET_DIR"; then
  rollback_post_switch_failure \
    "authorized release source binding changed after the rollback switch"
fi
if ! (require_all_authorized_write_root_bindings); then
  rollback_post_switch_failure \
    "authorized write-root binding changed after the healthy rollback gate"
fi
( log_event ROLLBACK_OK "healthy on $POST_SWITCH_GATE_PATHS" ) \
  || ( ops_log "could not append ROLLBACK_OK audit event" ) || :
( ops_log "rollback to $TARGET_ID complete" ) || :
ROLLBACK_COMPLETED=1
exit 0
