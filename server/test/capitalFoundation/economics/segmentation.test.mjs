import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NET_PNL_SEGMENTATION_AXES,
  PRODUCTION_NET_PNL_CORPUS_NOT_CONFIGURED,
  buildNineAxisNetPnlReport,
  composeEconomicReport,
  deriveEconomicAccountingPolicyRevision,
} from '../../../dist/capitalFoundation/economics/index.js';

const NOW = 1_800_000_000_000;

function policy(sourceId = 'capital-policy-registry:l097') {
  const semantics = {
    authority: {
      sourceId,
      issuedAtMs: NOW - 2_000,
      effectiveFromMs: NOW - 1_000,
      effectiveUntilMs: NOW + 1_000,
    },
    pricePnlBasis: 'LEG_PRICE',
    executionCostBasis: 'DETAILED_SPREAD_SLIPPAGE',
    expectedComponentKinds: [
      'MARK_TO_MARKET_LEG_PNL', 'REALIZED_LEG_PNL', 'FUNDING',
      'BORROW_INTEREST_AND_FEES', 'TRADING_COMMISSIONS', 'ENTRY_SPREAD_COST',
      'EXIT_SPREAD_COST', 'ESTIMATED_SLIPPAGE', 'ONE_LEG_EXPOSURE',
      'CONVERSION_VALUATION', 'OPERATIONAL_RECOVERY_COST', 'RESIDUAL_UNEXPLAINED',
    ],
  };
  return { ...semantics, authority: { ...semantics.authority, revision: deriveEconomicAccountingPolicyRevision(semantics) } };
}

function component(id, kind, amount, overrides = {}) {
  const status = overrides.status ?? 'KNOWN';
  return {
    id, kind, status, amount,
    estimateRange: status === 'ESTIMATED' ? { low: amount, high: amount } : null,
    valuationAsset: 'USDT', observedAtMs: NOW - 10, sourceIds: [`source-${id}`], reasonCodes: [],
    strategy: 'BASIS', opportunityId: 'opportunity-l097', configRevision: 'config-l097',
    stage: 'CLOSED', symbol: 'BTCUSDT', legId: 'leg-l097',
    correlationId: 'correlation-l097', ...overrides,
  };
}

function closedOutcome(id, realized, realizedOverrides = {}, options = {}) {
  const strategy = options.strategy ?? 'BASIS';
  let components = [
    component(`${id}-mtm`, 'MARK_TO_MARKET_LEG_PNL', '0', { strategy }),
    component(`${id}-realized`, 'REALIZED_LEG_PNL', realized, { strategy, ...realizedOverrides }),
    component(`${id}-funding`, 'FUNDING', '0', { strategy }),
    component(`${id}-borrow`, 'BORROW_INTEREST_AND_FEES', '0', { strategy }),
    component(`${id}-fees`, 'TRADING_COMMISSIONS', '-1', { strategy }),
    component(`${id}-entry`, 'ENTRY_SPREAD_COST', '0', { strategy }),
    component(`${id}-exit`, 'EXIT_SPREAD_COST', '0', { strategy }),
    component(`${id}-slippage`, 'ESTIMATED_SLIPPAGE', null, {
      strategy, status: 'NOT_APPLICABLE', observedAtMs: null,
    }),
    component(`${id}-one-leg`, 'ONE_LEG_EXPOSURE', '0', { strategy }),
    component(`${id}-fx`, 'CONVERSION_VALUATION', '0', { strategy }),
    component(`${id}-recovery`, 'OPERATIONAL_RECOVERY_COST', '0', { strategy }),
    component(`${id}-residual`, 'RESIDUAL_UNEXPLAINED', '0', { strategy }),
  ];
  if (options.extraComponents) components = [...components, ...options.extraComponents];
  if (options.transformComponents) components = options.transformComponents(components);
  return composeEconomicReport({
    scope: {
      kind: 'CLOSED_OUTCOME', id, strategy, opportunityId: 'opportunity-l097',
      configRevision: 'config-l097', stage: 'CLOSED', symbol: 'BTCUSDT', legId: 'leg-l097',
      correlationId: 'correlation-l097',
    },
    valuationAsset: 'USDT', components,
    policy: options.policy ?? policy(), evaluatedAtMs: options.evaluatedAtMs ?? NOW,
  });
}

