#!/bin/bash -p
# Installs the hashed I00 helper bundle from an already validated release.
# It does not install units, restart services, or contact any external system.
set -euo pipefail
umask 077

unset BASH_ENV ENV CDPATH GLOBIGNORE NODE_OPTIONS NODE_PATH \
  NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_V8_COVERAGE NODE_ICU_DATA \
  NODE_DEBUG NODE_DEBUG_NATIVE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE \
  NODE_DISABLE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_PRESERVE_SYMLINKS_MAIN \
  NODE_TLS_REJECT_UNAUTHORIZED NODE_USE_ENV_PROXY NODE_USE_SYSTEM_CA \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_PROFILE LD_ORIGIN_PATH \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
  OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR \
  HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY \
  http_proxy https_proxy no_proxy all_proxy

INHERITED_NODE_DISCOVERED="$(command -v node 2>/dev/null || :)"
SAFE_PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
PATH="$SAFE_PATH"
export PATH

case "$0" in
  /*) _I00_ENTRY_DIR="${0%/*}" ;;
  */*) _I00_ENTRY_DIR="$PWD/${0%/*}" ;;
  *) printf 'I00_OPS_BLOCKED: installer requires an explicit script path\n' >&2; exit 1 ;;
esac
[ -n "$_I00_ENTRY_DIR" ] || _I00_ENTRY_DIR=/
SCRIPT_DIR="$(cd -P -- "$_I00_ENTRY_DIR" && builtin pwd -P)" \
  || { printf 'I00_OPS_BLOCKED: installer script directory is unavailable\n' >&2; exit 1; }
unset _I00_ENTRY_DIR
I00_ROOT="$(cd -P -- "$SCRIPT_DIR/.." && builtin pwd -P)"
BOUND_EFFECT_RUNNER="$SCRIPT_DIR/run-bound-effect.mjs"
FIXED_GATE_LAUNCHER="$SCRIPT_DIR/run-fixed-node-gate.sh"

blocked() {
  printf 'I00_OPS_BLOCKED: %s\n' "$*" >&2
  exit 1
}

tree_digest() {
  local digest_kind="$1" root="$2" excluded_names="$3" capability_root="$4"
  /proc/self/fd/16 --input-type=module - \
    "$digest_kind" "$root" "$excluded_names" "$capability_root" <<'NODE'
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { resolve } from 'node:path';

const [kind, root, excludedText, capabilityText] = process.argv.slice(2);
const excluded = new Set(excludedText === '' ? [] : excludedText.split(','));
const capabilityRoot = capabilityText === '1';
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
if (!['typed', 'regular'].includes(kind)) fail('install tree digest kind is invalid');
const sameStat = (left, right) => [
  'dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs',
].every((field) => left[field] === right[field]);
const rootStat = () => capabilityRoot
  ? fstatSync(51, { bigint: true })
  : lstatSync(root, { bigint: true });

function scan() {
  const firstRoot = rootStat();
  if (!firstRoot.isDirectory() || (!capabilityRoot && firstRoot.isSymbolicLink())) {
    fail('install tree root is not one real directory');
  }
  const entries = [];
  let entryCount = 0;
  let totalBytes = 0;
  function walk(directory, relative = '') {
    const before = relative === '' ? rootStat() : lstatSync(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) {
      fail('install tree contains an unsafe directory');
    }
    const names = readdirSync(directory).sort();
    for (const name of names) {
      const next = relative === '' ? name : `${relative}/${name}`;
      if (relative === '' && excluded.has(name)) continue;
      entryCount += 1;
      if (entryCount > 20_000) fail('install tree entry count exceeds its closed limit');
      const absolute = resolve(directory, name);
      const namedBefore = lstatSync(absolute, { bigint: true });
      if (namedBefore.isSymbolicLink()) fail('install tree contains a symbolic link');
      if (namedBefore.isDirectory()) {
        entries.push({ path: next, type: 'directory' });
        walk(absolute, next);
        continue;
      }
      if (!namedBefore.isFile() || namedBefore.nlink !== 1n) {
        fail('install tree contains an unsupported entry');
      }
      const mode = namedBefore.mode & 0o7777n;
      if ((mode & 0o7000n) !== 0n) fail('install tree contains special mode bits');
      const executable = mode & 0o111n;
      if (executable !== 0n && executable !== 0o111n) {
        fail('install tree contains an ambiguous executable mode');
      }
      let descriptor;
      try {
        descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const openedBefore = fstatSync(descriptor, { bigint: true });
        if (!sameStat(namedBefore, openedBefore)) fail('install tree file changed before read');
        const bytes = readFileSync(descriptor);
        const openedAfter = fstatSync(descriptor, { bigint: true });
        const namedAfter = lstatSync(absolute, { bigint: true });
        if (!sameStat(openedBefore, openedAfter) || !sameStat(openedAfter, namedAfter)) {
          fail('install tree file changed during read');
        }
        totalBytes += bytes.length;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > 4 * 1024 * 1024 * 1024) {
          fail('install tree byte count exceeds its closed limit');
        }
        entries.push({
          path: next,
          type: 'file',
          mode: executable === 0o111n ? '100755' : '100644',
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    }
    const after = relative === '' ? rootStat() : lstatSync(directory, { bigint: true });
    if (!sameStat(before, after)) fail('install tree directory changed during scan');
  }
  walk(root);
  if (!sameStat(firstRoot, rootStat())) fail('install tree root changed during scan');
  return entries;
}

const first = scan();
const second = scan();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  fail('install tree changed around stable verification');
}
const hash = createHash('sha256');
for (const entry of first) {
  if (kind === 'typed' && entry.type === 'directory') {
    hash.update('directory\0');
    hash.update(entry.path);
    hash.update('\n');
  } else if (entry.type === 'file') {
    hash.update(entry.path);
    hash.update('\0');
    if (kind === 'typed') {
      hash.update(entry.mode);
      hash.update('\0');
    }
    hash.update(entry.sha256);
    hash.update('\n');
  }
}
process.stdout.write(hash.digest('hex'));
NODE
}

require_immutable_tree() {
  local root="$1"
  /proc/self/fd/16 - "$root" <<'NODE'
const {
  lstatSync, readdirSync,
} = require('node:fs');
const { resolve } = require('node:path');
const root = process.argv[2];
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
const uid = typeof process.geteuid === 'function' ? BigInt(process.geteuid()) : null;
let count = 0;
function walk(directory, rootEntry = false) {
  const before = lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    fail('frozen install contains an unsafe directory');
  }
  const mode = before.mode & 0o7777n;
  if ((mode & 0o7000n) !== 0n || (mode & 0o222n) !== 0n
      || (rootEntry && mode !== 0o511n) || (uid !== null && before.uid !== uid)) {
    fail('frozen install directory mode or owner is invalid');
  }
  for (const name of readdirSync(directory).sort()) {
    count += 1;
    if (count > 20_000) fail('frozen install entry count exceeds its closed limit');
    const absolute = resolve(directory, name);
    const entry = lstatSync(absolute, { bigint: true });
    if (entry.isSymbolicLink()) fail('frozen install contains a symbolic link');
    if (entry.isDirectory()) {
      walk(absolute, false);
      continue;
    }
    const fileMode = entry.mode & 0o7777n;
    const executable = fileMode & 0o111n;
    if (!entry.isFile() || entry.nlink !== 1n || (fileMode & 0o7000n) !== 0n
        || (fileMode & 0o222n) !== 0n || (uid !== null && entry.uid !== uid)
        || (executable !== 0n && executable !== 0o111n)) {
      fail('frozen install file mode or owner is invalid');
    }
  }
  const after = lstatSync(directory, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode
      || before.uid !== after.uid || before.gid !== after.gid) {
    fail('frozen install directory identity changed');
  }
}
walk(root, true);
NODE
}

