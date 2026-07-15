import { diagnosticProviderOutageProjection } from '../../productAssurance/diagnostics/boundary.js';
import type {
  ShadowBudgetCaps,
  ShadowBudgetState,
  ShadowCriticalityProof,
  ShadowUsage,
  ShadowUsageReceipt,
} from './types.js';
import type { ShadowSyntheticSignerPort } from './context.js';
import { SHADOW_A2_STATUS } from './types.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertSafeNonNegative,
  assertUtc,
  checkedAdd,
  compareCodeUnitStrings,
  digestValue,
  snapshotInertJson,
} from './support.js';

const USAGE_KEYS = Object.freeze([
  'calls', 'toolCalls', 'webQueries', 'tokens', 'costMicrounits', 'latencyMs', 'wallTimeMs',
] as const);
const ZERO_USAGE: Readonly<ShadowUsage> = Object.freeze({
  calls: 0,
  toolCalls: 0,
  webQueries: 0,
  tokens: 0,
  costMicrounits: 0,
  latencyMs: 0,
  wallTimeMs: 0,
});
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_CRITICALITY_PROOF_TTL_MS = DAY_MS;

function validateSignerPort(verifier: Readonly<ShadowSyntheticSignerPort>): void {
  assertClosedKeys(verifier, ['posture', 'signDigest', 'verifyDigest'], 'synthetic signer port');
  if (verifier.posture !== 'SYNTHETIC_ONLY') throw new TypeError('A2 signer posture must remain synthetic-only');
  if (typeof verifier.signDigest !== 'function' || typeof verifier.verifyDigest !== 'function') {
    throw new TypeError('A2 signer methods are unavailable');
  }
}

function validateUsage(usage: Readonly<ShadowUsage>, label: string): void {
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) throw new TypeError(`${label} must be an object`);
  assertClosedKeys(usage, USAGE_KEYS, label);
  for (const key of USAGE_KEYS) assertSafeNonNegative(usage[key], `${label}.${key}`);
}

function addUsage(left: Readonly<ShadowUsage>, right: Readonly<ShadowUsage>): Readonly<ShadowUsage> {
  const output = {} as Record<(typeof USAGE_KEYS)[number], number>;
  for (const key of USAGE_KEYS) output[key] = checkedAdd(left[key], right[key], `usage.${key}`);
  return Object.freeze(output) as Readonly<ShadowUsage>;
}

function sumUsage(receipts: readonly Readonly<ShadowUsageReceipt>[]): Readonly<ShadowUsage> {
  return receipts.reduce<Readonly<ShadowUsage>>((total, receipt) => addUsage(total, receipt.usage), ZERO_USAGE);
}

function sameBucket(left: number, right: number, width: number): boolean {
  return Math.floor(left / width) === Math.floor(right / width);
}

function calendarMonthKey(atMs: number): string {
  const instant = new Date(atMs);
  return `${instant.getUTCFullYear()}-${instant.getUTCMonth()}`;
}

function capExceeded(
  used: Readonly<ShadowUsage>,
  requested: Readonly<ShadowUsage>,
  cap: Readonly<ShadowUsage>,
  reserve: Readonly<ShadowUsage>,
  critical: boolean,
): readonly string[] {
  const reasons: string[] = [];
  for (const key of USAGE_KEYS) {
    const effective = critical ? cap[key] : Math.max(0, cap[key] - reserve[key]);
    if (used[key] > effective || requested[key] > effective - used[key]) reasons.push(`BUDGET_${key.toUpperCase()}_EXHAUSTED`);
  }
  return Object.freeze(reasons);
}

function validateCaps(caps: Readonly<ShadowBudgetCaps>): void {
  assertClosedKeys(caps, [
    'policyRevision', 'perCase', 'hourly', 'daily', 'monthly', 'globalHourly', 'globalDaily', 'globalMonthly',
    'criticalReserve',
  ], 'budget caps');
  assertIdentifier(caps.policyRevision, 'caps.policyRevision');
  validateUsage(caps.perCase, 'caps.perCase');
  validateUsage(caps.hourly, 'caps.hourly');
  validateUsage(caps.daily, 'caps.daily');
  validateUsage(caps.monthly, 'caps.monthly');
  validateUsage(caps.globalHourly, 'caps.globalHourly');
  validateUsage(caps.globalDaily, 'caps.globalDaily');
  validateUsage(caps.globalMonthly, 'caps.globalMonthly');
  validateUsage(caps.criticalReserve, 'caps.criticalReserve');
  for (const key of USAGE_KEYS) {
    if (
      caps.criticalReserve[key] > caps.hourly[key]
      || caps.criticalReserve[key] > caps.daily[key]
      || caps.criticalReserve[key] > caps.monthly[key]
      || caps.criticalReserve[key] > caps.globalHourly[key]
      || caps.criticalReserve[key] > caps.globalDaily[key]
      || caps.criticalReserve[key] > caps.globalMonthly[key]
    ) {
      throw new TypeError('critical reserve cannot exceed aggregate budget caps');
    }
  }
}

