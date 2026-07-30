/**
 * Closed authority contracts for one owner-approved Binance Spot M0 lifecycle.
 *
 * These values are inert. HTTP callers may name only a card digest; the card,
 * internal action authorities, tickets, and receipts must be resolved from the
 * canonical server owner and the sole append-only Ledger.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import { canonicalJson } from '../contracts/identity.js';
import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
  subtractSpotDecimals,
} from '../exchange/binanceSpot/filters.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../risk/spotRiskPolicy.js';
import {
  createSpotExecutionTicket,
  reconstructCanonicalSpotExecutionTicket,
  type SpotExecutionTicket,
} from './spotTicket.js';

export const M0_SPOT_LIFECYCLE_CARD_SCHEMA =
  'cosmos.foundation.m0-spot-lifecycle-card.v1' as const;
export const M0_SPOT_ACTION_AUTHORITY_SCHEMA =
  'cosmos.foundation.m0-spot-action-authority.v1' as const;
export const M0_SPOT_ACTION_CONSUMPTION_SCHEMA =
  'cosmos.foundation.m0-spot-action-consumption.v1' as const;

export const M0_SPOT_ACTION_ALLOWLIST = Object.freeze([
  'SIGNED_TEST',
  'ENTRY',
  'ENTRY_CANCEL',
  'QUERY_ORDER',
  'QUERY_FILLS',
  'FLATTEN',
  'FLATTEN_CANCEL',
  'RECONCILE',
  'DISARM',
] as const);

export type M0SpotAction = (typeof M0_SPOT_ACTION_ALLOWLIST)[number];

export const M0_SPOT_EGRESS_ACTIONS = Object.freeze([
  'SIGNED_TEST',
  'ENTRY',
  'ENTRY_CANCEL',
  'QUERY_ORDER',
  'QUERY_FILLS',
  'FLATTEN',
  'FLATTEN_CANCEL',
] as const);

export type M0SpotEgressAction = (typeof M0_SPOT_EGRESS_ACTIONS)[number];

/** Entry is permanently one; recovery may mint only this many fresh tickets. */
export const M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS = 3 as const;
export const M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS = 3 as const;
export const M0_SPOT_MAXIMUM_RECOVERY_READ_SUBMISSIONS = 24 as const;

const RECOVERY_ACTIONS = new Set<M0SpotEgressAction>([
  'ENTRY_CANCEL',
  'QUERY_ORDER',
  'QUERY_FILLS',
  'FLATTEN',
  'FLATTEN_CANCEL',
]);

const CARD_FIELDS = Object.freeze([
  'schema',
  'version',
  'cardId',
  'cardDigest',
  'verification',
  'ownerId',
  'accountId',
  'symbol',
  'baseAsset',
  'side',
  'orderType',
  'quoteAsset',
  'entryTicketId',
  'entryTermsDigest',
  'entryClientOrderId',
  'entryNotionalQuote',
  'maximumOrderNotionalQuote',
  'maximumSimultaneousExposureQuote',
  'maximumGrossLifecycleTurnoverQuote',
  'maximumResidualDustNotionalQuote',
  'maximumLossQuote',
  'maximumExposureDurationMs',
  'maximumSignedTestSubmissions',
  'maximumEntrySubmissions',
  'maximumEntryCancelSubmissions',
  'maximumFlattenSubmissions',
  'maximumFlattenCancelSubmissions',
  'recoveryAuthorizedUntil',
  'filterSnapshotRevision',
  'feeEvidenceRevision',
  'privateReadRevision',
  'signedTestEvidenceRevision',
  'controlRevision',
  'clockFenceId',
  'issuedAtMs',
  'expiresAtMs',
  'issuedMonotonicMs',
  'expiresMonotonicMs',
  'oneLifecycle',
  'actionAllowlist',
  'withdrawalsEnabled',
  'transfersEnabled',
  'futuresEnabled',
  'marginBorrowEnabled',
] as const);

const AUTHORITY_FIELDS = Object.freeze([
  'schema',
  'version',
  'authorizationId',
  'verification',
  'lifecycleId',
  'cardId',
  'cardDigest',
  'action',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'intentDigest',
  'stateRevision',
  'clockFenceId',
  'issuedAtMs',
  'expiresAtMs',
  'issuedMonotonicMs',
  'expiresMonotonicMs',
  'singleUse',
] as const);

