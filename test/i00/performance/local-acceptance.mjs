#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import {
  ACCEPTANCE_SCHEMA_VERSION,
  CANONICAL_SYSTEM_COMPONENT_IDS,
  I00_MANAGED_COMPONENT_IDENTITIES,
  PROTECTED_OWNER_DIRECTIVES,
  PRODUCT_RUNTIME_CONTROL_IDS,
  Q_DONOR_SHA,
  Q_DONOR_TREE,
  Q_RECEIPT_PATH,
  Q_RECEIPT_SHA256,
  canonicalJson,
  parseBoundedInteger,
  scanSecretText,
  sha256,
  validateJsonSchema,
  verifyProtectedOwnerDirectives,
  writeImmutableJson,
} from './contract.mjs';
import { validatePerformanceDocument } from './local-proxy-soak.mjs';
import {
  EXPECTED_DONOR_ROWS,
  verifyDonorEquality,
} from '../donor-equality.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HARNESS_ROOT = path.join(ROOT, 'test/i00/performance');
const EVIDENCE_ROOT = path.join(HARNESS_ROOT, 'evidence');
const BROWSER_SCHEMA_PATH = path.join(HARNESS_ROOT, 'browser-receipt.schema.v2.json');
const BROWSER_MEASUREMENT_SCHEMA_PATH = path.join(HARNESS_ROOT, 'browser-measurement.schema.v1.json');
const BROWSER_CAPTURE_SCHEMA_PATH = path.join(HARNESS_ROOT, 'browser-capture.schema.v3.json');
const BROWSER_RESTART_SCHEMA_PATH = path.join(HARNESS_ROOT, 'browser-restart-measurement.schema.v1.json');
const BROWSER_EVIDENCE_PREFIX = 'test/i00/performance/evidence/browser/';
const BROWSER_CAPTURE_PROVENANCE = 'IN_APP_BROWSER_MCP';
const BROWSER_CAPTURE_COUNT = 146;
const BROWSER_ROUTE_OBSERVATION_COUNT = 126;
const BROWSER_ARTIFACT_COUNT = 194;
const BROWSER_SUPERVISOR_PATH = '/api/product-integration/v1/supervisor';
const BROWSER_CONSOLE_LIMIT = 1000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const Q_PYPROJECT_SHA256 = 'a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81';
const Q_UV_LOCK_SHA256 = '716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29';
const Q_ACCEPTED_VENV_MANIFEST_SHA256 = 'ab78066bcbe7297d30c9bcd3699348e8daa82a44de64b743c11cd6b0a397fc7d';
const Q_ACCEPTED_PYTHON_VERSION = '3.13.14';
const MANDATORY_BROWSER_ROUTES = Object.freeze([
  'dashboard', 'control-room', 'account', 'wallets', 'markets', 'detail', 'loans', 'execution',
  'orders', 'positions', 'fills', 'pnl', 'strategies', 'volume', 'opportunities', 'risk',
  'ledger', 'system', 'notifications', 'news', 'calendar',
]);
const MANDATORY_BROWSER_ROUTE_PATHS = Object.freeze({
  dashboard: '/dashboard',
  'control-room': '/control-room',
  account: '/account',
  wallets: '/wallets',
  markets: '/markets',
  detail: '/detail/BTCUSDT',
  loans: '/loans',
  execution: '/execution',
  orders: '/orders',
  positions: '/positions',
  fills: '/fills',
  pnl: '/pnl',
  strategies: '/strategies',
  volume: '/volume',
  opportunities: '/opportunities',
  risk: '/risk',
  ledger: '/ledger',
  system: '/system',
  notifications: '/notifications',
  news: '/news',
  calendar: '/calendar',
});
const MANDATORY_BROWSER_FRAME_IDENTITIES = Object.freeze({
  ...Object.fromEntries(MANDATORY_BROWSER_ROUTES.map((routeId) => [routeId, routeId])),
  // Wallets is an intentional logical receipt alias of the only reachable
  // Account overview. No hidden storage mutation is permitted in the audit.
  wallets: 'account',
});
const MANDATORY_BROWSER_RUNS = Object.freeze([
  '390x844@1-LIGHT', '390x844@1-DARK',
  '1600x900@1-LIGHT', '1600x900@1-DARK',
  '2940x1200@1.25-LIGHT', '2940x1200@1.25-DARK',
]);
const MANDATORY_BOTTOM_UP_SURFACES = Object.freeze([
  Object.freeze({ pageId: 'calendar', path: '/calendar', routeId: 'calendar' }),
  Object.freeze({ pageId: 'news', path: '/news', routeId: 'news' }),
  Object.freeze({ pageId: 'health', path: '/system', routeId: 'system' }),
  Object.freeze({ pageId: 'logs', path: '/ledger', routeId: 'ledger' }),
  Object.freeze({ pageId: 'risk', path: '/risk', routeId: 'risk' }),
  Object.freeze({ pageId: 'opportunities', path: '/opportunities', routeId: 'opportunities' }),
  Object.freeze({ pageId: 'volume', path: '/volume', routeId: 'volume' }),
  Object.freeze({ pageId: 'basis', path: '/strategies', routeId: 'strategies' }),
  Object.freeze({ pageId: 'markets', path: '/markets', routeId: 'markets' }),
  Object.freeze({ pageId: 'token', path: '/detail/BTCUSDT', routeId: 'detail' }),
  Object.freeze({ pageId: 'borrow', path: '/loans', routeId: 'loans' }),
  Object.freeze({ pageId: 'account', path: '/account', routeId: 'account' }),
  Object.freeze({ pageId: 'dashboard', path: '/dashboard', routeId: 'dashboard' }),
]);
const MANDATORY_TOPBAR_PANELS = Object.freeze([
  Object.freeze({ panelId: 'clock', triggerKey: 'clock', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'aws-runner', triggerKey: 'shell', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'api-keys', triggerKey: 'apikey', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'trust-advisor', triggerKey: 'advisor', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'notifications', triggerKey: 'notif', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'execution-control', triggerKey: 'power', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'currency', triggerKey: 'currency', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'basis-units', triggerKey: 'basisu', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'appearance', triggerKey: 'appearance', headerHeightPx: 70 }),
  Object.freeze({ panelId: 'account-details', triggerKey: 'account', headerHeightPx: 84 }),
]);
const REQUIRED_SEAL_PATHS = Object.freeze([
  'STATE.md',
  'I00_PRODUCT_BUILD_STATE.md',
  'docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md',
  'fixtures/i00/proof-catalog.json',
]);
const ALLOWED_MEASUREMENT_CLOSURE_PATHS = new Set([
  ...REQUIRED_SEAL_PATHS,
  'fixtures/i00/closure-evidence.json',
  'integration/reports/i00-proof-evidence.json',
  'AUTONOMY_CLOSURE_REPORT.md',
  'MISSION_COVERAGE_MATRIX.md',
  'NO_TERMINAL_DEPENDENCY_REPORT.md',
  'OFFICIAL_INTERFACE_MATRIX.md',
  'RESOURCE_AND_BACKPRESSURE_REPORT.md',
]);
const PROOF_CATALOG_PATH = 'fixtures/i00/proof-catalog.json';
const CLOSURE_EVIDENCE_PATH = 'fixtures/i00/closure-evidence.json';
const CANDIDATE_RECEIPT_PATH = 'docs/archive/i00-phase2/INTEGRATION_CANDIDATE_READY_RECEIPT.md';
const GENERATED_REPORT_PATHS = Object.freeze([
  'MISSION_COVERAGE_MATRIX.md',
  'AUTONOMY_CLOSURE_REPORT.md',
  'NO_TERMINAL_DEPENDENCY_REPORT.md',
  'RESOURCE_AND_BACKPRESSURE_REPORT.md',
  'OFFICIAL_INTERFACE_MATRIX.md',
  'integration/reports/i00-proof-evidence.json',
]);
const CANDIDATE_RECEIPT_SCHEMA_VERSION = 'i00.integration-candidate-receipt.v1';
const CANDIDATE_RECEIPT_MAX_BYTES = 512 * 1024;
const CANDIDATE_RECEIPT_TITLE = '# I00 Phase 2 Integration Candidate Receipt\n\n';
const CANDIDATE_RECEIPT_BLOCK_BEGIN = '<!-- I00_INTEGRATION_CANDIDATE_RECEIPT_V1_BEGIN -->\n```json\n';
const CANDIDATE_RECEIPT_BLOCK_END = '\n```\n<!-- I00_INTEGRATION_CANDIDATE_RECEIPT_V1_END -->';
const CANDIDATE_RECEIPT_TERMINAL = '\n\nINTEGRATION_CANDIDATE_READY\nPARKED_READ_ONLY\nINDEPENDENT_VERIFICATION_REQUIRED\n';
const CANDIDATE_TERMINAL_STATE = Object.freeze([
  'INTEGRATION_CANDIDATE_READY',
  'PARKED_READ_ONLY',
  'INDEPENDENT_VERIFICATION_REQUIRED',
]);
const PRODUCT_SUPERVISOR_ROUTE = 'GET /api/product-integration/v1/supervisor';
const PROOF_CONTROL_ROW_KEYS = Object.freeze([
  'id', 'command', 'group', 'label', 'explanation', 'owner', 'targetTypes', 'payloadSchema',
  'safeBounds', 'defaultValue', 'semantics', 'effect', 'requiredPosture', 'confirmation',
  'expiryMs', 'reversible', 'previewProvider', 'invariants', 'telemetry', 'wiringState',
  'fixtureState', 'bounded', 'moneyIncreasing', 'runtimeControlId', 'closureState',
]);
const PROOF_CONTROL_RUNTIME_CROSSWALK = Object.freeze([
  Object.freeze({ catalogId: 'CTRL-KILL', runtimeControlId: 'global.kill-switch.engage' }),
  Object.freeze({ catalogId: 'CTRL-MODE', runtimeControlId: 'global.safe-mode.read-only' }),
  Object.freeze({ catalogId: 'CTRL-INTAKE', runtimeControlId: 'global.intake.pause' }),
  Object.freeze({ catalogId: 'CTRL-RESTART', runtimeControlId: 'component.engine-supervisor.restart' }),
]);
const EXTERNAL_BOUNDARY_DETAIL = Object.freeze({
  privateReads: Object.freeze({
    status: 'OWNER_GATED_NOT_RUN',
    boundary: 'No private exchange or account reads were authorized or exercised.',
  }),
  signedCalls: Object.freeze({
    status: 'OWNER_GATED_NOT_RUN',
    boundary: 'No signed or credential-bearing exchange calls were authorized or exercised.',
  }),
  awsCloudflare: Object.freeze({
    status: 'OWNER_GATED_NOT_RUN',
    boundary: 'No AWS or Cloudflare control-plane action was authorized or exercised.',
  }),
  deployPush: Object.freeze({
    status: 'NOT_RUN',
    boundary: 'No deployment, remote push, or current-main mutation was performed.',
  }),
  moneyPaths: Object.freeze({
    status: 'FORBIDDEN_NOT_RUN',
    boundary: 'No live/test order, borrow/repay, leverage, transfer, or withdrawal path was exercised.',
  }),
});
export const EXPECTED_CANDIDATE_LIMITATIONS = Object.freeze([
  Object.freeze({ id: 'PRIVATE_SIGNED_EXCHANGE', status: 'NOT_CONFIGURED', reason: 'PRIVATE_READ_AUTHORIZATION_REQUIRED; SIGNED_VALIDATION_AUTHORIZATION_REQUIRED' }),
  Object.freeze({ id: 'Q_PRODUCTION_TRANSPORT', status: 'NOT_CONFIGURED', reason: 'Q_PRODUCTION_TRANSPORT_NOT_CONFIGURED' }),
  Object.freeze({ id: 'LIVE_EXECUTION', status: 'NOT_CONFIGURED', reason: 'LIVE_EXECUTION_NOT_IMPLEMENTED' }),
  Object.freeze({ id: 'DEPLOYMENT_TARGET', status: 'OWNER_GATED', reason: 'DEPLOYMENT_AUTHORIZATION_REQUIRED; REAL_TARGET_READBACK_REQUIRED' }),
  Object.freeze({ id: 'L12_ACTIVE_SUBJECT_PRIVATE_TRUTH', status: 'OWNER_GATED', reason: 'CANONICAL_ACTIVE_SUBJECT_AND_PRIVATE_ACCOUNT_TRUTH_NOT_AUTHORIZED; ACCEPTED_PROJECTOR_NOT_INVOKED' }),
  Object.freeze({ id: 'L13_ACCEPTED_PROJECTOR', status: 'OWNER_GATED', reason: 'VALIDATED_L12_ACTIVE_SUBJECT_TRUTH_UNAVAILABLE; ACCEPTED_PROJECTOR_NOT_INVOKED' }),
  Object.freeze({ id: 'L14_PRODUCTION_ACTIVATION', status: 'OWNER_GATED', reason: 'NUMERIC_CONFIGURATION_CHECKPOINT_AND_RESERVATION_OWNERS_UNAVAILABLE; PRODUCTION_PERSISTENCE_NULL; NO_DISPATCH' }),
  Object.freeze({ id: 'FOUNDATION_QUANTITY_PRODUCTION_CONSUMER', status: 'NOT_CONFIGURED', reason: 'CONTRACT_AND_HOSTILE_PROOFS_PRESENT; NO_AUTHORIZED_PRODUCTION_CONSUMER' }),
  Object.freeze({ id: 'MANAGED_RESTART_EFFECT', status: 'OWNER_GATED', reason: 'KEYLESS_MANAGED_RESTART_OWNER_GATED; EXTERNAL_PROCESS_MANAGER_EFFECT_NOT_AUTHORIZED_OR_PROVED' }),
  Object.freeze({ id: 'PRODUCTION_CAPACITY', status: 'UNKNOWN', reason: 'LOCAL_BOUNDED_ACCEPTANCE_ONLY; PRODUCTION_LOAD_AND_CAPACITY_NOT_MEASURED' }),
  Object.freeze({ id: 'PRODUCT_ASSURANCE_PRODUCTION_PROJECTION', status: 'NOT_CONFIGURED', reason: 'PASSIVE_SOURCE_PROJECTION_ONLY; PRODUCTION_ASSURANCE_ACTIVATION_NOT_CONFIGURED' }),
  Object.freeze({ id: 'A_FORMAL', status: 'POSTLANDING_EXCLUDED', reason: 'POST_LANDING_EXCLUDED_BY_L_LAST_ORDERING; ACCEPTED_POST_LANDING_TIP_b491893416006cf529aef02e5dd4a25d6475e7b8' }),
  Object.freeze({ id: 'A_ACTION_EVIDENCE_S2', status: 'POSTLANDING_EXCLUDED', reason: 'POST_LANDING_ONLY_EXCLUDED; ACCEPTED_POST_LANDING_TIP_ca30adf5e97b6697afec49f13073024d953b117b' }),
  Object.freeze({ id: 'PREVERIFY_WORKTREE', status: 'NOT_CONFIGURED', reason: 'NON_DONOR_WORKTREE_EXCLUDED_FROM_PHASE_2_CANDIDATE; TIP_46b2f1e31edf9f75aec7203e952a56f9869a2971; NO_INTEGRATION_DISPOSITION' }),
]);
export const EXPECTED_ACCEPTED_DONORS = Object.freeze([
  Object.freeze({ id: 'F-BRIDGE', tipSha: 'a0c0c2e5ef3180aa720488463643433cefeb65e5', treeSha: 'b29f0b50841ae921b0a0dfa65b71d224d6a7b5ec', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '0670f533840f415b612fb290d2c944f94af50d82', acceptanceReceiptSha256s: Object.freeze(['e01a614d89755553e5e86db657b8f2ed804060b68f8088c3f34b9c27d76bbba4']), integrationReceiptSha256: '2cdd156ba4510f49e9b192795aea756afbea55ee359e41e33ff15f4bc65810f9' }),
  Object.freeze({ id: 'SI-RECON', tipSha: 'f03ed786a8c5cab50ef27ad33026a74f79f7df87', treeSha: 'c88cb7a566daf858e73cebc77122409e96d0ffcd', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: 'ba965fb0fbb5e10819d5a704e99153892fe94031', acceptanceReceiptSha256s: Object.freeze(['a0ac1bd8da362999e93d0b10094a4791f900e2a245e66b115a78128030574585']), integrationReceiptSha256: 'a36a0d67b4efdc47dfd03f47bed243d445cc9e5156d66d33924a6fff860fc4f1' }),
  Object.freeze({ id: 'Q-LANE', tipSha: Q_DONOR_SHA, treeSha: Q_DONOR_TREE, integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '042dc9897d04bed2b0de3043cbdcbac408251412', acceptanceReceiptSha256s: Object.freeze([Q_RECEIPT_SHA256]), integrationReceiptSha256: 'daa8c219227322df1e7a71e6d8b2815256b040fbacac8fbb7d492c00651bb7a4' }),
  Object.freeze({ id: 'DASHBOARD-SHELL', tipSha: '692501587617d4880303fbd747d93e63c376f088', treeSha: '61d0c5a3e9146fc0b78d8c7fce3e7ebdfbc3b46d', integrationMethod: 'RECEIPTED_EQUIVALENCE', integrationCommit: 'd04fdc71ffbd9c8266c969524a56e325ec68b1f8', acceptanceReceiptSha256s: Object.freeze(['878cc578d88f38ca3bf8edce554b2cb258b4e9309718854f7ba18c33cb50b968']), integrationReceiptSha256: 'd36bb026b54510c0d9853a5e0a32e0d29837cc8677082bd37261bb2107d37e43' }),
  Object.freeze({ id: 'L15-INFRASTRUCTURE', tipSha: '2cec412927fa2f64f05a0b2774b18e45f8ce4fa5', treeSha: 'e401435d6a650aee8a29c3da4495b4db426be017', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '35672dcc448d2ca55b17c24344fb413b4d1e14a7', acceptanceReceiptSha256s: Object.freeze(['d5159d60419faf11b153557ce830a0d563c723a1b6d74bf7af8fd0517edc7293']), integrationReceiptSha256: '92affcb7dd520a0d7f9cf1b9a1ca8c2a4c77e4b98451c98293bf7b54edfde656' }),
  Object.freeze({ id: 'IP-RUNTIME', tipSha: '8058ab8febb639839333d4e2c604068a0c7390ea', treeSha: 'dd255f23310c846ab0b3ea0c3bebb6a765ecddd0', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: 'f5523e63efcb0a5434341cf9328162be1482fc38', acceptanceReceiptSha256s: Object.freeze(['8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb']), integrationReceiptSha256: '8a16a2e5a869b9356b9b2cbbfd1de68406e64a253479fc6be600e953cd613dcb' }),
  Object.freeze({ id: 'IP-CONTROL', tipSha: '56c47dad398c485b6653036c8b90c53f11061b1e', treeSha: 'e335fc95be7a24da828b14c205f39ea3666dd385', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: 'd50de1dd1b23a40b3895b29fee5486bc069597af', acceptanceReceiptSha256s: Object.freeze(['4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7']), integrationReceiptSha256: '4864f9a7de2a640b5e643e7817b33a0114cd988b29ac20cb2b6f0f77f6bf43f7' }),
  Object.freeze({ id: 'IP-OPS', tipSha: '6bfd543afb693ea18f4baf08e962e6d698f140fb', treeSha: '572adc3c19d9052fc26398875230437505f5c97e', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: 'a6a12b943c77c54e60072f755beca984432bffa8', acceptanceReceiptSha256s: Object.freeze(['57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922']), integrationReceiptSha256: '57bc6fd9a6847dde70b1ac2cd81e0116db8e0f34c8e4003fee55b3f09f5bd922' }),
  Object.freeze({ id: 'IP-PROOF', tipSha: '23e985c17b9b860fee26be397fa05b26f3daf8f2', treeSha: '1329fe73139016cf728d47551c75f7ca69daa558', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '1d9b1a3a5e859501c4c0c47e6b2c8d0d82bc4698', acceptanceReceiptSha256s: Object.freeze(['569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b']), integrationReceiptSha256: '569f09af842f527ca19269a8e66dbdc367145a03ff31aba839defe252d14ad7b' }),
  Object.freeze({ id: 'A-CORE', tipSha: '08a0a09780727e2b4ba59017b5701998abe29b77', treeSha: 'b904ca0f5b6f7c8df294274351611635560f80f7', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '3ee0eda6b0da01b6fae441c684fa53829cab15be', acceptanceReceiptSha256s: Object.freeze(['93b1f6283d48ddeadf9b7205e47f3ccfc698d4f79f98b8e82ecad1d7aa4a302e']), integrationReceiptSha256: '6741509d67eb622f913661e1ea0e277b01a29ebb3a0e9318e3025882122ba0fa' }),
  Object.freeze({ id: 'A-HAZARD', tipSha: 'ab33b3712cddd67c3ec91cfa1dd232c75226cd9f', treeSha: 'e33224d4b2e6b018fd39bfdcb403b3d88e74712f', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: 'bfb813ba1c15a23c7f4f0bff6a8da2f13d5c2729', acceptanceReceiptSha256s: Object.freeze(['ecfca4e7d60d9dca3b07e4e21d4595ebb234dab421924f14226cf39f8a9c85ea']), integrationReceiptSha256: '3190610ddf4ea7c47d3483769ed6983a4f821ba91ec38cb9c5260310edbf9c3e' }),
  Object.freeze({ id: 'A-COCKPIT', tipSha: 'd4ff9c94c9fec9477481223c4b33d8f671a34f6d', treeSha: 'bda9b452c9e6564576fa3cd390a5981cd6907c09', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '0204687d8c65875c99d17ae7bee1c61707f0be0f', acceptanceReceiptSha256s: Object.freeze(['b75055388f99632f2dc5ebb87d92b6d969f666397014e89a616a6e262f0650dd']), integrationReceiptSha256: 'f11e706995c1156b82f6c1f7aaa8bcb29b0c76c8dbc9364087a973ccd7514555' }),
  Object.freeze({ id: 'A-AGENT', tipSha: '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437', treeSha: 'e68ef10d09c11bc5623099a2eb6eb6881054486b', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '251d901e2a38c7b3b9634ab1728098655f0104bb', acceptanceReceiptSha256s: Object.freeze(['c237939f112a41abfb83508ed57e5783a9344cc3cb76e02003ca64487831a92c']), integrationReceiptSha256: 'e47be0f081b15859b2d8509e2fd0e2a611c48dcca50a8640f39dc86be717e7d0' }),
  Object.freeze({ id: 'A-STABILITY', tipSha: 'd35674e7f9621320c35e0bc0270efd515cc64dbd', treeSha: '16c92923b837105471b232df0480d1270bda756e', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '332208e64fb9b54ef2b6320c7609e53833da469f', acceptanceReceiptSha256s: Object.freeze(['b26f902d90fb82633ac8532d5aa82169801ded3ec6d7bcf3477737a64eab2168']), integrationReceiptSha256: 'bc527367b7b05f78e4be4dd4a916be59029316fa671f1d2ea1ed91f7a0f734d2' }),
  Object.freeze({ id: 'A-CASE-S4', tipSha: 'b4d8a446cb4cd6e77e7fbaf38f927b7513dc316c', treeSha: '3c773878016f4a56c6b03fe6485a42b002c3f5d2', integrationMethod: 'MERGE_ANCESTRY', integrationCommit: '86ee3b5f81c73c64eccf1d10b14a1f3bdf8a4bf1', acceptanceReceiptSha256s: Object.freeze(['05369b8aa403a4fae6b86143ddcb7d61551d5996838c92b9bc4aba79401a3550']), integrationReceiptSha256: 'f721c0a72a36255727555a4ab13e4fab0f1fc829604e8ce8ae8897760dd0925b' }),
  Object.freeze({ id: 'L-LANE', tipSha: 'df6b472993ca9659ce09cf5f72004981c6835f0d', treeSha: '1add5ee43fea623509c20d0990ec9efac2543fc4', integrationMethod: 'MERGE_ANCESTRY_REQUIRED_LAST', integrationCommit: 'ec82bc51d5311dfb3f505216bfb3fa41733f038c', acceptanceReceiptSha256s: Object.freeze([
    'f23e078fdd1cf8d64585c01b677817d4d4efa3a08f9c4933acae09b399ce2381',
    '0b95db6e0ae8777d3e3bebb1a510561c7dfc9dcba963bd02fbc91025dd784fe2',
  ]), integrationReceiptSha256: '198af74b4f0931123a41d6b0a94b1bbcd6890813986d981bd39e95ba486c296b' }),
]);
if (JSON.stringify(EXPECTED_ACCEPTED_DONORS) !== JSON.stringify(EXPECTED_DONOR_ROWS)) {
  throw new Error('DONOR_TABLE_OWNER_DRIFT');
}
export const EXPECTED_PROTOCOL_AND_CONFIG_HASHES = Object.freeze([
  Object.freeze({ id: 'FINAL-INTEGRATION-ORDER', kind: 'SHA256', hash: '73615984fa0403a4c0d7ea0db9893292d57ea18614714398684cf9a3062fb05c' }),
  Object.freeze({ id: 'I00-CONTROLLING-DIRECTIVE', kind: 'SHA256', hash: '9d7a36da6a2e6e7b3e905c73161b5e998a2f92416dd557e498ade3e73d5e5ef5' }),
  Object.freeze({ id: 'IP-RUNTIME-DIRECTIVE', kind: 'SHA256', hash: '6e93016e3177db69a26844c12e6449d9afac1700e9946570a243051645565810' }),
  Object.freeze({ id: 'IP-CONTROL-DIRECTIVE', kind: 'SHA256', hash: '5e57bf1d019f761731857be7a1c46c5b06eb7f80db9709d5425bbea749fb7278' }),
  Object.freeze({ id: 'IP-OPS-DIRECTIVE', kind: 'SHA256', hash: '2af8348906f9306765a0d0d57f21b01349767e6115f04f43ce00fa6328f1b779' }),
  Object.freeze({ id: 'IP-PROOF-DIRECTIVE', kind: 'SHA256', hash: 'e59d516ba9acb9a7bb1ce63ca149ce662f308a0fd0900b72db3d2fe2e8bb93b6' }),
  Object.freeze({ id: 'QL-EDGE-PROTOCOL-COMMIT', kind: 'GIT_COMMIT_SHA1', hash: '73e1a1ff7daa48df8dac45713fc5f106842edafc' }),
  Object.freeze({ id: 'QL-EDGE-PROTOCOL-DOCUMENT', kind: 'SHA256', hash: '951fdbb5f347f900c61e60055f90cf2e1e1e743b75b7dc733652acb8d43353a1' }),
  Object.freeze({ id: 'EDGE-PROTOCOL-SCHEMA', kind: 'SHA256', hash: '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c' }),
  Object.freeze({ id: 'EDGE-PROTOCOL-FIXTURES', kind: 'SHA256', hash: 'c42a4257ea5f46abb38ec9ab4e56983e7049cdf5b448150a4d4647a6234d99a4' }),
  Object.freeze({ id: 'ARCHITECTURE-AUTHORITY-MAP', kind: 'SHA256', hash: 'beb8be8baefe2faa78356e2dc44983735b855535c21cd5f0172a8e1e3fa665db' }),
  Object.freeze({ id: 'Q-DIRECTIVE-LOCK', kind: 'SHA256', hash: 'd4bf31826625c2602ebb7ed72194e94a4571f7597a413ca545839f236c7a5a24' }),
  Object.freeze({ id: 'QL-DIRECTOR-STATE', kind: 'SHA256', hash: '77f7c47251e6c9f990352c6ca63408a5a2dbfbbfb87cac0f38d71bf0446258cc' }),
  Object.freeze({ id: 'QL-PARALLEL-DAG', kind: 'SHA256', hash: 'cb4312843160e5f72029ee9f7b169987cfc07b9ef82d952c3feba60476392dec' }),
]);
const BOTTOM_UP_ROLE_ORDER = Object.freeze([
  'frame', 'title', 'summary-label', 'summary-value', 'row-primary', 'row-secondary',
]);
const TOPBAR_ROLE_ORDER = Object.freeze([
  'header-title', 'header-subtitle', 'row-primary', 'row-secondary', 'right-value', 'status',
]);
const DESIGN_ROLE_CONTRACTS = Object.freeze({
  BOTTOM_UP_PAGE: Object.freeze({
    frame: Object.freeze({ borderRadiusPx: Object.freeze([12, 12]), borderWidthPx: Object.freeze([1, 1]) }),
    title: Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([22, 22]), fontWeight: Object.freeze([540, 540]), lineHeightPx: Object.freeze([30, 30]) }),
    'summary-label': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([10.5, 10.5]), fontWeight: Object.freeze([560, 560]), letterSpacingPx: Object.freeze([0.5675, 0.5875]) }),
    'summary-value': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([18, 18]), fontWeight: Object.freeze([510, 510]) }),
    'row-primary': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([12.5, 13.25]), fontWeight: Object.freeze([470, 510]) }),
    'row-secondary': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([10.5, 11.5]), fontWeight: Object.freeze([410, 420]) }),
  }),
  TOPBAR_PANEL: Object.freeze({
    'header-title': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([16, 16]), fontWeight: Object.freeze([540, 540]), lineHeightPx: Object.freeze([21, 21]) }),
    'header-subtitle': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([11.25, 11.25]), fontWeight: Object.freeze([400, 400]), lineHeightPx: Object.freeze([16, 16]) }),
    'row-primary': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([12.75, 12.75]), fontWeight: Object.freeze([470, 470]), lineHeightPx: Object.freeze([18, 18]) }),
    'row-secondary': Object.freeze({ fontFamily: 'UI', fontSizePx: Object.freeze([10.5, 10.5]), fontWeight: Object.freeze([400, 400]), lineHeightPx: Object.freeze([15, 15]) }),
    'right-value': Object.freeze({ fontFamily: 'MONO', fontSizePx: Object.freeze([11.5, 11.5]), fontWeight: Object.freeze([450, 450]), lineHeightPx: Object.freeze([16, 16]), fontVariantNumeric: 'tabular-nums' }),
    status: Object.freeze({ fontFamily: 'MONO', fontSizePx: Object.freeze([9.75, 9.75]), fontWeight: Object.freeze([500, 500]), lineHeightPx: Object.freeze([14, 14]), textTransform: 'uppercase' }),
  }),
});

