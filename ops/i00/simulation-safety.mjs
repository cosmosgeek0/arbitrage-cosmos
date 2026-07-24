import {
  chmodSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { sha256File } from './lib.mjs';

const MARKER = '.ip-ops-i00-simulation-root.json';
const MANIFEST = '.ip-ops-i00-simulation-commands.json';
const FIXED_TEMP_ROOT = '/tmp';
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

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function sameNamedObject(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function openHeldRoot(root, expected, label) {
  const descriptor = openSync(
    root,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  const opened = fstatSync(descriptor, { bigint: true });
  const named = lstatSync(root, { bigint: true });
  if (!opened.isDirectory() || named.isSymbolicLink()
      || !sameNamedObject(opened, named)
      || (expected !== null && !sameNamedObject(opened, expected))
      || realpathSync(root) !== root) {
    closeSync(descriptor);
    throw new Error(`${label} identity changed`);
  }
  return Object.freeze({ descriptor, identity: opened, root, label });
}

function recheckHeldRoot(held) {
  const opened = fstatSync(held.descriptor, { bigint: true });
  const named = lstatSync(held.root, { bigint: true });
  if (!sameNamedObject(opened, held.identity) || named.isSymbolicLink()
      || !sameNamedObject(opened, named) || realpathSync(held.root) !== held.root) {
    throw new Error(`${held.label} identity changed`);
  }
}

function readHeldRootJson(held, name, label) {
  const path = resolve(held.root, name);
  const anchored = process.platform === 'linux'
    ? `/proc/self/fd/${held.descriptor}/${name}`
    : path;
  let descriptor;
  try {
    const namedBefore = lstatSync(path, { bigint: true });
    descriptor = openSync(
      anchored,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n
        || namedBefore.isSymbolicLink() || !sameNamedObject(openedBefore, namedBefore)
        || openedBefore.size <= 0n || openedBefore.size > 1024n * 1024n) {
      throw new Error(`${label} is not one stable private regular file`);
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const namedAfter = lstatSync(path, { bigint: true });
    if (!sameNamedObject(openedBefore, openedAfter)
        || openedBefore.size !== openedAfter.size
        || openedBefore.mtimeNs !== openedAfter.mtimeNs
        || !sameNamedObject(openedAfter, namedAfter)) {
      throw new Error(`${label} identity changed while reading`);
    }
    recheckHeldRoot(held);
    return Object.freeze({ bytes, stat: openedAfter, path });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function physicalTempRoot() {
  const temp = realpathSync(FIXED_TEMP_ROOT);
  const stat = lstatSync(temp);
  const mode = stat.mode & 0o7777;
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0
      || ((mode & 0o022) !== 0 && (mode & 0o1000) === 0)) {
    throw new Error('fixed physical /tmp root is unavailable or unsafe');
  }
  return temp;
}

function canonicalPotentialPath(input) {
  let cursor = input;
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
        if (parent === cursor) throw new Error('protected root is unreadable');
        suffix.unshift(basename(cursor));
        cursor = parent;
        continue;
      }
      if (suffix.length > 0 && !statSync(ancestor).isDirectory()) {
        throw new Error('protected root existing ancestor is not a directory');
      }
      return resolve(ancestor, ...suffix);
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('protected root has no existing ancestor');
    const leaf = basename(cursor);
    if (!leaf || leaf === '.' || leaf === '..') {
      throw new Error('protected root has an unsafe missing component');
    }
    suffix.unshift(leaf);
    cursor = parent;
  }
}

function requireProtectedUnionDisjoint(root) {
  for (const input of PROTECTED_MUTATION_ROOTS) {
    const protectedRoot = canonicalPotentialPath(input);
    if (root === protectedRoot || inside(root, protectedRoot)
        || inside(protectedRoot, root)) {
      throw new Error('simulation root intersects the protected production root union');
    }
  }
}

export function createSimulationRoot(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || resolve(input) !== input) {
    throw new Error('simulation root create path must be absolute and lexically canonical');
  }
  const temp = physicalTempRoot();
  const inputAbsolute = input;
  const parent = realpathSync(dirname(inputAbsolute));
  const requested = resolve(parent, basename(inputAbsolute));
  if (!inside(temp, requested) || !basename(requested).startsWith('ip-ops-i00-sim-')) {
    throw new Error('simulation root must be a new ip-ops-i00-sim-* directory below the OS temporary directory');
  }
  if (existsSync(requested)) throw new Error('simulation root must not already exist');
  if (!inside(temp, parent) && parent !== temp) throw new Error('simulation root parent escaped the OS temporary directory');
  requireProtectedUnionDisjoint(requested);
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
  if (typeof input !== 'string' || !isAbsolute(input) || resolve(input) !== input) {
    throw new Error('simulation root path must be absolute and lexically canonical');
  }
  const root = realpathSync(input);
  if (root !== input) {
    throw new Error('simulation root path must already be physical and canonical');
  }
  const temp = physicalTempRoot();
  const rootStat = lstatSync(root, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !inside(temp, root)
      || !basename(root).startsWith('ip-ops-i00-sim-') || (rootStat.mode & 0o077n) !== 0n) {
    throw new Error('simulation root is not a private, real ip-ops-i00-sim-* directory below the OS temporary directory');
  }
  requireProtectedUnionDisjoint(root);
  const held = openHeldRoot(root, rootStat, 'simulation root');
  try {
    const markerEvidence = readHeldRootJson(held, MARKER, 'simulation root marker');
    let marker;
    try {
      marker = JSON.parse(markerEvidence.bytes);
    } catch {
      throw new Error('simulation root marker is invalid');
    }
    const markerStat = markerEvidence.stat;
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if ((markerStat.mode & 0o077n) !== 0n
        || marker.schemaVersion !== 1 || marker.status !== 'I00_FAKE_SERVICES_ONLY'
        || marker.root !== root || marker.uid !== uid
        || (uid !== null
          && (rootStat.uid !== BigInt(uid) || markerStat.uid !== BigInt(uid)))) {
      throw new Error('simulation root marker is invalid');
    }
  } finally {
    closeSync(held.descriptor);
  }
  return root;
}

function inspectExecutable(root, input) {
  if (typeof input !== 'string' || !isAbsolute(input) || resolve(input) !== input) {
    throw new Error('simulation command path must be absolute and lexically canonical');
  }
  const requested = input;
  const directStat = lstatSync(requested);
  if (directStat.isSymbolicLink() || !directStat.isFile() || (directStat.mode & 0o111) === 0) {
    throw new Error('simulation command must be a non-symlink executable regular file');
  }
  const command = realpathSync(requested);
  if (command !== requested) {
    throw new Error('simulation command path must already be physical and canonical');
  }
  if (!inside(root, command)) throw new Error('simulation command must be below the marked simulation root');
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if ((directStat.mode & 0o022) !== 0 || (uid !== null && directStat.uid !== uid)) {
    throw new Error('simulation command must be owner-controlled and not group/world writable');
  }
  const fixtureType = basename(command);
  const trustedBinaryByName = {
    node: realpathSync(process.execPath),
    bash: realpathSync('/bin/bash'),
    env: realpathSync('/usr/bin/env'),
  };
  if (fixtureType in trustedBinaryByName) {
    const trusted = trustedBinaryByName[fixtureType];
    const trustedStat = lstatSync(trusted);
    if (!trustedStat.isFile()
        || directStat.size !== trustedStat.size
        || sha256File(command) !== sha256File(trusted)) {
      throw new Error('simulation runtime command differs from the exact trusted executable');
    }
    return {
      path: command,
      sha256: sha256File(command),
      mode: directStat.mode & 0o777,
      fixtureType,
    };
  }
  const body = readFileSync(command, 'utf8');
  if (body.length > 64 * 1024 || body.includes('\0')) throw new Error('simulation command is not a bounded text fixture');
  const awsFixture = "#!/usr/bin/env bash\nset -euo pipefail\ncase \"$(basename \"$0\"):$*\" in\n  aws-wrong-role.sh:*\"sts get-caller-identity\"*)\n    printf '{\"Account\":\"123456789012\",\"Arn\":\"arn:aws:sts::123456789012:assumed-role/other-instance-role/session-001\",\"UserId\":\"ROLEID:session-001\"}\\n'\n    ;;\n  *:*\"sts get-caller-identity\"*)\n    printf '{\"Account\":\"123456789012\",\"Arn\":\"arn:aws:sts::123456789012:assumed-role/cosmos-instance-role/session-001\",\"UserId\":\"ROLEID:session-001\"}\\n'\n    ;;\n  *:*\"secretsmanager get-secret-value\"*\"--secret-id arn:aws:secretsmanager:ap-south-1:123456789012:secret:cosmos/read-only-Ab12Cd\"*)\n    printf '{\"BINANCE_API_KEY\":\"FAKE_API_KEY_123456\",\"BINANCE_API_SECRET\":\"FAKE_SECRET_123456\"}\\n'\n    ;;\n  *) exit 9 ;;\nesac\n";
  const systemctlFixture = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${root}/systemctl.log"
case "$1:$2" in
  show:cosmos-app.service)
    [ "$3" = --no-pager ] && [ "$4" = --all ] || exit 9
    shift 4
    [ "$#" -gt 0 ] || exit 9
    for argument in "$@"; do
      case "$argument" in --property=*) ;; *) exit 9 ;; esac
    done
    runtime_env=
    IFS= read -r runtime_env < "${root}/app-runtime-path"
    [ -n "$runtime_env" ] || exit 9
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        EnvironmentFiles=)
          printf 'EnvironmentFiles=%s (ignore_errors=no)\\n' "$runtime_env"
          ;;
        ExecStart=)
          printf 'ExecStart={ path=${root}/fakes/env ; argv[]=${root}/fakes/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases ${root}/fakes/node server/dist/index.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n'
          ;;
        ExecStartEx=)
          printf 'ExecStartEx={ path=${root}/fakes/env ; argv[]=${root}/fakes/env DATA_DIR_LOGICAL_LEASE_ROOT=/run/cosmos-app/data-dir-leases ${root}/fakes/node server/dist/index.js ; flags= ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\\n'
          ;;
        *) printf '%s\\n' "$line" ;;
      esac
    done < "${root}/systemctl-show"
    ;;
  restart:cosmos-app.service)
    [ "$#" -eq 2 ] || exit 9
    ;;
  *) exit 9 ;;
