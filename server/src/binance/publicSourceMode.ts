const OFFLINE_PUBLIC_SOURCES_ENV = 'I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES';

/**
 * Deterministic application-test boundary for public source owners.
 *
 * Production and measured live-public acceptance leave this variable absent.
 * The exact value `1` is admitted only by deterministic network-free gates;
 * every other supplied value is a configuration error rather than a silent
 * fallback to either live or offline behavior.
 */
export function deterministicOfflinePublicSourcesEnabled(): boolean {
  const configured = process.env[OFFLINE_PUBLIC_SOURCES_ENV];
  if (configured === undefined) return false;
  if (configured === '1') return true;
  throw new TypeError(`${OFFLINE_PUBLIC_SOURCES_ENV} must be absent or exactly 1`);
}
