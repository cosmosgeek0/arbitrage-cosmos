#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import WebSocket from 'ws';

import {
  CANONICAL_SYSTEM_COMPONENT_OWNERS,
  CANONICAL_SYSTEM_COMPONENT_IDS,
  I00_MANAGED_INVENTORY_EXPECTATIONS,
  I00_MANAGED_COMPONENT_IDENTITIES,
  LOCAL_PROXY_SLOS,
  PRODUCT_RUNTIME_CONTROL_EXPECTATIONS,
  PRODUCT_RUNTIME_CONTROL_IDS,
  PROTECTED_OWNER_DIRECTIVES,
  REPORT_SCHEMA_VERSION,
  REQUIRED_LIMITATIONS,
  SAFE_HTTP_ENDPOINTS,
  aggregateSloStatus,
  assertLoopbackHost,
  canonicalJson,
  evaluateBound,
  parseBoundedInteger,
  scanSecretText,
  sha256,
  summarize,
  validateJsonSchema,
  verifyProtectedOwnerDirectives,
  writeImmutableJson,
} from './contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HARNESS_ROOT = path.join(ROOT, 'test/i00/performance');
const EVIDENCE_ROOT = path.join(HARNESS_ROOT, 'evidence');
const SCHEMA_PATH = path.join(HARNESS_ROOT, 'schema.v1.json');
const PROBE_PATH = path.join(HARNESS_ROOT, 'app-probe.mjs');
const SERVER_BUNDLE = path.join(ROOT, 'server/dist/index.js');
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const HOST = '127.0.0.1';
const CANONICAL_RESTART_CONTROL_ID = 'component.engine-supervisor.restart';
const SYSTEM_CHECKPOINT_CONFIG_KEY = 'system.integration.checkpoint.v1';

function optionMap(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`UNKNOWN_ARGUMENT:${token}`);
    const equal = token.indexOf('=');
    if (equal > 2) {
      result.set(token.slice(2, equal), token.slice(equal + 1));
      continue;
    }
    const key = token.slice(2);
    if (key === 'long' || key === 'plan' || key === 'run') {
      result.set(key, 'true');
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`MISSING_ARGUMENT_VALUE:${key}`);
    result.set(key, next);
    index += 1;
  }
  return result;
}

export function parseSoakArgs(argv) {
  const values = optionMap(argv);
  const known = new Set(['duration-seconds', 'http-rps', 'http-concurrency', 'ws-clients', 'sample-interval-ms', 'focus-symbol', 'out', 'long', 'plan', 'run', 'validate-only', 'tested-sha']);
  for (const key of values.keys()) if (!known.has(key)) throw new Error(`UNKNOWN_OPTION:${key}`);
  const durationDefault = values.has('long') ? '900' : '60';
  const focusSymbol = (values.get('focus-symbol') ?? 'BTCUSDT').toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(focusSymbol)) throw new Error('FOCUS_SYMBOL_INVALID');
  const output = values.get('out') ?? null;
  if (output !== null && (path.isAbsolute(output) || output.startsWith('../') || output.includes('/../'))) throw new Error('OUTPUT_PATH_OUTSIDE_EVIDENCE_ROOT');
  const selectedModes = [values.has('plan'), values.has('run'), values.has('validate-only')].filter(Boolean).length;
  if (selectedModes > 1) throw new Error('EXACTLY_ONE_MODE_REQUIRED');
  const testedSha = values.get('tested-sha') ?? null;
  if (testedSha !== null && !/^[a-f0-9]{40}$/.test(testedSha)) throw new Error('TESTED_SHA_INVALID');
  return Object.freeze({
    mode: values.has('run') ? 'RUN' : values.has('validate-only') ? 'VALIDATE_ONLY' : 'PLAN',
    validateReceipt: values.get('validate-only') ?? null,
    testedSha,
    durationSeconds: parseBoundedInteger(values.get('duration-seconds') ?? durationDefault, 'DURATION_SECONDS', 60, 3_600),
    httpRps: parseBoundedInteger(values.get('http-rps') ?? '24', 'HTTP_RPS', 1, 100),
    httpConcurrency: parseBoundedInteger(values.get('http-concurrency') ?? '8', 'HTTP_CONCURRENCY', 1, 32),
    wsClients: parseBoundedInteger(values.get('ws-clients') ?? '4', 'WS_CLIENTS', 1, 8),
    sampleIntervalMs: parseBoundedInteger(values.get('sample-interval-ms') ?? '1000', 'SAMPLE_INTERVAL_MS', 250, 5_000),
    focusSymbol,
    output,
  });
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sourceStatus() {
  const records = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((entry) => entry.length > 0);
  const parsed = records.map((entry) => Object.freeze({ status: entry.slice(0, 2), path: entry.slice(3) }));
  const statusByPath = new Map(parsed.map((entry) => [entry.path, entry.status]));
  const protectedOwnerDirectives = verifyProtectedOwnerDirectives(ROOT, statusByPath);
  const protectedPaths = new Set(protectedOwnerDirectives.map((entry) => entry.path));
  const dirtyPaths = parsed
    .filter((entry) => !protectedPaths.has(entry.path))
    .filter((entry) => !(entry.status === '??' && entry.path.startsWith('test/i00/performance/evidence/')))
    .map((entry) => `${entry.status}:${entry.path}`)
    .toSorted();
  return Object.freeze({ dirtyPaths, protectedOwnerDirectives });
}

function assertSourceBoundToHead() {
  const status = sourceStatus();
  if (status.dirtyPaths.length > 0) throw new Error(`SOURCE_NOT_FROZEN_DIRTY_PATHS:${status.dirtyPaths.length}`);
  return status.protectedOwnerDirectives;
}

function fileSha256(filename) {
  return sha256(readFileSync(filename));
}

function harnessFiles(directory = HARNESS_ROOT, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'evidence') continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`HARNESS_SYMLINK_FORBIDDEN:${relative}`);
    if (entry.isDirectory()) files.push(...harnessFiles(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.toSorted();
}

function harnessTreeSha256() {
  const digest = createHash('sha256');
  for (const relative of harnessFiles()) {
    digest.update(`${relative}\0`);
    digest.update(readFileSync(path.join(HARNESS_ROOT, relative)));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('LOOPBACK_PORT_RESERVATION_FAILED'));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function captureStream(stream) {
  const digest = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  let text = '';
  let bytes = 0;
  let overflow = false;
  stream.on('data', (chunk) => {
    digest.update(chunk);
    bytes += chunk.length;
    if (bytes <= MAX_CAPTURE_BYTES) text += decoder.write(chunk);
    else overflow = true;
  });
  stream.on('end', () => {
    if (!overflow) text += decoder.end();
  });
  return {
    content: () => text,
    bytes: () => bytes,
    overflow: () => overflow,
    digest: () => digest.digest('hex'),
  };
}

function childFinished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (childFinished(child)) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('close', onClose);
    };
    const onClose = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('CHILD_EXIT_TIMEOUT'));
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function waitForServer(child, origin) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (childFinished(child)) throw new Error(`APP_EXITED_DURING_STARTUP:${child.exitCode ?? child.signalCode}`);
    try {
      const response = await fetch(`${origin}/health/live`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch {
      // Listener and composition are still starting.
    }
    await delay(250);
  }
  throw new Error('APP_STARTUP_TIMEOUT');
}

