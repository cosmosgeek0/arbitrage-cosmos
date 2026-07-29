import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  RELEASE_INPUT_SCHEMA,
  canonicalJsonLine,
  sha256,
  sha256File,
  typedTreeDigest,
  verifyFrozenSource,
  writeArtifactManifest,
  writeDeterministicTar,
} from '../release-package/lib/release-package.mjs';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_ROOT, '../..');
const BUILD = resolve(REPO_ROOT, 'ops/release-package/bin/build-release-package.mjs');
const PREFLIGHT = resolve(REPO_ROOT, 'ops/release-package/bin/preflight-release-package.mjs');
const GIT = '/usr/bin/git';
let assertions = 0;
const SERVICE_UNIT = `[Unit]
Description=fixture
[Service]
User=cosmos
Group=cosmos
WorkingDirectory=/opt/cosmos/current
ExecStart=/usr/bin/node server/dist/index.js
`;

function ok(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function command(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      LC_ALL: 'C',
      LANG: 'C',
      ...options.env,
    },
  });
}

function git(root, argv, env = {}) {
  const result = command(GIT, ['-C', root, ...argv], { env });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function buildArgs(source, sha, release, output) {
  return [
    BUILD,
    '--source-root', source,
    '--input-sha', sha,
    '--simulation-source',
    '--release-root', release,
    '--output-root', output,
    '--service-user', 'cosmos',
    '--service-group', 'cosmos',
  ];
}

function packagePaths(output, sha) {
  const prefix = resolve(output, `cosmos-release-${sha}`);
  return {
    archive: `${prefix}.tar`,
    manifest: `${prefix}.manifest.json`,
    digest: `${prefix}.sha256`,
  };
}

function preflightArgs(paths, sha) {
  return [
    PREFLIGHT,
    '--archive', paths.archive,
    '--manifest', paths.manifest,
    '--digest', paths.digest,
    '--expected-input-sha', sha,
    '--expected-service-user', 'cosmos',
    '--expected-service-group', 'cosmos',
    '--expected-target-root', `/opt/cosmos/releases/cosmos-release-${sha}`,
    '--allow-simulation',
  ];
}

function createElfX64() {
  const buffer = Buffer.alloc(512);
  buffer.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  buffer.writeUInt16LE(3, 16);
  buffer.writeUInt16LE(0x3e, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeBigUInt64LE(64n, 32);
  buffer.writeUInt16LE(64, 52);
  buffer.writeUInt16LE(56, 54);
  buffer.writeUInt16LE(2, 56);

  // One executable PT_LOAD containing the complete file.
  buffer.writeUInt32LE(1, 64);
  buffer.writeUInt32LE(5, 68);
  buffer.writeBigUInt64LE(0n, 72);
  buffer.writeBigUInt64LE(0x400000n, 80);
  buffer.writeBigUInt64LE(512n, 96);
  buffer.writeBigUInt64LE(512n, 104);
  buffer.writeBigUInt64LE(0x1000n, 112);

  // A bounded PT_DYNAMIC inside the loadable file range.
  buffer.writeUInt32LE(2, 120);
  buffer.writeUInt32LE(4, 124);
  buffer.writeBigUInt64LE(176n, 128);
  buffer.writeBigUInt64LE(0x4000b0n, 136);
  buffer.writeBigUInt64LE(80n, 152);
  buffer.writeBigUInt64LE(80n, 160);
  buffer.writeBigUInt64LE(8n, 168);

  const dynamicEntries = [
    [5n, 0x400120n],
    [10n, 16n],
    [6n, 0x400140n],
    [11n, 24n],
    [0n, 0n],
  ];
  dynamicEntries.forEach(([tag, value], index) => {
    const offset = 176 + (index * 16);
    buffer.writeBigInt64LE(tag, offset);
    buffer.writeBigUInt64LE(value, offset + 8);
  });
  return buffer;
}

function createRelease(root, binding, marker) {
  mkdirSync(resolve(root, 'server/dist'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(root, 'web/dist'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(root, 'node_modules/native'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(root, 'ops/bin'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(root, 'ops/live/systemd'), { recursive: true, mode: 0o700 });
  writeFileSync(resolve(root, 'server/dist/index.js'), `export default ${JSON.stringify(marker)};\n`);
  writeFileSync(resolve(root, 'web/dist/index.html'), `<p>${marker}</p>\n`);
  writeFileSync(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  writeFileSync(resolve(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n');
  writeFileSync(resolve(root, 'server/package.json'), '{"name":"fixture-server","type":"module"}\n');
  writeFileSync(resolve(root, 'ops/bin/rehearse.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(resolve(root, 'ops/live/systemd/cosmos-app.service'), SERVICE_UNIT);
  chmodSync(resolve(root, 'ops/bin/rehearse.sh'), 0o755);
  const addonPath = resolve(root, 'node_modules/native/addon.node');
  writeFileSync(addonPath, createElfX64());
  const release = {
    schema: RELEASE_INPUT_SCHEMA,
    inputSha: binding.inputSha,
    sourceTree: binding.sourceTree,
    sourceDateEpoch: binding.sourceDateEpoch,
    entrypoint: 'server/dist/index.js',
    target: { platform: 'linux', arch: 'x64' },
    toolchain: {
      nodeVersion: process.version,
      nodeMajor: 22,
      nodeAbi: process.versions.modules,
      npmVersion: '10.9.8',
    },
    nativeAddons: [{
      path: 'node_modules/native/addon.node',
      format: 'ELF64_LE',
      arch: 'x64',
      sha256: sha256File(addonPath),
    }],
    buildState: 'SIMULATION_ONLY_NOT_DEPLOYABLE',
  };
  writeFileSync(resolve(root, 'release.json'), canonicalJsonLine(release), { mode: 0o600 });
  writeArtifactManifest(root, binding);
}

function rewritePackageMetadata(paths, mutate) {
  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'));
  mutate(manifest);
  const manifestBytes = canonicalJsonLine(manifest);
  writeFileSync(paths.manifest, manifestBytes);
  const archiveSha = sha256File(paths.archive);
  const manifestSha = sha256(Buffer.from(manifestBytes));
  writeFileSync(paths.digest,
    `${archiveSha}  ${paths.archive.split('/').at(-1)}\n${manifestSha}  ${paths.manifest.split('/').at(-1)}\n`);
}

function rewriteTarHeaderName(archivePath, name) {
  const archive = Buffer.from(readFileSync(archivePath));
  archive.fill(0, 0, 100);
  archive.write(name, 0, 100, 'utf8');
  archive.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of archive.subarray(0, 512)) checksum += byte;
  archive.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  archive[154] = 0;
  archive[155] = 0x20;
  writeFileSync(archivePath, archive);
}

function tarMemberLocation(archive, wanted) {
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const readField = (start, length) => {
      const field = header.subarray(start, start + length);
      const end = field.indexOf(0);
      return field.subarray(0, end === -1 ? field.length : end).toString('utf8');
    };
    const name = readField(0, 100);
    const prefix = readField(345, 155);
    let path = prefix ? `${prefix}/${name}` : name;
    if (path.endsWith('/')) path = path.slice(0, -1);
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    const span = 512 + Math.ceil(size / 512) * 512;
    if (path === wanted) return { offset, span };
    offset += span;
  }
  throw new Error(`tar fixture member not found: ${wanted}`);
}

function rewriteTarMemberMode(archivePath, wanted, mode) {
  const archive = Buffer.from(readFileSync(archivePath));
  const { offset } = tarMemberLocation(archive, wanted);
  const header = archive.subarray(offset, offset + 512);
  header.fill(0x30, 100, 107);
  const text = mode.toString(8);
  header.write(text, 107 - text.length, text.length, 'ascii');
  header[107] = 0;
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  writeFileSync(archivePath, archive);
}

function removeTarMember(archivePath, wanted) {
  const archive = Buffer.from(readFileSync(archivePath));
  const { offset, span } = tarMemberLocation(archive, wanted);
  writeFileSync(archivePath, Buffer.concat([
    archive.subarray(0, offset),
    archive.subarray(offset + span),
  ]));
}

function expectFailure(executable, argv, label) {
  const result = command(executable, argv);
  ok(result.status !== 0, `${label} must fail`);
}

const sandbox = realpathSync(mkdtempSync(resolve(tmpdir(), 'cosmos-release-package-test-')));
try {
  const source = resolve(sandbox, 'source');
  mkdirSync(source, { mode: 0o700 });
  git(source, ['init', '-q']);
  git(source, ['config', 'user.name', 'Release Fixture']);
  git(source, ['config', 'user.email', 'release-fixture@example.invalid']);
  writeFileSync(resolve(source, 'tracked.txt'), 'first\n');
  mkdirSync(resolve(source, 'ops/live/systemd'), { recursive: true });
  writeFileSync(resolve(source, 'ops/live/systemd/cosmos-app.service'), SERVICE_UNIT);
  git(source, ['add', 'tracked.txt', 'ops/live/systemd/cosmos-app.service']);
  const commitEnv = {
    GIT_AUTHOR_DATE: '2025-01-02T03:04:05Z',
    GIT_COMMITTER_DATE: '2025-01-02T03:04:05Z',
  };
  git(source, ['commit', '-q', '-m', 'fixture one'], commitEnv);
  const shaOne = git(source, ['rev-parse', 'HEAD']);
  const bindingOne = verifyFrozenSource(source, shaOne);
  const releaseOne = resolve(sandbox, 'release-one');
  mkdirSync(releaseOne, { mode: 0o700 });
  createRelease(releaseOne, bindingOne, 'one');

  const outputA = resolve(sandbox, 'output-a');
  const outputB = resolve(sandbox, 'output-b');
  mkdirSync(outputA, { mode: 0o700 });
  mkdirSync(outputB, { mode: 0o700 });
  const oldUmask = process.umask(0o022);
  const buildA = command(process.execPath, buildArgs(source, shaOne, releaseOne, outputA));
  process.umask(0o077);
  const buildB = command(process.execPath, buildArgs(source, shaOne, releaseOne, outputB));
  process.umask(oldUmask);
  ok(buildA.status === 0, `first package build failed: ${buildA.stderr}`);
  ok(buildB.status === 0, `second package build failed: ${buildB.stderr}`);
  const pathsA = packagePaths(outputA, shaOne);
  const pathsB = packagePaths(outputB, shaOne);
  for (const key of ['archive', 'manifest', 'digest']) {
    ok(readFileSync(pathsA[key]).equals(readFileSync(pathsB[key])),
      `${key} must be byte-identical across output roots and umasks`);
  }

  const preflight = command(process.execPath, preflightArgs(pathsA, shaOne));
  ok(preflight.status === 0, `valid package preflight failed: ${preflight.stderr}`);
  const preflightResult = JSON.parse(preflight.stdout);
  ok(preflightResult.status === 'PACKAGE_PREFLIGHT_SIMULATION_PASS_NO_MUTATION',
    'simulation preflight is explicit and cannot claim production eligibility');
  ok(preflightResult.mutation === 'NONE' && preflightResult.blocker === null,
    'preflight makes no target mutation');
  expectFailure(process.execPath, preflightArgs(pathsA, shaOne).slice(0, -1),
    'simulation package without explicit simulation admission');
  const manifest = JSON.parse(readFileSync(pathsA.manifest, 'utf8'));
  ok(manifest.packageClass === 'SIMULATION_ONLY',
    'caller-supplied fixture bytes are permanently marked non-production');
  ok(manifest.targetModePlan.owner === 'root' && manifest.targetModePlan.group === 'cosmos',
    'target ownership is root and the named service group');
  ok(manifest.members.every((entry) => (entry.targetMode & 0o007) === 0),
    'no packaged member is world-accessible');
  ok(manifest.members.every((entry) => (entry.targetMode & 0o222) === 0),
    'service and other identities cannot write the immutable release');
  ok(manifest.members.filter((entry) => entry.type === 'directory')
    .every((entry) => (entry.targetMode & 0o050) === 0o050),
  'service group can read and traverse every packaged directory');
  ok(manifest.members.filter((entry) => entry.type === 'file')
    .every((entry) => (entry.targetMode & 0o040) === 0o040),
  'service group can read every packaged file');
  const untrustedProductionOutput = resolve(sandbox, 'untrusted-production-output');
  mkdirSync(untrustedProductionOutput, { mode: 0o700 });
  expectFailure(process.execPath,
    buildArgs(source, shaOne, releaseOne, untrustedProductionOutput)
      .filter((token) => token !== '--simulation-source'),
    'caller-supplied production release root');

  const originalDigests = Object.fromEntries(
    Object.entries(pathsA).map(([key, path]) => [key, sha256File(path)]),
  );
  expectFailure(process.execPath, buildArgs(source, shaOne, releaseOne, outputA),
    'create-only output collision');
  ok(Object.entries(pathsA).every(([key, path]) => sha256File(path) === originalDigests[key]),
    'collision leaves the first package unchanged');

  const partialOutput = resolve(sandbox, 'partial-output');
  mkdirSync(partialOutput, { mode: 0o700 });
  const partialPaths = packagePaths(partialOutput, shaOne);
  writeFileSync(partialPaths.manifest, 'reserved\n', { mode: 0o600 });
  expectFailure(process.execPath, buildArgs(source, shaOne, releaseOne, partialOutput),
    'partial final-name collision');
  ok(!existsSync(partialPaths.archive) && !existsSync(partialPaths.digest)
    && readFileSync(partialPaths.manifest, 'utf8') === 'reserved\n',
  'failed publication leaves no new canonical-named artifact');

  const failedArchive = resolve(sandbox, 'failed-write.tar');
  assert.throws(() => writeDeterministicTar({
    releaseRoot: releaseOne,
    archivePath: failedArchive,
    packageRoot: `cosmos-release-${shaOne}`,
    entries: [{
      path: 'missing.bin',
      type: 'file',
      size: 1,
      sourceMode: 0o600,
      targetMode: 0o440,
      sha256: '0'.repeat(64),
    }],
    epoch: bindingOne.sourceDateEpoch,
  }));
  assertions += 1;
  ok(!existsSync(failedArchive), 'failed tar write removes its private partial archive');

  writeFileSync(resolve(source, 'untracked.txt'), 'dirty\n');
  const dirtyOutput = resolve(sandbox, 'dirty-output');
  mkdirSync(dirtyOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, releaseOne, dirtyOutput),
    'dirty frozen source');
  rmSync(resolve(source, 'untracked.txt'));

  const alias = resolve(sandbox, 'source-alias');
  symlinkSync(source, alias);
  const aliasOutput = resolve(sandbox, 'alias-output');
  mkdirSync(aliasOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(alias, shaOne, releaseOne, aliasOutput),
    'source path alias');

  const linkRelease = resolve(sandbox, 'link-release');
  cpSync(releaseOne, linkRelease, { recursive: true });
  symlinkSync('index.js', resolve(linkRelease, 'server/dist/alias.js'));
  const linkOutput = resolve(sandbox, 'link-output');
  mkdirSync(linkOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, linkRelease, linkOutput),
    'release symbolic link');

  const hardRelease = resolve(sandbox, 'hard-release');
  cpSync(releaseOne, hardRelease, { recursive: true });
  linkSync(resolve(hardRelease, 'server/dist/index.js'), resolve(hardRelease, 'server/dist/hard.js'));
  const hardOutput = resolve(sandbox, 'hard-output');
  mkdirSync(hardOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, hardRelease, hardOutput),
    'release hard link');

  expectFailure(process.execPath, preflightArgs(pathsA, `${'0'.repeat(40)}`),
    'cross-SHA preflight');

  const tamperOutput = resolve(sandbox, 'tamper-output');
  mkdirSync(tamperOutput, { mode: 0o700 });
  const tamperPaths = packagePaths(tamperOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], tamperPaths[key]);
  const tamperedArchive = Buffer.from(readFileSync(tamperPaths.archive));
  tamperedArchive[600] ^= 1;
  writeFileSync(tamperPaths.archive, tamperedArchive);
  expectFailure(process.execPath, preflightArgs(tamperPaths, shaOne),
    'archive byte tamper');

  const exposedOutput = resolve(sandbox, 'exposed-output');
  mkdirSync(exposedOutput, { mode: 0o700 });
  const exposedPaths = packagePaths(exposedOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], exposedPaths[key]);
  chmodSync(exposedPaths.archive, 0o640);
  expectFailure(process.execPath, preflightArgs(exposedPaths, shaOne),
    'group-readable package input');

  const modeOutput = resolve(sandbox, 'mode-output');
  mkdirSync(modeOutput, { mode: 0o700 });
  const modePaths = packagePaths(modeOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], modePaths[key]);
  rewritePackageMetadata(modePaths, (value) => {
    value.targetModePlan.otherAccess = true;
    value.targetModePlanSha256 = sha256(Buffer.from(canonicalJsonLine(value.targetModePlan)));
  });
  expectFailure(process.execPath, preflightArgs(modePaths, shaOne),
    'world-access target plan');

  const traversalOutput = resolve(sandbox, 'traversal-output');
  mkdirSync(traversalOutput, { mode: 0o700 });
  const traversalPaths = packagePaths(traversalOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], traversalPaths[key]);
  rewriteTarHeaderName(traversalPaths.archive, '../escape');
  rewritePackageMetadata(traversalPaths, (value) => {
    value.archive.sha256 = sha256File(traversalPaths.archive);
  });
  expectFailure(process.execPath, preflightArgs(traversalPaths, shaOne),
    'archive path traversal');

  const wrongNativeRelease = resolve(sandbox, 'wrong-native-release');
  cpSync(releaseOne, wrongNativeRelease, { recursive: true });
  rmSync(resolve(wrongNativeRelease, 'artifact-manifest.json'));
  const wrongNativePath = resolve(wrongNativeRelease, 'node_modules/native/addon.node');
  const machO = Buffer.alloc(64);
  machO.set([0xcf, 0xfa, 0xed, 0xfe]);
  writeFileSync(wrongNativePath, machO);
  const wrongReleaseJson = JSON.parse(readFileSync(resolve(wrongNativeRelease, 'release.json'), 'utf8'));
  wrongReleaseJson.nativeAddons[0].sha256 = sha256File(wrongNativePath);
  writeFileSync(resolve(wrongNativeRelease, 'release.json'), canonicalJsonLine(wrongReleaseJson));
  writeArtifactManifest(wrongNativeRelease, bindingOne);
  const wrongNativeOutput = resolve(sandbox, 'wrong-native-output');
  mkdirSync(wrongNativeOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, wrongNativeRelease, wrongNativeOutput),
    'non-Linux native addon');

  const incompleteElfRelease = resolve(sandbox, 'incomplete-elf-release');
  cpSync(releaseOne, incompleteElfRelease, { recursive: true });
  rmSync(resolve(incompleteElfRelease, 'artifact-manifest.json'));
  const incompleteElfPath = resolve(incompleteElfRelease, 'node_modules/native/addon.node');
  const incompleteElf = Buffer.alloc(20);
  incompleteElf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  incompleteElf.writeUInt16LE(0, 16);
  incompleteElf.writeUInt16LE(0x3e, 18);
  writeFileSync(incompleteElfPath, incompleteElf);
  const incompleteReleaseJson = JSON.parse(
    readFileSync(resolve(incompleteElfRelease, 'release.json'), 'utf8'),
  );
  incompleteReleaseJson.nativeAddons[0].sha256 = sha256File(incompleteElfPath);
  writeFileSync(resolve(incompleteElfRelease, 'release.json'), canonicalJsonLine(incompleteReleaseJson));
  writeArtifactManifest(incompleteElfRelease, bindingOne);
  const incompleteElfOutput = resolve(sandbox, 'incomplete-elf-output');
  mkdirSync(incompleteElfOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, incompleteElfRelease, incompleteElfOutput),
    'incomplete ET_NONE native addon');

  const emptySegmentRelease = resolve(sandbox, 'empty-segment-release');
  cpSync(releaseOne, emptySegmentRelease, { recursive: true });
  rmSync(resolve(emptySegmentRelease, 'artifact-manifest.json'));
  const emptySegmentPath = resolve(emptySegmentRelease, 'node_modules/native/addon.node');
  const emptySegmentElf = createElfX64();
  emptySegmentElf.writeBigUInt64LE(0n, 96);
  emptySegmentElf.writeBigUInt64LE(0n, 104);
  writeFileSync(emptySegmentPath, emptySegmentElf);
  const emptySegmentJson = JSON.parse(
    readFileSync(resolve(emptySegmentRelease, 'release.json'), 'utf8'),
  );
  emptySegmentJson.nativeAddons[0].sha256 = sha256File(emptySegmentPath);
  writeFileSync(resolve(emptySegmentRelease, 'release.json'), canonicalJsonLine(emptySegmentJson));
  writeArtifactManifest(emptySegmentRelease, bindingOne);
  const emptySegmentOutput = resolve(sandbox, 'empty-segment-output');
  mkdirSync(emptySegmentOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, emptySegmentRelease, emptySegmentOutput),
    'empty ELF load segment');

  const unterminatedDynamicRelease = resolve(sandbox, 'unterminated-dynamic-release');
  cpSync(releaseOne, unterminatedDynamicRelease, { recursive: true });
  rmSync(resolve(unterminatedDynamicRelease, 'artifact-manifest.json'));
  const unterminatedDynamicPath = resolve(
    unterminatedDynamicRelease,
    'node_modules/native/addon.node',
  );
  const unterminatedDynamicElf = createElfX64();
  unterminatedDynamicElf.writeBigInt64LE(1n, 240);
  writeFileSync(unterminatedDynamicPath, unterminatedDynamicElf);
  const unterminatedDynamicJson = JSON.parse(
    readFileSync(resolve(unterminatedDynamicRelease, 'release.json'), 'utf8'),
  );
  unterminatedDynamicJson.nativeAddons[0].sha256 = sha256File(unterminatedDynamicPath);
  writeFileSync(
    resolve(unterminatedDynamicRelease, 'release.json'),
    canonicalJsonLine(unterminatedDynamicJson),
  );
  writeArtifactManifest(unterminatedDynamicRelease, bindingOne);
  const unterminatedDynamicOutput = resolve(sandbox, 'unterminated-dynamic-output');
  mkdirSync(unterminatedDynamicOutput, { mode: 0o700 });
  expectFailure(
    process.execPath,
    buildArgs(source, shaOne, unterminatedDynamicRelease, unterminatedDynamicOutput),
    'unterminated ELF dynamic table',
  );

  const decoyDynamicRelease = resolve(sandbox, 'decoy-dynamic-release');
  cpSync(releaseOne, decoyDynamicRelease, { recursive: true });
  rmSync(resolve(decoyDynamicRelease, 'artifact-manifest.json'));
  const decoyDynamicPath = resolve(decoyDynamicRelease, 'node_modules/native/addon.node');
  const decoyDynamicElf = createElfX64();
  decoyDynamicElf.copy(decoyDynamicElf, 352, 176, 256);
  decoyDynamicElf.fill(0xff, 176, 256);
  decoyDynamicElf.writeBigUInt64LE(352n, 128);
  writeFileSync(decoyDynamicPath, decoyDynamicElf);
  const decoyDynamicJson = JSON.parse(
    readFileSync(resolve(decoyDynamicRelease, 'release.json'), 'utf8'),
  );
  decoyDynamicJson.nativeAddons[0].sha256 = sha256File(decoyDynamicPath);
  writeFileSync(
    resolve(decoyDynamicRelease, 'release.json'),
    canonicalJsonLine(decoyDynamicJson),
  );
  writeArtifactManifest(decoyDynamicRelease, bindingOne);
  const decoyDynamicOutput = resolve(sandbox, 'decoy-dynamic-output');
  mkdirSync(decoyDynamicOutput, { mode: 0o700 });
  expectFailure(
    process.execPath,
    buildArgs(source, shaOne, decoyDynamicRelease, decoyDynamicOutput),
    'ELF dynamic file/virtual mapping mismatch',
  );

  const unlistedNativeRelease = resolve(sandbox, 'unlisted-native-release');
  cpSync(releaseOne, unlistedNativeRelease, { recursive: true });
  rmSync(resolve(unlistedNativeRelease, 'artifact-manifest.json'));
  writeFileSync(resolve(unlistedNativeRelease, 'node_modules/native/extra.node'), machO);
  writeArtifactManifest(unlistedNativeRelease, bindingOne);
  const unlistedNativeOutput = resolve(sandbox, 'unlisted-native-output');
  mkdirSync(unlistedNativeOutput, { mode: 0o700 });
  expectFailure(process.execPath, buildArgs(source, shaOne, unlistedNativeRelease, unlistedNativeOutput),
    'unlisted native addon');

  expectFailure(process.execPath, [
    '-e',
    `import(${JSON.stringify(resolve(REPO_ROOT, 'ops/release-package/lib/release-package.mjs'))})`
      + `.then(m=>m.assertTargetModePlan([{path:'plain.js',type:'file',sourceMode:420,targetMode:360}]))`,
  ], 'source-to-target execute-mode inflation');

  const canonicalOutput = resolve(sandbox, 'canonical-output');
  mkdirSync(canonicalOutput, { mode: 0o700 });
  const canonicalPaths = packagePaths(canonicalOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], canonicalPaths[key]);
  const prettyManifest = JSON.parse(readFileSync(canonicalPaths.manifest, 'utf8'));
  const prettyBytes = `${JSON.stringify(prettyManifest, null, 2)}\n`;
  writeFileSync(canonicalPaths.manifest, prettyBytes);
  writeFileSync(canonicalPaths.digest,
    `${sha256File(canonicalPaths.archive)}  ${canonicalPaths.archive.split('/').at(-1)}\n`
    + `${sha256(Buffer.from(prettyBytes))}  ${canonicalPaths.manifest.split('/').at(-1)}\n`);
  expectFailure(process.execPath, preflightArgs(canonicalPaths, shaOne),
    'noncanonical package manifest bytes');

  const driftModeOutput = resolve(sandbox, 'drift-mode-output');
  mkdirSync(driftModeOutput, { mode: 0o700 });
  const driftModePaths = packagePaths(driftModeOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], driftModePaths[key]);
  const driftPath = `cosmos-release-${shaOne}/server/dist/index.js`;
  rewriteTarMemberMode(driftModePaths.archive, driftPath, 0o550);
  rewritePackageMetadata(driftModePaths, (value) => {
    value.archive.sha256 = sha256File(driftModePaths.archive);
    value.members.find((entry) => entry.path === driftPath).targetMode = 0o550;
  });
  expectFailure(process.execPath, preflightArgs(driftModePaths, shaOne),
    'source-to-target execute-mode drift');

  const missingParentOutput = resolve(sandbox, 'missing-parent-output');
  mkdirSync(missingParentOutput, { mode: 0o700 });
  const missingParentPaths = packagePaths(missingParentOutput, shaOne);
  for (const key of Object.keys(pathsA)) copyFileSync(pathsA[key], missingParentPaths[key]);
  const missingParent = `cosmos-release-${shaOne}/server`;
  removeTarMember(missingParentPaths.archive, missingParent);
  rewritePackageMetadata(missingParentPaths, (value) => {
    value.archive.sha256 = sha256File(missingParentPaths.archive);
    value.archive.size = readFileSync(missingParentPaths.archive).length;
    value.members = value.members.filter((entry) => entry.path !== missingParent);
    value.releaseInput.treeDigestSha256 = typedTreeDigest(value.members.slice(1).map((entry) => ({
      ...entry,
      path: entry.path.slice(value.packageRoot.length + 1),
    })));
  });
  expectFailure(process.execPath, preflightArgs(missingParentPaths, shaOne),
    'missing explicit archive parent directory');

  writeFileSync(resolve(source, 'tracked.txt'), 'second\n');
  git(source, ['add', 'tracked.txt']);
  git(source, ['commit', '-q', '-m', 'fixture two'], {
    GIT_AUTHOR_DATE: '2025-01-02T03:05:05Z',
    GIT_COMMITTER_DATE: '2025-01-02T03:05:05Z',
  });
  const shaTwo = git(source, ['rev-parse', 'HEAD']);
  const bindingTwo = verifyFrozenSource(source, shaTwo);
  const releaseTwo = resolve(sandbox, 'release-two');
  mkdirSync(releaseTwo, { mode: 0o700 });
  createRelease(releaseTwo, bindingTwo, 'two');
  const outputTwo = resolve(sandbox, 'output-two');
  mkdirSync(outputTwo, { mode: 0o700 });
  const buildTwo = command(process.execPath, buildArgs(source, shaTwo, releaseTwo, outputTwo));
  ok(buildTwo.status === 0, `second frozen-SHA consumer failed: ${buildTwo.stderr}`);
  const pathsTwo = packagePaths(outputTwo, shaTwo);
  const preflightTwo = command(process.execPath, preflightArgs(pathsTwo, shaTwo));
  ok(preflightTwo.status === 0, `second frozen-SHA preflight failed: ${preflightTwo.stderr}`);
  ok(sha256File(pathsTwo.archive) !== sha256File(pathsA.archive),
    'different frozen inputs produce distinct package identities');
  expectFailure(process.execPath, preflightArgs(pathsTwo, shaOne),
    'new package paired with old frozen SHA');

  process.stdout.write(`OK (${assertions} assertions)\n`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
