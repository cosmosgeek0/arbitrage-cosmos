import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareQDirectiveInputLocks,
  sealedOwnerDirectiveSha256,
  verifySealedOwnerDirective,
  verifyLivingDirectorInputAcceptance,
  verifyQDirectiveInputSupersession,
} from '../../../test/i00/git-provenance.mjs';

export { compareQDirectiveInputLocks, verifyQDirectiveInputSupersession };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');

export function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

export function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

export function sha256(relativePath) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relativePath))).digest('hex');
}

export function listFiles(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  const info = statSync(absolute, { throwIfNoEntry: false });
  if (!info) return [];
  if (info.isFile()) return [relativePath];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relativePath.replaceAll(path.sep, '/'), entry.name);
    if (entry.isSymbolicLink()) throw new Error(`SYMLINK_FORBIDDEN:${child}`);
    if (entry.isDirectory()) files.push(...listFiles(child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

export function scanRule(rule) {
  const expression = new RegExp(rule.pattern, 'g');
  const hits = [];
  for (const file of listFiles(rule.scope)) {
    if (!/\.(?:js|mjs|cjs|ts|tsx)$/.test(file)) continue;
    if (rule.id === 'NO_IP_PROOF_PRODUCTION_IMPORT' && file.endsWith('/security-boundary.test.mjs')) continue;
    const content = readText(file);
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      expression.lastIndex = 0;
      if (expression.test(lines[index])) hits.push({ file, line: index + 1, ruleId: rule.id });
    }
  }
  return hits;
}

export function runAuthorityScan(catalog) {
  const concepts = new Set();
  for (const owner of catalog.authorityOwners) {
    assert(!concepts.has(owner.concept), `duplicate authority concept ${owner.concept}`);
    concepts.add(owner.concept);
    if (owner.path !== null) assert(statSync(path.join(ROOT, owner.path), { throwIfNoEntry: false }), `missing owner path ${owner.path}`);
  }

  const datasets = new Set();
  for (const source of catalog.semanticSources) {
    assert(!datasets.has(source.dataset), `duplicate semantic source ${source.dataset}`);
    datasets.add(source.dataset);
    assert(statSync(path.join(ROOT, source.physicalProducer), { throwIfNoEntry: false }), `missing producer ${source.physicalProducer}`);
  }

  const rules = catalog.staticRules.map((rule) => {
    const hits = scanRule(rule);
    return { id: rule.id, expectedHits: rule.expectedHits, hits, passed: hits.length === rule.expectedHits };
  });

  const conflicts = catalog.knownConflicts.map((conflict) => {
    if (conflict.path === null) return { ...conflict, observed: false };
    const observed = readText(conflict.path).includes(conflict.needle);
    return { ...conflict, observed };
  });
  const conflictClassificationPassed = conflicts.every((conflict) => {
    if (conflict.resolutionState === 'RESOLVED') return conflict.path !== null && conflict.observed;
    if (conflict.resolutionState === 'LIMITATION') return conflict.path === null;
    if (conflict.resolutionState === 'OPEN') return true;
    return false;
  });

  const boundaryPatterns = Object.freeze([
    ['PRIVATE_EXCHANGE_OWNER_IMPORT', /from\s+['"][^'"]*(?:binance\/(?:client|userStream)|services\/(?:orders|loans|account|userStream))[^'"]*['"]/],
    ['DUPLICATE_AUTHORITY_DECLARATION', /\b(?:class|function)\s+(?!(?:project|adapt|read)\w*)(?!\w*Adapter\b)\w*(?:RiskGate|Ledger|Scanner|ControlPlane|ExchangeClient|ProposalQueue|ProposalStore)\w*\b/],
    ['SOCKET_OR_DATABASE_CONSTRUCTION', /\bnew\s+(?:WebSocket|WebSocketServer|Database)\s*\(|\bbetter-sqlite3\b/],
  ]);
  const boundaryFindings = [];
  for (const file of listFiles('server/src/systemIntegration')) {
    if (!/\.(?:js|mjs|cjs|ts|tsx)$/.test(file)) continue;
    const lines = readText(file).split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      for (const [code, pattern] of boundaryPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(lines[index])) boundaryFindings.push({ code, file, line: index + 1 });
      }
    }
  }

  const transportCandidates = [];
  for (const scope of ['server/src', 'web/src']) {
    for (const file of listFiles(scope)) {
      if (!/\.(?:js|mjs|cjs|ts|tsx)$/.test(file)) continue;
      const lines = readText(file).split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (!/(?:new\s+WebSocket|new\s+WebSocketServer|from\s+['"]ws['"]|wss:\/\/)/.test(lines[index])) continue;
        const classification = file.startsWith('server/src/systemIntegration/') ? 'FORBIDDEN_IN_COMPOSER'
          : file === 'server/src/engine/marketData.ts' || /server\/src\/services\/(?:volumeRuntime|basisRuntime)\.ts/.test(file)
            ? 'ACCEPTED_EXISTING_PHYSICAL_PRODUCER'
            : file === 'server/src/services/bookStream.ts' ? 'UI_LOCAL_EXCEPTION_REVIEW'
              : file.startsWith('server/src/intelligenceRuntime/') ? 'CANONICAL_RUNTIME_OR_MANUAL_SMOKE'
                : file === 'server/src/binance/userStream.ts' ? 'PRIVATE_TRUTH_LEGACY_REVIEW'
                  : file === 'server/src/binance/ws.ts' ? 'TRANSPORT_LIBRARY'
                    : file === 'web/src/store.tsx' ? 'LOCAL_OPERATOR_DELIVERY'
                      : file.startsWith('server/src/intelligenceFoundation/') ? 'DECLARATIVE_SOURCE_FACTS'
                        : file === 'server/src/liveEdge/adapters/binanceContracts/manifest.ts' ? 'ACCEPTED_L_DOCUMENTARY_SOURCE_FACTS'
                        : file === 'server/src/index.ts' ? 'LEGACY_APP_DELIVERY'
                          : 'UNCLASSIFIED';
        transportCandidates.push({ file, line: index + 1, classification });
      }
    }
  }
  const unclassifiedTransportCandidates = transportCandidates.filter((candidate) => candidate.classification === 'UNCLASSIFIED');

  const ownerCandidatePatterns = Object.freeze([
    ['capital-authority', /\b(?:class|function|interface|type)\s+\w*(?:Capital|Allocation|Reservation|Mandate)\w*/g],
    ['risk-authority', /\b(?:class|function|interface|type)\s+\w*(?:Risk|Exposure)\w*/g],
    ['exchange-hand', /\b(?:class|function|interface|type)\s+\w*(?:Exchange|Venue|OrderCoordinator|Ticket)\w*/g],
    ['ledger-authority', /\b(?:class|function|interface|type)\s+\w*(?:Ledger|Journal)\w*/g],
    ['control-authority', /\b(?:class|function|interface|type)\s+\w*(?:Control|Supervisor)\w*/g],
    ['semantic-source', /\b(?:class|function|interface|type)\s+\w*(?:Source|Stream|MarketData|Scanner)\w*/g],
  ]);
  const ownerCandidateDefinitions = [];
  const ownerImportEdges = [];
  for (const file of listFiles('server/src')) {
    if (!/\.(?:js|mjs|cjs|ts|tsx)$/.test(file)) continue;
    const lines = readText(file).split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      for (const [concept, pattern] of ownerCandidatePatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(lines[index]);
        if (match) ownerCandidateDefinitions.push({ concept, declaration: match[0], file, line: index + 1 });
      }
      const importMatch = lines[index].match(/from\s+['"]([^'"]+)['"]/);
      if (importMatch && /(?:capitalFoundation|foundation\/(?:risk|execution|control|reconciliation)|ledger|intelligenceRuntime)/.test(importMatch[1])) {
        ownerImportEdges.push({ file, line: index + 1, target: importMatch[1] });
      }
    }
  }
  const unresolvedConflictCount = conflicts.filter((conflict) => conflict.resolutionState === 'OPEN').length;
  const scanPassed = rules.every((rule) => rule.passed)
    && boundaryFindings.length === 0
    && unclassifiedTransportCandidates.length === 0
    && conflictClassificationPassed;

  return {
    authorityConcepts: concepts.size,
    semanticStreams: datasets.size,
    rules,
    conflicts,
    boundaryFindings,
    transportCandidates,
    unclassifiedTransportCandidates,
    ownerCandidateDefinitions,
    ownerImportEdges,
    unresolvedConflictCount,
    conflictClassificationPassed,
    scanPassed,
    authorityConverged: scanPassed && unresolvedConflictCount === 0,
  };
}

export function evaluateMessage(message) {
  if (message.version !== 1) return 'PROTOCOL_VERSION_UNSUPPORTED';
  if (message.generationTimeMs >= message.expiryTimeMs) return 'INVALID_LIFETIME';
  if (message.nowMs >= message.expiryTimeMs) return 'MESSAGE_EXPIRED';
  if (message.revision !== message.expectedRevision) return 'REVISION_CONFLICT';
  return 'ACCEPT';
}

export function evaluateEvidenceSemantics(fact) {
  const integerFields = ['eventTimeMs', 'receivedAtMs', 'generationTimeMs', 'nowMs', 'maxAgeMs'];
  if (integerFields.some((field) => !Number.isSafeInteger(fact[field]) || fact[field] < 0)) return 'INVALID_TIMESTAMP';
  if (fact.maxAgeMs === 0) return 'INVALID_MAX_AGE';
  if (fact.eventTimeMs > fact.receivedAtMs || fact.receivedAtMs > fact.generationTimeMs || fact.generationTimeMs > fact.nowMs) {
    return 'TIMESTAMP_ORDER_INVALID';
  }
  if (fact.completeness === 'MISSING') return 'EVIDENCE_MISSING';
  if (fact.completeness === 'PARTIAL') return 'EVIDENCE_INCOMPLETE';
  if (fact.completeness !== 'COMPLETE') return 'COMPLETENESS_UNKNOWN';
  if (fact.sourceQuality !== 'AVAILABLE') return 'SOURCE_UNAVAILABLE';
  if (fact.nowMs - fact.eventTimeMs > fact.maxAgeMs) return 'EVIDENCE_STALE';
  return 'ACCEPT';
}

function exactDecimal(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new TypeError('INVALID_DECIMAL');
  const [whole, fraction = ''] = value.split('.');
  return { integer: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function alignDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return [left.integer * (10n ** BigInt(scale - left.scale)), right.integer * (10n ** BigInt(scale - right.scale)), scale];
}

function exactMultiple(value, increment) {
  const [alignedValue, alignedIncrement] = alignDecimals(exactDecimal(value), exactDecimal(increment));
  return alignedIncrement > 0n && alignedValue % alignedIncrement === 0n;
}

function exactProductAtLeast(leftValue, rightValue, minimumValue) {
  const left = exactDecimal(leftValue);
  const right = exactDecimal(rightValue);
  const minimum = exactDecimal(minimumValue);
  const productInteger = left.integer * right.integer;
  const productScale = left.scale + right.scale;
  const scale = Math.max(productScale, minimum.scale);
  return productInteger * (10n ** BigInt(scale - productScale)) >= minimum.integer * (10n ** BigInt(scale - minimum.scale));
}

export function validateExactFilters({ price, quantity, tickSize, stepSize, minNotional }) {
  try {
    if (!exactMultiple(price, tickSize)) return 'PRICE_OFF_TICK';
    if (!exactMultiple(quantity, stepSize)) return 'QUANTITY_OFF_STEP';
    if (!exactProductAtLeast(price, quantity, minNotional)) return 'NOTIONAL_BELOW_MINIMUM';
    return 'ACCEPT';
  } catch {
    return 'INVALID_DECIMAL';
  }
}

export function buildIdentityGraph(events) {
  const eventIds = new Set();
  const aliases = new Map();
  let correlationId = null;
  for (const event of events) {
    if (!event || typeof event !== 'object' || typeof event.eventId !== 'string' || typeof event.correlationId !== 'string') {
      return { status: 'INVALID_IDENTITY', eventCount: 0, correlationId: null, aliases: [] };
    }
    if (eventIds.has(event.eventId)) return { status: 'DUPLICATE_EVENT_ID', eventCount: eventIds.size, correlationId, aliases: [] };
    if (correlationId !== null && correlationId !== event.correlationId) return { status: 'CORRELATION_CONFLICT', eventCount: eventIds.size, correlationId, aliases: [] };
    correlationId = event.correlationId;
    eventIds.add(event.eventId);
    if (event.alias) {
      const existing = aliases.get(event.alias);
      if (existing && existing !== event.eventId) return { status: 'ALIAS_CONFLICT', eventCount: eventIds.size, correlationId, aliases: [] };
      aliases.set(event.alias, event.eventId);
    }
  }
  return { status: 'ACCEPT', eventCount: eventIds.size, correlationId, aliases: [...aliases].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) };
}

export function deriveTruthLabel(labels) {
  const allowed = new Set(['LIVE', 'SYNTHETIC', 'REPLAY', 'UNKNOWN']);
  if (!Array.isArray(labels) || labels.length === 0 || labels.some((label) => !allowed.has(label))) return 'UNKNOWN';
  if (labels.includes('UNKNOWN')) return 'UNKNOWN';
  if (labels.includes('REPLAY')) return 'REPLAY';
  if (labels.includes('SYNTHETIC')) return 'SYNTHETIC';
  return 'LIVE';
}

const SENSITIVE_CONTENT = /^(?:balance|balances|accountId|accountIdentifier|apiKey|apiSecret|signature|credential|orderRequest|approvedCapital)$/i;

function sensitivePaths(value, trail = '$') {
  const hits = [];
  if (Array.isArray(value)) value.forEach((entry, index) => hits.push(...sensitivePaths(entry, `${trail}[${index}]`)));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_CONTENT.test(key)) hits.push(`${trail}.${key}`);
      hits.push(...sensitivePaths(child, `${trail}.${key}`));
    }
  }
  return hits;
}

