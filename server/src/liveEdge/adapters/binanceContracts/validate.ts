import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

import { BINANCE_CONTRACT_MATRIX, BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 } from './matrix.js';
import {
  BINANCE_ACTION_AUTHORITIES,
  BINANCE_AMBIGUITY_CLASSES,
  BINANCE_CONTRACT_MATRIX_CHECKED_AT,
  BINANCE_CONTRACT_MATRIX_REVISION,
  BINANCE_CONTRACT_MATRIX_SCHEMA,
  BINANCE_DATA_SOURCES,
  BINANCE_DIGEST_SCOPES,
  BINANCE_DOCUMENTARY_AUTHORITIES,
  BINANCE_ENCODINGS,
  BINANCE_ENVIRONMENTS,
  BINANCE_EXTERNAL_ACTION_AUTHORIZATIONS,
  BINANCE_HTTP_METHODS,
  BINANCE_KEY_TYPES,
  BINANCE_LIFECYCLES,
  BINANCE_MUTATION_CLASSES,
  BINANCE_OPERATION_KINDS,
  BINANCE_PRODUCTS,
  BINANCE_RATE_KINDS,
  BINANCE_RATE_CONDITIONS,
  BINANCE_RATE_INTERVALS,
  BINANCE_RATE_SCOPES,
  BINANCE_RATE_STATES,
  BINANCE_REALMS,
  BINANCE_RESPONSE_SCHEMA_STATES,
  BINANCE_SAFE_RETRY_CLASSES,
  BINANCE_SECURITY_TYPES,
  BINANCE_SIGNING_ALGORITHMS,
  BINANCE_SOURCE_CONTENT_DIGEST_SCOPES,
  BINANCE_TIMESTAMP_UNITS,
  BINANCE_TRANSPORTS,
  type BinanceContractIssue,
  type BinanceContractMatrix,
  type BinanceContractRecord,
  type BinanceMatrixValidationResult,
  type BinanceOfficialSourceRecord,
  type BinanceOperation,
  type BinanceProduct,
  type BinanceRouteFixture,
  type BinanceRouteFixtureResult,
} from './types.js';

type UnknownRecord = Record<string, unknown>;
type AddIssue = (path: string, code: string, message: string) => void;

const MAXIMUM_ISSUES = 128;
const MAXIMUM_DEPTH = 24;
const MAXIMUM_NODES = 20_000;
const MAXIMUM_ARRAY_LENGTH = 512;
const MAXIMUM_OBJECT_KEYS = 256;
const MAXIMUM_STRING_LENGTH = 8_192;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER_PATTERN = /^[A-Z0-9][A-Z0-9_.-]{2,127}$/;

const MATRIX_KEYS = [
  'schema', 'revision', 'checkedAt', 'documentaryAuthority', 'externalActionAuthorization',
  'selectedPrivateContractIds', 'selectedSpotUserDataEncoding', 'selectedSpotSignatureKeyType',
  'spotUserDataLifecycle', 'rateHeaderTemplates', 'protectedLocators', 'marginAccountModeFacts',
  'apiKeyProfilePolicy', 'apiKeyPermissionFields', 'unsupportedAccountModes',
  'sources', 'contracts',
  'approvedProductBases', 'obsoleteRouteFacts', 'contentSha256',
] as const;
const SOURCE_KEYS = [
  'id', 'productScopes', 'pageTitle', 'officialUrl', 'checkedAt', 'lastModified', 'revisionSignal',
  'digestScope', 'evidence', 'evidenceSha256', 'sourceContentDigestScope', 'sourceContentUrl',
  'sourceContentSha256',
] as const;
const CONTRACT_KEYS = [
  'id', 'product', 'environment', 'realm', 'transport', 'lifecycle', 'baseUrl', 'operation', 'authentication',
  'rateLimit', 'connection', 'dataSource', 'mutationClass', 'ambiguityClass', 'safeRetryClass',
  'responseSchema', 'sourceIds', 'documentaryAuthority', 'externalActionAuthorization',
  'actionAuthority', 'notes',
] as const;
const OPERATION_KEYS = ['kind', 'httpMethod', 'value', 'queryTemplate'] as const;
const AUTHENTICATION_KEYS = [
  'securityType', 'permittedKeyTypes', 'signingAlgorithm', 'canonicalEncoding', 'timestampUnit',
  'recvWindowDefaultMs', 'recvWindowMaxMs', 'requiredParameters',
] as const;
const RATE_LIMIT_KEYS = ['state', 'claims'] as const;
const RATE_CLAIM_KEYS = ['sourceId', 'kind', 'scope', 'value', 'interval', 'header', 'condition'] as const;
const CONNECTION_KEYS = [
  'connectionLifetimeMinutes', 'tokenLifetimeMinutes', 'renewalRule', 'pingIntervalSeconds',
  'pongTimeoutSeconds', 'incomingMessagesPerSecond', 'maximumStreams', 'orderingRule',
] as const;
const RESPONSE_SCHEMA_KEYS = ['state', 'revision', 'sha256'] as const;
const FIXTURE_KEYS = ['id', 'product', 'environment', 'realm', 'transport', 'baseUrl', 'operation'] as const;

function isRecord(value: unknown): value is UnknownRecord {
  try {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function ownValue(record: UnknownRecord, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = left[Symbol.iterator]();
  const rightPoints = right[Symbol.iterator]();
  while (true) {
    const leftPoint = leftPoints.next();
    const rightPoint = rightPoints.next();
    if (leftPoint.done || rightPoint.done) {
      if (leftPoint.done === rightPoint.done) return 0;
      return leftPoint.done ? -1 : 1;
    }
    const leftCode = leftPoint.value.codePointAt(0) ?? 0;
    const rightCode = rightPoint.value.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
}

function validCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function appendPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function inspectClosedJson(value: unknown, addIssue: AddIssue): boolean {
  const seen = new Set<object>();
  let nodes = 0;
  let valid = true;

  const visit = (current: unknown, path: string, depth: number): void => {
    if (nodes >= MAXIMUM_NODES) {
      addIssue(path, 'JSON_NODE_LIMIT', 'Matrix exceeds the node limit');
      valid = false;
      return;
    }
    nodes += 1;
    if (depth > MAXIMUM_DEPTH) {
      addIssue(path, 'JSON_DEPTH_LIMIT', 'Matrix exceeds the depth limit');
      valid = false;
      return;
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (current.length > MAXIMUM_STRING_LENGTH || current.includes('\u0000')) {
        addIssue(path, 'STRING_INVALID', 'Strings must be bounded and contain no NUL');
        valid = false;
      }
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isSafeInteger(current) || Object.is(current, -0)) {
        addIssue(path, 'NUMBER_INVALID', 'Numbers must be finite safe integers and not negative zero');
        valid = false;
      }
      return;
    }
    if (typeof current !== 'object' || current === null) {
      addIssue(path, 'JSON_TYPE_INVALID', 'Only plain finite JSON data is allowed');
      valid = false;
      return;
    }
    if (utilTypes.isProxy(current)) {
      addIssue(path, 'PROXY_FORBIDDEN', 'Proxy objects are not accepted as documentary data');
      valid = false;
      return;
    }
    if (seen.has(current)) {
      addIssue(path, 'JSON_CYCLE', 'Cycles are not allowed');
      valid = false;
      return;
    }
    seen.add(current);

    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype || current.length > MAXIMUM_ARRAY_LENGTH) {
          addIssue(path, 'ARRAY_INVALID', 'Arrays must be ordinary and bounded');
          valid = false;
          return;
        }
        if (Object.getOwnPropertySymbols(current).length > 0) {
          addIssue(path, 'SYMBOL_PROPERTY', 'Symbol properties are not allowed');
          valid = false;
        }
        const descriptors = Object.getOwnPropertyDescriptors(current);
        const allowedKeys = new Set(['length']);
        for (let index = 0; index < current.length; index += 1) allowedKeys.add(String(index));
        for (const key of Object.keys(descriptors)) {
          if (!allowedKeys.has(key)) {
            addIssue(appendPath(path, key), 'ARRAY_EXTRA_PROPERTY', 'Array has an extra property');
            valid = false;
          }
        }
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
            addIssue(`${path}[${index}]`, 'ARRAY_SLOT_INVALID', 'Array slots must be enumerable own data');
            valid = false;
            continue;
          }
          visit(descriptor.value, `${path}[${index}]`, depth + 1);
        }
        return;
      }

      if (Object.getPrototypeOf(current) !== Object.prototype) {
        addIssue(path, 'OBJECT_PROTOTYPE_INVALID', 'Objects must use Object.prototype');
        valid = false;
        return;
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        addIssue(path, 'SYMBOL_PROPERTY', 'Symbol properties are not allowed');
        valid = false;
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      if (Object.keys(descriptors).length > MAXIMUM_OBJECT_KEYS) {
        addIssue(path, 'OBJECT_KEY_LIMIT', 'Objects must have a bounded number of own properties');
        valid = false;
        return;
      }
      for (const key of Object.keys(descriptors).sort(codePointCompare)) {
        const descriptor = descriptors[key];
        if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
          addIssue(appendPath(path, key), 'PROPERTY_DESCRIPTOR_INVALID', 'Properties must be enumerable own data');
          valid = false;
          continue;
        }
        visit(descriptor.value, appendPath(path, key), depth + 1);
      }
    } catch {
      addIssue(path, 'OBJECT_INSPECTION_FAILED', 'Object inspection must be side-effect free');
      valid = false;
    } finally {
      seen.delete(current);
    }
  };

  visit(value, '$', 0);
  return valid;
}

function exactKeys(record: UnknownRecord, expected: readonly string[], path: string, addIssue: AddIssue): boolean {
  const actual = Object.keys(record).sort(codePointCompare);
  const allowed = new Set(expected);
  let valid = true;
  for (const key of actual) {
    if (!allowed.has(key)) {
      addIssue(appendPath(path, key), 'UNKNOWN_FIELD', 'Unknown fields are rejected');
      valid = false;
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(record, key)) {
      addIssue(appendPath(path, key), 'MISSING_FIELD', 'Required field is missing');
      valid = false;
    }
  }
  return valid;
}

function isEnumValue(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === 'string' && allowed.includes(value);
}

function requireEnum(
  record: UnknownRecord,
  key: string,
  allowed: readonly string[],
  path: string,
  addIssue: AddIssue,
): string | null {
  const value = ownValue(record, key);
  if (!isEnumValue(value, allowed)) {
    addIssue(appendPath(path, key), 'ENUM_INVALID', `Expected one of: ${allowed.join(', ')}`);
    return null;
  }
  return value;
}

