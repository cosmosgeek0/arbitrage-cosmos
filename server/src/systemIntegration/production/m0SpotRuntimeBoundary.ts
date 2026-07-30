/**
 * Existing-surface boundary for the exact M0 production executor.
 *
 * The default production composition injects no executor and stays disarmed.
 * HTTP supplies only an actor-bound request identity and a frozen card digest;
 * every executable ticket, amount, symbol, action authority, signer, and
 * credential remains server-held behind the injected execution port.
 */
import { types as nodeUtilTypes } from 'node:util';

import {
  M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE,
  M0_SPOT_READINESS_MAX_FRESHNESS_MS,
  calculateM0SpotReadinessDigest,
  exactM0SpotMinimumPermissionTransition,
  projectM0SpotSourceReadinessCard,
  type M0SpotReadinessCard,
} from '../evidence/m0SpotReadinessCard.js';
import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
} from '../../foundation/exchange/binanceSpot/filters.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../../foundation/risk/spotRiskPolicy.js';
import {
  M0_SPOT_ACTION_ALLOWLIST,
  M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS,
  M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
} from '../../foundation/execution/m0SpotLifecycleCard.js';

export const M0_SPOT_RUNTIME_BOUNDARY_SCHEMA =
  'cosmos.system-integration.m0-spot-runtime-boundary.v1' as const;

export interface M0SpotRuntimeExecutionInput {
  readonly requestId: `m0_req_${string}`;
  readonly idempotencyKeyDigest: `sha256:${string}`;
  readonly operatorId: string;
  readonly cardDigest: `sha256:${string}`;
  readonly ownerConfirmation: 'YES';
  readonly action: 'EXECUTE_APPROVED_LIFECYCLE';
}

export interface M0SpotApprovedLifecycleExecutionInput
extends M0SpotRuntimeExecutionInput {
  /** Derived from the digest-verified readiness card, never from HTTP. */
  readonly lifecycleCardDigest: `sha256:${string}`;
  /** Recomputed by the executor from its exact server-held entry evidence. */
  readonly executableEntryEvidenceDigest: `sha256:${string}`;
  /** The complete digest-verified server-held §7 card, never from HTTP. */
  readonly readinessCard: Readonly<M0SpotReadinessCard>;
}

export interface M0SpotRuntimeExecutionResult {
  readonly schema: typeof M0_SPOT_RUNTIME_BOUNDARY_SCHEMA;
  readonly ok: boolean;
  readonly code:
    | 'M0_RUNTIME_NOT_CONFIGURED'
    | 'M0_CARD_NOT_READY'
    | 'M0_LIFECYCLE_ACCEPTED'
    | 'M0_LIFECYCLE_RECOVERY_REQUIRED'
    | 'M0_LIFECYCLE_RECONCILED';
  readonly state:
    | 'DISARMED'
    | 'ARMED'
    | 'RECOVERY_REQUIRED'
    | 'DISARMED_SAFE';
  readonly cardDigest: `sha256:${string}`;
  readonly ownerConfirmation: 'EXACT_CARD_ACKNOWLEDGED';
  readonly queryBeforeRetry: true;
  readonly blindResend: false;
  readonly executionAuthorityReturned: 'NONE';
  readonly effects: Readonly<{
    privateCalls: number;
    signatures: number;
    transportCalls: number;
    authorityConsumptions: number;
    ledgerWrites: number;
    orders: number;
    moneyMutations: number;
  }>;
}

export interface M0SpotApprovedLifecycleExecutionPort {
  execute(
    input: Readonly<M0SpotApprovedLifecycleExecutionInput>,
  ): Promise<Readonly<M0SpotRuntimeExecutionResult>>;
}

export interface M0SpotRuntimeBoundaryPort {
  readReadinessCard(): Promise<Readonly<M0SpotReadinessCard>>;
  executeApprovedLifecycle(
    input: Readonly<M0SpotRuntimeExecutionInput>,
  ): Promise<Readonly<M0SpotRuntimeExecutionResult>>;
}

export interface M0SpotRuntimeBoundaryClock {
  nowMs(): number;
}

export interface M0SpotRuntimeReadinessPort {
  read(): Promise<Readonly<M0SpotReadinessCard>>;
}

const RUNTIME_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/u;
const SYMBOL = /^[A-Z0-9]{4,20}$/u;
const ASSET = /^[A-Z0-9]{1,16}$/u;
const TICKET_ID = /^spt_[0-9a-f]{32}$/u;
const TICKET_TERMS = /^[0-9a-f]{32}$/u;
const CLIENT_ORDER_ID = /^[A-Za-z0-9_-]{1,36}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EXACT_REVISION = /^[0-9a-f]{40}$/u;
const MAX_EXPOSURE_DURATION_MS = 15 * 60_000;
const RUNTIME_INPUT_FIELDS = Object.freeze([
  'requestId',
  'idempotencyKeyDigest',
  'operatorId',
  'cardDigest',
  'ownerConfirmation',
  'action',
] as const);
const REQUIRED_LEDGER_EVENTS = Object.freeze([
  'INTENT',
  'REQUEST',
  'RESPONSE',
  'FILL',
  'CANCEL',
  'RECOVERY',
  'FINAL_STATE',
] as const);
const RUNTIME_RESULT_FIELDS = Object.freeze([
  'schema',
  'ok',
  'code',
  'state',
  'cardDigest',
  'ownerConfirmation',
  'queryBeforeRetry',
  'blindResend',
  'executionAuthorityReturned',
  'effects',
] as const);
const RUNTIME_EFFECT_FIELDS = Object.freeze([
  'privateCalls',
  'signatures',
  'transportCalls',
  'authorityConsumptions',
  'ledgerWrites',
  'orders',
  'moneyMutations',
] as const);
const MAX_RUNTIME_EFFECT_COUNT = 1_000_000;

function zeroEffects(): M0SpotRuntimeExecutionResult['effects'] {
  return Object.freeze({
    privateCalls: 0,
    signatures: 0,
    transportCalls: 0,
    authorityConsumptions: 0,
    ledgerWrites: 0,
    orders: 0,
    moneyMutations: 0,
  });
}

function exactIstTimestamp(value: number): string {
  return new Date(value + (5.5 * 60 * 60 * 1_000))
    .toISOString()
    .replace(/Z$/u, '+05:30');
}