esac
`;
  const expectedByName = {
    'systemctl.sh': systemctlFixture,
    systemctl: systemctlFixture,
    'systemctl-inactive.sh': `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${root}/systemctl.log"\n[ "$*" = 'is-active cosmos-app.service' ] || exit 9\nprintf 'inactive\\n'\nexit 3\n`,
    'systemctl-inactive': `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${root}/systemctl.log"\n[ "$*" = 'is-active cosmos-app.service' ] || exit 9\nprintf 'inactive\\n'\nexit 3\n`,
    'curl.sh': '#!/usr/bin/env bash\nexit 0\n',
    curl: '#!/usr/bin/env bash\nexit 0\n',
    'probe.sh': "#!/usr/bin/env bash\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n",
    probe: "#!/usr/bin/env bash\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n",
    'exposure.sh': "#!/usr/bin/env bash\nprintf 'NONE\\n'\n",
    exposure: "#!/usr/bin/env bash\nprintf 'NONE\\n'\n",
    'alert.sh': '#!/usr/bin/env bash\nexit 0\n',
    alert: '#!/usr/bin/env bash\nexit 0\n',
    'aws-fixture.sh': awsFixture,
    'aws-wrong-role.sh': awsFixture,
  };
  if (!(fixtureType in expectedByName) || body !== expectedByName[fixtureType]) {
    throw new Error('simulation command is not one exact built-in inert fixture');
  }
  return { path: command, sha256: sha256File(command), mode: directStat.mode & 0o777, fixtureType };
}