const RECEIPT_FIELDS = Object.freeze([
  'schema',
  'version',
  'lifecycleId',
  'authorizationId',
  'cardId',
  'cardDigest',
  'action',
  'ticketId',
  'termsDigest',
  'clientOrderId',
  'intentDigest',
  'stateRevision',
  'nextStateRevision',
  'clockFenceId',
  'consumedAtMs',
  'consumedMonotonicMs',
  'state',
  'authorizationReuseAllowed',
] as const);

const CARD_ID = /^m0_card_[0-9a-f]{32}$/u;
const CARD_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const LIFECYCLE_ID = /^m0_lifecycle_[0-9a-f]{32}$/u;
const AUTHORIZATION_ID = /^m0_action_[0-9a-f]{32}$/u;
const CLOCK_FENCE_ID = /^m0_clock_fence_[A-Za-z0-9_.:-]{16,160}$/u;
const TICKET_ID = /^spt_[0-9a-f]{32}$/u;
const CLIENT_ORDER_ID = /^[A-Za-z0-9_-]{1,36}$/u;
const SYMBOL = /^[A-Z0-9]{4,20}$/u;
const ASSET = /^[A-Z0-9]{1,16}$/u;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const DIGEST = /^[0-9a-f]{32,64}$/u;
const INTENT_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_EXPOSURE_DURATION_MS = 15 * 60_000;

type PlainRecord = Readonly<Record<string, unknown>>;

export interface M0SpotLifecycleCard {
  readonly schema: typeof M0_SPOT_LIFECYCLE_CARD_SCHEMA;
  readonly version: 1;
  readonly cardId: `m0_card_${string}`;
  readonly cardDigest: `sha256:${string}`;
  readonly verification: 'VERIFIED_BY_CANONICAL_OWNER_CARD';
  readonly ownerId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly side: 'BUY';
  readonly orderType: 'LIMIT';
  readonly quoteAsset: 'USDT';
  readonly entryTicketId: string;
  readonly entryTermsDigest: string;
  readonly entryClientOrderId: string;
  readonly entryNotionalQuote: string;
  readonly maximumOrderNotionalQuote:
    typeof OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE;
  readonly maximumSimultaneousExposureQuote: string;
  readonly maximumGrossLifecycleTurnoverQuote: string;
  readonly maximumResidualDustNotionalQuote: string;
  readonly maximumLossQuote: string;
  readonly maximumExposureDurationMs: number;
  readonly maximumSignedTestSubmissions: 1;
  readonly maximumEntrySubmissions: 1;
  readonly maximumEntryCancelSubmissions: 1;
  readonly maximumFlattenSubmissions:
    typeof M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS;
  readonly maximumFlattenCancelSubmissions:
    typeof M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS;
  readonly recoveryAuthorizedUntil: 'EXACT_FLAT_RECONCILED';
  readonly filterSnapshotRevision: string;
  readonly feeEvidenceRevision: string;
  readonly privateReadRevision: string;
  readonly signedTestEvidenceRevision: string;
  readonly controlRevision: string;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly issuedMonotonicMs: number;
  readonly expiresMonotonicMs: number;
  readonly oneLifecycle: true;
  readonly actionAllowlist: typeof M0_SPOT_ACTION_ALLOWLIST;
  readonly withdrawalsEnabled: false;
  readonly transfersEnabled: false;
  readonly futuresEnabled: false;
  readonly marginBorrowEnabled: false;
}

export interface M0SpotActionAuthority {
  readonly schema: typeof M0_SPOT_ACTION_AUTHORITY_SCHEMA;
  readonly version: 1;
  readonly authorizationId: `m0_action_${string}`;
  readonly verification: 'VERIFIED_BY_CANONICAL_LIFECYCLE_OWNER';
  readonly lifecycleId: `m0_lifecycle_${string}`;
  readonly cardId: `m0_card_${string}`;
  readonly cardDigest: `sha256:${string}`;
  readonly action: M0SpotEgressAction;
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly intentDigest: `sha256:${string}`;
  readonly stateRevision: number;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly issuedMonotonicMs: number;
  readonly expiresMonotonicMs: number;
  readonly singleUse: true;
}

export interface M0SpotActionConsumptionReceipt {
  readonly schema: typeof M0_SPOT_ACTION_CONSUMPTION_SCHEMA;
  readonly version: 1;
  readonly lifecycleId: `m0_lifecycle_${string}`;
  readonly authorizationId: `m0_action_${string}`;
  readonly cardId: `m0_card_${string}`;
  readonly cardDigest: `sha256:${string}`;
  readonly action: M0SpotEgressAction;
  readonly ticketId: string;
  readonly termsDigest: string;
  readonly clientOrderId: string;
  readonly intentDigest: `sha256:${string}`;
  readonly stateRevision: number;
  readonly nextStateRevision: number;
  readonly clockFenceId: `m0_clock_fence_${string}`;
  readonly consumedAtMs: number;
  readonly consumedMonotonicMs: number;
  readonly state: 'CONSUMED_ONCE';
  readonly authorizationReuseAllowed: false;
}

