#!/bin/bash -p
set -euo pipefail
. "$(dirname "$0")/helpers.sh"

RUNNER="$I00_ROOT/bin/run-bound-effect.mjs"
VERIFIER="$I00_ROOT/bin/verify-authorized-effect-handoff.mjs"
EVIDENCE="$I00_ROOT/authorized-effect-evidence.mjs"
PRODUCER_TEST="$TEST_DIR/test-deployment-authorization-producers.sh"

note "runner and verifier expose one exact four-document API"
assert_success node --check "$RUNNER"
assert_success node --check "$VERIFIER"
assert_success node --input-type=module - "$VERIFIER" <<'NODE'
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[2], 'utf8');
const declaration = 'let automaticHandoffDocument = null;';
const declarationIndex = source.indexOf(declaration);
if (declarationIndex < 0
    || source.slice(0, declarationIndex).includes('automaticHandoffDocument')) {
  process.exit(1);
}
NODE
assert_success node --input-type=module - "$RUNNER" <<'NODE'
import { readFileSync } from 'node:fs';
const source = readFileSync(process.argv[2], 'utf8');
const expected = [
  "'--authorization'",
  "'--deployment-risk'",
  "'--action-preview'",
  "'--authorization-consumption'",
].join(',\n  ');
if (!source.includes(`const requiredControls = Object.freeze([\n  ${expected},\n]);`)
    || !source.includes('assert(controls.length === requiredControls.length * 2,')
    || !source.includes("assert(process.platform === 'linux',")
    || /--uid|--gid|--program-sha256|--program-identity/u.test(source)) {
  process.exit(1);
}
NODE
assert_failure_contains 'effect runner requires -- before delegated arguments' \
  node "$RUNNER"
assert_failure_contains 'effect runner control arguments are invalid' \
  node "$RUNNER" \
  --authorization relative.json \
  --deployment-risk "$TEST_TMP/risk.json" \
  --action-preview "$TEST_TMP/preview.json" \
  --authorization-consumption "$TEST_TMP/consumption.json" \
  -- /bin/false

note "class argv construction resolves only the selected class endpoints"
assert_success node --input-type=module - "$RUNNER" <<'NODE'
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';

const source = readFileSync(process.argv[2], 'utf8');
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const program = parse(source, { sourceType: 'module' }).program;
const declaration = (name) => program.body.find((node) => (
  node.type === 'VariableDeclaration'
    && node.declarations.some((entry) => entry.id?.name === name)
));
const first = declaration('scriptToken');
const last = declaration('delegatedForChild');
if (first === undefined || last === undefined || first.start >= last.end) process.exit(1);
const body = source.slice(first.start, last.end);
const build = new Function(
  'Object',
  'actionClass',
  'action',
  'endpoint',
  'risk',
  'delegatedScript',
  'delegatedBootstrapDescriptor',
  'primaryParentPrelude',
  'basename',
  `${body}\nreturn { delegatedForChildBuilders, delegatedForChild };`,
);
const cases = Object.freeze({
  OPS_BUNDLE_INSTALL: ['release-path', 'destination'],
  SERVICE_RELEASE_SWITCH: ['release-path'],
  SERVICE_ROLLBACK: ['release-id'],
  BACKUP_CREATE: [],
  ISOLATED_RESTORE: ['backup-path', 'isolated-target'],
  SECRET_MATERIALIZATION: ['credential-output-path'],
});
for (const [actionClass, expected] of Object.entries(cases)) {
  const queried = [];
  const action = Object.freeze({});
  const endpoint = (candidate, prefix) => {
    if (candidate !== action) process.exit(1);
    queried.push(prefix);
    return `/fixture/${prefix}`;
  };
  const { delegatedForChildBuilders, delegatedForChild } = build(
    Object,
    actionClass,
    action,
    endpoint,
    Object.freeze({
      artifactPolicy: Object.freeze({
        rootMode: 'TEST',
        proofRoot: '/fixture/proof',
      }),
    }),
    Object.freeze({ path: '/fixture/effect-script' }),
    null,
    () => 'parent-prelude',
    basename,
  );
  if (!Object.isFrozen(delegatedForChildBuilders)
      || !Object.isFrozen(delegatedForChild)
      || JSON.stringify(queried) !== JSON.stringify(expected)) {
    process.exit(1);
  }
}
NODE