function requireString(record: UnknownRecord, key: string, path: string, addIssue: AddIssue): string | null {
  const value = ownValue(record, key);
  if (typeof value !== 'string' || value.length === 0) {
    addIssue(appendPath(path, key), 'STRING_REQUIRED', 'A non-empty string is required');
    return null;
  }
  return value;
}

function arrayValue(record: UnknownRecord, key: string, path: string, addIssue: AddIssue): readonly unknown[] | null {
  const value = ownValue(record, key);
  if (!Array.isArray(value)) {
    addIssue(appendPath(path, key), 'ARRAY_REQUIRED', 'An array is required');
    return null;
  }
  return value;
}

function recordValue(record: UnknownRecord, key: string, path: string, addIssue: AddIssue): UnknownRecord | null {
  const value = ownValue(record, key);
  if (!isRecord(value)) {
    addIssue(appendPath(path, key), 'OBJECT_REQUIRED', 'An object is required');
    return null;
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return String(value);
  if (typeof value !== 'object') throw new TypeError('canonical JSON requires closed JSON data');
  if (seen.has(value)) throw new TypeError('canonical JSON rejects cycles');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('canonical JSON rejects sparse arrays');
        items.push(canonicalJson(descriptor.value, seen));
      }
      return `[${items.join(',')}]`;
    }
    const record = value as UnknownRecord;
    const entries = Object.keys(record).sort(codePointCompare).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('canonical JSON rejects accessors');
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeBinanceSourceEvidence(source: BinanceOfficialSourceRecord): string {
  let closed = true;
  inspectClosedJson(source, () => { closed = false; });
  if (!closed) throw new TypeError('source evidence must be closed plain data');
  const record = source as unknown as UnknownRecord;
  const evidence = ownValue(record, 'evidence');
  if (!Array.isArray(evidence)) throw new TypeError('source evidence must be an array');
  return canonicalJson([
    'BINANCE_OFFICIAL_SOURCE_EVIDENCE_V1',
    ownValue(record, 'id'),
    ownValue(record, 'productScopes'),
    ownValue(record, 'pageTitle'),
    ownValue(record, 'officialUrl'),
    ownValue(record, 'checkedAt'),
    ownValue(record, 'lastModified'),
    ownValue(record, 'revisionSignal'),
    ownValue(record, 'digestScope'),
    evidence,
    ownValue(record, 'sourceContentDigestScope'),
    ownValue(record, 'sourceContentUrl'),
    ownValue(record, 'sourceContentSha256'),
  ]);
}

export function fingerprintBinanceSourceEvidence(source: BinanceOfficialSourceRecord): string {
  return sha256(canonicalizeBinanceSourceEvidence(source));
}

export function fingerprintBinanceContractMatrix(matrix: BinanceContractMatrix): string {
  let closed = true;
  inspectClosedJson(matrix, () => { closed = false; });
  if (!closed) throw new TypeError('matrix must be closed plain data');
  const record = matrix as unknown as UnknownRecord;
  return sha256(canonicalJson({
    schema: ownValue(record, 'schema'),
    revision: ownValue(record, 'revision'),
    checkedAt: ownValue(record, 'checkedAt'),
    documentaryAuthority: ownValue(record, 'documentaryAuthority'),
    externalActionAuthorization: ownValue(record, 'externalActionAuthorization'),
    selectedPrivateContractIds: ownValue(record, 'selectedPrivateContractIds'),
    selectedSpotUserDataEncoding: ownValue(record, 'selectedSpotUserDataEncoding'),
    selectedSpotSignatureKeyType: ownValue(record, 'selectedSpotSignatureKeyType'),
    spotUserDataLifecycle: ownValue(record, 'spotUserDataLifecycle'),
    rateHeaderTemplates: ownValue(record, 'rateHeaderTemplates'),
    protectedLocators: ownValue(record, 'protectedLocators'),
    marginAccountModeFacts: ownValue(record, 'marginAccountModeFacts'),
    apiKeyProfilePolicy: ownValue(record, 'apiKeyProfilePolicy'),
    apiKeyPermissionFields: ownValue(record, 'apiKeyPermissionFields'),
    unsupportedAccountModes: ownValue(record, 'unsupportedAccountModes'),
    sources: ownValue(record, 'sources'),
    contracts: ownValue(record, 'contracts'),
    approvedProductBases: ownValue(record, 'approvedProductBases'),
    obsoleteRouteFacts: ownValue(record, 'obsoleteRouteFacts'),
  }));
}

function validOfficialSourceUrl(value: string, productScopes: readonly string[]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== ''
      || url.search !== '' || url.hash !== '') return false;
    if (url.hostname === 'developers.binance.com') {
      if (!url.pathname.startsWith('/en/docs/') || /%|\.\./i.test(url.pathname)) return false;
      if (url.pathname.includes('/core-trading-wallet/')) return productScopes.length > 0;
      return productScopes.every((product) => {
        if (product === 'SPOT') return url.pathname.includes('/spot/')
          || url.pathname.includes('spot-api')
          || url.pathname.includes('core-trading-spot-trading');
        if (product === 'USD_M_PERPETUAL') return url.pathname.includes('usds-futures') || url.pathname.includes('usd-s-m-futures');
        if (product === 'MARGIN') return url.pathname.includes('margin');
        return false;
      });
    }
    if (url.hostname === 'github.com' && productScopes.includes('SPOT')) {
      const pinnedSpot = /^\/binance\/binance-spot-api-docs\/blob\/[0-9a-f]{40}\/[A-Za-z0-9_./-]+$/.test(url.pathname);
      const scoped = productScopes.every((product) => product === 'SPOT')
        || (productScopes.length === 2
          && productScopes.includes('MARGIN')
          && url.pathname.endsWith('/testnet/general-info.md'));
      return pinnedSpot && scoped;
    }
    return false;
  } catch {
    return false;
  }
}

function validSourceContentUrl(officialUrl: string, contentUrl: string, scope: string): boolean {
  try {
    const parsed = new URL(contentUrl);
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== ''
      || parsed.port !== '' || parsed.search !== '' || parsed.hash !== '') return false;
    if (scope === 'RAW_OFFICIAL_MARKDOWN') return contentUrl === `${officialUrl}.md`;
    if (scope === 'PINNED_GIT_FILE') {
      const official = new URL(officialUrl);
      const commit = official.pathname.match(/^\/binance\/binance-spot-api-docs\/blob\/([0-9a-f]{40})\/(.+)$/);
      if (commit === null || parsed.hostname !== 'raw.githubusercontent.com') return false;
      return parsed.pathname === `/binance/binance-spot-api-docs/${commit[1]}/${commit[2]}`;
    }
    return false;
  } catch {
    return false;
  }
}

function matchesProtectedLocator(
  product: string | null,
  environment: string | null,
  transport: string | null,
  baseUrl: string | null,
  operation: UnknownRecord | null,
  locatorName: keyof typeof BINANCE_CONTRACT_MATRIX.protectedLocators,
  allowAnyHttpMethod = false,
): boolean {
  const locator = BINANCE_CONTRACT_MATRIX.protectedLocators[locatorName];
  return product === locator.product
    && environment === locator.environment
    && transport === locator.transport
    && baseUrl === locator.baseUrl
    && operation !== null
    && ownValue(operation, 'kind') === locator.operation.kind
    && (allowAnyHttpMethod || ownValue(operation, 'httpMethod') === locator.operation.httpMethod)
    && ownValue(operation, 'value') === locator.operation.value
    && ownValue(operation, 'queryTemplate') === locator.operation.queryTemplate;
}

const SHARED_WALLET_LOCATOR_NAMES = [
  'sharedWalletPermission',
  'sharedAccountApiTradingStatus',
  'sharedAccountStatus',
] as const;

function matchesSharedWalletLocator(
  product: string | null,
  environment: string | null,
  transport: string | null,
  baseUrl: string | null,
  operation: UnknownRecord | null,
): boolean {
  return SHARED_WALLET_LOCATOR_NAMES.some((locatorName) => matchesProtectedLocator(
    product,
    environment,
    transport,
    baseUrl,
    operation,
    locatorName,
  ));
}

function validContractBase(
  product: string,
  environment: string,
  transport: string,
  baseUrl: string,
  operation: UnknownRecord | null,
): boolean {
  const allowed = BINANCE_CONTRACT_MATRIX.approvedProductBases;
  if (allowed[`${product}|${environment}|${transport}`]?.includes(baseUrl) ?? false) return true;
  return matchesSharedWalletLocator(product, environment, transport, baseUrl, operation);
}

function validateStringArray(
  values: readonly unknown[] | null,
  path: string,
  addIssue: AddIssue,
  allowed: readonly string[] | null = null,
): readonly string[] {
  if (values === null) return [];
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'string' || value.length === 0 || (allowed !== null && !allowed.includes(value))) {
      addIssue(`${path}[${index}]`, 'STRING_ARRAY_VALUE_INVALID', 'Expected a registered non-empty string');
      continue;
    }
    if (seen.has(value)) {
      addIssue(`${path}[${index}]`, 'DUPLICATE_ARRAY_VALUE', 'Array values must be unique');
      continue;
    }
    seen.add(value);
    accepted.push(value);
  }
  return accepted;
}

function nullablePositiveInteger(record: UnknownRecord, key: string, path: string, addIssue: AddIssue): number | null {
  const value = ownValue(record, key);
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    addIssue(appendPath(path, key), 'POSITIVE_INTEGER_OR_NULL_REQUIRED', 'Expected a positive safe integer or null');
    return null;
  }
  return value as number;
}

