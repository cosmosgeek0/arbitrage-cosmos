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
  // A v2 schema below the publisher's floor: the publisher only writes a backup
  // taken at a real applied migration, so 0 is one short of the lowest
  // acceptable dataSchema and the rollbackFloor still coheres with it.
  v2ZeroSchema: () => ({ ...manifest, ...recovery, dataSchema: 0 }),
  // The v2 field set carried by a manifest that declares no version at all.
  v2FieldsWithoutVersion: () => {
    const { schemaVersion, ...rest } = { ...manifest, ...recovery };
    return rest;
  },
  // Canonical JSON that is not a manifest object at all. The version read must
  // refuse this rather than crash on it.
  nullDocument: () => null,
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

note "a manifest that is not an object is refused before its version is read"
write_manifest 1 nullDocument
# The full blocked line, not just the reason: reading schemaVersion off a null
# document throws a TypeError, and a TypeError is an uncaught crash rather than
# the refusal this gate owes its caller. Matching the I00_OPS_BLOCKED prefix is
# what distinguishes the two.
assert_failure_contains 'I00_OPS_BLOCKED: backup manifest must be an object' \
  node "$INSPECTOR" --path "$BACKUP"

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

# The publisher counts the events it captured and takes the backup at an applied
# migration before it writes, so at version 2 neither the version-1 unknown-count
# sentinel of -1 nor a schema of zero can occur. The accepted edge of each bound
# is exercised alongside the rejected one, so each check is proven to be a floor
# rather than a blanket refusal: eventsCount 0 is accepted here, and dataSchema 1
# is the accepted floor already carried by the end-to-end v2 acceptance above.
note "version 2 acceptance is bound to the counts and schemas the publisher writes"
write_manifest 0 v2
ZERO_EVENTS="$(node "$INSPECTOR" --path "$BACKUP")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$ZERO_EVENTS")" \
  BACKUP_SOURCE_IDENTITY_VERIFIED
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).eventsCount))' "$ZERO_EVENTS")" 0
write_manifest -1 v2
assert_failure_contains 'does not describe one complete verified v2 backup' \
  node "$INSPECTOR" --path "$BACKUP"
write_manifest 1 v2ZeroSchema
assert_failure_contains 'does not describe one complete verified v2 backup' \
  node "$INSPECTOR" --path "$BACKUP"

note "the version 2 bounds do not narrow what version 1 has always accepted"
write_manifest -1 v1
UNKNOWN_EVENTS="$(node "$INSPECTOR" --path "$BACKUP")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).status)' "$UNKNOWN_EVENTS")" \
  BACKUP_SOURCE_IDENTITY_VERIFIED
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).eventsCount))' "$UNKNOWN_EVENTS")" -1

PUBLISHER="$I00_ROOT/../live/bin/backup.sh"
RESTORE="$I00_ROOT/../live/bin/restore.sh"

# The outcome recorder and the bound-effect runner validate the same published
# manifest, but only behind a full authorized-effect chain that cannot be raised
# here, and the restore path validates it as root on a production host. Their key
# sets are therefore checked as declarations: the defect this suite exists to
# catch is a reader drifting away from what the publisher writes, and that drift
# is visible in the declared sets whether or not the privileged path can be
# exercised on this host.
#
# The expected sets are not restated here. They are read from what the publisher
# itself declares, so that a publisher that adds or drops a field fails this
# guard against every reader that did not follow, rather than agreeing with a
# copy of an old field set frozen into this test. Takes the publisher and the
# readers to check as arguments so the guard itself can be proven against a
# known-drifted copy of either.
assert_manifest_key_sets() {
  node - "$@" <<'NODE'
const fs = require('fs');
const [publisher, ...readers] = process.argv.slice(2);
// Every key set this guard reads is a bounded array literal of quoted names:
// the anchor names the declaration and the first ] closes it. A declaration
// that is absent, duplicated, or unbounded is an error rather than an empty
// set, so a renamed or restructured literal can never be read as agreement.
const literal = (source, anchor, label) => {
  const at = source.indexOf(anchor);
  if (at === -1) throw new Error(`${label} does not declare ${anchor}`);
  if (source.indexOf(anchor, at + anchor.length) !== -1) {
    throw new Error(`${label} declares ${anchor} more than once`);
  }
  const open = source.indexOf('[', at);
  const close = source.indexOf(']', open);
  if (close === -1) throw new Error(`${label} does not bound ${anchor}`);
  const keys = [...source.slice(open, close).matchAll(/'([^']+)'/gu)].map((m) => m[1]);
  if (keys.length === 0) throw new Error(`${label} declares an empty ${anchor}`);
  return keys;
};
const same = (left, right) => left.length === right.length
  && [...left].sort().every((key, index) => key === [...right].sort()[index]);
// The one field set ops/live/bin/backup.sh declares is the set it publishes at
// schemaVersion 2 and re-reads its own publications against.
const PUBLISHED_V2 = literal(
  fs.readFileSync(publisher, 'utf8'), 'const keys = [', publisher,
);
// Version 1 is the legacy shape: the published set without the four fields
// version 2 added. Deriving it keeps it bound to the publisher too, and a
// publisher that stops declaring one of those four is an error here rather than
// a version-1 set that quietly grew a key.
const ADDED_AT_V2 = ['schemaVersion', 'journalState', 'rollbackFloor', 'sourceJournalSha256'];
for (const key of ADDED_AT_V2) {
  if (!PUBLISHED_V2.includes(key)) {
    throw new Error(`${publisher} no longer declares the version-2 field ${key}`);
  }
}
const PUBLISHED_V1 = PUBLISHED_V2.filter((key) => !ADDED_AT_V2.includes(key));
for (const file of readers) {
  const source = fs.readFileSync(file, 'utf8');
  // The i00 consumers read both versions and declare a named set for each. The
  // restore path accepts only version 2 and declares that one set inline at the
  // call that enforces it. A reader matching neither shape is refused rather
  // than skipped, so this guard cannot silently cover nothing.
  const consumer = source.includes('const BACKUP_MANIFEST_V2_KEYS = Object.freeze([');
  const restore = source.includes('exactKeys(manifest, [');
  if (!consumer && !restore) {
    throw new Error(`${file} declares no backup manifest key set this guard can read`);
  }
  const agrees = consumer
    ? same(literal(source, 'const BACKUP_MANIFEST_V1_KEYS = Object.freeze([', file), PUBLISHED_V1)
      && same(literal(source, 'const BACKUP_MANIFEST_V2_KEYS = Object.freeze([', file), PUBLISHED_V2)
    : same(literal(source, 'exactKeys(manifest, [', file), PUBLISHED_V2);
  if (!agrees) {
    throw new Error(`${file} does not declare the published manifest key sets`);
  }
}
NODE
}

