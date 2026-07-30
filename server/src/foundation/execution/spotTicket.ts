/**
 * Canonical deterministic ticket for one Binance Spot order intent.
 *
 * A ticket is immutable and contains only explicit semantic inputs. Identical
 * inputs produce the same ticket ID and client-order ID across restarts.
 *
 * Pure module: no I/O, clocks, environment reads, or randomness.
 */
import {
  canonicalJson,
  deriveLegId,
  stableHash128Hex,
} from '../contracts/identity.js';
import { deriveBinanceSpotClientOrderId } from '../exchange/binanceSpot/clientOrderId.js';
import {
  multiplySpotDecimals,
  normalizeSpotDecimal,
} from '../exchange/binanceSpot/filters.js';

export const SPOT_EXECUTION_TICKET_SCHEMA = 'cosmos.spot-execution-ticket.v1';
export const SPOT_ORDER_SIDES = ['BUY', 'SELL'] as const;
export const SPOT_ORDER_TYPES = ['LIMIT', 'MARKET'] as const;
export const SPOT_TIME_IN_FORCE_VALUES = ['GTC', 'IOC', 'FOK'] as const;
export const SPOT_TICKET_PURPOSES = ['ENTRY', 'FLATTEN'] as const;

export type SpotOrderSide = (typeof SPOT_ORDER_SIDES)[number];
export type SpotOrderType = (typeof SPOT_ORDER_TYPES)[number];
export type SpotTimeInForce = (typeof SPOT_TIME_IN_FORCE_VALUES)[number];
export type SpotTicketPurpose = (typeof SPOT_TICKET_PURPOSES)[number];

