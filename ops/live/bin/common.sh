#!/usr/bin/env bash
# ops/live/bin/common.sh — shared helpers for the cosmos deployment artifacts.
#
# Contract for every script that sources this file:
#   - bash 3.2 compatible (macOS test hosts) and Linux/systemd production hosts;
#   - zero network access except loopback health probes driven by the caller;
#   - every side-effecting external command is injectable via environment
#     (SYSTEMCTL, CURL, NODE, SQLITE) so ops/tests can exercise the full logic
#     on a laptop with mocks — never against real systemd/AWS/Cloudflare;
#   - no secrets are ever read, printed, or logged by these helpers.

if [ -n "${_COSMOS_COMMON_LOADED:-}" ]; then return 0; fi
_COSMOS_COMMON_LOADED=1

set -u

: "${NODE:=node}"
: "${CURL:=curl}"
: "${SYSTEMCTL:=systemctl}"
: "${SQLITE:=sqlite3}"
: "${OPS_LOG_TAG:=cosmos-ops}"
: "${HTTP_TIMEOUT_SEC:=5}"
: "${LOCK_TIMEOUT_SEC:=30}"

now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_epoch() { date -u +%s; }
now_stamp() { date -u +%Y%m%dT%H%M%SZ; }

ops_log() { printf '%s [%s] %s\n' "$(now_utc)" "$OPS_LOG_TAG" "$*" >&2; }
ops_die() { ops_log "FATAL: $*"; exit "${_DIE_CODE:-1}"; }
die_code() { _DIE_CODE="$1"; shift; ops_die "$@"; }

# Load shell-safe KEY=VALUE lines from an env file. Missing --env-file is an
# error (a typo must not silently fall back to defaults); no argument is fine.
load_env_file() {
  local f="${1:-}"
  [ -n "$f" ] || return 0
  [ -f "$f" ] || die_code 1 "env file not found: $f"
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die_code 1 "required command missing: $c"
  done
}

# Shared filesystem layout. Every path is overridable so tests run in a
# sandbox and so a future host relayout is a config change, not a code edit.
cosmos_layout_defaults() {
  : "${COSMOS_ROOT:=/opt/cosmos}"
  : "${RELEASES_DIR:=$COSMOS_ROOT/releases}"
  : "${CURRENT_LINK:=$COSMOS_ROOT/current}"
  : "${PREVIOUS_LINK:=$COSMOS_ROOT/previous}"
  : "${DATA_DIR:=/var/lib/cosmos/data}"
  : "${OPS_STATE_DIR:=/var/lib/cosmos/ops}"
  : "${APP_UNIT:=cosmos-app.service}"
  : "${TUNNEL_UNIT:=cloudflared.service}"
  : "${HEALTH_BASE:=http://127.0.0.1:8080}"
  : "${DEPLOY_LOCK:=$OPS_STATE_DIR/locks/deploy.lock}"
  : "${DEPLOY_LOG:=$OPS_STATE_DIR/deploy-log.jsonl}"
  : "${FROZEN_MARKER:=$OPS_STATE_DIR/deploy-frozen.json}"
  : "${MONEY_READY_MARKER:=$OPS_STATE_DIR/money-ready}"
  JOURNAL_FILE="$DATA_DIR/journal-compat.json"
}

# --- locking (mkdir-based; flock(1) does not exist on macOS test hosts) -----
acquire_lock() {
  local dir="$1"
  local deadline=$(( $(now_epoch) + LOCK_TIMEOUT_SEC ))
  mkdir -p "$(dirname "$dir")"
  while :; do
    if mkdir "$dir" 2>/dev/null; then
      printf '%s\n' "$$" > "$dir/pid"
      return 0
    fi
    local owner
    owner="$(cat "$dir/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      ops_log "removing stale lock $dir (owner pid $owner is gone)"
      rm -rf "$dir"
      continue
    fi
    if [ "$(now_epoch)" -ge "$deadline" ]; then
      return 1
    fi
    sleep 1
  done
}
release_lock() { rm -rf "$1"; }

# --- hashing / JSON ----------------------------------------------------------
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# json_get FILE DOTTED.KEY — prints the scalar value; exits 3 when missing.
json_get() {
  "$NODE" -e '
    const fs = require("fs");
    const [file, key] = process.argv.slice(1);
    let v = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const part of key.split(".")) { v = v == null ? undefined : v[part]; }
    if (v === undefined || v === null) process.exit(3);
    process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
  ' "$1" "$2"
}

