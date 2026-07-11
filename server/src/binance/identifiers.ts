/**
 * Binance may introduce international asset identifiers. Keep them intact at
 * trust boundaries while excluding characters that can spoof logs, paths, or
 * operator-visible labels.
 */
export function boundedBinanceIdentifier(
  value: unknown,
  maxCodePoints = 64,
  maxBytes = 256,
): value is string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    return false;
  }
  if ([...value].length > maxCodePoints) return false;
  return !/[\/\\\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u.test(value);
}
