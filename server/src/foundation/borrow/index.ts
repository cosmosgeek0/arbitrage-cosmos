/** Pure read-only borrow truth surface. No client or capital-action methods are exported. */
export {
  compareNonNegativeDecimals,
  isExactZero,
  normalizeNonNegativeDecimal,
} from './decimal.js';
export { deriveBorrowTruth, deriveBorrowTruthBatch } from './derive.js';
export {
  BORROW_READ_STATUSES,
  BORROW_TRUTH_STATES,
  MARGIN_ACCOUNT_MODES,
  type BorrowAccountEvidence,
  type BorrowEvidenceProvenance,
  type BorrowFreshnessEvidence,
  type BorrowPermissionEvidence,
  type BorrowRateEvidence,
  type BorrowReadEvidenceBase,
  type BorrowReadStatus,
  type BorrowScopeIdentity,
  type BorrowTruth,
  type BorrowTruthReason,
  type BorrowTruthState,
  type DeriveBorrowTruthInput,
  type MarginAccountMode,
  type MaxBorrowEvidence,
} from './types.js';