export const ACCEPTANCE_PLAN = Object.freeze([
  Object.freeze({ id: 'q_exact_donor_q17', kind: 'Q_ARCHIVE', command: Object.freeze(['<accepted-q-venv>/bin/python', '-m', 'pytest', '-p', '_hypothesis_pytestplugin', '-p', 'pytest_cov.plugin', 'tests/q17', '-q', '--cov=quant_edge.final_proof', '--cov-branch', '--cov-report=term', '--tb=short']) }),
  Object.freeze({ id: 'q_exact_donor_all', kind: 'Q_ARCHIVE', command: Object.freeze(['<accepted-q-venv>/bin/python', '-m', 'pytest', '-p', '_hypothesis_pytestplugin', '-p', 'pytest_cov.plugin', '-q', '--tb=short']) }),
  Object.freeze({ id: 'root_test', kind: 'COMMAND', command: Object.freeze(['npm', 'test']) }),
  Object.freeze({ id: 'repository_test_all', kind: 'COMMAND', command: Object.freeze(['npm', 'run', 'test:all']) }),
  Object.freeze({ id: 'ops_all_local', kind: 'COMMAND', command: Object.freeze(['bash', 'ops/tests/run-all.sh']) }),
  Object.freeze({ id: 'ops_i00_all_local', kind: 'COMMAND', command: Object.freeze(['bash', 'ops/tests/i00/run-all.sh']) }),
  Object.freeze({ id: 'generated_report_parity', kind: 'REPORT_PARITY', command: Object.freeze([]) }),
  Object.freeze({ id: 'local_proxy_performance', kind: 'PERFORMANCE', command: Object.freeze([process.execPath, 'test/i00/performance/local-proxy-soak.mjs', '--run', '--duration-seconds=<bounded>']) }),
  Object.freeze({ id: 'browser_receipt', kind: 'BROWSER_RECEIPT', command: Object.freeze([]) }),
  Object.freeze({ id: 'source_freeze', kind: 'SOURCE_FREEZE', command: Object.freeze([]) }),
  Object.freeze({ id: 'diff_check', kind: 'COMMAND', command: Object.freeze(['git', 'diff', '--check']) }),
]);

export function parseOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--run' || token === '--plan' || token === '--validate-only' || token === '--render-candidate-receipt') {
      values.set(token.slice(2), 'true');
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`UNKNOWN_ARGUMENT:${token}`);
    const equal = token.indexOf('=');
    if (equal > 2) {
      values.set(token.slice(2, equal), token.slice(equal + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`MISSING_ARGUMENT_VALUE:${key}`);
    values.set(key, next);
    index += 1;
  }
  const known = new Set(['run', 'plan', 'validate-only', 'render-candidate-receipt', 'out', 'q-venv', 'browser-receipt', 'performance-receipt', 'complete-receipt', 'candidate-sha', 'seal-sha', 'performance-duration-seconds']);
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`UNKNOWN_OPTION:${key}`);
  const selectedModes = ['run', 'plan', 'validate-only', 'render-candidate-receipt'].filter((key) => values.has(key));
  if (selectedModes.length > 1) throw new Error('EXACTLY_ONE_MODE_REQUIRED');
  return Object.freeze({
    mode: values.has('run') ? 'RUN'
      : values.has('validate-only') ? 'VALIDATE_ONLY'
        : values.has('render-candidate-receipt') ? 'RENDER_CANDIDATE_RECEIPT'
          : 'PLAN',
    output: values.get('out') ?? null,
    qVenv: values.get('q-venv') ?? null,
    browserReceipt: values.get('browser-receipt') ?? null,
    performanceReceipt: values.get('performance-receipt') ?? null,
    completeReceipt: values.get('complete-receipt') ?? null,
    candidateSha: values.get('candidate-sha') ?? null,
    sealSha: values.get('seal-sha') ?? null,
    performanceDurationSeconds: parseBoundedInteger(values.get('performance-duration-seconds') ?? '60', 'PERFORMANCE_DURATION_SECONDS', 60, 3_600),
  });
}

async function loadSealedCandidateEvidence(options, environment) {
  if (typeof options.candidateSha !== 'string' || !/^[0-9a-f]{40}$/.test(options.candidateSha)) {
    throw new Error('EXACT_CANDIDATE_SHA_REQUIRED_FOR_VALIDATE_ONLY');
  }
  const topology = await resolveCandidateSealTopology(environment, options.candidateSha, options.sealSha);
  if (!topology.passed) throw new Error(`CANDIDATE_SEAL_TOPOLOGY_INVALID:${topology.failures.join(',')}`);
  const donorProof = verifyDonorEquality({
    repoRoot: ROOT,
    workspaceRoot: path.dirname(ROOT),
    candidateRef: topology.candidateSha,
    expectedRows: EXPECTED_ACCEPTED_DONORS,
  });
  if (donorProof.status !== 'PASS'
      || donorProof.candidate?.sha !== topology.candidateSha
      || donorProof.candidate?.tree !== topology.candidateTreeSha) {
    throw new Error(`DONOR_EQUALITY_PROOF_BLOCKED:${donorProof.failures.join(',')}`);
  }
  const candidateManifest = await sourceManifest(environment, topology.candidateSha);
  const proofCatalog = await validateProofCatalogSealBinding(environment, topology.candidateSha, topology.sealHeadSha);
  const limitationSource = await validateCandidateLimitationsAtRevision(environment, topology.sealHeadSha);
  const performanceReceipt = await validatePerformanceReceiptAtRevision(
      environment, topology.sealHeadSha, options.performanceReceipt, topology.candidateSha, topology.candidateTreeSha,
  );
  const browserReceipt = await validateBrowserReceiptAtRevision(
      environment, topology.sealHeadSha, options.browserReceipt, topology.candidateSha, topology.candidateTreeSha,
  );
  const initialEvidence = await evidenceManifestAtRevision(environment, topology.sealHeadSha, [
    browserReceipt.relativePath,
    ...browserReceipt.artifacts.map((artifact) => artifact.relativePath),
  ]);
  const completeReceipt = await validateCompleteReceiptAtRevision(
    environment,
    topology.sealHeadSha,
    options.completeReceipt,
    topology.candidateSha,
    topology.candidateTreeSha,
    performanceReceipt,
    browserReceipt,
    candidateManifest,
    initialEvidence,
  );
  const allowedEvidencePaths = new Set([
    performanceReceipt.relativePath,
    browserReceipt.relativePath,
    completeReceipt.relativePath,
    ...browserReceipt.artifacts.map((artifact) => artifact.relativePath),
  ]);
  const frozenEvidence = await evidenceManifestAtRevision(environment, topology.sealHeadSha, allowedEvidencePaths);
  const source = await detachedCandidateTruth(environment, topology.candidateSha, topology.candidateTreeSha);
  return Object.freeze({
    topology,
    donorProof,
    candidateManifest,
    proofCatalog,
    limitationSource,
    performanceReceipt,
    browserReceipt,
    completeReceipt,
    allowedEvidencePaths,
    frozenEvidence,
    source,
  });
}

export async function renderCandidateReceiptFromWorkingSealEvidence(options) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'i00-candidate-render-'));
  const environment = safeEnvironment(tempRoot);
  try {
    if (typeof options.candidateSha !== 'string' || !/^[0-9a-f]{40}$/u.test(options.candidateSha)) {
      throw new Error('EXACT_CANDIDATE_SHA_REQUIRED_FOR_CANDIDATE_RENDER');
    }
    const source = await workingSealSource(environment, options.candidateSha);
    const donorProof = verifyDonorEquality({
      repoRoot: ROOT,
      workspaceRoot: path.dirname(ROOT),
      candidateRef: options.candidateSha,
      expectedRows: EXPECTED_ACCEPTED_DONORS,
    });
    if (donorProof.status !== 'PASS'
        || donorProof.candidate?.sha !== options.candidateSha
        || donorProof.candidate?.tree !== source.treeSha) {
      throw new Error(`DONOR_EQUALITY_PROOF_BLOCKED:${donorProof.failures.join(',')}`);
    }
    const candidateManifest = await sourceManifest(environment, options.candidateSha);
    const proofCatalog = await validateProofCatalogWorkingSeal(environment, options.candidateSha);
    const limitationSource = validateCandidateLimitationsFromWorkingSeal();
    const performanceReceipt = validatePerformanceReceipt(options.performanceReceipt, options.candidateSha, source.treeSha);
    const browserReceipt = validateBrowserReceipt(options.browserReceipt, options.candidateSha, source.treeSha);
    const initialEvidence = evidenceManifest([
      browserReceipt.relativePath,
      ...browserReceipt.artifacts.map((artifact) => artifact.relativePath),
    ]);
    const completeReceipt = validateCompleteReceipt(
      options.completeReceipt,
      options.candidateSha,
      source.treeSha,
      performanceReceipt,
      browserReceipt,
      candidateManifest,
      initialEvidence,
    );
    const frozenEvidence = evidenceManifest(new Set([
      performanceReceipt.relativePath,
      browserReceipt.relativePath,
      completeReceipt.relativePath,
      ...browserReceipt.artifacts.map((artifact) => artifact.relativePath),
    ]));
    if (!performanceReceipt.passed || !browserReceipt.passed
        || !completeReceipt.passed || !proofCatalog.passed) {
      throw new Error('CANDIDATE_RENDER_EVIDENCE_NOT_PASSED');
    }
    const document = buildIntegrationCandidateReceiptDocument({
      candidateSha: options.candidateSha,
      candidateTreeSha: source.treeSha,
      donorProof,
      performanceReceipt,
      browserReceipt,
      completeReceipt,
      controlCatalog: proofCatalog.controlCatalog,
      limitationSource,
      sourceManifest: candidateManifest,
      evidenceManifest: frozenEvidence,
    });
    return renderIntegrationCandidateReceiptMarkdown(document);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function validateCompleteEvidence(options) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'i00-complete-validate-'));
  const environment = safeEnvironment(tempRoot);
  try {
    const evidence = await loadSealedCandidateEvidence(options, environment);
    const {
      topology, donorProof, candidateManifest, proofCatalog, performanceReceipt, browserReceipt,
      completeReceipt, allowedEvidencePaths, frozenEvidence, source, limitationSource,
    } = evidence;
    const candidateReceipt = await validateIntegrationCandidateReceiptAtRevision(environment, topology.sealHeadSha, {
      candidateSha: topology.candidateSha,
      candidateTreeSha: topology.candidateTreeSha,
      donorProof,
      performanceReceipt,
      browserReceipt,
      completeReceipt,
      controlCatalog: proofCatalog.controlCatalog,
      limitationSource,
      sourceManifest: candidateManifest,
      evidenceManifest: frozenEvidence,
    });
    const evidencePathBinding = validateSealEvidencePathBinding(topology.diffPaths, allowedEvidencePaths);
    const sealEvidenceFailures = [candidateReceipt.relativePath, proofCatalog.relativePath]
      .filter((relativePath) => !topology.diffPaths.includes(relativePath))
      .map((relativePath) => `SEAL_EVIDENCE_NOT_COMMITTED:${relativePath}`)
      .concat(evidencePathBinding.failures);
    const [qExactDonor, reportParity] = await Promise.all([
      verifyQDonorGit(environment),
      verifyReportParityAtRevision(environment, topology.sealHeadSha, tempRoot),
    ]);
    const passed = performanceReceipt.passed && browserReceipt.passed && completeReceipt.passed
      && candidateReceipt.passed && proofCatalog.passed
      && reportParity.passed && sealEvidenceFailures.length === 0;
    return Object.freeze({
      schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
      mode: 'VALIDATE_ONLY',
      source: Object.freeze({
        ...source,
        candidateHeadSha: topology.candidateSha,
        candidateTreeSha: topology.candidateTreeSha,
        sealHeadSha: topology.sealHeadSha,
      }),
      sealTopology: Object.freeze({ ...topology, evidenceFailures: Object.freeze(sealEvidenceFailures) }),
      proofCatalog,
      sourceFreeze: Object.freeze({ ...candidateManifest, evidence: frozenEvidence, protectedOwnerDirectives: source.protectedOwnerDirectives }),
      qExactDonor,
      reportParity: Object.freeze({
        passed: reportParity.passed,
        artifacts: reportParity.artifacts,
      }),
      performanceReceipt,
      browserReceipt,
      completeReceipt,
      candidateReceipt,
      externalActions: 'NONE',
      passed,
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function safeEnvironment(tempRoot, extra = {}) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: tempRoot,
    TMPDIR: tempRoot,
    TZ: 'UTC',
    LC_ALL: 'C',
    CI: '1',
    ...extra,
  };
}

function gitOutput(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: ROOT, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolve(Buffer.concat(chunks));
      else reject(new Error(`GIT_READ_FAILED:${args[0]}`));
    });
  });
}

function normalizedRepositoryPath(requested, label) {
  if (typeof requested !== 'string' || requested.length === 0 || requested.length > 1_024
      || requested.includes('\0') || requested.includes('\\') || path.posix.isAbsolute(requested)
      || path.posix.normalize(requested) !== requested || requested === '.' || requested.startsWith('../')) {
    throw new Error(`${label}_PATH_INVALID`);
  }
  return requested;
}

async function gitPathBytes(environment, revision, requested, label, maximumBytes = 64 * 1024 * 1024) {
  const relativePath = normalizedRepositoryPath(requested, label);
  const bytes = await gitOutput(['show', `${revision}:${relativePath}`], environment);
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new Error(`${label}_SIZE_INVALID`);
  return Object.freeze({ relativePath, bytes });
}

async function sourceManifest(environment, revision) {
  const treeRows = (await gitOutput(['ls-tree', '-r', '-z', '--full-tree', revision], environment))
    .toString('utf8')
    .split('\0')
    .filter((row) => row.length > 0)
    .map((row) => {
      const tab = row.indexOf('\t');
      const metadata = row.slice(0, tab).split(' ');
      if (tab < 0 || metadata.length !== 3 || metadata[1] !== 'blob') throw new Error('SOURCE_TREE_ROW_INVALID');
      return Object.freeze({ mode: metadata[0], objectSha: metadata[2], relativePath: row.slice(tab + 1) });
    })
    .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  const blobs = await readGitBlobs(treeRows.map((row) => row.objectSha), environment);
  const inventory = [
    ...treeRows.map((row, index) => Object.freeze({
      relativePath: row.relativePath,
      kind: row.mode === '120000' ? 'SYMLINK' : 'FILE',
      bytes: blobs[index],
    })),
    ...PROTECTED_OWNER_DIRECTIVES.map((directive) => Object.freeze({
      relativePath: directive.path,
      kind: 'HASH_PINNED_OWNER_DIRECTIVE',
      bytes: Buffer.from(directive.sha256, 'utf8'),
    })),
  ].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  const digest = createHash('sha256');
  for (const entry of inventory) {
    digest.update(`${entry.relativePath}\0${entry.kind}\0`);
    digest.update(entry.bytes);
    digest.update('\0');
  }
  return Object.freeze({
    format: 'GIT_BLOBS_PLUS_PROTECTED_OWNER_DIRECTIVE_HASHES_V2',
    fileCount: inventory.length,
    sha256: digest.digest('hex'),
    protectedOwnerDirectives: Object.freeze(PROTECTED_OWNER_DIRECTIVES.map((entry) => Object.freeze({ ...entry }))),
  });
}

function readGitBlobs(objectShas, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: ROOT, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0 || signal !== null) {
        reject(new Error(`GIT_BATCH_READ_FAILED:${Buffer.concat(stderr).toString('utf8').slice(0, 120)}`));
        return;
      }
      try {
        const output = Buffer.concat(stdout);
        const blobs = [];
        let offset = 0;
        for (const expectedSha of objectShas) {
          const newline = output.indexOf(0x0a, offset);
          if (newline < 0) throw new Error('GIT_BATCH_HEADER_MISSING');
          const [actualSha, type, sizeText] = output.subarray(offset, newline).toString('ascii').split(' ');
          const size = Number(sizeText);
          if (actualSha !== expectedSha || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('GIT_BATCH_HEADER_INVALID');
          const start = newline + 1;
          const end = start + size;
          if (end >= output.length || output[end] !== 0x0a) throw new Error('GIT_BATCH_BODY_INVALID');
          blobs.push(output.subarray(start, end));
          offset = end + 1;
        }
        if (offset !== output.length) throw new Error('GIT_BATCH_TRAILING_BYTES');
        resolve(Object.freeze(blobs));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${objectShas.join('\n')}\n`);
  });
}

function sealPathAllowed(relativePath) {
  return ALLOWED_MEASUREMENT_CLOSURE_PATHS.has(relativePath)
    || relativePath.startsWith('test/i00/performance/evidence/');
}

export function validateSealEvidencePathBinding(diffPaths, boundEvidencePaths) {
  const diff = Array.isArray(diffPaths) ? diffPaths : [];
  const bound = new Set(boundEvidencePaths ?? []);
  const failures = [];
  for (const relativePath of diff) {
    if (relativePath.startsWith('test/i00/performance/evidence/') && !bound.has(relativePath)) {
      failures.push(`SEAL_UNBOUND_EVIDENCE_PATH:${relativePath}`);
    }
  }
  for (const relativePath of bound) {
    if (!diff.includes(relativePath)) failures.push(`SEAL_EVIDENCE_NOT_COMMITTED:${relativePath}`);
  }
  return Object.freeze({
    failures: Object.freeze([...new Set(failures)].toSorted()),
    passed: failures.length === 0,
  });
}

export function validateWorkingSealPathSet(entries) {
  const records = Array.isArray(entries) ? entries : [];
  const protectedPaths = new Set(PROTECTED_OWNER_DIRECTIVES.map((entry) => entry.path));
  const failures = [];
  for (const entry of records) {
    if (!isPlainRecord(entry) || typeof entry.status !== 'string' || typeof entry.path !== 'string') {
      failures.push('WORKING_SEAL_STATUS_ROW_INVALID');
      continue;
    }
    if (protectedPaths.has(entry.path)) {
      if (entry.status !== '??') failures.push(`WORKING_SEAL_PROTECTED_DIRECTIVE_STATUS_INVALID:${entry.path}`);
      continue;
    }
    if (!sealPathAllowed(entry.path) || entry.path === CANDIDATE_RECEIPT_PATH) {
      failures.push(`WORKING_SEAL_PATH_NOT_ALLOWED:${entry.path}`);
    }
  }
  return Object.freeze({
    failures: Object.freeze([...new Set(failures)].toSorted()),
    passed: failures.length === 0,
  });
}

export function validateCandidateSealTopologyDocument(document) {
  const failures = [];
  if (!/^[0-9a-f]{40}$/.test(document?.candidateSha ?? '')) failures.push('CANDIDATE_SHA_INVALID');
  if (!/^[0-9a-f]{40}$/.test(document?.candidateTreeSha ?? '')) failures.push('CANDIDATE_TREE_SHA_INVALID');
  if (document?.worktreeHeadSha !== document?.candidateSha) failures.push('CANDIDATE_WORKTREE_HEAD_INVALID');
  if (!/^[0-9a-f]{40}$/.test(document?.sealHeadSha ?? '') || document?.sealHeadSha === document?.candidateSha) failures.push('SEAL_HEAD_INVALID');
  if (!Array.isArray(document?.sealParents) || document.sealParents.length !== 1 || document.sealParents[0] !== document.candidateSha) failures.push('SEAL_PARENT_INVALID');
  if (document?.commitCount !== 1) failures.push('SEAL_COMMIT_COUNT_INVALID');
  if (!Array.isArray(document?.directChildren)
      || document.directChildren.length !== 1
      || document.directChildren[0] !== document.sealHeadSha) failures.push('SEAL_SOLE_CHILD_INVALID');
  const diffPaths = Array.isArray(document?.diffPaths) ? document.diffPaths : [];
  if (new Set(diffPaths).size !== diffPaths.length || diffPaths.some((relativePath) => !sealPathAllowed(relativePath))) failures.push('SEAL_PATH_SET_INVALID');
  if (REQUIRED_SEAL_PATHS.some((relativePath) => !diffPaths.includes(relativePath))) failures.push('SEAL_REQUIRED_PATH_MISSING');
  return Object.freeze({ passed: failures.length === 0, failures: Object.freeze([...new Set(failures)].toSorted()) });
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  return isPlainRecord(value)
    && JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...keys].toSorted());
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactUtcTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function proofControlCatalog(document, hashes = {}) {
  const failures = [];
  const rows = Array.isArray(document?.controls) ? document.controls : [];
  if (rows.length !== 14) failures.push('PROOF_CONTROL_CATALOG_COUNT_INVALID');
  if (rows.some((row) => !hasExactKeys(row, PROOF_CONTROL_ROW_KEYS))) failures.push('PROOF_CONTROL_CATALOG_ROW_SHAPE_INVALID');
  if (new Set(rows.map((row) => row?.id)).size !== rows.length) failures.push('PROOF_CONTROL_CATALOG_IDS_INVALID');
  if (rows.some((row) => (
    typeof row?.id !== 'string' || !/^CTRL-[A-Z0-9-]+$/u.test(row.id)
    || typeof row.command !== 'string' || row.command.length === 0
    || typeof row.owner !== 'string' || row.owner.length === 0
    || !Array.isArray(row.targetTypes) || row.targetTypes.length === 0
    || !Array.isArray(row.invariants) || row.invariants.length === 0
    || !Array.isArray(row.telemetry) || row.telemetry.length === 0
    || !Number.isSafeInteger(row.expiryMs) || row.expiryMs <= 0
    || typeof row.bounded !== 'boolean' || typeof row.moneyIncreasing !== 'boolean'
    || row.bounded !== true || row.moneyIncreasing !== false
    || typeof row.wiringState !== 'string' || typeof row.closureState !== 'string'
  ))) failures.push('PROOF_CONTROL_CATALOG_ROW_VALUE_INVALID');
  const wiredRows = rows.filter((row) => row?.wiringState === 'WIRED_SOURCE');
  const notConfiguredRows = rows.filter((row) => /^NOT_CONFIGURED:/u.test(row?.wiringState ?? ''));
  const ownerGatedRows = rows.filter((row) => /^OWNER_GATED:/u.test(row?.wiringState ?? ''));
  if (wiredRows.length !== 4 || notConfiguredRows.length !== 9 || ownerGatedRows.length !== 1
      || wiredRows.length + notConfiguredRows.length + ownerGatedRows.length !== rows.length) {
    failures.push('PROOF_CONTROL_CATALOG_CLASSIFICATION_INVALID');
  }
  if (rows.some((row) => (
    row?.wiringState === 'WIRED_SOURCE'
      ? typeof row.runtimeControlId !== 'string' || !PRODUCT_RUNTIME_CONTROL_IDS.includes(row.runtimeControlId)
      : row?.runtimeControlId !== null
  ))) failures.push('PROOF_CONTROL_CATALOG_RUNTIME_REFERENCE_INVALID');
  const actualCrosswalk = wiredRows.map((row) => ({ catalogId: row.id, runtimeControlId: row.runtimeControlId }));
  if (!exactJson(actualCrosswalk, PROOF_CONTROL_RUNTIME_CROSSWALK)) failures.push('PROOF_CONTROL_CATALOG_CROSSWALK_INVALID');
  return Object.freeze({
    inventory: Object.freeze({
      sourcePath: PROOF_CATALOG_PATH,
      candidateSha256: hashes.candidateSha256 ?? null,
      sealSha256: hashes.sealSha256 ?? null,
      declaredCount: rows.length,
      wiredSourceCount: wiredRows.length,
      notConfiguredCount: notConfiguredRows.length,
      ownerGatedCount: ownerGatedRows.length,
      rows: Object.freeze(structuredClone(rows)),
    }),
    failures: Object.freeze([...new Set(failures)].toSorted()),
    passed: failures.length === 0,
  });
}

export function validateProofCatalogSealBindingDocuments(candidateDocument, sealDocument, expectedCandidateSha) {
  const failures = [];
  if (!/^[0-9a-f]{40}$/u.test(expectedCandidateSha ?? '')) failures.push('PROOF_CATALOG_EXPECTED_CANDIDATE_INVALID');
  if (!isPlainRecord(candidateDocument) || !isPlainRecord(candidateDocument?.base)) failures.push('PROOF_CATALOG_CANDIDATE_SHAPE_INVALID');
  if (!isPlainRecord(sealDocument) || !isPlainRecord(sealDocument?.base)) failures.push('PROOF_CATALOG_SEAL_SHAPE_INVALID');
  if (candidateDocument?.targetState !== 'CANDIDATE_SOURCE_FROZEN') failures.push('PROOF_CATALOG_CANDIDATE_STATE_INVALID');
  if (candidateDocument?.base?.candidateCommit !== null) failures.push('PROOF_CATALOG_CANDIDATE_NOT_UNBOUND');
  if (sealDocument?.base?.candidateCommit !== expectedCandidateSha) failures.push('PROOF_CATALOG_CANDIDATE_COMMIT_MISMATCH');
  if (failures.length === 0) {
    const normalizedSeal = structuredClone(sealDocument);
    normalizedSeal.base.candidateCommit = null;
    if (!exactJson(candidateDocument, normalizedSeal)) failures.push('PROOF_CATALOG_SEAL_DRIFT');
  }
  failures.push(...proofControlCatalog(candidateDocument).failures);
  failures.push(...proofControlCatalog(sealDocument).failures);
  return Object.freeze({ passed: failures.length === 0, failures: Object.freeze([...new Set(failures)].toSorted()) });
}

function parseBoundedJsonBytes(bytes, label, maxBytes = 2 * 1024 * 1024) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) throw new Error(`${label}_SIZE_INVALID`);
  const text = bytes.toString('utf8');
  if (Buffer.byteLength(text) !== bytes.length) throw new Error(`${label}_UTF8_INVALID`);
  if (scanSecretText(text).length !== 0) throw new Error(`${label}_SECRET_TEXT`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_JSON_INVALID`);
  }
}