export interface CreateSpotExecutionTicketInput {
  readonly correlationId: string;
  readonly planId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: SpotOrderSide;
  readonly type: SpotOrderType;
  readonly timeInForce: SpotTimeInForce | null;
  /** Base-asset quantity. */
  readonly quantity: string;
  /** Required for LIMIT and null for MARKET. */
  readonly price: string | null;
  /** Conservative explicit price used for MARKET policy-notional calculation. */
  readonly riskReferencePrice: string;
  /** Worst-case quote loss supplied by the upstream risk model. */
  readonly estimatedMaxLossQuote: string;
  readonly purpose: SpotTicketPurpose;
  /** Intentional venue submission generation, not a transport retry count. */
  readonly attempt: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface SpotExecutionTicket {
  readonly schema: typeof SPOT_EXECUTION_TICKET_SCHEMA;
  readonly ticketId: `spt_${string}`;
  readonly termsDigest: string;
  readonly legId: string;
  readonly correlationId: string;
  readonly planId: string;
  readonly accountId: string;
  readonly venue: 'BINANCE_SPOT';
  readonly symbol: string;
  readonly side: SpotOrderSide;
  readonly type: SpotOrderType;
  readonly timeInForce: SpotTimeInForce | null;
  readonly quantity: string;
  readonly price: string | null;
  readonly riskReferencePrice: string;
  /** LIMIT price, or the injected MARKET reference price. */
  readonly notionalPrice: string;
  readonly orderNotionalQuote: string;
  readonly estimatedMaxLossQuote: string;
  readonly purpose: SpotTicketPurpose;
  readonly riskEffect:
    | 'RISK_INCREASING'
    | 'UNPROVEN_RISK_REDUCTION';
  readonly attempt: number;
  readonly clientOrderId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

function requireLabel(
  fieldName: string,
  value: unknown,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value !== value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(
      `${fieldName} must be a trimmed non-empty label (<=${maxLength} chars)`,
    );
  }
  return value;
}

function requirePositiveDecimal(fieldName: string, value: unknown): string {
  const normalized = normalizeSpotDecimal(value as string, fieldName);
  if (normalized === '0') {
    throw new TypeError(`${fieldName} must be positive`);
  }
  return normalized;
}

function includes<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * Build and deeply freeze a canonical ticket. No current time is read: both
 * creation and expiry times are required semantic inputs.
 */
export function createSpotExecutionTicket(
  input: CreateSpotExecutionTicketInput,
): Readonly<SpotExecutionTicket> {
  const correlationId = requireLabel(
    'correlationId',
    input?.correlationId,
    256,
  );
  const planId = requireLabel('planId', input?.planId, 256);
  const accountId = requireLabel('accountId', input?.accountId, 256);
  const symbol = requireLabel('symbol', input?.symbol, 64);
  if (!includes(SPOT_ORDER_SIDES, input?.side)) {
    throw new TypeError('side must be BUY or SELL');
  }
  if (!includes(SPOT_ORDER_TYPES, input?.type)) {
    throw new TypeError('type must be LIMIT or MARKET');
  }
  if (!includes(SPOT_TICKET_PURPOSES, input?.purpose)) {
    throw new TypeError('purpose must be ENTRY or FLATTEN');
  }
  if (
    !Number.isSafeInteger(input?.attempt) ||
    input.attempt < 0 ||
    input.attempt > 999
  ) {
    throw new TypeError('attempt must be an integer in [0, 999]');
  }
  if (
    !Number.isSafeInteger(input?.createdAtMs) ||
    input.createdAtMs < 0 ||
    !Number.isSafeInteger(input?.expiresAtMs) ||
    input.expiresAtMs <= input.createdAtMs
  ) {
    throw new TypeError(
      'createdAtMs/expiresAtMs must be safe UTC milliseconds with expiry after creation',
    );
  }

  let timeInForce: SpotTimeInForce | null;
  let price: string | null;
  if (input.type === 'LIMIT') {
    if (!includes(SPOT_TIME_IN_FORCE_VALUES, input.timeInForce)) {
      throw new TypeError('LIMIT timeInForce must be GTC, IOC, or FOK');
    }
    timeInForce = input.timeInForce;
    price = requirePositiveDecimal('price', input.price);
  } else {
    if (input.timeInForce !== null || input.price !== null) {
      throw new TypeError('MARKET timeInForce and price must both be null');
    }
    timeInForce = null;
    price = null;
  }

  const quantity = requirePositiveDecimal('quantity', input.quantity);
  const riskReferencePrice = requirePositiveDecimal(
    'riskReferencePrice',
    input.riskReferencePrice,
  );
  const estimatedMaxLossQuote = normalizeSpotDecimal(
    input.estimatedMaxLossQuote,
    'estimatedMaxLossQuote',
  );
  const notionalPrice = price ?? riskReferencePrice;
  const orderNotionalQuote = multiplySpotDecimals(quantity, notionalPrice);
  const riskEffect =
    input.purpose === 'FLATTEN'
      ? ('UNPROVEN_RISK_REDUCTION' as const)
      : ('RISK_INCREASING' as const);

  const canonicalTerms = canonicalJson({
    schema: SPOT_EXECUTION_TICKET_SCHEMA,
    correlationId,
    planId,
    accountId,
    venue: 'BINANCE_SPOT',
    symbol,
    side: input.side,
    type: input.type,
    timeInForce,
    quantity,
    price,
    riskReferencePrice,
    notionalPrice,
    orderNotionalQuote,
    estimatedMaxLossQuote,
    purpose: input.purpose,
    riskEffect,
    attempt: input.attempt,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
  });
  const termsDigest = stableHash128Hex(
    `spotExecutionTicket|${canonicalTerms}`,
  );
  const ticketId = `spt_${termsDigest}` as const;
  const legId = deriveLegId({
    planId,
    legRole: `BINANCE_SPOT_${input.purpose}:${termsDigest}`,
  });
  const clientOrderId = deriveBinanceSpotClientOrderId({
    planId,
    legId,
    attempt: input.attempt,
  });

  return Object.freeze({
    schema: SPOT_EXECUTION_TICKET_SCHEMA,
    ticketId,
    termsDigest,
    legId,
    correlationId,
    planId,
    accountId,
    venue: 'BINANCE_SPOT' as const,
    symbol,
    side: input.side,
    type: input.type,
    timeInForce,
    quantity,
    price,
    riskReferencePrice,
    notionalPrice,
    orderNotionalQuote,
    estimatedMaxLossQuote,
    purpose: input.purpose,
    riskEffect,
    attempt: input.attempt,
    clientOrderId,
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
  });
}

/**
 * Reconstruct an untrusted ticket from only its semantic inputs and require
 * byte-for-byte canonical equality. TypeScript shapes, retained digests, and
 * client-order IDs are not authority: a clone with any changed or extra field
 * is rejected.
 */
export function reconstructCanonicalSpotExecutionTicket(
  value: unknown,
): Readonly<SpotExecutionTicket> | null {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
  ) return null;
  const ticket = value as Readonly<SpotExecutionTicket>;
  try {
    const rebuilt = createSpotExecutionTicket({
      correlationId: ticket.correlationId,
      planId: ticket.planId,
      accountId: ticket.accountId,
      symbol: ticket.symbol,
      side: ticket.side,
      type: ticket.type,
      timeInForce: ticket.timeInForce,
      quantity: ticket.quantity,
      price: ticket.price,
      riskReferencePrice: ticket.riskReferencePrice,
      estimatedMaxLossQuote: ticket.estimatedMaxLossQuote,
      purpose: ticket.purpose,
      attempt: ticket.attempt,
      createdAtMs: ticket.createdAtMs,
      expiresAtMs: ticket.expiresAtMs,
    });
    return canonicalJson(rebuilt) === canonicalJson(value)
      ? rebuilt
      : null;
  } catch {
    return null;
  }
}

export function isSameSpotExecutionIntent(
  left: Pick<SpotExecutionTicket, 'ticketId' | 'termsDigest'>,
  right: Pick<SpotExecutionTicket, 'ticketId' | 'termsDigest'>,
): boolean {
  return (
    left.ticketId === right.ticketId &&
    left.termsDigest === right.termsDigest
  );
}
