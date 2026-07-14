import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../../foundation/contracts/index.js';
import {
  MACHINE_GRAPH_EVIDENCE_SCHEMA,
  validateMachineGraphEvidenceSnapshot,
} from '../machineGraphEvidence/index.js';
import {
  preflightInstrumentSizing,
  validateInstrumentRegistrySnapshot,
} from '../binanceInstrumentSpecs/index.js';
import {
  EXTERNAL_PROOF_CLASS_BY_KIND,
  EXTERNAL_PROOF_EVIDENCE_SCHEMA,
  EXTERNAL_PROOF_SUBJECTS,
  EXTERNAL_ACTION_CLASSES,
  L15_SATELLITE_EVIDENCE,
  type AbsentRuntimeEvidence,
  type ClassifiedExternalProofEvidence,
  type CurrentOwnerFilterVerdictEvidence,
  type ExternalAuthorizationGapEvidence,
  type ExternalProofEvidenceInput,
  type ExternalProofEvidenceKind,
  type ExternalProofEvidenceRecord,
  type ExternalProofEvidenceSnapshot,
  type ExternalProofLineageBinding,
  type ExternalProofSubject,
  type FilterAdmissionIdentity,
  type RepositoryPolicyBlockEvidence,
} from './types.js';

// The classifier accepts a full canonical L04 registry. Keep the generic graph
// budget aligned with L04's exact 10,000-instrument owner boundary; narrower
// L16 arrays are constrained again by their record-specific validators.
const MAX_ARRAY = 10_000;
const MAX_DEPTH = 24;
const MAX_KEYS = 5_000_000;
const MAX_STRING_LENGTH = 16_384;
const MAX_TOTAL_STRING_UNITS = 100_000_000;
const MAX_TEXT = 256;
const MAX_REASON_CODES = 64;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const GIT_COMMIT = /^[a-f0-9]{40}$/;
const FILTER_ARITHMETIC_REASON = /^(?:PRICE_(?:BELOW_MINIMUM|ABOVE_MAXIMUM|TICK_MISALIGNED|BELOW_PERCENT_BOUND|ABOVE_PERCENT_BOUND)|QUANTITY_BELOW_GRID_ORIGIN|FILTER_GRID_INTERSECTION_UNRESOLVED|RESULT_QUANTITY_ZERO|(?:LOT_SIZE|MARKET_LOT_SIZE)_(?:QUANTITY_(?:BELOW_MINIMUM|ABOVE_MAXIMUM)|GRID_MISALIGNED)|(?:MIN_NOTIONAL|NOTIONAL)_(?:BELOW_MINIMUM|ABOVE_MAXIMUM))$/;
const EXCHANGE_FILTER_REASON = /^(?:PRICE_(?:BELOW_MINIMUM|ABOVE_MAXIMUM|TICK_MISALIGNED|BELOW_PERCENT_BOUND|ABOVE_PERCENT_BOUND)|QUANTITY_BELOW_GRID_ORIGIN|FILTER_GRID_INTERSECTION_UNRESOLVED|(?:LOT_SIZE|MARKET_LOT_SIZE)_(?:QUANTITY_(?:BELOW_MINIMUM|ABOVE_MAXIMUM)|GRID_MISALIGNED)|(?:MIN_NOTIONAL|NOTIONAL)_(?:BELOW_MINIMUM|ABOVE_MAXIMUM))$/;
const SENSITIVE_FIELD_NAMES = new Set([
  'secret', 'apikey', 'apisecret', 'clientsecret', 'credential', 'credentials',
  'password', 'passphrase', 'privatekey', 'signature', 'bearer', 'bearertoken',
  'token', 'accesstoken', 'listenkey', 'sessionkey', 'accesskey',
]);
const SENSITIVE_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|(?:(?:authorization\s*[:=]\s*bearer)|(?:x-mbx-apikey|api[_ -]?key|api[_ -]?secret|client[_ -]?secret|secret[_ -]?access[_ -]?key|access[_ -]?token|listen[_ -]?key|session[_ -]?key)\s*[:=])\s*\S{12,})/i;

