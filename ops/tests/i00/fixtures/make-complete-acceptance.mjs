#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  CANONICAL_SYSTEM_COMPONENT_IDS,
  CANONICAL_SYSTEM_COMPONENT_OWNERS,
  I00_MANAGED_INVENTORY_EXPECTATIONS,
  LOCAL_PROXY_SLOS,
  PERFORMANCE_RUNTIME_CONTROL_EXPECTATIONS,
  PROTECTED_OWNER_DIRECTIVES,
  REQUIRED_LIMITATIONS,
  evaluateBound,
  loadProtectedOwnerDirectiveBundle,
} from '../../../../test/i00/performance/contract.mjs';
import { BASELINE_LIVE_COMPONENT_IDS } from '../../../../test/i00/performance/local-proxy-soak.mjs';
import { computeGitSourceFreeze } from '../../../i00/complete-acceptance-receipt.mjs';

const [sourceRootArg, receiptPathArg, headSha, treeSha] = process.argv.slice(2);
if (!sourceRootArg || !receiptPathArg || !/^[0-9a-f]{40}$/.test(headSha) || !/^[0-9a-f]{40}$/.test(treeSha)) {
  throw new Error('usage: make-complete-acceptance.mjs <source-root> <receipt-path> <head-sha> <tree-sha>');
}
const sourceRoot = path.resolve(sourceRootArg);
const receiptPath = path.resolve(receiptPathArg);
const evidenceRoot = path.join(sourceRoot, 'test/i00/performance/evidence');
const repositoryRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'));
if (realpathSync(sourceRoot) === repositoryRoot) throw new Error('fixture source root must not be the repository root');
mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(path.dirname(receiptPath), { recursive: true });

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const SHA = 'a'.repeat(64);
const startedAtUtc = '2026-07-12T23:58:00.000Z';
const endedAtUtc = '2026-07-12T23:59:00.000Z';
const verifierBundle = loadProtectedOwnerDirectiveBundle(repositoryRoot);
const protectedOwnerDirectives = verifierBundle.members.map((member) => {
  const destination = path.join(sourceRoot, member.path);
  const existing = lstatSync(destination, { throwIfNoEntry: false });
  if (existing === undefined) writeFileSync(destination, member.content, { flag: 'wx', mode: 0o600 });
  else if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`protected directive destination unsafe: ${member.path}`);
  let descriptor;
  try {
    descriptor = openSync(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    const content = readFileSync(descriptor);
    if (!info.isFile() || info.size !== member.byteLength || !content.equals(member.content)
        || sha256(content) !== member.sha256) throw new Error(`protected directive drift: ${member.path}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return { path: member.path, sha256: member.sha256, gitStatus: 'UNTRACKED_PROTECTED_OWNER_INPUT' };
});
let frozenManifest = {
  format: 'GIT_BLOBS_PLUS_PROTECTED_OWNER_DIRECTIVE_HASHES_V2',
  fileCount: 42,
  sha256: SHA,
  protectedOwnerDirectives: protectedOwnerDirectives.map(({ path: directivePath, sha256: directiveSha256 }) => ({ path: directivePath, sha256: directiveSha256 })),
};
try {
  execFileSync('git', ['-C', sourceRoot, 'cat-file', '-e', `${headSha}^{commit}`], { stdio: 'ignore' });
  frozenManifest = computeGitSourceFreeze({ sourceRoot, revision: headSha, protectedOwnerDirectives });
} catch {
  // Simulation fixtures still carry the exact manifest shape; production fixtures bind real Git blobs below.
}

const routePaths = {
  dashboard: '/dashboard', 'control-room': '/control-room', account: '/account', wallets: '/wallets',
  markets: '/markets', detail: '/detail/BTCUSDT', loans: '/loans', execution: '/execution',
  orders: '/orders', positions: '/positions', fills: '/fills', pnl: '/pnl', strategies: '/strategies',
  volume: '/volume', opportunities: '/opportunities', risk: '/risk', ledger: '/ledger',
  system: '/system', notifications: '/notifications', news: '/news', calendar: '/calendar',
};
const runDefinitions = [
  [390, 844, 1, 'LIGHT'], [390, 844, 1, 'DARK'],
  [1600, 900, 1, 'LIGHT'], [1600, 900, 1, 'DARK'],
  [2940, 1200, 1.25, 'LIGHT'], [2940, 1200, 1.25, 'DARK'],
];
const bottomUpDefinitions = [
  ['calendar', '/calendar'], ['news', '/news'], ['health', '/system'], ['logs', '/ledger'],
  ['risk', '/risk'], ['opportunities', '/opportunities'], ['volume', '/volume'],
  ['basis', '/strategies'], ['markets', '/markets'], ['token', '/detail/BTCUSDT'],
  ['borrow', '/loans'], ['account', '/account'], ['dashboard', '/dashboard'],
];
const topbarDefinitions = [
  ['clock', 'clock', 70], ['aws-runner', 'shell', 70], ['api-keys', 'apikey', 70],
  ['trust-advisor', 'advisor', 70], ['notifications', 'notif', 70],
  ['execution-control', 'power', 70], ['currency', 'currency', 70],
  ['basis-units', 'basisu', 70], ['appearance', 'appearance', 70],
  ['account-details', 'account', 84],
];
const browserArtifacts = new Map();
const browserArtifactMedia = new Map();

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function pngFixture(width, height, seed) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  const seedBytes = Buffer.from(sha256(seed), 'hex');
  for (let index = 0; index < 128; index += 1) {
    const row = Math.floor(index / width);
    const column = index % width;
    raw[(row * (width + 1)) + column + 1] = ((seedBytes[index % seedBytes.length] + index) % 255) + 1;
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function addBrowserArtifact(relativePath, bytes, mediaType) {
  browserArtifacts.set(relativePath, bytes);
  browserArtifactMedia.set(relativePath, mediaType);
  return sha256(bytes);
}

function addPng(relativePath, width, height, captureKey) {
  return addBrowserArtifact(relativePath, pngFixture(width, height, captureKey), 'image/png');
}

function computedStyle(kind, role) {
  const computed = {
    display: 'block', fontFamily: 'InterVariable, Inter, sans-serif', fontSizePx: 16,
    fontWeight: 400, lineHeightPx: 20, color: 'rgb(10, 20, 30)', letterSpacingPx: 0,
    borderRadiusPx: 0, borderWidthPx: 0, overflowX: 'visible', overflowY: 'visible',
    fontVariantNumeric: 'normal', textTransform: 'none',
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
    if (role === 'right-value') Object.assign(computed, { fontFamily: 'SFMono-Regular, Menlo, monospace', fontSizePx: 11.5, fontWeight: 450, lineHeightPx: 16, fontVariantNumeric: 'tabular-nums' });
    if (role === 'status') Object.assign(computed, { fontFamily: 'SFMono-Regular, Menlo, monospace', fontSizePx: 9.75, fontWeight: 500, lineHeightPx: 14, textTransform: 'uppercase' });
  }
  return computed;
}

function measurementDocument(browserDocument, { kind, subjectId, theme, frameRect, panelMetrics }) {
  const roles = kind === 'BOTTOM_UP_PAGE'
    ? ['frame', 'title', 'summary-label', 'summary-value', 'row-primary', 'row-secondary']
    : ['header-title', 'header-subtitle', 'row-primary', 'row-secondary', 'right-value', 'status'];
  return {
    schemaVersion: 'i00.browser-measurement.v1', capturedAtUtc: '2026-07-12T23:57:00.000Z',
    source: structuredClone(browserDocument.source), kind, subjectId, theme,
    viewport: { width: 1600, height: 900, zoom: 1 }, frameRect, panelMetrics,
    roles: roles.map((role) => ({ role, selector: `[data-i00-role="${role}"]`, state: 'MEASURED', computed: computedStyle(kind, role) })),
    documentOverflowX: 0, surfaceOverflowX: 0, footerBarCount: 0, passed: true,
  };
}

function captureSupervisorBody(browserDocument, evaluatedAtMs) {
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
        testedCommit: browserDocument.source.headSha,
        schemaRevision: 'product-supervisor.v1',
      },
    },
  };
  return { ...body, digest: `sha256:${sha256(JSON.stringify(body))}` };
}

function rawSupervisorObservation(browserDocument, monotonicMs, evaluatedAtMs) {
  const bodyUtf8 = JSON.stringify(captureSupervisorBody(browserDocument, evaluatedAtMs));
  return {
    observedAtUtc: browserDocument.capturedAtUtc,
    monotonicMs,
    method: 'GET',
    origin: browserDocument.source.appOrigin,
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
    x,
    y,
    width,
    height,
    clientRectCount: 1,
    display: 'block',
    visibility: 'visible',
    opacity: 1,
    hidden: false,
    ariaHidden: null,
  };
}

function consoleQuery(startedAtMs, endedAtMs) {
  return {
    method: 'IN_APP_BROWSER_MCP_DEV_LOGS',
    levels: ['error'],
    limit: 1000,
    startedAtMs,
    endedAtMs,
    returnedCount: 0,
    entries: [],
  };
}

function routeObservationsDocument(browserDocument) {
  const observations = [];
  for (const run of browserDocument.runs) {
    for (const route of run.routes) {
      const observationOrdinal = observations.length + 1;
      const base = observationOrdinal * 20;
      const captureKey = `${run.runKey}:${route.routeId}`;
      observations.push({
        observationOrdinal,
        observationKey: captureKey,
        captureKey,
        runKey: run.runKey,
        routeId: route.routeId,
        logicalPath: route.path,
        clockDomain: 'NODE_MONOTONIC_MS',
        startedAtMs: base + 2,
        domReadAtMs: base + 4,
        screenshotAtMs: base + 5,
        endedAtMs: base + 7,
        apiBefore: rawSupervisorObservation(browserDocument, base + 3, 10_000 + (observationOrdinal * 2)),
        apiAfter: rawSupervisorObservation(browserDocument, base + 6, 10_001 + (observationOrdinal * 2)),
        dom: {
          frameSelector: '.app-page-frame',
          frameMatchCount: 1,
          frameClassName: `app-page-frame frame-${route.routeId === 'wallets' ? 'account' : route.routeId}`,
          frameAriaLabel: `${route.routeId === 'wallets' ? 'account' : route.routeId} workspace`,
          frame: visibleRect(244, 75, Math.max(1, run.width - 255), Math.max(1, run.height - 86)),
          attributes: {
            bindingState: 'OBSERVED',
            revision: 'fixture-revision-0001',
            digest: captureSupervisorBody(browserDocument, 10_000 + (observationOrdinal * 2)).digest,
            evaluatedAtMs: String(10_000 + (observationOrdinal * 2)),
            truthLabel: 'NOT_CONFIGURED',
            persistentSynthetic: 'false',
            continuity: 'PROVEN',
            machineReady: 'NO',
            tradeReady: 'NO',
            effectiveMode: 'READ_ONLY',
            testedCommit: browserDocument.source.headSha,
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

const browser = {
  schemaVersion: 'i00.local-browser-acceptance.v2',
  truthClass: 'LOCAL_BROWSER_MEASURED',
  capturedAtUtc: '2026-07-12T23:57:00.000Z',
  source: {
    headSha, treeSha, appOrigin: 'http://127.0.0.1:3100',
    captureProvenance: 'IN_APP_BROWSER_MCP',
    captureSessionId: 'in-app-browser-mcp-fixture-session-0001',
    captureTranscriptPath: 'test/i00/performance/evidence/browser/capture/session-fixture-0001.json',
    captureTranscriptSha256: SHA,
  },
  runs: runDefinitions.map(([width, height, zoom, theme]) => ({
    runKey: `${width}x${height}@${zoom}-${theme}`,
    width,
    height,
    zoom,
    theme,
    reducedMotionChecked: true,
    sourceTimestampsChecked: true,
    stateLabelsChecked: true,
    controlMappingsChecked: true,
    routes: Object.entries(routePaths).map(([routeId, routePath]) => ({
      routeId,
      path: routePath,
      rendered: true,
      sourceTimestampState: 'MEASURED',
      stateLabelState: 'CANONICAL_COMPARED',
      controlMappingState: 'CANONICAL_COMPARED',
      consoleErrors: 0,
      overflowFailures: 0,
      controlFailures: 0,
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
    canonicalApiCompared: true,
    sourceTimestampsChecked: true,
    stateLabelsChecked: true,
    controlMappingsChecked: true,
    canonicalNonGreenRendered: true,
    noFalseGreen: true,
    fakeControlsFound: 0,
  },
  bottomUpAudit: {
    order: bottomUpDefinitions.map(([pageId]) => pageId), themes: ['LIGHT', 'DARK'],
    sharedStyleCorrectionOccurred: false, restartedAtCalendarAfterCorrection: false,
    entries: bottomUpDefinitions.map(([pageId, routePath]) => ({
      pageId, path: routePath,
      light: {
        frameX: 244, frameY: 75, frameWidth: 1345, frameHeight: 800,
        measurementPath: `test/i00/performance/evidence/browser/bottom-up/LIGHT/${pageId}.json`, measurementSha256: SHA,
        overflowFailures: 0,
        screenshotPath: `test/i00/performance/evidence/browser/routes/1600x900@1-LIGHT/${({ health: 'system', logs: 'ledger', basis: 'strategies', token: 'detail', borrow: 'loans' })[pageId] ?? pageId}.png`, screenshotSha256: SHA,
      },
      dark: {
        frameX: 244, frameY: 75, frameWidth: 1345, frameHeight: 800,
        measurementPath: `test/i00/performance/evidence/browser/bottom-up/DARK/${pageId}.json`, measurementSha256: SHA,
        overflowFailures: 0,
        screenshotPath: `test/i00/performance/evidence/browser/routes/1600x900@1-DARK/${({ health: 'system', logs: 'ledger', basis: 'strategies', token: 'detail', borrow: 'loans' })[pageId] ?? pageId}.png`, screenshotSha256: SHA,
      },
    })),
    passed: true,
  },
  topbarAudit: {
    order: topbarDefinitions.map(([panelId]) => panelId), themes: ['LIGHT', 'DARK'],
    entries: topbarDefinitions.map(([panelId, triggerKey, headerHeightPx]) => ({
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
  limitations: [{ capability: 'private reads', status: 'OWNER_GATED', reason: 'Outside local acceptance.' }],
  passed: true,
};
for (const run of browser.runs) {
  for (const route of run.routes) route.screenshotSha256 = addPng(route.screenshotPath, run.width, run.height, `${run.runKey}:${route.routeId}`);
}
for (const entry of browser.bottomUpAudit.entries) {
  for (const themeKey of ['light', 'dark']) entry[themeKey].screenshotSha256 = sha256(browserArtifacts.get(entry[themeKey].screenshotPath));
}
for (const entry of browser.topbarAudit.entries) {
  for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
    entry[`${prefix}ScreenshotSha256`] = addPng(entry[`${prefix}ScreenshotPath`], 1600, 900, `TOPBAR:${theme}:${entry.panelId}`);
  }
}
const capturesByPath = new Map();
for (const run of browser.runs) {
  for (const route of run.routes) capturesByPath.set(route.screenshotPath, {
    captureKey: `${run.runKey}:${route.routeId}`, screenshotPath: route.screenshotPath,
    screenshotSha256: route.screenshotSha256, width: run.width, height: run.height,
    screenshotMode: 'FULL_VIEWPORT_ROUTE', derived: false,
  });
}
for (const entry of browser.topbarAudit.entries) {
  for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) capturesByPath.set(entry[`${prefix}ScreenshotPath`], {
    captureKey: `TOPBAR:${theme}:${entry.panelId}`, screenshotPath: entry[`${prefix}ScreenshotPath`],
    screenshotSha256: entry[`${prefix}ScreenshotSha256`], width: 1600, height: 900,
    screenshotMode: 'FULL_VIEWPORT_WITH_OPEN_PANEL', derived: false,
  });
}
const captureTranscript = {
  schemaVersion: 'i00.in-app-browser-mcp-capture.v3', captureProvenance: 'IN_APP_BROWSER_MCP',
  observationContract: 'I00_BROWSER_ROUTE_TRUTH_RECOMPUTE_V1',
  sessionId: browser.source.captureSessionId, capturedAtUtc: browser.capturedAtUtc,
  source: { headSha, treeSha, appOrigin: browser.source.appOrigin },
  captures: [...capturesByPath.values()].sort((left, right) => left.screenshotPath.localeCompare(right.screenshotPath, 'en'))
    .map((capture, index) => ({ sequence: index + 1, ...capture })),
  routeObservations: routeObservationsDocument(browser),
  passed: true,
};
const captureBytes = Buffer.from(`${JSON.stringify(captureTranscript, null, 2)}\n`);
browser.source.captureTranscriptSha256 = addBrowserArtifact(browser.source.captureTranscriptPath, captureBytes, 'application/vnd.i00.browser-capture+json');
const restartMeasurement = {
  schemaVersion: 'i00.browser-restart-measurement.v1',
  capturedAtUtc: browser.capturedAtUtc,
  source: structuredClone(browser.source),
  selector: '#i00-ws-close-diagnostic',
  observationMethod: 'IN_APP_BROWSER_MCP_DOM_READ',
  status: 'OBSERVED',
  code: 1012,
  reason: 'service restart',
  wasClean: true,
  reconnectGeneration: 1,
  postRestartRendered: true,
  passed: true,
};
browser.restart.measurementSha256 = addBrowserArtifact(
  browser.restart.measurementPath,
  Buffer.from(`${JSON.stringify(restartMeasurement, null, 2)}\n`),
  'application/vnd.i00.browser-restart-measurement+json',
);
for (const entry of browser.bottomUpAudit.entries) {
  for (const [themeKey, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
    const row = entry[themeKey];
    const measurement = measurementDocument(browser, {
      kind: 'BOTTOM_UP_PAGE', subjectId: entry.pageId, theme,
      frameRect: { x: row.frameX, y: row.frameY, width: row.frameWidth, height: row.frameHeight }, panelMetrics: null,
    });
    row.measurementSha256 = addBrowserArtifact(row.measurementPath, Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`), 'application/json');
  }
}
for (const entry of browser.topbarAudit.entries) {
  for (const [prefix, theme] of [['light', 'LIGHT'], ['dark', 'DARK']]) {
    const measurement = measurementDocument(browser, {
      kind: 'TOPBAR_PANEL', subjectId: entry.panelId, theme,
      frameRect: { x: 100, y: 64, width: 398, height: 486 },
      panelMetrics: { shellWidthPx: 398, shellHeightPx: 486, headerHeightPx: entry.headerHeightPx },
    });
    entry[`${prefix}MeasurementSha256`] = addBrowserArtifact(entry[`${prefix}MeasurementPath`], Buffer.from(`${JSON.stringify(measurement, null, 2)}\n`), 'application/json');
  }
}
for (const [relativePath, bytes] of browserArtifacts) {
  const absolute = path.join(sourceRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
}
const browserRelative = 'test/i00/performance/evidence/local-browser-fixture.json';
const browserBytes = Buffer.from(`${JSON.stringify(browser, null, 2)}\n`);
writeFileSync(path.join(sourceRoot, browserRelative), browserBytes);

const metricSummary = (value = 1) => ({ count: 2, min: value, p50: value, p95: value, p99: value, max: value, mean: value });
const singletonMetricSummary = (value = 1) => ({ count: 1, min: value, p50: value, p95: value, p99: value, max: value, mean: value });
const baselineLiveComponentIds = new Set(BASELINE_LIVE_COMPONENT_IDS);
const serviceReadiness = (componentId) => ({
  basis: ['capital-supervision', 'multileg-risk', 'execution-coordinator-validate-only', 'reconciliation'].includes(componentId)
    ? 'VALIDATE_ONLY_EXECUTOR'
    : componentId === 'ledger-persistence'
      ? 'PERSISTENCE'
      : componentId === 'engine-supervisor'
        ? 'MANAGED_LIFECYCLE'
        : 'PUBLIC_DATA',
  expected: true,
  observed: true,
  requiredForServiceReadiness: true,
  excludedFromServiceReadiness: false,
  waiver: null,
});
const performanceManagedInventoryExpectations = I00_MANAGED_INVENTORY_EXPECTATIONS.map((expected) => (
  expected.identity === 'notification-incident-router'
    ? {
      identity: expected.identity,
      owner: 'PRODUCT_INTEGRATION_INCIDENT_ROUTER',
      canonicalComponentIds: [],
      inventoryState: 'EVIDENCE_PRESENT',
      evidence: [{
        source: 'PRODUCT_RUNTIME_OWNER_PROJECTION',
        ownerId: 'productIntegration.incident-router',
        truthLabel: 'BUILT_AND_TESTED',
      }],
      reasonCode: null,
    }
    : {
      ...expected,
      evidence: expected.canonicalComponentIds.length === 0 ? null : expected.canonicalComponentIds.map((componentId) => ({
        source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION',
        componentId,
        componentProjectionIndex: CANONICAL_SYSTEM_COMPONENT_IDS.indexOf(componentId),
        serviceReadiness: serviceReadiness(componentId),
      })),
    }
));
const managedInventory = {
  schemaVersion: 'i00-managed-inventory.v1',
  expectedIdentityCount: performanceManagedInventoryExpectations.length,
  mappedIdentityCount: performanceManagedInventoryExpectations.filter((entry) => entry.inventoryState === 'EVIDENCE_PRESENT').length,
  evidencePresentCount: performanceManagedInventoryExpectations.filter((entry) => entry.inventoryState === 'EVIDENCE_PRESENT').length,
  ownerGatedCount: performanceManagedInventoryExpectations.filter((entry) => entry.inventoryState === 'OWNER_GATED').length,
  notConfiguredCount: performanceManagedInventoryExpectations.filter((entry) => entry.inventoryState === 'NOT_CONFIGURED').length,
  missingCount: performanceManagedInventoryExpectations.filter((entry) => entry.inventoryState === 'MISSING').length,
  canonicalComponentCount: CANONICAL_SYSTEM_COMPONENT_IDS.length,
  referencedCanonicalComponentCount: new Set(I00_MANAGED_INVENTORY_EXPECTATIONS.flatMap((entry) => entry.canonicalComponentIds)).size,
  observedCanonicalComponentCount: CANONICAL_SYSTEM_COMPONENT_IDS.length,
  entries: performanceManagedInventoryExpectations.map((expected) => ({
    identity: expected.identity,
    owner: expected.owner,
    canonicalComponentIds: [...expected.canonicalComponentIds],
    inventoryState: expected.inventoryState,
    evidence: structuredClone(expected.evidence),
    reasonCode: expected.reasonCode,
  })),
};
const canonicalComponents = CANONICAL_SYSTEM_COMPONENT_IDS.map((componentId, index) => ({
  componentId,
  owner: CANONICAL_SYSTEM_COMPONENT_OWNERS[index],
  observedLifecycle: baselineLiveComponentIds.has(componentId) ? 'READY' : 'BLOCKED',
  capability: baselineLiveComponentIds.has(componentId) ? 'LIVE_PUBLIC' : 'UNAVAILABLE',
  blocker: baselineLiveComponentIds.has(componentId) ? null : 'SIMULATION_FIXTURE_HAS_NO_LIVE_MANAGED_RUNTIME',
}));
const productControls = PERFORMANCE_RUNTIME_CONTROL_EXPECTATIONS.map((expected) => ({
  ...expected,
  wiringState: 'WIRED_LIVE',
  owner: 'systemIntegration.canonical-control-service',
  authority: 'SERVER_DERIVED_OPERATOR',
  disabledReason: null,
}));
const performanceSnapshot = (label, value) => ({
  label, capturedAtUtc: '2026-07-12T23:57:30.000Z', liveStatus: 200,
  readyStatus: 503, readyClassification: 'HONEST_NOT_READY_503',
  tradeReadyStatus: 503, tradeReadyClassification: 'HONEST_NOT_READY_503', healthSemanticsValid: true,
  legacyHealthStatus: 200, stateStatus: 200, stateNowMs: value, eventsCountStatus: 200, eventsCount: value,
  basisStatus: 200, basisLastBookTs: value, basisLastMarkTs: value,
  volumeStatus: 200, volumeLastBookTs: value, volumeLastTradeTs: value, volumeTradeMessages: value,
  productSupervisorStatus: 200, productRevision: `revision-${value}`, runtimeGeneration: value, controlGeneration: value,
  testedCommitProjection: headSha, deployedCommitProjection: null, configRevisionProjection: null,
  schemaRevisionProjection: 'schema-v1', modelRevisionProjection: null, deploymentFrozenProjection: false,
  exposureStateProjection: 'UNKNOWN', ambiguityStateProjection: 'UNKNOWN', recoveryStateProjection: 'UNKNOWN',
  opsInterlockState: 'OPS_INTERLOCK_BLOCKED', opsInterlockBlocksNewEntries: true,
  opsExternalActionAuthorization: 'NONE', reconciliationStatus: 'UNAVAILABLE', reconciliationBlocksNewExposure: true,
  reconciliationReasonCodes: ['RECONCILIATION_TRUTH_UNAVAILABLE'],
  restartControlWiringState: 'WIRED_LIVE', restartControlRevision: 'fixture-restart-control-v1',
  managedInventory: structuredClone(managedInventory),
  canonicalComponents: structuredClone(canonicalComponents),
  productControls: structuredClone(productControls),
  canonicalRuntimeEvidenceValid: true,
  opsProjectionValid: true, bootRevisionProjectionValid: true, qComponentPresent: true,
  qAdvisoryAction: 'ABSTAIN_UNKNOWN', qTruthLabel: 'NOT_CONFIGURED', qCapability: 'UNAVAILABLE',
  qAuthority: 'UNAVAILABLE', qCapitalRelevance: 'NONE', qControlCount: 0, tradeReadyProjection: 'NO',
  qProjectionValid: true, contentSha256: SHA,
});
const performancePhase = (phaseId, bootGeneration, startValue, unclean = false) => ({
  phaseId, bootGeneration, startedAtUtc: '2026-07-12T23:57:30.000Z', endedAtUtc: '2026-07-12T23:58:00.000Z',
  durationSeconds: 30, snapshots: [performanceSnapshot('START', startValue), performanceSnapshot('END', startValue + 1)]
    .map((snapshot) => ({ ...snapshot, runtimeGeneration: bootGeneration, controlGeneration: bootGeneration })),
  http: {
    scheduled: 10, skippedForConcurrency: 0, responses: 10, expectedResponses: 10, unexpectedResponses: 0,
    networkErrors: 0, responseBytes: 1000, throughputRps: 1, responseBytesPerSecond: 100,
    latencyMs: metricSummary(), endpoints: [{ path: '/health/live', requests: 10, responses: 10, unexpected: 0, errors: 0, bytes: 1000, statusCounts: { 200: 10 }, latencyMs: metricSummary() }],
  },
  websocket: {
    clientsRequested: 2, clientsOpened: 2, openErrors: 0, messages: 4, bytes: 100, maxClientBufferedAmountBytes: 0,
    messageTypes: { book: 2, btrades: 2 }, closeCodes: { [unclean ? 1006 : 1012]: 2 },
    shutdownClose1012Count: unclean ? 0 : 2, uncleanClose1006Count: unclean ? 2 : 0,
    focus: { symbol: 'BTCUSDT', burstsAttempted: 1, bookMessages: 2, tradeMessages: 2, status: 'MEASURED', reason: 'Public messages measured.' },
    slowConsumer: { attempted: true, pauseDurationMs: 1000, observedClose1013: false, status: 'NOT_OBSERVED', reason: 'Threshold was not reached.' },
  },
  process: {
    samples: 2, cpuOneCorePercent: metricSummary(), cpuHostPercent: metricSummary(), rssBytes: metricSummary(100),
    heapUsedBytes: metricSummary(50), eventLoopP95Ms: singletonMetricSummary(), eventLoopP99Ms: metricSummary(), eventLoopMaxMs: singletonMetricSummary(), rssSlopeBytesPerHour: 0,
  },
  storage: {
    preLaunch: { databaseBytes: 100, walBytes: phaseId === 'POST_CRASH_RECOVERY' ? 32 : 0, shmBytes: phaseId === 'POST_CRASH_RECOVERY' ? 16 : 0 },
    samples: 2, database: { initialBytes: 100, finalBytes: 100, maxBytes: 100, growthBytes: 0 },
    wal: { initialBytes: unclean ? 0 : phaseId === 'POST_CRASH_RECOVERY' ? 32 : 0, finalBytes: unclean ? 32 : 0, maxBytes: 32, growthBytes: unclean ? 32 : phaseId === 'POST_CRASH_RECOVERY' ? -32 : 0 },
    shm: { initialBytes: unclean ? 0 : phaseId === 'POST_CRASH_RECOVERY' ? 16 : 0, finalBytes: unclean ? 16 : 0, maxBytes: 16, growthBytes: unclean ? 16 : phaseId === 'POST_CRASH_RECOVERY' ? -16 : 0 },
    integrity: unclean ? null : {
      quickCheck: 'ok', foreignKeyViolationCount: 0, userVersion: 1, eventCount: startValue,
      integrityCheck: 'ok', journalMode: 'wal',
      bootRelease: {
        rowCount: bootGeneration, latestGeneration: bootGeneration, latestTestedCommit: headSha,
        latestDeployedCommit: null, latestConfigRevision: null, latestSchemaRevision: 'schema-v1', latestModelRevision: null,
        latestStartedAtMs: startValue, latestCompletedAtMs: startValue + 1, latestClean: true,
        latestBlockerCode: null, allRowsClean: bootGeneration === 1,
        cleanCompletedCount: bootGeneration === 1 ? 1 : 2,
        crashPendingCount: bootGeneration === 1 ? 0 : 1,
        crashPendingGenerations: bootGeneration === 1 ? [] : [2],
        allRowsIdentityValid: true, expectedLatestLifecycle: 'CLEAN_COMPLETED', latestLifecycleState: 'CLEAN_COMPLETED',
        expectedCrashPendingGenerations: bootGeneration === 1 ? [] : [2], lifecycleExpectationMet: true, passed: true,
      },
      controlCommand: {
        idempotencyKey: 'i00.performance.restart.fixture', durableReceiptObserved: false,
        durableRejectionAuditObserved: true, rejectionCode: 'RESTART_EXPOSURE_NONE_NOT_PROVEN',
        rejectionActorSource: 'loopback', checkpointControlRevision: 1, checkpointControlGeneration: 1, passed: true,
      },
      passed: true,
    },
  },
  shutdown: {
    mode: unclean ? 'UNCLEAN_CRASH' : 'GRACEFUL', signal: unclean ? 'SIGKILL' : 'SIGTERM',
    exitCode: unclean ? null : 0, exitSignal: unclean ? 'SIGKILL' : null, durationMs: 10, cleanLogMarkerObserved: !unclean,
    stdoutSha256: SHA, stderrSha256: SHA, telemetrySha256: SHA, logOverflow: false, passed: true,
  },
});
const performanceChecks = [
  evaluateBound('host.cpu.percent.p95', 1, LOCAL_PROXY_SLOS.cpuHostPercent),
  evaluateBound('node.event_loop_lag_ms.p99', 1, LOCAL_PROXY_SLOS.eventLoopLagMs),
  evaluateBound('process.rss_bytes.max', 100, LOCAL_PROXY_SLOS.rssBytes),
  evaluateBound('soak.rss_slope_bytes_per_hour.max', 0, LOCAL_PROXY_SLOS.rssSlopeBytesPerHour),
  evaluateBound('storage.wal_bytes.max', 32, LOCAL_PROXY_SLOS.walBytes),
  evaluateBound('api.http_latency_ms.p95', 1, LOCAL_PROXY_SLOS.httpP95Ms),
  evaluateBound('api.unexpected_percent', 0, LOCAL_PROXY_SLOS.httpUnexpectedPercent),
  evaluateBound('api.response_bytes_per_second', 100 / 3, LOCAL_PROXY_SLOS.apiBytesPerSecond),
];
const performance = {
  schemaVersion: 'i00.local-proxy-performance.v1', truthClass: 'LOCAL_PROXY_MEASURED',
  runId: 'fixture-performance-run', createdAtUtc: '2026-07-12T23:57:30.000Z',
  source: {
    branch: 'i00-product-assembly-20260713', headSha, treeSha,
    worktreeState: 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE', protectedOwnerDirectives,
    serverBundleSha256: SHA, harnessTreeSha256: SHA,
  },
  host: {
    fingerprintSha256: SHA, platform: 'darwin', release: 'test', arch: 'arm64', nodeVersion: 'v24.0.0',
    cpuModel: 'test', logicalCpuCount: 8, totalMemoryBytes: 1024,
  },
  boundary: {
    proxyClass: 'DOCUMENTED_LOCAL_PROXY', fingerprintSha256: SHA, bindHost: '127.0.0.1', transport: 'LOOPBACK_HTTP_WS',
    reverseProxy: 'NONE', forwardedHeaders: 'ABSENT', childEnvironment: 'ALLOWLIST_ONLY', keyMode: 'KEYLESS',
    publicSourcePolicy: 'RUNTIME_OWNED_PUBLIC_ONLY',
    forbiddenActions: ['PRIVATE_READS', 'SIGNED_CALLS', 'LIVE_ORDERS', 'TRANSFER_WITHDRAWAL', 'DEPLOYMENT'],
  },
  load: {
    configuredDurationSeconds: 60, measuredWindowSeconds: 60, sampleIntervalMs: 1000,
    httpTargetRps: 24, httpConcurrency: 8, webSocketClients: 2, focusSymbol: 'BTCUSDT', phaseCount: 3,
    endpoints: [{ path: '/health/live', expectedStatuses: [200] }],
  },
  phases: [
    performancePhase('CANONICAL_RESTART_GATE', 1, 100),
    performancePhase('UNCLEAN_TERMINATION', 2, 150, true),
    performancePhase('POST_CRASH_RECOVERY', 3, 200),
  ],
  canonicalRestart: (() => {
    const barrier = {
      exposureState: 'UNKNOWN', ambiguityState: 'UNKNOWN', recoveryState: 'UNKNOWN',
      opsInterlockState: 'OPS_INTERLOCK_BLOCKED', opsInterlockBlocksNewEntries: true,
      reconciliationStatus: 'UNAVAILABLE', reconciliationBlocksNewExposure: true,
      reconciliationReasonCodes: ['RECONCILIATION_TRUTH_UNAVAILABLE'], readyStatus: 503, tradeReadyStatus: 503,
    };
    return {
      controlId: 'component.engine-supervisor.restart', authentication: 'SERVER_DERIVED_LOOPBACK', operatorPayloadSent: false,
      previewStatus: 200, previewId: `prv_${SHA}`, previewDigest: `sha256:${SHA}`, previewSynthetic: false,
      submitStatus: 200, idempotencyKey: 'i00.performance.restart.fixture', resultStatus: 'REJECTED_STATE',
      commandId: 'command-fixture-restart', correlationId: 'correlation-fixture-restart', receiptId: null,
      resultSynthetic: false, resultBeforeSha256: SHA, resultAfterSha256: SHA, resultStateUnchanged: true,
      resultBeforeRevision: 1, resultAfterRevision: 1, resultBeforeGeneration: 1, resultAfterGeneration: 1,
      beforeBarrier: barrier, afterBarrier: structuredClone(barrier), disposition: 'OWNER_GATED', managedRestartAcceptance: 'NOT_PROVEN',
      durableReceiptObserved: false, durableRejectionAuditObserved: true, rejectionCode: 'RESTART_EXPOSURE_NONE_NOT_PROVEN',
      controlGenerationAdvanced: false, runtimeGenerationAdvanced: false, effectGenerationAdvanced: false,
      webSocketClose1012Observed: true, barrierPreserved: true, passed: true,
    };
  })(),
  uncleanRecovery: {
    terminationSignal: 'SIGKILL', uncleanBootGeneration: 2, recoveryBootGeneration: 3,
    walBytesAfterSigkill: 32, shmBytesAfterSigkill: 0, walBytesBeforeRecoveryLaunch: 32, shmBytesBeforeRecoveryLaunch: 16,
    databaseOpenedByHarnessBetweenCrashAndRecovery: false, applicationRuntimeFirstRecoveryOpen: true,
    crashPendingGeneration: 2, crashPendingBootPreserved: true, recoveryLatestLifecycleState: 'CLEAN_COMPLETED',
    recoveryWalRemovedOnCleanClose: true, readinessHonestAfterRecovery: true, reconciliationStillBlocksAfterRecovery: true,
    testedShaPreserved: true, deployedShaAbsent: true, quickCheck: 'ok', integrityCheck: 'ok', passed: true,
  },
  continuity: {
    sameDataDirectory: true, firstCleanEventCount: 100, recoveredEventCount: 200, eventCountNondecreasing: true,
    gracefulStopsClean: true, gracefulSocketsReceived1012: true, crashSocketsClosedAbnormally: true,
    databaseIntegrityOnReadableStops: true, bootGenerationsOneTwoThree: true, testedShaAllBoots: true,
    deployedShaAbsentAllBoots: true, opsReadbackNotFrozenAllBoots: true, opsInterlockHonestAllBoots: true,
    canonicalRestartOwnerGateProven: true, uncleanRecoveryProven: true, passed: true, reasonCodes: [],
  },
  limitations: REQUIRED_LIMITATIONS.map((entry) => ({ ...entry })),
  slo: {
    scope: 'LOCAL_PROXY_INITIAL_GATES', checks: performanceChecks, invariantFailures: [], overall: 'PASS',
    degradationVisibility: 'CANONICAL_NON_GREEN_VISIBLE', productionClaim: 'UNKNOWN',
  },
  artifacts: {
    receiptRelativePath: 'evidence/local-performance-fixture.json', receiptWriteMode: 'IMMUTABLE_CREATE_ONLY',
    schemaRelativePath: 'schema.v1.json', schemaSha256: SHA,
    secretScan: { artifactsScanned: 7, findings: [], passed: true },
  },
};
const performanceRelative = 'test/i00/performance/evidence/local-performance-fixture.json';
const performanceBytes = Buffer.from(`${JSON.stringify(performance, null, 2)}\n`);
writeFileSync(path.join(sourceRoot, performanceRelative), performanceBytes);

const browserReceipt = {
  relativePath: browserRelative,
  sha256: sha256(browserBytes),
  byteLength: browserBytes.length,
  runCount: browser.runs.length,
  routeCaptureCount: browser.runs.reduce((total, run) => total + run.routes.length, 0),
  artifactCount: browserArtifacts.size,
  restart: {
    performed: true,
    webSocketClose1012Observed: true,
    postRestartRendered: true,
    diagnosticSelector: '#i00-ws-close-diagnostic',
    reconnectGeneration: 1,
    measurementPath: browser.restart.measurementPath,
    measurementSha256: browser.restart.measurementSha256,
  },
  schemaSha256: sha256(readFileSync(path.join(repositoryRoot, 'test/i00/performance/browser-receipt.schema.v2.json'))),
  browserMeasurementSchemaSha256: sha256(readFileSync(path.join(repositoryRoot, 'test/i00/performance/browser-measurement.schema.v1.json'))),
  browserCaptureSchemaSha256: sha256(readFileSync(path.join(repositoryRoot, 'test/i00/performance/browser-capture.schema.v3.json'))),
  browserRestartSchemaSha256: sha256(readFileSync(path.join(repositoryRoot, 'test/i00/performance/browser-restart-measurement.schema.v1.json'))),
  schemaValid: true,
  schemaErrors: [],
  semanticFailures: [],
  artifacts: [...browserArtifacts.entries()]
    .map(([relativePath, bytes]) => ({
      relativePath, sha256: sha256(bytes), byteLength: bytes.length,
      mediaType: browserArtifactMedia.get(relativePath),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en')),
  secretFindings: [],
  passed: true,
};
const performanceReceipt = {
  relativePath: performanceRelative,
  sha256: sha256(performanceBytes),
  byteLength: performanceBytes.length,
  schemaVersion: 'i00.local-proxy-performance.v1',
  overall: 'PASS',
  schemaValid: true,
  schemaErrors: [],
  semanticFailures: [],
  secretFindings: [],
  passed: true,
};
const sourceEvidenceEntries = [
  { relativePath: browserReceipt.relativePath, sha256: browserReceipt.sha256, byteLength: browserReceipt.byteLength },
  ...browserReceipt.artifacts.map(({ relativePath, sha256: artifactSha256, byteLength }) => ({ relativePath, sha256: artifactSha256, byteLength })),
].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
const sourceEvidence = { entries: sourceEvidenceEntries, sha256: sha256(JSON.stringify(sourceEvidenceEntries)) };
const performanceEvidenceEntries = [{
  relativePath: performanceReceipt.relativePath,
  sha256: performanceReceipt.sha256,
  byteLength: performanceReceipt.byteLength,
}];
const performanceEvidence = { entries: performanceEvidenceEntries, sha256: sha256(JSON.stringify(performanceEvidenceEntries)) };

const plans = [
  { id: 'q_current_gate', kind: 'Q_CURRENT', command: ['node', 'test/run-quant-gates.mjs'] },
  { id: 'root_test', kind: 'COMMAND', command: ['npm', 'test'] },
  { id: 'repository_test_all', kind: 'COMMAND', command: ['npm', 'run', 'test:all'] },
  { id: 'ops_all_local', kind: 'COMMAND', command: ['bash', 'ops/tests/run-all.sh'] },
  { id: 'ops_i00_all_local', kind: 'COMMAND', command: ['bash', 'ops/tests/i00/run-all.sh'] },
  { id: 'generated_report_parity', kind: 'REPORT_PARITY', command: [] },
  { id: 'local_proxy_performance', kind: 'PERFORMANCE', command: [process.execPath, 'test/i00/performance/local-proxy-soak.mjs', '--run', '--duration-seconds=<bounded>'] },
  { id: 'browser_receipt', kind: 'BROWSER_RECEIPT', command: [] },
  { id: 'source_freeze', kind: 'SOURCE_FREEZE', command: [] },
  { id: 'diff_check', kind: 'COMMAND', command: ['git', 'diff', '--check'] },
];
const measuredPerformanceCommand = [process.execPath, 'test/i00/performance/local-proxy-soak.mjs', '--run', `--tested-sha=${headSha}`, '--duration-seconds=60', '--out=local-proxy-performance-20260712235800000-1234.json'];
const commonStep = (id, command, stdoutBytes = 1, stdoutSha256 = SHA) => ({
  id,
  command,
  cwdRelative: '.',
  startedAtUtc,
  endedAtUtc,
  durationMs: 1,
  exitCode: 0,
  exitSignal: null,
  timedOut: false,
  stdoutBytes,
  stderrBytes: 0,
  stdoutSha256,
  stderrSha256: SHA,
  parsedCounts: {},
  secretFindings: [],
  outputOverflow: false,
  passed: true,
});
const steps = [
  commonStep('q_current_gate', plans[0].command),
  commonStep('root_test', plans[1].command),
  commonStep('repository_test_all', plans[2].command),
  commonStep('ops_all_local', plans[3].command),
  commonStep('ops_i00_all_local', plans[4].command),
  { ...commonStep('generated_report_parity', []), artifacts: [] },
  commonStep('local_proxy_performance', measuredPerformanceCommand),
  commonStep('browser_receipt', [], browserReceipt.byteLength, browserReceipt.sha256),
  {
    ...commonStep('source_freeze', []),
    initial: { ...frozenManifest },
    final: { ...frozenManifest },
    initialEvidence: sourceEvidence,
    finalInitialEvidence: sourceEvidence,
    performanceEvidence,
  },
  commonStep('diff_check', plans[9].command),
];
const receipt = {
  schemaVersion: 'i00.local-acceptance.v1',
  truthClass: 'LOCAL_COMPLETE_ACCEPTANCE_MEASURED',
  runId: 'fixture-complete-acceptance',
  startedAtUtc,
  endedAtUtc,
  source: {
    branch: 'i00-product-assembly-20260713',
    headSha,
    treeSha,
    worktreeState: 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE',
    protectedOwnerDirectives,
  },
  sourceFreeze: { ...frozenManifest, evidence: sourceEvidence, protectedOwnerDirectives },
  qExactDonor: {
    donorSha: '02b4eccc8d2ef53b830cafae06e5175715fa6ebb',
    donorTree: '5c86cebf0966cedd7ba01c56a01704b4f7bd0224',
    receiptPath: 'quant/RECEIPTS/Q17_ACCEPTANCE.md',
    receiptSha256: '9cfa0356228d7f48674df2d9db523f0f0d53dab1a4e4255b6ba9676e463ec5dc',
    venv: {
      resolvedPathSha256: SHA,
      pythonSha256: SHA,
      integrity: {
        implementation: 'CPython', pythonVersion: '3.13.14',
        pyprojectSha256: 'a4d68e05b607e60a99fa3856ed8f8cd3addc80998c65ca6d458118745970ca81',
        uvLockSha256: '716a9d0208f449bba51cde7fd67f9c90206ab0724aeac86ba862e119be859d29',
        manifestSha256: 'b83ef8e8be73d5a98bae3309649531136890444edd81b71fe3b503feb6fdbc0e',
        distributionCount: 42,
        pipCheck: { exitCode: 0, stdoutSha256: SHA, stderrSha256: SHA, passed: true },
        pytestPluginPolicy: { autoLoad: 'DISABLED', explicit: ['_hypothesis_pytestplugin', 'pytest_cov.plugin'] },
      },
    },
  },
  uv: {
    resolvedPathSha256: SHA,
    binarySha256: SHA,
  },
  plan: plans,
  steps,
  missingSteps: [],
  performanceReceipt,
  browserReceipt,
  externalBoundary: {
    privateReads: 'OWNER_GATED_NOT_RUN',
    signedCalls: 'OWNER_GATED_NOT_RUN',
    awsCloudflare: 'OWNER_GATED_NOT_RUN',
    deployPush: 'NOT_RUN',
    moneyPaths: 'FORBIDDEN_NOT_RUN',
  },
  secretScan: { findings: [], passed: true },
  passed: true,
};
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

// Make it easy for shell callers to locate the three generated artifacts.
process.stdout.write(`${JSON.stringify({ receiptPath, browserPath: path.join(sourceRoot, browserRelative), performancePath: path.join(sourceRoot, performanceRelative) })}\n`);
