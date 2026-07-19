import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { analyzeFalsePositiveForensics } from '../../../server/dist/intelligenceFoundation/forensics/index.js';

import {
  TOKEN_EVIDENCE_CAPABILITIES,
  parseTokenIntelligence,
} from '../../src/lib/tokenIntelligence.ts';
import {
  VOLUME_OUTCOME_OWNER_TRUTH,
  projectVolumeWorkspaceTruth,
} from '../../src/lib/volumeWorkspaceTruth.ts';

const readSource = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const FORENSIC_CHECK_KINDS = [
  'ONE_PRINT_OR_CONCENTRATED_SPIKE',
  'WASH_LIKE_PING_PONG_CHURN',
  'VOLUME_WITHOUT_PRICE_RESPONSE',
  'PRICE_JUMP_ON_THIN_OR_DISAPPEARING_DEPTH',
  'ALREADY_EXHAUSTED_MOVE',
  'FAKE_FOLLOW_THROUGH',
  'REPEATED_WAKEUP_FADE',
  'MARKET_WIDE_MISCLASSIFICATION',
  'LIQUIDATION_ONLY_BURST',
  'STALE_OR_INCOMPLETE_EVIDENCE',
];

function forensicTruth(state = 'FRESH', options = {}) {
  const evaluatedAtMs = NOW - 100;
  const eventTimeMs = state === 'STALE' ? NOW - 5_000 : NOW - 200;
  const ageMs = evaluatedAtMs - eventTimeMs;
  return {
    schemaVersion: '1',
    producerVersion: 'forensics-fixture-1',
    configurationVersion: 'forensics-fixture-config-1',
    featureVersion: 'features-1',
    authority: {
      kind: 'ENGINE_DERIVED', sourceId: 'market-intelligence-false-positive-forensics',
      dataset: options.dataset ?? 'false-positive-forensics-report', endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: ['source-1'], sourceSet: ['intelligence-foundation'], transforms: ['fixture'],
    },
    temporal: {
      sourceEventTimeMs: eventTimeMs,
      sourceTransactionTimeMs: eventTimeMs,
      receivedTimeMs: eventTimeMs + 1,
      sequence: null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME', evaluatedAtMs, ageMs, maxAgeMs: 1_000, state,
    },
    completeness: {
      state: options.completeness ?? 'COMPLETE',
      observedFields: options.observedFields ?? ['forensics.verdict'],
      missingFields: options.missingFields ?? [],
      reasonCodes: options.reasonCodes ?? [],
    },
  };
}

function forensicReport(state = 'FRESH') {
  return {
    id: 'forensics-report-1',
    symbol: 'BTCUSDT',
    instrumentId: 'instrument:BTCUSDT:SPOT',
    evaluatedAtMs: NOW - 100,
    checks: FORENSIC_CHECK_KINDS.map((check, index) => ({
      id: `forensic-check-${index}`,
      check,
      verdict: 'PASS',
      severity: check === 'REPEATED_WAKEUP_FADE' ? 'WARN' : 'BLOCK',
      required: check !== 'REPEATED_WAKEUP_FADE',
      reasonCodes: ['FORENSICS_FIXTURE_PASS'],
      evidenceIds: [],
      featureIds: [],
      observationStartMs: null,
      observationEndMs: null,
      metrics: [],
      truth: forensicTruth('FRESH', {
        dataset: check,
        observedFields: [`forensics.${check}.verdict`],
        reasonCodes: ['FORENSICS_FIXTURE_PASS'],
      }),
    })),
    tradeability: {
      state: 'CLEAR', claimAllowed: true,
      blockingCheckIds: [], warningCheckIds: [], unknownRequiredCheckIds: [],
      reasonCodes: ['FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR'],
    },
    truth: forensicTruth(state, {
      observedFields: FORENSIC_CHECK_KINDS.map((check) => `forensics.${check}.verdict`),
      reasonCodes: ['FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR'],
    }),
  };
}

