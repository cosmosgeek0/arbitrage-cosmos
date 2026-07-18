#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPERATION_KINDS,
  OPERATION_MAPPING_REGISTRY,
  REVIEWED_OPERATION_DISPOSITIONS,
  scanProductionOperations,
} from '../productAssurance/production-operation-scan.mjs';

const TWIN_PATH = 'server/src/liveEdge/adapters/exchangeTwin/twin.ts';
const TWIN_SOURCE_SHA256 = '4084c2bb579a6b8e31cc3335ea5239aecb0c4d02069be149c16cf041ad6d726d';
const TWIN_SITE_IDS = Object.freeze([
  'OPSITE_EC1F177AF129B3ADC45F',
  'OPSITE_BBF6A6E3E6D0468FD096',
  'OPSITE_681C6289EB16650A7095',
  'OPSITE_E1DFC0EA92073B636F85',
  'OPSITE_4313D4CAC1BE118FA9C7',
  'OPSITE_C3A4E3DF89FAAE01DB37',
  'OPSITE_2FBD24490D95366BBEC9',
  'OPSITE_FA39DF346D81D5807F15',
  'OPSITE_613F1008C4901A5BC2F2',
  'OPSITE_BFF76F75E2CEBDCF1F2E',
  'OPSITE_67E9868170DACA0EA4B4',
  'OPSITE_8A41F617689711AB0F24',
  'OPSITE_4F03FF2180B9D93D6ECF',
  'OPSITE_7B8A49CB49C59D501D3E',
  'OPSITE_B3E6F79CD0FDFBB6AB4B',
  'OPSITE_E2C4B80645CF74F5E209',
  'OPSITE_978ACBE891DB4E20A632',
  'OPSITE_C14963BAE18A1A999A3B',
  'OPSITE_C08CC5189218F0DA4BC2',
].sort());

const ASSESSMENT_PATH = 'server/src/liveEdge/integration/assessmentBridge.ts';
const ASSESSMENT_SOURCE_SHA256 = '0ece8a5b47d7a01752f758c30cbd5aa84e023f402feaae38e3fe76946dcbe316';
const ASSESSMENT_SITE_IDS = Object.freeze([
  'OPSITE_F8EB465F752C00771526',
  'OPSITE_11D05D78F943C928C8F9',
  'OPSITE_3EC04308A744BC59E87E',
].sort());

const NEWS_CONTEXT_PATH = 'server/src/services/newsContext.ts';
const NEWS_CONTEXT_SOURCE_SHA256 = 'b41d9d54b2eac621810f7629dd6131fa76a35c0b1793863c4be374f04f767cb6';
const NEWS_CONTEXT_SITE_ID = 'OPSITE_FD086559819579DF346A';

export const NEWS_CONTEXT_OVERLAY_AUTHORITY = Object.freeze({
  sourceCommit: '2651710fffa7a453162097f04ba60792151912a4',
  sourceBlob: 'ab7e5c0301f02b4a2a3fdfcdab041203fc972926',
  sourceDigestAlgorithm: 'sha256',
  sourceSha256: NEWS_CONTEXT_SOURCE_SHA256,
  rulingCommit: 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6',
  ownerId: 'EXISTING_NEWS_CONTEXT_SERVICE',
  disposition: 'KEEP_CANONICAL',
  operationClass: 'PURE_READ',
  operationId: 'OP_NEWS_CONTEXT_PUBLIC_READ',
  siteId: NEWS_CONTEXT_SITE_ID,
  path: NEWS_CONTEXT_PATH,
  line: 2312,
  column: 25,
  rawKind: OPERATION_KINDS.MUTATION_CALL,
  rawSymbol: 'fetch:DYNAMIC_METHOD',
  effectiveKind: OPERATION_KINDS.NETWORK_HTTP_REQUEST,
  effectiveSymbol: 'fetch:GET',
});

const PROFILE_PATH = 'server/src/binance/profile.ts';
const PROFILE_SOURCE_SHA256 = 'e87d976c450182cc2adccad3e6c080133045fdb78ad13f0c13d24394ea4285c6';
const PROFILE_SITE_IDS = Object.freeze([
  'OPSITE_5EA03340B3E6E86C7930',
].sort());

const DATA_DIR_LEASE_PATH = 'server/src/systemIntegration/persistence/dataDirLease.ts';
const DATA_DIR_LEASE_SOURCE_SHA256 = '98ade1626bc046c8236ae4421fe97e08fc8ee108c2427f80a2db8cb43a7fe68b';
const DATA_DIR_LEASE_SITE_IDS = Object.freeze([
  'OPSITE_3EA8C80748CDC730E1C8',
].sort());

