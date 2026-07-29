import { createHash } from 'node:crypto';

/**
 * Pure, record-only evidence framing for prospective Volume measurement.
 *
 * This module deliberately has no filesystem, network, clock, random, database,
 * ledger, CAS, private-data, signing, or submission seam. Callers supply both
 * the application payload bytes and the local monotonic receive-clock value.
 */

export const VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA =
  'cosmos.engine.volume.forward-measurement-evidence.v1' as const;
export const VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION = 1 as const;

export const VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE =
  'FORWARD_MEASUREMENT_SEGMENT_V1' as const;
export const VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA =
  'volume.forward.detector-coverage-cut.v1' as const;
export const VOLUME_FORWARD_MEASUREMENT_SEGMENT_SEAL_SCHEMA =
  'volume.forward.segment-seal.v1' as const;
export const VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS = 2_000 as const;

export const VOLUME_FORWARD_MEASUREMENT_LOCAL_ENDPOINT =
  'local://volume-forward-measurement/v1' as const;

export const VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_ENDPOINTS = Object.freeze([
  'https://data-api.binance.vision',
] as const);

export const VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_RESOURCES = Object.freeze([
  '/api/v3/depth',
  '/api/v3/exchangeInfo',
] as const);

export const VOLUME_FORWARD_MEASUREMENT_PUBLIC_STREAM_ENDPOINTS = Object.freeze([
  'wss://data-stream.binance.vision',
] as const);

export const VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS =
  Object.freeze({
    maximumCumulativeRawPayloadBytes: 256 * 1024 * 1024,
    maximumChainIdCharacters: 128,
    maximumHeaderBytes: 4 * 1024,
    maximumJsonlBytes: 512 * 1024 * 1024,
    maximumJsonlLineBytes: 24 * 1024 * 1024,
    maximumRawPayloadBytes: 16 * 1024 * 1024,
    maximumRecordCount: 100_000,
    maximumUtcMs: 8_640_000_000_000_000,
  });

export const VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE =
  Object.freeze({
    ANCHOR_MISMATCH: 'EVIDENCE_ANCHOR_MISMATCH',
    DELETED: 'EVIDENCE_DELETED',
    DUPLICATED: 'EVIDENCE_DUPLICATED',
    INVALID: 'EVIDENCE_INVALID',
    MIXED_POLICY: 'EVIDENCE_MIXED_POLICY',
    MUTATED: 'EVIDENCE_MUTATED',
    REORDERED: 'EVIDENCE_REORDERED',
    TRUNCATED: 'EVIDENCE_TRUNCATED',
    UNSEALED: 'EVIDENCE_UNSEALED',
    UNSUPPORTED: 'EVIDENCE_UNSUPPORTED',
  } as const);

export type VolumeForwardMeasurementEvidenceFailureCode =
  typeof VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE[keyof
    typeof VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE];

export type VolumeForwardMeasurementEvidenceDetailCode =
  | 'AUTHORITY_ENVELOPE_INVALID'
  | 'CHAIN_ALREADY_SEALED'
  | 'CHAIN_ID_INVALID'
  | 'CHAIN_ID_MISMATCH'
  | 'CUMULATIVE_RAW_PAYLOAD_LIMIT_EXCEEDED'
  | 'CURSOR_INVALID'
  | 'DUPLICATE_RECORD_HASH'
  | 'DUPLICATE_SEQUENCE'
  | 'DETECTOR_COVERAGE_CUT_INVALID'
  | 'DETECTOR_COVERAGE_SEQUENCE_INVALID'
  | 'EMPTY_CHAIN'
  | 'EXPECTED_POLICY_DIGEST_MISMATCH'
  | 'EXPECTED_TERMINAL_HASH_MISMATCH'
  | 'GENERATION_ALREADY_OPEN'
  | 'GENERATION_LEFT_OPEN'
  | 'GENERATION_NOT_OPEN'
  | 'GENERATION_OUT_OF_ORDER'
  | 'HEADER_KEYS_INVALID'
  | 'HEADER_LIMIT_EXCEEDED'
  | 'JSONL_LIMIT_EXCEEDED'
  | 'JSONL_LINE_LIMIT_EXCEEDED'
  | 'JSONL_PARSE_FAILED'
  | 'LOCAL_SOURCE_INVALID'
  | 'LOCAL_RECEIVED_AT_MS_INVALID'
  | 'MEASUREMENT_BUNDLE_CONFIG_MISSING'
  | 'MEASUREMENT_BUNDLE_CONTINUITY_MISSING'
  | 'MEASUREMENT_BUNDLE_DETECTOR_PROPOSAL_MISSING'
  | 'MEASUREMENT_BUNDLE_KILL_STATE_MISSING'
  | 'MEASUREMENT_BUNDLE_PUBLIC_SOURCES_INCOMPLETE'
  | 'MIXED_POLICY_DIGEST'
  | 'NON_CANONICAL_BASE64'
  | 'NON_CANONICAL_JSONL'
  | 'NON_MONOTONIC_RECEIVE_CLOCK'
  | 'NON_MONOTONIC_RECEIVE_UTC_CLOCK'
  | 'OPTIONS_INVALID'
  | 'POLICY_DIGEST_INVALID'
  | 'POLICY_DIGEST_MISMATCH'
  | 'POLICY_NOT_FIRST'
  | 'PREVIOUS_HASH_MISMATCH'
  | 'RAW_BYTE_LENGTH_MISMATCH'
  | 'RAW_PAYLOAD_LIMIT_EXCEEDED'
  | 'RAW_SHA256_MISMATCH'
  | 'RECORD_COUNT_LIMIT_EXCEEDED'
  | 'RECORD_HASH_INVALID'
  | 'RECORD_HASH_MISMATCH'
  | 'RECORD_KEYS_INVALID'
  | 'RECORD_KIND_INVALID'
  | 'RECORD_KIND_SOURCE_MISMATCH'
  | 'RECORD_REORDERED'
  | 'RECORD_SEQUENCE_DELETED'
  | 'SCHEMA_UNSUPPORTED'
  | 'SEAL_COUNT_MISMATCH'
  | 'SEAL_NOT_TERMINAL'
  | 'SEAL_TAIL_MISMATCH'
  | 'SOURCE_ENDPOINT_UNSUPPORTED'
  | 'SOURCE_STREAM_UNSUPPORTED'
  | 'SOURCE_TRANSPORT_UNSUPPORTED'
  | 'TERMINAL_FLAG_INVALID'
  | 'TERMINAL_SEAL_GENERATION_MISMATCH'
  | 'TERMINAL_SEAL_MISSING'
  | 'TERMINAL_SEAL_NOT_LAST'
  | 'TERMINAL_SEGMENT_PROFILE_INVALID'
  | 'TERMINAL_SEGMENT_SUMMARY_MISMATCH'
  | 'TRAILING_NEWLINE_MISSING'
  | 'UNEXPECTED_BLANK_LINE';

export type VolumeForwardMeasurementEvidenceKind =
  | 'POLICY'
  | 'GENERATION_OPEN'
  | 'EXCHANGE_INFO'
  | 'DEPTH_SNAPSHOT'
  | 'STREAM_FRAME'
  | 'DEPTH_DIFF'
  | 'TRADE'
  | 'AGG_TRADE'
  | 'BOOK_TICKER'
  | 'CONFIG_STATE'
  | 'KILL_STATE'
  | 'CONTINUITY'
  | 'DETECTOR_COVERAGE'
  | 'DETECTOR_PROPOSAL'
  | 'LIFECYCLE_RECORD'
  | 'GENERATION_CLOSE'
  | 'TERMINAL_SEAL';

export type VolumeForwardMeasurementAppendKind =
  Exclude<VolumeForwardMeasurementEvidenceKind, 'POLICY' | 'TERMINAL_SEAL'>;

export type VolumeForwardMeasurementEvidenceTransport =
  | 'LOCAL'
  | 'BINANCE_SPOT_PUBLIC_REST'
  | 'BINANCE_SPOT_PUBLIC_STREAM';

export interface VolumeForwardMeasurementEvidenceAuthority {
  readonly cas: false;
  readonly execution: 'NONE';
  readonly privateData: false;
  readonly signedRequest: false;
  readonly submit: false;
}

export interface VolumeForwardMeasurementDetectorCoverageProposal {
  readonly cutOffset: number;
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly symbol: string;
  readonly detectorDecisionDigest: string;
  readonly featureDigest: string;
}

export interface VolumeForwardMeasurementDetectorCoverageCut {
  readonly schemaVersion:
    typeof VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA;
  readonly profile: typeof VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE;
  readonly captureId: string;
  readonly activationId: string;
  readonly segmentId: string;
  readonly chainKey: string;
  readonly detectorInputSourceId: string;
  readonly detectorInputSourceDigest: string;
  readonly runtimeGeneration: number;
  readonly detectorTickRevision: number;
  readonly cutOffset: number;
  readonly cutAtMs: number;
  readonly localReceivedAtMs: number;
  readonly localMonotonicNs: string;
  readonly cadenceMs:
    typeof VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly strategyEnabled: false;
  readonly killSwitchEngaged: true;
  readonly evaluationUniverseDigest: string;
  readonly evaluationUniverseCount: number;
  readonly pseudoProposalExcludedCount: number;
  readonly acceptedProposals:
    readonly Readonly<VolumeForwardMeasurementDetectorCoverageProposal>[];
  readonly observerDropCount: number;
  readonly observerFailureCount: number;
  readonly previousCutDigest: string | null;
  readonly cutDigest: string;
  readonly complete: boolean;
}

export interface VolumeForwardMeasurementEvidenceHeader {
  readonly authority: VolumeForwardMeasurementEvidenceAuthority;
  readonly chainId: string;
  readonly generation: number;
  readonly kind: VolumeForwardMeasurementEvidenceKind;
  readonly localReceivedAtMs: number;
  readonly localMonotonicNs: string;
  readonly policyDigest: string;
  readonly previousHash: string | null;
  readonly rawByteLength: number;
  readonly rawSha256: string;
  readonly schema: typeof VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA;
  readonly schemaVersion: typeof VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION;
  readonly sealedRecordCount: number | null;
  readonly sealedTailHash: string | null;
  readonly sequence: number;
  readonly sourceEndpoint: string;
  readonly sourceSymbol: string | null;
  readonly sourceStream: string | null;
  readonly sourceTransport: VolumeForwardMeasurementEvidenceTransport;
  readonly terminal: boolean;
}

export interface VolumeForwardMeasurementEvidenceRecord {
  readonly header: VolumeForwardMeasurementEvidenceHeader;
  readonly rawBase64: string;
  readonly recordHash: string;
}

export interface VolumeForwardMeasurementEvidenceCursor {
  readonly chainId: string;
  readonly cumulativeRawPayloadBytes: number;
  readonly generation: number;
  readonly generationOpen: boolean;
  readonly lastLocalReceivedAtMs: number;
  readonly lastLocalMonotonicNs: string;
  readonly nextSequence: number;
  readonly policyDigest: string;
  readonly previousHash: string;
  readonly sealed: boolean;
}

export type VolumeForwardMeasurementRawPayloadInput =
  | {
      readonly rawPayload: Uint8Array;
      readonly rawPayloadBase64?: never;
    }
  | {
      readonly rawPayload?: never;
      readonly rawPayloadBase64: string;
    };

export type StartVolumeForwardMeasurementEvidenceInput =
  Readonly<{
    chainId: string;
    localReceivedAtMs: number;
    localMonotonicNs: string;
  }> & VolumeForwardMeasurementRawPayloadInput;

export type AppendVolumeForwardMeasurementEvidenceInput =
  Readonly<{
    kind: VolumeForwardMeasurementAppendKind;
    localReceivedAtMs: number;
    localMonotonicNs: string;
    sourceEndpoint?: string;
    sourceSymbol?: string | null;
    sourceStream?: string | null;
    sourceTransport?: VolumeForwardMeasurementEvidenceTransport;
  }> & VolumeForwardMeasurementRawPayloadInput;

export type SealVolumeForwardMeasurementEvidenceInput =
  Readonly<{
    localReceivedAtMs: number;
    localMonotonicNs: string;
  }> & VolumeForwardMeasurementRawPayloadInput;

export interface VolumeForwardMeasurementEvidenceFailure {
  readonly ok: false;
  readonly status: 'REJECTED';
  readonly reasonCode: VolumeForwardMeasurementEvidenceFailureCode;
  readonly detailCode: VolumeForwardMeasurementEvidenceDetailCode;
  readonly recordIndex: number | null;
}

export interface VolumeForwardMeasurementEvidenceStepSuccess {
  readonly ok: true;
  readonly status: 'APPENDED';
  readonly cursor: Readonly<VolumeForwardMeasurementEvidenceCursor>;
  readonly record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
}

export type VolumeForwardMeasurementEvidenceSourceAuthenticity =
  | 'TRUSTED_ANCHOR_MATCHED'
  | 'SELF_CONSISTENT_UNANCHORED';

export interface VolumeForwardMeasurementEvidenceTrustedAnchors {
  readonly expectedPolicyDigest: string | null;
  readonly expectedTerminalHash: string | null;
  readonly policyDigestMatched: boolean;
  readonly terminalHashMatched: boolean;
}