async function validateProofCatalogSealBinding(environment, candidateSha, sealSha) {
  const candidateBytes = await gitOutput(['show', `${candidateSha}:${PROOF_CATALOG_PATH}`], environment);
  const candidateDocument = parseBoundedJsonBytes(candidateBytes, 'PROOF_CATALOG_CANDIDATE');
  const sealBytes = (await gitPathBytes(environment, sealSha, PROOF_CATALOG_PATH, 'PROOF_CATALOG_SEAL', 2 * 1024 * 1024)).bytes;
  const sealDocument = parseBoundedJsonBytes(sealBytes, 'PROOF_CATALOG_SEAL');
  const validation = validateProofCatalogSealBindingDocuments(candidateDocument, sealDocument, candidateSha);
  const controlCatalog = proofControlCatalog(sealDocument, {
    candidateSha256: sha256(candidateBytes),
    sealSha256: sha256(sealBytes),
  });
  return Object.freeze({
    relativePath: PROOF_CATALOG_PATH,
    candidateSha256: sha256(candidateBytes),
    sealSha256: sha256(sealBytes),
    controlCatalog: controlCatalog.inventory,
    semanticFailures: Object.freeze([...new Set([...validation.failures, ...controlCatalog.failures])].toSorted()),
    passed: validation.passed && controlCatalog.passed,
  });
}

async function validateProofCatalogWorkingSeal(environment, candidateSha) {
  const candidateBytes = await gitOutput(['show', `${candidateSha}:${PROOF_CATALOG_PATH}`], environment);
  const sealedAbsolute = path.join(ROOT, PROOF_CATALOG_PATH);
  const sealedInfo = lstatSync(sealedAbsolute, { throwIfNoEntry: false });
  if (!sealedInfo?.isFile() || sealedInfo.isSymbolicLink() || realpathSync(sealedAbsolute) !== sealedAbsolute) {
    throw new Error('PROOF_CATALOG_WORKING_SEAL_FILE_UNSAFE');
  }
  const sealBytes = readFileSync(sealedAbsolute);
  const candidateDocument = parseBoundedJsonBytes(candidateBytes, 'PROOF_CATALOG_CANDIDATE');
  const sealDocument = parseBoundedJsonBytes(sealBytes, 'PROOF_CATALOG_WORKING_SEAL');
  const validation = validateProofCatalogSealBindingDocuments(candidateDocument, sealDocument, candidateSha);
  const controlCatalog = proofControlCatalog(sealDocument, {
    candidateSha256: sha256(candidateBytes),
    sealSha256: sha256(sealBytes),
  });
  return Object.freeze({
    relativePath: PROOF_CATALOG_PATH,
    candidateSha256: sha256(candidateBytes),
    sealSha256: sha256(sealBytes),
    controlCatalog: controlCatalog.inventory,
    semanticFailures: Object.freeze([...new Set([...validation.failures, ...controlCatalog.failures])].toSorted()),
    passed: validation.passed && controlCatalog.passed,
  });
}

async function validateCandidateLimitationsAtRevision(environment, revision) {
  const artifact = await gitPathBytes(environment, revision, CLOSURE_EVIDENCE_PATH, 'CLOSURE_EVIDENCE', 8 * 1024 * 1024);
  const document = parseBoundedJsonBytes(artifact.bytes, 'CLOSURE_EVIDENCE', 8 * 1024 * 1024);
  const normalized = Array.isArray(document?.knownLimitations)
    ? document.knownLimitations.map((entry) => ({
      ...entry,
      status: ['A_FORMAL', 'A_ACTION_EVIDENCE_S2'].includes(entry?.id)
        ? 'POSTLANDING_EXCLUDED'
        : entry?.status,
    }))
    : [];
  if (!exactJson(normalized, EXPECTED_CANDIDATE_LIMITATIONS)) {
    throw new Error('CANDIDATE_LIMITATION_SOURCE_MISMATCH');
  }
  return Object.freeze({
    sourcePath: artifact.relativePath,
    sealSha256: sha256(artifact.bytes),
    normalization: 'A_FORMAL_AND_A_ACTION_EVIDENCE_S2_POSTLANDING_EXCLUDED',
    entryCount: normalized.length,
  });
}

function validateCandidateLimitationsFromWorkingSeal() {
  const absolute = path.join(ROOT, CLOSURE_EVIDENCE_PATH);
  const info = lstatSync(absolute, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error('CLOSURE_EVIDENCE_WORKING_SEAL_FILE_UNSAFE');
  }
  const bytes = readFileSync(absolute);
  const document = parseBoundedJsonBytes(bytes, 'CLOSURE_EVIDENCE_WORKING_SEAL', 8 * 1024 * 1024);
  const normalized = Array.isArray(document?.knownLimitations)
    ? document.knownLimitations.map((entry) => ({
      ...entry,
      status: ['A_FORMAL', 'A_ACTION_EVIDENCE_S2'].includes(entry?.id)
        ? 'POSTLANDING_EXCLUDED'
        : entry?.status,
    }))
    : [];
  if (!exactJson(normalized, EXPECTED_CANDIDATE_LIMITATIONS)) throw new Error('CANDIDATE_LIMITATION_SOURCE_MISMATCH');
  return Object.freeze({
    sourcePath: CLOSURE_EVIDENCE_PATH,
    sealSha256: sha256(bytes),
    normalization: 'A_FORMAL_AND_A_ACTION_EVIDENCE_S2_POSTLANDING_EXCLUDED',
    entryCount: normalized.length,
  });
}

async function resolveCandidateSealTopology(environment, requestedCandidateSha, requestedSealSha) {
  if (typeof requestedSealSha !== 'string' || !/^[0-9a-f]{40}$/u.test(requestedSealSha)) {
    throw new Error('EXACT_SEAL_SHA_REQUIRED_FOR_DETACHED_VALIDATE_ONLY');
  }
  const candidateSha = (await gitOutput(['rev-parse', '--verify', `${requestedCandidateSha}^{commit}`], environment)).toString('utf8').trim();
  if (candidateSha !== requestedCandidateSha) throw new Error('CANDIDATE_SHA_NOT_EXACT');
  const sealHeadSha = (await gitOutput(['rev-parse', '--verify', `${requestedSealSha}^{commit}`], environment)).toString('utf8').trim();
  if (sealHeadSha !== requestedSealSha) throw new Error('SEAL_SHA_NOT_EXACT');
  const [candidateTreeSha, worktreeHeadSha, parentLine, countText, diffText, childText] = await Promise.all([
    gitOutput(['rev-parse', `${candidateSha}^{tree}`], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-list', '--parents', '-n', '1', sealHeadSha], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-list', '--count', `${candidateSha}..${sealHeadSha}`], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['diff', '--name-only', '-z', candidateSha, sealHeadSha], environment).then((value) => value.toString('utf8')),
    gitOutput(['rev-list', '--children', '--all', candidateSha, sealHeadSha], environment).then((value) => value.toString('utf8')),
  ]);
  const sealParents = parentLine.split(' ').slice(1);
  const candidateChildRow = childText.split('\n').find((row) => row === candidateSha || row.startsWith(`${candidateSha} `));
  const directChildren = candidateChildRow?.split(' ').slice(1).toSorted() ?? [];
  const diffPaths = diffText.split('\0').filter(Boolean).toSorted();
  const document = Object.freeze({
    candidateSha,
    candidateTreeSha,
    worktreeHeadSha,
    sealHeadSha,
    sealParents: Object.freeze(sealParents),
    commitCount: Number(countText),
    directChildren: Object.freeze(directChildren),
    diffPaths: Object.freeze(diffPaths),
  });
  return Object.freeze({ ...document, ...validateCandidateSealTopologyDocument(document) });
}

function evidenceManifest(relativePaths) {
  const entries = [];
  for (const relativePath of [...new Set(relativePaths)].toSorted()) {
    const absolute = path.resolve(ROOT, relativePath);
    if (absolute === ROOT || !absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error('EVIDENCE_PATH_OUTSIDE_REPOSITORY');
    const info = lstatSync(absolute, { throwIfNoEntry: false });
    if (!info?.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error(`EVIDENCE_MISSING_OR_UNSAFE:${relativePath}`);
    const bytes = readFileSync(absolute);
    entries.push(Object.freeze({ relativePath, sha256: sha256(bytes), byteLength: bytes.length }));
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    sha256: sha256(JSON.stringify(entries)),
  });
}

async function evidenceManifestAtRevision(environment, revision, relativePaths) {
  const entries = [];
  for (const relativePath of [...new Set(relativePaths)].toSorted()) {
    const artifact = await gitPathBytes(environment, revision, relativePath, 'EVIDENCE', 128 * 1024 * 1024);
    entries.push(Object.freeze({
      relativePath: artifact.relativePath,
      sha256: sha256(artifact.bytes),
      byteLength: artifact.bytes.length,
    }));
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    sha256: sha256(JSON.stringify(entries)),
  });
}

async function sourceStatus(environment, allowedEvidencePaths = new Set()) {
  const records = (await gitOutput(['status', '--porcelain=v1', '-z', '--untracked-files=all'], environment))
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry.length > 0);
  const parsed = records.map((entry) => Object.freeze({ status: entry.slice(0, 2), path: entry.slice(3) }));
  const statusByPath = new Map(parsed.map((entry) => [entry.path, entry.status]));
  const protectedOwnerDirectives = verifyProtectedOwnerDirectives(ROOT, statusByPath);
  const protectedPaths = new Set(PROTECTED_OWNER_DIRECTIVES.map((entry) => entry.path));
  const dirtyPaths = parsed
    .filter((entry) => !protectedPaths.has(entry.path))
    .filter((entry) => !(entry.status === '??' && allowedEvidencePaths.has(entry.path)))
    .map((entry) => `${entry.status}:${entry.path}`)
    .toSorted();
  return Object.freeze({ dirtyPaths, protectedOwnerDirectives });
}

