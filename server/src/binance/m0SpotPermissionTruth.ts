/**
 * Pure M0 projection over the canonical Binance private-permission owner.
 *
 * This module does not decode Binance payloads, read credentials, call a
 * private endpoint, or grant execution authority. It accepts one digest-bound
 * evidence envelope whose permission rows must reproduce the canonical
 * `binancePrivateTruth` decisions byte-for-byte.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from '../foundation/contracts/identity.js';
import {
  deepFreezePrivate,
  privateRecord,
  snapshotPrivateData,
} from '../liveEdge/adapters/binancePrivateTruth/bounds.js';
import {
  L05_BINANCE_MATRIX_SHA256,
} from '../liveEdge/adapters/binancePrivateTruth/contracts.js';
import {
  evaluatePrivatePermissions,
} from '../liveEdge/adapters/binancePrivateTruth/permissions.js';
import {
  NO_PRIVATE_ACTION_AUTHORITY,
  type NoPrivateActionAuthority,
  type PrivatePermissionDecision,
  type PrivatePermissionPayload,
} from '../liveEdge/adapters/binancePrivateTruth/types.js';

export const M0_SPOT_PERMISSION_ENVELOPE_SCHEMA =
  'cosmos.binance.m0-spot-permission-envelope.v1' as const;
export const M0_SPOT_PERMISSION_TRUTH_SCHEMA =
  'cosmos.binance.m0-spot-permission-truth.v2' as const;

const ENVELOPE_FIELDS = Object.freeze([
  'schema',
  'version',
  'accountRealmId',
  'accountFingerprintRef',
  'permissionDecisions',
  'accountCanTradeEvidence',
  'readSignerEvidence',
  'executionSignerEvidence',
  'evidenceDigest',
] as const);

const ACCOUNT_CAN_TRADE_FIELDS = Object.freeze([
  'profileId',
  'accountRealmId',
  'accountFingerprintRef',
  'permissionRevision',
  'canTrade',
  'evidenceRevision',
  'observedAtMs',
  'validUntilMs',
] as const);

const SIGNER_FIELDS = Object.freeze([
  'endpointClass',
  'profileId',
  'accountRealmId',
  'accountFingerprintRef',
  'permissionRevision',
  'signerFingerprint',
  'signerRevision',
  'observedAtMs',
  'validUntilMs',
] as const);

const PROFILE_FIELDS = Object.freeze([
  'profileClass',
  'profileId',
  'accountRealmId',
  'accountFingerprintRef',
  'environment',
  'deployedEgressMatch',
  'permissions',
  'accountStatus',
  'apiTradingLocked',
  'usdmDualSidePosition',
  'usdmMultiAssetsMargin',
  'marginMode',
] as const);

const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;

export interface M0SpotAccountCanTradeEvidence {
  readonly profileId: string;
  readonly accountRealmId: string;
  readonly accountFingerprintRef: string;
  readonly permissionRevision: string;
  readonly canTrade: boolean;
  readonly evidenceRevision: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

export interface M0SpotSignerEvidence {
  readonly endpointClass: 'USER_DATA' | 'TRADE';
  readonly profileId: string;
  readonly accountRealmId: string;
  readonly accountFingerprintRef: string;
  readonly permissionRevision: string;
  readonly signerFingerprint: `sha256:${string}`;
  readonly signerRevision: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
}

export interface M0SpotPermissionEnvelopeContent {
  readonly schema: typeof M0_SPOT_PERMISSION_ENVELOPE_SCHEMA;
  readonly version: 1;
  readonly accountRealmId: string;
  readonly accountFingerprintRef: string;
  readonly permissionDecisions:
    readonly Readonly<PrivatePermissionDecision>[];
  readonly accountCanTradeEvidence:
    Readonly<M0SpotAccountCanTradeEvidence>;
  readonly readSignerEvidence:
    Readonly<M0SpotSignerEvidence>;
  readonly executionSignerEvidence:
    Readonly<M0SpotSignerEvidence>;
}

export interface M0SpotPermissionEnvelope
extends M0SpotPermissionEnvelopeContent {
  readonly evidenceDigest: `sha256:${string}`;
}

export interface M0SpotPermissionTruth
extends NoPrivateActionAuthority {
  readonly schema: typeof M0_SPOT_PERMISSION_TRUTH_SCHEMA;
  readonly version: 2;
  readonly state: 'VERIFIED' | 'BLOCKED';
  readonly posture: 'SPOT_NEW_EXPOSURE';
  readonly evidenceDigest: `sha256:${string}`;
  readonly evaluatedAtMs: number;
  readonly validUntilMs: number;
  readonly accountRealmId: string;
  readonly accountFingerprintRef: string;
  readonly readProfile: Readonly<{
    profileId: string;
    permissionRevision: string;
  }>;
  readonly executionProfile: Readonly<{
    profileId: string;
    permissionRevision: string;
  }>;
  /** Exact endpoint-class fingerprints; never API-key material. */
  readonly readApiKeyFingerprint: `sha256:${string}`;
  readonly executionApiKeyFingerprint: `sha256:${string}`;
  /**
   * Compatibility facts projected from two canonical profiles. `readingEnabled`
   * names only the READ_KEY; `keySpotTradeEnabled` names only EXECUTION_KEY.
   */
  readonly accountCanTrade: boolean;
  readonly keySpotTradeEnabled: boolean;
  readonly withdrawalsEnabled: boolean;
  readonly internalTransfersEnabled: boolean;
  readonly universalTransfersEnabled: boolean;
  readonly marginEnabled: boolean;
  readonly futuresEnabled: boolean;
  readonly readingEnabled: boolean;
  readonly ipRestricted: boolean;
  readonly accountCanTradeEvidence:
    Readonly<M0SpotAccountCanTradeEvidence>;
  readonly readSignerEvidence:
    Readonly<M0SpotSignerEvidence>;
  readonly executionSignerEvidence:
    Readonly<M0SpotSignerEvidence>;
  readonly reasonCodes: readonly string[];
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/**
 * Digest the complete inert evidence envelope before adding `evidenceDigest`.
 */