note "unused effect slots inherit one exact closed null capability"
assert_success node --input-type=module - "$RUNNER" <<'NODE'
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';

const source = readFileSync(process.argv[2], 'utf8');
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const program = parse(source, { sourceType: 'module' }).program;
const declaration = program.body.find((node) => (
  node.type === 'FunctionDeclaration'
    && node.id?.name === 'openFixedNullCapability'
));
if (declaration === undefined) process.exit(1);
const functionSource = source.slice(declaration.start, declaration.end);
const makeOpener = (
  candidateLstatSync,
  candidateRealpathSync,
  candidateOpenSync,
  candidateFstatSync,
  candidateCloseSync,
) => new Function(
  'constants',
  'lstatSync',
  'realpathSync',
  'openSync',
  'fstatSync',
  'closeSync',
  'assert',
  `${functionSource}\nreturn openFixedNullCapability;`,
)(
  constants,
  candidateLstatSync,
  candidateRealpathSync,
  candidateOpenSync,
  candidateFstatSync,
  candidateCloseSync,
  (condition, message) => {
    if (!condition) throw new Error(message);
  },
);
const spawnBoundaryStart = source.indexOf(
  'fixedNullCapabilityDescriptor = openFixedNullCapability();',
);
const spawnBoundaryEnd = source.indexOf(
  "child = spawn('/proc/self/fd/14'",
  spawnBoundaryStart,
);
if (spawnBoundaryStart < 0 || spawnBoundaryEnd < 0
    || source.slice(spawnBoundaryStart, spawnBoundaryEnd).includes("'ignore'")
    || !source.includes('&& fixedNullCapabilityClosed\n')) {
  process.exit(1);
}

const openFixedNullCapability = makeOpener(
  lstatSync,
  realpathSync,
  openSync,
  fstatSync,
  closeSync,
);
const descriptor = openFixedNullCapability();
try {
  const stat = fstatSync(descriptor, { bigint: true });
  const named = lstatSync('/dev/null', { bigint: true });
  const fields = ['dev', 'ino', 'rdev', 'mode', 'nlink', 'uid', 'gid'];
  if (!stat.isCharacterDevice()
      || !fields.every((field) => stat[field] === named[field])) {
    process.exit(1);
  }
  if (process.platform === 'linux') {
    const childSource = String.raw`
      const { readlinkSync } = require('node:fs');
      for (const descriptor of [34, 53]) {
        if (readlinkSync('/proc/self/fd/' + descriptor) !== '/dev/null') process.exit(1);
      }
    `;
    const stdio = Array.from(
      { length: 54 },
      (_, index) => index < 3 ? 'ignore' : descriptor,
    );
    const child = spawnSync(process.execPath, ['-e', childSource], { stdio });
    if (child.error || child.signal || child.status !== 0) process.exit(1);
  }
} finally {
  closeSync(descriptor);
}
let closed = false;
try {
  fstatSync(descriptor);
} catch (error) {
  closed = error?.code === 'EBADF';
}
if (!closed) process.exit(1);

const statFixture = Object.freeze({
  dev: 1n,
  ino: 2n,
  rdev: 3n,
  mode: 0o20666n,
  nlink: 1n,
  uid: 0n,
  gid: 0n,
  isCharacterDevice: () => true,
  isSymbolicLink: () => false,
});
const closedAfterRejectedIdentity = [];
const hostileOpener = makeOpener(
  () => statFixture,
  () => '/dev/null',
  () => 91,
  () => Object.freeze({ ...statFixture, ino: 4n }),
  (value) => closedAfterRejectedIdentity.push(value),
);
let rejectedIdentity = false;
try {
  hostileOpener();
} catch {
  rejectedIdentity = true;
}
if (!rejectedIdentity
    || JSON.stringify(closedAfterRejectedIdentity) !== JSON.stringify([91])) {
  process.exit(1);
}
NODE

note "bound executable descriptors stream large files and retain exact identity"
assert_success node --input-type=module - "$RUNNER" "$TEST_TMP" <<'NODE'
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  writeSync,
} from 'node:fs';
import {
  dirname, isAbsolute, resolve,
} from 'node:path';
import { createRequire } from 'node:module';