const SUBJECT_ALLOWED_KINDS = Object.freeze({
  LOCAL_BUILD_AND_TESTS: Object.freeze(['LOCAL_VERIFICATION']),
  SYNTHETIC_FAULT_AND_REPLAY: Object.freeze(['DETERMINISTIC_REPLAY']),
  LANE_RUNTIME_WIRING: Object.freeze(['ADAPTER_INTEGRATION_STATE']),
  L15_DEPLOYMENT_ARTIFACTS: Object.freeze(['L15_SATELLITE_ACCEPTANCE']),
  PUBLIC_RUNTIME_OBSERVATION: Object.freeze(['EXTERNAL_NON_PERFORMANCE']),
  PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH: Object.freeze(['EXTERNAL_AUTHORIZATION_GAP']),
  DEPLOYED_EC2_APPLICATION_AND_COCKPIT: Object.freeze(['ABSENT_RUNTIME_EVIDENCE']),
  CLOUDFLARE_TUNNEL_AND_ACCESS: Object.freeze(['ABSENT_RUNTIME_EVIDENCE']),
  SERVICE_RESTART_AND_DEGRADED_BEHAVIOR: Object.freeze(['EXTERNAL_AUTHORIZATION_GAP']),
  SPOT_SIGNED_TEST_ORDER: Object.freeze(['REPOSITORY_POLICY_BLOCK']),
  USD_M_SIGNED_TEST_ORDER: Object.freeze(['REPOSITORY_POLICY_BLOCK']),
  MARGIN_SIGNED_TEST_ORDER: Object.freeze(['REPOSITORY_POLICY_BLOCK']),
  MARGIN_BORROW_AND_REPAY: Object.freeze(['REPOSITORY_POLICY_BLOCK']),
  LIVE_ORDER: Object.freeze(['REPOSITORY_POLICY_BLOCK']),
  STRATEGY_LIVE_TICKET: Object.freeze(['REPOSITORY_POLICY_BLOCK']),
  I00_COMBINED_FAN_IN: Object.freeze(['I00_INTEGRATION_DEFERRAL']),
  CURRENT_FILTER_ADMISSION: Object.freeze([
    'ABSENT_RUNTIME_EVIDENCE',
    'CURRENT_OWNER_FILTER_VERDICT',
  ]),
} as const satisfies Readonly<Record<ExternalProofSubject, readonly ExternalProofEvidenceKind[]>>);

const LOCAL_CHECKS = Object.freeze([
  'SERVER_BUILD',
  'L16_FOCUSED',
  'IMPORT_PURITY',
  'ACCUMULATED_LIVE_EDGE',
  'PROTOCOL',
  'NPM_TEST',
  'TEST_ALL',
  'DIFF_CHECK',
] as const);