function validateOperation(operation: UnknownRecord, path: string, transport: string | null, addIssue: AddIssue): void {
  exactKeys(operation, OPERATION_KEYS, path, addIssue);
  const kind = requireEnum(operation, 'kind', BINANCE_OPERATION_KINDS, path, addIssue);
  const method = ownValue(operation, 'httpMethod');
  const value = requireString(operation, 'value', path, addIssue);
  const queryTemplate = ownValue(operation, 'queryTemplate');
  if (queryTemplate !== null && (typeof queryTemplate !== 'string'
    || !/^[A-Za-z0-9_.!<>@/-]+=[A-Za-z0-9_.!<>@/-]+(?:&[A-Za-z0-9_.!<>@/-]+=[A-Za-z0-9_.!<>@/-]+)*$/.test(queryTemplate))) {
    addIssue(`${path}.queryTemplate`, 'QUERY_TEMPLATE_INVALID', 'Query templates must be exact bounded key/value placeholders');
  }
  if (kind === 'REST_PATH') {
    if (!isEnumValue(method, BINANCE_HTTP_METHODS)) addIssue(`${path}.httpMethod`, 'HTTP_METHOD_REQUIRED', 'REST paths require a registered HTTP method');
    if (value !== null && !/^\/[A-Za-z0-9._~<>/-]*$/.test(value)) {
      addIssue(`${path}.value`, 'REST_PATH_INVALID', 'REST paths must be exact unencoded path templates');
    }
    if (queryTemplate !== null) addIssue(`${path}.queryTemplate`, 'QUERY_TEMPLATE_FORBIDDEN', 'REST parameters belong in requiredParameters');
    if (transport !== null && transport !== 'REST') addIssue(path, 'OPERATION_TRANSPORT_MISMATCH', 'REST path requires REST transport');
  } else {
    if (method !== null) addIssue(`${path}.httpMethod`, 'HTTP_METHOD_FORBIDDEN', 'Non-REST operations require null httpMethod');
    if (kind === 'BASE' && value !== '/') addIssue(`${path}.value`, 'BASE_OPERATION_INVALID', 'Base operation value must be /');
    if (kind === 'WS_METHOD' && value !== null && !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(value)) {
      addIssue(`${path}.value`, 'WS_METHOD_INVALID', 'WebSocket methods must be exact dotted identifiers');
    }
    if (kind === 'WS_PATH' && value !== null && !/^\/[A-Za-z0-9._~<>@!/-]*$/.test(value)) {
      addIssue(`${path}.value`, 'WS_PATH_INVALID', 'WebSocket paths must be exact unencoded templates');
    }
    if (kind !== 'WS_PATH' && queryTemplate !== null) {
      addIssue(`${path}.queryTemplate`, 'QUERY_TEMPLATE_FORBIDDEN', 'Only WebSocket stream paths may carry a query template');
    }
    if (kind === 'WS_METHOD' && transport !== null && transport !== 'WEBSOCKET_API') {
      addIssue(path, 'OPERATION_TRANSPORT_MISMATCH', 'WebSocket methods require WEBSOCKET_API');
    }
    if (kind === 'WS_PATH' && transport !== null && transport !== 'WEBSOCKET_STREAM') {
      addIssue(path, 'OPERATION_TRANSPORT_MISMATCH', 'WebSocket paths require WEBSOCKET_STREAM');
    }
  }
}

function validateAuthentication(authentication: UnknownRecord, path: string, addIssue: AddIssue): void {
  exactKeys(authentication, AUTHENTICATION_KEYS, path, addIssue);
  requireEnum(authentication, 'securityType', BINANCE_SECURITY_TYPES, path, addIssue);
  validateStringArray(arrayValue(authentication, 'permittedKeyTypes', path, addIssue), `${path}.permittedKeyTypes`, addIssue, BINANCE_KEY_TYPES);
  requireEnum(authentication, 'signingAlgorithm', BINANCE_SIGNING_ALGORITHMS, path, addIssue);
  requireEnum(authentication, 'canonicalEncoding', BINANCE_ENCODINGS, path, addIssue);
  requireEnum(authentication, 'timestampUnit', BINANCE_TIMESTAMP_UNITS, path, addIssue);
  const defaultMs = nullablePositiveInteger(authentication, 'recvWindowDefaultMs', path, addIssue);
  const maximumMs = nullablePositiveInteger(authentication, 'recvWindowMaxMs', path, addIssue);
  if (defaultMs !== null && maximumMs !== null && defaultMs > maximumMs) {
    addIssue(`${path}.recvWindowDefaultMs`, 'RECV_WINDOW_BOUNDS_REVERSED', 'recvWindow default cannot exceed maximum');
  }
  validateStringArray(arrayValue(authentication, 'requiredParameters', path, addIssue), `${path}.requiredParameters`, addIssue);
}

function validateAuthenticationConsistency(
  authentication: UnknownRecord,
  path: string,
  product: string | null,
  realm: string | null,
  transport: string | null,
  operationKind: unknown,
  operationValue: string | null,
  addIssue: AddIssue,
): void {
  const security = ownValue(authentication, 'securityType');
  const keyTypes = ownValue(authentication, 'permittedKeyTypes');
  const signing = ownValue(authentication, 'signingAlgorithm');
  const encoding = ownValue(authentication, 'canonicalEncoding');
  const timestamp = ownValue(authentication, 'timestampUnit');
  const defaultWindow = ownValue(authentication, 'recvWindowDefaultMs');
  const maximumWindow = ownValue(authentication, 'recvWindowMaxMs');
  const noSigningFields = signing === 'NONE'
    && encoding === 'NOT_APPLICABLE'
    && timestamp === 'NOT_APPLICABLE'
    && defaultWindow === null
    && maximumWindow === null;

  if (security === 'NONE' && (!Array.isArray(keyTypes) || keyTypes.length !== 0 || !noSigningFields)) {
    addIssue(path, 'NONE_SECURITY_INCONSISTENT', 'NONE security cannot carry key, signing, timestamp, or recvWindow claims');
  }
  if (signing === 'NONE' && !noSigningFields) {
    addIssue(path, 'NO_SIGNING_FIELDS_INCONSISTENT', 'A non-signing operation must use NOT_APPLICABLE and null signing fields');
  }
  if (signing === 'UNKNOWN' && Array.isArray(keyTypes) && keyTypes.length !== 0) {
    addIssue(`${path}.permittedKeyTypes`, 'UNKNOWN_SIGNING_HAS_KEY_TYPES', 'Unknown signing algorithm cannot imply key-type support');
  }
  if (security === 'API_KEY_SIGNATURE'
    && (!Array.isArray(keyTypes) || keyTypes.length === 0 || signing === 'NONE' || signing === 'UNKNOWN'
      || timestamp === 'NOT_APPLICABLE' || encoding !== 'WS_SORTED_PARAMS')) {
    addIssue(path, 'SIGNATURE_SECURITY_INCONSISTENT', 'API-key signature security requires known key, signing, and timing facts');
  }
  if (security === 'SESSION_AUTHENTICATED'
    && (!Array.isArray(keyTypes) || keyTypes.length !== 1 || keyTypes[0] !== 'ED25519' || !noSigningFields)) {
    addIssue(path, 'SESSION_SECURITY_INCONSISTENT', 'Spot session subscription is an unsigned operation on an Ed25519-authenticated session');
  }
  if (security === 'USER_STREAM' && !noSigningFields) {
    addIssue(path, 'USER_STREAM_SECURITY_INCONSISTENT', 'USER_STREAM lifecycle endpoints are API-key-only, not signed');
  }
  if ((security === 'USER_DATA' || security === 'TRADE') && signing === 'NONE') {
    addIssue(path, 'SIGNED_SECURITY_INCONSISTENT', 'USER_DATA and TRADE contracts cannot use a non-signing policy');
  }
  if (security === 'MARKET_DATA' && (!noSigningFields || !Array.isArray(keyTypes) || keyTypes.length === 0)) {
    addIssue(path, 'MARKET_DATA_SECURITY_INCONSISTENT', 'MARKET_DATA security requires an API key but no signature');
  }
  if (security === 'LISTEN_KEY' && !noSigningFields) {
    addIssue(path, 'LISTEN_KEY_SECURITY_INCONSISTENT', 'A listen-key stream route does not sign the WebSocket path');
  }
  if (realm !== null && realm.startsWith('PRIVATE_')
    && (security === 'NONE' || security === 'MIXED_BY_ENDPOINT')
    && !(product === 'SPOT' && transport === 'WEBSOCKET_API'
      && operationValue === 'userDataStream.unsubscribe')) {
    addIssue(`${path}.securityType`, 'PRIVATE_SECURITY_INCONSISTENT', 'Private contracts cannot use public or mixed security');
  }
  if (realm === 'PUBLIC_MARKET' && security !== 'NONE' && security !== 'MARKET_DATA') {
    addIssue(`${path}.securityType`, 'PUBLIC_MARKET_SECURITY_INCONSISTENT', 'Public market streams require NONE or documented MARKET_DATA security');
  }
  if (realm === 'PUBLIC_REST' && operationKind !== 'BASE' && security !== 'NONE') {
    addIssue(`${path}.securityType`, 'PUBLIC_REST_SECURITY_INCONSISTENT', 'Public REST endpoint contracts require NONE security');
  }
  if (realm === 'PRIVATE_TRADE' && security !== 'TRADE') {
    addIssue(`${path}.securityType`, 'PRIVATE_TRADE_SECURITY_INCONSISTENT', 'Private trade contracts require TRADE security');
  }
  if ((realm === 'PRIVATE_ACCOUNT' || realm === 'PRIVATE_MARGIN_ACCOUNT') && security !== 'USER_DATA') {
    addIssue(`${path}.securityType`, 'PRIVATE_ACCOUNT_SECURITY_INCONSISTENT', 'Private account contracts require USER_DATA security');
  }
  if (realm === 'PRIVATE_RISK_DATA' && security !== 'USER_STREAM' && security !== 'LISTEN_KEY') {
    addIssue(`${path}.securityType`, 'PRIVATE_RISK_SECURITY_INCONSISTENT', 'Risk-stream lifecycle requires USER_STREAM or LISTEN_KEY security');
  }
  const requiredParameters = ownValue(authentication, 'requiredParameters');
  const hasParameters = (names: readonly string[]): boolean => Array.isArray(requiredParameters)
    && names.every((name) => requiredParameters.includes(name));
  if (realm !== null && security === 'API_KEY_SIGNATURE' && !hasParameters(['apiKey', 'timestamp', 'signature'])) {
    addIssue(`${path}.requiredParameters`, 'SIGNATURE_PARAMETERS_REQUIRED', 'Signature subscription requires API key, timestamp, and signature parameters');
  }
  if (realm !== null && security === 'SESSION_AUTHENTICATED' && (!Array.isArray(requiredParameters) || requiredParameters.length !== 0)) {
    addIssue(`${path}.requiredParameters`, 'SESSION_PARAMETERS_FORBIDDEN', 'Authenticated-session subscription takes no request parameters');
  }
  if (realm !== null && security === 'USER_STREAM' && !hasParameters(['apiKeyHeader'])) {
    addIssue(`${path}.requiredParameters`, 'USER_STREAM_API_KEY_REQUIRED', 'Current user-stream lifecycle requires the API-key header');
  }
  if (realm !== null && security === 'LISTEN_KEY' && !hasParameters(['listenKey'])) {
    addIssue(`${path}.requiredParameters`, 'LISTEN_KEY_PARAMETER_REQUIRED', 'Listen-key stream routes require the listenKey parameter');
  }
  if (realm !== null && security === 'MARKET_DATA' && !hasParameters(['apiKeyHeader'])) {
    addIssue(`${path}.requiredParameters`, 'MARKET_DATA_API_KEY_REQUIRED', 'Market-data key security requires the API-key header');
  }
  if (transport === 'REST' && (security === 'USER_DATA' || security === 'TRADE')
    && operationKind !== 'BASE'
    && (!Array.isArray(requiredParameters) || !requiredParameters.includes('timestamp'))) {
    addIssue(`${path}.requiredParameters`, 'SIGNED_TIMESTAMP_REQUIRED', 'Signed REST contracts require an explicit timestamp parameter');
  }
}