export function calculateM0SpotPermissionEnvelopeDigest(
  value: Readonly<M0SpotPermissionEnvelopeContent>,
): `sha256:${string}` {
  return sha256(`m0-spot-permission-envelope|${canonicalJson(value)}`);
}

function safeTime(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function boundedRevision(value: unknown, label: string): string {
  if (typeof value !== 'string' || !REVISION.test(value)) {
    throw new TypeError(`${label} must be a bounded revision`);
  }
  return value;
}

function boundedReference(value: unknown, label: string): string {
  if (typeof value !== 'string' || !REVISION.test(value)) {
    throw new TypeError(`${label} must be a bounded reference`);
  }
  return value;
}

function profileFromDecision(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(
    PROFILE_FIELDS.map((field) => [field, value[field]]),
  ));
}

function canonicalPermissionDecisions(
  values: unknown,
  accountRealmId: string,
  accountFingerprintRef: string,
): readonly Readonly<PrivatePermissionDecision>[] {
  if (!Array.isArray(values) || values.length !== 2) {
    throw new TypeError('M0 requires exactly two permission decisions');
  }
  const read = values[0];
  const execution = values[1];
  if (read === null || typeof read !== 'object' || Array.isArray(read)
    || execution === null || typeof execution !== 'object'
    || Array.isArray(execution)) {
    throw new TypeError('M0 permission decisions must be records');
  }
  const readRecord = read as Readonly<Record<string, unknown>>;
  const executionRecord = execution as Readonly<Record<string, unknown>>;
  if (readRecord.profileClass !== 'READ_KEY'
    || executionRecord.profileClass !== 'EXECUTION_KEY') {
    throw new TypeError(
      'M0 permission decisions must be ordered READ_KEY then EXECUTION_KEY',
    );
  }

  const regenerated = evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: readRecord.posture,
    accountRealmId,
    accountFingerprintRef,
    readProfile: profileFromDecision(readRecord),
    executionProfile: profileFromDecision(executionRecord),
  });
  if (canonicalJson(values) !== canonicalJson(regenerated)) {
    throw new TypeError(
      'M0 permission decisions do not reproduce canonical private truth',
    );
  }
  return regenerated;
}

