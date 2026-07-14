import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { deflateSync } from 'node:zlib';

import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  CANONICAL_SYSTEM_COMPONENT_OWNERS,
  I00_MANAGED_INVENTORY_EXPECTATIONS,
  LOCAL_PROXY_SLOS,
  PRODUCT_RUNTIME_CONTROL_EXPECTATIONS,
  PROTECTED_OWNER_DIRECTIVES,
  Q_DONOR_SHA,
  Q_DONOR_TREE,
  Q_RECEIPT_SHA256,
  REQUIRED_LIMITATIONS,
  aggregateSloStatus,
  assertLoopbackHost,
  evaluateBound,
  nearestRank,
  scanSecretText,
  sha256,
  summarize,
  validateJsonSchema,
  writeImmutableJson,
} from './contract.mjs';
import {
  ACCEPTANCE_PLAN,
  Q_ARCHIVE_REQUIRED_FILES,
  parseOptions,
  validateBrowserArtifacts,
  validateBrowserDocument,
  validateQVenvManifest,
  validateQArchiveInventory,
} from './local-acceptance.mjs';
import { parseSoakArgs, validatePerformanceDocument } from './local-proxy-soak.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const SHA = 'c'.repeat(64);
const ROUTE_PATHS = Object.freeze({
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
const RUNS = Object.freeze([
  [390, 844, 1, 'LIGHT'], [390, 844, 1, 'DARK'],
  [1600, 900, 1, 'LIGHT'], [1600, 900, 1, 'DARK'],
  [2940, 1200, 1.25, 'LIGHT'], [2940, 1200, 1.25, 'DARK'],
]);
const BOTTOM_UP = Object.freeze([
  ['calendar', '/calendar'], ['news', '/news'], ['health', '/system'], ['logs', '/ledger'],
  ['risk', '/risk'], ['opportunities', '/opportunities'], ['volume', '/volume'],
  ['basis', '/strategies'], ['markets', '/markets'], ['token', '/detail/BTCUSDT'],
  ['borrow', '/loans'], ['account', '/account'], ['dashboard', '/dashboard'],
]);
const TOPBAR = Object.freeze([
  ['clock', 'clock', 70], ['aws-runner', 'shell', 70], ['api-keys', 'apikey', 70],
  ['trust-advisor', 'advisor', 70], ['notifications', 'notif', 70],
  ['execution-control', 'power', 70], ['currency', 'currency', 70],
  ['basis-units', 'basisu', 70], ['appearance', 'appearance', 70],
  ['account-details', 'account', 84],
]);

function summary(value = 1) {
  return { count: 2, min: value, p50: value, p95: value, p99: value, max: value, mean: value };
}

function managedInventoryFixture() {
  const entries = I00_MANAGED_INVENTORY_EXPECTATIONS.map((expected) => ({
    identity: expected.identity,
    owner: expected.owner,
    canonicalComponentIds: [...expected.canonicalComponentIds],
    inventoryState: expected.inventoryState,
    evidence: expected.canonicalComponentIds.length === 0 ? null : expected.canonicalComponentIds.map((componentId) => ({
      source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION',
      componentId,
      componentProjectionIndex: CANONICAL_SYSTEM_COMPONENT_IDS.indexOf(componentId),
    })),
    reasonCode: expected.reasonCode,
  }));
  return {
    schemaVersion: 'i00-managed-inventory.v1',
    expectedIdentityCount: 33,
    mappedIdentityCount: 14,
    evidencePresentCount: 14,
    ownerGatedCount: 13,
    notConfiguredCount: 3,
    missingCount: 3,
    canonicalComponentCount: 14,
    referencedCanonicalComponentCount: 14,
    observedCanonicalComponentCount: 14,
    entries,
  };
}

function canonicalComponentsFixture() {
  return CANONICAL_SYSTEM_COMPONENT_IDS.map((componentId, index) => ({
    componentId,
    owner: CANONICAL_SYSTEM_COMPONENT_OWNERS[index],
    observedLifecycle: 'BLOCKED',
    capability: 'UNAVAILABLE',
    blocker: `BLOCKER_${index}`,
  }));
}

function productControlsFixture() {
  return PRODUCT_RUNTIME_CONTROL_EXPECTATIONS.map((expected) => ({
    controlId: expected.controlId,
    backendCommandId: expected.backendCommandId,
    wiringState: 'WIRED_LIVE',
    owner: 'systemIntegration.canonical-control-service',
    authority: 'SERVER_DERIVED_OPERATOR',
    disabledReason: null,
  }));
}

function snapshot(label, value, bootGeneration) {
  return {
    label,
    capturedAtUtc: '2026-07-14T00:00:00.000Z',
    liveStatus: 200,
    readyStatus: 503,
    readyClassification: 'HONEST_NOT_READY_503',
    tradeReadyStatus: 503,
    tradeReadyClassification: 'HONEST_NOT_READY_503',
    healthSemanticsValid: true,
    legacyHealthStatus: 200,
    stateStatus: 200,
    stateNowMs: value,
    eventsCountStatus: 200,
    eventsCount: value,
    basisStatus: 200,
    basisLastBookTs: value,
    basisLastMarkTs: value,
    volumeStatus: 200,
    volumeLastBookTs: value,
    volumeLastTradeTs: value,
    volumeTradeMessages: value,
    productSupervisorStatus: 200,
    productRevision: `revision-${value}`,
    runtimeGeneration: 1,
    controlGeneration: bootGeneration,
    testedCommitProjection: HEAD,
    deployedCommitProjection: null,
    configRevisionProjection: null,
    schemaRevisionProjection: 'schema-v1',
    modelRevisionProjection: null,
    deploymentFrozenProjection: false,
    exposureStateProjection: 'UNKNOWN',
    ambiguityStateProjection: 'UNKNOWN',
    recoveryStateProjection: 'UNKNOWN',
    opsInterlockState: 'OPS_INTERLOCK_BLOCKED',
    opsInterlockBlocksNewEntries: true,
    opsExternalActionAuthorization: 'NONE',
    reconciliationStatus: 'UNAVAILABLE',
    reconciliationBlocksNewExposure: true,
    reconciliationReasonCodes: ['RECONCILIATION_TRUTH_UNAVAILABLE'],
    restartControlWiringState: 'WIRED_LIVE',
    restartControlRevision: '0',
    managedInventory: managedInventoryFixture(),
    canonicalComponents: canonicalComponentsFixture(),
    productControls: productControlsFixture(),
    canonicalRuntimeEvidenceValid: true,
    opsProjectionValid: true,
    bootRevisionProjectionValid: true,
    qComponentPresent: true,
    qAdvisoryAction: 'ABSTAIN_UNKNOWN',
    qTruthLabel: 'NOT_CONFIGURED',
    qCapability: 'UNAVAILABLE',
    qAuthority: 'UNAVAILABLE',
    qCapitalRelevance: 'NONE',
    qControlCount: 0,
    tradeReadyProjection: 'NO',
    qProjectionValid: true,
    contentSha256: SHA,
  };
}

function phase(phaseId, bootGeneration, startValue) {
  const graceful = phaseId !== 'UNCLEAN_TERMINATION';
  const recovered = phaseId === 'POST_CRASH_RECOVERY';
  const restartIdempotencyKey = `i00.performance.restart.g1.${HEAD.slice(0, 12)}`;
  const integrity = graceful ? {
    quickCheck: 'ok', integrityCheck: 'ok', journalMode: 'wal', foreignKeyViolationCount: 0, userVersion: 1, eventCount: startValue,
    bootRelease: {
      rowCount: recovered ? 3 : 1,
      latestGeneration: recovered ? 3 : 1,
      latestTestedCommit: HEAD,
      latestDeployedCommit: null,
      latestConfigRevision: null,
      latestSchemaRevision: 'schema-v1',
      latestModelRevision: null,
      latestStartedAtMs: startValue,
      latestCompletedAtMs: startValue + 1,
      latestClean: true,
      latestBlockerCode: null,
      allRowsClean: !recovered,
      cleanCompletedCount: recovered ? 2 : 1,
      crashPendingCount: recovered ? 1 : 0,
      crashPendingGenerations: recovered ? [2] : [],
      allRowsIdentityValid: true,
      expectedLatestLifecycle: 'CLEAN_COMPLETED',
      latestLifecycleState: 'CLEAN_COMPLETED',
      expectedCrashPendingGenerations: recovered ? [2] : [],
      lifecycleExpectationMet: true,
      passed: true,
    },
    controlCommand: {
      idempotencyKey: restartIdempotencyKey,
      durableReceiptObserved: false,
      durableRejectionAuditObserved: true,
      rejectionCode: 'RESTART_EXPOSURE_NONE_NOT_PROVEN',
      rejectionActorSource: 'loopback',
      checkpointControlRevision: 0,
      checkpointControlGeneration: bootGeneration,
      passed: true,
    },
    passed: true,
  } : null;
  return {
    phaseId,
    bootGeneration,
    startedAtUtc: '2026-07-14T00:00:00.000Z',
    endedAtUtc: '2026-07-14T00:01:00.000Z',
    durationSeconds: 20,
    snapshots: [snapshot('START', startValue, bootGeneration), snapshot('END', startValue + 1, bootGeneration)],
    http: {
      scheduled: 10, skippedForConcurrency: 0, responses: 10, expectedResponses: 10,
      unexpectedResponses: 0, networkErrors: 0, responseBytes: 1000, throughputRps: 1,
      responseBytesPerSecond: 100, latencyMs: summary(),
      endpoints: [{ path: '/health/live', requests: 10, responses: 10, unexpected: 0, errors: 0, bytes: 1000, statusCounts: { 200: 10 }, latencyMs: summary() }],
    },
    websocket: {
      clientsRequested: 2, clientsOpened: 2, openErrors: 0, messages: 4, bytes: 100,
      maxClientBufferedAmountBytes: 0,
      messageTypes: { book: 2, btrades: 2 },
      closeCodes: graceful ? { 1012: 2 } : { 1006: 2 },
      shutdownClose1012Count: graceful ? 2 : 0,
      uncleanClose1006Count: graceful ? 0 : 2,
      focus: { symbol: 'BTCUSDT', burstsAttempted: 1, bookMessages: 2, tradeMessages: 2, status: 'MEASURED', reason: 'Public messages measured.' },
      slowConsumer: { attempted: true, pauseDurationMs: 1000, observedClose1013: false, status: 'NOT_OBSERVED', reason: 'Threshold was not reached.' },
    },
    process: {
      samples: 2, cpuOneCorePercent: summary(), cpuHostPercent: summary(), rssBytes: summary(100),
      heapUsedBytes: summary(50), eventLoopP95Ms: summary(), eventLoopP99Ms: summary(), eventLoopMaxMs: summary(),
      rssSlopeBytesPerHour: 0,
    },
    storage: {
      preLaunch: { databaseBytes: bootGeneration === 1 ? 0 : 100, walBytes: recovered ? 4096 : 0, shmBytes: recovered ? 32768 : 0 },
      samples: 2,
      database: { initialBytes: 100, finalBytes: 100, maxBytes: 100, growthBytes: 0 },
      wal: { initialBytes: graceful ? 0 : 4096, finalBytes: graceful ? 0 : 4096, maxBytes: 4096, growthBytes: 0 },
      shm: { initialBytes: graceful ? 0 : 32768, finalBytes: graceful ? 0 : 32768, maxBytes: 32768, growthBytes: 0 },
      integrity,
    },
    shutdown: {
      mode: graceful ? 'GRACEFUL' : 'UNCLEAN_CRASH',
      signal: graceful ? 'SIGTERM' : 'SIGKILL',
      exitCode: graceful ? 0 : null,
      exitSignal: graceful ? null : 'SIGKILL',
      durationMs: 10,
      cleanLogMarkerObserved: graceful,
      stdoutSha256: SHA, stderrSha256: SHA, telemetrySha256: SHA, logOverflow: false, passed: true,
    },
  };
}

function restartBarrier() {
  return {
    exposureState: 'UNKNOWN', ambiguityState: 'UNKNOWN', recoveryState: 'UNKNOWN',
    opsInterlockState: 'OPS_INTERLOCK_BLOCKED', opsInterlockBlocksNewEntries: true,
    reconciliationStatus: 'UNAVAILABLE', reconciliationBlocksNewExposure: true,
    reconciliationReasonCodes: ['RECONCILIATION_TRUTH_UNAVAILABLE'],
    readyStatus: 503, tradeReadyStatus: 503,
  };
}

function performanceDocument() {
  const checks = Object.values(LOCAL_PROXY_SLOS).map((bound, index) => ({
    metric: `metric-${index}`, unit: bound.unit, observed: 1, soft: bound.soft, hard: bound.hard,
    status: 'PASS', reason: 'Measured value is within the bound.',
  }));
  return {
    schemaVersion: 'i00.local-proxy-performance.v1',
    truthClass: 'LOCAL_PROXY_MEASURED',
    runId: 'test-run-0001',
    createdAtUtc: '2026-07-14T00:00:00.000Z',
    source: {
      branch: 'i00-product-assembly-20260713', headSha: HEAD, treeSha: TREE,
      worktreeState: 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE',
      protectedOwnerDirectives: PROTECTED_OWNER_DIRECTIVES.map((entry) => ({ ...entry, gitStatus: 'UNTRACKED_PROTECTED_OWNER_INPUT' })),
      serverBundleSha256: SHA, harnessTreeSha256: SHA,
    },
    host: {
      fingerprintSha256: SHA, platform: 'darwin', release: 'test', arch: 'arm64', nodeVersion: 'v24.0.0',
      cpuModel: 'test', logicalCpuCount: 8, totalMemoryBytes: 1024,
    },
    boundary: {
      proxyClass: 'DOCUMENTED_LOCAL_PROXY', fingerprintSha256: SHA, bindHost: '127.0.0.1',
      transport: 'LOOPBACK_HTTP_WS', reverseProxy: 'NONE', forwardedHeaders: 'ABSENT',
      childEnvironment: 'ALLOWLIST_ONLY', keyMode: 'KEYLESS', publicSourcePolicy: 'RUNTIME_OWNED_PUBLIC_ONLY',
      forbiddenActions: ['PRIVATE_READS', 'SIGNED_CALLS', 'LIVE_ORDERS', 'TRANSFER_WITHDRAWAL', 'DEPLOYMENT'],
    },
    load: {
      configuredDurationSeconds: 60, measuredWindowSeconds: 60, sampleIntervalMs: 1000,
      httpTargetRps: 24, httpConcurrency: 8, webSocketClients: 2, focusSymbol: 'BTCUSDT', phaseCount: 3,
      endpoints: [{ path: '/health/live', expectedStatuses: [200] }],
    },
    phases: [
      phase('CANONICAL_RESTART_GATE', 1, 100),
      phase('UNCLEAN_TERMINATION', 2, 200),
      phase('POST_CRASH_RECOVERY', 3, 300),
    ],
    canonicalRestart: {
      controlId: 'component.engine-supervisor.restart', authentication: 'SERVER_DERIVED_LOOPBACK', operatorPayloadSent: false,
      previewStatus: 200, previewId: `prv_${'d'.repeat(64)}`, previewDigest: `sha256:${'e'.repeat(64)}`, previewSynthetic: false,
      submitStatus: 200, idempotencyKey: `i00.performance.restart.g1.${HEAD.slice(0, 12)}`,
      resultStatus: 'REJECTED_STATE', commandId: `sysctrl_${'f'.repeat(64)}`, correlationId: `product.control.${'1'.repeat(48)}`,
      receiptId: null, resultSynthetic: false, resultBeforeSha256: SHA, resultAfterSha256: SHA,
      resultStateUnchanged: true, resultBeforeRevision: 0, resultAfterRevision: 0,
      resultBeforeGeneration: 1, resultAfterGeneration: 1,
      beforeBarrier: restartBarrier(), afterBarrier: restartBarrier(),
      disposition: 'OWNER_GATED', managedRestartAcceptance: 'NOT_PROVEN',
      durableReceiptObserved: false, durableRejectionAuditObserved: true,
      rejectionCode: 'RESTART_EXPOSURE_NONE_NOT_PROVEN', controlGenerationAdvanced: false,
      runtimeGenerationAdvanced: false, effectGenerationAdvanced: false,
      webSocketClose1012Observed: true, barrierPreserved: true, passed: true,
    },
    uncleanRecovery: {
      terminationSignal: 'SIGKILL', uncleanBootGeneration: 2, recoveryBootGeneration: 3,
      walBytesAfterSigkill: 4096, shmBytesAfterSigkill: 32768,
      walBytesBeforeRecoveryLaunch: 4096, shmBytesBeforeRecoveryLaunch: 32768,
      databaseOpenedByHarnessBetweenCrashAndRecovery: false, applicationRuntimeFirstRecoveryOpen: true,
      crashPendingGeneration: 2, crashPendingBootPreserved: true,
      recoveryLatestLifecycleState: 'CLEAN_COMPLETED', recoveryWalRemovedOnCleanClose: true,
      readinessHonestAfterRecovery: true, reconciliationStillBlocksAfterRecovery: true,
      testedShaPreserved: true, deployedShaAbsent: true, quickCheck: 'ok', integrityCheck: 'ok', passed: true,
    },
    continuity: {
      sameDataDirectory: true, firstCleanEventCount: 100, recoveredEventCount: 300,
      eventCountNondecreasing: true, gracefulStopsClean: true, gracefulSocketsReceived1012: true,
      crashSocketsClosedAbnormally: true, databaseIntegrityOnReadableStops: true,
      bootGenerationsOneTwoThree: true, testedShaAllBoots: true, deployedShaAbsentAllBoots: true,
      opsReadbackNotFrozenAllBoots: true, opsInterlockHonestAllBoots: true,
      canonicalRestartOwnerGateProven: true, uncleanRecoveryProven: true,
      passed: true, reasonCodes: [],
    },
    limitations: REQUIRED_LIMITATIONS.map((entry) => ({ ...entry })),
    slo: {
      scope: 'LOCAL_PROXY_INITIAL_GATES', checks, invariantFailures: [], overall: 'PASS',
      degradationVisibility: 'CANONICAL_NON_GREEN_VISIBLE', productionClaim: 'UNKNOWN',
    },
    artifacts: {
      receiptRelativePath: 'evidence/test.json', receiptWriteMode: 'IMMUTABLE_CREATE_ONLY',
      schemaRelativePath: 'schema.v1.json', schemaSha256: SHA,
      secretScan: { artifactsScanned: 10, findings: [], passed: true },
    },
  };
}

function mutateEveryPerformanceSnapshot(document, mutate) {
  const snapshots = document.phases.flatMap((candidate) => candidate.snapshots);
  assert.equal(snapshots.length, 6);
  snapshots.forEach(mutate);
}

function assertRuntimeTruthRejected(document, caseName) {
  const rejected = validatePerformanceDocument(document, { headSha: HEAD, treeSha: TREE });
  assert.equal(rejected.passed, false, `${caseName} must not validate`);
  assert.ok(
    rejected.semanticFailures.includes('PERFORMANCE_RUNTIME_TRUTH_INVALID'),
    `${caseName} must fail canonical runtime truth: ${rejected.semanticFailures.join(',')}`,
  );
}

function browserDocument() {
  const routeIdForBottomPage = { health: 'system', logs: 'ledger', basis: 'strategies', token: 'detail', borrow: 'loans' };
  return {
    schemaVersion: 'i00.local-browser-acceptance.v2', truthClass: 'LOCAL_BROWSER_MEASURED',
    capturedAtUtc: '2026-07-14T00:00:00.000Z', source: {
      headSha: HEAD,
      treeSha: TREE,
      appOrigin: 'http://127.0.0.1:3100',
      captureProvenance: 'IN_APP_BROWSER_MCP',
      captureSessionId: 'in-app-browser-mcp-test-session-0001',
      captureTranscriptPath: 'test/i00/performance/evidence/browser/capture/session-test-0001.json',
      captureTranscriptSha256: SHA,
    },
    runs: RUNS.map(([width, height, zoom, theme]) => ({
      runKey: `${width}x${height}@${zoom}-${theme}`, theme, width, height, zoom,
      reducedMotionChecked: true, sourceTimestampsChecked: true, stateLabelsChecked: true,
      controlMappingsChecked: true,
      routes: Object.entries(ROUTE_PATHS).map(([routeId, routePath]) => ({
        routeId, path: routePath, rendered: true, sourceTimestampState: 'MEASURED',
        stateLabelState: 'CANONICAL_COMPARED', controlMappingState: 'CANONICAL_COMPARED',
        consoleErrors: 0, overflowFailures: 0, controlFailures: 0,
        screenshotPath: `test/i00/performance/evidence/browser/routes/${width}x${height}@${zoom}-${theme}/${routeId}.png`,
        screenshotSha256: SHA,
      })),
    })),
    restart: {
      performed: true,
      measurementPath: 'test/i00/performance/evidence/browser/restart/websocket-service-restart.json',
      measurementSha256: SHA,
    },
    truthChecks: {
      canonicalApiCompared: true, sourceTimestampsChecked: true, stateLabelsChecked: true,
      controlMappingsChecked: true, canonicalNonGreenRendered: true, noFalseGreen: true, fakeControlsFound: 0,
    },
    limitations: [{ capability: 'private reads', status: 'OWNER_GATED', reason: 'Outside local acceptance.' }],
    passed: true,
    bottomUpAudit: {
      order: BOTTOM_UP.map(([pageId]) => pageId), themes: ['LIGHT', 'DARK'],
      sharedStyleCorrectionOccurred: false, restartedAtCalendarAfterCorrection: false,
      entries: BOTTOM_UP.map(([pageId, routePath]) => ({
        pageId, path: routePath,
        light: {
          frameX: 244, frameY: 75, frameWidth: 1345, frameHeight: 800,
          measurementPath: `test/i00/performance/evidence/browser/bottom-up/LIGHT/${pageId}.json`, measurementSha256: SHA,
          overflowFailures: 0,
          screenshotPath: `test/i00/performance/evidence/browser/routes/1600x900@1-LIGHT/${routeIdForBottomPage[pageId] ?? pageId}.png`, screenshotSha256: SHA,
        },
        dark: {
          frameX: 244, frameY: 75, frameWidth: 1345, frameHeight: 800,
          measurementPath: `test/i00/performance/evidence/browser/bottom-up/DARK/${pageId}.json`, measurementSha256: SHA,
          overflowFailures: 0,
          screenshotPath: `test/i00/performance/evidence/browser/routes/1600x900@1-DARK/${routeIdForBottomPage[pageId] ?? pageId}.png`, screenshotSha256: SHA,
        },
      })),
      passed: true,
    },
    topbarAudit: {
      order: TOPBAR.map(([panelId]) => panelId), themes: ['LIGHT', 'DARK'],
      entries: TOPBAR.map(([panelId, triggerKey, headerHeightPx]) => ({
        panelId, triggerKey, shellWidthPx: 398, shellHeightPx: 486, headerHeightPx,
        screenshotMode: 'FULL_VIEWPORT_WITH_OPEN_PANEL',
        truthStateChecked: true, controlsChecked: true, overflowFailures: 0, footerBarCount: 0,
        lightMeasurementPath: `test/i00/performance/evidence/browser/topbar/LIGHT/${panelId}.json`, lightMeasurementSha256: SHA,
        darkMeasurementPath: `test/i00/performance/evidence/browser/topbar/DARK/${panelId}.json`, darkMeasurementSha256: SHA,
        lightScreenshotPath: `test/i00/performance/evidence/browser/topbar/LIGHT/${panelId}.png`, lightScreenshotSha256: SHA,
        darkScreenshotPath: `test/i00/performance/evidence/browser/topbar/DARK/${panelId}.png`, darkScreenshotSha256: SHA,
      })),
      passed: true,
    },
  };
}

function fixturePngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fixturePngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(fixturePngCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

const PNG_FIXTURE_CACHE = new Map();

function pngFixture(width, height, { idatBytes = null, seed = 'fixture', blank = false } = {}) {
  const cacheKey = idatBytes === null ? `${width}x${height}:${seed}:${blank ? 'BLANK' : 'VARIED'}` : null;
  if (cacheKey !== null && PNG_FIXTURE_CACHE.has(cacheKey)) return PNG_FIXTURE_CACHE.get(cacheKey);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  if (!blank && idatBytes === null) {
    const seedBytes = Buffer.from(sha256(seed), 'hex');
    for (let index = 0; index < 128; index += 1) {
      const row = Math.floor(index / width);
      const column = index % width;
      raw[(row * (width + 1)) + column + 1] = ((seedBytes[index % seedBytes.length] + index) % 255) + 1;
    }
  }
  const compressed = idatBytes ?? deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    fixturePngChunk('IHDR', ihdr),
    fixturePngChunk('IDAT', compressed),
    fixturePngChunk('IEND', Buffer.alloc(0)),
  ]);
  if (cacheKey !== null) PNG_FIXTURE_CACHE.set(cacheKey, png);
  return png;
}

function subFilteredUniformPng(width, height, pixelValue = 128) {
  const filtered = Buffer.alloc((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width + 1);
    filtered[offset] = 1;
    filtered[offset + 1] = pixelValue;
  }
  return pngFixture(width, height, { idatBytes: deflateSync(filtered) });
}

function computedStyle(kind, role) {
  const computed = {
    display: 'block',
    fontFamily: 'InterVariable, Inter, sans-serif',
    fontSizePx: 16,
    fontWeight: 400,
    lineHeightPx: 20,
    color: 'rgb(10, 20, 30)',
    letterSpacingPx: 0,
    borderRadiusPx: 0,
    borderWidthPx: 0,
    overflowX: 'visible',
    overflowY: 'visible',
    fontVariantNumeric: 'normal',
    textTransform: 'none',
  };
  if (kind === 'BOTTOM_UP_PAGE') {
    if (role === 'frame') Object.assign(computed, { borderRadiusPx: 12, borderWidthPx: 1 });
    if (role === 'title') Object.assign(computed, { fontSizePx: 22, fontWeight: 540, lineHeightPx: 30 });
    if (role === 'summary-label') Object.assign(computed, { fontSizePx: 10.5, fontWeight: 560, lineHeightPx: 15, letterSpacingPx: 0.5775 });
    if (role === 'summary-value') Object.assign(computed, { fontSizePx: 18, fontWeight: 510, lineHeightPx: 24 });
    if (role === 'row-primary') Object.assign(computed, { fontSizePx: 13, fontWeight: 480, lineHeightPx: 18 });
    if (role === 'row-secondary') Object.assign(computed, { fontSizePx: 11, fontWeight: 415, lineHeightPx: 15 });
  } else {
    if (role === 'header-title') Object.assign(computed, { fontSizePx: 16, fontWeight: 540, lineHeightPx: 21 });
    if (role === 'header-subtitle') Object.assign(computed, { fontSizePx: 11.25, fontWeight: 400, lineHeightPx: 16 });
    if (role === 'row-primary') Object.assign(computed, { fontSizePx: 12.75, fontWeight: 470, lineHeightPx: 18 });
    if (role === 'row-secondary') Object.assign(computed, { fontSizePx: 10.5, fontWeight: 400, lineHeightPx: 15 });
    if (role === 'right-value') Object.assign(computed, {
      fontFamily: 'SFMono-Regular, Menlo, monospace',
      fontSizePx: 11.5,
      fontWeight: 450,
      lineHeightPx: 16,
      fontVariantNumeric: 'tabular-nums',
    });
    if (role === 'status') Object.assign(computed, {
      fontFamily: 'SFMono-Regular, Menlo, monospace',
      fontSizePx: 9.75,
      fontWeight: 500,
      lineHeightPx: 14,
      textTransform: 'uppercase',
    });
  }
  return computed;
}

function measurementDocument(browser, { kind, subjectId, theme, frameRect, panelMetrics }) {
  const roles = kind === 'BOTTOM_UP_PAGE'
    ? ['frame', 'title', 'summary-label', 'summary-value', 'row-primary', 'row-secondary']
    : ['header-title', 'header-subtitle', 'row-primary', 'row-secondary', 'right-value', 'status'];
  return {
    schemaVersion: 'i00.browser-measurement.v1', capturedAtUtc: '2026-07-14T00:00:00.000Z',
    source: structuredClone(browser.source), kind, subjectId, theme,
    viewport: { width: 1600, height: 900, zoom: 1 }, frameRect, panelMetrics,
    roles: roles.map((role) => ({ role, selector: `[data-i00-role="${role}"]`, state: 'MEASURED', computed: computedStyle(kind, role) })),
    documentOverflowX: 0, surfaceOverflowX: 0, footerBarCount: 0, passed: true,
  };
}

function captureSupervisorBody(browser, evaluatedAtMs) {
  const body = {
    schemaVersion: 'product-supervisor.v1',
    revision: 'fixture-revision-0001',
    evaluatedAtMs,
    truthLabel: 'NOT_CONFIGURED',
    persistentSyntheticLabel: false,
    ownerView: {
      machineReady: 'NO',
      tradeReady: 'NO',
      effectiveMode: 'READ_ONLY',
      revisions: {
        testedCommit: browser.source.headSha,
        schemaRevision: 'product-supervisor.v1',
      },
    },
  };
  return { ...body, digest: `sha256:${sha256(JSON.stringify(body))}` };
}

function resealSupervisorBody(body) {
  const { digest: _digest, ...unsignedBody } = body;
  return { ...unsignedBody, digest: `sha256:${sha256(JSON.stringify(unsignedBody))}` };
}

function rawSupervisorObservation(browser, monotonicMs, evaluatedAtMs) {
  const bodyUtf8 = JSON.stringify(captureSupervisorBody(browser, evaluatedAtMs));
  return {
    observedAtUtc: browser.capturedAtUtc,
    monotonicMs,
    method: 'GET',
    origin: browser.source.appOrigin,
    path: '/api/product-integration/v1/supervisor',
    status: 200,
    redirected: false,
    contentType: 'application/json',
    byteLength: Buffer.byteLength(bodyUtf8),
    bodyUtf8,
    bodySha256: sha256(bodyUtf8),
  };
}

function visibleRect(x, y, width, height) {
  return {
    x, y, width, height,
    clientRectCount: 1,
    display: 'block',
    visibility: 'visible',
    opacity: 1,
    hidden: false,
    ariaHidden: null,
  };
}

function consoleQuery(startedAtMs, endedAtMs, entries = []) {
  return {
    method: 'IN_APP_BROWSER_MCP_DEV_LOGS',
    levels: ['error'],
    limit: 1000,
    startedAtMs,
    endedAtMs,
    returnedCount: entries.length,
    entries: structuredClone(entries),
  };
}

function routeObservationsDocument(browser) {
  const observations = [];
  for (const run of browser.runs) {
    for (const route of run.routes) {
      const ordinal = observations.length + 1;
      const base = ordinal * 20;
      const key = `${run.runKey}:${route.routeId}`;
      observations.push({
        observationOrdinal: ordinal,
        observationKey: key,
        captureKey: key,
        runKey: run.runKey,
        routeId: route.routeId,
        logicalPath: route.path,
        clockDomain: 'NODE_MONOTONIC_MS',
        startedAtMs: base + 2,
        domReadAtMs: base + 4,
        screenshotAtMs: base + 5,
        endedAtMs: base + 7,
        apiBefore: rawSupervisorObservation(browser, base + 3, 10_000 + (ordinal * 2)),
        apiAfter: rawSupervisorObservation(browser, base + 6, 10_001 + (ordinal * 2)),
        dom: {
          frameSelector: '.app-page-frame',
          frameMatchCount: 1,
          frameClassName: `app-page-frame frame-${route.routeId === 'wallets' ? 'account' : route.routeId}`,
          frameAriaLabel: `${route.routeId === 'wallets' ? 'account' : route.routeId} workspace`,
          frame: visibleRect(244, 75, Math.max(1, run.width - 255), Math.max(1, run.height - 86)),
          attributes: {
            bindingState: 'OBSERVED',
            revision: 'fixture-revision-0001',
            digest: captureSupervisorBody(browser, 10_000 + (ordinal * 2)).digest,
            evaluatedAtMs: String(10_000 + (ordinal * 2)),
            truthLabel: 'NOT_CONFIGURED',
            persistentSynthetic: 'false',
            continuity: 'PROVEN',
            machineReady: 'NO',
            tradeReady: 'NO',
            effectiveMode: 'READ_ONLY',
            testedCommit: browser.source.headSha,
            schemaRevision: 'product-supervisor.v1',
          },
          powerSelector: '[data-topbar-key="power"]',
          powerMatchCount: 1,
          power: visibleRect(Math.max(0, run.width - 300), 12, 36, 36),
          powerTitle: 'Execution Control — READ ONLY',
          powerAriaLabel: 'Execution Control — READ ONLY',
          indicatorSelector: '.execution-control-trigger-core',
          indicatorMatchCount: 1,
          indicator: visibleRect(Math.max(0, run.width - 294), 18, 24, 24),
          indicatorClassName: 'rail-icon-core execution-control-trigger-core warn',
        },
        consoleBefore: consoleQuery(base, base + 1),
        consoleAfter: consoleQuery(base + 8, base + 9),
      });
    }
  }
  return observations;
}

function captureTranscriptDocument(browser) {
  const capturesByPath = new Map();
  for (const run of browser.runs) {
    for (const route of run.routes) {
      capturesByPath.set(route.screenshotPath, {
        captureKey: `${run.runKey}:${route.routeId}`,
        screenshotPath: route.screenshotPath,
        screenshotSha256: route.screenshotSha256,
        width: run.width,
        height: run.height,
        screenshotMode: 'FULL_VIEWPORT_ROUTE',
        derived: false,
      });
    }
  }
  for (const entry of browser.topbarAudit.entries) {
    for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      const screenshotPath = entry[`${prefix}ScreenshotPath`];
      capturesByPath.set(screenshotPath, {
        captureKey: `TOPBAR:${theme}:${entry.panelId}`,
        screenshotPath,
        screenshotSha256: entry[`${prefix}ScreenshotSha256`],
        width: 1600,
        height: 900,
        screenshotMode: 'FULL_VIEWPORT_WITH_OPEN_PANEL',
        derived: false,
      });
    }
  }
  return {
    schemaVersion: 'i00.in-app-browser-mcp-capture.v3',
    captureProvenance: 'IN_APP_BROWSER_MCP',
    observationContract: 'I00_BROWSER_ROUTE_TRUTH_RECOMPUTE_V1',
    sessionId: browser.source.captureSessionId,
    capturedAtUtc: browser.capturedAtUtc,
    source: {
      headSha: browser.source.headSha,
      treeSha: browser.source.treeSha,
      appOrigin: browser.source.appOrigin,
    },
    captures: [...capturesByPath.values()]
      .toSorted((left, right) => left.screenshotPath.localeCompare(right.screenshotPath, 'en'))
      .map((capture, index) => ({ sequence: index + 1, ...capture })),
    routeObservations: routeObservationsDocument(browser),
    passed: true,
  };
}

