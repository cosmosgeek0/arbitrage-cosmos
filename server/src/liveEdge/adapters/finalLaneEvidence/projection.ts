import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  validateExternalProofEvidenceSnapshot,
  type ExternalProofClass,
  type ExternalProofEvidenceSnapshot,
  type ExternalProofSubject,
} from '../externalProofEvidence/index.js';
import {
  FINAL_LANE_ACCEPTED_IDENTITIES,
  FINAL_LANE_BRANCH,
  FINAL_LANE_COMMAND_SPECS,
  FINAL_LANE_DIRECTOR_ANCHOR,
  FINAL_LANE_EVIDENCE_SCHEMA,
  FINAL_LANE_PROTECTED_INPUTS,
  FINAL_LANE_SCOPE_GATE_ARTIFACTS,
  FINAL_LANE_SUBJECTS,
  FINAL_OPERATIONAL_SUBJECTS,
  type FinalLaneClassifiedEvidence,
  type FinalLaneCommandEvidence,
  type FinalLaneEvidenceInput,
  type FinalLaneEvidenceSnapshot,
  type FinalLaneL16Lineage,
  type FinalLaneScopeGateEvidence,
  type FinalLaneSubject,
  type FinalOperationalNonPerformanceEvidence,
} from './types.js';

const MAX_ARRAY = 10_000;
const MAX_DEPTH = 28;
const MAX_KEYS = 5_000_000;
const MAX_STRING_LENGTH = 16_384;
const MAX_TOTAL_STRING_UNITS = 100_000_000;
const MAX_PROPERTY_NAME = 256;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const L16_ACCUMULATED_ASSERTIONS = 1_595;
const SENSITIVE_FIELD_NAMES = new Set([
  'secret', 'apikey', 'apisecret', 'clientsecret', 'credentials', 'password',
  'passphrase', 'privatekey', 'signature', 'bearer', 'bearertoken', 'token',
  'accesstoken', 'listenkey', 'sessionkey', 'accesskey',
]);
const SENSITIVE_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|(?:(?:authorization\s*[:=]\s*bearer)|(?:x-mbx-apikey|api[_ -]?key|api[_ -]?secret|client[_ -]?secret|secret[_ -]?access[_ -]?key|access[_ -]?token|listen[_ -]?key|session[_ -]?key)\s*[:=])\s*\S{12,})/i;

const OPERATIONAL_REASON = Object.freeze({
  ROLLBACK_PROOF: 'ROLLBACK_NOT_PERFORMED',
  BACKUP_RESTORE_PROOF: 'BACKUP_RESTORE_NOT_PERFORMED',
  CANARY_PREFLIGHT_PROOF: 'CANARY_PREFLIGHT_NOT_PERFORMED',
  REAL_CANARY_PROOF: 'REAL_CANARY_NOT_PERFORMED',
} as const);

function assertClosedPlainData(value: unknown): void {
  let keyCount = 0;
  let stringUnits = 0;
  const visiting = new Set<object>();
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new RangeError('L17 input exceeds the maximum depth');
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_STRING_LENGTH) throw new RangeError('L17 input contains an oversized string');
      stringUnits += candidate.length;
      if (stringUnits > MAX_TOTAL_STRING_UNITS) throw new RangeError('L17 input exceeds the aggregate string bound');
      if (SENSITIVE_VALUE.test(candidate)) throw new TypeError('L17 input forbids secret-shaped string values');
      return;
    }
    if (candidate === null || ['number', 'boolean'].includes(typeof candidate)) return;
    if (typeof candidate !== 'object') throw new TypeError('L17 input must contain plain serializable data only');
    if (visiting.has(candidate)) throw new TypeError('L17 input must not contain cycles');
    if (seen.has(candidate)) return;
    visiting.add(candidate);
    if (Object.getOwnPropertySymbols(candidate).length !== 0) {
      throw new TypeError('L17 input must not contain symbol fields');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const names = Object.keys(descriptors).filter((name) => !Array.isArray(candidate) || name !== 'length');
    keyCount += names.length;
    if (keyCount > MAX_KEYS) throw new RangeError('L17 input exceeds the maximum field count');
    const prototype = Object.getPrototypeOf(candidate);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || candidate.length > MAX_ARRAY) {
        throw new TypeError('L17 arrays must be bounded ordinary arrays');
      }
      for (let index = 0; index < candidate.length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new TypeError('L17 arrays must not be sparse');
      }
      if (names.some((name) => !/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= candidate.length)) {
        throw new TypeError('L17 arrays must not contain non-index properties');
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('L17 records must be plain objects');
    }
    for (const name of names) {
      if (name.length > MAX_PROPERTY_NAME) throw new RangeError('L17 input contains an oversized property name');
      stringUnits += name.length;
      if (stringUnits > MAX_TOTAL_STRING_UNITS) throw new RangeError('L17 input exceeds the aggregate string bound');
      const normalized = name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      if (SENSITIVE_FIELD_NAMES.has(normalized)) throw new TypeError(`L17 input forbids sensitive field ${name}`);
      const descriptor = descriptors[name];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError('L17 input forbids accessors and hidden fields');
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

function exactKeys(value: object, expected: readonly string[], name: string): void {
  const found = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(found) !== canonicalJson(wanted)) {
    throw new TypeError(`${name} must use its exact closed schema`);
  }
}