const TWIN_RULE = Object.freeze({
  ruleId: 'i00-live-edge-exchange-twin-synthetic-state-v1',
  operationId: 'OP_L07_EXCHANGE_TWIN_SYNTHETIC_STATE_REDUCTION',
  pathExact: Object.freeze([TWIN_PATH]),
  pathPrefixes: Object.freeze([]),
  kinds: Object.freeze([OPERATION_KINDS.MUTATION_CALL]),
  symbolPattern: '^replaceOrder$',
});

const ASSESSMENT_RULE = Object.freeze({
  ruleId: 'i00-live-edge-assessment-bounded-queue-v1',
  operationId: 'OP_RUNTIME_IN_MEMORY_QUEUE',
  pathExact: Object.freeze([ASSESSMENT_PATH]),
  pathPrefixes: Object.freeze([]),
  kinds: Object.freeze([
    OPERATION_KINDS.QUEUE_CREATE,
    OPERATION_KINDS.QUEUE_PUBLISH,
    OPERATION_KINDS.QUEUE_CONSUME,
  ]),
  symbolPattern: '^(?:new:BoundedInboundQueue|this\\.#queue\\.(?:offer|shift))$',
});

const NEWS_CONTEXT_RULE = Object.freeze({
  ruleId: 'i00-news-context-explicit-public-get-v2',
  operationId: NEWS_CONTEXT_OVERLAY_AUTHORITY.operationId,
  pathExact: Object.freeze([NEWS_CONTEXT_PATH]),
  pathPrefixes: Object.freeze([]),
  kinds: Object.freeze([OPERATION_KINDS.MUTATION_CALL]),
  symbolPattern: '^fetch:DYNAMIC_METHOD$',
});

const PROFILE_RULE = Object.freeze({
  ruleId: 'robustness-token-profile-bounded-queue-v1',
  operationId: 'OP_RUNTIME_IN_MEMORY_QUEUE',
  pathExact: Object.freeze([PROFILE_PATH]),
  pathPrefixes: Object.freeze([]),
  kinds: Object.freeze([OPERATION_KINDS.QUEUE_CONSUME]),
  symbolPattern: '^profileRequestQueue\\.shift$',
});

const DATA_DIR_LEASE_RULE = Object.freeze({
  ruleId: 'system-integration-data-dir-writer-lease-v1',
  operationId: 'OP_LEDGER_SQLITE',
  pathExact: Object.freeze([DATA_DIR_LEASE_PATH]),
  pathPrefixes: Object.freeze([]),
  kinds: Object.freeze([OPERATION_KINDS.DATABASE_OPEN]),
  symbolPattern: '^new:Database$',
});

export const I00_OPERATION_MAPPING_OVERLAY = Object.freeze([
  NEWS_CONTEXT_RULE,
  TWIN_RULE,
  ASSESSMENT_RULE,
  PROFILE_RULE,
  DATA_DIR_LEASE_RULE,
]);

