import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export const PACKAGE_SCHEMA = 'cosmos.release-package.v1';
export const I00_PACKAGE_SCHEMA = 'cosmos.i00-release-package.v1';
export const RELEASE_INPUT_SCHEMA = 'cosmos.release-input.v1';
export const SHA_RE = /^[0-9a-f]{40}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const PACKAGE_STATUS = 'PACKAGE_PREFLIGHT_PASS_NO_MUTATION';
export const TARGET_MODES = Object.freeze({
  directory: 0o550,
  executable: 0o550,
  file: 0o440,
});

function fail(message) {
  throw new Error(message);
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') fail('canonical JSON rejects unsupported values');
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function canonicalJsonLine(value) {
  return `${canonicalJson(value)}\n`;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(path) {
  const descriptor = openSync(path, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function requireAbsoluteExisting(path, label, expectedType = 'directory') {
  if (typeof path !== 'string' || !isAbsolute(path)) fail(`${label} must be an absolute path`);
  if (!existsSync(path) || realpathSync(path) !== path) fail(`${label} must be an existing canonical path`);
  const status = lstatSync(path);
  if (status.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (expectedType === 'directory' && !status.isDirectory()) fail(`${label} must be a directory`);
  if (expectedType === 'file' && !status.isFile()) fail(`${label} must be a regular file`);
  return path;
}

export function requirePrivateOutputRoot(path) {
  requireAbsoluteExisting(path, '--output-root');
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) fail('--output-root must not be accessible by group or other');
  return path;
}

export function snapshotTrustedFile(sourcePath, destinationPath, label = 'trusted file') {
  requireAbsoluteExisting(sourcePath, label, 'file');
  const destinationParent = dirname(destinationPath);
  requirePrivateOutputRoot(destinationParent);
  if (dirname(destinationPath) !== destinationParent || existsSync(destinationPath)) {
    fail(`${label} snapshot must be one absent private-root child`);
  }
  const namedBefore = lstatSync(sourcePath, { bigint: true });
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink()
      || namedBefore.nlink !== 1n || (namedBefore.mode & 0o022n) !== 0n
      || realpathSync(sourcePath) !== sourcePath) {
    fail(`${label} must be canonical, single-link, and not group/world writable`);
  }
  const descriptor = openSync(
    sourcePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  let bytes;
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    for (const field of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) {
      if (openedBefore[field] !== namedBefore[field]) {
        fail(`${label} identity changed while opening`);
      }
    }
    bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(sourcePath, { bigint: true });
    for (const field of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) {
      if (openedAfter[field] !== openedBefore[field]
          || namedAfter[field] !== openedBefore[field]) {
        fail(`${label} identity changed while snapshotting`);
      }
    }
  } finally {
    closeSync(descriptor);
  }
  writeFileSync(destinationPath, bytes, { flag: 'wx', mode: 0o600 });
  const snapshotStat = lstatSync(destinationPath);
  if (!snapshotStat.isFile() || snapshotStat.nlink !== 1
      || (snapshotStat.mode & 0o077) !== 0) {
    rmSync(destinationPath, { force: true });
    fail(`${label} snapshot is not one owner-only regular file`);
  }
  return Object.freeze({
    path: destinationPath,
    sha256: sha256(bytes),
  });
}

export function parseArgs(argv, booleanKeys = new Set()) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--') || token.length === 2) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    if (Object.hasOwn(parsed, key)) fail(`duplicate argument: --${key}`);
    if (booleanKeys.has(key)) {
      parsed[key] = true;
      continue;
    }
    index += 1;
    if (index >= argv.length || argv[index].startsWith('--')) fail(`--${key} requires a value`);
    parsed[key] = argv[index];
  }
  return parsed;
}

export function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has an unexpected key set`);
  }
}

export function readJson(path, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  return parsed;
}

export function resolveGit() {
  for (const candidate of ['/usr/bin/git', '/usr/local/bin/git']) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  }
  fail('a fixed Git executable was not found');
}

export function runGit(sourceRoot, args, options = {}) {
  const result = spawnSync(resolveGit(), ['-C', sourceRoot, ...args], {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    env: {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      LC_ALL: 'C',
      LANG: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (result.status !== 0) {
    fail(`Git command failed (${args[0]}): ${String(result.stderr || '').trim() || `exit ${result.status}`}`);
  }
  return result.stdout;
}

export function verifyFrozenSource(sourceRoot, inputSha) {
  requireAbsoluteExisting(sourceRoot, '--source-root');
  if (!SHA_RE.test(inputSha)) fail('--input-sha must be a full lowercase Git SHA');
  const head = runGit(sourceRoot, ['rev-parse', 'HEAD']).trim();
  if (head !== inputSha) fail('source worktree HEAD differs from --input-sha');
  const commit = runGit(sourceRoot, ['rev-parse', `${inputSha}^{commit}`]).trim();
  if (commit !== inputSha) fail('--input-sha does not resolve to the exact commit');
  const tree = runGit(sourceRoot, ['rev-parse', `${inputSha}^{tree}`]).trim();
  if (!SHA_RE.test(tree)) fail('source tree is invalid');
  const status = runGit(sourceRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status.length !== 0) fail('source worktree must be exactly clean, including ignored-independent untracked state');
  const epochText = runGit(sourceRoot, ['show', '-s', '--format=%ct', inputSha]).trim();
  if (!/^[0-9]+$/.test(epochText)) fail('source commit epoch is invalid');
  return Object.freeze({ inputSha, sourceTree: tree, sourceDateEpoch: Number(epochText) });
}

export function verifyFrozenServiceContract(sourceRoot, inputSha, expectedUser, expectedGroup) {
  const unitPath = 'ops/live/systemd/cosmos-app.service';
  const bytes = Buffer.from(runGit(sourceRoot, ['show', `${inputSha}:${unitPath}`]));
  const text = bytes.toString('utf8');
  const value = (key) => {
    const matches = text.split(/\r?\n/)
      .filter((line) => line.startsWith(`${key}=`))
      .map((line) => line.slice(key.length + 1));
    if (matches.length !== 1 || matches[0].length === 0) fail(`frozen service unit must declare one ${key}`);
    return matches[0];
  };
  const user = value('User');
  const group = value('Group');
  const workingDirectory = value('WorkingDirectory');
  const execStart = value('ExecStart');
  if (user !== expectedUser || group !== expectedGroup) {
    fail('requested service identity differs from the frozen systemd unit');
  }
  if (workingDirectory !== '/opt/cosmos/current'
      || !execStart.endsWith('/usr/bin/node server/dist/index.js')) {
    fail('frozen systemd working directory or Node entrypoint is outside the package contract');
  }
  return Object.freeze({
    unitPath,
    sha256: sha256(bytes),
    user,
    group,
    workingDirectory,
    nodeExecutable: '/usr/bin/node',
    entrypoint: 'server/dist/index.js',
  });
}

function validateRelativePath(path, label) {
  if (typeof path !== 'string' || path.length === 0) fail(`${label} path is empty`);
  if (path.includes('\0') || path.includes('\\') || path.startsWith('/') || path.endsWith('/')) {
    fail(`${label} path is not canonical`);
  }
  const components = path.split('/');
  if (components.some((component) => component === '' || component === '.' || component === '..')) {
    fail(`${label} path is not canonical`);
  }
  if (Buffer.byteLength(path) > 255) fail(`${label} path is too long for deterministic ustar`);
  return path;
}

function sortPaths(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

export function listTypedTree(root) {
  requireAbsoluteExisting(root, 'release root');
  const entries = [];
  const seenInodes = new Set();
  const walk = (absolute, prefix) => {
    const names = readdirSync(absolute).sort(sortPaths);
    for (const name of names) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      validateRelativePath(relativePath, 'release member');
      const child = join(absolute, name);
      const status = lstatSync(child);
      if (status.isSymbolicLink()) fail(`symbolic links are forbidden: ${relativePath}`);
      if ((status.mode & 0o7000) !== 0) fail(`special mode bits are forbidden: ${relativePath}`);
      if (status.isDirectory()) {
        entries.push({
          path: relativePath,
          type: 'directory',
          size: 0,
          sourceMode: status.mode & 0o777,
          targetMode: TARGET_MODES.directory,
          sha256: null,
        });
        walk(child, relativePath);
        continue;
      }
      if (!status.isFile()) fail(`special files are forbidden: ${relativePath}`);
      const inodeKey = `${status.dev}:${status.ino}`;
      if (status.nlink !== 1 || seenInodes.has(inodeKey)) fail(`hard links are forbidden: ${relativePath}`);
      seenInodes.add(inodeKey);
      const executable = (status.mode & 0o111) !== 0;
      entries.push({
        path: relativePath,
        type: 'file',
        size: status.size,
        sourceMode: status.mode & 0o777,
        targetMode: executable ? TARGET_MODES.executable : TARGET_MODES.file,
        sha256: sha256File(child),
      });
    }
  };
  walk(root, '');
  return entries.sort((left, right) => sortPaths(left.path, right.path));
}

export function typedTreeDigest(entries) {
  return sha256(Buffer.from(canonicalJsonLine(entries.map((entry) => ({
    path: entry.path,
    type: entry.type,
    size: entry.size,
    sha256: entry.sha256,
    sourceMode: entry.sourceMode,
  })))));
}

export function writeArtifactManifest(root, binding) {
  const path = resolve(root, 'artifact-manifest.json');
  if (existsSync(path)) fail('artifact-manifest.json already exists');
  const files = listTypedTree(root)
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      mode: entry.sourceMode,
    }));
  const manifest = {
    schemaVersion: 1,
    testedSha: binding.inputSha,
    sourceTree: binding.sourceTree,
    files,
  };
  writeFileSync(path, canonicalJsonLine(manifest), { mode: 0o600, flag: 'wx' });
  return manifest;
}

export function verifyArtifactManifest(root, binding) {
  const path = resolve(root, 'artifact-manifest.json');
  requireAbsoluteExisting(path, 'artifact manifest', 'file');
  const manifest = readJson(path, 'artifact manifest');
  requireExactKeys(manifest, ['schemaVersion', 'testedSha', 'sourceTree', 'files'], 'artifact manifest');
  if (manifest.schemaVersion !== 1 || manifest.testedSha !== binding.inputSha
      || manifest.sourceTree !== binding.sourceTree || !Array.isArray(manifest.files)) {
    fail('artifact manifest binding is invalid');
  }
  const expectedFiles = listTypedTree(root)
    .filter((entry) => entry.type === 'file' && entry.path !== 'artifact-manifest.json')
    .map((entry) => ({ path: entry.path, sha256: entry.sha256, mode: entry.sourceMode }));
  if (canonicalJson(manifest.files) !== canonicalJson(expectedFiles)) {
    fail('artifact manifest does not exactly match release bytes and modes');
  }
  return Object.freeze({
    manifest,
    digest: sha256File(path),
  });
}

function putOctal(buffer, offset, length, value, label) {
  const text = value.toString(8);
  if (text.length > length - 1) fail(`${label} does not fit ustar`);
  buffer.fill(0x30, offset, offset + length - 1);
  buffer.write(text, offset + length - 1 - text.length, text.length, 'ascii');
  buffer[offset + length - 1] = 0;
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  const slashIndexes = [];
  for (let index = 0; index < path.length; index += 1) if (path[index] === '/') slashIndexes.push(index);
  for (let index = slashIndexes.length - 1; index >= 0; index -= 1) {
    const split = slashIndexes[index];
    const prefix = path.slice(0, split);
    const name = path.slice(split + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  fail(`path cannot be represented by deterministic ustar: ${path}`);
}

function ustarHeader(path, entry, epoch) {
  const storedPath = entry.type === 'directory' ? `${path}/` : path;
  const { name, prefix } = splitUstarPath(storedPath);
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  putOctal(header, 100, 8, entry.targetMode, 'mode');
  putOctal(header, 108, 8, 0, 'uid');
  putOctal(header, 116, 8, 0, 'gid');
  putOctal(header, 124, 12, entry.type === 'file' ? entry.size : 0, 'size');
  putOctal(header, 136, 12, epoch, 'mtime');
  header.fill(0x20, 148, 156);
  header[156] = entry.type === 'directory' ? 0x35 : 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0');
  header.write(checksumText, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeAll(descriptor, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(descriptor, buffer, offset, buffer.length - offset);
}

export function writeDeterministicTar({
  releaseRoot,
  archivePath,
  packageRoot,
  entries,
  epoch,
  rootMode = TARGET_MODES.directory,
}) {
  if (!Number.isSafeInteger(epoch) || epoch < 0) fail('source date epoch must be a non-negative integer');
  if (!Number.isSafeInteger(rootMode) || rootMode < 0 || rootMode > 0o777) {
    fail('archive root mode must be an ordinary POSIX mode');
  }
  const rootEntry = {
    path: '',
    type: 'directory',
    size: 0,
    sourceMode: 0o700,
    targetMode: rootMode,
    sha256: null,
  };
  const descriptor = openSync(archivePath, 'wx', 0o600);
  const copyBuffer = Buffer.allocUnsafe(1024 * 1024);
  let complete = false;
  try {
    for (const entry of [rootEntry, ...entries]) {
      const storedPath = entry.path ? `${packageRoot}/${entry.path}` : packageRoot;
      writeAll(descriptor, ustarHeader(storedPath, entry, epoch));
      if (entry.type !== 'file') continue;
      const inputPath = resolve(releaseRoot, entry.path);
      const namedBefore = lstatSync(inputPath, { bigint: true });
      if (!namedBefore.isFile() || namedBefore.isSymbolicLink()
          || namedBefore.nlink !== 1n
          || Number(namedBefore.size) !== entry.size
          || Number(namedBefore.mode & 0o777n) !== entry.sourceMode) {
        fail(`release member identity changed before archive read: ${entry.path}`);
      }
      const input = openSync(
        inputPath,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const openedBefore = fstatSync(input, { bigint: true });
        if (openedBefore.dev !== namedBefore.dev || openedBefore.ino !== namedBefore.ino
            || openedBefore.size !== namedBefore.size
            || openedBefore.mtimeNs !== namedBefore.mtimeNs
            || openedBefore.ctimeNs !== namedBefore.ctimeNs) {
          fail(`release member changed while opening for archive: ${entry.path}`);
        }
        const hash = createHash('sha256');
        let remaining = entry.size;
        while (remaining > 0) {
          const count = readSync(
            input,
            copyBuffer,
            0,
            Math.min(copyBuffer.length, remaining),
            null,
          );
          if (count === 0) fail(`release member ended early during archive read: ${entry.path}`);
          writeAll(descriptor, copyBuffer.subarray(0, count));
          hash.update(copyBuffer.subarray(0, count));
          remaining -= count;
        }
        if (readSync(input, copyBuffer, 0, 1, null) !== 0
            || hash.digest('hex') !== entry.sha256) {
          fail(`release member bytes changed during archive read: ${entry.path}`);
        }
        const openedAfter = fstatSync(input, { bigint: true });
        const namedAfter = lstatSync(inputPath, { bigint: true });
        for (const field of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) {
          if (openedAfter[field] !== openedBefore[field]
              || namedAfter[field] !== openedBefore[field]) {
            fail(`release member identity changed during archive read: ${entry.path}`);
          }
        }
      } finally {
        closeSync(input);
      }
      const padding = (512 - (entry.size % 512)) % 512;
      if (padding !== 0) writeAll(descriptor, Buffer.alloc(padding));
    }
    writeAll(descriptor, Buffer.alloc(1024));
    complete = true;
  } finally {
    closeSync(descriptor);
    if (!complete) rmSync(archivePath, { force: true });
  }
}

function readExact(descriptor, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(descriptor, buffer, offset, length - offset, position + offset);
    if (count === 0) fail('archive ended unexpectedly');
    offset += count;
  }
  return buffer;
}

function readString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  return buffer.subarray(start, boundedEnd).toString('utf8');
}

function readOctal(buffer, start, length, label) {
  const text = buffer.subarray(start, start + length).toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(text)) fail(`archive ${label} is not canonical octal`);
  return Number.parseInt(text, 8);
}

function parseHeader(header) {
  if (header.subarray(257, 263).toString('binary') !== 'ustar\0'
      || header.subarray(263, 265).toString('ascii') !== '00') {
    fail('archive is not canonical ustar');
  }
  const storedChecksum = readOctal(header, 148, 8, 'checksum');
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  let actualChecksum = 0;
  for (const byte of copy) actualChecksum += byte;
  if (storedChecksum !== actualChecksum) fail('archive header checksum mismatch');
  const name = readString(header, 0, 100);
  const prefix = readString(header, 345, 155);
  const path = prefix ? `${prefix}/${name}` : name;
  const typeByte = header[156];
  if (typeByte !== 0x30 && typeByte !== 0x35) fail('archive contains a forbidden member type');
  const type = typeByte === 0x35 ? 'directory' : 'file';
  const normalized = type === 'directory' && path.endsWith('/') ? path.slice(0, -1) : path;
  validateRelativePath(normalized, 'archive member');
  return {
    path: normalized,
    type,
    mode: readOctal(header, 100, 8, 'mode'),
    uid: readOctal(header, 108, 8, 'uid'),
    gid: readOctal(header, 116, 8, 'gid'),
    size: readOctal(header, 124, 12, 'size'),
    mtime: readOctal(header, 136, 12, 'mtime'),
    uname: readString(header, 265, 32),
    gname: readString(header, 297, 32),
  };
}

export function inspectDeterministicTar(
  archivePath,
  expectedRoot,
  expectedEpoch,
  { extractRoot = null } = {},
) {
  requireAbsoluteExisting(archivePath, '--archive', 'file');
  let extractedReleaseRoot = null;
  const extractedDirectories = [];
  if (extractRoot !== null) {
    requirePrivateOutputRoot(extractRoot);
    if (readdirSync(extractRoot).length !== 0) {
      fail('private extraction root must be empty');
    }
    extractedReleaseRoot = resolve(extractRoot, expectedRoot);
    if (dirname(extractedReleaseRoot) !== extractRoot || existsSync(extractedReleaseRoot)) {
      fail('private extraction target must be one absent direct child');
    }
  }
  const descriptor = openSync(archivePath, 'r');
  const archiveSize = fstatSync(descriptor).size;
  const members = [];
  const seen = new Set();
  let position = 0;
  let zeroBlocks = 0;
  try {
    while (position < archiveSize) {
      if (archiveSize - position < 512) fail('archive size is not block-aligned');
      const header = readExact(descriptor, 512, position);
      position += 512;
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks === 2) break;
        continue;
      }
      if (zeroBlocks !== 0) fail('archive contains a member after a zero block');
      const member = parseHeader(header);
      if (!Number.isSafeInteger(member.mode) || member.mode < 0 || member.mode > 0o777) {
        fail('archive member mode is outside ordinary POSIX permissions');
      }
      const normalizedHeader = ustarHeader(member.path, {
        type: member.type,
        size: member.size,
        targetMode: member.mode,
      }, member.mtime);
      if (!header.equals(normalizedHeader)) fail('archive header fields are not fully normalized');
      if (member.uid !== 0 || member.gid !== 0 || member.uname !== '' || member.gname !== '') {
        fail('archive ownership fields are not normalized');
      }
      if (member.mtime !== expectedEpoch) fail('archive mtime differs from the frozen source epoch');
      if (seen.has(member.path)) fail('archive contains a duplicate member');
      seen.add(member.path);
      if (member.path !== expectedRoot && !member.path.startsWith(`${expectedRoot}/`)) {
        fail('archive member escapes the single package root');
      }
      if (member.type === 'directory' && member.size !== 0) fail('archive directory has data');
      let extractedDescriptor;
      if (extractedReleaseRoot !== null) {
        const outputPath = resolve(extractRoot, member.path);
        if (outputPath !== extractedReleaseRoot
            && !outputPath.startsWith(`${extractedReleaseRoot}${sep}`)) {
          fail('archive extraction path escapes the private release root');
        }
        if (member.type === 'directory') {
          mkdirSync(outputPath, { mode: 0o700, recursive: false });
          extractedDirectories.push({ path: outputPath, mode: member.mode });
        } else {
          extractedDescriptor = openSync(
            outputPath,
            constants.O_WRONLY
              | constants.O_CREAT
              | constants.O_EXCL
              | (constants.O_NOFOLLOW ?? 0),
            0o600,
          );
        }
      }
      let digest = null;
      let retained = null;
      if (member.type === 'file') {
        const hash = createHash('sha256');
        const shouldRetain = member.path.endsWith('/release.json')
          || member.path.endsWith('/artifact-manifest.json')
          || member.path.endsWith('.node');
        const chunks = [];
        let remaining = member.size;
        while (remaining > 0) {
          const length = Math.min(remaining, 1024 * 1024);
          const chunk = readExact(descriptor, length, position);
          position += length;
          remaining -= length;
          hash.update(chunk);
          if (shouldRetain) chunks.push(chunk);
          if (extractedDescriptor !== undefined) writeAll(extractedDescriptor, chunk);
        }
        digest = hash.digest('hex');
        if (shouldRetain) retained = Buffer.concat(chunks);
        if (extractedDescriptor !== undefined) {
          fchmodSync(extractedDescriptor, member.mode);
          closeSync(extractedDescriptor);
          extractedDescriptor = undefined;
        }
      }
      const padding = (512 - (member.size % 512)) % 512;
      if (padding > 0) {
        const bytes = readExact(descriptor, padding, position);
        position += padding;
        if (!bytes.every((byte) => byte === 0)) fail('archive member padding is non-zero');
      }
      members.push({ ...member, sha256: digest, retained });
    }
    if (zeroBlocks !== 2) fail('archive is missing the canonical two-block terminator');
    if (position !== archiveSize) fail('archive contains trailing data after its terminator');
  } finally {
    closeSync(descriptor);
  }
  const sorted = [...members].sort((left, right) => sortPaths(left.path, right.path));
  if (canonicalJson(members.map(({ retained, ...entry }) => entry))
      !== canonicalJson(sorted.map(({ retained, ...entry }) => entry))) {
    fail('archive members are not in bytewise path order');
  }
  const byPath = new Map(members.map((member) => [member.path, member]));
  if (members[0]?.path !== expectedRoot || members[0]?.type !== 'directory') {
    fail('archive must begin with its single explicit package-root directory');
  }
  for (const member of members) {
    const components = member.path.split('/');
    for (let index = 1; index < components.length; index += 1) {
      const ancestor = byPath.get(components.slice(0, index).join('/'));
      if (!ancestor) fail('archive omits an explicit parent directory');
      if (ancestor.type !== 'directory') fail('archive contains a file/directory prefix collision');
    }
  }
  if (extractedReleaseRoot !== null) {
    for (const directory of extractedDirectories.reverse()) {
      chmodSync(directory.path, directory.mode);
    }
    if (realpathSync(extractedReleaseRoot) !== extractedReleaseRoot) {
      fail('private extracted release root is not physically canonical');
    }
  }
  return Object.freeze({ members, archiveSize, extractedReleaseRoot });
}

export function inspectElfBytes(bytes, expectedArch, label = 'native addon') {
  if (bytes.length < 64
      || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1) {
    fail(`native addon is not little-endian ELF64: ${label}`);
  }
  if (bytes.readUInt16LE(16) !== 3 || bytes.readUInt32LE(20) !== 1
      || bytes.readUInt16LE(52) !== 64 || bytes.readUInt16LE(54) !== 56) {
    fail(`native addon is not a version-1 ELF64 shared object: ${label}`);
  }
  const machine = bytes.readUInt16LE(18);
  const expectedMachine = expectedArch === 'x64' ? 0x3e : expectedArch === 'arm64' ? 0xb7 : null;
  if (expectedMachine === null || machine !== expectedMachine) {
    fail(`native addon architecture differs from ${expectedArch}: ${label}`);
  }
  const programOffset = Number(bytes.readBigUInt64LE(32));
  const programCount = bytes.readUInt16LE(56);
  const programBytes = 56 * programCount;
  if (!Number.isSafeInteger(programOffset) || programOffset < 64 || programCount < 2
      || programOffset + programBytes > bytes.length) {
    fail(`native addon program-header table is incomplete: ${label}`);
  }
  const loads = [];
  const dynamicSegments = [];
  for (let index = 0; index < programCount; index += 1) {
    const offset = programOffset + (index * 56);
    const type = bytes.readUInt32LE(offset);
    if (type !== 1 && type !== 2) continue;
    const flags = bytes.readUInt32LE(offset + 4);
    const fileOffset = Number(bytes.readBigUInt64LE(offset + 8));
    const virtualAddress = Number(bytes.readBigUInt64LE(offset + 16));
    const fileSize = Number(bytes.readBigUInt64LE(offset + 32));
    const memorySize = Number(bytes.readBigUInt64LE(offset + 40));
    const alignment = Number(bytes.readBigUInt64LE(offset + 48));
    const values = [fileOffset, virtualAddress, fileSize, memorySize, alignment];
    if (values.some((value) => !Number.isSafeInteger(value))
        || fileSize === 0 || memorySize < fileSize
        || fileOffset > bytes.length - fileSize
        || virtualAddress > Number.MAX_SAFE_INTEGER - memorySize) {
      fail(`native addon has an invalid load/dynamic segment: ${label}`);
    }
    if (alignment > 1
        && ((alignment & (alignment - 1)) !== 0
          || (fileOffset % alignment) !== (virtualAddress % alignment))) {
      fail(`native addon has invalid segment alignment: ${label}`);
    }
    const segment = {
      flags,
      fileOffset,
      virtualAddress,
      fileSize,
      memorySize,
    };
    if (type === 1) loads.push(segment);
    if (type === 2) {
      if (fileSize < 16 || fileSize % 16 !== 0) {
        fail(`native addon dynamic segment is incomplete: ${label}`);
      }
      dynamicSegments.push(segment);
    }
  }
  if (loads.length === 0 || dynamicSegments.length !== 1
      || !loads.some((segment) => (segment.flags & 0x1) !== 0)) {
    fail(`native addon lacks executable load or unique dynamic segment: ${label}`);
  }
  const containsVirtualFileRange = (address, size) => loads.some((segment) => (
    address >= segment.virtualAddress
    && address <= Number.MAX_SAFE_INTEGER - size
    && address + size <= segment.virtualAddress + segment.fileSize
  ));
  const dynamic = dynamicSegments[0];
  const mappedDynamicLoad = loads.find((segment) => (
    dynamic.fileOffset >= segment.fileOffset
    && dynamic.fileOffset + dynamic.fileSize <= segment.fileOffset + segment.fileSize
    && dynamic.virtualAddress >= segment.virtualAddress
    && dynamic.virtualAddress + dynamic.fileSize <= segment.virtualAddress + segment.fileSize
    && dynamic.fileOffset - segment.fileOffset
      === dynamic.virtualAddress - segment.virtualAddress
  ));
  if (!mappedDynamicLoad) {
    fail(`native addon dynamic segment lacks one coherent load mapping: ${label}`);
  }
  const dynamicValues = new Map();
  let terminated = false;
  for (let offset = dynamic.fileOffset;
    offset < dynamic.fileOffset + dynamic.fileSize;
    offset += 16) {
    const tag = Number(bytes.readBigInt64LE(offset));
    const value = Number(bytes.readBigUInt64LE(offset + 8));
    if (!Number.isSafeInteger(tag) || !Number.isSafeInteger(value)) {
      fail(`native addon dynamic entry is not safely representable: ${label}`);
    }
    if (tag === 0) {
      terminated = true;
      break;
    }
    if (!dynamicValues.has(tag)) dynamicValues.set(tag, value);
  }
  if (!terminated) fail(`native addon dynamic table lacks DT_NULL: ${label}`);
  const stringTable = dynamicValues.get(5);
  const symbolTable = dynamicValues.get(6);
  const stringSize = dynamicValues.get(10);
  const symbolEntrySize = dynamicValues.get(11);
  if (!Number.isSafeInteger(stringTable) || !Number.isSafeInteger(symbolTable)
      || !Number.isSafeInteger(stringSize) || stringSize <= 0
      || symbolEntrySize !== 24
      || !containsVirtualFileRange(stringTable, stringSize)
      || !containsVirtualFileRange(symbolTable, symbolEntrySize)) {
    fail(`native addon dynamic string/symbol tables are invalid: ${label}`);
  }
}

export function inspectElf(path, expectedArch) {
  const descriptor = openSync(path, 'r');
  let bytes;
  try {
    const size = fstatSync(descriptor).size;
    bytes = readExact(descriptor, size, 0);
  } finally {
    closeSync(descriptor);
  }
  inspectElfBytes(bytes, expectedArch, basename(path));
}

export function validateReleaseInput(releaseRoot, binding, {
  expectedBuildState = 'SOURCE_BUILD_VERIFIED_NOT_INSTALLED',
} = {}) {
  requireAbsoluteExisting(releaseRoot, '--release-root');
  const releasePath = resolve(releaseRoot, 'release.json');
  const release = readJson(releasePath, 'release input');
  requireExactKeys(release, [
    'schema', 'inputSha', 'sourceTree', 'sourceDateEpoch', 'entrypoint',
    'target', 'toolchain', 'nativeAddons', 'buildState',
  ], 'release input');
  if (release.schema !== RELEASE_INPUT_SCHEMA || release.inputSha !== binding.inputSha
      || release.sourceTree !== binding.sourceTree || release.sourceDateEpoch !== binding.sourceDateEpoch) {
    fail('release input does not match the frozen source');
  }
  if (release.entrypoint !== 'server/dist/index.js'
      || release.buildState !== expectedBuildState) {
    fail('release input state or entrypoint is invalid');
  }
  requireExactKeys(release.target, ['platform', 'arch'], 'release target');
  if (release.target.platform !== 'linux' || !['x64', 'arm64'].includes(release.target.arch)) {
    fail('release target must be Linux x64 or arm64');
  }
  requireExactKeys(release.toolchain, ['nodeVersion', 'nodeMajor', 'nodeAbi', 'npmVersion'], 'release toolchain');
  if (release.toolchain.nodeMajor !== 22 || !/^v22\.[0-9]+\.[0-9]+$/.test(release.toolchain.nodeVersion)
      || !/^[0-9]+$/.test(release.toolchain.nodeAbi) || release.toolchain.npmVersion !== '10.9.8') {
    fail('release toolchain is outside the frozen Node 22/npm 10.9.8 contract');
  }
  if (!Array.isArray(release.nativeAddons)) fail('nativeAddons must be an array');
  const declaredNativePaths = [];
  for (const addon of release.nativeAddons) {
    requireExactKeys(addon, ['path', 'format', 'arch', 'sha256'], 'native addon');
    validateRelativePath(addon.path, 'native addon');
    if (addon.format !== 'ELF64_LE' || addon.arch !== release.target.arch || !SHA256_RE.test(addon.sha256)) {
      fail('native addon identity is invalid');
    }
    const absolute = resolve(releaseRoot, addon.path);
    if (relative(releaseRoot, absolute).startsWith(`..${sep}`)) fail('native addon escapes release root');
    requireAbsoluteExisting(absolute, 'native addon', 'file');
    inspectElf(absolute, addon.arch);
    if (sha256File(absolute) !== addon.sha256) fail('native addon digest mismatch');
    declaredNativePaths.push(addon.path);
  }
  const packagedNativePaths = listTypedTree(releaseRoot)
    .filter((entry) => entry.type === 'file' && entry.path.endsWith('.node'))
    .map((entry) => entry.path);
  if (packagedNativePaths.length === 0
      || canonicalJson(declaredNativePaths) !== canonicalJson(packagedNativePaths)) {
    fail('nativeAddons must exactly enumerate every packaged .node file in bytewise path order');
  }
  requireAbsoluteExisting(resolve(releaseRoot, release.entrypoint), 'release entrypoint', 'file');
  const artifact = verifyArtifactManifest(releaseRoot, binding);
  return Object.freeze({ release, artifact });
}

export function assertTargetModePlan(entries) {
  for (const entry of entries) {
    const mode = entry.targetMode;
    const expectedMode = entry.type === 'directory'
      ? TARGET_MODES.directory
      : (entry.sourceMode & 0o111) !== 0
        ? TARGET_MODES.executable
        : TARGET_MODES.file;
    if (mode !== expectedMode) {
      fail(`target mode is not exactly derived from source type/mode for ${entry.path || '<root>'}`);
    }
    if ((mode & 0o007) !== 0 || (mode & 0o222) !== 0 || (mode & 0o7000) !== 0) {
      fail(`unsafe target mode for ${entry.path || '<root>'}`);
    }
    if (entry.type === 'directory' && (mode & 0o050) !== 0o050) {
      fail(`service group cannot read/traverse ${entry.path || '<root>'}`);
    }
    if (entry.type === 'file' && (mode & 0o040) !== 0o040) {
      fail(`service group cannot read ${entry.path}`);
    }
    if (entry.type === 'file' && (entry.sourceMode & 0o111) !== 0 && (mode & 0o010) !== 0o010) {
      fail(`service group cannot execute ${entry.path}`);
    }
  }
}

const I00_RELEASE_KEYS = Object.freeze([
  'releaseId', 'gitSha', 'testedSha', 'builtAtUtc', 'schemaVersion', 'rollbackBarrier',
  'rollbackFloor', 'compatibilitySource', 'compatibilitySourceSha256',
  'configRevision', 'modelRevision', 'testedReceipt', 'testedReceiptSha256', 'acceptanceEvidence',
  'activationState', 'sourceTree', 'sourceVerification', 'packageLockSha256',
  'runtimeDepsDigestSha256', 'serverDistDigestSha256', 'webDistDigestSha256',
  'runtimeDependencies', 'l15OpsProvenance', 'buildAttestation',
]);

export function inspectI00ReleaseTree(releaseRoot, expectedInputSha, {
  allowSimulation = false,
  expectedSourceTree = null,
} = {}) {
  requireAbsoluteExisting(releaseRoot, '--release-root');
  if (!SHA_RE.test(expectedInputSha)) fail('expected I00 input SHA must be a full lowercase Git SHA');
  if (basename(releaseRoot) !== `i00-${expectedInputSha}`) {
    fail('I00 release root name must be keyed by the exact input SHA');
  }
  const rootMode = lstatSync(releaseRoot).mode & 0o777;
  if (rootMode !== 0o700) fail('assembled I00 release root must retain mode 0700');

  const releasePath = resolve(releaseRoot, 'release.json');
  const artifactPath = resolve(releaseRoot, 'artifact-manifest.json');
  requireAbsoluteExisting(releasePath, 'I00 release.json', 'file');
  requireAbsoluteExisting(artifactPath, 'I00 artifact-manifest.json', 'file');
  const release = readJson(releasePath, 'I00 release.json');
  const artifactManifest = readJson(artifactPath, 'I00 artifact-manifest.json');
  requireExactKeys(release, I00_RELEASE_KEYS, 'I00 release.json');
  requireExactKeys(artifactManifest, [
    'schemaVersion', 'releaseId', 'testedSha', 'testedBuildOutputs',
    'acceptanceEvidence', 'l15OpsProvenance', 'ledgerCompatibility',
    'buildAttestation', 'files',
  ], 'I00 artifact manifest');
  if (release.releaseId !== `i00-${expectedInputSha}`
      || release.gitSha !== expectedInputSha
      || release.testedSha !== expectedInputSha
      || artifactManifest.releaseId !== release.releaseId
      || artifactManifest.testedSha !== expectedInputSha
      || release.activationState !== 'NOT_DEPLOYED'
      || release.runtimeDependencies !== 'BUNDLED_PREBUILT') {
    fail('I00 release identity or activation state is invalid');
  }
  if (!SHA_RE.test(release.sourceTree)
      || (expectedSourceTree !== null && release.sourceTree !== expectedSourceTree)) {
    fail('I00 release source tree differs from the frozen source binding');
  }
  if (allowSimulation) {
    if (release.sourceVerification !== 'SIMULATION_ONLY'
        || canonicalJson(release.buildAttestation)
          !== canonicalJson({ status: 'SIMULATION_ONLY_NOT_ATTESTED' })) {
      fail('simulation I00 release is not explicitly isolated and unattested');
    }
  } else if (release.sourceVerification !== 'GIT_EXACT_CLEAN'
      || release.buildAttestation?.status !== 'VERIFIED_ED25519') {
    fail('production I00 release lacks exact source and attestation provenance');
  }

  const entries = listTypedTree(releaseRoot);
  for (const entry of entries) {
    if ((entry.sourceMode & 0o022) !== 0) {
      fail(`I00 release member is group/world writable: ${entry.path}`);
    }
  }
  const expectedFiles = entries
    .filter((entry) => entry.type === 'file' && entry.path !== 'artifact-manifest.json')
    .map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      mode: entry.sourceMode,
    }));
  if (!Array.isArray(artifactManifest.files)
      || artifactManifest.files.length !== expectedFiles.length) {
    fail('I00 artifact manifest file count is not exact');
  }
  for (const entry of artifactManifest.files) {
    requireExactKeys(entry, ['path', 'sha256', 'mode'], 'I00 artifact manifest file');
    if (typeof entry.path !== 'string' || !SHA256_RE.test(entry.sha256)
        || !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      fail('I00 artifact manifest file row is invalid');
    }
  }
  if (canonicalJson(artifactManifest.files) !== canonicalJson(expectedFiles)) {
    fail('I00 artifact manifest rows differ from exact release bytes, modes, order, or uniqueness');
  }

  return Object.freeze({
    release,
    artifactManifest,
    artifactManifestSha256: sha256File(artifactPath),
    releaseJsonSha256: sha256File(releasePath),
    rootMode,
    entries: entries.map((entry) => Object.freeze({
      ...entry,
      targetMode: entry.sourceMode,
    })),
  });
}

export function runTrustedI00Validator({
  releaseRoot,
  expectedInputSha,
  allowSimulation = false,
  trustedBuildPublicKey = null,
}) {
  requireAbsoluteExisting(releaseRoot, '--release-root');
  if (!SHA_RE.test(expectedInputSha)) fail('expected validator input SHA must be a full lowercase Git SHA');
  if (allowSimulation) {
    if (trustedBuildPublicKey !== null) {
      fail('simulation I00 validation cannot accept a trusted build key');
    }
  } else {
    requireAbsoluteExisting(trustedBuildPublicKey, '--trusted-build-public-key', 'file');
    const trustedKeyStat = lstatSync(trustedBuildPublicKey);
    if (trustedKeyStat.nlink !== 1 || (trustedKeyStat.mode & 0o022) !== 0) {
      fail('trusted build public key must be single-link and not group/world writable');
    }
    if (trustedBuildPublicKey === releaseRoot
        || trustedBuildPublicKey.startsWith(`${releaseRoot}${sep}`)) {
      fail('trusted build public key must be external to the I00 release tree');
    }
  }
  const validator = requireAbsoluteExisting(
    resolve(import.meta.dirname, '../../i00/bin/validate-release.mjs'),
    'trusted I00 validator',
    'file',
  );
  const validatorArgs = [
    validator,
    '--release', releaseRoot,
    '--require-exact-cohort',
  ];
  if (allowSimulation) {
    validatorArgs.push('--allow-simulation');
  } else {
    validatorArgs.push('--trusted-build-public-key', trustedBuildPublicKey);
  }
  const result = spawnSync(process.execPath, validatorArgs, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: '/usr/bin:/bin:/usr/local/bin',
      LC_ALL: 'C',
      LANG: 'C',
    },
  });
  if (result.status !== 0) {
    fail(`trusted I00 validator rejected the release: ${String(result.stderr).trim() || `exit ${result.status ?? 'unknown'}`}`);
  }
  let receipt;
  try {
    receipt = JSON.parse(result.stdout.trim());
  } catch {
    fail('trusted I00 validator did not return one JSON receipt');
  }
  if (receipt.status !== 'RELEASE_VALID_NOT_DEPLOYED'
      || receipt.releaseId !== `i00-${expectedInputSha}`
      || receipt.testedSha !== expectedInputSha
      || receipt.validatorCohortMode !== 'EXACT_TRUSTED_COHORT'
      || !SHA256_RE.test(receipt.artifactManifestSha256)
      || !Number.isSafeInteger(receipt.fileCount)
      || receipt.fileCount <= 0) {
    fail('trusted I00 validator receipt is not exact');
  }
  return Object.freeze(receipt);
}

export function writeCreateOnly(path, bytes, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: false });
  writeFileSync(path, bytes, { flag: 'wx', mode });
}