function validTime(value: unknown, name: string, maximum: number, minimum: number): number {
  if (!isValidUtcMillis(value) || (value as number) > maximum || (value as number) < minimum) {
    throw new TypeError(`${name} must be injected UTC milliseconds within the accepted lineage window`);
  }
  return value as number;
}

function nonNegativeCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function positiveCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function validateAcceptedIdentities(value: FinalLaneEvidenceInput['identities']): void {
  exactKeys(value, Object.keys(FINAL_LANE_ACCEPTED_IDENTITIES), 'identities');
  if (canonicalJson(value) !== canonicalJson(FINAL_LANE_ACCEPTED_IDENTITIES)) {
    throw new TypeError('identities must match the exact accepted L12/L13/L15/L16 and ruling chain');
  }
}

function validateProtectedInputs(
  value: FinalLaneScopeGateEvidence['protectedInputs'],
): void {
  if (!Array.isArray(value) || value.length !== FINAL_LANE_PROTECTED_INPUTS.length) {
    throw new TypeError('scopeGate.protectedInputs must contain the exact two protected directives');
  }
  value.forEach((entry, index) => {
    exactKeys(entry, [
      'path', 'sha256', 'regularFile', 'symlink', 'untracked', 'unstaged',
    ], `scopeGate.protectedInputs[${index}]`);
    const expected = FINAL_LANE_PROTECTED_INPUTS[index];
    if (expected === undefined || entry.path !== expected.path || entry.sha256 !== expected.sha256
        || !SHA256.test(entry.sha256) || entry.regularFile !== true || entry.symlink !== false
        || entry.untracked !== true || entry.unstaged !== true) {
      throw new TypeError('scopeGate protected inputs must be exact, regular, non-symlink, untracked and unstaged');
    }
  });
}