function assertClosedPlainData(value: unknown): void {
  let keyCount = 0;
  let stringUnits = 0;
  const visiting = new Set<object>();
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new RangeError('L16 input exceeds the maximum depth');
    if (typeof candidate === 'string') {
      if (candidate.length > MAX_STRING_LENGTH) throw new RangeError('L16 input contains an oversized string');
      stringUnits += candidate.length;
      if (stringUnits > MAX_TOTAL_STRING_UNITS) throw new RangeError('L16 input exceeds the aggregate string bound');
      if (SENSITIVE_VALUE.test(candidate)) throw new TypeError('L16 input forbids secret-shaped string values');
      return;
    }
    if (candidate === null || ['number', 'boolean'].includes(typeof candidate)) return;
    if (typeof candidate !== 'object') throw new TypeError('L16 input must contain plain serializable data only');
    if (visiting.has(candidate)) throw new TypeError('L16 input must not contain cycles');
    if (seen.has(candidate)) return;
    visiting.add(candidate);
    if (Object.getOwnPropertySymbols(candidate).length !== 0) {
      throw new TypeError('L16 input must not contain symbol fields');
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const names = Object.keys(descriptors).filter((name) => !Array.isArray(candidate) || name !== 'length');
    keyCount += names.length;
    if (keyCount > MAX_KEYS) throw new RangeError('L16 input exceeds the maximum field count');
    const prototype = Object.getPrototypeOf(candidate);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype || candidate.length > MAX_ARRAY) {
        throw new TypeError('L16 arrays must be bounded ordinary arrays');
      }
      for (let index = 0; index < candidate.length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new TypeError('L16 arrays must not be sparse');
      }
      if (names.some((name) => !/^(?:0|[1-9]\d*)$/.test(name) || Number(name) >= candidate.length)) {
        throw new TypeError('L16 arrays must not contain non-index properties');
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('L16 records must be plain objects');
    }
    for (const name of names) {
      if (name.length > MAX_TEXT) throw new RangeError('L16 input contains an oversized property name');
      stringUnits += name.length;
      if (stringUnits > MAX_TOTAL_STRING_UNITS) throw new RangeError('L16 input exceeds the aggregate string bound');
      const normalized = name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
      if (SENSITIVE_FIELD_NAMES.has(normalized)) throw new TypeError(`L16 input forbids sensitive field ${name}`);
      const descriptor = descriptors[name];
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
        throw new TypeError('L16 input forbids accessors and hidden fields');
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

function text(value: unknown, name: string, maximum = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function implementationRevision(value: unknown, name: string): string {
  if (typeof value !== 'string' || !GIT_COMMIT.test(value)) {
    throw new TypeError(`${name} must be one exact lowercase 40-hex implementation revision`);
  }
  return value;
}

function time(value: unknown, name: string, evaluatedAtMs: number): number {
  if (!isValidUtcMillis(value) || (value as number) > evaluatedAtMs) {
    throw new TypeError(`${name} must be valid UTC milliseconds no later than evaluatedAtMs`);
  }
  return value as number;
}

function positiveCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function reasonCodes(value: unknown, name: string, required = false): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REASON_CODES || (required && value.length === 0)) {
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

function validateBase(
  value: Readonly<ExternalProofEvidenceRecord>,
  expectedSubject: ExternalProofSubject,
  index: number,
): void {
  if (value.subject !== expectedSubject) {
    throw new TypeError(`evidence[${index}] must cover ${expectedSubject} exactly once and in order`);
  }
  text(value.evidenceId, `evidence[${index}].evidenceId`);
  reasonCodes(value.reasonCodes, `evidence[${index}].reasonCodes`, ![
    'LOCAL_VERIFICATION',
    'L15_SATELLITE_ACCEPTANCE',
  ].includes(value.kind));
  if (!SUBJECT_ALLOWED_KINDS[expectedSubject].includes(value.kind as never)) {
    throw new TypeError(`evidence[${index}] kind ${value.kind} is not allowed for ${expectedSubject}`);
  }
}

function validateLocal(
  value: Extract<ExternalProofEvidenceRecord, { readonly kind: 'LOCAL_VERIFICATION' }>,
  evaluatedAtMs: number,
  expectedRevision: string,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'sourceRevision', 'verifiedAtMs', 'checks',
  ], name);
  if (value.sourceRevision !== expectedRevision) {
    throw new TypeError(`${name}.sourceRevision must match the exact L16 implementation revision`);
  }
  time(value.verifiedAtMs, `${name}.verifiedAtMs`, evaluatedAtMs);
  if (!Array.isArray(value.checks) || value.checks.length !== LOCAL_CHECKS.length) {
    throw new TypeError(`${name}.checks must contain all eight exact L16 local gates`);
  }
  value.checks.forEach((check, index) => {
    exactKeys(check, ['check', 'exitCode', 'assertions'], `${name}.checks[${index}]`);
    if (check.check !== LOCAL_CHECKS[index] || check.exitCode !== 0) {
      throw new TypeError(`${name}.checks must contain passing local gates in canonical order`);
    }
    const assertionBearing = [
      'L16_FOCUSED',
      'IMPORT_PURITY',
      'ACCUMULATED_LIVE_EDGE',
      'PROTOCOL',
      'NPM_TEST',
      'TEST_ALL',
    ].includes(check.check);
    if (assertionBearing) positiveCount(check.assertions, `${name}.checks[${index}].assertions`);
    else if (check.assertions !== null) throw new TypeError(`${name}.checks[${index}] must not fabricate assertions`);
  });
}

function validateReplay(
  value: Extract<ExternalProofEvidenceRecord, { readonly kind: 'DETERMINISTIC_REPLAY' }>,
  evaluatedAtMs: number,
  expectedRevision: string,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'authority', 'sourceRevision',
    'verifiedAtMs', 'exitCode', 'scenarioCount', 'assertions', 'deterministic', 'networkFree',
  ], name);
  if (value.authority !== 'SYNTHETIC_TEST' || value.exitCode !== 0
      || value.deterministic !== true || value.networkFree !== true) {
    throw new TypeError(`${name} must remain passing deterministic network-free synthetic evidence`);
  }
  if (value.sourceRevision !== expectedRevision) {
    throw new TypeError(`${name}.sourceRevision must match the exact L16 implementation revision`);
  }
  time(value.verifiedAtMs, `${name}.verifiedAtMs`, evaluatedAtMs);
  positiveCount(value.scenarioCount, `${name}.scenarioCount`);
  positiveCount(value.assertions, `${name}.assertions`);
}

