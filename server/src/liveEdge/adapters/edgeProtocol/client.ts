import { createHash } from 'node:crypto';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import { boundedJsonByteLength } from '../../../intelligenceRuntime/contracts/index.js';

import {
  EDGE_PROTOCOL_V1_SCHEMA_SHA256,
  type EdgeProtocolSchemaRuntime,
  type SchemaValidationIssue,
} from './schemaValidator.js';
import {
  EDGE_PROTOCOL_V1_MAX_FRAME_BYTES,
  type DecodedProtocolEnvelope,
  type EdgeProtocolClientConfig,
  type JsonRecord,
  type ProtocolDecodeResult,
  type ProtocolErrorEnvelope,
} from './types.js';

const FORBIDDEN_PROTOCOL_KEY = /signature|api_?key|api_?secret|secret|passphrase|password|privatekey|listenkey|credential|approvedcapital|orderrequest|leveragemutation|livesendpermission/i;
const DANGEROUS_OBJECT_KEY = /^(?:__proto__|prototype|constructor)$/i;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const DEFAULT_CONFIG: Readonly<EdgeProtocolClientConfig> = Object.freeze({
  maximumFrameBytes: EDGE_PROTOCOL_V1_MAX_FRAME_BYTES,
  maximumJsonDepth: 64,
  maximumJsonNodes: 100_000,
  maximumValidationIssues: 128,
});
// Preserve a leading UTF-8 BOM in decoded text. JSON frames have no BOM in
// their canonical wire representation, so consuming it here would let the
// byte-level input differ from the canonical text that is later retained.
const fatalDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function exactConfig(input: Partial<EdgeProtocolClientConfig>): Readonly<EdgeProtocolClientConfig> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('edge protocol client config must be a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('edge protocol client config must be a plain object');
  }
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('edge protocol client config contains an unsupported field');
  }
  return Object.freeze({
    maximumFrameBytes: boundedInteger(
      input.maximumFrameBytes ?? DEFAULT_CONFIG.maximumFrameBytes,
      'maximumFrameBytes',
      1,
      EDGE_PROTOCOL_V1_MAX_FRAME_BYTES,
    ),
    maximumJsonDepth: boundedInteger(
      input.maximumJsonDepth ?? DEFAULT_CONFIG.maximumJsonDepth,
      'maximumJsonDepth',
      1,
      64,
    ),
    maximumJsonNodes: boundedInteger(
      input.maximumJsonNodes ?? DEFAULT_CONFIG.maximumJsonNodes,
      'maximumJsonNodes',
      1,
      1_000_000,
    ),
    maximumValidationIssues: boundedInteger(
      input.maximumValidationIssues ?? DEFAULT_CONFIG.maximumValidationIssues,
      'maximumValidationIssues',
      1,
      1_024,
    ),
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const child of value) deepFreezeJson(child);
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
  }
  return Object.freeze(value);
}

interface KeyScanResult {
  forbidden: boolean;
  dangerous: boolean;
}

interface UtcMillisBounds {
  minimum: number;
  maximum: number;
}

function ownDataValue(value: unknown, key: string): unknown {
  if (!isPlainRecord(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function frozenUtcMillisBounds(schema: EdgeProtocolSchemaRuntime): Readonly<UtcMillisBounds> {
  const definitions = ownDataValue(schema.document, '$defs');
  const utcMillis = ownDataValue(definitions, 'UtcMillis');
  const minimum = ownDataValue(utcMillis, 'minimum');
  const maximum = ownDataValue(utcMillis, 'maximum');
  if (
    typeof minimum !== 'number'
    || !Number.isSafeInteger(minimum)
    || typeof maximum !== 'number'
    || !Number.isSafeInteger(maximum)
    || minimum > maximum
  ) {
    throw new TypeError('frozen EDGE_PROTOCOL_V1 UtcMillis bounds are unavailable');
  }
  return Object.freeze({ minimum, maximum });
}

function scanKeys(value: unknown): Readonly<KeyScanResult> {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
      continue;
    }
    if (!isPlainRecord(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      const normalized = key.replace(/[-_]/g, '');
      if (FORBIDDEN_PROTOCOL_KEY.test(normalized)) return Object.freeze({ forbidden: true, dangerous: false });
      if (DANGEROUS_OBJECT_KEY.test(key)) return Object.freeze({ forbidden: false, dangerous: true });
      stack.push(child);
    }
  }
  return Object.freeze({ forbidden: false, dangerous: false });
}

function containsUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function containsUnsafeText(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string' && (UNSAFE_TEXT.test(current) || containsUnpairedSurrogate(current))) return true;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) stack.push(current[index]);
    } else if (isPlainRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        if (UNSAFE_TEXT.test(key) || containsUnpairedSurrogate(key)) return true;
        stack.push(child);
      }
    }
  }
  return false;
}