export interface VolumeForwardMeasurementEvidenceVerification {
  readonly canonicalJsonlBytes: number;
  readonly chainId: string;
  readonly cumulativeRawPayloadBytes: number;
  readonly cursor: Readonly<VolumeForwardMeasurementEvidenceCursor>;
  readonly policyDigest: string;
  readonly recordCount: number;
  readonly records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[];
  readonly sealed: boolean;
  /**
   * A valid hash chain proves internal self-consistency, not source
   * authenticity. Only a matching caller-supplied terminal hash can bind the
   * whole capture and produce TRUSTED_ANCHOR_MATCHED. A policy-only match
   * anchors policy bytes, not the later capture.
   */
  readonly sourceAuthenticity: VolumeForwardMeasurementEvidenceSourceAuthenticity;
  readonly terminalHash: string;
  readonly trustedAnchors: Readonly<VolumeForwardMeasurementEvidenceTrustedAnchors>;
}

export interface VolumeForwardMeasurementEvidenceVerificationSuccess {
  readonly ok: true;
  readonly status: 'VALID';
  readonly verification: Readonly<VolumeForwardMeasurementEvidenceVerification>;
}

export interface VolumeForwardMeasurementEvidenceSerializationSuccess {
  readonly ok: true;
  readonly status: 'SERIALIZED';
  readonly jsonl: string;
}

export interface VolumeForwardMeasurementEvidenceRecordSerializationSuccess {
  readonly ok: true;
  readonly status: 'SERIALIZED';
  readonly line: string;
}

export interface VolumeForwardMeasurementEvidenceParseSuccess {
  readonly ok: true;
  readonly status: 'PARSED';
  readonly verification: Readonly<VolumeForwardMeasurementEvidenceVerification>;
}

export interface VolumeForwardMeasurementEvidenceRawDecodeSuccess {
  readonly ok: true;
  readonly status: 'DECODED';
  readonly bytes: Uint8Array;
}

export type VolumeForwardMeasurementEvidenceStepResult =
  | VolumeForwardMeasurementEvidenceStepSuccess
  | VolumeForwardMeasurementEvidenceFailure;

export type VolumeForwardMeasurementEvidenceVerificationResult =
  | VolumeForwardMeasurementEvidenceVerificationSuccess
  | VolumeForwardMeasurementEvidenceFailure;

export type VolumeForwardMeasurementEvidenceSerializationResult =
  | VolumeForwardMeasurementEvidenceSerializationSuccess
  | VolumeForwardMeasurementEvidenceFailure;

export type VolumeForwardMeasurementEvidenceRecordSerializationResult =
  | VolumeForwardMeasurementEvidenceRecordSerializationSuccess
  | VolumeForwardMeasurementEvidenceFailure;

export type VolumeForwardMeasurementEvidenceParseResult =
  | VolumeForwardMeasurementEvidenceParseSuccess
  | VolumeForwardMeasurementEvidenceFailure;

export type VolumeForwardMeasurementEvidenceRawDecodeResult =
  | VolumeForwardMeasurementEvidenceRawDecodeSuccess
  | VolumeForwardMeasurementEvidenceFailure;

export interface VolumeForwardMeasurementEvidenceVerifyOptions {
  /** Optional trusted digest of the exact POLICY payload bytes. */
  readonly expectedPolicyDigest?: string;
  /** Optional trusted record hash of the expected terminal chain record. */
  readonly expectedTerminalHash?: string;
  /**
   * Defaults to true. False is accepted only together with
   * requireSealed:false for explicit open/integrity-only framing.
   */
  readonly requireMeasurementBundle?: boolean;
  /**
   * Defaults to true. Set false for an open capture or explicit
   * integrity-only validation, never to claim a terminal measurement result.
   */
  readonly requireSealed?: boolean;
}

export interface VolumeForwardMeasurementEvidenceParseOptions
  extends VolumeForwardMeasurementEvidenceVerifyOptions {
  readonly maximumJsonlBytes?: number;
  readonly maximumLineBytes?: number;
}

const RECORD_HASH_DOMAIN =
  'cosmos.engine.volume.forward-measurement-evidence.record.v1';
const DETECTOR_COVERAGE_CUT_HASH_DOMAIN =
  'VOLUME_FORWARD_DETECTOR_COVERAGE_CUT_V1';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CHAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const ACTIVATION_ID_PATTERN = /^ve2_activation_[a-f0-9]{64}$/;
const SEGMENT_ID_PATTERN = /^ve2_segment_[a-f0-9]{64}$/;
const RAW_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MONOTONIC_NS_PATTERN = /^(?:0|[1-9][0-9]{0,38})$/;
const BINANCE_DIFF_DEPTH_STREAM_PATTERN =
  /^[a-z0-9]{2,32}@depth(?:@100ms)?$/;
const BINANCE_TRADE_STREAM_PATTERN =
  /^[a-z0-9]{2,32}@(trade|aggTrade|bookTicker)$/;
const BINANCE_SYMBOL_PATTERN = /^[A-Z0-9]{2,32}$/;
const MAX_MONOTONIC_NS = (1n << 128n) - 1n;

const AUTHORITY_KEYS = Object.freeze([
  'cas',
  'execution',
  'privateData',
  'signedRequest',
  'submit',
]);

const HEADER_KEYS = Object.freeze([
  'authority',
  'chainId',
  'generation',
  'kind',
  'localReceivedAtMs',
  'localMonotonicNs',
  'policyDigest',
  'previousHash',
  'rawByteLength',
  'rawSha256',
  'schema',
  'schemaVersion',
  'sealedRecordCount',
  'sealedTailHash',
  'sequence',
  'sourceEndpoint',
  'sourceSymbol',
  'sourceStream',
  'sourceTransport',
  'terminal',
]);

const RECORD_KEYS = Object.freeze([
  'header',
  'rawBase64',
  'recordHash',
]);

const CURSOR_KEYS = Object.freeze([
  'chainId',
  'cumulativeRawPayloadBytes',
  'generation',
  'generationOpen',
  'lastLocalReceivedAtMs',
  'lastLocalMonotonicNs',
  'nextSequence',
  'policyDigest',
  'previousHash',
  'sealed',
]);

const VERIFY_OPTION_KEYS = Object.freeze([
  'expectedPolicyDigest',
  'expectedTerminalHash',
  'requireMeasurementBundle',
  'requireSealed',
]);

const PARSE_OPTION_KEYS = Object.freeze([
  ...VERIFY_OPTION_KEYS,
  'maximumJsonlBytes',
  'maximumLineBytes',
]);

const RECORD_KINDS = new Set<VolumeForwardMeasurementEvidenceKind>([
  'POLICY',
  'GENERATION_OPEN',
  'EXCHANGE_INFO',
  'DEPTH_SNAPSHOT',
  'STREAM_FRAME',
  'DEPTH_DIFF',
  'TRADE',
  'AGG_TRADE',
  'BOOK_TICKER',
  'CONFIG_STATE',
  'KILL_STATE',
  'CONTINUITY',
  'DETECTOR_COVERAGE',
  'DETECTOR_PROPOSAL',
  'LIFECYCLE_RECORD',
  'GENERATION_CLOSE',
  'TERMINAL_SEAL',
]);

const LOCAL_KINDS = new Set<VolumeForwardMeasurementEvidenceKind>([
  'POLICY',
  'GENERATION_OPEN',
  'CONFIG_STATE',
  'KILL_STATE',
  'CONTINUITY',
  'DETECTOR_COVERAGE',
  'DETECTOR_PROPOSAL',
  'LIFECYCLE_RECORD',
  'GENERATION_CLOSE',
  'TERMINAL_SEAL',
]);

const PUBLIC_REST_KINDS = new Set<VolumeForwardMeasurementEvidenceKind>([
  'EXCHANGE_INFO',
  'DEPTH_SNAPSHOT',
]);

const PUBLIC_STREAM_KINDS = new Set<VolumeForwardMeasurementEvidenceKind>([
  'DEPTH_DIFF',
  'TRADE',
  'AGG_TRADE',
  'BOOK_TICKER',
]);

const COMPLETE_PUBLIC_MEASUREMENT_KINDS =
  Object.freeze([
    'EXCHANGE_INFO',
    'DEPTH_SNAPSHOT',
    'DEPTH_DIFF',
    'TRADE',
    'AGG_TRADE',
    'BOOK_TICKER',
  ] as const);

const DETECTOR_COVERAGE_CUT_KEYS = Object.freeze([
  'schemaVersion',
  'profile',
  'captureId',
  'activationId',
  'segmentId',
  'chainKey',
  'detectorInputSourceId',
  'detectorInputSourceDigest',
  'runtimeGeneration',
  'detectorTickRevision',
  'cutOffset',
  'cutAtMs',
  'localReceivedAtMs',
  'localMonotonicNs',
  'cadenceMs',
  'configurationRevision',
  'configurationDigest',
  'strategyEnabled',
  'killSwitchEngaged',
  'evaluationUniverseDigest',
  'evaluationUniverseCount',
  'pseudoProposalExcludedCount',
  'acceptedProposals',
  'observerDropCount',
  'observerFailureCount',
  'previousCutDigest',
  'cutDigest',
  'complete',
]);

const DETECTOR_COVERAGE_PROPOSAL_KEYS = Object.freeze([
  'cutOffset',
  'proposalId',
  'proposalRevision',
  'proposalDigest',
  'symbol',
  'detectorDecisionDigest',
  'featureDigest',
]);

const TERMINAL_SEGMENT_KEYS = Object.freeze([
  'schemaVersion',
  'profile',
  'segmentId',
  'captureId',
  'activationId',
  'coverageRole',
  'chainKey',
  'symbol',
  'segmentIndex',
  'previousTerminalHash',
  'corePolicyDigest',
  'packetMeasurementPolicySha256',
  'detectorInputSourceId',
  'detectorInputSourceDigest',
  'coverage',
  'recordBounds',
  'nonTruncated',
  'closeReason',
  'generationSummary',
  'detectorCoverage',
  'acceptedProposals',
  'lifecycleSummary',
  'pseudoProposalExcludedCount',
  'quiescent',
]);

const TERMINAL_COVERAGE_KEYS = Object.freeze([
  'startMs',
  'endExclusiveMs',
]);

const TERMINAL_RECORD_BOUNDS_KEYS = Object.freeze([
  'firstHash',
  'sealedTailHash',
  'firstSequence',
  'lastSequence',
  'recordCount',
  'byteCount',
]);

const TERMINAL_GENERATION_SUMMARY_KEYS = Object.freeze([
  'count',
  'continuityGapCount',
  'unresolvedCount',
]);

const TERMINAL_DETECTOR_COVERAGE_KEYS = Object.freeze([
  'coverageChainKey',
  'firstCutOffset',
  'lastCutOffset',
  'cutCount',
  'expectedCutCount',
  'missingCutCount',
  'maxGapMs',
  'uncoveredMs',
  'firstCutDigest',
  'lastCutDigest',
  'complete',
]);

const TERMINAL_PROPOSAL_KEYS = Object.freeze([
  'proposalId',
  'proposalRevision',
  'proposalDigest',
  'symbol',
]);

const TERMINAL_LIFECYCLE_SUMMARY_KEYS = Object.freeze([
  'proposalKeys',
  'assertionCount',
  'openCount',
  'stateCounts',
]);

const TERMINAL_LIFECYCLE_STATE_COUNT_KEYS = Object.freeze([
  'OBSERVED',
  'ENTRY_RECORDED',
  'HOLDING',
  'TERMINAL_EXIT',
  'BLOCKED',
  'EXACT',
]);

function failure(
  reasonCode: VolumeForwardMeasurementEvidenceFailureCode,
  detailCode: VolumeForwardMeasurementEvidenceDetailCode,
  recordIndex: number | null = null,
): VolumeForwardMeasurementEvidenceFailure {
  return Object.freeze({
    ok: false,
    status: 'REJECTED',
    reasonCode,
    detailCode,
    recordIndex,
  });
}

