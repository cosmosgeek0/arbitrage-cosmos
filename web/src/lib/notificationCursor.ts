export const MAX_NOTIFICATION_CURSOR = Number.MAX_SAFE_INTEGER;

const MAX_NOTIFICATION_CURSOR_DIGITS = String(MAX_NOTIFICATION_CURSOR).length;
const CANONICAL_NONNEGATIVE_INTEGER = /^(?:0|[1-9]\d*)$/;

/** Parse a storage-backed notification cursor without permitting coercion or NaN. */
export function parseNotificationCursor(value: unknown): number {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_NOTIFICATION_CURSOR_DIGITS
    || !CANONICAL_NONNEGATIVE_INTEGER.test(value)) return 0;

  const cursor = Number(value);
  return Number.isSafeInteger(cursor)
    && cursor >= 0
    && cursor <= MAX_NOTIFICATION_CURSOR
    ? cursor
    : 0;
}