function browserArtifactFixture() {
  const document = browserDocument();
  const artifacts = new Map();
  const addPng = (relativePath, width, height, captureKey) => {
    const bytes = pngFixture(width, height, { seed: captureKey });
    artifacts.set(relativePath, bytes);
    return sha256(bytes);
  };
  const addJson = (relativePath, value) => {
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    artifacts.set(relativePath, bytes);
    return sha256(bytes);
  };
  for (const run of document.runs) {
    for (const route of run.routes) {
      const visualAliasId = route.routeId === 'wallets' ? 'account' : route.routeId;
      route.screenshotSha256 = addPng(route.screenshotPath, run.width, run.height, `${run.runKey}:${visualAliasId}`);
    }
  }
  for (const entry of document.bottomUpAudit.entries) {
    for (const [themeKey, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      const row = entry[themeKey];
      const routeId = { health: 'system', logs: 'ledger', basis: 'strategies', token: 'detail', borrow: 'loans' }[entry.pageId] ?? entry.pageId;
      row.screenshotSha256 = addPng(row.screenshotPath, 1600, 900, `1600x900@1-${theme}:${routeId}`);
    }
  }
  for (const entry of document.topbarAudit.entries) {
    for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      entry[`${prefix}ScreenshotSha256`] = addPng(entry[`${prefix}ScreenshotPath`], 1600, 900, `TOPBAR:${theme}:${entry.panelId}`);
    }
  }
  const captureTranscript = captureTranscriptDocument(document);
  const captureTranscriptBytes = Buffer.from(`${JSON.stringify(captureTranscript, null, 2)}\n`, 'utf8');
  artifacts.set(document.source.captureTranscriptPath, captureTranscriptBytes);
  document.source.captureTranscriptSha256 = sha256(captureTranscriptBytes);
  document.restart.measurementSha256 = addJson(document.restart.measurementPath, {
    schemaVersion: 'i00.browser-restart-measurement.v1',
    capturedAtUtc: document.capturedAtUtc,
    source: structuredClone(document.source),
    selector: '#i00-ws-close-diagnostic',
    observationMethod: 'IN_APP_BROWSER_MCP_DOM_READ',
    status: 'OBSERVED',
    code: 1012,
    reason: 'service restart',
    wasClean: true,
    reconnectGeneration: 1,
    postRestartRendered: true,
    passed: true,
  });
  for (const entry of document.bottomUpAudit.entries) {
    for (const [themeKey, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      const row = entry[themeKey];
      row.measurementSha256 = addJson(row.measurementPath, measurementDocument(document, {
        kind: 'BOTTOM_UP_PAGE', subjectId: entry.pageId, theme,
        frameRect: { x: row.frameX, y: row.frameY, width: row.frameWidth, height: row.frameHeight },
        panelMetrics: null,
      }));
    }
  }
  for (const entry of document.topbarAudit.entries) {
    for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
      entry[`${prefix}MeasurementSha256`] = addJson(entry[`${prefix}MeasurementPath`], measurementDocument(document, {
        kind: 'TOPBAR_PANEL', subjectId: entry.panelId, theme,
        frameRect: { x: 100, y: 64, width: entry.shellWidthPx, height: entry.shellHeightPx },
        panelMetrics: { shellWidthPx: entry.shellWidthPx, shellHeightPx: entry.shellHeightPx, headerHeightPx: entry.headerHeightPx },
      }));
    }
  }
  return { document, artifacts, readArtifact: (relativePath) => artifacts.get(relativePath) };
}

