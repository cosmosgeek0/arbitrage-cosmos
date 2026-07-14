import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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

test('the shared store exposes validate-only preview but no legacy execution capability', async () => {
  const store = await read('store.tsx');
  assert.match(store, /preview:\s*\(intent:/);
  assert.match(store, /\/api\/trade\/preview/);
  for (const capability of ['setLive', 'testOrder', 'sendLive', 'cancelOrder', 'cancelAll', 'importFills', 'approveProposal']) {
    assert.doesNotMatch(store, new RegExp(`\\b${capability}\\b`));
  }
  assert.doesNotMatch(store, /['"]LIVE_ARMED['"]/);
});

test('mounted legacy pages cannot claim armed execution or configured private account truth', async () => {
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
  assert.match(await read('pages/SystemHealth.tsx'), /NOT_CONFIGURED|Not Configured/);
});

test('header keeps canonical Product truth and structurally omits legacy and AWS actions', async () => {
  const header = await read('components/Header.tsx');
  assert.match(header, /useProductControlRoomContext/);
  assert.match(header, /No signed, test-order, private, or money-moving port exists in this slice/);
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

test('account recovery and notification routing cannot reintroduce private or AWS green state', async () => {
  const [header, notifications, store] = await Promise.all([
    read('components/Header.tsx'),
    read('pages/NotificationsPage.tsx'),
    read('store.tsx'),
  ]);
  assert.doesNotMatch(header, /target:\s*['"]account['"]/);
  assert.doesNotMatch(header, /Signed Account/);
  assert.match(store, /\/api\/refresh', \{ target: 'market' \}/);
  assert.doesNotMatch(store, /\/api\/refresh', \{ target: 'all' \}/);
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