function isFailure(
  value: unknown,
): value is VolumeForwardMeasurementEvidenceFailure {
  return (
    value !== null
    && typeof value === 'object'
    && (value as { readonly ok?: unknown }).ok === false
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) return null;
    if (ownKeys.some((key) => typeof key !== 'string')) return null;
    const actual = (ownKeys as string[]).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (actual.some((key, index) => key !== expected[index])) return null;
    for (const key of actual) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !('value' in descriptor)
        || descriptor.enumerable !== true
      ) {
        return null;
      }
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function allowedPlainDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return null;
    const allowed = new Set(allowedKeys);
    const snapshot: Record<string, unknown> = {};
    for (const key of ownKeys as string[]) {
      if (!allowed.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !('value' in descriptor)
        || descriptor.enumerable !== true
      ) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

interface NormalizedVolumeForwardMeasurementEvidenceOptions {
  readonly expectedPolicyDigest: string | null;
  readonly expectedTerminalHash: string | null;
  readonly maximumJsonlBytes: number;
  readonly maximumLineBytes: number;
  readonly requireMeasurementBundle: boolean;
  readonly requireSealed: boolean;
}

function normalizeEvidenceOptions(
  value: unknown,
  includeParseLimits: boolean,
):
  | Readonly<NormalizedVolumeForwardMeasurementEvidenceOptions>
  | VolumeForwardMeasurementEvidenceFailure {
  const options = allowedPlainDataRecord(
    value,
    includeParseLimits ? PARSE_OPTION_KEYS : VERIFY_OPTION_KEYS,
  );
  if (options === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'OPTIONS_INVALID',
    );
  }
  const has = (key: string): boolean => (
    Object.prototype.hasOwnProperty.call(options, key)
  );
  if (
    (has('requireSealed') && typeof options.requireSealed !== 'boolean')
    || (
      has('requireMeasurementBundle')
      && typeof options.requireMeasurementBundle !== 'boolean'
    )
    || (
      has('expectedPolicyDigest')
      && (
        typeof options.expectedPolicyDigest !== 'string'
        || !SHA256_PATTERN.test(options.expectedPolicyDigest)
      )
    )
    || (
      has('expectedTerminalHash')
      && (
        typeof options.expectedTerminalHash !== 'string'
        || !SHA256_PATTERN.test(options.expectedTerminalHash)
      )
    )
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'OPTIONS_INVALID',
    );
  }
  const requireSealed = has('requireSealed')
    ? options.requireSealed as boolean
    : true;
  const requireMeasurementBundle = has('requireMeasurementBundle')
    ? options.requireMeasurementBundle as boolean
    : true;
  if (!requireMeasurementBundle && requireSealed) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'OPTIONS_INVALID',
    );
  }

  let maximumJsonlBytes =
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlBytes;
  let maximumLineBytes =
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlLineBytes;
  if (includeParseLimits) {
    if (
      (
        has('maximumJsonlBytes')
        && (
          typeof options.maximumJsonlBytes !== 'number'
          || !Number.isSafeInteger(options.maximumJsonlBytes)
          || options.maximumJsonlBytes <= 0
        )
      )
      || (
        has('maximumLineBytes')
        && (
          typeof options.maximumLineBytes !== 'number'
          || !Number.isSafeInteger(options.maximumLineBytes)
          || options.maximumLineBytes <= 0
        )
      )
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'OPTIONS_INVALID',
      );
    }
    if (has('maximumJsonlBytes')) {
      maximumJsonlBytes = Math.min(
        options.maximumJsonlBytes as number,
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlBytes,
      );
    }
    if (has('maximumLineBytes')) {
      maximumLineBytes = Math.min(
        options.maximumLineBytes as number,
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlLineBytes,
      );
    }
    maximumLineBytes = Math.min(maximumLineBytes, maximumJsonlBytes);
  }

  return Object.freeze({
    expectedPolicyDigest: has('expectedPolicyDigest')
      ? options.expectedPolicyDigest as string
      : null,
    expectedTerminalHash: has('expectedTerminalHash')
      ? options.expectedTerminalHash as string
      : null,
    maximumJsonlBytes,
    maximumLineBytes,
    requireMeasurementBundle,
    requireSealed,
  });
}

function canonicalJson(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) return null;
    return String(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const entry of value) {
      const canonical = canonicalJson(entry);
      if (canonical === null) return null;
      items.push(canonical);
    }
    return `[${items.join(',')}]`;
  }
  if (typeof value !== 'object') return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const sorted = (keys as string[]).sort(compareText);
    const entries: string[] = [];
    for (const key of sorted) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !('value' in descriptor)
        || descriptor.enumerable !== true
      ) {
        return null;
      }
      const canonical = canonicalJson(descriptor.value);
      if (canonical === null) return null;
      entries.push(`${JSON.stringify(key)}:${canonical}`);
    }
    return `{${entries.join(',')}}`;
  } catch {
    return null;
  }
}

const ENGINE_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,191}$/;
const TERMINAL_CLOSE_REASON_PATTERN = /^[A-Z][A-Z0-9_:-]{0,127}$/;

interface ParsedTerminalSegmentSeal {
  readonly value: Record<string, unknown>;
  readonly coverage: Record<string, unknown>;
  readonly recordBounds: Record<string, unknown>;
  readonly generationSummary: Record<string, unknown>;
  readonly detectorCoverage: Record<string, unknown>;
  readonly acceptedProposals: readonly Record<string, unknown>[];
  readonly lifecycleSummary: Record<string, unknown>;
  readonly lifecycleProposalKeys: readonly Record<string, unknown>[];
  readonly lifecycleStateCounts: Record<string, unknown>;
}

interface ParsedLifecycleSemantic {
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly state:
    | 'OBSERVED'
    | 'ENTRY_RECORDED'
    | 'HOLDING'
    | 'TERMINAL_EXIT'
    | 'BLOCKED'
    | 'EXACT';
  readonly transitionRevision: number;
  readonly previousLifecycleRecordHash: string | null;
  readonly recordHash: string;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function jsonObjectFromBytes(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return exactPlainRecord(
      parsed,
      Reflect.ownKeys(parsed).filter(
        (key): key is string => typeof key === 'string',
      ),
    );
  } catch {
    return null;
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalJson(left);
  return leftCanonical !== null && leftCanonical === canonicalJson(right);
}

function detectorProposalSortKey(
  proposal: Readonly<Record<string, unknown>>,
): string {
  return [
    proposal.symbol,
    proposal.proposalId,
    String(proposal.proposalRevision).padStart(16, '0'),
    proposal.proposalDigest,
    proposal.detectorDecisionDigest,
    proposal.featureDigest,
  ].join('|');
}

function terminalProposalSortKey(
  proposal: Readonly<Record<string, unknown>>,
): string {
  return [
    proposal.symbol,
    proposal.proposalId,
    String(proposal.proposalRevision).padStart(16, '0'),
    proposal.proposalDigest,
  ].join('|');
}

function detectorCoverageCutDigest(
  value: Readonly<Record<string, unknown>>,
): string | null {
  const semantic: Record<string, unknown> = {};
  for (const key of DETECTOR_COVERAGE_CUT_KEYS) {
    if (key !== 'cutDigest') semantic[key] = value[key];
  }
  const canonical = canonicalJson(semantic);
  if (canonical === null) return null;
  const hash = createHash('sha256');
  hash.update(DETECTOR_COVERAGE_CUT_HASH_DOMAIN, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonical, 'utf8');
  return `sha256:${hash.digest('hex')}`;
}

function parseDetectorCoverageCutSemantic(
  bytes: Uint8Array,
  header: Readonly<VolumeForwardMeasurementEvidenceHeader>,
): Readonly<VolumeForwardMeasurementDetectorCoverageCut> | null {
  const value = exactPlainRecord(
    jsonObjectFromBytes(bytes),
    DETECTOR_COVERAGE_CUT_KEYS,
  );
  if (
    value === null
    || value.schemaVersion
      !== VOLUME_FORWARD_MEASUREMENT_DETECTOR_COVERAGE_CUT_SCHEMA
    || value.profile !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE
    || typeof value.captureId !== 'string'
    || !IDENTIFIER_PATTERN.test(value.captureId)
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID_PATTERN.test(value.activationId)
    || typeof value.segmentId !== 'string'
    || !SEGMENT_ID_PATTERN.test(value.segmentId)
    || typeof value.chainKey !== 'string'
    || !IDENTIFIER_PATTERN.test(value.chainKey)
    || typeof value.detectorInputSourceId !== 'string'
    || !SOURCE_ID_PATTERN.test(value.detectorInputSourceId)
    || typeof value.detectorInputSourceDigest !== 'string'
    || !SHA256_PATTERN.test(value.detectorInputSourceDigest)
    || !nonNegativeSafeInteger(value.runtimeGeneration)
    || value.runtimeGeneration < 1
    || !nonNegativeSafeInteger(value.detectorTickRevision)
    || value.detectorTickRevision < 1
    || !nonNegativeSafeInteger(value.cutOffset)
    || safeUtcMs(value.cutAtMs) === null
    || value.localReceivedAtMs !== header.localReceivedAtMs
    || value.localMonotonicNs !== header.localMonotonicNs
    || (value.localReceivedAtMs as number) < (value.cutAtMs as number)
    || (value.localReceivedAtMs as number)
      >= (value.cutAtMs as number)
        + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    || value.cadenceMs
      !== VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    || typeof value.configurationRevision !== 'string'
    || !IDENTIFIER_PATTERN.test(value.configurationRevision)
    || typeof value.configurationDigest !== 'string'
    || !SHA256_PATTERN.test(value.configurationDigest)
    || value.strategyEnabled !== false
    || value.killSwitchEngaged !== true
    || typeof value.evaluationUniverseDigest !== 'string'
    || !SHA256_PATTERN.test(value.evaluationUniverseDigest)
    || !nonNegativeSafeInteger(value.evaluationUniverseCount)
    || !nonNegativeSafeInteger(value.pseudoProposalExcludedCount)
    || !nonNegativeSafeInteger(value.observerDropCount)
    || !nonNegativeSafeInteger(value.observerFailureCount)
    || (
      value.cutOffset === 0
        ? value.previousCutDigest !== null
        : (
            typeof value.previousCutDigest !== 'string'
            || !SHA256_PATTERN.test(value.previousCutDigest)
          )
    )
    || typeof value.cutDigest !== 'string'
    || !SHA256_PATTERN.test(value.cutDigest)
    || typeof value.complete !== 'boolean'
    || (
      value.complete === true
      && (
        value.observerDropCount !== 0
        || value.observerFailureCount !== 0
      )
    )
    || !Array.isArray(value.acceptedProposals)
    || value.acceptedProposals.length > 10_000
    || value.evaluationUniverseCount < value.acceptedProposals.length
    || (
      value.acceptedProposals.length === 0
      && value.complete !== true
    )
  ) return null;
  const proposalIds = new Set<string>();
  let priorSortKey: string | null = null;
  for (const candidate of value.acceptedProposals) {
    const proposal = exactPlainRecord(
      candidate,
      DETECTOR_COVERAGE_PROPOSAL_KEYS,
    );
    if (
      proposal === null
      || proposal.cutOffset !== value.cutOffset
      || typeof proposal.proposalId !== 'string'
      || !ENGINE_IDENTIFIER_PATTERN.test(proposal.proposalId)
      || !nonNegativeSafeInteger(proposal.proposalRevision)
      || proposal.proposalRevision < 1
      || typeof proposal.proposalDigest !== 'string'
      || !ENGINE_IDENTIFIER_PATTERN.test(proposal.proposalDigest)
      || typeof proposal.symbol !== 'string'
      || !BINANCE_SYMBOL_PATTERN.test(proposal.symbol)
      || typeof proposal.detectorDecisionDigest !== 'string'
      || !ENGINE_IDENTIFIER_PATTERN.test(proposal.detectorDecisionDigest)
      || typeof proposal.featureDigest !== 'string'
      || !ENGINE_IDENTIFIER_PATTERN.test(proposal.featureDigest)
      || proposalIds.has(proposal.proposalId)
    ) return null;
    const sortKey = detectorProposalSortKey(proposal);
    if (priorSortKey !== null && compareText(sortKey, priorSortKey) <= 0) {
      return null;
    }
    priorSortKey = sortKey;
    proposalIds.add(proposal.proposalId);
  }
  if (detectorCoverageCutDigest(value) !== value.cutDigest) return null;
  return value as unknown as
    Readonly<VolumeForwardMeasurementDetectorCoverageCut>;
}

function parseTerminalProposalArray(
  value: unknown,
): readonly Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > 10_000) return null;
  const proposals: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  let priorSortKey: string | null = null;
  for (const candidate of value) {
    const proposal = exactPlainRecord(candidate, TERMINAL_PROPOSAL_KEYS);
    if (
      proposal === null
      || typeof proposal.proposalId !== 'string'
      || !ENGINE_IDENTIFIER_PATTERN.test(proposal.proposalId)
      || !nonNegativeSafeInteger(proposal.proposalRevision)
      || proposal.proposalRevision < 1
      || typeof proposal.proposalDigest !== 'string'
      || !ENGINE_IDENTIFIER_PATTERN.test(proposal.proposalDigest)
      || typeof proposal.symbol !== 'string'
      || !BINANCE_SYMBOL_PATTERN.test(proposal.symbol)
      || ids.has(proposal.proposalId)
    ) return null;
    const sortKey = terminalProposalSortKey(proposal);
    if (priorSortKey !== null && compareText(sortKey, priorSortKey) <= 0) {
      return null;
    }
    priorSortKey = sortKey;
    ids.add(proposal.proposalId);
    proposals.push(proposal);
  }
  return proposals;
}