function mutateCaptureTranscript(fixture, mutate) {
  const transcriptPath = fixture.document.source.captureTranscriptPath;
  const transcript = JSON.parse(fixture.artifacts.get(transcriptPath).toString('utf8'));
  mutate(transcript);
  const bytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  fixture.artifacts.set(transcriptPath, bytes);
  fixture.document.source.captureTranscriptSha256 = sha256(bytes);
  return validateBrowserArtifacts(fixture.document, fixture.readArtifact);
}

test('bounded performance CLI defaults to plan and refuses ambiguous or unsafe values', () => {
  assert.equal(parseSoakArgs([]).mode, 'PLAN');
  assert.equal(parseSoakArgs(['--run']).mode, 'RUN');
  assert.equal(parseSoakArgs(['--validate-only', 'evidence/test.json']).mode, 'VALIDATE_ONLY');
  assert.throws(() => parseSoakArgs(['--plan', '--run']), /EXACTLY_ONE_MODE_REQUIRED/);
  assert.throws(() => parseSoakArgs(['--run', '--duration-seconds=59']), /OUT_OF_RANGE/);
  assert.throws(() => parseSoakArgs(['--run', '--out=..\/escape.json']), /OUTPUT_PATH_OUTSIDE/);
  assert.throws(() => parseSoakArgs(['--run', '--tested-sha=abc']), /TESTED_SHA_INVALID/);
  assert.equal(assertLoopbackHost('127.0.0.1'), '127.0.0.1');
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /NON_LOOPBACK/);
});

