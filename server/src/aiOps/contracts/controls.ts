import { AI_OPS_HARD_DENIAL_IDS, type AiOpsOperatingMode } from './authority.js';
import {
  canonicalPolicyJson,
  canonicalPolicySnapshot,
  exactKeys,
  immutableClone,
  isBoundedId,
  isCanonicalSafeText,
  isDenseArray,
  isPlainRecord,
  isSafeIntegerAtLeast,
  sortedUnique,
} from './shared.js';

const CONTROL_LABELS = Object.freeze({
  A: ['AI master enable', 'operating mode', 'provider emergency kill', 'automatic case creation', 'manual case creation', 'owner chat', 'scheduled audit', 'sentinel incident ingestion', 'bounded diagnostic-worker restart', 'AI-plane quarantine on control fault'],
  B: ['minimum severity', 'minimum materiality', 'dwell threshold', 'evidence-completeness floor', 'evidence-age ceiling', 'fingerprint-dedup window', 'recurrence cooldown', 'one-active-case-per-resource/fingerprint', 'conflicting-evidence abstention', 'critical-reserve admission'],
  C: ['provider allowlist', 'runtime diagnostic provider', 'classifier model', 'diagnostician model', 'research model', 'coding provider/model', 'verifier provider/model', 'fallback provider', 'exact-version pin', 'timeout/circuit-breaker policy'],
  D: ['hourly spend cap', 'daily cap', 'monthly cap', 'per-incident spend', 'per-incident tokens', 'tool calls', 'web searches', 'maximum run duration', 'global concurrent runs', 'per-provider concurrency/retry cap'],
  E: ['financial-summary egress', 'identity-specific source-code egress', 'account-identifier exposure', 'raw-log exposure', 'trace-payload exposure', 'DOM/screenshot exposure', 'evidence-byte ceiling', 'local retention', 'provider retention posture', 'redaction fail-closed lock'],
  F: ['web research master', 'domain-policy mode', 'approved-domain allowlist', 'primary-source requirement for code/operations', 'market-context source policy', 'source-age ceiling', 'citation requirement', 'claim/provenance hashing', 'retrieved-content-is-data hard lock', 'retrieval cache/expiry'],
  G: ['supervisor snapshots', 'component detail', 'incident evidence', 'bounded metrics', 'bounded traces', 'structured logs', 'Failure Atlas', 'runbooks', 'read-only replay', 'fault/config/deployment comparisons'],
  H: ['isolated patch enable', 'approved worktree root', 'read paths', 'write paths', 'forbidden-path hard lock', 'sandbox network', 'package-install policy', 'registered test commands', 'files/lines/diff ceiling', 'process/time/CPU/memory/disk limits'],
  I: ['reproduce-before-patch', 'failing regression test', 'focused tests', 'accumulated tests', 'type/static/security/import gates', 'replay/browser/fault gates', 'independent verifier', 'exact-hash approval', 'approval TTL', 'canary/rollback/independent readback'],
  J: ['global Class-A availability', 'per-runbook enablement', 'maximum campaign actions', 'attempt budget', 'concurrency budget', 'lease/fence', 'cooldown/quiet period', 'recurrence quarantine', 'resource conflict graph', 'maximum effect plus independent postcondition'],
  K: ['paging destination', 'critical paging', 'owner-attention paging', 'AI outage paging', 'sentinel outage paging', 'acknowledgement TTL', 'escalation chain', 'delivery verification', 'postmortem threshold', 'incident archive/retention'],
  L: ['post-trade analysis', 'rejected/missed-trade analysis', 'shadow context assessment', 'Q research-candidate creation', 'regression-fixture drafting', 'Failure Atlas drafting', 'provider/model/prompt evaluation', 'diagnosis-calibration threshold', 'model/strategy promotion hard gate', 'no-hot-path/no-money-authority hard lock'],
} as const);

export type AiOpsControlCategory = keyof typeof CONTROL_LABELS;
export type AiOpsControlValue = boolean | number | string | readonly string[] | Readonly<Record<string, number>>;

