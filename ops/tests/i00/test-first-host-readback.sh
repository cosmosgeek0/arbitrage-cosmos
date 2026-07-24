#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

TEST_TMP_REAL="$(cd "$TEST_TMP" && pwd -P)"
FIXED_TEST_TMP="$(node -e 'process.stdout.write(require("fs").realpathSync("/tmp"))')"
CLOCK_SIMULATION_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$FIXED_TEST_TMP/ip-ops-i00-sim-first-host-clock-$$")"
SQLITE_SWAP_ROOT=""
STAGING_FIRST_HOST_ROOT=""
cleanup_first_host_test() {
  local rc=$?
  local root
  for root in "$CLOCK_SIMULATION_ROOT" "${SQLITE_SWAP_ROOT:-}" "${SQLITE_SWAP_ROOT:-}.displaced"; do
    case "$root" in
      "$FIXED_TEST_TMP"/ip-ops-i00-sim-first-host-*)
        chmod -R u+w "$root" 2>/dev/null || true
        rm -rf "$root"
        ;;
    esac
  done
  case "${STAGING_FIRST_HOST_ROOT:-}" in
    /var/tmp/cosmos-df32-proof-[0-9a-f][0-9a-f][0-9a-f][0-9a-f])
      chmod -R u+w "$STAGING_FIRST_HOST_ROOT" 2>/dev/null || true
      rm -rf "$STAGING_FIRST_HOST_ROOT"
      ;;
  esac
  cleanup_test_tmp "$rc"
  return "$rc"
}
trap cleanup_first_host_test EXIT
EVIDENCE_ROOT="$CLOCK_SIMULATION_ROOT/first-host-evidence"
TEST_CONFIG_ROOT="$CLOCK_SIMULATION_ROOT/config"
mkdir "$EVIDENCE_ROOT" "$TEST_CONFIG_ROOT"
chmod 700 "$EVIDENCE_ROOT" "$TEST_CONFIG_ROOT"
FIXTURE_CLOCK=(
  --provenance-mode TEST
  --provenance-root "$CLOCK_SIMULATION_ROOT"
  --simulation-clock
  --simulation-root "$CLOCK_SIMULATION_ROOT"
  --now 2026-07-20T12:00:00Z
)
TOOLS="$TEST_TMP_REAL/tools"
mkdir -p "$TOOLS"

note "production wrappers do not forward caller clocks to host gates"
RELEASE_SWITCH_SOURCE="$(<"$I00_ROOT/bin/release-switch.sh")"
ROLLBACK_SWITCH_SOURCE="$(<"$I00_ROOT/bin/rollback-switch.sh")"
assert_contains "$RELEASE_SWITCH_SOURCE" 'GATE_CLOCK_ARGS=()'
assert_contains "$RELEASE_SWITCH_SOURCE" 'FIRST_HOST_PROVENANCE_ARGS=(--provenance-mode SYSTEM)'
assert_contains "$RELEASE_SWITCH_SOURCE" '"${GATE_CLOCK_ARGS[@]}"'
assert_contains "$ROLLBACK_SWITCH_SOURCE" 'PREFLIGHT_CLOCK_ARGS=()'
assert_contains "$ROLLBACK_SWITCH_SOURCE" '"${PREFLIGHT_CLOCK_ARGS[@]}"'

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
cat > "$TOOLS/systemctl-self-replacing" <<'SH'
#!/usr/bin/env bash
cp "$0" "$0.next"
chmod 755 "$0.next"
mv -f "$0.next" "$0"
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
  # GNU first: on GNU coreutils `stat -f` SUCCEEDS as a filesystem query, so a
  # BSD-first probe never falls through and returns filesystem info, not a mode.
  if stat -c '%a' "$1" >/dev/null 2>&1; then stat -c '%a' "$1"
  else stat -f '%Lp' "$1"
  fi
}