test('complete acceptance exposes explicit modes and each required layer exactly once', () => {
  assert.equal(parseOptions(['--plan']).mode, 'PLAN');
  assert.equal(parseOptions(['--run', '--q-venv=/tmp/q', '--browser-receipt=evidence/browser.json']).mode, 'RUN');
  assert.equal(parseOptions(['--validate-only', '--performance-receipt=evidence/perf.json', '--browser-receipt=evidence/browser.json']).mode, 'VALIDATE_ONLY');
  assert.throws(() => parseOptions(['--run', '--plan']), /EXACTLY_ONE_MODE_REQUIRED/);
  const ids = ACCEPTANCE_PLAN.map((step) => step.id);
  assert.equal(ids.length, 11);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    'q_exact_donor_q17', 'q_exact_donor_all', 'root_test', 'repository_test_all', 'ops_all_local',
    'ops_i00_all_local', 'generated_report_parity', 'local_proxy_performance', 'browser_receipt',
    'source_freeze', 'diff_check',
  ]);
  assert.ok(ACCEPTANCE_PLAN.find((step) => step.id === 'local_proxy_performance').command.includes('--run'));
});

test('metric summaries and local proxy bounds use deterministic fail-closed classifications', () => {
  assert.equal(nearestRank([3, 1, 2, 4], 0.95), 4);
  assert.deepEqual(summarize([]), { count: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null });
  assert.equal(evaluateBound('cpu', 10, LOCAL_PROXY_SLOS.cpuHostPercent).status, 'PASS');
  assert.equal(evaluateBound('cpu', 80, LOCAL_PROXY_SLOS.cpuHostPercent).status, 'DEGRADED');
  assert.equal(evaluateBound('cpu', 91, LOCAL_PROXY_SLOS.cpuHostPercent).status, 'BLOCKED');
  assert.equal(evaluateBound('cpu', null, LOCAL_PROXY_SLOS.cpuHostPercent).status, 'NOT_CONFIGURED');
  assert.equal(aggregateSloStatus([], ['INVARIANT']), 'BLOCKED');
});

