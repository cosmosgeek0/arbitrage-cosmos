import {
  canonicalJson,
  DESIRED_RUNTIME_STATES,
  isValidUtcMillis,
  RUNTIME_PHASES,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import { RATE_STATES } from '../../../foundation/observability/types.js';
import {
  EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA,
  validateExposureRecoverySnapshot,
  type L12SupervisorSnapshot,
} from '../exposureRecoveryProjection/index.js';
import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  MACHINE_GRAPH_ALARMS,
  MACHINE_GRAPH_CONTROL_ACTIONS,
  MACHINE_GRAPH_EVIDENCE_SCHEMA,
  MACHINE_GRAPH_METRICS,
  MACHINE_GRAPH_METRIC_INSTRUMENTS,
  MACHINE_GRAPH_METRIC_UNITS,
  MACHINE_GRAPH_ROLES,
  type CounterWindowEvidence,
  type L12SnapshotBindingCopy,
  type L12SubjectBinding,
  type MachineGraphAlarmEvidence,
  type MachineGraphControlStateEvidence,
  type MachineGraphControlEvidence,
  type MachineGraphEvidenceInput,
  type MachineGraphEvidenceSnapshot,
  type MachineGraphMetric,
  type MachineGraphMetricEvidence,
  type MachineGraphMetricUnit,
  type MachineGraphRateEvidence,
  type MachineGraphRoleEvidence,
} from './types.js';

const MAX_ARRAY = 128;
const MAX_DEPTH = 18;
const MAX_KEYS = 12_000;
const MAX_STRING_LENGTH = 16_384;
const MAX_TOTAL_STRING_UNITS = 1_000_000;
const MAX_TEXT = 256;
const MAX_CODES = 64;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const DEPLOYED_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const EXACT_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const SENSITIVE_FIELD_NAMES = new Set([
  'secret', 'apikey', 'apisecret', 'clientsecret', 'credential', 'credentials',
  'password', 'passphrase', 'privatekey', 'signature', 'authorization', 'bearer',
  'bearertoken', 'token', 'accesstoken', 'listenkey', 'sessionkey', 'accesskey',
]);
const SENSITIVE_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|(?:(?:authorization\s*[:=]\s*bearer)|(?:x-mbx-apikey|api[_ -]?key|api[_ -]?secret|client[_ -]?secret|secret[_ -]?access[_ -]?key|access[_ -]?token|listen[_ -]?key|session[_ -]?key)\s*[:=])\s*\S{12,})/i;
const RUNTIME_ONLY_ACTIONS = new Set([
  'SET_COMPONENT_DESIRED_STATE',
  'SAFE_RESTART_COMPONENT',
]);

function assertClosedPlainData(value: unknown): void {
  let keyCount = 0;
  let stringUnits = 0;
  const visiting = new Set<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new RangeError('L13 input exceeds the maximum depth');
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_STRING_LENGTH) throw new RangeError('L13 input contains an oversized string');
      stringUnits += candidate.length;
      if (stringUnits > MAX_TOTAL_STRING_UNITS) throw new RangeError('L13 input exceeds the aggregate string bound');
      if (SENSITIVE_VALUE.test(candidate)) throw new TypeError('L13 input forbids secret-shaped string values');
      return;
    }
    if (candidate === null || ['number', 'boolean'].includes(typeof candidate)) return;
    if (typeof candidate !== 'object') throw new TypeError('L13 input must contain plain serializable data only');
    if (visiting.has(candidate)) throw new TypeError('L13 input must not contain cycles');
    visiting.add(candidate);
    if (Object.getOwnPropertySymbols(candidate).length !== 0) {
      throw new TypeError('L13 input must not contain symbol fields');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const names = Object.keys(descriptors).filter((name) => !Array.isArray(candidate) || name !== 'length');
    keyCount += names.length;
    if (keyCount > MAX_KEYS) throw new RangeError('L13 input exceeds the maximum field count');
    const prototype = Object.getPrototypeOf(candidate);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || candidate.length > MAX_ARRAY) {
        throw new TypeError('L13 arrays must be bounded ordinary arrays');
      }
      for (let index = 0; index < candidate.length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new TypeError('L13 arrays must not be sparse');
      }
      if (names.some((name) => !/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= candidate.length)) {
        throw new TypeError('L13 arrays must not contain non-index properties');
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('L13 records must be plain objects');
    }
    for (const name of names) {
      if (name.length > MAX_TEXT) throw new RangeError('L13 input contains an oversized property name');
      stringUnits += name.length;
      if (stringUnits > MAX_TOTAL_STRING_UNITS) throw new RangeError('L13 input exceeds the aggregate string bound');
      const normalizedName = name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      if (SENSITIVE_FIELD_NAMES.has(normalizedName)) throw new TypeError(`L13 input forbids sensitive field ${name}`);
      const descriptor = descriptors[name];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError('L13 input forbids accessors and hidden fields');
      }
      visit(descriptor.value, depth + 1);
    }
    visiting.delete(candidate);
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
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw new TypeError(`${name} must use its exact closed schema`);
  }
}

function text(value: unknown, name: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function nullableText(value: unknown, name: string, maximum = MAX_TEXT): string | null {
  return value === null ? null : text(value, name, maximum);
}

function revision(value: unknown, name: string): string {
  return text(value, name, 256);
}

function nullableRevision(value: unknown, name: string): string | null {
  return value === null ? null : revision(value, name);
}

function digest(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be a SHA-256 digest`);
  return value;
}

function nullableDigest(value: unknown, name: string): string | null {
  return value === null ? null : digest(value, name);
}

function time(value: unknown, name: string, assembledAtMs: number): number {
  if (!isValidUtcMillis(value) || (value as number) > assembledAtMs) {
    throw new TypeError(`${name} must be valid UTC milliseconds no later than assembledAtMs`);
  }
  return value as number;
}

function nullableTime(value: unknown, name: string, assembledAtMs: number): number | null {
  return value === null ? null : time(value, name, assembledAtMs);
}

function nullableCount(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be null or a non-negative safe integer`);
  }
  return value as number;
}

