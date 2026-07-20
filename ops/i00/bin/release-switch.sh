#!/usr/bin/env bash
# I00 adapter: validate final release and canonical blockers, then delegate the
# actual immutable install/switch to the accepted L15 deploy owner.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
I00_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
DONOR_ROOT="${DONOR_ROOT:-$I00_ROOT/accepted-ops-live}"
FIRST_HOST_SENTINEL=NO_PRIOR_RELEASE_FIRST_HOST

blocked() {
  printf 'I00_OPS_BLOCKED: %s\n' "$*" >&2
  exit 1
}

SEEN_OPTIONS=""
mark_seen() {
  case " $SEEN_OPTIONS " in
    *" $1 "*) blocked "duplicate singleton argument $1" ;;
  esac
  SEEN_OPTIONS="$SEEN_OPTIONS $1"
}
require_value() {
  [ "$#" -eq 2 ] && [ -n "$2" ] && [ "${2#--}" = "$2" ] \
    || blocked "$1 needs one non-empty value"
}

RELEASE="" ENV_FILE="" RUNTIME_ENV="" HOST="" SUPERVISOR="" SQLITE=""
AUTHORIZATION="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" EVIDENCE_ROOT=""
NOW="" SIMULATION_ROOT="" SIMULATION_PROBE="" SIMULATION_SYSTEMCTL_READBACK="" SIMULATION=0
OPERATOR="" CONFIG_VERSION="" RISK_VERSION="" AUTHORIZATION_NONCE="" SERVER_PREVIEW_DIGEST=""
RECOVERY_TARGET="" ACCOUNT="" TARGET_HOST="" TARGET_ENVIRONMENT="" BACKUP_RESERVE_BYTES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) mark_seen "$1"; require_value "$1" "${2-}"; RELEASE="$2"; shift 2 ;;
    --env-file) mark_seen "$1"; require_value "$1" "${2-}"; ENV_FILE="$2"; shift 2 ;;
    --runtime-env) mark_seen "$1"; require_value "$1" "${2-}"; RUNTIME_ENV="$2"; shift 2 ;;
    --host) mark_seen "$1"; require_value "$1" "${2-}"; HOST="$2"; shift 2 ;;
    --supervisor) mark_seen "$1"; require_value "$1" "${2-}"; SUPERVISOR="$2"; shift 2 ;;
    --sqlite) mark_seen "$1"; require_value "$1" "${2-}"; SQLITE="$2"; shift 2 ;;
    --recovery-target) mark_seen "$1"; require_value "$1" "${2-}"; RECOVERY_TARGET="$2"; shift 2 ;;
    --account) mark_seen "$1"; require_value "$1" "${2-}"; ACCOUNT="$2"; shift 2 ;;
    --target-host) mark_seen "$1"; require_value "$1" "${2-}"; TARGET_HOST="$2"; shift 2 ;;
    --environment) mark_seen "$1"; require_value "$1" "${2-}"; TARGET_ENVIRONMENT="$2"; shift 2 ;;
    --backup-reserve-bytes) mark_seen "$1"; require_value "$1" "${2-}"; BACKUP_RESERVE_BYTES="$2"; shift 2 ;;
    --authorization) mark_seen "$1"; require_value "$1" "${2-}"; AUTHORIZATION="$2"; shift 2 ;;
    --operator) mark_seen "$1"; require_value "$1" "${2-}"; OPERATOR="$2"; shift 2 ;;
    --config-version) mark_seen "$1"; require_value "$1" "${2-}"; CONFIG_VERSION="$2"; shift 2 ;;
    --risk-version) mark_seen "$1"; require_value "$1" "${2-}"; RISK_VERSION="$2"; shift 2 ;;
    --authorization-nonce) mark_seen "$1"; require_value "$1" "${2-}"; AUTHORIZATION_NONCE="$2"; shift 2 ;;
    --server-preview-digest) mark_seen "$1"; require_value "$1" "${2-}"; SERVER_PREVIEW_DIGEST="$2"; shift 2 ;;
    --result-receipt) mark_seen "$1"; require_value "$1" "${2-}"; RESULT_RECEIPT="$2"; shift 2 ;;
    --reconciliation-receipt) mark_seen "$1"; require_value "$1" "${2-}"; RECONCILIATION_RECEIPT="$2"; shift 2 ;;
    --evidence-root) mark_seen "$1"; require_value "$1" "${2-}"; EVIDENCE_ROOT="$2"; shift 2 ;;
    --now) mark_seen "$1"; require_value "$1" "${2-}"; NOW="$2"; shift 2 ;;
    --simulation-root) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_ROOT="$2"; shift 2 ;;
    --simulation-probe) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_PROBE="$2"; shift 2 ;;
    --simulation-systemctl-readback) mark_seen "$1"; require_value "$1" "${2-}"; SIMULATION_SYSTEMCTL_READBACK="$2"; shift 2 ;;
    --simulation) mark_seen "$1"; SIMULATION=1; shift ;;
    *) blocked "unknown argument $1" ;;
  esac
