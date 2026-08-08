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

# Writes one manifest fixture. The second argument selects the schema shape:
# `v1` is the legacy manifest with no schemaVersion, `v2` is what the publisher
# writes today, and the remaining variants are hostile shapes that must never be
# read as a verified backup source.
write_manifest() {
  local events_count="$1"
  local variant="${2:-v1}"
  node - "$BACKUP" "$events_count" "$variant" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [root, eventsRaw, variant] = process.argv.slice(2);
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
// The recovery fields the publisher adds at schemaVersion 2.
const recovery = {
  schemaVersion: 2,
  journalState: 'PRESENT',
  rollbackFloor: 0,
  sourceJournalSha256: 'a'.repeat(64),
};
const variants = {
  v1: () => manifest,
  v2: () => ({ ...manifest, ...recovery }),
  // A version this build does not implement.
  unknownVersion: () => ({ ...manifest, ...recovery, schemaVersion: 3 }),
  // A well-formed v2 carrying one key outside the set the version owns.
  extraKey: () => ({ ...manifest, ...recovery, operatorNote: 'smuggled' }),
  // v2 recovery fields that do not cohere with the schema they claim.
  incoherentFloor: () => ({ ...manifest, ...recovery, rollbackFloor: 2 }),
  badJournalState: () => ({ ...manifest, ...recovery, journalState: 'DEGRADED' }),
  // The v2 field set carried by a manifest that declares no version at all.
  v2FieldsWithoutVersion: () => {
    const { schemaVersion, ...rest } = { ...manifest, ...recovery };
    return rest;
  },
};
const build = variants[variant];
if (build === undefined) throw new Error(`unknown manifest variant ${variant}`);
// The publisher writes canonical key order, so the fixtures do too.
const canonical = (value) => (Array.isArray(value) ? value.map(canonical)
  : (value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value));
fs.writeFileSync(
  path.join(root, 'manifest.json'),
  `${JSON.stringify(canonical(build()), null, 2)}\n`,
  { flag: 'w', mode: 0o600 },
);
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

note "a schemaVersion 2 publication is accepted end to end"
write_manifest 1 v2
V2="$(node "$INSPECTOR" --path "$BACKUP")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$V2")" \
  BACKUP_SOURCE_IDENTITY_VERIFIED
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).archiveCount))' "$V2")" 1
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).eventsCount))' "$V2")" 1
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).dataSchema))' "$V2")" 1

note "a legacy manifest with no schemaVersion is still accepted as version 1"
write_manifest 1 v1
LEGACY="$(node "$INSPECTOR" --path "$BACKUP")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$LEGACY")" \
  BACKUP_SOURCE_IDENTITY_VERIFIED
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).eventsCount))' "$LEGACY")" 1

note "an unknown schema version is refused rather than partially understood"
write_manifest 1 unknownVersion
assert_failure_contains 'backup manifest schema version is not supported' \
  node "$INSPECTOR" --path "$BACKUP"

note "an undeclared extra manifest key is refused at every version"
write_manifest 1 extraKey
assert_failure_contains 'backup manifest has an unexpected field set' \
  node "$INSPECTOR" --path "$BACKUP"
write_manifest 1 v2FieldsWithoutVersion
assert_failure_contains 'backup manifest has an unexpected field set' \
  node "$INSPECTOR" --path "$BACKUP"

note "version 2 recovery metadata is bound, not merely present"
write_manifest 1 incoherentFloor
assert_failure_contains 'does not describe one complete verified v2 backup' \
  node "$INSPECTOR" --path "$BACKUP"
write_manifest 1 badJournalState
assert_failure_contains 'does not describe one complete verified v2 backup' \
  node "$INSPECTOR" --path "$BACKUP"

# The outcome recorder validates the same published manifest, but only behind a
# full authorized-effect chain that cannot be raised here. Its key sets are
# therefore bound to this inspector's directly: the defect this suite exists to
# catch is a consumer drifting away from what the publisher writes, and that
# drift is visible in the declared sets whether or not the privileged path can
# be exercised on this host.
assert_consumer_key_sets() {
  node - "$I00_ROOT/bin/inspect-backup-source.mjs" \
    "$I00_ROOT/bin/record-authorized-action-outcome.mjs" <<'NODE'
const fs = require('fs');
// The exact field set ops/live/bin/backup.sh writes at schemaVersion 2.
const PUBLISHED_V2 = [
  'schemaVersion', 'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes',
  'eventsCount', 'journalState', 'dataSchema', 'rollbackFloor',
  'sourceJournalSha256', 'integrityCheck', 'evidence',
];
const PUBLISHED_V1 = [
  'backupId', 'createdAtUtc', 'dbFile', 'dbSha256', 'dbBytes', 'eventsCount',
  'dataSchema', 'integrityCheck', 'evidence',
];
const declared = (source, name) => {
  const anchor = source.indexOf(`const ${name} = Object.freeze([`);
  if (anchor === -1) throw new Error(`${name} is not declared`);
  const open = source.indexOf('[', anchor);
  const close = source.indexOf(']', open);
  if (close === -1) throw new Error(`${name} is not one bounded literal`);
  return [...source.slice(open, close).matchAll(/'([^']+)'/gu)].map((m) => m[1]);
};
const same = (left, right) => left.length === right.length
  && [...left].sort().every((key, index) => key === [...right].sort()[index]);
for (const file of process.argv.slice(2)) {
  const source = fs.readFileSync(file, 'utf8');
  if (!same(declared(source, 'BACKUP_MANIFEST_V1_KEYS'), PUBLISHED_V1)
      || !same(declared(source, 'BACKUP_MANIFEST_V2_KEYS'), PUBLISHED_V2)
      || !same(declared(source, 'BACKUP_JOURNAL_STATES'), ['PRESENT', 'PENDING', 'ABSENT'])) {
    throw new Error(`${file} does not declare the published manifest key sets`);
  }
}
NODE
}

note "every backup manifest consumer declares the same versioned key sets"
assert_success assert_consumer_key_sets

finish
