import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MAX_ROUTINE_LOG_RECORD_BYTES,
  ProductionLogging,
  installProductionLogging,
} from '../../dist/ops/productionLogging.js';

function recordingSink() {
  const records = {
    log: [],
    info: [],
    debug: [],
    protected: [],
  };
  return {
    records,
    sink: {
      log: (...args) => records.log.push(args),
      info: (...args) => records.info.push(args),
      debug: (...args) => records.debug.push(args),
      warn: (...args) => records.protected.push(['WARN_SINK', ...args]),
      error: (...args) => records.protected.push(['ERROR_SINK', ...args]),
      protected: (...args) => records.protected.push(args),
    },
  };
}

function recordingConsole() {
  const records = {
    log: [],
    info: [],
    debug: [],
    warn: [],
    error: [],
  };
  const target = {
    log: (...args) => records.log.push(args),
    info: (...args) => records.info.push(args),
    debug: (...args) => records.debug.push(args),
    warn: (...args) => records.warn.push(args),
    error: (...args) => records.error.push(args),
  };
  return { records, target };
}

test('default policy gives an exact 10,000 -> 30/9,970 bounded rate proof', () => {
  let nowMs = 0;
  const { records, sink } = recordingSink();
  const logger = new ProductionLogging({
    clock: () => nowMs,
    sink,
  });

  const attempted = 10_000;
  for (let index = 0; index < attempted; index += 1) {
    logger.info(`routine-${index}`);
  }
  assert.equal(records.info.length, 30, 'after policy: one window emits only the default burst');
  assert.deepEqual(logger.snapshot(), {
    routineEmitted: 30,
    routineSuppressed: 9_970,
    retainedMessageKeys: 30,
  });
  assert.equal(records.info[0][0], '<6>routine-0');
  assert.equal(records.info.at(-1)[0], '<6>routine-29');
  assert.equal(Buffer.byteLength(records.info[0][0], 'utf8'), 12);
  assert.equal(Buffer.byteLength(records.info.at(-1)[0], 'utf8'), 13);
  for (const [record] of records.info) {
    assert.ok(Buffer.byteLength(record, 'utf8') <= MAX_ROUTINE_LOG_RECORD_BYTES);
  }

  nowMs = 60_000;
  logger.info('next-window');
  assert.deepEqual(records.protected, [[
    '<5>COSMOS_ROUTINE_LOG_SUPPRESSED count=9970',
  ]]);
  assert.equal(records.info.at(-1)[0], '<6>next-window');
  assert.deepEqual(logger.snapshot(), {
    routineEmitted: 1,
    routineSuppressed: 0,
    retainedMessageKeys: 1,
  });
});

test('routine records are one physical line and UTF-8 byte bounded', () => {
  const { records, sink } = recordingSink();
  const logger = new ProductionLogging({
    clock: () => 0,
    sink,
  });
  const oversized = `${'界'.repeat(2_000)}\r\nsecond\u2028third`;

  logger.info(oversized);
  assert.equal(records.info.length, 1);
  const [record] = records.info[0];
  assert.ok(Buffer.byteLength(record, 'utf8') <= MAX_ROUTINE_LOG_RECORD_BYTES);
  assert.doesNotMatch(record, /[\n\r\u2028\u2029]/u);
  assert.match(record, /^<6>/u);
  assert.match(record, /…$/u);
});

test('same-message coalescing is bounded and suppression metadata contains no raw value', () => {
  let nowMs = 500;
  const { records, sink } = recordingSink();
  const logger = new ProductionLogging({
    clock: () => nowMs,
    policy: {
      intervalMs: 1_000,
      burst: 10,
      perMessageBurst: 2,
      maxMessageKeys: 10,
    },
    sink,
  });
  const marker = 'SECRET_FIXTURE_MUST_NOT_APPEAR';

  for (let index = 0; index < 50; index += 1) {
    logger.debug(marker);
  }
  assert.deepEqual(records.debug, [[`<7>${marker}`], [`<7>${marker}`]]);
  assert.equal(logger.snapshot().routineSuppressed, 48);
  assert.doesNotMatch(JSON.stringify(logger.snapshot()), new RegExp(marker, 'u'));

  nowMs = 1_500;
  logger.info('safe-rollover');
  assert.deepEqual(records.protected, [[
    '<5>COSMOS_ROUTINE_LOG_SUPPRESSED count=48',
  ]]);
  assert.doesNotMatch(JSON.stringify(records.protected), new RegExp(marker, 'u'));
});

