/**
 * Foundation contracts — barrel (WAVE 0, frozen after the contract
 * checkpoint; only the lead may edit files in this directory).
 *
 * Foundation lanes import ONLY from this barrel with an explicit NodeNext
 * .js extension, e.g.:
 *
 *   import { deriveRiskVerdict, type RiskVerdict } from '../contracts/index.js';
 *
 * Module map:
 *   authority.ts      — DataAuthority vocabulary, downgrade law, unknown-value discipline
 *   time.ts           — SourcedTimestamp, UTC-ms validation, injected-clock freshness
 *   failures.ts       — StructuredFailure, ValidationIssue, ContractResult
 *   identity.ts       — canonical JSON, hash kernel, every deterministic ID kind
 *   runtime.ts        — RunMode/DesiredRuntimeState/RuntimePhase/ControlCommand + laws
 *   opportunity.ts    — canonical Basis/Volume decision/proposal shape + ordering
 *   execution.ts      — execution modes, plan/leg lifecycles + transition laws
 *   risk.ts           — RiskCheck/RiskVerdict + fail-closed derivation
 *   reconciliation.ts — reconciliation statuses/recommendations + severity law
 *   exchange.ts       — venue/transport vocabulary, client-order ID kernel
 *   diagnostics.ts    — diagnostic envelope + secret-rejection guard
 *
 * Every module is pure: no I/O, no wall clocks, no env reads, no import-time
 * side effects. Proven by server/test/foundation/contracts/import-purity.mjs.
 */
export * from './authority.js';
export * from './failures.js';
export * from './time.js';
export * from './identity.js';
export * from './runtime.js';
export * from './opportunity.js';
export * from './execution.js';
export * from './risk.js';
export * from './reconciliation.js';
export * from './exchange.js';
export * from './diagnostics.js';
