import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA,
  L12_CHAIN_STAGES,
  L12_CRASH_FAULT_CUTS,
  L12_COLD_START_STEPS,
  L12_CONTROL_ACTIONS,
  L12_RECOVERY_SCENARIOS,
  type ExposureRecoveryProjectionInput,
  type L12CrashReplayWitness,
  type L12ProjectionStatus,
  type L12RecoveryCampaignEvidence,
  type L12SubjectIdentity,
  type L12SupervisorSnapshot,
} from './types.js';

const MAX_ARRAY = 256;
const MAX_DEPTH = 16;
const MAX_KEYS = 4_096;
const MAX_TEXT = 256;
const MAX_REASON_CODES = 64;
const RISK_INCREASING_ACTIONS = new Set([
  'ACTIVATE_PROPOSAL',
  'OPEN_EXPOSURE',
  'ADD_EXPOSURE',
  'REPEAT_ENTRY',
]);
const SAFE_DURING_HALT_ACTIONS = new Set([
  'MARKET_PRIVATE_STREAMS',
  'RECONCILIATION_READ',
  'CANCEL',
  'REDUCE',
  'CLOSE',
  'HEDGE',
  'UNWIND',
  'REPAY_LIABILITY',
  'RECOVERY',
  'LEDGER_READ_MODEL',
]);
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const SECRET_FIELD = /^(?:api[-_]?key|secret|credential|password|private[-_]?key|signature|access[-_]?token)$/i;
const CHAIN_OWNER = Object.freeze({
  PROPOSAL: 'STRATEGY_OWNER',
  CAPITAL_MANDATE: 'CAPITAL_FOUNDATION',
  RESERVATION: 'CAPITAL_FOUNDATION',
  APPROVAL_AUTHORITY: 'CAPITAL_APPROVALS',
  RISK_VERDICT: 'FOUNDATION_RISK',
  TICKET_PREFLIGHT: 'FOUNDATION_EXECUTION',
  MUTATION_DISPATCH: 'FOUNDATION_EXECUTION',
  CONFIRMED_FILL_EXPOSURE: 'FOUNDATION_EXECUTION',
  RESERVATION_SETTLEMENT: 'CAPITAL_FOUNDATION',
  OUTCOME_RECONCILIATION: 'FOUNDATION_RECONCILIATION',
} as const);

function assertClosedPlainData(value: unknown): void {
  let keys = 0;
  const seen = new Set<object>();
  const visiting = new Set<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new RangeError('L12 input exceeds the maximum depth');
    if (candidate === null || ['string', 'number', 'boolean'].includes(typeof candidate)) return;
    if (typeof candidate !== 'object') throw new TypeError('L12 input must contain plain serializable data only');
    if (visiting.has(candidate)) throw new TypeError('L12 input must not contain cycles');
    if (seen.has(candidate)) return;
    visiting.add(candidate);
    if (Object.getOwnPropertySymbols(candidate).length > 0) throw new TypeError('L12 input must not contain symbol fields');
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const names = Object.keys(descriptors).filter((name) => !Array.isArray(candidate) || name !== 'length');
    keys += names.length;
    if (keys > MAX_KEYS) throw new RangeError('L12 input exceeds the maximum field count');
    const prototype = Object.getPrototypeOf(candidate);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || candidate.length > MAX_ARRAY) {
        throw new TypeError('L12 arrays must be bounded ordinary arrays');
      }
      for (let index = 0; index < candidate.length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new TypeError('L12 arrays must not be sparse');
      }
      if (names.some((name) => !/^(?:0|[1-9]\d*)$/.test(name)
        || Number(name) >= candidate.length)) {
        throw new TypeError('L12 arrays must not contain non-index properties');
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('L12 records must be plain objects');
    }
    for (const name of names) {
      if (SECRET_FIELD.test(name)) throw new TypeError(`L12 input forbids sensitive field ${name}`);
      const descriptor = descriptors[name];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError('L12 input forbids accessors and hidden fields');
      }
      visit(descriptor.value, depth + 1);
    }
    visiting.delete(candidate);
    seen.add(candidate);
  };
  visit(value, 0);
}

function cloneFreeze<T>(value: T): Readonly<T> {
  const copy = structuredClone(value) as T;
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(candidate))) {
      if (Object.hasOwn(descriptor, 'value')) visit(descriptor.value);
    }
    Object.freeze(candidate);
  };
  visit(copy);
  return copy as Readonly<T>;
}

function text(value: unknown, name: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[], name: string): void {
  const found = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(found) !== canonicalJson(wanted)) {
    throw new TypeError(`${name} must use its exact closed schema`);
  }
}

function revision(value: unknown, name: string): string {
  return text(value, name, 256);
}

function time(value: unknown, name: string): number {
  if (!isValidUtcMillis(value)) throw new TypeError(`${name} must be a valid UTC millisecond timestamp`);
  return value as number;
}

function nullableTime(value: unknown, name: string): number | null {
  return value === null ? null : time(value, name);
}

function decimal(value: unknown, name: string, nonNegative = false): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 128 || !DECIMAL.test(value) || value === '-0'
      || (nonNegative && value.startsWith('-'))) {
    throw new TypeError(`${name} must be null or a canonical plain-decimal owner value`);
  }
  return value;
}