done

[ -n "$RELEASE" ] && [ -n "$ENV_FILE" ] && [ -n "$RUNTIME_ENV" ] && [ -n "$SQLITE" ] \
  || blocked "--release, --env-file, --runtime-env, and explicit --sqlite are required"
[ -d "$RELEASE" ] || blocked "--release must identify an unpacked release directory"
RELEASE="$(cd "$RELEASE" && pwd -P)"

FIRST_HOST=0
if [ -n "$RECOVERY_TARGET" ]; then
  [ "$RECOVERY_TARGET" = "$FIRST_HOST_SENTINEL" ] \
    || blocked "--recovery-target must be exactly $FIRST_HOST_SENTINEL"
  FIRST_HOST=1
  [ -z "$HOST" ] && [ -z "$SUPERVISOR" ] \
    || blocked "first-host mode rejects caller-supplied --host and --supervisor JSON"
  [ -n "$ACCOUNT" ] && [ -n "$TARGET_HOST" ] && [ -n "$TARGET_ENVIRONMENT" ] \
    && [ -n "$BACKUP_RESERVE_BYTES" ] && [ -n "$EVIDENCE_ROOT" ] \
    || blocked "first-host mode requires account, target host, environment, backup reserve, and evidence root"
  case "$BACKUP_RESERVE_BYTES" in
    0) : ;;
    0*|*[!0-9]*) blocked "--backup-reserve-bytes must be a canonical non-negative integer" ;;
    *) : ;;
  esac
else
  [ -n "$HOST" ] && [ -n "$SUPERVISOR" ] \
    || blocked "normal deploy requires --host and --supervisor"
  [ -z "$ACCOUNT" ] && [ -z "$TARGET_HOST" ] && [ -z "$TARGET_ENVIRONMENT" ] \
    && [ -z "$BACKUP_RESERVE_BYTES" ] && [ -z "$SIMULATION_SYSTEMCTL_READBACK" ] \
    || blocked "first-host owner inputs require the exact recovery target"
fi
[ -x "$DONOR_ROOT/bin/deploy.sh" ] || blocked "effective L15 deploy.sh is unavailable"

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