function validateIntegration(
  value: Extract<ExternalProofEvidenceRecord, { readonly kind: 'ADAPTER_INTEGRATION_STATE' }>,
  expectedRevision: string,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'sourceRevision',
    'integrationState', 'runtimeCompositionObserved',
  ], name);
  if (value.sourceRevision !== expectedRevision) {
    throw new TypeError(`${name}.sourceRevision must match the exact L16 implementation revision`);
  }
  if (value.integrationState !== 'UNWIRED' || value.runtimeCompositionObserved !== false) {
    throw new TypeError(`${name} cannot promote an unwired adapter into runtime composition`);
  }
}

function validateSatellite(
  value: Extract<ExternalProofEvidenceRecord, { readonly kind: 'L15_SATELLITE_ACCEPTANCE' }>,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'receiptCommit', 'receiptTree',
    'workCommit', 'receiptBlob', 'receiptRawSha256', 'localAssertions',
    'acceptedSatellite', 'merged', 'wired', 'deployed', 'live',
  ], name);
  for (const key of [
    'receiptCommit', 'receiptTree', 'workCommit', 'receiptBlob', 'receiptRawSha256', 'localAssertions',
  ] as const) {
    if (value[key] !== L15_SATELLITE_EVIDENCE[key]) {
      throw new TypeError(`${name}.${key} does not match the exact accepted L15 satellite`);
    }
  }
  if (value.acceptedSatellite !== true || value.merged !== false || value.wired !== false
      || value.deployed !== false || value.live !== false) {
    throw new TypeError(`${name} cannot promote accepted-satellite evidence into merged, wired, deployed, or live proof`);
  }
}

function validateAuthorizationGap(
  value: Readonly<ExternalAuthorizationGapEvidence>,
  evaluatedAtMs: number,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'expectedActionClass',
    'authorizationState', 'observedActionClass', 'authorizationExpiresAtMs', 'checkedAtMs',
  ], name);
  const checkedAtMs = time(value.checkedAtMs, `${name}.checkedAtMs`, evaluatedAtMs);
  if (!EXTERNAL_ACTION_CLASSES.includes(value.expectedActionClass as never)
      || (value.observedActionClass !== null
        && !EXTERNAL_ACTION_CLASSES.includes(value.observedActionClass as never))) {
    throw new TypeError(`${name} authorization classes must come from the closed action-class catalog`);
  }
  const expected = value.subject === 'PRIVATE_ACCOUNT_AND_RECONCILIATION_TRUTH'
    ? 'READ_ONLY_PRIVATE_BINANCE_ACCESS'
    : value.subject === 'SERVICE_RESTART_AND_DEGRADED_BEHAVIOR'
      ? 'SERVICE_RESTART'
      : null;
  if (expected === null || value.expectedActionClass !== expected) {
    throw new TypeError(`${name}.expectedActionClass is not the exact subject authorization class`);
  }
  if (value.authorizationState === 'MISSING') {
    if (value.observedActionClass !== null || value.authorizationExpiresAtMs !== null) {
      throw new TypeError(`${name} MISSING authorization cannot contain observed authorization facts`);
    }
    return;
  }
  if (value.authorizationState === 'EXPIRED') {
    if (value.observedActionClass !== value.expectedActionClass
        || !isValidUtcMillis(value.authorizationExpiresAtMs)
        || (value.authorizationExpiresAtMs as number) >= checkedAtMs) {
      throw new TypeError(`${name} EXPIRED authorization requires the exact class and a past expiry`);
    }
    return;
  }
  if (value.authorizationState === 'WRONG_CLASS') {
    if (value.observedActionClass === null || value.observedActionClass === value.expectedActionClass
        || value.authorizationExpiresAtMs !== null) {
      throw new TypeError(`${name} WRONG_CLASS authorization must name only a different action class`);
    }
    return;
  }
  throw new TypeError(`${name}.authorizationState is invalid`);
}

