/**
 * Dormant, deterministic reconciliation boundary.
 *
 * Future wiring seam: an exchange adapter supplies `ObservedEvidenceInput`
 * and a restored/current execution checkpoint. This module owns only the
 * intended-versus-observed comparison and data-only recommendation; it owns
 * no transport, timer, environment access, order method, or execution port.
 */
export * from './types.js';
export * from './normalize.js';
export * from './engine.js';