export interface AiOpsControlRegistryInsertionRequest {
  readonly recordKind: 'INSERTION_REQUEST';
  readonly requestId: string;
  readonly controlId: string;
  readonly category: AiOpsControlCategory;
  readonly label: string;
  readonly canonicalOwnerId: 'PRODUCT_RUNTIME_CONTROL_REGISTRY';
  readonly delegatedEffectOwnerId: 'PRODUCT_RUNTIME_CONTROL_REGISTRY' | 'PRODUCT_ASSURANCE_REMEDIATION' | 'NOTIFICATIONS' | 'RISK';
  readonly type: 'BOOLEAN' | 'ENUM' | 'INTEGER' | 'DURATION_MS' | 'STRING_LIST' | 'STRUCTURED_LIMITS';
  readonly allowedValues: readonly AiOpsControlValue[];
  readonly safeDefault: AiOpsControlValue;
  readonly minimumSafetyFloor: string;
  readonly scope: 'AI_OPS';
  readonly environment: 'SHADOW';
  readonly modeCeiling: AiOpsOperatingMode;
  readonly effectHandler: null;
  readonly readbackHandler: null;
  readonly approvalRequirement: 'OWNER_SIGNED_CONTROL_CHANGE_SET';
  readonly ttlMs: null;
  readonly revision: 0;
  readonly lastChangedBy: null;
  readonly reason: 'PROVISIONAL_A1_INSERTION_REQUEST';
  readonly receiptId: null;
  readonly currentStatus: 'NOT_WIRED';
  readonly requestedState: 'DRAFT';
  readonly effectiveState: 'DISABLED';
  readonly permanentlyLocked: boolean;
  readonly hardDenialIds: readonly string[];
  readonly authorityCreated: false;
}

