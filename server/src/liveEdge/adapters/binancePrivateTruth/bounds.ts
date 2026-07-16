import { types as utilTypes } from 'node:util';

export const PRIVATE_DATA_BOUNDS = Object.freeze({
  maximumDepth: 12,
  maximumNodes: 250_000,
  maximumAggregateStringUnits: 4 * 1_024 * 1_024,
  maximumStringUnits: 512,
  maximumKeyUnits: 256,
  maximumObjectKeys: 128,
  maximumArrayEntries: 8_192,
  maximumSources: 64,
  maximumAssets: 2_048,
  maximumPositions: 2_048,
  maximumLiabilities: 2_048,
  maximumOrders: 4_096,
  maximumTrades: 8_192,
  maximumMismatches: 256,
  maximumFactAgeMs: 300_000,
} as const);

type PlainRecord = Record<string, unknown>;

const SECRET_KEY = /^(?:api[_-]?key|secret(?:[_-]?key)?|private[_-]?key|signature|listen[_-]?(?:key|token)|session[_-]?(?:key|token)|credentials?|authorization|x[_-]?mbx[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|bearer[_-]?token|password|passphrase|mnemonic|seed)$/i;
const SECRET_KEY_COMPACT = /^(?:(?:(?:(?:aws|client|api|access)?(?:secretaccesskey|accesskey|apikey)|api(?:key|secret)|clientsecret|secret(?:key)?|privatekey|signature|listen(?:key|token)|session(?:key|token)|credential|credentials|authorization|xmbxapikey|access(?:key|token)|refresh(?:key|token)|bearer(?:key|token)|password|passphrase|mnemonic|seed)(?:id|identifier)?(?:value|text|data|raw|pem|material|header|hash)?)|[a-z0-9]*(?:credential|credentials|token|password|passphrase|mnemonic|seed)(?:id|identifier)?(?:value|text|data|raw|material|header|hash)?)$/i;
const COMPOUND_SECRET_KEY_COMPACT = /^(?:(?:(?:aws|api)client|clientaccess)secret(?:id|identifier|key|token)?(?:value|text|data|raw|material|hash)?|secrettokenkey(?:id|identifier|value|text|data|raw|material|hash)?|api(?:credential|credentials)key(?:id|identifier|value|text|data|raw|material|hash)?|awssigningkey(?:id|identifier|value|text|data|raw|material|hash)?)$/i;
const DOCUMENTARY_SECRET_LIKE_FIELDS = Object.freeze([
  'externalactionauthorization',
  'listenkeynotfoundcount',
  'signatureauthorized',
  'signaturekeytype',
] as const);
const SEMANTIC_SECRET_FIELD_ROOTS = Object.freeze([
  'xmbxapikey', 'awssecretaccesskey', 'secretaccesskey', 'awsaccesskeyid',
  'accesskeyid', 'apikey', 'clientsecret', 'privatekey', 'accesstoken',
  'refreshtoken', 'bearertoken', 'sessiontoken', 'sessionkey', 'listenkey',
  'listentoken', 'credentials', 'credential', 'authorization', 'password',
  'passphrase', 'mnemonic', 'seed', 'signature',
] as const);
const SECRET_TEXT = /-----BEGIN (?:ENCRYPTED |RSA |EC )?PRIVATE KEY-----|(?:(?:aws[_-]?)?(?:secret[_-]?access[_-]?key|access[_-]?key(?:[_-]?(?:id|identifier))?)|(?:api|client[_-]?api|access[_-]?api)[_-]?key(?:[_-]?(?:id|identifier))?|client[_-]?secret(?:[_-]?(?:id|identifier))?|x[_-]?mbx[_-]?api[_-]?key|api[_-]?(?:key|secret)|secret(?:[_-]?(?:key|value))?|private[_-]?key(?:[_-]?pem)?|(?:listen|session|access|refresh|bearer)[_-]?(?:key|token)(?:[_-]?value)?|[A-Za-z0-9_-]*(?:credentials?|token|password|passphrase|mnemonic|seed)(?:[_-]?(?:id|identifier))?(?:[_-]?(?:value|text|data|raw|material|hash))?|authorization(?:[_-]?header)?)\s*[:=]|(?:authorization(?:[_-]?header)?\s*[:=]\s*)?bearer\s+[A-Za-z0-9._~+/=-]{8,}/i;
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:(?:(?:ENCRYPTED|RSA|EC|DSA|OPENSSH) )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/i;
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOKEN = /^[A-Z0-9][A-Z0-9._:-]{0,127}$/;
const BARE_BEARER_SHAPED_IDENTIFIER = /^(?=[A-Za-z0-9]{40,512}$)(?=.*[A-Za-z])[A-Za-z0-9]+$/;
const COMPACT_JWT = /^eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){2,4}$/;
const NAMESPACED_COMPACT_JWT = /^(?:jwt|bearer|token)[:=]eyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){2,4}$/i;
const JWT_HEADER_SEGMENT = /^eyJ[A-Za-z0-9_-]{5,}$/;
const AWS_ACCESS_KEY_IDENTIFIER = /^(?:A3T[A-Z0-9]|ABIA|ACCA|AGPA|AIDA|AIPA|AKIA|ANPA|ANVA|APKA|AROA|ASCA|ASIA)[A-Z0-9]{16}$/;
const PADDED_BASE64_CREDENTIAL_MATERIAL = /^(?=.{32,512}$)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/;
const ENCODED_CREDENTIAL_MATERIAL = /^(?=.{32,512}$)(?=[A-Za-z0-9+/_-]+={0,2}$)(?=.*[A-Z])(?=.*[a-z])(?=.*[+/_=-])[A-Za-z0-9+/_-]+={0,2}$/;
const BASE64URL_NAMESPACE_SEGMENT = /^(?=.{32,512}$)(?=.*[A-Za-z])(?=.*[0-9_-])[A-Za-z0-9_-]+$/;
const ACCOUNT_REALM_REFERENCE = /^(?:account[.:][A-Za-z0-9][A-Za-z0-9._:-]*|account-realm[.:-][A-Za-z0-9][A-Za-z0-9._:-]*|[A-Za-z0-9]+-realm[.:-][A-Za-z0-9][A-Za-z0-9._:-]*|realm[.:-][A-Za-z0-9][A-Za-z0-9._:-]*)$/;
const PROFILE_REFERENCE = /^(?:profile[.:-][A-Za-z0-9][A-Za-z0-9._:-]*|(?:read|execution)-profile[.:-][A-Za-z0-9][A-Za-z0-9._:-]*)$/;
const ACCOUNT_FINGERPRINT_REFERENCE = /^(?:account[.:]fingerprint[.:-][A-Za-z0-9][A-Za-z0-9._:-]*|account-fingerprint[.:-][A-Za-z0-9][A-Za-z0-9._:-]*|[A-Za-z0-9]+-fingerprint[.:-][A-Za-z0-9][A-Za-z0-9._:-]*)$/;