const [runnerPath, temporaryRoot] = process.argv.slice(2);
const source = readFileSync(runnerPath, 'utf8');
const require = createRequire(import.meta.url);
const { parse } = require('@babel/parser');
const program = parse(source, { sourceType: 'module' }).program;
const extractFunction = (name) => {
  const declaration = program.body.find((node) => (
    node.type === 'FunctionDeclaration' && node.id?.name === name
  ));
  if (declaration === undefined) throw new Error(`missing function ${name}`);
  return source.slice(declaration.start, declaration.end);
};
const functionNames = [
  'sameJson',
  'statIdentity',
  'endpointFileIdentity',
  'inspectTrustedAncestorChain',
  'hashOpenFile',
  'inspectBoundFile',
  'openBoundDescriptor',
  'recheckBoundDescriptor',
  'positionalRead',
];
const bodies = functionNames.map(extractFunction).join('\n');
const MAX_BOUND_FILE_BYTES = 1024n * 1024n * 1024n;
const MAX_OPEN_FILE_BYTES = 128n * 1024n * 1024n * 1024n;
const blocked = (message) => { throw new Error(message); };
const assert = (condition, message) => {
  if (!condition) blocked(message);
};
const build = new Function(
  'Buffer',
  'BigInt',
  'Math',
  'Number',
  'Object',
  'process',
  'createHash',
  'chmodSync',
  'closeSync',
  'constants',
  'fstatSync',
  'lstatSync',
  'openSync',
  'readSync',
  'realpathSync',
  'dirname',
  'isAbsolute',
  'resolve',
  'assert',
  'blocked',
  'MAX_BOUND_FILE_BYTES',
  'MAX_OPEN_FILE_BYTES',
  `${bodies}\nreturn {
    hashOpenFile,
    inspectBoundFile,
    openBoundDescriptor,
    positionalRead,
    recheckBoundDescriptor,
  };`,
);
const {
  hashOpenFile,
  inspectBoundFile,
  openBoundDescriptor,
  positionalRead,
  recheckBoundDescriptor,
} = build(
  Buffer,
  BigInt,
  Math,
  Number,
  Object,
  process,
  createHash,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  dirname,
  isAbsolute,
  resolve,
  assert,
  blocked,
  MAX_BOUND_FILE_BYTES,
  MAX_OPEN_FILE_BYTES,
);
if (!source.includes('MAX_BOUND_FILE_BYTES')
    || !source.includes(
      'hashOpenFile(descriptor, stat.size, label, MAX_BOUND_FILE_BYTES)',
    )
    || source.includes(
      "createHash('sha256').update(readFileSync(descriptor)).digest('hex')",
    )) {
  process.exit(1);
}

const makeSparseExecutable = (name, size) => {
  const path = resolve(temporaryRoot, name);
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
    0o700,
  );
  try {
    ftruncateSync(descriptor, size);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o700);
  return path;
};
const inspect = (path) => inspectBoundFile(
  path,
  'test executable',
  {
    executable: true,
    rootAncestorChain: false,
    reject: blocked,
  },
);
const largeSize = (2 * 1024 * 1024) + 17;
const large = makeSparseExecutable('large-executable', largeSize);
const largeDescriptor = openSync(large, constants.O_RDONLY);
try {
  const expected = createHash('sha256');
  const zeroes = Buffer.alloc(64 * 1024);
  let remaining = largeSize;
  while (remaining > 0) {
    const count = Math.min(remaining, zeroes.length);
    expected.update(zeroes.subarray(0, count));
    remaining -= count;
  }
  if (hashOpenFile(
    largeDescriptor,
    BigInt(largeSize),
    'large executable',
    MAX_BOUND_FILE_BYTES,
  ) !== expected.digest('hex')) {
    process.exit(1);
  }
} finally {
  closeSync(largeDescriptor);
}
let held = openBoundDescriptor(
  inspect(large),
  'test executable',
  { executable: true, rootAncestorChain: false },
);
recheckBoundDescriptor(held, 'test executable', false);
const mutator = openSync(large, constants.O_WRONLY);
try {
  writeSync(mutator, Buffer.from([1]), 0, 1, 0);
  fsyncSync(mutator);
} finally {
  closeSync(mutator);
}
let rejectedMutation = false;
try {
  recheckBoundDescriptor(held, 'test executable', false);
} catch {
  rejectedMutation = true;
}
closeSync(held.descriptor);
if (!rejectedMutation) process.exit(1);