function currentEvidence(
  observedAtMs: number | null,
  validUntilMs: number | null,
  evidenceRevision: string | null,
  cardObservedAtMs: number,
  cardValidUntilMs: number,
): boolean {
  return (
    observedAtMs !== null
    && validUntilMs !== null
    && Number.isSafeInteger(observedAtMs)
    && Number.isSafeInteger(validUntilMs)
    && observedAtMs >= 0
    && observedAtMs <= cardObservedAtMs
    && cardObservedAtMs - observedAtMs
      <= M0_SPOT_READINESS_MAX_FRESHNESS_MS
    && validUntilMs >= cardValidUntilMs
    && validUntilMs > cardObservedAtMs
    && validUntilMs - observedAtMs
      <= M0_SPOT_READINESS_MAX_FRESHNESS_MS
    && RUNTIME_IDENTITY.test(evidenceRevision ?? '')
  );
}

function nonNegativeDecimal(
  value: string | null,
  label: string,
): string | null {
  if (value === null) return null;
  const normalized = normalizeSpotDecimal(value, label);
  return (
    normalized === value
    && compareSpotDecimals(normalized, '0') >= 0
  ) ? normalized : null;
}

function positiveDecimal(
  value: string | null,
  label: string,
): string | null {
  const normalized = nonNegativeDecimal(value, label);
  return normalized !== null && compareSpotDecimals(normalized, '0') > 0
    ? normalized
    : null;
}

function decimalScale(value: string): number {
  const point = value.indexOf('.');
  return point < 0 ? 0 : value.length - point - 1;
}

function decimalCoefficient(value: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
}

function alignedToStep(value: string, step: string): boolean {
  const scale = Math.max(decimalScale(value), decimalScale(step));
  const stepCoefficient = decimalCoefficient(step, scale);
  return (
    stepCoefficient > 0n
    && decimalCoefficient(value, scale) % stepCoefficient === 0n
  );
}

function closedDataTree(root: unknown): boolean {
  const pending: unknown[] = [root];
  const seen = new Set<object>();
  let nodes = 0;
  let stringCharacters = 0;
  try {
    while (pending.length > 0) {
      const value = pending.pop();
      nodes += 1;
      if (nodes > 2_000) return false;
      if (typeof value === 'string') {
        stringCharacters += value.length;
        if (stringCharacters > 100_000) return false;
        continue;
      }
      if (value === null || typeof value !== 'object') continue;
      if (nodeUtilTypes.isProxy(value) || seen.has(value)) return false;
      seen.add(value);
      const prototype = Object.getPrototypeOf(value);
      if (
        prototype !== Object.prototype
        && prototype !== null
        && prototype !== Array.prototype
      ) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') return false;
        const descriptor = descriptors[key];
        if (
          descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) return false;
        if (Array.isArray(value) && key === 'length') continue;
        if (descriptor.enumerable !== true) return false;
        pending.push(descriptor.value);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function freezeDataTree<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        freezeDataTree(descriptor.value);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function snapshotReadinessCard(
  value: unknown,
): Readonly<M0SpotReadinessCard> | null {
  try {
    if (!closedDataTree(value)) return null;
    return freezeDataTree(
      structuredClone(value),
    ) as Readonly<M0SpotReadinessCard>;
  } catch {
    return null;
  }
}

function frozenDataTree(root: unknown): boolean {
  const pending: unknown[] = [root];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value) || !Object.isFrozen(value)) return false;
    seen.add(value);
    for (const descriptor of Object.values(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        pending.push(descriptor.value);
      }
    }
  }
  return true;
}

function sameCardShape(value: unknown, template: unknown): boolean {
  if (template === null) return value !== undefined;
  if (Array.isArray(template)) return Array.isArray(value);
  if (typeof template !== 'object') {
    return value === null || typeof value !== 'object';
  }
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) return false;
  const valueKeys = Object.keys(value);
  const templateKeys = Object.keys(template);
  return (
    valueKeys.length === templateKeys.length
    && templateKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
      && sameCardShape(
        (value as Readonly<Record<string, unknown>>)[key],
        (template as Readonly<Record<string, unknown>>)[key],
      ),
    )
  );
}