run_authorized_install_effect() {
  [ "$#" -eq 4 ] && [ "$1" = --release ] && [ "$3" = --destination ] \
    || blocked "authorized install effect arguments are invalid"
  local release_requested="$2" destination="$4"
  [ "${_I00_RUNNER_PARENT_VERIFIED:-}" = 1 ] \
    || blocked "authorized install effect lacks the verified runner parent"
  [ "$EUID" -eq 0 ] || blocked "authorized install effect requires root"
  [ "${I00_AUTHORIZED_EFFECT_FD:-}" = 3 ] \
    && [ "${I00_AUTHORIZED_EFFECT_ACK_FD:-}" = 4 ] \
    && [ "${I00_AUTHORIZED_EFFECT_VERIFIER_FD:-}" = 38 ] \
    && [ "${I00_EFFECT_EXEC_NODE_FD:-}" = 16 ] \
    && [ "${I00_EFFECT_EXEC_BASH_FD:-}" = 17 ] \
    && [ "${I00_EFFECT_EXEC_MKDIR_FD:-}" = 27 ] \
    && [ "${I00_EFFECT_EXEC_CP_FD:-}" = 28 ] \
    && [ "${I00_EFFECT_EXEC_CHMOD_FD:-}" = 29 ] \
    && [ "${I00_EFFECT_EXEC_MV_FD:-}" = 30 ] \
    && [ "${I00_EFFECT_EXEC_RM_FD:-}" = 31 ] \
    && [ "${I00_AUTHORIZED_EFFECT_WRITE_ROOT_DESTINATION_PARENT_FD:-}" = 40 ] \
    && [ "${I00_AUTHORIZED_EFFECT_READ_ROOT_RELEASE_SOURCE_FD:-}" = 51 ] \
    || blocked "authorized install capability locators are invalid"

  local handoff_json release_tree_bound
  handoff_json="$(/proc/self/fd/16 /proc/self/fd/38 --role PRIMARY_EFFECT)" \
    || blocked "authorized install handoff verification failed"
  release_tree_bound="$(/proc/self/fd/16 - \
    "$handoff_json" "$release_requested" "$destination" <<'NODE'
const { fstatSync, realpathSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const [text, release, destination] = process.argv.slice(2);
const fail = () => process.exit(1);
let value;
try { value = JSON.parse(text); } catch { fail(); }
const exact = (object, keys) => {
  if (!object || typeof object !== 'object' || Array.isArray(object)
      || JSON.stringify(Object.keys(object).sort()) !== JSON.stringify([...keys].sort())) fail();
};
exact(value, [
  'status', 'role', 'actionClass', 'command', 'environment', 'bootstrap',
  'directory', 'executables', 'helperPolicy', 'automaticRollback', 'hashPolicy',
  'writeRoots', 'readRoots', 'observedRoots',
]);
exact(value.environment, ['kind', 'fd']);
exact(value.bootstrap, ['kind', 'fd']);
exact(value.directory, ['kind', 'fd']);
exact(value.executables, ['node', 'bash', 'mkdir', 'cp', 'chmod', 'mv', 'rm']);
exact(value.writeRoots, ['destinationParent']);
exact(value.writeRoots.destinationParent, ['fd', 'path', 'identity']);
exact(value.readRoots, ['releaseSource']);
exact(value.readRoots.releaseSource, ['fd', 'path', 'identity', 'treeSha256']);
exact(value.observedRoots, []);
exact(value.automaticRollback, []);
if (value.status !== 'AUTHORIZED_EFFECT_HANDOFF_VERIFIED'
    || value.role !== 'PRIMARY_EFFECT'
    || value.actionClass !== 'OPS_BUNDLE_INSTALL'
    || value.command !== 'install-ops-bundle'
    || value.environment.kind !== 'NONE' || value.environment.fd !== 'NONE'
    || value.bootstrap.kind !== 'NONE' || value.bootstrap.fd !== 'NONE'
    || value.directory.kind !== 'CLAIM_TEMPORARY_DIRECTORY'
    || value.directory.fd !== '/proc/self/fd/15'
    || value.helperPolicy !== 'NONE'
    || value.hashPolicy !== 'NONE'
    || JSON.stringify(value.executables) !== JSON.stringify({
      node: '/proc/self/fd/16',
      bash: '/proc/self/fd/17',
      mkdir: '/proc/self/fd/27',
      cp: '/proc/self/fd/28',
      chmod: '/proc/self/fd/29',
      mv: '/proc/self/fd/30',
      rm: '/proc/self/fd/31',
    })
    || value.writeRoots.destinationParent.fd !== '/proc/self/fd/40'
    || value.writeRoots.destinationParent.path !== dirname(destination)
    || value.readRoots.releaseSource.fd !== '/proc/self/fd/51'
    || value.readRoots.releaseSource.path !== release
    || !/^[0-9a-f]{64}$/.test(value.readRoots.releaseSource.treeSha256)
    || resolve(destination) !== destination
    || realpathSync('/proc/self/fd/40') !== dirname(destination)
    || realpathSync('/proc/self/fd/51') !== release) fail();
const writeStat = fstatSync(40, { bigint: true });
const readStat = fstatSync(51, { bigint: true });
if (!writeStat.isDirectory() || !readStat.isDirectory()) fail();
process.stdout.write(value.readRoots.releaseSource.treeSha256);
NODE
  )" || blocked "authorized install safe projection is invalid"

  local release_cap=/proc/self/fd/51
  local write_cap=/proc/self/fd/40
  local release_tree_before expected_i00_digest release_snapshot
  release_tree_before="$(tree_digest typed "$release_cap" "" 1)" \
    || blocked "release read capability tree validation failed"
  [ "$release_tree_before" = "$release_tree_bound" ] \
    || blocked "release read capability differs from the authorization binding"
  expected_i00_digest="$(tree_digest typed "$release_cap/ops/i00" \
    "accepted-ops-live,install-receipt.json" 0)" \
    || blocked "release I00 enforcement tree validation failed"
  release_snapshot="$(/proc/self/fd/16 - \
    "$release_cap" "$release_requested" "$release_tree_before" \
    "$expected_i00_digest" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const [root, requested, treeSha256, i00Digest] = process.argv.slice(2);
const fail = () => process.exit(1);
const risk = JSON.parse(readFileSync('/proc/self/fd/6', 'utf8'));
const endpoint = (prefix) => {
  const marker = `${prefix}:`;
  const matches = risk.action.allowedEndpoints
    .filter((value) => value.startsWith(marker))
    .map((value) => value.slice(marker.length));
  if (matches.length !== 1) fail();
  return matches[0];
};
const releaseBytes = readFileSync(resolve(root, 'release.json'));
const manifestBytes = readFileSync(resolve(root, 'artifact-manifest.json'));
const release = JSON.parse(releaseBytes);
if (endpoint('release-path') !== requested
    || endpoint('release-tree-sha256') !== treeSha256
    || endpoint('release-sha') !== release.testedSha
    || endpoint('artifact-manifest-sha256')
      !== createHash('sha256').update(manifestBytes).digest('hex')
    || !/^[0-9a-f]{40}$/.test(release.testedSha)
    || release.releaseId !== `i00-${release.testedSha}`
    || !/^[0-9a-f]{64}$/.test(i00Digest)) fail();
process.stdout.write(JSON.stringify({
  testedSha: release.testedSha,
  releaseId: release.releaseId,
  i00EnforcementTreeDigestSha256: i00Digest,
}));
NODE
  )" || blocked "release read capability metadata validation failed"

  local destination_name="${destination##*/}"
  local destination_parent="${destination%/*}"
  case "$destination_name" in
    ""|"."|".."|*[!A-Za-z0-9._-]*) blocked "authorized destination leaf is invalid" ;;
  esac
  [ "$destination_parent" = "$(/proc/self/fd/16 -e \
      'const fs=require("fs");process.stdout.write(fs.realpathSync("/proc/self/fd/40"))')" ] \
    || blocked "authorized destination parent differs from its write capability"
  local destination_cap="$write_cap/$destination_name"
  [ ! -e "$destination_cap" ] && [ ! -L "$destination_cap" ] \
    || blocked "destination already exists"

  local staging_name=".i00.partial.$$"
  local staging="$write_cap/$staging_name"
  local staging_live="$staging/accepted-ops-live"
  local staging_active=0
  cleanup_authorized_staging() {
    if [ "$staging_active" = 1 ]; then
      /proc/self/fd/31 -rf --one-file-system -- "$staging" >/dev/null 2>&1 || :
    fi
  }
  trap cleanup_authorized_staging EXIT
  /proc/self/fd/27 -m 700 -- "$staging" \
    || blocked "private install staging claim failed"
  staging_active=1
  /proc/self/fd/28 -pR -- "$release_cap/ops/i00/." "$staging/" \
    || blocked "I00 enforcement copy failed"
  /proc/self/fd/29 700 -- "$staging" \
    || blocked "private install staging mode failed"
  for reserved in accepted-ops-live install-receipt.json; do
    [ ! -e "$staging/$reserved" ] && [ ! -L "$staging/$reserved" ] \
      || blocked "release I00 tree contains a reserved installed-bundle path"
  done
  [ "$(tree_digest typed "$staging" "accepted-ops-live,install-receipt.json" 0)" \
      = "$expected_i00_digest" ] \
    || blocked "staged I00 enforcement tree differs from the release"

  /proc/self/fd/27 -m 700 -- "$staging_live" \
    || blocked "effective donor staging claim failed"
  /proc/self/fd/28 -pR -- "$release_cap/ops/live/." "$staging_live/" \
    || blocked "effective donor copy failed"

  /proc/self/fd/16 - "$staging" "$release_snapshot" \
    "$expected_i00_digest" <<'NODE' \
    || blocked "install receipt publication failed"
