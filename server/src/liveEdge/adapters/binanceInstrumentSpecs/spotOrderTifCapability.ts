import { types as utilTypes } from 'node:util';

import { canonicalJson, stableId } from '../../../intelligenceFoundation/contracts/index.js';
import {
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  canonicalBinanceContractMatrix,
} from '../binanceContracts/index.js';
import { L04_BINANCE_MATRIX_SHA256, L04_EXCHANGE_INFO_CONTRACT_IDS } from './contract.js';
import { compareDecimal, multiplyDecimal, normalizeSizingDecimal } from './exact.js';
import {
  BINANCE_SPOT_ORDER_TIF_CAPABILITY_SCHEMA,
  type BinanceSpotOrderTifCapability,
} from './types.js';

export const L081_BINANCE_SPOT_API_GIT_COMMIT =
  '31643ed390e2aa450ce872981556186acf96a195' as const;
export const L081_BINANCE_SPOT_REST_API_SHA256 =
  '49ea6809243fc7fb426e07f2fe662097736c7bb405bd2da5eef637d715427999' as const;
export const L081_BINANCE_SPOT_ENUMS_SHA256 =
  '5708fe6fdea8013f6c8a8388074c8cef8482b2b69a09181e4b2b36e0c2b4ab4b' as const;

export const L081_SPOT_LIMIT_TIME_IN_FORCE = Object.freeze(['FOK', 'GTC', 'IOC'] as const);

const DOCUMENTARY_MATERIAL = Object.freeze({
  matrixSha256: L04_BINANCE_MATRIX_SHA256,
  instrumentContractId: L04_EXCHANGE_INFO_CONTRACT_IDS.SPOT,
  orderContractId: 'SPOT_ORDER_POST' as const,
  spotApiGitCommit: L081_BINANCE_SPOT_API_GIT_COMMIT,
  restApiSha256: L081_BINANCE_SPOT_REST_API_SHA256,
  enumsSha256: L081_BINANCE_SPOT_ENUMS_SHA256,
  orderType: 'LIMIT' as const,
  timeInForceRequirement: 'REQUIRED' as const,
  allowedTimeInForce: L081_SPOT_LIMIT_TIME_IN_FORCE,
  runtimeSymbolCapabilityField: 'orderTypes' as const,
  runtimeSymbolTimeInForceField: 'UNAVAILABLE' as const,
  documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
  externalActionAuthorization: 'NONE' as const,
  actionAuthority: 'NONE_RECORD_ONLY' as const,
});

const REQUIRED_REMAINING_SPOT_LOSSES = Object.freeze([
  'EXACT_L02_RESPONSE_HOST_BINDING_UNPROVED',
  'MAX_ASSET_PRIVATE_FILTER_UNAVAILABLE',
  'SPOT_EXECUTION_RULES_UNAVAILABLE',
  'TOP_LEVEL_EXCHANGE_FILTERS_UNAVAILABLE',
] as const);

const CAPABILITY_FIELDS = Object.freeze([
  'schema', 'state', 'reasonCodes', 'product', 'environment',
  'instrumentContractId', 'orderContractId', 'matrixSha256',
  'spotApiGitCommit', 'restApiSha256', 'enumsSha256', 'documentaryRevision',
  'symbol', 'baseAsset', 'quoteAsset', 'side', 'orderType', 'timeInForce',
  'instrumentRevision', 'sourceEvidenceRevision', 'registryRevision',
  'snapshotRevision', 'referenceEvidenceRevision', 'sourceReceivedAtMs',
  'sourceValidUntilMs', 'evaluatedAtMs', 'validUntilMs', 'preflightRevision',
  'requestedPrice', 'requestedQuantity', 'resultQuantity', 'resultNotional',
  'resolvedCapabilityGaps', 'remainingExternalRequirements',
  'capabilityRevision', 'sendEligible', 'documentaryAuthority',
  'externalActionAuthorization', 'actionAuthority',
] as const);

type PlainRecord = Readonly<Record<string, unknown>>;

function safeSnapshot(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
  budget = { nodes: 0, text: 0 },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > 10_000 || depth > 10) throw new RangeError('Spot capability graph exceeds its bound');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Spot capability numbers must be safe integers');
    return value;
  }
  if (typeof value === 'string') {
    budget.text += value.length;
    if (value.length > 8_192 || budget.text > 1_000_000) {
      throw new RangeError('Spot capability text exceeds its bound');
    }
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) {
    throw new TypeError('Spot capability must be alias-free plain data');
  }
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) {
    throw new TypeError('Spot capability symbol keys are forbidden');
  }
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > 128 || keys.length !== value.length + 1) {
      throw new TypeError('Spot capability arrays must be bounded dense arrays');
    }
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Spot capability arrays must use enumerable data elements');
      }
      output.push(safeSnapshot(descriptor.value, seen, depth + 1, budget));
    }
    return output;
  }
  if ((prototype !== Object.prototype && prototype !== null) || keys.length > 64) {
    throw new TypeError('Spot capability records must be bounded plain records');
  }
  const output: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Spot capability records must use enumerable data fields');
    }
    output[key] = safeSnapshot(descriptor.value, seen, depth + 1, budget);
  }
  return output;
}

