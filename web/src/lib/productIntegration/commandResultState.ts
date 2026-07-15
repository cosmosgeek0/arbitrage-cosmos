import {
  isProductCommandResultIdentity,
  type ProductCommandResultIdentity,
  type ProductCommandResultReadback,
  type ProductControlResult,
} from './model';
import { deriveProductCommandResultIdentity } from './commandIdentity';
import {
  isCanonicalProductControlResult,
  productControlResultIsTerminal,
} from './controlResultValidation';

export const PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX = 'i00.product-command-result.v1:' as const;
export const PRODUCT_COMMAND_RESULT_STORAGE_SCHEMA = 'product-command-result-query.v1' as const;

const MAX_DURABLE_COMMAND_RESULT_BYTES = 1_024;
const MAX_STORAGE_KEYS_INSPECTED = 1_024;

interface CommandResultStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CommandResultStorageProvider = () => CommandResultStorage;

export type ProductCommandResultReconciliation =
  | Readonly<{
      readonly state: 'NONE';
      readonly identity: null;
      readonly result: null;
      readonly reasonCode: null;
    }>
  | Readonly<{
      readonly state: 'PENDING';
      readonly identity: Readonly<ProductCommandResultIdentity>;
      readonly result: Readonly<ProductControlResult> | null;
      readonly reasonCode: null;
    }>
  | Readonly<{
      readonly state: 'TERMINAL';
      readonly identity: null;
      readonly result: Readonly<ProductControlResult>;
      readonly reasonCode: null;
    }>
  | Readonly<{
      readonly state: 'AMBIGUOUS';
      readonly identity: Readonly<ProductCommandResultIdentity>;
      readonly result: Readonly<ProductControlResult> | null;
      readonly reasonCode: string;
    }>
  | Readonly<{
      readonly state: 'INVALID_DURABLE_STATE';
      readonly identity: Readonly<ProductCommandResultIdentity> | null;
      readonly result: Readonly<ProductControlResult> | null;
      readonly reasonCode: string;
    }>;

export interface PreparedDurableCommandSubmission {
  readonly identity: Readonly<ProductCommandResultIdentity>;
  readonly reconciliation: ProductCommandResultReconciliation;
}

export function abortActiveCommandResultRead(controller: AbortController | null): boolean {
  if (controller === null) return false;
  controller.abort();
  return true;
}

export function emptyCommandResultReconciliation(): ProductCommandResultReconciliation {
  return Object.freeze({ state: 'NONE', identity: null, result: null, reasonCode: null });
}

export function uncheckedCommandResultReconciliation(): ProductCommandResultReconciliation {
  return invalidState(null, null, 'COMMAND_RESULT_DURABLE_STATE_NOT_CHECKED');
}

export function pendingCommandResultReconciliation(
  identity: Readonly<ProductCommandResultIdentity>,
  result: Readonly<ProductControlResult> | null = null,
): ProductCommandResultReconciliation {
  return Object.freeze({ state: 'PENDING', identity: Object.freeze({ ...identity }), result, reasonCode: null });
}

export function ambiguousCommandResultReconciliation(
  identity: Readonly<ProductCommandResultIdentity>,
  result: Readonly<ProductControlResult> | null,
  reasonCode: string,
): ProductCommandResultReconciliation {
  return Object.freeze({
    state: 'AMBIGUOUS',
    identity: Object.freeze({ ...identity }),
    result,
    reasonCode: boundedReason(reasonCode, 'COMMAND_RESULT_READBACK_AMBIGUOUS'),
  });
}

export function terminalCommandResultReconciliation(
  result: Readonly<ProductControlResult>,
): ProductCommandResultReconciliation {
  return Object.freeze({ state: 'TERMINAL', identity: null, result, reasonCode: null });
}

export function requiresDurableCommandResultReadback(
  result: Readonly<ProductControlResult>,
): boolean {
  return result.synthetic === false
    && (result.status === 'ACCEPTED_ASYNC' || result.status === 'FAILED_ATTENTION_REQUIRED');
}

export async function reconcileDurableCommandResult(
  identity: Readonly<ProductCommandResultIdentity>,
  priorResult: Readonly<ProductControlResult> | null,
  reader: (identity: Readonly<ProductCommandResultIdentity>) => Promise<ProductCommandResultReadback>,
  storageProvider: CommandResultStorageProvider = browserStorage,
): Promise<ProductCommandResultReconciliation> {
  try {
    const readback = await reader(identity);
    if (readback.state === 'AMBIGUOUS') {
      const durable = persistDurableCommandResultIdentity(identity, storageProvider);
      return durable.state === 'PENDING'
        ? ambiguousCommandResultReconciliation(identity, readback.result, readback.reasonCode)
        : invalidState(durable.identity, readback.result, durable.reasonCode ?? 'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED');
    }
    if (readback.state === 'PENDING') {
      const durable = persistDurableCommandResultIdentity(identity, storageProvider);
      return durable.state === 'PENDING'
        ? pendingCommandResultReconciliation(identity, readback.result)
        : invalidState(durable.identity, readback.result, durable.reasonCode ?? 'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED');
    }
    return clearDurableCommandResultIdentity(identity, readback.result, storageProvider);
  } catch (cause) {
    const failureCode = commandResultFailureCode(cause);
    if (failureCode === 'COMMAND_RESULT_READBACK_CANCELLED') {
      return readDurableCommandResultIdentity(storageProvider);
    }
    const durable = persistDurableCommandResultIdentity(identity, storageProvider);
    return durable.state === 'PENDING'
      ? ambiguousCommandResultReconciliation(
          identity,
          priorResult,
          failureCode,
        )
      : invalidState(durable.identity, priorResult, durable.reasonCode ?? 'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED');
  }
}

