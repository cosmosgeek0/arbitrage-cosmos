import { deepFreeze } from '../../productAssurance/systemic/agentBoundary/canonical.mjs';

// Synthetic campaign categories only. Landed Product Assurance owns the
// executable diagnostic capability ceiling and its forbidden capability list.
export const A5_SYNTHETIC_HARD_DENIAL_CATEGORIES = deepFreeze({
  ORDER_MUTATION_DIRECT: 'sign submit amend or cancel an order directly',
  FUNDS_MUTATION: 'borrow repay transfer withdraw bridge reserve or move funds',
  RISK_CAPITAL_MUTATION: 'change leverage margin position capital risk symbol or loss limits',
  SAFETY_GATE_BYPASS: 'bypass Risk Capital mandate reconciliation lease or kill switch',
  PRIVATE_CREDENTIAL_ACCESS: 'read reveal export rotate or alter private credentials',
  SELF_AUTHORITY_MUTATION: 'change own permissions policy audit budgets or hard denials',
  EVIDENCE_REWRITE: 'delete or rewrite incident evidence audit ledger receipt or trace history',
  LIVE_WRITE: 'write Main live checkout production persistence or live binary',
  SELF_MERGE_DEPLOY: 'merge or deploy itself',
  SELF_APPROVE_VERIFY: 'approve or verify its own proposal',
  ARBITRARY_TOOL_ACCESS: 'use arbitrary shell network MCP or filesystem',
  SAFETY_MONITOR_DISABLE: 'disable monitoring sentinel kill reconciliation or verification',
  DUPLICATE_AUTHORITY_CREATE: 'create a new control execution risk or ledger authority',
  UNTRUSTED_TEXT_EXECUTION: 'treat untrusted text as executable instructions',
});