export interface M0SpotActionAuthorityContext {
  readonly lifecycleId: `m0_lifecycle_${string}`;
  readonly stateRevision: number;
  readonly currentClockFenceId: `m0_clock_fence_${string}`;
  readonly recoveryActive: boolean;
  readonly residualQuantity: string | null;
  readonly exchangeBaseTolerance?: string | null;
  readonly quantityStepSize?: string | null;
  readonly maximumResidualDustNotionalQuote?: string | null;
  readonly entryTicket: Readonly<SpotExecutionTicket>;
  /** Exact pure-derived candidate for the next fresh flatten authority. */
  readonly derivedFlattenTicket?: Readonly<SpotExecutionTicket> | null;
  /**
   * Exact currently active flatten order. In particular, FLATTEN_CANCEL binds
   * this immutable identity rather than a residual that can change after fills.
   */
  readonly activeFlattenTicket?: Readonly<SpotExecutionTicket> | null;
}

export interface M0SpotActionCardinalityContext {
  readonly disarmedSafe: boolean;
  readonly armed: boolean;
  readonly newEntryArmed: boolean;
  readonly entryPresent: boolean;
  readonly entryTerminal: boolean;
  readonly residualQuantity: string | null;
  readonly activeFlattenPresent: boolean;
  readonly recoveryActive: boolean;
  readonly consumedActionCount: number;
}

export type M0SpotActionCardinalityDecision = Readonly<{
  allowed: boolean;
  limit: number;
  consumed: number;
  code:
    | 'ACTION_ALLOWED'
    | 'ACTION_LIMIT_EXHAUSTED'
    | 'LIFECYCLE_DISARMED'
    | 'ENTRY_NOT_ARMED'
    | 'RECOVERY_NOT_ACTIVE'
    | 'ENTRY_NOT_TERMINAL'
    | 'NO_EXACT_RESIDUAL'
    | 'NO_ACTIVE_FLATTEN';
}>;

export type M0SpotLifecycleCardValidation =
  | { readonly ok: true; readonly card: Readonly<M0SpotLifecycleCard> }
  | {
      readonly ok: false;
      readonly code:
        | 'CARD_INVALID'
        | 'CARD_DIGEST_MISMATCH'
        | 'CARD_TICKET_MISMATCH'
        | 'CARD_NOTIONAL_INVALID'
        | 'CARD_TIME_INVALID';
    };

export type M0SpotActionAuthorityValidation =
  | {
      readonly ok: true;
      readonly authority: Readonly<M0SpotActionAuthority>;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'AUTHORITY_INVALID'
        | 'AUTHORITY_BINDING_MISMATCH'
        | 'AUTHORITY_TIME_INVALID';
    };

function snapshotRecord(
  value: unknown,
  fields: readonly string[],
): PlainRecord | null {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== fields.length
      || fields.some((field) => {
        const descriptor = descriptors[field];
        return (
          descriptor === undefined
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
          || descriptor.enumerable !== true
        );
      })
    ) return null;
    return Object.freeze(Object.fromEntries(
      fields.map((field) => [field, descriptors[field].value]),
    ));
  } catch {
    return null;
  }
}