function privateInputError(message: string): TypeError {
  return new TypeError(`private evidence rejected: ${message}`);
}

function semanticSecretFieldName(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if ((DOCUMENTARY_SECRET_LIKE_FIELDS as readonly string[]).includes(compact)) return false;
  const tokens = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
  return SEMANTIC_SECRET_FIELD_ROOTS.some((root) => compact.includes(root))
    || tokens.some((token) => (
    /^(?:secret|credentials?|password|passphrase|mnemonic|seed)$/i.test(token)
  )) || (tokens.includes('signing') && tokens.includes('key'));
}

function secretFieldName(value: string): boolean {
  return SECRET_KEY.test(value)
    || SECRET_KEY_COMPACT.test(value.replace(/[_-]/g, ''))
    || COMPOUND_SECRET_KEY_COMPACT.test(value.replace(/[_-]/g, ''))
    || semanticSecretFieldName(value);
}

function secretAssignmentText(value: string): boolean {
  for (const match of value.matchAll(
    /(?:^|[\s,;{[(])["']?([A-Za-z][A-Za-z0-9_-]{0,255})["']?\s*[:=]/g,
  )) {
    const assignmentKey = match[1];
    if (assignmentKey !== undefined && secretFieldName(assignmentKey)) return true;
  }
  return false;
}

function secretShapedText(value: string, fieldName: string | null): boolean {
  if (SECRET_TEXT.test(value) || PRIVATE_KEY_BLOCK.test(value)
    || secretAssignmentText(value) || COMPACT_JWT.test(value)
    || NAMESPACED_COMPACT_JWT.test(value) || AWS_ACCESS_KEY_IDENTIFIER.test(value)) return true;
  if (fieldName === 'matrixSha256' && /^[0-9a-f]{64}$/.test(value)) return false;
  return BARE_BEARER_SHAPED_IDENTIFIER.test(value)
    || PADDED_BASE64_CREDENTIAL_MATERIAL.test(value)
    || ENCODED_CREDENTIAL_MATERIAL.test(value);
}

function secretShapedNamespaceSuffix(value: string): boolean {
  const match = /^(?:account[.:]|account-realm[.:-]|[A-Za-z0-9]+-realm[.:-]|realm[.:-]|profile[.:-]|(?:read|execution)-profile[.:-]|account[.:]fingerprint[.:-]|account-fingerprint[.:-]|[A-Za-z0-9]+-fingerprint[.:-])(.+)$/.exec(value);
  if (match === null) return false;
  const suffix = match[1];
  if (suffix === undefined || secretShapedText(suffix, null) || secretFieldName(suffix)) return true;
  return suffix.split(/[.:-]/u).some((segment) => (
    segment.length > 0
      && (secretShapedText(segment, null)
        || secretFieldName(segment)
        || JWT_HEADER_SEGMENT.test(segment)
        || BASE64URL_NAMESPACE_SEGMENT.test(segment))
  ));
}

export function snapshotPrivateData(input: unknown): unknown {
  const budget = { nodes: 0, stringUnits: 0 };
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number, fieldName: string | null): unknown => {
    budget.nodes += 1;
    if (depth > PRIVATE_DATA_BOUNDS.maximumDepth || budget.nodes > PRIVATE_DATA_BOUNDS.maximumNodes) {
      throw new RangeError('private evidence rejected: bounded graph exceeded');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
        throw privateInputError('numbers must be finite safe integers');
      }
      return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === 'string') {
      if (value.length > PRIVATE_DATA_BOUNDS.maximumStringUnits) {
        throw new RangeError('private evidence rejected: string bound exceeded');
      }
      if (UNSAFE_TEXT.test(value) || secretShapedText(value, fieldName)) {
        throw privateInputError('unsafe or secret-shaped text');
      }
      budget.stringUnits += value.length;
      if (budget.stringUnits > PRIVATE_DATA_BOUNDS.maximumAggregateStringUnits) {
        throw new RangeError('private evidence rejected: aggregate string bound exceeded');
      }
      return value;
    }
    if (typeof value !== 'object' || utilTypes.isProxy(value)) {
      throw privateInputError('only non-proxy JSON-like data is accepted');
    }
    if (seen.has(value)) throw privateInputError('cycles and aliases are forbidden');
    seen.add(value);

    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) throw privateInputError('symbol keys are forbidden');

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > PRIVATE_DATA_BOUNDS.maximumArrayEntries) {
        throw new RangeError('private evidence rejected: array is invalid or overbound');
      }
      if (keys.length !== value.length + 1) throw privateInputError('arrays must be dense and unnamed');
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw privateInputError('arrays must use dense enumerable data properties');
        }
        output.push(visit(descriptor.value, depth + 1, fieldName));
      }
      return output;
    }

    if (prototype !== Object.prototype && prototype !== null) throw privateInputError('plain objects are required');
    if (keys.length > PRIVATE_DATA_BOUNDS.maximumObjectKeys) {
      throw new RangeError('private evidence rejected: object key bound exceeded');
    }
    const output: PlainRecord = Object.create(null) as PlainRecord;
    for (const key of keys as string[]) {
      if (key.length > PRIVATE_DATA_BOUNDS.maximumKeyUnits) throw new RangeError('private evidence rejected: key bound exceeded');
      if (secretFieldName(key)) throw privateInputError('secret-shaped field name');
      budget.stringUnits += key.length;
      if (budget.stringUnits > PRIVATE_DATA_BOUNDS.maximumAggregateStringUnits) {
        throw new RangeError('private evidence rejected: aggregate string bound exceeded');
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw privateInputError('objects must use enumerable data properties');
      }
      output[key] = visit(descriptor.value, depth + 1, key);
    }
    return output;
  };

  return visit(input, 0, null);
}

