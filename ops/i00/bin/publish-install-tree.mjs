#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from '../lib.mjs';
import {
  isWithinSimulationRoot,
  validateSimulationRoot,
} from '../simulation-safety.mjs';

const SAFE_ENV = Object.freeze({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
  LANG: 'C',
  LC_ALL: 'C',
});
const HERE = dirname(fileURLToPath(import.meta.url));
const INSPECT_EXECUTABLE = resolve(HERE, 'inspect-executable.mjs');
const SYSTEM_INSTALL_PARENT = '/usr/local/lib/cosmos-ops';
const PROTECTED_MUTATION_ROOTS = Object.freeze([
  '/opt/cosmos',
  '/var/lib/cosmos',
  '/var/backups/cosmos',
  '/etc/cosmos',
  '/run/cosmos-app',
  '/run/cosmos-secret-source',
  '/usr/local/lib/cosmos-ops',
  '/var/lib/cosmos-deployment-authorization',
  '/var/lib/cosmos-authorization-consumption',
  '/var/lib/cosmos-action-receipts',
]);
const CLAIM_SUFFIX = '.claim.json';
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
const BINDING_KEYS = Object.freeze([
  'status',
  'path',
  'sha256',
  'identity',
  'endpointIdentity',
]);

class BlockedError extends Error {}

function block(message) {
  throw new BlockedError(message);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    block(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((name, index) => name !== expected[index])) {
    block(`${label} has an unexpected field set`);
  }
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
    size: stat.size.toString(),
  });
}

function safeLeaf(value, label) {
  if (typeof value !== 'string'
      || value.length === 0
      || Buffer.byteLength(value, 'utf8') > 180
      || value === '.'
      || value === '..'
      || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    block(`${label} must be one bounded filesystem leaf`);
  }
  return value;
}

function canonicalDestination(value) {
  if (typeof value !== 'string'
      || !isAbsolute(value)
      || resolve(value) !== value
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    block('--destination must be one exact absolute path');
  }
  safeLeaf(basename(value), 'destination name');
  return value;
}

function canonicalPotentialPath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) {
    block(`${label} must be one canonical absolute path`);
  }
  let cursor = value;
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(cursor, { throwIfNoEntry: false });
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error;
      stat = undefined;
    }
    if (stat !== undefined) {
      let ancestor;
      try {
        ancestor = realpathSync(cursor);
      } catch (error) {
        if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error;
        ancestor = undefined;
      }
      if (ancestor === undefined) {
        const parent = dirname(cursor);
        if (parent === cursor) block(`${label} is unreadable`);
        suffix.unshift(basename(cursor));
        cursor = parent;
        continue;
      }
      if (suffix.length > 0) {
        const ancestorStat = lstatSync(ancestor);
        if (!ancestorStat.isDirectory()) {
          block(`${label} existing ancestor is not a directory`);
        }
      }
      return resolve(ancestor, ...suffix);
    }
    const parent = dirname(cursor);
    if (parent === cursor) block(`${label} has no existing ancestor`);
    const leaf = basename(cursor);
    safeLeaf(leaf, `${label} missing component`);
    suffix.unshift(leaf);
    cursor = parent;
  }
}