test('routine attempt budget bounds expensive formatting before digest work', () => {
  const { records, sink } = recordingSink();
  const logger = new ProductionLogging({ clock: () => 0, sink });
  let inspectCalls = 0;
  const expensive = {
    [Symbol.for('nodejs.util.inspect.custom')]() {
      inspectCalls += 1;
      return 'expensive-repeated-routine-record';
    },
  };

  for (let index = 0; index < 10_000; index += 1) logger.info(expensive);

  assert.equal(inspectCalls, 30, 'formatting is bounded by the per-window attempt budget');
  assert.equal(records.info.length, 3, 'output remains bounded by per-message burst');
  assert.deepEqual(logger.snapshot(), {
    routineEmitted: 3,
    routineSuppressed: 9_997,
    retainedMessageKeys: 1,
  });
  assert.ok(logger.snapshot().routineSuppressed >= 9_970);
});

test('protected audit, money, and security records bypass an exhausted routine budget', () => {
  const { records, sink } = recordingSink();
  const logger = new ProductionLogging({
    clock: () => 0,
    policy: {
      intervalMs: 1_000,
      burst: 1,
      perMessageBurst: 1,
      maxMessageKeys: 1,
    },
    sink,
  });

  logger.info('routine-admitted');
  logger.info('routine-suppressed');
  logger.protected('audit', 'audit-record', 1);
  logger.protected('money', 'money-record', 2);
  logger.protected('security', 'security-record', 3);

  assert.deepEqual(records.protected, [
    ['<5>audit-record 1'],
    ['<5>money-record 2'],
    ['<4>security-record 3'],
  ]);
  assert.equal(logger.snapshot().routineSuppressed, 1);
});

test('structured and keyword-bearing info remain bounded by method, not content', () => {
  const cases = [
    ['structured', (index) => ({ event: 'risk-state', revision: index })],
    ['keyword', (index) => `audit money security material state config order risk lifecycle ${index}`],
  ];

  for (const [label, valueAt] of cases) {
    const { records, sink } = recordingSink();
    const logger = new ProductionLogging({ clock: () => 0, sink });
    for (let index = 0; index < 10_000; index += 1) logger.info(valueAt(index));

    assert.equal(records.info.length, 30, `${label} info emitted count`);
    assert.equal(records.protected.length, 0, `${label} info never content-bypasses`);
    assert.deepEqual(logger.snapshot(), {
      routineEmitted: 30,
      routineSuppressed: 9_970,
      retainedMessageKeys: 30,
    }, `${label} info exact bound`);
  }
});

test('console.log notice and explicit protected records survive routine saturation', () => {
  const { records, sink } = recordingSink();
  const logger = new ProductionLogging({ clock: () => 0, sink });
  for (let index = 0; index < 10_000; index += 1) logger.info(`routine-${index}`);

  logger.log('material notice\ncontinued');
  logger.protected('audit', 'audit-preserved');
  logger.protected('money', 'money-preserved');
  logger.protected('security', 'security-preserved');

  assert.deepEqual(records.log, [
    ['<5>material notice'],
    ['<5>continued'],
  ]);
  assert.deepEqual(records.protected, [
    ['<5>audit-preserved'],
    ['<5>money-preserved'],
    ['<4>security-preserved'],
  ]);
  assert.deepEqual(logger.snapshot(), {
    routineEmitted: 30,
    routineSuppressed: 9_970,
    retainedMessageKeys: 30,
  });
});

