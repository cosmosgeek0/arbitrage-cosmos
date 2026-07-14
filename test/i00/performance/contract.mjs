import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const REPORT_SCHEMA_VERSION = 'i00.local-proxy-performance.v1';
export const ACCEPTANCE_SCHEMA_VERSION = 'i00.local-acceptance.v1';
export const Q_DONOR_SHA = '02b4eccc8d2ef53b830cafae06e5175715fa6ebb';
export const Q_DONOR_TREE = '5c86cebf0966cedd7ba01c56a01704b4f7bd0224';
export const Q_RECEIPT_PATH = 'quant/RECEIPTS/Q17_ACCEPTANCE.md';
export const Q_RECEIPT_SHA256 = '9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc';

export const I00_MANAGED_COMPONENT_IDENTITIES = Object.freeze([
  'operator-auth', 'configuration-authority', 'ledger-persistence', 'database', 'clock-sync',
  'spot-public-source', 'usdm-public-source', 'spot-private-truth', 'usdm-private-truth',
  'margin-private-truth', 'instrument-filter-registry', 'universe', 'evidence-attention-runtime',
  'q-inference', 'basis-engine', 'volume-engine', 'opportunity-authority', 'capital-supervision',
  'risk-gate', 'execution-hand', 'normal-basis-coordinator', 'reverse-basis-coordinator',
  'volume-position-lifecycle', 'reconciliation', 'exposure-position-recovery', 'outcome-feedback',
  'machine-supervisor', 'api-read-model', 'notification-incident-router', 'web-cockpit',
  'backup-restore', 'external-watchdog', 'cloudflare-tunnel-access',
]);

export const CANONICAL_SYSTEM_COMPONENT_IDS = Object.freeze([
  'public-spot-source', 'public-usdm-source', 'market-universe', 'intelligence-runtime',
  'market-intelligence', 'q-inference', 'basis-engine', 'volume-engine', 'capital-supervision',
  'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation', 'ledger-persistence',
  'engine-supervisor',
]);

export const PRODUCT_RUNTIME_CONTROL_IDS = Object.freeze([
  'global.safe-mode.read-only',
  'global.kill-switch.engage',
  'global.intake.pause',
  'component.engine-supervisor.restart',
]);

function managedExpectation(identity, owner, canonicalComponentIds, inventoryState, reasonCode = null) {
  return Object.freeze({
    identity,
    owner,
    canonicalComponentIds: Object.freeze(canonicalComponentIds),
    inventoryState,
    reasonCode,
  });
}

