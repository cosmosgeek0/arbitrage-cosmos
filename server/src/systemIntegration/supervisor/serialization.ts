import {
  canonicalJson,
  findSecretLikePaths,
  findSerializabilityIssues,
} from '../../foundation/contracts/index.js';
import type { SystemSupervisorReadModel, SystemTraceIndex } from './types.js';

export const MAX_SUPERVISOR_SERIALIZED_BYTES = 2 * 1024 * 1024;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializeBounded(kind: string, value: unknown): string {
  const secretPaths = findSecretLikePaths(value);
  if (secretPaths.length > 0) throw new TypeError(`${kind}: secret-like fields rejected at ${secretPaths.join(', ')}`);
  const issues = findSerializabilityIssues(value);
  if (issues.length > 0) throw new TypeError(`${kind}: not serializable at ${issues.map((issue) => issue.path).join(', ')}`);
  const serialized = canonicalJson(value);
  const bytes = byteLength(serialized);
  if (bytes > MAX_SUPERVISOR_SERIALIZED_BYTES) {
    throw new TypeError(`${kind}: serialized payload ${bytes} exceeds ${MAX_SUPERVISOR_SERIALIZED_BYTES} bytes`);
  }
  return serialized;
}

export function serializeSystemSupervisorSnapshot(snapshot: Readonly<SystemSupervisorReadModel>): string {
  return serializeBounded('serializeSystemSupervisorSnapshot', snapshot);
}

export function serializeSystemTraceIndex(index: Readonly<SystemTraceIndex>): string {
  return serializeBounded('serializeSystemTraceIndex', index);
}
