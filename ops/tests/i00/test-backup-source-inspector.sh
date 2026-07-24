#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

INSPECTOR="$I00_ROOT/bin/inspect-backup-source.mjs"
BACKUP_REQUESTED="$TEST_TMP/2026-07-24T00-00-00Z"
mkdir -m 700 "$BACKUP_REQUESTED"
BACKUP="$(node -e 'process.stdout.write(require("fs").realpathSync.native(process.argv[1]))' "$BACKUP_REQUESTED")"
DATABASE="$BACKUP/cosmos.db"
ARCHIVE="$BACKUP/evidence-1.tar.gz"
MANIFEST="$BACKUP/manifest.json"

printf 'bounded-database-fixture\n' >"$DATABASE"
printf 'bounded-archive-fixture\n' >"$ARCHIVE"
chmod 600 "$DATABASE" "$ARCHIVE"

write_manifest() {
  local events_count="$1"
  node - "$BACKUP" "$events_count" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [root, eventsRaw] = process.argv.slice(2);
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const database = path.join(root, 'cosmos.db');
const archive = path.join(root, 'evidence-1.tar.gz');
const manifest = {
  backupId: path.basename(root),
  createdAtUtc: '2026-07-24T00:00:00Z',
  dbFile: 'cosmos.db',
  dbSha256: digest(database),
  dbBytes: fs.statSync(database).size,
  eventsCount: Number(eventsRaw),
  dataSchema: 1,
  integrityCheck: 'ok',
  evidence: [{
    source: '/var/lib/cosmos/evidence',
    archive: 'evidence-1.tar.gz',
    sha256: digest(archive),
  }],
};
fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'w',
  mode: 0o600,
});
fs.chmodSync(path.join(root, 'manifest.json'), 0o600);
NODE
}

note "full backup semantics and archive inventory are bound"
write_manifest 1
INITIAL="$(node "$INSPECTOR" --path "$BACKUP")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$INITIAL")" \
  BACKUP_SOURCE_IDENTITY_VERIFIED
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).archiveCount))' "$INITIAL")" 1
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).eventsCount))' "$INITIAL")" 1

note "archive replacement and undeclared inventory are rejected"
printf 'replacement\n' >"$ARCHIVE"
assert_failure_contains 'archive digest differs from its manifest' \
  node "$INSPECTOR" --path "$BACKUP"
printf 'bounded-archive-fixture\n' >"$ARCHIVE"
write_manifest 1
printf 'undeclared\n' >"$BACKUP/extra"
chmod 600 "$BACKUP/extra"
assert_failure_contains 'inventory differs from its manifest' \
  node "$INSPECTOR" --path "$BACKUP"
rm "$BACKUP/extra"

note "malformed semantic metadata is rejected"
write_manifest -2
assert_failure_contains 'does not describe one complete verified backup' \
  node "$INSPECTOR" --path "$BACKUP"

finish