async function workingSealSource(environment, candidateSha) {
  const [branch, headSha, treeSha, statusText] = await Promise.all([
    gitOutput(['branch', '--show-current'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD^{tree}'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['status', '--porcelain=v1', '-z', '--untracked-files=all'], environment).then((value) => value.toString('utf8')),
  ]);
  if (branch !== 'i00-product-assembly-20260713') throw new Error(`INTEGRATION_BRANCH_REQUIRED:${branch}`);
  if (headSha !== candidateSha) throw new Error('WORKING_SEAL_HEAD_NOT_CANDIDATE');
  const records = statusText.split('\0').filter(Boolean).map((entry) => Object.freeze({
    status: entry.slice(0, 2),
    path: entry.slice(3),
  }));
  const pathValidation = validateWorkingSealPathSet(records);
  if (!pathValidation.passed) throw new Error(`WORKING_SEAL_PATH_SET_INVALID:${pathValidation.failures.join(',')}`);
  const statusByPath = new Map(records.map((entry) => [entry.path, entry.status]));
  const protectedOwnerDirectives = verifyProtectedOwnerDirectives(ROOT, statusByPath);
  return Object.freeze({
    branch,
    headSha,
    treeSha,
    worktreeState: 'CANDIDATE_HEAD_WITH_BOUNDED_UNCOMMITTED_SEAL_EVIDENCE',
    protectedOwnerDirectives,
    records: Object.freeze(records),
  });
}

async function sourceIdentity(environment) {
  const [branch, headSha, treeSha] = await Promise.all([
    gitOutput(['branch', '--show-current'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD^{tree}'], environment).then((value) => value.toString('utf8').trim()),
  ]);
  if (branch === 'current-main' || branch !== 'i00-product-assembly-20260713') throw new Error(`INTEGRATION_BRANCH_REQUIRED:${branch}`);
  return Object.freeze({ branch, headSha, treeSha });
}

async function sourceTruth(environment, allowedEvidencePaths = new Set()) {
  const [branch, headSha, treeSha, status] = await Promise.all([
    gitOutput(['branch', '--show-current'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD^{tree}'], environment).then((value) => value.toString('utf8').trim()),
    sourceStatus(environment, allowedEvidencePaths),
  ]);
  if (branch === 'current-main' || branch !== 'i00-product-assembly-20260713') throw new Error(`INTEGRATION_BRANCH_REQUIRED:${branch}`);
  if (status.dirtyPaths.length > 0) throw new Error(`SOURCE_NOT_FROZEN_DIRTY_PATHS:${status.dirtyPaths.length}`);
  return Object.freeze({
    branch,
    headSha,
    treeSha,
    worktreeState: 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE',
    protectedOwnerDirectives: status.protectedOwnerDirectives,
  });
}

export function validateDetachedCandidateWorktreeDocument(document, expectedCandidateSha, expectedTreeSha) {
  const failures = [];
  if (document?.branch !== '') failures.push('DETACHED_CANDIDATE_BRANCH_INVALID');
  if (document?.headSha !== expectedCandidateSha || document?.treeSha !== expectedTreeSha) {
    failures.push('DETACHED_CANDIDATE_IDENTITY_INVALID');
  }
  if (document?.statusByteLength !== 0) failures.push('DETACHED_CANDIDATE_DIRTY');
  return Object.freeze({
    failures: Object.freeze([...new Set(failures)].toSorted()),
    passed: failures.length === 0,
  });
}

async function detachedCandidateTruth(environment, candidateSha, candidateTreeSha) {
  const [branch, headSha, treeSha, statusBytes] = await Promise.all([
    gitOutput(['branch', '--show-current'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['rev-parse', 'HEAD^{tree}'], environment).then((value) => value.toString('utf8').trim()),
    gitOutput(['status', '--porcelain=v1', '-z', '--untracked-files=all'], environment),
  ]);
  const validation = validateDetachedCandidateWorktreeDocument({
    branch,
    headSha,
    treeSha,
    statusByteLength: statusBytes.length,
  }, candidateSha, candidateTreeSha);
  if (!validation.passed) throw new Error(`DETACHED_CANDIDATE_WORKTREE_INVALID:${validation.failures.join(',')}`);
  return Object.freeze({
    branch: 'DETACHED',
    integrationBranch: 'i00-product-assembly-20260713',
    headSha,
    treeSha,
    worktreeState: 'CLEAN_DETACHED_CANDIDATE_WITH_SEALED_DIRECTIVE_HASHES',
    protectedOwnerDirectives: Object.freeze(PROTECTED_OWNER_DIRECTIVES.map((entry) => Object.freeze({
      ...entry,
      evidence: 'CANDIDATE_RECEIPT_MANIFEST_AND_PROTOCOL_HASH',
    }))),
  });
}

function parseCounts(text) {
  const counts = {};
  const patterns = [
    ['nodeTests', /# tests (\d+)/g],
    ['nodePass', /# pass (\d+)/g],
    ['nodeFail', /# fail (\d+)/g],
    ['pytestPassed', /(?:^|\s)(\d+) passed(?:,|\s)/gm],
    ['pytestSkipped', /(?:^|\s)(\d+) skipped(?:,|\s)/gm],
    ['opsTests', /([0-9]+) tests?/g],
    ['opsAssertions', /([0-9]+) assertions?/g],
  ];
  for (const [label, pattern] of patterns) {
    const values = [...text.matchAll(pattern)].map((match) => Number(match[1])).filter(Number.isSafeInteger);
    if (values.length > 0) counts[label] = values;
  }
  return counts;
}

function runCommand({ id, command, cwd = ROOT, environment, timeoutMs = 3_600_000 }) {
  const [executable, ...args] = command;
  return new Promise((resolve) => {
    const startedAtUtc = new Date().toISOString();
    const started = performance.now();
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutHash = createHash('sha256');
    const stderrHash = createHash('sha256');
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    const capture = (stream, digest, which) => stream.on('data', (chunk) => {
      digest.update(chunk);
      if (which === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes <= MAX_OUTPUT_BYTES) {
        if (which === 'stdout') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      } else overflow = true;
    });
    capture(child.stdout, stdoutHash, 'stdout');
    capture(child.stderr, stderrHash, 'stderr');
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 8_000).unref();
    }, timeoutMs);
    child.once('error', (error) => {
      stderr += `COMMAND_START_ERROR:${error.code ?? error.name}`;
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      const combined = `${stdout}\n${stderr}`;
      const findings = scanSecretText(combined).map((finding) => ({ artifact: id, ...finding }));
      resolve(Object.freeze({
        id,
        command,
        cwdRelative: path.relative(ROOT, cwd) || '.',
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        durationMs: Math.round((performance.now() - started) * 1_000) / 1_000,
        exitCode: code,
        exitSignal: signal,
        timedOut,
        stdoutBytes,
        stderrBytes,
        stdoutSha256: stdoutHash.digest('hex'),
        stderrSha256: stderrHash.digest('hex'),
        parsedCounts: parseCounts(combined),
        secretFindings: findings,
        outputOverflow: overflow,
        passed: code === 0 && signal === null && !timedOut && !overflow && findings.length === 0,
      }));
    });
  });
}

function commandOutput(executable, args, cwd, environment, maximumBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let overflow = false;
    const capture = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maximumBytes) overflow = true;
      else target.push(chunk);
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.once('error', () => reject(new Error('COMMAND_OUTPUT_START_FAILED')));
    child.once('close', (code, signal) => {
      if (code !== 0 || signal !== null || overflow) {
        reject(new Error(`COMMAND_OUTPUT_FAILED:${code ?? 'NULL'}:${signal ?? 'NONE'}:${overflow ? 'OVERFLOW' : 'BOUNDED'}`));
        return;
      }
      resolve(Object.freeze({
        stdout: Buffer.concat(stdout),
        stderrSha256: sha256(Buffer.concat(stderr)),
      }));
    });
  });
}

async function extractQArchive(destination, environment) {
  mkdirSync(destination, { recursive: true });
  const archive = spawn('git', ['archive', '--format=tar', Q_DONOR_SHA, 'quant'], { cwd: ROOT, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const unpack = spawn('tar', ['-x', '-C', destination], { cwd: ROOT, env: environment, stdio: ['pipe', 'ignore', 'pipe'] });
  archive.stdout.pipe(unpack.stdin);
  let errors = '';
  archive.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });
  unpack.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });
  const [archiveExit, unpackExit] = await Promise.all([
    new Promise((resolve) => archive.once('close', (code, signal) => resolve({ code, signal }))),
    new Promise((resolve) => unpack.once('close', (code, signal) => resolve({ code, signal }))),
  ]);
  if (archiveExit.code !== 0 || unpackExit.code !== 0 || archiveExit.signal !== null || unpackExit.signal !== null) {
    throw new Error(`Q_ARCHIVE_EXTRACTION_FAILED:${sha256(errors)}`);
  }
}

async function verifyQDonorGit(environment) {
  const treeText = (await gitOutput(['show', '-s', '--format=%T', Q_DONOR_SHA], environment)).toString('utf8').trim();
  if (treeText !== Q_DONOR_TREE) throw new Error(`Q_DONOR_TREE_MISMATCH:${treeText}`);
  const receiptBytes = await gitOutput(['show', `${Q_DONOR_SHA}:${Q_RECEIPT_PATH}`], environment);
  if (sha256(receiptBytes) !== Q_RECEIPT_SHA256) throw new Error('Q_RECEIPT_HASH_MISMATCH');
  return Object.freeze({
    donorSha: Q_DONOR_SHA,
    donorTree: treeText,
    receiptPath: Q_RECEIPT_PATH,
    receiptSha256: Q_RECEIPT_SHA256,
  });
}

export function validateQVenvManifest(parsed, context, expected = Object.freeze({
  pythonVersion: Q_ACCEPTED_PYTHON_VERSION,
  manifestSha256: Q_ACCEPTED_VENV_MANIFEST_SHA256,
})) {
  const failures = [];
  const distributions = Array.isArray(parsed?.distributions) ? parsed.distributions : [];
  if (parsed?.implementation !== 'CPython') failures.push('IMPLEMENTATION');
  if (parsed?.pythonVersion !== expected.pythonVersion || !exactList(parsed?.versionInfo, expected.pythonVersion.split('.').map(Number))) failures.push('PYTHON_VERSION');
  if (context.resolvedPrefix !== context.resolvedVenv
      || context.resolvedExecutable !== context.pythonRealPath
      || parsed?.basePrefix === parsed?.prefix) failures.push('VENV_IDENTITY');
  if (distributions.length < 1
      || distributions.some((row) => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string')
      || new Set(distributions.map((row) => row[0])).size !== distributions.length
      || distributions.some((row, index) => index > 0 && distributions[index - 1][0].localeCompare(row[0], 'en') > 0)) failures.push('DISTRIBUTION_MANIFEST');
  const manifestSha256 = sha256(JSON.stringify(parsed));
  if (manifestSha256 !== expected.manifestSha256) failures.push('MANIFEST_HASH');
  return Object.freeze({
    manifestSha256,
    distributionCount: distributions.length,
    failures: Object.freeze(failures),
    passed: failures.length === 0,
  });
}

async function inspectAcceptedQVenv({ quantRoot, resolvedVenv, environment }) {
  const python = path.join(resolvedVenv, 'bin/python');
  const pyprojectSha256 = sha256(readFileSync(path.join(quantRoot, 'pyproject.toml')));
  const uvLockSha256 = sha256(readFileSync(path.join(quantRoot, 'uv.lock')));
  if (pyprojectSha256 !== Q_PYPROJECT_SHA256) throw new Error('Q_PYPROJECT_HASH_MISMATCH');
  if (uvLockSha256 !== Q_UV_LOCK_SHA256) throw new Error('Q_UV_LOCK_HASH_MISMATCH');
  const script = [
    'import importlib.metadata as m,json,platform,sys',
    'rows=sorted((d.metadata["Name"].lower().replace("_","-").replace(".","-"),d.version) for d in m.distributions() if d.metadata.get("Name"))',
    'print(json.dumps({"implementation":platform.python_implementation(),"pythonVersion":platform.python_version(),"versionInfo":list(sys.version_info[:3]),"prefix":sys.prefix,"basePrefix":sys.base_prefix,"executable":sys.executable,"distributions":rows},separators=(",",":")))',
  ].join(';');
  const inspection = await commandOutput(python, ['-I', '-c', script], quantRoot, environment);
  const parsed = JSON.parse(inspection.stdout.toString('utf8'));
  const manifest = validateQVenvManifest(parsed, {
    resolvedVenv,
    resolvedPrefix: realpathSync(parsed.prefix),
    pythonRealPath: realpathSync(python),
    resolvedExecutable: realpathSync(parsed.executable),
  });
  if (!manifest.passed) throw new Error(`Q_VENV_MANIFEST_MISMATCH:${manifest.failures.join(',')}`);
  const pipCheck = await runCommand({
    id: 'q_environment_pip_check',
    command: [python, '-I', '-m', 'pip', 'check'],
    cwd: quantRoot,
    environment,
    timeoutMs: 120_000,
  });
  if (!pipCheck.passed) throw new Error('Q_VENV_PIP_CHECK_FAILED');
  return Object.freeze({
    implementation: parsed.implementation,
    pythonVersion: parsed.pythonVersion,
    pyprojectSha256,
    uvLockSha256,
    manifestSha256: manifest.manifestSha256,
    distributionCount: manifest.distributionCount,
    pipCheck: Object.freeze({
      exitCode: pipCheck.exitCode,
      stdoutSha256: pipCheck.stdoutSha256,
      stderrSha256: pipCheck.stderrSha256,
      passed: pipCheck.passed,
    }),
    pytestPluginPolicy: Object.freeze({
      autoLoad: 'DISABLED',
      explicit: Object.freeze(['_hypothesis_pytestplugin', 'pytest_cov.plugin']),
    }),
  });
}

async function runQArchiveGate(tempRoot, qVenv, environment) {
  if (qVenv === null) throw new Error('Q_VENV_REQUIRED_USE_EXPLICIT_Q_VENV');
  const donor = await verifyQDonorGit(environment);
  const archiveRoot = path.join(tempRoot, 'q-donor-archive');
  await extractQArchive(archiveRoot, environment);
  const quantRoot = path.join(archiveRoot, 'quant');
  if (lstatSync(path.join(archiveRoot, '.git'), { throwIfNoEntry: false })) throw new Error('Q_ARCHIVE_GIT_METADATA_FORBIDDEN');
  const resolvedVenv = realpathSync(qVenv);
  if (!statSync(path.join(resolvedVenv, 'bin/python'), { throwIfNoEntry: false })?.isFile()) throw new Error('Q_VENV_PYTHON_MISSING');
  symlinkSync(resolvedVenv, path.join(quantRoot, '.venv'), 'dir');
  const venvProvenance = Object.freeze({
    resolvedPathSha256: sha256(resolvedVenv),
    pythonSha256: sha256(readFileSync(path.join(resolvedVenv, 'bin/python'))),
    integrity: await inspectAcceptedQVenv({ quantRoot, resolvedVenv, environment }),
  });
  const qEnvironment = safeEnvironment(tempRoot, {
    PYTHONPATH: 'src',
    PYTHONNOUSERSITE: '1',
    PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1',
  });
  const focused = await runCommand({
    id: 'q_exact_donor_q17',
    command: [path.join(quantRoot, '.venv/bin/python'), '-m', 'pytest', '-p', '_hypothesis_pytestplugin', '-p', 'pytest_cov.plugin', 'tests/q17', '-q', '--cov=quant_edge.final_proof', '--cov-branch', '--cov-report=term', '--tb=short'],
    cwd: quantRoot,
    environment: qEnvironment,
  });
  if (!focused.passed) return { provenance: { ...donor, venv: venvProvenance }, steps: [focused] };
  const complete = await runCommand({
    id: 'q_exact_donor_all',
    command: [path.join(quantRoot, '.venv/bin/python'), '-m', 'pytest', '-p', '_hypothesis_pytestplugin', '-p', 'pytest_cov.plugin', '-q', '--tb=short'],
    cwd: quantRoot,
    environment: qEnvironment,
  });
  return {
    provenance: { ...donor, venv: venvProvenance },
    steps: [focused, complete],
  };
}

async function verifyReportParity() {
  const module = await import('../render-reports.mjs');
  const closure = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/i00/closure-evidence.json'), 'utf8'));
  const generated = module.renderReports({ ...closure, generatedAtUtc: '2026-07-13T00:00:00Z' });
  const artifacts = [];
  for (const [relativePath, content] of Object.entries(generated)) {
    const current = readFileSync(path.join(ROOT, relativePath), 'utf8');
    artifacts.push({ relativePath, sha256: sha256(current), byteLength: Buffer.byteLength(current), matchesGenerator: current === content });
  }
  const evidence = module.buildMachineEvidence();
  const expectedMachine = `${JSON.stringify({ ...evidence, evidenceSha256: module.evidenceDigest(evidence) }, null, 2)}\n`;
  const machinePath = 'integration/reports/i00-proof-evidence.json';
  const currentMachine = readFileSync(path.join(ROOT, machinePath), 'utf8');
  artifacts.push({ relativePath: machinePath, sha256: sha256(currentMachine), byteLength: Buffer.byteLength(currentMachine), matchesGenerator: currentMachine === expectedMachine });
  return Object.freeze({
    id: 'generated_report_parity',
    command: [],
    cwdRelative: '.',
    startedAtUtc: new Date().toISOString(),
    endedAtUtc: new Date().toISOString(),
    durationMs: 0,
    exitCode: artifacts.every((artifact) => artifact.matchesGenerator) ? 0 : 1,
    exitSignal: null,
    timedOut: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: sha256(JSON.stringify(artifacts)),
    stderrSha256: sha256(''),
    parsedCounts: { artifacts: [artifacts.length] },
    secretFindings: [],
    outputOverflow: false,
    artifacts,
    passed: artifacts.every((artifact) => artifact.matchesGenerator),
  });
}

async function verifyReportParityAtRevision(environment, revision, tempRoot) {
  const sealedRoot = path.join(tempRoot, 'sealed-report-parity-untouched');
  const generatedRoot = path.join(tempRoot, 'sealed-report-parity-generated');
  for (const checkoutRoot of [sealedRoot, generatedRoot]) {
    await commandOutput('git', ['clone', '--no-hardlinks', '--no-checkout', '--quiet', ROOT, checkoutRoot], ROOT, environment, 8 * 1024 * 1024);
    await commandOutput('git', ['checkout', '--detach', '--quiet', revision], checkoutRoot, environment, 8 * 1024 * 1024);
    const observedHead = (await commandOutput(
      'git',
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      checkoutRoot,
      environment,
      1_024,
    )).toString('utf8').trim();
    if (observedHead !== revision) throw new Error('SEALED_REPORT_PARITY_CHECKOUT_MISMATCH');
  }

  const regeneration = await runCommand({
    id: 'sealed_report_regeneration',
    command: [process.execPath, 'test/i00/render-reports.mjs', '--write'],
    cwd: generatedRoot,
    environment,
  });
  const artifacts = [];
  for (const relativePath of GENERATED_REPORT_PATHS) {
    const sealedBytes = readFileSync(path.join(sealedRoot, relativePath));
    const generatedBytes = readFileSync(path.join(generatedRoot, relativePath));
    artifacts.push({
      relativePath,
      sha256: sha256(sealedBytes),
      byteLength: sealedBytes.length,
      generatedSha256: sha256(generatedBytes),
      generatedByteLength: generatedBytes.length,
      matchesGenerator: sealedBytes.equals(generatedBytes),
    });
  }
  return Object.freeze({
    id: 'sealed_generated_report_parity',
    revision,
    regeneration,
    artifacts: Object.freeze(artifacts),
    passed: regeneration.passed && artifacts.every((artifact) => artifact.matchesGenerator),
  });
}

export function validateBrowserDocument(document, expectedHead, expectedTree, schema = JSON.parse(readFileSync(BROWSER_SCHEMA_PATH, 'utf8'))) {
  const validation = validateJsonSchema(schema, document);
  const semanticFailures = [];
  if (document.source?.headSha !== expectedHead) semanticFailures.push('BROWSER_HEAD_SHA_MISMATCH');
  if (document.source?.treeSha !== expectedTree) semanticFailures.push('BROWSER_TREE_SHA_MISMATCH');
  if (document.source?.captureProvenance !== BROWSER_CAPTURE_PROVENANCE
      || typeof document.source?.captureSessionId !== 'string'
      || !document.source?.captureTranscriptPath?.startsWith(BROWSER_EVIDENCE_PREFIX)
      || !/^[a-f0-9]{64}$/u.test(document.source?.captureTranscriptSha256 ?? '')) semanticFailures.push('BROWSER_CAPTURE_PROVENANCE_INVALID');
  const runs = Array.isArray(document.runs) ? document.runs : [];
  if (runs.length !== 6) semanticFailures.push('BROWSER_RUN_COUNT_INVALID');
  const runKeys = runs.map((run) => run.runKey);
  if (new Set(runKeys).size !== runKeys.length || runKeys.toSorted().join('\0') !== MANDATORY_BROWSER_RUNS.toSorted().join('\0')) semanticFailures.push('BROWSER_RUN_SET_INVALID');
  for (const run of runs) {
    const expectedKey = `${run.width}x${run.height}@${run.zoom}-${run.theme}`;
    if (run.runKey !== expectedKey) semanticFailures.push(`BROWSER_RUN_GEOMETRY_MISMATCH:${run.runKey}`);
    const routes = Array.isArray(run.routes) ? run.routes : [];
    const routeIds = routes.map((route) => route.routeId);
    if (new Set(routeIds).size !== routeIds.length || routeIds.toSorted().join('\0') !== MANDATORY_BROWSER_ROUTES.toSorted().join('\0')) semanticFailures.push(`BROWSER_ROUTE_SET_INVALID:${run.runKey}`);
    if (routes.some((route) => route.path !== MANDATORY_BROWSER_ROUTE_PATHS[route.routeId])) semanticFailures.push(`BROWSER_ROUTE_PATH_MAPPING_INVALID:${run.runKey}`);
    if (run.reducedMotionChecked !== true || run.sourceTimestampsChecked !== true || run.stateLabelsChecked !== true || run.controlMappingsChecked !== true) semanticFailures.push(`BROWSER_EVIDENCE_DIMENSION_MISSING:${run.runKey}`);
  }
  const routeRows = runs.flatMap((run) => Array.isArray(run.routes) ? run.routes : []);
  if (routeRows.length !== BROWSER_ROUTE_OBSERVATION_COUNT) semanticFailures.push('BROWSER_ROUTE_COUNT_INVALID');
  if (routeRows.some((route) => !route.rendered || route.consoleErrors !== 0 || route.overflowFailures !== 0 || route.controlFailures !== 0)) semanticFailures.push('BROWSER_ROUTE_CHECK_FAILED');
  if (document.restart?.performed !== true
      || !document.restart?.measurementPath?.startsWith(BROWSER_EVIDENCE_PREFIX)
      || !/^[a-f0-9]{64}$/u.test(document.restart?.measurementSha256 ?? '')) semanticFailures.push('BROWSER_RESTART_ARTIFACT_DECLARATION_INVALID');
  if (!document.truthChecks?.canonicalApiCompared || !document.truthChecks?.sourceTimestampsChecked || !document.truthChecks?.stateLabelsChecked || !document.truthChecks?.controlMappingsChecked || !document.truthChecks?.canonicalNonGreenRendered || !document.truthChecks?.noFalseGreen || document.truthChecks?.fakeControlsFound !== 0) semanticFailures.push('BROWSER_TRUTH_CHECK_FAILED');
  const bottomUp = document.bottomUpAudit;
  const expectedBottomOrder = MANDATORY_BOTTOM_UP_SURFACES.map((entry) => entry.pageId);
  const bottomOrder = Array.isArray(bottomUp?.order) ? bottomUp.order : [];
  const bottomEntries = Array.isArray(bottomUp?.entries) ? bottomUp.entries : [];
  if (bottomUp?.passed !== true
      || bottomOrder.join('\0') !== expectedBottomOrder.join('\0')
      || bottomEntries.length !== MANDATORY_BOTTOM_UP_SURFACES.length
      || bottomUp?.themes?.join('\0') !== 'LIGHT\0DARK'
      || (bottomUp?.sharedStyleCorrectionOccurred === true && bottomUp?.restartedAtCalendarAfterCorrection !== true)) {
    semanticFailures.push('BROWSER_BOTTOM_UP_AUDIT_INVALID');
  }
  for (let index = 0; index < MANDATORY_BOTTOM_UP_SURFACES.length; index += 1) {
    const expected = MANDATORY_BOTTOM_UP_SURFACES[index];
    const actual = bottomEntries[index];
    if (actual?.pageId !== expected.pageId || actual?.path !== expected.path) {
      semanticFailures.push(`BROWSER_BOTTOM_UP_MAPPING_INVALID:${expected.pageId}`);
      continue;
    }
    for (const [themeKey, runKey] of [['light', '1600x900@1-LIGHT'], ['dark', '1600x900@1-DARK']]) {
      const measurement = actual?.[themeKey];
      const route = runs.find((run) => run.runKey === runKey)?.routes?.find((candidate) => candidate.routeId === expected.routeId);
      if (measurement?.screenshotSha256 !== route?.screenshotSha256) semanticFailures.push(`BROWSER_BOTTOM_UP_SCREENSHOT_MISMATCH:${expected.pageId}:${themeKey}`);
      if (measurement?.screenshotPath !== route?.screenshotPath) semanticFailures.push(`BROWSER_BOTTOM_UP_SCREENSHOT_PATH_MISMATCH:${expected.pageId}:${themeKey}`);
    }
  }
  for (const themeKey of ['light', 'dark']) {
    const reference = bottomEntries[0]?.[themeKey];
    if (!reference || bottomEntries.some((entry) => (
      !Number.isFinite(entry?.[themeKey]?.frameX)
        || !Number.isFinite(entry?.[themeKey]?.frameY)
        || !Number.isFinite(entry?.[themeKey]?.frameWidth)
        || Math.abs(entry[themeKey].frameX - reference.frameX) > 0.5
        || Math.abs(entry[themeKey].frameY - reference.frameY) > 0.5
        || Math.abs(entry[themeKey].frameWidth - reference.frameWidth) > 0.5
    ))) semanticFailures.push(`BROWSER_BOTTOM_UP_FRAME_DRIFT:${themeKey}`);
  }
  const topbar = document.topbarAudit;
  const expectedTopbarOrder = MANDATORY_TOPBAR_PANELS.map((entry) => entry.panelId);
  const topbarOrder = Array.isArray(topbar?.order) ? topbar.order : [];
  const topbarEntries = Array.isArray(topbar?.entries) ? topbar.entries : [];
  if (topbar?.passed !== true
      || topbarOrder.join('\0') !== expectedTopbarOrder.join('\0')
      || topbarEntries.length !== MANDATORY_TOPBAR_PANELS.length
      || topbar?.themes?.join('\0') !== 'LIGHT\0DARK') {
    semanticFailures.push('BROWSER_TOPBAR_AUDIT_INVALID');
  }
  for (let index = 0; index < MANDATORY_TOPBAR_PANELS.length; index += 1) {
    const expected = MANDATORY_TOPBAR_PANELS[index];
    const actual = topbarEntries[index];
    if (actual?.panelId !== expected.panelId
        || actual?.triggerKey !== expected.triggerKey
        || actual?.headerHeightPx !== expected.headerHeightPx
        || actual?.shellWidthPx !== 398
        || actual?.shellHeightPx !== 486
        || actual?.screenshotMode !== 'FULL_VIEWPORT_WITH_OPEN_PANEL'
        || actual?.overflowFailures !== 0
        || actual?.footerBarCount !== 0
        || actual?.truthStateChecked !== true
        || actual?.controlsChecked !== true) {
      semanticFailures.push(`BROWSER_TOPBAR_PANEL_INVALID:${expected.panelId}`);
    }
  }
  if (document.passed !== true) semanticFailures.push('BROWSER_RECEIPT_NOT_PASSED');
  return Object.freeze({
    schemaValid: validation.passed,
    schemaErrors: validation.errors,
    semanticFailures: Object.freeze([...new Set(semanticFailures)].toSorted()),
    passed: validation.passed && semanticFailures.length === 0,
  });
}

function exactList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function matchesDesignFontFamily(actual, expectedFamily) {
  if (typeof actual !== 'string') return false;
  if (expectedFamily === 'UI') return /(?:^|[\s,"'])inter(?:variable)?(?:$|[\s,"'])/iu.test(actual);
  if (expectedFamily === 'MONO') return /mono|menlo|monaco|consolas|courier/iu.test(actual);
  return false;
}

function designRoleFailures(document) {
  const contracts = DESIGN_ROLE_CONTRACTS[document?.kind];
  if (!contracts) return ['DESIGN_KIND_UNSUPPORTED'];
  const failures = [];
  for (const role of document.roles ?? []) {
    if (role?.state !== 'MEASURED') continue;
    const contract = contracts[role.role];
    const computed = role.computed;
    if (!contract || computed === null || typeof computed !== 'object') {
      failures.push(`DESIGN_ROLE_CONTRACT_MISSING:${role?.role ?? 'UNKNOWN'}`);
      continue;
    }
    if (computed.display === 'none') failures.push(`DESIGN_ROLE_NOT_RENDERED:${role.role}`);
    for (const property of ['fontSizePx', 'fontWeight', 'lineHeightPx', 'letterSpacingPx', 'borderRadiusPx', 'borderWidthPx']) {
      const range = contract[property];
      if (!range) continue;
      const value = computed[property];
      const propertyCode = property.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase();
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) failures.push(`DESIGN_ROLE_${propertyCode}_MISMATCH:${role.role}`);
    }
    if (contract.fontFamily && !matchesDesignFontFamily(computed.fontFamily, contract.fontFamily)) failures.push(`DESIGN_ROLE_FONT_FAMILY_MISMATCH:${role.role}`);
    if (contract.fontVariantNumeric
        && (typeof computed.fontVariantNumeric !== 'string'
          || !computed.fontVariantNumeric.split(/\s+/u).includes(contract.fontVariantNumeric))) failures.push(`DESIGN_ROLE_NUMERIC_VARIANT_MISMATCH:${role.role}`);
    if (contract.textTransform && computed.textTransform !== contract.textTransform) failures.push(`DESIGN_ROLE_TEXT_TRANSFORM_MISMATCH:${role.role}`);
  }
  return failures;
}

function browserArtifactDeclarations(document) {
  const declarations = [{
    relativePath: document.source?.captureTranscriptPath,
    expectedSha256: document.source?.captureTranscriptSha256,
    mediaType: 'application/vnd.i00.browser-capture+json',
    subjectId: document.source?.captureSessionId ?? 'UNKNOWN_CAPTURE_SESSION',
    theme: null,
    measurementKind: null,
    frame: null,
    panelMetrics: null,
    pngDimensions: null,
    captureKey: null,
    screenshotMode: null,
    derived: null,
  }, {
    relativePath: document.restart?.measurementPath,
    expectedSha256: document.restart?.measurementSha256,
    mediaType: 'application/vnd.i00.browser-restart-measurement+json',
    subjectId: 'websocket-service-restart',
    theme: null,
    measurementKind: null,
    frame: null,
    panelMetrics: null,
    pngDimensions: null,
    captureKey: null,
    screenshotMode: null,
    derived: null,
  }];
  for (const run of document.runs ?? []) {
    for (const route of run.routes ?? []) {
      declarations.push({
        relativePath: route.screenshotPath,
        expectedSha256: route.screenshotSha256,
        mediaType: 'image/png',
        subjectId: `${run.runKey}:${route.routeId}`,
        theme: run.theme,
        measurementKind: null,
        frame: null,
        panelMetrics: null,
        pngDimensions: { width: run.width, height: run.height },
        captureKey: `${run.runKey}:${route.routeId}`,
        screenshotMode: 'FULL_VIEWPORT_ROUTE',
        derived: false,
      });
    }
  }
  for (const entry of document.bottomUpAudit?.entries ?? []) {
    for (const [themeKey, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      const measurement = entry[themeKey];
      declarations.push({
        relativePath: measurement?.measurementPath,
        expectedSha256: measurement?.measurementSha256,
        mediaType: 'application/json',
        subjectId: entry.pageId,
        theme,
        measurementKind: 'BOTTOM_UP_PAGE',
        frame: {
          x: measurement?.frameX,
          y: measurement?.frameY,
          width: measurement?.frameWidth,
          height: measurement?.frameHeight,
        },
        panelMetrics: null,
        pngDimensions: null,
        captureKey: null,
        screenshotMode: null,
        derived: null,
      });
      const routeId = MANDATORY_BOTTOM_UP_SURFACES.find((surface) => surface.pageId === entry.pageId)?.routeId;
      declarations.push({
        relativePath: measurement?.screenshotPath,
        expectedSha256: measurement?.screenshotSha256,
        mediaType: 'image/png',
        subjectId: `${entry.pageId}:${theme}`,
        theme,
        measurementKind: null,
        frame: null,
        panelMetrics: null,
        pngDimensions: { width: 1600, height: 900 },
        captureKey: `1600x900@1-${theme}:${routeId}`,
        screenshotMode: 'FULL_VIEWPORT_ROUTE',
        derived: false,
      });
    }
  }
  for (const entry of document.topbarAudit?.entries ?? []) {
    for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      declarations.push({
        relativePath: entry[`${prefix}MeasurementPath`],
        expectedSha256: entry[`${prefix}MeasurementSha256`],
        mediaType: 'application/json',
        subjectId: entry.panelId,
        theme,
        measurementKind: 'TOPBAR_PANEL',
        frame: null,
        panelMetrics: {
          shellWidthPx: entry.shellWidthPx,
          shellHeightPx: entry.shellHeightPx,
          headerHeightPx: entry.headerHeightPx,
        },
        pngDimensions: null,
        captureKey: null,
        screenshotMode: null,
        derived: null,
      });
      declarations.push({
        relativePath: entry[`${prefix}ScreenshotPath`],
        expectedSha256: entry[`${prefix}ScreenshotSha256`],
        mediaType: 'image/png',
        subjectId: `${entry.panelId}:${theme}`,
        theme,
        measurementKind: null,
        frame: null,
        panelMetrics: null,
        pngDimensions: { width: 1600, height: 900 },
        captureKey: `TOPBAR:${theme}:${entry.panelId}`,
        screenshotMode: 'FULL_VIEWPORT_WITH_OPEN_PANEL',
        derived: false,
      });
    }
  }
  return declarations;
}

function measurementSemanticFailures(document, declaration, browserDocument) {
  const failures = [];
  if (document?.source?.headSha !== browserDocument.source?.headSha
      || document?.source?.treeSha !== browserDocument.source?.treeSha
      || document?.source?.appOrigin !== browserDocument.source?.appOrigin) failures.push('SOURCE_MISMATCH');
  if (document?.source?.captureProvenance !== BROWSER_CAPTURE_PROVENANCE
      || document?.source?.captureProvenance !== browserDocument.source?.captureProvenance
      || document?.source?.captureSessionId !== browserDocument.source?.captureSessionId
      || document?.source?.captureTranscriptPath !== browserDocument.source?.captureTranscriptPath
      || document?.source?.captureTranscriptSha256 !== browserDocument.source?.captureTranscriptSha256) failures.push('CAPTURE_PROVENANCE_MISMATCH');
  if (document?.kind !== declaration.measurementKind) failures.push('KIND_MISMATCH');
  if (document?.subjectId !== declaration.subjectId) failures.push('SUBJECT_MISMATCH');
  if (document?.theme !== declaration.theme) failures.push('THEME_MISMATCH');
  if (document?.viewport?.width !== 1600 || document?.viewport?.height !== 900 || document?.viewport?.zoom !== 1) failures.push('VIEWPORT_MISMATCH');
  if (document?.documentOverflowX !== 0 || document?.surfaceOverflowX !== 0 || document?.passed !== true) failures.push('OVERFLOW_OR_PASS_INVALID');
  const roles = Array.isArray(document?.roles) ? document.roles : [];
  const roleNames = roles.map((role) => role.role);
  const expectedRoles = declaration.measurementKind === 'BOTTOM_UP_PAGE'
    ? BOTTOM_UP_ROLE_ORDER
    : TOPBAR_ROLE_ORDER;
  if (!exactList(roleNames, expectedRoles)) failures.push('ROLE_SET_OR_ORDER_INVALID');
  if (roles.some((role) => (
    (role.state === 'MEASURED' && (typeof role.selector !== 'string' || role.computed === null))
      || (role.state === 'NOT_APPLICABLE' && (role.selector !== null || role.computed !== null))
  ))) failures.push('ROLE_MEASUREMENT_INVALID');
  failures.push(...designRoleFailures(document));
  if (declaration.measurementKind === 'BOTTOM_UP_PAGE') {
    if (document?.panelMetrics !== null || document?.footerBarCount !== 0) failures.push('PAGE_PANEL_FIELDS_INVALID');
    for (const key of ['x', 'y', 'width', 'height']) {
      if (document?.frameRect?.[key] !== declaration.frame?.[key]) failures.push(`FRAME_${key.toUpperCase()}_MISMATCH`);
    }
    if (roles.find((role) => role.role === 'frame')?.state !== 'MEASURED'
        || roles.find((role) => role.role === 'title')?.state !== 'MEASURED') failures.push('PAGE_CORE_ROLE_MISSING');
  } else {
    if (document?.frameRect?.width !== declaration.panelMetrics?.shellWidthPx
        || document?.frameRect?.height !== declaration.panelMetrics?.shellHeightPx
        || document?.panelMetrics?.shellWidthPx !== declaration.panelMetrics?.shellWidthPx
        || document?.panelMetrics?.shellHeightPx !== declaration.panelMetrics?.shellHeightPx
        || document?.panelMetrics?.headerHeightPx !== declaration.panelMetrics?.headerHeightPx
        || document?.footerBarCount !== 0) failures.push('PANEL_GEOMETRY_MISMATCH');
    if (roles.some((role) => role.state !== 'MEASURED')) failures.push('PANEL_TYPE_ROLE_MISSING');
  }
  return failures;
}

function restartMeasurementSemanticFailures(document, browserDocument) {
  const failures = [];
  if (document?.source?.headSha !== browserDocument.source?.headSha
      || document?.source?.treeSha !== browserDocument.source?.treeSha
      || document?.source?.appOrigin !== browserDocument.source?.appOrigin) failures.push('SOURCE_MISMATCH');
  if (document?.source?.captureProvenance !== BROWSER_CAPTURE_PROVENANCE
      || document?.source?.captureProvenance !== browserDocument.source?.captureProvenance
      || document?.source?.captureSessionId !== browserDocument.source?.captureSessionId
      || document?.source?.captureTranscriptPath !== browserDocument.source?.captureTranscriptPath
      || document?.source?.captureTranscriptSha256 !== browserDocument.source?.captureTranscriptSha256) failures.push('CAPTURE_PROVENANCE_MISMATCH');
  if (document?.selector !== '#i00-ws-close-diagnostic'
      || document?.observationMethod !== 'IN_APP_BROWSER_MCP_DOM_READ') failures.push('DOM_SOURCE_INVALID');
  if (document?.status !== 'OBSERVED'
      || document?.code !== 1012
      || document?.reason !== 'service restart'
      || document?.wasClean !== true) failures.push('CLOSE_EVENT_INVALID');
  if (!Number.isInteger(document?.reconnectGeneration) || document.reconnectGeneration < 1) failures.push('RECONNECT_GENERATION_INVALID');
  if (document?.postRestartRendered !== true || document?.passed !== true) failures.push('POST_RESTART_RENDER_INVALID');
  return failures;
}

const PRODUCT_TRUTH_LABELS = new Set([
  'LIVE_PUBLIC', 'WIRED', 'BUILT_AND_TESTED', 'IMPORTED', 'SYNTHETIC_ONLY',
  'BLOCKED', 'NOT_CONFIGURED', 'UNAVAILABLE', 'MISSING', 'UNKNOWN',
]);

function browserSupervisorProjection(raw, browserDocument, observationKey, phase) {
  const failures = [];
  const prefix = `ROUTE_API_${phase}:${observationKey}`;
  if (raw?.method !== 'GET'
      || !exactUtcTimestamp(raw?.observedAtUtc)
      || raw?.origin !== browserDocument.source?.appOrigin
      || raw?.path !== BROWSER_SUPERVISOR_PATH
      || raw?.status !== 200
      || raw?.redirected !== false
      || typeof raw?.contentType !== 'string'
      || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(raw.contentType)) failures.push(`${prefix}:TRANSPORT_INVALID`);
  const bodyUtf8 = typeof raw?.bodyUtf8 === 'string' ? raw.bodyUtf8 : '';
  const bodyBytes = Buffer.from(bodyUtf8, 'utf8');
  if (bodyBytes.length < 2 || bodyBytes.length > 2_097_152
      || raw?.byteLength !== bodyBytes.length
      || raw?.bodySha256 !== sha256(bodyBytes)) failures.push(`${prefix}:BODY_BINDING_INVALID`);
  let body = null;
  try {
    body = JSON.parse(bodyUtf8);
  } catch {
    failures.push(`${prefix}:JSON_INVALID`);
  }
  const claimedEnvelopeDigest = isPlainRecord(body) ? body.digest : null;
  let recomputedEnvelopeDigest = null;
  if (isPlainRecord(body)) {
    const { digest: _digest, ...unsignedBody } = body;
    recomputedEnvelopeDigest = `sha256:${sha256(JSON.stringify(unsignedBody))}`;
  }
  if (!isPlainRecord(body)
      || body.schemaVersion !== 'product-supervisor.v1'
      || typeof body.revision !== 'string' || body.revision.length < 1
      || !/^sha256:[a-f0-9]{64}$/u.test(claimedEnvelopeDigest ?? '')
      || claimedEnvelopeDigest !== recomputedEnvelopeDigest
      || !Number.isSafeInteger(body.evaluatedAtMs) || body.evaluatedAtMs < 0
      || !PRODUCT_TRUTH_LABELS.has(body.truthLabel)
      || typeof body.persistentSyntheticLabel !== 'boolean'
      || !isPlainRecord(body.ownerView)
      || !['YES', 'NO', 'UNKNOWN'].includes(body.ownerView.machineReady)
      || body.ownerView.tradeReady !== 'NO'
      || !['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY', 'BLOCKED', 'UNKNOWN'].includes(body.ownerView.effectiveMode)
      || !isPlainRecord(body.ownerView.revisions)
      || body.ownerView.revisions.testedCommit !== browserDocument.source?.headSha
      || body.ownerView.revisions.schemaRevision !== 'product-supervisor.v1') {
    failures.push(`${prefix}:CANONICAL_SHAPE_INVALID`);
    return { failures, projection: null };
  }
  const projection = Object.freeze({
    revision: body.revision,
    digest: body.digest,
    evaluatedAtMs: body.evaluatedAtMs,
    truthLabel: body.truthLabel,
    persistentSyntheticLabel: body.persistentSyntheticLabel,
    machineReady: body.ownerView.machineReady,
    tradeReady: body.ownerView.tradeReady,
    effectiveMode: body.ownerView.effectiveMode,
    testedCommit: body.ownerView.revisions.testedCommit,
    schemaRevision: body.ownerView.revisions.schemaRevision,
  });
  return { failures, projection };
}

function browserDomVisible(rect, viewportWidth, viewportHeight) {
  return Number.isFinite(rect?.x)
    && Number.isFinite(rect?.y)
    && Number.isFinite(rect?.width) && rect.width > 0
    && Number.isFinite(rect?.height) && rect.height > 0
    && Number.isInteger(rect?.clientRectCount) && rect.clientRectCount > 0
    && rect?.display !== 'none'
    && rect?.visibility === 'visible'
    && Number.isFinite(rect?.opacity) && rect.opacity > 0
    && rect?.hidden === false
    && rect?.ariaHidden !== 'true'
    && Number.isFinite(viewportWidth) && viewportWidth > 0
    && Number.isFinite(viewportHeight) && viewportHeight > 0
    && rect.x < viewportWidth
    && rect.y < viewportHeight
    && rect.x + rect.width > 0
    && rect.y + rect.height > 0;
}

function consoleQueryFailures(query, observationKey, phase) {
  const failures = [];
  const prefix = `ROUTE_CONSOLE_${phase}:${observationKey}`;
  const entries = Array.isArray(query?.entries) ? query.entries : [];
  if (query?.method !== 'IN_APP_BROWSER_MCP_DEV_LOGS'
      || !exactList(query?.levels, ['error'])
      || query?.limit !== BROWSER_CONSOLE_LIMIT
      || query?.returnedCount !== entries.length
      || entries.length >= BROWSER_CONSOLE_LIMIT
      || !Number.isFinite(query?.startedAtMs)
      || !Number.isFinite(query?.endedAtMs)
      || query.startedAtMs > query.endedAtMs) failures.push(`${prefix}:QUERY_INVALID`);
  let previousTimestamp = null;
  const identities = new Set();
  for (const entry of entries) {
    const timestamp = Date.parse(entry?.timestampUtc ?? '');
    const identity = canonicalJson(entry);
    if (!Number.isFinite(timestamp)
        || entry?.level !== 'error'
        || typeof entry?.message !== 'string' || entry.message.length < 1
        || (previousTimestamp !== null && timestamp <= previousTimestamp)
        || identities.has(identity)) failures.push(`${prefix}:ENTRY_INVALID`);
    previousTimestamp = timestamp;
    identities.add(identity);
  }
  return failures;
}

function routeObservationResult(observation, expected, browserDocument, previousEndedAtMs, previousConsoleEntries) {
  const failures = [];
  const key = expected.captureKey;
  if (observation?.observationOrdinal !== expected.ordinal
      || observation?.observationKey !== key
      || observation?.captureKey !== key
      || observation?.runKey !== expected.runKey
      || observation?.routeId !== expected.routeId
      || observation?.logicalPath !== expected.logicalPath
      || observation?.clockDomain !== 'NODE_MONOTONIC_MS') failures.push(`ROUTE_OBSERVATION_BINDING_INVALID:${key}`);
  const times = [
    observation?.consoleBefore?.startedAtMs,
    observation?.consoleBefore?.endedAtMs,
    observation?.startedAtMs,
    observation?.apiBefore?.monotonicMs,
    observation?.domReadAtMs,
    observation?.screenshotAtMs,
    observation?.apiAfter?.monotonicMs,
    observation?.endedAtMs,
    observation?.consoleAfter?.startedAtMs,
    observation?.consoleAfter?.endedAtMs,
  ];
  if (times.some((value) => !Number.isFinite(value))
      || times.some((value, index) => index > 0 && value < times[index - 1])
      || (previousEndedAtMs !== null && times[0] < previousEndedAtMs)) failures.push(`ROUTE_OBSERVATION_CHRONOLOGY_INVALID:${key}`);

  failures.push(...consoleQueryFailures(observation?.consoleBefore, key, 'BEFORE'));
  failures.push(...consoleQueryFailures(observation?.consoleAfter, key, 'AFTER'));
  const beforeEntries = Array.isArray(observation?.consoleBefore?.entries) ? observation.consoleBefore.entries : [];
  const afterEntries = Array.isArray(observation?.consoleAfter?.entries) ? observation.consoleAfter.entries : [];
  const consolePrefixValid = beforeEntries.length <= afterEntries.length
    && beforeEntries.every((entry, index) => exactJson(entry, afterEntries[index]));
  if (!consolePrefixValid) failures.push(`ROUTE_CONSOLE_BRACKET_INVALID:${key}`);
  if (expected.ordinal === 1 && beforeEntries.length !== 0) failures.push(`ROUTE_CONSOLE_SESSION_NOT_CLEAN:${key}`);
  if (expected.ordinal > 1 && !exactJson(beforeEntries, previousConsoleEntries ?? [])) {
    failures.push(`ROUTE_CONSOLE_CROSS_OBSERVATION_GAP:${key}`);
  }
  const consoleErrors = consolePrefixValid ? afterEntries.length - beforeEntries.length : Number.POSITIVE_INFINITY;

  const before = browserSupervisorProjection(observation?.apiBefore, browserDocument, key, 'BEFORE');
  const after = browserSupervisorProjection(observation?.apiAfter, browserDocument, key, 'AFTER');
  failures.push(...before.failures, ...after.failures);
  const stableProjectionOf = (projection) => projection === null ? null : Object.freeze({
    revision: projection.revision,
    truthLabel: projection.truthLabel,
    persistentSyntheticLabel: projection.persistentSyntheticLabel,
    machineReady: projection.machineReady,
    tradeReady: projection.tradeReady,
    effectiveMode: projection.effectiveMode,
    testedCommit: projection.testedCommit,
    schemaRevision: projection.schemaRevision,
  });
  const stableProjection = before.projection !== null
    && after.projection !== null
    && sha256(canonicalJson(stableProjectionOf(before.projection))) === sha256(canonicalJson(stableProjectionOf(after.projection)));
  if (!stableProjection) failures.push(`ROUTE_API_PROJECTION_MOVED:${key}`);

  const dom = observation?.dom;
  const frameIdentity = MANDATORY_BROWSER_FRAME_IDENTITIES[expected.routeId];
  const frameClassTokens = typeof dom?.frameClassName === 'string' ? dom.frameClassName.split(/\s+/u) : [];
  const frameVisible = dom?.frameSelector === '.app-page-frame'
    && dom?.frameMatchCount === 1
    && frameClassTokens.includes('app-page-frame')
    && frameClassTokens.includes(`frame-${frameIdentity}`)
    && dom?.frameAriaLabel === `${frameIdentity} workspace`
    && browserDomVisible(dom?.frame, expected.width, expected.height);
  const powerVisible = dom?.powerSelector === '[data-topbar-key="power"]'
    && dom?.powerMatchCount === 1
    && browserDomVisible(dom?.power, expected.width, expected.height);
  const indicatorVisible = dom?.indicatorSelector === '.execution-control-trigger-core'
    && dom?.indicatorMatchCount === 1
    && browserDomVisible(dom?.indicator, expected.width, expected.height);
  if (!frameVisible || !powerVisible || !indicatorVisible) failures.push(`ROUTE_DOM_NOT_VISIBLE:${key}`);
  const projection = before.projection;
  const expectedPowerLabel = projection === null ? null : `Execution Control — ${projection.effectiveMode.replaceAll('_', ' ')}`;
  const domEvaluatedAtMs = Number(dom?.attributes?.evaluatedAtMs);
  // The provider evaluates a fresh timestamp and digest on every read, so an
  // independent bracket cannot equal the earlier envelope already rendered by
  // React. Bind the exact stable owner projection and require the rendered
  // envelope provenance to be well-formed and no more than one poll window old;
  // do not claim exact volatile-response equality.
  const volatileEnvelopeProvenance = projection !== null
    && after.projection !== null
    && /^sha256:[a-f0-9]{64}$/u.test(dom?.attributes?.digest ?? '')
    && Number.isSafeInteger(domEvaluatedAtMs)
    && domEvaluatedAtMs >= Math.max(0, projection.evaluatedAtMs - 15_000)
    && domEvaluatedAtMs <= after.projection.evaluatedAtMs;
  const attributesCompared = projection !== null
    && dom?.attributes?.bindingState === 'OBSERVED'
    && dom?.attributes?.continuity === 'PROVEN'
    && dom?.attributes?.revision === projection.revision
    && volatileEnvelopeProvenance
    && dom?.attributes?.truthLabel === projection.truthLabel
    && dom?.attributes?.persistentSynthetic === String(projection.persistentSyntheticLabel)
    && dom?.attributes?.machineReady === projection.machineReady
    && dom?.attributes?.tradeReady === projection.tradeReady
    && dom?.attributes?.effectiveMode === projection.effectiveMode
    && dom?.attributes?.testedCommit === projection.testedCommit
    && dom?.attributes?.schemaRevision === projection.schemaRevision
    && dom?.powerTitle === expectedPowerLabel
    && dom?.powerAriaLabel === expectedPowerLabel;
  if (!attributesCompared) failures.push(`ROUTE_API_DOM_MISMATCH:${key}`);
  const indicatorTokens = typeof dom?.indicatorClassName === 'string'
    ? dom.indicatorClassName.split(/\s+/u)
    : [];
  const canonicalNonGreen = projection !== null
    && projection.tradeReady === 'NO'
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY', 'BLOCKED', 'UNKNOWN'].includes(projection.effectiveMode);
  const machineToneHonest = projection !== null
    && indicatorVisible
    && indicatorTokens.includes('warn')
    && !indicatorTokens.includes('ok');
  const canonicalNonGreenRendered = canonicalNonGreen && attributesCompared && machineToneHonest;
  const noFalseGreen = canonicalNonGreenRendered
    && !/(?:^|\s)(?:live|ready|pass)(?:\s|$)/iu.test(dom?.indicatorClassName ?? '')
    && !indicatorTokens.includes('ok')
    && !/\b(?:LIVE|READY|HEALTHY)\b/iu.test(dom?.powerAriaLabel ?? '');
  if (!canonicalNonGreenRendered) failures.push(`ROUTE_CANONICAL_NON_GREEN_NOT_RENDERED:${key}`);
  if (!noFalseGreen) failures.push(`ROUTE_FALSE_GREEN:${key}`);
  return Object.freeze({
    failures,
    consoleErrors,
    rendered: frameVisible,
    canonicalApiCompared: stableProjection && attributesCompared,
    canonicalNonGreenRendered,
    noFalseGreen,
    consoleAfterEntries: Object.freeze(structuredClone(afterEntries)),
    endedAtMs: Number.isFinite(observation?.consoleAfter?.endedAtMs) ? observation.consoleAfter.endedAtMs : previousEndedAtMs,
  });
}

function captureTranscriptSemanticFailures(document, browserDocument, declarations) {
  const failures = [];
  if (document?.captureProvenance !== BROWSER_CAPTURE_PROVENANCE
      || document?.schemaVersion !== 'i00.in-app-browser-mcp-capture.v3'
      || document?.observationContract !== 'I00_BROWSER_ROUTE_TRUTH_RECOMPUTE_V1'
      || document?.sessionId !== browserDocument.source?.captureSessionId
      || !exactUtcTimestamp(document?.capturedAtUtc)) failures.push('IDENTITY_MISMATCH');
  if (document?.source?.headSha !== browserDocument.source?.headSha
      || document?.source?.treeSha !== browserDocument.source?.treeSha
      || document?.source?.appOrigin !== browserDocument.source?.appOrigin) failures.push('SOURCE_MISMATCH');
  const expectedByPath = new Map();
  for (const declaration of declarations.filter((entry) => entry.mediaType === 'image/png')) {
    const existing = expectedByPath.get(declaration.relativePath);
    if (existing && (existing.captureKey !== declaration.captureKey
      || existing.expectedSha256 !== declaration.expectedSha256
      || existing.pngDimensions?.width !== declaration.pngDimensions?.width
      || existing.pngDimensions?.height !== declaration.pngDimensions?.height
      || existing.screenshotMode !== declaration.screenshotMode
      || existing.derived !== declaration.derived)) failures.push(`ALIAS_DECLARATION_INVALID:${declaration.relativePath}`);
    if (!existing) expectedByPath.set(declaration.relativePath, declaration);
  }
  const expected = [...expectedByPath.values()].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
  const captures = Array.isArray(document?.captures) ? document.captures : [];
  if (expected.length !== BROWSER_CAPTURE_COUNT || captures.length !== BROWSER_CAPTURE_COUNT) failures.push('SET_LENGTH_MISMATCH');
  for (let index = 0; index < Math.max(captures.length, expected.length); index += 1) {
    const actual = captures[index];
    const wanted = expected[index];
    if (!actual || !wanted
        || actual.sequence !== index + 1
        || actual.captureKey !== wanted.captureKey
        || actual.screenshotPath !== wanted.relativePath
        || actual.screenshotSha256 !== wanted.expectedSha256
        || actual.width !== wanted.pngDimensions?.width
        || actual.height !== wanted.pngDimensions?.height
        || actual.screenshotMode !== wanted.screenshotMode
        || actual.derived !== wanted.derived) failures.push(`BINDING_MISMATCH:${index + 1}`);
  }

  const routeCaptures = new Map(captures
    .filter((capture) => capture?.screenshotMode === 'FULL_VIEWPORT_ROUTE')
    .map((capture) => [capture.captureKey, capture]));
  const expectedObservationByKey = new Map();
  for (const runKey of MANDATORY_BROWSER_RUNS) {
    for (const routeId of MANDATORY_BROWSER_ROUTES) {
      const expectedObservation = Object.freeze({
        runKey,
        routeId,
        logicalPath: MANDATORY_BROWSER_ROUTE_PATHS[routeId],
        captureKey: `${runKey}:${routeId}`,
        width: Number.parseInt(runKey, 10),
        height: Number.parseInt(runKey.split('x')[1], 10),
      });
      expectedObservationByKey.set(expectedObservation.captureKey, expectedObservation);
    }
  }
  const observations = Array.isArray(document?.routeObservations) ? document.routeObservations : [];
  if (expectedObservationByKey.size !== BROWSER_ROUTE_OBSERVATION_COUNT
      || observations.length !== BROWSER_ROUTE_OBSERVATION_COUNT
      || routeCaptures.size !== BROWSER_ROUTE_OBSERVATION_COUNT) failures.push('ROUTE_OBSERVATION_SET_LENGTH_MISMATCH');
  const browserRouteByKey = new Map((browserDocument.runs ?? []).flatMap((run) => (run.routes ?? []).map((route) => [`${run.runKey}:${route.routeId}`, route])));
  let previousEndedAtMs = null;
  let previousConsoleEntries = null;
  const results = [];
  const observedKeys = new Set();
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    const expectedBase = expectedObservationByKey.get(observation?.captureKey);
    if (!observation || !expectedBase || observedKeys.has(observation.captureKey)) {
      failures.push(`ROUTE_OBSERVATION_BINDING_INVALID:${index + 1}`);
      continue;
    }
    observedKeys.add(observation.captureKey);
    const expectedObservation = Object.freeze({ ...expectedBase, ordinal: index + 1 });
    const capture = routeCaptures.get(expectedObservation.captureKey);
    if (!capture || capture.captureKey !== observation.captureKey) failures.push(`ROUTE_OBSERVATION_CAPTURE_MISMATCH:${expectedObservation.captureKey}`);
    const result = routeObservationResult(observation, expectedObservation, browserDocument, previousEndedAtMs, previousConsoleEntries);
    previousEndedAtMs = result.endedAtMs;
    previousConsoleEntries = result.consoleAfterEntries;
    results.push(result);
    failures.push(...result.failures);
    const receiptRoute = browserRouteByKey.get(expectedObservation.captureKey);
    if (!receiptRoute
        || receiptRoute.rendered !== result.rendered
        || receiptRoute.consoleErrors !== result.consoleErrors
        || receiptRoute.stateLabelState !== (result.canonicalApiCompared ? 'CANONICAL_COMPARED' : 'UNPROVEN')) {
      failures.push(`ROUTE_RECEIPT_RECOMPUTE_MISMATCH:${expectedObservation.captureKey}`);
    }
  }
  if (observedKeys.size !== expectedObservationByKey.size) failures.push('ROUTE_OBSERVATION_SET_INVALID');
  const canonicalApiCompared = results.length === BROWSER_ROUTE_OBSERVATION_COUNT && results.every((result) => result.canonicalApiCompared);
  const canonicalNonGreenRendered = results.length === BROWSER_ROUTE_OBSERVATION_COUNT && results.every((result) => result.canonicalNonGreenRendered);
  const noFalseGreen = results.length === BROWSER_ROUTE_OBSERVATION_COUNT && results.every((result) => result.noFalseGreen);
  if (browserDocument.truthChecks?.canonicalApiCompared !== canonicalApiCompared
      || browserDocument.truthChecks?.canonicalNonGreenRendered !== canonicalNonGreenRendered
      || browserDocument.truthChecks?.noFalseGreen !== noFalseGreen) failures.push('TRUTH_RECEIPT_RECOMPUTE_MISMATCH');
  if (document?.passed !== (failures.length === 0)) failures.push('TRANSCRIPT_PASS_RECOMPUTE_MISMATCH');
  return failures;
}

function isExactAccountWalletScreenshotAlias(left, right) {
  const pattern = /^((?:390x844@1|1600x900@1|2940x1200@1\.25)-(?:LIGHT|DARK)):(account|wallets)$/u;
  const leftMatch = pattern.exec(left.captureKey ?? '');
  const rightMatch = pattern.exec(right.captureKey ?? '');
  return leftMatch !== null
    && rightMatch !== null
    && leftMatch[1] === rightMatch[1]
    && new Set([leftMatch[2], rightMatch[2]]).size === 2
    && left.pngDimensions?.width === right.pngDimensions?.width
    && left.pngDimensions?.height === right.pngDimensions?.height;
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_COLOR_TYPE_CHANNELS = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
const PNG_ALLOWED_BIT_DEPTHS = Object.freeze({
  0: Object.freeze([1, 2, 4, 8, 16]),
  2: Object.freeze([8, 16]),
  3: Object.freeze([1, 2, 4, 8]),
  4: Object.freeze([8, 16]),
  6: Object.freeze([8, 16]),
});
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    table[value] = crc >>> 0;
  }
  return table;
})();

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngScanlineLayouts(width, height, bitsPerPixel, interlaceMethod) {
  if (interlaceMethod === 0) return [{ width, height }];
  const startsX = [0, 4, 0, 2, 0, 1, 0];
  const startsY = [0, 0, 4, 0, 2, 0, 1];
  const stepsX = [8, 8, 4, 4, 2, 2, 1];
  const stepsY = [8, 8, 8, 4, 4, 2, 2];
  return startsX.map((startX, index) => ({
    width: width <= startX ? 0 : Math.ceil((width - startX) / stepsX[index]),
    height: height <= startsY[index] ? 0 : Math.ceil((height - startsY[index]) / stepsY[index]),
  })).filter((layout) => layout.width > 0 && layout.height > 0).map((layout) => ({
    ...layout,
    rowBytes: Math.ceil((layout.width * bitsPerPixel) / 8),
  }));
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function validatePngScreenshot(bytes, expectedDimensions) {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'SCREENSHOT_PNG_SIGNATURE_INVALID';
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let ihdr = null;
  let paletteSeen = false;
  let idatSeen = false;
  let idatEnded = false;
  let iendSeen = false;
  const idatParts = [];
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return 'SCREENSHOT_PNG_CHUNK_TRUNCATED';
    const length = bytes.readUInt32BE(offset);
    if (length > 0x7fffffff || length > bytes.length - offset - 12) return 'SCREENSHOT_PNG_CHUNK_LENGTH_INVALID';
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(type)) return 'SCREENSHOT_PNG_CHUNK_TYPE_INVALID';
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== expectedCrc) return `SCREENSHOT_PNG_CRC_INVALID:${type}`;
    const data = bytes.subarray(dataStart, dataEnd);
    if (iendSeen) return 'SCREENSHOT_PNG_TRAILING_BYTES';
    if (chunkIndex === 0 && type !== 'IHDR') return 'SCREENSHOT_PNG_IHDR_NOT_FIRST';
    if (!['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type) && (typeBytes[0] & 0x20) === 0) return `SCREENSHOT_PNG_UNKNOWN_CRITICAL_CHUNK:${type}`;
    if (type === 'IHDR') {
      if (ihdr !== null || chunkIndex !== 0 || length !== 13) return 'SCREENSHOT_PNG_IHDR_INVALID';
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const compressionMethod = data[10];
      const filterMethod = data[11];
      const interlaceMethod = data[12];
      if (width === 0 || height === 0
          || !PNG_ALLOWED_BIT_DEPTHS[colorType]?.includes(bitDepth)
          || compressionMethod !== 0 || filterMethod !== 0
          || (interlaceMethod !== 0 && interlaceMethod !== 1)) return 'SCREENSHOT_PNG_IHDR_FIELDS_INVALID';
      if (width !== expectedDimensions.width || height !== expectedDimensions.height) return `SCREENSHOT_PNG_DIMENSIONS_MISMATCH:${width}x${height}:EXPECTED_${expectedDimensions.width}x${expectedDimensions.height}`;
      ihdr = { width, height, bitDepth, colorType, interlaceMethod };
    } else if (type === 'PLTE') {
      if (paletteSeen || idatSeen || length === 0 || length % 3 !== 0 || length > 768) return 'SCREENSHOT_PNG_PLTE_INVALID';
      paletteSeen = true;
    } else if (type === 'IDAT') {
      if (ihdr === null || idatEnded) return 'SCREENSHOT_PNG_IDAT_ORDER_INVALID';
      if (ihdr.colorType === 3 && !paletteSeen) return 'SCREENSHOT_PNG_PLTE_REQUIRED';
      idatSeen = true;
      idatParts.push(data);
    } else {
      if (idatSeen) idatEnded = true;
      if (type === 'IEND') {
        if (length !== 0 || iendSeen) return 'SCREENSHOT_PNG_IEND_INVALID';
        iendSeen = true;
      }
    }
    if (idatSeen && type !== 'IDAT') idatEnded = true;
    offset = dataEnd + 4;
    chunkIndex += 1;
  }
  if (ihdr === null) return 'SCREENSHOT_PNG_IHDR_MISSING';
  if (!idatSeen) return 'SCREENSHOT_PNG_IDAT_MISSING';
  if (!iendSeen) return 'SCREENSHOT_PNG_IEND_MISSING';
  if ((ihdr.colorType === 0 || ihdr.colorType === 4) && paletteSeen) return 'SCREENSHOT_PNG_PLTE_FORBIDDEN';
  const bitsPerPixel = PNG_COLOR_TYPE_CHANNELS[ihdr.colorType] * ihdr.bitDepth;
  const layouts = pngScanlineLayouts(ihdr.width, ihdr.height, bitsPerPixel, ihdr.interlaceMethod).map((layout) => ({
    ...layout,
    rowBytes: layout.rowBytes ?? Math.ceil((layout.width * bitsPerPixel) / 8),
  }));
  const expectedInflatedLength = layouts.reduce((sum, layout) => sum + ((layout.rowBytes + 1) * layout.height), 0);
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idatParts), { maxOutputLength: expectedInflatedLength + 1 });
  } catch {
    return 'SCREENSHOT_PNG_ZLIB_DECODE_FAILED';
  }
  if (inflated.length !== expectedInflatedLength) return `SCREENSHOT_PNG_SCANLINE_LENGTH_INVALID:${inflated.length}:EXPECTED_${expectedInflatedLength}`;
  let filterOffset = 0;
  for (const layout of layouts) {
    for (let row = 0; row < layout.height; row += 1) {
      if (inflated[filterOffset] > 4) return 'SCREENSHOT_PNG_FILTER_TYPE_INVALID';
      filterOffset += layout.rowBytes + 1;
    }
  }
  const totalPixelCount = layouts.reduce((sum, layout) => sum + (layout.width * layout.height), 0);
  if (totalPixelCount !== ihdr.width * ihdr.height) return 'SCREENSHOT_PNG_PIXEL_COUNT_INVALID';
  const minimumVariantPixels = Math.max(16, Math.ceil(totalPixelCount / 100000));
  let scanlineOffset = 0;
  let referencePixel = null;
  let variantPixelCount = 0;
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  let enoughVariance = false;
  for (const layout of layouts) {
    let priorRow = Buffer.alloc(layout.rowBytes);
    for (let row = 0; row < layout.height; row += 1) {
      const filterType = inflated[scanlineOffset];
      if (filterType > 4) return 'SCREENSHOT_PNG_FILTER_TYPE_INVALID';
      const filtered = inflated.subarray(scanlineOffset + 1, scanlineOffset + layout.rowBytes + 1);
      const reconstructed = Buffer.alloc(layout.rowBytes);
      for (let column = 0; column < layout.rowBytes; column += 1) {
        const left = column >= filterBytesPerPixel ? reconstructed[column - filterBytesPerPixel] : 0;
        const up = priorRow[column] ?? 0;
        const upLeft = column >= filterBytesPerPixel ? priorRow[column - filterBytesPerPixel] : 0;
        let predictor = 0;
        if (filterType === 1) predictor = left;
        else if (filterType === 2) predictor = up;
        else if (filterType === 3) predictor = Math.floor((left + up) / 2);
        else if (filterType === 4) predictor = paethPredictor(left, up, upLeft);
        reconstructed[column] = (filtered[column] + predictor) & 0xff;
      }
      if (bitsPerPixel >= 8) {
        const pixelBytes = bitsPerPixel / 8;
        for (let pixel = 0; pixel < layout.width; pixel += 1) {
          const start = pixel * pixelBytes;
          const candidate = reconstructed.subarray(start, start + pixelBytes);
          if (referencePixel === null) referencePixel = Buffer.from(candidate);
          else if (!candidate.equals(referencePixel)) variantPixelCount += 1;
          if (variantPixelCount >= minimumVariantPixels) {
            enoughVariance = true;
            break;
          }
        }
      } else {
        const sampleMask = (1 << ihdr.bitDepth) - 1;
        for (let pixel = 0; pixel < layout.width; pixel += 1) {
          const bitOffset = pixel * ihdr.bitDepth;
          const shift = 8 - ihdr.bitDepth - (bitOffset % 8);
          const candidate = (reconstructed[Math.floor(bitOffset / 8)] >>> shift) & sampleMask;
          if (referencePixel === null) referencePixel = candidate;
          else if (candidate !== referencePixel) variantPixelCount += 1;
          if (variantPixelCount >= minimumVariantPixels) {
            enoughVariance = true;
            break;
          }
        }
      }
      priorRow = reconstructed;
      scanlineOffset += layout.rowBytes + 1;
      if (enoughVariance) break;
    }
    if (enoughVariance) break;
  }
  if (variantPixelCount < minimumVariantPixels) return `SCREENSHOT_PNG_PIXEL_VARIANCE_INSUFFICIENT:${variantPixelCount}:MIN_${minimumVariantPixels}`;
  return null;
}