prepare_case() {
  local name="$1" path
  CASE_SYSTEMCTL="${2:-$TOOLS/systemctl-inactive}"
  CASE_BASE="$TEST_TMP_REAL/cases/$name"
  CASE_COSMOS="$CLOCK_SIMULATION_ROOT/cosmos"
  CASE_DATA="$CLOCK_SIMULATION_ROOT/data"
  CASE_OPS="$CLOCK_SIMULATION_ROOT/ops-state"
  local case_leaf
  case_leaf="$(printf '%s' "$name" | tr -cd '[:alnum:]')"
  CASE_OUTPUT="$EVIDENCE_ROOT/first-host-readback.$case_leaf"
  CASE_RAW_ENV="$CLOCK_SIMULATION_ROOT/raw.$case_leaf.env"
  CASE_ENV="$CLOCK_SIMULATION_ROOT/sanitized.$case_leaf.env"
  for path in "$CASE_COSMOS" "$CASE_DATA" "$CASE_OPS"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] && continue
    chmod -R u+rwx "$path" 2>/dev/null || true
    rm -rf "$path"
  done
  mkdir -p "$CASE_BASE" "$CASE_OUTPUT"
  chmod 700 "$CASE_OUTPUT"
  rm -f "$CASE_RAW_ENV" "$CASE_ENV"
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
    --provenance-mode TEST --provenance-root "$CLOCK_SIMULATION_ROOT" \
    --require-first-host-no-current >/dev/null
}

run_case() {
  node "$PRODUCER" \
    --env "$CASE_ENV" \
    --release "$RELEASE" \
    --output-dir "$CASE_OUTPUT" \
    --evidence-root "$EVIDENCE_ROOT" \
    --account cosmos-production \
    --target-host cosmos-01.internal \
    --environment production \
    --backup-reserve-bytes 4096 \
    --sqlite "$TOOLS/sqlite-safe" \
    --systemctl "$CASE_SYSTEMCTL" \
    "${FIXTURE_CLOCK[@]}"
}

note "marked fixture clock produces canonical first-host evidence"
prepare_case clean
assert_success run_case
assert_eq "$(node -e 'process.stdout.write(require(process.argv[1]).observedAtUtc)' \
  "$CASE_OUTPUT/collected-evidence.json")" 2026-07-20T12:00:00Z
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
exactKeys(evidence.baseline.unit, [
  'systemctlPath','systemctlSha256','systemctlIdentity','unit','state','exitCode',
], 'unit');
exactKeys(evidence.baseline.unit.systemctlIdentity, [
  'device','inode','mode','size','mtimeNs','ctimeNs',
], 'unit systemctl identity');
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
const systemctlBytes = fs.readFileSync(evidence.baseline.unit.systemctlPath);
const systemctlStat = fs.lstatSync(evidence.baseline.unit.systemctlPath, {bigint:true});
const systemctlIdentity = {
  device: systemctlStat.dev.toString(),
  inode: systemctlStat.ino.toString(),
  mode: systemctlStat.mode.toString(8),
  size: systemctlStat.size.toString(),
  mtimeNs: systemctlStat.mtimeNs.toString(),
  ctimeNs: systemctlStat.ctimeNs.toString(),
};
if (evidence.baseline.unit.systemctlSha256
      !== crypto.createHash('sha256').update(systemctlBytes).digest('hex')
    || JSON.stringify(evidence.baseline.unit.systemctlIdentity)
      !== JSON.stringify(systemctlIdentity)) throw new Error('unit executable binding');
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

note "preflight accepts marked fixture time and isolated staging uses system time"
SYSTEMCTL_INSPECTION="$(node "$I00_ROOT/bin/inspect-executable.mjs" \
  --path "$TOOLS/systemctl-inactive")"