function thesisTruth(state = 'FRESH', completeness = 'COMPLETE') {
  const truth = forensicTruth(state, {
    dataset: 'thesis-packet',
    completeness,
    observedFields: completeness === 'MISSING' ? [] : ['hypothesis', 'stage', 'tradeability'],
    missingFields: completeness === 'COMPLETE' ? [] : ['required-thesis-evidence'],
    reasonCodes: completeness === 'COMPLETE' ? [] : ['UPSTREAM_TRUTH_INCOMPLETE'],
  });
  truth.producerVersion = 'intelligence-thesis-1';
  truth.authority.sourceId = 'market-intelligence-thesis-builder';
  truth.provenance.sourceSet = ['market-intelligence-thesis-builder'];
  return truth;
}

function tokenReadWithForensics(state = 'FRESH') {
  const capabilities = TOKEN_EVIDENCE_CAPABILITIES.map((capability) => ({
    capability,
    freshness: capability === 'CROSS_MARKET_LEADERSHIP' ? 'FRESH' : 'MISSING',
    completeness: capability === 'CROSS_MARKET_LEADERSHIP' ? 'COMPLETE' : 'MISSING',
    lastEvidenceTimeMs: capability === 'CROSS_MARKET_LEADERSHIP' ? NOW - 100 : null,
    sourceIds: capability === 'CROSS_MARKET_LEADERSHIP' ? ['spot-owner', 'perpetual-owner'] : [],
    reasonCodes: capability === 'CROSS_MARKET_LEADERSHIP' ? [] : ['APPROVED_SOURCE_MISSING'],
  }));
  return {
    schemaVersion: 'token-intelligence-owner-read.v1',
    symbol: 'BTCUSDT',
    observedAtMs: NOW,
    projection: {
      state: 'ACTIVE',
      usdm: { connected: true, feedState: 'open' },
      liquidation: { connected: false, feedState: 'closed' },
    },
    markFunding: {
      state: 'MISSING', sourceId: 'binance-futures-market-stream', dataset: 'usd_m.mark_price',
      observedAtMs: null, value: null, reasonCodes: ['MARK_FUNDING_MISSING'],
    },
    openInterest: {
      state: 'MISSING', sourceId: 'binance-futures-rest', dataset: 'usd_m.open_interest',
      observedAtMs: null, value: null, reasonCodes: ['OPEN_INTEREST_MISSING'],
    },
    liquidation: {
      state: 'MISSING', sourceId: 'binance-futures-market-stream', dataset: 'usd_m.liquidation',
      observedAtMs: null, value: null, reasonCodes: ['LIQUIDATION_MISSING'],
    },
    routing: {
      symbol: 'BTCUSDT', observedAtMs: NOW, capabilities,
      authority: 'EVIDENCE_ONLY', liveMoneyAuthority: 'NONE',
    },
    bridge: {
      symbol: 'BTCUSDT', evaluatedAtMs: NOW, featureSnapshot: null,
      evidenceHistoryCount: 17, evidenceHistoryState: 'COMPLETE', attention: null,
      artifact: {
        id: 'artifact-1', candidateId: 'candidate-1', instrumentId: 'instrument:BTCUSDT:SPOT',
        symbol: 'BTCUSDT', evaluatedAtMs: NOW - 100, featureSnapshot: {}, evidenceIds: [],
        thesis: {
          instrumentId: 'instrument:BTCUSDT:SPOT', hypothesis: 'SPOT_LED_EXPANSION',
          stage: 'EARLY_CHANGE', changedFirst: 'spot_price', changedAtMs: NOW - 200,
          leadMarket: 'SPOT', reasonCodes: [], truth: thesisTruth(),
        },
        forensics: forensicReport(state), correlationIds: [], authority: 'EVIDENCE_ONLY',
      },
      reasonCodes: [], authority: 'EVIDENCE_ONLY', liveMoneyAuthority: 'NONE', currentState: 'CURRENT',
    },
    authority: 'EVIDENCE_ONLY', liveMoneyAuthority: 'NONE',
  };
}

