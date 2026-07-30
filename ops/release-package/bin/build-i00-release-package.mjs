#!/usr/bin/env node
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  I00_PACKAGE_SCHEMA,
  SHA256_RE,
  canonicalJsonLine,
  inspectElf,
  inspectI00ReleaseTree,
  listTypedTree,
  parseArgs,
  requireAbsoluteExisting,
  requirePrivateOutputRoot,
  runTrustedI00Validator,
  sha256,
  sha256File,
  snapshotTrustedFile,
  typedTreeDigest,
  verifyFrozenServiceContract,
  verifyFrozenSource,
  writeDeterministicTar,
} from '../lib/release-package.mjs';

function fail(message) {
  process.stderr.write(`i00-release-package: ${message}\n`);
  process.exit(1);
}

try {
  if (process.platform === 'win32') {
    throw new Error('I00 mode-preserving packaging requires POSIX filesystem semantics');
  }
  const args = parseArgs(process.argv.slice(2), new Set(['allow-simulation']));
  const allowed = new Set([
    'source-root', 'input-sha', 'release-root', 'output-root', 'target-arch',
    'service-user', 'service-group', 'trusted-build-public-key', 'allow-simulation',
  ]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw new Error(`unsupported argument: --${key}`);
  }
  for (const key of [
    'source-root', 'input-sha', 'release-root', 'output-root', 'target-arch',
    'service-user', 'service-group',
  ]) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  if (!['x64', 'arm64'].includes(args['target-arch'])) {
    throw new Error('--target-arch must be x64 or arm64');
  }
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(args['service-user'])
      || !/^[a-z_][a-z0-9_-]{0,31}$/.test(args['service-group'])) {
    throw new Error('service user and group must be canonical account names');
  }
  const allowSimulation = args['allow-simulation'] === true;
  if (allowSimulation && args['trusted-build-public-key']) {
    throw new Error('simulation packaging cannot accept a trusted build public key');
  }
  if (!allowSimulation && !args['trusted-build-public-key']) {
    throw new Error('production I00 packaging requires --trusted-build-public-key');
  }

  const sourceRoot = requireAbsoluteExisting(args['source-root'], '--source-root');
  const releaseRoot = requireAbsoluteExisting(args['release-root'], '--release-root');
  const outputRoot = requirePrivateOutputRoot(args['output-root']);
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
  const binding = verifyFrozenSource(sourceRoot, args['input-sha']);
  const serviceUnitContract = verifyFrozenServiceContract(
    sourceRoot,
    binding.inputSha,
    args['service-user'],
    args['service-group'],
  );
  const inspected = inspectI00ReleaseTree(releaseRoot, binding.inputSha, {
    allowSimulation,
    expectedSourceTree: allowSimulation ? null : binding.sourceTree,
  });
  const packagedUnit = resolve(releaseRoot, serviceUnitContract.unitPath);
  requireAbsoluteExisting(packagedUnit, 'packaged systemd unit', 'file');
  if (sha256File(packagedUnit) !== serviceUnitContract.sha256) {
    throw new Error('packaged systemd unit differs from the frozen source contract');
  }
  for (const subtree of ['ops/i00', 'ops/live']) {
    const sourceDigest = typedTreeDigest(listTypedTree(resolve(sourceRoot, subtree)));
    const releaseDigest = typedTreeDigest(listTypedTree(resolve(releaseRoot, subtree)));
    if (sourceDigest !== releaseDigest) {
      throw new Error(`packaged ${subtree} differs from the frozen source tree`);
    }
  }

  const nativeAddons = inspected.entries
    .filter((entry) => entry.type === 'file' && entry.path.endsWith('.node'))
    .map((entry) => {
      inspectElf(resolve(releaseRoot, entry.path), args['target-arch']);
      return {
        path: entry.path,
        format: 'ELF64_LE',
        arch: args['target-arch'],
        sha256: entry.sha256,
      };
    });
  if (!allowSimulation && nativeAddons.length === 0) {
    throw new Error('production I00 package must bind at least one Linux native addon');
  }
  const archiveModePlan = {
    rootMode: inspected.rootMode,
    preserveMemberModes: true,
    groupWrite: false,
    otherWrite: false,
    specialBits: false,
  };
  const packageRoot = `i00-${binding.inputSha}`;
  const archiveName = `${packageRoot}.tar`;
  const manifestName = `${packageRoot}.manifest.json`;
  const digestName = `${packageRoot}.sha256`;
  const finalPaths = {
    archive: resolve(outputRoot, archiveName),
    manifest: resolve(outputRoot, manifestName),
    digest: resolve(outputRoot, digestName),
  };
  for (const path of Object.values(finalPaths)) {
    if (existsSync(path)) throw new Error(`create-only output already exists: ${basename(path)}`);
  }

  const publicationRoot = mkdtempSync(resolve(outputRoot, `.i00-package-${binding.inputSha}-`));
  const stagedPaths = {
    archive: resolve(publicationRoot, archiveName),
    manifest: resolve(publicationRoot, manifestName),
    digest: resolve(publicationRoot, digestName),
  };
  const createdFinals = [];
  try {
    const trustedKeySnapshot = allowSimulation
      ? null
      : snapshotTrustedFile(
        trustedBuildPublicKey,
        resolve(publicationRoot, 'trusted-build-public-key.pem'),
        'trusted build public key',
      );
    const validatorKey = trustedKeySnapshot?.path ?? null;
    const validation = runTrustedI00Validator({
      releaseRoot,
      expectedInputSha: binding.inputSha,
      allowSimulation,
      trustedBuildPublicKey: validatorKey,
    });
    if (validation.artifactManifestSha256 !== inspected.artifactManifestSha256) {
      throw new Error('trusted validator and package bridge disagree on the artifact manifest');
    }
    if (!allowSimulation
        && trustedKeySnapshot.sha256
          !== inspected.release.buildAttestation.publicKeySha256) {
      throw new Error('external trusted build key bytes differ from the I00 provenance');
    }
    writeDeterministicTar({
      releaseRoot,
      archivePath: stagedPaths.archive,
      packageRoot,
      entries: inspected.entries,
      epoch: binding.sourceDateEpoch,
      rootMode: inspected.rootMode,
    });
    const archiveSha256 = sha256File(stagedPaths.archive);
    const archiveSize = statSync(stagedPaths.archive).size;
    const release = inspected.release;
    const packageClass = allowSimulation
      ? 'SIMULATION_I00_RELEASE'
      : 'OFFHOST_I00_RELEASE';
    const manifest = {
      schema: I00_PACKAGE_SCHEMA,
      packageClass,
      packageRoot,
      inputSha: binding.inputSha,
      sourceTree: release.sourceTree,
      sourceDateEpoch: binding.sourceDateEpoch,
      archive: {
        file: archiveName,
        sha256: archiveSha256,
        size: archiveSize,
        format: 'ustar',
      },
      i00Release: {
        releaseId: release.releaseId,
        testedSha: release.testedSha,
        releaseJsonSha256: inspected.releaseJsonSha256,
        artifactManifestSha256: inspected.artifactManifestSha256,
        sourceVerification: release.sourceVerification,
        activationState: release.activationState,
        runtimeDependencies: release.runtimeDependencies,
        schemaVersion: release.schemaVersion,
        rollbackFloor: release.rollbackFloor,
        rollbackBarrier: release.rollbackBarrier,
        testedReceiptSha256: release.testedReceiptSha256,
        browserReceiptSha256: release.acceptanceEvidence.browserReceiptSha256,
        performanceReceiptSha256: release.acceptanceEvidence.performanceReceiptSha256,
        attestationSha256: release.buildAttestation.attestationSha256 ?? null,
        signatureSha256: release.buildAttestation.signatureSha256 ?? null,
        publicKeySha256: release.buildAttestation.publicKeySha256 ?? null,
        i00EnforcementTreeDigestSha256:
          release.l15OpsProvenance.i00EnforcementTreeDigestSha256,
        validatorCohortMode: validation.validatorCohortMode,
        releaseTreeDigestSha256: typedTreeDigest(inspected.entries),
      },
      target: {
        platform: 'linux',
        arch: args['target-arch'],
      },
      nativeAddons,
      serviceUnitContract,
      archiveModePlan,
      archiveModePlanSha256: sha256(Buffer.from(canonicalJsonLine(archiveModePlan))),
      members: [
        {
          path: packageRoot,
          type: 'directory',
          size: 0,
          sha256: null,
          sourceMode: inspected.rootMode,
          targetMode: inspected.rootMode,
        },
        ...inspected.entries.map((entry) => ({
          path: `${packageRoot}/${entry.path}`,
          type: entry.type,
          size: entry.size,
          sha256: entry.sha256,
          sourceMode: entry.sourceMode,
          targetMode: entry.sourceMode,
        })),
      ],
      installState: 'NOT_INSTALLED',
      deployAuthority: 'NONE',
    };
    const manifestBytes = canonicalJsonLine(manifest);
    const manifestSha256 = sha256(Buffer.from(manifestBytes));
    writeFileSync(stagedPaths.manifest, manifestBytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(
      stagedPaths.digest,
      `${archiveSha256}  ${archiveName}\n${manifestSha256}  ${manifestName}\n`,
      { flag: 'wx', mode: 0o600 },
    );

    const prePublicationBinding = verifyFrozenSource(sourceRoot, binding.inputSha);
    if (prePublicationBinding.sourceTree !== binding.sourceTree) {
      throw new Error('source tree changed during I00 packaging');
    }
    for (const key of ['archive', 'manifest', 'digest']) {
      linkSync(stagedPaths[key], finalPaths[key]);
      createdFinals.push(finalPaths[key]);
    }
    const finalValidation = runTrustedI00Validator({
      releaseRoot,
      expectedInputSha: binding.inputSha,
      allowSimulation,
      trustedBuildPublicKey: validatorKey,
    });
    const finalBinding = verifyFrozenSource(sourceRoot, binding.inputSha);
    if (finalBinding.sourceTree !== binding.sourceTree
        || finalValidation.artifactManifestSha256 !== inspected.artifactManifestSha256
        || lstatSync(finalPaths.archive).nlink !== 2
        || lstatSync(finalPaths.manifest).nlink !== 2
        || lstatSync(finalPaths.digest).nlink !== 2) {
      throw new Error('source, release, or publication identity changed during I00 packaging');
    }
    rmSync(publicationRoot, { recursive: true, force: true });
    for (const path of Object.values(finalPaths)) {
      if (lstatSync(path).nlink !== 1) {
        throw new Error('published package output does not have one exact link');
      }
    }
    process.stdout.write(canonicalJsonLine({
      status: allowSimulation
        ? 'SIMULATION_I00_RELEASE_PACKAGE_BUILT_NOT_INSTALLABLE'
        : 'I00_RELEASE_PACKAGE_BUILT_NOT_INSTALLED',
      packageClass,
      inputSha: binding.inputSha,
      releaseId: release.releaseId,
      validatorCohortMode: validation.validatorCohortMode,
      archive: finalPaths.archive,
      archiveSha256,
      manifest: finalPaths.manifest,
      manifestSha256,
      digest: finalPaths.digest,
      installState: 'NOT_INSTALLED',
      deployAuthority: 'NONE',
    }));
  } catch (error) {
    for (const path of createdFinals) rmSync(path, { force: true });
    rmSync(publicationRoot, { recursive: true, force: true });
    throw error;
  }
} catch (error) {
  fail(error.message);
}