export async function prepareDurableCommandSubmission(
  idempotencyKey: string,
  controlId: string,
  storageProvider: CommandResultStorageProvider = browserStorage,
): Promise<Readonly<PreparedDurableCommandSubmission>> {
  const identity = await deriveProductCommandResultIdentity(idempotencyKey, controlId);
  return Object.freeze({
    identity,
    reconciliation: persistDurableCommandResultIdentity(identity, storageProvider),
  });
}

export function readDurableCommandResultIdentity(
  storageProvider: CommandResultStorageProvider = browserStorage,
): ProductCommandResultReconciliation {
  let storage: CommandResultStorage;
  let durableKeys: string[];
  try {
    storage = storageProvider();
    const storageLength = storage.length;
    if (!Number.isSafeInteger(storageLength)
      || storageLength < 0
      || storageLength > MAX_STORAGE_KEYS_INSPECTED) {
      return invalidState(null, null, 'COMMAND_RESULT_STORAGE_INVENTORY_INVALID');
    }
    durableKeys = [];
    for (let index = 0; index < storageLength; index += 1) {
      const key = storage.key(index);
      if (typeof key !== 'string') {
        return invalidState(null, null, 'COMMAND_RESULT_STORAGE_INVENTORY_INVALID');
      }
      if (key.startsWith(PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX)) durableKeys.push(key);
      if (durableKeys.length > 1) {
        return invalidState(null, null, 'COMMAND_RESULT_STORAGE_CONFLICT');
      }
    }
    if (storage.length !== storageLength) {
      return invalidState(null, null, 'COMMAND_RESULT_STORAGE_INVENTORY_CHANGED');
    }
  } catch {
    return invalidState(null, null, 'COMMAND_RESULT_STORAGE_UNAVAILABLE');
  }
  if (durableKeys.length === 0) return emptyCommandResultReconciliation();
  const durableKey = durableKeys[0]!;
  let raw: string | null;
  try { raw = storage.getItem(durableKey); } catch {
    return invalidState(null, null, 'COMMAND_RESULT_STORAGE_UNAVAILABLE');
  }
  if (raw === null) return invalidState(null, null, 'COMMAND_RESULT_STORAGE_INVENTORY_INVALID');
  if (raw.length === 0 || raw.length > MAX_DURABLE_COMMAND_RESULT_BYTES) {
    return invalidState(null, null, 'COMMAND_RESULT_DURABLE_STATE_INVALID');
  }
  const identity = decodeDurableIdentity(raw);
  if (identity === null) return invalidState(null, null, 'COMMAND_RESULT_DURABLE_STATE_INVALID');
  if (durableKey !== durableKeyFor(identity)) {
    return invalidState(identity, null, 'COMMAND_RESULT_STORAGE_KEY_MISMATCH');
  }
  return pendingCommandResultReconciliation(identity);
}

export function persistDurableCommandResultIdentity(
  identity: Readonly<ProductCommandResultIdentity>,
  storageProvider: CommandResultStorageProvider = browserStorage,
): ProductCommandResultReconciliation {
  if (!isProductCommandResultIdentity(identity)) {
    return invalidState(null, null, 'COMMAND_RESULT_IDENTITY_INVALID');
  }
  const serialized = JSON.stringify({
    schemaVersion: PRODUCT_COMMAND_RESULT_STORAGE_SCHEMA,
    commandId: identity.commandId,
    idempotencyKey: identity.idempotencyKey,
    controlId: identity.controlId,
  });
  if (serialized.length > MAX_DURABLE_COMMAND_RESULT_BYTES) {
    return invalidState(identity, null, 'COMMAND_RESULT_DURABLE_STATE_INVALID');
  }
  const existing = readDurableCommandResultIdentity(storageProvider);
  if (existing.state === 'INVALID_DURABLE_STATE') return existing;
  if (existing.state === 'PENDING') {
    return sameIdentity(existing.identity, identity)
      ? existing
      : invalidState(existing.identity, null, 'COMMAND_RESULT_STORAGE_CONFLICT');
  }
  const durableKey = durableKeyFor(identity);
  try {
    const storage = storageProvider();
    if (storage.getItem(durableKey) !== null) {
      return invalidState(identity, null, 'COMMAND_RESULT_STORAGE_CONFLICT');
    }
    storage.setItem(durableKey, serialized);
    if (storage.getItem(durableKey) !== serialized) {
      return invalidState(identity, null, 'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED');
    }
  } catch {
    return invalidState(identity, null, 'COMMAND_RESULT_STORAGE_UNAVAILABLE');
  }
  const verified = readDurableCommandResultIdentity(storageProvider);
  return verified.state === 'PENDING' && sameIdentity(verified.identity, identity)
    ? verified
    : invalidState(
        verified.identity,
        null,
        verified.reasonCode ?? 'COMMAND_RESULT_STORAGE_WRITE_UNVERIFIED',
      );
}

