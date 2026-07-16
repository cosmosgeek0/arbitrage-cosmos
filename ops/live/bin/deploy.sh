#!/usr/bin/env bash
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
OPS_LOG_TAG=cosmos-deploy

usage() {
  sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
}

RELEASE_SRC="" ENV_FILE="" REINSTALL=0 SKIP_PROBE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_SRC="${2:?--release needs a value}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --reinstall) REINSTALL=1; shift ;;
    --skip-probe) SKIP_PROBE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done
[ -n "$RELEASE_SRC" ] || die_code 1 "--release is required (see --help)"

load_env_file "$ENV_FILE"
cosmos_layout_defaults

: "${READINESS_GATE_PATHS:=/health/live /health/ready}"
: "${POST_SWITCH_GATE_PATHS:=$READINESS_GATE_PATHS}"
: "${GATE_TIMEOUT_SEC:=60}"
: "${PROBE_ENABLED:=1}"
: "${PROBE_PORT:=8091}"
: "${PROBE_BASE:=http://127.0.0.1:$PROBE_PORT}"
: "${PROBE_CMD:=}"

require_cmd "$NODE"

RELEASE_ID="unknown"
log_event() { # RESULT DETAIL
  jsonl_append "$DEPLOY_LOG" "ts=$(now_utc)" "tool=deploy" \
    "releaseId=$RELEASE_ID" "result=$1" "detail=$2"
}

# --- 1. validate the release source (before taking the lock: read-only) ------
[ -d "$RELEASE_SRC" ] \
  || die_code 1 "release source is not a directory: $RELEASE_SRC (unpack tarballs before calling deploy)"
[ -f "$RELEASE_SRC/release.json" ] \
  || die_code 1 "release.json missing in $RELEASE_SRC"
RELEASE_ID="$(json_get "$RELEASE_SRC/release.json" releaseId)" \
  || die_code 1 "release.json: releaseId missing"
SCHEMA_VERSION="$(json_get "$RELEASE_SRC/release.json" schemaVersion)" \
  || die_code 1 "release.json: schemaVersion missing"
BARRIER="$(json_get "$RELEASE_SRC/release.json" rollbackBarrier || echo false)"
case "$RELEASE_ID" in
  ""|*[!A-Za-z0-9._-]*) die_code 1 "releaseId must be non-empty [A-Za-z0-9._-]: '$RELEASE_ID'" ;;
esac
case "$SCHEMA_VERSION" in
  ""|*[!0-9]*) die_code 1 "schemaVersion must be a non-negative integer: '$SCHEMA_VERSION'" ;;
esac
case "$BARRIER" in
  true|false) : ;;
  *) die_code 1 "rollbackBarrier must be true or false: '$BARRIER'" ;;
esac
[ -f "$RELEASE_SRC/server/dist/index.js" ] \
  || die_code 1 "release payload incomplete: server/dist/index.js missing (partial build?)"

# --- 2. lock -----------------------------------------------------------------
acquire_lock "$DEPLOY_LOCK" \
  || die_code 4 "deploy lock busy: $DEPLOY_LOCK (another deploy/rollback in progress)"
LOCK_HELD=1
PROBE_PID=""
PROBE_DATA_TMP=""
cleanup() {
  # If the deploy is interrupted mid-probe, the candidate process and its
  # throwaway data dir must not outlive us.
  if [ -n "${PROBE_PID:-}" ]; then kill "$PROBE_PID" 2>/dev/null || true; fi
  if [ -n "${PROBE_DATA_TMP:-}" ]; then rm -rf "$PROBE_DATA_TMP"; fi
  if [ "${LOCK_HELD:-0}" = 1 ]; then release_lock "$DEPLOY_LOCK"; fi
}
trap cleanup EXIT

# --- 3. host sanity + journal/schema floor, before any mutation --------------
assert_link_sane "$CURRENT_LINK"
assert_link_sane "$PREVIOUS_LINK"

ROLLBACK_FLOOR=0
if [ -f "$JOURNAL_FILE" ]; then
  ROLLBACK_FLOOR="$(json_get "$JOURNAL_FILE" rollbackFloor || echo 0)"
fi
if [ "$SCHEMA_VERSION" -lt "$ROLLBACK_FLOOR" ]; then
  log_event REFUSED_SCHEMA "candidate schema $SCHEMA_VERSION is behind the non-rollback barrier $ROLLBACK_FLOOR"
  die_code 1 "candidate schemaVersion $SCHEMA_VERSION is behind the non-rollback barrier (rollbackFloor=$ROLLBACK_FLOOR); this release can no longer read the journal"
fi

# --- 4. install into an immutable release directory --------------------------
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
if [ -e "$RELEASE_DIR" ]; then
  if [ "$REINSTALL" = 1 ]; then
    ops_log "reinstall: replacing existing $RELEASE_DIR"
    chmod -R u+w "$RELEASE_DIR" 2>/dev/null || true
    rm -rf "$RELEASE_DIR"
  else
    die_code 1 "release directory already exists (dirty target): $RELEASE_DIR — pass --reinstall to replace it"
  fi
fi
mkdir -p "$RELEASES_DIR"
# We hold the exclusive deploy lock, so any leftover staging dir is debris
# from a crashed deploy on a dirty host — clear it.
rm -rf "$RELEASES_DIR"/.staging-* 2>/dev/null || true
STAGING="$RELEASES_DIR/.staging-$RELEASE_ID-$$"
mkdir -p "$STAGING"
cp -R "$RELEASE_SRC/." "$STAGING/"
"$NODE" -e 'require("fs").renameSync(process.argv[1], process.argv[2])' "$STAGING" "$RELEASE_DIR"
chmod -R a-w "$RELEASE_DIR"
ops_log "installed immutable release $RELEASE_ID at $RELEASE_DIR"