function validUtcMs(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function exactActionAllowlist(value: unknown): boolean {
  try {
    return (
      Array.isArray(value)
      && !nodeUtilTypes.isProxy(value)
      && Object.getPrototypeOf(value) === Array.prototype
      && value.length === M0_SPOT_ACTION_ALLOWLIST.length
      && M0_SPOT_ACTION_ALLOWLIST.every(
        (action, index) => value[index] === action,
      )
    );
  } catch {
    return false;
  }
}

function exactDigestMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function sha256(namespace: string, value: unknown): string {
  return createHash('sha256')
    .update(`${namespace}|${canonicalJson(value)}`, 'utf8')
    .digest('hex');
}

export function deriveM0SpotLifecycleCardId(input: Readonly<{
  ownerId: string;
  accountId: string;
  entryTicketId: string;
  signedTestEvidenceRevision: string;
  controlRevision: string;
}>): `m0_card_${string}` {
  return `m0_card_${sha256('m0-spot-card-id', input).slice(0, 32)}` as const;
}

export function deriveM0SpotLifecycleId(
  cardDigest: string,
): `m0_lifecycle_${string}` {
  if (!CARD_DIGEST.test(cardDigest)) {
    throw new TypeError('M0 card digest is malformed');
  }
  return `m0_lifecycle_${sha256('m0-spot-lifecycle-id', cardDigest)
    .slice(0, 32)}` as const;
}

export function deriveM0SpotActionAuthorizationId(input: Readonly<{
  lifecycleId: string;
  action: M0SpotEgressAction;
  ticketId: string;
  intentDigest: string;
  stateRevision: number;
}>): `m0_action_${string}` {
  return `m0_action_${sha256('m0-spot-action-id', input)
    .slice(0, 32)}` as const;
}

function withoutCardDigest(record: PlainRecord): PlainRecord {
  return Object.freeze(Object.fromEntries(
    CARD_FIELDS
      .filter((field) => field !== 'cardDigest')
      .map((field) => [field, record[field] === record.actionAllowlist
        ? M0_SPOT_ACTION_ALLOWLIST
        : record[field]]),
  ));
}

export function calculateM0SpotLifecycleCardDigest(
  value: Omit<M0SpotLifecycleCard, 'cardDigest'>,
): `sha256:${string}` {
  return `sha256:${sha256('m0-spot-lifecycle-card', value)}` as const;
}

export function calculateM0SpotIntentDigest(
  value: unknown,
): `sha256:${string}` {
  return `sha256:${sha256('m0-spot-action-intent', value)}` as const;
}

/**
 * Validate and reconstruct one immutable card against its complete
 * deterministic entry ticket.
 */
export function validateM0SpotLifecycleCard(
  cardValue: unknown,
  ticketValue: Readonly<SpotExecutionTicket>,
  evaluatedAtMs: number,
  clockFenceId: string,
  evaluatedMonotonicMs: number,
): M0SpotLifecycleCardValidation {
  const card = snapshotRecord(cardValue, CARD_FIELDS);
  const ticket = reconstructCanonicalSpotExecutionTicket(ticketValue);
  if (
    card === null
    || ticket === null
    || card.schema !== M0_SPOT_LIFECYCLE_CARD_SCHEMA
    || card.version !== 1
    || typeof card.cardId !== 'string'
    || !CARD_ID.test(card.cardId)
    || typeof card.cardDigest !== 'string'
    || !CARD_DIGEST.test(card.cardDigest)
    || card.verification !== 'VERIFIED_BY_CANONICAL_OWNER_CARD'
    || typeof card.ownerId !== 'string'
    || !IDENTITY.test(card.ownerId)
    || typeof card.accountId !== 'string'
    || !IDENTITY.test(card.accountId)
    || typeof card.symbol !== 'string'
    || !SYMBOL.test(card.symbol)
    || typeof card.baseAsset !== 'string'
    || !ASSET.test(card.baseAsset)
    || card.side !== 'BUY'
    || card.orderType !== 'LIMIT'
    || card.quoteAsset !== 'USDT'
    || typeof card.entryTicketId !== 'string'
    || !TICKET_ID.test(card.entryTicketId)
    || typeof card.entryTermsDigest !== 'string'
    || !DIGEST.test(card.entryTermsDigest)
    || typeof card.entryClientOrderId !== 'string'
    || !CLIENT_ORDER_ID.test(card.entryClientOrderId)
    || card.maximumOrderNotionalQuote
      !== OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE
    || card.maximumSignedTestSubmissions !== 1
    || card.maximumEntrySubmissions !== 1
    || card.maximumEntryCancelSubmissions !== 1
    || card.maximumFlattenSubmissions
      !== M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS
    || card.maximumFlattenCancelSubmissions
      !== M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS
    || card.recoveryAuthorizedUntil !== 'EXACT_FLAT_RECONCILED'
    || ![
      card.filterSnapshotRevision,
      card.feeEvidenceRevision,
      card.privateReadRevision,
      card.signedTestEvidenceRevision,
      card.controlRevision,
    ].every((value) => typeof value === 'string' && REVISION.test(value))
    || typeof card.clockFenceId !== 'string'
    || !CLOCK_FENCE_ID.test(card.clockFenceId)
    || card.oneLifecycle !== true
    || !exactActionAllowlist(card.actionAllowlist)
    || card.withdrawalsEnabled !== false
    || card.transfersEnabled !== false
    || card.futuresEnabled !== false
    || card.marginBorrowEnabled !== false
  ) {
    return Object.freeze({ ok: false as const, code: 'CARD_INVALID' });
  }

  const expectedCardId = deriveM0SpotLifecycleCardId({
    ownerId: card.ownerId as string,
    accountId: card.accountId as string,
    entryTicketId: card.entryTicketId as string,
    signedTestEvidenceRevision: card.signedTestEvidenceRevision as string,
    controlRevision: card.controlRevision as string,
  });
  if (
    card.cardId !== expectedCardId
    || ticket.schema !== 'cosmos.spot-execution-ticket.v1'
    || ticket.venue !== 'BINANCE_SPOT'
    || ticket.purpose !== 'ENTRY'
    || ticket.side !== 'BUY'
    || ticket.type !== 'LIMIT'
    || ticket.timeInForce !== 'FOK'
    || ticket.price === null
    || ticket.notionalPrice !== ticket.price
    || card.accountId !== ticket.accountId
    || card.symbol !== ticket.symbol
    || card.symbol !== `${card.baseAsset}USDT`
    || card.entryTicketId !== ticket.ticketId
    || card.entryTermsDigest !== ticket.termsDigest
    || card.entryClientOrderId !== ticket.clientOrderId
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'CARD_TICKET_MISMATCH',
    });
  }

  try {
    const entry = normalizeSpotDecimal(
      card.entryNotionalQuote as string,
      'entryNotionalQuote',
    );
    const simultaneous = normalizeSpotDecimal(
      card.maximumSimultaneousExposureQuote as string,
      'maximumSimultaneousExposureQuote',
    );
    const gross = normalizeSpotDecimal(
      card.maximumGrossLifecycleTurnoverQuote as string,
      'maximumGrossLifecycleTurnoverQuote',
    );
    const maximumDust = normalizeSpotDecimal(
      card.maximumResidualDustNotionalQuote as string,
      'maximumResidualDustNotionalQuote',
    );
    const loss = normalizeSpotDecimal(
      card.maximumLossQuote as string,
      'maximumLossQuote',
    );
    if (
      entry !== card.entryNotionalQuote
      || simultaneous !== card.maximumSimultaneousExposureQuote
      || gross !== card.maximumGrossLifecycleTurnoverQuote
      || maximumDust !== card.maximumResidualDustNotionalQuote
      || loss !== card.maximumLossQuote
      || entry === '0'
      || maximumDust === '0'
      || entry !== ticket.orderNotionalQuote
      || simultaneous !== entry
      || gross !== addSpotDecimals(entry, entry)
      || loss !== ticket.estimatedMaxLossQuote
      || compareSpotDecimals(entry, OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE) > 0
      || compareSpotDecimals(
        multiplySpotDecimals(maximumDust, '100'),
        entry,
      ) > 0
      || compareSpotDecimals(loss, simultaneous) > 0
    ) {
      return Object.freeze({
        ok: false as const,
        code: 'CARD_NOTIONAL_INVALID',
      });
    }
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CARD_NOTIONAL_INVALID',
    });
  }

  const wallDuration = Number(card.expiresAtMs) - Number(card.issuedAtMs);
  const monotonicDuration =
    Number(card.expiresMonotonicMs) - Number(card.issuedMonotonicMs);
  if (
    !validUtcMs(evaluatedAtMs)
    || !validUtcMs(evaluatedMonotonicMs)
    || !validUtcMs(card.issuedAtMs)
    || !validUtcMs(card.expiresAtMs)
    || !validUtcMs(card.issuedMonotonicMs)
    || !validUtcMs(card.expiresMonotonicMs)
    || !Number.isSafeInteger(card.maximumExposureDurationMs)
    || (card.maximumExposureDurationMs as number) < 1
    || (card.maximumExposureDurationMs as number)
      > MAX_EXPOSURE_DURATION_MS
    || card.issuedAtMs < ticket.createdAtMs
    || card.issuedAtMs > evaluatedAtMs
    || card.expiresAtMs <= evaluatedAtMs
    || card.expiresAtMs > ticket.expiresAtMs
    || wallDuration < 1
    || wallDuration !== monotonicDuration
    || wallDuration > (card.maximumExposureDurationMs as number)
    || card.clockFenceId !== clockFenceId
    || card.issuedMonotonicMs > evaluatedMonotonicMs
    || card.expiresMonotonicMs <= evaluatedMonotonicMs
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'CARD_TIME_INVALID',
    });
  }

  let expectedDigest: string;
  try {
    expectedDigest = calculateM0SpotLifecycleCardDigest(
      withoutCardDigest(card) as unknown as Omit<
        M0SpotLifecycleCard,
        'cardDigest'
      >,
    );
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CARD_DIGEST_MISMATCH',
    });
  }
  if (!exactDigestMatch(expectedDigest, card.cardDigest as string)) {
    return Object.freeze({
      ok: false as const,
      code: 'CARD_DIGEST_MISMATCH',
    });
  }

  const frozenCard = Object.freeze({
    ...card,
    actionAllowlist: M0_SPOT_ACTION_ALLOWLIST,
  }) as unknown as Readonly<M0SpotLifecycleCard>;
  return Object.freeze({ ok: true as const, card: frozenCard });
}