const DIMENSIONS = Object.freeze({
  strategy: 'BASIS', regime: 'CONTANGO', symbolClass: 'LARGE_CAP', confidence: 'HIGH',
  entryStage: 'FULL', holdingPeriod: 'INTRADAY', reason: 'BASIS_CONVERGENCE',
  executionPath: 'VALIDATE_ONLY', modelVersion: 'basis-engine.v1',
});

function record(id, pnl, overrides = {}) {
  const dimensions = overrides.dimensions ?? DIMENSIONS;
  return {
    recordId: id, sourceRevision: 'closed-outcomes.v1', evidencePosture: 'RECORDED_REPLAY',
    closedAtMs: NOW - 1, dimensions,
    economicReport: overrides.economicReport
      ?? closedOutcome(`closed-${id}`, pnl, {}, { strategy: dimensions.strategy }),
    ...overrides,
  };
}

function build(records, overrides = {}) {
  return buildNineAxisNetPnlReport({
    reportId: 'l097-regression-v1',
    valuationAsset: 'USDT',
    evaluatedAtMs: NOW,
    records,
    ...overrides,
  });
}

function trapZeroProxy(target) {
  const calls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const proxy = new Proxy(target, {
    get() { calls.get += 1; throw new Error('HOSTILE_GET'); },
    getOwnPropertyDescriptor() { calls.getOwnPropertyDescriptor += 1; throw new Error('HOSTILE_DESCRIPTOR'); },
    getPrototypeOf() { calls.getPrototypeOf += 1; throw new Error('HOSTILE_PROTOTYPE'); },
    ownKeys() { calls.ownKeys += 1; throw new Error('HOSTILE_KEYS'); },
  });
  return { proxy, calls };
}

function reportWithFirstComponentField(id, field, value) {
  const genuine = closedOutcome(id, '2');
  return {
    ...genuine,
    attribution: {
      ...genuine.attribution,
      components: genuine.attribution.components.map((entry, index) => index === 0
        ? { ...entry, [field]: value }
        : entry),
    },
  };
}

test('nine-axis replay report sums exact net PnL without claiming production truth', () => {
  const report = buildNineAxisNetPnlReport({
    reportId: 'l097-nine-axis-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW,
    records: [record('record-a', '10'), record('record-b', '-2')],
  });
  assert.deepEqual(report.axes, NET_PNL_SEGMENTATION_AXES);
  assert.equal(report.axes.length, 9);
  assert.equal(report.status, 'RECORDED_REPLAY');
  assert.equal(report.segments.length, 1);
  assert.equal(report.segments[0].netPnl, '6');
  assert.equal(report.segments[0].recordCount, 2);
  assert.match(report.revision, /^capital-net-pnl:[0-9a-f]{32}$/);
  assert.deepEqual(report.recordLineages.map((lineage) => lineage.recordId), ['record-a', 'record-b']);
  assert.equal(report.recordLineages[0].sourceRevision, 'closed-outcomes.v1');
  assert.equal(report.recordLineages[0].closedAtMs, NOW - 1);
  assert.match(report.recordLineages[0].economicReportRevision, /^capital-economic-report:[0-9a-f]{32}$/);
  assert.match(report.recordLineages[0].policyRevision, /^cfg_[0-9a-f]{16}$/);
  assert.ok(report.recordLineages[0].evidenceSourceIds.every((sourceId) => sourceId.startsWith('source-')));
});

