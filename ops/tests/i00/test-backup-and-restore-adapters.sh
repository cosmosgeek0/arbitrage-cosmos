#!/usr/bin/env bash
set -euo pipefail
TEST_SELF="$(cd -P -- "$(dirname "$0")" && pwd -P)/$(basename "$0")"
if [ "$(uname -s)" = Linux ] \
    && [ "${DF32_ACTUAL_EFFECTS:-0}" = 1 ] \
    && [ "$(id -u)" = 0 ] \
    && [ "${DF32_EFFECT_REEXECED:-0}" != 1 ]; then
  [ -n "${DF32_SQLITE_BIN:-}" ] \
    || { printf 'NOT OK: actual effect proof requires DF32_SQLITE_BIN\n' >&2; exit 1; }
  [ -x /usr/bin/setpriv ] \
    || { printf 'NOT OK: actual effect proof requires /usr/bin/setpriv\n' >&2; exit 1; }
  EFFECT_TEST_UID="$(id -u cosmos 2>/dev/null)" \
    || { printf 'NOT OK: actual effect proof requires the cosmos user\n' >&2; exit 1; }
  EFFECT_TEST_GID="$(id -g cosmos 2>/dev/null)" \
    || { printf 'NOT OK: actual effect proof requires the cosmos group\n' >&2; exit 1; }
  [ "$EFFECT_TEST_UID" -gt 0 ] && [ "$EFFECT_TEST_GID" -gt 0 ] \
    || { printf 'NOT OK: actual effect proof requires positive effect identifiers\n' >&2; exit 1; }
  exec /usr/bin/setpriv \
    --reuid="$EFFECT_TEST_UID" --regid="$EFFECT_TEST_GID" \
    --clear-groups --inh-caps=-all --bounding-set=-all --nnp \
    /usr/bin/env -i \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    HOME=/tmp TMPDIR=/tmp \
    DF32_ACTUAL_EFFECTS=1 DF32_EFFECT_REEXECED=1 \
    DF32_SQLITE_BIN="$DF32_SQLITE_BIN" \
    /bin/bash "$TEST_SELF"
fi
. "$(dirname "$TEST_SELF")/helpers.sh"

BACKUP_WRAPPER="$I00_ROOT/bin/backup-verify.sh"
RESTORE_WRAPPER="$I00_ROOT/bin/restore-drill-verify.sh"
RISK_PRODUCER="$I00_ROOT/bin/produce-deployment-risk-version.mjs"
PREVIEW_PRODUCER="$I00_ROOT/bin/produce-deployment-action-preview.mjs"
OUTCOME_RECORDER="$I00_ROOT/bin/record-authorized-action-outcome.mjs"
FIXTURE_CONTRACT="$I00_ROOT/deployment-authorization-contract.mjs"
HOSTILE_CHAIN_FIXTURE="$TEST_DIR/fixtures/make-backup-effect-hostile-chain.mjs"

EFFECT_TEST_SOURCE="$(cat "$TEST_SELF")"
assert_contains "$EFFECT_TEST_SOURCE" \
  'DF32_SQLITE_BIN="$DF32_SQLITE_BIN"'
GLOBAL_SQLITE_SHADOW_PREFIX="$(printf '%s%s' 'PATH=/usr/' 'local/bin:')"
if printf '%s' "$EFFECT_TEST_SOURCE" \
    | grep -F "$GLOBAL_SQLITE_SHADOW_PREFIX" >/dev/null; then
  fail_test "actual effect proof globally shadows distro commands"
fi
pass_assertion

note "backup and restore wrappers retain one authorization-bound effect chain"
for wrapper in "$BACKUP_WRAPPER" "$RESTORE_WRAPPER"; do
  source_text="$(cat "$wrapper")"
  assert_eq "$(grep -c 'validate-authorization\.mjs' "$wrapper")" 1
  assert_eq "$(grep -c 'record-authorized-action-outcome\.mjs' "$wrapper")" 1
  assert_eq "$(grep -c 'run-bound-effect\.mjs' "$wrapper")" 1
  assert_eq "$(grep -c '"$NODE_PATH" "$BOUND_EFFECT_RUNNER"' "$wrapper")" 1
  assert_contains "$source_text" '--authorization "$AUTHORIZATION"'
  assert_contains "$source_text" '--deployment-risk "$DEPLOYMENT_RISK"'
  assert_contains "$source_text" '--action-preview "$ACTION_PREVIEW"'
  assert_contains "$source_text" '--authorization-consumption "$AUTHORIZATION_CONSUMPTION"'
  assert_contains "$source_text" '--i00-effect-environment "$DELEGATE_ENV"'
  assert_contains "$source_text" '--effect-start-evidence "$EFFECT_START_EVIDENCE"'
  assert_contains "$source_text" '--effect-finish-evidence "$EFFECT_FINISH_EVIDENCE"'
  assert_contains "$source_text" 'recorder_args+=(--simulation-clock)'
  if printf '%s' "$source_text" | grep -F 'effectFinishedAtUtc' >/dev/null; then
    fail_test "wrapper extracts terminal time before outcome recording: $wrapper"
  fi
  pass_assertion
  for forbidden in \
    'I00_EFFECT_CLASS=' \
    '--preflight' \
    '--authorization-expires-at-utc' \
    '--evidence-valid-until-utc' \
    '--receipt-reserve-sec' \
    '--uid ' \
    '--gid ' \
    '--program '
  do
    if printf '%s' "$source_text" | grep -F -- "$forbidden" >/dev/null; then
      fail_test "wrapper retains obsolete runner authority: $wrapper"
    fi
    pass_assertion
  done