function parseTerminalSegmentSealSemantic(
  bytes: Uint8Array,
): Readonly<ParsedTerminalSegmentSeal> | null {
  const value = exactPlainRecord(
    jsonObjectFromBytes(bytes),
    TERMINAL_SEGMENT_KEYS,
  );
  if (value === null) return null;
  const coverage = exactPlainRecord(value.coverage, TERMINAL_COVERAGE_KEYS);
  const recordBounds = exactPlainRecord(
    value.recordBounds,
    TERMINAL_RECORD_BOUNDS_KEYS,
  );
  const generationSummary = exactPlainRecord(
    value.generationSummary,
    TERMINAL_GENERATION_SUMMARY_KEYS,
  );
  const detectorCoverage = exactPlainRecord(
    value.detectorCoverage,
    TERMINAL_DETECTOR_COVERAGE_KEYS,
  );
  const lifecycleSummary = exactPlainRecord(
    value.lifecycleSummary,
    TERMINAL_LIFECYCLE_SUMMARY_KEYS,
  );
  const lifecycleStateCounts = lifecycleSummary === null
    ? null
    : exactPlainRecord(
        lifecycleSummary.stateCounts,
        TERMINAL_LIFECYCLE_STATE_COUNT_KEYS,
      );
  const acceptedProposals = parseTerminalProposalArray(
    value.acceptedProposals,
  );
  const lifecycleProposalKeys = lifecycleSummary === null
    ? null
    : parseTerminalProposalArray(lifecycleSummary.proposalKeys);
  if (
    coverage === null
    || recordBounds === null
    || generationSummary === null
    || detectorCoverage === null
    || lifecycleSummary === null
    || lifecycleStateCounts === null
    || acceptedProposals === null
    || lifecycleProposalKeys === null
    || value.schemaVersion !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_SEAL_SCHEMA
    || value.profile !== VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE
    || typeof value.segmentId !== 'string'
    || !SEGMENT_ID_PATTERN.test(value.segmentId)
    || typeof value.captureId !== 'string'
    || !IDENTIFIER_PATTERN.test(value.captureId)
    || typeof value.activationId !== 'string'
    || !ACTIVATION_ID_PATTERN.test(value.activationId)
    || (
      value.coverageRole !== 'DETECTOR_COVERAGE'
      && value.coverageRole !== 'SYMBOL_LIFECYCLE'
    )
    || typeof value.chainKey !== 'string'
    || !IDENTIFIER_PATTERN.test(value.chainKey)
    || (
      value.coverageRole === 'DETECTOR_COVERAGE'
        ? value.symbol !== null
        : (
            typeof value.symbol !== 'string'
            || !BINANCE_SYMBOL_PATTERN.test(value.symbol)
          )
    )
    || !nonNegativeSafeInteger(value.segmentIndex)
    || (
      value.segmentIndex === 0
        ? value.previousTerminalHash !== null
        : (
            typeof value.previousTerminalHash !== 'string'
            || !SHA256_PATTERN.test(value.previousTerminalHash)
          )
    )
    || typeof value.corePolicyDigest !== 'string'
    || !SHA256_PATTERN.test(value.corePolicyDigest)
    || typeof value.packetMeasurementPolicySha256 !== 'string'
    || !RAW_SHA256_PATTERN.test(value.packetMeasurementPolicySha256)
    || typeof value.detectorInputSourceId !== 'string'
    || !SOURCE_ID_PATTERN.test(value.detectorInputSourceId)
    || typeof value.detectorInputSourceDigest !== 'string'
    || !SHA256_PATTERN.test(value.detectorInputSourceDigest)
    || safeUtcMs(coverage.startMs) === null
    || safeUtcMs(coverage.endExclusiveMs) === null
    || (coverage.endExclusiveMs as number) <= (coverage.startMs as number)
    || typeof recordBounds.firstHash !== 'string'
    || !SHA256_PATTERN.test(recordBounds.firstHash)
    || typeof recordBounds.sealedTailHash !== 'string'
    || !SHA256_PATTERN.test(recordBounds.sealedTailHash)
    || !nonNegativeSafeInteger(recordBounds.firstSequence)
    || !nonNegativeSafeInteger(recordBounds.lastSequence)
    || !nonNegativeSafeInteger(recordBounds.recordCount)
    || !nonNegativeSafeInteger(recordBounds.byteCount)
    || value.nonTruncated !== true
    || typeof value.closeReason !== 'string'
    || !TERMINAL_CLOSE_REASON_PATTERN.test(value.closeReason)
    || !nonNegativeSafeInteger(generationSummary.count)
    || !nonNegativeSafeInteger(generationSummary.continuityGapCount)
    || !nonNegativeSafeInteger(generationSummary.unresolvedCount)
    || !nonNegativeSafeInteger(detectorCoverage.firstCutOffset)
    || !nonNegativeSafeInteger(detectorCoverage.lastCutOffset)
    || !nonNegativeSafeInteger(detectorCoverage.cutCount)
    || !nonNegativeSafeInteger(detectorCoverage.expectedCutCount)
    || !nonNegativeSafeInteger(detectorCoverage.missingCutCount)
    || !nonNegativeSafeInteger(detectorCoverage.maxGapMs)
    || detectorCoverage.maxGapMs
      > VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    || !nonNegativeSafeInteger(detectorCoverage.uncoveredMs)
    || typeof detectorCoverage.coverageChainKey !== 'string'
    || !IDENTIFIER_PATTERN.test(detectorCoverage.coverageChainKey)
    || typeof detectorCoverage.firstCutDigest !== 'string'
    || !SHA256_PATTERN.test(detectorCoverage.firstCutDigest)
    || typeof detectorCoverage.lastCutDigest !== 'string'
    || !SHA256_PATTERN.test(detectorCoverage.lastCutDigest)
    || typeof detectorCoverage.complete !== 'boolean'
    || !nonNegativeSafeInteger(lifecycleSummary.assertionCount)
    || !nonNegativeSafeInteger(lifecycleSummary.openCount)
    || Object.values(lifecycleStateCounts).some(
      (count) => !nonNegativeSafeInteger(count),
    )
    || !nonNegativeSafeInteger(value.pseudoProposalExcludedCount)
    || value.quiescent !== true
  ) return null;
  return {
    value,
    coverage,
    recordBounds,
    generationSummary,
    detectorCoverage,
    acceptedProposals,
    lifecycleSummary,
    lifecycleProposalKeys,
    lifecycleStateCounts,
  };
}

function parseLifecycleSemantic(
  bytes: Uint8Array,
  recordHashValue: string,
): Readonly<ParsedLifecycleSemantic> | null {
  const value = jsonObjectFromBytes(bytes);
  if (
    value === null
    || value.mode !== 'SHADOW_RECORD_ONLY'
    || typeof value.proposalId !== 'string'
    || !ENGINE_IDENTIFIER_PATTERN.test(value.proposalId)
    || typeof value.proposalDigest !== 'string'
    || !ENGINE_IDENTIFIER_PATTERN.test(value.proposalDigest)
    || typeof value.state !== 'string'
    || ![
      'OBSERVED',
      'ENTRY_RECORDED',
      'HOLDING',
      'TERMINAL_EXIT',
      'BLOCKED',
      'EXACT',
    ].includes(value.state)
  ) return null;
  const expectedKeys = value.state === 'BLOCKED'
    ? [
        'mode',
        'previousLifecycleRecordHash',
        'proposalDigest',
        'proposalId',
        'reasonCodes',
        'sourceRecordHash',
        'state',
        'transitionRevision',
      ]
    : [
        'mode',
        'previousLifecycleRecordHash',
        'proposalDigest',
        'proposalId',
        'sourceRecordHash',
        'state',
        'transitionRevision',
      ];
  if (
    exactPlainRecord(value, expectedKeys) === null
    || !nonNegativeSafeInteger(value.transitionRevision)
    || value.transitionRevision < 1
    || typeof value.sourceRecordHash !== 'string'
    || !SHA256_PATTERN.test(value.sourceRecordHash)
    || (
      value.previousLifecycleRecordHash !== null
      && (
        typeof value.previousLifecycleRecordHash !== 'string'
        || !SHA256_PATTERN.test(value.previousLifecycleRecordHash)
      )
    )
    || (
      value.state === 'BLOCKED'
      && (
        !Array.isArray(value.reasonCodes)
        || value.reasonCodes.length === 0
        || value.reasonCodes.some((reason) => (
          typeof reason !== 'string'
          || !IDENTIFIER_PATTERN.test(reason)
        ))
      )
    )
  ) return null;
  return {
    proposalId: value.proposalId,
    proposalDigest: value.proposalDigest,
    state: value.state as ParsedLifecycleSemantic['state'],
    transitionRevision: value.transitionRevision,
    previousLifecycleRecordHash:
      value.previousLifecycleRecordHash as string | null,
    recordHash: recordHashValue,
  };
}

function byteLengthUtf8(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function cloneAuthority(): VolumeForwardMeasurementEvidenceAuthority {
  return Object.freeze({
    cas: false,
    execution: 'NONE',
    privateData: false,
    signedRequest: false,
    submit: false,
  });
}

function immutableHeader(
  header: VolumeForwardMeasurementEvidenceHeader,
): Readonly<VolumeForwardMeasurementEvidenceHeader> {
  return Object.freeze({
    ...header,
    authority: cloneAuthority(),
  });
}

function immutableRecord(
  record: VolumeForwardMeasurementEvidenceRecord,
): Readonly<VolumeForwardMeasurementEvidenceRecord> {
  return Object.freeze({
    header: immutableHeader(record.header),
    rawBase64: record.rawBase64,
    recordHash: record.recordHash,
  });
}

function immutableCursor(
  cursor: VolumeForwardMeasurementEvidenceCursor,
): Readonly<VolumeForwardMeasurementEvidenceCursor> {
  return Object.freeze({
    chainId: cursor.chainId,
    cumulativeRawPayloadBytes: cursor.cumulativeRawPayloadBytes,
    generation: cursor.generation,
    generationOpen: cursor.generationOpen,
    lastLocalReceivedAtMs: cursor.lastLocalReceivedAtMs,
    lastLocalMonotonicNs: cursor.lastLocalMonotonicNs,
    nextSequence: cursor.nextSequence,
    policyDigest: cursor.policyDigest,
    previousHash: cursor.previousHash,
    sealed: cursor.sealed,
  });
}

function decodeCanonicalBase64(
  rawBase64: unknown,
  recordIndex: number | null,
): VolumeForwardMeasurementEvidenceRawDecodeResult {
  if (
    typeof rawBase64 !== 'string'
    || rawBase64.length > Math.ceil(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes / 3,
    ) * 4
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RAW_PAYLOAD_LIMIT_EXCEEDED',
      recordIndex,
    );
  }
  if (rawBase64.length % 4 !== 0) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'NON_CANONICAL_BASE64',
      recordIndex,
    );
  }
  try {
    const decoded = Buffer.from(rawBase64, 'base64');
    if (decoded.toString('base64') !== rawBase64) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'NON_CANONICAL_BASE64',
        recordIndex,
      );
    }
    if (
      decoded.byteLength
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'RAW_PAYLOAD_LIMIT_EXCEEDED',
        recordIndex,
      );
    }
    return Object.freeze({
      ok: true,
      status: 'DECODED',
      bytes: Uint8Array.from(decoded),
    });
  } catch {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'NON_CANONICAL_BASE64',
      recordIndex,
    );
  }
}

function normalizeRawPayload(
  input: VolumeForwardMeasurementRawPayloadInput,
): VolumeForwardMeasurementEvidenceRawDecodeResult {
  const candidate = input as {
    readonly rawPayload?: unknown;
    readonly rawPayloadBase64?: unknown;
  };
  const hasBytes = candidate.rawPayload !== undefined;
  const hasBase64 = candidate.rawPayloadBase64 !== undefined;
  if (hasBytes === hasBase64) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_CANONICAL_BASE64',
    );
  }
  if (hasBase64) return decodeCanonicalBase64(candidate.rawPayloadBase64, null);
  if (!(candidate.rawPayload instanceof Uint8Array)) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_CANONICAL_BASE64',
    );
  }
  try {
    if (
      candidate.rawPayload.byteLength
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'RAW_PAYLOAD_LIMIT_EXCEEDED',
      );
    }
    return Object.freeze({
      ok: true,
      status: 'DECODED',
      bytes: Uint8Array.from(candidate.rawPayload),
    });
  } catch {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_CANONICAL_BASE64',
    );
  }
}

function monotonicNs(value: unknown): bigint | null {
  if (typeof value !== 'string' || !MONOTONIC_NS_PATTERN.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed <= MAX_MONOTONIC_NS ? parsed : null;
  } catch {
    return null;
  }
}

function safeUtcMs(value: unknown): number | null {
  return (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumUtcMs
  ) ? value : null;
}

function cumulativeRawPayloadBytesAfterAppend(
  currentBytes: unknown,
  appendedBytes: unknown,
): number | null {
  const maximum =
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumCumulativeRawPayloadBytes;
  if (
    typeof currentBytes !== 'number'
    || !Number.isSafeInteger(currentBytes)
    || currentBytes < 0
    || currentBytes > maximum
    || typeof appendedBytes !== 'number'
    || !Number.isSafeInteger(appendedBytes)
    || appendedBytes < 0
    || appendedBytes > maximum - currentBytes
  ) {
    return null;
  }
  const nextBytes = currentBytes + appendedBytes;
  return Number.isSafeInteger(nextBytes) && nextBytes <= maximum
    ? nextBytes
    : null;
}

