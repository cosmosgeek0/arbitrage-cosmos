import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256File } from './lib.mjs';

export const LEDGER_COMPATIBILITY_SOURCE = 'server/dist/ledger.js';
const MAX_COMPATIBILITY_SOURCE_BYTES = 2 * 1_024 * 1_024;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function exactExportedInteger(source, name) {
  const pattern = new RegExp(`^export const ${name} = (0|[1-9][0-9]*);$`, 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`compiled Ledger must export exactly one literal ${name}`);
  }
  const parsed = BigInt(matches[0][1]);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`compiled Ledger ${name} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(parsed);
}

export function readCompiledLedgerCompatibility(root) {
  const compatibilityPath = resolve(root, LEDGER_COMPATIBILITY_SOURCE);
  const bytes = readFileSync(compatibilityPath);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_COMPATIBILITY_SOURCE_BYTES) {
    throw new Error('compiled Ledger compatibility source is empty or exceeds its byte bound');
  }
  const source = bytes.toString('utf8');
  const schemaVersion = exactExportedInteger(source, 'LEDGER_SCHEMA_VERSION');
  const rollbackFloor = exactExportedInteger(source, 'LEDGER_ROLLBACK_FLOOR');
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0
      || !Number.isSafeInteger(rollbackFloor) || rollbackFloor < 0
      || rollbackFloor > schemaVersion) {
    throw new Error('compiled Ledger compatibility range is invalid');
  }
  // The immutable L15 donor represents a floor transition as one boolean: it
  // can preserve floor zero or raise the floor to this release's schema. An
  // intermediate floor cannot be represented without inventing authority.
  if (rollbackFloor !== 0 && rollbackFloor !== schemaVersion) {
    throw new Error('compiled Ledger rollback floor is not representable by the accepted donor contract');
  }
  return Object.freeze({
    schemaVersion,
    rollbackFloor,
    rollbackBarrier: rollbackFloor > 0,
    compatibilitySource: LEDGER_COMPATIBILITY_SOURCE,
    compatibilitySourceSha256: sha256File(compatibilityPath),
  });
}

export function assertReleaseMatchesCompiledLedger(release, root) {
  const compiled = readCompiledLedgerCompatibility(root);
  for (const key of [
    'schemaVersion', 'rollbackFloor', 'rollbackBarrier',
    'compatibilitySource', 'compatibilitySourceSha256',
  ]) {
    if (release[key] !== compiled[key]) {
      throw new Error(`release ${key} does not match the tested compiled Ledger`);
    }
  }
  return compiled;
}
