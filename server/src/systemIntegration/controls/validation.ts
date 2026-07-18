import {
  BLOCKED_EXECUTION_MODE_REQUESTS,
  SYSTEM_COMPONENT_IDS,
  SYSTEM_CONTROL_COMMANDS,
  SYSTEM_SAFE_MODES,
  type SystemControlMutation,
} from '../contracts/index.js';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const OPAQUE_CONTROL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const CONFIGURATION_REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const PAYLOAD_DIGEST_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
export const STRATEGY_SYMBOL_PATTERN = /^[A-Z0-9]{4,20}$/;
export const POSITIVE_EXACT_DECIMAL_PATTERN = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9]|[1-9][0-9]*\.[0-9]*[1-9])$/;
const SENSITIVE_MATERIAL_PATTERN = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;

const DESIRED_STATES = new Set(['STOPPED', 'RUNNING', 'PAUSED']);
const COMPONENT_IDS = new Set<string>(SYSTEM_COMPONENT_IDS);
const SAFE_MODES = new Set<string>(SYSTEM_SAFE_MODES);
const CONTROL_COMMANDS = new Set<string>(SYSTEM_CONTROL_COMMANDS);
const BLOCKED_MODES = new Set<string>(BLOCKED_EXECUTION_MODE_REQUESTS);

export type MutationValidation =
  | { readonly ok: true; readonly mutation: Readonly<SystemControlMutation> }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function invalid(message: string): MutationValidation {
  return { ok: false, code: 'INVALID_CONTROL_REQUEST', message };
}

export function isBlockedExecutionMode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toUpperCase();
  return BLOCKED_MODES.has(normalized)
    || normalized.includes('LIVE')
    || normalized.includes('AUTONOMOUS')
    || normalized === 'MANUAL_ARMED';
}