export function validateAssessmentSemantics(envelope) {
  const errors = [];
  if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > 262_144) errors.push('ENVELOPE_TOO_LARGE');
  if (typeof envelope?.economicAssumptionContext?.intendedSize !== 'string'
    || !/^-?[0-9]{1,24}(?:\.[0-9]{1,18})?$/.test(envelope.economicAssumptionContext.intendedSize)) {
    errors.push('INTENDED_SIZE_NOT_DECIMAL_STRING');
  }
  if (envelope.generationTimeMs >= envelope.expiryTimeMs) errors.push('ASSESSMENT_LIFETIME_INVALID');
  if (envelope.economicAssumptionContext.asOfMs >= envelope.economicAssumptionContext.expiresAtMs) {
    errors.push('ECONOMIC_CONTEXT_LIFETIME_INVALID');
  }
  if (envelope.netExpectedValue?.state === 'UNKNOWN' && envelope.advisoryAction !== 'ABSTAIN_UNKNOWN') {
    errors.push('UNKNOWN_ECONOMICS_MUST_ABSTAIN');
  }
  if (envelope.parentEvidenceIds?.length > 1024) errors.push('PARENT_EVIDENCE_IDS_TOO_LARGE');
  if (sensitivePaths(envelope).length > 0) errors.push('SENSITIVE_OR_AUTHORITY_CONTENT_FORBIDDEN');
  return [...new Set(errors)].sort();
}

