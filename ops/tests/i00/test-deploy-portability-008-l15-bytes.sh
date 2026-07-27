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
BOUND_EFFECT_RUNNER="$REPO_ROOT/ops/i00/bin/run-bound-effect.mjs"
HANDOFF_VERIFIER="$REPO_ROOT/ops/i00/bin/verify-authorized-effect-handoff.mjs"
AUTOMATIC_HANDOFF_SCHEMA="$REPO_ROOT/ops/i00/schemas/authorized-automatic-rollback-handoff.schema.json"
PRIMARY_HANDOFF_SCHEMA="$REPO_ROOT/ops/i00/schemas/authorized-effect-handoff.schema.json"
JSON_SCHEMA_COMPILER="$REPO_ROOT/ops/i00/json-schema.mjs"
RUN_ALL="$REPO_ROOT/ops/tests/i00/run-all.sh"
HISTORICAL_WATCHDOG="$REPO_ROOT/ops/tests/i00/test-r3-d-watchdog-007.sh"
HISTORICAL_BACKUP="$REPO_ROOT/ops/tests/i00/test-r3-d-backup-008.sh"
WATCHDOG_SUCCESSOR="$REPO_ROOT/ops/tests/i00/df32-r3-watchdog-successor.sh"
BACKUP_SUCCESSOR="$REPO_ROOT/ops/tests/i00/df32-r3-backup-successor.sh"
HISTORICAL_WATCHDOG_SHA256=00aa0d94baddfd7827ff0d21ee34de1c95e0df079f29c8ce28f838d1434ed3e7
HISTORICAL_BACKUP_SHA256=13a8ed59b53bb4e02e80f9367de05c469f6998b501d1aad451ae23f3cf800091

sha256_file() {
  "$NODE" -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    process.stdout.write(
      crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"),
    );
  ' "$1"
}

run_successor_suite() {
  local suite="$1" log="$TEST_TMP/$(basename "$1").log" rc footer
  [ -f "$suite" ] && [ -x "$suite" ] \
    || fail_test "R3 successor is not one executable regular file: $suite"
  pass_assertion
  set +e
  bash "$suite" >"$log" 2>&1
  rc=$?
  set -e
  [ "$rc" -eq 0 ] || fail_test "R3 successor failed: $suite"
  pass_assertion
  footer="$(
    sed -n 's/^OK (\([0-9][0-9]*\) assertions)$/\1/p' "$log" | tail -1
  )"
  [ -n "$footer" ] && [ "$footer" -gt 0 ] \
    || fail_test "R3 successor omitted its positive assertion footer: $suite"
  pass_assertion
  ASSERTIONS=$((ASSERTIONS + footer))
}

note "historical R3 regression paths retain their sealed base bytes"
assert_eq "$(sha256_file "$HISTORICAL_WATCHDOG")" \
  "$HISTORICAL_WATCHDOG_SHA256"
assert_eq "$(sha256_file "$HISTORICAL_BACKUP")" \
  "$HISTORICAL_BACKUP_SHA256"

note "current-runtime R3 successors execute with positive assertion footers"
run_successor_suite "$WATCHDOG_SUCCESSOR"
run_successor_suite "$BACKUP_SUCCESSOR"

RUN_ALL_SOURCE="$(cat "$RUN_ALL")"
note "the aggregate routes exactly the immutable R3 paths through this driver"
assert_contains "$RUN_ALL_SOURCE" \
  'ROUTING_DRIVER=test-deploy-portability-008-l15-bytes.sh'
assert_contains "$RUN_ALL_SOURCE" \
  'test-r3-d-backup-008.sh|test-r3-d-watchdog-007.sh)'
assert_contains "$RUN_ALL_SOURCE" \
  'immutable-byte and current-runtime verification delegated to $ROUTING_DRIVER'
assert_contains "$RUN_ALL_SOURCE" 'if [ "$ROUTED" -ne 2 ]; then'

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

note "automatic rollback handoff carries one required empty effect-output object"
assert_success "$NODE" --input-type=module - \
  "$BOUND_EFFECT_RUNNER" \
  "$HANDOFF_VERIFIER" \
  "$AUTOMATIC_HANDOFF_SCHEMA" \
  "$PRIMARY_HANDOFF_SCHEMA" \
  "$JSON_SCHEMA_COMPILER" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [
  runnerPath,
  verifierPath,
  automaticSchemaPath,
  primarySchemaPath,
  schemaCompilerPath,
] = process.argv.slice(2);
const runnerSource = readFileSync(runnerPath, 'utf8');
const verifierSource = readFileSync(verifierPath, 'utf8');
const automaticSchema = JSON.parse(readFileSync(automaticSchemaPath, 'utf8'));
const primarySchema = JSON.parse(readFileSync(primarySchemaPath, 'utf8'));