function readFixture(leadershipFreshness = 'FRESH', leadershipCompleteness = 'COMPLETE') {
  const capabilities = TOKEN_EVIDENCE_CAPABILITIES.map((capability) => ({
    capability,
    freshness: capability === 'CROSS_MARKET_LEADERSHIP' ? leadershipFreshness : 'MISSING',
    completeness: capability === 'CROSS_MARKET_LEADERSHIP' && leadershipFreshness !== 'MISSING' ? leadershipCompleteness : 'MISSING',
    lastEvidenceTimeMs: capability === 'CROSS_MARKET_LEADERSHIP' && leadershipFreshness !== 'MISSING' ? NOW - 100 : null,
    sourceIds: capability === 'CROSS_MARKET_LEADERSHIP' && leadershipFreshness !== 'MISSING' ? ['spot-owner', 'perpetual-owner'] : [],
    reasonCodes: capability === 'CROSS_MARKET_LEADERSHIP' && leadershipFreshness === 'MISSING' ? ['PERPETUAL_PRICE_MISSING'] : [],
  }));
  return {
    schemaVersion: 'token-intelligence-owner-read.v1',
    symbol: 'BTCUSDT',
    observedAtMs: NOW,
    projection: {
      state: leadershipFreshness === 'FRESH' ? 'ACTIVE' : 'DEGRADED',
      usdm: { connected: leadershipFreshness === 'FRESH', feedState: leadershipFreshness === 'FRESH' ? 'open' : 'closed' },
      liquidation: { connected: false, feedState: 'closed' },
    },
    markFunding: { state: 'MISSING', sourceId: 'mark', dataset: 'mark', observedAtMs: null, value: null, reasonCodes: ['MISSING'] },
    openInterest: { state: 'MISSING', sourceId: 'oi', dataset: 'oi', observedAtMs: null, value: null, reasonCodes: ['MISSING'] },
    liquidation: { state: 'MISSING', sourceId: 'liq', dataset: 'liq', observedAtMs: null, value: null, reasonCodes: ['MISSING'] },
    routing: {
      symbol: 'BTCUSDT', observedAtMs: NOW, capabilities,
      authority: 'EVIDENCE_ONLY', liveMoneyAuthority: 'NONE',
    },
    bridge: {
      evaluatedAtMs: NOW,
      currentState: 'CURRENT',
      evidenceHistoryCount: 17,
      evidenceHistoryState: 'COMPLETE',
      attention: null,
      thesis: {
        hypothesis: 'SPOT_LED_EXPANSION', stage: 'EARLY_CHANGE', changedFirst: 'spot_price',
        changedAtMs: NOW - 200, leadMarket: 'SPOT', evaluatedAtMs: NOW - 100,
        freshness: 'FRESH', completeness: 'COMPLETE', reasonCodes: [],
      },
      forensics: {
        evaluatedAtMs: NOW - 100,
        freshness: 'FRESH',
        state: 'CLEAR',
        claimAllowed: true,
        checkCount: 10,
        blockingCheckCount: 0,
        warningCheckCount: 0,
        unknownRequiredCheckCount: 0,
        reasonCodes: ['FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR'],
      },
      reasonCodes: [],
    },
    authority: 'EVIDENCE_ONLY',
    liveMoneyAuthority: 'NONE',
  };
}

test('Volume workspace projection preserves exact owner truth and fails leadership closed when non-fresh', () => {
  const fresh = projectVolumeWorkspaceTruth(readFixture('FRESH'), 'BTCUSDT');
  assert.ok(fresh);
  assert.equal(fresh.leadership.leadMarket, 'UNKNOWN');
  assert.equal(fresh.stage.leadMarket, 'SPOT');
  assert.equal(fresh.stage.marketStage, 'EARLY_CHANGE');
  assert.equal(fresh.forensics?.state, 'CLEAR');
  assert.equal(fresh.retainedEvidence.count, 17);
  assert.deepEqual(fresh.capabilities.map((entry) => entry.capability), [...TOKEN_EVIDENCE_CAPABILITIES]);

  for (const state of ['STALE', 'MISSING']) {
    const degraded = projectVolumeWorkspaceTruth(readFixture(state), 'BTCUSDT');
    assert.ok(degraded);
    assert.equal(degraded.leadership.freshness, state);
    assert.equal(degraded.leadership.leadMarket, 'UNKNOWN', `${state} leadership cannot carry a current direction`);
  }
  for (const completeness of ['PARTIAL', 'SAMPLED']) {
    const incomplete = projectVolumeWorkspaceTruth(readFixture('FRESH', completeness), 'BTCUSDT');
    assert.ok(incomplete);
    assert.equal(incomplete.leadership.leadMarket, 'UNKNOWN', `${completeness} leadership cannot claim a complete direction`);
  }
  const nonCurrent = readFixture('FRESH');
  nonCurrent.projection.state = 'DEGRADED';
  const gated = projectVolumeWorkspaceTruth(nonCurrent, 'BTCUSDT');
  assert.ok(gated);
  assert.deepEqual(gated.stage, {
    hypothesis: null, marketStage: null, changedFirst: null, changedAtMs: null,
    leadMarket: 'UNKNOWN',
    evaluatedAtMs: null, freshness: 'MISSING', completeness: 'MISSING',
  });
  assert.equal(gated.leadership.leadMarket, 'UNKNOWN');
  assert.equal(gated.forensics, null, 'degraded projections cannot carry current Bridge forensics');
  const newerCapability = readFixture('FRESH');
  newerCapability.routing.capabilities.find(
    (entry) => entry.capability === 'CROSS_MARKET_LEADERSHIP',
  ).lastEvidenceTimeMs = NOW - 10;
  const cutSeparated = projectVolumeWorkspaceTruth(newerCapability, 'BTCUSDT');
  assert.equal(cutSeparated.leadership.leadMarket, 'UNKNOWN');
  assert.equal(cutSeparated.stage.leadMarket, 'SPOT', 'retained thesis lead stays qualified at its own cut');
  assert.equal(projectVolumeWorkspaceTruth(readFixture(), 'ETHUSDT'), null, 'cross-symbol evidence is never reused');
  assert.equal(projectVolumeWorkspaceTruth(null, 'BTCUSDT'), null);
});

