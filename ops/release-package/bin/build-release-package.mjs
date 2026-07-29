#!/usr/bin/env node
import {
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PACKAGE_SCHEMA,
  TARGET_MODES,
  assertTargetModePlan,
  canonicalJsonLine,
  listTypedTree,
  parseArgs,
  requireAbsoluteExisting,
  requirePrivateOutputRoot,
  sha256,
  sha256File,
  typedTreeDigest,
  validateReleaseInput,
  verifyFrozenSource,
  verifyFrozenServiceContract,
  writeDeterministicTar,
} from '../lib/release-package.mjs';

function fail(message) {
  process.stderr.write(`release-package: ${message}\n`);
  process.exit(1);
}

function prepareProductionRelease({ sourceRoot, inputSha, outputRoot, targetArch, npmCli }) {
  const privateBuildRoot = mkdtempSync(resolve(outputRoot, `.source-build-${inputSha}-`));
  const prepareScript = resolve(import.meta.dirname, 'prepare-linux-release.mjs');
  const result = spawnSync(process.execPath, [
    prepareScript,
    '--source-root', sourceRoot,
    '--input-sha', inputSha,
    '--output-root', privateBuildRoot,
    '--target-arch', targetArch,
    '--npm-cli', npmCli,
  ], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) {
    rmSync(privateBuildRoot, { recursive: true, force: true });
    throw new Error(`trusted frozen-source build failed with exit ${result.status ?? 'unknown'}`);
  }
  const lastLine = result.stdout.trim().split('\n').at(-1);
  let receipt;
  try {
    receipt = JSON.parse(lastLine);
  } catch {
    rmSync(privateBuildRoot, { recursive: true, force: true });
    throw new Error('trusted frozen-source build did not return its canonical receipt');
  }
  const expectedRoot = resolve(privateBuildRoot, `release-input-${inputSha}`);
  if (receipt.status !== 'LINUX_RELEASE_INPUT_BUILT_NOT_INSTALLED'
      || receipt.inputSha !== inputSha || receipt.releaseRoot !== expectedRoot) {
    rmSync(privateBuildRoot, { recursive: true, force: true });
    throw new Error('trusted frozen-source build receipt is not exact');
  }
  return { privateBuildRoot, releaseRoot: requireAbsoluteExisting(expectedRoot, 'prepared release root') };
}