# Inspect one explicitly pinned SQLite executable without a shell or ambient
# command fallback. The complete identity and digest are re-read after the
# command. The same helper is called again after preflight, immediately before
# the donor delegation, to close path/binary replacement races.
inspect_sqlite() {
  node --input-type=module - "$1" <<'NODE'
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
const requested = process.argv[2];
if (!requested || !isAbsolute(requested) || resolve(requested) !== requested) {
  fail('--sqlite must be one canonical absolute path');
}
const identity = (stat) => ({
  device: stat.dev.toString(), inode: stat.ino.toString(), mode: stat.mode.toString(8),
  size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(),
});
const inspect = () => {
  let stat;
  try { stat = lstatSync(requested, { bigint: true }); } catch (error) { fail(`SQLite executable is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111n) === 0n) {
    fail('SQLite path must be a non-symlink executable regular file');
  }
  if ((stat.mode & 0o022n) !== 0n) fail('SQLite executable must not be group/world writable');
  let canonical;
  try { canonical = realpathSync(requested); } catch (error) { fail(`SQLite path cannot be canonicalized: ${error.message}`); }
  if (canonical !== requested) fail('SQLite path or one of its ancestors is not canonical');
  let sha256;
  try { sha256 = createHash('sha256').update(readFileSync(requested)).digest('hex'); }
  catch (error) { fail(`SQLite executable cannot be hashed: ${error.message}`); }
  return { stat, sha256, identity: identity(stat) };
};
const before = inspect();
const result = spawnSync(requested, ['--version'], {
  encoding: 'utf8', timeout: 1000, maxBuffer: 4096, windowsHide: true,
  env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (result.error || result.signal || result.status !== 0) {
  fail(`SQLite --version execution failed or exceeded its bound: ${result.error?.message ?? result.signal ?? `exit ${String(result.status)}`}`);
}
if (result.stderr !== '') fail('SQLite --version wrote unexpected stderr');
const raw = result.stdout;
if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096 || raw.includes('\0')) {
  fail('SQLite --version output is empty or malformed');
}
const match = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:[ \t][^\r\n]*)?\n?$/.exec(raw);
if (!match) fail('SQLite --version output is not one canonical x.y.z version line');
const version = match[1];
const after = inspect();
if (before.sha256 !== after.sha256 || JSON.stringify(before.identity) !== JSON.stringify(after.identity)) {
  fail('SQLite executable changed during live readback');
}
const endpointIdentity = Object.entries(before.identity).map(([key, value]) => `${key}=${value}`).join(',');
process.stdout.write(JSON.stringify({ path: requested, sha256: before.sha256, version, identity: before.identity, endpointIdentity }));
NODE
}

validate_simulation_executable() {
  node --input-type=module - "$I00_ROOT/simulation-safety.mjs" "$1" "$2" <<'NODE'
import { lstatSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [modulePath, rootInput, commandInput] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
let safety;
try { safety = await import(pathToFileURL(modulePath)); } catch (error) { fail(error.message); }
let root;
try { root = safety.validateSimulationRoot(rootInput); } catch (error) { fail(error.message); }
let stat;
try { stat = lstatSync(commandInput); } catch (error) { fail(`simulation executable is unavailable: ${error.message}`); }
if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
  fail('simulation readback executable must be an owner-controlled non-symlink executable regular file');
}
if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('simulation readback executable has the wrong owner');
let canonical;
try { canonical = realpathSync(commandInput); } catch (error) { fail(error.message); }
if (canonical !== commandInput) fail('simulation readback executable path must be canonical');
let inside = false;
try { inside = safety.isWithinSimulationRoot(root, canonical); } catch { inside = false; }
if (!inside) fail('simulation readback executable must remain below the marked simulation root');
process.stdout.write(canonical);
NODE
}

capture_authorization_identity() {
  node --input-type=module - "$1" <<'NODE'
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, parse, resolve, sep } from 'node:path';
const input = process.argv[2];
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
if (!input || !isAbsolute(input) || resolve(input) !== input) fail('authorization path must be canonical and absolute');
const parsed = parse(input);
const parts = input.slice(parsed.root.length).split(sep).filter(Boolean);
let cursor = parsed.root;
for (const part of parts) {
  cursor = resolve(cursor, part);
  let stat;
  try { stat = lstatSync(cursor, { bigint: true }); } catch (error) { fail(`authorization path is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink()) fail('authorization path must not traverse a symlink');
  if (cursor !== input && !stat.isDirectory()) fail('authorization path has a non-directory ancestor');
}
const stat = lstatSync(input, { bigint: true });
if (!stat.isFile() || realpathSync(input) !== input) fail('authorization must be one canonical real regular file');
let bytes;
try { bytes = readFileSync(input); } catch (error) { fail(`authorization is unreadable: ${error.message}`); }
process.stdout.write(JSON.stringify({
  path: input,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  identity: {
    device: stat.dev.toString(), inode: stat.ino.toString(), mode: stat.mode.toString(8),
    size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(),
  },
}));
NODE
}

if [ "$SIMULATION" = 1 ]; then
  [ -n "$NOW" ] && [ -n "$SIMULATION_ROOT" ] && [ -n "$SIMULATION_PROBE" ] \
    && [ -n "${SYSTEMCTL:-}" ] && [ -n "${CURL:-}" ] \
    || blocked "simulation requires --now, --simulation-root, --simulation-probe, fake SYSTEMCTL, and fake CURL"
  [ -z "$AUTHORIZATION" ] && [ -z "$OPERATOR" ] && [ -z "$CONFIG_VERSION" ] \
    && [ -z "$RISK_VERSION" ] && [ -z "$AUTHORIZATION_NONCE" ] && [ -z "$SERVER_PREVIEW_DIGEST" ] \
    && [ -z "$RESULT_RECEIPT" ] && [ -z "$RECONCILIATION_RECEIPT" ] \
    || blocked "simulation rejects production authorization and receipt inputs"
  SYSTEMCTL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SYSTEMCTL")"
  CURL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$CURL")"
  SIMULATION_PROBE="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SIMULATION_PROBE")"
  SQLITE="$(validate_simulation_executable "$SIMULATION_ROOT" "$SQLITE")"
  if [ "$FIRST_HOST" = 1 ]; then
    [ -n "$SIMULATION_SYSTEMCTL_READBACK" ] \
      || blocked "first-host simulation requires --simulation-systemctl-readback"
    FIRST_HOST_SYSTEMCTL="$(validate_simulation_executable "$SIMULATION_ROOT" "$SIMULATION_SYSTEMCTL_READBACK")"
  fi
  SANITIZED_DIR="$(mktemp -d "$SIMULATION_ROOT/i00-release-switch.XXXXXX")"
  chmod 700 "$SANITIZED_DIR"
  DELEGATE_ENV="$SANITIZED_DIR/deploy.env"
  node "$SCRIPT_DIR/validate-simulation-env.mjs" --env "$ENV_FILE" --root "$SIMULATION_ROOT" --output "$DELEGATE_ENV" >/dev/null
  if [ "$FIRST_HOST" = 1 ]; then
    printf '%s\n' "I00_REQUIRE_FIRST_HOST_NO_CURRENT='1'" "COSMOS_DEPLOY_VIA_I00_WRAPPER='1'" >> "$DELEGATE_ENV"
  fi
  mkdir -p "$SIMULATION_ROOT/home" "$SIMULATION_ROOT/tmp"
  EFFECTIVE_NOW="$NOW"