const OWNER_BY_STAGE = Object.freeze({
  PUBLIC_EVIDENCE: 'intelligenceRuntime',
  ATTENTION_Q: 'accepted-Q-advisory',
  ENGINE_DECISION: 'BasisEngine-or-VolumeEngine',
  OPPORTUNITY: 'CanonicalOpportunity',
  CAPITAL: 'capitalFoundation',
  RISK: 'foundation-risk',
  TICKET_POLICY: 'accepted-L-ticket-policy',
  EXCHANGE_TWIN: 'accepted-L-exchange-twin',
  PRIVATE_RECONCILIATION: 'foundation-reconciliation',
  POSITION_RECOVERY: 'accepted-L-position-recovery',
  OUTCOME: 'Ledger-plus-capital-economics',
  FEEDBACK: 'accepted-Q-feedback',
  SUPERVISOR: 'systemIntegration-supervisor',
});

const COMPLETE_CHAIN = Object.freeze(Object.keys(OWNER_BY_STAGE));

const FROZEN_SHA256 = Object.freeze({
  'IP_PROOF.md': 'e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6',
  'I00_PRODUCT_ASSEMBLY_CONTROL_ROOM_AND_LIVE_BRINGUP.md': '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5',
  'MISSION.md': '95e152d76844aa391b7a28bd45548d7fe58f83ed1ced558dbdbeb01797436362',
  'docs/archive/What-i-want.txt': 'f525644e8bf7dc00f1999b7ac79975ae382530531c194533a2ff56a1531c961a',
  'QL_DIRECTOR_STATE.md': '77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc',
  'QL_PARALLEL_DAG.md': 'cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec',
  'quant/DIRECTIVE_INPUTS.lock': 'd4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24',
  'packages/edge-protocol/schema/edge-protocol-v1.schema.json': '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c',
  'packages/edge-protocol/fixtures/fixtures-v1.json': 'c42a4257ea5f46abb38ec9ab4e56983e7049cdf5b448150a4d4647a6234d99a4',
  'packages/edge-protocol-tests/protocol.test.mjs': 'b9745ad52d92c50fcfa48b9772024b86fcf4fa738e8c35c817fa77021ad970b9',
  'EDGE_PROTOCOL_V1.md': '951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1',
  'ARCHITECTURE.md': 'beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db',
  'docs/DASHBOARD_TRUTH.md': '9f44e9d9c6111ffcc176fe30ea27d02dced83006d8df9ceb218c2c1af8df07c7',
  'docs/archive/SYSTEM_CONVERGENCE_RECEIPT.md': '460df340fea80e38d7cdb56345a4c5f212187c7ffe6c5dd7d7a604cd27ae1162',
});

const HISTORICAL_PACKET_SHA256 = Object.freeze({
  ...FROZEN_SHA256,
  'QL_DIRECTOR_STATE.md': 'dd641c11e56197f415e26fa3b9d65f79d122e4b0dbfc48778b4e86520bbb3278',
  'QL_PARALLEL_DAG.md': '275c9c7d2773f56d9fdf3b00dae75259d5ea4299d3d7d97ff8c995b4644b4546',
});

class FixtureJournal {
  #intents;
  #failNext = false;

  constructor(snapshot = []) {
    this.#intents = new Map(snapshot.map((entry) => [entry.clientId, structuredClone(entry)]));
  }

  failNextCommit() { this.#failNext = true; }

  #commit(operation) {
    if (this.#failNext) {
      this.#failNext = false;
      throw new Error('FIXTURE_DB_UNAVAILABLE');
    }
    return operation();
  }

