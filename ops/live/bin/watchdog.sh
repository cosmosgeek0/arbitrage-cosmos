#!/usr/bin/env bash
# ops/live/bin/watchdog.sh — external supervision, one bounded check pass.
#
# Fired by cosmos-watchdog.timer (see ops/live/systemd/). Deliberately
# installed OUTSIDE the release path (/usr/local/lib/cosmos-ops) so a broken
# release cannot take its own supervisor down with it.
#
# Policy (§23/§24):
#   - /health/live failing LIVE_FAIL_THRESHOLD consecutive passes  -> restart
#     the app unit, but never more than MAX_RESTARTS_PER_WINDOW per
#     RESTART_WINDOW_SEC (a crash loop needs a human, not a hammer);
#   - /health/ready failing while live is healthy -> ALERT ONLY. The process
#     is alive but degraded (stale feeds, TRADE_UNSAFE, ...); restarting
#     cannot fix inputs and may destroy in-memory recovery state;
#   - the watchdog NEVER takes any trading/exchange action of any kind, and
#     never auto-liquidates on infrastructure alarms (§23);
#   - tunnel down -> alert (optional bounded restart via WATCHDOG_RESTART_TUNNEL);
#   - proven live deploy owner or bounded owner publication -> skip entirely;
#   - deploy-frozen marker present -> keep alerting until an operator acts;
#   - newest backup stale/missing -> alert (§23 "backup stale").
#
# Usage: watchdog.sh [--env-file <file>]     Exit code is 0 unless misconfigured;
# findings are reported via ALERT_CMD and $WATCHDOG_STATE_DIR/status.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"
OPS_LOG_TAG=cosmos-watchdog

ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die_code 1 "unknown argument: $1" ;;
  esac
done

load_env_file "$ENV_FILE"
cosmos_layout_defaults
: "${LIVE_PATH:=/health/live}"
: "${READY_PATH:=/health/ready}"
: "${LIVE_FAIL_THRESHOLD:=3}"
: "${RESTART_WINDOW_SEC:=1800}"
: "${MAX_RESTARTS_PER_WINDOW:=2}"
: "${WATCHDOG_RESTART_TUNNEL:=0}"
: "${WATCHDOG_STATE_DIR:=$OPS_STATE_DIR/watchdog}"
: "${BACKUP_DIR:=}"
: "${BACKUP_MAX_AGE_HOURS:=26}"
require_cmd "$NODE" "$CURL" "$SYSTEMCTL"
mkdir -p "$WATCHDOG_STATE_DIR"

STREAK_FILE="$WATCHDOG_STATE_DIR/live-fail-streak"
APP_RESTARTS="$WATCHDOG_STATE_DIR/app-restarts.log"
TUNNEL_RESTARTS="$WATCHDOG_STATE_DIR/tunnel-restarts.log"
ALERTS_LOG="$WATCHDOG_STATE_DIR/alerts.jsonl"

wd_alert() { # severity code message
  jsonl_append "$ALERTS_LOG" "ts=$(now_utc)" "severity=$1" "code=$2" "message=$3"
  alert "$1" "$2" "$3"
}

count_recent() { # file window_sec
  local cutoff n=0 line
  cutoff=$(( $(now_epoch) - $2 ))
  [ -f "$1" ] || { echo 0; return 0; }
  while read -r line; do
    case "$line" in (*[!0-9]*|"") continue ;; esac
    [ "$line" -ge "$cutoff" ] && n=$((n + 1))
  done < "$1"
  echo "$n"
}

write_status() { # live ready tunnel skipped frozen backupFresh streak lockState lockReason
  json_write "$WATCHDOG_STATE_DIR/status.json" "ranAtUtc=$(now_utc)" \
    "live=$1" "ready=$2" "tunnel=$3" "skipped=$4" "deployFrozen=$5" \
    "backupFresh=$6" "liveFailStreak=$7" "deployLockState=$8" \
    "deployLockReason=$9"
}

# --- deploy ownership: skip only a proven owner or bounded publication race -------
# Part 4 #7: an ABSENT streak file is a legitimate first run (0). A PRESENT
# but unreadable/malformed one previously also became 0, silently disarming
# the restart threshold forever. Fail toward acting instead: assume the
# threshold is reached and say so.
if [ ! -e "$STREAK_FILE" ]; then
  LOCK_STREAK=0
else
  LOCK_STREAK="$(cat "$STREAK_FILE" 2>/dev/null || echo UNREADABLE)"
  case "$LOCK_STREAK" in
    (*[!0-9]*|"")
      wd_alert critical WATCHDOG_STATE_UNREADABLE \
        "streak file $STREAK_FILE is present but unreadable or malformed; assuming the live-fail threshold is reached"
      LOCK_STREAK="$LIVE_FAIL_THRESHOLD"
      ;;
  esac
fi
classify_lock_family "$DEPLOY_LOCK"
DEPLOY_LOCK_STATE="$LOCK_STATE"
DEPLOY_LOCK_REASON="$LOCK_REASON"
case "$DEPLOY_LOCK_STATE" in
  LIVE|INITIALIZING)
    ops_log "deploy lock state=$DEPLOY_LOCK_STATE reason=$DEPLOY_LOCK_REASON; skipping this watchdog pass"
    write_status unknown unknown unknown true unknown unknown "$LOCK_STREAK" \
      "$DEPLOY_LOCK_STATE" "$DEPLOY_LOCK_REASON"
    exit 0
    ;;
  UNKNOWN)
    wd_alert critical DEPLOY_LOCK_UNVERIFIED \
      "deploy lock ownership cannot be proven ($DEPLOY_LOCK_REASON); fail-closed skip; lock left untouched"
    write_status unknown unknown unknown true unknown unknown "$LOCK_STREAK" \
      "$DEPLOY_LOCK_STATE" "$DEPLOY_LOCK_REASON"
    exit 0
    ;;
  DEAD|STALE|MALFORMED)
    wd_alert critical "DEPLOY_LOCK_$DEPLOY_LOCK_STATE" \
      "deploy lock is $DEPLOY_LOCK_STATE ($DEPLOY_LOCK_REASON); continuing all checks; lock left untouched"
    ;;
  ABSENT) : ;;