const replacement = makeSparseExecutable('replacement-executable', largeSize);
held = openBoundDescriptor(
  inspect(replacement),
  'replacement executable',
  { executable: true, rootAncestorChain: false },
);
renameSync(replacement, `${replacement}.retained`);
makeSparseExecutable('replacement-executable', largeSize);
let rejectedReplacement = false;
try {
  recheckBoundDescriptor(held, 'replacement executable', false);
} catch {
  rejectedReplacement = true;
}
closeSync(held.descriptor);
if (!rejectedReplacement) process.exit(1);

const overLimit = makeSparseExecutable(
  'over-limit-executable',
  Number(MAX_BOUND_FILE_BYTES + 1n),
);
let rejectedOverLimit = false;
try {
  inspect(overLimit);
} catch {
  rejectedOverLimit = true;
}
if (!rejectedOverLimit) process.exit(1);
const positionalDescriptor = openSync(large, constants.O_RDONLY);
let retainedSmallDocumentLimit = false;
try {
  positionalRead(positionalDescriptor, largeSize, 'large document');
} catch {
  retainedSmallDocumentLimit = true;
} finally {
  closeSync(positionalDescriptor);
}
if (!retainedSmallDocumentLimit) process.exit(1);
NODE

note "every effect wrapper refuses a non-Linux host before one-time consumption"
assert_success node --input-type=module - \
  "$I00_ROOT/bin/release-switch.sh" \
  "$I00_ROOT/bin/rollback-switch.sh" \
  "$I00_ROOT/bin/install-ops-bundle.sh" \
  "$I00_ROOT/bin/backup-verify.sh" \
  "$I00_ROOT/bin/restore-drill-verify.sh" \
  "$I00_ROOT/bin/secret-materialization.mjs" <<'NODE'
import { readFileSync } from 'node:fs';
const paths = process.argv.slice(2);
for (const path of paths) {
  const source = readFileSync(path, 'utf8');
  const gate = source.indexOf('authorized effects require Linux before authorization consumption');
  const consumption = path.endsWith('secret-materialization.mjs')
    ? source.indexOf('const validation = readJsonOutput(')
    : source.indexOf('AUTHORIZATION_VALIDATION=');
  if (gate < 0 || consumption < 0 || gate > consumption
      || source.indexOf(
        'authorized effects require Linux before authorization consumption',
        gate + 1,
      ) !== -1) {
    process.exit(1);
  }
  if (path.endsWith('rollback-switch.sh')) {
    const stage = source.indexOf('--stage-rollback');
    if (stage < 0 || gate > stage) process.exit(1);
  }
}
NODE

note "nested descriptor executables retain their exact child slots"
assert_success node --input-type=module - \
  "$REPO_ROOT/ops/live/bin/deploy.sh" \
  "$REPO_ROOT/ops/live/bin/restore.sh" <<'NODE'
import { readFileSync } from 'node:fs';
const [deployPath, restorePath] = process.argv.slice(2);
const deploy = readFileSync(deployPath, 'utf8');
const restore = readFileSync(restorePath, 'utf8');
if (!deploy.includes("spawnNodePath = '/proc/self/exe';")
    || !deploy.includes('commandStdio[17] = 17;')
    || !restore.includes('stdio[22] = 22;')
    || !restore.includes('stdio[39] = 39;')) {
  process.exit(1);
}
NODE
if [ "$(uname -s)" = Linux ]; then
  assert_success node --input-type=module - <<'NODE'
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
const executable = (candidates) => {
  const value = candidates.find((candidate) => existsSync(candidate));
  if (value === undefined) process.exit(2);
  return value;
};
const nested = String.raw`
  const { spawnSync } = require('node:child_process');
  const descriptor = Number(process.argv[1]);
  const missing = process.argv[2] === 'missing';
  const args = JSON.parse(process.argv[3]);
  const stdio = Array.from({ length: descriptor + 1 }, () => 'ignore');
  if (!missing) stdio[descriptor] = descriptor;
  const result = spawnSync('/proc/self/fd/' + descriptor, args, { stdio });
  process.exit(missing
    ? (result.error || result.signal || result.status !== 0 ? 0 : 1)
    : (!result.error && !result.signal && result.status === 0 ? 0 : 1));
`;
const check = (descriptor, path, args) => {
  const source = openSync(path, 'r');
  try {
    for (const mode of ['present', 'missing']) {
      const stdio = Array.from({ length: descriptor + 1 }, () => 'ignore');
      stdio[descriptor] = source;
      const result = spawnSync(process.execPath, [
        '-e', nested, String(descriptor), mode, JSON.stringify(args),
      ], { stdio });
      if (result.error || result.signal || result.status !== 0) process.exit(1);
    }
  } finally {
    closeSync(source);
  }
};
check(17, executable(['/bin/bash', '/usr/bin/bash']), ['-p', '-c', 'exit 0']);
check(22, executable(['/usr/bin/tar', '/bin/tar']), ['--version']);
check(39, executable(['/usr/bin/gzip', '/bin/gzip']), ['--version']);
NODE
fi