export function clearDurableCommandResultIdentity(
  identity: Readonly<ProductCommandResultIdentity>,
  result: Readonly<ProductControlResult>,
  storageProvider: CommandResultStorageProvider = browserStorage,
): ProductCommandResultReconciliation {
  if (!isProductCommandResultIdentity(identity)
    || !isCanonicalProductControlResult(result, identity, { allowSynthetic: false })) {
    return invalidState(identity, result, 'COMMAND_RESULT_IDENTITY_MISMATCH');
  }
  if (!productControlResultIsTerminal(result)) {
    return invalidState(identity, result, 'COMMAND_RESULT_NOT_TERMINAL');
  }
  const existing = readDurableCommandResultIdentity(storageProvider);
  if (existing.state !== 'PENDING' || !sameIdentity(existing.identity, identity)) {
    return invalidState(
      existing.identity,
      result,
      existing.reasonCode ?? 'COMMAND_RESULT_STORAGE_CONFLICT',
    );
  }
  const durableKey = durableKeyFor(identity);
  try {
    const storage = storageProvider();
    const current = storage.getItem(durableKey);
    const currentIdentity = current === null ? null : decodeDurableIdentity(current);
    if (currentIdentity === null || !sameIdentity(currentIdentity, identity)) {
      return invalidState(identity, result, 'COMMAND_RESULT_STORAGE_CONFLICT');
    }
    storage.removeItem(durableKey);
    if (storage.getItem(durableKey) !== null) {
      return invalidState(identity, result, 'COMMAND_RESULT_STORAGE_CLEAR_UNVERIFIED');
    }
  } catch {
    return invalidState(null, result, 'COMMAND_RESULT_STORAGE_UNAVAILABLE');
  }
  const verified = readDurableCommandResultIdentity(storageProvider);
  return verified.state === 'NONE'
    ? terminalCommandResultReconciliation(result)
    : invalidState(
        verified.identity,
        result,
        verified.reasonCode ?? 'COMMAND_RESULT_STORAGE_CLEAR_CONFLICT',
      );
}

function invalidState(
  identity: Readonly<ProductCommandResultIdentity> | null,
  result: Readonly<ProductControlResult> | null,
  reasonCode: string,
): ProductCommandResultReconciliation {
  return Object.freeze({
    state: 'INVALID_DURABLE_STATE',
    identity: identity === null ? null : Object.freeze({ ...identity }),
    result,
    reasonCode: boundedReason(reasonCode, 'COMMAND_RESULT_DURABLE_STATE_INVALID'),
  });
}

function boundedReason(value: string, fallback: string): string {
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(value) ? value : fallback;
}

function durableKeyFor(identity: Readonly<ProductCommandResultIdentity>): string {
  return `${PRODUCT_COMMAND_RESULT_STORAGE_KEY_PREFIX}${identity.commandId}`;
}

function decodeDurableIdentity(raw: string): Readonly<ProductCommandResultIdentity> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return null; }
  if (!isRecord(parsed)
    || Object.keys(parsed).length !== 4
    || parsed.schemaVersion !== PRODUCT_COMMAND_RESULT_STORAGE_SCHEMA) return null;
  const identity = {
    commandId: parsed.commandId,
    idempotencyKey: parsed.idempotencyKey,
    controlId: parsed.controlId,
  };
  return isProductCommandResultIdentity(identity) ? Object.freeze(identity) : null;
}

function sameIdentity(
  left: Readonly<ProductCommandResultIdentity>,
  right: Readonly<ProductCommandResultIdentity>,
): boolean {
  return left.commandId === right.commandId
    && left.idempotencyKey === right.idempotencyKey
    && left.controlId === right.controlId;
}

function commandResultFailureCode(cause: unknown): string {
  if (isRecord(cause) && Array.isArray(cause.codes)) {
    const code = cause.codes[0];
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code)) return code;
  }
  if (isRecord(cause) && typeof cause.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(cause.code)) return cause.code;
  return 'COMMAND_RESULT_READBACK_UNAVAILABLE';
}

function browserStorage(): CommandResultStorage {
  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