function validateAbsentRuntime(
  value: Readonly<AbsentRuntimeEvidence>,
  evaluatedAtMs: number,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'requiredProof',
    'evidenceState', 'infrastructureSignal', 'checkedAtMs',
  ], name);
  time(value.checkedAtMs, `${name}.checkedAtMs`, evaluatedAtMs);
  if (value.evidenceState !== 'ABSENT') throw new TypeError(`${name} cannot self-assert runtime proof`);
  const expected = value.subject === 'DEPLOYED_EC2_APPLICATION_AND_COCKPIT'
    ? 'DEPLOYED_APP_AND_COCKPIT'
    : value.subject === 'CLOUDFLARE_TUNNEL_AND_ACCESS'
      ? 'CLOUDFLARE_ORIGIN_AND_ACCESS'
      : value.subject === 'CURRENT_FILTER_ADMISSION'
        ? 'CURRENT_FILTER_OWNER_VERDICT'
        : null;
  if (expected === null || value.requiredProof !== expected) {
    throw new TypeError(`${name}.requiredProof is not bound to its exact subject`);
  }
  const allowedSignals = value.subject === 'DEPLOYED_EC2_APPLICATION_AND_COCKPIT'
    ? ['NONE', 'EC2_STATUS_OK_ONLY']
    : value.subject === 'CLOUDFLARE_TUNNEL_AND_ACCESS'
      ? ['NONE', 'TUNNEL_HEALTHY_ONLY']
      : ['NONE'];
  if (!allowedSignals.includes(value.infrastructureSignal)) {
    throw new TypeError(`${name} infrastructure status is not valid for this subject`);
  }
}

function validatePolicyBlock(
  value: Readonly<RepositoryPolicyBlockEvidence>,
  evaluatedAtMs: number,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'policy', 'performed', 'checkedAtMs',
  ], name);
  time(value.checkedAtMs, `${name}.checkedAtMs`, evaluatedAtMs);
  if (value.performed !== false) throw new TypeError(`${name} prohibited action must not have been performed`);
  const expected = ['SPOT_SIGNED_TEST_ORDER', 'USD_M_SIGNED_TEST_ORDER', 'MARGIN_SIGNED_TEST_ORDER']
    .includes(value.subject)
    ? 'NO_SIGNED_TEST_ORDERS'
    : value.subject === 'MARGIN_BORROW_AND_REPAY'
      ? 'NO_BORROW_REPAY'
      : ['LIVE_ORDER', 'STRATEGY_LIVE_TICKET'].includes(value.subject)
        ? 'LIVE_EXECUTION_NOT_IMPLEMENTED'
        : null;
  if (expected === null || value.policy !== expected) {
    throw new TypeError(`${name}.policy is not the exact repository block for its subject`);
  }
}

function validateNonPerformance(
  value: Extract<ExternalProofEvidenceRecord, { readonly kind: 'EXTERNAL_NON_PERFORMANCE' }>,
  evaluatedAtMs: number,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'actionClass', 'performed', 'checkedAtMs',
  ], name);
  time(value.checkedAtMs, `${name}.checkedAtMs`, evaluatedAtMs);
  if (value.subject !== 'PUBLIC_RUNTIME_OBSERVATION'
      || value.actionClass !== 'PUBLIC_RUNTIME_OBSERVATION' || value.performed !== false) {
    throw new TypeError(`${name} must preserve exact public-runtime non-performance`);
  }
}

