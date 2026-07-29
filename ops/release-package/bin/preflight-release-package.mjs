#!/usr/bin/env node
import { basename, dirname } from 'node:path';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import {
  PACKAGE_SCHEMA,
  PACKAGE_STATUS,
  SHA256_RE,
  SHA_RE,
  TARGET_MODES,
  assertTargetModePlan,
  canonicalJson,
  canonicalJsonLine,
  inspectElfBytes,
  inspectDeterministicTar,
  parseArgs,
  readJson,
  requireAbsoluteExisting,
  requireExactKeys,
  sha256,
  sha256File,
  typedTreeDigest,
} from '../lib/release-package.mjs';

function fail(message) {
  process.stderr.write(`release-package-preflight: ${message}\n`);
  process.exit(1);
}

function parseDigestFile(path, archiveName, manifestName) {
  const text = readFileSync(path, 'utf8');
  const expectedPattern = /^([0-9a-f]{64})  ([^\n]+)\n([0-9a-f]{64})  ([^\n]+)\n$/;
  const match = expectedPattern.exec(text);
  if (!match || match[2] !== archiveName || match[4] !== manifestName) {
    throw new Error('digest file is not the exact canonical two-entry form');
  }
  return { archiveSha256: match[1], manifestSha256: match[3] };
}

