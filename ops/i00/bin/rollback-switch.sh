#!/usr/bin/env bash
# I00 adapter: enforce final rollback preflight, then delegate to L15 rollback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
I00_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"

RELEASE="" ENV_FILE="" RUNTIME_ENV="" HOST="" SUPERVISOR="" AUTHORIZATION="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" EVIDENCE_ROOT="" NOW="" SIMULATION_ROOT="" SIMULATION=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:?--release needs a value}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?--env-file needs a value}"; shift 2 ;;
    --runtime-env) RUNTIME_ENV="${2:?--runtime-env needs a value}"; shift 2 ;;
    --host) HOST="${2:?--host needs a value}"; shift 2 ;;
    --supervisor) SUPERVISOR="${2:?--supervisor needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
    --result-receipt) RESULT_RECEIPT="${2:?--result-receipt needs a value}"; shift 2 ;;
    --reconciliation-receipt) RECONCILIATION_RECEIPT="${2:?--reconciliation-receipt needs a value}"; shift 2 ;;
    --evidence-root) EVIDENCE_ROOT="${2:?--evidence-root needs a value}"; shift 2 ;;
    --now) NOW="${2:?--now needs a value}"; shift 2 ;;
    --simulation-root) SIMULATION_ROOT="${2:?--simulation-root needs a value}"; shift 2 ;;
    --simulation) SIMULATION=1; shift ;;
    *) printf 'I00_OPS_BLOCKED: unknown argument %s\n' "$1" >&2; exit 1 ;;
  esac
done
[ -n "$RELEASE" ] && [ -n "$ENV_FILE" ] && [ -n "$RUNTIME_ENV" ] && [ -n "$HOST" ] && [ -n "$SUPERVISOR" ] \
  || { printf 'I00_OPS_BLOCKED: --release, --env-file, --runtime-env, --host, and --supervisor are required\n' >&2; exit 1; }
[ -x "$DONOR_ROOT/bin/rollback.sh" ] || { printf 'I00_OPS_BLOCKED: effective L15 rollback.sh is unavailable\n' >&2; exit 1; }

node "$SCRIPT_DIR/verify-donor.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" --contract-only >/dev/null
node "$SCRIPT_DIR/verify-donor-root.mjs" --contract "$I00_ROOT/donor-contract.json" \
  --amendment-contract "$I00_ROOT/l15-amendment-contract.json" \
  --root "$DONOR_ROOT" --require-immutable >/dev/null
CANDIDATE_SHA="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.testedSha)' "$RELEASE/release.json")"
node "$SCRIPT_DIR/validate-config.mjs" --env "$RUNTIME_ENV" --expected-sha "$CANDIDATE_SHA" >/dev/null
if [ "$SIMULATION" = 1 ]; then
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" --allow-simulation >/dev/null
else
  node "$SCRIPT_DIR/validate-release.mjs" --release "$RELEASE" >/dev/null
fi
node "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.sqliteVersion)' "$HOST")" >/dev/null

if [ "$SIMULATION" = 1 ]; then
  [ -n "$NOW" ] && [ -n "$SIMULATION_ROOT" ] && [ -n "${SYSTEMCTL:-}" ] && [ -n "${CURL:-}" ] \
    || { printf 'I00_OPS_BLOCKED: simulation requires --now, --simulation-root, fake SYSTEMCTL, and fake CURL\n' >&2; exit 1; }
  SYSTEMCTL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SYSTEMCTL")"
  CURL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$CURL")"
  DELEGATE_ENV="$SIMULATION_ROOT/i00-sanitized-rollback-env.$$"
  node "$SCRIPT_DIR/validate-simulation-env.mjs" --env "$ENV_FILE" --root "$SIMULATION_ROOT" --output "$DELEGATE_ENV" >/dev/null
  mkdir -p "$SIMULATION_ROOT/home" "$SIMULATION_ROOT/tmp"
  EFFECTIVE_NOW="$NOW"