SYSTEMCTL_SHA256="$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SYSTEMCTL_INSPECTION")"
SYSTEMCTL_IDENTITY="$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SYSTEMCTL_INSPECTION")"
assert_success node "$I00_ROOT/bin/preflight.mjs" --release "$RELEASE" \
  --host "$CASE_OUTPUT/host.json" --supervisor "$CASE_OUTPUT/supervisor.json" \
  --mode deploy --max-host-age-sec 300 --max-supervisor-age-sec 120 \
  --required-supervisor-window-sec 130 \
  --recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
  --first-host-evidence "$CASE_OUTPUT/collected-evidence.json" --donor-env "$CASE_ENV" \
  --systemctl-path "$TOOLS/systemctl-inactive" \
  --systemctl-sha256 "$SYSTEMCTL_SHA256" --systemctl-identity "$SYSTEMCTL_IDENTITY" \
  --simulation-clock --simulation-root "$CLOCK_SIMULATION_ROOT" \
  --now 2026-07-20T12:01:00Z
assert_failure_contains '--now is accepted only with --simulation-clock' \
  node "$I00_ROOT/bin/preflight.mjs" --release "$RELEASE" \
  --host "$CASE_OUTPUT/host.json" --supervisor "$CASE_OUTPUT/supervisor.json" \
  --mode deploy --max-host-age-sec 300 --max-supervisor-age-sec 120 \
  --required-supervisor-window-sec 130 --now 2099-01-01T00:00:00Z
node - "$TEST_TMP_REAL/system-host.json" "$TEST_TMP_REAL/system-supervisor.json" <<'NODE'
const fs = require('node:fs');
const [hostPath, supervisorPath] = process.argv.slice(2);
const observedMs = Math.floor(Date.now() / 1000) * 1000;
const observedAtUtc = new Date(observedMs).toISOString().replace('.000Z', 'Z');
const validUntilUtc = new Date(observedMs + 600_000).toISOString().replace('.000Z', 'Z');
fs.writeFileSync(hostPath, `${JSON.stringify({
  source: 'TARGET_HOST_OWNER_READBACK',
  account: 'simulation-account',
  targetHost: 'fixture-host.internal',
  environment: 'isolated-staging',
  freeBytes: 10_000_000,
  backupReserveBytes: 1_000,
  sqliteVersion: '3.51.3',
  evidenceSha256: 'b'.repeat(64),
  observedAtUtc,
})}\n`);
fs.writeFileSync(supervisorPath, `${JSON.stringify({
  source: 'CANONICAL_SUPERVISOR_READBACK',
  observedAtUtc,
  validUntilUtc,
  deploymentFrozen: false,
  exposureState: 'NONE',
  ambiguityState: 'NONE',
  recoveryState: 'NONE',
  currentSchemaVersion: 1,
  rollbackFloor: 1,
})}\n`);
NODE
assert_success node "$I00_ROOT/bin/preflight.mjs" --release "$RELEASE" \
  --host "$TEST_TMP_REAL/system-host.json" \
  --supervisor "$TEST_TMP_REAL/system-supervisor.json" \
  --mode deploy --max-host-age-sec 300 --max-supervisor-age-sec 120 \
  --required-supervisor-window-sec 130
cp "$TEST_TMP_REAL/system-host.json" "$TEST_TMP_REAL/future-host.json"
node -e 'const fs=require("fs"),p=process.argv[1],v=require(p);v.observedAtUtc="2099-01-01T00:00:00Z";fs.writeFileSync(p,JSON.stringify(v));' \
  "$TEST_TMP_REAL/future-host.json"
assert_failure_contains 'host preflight is stale or future-dated' \
  node "$I00_ROOT/bin/preflight.mjs" --release "$RELEASE" \
  --host "$TEST_TMP_REAL/future-host.json" \
  --supervisor "$TEST_TMP_REAL/system-supervisor.json" \
  --mode deploy --max-host-age-sec 300 --max-supervisor-age-sec 120 \
  --required-supervisor-window-sec 130

assert_failure run_case