else
  [ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$CONFIG_VERSION" ] && [ -n "$RISK_VERSION" ] \
    && [ -n "$AUTHORIZATION_NONCE" ] && [ -n "$SERVER_PREVIEW_DIGEST" ] && [ -n "$RESULT_RECEIPT" ] \
    && [ -n "$RECONCILIATION_RECEIPT" ] && [ -n "$EVIDENCE_ROOT" ] \
    || blocked "real switch requires authorization, independent operator/revision/nonce/preview truth, and exact receipt targets"
  [ -z "$NOW" ] || blocked "real switch does not accept a caller clock"
  [ -z "$SIMULATION_ROOT" ] && [ -z "$SIMULATION_PROBE" ] && [ -z "$SIMULATION_SYSTEMCTL_READBACK" ] \
    || blocked "real switch rejects simulation-only inputs"
  EFFECTIVE_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  SANITIZED_DIR="$(mktemp -d "${TMPDIR:-/tmp}/i00-release-switch.XXXXXX")"
  chmod 700 "$SANITIZED_DIR"
  DELEGATE_ENV="$SANITIZED_DIR/deploy.env"
  if [ "$FIRST_HOST" = 1 ]; then
    node "$SCRIPT_DIR/sanitize-donor-env.mjs" --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy --require-first-host-no-current >/dev/null
    FIRST_HOST_SYSTEMCTL=/usr/bin/systemctl
  else
    node "$SCRIPT_DIR/sanitize-donor-env.mjs" --env "$ENV_FILE" --output "$DELEGATE_ENV" --profile deploy >/dev/null
  fi
fi

FIRST_HOST_DIR=""
FIRST_HOST_EVIDENCE_RETAIN=0
cleanup_delegate_env() {
  if [ -n "${FIRST_HOST_DIR:-}" ] && [ "${FIRST_HOST_EVIDENCE_RETAIN:-0}" != 1 ]; then
    rm -rf "$FIRST_HOST_DIR"
  fi
  if [ -n "${SANITIZED_DIR:-}" ]; then rm -rf "$SANITIZED_DIR"; fi
}
trap cleanup_delegate_env EXIT

SQLITE_INITIAL="$(inspect_sqlite "$SQLITE")"
SQLITE_PATH="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).path)' "$SQLITE_INITIAL")"
SQLITE_SHA256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).sha256)' "$SQLITE_INITIAL")"
SQLITE_VERSION="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).version)' "$SQLITE_INITIAL")"
SQLITE_IDENTITY_ENDPOINT="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).endpointIdentity)' "$SQLITE_INITIAL")"
node "$SCRIPT_DIR/verify-sqlite-version.mjs" --version "$SQLITE_VERSION" >/dev/null

