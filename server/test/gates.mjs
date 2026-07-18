#!/usr/bin/env node
/**
 * v0 gate tests. Boots the built server on a test port with an isolated data
 * dir and hostile ambient credentials, then asserts they cannot become an
 * exchange-private, money-moving, or external-infrastructure capability.
 * Run: node server/test/gates.mjs   (after npm run build)
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  deriveI00MeaningfulAdvanceEvidence,
  projectI00Health,
} from '../dist/systemIntegration/application/health.js';

const HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = 20_000;
const TRIPWIRE_URL = new URL('./private-egress-tripwire.mjs', import.meta.url).href;
const results = [];

async function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a test port'));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function childFinished(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs = 12_000) {
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
      reject(new Error('server did not exit in time'));
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function stopChild(child) {
  if (childFinished(child)) return waitForExit(child);
  child.kill('SIGTERM');
  try {
    return await waitForExit(child);
  } catch (error) {
    if (!childFinished(child)) child.kill('SIGKILL');
    await waitForExit(child, 3_000).catch(() => undefined);
    throw error;
  }
}

const PORT = await availablePort();
const BASE = `http://${HOST}:${PORT}`;

async function request(p, init = {}) {
  return fetch(`${BASE}${p}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(p) {
  const res = await request(p);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function browserGet(p, deviceId = 'gate-primary-device-2026') {
  const res = await request(p, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36',
      Cookie: `cosmos_device=${deviceId}`,
    },
  });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

async function post(p, body) {
  const res = await request(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function awsControl(p, { method = 'GET', body } = {}) {
  const res = await request(p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Cosmos-Control': 'aws-runner',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---------- static gates (no server needed) ----------
console.log('\nStatic gates:');

const gitignore = readFileSync('.gitignore', 'utf8');
check('.env is gitignored', /^\.env$/m.test(gitignore));

let envTracked = false;
try {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', '.env'], { stdio: 'ignore' });
  envTracked = true;
} catch {
  // `git ls-files --error-unmatch` exits non-zero when .env is not in the index.
}
check('.env is not tracked', !envTracked);

// The real danger is client code READING key material — not the env var
// names appearing in setup-instruction copy. Flag env access patterns and
// key-value-shaped literals in the shipped bundle.
const distDir = 'web/dist/assets';
const bundleExists = existsSync(distDir);
check('frontend production bundle exists', bundleExists);
let bundleClean = bundleExists;
if (bundleExists) {
  for (const f of readdirSync(distDir)) {
    const txt = readFileSync(path.join(distDir, f), 'utf8');
    if (
      /import\.meta\.env\.\w*BINANCE/i.test(txt) ||
      /process\.env\.\w*BINANCE/i.test(txt) ||
      /apiSecret\s*[:=]\s*["'][A-Za-z0-9]{20,}/.test(txt) ||
      /X-MBX-APIKEY/.test(txt)
    ) {
      bundleClean = false;
    }
  }
}
check('frontend bundle reads no key material', bundleClean);

// No withdrawal/transfer-out FEATURE anywhere. Safety copy saying
// "withdrawals disabled" is required, so match action patterns instead.
// READ-ONLY history (capital/withdraw/history — past records for the equity
// chart) is allowed; the ACTION endpoint (capital/withdraw/apply) is banned.
const actionPatterns = [
  /capital\/withdraw\/apply/i,
  /\/api\/withdraw/i,
  /withdrawApply/i,
  /\bwithdraw\s*\(/i,
  /sub-account\/transfer/i,
  /asset\/transfer/i,
];
let noWithdrawFeature = true;
const liquidationTransportOwners = [];
const scanDir = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) scanDir(p);
    else if (/\.(tsx?|mts|css)$/.test(f.name)) {
      const txt = readFileSync(p, 'utf8');
      if (actionPatterns.some((re) => re.test(txt))) {
        noWithdrawFeature = false;
        console.log(`    withdrawal-action pattern found in ${p}`);
      }
      for (const _match of txt.matchAll(/wss:\/\/fstream\.binance\.com\/market\/ws\/!forceOrder@arr/g)) {
        liquidationTransportOwners.push(p);
      }
    }
  }
};
scanDir('web/src');
scanDir('server/src');
check('no withdrawal/transfer-out feature in source', noWithdrawFeature);

const serverIndex = readFileSync('server/src/index.ts', 'utf8');
const marketEngineSource = readFileSync('server/src/engine/marketData.ts', 'utf8');
const liquidationProjectionSource = readFileSync('server/src/binance/liquidations.ts', 'utf8');
const productionFactorySource = readFileSync('server/src/systemIntegration/production/factory.ts', 'utf8');
const tokenDetailSource = readFileSync('web/src/pages/TokenDetail.tsx', 'utf8');
const tokenIconSource = readFileSync('web/src/components/TokenIcon.tsx', 'utf8');
const profileSource = readFileSync('server/src/binance/profile.ts', 'utf8');
const iconSource = readFileSync('server/src/binance/icons.ts', 'utf8');
const liquidationSource = readFileSync('server/src/binance/liquidations.ts', 'utf8');
const environmentSource = readFileSync('server/src/bootstrap/environment.ts', 'utf8');
check(
  'declared Binance keys never request withdrawal or universal-transfer permission',
  !/permissions\s*:\s*\{[^}]*withdrawals\s*:\s*true/si.test(serverIndex)
    && !/permissions\s*:\s*\{[^}]*universalTransfer\s*:\s*true/si.test(serverIndex)
);
check(
  'production composition has no ambient credential or external-control constructor',
  !/\bcredsFromEnv\b/.test(serverIndex) &&
    !/new\s+BinanceClient\b/.test(serverIndex) &&
    !/from\s+['"]\.\/binance\/userStream\.js['"]/.test(serverIndex) &&
    !/new\s+UserStream\b/.test(serverIndex) &&
    !/from\s+['"]\.\/services\/awsRunnerControl\.js['"]/.test(serverIndex) &&
    !/new\s+AwsRunnerControl\b/.test(serverIndex) &&
    !/from\s+['"]\.\/services\/loans\.js['"]/.test(serverIndex)
);
check(
  'legacy signed services receive only a mechanically unavailable client',
  /function\s+unavailablePrivateBinanceClient\(\):\s*BinanceClient\s*\|\s*null\s*\{\s*return\s+null;\s*\}/s.test(serverIndex) &&
    /const\s+client\s*=\s*unavailablePrivateBinanceClient\(\);/.test(serverIndex)
);
check(
  'production route composition invokes no signed or money mutation method',
  !/\b(?:orders|loans)\.(?:send|testOrder|cancel|cancelAll|borrow|repay|adjustLtv|resolveOrderRecovery)\s*\(/.test(serverIndex) &&
    !/\baccount\.sync\s*\(/.test(serverIndex) &&
    !/\borders\.(?:syncOpenOrders|reconcilePendingOrders)\s*\(/.test(serverIndex)
);
check(
  'legacy WebSocket does not expose raw Ledger events and Product streaming is not claimed',
  !/ledger\.on\(\s*['"]event['"][\s\S]{0,200}type:\s*['"]event['"]/.test(serverIndex)
);
check(
  'MarketEngine is the sole physical liquidation producer and production admission runs before lifecycle construction',
  liquidationTransportOwners.length === 1 &&
    liquidationTransportOwners[0] === 'server/src/engine/marketData.ts' &&
    (marketEngineSource.match(/wss:\/\/fstream\.binance\.com\/market\/ws\/!forceOrder@arr/g) ?? []).length === 1 &&
    !/(?:from\s+['"]ws['"]|new\s+WebSocket|wss:\/\/)/.test(liquidationProjectionSource) &&
    !/(?:ForceOrder|ingestFrame|!forceOrder@arr|BinanceStream|socketFactory|last-filled quantity|cumulative filled quantity)/.test(liquidationProjectionSource) &&
    !/marketAuxiliary|startLiquidationCollector|stopLiquidationCollector/.test(serverIndex) &&
    /const\s+sourceRegistry\s*=\s*admitProductionSourceRegistry\([^;]+;[\s\S]*?new\s+MarketLifecyclePort/.test(productionFactorySource) &&
    /server\.listen\([\s\S]*?startServerTimers\(\);/.test(serverIndex) &&
    !/admitMarketOwnedAuxiliaries|stopMarketOwnedAuxiliaries/.test(serverIndex) &&
    !/startNewsRefreshLoop|primeIconStartTimer|initialRefreshTimer|warmProfileStartTimer/.test(serverIndex)
);
check(
  'automatic token rendering owns no direct exchange socket or fallback CDN transport',
  !/(?:new\s+WebSocket|wss:\/\/)/.test(tokenDetailSource) &&
    !/(?:cdn\.jsdelivr\.net|assets\.coincap\.io)/.test(tokenIconSource) &&
    /const\s+chain\s*=\s*\[resolved\]\.filter\(Boolean\)/.test(tokenIconSource)
);
check(
  'browser campaign public caches default under the isolated DATA_DIR',
  [profileSource, iconSource, liquidationSource].every((source) => (
    /resolveDataDirAuthority\(\)/.test(source)
  )) && /environment\.DATA_DIR/.test(environmentSource) &&
    /icon_cache\.json/.test(environmentSource) &&
    /profile_cache\.json/.test(environmentSource) &&
    /liquidations\.json/.test(environmentSource)
);

const cacheProbeRoot = mkdtempSync(path.join(tmpdir(), 'cosmos-cache-defaults-'));
try {
  const cacheProbeData = path.join(cacheProbeRoot, 'isolated-data');
  const cacheProbeCwd = path.join(cacheProbeRoot, 'unrelated-cwd');
  mkdirSync(cacheProbeData, { recursive: true });
  mkdirSync(cacheProbeCwd, { recursive: true });
  const now = Date.now();
  const bucket5 = String(Math.floor(now / 300_000) * 300_000);
  const bucket1 = String(Math.floor(now / 3_600_000) * 3_600_000);
  writeFileSync(path.join(cacheProbeData, 'icon_cache.json'), JSON.stringify({
    BTC: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
  }));
  writeFileSync(path.join(cacheProbeData, 'profile_cache.json'), JSON.stringify({
    BTC: { id: 'bitcoin', idTs: now, profile: { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', full: false, fetchedAt: now }, profileTs: now },
  }));
  writeFileSync(path.join(cacheProbeData, 'liquidations.json'), JSON.stringify({
    since: now - 1_000,
    books: { BTCUSDT: { m5: { [bucket5]: { long: 1, short: 2 } }, h1: { [bucket1]: { long: 1, short: 2 } } } },
  }));

  const moduleUrls = {
    icons: `file://${path.resolve('server/dist/binance/icons.js')}`,
    profile: `file://${path.resolve('server/dist/binance/profile.js')}`,
    liquidations: `file://${path.resolve('server/dist/binance/liquidations.js')}`,
  };
  const cacheProbeScript = `
    const icons = await import(${JSON.stringify(moduleUrls.icons)});
    const profile = await import(${JSON.stringify(moduleUrls.profile)});
    const liquidations = await import(${JSON.stringify(moduleUrls.liquidations)});
    const out = {
      icon: icons.resolveIcons(['BTC']).BTC ?? null,
      cachedProfiles: profile.profileWarmStatus().cachedProfiles,
      liquidationPoints: liquidations.liquidationSeries('BTCUSDT', 300000).points.length,
    };
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  `;
  const cacheProbe = JSON.parse(execFileSync(process.execPath, [
    '--import',
    TRIPWIRE_URL,
    '--input-type=module',
    '--eval',
    cacheProbeScript,
  ], {
    cwd: cacheProbeCwd,
    env: {
      PATH: process.env.PATH,
      DATA_DIR: cacheProbeData,
      SKIP_DOTENV: '1',
      I00_TEST_EGRESS_STRICT: '1',
      ...(process.env.I00_TEST_EGRESS_REPORT_FILE === undefined
        ? {}
        : { I00_TEST_EGRESS_REPORT_FILE: process.env.I00_TEST_EGRESS_REPORT_FILE }),
    },
    encoding: 'utf8',
    timeout: 10_000,
  }));
  check(
    'profile, icon, and liquidation modules behaviorally read default caches only from DATA_DIR',
    typeof cacheProbe.icon === 'string' && cacheProbe.icon.includes('coingecko.com') &&
      cacheProbe.cachedProfiles === 1 && cacheProbe.liquidationPoints === 1,
    JSON.stringify(cacheProbe),
  );
} catch (error) {
  check('profile, icon, and liquidation modules behaviorally read default caches only from DATA_DIR', false, String(error));
} finally {
  rmSync(cacheProbeRoot, { recursive: true, force: true });
}
check(
  'legacy proposal Scanner has no production import, construction, tick, status, or mutation reachability',
  !/from\s+['"]\.\/engine\/scanner\.js['"]/.test(serverIndex) &&
    !/\bnew\s+Scanner\s*\(/.test(serverIndex) &&
    !/\bscanner\.(?:tick|statusOf|proposals|watchingCount|dismiss)\s*\(/.test(serverIndex) &&
    !/\b(?:scannerTimer|runScannerTick)\b/.test(serverIndex)
);
check(
  'passive liquidation projection has no independent admission timer or transport',
  !/liquidationCollectorStarted/.test(serverIndex) &&
    !/(?:socketFactory|WebSocket|wss:\/\/)/.test(liquidationProjectionSource),
);
check(
  'production mounts fail-closed managed runtime-effect owner readback',
  /readControlRuntimeEffect:\s*\([^)]*effectId[^)]*mutation[^)]*\)\s*=>\s*\{[\s\S]*?readManagedControlRuntimeEffect\(effectId, mutation, readManaged\(\)\)/.test(serverIndex)
    && /if\s*\(readManaged\s*===\s*null\)\s*return\s*['"]UNKNOWN['"]/.test(serverIndex)
);
check(
  'PnL integrity cannot become complete through vacuous every on an empty evidence set',
  /const\s+integrityComplete\s*=\s*integrity\.length\s*>\s*0\s*&&\s*integrity\.every/.test(serverIndex) &&
    /integrity\.length\s*===\s*0\)\s*integrityReasons\.push\(['"]NO_DURABLE_PNL_EVIDENCE['"]\)/.test(serverIndex)
);
check(
  'private account and order availability require fresh authorized readbacks, not key presence',
  /function\s+privateAccountTruthState[\s\S]*?account\.equity\(\)\.sourceFresh[\s\S]*?['"]AVAILABLE['"]/.test(serverIndex) &&
    /function\s+privateOrderTruthState[\s\S]*?orders\.lastOrdersSyncTs[\s\S]*?ageMs\s*<=\s*60_000[\s\S]*?['"]AVAILABLE['"]/.test(serverIndex)
);

// ---------- boot server ----------
console.log('\nBooting server (hostile ambient credentials, isolated data dir)…');
const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-gates-'));
const privateEgressSentinel = path.join(dataDir, 'private-egress-attempts.log');
const networkEgressSentinel = path.join(dataDir, 'network-egress-attempts.log');
const child = spawn(process.execPath, ['--import', TRIPWIRE_URL, 'server/dist/index.js'], {
  // Synthetic credentials are deliberate: the runtime must remain keyless and
  // owner-gated even if every common ambient credential source is populated.
  env: {
    PATH: process.env.PATH,
    PORT: String(PORT),
    HOST,
    DATA_DIR: dataDir,
    SKIP_DOTENV: '1',
    BINANCE_API_KEY: 'sentinel-binance-api-key-not-a-secret',
    BINANCE_API_SECRET: 'sentinel-binance-api-secret-not-a-secret',
    AWS_ACCESS_KEY_ID: 'SENTINELACCESSKEY',
    AWS_SECRET_ACCESS_KEY: 'sentinel-aws-secret-not-a-secret',
    AWS_SESSION_TOKEN: 'sentinel-aws-session-not-a-secret',
    AWS_REGION: 'us-east-1',
    AWS_CONTROL_REGION: 'us-east-1',
    AWS_CONTROL_INSTANCE_ID: 'i-0123456789abcdef0',
    AWS_CONTROL_RUNNER_PATH: '/tmp/sentinel-runner.mjs',
    AWS_CONTROL_WORKDIR: '/tmp',
    AWS_CONTROL_SERVICE: 'sentinel-service',
    AWS_CONTROL_VALIDATE_COMMAND: 'true',
    NOTIFICATION_AWS_INGEST_TOKEN: 'sentinel-aws-notification-token-not-a-secret',
    PRIVATE_EGRESS_SENTINEL_FILE: privateEgressSentinel,
    NETWORK_EGRESS_SENTINEL_FILE: networkEgressSentinel,
    I00_DETERMINISTIC_OFFLINE_PUBLIC_SOURCES: '1',
    I00_TEST_EGRESS_STRICT: '1',
    ...(process.env.I00_TEST_EGRESS_REPORT_FILE === undefined
      ? {}
      : { I00_TEST_EGRESS_REPORT_FILE: process.env.I00_TEST_EGRESS_REPORT_FILE }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
let spawnError = null;
child.on('error', (error) => { spawnError = error; });
child.stdout.on('data', (d) => { bootLog = `${bootLog}${d}`.slice(-32_000); });
child.stderr.on('data', (d) => { bootLog = `${bootLog}${d}`.slice(-32_000); });

try {
const deadline = Date.now() + 90_000;
let booted = false;
while (Date.now() < deadline) {
  if (spawnError || childFinished(child)) break;
  try {
    const { body } = await get('/health/live');
    if (body?.ok) {
      booted = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('\nRuntime gates:');
check('app boots', booted, booted ? '' : bootLog.slice(-300));
if (!booted) {
  throw new Error(`app did not boot${spawnError ? `: ${spawnError.message}` : `: ${bootLog.slice(-500)}`}`);
}

const isolatedQuote = await get('/api/market/quote?symbol=BTCUSDT');
check(
  'deterministic gate keeps public market truth unavailable without external egress',
  isolatedQuote.status === 200 &&
    isolatedQuote.body?.last === null &&
    isolatedQuote.body?.book === null &&
    isolatedQuote.body?.tradable === false
);

const health = (await get('/api/health')).body;
check('keys absent → keysPresent=false', health.keysPresent === false);
check('fresh boot mode is HALTED', health.mode === 'HALTED');
check(
  'legacy /api/health is explicitly process-liveness compatibility and never semantic readiness',
  health.healthClass === 'PROCESS_LIVENESS_COMPATIBILITY' &&
    health.readinessSemantics === 'NOT_EVALUATED' &&
    health.canonicalReadinessEndpoint === '/health/ready' &&
    health.ready === undefined
);

const state = (await get('/api/state')).body;
check(
  'legacy state is an explicit compatibility view of one canonical supervisor snapshot',
  state.schemaVersion === 'legacy.state.compatibility.v2' &&
    state.stateClass === 'COMPATIBILITY_VIEW' &&
    state.readinessSemantics === 'NOT_EVALUATED' &&
    state.canonicalReadinessEndpoint === '/health/ready' &&
    state.canonicalSupervisorEndpoint === '/api/system-integration/supervisor' &&
    state.canonicalSupervisor?.evaluatedAtMs <= state.now &&
    state.mode === (state.config?.killSwitch || state.canonicalSupervisor?.control?.killSwitchEngaged ? 'HALTED' : 'MANUAL')
);
check('disconnected state: account is null', state.account === null);
check(
  'unconfigured private truth is null rather than a zero-position account',
  state.privateAccountTruth === 'NOT_CONFIGURED' &&
    state.privateOrderTruth === 'NOT_CONFIGURED' &&
    state.positions === null &&
    state.openOrders === null
);
check('disconnected state: binance.connected=false', state.binance.connected === false);
check(
  'ambient Binance credentials cannot create a private runtime posture',
  state.binance.keysPresent === false && state.binance.userStream === 'off' && state.binance.keyFingerprint === null
);
check('state includes config/risk/events', !!state.config && !!state.risk && Array.isArray(state.events));
check(
  'legacy scanner compatibility state is explicit RETIRED with no active proposals or tick evidence',
  state.scanner?.state === 'RETIRED' &&
    state.scanner?.watching === 0 &&
    state.scanner?.lastTickTs === null &&
    Array.isArray(state.proposals) &&
    state.proposals.length === 0
);

const proposalMutationEventsBefore = (await get('/api/events?kind=manual_action&limit=100')).body;
const retiredProposalMutations = [
  await post('/api/proposals/123/approve', {}),
  await post('/api/proposals/123/reject', {}),
];
const proposalMutationEventsAfter = (await get('/api/events?kind=manual_action&limit=100')).body;
check(
  'legacy proposal approve and reject are permanent 410 RETIRED tombstones with zero Ledger mutation',
  retiredProposalMutations.every((response) => (
    response.status === 410 &&
    response.body?.code === 'RETIRED' &&
    response.body?.state === 'RETIRED' &&
    response.body?.available === false
  )) &&
    JSON.stringify(proposalMutationEventsAfter) === JSON.stringify(proposalMutationEventsBefore)
);
const tradeReady = await get('/health/trade-ready');
const processLive = await get('/health/live');
check(
  'canonical liveness remains process-only while readiness evidence is unavailable',
  processLive.status === 200 && processLive.body?.ok === true
);
const dependencyReady = await get('/health/ready');
const readinessSupervisor = (await get('/api/system-integration/supervisor')).body;
const canonicalAdvanceOwnerIds = new Set(['public-usdm-source', 'market-universe']);
const sameCutAdvance = deriveI00MeaningfulAdvanceEvidence(readinessSupervisor);
const hostileReadiness = (kind) => {
  const hostile = structuredClone(readinessSupervisor);
  if (kind === 'WRONG_OWNER') {
    const canonicalOwner = hostile.components.find((component) => canonicalAdvanceOwnerIds.has(component.componentId));
    const wrongOwner = hostile.components.find((component) => component.componentId === 'basis-engine');
    if (canonicalOwner && wrongOwner) {
      Object.assign(wrongOwner, {
        truthLabel: canonicalOwner.truthLabel,
        authority: canonicalOwner.authority,
        completeness: canonicalOwner.completeness,
        desiredState: canonicalOwner.desiredState,
        phase: canonicalOwner.phase,
        readiness: canonicalOwner.readiness,
        sourceTimestamp: structuredClone(canonicalOwner.sourceTimestamp),
        freshness: structuredClone(canonicalOwner.freshness),
        lastSuccessAtMs: hostile.evaluatedAtMs,
      });
    }
    hostile.components = hostile.components.filter((component) => !canonicalAdvanceOwnerIds.has(component.componentId));
  } else {
    hostile.components = hostile.components.map((component) => {
      if (!canonicalAdvanceOwnerIds.has(component.componentId)) return component;
      component.lastSuccessAtMs = hostile.evaluatedAtMs;
      if (kind === 'UNKNOWN') {
        component.truthLabel = 'UNKNOWN';
        component.authority = 'UNAVAILABLE';
      } else if (component.freshness) {
        component.freshness.state = 'STALE';
        component.freshness.ageMs = (component.sourceTimestamp?.maxAgeMs ?? 1) + 1;
      }
      return component;
    });
  }
  const advance = deriveI00MeaningfulAdvanceEvidence(hostile);
  return { advance, projection: projectI00Health('READY', hostile, true, advance) };
};
const staleReadiness = hostileReadiness('STALE');
const unknownReadiness = hostileReadiness('UNKNOWN');
const wrongOwnerReadiness = hostileReadiness('WRONG_OWNER');
const advanceProjectionSource = readFileSync('server/src/systemIntegration/application/health.ts', 'utf8');
const advanceProjectionBody = advanceProjectionSource.slice(
  advanceProjectionSource.indexOf('export function deriveI00MeaningfulAdvanceEvidence'),
  advanceProjectionSource.indexOf('function unique'),
);
const readinessAdvanceChecks = {
  endpointContract: dependencyReady.body?.kind === 'READY'
    && typeof dependencyReady.body?.ok === 'boolean'
    && dependencyReady.status === (dependencyReady.body.ok ? 200 : 503)
    && (dependencyReady.body.ok || dependencyReady.body.reasonCodes?.length > 0),
  noSyntheticAdvance: sameCutAdvance === null,
  noCanonicalOwnerClaim: dependencyReady.body?.meaningfulAdvanceOwnerComponentId === null,
  noObservedAtClaim: dependencyReady.body?.lastMeaningfulAdvanceAtMs === null,
  noAgeClaim: dependencyReady.body?.meaningfulAdvanceAgeMs === null,
  advanceFailureNamed: dependencyReady.body?.reasonCodes?.includes('MEANINGFUL_ADVANCE_NOT_SUPPLIED'),
  hostileFailClosed: [staleReadiness, unknownReadiness, wrongOwnerReadiness].every(({ advance, projection }) => (
    advance === null
    && projection.ok === false
    && projection.reasonCodes.includes('MEANINGFUL_ADVANCE_NOT_SUPPLIED')
  )),
  noAmbientProgress: !/(?:Date\.now|performance\.now|setTimeout|setInterval|setImmediate|queueMicrotask)\s*\(/.test(advanceProjectionBody),
};
const readinessAdvancePassed = Object.values(readinessAdvanceChecks).every(Boolean);
check(
  'canonical readiness fails closed without external source truth and rejects stale, unknown, wrong-owner, or inferred progress',
  readinessAdvancePassed,
  readinessAdvancePassed ? '' : JSON.stringify({ readinessAdvanceChecks, dependencyReady }),
);
check(
  'canonical trade readiness preserves the live-execution barrier',
  tradeReady.status === 503 && tradeReady.body?.executionBarrier === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
);

await browserGet('/api/state');
const browserSessionsResponse = await browserGet('/api/sessions');
const browserSessions = browserSessionsResponse.body;
check(
  'browser sessions persist truthful browser-only activity',
  browserSessionsResponse.status === 200 &&
    browserSessions?.source === 'browser-request-telemetry' &&
    browserSessions?.retentionHours === 24 &&
    browserSessions?.activeWindowSeconds === 120 &&
    browserSessions?.cloudflareActiveSessions === false &&
    browserSessions?.sessions?.length === 1 &&
    browserSessions.sessions[0]?.current === true &&
    browserSessions.sessions[0]?.active === true &&
    browserSessions.sessions[0]?.system === 'macOS' &&
    /^Chrome /.test(browserSessions.sessions[0]?.browser ?? '') &&
    browserSessions.sessions[0]?.device === 'Desktop' &&
    browserSessions.sessions[0]?.ip === '127.0.0.1' &&
    browserSessions.sessions[0]?.requests >= 2 &&
    /no-store/i.test(browserSessionsResponse.headers.get('cache-control') ?? '')
);

await browserGet('/api/state', 'gate-secondary-device-2026');
const multiDeviceSessions = (await browserGet('/api/sessions', 'gate-secondary-device-2026')).body;
check(
  'same IP and browser keep separate latest devices',
  multiDeviceSessions?.identity === 'first-party-device-token' &&
    multiDeviceSessions?.sessions?.length === 2 &&
    multiDeviceSessions.sessions.filter((session) => session.active).length === 2 &&
    multiDeviceSessions.sessions.filter((session) => session.current).length === 1 &&
    multiDeviceSessions.sessions[0]?.current === true,
);

const previewIntentsBefore = (await get('/api/events?kind=order_intent&limit=10')).body;
const previewDecisionsBefore = (await get('/api/events?kind=risk_decision&limit=10')).body;
const legacyPreview = await post('/api/trade/preview', {
  symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 100,
});
const previewIntentsAfter = (await get('/api/events?kind=order_intent&limit=10')).body;
const previewDecisionsAfter = (await get('/api/events?kind=risk_decision&limit=10')).body;
check(
  'legacy trade preview is structurally unavailable without canonical Capital, Risk, and ticket owners',
  legacyPreview.status === 503 &&
    legacyPreview.body?.code === 'NOT_CONFIGURED' &&
    legacyPreview.body?.truthState === 'UNAVAILABLE' &&
    legacyPreview.body?.value === null &&
    legacyPreview.body?.barrier === 'LIVE_EXECUTION_NOT_IMPLEMENTED' &&
    legacyPreview.body?.missingAuthorities?.includes?.('CANONICAL_EXECUTION_TICKET') &&
    legacyPreview.body?.risk === undefined &&
    JSON.stringify(previewIntentsAfter) === JSON.stringify(previewIntentsBefore) &&
    JSON.stringify(previewDecisionsAfter) === JSON.stringify(previewDecisionsBefore)
);

const send = await post('/api/trade/send', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10, confirmSymbol: 'BTCUSDT' });
check(
  'live send is retired independently of ambient credentials',
  send.status === 410 && send.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
);
const testOrder = await post('/api/trade/test', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQty: 10 });
check(
  'signed test-order route is retired',
  testOrder.status === 410 && testOrder.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED'
);

// Legacy config is display-only. Operational policy belongs to canonical
// revisioned controls and cannot mutate through this compatibility route.
const cfgBeforeOperationalBypass = (await get('/api/config')).body;
const operationalConfig = await post('/api/config', { maxOrderNotionalUsd: 15 });
const cfg = (await get('/api/config')).body;
check(
  'legacy config rejects operational policy with zero side effect',
  operationalConfig.status === 409 &&
    operationalConfig.body?.code === 'CONTROL_PREVIEW_REQUIRED' &&
    operationalConfig.body?.fields?.includes?.('maxOrderNotionalUsd') &&
    JSON.stringify(cfg) === JSON.stringify(cfgBeforeOperationalBypass)
);

const hostileConfig = await post('/api/config', {
  liveTradingEnabled: true,
  fundsLocked: false,
  borrowGuard: { enabled: false, newBorrowPaused: false, repayOnly: false },
  controlModes: { funds: 'allowed', borrowing: 'allowed', liveOrders: 'allowed' },
});
check(
  'config arming request is owner-gated before any legacy mutation',
  hostileConfig.status === 409 &&
    hostileConfig.body?.code === 'CONTROL_PREVIEW_REQUIRED' &&
    hostileConfig.body?.fields?.includes?.('controlModes') &&
    JSON.stringify((await get('/api/config')).body) === JSON.stringify(cfgBeforeOperationalBypass)
);
const safeConfig = await post('/api/config', {
  controlModes: { funds: 'blocked', borrowing: 'blocked', automation: 'paused', liveOrders: 'blocked' },
});
check(
  'even risk-reducing operational config requires canonical preview and receipt',
  safeConfig.status === 409 && safeConfig.body?.code === 'CONTROL_PREVIEW_REQUIRED'
);
const displayConfig = await post('/api/config', { watchlist: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] });
check(
  'non-operational display watchlist remains writable and bounded',
  displayConfig.status === 200 && displayConfig.body?.watchlist?.includes?.('SOLUSDT')
);

const legacyKillConfigBefore = (await get('/api/config')).body;
const legacyKillEventsBefore = (await get('/api/events?kind=manual_action&limit=10')).body;
const retiredKillOff = await post('/api/kill', { on: false });
const retiredKillOn = await post('/api/kill', { on: true });
const legacyKillConfigAfter = (await get('/api/config')).body;
const legacyKillEventsAfter = (await get('/api/events?kind=manual_action&limit=10')).body;
check(
  'legacy kill is a retired zero-side-effect tombstone pointing at the canonical Product lifecycle',
  [retiredKillOff, retiredKillOn].every((response) => (
    response.status === 410 &&
    response.body?.code === 'RETIRED' &&
    response.body?.state === 'RETIRED' &&
    response.body?.canonicalPreviewEndpoint === '/api/product-integration/v1/commands/preview' &&
    response.body?.canonicalCommandEndpoint === '/api/product-integration/v1/commands' &&
    response.body?.supportedCanonicalAction === 'KILL_SWITCH_ENGAGE_ONLY'
  )) &&
    JSON.stringify(legacyKillConfigAfter) === JSON.stringify(legacyKillConfigBefore) &&
    JSON.stringify(legacyKillEventsAfter) === JSON.stringify(legacyKillEventsBefore)
);
const healthBeforeLiveArm = (await get('/api/health')).body;
const liveArm = await post('/api/live', { on: true });
const healthAfterLiveArm = (await get('/api/health')).body;
check('direct live arm is retired', liveArm.status === 410 && liveArm.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED');
check(
  'failed live arm preserves prior compatibility mode and leaves live orders blocked',
  healthAfterLiveArm.mode === healthBeforeLiveArm.mode &&
    (await get('/api/config')).body?.controlModes?.liveOrders === 'blocked'
);

// The remaining display-only configuration path must remain auditable.
const cfgEv = (await get('/api/events?kind=display_config_change&limit=10')).body;
check('ledger records display configuration changes', Array.isArray(cfgEv) && cfgEv.length >= 1);

// remaining API surface renders data
check('fills endpoint responds', Array.isArray((await get('/api/fills')).body));
const pnlResponse = await get('/api/pnl');
check(
  'keyless PnL is explicitly NOT_CONFIGURED and cannot publish empty complete evidence',
  pnlResponse.status === 503 &&
    pnlResponse.body?.code === 'NOT_CONFIGURED' &&
    pnlResponse.body?.truthState === 'UNAVAILABLE' &&
    pnlResponse.body?.realizedByDay === null &&
    pnlResponse.body?.realizedBySymbol === null &&
    pnlResponse.body?.feesByAsset === null &&
    pnlResponse.body?.equitySnapshots === null &&
    pnlResponse.body?.integrity === null
);
const signals = (await get('/api/signals')).body;
check(
  'signals endpoint keeps historical Ledger reads while active legacy proposals stay retired',
  signals?.legacyScannerState === 'RETIRED' &&
    Array.isArray(signals?.active) &&
    signals.active.length === 0 &&
    Array.isArray(signals?.recent)
);

const marketsResponse = await get('/api/markets');
const mkts = marketsResponse.body;
check(
  'markets endpoint reports unavailable public sources without fabricating universe rows',
  marketsResponse.status === 200 &&
    mkts?.dataSources?.spotBookTicker === 'unavailable' &&
    mkts?.dataSources?.futuresBookTicker === 'unavailable' &&
    mkts?.dataSources?.futures24hTicker === 'unavailable' &&
    Array.isArray(mkts?.rows) &&
    mkts.rows.length === 0
);
check('retired legacy scanner cannot publish compatibility market rows without source truth', mkts?.rows?.length === 0);

const detailResponse = await get('/api/market/detail?symbol=BTCUSDT');
const detail = detailResponse.body;
check(
  'market detail keeps unavailable public facts null',
  detailResponse.status === 200 &&
    detail?.row === null &&
    detail?.book === null &&
    detail?.filters === null &&
    detail?.last === null &&
    detail?.change24hPct === null
);

const walletBalanceResponse = await get('/api/wallet-balances');
const equityHistoryResponse = await get('/api/equity-history');
const earnResponse = await get('/api/earn');
check(
  'wallet balance aggregate is never browser/proxy cached',
  /private/i.test(walletBalanceResponse.headers.get('cache-control') ?? '')
    && /no-store/i.test(walletBalanceResponse.headers.get('cache-control') ?? '')
);
check(
  'unconfigured balance and holding routes publish null UNAVAILABLE truth, never empty rows',
  [walletBalanceResponse, equityHistoryResponse, earnResponse].every((response) => (
    response.status === 503 &&
    response.body?.code === 'NOT_CONFIGURED' &&
    response.body?.truthState === 'UNAVAILABLE' &&
    response.body?.rows === null &&
    response.body?.value === null
  ))
);

const privateReadResponses = [
  await post('/api/fills/import', { symbol: 'BTCUSDT' }),
  equityHistoryResponse,
  earnResponse,
  walletBalanceResponse,
  pnlResponse,
  await get('/api/loans'),
  await post('/api/loans/refresh', {}),
  await get('/api/orders/history?symbol=BTCUSDT'),
  await get('/api/loans/max-borrowable?asset=BTC'),
  await post('/api/refresh', { target: 'account' }),
  await get('/api/apikey'),
];
check(
  'all private/account compatibility routes are statically NOT_CONFIGURED',
  privateReadResponses.every((response) => response.status === 503 && response.body?.code === 'NOT_CONFIGURED' && response.body?.available === false)
);

const retiredMoneyResponses = [
  await post('/api/loans/reconcile', { confirm: 'RECONCILE' }),
  await post('/api/loans/borrow', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, confirmCoin: 'BTC' }),
  await post('/api/loans/adjust-ltv', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, direction: 'ADDITIONAL', confirmCoin: 'BTC' }),
  await post('/api/loans/repay', { loanCoin: 'BTC', collateralCoin: 'USDT', amount: 1, confirmCoin: 'BTC' }),
  await post('/api/orders/cancel', { symbol: 'BTCUSDT', orderId: 1 }),
  await post('/api/orders/cancel-all', { symbol: 'BTCUSDT' }),
  await post('/api/orders/recovery/resolve', { action: 'hold' }),
];
check(
  'all loan/order money and recovery mutations are deterministically retired',
  retiredMoneyResponses.every((response) => response.status === 410 && response.body?.code === 'LIVE_EXECUTION_NOT_IMPLEMENTED')
);
check('local order-recovery evidence remains read-only', (await get('/api/orders/recovery')).status === 200);

const unavailablePublicResponses = [
  await get('/api/market/depth?symbol=BTCUSDT'),
  await get('/api/market/trades?symbol=BTCUSDT'),
  await get('/api/klines?symbol=BTCUSDT&interval=5m&limit=50&market=futures'),
  await get('/api/funding/history?symbol=BTCUSDT'),
];
check(
  'public depth, trades, futures klines, and funding routes fail closed at the deterministic network boundary',
  unavailablePublicResponses.every((response) => (
    response.status === 502 &&
    typeof response.body?.error === 'string' &&
    /unavailable/i.test(response.body.error) &&
    !/https?:\/\//i.test(response.body.error)
  ))
);

const browserReachableUnavailableResponses = [
  await get('/api/token/moneyflow?symbol=BTCUSDT&window=15m'),
  await get('/api/token/profile?base=BTC'),
  await get('/api/news?catalog=all'),
  await get('/api/news-context?limit=220'),
  await get('/api/news-stream?limit=220'),
  await get('/api/calendar'),
  await get('/api/fx'),
  await get('/api/source-logo?domain=binance.com&sz=64'),
  await post('/api/token/profiles/warm', {}),
  await post('/api/news-context/refresh', { limit: 220 }),
  await post('/api/refresh', { target: 'news' }),
];
check(
  'browser-reachable public owners fail closed before deterministic-test egress',
  browserReachableUnavailableResponses.every((response) => (
    response.status >= 500 &&
    response.status < 600 &&
    typeof response.body?.error === 'string' &&
    /unavailable/i.test(response.body.error) &&
    !/https?:\/\//i.test(response.body.error)
  ))
);

const fundX = (await get('/api/funding/extremes')).body;
check(
  'funding extremes cannot fabricate rows without public source truth',
  Array.isArray(fundX?.positive) && fundX.positive.length === 0 &&
    Array.isArray(fundX?.negative) && fundX.negative.length === 0
);

const sctx = (await get('/api/symbol/context?symbol=BTCUSDT')).body;
check('symbol context responds', Array.isArray(sctx?.fills) && Array.isArray(sctx?.signals));
check(
  'symbol context keeps unconfigured balances and private orders null instead of fabricating zero',
  sctx?.accountTruthState === 'NOT_CONFIGURED' &&
    sctx?.orderTruthState === 'NOT_CONFIGURED' &&
    sctx?.balances === null &&
    sctx?.openOrders === null
);

const sys = (await get('/api/system')).body;
check('system health responds', sys?.ok === true && typeof sys.uptimeSec === 'number' && sys.dbOk === true);
check(
  'legacy system is transport-only compatibility with one canonical supervisor snapshot',
  sys?.schemaVersion === 'legacy.system.compatibility.v2' &&
    sys?.healthClass === 'LEGACY_OBSERVABILITY_COMPATIBILITY' &&
    sys?.readinessSemantics === 'NOT_EVALUATED' &&
    sys?.okSemantics === 'TRANSPORT_ONLY' &&
    sys?.canonicalReadinessEndpoint === '/health/ready' &&
    sys?.canonicalSupervisorEndpoint === '/api/system-integration/supervisor' &&
    typeof sys?.canonicalSupervisor?.evaluatedAtMs === 'number' &&
    sys?.killSwitch === (sys?.canonicalSupervisor?.control?.killSwitchEngaged || legacyKillConfigAfter?.killSwitch === true)
);
check('system health exposes RETIRED legacy scanner state without tick evidence', sys?.legacyScannerState === 'RETIRED' && sys?.lastScannerTickTs === null);
const browserObservation = await post('/api/connections/browser-observation', { rttMs: 24, socketConnected: true });
check('browser connection observation is sanitized and accepted', browserObservation.status === 200 && browserObservation.body?.observation?.status === 'operational');
check(
  'connection inventory exposes live, cached, and planned source truth',
    typeof sys?.connections?.basis?.running === 'boolean' &&
    typeof sys?.connections?.volume?.streamConnections === 'number' &&
    sys?.connections?.liquidations?.running === false &&
    sys?.connections?.liquidations?.state === 'down' &&
    typeof sys?.connections?.news?.sources === 'number' &&
    typeof sys?.connections?.calendar?.items === 'number' &&
    typeof sys?.connections?.fx?.currencies === 'number' &&
    typeof sys?.connections?.watchman?.summary?.required === 'number' &&
    Array.isArray(sys?.connections?.watchman?.components) &&
    sys.connections.watchman.components.some((component) => (
      component.id === 'market-streams' &&
      component.resetTarget === 'market' &&
      component.status !== 'operational' &&
      /liquidation down/.test(component.detail ?? '')
    )) &&
    sys.connections.watchman.components.some((component) => component.id === 'user-stream' && component.status === 'planned' && /NOT_CONFIGURED/.test(component.detail ?? '')) &&
    sys.connections.watchman.components.some((component) => component.id === 'aws-runner' && component.status === 'planned') &&
    sys?.connections?.planned?.awsRunner?.configured === false &&
    sys?.connections?.planned?.awsRunner?.state === 'owner_gated' &&
    typeof sys?.connections?.planned?.cloudflareAccess?.reason === 'string'
);

const notificationRouting = (await get('/api/notification-routing')).body;
check(
  'notification routing exposes real source and destination readiness',
  notificationRouting?.sources?.bot?.available === true &&
    notificationRouting?.sources?.execution?.available === false &&
    notificationRouting?.sources?.aws?.available === false &&
    notificationRouting?.destinations?.inApp?.available === true &&
    notificationRouting?.destinations?.telegram?.available === false
);
const awsNotificationResponse = await request('/api/notifications/ingest/aws', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer sentinel-aws-notification-token-not-a-secret',
  },
  body: JSON.stringify({
    source: 'aws.ec2',
    'detail-type': 'EC2 Instance State-change Notification',
    detail: { state: 'stopped' },
  }),
});
const awsNotificationClosed = {
  status: awsNotificationResponse.status,
  body: await awsNotificationResponse.json().catch(() => null),
};
check(
  'AWS notification intake remains OWNER_GATED despite a matching hostile ambient token',
  awsNotificationClosed.status === 503 &&
    awsNotificationClosed.body?.code === 'OWNER_GATED' &&
    awsNotificationClosed.body?.available === false
);

const awsStatus = await awsControl('/api/aws-control/status');
const awsProbe = await awsControl('/api/aws-control/status?probe=1');
const awsOwnerGated = [
  awsStatus,
  awsProbe,
  await post('/api/aws-control/gates', { connectionEnabled: true }),
  await awsControl('/api/aws-control/gates', { method: 'POST', body: { connectionEnabled: true, executionEnabled: true } }),
  await awsControl('/api/aws-control/command', { method: 'POST', body: { command: 'restart' } }),
  await awsControl('/api/aws-control/runner'),
  await awsControl('/api/aws-control/runner', { method: 'PUT', body: { content: 'sentinel', expectedSha256: null } }),
];
check(
  'all AWS status, probe, command, gate, and runner surfaces remain OWNER_GATED',
  awsOwnerGated.every((response) => response.status === 503 && response.body?.code === 'OWNER_GATED' && response.body?.available === false)
);
check('AWS probe cannot change behavior or contact AWS', JSON.stringify(awsProbe.body) === JSON.stringify(awsStatus.body));

const evSearch = (await get('/api/events?kind=manual_action&q=kill')).body;
check('ledger search works', Array.isArray(evSearch));

const secRes = await request('/api/health');
check(
  'security headers set (CSP, nosniff, frame, referrer)',
  (secRes.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'") &&
    secRes.headers.get('x-content-type-options') === 'nosniff' &&
    secRes.headers.get('x-frame-options') === 'DENY' &&
    secRes.headers.get('referrer-policy') === 'no-referrer'
);

const volumeKlinesResponse = await get('/api/klines?symbol=BTCUSDT&interval=5m&limit=50&field=volume');
check(
  'volume klines fail closed without external source truth',
  volumeKlinesResponse.status === 502 &&
    /unavailable/i.test(volumeKlinesResponse.body?.error ?? '') &&
    !/https?:\/\//i.test(volumeKlinesResponse.body?.error ?? '')
);

const volumeRuntime = (await get('/api/engine/volume')).body;
check(
  'volume runtime endpoint exposes status and rows',
  typeof volumeRuntime?.status?.running === 'boolean' && Array.isArray(volumeRuntime?.rows)
);

const basisRuntime = (await get('/api/engine/basis')).body;
check(
  'basis runtime exposes crossed-book decisions and borrow truth',
  typeof basisRuntime?.status?.running === 'boolean' &&
    Array.isArray(basisRuntime?.rows) &&
    basisRuntime?.status?.verifiedBorrow === 0 &&
    typeof basisRuntime?.thresholds?.watchGapPct === 'number'
);

const iconsRes = await request('/api/icons?bases=BTC,ETH,TLM,BREV');
const iconsBody = await iconsRes.json().catch(() => null);
check('icon manifest endpoint responds', iconsRes.status === 200 && iconsBody !== null && typeof iconsBody === 'object');
check(
  'CSP allows only the server-resolved token image owner, not retired client fallback CDNs',
  (secRes.headers.get('content-security-policy') ?? '').includes('coingecko.com') &&
    !(secRes.headers.get('content-security-policy') ?? '').includes('coincap.io') &&
    !(secRes.headers.get('content-security-policy') ?? '').includes('cdn.jsdelivr.net')
);

const gateExit = await stopChild(child);
check(
  'deterministic application gate child exits cleanly after its complete lifetime',
  gateExit.code === 0 && gateExit.signal === null,
  `code=${String(gateExit.code)} signal=${String(gateExit.signal)}`,
);
const blockedPrivateEgress = existsSync(privateEgressSentinel)
  ? readFileSync(privateEgressSentinel, 'utf8').trim().split('\n').filter(Boolean)
  : [];
check(
  'hostile ambient Binance and AWS credentials generated zero prohibited egress over the complete child lifetime',
  blockedPrivateEgress.length === 0,
  `${blockedPrivateEgress.length} prohibited attempts: ${blockedPrivateEgress.slice(0, 8).join(', ')}`,
);
const blockedPublicEgress = existsSync(networkEgressSentinel)
  ? readFileSync(networkEgressSentinel, 'utf8').trim().split('\n').filter(Boolean)
  : [];
check(
  'deterministic application gates attempt zero external public network calls over the complete child lifetime',
  blockedPublicEgress.length === 0,
  `${blockedPublicEgress.length} prohibited attempts: ${blockedPublicEgress.slice(0, 8).join(', ')}`
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}
} finally {
  await stopChild(child).catch((error) => {
    console.error(`failed to stop gate server: ${error.message}`);
    process.exitCode = 1;
  });
  rmSync(dataDir, { recursive: true, force: true });
}