function record(value: unknown, fields: readonly string[], label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || keys.length !== fields.length
    || keys.some((key) => !fields.includes(key as string))
    || Object.values(descriptors).some((descriptor) => !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value'))) {
    throw new TypeError(`${label} must use exact enumerable own data fields`);
  }
  return value as PlainRecord;
}

function text(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new TypeError(`${label} must be bounded safe text`);
  }
  return value;
}

function instrumentToken(value: unknown, label: string): string {
  const token = text(value, label, 40);
  if (token !== token.normalize('NFC').toUpperCase()
    || !/^[\p{L}\p{N}._-]+$/u.test(token)) {
    throw new TypeError(`${label} must use canonical instrument-token form`);
  }
  return token;
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function sortedStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 128) throw new TypeError(`${label} must be bounded`);
  const output = value.map((entry, index) => text(entry, `${label}[${index}]`));
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1] >= output[index]) throw new TypeError(`${label} must be sorted and unique`);
  }
  return output;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function exactCurrentContractPosture(): void {
  const matrix = canonicalBinanceContractMatrix();
  if (BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 !== L04_BINANCE_MATRIX_SHA256
    || matrix.contentSha256 !== L04_BINANCE_MATRIX_SHA256) {
    throw new TypeError('accepted L02 matrix content changed');
  }
  const exchangeInfo = matrix.contracts.find((contract) => contract.id === 'SPOT_EXCHANGE_INFO_FILTERS');
  const order = matrix.contracts.find((contract) => contract.id === 'SPOT_ORDER_POST');
  const restSource = matrix.sources.find((source) => source.id === 'SPOT_REST_2026_06_26');
  if (exchangeInfo?.product !== 'SPOT'
    || exchangeInfo.environment !== 'PRODUCTION'
    || exchangeInfo.realm !== 'PUBLIC_REST'
    || exchangeInfo.transport !== 'REST'
    || exchangeInfo.lifecycle !== 'CURRENT'
    || exchangeInfo.operation?.kind !== 'REST_PATH'
    || exchangeInfo.operation.httpMethod !== 'GET'
    || exchangeInfo.authentication.securityType !== 'NONE'
    || order?.product !== 'SPOT'
    || order.environment !== 'PRODUCTION'
    || order.realm !== 'PRIVATE_TRADE'
    || order.transport !== 'REST'
    || order.lifecycle !== 'CURRENT'
    || order.operation?.kind !== 'REST_PATH'
    || order.operation.httpMethod !== 'POST'
    || order.authentication.securityType !== 'TRADE'
    || order.mutationClass !== 'ORDER_MUTATION'
    || order.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || order.externalActionAuthorization !== 'NONE'
    || order.actionAuthority !== 'NONE_RECORD_ONLY'
    || restSource?.sourceContentSha256 !== L081_BINANCE_SPOT_REST_API_SHA256) {
    throw new TypeError('accepted Spot documentary contracts changed');
  }
}

export function currentSpotOrderTifDocumentaryRevision(): string {
  exactCurrentContractPosture();
  return stableId('l081-spot-order-tif-documentary', DOCUMENTARY_MATERIAL);
}

export function deriveSpotOrderTifCapabilityRevision(
  binding: Omit<BinanceSpotOrderTifCapability, 'capabilityRevision'>,
): string {
  return stableId('l081-spot-order-tif-capability', binding);
}

export function deriveSpotOrderTifDependencyRevision(
  bindings: readonly BinanceSpotOrderTifCapability[],
): string {
  if (bindings.length < 1 || bindings.length > 2) {
    throw new TypeError('Spot capability dependency set must contain one or two bindings');
  }
  return stableId('l081-spot-order-tif-dependency', bindings
    .map((binding) => ({
      capabilityRevision: binding.capabilityRevision,
      snapshotRevision: binding.snapshotRevision,
    }))
    .sort((left, right) => left.capabilityRevision < right.capabilityRevision ? -1
      : left.capabilityRevision > right.capabilityRevision ? 1 : 0));
}

