/**
 * Binance Spot-specific delegation to the canonical foundation client-order
 * identity owner. No second hash or identity algorithm lives in this module.
 *
 * Pure module: no I/O, clocks, environment reads, or randomness.
 */
import {
  CLIENT_ORDER_ID_MAX_LENGTH,
  CLIENT_ORDER_ID_PATTERN,
  deriveClientOrderId,
  isValidClientOrderId,
} from '../../contracts/exchange.js';

export const BINANCE_SPOT_CLIENT_ORDER_ID_MAX_LENGTH =
  CLIENT_ORDER_ID_MAX_LENGTH;
export const BINANCE_SPOT_CLIENT_ORDER_ID_PATTERN = CLIENT_ORDER_ID_PATTERN;

export interface BinanceSpotClientOrderIdInput {
  readonly planId: string;
  /** Stable semantic Spot leg identity, including entry/flatten purpose. */
  readonly legId: string;
  /** Intentional submission generation; ambiguous retries reuse it. */
  readonly attempt: number;
}

export function isBinanceSpotClientOrderId(value: unknown): value is string {
  return isValidClientOrderId(value);
}

/**
 * Thin venue-specific seam. Identity remains canonically owned by
 * `foundation/contracts/exchange.ts`.
 */
export function deriveBinanceSpotClientOrderId(
  input: BinanceSpotClientOrderIdInput,
): string {
  const derived = deriveClientOrderId(input);
  if (!isBinanceSpotClientOrderId(derived)) {
    throw new TypeError(
      'canonical client order ID violates Binance Spot constraints',
    );
  }
  return derived;
}
