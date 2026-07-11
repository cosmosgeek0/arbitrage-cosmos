/**
 * Lane D — multi-leg risk evaluator (foundation, dormant).
 *
 * Public surface:
 *   evaluateMultiLegRisk(input)  — the one pure entry point.
 *   RiskEvaluationInput + evidence/policy/intent types — the snapshot shape.
 *   validateRiskEvaluationInput / validatePlanIntent / validateRiskPolicy —
 *     structural validation used at the entry boundary.
 *   CLOSE_BLOCKING_FAMILIES / isBlockingFamily — the risk-class blocking law.
 *
 * Verdict/check SHAPES come from the frozen contracts
 * (../contracts/index.js): RiskCheck, RiskVerdict, deriveRiskVerdict.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 * Live authority: NONE.
 */
export { evaluateMultiLegRisk } from './evaluator.js';
export { CLOSE_BLOCKING_FAMILIES, isBlockingFamily } from './checks.js';
export {
  BORROW_EVIDENCE_STATES,
  LEG_PERMISSIONS,
  LEG_SIDES,
  MAX_RISK_LEGS,
  POSITION_BUCKETS,
  deriveRiskIntentDigest,
  isBorrowEvidenceState,
  isLegPermission,
  isLegSide,
  isPositionBucket,
  validatePlanIntent,
  validateRiskEvaluationInput,
  validateRiskPolicy,
} from './types.js';
export type {
  AccountEvidence,
  ApprovalEvidence,
  BorrowEvidence,
  BorrowEvidenceState,
  CooldownEvidence,
  ExistingPlanSummary,
  ExistingPlansEvidence,
  ExposureSnapshotEvidence,
  KillSwitchEvidence,
  LegMarketEvidence,
  LegPermission,
  LegSide,
  LiquidationEvidence,
  MarginHeadroomEvidence,
  MarketEvidence,
  OpenOrdersEvidence,
  PermissionEvidence,
  PositionExposureEvidence,
  PositionBucket,
  PlanIntent,
  PlanLegIntent,
  ProposalEvidence,
  RiskEvaluationInput,
  RiskPolicy,
  SpotInventoryEvidence,
  SymbolFilterEvidence,
} from './types.js';