# json_write FILE KEY=VALUE...  VALUE is parsed as JSON when possible
# (numbers, booleans), otherwise stored as a string.
json_write() {
  local file="$1"; shift
  mkdir -p "$(dirname "$file")"
  "$NODE" -e '
    const fs = require("fs");
    const file = process.argv[1];
    const obj = {};
    for (const pair of process.argv.slice(2)) {
      const i = pair.indexOf("=");
      const k = pair.slice(0, i);
      const raw = pair.slice(i + 1);
      let v;
      try { v = JSON.parse(raw); } catch { v = raw; }
      obj[k] = v;
    }
    fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
  ' "$file" "$@"
}

# jsonl_append FILE KEY=VALUE... — one structured log line, appended.
jsonl_append() {
  local file="$1"; shift
  mkdir -p "$(dirname "$file")"
  "$NODE" -e '
    const fs = require("fs");
    const file = process.argv[1];
    const obj = {};
    for (const pair of process.argv.slice(2)) {
      const i = pair.indexOf("=");
      let v; const raw = pair.slice(i + 1);
      try { v = JSON.parse(raw); } catch { v = raw; }
      obj[pair.slice(0, i)] = v;
    }
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  ' "$file" "$@"
}

# Resolve to a canonical absolute path even when the path is not on disk yet
# (falls back from realpath to path.resolve). Used for production-path guards.
canonical_path() {
  "$NODE" -e '
    const fs = require("fs"), path = require("path");
    const p = path.resolve(process.argv[1]);
    let out = p;
    try { out = fs.realpathSync(p); } catch { /* not on disk yet */ }
    process.stdout.write(out);
  ' "$1"
}

# --- atomic symlink swap -----------------------------------------------------
# rename(2) replaces the destination link atomically and does not dereference
# it. BSD `mv` has no -T and would move INTO a dir symlink, so node does the
# rename portably (node is a hard dependency of the app anyway).
atomic_symlink() {
  local target="$1" link="$2" tmp
  tmp="${link}.tmp.$$"
  rm -f "$tmp"
  ln -s "$target" "$tmp"
  "$NODE" -e 'require("fs").renameSync(process.argv[1], process.argv[2])' "$tmp" "$link" \
    || { rm -f "$tmp"; return 1; }
}

# Refuse to operate on a link path that exists but is not a symlink — a dirty
# host (leftover real directory at /opt/cosmos/current) must fail loudly
# before any mutation, never be silently replaced.
assert_link_sane() {
  local link="$1"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    die_code 1 "refusing: $link exists and is not a symlink (dirty target host)"
  fi
}

# --- loopback health gate ----------------------------------------------------
http_ok() { "$CURL" -fsS -m "$HTTP_TIMEOUT_SEC" -o /dev/null "$1" 2>/dev/null; }

# gate_wait BASE "PATH PATH..." TIMEOUT_SEC [GUARD_PID]
# Every path must answer 2xx before the deadline. If GUARD_PID dies first,
# fail fast instead of polling a corpse until timeout.
gate_wait() {
  local base="$1" paths="$2" timeout="$3" guard="${4:-}"
  local deadline=$(( $(now_epoch) + timeout )) p
  for p in $paths; do
    while ! http_ok "${base}${p}"; do
      if [ -n "$guard" ] && ! kill -0 "$guard" 2>/dev/null; then
        ops_log "gate: guarded process $guard exited before ${base}${p} became healthy"
        return 1
      fi
      if [ "$(now_epoch)" -ge "$deadline" ]; then
        ops_log "gate: timeout waiting for ${base}${p}"
        return 1
      fi
      sleep 0.5
    done
    ops_log "gate: ${base}${p} healthy"
  done
}

# --- exposure state (§24.2 auto-rollback authority) --------------------------
# EXPOSURE_CMD is an external command that prints one of:
#   NONE | ACTIVE | AMBIGUOUS | RECOVERY_REQUIRED | UNKNOWN
# Anything else, any failure, or no command configured collapses to UNKNOWN,
# which is the freeze-safe answer: automation may only act on literal NONE.
get_exposure() {
  local out
  if [ -z "${EXPOSURE_CMD:-}" ]; then echo UNKNOWN; return 0; fi
  if out="$($EXPOSURE_CMD 2>/dev/null)"; then
    case "$out" in
      NONE|ACTIVE|AMBIGUOUS|RECOVERY_REQUIRED|UNKNOWN) echo "$out" ;;
      *) echo UNKNOWN ;;
    esac
  else
    echo UNKNOWN
  fi
}

# --- alerting ----------------------------------------------------------------
# alert SEVERITY CODE MESSAGE — routed through the injectable ALERT_CMD
# (default: structured stderr log). Alerting must never crash the caller.
alert() {
  local cmd="${ALERT_CMD:-}"
  if [ -n "$cmd" ]; then
    "$cmd" "$1" "$2" "$3" || ops_log "alert command failed for $2"
  else
    ops_log "ALERT [$1] $2: $3"
  fi
}