async function startBuiltApp(dataDir, port, sampleIntervalMs, testedSha) {
  if (!statSync(SERVER_BUNDLE, { throwIfNoEntry: false })?.isFile()) throw new Error('BUILT_SERVER_BUNDLE_MISSING');
  assertLoopbackHost(HOST);
  const opsStateDir = path.join(dataDir, 'ops-state');
  mkdirSync(opsStateDir, { recursive: true, mode: 0o700 });
  const deployFrozenMarker = path.join(opsStateDir, 'deploy-frozen.json');
  if (statSync(deployFrozenMarker, { throwIfNoEntry: false })) throw new Error('DEPLOY_FROZEN_MARKER_MUST_BE_ABSENT');
  const child = spawn(process.execPath, ['--import', PROBE_PATH, SERVER_BUNDLE], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      NODE_ENV: 'production',
      TZ: 'UTC',
      LC_ALL: 'C',
      HOST,
      PORT: String(port),
      DATA_DIR: dataDir,
      PROFILE_CACHE: path.join(dataDir, 'profile-cache.json'),
      ICON_CACHE: path.join(dataDir, 'icon-cache.json'),
      LIQ_CACHE: path.join(dataDir, 'liquidations.json'),
      SKIP_DOTENV: '1',
      I00_PERF_PROBE: '1',
      I00_PERF_TELEMETRY_FD: '3',
      I00_PERF_SAMPLE_INTERVAL_MS: String(sampleIntervalMs),
      I00_TESTED_SHA: testedSha,
      I00_OPS_STATE_DIR: opsStateDir,
      I00_DEPLOY_FROZEN_MARKER: deployFrozenMarker,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  const stdout = captureStream(child.stdout);
  const stderr = captureStream(child.stderr);
  const telemetry = captureStream(child.stdio[3]);
  try {
    await waitForServer(child, `http://${HOST}:${port}`);
    return { child, stdout, stderr, telemetry };
  } catch (error) {
    if (!childFinished(child)) child.kill('SIGTERM');
    await waitForExit(child, 3_000).catch(() => {
      if (!childFinished(child)) child.kill('SIGKILL');
    });
    throw error;
  }
}

function sameOrderedStrings(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function canonicalRuntimeEvidenceValid(managedInventory, canonicalComponents, productControls) {
  const entries = Array.isArray(managedInventory?.entries) ? managedInventory.entries : [];
  const countState = (state) => entries.filter((entry) => entry?.inventoryState === state).length;
  const inventoryValid = managedInventory?.schemaVersion === 'i00-managed-inventory.v1'
    && managedInventory?.expectedIdentityCount === 33
    && managedInventory?.mappedIdentityCount === 14
    && managedInventory?.evidencePresentCount === 14
    && managedInventory?.ownerGatedCount === 13
    && managedInventory?.notConfiguredCount === 3
    && managedInventory?.missingCount === 3
    && managedInventory?.canonicalComponentCount === 14
    && managedInventory?.referencedCanonicalComponentCount === 14
    && managedInventory?.observedCanonicalComponentCount === 14
    && sameOrderedStrings(entries.map((entry) => entry?.identity), I00_MANAGED_COMPONENT_IDENTITIES)
    && entries.every((entry, index) => {
      const expected = I00_MANAGED_INVENTORY_EXPECTATIONS[index];
      const expectedEvidence = expected.canonicalComponentIds.length === 0 ? null : expected.canonicalComponentIds.map((componentId) => ({
        source: 'PRODUCT_RUNTIME_COMPONENT_PROJECTION',
        componentId,
        componentProjectionIndex: CANONICAL_SYSTEM_COMPONENT_IDS.indexOf(componentId),
      }));
      return entry?.identity === expected.identity
        && entry.owner === expected.owner
        && JSON.stringify(entry.canonicalComponentIds) === JSON.stringify(expected.canonicalComponentIds)
        && entry.inventoryState === expected.inventoryState
        && entry.reasonCode === expected.reasonCode
        && JSON.stringify(entry.evidence) === JSON.stringify(expectedEvidence);
    })
    && managedInventory.evidencePresentCount === countState('EVIDENCE_PRESENT')
    && managedInventory.ownerGatedCount === countState('OWNER_GATED')
    && managedInventory.notConfiguredCount === countState('NOT_CONFIGURED')
    && managedInventory.missingCount === countState('MISSING')
    && managedInventory.evidencePresentCount + managedInventory.ownerGatedCount
      + managedInventory.notConfiguredCount + managedInventory.missingCount === 33;
  const componentsValid = Array.isArray(canonicalComponents)
    && sameOrderedStrings(canonicalComponents.map((component) => component?.componentId), CANONICAL_SYSTEM_COMPONENT_IDS)
    && canonicalComponents.every((component, index) => (
      component?.owner === CANONICAL_SYSTEM_COMPONENT_OWNERS[index]
      && typeof component?.observedLifecycle === 'string' && component.observedLifecycle.length > 0
      && typeof component?.capability === 'string' && component.capability.length > 0
      && (component.blocker === null || (typeof component.blocker === 'string' && component.blocker.length > 0))
    ));
  const allowedOwnerBlockers = new Set([
    'COMMAND_OWNER_NOT_CONFIGURED', 'COMMAND_OWNER_ID_MISSING', 'SERVER_DERIVED_ACTOR_NOT_PROVEN',
    'DURABLE_IDEMPOTENCY_NOT_PROVEN', 'REVISION_CAS_NOT_PROVEN', 'DURABLE_RECEIPTS_NOT_PROVEN',
    'DURABLE_RESULT_READBACK_NOT_PROVEN', 'COMMAND_OWNER_CAPABILITY_INVALID',
    'BACKEND_COMMAND_NOT_SUPPORTED', 'MANAGED_ROOT_RESTART_NOT_PROVEN',
  ]);
  const controlsValid = Array.isArray(productControls)
    && sameOrderedStrings(productControls.map((control) => control?.controlId), PRODUCT_RUNTIME_CONTROL_IDS)
    && productControls.every((control, index) => {
      const expected = PRODUCT_RUNTIME_CONTROL_EXPECTATIONS[index];
      if (control?.backendCommandId !== expected.backendCommandId) return false;
      if (control.wiringState === 'WIRED_LIVE') {
        return control.owner === 'systemIntegration.canonical-control-service'
          && control.authority === 'SERVER_DERIVED_OPERATOR'
          && control.disabledReason === null;
      }
      const blocker = /^UNAVAILABLE:(.+)$/u.exec(control.wiringState ?? '')?.[1] ?? null;
      return blocker !== null
        && allowedOwnerBlockers.has(blocker)
        && control.owner === 'systemIntegration canonical control owner'
        && control.authority === 'NOT_CONFIGURED'
        && control.disabledReason === blocker;
    });
  return inventoryValid && componentsValid && controlsValid;
}

async function requestSnapshot(origin, label, testedSha) {
  const plans = [
    ['liveStatus', '/health/live'],
    ['readyStatus', '/health/ready'],
    ['tradeReadyStatus', '/health/trade-ready'],
    ['legacyHealthStatus', '/api/health'],
    ['stateStatus', '/api/state'],
    ['eventsCountStatus', '/api/events/count'],
    ['basisStatus', '/api/engine/basis'],
    ['volumeStatus', '/api/engine/volume'],
    ['productSupervisorStatus', '/api/product-integration/v1/supervisor'],
  ];
  const statuses = {};
  const bodies = {};
  await Promise.all(plans.map(async ([key, pathname]) => {
    try {
      const response = await fetch(`${origin}${pathname}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      statuses[key] = response.status;
      bodies[pathname] = await response.text();
    } catch {
      statuses[key] = 0;
      bodies[pathname] = 'UNAVAILABLE';
    }
  }));
  let eventCount = null;
  let stateNowMs = null;
  let basisLastBookTs = null;
  let basisLastMarkTs = null;
  let volumeLastBookTs = null;
  let volumeLastTradeTs = null;
  let volumeTradeMessages = null;
  let qComponentPresent = false;
  let qAdvisoryAction = null;
  let qTruthLabel = null;
  let qCapability = null;
  let qAuthority = null;
  let qCapitalRelevance = null;
  let qControlCount = null;
  let tradeReadyProjection = null;
  let productRevision = null;
  let runtimeGeneration = null;
  let controlGeneration = null;
  let testedCommitProjection = null;
  let deployedCommitProjection = null;
  let configRevisionProjection = null;
  let schemaRevisionProjection = null;
  let modelRevisionProjection = null;
  let deploymentFrozenProjection = null;
  let exposureStateProjection = null;
  let ambiguityStateProjection = null;
  let recoveryStateProjection = null;
  let opsInterlockState = null;
  let opsInterlockBlocksNewEntries = null;
  let opsExternalActionAuthorization = null;
  let reconciliationStatus = null;
  let reconciliationBlocksNewExposure = null;
  let reconciliationReasonCodes = null;
  let restartControlWiringState = null;
  let restartControlRevision = null;
  let managedInventory = null;
  let canonicalComponents = null;
  let productControls = null;
  try {
    const parsed = JSON.parse(bodies['/api/events/count']);
    if (Number.isSafeInteger(parsed.count) && parsed.count >= 0) eventCount = parsed.count;
  } catch {
    // Unknown remains null.
  }
  try {
    const parsed = JSON.parse(bodies['/api/product-integration/v1/supervisor']);
    const projectedQ = Array.isArray(parsed?.components) ? parsed.components.find((component) => component?.componentId === 'q-inference') : null;
    const dashboardQ = Array.isArray(parsed?.dashboard?.components) ? parsed.dashboard.components.find((component) => component?.componentId === 'q-inference') : null;
    qComponentPresent = projectedQ !== null && projectedQ !== undefined && dashboardQ !== null && dashboardQ !== undefined;
    qAdvisoryAction = typeof dashboardQ?.domainObservedState === 'string' && dashboardQ.domainObservedState.includes('ABSTAIN_UNKNOWN') ? 'ABSTAIN_UNKNOWN' : null;
    qTruthLabel = typeof projectedQ?.truthLabel === 'string' ? projectedQ.truthLabel : null;
    qCapability = typeof projectedQ?.capability === 'string' ? projectedQ.capability : null;
    qAuthority = typeof dashboardQ?.authority === 'string' ? dashboardQ.authority : null;
    qCapitalRelevance = typeof projectedQ?.capitalRelevance === 'string' ? projectedQ.capitalRelevance : null;
    qControlCount = Array.isArray(projectedQ?.supportedControlIds) ? projectedQ.supportedControlIds.length : null;
    tradeReadyProjection = typeof parsed?.ownerView?.tradeReady === 'string' ? parsed.ownerView.tradeReady : null;
    productRevision = typeof parsed?.revision === 'string' ? parsed.revision : null;
    runtimeGeneration = Number.isSafeInteger(parsed?.dashboard?.runtimeGeneration) ? parsed.dashboard.runtimeGeneration : null;
    controlGeneration = Number.isSafeInteger(parsed?.dashboard?.controlGeneration) ? parsed.dashboard.controlGeneration : null;
    testedCommitProjection = typeof parsed?.ownerView?.revisions?.testedCommit === 'string' ? parsed.ownerView.revisions.testedCommit : null;
    deployedCommitProjection = typeof parsed?.ownerView?.revisions?.deployedCommit === 'string' ? parsed.ownerView.revisions.deployedCommit : null;
    configRevisionProjection = typeof parsed?.ownerView?.revisions?.configRevision === 'string' ? parsed.ownerView.revisions.configRevision : null;
    schemaRevisionProjection = typeof parsed?.ownerView?.revisions?.schemaRevision === 'string' ? parsed.ownerView.revisions.schemaRevision : null;
    modelRevisionProjection = typeof parsed?.ownerView?.revisions?.modelRevision === 'string' ? parsed.ownerView.revisions.modelRevision : null;
    deploymentFrozenProjection = typeof parsed?.opsReadback?.deploymentFrozen === 'boolean' || parsed?.opsReadback?.deploymentFrozen === 'UNKNOWN'
      ? parsed.opsReadback.deploymentFrozen
      : null;
    exposureStateProjection = typeof parsed?.opsReadback?.exposureState === 'string' ? parsed.opsReadback.exposureState : null;
    ambiguityStateProjection = typeof parsed?.opsReadback?.ambiguityState === 'string' ? parsed.opsReadback.ambiguityState : null;
    recoveryStateProjection = typeof parsed?.opsReadback?.recoveryState === 'string' ? parsed.opsReadback.recoveryState : null;
    opsInterlockState = typeof parsed?.opsIntakeInterlock?.state === 'string' ? parsed.opsIntakeInterlock.state : null;
    opsInterlockBlocksNewEntries = typeof parsed?.opsIntakeInterlock?.blocksNewEntries === 'boolean'
      ? parsed.opsIntakeInterlock.blocksNewEntries
      : null;
    opsExternalActionAuthorization = typeof parsed?.opsIntakeInterlock?.externalActionAuthorization === 'string'
      ? parsed.opsIntakeInterlock.externalActionAuthorization
      : null;
    reconciliationStatus = typeof parsed?.dashboard?.summaries?.reconciliation?.status === 'string'
      ? parsed.dashboard.summaries.reconciliation.status
      : null;
    reconciliationBlocksNewExposure = typeof parsed?.dashboard?.summaries?.reconciliation?.blocksNewExposure === 'boolean'
      ? parsed.dashboard.summaries.reconciliation.blocksNewExposure
      : null;
    reconciliationReasonCodes = Array.isArray(parsed?.dashboard?.summaries?.reconciliation?.reasonCodes)
      && parsed.dashboard.summaries.reconciliation.reasonCodes.every((code) => typeof code === 'string')
      ? [...parsed.dashboard.summaries.reconciliation.reasonCodes]
      : null;
    const restartControl = Array.isArray(parsed?.controls)
      ? parsed.controls.find((control) => control?.controlId === CANONICAL_RESTART_CONTROL_ID)
      : null;
    restartControlWiringState = typeof restartControl?.wiringState === 'string'
      ? restartControl.wiringState
      : null;
    restartControlRevision = typeof restartControl?.currentStateRevision === 'string'
      ? restartControl.currentStateRevision
      : null;
    managedInventory = parsed?.managedInventory && typeof parsed.managedInventory === 'object' && !Array.isArray(parsed.managedInventory)
      ? parsed.managedInventory
      : null;
    canonicalComponents = Array.isArray(parsed?.components) ? parsed.components.map((component) => ({
      componentId: component?.componentId ?? null,
      owner: component?.owner ?? null,
      observedLifecycle: component?.observedLifecycle ?? null,
      capability: component?.capability ?? null,
      blocker: component?.blockerCode ?? null,
    })) : null;
    productControls = Array.isArray(parsed?.controls) ? parsed.controls.map((control) => ({
      controlId: control?.controlId ?? null,
      backendCommandId: control?.backendCommandId ?? null,
      wiringState: control?.wiringState ?? null,
      owner: control?.owner ?? null,
      authority: control?.authority ?? null,
      disabledReason: control?.disabledReason ?? null,
    })) : null;
  } catch {
    // Unknown remains null.
  }
  try {
    const parsed = JSON.parse(bodies['/api/state']);
    if (Number.isSafeInteger(parsed.now) && parsed.now >= 0) stateNowMs = parsed.now;
  } catch {
    // Unknown remains null.
  }
  try {
    const parsed = JSON.parse(bodies['/api/engine/basis']);
    if (Number.isSafeInteger(parsed?.status?.lastBookTs) && parsed.status.lastBookTs >= 0) basisLastBookTs = parsed.status.lastBookTs;
    if (Number.isSafeInteger(parsed?.status?.lastMarkTs) && parsed.status.lastMarkTs >= 0) basisLastMarkTs = parsed.status.lastMarkTs;
  } catch {
    // Unknown remains null.
  }
  try {
    const parsed = JSON.parse(bodies['/api/engine/volume']);
    if (Number.isSafeInteger(parsed?.status?.lastBookTs) && parsed.status.lastBookTs >= 0) volumeLastBookTs = parsed.status.lastBookTs;
    if (Number.isSafeInteger(parsed?.status?.lastTradeTs) && parsed.status.lastTradeTs >= 0) volumeLastTradeTs = parsed.status.lastTradeTs;
    if (Number.isSafeInteger(parsed?.status?.tradeMessages) && parsed.status.tradeMessages >= 0) volumeTradeMessages = parsed.status.tradeMessages;
  } catch {
    // Unknown remains null.
  }
  let healthSemanticsValid = true;
  for (const [pathname, statusKey] of [['/health/live', 'liveStatus'], ['/health/ready', 'readyStatus'], ['/health/trade-ready', 'tradeReadyStatus']]) {
    try {
      const parsed = JSON.parse(bodies[pathname]);
      if (typeof parsed.ok !== 'boolean' || parsed.ok !== (statuses[statusKey] === 200)) healthSemanticsValid = false;
    } catch {
      healthSemanticsValid = false;
    }
  }
  const healthClassification = (pathname, statusKey) => {
    try {
      const parsed = JSON.parse(bodies[pathname]);
      if (statuses[statusKey] === 200 && parsed.ok === true) return 'READY_200';
      if (statuses[statusKey] === 503 && parsed.ok === false) return 'HONEST_NOT_READY_503';
    } catch {
      // Invalid is returned below.
    }
    return 'INVALID';
  };
  const readyClassification = healthClassification('/health/ready', 'readyStatus');
  const tradeReadyClassification = healthClassification('/health/trade-ready', 'tradeReadyStatus');
  const qProjectionValid = qComponentPresent
    && qAdvisoryAction === 'ABSTAIN_UNKNOWN'
    && ['NOT_CONFIGURED', 'UNAVAILABLE'].includes(qTruthLabel)
    && ['NOT_CONFIGURED', 'UNAVAILABLE'].includes(qCapability)
    && qAuthority === 'UNAVAILABLE'
    && qCapitalRelevance === 'NONE'
    && qControlCount === 0
    && tradeReadyProjection === 'NO';
  const bootRevisionProjectionValid = productRevision !== null
    && Number.isSafeInteger(runtimeGeneration)
    && Number.isSafeInteger(controlGeneration)
    && testedCommitProjection === testedSha
    && deployedCommitProjection === null
    && typeof schemaRevisionProjection === 'string'
    && schemaRevisionProjection.length > 0
    && deploymentFrozenProjection === false;
  const opsProjectionValid = ['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(exposureStateProjection)
    && ['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(ambiguityStateProjection)
    && ['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(recoveryStateProjection)
    && ['OPS_INTERLOCK_CLEAR', 'OPS_INTERLOCK_BLOCKED'].includes(opsInterlockState)
    && opsInterlockBlocksNewEntries === (opsInterlockState === 'OPS_INTERLOCK_BLOCKED')
    && opsExternalActionAuthorization === 'NONE'
    && typeof reconciliationStatus === 'string'
    && reconciliationStatus.length > 0
    && typeof reconciliationBlocksNewExposure === 'boolean'
    && (
      exposureStateProjection === 'NONE'
        && ambiguityStateProjection === 'NONE'
        && recoveryStateProjection === 'NONE'
      || opsInterlockBlocksNewEntries === true
    );
  const canonicalRuntimeEvidenceValidNow = canonicalRuntimeEvidenceValid(
    managedInventory,
    canonicalComponents,
    productControls,
  );
  return Object.freeze({
    label,
    capturedAtUtc: new Date().toISOString(),
    ...statuses,
    readyClassification,
    tradeReadyClassification,
    healthSemanticsValid,
    stateNowMs,
    eventsCount: eventCount,
    basisLastBookTs,
    basisLastMarkTs,
    volumeLastBookTs,
    volumeLastTradeTs,
    volumeTradeMessages,
    productRevision,
    runtimeGeneration,
    controlGeneration,
    testedCommitProjection,
    deployedCommitProjection,
    configRevisionProjection,
    schemaRevisionProjection,
    modelRevisionProjection,
    deploymentFrozenProjection,
    exposureStateProjection,
    ambiguityStateProjection,
    recoveryStateProjection,
    opsInterlockState,
    opsInterlockBlocksNewEntries,
    opsExternalActionAuthorization,
    reconciliationStatus,
    reconciliationBlocksNewExposure,
    reconciliationReasonCodes,
    restartControlWiringState,
    restartControlRevision,
    managedInventory,
    canonicalComponents,
    productControls,
    canonicalRuntimeEvidenceValid: canonicalRuntimeEvidenceValidNow,
    opsProjectionValid,
    bootRevisionProjectionValid,
    qComponentPresent,
    qAdvisoryAction,
    qTruthLabel,
    qCapability,
    qAuthority,
    qCapitalRelevance,
    qControlCount,
    tradeReadyProjection,
    qProjectionValid,
    contentSha256: sha256(canonicalJson(bodies)),
  });
}

async function postJson(origin, pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* Invalid JSON remains null and fails closed below. */ }
  return Object.freeze({ status: response.status, body: parsed, bodySha256: sha256(text) });
}

function parsedControlState(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function restartBarrierEvidence(snapshot) {
  return Object.freeze({
    exposureState: snapshot.exposureStateProjection,
    ambiguityState: snapshot.ambiguityStateProjection,
    recoveryState: snapshot.recoveryStateProjection,
    opsInterlockState: snapshot.opsInterlockState,
    opsInterlockBlocksNewEntries: snapshot.opsInterlockBlocksNewEntries,
    reconciliationStatus: snapshot.reconciliationStatus,
    reconciliationBlocksNewExposure: snapshot.reconciliationBlocksNewExposure,
    reconciliationReasonCodes: snapshot.reconciliationReasonCodes,
    readyStatus: snapshot.readyStatus,
    tradeReadyStatus: snapshot.tradeReadyStatus,
  });
}

async function attemptCanonicalRestart(origin, before, testedSha) {
  if (before.restartControlWiringState !== 'WIRED_LIVE'
      || typeof before.restartControlRevision !== 'string'
      || !/^(?:0|[1-9][0-9]{0,15})$/.test(before.restartControlRevision)) {
    throw new Error('CANONICAL_RESTART_CONTROL_NOT_WIRED');
  }
  const previewResponse = await postJson(origin, '/api/product-integration/v1/commands/preview', {
    controlId: CANONICAL_RESTART_CONTROL_ID,
    expectedRevision: before.restartControlRevision,
  });
  const preview = previewResponse.body;
  if (previewResponse.status !== 200
      || preview?.controlId !== CANONICAL_RESTART_CONTROL_ID
      || preview?.expectedRevision !== before.restartControlRevision
      || typeof preview?.previewId !== 'string'
      || typeof preview?.digest !== 'string'
      || !Number.isSafeInteger(preview?.expiresAtMs)
      || preview?.synthetic !== false) {
    throw new Error('CANONICAL_RESTART_PREVIEW_INVALID');
  }
  const idempotencyKey = `i00.performance.restart.g1.${testedSha.slice(0, 12)}`;
  const request = Object.freeze({
    schemaVersion: 'product-command.v1',
    idempotencyKey,
    controlId: CANONICAL_RESTART_CONTROL_ID,
    backendCommandId: 'RESTART_COMPONENT',
    targetType: 'COMPONENT',
    targetId: 'engine-supervisor',
    payload: Object.freeze({ componentId: 'engine-supervisor' }),
    currentRevision: before.restartControlRevision,
    expectedRevision: before.restartControlRevision,
    previewId: preview.previewId,
    previewDigest: preview.digest,
    expiresAtMs: preview.expiresAtMs,
    reason: 'Bounded local performance proof of the canonical restart truth barrier',
  });
  const submitResponse = await postJson(origin, '/api/product-integration/v1/commands', request);
  const result = submitResponse.body;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('CANONICAL_RESTART_RESULT_INVALID');
  }
  const beforeState = parsedControlState(result.before);
  const afterState = parsedControlState(result.after);
  return Object.freeze({
    controlId: CANONICAL_RESTART_CONTROL_ID,
    authentication: 'SERVER_DERIVED_LOOPBACK',
    operatorPayloadSent: false,
    previewStatus: previewResponse.status,
    previewId: preview.previewId,
    previewDigest: preview.digest,
    previewSynthetic: preview.synthetic,
    submitStatus: submitResponse.status,
    idempotencyKey,
    resultStatus: typeof result.status === 'string' ? result.status : null,
    commandId: typeof result.commandId === 'string' ? result.commandId : null,
    correlationId: typeof result.correlationId === 'string' ? result.correlationId : null,
    receiptId: typeof result.receiptId === 'string' ? result.receiptId : null,
    resultSynthetic: result.synthetic === false ? false : result.synthetic === true ? true : null,
    resultBeforeSha256: typeof result.before === 'string' ? sha256(result.before) : null,
    resultAfterSha256: typeof result.after === 'string' ? sha256(result.after) : null,
    resultStateUnchanged: typeof result.before === 'string' && result.before === result.after,
    resultBeforeRevision: Number.isSafeInteger(beforeState?.revision) ? beforeState.revision : null,
    resultAfterRevision: Number.isSafeInteger(afterState?.revision) ? afterState.revision : null,
    resultBeforeGeneration: Number.isSafeInteger(beforeState?.generation) ? beforeState.generation : null,
    resultAfterGeneration: Number.isSafeInteger(afterState?.generation) ? afterState.generation : null,
    beforeBarrier: restartBarrierEvidence(before),
  });
}

function endpointAccumulator(plan) {
  return {
    plan,
    requests: 0,
    responses: 0,
    unexpected: 0,
    errors: 0,
    bytes: 0,
    statusCounts: {},
    latencies: [],
  };
}

async function driveHttp(origin, durationMs, targetRps, concurrency) {
  const endpoints = new Map(SAFE_HTTP_ENDPOINTS.map((plan) => [plan.path, endpointAccumulator(plan)]));
  const pending = new Set();
  const allLatencies = [];
  let scheduled = 0;
  let skippedForConcurrency = 0;
  let expectedResponses = 0;
  let unexpectedResponses = 0;
  let networkErrors = 0;
  let responseBytes = 0;
  let cursor = 0;
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  const intervalMs = 1_000 / targetRps;
  let nextAt = startedAt;

  const issue = async (state) => {
    state.requests += 1;
    const requestStarted = performance.now();
    try {
      const response = await fetch(`${origin}${state.plan.path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const body = await response.arrayBuffer();
      const latency = performance.now() - requestStarted;
      state.responses += 1;
      state.bytes += body.byteLength;
      responseBytes += body.byteLength;
      state.latencies.push(latency);
      allLatencies.push(latency);
      state.statusCounts[String(response.status)] = (state.statusCounts[String(response.status)] ?? 0) + 1;
      if (state.plan.expectedStatuses.includes(response.status)) expectedResponses += 1;
      else {
        state.unexpected += 1;
        unexpectedResponses += 1;
      }
    } catch {
      state.errors += 1;
      networkErrors += 1;
    }
  };

  while (performance.now() < deadline) {
    const waitMs = nextAt - performance.now();
    if (waitMs > 0) await delay(waitMs);
    nextAt += intervalMs;
    if (pending.size >= concurrency) {
      skippedForConcurrency += 1;
      continue;
    }
    const plan = SAFE_HTTP_ENDPOINTS[cursor % SAFE_HTTP_ENDPOINTS.length];
    cursor += 1;
    scheduled += 1;
    const work = issue(endpoints.get(plan.path));
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }
  await Promise.allSettled([...pending]);
  const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1_000);
  return {
    report: Object.freeze({
      scheduled,
      skippedForConcurrency,
      responses: expectedResponses + unexpectedResponses,
      expectedResponses,
      unexpectedResponses,
      networkErrors,
      responseBytes,
      throughputRps: Math.round(((expectedResponses + unexpectedResponses) / elapsedSeconds) * 1_000) / 1_000,
      responseBytesPerSecond: Math.round((responseBytes / elapsedSeconds) * 1_000) / 1_000,
      latencyMs: summarize(allLatencies),
      endpoints: [...endpoints.values()].map((state) => Object.freeze({
        path: state.plan.path,
        requests: state.requests,
        responses: state.responses,
        unexpected: state.unexpected,
        errors: state.errors,
        bytes: state.bytes,
        statusCounts: state.statusCounts,
        latencyMs: summarize(state.latencies),
      })),
    }),
    rawLatencies: allLatencies,
    elapsedSeconds,
  };
}

function openWebSocket(url, index, aggregate) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WS_OPEN_TIMEOUT:${index}`));
    }, REQUEST_TIMEOUT_MS);
    socket.once('open', () => {
      clearTimeout(timeout);
      aggregate.clientsOpened += 1;
      const state = { index, socket, closeCode: null, openAtShutdown: false };
      socket.on('message', (data) => {
        aggregate.messages += 1;
        aggregate.bytes += Buffer.byteLength(data);
        aggregate.maxClientBufferedAmountBytes = Math.max(aggregate.maxClientBufferedAmountBytes, socket.bufferedAmount);
        let type = 'UNPARSEABLE';
        try {
          const parsed = JSON.parse(data.toString());
          if (typeof parsed?.type === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(parsed.type)) type = parsed.type;
        } catch {
          // Count malformed input without retaining it.
        }
        aggregate.messageTypes[type] = (aggregate.messageTypes[type] ?? 0) + 1;
        if (type === 'book') aggregate.focusBookMessages += 1;
        if (type === 'btrades') aggregate.focusTradeMessages += 1;
      });
      socket.on('error', () => undefined);
      state.closed = new Promise((closed) => socket.once('close', (code) => {
        state.closeCode = code;
        aggregate.closeCodes[String(code)] = (aggregate.closeCodes[String(code)] ?? 0) + 1;
        if (code === 1012) aggregate.shutdownClose1012Count += 1;
        if (code === 1013) aggregate.observedClose1013 = true;
        closed(code);
      }));
      resolve(state);
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function openWebSockets(port, requested) {
  const aggregate = {
    clientsOpened: 0,
    openErrors: 0,
    messages: 0,
    bytes: 0,
    maxClientBufferedAmountBytes: 0,
    messageTypes: {},
    closeCodes: {},
    shutdownClose1012Count: 0,
    focusBookMessages: 0,
    focusTradeMessages: 0,
    observedClose1013: false,
  };
  const outcomes = await Promise.allSettled(Array.from({ length: requested }, (_, index) => openWebSocket(`ws://${HOST}:${port}/ws`, index, aggregate)));
  const clients = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') clients.push(outcome.value);
    else aggregate.openErrors += 1;
  }
  return { clients, aggregate };
}

async function exerciseWebSockets(clients, aggregate, durationMs, focusSymbol) {
  const normal = clients[0] ?? null;
  const slow = clients.length > 1 ? clients.at(-1) : null;
  let slowStartedAt = null;
  if (slow && typeof slow.socket.pause === 'function') {
    slow.socket.pause();
    slowStartedAt = performance.now();
  }
  let burstsAttempted = 0;
  const startedAt = performance.now();
  while (normal && performance.now() - startedAt < durationMs - 1_000 && normal.socket.readyState === WebSocket.OPEN) {
    normal.socket.send(JSON.stringify({ type: 'sub-book', symbol: focusSymbol }));
    burstsAttempted += 1;
    await delay(Math.min(3_000, Math.max(250, durationMs - (performance.now() - startedAt) - 500)));
    if (normal.socket.readyState === WebSocket.OPEN) normal.socket.send(JSON.stringify({ type: 'unsub-book' }));
    const remaining = durationMs - (performance.now() - startedAt);
    if (remaining <= 1_000) break;
    await delay(Math.min(7_000, remaining - 500));
  }
  if (slow && typeof slow.socket.resume === 'function') slow.socket.resume();
  const pauseDurationMs = slowStartedAt === null ? 0 : Math.max(0, Math.round(performance.now() - slowStartedAt));
  return { burstsAttempted, pauseDurationMs };
}

function fileSize(filename) {
  return statSync(filename, { throwIfNoEntry: false })?.size ?? 0;
}

function startStorageSampler(dataDir, intervalMs) {
  const samples = [];
  const sample = () => samples.push({
    monotonicMs: performance.now(),
    databaseBytes: fileSize(path.join(dataDir, 'cosmos.db')),
    walBytes: fileSize(path.join(dataDir, 'cosmos.db-wal')),
    shmBytes: fileSize(path.join(dataDir, 'cosmos.db-shm')),
  });
  sample();
  const timer = setInterval(sample, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      sample();
      return samples;
    },
  };
}

function growth(samples, key) {
  const values = samples.map((sample) => sample[key]);
  const initialBytes = values[0] ?? 0;
  const finalBytes = values.at(-1) ?? 0;
  return Object.freeze({ initialBytes, finalBytes, maxBytes: values.length === 0 ? 0 : Math.max(...values), growthBytes: finalBytes - initialBytes });
}

function inspectDatabase(dataDir, testedSha, expectation) {
  const filename = path.join(dataDir, 'cosmos.db');
  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = String(database.pragma('quick_check', { simple: true }));
    const integrityCheck = String(database.pragma('integrity_check', { simple: true }));
    const journalMode = String(database.pragma('journal_mode', { simple: true })).toLowerCase();
    const foreignKeyViolationCount = database.pragma('foreign_key_check').length;
    const userVersion = Number(database.pragma('user_version', { simple: true }));
    const eventCount = Number(database.prepare('SELECT COUNT(*) AS count FROM events').get().count);
    const bootRows = database.prepare(`
      SELECT operation_id, operation_type, generation, tested_commit, deployed_commit, config_revision, schema_revision,
             model_revision, started_at_ms, completed_at_ms, clean, blocker_code
      FROM product_boot_release_revisions
      ORDER BY generation DESC, started_at_ms DESC
    `).all();
    const latest = bootRows[0] ?? null;
    const allRowsClean = bootRows.length > 0 && bootRows.every((row) => row.clean === 1 && Number.isSafeInteger(row.completed_at_ms));
    const cleanCompletedRows = bootRows.filter((row) => row.clean === 1 && Number.isSafeInteger(row.completed_at_ms));
    const crashPendingRows = bootRows.filter((row) => row.clean === null && row.completed_at_ms === null);
    const crashPendingGenerations = crashPendingRows.map((row) => row.generation).toSorted((left, right) => left - right);
    const expectedCrashPendingGenerations = [...expectation.expectedCrashPendingGenerations].toSorted((left, right) => left - right);
    const latestLifecycleState = latest?.clean === 1 && Number.isSafeInteger(latest?.completed_at_ms)
      ? 'CLEAN_COMPLETED'
      : latest?.clean === null && latest?.completed_at_ms === null
        ? 'CRASH_PENDING'
        : 'INVALID';
    const allRowsIdentityValid = bootRows.length === expectation.expectedRowCount
      && bootRows.every((row) => (
        row.operation_id === `system.application.boot.g${row.generation}`
        && row.operation_type === 'APPLICATION_BOOT'
        && row.tested_commit === testedSha
        && row.deployed_commit === null
        && Number.isSafeInteger(row.generation)
        && row.generation >= 1
      ))
      && bootRows.map((row) => row.generation).toSorted((left, right) => left - right)
        .every((generation, index) => generation === index + 1);
    const lifecycleExpectationMet = latestLifecycleState === expectation.expectedLatestLifecycle
      && crashPendingGenerations.length === expectedCrashPendingGenerations.length
      && crashPendingGenerations.every((generation, index) => generation === expectedCrashPendingGenerations[index]);
    const bootRelease = Object.freeze({
      rowCount: bootRows.length,
      latestGeneration: Number.isSafeInteger(latest?.generation) ? latest.generation : null,
      latestTestedCommit: typeof latest?.tested_commit === 'string' ? latest.tested_commit : null,
      latestDeployedCommit: typeof latest?.deployed_commit === 'string' ? latest.deployed_commit : null,
      latestConfigRevision: typeof latest?.config_revision === 'string' ? latest.config_revision : null,
      latestSchemaRevision: typeof latest?.schema_revision === 'string' ? latest.schema_revision : null,
      latestModelRevision: typeof latest?.model_revision === 'string' ? latest.model_revision : null,
      latestStartedAtMs: Number.isSafeInteger(latest?.started_at_ms) ? latest.started_at_ms : null,
      latestCompletedAtMs: Number.isSafeInteger(latest?.completed_at_ms) ? latest.completed_at_ms : null,
      latestClean: latest?.clean === 1 ? true : latest?.clean === 0 ? false : null,
      latestBlockerCode: typeof latest?.blocker_code === 'string' ? latest.blocker_code : null,
      allRowsClean,
      cleanCompletedCount: cleanCompletedRows.length,
      crashPendingCount: crashPendingRows.length,
      crashPendingGenerations,
      allRowsIdentityValid,
      expectedLatestLifecycle: expectation.expectedLatestLifecycle,
      latestLifecycleState,
      expectedCrashPendingGenerations,
      lifecycleExpectationMet,
      passed: allRowsIdentityValid
        && lifecycleExpectationMet
        && latest?.generation === expectation.expectedRowCount,
    });
    const checkpointRow = database.prepare('SELECT value FROM config WHERE key = ?').get(SYSTEM_CHECKPOINT_CONFIG_KEY);
    let checkpoint = null;
    try { checkpoint = JSON.parse(checkpointRow?.value)?.state ?? null; } catch { /* Malformed checkpoint fails closed below. */ }
    const idempotencyKey = expectation.restartIdempotencyKey;
    const matchingReceipt = idempotencyKey === null || !Array.isArray(checkpoint?.idempotencyReceipts)
      ? null
      : checkpoint.idempotencyReceipts.find((row) => row?.idempotencyKey === idempotencyKey) ?? null;
    const matchingRejection = idempotencyKey === null || !Array.isArray(checkpoint?.controlRejections)
      ? null
      : checkpoint.controlRejections.find((row) => row?.idempotencyKey === idempotencyKey) ?? null;
    const controlCommand = Object.freeze({
      idempotencyKey,
      durableReceiptObserved: matchingReceipt !== null,
      durableRejectionAuditObserved: matchingRejection !== null,
      rejectionCode: typeof matchingRejection?.code === 'string' ? matchingRejection.code : null,
      rejectionActorSource: typeof matchingRejection?.actorSource === 'string' ? matchingRejection.actorSource : null,
      checkpointControlRevision: Number.isSafeInteger(checkpoint?.control?.revision) ? checkpoint.control.revision : null,
      checkpointControlGeneration: Number.isSafeInteger(checkpoint?.control?.generation) ? checkpoint.control.generation : null,
      passed: idempotencyKey === null || (
        matchingReceipt === null
        && matchingRejection?.code === 'RESTART_EXPOSURE_NONE_NOT_PROVEN'
        && matchingRejection?.actorSource === 'loopback'
      ),
    });
    return Object.freeze({
      quickCheck,
      integrityCheck,
      journalMode,
      foreignKeyViolationCount,
      userVersion,
      eventCount,
      bootRelease,
      controlCommand,
      passed: quickCheck === 'ok'
        && integrityCheck === 'ok'
        && journalMode === 'wal'
        && foreignKeyViolationCount === 0
        && Number.isSafeInteger(userVersion)
        && userVersion >= 0
        && Number.isSafeInteger(eventCount)
        && eventCount >= 0
        && bootRelease.passed
        && controlCommand.passed,
    });
  } finally {
    database.close();
  }
}

function parseTelemetry(text) {
  const samples = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try {
      const value = JSON.parse(line);
      if (value?.schemaVersion !== 'i00.app-process-probe.v1') malformed += 1;
      else samples.push(value);
    } catch {
      malformed += 1;
    }
  }
  return { samples, malformed };
}

