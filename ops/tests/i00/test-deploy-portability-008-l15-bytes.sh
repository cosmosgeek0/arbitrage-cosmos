#!/usr/bin/env bash
# DEPLOY-PORTABILITY-008: the effective L15 donor consumes only verified
# descriptor capabilities; public named inputs remain exact risk-bound paths.
set -euo pipefail

. "$(dirname "$0")/helpers.sh"
export NODE="$I00_TEST_HELPER_NODE"

LIVE="$REPO_ROOT/ops/live"
BIN="$LIVE/bin"
COMMON="$BIN/common.sh"
DEPLOY="$BIN/deploy.sh"
ROLLBACK="$BIN/rollback.sh"
BACKUP="$BIN/backup.sh"
RESTORE="$BIN/restore.sh"
BACKUP_ENV="$LIVE/env/cosmos-backup.env.template"
SANITIZER="$REPO_ROOT/ops/i00/bin/sanitize-donor-env.mjs"
BACKUP_WRAPPER="$REPO_ROOT/ops/i00/bin/backup-verify.sh"
RESTORE_WRAPPER="$REPO_ROOT/ops/i00/bin/restore-drill-verify.sh"
ROLLBACK_WRAPPER="$REPO_ROOT/ops/i00/bin/rollback-switch.sh"
OUTCOME_RECORDER="$REPO_ROOT/ops/i00/bin/record-authorized-action-outcome.mjs"

COMMON_SOURCE="$(cat "$COMMON")"
DEPLOY_SOURCE="$(cat "$DEPLOY")"
ROLLBACK_SOURCE="$(cat "$ROLLBACK")"
BACKUP_SOURCE="$(cat "$BACKUP")"
RESTORE_SOURCE="$(cat "$RESTORE")"
SANITIZER_SOURCE="$(cat "$SANITIZER")"
BACKUP_WRAPPER_SOURCE="$(cat "$BACKUP_WRAPPER")"
RESTORE_WRAPPER_SOURCE="$(cat "$RESTORE_WRAPPER")"
ROLLBACK_WRAPPER_SOURCE="$(cat "$ROLLBACK_WRAPPER")"
OUTCOME_SOURCE="$(cat "$OUTCOME_RECORDER")"

note "bare action classes and ambient release-source metadata fail closed"
assert_failure env I00_EFFECT_CLASS=SERVICE_ROLLBACK \
  /bin/bash -p -c '. "$1"' _ "$COMMON"
assert_contains "$COMMON_SOURCE" \
  'FATAL: bare I00_EFFECT_CLASS is not an authorization capability'
assert_contains "$COMMON_SOURCE" \
  'FATAL: ambient release source bindings are not authorization capabilities'
assert_contains "$COMMON_SOURCE" 'I00_AUTHORIZED_EFFECT_VERIFIER_FD'
assert_contains "$COMMON_SOURCE" '/proc/self/fd/38'
assert_contains "$COMMON_SOURCE" '_I00_AUTHORIZED_HANDOFF_JSON'
assert_contains "$COMMON_SOURCE" 'readonly _I00_AUTHORIZED_EFFECT_PRESENT'

note "public raw paths cannot be replaced by internal descriptor tokens"
assert_failure /bin/bash -p -c '
  set -eu
  . "$1"
  exact_raw_canonical_path /proc/self/fd/51 >/dev/null
' _ "$COMMON"
assert_contains "$DEPLOY_SOURCE" \
  'RELEASE_SRC="$(exact_existing_directory_path "$RELEASE_SRC")"'
assert_contains "$ROLLBACK_SOURCE" \
  'TARGET_DIR="$(exact_existing_directory_path "$TARGET_DIR")"'
assert_contains "$RESTORE_SOURCE" \
  'authorized restore requires one risk-bound named backup path'
assert_contains "$COMMON_SOURCE" \
  'authorized_release_source_effect_path()'
assert_contains "$COMMON_SOURCE" \
  'authorized_read_effect_path releaseSource "$source_named"'