function validateI00(
  value: Extract<ExternalProofEvidenceRecord, { readonly kind: 'I00_INTEGRATION_DEFERRAL' }>,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'target', 'integrationState',
    'merged', 'wired', 'deployed',
  ], name);
  if (value.target !== 'I00' || value.integrationState !== 'DEFERRED'
      || value.merged !== false || value.wired !== false || value.deployed !== false) {
    throw new TypeError(`${name} must remain deferred to I00 without merge, wiring, or deployment`);
  }
}

function validateFilterSubject(value: Readonly<FilterAdmissionIdentity>, name: string): void {
  exactKeys(value, ['product', 'environment', 'snapshotRevision', 'request'], name);
  if (!['SPOT', 'USD_M_PERPETUAL', 'MARGIN'].includes(value.product)) {
    throw new TypeError(`${name}.product is invalid`);
  }
  if (value.environment !== 'PRODUCTION') {
    throw new TypeError(`${name}.environment must use the canonical production registry dialect`);
  }
  text(value.snapshotRevision, `${name}.snapshotRevision`);
  if (value.request === null || typeof value.request !== 'object' || Array.isArray(value.request)) {
    throw new TypeError(`${name}.request must be one complete canonical sizing request`);
  }
}

function validateFilterVerdict(
  value: Readonly<CurrentOwnerFilterVerdictEvidence>,
  evaluatedAtMs: number,
  name: string,
): void {
  exactKeys(value, [
    'subject', 'evidenceId', 'reasonCodes', 'kind', 'expectedSubject', 'ownerSnapshot', 'ownerResult',
  ], name);
  if (value.subject !== 'CURRENT_FILTER_ADMISSION') {
    throw new TypeError(`${name} must cover current filter admission`);
  }
  validateFilterSubject(value.expectedSubject, `${name}.expectedSubject`);
  const ownerSnapshot = validateInstrumentRegistrySnapshot(value.ownerSnapshot);
  if (ownerSnapshot.product !== value.expectedSubject.product
      || ownerSnapshot.environment !== value.expectedSubject.environment
      || ownerSnapshot.snapshotRevision !== value.expectedSubject.snapshotRevision) {
    throw new TypeError(`${name} owner snapshot is bound to a different exact admission subject`);
  }
  const request = value.expectedSubject.request;
  if (request.evaluatedAtMs !== evaluatedAtMs) {
    throw new TypeError(`${name} sizing request must be evaluated at the L16 evidence instant`);
  }
  const reproduced = preflightInstrumentSizing(ownerSnapshot, request);
  if (canonicalJson(reproduced) !== canonicalJson(value.ownerResult)) {
    throw new TypeError(`${name}.ownerResult must reproduce from the canonical L04 owner`);
  }
  if (reproduced.staticState !== 'BLOCKED'
      || reproduced.reasonCodes.length === 0
      || canonicalJson(reproduced.reasonCodes) !== canonicalJson(value.reasonCodes)
      || !reproduced.reasonCodes.every((reason) => FILTER_ARITHMETIC_REASON.test(reason))
      || !reproduced.reasonCodes.some((reason) => EXCHANGE_FILTER_REASON.test(reason))
      || reproduced.instrumentRevision === null
      || request.instrumentRevision !== reproduced.instrumentRevision
      || reproduced.sourceEvidenceRevision === null
      || reproduced.registryRevision !== ownerSnapshot.registryRevision
      || reproduced.snapshotRevision !== ownerSnapshot.snapshotRevision
      || reproduced.evaluatedAtMs !== evaluatedAtMs
      || reproduced.instrumentValidUntilMs === null
      || reproduced.instrumentValidUntilMs < evaluatedAtMs
      || reproduced.validationPrice === null
      || reproduced.requestedQuantity === null) {
    throw new TypeError(`${name} must be one complete current exact-subject canonical owner BLOCKED result`);
  }
  const quantityArithmetic = reproduced.reasonCodes.some((reason) =>
    /(?:QUANTITY|GRID|NOTIONAL|RESULT_QUANTITY|FILTER_SCALE)/.test(reason));
  if (quantityArithmetic
      && (reproduced.resultQuantity === null || reproduced.resultNotional === null)) {
    throw new TypeError(`${name} quantity/filter arithmetic must retain its exact derived result`);
  }
}