export function validateM0SpotReadyCard(
  input: unknown,
  acknowledgedDigest: `sha256:${string}`,
  nowMs: number,
): input is Readonly<M0SpotReadinessCard> & Readonly<{
  lifecycleCardDigest: `sha256:${string}`;
  executableEntryEvidenceDigest: `sha256:${string}`;
  validUntilMs: number;
}> {
  try {
    if (!closedDataTree(input) || !frozenDataTree(input)) return false;
    const value = input as Readonly<M0SpotReadinessCard>;
    const {
      readinessDigest: _readinessDigest,
      ...withoutDigest
    } = value;
    const validUntilMs = value.validUntilMs;
    if (
      !Number.isSafeInteger(nowMs)
      || validUntilMs === null
      || !Number.isSafeInteger(validUntilMs)
      || !sameCardShape(
        value,
        projectM0SpotSourceReadinessCard(value.observedAtMs),
      )
    ) return false;

    const price = positiveDecimal(value.order.price, 'M0 LIMIT price');
    const quoteAmount = positiveDecimal(
      value.order.quoteAmount,
      'M0 quote amount',
    );
    const baseQuantity = positiveDecimal(
      value.order.baseQuantity,
      'M0 base quantity',
    );
    const simultaneous = positiveDecimal(
      value.limits.maximumSimultaneousExposureQuote,
      'M0 simultaneous exposure',
    );
    const gross = positiveDecimal(
      value.limits.maximumGrossLifecycleTurnoverQuote,
      'M0 lifecycle turnover',
    );
    const maximumLoss = positiveDecimal(
      value.limits.maximumLossQuote,
      'M0 maximum loss',
    );
    const minPrice = nonNegativeDecimal(
      value.filters.minPrice,
      'M0 minimum price',
    );
    const maxPrice = positiveDecimal(
      value.filters.maxPrice,
      'M0 maximum price',
    );
    const tickSize = positiveDecimal(
      value.filters.tickSize,
      'M0 tick size',
    );
    const minQuantity = nonNegativeDecimal(
      value.filters.minQuantity,
      'M0 minimum quantity',
    );
    const maxQuantity = positiveDecimal(
      value.filters.maxQuantity,
      'M0 maximum quantity',
    );
    const stepSize = positiveDecimal(
      value.filters.stepSize,
      'M0 step size',
    );
    const minNotional = positiveDecimal(
      value.filters.minNotional,
      'M0 minimum notional',
    );
    const maxNotional = value.filters.maxNotional === null
      ? null
      : positiveDecimal(
        value.filters.maxNotional,
        'M0 maximum notional',
      );
    const makerRate = nonNegativeDecimal(
      value.economics.makerRate,
      'M0 maker rate',
    );
    const takerRate = nonNegativeDecimal(
      value.economics.takerRate,
      'M0 taker rate',
    );
    const entryFee = nonNegativeDecimal(
      value.economics.expectedEntryFeeQuote,
      'M0 expected entry fee',
    );
    const recoveryFee = nonNegativeDecimal(
      value.economics.expectedRecoveryFeeQuote,
      'M0 expected recovery fee',
    );
    const feeReserve = nonNegativeDecimal(
      value.economics.totalFeeReserveQuote,
      'M0 total fee reserve',
    );
    const maximumSlippage = nonNegativeDecimal(
      value.economics.maximumSlippageQuote,
      'M0 maximum slippage',
    );
    const baselineBaseQuantity = nonNegativeDecimal(
      value.baseline.baselineBaseQuantity,
      'M0 baseline base balance',
    );
    const baselineQuoteQuantity = nonNegativeDecimal(
      value.baseline.baselineQuoteQuantity,
      'M0 baseline quote balance',
    );
    const observedBaseDelta = nonNegativeDecimal(
      value.baseline.observedBaseDeltaQuantity,
      'M0 observed base delta',
    );
    const observedQuoteDelta = nonNegativeDecimal(
      value.baseline.observedQuoteDeltaQuantity,
      'M0 observed quote delta',
    );
    const baseTolerance = nonNegativeDecimal(
      value.baseline.exchangeBaseTolerance,
      'M0 base tolerance',
    );
    const quoteTolerance = nonNegativeDecimal(
      value.baseline.quoteQuantityTolerance,
      'M0 quote tolerance',
    );
    const observedSpreadBps = nonNegativeDecimal(
      value.liquidity.observedSpreadBps,
      'M0 observed spread bps',
    );
    const maximumSpreadBps = positiveDecimal(
      value.liquidity.maximumSpreadBps,
      'M0 maximum spread bps',
    );
    const observedDepthQuote = positiveDecimal(
      value.liquidity.observedDepthQuote,
      'M0 observed depth quote',
    );
    const minimumDepthQuote = positiveDecimal(
      value.liquidity.minimumDepthQuote,
      'M0 minimum depth quote',
    );

    const activeFilterTypes = value.filters.activeFilterTypes;
    const unknownFilterTypes = value.filters.unknownFilterTypes;
    const ticketTerms = value.clientIdentity.termsDigest;
    const effects = value.effects;
    return (
      value.schema === 'cosmos.system-integration.m0-spot-readiness-card.v1'
      && value.version === 1
      && value.readinessDigest === acknowledgedDigest
      && calculateM0SpotReadinessDigest(withoutDigest)
        === value.readinessDigest
      && SHA256.test(value.lifecycleCardDigest ?? '')
      && SHA256.test(value.executableEntryEvidenceDigest ?? '')
      && value.disposition === 'READY_FOR_OWNER_GATE_2'
      && value.gate2Ready === true
      && value.evidenceAuthority === 'RUNTIME_PRIVATE'
      && RUNTIME_IDENTITY.test(value.ownerId ?? '')
      && Number.isSafeInteger(value.observedAtMs)
      && value.observedAtMs >= 0
      && value.observedAtMs <= nowMs
      && value.observedTimestampIst
        === exactIstTimestamp(value.observedAtMs)
      && validUntilMs > nowMs
      && validUntilMs > value.observedAtMs
      && validUntilMs - value.observedAtMs
        <= M0_SPOT_READINESS_MAX_FRESHNESS_MS
      && value.revisionHost.state === 'VERIFIED_CURRENT'
      && EXACT_REVISION.test(value.revisionHost.revision ?? '')
      && RUNTIME_IDENTITY.test(value.revisionHost.hostId ?? '')
      && RUNTIME_IDENTITY.test(value.revisionHost.bootId ?? '')
      && RUNTIME_IDENTITY.test(value.revisionHost.processId ?? '')
      && value.accountMode.state === 'VERIFIED_CURRENT'
      && RUNTIME_IDENTITY.test(value.accountMode.accountId ?? '')
      && value.accountMode.accountType === 'SPOT'
      && value.accountMode.privateReadVerified === true
      && value.accountMode.balancesRead === true
      && value.accountMode.ordersRead === true
      && value.accountMode.fillsRead === true
      && value.accountMode.permissionRead === true
      && value.accountCanTrade.state === 'VERIFIED_CURRENT'
      && RUNTIME_IDENTITY.test(value.accountCanTrade.profileId ?? '')
      && value.accountCanTrade.accountRealmId
        === value.accountMode.accountId
      && RUNTIME_IDENTITY.test(
        value.accountCanTrade.accountFingerprintRef ?? '',
      )
      && RUNTIME_IDENTITY.test(
        value.accountCanTrade.permissionRevision ?? '',
      )
      && value.accountCanTrade.value === true
      && value.accountCanTrade.minimumPermissionTransition === null
      && currentEvidence(
        value.accountCanTrade.observedAtMs,
        value.accountCanTrade.validUntilMs,
        value.accountCanTrade.evidenceRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.apiKeyPermissions.state === 'VERIFIED_CURRENT'
      && value.apiKeyPermissions.accountRealmId
        === value.accountMode.accountId
      && value.apiKeyPermissions.accountRealmId
        === value.accountCanTrade.accountRealmId
      && value.apiKeyPermissions.accountFingerprintRef
        === value.accountCanTrade.accountFingerprintRef
      && SHA256.test(value.apiKeyPermissions.evidenceDigest ?? '')
      && RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.readProfile.profileId ?? '',
      )
      && value.apiKeyPermissions.readProfile.profileId
        === value.accountCanTrade.profileId
      && value.apiKeyPermissions.readProfile.profileId
        !== value.apiKeyPermissions.executionProfile.profileId
      && RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.readProfile.permissionRevision ?? '',
      )
      && value.apiKeyPermissions.readProfile.permissionRevision
        === value.accountCanTrade.permissionRevision
      && SHA256.test(
        value.apiKeyPermissions.readProfile.signerFingerprint ?? '',
      )
      && RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.readProfile.signerRevision ?? '',
      )
      && currentEvidence(
        value.apiKeyPermissions.readProfile.observedAtMs,
        value.apiKeyPermissions.readProfile.validUntilMs,
        value.apiKeyPermissions.readProfile.signerRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.executionProfile.profileId ?? '',
      )
      && RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.executionProfile.permissionRevision ?? '',
      )
      && SHA256.test(
        value.apiKeyPermissions.executionProfile.signerFingerprint ?? '',
      )
      && value.apiKeyPermissions.executionProfile.signerFingerprint
        !== value.apiKeyPermissions.readProfile.signerFingerprint
      && RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.executionProfile.signerRevision ?? '',
      )
      && currentEvidence(
        value.apiKeyPermissions.executionProfile.observedAtMs,
        value.apiKeyPermissions.executionProfile.validUntilMs,
        value.apiKeyPermissions.executionProfile.signerRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.apiKeyPermissions.readingEnabled === true
      && value.apiKeyPermissions.spotTradeEnabled === true
      && value.apiKeyPermissions.ipRestricted === true
      && value.apiKeyPermissions.withdrawalsEnabled === false
      && value.apiKeyPermissions.internalTransfersEnabled === false
      && value.apiKeyPermissions.universalTransfersEnabled === false
      && value.apiKeyPermissions.marginEnabled === false
      && value.apiKeyPermissions.futuresEnabled === false
      && value.apiKeyPermissions.vanillaOptionsEnabled === false
      && value.apiKeyPermissions.fixTradeEnabled === false
      && value.apiKeyPermissions.fixReadOnlyEnabled === false
      && value.apiKeyPermissions.portfolioMarginEnabled === false
      && currentEvidence(
        value.apiKeyPermissions.observedAtMs,
        value.apiKeyPermissions.validUntilMs,
        value.apiKeyPermissions.evidenceRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.appExecutionArmed.state === 'VERIFIED_CURRENT'
      && value.appExecutionArmed.current === false
      && value.appExecutionArmed.proposed
        === 'ARM_EXACT_CARD_AFTER_OWNER_YES'
      && value.venueRoutes.compositionState === 'VERIFIED_CURRENT'
      && value.venueRoutes.venue === 'BINANCE_SPOT'
      && value.venueRoutes.signedTest.method === 'POST'
      && value.venueRoutes.signedTest.path === '/api/v3/order/test'
      && value.venueRoutes.entry.method === 'POST'
      && value.venueRoutes.entry.path === '/api/v3/order'
      && value.venueRoutes.query.method === 'GET'
      && value.venueRoutes.query.path === '/api/v3/order'
      && value.venueRoutes.cancel.method === 'DELETE'
      && value.venueRoutes.cancel.path === '/api/v3/order'
      && value.venueRoutes.fills.method === 'GET'
      && value.venueRoutes.fills.path === '/api/v3/myTrades'
      && value.excludedCapabilities.state === 'VERIFIED_CURRENT'
      && value.excludedCapabilities.futuresRoute.access
        === 'INACCESSIBLE_TO_M0'
      && value.excludedCapabilities.futuresRoute.route === null
      && value.excludedCapabilities.marginBorrow.access
        === 'INACCESSIBLE_TO_M0'
      && value.excludedCapabilities.marginBorrow.route === null
      && value.excludedCapabilities.marginBorrow.borrowAuthority === 'NONE'
      && value.excludedCapabilities.leverage.availability === 'UNAVAILABLE'
      && value.excludedCapabilities.leverage.value === null
      && value.namedExecutor.state === 'VERIFIED_CURRENT'
      && RUNTIME_IDENTITY.test(value.namedExecutor.executorId ?? '')
      && value.namedExecutor.hostId === value.revisionHost.hostId
      && value.namedExecutor.bootId === value.revisionHost.bootId
      && value.namedExecutor.processId === value.revisionHost.processId
      && value.namedExecutor.authority === 'EXACT_CARD_ONE_LIFECYCLE'
      && value.order.state === 'VERIFIED_CURRENT'
      && value.order.symbol !== null
      && SYMBOL.test(value.order.symbol)
      && value.order.baseAsset !== null
      && ASSET.test(value.order.baseAsset)
      && value.order.allowlist.length === 1
      && value.order.allowlist[0] === value.order.symbol
      && value.order.side === 'BUY'
      && value.order.orderType === 'LIMIT'
      && value.order.timeInForce === 'FOK'
      && value.order.quoteAsset === 'USDT'
      && price !== null
      && price === value.order.price
      && quoteAmount !== null
      && quoteAmount === value.order.quoteAmount
      && baseQuantity !== null
      && baseQuantity === value.order.baseQuantity
      && multiplySpotDecimals(price, baseQuantity) === quoteAmount
      && compareSpotDecimals(
        quoteAmount,
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      ) <= 0
      && value.limits.maximumOrderNotionalQuote
        === OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE
      && simultaneous === quoteAmount
      && gross === addSpotDecimals(quoteAmount, quoteAmount)
      && maximumLoss !== null
      && compareSpotDecimals(maximumLoss, simultaneous!) <= 0
      && Number.isSafeInteger(
        value.limits.maximumExposureDurationMs,
      )
      && value.limits.maximumExposureDurationMs !== null
      && value.limits.maximumExposureDurationMs > 0
      && value.limits.maximumExposureDurationMs
        <= MAX_EXPOSURE_DURATION_MS
      && value.limits.maximumResidualDustNotionalQuote
        === M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE
      && value.limits.maximumSignedTestSubmissions === 1
      && value.limits.maximumEntrySubmissions === 1
      && value.limits.maximumEntryCancelSubmissions === 1
      && value.limits.maximumFlattenSubmissions
        === M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS
      && value.limits.maximumFlattenCancelSubmissions
        === M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS
      && value.limits.maximumLifecycles === 1
      && value.filters.state === 'VERIFIED_CURRENT'
      && value.filters.symbolStatus === 'TRADING'
      && value.filters.baseAsset === value.order.baseAsset
      && value.filters.quoteAsset === 'USDT'
      && value.filters.spotTradingAllowed === true
      && minPrice !== null
      && maxPrice !== null
      && tickSize !== null
      && minQuantity !== null
      && maxQuantity !== null
      && stepSize !== null
      && minNotional !== null
      && compareSpotDecimals(price, minPrice) >= 0
      && compareSpotDecimals(price, maxPrice) <= 0
      && alignedToStep(price, tickSize)
      && compareSpotDecimals(baseQuantity, minQuantity) >= 0
      && compareSpotDecimals(baseQuantity, maxQuantity) <= 0
      && alignedToStep(baseQuantity, stepSize)
      && compareSpotDecimals(quoteAmount, minNotional) >= 0
      && (
        maxNotional === null
        || compareSpotDecimals(quoteAmount, maxNotional) <= 0
      )
      && Number.isSafeInteger(value.filters.pricePrecision)
      && value.filters.pricePrecision !== null
      && value.filters.pricePrecision >= 0
      && value.filters.pricePrecision <= 18
      && value.filters.pricePrecision === decimalScale(tickSize)
      && decimalScale(price) <= value.filters.pricePrecision
      && Number.isSafeInteger(value.filters.quantityPrecision)
      && value.filters.quantityPrecision !== null
      && value.filters.quantityPrecision >= 0
      && value.filters.quantityPrecision <= 18
      && value.filters.quantityPrecision === decimalScale(stepSize)
      && decimalScale(baseQuantity) <= value.filters.quantityPrecision
      && Array.isArray(activeFilterTypes)
      && activeFilterTypes.length >= 3
      && new Set(activeFilterTypes).size === activeFilterTypes.length
      && activeFilterTypes.every((row) =>
        typeof row === 'string' && /^[A-Z0-9_]{2,64}$/u.test(row),
      )
      && activeFilterTypes.includes('PRICE_FILTER')
      && activeFilterTypes.includes('LOT_SIZE')
      && (
        activeFilterTypes.includes('MIN_NOTIONAL')
        || activeFilterTypes.includes('NOTIONAL')
      )
      && Array.isArray(unknownFilterTypes)
      && unknownFilterTypes.length === 0
      && value.filters.allActiveFiltersSatisfied === true
      && SHA256.test(value.filters.completeSnapshotDigest ?? '')
      && currentEvidence(
        value.filters.observedAtMs,
        value.filters.validUntilMs,
        value.filters.snapshotRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.liquidity.state === 'VERIFIED_CURRENT'
      && value.liquidity.symbol === value.order.symbol
      && value.liquidity.classification === 'LIQUID'
      && observedSpreadBps !== null
      && maximumSpreadBps !== null
      && compareSpotDecimals(
        observedSpreadBps,
        maximumSpreadBps,
      ) <= 0
      && observedDepthQuote !== null
      && minimumDepthQuote !== null
      && compareSpotDecimals(
        observedDepthQuote,
        minimumDepthQuote,
      ) >= 0
      && compareSpotDecimals(
        minimumDepthQuote,
        gross,
      ) >= 0
      && SHA256.test(value.liquidity.evidenceDigest ?? '')
      && currentEvidence(
        value.liquidity.observedAtMs,
        value.liquidity.validUntilMs,
        value.liquidity.evidenceRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.economics.state === 'VERIFIED_CURRENT'
      && makerRate !== null
      && takerRate !== null
      && ASSET.test(value.economics.feeChargingAsset ?? '')
      && typeof value.economics.discountEnabled === 'boolean'
      && entryFee !== null
      && recoveryFee !== null
      && compareSpotDecimals(
        entryFee,
        multiplySpotDecimals(quoteAmount, takerRate),
      ) >= 0
      && compareSpotDecimals(recoveryFee, entryFee) >= 0
      && feeReserve === addSpotDecimals(entryFee, recoveryFee)
      && maximumSlippage !== null
      && compareSpotDecimals(
        addSpotDecimals(feeReserve, maximumSlippage),
        maximumLoss,
      ) <= 0
      && currentEvidence(
        value.economics.observedAtMs,
        value.economics.validUntilMs,
        value.economics.evidenceRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.baseline.state === 'VERIFIED_CURRENT'
      && value.baseline.baseAsset === value.order.baseAsset
      && value.baseline.quoteAsset === 'USDT'
      && baselineBaseQuantity !== null
      && baselineQuoteQuantity !== null
      && observedBaseDelta !== null
      && observedQuoteDelta !== null
      && baseTolerance !== null
      && quoteTolerance !== null
      && compareSpotDecimals(baseTolerance, stepSize) < 0
      && compareSpotDecimals(
        multiplySpotDecimals(baseTolerance, price),
        M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE,
      ) <= 0
      && compareSpotDecimals(
        quoteTolerance,
        M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE,
      ) <= 0
      && compareSpotDecimals(
        quoteTolerance,
        addSpotDecimals(feeReserve, maximumSlippage),
      ) <= 0
      && compareSpotDecimals(observedBaseDelta, baseTolerance) <= 0
      && compareSpotDecimals(observedQuoteDelta, quoteTolerance) <= 0
      && value.baseline.openOrderCount === 0
      && value.baseline.unresolvedMutationCount === 0
      && value.baseline.matched === true
      && value.baseline.matchKind === (
        observedBaseDelta === '0' && observedQuoteDelta === '0'
          ? 'EXACT'
          : 'WITHIN_EXPLICIT_TOLERANCE'
      )
      && currentEvidence(
        value.baseline.observedAtMs,
        value.baseline.validUntilMs,
        value.baseline.baselineRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.clientIdentity.state === 'VERIFIED_CURRENT'
      && TICKET_ID.test(value.clientIdentity.ticketId ?? '')
      && TICKET_TERMS.test(ticketTerms ?? '')
      && value.clientIdentity.ticketId === `spt_${ticketTerms}`
      && CLIENT_ORDER_ID.test(
        value.clientIdentity.entryClientOrderId ?? '',
      )
      && value.clientIdentity.queryKey === 'origClientOrderId'
      && value.validation.state === 'VERIFIED_CURRENT'
      && value.validation.signedTestPassed === true
      && currentEvidence(
        value.validation.observedAtMs,
        value.validation.validUntilMs,
        value.validation.evidenceRevision,
        value.observedAtMs,
        validUntilMs,
      )
      && value.timing.requestTimeoutMs === 5000
      && value.timing.recvWindowMs === 5000
      && value.timing.queryBeforeRetry === true
      && value.timing.blindResend === false
      && value.executorActionAllowlist.length
        === M0_SPOT_ACTION_ALLOWLIST.length
      && value.executorActionAllowlist.every(
        (action, index) => action === M0_SPOT_ACTION_ALLOWLIST[index],
      )
      && value.recovery.state === 'VERIFIED_CURRENT'
      && value.recovery.law
        === 'CANCEL_OPEN_REMAINDER_THEN_FLATTEN_EXACT_CANARY_ATTRIBUTABLE_EXPOSURE_UNTIL_BASELINE'
      && value.recovery.baselineRevision
        === value.baseline.baselineRevision
      && value.recovery.exchangeBaseTolerance
        === value.baseline.exchangeBaseTolerance
      && value.recovery.quoteQuantityTolerance
        === value.baseline.quoteQuantityTolerance
      && value.recovery.maximumResidualDustNotionalQuote
        === value.limits.maximumResidualDustNotionalQuote
      && value.recovery.feeReserveQuote
        === value.economics.totalFeeReserveQuote
      && Number.isSafeInteger(value.recovery.maximumRecoveryDurationMs)
      && value.recovery.maximumRecoveryDurationMs !== null
      && value.recovery.maximumRecoveryDurationMs > 0
      && value.recovery.maximumRecoveryDurationMs
        <= value.limits.maximumExposureDurationMs
      && value.recovery.cancelExactOrderOnly === true
      && value.recovery.flattenExactResidualOnly === true
      && value.recovery.remainsAuthorizedAfterKill === true
      && value.recovery.remainsAuthorizedAcrossRestart === true
      && value.ledgerReconciliation.state === 'VERIFIED_CURRENT'
      && value.ledgerReconciliation.appendOnlyLedger === 'COSMOS_LEDGER'
      && value.ledgerReconciliation.requiredEvents.length
        === REQUIRED_LEDGER_EVENTS.length
      && value.ledgerReconciliation.requiredEvents.every(
        (event, index) => event === REQUIRED_LEDGER_EVENTS[index],
      )
      && value.ledgerReconciliation.venueEqualsLocal === true
      && value.lifecycle.state === 'VERIFIED_CURRENT'
      && value.lifecycle.oneEntry === true
      && value.lifecycle.oneLifecycle === true
      && value.lifecycle.blindResend === false
      && value.lifecycle.recoveryAuthorizedUntilFlat === true
      && value.lifecycle.finalDisarmAfterVenueAndLocalFlat === true
      && value.rollback.state === 'VERIFIED_CURRENT'
      && value.rollback.trigger === 'OWNER_ABORT_OR_PRE_ENTRY_GATE_FAILURE'
      && value.rollback.targetState === 'DISARMED_KILL_ENGAGED'
      && value.rollback.ownerId === value.ownerId
      && typeof value.rollback.procedure === 'string'
      && value.rollback.procedure.length > 0
      && value.rollback.procedure.length <= 512
      && !/[\u0000-\u001f\u007f]/u.test(value.rollback.procedure)
      && RUNTIME_IDENTITY.test(value.rollback.configRevision ?? '')
      && RUNTIME_IDENTITY.test(value.rollback.evidenceRevision ?? '')
      && value.rollback.reversesMarketExposure === false
      && value.residualCondition === (
        value.baseline.matchKind === 'EXACT'
          ? 'EXACT_ZERO_DELTA_BASELINE_VERIFIED'
          : 'EXPLICIT_BOUNDED_DUST_BASELINE_VERIFIED'
      )
      && value.exactLimitation === null
      && value.ownerAction === 'YES'
      && Object.values(effects).length === 7
      && Object.values(effects).every((effect) => effect === 0)
    );
  } catch {
    return false;
  }
}

/**
 * Admit only the exact read-only permission blocker. Every non-permission §7
 * row must already satisfy the READY validator; the card itself remains
 * default-disarmed/owner-NO and its digest covers the exact minimum owner
 * transition.
 */
export function validateM0SpotBlockedPermissionCard(
  input: unknown,
  nowMs: number,
): boolean {
  try {
    if (!closedDataTree(input) || !frozenDataTree(input)) return false;
    const value = input as Readonly<M0SpotReadinessCard>;
    if (
      !Number.isSafeInteger(nowMs)
      || !sameCardShape(
        value,
        projectM0SpotSourceReadinessCard(value.observedAtMs),
      )
      || value.disposition !== 'M0_BLOCKED_PERMISSION'
      || value.gate2Ready !== false
      || value.evidenceAuthority !== 'RUNTIME_PRIVATE'
      || !RUNTIME_IDENTITY.test(value.ownerId ?? '')
      || !Number.isSafeInteger(value.observedAtMs)
      || value.observedAtMs < 0
      || value.observedAtMs > nowMs
      || value.observedTimestampIst !== exactIstTimestamp(value.observedAtMs)
      || value.validUntilMs === null
      || !Number.isSafeInteger(value.validUntilMs)
      || value.validUntilMs <= nowMs
      || value.validUntilMs <= value.observedAtMs
      || value.validUntilMs - value.observedAtMs
        > M0_SPOT_READINESS_MAX_FRESHNESS_MS
      || value.revisionHost.state !== 'VERIFIED_CURRENT'
      || !EXACT_REVISION.test(value.revisionHost.revision ?? '')
      || !RUNTIME_IDENTITY.test(value.revisionHost.hostId ?? '')
      || !RUNTIME_IDENTITY.test(value.revisionHost.bootId ?? '')
      || !RUNTIME_IDENTITY.test(value.revisionHost.processId ?? '')
      || value.accountMode.state !== 'VERIFIED_CURRENT'
      || !RUNTIME_IDENTITY.test(value.accountMode.accountId ?? '')
      || value.accountMode.accountType !== 'SPOT'
      || value.accountMode.privateReadVerified !== true
      || value.accountMode.balancesRead !== true
      || value.accountMode.ordersRead !== true
      || value.accountMode.fillsRead !== true
      || value.accountMode.permissionRead !== true
      || value.accountCanTrade.state !== 'VERIFIED_CURRENT'
      || !RUNTIME_IDENTITY.test(value.accountCanTrade.profileId ?? '')
      || value.accountCanTrade.accountRealmId
        !== value.accountMode.accountId
      || !RUNTIME_IDENTITY.test(
        value.accountCanTrade.accountFingerprintRef ?? '',
      )
      || !RUNTIME_IDENTITY.test(
        value.accountCanTrade.permissionRevision ?? '',
      )
      || typeof value.accountCanTrade.value !== 'boolean'
      || !currentEvidence(
        value.accountCanTrade.observedAtMs,
        value.accountCanTrade.validUntilMs,
        value.accountCanTrade.evidenceRevision,
        value.observedAtMs,
        value.validUntilMs,
      )
      || value.apiKeyPermissions.state !== 'VERIFIED_CURRENT'
      || value.apiKeyPermissions.accountRealmId
        !== value.accountMode.accountId
      || value.apiKeyPermissions.accountFingerprintRef
        !== value.accountCanTrade.accountFingerprintRef
      || !SHA256.test(value.apiKeyPermissions.evidenceDigest ?? '')
      || !RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.readProfile.profileId ?? '',
      )
      || value.apiKeyPermissions.readProfile.profileId
        !== value.accountCanTrade.profileId
      || !RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.readProfile.permissionRevision ?? '',
      )
      || value.apiKeyPermissions.readProfile.permissionRevision
        !== value.accountCanTrade.permissionRevision
      || !SHA256.test(
        value.apiKeyPermissions.readProfile.signerFingerprint ?? '',
      )
      || !RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.readProfile.signerRevision ?? '',
      )
      || !currentEvidence(
        value.apiKeyPermissions.readProfile.observedAtMs,
        value.apiKeyPermissions.readProfile.validUntilMs,
        value.apiKeyPermissions.readProfile.signerRevision,
        value.observedAtMs,
        value.validUntilMs,
      )
      || !RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.executionProfile.profileId ?? '',
      )
      || value.apiKeyPermissions.executionProfile.profileId
        === value.apiKeyPermissions.readProfile.profileId
      || !RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.executionProfile.permissionRevision ?? '',
      )
      || !SHA256.test(
        value.apiKeyPermissions.executionProfile.signerFingerprint ?? '',
      )
      || value.apiKeyPermissions.executionProfile.signerFingerprint
        === value.apiKeyPermissions.readProfile.signerFingerprint
      || !RUNTIME_IDENTITY.test(
        value.apiKeyPermissions.executionProfile.signerRevision ?? '',
      )
      || !currentEvidence(
        value.apiKeyPermissions.executionProfile.observedAtMs,
        value.apiKeyPermissions.executionProfile.validUntilMs,
        value.apiKeyPermissions.executionProfile.signerRevision,
        value.observedAtMs,
        value.validUntilMs,
      )
      || value.apiKeyPermissions.readingEnabled !== true
      || typeof value.apiKeyPermissions.spotTradeEnabled !== 'boolean'
      || value.apiKeyPermissions.ipRestricted !== true
      || value.apiKeyPermissions.withdrawalsEnabled !== false
      || value.apiKeyPermissions.internalTransfersEnabled !== false
      || value.apiKeyPermissions.universalTransfersEnabled !== false
      || value.apiKeyPermissions.marginEnabled !== false
      || value.apiKeyPermissions.futuresEnabled !== false
      || value.apiKeyPermissions.vanillaOptionsEnabled !== false
      || value.apiKeyPermissions.fixTradeEnabled !== false
      || value.apiKeyPermissions.fixReadOnlyEnabled !== false
      || value.apiKeyPermissions.portfolioMarginEnabled !== false
      || !currentEvidence(
        value.apiKeyPermissions.observedAtMs,
        value.apiKeyPermissions.validUntilMs,
        value.apiKeyPermissions.evidenceRevision,
        value.observedAtMs,
        value.validUntilMs,
      )
    ) return false;

    const transition = exactM0SpotMinimumPermissionTransition(
      value.accountCanTrade.value,
      value.apiKeyPermissions.spotTradeEnabled,
    );
    if (
      transition === null
      || value.accountCanTrade.minimumPermissionTransition !== transition
      || value.exactLimitation
        !== `M0_BLOCKED_PERMISSION: ${transition}. APP_EXECUTION_ARMED remains false; POST execution is closed.`
      || value.appExecutionArmed.state !== 'VERIFIED_CURRENT'
      || value.appExecutionArmed.current !== false
      || value.appExecutionArmed.proposed !== 'REMAIN_DISARMED'
      || value.ownerAction !== 'NO'
      || Object.values(value.effects).length !== RUNTIME_EFFECT_FIELDS.length
      || Object.values(value.effects).some((effect) => effect !== 0)
    ) return false;

    const {
      readinessDigest: _blockedDigest,
      ...blockedWithoutDigest
    } = value;
    if (
      value.readinessDigest
        !== calculateM0SpotReadinessDigest(blockedWithoutDigest)
    ) return false;

    const readyWithoutDigest = Object.freeze({
      ...blockedWithoutDigest,
      disposition: 'READY_FOR_OWNER_GATE_2' as const,
      gate2Ready: true,
      accountCanTrade: Object.freeze({
        ...value.accountCanTrade,
        value: true,
        minimumPermissionTransition: null,
      }),
      apiKeyPermissions: Object.freeze({
        ...value.apiKeyPermissions,
        spotTradeEnabled: true,
      }),
      appExecutionArmed: Object.freeze({
        ...value.appExecutionArmed,
        proposed: 'ARM_EXACT_CARD_AFTER_OWNER_YES' as const,
      }),
      exactLimitation: null,
      ownerAction: 'YES' as const,
    });
    const ready = freezeDataTree({
      ...readyWithoutDigest,
      readinessDigest: calculateM0SpotReadinessDigest(readyWithoutDigest),
    });
    return validateM0SpotReadyCard(
      ready,
      ready.readinessDigest,
      nowMs,
    );
  } catch {
    return false;
  }
}