note "system clock is internal and marked fixture clock is explicit"
SYSTEM_CLOCK_BEFORE="$(node -e 'process.stdout.write(String(Date.now()))')"
SYSTEM_CLOCK_READBACK="$(node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --provenance-mode SYSTEM)"
SYSTEM_CLOCK_AFTER="$(node -e 'process.stdout.write(String(Date.now()))')"
node - "$SYSTEM_CLOCK_READBACK" "$SYSTEM_CLOCK_BEFORE" "$SYSTEM_CLOCK_AFTER" <<'NODE' \
  || fail_test "system clock was not derived internally at exact UTC seconds"
const [raw, beforeRaw, afterRaw] = process.argv.slice(2);
const observed = JSON.parse(raw).observedAtUtc;
const observedMs = Date.parse(observed);
const beforeMs = Number(beforeRaw);
const afterMs = Number(afterRaw);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(observed)
    || !Number.isFinite(observedMs)
    || observedMs < beforeMs - 1_000
    || observedMs > afterMs) process.exit(1);
NODE
pass_assertion
assert_failure_contains '--now is accepted only with --simulation-clock' \
  node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --provenance-mode SYSTEM --now 2099-01-01T00:00:00Z
assert_failure_contains 'marked simulation root' \
  node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --provenance-mode TEST --provenance-root "$TEST_TMP_REAL" \
  --simulation-clock --simulation-root "$TEST_TMP_REAL" --now 2026-07-20T12:00:00Z

note "sqlite-only pins one canonical safe executable and rejects every unsafe identity/output"
SQLITE_OUTPUT="$CLOCK_SIMULATION_ROOT/sqlite-readback.json"
assert_success node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --output "$SQLITE_OUTPUT" "${FIXTURE_CLOCK[@]}"
assert_eq "$(portable_mode "$SQLITE_OUTPUT")" 600
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --output "$SQLITE_OUTPUT" "${FIXTURE_CLOCK[@]}"
mkdir "$TEST_TMP_REAL/arbitrary-sqlite-output"
chmod 700 "$TEST_TMP_REAL/arbitrary-sqlite-output"
assert_failure_contains 'canonical first-host bundle' \
  node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --provenance-mode SYSTEM \
  --output "$TEST_TMP_REAL/arbitrary-sqlite-output/sqlite-readback.json"
assert_failure_contains 'bound provenance root' \
  node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
  --output /var/lib/cosmos/first-host-hostile/sqlite-readback.json \
  "${FIXTURE_CLOCK[@]}"
assert_success node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-safe-different" \
  "${FIXTURE_CLOCK[@]}"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/missing" "${FIXTURE_CLOCK[@]}"
cp "$TOOLS/sqlite-safe" "$TOOLS/sqlite-nonexec"
chmod 644 "$TOOLS/sqlite-nonexec"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-nonexec" "${FIXTURE_CLOCK[@]}"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/./sqlite-safe" "${FIXTURE_CLOCK[@]}"
ln -s "$TOOLS/sqlite-safe" "$TOOLS/sqlite-symlink"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-symlink" "${FIXTURE_CLOCK[@]}"
cp "$TOOLS/sqlite-safe" "$TOOLS/sqlite-writable"
chmod 775 "$TOOLS/sqlite-writable"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-writable" "${FIXTURE_CLOCK[@]}"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-unsafe" "${FIXTURE_CLOCK[@]}"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-malformed" "${FIXTURE_CLOCK[@]}"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-nonzero" "${FIXTURE_CLOCK[@]}"
assert_failure node "$PRODUCER" --sqlite-only --sqlite "$TOOLS/sqlite-self-replacing" "${FIXTURE_CLOCK[@]}"
SQLITE_SWAP_ROOT="$(node "$I00_ROOT/bin/create-simulation-root.mjs" \
  --root "$FIXED_TEST_TMP/ip-ops-i00-sim-first-host-swap-$$")"