note "start and terminal evidence schemas bind roots and exact terminal semantics"
assert_success node --input-type=module - "$EVIDENCE" <<'NODE'
import { pathToFileURL } from 'node:url';
const {
  authorizedEffectEvidenceSha256,
  validateAuthorizedEffectOutput,
  validateAuthorizedEffectStart,
  validateAuthorizedEffectTerminal,
} = await import(pathToFileURL(process.argv[2]).href);
const digest = 'a'.repeat(64);
const binding = Object.freeze({
  path: '/usr/bin/node',
  sha256: digest,
  identity: 'fixture-binding',
});
const rootIdentity = 'device=1,inode=2,mode=40700,uid=0,gid=0';
const output = {
  actionClass: 'BACKUP_CREATE',
  claimKey: digest,
  kind: 'I00_AUTHORIZED_EFFECT_OUTPUT',
  outputRelativePath: '20300101T000100Z',
  receiptRelativePath: '20300101T000100Z/manifest.json',
  schemaVersion: 1,
  status: 'OUTPUT_REPORTED',
  writeRootName: 'backupDir',
};
validateAuthorizedEffectOutput(output);
for (const hostile of [
  { ...output, unexpected: true },
  { ...output, actionClass: 'ISOLATED_RESTORE' },
  { ...output, writeRootName: 'opsStateDir' },
  { ...output, outputRelativePath: '../escape' },
  { ...output, outputRelativePath: '20300101T000101Z' },
  { ...output, receiptRelativePath: '20300101T000100Z/cosmos.db' },
]) {
  let outputRejected = false;
  try {
    validateAuthorizedEffectOutput(hostile);
  } catch {
    outputRejected = true;
  }
  if (!outputRejected) process.exit(1);
}
const start = {
  schemaVersion: 1,
  kind: 'AUTHORIZED_EFFECT_START',
  status: 'AUTHORIZED_EFFECT_STARTED',
  actionClass: 'BACKUP_CREATE',
  authorizationId: 'runtime-focused-fixture',
  claimKey: digest,
  consumptionSha256: digest,
  riskVersion: `i00-deployment-risk-v1:sha256:${digest}`,
  serverPreviewDigest: `sha256:${digest}`,
  effectUid: '0',
  effectGid: '0',
  program: binding,
  verifier: binding,
  delegatedScript: binding,
  delegatedBootstrap: {
    kind: 'COMMON_SHELL',
    binding,
  },
  delegatedEnvironment: {
    kind: 'SANITIZED_ENV',
    binding,
  },
  effectExecutables: [{
    name: 'node',
    fd: 16,
    binding,
  }],
  delegatedArgv: ['/effect.sh', '--i00-effect-environment', '/backup.env'],
  effectDirectory: {
    kind: 'CLAIM_TEMPORARY_DIRECTORY',
    path: '/tmp/effect',
    identity: rootIdentity,
  },
  helperPolicy: 'NONE',
  automaticRollback: {},
  writeRoots: [{
    name: 'opsStateDir',
    fd: 45,
    path: '/var/lib/ops',
    identity: rootIdentity,
  }, {
    name: 'backupDir',
    fd: 46,
    path: '/var/backups/cosmos',
    identity: rootIdentity,
  }],
  readRoots: [{
    name: 'dataDir',
    fd: 49,
    path: '/var/lib/cosmos',
    identity: rootIdentity,
    treeSha256: null,
  }],
  observedRoots: [],
  effectOutputPolicy: {
    status: 'ARMED',
    fd: 53,
    schemaVersion: 1,
    kind: 'I00_AUTHORIZED_EFFECT_OUTPUT',
    maxBytes: 4096,
  },
  authorizationExpiresAtUtc: '2030-01-01T01:00:00Z',
  evidenceValidUntilUtc: '2030-01-01T00:59:00Z',
  receiptPublicationReserveSeconds: 120,
  startEvidencePath: '/var/lib/ops/start.json',
  finishEvidencePath: '/var/lib/ops/finish.json',
  effectStartedAtUtc: '2030-01-01T00:00:00Z',
};
validateAuthorizedEffectStart(start);
const terminal = {
  ...start,
  kind: 'AUTHORIZED_EFFECT_TERMINAL',
  status: 'AUTHORIZED_EFFECT_COMPLETED',
  effectFinishedAtUtc: '2030-01-01T00:01:00Z',
  startEvidenceSha256: authorizedEffectEvidenceSha256(start),
  exitCode: 0,
  signal: null,
  forced: false,
  timedOut: false,
  automaticRollbackAcknowledged: false,
  automaticRollbackHandoffSha256: null,
  programBindingRetained: true,
  effectMayHaveMutated: false,
  successRecorderEligible: true,
  effectOutput: {
    status: 'BOUND',
    outputEvidencePath: '/var/lib/ops/output.json',
    outputEvidenceSha256: digest,
    writeRootName: 'backupDir',
    outputPath: '/var/backups/cosmos/20300101T000100Z',
    outputRelativePath: '20300101T000100Z',
    outputIdentity: rootIdentity,
    outputTreeSha256: digest,
    receiptRelativePath: '20300101T000100Z/manifest.json',
    receiptSha256: digest,
    databaseSha256: digest,
    databaseBytes: 1,
    beforeInventorySha256: 'b'.repeat(64),
    afterInventorySha256: 'c'.repeat(64),
  },
};
validateAuthorizedEffectTerminal(terminal, start);
validateAuthorizedEffectTerminal({
  ...terminal,
  status: 'AUTHORIZED_EFFECT_TERMINATED',
  effectMayHaveMutated: true,
  successRecorderEligible: false,
  effectOutput: { status: 'MISSING' },
}, start);
for (const status of ['MISSING', 'INVALID', 'AMBIGUOUS']) {
  validateAuthorizedEffectTerminal({
    ...terminal,
    status: 'AUTHORIZED_EFFECT_TERMINATED',
    effectMayHaveMutated: true,
    successRecorderEligible: false,
    effectOutput: { status },
  }, start);
  let falseSuccessRejected = false;
  try {
    validateAuthorizedEffectTerminal({
      ...terminal,
      effectOutput: { status },
    }, start);
  } catch {
    falseSuccessRejected = true;
  }
  if (!falseSuccessRejected) process.exit(1);
}
for (const databaseBytes of [0, (128 * 1024 * 1024 * 1024) + 1]) {
  let invalidBytesRejected = false;
  try {
    validateAuthorizedEffectTerminal({
      ...terminal,
      effectOutput: { ...terminal.effectOutput, databaseBytes },
    }, start);
  } catch {
    invalidBytesRejected = true;
  }
  if (!invalidBytesRejected) process.exit(1);
}
let rejected = false;
try {
  validateAuthorizedEffectStart({ ...start, unexpectedCapability: true });
} catch {
  rejected = true;
}
if (!rejected) process.exit(1);
NODE
RUNNER_OUTPUT_SOURCE="$(cat "$RUNNER")"
for required in \
  'I00_AUTHORIZED_EFFECT_OUTPUT_FD' \
  'effectOutputOverflow' \
  'backup root delta is not exactly one new direct child' \
  'constants.O_NOFOLLOW' \
  'sameJson(manifest.evidence, [])' \
  'database.sha256 === manifest.dbSha256' \
  'beforeInventorySha256' \
  'afterInventorySha256' \
  "status: 'INVALID'" \
  "status: 'AMBIGUOUS'"
do
  assert_contains "$RUNNER_OUTPUT_SOURCE" "$required"
done

note "exact TEST producers, validator, consumption, replay, and macOS refusal stay coherent"
if [ "$(uname -s)" = Linux ] && [ -z "${DF32_STAGING_ROOT:-}" ]; then
  note "Linux executable proof requires an exact isolated staging selection"
  pass_assertion
else
  assert_success /usr/bin/env DF32_RUNTIME_FOCUSED=1 \
    /bin/bash "$PRODUCER_TEST"
fi

finish