function count(value: unknown, name: string): number {
  const checked = nullableCount(value, name);
  if (checked === null) throw new TypeError(`${name} must be a non-negative safe integer`);
  return checked;
}

function nullableRate(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${name} must be null or a bounded non-negative rate`);
  }
  return value;
}

function nullableSignedSafeInteger(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be null or a safe integer`);
  return value as number;
}

function nullableUtcMillis(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (!isValidUtcMillis(value)) throw new TypeError(`${name} must be null or valid UTC milliseconds`);
  return value as number;
}

function reasonCodes(value: unknown, name: string, required = false): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_CODES || (required && value.length === 0)) {
    throw new TypeError(`${name} must be a bounded${required ? ' non-empty' : ''} reason-code array`);
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || !CODE.test(entry)) {
      throw new TypeError(`${name}[${index}] must be a canonical reason code`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) throw new TypeError(`${name} must not contain duplicates`);
  return result;
}

function opaqueStringList(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_CODES) throw new TypeError(`${name} must be a bounded array`);
  const result = value.map((entry, index) => text(entry, `${name}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${name} must not contain duplicates`);
  return result;
}

function validateSubject(subject: Readonly<L12SubjectBinding>, name: string): void {
  exactKeys(subject, [
    'strategy', 'proposalId', 'assessmentId', 'mandateId', 'reservationId', 'approvalId',
    'planOrLifecycleId', 'correlationId', 'accountRealmId', 'symbol',
  ], name);
  if (!['NORMAL_BASIS', 'REVERSE_BASIS', 'VOLUME'].includes(subject.strategy)) {
    throw new TypeError(`${name}.strategy is invalid`);
  }
  text(subject.proposalId, `${name}.proposalId`);
  nullableText(subject.assessmentId, `${name}.assessmentId`);
  text(subject.mandateId, `${name}.mandateId`);
  text(subject.reservationId, `${name}.reservationId`);
  nullableText(subject.approvalId, `${name}.approvalId`);
  text(subject.planOrLifecycleId, `${name}.planOrLifecycleId`);
  text(subject.correlationId, `${name}.correlationId`);
  text(subject.accountRealmId, `${name}.accountRealmId`);
  text(subject.symbol, `${name}.symbol`, 64);
}

function validateL12Binding(binding: Readonly<L12SnapshotBindingCopy>): void {
  exactKeys(binding, [
    'sourceSchema', 'sourceVersion', 'sourceSnapshotRevision', 'projectionStatus',
    'projectionAuthority', 'truthClass', 'subject', 'canonicalTruth', 'componentEvidence', 'recovery',
  ], 'l12Binding');
  if (binding.sourceSchema !== EXPOSURE_RECOVERY_SNAPSHOT_SCHEMA || binding.sourceVersion !== 1
      || !['BLOCKED', 'RECOVERY_REQUIRED', 'COMPLETE_FOR_OWNER_REVIEW'].includes(binding.projectionStatus)
      || binding.projectionAuthority !== 'OWNER_EVIDENCE_ADAPTER_ONLY'
      || binding.truthClass !== 'SYNTHETIC_ONLY') {
    throw new TypeError('l12Binding must identify one accepted L12 owner-evidence snapshot');
  }
  revision(binding.sourceSnapshotRevision, 'l12Binding.sourceSnapshotRevision');
  validateSubject(binding.subject, 'l12Binding.subject');

  const truth = binding.canonicalTruth;
  exactKeys(truth, [
    'owner', 'subject', 'accountingScopeId', 'mutationId', 'exposureTruthRevision',
    'capitalPositionRevision', 'accountCapacityRevision', 'reservationRevision',
    'reservationSettlementRevision', 'executionRevision', 'outstandingRevision',
    'reconciliationRevision', 'recoveryRevision',
  ], 'l12Binding.canonicalTruth');
  if (truth.owner !== 'CAPITAL_FOUNDATION') throw new TypeError('l12Binding canonical truth owner is invalid');
  validateSubject(truth.subject, 'l12Binding.canonicalTruth.subject');
  if (canonicalJson(truth.subject) !== canonicalJson(binding.subject)) {
    throw new TypeError('l12Binding canonical truth is bound to a different subject');
  }
  for (const [name, value] of Object.entries(truth)) {
    if (name !== 'owner' && name !== 'subject') revision(value, `l12Binding.canonicalTruth.${name}`);
  }

  const component = binding.componentEvidence;
  exactKeys(component, ['capitalExposed', 'operatorAttentionRequired', 'ownerRevision', 'reasonCodes'], 'l12Binding.componentEvidence');
  if (typeof component.capitalExposed !== 'boolean' || typeof component.operatorAttentionRequired !== 'boolean') {
    throw new TypeError('l12Binding component evidence booleans are invalid');
  }
  revision(component.ownerRevision, 'l12Binding.componentEvidence.ownerRevision');
  opaqueStringList(component.reasonCodes, 'l12Binding.componentEvidence.reasonCodes');

  const recovery = binding.recovery;
  exactKeys(recovery, [
    'required', 'ownerEndState', 'residualExposure', 'residualLiability', 'ownerRevision', 'reasonCodes',
  ], 'l12Binding.recovery');
  if (typeof recovery.required !== 'boolean'
      || (recovery.ownerEndState !== null
        && !['OPEN', 'CLOSED', 'RECOVERED', 'MANUAL_INTERVENTION'].includes(recovery.ownerEndState))) {
    throw new TypeError('l12Binding recovery state is invalid');
  }
  nullableText(recovery.residualExposure, 'l12Binding.recovery.residualExposure', 128);
  nullableText(recovery.residualLiability, 'l12Binding.recovery.residualLiability', 128);
  revision(recovery.ownerRevision, 'l12Binding.recovery.ownerRevision');
  opaqueStringList(recovery.reasonCodes, 'l12Binding.recovery.reasonCodes');
}