test('caller-selected production posture cannot mint production PnL truth', () => {
  const report = build([record('forged-production', '2', {
    evidencePosture: 'PRODUCTION_OBSERVED',
    sourceRevision: 'caller-selected-production.v1',
  })]);

  assert.equal(report.status, 'UNAVAILABLE');
  assert.deepEqual(report.segments, []);
  assert.deepEqual(report.includedRecordIds, []);
  assert.deepEqual(report.recordLineages, []);
  assert.deepEqual(report.excludedRecordIds, ['forged-production']);
  assert.ok(report.reasonCodes.includes(
    `forged-production:${PRODUCTION_NET_PNL_CORPUS_NOT_CONFIGURED}`,
  ));
});

test('all nine dimensions participate in segmentation identity', () => {
  const records = NET_PNL_SEGMENTATION_AXES.map((axis, index) => record(
    `axis-${index}`, '2', {
      dimensions: {
        ...DIMENSIONS,
        [axis]: axis === 'strategy' ? 'VOLUME' : `${DIMENSIONS[axis]}-OTHER`,
      },
    },
  ));
  const report = buildNineAxisNetPnlReport({
    reportId: 'l097-axis-identity-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW, records,
  });
  assert.equal(report.segments.length, 9);
  assert.equal(new Set(report.segments.map((segment) => segment.segmentId)).size, 9);
});

test('absent realized truth and missing dimensions never become zero-valued segments', () => {
  const missingRealized = closedOutcome('closed-missing', null, {
    status: 'MISSING', observedAtMs: null, reasonCodes: ['REALIZED_OUTCOME_ABSENT'],
  });
  const report = buildNineAxisNetPnlReport({
    reportId: 'l097-unavailable-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW,
    records: [record('missing-realized', '2', { economicReport: missingRealized })],
  });
  assert.equal(report.status, 'UNAVAILABLE');
  assert.deepEqual(report.segments, []);
  assert.ok(report.reasonCodes.includes('missing-realized:REALIZED_PNL_UNAVAILABLE'));

  const missingAxis = buildNineAxisNetPnlReport({
    reportId: 'l097-missing-axis-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW,
    records: [record('missing-axis', '2', { dimensions: { ...DIMENSIONS, modelVersion: null } })],
  });
  assert.equal(missingAxis.status, 'UNAVAILABLE');
  assert.deepEqual(missingAxis.segments, []);
});

test('empty inputs are DATA_INSUFFICIENT and duplicate record identity is hostile', () => {
  const empty = buildNineAxisNetPnlReport({
    reportId: 'l097-empty-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW, records: [],
  });
  assert.equal(empty.status, 'DATA_INSUFFICIENT');
  assert.deepEqual(empty.segments, []);
  const duplicate = record('duplicate', '2');
  assert.throws(() => buildNineAxisNetPnlReport({
    reportId: 'l097-duplicate-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW,
    records: [duplicate, duplicate],
  }), /record IDs must be unique/);
});

test('boundary snapshots reject active and revoked Proxies without invoking a trap or returning output', () => {
  const root = {
    reportId: 'l097-hostile-root-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW, records: [],
  };
  const hostileRoot = trapZeroProxy(root);
  let output;
  assert.throws(() => { output = buildNineAxisNetPnlReport(hostileRoot.proxy); }, /exact bounded own data at input/);
  assert.equal(output, undefined);
  assert.deepEqual(hostileRoot.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });

  const hostileDimensions = trapZeroProxy({ ...DIMENSIONS });
  const hostileRecord = {
    ...record('hostile-dimensions', '2'),
    dimensions: hostileDimensions.proxy,
  };
  assert.throws(() => {
    output = build([hostileRecord]);
  }, /exact bounded own data/);
  assert.equal(output, undefined);
  assert.deepEqual(hostileDimensions.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });

  const revoked = Proxy.revocable(root, {});
  revoked.revoke();
  assert.throws(() => { output = buildNineAxisNetPnlReport(revoked.proxy); }, /exact bounded own data at input/);
  assert.equal(output, undefined);
});