function processReport(samples) {
  let rssSlopeBytesPerHour = null;
  if (samples.length >= 2) {
    const elapsedMs = samples.at(-1).monotonicMs - samples[0].monotonicMs;
    if (elapsedMs > 0) rssSlopeBytesPerHour = ((samples.at(-1).rssBytes - samples[0].rssBytes) / elapsedMs) * 3_600_000;
  }
  return Object.freeze({
    samples: samples.length,
    cpuOneCorePercent: summarize(samples.map((sample) => sample.cpuOneCorePercent)),
    cpuHostPercent: summarize(samples.map((sample) => sample.cpuHostPercent)),
    rssBytes: summarize(samples.map((sample) => sample.rssBytes), 0),
    heapUsedBytes: summarize(samples.map((sample) => sample.heapUsedBytes), 0),
    eventLoopP95Ms: summarize(samples.map((sample) => sample.eventLoopP95Ms)),
    eventLoopP99Ms: summarize(samples.map((sample) => sample.eventLoopP99Ms)),
    eventLoopMaxMs: summarize(samples.map((sample) => sample.eventLoopMaxMs)),
    rssSlopeBytesPerHour: rssSlopeBytesPerHour === null ? null : Math.round(rssSlopeBytesPerHour * 1_000) / 1_000,
  });
}

