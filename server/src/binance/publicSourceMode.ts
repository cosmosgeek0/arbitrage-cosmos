const OFFLINE_PUBLIC_SOURCES_ENV = 'I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES';
const STARTUP_EGRESS_ADMISSION_ENV = 'I00_PUBLIC_SOURCE_STARTUP_EGRESS';

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

/**
 * Positive admission for effectful public-source startup.
 *
 * Static source-catalog admission proves ownership only; it must not silently
 * authorize process startup to contact an external host. Absence keeps startup
 * fail-closed. The deterministic offline boundary and live startup admission
 * are mutually exclusive so a test cannot accidentally opt into transport.
 */
export function publicSourceStartupEgressAdmitted(): boolean {
  const configured = process.env[STARTUP_EGRESS_ADMISSION_ENV];
  if (configured === undefined) return false;
  if (configured !== '1') {
    throw new TypeError(`${STARTUP_EGRESS_ADMISSION_ENV} must be absent or exactly 1`);
  }
  if (deterministicOfflinePublicSourcesEnabled()) {
    throw new TypeError(`${STARTUP_EGRESS_ADMISSION_ENV} conflicts with ${OFFLINE_PUBLIC_SOURCES_ENV}`);
  }
  return true;
}
