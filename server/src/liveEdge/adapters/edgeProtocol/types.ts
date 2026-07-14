/**
 * L01 adapter-side shapes around the director-frozen EDGE_PROTOCOL_V1 schema.
 *
 * These are deliberately generic boundary/result types, not handwritten
 * semantic copies of the protocol envelopes. The injected frozen schema is
 * the only authority for envelope fields and enums.
 */

export const L_ADAPTER_POLICY_VERSION = 'L_ADAPTER_POLICY_V1' as const;
export const EDGE_PROTOCOL_V1_MAX_FRAME_BYTES = 262_144;
export const EDGE_PROTOCOL_V1_PROTOCOL_SHA = '73e1a1ff7daa48df8dac45713fc5f106842edafc' as const;

export type JsonRecord = Readonly<Record<string, unknown>>;

export interface EdgeProtocolClientConfig {
  maximumFrameBytes: number;
  maximumJsonDepth: number;
  maximumJsonNodes: number;
  maximumValidationIssues: number;
}

export interface DecodedProtocolEnvelope {
  /** Exact registered schema name from the frozen schema document. */
  schema: string;
  version: 1;
  revision: number;
  /** L-local receipt time; peer timestamps remain untouched in value. */
  localReceiptTimeMs: number;
  byteLength: number;
  canonicalJson: string;
  fingerprintSha256: string;
  /** Detached and deeply frozen plain JSON value. */
  value: JsonRecord;
}

/** ProtocolErrorV1 validated through the frozen schema before return. */
export type ProtocolErrorEnvelope = JsonRecord;

export type ProtocolDecodeResult =
  | Readonly<{ ok: true; envelope: Readonly<DecodedProtocolEnvelope> }>
  | Readonly<{ ok: false; error: ProtocolErrorEnvelope }>;

export interface ProtocolProjectionDisposition {
  kind: 'ACCEPTED' | 'DUPLICATE_NOOP' | 'IDENTITY_CONFLICT' | 'REVISION_STALE' | 'CAPACITY_BLOCKED' | 'INVALID';
  schema: string | null;
  identity: string | null;
  revision: number | null;
  reasonCode: string;
}