async function terminateBuiltApp(runtime, requestedSignal) {
  const startedAt = performance.now();
  if (!['SIGTERM', 'SIGKILL'].includes(requestedSignal)) throw new Error('TERMINATION_SIGNAL_INVALID');
  if (!childFinished(runtime.child)) runtime.child.kill(requestedSignal);
  let forced = false;
  let exit;
  try {
    exit = await waitForExit(runtime.child, requestedSignal === 'SIGTERM' ? 12_000 : 3_000);
  } catch {
    if (requestedSignal === 'SIGKILL') throw new Error('SIGKILL_EXIT_NOT_OBSERVED');
    forced = true;
    if (!childFinished(runtime.child)) runtime.child.kill('SIGKILL');
    exit = await waitForExit(runtime.child, 3_000).catch(() => ({ code: runtime.child.exitCode, signal: runtime.child.signalCode }));
  }
  await delay(25);
  const stdoutText = runtime.stdout.content();
  const stderrText = runtime.stderr.content();
  const telemetryText = runtime.telemetry.content();
  return {
    exit,
    requestedSignal,
    forced,
    durationMs: performance.now() - startedAt,
    stdoutText,
    stderrText,
    telemetryText,
    stdoutSha256: runtime.stdout.digest(),
    stderrSha256: runtime.stderr.digest(),
    telemetrySha256: runtime.telemetry.digest(),
    logOverflow: runtime.stdout.overflow() || runtime.stderr.overflow() || runtime.telemetry.overflow(),
  };
}

