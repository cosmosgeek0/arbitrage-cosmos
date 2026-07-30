#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import {
  I00_PACKAGE_SCHEMA,
  SHA256_RE,
  SHA_RE,
  canonicalJson,
  canonicalJsonLine,
  inspectDeterministicTar,
  inspectElf,
  inspectI00ReleaseTree,
  parseArgs,
  readJson,
  requireAbsoluteExisting,
  requireExactKeys,
  runTrustedI00Validator,
  sha256,
  sha256File,
  snapshotTrustedFile,
  typedTreeDigest,
} from '../lib/release-package.mjs';

function fail(message) {
  process.stderr.write(`i00-release-package-preflight: ${message}\n`);
  process.exit(1);
}

function parseDigestFile(path, archiveName, manifestName) {
  const text = readFileSync(path, 'utf8');
  const match = /^([0-9a-f]{64})  ([^\n]+)\n([0-9a-f]{64})  ([^\n]+)\n$/.exec(text);
  if (!match || match[2] !== archiveName || match[4] !== manifestName) {
    throw new Error('digest file is not the exact canonical two-entry form');
  }
  return { archiveSha256: match[1], manifestSha256: match[3] };
}

function fileIdentity(path) {
  const status = lstatSync(path, { bigint: true });
  if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1n
      || (status.mode & 0o077n) !== 0n || realpathSync(path) !== path) {
    throw new Error('package inputs must be canonical single-link owner-only regular files');
  }
  return Object.freeze({
    device: status.dev.toString(),
    inode: status.ino.toString(),
    mode: status.mode.toString(8),
    links: status.nlink.toString(),
    size: status.size.toString(),
    mtimeNs: status.mtimeNs.toString(),
    ctimeNs: status.ctimeNs.toString(),
  });
}

