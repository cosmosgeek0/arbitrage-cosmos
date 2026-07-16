import {
  findSecretLikePaths,
  findSerializabilityIssues,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import { canonicalProductJson } from '../contracts/index.js';

export const PRODUCT_COMMAND_PROJECTION_RESULTS = Object.freeze([
  'READY_FOR_CANONICAL_OWNER',
  'ALREADY_APPLIED',
  'REJECTED_IDEMPOTENCY_CONFLICT',
  'REJECTED_STALE_REVISION',
  'REJECTED_PREVIEW_MISMATCH',
  'REJECTED_NOT_SUPPORTED',
  'REJECTED_NOT_YET_VALID',
  'EXPIRED',
] as const);
export type ProductCommandProjectionResult = (typeof PRODUCT_COMMAND_PROJECTION_RESULTS)[number];

export interface ProductCommandPreviewIntentProjection {
  readonly commandId: string;
  readonly commandType: string;
  readonly targetComponentId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly correlationId: string;
  readonly authenticatedOperatorId: string;
  readonly reason: string;
  readonly requiredAuthority: string;
  readonly payload: unknown;
}

/** Confirmed submit envelope; previewDigest/revision must come from the owner preview. */
export interface ProductCommandRequestProjection extends ProductCommandPreviewIntentProjection {
  readonly previewDigest: string;
  readonly expectedRevision: number;
}

export interface ProductCommandStateProjection {
  readonly revision: number;
  readonly projectionDigest: string;
  readonly state: unknown;
}

export interface ProductCommandPreviewProjection {
  readonly requestDigest: string;
  readonly previewDigest: string;
  readonly currentRevision: number;
  readonly expiresAtMs: number;
  readonly preview: Readonly<ProductCommandStateProjection>;
}

export interface ProductCommandReceiptProjection {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly previewDigest: string;
  readonly canonicalResult:
    | 'APPLIED' | 'ACCEPTED_ASYNC' | 'REJECTED_SCHEMA' | 'REJECTED_BOUNDS'
    | 'REJECTED_AUTHORITY' | 'REJECTED_STALE_REVISION' | 'REJECTED_STATE'
    | 'REJECTED_DEPENDENCY' | 'REJECTED_EXPOSURE' | 'REJECTED_NOT_SUPPORTED'
    | 'EXPIRED' | 'ALREADY_APPLIED' | 'FAILED_RECOVERABLE' | 'FAILED_ATTENTION_REQUIRED';
  readonly beforeRevision: number;
  readonly resultingRevision: number;
  readonly correlationId: string;
  readonly ledgerReference: string;
  readonly completedAtMs: number;
  readonly before: Readonly<ProductCommandStateProjection>;
  readonly after: Readonly<ProductCommandStateProjection>;
}

export interface ProductCommandDelegationProjection {
  readonly result: ProductCommandProjectionResult;
  readonly canonicalResult: string | null;
  readonly currentRevision: number;
  readonly reasonCode: string | null;
  readonly maySubmitToCanonicalOwner: boolean;
}

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
const DIGEST = /^[a-f0-9]{16,128}$/;

function assertIntent(request: ProductCommandPreviewIntentProjection): void {
  for (const [name, value] of [
    ['commandId', request.commandId],
    ['commandType', request.commandType],
    ['targetComponentId', request.targetComponentId],
    ['idempotencyKey', request.idempotencyKey],
    ['correlationId', request.correlationId],
    ['authenticatedOperatorId', request.authenticatedOperatorId],
    ['requiredAuthority', request.requiredAuthority],
  ] as const) if (!ID.test(value)) throw new TypeError(`${name} is invalid`);
  if (!DIGEST.test(request.requestDigest)) throw new TypeError('requestDigest is invalid');
  if (!isValidUtcMillis(request.createdAtMs) || !isValidUtcMillis(request.expiresAtMs) || request.expiresAtMs <= request.createdAtMs) throw new TypeError('command lifetime is invalid');
  if (typeof request.reason !== 'string' || request.reason.trim().length === 0 || request.reason.length > 500) throw new TypeError('reason is invalid');
  const serializability = findSerializabilityIssues(request.payload);
  if (serializability.length > 0) throw new TypeError('command payload is not serializable');
  if (findSecretLikePaths(request.payload).length > 0) throw new TypeError('command payload contains secret-like keys');
  if (new TextEncoder().encode(canonicalProductJson(request.payload)).byteLength > 262_144) throw new TypeError('command payload is too large');
}

function assertRequest(request: ProductCommandRequestProjection): void {
  assertIntent(request);
  if (!DIGEST.test(request.previewDigest)) throw new TypeError('previewDigest is invalid');
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new TypeError('expectedRevision is invalid');
}

function assertStateProjection(
  name: 'preview' | 'before' | 'after',
  projection: Readonly<ProductCommandStateProjection>,
  expectedRevision: number,
): void {
  if (!projection || typeof projection !== 'object'
      || !Number.isSafeInteger(projection.revision) || projection.revision !== expectedRevision
      || !DIGEST.test(projection.projectionDigest)) throw new TypeError(`prior command receipt ${name} projection is invalid`);
  if (findSerializabilityIssues(projection.state).length > 0) throw new TypeError(`prior command receipt ${name} state is not serializable`);
  if (findSecretLikePaths(projection.state).length > 0) throw new TypeError(`prior command receipt ${name} state contains secret-like keys`);
  if (new TextEncoder().encode(canonicalProductJson(projection.state)).byteLength > 262_144) throw new TypeError(`prior command receipt ${name} state is too large`);
}

/**
 * Pure pre-delegation projection. It never applies a command or changes a
 * revision; those remain canonical Control Plane responsibilities.
 */
export function projectCommandDelegation(input: Readonly<{
  request: Readonly<ProductCommandRequestProjection>;
  canonicalPreview: Readonly<ProductCommandPreviewProjection>;
  nowMs: number;
  supportedCommandIds: readonly string[];
  priorReceipts: readonly Readonly<ProductCommandReceiptProjection>[];
}>): Readonly<ProductCommandDelegationProjection> {
  assertRequest(input.request);
  if (!isValidUtcMillis(input.nowMs)) throw new TypeError('nowMs must be injected valid UTC ms');
  if (!DIGEST.test(input.canonicalPreview.requestDigest) || !DIGEST.test(input.canonicalPreview.previewDigest)
      || !Number.isSafeInteger(input.canonicalPreview.currentRevision) || input.canonicalPreview.currentRevision < 0
      || !isValidUtcMillis(input.canonicalPreview.expiresAtMs)) throw new TypeError('canonicalPreview is invalid');
  assertStateProjection('preview', input.canonicalPreview.preview, input.canonicalPreview.currentRevision);
  if (input.canonicalPreview.preview.projectionDigest !== input.canonicalPreview.previewDigest) throw new TypeError('canonicalPreview is not bound to its state');
  if (!Array.isArray(input.supportedCommandIds) || input.supportedCommandIds.some((value) => !ID.test(value))) throw new TypeError('supportedCommandIds is invalid');
  if (!Array.isArray(input.priorReceipts) || input.priorReceipts.length > 10_000) throw new TypeError('priorReceipts is invalid');
  const receiptKeys = new Set<string>();
  for (const receipt of input.priorReceipts) {
    if (!ID.test(receipt.commandId) || !ID.test(receipt.idempotencyKey) || !DIGEST.test(receipt.requestDigest)
        || !DIGEST.test(receipt.previewDigest)
        || !ID.test(receipt.correlationId) || !ID.test(receipt.ledgerReference)
        || !Number.isSafeInteger(receipt.beforeRevision) || receipt.beforeRevision < 0
        || !Number.isSafeInteger(receipt.resultingRevision) || receipt.resultingRevision < receipt.beforeRevision
        || !isValidUtcMillis(receipt.completedAtMs)
        || !['APPLIED', 'ACCEPTED_ASYNC', 'REJECTED_SCHEMA', 'REJECTED_BOUNDS', 'REJECTED_AUTHORITY', 'REJECTED_STALE_REVISION', 'REJECTED_STATE', 'REJECTED_DEPENDENCY', 'REJECTED_EXPOSURE', 'REJECTED_NOT_SUPPORTED', 'EXPIRED', 'ALREADY_APPLIED', 'FAILED_RECOVERABLE', 'FAILED_ATTENTION_REQUIRED'].includes(receipt.canonicalResult)) throw new TypeError('prior command receipt is invalid');
    assertStateProjection('before', receipt.before, receipt.beforeRevision);
    assertStateProjection('after', receipt.after, receipt.resultingRevision);
    if (receipt.before.projectionDigest !== receipt.previewDigest) throw new TypeError('prior command receipt is not bound to its preview state');
    if (receiptKeys.has(receipt.idempotencyKey)) throw new TypeError('priorReceipts contain duplicate idempotency keys');
    receiptKeys.add(receipt.idempotencyKey);
  }
  const prior = input.priorReceipts.find((receipt) => receipt.idempotencyKey === input.request.idempotencyKey);
  if (prior) {
    if (prior.requestDigest !== input.request.requestDigest || prior.previewDigest !== input.request.previewDigest) {
      return Object.freeze({
        result: 'REJECTED_IDEMPOTENCY_CONFLICT',
        canonicalResult: null,
        currentRevision: input.canonicalPreview.currentRevision,
        reasonCode: 'IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_INTENT',
        maySubmitToCanonicalOwner: false,
      });
    }
    return Object.freeze({
      result: 'ALREADY_APPLIED',
      canonicalResult: prior.canonicalResult,
      currentRevision: input.canonicalPreview.currentRevision,
      reasonCode: null,
      maySubmitToCanonicalOwner: false,
    });
  }
  if (input.nowMs >= input.request.expiresAtMs) {
    return Object.freeze({ result: 'EXPIRED', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'COMMAND_EXPIRED', maySubmitToCanonicalOwner: false });
  }
  if (input.nowMs < input.request.createdAtMs) {
    return Object.freeze({ result: 'REJECTED_NOT_YET_VALID', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'COMMAND_CREATED_IN_FUTURE', maySubmitToCanonicalOwner: false });
  }
  if (input.nowMs >= input.canonicalPreview.expiresAtMs || input.request.expiresAtMs > input.canonicalPreview.expiresAtMs) {
    return Object.freeze({ result: 'EXPIRED', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'CANONICAL_PREVIEW_EXPIRED', maySubmitToCanonicalOwner: false });
  }
  if (input.request.expectedRevision !== input.canonicalPreview.currentRevision) {
    return Object.freeze({ result: 'REJECTED_STALE_REVISION', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'EXPECTED_REVISION_MISMATCH', maySubmitToCanonicalOwner: false });
  }
  if (input.request.previewDigest !== input.canonicalPreview.previewDigest) {
    return Object.freeze({ result: 'REJECTED_PREVIEW_MISMATCH', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'PREVIEW_DIGEST_MISMATCH', maySubmitToCanonicalOwner: false });
  }
  if (input.request.requestDigest !== input.canonicalPreview.requestDigest) {
    return Object.freeze({ result: 'REJECTED_PREVIEW_MISMATCH', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'PREVIEW_INTENT_MISMATCH', maySubmitToCanonicalOwner: false });
  }
  if (!input.supportedCommandIds.includes(input.request.commandType)) {
    return Object.freeze({ result: 'REJECTED_NOT_SUPPORTED', canonicalResult: null, currentRevision: input.canonicalPreview.currentRevision, reasonCode: 'COMMAND_NOT_SUPPORTED_BY_TARGET', maySubmitToCanonicalOwner: false });
  }
  return Object.freeze({
    result: 'READY_FOR_CANONICAL_OWNER',
    canonicalResult: null,
    currentRevision: input.canonicalPreview.currentRevision,
    reasonCode: null,
    maySubmitToCanonicalOwner: true,
  });
}