function recordHash(
  header: VolumeForwardMeasurementEvidenceHeader,
  rawBytes: Uint8Array,
): string | null {
  const canonicalHeader = canonicalJson(header);
  if (canonicalHeader === null) return null;
  const hash = createHash('sha256');
  hash.update(RECORD_HASH_DOMAIN, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(canonicalHeader, 'utf8');
  hash.update(Uint8Array.of(0));
  hash.update(rawBytes);
  return `sha256:${hash.digest('hex')}`;
}

function localSource(): Readonly<{
  sourceEndpoint: typeof VOLUME_FORWARD_MEASUREMENT_LOCAL_ENDPOINT;
  sourceSymbol: null;
  sourceStream: null;
  sourceTransport: 'LOCAL';
}> {
  return Object.freeze({
    sourceEndpoint: VOLUME_FORWARD_MEASUREMENT_LOCAL_ENDPOINT,
    sourceSymbol: null,
    sourceStream: null,
    sourceTransport: 'LOCAL',
  });
}

function isAllowedRestEndpoint(value: string): boolean {
  return (VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_ENDPOINTS as readonly string[])
    .includes(value);
}

function isAllowedRestResource(value: string): boolean {
  return (VOLUME_FORWARD_MEASUREMENT_PUBLIC_REST_RESOURCES as readonly string[])
    .includes(value);
}

function isAllowedStreamEndpoint(value: string): boolean {
  return (
    VOLUME_FORWARD_MEASUREMENT_PUBLIC_STREAM_ENDPOINTS as readonly string[]
  ).includes(value);
}

function isAllowedBinanceStream(value: string): boolean {
  return (
    BINANCE_DIFF_DEPTH_STREAM_PATTERN.test(value)
    || BINANCE_TRADE_STREAM_PATTERN.test(value)
  );
}

function expectedStreamKind(
  stream: string,
): Extract<
  VolumeForwardMeasurementEvidenceKind,
  'DEPTH_DIFF' | 'TRADE' | 'AGG_TRADE' | 'BOOK_TICKER'
> | null {
  if (BINANCE_DIFF_DEPTH_STREAM_PATTERN.test(stream)) return 'DEPTH_DIFF';
  if (stream.endsWith('@trade')) return 'TRADE';
  if (stream.endsWith('@aggTrade')) return 'AGG_TRADE';
  if (stream.endsWith('@bookTicker')) return 'BOOK_TICKER';
  return null;
}

function sourceFailure(
  header: Pick<
    VolumeForwardMeasurementEvidenceHeader,
    'kind' | 'sourceEndpoint' | 'sourceSymbol' | 'sourceStream' | 'sourceTransport'
  >,
  recordIndex: number | null,
): VolumeForwardMeasurementEvidenceFailure | null {
  if (LOCAL_KINDS.has(header.kind)) {
    if (header.sourceTransport !== 'LOCAL') {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_TRANSPORT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      header.sourceEndpoint !== VOLUME_FORWARD_MEASUREMENT_LOCAL_ENDPOINT
      || header.sourceSymbol !== null
      || header.sourceStream !== null
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'LOCAL_SOURCE_INVALID',
        recordIndex,
      );
    }
    return null;
  }
  if (PUBLIC_REST_KINDS.has(header.kind)) {
    if (header.sourceTransport !== 'BINANCE_SPOT_PUBLIC_REST') {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_TRANSPORT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (!isAllowedRestEndpoint(header.sourceEndpoint)) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_ENDPOINT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      header.sourceSymbol === null
      || !BINANCE_SYMBOL_PATTERN.test(header.sourceSymbol)
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_STREAM_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      header.sourceStream === null
      || !isAllowedRestResource(header.sourceStream)
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_STREAM_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      (header.kind === 'EXCHANGE_INFO'
        && header.sourceStream !== '/api/v3/exchangeInfo')
      || (header.kind === 'DEPTH_SNAPSHOT'
        && header.sourceStream !== '/api/v3/depth')
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'RECORD_KIND_SOURCE_MISMATCH',
        recordIndex,
      );
    }
    return null;
  }
  if (header.kind === 'STREAM_FRAME') {
    if (header.sourceTransport !== 'BINANCE_SPOT_PUBLIC_STREAM') {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_TRANSPORT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (!isAllowedStreamEndpoint(header.sourceEndpoint)) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_ENDPOINT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      header.sourceSymbol === null
      || !BINANCE_SYMBOL_PATTERN.test(header.sourceSymbol)
      || header.sourceStream !== null
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_STREAM_UNSUPPORTED',
        recordIndex,
      );
    }
    return null;
  }
  if (PUBLIC_STREAM_KINDS.has(header.kind)) {
    if (header.sourceTransport !== 'BINANCE_SPOT_PUBLIC_STREAM') {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_TRANSPORT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (!isAllowedStreamEndpoint(header.sourceEndpoint)) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_ENDPOINT_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      header.sourceSymbol === null
      || !BINANCE_SYMBOL_PATTERN.test(header.sourceSymbol)
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_STREAM_UNSUPPORTED',
        recordIndex,
      );
    }
    if (
      header.sourceStream === null
      || !isAllowedBinanceStream(header.sourceStream)
      || !header.sourceStream.startsWith(
        `${header.sourceSymbol.toLowerCase()}@`,
      )
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'SOURCE_STREAM_UNSUPPORTED',
        recordIndex,
      );
    }
    if (expectedStreamKind(header.sourceStream) !== header.kind) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'RECORD_KIND_SOURCE_MISMATCH',
        recordIndex,
      );
    }
    return null;
  }
  return failure(
    VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
    'RECORD_KIND_INVALID',
    recordIndex,
  );
}

function validateAuthority(
  value: unknown,
  recordIndex: number | null,
): VolumeForwardMeasurementEvidenceFailure | null {
  const authority = exactPlainRecord(value, AUTHORITY_KEYS);
  if (
    authority === null
    || authority.cas !== false
    || authority.execution !== 'NONE'
    || authority.privateData !== false
    || authority.signedRequest !== false
    || authority.submit !== false
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'AUTHORITY_ENVELOPE_INVALID',
      recordIndex,
    );
  }
  return null;
}

function validateHeader(
  value: unknown,
  recordIndex: number | null,
): VolumeForwardMeasurementEvidenceHeader | VolumeForwardMeasurementEvidenceFailure {
  const header = exactPlainRecord(value, HEADER_KEYS);
  if (header === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'HEADER_KEYS_INVALID',
      recordIndex,
    );
  }
  if (
    header.schema !== VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA
    || header.schemaVersion !== VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'SCHEMA_UNSUPPORTED',
      recordIndex,
    );
  }
  const authorityProblem = validateAuthority(header.authority, recordIndex);
  if (authorityProblem !== null) return authorityProblem;
  if (
    typeof header.chainId !== 'string'
    || !CHAIN_ID_PATTERN.test(header.chainId)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CHAIN_ID_INVALID',
      recordIndex,
    );
  }
  if (
    typeof header.kind !== 'string'
    || !RECORD_KINDS.has(header.kind as VolumeForwardMeasurementEvidenceKind)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RECORD_KIND_INVALID',
      recordIndex,
    );
  }
  if (
    typeof header.sequence !== 'number'
    || !Number.isSafeInteger(header.sequence)
    || header.sequence < 0
    || header.sequence
      >= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RECORD_COUNT_LIMIT_EXCEEDED',
      recordIndex,
    );
  }
  if (
    typeof header.generation !== 'number'
    || !Number.isSafeInteger(header.generation)
    || header.generation < 0
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'GENERATION_OUT_OF_ORDER',
      recordIndex,
    );
  }
  if (safeUtcMs(header.localReceivedAtMs) === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'LOCAL_RECEIVED_AT_MS_INVALID',
      recordIndex,
    );
  }
  if (monotonicNs(header.localMonotonicNs) === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_MONOTONIC_RECEIVE_CLOCK',
      recordIndex,
    );
  }
  if (
    typeof header.policyDigest !== 'string'
    || !SHA256_PATTERN.test(header.policyDigest)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
      'POLICY_DIGEST_INVALID',
      recordIndex,
    );
  }
  if (
    header.previousHash !== null
    && (
      typeof header.previousHash !== 'string'
      || !SHA256_PATTERN.test(header.previousHash)
    )
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'PREVIOUS_HASH_MISMATCH',
      recordIndex,
    );
  }
  if (
    typeof header.rawByteLength !== 'number'
    || !Number.isSafeInteger(header.rawByteLength)
    || header.rawByteLength < 0
    || header.rawByteLength
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RAW_PAYLOAD_LIMIT_EXCEEDED',
      recordIndex,
    );
  }
  if (
    typeof header.rawSha256 !== 'string'
    || !SHA256_PATTERN.test(header.rawSha256)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RAW_SHA256_MISMATCH',
      recordIndex,
    );
  }
  if (
    header.sourceTransport !== 'LOCAL'
    && header.sourceTransport !== 'BINANCE_SPOT_PUBLIC_REST'
    && header.sourceTransport !== 'BINANCE_SPOT_PUBLIC_STREAM'
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'SOURCE_TRANSPORT_UNSUPPORTED',
      recordIndex,
    );
  }
  if (
    typeof header.sourceEndpoint !== 'string'
    || (
      header.sourceSymbol !== null
      && typeof header.sourceSymbol !== 'string'
    )
    || (
      header.sourceStream !== null
      && typeof header.sourceStream !== 'string'
    )
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'SOURCE_ENDPOINT_UNSUPPORTED',
      recordIndex,
    );
  }
  if (typeof header.terminal !== 'boolean') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'TERMINAL_FLAG_INVALID',
      recordIndex,
    );
  }
  if (
    typeof header.sealedRecordCount === 'number'
    && (
      !Number.isSafeInteger(header.sealedRecordCount)
      || header.sealedRecordCount
        > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
    )
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RECORD_COUNT_LIMIT_EXCEEDED',
      recordIndex,
    );
  }
  const sealFieldsValid = (
    header.sealedRecordCount === null
    || (
      typeof header.sealedRecordCount === 'number'
      && Number.isSafeInteger(header.sealedRecordCount)
      && header.sealedRecordCount > 0
      && header.sealedRecordCount
        <= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
    )
  ) && (
    header.sealedTailHash === null
    || (
      typeof header.sealedTailHash === 'string'
      && SHA256_PATTERN.test(header.sealedTailHash)
    )
  );
  if (!sealFieldsValid) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'SEAL_COUNT_MISMATCH',
      recordIndex,
    );
  }
  const typed = header as unknown as VolumeForwardMeasurementEvidenceHeader;
  const canonicalHeader = canonicalJson(typed);
  if (
    canonicalHeader === null
    || byteLengthUtf8(canonicalHeader)
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumHeaderBytes
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'HEADER_LIMIT_EXCEEDED',
      recordIndex,
    );
  }
  const sourceProblem = sourceFailure(typed, recordIndex);
  if (sourceProblem !== null) return sourceProblem;
  return typed;
}

function validateRecordShape(
  value: unknown,
  recordIndex: number | null,
): VolumeForwardMeasurementEvidenceRecord | VolumeForwardMeasurementEvidenceFailure {
  const record = exactPlainRecord(value, RECORD_KEYS);
  if (record === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RECORD_KEYS_INVALID',
      recordIndex,
    );
  }
  const header = validateHeader(record.header, recordIndex);
  if (isFailure(header)) return header;
  if (typeof record.rawBase64 !== 'string') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RECORD_HASH_INVALID',
      recordIndex,
    );
  }
  if (
    record.rawBase64.length > Math.ceil(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes / 3,
    ) * 4
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RAW_PAYLOAD_LIMIT_EXCEEDED',
      recordIndex,
    );
  }
  if (
    typeof record.recordHash !== 'string'
    || !SHA256_PATTERN.test(record.recordHash)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RECORD_HASH_INVALID',
      recordIndex,
    );
  }
  return {
    header,
    rawBase64: record.rawBase64,
    recordHash: record.recordHash,
  };
}

function makeRecord(
  cursor: Readonly<VolumeForwardMeasurementEvidenceCursor>,
  input: Readonly<{
    generation: number;
    kind: VolumeForwardMeasurementEvidenceKind;
    localReceivedAtMs: number;
    localMonotonicNs: string;
    sealedRecordCount: number | null;
    sealedTailHash: string | null;
    sourceEndpoint: string;
    sourceSymbol: string | null;
    sourceStream: string | null;
    sourceTransport: VolumeForwardMeasurementEvidenceTransport;
    terminal: boolean;
  }>,
  rawBytes: Uint8Array,
): VolumeForwardMeasurementEvidenceStepResult {
  if (
    cursor.nextSequence
    >= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RECORD_COUNT_LIMIT_EXCEEDED',
    );
  }
  const nextCumulativeRawPayloadBytes =
    cumulativeRawPayloadBytesAfterAppend(
      cursor.cumulativeRawPayloadBytes,
      rawBytes.byteLength,
    );
  if (nextCumulativeRawPayloadBytes === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'CUMULATIVE_RAW_PAYLOAD_LIMIT_EXCEEDED',
    );
  }
  if (
    monotonicNs(input.localMonotonicNs) === null
    || BigInt(input.localMonotonicNs) < BigInt(cursor.lastLocalMonotonicNs)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_MONOTONIC_RECEIVE_CLOCK',
    );
  }
  if (
    safeUtcMs(input.localReceivedAtMs) === null
    || input.localReceivedAtMs < cursor.lastLocalReceivedAtMs
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_MONOTONIC_RECEIVE_UTC_CLOCK',
    );
  }
  const rawSha256 = sha256(rawBytes);
  const header: VolumeForwardMeasurementEvidenceHeader = {
    authority: cloneAuthority(),
    chainId: cursor.chainId,
    generation: input.generation,
    kind: input.kind,
    localReceivedAtMs: input.localReceivedAtMs,
    localMonotonicNs: input.localMonotonicNs,
    policyDigest: cursor.policyDigest,
    previousHash: cursor.previousHash,
    rawByteLength: rawBytes.byteLength,
    rawSha256,
    schema: VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA,
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
    sealedRecordCount: input.sealedRecordCount,
    sealedTailHash: input.sealedTailHash,
    sequence: cursor.nextSequence,
    sourceEndpoint: input.sourceEndpoint,
    sourceSymbol: input.sourceSymbol,
    sourceStream: input.sourceStream,
    sourceTransport: input.sourceTransport,
    terminal: input.terminal,
  };
  const sourceProblem = sourceFailure(header, null);
  if (sourceProblem !== null) return sourceProblem;
  const hash = recordHash(header, rawBytes);
  if (hash === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'HEADER_KEYS_INVALID',
    );
  }
  const record = immutableRecord({
    header,
    rawBase64: Buffer.from(rawBytes).toString('base64'),
    recordHash: hash,
  });
  const cursorResult = immutableCursor({
    chainId: cursor.chainId,
    cumulativeRawPayloadBytes: nextCumulativeRawPayloadBytes,
    generation: input.generation,
    generationOpen: cursor.generationOpen,
    lastLocalReceivedAtMs: input.localReceivedAtMs,
    lastLocalMonotonicNs: input.localMonotonicNs,
    nextSequence: cursor.nextSequence + 1,
    policyDigest: cursor.policyDigest,
    previousHash: hash,
    sealed: input.terminal,
  });
  return Object.freeze({
    ok: true,
    status: 'APPENDED',
    cursor: cursorResult,
    record,
  });
}