function validateRecord(
  value: Readonly<ExternalProofEvidenceRecord>,
  expectedSubject: ExternalProofSubject,
  index: number,
  evaluatedAtMs: number,
  expectedRevision: string,
): void {
  const name = `evidence[${index}]`;
  validateBase(value, expectedSubject, index);
  switch (value.kind) {
    case 'LOCAL_VERIFICATION':
      validateLocal(value, evaluatedAtMs, expectedRevision, name);
      return;
    case 'DETERMINISTIC_REPLAY':
      validateReplay(value, evaluatedAtMs, expectedRevision, name);
      return;
    case 'ADAPTER_INTEGRATION_STATE':
      validateIntegration(value, expectedRevision, name);
      return;
    case 'L15_SATELLITE_ACCEPTANCE':
      validateSatellite(value, name);
      return;
    case 'EXTERNAL_AUTHORIZATION_GAP':
      validateAuthorizationGap(value, evaluatedAtMs, name);
      return;
    case 'ABSENT_RUNTIME_EVIDENCE':
      validateAbsentRuntime(value, evaluatedAtMs, name);
      return;
    case 'REPOSITORY_POLICY_BLOCK':
      validatePolicyBlock(value, evaluatedAtMs, name);
      return;
    case 'EXTERNAL_NON_PERFORMANCE':
      validateNonPerformance(value, evaluatedAtMs, name);
      return;
    case 'I00_INTEGRATION_DEFERRAL':
      validateI00(value, name);
      return;
    case 'CURRENT_OWNER_FILTER_VERDICT':
      validateFilterVerdict(value, evaluatedAtMs, name);
      return;
  }
}

function validateEvidenceCatalog(
  value: readonly Readonly<ExternalProofEvidenceRecord>[],
  evaluatedAtMs: number,
  expectedRevision: string,
): void {
  if (!Array.isArray(value) || value.length !== EXTERNAL_PROOF_SUBJECTS.length) {
    throw new TypeError('evidence must cover the exact closed L16 subject catalog');
  }
  const evidenceIds = new Set<string>();
  value.forEach((entry, index) => {
    const subject = EXTERNAL_PROOF_SUBJECTS[index];
    if (subject === undefined) throw new TypeError(`evidence[${index}] is unexpected`);
    validateRecord(entry, subject, index, evaluatedAtMs, expectedRevision);
    if (evidenceIds.has(entry.evidenceId)) throw new TypeError('evidence IDs must be unique');
    evidenceIds.add(entry.evidenceId);
  });
}

function deriveLineage(
  input: Readonly<ExternalProofEvidenceInput>,
): Readonly<ExternalProofLineageBinding> {
  const validated = validateMachineGraphEvidenceSnapshot(input.l13Snapshot, input.l12Snapshot);
  if (input.evaluatedAtMs < validated.assembledAtMs) {
    throw new TypeError('evaluatedAtMs cannot predate the accepted L13 snapshot');
  }
  const lineage: ExternalProofLineageBinding = {
    sourceSchema: validated.schema,
    sourceVersion: validated.version,
    sourceSnapshotRevision: validated.snapshotRevision,
    sourceAssembledAtMs: validated.assembledAtMs,
    l12SourceSnapshotRevision: validated.l12Binding.sourceSnapshotRevision,
    projectionAuthority: validated.projectionAuthority,
    truthClass: validated.truthClass,
    readinessAuthority: validated.readinessAuthority,
    externalActionAuthorization: validated.externalActionAuthorization,
  };
  if (lineage.sourceSchema !== MACHINE_GRAPH_EVIDENCE_SCHEMA
      || lineage.sourceVersion !== 1
      || lineage.projectionAuthority !== 'OWNER_EVIDENCE_ADAPTER_ONLY'
      || lineage.truthClass !== 'SYNTHETIC_ONLY_UNWIRED'
      || lineage.readinessAuthority !== 'NONE_RECORD_ONLY'
      || lineage.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L13 lineage cannot be promoted into external proof or authority');
  }
  return cloneFreeze(lineage);
}