try {
  if (process.platform === 'win32') {
    throw new Error('I00 mode-preserving preflight requires POSIX filesystem semantics');
  }
  const args = parseArgs(process.argv.slice(2), new Set(['allow-simulation']));
  const allowed = new Set([
    'archive', 'manifest', 'digest', 'expected-input-sha', 'expected-target-arch',
    'expected-service-user', 'expected-service-group', 'trusted-build-public-key',
    'allow-simulation',
  ]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new Error(`unsupported argument: --${key}`);
  }
  for (const key of [
    'archive', 'manifest', 'digest', 'expected-input-sha', 'expected-target-arch',
    'expected-service-user', 'expected-service-group',
  ]) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  if (!SHA_RE.test(args['expected-input-sha'])) {
    throw new Error('--expected-input-sha must be a full lowercase Git SHA');
  }
  if (!['x64', 'arm64'].includes(args['expected-target-arch'])) {
    throw new Error('--expected-target-arch must be x64 or arm64');
  }
  const allowSimulation = args['allow-simulation'] === true;
  if (allowSimulation && args['trusted-build-public-key']) {
    throw new Error('simulation preflight cannot accept a trusted build public key');
  }
  if (!allowSimulation && !args['trusted-build-public-key']) {
    throw new Error('production I00 preflight requires --trusted-build-public-key');
  }

  const archivePath = requireAbsoluteExisting(args.archive, '--archive', 'file');
  const manifestPath = requireAbsoluteExisting(args.manifest, '--manifest', 'file');
  const digestPath = requireAbsoluteExisting(args.digest, '--digest', 'file');
  if (new Set([dirname(archivePath), dirname(manifestPath), dirname(digestPath)]).size !== 1) {
    throw new Error('archive, manifest, and digest must be siblings in one private directory');
  }
  const packageDirectory = dirname(archivePath);
  if ((lstatSync(packageDirectory).mode & 0o077) !== 0
      || realpathSync(packageDirectory) !== packageDirectory) {
    throw new Error('package directory must be canonical and owner-private');
  }
  const identitiesBefore = new Map([
    [archivePath, fileIdentity(archivePath)],
    [manifestPath, fileIdentity(manifestPath)],
    [digestPath, fileIdentity(digestPath)],
  ]);
  const trustedBuildPublicKey = allowSimulation
    ? null
    : requireAbsoluteExisting(
      args['trusted-build-public-key'],
      '--trusted-build-public-key',
      'file',
    );
  if (!allowSimulation) {
    const trustedKeyStat = lstatSync(trustedBuildPublicKey);
    if (trustedKeyStat.nlink !== 1 || (trustedKeyStat.mode & 0o022) !== 0) {
      throw new Error('trusted build public key must be single-link and not group/world writable');
    }
  }

  const manifest = readJson(manifestPath, 'I00 package manifest');
  if (readFileSync(manifestPath, 'utf8') !== canonicalJsonLine(manifest)) {
    throw new Error('I00 package manifest bytes are not canonical JSON');
  }
  requireExactKeys(manifest, [
    'schema', 'packageClass', 'packageRoot', 'inputSha', 'sourceTree',
    'sourceDateEpoch', 'archive', 'i00Release', 'target', 'nativeAddons',
    'serviceUnitContract', 'archiveModePlan', 'archiveModePlanSha256',
    'members', 'installState', 'deployAuthority',
  ], 'I00 package manifest');
  const simulation = manifest.packageClass === 'SIMULATION_I00_RELEASE';
  if (manifest.schema !== I00_PACKAGE_SCHEMA
      || (!simulation && manifest.packageClass !== 'OFFHOST_I00_RELEASE')
      || simulation !== allowSimulation
      || manifest.inputSha !== args['expected-input-sha']
      || manifest.packageRoot !== `i00-${manifest.inputSha}`
      || !SHA_RE.test(manifest.sourceTree)
      || !Number.isSafeInteger(manifest.sourceDateEpoch)
      || manifest.sourceDateEpoch < 0
      || manifest.installState !== 'NOT_INSTALLED'
      || manifest.deployAuthority !== 'NONE') {
    throw new Error('I00 package manifest identity, class, or state is invalid');
  }
  requireExactKeys(manifest.archive, ['file', 'sha256', 'size', 'format'], 'archive descriptor');
  if (manifest.archive.file !== basename(archivePath)
      || manifest.archive.file !== `${manifest.packageRoot}.tar`
      || manifest.archive.format !== 'ustar'
      || !SHA256_RE.test(manifest.archive.sha256)
      || !Number.isSafeInteger(manifest.archive.size)
      || manifest.archive.size < 1024) {
    throw new Error('I00 archive descriptor is invalid');
  }
  const digest = parseDigestFile(
    digestPath,
    basename(archivePath),
    basename(manifestPath),
  );
  const archiveSha256 = sha256File(archivePath);
  const manifestSha256 = sha256(Buffer.from(readFileSync(manifestPath)));
  if (archiveSha256 !== digest.archiveSha256
      || archiveSha256 !== manifest.archive.sha256
      || manifestSha256 !== digest.manifestSha256
      || statSync(archivePath).size !== manifest.archive.size) {
    throw new Error('I00 archive or package manifest digest mismatch');
  }

  requireExactKeys(manifest.i00Release, [
    'releaseId', 'testedSha', 'releaseJsonSha256', 'artifactManifestSha256',
    'sourceVerification', 'activationState', 'runtimeDependencies',
    'schemaVersion', 'rollbackFloor', 'rollbackBarrier', 'testedReceiptSha256',
    'browserReceiptSha256', 'performanceReceiptSha256', 'attestationSha256',
    'signatureSha256', 'publicKeySha256', 'i00EnforcementTreeDigestSha256',
    'validatorCohortMode', 'releaseTreeDigestSha256',
  ], 'I00 release descriptor');
  const i00 = manifest.i00Release;
  if (i00.releaseId !== manifest.packageRoot
      || i00.testedSha !== manifest.inputSha
      || i00.activationState !== 'NOT_DEPLOYED'
      || i00.runtimeDependencies !== 'BUNDLED_PREBUILT'
      || i00.validatorCohortMode !== 'EXACT_TRUSTED_COHORT'
      || !Number.isSafeInteger(i00.schemaVersion)
      || !Number.isSafeInteger(i00.rollbackFloor)
      || typeof i00.rollbackBarrier !== 'boolean'
      || ![
        i00.releaseJsonSha256, i00.artifactManifestSha256,
        i00.testedReceiptSha256, i00.browserReceiptSha256,
        i00.performanceReceiptSha256, i00.i00EnforcementTreeDigestSha256,
        i00.releaseTreeDigestSha256,
      ].every((value) => SHA256_RE.test(value))) {
    throw new Error('I00 release descriptor is invalid');
  }
  const attestationDigests = [
    i00.attestationSha256, i00.signatureSha256, i00.publicKeySha256,
  ];
  if (simulation) {
    if (i00.sourceVerification !== 'SIMULATION_ONLY'
        || attestationDigests.some((value) => value !== null)) {
      throw new Error('simulation I00 package has production provenance');
    }
  } else if (i00.sourceVerification !== 'GIT_EXACT_CLEAN'
      || !attestationDigests.every((value) => SHA256_RE.test(value))) {
    throw new Error('production I00 package lacks exact source or attestation provenance');
  }
  requireExactKeys(manifest.target, ['platform', 'arch'], 'target descriptor');
  if (manifest.target.platform !== 'linux'
      || manifest.target.arch !== args['expected-target-arch']) {
    throw new Error('I00 package target differs from expected Linux architecture');
  }
  requireExactKeys(manifest.archiveModePlan, [
    'rootMode', 'preserveMemberModes', 'groupWrite', 'otherWrite', 'specialBits',
  ], 'archive mode plan');
  if (manifest.archiveModePlan.rootMode !== 0o700
      || manifest.archiveModePlan.preserveMemberModes !== true
      || manifest.archiveModePlan.groupWrite !== false
      || manifest.archiveModePlan.otherWrite !== false
      || manifest.archiveModePlan.specialBits !== false
      || sha256(Buffer.from(canonicalJsonLine(manifest.archiveModePlan)))
        !== manifest.archiveModePlanSha256) {
    throw new Error('I00 archive mode plan is invalid');
  }
  requireExactKeys(manifest.serviceUnitContract, [
    'unitPath', 'sha256', 'user', 'group', 'workingDirectory',
    'nodeExecutable', 'entrypoint',
  ], 'service unit contract');
  const unit = manifest.serviceUnitContract;
  if (unit.unitPath !== 'ops/live/systemd/cosmos-app.service'
      || !SHA256_RE.test(unit.sha256)
      || unit.user !== args['expected-service-user']
      || unit.group !== args['expected-service-group']
      || unit.workingDirectory !== '/opt/cosmos/current'
      || unit.nodeExecutable !== '/usr/bin/node'
      || unit.entrypoint !== 'server/dist/index.js') {
    throw new Error('I00 package service unit contract is invalid');
  }
  if (!Array.isArray(manifest.members) || manifest.members.length < 2) {
    throw new Error('I00 package member set is empty');
  }
  for (const member of manifest.members) {
    requireExactKeys(member, [
      'path', 'type', 'size', 'sha256', 'sourceMode', 'targetMode',
    ], 'I00 package member');
    if (!['directory', 'file'].includes(member.type)
        || !Number.isSafeInteger(member.size) || member.size < 0
        || !Number.isSafeInteger(member.sourceMode)
        || member.sourceMode < 0 || member.sourceMode > 0o777
        || member.targetMode !== member.sourceMode
        || (member.sourceMode & 0o022) !== 0
        || (member.type === 'directory' && (member.size !== 0 || member.sha256 !== null))
        || (member.type === 'file' && !SHA256_RE.test(member.sha256))) {
      throw new Error('I00 package member descriptor or preserved mode is invalid');
    }
  }

  const inspected = inspectDeterministicTar(
    archivePath,
    manifest.packageRoot,
    manifest.sourceDateEpoch,
  );
  const actualMembers = inspected.members.map(
    ({ retained, mode, uid, gid, mtime, uname, gname, ...entry }) => ({
      path: entry.path,
      type: entry.type,
      size: entry.size,
      sha256: entry.sha256,
      sourceMode: mode,
      targetMode: mode,
    }),
  );
  if (canonicalJson(actualMembers) !== canonicalJson(manifest.members)) {
    throw new Error('I00 archive members differ from the package manifest');
  }

  const scratch = mkdtempSync(resolve(packageDirectory, '.i00-preflight-'));
  let cleaned = false;
  let releaseInspection;
  let validation;
  try {
    const extractionRoot = resolve(scratch, 'extract');
    mkdirSync(extractionRoot, { mode: 0o700 });
    const trustedKeySnapshot = simulation
      ? null
      : (() => {
        const trustRoot = resolve(scratch, 'trust');
        mkdirSync(trustRoot, { mode: 0o700 });
        return snapshotTrustedFile(
          trustedBuildPublicKey,
          resolve(trustRoot, 'trusted-build-public-key.pem'),
          'trusted build public key',
        );
      })();
    const extracted = inspectDeterministicTar(
      archivePath,
      manifest.packageRoot,
      manifest.sourceDateEpoch,
      { extractRoot: extractionRoot },
    );
    releaseInspection = inspectI00ReleaseTree(
      extracted.extractedReleaseRoot,
      manifest.inputSha,
      {
        allowSimulation: simulation,
        expectedSourceTree: manifest.sourceTree,
      },
    );
    validation = runTrustedI00Validator({
      releaseRoot: extracted.extractedReleaseRoot,
      expectedInputSha: manifest.inputSha,
      allowSimulation: simulation,
      trustedBuildPublicKey: trustedKeySnapshot?.path ?? null,
    });
    if (releaseInspection.releaseJsonSha256 !== i00.releaseJsonSha256
        || releaseInspection.artifactManifestSha256 !== i00.artifactManifestSha256
        || validation.artifactManifestSha256 !== i00.artifactManifestSha256
        || typedTreeDigest(releaseInspection.entries) !== i00.releaseTreeDigestSha256
        || sha256File(resolve(extracted.extractedReleaseRoot, unit.unitPath)) !== unit.sha256) {
      throw new Error('privately reconstructed I00 release differs from its package binding');
    }
    if (!simulation && trustedKeySnapshot.sha256 !== i00.publicKeySha256) {
      throw new Error('external trusted build key bytes differ from the packaged I00 provenance');
    }
    const actualNativeAddons = releaseInspection.entries
      .filter((entry) => entry.type === 'file' && entry.path.endsWith('.node'))
      .map((entry) => {
        inspectElf(resolve(extracted.extractedReleaseRoot, entry.path), manifest.target.arch);
        return {
          path: entry.path,
          format: 'ELF64_LE',
          arch: manifest.target.arch,
          sha256: entry.sha256,
        };
      });
    if ((!simulation && actualNativeAddons.length === 0)
        || canonicalJson(actualNativeAddons) !== canonicalJson(manifest.nativeAddons)) {
      throw new Error('I00 package native addon set or identity is invalid');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    cleaned = !existsSync(scratch);
  }
  if (!cleaned) throw new Error('private I00 preflight reconstruction cleanup failed');
  for (const [path, identity] of identitiesBefore) {
    if (canonicalJson(fileIdentity(path)) !== canonicalJson(identity)) {
      throw new Error('package input identity changed during I00 preflight');
    }
  }
  if (sha256File(archivePath) !== archiveSha256
      || sha256(Buffer.from(readFileSync(manifestPath))) !== manifestSha256) {
    throw new Error('package input bytes changed during I00 preflight');
  }

  process.stdout.write(canonicalJsonLine({
    status: simulation
      ? 'SIMULATION_I00_RELEASE_PACKAGE_PREFLIGHT_PASS_NO_TARGET_MUTATION'
      : 'I00_RELEASE_PACKAGE_PREFLIGHT_PASS_NO_TARGET_MUTATION',
    blocker: null,
    targetMutation: 'NONE',
    privateReconstruction: 'CLEANED',
    inputSha: manifest.inputSha,
    sourceTree: manifest.sourceTree,
    releaseId: i00.releaseId,
    validatorCohortMode: validation.validatorCohortMode,
    artifactManifestSha256: validation.artifactManifestSha256,
    archiveSha256,
    manifestSha256,
    memberCount: manifest.members.length,
    archiveBytes: manifest.archive.size,
    target: manifest.target,
    installState: 'NOT_INSTALLED',
    deployAuthority: 'NONE',
  }));
} catch (error) {
  fail(error.message);
}
