#!/usr/bin/env bash
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
#   3  switched but post-switch gate failed — CRITICAL, frozen marker written
#   4  deploy lock busy
#   5  target is behind the non-rollback barrier (schema-incompatible)
#   6  exposure/money-readiness policy refused the rollback
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
OPS_LOG_TAG=cosmos-rollback

TO_ID="" ENV_FILE="" AUTO=0 FORCE_EXPOSURE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TO_ID="${2:?--to needs a value}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --auto) AUTO=1; shift ;;
    --force-with-exposure) FORCE_EXPOSURE=1; shift ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done

load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${POST_SWITCH_GATE_PATHS:=/health/live /health/ready}"
: "${GATE_TIMEOUT_SEC:=60}"
require_cmd "$NODE" "$CURL" "$SYSTEMCTL"

TARGET_ID="unknown"
log_event() { # RESULT DETAIL
  jsonl_append "$DEPLOY_LOG" "ts=$(now_utc)" "tool=rollback" \
    "releaseId=$TARGET_ID" "result=$1" "detail=$2"
}

# --- lock (deploy.sh already holds it when it calls us with --auto) -----------
LOCK_HELD=0
if [ "${DEPLOY_LOCK_HELD:-0}" != 1 ]; then
  acquire_lock "$DEPLOY_LOCK" \
    || die_code 4 "deploy lock busy: $DEPLOY_LOCK (another deploy/rollback in progress)"
  LOCK_HELD=1
fi
cleanup() { if [ "$LOCK_HELD" = 1 ]; then release_lock "$DEPLOY_LOCK"; fi; }
trap cleanup EXIT

# --- resolve and validate the target release ----------------------------------
assert_link_sane "$CURRENT_LINK"
assert_link_sane "$PREVIOUS_LINK"

if [ -n "$TO_ID" ]; then
  TARGET_DIR="$RELEASES_DIR/$TO_ID"
else
  [ -L "$PREVIOUS_LINK" ] \
    || die_code 1 "no previous release recorded at $PREVIOUS_LINK and no --to given"
  TARGET_DIR="$(readlink "$PREVIOUS_LINK")"
fi
[ -d "$TARGET_DIR" ] || die_code 1 "rollback target does not exist: $TARGET_DIR"
[ -f "$TARGET_DIR/release.json" ] || die_code 1 "rollback target has no release.json: $TARGET_DIR"
[ -f "$TARGET_DIR/server/dist/index.js" ] || die_code 1 "rollback target payload incomplete: $TARGET_DIR"
TARGET_ID="$(json_get "$TARGET_DIR/release.json" releaseId)" \
  || die_code 1 "rollback target release.json: releaseId missing"
TARGET_SCHEMA="$(json_get "$TARGET_DIR/release.json" schemaVersion)" \
  || die_code 1 "rollback target release.json: schemaVersion missing"

# --- journal/schema compatibility: absolute ------------------------------------
ROLLBACK_FLOOR=0
if [ -f "$JOURNAL_FILE" ]; then
  # Part 4 #6: a corrupt journal must never default the non-rollback barrier
  # to its most permissive value.
  set +e; FLOOR_VALUE="$(json_get "$JOURNAL_FILE" rollbackFloor)"; FLOOR_RC=$?; set -e
  case "$FLOOR_RC" in
    0) ROLLBACK_FLOOR="$FLOOR_VALUE" ;;
    3) ROLLBACK_FLOOR=0 ;;
    *) die_code 1 "journal unreadable: $JOURNAL_FILE - refusing to assume a zero rollback floor" ;;
  esac
fi
if [ "$TARGET_SCHEMA" -lt "$ROLLBACK_FLOOR" ]; then
  log_event REFUSED_SCHEMA "target schema $TARGET_SCHEMA behind non-rollback barrier $ROLLBACK_FLOOR"
  die_code 5 "rollback to $TARGET_ID refused: schemaVersion $TARGET_SCHEMA is behind the non-rollback barrier (rollbackFloor=$ROLLBACK_FLOOR); the target cannot read the journal — a data migration, not a rollback, is required"
fi

# --- exposure / money-readiness policy -----------------------------------------
EXPOSURE="$(get_exposure)"
if [ "$AUTO" = 1 ]; then
  if [ -e "$MONEY_READY_MARKER" ]; then
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
OLD_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  OLD_TARGET="$(readlink "$CURRENT_LINK")"
fi
atomic_symlink "$TARGET_DIR" "$CURRENT_LINK"
if [ -n "$OLD_TARGET" ]; then
  atomic_symlink "$OLD_TARGET" "$PREVIOUS_LINK"
fi
ops_log "current -> $TARGET_DIR (previous -> ${OLD_TARGET:-none})"

GATE_FAIL_REASON=""
if ! "$SYSTEMCTL" restart "$APP_UNIT"; then
  GATE_FAIL_REASON="systemctl restart $APP_UNIT failed"
elif ! gate_wait "$HEALTH_BASE" "$POST_SWITCH_GATE_PATHS" "$GATE_TIMEOUT_SEC"; then
  GATE_FAIL_REASON="post-rollback health gate failed"
fi

if [ -n "$GATE_FAIL_REASON" ]; then
  json_write "$FROZEN_MARKER" "ts=$(now_utc)" "releaseId=$TARGET_ID" \
    "exposure=$EXPOSURE" "reason=rollback: $GATE_FAIL_REASON" "operatorAction=required"
  alert critical ROLLBACK_GATE_FAILED "$GATE_FAIL_REASON after switching to $TARGET_ID"
  log_event CRITICAL "$GATE_FAIL_REASON"
  die_code 3 "rollback switched to $TARGET_ID but the system is not healthy ($GATE_FAIL_REASON); frozen for incident handling"
fi

log_event ROLLBACK_OK "healthy on $POST_SWITCH_GATE_PATHS"
ops_log "rollback to $TARGET_ID complete"
exit 0
