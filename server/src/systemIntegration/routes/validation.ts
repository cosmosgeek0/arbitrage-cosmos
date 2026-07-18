import type { SystemControlMutation } from '../contracts/types.js';
import {
  isPlainRecord,
  validReason,
  validateControlMutation,
} from '../controls/validation.js';

export const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const EVENT_CURSOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ParsedControlBody =
  | {
      readonly ok: true;
      readonly expectedRevision: number;
      readonly reason: string;
      readonly mutation: Readonly<SystemControlMutation>;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function invalid(message: string, code = 'INVALID_CONTROL_REQUEST'): ParsedControlBody {
  return { ok: false, code, message };
}

export function parseControlBody(value: unknown): ParsedControlBody {
  if (!isPlainRecord(value)) return invalid('Control request body must be one plain JSON object.');
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
    return invalid('expectedRevision must be a non-negative safe integer.');
  }
  if (!validReason(value.reason)) return invalid('reason must contain 1-240 bounded printable characters.');
  if (typeof value.command !== 'string') return invalid('command is required.');

  let allowed: readonly string[];
  let mutation: Record<string, unknown>;
  switch (value.command) {
    case 'SET_COMPONENT_STATE':
      allowed = ['command', 'expectedRevision', 'reason', 'componentId', 'desiredState'];
      mutation = { command: value.command, componentId: value.componentId, desiredState: value.desiredState };
      break;
    case 'SET_INTAKE_PAUSED':
      allowed = ['command', 'expectedRevision', 'reason', 'paused'];
      mutation = { command: value.command, paused: value.paused };
      break;
    case 'SET_BASIS_SYMBOL_POLICY':
    case 'SET_VOLUME_SYMBOL_POLICY':
      allowed = ['command', 'expectedRevision', 'reason', 'action', 'symbol'];
      mutation = { command: value.command, action: value.action, symbol: value.symbol };
      break;
    case 'REDUCE_SIZE_CEILING':
      allowed = ['command', 'expectedRevision', 'reason', 'scope', 'maximumNotionalUsd'];
      mutation = { command: value.command, scope: value.scope, maximumNotionalUsd: value.maximumNotionalUsd };
      break;
    case 'SET_STRATEGY_THRESHOLD':
      allowed = ['command', 'expectedRevision', 'reason', 'strategy', 'threshold', 'value'];
      mutation = { command: value.command, strategy: value.strategy, threshold: value.threshold, value: value.value };
      break;
    case 'PIN_FOCUS':
      allowed = ['command', 'expectedRevision', 'reason', 'symbol', 'pinned'];
      mutation = { command: value.command, symbol: value.symbol, pinned: value.pinned };
      break;
    case 'SET_SAFE_MODE':
      allowed = ['command', 'expectedRevision', 'reason', 'safeMode'];
      mutation = { command: value.command, safeMode: value.safeMode };
      break;
    case 'SET_KILL_SWITCH':
      allowed = ['command', 'expectedRevision', 'reason', 'engaged'];
      mutation = { command: value.command, engaged: value.engaged };
      break;
    case 'APPLY_CONFIGURATION':
      allowed = ['command', 'expectedRevision', 'reason', 'configurationRevision', 'payloadDigest'];
      mutation = {
        command: value.command,
        configurationRevision: value.configurationRevision,
        payloadDigest: value.payloadDigest,
      };
      break;
    case 'REVOKE_APPROVAL':
      allowed = ['command', 'expectedRevision', 'reason', 'approvalId'];
      mutation = { command: value.command, approvalId: value.approvalId };
      break;
    case 'REVOKE_RESERVATION':
      allowed = ['command', 'expectedRevision', 'reason', 'reservationId'];
      mutation = { command: value.command, reservationId: value.reservationId };
      break;
    case 'RESTART_COMPONENT':
      allowed = ['command', 'expectedRevision', 'reason', 'componentId'];
      mutation = { command: value.command, componentId: value.componentId };
      break;
    case 'CLEAR_DEPLOYMENT_FREEZE':
      allowed = ['command', 'expectedRevision', 'reason', 'expectedObservedAtUtc'];
      mutation = { command: value.command, expectedObservedAtUtc: value.expectedObservedAtUtc };
      break;
    default:
      return invalid('command is unsupported.');
  }
  if (!exactKeys(value, allowed)) return invalid('Control request contains missing or unexpected fields.');
  const checked = validateControlMutation(mutation);
  if (!checked.ok) return invalid(checked.message, checked.code);
  return {
    ok: true,
    expectedRevision: value.expectedRevision as number,
    reason: value.reason as string,
    mutation: checked.mutation,
  };
}

export function parseEventQuery(query: Record<string, unknown>):
  | { readonly ok: true; readonly limit: number; readonly beforeId?: string; readonly afterId?: string }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const keys = Object.keys(query);
  if (keys.includes('refresh')) {
    return { ok: false, code: 'REFRESH_REQUIRES_POST', message: 'Read routes never force network refresh.' };
  }
  if (keys.some((key) => !['limit', 'beforeId', 'afterId'].includes(key))) {
    return { ok: false, code: 'INVALID_SYSTEM_QUERY', message: 'Event query contains unsupported fields.' };
  }
  const limitRaw = query.limit;
  let limit = 50;
  if (limitRaw !== undefined) {
    if (typeof limitRaw !== 'string' || !/^\d+$/.test(limitRaw)) {
      return { ok: false, code: 'INVALID_SYSTEM_QUERY', message: 'limit must be a bounded integer.' };
    }
    limit = Number(limitRaw);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return { ok: false, code: 'INVALID_SYSTEM_QUERY', message: 'limit must be between 1 and 200.' };
    }
  }
  const beforeId = query.beforeId;
  const afterId = query.afterId;
  if (beforeId !== undefined && afterId !== undefined) {
    return { ok: false, code: 'INVALID_SYSTEM_QUERY', message: 'Use beforeId or afterId, not both.' };
  }
  if (beforeId !== undefined && (typeof beforeId !== 'string' || !EVENT_CURSOR_PATTERN.test(beforeId))) {
    return { ok: false, code: 'INVALID_SYSTEM_QUERY', message: 'beforeId is invalid.' };
  }
  if (afterId !== undefined && (typeof afterId !== 'string' || !EVENT_CURSOR_PATTERN.test(afterId))) {
    return { ok: false, code: 'INVALID_SYSTEM_QUERY', message: 'afterId is invalid.' };
  }
  return {
    ok: true,
    limit,
    ...(typeof beforeId === 'string' ? { beforeId } : {}),
    ...(typeof afterId === 'string' ? { afterId } : {}),
  };
}
