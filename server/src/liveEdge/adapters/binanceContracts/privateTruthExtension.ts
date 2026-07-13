/**
 * Dated L02 contract extension used only by the injected L05 private-truth
 * owner. The accepted base matrix stays byte-for-byte frozen because L03,
 * L04, L06 and L07 intentionally pin its full-content digest.
 *
 * This module is documentary data only. It exposes no credential, signer,
 * transport, private read, scheduler or exchange-action authority.
 */

import { createHash } from 'node:crypto';

import {
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
} from './matrix.js';
import { fingerprintBinanceSourceEvidence } from './validate.js';
import type {
  BinanceContractRecord,
  BinanceOfficialSourceRecord,
} from './types.js';

export const BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_SCHEMA =
  'BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_V1' as const;
export const BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_REVISION =
  'D-LAUNCH-14-2026-07-13' as const;
export const BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CHECKED_AT =
  '2026-07-13T00:00:00Z' as const;
export const USDM_ALGO_OPEN_ORDERS_CONTRACT_ID =
  'USDM_ALGO_OPEN_ORDERS_QUERY' as const;
export const USDM_ALGO_OPEN_ORDERS_SOURCE_ID =
  'USDM_ALGO_OPEN_ORDERS_2026_07_13' as const;

export const USDM_ALGO_OPEN_ORDERS_SOURCE: Readonly<BinanceOfficialSourceRecord> =
  Object.freeze({
    id: USDM_ALGO_OPEN_ORDERS_SOURCE_ID,
    productScopes: Object.freeze(['USD_M_PERPETUAL'] as const),
    pageTitle: 'Current All Algo Open Orders (USER_DATA)',
    officialUrl:
      'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Current-All-Algo-Open-Orders',
    checkedAt: BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CHECKED_AT,
    lastModified: null,
    revisionSignal: 'CATALOG_CHECKED_2026-07-13',
    digestScope: 'CANONICAL_EVIDENCE_SET',
    evidence: Object.freeze([
      'GET /fapi/v1/openAlgoOrders is a signed USD-M USER_DATA route on https://fapi.binance.com using HMAC SHA-256 or RSA SHA-256 keys.',
      'timestamp is required; algoType, symbol, algoId and recvWindow are optional; recvWindow defaults to 5000 milliseconds and has a 60000 millisecond maximum.',
      'Omitting symbol returns all-symbol current algo open orders and costs IP request weight 40; exact-symbol scope costs 1.',
      'The response is a distinct algo-order fact class with algoId, clientAlgoId, algoStatus and positionSide; standard /openOrders is not a substitute; current producer time-in-force includes RPI.',
    ]),
    evidenceSha256:
      'b9c8b75c67c26f6d8b1d69f84146173d1aed11a47d31cb3bd81d4f5033422c84',
    sourceContentDigestScope: 'NOT_CAPTURED',
    sourceContentUrl: null,
    sourceContentSha256: null,
  });

const USDM_ALGO_OPEN_ORDERS_CONTRACT: Readonly<BinanceContractRecord> =
  Object.freeze({
    id: USDM_ALGO_OPEN_ORDERS_CONTRACT_ID,
    product: 'USD_M_PERPETUAL',
    environment: 'PRODUCTION',
    realm: 'PRIVATE_ACCOUNT',
    transport: 'REST',
    lifecycle: 'CURRENT',
    baseUrl: 'https://fapi.binance.com',
    operation: Object.freeze({
      kind: 'REST_PATH',
      httpMethod: 'GET',
      value: '/fapi/v1/openAlgoOrders',
      queryTemplate: null,
    }),
    authentication: Object.freeze({
      securityType: 'USER_DATA',
      permittedKeyTypes: Object.freeze(['HMAC', 'RSA'] as const),
      signingAlgorithm: 'HMAC_RSA',
      canonicalEncoding: 'TOTAL_PARAMS_QUERY_THEN_BODY',
      timestampUnit: 'MILLISECONDS',
      recvWindowDefaultMs: 5_000,
      recvWindowMaxMs: 60_000,
      requiredParameters: Object.freeze(['timestamp'] as const),
    }),
    rateLimit: Object.freeze({
      state: 'VERIFIED',
      claims: Object.freeze([
        Object.freeze({
          sourceId: USDM_ALGO_OPEN_ORDERS_SOURCE_ID,
          kind: 'REQUEST_WEIGHT',
          scope: 'IP',
          value: 1,
          interval: 'REQUEST',
          header: null,
          condition: 'WITH_SYMBOL',
        }),
        Object.freeze({
          sourceId: USDM_ALGO_OPEN_ORDERS_SOURCE_ID,
          kind: 'REQUEST_WEIGHT',
          scope: 'IP',
          value: 40,
          interval: 'REQUEST',
          header: null,
          condition: 'WITHOUT_SYMBOL',
        }),
      ]),
    }),
    connection: Object.freeze({
      connectionLifetimeMinutes: null,
      tokenLifetimeMinutes: null,
      renewalRule: 'NOT_APPLICABLE',
      pingIntervalSeconds: null,
      pongTimeoutSeconds: null,
      incomingMessagesPerSecond: null,
      maximumStreams: null,
      orderingRule: 'NOT_APPLICABLE',
    }),
    dataSource: 'UNKNOWN_CURRENT_OFFICIAL_CATALOG',
    mutationClass: 'ORDER_QUERY_READ',
    ambiguityClass: 'NONE',
    safeRetryClass: 'NOT_APPLICABLE',
    responseSchema: Object.freeze({ state: 'UNKNOWN', revision: null, sha256: null }),
    sourceIds: Object.freeze([USDM_ALGO_OPEN_ORDERS_SOURCE_ID] as const),
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    notes:
      'Current separate USD-M algo-open-order read contract. Optional selectors are retained by the extension; standard open orders never substitute.',
  });