test('accessors at the record, policy, and estimate-range boundaries are never invoked', () => {
  let accessorCalls = 0;
  let output;
  const accessorRecord = { ...record('accessor-record', '2') };
  Object.defineProperty(accessorRecord, 'dimensions', {
    enumerable: true,
    get() { accessorCalls += 1; return DIMENSIONS; },
  });
  assert.throws(() => { output = build([accessorRecord]); }, /exact bounded own data/);
  assert.equal(accessorCalls, 0);
  assert.equal(output, undefined);

  const genuine = closedOutcome('closed-accessor-policy', '2');
  const accessorPolicy = { ...genuine.policy };
  Object.defineProperty(accessorPolicy, 'authority', {
    enumerable: true,
    get() { accessorCalls += 1; return genuine.policy.authority; },
  });
  assert.throws(() => {
    output = build([record('accessor-policy', '2', {
      economicReport: { ...genuine, policy: accessorPolicy },
    })]);
  }, /exact bounded own data/);
  assert.equal(accessorCalls, 0);
  assert.equal(output, undefined);

  const accessorRange = {};
  Object.defineProperty(accessorRange, 'low', {
    enumerable: true,
    get() { accessorCalls += 1; return '0'; },
  });
  Object.defineProperty(accessorRange, 'high', { enumerable: true, value: '0' });
  assert.throws(() => {
    output = build([record('accessor-range', '2', {
      economicReport: reportWithFirstComponentField(
        'closed-accessor-range',
        'estimateRange',
        accessorRange,
      ),
    })]);
  }, /exact bounded own data/);
  assert.equal(accessorCalls, 0);
  assert.equal(output, undefined);
});

test('over-bound records, components, source, reason, dimension, and policy arrays reject before index access', () => {
  let accessorCalls = 0;
  let output;
  function oversized(length) {
    const value = [];
    Object.defineProperty(value, '0', {
      enumerable: true,
      get() { accessorCalls += 1; throw new Error('OVERSIZE_INDEX_ACCESSED'); },
    });
    value.length = length;
    return value;
  }

  assert.throws(() => {
    output = buildNineAxisNetPnlReport({
      reportId: 'l097-over-bound-records-v1', valuationAsset: 'USDT', evaluatedAtMs: NOW,
      records: oversized(10_001),
    });
  }, /input\.records\.length/);

  const genuine = closedOutcome('closed-over-bound-arrays', '2');
  const reports = [
    {
      ...genuine,
      attribution: { ...genuine.attribution, components: oversized(129) },
    },
    reportWithFirstComponentField('closed-over-bound-sources', 'sourceIds', oversized(65)),
    reportWithFirstComponentField('closed-over-bound-reasons', 'reasonCodes', oversized(65)),
    { ...genuine, dimensions: oversized(17) },
    {
      ...genuine,
      policy: { ...genuine.policy, expectedComponentKinds: oversized(33) },
    },
  ];
  for (const [index, economicReport] of reports.entries()) {
    assert.throws(() => {
      output = build([record(`over-bound-nested-${index}`, '2', { economicReport })]);
    }, /exact bounded own data/);
  }
  assert.equal(accessorCalls, 0);
  assert.equal(output, undefined);
});

test('__proto__ remains own data and cannot supply inherited report authority', () => {
  const genuine = record('proto-owner', '2');
  const hostile = {
    recordId: genuine.recordId,
    sourceRevision: genuine.sourceRevision,
    evidencePosture: genuine.evidencePosture,
    closedAtMs: genuine.closedAtMs,
    dimensions: genuine.dimensions,
  };
  Object.defineProperty(hostile, '__proto__', {
    enumerable: true,
    value: { economicReport: genuine.economicReport },
  });
  const report = build([hostile]);
  assert.equal(report.status, 'UNAVAILABLE');
  assert.deepEqual(report.includedRecordIds, []);
  assert.deepEqual(report.excludedRecordIds, ['proto-owner']);
  assert.ok(report.reasonCodes.includes('proto-owner:ECONOMIC_REPORT_REQUIRED'));
});

