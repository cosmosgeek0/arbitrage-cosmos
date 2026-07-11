#!/usr/bin/env node
/**
 * Focused storage/config/AWS control regressions. No network access is used.
 * Run after the server build:
 *   node server/test/storage-aws-hardening.mjs
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULTS, loadConfig, normalizeConfig, saveConfig } from '../dist/config.js';
import { Ledger } from '../dist/ledger.js';
import { AccountService } from '../dist/services/account.js';
import { AwsRunnerControl, AwsRunnerControlError } from '../dist/services/awsRunnerControl.js';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`  ${pass ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

console.log('\nStorage/config/AWS hardening regressions:');

// Persisted control state must not become permissive through JavaScript
// coercion, NaN/Infinity, fractional counters, or malformed list elements.
{
  const normalized = normalizeConfig({
    killSwitch: 'false',
    liveTradingEnabled: 'true',
    fundsLocked: 'false',
    automationPaused: 'false',
    controlModes: { funds: 'allowed', borrowing: 'allowed', automation: 'allowed', liveOrders: 'allowed' },
    feesPct: Infinity,
    persistTicks: 1.5,
    maxOpenOrders: NaN,
    maxOrderNotionalUsd: -1,
    allowedSymbols: ['BTCUSDT', '../BAD'],
    blockedSymbols: 'ETHUSDT',
    borrowGuard: {
      enabled: 'false',
      newBorrowPaused: 'false',
      repayOnly: 'false',
      maxLtvPct: 101,
      maxAprPct: Infinity,
      requireLiveCatalog: 0,
      allowedCollateralCoins: ['USDT', '../BAD'],
      blockedLoanCoins: null,
    },
  });
  check(
    'malformed safety booleans fail closed',
    normalized.killSwitch === true
      && normalized.liveTradingEnabled === false
      && normalized.fundsLocked === true
      && normalized.automationPaused === true,
  );
  check(
    'invalid modes, limits, and symbol arrays use bounded defaults',
    normalized.controlModes.funds === 'blocked'
      && normalized.controlModes.liveOrders === 'paused'
      && normalized.persistTicks === DEFAULTS.persistTicks
      && normalized.maxOpenOrders === DEFAULTS.maxOpenOrders
      && normalized.allowedSymbols.length === 0,
  );
  check(
    'malformed borrow guard stays repay-only and catalog-backed',
    normalized.borrowGuard.enabled
      && normalized.borrowGuard.newBorrowPaused
      && normalized.borrowGuard.repayOnly
      && normalized.borrowGuard.requireLiveCatalog
      && normalized.controlModes.borrowing === 'blocked',
  );
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'cosmos-storage-hardening-'));
const ledger = new Ledger(dataDir);
try {
  ledger.setConfigValue('app', '{not valid json');
  check('corrupt saved config returns halted defaults', loadConfig(ledger).killSwitch === true && loadConfig(ledger).liveTradingEnabled === false);

  const candidate = structuredClone(DEFAULTS);
  candidate.killSwitch = false;
  candidate.liveTradingEnabled = true;
  candidate.controlModes.liveOrders = 'paused';
  saveConfig(ledger, candidate);
  check('save normalization keeps memory equal to durable state', candidate.liveTradingEnabled === false && loadConfig(ledger).liveTradingEnabled === false);
  check('config write includes a committed audit receipt', ledger.lastEvent('config_persisted')?.data?.key === 'app');

  ledger.setConfigValue('atomic-test', 'old');
  ledger.db.exec(`
    CREATE TRIGGER reject_atomic_audit
    BEFORE INSERT ON events WHEN NEW.kind = 'blocked_audit'
    BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;
  `);
  let transactionRejected = false;
  try {
    ledger.setConfigValueAndLogEvent('atomic-test', 'new', 'blocked_audit');
  } catch {
    transactionRejected = true;
  }
  ledger.db.exec('DROP TRIGGER reject_atomic_audit');
  check('config and audit roll back as one transaction', transactionRejected && ledger.getConfigValue('atomic-test') === 'old');

  const corrupt = ledger.db.prepare(
    'INSERT INTO events (ts, kind, symbol, data) VALUES (?, ?, ?, ?)',
  ).run(Date.now(), 'corrupt_json_test', null, '{broken');
  const corruptEvent = ledger.recentEvents(1, 'corrupt_json_test')[0];
  check(
    'corrupt event JSON is decoded safely',
    corruptEvent?.id === Number(corrupt.lastInsertRowid)
      && corruptEvent.data?.unavailable === true
      && corruptEvent.data?.reason === 'invalid_json',
  );

  ledger.logEvent('literal_search', null, { note: 'rate is 100%_ready' });
  ledger.logEvent('literal_search', null, { note: 'rate is 100XXready' });
  const literalMatches = ledger.recentEvents(100, 'literal_search', undefined, '%_');
  check('event LIKE metacharacters are treated literally', literalMatches.length === 1 && literalMatches[0].data?.note.includes('%_'));
  check('oversized event searches are rejected at the ledger boundary', ledger.recentEvents(100, undefined, undefined, 'x'.repeat(65)).length === 0);
  check('oversized result requests are bounded', ledger.recentEvents(999_999).length <= 100);

  const cursorAnchor = ledger.logEvent('cursor_anchor', null, { sequence: 0 }).id;
  const cursorIds = [];
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    cursorIds.push(ledger.logEvent('cursor_page', 'BTCUSDT', { sequence }).id);
  }
  const cursorPageOne = ledger.recentEvents(2, 'cursor_page', 'BTCUSDT', undefined, undefined, undefined, undefined, 0, cursorAnchor);
  const cursorPageTwo = ledger.recentEvents(2, 'cursor_page', 'BTCUSDT', undefined, undefined, undefined, undefined, 0, cursorPageOne.at(-1)?.id);
  const cursorPageThree = ledger.recentEvents(2, 'cursor_page', 'BTCUSDT', undefined, undefined, undefined, undefined, 0, cursorPageTwo.at(-1)?.id);
  const pagedIds = [...cursorPageOne, ...cursorPageTwo, ...cursorPageThree].map((event) => event.id);
  check(
    'afterId pagination is ascending, gap-free, and duplicate-free',
    JSON.stringify(pagedIds) === JSON.stringify(cursorIds)
      && new Set(pagedIds).size === cursorIds.length,
  );

  const paused = structuredClone(DEFAULTS);
  paused.fundsLocked = false;
  paused.automationPaused = false;
  paused.liveTradingEnabled = true;
  paused.borrowGuard.repayOnly = false;
  paused.borrowGuard.newBorrowPaused = false;
  paused.controlModes = { funds: 'paused', borrowing: 'paused', automation: 'paused', liveOrders: 'paused' };
  saveConfig(ledger, paused);
  const pausedRoundTrip = loadConfig(ledger);
  check(
    'explicit paused modes survive durable config normalization',
    Object.values(pausedRoundTrip.controlModes).every((value) => value === 'paused')
      && pausedRoundTrip.fundsLocked === true
      && pausedRoundTrip.automationPaused === true
      && pausedRoundTrip.liveTradingEnabled === false,
  );

  const retentionNow = Date.now();
  const insertEventAt = ledger.db.prepare('INSERT INTO events (ts, kind, symbol, data) VALUES (?, ?, ?, ?)');
  insertEventAt.run(retentionNow - 7 * 60 * 60_000, 'strategy_decision', null, '{}');
  insertEventAt.run(retentionNow - 25 * 60 * 60_000, 'heartbeat', null, '{}');
  insertEventAt.run(retentionNow - 8 * 24 * 60 * 60_000, 'candidate_opened', null, '{}');
  insertEventAt.run(retentionNow - 30 * 24 * 60 * 60_000, 'order_response', 'BTCUSDT', '{}');
  insertEventAt.run(retentionNow, 'strategy_decision', null, '{}');
  const pruned = ledger.pruneEphemeralEvents(retentionNow, 100);
  const oldEphemeral = ledger.db.prepare(`
    SELECT COUNT(*) AS count FROM events
    WHERE kind IN ('strategy_decision', 'heartbeat', 'candidate_opened') AND ts < ?
  `).get(retentionNow - 6 * 60 * 60_000).count;
  const financialAudit = ledger.db.prepare("SELECT COUNT(*) AS count FROM events WHERE kind = 'order_response'").get().count;
  const recentStrategy = ledger.db.prepare("SELECT COUNT(*) AS count FROM events WHERE kind = 'strategy_decision' AND ts = ?").get(retentionNow).count;
  check('ephemeral retention removes only expired recomputable telemetry', pruned === 3 && oldEphemeral === 0 && recentStrategy === 1);
  check('ephemeral retention never removes financial audit events', financialAudit === 1);

  const fillDayStart = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  const insertFill = ledger.db.prepare(`
    INSERT INTO fills
      (symbol, trade_id, order_id, side, price, qty, quote_qty, commission, commission_asset, ts, source)
    VALUES (?, ?, ?, 'BUY', 100, 1, 100, 0, 'USDT', ?, 'test')
  `);
  ledger.db.transaction(() => {
    for (let index = 0; index < 10_000; index += 1) {
      insertFill.run(`OLD${index % 200}USDT`, index, index, fillDayStart - 86_400_000 - (index % 1_000));
    }
    for (let index = 0; index < 100; index += 1) {
      insertFill.run('BTCUSDT', 20_000 + index, 20_000 + index, fillDayStart + index);
      insertFill.run('ETHUSDT', 30_000 + index, 30_000 + index, fillDayStart + index);
    }
  })();
  const currentDaySymbols = ledger.distinctFillSymbolsBetween(fillDayStart, fillDayStart + 86_400_000, 501);
  const originalAllFillsAsc = ledger.allFillsAsc;
  ledger.allFillsAsc = () => { throw new Error('startup must not load lifetime fills'); };
  let restoredSymbols = [];
  try {
    const account = new AccountService({ myTrades: async () => [] }, ledger, () => 1);
    restoredSymbols = account.fillReconciliationStatus().symbols;
  } finally {
    ledger.allFillsAsc = originalAllFillsAsc;
  }
  check(
    'fill-symbol discovery ignores a large historical ledger and loads current-day distinct symbols only',
    JSON.stringify(currentDaySymbols) === JSON.stringify(['BTCUSDT', 'ETHUSDT'])
      && JSON.stringify(restoredSymbols) === JSON.stringify(['BTCUSDT', 'ETHUSDT']),
  );

  const now = Date.now();
  for (let index = 0; index < 2_010; index += 1) {
    ledger.recordBrowserSessionActivity({
      id: `d_${String(index).padStart(5, '0')}`,
      ip: '127.0.0.1',
      country: null,
      system: 'macOS',
      browser: 'Test',
      device: 'Desktop',
      model: null,
      firstSeen: now + index,
      lastSeen: now + index,
      requests: 1,
    });
  }
  ledger.recordBrowserSessionActivity({
    id: 'invalid-session-id', ip: '127.0.0.1', country: null, system: 'x', browser: 'x',
    device: null, model: null, firstSeen: now, lastSeen: now, requests: 1,
  });
  const sessionCount = ledger.db.prepare('SELECT COUNT(*) AS count FROM browser_sessions').get().count;
  check('browser-session storage has a hard cardinality cap', sessionCount === 2_000);
  check('browser-session reads have a hard response cap', ledger.listBrowserSessions(0, 10_000).length === 100);

  const firstProbe = ledger.probeWritable(true);
  const actualDb = ledger.db;
  ledger.db = { open: true };
  const cachedProbe = ledger.probeWritable();
  ledger.db = actualDb;
  check('health write probe is served from a short cache', firstProbe === true && cachedProbe === true);
} finally {
  ledger.close();
  ledger.close();
  check('ledger close is idempotent and health fails closed afterward', ledger.probeWritable() === false);
  rmSync(dataDir, { recursive: true, force: true });
}

const ENV_KEYS = [
  'AWS_CONTROL_REGION',
  'AWS_CONTROL_INSTANCE_ID',
  'AWS_CONTROL_RUNNER_PATH',
  'AWS_CONTROL_WORKDIR',
  'AWS_CONTROL_SERVICE',
  'AWS_CONTROL_VALIDATE_COMMAND',
];
const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  AWS_CONTROL_REGION: 'us-east-1',
  AWS_CONTROL_INSTANCE_ID: 'i-0123456789abcdef0',
  AWS_CONTROL_RUNNER_PATH: '/opt/arbitrage/runner.ts',
  AWS_CONTROL_WORKDIR: '/opt/arbitrage',
  AWS_CONTROL_SERVICE: 'arbitrage-runner.service',
  AWS_CONTROL_VALIDATE_COMMAND: 'npm run build',
});

class FakeLedger {
  constructor({ failPersist = false } = {}) {
    this.failPersist = failPersist;
    this.config = new Map([[
      'aws-runner-control',
      JSON.stringify({ connectionEnabled: true, executionEnabled: true, updatedAt: Date.now(), updatedBy: 'test' }),
    ]]);
    this.events = [];
  }

  getConfigValue(key) { return this.config.get(key) ?? null; }

  setConfigValueAndLogEvent(key, value, kind, symbol, data) {
    if (this.failPersist) throw new Error('disk unavailable');
    this.config.set(key, value);
    return this.logEvent(kind, symbol, data);
  }

  logEvent(kind, symbol = null, data = null) {
    const event = { id: this.events.length + 1, ts: Date.now(), kind, symbol, data };
    this.events.push(event);
    return event;
  }
}

class FakeSsm {
  constructor({ output = '', error = '', status = 'Success', dispatchError = null } = {}) {
    this.output = output;
    this.error = error;
    this.status = status;
    this.dispatchError = dispatchError;
    this.commands = [];
  }

  async send(command) {
    this.commands.push(command);
    if (command.constructor.name === 'SendCommandCommand') {
      if (this.dispatchError) throw this.dispatchError;
      return { Command: { CommandId: 'command-1' } };
    }
    return {
      Status: this.status,
      StandardOutputContent: this.output,
      StandardErrorContent: this.error,
    };
  }
}

try {
  {
    const fakeLedger = new FakeLedger();
    const control = new AwsRunnerControl(fakeLedger);
    const ssm = new FakeSsm();
    control.ssm = ssm;
    await control.runCommand('status');
    const command = ssm.commands[0]?.input?.Parameters?.commands?.[0] ?? '';
    check('SSM shell explicitly invokes Bash before pipefail', command.startsWith('/usr/bin/env bash -lc ') && command.includes('set -euo pipefail'));
  }

  {
    const fakeLedger = new FakeLedger();
    const control = new AwsRunnerControl(fakeLedger);
    control.ssm = new FakeSsm({ output: 'Zm9v===' });
    let decodeCode = null;
    try { await control.readRunner(); } catch (error) { decodeCode = error.code; }
    const status = await control.status(false, null, false);
    check('malformed Base64 runner output is rejected strictly', decodeCode === 'AWS_RUNNER_DECODE_FAILED');
    check('runner source is absent from status last-action output', status.lastAction?.output === '');
  }

  {
    const fakeLedger = new FakeLedger();
    const control = new AwsRunnerControl(fakeLedger);
    const credentialError = new Error('AWS_SECRET_ACCESS_KEY=do-not-leak');
    credentialError.name = 'CredentialsProviderError';
    control.ssm = new FakeSsm({ dispatchError: credentialError });
    let caught = null;
    try { await control.runCommand('status'); } catch (error) { caught = error; }
    check(
      'AWS transport errors expose a stable redacted message',
      caught instanceof AwsRunnerControlError
        && caught.code === 'AWS_COMMAND_DISPATCH_FAILED'
        && !caught.message.includes('do-not-leak'),
    );
  }

  {
    const fakeLedger = new FakeLedger();
    const control = new AwsRunnerControl(fakeLedger);
    const ssm = new FakeSsm();
    control.ssm = ssm;
    const source = 'export const run = () => true;\n';
    const saved = await control.saveRunner(source, null);
    const command = ssm.commands[0]?.input?.Parameters?.commands?.[0] ?? '';
    check('save reports the exact local source hash', saved.sha256 === sha256(source));
    check(
      'save stages, hashes, validates, promotes, and prepares rollback',
      command.includes('cosmos-stage-$$.ts')
        && command.includes('sha256sum')
        && command.includes('node_modules/.bin/tsc')
        && !command.includes('*.tsx')
        && command.includes('promoted=1')
        && command.includes('cosmos-rollback-$$')
        && command.includes('Configured validation failed; original runner restored'),
    );
    let invalidHashCode = null;
    try { await control.saveRunner(source, 'BAD'); } catch (error) { invalidHashCode = error.code; }
    check('optimistic-concurrency hashes require canonical SHA-256', invalidHashCode === 'AWS_RUNNER_HASH_INVALID');
  }

  {
    process.env.AWS_CONTROL_RUNNER_PATH = '/opt/arbitrage/runner.tsx';
    const fakeLedger = new FakeLedger();
    const control = new AwsRunnerControl(fakeLedger);
    const status = await control.status(false, null, false);
    let rejectedCode = null;
    try { await control.saveRunner('export const View = () => <main />;\n', null); } catch (error) { rejectedCode = error.code; }
    check(
      'unsupported TSX runner paths fail locally before AWS dispatch',
      status.configured === false
        && status.missing.includes('AWS_CONTROL_RUNNER_PATH')
        && rejectedCode === 'AWS_NOT_CONFIGURED',
    );
    process.env.AWS_CONTROL_RUNNER_PATH = '/opt/arbitrage/runner.ts';
  }

  {
    const fakeLedger = new FakeLedger({ failPersist: true });
    const control = new AwsRunnerControl(fakeLedger);
    let rejected = false;
    try { control.setGates({ connectionEnabled: false }, 'operator@example.com'); } catch { rejected = true; }
    const status = await control.status(false, null, false);
    check('gate memory changes only after durable config plus audit', rejected && status.connectionEnabled === true && status.executionEnabled === true);
  }
} finally {
  for (const key of ENV_KEYS) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
}

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} storage/config/AWS checks passed.`);
if (failed.length) process.exit(1);