function validateScopeGate(
  value: FinalLaneScopeGateEvidence,
  implementationRevision: string,
  evaluatedAtMs: number,
  minimumTime: number,
): void {
  exactKeys(value, [
    'schema', 'command', 'mode', 'branch', 'knownAnchor', 'selectedBaseline', 'checkedRevision',
    'gateScriptSha256', 'gateTestSha256',
    'anchorIsAncestor', 'baselineOnFirstParent', 'baselineHasTwoParents',
    'baselineSubjectHasExactDirectorPrefix',
    'classifierCryptographicallyAuthenticatesAuthorship', 'workerCommitCount',
    'committedPathObservations', 'trackedDirtyPathCount',
    'nonProtectedUntrackedPathCount', 'violations', 'protectedInputs',
    'checkedAtMs', 'exitCode',
  ], 'scopeGate');
  if (value.schema !== 'L_WORKER_SCOPE_GATE_V1'
      || value.command !== 'ops/tests/lane-worker-scope-gate.sh --final'
      || value.mode !== 'FINAL' || value.branch !== FINAL_LANE_BRANCH
      || value.knownAnchor !== FINAL_LANE_DIRECTOR_ANCHOR
      || value.selectedBaseline !== FINAL_LANE_DIRECTOR_ANCHOR
      || !GIT_COMMIT.test(value.selectedBaseline)
      || value.checkedRevision !== implementationRevision
      || !GIT_COMMIT.test(value.checkedRevision)
      || value.gateScriptSha256 !== FINAL_LANE_SCOPE_GATE_ARTIFACTS.gateScriptSha256
      || value.gateTestSha256 !== FINAL_LANE_SCOPE_GATE_ARTIFACTS.gateTestSha256
      || value.anchorIsAncestor !== true || value.baselineOnFirstParent !== true
      || value.baselineHasTwoParents !== true
      || value.baselineSubjectHasExactDirectorPrefix !== true
      || value.classifierCryptographicallyAuthenticatesAuthorship !== false
      || value.trackedDirtyPathCount !== 0 || value.nonProtectedUntrackedPathCount !== 0
      || value.exitCode !== 0 || !Array.isArray(value.violations) || value.violations.length !== 0) {
    throw new TypeError('scopeGate must be one passing final D-LAUNCH-16 worker-only scope proof');
  }
  positiveCount(value.workerCommitCount, 'scopeGate.workerCommitCount');
  positiveCount(value.committedPathObservations, 'scopeGate.committedPathObservations');
  const checkedAtMs = validTime(
    value.checkedAtMs,
    'scopeGate.checkedAtMs',
    evaluatedAtMs,
    minimumTime,
  );
  if (checkedAtMs !== evaluatedAtMs) {
    throw new TypeError('scopeGate, final command, operational evidence and snapshot must share one exact seal instant');
  }
  validateProtectedInputs(value.protectedInputs);
}

function validateCommands(
  value: FinalLaneEvidenceInput['commands'],
  implementationRevision: string,
  evaluatedAtMs: number,
  minimumTime: number,
): void {
  if (!Array.isArray(value) || value.length !== FINAL_LANE_COMMAND_SPECS.length) {
    throw new TypeError('commands must contain the complete exact L17 acceptance gate');
  }
  let previousVerifiedAtMs = minimumTime;
  value.forEach((entry, index) => {
    exactKeys(entry, [
      'check', 'command', 'sourceRevision', 'verifiedAtMs', 'exitCode', 'assertions',
    ], `commands[${index}]`);
    const expected = FINAL_LANE_COMMAND_SPECS[index];
    if (expected === undefined || entry.check !== expected.check || entry.command !== expected.command
        || entry.sourceRevision !== implementationRevision || entry.exitCode !== 0) {
      throw new TypeError(`commands[${index}] must be the exact passing revision-bound L17 gate`);
    }
    const verifiedAtMs = validTime(
      entry.verifiedAtMs,
      `commands[${index}].verifiedAtMs`,
      evaluatedAtMs,
      minimumTime,
    );
    if (verifiedAtMs < previousVerifiedAtMs) {
      throw new TypeError('commands must retain canonical nondecreasing verification chronology');
    }
    if (index === value.length - 1 && verifiedAtMs <= previousVerifiedAtMs) {
      throw new TypeError('the final worker scope gate must be strictly later than every preceding command');
    }
    previousVerifiedAtMs = verifiedAtMs;
    if (expected.assertionRule === null) {
      if (entry.assertions !== null) throw new TypeError(`commands[${index}] must not fabricate assertion counts`);
    } else if (entry.assertions !== expected.assertionRule) {
      throw new TypeError(`commands[${index}] assertion count does not match the accepted owner gate`);
    }
  });
  const focused = value.find((entry) => entry.check === 'L17_FOCUSED')?.assertions;
  const accumulated = value.find((entry) => entry.check === 'ACCUMULATED_LIVE_EDGE')?.assertions;
  if (typeof focused !== 'number' || accumulated !== L16_ACCUMULATED_ASSERTIONS + focused) {
    throw new TypeError('ACCUMULATED_LIVE_EDGE must equal accepted L16 plus the exact L17 focused count');
  }
}