function actionTicketMatches(
  action: M0SpotEgressAction,
  ticket: Readonly<SpotExecutionTicket>,
  card: Readonly<M0SpotLifecycleCard>,
  context: Readonly<M0SpotActionAuthorityContext>,
): boolean {
  const exactTicket = reconstructCanonicalSpotExecutionTicket(ticket);
  if (
    exactTicket === null
    || exactTicket.accountId !== card.accountId
    || exactTicket.symbol !== card.symbol
  ) return false;
  if (
    action === 'SIGNED_TEST'
    || action === 'ENTRY'
    || action === 'ENTRY_CANCEL'
  ) {
    return exactTicket.ticketId === card.entryTicketId
      && exactTicket.termsDigest === card.entryTermsDigest
      && exactTicket.clientOrderId === card.entryClientOrderId
      && exactTicket.purpose === 'ENTRY'
      && exactTicket.side === 'BUY'
      && exactTicket.type === 'LIMIT'
      && exactTicket.timeInForce === 'FOK';
  }
  if (action === 'QUERY_ORDER' || action === 'QUERY_FILLS') {
    return exactTicket.ticketId === context.entryTicket.ticketId
      || (
        exactTicket.purpose === 'FLATTEN'
        && exactTicket.side === 'SELL'
        && exactTicket.planId === context.entryTicket.planId
        && exactTicket.correlationId === context.entryTicket.correlationId
      );
  }
  if (action === 'FLATTEN_CANCEL') {
    const activeFlattenTicket = context.activeFlattenTicket == null
      ? null
      : reconstructCanonicalSpotExecutionTicket(
          context.activeFlattenTicket,
        );
    return activeFlattenTicket !== null
      && exactTicket.ticketId === activeFlattenTicket.ticketId
      && exactTicket.termsDigest === activeFlattenTicket.termsDigest
      && exactTicket.clientOrderId === activeFlattenTicket.clientOrderId
      && exactTicket.purpose === 'FLATTEN'
      && exactTicket.side === 'SELL'
      && exactTicket.type === 'LIMIT'
      && exactTicket.timeInForce === 'FOK';
  }
  if (
    exactTicket.purpose !== 'FLATTEN'
    || exactTicket.side !== 'SELL'
    || exactTicket.type !== 'LIMIT'
    || exactTicket.timeInForce !== 'FOK'
    || exactTicket.planId !== context.entryTicket.planId
    || exactTicket.correlationId !== context.entryTicket.correlationId
    || context.residualQuantity === null
  ) return false;
  try {
    const residual = normalizeSpotDecimal(
      context.residualQuantity,
      'residual quantity',
    );
    const tolerance = normalizeSpotDecimal(
      context.exchangeBaseTolerance as string,
      'exchange base tolerance',
    );
    const step = normalizeSpotDecimal(
      context.quantityStepSize as string,
      'quantity step size',
    );
    const maximumDust = normalizeSpotDecimal(
      context.maximumResidualDustNotionalQuote as string,
      'maximum residual dust notional quote',
    );
    const remainder = subtractSpotDecimals(residual, exactTicket.quantity);
    const derivedFlattenTicket = context.derivedFlattenTicket == null
      ? null
      : reconstructCanonicalSpotExecutionTicket(
          context.derivedFlattenTicket,
        );
    return derivedFlattenTicket !== null
      && step !== '0'
      && maximumDust !== '0'
      && maximumDust === card.maximumResidualDustNotionalQuote
      && compareSpotDecimals(tolerance, step) < 0
      && compareSpotDecimals(
        multiplySpotDecimals(maximumDust, '100'),
        context.entryTicket.orderNotionalQuote,
      ) <= 0
      && exactTicket.ticketId === derivedFlattenTicket.ticketId
      && exactTicket.termsDigest === derivedFlattenTicket.termsDigest
      && exactTicket.clientOrderId === derivedFlattenTicket.clientOrderId
      && compareSpotDecimals(exactTicket.quantity, residual) <= 0
      && compareSpotDecimals(remainder, tolerance) <= 0
      && compareSpotDecimals(
        multiplySpotDecimals(
          remainder,
          exactTicket.riskReferencePrice,
        ),
        maximumDust,
      ) <= 0
      && compareSpotDecimals(
        exactTicket.orderNotionalQuote,
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      ) <= 0;
  } catch {
    return false;
  }
}