function deriveL12Binding(
  source: Readonly<L12SupervisorSnapshot>,
): Readonly<L12SnapshotBindingCopy> {
  const validated = validateExposureRecoverySnapshot(source);
  const binding: L12SnapshotBindingCopy = {
    sourceSchema: validated.schema,
    sourceVersion: validated.version,
    sourceSnapshotRevision: validated.snapshotRevision,
    projectionStatus: validated.projectionStatus,
    projectionAuthority: validated.projectionAuthority,
    truthClass: validated.truthClass,
    subject: validated.subject,
    canonicalTruth: validated.canonicalTruth,
    componentEvidence: validated.componentEvidence,
    recovery: {
      required: validated.recovery.required,
      ownerEndState: validated.recovery.ownerEndState,
      residualExposure: validated.recovery.residualExposure,
      residualLiability: validated.recovery.residualLiability,
      ownerRevision: validated.recovery.ownerRevision,
      reasonCodes: validated.recovery.reasonCodes,
    },
  };
  validateL12Binding(binding);
  return cloneFreeze(binding);
}

function validateCounterWindow(
  value: Readonly<CounterWindowEvidence>,
  name: string,
  assembledAtMs: number,
): void {
  exactKeys(value, [
    'logicalWriterId', 'continuity', 'aggregationTemporality', 'startAtMs', 'endAtMs',
    'startCount', 'endCount',
  ], name);
  text(value.logicalWriterId, `${name}.logicalWriterId`);
  if (!['CONTIGUOUS', 'RESET', 'GAP', 'UNKNOWN'].includes(value.continuity)) {
    throw new TypeError(`${name}.continuity is invalid`);
  }
  if (!['DELTA', 'CUMULATIVE', 'UNKNOWN'].includes(value.aggregationTemporality)) {
    throw new TypeError(`${name}.aggregationTemporality is invalid`);
  }
  const start = time(value.startAtMs, `${name}.startAtMs`, assembledAtMs);
  const end = time(value.endAtMs, `${name}.endAtMs`, assembledAtMs);
  const startCount = count(value.startCount, `${name}.startCount`);
  const endCount = count(value.endCount, `${name}.endCount`);
  if (end <= start) throw new TypeError(`${name} must have a positive sample window`);
  if (value.continuity === 'CONTIGUOUS'
      && value.aggregationTemporality === 'CUMULATIVE' && endCount < startCount) {
    throw new TypeError(`${name} contiguous counter evidence cannot decrease`);
  }
}

function validateRateDiagnostic(
  value: NonNullable<MachineGraphRateEvidence['diagnostic']>,
  name: string,
  observedAtMs: number,
): void {
  exactKeys(value, [
    'state', 'perSecond', 'deltaCount', 'windowMs', 'startAtMs', 'endAtMs',
    'ageMs', 'maxAgeMs',
  ], name);
  if (!(RATE_STATES as readonly string[]).includes(value.state)) {
    throw new TypeError(`${name}.state is not a canonical Foundation RateDiagnostic state`);
  }
  const perSecond = nullableRate(value.perSecond, `${name}.perSecond`);
  const deltaCount = nullableCount(value.deltaCount, `${name}.deltaCount`);
  const windowMs = nullableSignedSafeInteger(value.windowMs, `${name}.windowMs`);
  const startAtMs = nullableUtcMillis(value.startAtMs, `${name}.startAtMs`);
  const endAtMs = nullableUtcMillis(value.endAtMs, `${name}.endAtMs`);
  const ageMs = nullableSignedSafeInteger(value.ageMs, `${name}.ageMs`);
  if (count(value.maxAgeMs, `${name}.maxAgeMs`) === 0) {
    throw new TypeError(`${name}.maxAgeMs must preserve a positive Foundation policy bound`);
  }

  const completeWindow = windowMs !== null && startAtMs !== null && endAtMs !== null && ageMs !== null;
  if (value.state === 'UNKNOWN') {
    if ([perSecond, deltaCount, windowMs, startAtMs, endAtMs, ageMs].some((fact) => fact !== null)) {
      throw new TypeError(`${name} UNKNOWN evidence must preserve canonical null rate facts`);
    }
    return;
  }
  if (!completeWindow) throw new TypeError(`${name} non-UNKNOWN evidence requires its canonical window facts`);
  if (windowMs !== (endAtMs as number) - (startAtMs as number)) {
    throw new TypeError(`${name}.windowMs must equal endAtMs minus startAtMs`);
  }
  if (ageMs !== observedAtMs - (endAtMs as number)) {
    throw new TypeError(`${name}.ageMs must equal observedAtMs minus endAtMs`);
  }
  if (value.state === 'KNOWN') {
    if (perSecond === null || deltaCount === null || (windowMs as number) <= 0) {
      throw new TypeError(`${name} KNOWN evidence requires a rate, delta, and positive window`);
    }
    if (perSecond !== (deltaCount * 1_000) / (windowMs as number)) {
      throw new TypeError(`${name}.perSecond must match the canonical Foundation rate formula`);
    }
    if ((ageMs as number) > value.maxAgeMs) {
      throw new TypeError(`${name} KNOWN evidence cannot exceed maxAgeMs`);
    }
    return;
  }
  if (perSecond !== null) throw new TypeError(`${name} non-KNOWN evidence cannot claim a rate`);
  if (value.state === 'STALE') {
    if (deltaCount === null || (windowMs as number) <= 0) {
      throw new TypeError(`${name} STALE evidence requires a delta and positive window`);
    }
    if ((ageMs as number) <= value.maxAgeMs) {
      throw new TypeError(`${name} STALE evidence must exceed maxAgeMs`);
    }
  } else if (value.state === 'INVALID_WINDOW') {
    if (deltaCount !== null || (windowMs as number) > 0) {
      throw new TypeError(`${name} INVALID_WINDOW evidence must preserve its non-positive window`);
    }
  } else if (deltaCount !== null || (windowMs as number) <= 0) {
    throw new TypeError(`${name} ${value.state} evidence requires a positive window and null delta`);
  }
  if (value.state === 'CLOCK_SKEWED' && (ageMs as number) >= 0) {
    throw new TypeError(`${name} CLOCK_SKEWED evidence requires negative ageMs`);
  }
}