function snapshotBudgetState(
  state: Readonly<ShadowBudgetState>,
  verifier: Readonly<ShadowSyntheticSignerPort> | null = null,
): Readonly<ShadowBudgetState> {
  state = snapshotInertJson(state, 'budget state') as Readonly<ShadowBudgetState>;
  if (verifier !== null) validateSignerPort(verifier);
  assertClosedKeys(state, ['schema', 'shadowStatus', 'policyRevision', 'receipts'], 'budget state');
  if (state.schema !== 'AI_OPS_A2_BUDGET_STATE_V1' || state.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('budget state schema or status invalid');
  assertIdentifier(state.policyRevision, 'state.policyRevision');
  if (!Array.isArray(state.receipts) || state.receipts.length > 4_096) throw new TypeError('budget receipt bound invalid');
  const receipts = Array.from({ length: state.receipts.length }, (_, index) => state.receipts[index]);
  const receiptIds = new Set<string>();
  let previousRecordedAtMs = -1;
  for (const receipt of receipts) {
    validateReceipt(receipt);
    if (receiptIds.has(receipt.receiptId)) throw new TypeError('budget receipt IDs must be unique');
    receiptIds.add(receipt.receiptId);
    if (receipt.recordedAtMs < previousRecordedAtMs) throw new TypeError('budget receipt record times are not monotonic');
    previousRecordedAtMs = receipt.recordedAtMs;
    if (verifier !== null) validateCriticalityProof(receipt.criticalityProof, receipt.caseId, receipt.policyRevision, receipt.recordedAtMs, verifier);
  }
  return sealBudgetState(Object.freeze({
    schema: state.schema,
    shadowStatus: state.shadowStatus,
    policyRevision: state.policyRevision,
    receipts,
  }));
}

function validateReceipt(receipt: Readonly<ShadowUsageReceipt>): void {
  assertClosedKeys(receipt, [
    'shadowStatus', 'receiptId', 'requestDigest', 'caseId', 'providerId', 'modelId',
    'policyRevision', 'budgetAdmissionDigest', 'usageRequestDigest', 'occurredAtMs',
    'recordedAtMs', 'usage', 'criticalityProof',
  ], 'usage receipt');
  if (receipt.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('usage receipt status invalid');
  assertIdentifier(receipt.receiptId, 'receipt.receiptId');
  assertIdentifier(receipt.caseId, 'receipt.caseId');
  assertIdentifier(receipt.providerId, 'receipt.providerId');
  assertIdentifier(receipt.modelId, 'receipt.modelId');
  assertIdentifier(receipt.policyRevision, 'receipt.policyRevision');
  assertDigest(receipt.budgetAdmissionDigest, 'receipt.budgetAdmissionDigest');
  assertDigest(receipt.usageRequestDigest, 'receipt.usageRequestDigest');
  assertUtc(receipt.occurredAtMs, 'receipt.occurredAtMs');
  assertUtc(receipt.recordedAtMs, 'receipt.recordedAtMs');
  if (receipt.occurredAtMs > receipt.recordedAtMs) throw new TypeError('usage occurrence cannot follow its trusted record time');
  validateCriticalityProofShape(receipt.criticalityProof);
  validateUsage(receipt.usage, 'receipt.usage');
  assertDigest(receipt.requestDigest, 'receipt.requestDigest');
  const { requestDigest: _requestDigest, ...identity } = receipt;
  if (digestValue(identity) !== receipt.requestDigest) throw new TypeError('usage receipt digest mismatch');
}

function sealUsageReceipt(receipt: Readonly<ShadowUsageReceipt>): Readonly<ShadowUsageReceipt> {
  return Object.freeze({
    ...receipt,
    usage: Object.freeze({ ...receipt.usage }),
    criticalityProof: Object.freeze({
      ...receipt.criticalityProof,
      signature: Object.freeze({ ...receipt.criticalityProof.signature }),
    }),
  });
}

function sealBudgetState(state: Readonly<ShadowBudgetState>): Readonly<ShadowBudgetState> {
  return Object.freeze({
    schema: state.schema,
    shadowStatus: state.shadowStatus,
    policyRevision: state.policyRevision,
    receipts: Object.freeze(state.receipts.map(sealUsageReceipt)),
  });
}

export function createBudgetState(policyRevision: string): Readonly<ShadowBudgetState> {
  assertIdentifier(policyRevision, 'policyRevision');
  return Object.freeze({
    schema: 'AI_OPS_A2_BUDGET_STATE_V1',
    shadowStatus: SHADOW_A2_STATUS,
    policyRevision,
    receipts: Object.freeze([]),
  });
}

export function createUsageReceipt(
  input: Readonly<Omit<ShadowUsageReceipt, 'requestDigest' | 'shadowStatus' | 'budgetAdmissionDigest' | 'usageRequestDigest'>>,
  admission: Readonly<ShadowBudgetAdmission>,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowUsageReceipt> {
  input = snapshotInertJson(input, 'usage receipt input') as Readonly<Omit<ShadowUsageReceipt, 'requestDigest' | 'shadowStatus' | 'budgetAdmissionDigest' | 'usageRequestDigest'>>;
  admission = snapshotInertJson(admission, 'usage receipt budget admission') as Readonly<ShadowBudgetAdmission>;
  validateSignerPort(verifier);
  validateBudgetAdmission(admission);
  if (!admission.admitted || admission.diagnosticState !== 'READY') throw new TypeError('measured usage requires an admitted provider budget decision');
  if (
    input.caseId !== admission.caseId
    || input.providerId !== admission.providerId
    || input.modelId !== admission.modelId
    || input.policyRevision !== admission.policyRevision
  ) throw new TypeError('usage receipt provider budget lineage mismatch');
  if (input.occurredAtMs < admission.evaluatedAtMs) throw new TypeError('usage occurrence predates its budget admission');
  if (input.criticalityProof.critical !== admission.critical) throw new TypeError('usage receipt criticality does not match its budget admission');
  validateCriticalityProof(input.criticalityProof, input.caseId, input.policyRevision, input.recordedAtMs, verifier);
  const identity = Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    ...input,
    budgetAdmissionDigest: admission.admissionDigest,
    usageRequestDigest: admission.usageRequestDigest,
    usage: Object.freeze({ ...input.usage }),
    criticalityProof: Object.freeze({ ...input.criticalityProof, signature: Object.freeze({ ...input.criticalityProof.signature }) }),
  });
  const receipt = Object.freeze({ ...identity, requestDigest: digestValue(identity) });
  validateReceipt(receipt);
  return receipt;
}

export interface ShadowBudgetAdmission {
  readonly schema: 'AI_OPS_A2_BUDGET_ADMISSION_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly caseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly policyRevision: string;
  readonly evaluatedAtMs: number;
  readonly budgetStateDigest: string;
  readonly budgetCapsDigest: string;
  readonly criticalityProofDigest: string;
  readonly critical: boolean;
  readonly usageRequestDigest: string;
  readonly admitted: boolean;
  readonly diagnosticState: 'READY' | 'DIAGNOSTIC_PLANE_UNAVAILABLE';
  readonly productReadinessChanged: false;
  readonly deterministicSafetyChanged: false;
  readonly executionChanged: false;
  readonly reasonCodes: readonly string[];
  readonly usage: Readonly<{
    perCase: Readonly<ShadowUsage>;
    hourly: Readonly<ShadowUsage>;
    daily: Readonly<ShadowUsage>;
    monthly: Readonly<ShadowUsage>;
    globalHourly: Readonly<ShadowUsage>;
    globalDaily: Readonly<ShadowUsage>;
    globalMonthly: Readonly<ShadowUsage>;
  }>;
  readonly admissionDigest: string;
}

export interface ShadowCriticalityProofInput {
  readonly caseId: string;
  readonly policyRevision: string;
  readonly critical: boolean;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

function criticalityPayload(proof: Readonly<Omit<ShadowCriticalityProof, 'proofDigest' | 'signature'>>): object {
  return {
    schema: proof.schema,
    shadowStatus: proof.shadowStatus,
    caseId: proof.caseId,
    policyRevision: proof.policyRevision,
    critical: proof.critical,
    authority: proof.authority,
    issuedAtMs: proof.issuedAtMs,
    expiresAtMs: proof.expiresAtMs,
  };
}

function validateCriticalityProofShape(proof: Readonly<ShadowCriticalityProof>): void {
  assertClosedKeys(proof, [
    'schema', 'shadowStatus', 'caseId', 'policyRevision', 'critical', 'authority', 'issuedAtMs', 'expiresAtMs',
    'proofDigest', 'signature',
  ], 'criticality proof');
  if (proof.schema !== 'AI_OPS_A2_CRITICALITY_PROOF_V1' || proof.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('criticality proof schema or status invalid');
  assertIdentifier(proof.caseId, 'criticality.caseId');
  assertIdentifier(proof.policyRevision, 'criticality.policyRevision');
  if (typeof proof.critical !== 'boolean') throw new TypeError('criticality flag must be boolean');
  if (proof.authority !== 'SYNTHETIC_ONLY') throw new TypeError('criticality authority must remain synthetic-only');
  assertUtc(proof.issuedAtMs, 'criticality.issuedAtMs');
  assertUtc(proof.expiresAtMs, 'criticality.expiresAtMs');
  if (
    proof.expiresAtMs <= proof.issuedAtMs
    || proof.expiresAtMs - proof.issuedAtMs > MAX_CRITICALITY_PROOF_TTL_MS
  ) throw new TypeError('criticality proof expiry invalid');
  assertDigest(proof.proofDigest, 'criticality.proofDigest');
  assertClosedKeys(proof.signature, ['posture', 'algorithm', 'keyId', 'signature'], 'criticality signature');
  if (proof.signature.posture !== 'SYNTHETIC_ONLY') throw new TypeError('criticality signature posture invalid');
  assertIdentifier(proof.signature.algorithm, 'criticality.signature.algorithm');
  assertIdentifier(proof.signature.keyId, 'criticality.signature.keyId');
  if (typeof proof.signature.signature !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/u.test(proof.signature.signature)) throw new TypeError('criticality signature bytes malformed');
  if (digestValue(criticalityPayload(proof)) !== proof.proofDigest) throw new TypeError('criticality proof digest mismatch');
}

function validateCriticalityProof(
  proof: Readonly<ShadowCriticalityProof>,
  expectedCaseId: string,
  expectedPolicyRevision: string,
  atMs: number,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): void {
  validateSignerPort(verifier);
  validateCriticalityProofShape(proof);
  if (proof.caseId !== expectedCaseId || proof.policyRevision !== expectedPolicyRevision) throw new TypeError('criticality proof lineage mismatch');
  if (atMs < proof.issuedAtMs || atMs >= proof.expiresAtMs) throw new TypeError('criticality proof is not current');
  if (verifier.verifyDigest(proof.proofDigest, proof.signature) !== true) throw new TypeError('criticality proof signature invalid');
}

export function createCriticalityProof(
  input: Readonly<ShadowCriticalityProofInput>,
  signer: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowCriticalityProof> {
  input = snapshotInertJson(input, 'criticality proof input') as Readonly<ShadowCriticalityProofInput>;
  assertClosedKeys(input, ['caseId', 'policyRevision', 'critical', 'issuedAtMs', 'expiresAtMs'], 'criticality proof input');
  validateSignerPort(signer);
  const core = Object.freeze({
    schema: 'AI_OPS_A2_CRITICALITY_PROOF_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    ...input,
    authority: 'SYNTHETIC_ONLY' as const,
  });
  const proofDigest = digestValue(criticalityPayload(core));
  const signature = snapshotInertJson(signer.signDigest(proofDigest), 'criticality proof signature');
  const proof = Object.freeze({ ...core, proofDigest, signature });
  validateCriticalityProof(proof, input.caseId, input.policyRevision, input.issuedAtMs, signer);
  return proof;
}

export function evaluateUsageAdmission(
  state: Readonly<ShadowBudgetState>,
  caps: Readonly<ShadowBudgetCaps>,
  caseId: string,
  providerId: string,
  modelId: string,
  atMs: number,
  requested: Readonly<ShadowUsage>,
  criticality: Readonly<ShadowCriticalityProof>,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowBudgetAdmission> {
  state = snapshotInertJson(state, 'budget state') as Readonly<ShadowBudgetState>;
  caps = snapshotInertJson(caps, 'budget caps') as Readonly<ShadowBudgetCaps>;
  requested = snapshotInertJson(requested, 'requested usage') as Readonly<ShadowUsage>;
  criticality = snapshotInertJson(criticality, 'criticality proof') as Readonly<ShadowCriticalityProof>;
  validateSignerPort(verifier);
  const budgetState = snapshotBudgetState(state, verifier);
  validateCaps(caps);
  if (caps.policyRevision !== budgetState.policyRevision) throw new TypeError('budget cap policy revision mismatch');
  assertIdentifier(caseId, 'caseId');
  assertIdentifier(providerId, 'providerId');
  assertIdentifier(modelId, 'modelId');
  assertUtc(atMs, 'atMs');
  const latestReceipt = budgetState.receipts.at(-1);
  if (latestReceipt && atMs < latestReceipt.recordedAtMs) throw new TypeError('budget admission time must not precede the latest usage receipt');
  validateUsage(requested, 'requested');
  validateCriticalityProof(criticality, caseId, budgetState.policyRevision, atMs, verifier);
  const critical = criticality.critical;
  const providerReceipts = budgetState.receipts.filter((receipt) => receipt.providerId === providerId);
  const perCase = sumUsage(budgetState.receipts.filter((receipt) => receipt.caseId === caseId));
  const hourly = sumUsage(providerReceipts.filter((receipt) => sameBucket(receipt.recordedAtMs, atMs, HOUR_MS)));
  const daily = sumUsage(providerReceipts.filter((receipt) => sameBucket(receipt.recordedAtMs, atMs, DAY_MS)));
  const monthly = sumUsage(providerReceipts.filter((receipt) => calendarMonthKey(receipt.recordedAtMs) === calendarMonthKey(atMs)));
  const globalHourly = sumUsage(budgetState.receipts.filter((receipt) => sameBucket(receipt.recordedAtMs, atMs, HOUR_MS)));
  const globalDaily = sumUsage(budgetState.receipts.filter((receipt) => sameBucket(receipt.recordedAtMs, atMs, DAY_MS)));
  const globalMonthly = sumUsage(budgetState.receipts.filter((receipt) => calendarMonthKey(receipt.recordedAtMs) === calendarMonthKey(atMs)));
  const reasons = [
    ...capExceeded(perCase, requested, caps.perCase, ZERO_USAGE, true).map((reason) => `PER_CASE_${reason}`),
    ...capExceeded(hourly, requested, caps.hourly, caps.criticalReserve, critical).map((reason) => `PROVIDER_HOURLY_${reason}`),
    ...capExceeded(daily, requested, caps.daily, caps.criticalReserve, critical).map((reason) => `PROVIDER_DAILY_${reason}`),
    ...capExceeded(monthly, requested, caps.monthly, caps.criticalReserve, critical).map((reason) => `PROVIDER_MONTHLY_${reason}`),
    ...capExceeded(globalHourly, requested, caps.globalHourly, caps.criticalReserve, critical).map((reason) => `GLOBAL_HOURLY_${reason}`),
    ...capExceeded(globalDaily, requested, caps.globalDaily, caps.criticalReserve, critical).map((reason) => `GLOBAL_DAILY_${reason}`),
    ...capExceeded(globalMonthly, requested, caps.globalMonthly, caps.criticalReserve, critical).map((reason) => `GLOBAL_MONTHLY_${reason}`),
  ];
  const usageRequestDigest = digestValue({
    caseId,
    policyRevision: budgetState.policyRevision,
    evaluatedAtMs: atMs,
    requested,
    criticalityProofDigest: criticality.proofDigest,
    budgetStateDigest: digestValue(budgetState),
    budgetCapsDigest: digestValue(caps),
  });
  const core = Object.freeze({
    schema: 'AI_OPS_A2_BUDGET_ADMISSION_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    caseId,
    providerId,
    modelId,
    policyRevision: budgetState.policyRevision,
    evaluatedAtMs: atMs,
    budgetStateDigest: digestValue(budgetState),
    budgetCapsDigest: digestValue(caps),
    criticalityProofDigest: criticality.proofDigest,
    critical,
    usageRequestDigest,
    admitted: reasons.length === 0,
    diagnosticState: reasons.length === 0 ? 'READY' : 'DIAGNOSTIC_PLANE_UNAVAILABLE',
    productReadinessChanged: false,
    deterministicSafetyChanged: false,
    executionChanged: false,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    usage: Object.freeze({ perCase, hourly, daily, monthly, globalHourly, globalDaily, globalMonthly }),
  });
  return Object.freeze({ ...core, admissionDigest: digestValue(core) });
}

export type ShadowUsageRecordResult =
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'RECORDED' | 'IDEMPOTENT'; state: Readonly<ShadowBudgetState> }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'BUDGET_EXHAUSTED'; state: Readonly<ShadowBudgetState>; reasonCodes: readonly string[] }>;

export function recordUsage(
  state: Readonly<ShadowBudgetState>,
  caps: Readonly<ShadowBudgetCaps>,
  receipt: Readonly<ShadowUsageReceipt>,
  recordedAtMs: number,
  verifier: Readonly<ShadowSyntheticSignerPort>,
  maximumReceipts = 4_096,
): ShadowUsageRecordResult {
  state = snapshotInertJson(state, 'budget state') as Readonly<ShadowBudgetState>;
  caps = snapshotInertJson(caps, 'budget caps') as Readonly<ShadowBudgetCaps>;
  receipt = snapshotInertJson(receipt, 'usage receipt') as Readonly<ShadowUsageReceipt>;
  validateSignerPort(verifier);
  const budgetState = snapshotBudgetState(state, verifier);
  validateCaps(caps);
  validateReceipt(receipt);
  assertUtc(recordedAtMs, 'recordedAtMs');
  validateCriticalityProof(receipt.criticalityProof, receipt.caseId, receipt.policyRevision, receipt.recordedAtMs, verifier);
  if (caps.policyRevision !== budgetState.policyRevision) throw new TypeError('budget cap policy revision mismatch');
  if (receipt.policyRevision !== budgetState.policyRevision) throw new TypeError('usage receipt policy revision mismatch');
  const existing = budgetState.receipts.find((entry) => entry.receiptId === receipt.receiptId);
  if (existing) {
    if (digestValue(existing) !== digestValue(receipt)) throw new TypeError('usage receipt ID replay has conflicting content');
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'IDEMPOTENT', state: budgetState });
  }
  if (receipt.recordedAtMs !== recordedAtMs) throw new TypeError('usage receipt is not bound to the trusted current record time');
  const previous = budgetState.receipts.at(-1);
  if (previous && receipt.recordedAtMs < previous.recordedAtMs) throw new TypeError('usage receipt record time must be monotonic');
  if (!Number.isSafeInteger(maximumReceipts) || maximumReceipts <= 0 || maximumReceipts > 4_096 || budgetState.receipts.length >= maximumReceipts) {
    throw new RangeError('usage receipt ledger is full');
  }
  const admission = evaluateUsageAdmission(
    budgetState,
    caps,
    receipt.caseId,
    receipt.providerId,
    receipt.modelId,
    receipt.recordedAtMs,
    receipt.usage,
    {
      ...receipt.criticalityProof,
    },
    verifier,
  );
  const recordedState = sealBudgetState(Object.freeze({ ...budgetState, receipts: [...budgetState.receipts, receipt] }));
  if (!admission.admitted) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'BUDGET_EXHAUSTED', state: recordedState, reasonCodes: admission.reasonCodes });
  }
  return Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    status: 'RECORDED',
    state: recordedState,
  });
}

