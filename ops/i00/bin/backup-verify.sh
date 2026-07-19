#!/usr/bin/env bash
# Delegate backup creation to L15, then add the I00 SQLite version and full
# integrity/foreign-key acceptance gates.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
I00_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"
ENV_FILE="" AUTHORIZATION="" TARGET_HOST="" TARGET_ENVIRONMENT="" TARGET_ACCOUNT="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" SIMULATION_ROOT="" SIMULATION=0
OPERATOR="" DEPLOYED_SHA="" CONFIG_VERSION="" RISK_VERSION="" AUTHORIZATION_NONCE="" SERVER_PREVIEW_DIGEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
    --operator) OPERATOR="${2:?--operator needs a value}"; shift 2 ;;
    --deployed-sha) DEPLOYED_SHA="${2:?--deployed-sha needs a value}"; shift 2 ;;
    --config-version) CONFIG_VERSION="${2:?--config-version needs a value}"; shift 2 ;;
    --risk-version) RISK_VERSION="${2:?--risk-version needs a value}"; shift 2 ;;
    --authorization-nonce) AUTHORIZATION_NONCE="${2:?--authorization-nonce needs a value}"; shift 2 ;;
    --server-preview-digest) SERVER_PREVIEW_DIGEST="${2:?--server-preview-digest needs a value}"; shift 2 ;;
    --host) TARGET_HOST="${2:?--host needs a value}"; shift 2 ;;
    --environment) TARGET_ENVIRONMENT="${2:?--environment needs a value}"; shift 2 ;;
    --account) TARGET_ACCOUNT="${2:?--account needs a value}"; shift 2 ;;
    --result-receipt) RESULT_RECEIPT="${2:?--result-receipt needs a value}"; shift 2 ;;
    --reconciliation-receipt) RECONCILIATION_RECEIPT="${2:?--reconciliation-receipt needs a value}"; shift 2 ;;
    --simulation-root) SIMULATION_ROOT="${2:?--simulation-root needs a value}"; shift 2 ;;
    --simulation) SIMULATION=1; shift ;;
    *) printf 'I00_OPS_BLOCKED: unknown argument %s\n' "$1" >&2; exit 1 ;;
  esac
done
[ -n "$ENV_FILE" ] || { printf 'I00_OPS_BLOCKED: --env-file is required\n' >&2; exit 1; }
if [ "$SIMULATION" = 1 ]; then
  [ -n "$SIMULATION_ROOT" ] || { printf 'I00_OPS_BLOCKED: simulation backup requires a marked --simulation-root\n' >&2; exit 1; }
  node "$SCRIPT_DIR/validate-simulation-root.mjs" --root "$SIMULATION_ROOT" >/dev/null
else
  [ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$DEPLOYED_SHA" ] && [ -n "$CONFIG_VERSION" ] \
    && [ -n "$RISK_VERSION" ] && [ -n "$AUTHORIZATION_NONCE" ] && [ -n "$SERVER_PREVIEW_DIGEST" ] \
    && [ -n "$TARGET_HOST" ] && [ -n "$TARGET_ENVIRONMENT" ] && [ -n "$TARGET_ACCOUNT" ] \
    && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
    || { printf 'I00_OPS_BLOCKED: real backup requires exact independent authorization expectations, target identity, and receipt targets\n' >&2; exit 1; }
fi
[ -x "$DONOR_ROOT/bin/backup.sh" ] || { printf 'I00_OPS_BLOCKED: effective L15 backup.sh is unavailable\n' >&2; exit 1; }
node "$SCRIPT_DIR/verify-donor.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" --contract-only >/dev/null
node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
  --root "$DONOR_ROOT" --require-immutable >/dev/null

SANITIZED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/i00-backup-verify.XXXXXX")"
chmod 700 "$SANITIZED_DIR"
DELEGATE_ENV="$SANITIZED_DIR/backup.env"
node "$SCRIPT_DIR/sanitize-donor-env.mjs" --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile backup >/dev/null
# The sanitizer emits only single-quoted, closed-profile scalar assignments.
# shellcheck disable=SC1090
. "$DELEGATE_ENV"
: "${SQLITE:=sqlite3}"
DELEGATE_ENV_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
if [ "$SIMULATION" = 1 ]; then
  for path in "$DATA_DIR" "$BACKUP_DIR" "$OPS_STATE_DIR"; do node "$SCRIPT_DIR/validate-simulation-path.mjs" --root "$SIMULATION_ROOT" --path "$path" >/dev/null; done
  if [ -n "${EVIDENCE_PATHS:-}" ]; then
    OLD_IFS="$IFS"; IFS=':'
    for path in $EVIDENCE_PATHS; do node "$SCRIPT_DIR/validate-simulation-path.mjs" --root "$SIMULATION_ROOT" --path "$path" >/dev/null; done
    IFS="$OLD_IFS"
  fi
else
  AUTH_BASE=(--input "$AUTHORIZATION" --class BACKUP_CREATE --command backup-verify --expected-operator "$OPERATOR" --expected-deployed-sha "$DEPLOYED_SHA" --expected-config-version "$CONFIG_VERSION" --expected-risk-version "$RISK_VERSION" --expected-nonce "$AUTHORIZATION_NONCE" --expected-server-preview-digest "$SERVER_PREVIEW_DIGEST" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-backup --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 state backup" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission filesystem:CreateExactCosmosBackup --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "create and verify one exact database evidence and model backup")
  node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" \
    --expected-endpoint "donor-env-sha256:$DELEGATE_ENV_SHA" \
    --expected-endpoint "data-dir:$DATA_DIR" \
    --expected-endpoint "backup-dir:$BACKUP_DIR" \
    --expected-endpoint "sqlite-command:$SQLITE" >/dev/null
fi
node "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$($SQLITE --version)" >/dev/null
BEFORE="$(mktemp "${TMPDIR:-/tmp}/i00-backup-before.XXXXXX")"
AFTER="$(mktemp "${TMPDIR:-/tmp}/i00-backup-after.XXXXXX")"
trap 'rm -f "$BEFORE" "$AFTER"; rm -rf "$SANITIZED_DIR"' EXIT
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z*' -print 2>/dev/null | LC_ALL=C sort > "$BEFORE"
NODE_BIN="$(command -v node)"
env -i PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME=/ TMPDIR=/tmp NODE="$NODE_BIN" \
  "$DONOR_ROOT/bin/backup.sh" --env-file "$DELEGATE_ENV"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z*' -print 2>/dev/null | LC_ALL=C sort > "$AFTER"
NEW_BACKUPS="$(comm -13 "$BEFORE" "$AFTER")"
[ "$(printf '%s\n' "$NEW_BACKUPS" | grep -c . || true)" = 1 ] \
  || { printf 'I00_OPS_BLOCKED: L15 backup must publish exactly one new completed backup\n' >&2; exit 1; }
LATEST="$NEW_BACKUPS"
[ "$($SQLITE "$LATEST/cosmos.db" 'PRAGMA integrity_check;')" = "ok" ] \
  || { printf 'I00_OPS_BLOCKED: full SQLite integrity_check failed\n' >&2; exit 1; }
[ -z "$($SQLITE "$LATEST/cosmos.db" 'PRAGMA foreign_key_check;')" ] \
  || { printf 'I00_OPS_BLOCKED: SQLite foreign_key_check failed\n' >&2; exit 1; }
printf '{"status":"BACKUP_VERIFIED","backupPath":"%s"}\n' "$LATEST"