SQLITE_SWAP_PARENT="$SQLITE_SWAP_ROOT"
SQLITE_SWAP_DISPLACED="$SQLITE_SWAP_ROOT.displaced"
SQLITE_SWAP_CLOCK=(
  --provenance-mode TEST
  --provenance-root "$SQLITE_SWAP_ROOT"
  --simulation-clock
  --simulation-root "$SQLITE_SWAP_ROOT"
  --now 2026-07-20T12:00:00Z
)
SQLITE_SWAP_HOOK="$TEST_TMP_REAL/sqlite-parent-swap-hook.mjs"
cat >"$SQLITE_SWAP_HOOK" <<'NODE'
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const target = process.env.DF32_FIRST_HOST_PARENT_SWAP_TARGET;
const displaced = process.env.DF32_FIRST_HOST_PARENT_SWAP_DISPLACED;
const originalOpenSync = fs.openSync;
let swapped = false;
fs.openSync = function guardedOpenSync(path, flags, ...rest) {
  const descriptor = originalOpenSync.call(this, path, flags, ...rest);
  if (!swapped
      && path === target
      && (Number(flags) & (fs.constants.O_DIRECTORY ?? 0)) !== 0) {
    swapped = true;
    fs.renameSync(target, displaced);
    fs.mkdirSync(target, { mode: 0o700 });
  }
  return descriptor;
};
syncBuiltinESMExports();
NODE
chmod 600 "$SQLITE_SWAP_HOOK"
assert_failure_contains 'TEST provenance root must be one canonical marked simulation root' \
  env DF32_FIRST_HOST_PARENT_SWAP_TARGET="$SQLITE_SWAP_PARENT" \
    DF32_FIRST_HOST_PARENT_SWAP_DISPLACED="$SQLITE_SWAP_DISPLACED" \
    node --import "$SQLITE_SWAP_HOOK" "$PRODUCER" \
    --sqlite-only --sqlite "$TOOLS/sqlite-safe" \
    --output "$SQLITE_SWAP_PARENT/sqlite-readback.json" "${SQLITE_SWAP_CLOCK[@]}"
assert_not_file "$SQLITE_SWAP_PARENT/sqlite-readback.json"
assert_not_file "$SQLITE_SWAP_DISPLACED/sqlite-readback.json"
node - "$SQLITE_OUTPUT" "$TOOLS/sqlite-safe-different" "$PRODUCER" \
  "$CLOCK_SIMULATION_ROOT" <<'NODE' || fail_test "safe-but-different SQLite equality test failed"
const fs = require('node:fs');
const cp = require('node:child_process');
const [firstPath, sqlite, producer, simulationRoot] = process.argv.slice(2);
const first = JSON.parse(fs.readFileSync(firstPath));
const second = JSON.parse(cp.execFileSync(process.execPath, [
  producer, '--sqlite-only', '--sqlite', sqlite,
  '--provenance-mode', 'TEST', '--provenance-root', simulationRoot, '--simulation-clock',
  '--simulation-root', simulationRoot, '--now', '2026-07-20T12:00:01Z',
], {encoding:'utf8'}));
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
mkdir "$CASE_COSMOS"
mv "$CASE_COSMOS" "$CASE_BASE/real-cosmos"
ln -s "$CASE_BASE/real-cosmos" "$CASE_COSMOS"
assert_failure run_case
prepare_case dangling-ancestor
ln -s "$CASE_BASE/missing-cosmos" "$CASE_COSMOS"
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
prepare_case self-replacing "$TOOLS/systemctl-self-replacing"
assert_failure run_case
cp "$TOOLS/systemctl-inactive" "$TOOLS/systemctl-nonexec"
chmod 644 "$TOOLS/systemctl-nonexec"
prepare_case nonexec "$TOOLS/systemctl-nonexec"
assert_failure run_case
cp "$TOOLS/systemctl-inactive" "$TOOLS/systemctl-writable"
chmod 775 "$TOOLS/systemctl-writable"
prepare_case writable "$TOOLS/systemctl-writable"
assert_failure run_case
ln -s "$TOOLS/systemctl-inactive" "$TOOLS/systemctl-symlink"
prepare_case symlink "$TOOLS/systemctl-symlink"
assert_failure run_case