/**
 * Pure cardinality/phase policy shared by the authority owner and persistence.
 * It grants no capability; it only answers whether another single-use
 * authority may be minted from already durable lifecycle facts.
 */
export function evaluateM0SpotActionCardinality(
  card: Readonly<M0SpotLifecycleCard>,
  action: M0SpotEgressAction,
  context: Readonly<M0SpotActionCardinalityContext>,
): M0SpotActionCardinalityDecision {
  const consumed = context.consumedActionCount;
  const limit =
    action === 'SIGNED_TEST'
      ? card.maximumSignedTestSubmissions
      : action === 'ENTRY'
        ? card.maximumEntrySubmissions
        : action === 'ENTRY_CANCEL'
          ? card.maximumEntryCancelSubmissions
          : action === 'FLATTEN'
            ? card.maximumFlattenSubmissions
            : action === 'FLATTEN_CANCEL'
              ? card.maximumFlattenCancelSubmissions
              : M0_SPOT_MAXIMUM_RECOVERY_READ_SUBMISSIONS;
  const decision = (
    allowed: boolean,
    code: M0SpotActionCardinalityDecision['code'],
  ): M0SpotActionCardinalityDecision => Object.freeze({
    allowed,
    limit,
    consumed,
    code,
  });
  if (
    !Number.isSafeInteger(consumed)
    || consumed < 0
    || consumed >= limit
  ) return decision(false, 'ACTION_LIMIT_EXHAUSTED');
  if (context.disarmedSafe) return decision(false, 'LIFECYCLE_DISARMED');
  if (action === 'SIGNED_TEST' || action === 'ENTRY') {
    return context.armed
      && (action !== 'ENTRY' || context.newEntryArmed)
      ? decision(true, 'ACTION_ALLOWED')
      : decision(false, 'ENTRY_NOT_ARMED');
  }
  if (!context.recoveryActive || !context.entryPresent) {
    return decision(false, 'RECOVERY_NOT_ACTIVE');
  }
  if (action === 'FLATTEN') {
    if (!context.entryTerminal) {
      return decision(false, 'ENTRY_NOT_TERMINAL');
    }
    try {
      if (
        context.residualQuantity === null
        || compareSpotDecimals(
          normalizeSpotDecimal(
            context.residualQuantity,
            'recovery residual quantity',
          ),
          '0',
        ) <= 0
      ) return decision(false, 'NO_EXACT_RESIDUAL');
    } catch {
      return decision(false, 'NO_EXACT_RESIDUAL');
    }
  }
  if (
    action === 'FLATTEN_CANCEL'
    && context.activeFlattenPresent !== true
  ) return decision(false, 'NO_ACTIVE_FLATTEN');
  return decision(true, 'ACTION_ALLOWED');
}

