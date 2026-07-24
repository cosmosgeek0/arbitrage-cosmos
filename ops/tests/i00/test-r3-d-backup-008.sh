#!/usr/bin/env bash
# R3-D-BACKUP-008: a restore must validate an immutable, exact backup
# snapshot and every archive member before it mutates the target. The drill
# must surface archive failures and prove that its isolated target stayed
# untouched.
set -euo pipefail

. "$(dirname "$0")/helpers.sh"

EFFECTIVE="$TEST_TMP/effective"
materialize_effective_l15 "$EFFECTIVE"
BIN="$EFFECTIVE/ops/live/bin"
BACKUP="$BIN/backup.sh"
RESTORE="$BIN/restore.sh"
DRILL="$BIN/restore-drill.sh"

ROOT="$TEST_TMP/campaign"
DATA_DIR="$ROOT/data"
OPS_STATE_DIR="$ROOT/ops"
BACKUP_DIR="$ROOT/backups"
SOURCE_EVIDENCE="$ROOT/source-evidence"
MODEL_EVIDENCE="$ROOT/model-evidence"
FILE_EVIDENCE="$ROOT/single-evidence.txt"
BOUND_NODE="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.execPath))')"
BOUND_TAR="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$(command -v tar)")"
BOUND_SQLITE="$(node -e 'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' "$(command -v sqlite3)")"
mkdir -p "$DATA_DIR" "$OPS_STATE_DIR" "$SOURCE_EVIDENCE" "$MODEL_EVIDENCE"

sqlite3 "$DATA_DIR/cosmos.db" '
  PRAGMA journal_mode=WAL;
  CREATE TABLE events(id INTEGER PRIMARY KEY, kind TEXT NOT NULL);
  INSERT INTO events VALUES (1, "fixture");
' >/dev/null
printf 'original-evidence\n' > "$SOURCE_EVIDENCE/proof.txt"
printf 'original-model\n' > "$MODEL_EVIDENCE/model.txt"
printf 'original-single-file\n' > "$FILE_EVIDENCE"

run_backup() {
  env DATA_DIR="$DATA_DIR" OPS_STATE_DIR="$OPS_STATE_DIR" \
    BACKUP_DIR="$BACKUP_DIR" \
    NODE="$BOUND_NODE" \
    EVIDENCE_PATHS="$SOURCE_EVIDENCE:$MODEL_EVIDENCE:$FILE_EVIDENCE" \
    bash "$BACKUP"
}

run_restore() {
  local backup="$1" target="$2"
  shift 2
  env DATA_DIR="$DATA_DIR" OPS_STATE_DIR="$OPS_STATE_DIR" \
    BACKUP_DIR="$BACKUP_DIR" NODE="$BOUND_NODE" bash "$RESTORE" \
    --backup "$backup" --target "$target" "$@"
}

file_sha256() {
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$1"
}

set_archive_sha() {
  local backup="$1" archive="$2"
  local sha
  sha="$(file_sha256 "$backup/$archive")"
  node -e '
    const fs = require("fs");
    const [manifestPath, archive, sha] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const item = manifest.evidence.find((entry) => entry.archive === archive);
    if (!item) throw new Error(`missing manifest entry for ${archive}`);
    item.sha256 = sha;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  ' "$backup/manifest.json" "$archive" "$sha"
}

replace_first_archive() {
  local backup="$1" value="$2" tree="$TEST_TMP/replacement-$RANDOM-$$"
  mkdir -p "$tree/source-evidence"
  printf '%s\n' "$value" > "$tree/source-evidence/proof.txt"
  tar -czf "$backup/evidence-1.tar.gz" -C "$tree" source-evidence
  rm -rf "$tree"
}

