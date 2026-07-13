import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { sha256File } from './lib.mjs';

const MARKER = '.ip-ops-i00-simulation-root.json';
const MANIFEST = '.ip-ops-i00-simulation-commands.json';

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export function createSimulationRoot(input) {
  const temp = realpathSync(tmpdir());
  const inputAbsolute = resolve(input);
  const parent = realpathSync(dirname(inputAbsolute));
  const requested = resolve(parent, basename(inputAbsolute));
  if (!inside(temp, requested) || !basename(requested).startsWith('ip-ops-i00-sim-')) {
    throw new Error('simulation root must be a new ip-ops-i00-sim-* directory below the OS temporary directory');
  }
  if (existsSync(requested)) throw new Error('simulation root must not already exist');
  if (!inside(temp, parent) && parent !== temp) throw new Error('simulation root parent escaped the OS temporary directory');
  mkdirSync(requested, { mode: 0o700 });
  chmodSync(requested, 0o700);
  const root = realpathSync(requested);
  writeFileSync(resolve(root, MARKER), `${JSON.stringify({
    schemaVersion: 1,
    status: 'I00_FAKE_SERVICES_ONLY',
    root,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
  }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return root;
}

export function validateSimulationRoot(input) {
  const root = realpathSync(resolve(input));
  const temp = realpathSync(tmpdir());
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !inside(temp, root)
      || !basename(root).startsWith('ip-ops-i00-sim-') || (rootStat.mode & 0o077) !== 0) {
    throw new Error('simulation root is not a private, real ip-ops-i00-sim-* directory below the OS temporary directory');
  }
  const markerPath = resolve(root, MARKER);
  const markerStat = lstatSync(markerPath);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (markerStat.isSymbolicLink() || !markerStat.isFile() || (markerStat.mode & 0o077) !== 0
      || marker.schemaVersion !== 1 || marker.status !== 'I00_FAKE_SERVICES_ONLY'
      || marker.root !== root || marker.uid !== uid
      || (uid !== null && (rootStat.uid !== uid || markerStat.uid !== uid))) {
    throw new Error('simulation root marker is invalid');
  }
  return root;
}

function inspectExecutable(root, input) {
  const requested = resolve(input);
  const directStat = lstatSync(requested);
  if (directStat.isSymbolicLink() || !directStat.isFile() || (directStat.mode & 0o111) === 0) {
    throw new Error('simulation command must be a non-symlink executable regular file');
  }
  const command = realpathSync(requested);
  if (!inside(root, command)) throw new Error('simulation command must be below the marked simulation root');
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if ((directStat.mode & 0o022) !== 0 || (uid !== null && directStat.uid !== uid)) {
    throw new Error('simulation command must be owner-controlled and not group/world writable');
  }
  const body = readFileSync(command, 'utf8');
  if (body.length > 64 * 1024 || body.includes('\0')) throw new Error('simulation command is not a bounded text fixture');
  const expectedByName = {
    'systemctl.sh': `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${root}/systemctl.log"\nexit 0\n`,
    'curl.sh': '#!/usr/bin/env bash\nexit 0\n',
    'probe.sh': "#!/usr/bin/env bash\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n",
    'exposure.sh': "#!/usr/bin/env bash\nprintf 'NONE\\n'\n",
    'alert.sh': '#!/usr/bin/env bash\nexit 0\n',
    'aws-fixture.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncase "$*" in\n  *"secretsmanager get-secret-value"*"--secret-id arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd"*)\n    printf \'{"BINANCE_API_KEY":"FAKE_API_KEY_123456","BINANCE_API_SECRET":"FAKE_SECRET_123456"}\\n\'\n    ;;\n  *) exit 9 ;;\nesac\n',
  };
  const fixtureType = basename(command);
  if (!(fixtureType in expectedByName) || body !== expectedByName[fixtureType]) {
    throw new Error('simulation command is not one exact built-in inert fixture');
  }
  return { path: command, sha256: sha256File(command), mode: directStat.mode & 0o777, fixtureType };
}

export function sealSimulationCommands(rootInput, commands) {
  const root = validateSimulationRoot(rootInput);
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('at least one simulation command is required');
  const entries = commands.map((command) => inspectExecutable(root, command));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error('simulation command list contains duplicates');
  const manifestPath = resolve(root, MANIFEST);
  if (existsSync(manifestPath)) throw new Error('simulation command manifest already exists');
  writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, root, commands: entries }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return manifestPath;
}

export function verifySimulationCommand(rootInput, commandInput) {
  const root = validateSimulationRoot(rootInput);
  const actual = inspectExecutable(root, commandInput);
  const manifestPath = resolve(root, MANIFEST);
  const manifestStat = lstatSync(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || (manifestStat.mode & 0o077) !== 0
      || manifest.schemaVersion !== 1 || manifest.root !== root || !Array.isArray(manifest.commands)) {
    throw new Error('simulation command manifest is invalid');
  }
  const expected = manifest.commands.find((entry) => entry?.path === actual.path);
  if (!expected || expected.sha256 !== actual.sha256 || expected.mode !== actual.mode) {
    throw new Error('simulation command is unsealed or changed after review');
  }
  return actual.path;
}

export function isWithinSimulationRoot(rootInput, candidateInput) {
  const root = validateSimulationRoot(rootInput);
  const absolute = resolve(candidateInput);
  let cursor = absolute;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('path has no existing ancestor');
    cursor = parent;
  }
  const ancestor = realpathSync(cursor);
  return ancestor === root || inside(root, ancestor);
}