done
assert_success node - "$BACKUP_WRAPPER" "$RESTORE_WRAPPER" <<'NODE'
const fs = require('node:fs');
for (const path of process.argv.slice(2)) {
  const source = fs.readFileSync(path, 'utf8');
  const runner = source.indexOf('"$NODE_PATH" "$BOUND_EFFECT_RUNNER"');
  const firstRecorder = source.indexOf('record_authorized_outcome ', runner);
  if (runner < 0 || firstRecorder < 0) process.exit(2);
  const rejectsTerminalExtraction = (candidate) => {
    const candidateRunner = candidate.indexOf('"$NODE_PATH" "$BOUND_EFFECT_RUNNER"');
    const candidateRecorder = candidate.indexOf('record_authorized_outcome ', candidateRunner);
    const terminalExtraction = candidate.indexOf('effectFinishedAtUtc', candidateRunner);
    return terminalExtraction >= 0 && terminalExtraction < candidateRecorder;
  };
  if (rejectsTerminalExtraction(source)) process.exit(3);
  const hostile = `${source.slice(0, firstRecorder)
  }effectFinishedAtUtc\n${source.slice(firstRecorder)}`;
  if (!rejectsTerminalExtraction(hostile)) process.exit(4);
}
NODE
RECORDER_SOURCE="$(cat "$OUTCOME_RECORDER")"
assert_contains "$RECORDER_SOURCE" \
  'terminalTestFallback: effect.terminal.document.effectFinishedAtUtc'
assert_contains "$RECORDER_SOURCE" \
  'if (args.now !== undefined) return exactUtcSeconds(args.now, label)'
for forbidden in snapshot_backups backup-before backup-after --primary-path --evidence-file; do
  if grep -F -- "$forbidden" "$BACKUP_WRAPPER" >/dev/null; then
    fail_test "backup wrapper retains pre-recorder artifact selection: $forbidden"
  fi
  pass_assertion
done
assert_contains "$(cat "$BACKUP_WRAPPER")" \
  'authorized backup rejects nonempty EVIDENCE_PATHS'
assert_contains "$(cat "$RESTORE_WRAPPER")" \
  'authorized restore rejects nonempty EVIDENCE_PATHS'

case "${DF32_ACTUAL_EFFECTS:-0}" in
  0|1) ;;
  *) fail_test "DF32_ACTUAL_EFFECTS must be exactly 0 or 1" ;;
esac
if [ "$(uname -s)" != Linux ] || [ "${DF32_ACTUAL_EFFECTS:-0}" != 1 ]; then
  finish
  exit 0
fi

note "actual Linux producers drive backup and isolated restore through the real runner"
[ -e /proc/self/fd ] || fail_test "actual effect proof requires procfs descriptors"
[ -n "${DF32_SQLITE_BIN:-}" ] \
  || fail_test "actual effect proof requires DF32_SQLITE_BIN"
DF32_SQLITE_INSPECTION="$(
  node "$I00_ROOT/bin/inspect-executable.mjs" --path "$DF32_SQLITE_BIN"
)"
assert_eq "$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).path)' \
  "$DF32_SQLITE_INSPECTION")" "$DF32_SQLITE_BIN"
assert_eq "$(node -e \
  'const fs=require("fs");process.stdout.write(String(fs.lstatSync(process.argv[1]).uid))' \
  "$DF32_SQLITE_BIN")" 0
DF32_SQLITE_VERSION="$("$DF32_SQLITE_BIN" --version)" \
  || fail_test "DF32_SQLITE_BIN version readback failed"
assert_eq "$(node "$I00_ROOT/bin/inspect-executable.mjs" \
  --path "$DF32_SQLITE_BIN")" "$DF32_SQLITE_INSPECTION"
assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" \
  --version "$DF32_SQLITE_VERSION"

REAL_TMP="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync("/tmp"))')"
SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$REAL_TMP/ip-ops-i00-sim-backup-restore-$$")"
cleanup_backup_test() {
  local rc="${1:-$?}"
  chmod -R u+rwX "$SIMULATION_ROOT" 2>/dev/null || true
  rm -rf "$SIMULATION_ROOT"
  cleanup_test_tmp "$rc"
}
trap cleanup_backup_test EXIT