function validateRateEvidence(
  value: Readonly<MachineGraphRateEvidence>,
  name: string,
  assembledAtMs: number,
): void {
  exactKeys(value, [
    'diagnostic', 'logicalWriterId', 'aggregationTemporality', 'authority',
    'ownerRevision', 'ownerDigest', 'observedAtMs', 'reasonCodes',
  ], name);
  const logicalWriterId = nullableText(value.logicalWriterId, `${name}.logicalWriterId`);
  if (!['DELTA', 'CUMULATIVE', 'UNKNOWN', 'UNAVAILABLE'].includes(value.aggregationTemporality)
      || !['FOUNDATION_OBSERVABILITY', 'OWNER_INJECTED', 'UNAVAILABLE'].includes(value.authority)) {
    throw new TypeError(`${name} temporality or authority is invalid`);
  }
  const ownerRevision = nullableRevision(value.ownerRevision, `${name}.ownerRevision`);
  const ownerDigest = nullableDigest(value.ownerDigest, `${name}.ownerDigest`);
  const observedAtMs = nullableTime(value.observedAtMs, `${name}.observedAtMs`, assembledAtMs);
  reasonCodes(value.reasonCodes, `${name}.reasonCodes`, value.diagnostic === null || value.diagnostic.state !== 'KNOWN');

  if (value.diagnostic === null) {
    if (logicalWriterId !== null || value.aggregationTemporality !== 'UNAVAILABLE'
        || value.authority !== 'UNAVAILABLE' || ownerRevision !== null
        || ownerDigest !== null || observedAtMs !== null) {
      throw new TypeError(`${name} unavailable rate evidence must contain only explicit null facts`);
    }
    return;
  }

  if (value.authority === 'UNAVAILABLE' || value.aggregationTemporality === 'UNAVAILABLE'
      || ownerRevision === null || ownerDigest === null || observedAtMs === null) {
    throw new TypeError(`${name} rate evidence requires authority, temporality, revision, digest, and time`);
  }
  validateRateDiagnostic(value.diagnostic, `${name}.diagnostic`, observedAtMs);
  if (value.diagnostic.state === 'UNKNOWN') {
    if (logicalWriterId !== null || value.aggregationTemporality !== 'UNKNOWN') {
      throw new TypeError(`${name} UNKNOWN rate evidence cannot invent a writer or counter temporality`);
    }
  } else if (logicalWriterId === null) {
    throw new TypeError(`${name} windowed rate evidence requires one logical writer`);
  }
  if (value.authority === 'FOUNDATION_OBSERVABILITY'
      && value.diagnostic.state !== 'UNKNOWN'
      && value.aggregationTemporality !== 'CUMULATIVE') {
    throw new TypeError(`${name} Foundation rate evidence must preserve cumulative-counter temporality`);
  }
}

function validateControlState(
  value: Readonly<MachineGraphControlStateEvidence>,
  name: string,
  assembledAtMs: number,
): void {
  exactKeys(value, [
    'desiredState', 'phase', 'generation', 'authority',
    'ownerRevision', 'ownerDigest', 'observedAtMs', 'reasonCodes',
  ], name);
  if ((!(DESIRED_RUNTIME_STATES as readonly string[]).includes(value.desiredState)
        && !['UNKNOWN', 'UNAVAILABLE'].includes(value.desiredState))
      || (!(RUNTIME_PHASES as readonly string[]).includes(value.phase)
        && !['UNKNOWN', 'UNAVAILABLE'].includes(value.phase))
      || !['FOUNDATION_CONTROL', 'UNAVAILABLE'].includes(value.authority)) {
    throw new TypeError(`${name} contains an invalid canonical Foundation control state`);
  }
  const generation = nullableCount(value.generation, `${name}.generation`);
  const ownerRevision = nullableRevision(value.ownerRevision, `${name}.ownerRevision`);
  const ownerDigest = nullableDigest(value.ownerDigest, `${name}.ownerDigest`);
  const observedAtMs = nullableTime(value.observedAtMs, `${name}.observedAtMs`, assembledAtMs);
  reasonCodes(value.reasonCodes, `${name}.reasonCodes`, value.authority === 'UNAVAILABLE');
  if (value.authority === 'UNAVAILABLE') {
    if (!['UNKNOWN', 'UNAVAILABLE'].includes(value.desiredState)
        || !['UNKNOWN', 'UNAVAILABLE'].includes(value.phase)
        || generation !== null || ownerRevision !== null
        || ownerDigest !== null || observedAtMs !== null) {
      throw new TypeError(`${name} unavailable control evidence must preserve null generation and unknown states`);
    }
  } else if (['UNKNOWN', 'UNAVAILABLE'].includes(value.desiredState)
      || ['UNKNOWN', 'UNAVAILABLE'].includes(value.phase)
      || ownerRevision === null || ownerDigest === null || observedAtMs === null) {
    throw new TypeError(`${name} Foundation control evidence requires canonical states and owner provenance`);
  }
}