function validateOperationalEvidence(
  value: FinalLaneEvidenceInput['operationalEvidence'],
  evaluatedAtMs: number,
  minimumTime: number,
): void {
  if (!Array.isArray(value) || value.length !== FINAL_OPERATIONAL_SUBJECTS.length) {
    throw new TypeError('operationalEvidence must cover rollback, backup/restore, canary preflight and real canary exactly');
  }
  value.forEach((entry, index) => {
    exactKeys(entry, [
      'subject', 'kind', 'proofState', 'performed', 'checkedAtMs', 'reasonCodes',
    ], `operationalEvidence[${index}]`);
    const subject = FINAL_OPERATIONAL_SUBJECTS[index];
    const expectedReason = subject === undefined ? undefined : OPERATIONAL_REASON[subject];
    if (subject === undefined || entry.subject !== subject
        || entry.kind !== 'OPERATION_NOT_PERFORMED' || entry.proofState !== 'ABSENT'
        || entry.performed !== false || !Array.isArray(entry.reasonCodes)
        || entry.reasonCodes.length !== 1 || entry.reasonCodes[0] !== expectedReason
        || !CODE.test(entry.reasonCodes[0] ?? '')) {
      throw new TypeError(`operationalEvidence[${index}] must preserve exact non-performance truth`);
    }
    const checkedAtMs = validTime(
      entry.checkedAtMs,
      `operationalEvidence[${index}].checkedAtMs`,
      evaluatedAtMs,
      minimumTime,
    );
    if (checkedAtMs !== evaluatedAtMs) {
      throw new TypeError('operational non-performance evidence must be checked at the final scope instant');
    }
  });
}

function l16Record(
  value: Readonly<ExternalProofEvidenceSnapshot>,
  subject: ExternalProofSubject,
): ExternalProofEvidenceSnapshot['evidence'][number] {
  const found = value.evidence.find((entry) => entry.subject === subject);
  if (found === undefined) throw new TypeError(`validated L16 evidence is missing ${subject}`);
  return found;
}

function requireL16Class(
  value: Readonly<ExternalProofEvidenceSnapshot>,
  subjects: readonly ExternalProofSubject[],
  classification: ExternalProofClass,
): void {
  for (const subject of subjects) {
    if (l16Record(value, subject).classification !== classification) {
      throw new TypeError(`validated L16 ${subject} must remain ${classification}`);
    }
  }
}

function uniqueReasons(
  l16: Readonly<ExternalProofEvidenceSnapshot>,
  subjects: readonly ExternalProofSubject[],
): readonly string[] {
  const reasons = subjects.flatMap((subject) => [...l16Record(l16, subject).evidence.reasonCodes]);
  return [...new Set(reasons)];
}

function deriveL16PrefixRevision(value: Readonly<ExternalProofEvidenceSnapshot>): string {
  const {
    snapshotRevision: _snapshotRevision,
    evidence,
    ...rest
  } = value;
  const material = { ...rest, evidence: evidence.slice(0, -1) };
  return `l16prefix_${stableHash128Hex(canonicalJson(material))}`;
}

function validateAcceptedL16Binding(value: Readonly<ExternalProofEvidenceSnapshot>): void {
  const filter = l16Record(value, 'CURRENT_FILTER_ADMISSION');
  if (value.implementationRevision !== FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit
      || value.evaluatedAtMs !== FINAL_LANE_ACCEPTED_IDENTITIES.l16EvaluatedAtMs
      || value.lineage.sourceSnapshotRevision !== FINAL_LANE_ACCEPTED_IDENTITIES.l13SnapshotRevision
      || value.lineage.l12SourceSnapshotRevision !== FINAL_LANE_ACCEPTED_IDENTITIES.l12SnapshotRevision
      || deriveL16PrefixRevision(value) !== FINAL_LANE_ACCEPTED_IDENTITIES.l16AcceptedPrefixRevision
      || (filter.classification === 'UNPROVEN'
        && value.snapshotRevision !== FINAL_LANE_ACCEPTED_IDENTITIES.l16OrdinarySnapshotRevision)) {
    throw new TypeError('L16 snapshot must bind the exact accepted L12/L13/L16 lineage and evidence prefix');
  }
}