function exactMembers(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function verifyNewsContextOverlayAuthority(candidate) {
  return candidate !== null
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && exactMembers(Object.keys(candidate).sort(), Object.keys(NEWS_CONTEXT_OVERLAY_AUTHORITY).sort())
    && Object.entries(NEWS_CONTEXT_OVERLAY_AUTHORITY)
      .every(([key, value]) => candidate[key] === value);
}

function exactSites(report, {
  path,
  sourceSha256,
  siteIds,
  kindSet,
  symbolSet,
  line = null,
  column = null,
  operationId = null,
  mappingRuleId = null,
}) {
  const sites = report.sites
    .filter((site) => site.path === path)
    .filter((site) => kindSet.has(site.rawKind))
    .filter((site) => symbolSet.has(site.rawSymbol));
  const observedIds = sites.map((site) => site.siteId).sort();
  return exactMembers(observedIds, siteIds)
    && sites.every((site) => site.sourceSha256 === sourceSha256)
    && sites.every((site) => line === null || site.line === line)
    && sites.every((site) => column === null || site.column === column)
    && sites.every((site) => site.operationId === operationId)
    && sites.every((site) => site.mappingRuleId === mappingRuleId);
}

function verifyBaseUncovered(report) {
  const observed = report.uncoveredSites.map((site) => site.siteId).sort();
  const expected = [
    NEWS_CONTEXT_SITE_ID,
    ...TWIN_SITE_IDS,
    ...ASSESSMENT_SITE_IDS,
    ...PROFILE_SITE_IDS,
    ...DATA_DIR_LEASE_SITE_IDS,
  ].sort();
  if (!exactMembers(observed, expected)) {
    throw new Error(`I00_OPERATION_OVERLAY_BASE_SET_DRIFT:${JSON.stringify({ expected, observed })}`);
  }
  if (!exactSites(report, {
    path: NEWS_CONTEXT_PATH,
    sourceSha256: NEWS_CONTEXT_SOURCE_SHA256,
    siteIds: [NEWS_CONTEXT_SITE_ID],
    kindSet: new Set([OPERATION_KINDS.MUTATION_CALL]),
    symbolSet: new Set(['fetch:DYNAMIC_METHOD']),
    line: NEWS_CONTEXT_OVERLAY_AUTHORITY.line,
    column: NEWS_CONTEXT_OVERLAY_AUTHORITY.column,
  })) throw new Error('I00_OPERATION_OVERLAY_NEWS_SOURCE_DRIFT');
  if (!exactSites(report, {
    path: TWIN_PATH,
    sourceSha256: TWIN_SOURCE_SHA256,
    siteIds: TWIN_SITE_IDS,
    kindSet: new Set([OPERATION_KINDS.MUTATION_CALL]),
    symbolSet: new Set(['replaceOrder']),
  })) throw new Error('I00_OPERATION_OVERLAY_TWIN_SOURCE_DRIFT');
  if (!exactSites(report, {
    path: ASSESSMENT_PATH,
    sourceSha256: ASSESSMENT_SOURCE_SHA256,
    siteIds: ASSESSMENT_SITE_IDS,
    kindSet: new Set([
      OPERATION_KINDS.QUEUE_CREATE,
      OPERATION_KINDS.QUEUE_PUBLISH,
      OPERATION_KINDS.QUEUE_CONSUME,
    ]),
    symbolSet: new Set(['new:BoundedInboundQueue', 'this.#queue.offer', 'this.#queue.shift']),
  })) throw new Error('I00_OPERATION_OVERLAY_ASSESSMENT_SOURCE_DRIFT');
  if (!exactSites(report, {
    path: PROFILE_PATH,
    sourceSha256: PROFILE_SOURCE_SHA256,
    siteIds: PROFILE_SITE_IDS,
    kindSet: new Set([OPERATION_KINDS.QUEUE_CONSUME]),
    symbolSet: new Set(['profileRequestQueue.shift']),
  })) throw new Error('I00_OPERATION_OVERLAY_PROFILE_SOURCE_DRIFT');
  if (!exactSites(report, {
    path: DATA_DIR_LEASE_PATH,
    sourceSha256: DATA_DIR_LEASE_SOURCE_SHA256,
    siteIds: DATA_DIR_LEASE_SITE_IDS,
    kindSet: new Set([OPERATION_KINDS.DATABASE_OPEN]),
    symbolSet: new Set(['new:Database']),
  })) throw new Error('I00_OPERATION_OVERLAY_DATA_DIR_LEASE_SOURCE_DRIFT');
}

function verifyIntegratedMappings(report) {
  if (!exactSites(report, {
    path: NEWS_CONTEXT_PATH,
    sourceSha256: NEWS_CONTEXT_SOURCE_SHA256,
    siteIds: [NEWS_CONTEXT_SITE_ID],
    kindSet: new Set([OPERATION_KINDS.MUTATION_CALL]),
    symbolSet: new Set(['fetch:DYNAMIC_METHOD']),
    line: NEWS_CONTEXT_OVERLAY_AUTHORITY.line,
    column: NEWS_CONTEXT_OVERLAY_AUTHORITY.column,
    operationId: NEWS_CONTEXT_RULE.operationId,
    mappingRuleId: NEWS_CONTEXT_RULE.ruleId,
  })) throw new Error('I00_OPERATION_OVERLAY_NEWS_MAPPING_DRIFT');
  if (!exactSites(report, {
    path: TWIN_PATH,
    sourceSha256: TWIN_SOURCE_SHA256,
    siteIds: TWIN_SITE_IDS,
    kindSet: new Set([OPERATION_KINDS.MUTATION_CALL]),
    symbolSet: new Set(['replaceOrder']),
    operationId: TWIN_RULE.operationId,
    mappingRuleId: TWIN_RULE.ruleId,
  })) throw new Error('I00_OPERATION_OVERLAY_TWIN_MAPPING_DRIFT');
  if (!exactSites(report, {
    path: ASSESSMENT_PATH,
    sourceSha256: ASSESSMENT_SOURCE_SHA256,
    siteIds: ASSESSMENT_SITE_IDS,
    kindSet: new Set([
      OPERATION_KINDS.QUEUE_CREATE,
      OPERATION_KINDS.QUEUE_PUBLISH,
      OPERATION_KINDS.QUEUE_CONSUME,
    ]),
    symbolSet: new Set(['new:BoundedInboundQueue', 'this.#queue.offer', 'this.#queue.shift']),
    operationId: ASSESSMENT_RULE.operationId,
    mappingRuleId: ASSESSMENT_RULE.ruleId,
  })) throw new Error('I00_OPERATION_OVERLAY_ASSESSMENT_MAPPING_DRIFT');
  if (!exactSites(report, {
    path: PROFILE_PATH,
    sourceSha256: PROFILE_SOURCE_SHA256,
    siteIds: PROFILE_SITE_IDS,
    kindSet: new Set([OPERATION_KINDS.QUEUE_CONSUME]),
    symbolSet: new Set(['profileRequestQueue.shift']),
    operationId: PROFILE_RULE.operationId,
    mappingRuleId: PROFILE_RULE.ruleId,
  })) throw new Error('I00_OPERATION_OVERLAY_PROFILE_MAPPING_DRIFT');
  if (!exactSites(report, {
    path: DATA_DIR_LEASE_PATH,
    sourceSha256: DATA_DIR_LEASE_SOURCE_SHA256,
    siteIds: DATA_DIR_LEASE_SITE_IDS,
    kindSet: new Set([OPERATION_KINDS.DATABASE_OPEN]),
    symbolSet: new Set(['new:Database']),
    operationId: DATA_DIR_LEASE_RULE.operationId,
    mappingRuleId: DATA_DIR_LEASE_RULE.ruleId,
  })) throw new Error('I00_OPERATION_OVERLAY_DATA_DIR_LEASE_MAPPING_DRIFT');
  if (report.uncovered !== 0 || report.uncoveredSites.length !== 0) {
    throw new Error(`I00_OPERATION_OVERLAY_UNCOVERED:${report.uncovered}`);
  }
}

/**
 * Integration-owned overlay for the exact accepted L source bytes. It does not
 * modify A-CORE's immutable scanner and refuses source drift, a twentieth
 * synthetic replace site, a widened queue site, or any additional uncovered
 * operation. Registration is coverage evidence only; it grants no runtime,
 * command, persistence, exchange, or money authority.
 */
export function scanIntegratedProductionOperations(options = {}) {
  if (!verifyNewsContextOverlayAuthority(
    options.newsContextAuthority ?? NEWS_CONTEXT_OVERLAY_AUTHORITY,
  )) throw new Error('I00_OPERATION_OVERLAY_NEWS_AUTHORITY_DRIFT');
  const baseReport = scanProductionOperations({
    repositoryRoot: options.repositoryRoot,
    registry: OPERATION_MAPPING_REGISTRY,
    reviewedDispositions: REVIEWED_OPERATION_DISPOSITIONS,
  });
  verifyBaseUncovered(baseReport);
  const report = scanProductionOperations({
    repositoryRoot: options.repositoryRoot,
    registry: Object.freeze([...OPERATION_MAPPING_REGISTRY, ...I00_OPERATION_MAPPING_OVERLAY]),
    reviewedDispositions: REVIEWED_OPERATION_DISPOSITIONS,
  });
  verifyIntegratedMappings(report);
  return report;
}

function printHumanReport(report) {
  process.stdout.write(`${report.schemaVersion}\n`);
  process.stdout.write(`files scanned: ${report.filesScanned}\n`);
  process.stdout.write(`operation sites: ${report.discovered}\n`);
  process.stdout.write(`registered: ${report.covered}\n`);
  process.stdout.write(`uncovered: ${report.uncovered}\n`);
  for (const [operationId, count] of Object.entries(report.operationCounts)) {
    process.stdout.write(`  ${operationId}: ${count}\n`);
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const json = process.argv.includes('--json');
    const unknown = process.argv.slice(2).filter((argument) => argument !== '--json' && argument !== '--fail-on-uncovered');
    if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);
    const report = scanIntegratedProductionOperations();
    if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHumanReport(report);
    if (process.argv.includes('--fail-on-uncovered') && report.uncovered > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`I00 production operation overlay failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