function validateControl(value: Readonly<MachineGraphControlEvidence>, index: number, name: string): void {
  exactKeys(value, [
    'action', 'implementationState', 'integrationState', 'availability', 'ownerRevision',
    'controlReference', 'reasonCodes',
  ], name);
  if (value.action !== MACHINE_GRAPH_CONTROL_ACTIONS[index]) {
    throw new TypeError(`${name}.action is missing, duplicated, or out of order`);
  }
  if (!['PROVEN_CONTROL_PLANE_RUNTIME_ONLY', 'CONTRACT_ONLY', 'UNKNOWN'].includes(value.implementationState)
      || !['UNWIRED', 'OWNER_GATED', 'MISSING', 'UNKNOWN'].includes(value.integrationState)
      || value.availability !== 'UNAVAILABLE' || value.controlReference !== null) {
    throw new TypeError(`${name} must remain unavailable and non-dispatching`);
  }
  const runtimeOnly = RUNTIME_ONLY_ACTIONS.has(value.action);
  if ((runtimeOnly && value.implementationState !== 'PROVEN_CONTROL_PLANE_RUNTIME_ONLY')
      || (!runtimeOnly && value.implementationState === 'PROVEN_CONTROL_PLANE_RUNTIME_ONLY')) {
    throw new TypeError(`${name} must preserve exactly the narrow Foundation runtime mapping`);
  }
  const ownerRevision = nullableRevision(value.ownerRevision, `${name}.ownerRevision`);
  if (runtimeOnly && ownerRevision === null) {
    throw new TypeError(`${name} proven runtime mapping requires an owner revision`);
  }
  reasonCodes(value.reasonCodes, `${name}.reasonCodes`, true);
}

function validateRole(
  value: Readonly<MachineGraphRoleEvidence>,
  index: number,
  assembledAtMs: number,
): void {
  const name = `roles[${index}]`;
  exactKeys(value, [
    'role', 'owner', 'ownerPath', 'ownerRevision', 'evidenceState', 'controlState', 'observedState',
    'heartbeatAtMs', 'exchangeEventAgeMs', 'localReceiveAgeMs', 'localProcessingAgeMs',
    'inputRate', 'outputRate', 'queueDepth', 'droppedCount', 'backpressure',
    'sourceType', 'completeness', 'versions', 'lastMeaningfulAdvanceAtMs', 'blockerCode',
    'rootCauseReference', 'lastError', 'supportedControls', 'trace', 'capitalExposed',
    'operatorAttentionRequired',
  ], name);
  if (value.role !== MACHINE_GRAPH_ROLES[index]) throw new TypeError(`${name}.role is missing, duplicated, or out of order`);
  text(value.owner, `${name}.owner`);
  nullableText(value.ownerPath, `${name}.ownerPath`, 512);
  const ownerRevision = nullableRevision(value.ownerRevision, `${name}.ownerRevision`);
  if (!['CURRENT', 'STALE', 'PARTIAL', 'SYNTHETIC_ONLY', 'UNKNOWN', 'UNAVAILABLE'].includes(value.evidenceState)) {
    throw new TypeError(`${name} owner state is invalid`);
  }
  validateControlState(value.controlState, `${name}.controlState`, assembledAtMs);
  nullableText(value.observedState, `${name}.observedState`);
  nullableTime(value.heartbeatAtMs, `${name}.heartbeatAtMs`, assembledAtMs);
  nullableCount(value.exchangeEventAgeMs, `${name}.exchangeEventAgeMs`);
  nullableCount(value.localReceiveAgeMs, `${name}.localReceiveAgeMs`);
  nullableCount(value.localProcessingAgeMs, `${name}.localProcessingAgeMs`);
  validateRateEvidence(value.inputRate, `${name}.inputRate`, assembledAtMs);
  validateRateEvidence(value.outputRate, `${name}.outputRate`, assembledAtMs);
  nullableCount(value.queueDepth, `${name}.queueDepth`);
  nullableCount(value.droppedCount, `${name}.droppedCount`);
  if (!['CLEAR', 'ACTIVE', 'UNKNOWN', 'UNAVAILABLE'].includes(value.backpressure)
      || !['LIVE_PUBLIC', 'LIVE_PRIVATE', 'DERIVED', 'RECORDED_REPLAY', 'SYNTHETIC_TEST', 'INFRASTRUCTURE', 'UNKNOWN', 'UNAVAILABLE'].includes(value.sourceType)
      || !['COMPLETE', 'PARTIAL', 'MISSING', 'UNKNOWN', 'UNAVAILABLE'].includes(value.completeness)) {
    throw new TypeError(`${name} source, completeness, or backpressure state is invalid`);
  }
  if (['CURRENT', 'STALE', 'PARTIAL', 'SYNTHETIC_ONLY'].includes(value.evidenceState)
      && (ownerRevision === null
        || ['UNKNOWN', 'UNAVAILABLE'].includes(value.sourceType)
        || ['UNKNOWN', 'UNAVAILABLE'].includes(value.completeness))) {
    throw new TypeError(`${name} non-missing evidence requires an owner revision, source, and completeness`);
  }
  if (value.evidenceState === 'SYNTHETIC_ONLY'
      && value.sourceType !== 'SYNTHETIC_TEST' && value.sourceType !== 'RECORDED_REPLAY') {
    throw new TypeError(`${name} synthetic evidence cannot claim a live source`);
  }
  if (value.evidenceState === 'CURRENT'
      && (value.sourceType === 'UNKNOWN' || value.sourceType === 'UNAVAILABLE'
        || value.completeness === 'MISSING'
        || value.completeness === 'UNKNOWN' || value.completeness === 'UNAVAILABLE')) {
    throw new TypeError(`${name} CURRENT evidence cannot be empty or unknown`);
  }
  exactKeys(value.versions, ['modelVersion', 'configVersion', 'schemaVersion', 'deployedRevision'], `${name}.versions`);
  nullableRevision(value.versions.modelVersion, `${name}.versions.modelVersion`);
  nullableRevision(value.versions.configVersion, `${name}.versions.configVersion`);
  nullableRevision(value.versions.schemaVersion, `${name}.versions.schemaVersion`);
  nullableRevision(value.versions.deployedRevision, `${name}.versions.deployedRevision`);
  nullableTime(value.lastMeaningfulAdvanceAtMs, `${name}.lastMeaningfulAdvanceAtMs`, assembledAtMs);
  if (value.blockerCode !== null && !CODE.test(value.blockerCode)) throw new TypeError(`${name}.blockerCode is invalid`);
  nullableText(value.rootCauseReference, `${name}.rootCauseReference`);
  if (value.lastError !== null) {
    exactKeys(value.lastError, ['code', 'ownerRevision', 'observedAtMs'], `${name}.lastError`);
    if (!CODE.test(value.lastError.code)) throw new TypeError(`${name}.lastError.code is invalid`);
    revision(value.lastError.ownerRevision, `${name}.lastError.ownerRevision`);
    time(value.lastError.observedAtMs, `${name}.lastError.observedAtMs`, assembledAtMs);
  }
  if (!Array.isArray(value.supportedControls) || value.supportedControls.length > MACHINE_GRAPH_CONTROL_ACTIONS.length) {
    throw new TypeError(`${name}.supportedControls must be a bounded action subset`);
  }
  const supported = value.supportedControls.map((action, actionIndex) => {
    const canonicalIndex = MACHINE_GRAPH_CONTROL_ACTIONS.indexOf(action);
    if (canonicalIndex < 0) throw new TypeError(`${name}.supportedControls[${actionIndex}] is not an L14 action`);
    return canonicalIndex;
  });
  if (new Set(supported).size !== supported.length
      || supported.some((canonicalIndex, actionIndex) => actionIndex > 0 && canonicalIndex <= supported[actionIndex - 1]!)) {
    throw new TypeError(`${name}.supportedControls must be duplicate-free and canonically ordered`);
  }
  if (value.trace !== null) {
    exactKeys(value.trace, ['correlationId', 'traceRevision'], `${name}.trace`);
    text(value.trace.correlationId, `${name}.trace.correlationId`);
    revision(value.trace.traceRevision, `${name}.trace.traceRevision`);
  }
  if ((value.capitalExposed !== null && typeof value.capitalExposed !== 'boolean')
      || (value.operatorAttentionRequired !== null && typeof value.operatorAttentionRequired !== 'boolean')) {
    throw new TypeError(`${name} attention evidence must be boolean or null`);
  }
  if (value.role !== 'EXPOSURE_POSITION_SUPERVISOR'
      && (value.capitalExposed !== null || value.operatorAttentionRequired !== null)) {
    throw new TypeError(`${name} cannot duplicate L12 Capital exposure or attention truth`);
  }

  if (value.evidenceState === 'UNAVAILABLE') {
    const unavailableFacts = [
      value.observedState, value.heartbeatAtMs,
      value.exchangeEventAgeMs, value.localReceiveAgeMs, value.localProcessingAgeMs,
      value.queueDepth, value.droppedCount,
      value.lastMeaningfulAdvanceAtMs, value.capitalExposed, value.operatorAttentionRequired,
    ];
    if (unavailableFacts.some((fact) => fact !== null)
        || value.inputRate.diagnostic !== null
        || value.outputRate.diagnostic !== null
        || value.controlState.authority !== 'UNAVAILABLE'
        || value.supportedControls.length !== 0
        || !['UNKNOWN', 'UNAVAILABLE'].includes(value.backpressure)
        || !['UNKNOWN', 'UNAVAILABLE'].includes(value.sourceType)
        || !['UNKNOWN', 'UNAVAILABLE'].includes(value.completeness)) {
      throw new TypeError(`${name} unavailable evidence must not fabricate runtime, rate, or exposure facts`);
    }
  }
}

