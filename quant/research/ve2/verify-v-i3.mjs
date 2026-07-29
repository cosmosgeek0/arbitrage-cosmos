#!/usr/bin/env node

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
const CHECKSUM_PATH = resolve(HERE, 'V-I3-SHA256SUMS');
const SHA256 = /^[a-f0-9]{64}$/;

export const V_I3_PACKET_FILES = Object.freeze([
  'quant/research/ve2/V-I3-README.md',
  'quant/research/ve2/accepted-capture-owner.mjs',
  'quant/research/ve2/accepted-capture-owner.test.mjs',
  'quant/research/ve2/capture-ready-acceptance.schema.v1.json',
  'quant/research/ve2/scheduled-capture-handoff.schema.v1.json',
  'quant/research/ve2/terminal-metrics-policy.schema.v1.json',
  'quant/research/ve2/terminal-metrics-policy.v1.json',
  'quant/research/ve2/terminal-runner.mjs',
  'quant/research/ve2/terminal-runner-core.bundle.mjs',
  'quant/research/ve2/terminal-runner.test.mjs',
  'quant/research/ve2/verify-v-i3.mjs',
  'server/src/engine/volume/engine.ts',
  'server/src/engine/volume/forwardMeasurementDetectorSource.ts',
  'server/src/engine/volume/forwardMeasurementRunner.ts',
  'server/src/services/volumeRuntime.ts',
  'server/test/volume-forward-measurement-authority.test.mjs',
  'server/test/volume-forward-measurement-runner.test.mjs',
]);

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safePacketPath(repositoryRoot, path) {
  invariant(
    typeof path === 'string'
      && /^[A-Za-z0-9._/-]+$/.test(path)
      && !path.startsWith('/')
      && !path.split('/').some(
        (segment) => segment === '' || segment === '.' || segment === '..',
      ),
    'VI3_PACKET_PATH_INVALID',
  );
  const absolute = resolve(repositoryRoot, path);
  invariant(
    relative(repositoryRoot, absolute) === path,
    'VI3_PACKET_PATH_ESCAPE',
  );
  const stat = lstatSync(absolute);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'VI3_PACKET_FILE_INVALID');
  invariant(
    realpathSync(absolute) === absolute,
    'VI3_PACKET_FILE_REDIRECTED',
  );
  return absolute;
}

export function verifyV3Packet(repositoryRoot = REPOSITORY_ROOT) {
  const root = realpathSync(resolve(repositoryRoot));
  const checksumPath = resolve(root, 'quant/research/ve2/V-I3-SHA256SUMS');
  const checksumBytes = readFileSync(checksumPath);
  const lines = checksumBytes.toString('utf8').trim().split('\n');
  invariant(
    lines.length === V_I3_PACKET_FILES.length,
    'VI3_CHECKSUM_FILE_COUNT',
  );
  const entries = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._/-]+)$/.exec(line);
    invariant(match !== null, 'VI3_CHECKSUM_LINE_INVALID');
    invariant(!entries.has(match[2]), 'VI3_CHECKSUM_PATH_DUPLICATED');
    entries.set(match[2], match[1]);
  }
  invariant(
    JSON.stringify([...entries.keys()].sort())
      === JSON.stringify([...V_I3_PACKET_FILES].sort()),
    'VI3_CHECKSUM_INVENTORY_MISMATCH',
  );
  for (const path of V_I3_PACKET_FILES) {
    const expected = entries.get(path);
    invariant(
      typeof expected === 'string' && SHA256.test(expected),
      'VI3_CHECKSUM_EXPECTED_INVALID',
    );
    invariant(
      sha256(readFileSync(safePacketPath(root, path))) === expected,
      `VI3_CHECKSUM_MISMATCH:${path}`,
    );
  }
  return Object.freeze({
    status: 'PASS',
    fileCount: V_I3_PACKET_FILES.length,
    checksumFileSha256: sha256(checksumBytes),
  });
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = verifyV3Packet();
  process.stdout.write(
    `VI3_PACKET ${result.status} files=${result.fileCount}`
      + ` checksum=${result.checksumFileSha256.slice(-4)}\n`,
  );
}