esac

# --- app liveness -------------------------------------------------------------------
LIVE=false READY=false
STREAK="$LOCK_STREAK"

if http_ok "${HEALTH_BASE}${LIVE_PATH}"; then
  LIVE=true
  STREAK=0
else
  STREAK=$((STREAK + 1))
  ops_log "live check failed (consecutive: $STREAK/$LIVE_FAIL_THRESHOLD)"
  if [ "$STREAK" -ge "$LIVE_FAIL_THRESHOLD" ]; then
    RECENT="$(count_recent "$APP_RESTARTS" "$RESTART_WINDOW_SEC")"
    if [ "$RECENT" -lt "$MAX_RESTARTS_PER_WINDOW" ]; then
      wd_alert critical APP_RESTARTED "live gate failed ${STREAK}x; restarting $APP_UNIT (restart $((RECENT + 1))/$MAX_RESTARTS_PER_WINDOW in window)"
      # Part 4 #5: once StartLimitBurst latches, every systemctl restart fails
      # until reset-failed clears the latch; and a FAILED restart must not
      # consume restart budget or clear the streak - that would credit the
      # watchdog with a recovery it did not achieve.
      "$SYSTEMCTL" reset-failed "$APP_UNIT" >/dev/null 2>&1 || true
      if "$SYSTEMCTL" restart "$APP_UNIT"; then
        now_epoch >> "$APP_RESTARTS"
        STREAK=0
      else
        wd_alert critical APP_RESTART_FAILED "systemctl restart $APP_UNIT failed"
      fi
    else
      wd_alert critical RESTART_BUDGET_EXHAUSTED "live gate still failing but $RECENT restarts already made in ${RESTART_WINDOW_SEC}s window; operator required"
    fi
  fi
fi
printf '%s\n' "$STREAK" > "$STREAK_FILE"

# --- app readiness (alert-only by design) -------------------------------------------
if [ "$LIVE" = true ]; then
  if http_ok "${HEALTH_BASE}${READY_PATH}"; then
    READY=true
  else
    wd_alert warning APP_NOT_READY "process alive but $READY_PATH failing; NOT restarting (restart cannot fix degraded inputs and may destroy recovery state)"
  fi
fi

# --- tunnel ----------------------------------------------------------------------------
TUNNEL=false
if "$SYSTEMCTL" is-active "$TUNNEL_UNIT" >/dev/null 2>&1; then
  TUNNEL=true
else
  wd_alert critical TUNNEL_DOWN "$TUNNEL_UNIT is not active; operator boundary is offline (shown, not hidden)"
  if [ "$WATCHDOG_RESTART_TUNNEL" = 1 ]; then
    RECENT="$(count_recent "$TUNNEL_RESTARTS" "$RESTART_WINDOW_SEC")"
    if [ "$RECENT" -lt "$MAX_RESTARTS_PER_WINDOW" ]; then
      wd_alert warning TUNNEL_RESTARTED "restarting $TUNNEL_UNIT (restart $((RECENT + 1))/$MAX_RESTARTS_PER_WINDOW in window)"
      "$SYSTEMCTL" restart "$TUNNEL_UNIT" || wd_alert critical TUNNEL_RESTART_FAILED "systemctl restart $TUNNEL_UNIT failed"
      now_epoch >> "$TUNNEL_RESTARTS"
    else
      wd_alert critical TUNNEL_RESTART_BUDGET_EXHAUSTED "$TUNNEL_UNIT still down; restart budget spent; operator required"
    fi
  fi
fi

# --- frozen deployment stays loud until an operator acts ------------------------------
FROZEN=false
if [ -e "$FROZEN_MARKER" ]; then
  FROZEN=true
  wd_alert critical DEPLOY_FROZEN "deploy-frozen marker present at $FROZEN_MARKER; deployment is halted pending incident handling"
fi

# --- backup freshness (§23 backup stale) ------------------------------------------------
BACKUP_FRESH=unknown
if [ -n "$BACKUP_DIR" ]; then
  if BACKUP_MAX_AGE_HOURS="$BACKUP_MAX_AGE_HOURS" BACKUP_DIR="$BACKUP_DIR" \
      "$SCRIPT_DIR/backup.sh" --verify-latest >/dev/null 2>&1; then
    BACKUP_FRESH=true
  else
    BACKUP_FRESH=false
    if [ -n "$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z' || true)" ]; then
      wd_alert warning BACKUP_STALE "newest backup in $BACKUP_DIR is older than ${BACKUP_MAX_AGE_HOURS}h"
    else
      wd_alert warning BACKUP_MISSING "no completed backup exists in $BACKUP_DIR"
    fi
  fi
fi

write_status "$LIVE" "$READY" "$TUNNEL" false "$FROZEN" "$BACKUP_FRESH" "$STREAK" \
  "$DEPLOY_LOCK_STATE" "$DEPLOY_LOCK_REASON"
exit 0