AUTH_ROOT="$SIMULATION_ROOT/authorization"
CLAIM_ROOT="$SIMULATION_ROOT/consumption"
RECEIPT_ROOT="$SIMULATION_ROOT/receipts"
EFFECT_ROOT="$SIMULATION_ROOT/effects"
COMMAND_ROOT="$SIMULATION_ROOT/bin"
DATA_ROOT="$SIMULATION_ROOT/data"
BACKUP_ROOT="$SIMULATION_ROOT/backups"
OPS_STATE_ROOT="$SIMULATION_ROOT/ops-state"
RESTORE_PARENT="$SIMULATION_ROOT/restore-parent"
SANITIZED_ROOT="$SIMULATION_ROOT/sanitized"
mkdir -p "$AUTH_ROOT" "$CLAIM_ROOT" "$RECEIPT_ROOT" "$EFFECT_ROOT" \
  "$COMMAND_ROOT" "$DATA_ROOT" "$BACKUP_ROOT" "$OPS_STATE_ROOT" \
  "$RESTORE_PARENT" "$SANITIZED_ROOT" "$SIMULATION_ROOT/tmp" \
  "$SIMULATION_ROOT/evidence" "$SIMULATION_ROOT/models" \
  "$SIMULATION_ROOT/leases"
chmod 700 "$AUTH_ROOT" "$CLAIM_ROOT" "$RECEIPT_ROOT" "$EFFECT_ROOT" \
  "$COMMAND_ROOT" "$DATA_ROOT" "$BACKUP_ROOT" "$OPS_STATE_ROOT" \
  "$RESTORE_PARENT" "$SANITIZED_ROOT" "$SIMULATION_ROOT/tmp" \
  "$SIMULATION_ROOT/evidence" "$SIMULATION_ROOT/models" \
  "$SIMULATION_ROOT/leases"

copy_command() {
  local name="$1" source
  shift
  source=""
  for candidate in "$@"; do
    if [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ]; then
      source="$candidate"
      break
    fi
  done
  [ -n "$source" ] || fail_test "actual effect proof command is unavailable: $name"
  cp "$source" "$COMMAND_ROOT/$name"
  chmod 755 "$COMMAND_ROOT/$name"
}
BOOTSTRAP_NODE="$(command -v node)"
BOOTSTRAP_NODE="$(node -e \
  'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' \
  "$BOOTSTRAP_NODE")"
copy_command node "$BOOTSTRAP_NODE"
copy_command bash /bin/bash /usr/bin/bash
copy_command env /usr/bin/env /bin/env
copy_command tar /usr/bin/tar /bin/tar
copy_command gzip /usr/bin/gzip /bin/gzip
copy_command sha256sum /usr/bin/sha256sum /bin/sha256sum
copy_command setpriv /usr/bin/setpriv /bin/setpriv
copy_command sqlite3 "$DF32_SQLITE_BIN"

EFFECT_UID="$(id -u)"
EFFECT_GID="$(id -g)"
if [ "$EFFECT_UID" = 0 ]; then
  EFFECT_UID=65534
  EFFECT_GID=65534
fi
printf '%s\n' \
  '#!/bin/bash' \
  'set -eu' \
  '[ "$#" -eq 2 ] && [ "$1" = "-u" ] && [ "$2" = cosmos ] || exit 1' \
  "printf '%s\\n' '$EFFECT_UID'" \
  >"$COMMAND_ROOT/id"
printf '%s\n' \
  '#!/bin/bash' \
  'set -eu' \
  '[ "$#" -eq 2 ] && [ "$1" = group ] && [ "$2" = cosmos ] || exit 1' \
  "printf '%s\\n' 'cosmos:x:$EFFECT_GID:'" \
  >"$COMMAND_ROOT/getent"
chmod 755 "$COMMAND_ROOT/id" "$COMMAND_ROOT/getent"
BOUND_NODE="$COMMAND_ROOT/node"
BOUND_SQLITE="$COMMAND_ROOT/sqlite3"

materialize_effective_l15 "$SIMULATION_ROOT/donor"
DONOR_ROOT="$SIMULATION_ROOT/donor/ops/live"
chmod -R a-w "$DONOR_ROOT"

"$BOUND_SQLITE" "$DATA_ROOT/cosmos.db" \
  "PRAGMA journal_mode=WAL; CREATE TABLE events(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO events(payload) VALUES ('fixture-a'),('fixture-b');"
chmod 600 "$DATA_ROOT/cosmos.db"
if [ "$(id -u)" = 0 ]; then
  chown -R "$EFFECT_UID:$EFFECT_GID" \
    "$DATA_ROOT" "$BACKUP_ROOT" "$OPS_STATE_ROOT" "$RESTORE_PARENT"
fi

TESTED_SHA=0123456789abcdef0123456789abcdef01234567
CONFIG_VERSION=config-df32-linux-proof
RUNTIME_ENV="$SIMULATION_ROOT/runtime.env"
BACKUP_ENV="$SIMULATION_ROOT/backup.env"
HOST_EVIDENCE="$SIMULATION_ROOT/host-evidence.json"
HOST_READBACK="$SIMULATION_ROOT/host.json"
HOST_ACCOUNT=aws:123456789012
HOST_NAME=isolated-linux-proof.internal
HOST_ENVIRONMENT=isolated-linux-proof
ISSUED_AT="$("$BOUND_NODE" -e \
  'process.stdout.write(new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace(".000Z","Z"))')"