test('root-wide node and canonical UTF-8 budgets stop before untouched hostile values', () => {
  let output;
  const lateNodeProxy = trapZeroProxy({ ignored: true });
  const nodeHeavy = Array.from({ length: 1_000 }, (_, index) => index === 999
    ? lateNodeProxy.proxy
    : Array.from({ length: 256 }, () => true));
  assert.throws(() => { output = build(nodeHeavy); }, /exact bounded own data/);
  assert.equal(output, undefined);
  assert.deepEqual(lateNodeProxy.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });

  const lateByteProxy = trapZeroProxy({ ignored: true });
  const maximumLeaf = 'x'.repeat(4_096);
  const byteHeavy = Array.from({ length: 3_000 }, (_, index) => index === 2_999
    ? lateByteProxy.proxy
    : maximumLeaf);
  assert.throws(() => { output = build(byteHeavy); }, /exact bounded own data/);
  assert.equal(output, undefined);
  assert.deepEqual(lateByteProxy.calls, {
    get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0,
  });
});

test('positive zero remains canonical while negative zero is rejected before any revision can be minted', () => {
  const positive = build([], { evaluatedAtMs: 0 });
  assert.equal(positive.status, 'DATA_INSUFFICIENT');
  assert.equal(Object.is(positive.evaluatedAtMs, 0), true);
  assert.equal(Object.is(positive.evaluatedAtMs, -0), false);
  assert.match(positive.revision, /^capital-net-pnl:[0-9a-f]{32}$/);

  const genuine = closedOutcome('closed-negative-zero', '2');
  const firstComponent = genuine.attribution.components[0];
  const negativeZeroInputs = [
    () => build([], { evaluatedAtMs: -0 }),
    () => build([record('negative-zero-close', '2', { closedAtMs: -0 })]),
    () => build([record('negative-zero-report', '2', {
      economicReport: {
        ...genuine,
        attribution: { ...genuine.attribution, evaluatedAtMs: -0 },
      },
    })]),
    () => build([record('negative-zero-component', '2', {
      economicReport: {
        ...genuine,
        attribution: {
          ...genuine.attribution,
          components: [
            { ...firstComponent, observedAtMs: -0 },
            ...genuine.attribution.components.slice(1),
          ],
        },
      },
    })]),
    () => build([record('negative-zero-policy', '2', {
      economicReport: {
        ...genuine,
        policy: {
          ...genuine.policy,
          authority: { ...genuine.policy.authority, issuedAtMs: -0 },
        },
      },
    })]),
  ];
  for (const invoke of negativeZeroInputs) {
    let output;
    assert.throws(() => { output = invoke(); }, /exact bounded own data/);
    assert.equal(output, undefined);
  }
});

test('lineage bindings change revisions even when reported net PnL is unchanged', () => {
  const baseRecord = record('binding', '4');
  const base = build([baseRecord]);
  const variants = [
    record('binding', '4', { sourceRevision: 'closed-outcomes.v2' }),
    record('binding', '4', { closedAtMs: NOW - 2 }),
    record('binding', '4', {
      economicReport: closedOutcome('closed-binding', '4', {}, { evaluatedAtMs: NOW - 1 }),
    }),
    record('binding', '4', {
      economicReport: closedOutcome('closed-binding', '4', {}, {
        transformComponents: (components) => components.map((entry) => entry.kind === 'FUNDING'
          ? { ...entry, sourceIds: ['changed-funding-source'] }
          : entry),
      }),
    }),
    record('binding', '4', {
      economicReport: closedOutcome('closed-binding', '4', {}, {
        policy: policy('capital-policy-registry:l097-revised'),
      }),
    }),
    record('binding', '4', {
      economicReport: closedOutcome('closed-binding', '4', {}, {
        extraComponents: [
          component('closed-binding-neutral-positive', 'FUNDING', '2'),
          component('closed-binding-neutral-negative', 'FUNDING', '-2'),
        ],
      }),
    }),
  ];
  for (const variant of variants) {
    const changed = build([variant]);
    assert.equal(changed.segments[0].netPnl, base.segments[0].netPnl);
    assert.notEqual(changed.revision, base.revision);
  }
});