else
  [ -n "$AUTHORIZATION" ] && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] && [ -n "$EVIDENCE_ROOT" ] \
    || { printf 'I00_OPS_BLOCKED: real rollback requires authorization and exact result/reconciliation receipt targets\n' >&2; exit 1; }
  [ -z "$NOW" ] || { printf 'I00_OPS_BLOCKED: real rollback does not accept a caller clock\n' >&2; exit 1; }
  EFFECTIVE_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  TARGET_HOST="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.targetHost)' "$HOST")"
  TARGET_ENVIRONMENT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.environment)' "$HOST")"
  TARGET_ACCOUNT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.account)' "$HOST")"
  MANIFEST_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE/artifact-manifest.json")"
  TRUSTED_BUILD_KEY_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}")"
  AUTH_BASE=(--input "$AUTHORIZATION" --class SERVICE_ROLLBACK --command rollback-switch --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-rollback --expected-account "$TARGET_ACCOUNT" --expected-product "Cosmos I00 immutable release" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission systemd:RestartExactCosmosAppUnit --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "switch to one exact schema-compatible immutable rollback release and restart one exact application unit")
  for endpoint in "release-sha:$CANDIDATE_SHA" "artifact-manifest-sha256:$MANIFEST_SHA" "trusted-builder-public-key-sha256:$TRUSTED_BUILD_KEY_SHA" "release-path:$(cd "$RELEASE" && pwd -P)"; do
    node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-endpoint "$endpoint" >/dev/null
  done
  SANITIZED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/i00-rollback-switch.XXXXXX")"
  chmod 700 "$SANITIZED_DIR"
  DELEGATE_ENV="$SANITIZED_DIR/rollback.env"
  node "$SCRIPT_DIR/sanitize-donor-env.mjs" --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy >/dev/null
  DELEGATE_ENV_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
  node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" --expected-endpoint "donor-env-sha256:$DELEGATE_ENV_SHA" >/dev/null
fi
cleanup_delegate_env() {
  rm -f "${DELEGATE_ENV:-}"
  if [ -n "${SANITIZED_DIR:-}" ]; then rm -rf "$SANITIZED_DIR"; fi
}
trap cleanup_delegate_env EXIT
node "$SCRIPT_DIR/preflight.mjs" --release "$RELEASE" --host "$HOST" --supervisor "$SUPERVISOR" --mode rollback --now "$EFFECTIVE_NOW" --max-host-age-sec 120 --max-supervisor-age-sec 30 --required-supervisor-window-sec 300 >/dev/null

# The validated release identity is the exact target delegated to L15.
TARGET_ID="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.releaseId)' "$RELEASE/release.json")"
SAFE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="$(command -v node)"
set +e
if [ "$SIMULATION" = 1 ]; then
  env -i PATH="$SAFE_PATH" HOME="$SIMULATION_ROOT/home" TMPDIR="$SIMULATION_ROOT/tmp" NODE="$NODE_BIN" \
    SYSTEMCTL="$SYSTEMCTL" CURL="$CURL" \
    "$DONOR_ROOT/bin/rollback.sh" --to "$TARGET_ID" --env-file "$DELEGATE_ENV"
else
  env -i PATH="$SAFE_PATH" HOME=/ TMPDIR=/tmp NODE="$NODE_BIN" \
    "$DONOR_ROOT/bin/rollback.sh" --to "$TARGET_ID" --env-file "$DELEGATE_ENV"
fi
RESULT=$?
set -e
if [ "$RESULT" = 0 ] && [ "$SIMULATION" != 1 ]; then
  [ -f "$RECONCILIATION_RECEIPT" ] || { printf 'I00_OPS_BLOCKED: post-rollback reconciliation receipt is missing\n' >&2; RESULT=1; }
  if [ "$RESULT" = 0 ]; then node "$SCRIPT_DIR/validate-receipt.mjs" --input "$RESULT_RECEIPT" --kind ROLLBACK --evidence-root "$EVIDENCE_ROOT" >/dev/null || RESULT=1; fi
fi
cleanup_delegate_env
trap - EXIT
exit "$RESULT"