assert_contains "$COMMON_SOURCE" \
  'source_name=automaticRollbackSource'
assert_contains "$COMMON_SOURCE" \
  'authorized_read_effect_path "$source_name" "$source_named"'

note "deploy probe retains the verified Node and Bash capabilities"
assert_contains "$DEPLOY_SOURCE" "if (nodePath === '/proc/self/fd/16')"
assert_contains "$DEPLOY_SOURCE" \
  "fs.realpathSync.native('/proc/self/exe') !== fs.realpathSync.native(nodePath)"
assert_contains "$DEPLOY_SOURCE" "spawnNodePath = '/proc/self/exe';"
assert_contains "$DEPLOY_SOURCE" \
  "if (bashPath === '/proc/self/fd/17')"
assert_contains "$DEPLOY_SOURCE" 'commandStdio[17] = 17;'
assert_contains "$DEPLOY_SOURCE" \
  "const child = spawn(bashPath, ['-p', '-c', command],"
if printf '%s\n' "$DEPLOY_SOURCE" | grep -F \
    "const child = spawn('/bin/bash'" >/dev/null; then
  fail_test "deploy probe retains an unbound Bash spawn"
fi
pass_assertion

note "restore tar children retain both tar and gzip descriptors"
assert_contains "$RESTORE_SOURCE" 'const stdio = ['
assert_contains "$RESTORE_SOURCE" 'stdio[22] = 22;'
assert_contains "$RESTORE_SOURCE" 'stdio[39] = 39;'
assert_contains "$RESTORE_SOURCE" \
  'const result = spawnSync(tarBin, args, {'
assert_contains "$RESTORE_SOURCE" 'descriptorCompression'
assert_contains "$RESTORE_SOURCE" \
  '[ "$TAR_BIN" = /proc/self/fd/22 ]'
assert_contains "$RESTORE_SOURCE" \
  '[ "$GZIP_BIN" = /proc/self/fd/39 ]'
assert_contains "$RESTORE_SOURCE" \
  'ISOLATED_RESTORE tar/gzip descriptors are invalid'

note "authorized backup is DB-only before any donor effect"
assert_eq "$(grep -c '^EVIDENCE_PATHS=$' "$BACKUP_ENV")" 1
assert_eq "$(grep -Ec '^EVIDENCE_PATHS=.+$' "$BACKUP_ENV" || true)" 0
assert_contains "$(cat "$BACKUP_ENV")" \
  'BLOCKED_PENDING_EXPLICIT_READ_CAPABILITY'
assert_contains "$BACKUP_SOURCE" \
  'authorized BACKUP_CREATE does not permit EVIDENCE_PATHS without an explicit retained read capability'
assert_contains "$BACKUP_SOURCE" \
  'JSON.stringify(canonical(manifest), null, 2) + "\n",'
assert_contains "$SANITIZER_SOURCE" \
  'authorized backup donor env EVIDENCE_PATHS must be empty'
assert_contains "$SANITIZER_SOURCE" "values.EVIDENCE_PATHS = '';"
assert_contains "$BACKUP_WRAPPER_SOURCE" \
  'authorized backup rejects nonempty EVIDENCE_PATHS'
assert_contains "$RESTORE_WRAPPER_SOURCE" \
  'authorized restore rejects nonempty EVIDENCE_PATHS'
BACKUP_REJECT_LINE="$(
  grep -n -m1 'does not permit EVIDENCE_PATHS' "$BACKUP" | cut -d: -f1
)"
BACKUP_DB_LINE="$(
  grep -n -m1 '^DB=' "$BACKUP" | cut -d: -f1
)"
BACKUP_LOCK_LINE="$(
  grep -n -m1 '^acquire_lock ' "$BACKUP" | cut -d: -f1
)"
[ "$BACKUP_REJECT_LINE" -lt "$BACKUP_DB_LINE" ] \
  || fail_test "authorized evidence rejection occurs after the DB read"