test('Volume projection is a detached deep-frozen Never-throws boundary', () => {
  const source = readFixture();
  const view = projectVolumeWorkspaceTruth(source, 'BTCUSDT');
  assert.ok(view);
  for (const value of [
    view, view.stage, view.leadership, view.leadership.sourceIds, view.markFunding,
    view.markFunding.reasonCodes, view.forensics, view.forensics?.reasonCodes,
    view.capabilities, view.capabilities[0], view.capabilities[0].sourceIds,
  ]) assert.equal(Object.isFrozen(value), true);

  source.bridge.forensics.reasonCodes[0] = 'SOURCE_MUTATED';
  source.routing.capabilities[0].reasonCodes.push('SOURCE_MUTATED');
  assert.deepEqual(view.forensics.reasonCodes, ['FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR']);
  assert.equal(view.capabilities[0].reasonCodes.includes('SOURCE_MUTATED'), false);
  assert.throws(() => { view.stage.marketStage = 'TOO_LATE'; }, TypeError);
  assert.throws(() => { view.leadership.sourceIds.push('forged-owner'); }, TypeError);
  assert.equal(source.bridge.thesis.stage, 'EARLY_CHANGE');
  assert.deepEqual(source.routing.capabilities.find((entry) => entry.capability === 'CROSS_MARKET_LEADERSHIP').sourceIds, [
    'spot-owner', 'perpetual-owner',
  ]);

  let getterReads = 0;
  const accessor = readFixture();
  Object.defineProperty(accessor, 'symbol', {
    enumerable: true,
    get() { getterReads += 1; return 'BTCUSDT'; },
  });
  assert.equal(projectVolumeWorkspaceTruth(accessor, 'BTCUSDT'), null);
  assert.equal(getterReads, 0);
  const throwingProxy = new Proxy({}, { getPrototypeOf() { throw new Error('HOSTILE_PROJECTOR'); } });
  assert.doesNotThrow(() => projectVolumeWorkspaceTruth(throwingProxy, 'BTCUSDT'));
  assert.equal(projectVolumeWorkspaceTruth(throwingProxy, 'BTCUSDT'), null);
  const revoked = Proxy.revocable(readFixture(), {});
  revoked.revoke();
  assert.doesNotThrow(() => projectVolumeWorkspaceTruth(revoked.proxy, 'BTCUSDT'));
  assert.equal(projectVolumeWorkspaceTruth(revoked.proxy, 'BTCUSDT'), null);
  const cyclic = readFixture();
  cyclic.self = cyclic;
  assert.equal(projectVolumeWorkspaceTruth(cyclic, 'BTCUSDT'), null);
});