function snapshotRuntimeInput(
  value: unknown,
): Readonly<M0SpotRuntimeExecutionInput> | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
    ) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== RUNTIME_INPUT_FIELDS.length
      || keys.some((key) => typeof key !== 'string')
      || !RUNTIME_INPUT_FIELDS.every((key) =>
        Object.prototype.hasOwnProperty.call(descriptors, key),
      )
    ) return null;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of RUNTIME_INPUT_FIELDS) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || descriptor.enumerable !== true
      ) return null;
      output[key] = descriptor.value;
    }
    if (
      output.action !== 'EXECUTE_APPROVED_LIFECYCLE'
      || output.ownerConfirmation !== 'YES'
      || typeof output.requestId !== 'string'
      || !/^m0_req_[0-9a-f]{32}$/u.test(output.requestId)
      || typeof output.idempotencyKeyDigest !== 'string'
      || !SHA256.test(output.idempotencyKeyDigest)
      || typeof output.cardDigest !== 'string'
      || !SHA256.test(output.cardDigest)
      || typeof output.operatorId !== 'string'
      || !RUNTIME_IDENTITY.test(output.operatorId)
    ) return null;
    return Object.freeze({
      requestId: output.requestId as `m0_req_${string}`,
      idempotencyKeyDigest:
        output.idempotencyKeyDigest as `sha256:${string}`,
      operatorId: output.operatorId,
      cardDigest: output.cardDigest as `sha256:${string}`,
      ownerConfirmation: 'YES' as const,
      action: 'EXECUTE_APPROVED_LIFECYCLE' as const,
    });
  } catch {
    return null;
  }
}