export interface ShadowProviderCandidate {
  readonly providerId: string;
  readonly modelId: string;
  readonly state: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  readonly prequalified: boolean;
}

export interface ShadowProviderRouteProjection {
  readonly schema: 'AI_OPS_A2_PROVIDER_ROUTE_PROJECTION_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly diagnosticState: 'READY' | 'DIAGNOSTIC_PLANE_UNAVAILABLE';
  readonly selectedProviderId: string | null;
  readonly selectedModelId: string | null;
  readonly selectedBudgetAdmissionDigest: string | null;
  readonly usageRequestDigest: string;
  readonly productReadinessChanged: false;
  readonly deterministicSafetyChanged: false;
  readonly executionChanged: false;
  readonly reasonCodes: readonly string[];
}

export interface ShadowProviderBudgetContext {
  readonly state: Readonly<ShadowBudgetState>;
  readonly caps: Readonly<ShadowBudgetCaps>;
  readonly caseId: string;
  readonly evaluatedAtMs: number;
  readonly requested: Readonly<ShadowUsage>;
  readonly criticality: Readonly<ShadowCriticalityProof>;
}

const BUDGET_ADMISSION_KEYS = Object.freeze([
  'schema', 'shadowStatus', 'caseId', 'providerId', 'modelId', 'policyRevision', 'evaluatedAtMs',
  'budgetStateDigest', 'budgetCapsDigest', 'criticalityProofDigest', 'critical', 'usageRequestDigest',
  'admitted', 'diagnosticState', 'productReadinessChanged',
  'deterministicSafetyChanged', 'executionChanged', 'reasonCodes', 'usage', 'admissionDigest',
] as const);