test('strict Token parser exposes bounded Bridge forensics and rejects hostile or incomplete reports', () => {
  const raw = tokenReadWithForensics();
  const parsed = parseTokenIntelligence(raw, 'BTCUSDT', NOW);
  assert.ok(parsed);
  assert.deepEqual(parsed.bridge.forensics, {
    evaluatedAtMs: NOW - 100,
    freshness: 'FRESH',
    state: 'CLEAR',
    claimAllowed: true,
    checkCount: 10,
    blockingCheckCount: 0,
    warningCheckCount: 0,
    unknownRequiredCheckCount: 0,
    reasonCodes: ['FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR'],
  });
  raw.bridge.artifact.forensics.tradeability.reasonCodes[0] = 'MUTATED_CALLER_ALIAS';
  raw.bridge.artifact.forensics.checks.pop();
  assert.equal(parsed.bridge.forensics.checkCount, 10);
  assert.deepEqual(parsed.bridge.forensics.reasonCodes, ['FORENSICS_FALSE_POSITIVE_SCREEN_CLEAR']);

  const stale = parseTokenIntelligence(tokenReadWithForensics('STALE'), 'BTCUSDT', NOW);
  assert.equal(stale?.bridge.forensics?.freshness, 'STALE');

  const reportCutMismatch = tokenReadWithForensics();
  reportCutMismatch.bridge.artifact.forensics.evaluatedAtMs -= 1;
  assert.equal(parseTokenIntelligence(reportCutMismatch, 'BTCUSDT', NOW), null);

  const truthCutMismatch = tokenReadWithForensics();
  truthCutMismatch.bridge.artifact.forensics.truth.freshness.evaluatedAtMs -= 1;
  truthCutMismatch.bridge.artifact.forensics.truth.freshness.ageMs -= 1;
  assert.equal(parseTokenIntelligence(truthCutMismatch, 'BTCUSDT', NOW), null);

  const falseComplete = tokenReadWithForensics();
  falseComplete.bridge.artifact.forensics.truth.completeness = {
    state: 'MISSING', observedFields: [], missingFields: ['forensics.required'],
    reasonCodes: ['FORENSICS_REQUIRED_EVIDENCE_MISSING'],
  };
  assert.equal(parseTokenIntelligence(falseComplete, 'BTCUSDT', NOW), null);

  const forgedAuthority = tokenReadWithForensics();
  forgedAuthority.bridge.artifact.forensics.truth.authority.sourceId = 'lookalike-forensics';
  assert.equal(parseTokenIntelligence(forgedAuthority, 'BTCUSDT', NOW), null);

  const forgedPolicy = tokenReadWithForensics();
  forgedPolicy.bridge.artifact.forensics.checks[0].severity = 'WARN';
  forgedPolicy.bridge.artifact.forensics.checks[0].required = false;
  assert.equal(parseTokenIntelligence(forgedPolicy, 'BTCUSDT', NOW), null);

  let getterReads = 0;
  const accessor = tokenReadWithForensics();
  Object.defineProperty(accessor.bridge.artifact.forensics, 'checks', {
    enumerable: true,
    get() { getterReads += 1; return []; },
  });
  assert.equal(parseTokenIntelligence(accessor, 'BTCUSDT', NOW), null);
  assert.equal(getterReads, 0, 'forensic accessors are rejected without invocation');

  const hostile = tokenReadWithForensics();
  hostile.bridge.artifact.forensics = new Proxy({}, {
    getPrototypeOf() { throw new Error('hostile forensics prototype'); },
  });
  assert.equal(parseTokenIntelligence(hostile, 'BTCUSDT', NOW), null);

  const sparse = tokenReadWithForensics();
  sparse.bridge.artifact.forensics.checks = new Array(FORENSIC_CHECK_KINDS.length);
  sparse.bridge.artifact.forensics.checks[0] = forensicReport().checks[0];
  assert.equal(parseTokenIntelligence(sparse, 'BTCUSDT', NOW), null);

  const incomplete = tokenReadWithForensics();
  incomplete.bridge.artifact.forensics.checks.pop();
  assert.equal(parseTokenIntelligence(incomplete, 'BTCUSDT', NOW), null, 'all ten owner checks are required');

  const oversizedSequence = tokenReadWithForensics();
  oversizedSequence.bridge.artifact.forensics.truth.temporal.sequence = {
    first: '1'.repeat(129), last: '2'.repeat(129), previous: null,
  };
  assert.equal(parseTokenIntelligence(oversizedSequence, 'BTCUSDT', NOW), null);
  const bigintSequence = tokenReadWithForensics();
  bigintSequence.bridge.artifact.forensics.truth.temporal.sequence = {
    first: 1n, last: '2', previous: null,
  };
  assert.doesNotThrow(() => parseTokenIntelligence(bigintSequence, 'BTCUSDT', NOW));
  assert.equal(parseTokenIntelligence(bigintSequence, 'BTCUSDT', NOW), null);
  const bigintMetric = tokenReadWithForensics();
  bigintMetric.bridge.artifact.forensics.checks[0].metrics = [{
    name: 'hostile_metric', value: 1n, unit: 'ratio',
  }];
  assert.doesNotThrow(() => parseTokenIntelligence(bigintMetric, 'BTCUSDT', NOW));
  assert.equal(parseTokenIntelligence(bigintMetric, 'BTCUSDT', NOW), null);

  const indexThrow = (array) => new Proxy(array, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)) throw new Error('HOSTILE_INDEX_GET');
      return Reflect.get(target, key, receiver);
    },
  });
  const descriptorOnly = tokenReadWithForensics();
  const firstCheck = descriptorOnly.bridge.artifact.forensics.checks[0];
  firstCheck.metrics = indexThrow([{ name: 'fixture_metric', value: 1, unit: 'ratio' }]);
  firstCheck.reasonCodes = indexThrow(firstCheck.reasonCodes);
  firstCheck.truth.provenance.sourceRecordIds = indexThrow(firstCheck.truth.provenance.sourceRecordIds);
  descriptorOnly.bridge.artifact.forensics.tradeability.reasonCodes = indexThrow(
    descriptorOnly.bridge.artifact.forensics.tradeability.reasonCodes,
  );
  descriptorOnly.bridge.artifact.forensics.checks = indexThrow(descriptorOnly.bridge.artifact.forensics.checks);
  let descriptorParsed;
  assert.doesNotThrow(() => { descriptorParsed = parseTokenIntelligence(descriptorOnly, 'BTCUSDT', NOW); });
  assert.ok(descriptorParsed, 'validated data-descriptor values are materialized without hostile index reads');

  const descriptorTrap = tokenReadWithForensics();
  descriptorTrap.bridge.artifact.forensics.checks = new Proxy(descriptorTrap.bridge.artifact.forensics.checks, {
    getOwnPropertyDescriptor() { throw new Error('HOSTILE_DESCRIPTOR'); },
  });
  assert.doesNotThrow(() => parseTokenIntelligence(descriptorTrap, 'BTCUSDT', NOW));
  assert.equal(parseTokenIntelligence(descriptorTrap, 'BTCUSDT', NOW), null);

  const revokedRoot = Proxy.revocable({}, {});
  revokedRoot.revoke();
  assert.doesNotThrow(() => parseTokenIntelligence(revokedRoot.proxy, 'BTCUSDT', NOW));
  assert.equal(parseTokenIntelligence(revokedRoot.proxy, 'BTCUSDT', NOW), null);
  const revokedNested = Proxy.revocable({}, {});
  revokedNested.revoke();
  const nestedRead = tokenReadWithForensics();
  nestedRead.bridge.artifact.forensics = revokedNested.proxy;
  assert.doesNotThrow(() => parseTokenIntelligence(nestedRead, 'BTCUSDT', NOW));
  assert.equal(parseTokenIntelligence(nestedRead, 'BTCUSDT', NOW), null);

  let featurePrototypeReads = 0;
  const statefulFeature = tokenReadWithForensics();
  statefulFeature.bridge.featureSnapshot = new Proxy({ symbol: 'BTCUSDT' }, {
    getPrototypeOf(target) {
      featurePrototypeReads += 1;
      if (featurePrototypeReads > 1) throw new Error('STATEFUL_FEATURE_REINSPECTION');
      return Reflect.getPrototypeOf(target);
    },
  });
  let statefulParsed;
  assert.doesNotThrow(() => { statefulParsed = parseTokenIntelligence(statefulFeature, 'BTCUSDT', NOW); });
  assert.ok(statefulParsed);
  assert.equal(featurePrototypeReads, 1, 'featureSnapshot descriptors are inspected exactly once');

  const primitiveThrower = () => ({
    [Symbol.toPrimitive]() { throw new Error('HOSTILE_COERCION'); },
  });
  for (const mutate of [
    (candidate) => { candidate.bridge.artifact.forensics.truth.authority.kind = primitiveThrower(); },
    (candidate) => { candidate.bridge.artifact.forensics.truth.freshness.state = primitiveThrower(); },
    (candidate) => { candidate.bridge.artifact.forensics.checks[0].check = primitiveThrower(); },
    (candidate) => { candidate.projection.state = primitiveThrower(); },
    (candidate) => {
      candidate.bridge.artifact.forensics.truth.authority.kind = new Proxy({}, {
        get(_target, key) {
          if (key === Symbol.toPrimitive) throw new Error('HOSTILE_COERCION_PROXY');
          return undefined;
        },
      });
    },
  ]) {
    const coercion = tokenReadWithForensics();
    mutate(coercion);
    let coercionResult;
    assert.doesNotThrow(() => { coercionResult = parseTokenIntelligence(coercion, 'BTCUSDT', NOW); });
    assert.equal(coercionResult, null);
  }
});