test('performance schema and semantics accept complete runtime evidence and reject false green', () => {
  const schema = JSON.parse(readFileSync(path.join(HERE, 'schema.v1.json'), 'utf8'));
  const valid = performanceDocument();
  assert.equal(validateJsonSchema(schema, valid).passed, true);
  assert.equal(validatePerformanceDocument(valid, { headSha: HEAD, treeSha: TREE }).passed, true);

  const falseGreen = structuredClone(valid);
  falseGreen.phases[0].snapshots[0].tradeReadyStatus = 200;
  falseGreen.phases[0].snapshots[0].tradeReadyClassification = 'READY_200';
  falseGreen.slo.degradationVisibility = 'NO_CAPACITY_BREACH';
  const rejected = validatePerformanceDocument(falseGreen, { headSha: HEAD, treeSha: TREE });
  assert.equal(rejected.passed, false);
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_RUNTIME_TRUTH_INVALID'));
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_FALSE_GREEN_VISIBILITY_INVALID'));
});

test('performance semantics reject managed inventory omission and same-shape field forgeries', () => {
  const cases = [
    ['managed inventory entry omission', (inventory) => inventory.entries.splice(0, 1)],
    ['managed inventory identity forgery', (inventory) => {
      inventory.entries[0].identity = 'forged-managed-identity';
    }],
    ['managed inventory owner forgery', (inventory) => {
      inventory.entries[0].owner = 'FORGED_MANAGED_OWNER';
    }],
    ['managed inventory reason forgery', (inventory) => {
      const entry = inventory.entries.find((candidate) => candidate.reasonCode !== null);
      assert.ok(entry);
      entry.reasonCode = 'FORGED_NONEMPTY_REASON';
    }],
    ['managed inventory evidence forgery', (inventory) => {
      const entry = inventory.entries.find((candidate) => candidate.evidence?.length > 0);
      assert.ok(entry);
      entry.evidence[0].componentProjectionIndex = (entry.evidence[0].componentProjectionIndex + 1) % 14;
    }],
  ];
  for (const [caseName, mutate] of cases) {
    const document = performanceDocument();
    mutateEveryPerformanceSnapshot(document, (snapshot) => mutate(snapshot.managedInventory));
    assertRuntimeTruthRejected(document, caseName);
  }
});

test('performance semantics reject canonical component omission, identity forgery, and owner forgery', () => {
  const cases = [
    ['canonical component omission', (components) => components.splice(0, 1)],
    ['canonical component identity forgery', (components) => {
      components[0].componentId = 'forged-canonical-component';
    }],
    ['canonical component owner forgery', (components) => {
      components[0].owner = 'FORGED_CANONICAL_OWNER';
    }],
  ];
  for (const [caseName, mutate] of cases) {
    const document = performanceDocument();
    mutateEveryPerformanceSnapshot(document, (snapshot) => mutate(snapshot.canonicalComponents));
    assertRuntimeTruthRejected(document, caseName);
  }
});