function validateRateLimit(
  rateLimit: UnknownRecord,
  path: string,
  allSourceIds: ReadonlySet<string>,
  contractSourceIds: ReadonlySet<string>,
  addIssue: AddIssue,
): void {
  exactKeys(rateLimit, RATE_LIMIT_KEYS, path, addIssue);
  const state = requireEnum(rateLimit, 'state', BINANCE_RATE_STATES, path, addIssue);
  const claims = arrayValue(rateLimit, 'claims', path, addIssue) ?? [];
  const semanticClaims = new Set<string>();
  const claimSources = new Set<string>();
  for (let index = 0; index < claims.length; index += 1) {
    const claimPath = `${path}.claims[${index}]`;
    const claim = claims[index];
    if (!isRecord(claim)) {
      addIssue(claimPath, 'OBJECT_REQUIRED', 'Rate claim must be an object');
      continue;
    }
    exactKeys(claim, RATE_CLAIM_KEYS, claimPath, addIssue);
    const sourceId = requireString(claim, 'sourceId', claimPath, addIssue);
    const kind = requireEnum(claim, 'kind', BINANCE_RATE_KINDS, claimPath, addIssue);
    const scope = requireEnum(claim, 'scope', BINANCE_RATE_SCOPES, claimPath, addIssue);
    const interval = requireEnum(claim, 'interval', BINANCE_RATE_INTERVALS, claimPath, addIssue);
    const header = ownValue(claim, 'header');
    const condition = ownValue(claim, 'condition');
    if (header !== null && !isEnumValue(header, BINANCE_CONTRACT_MATRIX.rateHeaderTemplates)) {
      addIssue(`${claimPath}.header`, 'RATE_HEADER_INVALID', 'Rate header must be an exact registered exchange-header template or null');
    }
    if (!isEnumValue(condition, BINANCE_RATE_CONDITIONS)) {
      addIssue(`${claimPath}.condition`, 'RATE_CONDITION_INVALID', 'Rate conditions must use the closed upper-case grammar');
    }
    const value = ownValue(claim, 'value');
    if (!Number.isSafeInteger(value) || (value as number) < 0
      || ((value as number) === 0 && kind !== 'REQUEST_WEIGHT')) {
      addIssue(`${claimPath}.value`, 'RATE_VALUE_INVALID', 'Rate values must be non-negative safe integers; only request weight may be zero');
    }
    if (kind === 'REQUEST_WEIGHT' && ((scope !== 'IP' && scope !== 'UID') || interval !== 'REQUEST')) {
      addIssue(claimPath, 'REQUEST_WEIGHT_DIMENSION_INVALID', 'Request weight requires IP or UID scope and REQUEST interval');
    }
    if (kind === 'ORDER_COUNT' && (scope !== 'ACCOUNT'
      || (interval !== 'REQUEST' && interval !== 'TEN_SECONDS' && interval !== 'MINUTE'))) {
      addIssue(claimPath, 'ORDER_COUNT_DIMENSION_INVALID', 'Order count requires ACCOUNT scope and a documented request or time window');
    }
    if (kind === 'CONNECTION_ATTEMPT' && (scope !== 'IP' || interval !== 'FIVE_MINUTES')) {
      addIssue(claimPath, 'CONNECTION_ATTEMPT_DIMENSION_INVALID', 'Connection attempts require IP scope and five-minute interval');
    }
    if (kind === 'MESSAGE_LIMIT' && (scope !== 'CONNECTION' || interval !== 'SECOND')) {
      addIssue(claimPath, 'MESSAGE_LIMIT_DIMENSION_INVALID', 'Message limits require CONNECTION scope and SECOND interval');
    }
    if (kind === 'SUBSCRIPTION_LIMIT' && (scope !== 'CONNECTION' || interval !== 'CONNECTION_LIFETIME')) {
      addIssue(claimPath, 'SUBSCRIPTION_LIMIT_DIMENSION_INVALID', 'Subscription limits require CONNECTION scope and connection-lifetime dimension');
    }
    if (sourceId !== null) {
      if (!allSourceIds.has(sourceId)) addIssue(`${claimPath}.sourceId`, 'SOURCE_REFERENCE_MISSING', 'Rate claim source must resolve');
      else if (!contractSourceIds.has(sourceId)) addIssue(`${claimPath}.sourceId`, 'RATE_SOURCE_NOT_CONTRACT_SOURCE', 'Rate claims must cite one of the contract sources');
      claimSources.add(sourceId);
    }
    if (sourceId !== null && kind !== null && scope !== null && interval !== null
      && Number.isSafeInteger(value) && (header === null || typeof header === 'string')
      && typeof condition === 'string') {
      const semantic = `${sourceId}|${kind}|${scope}|${value as number}|${interval}|${header ?? 'NULL'}|${condition}`;
      if (semanticClaims.has(semantic)) addIssue(claimPath, 'DUPLICATE_RATE_CLAIM', 'Rate claims must be semantically unique');
      semanticClaims.add(semantic);
    }
  }
  if (state === 'UNKNOWN' && claims.length !== 0) addIssue(`${path}.claims`, 'UNKNOWN_RATE_HAS_CLAIMS', 'UNKNOWN rate state cannot contain claims');
  if (state === 'VERIFIED' && claims.length < 1) addIssue(`${path}.claims`, 'VERIFIED_RATE_MISSING_CLAIM', 'VERIFIED rate state requires a claim');
  if (state === 'OFFICIAL_DOC_CONFLICT' && (claims.length < 2 || semanticClaims.size < 2)) {
    addIssue(`${path}.claims`, 'CONFLICT_RATE_EVIDENCE_INSUFFICIENT', 'Official conflicts require at least two distinct semantic claims');
  }
}

function validateConnection(connection: UnknownRecord, path: string, addIssue: AddIssue): void {
  exactKeys(connection, CONNECTION_KEYS, path, addIssue);
  for (const key of [
    'connectionLifetimeMinutes', 'tokenLifetimeMinutes', 'pingIntervalSeconds', 'pongTimeoutSeconds',
    'incomingMessagesPerSecond', 'maximumStreams',
  ]) nullablePositiveInteger(connection, key, path, addIssue);
  requireString(connection, 'renewalRule', path, addIssue);
  requireString(connection, 'orderingRule', path, addIssue);
}

function validateResponseSchema(response: UnknownRecord, path: string, addIssue: AddIssue): void {
  exactKeys(response, RESPONSE_SCHEMA_KEYS, path, addIssue);
  const state = requireEnum(response, 'state', BINANCE_RESPONSE_SCHEMA_STATES, path, addIssue);
  const revision = ownValue(response, 'revision');
  const digest = ownValue(response, 'sha256');
  if (state === 'UNKNOWN' && (revision !== null || digest !== null)) {
    addIssue(path, 'UNKNOWN_SCHEMA_HAS_VALUE', 'UNKNOWN response schema must retain null revision and hash');
  }
  if (state === 'PINNED' && (typeof revision !== 'string' || revision.length === 0 || typeof digest !== 'string'
    || !SHA256_PATTERN.test(digest) || digest === '0'.repeat(64))) {
    addIssue(path, 'PINNED_SCHEMA_INVALID', 'PINNED response schema requires revision and SHA-256');
  }
}

function exactRateClaim(
  claim: unknown,
  sourceId: string,
  scope: string,
  value: number,
  condition: string,
): boolean {
  return isRecord(claim)
    && ownValue(claim, 'sourceId') === sourceId
    && ownValue(claim, 'kind') === 'REQUEST_WEIGHT'
    && ownValue(claim, 'scope') === scope
    && ownValue(claim, 'value') === value
    && ownValue(claim, 'interval') === 'REQUEST'
    && ownValue(claim, 'header') === null
    && ownValue(claim, 'condition') === condition;
}