export function privateRecord(value: unknown, fields: readonly string[], label: string): Readonly<PlainRecord> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw privateInputError(`${label} must be a record`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw privateInputError(`${label} must use exact fields`);
  }
  return value as Readonly<PlainRecord>;
}

export function privateString(value: unknown, label: string, maximum = 128): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value.trim() !== value || UNSAFE_TEXT.test(value) || secretShapedText(value, null)) {
    throw privateInputError(`${label} must be bounded safe text`);
  }
  return value;
}

export function privateIdentifier(value: unknown, label: string): string {
  const normalized = privateString(value, label, 128);
  if (!IDENTIFIER.test(normalized) || BARE_BEARER_SHAPED_IDENTIFIER.test(normalized)) {
    throw privateInputError(`${label} must be a canonical non-secret identifier`);
  }
  return normalized;
}

function namespacedReference(value: unknown, label: string, pattern: RegExp, namespace: string): string {
  const normalized = privateIdentifier(value, label);
  if (!pattern.test(normalized) || secretShapedNamespaceSuffix(normalized)) {
    throw privateInputError(`${label} must be a namespaced ${namespace} reference`);
  }
  return normalized;
}

export function privateAccountRealmReference(value: unknown, label = 'accountRealmId'): string {
  return namespacedReference(value, label, ACCOUNT_REALM_REFERENCE, 'account-realm');
}

export function privateProfileReference(value: unknown, label = 'profileId'): string {
  return namespacedReference(value, label, PROFILE_REFERENCE, 'profile');
}

export function privateAccountFingerprintReference(
  value: unknown,
  label = 'accountFingerprintRef',
): string {
  return namespacedReference(value, label, ACCOUNT_FINGERPRINT_REFERENCE, 'account-fingerprint');
}

export function privateToken(value: unknown, label: string): string {
  const normalized = privateString(value, label, 128);
  if (!TOKEN.test(normalized)) throw privateInputError(`${label} must be a canonical uppercase token`);
  return normalized;
}

export function privateInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw privateInputError(`${label} must be a bounded safe integer`);
  }
  return value;
}

export function privateBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw privateInputError(`${label} must be boolean`);
  return value;
}

export function privateArray(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw privateInputError(`${label} must be a bounded array`);
  }
  return value;
}

export function privateSortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

export function deepFreezePrivate<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreezePrivate(descriptor.value, seen);
  }
  return Object.freeze(value);
}