function effectiveFilterAdmission(
  l16: Readonly<ExternalProofEvidenceSnapshot>,
  evaluatedAtMs: number,
): Readonly<{ classification: 'UNPROVEN' | 'FILTER_BLOCKED'; reasonCodes: readonly string[] }> {
  const record = l16Record(l16, 'CURRENT_FILTER_ADMISSION');
  if (record.classification === 'UNPROVEN') {
    return cloneFreeze({
      classification: 'UNPROVEN' as const,
      reasonCodes: [...record.evidence.reasonCodes],
    });
  }
  if (record.classification !== 'FILTER_BLOCKED'
      || record.evidence.kind !== 'CURRENT_OWNER_FILTER_VERDICT') {
    throw new TypeError('current filter admission must originate in the exact validated L16 owner verdict');
  }
  const instrumentValidUntilMs = record.evidence.ownerResult.instrumentValidUntilMs;
  const referenceValidUntilMs = record.evidence.ownerResult.referenceValidUntilMs;
  const validityBounds = [instrumentValidUntilMs, referenceValidUntilMs]
    .filter((bound): bound is number => bound !== null);
  if (!isValidUtcMillis(instrumentValidUntilMs)
      || (referenceValidUntilMs !== null && !isValidUtcMillis(referenceValidUntilMs))
      || validityBounds.some((bound) => evaluatedAtMs > bound)) {
    return cloneFreeze({
      classification: 'UNPROVEN' as const,
      reasonCodes: ['L16_FILTER_OWNER_VERDICT_NOT_CURRENT_AT_L17'],
    });
  }
  return cloneFreeze({
    classification: 'FILTER_BLOCKED' as const,
    reasonCodes: [...record.evidence.reasonCodes],
  });
}

function classified(
  subject: FinalLaneSubject,
  classification: ExternalProofClass,
  sourceSubjects: readonly ExternalProofSubject[],
  reasonCodes: readonly string[],
): Readonly<FinalLaneClassifiedEvidence> {
  return cloneFreeze({
    subject,
    classification,
    sourceSubjects,
    reasonCodes,
    provesIntegrated: false,
    provesDeployed: false,
    provesPrivate: false,
    provesTradeReady: false,
    provesLive: false,
    provesProductionReadiness: false,
    provesMoneyMutation: false,
  } satisfies FinalLaneClassifiedEvidence);
}