function controlShape(category: AiOpsControlCategory, number: number): Pick<AiOpsControlRegistryInsertionRequest, 'type' | 'allowedValues' | 'safeDefault' | 'minimumSafetyFloor' | 'modeCeiling' | 'permanentlyLocked'> {
  const key = `${category}${String(number).padStart(2, '0')}`;
  const permanentlyLocked = ['E02', 'E10', 'F09', 'H05', 'H06', 'L09', 'L10'].includes(key);
  const enforcedLock = ['E10', 'F09', 'H05', 'L09', 'L10'].includes(key);
  if (key === 'A02') {
    return { type: 'ENUM', allowedValues: ['OFF', 'OBSERVE', 'SHADOW'], safeDefault: 'OFF', minimumSafetyFloor: 'ADVISE_AND_HIGHER_UNAVAILABLE_UNTIL_ACCEPTED', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (key === 'A03') {
    return { type: 'ENUM', allowedValues: ['KILLED', 'SHADOW_DISABLED'], safeDefault: 'KILLED', minimumSafetyFloor: 'KILL_CANNOT_BE_RELEASED_BY_AI', modeCeiling: 'OFF', permanentlyLocked: true };
  }
  if (enforcedLock) {
    return { type: 'BOOLEAN', allowedValues: [true], safeDefault: true, minimumSafetyFloor: 'PERMANENT_HARD_LOCK', modeCeiling: 'SHADOW', permanentlyLocked: true };
  }
  if (permanentlyLocked) {
    return { type: 'BOOLEAN', allowedValues: [false], safeDefault: false, minimumSafetyFloor: 'PERMANENT_HARD_LOCK_OFF', modeCeiling: 'SHADOW', permanentlyLocked: true };
  }
  if (['C01', 'F03', 'H02', 'H03', 'H04', 'H08', 'J02', 'J09', 'K01', 'K07'].includes(key)) {
    return { type: 'STRING_LIST', allowedValues: [[]], safeDefault: [], minimumSafetyFloor: 'EMPTY_ALLOWLIST', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (['F02', 'F05', 'E09', 'H07'].includes(key)) {
    return { type: 'ENUM', allowedValues: ['DENY'], safeDefault: 'DENY', minimumSafetyFloor: 'DENY_BY_DEFAULT', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (key === 'B01') {
    return { type: 'ENUM', allowedValues: ['SEV0_SAFETY'], safeDefault: 'SEV0_SAFETY', minimumSafetyFloor: 'MOST_RESTRICTIVE_INCIDENT_ADMISSION', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (key === 'B02') {
    return { type: 'ENUM', allowedValues: ['NOT_CONFIGURED'], safeDefault: 'NOT_CONFIGURED', minimumSafetyFloor: 'NO_AUTOMATIC_MATERIALITY_ADMISSION', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (category === 'C') {
    if (key === 'C10') return { type: 'STRUCTURED_LIMITS', allowedValues: [{}], safeDefault: {}, minimumSafetyFloor: 'NO_TIMEOUT_OR_BREAKER_POLICY_CONFIGURED', modeCeiling: 'SHADOW', permanentlyLocked };
    return { type: 'ENUM', allowedValues: ['NOT_CONFIGURED'], safeDefault: 'NOT_CONFIGURED', minimumSafetyFloor: 'NO_PROVIDER_OR_MODEL_ROUTE_WITHOUT_OWNER_BINDING', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (key === 'D10' || ['H09', 'H10', 'J10'].includes(key)) {
    return { type: 'STRUCTURED_LIMITS', allowedValues: [{}], safeDefault: {}, minimumSafetyFloor: 'EMPTY_LIMITS_GRANT_NO_EFFECT', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (['B03', 'B05', 'B06', 'B07', 'D08', 'E08', 'F06', 'F10', 'I09', 'J07', 'K06', 'K10'].includes(key)) {
    return { type: 'DURATION_MS', allowedValues: [0], safeDefault: 0, minimumSafetyFloor: 'ZERO_GRANTS_NO_EFFECT', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  if (category === 'D' || ['B04', 'E07', 'J03', 'J04', 'J05', 'J08', 'K09', 'L08'].includes(key)) {
    return { type: 'INTEGER', allowedValues: [0], safeDefault: 0, minimumSafetyFloor: 'ZERO_UNTIL_NUMERICAL_OWNER_TARGET_IS_SIGNED', modeCeiling: 'SHADOW', permanentlyLocked };
  }
  return {
    type: 'BOOLEAN',
    allowedValues: permanentlyLocked ? [enforcedLock] : [false, true],
    safeDefault: enforcedLock,
    minimumSafetyFloor: permanentlyLocked ? 'PERMANENT_HARD_LOCK' : 'DISABLED_UNTIL_WIRED_AND_OWNER_APPROVED',
    modeCeiling: 'SHADOW',
    permanentlyLocked,
  };
}

function effectOwner(category: AiOpsControlCategory, number: number): AiOpsControlRegistryInsertionRequest['delegatedEffectOwnerId'] {
  if (category === 'J') return 'PRODUCT_ASSURANCE_REMEDIATION';
  if (category === 'K') return 'NOTIFICATIONS';
  if (category === 'L' && number >= 9) return 'RISK';
  return 'PRODUCT_RUNTIME_CONTROL_REGISTRY';
}

export const AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS: readonly Readonly<AiOpsControlRegistryInsertionRequest>[] = immutableClone(
  (Object.keys(CONTROL_LABELS) as AiOpsControlCategory[]).flatMap((category) => CONTROL_LABELS[category].map((label, index) => {
    const number = index + 1;
    const suffix = `${category}${String(number).padStart(2, '0')}`;
    return {
      recordKind: 'INSERTION_REQUEST' as const,
      requestId: `AI_OPS_CONTROL_INSERT_${suffix}`,
      controlId: `AI_OPS.${suffix}`,
      category,
      label,
      canonicalOwnerId: 'PRODUCT_RUNTIME_CONTROL_REGISTRY' as const,
      delegatedEffectOwnerId: effectOwner(category, number),
      ...controlShape(category, number),
      scope: 'AI_OPS' as const,
      environment: 'SHADOW' as const,
      effectHandler: null,
      readbackHandler: null,
      approvalRequirement: 'OWNER_SIGNED_CONTROL_CHANGE_SET' as const,
      ttlMs: null,
      revision: 0 as const,
      lastChangedBy: null,
      reason: 'PROVISIONAL_A1_INSERTION_REQUEST' as const,
      receiptId: null,
      currentStatus: 'NOT_WIRED' as const,
      requestedState: 'DRAFT' as const,
      effectiveState: 'DISABLED' as const,
      hardDenialIds: AI_OPS_HARD_DENIAL_IDS,
      authorityCreated: false as const,
    };
  })),
);

export interface AiOpsControlChangeRequest {
  readonly controlId: string;
  readonly requestedValue: AiOpsControlValue;
}

export interface AiOpsControlChangeSet {
  readonly schema: 'AI_OPS_CONTROL_CHANGE_SET_INSERTION_REQUEST_V1';
  readonly expectedRegistryRevision: number;
  readonly changes: readonly Readonly<AiOpsControlChangeRequest>[];
  readonly ownerSignatureReference: string | null;
}

export interface AiOpsControlChangeSetDecision {
  readonly allowed: false;
  readonly appliedCount: 0;
  readonly reasonCodes: readonly string[];
  readonly authorityCreated: false;
}

function isControlValue(value: unknown): value is AiOpsControlValue {
  if (typeof value === 'boolean' || isSafeIntegerAtLeast(value, 0) || isCanonicalSafeText(value)) return true;
  if (isDenseArray(value)) {
    return value.length <= 256
      && Array.from(value).every((entry) => isCanonicalSafeText(entry))
      && new Set(value as readonly string[]).size === value.length;
  }
  if (!isPlainRecord(value) || Object.keys(value).length > 128) return false;
  return Object.entries(value).every(([key, entry]) => isBoundedId(key) && isSafeIntegerAtLeast(entry, 0));
}

export function evaluateProvisionalControlChangeSet(changeSet: Readonly<AiOpsControlChangeSet>): Readonly<AiOpsControlChangeSetDecision> {
  const reasons = ['AI_OPS_CONTROL_REGISTRY_INSERTION_NOT_WIRED', 'SHADOW_SPECULATIVE_CANNOT_APPLY_CONTROLS'];
  let safeChangeSet: Readonly<AiOpsControlChangeSet>;
  try {
    safeChangeSet = canonicalPolicySnapshot(changeSet);
  } catch {
    return immutableClone({ allowed: false as const, appliedCount: 0 as const, reasonCodes: sortedUnique([...reasons, 'CONTROL_CHANGE_SET_SCHEMA_INVALID']), authorityCreated: false as const });
  }
  if (
    !exactKeys(safeChangeSet, ['schema', 'expectedRegistryRevision', 'changes', 'ownerSignatureReference'])
    || safeChangeSet.schema !== 'AI_OPS_CONTROL_CHANGE_SET_INSERTION_REQUEST_V1'
    || !isSafeIntegerAtLeast(safeChangeSet.expectedRegistryRevision, 0)
    || !isDenseArray(safeChangeSet.changes)
    || safeChangeSet.changes.length > 120
    || !(safeChangeSet.ownerSignatureReference === null || isBoundedId(safeChangeSet.ownerSignatureReference))
    || Array.from(safeChangeSet.changes).some((change) => !exactKeys(change, ['controlId', 'requestedValue']) || !isBoundedId(change.controlId) || !isControlValue(change.requestedValue))
  ) {
    return immutableClone({ allowed: false as const, appliedCount: 0 as const, reasonCodes: sortedUnique([...reasons, 'CONTROL_CHANGE_SET_SCHEMA_INVALID']), authorityCreated: false as const });
  }
  if (safeChangeSet.changes.length === 0) reasons.push('CONTROL_CHANGE_SET_EMPTY');
  if (new Set(safeChangeSet.changes.map((change) => change.controlId)).size !== safeChangeSet.changes.length) reasons.push('CONTROL_CHANGE_DUPLICATE');
  for (const change of safeChangeSet.changes) {
    const control = AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.find((row) => row.controlId === change.controlId);
    if (!control) reasons.push('CONTROL_UNKNOWN_REDACTED');
    else if (control.permanentlyLocked && canonicalPolicyJson(change.requestedValue) !== canonicalPolicyJson(control.safeDefault)) reasons.push(`PERMANENT_LOCK:${change.controlId}`);
  }
  return immutableClone({ allowed: false as const, appliedCount: 0 as const, reasonCodes: sortedUnique(reasons), authorityCreated: false as const });
}

export function validateControlInsertionRequests(): readonly string[] {
  const failures: string[] = [];
  if (AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.length !== 120) failures.push('CONTROL_COUNT_NOT_120');
  const ids = AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS.map((row) => row.controlId);
  if (new Set(ids).size !== 120) failures.push('CONTROL_IDS_NOT_UNIQUE');
  for (const row of AI_OPS_CONTROL_REGISTRY_INSERTION_REQUESTS) {
    if (!/^AI_OPS\.[A-L](0[1-9]|10)$/.test(row.controlId)) failures.push(`CONTROL_ID_INVALID:${row.controlId}`);
    if (row.currentStatus !== 'NOT_WIRED' || row.effectHandler !== null || row.readbackHandler !== null) failures.push(`CONTROL_FAKES_WIRING:${row.controlId}`);
    if (row.authorityCreated !== false || row.recordKind !== 'INSERTION_REQUEST') failures.push(`CONTROL_CREATES_AUTHORITY:${row.controlId}`);
    if (canonicalHardDenials(row.hardDenialIds) !== canonicalHardDenials(AI_OPS_HARD_DENIAL_IDS)) failures.push(`CONTROL_DENIAL_SET_INCOMPLETE:${row.controlId}`);
  }
  return sortedUnique(failures);
}

function canonicalHardDenials(ids: readonly string[]): string {
  return JSON.stringify(sortedUnique(ids));
}