/**
 * Snapshot and validate an untrusted executor/runtime result before it can
 * cross either the boundary or the HTTP serializer.
 */
export function snapshotM0SpotRuntimeExecutionResult(
  input: unknown,
  expectedCardDigest?: `sha256:${string}`,
): Readonly<M0SpotRuntimeExecutionResult> | null {
  try {
    if (!closedDataTree(input)) return null;
    const root = input as Readonly<Record<string, unknown>>;
    if (
      Object.keys(root).length !== RUNTIME_RESULT_FIELDS.length
      || !RUNTIME_RESULT_FIELDS.every((field) =>
        Object.prototype.hasOwnProperty.call(root, field),
      )
      || root.schema !== M0_SPOT_RUNTIME_BOUNDARY_SCHEMA
      || typeof root.ok !== 'boolean'
      || ![
        'M0_RUNTIME_NOT_CONFIGURED',
        'M0_CARD_NOT_READY',
        'M0_LIFECYCLE_ACCEPTED',
        'M0_LIFECYCLE_RECOVERY_REQUIRED',
        'M0_LIFECYCLE_RECONCILED',
      ].includes(root.code as string)
      || ![
        'DISARMED',
        'ARMED',
        'RECOVERY_REQUIRED',
        'DISARMED_SAFE',
      ].includes(root.state as string)
      || typeof root.cardDigest !== 'string'
      || !SHA256.test(root.cardDigest)
      || (
        expectedCardDigest !== undefined
        && root.cardDigest !== expectedCardDigest
      )
      || root.ownerConfirmation !== 'EXACT_CARD_ACKNOWLEDGED'
      || root.queryBeforeRetry !== true
      || root.blindResend !== false
      || root.executionAuthorityReturned !== 'NONE'
      || root.effects === null
      || typeof root.effects !== 'object'
      || Array.isArray(root.effects)
    ) return null;
    const effects =
      root.effects as Readonly<Record<string, unknown>>;
    if (
      Object.keys(effects).length !== RUNTIME_EFFECT_FIELDS.length
      || !RUNTIME_EFFECT_FIELDS.every((field) =>
        Object.prototype.hasOwnProperty.call(effects, field)
        && Number.isSafeInteger(effects[field])
        && (effects[field] as number) >= 0
        && (effects[field] as number) <= MAX_RUNTIME_EFFECT_COUNT,
      )
    ) return null;

    const state = root.state;
    const code = root.code;
    const coherent = (
      (
        code === 'M0_RUNTIME_NOT_CONFIGURED'
        && root.ok === false
        && state === 'DISARMED'
        && RUNTIME_EFFECT_FIELDS.every((field) => effects[field] === 0)
      )
      || (
        code === 'M0_CARD_NOT_READY'
        && root.ok === false
        && state === 'DISARMED'
        && effects.orders === 0
        && effects.moneyMutations === 0
      )
      || (
        code === 'M0_LIFECYCLE_ACCEPTED'
        && root.ok === false
        && (state === 'ARMED' || state === 'RECOVERY_REQUIRED')
      )
      || (
        code === 'M0_LIFECYCLE_RECOVERY_REQUIRED'
        && root.ok === false
        && state === 'RECOVERY_REQUIRED'
      )
      || (
        code === 'M0_LIFECYCLE_RECONCILED'
        && root.ok === true
        && state === 'DISARMED_SAFE'
      )
    );
    if (!coherent) return null;

    return freezeDataTree(
      structuredClone(input),
    ) as Readonly<M0SpotRuntimeExecutionResult>;
  } catch {
    return null;
  }
}