/**
 * Verify that every browser claim is backed by immutable bytes. The injected
 * reader keeps hostile tests filesystem-independent; production supplies the
 * contained repository reader below.
 */
export function validateBrowserArtifacts(
  document,
  readArtifact,
  measurementSchema = JSON.parse(readFileSync(BROWSER_MEASUREMENT_SCHEMA_PATH, 'utf8')),
  captureSchema = JSON.parse(readFileSync(BROWSER_CAPTURE_SCHEMA_PATH, 'utf8')),
  restartSchema = JSON.parse(readFileSync(BROWSER_RESTART_SCHEMA_PATH, 'utf8')),
) {
  const failures = [];
  const artifacts = new Map();
  const pngValidations = new Map();
  const pngPathBindings = new Map();
  const pngHashBindings = new Map();
  let restartMeasurement = null;
  const declarations = browserArtifactDeclarations(document);
  const declarationPathCount = new Set(declarations.map((declaration) => declaration.relativePath)).size;
  if (declarationPathCount !== BROWSER_ARTIFACT_COUNT) failures.push(`ARTIFACT_DECLARATION_COUNT_MISMATCH:${declarationPathCount}:EXPECTED_${BROWSER_ARTIFACT_COUNT}`);
  for (const declaration of declarations) {
    try {
      if (typeof declaration.relativePath !== 'string' || !declaration.relativePath.startsWith(BROWSER_EVIDENCE_PREFIX)) {
        failures.push(`ARTIFACT_PATH_INVALID:${declaration.subjectId}`);
        continue;
      }
      const bytes = readArtifact(declaration.relativePath);
      if (!Buffer.isBuffer(bytes) || bytes.length < 1) {
        failures.push(`ARTIFACT_BYTES_INVALID:${declaration.relativePath}`);
        continue;
      }
      const actualSha256 = sha256(bytes);
      if (actualSha256 !== declaration.expectedSha256) failures.push(`ARTIFACT_HASH_MISMATCH:${declaration.relativePath}`);
      const existing = artifacts.get(declaration.relativePath);
      if (existing && existing.sha256 !== actualSha256) failures.push(`ARTIFACT_PATH_COLLISION:${declaration.relativePath}`);
      artifacts.set(declaration.relativePath, Object.freeze({
        relativePath: declaration.relativePath,
        sha256: actualSha256,
        byteLength: bytes.length,
        mediaType: declaration.mediaType,
      }));
      if (declaration.mediaType === 'image/png') {
        const pathBinding = pngPathBindings.get(declaration.relativePath);
        if (pathBinding && pathBinding.captureKey !== declaration.captureKey) failures.push(`SCREENSHOT_PATH_REUSED_ACROSS_SUBJECTS:${declaration.relativePath}`);
        else if (!pathBinding) pngPathBindings.set(declaration.relativePath, declaration);
        const hashBinding = pngHashBindings.get(actualSha256);
        if (hashBinding
            && (hashBinding.captureKey !== declaration.captureKey || hashBinding.relativePath !== declaration.relativePath)
            && !isExactAccountWalletScreenshotAlias(hashBinding, declaration)) failures.push(`SCREENSHOT_HASH_REUSED_ACROSS_SUBJECTS:${actualSha256}`);
        else if (!hashBinding) pngHashBindings.set(actualSha256, declaration);
        const dimensions = declaration.pngDimensions;
        if (!Number.isInteger(dimensions?.width) || !Number.isInteger(dimensions?.height)) {
          failures.push(`SCREENSHOT_DIMENSIONS_UNBOUND:${declaration.relativePath}`);
          continue;
        }
        const validationKey = `${actualSha256}:${dimensions.width}x${dimensions.height}`;
        let pngFailure = pngValidations.get(validationKey);
        if (!pngValidations.has(validationKey)) {
          pngFailure = validatePngScreenshot(bytes, dimensions);
          pngValidations.set(validationKey, pngFailure);
        }
        if (pngFailure !== null) failures.push(`${pngFailure}:${declaration.relativePath}`);
        continue;
      }
      const text = bytes.toString('utf8');
      if (scanSecretText(text).length > 0) failures.push(`MEASUREMENT_SECRET_FINDING:${declaration.relativePath}`);
      const measurement = JSON.parse(text);
      if (declaration.mediaType === 'application/vnd.i00.browser-capture+json') {
        const schemaValidation = validateJsonSchema(captureSchema, measurement);
        if (!schemaValidation.passed) failures.push(`CAPTURE_SCHEMA_INVALID:${declaration.relativePath}`);
        for (const failure of captureTranscriptSemanticFailures(measurement, document, declarations)) {
          failures.push(`CAPTURE_${failure}:${declaration.relativePath}`);
        }
        continue;
      }
      if (declaration.mediaType === 'application/vnd.i00.browser-restart-measurement+json') {
        const schemaValidation = validateJsonSchema(restartSchema, measurement);
        const semanticFailures = restartMeasurementSemanticFailures(measurement, document);
        if (!schemaValidation.passed) failures.push(`RESTART_SCHEMA_INVALID:${declaration.relativePath}`);
        for (const failure of semanticFailures) failures.push(`RESTART_${failure}:${declaration.relativePath}`);
        if (schemaValidation.passed && semanticFailures.length === 0) restartMeasurement = measurement;
        continue;
      }
      const schemaValidation = validateJsonSchema(measurementSchema, measurement);
      if (!schemaValidation.passed) failures.push(`MEASUREMENT_SCHEMA_INVALID:${declaration.relativePath}`);
      for (const failure of measurementSemanticFailures(measurement, declaration, document)) {
        failures.push(`MEASUREMENT_${failure}:${declaration.relativePath}`);
      }
    } catch {
      failures.push(`ARTIFACT_READ_FAILED:${declaration.relativePath ?? declaration.subjectId}`);
    }
  }
  if (artifacts.size !== BROWSER_ARTIFACT_COUNT) failures.push(`ARTIFACT_SET_COUNT_MISMATCH:${artifacts.size}:EXPECTED_${BROWSER_ARTIFACT_COUNT}`);
  return Object.freeze({
    failures: Object.freeze([...new Set(failures)].toSorted()),
    artifacts: Object.freeze([...artifacts.values()].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'))),
    restart: restartMeasurement === null ? null : Object.freeze({
      performed: document.restart?.performed === true,
      diagnosticSelector: restartMeasurement.selector,
      status: restartMeasurement.status,
      code: restartMeasurement.code,
      reason: restartMeasurement.reason,
      wasClean: restartMeasurement.wasClean,
      reconnectGeneration: restartMeasurement.reconnectGeneration,
      postRestartRendered: restartMeasurement.postRestartRendered,
      measurementPath: document.restart?.measurementPath ?? null,
      measurementSha256: document.restart?.measurementSha256 ?? null,
    }),
    passed: declarations.length > 0 && restartMeasurement !== null && failures.length === 0,
  });
}

function readContainedBrowserArtifact(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith(BROWSER_EVIDENCE_PREFIX)) throw new Error('BROWSER_ARTIFACT_PATH_INVALID');
  const absolute = path.resolve(ROOT, relativePath);
  if (absolute === ROOT || !absolute.startsWith(`${ROOT}${path.sep}`)) throw new Error('BROWSER_ARTIFACT_OUTSIDE_REPOSITORY');
  const info = lstatSync(absolute, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error('BROWSER_ARTIFACT_MISSING_OR_UNSAFE');
  return readFileSync(absolute);
}

function validateBrowserReceipt(requested, expectedHead, expectedTree) {
  if (!requested) throw new Error('BROWSER_RECEIPT_REQUIRED_FOR_COMPLETE_LOCAL_ACCEPTANCE');
  const resolved = realpathSync(path.resolve(ROOT, requested));
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error('BROWSER_RECEIPT_OUTSIDE_REPOSITORY');
  const text = readFileSync(resolved, 'utf8');
  const findings = scanSecretText(text);
  const document = JSON.parse(text);
  const documentValidation = validateBrowserDocument(document, expectedHead, expectedTree);
  const artifactValidation = validateBrowserArtifacts(document, readContainedBrowserArtifact);
  return Object.freeze({
    relativePath: path.relative(ROOT, resolved),
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    runCount: Array.isArray(document.runs) ? document.runs.length : null,
    routeCaptureCount: Array.isArray(document.runs)
      ? document.runs.reduce((total, run) => total + (Array.isArray(run?.routes) ? run.routes.length : 0), 0)
      : null,
    artifactCount: artifactValidation.artifacts.length,
    restart: Object.freeze({
      performed: artifactValidation.restart?.performed ?? null,
      webSocketClose1012Observed: artifactValidation.restart?.status === 'OBSERVED'
        && artifactValidation.restart?.code === 1012
        && artifactValidation.restart?.reason === 'service restart'
        && artifactValidation.restart?.wasClean === true,
      postRestartRendered: artifactValidation.restart?.postRestartRendered ?? null,
      diagnosticSelector: artifactValidation.restart?.diagnosticSelector ?? null,
      reconnectGeneration: artifactValidation.restart?.reconnectGeneration ?? null,
      measurementPath: artifactValidation.restart?.measurementPath ?? null,
      measurementSha256: artifactValidation.restart?.measurementSha256 ?? null,
    }),
    schemaSha256: sha256(readFileSync(BROWSER_SCHEMA_PATH)),
    browserMeasurementSchemaSha256: sha256(readFileSync(BROWSER_MEASUREMENT_SCHEMA_PATH)),
    browserCaptureSchemaSha256: sha256(readFileSync(BROWSER_CAPTURE_SCHEMA_PATH)),
    browserRestartSchemaSha256: sha256(readFileSync(BROWSER_RESTART_SCHEMA_PATH)),
    schemaValid: documentValidation.schemaValid,
    schemaErrors: documentValidation.schemaErrors,
    semanticFailures: Object.freeze([
      ...documentValidation.semanticFailures,
      ...artifactValidation.failures,
    ]),
    artifacts: artifactValidation.artifacts,
    secretFindings: findings,
    passed: documentValidation.passed && artifactValidation.passed && findings.length === 0,
  });
}

function validatePerformanceReceipt(requested, expectedHead, expectedTree) {
  if (!requested) throw new Error('PERFORMANCE_RECEIPT_REQUIRED_FOR_VALIDATE_ONLY');
  const resolved = realpathSync(path.resolve(ROOT, requested));
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error('PERFORMANCE_RECEIPT_OUTSIDE_REPOSITORY');
  const text = readFileSync(resolved, 'utf8');
  const document = JSON.parse(text);
  const validation = validatePerformanceDocument(document, { headSha: expectedHead, treeSha: expectedTree });
  const secretFindings = scanSecretText(text);
  const snapshots = Array.isArray(document.phases)
    ? document.phases.flatMap((phase) => Array.isArray(phase?.snapshots) ? phase.snapshots : [])
    : [];
  const finalSnapshot = snapshots.at(-1) ?? {};
  return Object.freeze({
    relativePath: path.relative(ROOT, resolved),
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    schemaVersion: document.schemaVersion ?? null,
    overall: document.slo?.overall ?? null,
    canonicalRuntimeEvidence: Object.freeze({
      managedInventory: finalSnapshot.managedInventory ?? null,
      canonicalComponents: finalSnapshot.canonicalComponents ?? null,
      productControls: finalSnapshot.productControls ?? null,
    }),
    schemaValid: validation.schemaValid,
    schemaErrors: validation.schemaErrors,
    semanticFailures: validation.semanticFailures,
    secretFindings,
    passed: validation.passed && secretFindings.length === 0,
  });
}

async function validateBrowserReceiptAtRevision(environment, revision, requested, expectedHead, expectedTree) {
  if (!requested) throw new Error('BROWSER_RECEIPT_REQUIRED_FOR_COMPLETE_LOCAL_ACCEPTANCE');
  const receipt = await gitPathBytes(environment, revision, requested, 'BROWSER_RECEIPT', 16 * 1024 * 1024);
  const text = receipt.bytes.toString('utf8');
  const findings = scanSecretText(text);
  const document = JSON.parse(text);
  const documentValidation = validateBrowserDocument(document, expectedHead, expectedTree);
  const artifactPaths = [...new Set(browserArtifactDeclarations(document).map((entry) => entry.relativePath))];
  const artifactBytes = new Map();
  for (const relativePath of artifactPaths) {
    const artifact = await gitPathBytes(environment, revision, relativePath, 'BROWSER_ARTIFACT', 128 * 1024 * 1024);
    artifactBytes.set(relativePath, artifact.bytes);
  }
  const artifactValidation = validateBrowserArtifacts(document, (relativePath) => {
    const bytes = artifactBytes.get(relativePath);
    if (!bytes) throw new Error('BROWSER_ARTIFACT_NOT_PRELOADED');
    return bytes;
  });
  return Object.freeze({
    relativePath: receipt.relativePath,
    sha256: sha256(receipt.bytes),
    byteLength: receipt.bytes.length,
    runCount: Array.isArray(document.runs) ? document.runs.length : null,
    routeCaptureCount: Array.isArray(document.runs)
      ? document.runs.reduce((total, run) => total + (Array.isArray(run?.routes) ? run.routes.length : 0), 0)
      : null,
    artifactCount: artifactValidation.artifacts.length,
    restart: Object.freeze({
      performed: artifactValidation.restart?.performed ?? null,
      webSocketClose1012Observed: artifactValidation.restart?.status === 'OBSERVED'
        && artifactValidation.restart?.code === 1012
        && artifactValidation.restart?.reason === 'service restart'
        && artifactValidation.restart?.wasClean === true,
      postRestartRendered: artifactValidation.restart?.postRestartRendered ?? null,
      diagnosticSelector: artifactValidation.restart?.diagnosticSelector ?? null,
      reconnectGeneration: artifactValidation.restart?.reconnectGeneration ?? null,
      measurementPath: artifactValidation.restart?.measurementPath ?? null,
      measurementSha256: artifactValidation.restart?.measurementSha256 ?? null,
    }),
    schemaSha256: sha256(readFileSync(BROWSER_SCHEMA_PATH)),
    browserMeasurementSchemaSha256: sha256(readFileSync(BROWSER_MEASUREMENT_SCHEMA_PATH)),
    browserCaptureSchemaSha256: sha256(readFileSync(BROWSER_CAPTURE_SCHEMA_PATH)),
    browserRestartSchemaSha256: sha256(readFileSync(BROWSER_RESTART_SCHEMA_PATH)),
    schemaValid: documentValidation.schemaValid,
    schemaErrors: documentValidation.schemaErrors,
    semanticFailures: Object.freeze([...documentValidation.semanticFailures, ...artifactValidation.failures]),
    artifacts: artifactValidation.artifacts,
    secretFindings: findings,
    passed: documentValidation.passed && artifactValidation.passed && findings.length === 0,
  });
}

async function validatePerformanceReceiptAtRevision(environment, revision, requested, expectedHead, expectedTree) {
  if (!requested) throw new Error('PERFORMANCE_RECEIPT_REQUIRED_FOR_VALIDATE_ONLY');
  const receipt = await gitPathBytes(environment, revision, requested, 'PERFORMANCE_RECEIPT', 64 * 1024 * 1024);
  const text = receipt.bytes.toString('utf8');
  const document = JSON.parse(text);
  const validation = validatePerformanceDocument(document, { headSha: expectedHead, treeSha: expectedTree });
  const secretFindings = scanSecretText(text);
  const snapshots = Array.isArray(document.phases)
    ? document.phases.flatMap((phase) => Array.isArray(phase?.snapshots) ? phase.snapshots : [])
    : [];
  const finalSnapshot = snapshots.at(-1) ?? {};
  return Object.freeze({
    relativePath: receipt.relativePath,
    sha256: sha256(receipt.bytes),
    byteLength: receipt.bytes.length,
    schemaVersion: document.schemaVersion ?? null,
    overall: document.slo?.overall ?? null,
    canonicalRuntimeEvidence: Object.freeze({
      managedInventory: finalSnapshot.managedInventory ?? null,
      canonicalComponents: finalSnapshot.canonicalComponents ?? null,
      productControls: finalSnapshot.productControls ?? null,
    }),
    schemaValid: validation.schemaValid,
    schemaErrors: validation.schemaErrors,
    semanticFailures: validation.semanticFailures,
    secretFindings,
    passed: validation.passed && secretFindings.length === 0,
  });
}

export function validateCompleteReceiptDocument(
  document,
  expectedHead,
  expectedTree,
  performanceReceipt,
  browserReceipt,
  candidateManifest,
  initialEvidence,
  rawText = JSON.stringify(document),
) {
  const failures = [];
  const expectedIds = ACCEPTANCE_PLAN.map((step) => step.id);
  const expectedKinds = ACCEPTANCE_PLAN.map((step) => step.kind);
  const planIds = Array.isArray(document.plan) ? document.plan.map((step) => step.id) : [];
  const planKinds = Array.isArray(document.plan) ? document.plan.map((step) => step.kind) : [];
  const planCommandsValid = Array.isArray(document.plan)
    && document.plan.length === ACCEPTANCE_PLAN.length
    && document.plan.every((step, index) => exactList(step?.command, ACCEPTANCE_PLAN[index].command));
  const steps = Array.isArray(document.steps) ? document.steps : [];
  const stepIds = steps.map((step) => step.id);
  if (document.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION || document.truthClass !== 'LOCAL_COMPLETE_ACCEPTANCE_MEASURED') failures.push('COMPLETE_RECEIPT_IDENTITY_INVALID');
  if (document.source?.branch !== 'i00-product-assembly-20260713'
      || document.source?.headSha !== expectedHead
      || document.source?.treeSha !== expectedTree) failures.push('COMPLETE_RECEIPT_SOURCE_MISMATCH');
  if (!exactList(planIds, expectedIds) || !exactList(planKinds, expectedKinds) || !planCommandsValid) failures.push('COMPLETE_RECEIPT_PLAN_INVALID');
  if (!exactList(stepIds, expectedIds)) failures.push('COMPLETE_RECEIPT_STEP_SET_INVALID');
  if (steps.some((step) => step?.passed !== true
      || step?.exitCode !== 0
      || step?.exitSignal !== null
      || step?.timedOut !== false
      || step?.outputOverflow !== false
      || !Array.isArray(step?.secretFindings)
      || step.secretFindings.length !== 0)) failures.push('COMPLETE_RECEIPT_STEP_FAILED');
  if (steps.some((step) => !completeStepMeasurementValid(step))) failures.push('COMPLETE_RECEIPT_STEP_MEASUREMENT_INVALID');
  if (steps.some((step, index) => !completeStepCommandValid(step, ACCEPTANCE_PLAN[index], expectedHead))) failures.push('COMPLETE_RECEIPT_STEP_COMMAND_INVALID');
  if (!Array.isArray(document.missingSteps) || document.missingSteps.length !== 0) failures.push('COMPLETE_RECEIPT_MISSING_STEPS');
  if (document.qExactDonor?.donorSha !== Q_DONOR_SHA
      || document.qExactDonor?.donorTree !== Q_DONOR_TREE
      || document.qExactDonor?.receiptSha256 !== Q_RECEIPT_SHA256
      || !qVenvProvenanceValid(document.qExactDonor?.venv)) failures.push('COMPLETE_RECEIPT_Q_PROVENANCE_INVALID');
  if (document.performanceReceipt?.relativePath !== performanceReceipt.relativePath
      || document.performanceReceipt?.sha256 !== performanceReceipt.sha256
      || document.performanceReceipt?.passed !== true
      || performanceReceipt.passed !== true) failures.push('COMPLETE_RECEIPT_PERFORMANCE_BINDING_INVALID');
  if (document.browserReceipt?.relativePath !== browserReceipt.relativePath
      || document.browserReceipt?.sha256 !== browserReceipt.sha256
      || document.browserReceipt?.passed !== true
      || browserReceipt.passed !== true) failures.push('COMPLETE_RECEIPT_BROWSER_BINDING_INVALID');
  if (document.sourceFreeze?.format !== candidateManifest.format
      || document.sourceFreeze?.sha256 !== candidateManifest.sha256
      || document.sourceFreeze?.fileCount !== candidateManifest.fileCount
      || !protectedOwnerDirectiveHashesValid(candidateManifest.protectedOwnerDirectives)
      || !measuredProtectedOwnerDirectivesValid(document.sourceFreeze?.protectedOwnerDirectives)
      || !evidenceBindingMatches(document.sourceFreeze?.evidence, initialEvidence)) failures.push('COMPLETE_RECEIPT_CANDIDATE_MANIFEST_INVALID');
  const sourceFreezeStep = steps.find((step) => step.id === 'source_freeze');
  const expectedPerformanceEvidence = evidenceManifestShape([performanceReceipt]);
  if (sourceFreezeStep?.initial?.sha256 !== sourceFreezeStep?.final?.sha256
      || sourceFreezeStep?.initial?.fileCount !== sourceFreezeStep?.final?.fileCount
      || sourceFreezeStep?.initialEvidence?.sha256 !== sourceFreezeStep?.finalInitialEvidence?.sha256
      || sourceFreezeStep?.initial?.sha256 !== candidateManifest.sha256
      || sourceFreezeStep?.initial?.fileCount !== candidateManifest.fileCount
      || !evidenceBindingMatches(sourceFreezeStep?.initialEvidence, initialEvidence)
      || !evidenceBindingMatches(sourceFreezeStep?.finalInitialEvidence, initialEvidence)
      || !evidenceBindingMatches(sourceFreezeStep?.performanceEvidence, expectedPerformanceEvidence)) failures.push('COMPLETE_RECEIPT_SOURCE_FREEZE_INVALID');
  const boundary = document.externalBoundary;
  if (boundary?.privateReads !== 'OWNER_GATED_NOT_RUN'
      || boundary?.signedCalls !== 'OWNER_GATED_NOT_RUN'
      || boundary?.awsCloudflare !== 'OWNER_GATED_NOT_RUN'
      || boundary?.deployPush !== 'NOT_RUN'
      || boundary?.moneyPaths !== 'FORBIDDEN_NOT_RUN') failures.push('COMPLETE_RECEIPT_EXTERNAL_BOUNDARY_INVALID');
  if (document.secretScan?.passed !== true
      || !Array.isArray(document.secretScan?.findings)
      || document.secretScan.findings.length !== 0
      || scanSecretText(rawText).length !== 0) failures.push('COMPLETE_RECEIPT_SECRET_SCAN_INVALID');
  if (document.passed !== true) failures.push('COMPLETE_RECEIPT_NOT_PASSED');
  return Object.freeze({
    semanticFailures: Object.freeze([...new Set(failures)].toSorted()),
    passed: failures.length === 0,
  });
}

function completeStepMeasurementValid(step) {
  return Number.isFinite(step?.durationMs) && step.durationMs >= 0
    && Number.isSafeInteger(step?.stdoutBytes) && step.stdoutBytes >= 0
    && Number.isSafeInteger(step?.stderrBytes) && step.stderrBytes >= 0
    && /^[0-9a-f]{64}$/u.test(step?.stdoutSha256 ?? '')
    && /^[0-9a-f]{64}$/u.test(step?.stderrSha256 ?? '')
    && isPlainRecord(step?.parsedCounts)
    && Object.keys(step.parsedCounts).length <= 32
    && Object.values(step.parsedCounts).every((values) => (
      Array.isArray(values)
      && values.length <= 1_000
      && values.every((value) => Number.isSafeInteger(value) && value >= 0)
    ));
}

function completeStepSummary(step) {
  return Object.freeze({
    id: step.id,
    command: Object.freeze([...step.command]),
    exitCode: step.exitCode,
    exitSignal: step.exitSignal,
    durationMs: step.durationMs,
    stdoutBytes: step.stdoutBytes,
    stderrBytes: step.stderrBytes,
    stdoutSha256: step.stdoutSha256,
    stderrSha256: step.stderrSha256,
    parsedCounts: Object.freeze(structuredClone(step.parsedCounts)),
    passed: step.passed,
  });
}

function qVenvProvenanceValid(venv) {
  const integrity = venv?.integrity;
  return /^[0-9a-f]{64}$/u.test(venv?.resolvedPathSha256 ?? '')
    && /^[0-9a-f]{64}$/u.test(venv?.pythonSha256 ?? '')
    && integrity?.implementation === 'CPython'
    && integrity?.pythonVersion === Q_ACCEPTED_PYTHON_VERSION
    && integrity?.pyprojectSha256 === Q_PYPROJECT_SHA256
    && integrity?.uvLockSha256 === Q_UV_LOCK_SHA256
    && integrity?.manifestSha256 === Q_ACCEPTED_VENV_MANIFEST_SHA256
    && Number.isSafeInteger(integrity?.distributionCount)
    && integrity.distributionCount > 0
    && integrity?.pipCheck?.exitCode === 0
    && /^[0-9a-f]{64}$/u.test(integrity?.pipCheck?.stdoutSha256 ?? '')
    && /^[0-9a-f]{64}$/u.test(integrity?.pipCheck?.stderrSha256 ?? '')
    && integrity?.pipCheck?.passed === true
    && integrity?.pytestPluginPolicy?.autoLoad === 'DISABLED'
    && exactList(integrity?.pytestPluginPolicy?.explicit, ['_hypothesis_pytestplugin', 'pytest_cov.plugin']);
}

function evidenceManifestShape(receipts) {
  const entries = receipts.map((receipt) => Object.freeze({
    relativePath: receipt.relativePath,
    sha256: receipt.sha256,
    byteLength: receipt.byteLength,
  })).toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  return Object.freeze({ entries: Object.freeze(entries), sha256: sha256(JSON.stringify(entries)) });
}

function evidenceBindingMatches(document, expected) {
  return typeof document?.sha256 === 'string'
    && document.sha256 === expected?.sha256
    && Array.isArray(document?.entries)
    && Array.isArray(expected?.entries)
    && JSON.stringify(document.entries) === JSON.stringify(expected.entries);
}

function protectedOwnerDirectiveHashesValid(entries) {
  return exactJson(entries, PROTECTED_OWNER_DIRECTIVES);
}

function measuredProtectedOwnerDirectivesValid(entries) {
  return Array.isArray(entries)
    && exactJson(entries, PROTECTED_OWNER_DIRECTIVES.map((entry) => ({
      ...entry,
      gitStatus: 'UNTRACKED_PROTECTED_OWNER_INPUT',
    })));
}

function candidateManagedComponentInventory(performanceReceipt) {
  return Object.freeze({
    evidenceSource: Object.freeze({
      route: PRODUCT_SUPERVISOR_ROUTE,
      performanceReceiptPath: performanceReceipt.relativePath,
      performanceReceiptSha256: performanceReceipt.sha256,
      finalPhaseId: 'POST_CRASH_RECOVERY',
      finalSnapshotLabel: 'END',
    }),
    managedIdentities: structuredClone(performanceReceipt.canonicalRuntimeEvidence?.managedInventory ?? null),
    canonicalComponents: structuredClone(performanceReceipt.canonicalRuntimeEvidence?.canonicalComponents ?? null),
  });
}

function candidateControlInventory(performanceReceipt, controlCatalog) {
  const observedControls = performanceReceipt.canonicalRuntimeEvidence?.productControls ?? [];
  const catalogRuntimeIds = Array.isArray(controlCatalog?.rows)
    ? controlCatalog.rows.filter((row) => row?.runtimeControlId !== null).map((row) => row.runtimeControlId)
    : [];
  const observedIds = Array.isArray(observedControls) ? observedControls.map((row) => row?.controlId) : [];
  const runtimeOnly = observedIds.filter((controlId) => !catalogRuntimeIds.includes(controlId));
  return Object.freeze({
    declaredCatalog: structuredClone(controlCatalog),
    observedProductRuntime: Object.freeze({
      evidenceSource: Object.freeze({
        route: PRODUCT_SUPERVISOR_ROUTE,
        performanceReceiptPath: performanceReceipt.relativePath,
        performanceReceiptSha256: performanceReceipt.sha256,
        finalPhaseId: 'POST_CRASH_RECOVERY',
        finalSnapshotLabel: 'END',
      }),
      observedCount: observedIds.length,
      controls: structuredClone(observedControls),
    }),
    crosswalk: Object.freeze({
      mappedRuntimeCount: catalogRuntimeIds.filter((controlId) => observedIds.includes(controlId)).length,
      catalogOnlyBlockedCount: (controlCatalog?.declaredCount ?? 0) - catalogRuntimeIds.length,
      runtimeOnlyCount: runtimeOnly.length,
      exact: catalogRuntimeIds.length === PRODUCT_RUNTIME_CONTROL_IDS.length
        && runtimeOnly.length === 0
        && PRODUCT_RUNTIME_CONTROL_IDS.every((controlId) => catalogRuntimeIds.includes(controlId)),
    }),
  });
}

function candidateExternalBoundary(completeReceipt) {
  const boundary = completeReceipt.externalBoundary ?? {};
  const withEvidence = (id) => Object.freeze({
    status: boundary[id] ?? null,
    boundary: EXTERNAL_BOUNDARY_DETAIL[id].boundary,
  });
  return Object.freeze({
    evidenceSource: Object.freeze({
      completeReceiptPath: completeReceipt.relativePath,
      completeReceiptSha256: completeReceipt.sha256,
    }),
    privateReads: withEvidence('privateReads'),
    signedCalls: withEvidence('signedCalls'),
    awsCloudflare: withEvidence('awsCloudflare'),
    deployPush: withEvidence('deployPush'),
    moneyPaths: withEvidence('moneyPaths'),
  });
}

function candidateReceiptMeasurements(performanceReceipt, browserReceipt, completeReceipt) {
  return Object.freeze({
    completeAcceptance: Object.freeze({
      receiptPath: completeReceipt.relativePath,
      receiptSha256: completeReceipt.sha256,
      receiptByteLength: completeReceipt.byteLength,
      commandCount: completeReceipt.stepCount,
      passedCommandCount: completeReceipt.passedStepCount,
      failedCommandCount: completeReceipt.failedStepCount,
      commandResults: structuredClone(completeReceipt.commandResults ?? []),
      passed: completeReceipt.passed,
    }),
    browser: Object.freeze({
      receiptPath: browserReceipt.relativePath,
      receiptSha256: browserReceipt.sha256,
      receiptByteLength: browserReceipt.byteLength,
      runCount: browserReceipt.runCount,
      routeCaptureCount: browserReceipt.routeCaptureCount,
      artifactCount: browserReceipt.artifactCount,
      passed: browserReceipt.passed,
    }),
    performance: Object.freeze({
      receiptPath: performanceReceipt.relativePath,
      receiptSha256: performanceReceipt.sha256,
      receiptByteLength: performanceReceipt.byteLength,
      overall: performanceReceipt.overall,
      passed: performanceReceipt.passed,
    }),
    restart: Object.freeze({
      performed: browserReceipt.restart?.performed,
      webSocketCloseCode: browserReceipt.restart?.webSocketClose1012Observed === true ? 1012 : null,
      postRestartRendered: browserReceipt.restart?.postRestartRendered,
      passed: browserReceipt.restart?.performed === true
        && browserReceipt.restart?.webSocketClose1012Observed === true
        && browserReceipt.restart?.postRestartRendered === true,
    }),
  });
}

export function buildIntegrationCandidateReceiptDocument({
  candidateSha,
  candidateTreeSha,
  donorProof,
  performanceReceipt,
  browserReceipt,
  completeReceipt,
  controlCatalog,
  limitationSource,
  sourceManifest: sealedSourceManifest,
  evidenceManifest: sealedEvidenceManifest,
  limitations = EXPECTED_CANDIDATE_LIMITATIONS,
}) {
  return {
    schemaVersion: CANDIDATE_RECEIPT_SCHEMA_VERSION,
    receiptPath: CANDIDATE_RECEIPT_PATH,
    candidate: {
      branch: 'i00-product-assembly-20260713',
      commit: candidateSha,
      tree: candidateTreeSha,
    },
    donorEquality: {
      expected: donorProof.counts.expected,
      discovered: donorProof.counts.discovered,
      accepted: donorProof.counts.accepted,
      integrated: donorProof.counts.integrated,
      proof: `${donorProof.counts.expected}/${donorProof.counts.discovered}/${donorProof.counts.accepted}/${donorProof.counts.integrated}`,
    },
    donors: EXPECTED_ACCEPTED_DONORS.map((entry) => ({
      id: entry.id,
      tipSha: entry.tipSha,
      treeSha: entry.treeSha,
      integrationMethod: entry.integrationMethod,
      integrationCommit: entry.integrationCommit,
      acceptanceReceiptSha256s: [...entry.acceptanceReceiptSha256s],
      integrationReceiptSha256: entry.integrationReceiptSha256,
    })),
    donorProof: structuredClone(donorProof),
    protocolAndConfigHashes: EXPECTED_PROTOCOL_AND_CONFIG_HASHES.map((entry) => ({ ...entry })),
    measurements: candidateReceiptMeasurements(performanceReceipt, browserReceipt, completeReceipt),
    managedComponentInventory: candidateManagedComponentInventory(performanceReceipt),
    controlInventory: candidateControlInventory(performanceReceipt, controlCatalog),
    limitationSource: { ...limitationSource },
    manifests: {
      source: { ...sealedSourceManifest },
      evidenceScope: 'BROWSER_PERFORMANCE_COMPLETE_EXCLUDES_SELF',
      evidence: {
        entries: sealedEvidenceManifest.entries.map((entry) => ({ ...entry })),
        sha256: sealedEvidenceManifest.sha256,
      },
    },
    limitations: limitations.map((entry) => ({ ...entry })),
    externalBoundary: candidateExternalBoundary(completeReceipt),
    externalActions: 'NONE',
    selfCertification: 'NOT_SELF_CERTIFIED',
    verification: 'INDEPENDENT_VERIFICATION_REQUIRED',
    terminalState: [...CANDIDATE_TERMINAL_STATE],
  };
}

export function renderIntegrationCandidateReceiptMarkdown(document) {
  return `${CANDIDATE_RECEIPT_TITLE}${CANDIDATE_RECEIPT_BLOCK_BEGIN}${JSON.stringify(document, null, 2)}${CANDIDATE_RECEIPT_BLOCK_END}${CANDIDATE_RECEIPT_TERMINAL}`;
}

function parseIntegrationCandidateReceiptMarkdown(text) {
  const failures = [];
  if (typeof text !== 'string' || Buffer.byteLength(text) === 0 || Buffer.byteLength(text) > CANDIDATE_RECEIPT_MAX_BYTES) {
    failures.push('CANDIDATE_RECEIPT_SIZE_INVALID');
  }
  if (typeof text !== 'string'
      || !text.startsWith(CANDIDATE_RECEIPT_TITLE)
      || !text.endsWith(CANDIDATE_RECEIPT_TERMINAL)
      || text.split(CANDIDATE_RECEIPT_BLOCK_BEGIN).length !== 2
      || text.split(CANDIDATE_RECEIPT_BLOCK_END).length !== 2) {
    failures.push('CANDIDATE_RECEIPT_WRAPPER_INVALID');
  }
  if (typeof text === 'string' && scanSecretText(text).length !== 0) failures.push('CANDIDATE_RECEIPT_SECRET_TEXT');
  if (failures.length > 0) return Object.freeze({ document: null, failures: Object.freeze([...new Set(failures)].toSorted()) });
  const start = text.indexOf(CANDIDATE_RECEIPT_BLOCK_BEGIN) + CANDIDATE_RECEIPT_BLOCK_BEGIN.length;
  const end = text.indexOf(CANDIDATE_RECEIPT_BLOCK_END, start);
  const jsonText = text.slice(start, end);
  let document;
  try {
    document = JSON.parse(jsonText);
  } catch {
    return Object.freeze({ document: null, failures: Object.freeze(['CANDIDATE_RECEIPT_JSON_INVALID']) });
  }
  if (jsonText !== JSON.stringify(document, null, 2)) failures.push('CANDIDATE_RECEIPT_JSON_NOT_CANONICAL');
  return Object.freeze({ document, failures: Object.freeze(failures) });
}

function candidateCommandResultsShapeValid(results) {
  return Array.isArray(results)
    && results.length === ACCEPTANCE_PLAN.length
    && exactJson(results.map((result) => result?.id), ACCEPTANCE_PLAN.map((plan) => plan.id))
    && results.every((result) => (
      hasExactKeys(result, [
        'id', 'command', 'exitCode', 'exitSignal', 'durationMs', 'stdoutBytes', 'stderrBytes',
        'stdoutSha256', 'stderrSha256', 'parsedCounts', 'passed',
      ])
      && Array.isArray(result.command)
      && result.command.every((value) => typeof value === 'string')
      && result.exitCode === 0
      && result.exitSignal === null
      && completeStepMeasurementValid(result)
      && result.passed === true
    ));
}

function candidateManagedInventoryShapeValid(value) {
  if (!hasExactKeys(value, ['evidenceSource', 'managedIdentities', 'canonicalComponents'])) return false;
  if (!hasExactKeys(value.evidenceSource, [
    'route', 'performanceReceiptPath', 'performanceReceiptSha256', 'finalPhaseId', 'finalSnapshotLabel',
  ])) return false;
  const inventory = value.managedIdentities;
  if (!hasExactKeys(inventory, [
    'schemaVersion', 'expectedIdentityCount', 'mappedIdentityCount', 'evidencePresentCount',
    'ownerGatedCount', 'notConfiguredCount', 'missingCount', 'canonicalComponentCount',
    'referencedCanonicalComponentCount', 'observedCanonicalComponentCount', 'entries',
  ])) return false;
  if (inventory.schemaVersion !== 'i00-managed-inventory.v1'
      || inventory.expectedIdentityCount !== 33 || inventory.mappedIdentityCount !== 14
      || inventory.evidencePresentCount !== 14 || inventory.ownerGatedCount !== 13
      || inventory.notConfiguredCount !== 3 || inventory.missingCount !== 3
      || inventory.canonicalComponentCount !== 14
      || inventory.referencedCanonicalComponentCount !== 14
      || inventory.observedCanonicalComponentCount !== 14
      || !Array.isArray(inventory.entries) || inventory.entries.length !== 33
      || !exactJson(inventory.entries.map((entry) => entry?.identity), I00_MANAGED_COMPONENT_IDENTITIES)) return false;
  if (inventory.entries.some((entry) => (
    !hasExactKeys(entry, [
      'identity', 'owner', 'canonicalComponentIds', 'inventoryState', 'evidence', 'reasonCode',
    ])
    || typeof entry.owner !== 'string' || entry.owner.length === 0
    || !Array.isArray(entry.canonicalComponentIds)
    || entry.canonicalComponentIds.some((componentId) => !CANONICAL_SYSTEM_COMPONENT_IDS.includes(componentId))
    || !['EVIDENCE_PRESENT', 'OWNER_GATED', 'NOT_CONFIGURED', 'MISSING'].includes(entry.inventoryState)
    || (entry.inventoryState === 'EVIDENCE_PRESENT'
      ? entry.reasonCode !== null || !Array.isArray(entry.evidence)
        || entry.evidence.length !== entry.canonicalComponentIds.length
        || entry.evidence.some((evidence) => !hasExactKeys(evidence, [
          'source', 'componentId', 'componentProjectionIndex',
        ]))
      : entry.evidence !== null || typeof entry.reasonCode !== 'string' || entry.reasonCode.length === 0)
  ))) return false;
  return Array.isArray(value.canonicalComponents)
    && value.canonicalComponents.length === 14
    && exactJson(value.canonicalComponents.map((component) => component?.componentId), CANONICAL_SYSTEM_COMPONENT_IDS)
    && value.canonicalComponents.every((component) => hasExactKeys(component, [
      'componentId', 'owner', 'observedLifecycle', 'capability', 'blocker',
    ]));
}

function candidateControlInventoryShapeValid(value) {
  if (!hasExactKeys(value, ['declaredCatalog', 'observedProductRuntime', 'crosswalk'])) return false;
  const catalog = value.declaredCatalog;
  if (!hasExactKeys(catalog, [
    'sourcePath', 'candidateSha256', 'sealSha256', 'declaredCount', 'wiredSourceCount',
    'notConfiguredCount', 'ownerGatedCount', 'rows',
  ])
      || catalog.sourcePath !== PROOF_CATALOG_PATH
      || !/^[0-9a-f]{64}$/u.test(catalog.candidateSha256 ?? '')
      || !/^[0-9a-f]{64}$/u.test(catalog.sealSha256 ?? '')
      || catalog.declaredCount !== 14 || catalog.wiredSourceCount !== 4
      || catalog.notConfiguredCount !== 9 || catalog.ownerGatedCount !== 1
      || !Array.isArray(catalog.rows) || catalog.rows.length !== 14
      || catalog.rows.some((row) => !hasExactKeys(row, PROOF_CONTROL_ROW_KEYS))) return false;
  const observed = value.observedProductRuntime;
  if (!hasExactKeys(observed, ['evidenceSource', 'observedCount', 'controls'])
      || !hasExactKeys(observed.evidenceSource, [
        'route', 'performanceReceiptPath', 'performanceReceiptSha256', 'finalPhaseId', 'finalSnapshotLabel',
      ])
      || observed.observedCount !== 4
      || !Array.isArray(observed.controls) || observed.controls.length !== 4
      || !exactJson(observed.controls.map((control) => control?.controlId), PRODUCT_RUNTIME_CONTROL_IDS)
      || observed.controls.some((control) => !hasExactKeys(control, [
        'controlId', 'backendCommandId', 'wiringState', 'owner', 'authority', 'disabledReason',
      ]))) return false;
  return hasExactKeys(value.crosswalk, [
    'mappedRuntimeCount', 'catalogOnlyBlockedCount', 'runtimeOnlyCount', 'exact',
  ])
    && value.crosswalk.mappedRuntimeCount === 4
    && value.crosswalk.catalogOnlyBlockedCount === 10
    && value.crosswalk.runtimeOnlyCount === 0
    && value.crosswalk.exact === true;
}

function candidateExternalBoundaryShapeValid(value) {
  if (!hasExactKeys(value, [
    'evidenceSource', 'privateReads', 'signedCalls', 'awsCloudflare', 'deployPush', 'moneyPaths',
  ])
      || !hasExactKeys(value.evidenceSource, ['completeReceiptPath', 'completeReceiptSha256'])) return false;
  return Object.keys(EXTERNAL_BOUNDARY_DETAIL).every((id) => (
    hasExactKeys(value[id], ['status', 'boundary'])
    && value[id].status === EXTERNAL_BOUNDARY_DETAIL[id].status
    && value[id].boundary === EXTERNAL_BOUNDARY_DETAIL[id].boundary
  ));
}

function candidateDonorProofShapeValid(proof, candidate) {
  if (!hasExactKeys(proof, [
    'schemaVersion', 'status', 'candidate', 'counts', 'exactSets', 'integrationOrder',
    'mergeWindow', 'requiredLast', 'donors', 'exclusions', 'failures', 'proofSha256',
  ])) return false;
  const expectedIds = EXPECTED_ACCEPTED_DONORS.map((entry) => entry.id);
  if (proof.schemaVersion !== 'I00_DONOR_EQUALITY_PROOF_V1' || proof.status !== 'PASS'
      || !hasExactKeys(proof.candidate, ['sha', 'tree', 'objectType'])
      || proof.candidate.sha !== candidate?.commit || proof.candidate.tree !== candidate?.tree
      || proof.candidate.objectType !== 'commit'
      || !hasExactKeys(proof.counts, ['expected', 'discovered', 'accepted', 'integrated'])
      || !exactJson(proof.counts, { expected: 16, discovered: 16, accepted: 16, integrated: 16 })
      || !hasExactKeys(proof.exactSets, ['expected', 'discovered', 'accepted', 'integrated'])
      || Object.values(proof.exactSets).some((ids) => !exactJson(ids, expectedIds))
      || !Array.isArray(proof.failures) || proof.failures.length !== 0
      || !/^[0-9a-f]{64}$/u.test(proof.proofSha256 ?? '')) return false;
  if (!Array.isArray(proof.donors) || proof.donors.length !== 16
      || !exactJson(proof.donors.map((entry) => entry?.id), expectedIds)
      || proof.donors.some((entry) => (
        !hasExactKeys(entry, [
          'id', 'discovered', 'accepted', 'integrated', 'tip', 'worktree',
          'acceptanceReceipts', 'integration',
        ])
        || entry.discovered !== true || entry.accepted !== true || entry.integrated !== true
      ))) return false;
  if (!isPlainRecord(proof.integrationOrder)
      || !Array.isArray(proof.integrationOrder.expected) || proof.integrationOrder.expected.length !== 16
      || !Array.isArray(proof.integrationOrder.pairs) || proof.integrationOrder.pairs.length !== 15
      || proof.integrationOrder.pairs.some((pair) => pair?.isAncestor !== true)
      || !isPlainRecord(proof.mergeWindow) || !Array.isArray(proof.mergeWindow.observedSequence)
      || proof.mergeWindow.observedSequence.length !== 16
      || !Array.isArray(proof.mergeWindow.laterMerges) || proof.mergeWindow.laterMerges.length !== 0
      || !isPlainRecord(proof.requiredLast) || proof.requiredLast.noLaterMerge !== true
      || !Array.isArray(proof.exclusions) || proof.exclusions.length !== 3
      || proof.exclusions.some((entry) => entry?.excluded !== true)) return false;
  const body = structuredClone(proof);
  delete body.proofSha256;
  return sha256(Buffer.from(JSON.stringify(body), 'utf8')) === proof.proofSha256;
}

function candidateReceiptShapeValid(document) {
  if (!hasExactKeys(document, [
    'schemaVersion', 'receiptPath', 'candidate', 'donorEquality', 'donors', 'donorProof',
    'protocolAndConfigHashes', 'measurements', 'managedComponentInventory', 'controlInventory',
    'manifests', 'limitationSource', 'limitations', 'externalBoundary', 'externalActions', 'selfCertification',
    'verification', 'terminalState',
  ])) return false;
  if (!hasExactKeys(document.candidate, ['branch', 'commit', 'tree'])) return false;
  if (!hasExactKeys(document.donorEquality, ['expected', 'discovered', 'accepted', 'integrated', 'proof'])) return false;
  if (!Array.isArray(document.donors) || document.donors.some((entry) => !hasExactKeys(entry, [
    'id', 'tipSha', 'treeSha', 'integrationMethod', 'integrationCommit',
    'acceptanceReceiptSha256s', 'integrationReceiptSha256',
  ]))) return false;
  if (!candidateDonorProofShapeValid(document.donorProof, document.candidate)) return false;
  if (!Array.isArray(document.protocolAndConfigHashes)
      || document.protocolAndConfigHashes.some((entry) => !hasExactKeys(entry, ['id', 'kind', 'hash']))) return false;
  if (!hasExactKeys(document.measurements, ['completeAcceptance', 'browser', 'performance', 'restart'])) return false;
  if (!hasExactKeys(document.measurements.completeAcceptance, [
    'receiptPath', 'receiptSha256', 'receiptByteLength', 'commandCount',
    'passedCommandCount', 'failedCommandCount', 'commandResults', 'passed',
  ])) return false;
  if (!candidateCommandResultsShapeValid(document.measurements.completeAcceptance.commandResults)) return false;
  if (!hasExactKeys(document.measurements.browser, [
    'receiptPath', 'receiptSha256', 'receiptByteLength', 'runCount',
    'routeCaptureCount', 'artifactCount', 'passed',
  ])) return false;
  if (!hasExactKeys(document.measurements.performance, [
    'receiptPath', 'receiptSha256', 'receiptByteLength', 'overall', 'passed',
  ])) return false;
  if (!hasExactKeys(document.measurements.restart, [
    'performed', 'webSocketCloseCode', 'postRestartRendered', 'passed',
  ])) return false;
  if (!candidateManagedInventoryShapeValid(document.managedComponentInventory)) return false;
  if (!candidateControlInventoryShapeValid(document.controlInventory)) return false;
  if (!candidateExternalBoundaryShapeValid(document.externalBoundary)) return false;
  if (!hasExactKeys(document.limitationSource, ['sourcePath', 'sealSha256', 'normalization', 'entryCount'])
      || document.limitationSource.sourcePath !== CLOSURE_EVIDENCE_PATH
      || !/^[0-9a-f]{64}$/u.test(document.limitationSource.sealSha256 ?? '')
      || document.limitationSource.normalization !== 'A_FORMAL_AND_A_ACTION_EVIDENCE_S2_POSTLANDING_EXCLUDED'
      || document.limitationSource.entryCount !== EXPECTED_CANDIDATE_LIMITATIONS.length) return false;
  if (!hasExactKeys(document.manifests, ['source', 'evidenceScope', 'evidence'])) return false;
  if (!hasExactKeys(document.manifests.source, ['format', 'fileCount', 'sha256', 'protectedOwnerDirectives'])
      || document.manifests.source.format !== 'GIT_BLOBS_PLUS_PROTECTED_OWNER_DIRECTIVE_HASHES_V2'
      || !exactJson(document.manifests.source.protectedOwnerDirectives, PROTECTED_OWNER_DIRECTIVES)) return false;
  if (!hasExactKeys(document.manifests.evidence, ['entries', 'sha256'])) return false;
  if (!Array.isArray(document.manifests.evidence.entries)
      || document.manifests.evidence.entries.some((entry) => !hasExactKeys(entry, ['relativePath', 'sha256', 'byteLength']))) return false;
  return Array.isArray(document.limitations)
    && document.limitations.every((entry) => hasExactKeys(entry, ['id', 'status', 'reason']));
}

function validateCandidateReceiptLimitations(limitations) {
  return Array.isArray(limitations)
    && limitations.length === EXPECTED_CANDIDATE_LIMITATIONS.length
    && limitations.every((entry) => hasExactKeys(entry, ['id', 'status', 'reason']))
    && exactJson(limitations, EXPECTED_CANDIDATE_LIMITATIONS);
}

export function validateIntegrationCandidateReceiptMarkdown(text, expected) {
  const parsed = parseIntegrationCandidateReceiptMarkdown(text);
  const failures = [...parsed.failures];
  const document = parsed.document;
  if (document === null) return Object.freeze({ document: null, semanticFailures: Object.freeze(failures), passed: false });
  if (!candidateReceiptShapeValid(document)) failures.push('CANDIDATE_RECEIPT_UNEXPECTED_OR_MISSING_FIELDS');
  if (document.schemaVersion !== CANDIDATE_RECEIPT_SCHEMA_VERSION
      || document.receiptPath !== CANDIDATE_RECEIPT_PATH) failures.push('CANDIDATE_RECEIPT_IDENTITY_INVALID');
  if (document.candidate?.branch !== 'i00-product-assembly-20260713'
      || document.candidate?.commit !== expected.candidateSha
      || document.candidate?.tree !== expected.candidateTreeSha) failures.push('CANDIDATE_RECEIPT_SOURCE_MISMATCH');
  const expectedEquality = {
    expected: expected.donorProof.counts.expected,
    discovered: expected.donorProof.counts.discovered,
    accepted: expected.donorProof.counts.accepted,
    integrated: expected.donorProof.counts.integrated,
    proof: `${expected.donorProof.counts.expected}/${expected.donorProof.counts.discovered}/${expected.donorProof.counts.accepted}/${expected.donorProof.counts.integrated}`,
  };
  if (!exactJson(document.donorEquality, expectedEquality)
      || !exactJson(document.donors, EXPECTED_ACCEPTED_DONORS)) failures.push('CANDIDATE_RECEIPT_DONOR_INVENTORY_INVALID');
  if (!candidateDonorProofShapeValid(document.donorProof, document.candidate)
      || !exactJson(document.donorProof, expected.donorProof)) failures.push('CANDIDATE_RECEIPT_DONOR_PROOF_INVALID');
  if (!exactJson(document.protocolAndConfigHashes, EXPECTED_PROTOCOL_AND_CONFIG_HASHES)) failures.push('CANDIDATE_RECEIPT_PROTOCOL_HASHES_INVALID');
  const expectedMeasurements = candidateReceiptMeasurements(
    expected.performanceReceipt,
    expected.browserReceipt,
    expected.completeReceipt,
  );
  if (!exactJson(document.measurements, expectedMeasurements)
      || document.measurements?.completeAcceptance?.passed !== true
      || document.measurements?.browser?.passed !== true
      || document.measurements?.performance?.overall !== 'PASS'
      || document.measurements?.performance?.passed !== true
      || document.measurements?.restart?.passed !== true) failures.push('CANDIDATE_RECEIPT_MEASUREMENTS_INVALID');
  const expectedManagedInventory = candidateManagedComponentInventory(expected.performanceReceipt);
  if (!candidateManagedInventoryShapeValid(document.managedComponentInventory)
      || !exactJson(document.managedComponentInventory, expectedManagedInventory)) {
    failures.push('CANDIDATE_RECEIPT_MANAGED_INVENTORY_INVALID');
  }
  const expectedControlInventory = candidateControlInventory(expected.performanceReceipt, expected.controlCatalog);
  if (!candidateControlInventoryShapeValid(document.controlInventory)
      || !exactJson(document.controlInventory, expectedControlInventory)) {
    failures.push('CANDIDATE_RECEIPT_CONTROL_INVENTORY_INVALID');
  }
  if (!exactJson(document.manifests?.source, expected.sourceManifest)
      || document.manifests?.evidenceScope !== 'BROWSER_PERFORMANCE_COMPLETE_EXCLUDES_SELF'
      || !evidenceBindingMatches(document.manifests?.evidence, expected.evidenceManifest)) failures.push('CANDIDATE_RECEIPT_MANIFESTS_INVALID');
  if (!exactJson(document.limitationSource, expected.limitationSource)) failures.push('CANDIDATE_RECEIPT_LIMITATION_SOURCE_INVALID');
  if (!validateCandidateReceiptLimitations(document.limitations)) failures.push('CANDIDATE_RECEIPT_LIMITATIONS_INVALID');
  const expectedExternalBoundary = candidateExternalBoundary(expected.completeReceipt);
  if (!candidateExternalBoundaryShapeValid(document.externalBoundary)
      || !exactJson(document.externalBoundary, expectedExternalBoundary)) {
    failures.push('CANDIDATE_RECEIPT_EXTERNAL_BOUNDARY_INVALID');
  }
  if (document.externalActions !== 'NONE') failures.push('CANDIDATE_RECEIPT_EXTERNAL_ACTIONS_INVALID');
  if (document.selfCertification !== 'NOT_SELF_CERTIFIED'
      || document.verification !== 'INDEPENDENT_VERIFICATION_REQUIRED') failures.push('CANDIDATE_RECEIPT_SELF_CERTIFICATION_INVALID');
  if (!exactJson(document.terminalState, CANDIDATE_TERMINAL_STATE)) failures.push('CANDIDATE_RECEIPT_TERMINAL_STATE_INVALID');
  return Object.freeze({
    document,
    semanticFailures: Object.freeze([...new Set(failures)].toSorted()),
    passed: failures.length === 0,
  });
}

function validateIntegrationCandidateReceipt(expected) {
  const absolute = path.join(ROOT, CANDIDATE_RECEIPT_PATH);
  const info = lstatSync(absolute, { throwIfNoEntry: false });
  if (!info?.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new Error('CANDIDATE_RECEIPT_MISSING_OR_UNSAFE');
  }
  if (info.size === 0 || info.size > CANDIDATE_RECEIPT_MAX_BYTES) throw new Error('CANDIDATE_RECEIPT_SIZE_INVALID');
  const text = readFileSync(absolute, 'utf8');
  const validation = validateIntegrationCandidateReceiptMarkdown(text, expected);
  return Object.freeze({
    relativePath: CANDIDATE_RECEIPT_PATH,
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    semanticFailures: validation.semanticFailures,
    passed: validation.passed,
  });
}

async function validateIntegrationCandidateReceiptAtRevision(environment, revision, expected) {
  const receipt = await gitPathBytes(environment, revision, CANDIDATE_RECEIPT_PATH, 'CANDIDATE_RECEIPT', CANDIDATE_RECEIPT_MAX_BYTES);
  const text = receipt.bytes.toString('utf8');
  const validation = validateIntegrationCandidateReceiptMarkdown(text, expected);
  return Object.freeze({
    relativePath: receipt.relativePath,
    sha256: sha256(receipt.bytes),
    byteLength: receipt.bytes.length,
    semanticFailures: validation.semanticFailures,
    passed: validation.passed,
  });
}

function completeStepCommandValid(step, plan, expectedHead) {
  if (!step || !plan || step.id !== plan.id || !Array.isArray(step.command)) return false;
  if (plan.kind === 'Q_ARCHIVE') {
    return typeof step.command[0] === 'string'
      && step.command[0].endsWith('/quant/.venv/bin/python')
      && exactList(step.command.slice(1), plan.command.slice(1));
  }
  if (plan.kind === 'PERFORMANCE') {
    const args = step.command.slice(1);
    const durationMatch = /^--duration-seconds=(\d+)$/u.exec(args[3] ?? '');
    const durationSeconds = durationMatch === null ? null : Number(durationMatch[1]);
    return step.command[0] === process.execPath
      && args.length === 5
      && args[0] === 'test/i00/performance/local-proxy-soak.mjs'
      && args[1] === '--run'
      && args[2] === `--tested-sha=${expectedHead}`
      && Number.isSafeInteger(durationSeconds)
      && durationSeconds >= 60
      && durationSeconds <= 3_600
      && /^--out=local-proxy-performance-[0-9]{17}-[0-9]+\.json$/u.test(args[4]);
  }
  return exactList(step.command, plan.command);
}

function validateCompleteReceipt(
  requested,
  expectedHead,
  expectedTree,
  performanceReceipt,
  browserReceipt,
  candidateManifest,
  initialEvidence,
) {
  if (!requested) throw new Error('COMPLETE_RECEIPT_REQUIRED_FOR_VALIDATE_ONLY');
  const resolved = realpathSync(path.resolve(ROOT, requested));
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error('COMPLETE_RECEIPT_OUTSIDE_REPOSITORY');
  const text = readFileSync(resolved, 'utf8');
  const document = JSON.parse(text);
  const validation = validateCompleteReceiptDocument(
    document,
    expectedHead,
    expectedTree,
    performanceReceipt,
    browserReceipt,
    candidateManifest,
    initialEvidence,
    text,
  );
  return Object.freeze({
    relativePath: path.relative(ROOT, resolved),
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    stepCount: Array.isArray(document.steps) ? document.steps.length : null,
    passedStepCount: Array.isArray(document.steps) ? document.steps.filter((step) => step?.passed === true).length : null,
    failedStepCount: Array.isArray(document.steps) ? document.steps.filter((step) => step?.passed !== true).length : null,
    commandResults: Object.freeze(Array.isArray(document.steps) ? document.steps.map(completeStepSummary) : []),
    externalBoundary: Object.freeze({ ...(document.externalBoundary ?? {}) }),
    semanticFailures: validation.semanticFailures,
    passed: validation.passed,
  });
}

async function validateCompleteReceiptAtRevision(
  environment,
  revision,
  requested,
  expectedHead,
  expectedTree,
  performanceReceipt,
  browserReceipt,
  candidateManifest,
  initialEvidence,
) {
  if (!requested) throw new Error('COMPLETE_RECEIPT_REQUIRED_FOR_VALIDATE_ONLY');
  const receipt = await gitPathBytes(environment, revision, requested, 'COMPLETE_RECEIPT', 64 * 1024 * 1024);
  const text = receipt.bytes.toString('utf8');
  const document = JSON.parse(text);
  const validation = validateCompleteReceiptDocument(
    document,
    expectedHead,
    expectedTree,
    performanceReceipt,
    browserReceipt,
    candidateManifest,
    initialEvidence,
    text,
  );
  return Object.freeze({
    relativePath: receipt.relativePath,
    sha256: sha256(receipt.bytes),
    byteLength: receipt.bytes.length,
    stepCount: Array.isArray(document.steps) ? document.steps.length : null,
    passedStepCount: Array.isArray(document.steps) ? document.steps.filter((step) => step?.passed === true).length : null,
    failedStepCount: Array.isArray(document.steps) ? document.steps.filter((step) => step?.passed !== true).length : null,
    commandResults: Object.freeze(Array.isArray(document.steps) ? document.steps.map(completeStepSummary) : []),
    externalBoundary: Object.freeze({ ...(document.externalBoundary ?? {}) }),
    semanticFailures: validation.semanticFailures,
    passed: validation.passed,
  });
}

async function runCompleteAcceptance(options) {
  if (options.qVenv === null) throw new Error('Q_VENV_REQUIRED_USE_EXPLICIT_Q_VENV');
  if (options.browserReceipt === null) throw new Error('BROWSER_RECEIPT_REQUIRED_FOR_COMPLETE_LOCAL_ACCEPTANCE');
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'i00-complete-acceptance-'));
  const environment = safeEnvironment(tempRoot);
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[^0-9]/g, '').slice(0, 17)}-${process.pid}`;
  const identity = await sourceIdentity(environment);
  const browserReceiptAtStart = validateBrowserReceipt(options.browserReceipt, identity.headSha, identity.treeSha);
  if (!browserReceiptAtStart.passed) throw new Error('BROWSER_RECEIPT_INVALID_BEFORE_ACCEPTANCE');
  const initialEvidencePaths = new Set([
    browserReceiptAtStart.relativePath,
    ...browserReceiptAtStart.artifacts.map((artifact) => artifact.relativePath),
  ]);
  const source = await sourceTruth(environment, initialEvidencePaths);
  const { branch, headSha: sourceHead, treeSha: sourceTree } = source;
  const frozenSource = await sourceManifest(environment, sourceHead);
  const frozenEvidence = evidenceManifest(initialEvidencePaths);
  const steps = [];
  let qProvenance = null;
  let performanceReceipt = null;
  let browserReceipt = browserReceiptAtStart;
  try {
    const q = await runQArchiveGate(tempRoot, options.qVenv, environment);
    qProvenance = q.provenance;
    steps.push(...q.steps);
    if (q.steps.some((step) => !step.passed)) throw new Error('Q_EXACT_DONOR_GATE_FAILED');
    for (const plan of ACCEPTANCE_PLAN.slice(2)) {
      let result;
      if (plan.kind === 'REPORT_PARITY') result = await verifyReportParity();
      else if (plan.kind === 'SOURCE_FREEZE') {
        const finalEvidencePaths = new Set(initialEvidencePaths);
        if (performanceReceipt?.relativePath) finalEvidencePaths.add(performanceReceipt.relativePath);
        const [currentSource, finalTruth] = await Promise.all([
          sourceManifest(environment, sourceHead),
          sourceTruth(environment, finalEvidencePaths),
        ]);
        const currentInitialEvidence = evidenceManifest(initialEvidencePaths);
        const performanceEvidence = performanceReceipt?.relativePath
          ? evidenceManifest([performanceReceipt.relativePath])
          : null;
        const matches = currentSource.fileCount === frozenSource.fileCount
          && currentSource.sha256 === frozenSource.sha256
          && finalTruth.headSha === sourceHead
          && finalTruth.treeSha === sourceTree
          && currentInitialEvidence.sha256 === frozenEvidence.sha256
          && performanceEvidence?.entries[0]?.sha256 === performanceReceipt?.sha256;
        result = Object.freeze({
          id: plan.id, command: [], cwdRelative: '.', startedAtUtc: new Date().toISOString(), endedAtUtc: new Date().toISOString(), durationMs: 0,
          exitCode: matches ? 0 : 1, exitSignal: null, timedOut: false, stdoutBytes: 0, stderrBytes: 0,
          stdoutSha256: sha256(JSON.stringify(currentSource)), stderrSha256: sha256(''), parsedCounts: { sourceFiles: [currentSource.fileCount] },
          secretFindings: [], outputOverflow: false, initial: frozenSource, final: currentSource,
          initialEvidence: frozenEvidence, finalInitialEvidence: currentInitialEvidence, performanceEvidence,
          passed: matches,
        });
      }
      else if (plan.kind === 'BROWSER_RECEIPT') {
        browserReceipt = validateBrowserReceipt(options.browserReceipt, sourceHead, sourceTree);
        result = Object.freeze({
          id: plan.id, command: [], cwdRelative: '.', startedAtUtc: new Date().toISOString(), endedAtUtc: new Date().toISOString(), durationMs: 0,
          exitCode: browserReceipt.passed ? 0 : 1, exitSignal: null, timedOut: false, stdoutBytes: browserReceipt.byteLength, stderrBytes: 0,
          stdoutSha256: browserReceipt.sha256, stderrSha256: sha256(''), parsedCounts: { browserRuns: [browserReceipt.passed ? 1 : 0] },
          secretFindings: browserReceipt.secretFindings, outputOverflow: false, passed: browserReceipt.passed,
        });
      } else {
        let command = [...plan.command];
        if (plan.kind === 'PERFORMANCE') {
          const performanceName = `local-proxy-performance-${runId}.json`;
          command = [process.execPath, 'test/i00/performance/local-proxy-soak.mjs', '--run', `--tested-sha=${sourceHead}`, `--duration-seconds=${options.performanceDurationSeconds}`, `--out=${performanceName}`];
        }
        result = await runCommand({ id: plan.id, command, environment });
        if (plan.kind === 'PERFORMANCE') {
          const performanceName = `local-proxy-performance-${runId}.json`;
          const performancePath = path.join(EVIDENCE_ROOT, performanceName);
          const performanceText = readFileSync(performancePath, 'utf8');
          const performanceDocument = JSON.parse(performanceText);
          const validation = validatePerformanceDocument(performanceDocument, { headSha: sourceHead, treeSha: sourceTree });
          const secretFindings = scanSecretText(performanceText);
          performanceReceipt = {
            relativePath: path.relative(ROOT, performancePath),
            sha256: sha256(performanceText),
            byteLength: Buffer.byteLength(performanceText),
            schemaVersion: performanceDocument.schemaVersion ?? null,
            overall: performanceDocument.slo?.overall ?? null,
            schemaValid: validation.schemaValid,
            schemaErrors: validation.schemaErrors,
            semanticFailures: validation.semanticFailures,
            secretFindings,
            passed: result.passed && validation.passed && secretFindings.length === 0,
          };
          result = Object.freeze({ ...result, passed: performanceReceipt.passed });
        }
      }
      steps.push(result);
      if (!result.passed) break;
    }
    const secretFindings = steps.flatMap((step) => step.secretFindings ?? []);
    const allPlannedIds = ACCEPTANCE_PLAN.map((step) => step.id);
    const completedIds = steps.map((step) => step.id);
    const missingSteps = allPlannedIds.filter((id) => !completedIds.includes(id));
    const passed = steps.every((step) => step.passed) && missingSteps.length === 0 && secretFindings.length === 0 && browserReceipt?.passed === true && performanceReceipt?.passed === true;
    const receipt = {
      schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
      truthClass: 'LOCAL_COMPLETE_ACCEPTANCE_MEASURED',
      runId,
      startedAtUtc: startedAt.toISOString(),
      endedAtUtc: new Date().toISOString(),
      source,
      sourceFreeze: { ...frozenSource, evidence: frozenEvidence, protectedOwnerDirectives: source.protectedOwnerDirectives },
      qExactDonor: qProvenance,
      plan: ACCEPTANCE_PLAN,
      steps,
      missingSteps,
      performanceReceipt,
      browserReceipt,
      externalBoundary: {
        privateReads: 'OWNER_GATED_NOT_RUN',
        signedCalls: 'OWNER_GATED_NOT_RUN',
        awsCloudflare: 'OWNER_GATED_NOT_RUN',
        deployPush: 'NOT_RUN',
        moneyPaths: 'FORBIDDEN_NOT_RUN',
      },
      secretScan: { findings: secretFindings, passed: secretFindings.length === 0 },
      passed,
    };
    const requestedOutput = options.output ?? `local-complete-acceptance-${runId}.json`;
    const destination = writeImmutableJson(EVIDENCE_ROOT, requestedOutput, receipt);
    process.stdout.write(`${JSON.stringify({ receipt: path.relative(ROOT, destination), schemaVersion: receipt.schemaVersion, runId, passed })}\n`);
    if (!passed) process.exitCode = 1;
    return receipt;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(async () => {
    const options = parseOptions(process.argv.slice(2));
    if (options.mode === 'PLAN') {
      process.stdout.write(`${JSON.stringify({ schemaVersion: ACCEPTANCE_SCHEMA_VERSION, mode: 'PLAN_ONLY', exactQDonor: Q_DONOR_SHA, steps: ACCEPTANCE_PLAN, requires: ['explicit --q-venv for --run', 'schema-valid local browser receipt', 'HEAD-bound source with only hash-pinned protected directives and immutable evidence untracked'], externalActions: 'NONE' }, null, 2)}\n`);
      return;
    }
    if (options.mode === 'VALIDATE_ONLY') {
      const result = await validateCompleteEvidence(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.passed) process.exitCode = 1;
      return;
    }
    if (options.mode === 'RENDER_CANDIDATE_RECEIPT') {
      const markdown = await renderCandidateReceiptFromWorkingSealEvidence(options);
      if (options.output !== null) {
        const outputPath = normalizedRepositoryPath(options.output, 'CANDIDATE_RECEIPT_OUTPUT');
        if (outputPath !== CANDIDATE_RECEIPT_PATH) throw new Error('CANDIDATE_RECEIPT_OUTPUT_PATH_NOT_CANONICAL');
        const absolute = path.join(ROOT, outputPath);
        writeFileSync(absolute, markdown, { flag: 'wx', mode: 0o600 });
        process.stdout.write(`${JSON.stringify({ receipt: outputPath, sha256: sha256(markdown), byteLength: Buffer.byteLength(markdown), writeMode: 'IMMUTABLE_CREATE_ONLY' })}\n`);
      } else {
        process.stdout.write(markdown);
      }
      return;
    }
    await runCompleteAcceptance(options);
  }).catch((error) => {
    process.stderr.write(`LOCAL_COMPLETE_ACCEPTANCE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