pass_assertion
[ "$BACKUP_REJECT_LINE" -lt "$BACKUP_LOCK_LINE" ] \
  || fail_test "authorized evidence rejection occurs after the backup lock effect"
pass_assertion

note "backup donor reports one canonical descriptor-bound publication claim"
assert_contains "$COMMON_SOURCE" \
  "'writeRoots', 'observedRoots', 'readRoots', 'claimKey', 'effectOutput',"
assert_contains "$COMMON_SOURCE" \
  "exact(value.effectOutput, ['fd', 'kind', 'maxBytes', 'schemaVersion']);"
assert_contains "$COMMON_SOURCE" "value.effectOutput.fd !== fd(53)"
assert_contains "$COMMON_SOURCE" \
  "value.effectOutput.kind !== 'I00_AUTHORIZED_EFFECT_OUTPUT'"
assert_contains "$COMMON_SOURCE" 'value.effectOutput.maxBytes !== 4096'
assert_contains "$COMMON_SOURCE" \
  '_I00_AUTHORIZED_EFFECT_CLAIM_KEY="$_I00_HANDOFF_FIELD"'
assert_contains "$COMMON_SOURCE" \
  '_I00_EFFECT_OUTPUT_FD="$_I00_HANDOFF_FIELD"'
assert_contains "$BACKUP_SOURCE" \
  '[ "$_I00_EFFECT_OUTPUT_FD" = /proc/self/fd/53 ]'
assert_contains "$BACKUP_SOURCE" \
  "kind: 'I00_AUTHORIZED_EFFECT_OUTPUT',"
assert_contains "$BACKUP_SOURCE" "status: 'OUTPUT_REPORTED',"
assert_contains "$BACKUP_SOURCE" 'writeRootName: '\''backupDir'\'','
assert_contains "$BACKUP_SOURCE" \
  'const bytes = Buffer.from(`${JSON.stringify(output, null, 2)}\n`, '\''utf8'\'');'
assert_contains "$BACKUP_SOURCE" \
  'if (bytes.length > 4096 || fs.writeSync(53, bytes) !== bytes.length)'
assert_contains "$BACKUP_SOURCE" 'exec 53>&-'
assert_contains "$BACKUP_SOURCE" 'fs_publish_directory_durable \'
assert_contains "$COMMON_SOURCE" 'fs.fsyncSync(descriptor);'
assert_contains "$COMMON_SOURCE" 'fs.fsyncSync(workFd);'
assert_contains "$COMMON_SOURCE" 'fs.fsyncSync(parentFd);'
assert_contains "$COMMON_SOURCE" 'fs.renameSync(work, final);'
BACKUP_FINAL_BINDING_LINE="$(
  grep -n 'require_authorized_read_root_binding dataDir' "$BACKUP" | tail -n1 | cut -d: -f1
)"
BACKUP_OUTPUT_LINE="$(
  grep -n -m1 'authorized backup effect-output descriptor is invalid' "$BACKUP" | cut -d: -f1
)"
[ "$BACKUP_FINAL_BINDING_LINE" -lt "$BACKUP_OUTPUT_LINE" ] \
  || fail_test "backup output is emitted before the final capability recheck"
pass_assertion

note "rollback donor seals the frozen marker through its retained root"
assert_contains "$ROLLBACK_SOURCE" \
  'OPS_EFFECT_STATE_DIR="$(authorized_write_effect_path opsStateDir "$OPS_STATE_DIR")"'
assert_contains "$ROLLBACK_SOURCE" \
  'fs_seal_file_readonly "$FROZEN_EFFECT_MARKER" "$OPS_EFFECT_STATE_DIR"'
assert_contains "$COMMON_SOURCE" 'fs.fchmodSync(fileFd, 0o400);'
assert_contains "$COMMON_SOURCE" 'fs.fsyncSync(fileFd);'
assert_contains "$COMMON_SOURCE" 'fs.fsyncSync(parentFd);'
assert_contains "$COMMON_SOURCE" \
  'const descriptorRoot = /^\/proc\/self\/fd\/([1-9][0-9]*)$/u.exec(parent);'