function validateCursor(
  cursor: unknown,
): cursor is Readonly<VolumeForwardMeasurementEvidenceCursor> {
  const value = exactPlainRecord(cursor, CURSOR_KEYS);
  if (value === null) return false;
  return (
    typeof value.chainId === 'string'
    && CHAIN_ID_PATTERN.test(value.chainId)
    && cumulativeRawPayloadBytesAfterAppend(
      value.cumulativeRawPayloadBytes,
      0,
    ) !== null
    && typeof value.generation === 'number'
    && Number.isSafeInteger(value.generation)
    && value.generation >= 0
    && typeof value.generationOpen === 'boolean'
    && safeUtcMs(value.lastLocalReceivedAtMs) !== null
    && monotonicNs(value.lastLocalMonotonicNs) !== null
    && typeof value.nextSequence === 'number'
    && Number.isSafeInteger(value.nextSequence)
    && value.nextSequence >= 1
    && value.nextSequence
      <= VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
    && typeof value.policyDigest === 'string'
    && SHA256_PATTERN.test(value.policyDigest)
    && typeof value.previousHash === 'string'
    && SHA256_PATTERN.test(value.previousHash)
    && typeof value.sealed === 'boolean'
  );
}

export function sha256VolumeForwardMeasurementEvidenceBytes(
  bytes: Uint8Array,
): string | null {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRawPayloadBytes
  ) {
    return null;
  }
  try {
    return sha256(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

export function decodeVolumeForwardMeasurementEvidenceRawBytes(
  record: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): VolumeForwardMeasurementEvidenceRawDecodeResult {
  const shaped = validateRecordShape(record, null);
  if (isFailure(shaped)) return shaped;
  const decoded = decodeCanonicalBase64(shaped.rawBase64, null);
  if (!decoded.ok) return decoded;
  if (decoded.bytes.byteLength !== shaped.header.rawByteLength) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RAW_BYTE_LENGTH_MISMATCH',
    );
  }
  if (sha256(decoded.bytes) !== shaped.header.rawSha256) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RAW_SHA256_MISMATCH',
    );
  }
  return decoded;
}

export function startVolumeForwardMeasurementEvidenceChain(
  input: StartVolumeForwardMeasurementEvidenceInput,
): VolumeForwardMeasurementEvidenceStepResult {
  if (
    input === null
    || typeof input !== 'object'
    || typeof input.chainId !== 'string'
    || !CHAIN_ID_PATTERN.test(input.chainId)
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CHAIN_ID_INVALID',
    );
  }
  if (monotonicNs(input.localMonotonicNs) === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'NON_MONOTONIC_RECEIVE_CLOCK',
    );
  }
  if (safeUtcMs(input.localReceivedAtMs) === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'LOCAL_RECEIVED_AT_MS_INVALID',
    );
  }
  const decoded = normalizeRawPayload(input);
  if (!decoded.ok) return decoded;
  const policyDigest = sha256(decoded.bytes);
  const source = localSource();
  const header: VolumeForwardMeasurementEvidenceHeader = {
    authority: cloneAuthority(),
    chainId: input.chainId,
    generation: 0,
    kind: 'POLICY',
    localReceivedAtMs: input.localReceivedAtMs,
    localMonotonicNs: input.localMonotonicNs,
    policyDigest,
    previousHash: null,
    rawByteLength: decoded.bytes.byteLength,
    rawSha256: policyDigest,
    schema: VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA,
    schemaVersion: VOLUME_FORWARD_MEASUREMENT_EVIDENCE_SCHEMA_VERSION,
    sealedRecordCount: null,
    sealedTailHash: null,
    sequence: 0,
    sourceEndpoint: source.sourceEndpoint,
    sourceSymbol: source.sourceSymbol,
    sourceStream: source.sourceStream,
    sourceTransport: source.sourceTransport,
    terminal: false,
  };
  const hash = recordHash(header, decoded.bytes);
  if (hash === null) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'HEADER_KEYS_INVALID',
    );
  }
  const record = immutableRecord({
    header,
    rawBase64: Buffer.from(decoded.bytes).toString('base64'),
    recordHash: hash,
  });
  const cursor = immutableCursor({
    chainId: input.chainId,
    cumulativeRawPayloadBytes: decoded.bytes.byteLength,
    generation: 0,
    generationOpen: false,
    lastLocalReceivedAtMs: input.localReceivedAtMs,
    lastLocalMonotonicNs: input.localMonotonicNs,
    nextSequence: 1,
    policyDigest,
    previousHash: hash,
    sealed: false,
  });
  return Object.freeze({
    ok: true,
    status: 'APPENDED',
    cursor,
    record,
  });
}

export function appendVolumeForwardMeasurementEvidence(
  cursor: Readonly<VolumeForwardMeasurementEvidenceCursor>,
  input: AppendVolumeForwardMeasurementEvidenceInput,
): VolumeForwardMeasurementEvidenceStepResult {
  if (!validateCursor(cursor)) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CURSOR_INVALID',
    );
  }
  if (input === null || typeof input !== 'object') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'RECORD_HASH_INVALID',
    );
  }
  if (cursor.sealed) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CHAIN_ALREADY_SEALED',
    );
  }
  const suppliedKind = input.kind as VolumeForwardMeasurementEvidenceKind;
  if (
    !RECORD_KINDS.has(suppliedKind)
    || suppliedKind === 'POLICY'
    || suppliedKind === 'TERMINAL_SEAL'
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RECORD_KIND_INVALID',
    );
  }
  const decoded = normalizeRawPayload(input);
  if (!decoded.ok) return decoded;

  let generation = cursor.generation;
  let generationOpen = cursor.generationOpen;
  if (input.kind === 'GENERATION_OPEN') {
    if (generationOpen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'GENERATION_ALREADY_OPEN',
      );
    }
    generation += 1;
    generationOpen = true;
  } else if (input.kind === 'GENERATION_CLOSE') {
    if (!generationOpen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'GENERATION_NOT_OPEN',
      );
    }
    generationOpen = false;
  } else if (
    PUBLIC_REST_KINDS.has(input.kind)
    || input.kind === 'STREAM_FRAME'
    || PUBLIC_STREAM_KINDS.has(input.kind)
    || input.kind === 'CONTINUITY'
    || input.kind === 'DETECTOR_PROPOSAL'
    || input.kind === 'LIFECYCLE_RECORD'
  ) {
    if (!generationOpen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'GENERATION_NOT_OPEN',
      );
    }
  }

  const source = LOCAL_KINDS.has(input.kind)
    ? localSource()
    : {
        sourceEndpoint: input.sourceEndpoint ?? '',
        sourceSymbol: input.sourceSymbol ?? null,
        sourceStream: input.sourceStream ?? null,
        sourceTransport: input.sourceTransport ?? (
          PUBLIC_REST_KINDS.has(input.kind)
            ? 'BINANCE_SPOT_PUBLIC_REST'
            : 'BINANCE_SPOT_PUBLIC_STREAM'
        ),
      };
  const result = makeRecord(cursor, {
    generation,
    kind: input.kind,
    localReceivedAtMs: input.localReceivedAtMs,
    localMonotonicNs: input.localMonotonicNs,
    sealedRecordCount: null,
    sealedTailHash: null,
    sourceEndpoint: source.sourceEndpoint,
    sourceSymbol: source.sourceSymbol,
    sourceStream: source.sourceStream,
    sourceTransport: source.sourceTransport,
    terminal: false,
  }, decoded.bytes);
  if (!result.ok) return result;
  if (
    input.kind === 'DETECTOR_COVERAGE'
    && parseDetectorCoverageCutSemantic(
      decoded.bytes,
      result.record.header,
    ) === null
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'DETECTOR_COVERAGE_CUT_INVALID',
    );
  }
  return Object.freeze({
    ...result,
    cursor: immutableCursor({
      ...result.cursor,
      generationOpen,
    }),
  });
}

export function sealVolumeForwardMeasurementEvidenceChain(
  cursor: Readonly<VolumeForwardMeasurementEvidenceCursor>,
  input: SealVolumeForwardMeasurementEvidenceInput,
): VolumeForwardMeasurementEvidenceStepResult {
  if (!validateCursor(cursor)) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CURSOR_INVALID',
    );
  }
  if (input === null || typeof input !== 'object') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'RECORD_HASH_INVALID',
    );
  }
  if (cursor.sealed) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'CHAIN_ALREADY_SEALED',
    );
  }
  if (cursor.generationOpen) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
      'GENERATION_LEFT_OPEN',
    );
  }
  const decoded = normalizeRawPayload(input);
  if (!decoded.ok) return decoded;
  const terminalObject = jsonObjectFromBytes(decoded.bytes);
  const terminalMarker = terminalObject !== null && (
    terminalObject.schemaVersion
      === VOLUME_FORWARD_MEASUREMENT_SEGMENT_SEAL_SCHEMA
    || terminalObject.profile === VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE
  );
  if (terminalMarker) {
    const seal = parseTerminalSegmentSealSemantic(decoded.bytes);
    if (
      seal === null
      || seal.value.corePolicyDigest !== cursor.policyDigest
      || seal.recordBounds.sealedTailHash !== cursor.previousHash
      || seal.recordBounds.firstSequence !== 0
      || seal.recordBounds.lastSequence !== cursor.nextSequence - 1
      || seal.recordBounds.recordCount !== cursor.nextSequence
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'TERMINAL_SEGMENT_PROFILE_INVALID',
      );
    }
  }
  const source = localSource();
  return makeRecord(cursor, {
    generation: cursor.generation,
    kind: 'TERMINAL_SEAL',
    localReceivedAtMs: input.localReceivedAtMs,
    localMonotonicNs: input.localMonotonicNs,
    sealedRecordCount: cursor.nextSequence + 1,
    sealedTailHash: cursor.previousHash,
    sourceEndpoint: source.sourceEndpoint,
    sourceSymbol: source.sourceSymbol,
    sourceStream: source.sourceStream,
    sourceTransport: source.sourceTransport,
    terminal: true,
  }, decoded.bytes);
}

function classifySequenceFailure(
  records: readonly VolumeForwardMeasurementEvidenceRecord[],
): VolumeForwardMeasurementEvidenceFailure | null {
  const seen = new Set<number>();
  let allExpectedSequencesExist = true;
  const present = new Set(records.map((record) => record.header.sequence));
  for (let index = 0; index < records.length; index += 1) {
    const sequence = records[index].header.sequence;
    if (seen.has(sequence)) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.DUPLICATED,
        'DUPLICATE_SEQUENCE',
        index,
      );
    }
    seen.add(sequence);
    if (!present.has(index)) allExpectedSequencesExist = false;
  }
  for (let index = 0; index < records.length; index += 1) {
    if (records[index].header.sequence !== index) {
      if (allExpectedSequencesExist) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.REORDERED,
          'RECORD_REORDERED',
          index,
        );
      }
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.DELETED,
        'RECORD_SEQUENCE_DELETED',
        index,
      );
    }
  }
  return null;
}