function stopBuiltApp(runtime) {
  return terminateBuiltApp(runtime, 'SIGTERM');
}

function crashBuiltApp(runtime) {
  return terminateBuiltApp(runtime, 'SIGKILL');
}

function exactKeylessRestartBarrier(evidence) {
  return evidence?.exposureState === 'UNKNOWN'
    && evidence?.ambiguityState === 'UNKNOWN'
    && evidence?.recoveryState === 'UNKNOWN'
    && evidence?.opsInterlockState === 'OPS_INTERLOCK_BLOCKED'
    && evidence?.opsInterlockBlocksNewEntries === true
    && evidence?.reconciliationStatus === 'UNAVAILABLE'
    && evidence?.reconciliationBlocksNewExposure === true
    && Array.isArray(evidence?.reconciliationReasonCodes)
    && evidence.reconciliationReasonCodes.includes('RECONCILIATION_TRUTH_UNAVAILABLE')
    && evidence?.readyStatus === 503
    && evidence?.tradeReadyStatus === 503;
}

async function runPhase({
  phaseId,
  generation,
  dataDir,
  durationMs,
  options,
  terminationSignal,
  databaseExpectation,
  canonicalRestartAttempt = false,
}) {
  const port = await availablePort();
  const origin = `http://${HOST}:${port}`;
  const startedAtUtc = new Date().toISOString();
  const preLaunchFiles = Object.freeze({
    databaseBytes: fileSize(path.join(dataDir, 'cosmos.db')),
    walBytes: fileSize(path.join(dataDir, 'cosmos.db-wal')),
    shmBytes: fileSize(path.join(dataDir, 'cosmos.db-shm')),
  });
  const runtime = await startBuiltApp(dataDir, port, options.sampleIntervalMs, options.testedSha);
  const storageSampler = startStorageSampler(dataDir, options.sampleIntervalMs);
  let websocket = null;
  try {
    const snapshots = [await requestSnapshot(origin, 'START', options.testedSha)];
    websocket = await openWebSockets(port, options.wsClients);
    const loadStarted = performance.now();
    const [http, wsExercise] = await Promise.all([
      driveHttp(origin, durationMs, options.httpRps, options.httpConcurrency),
      exerciseWebSockets(websocket.clients, websocket.aggregate, durationMs, options.focusSymbol),
    ]);
    const restartAttempt = canonicalRestartAttempt
      ? await attemptCanonicalRestart(origin, snapshots[0], options.testedSha)
      : null;
    snapshots.push(await requestSnapshot(origin, 'END', options.testedSha));
    const measuredDurationSeconds = (performance.now() - loadStarted) / 1_000;
    for (const state of websocket.clients) state.openAtShutdown = state.socket.readyState === WebSocket.OPEN;
    const stopped = terminationSignal === 'SIGKILL'
      ? await crashBuiltApp(runtime)
      : await stopBuiltApp(runtime);
    await Promise.allSettled(websocket.clients.map((state) => state.closed));
    const storageSamples = storageSampler.stop();
    const integrity = terminationSignal === 'SIGTERM'
      ? inspectDatabase(dataDir, options.testedSha, databaseExpectation)
      : null;
    const parsedTelemetry = parseTelemetry(stopped.telemetryText);
    const process = processReport(parsedTelemetry.samples);
    const cleanLogMarkerObserved = stopped.stdoutText.includes('control-room shutdown complete');
    const shutdownPassed = terminationSignal === 'SIGTERM'
      ? !stopped.forced && stopped.exit.code === 0 && stopped.exit.signal === null && cleanLogMarkerObserved
      : !stopped.forced && stopped.exit.code === null && stopped.exit.signal === 'SIGKILL' && !cleanLogMarkerObserved;
    const shutdown = Object.freeze({
      mode: terminationSignal === 'SIGTERM' ? 'GRACEFUL' : 'UNCLEAN_CRASH',
      signal: terminationSignal,
      exitCode: stopped.exit.code,
      exitSignal: stopped.exit.signal,
      durationMs: Math.round(stopped.durationMs * 1_000) / 1_000,
      cleanLogMarkerObserved,
      stdoutSha256: stopped.stdoutSha256,
      stderrSha256: stopped.stderrSha256,
      telemetrySha256: stopped.telemetrySha256,
      logOverflow: stopped.logOverflow,
      passed: shutdownPassed,
    });
    const focusObserved = websocket.aggregate.focusBookMessages + websocket.aggregate.focusTradeMessages > 0;
    const slowAttempted = websocket.clients.length > 1 && wsExercise.pauseDurationMs > 0;
    const websocketReport = Object.freeze({
      clientsRequested: options.wsClients,
      clientsOpened: websocket.aggregate.clientsOpened,
      openErrors: websocket.aggregate.openErrors,
      messages: websocket.aggregate.messages,
      bytes: websocket.aggregate.bytes,
      maxClientBufferedAmountBytes: websocket.aggregate.maxClientBufferedAmountBytes,
      messageTypes: websocket.aggregate.messageTypes,
      closeCodes: websocket.aggregate.closeCodes,
      shutdownClose1012Count: websocket.aggregate.shutdownClose1012Count,
      uncleanClose1006Count: websocket.aggregate.closeCodes['1006'] ?? 0,
      focus: Object.freeze({
        symbol: options.focusSymbol,
        burstsAttempted: wsExercise.burstsAttempted,
        bookMessages: websocket.aggregate.focusBookMessages,
        tradeMessages: websocket.aggregate.focusTradeMessages,
        status: focusObserved ? 'MEASURED' : websocket.clients.length > 0 ? 'NOT_OBSERVED' : 'UNAVAILABLE',
        reason: focusObserved
          ? 'Public-compatible focused book/trade messages were observed during bounded subscribe/unsubscribe bursts.'
          : websocket.clients.length > 0
            ? 'Bounded focus bursts were sent, but no canonical focused book/trade message arrived in this window.'
            : 'No local WebSocket client opened, so focus behavior was unavailable.',
      }),
      slowConsumer: Object.freeze({
        attempted: slowAttempted,
        pauseDurationMs: wsExercise.pauseDurationMs,
        observedClose1013: websocket.aggregate.observedClose1013,
        status: websocket.aggregate.observedClose1013 ? 'MEASURED' : slowAttempted ? 'NOT_OBSERVED' : 'UNAVAILABLE',
        reason: websocket.aggregate.observedClose1013
          ? 'The server emitted the documented 1013 slow-consumer signal.'
          : slowAttempted
            ? 'A bounded client read pause was exercised without reaching the server buffer threshold; no backpressure close is claimed.'
            : 'A second client was unavailable, so a bounded slow-consumer pause was not exercised.',
      }),
    });
    const phase = Object.freeze({
      phaseId,
      bootGeneration: generation,
      startedAtUtc,
      endedAtUtc: new Date().toISOString(),
      durationSeconds: Math.round(measuredDurationSeconds * 1_000) / 1_000,
      snapshots,
      http: http.report,
      websocket: websocketReport,
      process,
      storage: Object.freeze({
        preLaunch: preLaunchFiles,
        samples: storageSamples.length,
        database: growth(storageSamples, 'databaseBytes'),
        wal: growth(storageSamples, 'walBytes'),
        shm: growth(storageSamples, 'shmBytes'),
        integrity,
      }),
      shutdown,
    });
    const shutdownSockets = websocket.clients.filter((state) => state.openAtShutdown);
    const allShutdownSocketsReceived1012 = terminationSignal === 'SIGTERM'
      && shutdownSockets.length > 0
      && shutdownSockets.every((state) => state.closeCode === 1012);
    const allCrashSocketsClosedAbnormally = terminationSignal === 'SIGKILL'
      && shutdownSockets.length > 0
      && shutdownSockets.every((state) => state.closeCode === 1006);
    const afterSnapshot = snapshots[1];
    const canonicalRestart = restartAttempt === null ? null : Object.freeze({
      ...restartAttempt,
      afterBarrier: restartBarrierEvidence(afterSnapshot),
      disposition: 'OWNER_GATED',
      managedRestartAcceptance: 'NOT_PROVEN',
      durableReceiptObserved: integrity?.controlCommand?.durableReceiptObserved ?? null,
      durableRejectionAuditObserved: integrity?.controlCommand?.durableRejectionAuditObserved ?? null,
      rejectionCode: integrity?.controlCommand?.rejectionCode ?? null,
      controlGenerationAdvanced: afterSnapshot.controlGeneration !== snapshots[0].controlGeneration,
      runtimeGenerationAdvanced: afterSnapshot.runtimeGeneration !== snapshots[0].runtimeGeneration,
      effectGenerationAdvanced: restartAttempt.resultAfterGeneration !== restartAttempt.resultBeforeGeneration,
      webSocketClose1012Observed: allShutdownSocketsReceived1012,
      barrierPreserved: exactKeylessRestartBarrier(restartAttempt.beforeBarrier)
        && exactKeylessRestartBarrier(restartBarrierEvidence(afterSnapshot)),
      passed: restartAttempt.previewStatus === 200
        && restartAttempt.previewSynthetic === false
        && restartAttempt.submitStatus === 200
        && restartAttempt.resultStatus === 'REJECTED_STATE'
        && restartAttempt.receiptId === null
        && restartAttempt.resultSynthetic === false
        && restartAttempt.resultStateUnchanged
        && restartAttempt.resultAfterRevision === restartAttempt.resultBeforeRevision
        && restartAttempt.resultAfterGeneration === restartAttempt.resultBeforeGeneration
        && afterSnapshot.restartControlRevision === snapshots[0].restartControlRevision
        && afterSnapshot.controlGeneration === snapshots[0].controlGeneration
        && afterSnapshot.runtimeGeneration === snapshots[0].runtimeGeneration
        && integrity?.controlCommand?.durableReceiptObserved === false
        && integrity?.controlCommand?.durableRejectionAuditObserved === true
        && integrity?.controlCommand?.rejectionCode === 'RESTART_EXPOSURE_NONE_NOT_PROVEN'
        && exactKeylessRestartBarrier(restartAttempt.beforeBarrier)
        && exactKeylessRestartBarrier(restartBarrierEvidence(afterSnapshot))
        && allShutdownSocketsReceived1012,
    });
    const findings = [
      ...scanSecretText(stopped.stdoutText).map((finding) => ({ artifact: `${phaseId}.stdout`, ...finding })),
      ...scanSecretText(stopped.stderrText).map((finding) => ({ artifact: `${phaseId}.stderr`, ...finding })),
      ...scanSecretText(stopped.telemetryText).map((finding) => ({ artifact: `${phaseId}.telemetry`, ...finding })),
    ];
    const invariants = [];
    if (parsedTelemetry.malformed > 0) invariants.push(`${phaseId}_TELEMETRY_MALFORMED_${parsedTelemetry.malformed}`);
    if (process.samples === 0) invariants.push(`${phaseId}_TELEMETRY_MISSING`);
    if (http.report.scheduled === 0) invariants.push(`${phaseId}_HTTP_LOAD_MISSING`);
    if (websocketReport.clientsOpened !== options.wsClients) invariants.push(`${phaseId}_WS_CLIENT_OPEN_FAILURE`);
    if (terminationSignal === 'SIGTERM' && !integrity?.passed) invariants.push(`${phaseId}_SQLITE_INTEGRITY_FAILED`);
    if (!shutdown.passed) invariants.push(`${phaseId}_TERMINATION_PROOF_FAILED`);
    if (terminationSignal === 'SIGTERM' && !allShutdownSocketsReceived1012) invariants.push(`${phaseId}_WS_1012_NOT_PROVEN`);
    if (terminationSignal === 'SIGKILL' && !allCrashSocketsClosedAbnormally) invariants.push(`${phaseId}_WS_ABNORMAL_CLOSE_NOT_PROVEN`);
    if (canonicalRestartAttempt && !canonicalRestart?.passed) invariants.push(`${phaseId}_CANONICAL_RESTART_BARRIER_PROOF_FAILED`);
    if (shutdown.logOverflow) invariants.push(`${phaseId}_LOG_CAPTURE_OVERFLOW`);
    if (snapshots.some((snapshot) => snapshot.liveStatus !== 200 || !snapshot.healthSemanticsValid)) invariants.push(`${phaseId}_HEALTH_SEMANTICS_INVALID`);
    if (snapshots.some((snapshot) => snapshot.readyClassification !== 'HONEST_NOT_READY_503')) invariants.push(`${phaseId}_READINESS_NOT_HONEST_503`);
    if (snapshots.some((snapshot) => snapshot.tradeReadyClassification !== 'HONEST_NOT_READY_503')) invariants.push(`${phaseId}_TRADE_READY_NOT_HONEST_503`);
    if (snapshots.some((snapshot) => !snapshot.qProjectionValid)) invariants.push(`${phaseId}_Q_ABSTENTION_PROJECTION_INVALID`);
    if (snapshots.some((snapshot) => !snapshot.bootRevisionProjectionValid)) invariants.push(`${phaseId}_BOOT_RELEASE_PROJECTION_INVALID`);
    if (snapshots.some((snapshot) => !snapshot.opsProjectionValid)) invariants.push(`${phaseId}_OPS_RECONCILIATION_INTERLOCK_INVALID`);
    if (snapshots.some((snapshot) => !snapshot.canonicalRuntimeEvidenceValid)) invariants.push(`${phaseId}_CANONICAL_RUNTIME_INVENTORY_INVALID`);
    if (snapshots.some((snapshot) => snapshot.restartControlWiringState !== 'WIRED_LIVE' || snapshot.restartControlRevision === null)) invariants.push(`${phaseId}_RESTART_CONTROL_PROJECTION_INVALID`);
    if (snapshots.some((snapshot) => snapshot.stateStatus !== 200 || snapshot.basisStatus !== 200 || snapshot.volumeStatus !== 200 || snapshot.productSupervisorStatus !== 200)) invariants.push(`${phaseId}_CANONICAL_READ_ENDPOINT_FAILED`);
    const [startSnapshot, endSnapshot] = snapshots;
    for (const [field, code] of [
      ['stateNowMs', 'STATE_CLOCK'],
      ['basisLastBookTs', 'SPOT_BASIS_BOOK'],
      ['basisLastMarkTs', 'USDM_BASIS_MARK'],
      ['volumeLastBookTs', 'SPOT_VOLUME_BOOK'],
      ['volumeLastTradeTs', 'SPOT_VOLUME_TRADE'],
      ['volumeTradeMessages', 'SPOT_VOLUME_MESSAGE_COUNT'],
    ]) {
      if (!Number.isSafeInteger(startSnapshot[field]) || !Number.isSafeInteger(endSnapshot[field]) || endSnapshot[field] <= startSnapshot[field]) {
        invariants.push(`${phaseId}_${code}_NOT_ADVANCING`);
      }
    }
    return {
      phase,
      rawHttpLatencies: http.rawLatencies,
      rawTelemetry: parsedTelemetry.samples,
      measuredDurationSeconds,
      allShutdownSocketsReceived1012,
      allCrashSocketsClosedAbnormally,
      canonicalRestart,
      findings,
      invariants,
    };
  } catch (error) {
    try { storageSampler.stop(); } catch { /* Best-effort cleanup after a failed measurement. */ }
    for (const state of websocket?.clients ?? []) {
      try { state.socket.terminate(); } catch { /* Best-effort cleanup after a failed measurement. */ }
    }
    if (!childFinished(runtime.child)) await stopBuiltApp(runtime).catch(() => undefined);
    throw error;
  }
}

