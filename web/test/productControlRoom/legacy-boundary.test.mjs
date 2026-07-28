import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { failClosedState } from '../../src/store.tsx';

const SOURCE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));

async function read(relativePath) {
  return readFile(join(SOURCE_ROOT, relativePath), 'utf8');
}

async function sourceInventory(directory = SOURCE_ROOT) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await sourceInventory(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      rows.push({ path: relative(SOURCE_ROOT, absolute), source: await readFile(absolute, 'utf8') });
    }
  }
  return rows;
}

test('the web source tree contains no legacy private, money-moving, cancel, or AWS control endpoint', async () => {
  const inventory = await sourceInventory();
  const forbidden = [
    '/api/live',
    '/api/trade/test',
    '/api/trade/send',
    '/api/trade/preview',
    '/api/kill',
    '/api/orders/cancel',
    '/api/orders/cancel-all',
    '/api/orders/history',
    '/api/fills/import',
    '/api/wallet-balances',
    '/api/earn',
    '/api/loans',
    '/api/equity-history',
    '/api/apikey',
    '/api/aws-control',
    'console.aws.amazon.com',
  ];

  for (const { path, source } of inventory) {
    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${path} retains forbidden web capability ${token}`);
    }
  }
});

test('the bounded private-account cadence adds no browser transport, credential, or permission mutation', async () => {
  const store = await read('store.tsx');
  const surfaces = await Promise.all([
    read('pages/Account.tsx'),
    read('pages/Dashboard.tsx'),
    read('pages/Loans.tsx'),
    read('pages/SystemHealth.tsx'),
  ]);
  const combined = surfaces.join('\n');

  // The cadence rides the existing state read; the fallback remains the only
  // other private endpoint, and neither surface fetches private truth itself.
  const privateEndpoints = [...store.matchAll(/'(\/api\/[a-z-]+)'/g)]
    .map(([, endpoint]) => endpoint)
    .filter((endpoint) => endpoint === '/api/state' || endpoint === '/api/private-account');
  assert.deepEqual(new Set(privateEndpoints), new Set(['/api/state', '/api/private-account']));
  assert.equal(privateEndpoints.filter((endpoint) => endpoint === '/api/private-account').length, 1);
  assert.doesNotMatch(combined, /fetchJson[^;]*\/api\/(?:state|private-account)/);

  // No permission or key mutation may enter through the private-read path.
  for (const token of ['apiRestrictions', 'apiSecret', 'secretKey', 'X-MBX-APIKEY', 'enableWithdrawals']) {
    assert.equal(store.includes(token), false, `store retains credential-adjacent token ${token}`);
    assert.equal(combined.includes(token), false, `a private surface retains credential-adjacent token ${token}`);
  }
  assert.doesNotMatch(combined, /<button[^>]*>\s*(?:Rotate Key|Edit Permissions|Enable Trading)/i);
  assert.match(store, /method: 'POST'/);
  assert.equal((store.match(/method: 'POST'/g) ?? []).length, 1, 'config is the only browser write path');
});

test('automatic token rendering uses only same-origin owners and deterministic local fallbacks', async () => {
  const [detail, icon] = await Promise.all([
    read('pages/TokenDetail.tsx'),
    read('components/TokenIcon.tsx'),
  ]);
  assert.doesNotMatch(detail, /new\s+WebSocket|wss:\/\//);
  assert.doesNotMatch(icon, /cdn\.jsdelivr\.net|assets\.coincap\.io/);
  assert.match(icon, /const\s+chain\s*=\s*\[resolved\]\.filter\(Boolean\)/);
  assert.match(detail, /same-origin public-source owner/);
});

test('TokenDetail retains one derivatives owner without dead alternate panels', async () => {
  const detail = await read('pages/TokenDetail.tsx');

  assert.doesNotMatch(detail, /\b(?:function\s+(?:CgxPanel|BasisCard|ProfilePanel)|type\s+CgxTab|interface\s+CgxPoint)\b/);
  assert.doesNotMatch(detail, /\bfetch\(`\/api\/(?:candles|futures)\//);
  assert.doesNotMatch(detail, /import\s*\{[^}]*\bCopy\b/);
  assert.match(detail, /function\s+DerivativesIntelligence\b/);
  assert.match(detail, /<DerivativesIntelligence\b/);
});

test('the shared store structurally omits legacy preview and execution capabilities', async () => {
  const store = await read('store.tsx');
  assert.doesNotMatch(store, /preview:\s*\(intent:/);
  assert.doesNotMatch(store, /\/api\/trade\/preview/);
  for (const capability of ['setLive', 'testOrder', 'sendLive', 'cancelOrder', 'cancelAll', 'importFills', 'approveProposal']) {
    assert.doesNotMatch(store, new RegExp(`\\b${capability}\\b`));
  }
  assert.doesNotMatch(store, /['"]LIVE_ARMED['"]/);
});

test('mounted pages cannot claim armed execution while authorized private reads stay facts-only', async () => {
  const paths = [
    'pages/Account.tsx',
    'pages/Dashboard.tsx',
    'pages/Loans.tsx',
    'pages/NotificationsPage.tsx',
    'pages/Risk.tsx',
    'pages/SystemHealth.tsx',
  ];
  const combined = (await Promise.all(paths.map(read))).join('\n');

  for (const claim of [
    'Legacy Live Armed',
    'Legacy Live Configured',
    'Risk-gated live routing',
    'Live routing is armed',
    'Money actions are available',
    'Signed Read Sources',
    'Polling Fallback',
    'Policy Open',
  ]) {
    assert.equal(combined.includes(claim), false, `mounted UI retains false claim: ${claim}`);
  }
  assert.doesNotMatch(combined, /['"]LIVE_ARMED['"]/);
  assert.match(await read('pages/Account.tsx'), /NOT_CONFIGURED|Not Configured/);
  assert.match(await read('pages/Loans.tsx'), /OWNER_GATED|Owner Gated/);
  assert.match(await read('pages/SystemHealth.tsx'), /projectPrivateRead/);
});

test('header keeps canonical Product truth and structurally omits legacy and AWS actions', async () => {
  const header = await read('components/Header.tsx');
  assert.match(header, /useProductControlRoomContext/);
  assert.match(header, /No signed mutation, test-order, or money-moving port exists; GET-only private-read posture is/);
  assert.match(header, /Live Execution/);
  assert.match(header, /Blocked/);
  assert.match(header, /killSwitchControl\?\.wiringState === 'WIRED_LIVE'/);
  assert.match(header, /productBinding\.continuity === 'PROVEN'/);
  for (const token of [
    'AwsRunnerModal',
    'fetchAwsRunnerStatus',
    'updateAwsRunnerGate',
    'Runner Workspace',
    'AWS Console',
    'AWS Channel',
    'Runner Changes',
    'setLive',
    'runLiveMutation',
    'setNewLoans',
    'setFundsAccess',
  ]) {
    assert.equal(header.includes(token), false, `Header retains retired action ${token}`);
  }
});

test('Header retains one mounted topbar content implementation', async () => {
  const header = await read('components/Header.tsx');

  assert.doesNotMatch(header, /\bconst\s+content\s*=\s*\(k:\s*MK\)/);
  assert.doesNotMatch(header, /\bconst\s+contentClean\s*=\s*\(k:\s*MK\)/);
  assert.doesNotMatch(header, /\b(?:function\s+TopPanelHeader|const\s+(?:TbpCheck|IconDollar))\b/);
  assert.match(header, /const\s+premiumContent\s*=\s*\(k:\s*MK\)/);
  assert.equal(header.match(/premiumContent\((?:outgoingContent|contentActive)\)/g)?.length, 2);
});

test('account recovery and notification routing cannot reintroduce mutation or AWS authority', async () => {
  const [header, notifications, store] = await Promise.all([
    read('components/Header.tsx'),
    read('pages/NotificationsPage.tsx'),
    read('store.tsx'),
  ]);
  assert.doesNotMatch(header, /target:\s*['"]account['"]/);
  assert.doesNotMatch(header, /Signed Account/);
  assert.doesNotMatch(store, /(?:post|fetch)(?:<[^>]+>)?\('\/api\/refresh'/);
  assert.doesNotMatch(store, /binanceConnected\??:|keysPresent\??:/);
  assert.doesNotMatch(notifications, /execution:\s*\{\s*available:\s*true/);
  assert.doesNotMatch(notifications, /aws:\s*\{\s*available:\s*true/);
  assert.doesNotMatch(notifications, /awsSns:\s*\{\s*available:\s*true/);
});

test('shared ledger summaries declassify legacy money and private-account events', async () => {
  const eventText = await read('lib/eventText.ts');
  for (const falseCurrentClaim of [
    'Live trading ${d.on',
    'Signed test order',
    'Order sent to Binance',
    'Binance account connected',
  ]) {
    assert.equal(eventText.includes(falseCurrentClaim), false, `legacy summary retains current-sounding claim: ${falseCurrentClaim}`);
  }
  assert.match(eventText, /Historical legacy execution setting/);
  assert.match(eventText, /ignored by this candidate/);
  assert.match(eventText, /not current connection evidence/);
});

test('keyless and unavailable account payloads cannot become zero positions or orders in the shared store', () => {
  const config = {
    killSwitch: false,
    liveTradingEnabled: true,
    fundsLocked: false,
    automationPaused: false,
    controlModes: { funds: 'allowed', borrowing: 'allowed', automation: 'allowed', liveOrders: 'allowed' },
    borrowGuard: { enabled: false, newBorrowPaused: false, repayOnly: false },
  };
  const account = { totalUsdt: 0, availableUsdt: 0, entries: [] };
  const hostileKeyless = failClosedState({
    config,
    mode: 'MANUAL',
    binance: { keysPresent: false },
    privateAccountTruth: 'AVAILABLE',
    privateOrderTruth: 'AVAILABLE',
    account,
    positions: [],
    openOrders: [],
  });
  assert.equal(hostileKeyless.privateAccountTruth, 'NOT_CONFIGURED');
  assert.equal(hostileKeyless.privateOrderTruth, 'NOT_CONFIGURED');
  assert.equal(hostileKeyless.account, null);
  assert.equal(hostileKeyless.positions, null);
  assert.equal(hostileKeyless.openOrders, null);

  const keyOnlyWithoutReadback = failClosedState({
    config,
    mode: 'MANUAL',
    binance: { keysPresent: true },
    privateAccountTruth: 'AVAILABLE',
    privateOrderTruth: 'AVAILABLE',
    account: null,
    positions: [],
    openOrders: [],
  });
  assert.equal(keyOnlyWithoutReadback.privateAccountTruth, 'UNAVAILABLE');
  assert.equal(keyOnlyWithoutReadback.privateOrderTruth, 'UNAVAILABLE');
  assert.equal(keyOnlyWithoutReadback.account, null);
  assert.equal(keyOnlyWithoutReadback.positions, null);
  assert.equal(keyOnlyWithoutReadback.openOrders, null);

  const unavailable = failClosedState({
    config,
    mode: 'MANUAL',
    binance: { keysPresent: true },
    privateAccountTruth: 'UNAVAILABLE',
    privateOrderTruth: 'AVAILABLE',
    account,
    positions: [],
    openOrders: [],
  });
  assert.equal(unavailable.account, null);
  assert.equal(unavailable.privateOrderTruth, 'UNAVAILABLE');
  assert.equal(unavailable.positions, null);
  assert.equal(unavailable.openOrders, null);

  const orderUnavailable = failClosedState({
    config,
    mode: 'MANUAL',
    binance: { keysPresent: true },
    privateAccountTruth: 'AVAILABLE',
    privateOrderTruth: 'UNAVAILABLE',
    account,
    positions: [],
    openOrders: [],
  });
  assert.equal(orderUnavailable.account, account);
  assert.deepEqual(orderUnavailable.positions, []);
  assert.equal(orderUnavailable.openOrders, null);

  const configuredZero = failClosedState({
    config,
    mode: 'MANUAL',
    binance: { keysPresent: true },
    privateAccountTruth: 'AVAILABLE',
    privateOrderTruth: 'AVAILABLE',
    account,
    positions: [],
    openOrders: [],
  });
  assert.equal(configuredZero.privateAccountTruth, 'AVAILABLE');
  assert.deepEqual(configuredZero.positions, []);
  assert.deepEqual(configuredZero.openOrders, []);
  assert.equal(configuredZero.account, account);
});

test('legacy liveness and PnL surfaces cannot imply semantic readiness or validated zero', async () => {
  const [header, dashboard, pnl, account, types] = await Promise.all([
    read('components/Header.tsx'),
    read('pages/Dashboard.tsx'),
    read('pages/Pnl.tsx'),
    read('pages/Account.tsx'),
    read('types.ts'),
  ]);
  assert.match(header, /fetchJson<unknown>\('\/health\/live'/);
  assert.doesNotMatch(header, /fetch\('\/api\/health'/);
  assert.match(header, /direct \/health\/live liveness round trip/);
  assert.match(types, /positions:\s*PositionEntry\[\]\s*\|\s*null/);
  assert.match(types, /openOrders:\s*OpenOrderRow\[\]\s*\|\s*null/);
  assert.match(account, /const openOrders = \[/);
  assert.match(account, /privateRead\.spot\.openOrders/);
  assert.doesNotMatch(account, /fetchJson<FillRow\[\]>\('\/api\/fills'/);
  assert.match(dashboard, /pnlTruthState === 'UNKNOWN' \? 'Strategy Performance Unavailable'/);
  assert.match(dashboard, /unavailable private\/account truth is not converted into validated zero PnL/);
  assert.match(pnl, /setData\(null\)/);
  assert.match(pnl, /data !== null && data\.integrity\.state !== 'UNKNOWN'/);
  assert.match(pnl, /does not convert an unavailable durable outcome read into a zero-PnL claim/);
});

test('internal cockpit consumers use the Product provider instead of the system compatibility route', async () => {
  const paths = [
    'components/Header.tsx',
    'pages/Dashboard.tsx',
    'pages/SystemHealth.tsx',
  ];
  for (const path of paths) {
    const source = await read(path);
    assert.doesNotMatch(source, /\/api\/system(?!-integration)/, `${path} consumes the legacy system compatibility route`);
    assert.match(source, /useProductControlRoomContext/, `${path} does not consume the shared Product provider`);
  }
  const health = await read('pages/SystemHealth.tsx');
  assert.match(health, /ownerView\.machineReady/);
  assert.match(health, /<ProductSurfaceAdapter surfaceId="health" \/>/);
  assert.doesNotMatch(health, /latencyState|driftState|feedState|worstState/);
});

test('retired legacy scanner renders as an idle read-only tombstone across shared surfaces', async () => {
  const [opportunities, header, health, types] = await Promise.all([
    read('pages/Opportunities.tsx'),
    read('components/Header.tsx'),
    read('pages/SystemHealth.tsx'),
    read('types.ts'),
  ]);

  assert.match(types, /state:\s*'RETIRED'/);
  assert.match(opportunities, /Legacy Scanner Retired/);
  assert.match(opportunities, /No new legacy proposals or mutations are accepted/);
  assert.match(opportunities, /Basis and Volume own strategy decisions/);
  assert.match(opportunities, /className="opportunityx-live idle"/);
  assert.doesNotMatch(opportunities, /\/api\/proposals\//);
  assert.doesNotMatch(opportunities, /Confirm Dismiss|>Dismiss<|approveProposal|reject\s*=|pendingDismiss/);
  assert.doesNotMatch(opportunities, /opportunityx-live ['"]\s*\+|opportunityx-live active/);

  assert.doesNotMatch(header, /legacyScannerState|lastScannerTickTs|Pairs scanned/);
  assert.doesNotMatch(health, /legacyScannerState|lastScannerTickTs|latest scanner tick|Scanner ticks exist|scanner proposals/);
});