# --- 5. readiness gate BEFORE the switch --------------------------------------
# The candidate is booted on a probe port against a throwaway data dir; the
# production state store is never handed to an unproven build. PROBE_CMD (if
# set) must `exec` its server so the recorded pid is the server itself.
run_probe_gate() {
  if [ "$PROBE_ENABLED" != 1 ]; then
    ops_log "probe gate disabled by configuration (PROBE_ENABLED=$PROBE_ENABLED)"
    return 0
  fi
  if [ "$SKIP_PROBE" = 1 ]; then
    ops_log "probe gate SKIPPED by --skip-probe (emergency use only; recorded)"
    log_event PROBE_SKIPPED "operator passed --skip-probe"
    return 0
  fi
  local probe_data probe_pid ok=0
  probe_data="$(mktemp -d "${TMPDIR:-/tmp}/cosmos-probe.XXXXXX")"
  PROBE_DATA_TMP="$probe_data"
  if [ -n "$PROBE_CMD" ]; then
    RELEASE_DIR="$RELEASE_DIR" PROBE_PORT="$PROBE_PORT" PROBE_DATA_DIR="$probe_data" \
      bash -c "$PROBE_CMD" &
  else
    ( cd "$RELEASE_DIR" \
      && PORT="$PROBE_PORT" HOST=127.0.0.1 DATA_DIR="$probe_data" SKIP_DOTENV=1 \
         exec "$NODE" server/dist/index.js ) &
  fi
  probe_pid=$!
  PROBE_PID="$probe_pid"
  if gate_wait "$PROBE_BASE" "$READINESS_GATE_PATHS" "$GATE_TIMEOUT_SEC" "$probe_pid"; then
    ok=1
  fi
  kill "$probe_pid" 2>/dev/null || true
  wait "$probe_pid" 2>/dev/null || true
  PROBE_PID=""
  rm -rf "$probe_data"
  PROBE_DATA_TMP=""
  if [ "$ok" != 1 ]; then
    log_event REJECTED_BY_PROBE "readiness gate failed before switch; current release untouched"
    die_code 1 "readiness probe failed for $RELEASE_ID; aborted before switch — running release untouched"
  fi
  ops_log "probe gate passed for $RELEASE_ID"
}
run_probe_gate

# --- 6. atomic switch ----------------------------------------------------------
OLD_TARGET=""
if [ -L "$CURRENT_LINK" ]; then
  OLD_TARGET="$(readlink "$CURRENT_LINK")"
fi
atomic_symlink "$RELEASE_DIR" "$CURRENT_LINK"
if [ -n "$OLD_TARGET" ]; then
  atomic_symlink "$OLD_TARGET" "$PREVIOUS_LINK"
fi
ops_log "current -> $RELEASE_DIR (previous -> ${OLD_TARGET:-none})"

# --- 7. restart + post-switch gate, with §24.2 failure policy -----------------
post_switch_failure() {
  local reason="$1" exposure
  exposure="$(get_exposure)"
  if [ ! -e "$MONEY_READY_MARKER" ] && [ "$exposure" = "NONE" ] && [ -n "$OLD_TARGET" ]; then
    log_event AUTO_ROLLBACK "$reason; exposure=NONE; money readiness not reached"
    set -- --auto
    [ -n "$ENV_FILE" ] && set -- "$@" --env-file "$ENV_FILE"
    if DEPLOY_LOCK_HELD=1 "$SCRIPT_DIR/rollback.sh" "$@"; then
      die_code 3 "deploy of $RELEASE_ID failed ($reason); automatically rolled back to previous release"
    fi
    reason="$reason; AUTOMATIC ROLLBACK ALSO FAILED"
  fi
  json_write "$FROZEN_MARKER" "ts=$(now_utc)" "releaseId=$RELEASE_ID" \
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

# --- 8. success: record journal compatibility ---------------------------------
DATA_SCHEMA=0
if [ -f "$JOURNAL_FILE" ]; then
  DATA_SCHEMA="$(json_get "$JOURNAL_FILE" dataSchema || echo 0)"
fi
NEW_SCHEMA="$DATA_SCHEMA"
[ "$SCHEMA_VERSION" -gt "$NEW_SCHEMA" ] && NEW_SCHEMA="$SCHEMA_VERSION"
NEW_FLOOR="$ROLLBACK_FLOOR"
if [ "$BARRIER" = "true" ] && [ "$SCHEMA_VERSION" -gt "$NEW_FLOOR" ]; then
  NEW_FLOOR="$SCHEMA_VERSION"
fi
mkdir -p "$DATA_DIR"
json_write "$JOURNAL_FILE" "dataSchema=$NEW_SCHEMA" "rollbackFloor=$NEW_FLOOR" \
  "updatedAtUtc=$(now_utc)" "updatedBy=deploy.sh"

if [ -e "$FROZEN_MARKER" ]; then
  ops_log "clearing stale deploy-frozen marker after healthy deploy"
  rm -f "$FROZEN_MARKER"
fi
log_event SUCCESS "healthy on $POST_SWITCH_GATE_PATHS; dataSchema=$NEW_SCHEMA rollbackFloor=$NEW_FLOOR"
ops_log "deploy of $RELEASE_ID complete"
exit 0