note "output directory and clock contracts fail closed"
prepare_case output-mode
chmod 755 "$CASE_OUTPUT"
assert_failure run_case
prepare_case output-nonempty
printf 'occupied\n' > "$CASE_OUTPUT/unowned"
assert_failure run_case
prepare_case caller-clock
assert_failure_contains '--now is accepted only with --simulation-clock' \
  node "$PRODUCER" --env "$CASE_ENV" --release "$RELEASE" --output-dir "$CASE_OUTPUT" \
  --evidence-root "$EVIDENCE_ROOT" --provenance-mode TEST \
  --provenance-root "$CLOCK_SIMULATION_ROOT" \
  --account cosmos-production --target-host cosmos-01.internal --environment production \
  --backup-reserve-bytes 4096 --sqlite "$TOOLS/sqlite-safe" --systemctl "$TOOLS/systemctl-inactive" \
  --now 2099-01-01T00:00:00Z

STAGING_FIRST_HOST_SQLITE="${DF32_SQLITE_BIN:-/usr/bin/sqlite3}"
if [ "$(uname -s)" = Linux ] && [ "$(id -u)" -eq 0 ] \
    && [ -n "${DF32_SQLITE_BIN:-}" ]; then
  [ -f "$DF32_SQLITE_BIN" ] && [ ! -L "$DF32_SQLITE_BIN" ] \
    && [ -x "$DF32_SQLITE_BIN" ] \
    || fail_test "DF32_SQLITE_BIN must be one executable regular file"
fi
if [ "$(uname -s)" = Linux ] && [ "$(id -u)" -eq 0 ] \
    && [ -x "$STAGING_FIRST_HOST_SQLITE" ]; then
  if [ -n "${DF32_SQLITE_BIN:-}" ]; then
    STAGING_SQLITE_INSPECTION="$(
      node "$I00_ROOT/bin/inspect-executable.mjs" \
        --path "$STAGING_FIRST_HOST_SQLITE"
    )"
    assert_eq "$(node -e \
      'process.stdout.write(JSON.parse(process.argv[1]).path)' \
      "$STAGING_SQLITE_INSPECTION")" "$DF32_SQLITE_BIN"
    assert_eq "$(node -e \
      'const fs=require("fs");process.stdout.write(String(fs.lstatSync(process.argv[1]).uid))' \
      "$DF32_SQLITE_BIN")" 0
    STAGING_SQLITE_VERSION="$("$DF32_SQLITE_BIN" --version)" \
      || fail_test "DF32_SQLITE_BIN version readback failed"
    assert_eq "$(node "$I00_ROOT/bin/inspect-executable.mjs" \
      --path "$DF32_SQLITE_BIN")" "$STAGING_SQLITE_INSPECTION"
    assert_success node "$I00_ROOT/bin/verify-sqlite-version.mjs" \
      --version "$STAGING_SQLITE_VERSION"
  fi
  note "root Linux proves first-host STAGING from one private offline unit root"
  for offset in $(seq 40 72); do
    candidate="$(printf '/var/tmp/cosmos-df32-proof-%04x' "$((($$ + offset) & 65535))")"
    if [ ! -e "$candidate" ]; then
      STAGING_FIRST_HOST_ROOT="$candidate"
      break
    fi
  done
  [ -n "$STAGING_FIRST_HOST_ROOT" ] || fail_test "no exact first-host STAGING proof root is available"
  STAGING_FIRST_HOST_SUFFIX="${STAGING_FIRST_HOST_ROOT##*-}"
  STAGING_FIRST_HOST_UNIT="cosmos-df32-proof-${STAGING_FIRST_HOST_SUFFIX}.service"
  STAGING_FIRST_HOST_ENV="$STAGING_FIRST_HOST_ROOT/sanitized/deploy.env"
  STAGING_FIRST_HOST_RAW_ENV="$STAGING_FIRST_HOST_ROOT/requests/raw.env"
  STAGING_FIRST_HOST_EVIDENCE_ROOT="$STAGING_FIRST_HOST_ROOT/first-host-evidence"
  STAGING_FIRST_HOST_OUTPUT="$STAGING_FIRST_HOST_EVIDENCE_ROOT/first-host-readback.$STAGING_FIRST_HOST_SUFFIX"
  STAGING_FIRST_HOST_OFFLINE_ROOT="$STAGING_FIRST_HOST_ROOT/first-host-offline-systemd"
  STAGING_FIRST_HOST_RELEASE="$STAGING_FIRST_HOST_ROOT/sealed-release/$(basename "$RELEASE")"
  mkdir -m 700 "$STAGING_FIRST_HOST_ROOT"
  mkdir -m 700 \
    "$STAGING_FIRST_HOST_ROOT/runtime" \
    "$STAGING_FIRST_HOST_ROOT/sanitized" \
    "$STAGING_FIRST_HOST_ROOT/requests" \
    "$STAGING_FIRST_HOST_EVIDENCE_ROOT" \
    "$STAGING_FIRST_HOST_OUTPUT" \
    "$STAGING_FIRST_HOST_OFFLINE_ROOT" \
    "$STAGING_FIRST_HOST_ROOT/sealed-release"
  cp -a "$RELEASE" "$STAGING_FIRST_HOST_RELEASE"
  cat >"$STAGING_FIRST_HOST_RAW_ENV" <<ENV