test('record order and set-like component evidence order are byte stable', () => {
  const first = record('stable-a', '3');
  const second = record('stable-b', '-1');
  const forward = build([first, second]);
  const reversed = build([second, first]);
  assert.equal(reversed.revision, forward.revision);
  assert.equal(JSON.stringify(reversed), JSON.stringify(forward));

  const sourceOrder = (reverse) => closedOutcome('closed-stable-source', '3', {}, {
    transformComponents: (components) => {
      const enriched = components.map((entry) => ({
        ...entry,
        sourceIds: [...entry.sourceIds, `secondary-${entry.id}`],
      }));
      const ordered = reverse ? [...enriched].reverse() : enriched;
      return ordered.map((entry) => ({
        ...entry,
        sourceIds: reverse ? [...entry.sourceIds].reverse() : entry.sourceIds,
      }));
    },
  });
  const canonical = build([record('stable-source', '3', { economicReport: sourceOrder(false) })]);
  const permuted = build([record('stable-source', '3', { economicReport: sourceOrder(true) })]);
  assert.equal(permuted.revision, canonical.revision);
  assert.equal(JSON.stringify(permuted), JSON.stringify(canonical));
});

test('eligible lineage derives only from included owner component source IDs', () => {
  const supplied = {
    ...record('derived-lineage', '2'),
    evidenceSourceIds: ['caller-forged-source'],
  };
  const report = build([supplied]);
  const [lineage] = report.recordLineages;
  assert.ok(lineage.evidenceSourceIds.includes('source-closed-derived-lineage-realized'));
  assert.ok(!lineage.evidenceSourceIds.includes('source-closed-derived-lineage-slippage'));
  assert.ok(!lineage.evidenceSourceIds.includes('caller-forged-source'));
  assert.deepEqual(lineage.evidenceSourceIds, [...lineage.evidenceSourceIds].sort());
});

test('recomposition rejects forged net, identity, and accounting projections', () => {
  const genuine = closedOutcome('closed-forged', '4');
  const forgedReports = [
    { ...genuine, attribution: { ...genuine.attribution, netKnown: '999' } },
    { ...genuine, identity: { ...genuine.identity, knownComponentSum: '999' } },
    { ...genuine, accountingStatus: 'INCOMPLETE' },
  ];
  for (const [index, economicReport] of forgedReports.entries()) {
    const report = build([record(`forged-${index}`, '4', { economicReport })]);
    assert.equal(report.status, 'UNAVAILABLE');
    assert.deepEqual(report.segments, []);
    assert.ok(report.reasonCodes.includes(`forged-${index}:ECONOMIC_REPORT_CONTENT_MISMATCH`));
  }
});

test('component, closure, report, and request time form a strict causal chain', () => {
  const observedAfterClose = build([record('future-component', '2', { closedAtMs: NOW - 20 })]);
  assert.equal(observedAfterClose.status, 'UNAVAILABLE');
  assert.ok(observedAfterClose.reasonCodes.includes('future-component:COMPONENT_OBSERVED_AFTER_CLOSE'));

  const reportBeforeClose = build([record('report-before-close', '2', {
    closedAtMs: NOW - 1,
    economicReport: closedOutcome('closed-report-before-close', '2', {}, { evaluatedAtMs: NOW - 5 }),
  })]);
  assert.equal(reportBeforeClose.status, 'UNAVAILABLE');
  assert.ok(reportBeforeClose.reasonCodes.includes('report-before-close:ECONOMIC_REPORT_CHRONOLOGY_INVALID'));

  const reportAfterRequest = build([record('report-after-request', '2', { closedAtMs: NOW - 2 })], {
    evaluatedAtMs: NOW - 1,
  });
  assert.equal(reportAfterRequest.status, 'UNAVAILABLE');
  assert.ok(reportAfterRequest.reasonCodes.includes('report-after-request:ECONOMIC_REPORT_CHRONOLOGY_INVALID'));
});

