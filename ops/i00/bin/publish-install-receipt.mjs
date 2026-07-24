#!/usr/bin/env node
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { fail, parseArgs, treeDigest } from '../lib.mjs';
import {
  isWithinSimulationRoot,
  validateSimulationRoot,
} from '../simulation-safety.mjs';

const SYSTEM_INSTALL_PARENT = '/usr/local/lib/cosmos-ops';
const CLAIM_SUFFIX = '.claim.json';
const MAX_CLAIM_BYTES = 1024 * 1024;
const CLAIM_KEYS = Object.freeze([
  'schemaVersion',
  'status',
  'destination',
  'destinationName',
  'parent',
  'parentIdentity',
  'staging',
  'stagingName',
  'stagingIdentity',
  'stagingInitialMode',
  'claim',
  'claimName',
  'simulation',
  'simulationRoot',
  'commands',
]);

const args = parseArgs(process.argv.slice(2), new Set(['simulation']));
const allowed = new Set([
  'root',
  'validation-json',
  'l15-json',
  'i00-enforcement-tree-digest-sha256',
  'simulation',
  'simulation-root',
]);
for (const name of Object.keys(args)) {
  if (!allowed.has(name)) fail(`unsupported argument --${name}`);
}
for (const name of [
  'root',
  'validation-json',
  'l15-json',
  'i00-enforcement-tree-digest-sha256',
]) {
  if (!args[name]) fail(`--${name} is required`);
}
if (typeof constants.O_NOFOLLOW !== 'number'
    || typeof constants.O_DIRECTORY !== 'number') {
  fail('required no-follow filesystem semantics are unavailable');
}

function directoryIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: (stat.mode & 0o7777n).toString(8),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  });
}

function stableDirectoryIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  });
}

function fileIdentity(stat) {
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    mode: (stat.mode & 0o7777n).toString(8),
    links: stat.nlink.toString(),
    uid: stat.uid.toString(),
    gid: stat.gid.toString(),
  });
}

function claimIdentity(stat) {
  return Object.freeze({
    ...fileIdentity(stat),
    size: stat.size.toString(),
  });
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((name, index) => name !== expected[index])) {
    fail(`${label} has an unexpected field set`);
  }
}

function safeLeaf(value, label) {
  if (typeof value !== 'string'
      || value.length === 0
      || Buffer.byteLength(value, 'utf8') > 180
      || value === '.'
      || value === '..'
      || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    fail(`${label} must be one bounded filesystem leaf`);
  }
  return value;
}

function mutationContext(root) {
  const simulation = args.simulation === true;
  if (simulation) {
    if (typeof args['simulation-root'] !== 'string') {
      fail('TEST install-receipt publication requires explicit --simulation-root');
    }
    let simulationRoot;
    try {
      simulationRoot = validateSimulationRoot(args['simulation-root']);
    } catch (error) {
      fail(`--simulation-root is not one canonical marked simulation root: ${error.message}`);
    }
    let inside = false;
    try {
      inside = isWithinSimulationRoot(simulationRoot, root);
    } catch {
      inside = false;
    }
    if (!inside) {
      fail('TEST install-receipt root must remain below the marked simulation root');
    }
    return Object.freeze({ simulation: true, simulationRoot });
  }
  if (args['simulation-root'] !== undefined) {
    fail('--simulation-root is unavailable for SYSTEM install-receipt publication');
  }
  if (dirname(root) !== SYSTEM_INSTALL_PARENT) {
    fail(`SYSTEM install-receipt staging parent must be exact ${SYSTEM_INSTALL_PARENT}`);
  }
  return Object.freeze({ simulation: false, simulationRoot: null });
}

function inspectParent(path, context) {
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()
      || realpathSync(path) !== path || (stat.mode & 0o022n) !== 0n) {
    fail('install receipt claim parent must be one canonical controlled directory');
  }
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : stat.uid;
  if (context.simulation) {
    if (stat.uid !== invokingUid) {
      fail('TEST install receipt claim parent must be invoking-owner controlled');
    }
  } else if (process.platform !== 'linux'
      || invokingUid !== 0n
      || stat.uid !== 0n) {
    fail('SYSTEM install receipt publication requires Linux root descriptor semantics');
  }
  return Object.freeze({ stat, identity: directoryIdentity(stat) });
}