write_hostile_archive() {
  local output="$1" kind="$2"
  node - "$output" "$kind" <<'NODE'
const fs = require('node:fs');
const zlib = require('node:zlib');
const [output, kind] = process.argv.slice(2);

function header({ name, type, data = Buffer.alloc(0), link = '', mode = 0o600 }) {
  const block = Buffer.alloc(512);
  const put = (offset, length, value) => {
    block.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
  };
  const octal = (offset, length, value) => {
    put(offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
  };
  put(0, 100, name);
  octal(100, 8, mode);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, data.length);
  octal(136, 12, 0);
  block.fill(0x20, 148, 156);
  put(156, 1, type);
  put(157, 100, link);
  put(257, 6, 'ustar\0');
  put(263, 2, '00');
  const checksum = block.reduce((sum, byte) => sum + byte, 0);
  put(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return Buffer.concat([block, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

const proof = Buffer.from('safe-member\n');
const entries = [
  header({ name: 'source-evidence/', type: '5', mode: 0o700 }),
  header({ name: 'source-evidence/proof.txt', type: '0', data: proof }),
];
if (kind === 'hardlink') {
  entries.push(header({
    name: 'source-evidence/proof-link.txt', type: '1',
    link: 'source-evidence/proof.txt',
  }));
} else if (kind === 'fifo') {
  entries.push(header({ name: 'source-evidence/pipe', type: '6' }));
  } else if (kind === 'duplicate') {
    entries.push(header({ name: 'source-evidence/proof.txt', type: '0', data: proof }));
  } else if (kind === 'case-collision') {
    entries.push(header({ name: 'source-evidence/Proof.txt', type: '0', data: proof }));
    entries.push(header({ name: 'source-evidence/proof.txt', type: '0', data: proof }));
  } else if (kind === 'unicode-collision') {
    entries.push(header({ name: 'source-evidence/caf\u00e9.txt', type: '0', data: proof }));
    entries.push(header({ name: 'source-evidence/cafe\u0301.txt', type: '0', data: proof }));
  } else if (kind === 'resource') {
    entries.push(header({
      name: 'source-evidence/large.bin', type: '0', data: Buffer.alloc(1024, 0x61),
    }));
} else {
  throw new Error(`unknown hostile archive kind: ${kind}`);
}
fs.writeFileSync(output, zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
NODE
}

assert_success run_backup
BASE_BACKUP="$BACKUP_DIR/$(ls -1 "$BACKUP_DIR" | grep -E '^[0-9]{8}T[0-9]{6}Z' | sort | tail -1)"
assert_file "$BASE_BACKUP/manifest.json"
assert_file "$BASE_BACKUP/evidence-1.tar.gz"
assert_file "$BASE_BACKUP/evidence-2.tar.gz"
assert_file "$BASE_BACKUP/evidence-3.tar.gz"

note "replacement-only archive tampering is rejected before target creation"
MISMATCH="$ROOT/mismatch"
cp -R "$BASE_BACKUP" "$MISMATCH"
replace_first_archive "$MISMATCH" tampered-evidence
MISMATCH_TARGET="$ROOT/mismatch-target"
assert_failure run_restore "$MISMATCH" "$MISMATCH_TARGET"
assert_not_file "$MISMATCH_TARGET"

note "a pristine backup restores the exact declared archive inventory"
GOOD_TARGET="$ROOT/good-target"
set +e
GOOD_OUTPUT="$(run_restore "$BASE_BACKUP" "$GOOD_TARGET" 2>&1)"
GOOD_RC=$?
set -e
[ "$GOOD_RC" -eq 0 ] || fail_test "pristine restore failed (inventory: $(ls -A "$BASE_BACKUP" | tr '\n' ' ')): $GOOD_OUTPUT"
pass_assertion
assert_eq "$(sqlite3 "$GOOD_TARGET/cosmos.db" 'SELECT COUNT(*) FROM events;')" 1
assert_eq "$(cat "$GOOD_TARGET/evidence/source-evidence/proof.txt")" original-evidence
assert_eq "$(cat "$GOOD_TARGET/evidence/model-evidence/model.txt")" original-model
assert_eq "$(cat "$GOOD_TARGET/evidence/single-evidence.txt")" original-single-file
assert_eq "$(node -e 'process.stdout.write(String(require(process.argv[1]).evidenceArchives))' "$GOOD_TARGET/restore-report.json")" 3
assert_eq "$(node -e 'process.stdout.write(require(process.argv[1]).archiveVerification)' "$GOOD_TARGET/restore-report.json")" EXACT_MANIFEST_INVENTORY_HASH_SIZE_MEMBER_VERIFIED

note "wrong class and hostile PATH cannot move restore executable bindings"
WRONG_CLASS_WITNESS="$ROOT/wrong-class-env-witness"
WRONG_CLASS_ENV="$ROOT/wrong-class.env"
printf 'printf sourced > "%s"\n' "$WRONG_CLASS_WITNESS" >"$WRONG_CLASS_ENV"
assert_failure env NODE="$BOUND_NODE" I00_EFFECT_CLASS=SERVICE_ROLLBACK \
  /bin/bash "$RESTORE" --backup "$BASE_BACKUP" \
  --target "$ROOT/wrong-class-target" --env-file "$WRONG_CLASS_ENV"
assert_not_file "$WRONG_CLASS_WITNESS"
BOUND_RESTORE_ENV="$ROOT/bound-restore.env"
printf "DATA_DIR='%s'\nOPS_STATE_DIR='%s'\nBACKUP_DIR='%s'\nNODE='%s'\nSQLITE='%s'\nTAR='%s'\n" \
  "$DATA_DIR" "$OPS_STATE_DIR" "$BACKUP_DIR" "$BOUND_NODE" "$BOUND_SQLITE" \
  "$BOUND_TAR" >"$BOUND_RESTORE_ENV"
HOSTILE_BIN="$ROOT/hostile-bin"
HOSTILE_WITNESS="$ROOT/hostile-path-witness"
mkdir "$HOSTILE_BIN"
for hostile_name in node tar dirname mkdir chmod rm mktemp; do
  printf '#!/bin/sh\nprintf invoked >> "%s"\nexit 97\n' "$HOSTILE_WITNESS" \
    >"$HOSTILE_BIN/$hostile_name"
  chmod 700 "$HOSTILE_BIN/$hostile_name"
done
HOSTILE_TARGET="$ROOT/hostile-path-target"
assert_success env PATH="$HOSTILE_BIN:/usr/bin:/bin" NODE="$BOUND_NODE" \
  TAR="$BOUND_TAR" \
  /bin/bash "$RESTORE" --backup "$BASE_BACKUP" --target "$HOSTILE_TARGET" \
  --env-file "$BOUND_RESTORE_ENV"
assert_file "$HOSTILE_TARGET/cosmos.db"
assert_not_file "$HOSTILE_WITNESS"

run_stage_mutation_case() {
  local slug="$1" stage_line="$2" suffix="$3" mutation="$4"
  local expected_mutation="$5" expected_error="$6"
  local target="$ROOT/stage-race-$slug-target"
  local ready="$ROOT/stage-race-$slug-ready"
  local continue_marker="$ROOT/stage-race-$slug-continue"
  local output="$ROOT/stage-race-$slug-output.txt"

  COSMOS_RESTORE_TEST_MODE=1 \
    RESTORE_TEST_STAGE_READY_MARKER="$ready" \
    RESTORE_TEST_STAGE_CONTINUE_MARKER="$continue_marker" \
    run_restore "$BASE_BACKUP" "$target" >"$output" 2>&1 &
  local restore_pid=$!
  local barrier_wait=0
  while [ ! -s "$ready" ] && kill -0 "$restore_pid" 2>/dev/null \
      && [ "$barrier_wait" -lt 1000 ]; do
    sleep 0.01
    barrier_wait=$((barrier_wait + 1))
  done
  if [ ! -s "$ready" ]; then
    kill "$restore_pid" 2>/dev/null || true
    wait "$restore_pid" 2>/dev/null || true
    fail_test "$slug restore did not expose the deterministic staged-mutation barrier"
  fi
  pass_assertion

  local staged_path
  staged_path="$(sed -n "${stage_line}p" "$ready")"
  [ -n "$staged_path" ] || fail_test "$slug barrier omitted staged path $stage_line"
  if [ -n "$suffix" ]; then staged_path="$staged_path/$suffix"; fi

  local mutation_proof mutation_rc
  set +e
  mutation_proof="$(node - "$staged_path" "$mutation" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');

const [file, mutation] = process.argv.slice(2);
const before = fs.lstatSync(file, { bigint: true });
if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n) {
  throw new Error('staged object is not a private nonempty regular file');
}
const descriptor = fs.openSync(file, 'r+');
let changed = false;
try {
  if (mutation === 'flip') {
    const beforeHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const offset = Number(before.size - 1n);
    const byte = Buffer.alloc(1);
    if (fs.readSync(descriptor, byte, 0, 1, offset) !== 1) throw new Error('short staged read');
    byte[0] ^= 0xff;
    if (fs.writeSync(descriptor, byte, 0, 1, offset) !== 1) throw new Error('short staged write');
    fs.fsyncSync(descriptor);
    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    changed = beforeHash !== afterHash;
  } else if (mutation === 'grow') {
    const grownSize = before.size + 1n;
    fs.ftruncateSync(descriptor, Number(grownSize));
    fs.fsyncSync(descriptor);
    changed = true;
  } else {
    throw new Error(`unknown staged mutation ${mutation}`);
  }
} finally {
  fs.closeSync(descriptor);
}
const after = fs.lstatSync(file, { bigint: true });
const { dev: beforeDevice } = before;
const { dev: afterDevice } = after;
process.stdout.write([
  beforeDevice === afterDevice && before.ino === after.ino,
  before.size === after.size,
  changed,
].join('|'));
NODE
  )"
  mutation_rc=$?
  set -e
  printf 'continue\n' > "$continue_marker"

  local completion_wait=0
  while kill -0 "$restore_pid" 2>/dev/null && [ "$completion_wait" -lt 500 ]; do
    sleep 0.01
    completion_wait=$((completion_wait + 1))
  done
  if kill -0 "$restore_pid" 2>/dev/null; then
    kill "$restore_pid" 2>/dev/null || true
    wait "$restore_pid" 2>/dev/null || true
    fail_test "$slug staged mutation did not fail within the five-second proof bound"
  fi
  local restore_rc
  set +e
  wait "$restore_pid"
  restore_rc=$?
  set -e
  [ "$mutation_rc" -eq 0 ] \
    || fail_test "could not mutate the $slug staged object: $mutation_proof"
  assert_eq "$mutation_proof" "$expected_mutation"
  [ "$restore_rc" -ne 0 ] || fail_test "$slug staged mutation published successfully"
  pass_assertion
  assert_contains "$(cat "$output")" "$expected_error"
  assert_not_file "$target"
}

note "same-inode same-size staged database mutation fails before publication"
run_stage_mutation_case database 1 '' flip 'true|true|true' \
  'staged cosmos.db content changed before publication'

note "same-inode same-size staged evidence mutation fails before publication"
run_stage_mutation_case evidence 2 'source-evidence/proof.txt' flip 'true|true|true' \
  'staged evidence content changed before publication'

note "same-inode same-size staged report mutation fails before publication"
run_stage_mutation_case report 3 '' flip 'true|true|true' \
  'staged restore-report.json content changed before publication'

note "sparse staged growth is rejected before hashing beyond the trusted size"
run_stage_mutation_case sparse-growth 1 '' grow 'true|false|true' \
  'staged cosmos.db content changed before publication'

note "the selected backup and restore target are disjoint immutable boundaries"
BACKUP_NESTED_TARGET="$BASE_BACKUP/nested-target"
assert_failure_contains "restore target and selected backup overlap" \
  run_restore "$BASE_BACKUP" "$BACKUP_NESTED_TARGET" --force
assert_not_file "$BACKUP_NESTED_TARGET"
assert_failure_contains "restore target and selected backup overlap" \
  run_restore "$BASE_BACKUP" "$BACKUP_DIR" --force
assert_file "$BASE_BACKUP/manifest.json"

note "an absent target below a symlink alias fails the exact endpoint boundary"
LIVE_ALIAS="$ROOT/live-alias"
ln -s "$DATA_DIR" "$LIVE_ALIAS"
ALIAS_CHILD="$LIVE_ALIAS/alias-child"
set +e
ALIAS_OUTPUT="$(run_restore "$BASE_BACKUP" "$ALIAS_CHILD" 2>&1)"
ALIAS_RC=$?
set -e
assert_eq "$ALIAS_RC" 1
assert_contains "$ALIAS_OUTPUT" \
  "restore target must be one exact raw and physical canonical absolute path"
assert_not_file "$DATA_DIR/alias-child"

note "raw symlink/../ traversal fails the exact endpoint boundary"
mkdir -p "$DATA_DIR/alias-nested"
DOT_ALIAS="$ROOT/dot-alias"
ln -s "$DATA_DIR/alias-nested" "$DOT_ALIAS"
set +e
DOT_ALIAS_OUTPUT="$(run_restore "$BASE_BACKUP" "$DOT_ALIAS/../dot-child" 2>&1)"
DOT_ALIAS_RC=$?
set -e
assert_eq "$DOT_ALIAS_RC" 1
assert_contains "$DOT_ALIAS_OUTPUT" \
  "restore target must be one exact raw and physical canonical absolute path"
assert_not_file "$DATA_DIR/dot-child"

note "production restore refuses before obsolete supervisor readback"
SYSTEMCTL_ERROR="$ROOT/systemctl-error.sh"
SYSTEMCTL_WITNESS="$ROOT/systemctl-witness"
printf '#!/usr/bin/env bash\nprintf called > "%s"\nexit 4\n' "$SYSTEMCTL_WITNESS" \
  > "$SYSTEMCTL_ERROR"
chmod +x "$SYSTEMCTL_ERROR"
LIVE_SHA_BEFORE_SYSTEMCTL="$(file_sha256 "$DATA_DIR/cosmos.db")"
set +e
SYSTEMCTL_OUTPUT="$(SYSTEMCTL="$SYSTEMCTL_ERROR" RESTORE_CONFIRM=RESTORE_PRODUCTION \
  run_restore "$BASE_BACKUP" "$DATA_DIR" --allow-production --force 2>&1)"
SYSTEMCTL_RC=$?
set -e
assert_eq "$SYSTEMCTL_RC" 2
assert_contains "$SYSTEMCTL_OUTPUT" "production restore is unavailable"
assert_not_file "$SYSTEMCTL_WITNESS"
assert_eq "$(file_sha256 "$DATA_DIR/cosmos.db")" "$LIVE_SHA_BEFORE_SYSTEMCTL"

note "TMPDIR aliases inside DATA_DIR fail before snapshot or target creation"
UNSAFE_TMP="$DATA_DIR/unsafe-restore-tmp"
mkdir -p "$UNSAFE_TMP"
UNSAFE_TMP_TARGET="$ROOT/unsafe-tmp-target"
set +e
UNSAFE_TMP_OUTPUT="$(TMPDIR="$UNSAFE_TMP" run_restore \
  "$BASE_BACKUP" "$UNSAFE_TMP_TARGET" 2>&1)"
UNSAFE_TMP_RC=$?
set -e
[ "$UNSAFE_TMP_RC" -ne 0 ] || fail_test "restore unexpectedly accepted TMPDIR inside DATA_DIR"
pass_assertion
assert_contains "$UNSAFE_TMP_OUTPUT" "refusing unsafe TMPDIR"
assert_not_file "$UNSAFE_TMP_TARGET"

note "fixed production marker and drill-report aliases refuse before mutation"
FIXED_MARKER_TARGET="$ROOT/fixed-marker-target"
set +e
FIXED_MARKER_OUTPUT="$(COSMOS_RESTORE_TEST_MODE=1 \
  RESTORE_TEST_STAGE_READY_MARKER=/var/lib/cosmos/ops/df32-restore-marker \
  RESTORE_TEST_STAGE_CONTINUE_MARKER="$ROOT/fixed-marker-continue" \
  run_restore "$BASE_BACKUP" "$FIXED_MARKER_TARGET" 2>&1)"
FIXED_MARKER_RC=$?
set -e
[ "$FIXED_MARKER_RC" -ne 0 ] || fail_test "restore accepted a fixed production marker"
pass_assertion
assert_contains "$FIXED_MARKER_OUTPUT" "restore test marker intersects a fixed production root"
assert_not_file "$FIXED_MARKER_TARGET"
ln -s /var/lib "$ROOT/fixed-drill-var-lib-alias"
assert_failure env NODE="$BOUND_NODE" DATA_DIR="$DATA_DIR" OPS_STATE_DIR="$OPS_STATE_DIR" \
  BACKUP_DIR="$BACKUP_DIR" \
  DRILL_DIR="$ROOT/fixed-drill-var-lib-alias/cosmos/ops/df32-drill-report" \
  TMPDIR="$ROOT" /bin/bash "$DRILL"

note "a failed forced restore preserves every pre-existing target artifact"
PRESERVE_TARGET="$ROOT/preserve-target"
mkdir -p "$PRESERVE_TARGET/evidence"
sqlite3 "$PRESERVE_TARGET/cosmos.db" 'CREATE TABLE old_state(value TEXT); INSERT INTO old_state VALUES ("keep");'
printf 'keep-sentinel\n' > "$PRESERVE_TARGET/sentinel.txt"
printf 'keep-evidence\n' > "$PRESERVE_TARGET/evidence/old.txt"
printf 'keep-wal\n' > "$PRESERVE_TARGET/cosmos.db-wal"
printf 'keep-shm\n' > "$PRESERVE_TARGET/cosmos.db-shm"
PRESERVE_DB_SHA="$(file_sha256 "$PRESERVE_TARGET/cosmos.db")"
PRESERVE_WAL_SHA="$(file_sha256 "$PRESERVE_TARGET/cosmos.db-wal")"
PRESERVE_SHM_SHA="$(file_sha256 "$PRESERVE_TARGET/cosmos.db-shm")"
assert_failure run_restore "$MISMATCH" "$PRESERVE_TARGET" --force
assert_eq "$(file_sha256 "$PRESERVE_TARGET/cosmos.db")" "$PRESERVE_DB_SHA"
assert_eq "$(file_sha256 "$PRESERVE_TARGET/cosmos.db-wal")" "$PRESERVE_WAL_SHA"
assert_eq "$(file_sha256 "$PRESERVE_TARGET/cosmos.db-shm")" "$PRESERVE_SHM_SHA"
assert_eq "$(cat "$PRESERVE_TARGET/sentinel.txt")" keep-sentinel
assert_eq "$(cat "$PRESERVE_TARGET/evidence/old.txt")" keep-evidence
assert_not_file "$PRESERVE_TARGET/restore-report.json"

note "a mid-commit failure rolls back only paths actually moved or published"
ROLLBACK_TARGET="$ROOT/rollback-target"
mkdir -p "$ROLLBACK_TARGET/evidence"
sqlite3 "$ROLLBACK_TARGET/cosmos.db" \
  'CREATE TABLE old_state(value TEXT); INSERT INTO old_state VALUES ("rollback-keep");'
printf 'rollback-wal\n' > "$ROLLBACK_TARGET/cosmos.db-wal"
printf 'rollback-shm\n' > "$ROLLBACK_TARGET/cosmos.db-shm"
printf 'rollback-evidence\n' > "$ROLLBACK_TARGET/evidence/old.txt"
printf '{"old":true}\n' > "$ROLLBACK_TARGET/restore-report.json"
printf 'unowned\n' > "$ROLLBACK_TARGET/sentinel.txt"
ROLLBACK_DB_SHA="$(file_sha256 "$ROLLBACK_TARGET/cosmos.db")"
ROLLBACK_WAL_SHA="$(file_sha256 "$ROLLBACK_TARGET/cosmos.db-wal")"
ROLLBACK_SHM_SHA="$(file_sha256 "$ROLLBACK_TARGET/cosmos.db-shm")"
set +e
ROLLBACK_OUTPUT="$(COSMOS_RESTORE_TEST_MODE=1 \
  RESTORE_TEST_FAIL_AFTER_PUBLISH=cosmos.db \
  run_restore "$BASE_BACKUP" "$ROLLBACK_TARGET" --force 2>&1)"
ROLLBACK_RC=$?
set -e
[ "$ROLLBACK_RC" -ne 0 ] || fail_test "injected mid-commit restore unexpectedly passed"
pass_assertion
assert_contains "$ROLLBACK_OUTPUT" "injected restore test failure after publishing cosmos.db"
assert_eq "$(file_sha256 "$ROLLBACK_TARGET/cosmos.db")" "$ROLLBACK_DB_SHA"
assert_eq "$(file_sha256 "$ROLLBACK_TARGET/cosmos.db-wal")" "$ROLLBACK_WAL_SHA"
assert_eq "$(file_sha256 "$ROLLBACK_TARGET/cosmos.db-shm")" "$ROLLBACK_SHM_SHA"
assert_eq "$(cat "$ROLLBACK_TARGET/evidence/old.txt")" rollback-evidence
assert_eq "$(cat "$ROLLBACK_TARGET/restore-report.json")" '{"old":true}'
assert_eq "$(cat "$ROLLBACK_TARGET/sentinel.txt")" unowned
assert_eq "$(find "$ROLLBACK_TARGET" -maxdepth 1 -name '.restore-*' | wc -l | tr -d ' ')" 0

note "a failed first publication restores an absent target to true absence"
ABSENT_ROLLBACK_TARGET="$ROOT/absent-rollback-target"
set +e
ABSENT_ROLLBACK_OUTPUT="$(COSMOS_RESTORE_TEST_MODE=1 \
  RESTORE_TEST_FAIL_AFTER_PUBLISH=cosmos.db \
  run_restore "$BASE_BACKUP" "$ABSENT_ROLLBACK_TARGET" 2>&1)"
ABSENT_ROLLBACK_RC=$?
set -e
[ "$ABSENT_ROLLBACK_RC" -ne 0 ] || fail_test "injected absent-target restore unexpectedly passed"
pass_assertion
assert_contains "$ABSENT_ROLLBACK_OUTPUT" "injected restore test failure after publishing cosmos.db"
assert_not_file "$ABSENT_ROLLBACK_TARGET"

note "an incomplete rollback is loud and preserves exact recovery evidence"
ROLLBACK_INCOMPLETE="$ROOT/rollback-incomplete"
mkdir -p "$ROLLBACK_INCOMPLETE"
sqlite3 "$ROLLBACK_INCOMPLETE/cosmos.db" \
  'CREATE TABLE old_state(value TEXT); INSERT INTO old_state VALUES ("preserve-in-rollback");'
ROLLBACK_INCOMPLETE_SHA="$(file_sha256 "$ROLLBACK_INCOMPLETE/cosmos.db")"
set +e
ROLLBACK_INCOMPLETE_OUTPUT="$(COSMOS_RESTORE_TEST_MODE=1 \
  RESTORE_TEST_FAIL_AFTER_PUBLISH=cosmos.db \
  RESTORE_TEST_FAIL_ROLLBACK_FOR=cosmos.db \
  run_restore "$BASE_BACKUP" "$ROLLBACK_INCOMPLETE" --force 2>&1)"
ROLLBACK_INCOMPLETE_RC=$?
set -e
[ "$ROLLBACK_INCOMPLETE_RC" -ne 0 ] || fail_test "injected rollback failure unexpectedly passed"
pass_assertion
assert_contains "$ROLLBACK_INCOMPLETE_OUTPUT" "RESTORE ROLLBACK INCOMPLETE"
ROLLBACK_EVIDENCE_DIR="$(find "$ROLLBACK_INCOMPLETE" -maxdepth 1 \
  -type d -name '.restore-rollback.*' | head -n 1)"
[ -n "$ROLLBACK_EVIDENCE_DIR" ] || fail_test "missing preserved rollback directory"
pass_assertion
assert_file "$ROLLBACK_EVIDENCE_DIR/ROLLBACK_INCOMPLETE.txt"
assert_eq "$(file_sha256 "$ROLLBACK_EVIDENCE_DIR/cosmos.db")" "$ROLLBACK_INCOMPLETE_SHA"

note "missing and undeclared archives both fail the exact-inventory gate"
MISSING="$ROOT/missing"
cp -R "$BASE_BACKUP" "$MISSING"
rm "$MISSING/evidence-2.tar.gz"
assert_failure run_restore "$MISSING" "$ROOT/missing-target"
assert_not_file "$ROOT/missing-target"

EXTRA="$ROOT/extra"
cp -R "$BASE_BACKUP" "$EXTRA"
cp "$EXTRA/evidence-1.tar.gz" "$EXTRA/evidence-4.tar.gz"
assert_failure run_restore "$EXTRA" "$ROOT/extra-target"
assert_not_file "$ROOT/extra-target"

note "a hash-rebound symlink archive is still unsafe and is rejected"
SYMLINK_CASE="$ROOT/symlink-case"
cp -R "$BASE_BACKUP" "$SYMLINK_CASE"
SYMLINK_TREE="$ROOT/symlink-tree"
OUTSIDE="$ROOT/outside-sentinel.txt"
mkdir -p "$SYMLINK_TREE/source-evidence"
printf 'outside-safe\n' > "$OUTSIDE"
printf 'safe-member\n' > "$SYMLINK_TREE/source-evidence/proof.txt"
ln -s "$OUTSIDE" "$SYMLINK_TREE/source-evidence/escape-link"
tar -czf "$SYMLINK_CASE/evidence-1.tar.gz" -C "$SYMLINK_TREE" source-evidence
set_archive_sha "$SYMLINK_CASE" evidence-1.tar.gz
assert_failure run_restore "$SYMLINK_CASE" "$ROOT/symlink-target"
assert_not_file "$ROOT/symlink-target"
assert_eq "$(cat "$OUTSIDE")" outside-safe

note "hardlink, FIFO, duplicate, and truncated archives fail before publish"
for hostile_kind in hardlink fifo duplicate; do
  HOSTILE_CASE="$ROOT/$hostile_kind-case"
  HOSTILE_TARGET="$ROOT/$hostile_kind-target"
  cp -R "$BASE_BACKUP" "$HOSTILE_CASE"
  write_hostile_archive "$HOSTILE_CASE/evidence-1.tar.gz" "$hostile_kind"
  set_archive_sha "$HOSTILE_CASE" evidence-1.tar.gz
  if [ "$hostile_kind" = duplicate ]; then
    HOSTILE_REASON="duplicate, case-colliding, or Unicode-colliding"
  else
    HOSTILE_REASON="not regular-or-directory"
  fi
  assert_failure_contains "$HOSTILE_REASON" run_restore "$HOSTILE_CASE" "$HOSTILE_TARGET"
  assert_not_file "$HOSTILE_TARGET"
done

note "case and canonical-Unicode collisions are rejected before extraction"
for collision_kind in case-collision unicode-collision; do
  COLLISION_CASE="$ROOT/$collision_kind-case"
  COLLISION_TARGET="$ROOT/$collision_kind-target"
  cp -R "$BASE_BACKUP" "$COLLISION_CASE"
  write_hostile_archive "$COLLISION_CASE/evidence-1.tar.gz" "$collision_kind"
  set_archive_sha "$COLLISION_CASE" evidence-1.tar.gz
  assert_failure_contains "duplicate, case-colliding, or Unicode-colliding" \
    run_restore "$COLLISION_CASE" "$COLLISION_TARGET"
  assert_not_file "$COLLISION_TARGET"
done

note "aggregate expanded-byte ceilings are enforced before extraction"
RESOURCE_CASE="$ROOT/resource-case"
RESOURCE_TARGET="$ROOT/resource-target"
cp -R "$BASE_BACKUP" "$RESOURCE_CASE"
write_hostile_archive "$RESOURCE_CASE/evidence-1.tar.gz" resource
set_archive_sha "$RESOURCE_CASE" evidence-1.tar.gz
set +e
RESOURCE_OUTPUT="$(RESTORE_MAX_TOTAL_EXPANDED_BYTES=128 \
  run_restore "$RESOURCE_CASE" "$RESOURCE_TARGET" 2>&1)"
RESOURCE_RC=$?
set -e
[ "$RESOURCE_RC" -ne 0 ] || fail_test "expanded-byte resource case unexpectedly passed"
pass_assertion
assert_contains "$RESOURCE_OUTPUT" "resource limit exceeded before extraction"
assert_not_file "$RESOURCE_TARGET"

TRUNCATED_CASE="$ROOT/truncated-case"
cp -R "$BASE_BACKUP" "$TRUNCATED_CASE"
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  fs.truncateSync(file, Math.max(32, Math.floor(fs.statSync(file).size / 2)));
' "$TRUNCATED_CASE/evidence-1.tar.gz"
set_archive_sha "$TRUNCATED_CASE" evidence-1.tar.gz
assert_failure_contains "failed within bounded tar execution" \
  run_restore "$TRUNCATED_CASE" "$ROOT/truncated-target"
assert_not_file "$ROOT/truncated-target"

note "a traversal member fails before the database or filesystem is published"
TRAVERSAL_CASE="$ROOT/traversal-case"
cp -R "$BASE_BACKUP" "$TRAVERSAL_CASE"
node - "$TRAVERSAL_CASE/evidence-1.tar.gz" <<'NODE'
const fs = require('fs');
const zlib = require('zlib');
const output = process.argv[2];
const data = Buffer.from('escape-attempt\n');
const header = Buffer.alloc(512);
const put = (offset, length, value) => header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii');
const octal = (offset, length, value) => put(offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
put(0, 100, '../escape.txt');
octal(100, 8, 0o600);
octal(108, 8, 0);
octal(116, 8, 0);
octal(124, 12, data.length);
octal(136, 12, 0);
header.fill(0x20, 148, 156);
put(156, 1, '0');
put(257, 6, 'ustar\0');
put(263, 2, '00');
const checksum = header.reduce((sum, byte) => sum + byte, 0);
put(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
const archive = Buffer.concat([header, data, padding, Buffer.alloc(1024)]);
fs.writeFileSync(output, zlib.gzipSync(archive));
NODE
set_archive_sha "$TRAVERSAL_CASE" evidence-1.tar.gz
TRAVERSAL_OUTSIDE="$ROOT/escape.txt"
printf 'still-safe\n' > "$TRAVERSAL_OUTSIDE"
assert_failure run_restore "$TRAVERSAL_CASE" "$ROOT/traversal-target"
assert_not_file "$ROOT/traversal-target"
assert_eq "$(cat "$TRAVERSAL_OUTSIDE")" still-safe

note "the drill checks declared archive count and records an untouched failure target"
DRILL_BACKUPS="$ROOT/drill-backups"
DRILL_REPORTS="$ROOT/drill-reports"
mkdir -p "$DRILL_BACKUPS"
cp -R "$BASE_BACKUP" "$DRILL_BACKUPS/$(basename "$BASE_BACKUP")"
PRODUCTION_SHA="$(file_sha256 "$DATA_DIR/cosmos.db")"
assert_success env DATA_DIR="$DATA_DIR" OPS_STATE_DIR="$OPS_STATE_DIR" \
  BACKUP_DIR="$DRILL_BACKUPS" DRILL_DIR="$DRILL_REPORTS" TMPDIR="$ROOT" \
  NODE="$BOUND_NODE" bash "$DRILL"
GOOD_DRILL_REPORT="$DRILL_REPORTS/$(ls -1 "$DRILL_REPORTS" | sort | tail -1)"
assert_eq "$(node -e '
  const report = require(process.argv[1]);
  const check = report.checks.find((item) => item.name === "evidenceArchives");
  process.stdout.write(String(Boolean(check && check.ok)));
' "$GOOD_DRILL_REPORT")" true
assert_eq "$(node -e '
  const report = require(process.argv[1]);
  const check = report.checks.find((item) => item.name === "archiveIntegrity");
  process.stdout.write(String(Boolean(check && check.ok)));
' "$GOOD_DRILL_REPORT")" true
assert_eq "$(file_sha256 "$DATA_DIR/cosmos.db")" "$PRODUCTION_SHA"

sleep 1.1
DRILL_BACKUP="$DRILL_BACKUPS/$(basename "$BASE_BACKUP")"
replace_first_archive "$DRILL_BACKUP" drill-tamper
assert_failure env DATA_DIR="$DATA_DIR" OPS_STATE_DIR="$OPS_STATE_DIR" \
  BACKUP_DIR="$DRILL_BACKUPS" DRILL_DIR="$DRILL_REPORTS" TMPDIR="$ROOT" \
  NODE="$BOUND_NODE" bash "$DRILL"
BAD_DRILL_REPORT="$DRILL_REPORTS/$(ls -1 "$DRILL_REPORTS" | sort | tail -1)"
assert_eq "$(node -e 'process.stdout.write(String(require(process.argv[1]).ok))' "$BAD_DRILL_REPORT")" false
assert_eq "$(node -e '
  const report = require(process.argv[1]);
  const check = report.checks.find((item) => item.name === "restore");
  process.stdout.write(String(Boolean(check && !check.ok)));
' "$BAD_DRILL_REPORT")" true
assert_eq "$(node -e '
  const report = require(process.argv[1]);
  const check = report.checks.find((item) => item.name === "archiveIntegrity");
  process.stdout.write(String(Boolean(check && !check.ok)));
' "$BAD_DRILL_REPORT")" true
assert_eq "$(node -e '
  const report = require(process.argv[1]);
  const check = report.checks.find((item) => item.name === "targetAbsentAfterFailure");
  process.stdout.write(String(Boolean(check && check.ok)));
' "$BAD_DRILL_REPORT")" true
assert_eq "$(file_sha256 "$DATA_DIR/cosmos.db")" "$PRODUCTION_SHA"

finish