function validateSource(
  source: UnknownRecord,
  index: number,
  sourceIds: Set<string>,
  sourceUrls: Set<string>,
  addIssue: AddIssue,
): void {
  const path = `$.sources[${index}]`;
  exactKeys(source, SOURCE_KEYS, path, addIssue);
  const id = requireString(source, 'id', path, addIssue);
  const productScopes = validateStringArray(
    arrayValue(source, 'productScopes', path, addIssue),
    `${path}.productScopes`,
    addIssue,
    BINANCE_PRODUCTS,
  );
  requireString(source, 'pageTitle', path, addIssue);
  const officialUrl = requireString(source, 'officialUrl', path, addIssue);
  const checkedAt = requireString(source, 'checkedAt', path, addIssue);
  const lastModified = ownValue(source, 'lastModified');
  const revisionSignal = requireString(source, 'revisionSignal', path, addIssue);
  requireEnum(source, 'digestScope', BINANCE_DIGEST_SCOPES, path, addIssue);
  const evidence = validateStringArray(arrayValue(source, 'evidence', path, addIssue), `${path}.evidence`, addIssue);
  const evidenceSha256 = requireString(source, 'evidenceSha256', path, addIssue);
  const contentScope = requireEnum(source, 'sourceContentDigestScope', BINANCE_SOURCE_CONTENT_DIGEST_SCOPES, path, addIssue);
  const contentUrl = ownValue(source, 'sourceContentUrl');
  const contentSha = ownValue(source, 'sourceContentSha256');

  if (id !== null) {
    if (!IDENTIFIER_PATTERN.test(id)) addIssue(`${path}.id`, 'SOURCE_ID_INVALID', 'Source ID must use the closed identifier grammar');
    if (sourceIds.has(id)) addIssue(`${path}.id`, 'DUPLICATE_SOURCE_ID', 'Source IDs must be unique');
    sourceIds.add(id);
  }
  if (officialUrl !== null) {
    if (productScopes.length === 0 || !validOfficialSourceUrl(officialUrl, productScopes)) addIssue(`${path}.officialUrl`, 'OFFICIAL_URL_INVALID', 'Source URL must be an exact approved official product page');
    if (sourceUrls.has(officialUrl)) addIssue(`${path}.officialUrl`, 'DUPLICATE_SOURCE_URL', 'Source URLs must be unique');
    sourceUrls.add(officialUrl);
  }
  if (checkedAt !== BINANCE_CONTRACT_MATRIX_CHECKED_AT || !UTC_PATTERN.test(checkedAt ?? '')) {
    addIssue(`${path}.checkedAt`, 'SOURCE_CHECK_TIME_INVALID', 'Source check time must equal the matrix UTC check time');
  }
  if (lastModified !== null && (typeof lastModified !== 'string' || !validCalendarDate(lastModified)
    || lastModified > BINANCE_CONTRACT_MATRIX_CHECKED_AT.slice(0, 10))) {
    addIssue(`${path}.lastModified`, 'LAST_MODIFIED_INVALID', 'lastModified must be YYYY-MM-DD or null');
  }
  if (revisionSignal !== null) {
    const dated = revisionSignal.match(/^(?:LAST_MODIFIED|LATEST_ENTRY)_(\d{4}-\d{2}-\d{2})$/);
    const catalog = revisionSignal.match(/^CATALOG_CHECKED_(\d{4}-\d{2}-\d{2})$/);
    const commit = revisionSignal.match(/(?:^|_)GIT_COMMIT_([0-9a-f]{40})$/);
    if (dated !== null && lastModified !== dated[1]) {
      addIssue(`${path}.revisionSignal`, 'REVISION_DATE_MISMATCH', 'Dated revision signal must equal lastModified');
    } else if (catalog !== null && checkedAt?.slice(0, 10) !== catalog[1]) {
      addIssue(`${path}.revisionSignal`, 'REVISION_CHECK_DATE_MISMATCH', 'Catalog revision signal must equal checkedAt date');
    } else if (commit !== null && (officialUrl === null || !officialUrl.includes(commit[1])
      || typeof contentUrl !== 'string' || !contentUrl.includes(commit[1]))) {
      addIssue(`${path}.revisionSignal`, 'REVISION_COMMIT_MISMATCH', 'Pinned revision signal must match official and content URLs');
    } else if (dated === null && catalog === null && commit === null) {
      addIssue(`${path}.revisionSignal`, 'REVISION_SIGNAL_INVALID', 'Revision signal must use a reviewed dated or pinned-commit form');
    }
  }
  if (evidence.length === 0) addIssue(`${path}.evidence`, 'SOURCE_EVIDENCE_EMPTY', 'At least one extracted official fact is required');
  if (evidenceSha256 === null || !SHA256_PATTERN.test(evidenceSha256)) {
    addIssue(`${path}.evidenceSha256`, 'EVIDENCE_SHA256_INVALID', 'Evidence SHA-256 must be lower-case hex');
  } else {
    try {
      const actual = fingerprintBinanceSourceEvidence(source as unknown as BinanceOfficialSourceRecord);
      if (actual !== evidenceSha256) addIssue(`${path}.evidenceSha256`, 'EVIDENCE_SHA256_MISMATCH', 'Evidence SHA-256 does not match the canonical evidence set');
    } catch {
      addIssue(`${path}.evidenceSha256`, 'EVIDENCE_CANONICALIZATION_FAILED', 'Evidence could not be canonicalized');
    }
  }
  if ((contentScope === 'PINNED_GIT_FILE' || contentScope === 'RAW_OFFICIAL_MARKDOWN')
    && (typeof contentSha !== 'string' || !SHA256_PATTERN.test(contentSha)
      || contentSha === '0'.repeat(64)
      || typeof contentUrl !== 'string' || officialUrl === null
      || !validSourceContentUrl(officialUrl, contentUrl, contentScope))) {
    addIssue(`${path}.sourceContentSha256`, 'SOURCE_CONTENT_PROOF_REQUIRED', 'Captured source content requires an exact approved URL and SHA-256');
  }
  if (contentScope === 'NOT_CAPTURED' && (contentSha !== null || contentUrl !== null)) {
    addIssue(`${path}.sourceContentSha256`, 'SOURCE_CONTENT_PROOF_FORBIDDEN', 'Uncaptured source content must retain null URL and hash');
  }
}

