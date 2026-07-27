/* Strict decoder for Binance `GET /sapi/v1/account/apiRestrictions` answers.
 *
 * That answer is the only evidence that a deployed key is read-only and pinned
 * to a fixed egress, so the decode is fail-closed and side-effect free: it
 * reads own data properties only, invokes nothing, and never resolves an
 * absent or non-boolean flag into a green verdict. The payload must also match
 * the documented contract exactly: a key this decoder does not recognize means
 * the answer is no longer the answer this code was proven against, so it
 * degrades to UNKNOWN rather than deciding a safety verdict from a shape it
 * cannot account for. Facts are returned, never the caller's object and never
 * a fragment of the raw payload. */

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

/**
 * A read-only permission, reported for owner context. It grants no action
 * authority, so either boolean value is safe and it never appears as a
 * violation. It is still required to decode as a boolean because it is part
 * of the current response contract.
 */
const INFORMATIONAL_FLAG = 'enableFixReadOnly';

/**
 * Every field `GET /sapi/v1/account/apiRestrictions` currently returns. Any
 * other own key is contract drift: Binance changed the answer, so the decode
 * fails closed until this list is re-verified against the published contract.
 */
const CONTRACT_KEYS: ReadonlySet<string> = new Set<string>([
  ...REQUIRED_FLAGS, INFORMATIONAL_FLAG, 'createTime',
]);

export type RequiredPrivateReadFlag = (typeof REQUIRED_FLAGS)[number];

export type PrivateReadPermissionStatus = 'VERIFIED' | 'UNSAFE' | 'UNKNOWN';

export type PrivateReadPermissionReason =
  | null
  | 'MALFORMED_OR_INCOMPLETE'
  | 'UNEXPECTED_RESPONSE_FIELD'
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

/**
 * True when every own key belongs to the documented contract. Symbol keys are
 * rejected outright: Binance answers arrive through `JSON.parse`, which never
 * produces one, so a symbol key can only come from a payload this decoder was
 * never proven against.
 */
function matchesContractShape(record: Readonly<Record<string, unknown>>): boolean {
  return Reflect.ownKeys(record)
    .every((key) => typeof key === 'string' && CONTRACT_KEYS.has(key));
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
 * a passing check.
 *
 * Missing evidence outranks a bad posture: an incomplete payload is UNKNOWN
 * even when the flags it did carry are already violated. Contract drift
 * outranks both, because an unrecognized field means the flags themselves may
 * no longer mean what this decoder assumes, but the observed breaches are
 * still reported so an unsafe key is never silenced by a shape complaint.
 */
export function decodePrivateReadPermissions(payload: unknown): PrivateReadPermissions {
  const record = plainObjectOrNull(payload);
  const flags = decodeRequiredFlags(record);
  const violations = violatedFlags(flags);
  const recognized = record !== null && matchesContractShape(record);
  const complete = REQUIRED_FLAGS.every((flag) => typeof flags[flag] === 'boolean')
    && typeof ownBoolean(record, INFORMATIONAL_FLAG) === 'boolean';

  let status: PrivateReadPermissionStatus = 'UNKNOWN';
  let reason: PrivateReadPermissionReason = record !== null && !recognized
    ? 'UNEXPECTED_RESPONSE_FIELD'
    : 'MALFORMED_OR_INCOMPLETE';
  if (recognized && complete) {
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