SQLITE_VERSION="$("$BOUND_SQLITE" --version)"
SQLITE_VERSION="${SQLITE_VERSION%%[[:space:]]*}"
"$BOUND_NODE" --input-type=module - "$FIXTURE_CONTRACT" \
  "$RUNTIME_ENV" "$BACKUP_ENV" "$HOST_EVIDENCE" "$HOST_READBACK" \
  "$SIMULATION_ROOT" "$TESTED_SHA" "$CONFIG_VERSION" "$ISSUED_AT" \
  "$HOST_ACCOUNT" "$HOST_NAME" "$HOST_ENVIRONMENT" "$SQLITE_VERSION" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [
  contractPath, runtimePath, backupPath, evidencePath, hostPath, root,
  testedSha, configVersion, observedAtUtc, account, host, environment,
  sqliteVersion,
] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)).href);
writeFileSync(runtimePath, [
  'HOST=127.0.0.1',
  'PORT=8601',
  `DATA_DIR=${resolve(root, 'data')}`,
  `DATA_DIR_LOGICAL_LEASE_ROOT=${resolve(root, 'leases')}`,
  `EVIDENCE_DIR=${resolve(root, 'evidence')}`,
  `MODEL_DIR=${resolve(root, 'models')}`,
  `BACKUP_DIR=${resolve(root, 'backups')}`,
  'CONTROL_ROOM_OPERATOR_EMAIL=operator@isolated.test',
  'CF_ACCESS_TEAM_DOMAIN=https://isolated-proof.cloudflareaccess.com',
  'CF_ACCESS_AUD=isolated_proof_audience',
  `I00_TESTED_SHA=${testedSha}`,
  `I00_DEPLOYED_SHA=${testedSha}`,
  `I00_CONFIG_REVISION=${configVersion}`,
  'I00_MODEL_REVISION=UNAVAILABLE',
  'I00_PUBLIC_SOURCE_STARTUP_EGRESS=1',
  '',
].join('\n'), { mode: 0o600 });
writeFileSync(backupPath, [
  `DATA_DIR=${resolve(root, 'data')}`,
  `BACKUP_DIR=${resolve(root, 'backups')}`,
  `OPS_STATE_DIR=${resolve(root, 'ops-state')}`,
  'BACKUP_RETENTION_COUNT=3',
  'BACKUP_MAX_AGE_HOURS=26',
  'EVIDENCE_PATHS=',
  'EVIDENCE_MISSING_POLICY=fail',
  `SQLITE=${resolve(root, 'bin', 'sqlite3')}`,
  '',
].join('\n'), { mode: 0o600 });
const evidenceBytes = canonicalJsonBytes({
  schemaVersion: 1,
  source: 'ISOLATED_LINUX_EFFECT_PROOF',
  observedAtUtc,
});
writeFileSync(evidencePath, evidenceBytes, { mode: 0o600 });
writeFileSync(hostPath, canonicalJsonBytes({
  source: 'TARGET_HOST_OWNER_READBACK',
  account,
  targetHost: host,
  environment,
  freeBytes: 1024 * 1024 * 1024,
  backupReserveBytes: 4096,
  sqliteVersion,
  evidenceSha256: createHash('sha256').update(readFileSync(evidencePath)).digest('hex'),
  observedAtUtc,
}), { mode: 0o600 });
NODE

json_value() {
  "$BOUND_NODE" -e '
    const fs=require("fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    let output=value;
    for(const key of process.argv[2].split(".")) output=output[key];
    process.stdout.write(String(output));
  ' "$1" "$2"
}

write_request() {
  local action_class="$1" request="$2" issued="$3" starts="$4" expires="$5"
  "$BOUND_NODE" --input-type=module - "$FIXTURE_CONTRACT" \
    "$request" "$action_class" "$RECEIPT_ROOT" "$issued" "$starts" "$expires" <<'NODE'
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [contractPath, output, actionClass, receiptRoot, issued, starts, expires] =
  process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)).href);
writeFileSync(output, canonicalJsonBytes({
  schemaVersion: 1,
  kind: 'DEPLOYMENT_ACTION_REQUEST',
  status: 'REQUESTED_NOT_AUTHORIZED',
  authorizationId: `df32-linux-${actionClass.toLowerCase().replaceAll('_', '-')}`,
  operator: 'isolated-linux-operator',
  approver: 'isolated-linux-proof-owner',
  approvalReference: 'isolated-linux-proof-approval',
  startsAtUtc: starts,
  expiresAtUtc: expires,
  receiptTargets: {
    result: resolve(receiptRoot, `${actionClass}.result.json`),
    reconciliation: resolve(receiptRoot, `${actionClass}.reconciliation.json`),
  },
}), { mode: 0o600 });
NODE
}