const { createHash } = require('node:crypto');
const {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  readSync, readdirSync, writeFileSync,
} = require('node:fs');
const { resolve } = require('node:path');
const [root, releaseText, expectedI00Digest] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
};
const sameStat = (left, right) => [
  'dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs',
].every((field) => left[field] === right[field]);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safePath = (value) => typeof value === 'string' && value.length > 0
  && !value.startsWith('/') && !value.split('/').includes('..')
  && /^[A-Za-z0-9._/-]+$/.test(value);
function scan(directory, relative = '', entries = [], state = { count: 0, bytes: 0 }) {
  const before = lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) fail('install staging directory is unsafe');
  for (const name of readdirSync(directory).sort()) {
    const next = relative === '' ? name : `${relative}/${name}`;
    state.count += 1;
    if (state.count > 20_000) fail('install staging entry count exceeds its closed limit');
    const absolute = resolve(directory, name);
    const namedBefore = lstatSync(absolute, { bigint: true });
    if (namedBefore.isSymbolicLink()) fail('install staging contains a symbolic link');
    if (namedBefore.isDirectory()) {
      entries.push({ path: next, type: 'directory' });
      scan(absolute, next, entries, state);
      continue;
    }
    if (!namedBefore.isFile() || namedBefore.nlink !== 1n) {
      fail('install staging contains an unsupported entry');
    }
    const mode = namedBefore.mode & 0o7777n;
    const executable = mode & 0o111n;
    if ((mode & 0o7000n) !== 0n || (executable !== 0n && executable !== 0o111n)) {
      fail('install staging file mode is unsafe');
    }
    let descriptor;
    try {
      descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const openedBefore = fstatSync(descriptor, { bigint: true });
      if (!sameStat(namedBefore, openedBefore)) fail('install staging file changed before read');
      const bytes = readFileSync(descriptor);
      const openedAfter = fstatSync(descriptor, { bigint: true });
      const namedAfter = lstatSync(absolute, { bigint: true });
      if (!sameStat(openedBefore, openedAfter) || !sameStat(openedAfter, namedAfter)) {
        fail('install staging file changed during read');
      }
      state.bytes += bytes.length;
      if (!Number.isSafeInteger(state.bytes) || state.bytes > 4 * 1024 * 1024 * 1024) {
        fail('install staging bytes exceed the closed limit');
      }
      entries.push({
        path: next,
        type: 'file',
        mode: executable === 0o111n ? '100755' : '100644',
        sha256: digest(bytes),
      });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  const after = lstatSync(directory, { bigint: true });
  if (!sameStat(before, after)) fail('install staging directory changed during scan');
  return entries;
}
const regularDigest = (entries) => {
  const hash = createHash('sha256');
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
};
const stableScan = (directory) => {
  const first = scan(directory);
  const second = scan(directory);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    fail('install staging changed around stable verification');
  }
  return first;
};