if printf '%s\n' "$ROLLBACK_WRAPPER_SOURCE" | grep -F \
    'seal_frozen_marker' >/dev/null; then
  fail_test "rollback wrapper retains a post-donor named-path marker mutation"
fi
pass_assertion
assert_contains "$OUTCOME_SOURCE" '0o400'
ROLLBACK_SEAL_LINE="$(
  grep -n -m1 'fs_seal_file_readonly' "$ROLLBACK" | cut -d: -f1
)"
ROLLBACK_EXIT_LINE="$(
  grep -n -m1 'frozen for incident handling' "$ROLLBACK" | tail -n1 | cut -d: -f1
)"
[ "$ROLLBACK_SEAL_LINE" -lt "$ROLLBACK_EXIT_LINE" ] \
  || fail_test "rollback donor exits before sealing its marker"
pass_assertion

note "marker sealing rejects path replacement and publishes mode 0400"
MARKER_ROOT="$TEST_TMP/marker-root"
MARKER="$MARKER_ROOT/deploy-frozen.json"
mkdir "$MARKER_ROOT"
printf '{"status":"FROZEN"}\n' > "$MARKER"
chmod 600 "$MARKER"
assert_success /bin/bash -p -c '
  set -eu
  . "$1"
  fs_seal_file_readonly "$2" "$3"
' _ "$COMMON" "$MARKER" "$MARKER_ROOT"
MARKER_MODE="$(stat -f %Lp "$MARKER" 2>/dev/null || stat -c %a "$MARKER")"
assert_eq "$MARKER_MODE" 400

VICTIM="$MARKER_ROOT/victim"
REPLACED="$MARKER_ROOT/replaced"
printf 'unchanged\n' > "$VICTIM"
chmod 600 "$VICTIM"
ln -s "$VICTIM" "$REPLACED"
assert_failure /bin/bash -p -c '
  set -eu
  . "$1"
  fs_seal_file_readonly "$2" "$3"
' _ "$COMMON" "$REPLACED" "$MARKER_ROOT"
assert_eq "$(cat "$VICTIM")" unchanged
assert_eq "$(stat -f %Lp "$VICTIM" 2>/dev/null || stat -c %a "$VICTIM")" 600

if [ -d /proc/self/fd ]; then
  note "Linux directory capability seals the exact descriptor-root child"
  CAP_ROOT="$TEST_TMP/capability-root"
  CAP_MARKER="$CAP_ROOT/deploy-frozen.json"
  mkdir "$CAP_ROOT"
  printf '{"status":"FROZEN"}\n' > "$CAP_MARKER"
  chmod 600 "$CAP_MARKER"
  assert_success /bin/bash -p -c '
    set -eu
    exec 44<"$2"
    . "$1"
    fs_seal_file_readonly /proc/self/fd/44/deploy-frozen.json /proc/self/fd/44
  ' _ "$COMMON" "$CAP_ROOT"
  assert_eq "$(stat -c %a "$CAP_MARKER")" 400
  assert_failure /bin/bash -p -c '
    set -eu
    exec 44<&-
    . "$1"
    fs_seal_file_readonly /proc/self/fd/44/deploy-frozen.json /proc/self/fd/44
  ' _ "$COMMON"
fi

note "descriptor children default closed and reopen only named capabilities"
assert_contains "$COMMON_SOURCE" \
  "for (let descriptor = 3; descriptor <= 34; descriptor += 1) stdio[descriptor] = 'ignore';"
assert_contains "$COMMON_SOURCE" 'stdio[17] = 17;'
assert_contains "$COMMON_SOURCE" 'stdio[34] = 34;'
assert_contains "$COMMON_SOURCE" \
  'I00_AUTHORIZED_EFFECT_READ_ROOT_RELEASE_SOURCE_FD=51'
assert_contains "$COMMON_SOURCE" \
  'I00_AUTHORIZED_EFFECT_READ_ROOT_AUTOMATIC_ROLLBACK_SOURCE_FD=52'

finish
