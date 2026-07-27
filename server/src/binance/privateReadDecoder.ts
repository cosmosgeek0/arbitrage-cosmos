/* Strict decoder for Binance `GET /sapi/v1/account/apiRestrictions` answers.
 *
 * That answer is the only evidence that a deployed key is read-only and pinned
 * to a fixed egress, so the decode is fail-closed and side-effect free: it
 * reads own data properties only, invokes nothing, and never resolves an
 * absent or non-boolean flag into a green verdict. Unknown response keys —
 * including fields Binance may add later — are ignored rather than carried
 * out, so no fragment of the raw payload can escape through this boundary. */

const REQUIRED_TRUE_FLAGS = Object.freeze([
  'enableReading', 'ipRestrict',
] as const);

const REQUIRED_FALSE_FLAGS = Object.freeze([
  'enableWithdrawals', 'enableInternalTransfer', 'enableMargin', 'enableFutures',
  'permitsUniversalTransfer', 'enableVanillaOptions', 'enableFixApiTrade',
  'enableSpotAndMarginTrading', 'enablePortfolioMarginTrading',
] as const);

const REQUIRED_FLAGS = Object.freeze([
  ...REQUIRED_TRUE_FLAGS, ...REQUIRED_FALSE_FLAGS,
] as const);

/** Reported for owner context; carries no authority over the verdict. */
const INFORMATIONAL_FLAG = 'enableFixReadOnly';

export type RequiredPrivateReadFlag = (typeof REQUIRED_FLAGS)[number];

export type PrivateReadPermissionStatus = 'VERIFIED' | 'UNSAFE' | 'UNKNOWN';

export type PrivateReadPermissionReason =
  | null
  | 'MALFORMED_OR_INCOMPLETE'
  | 'UNSAFE_PERMISSION_POSTURE';

type RequiredPrivateReadFlags = { readonly [K in RequiredPrivateReadFlag]: boolean | null };

export interface PrivateReadPermissions extends RequiredPrivateReadFlags {
  readonly enableFixReadOnly: boolean | null;
  readonly status: PrivateReadPermissionStatus;
  readonly violations: readonly string[];
  readonly reason: PrivateReadPermissionReason;
}

/**
 * Admits only a plain object: arrays, primitives, functions and class
 * instances are shapes Binance never returns here, so treating them as
 * absent evidence is stricter than probing them for flags. A cross-realm
 * object is rejected for the same reason — the decoder answers UNKNOWN
 * rather than guess at an origin it cannot account for.
 */
function plainObjectOrNull(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Reads one flag as a fact or as nothing. Inherited properties are ignored so
 * a polluted prototype cannot supply a permission, and accessor properties are
 * ignored so deciding a safety verdict never runs foreign code.
 */
function ownBoolean(record: Readonly<Record<string, unknown>> | null, flag: string): boolean | null {
  if (record === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(record, flag);
  if (descriptor === undefined || !('value' in descriptor)) return null;
  return typeof descriptor.value === 'boolean' ? descriptor.value : null;
}

function decodeRequiredFlags(record: Readonly<Record<string, unknown>> | null): RequiredPrivateReadFlags {
  const decoded: Partial<Record<RequiredPrivateReadFlag, boolean | null>> = {};
  for (const flag of REQUIRED_FLAGS) decoded[flag] = ownBoolean(record, flag);
  return decoded as RequiredPrivateReadFlags;
}

/**
 * Names the flags whose safe value is contradicted by an observed boolean.
 * A `null` flag is unproven rather than violated, so it is never listed here;
 * incompleteness is reported by the status instead.
 */
function violatedFlags(flags: RequiredPrivateReadFlags): string[] {
  const violations: string[] = [];
  for (const flag of REQUIRED_TRUE_FLAGS) if (flags[flag] === false) violations.push(flag);
  for (const flag of REQUIRED_FALSE_FLAGS) if (flags[flag] === true) violations.push(flag);
  return violations.sort();
}

/**
 * Normalizes an `apiRestrictions` payload into a verdict plus the flags that
 * justify it. Returns facts only — never the caller's object, and never a
 * stringified copy of it — and never throws, so a transport surprise
 * degrades to UNKNOWN instead of an exception path that could be mistaken for
 * a passing check. Missing evidence outranks a bad posture: an incomplete
 * payload is UNKNOWN even when the flags it did carry are already violated.
 */
export function decodePrivateReadPermissions(payload: unknown): PrivateReadPermissions {
  const record = plainObjectOrNull(payload);
  const flags = decodeRequiredFlags(record);
  const violations = violatedFlags(flags);
  const complete = REQUIRED_FLAGS.every((flag) => typeof flags[flag] === 'boolean');

  let status: PrivateReadPermissionStatus = 'UNKNOWN';
  let reason: PrivateReadPermissionReason = 'MALFORMED_OR_INCOMPLETE';
  if (complete) {
    status = violations.length === 0 ? 'VERIFIED' : 'UNSAFE';
    reason = violations.length === 0 ? null : 'UNSAFE_PERMISSION_POSTURE';
  }

  return Object.freeze({
    ...flags,
    enableFixReadOnly: ownBoolean(record, INFORMATIONAL_FLAG),
    status,
    violations: Object.freeze(violations) as readonly string[],
    reason,
  });
}