const release = JSON.parse(releaseText);
if (!/^[0-9a-f]{40}$/.test(release.testedSha)
    || release.releaseId !== `i00-${release.testedSha}`
    || release.i00EnforcementTreeDigestSha256 !== expectedI00Digest) {
  fail('install receipt release binding is invalid');
}
const amendmentPath = resolve(root, 'l15-amendment-contract.json');
const donorPath = resolve(root, 'donor-contract.json');
const amendmentBytes = readFileSync(amendmentPath);
const donorBytes = readFileSync(donorPath);
const amendment = JSON.parse(amendmentBytes);
if (!amendment || typeof amendment !== 'object' || Array.isArray(amendment)
    || !amendment.immutableDonor || !amendment.effectiveLive
    || !Array.isArray(amendment.amendments)
    || !Array.isArray(amendment.effectiveLive.files)
    || amendment.immutableDonor.contractSha256 !== digest(donorBytes)
    || !/^[0-9a-f]{40}$/.test(amendment.immutableDonor.acceptedCommit)
    || !/^[0-9a-f]{40}$/.test(amendment.immutableDonor.acceptedLiveTree)
    || !/^[0-9a-f]{40}$/.test(amendment.effectiveLive.tree)
    || !/^[0-9a-f]{64}$/.test(amendment.effectiveLive.rootDigestSha256)) {
  fail('install receipt L15 contract binding is invalid');
}
const liveEntries = stableScan(resolve(root, 'accepted-ops-live'));
const liveFiles = liveEntries.filter((entry) => entry.type === 'file');
const liveDirectories = liveEntries.filter((entry) => entry.type === 'directory')
  .map((entry) => entry.path);
const expectedFiles = amendment.effectiveLive.files;
let prior = '';
for (const file of expectedFiles) {
  if (!file || typeof file !== 'object' || !safePath(file.path)
      || file.path <= prior || !['100644', '100755'].includes(file.mode)
      || !/^[0-9a-f]{64}$/.test(file.sha256)) {
    fail('install receipt L15 file contract is invalid');
  }
  prior = file.path;
}
const expectedDirectories = [...new Set(expectedFiles.flatMap((file) => {
  const parts = file.path.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}))].sort();
if (JSON.stringify(liveFiles) !== JSON.stringify(expectedFiles.map((file) => ({
  path: file.path,
  type: 'file',
  mode: file.mode,
  sha256: file.sha256,
}))) || JSON.stringify(liveDirectories) !== JSON.stringify(expectedDirectories)
    || regularDigest(liveEntries) !== amendment.effectiveLive.rootDigestSha256) {
  fail('staged effective donor tree differs from the L15 contract');
}
const rootEntries = stableScan(root);
if (rootEntries.some((entry) => entry.path === 'install-receipt.json')) {
  fail('install receipt target is not create-only');
}
const document = {
  schemaVersion: 2,
  testedSha: release.testedSha,
  sourceReleaseId: release.releaseId,
  installedTreeDigestSha256: regularDigest(rootEntries),
  effectiveOpsRoot: 'accepted-ops-live',
  immutableDonorCommit: amendment.immutableDonor.acceptedCommit,
  immutableDonorLiveTree: amendment.immutableDonor.acceptedLiveTree,
  immutableDonorContractSha256: amendment.immutableDonor.contractSha256,
  amendmentContractSha256: digest(amendmentBytes),
  effectiveLiveTree: amendment.effectiveLive.tree,
  effectiveRootDigestSha256: amendment.effectiveLive.rootDigestSha256,
  i00EnforcementTreeDigestSha256: expectedI00Digest,
  authorizedCorrectionFindingIds: amendment.amendments.map((entry) => entry.findingId),
  serviceMutationPerformed: false,
};
if (document.authorizedCorrectionFindingIds.some((value) => (
  typeof value !== 'string' || value.length === 0
))) fail('install receipt correction finding set is invalid');
const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
let rootDescriptor;
let outputDescriptor;
try {
  rootDescriptor = openSync(
    root,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  const rootBefore = fstatSync(rootDescriptor, { bigint: true });
  if (!rootBefore.isDirectory() || (rootBefore.mode & 0o7777n) !== 0o700n
      || rootBefore.uid !== BigInt(process.geteuid())) {
    fail('install receipt root capability is invalid');
  }
  outputDescriptor = openSync(
    `/proc/self/fd/${rootDescriptor}/install-receipt.json`,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  writeFileSync(outputDescriptor, bytes);
  fsyncSync(outputDescriptor);
  const written = fstatSync(outputDescriptor, { bigint: true });
  if (!written.isFile() || written.nlink !== 1n
      || (written.mode & 0o7777n) !== 0o600n || written.size !== BigInt(bytes.length)
      || written.uid !== BigInt(process.geteuid())) {
    fail('install receipt exact-create result is invalid');
  }
  const named = lstatSync(
    `/proc/self/fd/${rootDescriptor}/install-receipt.json`,
    { bigint: true },
  );
  if (named.isSymbolicLink() || !sameStat(written, named)) {
    fail('install receipt named identity differs from its descriptor');
  }
  const readback = Buffer.alloc(bytes.length);
  let offset = 0;
  while (offset < readback.length) {
    const count = readSync(
      outputDescriptor,
      readback,
      offset,
      readback.length - offset,
      offset,
    );
    if (count <= 0) fail('install receipt readback was truncated');
    offset += count;
  }
  if (!readback.equals(bytes)) fail('install receipt readback differs');
  if (!sameStat(rootBefore, fstatSync(rootDescriptor, { bigint: true }))) {
    fail('install receipt root capability changed during publication');
  }
  fsyncSync(rootDescriptor);
} finally {
  if (outputDescriptor !== undefined) closeSync(outputDescriptor);
  if (rootDescriptor !== undefined) closeSync(rootDescriptor);
}
process.stdout.write('{"status":"INSTALL_RECEIPT_PUBLISHED_CREATE_ONLY"}\n');
NODE

  /proc/self/fd/29 -R a-w -- "$staging" \
    || blocked "install staging freeze failed"
  /proc/self/fd/29 go+x -- "$staging" \
    || blocked "install staging search mode failed"
  require_immutable_tree "$staging" \
    || blocked "frozen install tree validation failed"
  [ "$(tree_digest typed "$staging" "accepted-ops-live,install-receipt.json" 0)" \
      = "$expected_i00_digest" ] \
    || blocked "frozen I00 enforcement tree differs from the release"

  local frozen_live_digest frozen_pre_receipt_digest
  frozen_live_digest="$(tree_digest regular "$staging_live" "" 0)" \
    || blocked "frozen effective donor tree validation failed"
  frozen_pre_receipt_digest="$(tree_digest regular "$staging" "install-receipt.json" 0)" \
    || blocked "frozen install receipt tree binding failed"
  /proc/self/fd/16 - "$staging/install-receipt.json" \
    "$frozen_live_digest" "$frozen_pre_receipt_digest" \
    "$expected_i00_digest" <<'NODE' \
    || blocked "frozen install receipt binding failed"
const { readFileSync } = require('node:fs');
const [path, liveDigest, installedDigest, i00Digest] = process.argv.slice(2);
const bytes = readFileSync(path);
const document = JSON.parse(bytes);
if (!bytes.equals(Buffer.from(`${JSON.stringify(document, null, 2)}\n`))
    || document.effectiveRootDigestSha256 !== liveDigest
    || document.installedTreeDigestSha256 !== installedDigest
    || document.i00EnforcementTreeDigestSha256 !== i00Digest
    || document.serviceMutationPerformed !== false) process.exit(1);
NODE
  [ "$(tree_digest typed "$release_cap" "" 1)" = "$release_tree_before" ] \
    || blocked "release read capability changed during install"

  local staging_identity
  staging_identity="$(/proc/self/fd/16 - "$staging" <<'NODE'
const { lstatSync } = require('node:fs');
const stat = lstatSync(process.argv[2], { bigint: true });
if (!stat.isDirectory() || stat.isSymbolicLink()) process.exit(1);
process.stdout.write(`${stat.dev}:${stat.ino}:${stat.uid}:${stat.gid}`);
NODE
  )" || blocked "frozen install identity capture failed"
  /proc/self/fd/30 -T -- "$staging" "$destination_cap" \
    || blocked "atomic install publication failed"
  staging_active=0
  trap - EXIT
  /proc/self/fd/16 - "$destination_cap" "$staging" "$staging_identity" <<'NODE' \
    || blocked "published install identity validation failed"
const { fstatSync, fsyncSync, lstatSync } = require('node:fs');
const [destination, staging, expectedIdentity] = process.argv.slice(2);
const published = lstatSync(destination, { bigint: true, throwIfNoEntry: false });
const stale = lstatSync(staging, { bigint: true, throwIfNoEntry: false });
if (!published?.isDirectory() || published.isSymbolicLink()
    || (published.mode & 0o7777n) !== 0o511n
    || published.uid !== BigInt(process.geteuid()) || stale !== undefined
    || `${published.dev}:${published.ino}:${published.uid}:${published.gid}` !== expectedIdentity
    || !fstatSync(40, { bigint: true }).isDirectory()) process.exit(1);
fsyncSync(40);
NODE
  require_immutable_tree "$destination_cap" \
    || blocked "published install tree validation failed"
}