export function validateBudgetAdmission(admission: Readonly<ShadowBudgetAdmission>): void {
  assertClosedKeys(admission, BUDGET_ADMISSION_KEYS, 'budget admission');
  if (admission.schema !== 'AI_OPS_A2_BUDGET_ADMISSION_V1' || admission.shadowStatus !== SHADOW_A2_STATUS) {
    throw new TypeError('budget admission schema or status invalid');
  }
  assertIdentifier(admission.caseId, 'admission.caseId');
  assertIdentifier(admission.providerId, 'admission.providerId');
  assertIdentifier(admission.modelId, 'admission.modelId');
  assertIdentifier(admission.policyRevision, 'admission.policyRevision');
  assertUtc(admission.evaluatedAtMs, 'admission.evaluatedAtMs');
  assertDigest(admission.budgetStateDigest, 'admission.budgetStateDigest');
  assertDigest(admission.budgetCapsDigest, 'admission.budgetCapsDigest');
  assertDigest(admission.criticalityProofDigest, 'admission.criticalityProofDigest');
  if (typeof admission.critical !== 'boolean') throw new TypeError('budget admission criticality flag invalid');
  assertDigest(admission.usageRequestDigest, 'admission.usageRequestDigest');
  assertDigest(admission.admissionDigest, 'admission.admissionDigest');
  if (typeof admission.admitted !== 'boolean') throw new TypeError('budget admission decision invalid');
  if (!(['READY', 'DIAGNOSTIC_PLANE_UNAVAILABLE'] as const).includes(admission.diagnosticState)) {
    throw new TypeError('budget admission diagnostic state invalid');
  }
  if (
    admission.productReadinessChanged !== false
    || admission.deterministicSafetyChanged !== false
    || admission.executionChanged !== false
  ) throw new TypeError('budget admission cannot change product authority');
  if (!Array.isArray(admission.reasonCodes) || admission.reasonCodes.length > 64) throw new TypeError('budget admission reason bound invalid');
  for (const reason of admission.reasonCodes) assertIdentifier(reason, 'admission.reasonCodes[]');
  const canonicalReasons = [...new Set(admission.reasonCodes)].sort(compareCodeUnitStrings);
  if (digestValue(canonicalReasons) !== digestValue(admission.reasonCodes)) throw new TypeError('budget admission reasons are not canonical');
  if (admission.admitted !== (admission.reasonCodes.length === 0)) throw new TypeError('budget admission decision contradicts its reasons');
  if ((admission.diagnosticState === 'READY') !== admission.admitted) throw new TypeError('budget admission diagnostic state contradicts its decision');
  assertClosedKeys(admission.usage, [
    'perCase', 'hourly', 'daily', 'monthly', 'globalHourly', 'globalDaily', 'globalMonthly',
  ], 'budget admission usage');
  validateUsage(admission.usage.perCase, 'admission.usage.perCase');
  validateUsage(admission.usage.hourly, 'admission.usage.hourly');
  validateUsage(admission.usage.daily, 'admission.usage.daily');
  validateUsage(admission.usage.monthly, 'admission.usage.monthly');
  validateUsage(admission.usage.globalHourly, 'admission.usage.globalHourly');
  validateUsage(admission.usage.globalDaily, 'admission.usage.globalDaily');
  validateUsage(admission.usage.globalMonthly, 'admission.usage.globalMonthly');
  const { admissionDigest: _admissionDigest, ...core } = admission;
  if (digestValue(core) !== admission.admissionDigest) throw new TypeError('budget admission digest mismatch');
}