function accountCanTradeEvidence(
  value: unknown,
): Readonly<M0SpotAccountCanTradeEvidence> {
  const row = privateRecord(
    value,
    ACCOUNT_CAN_TRADE_FIELDS,
    'M0 account canTrade evidence',
  );
  if (typeof row.canTrade !== 'boolean') {
    throw new TypeError('M0 account canTrade evidence must be boolean');
  }
  return Object.freeze({
    profileId: boundedReference(row.profileId, 'M0 read profile'),
    accountRealmId: boundedReference(
      row.accountRealmId,
      'M0 account realm',
    ),
    accountFingerprintRef: boundedReference(
      row.accountFingerprintRef,
      'M0 account fingerprint',
    ),
    permissionRevision: boundedRevision(
      row.permissionRevision,
      'M0 read permission revision',
    ),
    canTrade: row.canTrade,
    evidenceRevision: boundedRevision(
      row.evidenceRevision,
      'M0 account canTrade evidence revision',
    ),
    observedAtMs: safeTime(
      row.observedAtMs,
      'M0 account canTrade observation time',
    ),
    validUntilMs: safeTime(
      row.validUntilMs,
      'M0 account canTrade validity time',
    ),
  });
}

function signerEvidence(
  value: unknown,
  label: string,
): Readonly<M0SpotSignerEvidence> {
  const row = privateRecord(
    value,
    SIGNER_FIELDS,
    `M0 ${label} signer evidence`,
  );
  if (row.endpointClass !== 'USER_DATA'
    && row.endpointClass !== 'TRADE') {
    throw new TypeError(`M0 ${label} signer endpoint class is invalid`);
  }
  if (typeof row.signerFingerprint !== 'string'
    || !SHA256_FINGERPRINT.test(row.signerFingerprint)) {
    throw new TypeError(`M0 ${label} signer fingerprint is malformed`);
  }
  return Object.freeze({
    endpointClass: row.endpointClass,
    profileId: boundedReference(row.profileId, `M0 ${label} profile`),
    accountRealmId: boundedReference(
      row.accountRealmId,
      'M0 account realm',
    ),
    accountFingerprintRef: boundedReference(
      row.accountFingerprintRef,
      'M0 account fingerprint',
    ),
    permissionRevision: boundedRevision(
      row.permissionRevision,
      `M0 ${label} permission revision`,
    ),
    signerFingerprint:
      row.signerFingerprint as `sha256:${string}`,
    signerRevision: boundedRevision(
      row.signerRevision,
      `M0 ${label} signer revision`,
    ),
    observedAtMs: safeTime(
      row.observedAtMs,
      `M0 ${label} signer observation time`,
    ),
    validUntilMs: safeTime(
      row.validUntilMs,
      `M0 ${label} signer validity time`,
    ),
  });
}

