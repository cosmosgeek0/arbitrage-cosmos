import { createHash } from 'node:crypto';
import { canonicalJson } from '../../intelligenceFoundation/contracts/index.js';

export function checksumParts(parts: readonly unknown[]): string {
  const hash = createHash('sha256');
  hash.update('live-intelligence-capture\0');
  for (let index = 0; index < parts.length; index += 1) {
    const canonical = canonicalJson(parts[index]);
    hash.update(String(index));
    hash.update('\0');
    hash.update(String(Buffer.byteLength(canonical, 'utf8')));
    hash.update('\0');
    hash.update(canonical);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function checksumValue(value: unknown): string {
  return checksumParts([value]);
}

export function validChecksum(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}
