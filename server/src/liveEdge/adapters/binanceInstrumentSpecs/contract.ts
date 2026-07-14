import {
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  canonicalBinanceContractMatrix,
} from '../binanceContracts/index.js';
import type { BinanceInstrumentProduct } from './types.js';

export const L04_BINANCE_MATRIX_SHA256 =
  '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac' as const;

export const L04_EXCHANGE_INFO_CONTRACT_IDS = Object.freeze({
  SPOT: 'SPOT_EXCHANGE_INFO_FILTERS',
  USD_M_PERPETUAL: 'USDM_EXCHANGE_INFO_FILTERS',
  MARGIN: 'MARGIN_EXCHANGE_INFO_FILTERS',
} as const);

export interface ResolvedInstrumentContract {
  readonly contractId: string;
  readonly product: BinanceInstrumentProduct;
  readonly environment: 'PRODUCTION';
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}
export type ResolveInstrumentContractResult =
  | { readonly ok: true; readonly contract: Readonly<ResolvedInstrumentContract> }
  | { readonly ok: false; readonly code: string };

function rejected(code: string): ResolveInstrumentContractResult {
  return Object.freeze({ ok: false as const, code });
}

export function resolveInstrumentContract(
  matrixSha256: unknown,
  contractId: unknown,
  product: unknown,
  environment: unknown,
): ResolveInstrumentContractResult {
  if (matrixSha256 !== L04_BINANCE_MATRIX_SHA256
    || BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 !== L04_BINANCE_MATRIX_SHA256
    || canonicalBinanceContractMatrix().contentSha256 !== L04_BINANCE_MATRIX_SHA256) {
    return rejected('MATRIX_HASH_MISMATCH');
  }
  if (product !== 'SPOT' && product !== 'USD_M_PERPETUAL' && product !== 'MARGIN') {
    return rejected('PRODUCT_INVALID');
  }
  if (environment !== 'PRODUCTION') return rejected('ENVIRONMENT_INVALID');
  const expectedId = L04_EXCHANGE_INFO_CONTRACT_IDS[product];
  if (contractId !== expectedId) return rejected('CONTRACT_SCOPE_MISMATCH');
  const contract = canonicalBinanceContractMatrix().contracts.find((candidate) => candidate.id === expectedId);
  if (contract === undefined) return rejected('CONTRACT_NOT_FOUND');
  if (contract.product !== product || contract.environment !== 'PRODUCTION'
    || contract.lifecycle !== 'CURRENT' || contract.transport !== 'REST'
    || contract.realm !== 'PUBLIC_REST' || contract.authentication.securityType !== 'NONE'
    || contract.operation?.kind !== 'REST_PATH' || contract.operation.httpMethod !== 'GET') {
    return rejected('CONTRACT_NOT_CURRENT_PUBLIC_REST');
  }
  if (contract.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || contract.externalActionAuthorization !== 'NONE'
    || contract.actionAuthority !== 'NONE_RECORD_ONLY') {
    return rejected('CONTRACT_AUTHORITY_INVALID');
  }
  return Object.freeze({
    ok: true as const,
    contract: Object.freeze({
      contractId: expectedId,
      product,
      environment: 'PRODUCTION' as const,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
      externalActionAuthorization: 'NONE' as const,
      actionAuthority: 'NONE_RECORD_ONLY' as const,
    }),
  });
}
