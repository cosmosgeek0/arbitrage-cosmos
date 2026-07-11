/** Single-producer semantic source registry. Pure, bounded, and immutable. */
import {
  createStructuredFailure,
} from '../../foundation/contracts/index.js';
import type {
  DialectTranslation,
  SafeModeContext,
  SystemSourceRegistryRecord,
  SystemSourceRegistrySnapshot,
} from '../contracts/types.js';
import {
  createSystemSourceRegistrySnapshot,
  validateSystemSourceRegistryRecord,
} from '../contracts/validation.js';

const COMPONENT = 'systemIntegration.adapters.sourceRegistry';
const MAX_RECORDS = 64;

export interface BuildSourceRegistryInput extends SafeModeContext {
  readonly revision: number;
  readonly records: readonly Readonly<SystemSourceRegistryRecord>[];
}

function reject(
  input: BuildSourceRegistryInput,
  code: string,
  message: string,
): DialectTranslation<Readonly<SystemSourceRegistrySnapshot>> {
  return Object.freeze({
    ok: false,
    failure: createStructuredFailure({
      component: COMPONENT,
      stage: 'build',
      code,
      message,
      occurredAt: input.nowMs,
      retryable: false,
      safeCurrentState: input.safeCurrentState,
      recommendedOperatorAction: 'Remove the conflicting producer or correct the source registry declaration.',
      correlationId: input.correlationId,
    }),
    losses: Object.freeze([]),
  });
}

/**
 * Builds one canonical registry snapshot. A semantic stream may have exactly
 * one registry record regardless of transport; a second physical producer is
 * rejected before composition can start either source.
 */
export function buildSystemSourceRegistry(
  input: BuildSourceRegistryInput,
): DialectTranslation<Readonly<SystemSourceRegistrySnapshot>> {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    return reject(input, 'SOURCE_REGISTRY_REVISION_INVALID', 'Source registry revision must be a non-negative safe integer.');
  }
  if (!Array.isArray(input.records) || input.records.length > MAX_RECORDS) {
    return reject(input, 'SOURCE_REGISTRY_BOUNDS_EXCEEDED', `Source registry may contain at most ${MAX_RECORDS} records.`);
  }

  const seenSourceIds = new Set<string>();
  const streamOwner = new Map<string, string>();
  for (const [index, record] of input.records.entries()) {
    const issues = validateSystemSourceRegistryRecord(record);
    if (issues.length > 0) {
      return reject(
        input,
        'SOURCE_REGISTRY_RECORD_INVALID',
        `Source registry record ${index} is invalid: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}.`,
      );
    }
    if (seenSourceIds.has(record.sourceId)) {
      return reject(input, 'DUPLICATE_SOURCE_ID', `Source ID ${record.sourceId} is registered more than once.`);
    }
    seenSourceIds.add(record.sourceId);

    const previous = streamOwner.get(record.semanticStream);
    if (previous !== undefined) {
      return reject(
        input,
        'DUPLICATE_SEMANTIC_PRODUCER',
        `Semantic stream ${record.semanticStream} is already owned by ${previous}; ${record.sourceId} cannot publish it concurrently.`,
      );
    }
    streamOwner.set(record.semanticStream, record.sourceId);
  }

  try {
    const snapshot = createSystemSourceRegistrySnapshot({
      revision: input.revision,
      evaluatedAtMs: input.nowMs,
      records: input.records,
    });
    return Object.freeze({ ok: true, value: snapshot, losses: Object.freeze([]) });
  } catch (error) {
    return reject(
      input,
      'SOURCE_REGISTRY_INVALID',
      error instanceof Error ? error.message : 'Source registry validation failed.',
    );
  }
}