function deriveClassifications(
  l16: Readonly<ExternalProofEvidenceSnapshot>,
  operational: readonly Readonly<FinalOperationalNonPerformanceEvidence>[],
  evaluatedAtMs: number,
): readonly Readonly<FinalLaneClassifiedEvidence>[] {
  requireL16Class(l16, ['SYNTHETIC_FAULT_AND_REPLAY'], 'SYNTHETIC_REPLAY');
  requireL16Class(l16, ['SERVICE_RESTART_AND_DEGRADED_BEHAVIOR'], 'OWNER_GATED');
  requireL16Class(l16, [
    'DEPLOYED_EC2_APPLICATION_AND_COCKPIT', 'CLOUDFLARE_TUNNEL_AND_ACCESS',
  ], 'UNPROVEN');
  requireL16Class(l16, ['PUBLIC_RUNTIME_OBSERVATION'], 'NOT_PERFORMED');
  requireL16Class(l16, ['PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH'], 'OWNER_GATED');
  requireL16Class(l16, [
    'SPOT_SIGNED_TEST_ORDER', 'USD_M_SIGNED_TEST_ORDER', 'MARGIN_SIGNED_TEST_ORDER',
  ], 'PROHIBITED');
  requireL16Class(l16, ['MARGIN_BORROW_AND_REPAY'], 'PROHIBITED');
  requireL16Class(l16, ['LIVE_ORDER', 'STRATEGY_LIVE_TICKET'], 'PROHIBITED');
  requireL16Class(l16, ['L15_DEPLOYMENT_ARTIFACTS'], 'ACCEPTED_SATELLITE');
  requireL16Class(l16, ['LANE_RUNTIME_WIRING'], 'UNWIRED');
  requireL16Class(l16, ['I00_COMBINED_FAN_IN'], 'DEFERRED_TO_I00');
  const filter = effectiveFilterAdmission(l16, evaluatedAtMs);
  const operationalBySubject = new Map(operational.map((entry) => [entry.subject, entry]));
  const result = [
    classified(
      'PROTOCOL_CONFORMANCE', 'UNPROVEN', [],
      ['INJECTED_GATE_EVIDENCE_PENDING_RECEIPT'],
    ),
    classified(
      'SECURITY_BOUNDARY', 'UNPROVEN', [],
      ['INJECTED_GATE_EVIDENCE_PENDING_RECEIPT'],
    ),
    classified(
      'SYNTHETIC_FAULT_REPLAY', 'SYNTHETIC_REPLAY', ['SYNTHETIC_FAULT_AND_REPLAY'],
      uniqueReasons(l16, ['SYNTHETIC_FAULT_AND_REPLAY']),
    ),
    classified(
      'SERVICE_RESTART', 'OWNER_GATED', ['SERVICE_RESTART_AND_DEGRADED_BEHAVIOR'],
      uniqueReasons(l16, ['SERVICE_RESTART_AND_DEGRADED_BEHAVIOR']),
    ),
    classified('ROLLBACK', 'NOT_PERFORMED', [], operationalBySubject.get('ROLLBACK_PROOF')?.reasonCodes ?? []),
    classified(
      'BACKUP_RESTORE', 'NOT_PERFORMED', [],
      operationalBySubject.get('BACKUP_RESTORE_PROOF')?.reasonCodes ?? [],
    ),
    classified(
      'CANARY_PREFLIGHT', 'NOT_PERFORMED', [],
      operationalBySubject.get('CANARY_PREFLIGHT_PROOF')?.reasonCodes ?? [],
    ),
    classified('REAL_CANARY', 'NOT_PERFORMED', [], operationalBySubject.get('REAL_CANARY_PROOF')?.reasonCodes ?? []),
    classified(
      'AWS_CLOUDFLARE_DEPLOYMENT', 'UNPROVEN',
      ['DEPLOYED_EC2_APPLICATION_AND_COCKPIT', 'CLOUDFLARE_TUNNEL_AND_ACCESS'],
      uniqueReasons(l16, ['DEPLOYED_EC2_APPLICATION_AND_COCKPIT', 'CLOUDFLARE_TUNNEL_AND_ACCESS']),
    ),
    classified(
      'PUBLIC_RUNTIME_OBSERVATION', 'NOT_PERFORMED', ['PUBLIC_RUNTIME_OBSERVATION'],
      uniqueReasons(l16, ['PUBLIC_RUNTIME_OBSERVATION']),
    ),
    classified(
      'PRIVATE_ACCOUNT_RECONCILIATION', 'OWNER_GATED',
      ['PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH'],
      uniqueReasons(l16, ['PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH']),
    ),
    classified(
      'SIGNED_TEST_ORDERS', 'PROHIBITED',
      ['SPOT_SIGNED_TEST_ORDER', 'USD_M_SIGNED_TEST_ORDER', 'MARGIN_SIGNED_TEST_ORDER'],
      uniqueReasons(l16, ['SPOT_SIGNED_TEST_ORDER', 'USD_M_SIGNED_TEST_ORDER', 'MARGIN_SIGNED_TEST_ORDER']),
    ),
    classified(
      'MARGIN_BORROW_REPAY', 'PROHIBITED', ['MARGIN_BORROW_AND_REPAY'],
      uniqueReasons(l16, ['MARGIN_BORROW_AND_REPAY']),
    ),
    classified(
      'LIVE_EXECUTION', 'PROHIBITED', ['LIVE_ORDER', 'STRATEGY_LIVE_TICKET'],
      uniqueReasons(l16, ['LIVE_ORDER', 'STRATEGY_LIVE_TICKET']),
    ),
    classified(
      'L15_DEPLOYMENT_SATELLITE', 'ACCEPTED_SATELLITE', ['L15_DEPLOYMENT_ARTIFACTS'],
      uniqueReasons(l16, ['L15_DEPLOYMENT_ARTIFACTS']),
    ),
    classified(
      'LANE_RUNTIME_WIRING', 'UNWIRED', ['LANE_RUNTIME_WIRING'],
      uniqueReasons(l16, ['LANE_RUNTIME_WIRING']),
    ),
    classified(
      'Q_L_COMBINED_CHAIN', 'DEFERRED_TO_I00', ['I00_COMBINED_FAN_IN'],
      uniqueReasons(l16, ['I00_COMBINED_FAN_IN']),
    ),
    classified(
      'CURRENT_FILTER_ADMISSION', filter.classification, ['CURRENT_FILTER_ADMISSION'],
      filter.reasonCodes,
    ),
  ];
  if (canonicalJson(result.map(({ subject }) => subject)) !== canonicalJson(FINAL_LANE_SUBJECTS)) {
    throw new TypeError('final evidence classifier does not cover the exact closed subject catalog');
  }
  return cloneFreeze(result);
}