function verifyTerminalSegmentSemantics(
  records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
  rawPayloads: readonly Uint8Array[],
  canonicalLineBytes: readonly number[],
  policyDigest: string,
  sealed: boolean,
): VolumeForwardMeasurementEvidenceFailure | null {
  const cuts: Array<Readonly<{
    index: number;
    record: Readonly<VolumeForwardMeasurementEvidenceRecord>;
    value: Readonly<VolumeForwardMeasurementDetectorCoverageCut>;
  }>> = [];
  const acceptedIds = new Set<string>();
  let priorCut: Readonly<VolumeForwardMeasurementDetectorCoverageCut> | null =
    null;
  for (let index = 0; index < records.length; index += 1) {
    if (records[index]?.header.kind !== 'DETECTOR_COVERAGE') continue;
    const value = parseDetectorCoverageCutSemantic(
      rawPayloads[index],
      records[index].header,
    );
    if (value === null) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'DETECTOR_COVERAGE_CUT_INVALID',
        index,
      );
    }
    if (
      priorCut !== null
      && (
        value.cutOffset !== priorCut.cutOffset + 1
        || value.cutAtMs
          !== priorCut.cutAtMs
            + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
        || value.detectorTickRevision
          !== priorCut.detectorTickRevision + 1
        || value.previousCutDigest !== priorCut.cutDigest
        || value.localReceivedAtMs <= priorCut.localReceivedAtMs
        || BigInt(value.localMonotonicNs)
          <= BigInt(priorCut.localMonotonicNs)
        || value.captureId !== priorCut.captureId
        || value.activationId !== priorCut.activationId
        || value.segmentId !== priorCut.segmentId
        || value.chainKey !== priorCut.chainKey
        || value.detectorInputSourceId
          !== priorCut.detectorInputSourceId
        || value.detectorInputSourceDigest
          !== priorCut.detectorInputSourceDigest
      )
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'DETECTOR_COVERAGE_SEQUENCE_INVALID',
        index,
      );
    }
    for (const proposal of value.acceptedProposals) {
      if (acceptedIds.has(proposal.proposalId)) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.DUPLICATED,
          'DETECTOR_COVERAGE_SEQUENCE_INVALID',
          index,
        );
      }
      acceptedIds.add(proposal.proposalId);
    }
    cuts.push(Object.freeze({ index, record: records[index], value }));
    priorCut = value;
  }

  const terminalIndex = records.length - 1;
  const terminalRecord = records[terminalIndex];
  const terminalObject = terminalRecord?.header.kind === 'TERMINAL_SEAL'
    ? jsonObjectFromBytes(rawPayloads[terminalIndex])
    : null;
  const terminalMarker = terminalObject !== null && (
    terminalObject.schemaVersion
      === VOLUME_FORWARD_MEASUREMENT_SEGMENT_SEAL_SCHEMA
    || terminalObject.profile === VOLUME_FORWARD_MEASUREMENT_SEGMENT_PROFILE
  );
  if (cuts.length === 0 && !terminalMarker) return null;
  if (!sealed) return null;
  if (
    terminalRecord?.header.kind !== 'TERMINAL_SEAL'
    || terminalObject === null
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'TERMINAL_SEGMENT_PROFILE_INVALID',
      terminalIndex,
    );
  }
  const seal = parseTerminalSegmentSealSemantic(
    rawPayloads[terminalIndex],
  );
  if (seal === null || cuts.length === 0) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'TERMINAL_SEGMENT_PROFILE_INVALID',
      terminalIndex,
    );
  }

  const firstCut = cuts[0].value;
  const lastCut = cuts[cuts.length - 1].value;
  const acceptedProposals = cuts
    .flatMap((cut) => cut.value.acceptedProposals)
    .map((proposal) => ({
      proposalId: proposal.proposalId,
      proposalRevision: proposal.proposalRevision,
      proposalDigest: proposal.proposalDigest,
      symbol: proposal.symbol,
    }))
    .sort((left, right) => compareText(
      terminalProposalSortKey(left),
      terminalProposalSortKey(right),
    ));
  const pseudoProposalExcludedCount = cuts.reduce(
    (total, cut) => total + cut.value.pseudoProposalExcludedCount,
    0,
  );
  if (!Number.isSafeInteger(pseudoProposalExcludedCount)) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
      terminalIndex,
    );
  }
  let maximumScheduledCutGapMs = 0;
  for (let index = 1; index < cuts.length; index += 1) {
    maximumScheduledCutGapMs = Math.max(
      maximumScheduledCutGapMs,
      cuts[index].value.cutAtMs
        - cuts[index - 1].value.cutAtMs,
    );
  }
  const value = seal.value;
  const coverage = seal.coverage;
  const recordBounds = seal.recordBounds;
  const generationSummary = seal.generationSummary;
  const detectorCoverage = seal.detectorCoverage;
  const lifecycleSummary = seal.lifecycleSummary;
  const preSealJsonlBytes = canonicalLineBytes
    .slice(0, terminalIndex)
    .reduce((total, count) => total + count, 0);
  const expectedCutCount = (
    (coverage.endExclusiveMs as number)
      - (coverage.startMs as number)
  ) / VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS;

  const lifecycleClaims: ParsedLifecycleSemantic[] = [];
  for (let index = 0; index < records.length; index += 1) {
    if (records[index]?.header.kind !== 'LIFECYCLE_RECORD') continue;
    const claim = parseLifecycleSemantic(
      rawPayloads[index],
      records[index].recordHash,
    );
    if (claim === null) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
        index,
      );
    }
    lifecycleClaims.push(claim);
  }
  const lifecycleStateCounts: Record<
    ParsedLifecycleSemantic['state'],
    number
  > = {
    OBSERVED: 0,
    ENTRY_RECORDED: 0,
    HOLDING: 0,
    TERMINAL_EXIT: 0,
    BLOCKED: 0,
    EXACT: 0,
  };
  const lifecycleLast = new Map<string, ParsedLifecycleSemantic>();
  for (const claim of lifecycleClaims) {
    lifecycleStateCounts[claim.state] += 1;
    const prior = lifecycleLast.get(claim.proposalId);
    if (
      (prior === undefined && (
        claim.transitionRevision !== 1
        || claim.previousLifecycleRecordHash !== null
      ))
      || (prior !== undefined && (
        claim.proposalDigest !== prior.proposalDigest
        || claim.transitionRevision !== prior.transitionRevision + 1
        || claim.previousLifecycleRecordHash !== prior.recordHash
      ))
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
        terminalIndex,
      );
    }
    lifecycleLast.set(claim.proposalId, claim);
  }
  const lifecycleOpenCount = [...lifecycleLast.values()].filter(
    (claim) => ![
      'TERMINAL_EXIT',
      'EXACT',
      'BLOCKED',
    ].includes(claim.state),
  ).length;
  const runtimeGenerations = new Set(
    cuts.map((cut) => cut.value.runtimeGeneration),
  );
  const generationCloseRecords = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.header.kind === 'GENERATION_CLOSE');
  let generationContinuityGapCount = 0;
  let generationUnresolvedCount = 0;
  for (const { index } of generationCloseRecords) {
    const close = jsonObjectFromBytes(rawPayloads[index]);
    if (close?.gapDetected === true) generationContinuityGapCount += 1;
    if (
      close?.continuity !== 'CONTIGUOUS'
      || close?.depthBridgeExact !== true
    ) generationUnresolvedCount += 1;
  }

  const detectorCoverageRole = value.coverageRole === 'DETECTOR_COVERAGE';
  const expectedGenerationCount = detectorCoverageRole
    ? runtimeGenerations.size
    : generationCloseRecords.length;
  const expectedContinuityGapCount = detectorCoverageRole
    ? 0
    : generationContinuityGapCount;
  const expectedUnresolvedCount = detectorCoverageRole
    ? 0
    : generationUnresolvedCount;
  const expectedLifecycleProposalKeys = detectorCoverageRole
    ? []
    : acceptedProposals;

  const sharedMismatch = (
    value.corePolicyDigest !== policyDigest
    || value.captureId !== firstCut.captureId
    || value.activationId !== firstCut.activationId
    || value.segmentId !== firstCut.segmentId
    || value.chainKey !== firstCut.chainKey
    || value.detectorInputSourceId !== firstCut.detectorInputSourceId
    || value.detectorInputSourceDigest
      !== firstCut.detectorInputSourceDigest
    || coverage.startMs !== firstCut.cutAtMs
    || coverage.endExclusiveMs
      !== lastCut.cutAtMs
        + VOLUME_FORWARD_MEASUREMENT_DETECTOR_CADENCE_MS
    || !Number.isSafeInteger(expectedCutCount)
    || expectedCutCount <= 0
    || expectedCutCount !== cuts.length
    || recordBounds.firstHash !== records[0]?.recordHash
    || recordBounds.sealedTailHash !== terminalRecord.header.sealedTailHash
    || recordBounds.sealedTailHash
      !== records[terminalIndex - 1]?.recordHash
    || recordBounds.firstSequence !== 0
    || recordBounds.lastSequence !== terminalIndex - 1
    || recordBounds.recordCount !== terminalIndex
    || recordBounds.byteCount !== preSealJsonlBytes
    || generationSummary.count !== expectedGenerationCount
    || generationSummary.continuityGapCount
      !== expectedContinuityGapCount
    || generationSummary.unresolvedCount !== expectedUnresolvedCount
    || generationSummary.continuityGapCount !== 0
    || generationSummary.unresolvedCount !== 0
    || detectorCoverage.coverageChainKey !== value.chainKey
    || (
      value.segmentIndex === 0
        ? firstCut.cutOffset !== 0
        : firstCut.cutOffset === 0
    )
    || detectorCoverage.firstCutOffset !== firstCut.cutOffset
    || detectorCoverage.lastCutOffset !== lastCut.cutOffset
    || detectorCoverage.cutCount !== cuts.length
    || detectorCoverage.expectedCutCount !== expectedCutCount
    || detectorCoverage.missingCutCount !== 0
    || detectorCoverage.maxGapMs !== maximumScheduledCutGapMs
    || detectorCoverage.uncoveredMs !== 0
    || detectorCoverage.firstCutDigest !== firstCut.cutDigest
    || detectorCoverage.lastCutDigest !== lastCut.cutDigest
    || detectorCoverage.complete !== true
    || cuts.some((cut) => (
      cut.value.complete !== true
      || cut.value.observerDropCount !== 0
      || cut.value.observerFailureCount !== 0
    ))
    || !canonicalEqual(seal.acceptedProposals, acceptedProposals)
    || value.pseudoProposalExcludedCount
      !== pseudoProposalExcludedCount
    || lifecycleSummary.assertionCount !== lifecycleClaims.length
    || lifecycleSummary.openCount !== lifecycleOpenCount
    || !canonicalEqual(
      seal.lifecycleStateCounts,
      lifecycleStateCounts,
    )
    || !canonicalEqual(
      seal.lifecycleProposalKeys,
      expectedLifecycleProposalKeys,
    )
  );
  if (sharedMismatch) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
      terminalIndex,
    );
  }

  if (
    detectorCoverageRole
      ? (
          value.symbol !== null
          || lifecycleClaims.length !== 0
          || records.slice(1, -1).some(
            (record) => record.header.kind !== 'DETECTOR_COVERAGE',
          )
        )
      : (
          typeof value.symbol !== 'string'
          || acceptedProposals.some(
            (proposal) => proposal.symbol !== value.symbol,
          )
          || cuts.some((cut) => (
            cut.record.header.generation
              !== cut.value.runtimeGeneration
          ))
          || lifecycleLast.size !== acceptedProposals.length
          || acceptedProposals.some((proposal) => (
            !lifecycleLast.has(proposal.proposalId as string)
          ))
          || lifecycleOpenCount !== 0
        )
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'TERMINAL_SEGMENT_SUMMARY_MISMATCH',
      terminalIndex,
    );
  }
  return null;
}