function validateRoleBindings(input: Readonly<MachineGraphEvidenceInput>): void {
  if (!Array.isArray(input.roleBindings) || input.roleBindings.length !== MACHINE_GRAPH_ROLES.length) {
    throw new TypeError('roleBindings must declare every §22 role as BOUND, OWNER_GATED, or MISSING');
  }
  const boundIds: string[] = [];
  input.roleBindings.forEach((entry, index) => {
    const name = `roleBindings[${index}]`;
    exactKeys(entry, ['role', 'bindingState', 'componentIds', 'bindingRevision', 'authority'], name);
    if (entry.role !== MACHINE_GRAPH_ROLES[index]
        || !['BOUND', 'OWNER_GATED', 'MISSING'].includes(entry.bindingState)
        || entry.authority !== 'INJECTED_SYSTEM_INTEGRATION_CONTRACT_BINDING'
        || !Array.isArray(entry.componentIds)
        || entry.componentIds.length > CANONICAL_SYSTEM_COMPONENT_IDS.length) {
      throw new TypeError(`${name} is invalid or out of order`);
    }
    for (const componentId of entry.componentIds) {
      if (!(CANONICAL_SYSTEM_COMPONENT_IDS as readonly string[]).includes(componentId)) {
        throw new TypeError(`${name} invents a non-canonical component ID`);
      }
      boundIds.push(componentId);
    }
    if (entry.bindingState === 'BOUND') {
      if (entry.componentIds.length === 0 || entry.bindingRevision === null) {
        throw new TypeError(`${name} BOUND evidence requires canonical IDs and a revision`);
      }
      revision(entry.bindingRevision, `${name}.bindingRevision`);
    } else if (entry.componentIds.length !== 0 || entry.bindingRevision !== null) {
      throw new TypeError(`${name} non-bound evidence cannot smuggle a component mapping`);
    }
  });
  if (new Set(boundIds).size !== boundIds.length) {
    throw new TypeError('roleBindings must not bind one canonical component ID more than once');
  }
}

