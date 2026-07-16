import type {
  ProductCommandResultIdentity,
  ProductControlResult,
} from './model';

const CONTROL_RESULT_KEYS = Object.freeze([
  'commandId', 'controlId', 'status', 'before', 'after', 'receiptId',
  'correlationId', 'completedAtMs', 'synthetic',
]);

export const PRODUCT_CONTROL_RESULT_STATUSES = Object.freeze([
  'APPLIED', 'ACCEPTED_ASYNC', 'REJECTED_SCHEMA', 'REJECTED_BOUNDS', 'REJECTED_AUTHORITY',
  'REJECTED_STALE_REVISION', 'REJECTED_STATE', 'REJECTED_DEPENDENCY', 'REJECTED_EXPOSURE',
  'REJECTED_NOT_SUPPORTED', 'EXPIRED', 'ALREADY_APPLIED', 'FAILED_RECOVERABLE',
  'FAILED_ATTENTION_REQUIRED',
] as const);

export function isCanonicalProductControlResult(
  value: unknown,
  identity: Readonly<ProductCommandResultIdentity>,
  options: Readonly<{
    allowSynthetic: boolean;
    allowedStatuses?: readonly string[];
  }>,
): value is ProductControlResult {
  if (!isRecord(value)
    || Object.keys(value).length !== CONTROL_RESULT_KEYS.length
    || !CONTROL_RESULT_KEYS.every((key) => Object.hasOwn(value, key))) return false;
  const status = String(value.status);
  const acceptedStatuses = options.allowedStatuses ?? PRODUCT_CONTROL_RESULT_STATUSES;
  const durableReceiptRequired = ['APPLIED', 'ACCEPTED_ASYNC', 'ALREADY_APPLIED'].includes(status);
  return value.commandId === identity.commandId
    && value.controlId === identity.controlId
    && acceptedStatuses.includes(status)
    && boundedStateText(value.before)
    && boundedStateText(value.after)
    && (value.receiptId === null
      || (typeof value.receiptId === 'string' && /^ledger-event:[1-9][0-9]{0,15}$/.test(value.receiptId)))
    && (!durableReceiptRequired || value.receiptId !== null)
    && value.correlationId === correlationIdForCommand(identity.commandId)
    && utcMillis(value.completedAtMs)
    && (options.allowSynthetic ? typeof value.synthetic === 'boolean' : value.synthetic === false);
}

export function productControlResultIsTerminal(result: Readonly<ProductControlResult>): boolean {
  return result.status !== 'ACCEPTED_ASYNC' && result.status !== 'FAILED_ATTENTION_REQUIRED';
}

function boundedStateText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 2
    && value.length <= 16_384
    && !value.includes('\0');
}

function correlationIdForCommand(commandId: string): string {
  return `product.control.${commandId.slice('sysctrl_'.length, 'sysctrl_'.length + 48)}`;
}

function utcMillis(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && Number(value) >= 0
    && Number(value) <= 4_102_444_800_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
