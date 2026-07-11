import { stableId } from '../../intelligenceFoundation/contracts/index.js';
import type {
  CaptureCoordinatorConfig,
  CaptureCoordinatorConfigInput,
} from './types.js';

const DEFAULTS = {
  checkpointId: 'live-intelligence-capture-v1',
  declaredConfigurationVersion: 'live-intelligence-capture-policy-1',
  preTriggerWindowMs: 60_000,
  maximumPostWindowMs: 24 * 60 * 60_000,
  captureRetentionMs: 7 * 24 * 60 * 60_000,
  maximumPreRings: 2_048,
  maximumRingEvictionTombstones: 4_096,
  maximumPreEvidencePerRing: 256,
  maximumFreezeEvidence: 1_024,
  maximumPostEvidencePerCapture: 4_096,
  maximumActiveCaptures: 256,
  maximumRetainedCaptures: 1_024,
  maximumPoliciesPerCapture: 16,
  maximumRequiredSources: 64,
  maximumCorrelationIds: 64,
  maximumTriggerTombstones: 4_096,
  maximumFailureRecords: 256,
  maximumEvidenceBytes: 2 * 1024 * 1024,
  maximumCheckpointBytes: 128 * 1024 * 1024,
} as const;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function text(value: unknown, field: string, maximum = 128): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new RangeError(`${field} must be a bounded non-empty string`);
  }
  return value.trim();
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${field} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value as number;
}

export const DEFAULT_CAPTURE_COORDINATOR_CONFIG: Readonly<CaptureCoordinatorConfigInput> = deepFreeze({ ...DEFAULTS });

export function captureCoordinatorConfig(input: CaptureCoordinatorConfigInput = {}): CaptureCoordinatorConfig {
  const merged = { ...DEFAULTS, ...input };
  const material = {
    checkpointId: text(merged.checkpointId, 'checkpointId'),
    declaredConfigurationVersion: text(merged.declaredConfigurationVersion, 'declaredConfigurationVersion'),
    preTriggerWindowMs: integer(merged.preTriggerWindowMs, 'preTriggerWindowMs', 1, 7 * 24 * 60 * 60_000),
    maximumPostWindowMs: integer(merged.maximumPostWindowMs, 'maximumPostWindowMs', 1, 30 * 24 * 60 * 60_000),
    captureRetentionMs: integer(merged.captureRetentionMs, 'captureRetentionMs', 1, 365 * 24 * 60 * 60_000),
    maximumPreRings: integer(merged.maximumPreRings, 'maximumPreRings', 1, 50_000),
    maximumRingEvictionTombstones: integer(
      merged.maximumRingEvictionTombstones, 'maximumRingEvictionTombstones', 1, 100_000,
    ),
    maximumPreEvidencePerRing: integer(merged.maximumPreEvidencePerRing, 'maximumPreEvidencePerRing', 1, 50_000),
    maximumFreezeEvidence: integer(merged.maximumFreezeEvidence, 'maximumFreezeEvidence', 1, 50_000),
    maximumPostEvidencePerCapture: integer(merged.maximumPostEvidencePerCapture, 'maximumPostEvidencePerCapture', 1, 50_000),
    maximumActiveCaptures: integer(merged.maximumActiveCaptures, 'maximumActiveCaptures', 1, 10_000),
    maximumRetainedCaptures: integer(merged.maximumRetainedCaptures, 'maximumRetainedCaptures', 1, 50_000),
    maximumPoliciesPerCapture: integer(merged.maximumPoliciesPerCapture, 'maximumPoliciesPerCapture', 1, 256),
    maximumRequiredSources: integer(merged.maximumRequiredSources, 'maximumRequiredSources', 1, 256),
    maximumCorrelationIds: integer(merged.maximumCorrelationIds, 'maximumCorrelationIds', 1, 256),
    maximumTriggerTombstones: integer(merged.maximumTriggerTombstones, 'maximumTriggerTombstones', 1, 100_000),
    maximumFailureRecords: integer(merged.maximumFailureRecords, 'maximumFailureRecords', 1, 10_000),
    maximumEvidenceBytes: integer(merged.maximumEvidenceBytes, 'maximumEvidenceBytes', 1_024, 32 * 1024 * 1024),
    maximumCheckpointBytes: integer(merged.maximumCheckpointBytes, 'maximumCheckpointBytes', 16 * 1024, 512 * 1024 * 1024),
  };
  if (material.maximumActiveCaptures > material.maximumRetainedCaptures) {
    throw new RangeError('maximumActiveCaptures cannot exceed maximumRetainedCaptures');
  }
  if (material.maximumTriggerTombstones < material.maximumRetainedCaptures) {
    throw new RangeError('maximumTriggerTombstones cannot be smaller than maximumRetainedCaptures');
  }
  const configurationVersion = stableId('runtime-capture-config', material);
  return deepFreeze({
    ...material,
    checkpointSchemaVersion: '1' as const,
    producerVersion: 'live-intelligence-capture-1' as const,
    configurationVersion,
  });
}