test('Token parser binds thesis truth at the artifact cut and keeps stale or partial stage historical', () => {
  const parsed = parseTokenIntelligence(tokenReadWithForensics(), 'BTCUSDT', NOW);
  assert.equal(parsed?.bridge.thesis?.freshness, 'FRESH');
  assert.equal(parsed?.bridge.thesis?.completeness, 'COMPLETE');
  assert.equal(parsed?.bridge.thesis?.evaluatedAtMs, NOW - 100);

  for (const [freshness, completeness] of [['STALE', 'COMPLETE'], ['FRESH', 'PARTIAL']]) {
    const raw = tokenReadWithForensics();
    raw.bridge.artifact.thesis.truth = thesisTruth(freshness, completeness);
    const ownerRead = parseTokenIntelligence(raw, 'BTCUSDT', NOW);
    assert.ok(ownerRead);
    const view = projectVolumeWorkspaceTruth(ownerRead, 'BTCUSDT');
    assert.ok(view);
    assert.equal(view.stage.marketStage, null);
    assert.equal(view.stage.hypothesis, null);
    assert.equal(view.leadership.leadMarket, 'UNKNOWN');
    assert.equal(view.stage.freshness, freshness);
    assert.equal(view.stage.completeness, completeness);
  }

  const wrongCut = tokenReadWithForensics();
  wrongCut.bridge.artifact.thesis.truth.freshness.evaluatedAtMs -= 1;
  wrongCut.bridge.artifact.thesis.truth.freshness.ageMs -= 1;
  assert.equal(parseTokenIntelligence(wrongCut, 'BTCUSDT', NOW), null);
  const wrongOwner = tokenReadWithForensics();
  wrongOwner.bridge.artifact.thesis.truth.authority.dataset = 'lookalike-thesis';
  assert.equal(parseTokenIntelligence(wrongOwner, 'BTCUSDT', NOW), null);

  const maximumProvenance = tokenReadWithForensics();
  maximumProvenance.bridge.artifact.thesis.truth.provenance.sourceRecordIds = Array.from(
    { length: 512 }, (_, index) => `source-record-${index}`,
  );
  maximumProvenance.bridge.artifact.thesis.truth.provenance.sourceSet = Array.from(
    { length: 512 }, (_, index) => `source-set-${index}`,
  );
  maximumProvenance.bridge.artifact.thesis.truth.provenance.transforms = Array.from(
    { length: 512 }, (_, index) => `transform-${index}`,
  );
  assert.ok(parseTokenIntelligence(maximumProvenance, 'BTCUSDT', NOW));
  maximumProvenance.bridge.artifact.thesis.truth.provenance.transforms.push('transform-512');
  assert.equal(parseTokenIntelligence(maximumProvenance, 'BTCUSDT', NOW), null);
});