test('production installation prefixes every warning/error physical line without suppression', () => {
  let nowMs = 0;
  const { records, target } = recordingConsole();
  const ordered = [];
  target.warn = (...args) => {
    records.warn.push(args);
    ordered.push(['warn', ...args]);
  };
  target.error = (...args) => {
    records.error.push(args);
    ordered.push(['error', ...args]);
  };
  const original = {
    log: target.log,
    info: target.info,
    debug: target.debug,
    warn: target.warn,
    error: target.error,
  };
  const installation = installProductionLogging({
    environment: 'production',
    target,
    clock: () => nowMs,
    policy: {
      intervalMs: 1_000,
      burst: 1,
      perMessageBurst: 1,
      maxMessageKeys: 1,
    },
  });

  assert.equal(installation.enabled, true);
  assert.notEqual(target.log, original.log);
  assert.notEqual(target.info, original.info);
  assert.notEqual(target.debug, original.debug);
  assert.notEqual(target.warn, original.warn);
  assert.notEqual(target.error, original.error);

  target.info('first', 1);
  target.info('second', 2);
  target.log('material-log\nmaterial-continued');
  assert.deepEqual(records.log, [
    ['<5>material-log'],
    ['<5>material-continued'],
  ], 'material console.log stays ordered on its stdout sink after saturation');
  for (let index = 0; index < 100; index += 1) {
    target.warn(`warning-${index}\ncontinued-${index}`);
    target.error(`error-${index}\r\ncontinued-${index}`);
  }
  assert.equal(records.warn.length, 200);
  assert.equal(records.error.length, 200);
  const expectedOrdered = [];
  for (let index = 0; index < 100; index += 1) {
    expectedOrdered.push(
      ['warn', `<4>warning-${index}`],
      ['warn', `<4>continued-${index}`],
      ['error', `<3>error-${index}`],
      ['error', `<3>continued-${index}`],
    );
  }
  assert.deepEqual(ordered, expectedOrdered);

  installation.restore();
  assert.equal(target.log, original.log);
  assert.equal(target.info, original.info);
  assert.equal(target.debug, original.debug);
  assert.equal(target.warn, original.warn);
  assert.equal(target.error, original.error);
  assert.deepEqual(records.error.at(-1), ['<5>COSMOS_ROUTINE_LOG_SUPPRESSED count=1']);

  installation.restore();
  assert.equal(records.error.length, 201, 'repeat restore emits no second summary');
  nowMs = 2_000;
});

test('non-production and malformed environments install nothing', () => {
  for (const environment of [undefined, '', 'development', 'production ']) {
    const { target } = recordingConsole();
    const original = {
      log: target.log,
      info: target.info,
      debug: target.debug,
      warn: target.warn,
      error: target.error,
    };
    const installation = installProductionLogging({ environment, target });
    assert.equal(installation.enabled, false);
    assert.equal(target.log, original.log);
    assert.equal(target.info, original.info);
    assert.equal(target.debug, original.debug);
    assert.equal(target.warn, original.warn);
    assert.equal(target.error, original.error);
  }
});

test('invalid policies fail before installing wrappers', () => {
  const { target } = recordingConsole();
  const originalLog = target.log;
  assert.throws(() => installProductionLogging({
    environment: 'production',
    target,
    policy: {
      intervalMs: 0,
      burst: 1,
      perMessageBurst: 1,
      maxMessageKeys: 1,
    },
  }), /positive safe integer/u);
  assert.equal(target.log, originalLog);

  assert.throws(() => new ProductionLogging({
    sink: recordingSink().sink,
    policy: {
      intervalMs: 1_000,
      burst: 2,
      perMessageBurst: 3,
      maxMessageKeys: 2,
    },
  }), /perMessageBurst exceeds burst/u);
});

test('implementation is timer-free and cannot retain raw routine messages in metadata', async () => {
  const source = await readFile(
    new URL('../../src/ops/productionLogging.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\bset(?:Timeout|Interval|Immediate)\s*\(/u);
  assert.doesNotMatch(source, /\b(?:clearTimeout|clearInterval|clearImmediate)\s*\(/u);
  assert.match(source, /createHash\('sha256'\)/u);
  assert.match(source, /COSMOS_ROUTINE_LOG_SUPPRESSED count=/u);
});
