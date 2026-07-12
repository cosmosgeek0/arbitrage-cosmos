import {
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  canonicalBinanceContractMatrix,
  type BinanceContractRecord,
  type BinanceProduct,
} from '../binanceContracts/index.js';
import type {
  BinanceEnvironment,
  BinanceHttpMethod,
  BinanceMutationClass,
  BinanceRateState,
  BinanceRealm,
  BinanceSafeRetryClass,
} from '../binanceContracts/types.js';

/** Accepted documentary input for this bounded phase; changing it is fail-closed. */
export const L03_BINANCE_MATRIX_SHA256 =
  '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac' as const;

export const BINANCE_SIGNER_PROFILES = Object.freeze([
  'SPOT_HMAC_SHA256',
  'USDM_HMAC_SHA256',
] as const);

export type BinanceSignerProfile = (typeof BINANCE_SIGNER_PROFILES)[number];

export interface ResolvedSignedContract {
  readonly contractId: string;
  readonly product: Extract<BinanceProduct, 'SPOT' | 'USD_M_PERPETUAL'>;
  readonly environment: 'PRODUCTION';
  readonly realm: BinanceRealm;
  readonly method: Exclude<BinanceHttpMethod, null>;
  readonly signerProfile: BinanceSignerProfile;
  readonly requiredParameters: readonly string[];
  readonly mutationClass: BinanceMutationClass;
  readonly safeRetryClass: BinanceSafeRetryClass;
  readonly rateState: BinanceRateState;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export type ResolveSignedContractFailureCode =
  | 'CONTRACT_ID_INVALID'
  | 'EXPECTED_PRODUCT_INVALID'
  | 'EXPECTED_ENVIRONMENT_INVALID'
  | 'MATRIX_HASH_MISMATCH'
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_SCOPE_MISMATCH'
  | 'CONTRACT_NOT_CURRENT_REST'
  | 'CONTRACT_AUTHORITY_INVALID'
  | 'SIGNING_POLICY_UNRESOLVED';

export type ResolveSignedContractResult =
  | { readonly ok: true; readonly contract: Readonly<ResolvedSignedContract> }
  | { readonly ok: false; readonly code: ResolveSignedContractFailureCode };

const CONTRACT_ID = /^[A-Z0-9][A-Z0-9_.-]{2,127}$/;

function rejected(code: ResolveSignedContractFailureCode): ResolveSignedContractResult {
  return Object.freeze({ ok: false as const, code });
}

function signerProfile(contract: BinanceContractRecord): BinanceSignerProfile | null {
  if (
    contract.product === 'SPOT'
    && contract.authentication.permittedKeyTypes.includes('HMAC')
    && contract.authentication.signingAlgorithm === 'HMAC_RSA_ED25519'
    && contract.authentication.canonicalEncoding === 'PERCENT_ENCODE_BEFORE_SIGNING'
    && contract.authentication.timestampUnit === 'MILLISECONDS_OR_MICROSECONDS'
  ) {
    return 'SPOT_HMAC_SHA256';
  }
  if (
    contract.product === 'USD_M_PERPETUAL'
    && contract.authentication.permittedKeyTypes.includes('HMAC')
    && contract.authentication.signingAlgorithm === 'HMAC_SHA256'
    && contract.authentication.canonicalEncoding === 'TOTAL_PARAMS_QUERY_THEN_BODY'
    && contract.authentication.timestampUnit === 'MILLISECONDS'
  ) {
    return 'USDM_HMAC_SHA256';
  }
  return null;
}

/**
 * Resolve a construction policy by exact accepted L02 ID. A positive result is
 * still documentary and grants no request, credential, transport or action
 * authority.
 */
export function resolveSignedContract(
  contractId: unknown,
  expectedProduct: unknown,
  expectedEnvironment: unknown,
): ResolveSignedContractResult {
  if (typeof contractId !== 'string' || !CONTRACT_ID.test(contractId)) {
    return rejected('CONTRACT_ID_INVALID');
  }
  if (expectedProduct !== 'SPOT' && expectedProduct !== 'USD_M_PERPETUAL') {
    return rejected('EXPECTED_PRODUCT_INVALID');
  }
  if (expectedEnvironment !== 'PRODUCTION') {
    return rejected('EXPECTED_ENVIRONMENT_INVALID');
  }
  if (
    BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 !== L03_BINANCE_MATRIX_SHA256
    || canonicalBinanceContractMatrix().contentSha256 !== L03_BINANCE_MATRIX_SHA256
  ) {
    return rejected('MATRIX_HASH_MISMATCH');
  }
  const matrix = canonicalBinanceContractMatrix();
  const contract = matrix.contracts.find((candidate) => candidate.id === contractId);
  if (contract === undefined) return rejected('CONTRACT_NOT_FOUND');
  if (contract.product !== expectedProduct || contract.environment !== expectedEnvironment) {
    return rejected('CONTRACT_SCOPE_MISMATCH');
  }
  if (
    contract.lifecycle !== 'CURRENT'
    || contract.transport !== 'REST'
    || contract.baseUrl === null
    || contract.operation === null
    || contract.operation.kind !== 'REST_PATH'
    || contract.operation.httpMethod === null
  ) {
    return rejected('CONTRACT_NOT_CURRENT_REST');
  }
  if (
    contract.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
    || contract.externalActionAuthorization !== 'NONE'
    || contract.actionAuthority !== 'NONE_RECORD_ONLY'
  ) {
    return rejected('CONTRACT_AUTHORITY_INVALID');
  }
  if (contract.authentication.securityType !== 'USER_DATA' && contract.authentication.securityType !== 'TRADE') {
    return rejected('SIGNING_POLICY_UNRESOLVED');
  }
  const profile = signerProfile(contract);
  if (profile === null) return rejected('SIGNING_POLICY_UNRESOLVED');

  return Object.freeze({
    ok: true as const,
    contract: Object.freeze({
      contractId: contract.id,
      product: contract.product as ResolvedSignedContract['product'],
      environment: contract.environment as ResolvedSignedContract['environment'],
      realm: contract.realm,
      method: contract.operation.httpMethod,
      signerProfile: profile,
      requiredParameters: Object.freeze([...contract.authentication.requiredParameters]),
      mutationClass: contract.mutationClass,
      safeRetryClass: contract.safeRetryClass,
      rateState: contract.rateLimit.state,
      documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY' as const,
      externalActionAuthorization: 'NONE' as const,
      actionAuthority: 'NONE_RECORD_ONLY' as const,
    }),
  });
}

/** Compile-time evidence that L03 never widens the accepted environment. */
export type L03SignedEnvironment = Extract<BinanceEnvironment, 'PRODUCTION'>;
