import { createHash } from 'node:crypto';

import type { Decision } from '../v0/types.js';
import type { VolumeConfig } from './config.js';
import type { WakeupSnapshot } from './types.js';

/**
 * Sanitized, deterministic cut exported directly by the production Volume
 * detector. It contains no account, credential, persistence, submit, CAS, or
 * network seam. The consumer may only record the cut under an independently
 * accepted prospective measurement activation.
 */
export const VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA =
  'cosmos.engine.volume.forward-detector-source-cut.v1' as const;
export const VOLUME_FORWARD_DETECTOR_SOURCE_ID =
  'local://volume-engine/detector-evaluation-cut/v1' as const;

const MAX_UTC_MS = 4_102_444_800_000;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{2,191}$/;
const SYMBOL = /^[A-Z0-9]{5,20}$/;
const VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND =
  'VOLUME_VALIDATE_ONLY_OBSERVATION' as const;

/**
 * Exact V-I3 validate-only projection. The original donor imported this
 * shape from a wider strategy slice; keeping it local prevents that unrelated
 * owner from crossing the recovery zone while preserving its identifiers and
 * semantic fields byte-for-byte.
 */
export interface VolumeForwardValidateOnlyObservationProposal {
  readonly proposalId: string;
  readonly proposalRevision: 1;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly updatedTs: number;
  readonly featureObservedAtMs: number;
  readonly expiresAtMs: number;
  readonly proposalKind:
    typeof VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND;
  readonly evidenceBindingDigest: `vdecision_${string}`;
}

export interface VolumeForwardDetectorSourceEvaluationInput {
  readonly decision: Readonly<Decision>;
  readonly feature: Readonly<WakeupSnapshot>;
}

export interface VolumeForwardDetectorSourceProposal {
  readonly proposal:
    Readonly<VolumeForwardValidateOnlyObservationProposal>;
  readonly detectorDecisionDigest: string;
  readonly featureDigest: string;
}

export interface VolumeForwardDetectorSourceCut {
  readonly schemaVersion: typeof VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA;
  readonly sourceId: typeof VOLUME_FORWARD_DETECTOR_SOURCE_ID;
  readonly tickAtMs: number;
  readonly configurationRevision: string;
  readonly configurationDigest: `sha256:${string}`;
  readonly evaluationUniverseDigest: `sha256:${string}`;
  readonly evaluationUniverseCount: number;
  readonly pseudoProposalExcludedCount: 0;
  readonly qualifiedProposals:
    readonly Readonly<VolumeForwardDetectorSourceProposal>[];
  readonly cutDigest: `sha256:${string}`;
}

export interface BuildVolumeForwardDetectorSourceCutInput {
  readonly tickAtMs: number;
  readonly configurationRevision: string;
  readonly configuration: Readonly<Partial<VolumeConfig> | Record<string, unknown>>;
  readonly evaluations:
    readonly Readonly<VolumeForwardDetectorSourceEvaluationInput>[];
}

function deepFreeze<T>(value: T, seen = new Set<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value as Readonly<T>;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item, seen);
    }
  }
  return Object.freeze(value);
}

function plainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError('forward detector source contains a non-canonical number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (!plainRecord(value)) {
    throw new TypeError('forward detector source contains a non-plain value');
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function canonicalFeatureValue(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return Object.freeze({
      volumeForwardNumber:
        value === Number.POSITIVE_INFINITY
          ? 'POSITIVE_INFINITY'
          : value === Number.NEGATIVE_INFINITY
            ? 'NEGATIVE_INFINITY'
            : 'NAN',
    });
  }
  if (value === undefined) {
    return Object.freeze({ volumeForwardValue: 'UNDEFINED' });
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => canonicalFeatureValue(item)));
  }
  if (plainRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(
        ([key, item]) => [key, canonicalFeatureValue(item)],
      ),
    ));
  }
  return value;
}