/**
 * Validate one canonical, server-held per-action capability. Recovery actions
 * may be minted after the entry window or a process restart only while the
 * durable lifecycle covenant remains active; new entry never gains that
 * exception.
 */
export function validateM0SpotActionAuthority(
  authorityValue: unknown,
  card: Readonly<M0SpotLifecycleCard>,
  action: M0SpotEgressAction,
  ticket: Readonly<SpotExecutionTicket>,
  intent: unknown,
  context: Readonly<M0SpotActionAuthorityContext>,
  evaluatedAtMs: number,
  evaluatedMonotonicMs: number,
): M0SpotActionAuthorityValidation {
  const authority = snapshotRecord(authorityValue, AUTHORITY_FIELDS);
  const expectedIntentDigest = calculateM0SpotIntentDigest(intent);
  const recoveryAction = RECOVERY_ACTIONS.has(action);
  if (
    authority === null
    || authority.schema !== M0_SPOT_ACTION_AUTHORITY_SCHEMA
    || authority.version !== 1
    || typeof authority.authorizationId !== 'string'
    || !AUTHORIZATION_ID.test(authority.authorizationId)
    || authority.verification
      !== 'VERIFIED_BY_CANONICAL_LIFECYCLE_OWNER'
    || authority.lifecycleId !== context.lifecycleId
    || authority.lifecycleId !== deriveM0SpotLifecycleId(card.cardDigest)
    || authority.cardId !== card.cardId
    || authority.cardDigest !== card.cardDigest
    || authority.action !== action
    || authority.ticketId !== ticket.ticketId
    || authority.termsDigest !== ticket.termsDigest
    || authority.clientOrderId !== ticket.clientOrderId
    || authority.intentDigest !== expectedIntentDigest
    || authority.stateRevision !== context.stateRevision
    || authority.singleUse !== true
    || (recoveryAction && context.recoveryActive !== true)
    || (!recoveryAction && context.recoveryActive === true)
    || !actionTicketMatches(action, ticket, card, context)
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'AUTHORITY_BINDING_MISMATCH',
    });
  }

  const expectedAuthorizationId = deriveM0SpotActionAuthorizationId({
    lifecycleId: context.lifecycleId,
    action,
    ticketId: ticket.ticketId,
    intentDigest: expectedIntentDigest,
    stateRevision: context.stateRevision,
  });
  if (
    authority.authorizationId !== expectedAuthorizationId
    || typeof authority.clockFenceId !== 'string'
    || !CLOCK_FENCE_ID.test(authority.clockFenceId)
    || authority.clockFenceId !== context.currentClockFenceId
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'AUTHORITY_INVALID',
    });
  }

  if (
    !validUtcMs(evaluatedAtMs)
    || !validUtcMs(evaluatedMonotonicMs)
    || !validUtcMs(authority.issuedAtMs)
    || !validUtcMs(authority.expiresAtMs)
    || !validUtcMs(authority.issuedMonotonicMs)
    || !validUtcMs(authority.expiresMonotonicMs)
    || authority.issuedAtMs > evaluatedAtMs
    || authority.expiresAtMs <= evaluatedAtMs
    || authority.issuedMonotonicMs > evaluatedMonotonicMs
    || authority.expiresMonotonicMs <= evaluatedMonotonicMs
    || (Number(authority.expiresAtMs) - Number(authority.issuedAtMs))
      !== (
        Number(authority.expiresMonotonicMs)
        - Number(authority.issuedMonotonicMs)
      )
    || (!recoveryAction && (
      authority.issuedAtMs < card.issuedAtMs
      || authority.expiresAtMs > card.expiresAtMs
      || authority.issuedMonotonicMs < card.issuedMonotonicMs
      || authority.expiresMonotonicMs > card.expiresMonotonicMs
      || authority.clockFenceId !== card.clockFenceId
    ))
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'AUTHORITY_TIME_INVALID',
    });
  }

  return Object.freeze({
    ok: true as const,
    authority: Object.freeze({
      ...authority,
    }) as unknown as Readonly<M0SpotActionAuthority>,
  });
}