# Rewrites one key-set declaration so it no longer matches, by dropping a single
# key from the bounded literal the guard reads. It throws rather than emitting an
# unchanged copy if it cannot actually introduce that drift, so the negative
# controls below can never pass vacuously against a file it failed to edit.
drift_key_set() {
  node - "$@" <<'NODE'
const fs = require('fs');
const [anchor, key, source, destination] = process.argv.slice(2);
const text = fs.readFileSync(source, 'utf8');
const at = text.indexOf(anchor);
if (at === -1) throw new Error(`${source} does not declare ${anchor}`);
const open = text.indexOf('[', at);
const close = text.indexOf(']', open);
if (close === -1) throw new Error(`${source} does not bound ${anchor}`);
const block = text.slice(open, close);
if (!block.includes(`'${key}',`)) {
  throw new Error(`${source} does not declare ${key} in ${anchor}`);
}
fs.writeFileSync(
  destination,
  text.slice(0, open) + block.replace(`'${key}',`, '') + text.slice(close),
);
NODE
}

note "every backup manifest reader declares the key set the publisher declares"
assert_success assert_manifest_key_sets "$PUBLISHER" \
  "$I00_ROOT/bin/inspect-backup-source.mjs" \
  "$I00_ROOT/bin/record-authorized-action-outcome.mjs" \
  "$I00_ROOT/bin/run-bound-effect.mjs" \
  "$RESTORE"

note "the key-set guard rejects an i00 consumer drifted from the publisher"
DRIFTED_CONSUMER="$TEST_TMP/drifted-consumer.mjs"
assert_success drift_key_set 'const BACKUP_MANIFEST_V2_KEYS = Object.freeze([' \
  rollbackFloor "$I00_ROOT/bin/run-bound-effect.mjs" "$DRIFTED_CONSUMER"
assert_failure_contains 'does not declare the published manifest key sets' \
  assert_manifest_key_sets "$PUBLISHER" "$DRIFTED_CONSUMER"

note "the key-set guard rejects the restore path drifted from the publisher"
DRIFTED_RESTORE="$TEST_TMP/drifted-restore.sh"
assert_success drift_key_set 'exactKeys(manifest, [' \
  dbBytes "$RESTORE" "$DRIFTED_RESTORE"
assert_failure_contains 'does not declare the published manifest key sets' \
  assert_manifest_key_sets "$PUBLISHER" "$DRIFTED_RESTORE"

# Proves the expected sets are genuinely read from the publisher rather than
# restated: dropping a field from the publisher must fail the readers that still
# declare it. dbBytes is dropped because it belongs to both versions, so the
# mismatch lands on the readers rather than on the version-2 derivation.
note "the key-set guard rejects readers that did not follow a drifted publisher"
DRIFTED_PUBLISHER="$TEST_TMP/drifted-publisher.sh"
assert_success drift_key_set 'const keys = [' \
  dbBytes "$PUBLISHER" "$DRIFTED_PUBLISHER"
assert_failure_contains 'does not declare the published manifest key sets' \
  assert_manifest_key_sets "$DRIFTED_PUBLISHER" \
  "$I00_ROOT/bin/inspect-backup-source.mjs" \
  "$I00_ROOT/bin/record-authorized-action-outcome.mjs" \
  "$I00_ROOT/bin/run-bound-effect.mjs" \
  "$RESTORE"

finish
