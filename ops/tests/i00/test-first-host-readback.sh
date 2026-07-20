#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

TEST_TMP_REAL="$(cd "$TEST_TMP" && pwd -P)"
TOOLS="$TEST_TMP_REAL/tools"
mkdir -p "$TOOLS"

cat > "$TOOLS/sqlite-safe" <<'SH'
#!/usr/bin/env bash
printf '3.51.3 2026-07-20 safe fixture\n'
SH
cat > "$TOOLS/sqlite-safe-different" <<'SH'
#!/usr/bin/env bash
printf '3.50.7 safe fixture\n'
SH
cat > "$TOOLS/sqlite-unsafe" <<'SH'
#!/usr/bin/env bash
printf '3.45.1 unsafe fixture\n'
SH
cat > "$TOOLS/sqlite-malformed" <<'SH'
#!/usr/bin/env bash
printf 'sqlite version three point fifty one\n'
SH
cat > "$TOOLS/sqlite-nonzero" <<'SH'
#!/usr/bin/env bash
printf '3.51.3\n'
exit 9
SH
cat > "$TOOLS/sqlite-self-replacing" <<'SH'
#!/usr/bin/env bash
cp "$0" "$0.next"
chmod 755 "$0.next"
mv -f "$0.next" "$0"
printf '3.51.3 self-replaced\n'
SH
cat > "$TOOLS/systemctl-inactive" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = is-active ] && [ "${2:-}" = cosmos-app.service ] || exit 9
printf 'inactive\n'
exit 3
SH
cat > "$TOOLS/systemctl-not-found" <<'SH'
#!/usr/bin/env bash
[ "${1:-}" = is-active ] && [ "${2:-}" = cosmos-app.service ] || exit 9
printf 'unknown\n'
exit 4
SH
cat > "$TOOLS/systemctl-active" <<'SH'
#!/usr/bin/env bash
printf 'active\n'
exit 0
SH
cat > "$TOOLS/systemctl-failed" <<'SH'
#!/usr/bin/env bash
printf 'failed\n'
exit 3
SH
cat > "$TOOLS/systemctl-ambiguous" <<'SH'
#!/usr/bin/env bash
printf 'unknown\n'
exit 3
SH
cat > "$TOOLS/systemctl-stderr" <<'SH'
#!/usr/bin/env bash
printf 'diagnostic\n' >&2
printf 'inactive\n'
exit 3
SH
chmod 755 "$TOOLS"/*

SHA=1111111111111111111111111111111111111111
RELEASE="$TEST_TMP_REAL/release-fixture/i00-$SHA"
node - "$RELEASE" "$SHA" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [root, sha] = process.argv.slice(2);
fs.mkdirSync(path.join(root, 'server/dist'), {recursive:true});
fs.mkdirSync(path.join(root, 'web/dist'), {recursive:true});
fs.writeFileSync(path.join(root, 'server/dist/index.js'), 'console.log("first-host fixture");\n', {mode:0o644});
fs.writeFileSync(path.join(root, 'web/dist/index.html'), '<!doctype html><title>first host</title>\n', {mode:0o644});
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fileDigest = (file) => digest(fs.readFileSync(file));
const treeDigest = (directory) => {
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(directory).sort()) {
    hash.update(name); hash.update('\0'); hash.update(fileDigest(path.join(directory, name))); hash.update('\n');
  }
  return hash.digest('hex');
};
const serverDistDigestSha256 = treeDigest(path.join(root, 'server/dist'));
const webDistDigestSha256 = treeDigest(path.join(root, 'web/dist'));
const releaseId = `i00-${sha}`;
const release = {
  releaseId, gitSha:sha, testedSha:sha, builtAtUtc:'2026-07-20T00:00:00Z',
  schemaVersion:1, rollbackBarrier:true, rollbackFloor:1,
  compatibilitySource:'server/dist/ledger.js', compatibilitySourceSha256:'a'.repeat(64),
  configRevision:'fixture', modelRevision:'UNAVAILABLE', testedReceipt:'fixture.json',
  testedReceiptSha256:'b'.repeat(64), acceptanceEvidence:{truthClass:'LOCAL_FIXTURE'},
  activationState:'NOT_DEPLOYED', sourceTree:'c'.repeat(40), sourceVerification:'SIMULATION_SOURCE',
  packageLockSha256:'d'.repeat(64), runtimeDepsDigestSha256:'e'.repeat(64),
  serverDistDigestSha256, webDistDigestSha256, runtimeDependencies:'BUNDLED_PREBUILT',
  l15OpsProvenance:{source:'FIXTURE'}, buildAttestation:{state:'FIXTURE'},
};
fs.writeFileSync(path.join(root, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, {mode:0o600});
const walk = (directory, relative='') => fs.readdirSync(path.join(directory, relative)).sort().flatMap((name) => {
  const next = relative ? `${relative}/${name}` : name;
  const stat = fs.lstatSync(path.join(directory, next));
  return stat.isDirectory() ? walk(directory, next) : [next];
});
const files = walk(root).map((relative) => ({
  path:relative, sha256:fileDigest(path.join(root, relative)), mode:fs.lstatSync(path.join(root, relative)).mode & 0o777,
}));
const manifest = {
  schemaVersion:1, releaseId, testedSha:sha,
  testedBuildOutputs:{serverDistDigestSha256,webDistDigestSha256},
  acceptanceEvidence:release.acceptanceEvidence, l15OpsProvenance:release.l15OpsProvenance,
  ledgerCompatibility:{schemaVersion:1,rollbackFloor:1,rollbackBarrier:true,compatibilitySource:release.compatibilitySource,compatibilitySourceSha256:release.compatibilitySourceSha256},
  buildAttestation:release.buildAttestation, files,
};
fs.writeFileSync(path.join(root, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {mode:0o600});
NODE
RELEASE="$(cd "$RELEASE" && pwd -P)"
PRODUCER="$I00_ROOT/bin/first-host-readback.mjs"
SANITIZER="$I00_ROOT/bin/sanitize-donor-env.mjs"

portable_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then stat -f '%Lp' "$1"
  else stat -c '%a' "$1"
  fi
}

prepare_case() {
  local name="$1"
  CASE_SYSTEMCTL="${2:-$TOOLS/systemctl-inactive}"
  CASE_BASE="$TEST_TMP_REAL/cases/$name"
  CASE_HOST_PARENT="$CASE_BASE/host"
  CASE_COSMOS="$CASE_HOST_PARENT/cosmos"
  CASE_DATA="$CASE_BASE/durable/data"
  CASE_OPS="$CASE_BASE/durable/ops"
  CASE_OUTPUT="$CASE_BASE/output"
  CASE_RAW_ENV="$CASE_BASE/config/raw.env"
  CASE_ENV="$CASE_BASE/config/sanitized.env"
  mkdir -p "$CASE_HOST_PARENT" "$CASE_BASE/durable" "$CASE_OUTPUT" "$CASE_BASE/config"
  chmod 700 "$CASE_OUTPUT"
  cat > "$CASE_RAW_ENV" <<ENV
COSMOS_ROOT=$CASE_COSMOS
RELEASES_DIR=$CASE_COSMOS/releases
CURRENT_LINK=$CASE_COSMOS/current
PREVIOUS_LINK=$CASE_COSMOS/previous
DATA_DIR=$CASE_DATA
OPS_STATE_DIR=$CASE_OPS
APP_UNIT=cosmos-app.service
HEALTH_BASE=http://127.0.0.1:8080
ENV
  node "$SANITIZER" --env "$CASE_RAW_ENV" --output "$CASE_ENV" --profile deploy \
    --require-first-host-no-current >/dev/null
}

run_case() {
  node "$PRODUCER" \
    --env "$CASE_ENV" \
    --release "$RELEASE" \
    --output-dir "$CASE_OUTPUT" \
    --account cosmos-production \
    --target-host cosmos-01.internal \
    --environment production \
    --backup-reserve-bytes 4096 \
    --sqlite "$TOOLS/sqlite-safe" \
    --systemctl "$CASE_SYSTEMCTL" \
    --now 2026-07-20T12:00:00Z
}

note "clean first-host evidence is canonical, exact-created, owner-bound, and live-derived"
prepare_case clean
assert_success run_case
for name in host.json supervisor.json collected-evidence.json sqlite-readback.json; do
  assert_file "$CASE_OUTPUT/$name"
  assert_eq "$(portable_mode "$CASE_OUTPUT/$name")" 600
done
assert_eq "$(ls -1A "$CASE_OUTPUT" | wc -l | tr -d ' ')" 4
node - "$CASE_OUTPUT" "$CASE_ENV" "$RELEASE" <<'NODE' || fail_test "canonical first-host evidence contract failed"
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [root, envPath, releasePath] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const exactKeys = (value, expected, label) => {
  if (Object.keys(value).join(',') !== expected.join(',')) throw new Error(`${label} keys`);
};
for (const name of ['host.json', 'supervisor.json', 'collected-evidence.json', 'sqlite-readback.json']) {
  const bytes = fs.readFileSync(path.join(root, name), 'utf8');
  if (bytes !== `${JSON.stringify(JSON.parse(bytes), null, 2)}\n`) throw new Error(`${name} serialization`);
}
const host = read('host.json');
const supervisor = read('supervisor.json');
const evidenceBytes = fs.readFileSync(path.join(root, 'collected-evidence.json'));
const evidence = JSON.parse(evidenceBytes);
const sqlite = read('sqlite-readback.json');
exactKeys(host, ['source','account','targetHost','environment','freeBytes','backupReserveBytes','sqliteVersion','evidenceSha256','observedAtUtc'], 'host');
exactKeys(supervisor, ['source','observedAtUtc','validUntilUtc','deploymentFrozen','exposureState','ambiguityState','recoveryState','currentSchemaVersion','rollbackFloor'], 'supervisor');
exactKeys(evidence, ['schemaVersion','source','recoveryTarget','observedAtUtc','validUntilUtc','owner','sanitizedDonorEnv','paths','release','sqliteReadback','disk','links','baseline','derived'], 'evidence');
exactKeys(evidence.owner, ['account','targetHost','environment','backupReserveBytes'], 'owner');
exactKeys(evidence.sanitizedDonorEnv, ['sha256'], 'sanitized env');
exactKeys(evidence.paths, ['cosmosRoot','releasesDir','currentLink','previousLink','dataDir','opsStateDir','journalFile','frozenMarker','moneyReadyMarker','releaseDestination'], 'paths');
exactKeys(evidence.release, ['path','releaseId','testedSha','artifactManifestSha256'], 'release');
exactKeys(sqlite, ['schemaVersion','source','observedAtUtc','path','sha256','version','identity'], 'sqlite');
exactKeys(sqlite.identity, ['device','inode','mode','size','mtimeNs','ctimeNs'], 'sqlite identity');
exactKeys(evidence.disk, ['targetPath','measuredPath','blockSize','availableBlocks','freeBytes'], 'disk');
exactKeys(evidence.links, ['current','previous'], 'links');
exactKeys(evidence.links.current, ['path','lstat'], 'current');
exactKeys(evidence.links.previous, ['path','lstat'], 'previous');
exactKeys(evidence.baseline, ['cosmosRoot','releasesDir','releaseDestination','dataDir','opsStateDir','journal','frozenMarker','moneyReadyMarker','unit'], 'baseline');
exactKeys(evidence.baseline.cosmosRoot, ['path','state','entryCount'], 'cosmos root');
exactKeys(evidence.baseline.unit, ['systemctlPath','unit','state','exitCode'], 'unit');
exactKeys(evidence.derived, ['cleanBaseline','deploymentFrozen','exposureState','ambiguityState','recoveryState','currentSchemaVersion','rollbackFloor'], 'derived');
if (host.source !== 'TARGET_HOST_OWNER_READBACK'
    || supervisor.source !== 'FIRST_HOST_BOOTSTRAP_READBACK'
    || evidence.source !== 'FIRST_HOST_BOOTSTRAP_EVIDENCE'
    || evidence.recoveryTarget !== 'NO_PRIOR_RELEASE_FIRST_HOST'
    || sqlite.source !== 'PINNED_SQLITE_EXECUTABLE_READBACK') throw new Error('sources');
if (crypto.createHash('sha256').update(evidenceBytes).digest('hex') !== host.evidenceSha256) throw new Error('evidence digest');
if (evidence.sanitizedDonorEnv.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(envPath)).digest('hex')) throw new Error('env digest');
if (evidence.release.artifactManifestSha256 !== crypto.createHash('sha256').update(fs.readFileSync(path.join(releasePath, 'artifact-manifest.json'))).digest('hex')) throw new Error('manifest digest');
if (evidence.release.path !== releasePath || evidence.release.testedSha !== '1111111111111111111111111111111111111111') throw new Error('release identity');
if (JSON.stringify(evidence.sqliteReadback) !== JSON.stringify(sqlite) || host.sqliteVersion !== sqlite.version) throw new Error('sqlite binding');
if (host.account !== evidence.owner.account || host.targetHost !== evidence.owner.targetHost
    || host.environment !== evidence.owner.environment || host.backupReserveBytes !== evidence.owner.backupReserveBytes) throw new Error('owner binding');
for (const [key, value] of Object.entries({account:'other',targetHost:'other.internal',environment:'staging',backupReserveBytes:4097})) {
  const changed = JSON.parse(JSON.stringify(evidence));
  changed.owner[key] = value;
  const digest = crypto.createHash('sha256').update(`${JSON.stringify(changed, null, 2)}\n`).digest('hex');
  if (digest === host.evidenceSha256) throw new Error(`owner digest ${key}`);
}
if (evidence.links.current.lstat !== 'ENOENT' || evidence.links.previous.lstat !== 'ENOENT') throw new Error('links');
for (const key of ['cosmosRoot','releasesDir','dataDir','opsStateDir']) {
  if (evidence.baseline[key].state !== 'ABSENT' || evidence.baseline[key].entryCount !== 0) throw new Error(`baseline ${key}`);
}
for (const key of ['releaseDestination','journal','frozenMarker','moneyReadyMarker']) {
  if (evidence.baseline[key].state !== 'ABSENT') throw new Error(`baseline ${key}`);
}
if (!evidence.baseline.unit.systemctlPath.endsWith('/systemctl-inactive')
    || evidence.baseline.unit.state !== 'INACTIVE' || evidence.baseline.unit.exitCode !== 3) throw new Error('unit');
if (JSON.stringify(evidence.derived) !== JSON.stringify({cleanBaseline:true,deploymentFrozen:false,exposureState:'NONE',ambiguityState:'NONE',recoveryState:'NONE',currentSchemaVersion:0,rollbackFloor:0})) throw new Error('derived');
if (Date.parse(evidence.validUntilUtc) - Date.parse(evidence.observedAtUtc) !== 600000) throw new Error('lease');
if (evidence.disk.targetPath !== evidence.paths.releaseDestination) throw new Error('statfs target');
const stat = fs.statfsSync(evidence.disk.measuredPath, {bigint:true});
let nearest = evidence.disk.targetPath;
while (!fs.existsSync(nearest)) nearest = path.dirname(nearest);
nearest = fs.realpathSync.native(nearest);
if (evidence.disk.measuredPath !== nearest || evidence.disk.blockSize !== stat.bsize.toString()
    || BigInt(evidence.disk.freeBytes) !== BigInt(evidence.disk.blockSize) * BigInt(evidence.disk.availableBlocks)
    || !Number.isSafeInteger(evidence.disk.freeBytes)
    || host.freeBytes !== evidence.disk.freeBytes) throw new Error('statfs arithmetic');
NODE
pass_assertion
assert_failure run_case

note "sqlite-only pins one canonical safe executable and rejects every unsafe identity/output"
SQLITE_OUT_DIR="$TEST_TMP_REAL/sqlite-output"
mkdir -p "$SQLITE_OUT_DIR"
chmod 700 "$SQLITE_OUT_DIR"
assert_success node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" --output "$SQLITE_OUT_DIR/readback.json" --now 2026-07-20T12:00:00Z
assert_eq "$(portable_mode "$SQLITE_OUT_DIR/readback.json")" 600
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" --output "$SQLITE_OUT_DIR/readback.json" --now 2026-07-20T12:00:00Z
assert_success node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe-different" --now 2026-07-20T12:00:00Z
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/missing" --now 2026-07-20T12:00:00Z
cp "$TOOLS/sqlite-safe" "$TOOLS/sqlite-nonexec"
chmod 644 "$TOOLS/sqlite-nonexec"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-nonexec" --now 2026-07-20T12:00:00Z
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/./sqlite-safe" --now 2026-07-20T12:00:00Z
ln -s "$TOOLS/sqlite-safe" "$TOOLS/sqlite-symlink"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-symlink" --now 2026-07-20T12:00:00Z
cp "$TOOLS/sqlite-safe" "$TOOLS/sqlite-writable"
chmod 775 "$TOOLS/sqlite-writable"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-writable" --now 2026-07-20T12:00:00Z
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-unsafe" --now 2026-07-20T12:00:00Z
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-malformed" --now 2026-07-20T12:00:00Z
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-nonzero" --now 2026-07-20T12:00:00Z
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-self-replacing" --now 2026-07-20T12:00:00Z
node - "$SQLITE_OUT_DIR/readback.json" "$TOOLS/sqlite-safe-different" "$PRODUCER" <<'NODE' || fail_test "safe-but-different SQLite equality test failed"
const fs = require('node:fs');
const cp = require('node:child_process');
const [firstPath, sqlite, producer] = process.argv.slice(2);
const first = JSON.parse(fs.readFileSync(firstPath));
const second = JSON.parse(cp.execFileSync(process.execPath, [producer,'--sqlite-only','--sqlite',sqlite,'--now','2026-07-20T12:00:01Z'], {encoding:'utf8'}));
const comparable = (v) => JSON.stringify({path:v.path,sha256:v.sha256,version:v.version,identity:v.identity});
if (first.version === second.version || comparable(first) === comparable(second)) process.exit(1);
NODE
pass_assertion

note "current and previous accept only an unambiguous lstat ENOENT leaf"
for leaf in current previous; do
  for kind in valid-link dangling-link file directory; do
    prepare_case "$leaf-$kind"
    mkdir -p "$CASE_COSMOS" "$CASE_BASE/target"
    target="$CASE_COSMOS/$leaf"
    case "$kind" in
      valid-link) ln -s "$CASE_BASE/target" "$target" ;;
      dangling-link) ln -s "$CASE_BASE/missing-target" "$target" ;;
      file) printf 'residue\n' > "$target" ;;
      directory) mkdir "$target" ;;
    esac
    assert_failure run_case
  done
done

note "release, durable, ops, journal, marker, and root residue all fail closed"
prepare_case releases-residue
mkdir -p "$CASE_COSMOS/releases/old-release"
assert_failure run_case
prepare_case release-destination-residue
release_id="$(node -e 'process.stdout.write(require(process.argv[1]).releaseId)' "$RELEASE/release.json")"
mkdir -p "$CASE_COSMOS/releases/$release_id"
assert_failure run_case
prepare_case data-residue
mkdir -p "$CASE_DATA" && printf 'x\n' > "$CASE_DATA/residue"
assert_failure run_case
prepare_case ops-residue
mkdir -p "$CASE_OPS" && printf 'x\n' > "$CASE_OPS/residue"
assert_failure run_case
prepare_case journal-residue
mkdir -p "$CASE_DATA" && printf '{broken\n' > "$CASE_DATA/journal-compat.json"
assert_failure run_case
prepare_case frozen-marker
mkdir -p "$CASE_OPS" && : > "$CASE_OPS/deploy-frozen.json"
assert_failure run_case
prepare_case money-marker
mkdir -p "$CASE_OPS" && : > "$CASE_OPS/money-ready"
assert_failure run_case
prepare_case root-residue
mkdir -p "$CASE_COSMOS" && printf 'x\n' > "$CASE_COSMOS/unowned"
assert_failure run_case
prepare_case staging-residue
mkdir -p "$CASE_COSMOS/releases/.staging-debris"
assert_failure run_case

note "clean existing root variants are explicit and accepted"
prepare_case empty-root
mkdir -p "$CASE_COSMOS"
assert_success run_case
assert_eq "$(node -e 'process.stdout.write(require(process.argv[1]).baseline.cosmosRoot.state)' "$CASE_OUTPUT/collected-evidence.json")" EMPTY_DIRECTORY
prepare_case empty-releases-root
mkdir -p "$CASE_COSMOS/releases"
assert_success run_case
assert_eq "$(node -e 'process.stdout.write(require(process.argv[1]).baseline.cosmosRoot.state)' "$CASE_OUTPUT/collected-evidence.json")" ONLY_EMPTY_RELEASES_DIRECTORY

note "symlink and dangling ancestors cannot masquerade as absent children"
prepare_case symlink-ancestor
mv "$CASE_HOST_PARENT" "$CASE_BASE/real-host"
ln -s "$CASE_BASE/real-host" "$CASE_HOST_PARENT"
assert_failure run_case
prepare_case dangling-ancestor
mv "$CASE_HOST_PARENT" "$CASE_BASE/real-host"
ln -s "$CASE_BASE/missing-host" "$CASE_HOST_PARENT"
assert_failure run_case
prepare_case releases-symlink
mkdir -p "$CASE_COSMOS" "$CASE_BASE/empty-target"
ln -s "$CASE_BASE/empty-target" "$CASE_COSMOS/releases"
assert_failure run_case
prepare_case data-symlink
mkdir -p "$CASE_BASE/empty-target"
ln -s "$CASE_BASE/empty-target" "$CASE_DATA"
assert_failure run_case
prepare_case ops-dangling
ln -s "$CASE_BASE/missing-target" "$CASE_OPS"
assert_failure run_case

note "unit state admits only exact inactive rc3 or exact not-found rc4"
prepare_case not-found "$TOOLS/systemctl-not-found"
assert_success run_case
assert_eq "$(node -e 'process.stdout.write(require(process.argv[1]).baseline.unit.state)' "$CASE_OUTPUT/collected-evidence.json")" NOT_FOUND
prepare_case active "$TOOLS/systemctl-active"
assert_failure run_case
prepare_case failed "$TOOLS/systemctl-failed"
assert_failure run_case
prepare_case ambiguous "$TOOLS/systemctl-ambiguous"
assert_failure run_case
prepare_case stderr "$TOOLS/systemctl-stderr"
assert_failure run_case

note "output directory and clock contracts fail closed"
prepare_case output-mode
chmod 755 "$CASE_OUTPUT"
assert_failure run_case
prepare_case output-nonempty
printf 'occupied\n' > "$CASE_OUTPUT/unowned"
assert_failure run_case
prepare_case future-clock
assert_failure node "$PRODUCER" --env "$CASE_ENV" --release "$RELEASE" --output-dir "$CASE_OUTPUT" \
  --account cosmos-production --target-host cosmos-01.internal --environment production \
  --backup-reserve-bytes 4096 --sqlite "$TOOLS/sqlite-safe" --systemctl "$TOOLS/systemctl-inactive" \
  --now 2026-07-20T12:00:00.000Z

finish