const automaticStart = runnerSource.indexOf(
  'const automaticRollbackHandoffDocument',
);
const automaticEnd = runnerSource.indexOf(
  'const automaticRollbackHandoffBytes',
  automaticStart,
);
assert.notEqual(automaticStart, -1);
assert.notEqual(automaticEnd, -1);
const automaticProducer = runnerSource.slice(automaticStart, automaticEnd);
assert.equal(
  (automaticProducer.match(
    /effectOutput: commonEvidence\.effectOutputPolicy,/gu,
  ) ?? []).length,
  1,
);
const policyStart = runnerSource.indexOf('const effectOutputPolicy =');
const policyEnd = runnerSource.indexOf('const commonEvidence', policyStart);
assert.notEqual(policyStart, -1);
assert.notEqual(policyEnd, -1);
const effectOutputPolicy = runnerSource.slice(policyStart, policyEnd);
assert.match(
  effectOutputPolicy,
  /const effectOutputPolicy = actionClass === 'BACKUP_CREATE'/u,
);
assert.equal(
  effectOutputPolicy.trimEnd().endsWith(': Object.freeze({});'),
  true,
);
assert.equal(
  automaticSchema.properties.actionClass.const,
  'SERVICE_RELEASE_SWITCH',
);

const keysStart = verifierSource.indexOf('const AUTOMATIC_HANDOFF_KEYS');
const keysEnd = verifierSource.indexOf('const PROGRAM_KEYS', keysStart);
assert.notEqual(keysStart, -1);
assert.notEqual(keysEnd, -1);
const automaticKeys = verifierSource.slice(keysStart, keysEnd);
assert.equal((automaticKeys.match(/'effectOutput'/gu) ?? []).length, 1);
const commonStart = verifierSource.indexOf(
  'function validateCommonHandoff(document)',
);
const commonEnd = verifierSource.indexOf(
  'function validateHandoff(document)',
  commonStart,
);
assert.notEqual(commonStart, -1);
assert.notEqual(commonEnd, -1);
const commonValidator = verifierSource.slice(commonStart, commonEnd);
assert.equal(
  (commonValidator.match(
    /\} else \{\s+requireExactKeys\(document\.effectOutput, \[\], 'authorized effect output policy'\);\s+\}/gu,
  ) ?? []).length,
  1,
);

assert.equal(automaticSchema.required.includes('effectOutput'), true);
assert.deepEqual(automaticSchema.properties.effectOutput, {
  $ref: 'authorized-effect-handoff.v1.json#/$defs/emptyObject',
});
assert.equal(automaticSchema.additionalProperties, false);

const { compileJsonSchema } = await import(pathToFileURL(schemaCompilerPath));
const validateEffectOutputSeam = compileJsonSchema({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['effectOutput'],
  properties: {
    effectOutput: primarySchema.$defs.emptyObject,
  },
  additionalProperties: false,
}, 'automatic rollback effect-output seam');

assert.equal(validateEffectOutputSeam({ effectOutput: {} }).valid, true);
assert.equal(validateEffectOutputSeam({}).valid, false);
assert.equal(validateEffectOutputSeam({
  effectOutput: { unexpected: true },
}).valid, false);
assert.equal(validateEffectOutputSeam({
  effectOutput: {},
  unexpected: true,
}).valid, false);
NODE

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
  '&& ! ( fs_seal_file_readonly \
        "$FROZEN_EFFECT_MARKER" "$OPS_EFFECT_STATE_DIR" ); then'
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
MARKER_MODE="$(stat -c %a "$MARKER" 2>/dev/null || stat -f %Lp "$MARKER")"
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
assert_eq "$(stat -c %a "$VICTIM" 2>/dev/null || stat -f %Lp "$VICTIM")" 600

if [ "$(uname -s)" = Linux ]; then
  [ -d /proc/self/fd ] \
    || fail_test "Linux journal descriptor-root proof requires procfs"