export interface BinancePrivateTruthContractExtension {
  readonly schema: typeof BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_SCHEMA;
  readonly revision: typeof BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_REVISION;
  readonly checkedAt: typeof BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CHECKED_AT;
  readonly baseMatrixSha256: typeof BINANCE_CONTRACT_MATRIX_CONTENT_SHA256;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly source: Readonly<BinanceOfficialSourceRecord>;
  readonly factClass: 'USDM_ALGO_OPEN_ORDERS';
  readonly contract: Readonly<BinanceContractRecord>;
  readonly optionalParameters: readonly ['algoType', 'symbol', 'algoId', 'recvWindow'];
  readonly allSymbolsWhenSymbolOmitted: true;
  readonly contentSha256: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError('contract extension must be closed JSON');
  const entries = Object.keys(value as Readonly<Record<string, unknown>>)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(
      (value as Readonly<Record<string, unknown>>)[key],
    )}`);
  return `{${entries.join(',')}}`;
}

export function fingerprintBinancePrivateTruthContractExtension(
  extension: Omit<BinancePrivateTruthContractExtension, 'contentSha256'>,
): string {
  return createHash('sha256').update(canonicalJson(extension), 'utf8').digest('hex');
}

const EXTENSION_CONTENT = Object.freeze({
  schema: BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_SCHEMA,
  revision: BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_REVISION,
  checkedAt: BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CHECKED_AT,
  baseMatrixSha256: BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
  externalActionAuthorization: 'NONE' as const,
  source: USDM_ALGO_OPEN_ORDERS_SOURCE,
  factClass: 'USDM_ALGO_OPEN_ORDERS' as const,
  contract: USDM_ALGO_OPEN_ORDERS_CONTRACT,
  optionalParameters: Object.freeze([
    'algoType', 'symbol', 'algoId', 'recvWindow',
  ] as const),
  allSymbolsWhenSymbolOmitted: true as const,
});

export const BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256 =
  '3e5c1d75051f13f3150ba20653d1de1bff355b0732a0155a09a9de57c5907415' as const;

export const BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION:
Readonly<BinancePrivateTruthContractExtension> = Object.freeze({
  ...EXTENSION_CONTENT,
  contentSha256: BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256,
});

export function canonicalBinancePrivateTruthContractExtension():
Readonly<BinancePrivateTruthContractExtension> {
  if (fingerprintBinanceSourceEvidence(USDM_ALGO_OPEN_ORDERS_SOURCE)
      !== USDM_ALGO_OPEN_ORDERS_SOURCE.evidenceSha256) {
    throw new Error('L02 private-truth contract source evidence hash drifted');
  }
  if (fingerprintBinancePrivateTruthContractExtension(EXTENSION_CONTENT)
      !== BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256) {
    throw new Error('L02 private-truth contract extension content hash drifted');
  }
  return BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION;
}

export function resolveBinancePrivateTruthContractExtension(
  baseMatrixSha256: unknown,
  extensionContentSha256: unknown,
  contractId: unknown,
): Readonly<BinanceContractRecord> | null {
  if (baseMatrixSha256 !== BINANCE_CONTRACT_MATRIX_CONTENT_SHA256
    || extensionContentSha256
      !== BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256
    || BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION.contentSha256
      !== BINANCE_PRIVATE_TRUTH_CONTRACT_EXTENSION_CONTENT_SHA256
    || contractId !== USDM_ALGO_OPEN_ORDERS_CONTRACT_ID) return null;
  return canonicalBinancePrivateTruthContractExtension().contract;
}