function hostFingerprint() {
  const cpus = os.cpus();
  const host = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model ?? 'UNKNOWN',
    logicalCpuCount: Math.max(1, cpus.length),
    totalMemoryBytes: os.totalmem(),
  };
  return Object.freeze({ fingerprintSha256: sha256(canonicalJson(host)), ...host });
}

function buildSlo(phases, raw, continuity, secretScanPassed) {
  const telemetry = raw.flatMap((entry) => entry.rawTelemetry);
  const httpLatencies = raw.flatMap((entry) => entry.rawHttpLatencies);
  const scheduled = phases.reduce((sum, phase) => sum + phase.http.scheduled, 0);
  const unexpected = phases.reduce((sum, phase) => sum + phase.http.unexpectedResponses + phase.http.networkErrors, 0);
  const measuredSeconds = phases.reduce((sum, phase) => sum + phase.durationSeconds, 0);
  const responseBytes = phases.reduce((sum, phase) => sum + phase.http.responseBytes, 0);
  const rssSlopes = phases.map((phase) => phase.process.rssSlopeBytesPerHour).filter(Number.isFinite);
  const checks = [
    evaluateBound('host.cpu.percent.p95', summarize(telemetry.map((sample) => sample.cpuHostPercent)).p95, LOCAL_PROXY_SLOS.cpuHostPercent),
    evaluateBound('node.event_loop_lag_ms.p99', summarize(telemetry.map((sample) => sample.eventLoopP99Ms)).p99, LOCAL_PROXY_SLOS.eventLoopLagMs),
    evaluateBound('process.rss_bytes.max', summarize(telemetry.map((sample) => sample.rssBytes)).max, LOCAL_PROXY_SLOS.rssBytes),
    evaluateBound('soak.rss_slope_bytes_per_hour.max', rssSlopes.length === 0 ? null : Math.max(...rssSlopes), LOCAL_PROXY_SLOS.rssSlopeBytesPerHour),
    evaluateBound('storage.wal_bytes.max', Math.max(...phases.map((phase) => phase.storage.wal.maxBytes)), LOCAL_PROXY_SLOS.walBytes),
    evaluateBound('api.http_latency_ms.p95', summarize(httpLatencies).p95, LOCAL_PROXY_SLOS.httpP95Ms),
    evaluateBound('api.unexpected_percent', scheduled === 0 ? null : (unexpected / scheduled) * 100, LOCAL_PROXY_SLOS.httpUnexpectedPercent),
    evaluateBound('api.response_bytes_per_second', measuredSeconds <= 0 ? null : responseBytes / measuredSeconds, LOCAL_PROXY_SLOS.apiBytesPerSecond),
  ];
  const invariantFailures = raw.flatMap((entry) => entry.invariants);
  if (!continuity.passed) invariantFailures.push(...continuity.reasonCodes);
  if (!secretScanPassed) invariantFailures.push('SECRET_SCAN_FAILED');
  const overall = aggregateSloStatus(checks, invariantFailures);
  const canonicalNonGreen = phases.every((phase) => phase.snapshots.every((snapshot) => (
    snapshot.readyClassification === 'HONEST_NOT_READY_503'
      && snapshot.tradeReadyClassification === 'HONEST_NOT_READY_503'
  )));
  const degradationVisibility = canonicalNonGreen
    ? 'CANONICAL_NON_GREEN_VISIBLE'
    : overall === 'PASS'
      ? 'NO_CAPACITY_BREACH'
      : 'FALSE_GREEN_BLOCKED';
  return Object.freeze({
    scope: 'LOCAL_PROXY_INITIAL_GATES',
    checks,
    invariantFailures: [...new Set(invariantFailures)].toSorted(),
    overall,
    degradationVisibility,
    productionClaim: 'UNKNOWN',
  });
}