function deriveL16Lineage(
  value: Readonly<ExternalProofEvidenceSnapshot>,
  effectiveFilterClass: 'UNPROVEN' | 'FILTER_BLOCKED',
): Readonly<FinalLaneL16Lineage> {
  const sourceFilterAdmissionClass = l16Record(value, 'CURRENT_FILTER_ADMISSION').classification;
  if (sourceFilterAdmissionClass !== 'UNPROVEN' && sourceFilterAdmissionClass !== 'FILTER_BLOCKED') {
    throw new TypeError('L16 filter admission cannot be reclassified by L17');
  }
  if (value.implementationRevision !== FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit
      || value.projectionAuthority !== 'INJECTED_EVIDENCE_CLASSIFICATION_ONLY'
      || value.classificationAuthority !== 'CLOSED_KIND_MAPPING_ONLY'
      || value.externalCalls !== false || value.sendEligible !== false
      || value.deployedProof !== false || value.livePublicProof !== false
      || value.livePrivateProof !== false || value.readinessProof !== false
      || value.moneyMutationProof !== false
      || value.lineage.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L16 lineage must remain the exact accepted non-authorizing implementation');
  }
  return cloneFreeze({
    sourceSchema: value.schema,
    sourceVersion: value.version,
    sourceSnapshotRevision: value.snapshotRevision,
    sourceEvaluatedAtMs: value.evaluatedAtMs,
    sourceImplementationRevision: FINAL_LANE_ACCEPTED_IDENTITIES.l16ImplementationCommit,
    l13SourceSnapshotRevision: value.lineage.sourceSnapshotRevision,
    l12SourceSnapshotRevision: value.lineage.l12SourceSnapshotRevision,
    sourceFilterAdmissionClass,
    effectiveFilterAdmissionClass: effectiveFilterClass,
    projectionAuthority: value.projectionAuthority,
    classificationAuthority: value.classificationAuthority,
    externalActionAuthorization: value.lineage.externalActionAuthorization,
  } satisfies FinalLaneL16Lineage);
}

function deriveSnapshotRevision(material: unknown): string {
  assertClosedPlainData(material);
  return `l17_${stableHash128Hex(canonicalJson(material))}`;
}