function stringList(value: unknown, name: string, maximum = MAX_REASON_CODES): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${name} must be a bounded array`);
  const result = value.map((entry, index) => text(entry, `${name}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${name} must not contain duplicates`);
  return Object.freeze(result);
}

function sameSubject(left: Readonly<L12SubjectIdentity>, right: Readonly<L12SubjectIdentity>): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function validateSubject(subject: Readonly<L12SubjectIdentity>): void {
  exactKeys(subject, [
    'strategy', 'proposalId', 'assessmentId', 'mandateId', 'reservationId', 'approvalId',
    'planOrLifecycleId', 'correlationId', 'accountRealmId', 'symbol',
  ], 'subject');
  if (!['NORMAL_BASIS', 'REVERSE_BASIS', 'VOLUME'].includes(subject?.strategy)) {
    throw new TypeError('subject.strategy is invalid');
  }
  text(subject.proposalId, 'subject.proposalId');
  if (subject.assessmentId !== null) text(subject.assessmentId, 'subject.assessmentId');
  text(subject.mandateId, 'subject.mandateId');
  text(subject.reservationId, 'subject.reservationId');
  if (subject.approvalId !== null) text(subject.approvalId, 'subject.approvalId');
  text(subject.planOrLifecycleId, 'subject.planOrLifecycleId');
  text(subject.correlationId, 'subject.correlationId');
  text(subject.accountRealmId, 'subject.accountRealmId');
  text(subject.symbol, 'subject.symbol', 64);
}

function requireSubject(subject: Readonly<L12SubjectIdentity>, expected: Readonly<L12SubjectIdentity>, name: string): void {
  validateSubject(subject);
  if (!sameSubject(subject, expected)) throw new TypeError(`${name} is bound to a different owner subject`);
}

function validateChain(input: Readonly<ExposureRecoveryProjectionInput>): void {
  if (!Array.isArray(input.chain) || input.chain.length !== L12_CHAIN_STAGES.length) {
    throw new TypeError('chain must contain every §19 stage exactly once');
  }
  let priorTime = 0;
  let prerequisiteBlocked = false;
  input.chain.forEach((stage, index) => {
    const expectedStage = L12_CHAIN_STAGES[index];
    if (expectedStage === undefined) throw new TypeError(`chain[${index}] is unexpected`);
    exactKeys(stage, ['stage', 'owner', 'status', 'subject', 'revision', 'observedAtMs', 'reasonCodes'], `chain[${index}]`);
    if (stage.stage !== expectedStage) throw new TypeError(`chain[${index}] is out of order`);
    if (stage.owner !== CHAIN_OWNER[expectedStage]) {
      throw new TypeError(`chain[${index}].owner is not the canonical owner for ${stage.stage}`);
    }
    if (!['COMPLETE', 'BLOCKED', 'OWNER_GATED', 'NOT_APPLICABLE'].includes(stage.status)) {
      throw new TypeError(`chain[${index}].status is invalid`);
    }
    requireSubject(stage.subject, input.subject, `chain[${index}].subject`);
    revision(stage.revision, `chain[${index}].revision`);
    const observedAtMs = time(stage.observedAtMs, `chain[${index}].observedAtMs`);
    if (observedAtMs < priorTime) throw new TypeError('chain chronology must be monotonic');
    priorTime = observedAtMs;
    stringList(stage.reasonCodes, `chain[${index}].reasonCodes`);
    if (stage.status === 'NOT_APPLICABLE'
        && (stage.stage !== 'APPROVAL_AUTHORITY'
          || !stage.reasonCodes.includes('OWNER_DECLARED_NOT_REQUIRED'))) {
      throw new TypeError('NOT_APPLICABLE is allowed only for owner-declared approval authority');
    }
    if (prerequisiteBlocked && stage.status === 'COMPLETE') {
      throw new TypeError('a blocked or owner-gated chain prerequisite cannot be followed by a complete stage');
    }
    if (stage.status === 'BLOCKED' || stage.status === 'OWNER_GATED') prerequisiteBlocked = true;
  });
}

function validateRisk(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const risk = input.riskRecheck;
  exactKeys(risk, [
    'owner', 'subject', 'verdictRevision', 'truthRevision', 'mutationId', 'dispatchRevision',
    'evaluatedAtMs', 'mutationAttemptAtMs', 'maximumAgeMs', 'disposition', 'currentTruthUsed',
  ], 'riskRecheck');
  if (risk.owner !== 'FOUNDATION_RISK') throw new TypeError('riskRecheck.owner is invalid');
  requireSubject(risk.subject, input.subject, 'riskRecheck.subject');
  revision(risk.verdictRevision, 'riskRecheck.verdictRevision');
  revision(risk.truthRevision, 'riskRecheck.truthRevision');
  text(risk.mutationId, 'riskRecheck.mutationId');
  revision(risk.dispatchRevision, 'riskRecheck.dispatchRevision');
  const evaluated = time(risk.evaluatedAtMs, 'riskRecheck.evaluatedAtMs');
  const attempted = time(risk.mutationAttemptAtMs, 'riskRecheck.mutationAttemptAtMs');
  if (!Number.isSafeInteger(risk.maximumAgeMs) || risk.maximumAgeMs < 0 || risk.maximumAgeMs > 60_000) {
    throw new TypeError('riskRecheck.maximumAgeMs must be a bounded non-negative integer');
  }
  if (attempted < evaluated || attempted - evaluated > risk.maximumAgeMs) {
    throw new TypeError('risk recheck is not immediately bound to the mutation attempt');
  }
  if (!['PASS', 'FAIL', 'UNKNOWN'].includes(risk.disposition) || typeof risk.currentTruthUsed !== 'boolean') {
    throw new TypeError('risk recheck verdict is invalid');
  }
  const dispatch = input.chain[L12_CHAIN_STAGES.indexOf('MUTATION_DISPATCH')];
  const riskStage = input.chain[L12_CHAIN_STAGES.indexOf('RISK_VERDICT')];
  if (riskStage?.revision !== risk.verdictRevision
      || dispatch?.revision !== risk.dispatchRevision
      || dispatch.observedAtMs !== risk.mutationAttemptAtMs
      || risk.truthRevision !== input.exposure.truthRevision) {
    throw new TypeError('risk recheck is not revision-bound to the exact truth and dispatch evidence');
  }
  if (dispatch?.status === 'COMPLETE' && (risk.disposition !== 'PASS' || risk.currentTruthUsed !== true)) {
    throw new TypeError('a completed mutation dispatch requires a current passing risk recheck');
  }
}

function validateControl(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const control = input.control;
  exactKeys(control, ['owner', 'subject', 'revision', 'halted', 'observedAtMs', 'admissions'], 'control');
  if (control.owner !== 'FOUNDATION_CONTROL') throw new TypeError('control.owner is invalid');
  requireSubject(control.subject, input.subject, 'control.subject');
  revision(control.revision, 'control.revision');
  time(control.observedAtMs, 'control.observedAtMs');
  if (typeof control.halted !== 'boolean' || !Array.isArray(control.admissions)
      || control.admissions.length !== L12_CONTROL_ACTIONS.length) {
    throw new TypeError('control admissions must cover the exact §19 kill-switch matrix');
  }
  control.admissions.forEach((entry, index) => {
    exactKeys(entry, ['action', 'allowed', 'ownerReasonCode'], `control.admissions[${index}]`);
    if (entry.action !== L12_CONTROL_ACTIONS[index] || typeof entry.allowed !== 'boolean') {
      throw new TypeError(`control.admissions[${index}] is invalid or out of order`);
    }
    text(entry.ownerReasonCode, `control.admissions[${index}].ownerReasonCode`);
    if (control.halted && RISK_INCREASING_ACTIONS.has(entry.action) && entry.allowed) {
      throw new TypeError(`halted control cannot admit ${entry.action}`);
    }
    if (control.halted && SAFE_DURING_HALT_ACTIONS.has(entry.action) && !entry.allowed) {
      throw new TypeError(`halted control must preserve ${entry.action}`);
    }
  });
}

function validateExposure(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const exposure = input.exposure;
  exactKeys(exposure, [
    'owner', 'source', 'subject', 'ownerRevision', 'truthRevision', 'completeness', 'observedAtMs',
    'spotBase', 'marginBase', 'futuresBaseEquivalent', 'netBase', 'grossNotional',
    'marginLiability', 'unhedgedNotional', 'unhedgedSinceMs',
  ], 'exposure');
  if (exposure.owner !== 'CAPITAL_FOUNDATION'
      || exposure.source !== 'CONFIRMED_FILLS_AND_RECONCILED_EXCHANGE_TRUTH') {
    throw new TypeError('exposure must come from confirmed-fill and reconciled Capital truth');
  }
  requireSubject(exposure.subject, input.subject, 'exposure.subject');
  revision(exposure.ownerRevision, 'exposure.ownerRevision');
  revision(exposure.truthRevision, 'exposure.truthRevision');
  time(exposure.observedAtMs, 'exposure.observedAtMs');
  if (!['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(exposure.completeness)) {
    throw new TypeError('exposure.completeness is invalid');
  }
  const values = [
    decimal(exposure.spotBase, 'exposure.spotBase'),
    decimal(exposure.marginBase, 'exposure.marginBase'),
    decimal(exposure.futuresBaseEquivalent, 'exposure.futuresBaseEquivalent'),
    decimal(exposure.netBase, 'exposure.netBase'),
    decimal(exposure.grossNotional, 'exposure.grossNotional', true),
    decimal(exposure.marginLiability, 'exposure.marginLiability', true),
    decimal(exposure.unhedgedNotional, 'exposure.unhedgedNotional', true),
  ];
  if (exposure.completeness === 'COMPLETE' && values.some((value) => value === null)) {
    throw new TypeError('complete exposure truth cannot contain unknown vector values');
  }
  const unhedgedSinceMs = nullableTime(exposure.unhedgedSinceMs, 'exposure.unhedgedSinceMs');
  if (exposure.unhedgedNotional !== null && exposure.unhedgedNotional !== '0' && unhedgedSinceMs === null) {
    throw new TypeError('non-zero unhedged notional requires owner-supplied unhedgedSinceMs');
  }
  if (exposure.unhedgedNotional === '0' && unhedgedSinceMs !== null) {
    throw new TypeError('zero unhedged notional cannot retain an unhedged timestamp');
  }
}

function validateCapital(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const capital = input.capital;
  exactKeys(capital, [
    'owner', 'subject', 'positionRevision', 'accountCapacityRevision', 'economicsRevision',
    'supervisionRevision', 'completeness', 'observedAtMs', 'availableCapacity', 'funding',
    'borrowCost', 'fees', 'realizedPnl', 'unrealizedPnl', 'supervisionIntent', 'requiredFutureGates',
  ], 'capital');
  if (capital.owner !== 'CAPITAL_FOUNDATION') throw new TypeError('capital.owner is invalid');
  requireSubject(capital.subject, input.subject, 'capital.subject');
  for (const [name, value] of Object.entries({
    positionRevision: capital.positionRevision,
    accountCapacityRevision: capital.accountCapacityRevision,
    economicsRevision: capital.economicsRevision,
    supervisionRevision: capital.supervisionRevision,
  })) revision(value, `capital.${name}`);
  time(capital.observedAtMs, 'capital.observedAtMs');
  if (!['COMPLETE', 'PARTIAL', 'UNKNOWN'].includes(capital.completeness)) {
    throw new TypeError('capital.completeness is invalid');
  }
  const values = [
    decimal(capital.availableCapacity, 'capital.availableCapacity', true),
    decimal(capital.funding, 'capital.funding'),
    decimal(capital.borrowCost, 'capital.borrowCost', true),
    decimal(capital.fees, 'capital.fees', true),
    decimal(capital.realizedPnl, 'capital.realizedPnl'),
    decimal(capital.unrealizedPnl, 'capital.unrealizedPnl'),
  ];
  if (capital.completeness === 'COMPLETE' && values.some((value) => value === null)) {
    throw new TypeError('complete capital economics cannot contain unknown values');
  }
  if (!['HOLD', 'ADD', 'REDUCE', 'HEDGE', 'EXIT', 'EMERGENCY', 'FREEZE', 'UNKNOWN'].includes(capital.supervisionIntent)) {
    throw new TypeError('capital.supervisionIntent is invalid');
  }
  stringList(capital.requiredFutureGates, 'capital.requiredFutureGates');
}

function validateReconciliation(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const reconciliation = input.reconciliation;
  exactKeys(reconciliation, [
    'owner', 'subject', 'revision', 'status', 'observedAtMs', 'orphanState',
    'orphanReferences', 'reasonCodes',
  ], 'reconciliation');
  if (!['FOUNDATION_RECONCILIATION', 'OWNER_INJECTED_RECONCILIATION_EVIDENCE'].includes(reconciliation.owner)) {
    throw new TypeError('reconciliation.owner is invalid');
  }
  if (input.subject.strategy !== 'NORMAL_BASIS' && reconciliation.owner === 'FOUNDATION_RECONCILIATION') {
    throw new TypeError('Foundation reconciliation cannot be stretched over Reverse Basis or Volume');
  }
  requireSubject(reconciliation.subject, input.subject, 'reconciliation.subject');
  revision(reconciliation.revision, 'reconciliation.revision');
  time(reconciliation.observedAtMs, 'reconciliation.observedAtMs');
  if (!['EXACT', 'MISMATCH', 'PARTIAL', 'STALE', 'UNKNOWN'].includes(reconciliation.status)
      || !['ABSENT', 'PRESENT', 'UNKNOWN'].includes(reconciliation.orphanState)) {
    throw new TypeError('reconciliation status is invalid');
  }
  const orphans = stringList(reconciliation.orphanReferences, 'reconciliation.orphanReferences');
  stringList(reconciliation.reasonCodes, 'reconciliation.reasonCodes');
  if (reconciliation.orphanState === 'ABSENT'
      && (reconciliation.status !== 'EXACT' || orphans.length !== 0)) {
    throw new TypeError('orphans may be ABSENT only under exact reconciliation with an empty explicit list');
  }
  if (reconciliation.orphanState === 'PRESENT' && orphans.length === 0) {
    throw new TypeError('PRESENT orphan state requires explicit owner references');
  }
}

function validateCanonicalTruth(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const binding = input.canonicalTruth;
  exactKeys(binding, [
    'owner', 'subject', 'accountingScopeId', 'mutationId', 'exposureTruthRevision', 'capitalPositionRevision',
    'accountCapacityRevision', 'reservationRevision', 'reservationSettlementRevision',
    'executionRevision', 'outstandingRevision', 'reconciliationRevision', 'recoveryRevision',
  ], 'canonicalTruth');
  if (binding.owner !== 'CAPITAL_FOUNDATION') throw new TypeError('canonicalTruth.owner is invalid');
  requireSubject(binding.subject, input.subject, 'canonicalTruth.subject');
  text(binding.accountingScopeId, 'canonicalTruth.accountingScopeId');
  text(binding.mutationId, 'canonicalTruth.mutationId');
  for (const [name, value] of Object.entries(binding).filter(([name]) => name.endsWith('Revision'))) {
    revision(value, `canonicalTruth.${name}`);
  }
  const reservation = input.chain[L12_CHAIN_STAGES.indexOf('RESERVATION')];
  const settlement = input.chain[L12_CHAIN_STAGES.indexOf('RESERVATION_SETTLEMENT')];
  const execution = input.chain[L12_CHAIN_STAGES.indexOf('CONFIRMED_FILL_EXPOSURE')];
  const outcome = input.chain[L12_CHAIN_STAGES.indexOf('OUTCOME_RECONCILIATION')];
  if (binding.mutationId !== input.riskRecheck.mutationId
      || binding.exposureTruthRevision !== input.exposure.truthRevision
      || binding.capitalPositionRevision !== input.exposure.ownerRevision
      || binding.capitalPositionRevision !== input.capital.positionRevision
      || binding.accountCapacityRevision !== input.capital.accountCapacityRevision
      || binding.reservationRevision !== reservation?.revision
      || binding.reservationSettlementRevision !== settlement?.revision
      || binding.executionRevision !== execution?.revision
      || binding.outstandingRevision !== input.outstanding.ownerRevision
      || binding.reconciliationRevision !== input.reconciliation.revision
      || binding.reconciliationRevision !== outcome?.revision
      || binding.recoveryRevision !== input.recovery.ownerRevision) {
    throw new TypeError('canonical truth revisions diverge across reservation, position, exposure, execution, or recovery');
  }
}

function validateRecovery(input: Readonly<ExposureRecoveryProjectionInput>): void {
  exactKeys(input.outstanding, [
    'owner', 'subject', 'ownerRevision', 'openOrderReferences', 'ambiguousMutationReferences',
    'unmatchedFillReferences', 'manualActivityReferences',
  ], 'outstanding');
  if (!['FOUNDATION_EXECUTION', 'OWNER_INJECTED_RECONCILIATION_EVIDENCE'].includes(input.outstanding.owner)) {
    throw new TypeError('outstanding.owner is invalid');
  }
  if (input.subject.strategy !== 'NORMAL_BASIS' && input.outstanding.owner === 'FOUNDATION_EXECUTION') {
    throw new TypeError('Foundation execution outstanding truth cannot be stretched over Reverse Basis or Volume');
  }
  requireSubject(input.outstanding.subject, input.subject, 'outstanding.subject');
  revision(input.outstanding.ownerRevision, 'outstanding.ownerRevision');
  const outstandingLists = Object.entries({
    openOrderReferences: input.outstanding.openOrderReferences,
    ambiguousMutationReferences: input.outstanding.ambiguousMutationReferences,
    unmatchedFillReferences: input.outstanding.unmatchedFillReferences,
    manualActivityReferences: input.outstanding.manualActivityReferences,
  });
  for (const [name, value] of outstandingLists) stringList(value, `outstanding.${name}`);
  const recovery = input.recovery;
  exactKeys(recovery, [
    'subject', 'required', 'ownerEndState', 'ownerRevision', 'residualExposure',
    'residualLiability', 'reasonCodes', 'recommendations',
  ], 'recovery');
  requireSubject(recovery.subject, input.subject, 'recovery.subject');
  if (typeof recovery.required !== 'boolean'
      || (recovery.ownerEndState !== null
        && !['OPEN', 'CLOSED', 'RECOVERED', 'MANUAL_INTERVENTION'].includes(recovery.ownerEndState))) {
    throw new TypeError('recovery state is invalid');
  }
  revision(recovery.ownerRevision, 'recovery.ownerRevision');
  const residualExposure = decimal(recovery.residualExposure, 'recovery.residualExposure', true);
  const residualLiability = decimal(recovery.residualLiability, 'recovery.residualLiability', true);
  stringList(recovery.reasonCodes, 'recovery.reasonCodes');
  if (!Array.isArray(recovery.recommendations) || recovery.recommendations.length > 64) {
    throw new TypeError('recovery.recommendations exceeds its bound');
  }
  recovery.recommendations.forEach((recommendation, index) => {
    exactKeys(recommendation, ['owner', 'kind', 'ownerRevision', 'automatic'], `recovery.recommendations[${index}]`);
    if (!['FOUNDATION_EXECUTION', 'FOUNDATION_RECONCILIATION', 'CAPITAL_FOUNDATION'].includes(recommendation.owner)
        || recommendation.automatic !== false) {
      throw new TypeError(`recovery.recommendations[${index}] is invalid`);
    }
    text(recommendation.kind, `recovery.recommendations[${index}].kind`);
    revision(recommendation.ownerRevision, `recovery.recommendations[${index}].ownerRevision`);
  });
  const outstanding = outstandingLists.some(([, value]) => (value as readonly string[]).length > 0);
  const terminal = recovery.ownerEndState === 'CLOSED' || recovery.ownerEndState === 'RECOVERED';
  if (terminal && (residualExposure !== '0' || residualLiability !== '0' || outstanding
      || input.reconciliation.status !== 'EXACT' || input.reconciliation.orphanState !== 'ABSENT')) {
    throw new TypeError('terminal recovery cannot hide residual exposure, liability, ambiguity, or orphans');
  }
  if (recovery.required && recovery.recommendations.length === 0) {
    throw new TypeError('required recovery must retain at least one non-automatic owner recommendation');
  }
  const mustRecover = outstanding
    || input.reconciliation.status !== 'EXACT'
    || input.reconciliation.orphanState !== 'ABSENT'
    || input.exposure.completeness !== 'COMPLETE'
    || residualExposure !== '0'
    || residualLiability !== '0'
    || recovery.ownerEndState === 'MANUAL_INTERVENTION';
  if (mustRecover && !recovery.required) {
    throw new TypeError('owner uncertainty, outstanding evidence, or manual intervention requires explicit recovery');
  }
}

function validateColdStart(input: Readonly<ExposureRecoveryProjectionInput>): boolean {
  const cold = input.coldStart;
  exactKeys(cold, ['startupPosture', 'steps', 'effectiveEntryMode', 'completenessRevision'], 'coldStart');
  if (!['HALTED', 'RECOVERY_REQUIRED'].includes(cold.startupPosture)
      || !['BLOCKED', 'OWNER_REVIEW_ONLY'].includes(cold.effectiveEntryMode)
      || !Array.isArray(cold.steps) || cold.steps.length !== L12_COLD_START_STEPS.length) {
    throw new TypeError('coldStart shape is invalid');
  }
  revision(cold.completenessRevision, 'coldStart.completenessRevision');
  let priorIncomplete = false;
  cold.steps.forEach((step, index) => {
    exactKeys(step, ['step', 'status', 'ownerRevision', 'observedAtMs', 'reasonCodes'], `coldStart.steps[${index}]`);
    if (step.step !== L12_COLD_START_STEPS[index]
        || !['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'FAILED', 'OWNER_GATED', 'UNAVAILABLE'].includes(step.status)) {
      throw new TypeError(`coldStart.steps[${index}] is invalid or out of order`);
    }
    if (step.ownerRevision === null) {
      if (step.status === 'COMPLETE') throw new TypeError('a complete cold-start step requires an owner revision');
    } else revision(step.ownerRevision, `coldStart.steps[${index}].ownerRevision`);
    if (step.observedAtMs === null) {
      if (step.status === 'COMPLETE') throw new TypeError('a complete cold-start step requires an observation time');
    } else time(step.observedAtMs, `coldStart.steps[${index}].observedAtMs`);
    stringList(step.reasonCodes, `coldStart.steps[${index}].reasonCodes`);
    if (priorIncomplete && step.status === 'COMPLETE') {
      throw new TypeError('cold-start steps cannot complete beyond an incomplete prerequisite');
    }
    if (step.status !== 'COMPLETE') priorIncomplete = true;
  });
  const prerequisitesComplete = cold.steps.slice(0, -1).every((step) => step.status === 'COMPLETE');
  const entryStepComplete = cold.steps.at(-1)?.status === 'COMPLETE';
  if ((!prerequisitesComplete || !entryStepComplete) && cold.effectiveEntryMode !== 'BLOCKED') {
    throw new TypeError('entry mode must remain blocked until cold-start completeness is proven');
  }
  if (prerequisitesComplete && entryStepComplete && cold.effectiveEntryMode !== 'OWNER_REVIEW_ONLY') {
    throw new TypeError('complete cold start may advance only to owner review');
  }
  return prerequisitesComplete && entryStepComplete;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function campaignTraceMaterial(campaign: Readonly<L12RecoveryCampaignEvidence>): object {
  return {
    scenario: campaign.scenario,
    campaignId: campaign.campaignId,
    subject: campaign.subject,
    terminalState: campaign.terminalState,
    ownerRevision: campaign.ownerRevision,
    fixtureAuthority: campaign.fixtureAuthority,
    duplicateOrderCount: campaign.duplicateOrderCount,
    residualExposureExplicit: campaign.residualExposureExplicit,
    residualLiabilityExplicit: campaign.residualLiabilityExplicit,
    hiddenResidualExposure: campaign.hiddenResidualExposure,
    hiddenResidualLiability: campaign.hiddenResidualLiability,
    traceAuthority: campaign.traceAuthority,
    traceRevision: campaign.traceRevision,
    initialStateRevision: campaign.initialStateRevision,
    terminalStateRevision: campaign.terminalStateRevision,
    mutationIdentities: campaign.mutationIdentities,
    replayObservedMutationIdentities: campaign.replayObservedMutationIdentities,
    terminalResidualExposure: campaign.terminalResidualExposure,
    terminalResidualLiability: campaign.terminalResidualLiability,
    terminalOutstandingReferences: campaign.terminalOutstandingReferences,
    replayWitnesses: campaign.replayWitnesses,
  };
}

export function deriveRecoveryCampaignTraceDigest(
  campaign: Readonly<Omit<L12RecoveryCampaignEvidence, 'traceDigest'>>,
): string {
  const material = campaignTraceMaterial(campaign as Readonly<L12RecoveryCampaignEvidence>);
  assertClosedPlainData(material);
  return `l12trace_${stableHash128Hex(canonicalJson(material))}`;
}

function validateCampaigns(input: Readonly<ExposureRecoveryProjectionInput>): void {
  if (!Array.isArray(input.campaigns) || input.campaigns.length !== L12_RECOVERY_SCENARIOS.length) {
    throw new TypeError('campaigns must cover every §20 recovery scenario exactly once');
  }
  const ids = new Set<string>();
  input.campaigns.forEach((campaign, index) => {
    exactKeys(campaign, [
      'scenario', 'campaignId', 'subject', 'terminalState', 'ownerRevision', 'fixtureAuthority',
      'duplicateOrderCount', 'residualExposureExplicit', 'residualLiabilityExplicit',
      'hiddenResidualExposure', 'hiddenResidualLiability', 'traceAuthority', 'traceDigest', 'traceRevision',
      'initialStateRevision', 'terminalStateRevision', 'mutationIdentities',
      'replayObservedMutationIdentities', 'terminalResidualExposure',
      'terminalResidualLiability', 'terminalOutstandingReferences',
      'replayWitnesses',
    ], `campaigns[${index}]`);
    if (campaign.scenario !== L12_RECOVERY_SCENARIOS[index]
        || campaign.fixtureAuthority !== 'SYNTHETIC_FAULT_INJECTION'
        || !['OPEN', 'CLOSED', 'RECOVERED', 'MANUAL_INTERVENTION'].includes(campaign.terminalState)
        || campaign.duplicateOrderCount !== 0
        || campaign.residualExposureExplicit !== true
        || campaign.residualLiabilityExplicit !== true
        || campaign.hiddenResidualExposure !== false
        || campaign.hiddenResidualLiability !== false
        || campaign.traceAuthority !== 'INJECTED_OWNER_TRACE_EVIDENCE') {
      throw new TypeError(`campaigns[${index}] violates recovery proof invariants`);
    }
    if (campaign.traceDigest !== deriveRecoveryCampaignTraceDigest(campaign)) {
      throw new TypeError(`campaigns[${index}] trace digest does not bind its owner evidence`);
    }
    const campaignId = text(campaign.campaignId, `campaigns[${index}].campaignId`);
    requireSubject(campaign.subject, input.subject, `campaigns[${index}].subject`);
    if (ids.has(campaignId)) throw new TypeError('campaign IDs must be unique');
    ids.add(campaignId);
    revision(campaign.ownerRevision, `campaigns[${index}].ownerRevision`);
    revision(campaign.traceRevision, `campaigns[${index}].traceRevision`);
    revision(campaign.initialStateRevision, `campaigns[${index}].initialStateRevision`);
    revision(campaign.terminalStateRevision, `campaigns[${index}].terminalStateRevision`);
    const mutationIdentities = stringList(campaign.mutationIdentities, `campaigns[${index}].mutationIdentities`, 64);
    if (mutationIdentities.length === 0) throw new TypeError('campaign trace must retain at least one deterministic mutation identity');
    const replayIdentities = stringList(
      campaign.replayObservedMutationIdentities,
      `campaigns[${index}].replayObservedMutationIdentities`,
      64,
    );
    if (replayIdentities.some((identity) => !mutationIdentities.includes(identity))) {
      throw new TypeError('campaign replay introduced a mutation identity absent from the owner trace');
    }
    const terminalResidualExposure = decimal(
      campaign.terminalResidualExposure,
      `campaigns[${index}].terminalResidualExposure`,
      true,
    );
    const terminalResidualLiability = decimal(
      campaign.terminalResidualLiability,
      `campaigns[${index}].terminalResidualLiability`,
      true,
    );
    const terminalOutstanding = stringList(
      campaign.terminalOutstandingReferences,
      `campaigns[${index}].terminalOutstandingReferences`,
      64,
    );
    if (['CLOSED', 'RECOVERED'].includes(campaign.terminalState)
        && (terminalResidualExposure !== '0' || terminalResidualLiability !== '0'
          || terminalOutstanding.length !== 0)) {
      throw new TypeError('campaign terminal trace hides residual exposure, liability, or outstanding mutations');
    }
    if (!Array.isArray(campaign.replayWitnesses) || campaign.replayWitnesses.length > 32) {
      throw new TypeError(`campaigns[${index}].replayWitnesses must be a bounded array`);
    }
    if (campaign.scenario === 'SERVER_CRASH_EVERY_TICKET_STATE') {
      if (campaign.replayWitnesses.length !== L12_CRASH_FAULT_CUTS.length) {
        throw new TypeError('crash campaign must contain every valid durable owner-state fault cut');
      }
      campaign.replayWitnesses.forEach((witness: Readonly<L12CrashReplayWitness>, witnessIndex: number) => {
        exactKeys(witness, [
          'faultCut', 'ownerState', 'checkpointRevision', 'cutStateRevision',
          'restoredStateRevision', 'terminalStateRevision', 'mutationIdentitiesBefore',
          'terminalMutationIdentities', 'terminalResidualExposure',
          'terminalResidualLiability', 'terminalOutstandingReferences',
        ], `campaigns[${index}].replayWitnesses[${witnessIndex}]`);
        if (witness.faultCut !== L12_CRASH_FAULT_CUTS[witnessIndex]) {
          throw new TypeError('crash replay witnesses must retain every canonical fault cut in order');
        }
        text(witness.ownerState, `campaigns[${index}].replayWitnesses[${witnessIndex}].ownerState`);
        revision(witness.checkpointRevision, `campaigns[${index}].replayWitnesses[${witnessIndex}].checkpointRevision`);
        const cutRevision = revision(
          witness.cutStateRevision,
          `campaigns[${index}].replayWitnesses[${witnessIndex}].cutStateRevision`,
        );
        const restoredRevision = revision(
          witness.restoredStateRevision,
          `campaigns[${index}].replayWitnesses[${witnessIndex}].restoredStateRevision`,
        );
        if (restoredRevision !== cutRevision) {
          throw new TypeError('crash replay witness did not restore the exact cut state');
        }
        if (revision(
          witness.terminalStateRevision,
          `campaigns[${index}].replayWitnesses[${witnessIndex}].terminalStateRevision`,
        ) !== campaign.terminalStateRevision) {
          throw new TypeError('crash replay witness did not converge to the declared terminal state');
        }
        const before = stringList(
          witness.mutationIdentitiesBefore,
          `campaigns[${index}].replayWitnesses[${witnessIndex}].mutationIdentitiesBefore`,
          64,
        );
        const after = stringList(
          witness.terminalMutationIdentities,
          `campaigns[${index}].replayWitnesses[${witnessIndex}].terminalMutationIdentities`,
          64,
        );
        if (!sameStringSet(after, mutationIdentities)
            || before.some((identity) => !after.includes(identity))) {
          throw new TypeError('crash replay witness duplicated or replaced a durable mutation identity');
        }
        if (decimal(
          witness.terminalResidualExposure,
          `campaigns[${index}].replayWitnesses[${witnessIndex}].terminalResidualExposure`,
          true,
        ) !== terminalResidualExposure
            || decimal(
              witness.terminalResidualLiability,
              `campaigns[${index}].replayWitnesses[${witnessIndex}].terminalResidualLiability`,
              true,
            ) !== terminalResidualLiability
            || !sameStringSet(
              stringList(
                witness.terminalOutstandingReferences,
                `campaigns[${index}].replayWitnesses[${witnessIndex}].terminalOutstandingReferences`,
                64,
              ),
              terminalOutstanding,
            )) {
          throw new TypeError('crash replay witness hides terminal exposure, liability, or outstanding truth');
        }
      });
      const cutRevisions = campaign.replayWitnesses.map(
        (witness: Readonly<L12CrashReplayWitness>) => witness.cutStateRevision,
      );
      if (new Set(cutRevisions).size !== cutRevisions.length) {
        throw new TypeError('crash replay witnesses must represent distinct durable state cuts');
      }
    } else if (campaign.replayWitnesses.length !== 0) {
      throw new TypeError('only the crash campaign may declare ticket-state coverage');
    }
  });
}

function validateComponentEvidence(input: Readonly<ExposureRecoveryProjectionInput>): void {
  const evidence = input.componentEvidence;
  exactKeys(evidence, ['capitalExposed', 'operatorAttentionRequired', 'ownerRevision', 'reasonCodes'], 'componentEvidence');
  if (typeof evidence.capitalExposed !== 'boolean' || typeof evidence.operatorAttentionRequired !== 'boolean') {
    throw new TypeError('componentEvidence booleans are invalid');
  }
  revision(evidence.ownerRevision, 'componentEvidence.ownerRevision');
  stringList(evidence.reasonCodes, 'componentEvidence.reasonCodes');
  const vector = input.exposure;
  const provablyZero = vector.completeness === 'COMPLETE'
    && [vector.spotBase, vector.marginBase, vector.futuresBaseEquivalent, vector.netBase,
      vector.grossNotional, vector.marginLiability, vector.unhedgedNotional].every((value) => value === '0')
    && input.reconciliation.status === 'EXACT'
    && input.reconciliation.orphanState === 'ABSENT'
    && [input.outstanding.openOrderReferences, input.outstanding.ambiguousMutationReferences,
      input.outstanding.unmatchedFillReferences, input.outstanding.manualActivityReferences]
      .every((values) => values.length === 0)
    && ['CLOSED', 'RECOVERED'].includes(input.recovery.ownerEndState ?? '');
  if (!evidence.capitalExposed && !provablyZero) {
    throw new TypeError('capitalExposed may be false only under exact zero owner proof');
  }
  const requiresAttention = input.recovery.required
    || input.recovery.ownerEndState === 'MANUAL_INTERVENTION'
    || input.recovery.residualExposure !== '0'
    || input.recovery.residualLiability !== '0'
    || input.reconciliation.status !== 'EXACT'
    || input.reconciliation.orphanState !== 'ABSENT'
    || input.exposure.completeness !== 'COMPLETE'
    || Object.values(input.outstanding).some((value) => Array.isArray(value) && value.length > 0)
    || ['HEDGE', 'EXIT', 'EMERGENCY', 'FREEZE', 'UNKNOWN'].includes(input.capital.supervisionIntent);
  if (requiresAttention && !evidence.operatorAttentionRequired) {
    throw new TypeError('operatorAttentionRequired cannot hide owner recovery or uncertainty');
  }
}

function projectionStatus(input: Readonly<ExposureRecoveryProjectionInput>, coldStartComplete: boolean): L12ProjectionStatus {
  if (input.recovery.required) return 'RECOVERY_REQUIRED';
  if (input.chain.some((stage) => stage.status === 'BLOCKED' || stage.status === 'OWNER_GATED')
      || input.riskRecheck.disposition !== 'PASS' || !input.riskRecheck.currentTruthUsed
      || !coldStartComplete || input.exposure.completeness !== 'COMPLETE'
      || input.capital.completeness !== 'COMPLETE'
      || input.reconciliation.status !== 'EXACT'
      || input.reconciliation.orphanState !== 'ABSENT') return 'BLOCKED';
  return 'COMPLETE_FOR_OWNER_REVIEW';
}

function validateInput(input: Readonly<ExposureRecoveryProjectionInput>): L12ProjectionStatus {
  exactKeys(input, [
    'subject', 'canonicalTruth', 'chain', 'riskRecheck', 'control', 'exposure', 'capital',
    'reconciliation', 'outstanding', 'recovery', 'coldStart', 'campaigns', 'componentEvidence',
  ], 'L12 input');
  validateSubject(input.subject);
  validateChain(input);
  validateRisk(input);
  validateControl(input);
  validateExposure(input);
  validateCapital(input);
  validateReconciliation(input);
  validateRecovery(input);
  validateCanonicalTruth(input);
  const complete = validateColdStart(input);
  validateCampaigns(input);
  validateComponentEvidence(input);
  return projectionStatus(input, complete);
}

export function deriveExposureRecoverySnapshotRevision(material: unknown): string {
  assertClosedPlainData(material);
  return `l12_${stableHash128Hex(canonicalJson(material))}`;
}

export function projectExposureRecoverySnapshot(input: ExposureRecoveryProjectionInput): Readonly<L12SupervisorSnapshot> {
  assertClosedPlainData(input);
  const cloned = cloneFreeze(input) as Readonly<ExposureRecoveryProjectionInput>;
  const status = validateInput(cloned);
  const material = {
    schema: EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA,
    version: 1 as const,
    ...cloned,
    projectionStatus: status,
    projectionAuthority: 'OWNER_EVIDENCE_ADAPTER_ONLY' as const,
    capitalAuthority: 'CAPITAL_FOUNDATION' as const,
    lifecycleAuthority: 'FOUNDATION_EXECUTION_RECONCILIATION' as const,
    reconciliationAuthority: 'FOUNDATION_RECONCILIATION_OR_EXPLICIT_OWNER_INJECTION' as const,
    simulationAuthority: 'SYNTHETIC_FIXTURE' as const,
    truthClass: 'SYNTHETIC_ONLY' as const,
    sendEligible: false as const,
    canAuthorizeEntry: false as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
  };
  return cloneFreeze({
    ...material,
    snapshotRevision: deriveExposureRecoverySnapshotRevision(material),
  } satisfies L12SupervisorSnapshot);
}

export function validateExposureRecoverySnapshot(value: Readonly<L12SupervisorSnapshot>): Readonly<L12SupervisorSnapshot> {
  assertClosedPlainData(value);
  if (value.schema !== EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA || value.version !== 1) {
    throw new TypeError('exposure recovery snapshot schema mismatch');
  }
  const reproduced = projectExposureRecoverySnapshot({
    subject: value.subject,
    canonicalTruth: value.canonicalTruth,
    chain: value.chain,
    riskRecheck: value.riskRecheck,
    control: value.control,
    exposure: value.exposure,
    capital: value.capital,
    reconciliation: value.reconciliation,
    outstanding: value.outstanding,
    recovery: value.recovery,
    coldStart: value.coldStart,
    campaigns: value.campaigns,
    componentEvidence: value.componentEvidence,
  });
  if (canonicalJson(reproduced) !== canonicalJson(value)) {
    throw new TypeError('exposure recovery snapshot is not reproducible');
  }
  return reproduced;
}