try {
  const args = parseArgs(process.argv.slice(2), new Set(['allow-simulation']));
  for (const key of [
    'archive', 'manifest', 'digest', 'expected-input-sha',
    'expected-service-user', 'expected-service-group', 'expected-target-root',
  ]) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  const archivePath = requireAbsoluteExisting(args.archive, '--archive', 'file');
  const manifestPath = requireAbsoluteExisting(args.manifest, '--manifest', 'file');
  const digestPath = requireAbsoluteExisting(args.digest, '--digest', 'file');
  if (new Set([dirname(archivePath), dirname(manifestPath), dirname(digestPath)]).size !== 1) {
    throw new Error('archive, manifest, and digest must be siblings in one private directory');
  }
  const parentMode = lstatSync(dirname(archivePath)).mode & 0o777;
  if ((parentMode & 0o077) !== 0) throw new Error('package directory must not be accessible by group or other');
  for (const path of [archivePath, manifestPath, digestPath]) {
    const status = lstatSync(path);
    if (status.nlink !== 1 || (status.mode & 0o077) !== 0) {
      throw new Error('package inputs must be single-link owner-only regular files');
    }
  }
  if (!SHA_RE.test(args['expected-input-sha'])) throw new Error('--expected-input-sha must be a full lowercase Git SHA');
  const manifest = readJson(manifestPath, 'package manifest');
  if (readFileSync(manifestPath, 'utf8') !== canonicalJsonLine(manifest)) {
    throw new Error('package manifest bytes are not canonical JSON');
  }
  requireExactKeys(manifest, [
    'schema', 'packageClass', 'packageRoot', 'inputSha', 'sourceTree', 'sourceDateEpoch', 'archive',
    'releaseInput', 'target', 'toolchain', 'nativeAddons', 'targetModePlan',
    'targetModePlanSha256', 'serviceUnitContract', 'members', 'installState', 'deployAuthority',
  ], 'package manifest');
  if (manifest.schema !== PACKAGE_SCHEMA || manifest.inputSha !== args['expected-input-sha']
      || manifest.packageRoot !== `cosmos-release-${manifest.inputSha}`
      || manifest.installState !== 'NOT_INSTALLED' || manifest.deployAuthority !== 'NONE') {
    throw new Error('package manifest binding or state is invalid');
  }
  const simulation = manifest.packageClass === 'SIMULATION_ONLY';
  if (!simulation && manifest.packageClass !== 'OFFHOST_FROZEN_SOURCE_BUILD') {
    throw new Error('package class is invalid');
  }
  if (simulation && args['allow-simulation'] !== true) {
    throw new Error('simulation package requires explicit --allow-simulation and is not installable');
  }
  if (!SHA_RE.test(manifest.sourceTree) || !Number.isSafeInteger(manifest.sourceDateEpoch)
      || manifest.sourceDateEpoch < 0 || !Array.isArray(manifest.members)) {
    throw new Error('package manifest source identity is invalid');
  }
  requireExactKeys(manifest.archive, ['file', 'sha256', 'size', 'format'], 'archive descriptor');
  if (manifest.archive.file !== basename(archivePath) || manifest.archive.format !== 'ustar'
      || !SHA256_RE.test(manifest.archive.sha256) || !Number.isSafeInteger(manifest.archive.size)) {
    throw new Error('archive descriptor is invalid');
  }
  const digest = parseDigestFile(digestPath, basename(archivePath), basename(manifestPath));
  const archiveSha256 = sha256File(archivePath);
  const manifestSha256 = sha256(Buffer.from(readFileSync(manifestPath)));
  if (archiveSha256 !== digest.archiveSha256 || archiveSha256 !== manifest.archive.sha256
      || manifestSha256 !== digest.manifestSha256 || statSync(archivePath).size !== manifest.archive.size) {
    throw new Error('package archive or manifest digest mismatch');
  }
  requireExactKeys(manifest.targetModePlan, [
    'owner', 'group', 'serviceUser', 'serviceGroup', 'targetRoot',
    'directoryMode', 'executableMode', 'fileMode',
    'groupWrite', 'otherAccess', 'serviceWrite',
  ], 'target mode plan');
  requireExactKeys(manifest.releaseInput, [
    'schema', 'buildState', 'artifactManifestSha256', 'treeDigestSha256', 'entrypoint',
  ], 'release input descriptor');
  requireExactKeys(manifest.target, ['platform', 'arch'], 'target descriptor');
  requireExactKeys(manifest.toolchain, [
    'nodeVersion', 'nodeMajor', 'nodeAbi', 'npmVersion',
  ], 'toolchain descriptor');
  requireExactKeys(manifest.serviceUnitContract, [
    'unitPath', 'sha256', 'user', 'group', 'workingDirectory', 'nodeExecutable', 'entrypoint',
  ], 'service unit contract');
  const plan = manifest.targetModePlan;
  if (plan.owner !== 'root' || plan.group !== args['expected-service-group']
      || plan.serviceUser !== args['expected-service-user']
      || plan.serviceGroup !== args['expected-service-group']
      || plan.targetRoot !== args['expected-target-root']
      || plan.targetRoot !== `/opt/cosmos/releases/${manifest.packageRoot}`
      || plan.directoryMode !== TARGET_MODES.directory
      || plan.executableMode !== TARGET_MODES.executable
      || plan.fileMode !== TARGET_MODES.file
      || plan.groupWrite !== false || plan.otherAccess !== false || plan.serviceWrite !== false
      || sha256(Buffer.from(canonicalJsonLine(plan))) !== manifest.targetModePlanSha256) {
    throw new Error('target ownership or mode plan differs from the expected service contract');
  }
  if (manifest.target.platform !== 'linux' || !['x64', 'arm64'].includes(manifest.target.arch)
      || manifest.toolchain.nodeMajor !== 22 || manifest.toolchain.npmVersion !== '10.9.8'
      || !/^v22\.[0-9]+\.[0-9]+$/.test(manifest.toolchain.nodeVersion)
      || !/^[0-9]+$/.test(manifest.toolchain.nodeAbi)
      || !SHA256_RE.test(manifest.releaseInput.artifactManifestSha256)
      || !SHA256_RE.test(manifest.releaseInput.treeDigestSha256)
      || manifest.releaseInput.entrypoint !== 'server/dist/index.js'
      || manifest.releaseInput.buildState !== (simulation
        ? 'SIMULATION_ONLY_NOT_DEPLOYABLE'
        : 'SOURCE_BUILD_VERIFIED_NOT_INSTALLED')) {
    throw new Error('package runtime target is invalid');
  }
  const unitContract = manifest.serviceUnitContract;
  if (unitContract.unitPath !== 'ops/live/systemd/cosmos-app.service'
      || !SHA256_RE.test(unitContract.sha256)
      || unitContract.user !== args['expected-service-user']
      || unitContract.group !== args['expected-service-group']
      || unitContract.workingDirectory !== '/opt/cosmos/current'
      || unitContract.nodeExecutable !== '/usr/bin/node'
      || unitContract.entrypoint !== manifest.releaseInput.entrypoint) {
    throw new Error('frozen service unit contract is invalid');
  }
  if (!Array.isArray(manifest.nativeAddons) || manifest.nativeAddons.length === 0) {
    throw new Error('package must bind at least one Linux native addon');
  }
  for (const addon of manifest.nativeAddons) {
    requireExactKeys(addon, ['path', 'format', 'arch', 'sha256'], 'native addon descriptor');
    if (typeof addon.path !== 'string' || addon.path.startsWith('/') || addon.path.includes('..')
        || addon.path.includes('\\') || !addon.path.endsWith('.node')
        || addon.format !== 'ELF64_LE' || addon.arch !== manifest.target.arch
        || !SHA256_RE.test(addon.sha256)) {
      throw new Error('native addon descriptor is invalid');
    }
  }
  for (const member of manifest.members) {
    requireExactKeys(member, [
      'path', 'type', 'size', 'sha256', 'sourceMode', 'targetMode',
    ], 'package member');
    if (!['directory', 'file'].includes(member.type)
        || !Number.isSafeInteger(member.size) || member.size < 0
        || !Number.isSafeInteger(member.sourceMode) || member.sourceMode < 0 || member.sourceMode > 0o777
        || !Number.isSafeInteger(member.targetMode) || member.targetMode < 0 || member.targetMode > 0o777
        || (member.type === 'directory' && (member.size !== 0 || member.sha256 !== null))
        || (member.type === 'file' && !SHA256_RE.test(member.sha256))) {
      throw new Error('package member descriptor is invalid');
    }
  }

  const inspected = inspectDeterministicTar(archivePath, manifest.packageRoot, manifest.sourceDateEpoch);
  const actualMembers = inspected.members.map(({ retained, mode, uid, gid, mtime, uname, gname, ...entry }) => ({
    path: entry.path,
    type: entry.type,
    size: entry.size,
    sha256: entry.sha256,
    targetMode: mode,
  }));
  const expectedMembers = manifest.members.map((entry) => ({
    path: entry.path,
    type: entry.type,
    size: entry.size,
    sha256: entry.sha256,
    targetMode: entry.targetMode,
  }));
  if (canonicalJson(actualMembers) !== canonicalJson(expectedMembers)) {
    throw new Error('archive members differ from the package manifest');
  }
  assertTargetModePlan(manifest.members.map((entry) => ({
    ...entry,
    path: entry.path,
  })));
  const relativeEntries = manifest.members.slice(1).map((entry) => ({
    ...entry,
    path: entry.path.slice(manifest.packageRoot.length + 1),
  }));
  if (typedTreeDigest(relativeEntries) !== manifest.releaseInput.treeDigestSha256) {
    throw new Error('package release tree digest mismatch');
  }
  const releaseMember = inspected.members.find((entry) => entry.path === `${manifest.packageRoot}/release.json`);
  const artifactMember = inspected.members.find((entry) => entry.path === `${manifest.packageRoot}/artifact-manifest.json`);
  if (!releaseMember?.retained || !artifactMember?.retained) {
    throw new Error('archive lacks its bound release or artifact manifest');
  }
  const embeddedRelease = JSON.parse(releaseMember.retained.toString('utf8'));
  const embeddedArtifact = JSON.parse(artifactMember.retained.toString('utf8'));
  requireExactKeys(embeddedRelease, [
    'schema', 'inputSha', 'sourceTree', 'sourceDateEpoch', 'entrypoint',
    'target', 'toolchain', 'nativeAddons', 'buildState',
  ], 'embedded release input');
  requireExactKeys(embeddedArtifact, [
    'schemaVersion', 'testedSha', 'sourceTree', 'files',
  ], 'embedded artifact manifest');
  if (embeddedRelease.inputSha !== manifest.inputSha || embeddedRelease.sourceTree !== manifest.sourceTree
      || embeddedRelease.sourceDateEpoch !== manifest.sourceDateEpoch
      || embeddedRelease.schema !== manifest.releaseInput.schema
      || embeddedRelease.buildState !== manifest.releaseInput.buildState
      || embeddedRelease.entrypoint !== manifest.releaseInput.entrypoint
      || embeddedRelease.target.platform !== manifest.target.platform
      || embeddedRelease.target.arch !== manifest.target.arch
      || embeddedRelease.toolchain.nodeAbi !== manifest.toolchain.nodeAbi
      || canonicalJson(embeddedRelease.toolchain) !== canonicalJson(manifest.toolchain)
      || canonicalJson(embeddedRelease.nativeAddons) !== canonicalJson(manifest.nativeAddons)
      || embeddedArtifact.testedSha !== manifest.inputSha
      || embeddedArtifact.sourceTree !== manifest.sourceTree
      || artifactMember.sha256 !== manifest.releaseInput.artifactManifestSha256) {
    throw new Error('embedded release provenance differs from the package manifest');
  }
  if (!Array.isArray(embeddedArtifact.files)) throw new Error('embedded artifact file list is invalid');
  const packageMemberByRelativePath = new Map(relativeEntries.map((entry) => [entry.path, entry]));
  const expectedArtifactPaths = relativeEntries
    .filter((entry) => entry.type === 'file' && entry.path !== 'artifact-manifest.json')
    .map((entry) => entry.path);
  const actualArtifactPaths = [];
  for (const file of embeddedArtifact.files) {
    requireExactKeys(file, ['path', 'sha256', 'mode'], 'embedded artifact file');
    const member = packageMemberByRelativePath.get(file.path);
    if (!member || member.type !== 'file' || member.sha256 !== file.sha256
        || member.sourceMode !== file.mode || !SHA256_RE.test(file.sha256)) {
      throw new Error('embedded artifact manifest differs from packaged bytes');
    }
    actualArtifactPaths.push(file.path);
  }
  if (canonicalJson(actualArtifactPaths) !== canonicalJson(expectedArtifactPaths)) {
    throw new Error('embedded artifact manifest file set is incomplete or reordered');
  }
  const inspectedByPath = new Map(inspected.members.map((member) => [member.path, member]));
  const unitMember = inspectedByPath.get(`${manifest.packageRoot}/${unitContract.unitPath}`);
  if (!unitMember || unitMember.type !== 'file' || unitMember.sha256 !== unitContract.sha256) {
    throw new Error('packaged systemd unit differs from the frozen service contract');
  }
  const packagedNativePaths = inspected.members
    .filter((member) => member.type === 'file' && member.path.endsWith('.node'))
    .map((member) => member.path.slice(manifest.packageRoot.length + 1));
  if (canonicalJson(packagedNativePaths) !== canonicalJson(manifest.nativeAddons.map((addon) => addon.path))) {
    throw new Error('native addon descriptors do not exactly enumerate packaged .node files');
  }
  for (const addon of manifest.nativeAddons) {
    const member = inspectedByPath.get(`${manifest.packageRoot}/${addon.path}`);
    if (!member?.retained || member.type !== 'file' || member.sha256 !== addon.sha256) {
      throw new Error('native addon bytes differ from the package manifest');
    }
    inspectElfBytes(member.retained, addon.arch, addon.path);
  }

  process.stdout.write(canonicalJsonLine({
    status: simulation ? 'PACKAGE_PREFLIGHT_SIMULATION_PASS_NO_MUTATION' : PACKAGE_STATUS,
    blocker: null,
    mutation: 'NONE',
    inputSha: manifest.inputSha,
    sourceTree: manifest.sourceTree,
    archiveSha256,
    manifestSha256,
    memberCount: manifest.members.length,
    archiveBytes: manifest.archive.size,
    target: manifest.target,
    nodeAbi: manifest.toolchain.nodeAbi,
    targetModePlanSha256: manifest.targetModePlanSha256,
  }));
} catch (error) {
  fail(error.message);
}