write_authorization() {
  local action_class="$1" risk="$2" preview="$3" output="$4"
  "$BOUND_NODE" --input-type=module - "$FIXTURE_CONTRACT" \
    "$risk" "$preview" "$output" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [contractPath, riskPath, previewPath, output] = process.argv.slice(2);
const { canonicalJsonBytes } = await import(pathToFileURL(resolve(contractPath)).href);
const risk = JSON.parse(readFileSync(riskPath, 'utf8'));
const preview = JSON.parse(readFileSync(previewPath, 'utf8'));
const action = preview.action;
const binding = preview.binding;
const window = preview.authorizationWindow;
writeFileSync(output, canonicalJsonBytes({
  schemaVersion: 2,
  authorizationId: binding.authorizationId,
  operator: binding.operator,
  status: 'APPROVED',
  actionClasses: [binding.actionClass],
  scope: action.scope,
  deployedSha: binding.deployedSha,
  configVersion: binding.configVersion,
  riskVersion: binding.riskVersion,
  nonce: binding.nonce,
  serverPreviewDigest: preview.serverPreviewDigest,
  account: binding.account,
  environment: binding.environment,
  host: binding.host,
  issuedAtUtc: window.issuedAtUtc,
  startsAtUtc: window.startsAtUtc,
  expiresAtUtc: window.expiresAtUtc,
  allowedCommands: [action.command],
  allowedEndpoints: action.allowedEndpoints,
  allowedProducts: action.allowedProducts,
  allowedCredentials: action.allowedCredentials,
  preconditions: action.preconditions,
  maximumEffect: action.maximumEffect,
  rollback: action.rollback,
  recovery: action.recovery,
  ownerApproval: {
    approver: binding.approver,
    approvedAtUtc: window.issuedAtUtc,
    reference: binding.approvalReference,
  },
  receiptTargets: action.receiptTargets,
}), { mode: 0o600 });
NODE
}

produce_chain() {
  local action_class="$1" backup_path="${2:-}" target_path="${3:-}"
  local now starts expires nonce request risk preview authorization
  now="$("$BOUND_NODE" -e \
    'process.stdout.write(new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace(".000Z","Z"))')"
  starts="$("$BOUND_NODE" -e \
    'process.stdout.write(new Date(Date.parse(process.argv[1])+5000).toISOString().replace(".000Z","Z"))' \
    "$now")"
  expires="$("$BOUND_NODE" -e \
    'process.stdout.write(new Date(Date.parse(process.argv[1])+3300000).toISOString().replace(".000Z","Z"))' \
    "$now")"
  nonce="$("$BOUND_NODE" -e \
    'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(process.argv.slice(1).join(":")).digest("hex"))' \
    "$action_class" "$now")"
  request="$AUTH_ROOT/$action_class.request.json"
  risk="$AUTH_ROOT/$action_class.risk.json"
  preview="$AUTH_ROOT/$action_class.preview.json"
  authorization="$AUTH_ROOT/$action_class.authorization.json"
  write_request "$action_class" "$request" "$now" "$starts" "$expires"
  local -a risk_args=(
    --request "$request"
    --class "$action_class"
    --host-readback "$HOST_READBACK"
    --host-evidence "$HOST_EVIDENCE"
    --runtime-env "$RUNTIME_ENV"
    --backup-env "$BACKUP_ENV"
    --output "$risk"
    --root-mode TEST
    --proof-root "$SIMULATION_ROOT"
    --simulation-clock
    --now "$now"
    --simulation-command-root "$COMMAND_ROOT"
    --simulation-donor-root "$DONOR_ROOT"
    --nonce "$nonce"
  )
  if [ "$action_class" = ISOLATED_RESTORE ]; then
    risk_args+=(--backup "$backup_path" --target "$target_path")
  fi
  "$BOUND_NODE" "$RISK_PRODUCER" "${risk_args[@]}" >/dev/null
  "$BOUND_NODE" "$PREVIEW_PRODUCER" \
    --deployment-risk "$risk" \
    --consumption-root "$CLAIM_ROOT" \
    --output "$preview" >/dev/null
  write_authorization "$action_class" "$risk" "$preview" "$authorization"
  assert_eq "$(json_value "$risk" status)" BOUND_NOT_AUTHORIZED
  assert_eq "$(json_value "$preview" status)" PREVIEW_READY_NOT_AUTHORIZED
}

wait_for_start() {
  "$BOUND_NODE" -e '
    const fs=require("fs");
    const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const delay=Math.max(0,Date.parse(value.startsAtUtc)-Date.now()+100);
    setTimeout(()=>{},delay);
  ' "$1"
}

wrapper_common_args() {
  local action_class="$1"
  local authorization="$AUTH_ROOT/$action_class.authorization.json"
  local preview="$AUTH_ROOT/$action_class.preview.json"
  COMMON_WRAPPER_ARGS=(
    --authorization "$authorization"
    --operator "$(json_value "$preview" binding.operator)"
    --deployed-sha "$(json_value "$preview" binding.deployedSha)"
    --config-version "$(json_value "$preview" binding.configVersion)"
    --deployment-risk "$AUTH_ROOT/$action_class.risk.json"
    --action-preview "$preview"
    --authorization-consumption-root "$CLAIM_ROOT"
    --host "$(json_value "$preview" binding.host)"
    --environment "$(json_value "$preview" binding.environment)"
    --account "$(json_value "$preview" binding.account)"
    --result-receipt "$(json_value "$preview" action.receiptTargets.result)"
    --reconciliation-receipt "$(json_value "$preview" action.receiptTargets.reconciliation)"
    --simulation
    --simulation-root "$SIMULATION_ROOT"
  )
}

produce_chain BACKUP_CREATE
wrapper_common_args BACKUP_CREATE
HOSTILE_BACKUP_ENV="$SIMULATION_ROOT/backup-hostile-evidence.env"
"$BOUND_NODE" -e '
  const fs=require("fs");
  const source=fs.readFileSync(process.argv[1],"utf8");
  const updated=source.replace(/^EVIDENCE_PATHS=$/mu,`EVIDENCE_PATHS=${process.argv[3]}`);
  if(updated===source)process.exit(1);
  fs.writeFileSync(process.argv[2],updated,{mode:0o600});