if [ "${1-}" = --authorized-effect ]; then
  shift
  run_authorized_install_effect "$@"
  exit 0
fi

select_privileged_node() {
  local candidate checked_path metadata owner mode trusted
  [ "$EUID" -eq 0 ] || blocked "production Node bootstrap requires root"
  [ -f /usr/bin/stat ] && [ ! -L /usr/bin/stat ] && [ -x /usr/bin/stat ] \
    && [ -O /usr/bin/stat ] \
    || blocked "fixed root-owned stat bootstrap is unavailable"
  [ -f "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    && [ ! -L "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    && [ -x "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    && [ -O "$SCRIPT_DIR/run-fixed-node-gate.sh" ] \
    || blocked "fixed I00 tree verifier is unavailable"
  for candidate in /usr/bin/node; do
    [ -f "$candidate" ] && [ ! -L "$candidate" ] && [ -x "$candidate" ] || continue
    trusted=1
    for checked_path in / /usr /usr/bin "$candidate"; do
      metadata="$(/usr/bin/stat -c '%u:%a' -- "$checked_path" 2>/dev/null)" \
        || { trusted=0; break; }
      owner="${metadata%%:*}"
      mode="${metadata#*:}"
      case "$owner:$mode" in
        0:[0-7][0-7][0-7]|0:[0-7][0-7][0-7][0-7]) ;;
        *) trusted=0; break ;;
      esac
      [ $((8#$mode & 8#22)) -eq 0 ] || { trusted=0; break; }
    done
    [ "$trusted" = 1 ] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  blocked "fixed root-owned Node runtime is unavailable"
}

RELEASE="" DESTINATION="" AUTHORIZATION="" TARGET_HOST="" TARGET_ENVIRONMENT=""
TARGET_ACCOUNT="" RESULT_RECEIPT="" RECONCILIATION_RECEIPT="" SIMULATION_ROOT=""
TRUSTED_BUILD_PUBLIC_KEY="" SIMULATION=0
OPERATOR="" CONFIG_VERSION="" DEPLOYMENT_RISK="" ACTION_PREVIEW=""
AUTHORIZATION_CONSUMPTION_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:?--release needs a value}"; shift 2 ;;
    --destination) DESTINATION="${2:?--destination needs a value}"; shift 2 ;;
    --authorization) AUTHORIZATION="${2:?--authorization needs a value}"; shift 2 ;;
    --operator) OPERATOR="${2:?--operator needs a value}"; shift 2 ;;
    --config-version) CONFIG_VERSION="${2:?--config-version needs a value}"; shift 2 ;;
    --deployment-risk) DEPLOYMENT_RISK="${2:?--deployment-risk needs a value}"; shift 2 ;;
    --action-preview) ACTION_PREVIEW="${2:?--action-preview needs a value}"; shift 2 ;;
    --authorization-consumption-root) AUTHORIZATION_CONSUMPTION_ROOT="${2:?--authorization-consumption-root needs a value}"; shift 2 ;;
    --host) TARGET_HOST="${2:?--host needs a value}"; shift 2 ;;
    --environment) TARGET_ENVIRONMENT="${2:?--environment needs a value}"; shift 2 ;;
    --account) TARGET_ACCOUNT="${2:?--account needs a value}"; shift 2 ;;
    --result-receipt) RESULT_RECEIPT="${2:?--result-receipt needs a value}"; shift 2 ;;
    --reconciliation-receipt) RECONCILIATION_RECEIPT="${2:?--reconciliation-receipt needs a value}"; shift 2 ;;
    --trusted-build-public-key) TRUSTED_BUILD_PUBLIC_KEY="${2:?--trusted-build-public-key needs a value}"; shift 2 ;;
    --simulation-root) SIMULATION_ROOT="${2:?--simulation-root needs a value}"; shift 2 ;;
    --simulation) SIMULATION=1; shift ;;
    *) blocked "unknown argument $1" ;;
  esac
done
[ -n "$RELEASE" ] && [ -n "$DESTINATION" ] \
  || blocked "--release and --destination are required"
case "$RELEASE" in
  /*) ;;
  *) blocked "--release must be one absolute lexical canonical path" ;;
esac
case "$RELEASE" in
  *//*|*/./*|*/../*|*/.|*/..) \
    blocked "--release must be one absolute lexical canonical path" ;;