FIRST_HOST_EVIDENCE=""
FIRST_HOST_EVIDENCE_SHA256=""
FIRST_HOST_BUNDLE_IDENTITY=""
if [ "$FIRST_HOST" = 1 ]; then
  # The retained bootstrap bundle must not create the residue it is meant to
  # prove absent. Require one canonical real evidence root disjoint from every
  # sanitized deploy/data/ops path, then exact-create a private child.
  node --input-type=module - "$EVIDENCE_ROOT" "$DELEGATE_ENV" <<'NODE'
import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
const [root, envPath] = process.argv.slice(2);
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
if (!root || !isAbsolute(root) || resolve(root) !== root) fail('first-host evidence root must be canonical and absolute');
let stat;
try { stat = lstatSync(root); } catch (error) { fail(`first-host evidence root is unavailable: ${error.message}`); }
if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(root) !== root) fail('first-host evidence root must be one real non-symlink directory');
const values = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)='([^']*)'$/.exec(line);
  if (!match) fail('sanitized donor env is not canonical');
  values[match[1]] = match[2];
}
const overlap = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
for (const key of ['COSMOS_ROOT','RELEASES_DIR','CURRENT_LINK','PREVIOUS_LINK','DATA_DIR','OPS_STATE_DIR']) {
  if (!values[key] || overlap(root, values[key])) fail(`first-host evidence root overlaps sanitized ${key}`);
}
NODE
  if [ "$SIMULATION" = 1 ]; then
    node --input-type=module - "$I00_ROOT/simulation-safety.mjs" "$SIMULATION_ROOT" "$EVIDENCE_ROOT" <<'NODE'
import { pathToFileURL } from 'node:url';
const [modulePath, root, evidence] = process.argv.slice(2);
const safety = await import(pathToFileURL(modulePath));
if (!safety.isWithinSimulationRoot(root, evidence)) {
  process.stderr.write('I00_OPS_BLOCKED: simulation evidence root must be below the marked simulation root\n');
  process.exit(1);
}
NODE
  fi
  FIRST_HOST_DIR="$(mktemp -d "$EVIDENCE_ROOT/first-host-readback.XXXXXX")"
  chmod 700 "$FIRST_HOST_DIR"
  node "$SCRIPT_DIR/first-host-readback.mjs" \
    --env "$DELEGATE_ENV" --release "$RELEASE" --output-dir "$FIRST_HOST_DIR" \
    --account "$ACCOUNT" --target-host "$TARGET_HOST" --environment "$TARGET_ENVIRONMENT" \
    --backup-reserve-bytes "$BACKUP_RESERVE_BYTES" --sqlite "$SQLITE_PATH" \
    --systemctl "$FIRST_HOST_SYSTEMCTL" --now "$EFFECTIVE_NOW" >/dev/null
  FIRST_HOST_EVIDENCE_RETAIN=1
  HOST="$FIRST_HOST_DIR/host.json"
  SUPERVISOR="$FIRST_HOST_DIR/supervisor.json"
  FIRST_HOST_EVIDENCE="$FIRST_HOST_DIR/collected-evidence.json"
  PRODUCER_SQLITE="$FIRST_HOST_DIR/sqlite-readback.json"
  FIRST_HOST_EVIDENCE_SHA256="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_EVIDENCE")"
  node - "$SQLITE_INITIAL" "$HOST" "$PRODUCER_SQLITE" "$FIRST_HOST_EVIDENCE_SHA256" "$EFFECTIVE_NOW" <<'NODE'