' "$BACKUP_ENV" "$HOSTILE_BACKUP_ENV" "$SIMULATION_ROOT/evidence"
assert_failure_contains 'authorized backup donor env EVIDENCE_PATHS must be empty' \
  env PATH="$COMMAND_ROOT:/usr/bin:/bin" DONOR_ROOT="$DONOR_ROOT" \
  "$BACKUP_WRAPPER" --env-file "$HOSTILE_BACKUP_ENV" "${COMMON_WRAPPER_ARGS[@]}"
assert_eq "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
assert_eq "$(find "$EFFECT_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 0
"$BOUND_NODE" - "$SANITIZED_ROOT" "$SIMULATION_ROOT" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [directory, root] = process.argv.slice(2);
const stat = fs.lstatSync(directory);
const entries = fs.readdirSync(directory).sort();
if (!stat.isDirectory() || stat.isSymbolicLink()
    || fs.realpathSync.native(directory) !== directory
    || path.dirname(directory) !== root || path.basename(directory) !== 'sanitized'
    || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700
    || entries.length !== 0) {
  process.exit(1);
}
fs.rmSync(directory, { recursive: true });
NODE
mkdir "$SANITIZED_ROOT"
chmod 700 "$SANITIZED_ROOT"

wait_for_start "$AUTH_ROOT/BACKUP_CREATE.authorization.json"
BACKUP_OUTPUT="$(env PATH="$COMMAND_ROOT:/usr/bin:/bin" DONOR_ROOT="$DONOR_ROOT" \
  "$BACKUP_WRAPPER" --env-file "$BACKUP_ENV" "${COMMON_WRAPPER_ARGS[@]}")"
BACKUP_JSON="$(printf '%s\n' "$BACKUP_OUTPUT" | tail -n 1)"
assert_contains "$BACKUP_JSON" BACKUP_VERIFIED
PUBLISHED_BACKUP="$("$BOUND_NODE" -e \
  'process.stdout.write(JSON.parse(process.argv[1]).backupPath)' "$BACKUP_JSON")"
assert_file "$PUBLISHED_BACKUP/manifest.json"
assert_file "$PUBLISHED_BACKUP/cosmos.db"
assert_eq "$("$BOUND_SQLITE" "$PUBLISHED_BACKUP/cosmos.db" 'PRAGMA integrity_check;')" ok
assert_eq "$("$BOUND_SQLITE" "$PUBLISHED_BACKUP/cosmos.db" 'SELECT COUNT(*) FROM events;')" 2
assert_eq "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 1
assert_file "$RECEIPT_ROOT/BACKUP_CREATE.result.json"
assert_file "$RECEIPT_ROOT/BACKUP_CREATE.reconciliation.json"

mkdir "$SANITIZED_ROOT"
chmod 700 "$SANITIZED_ROOT"
RESTORE_TARGET="$RESTORE_PARENT/restored"
produce_chain ISOLATED_RESTORE "$PUBLISHED_BACKUP" "$RESTORE_TARGET"
wrapper_common_args ISOLATED_RESTORE
wait_for_start "$AUTH_ROOT/ISOLATED_RESTORE.authorization.json"
RESTORE_OUTPUT="$(env PATH="$COMMAND_ROOT:/usr/bin:/bin" DONOR_ROOT="$DONOR_ROOT" \
  "$RESTORE_WRAPPER" --backup "$PUBLISHED_BACKUP" --target "$RESTORE_TARGET" \
  --env-file "$BACKUP_ENV" "${COMMON_WRAPPER_ARGS[@]}")"
RESTORE_JSON="$(printf '%s\n' "$RESTORE_OUTPUT" | tail -n 1)"
assert_contains "$RESTORE_JSON" ISOLATED_RESTORE_VERIFIED_NO_PRODUCTION_MUTATION
assert_file "$RESTORE_TARGET/restore-report.json"
assert_file "$RESTORE_TARGET/cosmos.db"
assert_eq "$("$BOUND_SQLITE" "$RESTORE_TARGET/cosmos.db" 'PRAGMA integrity_check;')" ok
assert_eq "$("$BOUND_SQLITE" "$RESTORE_TARGET/cosmos.db" 'SELECT COUNT(*) FROM events;')" 2
assert_eq "$(find "$CLAIM_ROOT" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" 2
assert_file "$RECEIPT_ROOT/ISOLATED_RESTORE.result.json"
assert_file "$RECEIPT_ROOT/ISOLATED_RESTORE.reconciliation.json"

note "actual Linux runner rejects every hostile backup output class"
mkdir "$SANITIZED_ROOT"
chmod 700 "$SANITIZED_ROOT"
"$BOUND_NODE" "$I00_ROOT/bin/sanitize-donor-env.mjs" \
  --env "$BACKUP_ENV" \
  --output "$SANITIZED_ROOT/backup.env" \
  --profile backup \
  --provenance-mode TEST \
  --provenance-root "$SIMULATION_ROOT" \
  --node "$BOUND_NODE" \
  --bash "$COMMAND_ROOT/bash" \
  --env-bin "$COMMAND_ROOT/env" \
  --sqlite "$BOUND_SQLITE" \
  --tar "$COMMAND_ROOT/tar" \
  --hash "$COMMAND_ROOT/sha256sum" \
  --require-effect-bindings \
  --require-hash >/dev/null