function issueSummary(issues: readonly SchemaValidationIssue[]): string {
  if (issues.length === 0) return 'frozen schema rejected the envelope';
  const first = issues[0];
  return first === undefined
    ? 'frozen schema rejected the envelope'
    : `frozen schema rejected the envelope (${first.code})`;
}

/**
 * Strict, side-effect-free client for canonical EDGE_PROTOCOL_V1 frames.
 * Raw frames are bounded before parsing and the frozen schema document is
 * injected by the director-owned composition boundary.
 */
export class EdgeProtocolV1Client {
  readonly #schema: EdgeProtocolSchemaRuntime;
  readonly #config: Readonly<EdgeProtocolClientConfig>;
  readonly #utcMillisBounds: Readonly<UtcMillisBounds>;

  constructor(schema: EdgeProtocolSchemaRuntime, config: Partial<EdgeProtocolClientConfig> = {}) {
    if (
      typeof schema?.validateEnvelope !== 'function'
      || typeof schema?.isRegisteredEnvelopeSchema !== 'function'
      || schema.rawSha256 !== EDGE_PROTOCOL_V1_SCHEMA_SHA256
    ) {
      throw new TypeError('exact hash-locked EDGE_PROTOCOL_V1 schema runtime is required');
    }
    this.#schema = schema;
    this.#config = exactConfig(config);
    this.#utcMillisBounds = frozenUtcMillisBounds(schema);
  }

  config(): Readonly<EdgeProtocolClientConfig> {
    return this.#config;
  }