function validateCandidate(candidate: Readonly<ShadowProviderCandidate>): void {
  assertClosedKeys(candidate, ['providerId', 'modelId', 'state', 'prequalified'], 'provider candidate');
  assertIdentifier(candidate.providerId, 'candidate.providerId');
  assertIdentifier(candidate.modelId, 'candidate.modelId');
  if (!(['READY', 'NOT_CONFIGURED', 'UNAVAILABLE'] as const).includes(candidate.state)) throw new TypeError('provider candidate state invalid');
  if (typeof candidate.prequalified !== 'boolean') throw new TypeError('provider prequalification must be boolean');
}

export function projectProviderRoute(
  primary: Readonly<ShadowProviderCandidate>,
  fallbacks: readonly Readonly<ShadowProviderCandidate>[],
  budgetContext: Readonly<ShadowProviderBudgetContext>,
  unresolvedGlobalEffect: boolean,
  verifier: Readonly<ShadowSyntheticSignerPort>,
): Readonly<ShadowProviderRouteProjection> {
  const primarySnapshot = snapshotInertJson(primary, 'primary provider candidate') as Readonly<ShadowProviderCandidate>;
  const fallbackSnapshot = snapshotInertJson(fallbacks, 'provider fallbacks') as readonly Readonly<ShadowProviderCandidate>[];
  const budgetSnapshot = snapshotInertJson(budgetContext, 'provider budget context') as Readonly<ShadowProviderBudgetContext>;
  if (!Array.isArray(fallbackSnapshot) || fallbackSnapshot.length > 16) throw new TypeError('provider fallback set exceeds its bound');
  if (typeof unresolvedGlobalEffect !== 'boolean') throw new TypeError('provider route flags must be boolean');
  validateSignerPort(verifier);
  assertClosedKeys(budgetSnapshot, ['state', 'caps', 'caseId', 'evaluatedAtMs', 'requested', 'criticality'], 'provider budget context');
  const candidates = [primarySnapshot, ...fallbackSnapshot];
  for (const candidate of candidates) validateCandidate(candidate);
  const admissionSnapshot = Object.freeze(candidates.map((candidate) => evaluateUsageAdmission(
    budgetSnapshot.state,
    budgetSnapshot.caps,
    budgetSnapshot.caseId,
    candidate.providerId,
    candidate.modelId,
    budgetSnapshot.evaluatedAtMs,
    budgetSnapshot.requested,
    budgetSnapshot.criticality,
    verifier,
  )));
  for (const admission of admissionSnapshot) validateBudgetAdmission(admission);
  const identities = candidates.map((candidate) => `${candidate.providerId}\0${candidate.modelId}`);
  if (new Set(identities).size !== identities.length) throw new TypeError('provider route contains a duplicate provider-model identity');
  const admissionByIdentity = new Map<string, Readonly<ShadowBudgetAdmission>>(
    admissionSnapshot.map((admission) => [`${admission.providerId}\0${admission.modelId}`, admission]),
  );
  if (admissionByIdentity.size !== admissionSnapshot.length || identities.some((identity) => !admissionByIdentity.has(identity))) {
    throw new TypeError('provider budget admissions do not exactly cover route candidates');
  }
  const lineage = admissionSnapshot[0];
  if (!lineage || admissionSnapshot.some((admission) => (
    admission.caseId !== lineage.caseId
    || admission.policyRevision !== lineage.policyRevision
    || admission.evaluatedAtMs !== lineage.evaluatedAtMs
    || admission.budgetStateDigest !== lineage.budgetStateDigest
    || admission.budgetCapsDigest !== lineage.budgetCapsDigest
    || admission.criticalityProofDigest !== lineage.criticalityProofDigest
    || admission.usageRequestDigest !== lineage.usageRequestDigest
  ))) throw new TypeError('provider budget admissions do not share one usage-request lineage');
  if (unresolvedGlobalEffect) {
    return Object.freeze({
      schema: 'AI_OPS_A2_PROVIDER_ROUTE_PROJECTION_V1',
      shadowStatus: SHADOW_A2_STATUS,
      diagnosticState: 'DIAGNOSTIC_PLANE_UNAVAILABLE',
      selectedProviderId: null,
      selectedModelId: null,
      selectedBudgetAdmissionDigest: null,
      usageRequestDigest: lineage.usageRequestDigest,
      productReadinessChanged: false,
      deterministicSafetyChanged: false,
      executionChanged: false,
      reasonCodes: Object.freeze(['AMBIGUOUS_GLOBAL_EFFECT_FENCE']),
    });
  }
  const admitted = (candidate: Readonly<ShadowProviderCandidate>): boolean => (
    admissionByIdentity.get(`${candidate.providerId}\0${candidate.modelId}`)?.admitted === true
  );
  const selected = primarySnapshot.prequalified && primarySnapshot.state === 'READY' && admitted(primarySnapshot)
    ? primarySnapshot
    : fallbackSnapshot
      .filter((candidate) => candidate.prequalified && candidate.state === 'READY' && admitted(candidate))
      .sort((left, right) => compareCodeUnitStrings(left.providerId, right.providerId) || compareCodeUnitStrings(left.modelId, right.modelId))[0];
  const eligibleButBudgetBlocked = candidates.some((candidate) => candidate.prequalified && candidate.state === 'READY' && !admitted(candidate));
  const outage = diagnosticProviderOutageProjection(selected ? 'READY' : primarySnapshot.state === 'READY' ? 'UNAVAILABLE' : primarySnapshot.state);
  const selectedAdmission = selected === undefined ? undefined : admissionByIdentity.get(`${selected.providerId}\0${selected.modelId}`);
  return Object.freeze({
    schema: 'AI_OPS_A2_PROVIDER_ROUTE_PROJECTION_V1',
    shadowStatus: SHADOW_A2_STATUS,
    diagnosticState: outage.diagnosticState as 'READY' | 'DIAGNOSTIC_PLANE_UNAVAILABLE',
    selectedProviderId: selected?.providerId ?? null,
    selectedModelId: selected?.modelId ?? null,
    selectedBudgetAdmissionDigest: selectedAdmission?.admissionDigest ?? null,
    usageRequestDigest: lineage.usageRequestDigest,
    productReadinessChanged: outage.productReadinessChanged,
    deterministicSafetyChanged: outage.deterministicSafetyChanged,
    executionChanged: outage.executionChanged,
    reasonCodes: Object.freeze(selected
      ? [selected === primarySnapshot ? 'PRIMARY_PROVIDER_SELECTED' : 'PREQUALIFIED_FALLBACK_SELECTED']
      : [eligibleButBudgetBlocked ? 'DIAGNOSTIC_BUDGET_EXHAUSTED' : 'DIAGNOSTIC_PROVIDER_UNAVAILABLE']),
  });
}