test('browser forensics parser conforms to an actual intelligenceFoundation report', () => {
  const result = analyzeFalsePositiveForensics({
    symbol: 'BTCUSDT',
    instrumentId: 'instrument:BTCUSDT:SPOT',
    evaluatedAtMs: NOW - 100,
    candidateObservedAtMs: null,
    intendedQuoteNotional: null,
    configurationVersion: 'fixture-config-1',
    featureVersion: 'features-1',
    evidence: [],
    features: [],
    history: [],
  });
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.failure));
  const raw = tokenReadWithForensics();
  raw.bridge.artifact.forensics = structuredClone(result.value);
  const parsed = parseTokenIntelligence(raw, 'BTCUSDT', NOW);
  assert.ok(parsed);
  assert.equal(parsed.bridge.forensics.state, 'UNKNOWN');
  assert.equal(parsed.bridge.forensics.freshness, 'STALE');
  assert.equal(parsed.bridge.forensics.checkCount, FORENSIC_CHECK_KINDS.length);
});

test('Volume outcome absence is explicit and cannot become a fabricated zero or inferred false-positive label', () => {
  assert.deepEqual(VOLUME_OUTCOME_OWNER_TRUTH, {
    state: 'NOT_CONFIGURED',
    frozenPreMoveCount: null,
    completedOutcomeCount: null,
    falsePositiveOutcomeCount: null,
    reasonCodes: ['OUTCOME_CAPTURE_OWNER_NOT_MOUNTED', 'RETAINED_EVIDENCE_IS_NOT_OUTCOME_TRUTH'],
  });
  const view = projectVolumeWorkspaceTruth(readFixture(), 'BTCUSDT');
  assert.equal(view.outcomeOwner, VOLUME_OUTCOME_OWNER_TRUTH);
  assert.equal(view.outcomeOwner.completedOutcomeCount, null);
});