export function validateM0SpotActionConsumptionReceipt(
  receiptValue: unknown,
  authority: Readonly<M0SpotActionAuthority>,
  intent: unknown,
  currentClockFenceId: string,
  evaluatedAtMs: number,
  evaluatedMonotonicMs: number,
): receiptValue is Readonly<M0SpotActionConsumptionReceipt> {
  const receipt = snapshotRecord(receiptValue, RECEIPT_FIELDS);
  const expectedIntentDigest = calculateM0SpotIntentDigest(intent);
  return (
    receipt !== null
    && validUtcMs(evaluatedAtMs)
    && validUtcMs(evaluatedMonotonicMs)
    && receipt.schema === M0_SPOT_ACTION_CONSUMPTION_SCHEMA
    && receipt.version === 1
    && receipt.lifecycleId === authority.lifecycleId
    && receipt.authorizationId === authority.authorizationId
    && receipt.cardId === authority.cardId
    && receipt.cardDigest === authority.cardDigest
    && receipt.action === authority.action
    && receipt.ticketId === authority.ticketId
    && receipt.termsDigest === authority.termsDigest
    && receipt.clientOrderId === authority.clientOrderId
    && receipt.intentDigest === authority.intentDigest
    && receipt.intentDigest === expectedIntentDigest
    && receipt.stateRevision === authority.stateRevision
    && receipt.nextStateRevision === authority.stateRevision + 1
    && receipt.clockFenceId === currentClockFenceId
    && receipt.clockFenceId === authority.clockFenceId
    && validUtcMs(receipt.consumedAtMs)
    && receipt.consumedAtMs <= evaluatedAtMs
    && receipt.consumedAtMs >= authority.issuedAtMs
    && receipt.consumedAtMs < authority.expiresAtMs
    && validUtcMs(receipt.consumedMonotonicMs)
    && receipt.consumedMonotonicMs <= evaluatedMonotonicMs
    && receipt.consumedMonotonicMs >= authority.issuedMonotonicMs
    && receipt.consumedMonotonicMs < authority.expiresMonotonicMs
    && receipt.state === 'CONSUMED_ONCE'
    && receipt.authorizationReuseAllowed === false
  );
}