function classify(
  evidence: Readonly<ExternalProofEvidenceRecord>,
): Readonly<ClassifiedExternalProofEvidence> {
  const classification = EXTERNAL_PROOF_CLASS_BY_KIND[evidence.kind];
  return cloneFreeze({
    subject: evidence.subject,
    classification,
    evidence,
    provesLocal: classification === 'PROVED_LOCAL',
    provesSyntheticReplay: classification === 'SYNTHETIC_REPLAY',
    provesAcceptedSatellite: classification === 'ACCEPTED_SATELLITE',
    provesMerged: false,
    provesWired: false,
    provesDeployed: false,
    provesLivePublic: false,
    provesLivePrivate: false,
    provesReadiness: false,
    provesMoneyMutation: false,
  } satisfies ClassifiedExternalProofEvidence);
}

function deriveSnapshotRevision(material: unknown): string {
  assertClosedPlainData(material);
  return `l16_${stableHash128Hex(canonicalJson(material))}`;
}

export function projectExternalProofEvidence(
  input: ExternalProofEvidenceInput,
): Readonly<ExternalProofEvidenceSnapshot> {
  assertClosedPlainData(input);
  exactKeys(input, [
    'evaluatedAtMs', 'implementationRevision', 'l12Snapshot', 'l13Snapshot', 'evidence',
  ], 'input');
  if (!isValidUtcMillis(input.evaluatedAtMs)) {
    throw new TypeError('evaluatedAtMs must be injected valid UTC milliseconds');
  }
  if (!GIT_COMMIT.test(input.implementationRevision)) {
    throw new TypeError('implementationRevision must be one exact lowercase Git commit');
  }
  const cloned = cloneFreeze(input) as Readonly<ExternalProofEvidenceInput>;
  const lineage = deriveLineage(cloned);
  validateEvidenceCatalog(cloned.evidence, cloned.evaluatedAtMs, cloned.implementationRevision);
  const material = {
    schema: EXTERNAL_PROOF_EVIDENCE_SCHEMA,
    version: 1 as const,
    evaluatedAtMs: cloned.evaluatedAtMs,
    implementationRevision: cloned.implementationRevision,
    lineage,
    evidence: cloned.evidence.map((entry) => classify(entry)),
    projectionAuthority: 'INJECTED_EVIDENCE_CLASSIFICATION_ONLY' as const,
    classificationAuthority: 'CLOSED_KIND_MAPPING_ONLY' as const,
    externalCalls: false as const,
    credentialAccess: 'NONE' as const,
    runnerAuthority: 'NONE' as const,
    deployAuthority: 'NONE' as const,
    readinessAuthority: 'NONE' as const,
    actionAuthority: 'NONE' as const,
    sendEligible: false as const,
    liveExecution: 'LIVE_EXECUTION_NOT_IMPLEMENTED' as const,
    deployedProof: false as const,
    livePublicProof: false as const,
    livePrivateProof: false as const,
    readinessProof: false as const,
    moneyMutationProof: false as const,
  };
  return cloneFreeze({
    ...material,
    snapshotRevision: deriveSnapshotRevision(material),
  } satisfies ExternalProofEvidenceSnapshot);
}

export function validateExternalProofEvidenceSnapshot(
  value: Readonly<ExternalProofEvidenceSnapshot>,
  l12Snapshot: Readonly<ExternalProofEvidenceInput['l12Snapshot']>,
  l13Snapshot: Readonly<ExternalProofEvidenceInput['l13Snapshot']>,
): Readonly<ExternalProofEvidenceSnapshot> {
  assertClosedPlainData(value);
  if (value.schema !== EXTERNAL_PROOF_EVIDENCE_SCHEMA || value.version !== 1) {
    throw new TypeError('external-proof evidence snapshot schema mismatch');
  }
  const reproduced = projectExternalProofEvidence({
    evaluatedAtMs: value.evaluatedAtMs,
    implementationRevision: value.implementationRevision,
    l12Snapshot,
    l13Snapshot,
    evidence: value.evidence.map((entry) => entry.evidence),
  });
  if (canonicalJson(reproduced) !== canonicalJson(value)) {
    throw new TypeError('external-proof evidence snapshot is not reproducible');
  }
  return reproduced;
}