export async function runLocalProxySoak(options) {
  assertLoopbackHost(HOST);
  const protectedOwnerDirectives = assertSourceBoundToHead();
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const createdAt = new Date();
  const source = {
    branch: git(['branch', '--show-current']),
    headSha: git(['rev-parse', 'HEAD']),
    treeSha: git(['rev-parse', 'HEAD^{tree}']),
    worktreeState: 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE',
    protectedOwnerDirectives,
    serverBundleSha256: fileSha256(SERVER_BUNDLE),
    harnessTreeSha256: harnessTreeSha256(),
  };
  if (options.testedSha !== null && options.testedSha !== source.headSha) throw new Error('TESTED_SHA_DOES_NOT_EQUAL_SOURCE_HEAD');
  if (source.branch !== 'i00-product-assembly-20260713') throw new Error(`INTEGRATION_BRANCH_REQUIRED:${source.branch}`);
  const runId = `${createdAt.toISOString().replace(/[^0-9]/g, '').slice(0, 17)}-${process.pid}-${source.headSha.slice(0, 8)}`;
  const requestedOutput = options.output ?? `local-proxy-performance-${runId}.json`;
  const boundaryCore = {
    bindHost: HOST,
    transport: 'LOOPBACK_HTTP_WS',
    reverseProxy: 'NONE',
    forwardedHeaders: 'ABSENT',
    childEnvironment: 'ALLOWLIST_ONLY',
    keyMode: 'KEYLESS',
    publicSourcePolicy: 'RUNTIME_OWNED_PUBLIC_ONLY',
  };
  const boundary = Object.freeze({
    proxyClass: 'DOCUMENTED_LOCAL_PROXY',
    fingerprintSha256: sha256(canonicalJson(boundaryCore)),
    ...boundaryCore,
    forbiddenActions: Object.freeze([
      'PRIVATE_READS', 'SIGNED_CALLS', 'LIVE_ORDERS', 'TEST_ORDERS', 'BORROW_REPAY',
      'TRANSFER_WITHDRAWAL', 'AWS_CLOUDFLARE_MUTATION', 'DEPLOYMENT', 'PUSH',
    ]),
  });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'i00-local-proxy-'));
  const totalDurationMs = options.durationSeconds * 1_000;
  const firstPhaseDurationMs = Math.floor(totalDurationMs / 3);
  const secondPhaseDurationMs = Math.floor(totalDurationMs / 3);
  const thirdPhaseDurationMs = totalDurationMs - firstPhaseDurationMs - secondPhaseDurationMs;
  const restartIdempotencyKey = `i00.performance.restart.g1.${source.headSha.slice(0, 12)}`;
  let raw = [];
  try {
    raw = [
      await runPhase({
        phaseId: 'CANONICAL_RESTART_GATE',
        generation: 1,
        dataDir,
        durationMs: firstPhaseDurationMs,
        options: { ...options, testedSha: source.headSha },
        terminationSignal: 'SIGTERM',
        canonicalRestartAttempt: true,
        databaseExpectation: {
          expectedRowCount: 1,
          expectedLatestLifecycle: 'CLEAN_COMPLETED',
          expectedCrashPendingGenerations: [],
          restartIdempotencyKey,
        },
      }),
      await runPhase({
        phaseId: 'UNCLEAN_TERMINATION',
        generation: 2,
        dataDir,
        durationMs: secondPhaseDurationMs,
        options: { ...options, testedSha: source.headSha },
        terminationSignal: 'SIGKILL',
        databaseExpectation: null,
      }),
      await runPhase({
        phaseId: 'POST_CRASH_RECOVERY',
        generation: 3,
        dataDir,
        durationMs: thirdPhaseDurationMs,
        options: { ...options, testedSha: source.headSha },
        terminationSignal: 'SIGTERM',
        databaseExpectation: {
          expectedRowCount: 3,
          expectedLatestLifecycle: 'CLEAN_COMPLETED',
          expectedCrashPendingGenerations: [2],
          restartIdempotencyKey,
        },
      }),
    ];
    const phases = raw.map((entry) => entry.phase);
    const canonicalRestart = raw[0].canonicalRestart;
    const firstCleanEventCount = phases[0].storage.integrity.eventCount;
    const recoveredEventCount = phases[2].storage.integrity.eventCount;
    const gracefulPhases = [raw[0], raw[2]];
    const allSnapshots = phases.flatMap((phase) => phase.snapshots);
    const recoveryBootRelease = phases[2].storage.integrity.bootRelease;
    const uncleanRecovery = Object.freeze({
      terminationSignal: phases[1].shutdown.signal,
      uncleanBootGeneration: phases[1].bootGeneration,
      recoveryBootGeneration: phases[2].bootGeneration,
      walBytesAfterSigkill: phases[1].storage.wal.finalBytes,
      shmBytesAfterSigkill: phases[1].storage.shm.finalBytes,
      walBytesBeforeRecoveryLaunch: phases[2].storage.preLaunch.walBytes,
      shmBytesBeforeRecoveryLaunch: phases[2].storage.preLaunch.shmBytes,
      databaseOpenedByHarnessBetweenCrashAndRecovery: false,
      applicationRuntimeFirstRecoveryOpen: true,
      crashPendingGeneration: 2,
      crashPendingBootPreserved: recoveryBootRelease.crashPendingGenerations.includes(2),
      recoveryLatestLifecycleState: recoveryBootRelease.latestLifecycleState,
      recoveryWalRemovedOnCleanClose: phases[2].storage.wal.finalBytes === 0
        && phases[2].storage.shm.finalBytes === 0,
      readinessHonestAfterRecovery: phases[2].snapshots.every((snapshot) => (
        snapshot.readyClassification === 'HONEST_NOT_READY_503'
        && snapshot.tradeReadyClassification === 'HONEST_NOT_READY_503'
      )),
      reconciliationStillBlocksAfterRecovery: phases[2].snapshots.every((snapshot) => exactKeylessRestartBarrier(restartBarrierEvidence(snapshot))),
      testedShaPreserved: recoveryBootRelease.allRowsIdentityValid,
      deployedShaAbsent: recoveryBootRelease.latestDeployedCommit === null,
      quickCheck: phases[2].storage.integrity.quickCheck,
      integrityCheck: phases[2].storage.integrity.integrityCheck,
      passed: phases[1].shutdown.passed
        && raw[1].allCrashSocketsClosedAbnormally
        && phases[1].storage.wal.finalBytes > 0
        && phases[2].storage.preLaunch.walBytes === phases[1].storage.wal.finalBytes
        && phases[2].storage.preLaunch.walBytes > 0
        && recoveryBootRelease.crashPendingGenerations.includes(2)
        && recoveryBootRelease.latestLifecycleState === 'CLEAN_COMPLETED'
        && phases[2].storage.wal.finalBytes === 0
        && phases[2].storage.shm.finalBytes === 0
        && phases[2].storage.integrity.quickCheck === 'ok'
        && phases[2].storage.integrity.integrityCheck === 'ok'
        && phases[2].snapshots.every((snapshot) => exactKeylessRestartBarrier(restartBarrierEvidence(snapshot))),
    });
    const reasonCodes = [];
    const eventCountNondecreasing = recoveredEventCount >= firstCleanEventCount;
    const gracefulStopsClean = gracefulPhases.every((entry) => entry.phase.shutdown.passed);
    const gracefulSocketsReceived1012 = gracefulPhases.every((entry) => entry.allShutdownSocketsReceived1012);
    const crashSocketsClosedAbnormally = raw[1].allCrashSocketsClosedAbnormally;
    const databaseIntegrityOnReadableStops = [phases[0], phases[2]].every((phase) => phase.storage.integrity.passed);
    const bootGenerationsOneTwoThree = phases.map((phase) => phase.snapshots[0].controlGeneration).every((generation, index) => generation === index + 1)
      && phases[0].storage.integrity.bootRelease.latestGeneration === 1
      && recoveryBootRelease.latestGeneration === 3
      && recoveryBootRelease.crashPendingGenerations.includes(2);
    const testedShaAllBoots = recoveryBootRelease.allRowsIdentityValid
      && allSnapshots.every((snapshot) => snapshot.testedCommitProjection === source.headSha);
    const deployedShaAbsentAllBoots = recoveryBootRelease.latestDeployedCommit === null
      && allSnapshots.every((snapshot) => snapshot.deployedCommitProjection === null);
    const opsReadbackNotFrozenAllBoots = allSnapshots.every((snapshot) => snapshot.deploymentFrozenProjection === false);
    const opsInterlockHonestAllBoots = allSnapshots.every((snapshot) => snapshot.opsProjectionValid);
    if (!eventCountNondecreasing) reasonCodes.push('EVENT_COUNT_REGRESSED_ACROSS_RECOVERY');
    if (!gracefulStopsClean) reasonCodes.push('GRACEFUL_STOP_NOT_PROVEN');
    if (!gracefulSocketsReceived1012) reasonCodes.push('GRACEFUL_WS_1012_NOT_PROVEN');
    if (!crashSocketsClosedAbnormally) reasonCodes.push('SIGKILL_WS_ABNORMAL_CLOSE_NOT_PROVEN');
    if (!databaseIntegrityOnReadableStops) reasonCodes.push('SQLITE_INTEGRITY_NOT_PROVEN');
    if (!bootGenerationsOneTwoThree) reasonCodes.push('BOOT_GENERATIONS_ONE_TWO_THREE_NOT_PROVEN');
    if (!testedShaAllBoots) reasonCodes.push('TESTED_SHA_NOT_PERSISTED_ALL_BOOTS');
    if (!deployedShaAbsentAllBoots) reasonCodes.push('DEPLOYED_SHA_WAS_INFERRED');
    if (!opsReadbackNotFrozenAllBoots) reasonCodes.push('DEPLOYMENT_FREEZE_READBACK_NOT_FALSE');
    if (!opsInterlockHonestAllBoots) reasonCodes.push('OPS_RECONCILIATION_INTERLOCK_NOT_PROVEN');
    if (!canonicalRestart?.passed) reasonCodes.push('CANONICAL_RESTART_OWNER_GATE_NOT_PROVEN');
    if (!uncleanRecovery.passed) reasonCodes.push('UNCLEAN_RECOVERY_NOT_PROVEN');
    const continuity = Object.freeze({
      sameDataDirectory: true,
      firstCleanEventCount,
      recoveredEventCount,
      eventCountNondecreasing,
      gracefulStopsClean,
      gracefulSocketsReceived1012,
      crashSocketsClosedAbnormally,
      databaseIntegrityOnReadableStops,
      bootGenerationsOneTwoThree,
      testedShaAllBoots,
      deployedShaAbsentAllBoots,
      opsReadbackNotFrozenAllBoots,
      opsInterlockHonestAllBoots,
      canonicalRestartOwnerGateProven: canonicalRestart?.passed === true,
      uncleanRecoveryProven: uncleanRecovery.passed,
      passed: reasonCodes.length === 0,
      reasonCodes,
    });
    const logFindings = raw.flatMap((entry) => entry.findings);
    const reportWithoutSlo = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      truthClass: 'LOCAL_PROXY_MEASURED',
      runId,
      createdAtUtc: createdAt.toISOString(),
      source,
      host: hostFingerprint(),
      boundary,
      load: {
        configuredDurationSeconds: options.durationSeconds,
        measuredWindowSeconds: Math.round(raw.reduce((sum, entry) => sum + entry.measuredDurationSeconds, 0) * 1_000) / 1_000,
        sampleIntervalMs: options.sampleIntervalMs,
        httpTargetRps: options.httpRps,
        httpConcurrency: options.httpConcurrency,
        webSocketClients: options.wsClients,
        focusSymbol: options.focusSymbol,
        phaseCount: 3,
        endpoints: SAFE_HTTP_ENDPOINTS,
      },
      phases,
      canonicalRestart,
      uncleanRecovery,
      continuity,
      limitations: REQUIRED_LIMITATIONS,
    };
    const secretScanPassed = logFindings.length === 0;
    const report = {
      ...reportWithoutSlo,
      slo: buildSlo(phases, raw, continuity, secretScanPassed),
      artifacts: {
        receiptRelativePath: `evidence/${requestedOutput.replaceAll('\\', '/')}`,
        receiptWriteMode: 'IMMUTABLE_CREATE_ONLY',
        schemaRelativePath: 'schema.v1.json',
        schemaSha256: fileSha256(SCHEMA_PATH),
        secretScan: {
          artifactsScanned: raw.length * 3 + 1,
          findings: logFindings,
          passed: secretScanPassed,
        },
      },
    };
    const reportFindings = scanSecretText(JSON.stringify(report));
    if (reportFindings.length > 0) {
      report.artifacts.secretScan.findings.push(...reportFindings.map((finding) => ({ artifact: 'receipt', ...finding })));
      report.artifacts.secretScan.passed = false;
      report.slo = Object.freeze({
        ...report.slo,
        invariantFailures: Object.freeze([...new Set([...report.slo.invariantFailures, 'RECEIPT_SECRET_SCAN_FAILED'])].toSorted()),
        overall: 'BLOCKED',
      });
    }
    const validation = validateJsonSchema(schema, report);
    if (!validation.passed) throw new Error(`REPORT_SCHEMA_INVALID:${validation.errors.join(',')}`);
    const destination = writeImmutableJson(EVIDENCE_ROOT, requestedOutput, report);
    process.stdout.write(`${JSON.stringify({ receipt: path.relative(ROOT, destination), schemaVersion: report.schemaVersion, runId, overall: report.slo.overall, schemaValid: true })}\n`);
    if (report.slo.overall !== 'PASS' || !report.artifacts.secretScan.passed) process.exitCode = 1;
    return Object.freeze({ report, destination });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