fi
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

  note "Linux non-root directory capability publishes the exact journal child"
  JOURNAL_CAP_ROOT="$TEST_TMP/journal-capability-root"
  mkdir "$JOURNAL_CAP_ROOT"
  JOURNAL_CAPABILITY_PROOF='
    set -eu
    common="$1"
    root="$2"
    expected_uid="$3"
    expected_gid="$4"
    expected_groups="$5"
    if [ -n "$expected_uid" ]; then
      [ "$(id -u)" = "$expected_uid" ]
      [ "$(id -g)" = "$expected_gid" ]
      [ "$(id -G)" = "$expected_groups" ]
    fi
    named="$root/journal-compat.json"
    journal="$named"
    parent_before="$(stat -c "%d:%i" "$root")"
    . "$common"

    absent="$(journal_state_snapshot "$journal")"
    [ "$absent" = "ABSENT|0|0|-|-|-|-|-|-" ]
    json_write_exact_regular_or_absent \
      "$journal" "$absent" dataSchema=1 rollbackFloor=0
    [ "$(json_get "$named" dataSchema)" = 1 ]
    [ "$(stat -c %a "$named")" = 644 ]
    [ "$(sha256_file "$named")" = \
      1f7243aacde74b25c927022ca2a65dab1feb14b41ea01fd34edbeadbf14e4ec8 ]
    first_identity="$(stat -c "%d:%i" "$named")"

    present="$(journal_state_snapshot "$journal")"
    json_write_exact_regular_or_absent \
      "$journal" "$present" dataSchema=2 rollbackFloor=1
    [ "$(json_get "$named" dataSchema)" = 2 ]
    [ "$(json_get "$named" rollbackFloor)" = 1 ]
    [ "$(stat -c %a "$named")" = 644 ]
    [ "$(sha256_file "$named")" = \
      0eb622956bded66b79428025af1e1ec90b0bc3964090a3d249f3a2ebad45dd88 ]
    [ "$(stat -c "%d:%i" "$named")" != "$first_identity" ]

    stale="$(journal_state_snapshot "$journal")"
    printf "%s\n" \
      "{\"dataSchema\":3,\"rollbackFloor\":2,\"externalRevision\":\"newer\"}" \
      > "$named"
    newer_sha="$(sha256_file "$named")"
    if json_write_exact_regular_or_absent \
        "$journal" "$stale" dataSchema=4 rollbackFloor=2; then
      exit 1
    fi
    [ "$(sha256_file "$named")" = "$newer_sha" ]
    [ "$(json_get "$named" externalRevision)" = newer ]
    [ "$(stat -c %a "$named")" = 644 ]
    [ "$(stat -c "%d:%i" "$root")" = "$parent_before" ]
    debris="$(find "$root"/ -maxdepth 1 \
      -name ".journal-compat.json.write-*" -print)"
    [ -z "$debris" ]

    unreadable="$root/journal-unreadable.json"
    printf "%s\n" "{\"dataSchema\":2,\"rollbackFloor\":0}" > "$unreadable"
    unreadable_sha="$(sha256_file "$unreadable")"
    chmod 000 "$unreadable"
    set +e
    unreadable_snapshot="$(journal_state_snapshot "$unreadable")"
    unreadable_rc=$?
    set -e
    [ "$unreadable_rc" = 4 ]
    [ -z "$unreadable_snapshot" ]
    [ "$(stat -c %a "$unreadable")" = 0 ]
    chmod 600 "$unreadable"
    [ "$(sha256_file "$unreadable")" = "$unreadable_sha" ]
    rm -f "$unreadable"
  '
  if [ "$(id -u)" = 0 ]; then
    [ -x /usr/bin/setpriv ] \
      || fail_test "root Linux journal proof requires /usr/bin/setpriv"
    JOURNAL_CAP_UID="$(id -u cosmos 2>/dev/null)" \
      || fail_test "root Linux journal proof requires the cosmos user"
    JOURNAL_CAP_GID="$(id -g cosmos 2>/dev/null)" \
      || fail_test "root Linux journal proof requires the cosmos group"
    [ "$JOURNAL_CAP_UID" -gt 0 ] && [ "$JOURNAL_CAP_GID" -gt 0 ] \
      || fail_test "root Linux journal proof requires positive identifiers"
    chown "$JOURNAL_CAP_UID:$JOURNAL_CAP_GID" "$JOURNAL_CAP_ROOT"
    chmod 700 "$JOURNAL_CAP_ROOT"
    assert_success /usr/bin/setpriv \
      --reuid="$JOURNAL_CAP_UID" --regid="$JOURNAL_CAP_GID" \
      --clear-groups --inh-caps=-all --bounding-set=-all --nnp \
      /usr/bin/env -i \
      PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/tmp TMPDIR=/tmp \
      NODE="$I00_TEST_HELPER_NODE" \
      /bin/bash -p -c "$JOURNAL_CAPABILITY_PROOF" \
      _ /proc/self/fd/48 /proc/self/fd/49 \
      "$JOURNAL_CAP_UID" "$JOURNAL_CAP_GID" "$JOURNAL_CAP_GID" \
      48<"$COMMON" 49<"$JOURNAL_CAP_ROOT"
    assert_eq "$(stat -c %u:%g "$JOURNAL_CAP_ROOT/journal-compat.json")" \
      "$JOURNAL_CAP_UID:$JOURNAL_CAP_GID"
  else
    JOURNAL_CAP_UID="$(id -u)"
    JOURNAL_CAP_GID="$(id -g)"
    JOURNAL_CAP_GROUPS="$(id -G)"
    assert_success /usr/bin/env -i \
      PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME=/tmp TMPDIR=/tmp \
      NODE="$I00_TEST_HELPER_NODE" \
      /bin/bash -p -c "$JOURNAL_CAPABILITY_PROOF" \
      _ /proc/self/fd/48 /proc/self/fd/49 \
      "$JOURNAL_CAP_UID" "$JOURNAL_CAP_GID" "$JOURNAL_CAP_GROUPS" \
      48<"$COMMON" 49<"$JOURNAL_CAP_ROOT"
    assert_eq "$(stat -c %u:%g "$JOURNAL_CAP_ROOT/journal-compat.json")" \
      "$JOURNAL_CAP_UID:$JOURNAL_CAP_GID"
  fi
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