test('performance canonical component owners bind exact authority and owner path', () => {
  assert.deepEqual(CANONICAL_SYSTEM_COMPONENT_OWNERS, [
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
});

test('performance semantics reject product-control omission and exact-row forgeries including authority', () => {
  const cases = [
    ['product control omission', (controls) => controls.splice(0, 1)],
    ['safe-mode backend command forgery', (controls) => {
      controls[0].backendCommandId = 'FORGED_SAFE_MODE_COMMAND';
    }],
    ['kill-switch owner forgery', (controls) => {
      controls[1].owner = 'FORGED_CONTROL_OWNER';
    }],
    ['intake authority forgery', (controls) => {
      controls[2].authority = 'FORGED_SERVER_AUTHORITY';
    }],
    ['restart control identity forgery', (controls) => {
      controls[3].controlId = 'component.forged.restart';
    }],
  ];
  for (const [caseName, mutate] of cases) {
    const document = performanceDocument();
    mutateEveryPerformanceSnapshot(document, (snapshot) => mutate(snapshot.productControls));
    assertRuntimeTruthRejected(document, caseName);
  }
});

test('performance semantics reject stale source, fabricated deployment and broken ops interlock', () => {
  const document = performanceDocument();
  document.source.protectedOwnerDirectives[0].sha256 = SHA;
  document.phases[1].snapshots[1].deployedCommitProjection = HEAD;
  document.phases[1].snapshots[1].opsExternalActionAuthorization = 'MONEY';
  document.phases[1].snapshots[1].opsProjectionValid = false;
  const rejected = validatePerformanceDocument(document, { headSha: 'd'.repeat(40), treeSha: TREE });
  assert.equal(rejected.passed, false);
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_HEAD_SHA_MISMATCH'));
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_PROTECTED_OWNER_DIRECTIVES_INVALID'));
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_RUNTIME_TRUTH_INVALID'));
});

test('performance semantics reject a fabricated accepted restart receipt or effect generation', () => {
  const document = performanceDocument();
  document.canonicalRestart.resultStatus = 'ACCEPTED_ASYNC';
  document.canonicalRestart.receiptId = 'ledger-event:77';
  document.canonicalRestart.durableReceiptObserved = true;
  document.canonicalRestart.effectGenerationAdvanced = true;
  document.canonicalRestart.managedRestartAcceptance = 'PROVEN';
  const rejected = validatePerformanceDocument(document, { headSha: HEAD, treeSha: TREE });
  assert.equal(rejected.passed, false);
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_CANONICAL_RESTART_GATE_INVALID'));
});

test('performance semantics reject SIGKILL recovery without WAL continuity and a preserved crash-pending boot row', () => {
  const document = performanceDocument();
  document.uncleanRecovery.walBytesAfterSigkill = 0;
  document.uncleanRecovery.walBytesBeforeRecoveryLaunch = 0;
  document.uncleanRecovery.crashPendingBootPreserved = false;
  document.phases[1].storage.wal.finalBytes = 0;
  document.phases[2].storage.preLaunch.walBytes = 0;
  document.phases[2].storage.integrity.bootRelease.crashPendingCount = 0;
  document.phases[2].storage.integrity.bootRelease.crashPendingGenerations = [];
  const rejected = validatePerformanceDocument(document, { headSha: HEAD, treeSha: TREE });
  assert.equal(rejected.passed, false);
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_UNCLEAN_RECOVERY_INVALID'));
  assert.ok(rejected.semanticFailures.includes('PERFORMANCE_BOOT_STORAGE_TRUTH_INVALID'));
});

test('browser schema requires six runs, all 21 route mappings, DESIGN audits, BTC detail and no false green', () => {
  const valid = browserDocument();
  const accepted = validateBrowserDocument(valid, HEAD, TREE);
  assert.equal(accepted.passed, true);
  assert.equal(valid.runs.length, 6);
  assert.ok(valid.runs.every((run) => run.routes.length === 21));
  assert.equal(valid.runs[0].routes.find((route) => route.routeId === 'detail').path, '/detail/BTCUSDT');

  const duplicate = structuredClone(valid);
  duplicate.runs[0].routes[20] = structuredClone(duplicate.runs[0].routes[0]);
  assert.equal(validateBrowserDocument(duplicate, HEAD, TREE).passed, false);

  const wrongDetail = structuredClone(valid);
  wrongDetail.runs[1].routes.find((route) => route.routeId === 'detail').path = '/detail/ETHUSDT';
  assert.ok(validateBrowserDocument(wrongDetail, HEAD, TREE).semanticFailures.some((failure) => failure.startsWith('BROWSER_ROUTE_PATH_MAPPING_INVALID')));

  const falseGreen = structuredClone(valid);
  falseGreen.truthChecks.canonicalNonGreenRendered = false;
  assert.ok(validateBrowserDocument(falseGreen, HEAD, TREE).semanticFailures.includes('BROWSER_TRUTH_CHECK_FAILED'));

  const wrongBottomOrder = structuredClone(valid);
  wrongBottomOrder.bottomUpAudit.order.reverse();
  assert.ok(validateBrowserDocument(wrongBottomOrder, HEAD, TREE).semanticFailures.includes('BROWSER_BOTTOM_UP_AUDIT_INVALID'));

  const frameDrift = structuredClone(valid);
  frameDrift.bottomUpAudit.entries[4].dark.frameX += 1;
  assert.ok(validateBrowserDocument(frameDrift, HEAD, TREE).semanticFailures.includes('BROWSER_BOTTOM_UP_FRAME_DRIFT:dark'));

  const wrongTopbarGeometry = structuredClone(valid);
  wrongTopbarGeometry.topbarAudit.entries[9].headerHeightPx = 70;
  assert.ok(validateBrowserDocument(wrongTopbarGeometry, HEAD, TREE).semanticFailures.includes('BROWSER_TOPBAR_PANEL_INVALID:account-details'));

  const forgedCaptureProvenance = structuredClone(valid);
  forgedCaptureProvenance.source.captureProvenance = 'UNBOUND_SCREENSHOT_TOOL';
  const provenanceFailure = validateBrowserDocument(forgedCaptureProvenance, HEAD, TREE);
  assert.equal(provenanceFailure.passed, false);
  assert.ok(provenanceFailure.semanticFailures.includes('BROWSER_CAPTURE_PROVENANCE_INVALID'));

  const legacyBooleanOnly = structuredClone(valid);
  legacyBooleanOnly.schemaVersion = 'i00.local-browser-acceptance.v1';
  legacyBooleanOnly.restart = { performed: true, webSocketClose1012Observed: true, postRestartRendered: true };
  for (const entry of legacyBooleanOnly.topbarAudit.entries) delete entry.screenshotMode;
  assert.equal(validateBrowserDocument(legacyBooleanOnly, HEAD, TREE).passed, false);
});

test('browser claims require decoded, dimension-bound PNG and exact computed-style artifact bytes', () => {
  const fixture = browserArtifactFixture();
  assert.equal(validateBrowserDocument(fixture.document, HEAD, TREE).passed, true);
  const accepted = validateBrowserArtifacts(fixture.document, fixture.readArtifact);
  assert.equal(accepted.passed, true, JSON.stringify(accepted.failures));
  assert.equal(accepted.artifacts.length, 194);
  assert.equal(
    fixture.document.runs[0].routes.find((route) => route.routeId === 'account').screenshotSha256,
    fixture.document.runs[0].routes.find((route) => route.routeId === 'wallets').screenshotSha256,
  );

  const tampered = new Map(fixture.artifacts);
  const firstScreenshot = fixture.document.runs[0].routes[0].screenshotPath;
  tampered.set(firstScreenshot, Buffer.concat([tampered.get(firstScreenshot), Buffer.from('tampered')]));
  const rejected = validateBrowserArtifacts(fixture.document, (relativePath) => tampered.get(relativePath));
  assert.equal(rejected.passed, false);
  assert(rejected.failures.some((failure) => failure.startsWith('ARTIFACT_HASH_MISMATCH:')));

  const forged = browserDocument();
  const forgedResult = validateBrowserArtifacts(forged, () => pngFixture(390, 844));
  assert.equal(forgedResult.passed, false);
  assert(forgedResult.failures.some((failure) => /HASH_MISMATCH|READ_FAILED/.test(failure)));
});

test('browser PNG validation rejects signature-only, bad CRC, corrupt zlib and wrong capture dimensions after hashes are rebound', () => {
  const cases = [
    {
      expected: 'SCREENSHOT_PNG_CHUNK_LENGTH_INVALID',
      mutate: () => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('not-a-real-png', 'utf8')]),
    },
    {
      expected: 'SCREENSHOT_PNG_CRC_INVALID',
      mutate: (original) => {
        const corrupted = Buffer.from(original);
        corrupted[41] ^= 0xff;
        return corrupted;
      },
    },
    {
      expected: 'SCREENSHOT_PNG_ZLIB_DECODE_FAILED',
      mutate: () => pngFixture(390, 844, { idatBytes: Buffer.from('not-a-zlib-stream', 'utf8') }),
    },
    {
      expected: 'SCREENSHOT_PNG_DIMENSIONS_MISMATCH:391x844:EXPECTED_390x844',
      mutate: () => pngFixture(391, 844),
    },
  ];
  for (const hostile of cases) {
    const fixture = browserArtifactFixture();
    const route = fixture.document.runs[0].routes[0];
    const bytes = hostile.mutate(fixture.artifacts.get(route.screenshotPath));
    fixture.artifacts.set(route.screenshotPath, bytes);
    route.screenshotSha256 = sha256(bytes);
    const result = validateBrowserArtifacts(fixture.document, fixture.readArtifact);
    assert.equal(result.passed, false, hostile.expected);
    assert.ok(result.failures.some((failure) => failure.startsWith(`${hostile.expected}:`)), JSON.stringify(result.failures));
  }

  const topbar = browserArtifactFixture();
  const account = topbar.document.topbarAudit.entries.at(-1);
  const wrongPanel = pngFixture(398, 486);
  topbar.artifacts.set(account.lightScreenshotPath, wrongPanel);
  account.lightScreenshotSha256 = sha256(wrongPanel);
  const topbarResult = validateBrowserArtifacts(topbar.document, topbar.readArtifact);
  assert.equal(topbarResult.passed, false);
  assert.ok(topbarResult.failures.some((failure) => failure.startsWith('SCREENSHOT_PNG_DIMENSIONS_MISMATCH:398x486:EXPECTED_1600x900:')));

  const viewport = browserArtifactFixture();
  const clock = viewport.document.topbarAudit.entries[0];
  const wrongViewport = pngFixture(1599, 900);
  viewport.artifacts.set(clock.darkScreenshotPath, wrongViewport);
  clock.darkScreenshotSha256 = sha256(wrongViewport);
  const viewportResult = validateBrowserArtifacts(viewport.document, viewport.readArtifact);
  assert.equal(viewportResult.passed, false);
  assert.ok(viewportResult.failures.some((failure) => failure.startsWith('SCREENSHOT_PNG_DIMENSIONS_MISMATCH:1599x900:EXPECTED_1600x900:')));
});

test('browser PNG validation rejects visually blank captures and cross-subject all-routes-same evidence', () => {
  const blank = browserArtifactFixture();
  const blankRoute = blank.document.runs[0].routes[0];
  const blankBytes = subFilteredUniformPng(390, 844);
  blank.artifacts.set(blankRoute.screenshotPath, blankBytes);
  blankRoute.screenshotSha256 = sha256(blankBytes);
  const blankResult = validateBrowserArtifacts(blank.document, blank.readArtifact);
  assert.equal(blankResult.passed, false);
  assert.ok(blankResult.failures.some((failure) => failure.startsWith('SCREENSHOT_PNG_PIXEL_VARIANCE_INSUFFICIENT:')));

  const duplicated = browserArtifactFixture();
  for (const run of duplicated.document.runs) {
    const sameBytes = pngFixture(run.width, run.height, { seed: `all-routes-same:${run.runKey}` });
    const sameSha256 = sha256(sameBytes);
    for (const route of run.routes) {
      duplicated.artifacts.set(route.screenshotPath, sameBytes);
      route.screenshotSha256 = sameSha256;
    }
  }
  for (const entry of duplicated.document.bottomUpAudit.entries) {
    for (const themeKey of ['light', 'dark']) {
      const row = entry[themeKey];
      row.screenshotSha256 = sha256(duplicated.artifacts.get(row.screenshotPath));
    }
  }
  const duplicateResult = validateBrowserArtifacts(duplicated.document, duplicated.readArtifact);
  assert.equal(duplicateResult.passed, false);
  assert.ok(duplicateResult.failures.some((failure) => failure.startsWith('SCREENSHOT_HASH_REUSED_ACROSS_SUBJECTS:')));
});

test('browser capture transcript is hash-bound and enumerates the exact IN_APP_BROWSER_MCP screenshot set', () => {
  const fixture = browserArtifactFixture();
  const transcriptPath = fixture.document.source.captureTranscriptPath;
  const transcript = JSON.parse(fixture.artifacts.get(transcriptPath).toString('utf8'));
  transcript.captures[0].captureKey = 'FORGED_CAPTURE_KEY';
  const forgedBytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
  fixture.artifacts.set(transcriptPath, forgedBytes);
  fixture.document.source.captureTranscriptSha256 = sha256(forgedBytes);
  const result = validateBrowserArtifacts(fixture.document, fixture.readArtifact);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes('CAPTURE_BINDING_MISMATCH:1:')));

  const derived = browserArtifactFixture();
  const derivedPath = derived.document.source.captureTranscriptPath;
  const derivedTranscript = JSON.parse(derived.artifacts.get(derivedPath).toString('utf8'));
  derivedTranscript.captures[0].derived = true;
  derivedTranscript.captures[0].screenshotMode = 'FULL_VIEWPORT_WITH_OPEN_PANEL';
  const derivedBytes = Buffer.from(`${JSON.stringify(derivedTranscript, null, 2)}\n`, 'utf8');
  derived.artifacts.set(derivedPath, derivedBytes);
  derived.document.source.captureTranscriptSha256 = sha256(derivedBytes);
  const derivedResult = validateBrowserArtifacts(derived.document, derived.readArtifact);
  assert.equal(derivedResult.passed, false);
  assert.ok(derivedResult.failures.some((failure) => failure.includes('CAPTURE_SCHEMA_INVALID:')));
  assert.ok(derivedResult.failures.some((failure) => failure.includes('CAPTURE_BINDING_MISMATCH:1:')));
});