test('Volume polls only the expanded exact symbol and never promotes local top-book or client calculations', async () => {
  const source = await readSource('pages/VolumeScanner.tsx');
  const tokenSource = await readSource('pages/TokenDetail.tsx');
  assert.match(source, /if \(expanded === null\) return;/);
  assert.match(source, /const symbol = expanded;/);
  assert.match(source, /setExpandedIntelligence\(null\);/);
  assert.match(source, /next\.symbol !== symbol/);
  assert.match(source, /return poll\.stop;/);
  assert.equal((source.match(/\/api\/intelligence\/token\?symbol=/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\/api\/futures\/(?:oi-hist|funding-hist|liquidations)/);
  assert.doesNotMatch(source, /\/api\/book|\/api\/depth|@depth/);
  assert.doesNotMatch(source, /pump probability|syntheticConfidence|setConfidence|compute\w*Confidence|confidence\s*=\s*Math/i);
  assert.doesNotMatch(source, /\?\? 0/);
  assert.match(source, /Engine Feeds Current/);
  assert.match(source, /history count is not outcome truth/);
  assert.match(source, /latest-per-symbol lower bound/);
  assert.match(source, /Pre-move freeze and empirical false-positive outcome owner not mounted/);
  assert.match(source, /Wash-Like Churn Score/);
  assert.match(source, /Latest Owner Thesis · Stage/);
  assert.match(source, /Latest Owner Thesis Lead/);
  assert.match(source, /Cross-market Capability/);
  assert.match(source, /Latest Owner Forensics/);
  assert.match(source, /_AT_CUT/);
  assert.doesNotMatch(source, /Current Hypothesis · Stage/);
  assert.doesNotMatch(source, /Current False-positive Screen/);
  assert.match(source, /ownerTruth\.capabilities\.map/);
  assert.match(tokenSource, /thesis\?\.freshness === 'FRESH'/);
  assert.match(tokenSource, /thesis\.completeness === 'COMPLETE'/);
  assert.match(tokenSource, /Changed First · Latest At Cut/);
  assert.match(tokenSource, /Hypothesis · Latest At Cut/);
  assert.match(tokenSource, /Latest owner thesis.*value withheld/);
});

test('Volume evidence layout remains bounded at wide and narrow containers', async () => {
  const css = await readSource('pages/VolumeScanner.css');
  assert.match(css, /\.volx-owner-evidence\s*\{/);
  assert.match(css, /\.volx-owner-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.volx-capabilities\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@container \(max-width: 760px\)[\s\S]*\.volx-capabilities\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.volx-owner-evidence > header strong,[\s\S]*font-size:\s*12\.5px;[\s\S]*font-weight:\s*470;/);
  assert.match(css, /\.volx-owner-evidence > header small,[\s\S]*font-size:\s*10\.5px;[\s\S]*font-weight:\s*410;/);
});
