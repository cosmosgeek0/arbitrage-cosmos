#!/usr/bin/env bash
# I00 verification adapter for the accepted L15 isolated restore owner.
# It never targets DATA_DIR and never performs a production database swap.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
I00_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"
BACKUP="" TARGET="" ENV_FILE="" AUTHORIZATION="" TARGET_HOST="" TARGET_ENVIRONMENT="" TARGET_ACCOUNT="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" SIMULATION_ROOT="" SIMULATION=0
OPERATOR="" DEPLOYED_SHA="" CONFIG_VERSION="" RISK_VERSION="" AUTHORIZATION_NONCE="" SERVER_PREVIEW_DIGEST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP="${2:?--backup needs a value}"; shift 2 ;;
    --target) TARGET="${2:?--target needs a value}"; shift 2 ;;
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
[ -n "$BACKUP" ] && [ -n "$TARGET" ] && [ -n "$ENV_FILE" ] \
  || { printf 'I00_OPS_BLOCKED: --backup, --target, and --env-file are required\n' >&2; exit 1; }
if [ "$SIMULATION" = 1 ]; then
  [ -n "$SIMULATION_ROOT" ] || { printf 'I00_OPS_BLOCKED: simulation restore requires a marked --simulation-root\n' >&2; exit 1; }
  node "$SCRIPT_DIR/validate-simulation-root.mjs" --root "$SIMULATION_ROOT" >/dev/null
else
  [ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$DEPLOYED_SHA" ] && [ -n "$CONFIG_VERSION" ] \
    && [ -n "$RISK_VERSION" ] && [ -n "$AUTHORIZATION_NONCE" ] && [ -n "$SERVER_PREVIEW_DIGEST" ] \
    && [ -n "$TARGET_HOST" ] && [ -n "$TARGET_ENVIRONMENT" ] && [ -n "$TARGET_ACCOUNT" ] \
    && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
    || { printf 'I00_OPS_BLOCKED: real isolated restore requires exact independent authorization expectations, target identity, and receipt targets\n' >&2; exit 1; }
fi
[ -x "$DONOR_ROOT/bin/restore.sh" ] || { printf 'I00_OPS_BLOCKED: effective L15 restore.sh is unavailable\n' >&2; exit 1; }
node "$SCRIPT_DIR/verify-donor.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" --contract-only >/dev/null
node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
  --root "$DONOR_ROOT" --require-immutable >/dev/null

SANITIZED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/i00-restore-verify.XXXXXX")"
chmod 700 "$SANITIZED_DIR"
DELEGATE_ENV="$SANITIZED_DIR/restore.env"
node "$SCRIPT_DIR/sanitize-donor-env.mjs" --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile backup >/dev/null
# The sanitizer emits only single-quoted, closed-profile scalar assignments.
# shellcheck disable=SC1090
. "$DELEGATE_ENV"
: "${SQLITE:=sqlite3}"
: "${NODE:=node}"
DELEGATE_ENV_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
if [ "$SIMULATION" = 1 ]; then
  for path in "$DATA_DIR" "$BACKUP_DIR" "$OPS_STATE_DIR" "$BACKUP" "$TARGET"; do node "$SCRIPT_DIR/validate-simulation-path.mjs" --root "$SIMULATION_ROOT" --path "$path" >/dev/null; done
else
  AUTH_BASE=(--input "$AUTHORIZATION" --class ISOLATED_RESTORE --command restore-drill-verify --expected-operator "$OPERATOR" --expected-deployed-sha "$DEPLOYED_SHA" --expected-config-version "$CONFIG_VERSION" --expected-risk-version "$RISK_VERSION" --expected-nonce "$AUTHORIZATION_NONCE" --expected-server-preview-digest "$SERVER_PREVIEW_DIGEST" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-isolated-restore --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 isolated restore drill" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission filesystem:CreateExactIsolatedRestore --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "restore and verify one exact backup into one exact isolated target")
  node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" \
    --expected-endpoint "donor-env-sha256:$DELEGATE_ENV_SHA" \
    --expected-endpoint "backup-path:$(cd "$BACKUP" && pwd -P)" \
    --expected-endpoint "isolated-target:$TARGET" \
    --expected-endpoint "sqlite-command:$SQLITE" >/dev/null
fi
trap 'rm -rf "$SANITIZED_DIR"' EXIT
node "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$($SQLITE --version)" >/dev/null
canonical_future_path() {
  "$NODE" -e '
    const fs=require("fs"),p=require("path");
    let cursor=p.resolve(process.argv[1]); const suffix=[];
    while (!fs.existsSync(cursor)) {
      const parent=p.dirname(cursor);
      if (parent === cursor) process.exit(2);
      suffix.unshift(p.basename(cursor)); cursor=parent;
    }
    const ancestor=fs.realpathSync(cursor);
    process.stdout.write(p.resolve(ancestor, ...suffix));
  ' "$1"
}
DATA_CANON="$(canonical_future_path "$DATA_DIR")"
TARGET_CANON="$(canonical_future_path "$TARGET")"
case "$TARGET_CANON" in
  "$DATA_CANON"|"$DATA_CANON"/*)
    printf 'I00_OPS_BLOCKED: restore verification target must be isolated from DATA_DIR\n' >&2
    exit 2
    ;;
esac
[ ! -e "$TARGET" ] || [ -z "$(ls -A "$TARGET" 2>/dev/null)" ] \
  || { printf 'I00_OPS_BLOCKED: isolated restore target must be absent or empty\n' >&2; exit 1; }

NODE_BIN="$(command -v node)"
env -i PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME=/ TMPDIR=/tmp NODE="$NODE_BIN" \
  "$DONOR_ROOT/bin/restore.sh" --backup "$BACKUP" --target "$TARGET" --env-file "$DELEGATE_ENV"
[ "$($SQLITE "$TARGET/cosmos.db" 'PRAGMA integrity_check;')" = "ok" ] \
  || { printf 'I00_OPS_BLOCKED: isolated restore integrity_check failed\n' >&2; exit 1; }
[ -z "$($SQLITE "$TARGET/cosmos.db" 'PRAGMA foreign_key_check;')" ] \
  || { printf 'I00_OPS_BLOCKED: isolated restore foreign_key_check failed\n' >&2; exit 1; }

printf '{"status":"ISOLATED_RESTORE_VERIFIED_NO_PRODUCTION_MUTATION","target":"%s"}\n' "$TARGET_CANON"