test('browser v3 recomputes canonical API, visible DOM and bounded console truth from raw route observations', () => {
  const moving = browserArtifactFixture();
  const movingResult = mutateCaptureTranscript(moving, (transcript) => {
    const observation = transcript.routeObservations[0];
    const body = JSON.parse(observation.apiAfter.bodyUtf8);
    body.ownerView.machineReady = 'UNKNOWN';
    observation.apiAfter.bodyUtf8 = JSON.stringify(resealSupervisorBody(body));
    observation.apiAfter.byteLength = Buffer.byteLength(observation.apiAfter.bodyUtf8);
    observation.apiAfter.bodySha256 = sha256(observation.apiAfter.bodyUtf8);
  });
  assert.equal(movingResult.passed, false);
  assert.ok(movingResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_API_PROJECTION_MOVED:390x844@1-LIGHT:dashboard')));

  const domDrift = browserArtifactFixture();
  const domResult = mutateCaptureTranscript(domDrift, (transcript) => {
    transcript.routeObservations[0].dom.attributes.revision = 'forged-revision';
  });
  assert.equal(domResult.passed, false);
  assert.ok(domResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_API_DOM_MISMATCH:390x844@1-LIGHT:dashboard')));

  const digestDrift = browserArtifactFixture();
  const digestResult = mutateCaptureTranscript(digestDrift, (transcript) => {
    transcript.routeObservations[0].dom.attributes.digest = '0'.repeat(64);
  });
  assert.equal(digestResult.passed, false);
  assert.ok(digestResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_API_DOM_MISMATCH:390x844@1-LIGHT:dashboard')));

  const forgedApiDigest = browserArtifactFixture();
  const forgedApiDigestResult = mutateCaptureTranscript(forgedApiDigest, (transcript) => {
    const observation = transcript.routeObservations[0].apiBefore;
    const body = JSON.parse(observation.bodyUtf8);
    body.digest = `sha256:${'0'.repeat(64)}`;
    observation.bodyUtf8 = JSON.stringify(body);
    observation.byteLength = Buffer.byteLength(observation.bodyUtf8);
    observation.bodySha256 = sha256(observation.bodyUtf8);
  });
  assert.equal(forgedApiDigestResult.passed, false);
  assert.ok(forgedApiDigestResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_API_BEFORE:390x844@1-LIGHT:dashboard:CANONICAL_SHAPE_INVALID')));

  const timestampDrift = browserArtifactFixture();
  const timestampResult = mutateCaptureTranscript(timestampDrift, (transcript) => {
    transcript.routeObservations[0].dom.attributes.evaluatedAtMs = '999999';
  });
  assert.equal(timestampResult.passed, false);
  assert.ok(timestampResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_API_DOM_MISMATCH:390x844@1-LIGHT:dashboard')));

  const routeIdentityDrift = browserArtifactFixture();
  const routeIdentityResult = mutateCaptureTranscript(routeIdentityDrift, (transcript) => {
    transcript.routeObservations[0].dom.frameClassName = 'app-page-frame frame-calendar';
    transcript.routeObservations[0].dom.frameAriaLabel = 'calendar workspace';
  });
  assert.equal(routeIdentityResult.passed, false);
  assert.ok(routeIdentityResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_DOM_NOT_VISIBLE:390x844@1-LIGHT:dashboard')));

  const falseGreenIndicator = browserArtifactFixture();
  const falseGreenIndicatorResult = mutateCaptureTranscript(falseGreenIndicator, (transcript) => {
    transcript.routeObservations[0].dom.indicatorClassName = 'rail-icon-core execution-control-trigger-core ok';
  });
  assert.equal(falseGreenIndicatorResult.passed, false);
  assert.ok(falseGreenIndicatorResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_FALSE_GREEN:390x844@1-LIGHT:dashboard')));

  const dirtyInitialConsole = browserArtifactFixture();
  const dirtyInitialConsoleResult = mutateCaptureTranscript(dirtyInitialConsole, (transcript) => {
    const entry = { timestampUtc: '2026-07-14T00:00:01.000Z', level: 'error', message: 'pre-existing error' };
    transcript.routeObservations[0].consoleBefore.entries = [entry];
    transcript.routeObservations[0].consoleBefore.returnedCount = 1;
    transcript.routeObservations[0].consoleAfter.entries = [entry];
    transcript.routeObservations[0].consoleAfter.returnedCount = 1;
  });
  assert.equal(dirtyInitialConsoleResult.passed, false);
  assert.ok(dirtyInitialConsoleResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_CONSOLE_SESSION_NOT_CLEAN:390x844@1-LIGHT:dashboard')));

  const consoleGap = browserArtifactFixture();
  const consoleGapResult = mutateCaptureTranscript(consoleGap, (transcript) => {
    const entry = { timestampUtc: '2026-07-14T00:00:02.000Z', level: 'error', message: 'error appeared between observations' };
    transcript.routeObservations[1].consoleBefore.entries = [entry];
    transcript.routeObservations[1].consoleBefore.returnedCount = 1;
    transcript.routeObservations[1].consoleAfter.entries = [entry];
    transcript.routeObservations[1].consoleAfter.returnedCount = 1;
  });
  assert.equal(consoleGapResult.passed, false);
  assert.ok(consoleGapResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_CONSOLE_CROSS_OBSERVATION_GAP:390x844@1-LIGHT:control-room')));

  const hidden = browserArtifactFixture();
  const hiddenResult = mutateCaptureTranscript(hidden, (transcript) => {
    transcript.routeObservations[0].dom.frame.hidden = true;
  });
  assert.equal(hiddenResult.passed, false);
  assert.ok(hiddenResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_DOM_NOT_VISIBLE:390x844@1-LIGHT:dashboard')));

  const consoleError = browserArtifactFixture();
  const consoleResult = mutateCaptureTranscript(consoleError, (transcript) => {
    const observation = transcript.routeObservations[0];
    observation.consoleAfter.entries.push({
      timestampUtc: '2026-07-14T00:00:01.000Z',
      level: 'error',
      message: 'bounded hostile console error',
    });
    observation.consoleAfter.returnedCount = 1;
  });
  assert.equal(consoleResult.passed, false);
  assert.ok(consoleResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_RECEIPT_RECOMPUTE_MISMATCH:390x844@1-LIGHT:dashboard')));

  const fullLimit = browserArtifactFixture();
  const fullLimitResult = mutateCaptureTranscript(fullLimit, (transcript) => {
    const query = transcript.routeObservations[0].consoleAfter;
    query.returnedCount = 1000;
    query.entries = Array.from({ length: 1000 }, (_, index) => ({
      timestampUtc: new Date(Date.UTC(2026, 6, 14, 0, 0, index)).toISOString(),
      level: 'error',
      message: `hostile-${index}`,
    }));
  });
  assert.equal(fullLimitResult.passed, false);
  assert.ok(fullLimitResult.failures.some((failure) => failure.includes('CAPTURE_SCHEMA_INVALID:')));
});

test('browser v3 enforces exact 126 route observations, 146 captures and 194 immutable artifacts', () => {
  const reordered = browserArtifactFixture();
  const reorderedResult = mutateCaptureTranscript(reordered, (transcript) => {
    [transcript.routeObservations[0], transcript.routeObservations[1]] = [transcript.routeObservations[1], transcript.routeObservations[0]];
  });
  assert.equal(reorderedResult.passed, false);
  assert.ok(reorderedResult.failures.some((failure) => failure.includes('CAPTURE_ROUTE_OBSERVATION_BINDING_INVALID:')));

  const missingObservation = browserArtifactFixture();
  const missingObservationResult = mutateCaptureTranscript(missingObservation, (transcript) => {
    transcript.routeObservations.pop();
  });
  assert.equal(missingObservationResult.passed, false);
  assert.ok(missingObservationResult.failures.some((failure) => failure.includes('CAPTURE_SCHEMA_INVALID:')));

  const missingCapture = browserArtifactFixture();
  const missingCaptureResult = mutateCaptureTranscript(missingCapture, (transcript) => {
    transcript.captures.pop();
  });
  assert.equal(missingCaptureResult.passed, false);
  assert.ok(missingCaptureResult.failures.some((failure) => failure.includes('CAPTURE_SCHEMA_INVALID:')));

  const artifactAlias = browserArtifactFixture();
  const first = artifactAlias.document.topbarAudit.entries[0];
  const second = artifactAlias.document.topbarAudit.entries[1];
  second.lightMeasurementPath = first.lightMeasurementPath;
  second.lightMeasurementSha256 = first.lightMeasurementSha256;
  const artifactAliasResult = validateBrowserArtifacts(artifactAlias.document, artifactAlias.readArtifact);
  assert.equal(artifactAliasResult.passed, false);
  assert.ok(artifactAliasResult.failures.some((failure) => failure.startsWith('ARTIFACT_DECLARATION_COUNT_MISMATCH:193:EXPECTED_194')));
});

test('browser restart proof requires one exact hash-bound DOM observation, never a boolean or synthetic status', () => {
  const runMutation = (mutate, expectedFailure) => {
    const fixture = browserArtifactFixture();
    const restartPath = fixture.document.restart.measurementPath;
    const restart = JSON.parse(fixture.artifacts.get(restartPath).toString('utf8'));
    mutate(restart);
    const bytes = Buffer.from(`${JSON.stringify(restart, null, 2)}\n`, 'utf8');
    fixture.artifacts.set(restartPath, bytes);
    fixture.document.restart.measurementSha256 = sha256(bytes);
    const result = validateBrowserArtifacts(fixture.document, fixture.readArtifact);
    assert.equal(result.passed, false, expectedFailure);
    assert.ok(result.failures.some((failure) => failure.includes(expectedFailure)), JSON.stringify(result.failures));
  };

  runMutation((restart) => { restart.code = 1011; }, 'RESTART_CLOSE_EVENT_INVALID');
  runMutation((restart) => { restart.reason = 'restart'; }, 'RESTART_CLOSE_EVENT_INVALID');
  runMutation((restart) => { restart.wasClean = false; }, 'RESTART_CLOSE_EVENT_INVALID');
  runMutation((restart) => { restart.source.headSha = 'd'.repeat(40); }, 'RESTART_SOURCE_MISMATCH');
  runMutation((restart) => { restart.source.treeSha = 'd'.repeat(40); }, 'RESTART_SOURCE_MISMATCH');
  runMutation((restart) => { restart.source.appOrigin = 'http://127.0.0.1:3200'; }, 'RESTART_SOURCE_MISMATCH');
  runMutation((restart) => { restart.source.captureSessionId = 'in-app-browser-mcp-wrong-session-0001'; }, 'RESTART_CAPTURE_PROVENANCE_MISMATCH');
  runMutation((restart) => { restart.reconnectGeneration = 0; }, 'RESTART_RECONNECT_GENERATION_INVALID');
  runMutation((restart) => { restart.status = 'UNAVAILABLE'; }, 'RESTART_CLOSE_EVENT_INVALID');
  runMutation((restart) => { restart.status = 'SYNTHETIC'; }, 'RESTART_CLOSE_EVENT_INVALID');

  const hashMismatch = browserArtifactFixture();
  const hashPath = hashMismatch.document.restart.measurementPath;
  hashMismatch.artifacts.set(hashPath, Buffer.concat([hashMismatch.artifacts.get(hashPath), Buffer.from(' ')]));
  const hashResult = validateBrowserArtifacts(hashMismatch.document, hashMismatch.readArtifact);
  assert.equal(hashResult.passed, false);
  assert.ok(hashResult.failures.some((failure) => failure.startsWith('ARTIFACT_HASH_MISMATCH:')));

  const wrongPath = browserArtifactFixture();
  wrongPath.document.restart.measurementPath = 'test/i00/performance/evidence/browser/restart/unbound.json';
  const wrongPathResult = validateBrowserArtifacts(wrongPath.document, wrongPath.readArtifact);
  assert.equal(wrongPathResult.passed, false);
  assert.ok(wrongPathResult.failures.some((failure) => failure.startsWith('ARTIFACT_BYTES_INVALID:')));

  const undeclared = browserArtifactFixture();
  delete undeclared.document.restart.measurementPath;
  delete undeclared.document.restart.measurementSha256;
  assert.equal(validateBrowserDocument(undeclared.document, HEAD, TREE).passed, false);
  assert.equal(validateBrowserArtifacts(undeclared.document, undeclared.readArtifact).passed, false);
});

test('browser computed evidence rejects DESIGN role drift and measurement provenance forgery with valid artifact hashes', () => {
  const bottom = browserArtifactFixture();
  const bottomRow = bottom.document.bottomUpAudit.entries[0].light;
  const bottomMeasurement = JSON.parse(bottom.artifacts.get(bottomRow.measurementPath).toString('utf8'));
  bottomMeasurement.roles.find((role) => role.role === 'title').computed.fontWeight = 600;
  bottomMeasurement.roles.find((role) => role.role === 'frame').computed.borderRadiusPx = 10;
  const bottomBytes = Buffer.from(`${JSON.stringify(bottomMeasurement, null, 2)}\n`, 'utf8');
  bottom.artifacts.set(bottomRow.measurementPath, bottomBytes);
  bottomRow.measurementSha256 = sha256(bottomBytes);
  const bottomResult = validateBrowserArtifacts(bottom.document, bottom.readArtifact);
  assert.equal(bottomResult.passed, false);
  assert.ok(bottomResult.failures.some((failure) => failure.includes('MEASUREMENT_DESIGN_ROLE_FONT_WEIGHT_MISMATCH:title:')));
  assert.ok(bottomResult.failures.some((failure) => failure.includes('MEASUREMENT_DESIGN_ROLE_BORDER_RADIUS_PX_MISMATCH:frame:')));

  const topbar = browserArtifactFixture();
  const panel = topbar.document.topbarAudit.entries[0];
  const topbarMeasurement = JSON.parse(topbar.artifacts.get(panel.lightMeasurementPath).toString('utf8'));
  topbarMeasurement.roles.find((role) => role.role === 'right-value').computed.fontFamily = 'InterVariable, Inter, sans-serif';
  topbarMeasurement.roles.find((role) => role.role === 'status').computed.textTransform = 'none';
  topbarMeasurement.source.captureProvenance = 'UNBOUND_SCREENSHOT_TOOL';
  const topbarBytes = Buffer.from(`${JSON.stringify(topbarMeasurement, null, 2)}\n`, 'utf8');
  topbar.artifacts.set(panel.lightMeasurementPath, topbarBytes);
  panel.lightMeasurementSha256 = sha256(topbarBytes);
  const topbarResult = validateBrowserArtifacts(topbar.document, topbar.readArtifact);
  assert.equal(topbarResult.passed, false);
  assert.ok(topbarResult.failures.some((failure) => failure.includes('MEASUREMENT_DESIGN_ROLE_FONT_FAMILY_MISMATCH:right-value:')));
  assert.ok(topbarResult.failures.some((failure) => failure.includes('MEASUREMENT_DESIGN_ROLE_TEXT_TRANSFORM_MISMATCH:status:')));
  assert.ok(topbarResult.failures.some((failure) => failure.includes('MEASUREMENT_CAPTURE_PROVENANCE_MISMATCH:')));
});

test('immutable evidence writer refuses traversal and overwrite', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'i00-performance-test-'));
  try {
    const destination = writeImmutableJson(directory, 'receipt.json', { passed: true });
    assert.equal(JSON.parse(readFileSync(destination, 'utf8')).passed, true);
    assert.throws(() => writeImmutableJson(directory, 'receipt.json', { passed: true }), /ALREADY_EXISTS/);
    assert.throws(() => writeImmutableJson(directory, '../escape.json', { passed: true }), /OUTSIDE_EVIDENCE_ROOT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('concurrent immutable evidence writers publish exactly one winner without overwrite or temporary debris', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'i00-performance-race-'));
  const workers = Array.from({ length: 12 }, (_, index) => {
    const worker = new Worker(new URL('./immutable-evidence-writer.worker.mjs', import.meta.url), {
      workerData: {
        directory,
        writerId: `writer-${index + 1}`,
      },
    });
    let readyResolve;
    let readyReject;
    let resultResolve;
    let resultReject;
    let resultSettled = false;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const result = new Promise((resolve, reject) => {
      resultResolve = resolve;
      resultReject = reject;
    });
    worker.on('message', (message) => {
      if (message?.type === 'READY') readyResolve();
      if (message?.type === 'RESULT') {
        resultSettled = true;
        resultResolve(message);
      }
    });
    worker.once('error', (error) => {
      readyReject(error);
      resultReject(error);
    });
    worker.once('exit', (code) => {
      if (!resultSettled) resultReject(new Error(`immutable writer worker exited before result: ${code}`));
    });
    return Object.freeze({ worker, ready, result });
  });

  try {
    await Promise.all(workers.map(({ ready }) => ready));
    for (const { worker } of workers) worker.postMessage({ type: 'GO' });
    const results = await Promise.all(workers.map(({ result }) => result));
    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, workers.length - 1);
    assert.ok(losers.every((result) => /IMMUTABLE_RECEIPT_ALREADY_EXISTS/.test(result.message)));

    const destination = path.join(directory, 'race.json');
    const winningBytes = readFileSync(destination);
    assert.deepEqual(JSON.parse(winningBytes), { writerId: winners[0].writerId });
    assert.throws(
      () => writeImmutableJson(directory, 'race.json', { writerId: 'late-overwriter' }),
      /IMMUTABLE_RECEIPT_ALREADY_EXISTS/,
    );
    assert.deepEqual(readFileSync(destination), winningBytes);
    assert.deepEqual(readdirSync(directory).filter((entry) => entry.includes('.tmp-')), []);
  } finally {
    await Promise.all(workers.map(({ worker }) => worker.terminate()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('secret scan detects constructed credential material without retaining it', () => {
  const prefix = ['A', 'K', 'I', 'A'].join('');
  const finding = scanSecretText(`${prefix}${'Z'.repeat(16)}`);
  assert.equal(finding[0]?.code, 'AWS_ACCESS_KEY');
  assert.equal(scanSecretText('status=NOT_CONFIGURED').length, 0);
});

test('exact accepted Q donor identities remain pinned in the harness contract', () => {
  assert.equal(Q_DONOR_SHA, '02b4eccc8d2ef53b830cafae06e5175715fa6ebb');
  assert.equal(Q_DONOR_TREE, '5c86cebf0966cedd7ba01c56a01704b4f7bd0224');
  assert.equal(Q_RECEIPT_SHA256, '9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc');
});

test('exact Q donor inventory rejects a hostile partial archive before pytest', () => {
  const expected = Q_ARCHIVE_REQUIRED_FILES.map((entry) => ({
    path: entry.path,
    mode: '100644',
    type: 'blob',
  }));
  const observed = Q_ARCHIVE_REQUIRED_FILES.slice(1).map((entry) => ({
    path: entry.path,
    kind: 'REGULAR',
    mode: '100644',
    sha256: entry.sha256,
  }));
  const validation = validateQArchiveInventory(expected, observed);
  assert.equal(validation.passed, false);
  assert.ok(validation.failures.includes('Q_ARCHIVE_REQUIRED_ENTRY_MISSING:EDGE_PROTOCOL_V1.md'));
  assert.ok(validation.failures.includes('Q_ARCHIVE_ENTRY_MISSING:EDGE_PROTOCOL_V1.md'));
});

test('Q venv manifest rejects interpreter, distribution, and plugin-environment drift', () => {
  const fixture = {
    implementation: 'CPython', pythonVersion: '3.13.14', versionInfo: [3, 13, 14],
    prefix: '/accepted/.venv', basePrefix: '/managed/python', executable: '/accepted/.venv/bin/python',
    distributions: [['hypothesis', '6.156.6'], ['pytest', '9.1.1'], ['pytest-cov', '7.1.0']],
  };
  const expected = { pythonVersion: '3.13.14', manifestSha256: sha256(JSON.stringify(fixture)) };
  const context = {
    resolvedVenv: '/accepted/.venv', resolvedPrefix: '/accepted/.venv',
    pythonRealPath: '/managed/python/bin/python3.13', resolvedExecutable: '/managed/python/bin/python3.13',
  };
  assert.equal(validateQVenvManifest(fixture, context, expected).passed, true);
  assert.equal(validateQVenvManifest({ ...fixture, pythonVersion: '3.13.13' }, context, expected).passed, false);
  assert.equal(validateQVenvManifest({ ...fixture, distributions: [...fixture.distributions, ['rogue-plugin', '1.0.0']] }, context, expected).passed, false);
  assert.equal(validateQVenvManifest(fixture, { ...context, resolvedPrefix: '/other/.venv' }, expected).passed, false);
});