const fs = require('fs');
const expected = JSON.parse(process.argv[2]);
const host = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const producer = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const evidenceSha = process.argv[5];
const observedAtUtc = process.argv[6];
const fail = (message) => { process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`); process.exit(1); };
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail(`${label} key set is not exact`);
};
exactKeys(producer, ['schemaVersion','source','observedAtUtc','path','sha256','version','identity'], 'producer SQLite readback');
exactKeys(producer.identity, ['device','inode','mode','size','mtimeNs','ctimeNs'], 'producer SQLite identity');
if (producer.schemaVersion !== 1 || producer.source !== 'PINNED_SQLITE_EXECUTABLE_READBACK'
    || producer.observedAtUtc !== observedAtUtc) fail('producer SQLite source or observation time is invalid');
if (host.sqliteVersion !== expected.version) fail('first-host host JSON SQLite version differs from live wrapper readback');
if (host.evidenceSha256 !== evidenceSha) fail('first-host host JSON does not bind the retained collected evidence bytes');
for (const key of ['path', 'sha256', 'version']) if (producer[key] !== expected[key]) fail(`producer SQLite ${key} differs from wrapper readback`);
if (JSON.stringify(producer.identity) !== JSON.stringify(expected.identity)) fail('producer SQLite identity differs from wrapper readback');
NODE
  FIRST_HOST_BUNDLE_IDENTITY="$(node - "$FIRST_HOST_DIR" <<'NODE'
const fs=require('fs'),c=require('crypto'),p=require('path');
const dir=process.argv[2], names=['collected-evidence.json','host.json','sqlite-readback.json','supervisor.json'];
const entries=fs.readdirSync(dir).sort();
if (JSON.stringify(entries)!==JSON.stringify(names)) { process.stderr.write('I00_OPS_BLOCKED: first-host bundle field set changed\n'); process.exit(1); }
const result={};
for (const name of names) {
  const file=p.join(dir,name), stat=fs.lstatSync(file,{bigint:true});
  if (stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o777n)!==0o600n||fs.realpathSync(file)!==file) {
    process.stderr.write(`I00_OPS_BLOCKED: first-host bundle ${name} is not a canonical mode-0600 file\n`); process.exit(1);
  }
  result[name]={sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),device:stat.dev.toString(),inode:stat.ino.toString(),size:stat.size.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()};
}
process.stdout.write(JSON.stringify(result));
NODE
)"
else
  node - "$HOST" "$SQLITE_VERSION" <<'NODE'
const fs = require('fs');
const host = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (host.sqliteVersion !== process.argv[3]) {
  process.stderr.write('I00_OPS_BLOCKED: claimed host SQLite version does not equal the normalized live SQLite version\n');
  process.exit(1);
}
NODE
fi

if [ "$FIRST_HOST" != 1 ]; then
  TARGET_HOST="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.targetHost)' "$HOST")"
  TARGET_ENVIRONMENT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.environment)' "$HOST")"
  ACCOUNT="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(v.account)' "$HOST")"
  BACKUP_RESERVE_BYTES="$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(v.backupReserveBytes))' "$HOST")"
fi

DELEGATE_ENV_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")"
AUTHORIZATION_IDENTITY=""
if [ "$SIMULATION" != 1 ]; then
  MANIFEST_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$RELEASE/artifact-manifest.json")"
  TRUSTED_BUILD_KEY_SHA="$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "${I00_TRUSTED_BUILD_PUBLIC_KEY:?trusted build public key is required}")"
  AUTHORIZATION_IDENTITY="$(capture_authorization_identity "$AUTHORIZATION")"
  AUTH_BASE=(--input "$AUTHORIZATION" --class SERVICE_RELEASE_SWITCH --command release-switch --expected-operator "$OPERATOR" --expected-deployed-sha "$CANDIDATE_SHA" --expected-config-version "$CONFIG_VERSION" --expected-risk-version "$RISK_VERSION" --expected-nonce "$AUTHORIZATION_NONCE" --expected-server-preview-digest "$SERVER_PREVIEW_DIGEST" --expected-host "$TARGET_HOST" --expected-environment "$TARGET_ENVIRONMENT" --expected-scope cosmos-production-release-switch --expected-account "$ACCOUNT" --expected-product "Cosmos I00 immutable release" --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION --expected-permission systemd:RestartExactCosmosAppUnit --expected-result-receipt "$RESULT_RECEIPT" --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT" --expected-maximum-capital ZERO --expected-maximum-notional ZERO --expected-maximum-effect "install one exact immutable release and restart one exact application unit")
  AUTH_ENDPOINTS=(
    --expected-endpoint "release-sha:$CANDIDATE_SHA"
    --expected-endpoint "artifact-manifest-sha256:$MANIFEST_SHA"
    --expected-endpoint "trusted-builder-public-key-sha256:$TRUSTED_BUILD_KEY_SHA"
    --expected-endpoint "release-path:$(cd "$RELEASE" && pwd -P)"
    --expected-endpoint "donor-env-sha256:$DELEGATE_ENV_SHA"
    --expected-endpoint "backup-reserve-bytes:$BACKUP_RESERVE_BYTES"
    --expected-endpoint "sqlite-path:$SQLITE_PATH"
    --expected-endpoint "sqlite-sha256:$SQLITE_SHA256"
    --expected-endpoint "sqlite-version:$SQLITE_VERSION"
    --expected-endpoint "sqlite-identity:$SQLITE_IDENTITY_ENDPOINT"
  )
  if [ "$FIRST_HOST" = 1 ]; then
    AUTH_ENDPOINTS+=(
      --expected-endpoint "recovery-target:$FIRST_HOST_SENTINEL"
      --expected-endpoint "first-host-evidence-sha256:$FIRST_HOST_EVIDENCE_SHA256"
      --expected-endpoint "first-host-account:$ACCOUNT"
      --expected-endpoint "first-host-target-host:$TARGET_HOST"
      --expected-endpoint "first-host-environment:$TARGET_ENVIRONMENT"
    )
  fi
  node "$SCRIPT_DIR/validate-authorization.mjs" "${AUTH_BASE[@]}" "${AUTH_ENDPOINTS[@]}" >/dev/null
  [ "$(capture_authorization_identity "$AUTHORIZATION")" = "$AUTHORIZATION_IDENTITY" ] \
    || blocked "authorization changed during validation"
fi

PREFLIGHT_ARGS=(--release "$RELEASE" --host "$HOST" --supervisor "$SUPERVISOR" --mode deploy --now "$EFFECTIVE_NOW" --max-host-age-sec 120 --max-supervisor-age-sec 30 --required-supervisor-window-sec 300)
if [ "$FIRST_HOST" = 1 ]; then
  PREFLIGHT_ARGS+=(--recovery-target "$FIRST_HOST_SENTINEL" --first-host-evidence "$FIRST_HOST_EVIDENCE" --donor-env "$DELEGATE_ENV")
fi
node "$SCRIPT_DIR/preflight.mjs" "${PREFLIGHT_ARGS[@]}" >/dev/null

SQLITE_FINAL="$(inspect_sqlite "$SQLITE_PATH")"
[ "$SQLITE_FINAL" = "$SQLITE_INITIAL" ] || blocked "SQLite executable identity changed after preflight"
[ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$DELEGATE_ENV")" = "$DELEGATE_ENV_SHA" ] \
  || blocked "sanitized donor env changed after validation"
if [ "$FIRST_HOST" = 1 ]; then
  [ "$(node -e 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$FIRST_HOST_EVIDENCE")" = "$FIRST_HOST_EVIDENCE_SHA256" ] \
    || blocked "first-host evidence changed after preflight"
  [ "$(node - "$FIRST_HOST_DIR" <<'NODE'
const fs=require('fs'),c=require('crypto'),p=require('path');
const dir=process.argv[2], names=['collected-evidence.json','host.json','sqlite-readback.json','supervisor.json'], result={};
if (JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify(names)) process.exit(1);
for (const name of names) { const file=p.join(dir,name),stat=fs.lstatSync(file,{bigint:true}); if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o777n)!==0o600n||fs.realpathSync(file)!==file) process.exit(1); result[name]={sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),device:stat.dev.toString(),inode:stat.ino.toString(),size:stat.size.toString(),mtimeNs:stat.mtimeNs.toString(),ctimeNs:stat.ctimeNs.toString()}; }
process.stdout.write(JSON.stringify(result));
NODE
)" = "$FIRST_HOST_BUNDLE_IDENTITY" ] || blocked "first-host evidence bundle changed after preflight"
fi
if [ "$SIMULATION" != 1 ]; then
  [ "$(capture_authorization_identity "$AUTHORIZATION")" = "$AUTHORIZATION_IDENTITY" ] \
    || blocked "authorization changed before donor delegation"
fi
if [ "$SIMULATION" = 1 ]; then
  # Revalidate every sealed effect command at the last possible wrapper point.
  SYSTEMCTL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SYSTEMCTL")"
  CURL="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$CURL")"
  SIMULATION_PROBE="$(node "$SCRIPT_DIR/verify-simulation-command.mjs" --root "$SIMULATION_ROOT" --command "$SIMULATION_PROBE")"
fi

SAFE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="$(command -v node)"
set +e
if [ "$SIMULATION" = 1 ]; then
  env -i PATH="$SAFE_PATH" HOME="$SIMULATION_ROOT/home" TMPDIR="$SIMULATION_ROOT/tmp" NODE="$NODE_BIN" \
    SYSTEMCTL="$SYSTEMCTL" CURL="$CURL" PROBE_CMD="exec $SIMULATION_PROBE" \
    "$DONOR_ROOT/bin/deploy.sh" --release "$RELEASE" --env-file "$DELEGATE_ENV"
else
  env -i PATH="$SAFE_PATH" HOME=/ TMPDIR=/tmp NODE="$NODE_BIN" \
    "$DONOR_ROOT/bin/deploy.sh" --release "$RELEASE" --env-file "$DELEGATE_ENV"
fi
RESULT=$?
set -e
if [ "$RESULT" = 0 ] && [ "$SIMULATION" != 1 ]; then
  [ -f "$RECONCILIATION_RECEIPT" ] || { printf 'I00_OPS_BLOCKED: post-switch reconciliation receipt is missing\n' >&2; RESULT=1; }
  if [ "$RESULT" = 0 ]; then
    node "$SCRIPT_DIR/validate-receipt.mjs" --input "$RESULT_RECEIPT" --kind DEPLOYMENT --evidence-root "$EVIDENCE_ROOT" --expected-sha "$CANDIDATE_SHA" >/dev/null || RESULT=1
  fi
  if [ "$RESULT" = 0 ]; then
    node - "$RESULT_RECEIPT" "$EVIDENCE_ROOT" "$AUTHORIZATION_IDENTITY" <<'NODE' || RESULT=1
const fs=require('fs'),c=require('crypto'),path=require('path');
const receipt=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const root=fs.realpathSync(process.argv[3]);
const expected=JSON.parse(process.argv[4]);
const ref=receipt?.evidence?.authorization;
const fail=(message)=>{process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);process.exit(1);};
if (!ref || typeof ref.path !== 'string' || typeof ref.sha256 !== 'string') fail('deployment receipt lacks exact authorization evidence');
const segments=ref.path.split('/');
if (path.isAbsolute(ref.path) || segments.some((part)=>!part||part==='.'||part==='..')) fail('receipt authorization evidence path is unsafe');
let cursor=root;
for (const segment of segments) { cursor=path.resolve(cursor,segment); const stat=fs.lstatSync(cursor); if (stat.isSymbolicLink()) fail('receipt authorization evidence traverses a symlink'); }
const actualPath=fs.realpathSync(cursor);
const actualSha=c.createHash('sha256').update(fs.readFileSync(actualPath)).digest('hex');
const validatedSha=c.createHash('sha256').update(fs.readFileSync(expected.path)).digest('hex');
if (actualPath!==expected.path || actualSha!==expected.sha256 || ref.sha256!==expected.sha256 || validatedSha!==expected.sha256) {
  fail('deployment receipt authorization evidence is not the exact authorization file already validated');
}
NODE
  fi
fi
cleanup_delegate_env
trap - EXIT
exit "$RESULT"