function commonProfileReasons(
  prefix: 'READ' | 'EXECUTION',
  decision: Readonly<PrivatePermissionDecision>,
  reasons: string[],
): void {
  const permissions = decision.permissions;
  if (decision.environment !== 'PRODUCTION') {
    reasons.push(`${prefix}_PROFILE_NOT_PRODUCTION`);
  }
  if (decision.deployedEgressMatch !== true) {
    reasons.push(`${prefix}_DEPLOYED_EGRESS_NOT_MATCHED`);
  }
  if (decision.accountStatus !== 'Normal') {
    reasons.push(`${prefix}_ACCOUNT_STATUS_NOT_NORMAL`);
  }
  if (decision.apiTradingLocked !== false) {
    reasons.push(`${prefix}_API_TRADING_NOT_UNLOCKED`);
  }
  if (permissions.ipRestrict !== true) {
    reasons.push(`${prefix}_FIXED_IP_RESTRICTION_MISSING`);
  }
  for (const [field, suffix] of [
    ['enableWithdrawals', 'WITHDRAWALS_ENABLED'],
    ['enableInternalTransfer', 'INTERNAL_TRANSFER_ENABLED'],
    ['permitsUniversalTransfer', 'UNIVERSAL_TRANSFER_ENABLED'],
    ['enableMargin', 'MARGIN_ENABLED'],
    ['enableFutures', 'FUTURES_ENABLED'],
    ['enableVanillaOptions', 'OPTIONS_ENABLED'],
    ['enableFixApiTrade', 'FIX_TRADE_ENABLED'],
    ['enableFixReadOnly', 'FIX_READ_ENABLED'],
    ['enablePortfolioMarginTrading', 'PORTFOLIO_MARGIN_ENABLED'],
  ] as const satisfies readonly [
    keyof PrivatePermissionPayload,
    string,
  ][]) {
    if (permissions[field] !== false) reasons.push(`${prefix}_${suffix}`);
  }
}