function validateContract(
  contract: UnknownRecord,
  index: number,
  sourcesById: ReadonlyMap<string, readonly string[]>,
  sourceContentById: ReadonlyMap<string, string | null>,
  contractIds: Set<string>,
  semanticContracts: Set<string>,
  addIssue: AddIssue,
): void {
  const path = `$.contracts[${index}]`;
  exactKeys(contract, CONTRACT_KEYS, path, addIssue);
  const id = requireString(contract, 'id', path, addIssue);
  const product = requireEnum(contract, 'product', BINANCE_PRODUCTS, path, addIssue);
  const environment = requireEnum(contract, 'environment', BINANCE_ENVIRONMENTS, path, addIssue);
  const realm = requireEnum(contract, 'realm', BINANCE_REALMS, path, addIssue);
  const transport = requireEnum(contract, 'transport', BINANCE_TRANSPORTS, path, addIssue);
  const lifecycle = requireEnum(contract, 'lifecycle', BINANCE_LIFECYCLES, path, addIssue);
  const baseValue = ownValue(contract, 'baseUrl');
  const baseUrl = typeof baseValue === 'string' && baseValue.length > 0 ? baseValue : null;
  if (baseUrl === null && !(baseValue === null
    && ['OFFICIAL_DOC_CONFLICT', 'NOT_APPLICABLE', 'UNKNOWN'].includes(String(lifecycle)))) {
    addIssue(`${path}.baseUrl`, 'BASE_URL_REQUIRED', 'Only an explicit conflict, non-applicable capability, or unknown gap may retain a null base URL');
  }
  const operationValue = ownValue(contract, 'operation');
  const operation = isRecord(operationValue) ? operationValue : null;
  if (operation === null && !(operationValue === null
    && ['NOT_APPLICABLE', 'UNKNOWN'].includes(String(lifecycle)))) {
    addIssue(`${path}.operation`, 'OPERATION_REQUIRED', 'Only a non-applicable capability or UNKNOWN documentary gap may retain null operation');
  }
  const authentication = recordValue(contract, 'authentication', path, addIssue);
  const rateLimit = recordValue(contract, 'rateLimit', path, addIssue);
  const connection = recordValue(contract, 'connection', path, addIssue);
  requireEnum(contract, 'dataSource', BINANCE_DATA_SOURCES, path, addIssue);
  const mutationClass = requireEnum(contract, 'mutationClass', BINANCE_MUTATION_CLASSES, path, addIssue);
  const ambiguity = requireEnum(contract, 'ambiguityClass', BINANCE_AMBIGUITY_CLASSES, path, addIssue);
  requireEnum(contract, 'safeRetryClass', BINANCE_SAFE_RETRY_CLASSES, path, addIssue);
  const responseSchema = recordValue(contract, 'responseSchema', path, addIssue);
  const sourceIds = validateStringArray(arrayValue(contract, 'sourceIds', path, addIssue), `${path}.sourceIds`, addIssue);
  requireEnum(contract, 'documentaryAuthority', BINANCE_DOCUMENTARY_AUTHORITIES, path, addIssue);
  requireEnum(contract, 'externalActionAuthorization', BINANCE_EXTERNAL_ACTION_AUTHORIZATIONS, path, addIssue);
  requireEnum(contract, 'actionAuthority', BINANCE_ACTION_AUTHORITIES, path, addIssue);
  requireString(contract, 'notes', path, addIssue);

  if (id !== null) {
    if (!IDENTIFIER_PATTERN.test(id)) addIssue(`${path}.id`, 'CONTRACT_ID_INVALID', 'Contract ID must use the closed identifier grammar');
    if (contractIds.has(id)) addIssue(`${path}.id`, 'DUPLICATE_CONTRACT_ID', 'Contract IDs must be unique');
    contractIds.add(id);
  }
  if (baseUrl !== null && (product === null || environment === null || transport === null
    || !validContractBase(product, environment, transport, baseUrl, operation))) {
    addIssue(`${path}.baseUrl`, 'CROSS_PRODUCT_BASE_URL', 'Base URL must match the exact product and transport');
  }
  if (operation !== null) validateOperation(operation, `${path}.operation`, transport, addIssue);
  const walletLocator = BINANCE_CONTRACT_MATRIX.protectedLocators.sharedWalletPermission;
  if (product === walletLocator.product && baseUrl === walletLocator.baseUrl
    && !matchesSharedWalletLocator(product, environment, transport, baseUrl, operation)) {
    addIssue(`${path}.baseUrl`, 'USDM_WALLET_BASE_SCOPE_VIOLATION', 'The shared wallet host is valid for USD-M only for reviewed wallet-truth routes');
  }
  if (authentication !== null) {
    validateAuthentication(authentication, `${path}.authentication`, addIssue);
    validateAuthenticationConsistency(
      authentication,
      `${path}.authentication`,
      product,
      lifecycle === 'UNKNOWN' || lifecycle === 'NOT_APPLICABLE' || lifecycle === 'REMOVED' ? null : realm,
      transport,
      operation === null ? null : ownValue(operation, 'kind'),
      operation === null ? null : (typeof ownValue(operation, 'value') === 'string' ? ownValue(operation, 'value') as string : null),
      addIssue,
    );
  }
  if (rateLimit !== null) validateRateLimit(
    rateLimit,
    `${path}.rateLimit`,
    new Set(sourcesById.keys()),
    new Set(sourceIds),
    addIssue,
  );
  if (connection !== null) validateConnection(connection, `${path}.connection`, addIssue);
  if (responseSchema !== null) validateResponseSchema(responseSchema, `${path}.responseSchema`, addIssue);

  if (sourceIds.length === 0) addIssue(`${path}.sourceIds`, 'SOURCE_REFERENCE_REQUIRED', 'Every contract requires official provenance');
  for (let sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex += 1) {
    const sourceId = sourceIds[sourceIndex];
    const sourceProducts = sourcesById.get(sourceId);
    if (sourceProducts === undefined) addIssue(`${path}.sourceIds[${sourceIndex}]`, 'SOURCE_REFERENCE_MISSING', 'Contract source must resolve');
    else if (product !== null && !sourceProducts.includes(product)) addIssue(`${path}.sourceIds[${sourceIndex}]`, 'SOURCE_PRODUCT_MISMATCH', 'Contract and source products cannot be cross-cast');
  }
  if (responseSchema !== null && ownValue(responseSchema, 'state') === 'PINNED') {
    const schemaDigest = ownValue(responseSchema, 'sha256');
    if (typeof schemaDigest !== 'string' || schemaDigest === '0'.repeat(64)
      || !sourceIds.some((sourceId) => sourceContentById.get(sourceId) === schemaDigest)) {
      addIssue(`${path}.responseSchema.sha256`, 'PINNED_SCHEMA_SOURCE_MISMATCH', 'Pinned response schema hash must equal one referenced captured official source');
    }
  }
  if (lifecycle === 'CURRENT' && authentication !== null && ownValue(authentication, 'securityType') === 'UNKNOWN') {
    addIssue(`${path}.authentication.securityType`, 'CURRENT_SECURITY_UNKNOWN', 'Current contracts require known security type');
  }
  if (lifecycle === 'CURRENT' && baseUrl === null) {
    addIssue(`${path}.baseUrl`, 'CURRENT_BASE_URL_UNKNOWN', 'Current contracts require an exact base URL');
  }
  if (lifecycle === 'CURRENT' && operation === null) {
    addIssue(`${path}.operation`, 'CURRENT_OPERATION_UNKNOWN', 'Current contracts require an exact operation');
  }
  if (lifecycle === 'OFFICIAL_DOC_CONFLICT') {
    if (ambiguity !== 'OFFICIAL_DOC_CONFLICT') addIssue(`${path}.ambiguityClass`, 'CONFLICT_AMBIGUITY_REQUIRED', 'Conflicted contracts must retain conflict ambiguity');
    if (sourceIds.length < 1) addIssue(`${path}.sourceIds`, 'CONFLICT_SOURCES_INSUFFICIENT', 'Conflicted contracts require official source evidence');
  }
  if (lifecycle === 'NOT_APPLICABLE') {
    const rateState = rateLimit === null ? null : ownValue(rateLimit, 'state');
    const rateClaims = rateLimit === null ? null : ownValue(rateLimit, 'claims');
    const schemaState = responseSchema === null ? null : ownValue(responseSchema, 'state');
    if (baseValue !== null || operationValue !== null
      || ownValue(contract, 'dataSource') !== 'NOT_APPLICABLE'
      || ambiguity !== 'NONE'
      || ownValue(contract, 'safeRetryClass') !== 'NOT_APPLICABLE'
      || authentication === null || ownValue(authentication, 'securityType') !== 'UNKNOWN'
      || rateState !== 'UNKNOWN' || !Array.isArray(rateClaims) || rateClaims.length !== 0
      || schemaState !== 'UNKNOWN') {
      addIssue(path, 'NOT_APPLICABLE_CONTRACT_INCONSISTENT', 'Non-applicable capabilities must remain locator-free, inert, unknown-schema documentary gaps');
    }
  }
  const maxBorrowLocator = matchesProtectedLocator(
    product, environment, transport, baseUrl, operation, 'marginMaxBorrowable',
  );
  if (maxBorrowLocator) {
    const rateState = rateLimit === null ? null : ownValue(rateLimit, 'state');
    const claims = rateLimit === null ? null : ownValue(rateLimit, 'claims');
    const exactClaimSet = Array.isArray(claims)
      && claims.length === 2
      && claims.some((claim) => exactRateClaim(claim, 'MARGIN_CHANGELOG_2026_07_10', 'UID', 750, 'ALWAYS'))
      && claims.some((claim) => exactRateClaim(claim, 'MARGIN_BORROW_REPAY_CATALOG_2026_07_12', 'IP', 50, 'ALWAYS'));
    if (lifecycle !== 'OFFICIAL_DOC_CONFLICT' || ambiguity !== 'OFFICIAL_DOC_CONFLICT'
      || rateState !== 'OFFICIAL_DOC_CONFLICT' || !exactClaimSet) {
      addIssue(path, 'MARGIN_MAX_BORROWABLE_CONFLICT_COLLAPSED', 'Both official 750 UID and 50 IP claims must remain unresolved');
    }
  }
  const marginOrderLocator = matchesProtectedLocator(
    product, environment, transport, baseUrl, operation, 'marginOrderPost',
  );
  if (marginOrderLocator) {
    const rateState = rateLimit === null ? null : ownValue(rateLimit, 'state');
    const claims = rateLimit === null ? null : ownValue(rateLimit, 'claims');
    const exactClaimSet = Array.isArray(claims) && claims.length === 4
      && exactRateClaim(claims[0], 'MARGIN_TRADE_CATALOG_2026_07_12', 'IP', 6, 'CATALOG_SCOPE_LABEL_DEFAULT')
      && exactRateClaim(claims[1], 'MARGIN_TRADE_CATALOG_2026_07_12', 'UID', 6, 'CATALOG_VALUE_UNIT_DEFAULT')
      && exactRateClaim(claims[2], 'MARGIN_TRADE_CATALOG_2026_07_12', 'IP', 1500, 'CATALOG_SCOPE_LABEL_BORROW_SIDE_EFFECT')
      && exactRateClaim(claims[3], 'MARGIN_TRADE_CATALOG_2026_07_12', 'UID', 1500, 'CATALOG_VALUE_UNIT_BORROW_SIDE_EFFECT');
    if (lifecycle !== 'OFFICIAL_DOC_CONFLICT' || ambiguity !== 'OFFICIAL_DOC_CONFLICT'
      || rateState !== 'OFFICIAL_DOC_CONFLICT' || !exactClaimSet) {
      addIssue(path, 'MARGIN_ORDER_WEIGHT_CONFLICT_COLLAPSED', 'Margin order IP-label and UID-value claims must remain unresolved');
    }
  }
  const marginListenTokenLocator = matchesProtectedLocator(
    product, environment, transport, baseUrl, operation, 'marginListenTokenPost',
  ) || matchesProtectedLocator(
    product, environment, transport, baseUrl, operation, 'marginListenTokenSubscribe',
  );
  if (marginListenTokenLocator
    && (lifecycle !== 'UNKNOWN' || ambiguity !== 'UNKNOWN')) {
    addIssue(path, 'MARGIN_LISTEN_TOKEN_UNKNOWN_COLLAPSED', 'Incomplete Margin trade/account listen-token details must remain UNKNOWN');
  }
  if (matchesProtectedLocator(
    product, environment, transport, baseUrl, operation, 'marginRiskListenKey', true,
  )
    && lifecycle === 'CURRENT' && realm !== 'PRIVATE_RISK_DATA') {
    addIssue(path, 'MARGIN_RISK_STREAM_REALM_MISMATCH', 'Margin risk listen-key lifecycle belongs only to PRIVATE_RISK_DATA');
  }
  if (mutationClass === 'MARGIN_MUTATION'
    && (ownValue(contract, 'externalActionAuthorization') !== 'NONE' || ownValue(contract, 'actionAuthority') !== 'NONE_RECORD_ONLY')) {
    addIssue(path, 'MUTATION_AUTHORITY_FORBIDDEN', 'Documented Margin mutation facts can never grant action authority');
  }
  if (operation !== null) {
    const operationValue = ownValue(operation, 'value');
    if (typeof operationValue === 'string' && /withdraw|transfer/i.test(operationValue)) {
      addIssue(`${path}.operation.value`, 'WITHDRAWAL_TRANSFER_CONTRACT_FORBIDDEN', 'Withdrawal and transfer contracts are outside L02');
    }
    if (product !== null && environment !== null && realm !== null && transport !== null && typeof operationValue === 'string') {
      const method = ownValue(operation, 'httpMethod');
      const kind = ownValue(operation, 'kind');
      const query = ownValue(operation, 'queryTemplate');
      if (typeof kind === 'string' && (method === null || typeof method === 'string')
        && (query === null || typeof query === 'string')) {
        const semantic = `${product}|${environment}|${transport}|${baseUrl ?? 'UNKNOWN'}|${kind}|${method ?? 'NULL'}|${operationValue}|${query ?? 'NULL'}`;
        if (semanticContracts.has(semantic)) addIssue(path, 'DUPLICATE_SEMANTIC_CONTRACT', 'Semantic contracts must have one documentary record');
        semanticContracts.add(semantic);
      }
    }
  }
}

function cloneAndFreeze<T>(value: T, seen = new Map<object, object>()): T {
  if (typeof value !== 'object' || value === null) return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior as T;
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('cannot clone sparse array');
      clone.push(cloneAndFreeze(descriptor.value, seen));
    }
    return Object.freeze(clone) as T;
  }
  const clone: UnknownRecord = {};
  seen.set(value, clone);
  for (const key of Object.keys(value as UnknownRecord)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('cannot clone accessor');
    clone[key] = cloneAndFreeze(descriptor.value, seen);
  }
  return Object.freeze(clone) as T;
}

function frozenIssue(path: string, code: string, message: string): Readonly<BinanceContractIssue> {
  return Object.freeze({ path, code, message });
}