function readinessClaim(value: unknown): boolean | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
    ) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ['disposition', 'gate2Ready', 'ownerAction']) {
      const descriptor = descriptors[key];
      if (
        descriptor !== undefined
        && !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) return null;
    }
    const read = (key: string): unknown => {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) return undefined;
      return descriptor.value;
    };
    return (
      read('disposition') === 'READY_FOR_OWNER_GATE_2'
      || read('gate2Ready') === true
      || read('ownerAction') === 'YES'
    );
  } catch {
    return null;
  }
}

/**
 * Build the route boundary. Omitting `executor` is the canonical source-only
 * production posture and cannot fire.
 */
export function createM0SpotRuntimeBoundary(options: Readonly<{
  clock: Readonly<M0SpotRuntimeBoundaryClock>;
  readiness?: Readonly<M0SpotRuntimeReadinessPort>;
  executor?: Readonly<M0SpotApprovedLifecycleExecutionPort>;
}>): Readonly<M0SpotRuntimeBoundaryPort> {
  if (
    typeof options?.clock?.nowMs !== 'function'
    || (
      options.readiness !== undefined
      && typeof options.readiness.read !== 'function'
    )
    || (
      options.executor !== undefined
      && typeof options.executor.execute !== 'function'
    )
    || (
      options.executor !== undefined
      && options.readiness === undefined
    )
  ) throw new TypeError('M0 Spot runtime boundary ports are invalid');

  return Object.freeze({
    async readReadinessCard(): Promise<Readonly<M0SpotReadinessCard>> {
      if (options.readiness !== undefined) {
        const readiness = await options.readiness.read();
        const nowMs = options.clock.nowMs();
        const snapshot = snapshotReadinessCard(readiness);
        if (
          options.executor !== undefined
          && snapshot !== null
          && validateM0SpotBlockedPermissionCard(snapshot, nowMs)
        ) return snapshot;
        if (
          options.executor !== undefined
          && snapshot !== null
          && readinessClaim(snapshot) === true
          && validateM0SpotReadyCard(
            snapshot,
            snapshot.readinessDigest,
            nowMs,
          )
        ) return snapshot;
        return projectM0SpotSourceReadinessCard(nowMs);
      }
      return projectM0SpotSourceReadinessCard(options.clock.nowMs());
    },

    async executeApprovedLifecycle(
      input: Readonly<M0SpotRuntimeExecutionInput>,
    ): Promise<Readonly<M0SpotRuntimeExecutionResult>> {
      const verifiedInput = snapshotRuntimeInput(input);
      if (verifiedInput === null) {
        throw new TypeError('M0 approved-lifecycle input is invalid');
      }
      if (options.executor !== undefined) {
        const readiness = await options.readiness!.read();
        const nowMs = options.clock.nowMs();
        const snapshot = snapshotReadinessCard(readiness);
        if (
          snapshot === null
          || !validateM0SpotReadyCard(
            snapshot,
            verifiedInput.cardDigest,
            nowMs,
          )
          || snapshot.ownerId !== verifiedInput.operatorId
        ) {
          return Object.freeze({
            schema: M0_SPOT_RUNTIME_BOUNDARY_SCHEMA,
            ok: false,
            code: 'M0_CARD_NOT_READY',
            state: 'DISARMED',
            cardDigest: verifiedInput.cardDigest,
            ownerConfirmation: 'EXACT_CARD_ACKNOWLEDGED',
            queryBeforeRetry: true,
            blindResend: false,
            executionAuthorityReturned: 'NONE',
            effects: zeroEffects(),
          });
        }
        const result = await options.executor.execute(Object.freeze({
          ...verifiedInput,
          lifecycleCardDigest: snapshot.lifecycleCardDigest,
          executableEntryEvidenceDigest:
            snapshot.executableEntryEvidenceDigest,
          readinessCard: snapshot,
        }));
        const verifiedResult = snapshotM0SpotRuntimeExecutionResult(
          result,
          verifiedInput.cardDigest,
        );
        if (verifiedResult === null) {
          throw new TypeError(
            'M0 executor result violated the closed runtime contract',
          );
        }
        return verifiedResult;
      }
      return Object.freeze({
        schema: M0_SPOT_RUNTIME_BOUNDARY_SCHEMA,
        ok: false,
        code: 'M0_RUNTIME_NOT_CONFIGURED',
        state: 'DISARMED',
        cardDigest: verifiedInput.cardDigest,
        ownerConfirmation: 'EXACT_CARD_ACKNOWLEDGED',
        queryBeforeRetry: true,
        blindResend: false,
        executionAuthorityReturned: 'NONE',
        effects: zeroEffects(),
      });
    },
  });
}