function validateMetricValue(metric: MachineGraphMetric, unit: MachineGraphMetricUnit, value: string | number): void {
  if (unit === 'REVISION' || unit === 'VERSION' || unit === 'STATUS') {
    text(value, `${metric}.value`);
    if (metric === 'DEPLOYED_REVISION'
        && (typeof value !== 'string' || !DEPLOYED_SHA.test(value))) {
      throw new TypeError(`${metric}.value must be a lowercase 40- or 64-hex deployed SHA`);
    }
    if (unit === 'STATUS'
        && (typeof value !== 'string' || !['HEALTHY', 'DEGRADED', 'FAILED'].includes(value))) {
      throw new TypeError(`${metric}.value must be a closed owner health status`);
    }
    return;
  }
  if (unit === 'EXACT_DECIMAL') {
    if (typeof value !== 'string' || value.length > 128 || !EXACT_DECIMAL.test(value)) {
      throw new TypeError(`${metric}.value must be a canonical non-negative exact decimal`);
    }
    return;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${metric}.value must be a safe integer for ${unit}`);
  }
  if (metric !== 'SERVER_TIME_OFFSET_MS' && value < 0) {
    throw new TypeError(`${metric}.value must be non-negative`);
  }
  if (unit === 'PARTS_PER_MILLION' && (value < 0 || value > 1_000_000)) {
    throw new TypeError(`${metric}.value must be between 0 and 1000000 ppm`);
  }
}

function validateMetric(value: Readonly<MachineGraphMetricEvidence>, index: number, assembledAtMs: number): void {
  const name = `metrics[${index}]`;
  exactKeys(value, [
    'metric', 'unit', 'status', 'value', 'owner', 'ownerRevision', 'ownerDigest',
    'observedAtMs', 'window', 'labels', 'reasonCodes',
  ], name);
  if (value.metric !== MACHINE_GRAPH_METRICS[index]
      || value.unit !== MACHINE_GRAPH_METRIC_UNITS[value.metric]
      || !['OBSERVED', 'STALE', 'UNKNOWN', 'UNAVAILABLE'].includes(value.status)) {
    throw new TypeError(`${name} identity, unit, or status is invalid`);
  }
  text(value.owner, `${name}.owner`);
  nullableRevision(value.ownerRevision, `${name}.ownerRevision`);
  nullableDigest(value.ownerDigest, `${name}.ownerDigest`);
  const observedAtMs = nullableTime(value.observedAtMs, `${name}.observedAtMs`, assembledAtMs);
  if (value.window !== null) validateCounterWindow(value.window, `${name}.window`, assembledAtMs);
  if (!Array.isArray(value.labels) || value.labels.length !== 0 || Object.keys(value.labels).length !== 0) {
    throw new TypeError(`${name}.labels must be the closed empty low-cardinality set`);
  }
  const absent = value.status === 'UNKNOWN' || value.status === 'UNAVAILABLE';
  const instrument = MACHINE_GRAPH_METRIC_INSTRUMENTS[value.metric];
  reasonCodes(value.reasonCodes, `${name}.reasonCodes`, absent || value.status === 'STALE');
  if (absent) {
    if (value.value !== null) throw new TypeError(`${name} missing evidence must not fabricate a zero or status`);
  } else {
    if (value.value === null || value.ownerRevision === null || value.ownerDigest === null || value.observedAtMs === null) {
      throw new TypeError(`${name} observed evidence requires value, revision, digest, and time`);
    }
    validateMetricValue(value.metric, value.unit, value.value);
  }
  if (value.status === 'UNAVAILABLE'
      && (value.window !== null || value.ownerRevision !== null || value.ownerDigest !== null
        || value.observedAtMs !== null)) {
    throw new TypeError(`${name} unavailable metric evidence must contain only explicit null owner facts`);
  }
  if (value.window !== null && instrument !== 'COUNTER') {
    throw new TypeError(`${name} non-counter metric evidence cannot claim a counter window`);
  }
  if (['OBSERVED', 'STALE'].includes(value.status)
      && instrument === 'COUNTER' && value.window === null) {
    throw new TypeError(`${name} observed or stale counter evidence requires a counter window`);
  }
  if (value.window !== null
      && (value.ownerRevision === null || value.ownerDigest === null || value.observedAtMs === null)) {
    throw new TypeError(`${name} window evidence requires owner revision, digest, and time`);
  }
  if (value.window !== null && observedAtMs !== null && value.window.endAtMs > observedAtMs) {
    throw new TypeError(`${name}.window cannot end after its observation time`);
  }
}

function validateAlarm(value: Readonly<MachineGraphAlarmEvidence>, index: number, assembledAtMs: number): void {
  const name = `alarms[${index}]`;
  exactKeys(value, [
    'alarm', 'state', 'owner', 'ownerRevision', 'ownerDigest', 'observedAtMs',
    'automaticAction', 'canLiquidate', 'canMutateCapital', 'haltRecommendation', 'trace', 'reasonCodes',
  ], name);
  if (value.alarm !== MACHINE_GRAPH_ALARMS[index]
      || !['OK', 'ALARM', 'INSUFFICIENT_DATA', 'UNKNOWN', 'UNAVAILABLE'].includes(value.state)
      || value.automaticAction !== 'NONE' || value.canLiquidate !== false
      || value.canMutateCapital !== false || typeof value.haltRecommendation !== 'boolean') {
    throw new TypeError(`${name} identity, state, or non-action boundary is invalid`);
  }
  text(value.owner, `${name}.owner`);
  nullableRevision(value.ownerRevision, `${name}.ownerRevision`);
  nullableDigest(value.ownerDigest, `${name}.ownerDigest`);
  nullableTime(value.observedAtMs, `${name}.observedAtMs`, assembledAtMs);
  if (value.trace !== null) {
    exactKeys(value.trace, ['correlationId', 'traceRevision'], `${name}.trace`);
    text(value.trace.correlationId, `${name}.trace.correlationId`);
    revision(value.trace.traceRevision, `${name}.trace.traceRevision`);
  }
  const incomplete = ['ALARM', 'INSUFFICIENT_DATA', 'UNKNOWN', 'UNAVAILABLE'].includes(value.state);
  reasonCodes(value.reasonCodes, `${name}.reasonCodes`, incomplete);
  if (['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(value.state)
      && (value.ownerRevision === null || value.ownerDigest === null || value.observedAtMs === null)) {
    throw new TypeError(`${name} evaluated alarm state requires owner revision, digest, and time`);
  }
  if (value.haltRecommendation && value.state !== 'ALARM') {
    throw new TypeError(`${name} can recommend HALT only for an injected ALARM state`);
  }
}

function validateL12RoleBinding(
  input: Readonly<MachineGraphEvidenceInput>,
  binding: Readonly<L12SnapshotBindingCopy>,
): void {
  const role = input.roles[MACHINE_GRAPH_ROLES.indexOf('EXPOSURE_POSITION_SUPERVISOR')];
  if (role === undefined
      || role.ownerRevision !== binding.componentEvidence.ownerRevision
      || role.capitalExposed !== binding.componentEvidence.capitalExposed
      || role.operatorAttentionRequired !== binding.componentEvidence.operatorAttentionRequired
      || role.trace === null
      || role.trace.correlationId !== binding.subject.correlationId
      || role.trace.traceRevision !== binding.sourceSnapshotRevision
      || role.observedState !== binding.projectionStatus
      || role.versions.schemaVersion !== binding.sourceSchema) {
    throw new TypeError('EXPOSURE_POSITION_SUPERVISOR must copy the exact L12 subject and component evidence binding');
  }
  if (role.evidenceState !== 'SYNTHETIC_ONLY'
      || role.sourceType !== 'SYNTHETIC_TEST'
      || !['PARTIAL', 'COMPLETE'].includes(role.completeness)) {
    throw new TypeError('the L12-bound role must preserve its synthetic source classification');
  }
}

function validateInput(
  input: Readonly<MachineGraphEvidenceInput>,
  binding: Readonly<L12SnapshotBindingCopy>,
): void {
  exactKeys(input, ['assembledAtMs', 'l12Snapshot', 'roleBindings', 'roles', 'controls', 'metrics', 'alarms'], 'L13 input');
  if (!isValidUtcMillis(input.assembledAtMs)) throw new TypeError('assembledAtMs must be injected valid UTC milliseconds');
  validateRoleBindings(input);
  if (!Array.isArray(input.roles) || input.roles.length !== MACHINE_GRAPH_ROLES.length) {
    throw new TypeError('roles must cover every §22 role exactly once');
  }
  input.roles.forEach((role, index) => validateRole(role, index, input.assembledAtMs));
  validateL12RoleBinding(input, binding);
  if (!Array.isArray(input.controls) || input.controls.length !== MACHINE_GRAPH_CONTROL_ACTIONS.length) {
    throw new TypeError('controls must cover every L14 action exactly once');
  }
  input.controls.forEach((control, index) => validateControl(control, index, `controls[${index}]`));
  if (!Array.isArray(input.metrics) || input.metrics.length !== MACHINE_GRAPH_METRICS.length) {
    throw new TypeError('metrics must cover every §23 metric exactly once');
  }
  input.metrics.forEach((metric, index) => validateMetric(metric, index, input.assembledAtMs));
  if (!Array.isArray(input.alarms) || input.alarms.length !== MACHINE_GRAPH_ALARMS.length) {
    throw new TypeError('alarms must cover every required alarm exactly once');
  }
  input.alarms.forEach((alarm, index) => validateAlarm(alarm, index, input.assembledAtMs));
}

function deriveMachineGraphEvidenceRevision(material: unknown): string {
  assertClosedPlainData(material);
  return `l13_${stableHash128Hex(canonicalJson(material))}`;
}

export function projectMachineGraphEvidence(
  input: MachineGraphEvidenceInput,
): Readonly<MachineGraphEvidenceSnapshot> {
  assertClosedPlainData(input);
  const cloned = cloneFreeze(input) as Readonly<MachineGraphEvidenceInput>;
  const l12Binding = deriveL12Binding(cloned.l12Snapshot);
  validateInput(cloned, l12Binding);
  const material = {
    schema: MACHINE_GRAPH_EVIDENCE_SCHEMA,
    version: 1 as const,
    assembledAtMs: cloned.assembledAtMs,
    l12Binding,
    roleBindings: cloned.roleBindings,
    roles: cloned.roles,
    controls: cloned.controls,
    metrics: cloned.metrics,
    alarms: cloned.alarms,
    projectionAuthority: 'OWNER_EVIDENCE_ADAPTER_ONLY' as const,
    graphAuthority: 'SYSTEM_INTEGRATION' as const,
    observabilityAuthority: 'FOUNDATION_OBSERVABILITY' as const,
    controlAuthority: 'NONE_RECORD_ONLY' as const,
    rootCauseAuthority: 'NONE_RECORD_ONLY' as const,
    readinessAuthority: 'NONE_RECORD_ONLY' as const,
    alarmEvaluationAuthority: 'NONE_RECORD_ONLY' as const,
    externalActionAuthorization: 'NONE' as const,
    automaticActionAuthorization: 'NONE' as const,
    truthClass: 'SYNTHETIC_ONLY_UNWIRED' as const,
  };
  return cloneFreeze({
    ...material,
    snapshotRevision: deriveMachineGraphEvidenceRevision(material),
  } satisfies MachineGraphEvidenceSnapshot);
}

export function validateMachineGraphEvidenceSnapshot(
  value: Readonly<MachineGraphEvidenceSnapshot>,
  l12Snapshot: Readonly<L12SupervisorSnapshot>,
): Readonly<MachineGraphEvidenceSnapshot> {
  assertClosedPlainData(value);
  if (value.schema !== MACHINE_GRAPH_EVIDENCE_SCHEMA || value.version !== 1) {
    throw new TypeError('machine-graph evidence snapshot schema mismatch');
  }
  const reproduced = projectMachineGraphEvidence({
    assembledAtMs: value.assembledAtMs,
    l12Snapshot,
    roleBindings: value.roleBindings,
    roles: value.roles,
    controls: value.controls,
    metrics: value.metrics,
    alarms: value.alarms,
  });
  if (canonicalJson(reproduced) !== canonicalJson(value)) {
    throw new TypeError('machine-graph evidence snapshot is not reproducible');
  }
  return reproduced;
}