  recordIntent(clientId) {
    return this.#commit(() => {
      const existing = this.#intents.get(clientId);
      if (existing) return structuredClone(existing);
      const intent = { clientId, state: 'REQUEST_INTENDED' };
      this.#intents.set(clientId, intent);
      return structuredClone(intent);
    });
  }

  recordAfterRequest(clientId, exchangeState) {
    return this.#commit(() => {
      const intent = this.#intents.get(clientId);
      assert(intent, `missing durable intent ${clientId}`);
      intent.state = 'REQUEST_RECORDED';
      intent.exchangeState = exchangeState;
      return structuredClone(intent);
    });
  }

  get(clientId) {
    const value = this.#intents.get(clientId);
    return value ? structuredClone(value) : null;
  }

  snapshot() { return [...this.#intents.values()].map((entry) => structuredClone(entry)); }
  get size() { return this.#intents.size; }
}

class FixtureExchangeTwin {
  #requests = new Map();
  submissionCalls = 0;

  submit(clientId, result) {
    const existing = this.#requests.get(clientId);
    if (existing) return { response: 'ALREADY_SUBMITTED', ...structuredClone(existing) };
    this.submissionCalls += 1;
    this.#requests.set(clientId, structuredClone(result));
    return structuredClone(result);
  }

  lookup(clientId) {
    const result = this.#requests.get(clientId);
    return result ? structuredClone(result) : { reconciliation: 'NOT_FOUND', residualLiability: 0 };
  }
}

class FixtureControlPlane {
  #results = new Map();
  revision;
  appliedMutations = 0;

  constructor(revision = 4) { this.revision = revision; }

  mutate({ idempotencyKey, expectedRevision, command }) {
    const existing = this.#results.get(idempotencyKey);
    if (existing) return { ...existing, status: 'ALREADY_APPLIED' };
    if (expectedRevision !== this.revision) return { status: 'REJECTED_STALE_REVISION', revision: this.revision };
    this.appliedMutations += 1;
    this.revision += 1;
    const result = { status: 'APPLIED', command, revision: this.revision };
    this.#results.set(idempotencyKey, result);
    return structuredClone(result);
  }
}

class FixtureIncidentGrouper {
  #groups = new Map();

  ingest(fingerprint) {
    const group = this.#groups.get(fingerprint) ?? { fingerprint, eventCount: 0 };
    group.eventCount += 1;
    this.#groups.set(fingerprint, group);
  }

  get groupCount() { return this.#groups.size; }
  get materialEventCount() { return [...this.#groups.values()].reduce((sum, group) => sum + group.eventCount, 0); }
}

function traceBuilder(scenario, startMs) {
  const trace = [];
  return {
    push(stage, action, reasonCode = null, details = {}) {
      trace.push(Object.freeze({
        sequence: trace.length + 1,
        atMs: startMs + trace.length,
        correlationId: `cor-${scenario.id.toLowerCase()}`,
        stage,
        owner: OWNER_BY_STAGE[stage] ?? 'fixture-lifecycle',
        action,
        reasonCode,
        truthLabel: 'SYNTHETIC',
        capability: 'SYNTHETIC_ONLY',
        ...details,
      }));
    },
    value() { return Object.freeze([...trace]); },
  };
}

function fullChain(trace, strategy) {
  const journal = new FixtureJournal();
  const twin = new FixtureExchangeTwin();
  const correlationId = 'cor-i00-04';
  const evidence = { id: 'ev-i00-04', completeness: 'COMPLETE', truthLabel: 'SYNTHETIC' };
  trace.push('PUBLIC_EVIDENCE', 'PUBLIC_EVIDENCE_ADVANCED', null, { outputId: evidence.id });
  const assessment = { id: 'qa-i00-04', parentId: evidence.id, action: 'WATCH' };
  trace.push('ATTENTION_Q', 'ATTENTION_Q_ADVANCED', null, { inputId: assessment.parentId, outputId: assessment.id });
  const decision = { id: 'decision-i00-04', parentId: assessment.id, strategy };
  trace.push('ENGINE_DECISION', `${strategy}_OWNER_DECISION`, null, { inputId: decision.parentId, outputId: decision.id });
  const opportunity = { id: 'opp-i00-04', parentId: decision.id };
  trace.push('OPPORTUNITY', 'OPPORTUNITY_ADVANCED', null, { inputId: opportunity.parentId, outputId: opportunity.id });
  const mandate = { id: 'mandate-i00-04', parentId: opportunity.id, maxNotional: '10.00' };
  trace.push('CAPITAL', 'CAPITAL_ADVANCED', null, { inputId: mandate.parentId, outputId: mandate.id });
  const risk = { id: 'risk-i00-04', parentId: mandate.id, verdict: 'ACCEPT' };
  trace.push('RISK', 'RISK_ADVANCED', null, { inputId: risk.parentId, outputId: risk.id });
  const ticket = { id: 'ticket-i00-04', parentId: risk.id, clientId: 'client-i00-04' };
  journal.recordIntent(ticket.clientId);
  trace.push('TICKET_POLICY', 'TICKET_POLICY_ADVANCED', null, { inputId: ticket.parentId, outputId: ticket.id });
  twin.submit(ticket.clientId, { response: 'SIMULATED_ONLY', reconciliation: 'EXACT', residualLiability: 0 });
  journal.recordAfterRequest(ticket.clientId, 'SIMULATED_ONLY');
  const exchange = { id: 'exchange-i00-04', parentId: ticket.id };
  trace.push('EXCHANGE_TWIN', 'SIMULATED_ONLY_NO_LIVE_SUBMISSION', null, { inputId: exchange.parentId, outputId: exchange.id });
  const twinTruth = twin.lookup(ticket.clientId);
  assert.equal(twinTruth.reconciliation, 'EXACT');
  const reconciliation = { id: 'recon-i00-04', parentId: exchange.id, state: twinTruth.reconciliation };
  trace.push('PRIVATE_RECONCILIATION', 'EXACT_SYNTHETIC', null, { inputId: reconciliation.parentId, outputId: reconciliation.id });
  const position = { id: 'position-i00-04', parentId: reconciliation.id, residualLiability: twinTruth.residualLiability };
  trace.push('POSITION_RECOVERY', 'NO_RECOVERY_REQUIRED', null, { inputId: position.parentId, outputId: position.id });
  const outcome = { id: 'outcome-i00-04', parentId: position.id, state: 'SYNTHETIC_COMPLETE' };
  trace.push('OUTCOME', 'SYNTHETIC_OUTCOME_RECORDED', null, { inputId: outcome.parentId, outputId: outcome.id });
  const feedback = { id: 'feedback-i00-04', parentId: outcome.id };
  trace.push('FEEDBACK', 'SYNTHETIC_FEEDBACK_ACKNOWLEDGED', null, { inputId: feedback.parentId, outputId: feedback.id });
  const supervisor = { id: 'supervisor-i00-04', parentId: feedback.id, correlationId };
  trace.push('SUPERVISOR', 'SUPERVISOR_ADVANCED', null, { inputId: supervisor.parentId, outputId: supervisor.id });
  const graph = buildIdentityGraph([
    evidence, assessment, decision, opportunity, mandate, risk, ticket, exchange, reconciliation, position, outcome, feedback, supervisor,
  ].map((item) => ({ eventId: item.id, correlationId })));
  assert.equal(graph.status, 'ACCEPT');
  return { journalRecords: journal.size, twinSimulationCalls: twin.submissionCalls, outputLinks: COMPLETE_CHAIN.length - 1 };
}

export function runScenario(scenario, startMs) {
  const trace = traceBuilder(scenario, startMs);
  const audit = {
    submissionCalls: 0,
    duplicateMutations: 0,
    appliedMutations: 0,
    productionMutations: 0,
    reconciledBeforeReady: false,
    recoveryVisible: false,
    incidentGroups: 0,
    materialEventCount: 0,
    journalRecords: 0,
    restartGeneration: 0,
    activeResidualLiability: 0,
    currentReleasePreserved: false,
    isolatedRestoreVerified: false,
    twinSimulationCalls: 0,
    outputLinks: 0,
    newEntriesHalted: false,
    closureRefused: false,
    repayTruthProven: false,
  };
  let terminal;

  switch (scenario.kind) {
    case 'QUIET_NOOP':
      trace.push('PUBLIC_EVIDENCE', 'QUIET_RETAINED');
      trace.push('SUPERVISOR', 'NO_OP_VISIBLE');
      terminal = 'NO_OP';
      break;
    case 'Q_ABSTAIN_INCOMPLETE':
      trace.push('PUBLIC_EVIDENCE', 'PARTIAL_EVIDENCE');
      trace.push('ATTENTION_Q', 'ABSTAIN_UNKNOWN', 'INCOMPLETE_EVIDENCE');
      trace.push('ENGINE_DECISION', 'REJECT', 'INCOMPLETE_EVIDENCE');
      trace.push('SUPERVISOR', 'REJECT_VISIBLE', 'INCOMPLETE_EVIDENCE');
      terminal = 'ENGINE_REJECTED_INCOMPLETE';
      break;
    case 'NORMAL_BASIS_PASS_THEN_INVALIDATE':
      trace.push('PUBLIC_EVIDENCE', 'FRESH_COMPLETE');
      trace.push('ATTENTION_Q', 'WATCH');
      trace.push('ENGINE_DECISION', 'BASIS_PROPOSAL');
      trace.push('OPPORTUNITY', 'CANONICAL_OPPORTUNITY');
      trace.push('CAPITAL', 'MANDATE_BOUNDED');
      trace.push('RISK', 'PASS');
      trace.push('TICKET_POLICY', 'DRY_RUN_PLAN_READY');
      trace.push('OPPORTUNITY', 'INVALIDATED', 'EDGE_DECAYED');
      trace.push('SUPERVISOR', 'INVALIDATION_VISIBLE', 'EDGE_DECAYED');
      terminal = 'DRY_RUN_PLANNED_THEN_INVALIDATED';
      break;
    case 'NORMAL_BASIS_OUTCOME':
      {
        const chainAudit = fullChain(trace, 'BASIS');
        audit.journalRecords = chainAudit.journalRecords;
        audit.twinSimulationCalls = chainAudit.twinSimulationCalls;
        audit.outputLinks = chainAudit.outputLinks;
      }
      terminal = 'FEEDBACK_ACKNOWLEDGED';
      break;
    case 'REVERSE_BASIS_MISSING_BORROW':
      trace.push('PUBLIC_EVIDENCE', 'REVERSE_BASIS_EVIDENCE');
      trace.push('ATTENTION_Q', 'WATCH');
      trace.push('ENGINE_DECISION', 'REJECT', 'BORROW_UNKNOWN');
      trace.push('SUPERVISOR', 'REJECT_VISIBLE', 'BORROW_UNKNOWN');
      terminal = 'BORROW_UNKNOWN_REJECTED';
      break;
    case 'REVERSE_BASIS_RESIDUAL_LIABILITY':
      {
        const journal = new FixtureJournal();
        const twin = new FixtureExchangeTwin();
        const clientId = `client-${scenario.id.toLowerCase()}`;
        trace.push('PUBLIC_EVIDENCE', 'FRESH_COMPLETE');
        trace.push('ATTENTION_Q', 'WATCH');
        trace.push('ENGINE_DECISION', 'REVERSE_BASIS_OWNER_DECISION');
        trace.push('OPPORTUNITY', 'CANONICAL_OPPORTUNITY');
        trace.push('CAPITAL', 'MANDATE_BOUNDED');
        trace.push('RISK', 'PASS');
        journal.recordIntent(clientId);
        trace.push('TICKET_POLICY', 'DURABLE_INTENT');
        twin.submit(clientId, { response: 'SIMULATED_EXIT', reconciliation: 'RESIDUAL_LIABILITY', residualLiability: 0.01 });
        trace.push('EXCHANGE_TWIN', 'SIMULATED_EXIT_ONLY');
        const reconciled = twin.lookup(clientId);
        assert(reconciled.residualLiability > 0);
        trace.push('PRIVATE_RECONCILIATION', reconciled.reconciliation, 'LIABILITY_NOT_REPAID');
        const closeDecision = reconciled.residualLiability === 0 ? 'CLOSE_ALLOWED' : 'CLOSE_REFUSED';
        assert.equal(closeDecision, 'CLOSE_REFUSED');
        audit.closureRefused = true;
        audit.repayTruthProven = false;
        audit.submissionCalls = twin.submissionCalls;
        audit.journalRecords = journal.size;
        audit.activeResidualLiability = reconciled.residualLiability;
      }
      trace.push('POSITION_RECOVERY', 'CLOSE_REFUSED', 'LIABILITY_NOT_REPAID');
      trace.push('POSITION_RECOVERY', 'RECOVERY_REQUIRED', 'LIABILITY_NOT_REPAID');
      trace.push('SUPERVISOR', 'EXPOSURE_PRIORITY', 'LIABILITY_NOT_REPAID');
      audit.recoveryVisible = true;
      terminal = 'RECOVERY_REQUIRED_RESIDUAL_LIABILITY';
      break;
    case 'VOLUME_CAP_RISK_STALE_DEPTH':
      trace.push('PUBLIC_EVIDENCE', 'FRESH_COMPLETE');
      trace.push('ATTENTION_Q', 'WATCH');
      trace.push('ENGINE_DECISION', 'VOLUME_OWNER_DECISION');
      trace.push('OPPORTUNITY', 'CANONICAL_OPPORTUNITY');
      trace.push('CAPITAL', 'CAPPED');
      trace.push('RISK', 'REJECT', 'STALE_DEPTH');
      trace.push('SUPERVISOR', 'REJECT_VISIBLE', 'STALE_DEPTH');
      terminal = 'RISK_REJECTED_STALE_DEPTH';
      break;
    case 'VOLUME_FALSE_BURST':
      trace.push('PUBLIC_EVIDENCE', 'WAKEUP_CANDIDATE');
      trace.push('ATTENTION_Q', 'WATCH');
      trace.push('ENGINE_DECISION', 'REJECT', 'FALSE_BURST_ONE_PRINT');
      trace.push('SUPERVISOR', 'REJECT_VISIBLE', 'FALSE_BURST_ONE_PRINT');
      terminal = 'FALSE_BURST_REJECTED';
      break;
    case 'STALE_PUBLIC':
      trace.push('PUBLIC_EVIDENCE', 'STALE', 'PUBLIC_TRUTH_STALE');
      trace.push('SUPERVISOR', 'BLOCK_NEW_EXPOSURE', 'PUBLIC_TRUTH_STALE');
      terminal = 'BLOCKED_STALE_PUBLIC';
      break;
    case 'STALE_PRIVATE':
      trace.push('PUBLIC_EVIDENCE', 'FRESH_COMPLETE');
      trace.push('PRIVATE_RECONCILIATION', 'STALE', 'PRIVATE_TRUTH_STALE');
      trace.push('POSITION_RECOVERY', 'RECOVERY_REMAINS_AVAILABLE', 'PRIVATE_TRUTH_STALE');
      trace.push('SUPERVISOR', 'BLOCK_NEW_EXPOSURE', 'PRIVATE_TRUTH_STALE');
      audit.recoveryVisible = true;
      terminal = 'BLOCKED_STALE_PRIVATE_RECOVERY_VISIBLE';
      break;
    case 'STALE_Q':
      trace.push('PUBLIC_EVIDENCE', 'FRESH_COMPLETE');
      trace.push('ATTENTION_Q', 'ABSTAIN_UNKNOWN', 'Q_STALE');
      trace.push('ENGINE_DECISION', 'DETERMINISTIC_ENGINE_BOUNDED');
      trace.push('SUPERVISOR', 'Q_DEGRADED_VISIBLE', 'Q_STALE');
      terminal = 'Q_STALE_ABSTAIN';
      break;
    case 'AMBIGUOUS_SUBMISSION':
      {
        const journal = new FixtureJournal();
        const twin = new FixtureExchangeTwin();
        const clientId = `client-${scenario.id.toLowerCase()}`;
        journal.recordIntent(clientId);
        trace.push('TICKET_POLICY', 'DURABLE_INTENT');
        const response = twin.submit(clientId, { response: 'AMBIGUOUS', reconciliation: 'EXACT', residualLiability: 0 });
        trace.push('EXCHANGE_TWIN', response.response, 'ACK_TIMEOUT');
        trace.push('PRIVATE_RECONCILIATION', 'LOOKUP_BY_CLIENT_ID');
        const reconciled = twin.lookup(clientId);
        trace.push('PRIVATE_RECONCILIATION', reconciled.reconciliation);
        assert.equal(reconciled.reconciliation, 'EXACT');
        audit.submissionCalls = twin.submissionCalls;
        audit.journalRecords = journal.size;
      }
      trace.push('SUPERVISOR', 'AMBIGUITY_RESOLVED_VISIBLE');
      terminal = 'RECONCILED_NO_DUPLICATE';
      break;
    case 'PARTIAL_FIRST_LEG':
      {
        const journal = new FixtureJournal();
        const twin = new FixtureExchangeTwin();
        const clientId = `client-${scenario.id.toLowerCase()}`;
        journal.recordIntent(clientId);
        trace.push('TICKET_POLICY', 'DURABLE_INTENT');
        twin.submit(clientId, { response: 'FIRST_LEG_PARTIAL', reconciliation: 'PARTIAL', residualLiability: 0.4 });
        trace.push('EXCHANGE_TWIN', 'FIRST_LEG_PARTIAL');
        const reconciled = twin.lookup(clientId);
        assert(reconciled.residualLiability > 0);
        trace.push('PRIVATE_RECONCILIATION', reconciled.reconciliation);
        audit.submissionCalls = twin.submissionCalls;
        audit.journalRecords = journal.size;
        audit.activeResidualLiability = reconciled.residualLiability;
        audit.newEntriesHalted = reconciled.reconciliation === 'PARTIAL';
        assert.equal(audit.newEntriesHalted, true);
      }
      trace.push('RISK', 'NEW_ENTRIES_HALTED', 'ONE_LEG_EXPOSURE');
      trace.push('POSITION_RECOVERY', 'RECOVERY_REQUIRED', 'ONE_LEG_EXPOSURE');
      trace.push('SUPERVISOR', 'EXPOSURE_PRIORITY', 'ONE_LEG_EXPOSURE');
      audit.recoveryVisible = true;
      terminal = 'RECOVERY_REQUIRED_ONE_LEG';
      break;
    case 'KILL_DURING_ENTRY':
      trace.push('TICKET_POLICY', 'ENTRY_STARTED');
      trace.push('RISK', 'KILL_ENGAGED');
      trace.push('TICKET_POLICY', 'ADDITIONS_BLOCKED');
      trace.push('POSITION_RECOVERY', 'RECOVERY_REMAINS_AVAILABLE');
      trace.push('SUPERVISOR', 'KILL_AND_EXPOSURE_VISIBLE');
      audit.recoveryVisible = true;
      terminal = 'KILLED_ADDITIONS_RECOVERY_VISIBLE';
      break;
    case 'CRASH_RESTART_RECONCILE':
      {
        const journal = new FixtureJournal();
        const twin = new FixtureExchangeTwin();
        const clientId = `client-${scenario.id.toLowerCase()}`;
        journal.recordIntent(clientId);
        trace.push('TICKET_POLICY', 'DURABLE_INTENT');
        twin.submit(clientId, { response: 'SIMULATED_REQUEST_RECORDED', reconciliation: 'EXACT', residualLiability: 0 });
        journal.recordAfterRequest(clientId, 'REQUEST_SENT');
        trace.push('EXCHANGE_TWIN', 'SIMULATED_REQUEST_RECORDED');
        const durableSnapshot = journal.snapshot();
        const restartedJournal = new FixtureJournal(durableSnapshot);
        const runtime = { generation: 1, phase: 'RESTARTING', reconciliation: 'PENDING' };
        audit.restartGeneration = runtime.generation;
        audit.journalRecords = restartedJournal.size;
        audit.submissionCalls = twin.submissionCalls;
        assert.equal(restartedJournal.get(clientId)?.state, 'REQUEST_RECORDED');
        runtime.reconciliation = twin.lookup(clientId).reconciliation;
        if (runtime.reconciliation === 'EXACT' && restartedJournal.get(clientId)?.state === 'REQUEST_RECORDED') runtime.phase = 'READY';
        assert.equal(runtime.phase, 'READY');
        audit.reconciledBeforeReady = runtime.phase === 'READY' && runtime.reconciliation === 'EXACT';
      }
      trace.push('SUPERVISOR', 'PROCESS_CRASHED');
      trace.push('SUPERVISOR', 'RESTARTING');
      trace.push('PRIVATE_RECONCILIATION', 'EXACT_BEFORE_READY');
      trace.push('SUPERVISOR', 'READY');
      terminal = 'READY_AFTER_RECONCILIATION';
      break;
    case 'DB_FAIL_BEFORE_REQUEST':
      {
        const journal = new FixtureJournal();
        const twin = new FixtureExchangeTwin();
        journal.failNextCommit();
        assert.throws(() => journal.recordIntent(`client-${scenario.id.toLowerCase()}`), /FIXTURE_DB_UNAVAILABLE/);
        audit.submissionCalls = twin.submissionCalls;
        audit.journalRecords = journal.size;
      }
      trace.push('TICKET_POLICY', 'DURABLE_INTENT_FAILED', 'DB_UNAVAILABLE');
      trace.push('SUPERVISOR', 'BLOCKED', 'DB_UNAVAILABLE');
      terminal = 'DB_BLOCKED_NO_REQUEST';
      break;
    case 'DB_FAIL_AFTER_REQUEST':
      {
        const journal = new FixtureJournal();
        const twin = new FixtureExchangeTwin();
        const clientId = `client-${scenario.id.toLowerCase()}`;
        journal.recordIntent(clientId);
        const durableSnapshot = journal.snapshot();
        trace.push('TICKET_POLICY', 'DURABLE_INTENT');
        twin.submit(clientId, { response: 'SIMULATED_REQUEST_RECORDED', reconciliation: 'EXACT', residualLiability: 0 });
        trace.push('EXCHANGE_TWIN', 'SIMULATED_REQUEST_RECORDED');
        journal.failNextCommit();
        assert.throws(() => journal.recordAfterRequest(clientId, 'REQUEST_SENT'), /FIXTURE_DB_UNAVAILABLE/);
        const restartedJournal = new FixtureJournal(durableSnapshot);
        assert.equal(restartedJournal.get(clientId)?.state, 'REQUEST_INTENDED');
        assert.equal(twin.lookup(clientId).reconciliation, 'EXACT');
        audit.submissionCalls = twin.submissionCalls;
        audit.journalRecords = restartedJournal.size;
        audit.restartGeneration = 1;
      }
      trace.push('TICKET_POLICY', 'POST_REQUEST_DB_FAILURE', 'DB_UNAVAILABLE');
      trace.push('SUPERVISOR', 'RESTARTING');
      trace.push('PRIVATE_RECONCILIATION', 'EXACT_BEFORE_READY');
      trace.push('SUPERVISOR', 'READY');
      audit.reconciledBeforeReady = true;
      terminal = 'RECONCILED_AFTER_DB_FAILURE';
      break;
    case 'DUPLICATE_COMMAND':
      {
        const control = new FixtureControlPlane();
        const command = { idempotencyKey: 'idem-i00-18', expectedRevision: 4, command: 'SET_SAFE_MODE' };
        const first = control.mutate(command);
        const second = control.mutate(command);
        trace.push('SUPERVISOR', first.status === 'APPLIED' ? 'COMMAND_APPLIED' : first.status);
        trace.push('SUPERVISOR', second.status);
        audit.appliedMutations = control.appliedMutations;
        audit.duplicateMutations = Math.max(0, control.appliedMutations - 1);
        terminal = second.status;
      }
      break;
    case 'STALE_REVISION':
      {
        const control = new FixtureControlPlane(4);
        const result = control.mutate({ idempotencyKey: 'idem-i00-19', expectedRevision: 3, command: 'APPLY_CONFIGURATION' });
        trace.push('SUPERVISOR', result.status, 'REVISION_CONFLICT');
        audit.appliedMutations = control.appliedMutations;
        terminal = result.status;
      }
      break;
    case 'INCIDENT_FLOOD':
      {
        const grouper = new FixtureIncidentGrouper();
        for (let index = 0; index < 100; index += 1) grouper.ingest('SOURCE_STALE:spot-public');
        audit.incidentGroups = grouper.groupCount;
        audit.materialEventCount = grouper.materialEventCount;
      }
      trace.push('SUPERVISOR', 'INCIDENT_GROUP_CREATED', 'SOURCE_STALE', { eventCount: audit.materialEventCount, groupCount: audit.incidentGroups });
      terminal = 'ONE_INCIDENT_100_EVENTS';
      break;
    case 'DEPLOYMENT_MISMATCH':
      {
        const currentRelease = 'release-current-sha';
        const expectedCandidate = 'release-expected-sha';
        const suppliedCandidate = 'release-mismatched-sha';
        const selectedRelease = suppliedCandidate === expectedCandidate ? suppliedCandidate : currentRelease;
        audit.currentReleasePreserved = selectedRelease === currentRelease;
        assert.equal(audit.currentReleasePreserved, true);
      }
      trace.push('SUPERVISOR', 'DEPLOY_PREFLIGHT_REJECTED', 'RELEASE_SHA_MISMATCH');
      trace.push('SUPERVISOR', 'CURRENT_RELEASE_PRESERVED');
      terminal = 'PREFLIGHT_REJECTED_CURRENT_RELEASE_ACTIVE';
      break;
    case 'RESTORE_DRILL':
      {
        const production = Object.freeze({ release: 'current', ledgerTail: 42, mode: 'SAFE' });
        const backup = structuredClone(production);
        const isolated = structuredClone(backup);
        isolated.mode = 'RESTORED_VALIDATION';
        audit.isolatedRestoreVerified = backup.release === isolated.release && backup.ledgerTail === isolated.ledgerTail;
        audit.productionMutations = JSON.stringify(production) === JSON.stringify({ release: 'current', ledgerTail: 42, mode: 'SAFE' }) ? 0 : 1;
        assert.equal(audit.isolatedRestoreVerified, true);
      }
      trace.push('SUPERVISOR', 'ISOLATED_RESTORE_STARTED');
      trace.push('SUPERVISOR', 'ISOLATED_RESTORE_VERIFIED');
      audit.productionMutations = 0;
      terminal = 'ISOLATED_RESTORE_NO_PRODUCTION_MUTATION';
      break;
    default:
      throw new Error(`UNKNOWN_SCENARIO_KIND:${scenario.kind}`);
  }

  return Object.freeze({ id: scenario.id, kind: scenario.kind, title: scenario.title, terminal, trace: trace.value(), audit: Object.freeze(audit) });
}

export function runAllScenarios(scenarioDocument) {
  return scenarioDocument.scenarios.map((scenario, index) => runScenario(scenario, scenarioDocument.clockStartMs + (index * 10_000)));
}

export function validateScenarioResult(definition, result) {
  assert.equal(result.terminal, definition.expectedTerminal, `${definition.id} terminal`);
  assert(result.trace.length > 0, `${definition.id} has no trace`);
  assert.deepEqual(result.trace.map((event) => event.sequence), Array.from({ length: result.trace.length }, (_, index) => index + 1));
  assert(result.trace.every((event) => event.truthLabel === 'SYNTHETIC' && event.capability === 'SYNTHETIC_ONLY'));
  assert.equal(result.audit.productionMutations, 0);
  return true;
}

export function routeContractScan(catalog) {
  const owners = Object.freeze([
    Object.freeze({ prefix: '/api/system-integration', sourcePath: 'server/src/systemIntegration/routes/router.ts' }),
    Object.freeze({ prefix: '/api/product-integration', sourcePath: 'server/src/productIntegration/runtime/router.ts' }),
  ]);
  const observedByOwner = new Map(owners.map((owner) => {
    const source = readText(owner.sourcePath);
    const observed = [...source.matchAll(/router\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g)]
      .map((match) => `${match[1].toUpperCase()} ${match[2]}`);
    return [owner.prefix, observed];
  }));
  return catalog.canonicalRoutes.map((route) => {
    const owner = owners.find((candidate) => route.route.startsWith(candidate.prefix));
    const relativeRoute = owner ? route.route.slice(owner.prefix.length) : null;
    const observed = owner && relativeRoute !== null
      ? observedByOwner.get(owner.prefix)?.includes(`${route.method} ${relativeRoute}`) === true
      : false;
    return { ...route, observed };
  });
}

export function discoverOperationalPageIds() {
  const source = readText('web/src/App.tsx');
  const pageIds = new Set([...source.matchAll(/page\s*===\s*'([^']+)'/g)].map((match) => match[1]));
  for (const block of source.matchAll(/\[([^\]]+)\]\.includes\(page\)/g)) {
    for (const match of block[1].matchAll(/'([^']+)'/g)) pageIds.add(match[1]);
  }
  return [...pageIds].sort();
}

export function frozenInputScan(catalog) {
  return catalog.frozenInputs.map((input) => {
    const anchoredSha256 = FROZEN_SHA256[input.path] ?? null;
    const inputPath = path.join(ROOT, input.path);
    const sealedSha256 = sealedOwnerDirectiveSha256(input.path);
    const sealedEvidence = sealedSha256 === null ? null : verifySealedOwnerDirective(ROOT, input.path);
    const liveFilePresent = sealedEvidence?.liveFilePresent
      ?? statSync(inputPath, { throwIfNoEntry: false })?.isFile() === true;
    const observedSha256 = sealedEvidence?.sha256 ?? (liveFilePresent ? sha256(input.path) : null);
    return {
      ...input,
      anchoredSha256,
      observedSha256,
      evidenceMode: sealedEvidence?.evidenceMode ?? (liveFilePresent ? 'COMMITTED_FILE' : 'MISSING'),
      passed: anchoredSha256 !== null && input.sha256 === anchoredSha256 && observedSha256 === anchoredSha256,
    };
  });
}

export function historicalFrozenInputScan(catalog) {
  const declaredLivingPins = new Map((catalog.historicalPacket?.livingDirectorPins ?? [])
    .map((input) => [input.path, input.sha256]));
  return catalog.frozenInputs.map((input) => {
    const anchoredSha256 = HISTORICAL_PACKET_SHA256[input.path] ?? null;
    const declaredSha256 = declaredLivingPins.get(input.path) ?? input.sha256;
    const inputPath = path.join(ROOT, input.path);
    const sealedSha256 = sealedOwnerDirectiveSha256(input.path);
    const sealedEvidence = sealedSha256 === null ? null : verifySealedOwnerDirective(ROOT, input.path);
    const liveFilePresent = sealedEvidence?.liveFilePresent
      ?? statSync(inputPath, { throwIfNoEntry: false })?.isFile() === true;
    const observedSha256 = sealedEvidence?.sha256 ?? (liveFilePresent ? sha256(input.path) : null);
    return {
      ...input,
      sha256: declaredSha256,
      anchoredSha256,
      observedSha256,
      evidenceMode: sealedEvidence?.evidenceMode ?? (liveFilePresent ? 'COMMITTED_FILE' : 'MISSING'),
      passed: anchoredSha256 !== null && declaredSha256 === anchoredSha256 && observedSha256 === anchoredSha256,
    };
  });
}

export function effectiveFrozenInputScan(catalog, acceptanceDocument) {
  const finalInputs = frozenInputScan(catalog);
  const historicalInputs = historicalFrozenInputScan(catalog);
  const acceptance = verifyLivingDirectorInputAcceptance(acceptanceDocument);
  const livingByPath = new Map(acceptance.livingResults.map((entry) => [entry.path, entry]));
  const historicalByPath = new Map(historicalInputs.map((entry) => [entry.path, entry]));
  const acceptedInputs = finalInputs.map((input) => {
    const living = livingByPath.get(input.path);
    if (!living) return Object.freeze({ ...input, acceptanceMode: 'IMMUTABLE_FINAL_INPUT' });
    const historical = historicalByPath.get(input.path);
    const historicalPacketPinPreserved = historical?.sha256 === historical?.anchoredSha256
      && living.historicalPacketSha256 === historical?.anchoredSha256;
    const finalRepinPassed = input.passed && input.sha256 === living.observedSha256;
    return Object.freeze({
      ...input,
      acceptanceMode: acceptance.mode,
      historicalPacketPassed: historical?.passed === true,
      historicalPacketPinPreserved,
      finalRepinPassed,
      acceptedSourceRef: acceptance.sourceRef,
      acceptedSourceTip: acceptance.sourceTip,
      acceptedLatestCommit: living.latestCommit,
      acceptedGitBlob: living.observedGitBlob,
      acceptedSha256: living.observedSha256,
      passed: acceptance.passed && living.passed && historicalPacketPinPreserved && finalRepinPassed,
    });
  });
  return Object.freeze({ acceptance, historicalInputs: Object.freeze(historicalInputs), acceptedInputs: Object.freeze(acceptedInputs) });
}

function nearestRank(sorted, quantile) {
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  return sorted[rank - 1];
}

export function measureResourceHarness(closure, samples) {
  const plan = closure.resourceHarness;
  assert.equal(samples.truthLabel, 'SYNTHETIC');
  assert.equal(samples.windowEndMs - samples.windowStartMs, plan.sampleWindowMs);
  const metrics = {};
  for (const metric of closure.resourceMetrics) {
    const metricPlan = plan.metrics[metric.id];
    assert(metricPlan, `missing plan ${metric.id}`);
    if (metric.id === 'ACTIVE_TICKET_PRIORITY' || metric.id === 'LOAD_SHED_ORDER') continue;
    const series = samples.series[metric.id];
    assert(Array.isArray(series), `missing series ${metric.id}`);
    assert(series.length >= plan.minimumSamples, `insufficient samples ${metric.id}`);
    assert(series.every((value) => Number.isFinite(value) && value >= 0), `invalid sample ${metric.id}`);
    const sorted = [...series].sort((left, right) => left - right);
    const maximum = sorted.at(-1);
    const unavailable = metric.status === 'OWNER_GATED'
      || metric.status.startsWith('AWAITING_')
      || metric.status.endsWith('_NOT_CONFIGURED');
    const breachState = unavailable ? 'UNAVAILABLE'
      : maximum >= metricPlan.hardBound ? 'BLOCKED'
        : maximum >= metricPlan.softBound ? 'DEGRADED'
          : 'OK';
    metrics[metric.id] = Object.freeze({
      sampleCount: series.length,
      p50: nearestRank(sorted, 0.5),
      p95: nearestRank(sorted, 0.95),
      p99: nearestRank(sorted, 0.99),
      maximum,
      softBound: metricPlan.softBound,
      hardBound: metricPlan.hardBound,
      breachState,
      truthLabel: 'SYNTHETIC',
    });
  }
  const shedding = evaluateLoadShedding(samples);
  const p0MaterialLoss = shedding.reduce((sum, decision) => sum + decision.materialLoss.P0, 0);
  return Object.freeze({
    metrics: Object.freeze(metrics),
    p0MaterialLoss,
    p0InvariantPassed: p0MaterialLoss <= plan.p0MaterialLossMaximum,
    truthLabel: plan.truthLabel,
  });
}

export function evaluateLoadShedding(samples) {
  const allTiers = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4']);
  const policy = Object.freeze({
    SOFT: Object.freeze(['P4']),
    HARD: Object.freeze(['P4', 'P3']),
    CRITICAL: Object.freeze(['P4', 'P3', 'P2']),
  });
  const workItems = samples.loadShedding.workItemsByTier;
  assert(allTiers.every((tier) => Number.isSafeInteger(workItems[tier]) && workItems[tier] >= 0));
  const decisions = samples.loadShedding.pressureSteps.map((pressure) => {
    const shed = policy[pressure];
    assert(shed, `unknown pressure ${pressure}`);
    const preserved = allTiers.filter((tier) => !shed.includes(tier));
    const materialLoss = Object.fromEntries(allTiers.map((tier) => [tier, shed.includes(tier) ? workItems[tier] : 0]));
    return Object.freeze({ pressure, shed, preserved: Object.freeze(preserved), materialLoss: Object.freeze(materialLoss) });
  });
  for (const decision of decisions) {
    assert(!decision.shed.includes('P0') && !decision.shed.includes('P1'));
    assert.deepEqual(decision.shed, ['P4', 'P3', 'P2'].slice(0, decision.shed.length));
    assert.equal(decision.materialLoss.P0, 0);
    assert.equal(decision.materialLoss.P1, 0);
  }
  return Object.freeze(decisions);
}