export function validateBinanceContractMatrix(candidate: unknown): BinanceMatrixValidationResult {
  const issues: Array<Readonly<BinanceContractIssue>> = [];
  const addIssue: AddIssue = (path, code, message) => {
    if (issues.length < MAXIMUM_ISSUES) issues.push(frozenIssue(path, code, message));
  };

  const closed = inspectClosedJson(candidate, addIssue);
  if (!closed) {
    issues.sort((left, right) => codePointCompare(`${left.path}|${left.code}`, `${right.path}|${right.code}`));
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }
  if (!isRecord(candidate)) {
    addIssue('$', 'MATRIX_OBJECT_REQUIRED', 'Matrix must be a plain object');
    issues.sort((left, right) => codePointCompare(`${left.path}|${left.code}`, `${right.path}|${right.code}`));
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }

  exactKeys(candidate, MATRIX_KEYS, '$', addIssue);
  if (ownValue(candidate, 'schema') !== BINANCE_CONTRACT_MATRIX_SCHEMA) addIssue('$.schema', 'MATRIX_SCHEMA_INVALID', 'Unexpected matrix schema');
  if (ownValue(candidate, 'revision') !== BINANCE_CONTRACT_MATRIX_REVISION) addIssue('$.revision', 'MATRIX_REVISION_INVALID', 'Unexpected matrix revision');
  if (ownValue(candidate, 'checkedAt') !== BINANCE_CONTRACT_MATRIX_CHECKED_AT) addIssue('$.checkedAt', 'MATRIX_CHECK_TIME_INVALID', 'Unexpected matrix check time');
  if (ownValue(candidate, 'documentaryAuthority') !== 'DOCUMENTARY_EVIDENCE_ONLY') addIssue('$.documentaryAuthority', 'MATRIX_AUTHORITY_INVALID', 'Matrix authority must remain documentary only');
  if (ownValue(candidate, 'externalActionAuthorization') !== 'NONE') addIssue('$.externalActionAuthorization', 'EXTERNAL_ACTION_AUTHORITY_FORBIDDEN', 'Matrix cannot authorize external action');
  const selectedPrivate = recordValue(candidate, 'selectedPrivateContractIds', '$', addIssue);
  if (selectedPrivate !== null) {
    exactKeys(selectedPrivate, BINANCE_PRODUCTS, '$.selectedPrivateContractIds', addIssue);
    if (ownValue(selectedPrivate, 'SPOT') !== 'SPOT_WS_API_USER_DATA_SIGNATURE'
      || ownValue(selectedPrivate, 'USD_M_PERPETUAL') !== 'USDM_WS_PRIVATE_USER_DATA'
      || ownValue(selectedPrivate, 'MARGIN') !== null) {
      addIssue('$.selectedPrivateContractIds', 'PRIVATE_MECHANISM_SELECTION_INVALID', 'Private documentary selections must retain the reviewed Spot/USD-M choices and unresolved Margin posture');
    }
  }
  if (ownValue(candidate, 'selectedSpotUserDataEncoding') !== 'JSON_TEXT') {
    addIssue('$.selectedSpotUserDataEncoding', 'SPOT_ENCODING_SELECTION_INVALID', 'Spot user-data primary encoding must remain JSON text for this revision');
  }
  if (ownValue(candidate, 'selectedSpotSignatureKeyType') !== 'HMAC') {
    addIssue('$.selectedSpotSignatureKeyType', 'SPOT_SIGNATURE_KEY_SELECTION_INVALID', 'Selected Spot signature subscription must retain the reviewed HMAC key type');
  }
  try {
    if (canonicalJson(ownValue(candidate, 'spotUserDataLifecycle')) !== canonicalJson({
      oneActiveSubscriptionPerAccountPerConnection: 1,
      maximumSimultaneousSubscriptions: 1000,
      maximumLifetimeSubscriptions: 65535,
      connectionLifetimeMinutes: 1440,
      unsubscribeMethod: 'userDataStream.unsubscribe',
      omissionOfSubscriptionIdClosesAll: true,
      terminationEvent: 'eventStreamTerminated',
      abruptDisconnectTerminationEvent: 'UNKNOWN',
    })) {
      addIssue('$.spotUserDataLifecycle', 'SPOT_USER_DATA_LIFECYCLE_INVALID', 'Spot lifecycle limits and termination facts must equal the reviewed official revision');
    }
  } catch {
    addIssue('$.spotUserDataLifecycle', 'SPOT_USER_DATA_LIFECYCLE_INVALID', 'Spot lifecycle facts must be closed documentary data');
  }
  try {
    if (canonicalJson(ownValue(candidate, 'approvedProductBases'))
      !== canonicalJson(BINANCE_CONTRACT_MATRIX.approvedProductBases)) {
      addIssue('$.approvedProductBases', 'APPROVED_BASES_INVALID', 'Product/environment base allowlist must equal the reviewed closed revision');
    }
    if (canonicalJson(ownValue(candidate, 'obsoleteRouteFacts'))
      !== canonicalJson(BINANCE_CONTRACT_MATRIX.obsoleteRouteFacts)) {
      addIssue('$.obsoleteRouteFacts', 'OBSOLETE_ROUTE_FACTS_INVALID', 'Negative route facts must equal the reviewed closed revision');
    }
    if (canonicalJson(ownValue(candidate, 'rateHeaderTemplates'))
      !== canonicalJson(BINANCE_CONTRACT_MATRIX.rateHeaderTemplates)) {
      addIssue('$.rateHeaderTemplates', 'RATE_HEADER_TEMPLATES_INVALID', 'Rate-header templates must equal the reviewed closed revision');
    }
    if (canonicalJson(ownValue(candidate, 'protectedLocators'))
      !== canonicalJson(BINANCE_CONTRACT_MATRIX.protectedLocators)) {
      addIssue('$.protectedLocators', 'PROTECTED_LOCATORS_INVALID', 'Protected semantic locators must equal the reviewed closed revision');
    }
    if (canonicalJson(ownValue(candidate, 'marginAccountModeFacts')) !== canonicalJson({
      selectorParameter: 'isIsolated',
      falseOrOmittedMode: 'CROSS_MARGIN',
      trueMode: 'ISOLATED_MARGIN_PAIR',
      isolatedModeRequiresSymbol: true,
      portfolioMarginSupported: false,
    })) {
      addIssue('$.marginAccountModeFacts', 'MARGIN_ACCOUNT_MODE_FACTS_INVALID', 'Margin account-mode facts must equal the reviewed closed revision');
    }
    if (canonicalJson(ownValue(candidate, 'apiKeyProfilePolicy')) !== canonicalJson({
      defaultProfiles: ['READ_KEY', 'EXECUTION_KEY'],
      combinedKeyPosture: 'OWNER_EXCEPTION_REQUIRED',
      withdrawalsForLiveEntry: 'MUST_BE_DISABLED',
      transfersForLiveEntry: 'MUST_BE_DISABLED_WHERE_EXPOSED',
      fixedIpRestriction: 'REQUIRED',
      fixedIpDeployedEgressMatch: 'REQUIRED',
      onlyRequiredProductPermissions: 'REQUIRED',
      accountFingerprintRealmMatch: 'REQUIRED',
      supportedOwnerApprovedModes: 'REQUIRED',
      requiredAccountStatusValue: 'Normal',
      apiTradingLockedRequired: false,
      requiredUsdmMultiAssetsMarginValue: false,
      requiredUsdmDualSidePositionValue: false,
      unprovedBlocksLiveEntry: true,
    })) {
      addIssue('$.apiKeyProfilePolicy', 'API_KEY_PROFILE_POLICY_INVALID', 'API-key separation and live-entry restrictions must equal the reviewed policy');
    }
    if (canonicalJson(ownValue(candidate, 'apiKeyPermissionFields')) !== canonicalJson([
      'ipRestrict', 'enableReading', 'enableWithdrawals', 'enableInternalTransfer',
      'enableMargin', 'enableFutures', 'permitsUniversalTransfer', 'enableVanillaOptions',
      'enableFixApiTrade', 'enableFixReadOnly', 'enableSpotAndMarginTrading',
      'enablePortfolioMarginTrading',
    ])) {
      addIssue('$.apiKeyPermissionFields', 'API_KEY_PERMISSION_FIELDS_INVALID', 'Permission truth fields must equal the reviewed official response contract');
    }
    if (canonicalJson(ownValue(candidate, 'unsupportedAccountModes'))
      !== canonicalJson(['PORTFOLIO_MARGIN', 'MULTI_ASSETS', 'HEDGE_MODE'])) {
      addIssue('$.unsupportedAccountModes', 'UNSUPPORTED_ACCOUNT_MODES_INVALID', 'Unsupported account modes must remain explicit and closed');
    }
  } catch {
    addIssue('$', 'MATRIX_HELPER_FACTS_INVALID', 'Base and obsolete-route facts must be closed documentary objects');
  }

  const sources = arrayValue(candidate, 'sources', '$', addIssue) ?? [];
  const contracts = arrayValue(candidate, 'contracts', '$', addIssue) ?? [];
  if (sources.length < 3 || sources.length > 64) addIssue('$.sources', 'SOURCE_COUNT_INVALID', 'Matrix must have bounded Spot, USD-M, and Margin sources');
  if (contracts.length < 3 || contracts.length > 256) addIssue('$.contracts', 'CONTRACT_COUNT_INVALID', 'Matrix must have bounded contracts');

  const sourceIds = new Set<string>();
  const sourceUrls = new Set<string>();
  const sourceProducts = new Map<string, readonly string[]>();
  const sourceContentById = new Map<string, string | null>();
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    if (!isRecord(source)) {
      addIssue(`$.sources[${index}]`, 'OBJECT_REQUIRED', 'Source must be an object');
      continue;
    }
    validateSource(source, index, sourceIds, sourceUrls, addIssue);
    const id = ownValue(source, 'id');
    const productScopes = ownValue(source, 'productScopes');
    if (typeof id === 'string' && Array.isArray(productScopes)
      && productScopes.every((product) => typeof product === 'string')) {
      sourceProducts.set(id, productScopes as readonly string[]);
      const contentSha = ownValue(source, 'sourceContentSha256');
      sourceContentById.set(id, typeof contentSha === 'string' ? contentSha : null);
    }
  }

  for (const product of BINANCE_PRODUCTS) {
    if (![...sourceProducts.values()].some((scopes) => scopes.includes(product))) {
      addIssue('$.sources', 'PRODUCT_SOURCE_COVERAGE_MISSING', `Missing official source coverage for ${product}`);
    }
  }

  const contractIds = new Set<string>();
  const semanticContracts = new Set<string>();
  for (let index = 0; index < contracts.length; index += 1) {
    const contract = contracts[index];
    if (!isRecord(contract)) {
      addIssue(`$.contracts[${index}]`, 'OBJECT_REQUIRED', 'Contract must be an object');
      continue;
    }
    validateContract(contract, index, sourceProducts, sourceContentById, contractIds, semanticContracts, addIssue);
  }
  if (selectedPrivate !== null) {
    for (const product of ['SPOT', 'USD_M_PERPETUAL'] as const) {
      const selectedId = ownValue(selectedPrivate, product);
      const selected = contracts.find((contract) => isRecord(contract) && ownValue(contract, 'id') === selectedId);
      const selectedRealm = isRecord(selected) ? ownValue(selected, 'realm') : null;
      if (!isRecord(selected) || ownValue(selected, 'product') !== product
        || ownValue(selected, 'lifecycle') !== 'CURRENT'
        || typeof selectedRealm !== 'string' || !selectedRealm.startsWith('PRIVATE_')) {
        addIssue(`$.selectedPrivateContractIds.${product}`, 'SELECTED_PRIVATE_CONTRACT_MISSING', 'Selected private contract must resolve to a current contract in the same product');
      }
    }
    const spotSelection = contracts.find((contract) => isRecord(contract)
      && ownValue(contract, 'id') === ownValue(selectedPrivate, 'SPOT'));
    const spotAuthentication = isRecord(spotSelection) ? ownValue(spotSelection, 'authentication') : null;
    const spotKeyTypes = isRecord(spotAuthentication) ? ownValue(spotAuthentication, 'permittedKeyTypes') : null;
    if (!Array.isArray(spotKeyTypes) || !spotKeyTypes.includes(ownValue(candidate, 'selectedSpotSignatureKeyType'))) {
      addIssue('$.selectedSpotSignatureKeyType', 'SPOT_SIGNATURE_KEY_NOT_PERMITTED', 'Selected key type must be permitted by the selected Spot private contract');
    }
  }

  const digest = ownValue(candidate, 'contentSha256');
  if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
    addIssue('$.contentSha256', 'MATRIX_SHA256_INVALID', 'Matrix SHA-256 must be lower-case hex');
  } else {
    try {
      const actual = fingerprintBinanceContractMatrix(candidate as unknown as BinanceContractMatrix);
      if (digest !== actual) addIssue('$.contentSha256', 'MATRIX_SHA256_MISMATCH', 'Matrix SHA-256 does not match canonical content');
      if (digest !== BINANCE_CONTRACT_MATRIX_CONTENT_SHA256) addIssue('$.contentSha256', 'MATRIX_NOT_HASH_LOCKED', 'Matrix digest is not the L02 hash-locked revision');
    } catch {
      addIssue('$.contentSha256', 'MATRIX_CANONICALIZATION_FAILED', 'Matrix content could not be canonicalized');
    }
  }

  if (issues.length > 0) {
    issues.sort((left, right) => codePointCompare(`${left.path}|${left.code}`, `${right.path}|${right.code}`));
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }

  return Object.freeze({
    ok: true,
    matrix: cloneAndFreeze(candidate) as unknown as BinanceContractMatrix,
  });
}