HOSTILE_SCRIPT_ROOT="$SIMULATION_ROOT/hostile-scripts"
mkdir "$HOSTILE_SCRIPT_ROOT"
chmod 700 "$HOSTILE_SCRIPT_ROOT"

write_hostile_backup_script() {
  local scenario="$1"
  local output="$HOSTILE_SCRIPT_ROOT/$scenario.sh"
  "$BOUND_NODE" - "$output" <<'NODE'
const fs = require('node:fs');
const output = process.argv[2];
fs.writeFileSync(output, `#!/bin/bash -p
set -euo pipefail
SCENARIO="\${0##*/}"
SCENARIO="\${SCENARIO%.sh}"
/proc/self/fd/16 - "$SCENARIO" "$_I00_AUTHORIZED_EFFECT_CLAIM_KEY" <<'INNER_NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [scenario, claimKey] = process.argv.slice(2);
const backupRoot = '/proc/self/fd/46';
const databaseSource = '/proc/self/fd/49/cosmos.db';
const scenarios = [
  'missing',
  'malformed',
  'duplicate',
  'oversize',
  'wrong-claim',
  'wrong-path',
  'symlink-output',
  'invalid-manifest',
  'database-mismatch',
  'extra-delta',
  'post-terminal-root-mutation',
];
const index = scenarios.indexOf(scenario);
if (index < 0 || !/^[0-9a-f]{64}$/u.test(claimKey)) process.exit(2);
const backupName = \`20300101T0000\${String(index + 1).padStart(2, '0')}Z\`;
const secondName = \`20300101T0100\${String(index + 1).padStart(2, '0')}Z\`;
const backupPath = path.join(backupRoot, backupName);
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};
const bytes = (value) => Buffer.from(
  \`\${JSON.stringify(canonical(value), null, 2)}\\n\`,
  'utf8',
);
const outputDocument = (name = backupName, claim = claimKey) => ({
  actionClass: 'BACKUP_CREATE',
  claimKey: claim,
  kind: 'I00_AUTHORIZED_EFFECT_OUTPUT',
  outputRelativePath: name,
  receiptRelativePath: \`\${name}/manifest.json\`,
  schemaVersion: 1,
  status: 'OUTPUT_REPORTED',
  writeRootName: 'backupDir',
});
const emit = (value) => {
  const outputBytes = Buffer.isBuffer(value) ? value : bytes(value);
  if (fs.writeSync(53, outputBytes) !== outputBytes.length) process.exit(2);
};
const createArtifact = ({ invalidManifest = false, mismatchedDatabase = false } = {}) => {
  fs.mkdirSync(backupPath, { mode: 0o700 });
  fs.copyFileSync(databaseSource, path.join(backupPath, 'cosmos.db'));
  fs.chmodSync(path.join(backupPath, 'cosmos.db'), 0o600);
  if (invalidManifest) {
    fs.writeFileSync(path.join(backupPath, 'manifest.json'), '{\\n', { mode: 0o600 });
    return;
  }
  const database = fs.readFileSync(path.join(backupPath, 'cosmos.db'));
  const digest = crypto.createHash('sha256').update(database).digest('hex');
  const manifest = {
    backupId: backupName,
    createdAtUtc: '2030-01-01T00:00:00Z',
    dataSchema: null,
    dbBytes: database.length,
    dbFile: 'cosmos.db',
    dbSha256: mismatchedDatabase ? '0'.repeat(64) : digest,
    eventsCount: 2,
    evidence: [],
    integrityCheck: 'ok',
  };
  fs.writeFileSync(
    path.join(backupPath, 'manifest.json'),
    bytes(manifest),
    { mode: 0o600 },
  );
};
switch (scenario) {
  case 'missing':
    break;
  case 'malformed':
    emit(Buffer.from('{\\n', 'utf8'));
    break;
  case 'duplicate': {
    const document = bytes(outputDocument());
    emit(Buffer.concat([document, document]));
    break;
  }
  case 'oversize':
    emit(Buffer.alloc(5000, 0x78));
    break;
  case 'wrong-claim':
    createArtifact();
    emit(outputDocument(
      backupName,
      claimKey === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64),
    ));
    break;
  case 'wrong-path':
    createArtifact();
    emit(outputDocument(secondName));
    break;
  case 'symlink-output':
    fs.symlinkSync('/proc/self/fd/49', backupPath);
    emit(outputDocument());
    break;
  case 'invalid-manifest':
    createArtifact({ invalidManifest: true });
    emit(outputDocument());
    break;
  case 'database-mismatch':
    createArtifact({ mismatchedDatabase: true });
    emit(outputDocument());
    break;
  case 'extra-delta':
    createArtifact();
    fs.mkdirSync(path.join(backupRoot, secondName), { mode: 0o700 });
    emit(outputDocument());
    break;
  case 'post-terminal-root-mutation':
    createArtifact();
    emit(outputDocument());
    break;
  default:
    process.exit(2);
}
INNER_NODE
`, { mode: 0o500 });
NODE
  chmod 500 "$output"
  printf '%s' "$output"
}