esac

DESTINATION_REQUESTED="$DESTINATION"
case "$DESTINATION_REQUESTED" in
  /*) DESTINATION_PARENT_RAW="${DESTINATION_REQUESTED%/*}"; DESTINATION_NAME="${DESTINATION_REQUESTED##*/}" ;;
  *) blocked "destination must be one absolute child path" ;;
esac
[ -n "$DESTINATION_PARENT_RAW" ] || DESTINATION_PARENT_RAW=/
DESTINATION_PARENT="$(cd -P -- "$DESTINATION_PARENT_RAW" && builtin pwd -P)" \
  || blocked "destination parent must already exist"
[ -n "$DESTINATION_NAME" ] && [ "$DESTINATION_NAME" != "." ] && [ "$DESTINATION_NAME" != ".." ] \
  || blocked "destination leaf is invalid"
DESTINATION="$DESTINATION_PARENT/$DESTINATION_NAME"
[ "$DESTINATION_REQUESTED" = "$DESTINATION" ] \
  || blocked "destination must be one raw canonical direct-child path"

if [ "$SIMULATION" = 1 ]; then
  [ -n "$SIMULATION_ROOT" ] || blocked "simulation requires --simulation-root"
  [ -n "$INHERITED_NODE_DISCOVERED" ] || blocked "simulation Node executable is unavailable"
  case "$INHERITED_NODE_DISCOVERED" in
    /*) : ;;
    *) blocked "simulation Node executable must resolve to an absolute path" ;;
  esac
  SIMULATION_NODE_PATH="$("$INHERITED_NODE_DISCOVERED" -e \
    'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' \
    "$INHERITED_NODE_DISCOVERED")"
  "$SIMULATION_NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" \
    --path "$SIMULATION_NODE_PATH" >/dev/null
  hash -p "$SIMULATION_NODE_PATH" node
  RUNTIME_NODE_PATH="$SIMULATION_NODE_PATH"

  ROOT_CANON="$("$RUNTIME_NODE_PATH" "$SCRIPT_DIR/validate-simulation-root.mjs" \
    --root "$SIMULATION_ROOT")"
  case "$DESTINATION_PARENT" in
    "$ROOT_CANON"|"$ROOT_CANON"/*) : ;;
    *) blocked "simulation destination is outside fake root" ;;
  esac
  VALIDATION_JSON="$("$RUNTIME_NODE_PATH" "$SCRIPT_DIR/validate-release.mjs" \
    --release "$RELEASE" --allow-simulation --require-exact-cohort)"
  VALIDATOR_COHORT_MODE="$("$RUNTIME_NODE_PATH" -e \
    'const v=JSON.parse(process.argv[1]);process.stdout.write(v.validatorCohortMode)' \
    "$VALIDATION_JSON")"
  [ "$VALIDATOR_COHORT_MODE" = EXACT_TRUSTED_COHORT ] \
    || blocked "validation-only legacy cohort compatibility cannot authorize installation"

  inspect_simulation_command() {
    local name="$1" discovered canonical
    discovered="$(PATH="$SAFE_PATH" command -v "$name")" \
      || blocked "required simulation installer executable is unavailable"
    canonical="$("$RUNTIME_NODE_PATH" -e \
      'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' \
      "$discovered")"
    "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/inspect-executable.mjs" --path "$canonical"
  }
  command_field() {
    "$RUNTIME_NODE_PATH" -e \
      "process.stdout.write(JSON.parse(process.argv[1]).$2)" "$1"
  }
  MKDIR_INITIAL="$(inspect_simulation_command mkdir)"
  CP_INITIAL="$(inspect_simulation_command cp)"
  CHMOD_INITIAL="$(inspect_simulation_command chmod)"
  MV_INITIAL="$(inspect_simulation_command mv)"
  RM_INITIAL="$(inspect_simulation_command rm)"
  MKDIR_PATH="$(command_field "$MKDIR_INITIAL" path)"
  CP_PATH="$(command_field "$CP_INITIAL" path)"
  CHMOD_PATH="$(command_field "$CHMOD_INITIAL" path)"
  require_simulation_command_identities() {
    [ "$(inspect_simulation_command mkdir)" = "$MKDIR_INITIAL" ] \
      && [ "$(inspect_simulation_command cp)" = "$CP_INITIAL" ] \
      && [ "$(inspect_simulation_command chmod)" = "$CHMOD_INITIAL" ] \
      && [ "$(inspect_simulation_command mv)" = "$MV_INITIAL" ] \
      && [ "$(inspect_simulation_command rm)" = "$RM_INITIAL" ] \
      || blocked "simulation installer executable identity changed"
  }
  INSTALL_TREE_HELPER_BASE=(
    --destination "$DESTINATION"
    --mkdir-binding "$MKDIR_INITIAL"
    --mv-binding "$MV_INITIAL"
    --rm-binding "$RM_INITIAL"
    --simulation
    --simulation-root "$ROOT_CANON"
  )
  run_install_tree_helper() {
    "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/publish-install-tree.mjs" \
      "${INSTALL_TREE_HELPER_BASE[@]}" "$@"
  }

  EXPECTED_I00_ENFORCEMENT_DIGEST="$("$RUNTIME_NODE_PATH" --input-type=module -e '
    import {resolve} from "node:path";
    const [lib,root]=process.argv.slice(1);
    const {typedTreeDigest}=await import(new URL(`file://${resolve(lib)}`));
    process.stdout.write(typedTreeDigest(root,{excludeTopLevel:["accepted-ops-live","install-receipt.json"]}));
  ' "$I00_ROOT/lib.mjs" "$I00_ROOT")"
  "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/verify-donor.mjs" \
    --contract "$RELEASE/ops/i00/donor-contract.json" \
    --amendment-contract "$RELEASE/ops/i00/l15-amendment-contract.json" \
    --contract-only >/dev/null
  "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/verify-donor-root.mjs" \
    --contract "$RELEASE/ops/i00/donor-contract.json" \
    --amendment-contract "$RELEASE/ops/i00/l15-amendment-contract.json" \
    --root "$RELEASE/ops/live" >/dev/null
  [ ! -e "$DESTINATION" ] \
    || blocked "destination already exists; replacement requires a new reviewed release procedure"
  STAGING_NAME="$DESTINATION_NAME.partial.$$"
  require_simulation_command_identities
  STAGING_CLAIM_JSON="$(run_install_tree_helper \
    --operation claim --staging-name "$STAGING_NAME")" \
    || blocked "could not claim private staging directory"
  STAGING="$("$RUNTIME_NODE_PATH" -e \
    'process.stdout.write(JSON.parse(process.argv[1]).staging)' "$STAGING_CLAIM_JSON")"
  STAGING_CLAIM="$("$RUNTIME_NODE_PATH" -e \
    'process.stdout.write(JSON.parse(process.argv[1]).claim)' "$STAGING_CLAIM_JSON")"
  cleanup_simulation_staging() {
    if [ -n "${STAGING_CLAIM:-}" ]; then
      run_install_tree_helper --operation cleanup --claim "$STAGING_CLAIM" >/dev/null || :
    fi
  }
  trap cleanup_simulation_staging EXIT
  verify_simulation_staging() {
    run_install_tree_helper --operation verify --claim "$STAGING_CLAIM" >/dev/null
  }

  require_simulation_command_identities
  verify_simulation_staging
  "$CP_PATH" -pR "$RELEASE/ops/i00/." "$STAGING/"
  "$CHMOD_PATH" 700 "$STAGING"
  verify_simulation_staging
  for reserved in accepted-ops-live install-receipt.json; do
    [ ! -e "$STAGING/$reserved" ] && [ ! -L "$STAGING/$reserved" ] \
      || blocked "staged I00 contains reserved installed-bundle path $reserved"
  done
  "$MKDIR_PATH" "$STAGING/accepted-ops-live"
  "$CP_PATH" -pR "$RELEASE/ops/live/." "$STAGING/accepted-ops-live/"
  verify_simulation_staging
  "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/verify-donor.mjs" \
    --contract "$STAGING/donor-contract.json" \
    --amendment-contract "$STAGING/l15-amendment-contract.json" \
    --contract-only >/dev/null
  STAGED_L15_VERIFICATION="$("$RUNTIME_NODE_PATH" \
    "$SCRIPT_DIR/verify-donor-root.mjs" \
    --contract "$STAGING/donor-contract.json" \
    --amendment-contract "$STAGING/l15-amendment-contract.json" \
    --root "$STAGING/accepted-ops-live")"
  STAGED_I00_ENFORCEMENT_DIGEST="$("$RUNTIME_NODE_PATH" --input-type=module -e '
    import {resolve} from "node:path";
    const [lib,root]=process.argv.slice(1);
    const {typedTreeDigest}=await import(new URL(`file://${resolve(lib)}`));
    process.stdout.write(typedTreeDigest(root,{excludeTopLevel:["accepted-ops-live","install-receipt.json"]}));
  ' "$I00_ROOT/lib.mjs" "$STAGING")"
  [ "$STAGED_I00_ENFORCEMENT_DIGEST" = "$EXPECTED_I00_ENFORCEMENT_DIGEST" ] \
    || blocked "staged I00 enforcement cohort differs from validated release"
  "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/publish-install-receipt.mjs" \
    --root "$STAGING" \
    --validation-json "$VALIDATION_JSON" \
    --l15-json "$STAGED_L15_VERIFICATION" \
    --i00-enforcement-tree-digest-sha256 "$EXPECTED_I00_ENFORCEMENT_DIGEST" \
    --simulation --simulation-root "$ROOT_CANON" >/dev/null
  "$CHMOD_PATH" -R a-w "$STAGING"
  "$CHMOD_PATH" go+x "$STAGING"
  "$RUNTIME_NODE_PATH" "$SCRIPT_DIR/verify-donor-root.mjs" \
    --contract "$STAGING/donor-contract.json" \
    --amendment-contract "$STAGING/l15-amendment-contract.json" \
    --root "$STAGING/accepted-ops-live" --require-immutable >/dev/null
  FROZEN_I00_ENFORCEMENT_DIGEST="$("$RUNTIME_NODE_PATH" --input-type=module -e '
    import {resolve} from "node:path";
    const [lib,root]=process.argv.slice(1);
    const {typedTreeDigest}=await import(new URL(`file://${resolve(lib)}`));
    process.stdout.write(typedTreeDigest(root,{excludeTopLevel:["accepted-ops-live","install-receipt.json"]}));
  ' "$I00_ROOT/lib.mjs" "$STAGING")"
  [ "$FROZEN_I00_ENFORCEMENT_DIGEST" = "$EXPECTED_I00_ENFORCEMENT_DIGEST" ] \
    || blocked "frozen I00 enforcement cohort differs from validated release"
  require_simulation_command_identities
  run_install_tree_helper --operation publish --claim "$STAGING_CLAIM" >/dev/null
  STAGING_CLAIM=""
  trap - EXIT
  printf '{"status":"OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION","destination":"%s"}\n' \
    "$DESTINATION"
  exit 0
fi

[ -n "$AUTHORIZATION" ] && [ -n "$OPERATOR" ] && [ -n "$CONFIG_VERSION" ] \
  && [ -n "$DEPLOYMENT_RISK" ] && [ -n "$ACTION_PREVIEW" ] \
  && [ -n "$AUTHORIZATION_CONSUMPTION_ROOT" ] && [ -n "$TARGET_HOST" ] \
  && [ -n "$TARGET_ENVIRONMENT" ] && [ -n "$TARGET_ACCOUNT" ] \
  && [ -n "$RESULT_RECEIPT" ] && [ -n "$RECONCILIATION_RECEIPT" ] \
  && [ -n "$TRUSTED_BUILD_PUBLIC_KEY" ] \
  || blocked "real install requires the complete authorization chain, target identity, receipt identity, and trust key"
[ -z "$SIMULATION_ROOT" ] || blocked "real install rejects --simulation-root"

NODE_PATH="$(select_privileged_node)"
FIXED_I00_TREE_INITIAL="$("$FIXED_GATE_LAUNCHER" --attest-tree)" \
  || blocked "fixed I00 gate tree attestation failed"
require_fixed_i00_tree() {
  [ "$("$FIXED_GATE_LAUNCHER" --attest-tree)" = "$FIXED_I00_TREE_INITIAL" ] \
    || blocked "fixed I00 gate tree identity changed"
}
BASH_PATH="$("$NODE_PATH" -e \
  'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' \
  "$BASH")" || blocked "running Bash path cannot be canonicalized"
BASH_INITIAL="$("$FIXED_GATE_LAUNCHER" inspect-executable.mjs \
  --path "$BASH_PATH")" || blocked "running Bash identity inspection failed"
require_outer_bash_binding() {
  local current_path current_identity
  current_path="$("$NODE_PATH" -e \
    'const fs=require("fs");process.stdout.write(fs.realpathSync(process.argv[1]))' \
    "$BASH")" || blocked "running Bash path cannot be rechecked"
  [ "$current_path" = "$BASH_PATH" ] \
    || blocked "running Bash path changed around install authorization"
  current_identity="$("$FIXED_GATE_LAUNCHER" inspect-executable.mjs \
    --path "$current_path")" \
    || blocked "running Bash identity cannot be rechecked"
  [ "$current_identity" = "$BASH_INITIAL" ] \
    || blocked "running Bash executable changed around install authorization"
  "$NODE_PATH" - "$DEPLOYMENT_RISK" "$current_identity" <<'NODE' \
    || blocked "running Bash differs from the risk-bound Bash endpoint"
const fs = require('fs');
const [riskPath, inspectedText] = process.argv.slice(2);
const risk = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
const inspected = JSON.parse(inspectedText);
const endpoint = (prefix) => {
  const marker = `${prefix}:`;
  const matches = risk?.action?.allowedEndpoints
    ?.filter((value) => value.startsWith(marker))
    .map((value) => value.slice(marker.length)) ?? [];
  if (matches.length !== 1) process.exit(1);
  return matches[0];
};
if (inspected.path !== endpoint('bash-path')
    || inspected.sha256 !== endpoint('bash-sha256')
    || inspected.endpointIdentity !== endpoint('bash-identity')) process.exit(1);
NODE
}

require_fixed_i00_tree
require_outer_bash_binding
VALIDATION_JSON="$("$FIXED_GATE_LAUNCHER" validate-release.mjs \
  --release "$RELEASE" --require-exact-cohort \
  --trusted-build-public-key "$TRUSTED_BUILD_PUBLIC_KEY")"
VALIDATOR_COHORT_MODE="$("$NODE_PATH" -e \
  'const v=JSON.parse(process.argv[1]);process.stdout.write(v.validatorCohortMode)' \
  "$VALIDATION_JSON")"
[ "$VALIDATOR_COHORT_MODE" = EXACT_TRUSTED_COHORT ] \
  || blocked "validation-only legacy cohort compatibility cannot authorize installation"
CANDIDATE_SHA="$("$NODE_PATH" -e \
  'const v=JSON.parse(process.argv[1]);process.stdout.write(v.testedSha)' \
  "$VALIDATION_JSON")"

AUTH_BASE=(
  --input "$AUTHORIZATION"
  --class OPS_BUNDLE_INSTALL
  --command install-ops-bundle
  --expected-operator "$OPERATOR"
  --expected-deployed-sha "$CANDIDATE_SHA"
  --expected-config-version "$CONFIG_VERSION"
  --deployment-risk "$DEPLOYMENT_RISK"
  --action-preview "$ACTION_PREVIEW"
  --consumption-root "$AUTHORIZATION_CONSUMPTION_ROOT"
  --expected-host "$TARGET_HOST"
  --expected-environment "$TARGET_ENVIRONMENT"
  --expected-scope cosmos-production-ops-bundle-install
  --expected-account "$TARGET_ACCOUNT"
  --expected-product "Cosmos I00 ops bundle"
  --expected-credential-type ROOT_LOCAL_OPERATOR_SESSION
  --expected-permission filesystem:InstallImmutableOpsBundle
  --expected-result-receipt "$RESULT_RECEIPT"
  --expected-reconciliation-receipt "$RECONCILIATION_RECEIPT"
  --expected-maximum-capital ZERO
  --expected-maximum-notional ZERO
  --expected-maximum-effect "install one exact immutable ops bundle without service mutation"
)
AUTH_ENDPOINTS=()
AUTH_ENDPOINT_LINES="$("$NODE_PATH" -e '
  const fs=require("fs");
  const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(!value.action||!Array.isArray(value.action.allowedEndpoints)
      ||value.action.allowedEndpoints.length===0)process.exit(2);
  for(const endpoint of value.action.allowedEndpoints)console.log(endpoint);
' "$ACTION_PREVIEW")" \
  || blocked "action preview endpoints could not be read"
[ -n "$AUTH_ENDPOINT_LINES" ] \
  || blocked "action preview contains no endpoints"
while IFS= read -r endpoint; do
  [ -n "$endpoint" ] || blocked "action preview contains an empty endpoint"
  AUTH_ENDPOINTS+=(--expected-endpoint "$endpoint")
done <<< "$AUTH_ENDPOINT_LINES"
unset AUTH_ENDPOINT_LINES
require_fixed_i00_tree
require_outer_bash_binding
"$NODE_PATH" -e 'process.exit(process.platform === "linux" ? 0 : 1)' \
  || blocked "authorized effects require Linux before authorization consumption"
AUTHORIZATION_VALIDATION="$("$FIXED_GATE_LAUNCHER" validate-authorization.mjs \
  "${AUTH_BASE[@]}" "${AUTH_ENDPOINTS[@]}")"
AUTHORIZATION_CONSUMPTION="$("$NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(value.status!=="AUTHORIZATION_VALID"||value.consumptionStatus!=="AUTHORIZATION_CONSUMED"
      ||typeof value.authorizationConsumptionPath!=="string")process.exit(2);
  process.stdout.write(value.authorizationConsumptionPath);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not return one consumption receipt"
EFFECT_START_EVIDENCE="$("$NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(typeof value.effectStartEvidence!=="string")process.exit(2);
  process.stdout.write(value.effectStartEvidence);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not return effect start evidence"
EFFECT_FINISH_EVIDENCE="$("$NODE_PATH" -e '
  const value=JSON.parse(process.argv[1]);
  if(typeof value.effectTerminalEvidence!=="string")process.exit(2);
  process.stdout.write(value.effectTerminalEvidence);
' "$AUTHORIZATION_VALIDATION")" \
  || blocked "authorization validation did not return effect terminal evidence"

require_fixed_i00_tree
require_outer_bash_binding
set +e
"$NODE_PATH" "$BOUND_EFFECT_RUNNER" \
  --authorization "$AUTHORIZATION" \
  --deployment-risk "$DEPLOYMENT_RISK" \
  --action-preview "$ACTION_PREVIEW" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  -- "$SCRIPT_DIR/install-ops-bundle.sh"
EFFECT_RESULT=$?
set -e

set +e
"$FIXED_GATE_LAUNCHER" record-authorized-action-outcome.mjs \
  --class OPS_BUNDLE_INSTALL \
  --authorization "$AUTHORIZATION" \
  --deployment-risk "$DEPLOYMENT_RISK" \
  --action-preview "$ACTION_PREVIEW" \
  --authorization-consumption "$AUTHORIZATION_CONSUMPTION" \
  --effect-start-evidence "$EFFECT_START_EVIDENCE" \
  --effect-finish-evidence "$EFFECT_FINISH_EVIDENCE" \
  --result-receipt "$RESULT_RECEIPT" \
  --reconciliation-receipt "$RECONCILIATION_RECEIPT" \
  --primary-path "$DESTINATION" \
  --evidence-file "$DESTINATION/install-receipt.json" >/dev/null
RECORDER_RESULT=$?
set -e
require_fixed_i00_tree
require_outer_bash_binding
[ "$RECORDER_RESULT" = 0 ] \
  || blocked "authorized install outcome recording failed"
[ "$EFFECT_RESULT" = 0 ] || exit "$EFFECT_RESULT"

printf '{"status":"OPS_BUNDLE_INSTALLED_NO_SERVICE_MUTATION","destination":"%s"}\n' \
  "$DESTINATION"
