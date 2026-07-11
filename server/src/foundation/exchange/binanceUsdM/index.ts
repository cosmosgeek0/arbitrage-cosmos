/**
 * Dormant USD-M Futures read/test-order boundary.
 *
 * Future wiring seam: construct BinanceUsdMClient with an injected clock,
 * signer, and transport adapter. This barrel deliberately exports no concrete
 * network transport and no live order, cancel, leverage, margin, borrow,
 * transfer, or withdrawal capability.
 */
export * from './types.js';
export * from './decimal.js';
export * from './signing.js';
export * from './validation.js';
export * from './redaction.js';
export { BinanceUsdMClient } from './client.js';