test('segmentation strategy must agree with closed-outcome scope strategy', () => {
  const report = build([record('strategy-mismatch', '2', {
    dimensions: { ...DIMENSIONS, strategy: 'VOLUME' },
    economicReport: closedOutcome('closed-strategy-mismatch', '2'),
  })]);
  assert.equal(report.status, 'UNAVAILABLE');
  assert.deepEqual(report.segments, []);
  assert.ok(report.reasonCodes.includes('strategy-mismatch:STRATEGY_SCOPE_DIVERGENT'));
});

test('mixed evidence posture and duplicate closed-outcome scope IDs fail closed', () => {
  const mixed = build([
    record('mixed-replay', '2'),
    record('mixed-production', '2', { evidencePosture: 'PRODUCTION_OBSERVED' }),
  ]);
  assert.equal(mixed.status, 'DIVERGENT');
  assert.deepEqual(mixed.segments, []);
  assert.ok(mixed.reasonCodes.includes('EVIDENCE_POSTURE_DIVERGENT'));

  const mixedWithInvalidRecord = build([
    record('mixed-valid-replay', '2'),
    record('mixed-invalid-production', '2', {
      evidencePosture: 'PRODUCTION_OBSERVED',
      closedAtMs: NOW - 20,
    }),
  ]);
  assert.equal(mixedWithInvalidRecord.status, 'DIVERGENT');
  assert.deepEqual(mixedWithInvalidRecord.segments, []);

  const shared = closedOutcome('closed-shared-scope', '2');
  const duplicateScope = build([
    record('scope-owner-a', '2', { economicReport: shared }),
    record('scope-owner-b', '2', { economicReport: shared }),
  ]);
  assert.equal(duplicateScope.status, 'DIVERGENT');
  assert.deepEqual(duplicateScope.segments, []);
  assert.ok(duplicateScope.reasonCodes.includes('CLOSED_OUTCOME_SCOPE_ID_DIVERGENT:closed-shared-scope'));
});

test('record, component, lineage, and identity bounds fail closed', () => {
  const template = record('bounded-template', '2');
  assert.throws(() => build(Array.from({ length: 10_001 }, (_, index) => ({
    ...template,
    recordId: `bounded-${index}`,
  }))), /exact bounded own data/);

  const tooManyComponents = Array.from({ length: 117 }, (_, index) => component(
    `closed-component-bound-extra-${index}`,
    'FUNDING',
    '0',
  ));
  assert.throws(() => build([record('component-bound', '2', {
    economicReport: closedOutcome('closed-component-bound', '2', {}, {
      extraComponents: tooManyComponents,
    }),
  })]), /exact bounded own data/);

  assert.throws(() => build([record('reference-bound', '2', {
    economicReport: closedOutcome('closed-reference-bound', '2', {}, {
      transformComponents: (components) => components.map((entry) => entry.kind === 'REALIZED_LEG_PNL'
        ? { ...entry, sourceIds: Array.from({ length: 65 }, (_, index) => `source-${index}`) }
        : entry),
      }),
  })]), /exact bounded own data/);

  const identityBound = build([record('identity-bound', '2', { sourceRevision: 'x'.repeat(257) })]);
  assert.equal(identityBound.status, 'UNAVAILABLE');
  assert.ok(identityBound.reasonCodes.includes('identity-bound:SOURCE_REVISION_INVALID'));
});

test('lineages and record IDs use deterministic code-unit ordering', () => {
  const report = build(['z', 'ä', 'a', 'A'].map((id) => record(id, '2')));
  assert.deepEqual(report.includedRecordIds, ['A', 'a', 'z', 'ä']);
  assert.deepEqual(report.recordLineages.map((lineage) => lineage.recordId), ['A', 'a', 'z', 'ä']);
});