function permissionReasons(
  read: Readonly<PrivatePermissionDecision>,
  execution: Readonly<PrivatePermissionDecision>,
): string[] {
  const reasons: string[] = [];
  if (read.posture !== 'SPOT_NEW_EXPOSURE'
    || execution.posture !== 'SPOT_NEW_EXPOSURE') {
    reasons.push('POSTURE_NOT_SPOT_NEW_EXPOSURE');
  }
  if (read.profileId === execution.profileId) {
    reasons.push('COMBINED_PROFILE_BLOCKED');
  }
  if (read.accountRealmId !== execution.accountRealmId) {
    reasons.push('PROFILE_ACCOUNT_REALM_MISMATCH');
  }
  if (read.accountFingerprintRef !== execution.accountFingerprintRef) {
    reasons.push('PROFILE_ACCOUNT_FINGERPRINT_MISMATCH');
  }
  if (!read.acceptableForOwnerReview || read.reasonCodes.length !== 0) {
    reasons.push('READ_PERMISSION_DECISION_NOT_ACCEPTABLE');
    reasons.push(...read.reasonCodes.map((reason) => `READ_KEY_${reason}`));
  }
  if (!execution.acceptableForOwnerReview
    || execution.reasonCodes.length !== 0) {
    reasons.push('EXECUTION_PERMISSION_DECISION_NOT_ACCEPTABLE');
    reasons.push(
      ...execution.reasonCodes.map(
        (reason) => `EXECUTION_KEY_${reason}`,
      ),
    );
  }

  commonProfileReasons('READ', read, reasons);
  commonProfileReasons('EXECUTION', execution, reasons);
  if (read.permissions.enableReading !== true) {
    reasons.push('READ_PROFILE_READING_DISABLED');
  }
  if (read.permissions.enableSpotAndMarginTrading !== false) {
    reasons.push('READ_PROFILE_NOT_READ_ONLY');
  }
  if (execution.permissions.enableReading !== false) {
    reasons.push('EXECUTION_PROFILE_READING_ENABLED');
  }
  if (execution.permissions.enableSpotAndMarginTrading !== true) {
    reasons.push('EXECUTION_PROFILE_SPOT_TRADING_DISABLED');
  }
  return reasons;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

/**
 * Project a current M0 permission truth from one canonical, digest-bound
 * evidence envelope. Malformed or non-canonical input throws; valid but
 * unsuitable evidence returns `BLOCKED`. Neither outcome grants authority.
 */
export function projectM0SpotPermissionTruth(
  inputValue: unknown,
  evaluatedAtMsValue: number,
): Readonly<M0SpotPermissionTruth> {
  const evaluatedAtMs = safeTime(
    evaluatedAtMsValue,
    'M0 permission evaluation time',
  );
  const input = privateRecord(
    snapshotPrivateData(inputValue),
    ENVELOPE_FIELDS,
    'M0 permission envelope',
  );
  if (input.schema !== M0_SPOT_PERMISSION_ENVELOPE_SCHEMA
    || input.version !== 1) {
    throw new TypeError('M0 permission envelope schema is unsupported');
  }
  const accountRealmId = boundedReference(
    input.accountRealmId,
    'M0 account realm',
  );
  const accountFingerprintRef = boundedReference(
    input.accountFingerprintRef,
    'M0 account fingerprint',
  );
  if (typeof input.evidenceDigest !== 'string'
    || !SHA256_FINGERPRINT.test(input.evidenceDigest)) {
    throw new TypeError('M0 permission envelope digest is malformed');
  }
  const rawContent = {
    schema: input.schema,
    version: input.version,
    accountRealmId: input.accountRealmId,
    accountFingerprintRef: input.accountFingerprintRef,
    permissionDecisions: input.permissionDecisions,
    accountCanTradeEvidence: input.accountCanTradeEvidence,
    readSignerEvidence: input.readSignerEvidence,
    executionSignerEvidence: input.executionSignerEvidence,
  } as Readonly<M0SpotPermissionEnvelopeContent>;
  if (input.evidenceDigest
    !== calculateM0SpotPermissionEnvelopeDigest(rawContent)) {
    throw new TypeError('M0 permission envelope digest mismatch');
  }
  const decisions = canonicalPermissionDecisions(
    input.permissionDecisions,
    accountRealmId,
    accountFingerprintRef,
  );
  const read = decisions[0];
  const execution = decisions[1];
  if (read === undefined || execution === undefined) {
    throw new TypeError('M0 canonical permission decisions are incomplete');
  }
  const canTrade = accountCanTradeEvidence(
    input.accountCanTradeEvidence,
  );
  const readSigner = signerEvidence(
    input.readSignerEvidence,
    'read',
  );
  const executionSigner = signerEvidence(
    input.executionSignerEvidence,
    'execution',
  );
  const content: M0SpotPermissionEnvelopeContent = {
    schema: M0_SPOT_PERMISSION_ENVELOPE_SCHEMA,
    version: 1,
    accountRealmId,
    accountFingerprintRef,
    permissionDecisions: decisions,
    accountCanTradeEvidence: canTrade,
    readSignerEvidence: readSigner,
    executionSignerEvidence: executionSigner,
  };
  const expectedDigest =
    calculateM0SpotPermissionEnvelopeDigest(content);
  if (input.evidenceDigest !== expectedDigest) {
    throw new TypeError('M0 permission envelope digest mismatch');
  }

  const reasons = permissionReasons(read, execution);
  if (read.accountRealmId !== accountRealmId
    || execution.accountRealmId !== accountRealmId) {
    reasons.push('ENVELOPE_ACCOUNT_REALM_MISMATCH');
  }
  if (read.accountFingerprintRef !== accountFingerprintRef
    || execution.accountFingerprintRef !== accountFingerprintRef) {
    reasons.push('ENVELOPE_ACCOUNT_FINGERPRINT_MISMATCH');
  }
  if (canTrade.profileId !== read.profileId
    || canTrade.accountRealmId !== accountRealmId
    || canTrade.accountFingerprintRef !== accountFingerprintRef
    || canTrade.permissionRevision !== read.revision) {
    reasons.push('ACCOUNT_CAN_TRADE_BINDING_MISMATCH');
  }
  if (!canTrade.canTrade) reasons.push('ACCOUNT_CAN_TRADE_FALSE');
  if (canTrade.observedAtMs > evaluatedAtMs) {
    reasons.push('ACCOUNT_CAN_TRADE_EVIDENCE_FROM_FUTURE');
  }
  if (canTrade.validUntilMs <= evaluatedAtMs
    || canTrade.validUntilMs <= canTrade.observedAtMs) {
    reasons.push('ACCOUNT_CAN_TRADE_EVIDENCE_NOT_CURRENT');
  }
  if (readSigner.endpointClass !== 'USER_DATA'
    || readSigner.profileId !== read.profileId
    || readSigner.accountRealmId !== accountRealmId
    || readSigner.accountFingerprintRef !== accountFingerprintRef
    || readSigner.permissionRevision !== read.revision) {
    reasons.push('READ_SIGNER_BINDING_MISMATCH');
  }
  if (readSigner.observedAtMs > evaluatedAtMs) {
    reasons.push('READ_SIGNER_EVIDENCE_FROM_FUTURE');
  }
  if (readSigner.validUntilMs <= evaluatedAtMs
    || readSigner.validUntilMs <= readSigner.observedAtMs) {
    reasons.push('READ_SIGNER_EVIDENCE_NOT_CURRENT');
  }
  if (executionSigner.endpointClass !== 'TRADE'
    || executionSigner.profileId !== execution.profileId
    || executionSigner.accountRealmId !== accountRealmId
    || executionSigner.accountFingerprintRef !== accountFingerprintRef
    || executionSigner.permissionRevision !== execution.revision) {
    reasons.push('EXECUTION_SIGNER_BINDING_MISMATCH');
  }
  if (executionSigner.observedAtMs > evaluatedAtMs) {
    reasons.push('EXECUTION_SIGNER_EVIDENCE_FROM_FUTURE');
  }
  if (executionSigner.validUntilMs <= evaluatedAtMs
    || executionSigner.validUntilMs
      <= executionSigner.observedAtMs) {
    reasons.push('EXECUTION_SIGNER_EVIDENCE_NOT_CURRENT');
  }
  if (readSigner.signerFingerprint
    === executionSigner.signerFingerprint) {
    reasons.push('COMBINED_SIGNER_FINGERPRINT_BLOCKED');
  }

  const reasonCodes = sortedUnique(reasons);
  return deepFreezePrivate({
    schema: M0_SPOT_PERMISSION_TRUTH_SCHEMA,
    version: 2 as const,
    state: reasonCodes.length === 0
      ? 'VERIFIED' as const
      : 'BLOCKED' as const,
    posture: 'SPOT_NEW_EXPOSURE' as const,
    evidenceDigest: expectedDigest,
    evaluatedAtMs,
    validUntilMs: Math.min(
      canTrade.validUntilMs,
      readSigner.validUntilMs,
      executionSigner.validUntilMs,
    ),
    accountRealmId,
    accountFingerprintRef,
    readProfile: {
      profileId: read.profileId,
      permissionRevision: read.revision,
    },
    executionProfile: {
      profileId: execution.profileId,
      permissionRevision: execution.revision,
    },
    readApiKeyFingerprint: readSigner.signerFingerprint,
    executionApiKeyFingerprint:
      executionSigner.signerFingerprint,
    accountCanTrade: canTrade.canTrade,
    keySpotTradeEnabled:
      execution.permissions.enableSpotAndMarginTrading,
    withdrawalsEnabled:
      read.permissions.enableWithdrawals
      || execution.permissions.enableWithdrawals,
    internalTransfersEnabled:
      read.permissions.enableInternalTransfer
      || execution.permissions.enableInternalTransfer,
    universalTransfersEnabled:
      read.permissions.permitsUniversalTransfer
      || execution.permissions.permitsUniversalTransfer,
    marginEnabled:
      read.permissions.enableMargin
      || execution.permissions.enableMargin,
    futuresEnabled:
      read.permissions.enableFutures
      || execution.permissions.enableFutures,
    readingEnabled: read.permissions.enableReading,
    ipRestricted:
      read.permissions.ipRestrict
      && execution.permissions.ipRestrict,
    accountCanTradeEvidence: canTrade,
    readSignerEvidence: readSigner,
    executionSignerEvidence: executionSigner,
    reasonCodes,
    ...NO_PRIVATE_ACTION_AUTHORITY,
  });
}
