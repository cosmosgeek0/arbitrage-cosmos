#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const ACCEPTED_V_I3_COMMIT =
  'a2754a53446aeb5ece3f490d2d72db4598e78f00';
const ACCEPTED_V_I3_TREE =
  '342479d4eb3324130dab5536cd5d05d4fb8b8f59';
const V_I3_CHECKSUM_PATH = 'quant/research/ve2/V-I3-SHA256SUMS';
const V_I4_CHECKSUM_PATH = 'quant/research/ve2/V-I4-SHA256SUMS';
const SHA256 = /^[a-f0-9]{64}$/;

export const V_I4_PACKET_FILES = Object.freeze([
  'quant/research/ve2/V-I4-README.md',
  'quant/research/ve2/v-i4-runtime-adapter.mjs',
  'quant/research/ve2/v-i4-runtime-adapter.test.mjs',
  'quant/research/ve2/verify-v-i4.mjs',
  'server/src/engine/volume/forwardMeasurementScheduler.ts',
  'server/src/services/volumeRuntime.ts',
  'server/test/volume-forward-measurement-authority.test.mjs',
  'server/test/volume-forward-measurement-runner.test.mjs',
  'server/test/volume-forward-measurement-scheduler.test.mjs',
]);

const V_I4_CHANGED_FILES = Object.freeze([
  ...V_I4_PACKET_FILES,
  V_I4_CHECKSUM_PATH,
].sort());

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(args, options = {}) {
  return execFileSync(
    'git',
    ['-C', REPOSITORY_ROOT, ...args],
    {
      encoding: options.encoding ?? 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}

function safePacketPath(path) {
  invariant(
    typeof path === 'string'
      && /^[A-Za-z0-9._/-]+$/.test(path)
      && !path.startsWith('/')
      && !path.split('/').some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      ),
    'VI4_PACKET_PATH_INVALID',
  );
  const absolute = resolve(REPOSITORY_ROOT, path);
  invariant(
    relative(REPOSITORY_ROOT, absolute) === path,
    'VI4_PACKET_PATH_ESCAPE',
  );
  const stat = lstatSync(absolute);
  invariant(
    stat.isFile() && !stat.isSymbolicLink(),
    'VI4_PACKET_FILE_INVALID',
  );
  invariant(
    realpathSync(absolute) === absolute,
    'VI4_PACKET_FILE_REDIRECTED',
  );
  return absolute;
}

function parseChecksums(bytes, codePrefix) {
  const lines = bytes.toString('utf8').trim().split('\n');
  const entries = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/.exec(line);
    invariant(match !== null, `${codePrefix}_CHECKSUM_LINE_INVALID`);
    invariant(
      !entries.has(match[2]),
      `${codePrefix}_CHECKSUM_PATH_DUPLICATED`,
    );
    entries.set(match[2], match[1]);
  }
  return entries;
}

function parentBlob(path) {
  return git(
    ['show', `${ACCEPTED_V_I3_COMMIT}:${path}`],
    { encoding: 'buffer' },
  );
}

function verifyHistoricalV3() {
  const checksumBytes = parentBlob(V_I3_CHECKSUM_PATH);
  const entries = parseChecksums(checksumBytes, 'VI4_PARENT_VI3');
  invariant(entries.size === 17, 'VI4_PARENT_VI3_FILE_COUNT');
  for (const [path, expected] of entries) {
    invariant(
      SHA256.test(expected)
        && sha256(parentBlob(path)) === expected,
      `VI4_PARENT_VI3_CHECKSUM_MISMATCH:${path}`,
    );
  }
  invariant(
    readFileSync(safePacketPath(V_I3_CHECKSUM_PATH)).equals(checksumBytes),
    'VI4_PARENT_VI3_CHECKSUM_FILE_CHANGED',
  );
  return Object.freeze({
    fileCount: entries.size,
    checksumFileSha256: sha256(checksumBytes),
  });
}

function verifyCurrentV4() {
  const checksumBytes =
    readFileSync(safePacketPath(V_I4_CHECKSUM_PATH));
  const entries = parseChecksums(checksumBytes, 'VI4');
  invariant(
    entries.size === V_I4_PACKET_FILES.length,
    'VI4_CHECKSUM_FILE_COUNT',
  );
  invariant(
    JSON.stringify([...entries.keys()].sort())
      === JSON.stringify([...V_I4_PACKET_FILES].sort()),
    'VI4_CHECKSUM_INVENTORY_MISMATCH',
  );
  for (const path of V_I4_PACKET_FILES) {
    const expected = entries.get(path);
    invariant(
      typeof expected === 'string'
        && SHA256.test(expected)
        && sha256(readFileSync(safePacketPath(path))) === expected,
      `VI4_CHECKSUM_MISMATCH:${path}`,
    );
  }
  return Object.freeze({
    fileCount: entries.size,
    checksumFileSha256: sha256(checksumBytes),
  });
}

export function verifyV4Packet() {
  invariant(
    realpathSync(REPOSITORY_ROOT) === REPOSITORY_ROOT,
    'VI4_REPOSITORY_ROOT_REDIRECTED',
  );
  const head = git(['rev-parse', 'HEAD']).trim();
  const lineage = git([
    'rev-list',
    '--parents',
    '-n',
    '1',
    'HEAD',
  ]).trim().split(/\s+/);
  const parent = lineage[1] ?? null;
  const parentTree = git([
    'rev-parse',
    `${ACCEPTED_V_I3_COMMIT}^{tree}`,
  ]).trim();
  const status = git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]).trim();
  invariant(
    /^[a-f0-9]{40}$/.test(head)
      && lineage.length === 2
      && lineage[0] === head
      && parent === ACCEPTED_V_I3_COMMIT
      && parentTree === ACCEPTED_V_I3_TREE
      && status === '',
    'VI4_LOCAL_CANDIDATE_NOT_CLEAN_DIRECT_SUCCESSOR',
  );
  const changed = git([
    'diff',
    '--name-only',
    ACCEPTED_V_I3_COMMIT,
    'HEAD',
  ]).trim().split('\n').filter(Boolean).sort();
  invariant(
    JSON.stringify(changed) === JSON.stringify(V_I4_CHANGED_FILES),
    'VI4_CHANGED_PATHS_MISMATCH',
  );
  const historical = verifyHistoricalV3();
  const current = verifyCurrentV4();
  return Object.freeze({
    status: 'PASS',
    head,
    parent,
    changedFileCount: changed.length,
    vI3HistoricalFileCount: historical.fileCount,
    vI3HistoricalChecksumFileSha256:
      historical.checksumFileSha256,
    vI4FileCount: current.fileCount,
    vI4ChecksumFileSha256: current.checksumFileSha256,
    activationState: 'PROSPECTIVE_NOT_ACTIVATED',
    verdict: 'UNMEASURED',
    consumerGate:
      'BLOCKED_VE2_INTERVAL_NOT_TERMINAL_ACCEPTED',
    profitabilityClaim: false,
    executionAuthority: 'NONE',
  });
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = verifyV4Packet();
  process.stdout.write(
    `VI4_PACKET ${result.status}`
      + ` files=${result.vI4FileCount}`
      + ` parent_files=${result.vI3HistoricalFileCount}`
      + ` changed=${result.changedFileCount}`
      + ` state=${result.activationState}`
      + ` verdict=${result.verdict}\n`,
  );
}