function inspectRoot(path, context) {
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()
      || realpathSync(path) !== path
      || (stat.mode & 0o777n) !== 0o700n) {
    fail('install receipt parent must be one canonical private directory');
  }
  if (typeof process.getuid === 'function'
      && stat.uid !== BigInt(process.getuid())) {
    fail('install receipt parent owner is not the invoking identity');
  }
  if (!context.simulation && stat.uid !== 0n) {
    fail('SYSTEM install receipt staging root must be root-owned');
  }
  return Object.freeze({ stat, identity: directoryIdentity(stat) });
}

function claimFileIdentityValid(stat, expectedUid) {
  return stat?.isFile()
    && !stat.isSymbolicLink()
    && stat.nlink === 1n
    && (stat.mode & 0o7777n) === 0o600n
    && stat.uid === expectedUid
    && stat.size > 0n
    && stat.size <= BigInt(MAX_CLAIM_BYTES);
}

function anchoredChild(parentDescriptor, parent, leaf) {
  return process.platform === 'linux'
    ? `/proc/self/fd/${parentDescriptor}/${leaf}`
    : resolve(parent, leaf);
}

function readBoundClaim({
  parent,
  parentDescriptor,
  parentIdentity,
  root,
  rootIdentity,
  context,
}) {
  const stagingName = safeLeaf(basename(root), 'staging name');
  const claimName = safeLeaf(`${stagingName}${CLAIM_SUFFIX}`, 'claim name');
  const claimPath = resolve(parent, claimName);
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : lstatSync(parent, { bigint: true }).uid;
  let descriptor;
  try {
    try {
      descriptor = openSync(
        anchoredChild(parentDescriptor, parent, claimName),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      fail(`install-tree claim is unavailable: ${error.message}`);
    }
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!claimFileIdentityValid(openedBefore, invokingUid)) {
      fail('install-tree claim must be one private single-link regular file');
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(claimPath, { bigint: true, throwIfNoEntry: false });
    if (!sameIdentity(claimIdentity(openedBefore), claimIdentity(openedAfter))
        || !claimFileIdentityValid(named, invokingUid)
        || !sameIdentity(claimIdentity(named), claimIdentity(openedAfter))
        || realpathSync(claimPath) !== claimPath) {
      fail('install-tree claim held/named identity changed during readback');
    }
    let document;
    try {
      document = JSON.parse(bytes);
    } catch {
      fail('install-tree claim is invalid JSON');
    }
    if (!bytes.equals(Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8'))) {
      fail('install-tree claim is not canonical JSON');
    }
    exactKeys(document, CLAIM_KEYS, 'install-tree claim');
    exactKeys(document.parentIdentity, [
      'device', 'inode', 'mode', 'uid', 'gid',
    ], 'install-tree claim parent identity');
    exactKeys(document.stagingIdentity, [
      'device', 'inode', 'uid', 'gid',
    ], 'install-tree claim staging identity');
    exactKeys(document.commands, [
      'mkdir', 'mv', 'rm',
    ], 'install-tree claim command bindings');
    safeLeaf(document.destinationName, 'destination name');
    if (document.schemaVersion !== 1
        || document.status !== 'STAGING_CLAIMED_NOT_PUBLISHED'
        || document.parent !== parent
        || !sameIdentity(document.parentIdentity, parentIdentity)
        || document.staging !== root
        || document.stagingName !== stagingName
        || !sameIdentity(document.stagingIdentity, rootIdentity)
        || document.stagingInitialMode !== '700'
        || document.claim !== claimPath
        || document.claimName !== claimName
        || document.destination !== resolve(parent, document.destinationName)
        || dirname(document.destination) !== parent
        || document.simulation !== context.simulation
        || document.simulationRoot !== context.simulationRoot) {
      fail('install-tree claim does not bind this exact install-receipt publication');
    }
    if (lstatSync(document.destination, { throwIfNoEntry: false }) !== undefined) {
      fail('install-tree destination appeared before receipt publication');
    }
    return Object.freeze({
      descriptor,
      document,
      identity: claimIdentity(openedAfter),
      name: claimName,
      path: claimPath,
    });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function requireClaimStable(claim, expectedUid) {
  const held = fstatSync(claim.descriptor, { bigint: true });
  const named = lstatSync(claim.path, { bigint: true, throwIfNoEntry: false });
  if (!claimFileIdentityValid(held, expectedUid)
      || !claimFileIdentityValid(named, expectedUid)
      || !sameIdentity(claimIdentity(held), claim.identity)
      || !sameIdentity(claimIdentity(named), claim.identity)
      || realpathSync(claim.path) !== claim.path) {
    fail('install-tree claim identity changed during receipt publication');
  }
}

let root = args.root;
if (!isAbsolute(root) || resolve(root) !== root) {
  fail('--root must be one exact absolute path');
}
const context = mutationContext(root);
const claimParent = dirname(root);
const claimParentBefore = inspectParent(claimParent, context);
const rootBefore = inspectRoot(root, context);
const output = resolve(root, 'install-receipt.json');
if (dirname(output) !== root || basename(output) !== 'install-receipt.json') {
  fail('install receipt target is invalid');
}
if (lstatSync(output, { bigint: true, throwIfNoEntry: false }) !== undefined) {
  fail('install receipt target must be absent');
}

let validation;
let l15;
try {
  validation = JSON.parse(args['validation-json']);
  l15 = JSON.parse(args['l15-json']);
} catch {
  fail('install receipt provenance input is invalid JSON');
}
const i00Digest = args['i00-enforcement-tree-digest-sha256'];
if (!/^[0-9a-f]{64}$/u.test(i00Digest)) {
  fail('install receipt I00 enforcement digest is invalid');
}
const document = {
  schemaVersion: 2,
  testedSha: validation.testedSha,
  sourceReleaseId: validation.releaseId,
  installedTreeDigestSha256: treeDigest(root),
  effectiveOpsRoot: 'accepted-ops-live',
  immutableDonorCommit: l15.immutableDonorCommit,
  immutableDonorLiveTree: l15.immutableDonorLiveTree,
  immutableDonorContractSha256: l15.immutableDonorContractSha256,
  amendmentContractSha256: l15.amendmentContractSha256,
  effectiveLiveTree: l15.effectiveLiveTree,
  effectiveRootDigestSha256: l15.effectiveRootDigestSha256,
  i00EnforcementTreeDigestSha256: i00Digest,
  authorizedCorrectionFindingIds: l15.findingIds,
  serviceMutationPerformed: false,
};
const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');

let claimParentDescriptor;
let claim;
let rootDescriptor;
let outputDescriptor;
try {
  claimParentDescriptor = openSync(
    claimParent,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const openedClaimParentBefore = fstatSync(claimParentDescriptor, { bigint: true });
  if (!openedClaimParentBefore.isDirectory()
      || !sameIdentity(
        directoryIdentity(openedClaimParentBefore),
        claimParentBefore.identity,
      )) {
    fail('install receipt claim parent identity changed before exact create');
  }
  claim = readBoundClaim({
    parent: claimParent,
    parentDescriptor: claimParentDescriptor,
    parentIdentity: claimParentBefore.identity,
    root,
    rootIdentity: stableDirectoryIdentity(rootBefore.stat),
    context,
  });
  rootDescriptor = openSync(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const openedRootBefore = fstatSync(rootDescriptor, { bigint: true });
  if (!openedRootBefore.isDirectory()
      || !sameIdentity(
        directoryIdentity(openedRootBefore),
        rootBefore.identity,
      )) {
    fail('install receipt parent identity changed before exact create');
  }
  const rootImmediatelyBefore = inspectRoot(root, context);
  if (!sameIdentity(rootImmediatelyBefore.identity, rootBefore.identity)) {
    fail('install receipt parent path identity changed before exact create');
  }
  const expectedUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : rootBefore.stat.uid;
  requireClaimStable(claim, expectedUid);
  const anchoredOutput = anchoredChild(
    rootDescriptor,
    root,
    'install-receipt.json',
  );
  outputDescriptor = openSync(
    anchoredOutput,
    constants.O_RDWR
      | constants.O_CREAT
      | constants.O_EXCL
      | constants.O_NOFOLLOW,
    0o600,
  );
  const created = fstatSync(outputDescriptor, { bigint: true });
  const createdIdentity = fileIdentity(created);
  if (!created.isFile() || created.isSymbolicLink() || created.nlink !== 1n
      || (created.mode & 0o777n) !== 0o600n) {
    fail('install receipt exact-create claim is not a private regular file');
  }
  if (typeof process.getuid === 'function'
      && created.uid !== BigInt(process.getuid())) {
    fail('install receipt exact-create owner changed');
  }

  writeFileSync(outputDescriptor, bytes);
  fsyncSync(outputDescriptor);
  const written = fstatSync(outputDescriptor, { bigint: true });
  if (!written.isFile() || written.nlink !== 1n
      || written.size !== BigInt(bytes.length)
      || !sameIdentity(fileIdentity(written), createdIdentity)) {
    fail('install receipt identity changed during publication');
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
    if (count === 0) fail('install receipt descriptor readback was truncated');
    offset += count;
  }
  if (!readback.equals(bytes)) {
    fail('install receipt descriptor readback differs from published bytes');
  }

  const named = lstatSync(output, { bigint: true, throwIfNoEntry: false });
  if (!named?.isFile() || named.isSymbolicLink() || named.nlink !== 1n
      || realpathSync(output) !== output
      || !sameIdentity(fileIdentity(named), fileIdentity(written))) {
    fail('install receipt named identity differs from its descriptor');
  }
  requireClaimStable(claim, expectedUid);
  const openedRootAfter = fstatSync(rootDescriptor, { bigint: true });
  const rootAfter = inspectRoot(root, context);
  const openedClaimParentAfter = fstatSync(claimParentDescriptor, { bigint: true });
  const claimParentAfter = inspectParent(claimParent, context);
  if (!openedRootAfter.isDirectory()
      || !sameIdentity(directoryIdentity(openedRootAfter), rootBefore.identity)
      || !sameIdentity(
        directoryIdentity(openedClaimParentAfter),
        claimParentBefore.identity,
      )
      || !sameIdentity(claimParentAfter.identity, claimParentBefore.identity)
      || !sameIdentity(rootAfter.identity, rootBefore.identity)) {
    fail('install receipt parent identity changed during publication');
  }
  fsyncSync(rootDescriptor);
  const durableRootDescriptor = fstatSync(rootDescriptor, { bigint: true });
  const durableRoot = inspectRoot(root, context);
  requireClaimStable(claim, expectedUid);
  if (!sameIdentity(directoryIdentity(durableRootDescriptor), rootBefore.identity)
      || !sameIdentity(durableRoot.identity, rootBefore.identity)) {
    fail('install receipt parent identity changed during durability sync');
  }
} catch (error) {
  if (String(error?.message ?? '').startsWith('I00_OPS_BLOCKED:')) throw error;
  fail(`install receipt exact-create failed: ${error.message}`);
} finally {
  if (outputDescriptor !== undefined) closeSync(outputDescriptor);
  if (rootDescriptor !== undefined) closeSync(rootDescriptor);
  if (claim?.descriptor !== undefined) closeSync(claim.descriptor);
  if (claimParentDescriptor !== undefined) closeSync(claimParentDescriptor);
}

process.stdout.write('{"status":"INSTALL_RECEIPT_PUBLISHED_CREATE_ONLY"}\n');