try {
  const args = parseArgs(process.argv.slice(2), new Set(['simulation-source']));
  for (const key of ['source-root', 'input-sha', 'output-root', 'service-user', 'service-group']) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  const simulation = args['simulation-source'] === true;
  if (simulation) {
    if (!args['release-root']) throw new Error('--release-root is required only with --simulation-source');
    if (args['target-arch'] || args['npm-cli']) {
      throw new Error('simulation packaging cannot accept production build-tool arguments');
    }
  } else {
    if (args['release-root']) {
      throw new Error('production packaging builds its own frozen source; --release-root is forbidden');
    }
    for (const key of ['target-arch', 'npm-cli']) {
      if (!args[key]) throw new Error(`--${key} is required for production packaging`);
    }
    if (!['x64', 'arm64'].includes(args['target-arch'])) {
      throw new Error('--target-arch must be x64 or arm64');
    }
    requireAbsoluteExisting(args['npm-cli'], '--npm-cli', 'file');
  }
  const sourceRoot = requireAbsoluteExisting(args['source-root'], '--source-root');
  const outputRoot = requirePrivateOutputRoot(args['output-root']);
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(args['service-user'])
      || !/^[a-z_][a-z0-9_-]{0,31}$/.test(args['service-group'])) {
    throw new Error('service user and group must be canonical account names');
  }

  const binding = verifyFrozenSource(sourceRoot, args['input-sha']);
  const serviceUnitContract = verifyFrozenServiceContract(
    sourceRoot,
    binding.inputSha,
    args['service-user'],
    args['service-group'],
  );
  let privateBuildRoot = null;
  let releaseRoot;
  if (simulation) {
    releaseRoot = requireAbsoluteExisting(args['release-root'], '--release-root');
  } else {
    const prepared = prepareProductionRelease({
      sourceRoot,
      inputSha: binding.inputSha,
      outputRoot,
      targetArch: args['target-arch'],
      npmCli: args['npm-cli'],
    });
    privateBuildRoot = prepared.privateBuildRoot;
    releaseRoot = prepared.releaseRoot;
  }

  const createdFinals = [];
  let publicationRoot = null;
  try {
    const input = validateReleaseInput(releaseRoot, binding, {
      expectedBuildState: simulation
        ? 'SIMULATION_ONLY_NOT_DEPLOYABLE'
        : 'SOURCE_BUILD_VERIFIED_NOT_INSTALLED',
    });
    const packagedUnit = resolve(releaseRoot, serviceUnitContract.unitPath);
    requireAbsoluteExisting(packagedUnit, 'packaged systemd unit', 'file');
    if (sha256File(packagedUnit) !== serviceUnitContract.sha256) {
      throw new Error('packaged systemd unit differs from the frozen source contract');
    }
    const entries = listTypedTree(releaseRoot);
    assertTargetModePlan(entries);

    const packageRoot = `cosmos-release-${binding.inputSha}`;
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

    publicationRoot = mkdtempSync(resolve(outputRoot, `.package-${binding.inputSha}-`));
    const stagedPaths = {
      archive: resolve(publicationRoot, archiveName),
      manifest: resolve(publicationRoot, manifestName),
      digest: resolve(publicationRoot, digestName),
    };
    writeDeterministicTar({
      releaseRoot,
      archivePath: stagedPaths.archive,
      packageRoot,
      entries,
      epoch: binding.sourceDateEpoch,
    });
    const archiveSha256 = sha256File(stagedPaths.archive);
    const archiveSize = statSync(stagedPaths.archive).size;
    const modePlan = {
      owner: 'root',
      group: args['service-group'],
      serviceUser: args['service-user'],
      serviceGroup: args['service-group'],
      targetRoot: `/opt/cosmos/releases/${packageRoot}`,
      directoryMode: TARGET_MODES.directory,
      executableMode: TARGET_MODES.executable,
      fileMode: TARGET_MODES.file,
      groupWrite: false,
      otherAccess: false,
      serviceWrite: false,
    };
    const packageClass = simulation ? 'SIMULATION_ONLY' : 'OFFHOST_FROZEN_SOURCE_BUILD';
    const manifest = {
      schema: PACKAGE_SCHEMA,
      packageClass,
      packageRoot,
      inputSha: binding.inputSha,
      sourceTree: binding.sourceTree,
      sourceDateEpoch: binding.sourceDateEpoch,
      archive: {
        file: archiveName,
        sha256: archiveSha256,
        size: archiveSize,
        format: 'ustar',
      },
      releaseInput: {
        schema: input.release.schema,
        buildState: input.release.buildState,
        artifactManifestSha256: input.artifact.digest,
        treeDigestSha256: typedTreeDigest(entries),
        entrypoint: input.release.entrypoint,
      },
      target: input.release.target,
      toolchain: input.release.toolchain,
      nativeAddons: input.release.nativeAddons,
      serviceUnitContract,
      targetModePlan: modePlan,
      targetModePlanSha256: sha256(Buffer.from(canonicalJsonLine(modePlan))),
      members: [
        {
          path: packageRoot,
          type: 'directory',
          size: 0,
          sha256: null,
          sourceMode: 0o700,
          targetMode: TARGET_MODES.directory,
        },
        ...entries.map((entry) => ({
          path: `${packageRoot}/${entry.path}`,
          type: entry.type,
          size: entry.size,
          sha256: entry.sha256,
          sourceMode: entry.sourceMode,
          targetMode: entry.targetMode,
        })),
      ],
      installState: 'NOT_INSTALLED',
      deployAuthority: 'NONE',
    };
    const manifestBytes = canonicalJsonLine(manifest);
    const manifestSha256 = sha256(Buffer.from(manifestBytes));
    writeFileSync(stagedPaths.manifest, manifestBytes, { flag: 'wx', mode: 0o600 });
    const digestBytes = `${archiveSha256}  ${archiveName}\n${manifestSha256}  ${manifestName}\n`;
    writeFileSync(stagedPaths.digest, digestBytes, { flag: 'wx', mode: 0o600 });

    const prePublicationBinding = verifyFrozenSource(sourceRoot, args['input-sha']);
    if (prePublicationBinding.sourceTree !== binding.sourceTree) {
      throw new Error('source tree changed during packaging');
    }
    for (const key of ['archive', 'manifest', 'digest']) {
      linkSync(stagedPaths[key], finalPaths[key]);
      createdFinals.push(finalPaths[key]);
    }
    const finalBinding = verifyFrozenSource(sourceRoot, args['input-sha']);
    if (finalBinding.sourceTree !== binding.sourceTree) {
      throw new Error('source tree changed during package publication');
    }
    rmSync(publicationRoot, { recursive: true, force: true });
    publicationRoot = null;
    if (privateBuildRoot) {
      rmSync(privateBuildRoot, { recursive: true, force: true });
      privateBuildRoot = null;
    }
    process.stdout.write(canonicalJsonLine({
      status: simulation
        ? 'SIMULATION_RELEASE_PACKAGE_BUILT_NOT_INSTALLABLE'
        : 'RELEASE_PACKAGE_BUILT_NOT_INSTALLED',
      packageClass,
      inputSha: binding.inputSha,
      archive: finalPaths.archive,
      archiveSha256,
      manifest: finalPaths.manifest,
      manifestSha256,
      digest: finalPaths.digest,
    }));
  } catch (error) {
    for (const path of createdFinals) rmSync(path, { force: true });
    if (publicationRoot) rmSync(publicationRoot, { recursive: true, force: true });
    if (privateBuildRoot) rmSync(privateBuildRoot, { recursive: true, force: true });
    throw error;
  }
} catch (error) {
  fail(error.message);
}