  decode(frame: string | Uint8Array, localReceiptTimeMs: number): ProtocolDecodeResult {
    if (
      typeof localReceiptTimeMs !== 'number'
      || !Number.isSafeInteger(localReceiptTimeMs)
      || localReceiptTimeMs < this.#utcMillisBounds.minimum
      || localReceiptTimeMs > this.#utcMillisBounds.maximum
    ) {
      throw new TypeError(
        `localReceiptTimeMs must be an injected safe integer in the frozen UtcMillis range [${this.#utcMillisBounds.minimum}, ${this.#utcMillisBounds.maximum}]`,
      );
    }
    let raw: string;
    let byteLength: number;
    let rawDigest: string;
    try {
      if (typeof frame === 'string') {
        byteLength = Buffer.byteLength(frame, 'utf8');
        if (byteLength > this.#config.maximumFrameBytes) {
          return this.#failure(
            'PROTOCOL_FRAME_TOO_LARGE',
            'decode:size',
            localReceiptTimeMs,
            sha256(`oversize:${byteLength}`),
          );
        }
        raw = frame;
        rawDigest = sha256(frame);
      } else if (frame instanceof Uint8Array) {
        byteLength = frame.byteLength;
        if (byteLength > this.#config.maximumFrameBytes) {
          return this.#failure(
            'PROTOCOL_FRAME_TOO_LARGE',
            'decode:size',
            localReceiptTimeMs,
            sha256(`oversize:${byteLength}`),
          );
        }
        rawDigest = sha256(frame);
        raw = fatalDecoder.decode(frame);
      } else {
        throw new TypeError('protocol frame must be a string or Uint8Array');
      }
    } catch (cause) {
      if (cause instanceof TypeError && cause.message === 'protocol frame must be a string or Uint8Array') throw cause;
      return this.#failure('PROTOCOL_UTF8_INVALID', 'decode:utf8', localReceiptTimeMs, 'invalid-utf8');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return this.#failure('PROTOCOL_JSON_INVALID', 'decode:json', localReceiptTimeMs, rawDigest);
    }
    const record = isPlainRecord(parsed) ? parsed : null;

    // Compatibility always precedes semantic/schema actionability.
    if (!this.#schema.isRegisteredEnvelopeSchema(record?.schema) || record?.version !== 1) {
      return this.#failure(
        'PROTOCOL_VERSION_UNSUPPORTED',
        'decode:compatibility',
        localReceiptTimeMs,
        rawDigest,
      );
    }

    try {
      boundedJsonByteLength(parsed, this.#config.maximumFrameBytes, {
        maximumDepth: this.#config.maximumJsonDepth,
        maximumNodes: this.#config.maximumJsonNodes,
      });
    } catch (cause) {
      const code = cause instanceof RangeError ? 'PROTOCOL_VALUE_BOUNDS_EXCEEDED' : 'PROTOCOL_JSON_VALUE_INVALID';
      return this.#failure(code, 'decode:bounds', localReceiptTimeMs, rawDigest);
    }

    const keyScan = scanKeys(parsed);
    if (keyScan.forbidden) {
      return this.#failure('PROTOCOL_FORBIDDEN_CONTENT', 'decode:forbidden', localReceiptTimeMs, rawDigest);
    }
    if (keyScan.dangerous) {
      return this.#failure('PROTOCOL_DANGEROUS_KEY', 'decode:object-key', localReceiptTimeMs, rawDigest);
    }
    if (containsUnsafeText(parsed)) {
      return this.#failure('PROTOCOL_UNSAFE_TEXT', 'decode:text-safety', localReceiptTimeMs, rawDigest);
    }

    const issues = this.#schema.validateEnvelope(parsed).slice(0, this.#config.maximumValidationIssues);
    if (issues.length > 0) {
      return this.#failure(
        'PROTOCOL_SCHEMA_INVALID',
        'decode:schema',
        localReceiptTimeMs,
        rawDigest,
        issueSummary(issues),
      );
    }

    let canonical: string;
    try {
      canonical = canonicalJson(parsed);
    } catch {
      return this.#failure('PROTOCOL_CANONICALIZATION_FAILED', 'decode:canonical', localReceiptTimeMs, rawDigest);
    }
    if (canonical !== raw) {
      return this.#failure('PROTOCOL_NON_CANONICAL_FRAME', 'decode:canonical-wire', localReceiptTimeMs, rawDigest);
    }

    const detached = deepFreezeJson(JSON.parse(canonical) as Record<string, unknown>);
    const revision = detached.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      return this.#failure('PROTOCOL_SCHEMA_INVALID', 'decode:revision', localReceiptTimeMs, rawDigest);
    }
    const envelope: Readonly<DecodedProtocolEnvelope> = Object.freeze({
      schema: detached.schema as string,
      version: 1 as const,
      revision: revision as number,
      localReceiptTimeMs,
      byteLength,
      canonicalJson: canonical,
      fingerprintSha256: sha256(canonical),
      value: detached,
    });
    return Object.freeze({ ok: true as const, envelope });
  }

  #failure(
    code: string,
    stage: string,
    occurredAtMs: number,
    frameDigest: string,
    message = 'edge protocol frame was rejected safely',
  ): ProtocolDecodeResult {
    const errorId = `er_${sha256(`${code}\0${stage}\0${frameDigest}\0${occurredAtMs}`).slice(0, 24)}`;
    const candidate: Record<string, unknown> = {
      schema: 'ProtocolErrorV1',
      version: 1,
      revision: 0,
      errorId,
      code,
      message: message.slice(0, 256),
      occurredAtMs,
      retryable: false,
      component: 'live-edge-protocol-client',
      stage,
      safeCurrentState: 'ENVELOPE_REJECTED',
      recommendedOperatorAction: 'inspect compatibility and producer health before retry',
      // Raw-frame identities are never reflected into rejection output. Even
      // schema-valid IDs remain attacker-controlled until an envelope is
      // accepted, and a rejection must not become a data-exfiltration path.
      correlationId: null,
      sourceEnvelopeSchema: null,
      sourceEnvelopeId: null,
    };
    const issues = this.#schema.validateEnvelope(candidate);
    if (issues.length > 0) {
      throw new TypeError(`programming error: ProtocolErrorV1 failed frozen schema (${issueSummary(issues)})`);
    }
    const error = deepFreezeJson(JSON.parse(canonicalJson(candidate)) as Record<string, unknown>) as ProtocolErrorEnvelope;
    return Object.freeze({ ok: false as const, error });
  }
}