function operationEquals(left: BinanceOperation, right: BinanceOperation): boolean {
  return left.kind === right.kind
    && left.httpMethod === right.httpMethod
    && left.value === right.value
    && left.queryTemplate === right.queryTemplate;
}

function rejectedFixture(code: string, reason: string, contractId: string | null = null): BinanceRouteFixtureResult {
  return Object.freeze({ ok: false, code, reason, contractId });
}

function isObsoleteSpotPrivate(fixture: BinanceRouteFixture): boolean {
  const facts = BINANCE_CONTRACT_MATRIX.obsoleteRouteFacts;
  if (fixture.product !== 'SPOT' || fixture.realm !== 'PRIVATE_USER_DATA') return false;
  if (fixture.transport === 'REST'
    && fixture.operation.kind === 'REST_PATH'
    && ['POST', 'PUT', 'DELETE'].includes(fixture.operation.httpMethod ?? '')
    && fixture.operation.value === facts.spotRestUserDataPath) return true;
  if (fixture.transport === 'WEBSOCKET_API'
    && fixture.operation.kind === 'WS_METHOD'
    && facts.spotRetiredWsMethods.includes(
      fixture.operation.value,
    )) return true;
  return fixture.transport === 'WEBSOCKET_STREAM'
    && facts.spotPublicStreamPrefixes.some((prefix) => fixture.baseUrl === prefix)
    && /listenKey/i.test(fixture.operation.value);
}

function isObsoleteMarginPrivate(fixture: BinanceRouteFixture): boolean {
  const facts = BINANCE_CONTRACT_MATRIX.obsoleteRouteFacts;
  return fixture.product === 'MARGIN'
    && fixture.realm === 'PRIVATE_USER_DATA'
    && fixture.transport === 'REST'
    && fixture.operation.kind === 'REST_PATH'
    && ['POST', 'PUT', 'DELETE'].includes(fixture.operation.httpMethod ?? '')
    && facts.marginRetiredRestPaths.includes(fixture.operation.value);
}

function isLegacyUsdmUnrouted(fixture: BinanceRouteFixture): boolean {
  return fixture.product === 'USD_M_PERPETUAL'
    && fixture.transport === 'WEBSOCKET_STREAM'
    && fixture.baseUrl === BINANCE_CONTRACT_MATRIX.obsoleteRouteFacts.usdmUnroutedWebSocketBase
    && (fixture.realm === 'PRIVATE_USER_DATA' || fixture.operation.value.includes('markPrice'));
}

function validateFixtureShape(candidate: unknown): candidate is BinanceRouteFixture {
  if (!isRecord(candidate)) return false;
  const keys = Object.keys(candidate).sort(codePointCompare);
  if (keys.length !== FIXTURE_KEYS.length || FIXTURE_KEYS.some((key) => !Object.hasOwn(candidate, key))) return false;
  if (keys.some((key) => !FIXTURE_KEYS.includes(key as typeof FIXTURE_KEYS[number]))) return false;
  const id = ownValue(candidate, 'id');
  const product = ownValue(candidate, 'product');
  const environment = ownValue(candidate, 'environment');
  const realm = ownValue(candidate, 'realm');
  const transport = ownValue(candidate, 'transport');
  const baseUrl = ownValue(candidate, 'baseUrl');
  const operation = ownValue(candidate, 'operation');
  if (typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)
    || !isEnumValue(product, BINANCE_PRODUCTS)
    || !isEnumValue(environment, BINANCE_ENVIRONMENTS)
    || !isEnumValue(realm, BINANCE_REALMS)
    || !isEnumValue(transport, BINANCE_TRANSPORTS)
    || typeof baseUrl !== 'string'
    || !isRecord(operation)) return false;
  if (Object.keys(operation).length !== OPERATION_KEYS.length || OPERATION_KEYS.some((key) => !Object.hasOwn(operation, key))) return false;
  const kind = ownValue(operation, 'kind');
  const method = ownValue(operation, 'httpMethod');
  const value = ownValue(operation, 'value');
  const queryTemplate = ownValue(operation, 'queryTemplate');
  return isEnumValue(kind, BINANCE_OPERATION_KINDS)
    && (method === null || isEnumValue(method, BINANCE_HTTP_METHODS))
    && typeof value === 'string'
    && (queryTemplate === null || typeof queryTemplate === 'string');
}

/**
 * Matches only the L02 hash-locked documentary registry. A positive match says
 * DOCUMENTED_CURRENT_CONTRACT; it never says callable, signed, or authorized.
 */
export function matchDocumentedBinanceContract(candidate: unknown): BinanceRouteFixtureResult {
  const shapeIssues: Array<Readonly<BinanceContractIssue>> = [];
  const addShapeIssue: AddIssue = (path, code, message) => {
    if (shapeIssues.length < MAXIMUM_ISSUES) shapeIssues.push(frozenIssue(path, code, message));
  };
  if (!inspectClosedJson(candidate, addShapeIssue)
    || !validateFixtureShape(candidate)) {
    return rejectedFixture('FIXTURE_INVALID', 'Route fixture must be exact closed plain data');
  }
  const fixture = candidate;
  if (isObsoleteSpotPrivate(fixture)) return rejectedFixture('OBSOLETE_SPOT_PRIVATE_ROUTE', 'Spot listen-key private routes were removed');
  if (isObsoleteMarginPrivate(fixture)) return rejectedFixture('OBSOLETE_MARGIN_PRIVATE_ROUTE', 'Margin userDataStream routes were removed');
  if (isLegacyUsdmUnrouted(fixture)) return rejectedFixture('LEGACY_USDM_UNROUTED_WS', 'USD-M private or market traffic requires a routed base');

  const validated = validateBinanceContractMatrix(BINANCE_CONTRACT_MATRIX);
  if (!validated.ok) return rejectedFixture('CANONICAL_MATRIX_INVALID', 'Hash-locked documentary matrix failed validation');
  const exact = validated.matrix.contracts.find((contract) => (
    contract.product === fixture.product
    && contract.environment === fixture.environment
    && contract.realm === fixture.realm
    && contract.transport === fixture.transport
    && contract.baseUrl === fixture.baseUrl
    && contract.operation !== null
    && operationEquals(contract.operation, fixture.operation)
  ));
  if (exact !== undefined) {
    if (exact.lifecycle === 'REMOVED') return rejectedFixture('CONTRACT_REMOVED', 'Documented contract is removed', exact.id);
    if (exact.lifecycle === 'OFFICIAL_DOC_CONFLICT') return rejectedFixture('OFFICIAL_DOC_CONFLICT', 'Official documentation conflicts; no current contract is selected', exact.id);
    if (exact.lifecycle !== 'CURRENT') return rejectedFixture('DOCUMENTARY_CONTRACT_UNKNOWN', 'Documented contract is not verified current', exact.id);
    return Object.freeze({
      ok: true,
      contractId: exact.id,
      lifecycle: 'CURRENT',
      actionAuthority: 'NONE_RECORD_ONLY',
    });
  }

  const sameLocatorDifferentProduct = validated.matrix.contracts.find((contract) => (
    contract.product !== fixture.product
    && contract.baseUrl === fixture.baseUrl
    && contract.operation !== null
    && operationEquals(contract.operation, fixture.operation)
  ));
  if (sameLocatorDifferentProduct !== undefined) {
    return rejectedFixture(
      'CROSS_PRODUCT_ROUTE_SUBSTITUTION',
      'A documented locator cannot be cross-cast to another Binance product',
      sameLocatorDifferentProduct.id,
    );
  }
  const sameLocatorDifferentEnvironment = validated.matrix.contracts.find((contract) => (
    contract.product === fixture.product
    && contract.environment !== fixture.environment
    && contract.baseUrl === fixture.baseUrl
    && contract.operation !== null
    && operationEquals(contract.operation, fixture.operation)
  ));
  if (sameLocatorDifferentEnvironment !== undefined) {
    return rejectedFixture(
      'CROSS_ENVIRONMENT_ROUTE_SUBSTITUTION',
      'A documentary route cannot be cross-cast between Binance environments',
      sameLocatorDifferentEnvironment.id,
    );
  }
  return rejectedFixture('UNREGISTERED_DOCUMENTARY_CONTRACT', 'No exact current documentary contract matches this tuple');
}

export function canonicalBinanceContractMatrix(): BinanceContractMatrix {
  const validated = validateBinanceContractMatrix(BINANCE_CONTRACT_MATRIX);
  if (!validated.ok) throw new Error('L02 canonical Binance contract matrix failed its hash lock');
  return validated.matrix;
}

export type { BinanceContractRecord, BinanceProduct };
