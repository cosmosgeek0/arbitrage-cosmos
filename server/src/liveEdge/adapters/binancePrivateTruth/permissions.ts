import { createHash } from 'node:crypto';

import {
  deepFreezePrivate,
  privateAccountFingerprintReference,
  privateAccountRealmReference,
  privateBoolean,
  privateProfileReference,
  privateRecord,
  privateSortedUnique,
  snapshotPrivateData,
} from './bounds.js';
import { L05_BINANCE_MATRIX_SHA256 } from './contracts.js';
import {
  NO_PRIVATE_ACTION_AUTHORITY,
  PRIVATE_TRUTH_POSTURES,
  type PrivatePermissionDecision,
  type PrivatePermissionPayload,
  type PrivatePermissionProfileInput,
  type PrivateProfileClass,
  type PrivateTruthPosture,
} from './types.js';

const INPUT_FIELDS = Object.freeze([
  'matrixSha256', 'posture', 'accountRealmId', 'accountFingerprintRef',
  'readProfile', 'executionProfile',
] as const);

const PROFILE_FIELDS = Object.freeze([
  'profileClass', 'profileId', 'accountRealmId', 'accountFingerprintRef',
  'environment', 'deployedEgressMatch', 'permissions', 'accountStatus',
  'apiTradingLocked', 'usdmDualSidePosition', 'usdmMultiAssetsMargin',
  'marginMode',
] as const);

const PERMISSION_FIELDS = Object.freeze([
  'ipRestrict', 'enableReading', 'enableWithdrawals', 'enableInternalTransfer',
  'enableMargin', 'enableFutures', 'permitsUniversalTransfer',
  'enableVanillaOptions', 'enableFixApiTrade', 'enableFixReadOnly',
  'enableSpotAndMarginTrading', 'enablePortfolioMarginTrading',
] as const);

export interface EvaluatePrivatePermissionsInput {
  readonly matrixSha256: unknown;
  readonly posture: unknown;
  readonly accountRealmId: unknown;
  readonly accountFingerprintRef: unknown;
  readonly readProfile: unknown;
  readonly executionProfile: unknown;
}