COSMOS_ROOT=$STAGING_FIRST_HOST_ROOT/cosmos
RELEASES_DIR=$STAGING_FIRST_HOST_ROOT/cosmos/releases
CURRENT_LINK=$STAGING_FIRST_HOST_ROOT/cosmos/current
PREVIOUS_LINK=$STAGING_FIRST_HOST_ROOT/cosmos/previous
DATA_DIR=$STAGING_FIRST_HOST_ROOT/data
OPS_STATE_DIR=$STAGING_FIRST_HOST_ROOT/ops-state
APP_UNIT=$STAGING_FIRST_HOST_UNIT
HEALTH_BASE=http://127.0.0.1:8080
ENV
  chmod 600 "$STAGING_FIRST_HOST_RAW_ENV"
  node "$SANITIZER" \
    --env "$STAGING_FIRST_HOST_RAW_ENV" \
    --output "$STAGING_FIRST_HOST_ENV" \
    --profile deploy \
    --provenance-mode STAGING \
    --provenance-root "$STAGING_FIRST_HOST_ROOT" \
    --require-first-host-no-current >/dev/null

  node "$PRODUCER" \
    --env "$STAGING_FIRST_HOST_ENV" \
    --release "$STAGING_FIRST_HOST_RELEASE" \
    --output-dir "$STAGING_FIRST_HOST_OUTPUT" \
    --evidence-root "$STAGING_FIRST_HOST_EVIDENCE_ROOT" \
    --provenance-mode STAGING \
    --provenance-root "$STAGING_FIRST_HOST_ROOT" \
    --account cosmos-staging \
    --target-host "cosmos-df32-proof-${STAGING_FIRST_HOST_SUFFIX}.internal" \
    --environment "isolated-staging-${STAGING_FIRST_HOST_SUFFIX}" \
    --backup-reserve-bytes 4096 \
    --sqlite "$STAGING_FIRST_HOST_SQLITE" \
    --offline-unit-root "$STAGING_FIRST_HOST_OFFLINE_ROOT" >/dev/null
  STAGING_UNIT_JSON="$(node -e \
    'process.stdout.write(JSON.stringify(require(process.argv[1]).baseline.unit))' \
    "$STAGING_FIRST_HOST_OUTPUT/collected-evidence.json")"
  assert_contains "$STAGING_UNIT_JSON" '"observationMode":"PRIVATE_OFFLINE_UNIT_ROOT"'
  assert_contains "$STAGING_UNIT_JSON" '"systemctlPath":null'
  assert_contains "$STAGING_UNIT_JSON" '"state":"INACTIVE"'
  assert_contains "$STAGING_UNIT_JSON" '"exitCode":null'
  assert_contains "$STAGING_UNIT_JSON" "\"offlineUnitRoot\":\"$STAGING_FIRST_HOST_OFFLINE_ROOT\""
  assert_contains "$STAGING_UNIT_JSON" '"offlineUnitTreeSha256":"'

  assert_success node "$I00_ROOT/bin/preflight.mjs" \
    --release "$STAGING_FIRST_HOST_RELEASE" \
    --host "$STAGING_FIRST_HOST_OUTPUT/host.json" \
    --supervisor "$STAGING_FIRST_HOST_OUTPUT/supervisor.json" \
    --mode deploy \
    --max-host-age-sec 300 \
    --max-supervisor-age-sec 300 \
    --required-supervisor-window-sec 300 \
    --recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
    --first-host-evidence "$STAGING_FIRST_HOST_OUTPUT/collected-evidence.json" \
    --donor-env "$STAGING_FIRST_HOST_ENV"

  note "first-host STAGING rejects host systemctl and any offline-root mutation"
  STAGING_SECOND_OUTPUT="$STAGING_FIRST_HOST_EVIDENCE_ROOT/first-host-readback.dead"
  mkdir -m 700 "$STAGING_SECOND_OUTPUT"
  assert_failure_contains 'STAGING first-host readback rejects --systemctl' \
    node "$PRODUCER" \
    --env "$STAGING_FIRST_HOST_ENV" \
    --release "$STAGING_FIRST_HOST_RELEASE" \
    --output-dir "$STAGING_SECOND_OUTPUT" \
    --evidence-root "$STAGING_FIRST_HOST_EVIDENCE_ROOT" \
    --provenance-mode STAGING \
    --provenance-root "$STAGING_FIRST_HOST_ROOT" \
    --account cosmos-staging \
    --target-host "cosmos-df32-proof-${STAGING_FIRST_HOST_SUFFIX}.internal" \
    --environment "isolated-staging-${STAGING_FIRST_HOST_SUFFIX}" \
    --backup-reserve-bytes 4096 \
    --sqlite "$STAGING_FIRST_HOST_SQLITE" \
    --systemctl /usr/bin/systemctl \
    --offline-unit-root "$STAGING_FIRST_HOST_OFFLINE_ROOT"
  rmdir "$STAGING_SECOND_OUTPUT"
  printf '[Unit]\nDescription=hostile\n' \
    >"$STAGING_FIRST_HOST_OFFLINE_ROOT/$STAGING_FIRST_HOST_UNIT"
  chmod 400 "$STAGING_FIRST_HOST_OFFLINE_ROOT/$STAGING_FIRST_HOST_UNIT"
  assert_failure_contains 'offline unit root differs from collected evidence' \
    node "$I00_ROOT/bin/preflight.mjs" \
    --release "$STAGING_FIRST_HOST_RELEASE" \
    --host "$STAGING_FIRST_HOST_OUTPUT/host.json" \
    --supervisor "$STAGING_FIRST_HOST_OUTPUT/supervisor.json" \
    --mode deploy \
    --max-host-age-sec 300 \
    --max-supervisor-age-sec 300 \
    --required-supervisor-window-sec 300 \
    --recovery-target NO_PRIOR_RELEASE_FIRST_HOST \
    --first-host-evidence "$STAGING_FIRST_HOST_OUTPUT/collected-evidence.json" \
    --donor-env "$STAGING_FIRST_HOST_ENV"
  rm "$STAGING_FIRST_HOST_OFFLINE_ROOT/$STAGING_FIRST_HOST_UNIT"
else
  note "first-host private offline STAGING proof runs in the root Linux gate"
fi

finish
