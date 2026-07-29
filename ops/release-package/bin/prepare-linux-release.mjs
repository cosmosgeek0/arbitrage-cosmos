#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  RELEASE_INPUT_SCHEMA,
  canonicalJsonLine,
  inspectElf,
  listTypedTree,
  parseArgs,
  requireAbsoluteExisting,
  requirePrivateOutputRoot,
  resolveGit,
  runGit,
  sha256File,
  verifyFrozenSource,
  writeArtifactManifest,
} from '../lib/release-package.mjs';

function fail(message) {
  process.stderr.write(`prepare-linux-release: ${message}\n`);
  process.exit(1);
}

function run(executable, argv, cwd, env) {
  const result = spawnSync(executable, argv, {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${argv[0] || executable} failed with exit ${result.status ?? 'unknown'}`);
  }
}

function copyExact(source, destination) {
  if (!existsSync(source)) throw new Error(`release input missing ${relative(dirname(source), source)}`);
  const status = lstatSync(source);
  if (status.isSymbolicLink()) throw new Error(`release input is a symbolic link: ${source}`);
  cpSync(source, destination, {
    recursive: status.isDirectory(),
    errorOnExist: true,
    force: false,
    preserveTimestamps: false,
  });
}

function normalizeReleaseModes(root) {
  const walk = (absolute) => {
    for (const name of readdirSync(absolute)) {
      const child = join(absolute, name);
      const status = lstatSync(child);
      if (status.isSymbolicLink()) throw new Error(`release input is a symbolic link: ${child}`);
      if (status.isDirectory()) {
        chmodSync(child, 0o755);
        walk(child);
      } else if (status.isFile()) {
        chmodSync(child, (status.mode & 0o111) !== 0 ? 0o755 : 0o644);
      } else {
        throw new Error(`release input contains a special file: ${child}`);
      }
    }
  };
  chmodSync(root, 0o755);
  walk(root);
}

function findNativeAddons(root, targetArch) {
  const addons = [];
  const walk = (absolute, prefix) => {
    for (const name of readdirSync(absolute).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
      const child = join(absolute, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const status = lstatSync(child);
      if (status.isSymbolicLink()) throw new Error(`runtime dependency link was not removed: ${path}`);
      if (status.isDirectory()) {
        walk(child, path);
      } else if (status.isFile() && name.endsWith('.node')) {
        inspectElf(child, targetArch);
        addons.push({
          path,
          format: 'ELF64_LE',
          arch: targetArch,
          sha256: sha256File(child),
        });
      }
    }
  };
  walk(root, '');
  return addons;
}

try {
  // npm and archive extraction inherit the process umask. Fix it before any
  // filesystem work, then normalize the staged runtime tree explicitly below.
  process.umask(0o022);
  const args = parseArgs(process.argv.slice(2));
  for (const key of ['source-root', 'input-sha', 'output-root', 'target-arch', 'npm-cli']) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  if (!['x64', 'arm64'].includes(args['target-arch'])) {
    throw new Error('--target-arch must be x64 or arm64');
  }
  if (process.versions.node.split('.')[0] !== '22') {
    throw new Error('the release builder must run under Node 22');
  }
  const sourceRoot = requireAbsoluteExisting(args['source-root'], '--source-root');
  const outputRoot = requirePrivateOutputRoot(args['output-root']);
  const npmCli = requireAbsoluteExisting(args['npm-cli'], '--npm-cli', 'file');
  const binding = verifyFrozenSource(sourceRoot, args['input-sha']);
  const npmVersionResult = spawnSync(process.execPath, [npmCli, '--version'], {
    encoding: 'utf8',
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: 'C', LANG: 'C' },
  });
  const npmVersion = npmVersionResult.status === 0 ? npmVersionResult.stdout.trim() : '';
  if (npmVersion !== '10.9.8') throw new Error('the release builder requires npm 10.9.8');

  const destination = resolve(outputRoot, `release-input-${binding.inputSha}`);
  if (existsSync(destination)) throw new Error('create-only release input already exists');
  const privateRoot = mkdtempSync(resolve(outputRoot, `.partial-${binding.inputSha}-`));
  const exportedRoot = resolve(privateRoot, 'source');
  const stagedRoot = resolve(privateRoot, 'release');
  mkdirSync(exportedRoot, { mode: 0o700 });
  mkdirSync(stagedRoot, { mode: 0o700 });
  const sourceArchive = resolve(privateRoot, 'source.tar');

  try {
    const treeListing = runGit(sourceRoot, ['ls-tree', '-r', '-z', '--full-tree', binding.inputSha]);
    for (const record of treeListing.split('\0').filter(Boolean)) {
      const tab = record.indexOf('\t');
      if (tab < 0) throw new Error('Git tree listing is malformed');
      const [mode, type] = record.slice(0, tab).split(' ');
      if (type !== 'blob' || mode === '120000') {
        throw new Error('frozen source contains a link or unsupported Git object');
      }
    }
    const archiveResult = spawnSync(resolveGit(), [
      '-C', sourceRoot, 'archive', '--format=tar', `--output=${sourceArchive}`, binding.inputSha,
    ], {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin:/usr/local/bin',
        LC_ALL: 'C',
        LANG: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
      },
    });
    if (archiveResult.status !== 0) throw new Error('exact Git source export failed');
    const tarExecutable = realpathSync('/usr/bin/tar');
    run(tarExecutable, ['-xf', sourceArchive, '-C', exportedRoot], privateRoot, {
      PATH: '/usr/bin:/bin',
      LC_ALL: 'C',
      LANG: 'C',
    });
    rmSync(sourceArchive, { force: true });

    const packageLockBefore = sha256File(resolve(exportedRoot, 'package-lock.json'));
    const npmCache = resolve(privateRoot, 'npm-cache');
    mkdirSync(npmCache, { mode: 0o700 });
    const buildEnv = {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      LC_ALL: 'C',
      LANG: 'C',
      SOURCE_DATE_EPOCH: String(binding.sourceDateEpoch),
      npm_config_userconfig: '/dev/null',
      npm_config_cache: npmCache,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_platform: 'linux',
      npm_config_arch: args['target-arch'],
      npm_config_build_from_source: 'false',
    };
    run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], exportedRoot, buildEnv);
    run(process.execPath, [npmCli, 'run', 'typecheck'], exportedRoot, buildEnv);
    run(process.execPath, [npmCli, 'run', 'build'], exportedRoot, buildEnv);
    run(process.execPath, [npmCli, 'prune', '--omit=dev', '--no-audit', '--no-fund'], exportedRoot, buildEnv);
    if (sha256File(resolve(exportedRoot, 'package-lock.json')) !== packageLockBefore) {
      throw new Error('locked dependency build changed package-lock.json');
    }

    // npm workspace and .bin links are build conveniences, not runtime inputs.
    // Removing them makes the deployable tree link-free and keeps extraction
    // semantics independent of the target filesystem.
    rmSync(resolve(exportedRoot, 'node_modules/.bin'), { recursive: true, force: true });
    rmSync(resolve(exportedRoot, 'node_modules/@cosmos'), { recursive: true, force: true });

    for (const path of [
      'server/dist',
      'web/dist',
      'node_modules',
      'package.json',
      'package-lock.json',
      'server/package.json',
      'ops/live',
      'ops/i00',
      'ops/templates/i00',
      'ops/docs/i00',
    ]) {
      const source = resolve(exportedRoot, path);
      const destinationPath = resolve(stagedRoot, path);
      if (relative(stagedRoot, destinationPath).startsWith(`..${sep}`)) {
        throw new Error(`release path escapes staging: ${path}`);
      }
      mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
      copyExact(source, destinationPath);
    }
    normalizeReleaseModes(stagedRoot);
    const nativeAddons = findNativeAddons(stagedRoot, args['target-arch']);
    if (nativeAddons.length === 0) throw new Error('release contains no verified Linux native addon');
    listTypedTree(stagedRoot);
    const release = {
      schema: RELEASE_INPUT_SCHEMA,
      inputSha: binding.inputSha,
      sourceTree: binding.sourceTree,
      sourceDateEpoch: binding.sourceDateEpoch,
      entrypoint: 'server/dist/index.js',
      target: {
        platform: 'linux',
        arch: args['target-arch'],
      },
      toolchain: {
        nodeVersion: process.version,
        nodeMajor: 22,
        nodeAbi: process.versions.modules,
        npmVersion,
      },
      nativeAddons,
      buildState: 'SOURCE_BUILD_VERIFIED_NOT_INSTALLED',
    };
    writeFileSync(resolve(stagedRoot, 'release.json'), canonicalJsonLine(release), {
      flag: 'wx',
      mode: 0o600,
    });
    writeArtifactManifest(stagedRoot, binding);
    listTypedTree(stagedRoot);
    if (existsSync(destination)) throw new Error('release input destination appeared before publication');
    renameSync(stagedRoot, destination);
    rmSync(privateRoot, { recursive: true, force: true });
  } catch (error) {
    rmSync(privateRoot, { recursive: true, force: true });
    throw error;
  }

  const finalBinding = verifyFrozenSource(sourceRoot, args['input-sha']);
  if (finalBinding.sourceTree !== binding.sourceTree) throw new Error('source tree changed during release build');
  process.stdout.write(canonicalJsonLine({
    status: 'LINUX_RELEASE_INPUT_BUILT_NOT_INSTALLED',
    inputSha: binding.inputSha,
    sourceTree: binding.sourceTree,
    releaseRoot: destination,
    target: { platform: 'linux', arch: args['target-arch'] },
    nodeVersion: process.version,
    nodeAbi: process.versions.modules,
    npmVersion,
  }));
} catch (error) {
  fail(error.message);
}