/** Runtime validation remains mandatory even when TypeScript callers are typed. */
export function validateControlMutation(value: unknown): MutationValidation {
  if (!isPlainRecord(value) || typeof value.command !== 'string' || !CONTROL_COMMANDS.has(value.command)) {
    return invalid('Mutation must contain one supported control command.');
  }
  switch (value.command) {
    case 'SET_COMPONENT_STATE':
      if (
        !exactKeys(value, ['command', 'componentId', 'desiredState'])
        || typeof value.componentId !== 'string'
        || !COMPONENT_IDS.has(value.componentId)
        || typeof value.desiredState !== 'string'
        || !DESIRED_STATES.has(value.desiredState)
      ) return invalid('Component state mutation is invalid or unsupported.');
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'SET_INTAKE_PAUSED':
      if (!exactKeys(value, ['command', 'paused']) || typeof value.paused !== 'boolean') {
        return invalid('Intake mutation requires one boolean paused value.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'SET_BASIS_INTAKE':
      if (!exactKeys(value, ['command', 'paused']) || typeof value.paused !== 'boolean') {
        return invalid('Basis intake mutation requires one boolean paused value.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'SET_BASIS_SYMBOL_POLICY':
    case 'SET_VOLUME_SYMBOL_POLICY':
      if (!exactKeys(value, ['command', 'action', 'symbol'])
        || (value.action !== 'BLOCK' && value.action !== 'ALLOW')
        || typeof value.symbol !== 'string'
        || !STRATEGY_SYMBOL_PATTERN.test(value.symbol)) {
        return invalid('Strategy symbol policy requires one canonical symbol and BLOCK or ALLOW.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'REDUCE_SIZE_CEILING': {
      const decimal = value.maximumNotionalUsd;
      const digits = typeof decimal === 'string' ? decimal.replace('.', '').length : 0;
      if (!exactKeys(value, ['command', 'scope', 'maximumNotionalUsd'])
        || (value.scope !== 'SYSTEM' && value.scope !== 'BASIS' && value.scope !== 'VOLUME')
        || typeof decimal !== 'string'
        || !POSITIVE_EXACT_DECIMAL_PATTERN.test(decimal)
        || digits > 96) {
        return invalid('Size ceiling reduction requires one scope and one canonical positive exact decimal.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    }
    case 'SET_STRATEGY_THRESHOLD': {
      const decimal = value.value;
      const pairValid = (value.strategy === 'BASIS' && value.threshold === 'MIN_NET_BASIS_PCT')
        || (value.strategy === 'VOLUME' && value.threshold === 'VOLUME_1S_MULTIPLE');
      const numeric = typeof decimal === 'string' ? Number(decimal) : Number.NaN;
      const bounded = value.strategy === 'BASIS'
        ? numeric >= 0.01 && numeric <= 100
        : numeric >= 1 && numeric <= 100;
      if (!exactKeys(value, ['command', 'strategy', 'threshold', 'value'])
        || !pairValid
        || typeof decimal !== 'string'
        || !POSITIVE_EXACT_DECIMAL_PATTERN.test(decimal)
        || decimal.replace('.', '').length > 12
        || !Number.isFinite(numeric)
        || !bounded) {
        return invalid('Strategy threshold requires one approved strategy/key pair and a bounded canonical value.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    }
    case 'PIN_FOCUS':
      if (!exactKeys(value, ['command', 'symbol', 'pinned'])
        || typeof value.symbol !== 'string'
        || !STRATEGY_SYMBOL_PATTERN.test(value.symbol)
        || typeof value.pinned !== 'boolean') {
        return invalid('Focus pin requires one canonical symbol and boolean pinned value.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'SET_SAFE_MODE':
      if (!exactKeys(value, ['command', 'safeMode']) || typeof value.safeMode !== 'string') {
        return invalid('Mode mutation requires one safeMode value.');
      }
      if (isBlockedExecutionMode(value.safeMode)) {
        return {
          ok: false,
          code: 'LIVE_EXECUTION_NOT_IMPLEMENTED',
          message: 'Live and autonomous execution modes are not implemented.',
        };
      }
      if (!SAFE_MODES.has(value.safeMode)) return invalid('Mode must be READ_ONLY, ADVISORY, or VALIDATE_ONLY.');
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'SET_KILL_SWITCH':
      if (!exactKeys(value, ['command', 'engaged']) || typeof value.engaged !== 'boolean') {
        return invalid('Kill-switch mutation requires one boolean engaged value.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'APPLY_CONFIGURATION':
      if (
        !exactKeys(value, ['command', 'configurationRevision', 'payloadDigest'])
        || typeof value.configurationRevision !== 'string'
        || !CONFIGURATION_REVISION_PATTERN.test(value.configurationRevision)
        || typeof value.payloadDigest !== 'string'
        || !PAYLOAD_DIGEST_PATTERN.test(value.payloadDigest)
      ) return invalid('Configuration activation requires a bounded revision and SHA-256 digest.');
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'REVOKE_APPROVAL':
      if (
        !exactKeys(value, ['command', 'approvalId'])
        || typeof value.approvalId !== 'string'
        || !OPAQUE_CONTROL_ID_PATTERN.test(value.approvalId)
      ) return invalid('Approval revocation requires one bounded approvalId.');
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'REVOKE_RESERVATION':
      if (
        !exactKeys(value, ['command', 'reservationId'])
        || typeof value.reservationId !== 'string'
        || !OPAQUE_CONTROL_ID_PATTERN.test(value.reservationId)
      ) return invalid('Reservation revocation requires one bounded reservationId.');
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'RESTART_COMPONENT':
      if (
        !exactKeys(value, ['command', 'componentId'])
        || typeof value.componentId !== 'string'
        || !COMPONENT_IDS.has(value.componentId)
      ) return invalid('Restart requires one known componentId.');
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'CLEAR_DEPLOYMENT_FREEZE':
      if (!exactKeys(value, ['command', 'expectedObservedAtUtc'])
        || typeof value.expectedObservedAtUtc !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.expectedObservedAtUtc)
        || !Number.isFinite(Date.parse(value.expectedObservedAtUtc))) {
        return invalid('Freeze clear requires one exact canonical observedAtUtc revision.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
    case 'SET_PUBLIC_SOURCE_LIFECYCLE':
      if (!exactKeys(value, ['command', 'sourceId', 'action'])
        || (value.sourceId !== 'public-spot-source' && value.sourceId !== 'public-usdm-source')
        || (value.action !== 'ISOLATE' && value.action !== 'RESTART')) {
        return invalid('Public-source lifecycle control requires one known sourceId and ISOLATE or RESTART.');
      }
      return { ok: true, mutation: value as unknown as Readonly<SystemControlMutation> };
  }
  return invalid('Mutation command is unsupported.');
}

export function validReason(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !containsSensitiveMaterial(value);
}

export function containsSensitiveMaterial(value: string): boolean {
  return SENSITIVE_MATERIAL_PATTERN.test(value);
}