interface PermissionExpectation {
  readonly spotAndMarginTrading: boolean;
  readonly margin: boolean;
  readonly futures: boolean;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function revision(prefix: string, value: unknown): string {
  return `${prefix}${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function postureValue(value: unknown): PrivateTruthPosture {
  if (typeof value !== 'string'
    || !(PRIVATE_TRUTH_POSTURES as readonly string[]).includes(value)) {
    throw new TypeError('private permission posture is unsupported');
  }
  return value as PrivateTruthPosture;
}

function nullableBoolean(value: unknown, label: string): boolean | null {
  return value === null ? null : privateBoolean(value, label);
}

function permissionPayload(value: unknown): Readonly<PrivatePermissionPayload> {
  const record = privateRecord(value, PERMISSION_FIELDS, 'permission payload');
  const output: PrivatePermissionPayload = {
    ipRestrict: privateBoolean(record.ipRestrict, 'ipRestrict'),
    enableReading: privateBoolean(record.enableReading, 'enableReading'),
    enableWithdrawals: privateBoolean(record.enableWithdrawals, 'enableWithdrawals'),
    enableInternalTransfer: privateBoolean(record.enableInternalTransfer, 'enableInternalTransfer'),
    enableMargin: privateBoolean(record.enableMargin, 'enableMargin'),
    enableFutures: privateBoolean(record.enableFutures, 'enableFutures'),
    permitsUniversalTransfer: privateBoolean(record.permitsUniversalTransfer, 'permitsUniversalTransfer'),
    enableVanillaOptions: privateBoolean(record.enableVanillaOptions, 'enableVanillaOptions'),
    enableFixApiTrade: privateBoolean(record.enableFixApiTrade, 'enableFixApiTrade'),
    enableFixReadOnly: privateBoolean(record.enableFixReadOnly, 'enableFixReadOnly'),
    enableSpotAndMarginTrading: privateBoolean(record.enableSpotAndMarginTrading, 'enableSpotAndMarginTrading'),
    enablePortfolioMarginTrading: privateBoolean(record.enablePortfolioMarginTrading, 'enablePortfolioMarginTrading'),
  };
  return Object.freeze(output);
}

function profile(value: unknown, expectedClass: PrivateProfileClass): Readonly<PrivatePermissionProfileInput> {
  const record = privateRecord(value, PROFILE_FIELDS, `${expectedClass} profile`);
  if (record.profileClass !== expectedClass) throw new TypeError('private permission profile class mismatch');
  if (record.environment !== 'PRODUCTION') throw new TypeError('private permission environment mismatch');
  if (!['Normal', 'ABNORMAL', 'UNKNOWN'].includes(String(record.accountStatus))) {
    throw new TypeError('private account status is invalid');
  }
  if (!['CROSS_CLASSIC', 'ISOLATED', 'UNKNOWN'].includes(String(record.marginMode))) {
    throw new TypeError('private Margin mode is invalid');
  }
  return deepFreezePrivate({
    profileClass: expectedClass,
    profileId: privateProfileReference(record.profileId, `${expectedClass}.profileId`),
    accountRealmId: privateAccountRealmReference(record.accountRealmId, `${expectedClass}.accountRealmId`),
    accountFingerprintRef: privateAccountFingerprintReference(record.accountFingerprintRef, `${expectedClass}.accountFingerprintRef`),
    environment: 'PRODUCTION' as const,
    deployedEgressMatch: nullableBoolean(record.deployedEgressMatch, `${expectedClass}.deployedEgressMatch`),
    permissions: permissionPayload(record.permissions),
    accountStatus: record.accountStatus as PrivatePermissionProfileInput['accountStatus'],
    apiTradingLocked: nullableBoolean(record.apiTradingLocked, `${expectedClass}.apiTradingLocked`),
    usdmDualSidePosition: nullableBoolean(record.usdmDualSidePosition, `${expectedClass}.usdmDualSidePosition`),
    usdmMultiAssetsMargin: nullableBoolean(record.usdmMultiAssetsMargin, `${expectedClass}.usdmMultiAssetsMargin`),
    marginMode: record.marginMode as PrivatePermissionProfileInput['marginMode'],
  });
}

function expectedExecutionPermissions(posture: PrivateTruthPosture): PermissionExpectation {
  switch (posture) {
    case 'SPOT_NEW_EXPOSURE':
      return { spotAndMarginTrading: true, margin: false, futures: false };
    case 'USDM_NEW_EXPOSURE':
      return { spotAndMarginTrading: false, margin: false, futures: true };
    case 'SPOT_USDM_NEW_EXPOSURE':
      return { spotAndMarginTrading: true, margin: false, futures: true };
    case 'MARGIN_NEW_EXPOSURE':
      return { spotAndMarginTrading: true, margin: true, futures: false };
    case 'SUPERVISION_ONLY':
      return { spotAndMarginTrading: false, margin: false, futures: false };
  }
}

function commonProfileReasons(profileInput: Readonly<PrivatePermissionProfileInput>): string[] {
  const reasons: string[] = [];
  const permissions = profileInput.permissions;
  if (!permissions.ipRestrict) reasons.push('FIXED_IP_RESTRICTION_MISSING');
  if (profileInput.deployedEgressMatch !== true) {
    reasons.push(profileInput.deployedEgressMatch === null
      ? 'DEPLOYED_EGRESS_MATCH_UNKNOWN'
      : 'DEPLOYED_EGRESS_MISMATCH');
  }
  if (profileInput.accountStatus !== 'Normal') reasons.push('ACCOUNT_STATUS_NOT_NORMAL');
  if (profileInput.apiTradingLocked !== false) {
    reasons.push(profileInput.apiTradingLocked === null
      ? 'API_TRADING_LOCK_STATUS_UNKNOWN'
      : 'API_TRADING_LOCKED');
  }
  if (permissions.enableWithdrawals) reasons.push('WITHDRAWALS_ENABLED');
  if (permissions.enableInternalTransfer) reasons.push('INTERNAL_TRANSFER_ENABLED');
  if (permissions.permitsUniversalTransfer) reasons.push('UNIVERSAL_TRANSFER_ENABLED');
  if (permissions.enablePortfolioMarginTrading) reasons.push('PORTFOLIO_MARGIN_UNSUPPORTED');
  if (permissions.enableVanillaOptions) reasons.push('UNREQUIRED_OPTIONS_PERMISSION_ENABLED');
  if (permissions.enableFixApiTrade) reasons.push('UNREQUIRED_FIX_TRADE_PERMISSION_ENABLED');
  if (permissions.enableFixReadOnly) reasons.push('UNREQUIRED_FIX_READ_PERMISSION_ENABLED');
  return reasons;
}

function readReasons(profileInput: Readonly<PrivatePermissionProfileInput>): string[] {
  const reasons = commonProfileReasons(profileInput);
  const permissions = profileInput.permissions;
  if (!permissions.enableReading) reasons.push('READ_PERMISSION_MISSING');
  if (permissions.enableSpotAndMarginTrading || permissions.enableMargin || permissions.enableFutures) {
    reasons.push('READ_PROFILE_HAS_EXECUTION_PERMISSION');
  }
  return reasons;
}

function executionReasons(
  posture: PrivateTruthPosture,
  profileInput: Readonly<PrivatePermissionProfileInput>,
): string[] {
  const reasons = commonProfileReasons(profileInput);
  const expected = expectedExecutionPermissions(posture);
  const permissions = profileInput.permissions;
  if (permissions.enableReading) {
    reasons.push('EXECUTION_PROFILE_HAS_READ_PERMISSION');
    reasons.push('COMBINED_PROFILE_OWNER_EXCEPTION_REQUIRED');
  }
  if (permissions.enableSpotAndMarginTrading !== expected.spotAndMarginTrading) {
    reasons.push(expected.spotAndMarginTrading
      ? 'SPOT_MARGIN_TRADE_PERMISSION_MISSING'
      : 'UNREQUIRED_SPOT_MARGIN_TRADE_PERMISSION_ENABLED');
  }
  if (permissions.enableMargin !== expected.margin) {
    reasons.push(expected.margin ? 'MARGIN_PERMISSION_MISSING' : 'UNREQUIRED_MARGIN_PERMISSION_ENABLED');
  }
  if (permissions.enableFutures !== expected.futures) {
    reasons.push(expected.futures ? 'FUTURES_PERMISSION_MISSING' : 'UNREQUIRED_FUTURES_PERMISSION_ENABLED');
  }
  return reasons;
}

function modeReasons(
  posture: PrivateTruthPosture,
  read: Readonly<PrivatePermissionProfileInput>,
  execution: Readonly<PrivatePermissionProfileInput>,
): string[] {
  const reasons: string[] = [];
  const needsUsdm = posture === 'USDM_NEW_EXPOSURE' || posture === 'SPOT_USDM_NEW_EXPOSURE';
  if (needsUsdm) {
    if (read.usdmDualSidePosition !== execution.usdmDualSidePosition) {
      reasons.push('USDM_POSITION_MODE_PROFILE_MISMATCH');
    }
    if (read.usdmMultiAssetsMargin !== execution.usdmMultiAssetsMargin) {
      reasons.push('USDM_ASSET_MODE_PROFILE_MISMATCH');
    }
    if (execution.usdmDualSidePosition !== false) {
      reasons.push(execution.usdmDualSidePosition === null
        ? 'USDM_POSITION_MODE_UNKNOWN'
        : 'USDM_HEDGE_MODE_UNSUPPORTED');
    }
    if (execution.usdmMultiAssetsMargin !== false) {
      reasons.push(execution.usdmMultiAssetsMargin === null
        ? 'USDM_ASSET_MODE_UNKNOWN'
        : 'USDM_MULTI_ASSETS_UNSUPPORTED');
    }
  }
  if (posture === 'MARGIN_NEW_EXPOSURE') {
    if (read.marginMode !== execution.marginMode) reasons.push('MARGIN_MODE_PROFILE_MISMATCH');
    if (execution.marginMode === 'UNKNOWN') reasons.push('MARGIN_MODE_UNKNOWN');
    if (execution.marginMode === 'ISOLATED') reasons.push('ISOLATED_MARGIN_SYMBOL_IDENTITY_UNAVAILABLE');
  }
  return reasons;
}

function decision(
  posture: PrivateTruthPosture,
  profileInput: Readonly<PrivatePermissionProfileInput>,
  reasons: readonly string[],
): Readonly<PrivatePermissionDecision> {
  const reasonCodes = privateSortedUnique(reasons);
  const semantic = {
    posture,
    profileClass: profileInput.profileClass,
    profileId: profileInput.profileId,
    accountRealmId: profileInput.accountRealmId,
    accountFingerprintRef: profileInput.accountFingerprintRef,
    environment: profileInput.environment,
    deployedEgressMatch: profileInput.deployedEgressMatch,
    permissions: profileInput.permissions,
    accountStatus: profileInput.accountStatus,
    apiTradingLocked: profileInput.apiTradingLocked,
    usdmDualSidePosition: profileInput.usdmDualSidePosition,
    usdmMultiAssetsMargin: profileInput.usdmMultiAssetsMargin,
    marginMode: profileInput.marginMode,
    reasonCodes,
  };
  return deepFreezePrivate({
    profileClass: profileInput.profileClass,
    profileId: profileInput.profileId,
    accountRealmId: profileInput.accountRealmId,
    accountFingerprintRef: profileInput.accountFingerprintRef,
    environment: profileInput.environment,
    deployedEgressMatch: profileInput.deployedEgressMatch,
    permissions: profileInput.permissions,
    accountStatus: profileInput.accountStatus,
    apiTradingLocked: profileInput.apiTradingLocked,
    usdmDualSidePosition: profileInput.usdmDualSidePosition,
    usdmMultiAssetsMargin: profileInput.usdmMultiAssetsMargin,
    marginMode: profileInput.marginMode,
    posture,
    acceptableForOwnerReview: reasonCodes.length === 0,
    reasonCodes,
    revision: revision('l05perm_', semantic),
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}

/**
 * Projects two distinct owner profile references. A passing decision is only
 * evidence for later owner review; it grants no account read or action.
 */
export function evaluatePrivatePermissions(
  inputValue: unknown,
): readonly Readonly<PrivatePermissionDecision>[] {
  const input = privateRecord(snapshotPrivateData(inputValue), INPUT_FIELDS, 'permission evaluation');
  if (input.matrixSha256 !== L05_BINANCE_MATRIX_SHA256) {
    throw new TypeError('private permission matrix SHA mismatch');
  }
  const posture = postureValue(input.posture);
  const accountRealmId = privateAccountRealmReference(input.accountRealmId, 'accountRealmId');
  const accountFingerprintRef = privateAccountFingerprintReference(input.accountFingerprintRef, 'accountFingerprintRef');
  const read = profile(input.readProfile, 'READ_KEY');
  const execution = profile(input.executionProfile, 'EXECUTION_KEY');

  const shared: string[] = [];
  if (read.profileId === execution.profileId) shared.push('COMBINED_PROFILE_OWNER_EXCEPTION_REQUIRED');
  if (read.accountRealmId !== accountRealmId || execution.accountRealmId !== accountRealmId) {
    shared.push('ACCOUNT_REALM_MISMATCH');
  }
  if (read.accountFingerprintRef !== accountFingerprintRef
    || execution.accountFingerprintRef !== accountFingerprintRef
    || read.accountFingerprintRef !== execution.accountFingerprintRef) {
    shared.push('ACCOUNT_FINGERPRINT_MISMATCH');
  }
  shared.push(...modeReasons(posture, read, execution));

  return Object.freeze([
    decision(posture, read, [...shared, ...readReasons(read)]),
    decision(posture, execution, [...shared, ...executionReasons(posture, execution)]),
  ]);
}