function pathInsideOrSame(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function requireDisjointSimulationRoot(input) {
  let root;
  try {
    root = validateSimulationRoot(input);
  } catch (error) {
    block(`--simulation-root is not one canonical marked simulation root: ${error.message}`);
  }
  for (const protectedInput of PROTECTED_MUTATION_ROOTS) {
    const protectedRoot = canonicalPotentialPath(
      protectedInput,
      'protected mutation root',
    );
    if (pathInsideOrSame(root, protectedRoot)
        || pathInsideOrSame(protectedRoot, root)) {
      block('--simulation-root intersects the protected production root union');
    }
  }
  return root;
}

function mutationContext(args, destination) {
  const simulation = args.simulation === true;
  if (simulation) {
    if (typeof args['simulation-root'] !== 'string') {
      block('TEST publication requires explicit --simulation-root');
    }
    const simulationRoot = requireDisjointSimulationRoot(args['simulation-root']);
    let inside = false;
    try {
      inside = isWithinSimulationRoot(simulationRoot, destination);
    } catch {
      inside = false;
    }
    if (!inside) {
      block('TEST destination must remain below the marked simulation root');
    }
    return Object.freeze({ simulation: true, simulationRoot });
  }
  if (args['simulation-root'] !== undefined) {
    block('--simulation-root is unavailable for SYSTEM publication');
  }
  if (dirname(destination) !== SYSTEM_INSTALL_PARENT) {
    block(`SYSTEM destination parent must be exact ${SYSTEM_INSTALL_PARENT}`);
  }
  return Object.freeze({ simulation: false, simulationRoot: null });
}

function inspectNamedParent(parent, context) {
  let stat;
  try {
    stat = lstatSync(parent, { bigint: true });
  } catch (error) {
    block(`destination parent is unavailable: ${error.message}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || realpathSync(parent) !== parent) {
    block('destination parent must be one canonical non-symlink directory');
  }
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : stat.uid;
  if (context.simulation) {
    if (stat.uid !== invokingUid) {
      block('TEST destination parent must be owned by the invoking identity');
    }
  } else {
    if (process.platform !== 'linux') {
      block('production install-tree publication requires Linux descriptor-relative semantics');
    }
    if (invokingUid !== 0n || stat.uid !== 0n) {
      block('production destination parent must be root-owned under a root invocation');
    }
  }
  if ((stat.mode & 0o022n) !== 0n) {
    block('destination parent must not be group/world writable');
  }
  return Object.freeze({ stat, identity: directoryIdentity(stat) });
}

function openParent(parent, context) {
  const named = inspectNamedParent(parent, context);
  if (typeof constants.O_DIRECTORY !== 'number'
      || typeof constants.O_NOFOLLOW !== 'number') {
    block('required no-follow directory semantics are unavailable');
  }
  let descriptor;
  try {
    descriptor = openSync(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    block(`destination parent cannot be held exactly: ${error.message}`);
  }
  const held = fstatSync(descriptor, { bigint: true });
  if (!held.isDirectory()
      || !sameValue(directoryIdentity(held), named.identity)) {
    closeSync(descriptor);
    block('destination parent identity changed while it was opened');
  }
  return Object.freeze({
    descriptor,
    parent,
    identity: named.identity,
    simulation: context.simulation,
    simulationRoot: context.simulationRoot,
  });
}

function requireParentStable(parentState, expected = parentState.identity) {
  const held = fstatSync(parentState.descriptor, { bigint: true });
  const named = inspectNamedParent(parentState.parent, parentState);
  if (!held.isDirectory()
      || !sameValue(directoryIdentity(held), expected)
      || !sameValue(named.identity, expected)) {
    block('destination parent held/named identity changed');
  }
}

function parseBinding(value, label) {
  let binding;
  try {
    binding = JSON.parse(value);
  } catch {
    block(`${label} executable binding is invalid JSON`);
  }
  exactKeys(binding, BINDING_KEYS, `${label} executable binding`);
  if (binding.status !== 'EXECUTABLE_IDENTITY_VERIFIED'
      || typeof binding.path !== 'string'
      || !isAbsolute(binding.path)
      || resolve(binding.path) !== binding.path
      || !/^[0-9a-f]{64}$/u.test(binding.sha256)
      || typeof binding.endpointIdentity !== 'string'
      || !binding.identity
      || typeof binding.identity !== 'object'
      || Array.isArray(binding.identity)) {
    block(`${label} executable binding is malformed`);
  }
  return Object.freeze(binding);
}

function inspectCurrentBinding(binding, label) {
  const result = spawnSync(
    process.execPath,
    [INSPECT_EXECUTABLE, '--path', binding.path],
    {
      env: SAFE_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0 || result.signal !== null) {
    block(`${label} executable cannot be reverified`);
  }
  let current;
  try {
    current = JSON.parse(result.stdout);
  } catch {
    block(`${label} executable inspection output is invalid`);
  }
  if (!sameValue(current, binding)) {
    block(`${label} executable changed after it was bound`);
  }
}

function runBoundCommand(binding, label, argv, parentDescriptor) {
  inspectCurrentBinding(binding, label);
  const result = spawnSync(binding.path, argv, {
    env: SAFE_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', parentDescriptor],
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  inspectCurrentBinding(binding, label);
  if (result.error || result.status !== 0 || result.signal !== null) {
    block(`exact bound ${label} command failed`);
  }
}

function childAnchoredPath(parentState, leaf) {
  return parentState.simulation
    ? resolve(parentState.parent, leaf)
    : `/proc/self/fd/3/${leaf}`;
}

function selfAnchoredPath(parentState, leaf) {
  return parentState.simulation
    ? resolve(parentState.parent, leaf)
    : `/proc/self/fd/${parentState.descriptor}/${leaf}`;
}

function inspectClaimedDirectory(path, expected, label, { requireFrozen = false } = {}) {
  let named;
  try {
    named = lstatSync(path, { bigint: true });
  } catch (error) {
    block(`${label} is unavailable: ${error.message}`);
  }
  if (!named.isDirectory() || named.isSymbolicLink()
      || realpathSync(path) !== path
      || !sameValue(stableDirectoryIdentity(named), expected)) {
    block(`${label} named identity differs from its claim`);
  }
  if ((named.mode & 0o022n) !== 0n) {
    block(`${label} became group/world writable`);
  }
  if (requireFrozen && (named.mode & 0o7777n) !== 0o511n) {
    block(`${label} must be frozen at mode 0511 before publication`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    block(`${label} cannot be held exactly: ${error.message}`);
  }
  const held = fstatSync(descriptor, { bigint: true });
  if (!held.isDirectory()
      || !sameValue(stableDirectoryIdentity(held), expected)
      || (requireFrozen && (held.mode & 0o7777n) !== 0o511n)) {
    closeSync(descriptor);
    block(`${label} held identity differs from its claim`);
  }
  return Object.freeze({ descriptor, stat: named });
}

function claimFileIdentityValid(stat, expectedUid) {
  return stat?.isFile()
    && !stat.isSymbolicLink()
    && stat.nlink === 1n
    && (stat.mode & 0o7777n) === 0o600n
    && stat.uid === expectedUid;
}

function readClaim(parentState, claimPath) {
  if (!isAbsolute(claimPath) || resolve(claimPath) !== claimPath
      || dirname(claimPath) !== parentState.parent) {
    block('--claim must be one exact direct child of the destination parent');
  }
  const claimName = safeLeaf(basename(claimPath), 'claim name');
  if (!claimName.endsWith(CLAIM_SUFFIX)) {
    block('claim name has an invalid suffix');
  }
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : lstatSync(parentState.parent, { bigint: true }).uid;
  let descriptor;
  try {
    descriptor = openSync(
      selfAnchoredPath(parentState, claimName),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    block(`install-tree claim is unavailable: ${error.message}`);
  }
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!claimFileIdentityValid(openedBefore, invokingUid)) {
      block('install-tree claim must be one private single-link regular file');
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const named = lstatSync(claimPath, { bigint: true, throwIfNoEntry: false });
    if (!sameValue(fileIdentity(openedBefore), fileIdentity(openedAfter))
        || !claimFileIdentityValid(named, invokingUid)
        || !sameValue(fileIdentity(named), fileIdentity(openedAfter))
        || realpathSync(claimPath) !== claimPath) {
      block('install-tree claim held/named identity changed during readback');
    }
    let document;
    try {
      document = JSON.parse(bytes);
    } catch {
      block('install-tree claim is invalid JSON');
    }
    if (!bytes.equals(Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8'))) {
      block('install-tree claim is not canonical JSON');
    }
    exactKeys(document, CLAIM_KEYS, 'install-tree claim');
    return Object.freeze({
      document,
      identity: fileIdentity(openedAfter),
      name: claimName,
      path: claimPath,
    });
  } finally {
    closeSync(descriptor);
  }
}

function validateClaimDocument({
  document,
  destination,
  claimPath,
  parentState,
  context,
  commands,
}) {
  if (document.schemaVersion !== 1
      || document.status !== 'STAGING_CLAIMED_NOT_PUBLISHED'
      || document.destination !== destination
      || document.destinationName !== basename(destination)
      || document.parent !== parentState.parent
      || document.claim !== claimPath
      || document.claimName !== basename(claimPath)
      || document.simulation !== context.simulation
      || document.simulationRoot !== context.simulationRoot
      || !sameValue(document.parentIdentity, parentState.identity)
      || document.stagingInitialMode !== '700') {
    block('install-tree claim does not match this exact publication request');
  }
  const stagingName = safeLeaf(document.stagingName, 'staging name');
  if (document.staging !== resolve(parentState.parent, stagingName)
      || dirname(document.staging) !== parentState.parent
      || document.claimName !== `${stagingName}${CLAIM_SUFFIX}`) {
    block('install-tree claim paths are not one exact sibling layout');
  }
  exactKeys(document.stagingIdentity, ['device', 'inode', 'uid', 'gid'],
    'install-tree staging identity');
  exactKeys(document.commands, ['mkdir', 'mv', 'rm'], 'install-tree command bindings');
  for (const name of ['mkdir', 'mv', 'rm']) {
    if (!sameValue(document.commands[name], commands[name])) {
      block(`${name} executable binding differs from the staging claim`);
    }
    inspectCurrentBinding(commands[name], name);
  }
}

function requireClaimNamedStable(parentState, claim) {
  requireParentStable(parentState);
  const invokingUid = typeof process.getuid === 'function'
    ? BigInt(process.getuid())
    : lstatSync(parentState.parent, { bigint: true }).uid;
  const named = lstatSync(claim.path, { bigint: true, throwIfNoEntry: false });
  if (!claimFileIdentityValid(named, invokingUid)
      || !sameValue(fileIdentity(named), claim.identity)
      || realpathSync(claim.path) !== claim.path) {
    block('install-tree claim named identity changed before deletion');
  }
}

function removeClaim(parentState, claim, rmBinding) {
  requireClaimNamedStable(parentState, claim);
  runBoundCommand(
    rmBinding,
    'rm',
    ['-f', '--', childAnchoredPath(parentState, claim.name)],
    parentState.descriptor,
  );
  if (lstatSync(claim.path, { throwIfNoEntry: false }) !== undefined) {
    block('install-tree claim still exists after exact removal');
  }
}

function loadExistingClaim(args, bindings) {
  const destination = canonicalDestination(args.destination);
  const context = mutationContext(args, destination);
  const parent = dirname(destination);
  const parentState = openParent(parent, context);
  try {
    const claim = readClaim(parentState, args.claim);
    validateClaimDocument({
      document: claim.document,
      destination,
      claimPath: args.claim,
      parentState,
      context,
      commands: bindings,
    });
    requireParentStable(parentState, claim.document.parentIdentity);
    return Object.freeze({
      destination,
      simulation: context.simulation,
      simulationRoot: context.simulationRoot,
      parentState,
      claim,
    });
  } catch (error) {
    closeSync(parentState.descriptor);
    throw error;
  }
}

function createClaim(args, bindings) {
  const destination = canonicalDestination(args.destination);
  const context = mutationContext(args, destination);
  const parentState = openParent(dirname(destination), context);
  let stagingIdentity;
  let staging;
  let claimPath;
  let claimCreated = false;
  try {
    const stagingName = safeLeaf(args['staging-name'], 'staging name');
    if (!stagingName.startsWith(`${basename(destination)}.partial.`)) {
      block('staging name is not bound to the destination leaf');
    }
    const claimName = `${stagingName}${CLAIM_SUFFIX}`;
    safeLeaf(claimName, 'claim name');
    staging = resolve(parentState.parent, stagingName);
    claimPath = resolve(parentState.parent, claimName);
    if (lstatSync(destination, { throwIfNoEntry: false }) !== undefined) {
      block('destination already exists; replacement requires a new reviewed release procedure');
    }
    if (lstatSync(staging, { throwIfNoEntry: false }) !== undefined
        || lstatSync(claimPath, { throwIfNoEntry: false }) !== undefined) {
      block('staging or claim path already exists');
    }
    requireParentStable(parentState);
    runBoundCommand(
      bindings.mkdir,
      'mkdir',
      ['-m', '700', '--', childAnchoredPath(parentState, stagingName)],
      parentState.descriptor,
    );
    const createdNamed = lstatSync(staging, { bigint: true });
    stagingIdentity = stableDirectoryIdentity(createdNamed);
    if (!createdNamed.isDirectory() || createdNamed.isSymbolicLink()
        || (createdNamed.mode & 0o7777n) !== 0o700n) {
      block('new staging directory is not one private mode-0700 claim');
    }
    const invokingUid = typeof process.getuid === 'function'
      ? BigInt(process.getuid())
      : createdNamed.uid;
    if (createdNamed.uid !== invokingUid) {
      block('new staging directory owner differs from the invoking identity');
    }
    const claimed = inspectClaimedDirectory(
      staging,
      stagingIdentity,
      'new staging directory',
    );
    closeSync(claimed.descriptor);
    const document = {
      schemaVersion: 1,
      status: 'STAGING_CLAIMED_NOT_PUBLISHED',
      destination,
      destinationName: basename(destination),
      parent: parentState.parent,
      parentIdentity: parentState.identity,
      staging,
      stagingName,
      stagingIdentity,
      stagingInitialMode: (claimed.stat.mode & 0o7777n).toString(8),
      claim: claimPath,
      claimName,
      simulation: context.simulation,
      simulationRoot: context.simulationRoot,
      commands: bindings,
    };
    const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
    let claimDescriptor;
    try {
      claimDescriptor = openSync(
        selfAnchoredPath(parentState, claimName),
        constants.O_RDWR
          | constants.O_CREAT
          | constants.O_EXCL
          | constants.O_NOFOLLOW,
        0o600,
      );
      claimCreated = true;
      writeFileSync(claimDescriptor, bytes);
      fsyncSync(claimDescriptor);
      const written = fstatSync(claimDescriptor, { bigint: true });
      const invokingUid = typeof process.getuid === 'function'
        ? BigInt(process.getuid())
        : written.uid;
      if (!claimFileIdentityValid(written, invokingUid)
          || written.size !== BigInt(bytes.length)) {
        block('install-tree claim exact-create identity is invalid');
      }
    } finally {
      if (claimDescriptor !== undefined) closeSync(claimDescriptor);
    }
    const claim = readClaim(parentState, claimPath);
    validateClaimDocument({
      document: claim.document,
      destination,
      claimPath,
      parentState,
      context,
      commands: bindings,
    });
    const stableStaging = inspectClaimedDirectory(
      staging,
      stagingIdentity,
      'claimed staging directory',
    );
    closeSync(stableStaging.descriptor);
    requireParentStable(parentState);
    fsyncSync(parentState.descriptor);
    requireParentStable(parentState);
    process.stdout.write(`${JSON.stringify({
      status: 'INSTALL_TREE_STAGING_CLAIMED',
      staging,
      claim: claimPath,
    })}\n`);
  } catch (error) {
    let cleanupFailed = false;
    if (stagingIdentity !== undefined) {
      try {
        const current = lstatSync(staging, { bigint: true, throwIfNoEntry: false });
        if (current?.isDirectory()
            && !current.isSymbolicLink()
            && sameValue(stableDirectoryIdentity(current), stagingIdentity)) {
          runBoundCommand(
            bindings.rm,
            'rm',
            ['-rf', '--', childAnchoredPath(parentState, basename(staging))],
            parentState.descriptor,
          );
        } else if (current !== undefined) {
          cleanupFailed = true;
        }
      } catch {
        cleanupFailed = true;
      }
    }
    if (claimCreated) {
      try {
        const current = lstatSync(claimPath, { bigint: true, throwIfNoEntry: false });
        const invokingUid = typeof process.getuid === 'function'
          ? BigInt(process.getuid())
          : current?.uid;
        if (claimFileIdentityValid(current, invokingUid)) {
          runBoundCommand(
            bindings.rm,
            'rm',
            ['-f', '--', childAnchoredPath(parentState, basename(claimPath))],
            parentState.descriptor,
          );
        } else if (current !== undefined) {
          cleanupFailed = true;
        }
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      block('staging claim failed and exact cleanup was refused');
    }
    throw error;
  } finally {
    closeSync(parentState.descriptor);
  }
}

function verifyClaim(args, bindings) {
  const loaded = loadExistingClaim(args, bindings);
  try {
    const held = inspectClaimedDirectory(
      loaded.claim.document.staging,
      loaded.claim.document.stagingIdentity,
      'claimed staging directory',
    );
    closeSync(held.descriptor);
    requireClaimNamedStable(loaded.parentState, loaded.claim);
    process.stdout.write(`${JSON.stringify({
      status: 'INSTALL_TREE_STAGING_IDENTITY_VERIFIED',
      staging: loaded.claim.document.staging,
      claim: loaded.claim.path,
    })}\n`);
  } finally {
    closeSync(loaded.parentState.descriptor);
  }
}

function publishClaim(args, bindings) {
  const loaded = loadExistingClaim(args, bindings);
  let stagingDescriptor;
  try {
    if (lstatSync(loaded.destination, { throwIfNoEntry: false }) !== undefined) {
      block('destination appeared before final publication');
    }
    const staging = inspectClaimedDirectory(
      loaded.claim.document.staging,
      loaded.claim.document.stagingIdentity,
      'claimed staging directory',
      { requireFrozen: true },
    );
    stagingDescriptor = staging.descriptor;
    requireClaimNamedStable(loaded.parentState, loaded.claim);
    const sourceArg = childAnchoredPath(
      loaded.parentState,
      loaded.claim.document.stagingName,
    );
    const destinationArg = childAnchoredPath(
      loaded.parentState,
      loaded.claim.document.destinationName,
    );
    const mvArgs = loaded.simulation
      ? ['-n', '--', sourceArg, destinationArg]
      : ['--no-clobber', '--no-target-directory', '--', sourceArg, destinationArg];
    runBoundCommand(
      bindings.mv,
      'mv',
      mvArgs,
      loaded.parentState.descriptor,
    );
    if (lstatSync(loaded.claim.document.staging, { throwIfNoEntry: false }) !== undefined) {
      block('claimed staging path still exists after final move');
    }
    const finalDirectory = inspectClaimedDirectory(
      loaded.destination,
      loaded.claim.document.stagingIdentity,
      'published destination',
      { requireFrozen: true },
    );
    try {
      const heldAfterMove = fstatSync(stagingDescriptor, { bigint: true });
      if (!sameValue(
        stableDirectoryIdentity(heldAfterMove),
        loaded.claim.document.stagingIdentity,
      )) {
        block('held staging identity changed across final move');
      }
      fsyncSync(finalDirectory.descriptor);
    } finally {
      closeSync(finalDirectory.descriptor);
    }
    requireParentStable(
      loaded.parentState,
      loaded.claim.document.parentIdentity,
    );
    removeClaim(loaded.parentState, loaded.claim, bindings.rm);
    fsyncSync(loaded.parentState.descriptor);
    requireParentStable(
      loaded.parentState,
      loaded.claim.document.parentIdentity,
    );
    const durableFinal = inspectClaimedDirectory(
      loaded.destination,
      loaded.claim.document.stagingIdentity,
      'durable published destination',
      { requireFrozen: true },
    );
    closeSync(durableFinal.descriptor);
    process.stdout.write(`${JSON.stringify({
      status: 'INSTALL_TREE_PUBLISHED_DURABLE',
      destination: loaded.destination,
      parentDurability: 'FSYNCED',
    })}\n`);
  } finally {
    if (stagingDescriptor !== undefined) closeSync(stagingDescriptor);
    closeSync(loaded.parentState.descriptor);
  }
}

function cleanupClaim(args, bindings) {
  const loaded = loadExistingClaim(args, bindings);
  try {
    if (lstatSync(loaded.destination, { throwIfNoEntry: false }) !== undefined) {
      block('cleanup refuses after a destination has appeared');
    }
    const stagingPath = loaded.claim.document.staging;
    const staging = lstatSync(stagingPath, {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (staging !== undefined) {
      const held = inspectClaimedDirectory(
        stagingPath,
        loaded.claim.document.stagingIdentity,
        'cleanup staging directory',
      );
      closeSync(held.descriptor);
      requireClaimNamedStable(loaded.parentState, loaded.claim);
      runBoundCommand(
        bindings.rm,
        'rm',
        [
          '-rf',
          '--',
          childAnchoredPath(
            loaded.parentState,
            loaded.claim.document.stagingName,
          ),
        ],
        loaded.parentState.descriptor,
      );
      if (lstatSync(stagingPath, { throwIfNoEntry: false }) !== undefined) {
        block('claimed staging directory still exists after cleanup');
      }
    }
    removeClaim(loaded.parentState, loaded.claim, bindings.rm);
    fsyncSync(loaded.parentState.descriptor);
    requireParentStable(
      loaded.parentState,
      loaded.claim.document.parentIdentity,
    );
    process.stdout.write('{"status":"INSTALL_TREE_STAGING_CLEANED_EXACT"}\n');
  } finally {
    closeSync(loaded.parentState.descriptor);
  }
}

try {
  const args = parseArgs(
    process.argv.slice(2),
    new Set(['simulation']),
  );
  const allowed = new Set([
    'operation',
    'destination',
    'staging-name',
    'claim',
    'mkdir-binding',
    'mv-binding',
    'rm-binding',
    'simulation',
    'simulation-root',
  ]);
  for (const name of Object.keys(args)) {
    if (!allowed.has(name)) block(`unsupported argument --${name}`);
  }
  if (!['claim', 'verify', 'publish', 'cleanup'].includes(args.operation)) {
    block('--operation must be claim, verify, publish, or cleanup');
  }
  if (!args.destination
      || !args['mkdir-binding']
      || !args['mv-binding']
      || !args['rm-binding']) {
    block('destination and all exact effect-command bindings are required');
  }
  if (args.operation === 'claim') {
    if (!args['staging-name'] || args.claim !== undefined) {
      block('claim operation requires only --staging-name');
    }
  } else if (!args.claim || args['staging-name'] !== undefined) {
    block('verify, publish, and cleanup require only --claim');
  }
  const bindings = Object.freeze({
    mkdir: parseBinding(args['mkdir-binding'], 'mkdir'),
    mv: parseBinding(args['mv-binding'], 'mv'),
    rm: parseBinding(args['rm-binding'], 'rm'),
  });
  for (const [name, binding] of Object.entries(bindings)) {
    inspectCurrentBinding(binding, name);
  }
  switch (args.operation) {
    case 'claim':
      createClaim(args, bindings);
      break;
    case 'verify':
      verifyClaim(args, bindings);
      break;
    case 'publish':
      publishClaim(args, bindings);
      break;
    case 'cleanup':
      cleanupClaim(args, bindings);
      break;
    default:
      block('unsupported operation');
  }
} catch (error) {
  const message = error instanceof BlockedError
    ? error.message
    : `install-tree publication failed: ${error.message}`;
  process.stderr.write(`I00_OPS_BLOCKED: ${message}\n`);
  process.exit(1);
}
