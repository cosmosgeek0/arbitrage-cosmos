/**
 * Lane H — derived observability model (dormant integration seam).
 *
 * Future wiring: a composition root captures existing supervisor, engine,
 * replay, reconciliation, and borrow evidence, then calls `deriveDiagnostics`
 * with its clock. This module registers no route, timer, socket, or singleton.
 */
export * from './types.js';
export * from './derive.js';