export function validatePerformanceDocument(document, expectedSource = {}) {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validation = validateJsonSchema(schema, document);
  const semanticFailures = [];
  if (expectedSource.headSha && document?.source?.headSha !== expectedSource.headSha) semanticFailures.push('PERFORMANCE_HEAD_SHA_MISMATCH');
  if (expectedSource.treeSha && document?.source?.treeSha !== expectedSource.treeSha) semanticFailures.push('PERFORMANCE_TREE_SHA_MISMATCH');
  if (document?.source?.worktreeState !== 'FROZEN_WITH_HASH_PINNED_OWNER_DIRECTIVES_AND_EVIDENCE') semanticFailures.push('PERFORMANCE_SOURCE_NOT_FROZEN');
  const protectedRows = Array.isArray(document?.source?.protectedOwnerDirectives) ? document.source.protectedOwnerDirectives : [];
  const protectedByPath = new Map(protectedRows.map((entry) => [entry.path, entry]));
  if (protectedRows.length !== PROTECTED_OWNER_DIRECTIVES.length
      || new Set(protectedRows.map((entry) => entry.path)).size !== protectedRows.length
      || PROTECTED_OWNER_DIRECTIVES.some((expected) => protectedByPath.get(expected.path)?.sha256 !== expected.sha256)) {
    semanticFailures.push('PERFORMANCE_PROTECTED_OWNER_DIRECTIVES_INVALID');
  }
  if (document?.slo?.overall !== 'PASS') semanticFailures.push('PERFORMANCE_SLO_NOT_PASS');
  if (document?.artifacts?.secretScan?.passed !== true) semanticFailures.push('PERFORMANCE_SECRET_SCAN_FAILED');
  if (document?.continuity?.passed !== true
      || document?.continuity?.gracefulStopsClean !== true
      || document?.continuity?.gracefulSocketsReceived1012 !== true
      || document?.continuity?.crashSocketsClosedAbnormally !== true
      || document?.continuity?.databaseIntegrityOnReadableStops !== true
      || document?.continuity?.bootGenerationsOneTwoThree !== true
      || document?.continuity?.testedShaAllBoots !== true
      || document?.continuity?.deployedShaAbsentAllBoots !== true
      || document?.continuity?.opsReadbackNotFrozenAllBoots !== true
      || document?.continuity?.opsInterlockHonestAllBoots !== true
      || document?.continuity?.canonicalRestartOwnerGateProven !== true
      || document?.continuity?.uncleanRecoveryProven !== true) {
    semanticFailures.push('PERFORMANCE_RUNTIME_CONTINUITY_FAILED');
  }
  const snapshots = Array.isArray(document?.phases) ? document.phases.flatMap((phase) => Array.isArray(phase.snapshots) ? phase.snapshots : []) : [];
  if (snapshots.length !== 6 || snapshots.some((snapshot) => (
    !snapshot.qProjectionValid
      || !snapshot.bootRevisionProjectionValid
      || !snapshot.opsProjectionValid
      || snapshot.readyStatus !== 503
      || snapshot.readyClassification !== 'HONEST_NOT_READY_503'
      || snapshot.tradeReadyStatus !== 503
      || snapshot.tradeReadyClassification !== 'HONEST_NOT_READY_503'
      || snapshot.opsExternalActionAuthorization !== 'NONE'
      || snapshot.testedCommitProjection !== document?.source?.headSha
      || snapshot.deployedCommitProjection !== null
      || snapshot.deploymentFrozenProjection !== false
      || snapshot.qComponentPresent !== true
      || snapshot.qAdvisoryAction !== 'ABSTAIN_UNKNOWN'
      || !['NOT_CONFIGURED', 'UNAVAILABLE'].includes(snapshot.qTruthLabel)
      || !['NOT_CONFIGURED', 'UNAVAILABLE'].includes(snapshot.qCapability)
      || snapshot.qAuthority !== 'UNAVAILABLE'
      || snapshot.qCapitalRelevance !== 'NONE'
      || snapshot.qControlCount !== 0
      || snapshot.tradeReadyProjection !== 'NO'
      || snapshot.opsInterlockBlocksNewEntries !== (snapshot.opsInterlockState === 'OPS_INTERLOCK_BLOCKED')
      || !['NONE', 'ACTIVE', 'AMBIGUOUS', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(snapshot.exposureStateProjection)
      || !['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(snapshot.ambiguityStateProjection)
      || !['NONE', 'RECOVERY_REQUIRED', 'UNKNOWN'].includes(snapshot.recoveryStateProjection)
      || typeof snapshot.reconciliationStatus !== 'string'
      || typeof snapshot.reconciliationBlocksNewExposure !== 'boolean'
      || !Array.isArray(snapshot.reconciliationReasonCodes)
      || snapshot.restartControlWiringState !== 'WIRED_LIVE'
      || typeof snapshot.restartControlRevision !== 'string'
      || snapshot.canonicalRuntimeEvidenceValid !== true
      || !canonicalRuntimeEvidenceValid(snapshot.managedInventory, snapshot.canonicalComponents, snapshot.productControls)
  ))) semanticFailures.push('PERFORMANCE_RUNTIME_TRUTH_INVALID');
  const runtimeEvidenceDigests = snapshots.map((snapshot) => sha256(canonicalJson({
    managedInventory: snapshot.managedInventory,
    canonicalComponentOwners: snapshot.canonicalComponents?.map((component) => ({
      componentId: component.componentId,
      owner: component.owner,
    })),
    productControls: snapshot.productControls,
  })));
  if (runtimeEvidenceDigests.length !== 6 || new Set(runtimeEvidenceDigests).size !== 1) {
    semanticFailures.push('PERFORMANCE_RUNTIME_INVENTORY_DRIFT');
  }
  const phases = Array.isArray(document?.phases) ? document.phases : [];
  const bootRows = phases.map((phase) => phase?.storage?.integrity?.bootRelease);
  if (phases.length !== 3
      || phases[0]?.phaseId !== 'CANONICAL_RESTART_GATE'
      || phases[1]?.phaseId !== 'UNCLEAN_TERMINATION'
      || phases[2]?.phaseId !== 'POST_CRASH_RECOVERY'
      || phases.some((phase, index) => phase?.bootGeneration !== index + 1
        || phase?.shutdown?.passed !== true
        || phase?.websocket?.clientsOpened !== document?.load?.webSocketClients)
      || phases[0]?.shutdown?.mode !== 'GRACEFUL'
      || phases[0]?.shutdown?.signal !== 'SIGTERM'
      || phases[0]?.websocket?.shutdownClose1012Count < 1
      || phases[0]?.storage?.integrity?.passed !== true
      || phases[1]?.shutdown?.mode !== 'UNCLEAN_CRASH'
      || phases[1]?.shutdown?.signal !== 'SIGKILL'
      || phases[1]?.shutdown?.exitSignal !== 'SIGKILL'
      || phases[1]?.shutdown?.cleanLogMarkerObserved !== false
      || phases[1]?.websocket?.uncleanClose1006Count < 1
      || phases[1]?.storage?.integrity !== null
      || phases[2]?.shutdown?.mode !== 'GRACEFUL'
      || phases[2]?.shutdown?.signal !== 'SIGTERM'
      || phases[2]?.websocket?.shutdownClose1012Count < 1
      || phases[2]?.storage?.integrity?.passed !== true
      || bootRows[0]?.rowCount !== 1
      || bootRows[0]?.latestGeneration !== 1
      || bootRows[0]?.allRowsClean !== true
      || bootRows[0]?.crashPendingCount !== 0
      || bootRows[0]?.latestTestedCommit !== document?.source?.headSha
      || bootRows[0]?.latestDeployedCommit !== null
      || bootRows[0]?.passed !== true
      || bootRows[2]?.rowCount !== 3
      || bootRows[2]?.latestGeneration !== 3
      || bootRows[2]?.allRowsClean !== false
      || bootRows[2]?.cleanCompletedCount !== 2
      || bootRows[2]?.crashPendingCount !== 1
      || !Array.isArray(bootRows[2]?.crashPendingGenerations)
      || bootRows[2].crashPendingGenerations.length !== 1
      || bootRows[2].crashPendingGenerations[0] !== 2
      || bootRows[2]?.latestLifecycleState !== 'CLEAN_COMPLETED'
      || bootRows[2]?.allRowsIdentityValid !== true
      || bootRows[2]?.latestTestedCommit !== document?.source?.headSha
      || bootRows[2]?.latestDeployedCommit !== null
      || bootRows[2]?.passed !== true) {
    semanticFailures.push('PERFORMANCE_BOOT_STORAGE_TRUTH_INVALID');
  }
  const restart = document?.canonicalRestart;
  if (restart?.passed !== true
      || restart?.disposition !== 'OWNER_GATED'
      || restart?.managedRestartAcceptance !== 'NOT_PROVEN'
      || restart?.resultStatus !== 'REJECTED_STATE'
      || restart?.receiptId !== null
      || restart?.durableReceiptObserved !== false
      || restart?.durableRejectionAuditObserved !== true
      || restart?.rejectionCode !== 'RESTART_EXPOSURE_NONE_NOT_PROVEN'
      || restart?.resultStateUnchanged !== true
      || restart?.resultBeforeSha256 !== restart?.resultAfterSha256
      || restart?.resultBeforeRevision !== restart?.resultAfterRevision
      || restart?.resultBeforeGeneration !== restart?.resultAfterGeneration
      || restart?.controlGenerationAdvanced !== false
      || restart?.runtimeGenerationAdvanced !== false
      || restart?.effectGenerationAdvanced !== false
      || restart?.webSocketClose1012Observed !== true
      || restart?.barrierPreserved !== true
      || phases[0]?.storage?.integrity?.controlCommand?.idempotencyKey !== restart?.idempotencyKey
      || phases[0]?.storage?.integrity?.controlCommand?.durableReceiptObserved !== false
      || phases[0]?.storage?.integrity?.controlCommand?.durableRejectionAuditObserved !== true
      || phases[0]?.snapshots?.[0]?.controlGeneration !== phases[0]?.snapshots?.[1]?.controlGeneration
      || phases[0]?.snapshots?.[0]?.runtimeGeneration !== phases[0]?.snapshots?.[1]?.runtimeGeneration
      || !exactKeylessRestartBarrier(restart?.beforeBarrier)
      || !exactKeylessRestartBarrier(restart?.afterBarrier)) {
    semanticFailures.push('PERFORMANCE_CANONICAL_RESTART_GATE_INVALID');
  }
  const recovery = document?.uncleanRecovery;
  if (recovery?.passed !== true
      || recovery?.terminationSignal !== 'SIGKILL'
      || recovery?.uncleanBootGeneration !== 2
      || recovery?.recoveryBootGeneration !== 3
      || !Number.isSafeInteger(recovery?.walBytesAfterSigkill)
      || recovery.walBytesAfterSigkill < 1
      || recovery?.walBytesBeforeRecoveryLaunch !== recovery?.walBytesAfterSigkill
      || recovery?.walBytesAfterSigkill !== phases[1]?.storage?.wal?.finalBytes
      || recovery?.walBytesBeforeRecoveryLaunch !== phases[2]?.storage?.preLaunch?.walBytes
      || recovery?.databaseOpenedByHarnessBetweenCrashAndRecovery !== false
      || recovery?.applicationRuntimeFirstRecoveryOpen !== true
      || recovery?.crashPendingGeneration !== 2
      || recovery?.crashPendingBootPreserved !== true
      || recovery?.recoveryLatestLifecycleState !== 'CLEAN_COMPLETED'
      || recovery?.recoveryWalRemovedOnCleanClose !== true
      || phases[2]?.storage?.wal?.finalBytes !== 0
      || phases[2]?.storage?.shm?.finalBytes !== 0
      || recovery?.readinessHonestAfterRecovery !== true
      || recovery?.reconciliationStillBlocksAfterRecovery !== true
      || recovery?.quickCheck !== 'ok'
      || recovery?.integrityCheck !== 'ok') {
    semanticFailures.push('PERFORMANCE_UNCLEAN_RECOVERY_INVALID');
  }
  if (document?.slo?.degradationVisibility !== 'CANONICAL_NON_GREEN_VISIBLE') semanticFailures.push('PERFORMANCE_FALSE_GREEN_VISIBILITY_INVALID');
  for (const phase of document?.phases ?? []) {
    const [start, end] = phase.snapshots ?? [];
    for (const field of ['stateNowMs', 'basisLastBookTs', 'basisLastMarkTs', 'volumeLastBookTs', 'volumeLastTradeTs', 'volumeTradeMessages']) {
      if (!Number.isSafeInteger(start?.[field]) || !Number.isSafeInteger(end?.[field]) || end[field] <= start[field]) semanticFailures.push(`PERFORMANCE_SOURCE_NOT_ADVANCING:${phase.phaseId}:${field}`);
    }
  }
  return Object.freeze({
    schemaValid: validation.passed,
    schemaErrors: validation.errors,
    semanticFailures: Object.freeze([...new Set(semanticFailures)].toSorted()),
    passed: validation.passed && semanticFailures.length === 0,
  });
}

function validatePerformanceReceipt(requested) {
  const resolved = realpathSync(path.resolve(ROOT, requested));
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error('PERFORMANCE_RECEIPT_OUTSIDE_REPOSITORY');
  assertSourceBoundToHead();
  const text = readFileSync(resolved, 'utf8');
  const document = JSON.parse(text);
  const expectedSource = { headSha: git(['rev-parse', 'HEAD']), treeSha: git(['rev-parse', 'HEAD^{tree}']) };
  const validation = validatePerformanceDocument(document, expectedSource);
  const secretFindings = scanSecretText(text);
  return Object.freeze({
    relativePath: path.relative(ROOT, resolved),
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    ...validation,
    secretFindings,
    passed: validation.passed && secretFindings.length === 0,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseSoakArgs(process.argv.slice(2));
  if (options.mode === 'PLAN') {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: 'PLAN_ONLY',
      boundary: 'LOOPBACK_KEYLESS_PUBLIC_ONLY',
      defaultDurationSeconds: options.durationSeconds,
      phaseCount: 3,
      canonicalRestart: 'OWNER_GATED_REJECTION_PROOF_ONLY',
      processRestart: 'GRACEFUL_SIGTERM_WS_1012',
      crashRecovery: 'SIGKILL_WAL_APPLICATION_FIRST_RECOVERY',
      receiptMode: 'IMMUTABLE_CREATE_ONLY',
    }, null, 2)}\n`);
  } else if (options.mode === 'VALIDATE_ONLY') {
    try {
      const result = validatePerformanceReceipt(options.validateReceipt);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.passed) process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`LOCAL_PROXY_VALIDATE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  } else {
    runLocalProxySoak(options).catch((error) => {
      process.stderr.write(`LOCAL_PROXY_SOAK_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