/** Exact I00 role-to-owner/component disposition used to reject same-shape receipt forgeries. */
export const I00_MANAGED_INVENTORY_EXPECTATIONS = Object.freeze([
  managedExpectation('operator-auth', 'AUDITED_BACKEND_SECURITY', [], 'OWNER_GATED', 'REMOTE_OPERATOR_IDENTITY_OWNER_GATED'),
  managedExpectation('configuration-authority', 'SYSTEM_CONTROL_CONFIGURATION_OWNER', [], 'OWNER_GATED', 'CANONICAL_CONFIGURATION_VERSION_OWNER_REQUIRED'),
  managedExpectation('ledger-persistence', 'EXISTING_LEDGER', ['ledger-persistence'], 'EVIDENCE_PRESENT'),
  managedExpectation('database', 'EXISTING_LEDGER_DATABASE', [], 'OWNER_GATED', 'DATABASE_LIFECYCLE_EVIDENCE_NOT_BOUND'),
  managedExpectation('clock-sync', 'CANONICAL_CLOCK_SYNC_OWNER', [], 'OWNER_GATED', 'CLOCK_SYNCHRONIZATION_OWNER_NOT_BOUND'),
  managedExpectation('spot-public-source', 'AUDITED_APP_PUBLIC_SOURCE', ['public-spot-source'], 'EVIDENCE_PRESENT'),
  managedExpectation('usdm-public-source', 'AUDITED_APP_PUBLIC_SOURCE', ['public-usdm-source'], 'EVIDENCE_PRESENT'),
  managedExpectation('spot-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', [], 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  managedExpectation('usdm-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', [], 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  managedExpectation('margin-private-truth', 'LIVE_EDGE_PRIVATE_TRUTH', [], 'OWNER_GATED', 'PRIVATE_READ_AUTHORIZATION_REQUIRED'),
  managedExpectation('instrument-filter-registry', 'CANONICAL_MARKET_UNIVERSE', ['market-universe'], 'EVIDENCE_PRESENT'),
  managedExpectation('universe', 'CANONICAL_MARKET_UNIVERSE', ['market-universe'], 'EVIDENCE_PRESENT'),
  managedExpectation('evidence-attention-runtime', 'INTELLIGENCE_RUNTIME_AND_MARKET_INTELLIGENCE', ['intelligence-runtime', 'market-intelligence'], 'EVIDENCE_PRESENT'),
  managedExpectation('q-inference', 'Q_INFERENCE', ['q-inference'], 'EVIDENCE_PRESENT'),
  managedExpectation('basis-engine', 'BASIS_ENGINE', ['basis-engine'], 'EVIDENCE_PRESENT'),
  managedExpectation('volume-engine', 'VOLUME_ENGINE', ['volume-engine'], 'EVIDENCE_PRESENT'),
  managedExpectation('opportunity-authority', 'FOUNDATION_CANONICAL_OPPORTUNITY', [], 'OWNER_GATED', 'OPPORTUNITY_AUTHORITY_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedExpectation('capital-supervision', 'CAPITAL_SUPERVISION', ['capital-supervision'], 'EVIDENCE_PRESENT'),
  managedExpectation('risk-gate', 'BACKEND_FOUNDATION_RISK', ['multileg-risk'], 'EVIDENCE_PRESENT'),
  managedExpectation('execution-hand', 'BACKEND_FOUNDATION_EXECUTION', ['execution-coordinator-validate-only'], 'EVIDENCE_PRESENT'),
  managedExpectation('normal-basis-coordinator', 'LIVE_EDGE_NORMAL_BASIS_COORDINATOR', [], 'OWNER_GATED', 'NORMAL_BASIS_COORDINATOR_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedExpectation('reverse-basis-coordinator', 'LIVE_EDGE_REVERSE_BASIS_COORDINATOR', [], 'OWNER_GATED', 'REVERSE_BASIS_COORDINATOR_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedExpectation('volume-position-lifecycle', 'LIVE_EDGE_VOLUME_POSITION_LIFECYCLE', [], 'OWNER_GATED', 'VOLUME_POSITION_LIFECYCLE_COMPONENT_EVIDENCE_NOT_BOUND'),
  managedExpectation('reconciliation', 'BACKEND_FOUNDATION_RECONCILIATION', ['reconciliation'], 'EVIDENCE_PRESENT'),
  managedExpectation('exposure-position-recovery', 'LIVE_EDGE_EXPOSURE_RECOVERY', [], 'OWNER_GATED', 'PRIVATE_ACCOUNT_TRUTH_OWNER_GATED'),
  managedExpectation('outcome-feedback', 'Q_OUTCOME_FEEDBACK_OWNER', [], 'OWNER_GATED', 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED'),
  managedExpectation('machine-supervisor', 'BACKEND_FOUNDATION_CONTROL_AND_SYSTEM_INTEGRATION', ['engine-supervisor'], 'EVIDENCE_PRESENT'),
  managedExpectation('api-read-model', 'PRODUCT_INTEGRATION_READ_MODEL', [], 'NOT_CONFIGURED', 'API_READ_MODEL_NOT_LIFECYCLE_MANAGED'),
  managedExpectation('notification-incident-router', 'NOTIFICATION_INCIDENT_ROUTER', [], 'NOT_CONFIGURED', 'INCIDENT_OWNER_NOT_CONFIGURED'),
  managedExpectation('web-cockpit', 'PRODUCT_CONTROL_WEB', [], 'NOT_CONFIGURED', 'WEB_COCKPIT_NOT_LIFECYCLE_MANAGED'),
  managedExpectation('backup-restore', 'OPS_BACKUP_RESTORE', [], 'MISSING', 'BACKUP_RESTORE_MANAGED_COMPONENT_MISSING'),
  managedExpectation('external-watchdog', 'OPS_EXTERNAL_WATCHDOG', [], 'MISSING', 'EXTERNAL_WATCHDOG_MANAGED_COMPONENT_MISSING'),
  managedExpectation('cloudflare-tunnel-access', 'OPS_CLOUDFLARE_ACCESS', [], 'MISSING', 'CLOUDFLARE_TUNNEL_ACCESS_MANAGED_COMPONENT_MISSING'),
]);

export const CANONICAL_SYSTEM_COMPONENT_OWNERS = Object.freeze([
  'INTELLIGENCE_RUNTIME:server/src/intelligenceRuntime',
  'INTELLIGENCE_RUNTIME:server/src/intelligenceRuntime',
  'AUDITED_APP:server/src/engine/marketData.ts',
  'INTELLIGENCE_RUNTIME:server/src/intelligenceRuntime',
  'MARKET_INTELLIGENCE:server/src/intelligenceFoundation',
  'Q_INFERENCE:quant/src/quant_edge/inference',
  'BASIS_ENGINE:server/src/engine/basis',
  'VOLUME_ENGINE:server/src/engine/volume',
  'CAPITAL_SUPERVISION:server/src/capitalFoundation',
  'BACKEND_FOUNDATION_RISK:server/src/foundation/risk',
  'BACKEND_FOUNDATION_EXECUTION:server/src/foundation/execution',
  'BACKEND_FOUNDATION_RECONCILIATION:server/src/foundation/reconciliation',
  'EXISTING_LEDGER:server/src/ledger.ts',
  'SYSTEM_INTEGRATION:server/src/systemIntegration',
]);

export const PRODUCT_RUNTIME_CONTROL_EXPECTATIONS = Object.freeze([
  Object.freeze({ controlId: 'global.safe-mode.read-only', backendCommandId: 'SET_SAFE_MODE' }),
  Object.freeze({ controlId: 'global.kill-switch.engage', backendCommandId: 'SET_KILL_SWITCH' }),
  Object.freeze({ controlId: 'global.intake.pause', backendCommandId: 'SET_INTAKE_PAUSED' }),
  Object.freeze({ controlId: 'component.engine-supervisor.restart', backendCommandId: 'RESTART_COMPONENT' }),
]);

export const PROTECTED_OWNER_DIRECTIVES = Object.freeze([
  Object.freeze({ path: 'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md', sha256: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5' }),
  Object.freeze({ path: 'IP_CONTROL.md', sha256: '5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278' }),
  Object.freeze({ path: 'IP_OPS.md', sha256: '2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779' }),
  Object.freeze({ path: 'IP_PROOF.md', sha256: 'e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6' }),
  Object.freeze({ path: 'IP_RUNTIME.md', sha256: '6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810' }),
]);

export const LOCAL_PROXY_SLOS = Object.freeze({
  cpuHostPercent: Object.freeze({ soft: 70, hard: 90, unit: 'percent' }),
  eventLoopLagMs: Object.freeze({ soft: 50, hard: 200, unit: 'ms' }),
  rssBytes: Object.freeze({ soft: 536_870_912, hard: 805_306_368, unit: 'bytes' }),
  rssSlopeBytesPerHour: Object.freeze({ soft: 10_485_760, hard: 52_428_800, unit: 'bytes/hour' }),
  walBytes: Object.freeze({ soft: 1_073_741_824, hard: 5_368_709_120, unit: 'bytes' }),
  httpP95Ms: Object.freeze({ soft: 250, hard: 1_000, unit: 'ms' }),
  httpUnexpectedPercent: Object.freeze({ soft: 1, hard: 5, unit: 'percent' }),
  apiBytesPerSecond: Object.freeze({ soft: 5_242_880, hard: 20_971_520, unit: 'bytes/second' }),
});

export const SAFE_HTTP_ENDPOINTS = Object.freeze([
  Object.freeze({ path: '/health/live', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/health/ready', expectedStatuses: Object.freeze([200, 503]) }),
  Object.freeze({ path: '/health/trade-ready', expectedStatuses: Object.freeze([200, 503]) }),
  Object.freeze({ path: '/api/health', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/api/state', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/api/events?limit=25', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/api/events/count', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/api/engine/volume', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/api/engine/basis', expectedStatuses: Object.freeze([200]) }),
  Object.freeze({ path: '/api/product-integration/v1/supervisor', expectedStatuses: Object.freeze([200]) }),
]);

export const REQUIRED_LIMITATIONS = Object.freeze([
  Object.freeze({ metric: 'q.production_inference_latency', status: 'NOT_CONFIGURED', reason: 'No accepted production Q transport is mounted; no latency value exists.' }),
  Object.freeze({ metric: 'private.events_per_second', status: 'OWNER_GATED', reason: 'Private reads and credentials are outside this keyless local campaign.' }),
  Object.freeze({ metric: 'exchange.weight_utilization', status: 'NOT_CONFIGURED', reason: 'The assembled runtime does not expose a canonical exchange-weight metric.' }),
  Object.freeze({ metric: 'runtime.real_reconnect_storm', status: 'NOT_CONFIGURED', reason: 'The harness does not manipulate upstream public networks or claim a real reconnect storm.' }),
  Object.freeze({ metric: 'backup.during_observation', status: 'NOT_CONFIGURED', reason: 'The accepted simulation-only backup owner exists, but no concurrent backup was exercised in this soak and no production backup claim is made.' }),
  Object.freeze({ metric: 'ledger.commit_latency', status: 'NOT_CONFIGURED', reason: 'The existing Ledger does not expose canonical per-commit latency telemetry.' }),
  Object.freeze({ metric: 'runtime.full_universe_event_rate', status: 'NOT_CONFIGURED', reason: 'No canonical full-universe event-rate counter is exposed by the assembled runtime.' }),
  Object.freeze({ metric: 'runtime.reconnect_resync', status: 'NOT_CONFIGURED', reason: 'Normal public-source status is observable, but a controlled reconnect campaign is not implemented here.' }),
  Object.freeze({ metric: 'runtime.log_notification_flood', status: 'NOT_CONFIGURED', reason: 'This bounded safe campaign does not inject synthetic production incidents.' }),
  Object.freeze({ metric: 'runtime.constrained_resource_degradation', status: 'NOT_CONFIGURED', reason: 'No cgroup or host resource mutation is performed by this local harness.' }),
  Object.freeze({ metric: 'cockpit.browser_render', status: 'NOT_CONFIGURED', reason: 'This receipt measures canonical APIs and WebSocket behavior; browser rendering requires the separate browser acceptance artifact.' }),
  Object.freeze({ metric: 'production.capacity_slo', status: 'UNKNOWN', reason: 'Local proxy bounds are measurement gates, not measured production capacity.' }),
]);

const SECRET_PATTERNS = Object.freeze([
  Object.freeze(['PRIVATE_KEY_MATERIAL', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]),
  Object.freeze(['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/]),
  Object.freeze(['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/]),
  Object.freeze(['JWT_VALUE', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/]),
  Object.freeze(['BEARER_TOKEN', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}\b/]),
  Object.freeze(['SECRET_ASSIGNMENT', /\b(?:api[_-]?(?:key|secret)|password|private[_-]?key|aws_secret_access_key|binance_api_key)\s*[:=]\s*['\"]?[^\s'\"]{8,}/i]),
  Object.freeze(['SIGNED_QUERY', /(?:^|[?&])signature=[A-Fa-f0-9]{32,}(?:&|$)/]),
  Object.freeze(['PRIVATE_API_HEADER', /x-mbx-apikey\s*:\s*[A-Za-z0-9]{16,}/i]),
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function verifyProtectedOwnerDirectives(root, statusByPath) {
  const evidence = [];
  for (const directive of PROTECTED_OWNER_DIRECTIVES) {
    const absolute = path.join(root, directive.path);
    const info = lstatSync(absolute, { throwIfNoEntry: false });
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`PROTECTED_OWNER_DIRECTIVE_MISSING_OR_UNSAFE:${directive.path}`);
    const actualSha256 = sha256(readFileSync(absolute));
    if (actualSha256 !== directive.sha256) throw new Error(`PROTECTED_OWNER_DIRECTIVE_HASH_MISMATCH:${directive.path}`);
    if (statusByPath.get(directive.path) !== '??') throw new Error(`PROTECTED_OWNER_DIRECTIVE_MUST_REMAIN_UNTRACKED:${directive.path}`);
    evidence.push(Object.freeze({ path: directive.path, sha256: actualSha256, gitStatus: 'UNTRACKED_PROTECTED_OWNER_INPUT' }));
  }
  return Object.freeze(evidence);
}

export function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) throw new RangeError('percentile must be in (0, 1]');
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

export function summarize(values, digits = 3) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return Object.freeze({ count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null });
  const total = finite.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    count: finite.length,
    min: round(Math.min(...finite), digits),
    p50: round(nearestRank(finite, 0.50), digits),
    p95: round(nearestRank(finite, 0.95), digits),
    p99: round(nearestRank(finite, 0.99), digits),
    max: round(Math.max(...finite), digits),
    mean: round(total / finite.length, digits),
  });
}

export function evaluateBound(metric, observed, bound) {
  if (!Number.isFinite(observed)) {
    return Object.freeze({ metric, unit: bound.unit, observed: null, soft: bound.soft, hard: bound.hard, status: 'NOT_CONFIGURED', reason: 'No measured numeric value exists.' });
  }
  const status = observed > bound.hard ? 'BLOCKED' : observed > bound.soft ? 'DEGRADED' : 'PASS';
  const reason = status === 'PASS'
    ? 'Measured value is within the documented local-proxy soft bound.'
    : status === 'DEGRADED'
      ? 'Measured value exceeded the documented local-proxy soft bound.'
      : 'Measured value exceeded the documented local-proxy hard bound.';
  return Object.freeze({ metric, unit: bound.unit, observed: round(observed), soft: bound.soft, hard: bound.hard, status, reason });
}

export function aggregateSloStatus(checks, invariantFailures = []) {
  if (invariantFailures.length > 0 || checks.some((check) => check.status === 'BLOCKED')) return 'BLOCKED';
  if (checks.some((check) => check.status === 'DEGRADED')) return 'DEGRADED';
  return 'PASS';
}

export function scanSecretText(source) {
  const findings = [];
  const lines = String(source).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    for (const [code, pattern] of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index])) findings.push(Object.freeze({ code, line: index + 1 }));
    }
  }
  return Object.freeze(findings);
}

export function assertLoopbackHost(host) {
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') throw new Error('NON_LOOPBACK_TARGET_REFUSED');
  return host;
}

export function parseBoundedInteger(value, label, minimum, maximum) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${label}_MUST_BE_INTEGER`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label}_OUT_OF_RANGE_${minimum}_${maximum}`);
  return parsed;
}

function resolveSchemaReference(rootSchema, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) throw new Error(`UNSUPPORTED_SCHEMA_REF:${reference}`);
  return reference.slice(2).split('/').reduce((value, token) => value?.[token.replaceAll('~1', '/').replaceAll('~0', '~')], rootSchema);
}

function typeMatches(expected, value) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return isPlainObject(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

export function validateJsonSchema(rootSchema, value) {
  const errors = [];
  function visit(schema, current, pointer) {
    if (schema.$ref) {
      const resolved = resolveSchemaReference(rootSchema, schema.$ref);
      if (!resolved) errors.push(`${pointer}:UNRESOLVED_REF:${schema.$ref}`);
      else visit(resolved, current, pointer);
      return;
    }
    if (Object.hasOwn(schema, 'const') && current !== schema.const) errors.push(`${pointer}:CONST`);
    if (schema.enum && !schema.enum.includes(current)) errors.push(`${pointer}:ENUM`);
    if (schema.type) {
      const accepted = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!accepted.some((type) => typeMatches(type, current))) {
        errors.push(`${pointer}:TYPE:${accepted.join('|')}`);
        return;
      }
    }
    if (typeof current === 'string') {
      if (schema.minLength !== undefined && current.length < schema.minLength) errors.push(`${pointer}:MIN_LENGTH`);
      if (schema.maxLength !== undefined && current.length > schema.maxLength) errors.push(`${pointer}:MAX_LENGTH`);
      if (schema.pattern && !new RegExp(schema.pattern).test(current)) errors.push(`${pointer}:PATTERN`);
    }
    if (typeof current === 'number') {
      if (schema.minimum !== undefined && current < schema.minimum) errors.push(`${pointer}:MINIMUM`);
      if (schema.maximum !== undefined && current > schema.maximum) errors.push(`${pointer}:MAXIMUM`);
    }
    if (Array.isArray(current)) {
      if (schema.minItems !== undefined && current.length < schema.minItems) errors.push(`${pointer}:MIN_ITEMS`);
      if (schema.maxItems !== undefined && current.length > schema.maxItems) errors.push(`${pointer}:MAX_ITEMS`);
      if (schema.items) current.forEach((item, index) => visit(schema.items, item, `${pointer}/${index}`));
    }
    if (isPlainObject(current)) {
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) if (!Object.hasOwn(current, required)) errors.push(`${pointer}/${required}:REQUIRED`);
      for (const [key, child] of Object.entries(current)) {
        if (properties[key]) visit(properties[key], child, `${pointer}/${key}`);
        else if (schema.additionalProperties === false) errors.push(`${pointer}/${key}:ADDITIONAL_PROPERTY`);
        else if (isPlainObject(schema.additionalProperties)) visit(schema.additionalProperties, child, `${pointer}/${key}`);
      }
    }
  }
  visit(rootSchema, value, '$');
  return Object.freeze({ passed: errors.length === 0, errors: Object.freeze(errors.toSorted()) });
}

export function assertContainedOutput(root, requested) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('OUTPUT_PATH_OUTSIDE_EVIDENCE_ROOT');
  let cursor = path.dirname(resolved);
  while (cursor.startsWith(resolvedRoot)) {
    const info = lstatSync(cursor, { throwIfNoEntry: false });
    if (info?.isSymbolicLink()) throw new Error('OUTPUT_PATH_SYMLINK_FORBIDDEN');
    if (cursor === resolvedRoot) break;
    cursor = path.dirname(cursor);
  }
  return resolved;
}

let immutableTemporarySequence = 0;

function createImmutableTemporary(destination) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    immutableTemporarySequence = (immutableTemporarySequence % Number.MAX_SAFE_INTEGER) + 1;
    const temporary = `${destination}.tmp-${process.pid}-${immutableTemporarySequence}`;
    try {
      return Object.freeze({
        temporary,
        descriptor: openSync(temporary, 'wx', 0o600),
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('IMMUTABLE_RECEIPT_TEMPORARY_EXHAUSTED');
}

export function writeImmutableJson(outputRoot, requested, document) {
  const destination = assertContainedOutput(outputRoot, requested);
  mkdirSync(path.dirname(destination), { recursive: true });
  const { temporary, descriptor } = createImmutableTemporary(destination);
  let descriptorOpen = true;
  try {
    writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptorOpen = false;
    // `link(2)` publishes one already-complete inode under the final name and
    // fails with EEXIST instead of replacing a concurrent winner. The temp is
    // deliberately adjacent so this remains a same-filesystem operation.
    try {
      linkSync(temporary, destination);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('IMMUTABLE_RECEIPT_ALREADY_EXISTS');
      throw error;
    }
    return destination;
  } finally {
    if (descriptorOpen) {
      try { closeSync(descriptor); } catch {}
    }
    rmSync(temporary, { force: true });
  }
}
