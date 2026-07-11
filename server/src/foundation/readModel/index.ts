/**
 * Lane B — Canonical Basis/Volume read model (foundation, dormant).
 *
 * Responsibility: republish the child engines' decisions/proposals in the
 * ONE frozen canonical shape (contracts/opportunity.ts) without inventing
 * values, mutating input, or holding state. The Basis and Volume engines
 * remain the only strategy authorities; this lane owns only the canonical
 * browser/read representation of their output.
 *
 * Module map:
 *   ports.ts        — narrow input ports (engine-shaped, engine-independent)
 *   canonicalize.ts — per-record mapping + named rejection
 *   readModel.ts    — buildCanonicalReadModel: sections, dedup, freshness,
 *                     reconciliation, deterministic ordering
 *
 * Live authority: NONE. No import-time side effects, no env, no network,
 * no fs, no wall clock — everything is injected.
 */
export * from './ports.js';
export * from './canonicalize.js';
export * from './readModel.js';