function verifyVolumeForwardMeasurementEvidenceChainNormalized(
  candidates: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
  options: Readonly<NormalizedVolumeForwardMeasurementEvidenceOptions>,
): VolumeForwardMeasurementEvidenceVerificationResult {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
      'EMPTY_CHAIN',
    );
  }
  if (
    candidates.length
    > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'RECORD_COUNT_LIMIT_EXCEEDED',
    );
  }
  const records: VolumeForwardMeasurementEvidenceRecord[] = [];
  const canonicalLineByteCounts: number[] = [];
  let canonicalJsonlBytes = 0;
  let declaredRawPayloadBytes = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const shaped = validateRecordShape(candidates[index], index);
    if (isFailure(shaped)) return shaped;
    if (
      shaped.header.rawByteLength
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS
        .maximumCumulativeRawPayloadBytes - declaredRawPayloadBytes
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'CUMULATIVE_RAW_PAYLOAD_LIMIT_EXCEEDED',
        index,
      );
    }
    declaredRawPayloadBytes += shaped.header.rawByteLength;
    const canonicalRecord = canonicalJson(shaped);
    if (canonicalRecord === null) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'NON_CANONICAL_JSONL',
        index,
      );
    }
    const canonicalLineBytes = byteLengthUtf8(canonicalRecord) + 1;
    if (canonicalLineBytes > options.maximumLineBytes) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'JSONL_LINE_LIMIT_EXCEEDED',
        index,
      );
    }
    if (canonicalLineBytes > options.maximumJsonlBytes - canonicalJsonlBytes) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'JSONL_LIMIT_EXCEEDED',
        index,
      );
    }
    canonicalJsonlBytes += canonicalLineBytes;
    canonicalLineByteCounts.push(canonicalLineBytes);
    records.push(shaped);
  }
  const sequenceProblem = classifySequenceFailure(records);
  if (sequenceProblem !== null) return sequenceProblem;
  if (records[0].header.kind !== 'POLICY') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
      'POLICY_NOT_FIRST',
      0,
    );
  }
  if (
    records[0].header.previousHash !== null
    || records[0].header.generation !== 0
    || records[0].header.terminal
    || records[0].header.sealedRecordCount !== null
    || records[0].header.sealedTailHash !== null
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'POLICY_NOT_FIRST',
      0,
    );
  }

  const chainId = records[0].header.chainId;
  const policyDigest = records[0].header.policyDigest;
  let previousHash: string | null = null;
  let priorReceivedAtMs = -1;
  let priorMonotonic = -1n;
  let generation = 0;
  let generationOpen = false;
  let sealed = false;
  let configStateSeen = false;
  let killStateSeen = false;
  let detectorProposalSeen = false;
  let completePublicBundleSeen = false;
  let firstMissingGenerationContinuityIndex: number | null = null;
  let currentGenerationKinds:
    Set<VolumeForwardMeasurementEvidenceKind> | null = null;
  let cumulativeRawPayloadBytes = 0;
  const hashes = new Set<string>();
  const rawPayloads: Uint8Array[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const { header } = record;
    if (header.chainId !== chainId) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'CHAIN_ID_MISMATCH',
        index,
      );
    }
    if (header.policyDigest !== policyDigest) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
        'MIXED_POLICY_DIGEST',
        index,
      );
    }
    if (hashes.has(record.recordHash)) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.DUPLICATED,
        'DUPLICATE_RECORD_HASH',
        index,
      );
    }
    if (header.previousHash !== previousHash) {
      const pointsInsideChain = (
        header.previousHash !== null
        && hashes.has(header.previousHash)
      );
      return failure(
        pointsInsideChain
          ? VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.REORDERED
          : VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        pointsInsideChain ? 'RECORD_REORDERED' : 'PREVIOUS_HASH_MISMATCH',
        index,
      );
    }
    if (
      safeUtcMs(header.localReceivedAtMs) === null
      || header.localReceivedAtMs < priorReceivedAtMs
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'NON_MONOTONIC_RECEIVE_UTC_CLOCK',
        index,
      );
    }
    priorReceivedAtMs = header.localReceivedAtMs;
    const receivedAt = monotonicNs(header.localMonotonicNs);
    if (receivedAt === null || receivedAt < priorMonotonic) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'NON_MONOTONIC_RECEIVE_CLOCK',
        index,
      );
    }
    priorMonotonic = receivedAt;

    const decoded = decodeCanonicalBase64(record.rawBase64, index);
    if (!decoded.ok) return decoded;
    rawPayloads.push(decoded.bytes);
    if (
      decoded.bytes.byteLength
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS
        .maximumCumulativeRawPayloadBytes - cumulativeRawPayloadBytes
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'CUMULATIVE_RAW_PAYLOAD_LIMIT_EXCEEDED',
        index,
      );
    }
    cumulativeRawPayloadBytes += decoded.bytes.byteLength;
    if (decoded.bytes.byteLength !== header.rawByteLength) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'RAW_BYTE_LENGTH_MISMATCH',
        index,
      );
    }
    const rawDigest = sha256(decoded.bytes);
    if (rawDigest !== header.rawSha256) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'RAW_SHA256_MISMATCH',
        index,
      );
    }
    if (index === 0 && rawDigest !== policyDigest) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
        'POLICY_DIGEST_MISMATCH',
        index,
      );
    }
    const calculatedRecordHash = recordHash(header, decoded.bytes);
    if (
      calculatedRecordHash === null
      || calculatedRecordHash !== record.recordHash
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'RECORD_HASH_MISMATCH',
        index,
      );
    }

    if (header.kind === 'CONFIG_STATE') configStateSeen = true;
    if (header.kind === 'KILL_STATE') killStateSeen = true;
    if (header.kind === 'DETECTOR_PROPOSAL') detectorProposalSeen = true;

    if (header.kind === 'POLICY' && index !== 0) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MIXED_POLICY,
        'POLICY_NOT_FIRST',
        index,
      );
    }
    if (header.kind === 'GENERATION_OPEN') {
      if (generationOpen) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'GENERATION_ALREADY_OPEN',
          index,
        );
      }
      if (header.generation !== generation + 1) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'GENERATION_OUT_OF_ORDER',
          index,
        );
      }
      generation = header.generation;
      generationOpen = true;
      currentGenerationKinds = new Set();
    } else if (header.kind === 'GENERATION_CLOSE') {
      if (!generationOpen) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'GENERATION_NOT_OPEN',
          index,
        );
      }
      if (header.generation !== generation) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'GENERATION_OUT_OF_ORDER',
          index,
        );
      }
      if (
        currentGenerationKinds !== null
        && !currentGenerationKinds.has('CONTINUITY')
        && firstMissingGenerationContinuityIndex === null
      ) {
        firstMissingGenerationContinuityIndex = index;
      }
      if (
        currentGenerationKinds !== null
        && currentGenerationKinds.has('CONTINUITY')
        && COMPLETE_PUBLIC_MEASUREMENT_KINDS.every(
          (kind) => currentGenerationKinds?.has(kind) === true,
        )
      ) {
        completePublicBundleSeen = true;
      }
      currentGenerationKinds = null;
      generationOpen = false;
    } else if (
      header.kind !== 'POLICY'
      && header.kind !== 'TERMINAL_SEAL'
    ) {
      if (header.generation !== generation) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'GENERATION_OUT_OF_ORDER',
          index,
        );
      }
      if (
        (
          PUBLIC_REST_KINDS.has(header.kind)
          || header.kind === 'STREAM_FRAME'
          || PUBLIC_STREAM_KINDS.has(header.kind)
          || header.kind === 'CONTINUITY'
          || header.kind === 'DETECTOR_PROPOSAL'
          || header.kind === 'LIFECYCLE_RECORD'
        )
        && !generationOpen
      ) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'GENERATION_NOT_OPEN',
          index,
        );
      }
      if (generationOpen && currentGenerationKinds !== null) {
        currentGenerationKinds.add(header.kind);
      }
    }

    if (header.kind === 'TERMINAL_SEAL') {
      if (index !== records.length - 1) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.REORDERED,
          'TERMINAL_SEAL_NOT_LAST',
          index,
        );
      }
      if (generationOpen) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
          'GENERATION_LEFT_OPEN',
          index,
        );
      }
      if (header.generation !== generation) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'TERMINAL_SEAL_GENERATION_MISMATCH',
          index,
        );
      }
      if (
        !header.terminal
        || header.sealedRecordCount !== records.length
      ) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.TRUNCATED,
          'SEAL_COUNT_MISMATCH',
          index,
        );
      }
      if (header.sealedTailHash !== previousHash) {
        return failure(
          VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
          'SEAL_TAIL_MISMATCH',
          index,
        );
      }
      sealed = true;
    } else if (
      header.terminal
      || header.sealedRecordCount !== null
      || header.sealedTailHash !== null
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'SEAL_NOT_TERMINAL',
        index,
      );
    }
    hashes.add(record.recordHash);
    previousHash = record.recordHash;
  }

  if (options.requireSealed && !sealed) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
      'TERMINAL_SEAL_MISSING',
      records.length - 1,
    );
  }
  if (options.expectedTerminalHash !== null && !sealed) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
      'TERMINAL_SEAL_MISSING',
      records.length - 1,
    );
  }
  const terminalSegmentProblem = verifyTerminalSegmentSemantics(
    records,
    rawPayloads,
    canonicalLineByteCounts,
    policyDigest,
    sealed,
  );
  if (terminalSegmentProblem !== null) return terminalSegmentProblem;
  const terminalDetectorCoverage = sealed
    && records.at(-1)?.header.kind === 'TERMINAL_SEAL'
    && (() => {
      const terminal = parseTerminalSegmentSealSemantic(
        rawPayloads[rawPayloads.length - 1],
      );
      return terminal !== null
        && terminal.value.coverageRole === 'DETECTOR_COVERAGE'
        && terminal.detectorCoverage.complete === true;
    })();
  if (
    sealed
    && options.requireMeasurementBundle
    && !terminalDetectorCoverage
  ) {
    if (firstMissingGenerationContinuityIndex !== null) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'MEASUREMENT_BUNDLE_CONTINUITY_MISSING',
        firstMissingGenerationContinuityIndex,
      );
    }
    if (!configStateSeen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'MEASUREMENT_BUNDLE_CONFIG_MISSING',
        records.length - 1,
      );
    }
    if (!killStateSeen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'MEASUREMENT_BUNDLE_KILL_STATE_MISSING',
        records.length - 1,
      );
    }
    if (!completePublicBundleSeen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'MEASUREMENT_BUNDLE_PUBLIC_SOURCES_INCOMPLETE',
        records.length - 1,
      );
    }
    if (!detectorProposalSeen) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
        'MEASUREMENT_BUNDLE_DETECTOR_PROPOSAL_MISSING',
        records.length - 1,
      );
    }
  }
  const tail = records[records.length - 1];
  if (
    options.expectedPolicyDigest !== null
    && options.expectedPolicyDigest !== policyDigest
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.ANCHOR_MISMATCH,
      'EXPECTED_POLICY_DIGEST_MISMATCH',
      0,
    );
  }
  if (
    options.expectedTerminalHash !== null
    && options.expectedTerminalHash !== tail.recordHash
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.ANCHOR_MISMATCH,
      'EXPECTED_TERMINAL_HASH_MISMATCH',
      records.length - 1,
    );
  }
  const cursor = immutableCursor({
    chainId,
    cumulativeRawPayloadBytes,
    generation,
    generationOpen,
    lastLocalReceivedAtMs: tail.header.localReceivedAtMs,
    lastLocalMonotonicNs: tail.header.localMonotonicNs,
    nextSequence: records.length,
    policyDigest,
    previousHash: tail.recordHash,
    sealed,
  });
  return Object.freeze({
    ok: true,
    status: 'VALID',
    verification: Object.freeze({
      canonicalJsonlBytes,
      chainId,
      cumulativeRawPayloadBytes,
      cursor,
      policyDigest,
      recordCount: records.length,
      records: Object.freeze(records.map(immutableRecord)),
      sealed,
      sourceAuthenticity: options.expectedTerminalHash !== null
        ? 'TRUSTED_ANCHOR_MATCHED'
        : 'SELF_CONSISTENT_UNANCHORED',
      terminalHash: tail.recordHash,
      trustedAnchors: Object.freeze({
        expectedPolicyDigest: options.expectedPolicyDigest,
        expectedTerminalHash: options.expectedTerminalHash,
        policyDigestMatched: options.expectedPolicyDigest !== null,
        terminalHashMatched: options.expectedTerminalHash !== null,
      }),
    }),
  });
}

export function verifyVolumeForwardMeasurementEvidenceChain(
  candidates: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
  options: VolumeForwardMeasurementEvidenceVerifyOptions = {},
): VolumeForwardMeasurementEvidenceVerificationResult {
  const normalized = normalizeEvidenceOptions(options, false);
  if (isFailure(normalized)) return normalized;
  return verifyVolumeForwardMeasurementEvidenceChainNormalized(
    candidates,
    normalized,
  );
}

export function serializeVolumeForwardMeasurementEvidenceRecordJsonl(
  candidate: Readonly<VolumeForwardMeasurementEvidenceRecord>,
): VolumeForwardMeasurementEvidenceRecordSerializationResult {
  const record = validateRecordShape(candidate, null);
  if (isFailure(record)) return record;
  const decoded = decodeCanonicalBase64(record.rawBase64, null);
  if (!decoded.ok) return decoded;
  if (
    decoded.bytes.byteLength !== record.header.rawByteLength
    || sha256(decoded.bytes) !== record.header.rawSha256
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RAW_SHA256_MISMATCH',
    );
  }
  if (recordHash(record.header, decoded.bytes) !== record.recordHash) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
      'RECORD_HASH_MISMATCH',
    );
  }
  const line = canonicalJson(record);
  if (
    line === null
    || byteLengthUtf8(line)
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlLineBytes
  ) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'JSONL_LINE_LIMIT_EXCEEDED',
    );
  }
  return Object.freeze({
    ok: true,
    status: 'SERIALIZED',
    line: `${line}\n`,
  });
}

export function serializeVolumeForwardMeasurementEvidenceJsonl(
  records: readonly Readonly<VolumeForwardMeasurementEvidenceRecord>[],
  options: VolumeForwardMeasurementEvidenceVerifyOptions = {},
): VolumeForwardMeasurementEvidenceSerializationResult {
  const verified = verifyVolumeForwardMeasurementEvidenceChain(records, options);
  if (!verified.ok) return verified;
  const lines: string[] = [];
  let totalBytes = 0;
  for (const record of verified.verification.records) {
    const line = canonicalJson(record);
    if (line === null) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'NON_CANONICAL_JSONL',
      );
    }
    const lineBytes = byteLengthUtf8(line) + 1;
    if (
      lineBytes
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlLineBytes
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'JSONL_LINE_LIMIT_EXCEEDED',
      );
    }
    totalBytes += lineBytes;
    if (
      totalBytes
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumJsonlBytes
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'JSONL_LIMIT_EXCEEDED',
      );
    }
    lines.push(line);
  }
  return Object.freeze({
    ok: true,
    status: 'SERIALIZED',
    jsonl: `${lines.join('\n')}\n`,
  });
}

export function parseVolumeForwardMeasurementEvidenceJsonl(
  jsonl: string,
  options: VolumeForwardMeasurementEvidenceParseOptions = {},
): VolumeForwardMeasurementEvidenceParseResult {
  const normalized = normalizeEvidenceOptions(options, true);
  if (isFailure(normalized)) return normalized;
  if (typeof jsonl !== 'string') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.INVALID,
      'JSONL_PARSE_FAILED',
    );
  }
  if (byteLengthUtf8(jsonl) > normalized.maximumJsonlBytes) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
      'JSONL_LIMIT_EXCEEDED',
    );
  }
  if (!jsonl.endsWith('\n')) {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.TRUNCATED,
      'TRAILING_NEWLINE_MISSING',
    );
  }
  let recordCount = 0;
  let scanOffset = 0;
  while (scanOffset < jsonl.length) {
    const newlineIndex = jsonl.indexOf('\n', scanOffset);
    if (newlineIndex < 0) break;
    recordCount += 1;
    if (
      recordCount
      > VOLUME_FORWARD_MEASUREMENT_EVIDENCE_LIMITS.maximumRecordCount
    ) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'RECORD_COUNT_LIMIT_EXCEEDED',
      );
    }
    scanOffset = newlineIndex + 1;
  }
  const lines = jsonl.slice(0, -1).split('\n');
  if (lines.length === 1 && lines[0] === '') {
    return failure(
      VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSEALED,
      'EMPTY_CHAIN',
    );
  }
  const records: VolumeForwardMeasurementEvidenceRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.TRUNCATED,
        'UNEXPECTED_BLANK_LINE',
        index,
      );
    }
    if (byteLengthUtf8(line) + 1 > normalized.maximumLineBytes) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.UNSUPPORTED,
        'JSONL_LINE_LIMIT_EXCEEDED',
        index,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.TRUNCATED,
        'JSONL_PARSE_FAILED',
        index,
      );
    }
    const record = validateRecordShape(parsed, index);
    if (isFailure(record)) return record;
    const canonical = canonicalJson(record);
    if (canonical === null || canonical !== line) {
      return failure(
        VOLUME_FORWARD_MEASUREMENT_EVIDENCE_FAILURE.MUTATED,
        'NON_CANONICAL_JSONL',
        index,
      );
    }
    records.push(record);
  }
  const verified = verifyVolumeForwardMeasurementEvidenceChainNormalized(
    records,
    normalized,
  );
  if (!verified.ok) return verified;
  return Object.freeze({
    ok: true,
    status: 'PARSED',
    verification: verified.verification,
  });
}