export function validateSpotOrderTifCapability(
  value: unknown,
): Readonly<BinanceSpotOrderTifCapability> {
  const capability = record(safeSnapshot(value), CAPABILITY_FIELDS, 'Spot order/TIF capability');
  if (capability.schema !== BINANCE_SPOT_ORDER_TIF_CAPABILITY_SCHEMA
    || capability.state !== 'PASS'
    || canonicalJson(capability.reasonCodes) !== '[]'
    || capability.product !== 'SPOT'
    || capability.environment !== 'PRODUCTION'
    || capability.instrumentContractId !== 'SPOT_EXCHANGE_INFO_FILTERS'
    || capability.orderContractId !== 'SPOT_ORDER_POST'
    || capability.matrixSha256 !== L04_BINANCE_MATRIX_SHA256
    || capability.spotApiGitCommit !== L081_BINANCE_SPOT_API_GIT_COMMIT
    || capability.restApiSha256 !== L081_BINANCE_SPOT_REST_API_SHA256
    || capability.enumsSha256 !== L081_BINANCE_SPOT_ENUMS_SHA256
    || capability.documentaryRevision !== currentSpotOrderTifDocumentaryRevision()
    || capability.orderType !== 'LIMIT'
    || !L081_SPOT_LIMIT_TIME_IN_FORCE.includes(
      capability.timeInForce as (typeof L081_SPOT_LIMIT_TIME_IN_FORCE)[number],
    )
    || capability.sendEligible !== false
    || capability.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || capability.externalActionAuthorization !== 'NONE'
    || capability.actionAuthority !== 'NONE_RECORD_ONLY') {
    throw new TypeError('Spot capability identity, documentary revision or authority is invalid');
  }
  const symbol = instrumentToken(capability.symbol, 'capability.symbol');
  const baseAsset = instrumentToken(capability.baseAsset, 'capability.baseAsset');
  const quoteAsset = instrumentToken(capability.quoteAsset, 'capability.quoteAsset');
  if (symbol !== `${baseAsset}${quoteAsset}`) throw new TypeError('Spot capability instrument identity conflicts');
  if (capability.side !== 'BUY' && capability.side !== 'SELL') throw new TypeError('Spot capability side is invalid');
  for (const field of [
    'instrumentRevision', 'sourceEvidenceRevision', 'registryRevision',
    'snapshotRevision', 'documentaryRevision', 'preflightRevision', 'capabilityRevision',
  ] as const) text(capability[field], `capability.${field}`);
  if (capability.referenceEvidenceRevision !== null) {
    text(capability.referenceEvidenceRevision, 'capability.referenceEvidenceRevision');
  }
  const sourceReceivedAtMs = timestamp(capability.sourceReceivedAtMs, 'capability.sourceReceivedAtMs');
  const sourceValidUntilMs = timestamp(capability.sourceValidUntilMs, 'capability.sourceValidUntilMs');
  const evaluatedAtMs = timestamp(capability.evaluatedAtMs, 'capability.evaluatedAtMs');
  const validUntilMs = timestamp(capability.validUntilMs, 'capability.validUntilMs');
  if (sourceValidUntilMs < sourceReceivedAtMs
    || sourceValidUntilMs - sourceReceivedAtMs > 300_000
    || evaluatedAtMs < sourceReceivedAtMs - 2_000
    || evaluatedAtMs >= validUntilMs
    || validUntilMs > sourceValidUntilMs) {
    throw new TypeError('Spot capability validity interval is invalid');
  }
  for (const field of ['requestedPrice', 'requestedQuantity', 'resultQuantity', 'resultNotional'] as const) {
    const normalized = normalizeSizingDecimal(capability[field], true);
    if (normalized !== capability[field]) throw new TypeError(`capability.${field} must be canonical`);
  }
  if (compareDecimal(capability.resultQuantity as string, capability.requestedQuantity as string) > 0
    || multiplyDecimal(capability.requestedPrice as string, capability.resultQuantity as string)
      !== capability.resultNotional
    || compareDecimal(capability.resultNotional as string, '10') > 0) {
    throw new TypeError('Spot capability sizing projection is inconsistent');
  }
  if (canonicalJson(capability.resolvedCapabilityGaps) !== '["SPOT_TIME_IN_FORCE_UNAVAILABLE"]') {
    throw new TypeError('Spot capability may resolve only the exact TIF gap');
  }
  const requirements = sortedStrings(
    capability.remainingExternalRequirements,
    'capability.remainingExternalRequirements',
  );
  if (requirements.includes('SPOT_TIME_IN_FORCE_UNAVAILABLE')
    || REQUIRED_REMAINING_SPOT_LOSSES.some((requirement) => !requirements.includes(requirement))) {
    throw new TypeError('Spot capability remaining requirements hide a product-specific loss');
  }
  const material = { ...capability } as unknown as BinanceSpotOrderTifCapability;
  delete (material as unknown as { capabilityRevision?: string }).capabilityRevision;
  const expected = deriveSpotOrderTifCapabilityRevision(
    material as unknown as Omit<BinanceSpotOrderTifCapability, 'capabilityRevision'>,
  );
  if (capability.capabilityRevision !== expected) {
    throw new TypeError('Spot capability revision is not content-addressed');
  }
  return deepFreeze({
    ...capability,
    reasonCodes: [] as const,
    resolvedCapabilityGaps: ['SPOT_TIME_IN_FORCE_UNAVAILABLE'] as const,
    remainingExternalRequirements: [...requirements],
  } as unknown as BinanceSpotOrderTifCapability);
}