function sha256(domain: string, value: unknown): `sha256:${string}` {
  const hash = createHash('sha256');
  hash.update(domain, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonicalJson(value), 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

function strategyHash(namespace: string, value: unknown): string {
  return createHash('sha256')
    .update(`${namespace}|${canonicalJson(value)}`)
    .digest('hex');
}

function engineDigest(prefix: string, domain: string, value: unknown): string {
  return `${prefix}_${sha256(domain, value).slice('sha256:'.length)}`;
}

function safeUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS
    && !Object.is(value, -0);
}

function exactDecision(value: unknown): value is Readonly<Decision> {
  if (!plainRecord(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([
    'correlationId',
    'evidence',
    'humanReason',
    'kind',
    'rejectCode',
    'strategy',
    'symbol',
    'ts',
  ])
    && typeof value.symbol === 'string'
    && SYMBOL.test(value.symbol)
    && safeUtcMs(value.ts)
    && value.strategy === 'volume_spike'
    && typeof value.kind === 'string'
    && typeof value.humanReason === 'string'
    && value.humanReason.length > 0
    && value.humanReason.length <= 1_024
    && typeof value.correlationId === 'string'
    && IDENTIFIER.test(value.correlationId)
    && plainRecord(value.evidence);
}

type QualifiedKillDecision = Readonly<Decision> & {
  readonly kind: 'reject';
  readonly rejectCode: 'kill_switch_on';
  readonly evidence: Readonly<Record<string, unknown>> & {
    readonly direction: 'long' | 'short';
  };
};

function qualifiedKillDecision(
  decision: Readonly<Decision>,
): decision is QualifiedKillDecision {
  return decision.kind === 'reject'
    && decision.rejectCode === 'kill_switch_on'
    && (
      decision.evidence.direction === 'long'
      || decision.evidence.direction === 'short'
  );
}

function buildValidateOnlyObservationProposal(
  decision: QualifiedKillDecision,
  configurationRevision: string,
  expiresAtMs: number,
): Readonly<VolumeForwardValidateOnlyObservationProposal> {
  if (
    decision.correlationId.length > 128
    || decision.humanReason.trim().length === 0
    || /[\u0000-\u001f\u007f]/.test(decision.humanReason)
    || Object.values(decision.evidence).some((item) => {
      if (item === null || typeof item === 'boolean') return false;
      if (typeof item === 'number') {
        return !Number.isFinite(item) || Object.is(item, -0);
      }
      return typeof item !== 'string' || item.length > 16_384;
    })
    || !safeUtcMs(expiresAtMs)
    || expiresAtMs <= decision.ts
  ) {
    throw new TypeError('verified kill-switch Volume decision is invalid');
  }
  const evidenceBindingDigest =
    `vdecision_${strategyHash(
      'volume.validate-only-observation.decision.v1',
      decision,
    )}` as const;
  const semantic = Object.freeze({
    proposalRevision: 1 as const,
    configurationRevision,
    correlationId: decision.correlationId,
    symbol: decision.symbol,
    direction: decision.evidence.direction,
    updatedTs: decision.ts,
    featureObservedAtMs: decision.ts,
    expiresAtMs,
    proposalKind: VOLUME_VALIDATE_ONLY_OBSERVATION_PROPOSAL_KIND,
    evidenceBindingDigest,
  });
  return Object.freeze({
    proposalId: `vvop_${strategyHash(
      'volume.validate-only-observation.proposal-id.v1',
      semantic,
    )}`,
    proposalDigest: `vvopd_${strategyHash(
      'volume.validate-only-observation.proposal-digest.v1',
      semantic,
    )}`,
    ...semantic,
  });
}

export function buildVolumeForwardDetectorSourceCut(
  input: Readonly<BuildVolumeForwardDetectorSourceCutInput>,
): Readonly<VolumeForwardDetectorSourceCut> {
  if (
    !plainRecord(input)
    || !safeUtcMs(input.tickAtMs)
    || typeof input.configurationRevision !== 'string'
    || !IDENTIFIER.test(input.configurationRevision)
    || !plainRecord(input.configuration)
    || !Array.isArray(input.evaluations)
    || input.evaluations.length > 10_000
  ) {
    throw new TypeError('forward detector source input is invalid');
  }
  const symbols = new Set<string>();
  const evaluationFacts: Array<Readonly<{
    symbol: string;
    decisionKind: string;
    rejectCode: string | null;
    decisionDigest: `sha256:${string}`;
    featureDigest: string;
  }>> = [];
  const qualifiedProposals: VolumeForwardDetectorSourceProposal[] = [];
  for (const candidate of input.evaluations) {
    if (
      !plainRecord(candidate)
      || JSON.stringify(Object.keys(candidate).sort())
        !== JSON.stringify(['decision', 'feature'])
      || !exactDecision(candidate.decision)
      || !plainRecord(candidate.feature)
      || candidate.feature.symbol !== candidate.decision.symbol
      || candidate.feature.ts !== candidate.decision.ts
      || candidate.decision.ts > input.tickAtMs
      || symbols.has(candidate.decision.symbol)
    ) {
      throw new TypeError('forward detector evaluation is invalid');
    }
    symbols.add(candidate.decision.symbol);
    const decisionDigest = sha256(
      'VOLUME_FORWARD_DETECTOR_DECISION_V1',
      candidate.decision,
    );
    const featureDigest = engineDigest(
      'vfeature',
      'VOLUME_FORWARD_DETECTOR_FEATURE_V1',
      canonicalFeatureValue(candidate.feature),
    );
    evaluationFacts.push(Object.freeze({
      symbol: candidate.decision.symbol,
      decisionKind: candidate.decision.kind,
      rejectCode: candidate.decision.rejectCode,
      decisionDigest,
      featureDigest,
    }));
    if (qualifiedKillDecision(candidate.decision)) {
      const proposal = buildValidateOnlyObservationProposal(
        candidate.decision,
        input.configurationRevision,
        candidate.decision.ts + 600_000,
      );
      qualifiedProposals.push(Object.freeze({
        proposal,
        detectorDecisionDigest: proposal.evidenceBindingDigest,
        featureDigest,
      }));
    }
  }
  evaluationFacts.sort((left, right) => (
    left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0
  ));
  qualifiedProposals.sort((left, right) => (
    left.proposal.symbol < right.proposal.symbol
      ? -1
      : left.proposal.symbol > right.proposal.symbol
        ? 1
        : left.proposal.proposalId < right.proposal.proposalId
          ? -1
          : left.proposal.proposalId > right.proposal.proposalId
            ? 1
            : 0
  ));
  const semantic = {
    schemaVersion: VOLUME_FORWARD_DETECTOR_SOURCE_SCHEMA,
    sourceId: VOLUME_FORWARD_DETECTOR_SOURCE_ID,
    tickAtMs: input.tickAtMs,
    configurationRevision: input.configurationRevision,
    configurationDigest: sha256(
      'VOLUME_FORWARD_DETECTOR_CONFIGURATION_V1',
      input.configuration,
    ),
    evaluationUniverseDigest: sha256(
      'VOLUME_FORWARD_DETECTOR_EVALUATION_UNIVERSE_V1',
      evaluationFacts,
    ),
    evaluationUniverseCount: evaluationFacts.length,
    pseudoProposalExcludedCount: 0 as const,
    qualifiedProposals,
  };
  return deepFreeze({
    ...semantic,
    cutDigest: sha256('VOLUME_FORWARD_DETECTOR_SOURCE_CUT_V1', semantic),
  }) as Readonly<VolumeForwardDetectorSourceCut>;
}