export function sealSimulationCommands(rootInput, commands) {
  const root = validateSimulationRoot(rootInput);
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('at least one simulation command is required');
  const held = openHeldRoot(
    root,
    lstatSync(root, { bigint: true }),
    'simulation root during command sealing',
  );
  try {
    const entries = commands.map((command) => {
      recheckHeldRoot(held);
      const entry = inspectExecutable(root, command);
      recheckHeldRoot(held);
      return entry;
    });
    if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
      throw new Error('simulation command list contains duplicates');
    }
    const manifestPath = resolve(root, MANIFEST);
    if (lstatSync(manifestPath, { throwIfNoEntry: false }) !== undefined) {
      throw new Error('simulation command manifest already exists');
    }
    recheckHeldRoot(held);
    const anchoredManifest = process.platform === 'linux'
      ? `/proc/self/fd/${held.descriptor}/${MANIFEST}`
      : manifestPath;
    writeFileSync(
      anchoredManifest,
      `${JSON.stringify({ schemaVersion: 1, root, commands: entries }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    fsyncSync(held.descriptor);
    recheckHeldRoot(held);
    const manifest = lstatSync(manifestPath, { bigint: true });
    if (!manifest.isFile() || manifest.isSymbolicLink() || manifest.nlink !== 1n
        || (manifest.mode & 0o777n) !== 0o600n) {
      throw new Error('simulation command manifest publication identity is invalid');
    }
    return manifestPath;
  } finally {
    closeSync(held.descriptor);
  }
}

export function verifySimulationCommand(rootInput, commandInput) {
  const root = validateSimulationRoot(rootInput);
  const held = openHeldRoot(
    root,
    lstatSync(root, { bigint: true }),
    'simulation root during command verification',
  );
  try {
    const actual = inspectExecutable(root, commandInput);
    recheckHeldRoot(held);
    const manifestEvidence = readHeldRootJson(
      held,
      MANIFEST,
      'simulation command manifest',
    );
    let manifest;
    try {
      manifest = JSON.parse(manifestEvidence.bytes);
    } catch {
      throw new Error('simulation command manifest is invalid');
    }
    if ((manifestEvidence.stat.mode & 0o077n) !== 0n
        || manifest.schemaVersion !== 1 || manifest.root !== root
        || !Array.isArray(manifest.commands)) {
      throw new Error('simulation command manifest is invalid');
    }
    const expected = manifest.commands.find((entry) => entry?.path === actual.path);
    if (!expected || expected.sha256 !== actual.sha256 || expected.mode !== actual.mode) {
      throw new Error('simulation command is unsealed or changed after review');
    }
    return actual.path;
  } finally {
    closeSync(held.descriptor);
  }
}

export function isWithinSimulationRoot(rootInput, candidateInput) {
  const root = validateSimulationRoot(rootInput);
  if (typeof candidateInput !== 'string' || !isAbsolute(candidateInput)
      || resolve(candidateInput) !== candidateInput) {
    throw new Error('simulation path must be absolute and lexically canonical');
  }
  let cursor = candidateInput;
  const suffix = [];
  for (;;) {
    try {
      lstatSync(cursor);
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error('path has no existing ancestor');
      const component = basename(cursor);
      if (!component || component === '.' || component === '..') {
        throw new Error('simulation path has an unsafe missing suffix');
      }
      suffix.unshift(component);
      cursor = parent;
    }
  }
  const ancestor = realpathSync(cursor);
  if (suffix.length > 0 && !statSync(ancestor).isDirectory()) {
    throw new Error('simulation path existing ancestor is not a directory');
  }
  const canonical = resolve(ancestor, ...suffix);
  if (canonical !== candidateInput) {
    throw new Error('simulation path must already be physical and canonical');
  }
  return canonical === root || inside(root, canonical);
}