export function projectFinalLaneEvidence(
  input: FinalLaneEvidenceInput,
): Readonly<FinalLaneEvidenceSnapshot> {
  assertClosedPlainData(input);
  exactKeys(input, [
    'evaluatedAtMs', 'implementationRevision', 'l12Snapshot', 'l13Snapshot',
    'l16Snapshot', 'identities', 'scopeGate', 'commands', 'operationalEvidence',
  ], 'input');
  if (!isValidUtcMillis(input.evaluatedAtMs)) {
    throw new TypeError('evaluatedAtMs must be injected valid UTC milliseconds');
  }
  if (!GIT_COMMIT.test(input.implementationRevision)) {
    throw new TypeError('implementationRevision must be one exact lowercase 40-hex L17 revision');
  }
  const cloned = cloneFreeze(input) as Readonly<FinalLaneEvidenceInput>;
  validateAcceptedIdentities(cloned.identities);
  const l16 = validateExternalProofEvidenceSnapshot(
    cloned.l16Snapshot,
    cloned.l12Snapshot,
    cloned.l13Snapshot,
  );
  validateAcceptedL16Binding(l16);
  if (cloned.evaluatedAtMs < l16.evaluatedAtMs) {
    throw new TypeError('evaluatedAtMs cannot predate the accepted L16 evidence');
  }
  validateScopeGate(
    cloned.scopeGate,
    cloned.implementationRevision,
    cloned.evaluatedAtMs,
    l16.evaluatedAtMs,
  );
  validateCommands(
    cloned.commands,
    cloned.implementationRevision,
    cloned.evaluatedAtMs,
    l16.evaluatedAtMs,
  );
  const finalScopeCommand = cloned.commands.find((entry) => entry.check === 'FINAL_WORKER_SCOPE_GATE');
  if (finalScopeCommand?.verifiedAtMs !== cloned.scopeGate.checkedAtMs) {
    throw new TypeError('final scope command and scopeGate proof must bind the same measured instant');
  }
  validateOperationalEvidence(
    cloned.operationalEvidence,
    cloned.evaluatedAtMs,
    l16.evaluatedAtMs,
  );
  const filter = effectiveFilterAdmission(l16, cloned.evaluatedAtMs);
  const l16Lineage = deriveL16Lineage(l16, filter.classification);
  const evidence = deriveClassifications(l16, cloned.operationalEvidence, cloned.evaluatedAtMs);
  const material = {
    schema: FINAL_LANE_EVIDENCE_SCHEMA,
    version: 1 as const,
    evaluatedAtMs: cloned.evaluatedAtMs,
    implementationRevision: cloned.implementationRevision,
    l16Lineage,
    identities: cloned.identities,
    scopeGate: cloned.scopeGate,
    commands: cloned.commands,
    operationalEvidence: cloned.operationalEvidence,
    evidence,
    evidenceDisposition: 'LOCAL_GATE_EVIDENCE_COMPLETE' as const,
    acceptanceState: 'PENDING_IMMUTABLE_RECEIPT_ACCEPTANCE' as const,
    evidenceTrust: 'INJECTED_UNATTESTED' as const,
    measurementAuthority: 'INJECTED_RECORD_ONLY' as const,
    laneApplicability: 'L_LANE_LOCAL_ONLY' as const,
    releaseState: 'SYNTHETIC_ONLY' as const,
    integrationState: 'UNWIRED' as const,
    combinedChainState: 'DEFERRED_TO_I00' as const,
    injectedLocalGateEvidenceComplete: true as const,
    cryptographicAttestation: false as const,
    gateExecutionObservedByAdapter: false as const,
    projectionAuthority: 'INJECTED_VALIDATED_EVIDENCE_ONLY' as const,
    classificationAuthority: 'CLOSED_FINAL_MAPPING_ONLY' as const,
    externalCalls: false as const,
    filesystemAccess: false as const,
    gitAccess: false as const,
    environmentAccess: false as const,
    credentialAccess: 'NONE' as const,
    runnerAuthority: 'NONE' as const,
    controlAuthority: 'NONE' as const,
    deploymentAuthority: 'NONE' as const,
    restartAuthority: 'NONE' as const,
    readinessAuthority: 'NONE' as const,
    actionAuthority: 'NONE' as const,
    sendEligible: false as const,
    liveExecution: 'LIVE_EXECUTION_NOT_IMPLEMENTED' as const,
    combinedAcceptance: false as const,
    integratedProof: false as const,
    deployedProof: false as const,
    livePublicProof: false as const,
    livePrivateProof: false as const,
    tradeReadyProof: false as const,
    productionReadinessProof: false as const,
    laneReadyProof: false as const,
    moneyMutationProof: false as const,
  };
  return cloneFreeze({
    ...material,
    snapshotRevision: deriveSnapshotRevision(material),
  } satisfies FinalLaneEvidenceSnapshot);
}

export function validateFinalLaneEvidenceSnapshot(
  value: Readonly<FinalLaneEvidenceSnapshot>,
  l12Snapshot: Readonly<FinalLaneEvidenceInput['l12Snapshot']>,
  l13Snapshot: Readonly<FinalLaneEvidenceInput['l13Snapshot']>,
  l16Snapshot: Readonly<FinalLaneEvidenceInput['l16Snapshot']>,
): Readonly<FinalLaneEvidenceSnapshot> {
  assertClosedPlainData(value);
  if (value.schema !== FINAL_LANE_EVIDENCE_SCHEMA || value.version !== 1) {
    throw new TypeError('final lane evidence snapshot schema mismatch');
  }
  const reproduced = projectFinalLaneEvidence({
    evaluatedAtMs: value.evaluatedAtMs,
    implementationRevision: value.implementationRevision,
    l12Snapshot,
    l13Snapshot,
    l16Snapshot,
    identities: value.identities,
    scopeGate: value.scopeGate,
    commands: value.commands,
    operationalEvidence: value.operationalEvidence,
  });
  if (canonicalJson(reproduced) !== canonicalJson(value)) {
    throw new TypeError('final lane evidence snapshot is not reproducible');
  }
  return reproduced;
}
