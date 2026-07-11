import {
  isLegLifecycle,
  isPlanLifecycle,
  isReconciliationStatus,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import {
  ACTION_URGENCIES,
  ALLOCATION_STATUSES,
  APPROVAL_MODES,
  CAPITAL_STAGES,
  ELIGIBILITY_STATUSES,
  POSITION_ACTION_INTENTS,
  POSITION_STATES,
  RESERVATION_STATES,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  isCapitalLifecycleState,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  weakestCapitalTruth,
  type ActivePosition,
  type CapitalTruthState,
  type CapitalMandate,
  type ExactDecimal,
  type OperatorApproval,
  type TruthMetadata,
} from '../contracts/index.js';
import type {
  CapitalAuthorityOwner,
  CapitalBlockCategory,
  CapitalCriticalPath,
  CapitalTopologyEdge,
  CapitalTopologyEdgeKind,
  CapitalTopologyFreshness,
  CapitalTopologyInput,
  CapitalTopologyNode,
  CapitalTopologyNodeKind,
  CapitalTopologySnapshot,
} from './types.js';

interface DraftNode extends Omit<CapitalTopologyNode,
  'effectiveBlockCategories' | 'rootCauseNodeIds' | 'upstreamIds' | 'downstreamIds' | 'operatorAttentionRequired'> {
  readonly localAttention: boolean;
}

interface DraftEdge {
  readonly id: string;
  readonly kind: CapitalTopologyEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly reasonCodes: readonly string[];
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort()) as readonly T[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256;
}

function positiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function nonNegativeSequence(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function nullableRevision(value: unknown): value is string | null {
  return value === null || nonEmpty(value);
}

function validObservedTime(value: unknown, evaluatedAtMs: number): value is number {
  return isValidUtcMillis(value) && value <= evaluatedAtMs;
}

function validWindow(start: unknown, end: unknown): boolean {
  return isValidUtcMillis(start) && isValidUtcMillis(end) && end > start;
}

function integrityReasons(checks: readonly (readonly [boolean, string])[]): readonly string[] {
  return Object.freeze(checks.filter(([valid]) => !valid).map(([, reason]) => reason));
}

function nodeId(kind: CapitalTopologyNodeKind, sourceId: string): string {
  return `ctn_${capitalDigest({ kind, sourceId })}`;
}

function edgeId(kind: CapitalTopologyEdgeKind, from: string, to: string): string {
  return `cte_${capitalDigest({ kind, from, to })}`;
}

function owner(kind: CapitalTopologyNodeKind, strategy?: string): CapitalAuthorityOwner {
  if (kind === 'STRATEGY_PROPOSAL') return strategy === 'BASIS' ? 'BASIS_ENGINE' : strategy === 'VOLUME' ? 'VOLUME_ENGINE' : 'UNKNOWN';
  if (kind === 'EVIDENCE' || kind === 'THESIS') return 'MARKET_INTELLIGENCE';
  if (kind === 'APPROVAL') return 'OPERATOR';
  if (kind === 'FUTURE_RISK') return 'BACKEND_FOUNDATION_RISK';
  if (kind === 'FUTURE_EXECUTION' || kind === 'POSITION_LEG') return 'BACKEND_FOUNDATION_EXECUTION';
  if (kind === 'RECONCILIATION') return 'BACKEND_FOUNDATION_RECONCILIATION';
  return 'CAPITAL_SUPERVISION';
}

function truthFields(truth: Readonly<TruthMetadata> | null, evaluatedAtMs: number): {
  freshness: CapitalTopologyFreshness;
  completeness: CapitalTruthState;
  degradedReasons: readonly string[];
} {
  if (truth === null) return { freshness: 'UNKNOWN', completeness: 'UNKNOWN', degradedReasons: Object.freeze(['TRUTH_NOT_SUPPLIED']) };
  const suppliedReasons = Array.isArray(truth.reasons)
    ? truth.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
  let freshness: CapitalTopologyFreshness;
  let completeness: CapitalTruthState;
  try {
    const reassessed = assessCapitalTruth({
      source: truth.source,
      evaluatedAtMs,
      requiredValuePresent: truth.completeness !== 'UNKNOWN',
      divergent: truth.completeness === 'DIVERGENT',
      reasons: suppliedReasons,
      evidenceReferences: truth.evidenceReferences,
      revision: truth.revision,
    });
    freshness = reassessed.freshness.state;
    completeness = weakestCapitalTruth([truth.completeness, reassessed.completeness]);
  } catch {
    return {
      freshness: 'UNKNOWN',
      completeness: truth.completeness === 'DIVERGENT' ? 'DIVERGENT' : 'UNKNOWN',
      degradedReasons: sortedUnique([...suppliedReasons, 'TRUTH_REEVALUATION_FAILED']),
    };
  }
  const degraded: string[] = [];
  if (freshness !== 'FRESH') degraded.push(`FRESHNESS_${freshness}`);
  if (completeness !== 'COMPLETE') degraded.push(`COMPLETENESS_${completeness}`);
  degraded.push(...suppliedReasons);
  return {
    freshness,
    completeness,
    degradedReasons: sortedUnique(degraded),
  };
}

function controls(kind: CapitalTopologyNodeKind): readonly string[] {
  const byKind: Partial<Record<CapitalTopologyNodeKind, readonly string[]>> = {
    STRATEGY_PROPOSAL: ['INSPECT_SOURCE_PROPOSAL'], EVIDENCE: ['INSPECT_EVIDENCE'],
    CAPITAL_BUDGET: ['INSPECT_ALLOCATION_AUDIT'], APPROVAL: ['REQUEST_OPERATOR_REVIEW'],
    FUTURE_RISK: ['REQUEST_FUTURE_RISK_RECHECK'], FUTURE_EXECUTION: ['INSPECT_EXECUTION_CORRELATION'],
    POSITION: ['INSPECT_POSITION'], RECONCILIATION: ['REQUEST_RECONCILIATION_REFRESH'],
    ACTION_INTENT: ['INSPECT_ACTION_INTENT'], ECONOMICS: ['INSPECT_ATTRIBUTION'],
    CHECKPOINT: ['INSPECT_CHECKPOINT'],
  };
  return Object.freeze([...(byKind[kind] ?? [])]);
}

interface NonNegativeExactFact {
  readonly valid: boolean;
  readonly positive: boolean;
}

interface ExactFact {
  readonly valid: boolean;
  readonly nonZero: boolean;
}

function inspectNonNegativeExactFact(value: unknown): NonNegativeExactFact {
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    const valid = normalized === value;
    return Object.freeze({ valid, positive: valid && normalized !== '0' });
  } catch {
    return Object.freeze({ valid: false, positive: false });
  }
}

function inspectExactFact(value: unknown): ExactFact {
  try {
    const normalized = normalizeExactDecimal(value);
    const valid = normalized === value;
    return Object.freeze({ valid, nonZero: valid && normalized !== '0' });
  } catch {
    return Object.freeze({ valid: false, nonZero: false });
  }
}

function canonicalExact(value: unknown): boolean {
  return inspectExactFact(value).valid;
}

function exactAtMost(left: unknown, right: unknown): boolean {
  const leftFact = inspectNonNegativeExactFact(left);
  const rightFact = inspectNonNegativeExactFact(right);
  return leftFact.valid && rightFact.valid
    && compareExactDecimals(left as ExactDecimal, right as ExactDecimal) <= 0;
}

function exactOrderValidIfComparable(left: unknown, right: unknown): boolean {
  const leftFact = inspectNonNegativeExactFact(left);
  const rightFact = inspectNonNegativeExactFact(right);
  return !leftFact.valid || !rightFact.valid || exactAtMost(left, right);
}

function isExposed(position: ActivePosition): boolean {
  const facts = [
    inspectNonNegativeExactFact(position.totalGrossExposure),
    inspectNonNegativeExactFact(position.oneLegExposure),
    ...position.legs.map((leg) => inspectNonNegativeExactFact(leg.quoteExposure)),
    ...position.legs.map((leg) => inspectNonNegativeExactFact(leg.quantity)),
  ];
  const netDirectionalExposure = inspectExactFact(position.netDirectionalExposure);
  const hedgeRatioInvalid = position.hedgeRatio !== null && !canonicalExact(position.hedgeRatio);
  // Invalid exposure is conservatively treated as potentially exposed so a
  // malformed public fact cannot erase an operator critical path.
  return facts.some((fact) => !fact.valid || fact.positive)
    || !netDirectionalExposure.valid
    || netDirectionalExposure.nonZero
    || hedgeRatioInvalid;
}

function approvalBindsMandate(
  approval: Readonly<OperatorApproval>,
  mandate: Readonly<CapitalMandate>,
): boolean {
  if (approval.mandateId !== mandate.id
      || approval.mandateRevision !== mandate.revision
      || approval.mandateDigest !== mandate.digest
      || approval.proposalIntakeDigest !== mandate.proposalIntakeDigest
      || approval.stagedPlanId !== mandate.stagedPlanId
      || approval.stagedPlanRevision !== mandate.stagedPlanRevision
      || approval.stagedPlanDigest !== mandate.stagedPlanDigest
      || approval.configRevision !== mandate.configRevision
      || approval.valuationAsset !== mandate.valuationAsset
      || approval.expiresAtMs > mandate.expiresAtMs) return false;
  return exactAtMost(approval.maximumNotional, mandate.targetMaximumExposure);
}

function categoryFor(kind: CapitalTopologyNodeKind, status: string, blocked = false): CapitalBlockCategory {
  const upper = status.toUpperCase();
  if (kind === 'STRATEGY_PROPOSAL' && /(REJECT|EXPIRE|CANCEL)/.test(upper)) return 'STRATEGY_REJECTION';
  if ((kind === 'OPPORTUNITY' || kind === 'CAPITAL_BUDGET' || kind === 'RESERVATION' || kind === 'MANDATE' || kind === 'STAGED_PLAN') && blocked) return 'CAPITAL_BLOCK';
  if (kind === 'APPROVAL' && blocked) return 'APPROVAL_BLOCK';
  if (kind === 'FUTURE_RISK' && blocked) return 'RISK_BLOCK';
  if ((kind === 'FUTURE_EXECUTION' || kind === 'POSITION_LEG' || kind === 'POSITION') && blocked) return 'EXECUTION_UNCERTAINTY';
  if (kind === 'RECONCILIATION' && blocked) {
    return upper === 'DIVERGED' || upper === 'AMBIGUOUS'
      ? 'RECONCILIATION_DIVERGENCE'
      : 'TRUTH_DEGRADATION';
  }
  if (kind === 'ECONOMICS' && blocked) return 'ECONOMIC_INVALIDATION';
  if (blocked) return 'TRUTH_DEGRADATION';
  return 'NONE';
}

export function projectActiveCapitalTopology(input: CapitalTopologyInput): Readonly<CapitalTopologySnapshot> {
  if (!isValidUtcMillis(input.evaluatedAtMs)) throw new TypeError('capital topology requires injected UTC evaluation time');
  const truthMap = new Map<string, Readonly<TruthMetadata>>();
  for (const item of input.truthReferences) {
    if (truthMap.has(item.sourceId)) throw new TypeError(`duplicate topology truth reference ${item.sourceId}`);
    truthMap.set(item.sourceId, item.truth);
  }
  const drafts = new Map<string, DraftNode>();
  const sourceNodes = new Map<string, string>();
  const edges = new Map<string, DraftEdge>();
  const addNode = (args: {
    kind: CapitalTopologyNodeKind; sourceId: string; status: string; truth?: Readonly<TruthMetadata> | null;
    strategy?: string; blocked?: boolean; blockingReasons?: readonly string[]; degradedReasons?: readonly string[];
    integrityReasons?: readonly string[]; lastTransitionAtMs?: number | null; exposed?: boolean; attention?: boolean;
  }): string => {
    const sourceIdentityValid = nonEmpty(args.sourceId);
    const rawSourceId = String(args.sourceId);
    const sourceId = sourceIdentityValid
      ? args.sourceId
      : `invalid:${args.kind}:${capitalDigest({ rawSourceId })}`;
    const statusValid = nonEmpty(args.status);
    const status = statusValid ? args.status : 'INVALID';
    const transitionTimeValid = args.lastTransitionAtMs === undefined || args.lastTransitionAtMs === null
      || validObservedTime(args.lastTransitionAtMs, input.evaluatedAtMs);
    const integrity = sortedUnique([
      ...(args.integrityReasons ?? []),
      ...(sourceIdentityValid ? [] : ['SOURCE_ID_INVALID']),
      ...(statusValid ? [] : ['STATUS_INVALID']),
      ...(transitionTimeValid ? [] : ['LAST_TRANSITION_TIME_INVALID']),
    ]);
    const forcedBlocked = (args.blocked ?? false) || integrity.length > 0;
    const id = nodeId(args.kind, sourceId);
    const existing = drafts.get(id);
    if (existing !== undefined) throw new TypeError(`duplicate topology node identity ${args.kind}:${sourceId}`);
    const truth = truthFields(args.truth ?? truthMap.get(rawSourceId) ?? null, input.evaluatedAtMs);
    const direct = categoryFor(args.kind, status, forcedBlocked);
    const block = direct === 'NONE' && truth.degradedReasons.length > 0 ? 'TRUTH_DEGRADATION' : direct;
    drafts.set(id, {
      id, sourceId, kind: args.kind, authorityOwner: owner(args.kind, args.strategy),
      status, freshness: truth.freshness, completeness: truth.completeness,
      directBlockCategory: block, blockingReasons: sortedUnique([...(args.blockingReasons ?? []), ...integrity]),
      degradedReasons: sortedUnique([...truth.degradedReasons, ...(args.degradedReasons ?? []), ...integrity]),
      lastTransitionAtMs: transitionTimeValid ? args.lastTransitionAtMs ?? null : null, supportedFutureControls: controls(args.kind),
      capitalExposed: args.exposed ?? false, localAttention: args.attention ?? block !== 'NONE',
    });
    sourceNodes.set(`${args.kind}|${rawSourceId}`, id);
    sourceNodes.set(`${args.kind}|${sourceId}`, id);
    return id;
  };
  const findNode = (kind: CapitalTopologyNodeKind, sourceId: string): string | null => sourceNodes.get(`${kind}|${sourceId}`) ?? null;
  const requireNode = (kind: CapitalTopologyNodeKind, sourceId: string, dependency: string): string => {
    const existing = findNode(kind, sourceId);
    if (existing !== null) return existing;
    return addNode({
      kind,
      sourceId,
      status: 'MISSING',
      blocked: true,
      blockingReasons: [`DEPENDENCY_NOT_SUPPLIED:${dependency}`],
      degradedReasons: ['TRUTH_NOT_SUPPLIED'],
      attention: true,
    });
  };
  const addEdge = (kind: CapitalTopologyEdgeKind, from: string | null, to: string | null, reasons: readonly string[] = []): void => {
    if (from === null || to === null || from === to) return;
    const id = edgeId(kind, from, to);
    const existing = edges.get(id);
    edges.set(id, existing === undefined
      ? { id, kind, from, to, reasonCodes: sortedUnique(reasons) }
      : { ...existing, reasonCodes: sortedUnique([...existing.reasonCodes, ...reasons]) });
  };

  for (const proposal of input.proposals) addNode({
    kind: 'STRATEGY_PROPOSAL', sourceId: proposal.sourceProposalId, status: proposal.sourceLifecycle,
    strategy: proposal.strategy, lastTransitionAtMs: proposal.updatedAtMs,
    integrityReasons: integrityReasons([
      [proposal.createdAtMs !== null && isValidUtcMillis(proposal.createdAtMs), 'PROPOSAL_CREATED_AT_INVALID'],
      [proposal.updatedAtMs !== null && validObservedTime(proposal.updatedAtMs, input.evaluatedAtMs), 'PROPOSAL_UPDATED_AT_INVALID'],
      [proposal.createdAtMs !== null && proposal.updatedAtMs !== null
        && isValidUtcMillis(proposal.createdAtMs) && isValidUtcMillis(proposal.updatedAtMs)
        && proposal.updatedAtMs >= proposal.createdAtMs, 'PROPOSAL_TIME_ORDER_INVALID'],
      [proposal.expiresAtMs === null || (isValidUtcMillis(proposal.expiresAtMs)
        && proposal.createdAtMs !== null && proposal.expiresAtMs > proposal.createdAtMs), 'PROPOSAL_EXPIRY_INVALID'],
    ]),
  });
  for (const evidence of input.evidence) addNode({ kind: 'EVIDENCE', sourceId: evidence.id, status: evidence.status, truth: evidence.truth, blockingReasons: evidence.reasonCodes, lastTransitionAtMs: evidence.lastTransitionAtMs });
  for (const item of input.considerations) addNode({
    kind: 'OPPORTUNITY', sourceId: item.id, status: item.status, truth: item.truth,
    blocked: item.status === 'BLOCKED', blockingReasons: item.reasons, lastTransitionAtMs: item.evaluatedAtMs,
    integrityReasons: integrityReasons([
      [(ELIGIBILITY_STATUSES as readonly unknown[]).includes(item.status), 'ELIGIBILITY_STATUS_INVALID'],
      [validObservedTime(item.evaluatedAtMs, input.evaluatedAtMs), 'CONSIDERATION_EVALUATED_AT_INVALID'],
    ]),
  });
  for (const item of input.allocationDecisions) addNode({
    kind: 'CAPITAL_BUDGET', sourceId: item.id, status: item.status,
    blocked: item.status === 'BLOCKED', blockingReasons: item.blockingReasons, lastTransitionAtMs: item.decidedAtMs,
    integrityReasons: integrityReasons([
      [(ALLOCATION_STATUSES as readonly unknown[]).includes(item.status), 'ALLOCATION_STATUS_INVALID'],
      [inspectNonNegativeExactFact(item.requestedAmount).valid, 'ALLOCATION_REQUESTED_AMOUNT_INVALID'],
      [inspectNonNegativeExactFact(item.grantedAmount).valid, 'ALLOCATION_GRANTED_AMOUNT_INVALID'],
      [exactOrderValidIfComparable(item.grantedAmount, item.requestedAmount), 'ALLOCATION_GRANT_EXCEEDS_REQUEST'],
      [validObservedTime(item.decidedAtMs, input.evaluatedAtMs), 'ALLOCATION_DECIDED_AT_INVALID'],
    ]),
  });
  for (const item of input.reservations) {
    const stateValid = (RESERVATION_STATES as readonly unknown[]).includes(item.state);
    const windowValid = validWindow(item.createdAtMs, item.expiresAtMs);
    const expired = stateValid && windowValid && item.state === 'ACTIVE' && item.expiresAtMs <= input.evaluatedAtMs;
    addNode({
      kind: 'RESERVATION',
      sourceId: item.id,
      status: expired ? 'EXPIRED' : item.state,
      blocked: expired || item.state !== 'ACTIVE',
      blockingReasons: expired ? ['RESERVATION_EXPIRED'] : item.state === 'ACTIVE' ? [] : [`RESERVATION_${item.state}`],
      lastTransitionAtMs: item.releasedAtMs ?? item.createdAtMs,
      integrityReasons: integrityReasons([
        [stateValid, 'RESERVATION_STATE_INVALID'],
        [positiveRevision(item.revision), 'RESERVATION_REVISION_INVALID'],
        [inspectNonNegativeExactFact(item.amount).valid, 'RESERVATION_AMOUNT_INVALID'],
        [inspectNonNegativeExactFact(item.consumedAmount).valid, 'RESERVATION_CONSUMED_AMOUNT_INVALID'],
        [exactOrderValidIfComparable(item.consumedAmount, item.amount), 'RESERVATION_CONSUMED_AMOUNT_EXCEEDS_AMOUNT'],
        [windowValid, 'RESERVATION_TIME_WINDOW_INVALID'],
        [item.releasedAtMs === null || (validObservedTime(item.releasedAtMs, input.evaluatedAtMs)
          && isValidUtcMillis(item.createdAtMs) && item.releasedAtMs >= item.createdAtMs), 'RESERVATION_RELEASE_TIME_INVALID'],
      ]),
    });
  }
  for (const item of input.stagedPlans) {
    const activeStageValid = (CAPITAL_STAGES as readonly unknown[]).includes(item.activeStage);
    const windowValid = validWindow(item.createdAtMs, item.expiresAtMs);
    const expired = windowValid && item.expiresAtMs <= input.evaluatedAtMs;
    const plan = addNode({
      kind: 'STAGED_PLAN', sourceId: item.id, status: expired ? 'EXPIRED' : item.activeStage,
      blocked: expired, lastTransitionAtMs: item.createdAtMs,
      integrityReasons: integrityReasons([
        [activeStageValid, 'STAGED_PLAN_ACTIVE_STAGE_INVALID'],
        [positiveRevision(item.revision), 'STAGED_PLAN_REVISION_INVALID'],
        [inspectNonNegativeExactFact(item.remainingReservedAmount).valid, 'STAGED_PLAN_REMAINING_AMOUNT_INVALID'],
        [windowValid, 'STAGED_PLAN_TIME_WINDOW_INVALID'],
      ]),
    });
    for (const stage of item.stages) {
      const stageId = addNode({
        kind: 'STAGE', sourceId: `${item.id}:${stage.sequence}`, status: stage.stage, lastTransitionAtMs: item.createdAtMs,
        integrityReasons: integrityReasons([
          [(CAPITAL_STAGES as readonly unknown[]).includes(stage.stage), 'STAGE_ENUM_INVALID'],
          [Number.isSafeInteger(stage.sequence) && stage.sequence >= 0, 'STAGE_SEQUENCE_INVALID'],
        ]),
      });
      addEdge('CONTAINS', plan, stageId);
    }
  }
  for (const item of input.mandates) {
    const windowValid = validWindow(item.createdAtMs, item.expiresAtMs);
    const expired = windowValid && item.expiresAtMs <= input.evaluatedAtMs;
    addNode({
      kind: 'MANDATE', sourceId: item.id, status: expired ? 'EXPIRED' : windowValid ? 'CURRENT' : 'INVALID',
      blocked: expired, lastTransitionAtMs: item.createdAtMs,
      integrityReasons: integrityReasons([
        [positiveRevision(item.revision), 'MANDATE_REVISION_INVALID'],
        [inspectNonNegativeExactFact(item.targetMaximumExposure).valid, 'MANDATE_TARGET_EXPOSURE_INVALID'],
        [windowValid, 'MANDATE_TIME_WINDOW_INVALID'],
      ]),
    });
  }
  for (const item of input.approvals) {
    const modeValid = (APPROVAL_MODES as readonly unknown[]).includes(item.mode);
    const windowValid = validWindow(item.issuedAtMs, item.expiresAtMs);
    const expired = windowValid && item.expiresAtMs <= input.evaluatedAtMs;
    const nonManual = item.mode !== 'MANUAL_ARMED';
    const blocked = item.revokedAtMs !== null || expired || nonManual;
    addNode({
      kind: 'APPROVAL',
      sourceId: item.id,
      status: item.revokedAtMs !== null ? 'REVOKED' : expired ? 'EXPIRED' : item.mode,
      blocked,
      blockingReasons: [
        ...(item.revokedAtMs !== null ? ['APPROVAL_REVOKED'] : []),
        ...(expired ? ['APPROVAL_EXPIRED'] : []),
        ...(nonManual ? ['APPROVAL_NOT_MANUAL_ARMED'] : []),
      ],
      lastTransitionAtMs: item.revokedAtMs ?? item.issuedAtMs,
      integrityReasons: integrityReasons([
        [modeValid, 'APPROVAL_MODE_INVALID'],
        [positiveRevision(item.mandateRevision), 'APPROVAL_MANDATE_REVISION_INVALID'],
        [positiveRevision(item.stagedPlanRevision), 'APPROVAL_PLAN_REVISION_INVALID'],
        [inspectNonNegativeExactFact(item.maximumNotional).valid, 'APPROVAL_MAXIMUM_NOTIONAL_INVALID'],
        [windowValid, 'APPROVAL_TIME_WINDOW_INVALID'],
        [item.revokedAtMs === null || (validObservedTime(item.revokedAtMs, input.evaluatedAtMs)
          && isValidUtcMillis(item.issuedAtMs) && item.revokedAtMs >= item.issuedAtMs), 'APPROVAL_REVOCATION_TIME_INVALID'],
      ]),
    });
  }
  for (const item of input.riskDecisions) {
    const decisionTimesValid = isValidUtcMillis(item.verdict.evaluatedAt)
      && isValidUtcMillis(item.verdict.expiresAt)
      && item.verdict.evaluatedAt <= input.evaluatedAtMs
      && item.verdict.expiresAt > item.verdict.evaluatedAt;
    const expiryMissing = !isValidUtcMillis(item.verdict.expiresAt);
    const expired = !expiryMissing && item.verdict.expiresAt <= input.evaluatedAtMs;
    addNode({
      kind: 'FUTURE_RISK',
      sourceId: item.decisionId,
      status: expiryMissing ? 'EXPIRY_UNKNOWN' : expired ? 'EXPIRED' : item.verdict.allowed ? 'ALLOWED' : 'BLOCKED',
      blocked: !item.verdict.allowed || expiryMissing || expired,
      blockingReasons: [
        ...item.verdict.blockingCodes,
        ...(expiryMissing ? ['RISK_DECISION_EXPIRY_MISSING'] : []),
        ...(expired ? ['RISK_DECISION_EXPIRED'] : []),
      ],
      lastTransitionAtMs: item.verdict.evaluatedAt,
      integrityReasons: integrityReasons([
        [nonEmpty(item.mandateId), 'RISK_MANDATE_ID_INVALID'],
        [typeof item.verdict.allowed === 'boolean', 'RISK_VERDICT_ALLOWED_INVALID'],
        [decisionTimesValid, 'RISK_DECISION_TIME_WINDOW_INVALID'],
      ]),
    });
  }
  for (const item of input.executionReferences) {
    const lifecycleValid = isPlanLifecycle(item.lifecycle);
    const blocked = !lifecycleValid || ['ONE_LEG_EXPOSED', 'RECOVERY_REQUIRED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(item.lifecycle);
    addNode({
      kind: 'FUTURE_EXECUTION',
      sourceId: item.id,
      status: item.lifecycle,
      truth: item.truth,
      blocked,
      blockingReasons: blocked ? [`EXECUTION_${item.lifecycle}`] : [],
      lastTransitionAtMs: item.observedAtMs,
      integrityReasons: integrityReasons([
        [lifecycleValid, 'EXECUTION_LIFECYCLE_INVALID'],
        [nonEmpty(item.externalPlanId) && nonEmpty(item.correlationId), 'EXECUTION_IDENTITY_INVALID'],
        [validObservedTime(item.observedAtMs, input.evaluatedAtMs), 'EXECUTION_OBSERVED_AT_INVALID'],
        [nonNegativeSequence(item.sequence), 'EXECUTION_SEQUENCE_INVALID'],
        [nullableRevision(item.revision), 'EXECUTION_REVISION_INVALID'],
      ]),
    });
  }
  for (const position of input.positions) {
    const totalGrossExposure = inspectNonNegativeExactFact(position.totalGrossExposure);
    const oneLegExposure = inspectNonNegativeExactFact(position.oneLegExposure);
    const exposed = isExposed(position);
    const stateValid = (POSITION_STATES as readonly unknown[]).includes(position.state);
    const lifecycleValid = isCapitalLifecycleState(position.capitalLifecycle);
    const oneLeg = oneLegExposure.positive
      || position.state === 'PARTIALLY_EXPOSED';
    const closedWithExposure = position.state === 'CLOSED' && exposed;
    const blocked = !stateValid || !lifecycleValid || position.state === 'UNKNOWN' || position.state === 'RECOVERY_REQUIRED' || oneLeg || closedWithExposure;
    const thesis = addNode({
      kind: 'THESIS', sourceId: position.thesis.id, status: `REVISION_${position.thesis.revision}`,
      lastTransitionAtMs: position.thesis.openedAtMs, exposed,
      integrityReasons: integrityReasons([
        [positiveRevision(position.thesis.revision), 'THESIS_REVISION_INVALID'],
        [validObservedTime(position.thesis.openedAtMs, input.evaluatedAtMs), 'THESIS_OPENED_AT_INVALID'],
      ]),
    });
    const positionNode = addNode({
      kind: 'POSITION',
      sourceId: position.id,
      status: position.state,
      truth: position.truth,
      blocked,
      blockingReasons: [
        ...(position.state === 'UNKNOWN' ? ['POSITION_STATE_UNKNOWN'] : []),
        ...(position.state === 'RECOVERY_REQUIRED' ? ['POSITION_RECOVERY_REQUIRED'] : []),
        ...(oneLeg ? ['ONE_LEG_EXPOSURE'] : []),
        ...(closedWithExposure ? ['CLOSED_POSITION_HAS_EXPOSURE'] : []),
      ],
      lastTransitionAtMs: position.lastTransitionAtMs,
      exposed,
      attention: exposed && blocked,
      integrityReasons: integrityReasons([
        [stateValid, 'POSITION_STATE_INVALID'],
        [lifecycleValid, 'POSITION_CAPITAL_LIFECYCLE_INVALID'],
        [positiveRevision(position.revision), 'POSITION_REVISION_INVALID'],
        [totalGrossExposure.valid, 'POSITION_TOTAL_GROSS_EXPOSURE_INVALID'],
        [oneLegExposure.valid, 'POSITION_ONE_LEG_EXPOSURE_INVALID'],
        [canonicalExact(position.netDirectionalExposure), 'POSITION_NET_DIRECTIONAL_EXPOSURE_INVALID'],
        [position.hedgeRatio === null || canonicalExact(position.hedgeRatio), 'POSITION_HEDGE_RATIO_INVALID'],
        [validObservedTime(position.openedAtMs, input.evaluatedAtMs), 'POSITION_OPENED_AT_INVALID'],
        [validObservedTime(position.lastTransitionAtMs, input.evaluatedAtMs)
          && isValidUtcMillis(position.openedAtMs) && position.lastTransitionAtMs >= position.openedAtMs, 'POSITION_TRANSITION_TIME_INVALID'],
      ]),
    });
    addEdge('EXPOSES', thesis, positionNode);
    for (const leg of position.legs) {
      const quantity = inspectNonNegativeExactFact(leg.quantity);
      const quoteExposure = inspectNonNegativeExactFact(leg.quoteExposure);
      const legExposed = !quoteExposure.valid || quoteExposure.positive;
      const uncertain = leg.externalLifecycle === null
        || ['SUBMITTING', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_PENDING', 'AMBIGUOUS'].includes(leg.externalLifecycle);
      const legLifecycleValid = leg.externalLifecycle === null || isLegLifecycle(leg.externalLifecycle);
      const legBlocked = !legLifecycleValid || (legExposed && (uncertain || oneLeg));
      const legNode = addNode({
        kind: 'POSITION_LEG',
        sourceId: leg.id,
        status: leg.externalLifecycle ?? 'UNKNOWN',
        truth: leg.truth,
        blocked: legBlocked,
        blockingReasons: [
          ...(leg.externalLifecycle === null ? ['LEG_LIFECYCLE_MISSING'] : []),
          ...(leg.externalLifecycle === 'PARTIALLY_FILLED' ? ['LEG_PARTIALLY_FILLED'] : []),
          ...(leg.externalLifecycle === 'AMBIGUOUS' ? ['LEG_LIFECYCLE_AMBIGUOUS'] : []),
          ...(oneLeg ? ['ONE_LEG_EXPOSURE'] : []),
        ],
        lastTransitionAtMs: position.lastTransitionAtMs,
        exposed: legExposed,
        integrityReasons: integrityReasons([
          [legLifecycleValid, 'LEG_LIFECYCLE_INVALID'],
          [quantity.valid, 'LEG_QUANTITY_INVALID'],
          [quoteExposure.valid, 'LEG_QUOTE_EXPOSURE_INVALID'],
        ]),
      });
      addEdge('CONTAINS', positionNode, legNode);
    }
  }
  for (const item of input.reconciliationReferences) {
    const statusValid = isReconciliationStatus(item.status);
    const blocked = !statusValid || item.status !== 'EXACT';
    addNode({
      kind: 'RECONCILIATION',
      sourceId: item.id,
      status: item.status,
      truth: item.truth,
      blocked,
      blockingReasons: [...item.reasonCodes, ...(blocked ? [`RECONCILIATION_${item.status}`] : [])],
      lastTransitionAtMs: item.observedAtMs,
      integrityReasons: integrityReasons([
        [statusValid, 'RECONCILIATION_STATUS_INVALID'],
        [nonEmpty(item.externalPlanId) && nonEmpty(item.correlationId), 'RECONCILIATION_IDENTITY_INVALID'],
        [validObservedTime(item.observedAtMs, input.evaluatedAtMs), 'RECONCILIATION_OBSERVED_AT_INVALID'],
        [nonNegativeSequence(item.sequence), 'RECONCILIATION_SEQUENCE_INVALID'],
        [nullableRevision(item.revision), 'RECONCILIATION_REVISION_INVALID'],
      ]),
    });
  }
  for (const item of input.supervisionDecisions) addNode({
    kind: 'SUPERVISION', sourceId: item.id, status: item.status, truth: item.truth,
    blockingReasons: item.reasonCodes, lastTransitionAtMs: item.lastTransitionAtMs,
    integrityReasons: integrityReasons([
      [nonEmpty(item.positionId), 'SUPERVISION_POSITION_ID_INVALID'],
      [positiveRevision(item.positionRevision), 'SUPERVISION_POSITION_REVISION_INVALID'],
      [positiveRevision(item.thesisRevision), 'SUPERVISION_THESIS_REVISION_INVALID'],
      [validObservedTime(item.lastTransitionAtMs, input.evaluatedAtMs), 'SUPERVISION_TRANSITION_TIME_INVALID'],
    ]),
  });
  for (const item of input.intents) addNode({
    kind: 'ACTION_INTENT', sourceId: item.id, status: item.kind,
    blocked: item.kind === 'NO_ACTION_UNKNOWN', blockingReasons: item.blockingFacts, lastTransitionAtMs: item.createdAtMs,
    exposed: input.positions.some((position) => position.id === item.positionId && isExposed(position)),
    attention: item.urgency === 'URGENT' || item.urgency === 'EMERGENCY',
    integrityReasons: integrityReasons([
      [(POSITION_ACTION_INTENTS as readonly unknown[]).includes(item.kind), 'ACTION_INTENT_KIND_INVALID'],
      [(ACTION_URGENCIES as readonly unknown[]).includes(item.urgency), 'ACTION_INTENT_URGENCY_INVALID'],
      [validObservedTime(item.createdAtMs, input.evaluatedAtMs), 'ACTION_INTENT_CREATED_AT_INVALID'],
      [item.hardDeadlineMs === null || isValidUtcMillis(item.hardDeadlineMs), 'ACTION_INTENT_DEADLINE_INVALID'],
    ]),
  });
  for (const item of input.economics) {
    const attribution = item.attribution;
    addNode({
      kind: 'ECONOMICS', sourceId: item.id,
      status: attribution.accountingIdentityProven ? attribution.completeness : 'IDENTITY_UNPROVEN',
      blocked: attribution.completeness === 'DIVERGENT' || !attribution.accountingIdentityProven,
      blockingReasons: [...attribution.divergentReasons, ...attribution.missingComponentKinds],
      lastTransitionAtMs: attribution.evaluatedAtMs,
      integrityReasons: integrityReasons([
        [positiveRevision(item.revision), 'ECONOMICS_REVISION_INVALID'],
        [validObservedTime(attribution.evaluatedAtMs, input.evaluatedAtMs), 'ECONOMICS_EVALUATED_AT_INVALID'],
      ]),
    });
  }
  if (input.checkpoint !== null) addNode({
    kind: 'CHECKPOINT', sourceId: input.checkpoint.id, status: `REVISION_${input.checkpoint.revision}`,
    truth: input.checkpoint.truth, lastTransitionAtMs: input.checkpoint.createdAtMs,
    integrityReasons: integrityReasons([
      [positiveRevision(input.checkpoint.revision), 'CHECKPOINT_REVISION_INVALID'],
      [validObservedTime(input.checkpoint.createdAtMs, input.evaluatedAtMs), 'CHECKPOINT_CREATED_AT_INVALID'],
    ]),
  });

  for (const item of input.considerations) {
    const opportunity = findNode('OPPORTUNITY', item.id);
    addEdge('DERIVES_FROM', requireNode('STRATEGY_PROPOSAL', item.proposal.sourceProposalId, `OPPORTUNITY:${item.id}`), opportunity);
    for (const evidenceId of item.evidencePacketIds) addEdge('EVIDENCES', requireNode('EVIDENCE', evidenceId, `OPPORTUNITY:${item.id}`), opportunity);
  }
  for (const item of input.allocationDecisions) addEdge('ALLOCATES', requireNode('OPPORTUNITY', item.considerationId, `CAPITAL_BUDGET:${item.id}`), findNode('CAPITAL_BUDGET', item.id));
  for (const item of input.reservations) {
    addEdge('RESERVES', requireNode('CAPITAL_BUDGET', item.allocationDecisionId, `RESERVATION:${item.id}`), findNode('RESERVATION', item.id));
    addEdge('RESERVES', requireNode('OPPORTUNITY', item.considerationId, `RESERVATION:${item.id}`), findNode('RESERVATION', item.id));
  }
  for (const item of input.stagedPlans) addEdge('PLANS', requireNode('RESERVATION', item.reservationId, `STAGED_PLAN:${item.id}`), findNode('STAGED_PLAN', item.id));
  for (const item of input.mandates) {
    const mandate = findNode('MANDATE', item.id);
    addEdge('ALLOCATES', requireNode('CAPITAL_BUDGET', item.allocationDecisionId, `MANDATE:${item.id}`), mandate);
    addEdge('RESERVES', requireNode('RESERVATION', item.reservationId, `MANDATE:${item.id}`), mandate);
    addEdge('PLANS', requireNode('STAGED_PLAN', item.stagedPlanId, `MANDATE:${item.id}`), mandate);
    const boundApprovals = input.approvals
      .filter((approval) => approvalBindsMandate(approval, item))
      .sort((left, right) => compareText(left.id, right.id));
    if (boundApprovals.length === 0) {
      addEdge('AUTHORIZES', requireNode('APPROVAL', `${item.id}:approval`, `MANDATE:${item.id}`), mandate);
    } else {
      for (const approval of boundApprovals) {
        addEdge('AUTHORIZES', requireNode('APPROVAL', approval.id, `MANDATE:${item.id}`), mandate);
      }
    }
    const risk = input.riskDecisions.find((decision) => decision.mandateId === item.id);
    addEdge('GATES', risk === undefined
      ? requireNode('FUTURE_RISK', `${item.id}:risk`, `MANDATE:${item.id}`)
      : requireNode('FUTURE_RISK', risk.decisionId, `MANDATE:${item.id}`), mandate);
  }
  for (const item of input.approvals) {
    addEdge('AUTHORIZES', requireNode('STRATEGY_PROPOSAL', item.proposalId, `APPROVAL:${item.id}`), findNode('APPROVAL', item.id));
    const claimedMandate = input.mandates.find((mandate) => mandate.id === item.mandateId);
    if (claimedMandate === undefined) {
      addEdge('AUTHORIZES', findNode('APPROVAL', item.id), requireNode('MANDATE', item.mandateId, `APPROVAL:${item.id}`));
    } else if (approvalBindsMandate(item, claimedMandate)) {
      addEdge('AUTHORIZES', findNode('APPROVAL', item.id), findNode('MANDATE', claimedMandate.id));
    }
  }
  for (const item of input.riskDecisions) addEdge('GATES', findNode('FUTURE_RISK', item.decisionId), requireNode('MANDATE', item.mandateId, `FUTURE_RISK:${item.decisionId}`), item.verdict.blockingCodes);
  for (const position of input.positions) {
    const positionNode = findNode('POSITION', position.id);
    addEdge('EXPOSES', requireNode('MANDATE', position.mandateId, `POSITION:${position.id}`), positionNode);
    if (position.executionReference === null) {
      if (isExposed(position)) addEdge('COORDINATES', requireNode('FUTURE_EXECUTION', `${position.id}:execution`, `POSITION:${position.id}`), positionNode);
    } else {
      addEdge('COORDINATES', requireNode('FUTURE_EXECUTION', position.executionReference.id, `POSITION:${position.id}`), positionNode);
    }
    if (position.reconciliationReference === null) {
      if (isExposed(position)) addEdge('RECONCILES', requireNode('RECONCILIATION', `${position.id}:reconciliation`, `POSITION:${position.id}`), positionNode);
    } else {
      addEdge('RECONCILES', requireNode('RECONCILIATION', position.reconciliationReference.id, `POSITION:${position.id}`), positionNode);
    }
    addEdge('DERIVES_FROM', requireNode('STRATEGY_PROPOSAL', position.thesis.proposalId, `THESIS:${position.thesis.id}`), findNode('THESIS', position.thesis.id));
    for (const evidenceId of position.thesis.originalEvidenceIds) addEdge('EVIDENCES', requireNode('EVIDENCE', evidenceId, `THESIS:${position.thesis.id}`), findNode('THESIS', position.thesis.id));
    if (isExposed(position) && position.legs.length === 0) {
      addEdge('CONTAINS', positionNode, requireNode('POSITION_LEG', `${position.id}:legs`, `POSITION:${position.id}`));
    }
    for (const intentId of position.outstandingActionIntentIds ?? []) {
      addEdge('RECOMMENDS', positionNode, requireNode('ACTION_INTENT', intentId, `POSITION:${position.id}`));
    }
  }
  for (const item of input.supervisionDecisions) {
    addEdge('SUPERVISES', requireNode('POSITION', item.positionId, `SUPERVISION:${item.id}`), findNode('SUPERVISION', item.id));
    for (const intentId of item.actionIntentIds) addEdge('RECOMMENDS', findNode('SUPERVISION', item.id), requireNode('ACTION_INTENT', intentId, `SUPERVISION:${item.id}`));
  }
  for (const item of input.intents) addEdge('RECOMMENDS', requireNode('POSITION', item.positionId, `ACTION_INTENT:${item.id}`), findNode('ACTION_INTENT', item.id));
  for (const item of input.economics) addEdge('ATTRIBUTES', requireNode('POSITION', item.positionId, `ECONOMICS:${item.id}`), findNode('ECONOMICS', item.id));
  if (input.checkpoint !== null) {
    const checkpoint = findNode('CHECKPOINT', input.checkpoint.id);
    for (const recordId of input.checkpoint.recordIds) {
      const node = [...drafts.values()].find((item) => item.sourceId === recordId);
      addEdge('CHECKPOINTS', node?.id
        ?? requireNode('CHECKPOINT', `${input.checkpoint.id}:record:${recordId}`, `CHECKPOINT:${input.checkpoint.id}`), checkpoint);
    }
  }
  for (const position of input.positions.filter(isExposed)) {
    const positionNode = findNode('POSITION', position.id);
    if (!input.supervisionDecisions.some((item) => item.positionId === position.id)) {
      addEdge('SUPERVISES', positionNode, requireNode('SUPERVISION', `${position.id}:supervision`, `POSITION:${position.id}`));
    }
    if (!input.economics.some((item) => item.positionId === position.id)) {
      addEdge('ATTRIBUTES', positionNode, requireNode('ECONOMICS', `${position.id}:economics`, `POSITION:${position.id}`));
    }
    if (input.checkpoint === null || !input.checkpoint.recordIds.includes(position.id)) {
      addEdge('CHECKPOINTS', positionNode, requireNode('CHECKPOINT', `${position.id}:checkpoint`, `POSITION:${position.id}`));
    }
  }

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of drafts.keys()) { incoming.set(id, []); outgoing.set(id, []); }
  for (const edge of edges.values()) { outgoing.get(edge.from)?.push(edge.to); incoming.get(edge.to)?.push(edge.from); }
  const positionScope = (positionNodeId: string): ReadonlySet<string> => {
    const scope = new Set<string>([positionNodeId]);
    const ancestors = [positionNodeId];
    while (ancestors.length > 0) {
      const current = ancestors.shift()!;
      for (const upstream of incoming.get(current) ?? []) {
        if (scope.has(upstream)) continue;
        scope.add(upstream);
        ancestors.push(upstream);
      }
    }
    const descendants = [positionNodeId];
    while (descendants.length > 0) {
      const current = descendants.shift()!;
      for (const downstream of outgoing.get(current) ?? []) {
        if (scope.has(downstream)) continue;
        scope.add(downstream);
        descendants.push(downstream);
      }
    }
    return scope;
  };
  const roots = new Map<string, Set<string>>();
  for (const node of drafts.values()) roots.set(node.id, new Set(node.directBlockCategory === 'NONE' ? [] : [node.id]));
  for (let pass = 0; pass < drafts.size; pass += 1) {
    let changed = false;
    for (const edge of edges.values()) for (const root of roots.get(edge.from) ?? []) {
      const target = roots.get(edge.to)!;
      if (!target.has(root)) { target.add(root); changed = true; }
    }
    if (!changed) break;
  }
  const exposedNodes = new Set<string>();
  for (const node of drafts.values()) if (node.kind === 'POSITION' && node.capitalExposed) {
    for (const scoped of positionScope(node.id)) exposedNodes.add(scoped);
  }
  const nodes: CapitalTopologyNode[] = [...drafts.values()].map((draft) => {
    const rootIds = sortedUnique([...(roots.get(draft.id) ?? [])]);
    const categories = sortedUnique(rootIds.map((id) => drafts.get(id)!.directBlockCategory).filter((item) => item !== 'NONE'));
    const exposed = draft.capitalExposed || exposedNodes.has(draft.id);
    const attention = draft.localAttention || (exposed && (draft.degradedReasons.length > 0 || categories.length > 0));
    const { localAttention: _local, ...base } = draft;
    return Object.freeze({ ...base, effectiveBlockCategories: categories, rootCauseNodeIds: rootIds,
      upstreamIds: sortedUnique(incoming.get(draft.id) ?? []), downstreamIds: sortedUnique(outgoing.get(draft.id) ?? []),
      capitalExposed: exposed, operatorAttentionRequired: attention });
  }).sort((left, right) => compareText(left.id, right.id));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const finalEdges: CapitalTopologyEdge[] = [...edges.values()].map((edge) => {
    const from = nodeMap.get(edge.from)!; const to = nodeMap.get(edge.to)!;
    const blocked = from.effectiveBlockCategories.some((item) => item !== 'TRUTH_DEGRADATION')
      || (to.directBlockCategory !== 'NONE' && to.directBlockCategory !== 'TRUTH_DEGRADATION');
    const degraded = from.degradedReasons.length > 0 || to.degradedReasons.length > 0
      || from.effectiveBlockCategories.includes('TRUTH_DEGRADATION')
      || to.directBlockCategory === 'TRUTH_DEGRADATION';
    return Object.freeze({ ...edge, status: blocked ? 'BLOCKED' as const : degraded ? 'DEGRADED' as const : 'ACTIVE' as const });
  }).sort((left, right) => compareText(left.id, right.id));
  const criticalPaths: CapitalCriticalPath[] = input.positions.filter(isExposed).map((position) => {
    const positionNode = nodeMap.get(findNode('POSITION', position.id)!)!;
    const visited = positionScope(positionNode.id);
    const pathNodes = [...visited].map((id) => nodeMap.get(id)!).filter(Boolean);
    const blocked = pathNodes.some((node) => node.effectiveBlockCategories.some((item) => item !== 'TRUTH_DEGRADATION'));
    const degraded = pathNodes.some((node) => node.degradedReasons.length > 0
      || node.effectiveBlockCategories.includes('TRUTH_DEGRADATION'));
    const recovery = position.state === 'RECOVERY_REQUIRED' || position.state === 'UNKNOWN';
    const emergency = input.intents.some((intent) => intent.positionId === position.id && intent.urgency === 'EMERGENCY');
    return Object.freeze({ positionId: position.id, positionNodeId: positionNode.id,
      nodeIds: sortedUnique([...visited]), rootCauseNodeIds: sortedUnique(pathNodes.flatMap((node) => node.rootCauseNodeIds)),
      status: recovery ? 'RECOVERY_REQUIRED' as const : blocked ? 'BLOCKED' as const : degraded ? 'DEGRADED' as const : 'CLEAR' as const,
      urgency: emergency || recovery ? 'EMERGENCY' as const : blocked ? 'URGENT' as const : degraded ? 'ELEVATED' as const : 'ROUTINE' as const });
  }).sort((left, right) => {
    const rank = { EMERGENCY: 3, URGENT: 2, ELEVATED: 1, ROUTINE: 0 } as const;
    return rank[right.urgency] - rank[left.urgency] || compareText(left.positionId, right.positionId);
  });
  const attentionNodes = nodes.filter((node) => node.operatorAttentionRequired).sort((left, right) =>
    (right.capitalExposed ? 1 : 0) - (left.capitalExposed ? 1 : 0)
    || (right.directBlockCategory !== 'NONE' ? 1 : 0) - (left.directBlockCategory !== 'NONE' ? 1 : 0)
    || compareText(left.id, right.id));
  const status = criticalPaths.some((path) => path.status === 'RECOVERY_REQUIRED' || path.status === 'BLOCKED')
    ? 'ATTENTION_REQUIRED' : nodes.some((node) => node.degradedReasons.length > 0 || node.directBlockCategory !== 'NONE') ? 'DEGRADED' : 'OPERATIONAL';
  return Object.freeze({
    id: `ctop_${capitalDigest({ evaluatedAtMs: input.evaluatedAtMs, nodes, edges: finalEdges, criticalPaths })}`,
    evaluatedAtMs: input.evaluatedAtMs, status, nodes: Object.freeze(nodes), edges: Object.freeze(finalEdges),
    criticalPaths: Object.freeze(criticalPaths), attentionNodeIds: Object.freeze(attentionNodes.map((node) => node.id)),
    exposedPositionIds: Object.freeze(input.positions.filter(isExposed).map((position) => position.id).sort()),
  });
}