hostile_chain_value() {
  "$BOUND_NODE" -e '
    const fs=require("fs");
    const value=JSON.parse(process.argv[1]);
    process.stdout.write(String(value[process.argv[2]]));
  ' "$1" "$2"
}

run_hostile_backup_effect() {
  local scenario="$1" expected_output="$2"
  local script chain authorization risk preview consumption terminal result reconciliation
  local runner_rc terminal_status output_status
  script="$(write_hostile_backup_script "$scenario")"
  chain="$("$BOUND_NODE" "$HOSTILE_CHAIN_FIXTURE" \
    "$FIXTURE_CONTRACT" \
    "$SIMULATION_ROOT" \
    "$AUTH_ROOT/BACKUP_CREATE.risk.json" \
    "$scenario" \
    "$script")"
  authorization="$(hostile_chain_value "$chain" authorization)"
  risk="$(hostile_chain_value "$chain" risk)"
  preview="$(hostile_chain_value "$chain" preview)"
  consumption="$(hostile_chain_value "$chain" consumption)"
  terminal="$(hostile_chain_value "$chain" effectFinish)"
  result="$(hostile_chain_value "$chain" result)"
  reconciliation="$(hostile_chain_value "$chain" reconciliation)"
  set +e
  "$BOUND_NODE" "$I00_ROOT/bin/run-bound-effect.mjs" \
    --authorization "$authorization" \
    --deployment-risk "$risk" \
    --action-preview "$preview" \
    --authorization-consumption "$consumption" \
    -- "$script" --i00-effect-environment "$SANITIZED_ROOT/backup.env" \
    >/dev/null 2>&1
  runner_rc=$?
  set -e
  if [ "$expected_output" = BOUND ]; then
    [ "$runner_rc" -eq 0 ] \
      || fail_test "valid hostile-control backup effect did not complete"
    terminal_status=AUTHORIZED_EFFECT_COMPLETED
  else
    [ "$runner_rc" -ne 0 ] \
      || fail_test "hostile backup output unexpectedly completed: $scenario"
    terminal_status=AUTHORIZED_EFFECT_TERMINATED
  fi
  assert_file "$terminal"
  assert_eq "$(json_value "$terminal" status)" "$terminal_status"
  output_status="$(json_value "$terminal" effectOutput.status)"
  assert_eq "$output_status" "$expected_output"
  if [ "$expected_output" != BOUND ]; then
    assert_eq "$(json_value "$terminal" successRecorderEligible)" false
    assert_eq "$(json_value "$terminal" effectMayHaveMutated)" true
    assert_not_file "$EFFECT_ROOT/$scenario.output.json"
    assert_not_file "$result"
    assert_not_file "$reconciliation"
  fi
  HOSTILE_CHAIN="$chain"
}

run_hostile_backup_effect missing MISSING
run_hostile_backup_effect malformed INVALID
run_hostile_backup_effect duplicate INVALID
run_hostile_backup_effect oversize AMBIGUOUS
run_hostile_backup_effect wrong-claim INVALID
run_hostile_backup_effect wrong-path INVALID
run_hostile_backup_effect symlink-output INVALID
run_hostile_backup_effect invalid-manifest INVALID
run_hostile_backup_effect database-mismatch INVALID
run_hostile_backup_effect extra-delta INVALID

run_hostile_backup_effect post-terminal-root-mutation BOUND
MUTATION_RESULT="$(hostile_chain_value "$HOSTILE_CHAIN" result)"
MUTATION_RECONCILIATION="$(hostile_chain_value "$HOSTILE_CHAIN" reconciliation)"
MUTATION_AUTHORIZATION="$(hostile_chain_value "$HOSTILE_CHAIN" authorization)"
MUTATION_RISK="$(hostile_chain_value "$HOSTILE_CHAIN" risk)"
MUTATION_PREVIEW="$(hostile_chain_value "$HOSTILE_CHAIN" preview)"
MUTATION_CONSUMPTION="$(hostile_chain_value "$HOSTILE_CHAIN" consumption)"
MUTATION_START="$(hostile_chain_value "$HOSTILE_CHAIN" effectStart)"
MUTATION_TERMINAL="$(hostile_chain_value "$HOSTILE_CHAIN" effectFinish)"
mkdir "$BACKUP_ROOT/20300101T235959Z"
chmod 700 "$BACKUP_ROOT/20300101T235959Z"
assert_failure_contains \
  'authorized backup root differs from the runner-bound post inventory' \
  "$BOUND_NODE" "$OUTCOME_RECORDER" \
    --class BACKUP_CREATE \
    --authorization "$MUTATION_AUTHORIZATION" \
    --deployment-risk "$MUTATION_RISK" \
    --action-preview "$MUTATION_PREVIEW" \
    --authorization-consumption "$MUTATION_CONSUMPTION" \
    --result-receipt "$MUTATION_RESULT" \
    --reconciliation-receipt "$MUTATION_RECONCILIATION" \
    --effect-start-evidence "$MUTATION_START" \
    --effect-finish-evidence "$MUTATION_TERMINAL" \
    --simulation-clock
assert_not_file "$MUTATION_RESULT"
assert_not_file "$MUTATION_RECONCILIATION"

finish
