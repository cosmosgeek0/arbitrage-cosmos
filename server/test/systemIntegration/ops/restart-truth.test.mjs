import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanonicalRestartTruthCoordinator,
  projectCanonicalRestartTruth,
} from '../../../dist/systemIntegration/ops/index.js';
import { evaluateFreshness } from '../../../dist/foundation/contracts/index.js';
import {
  component as canonicalComponent,
  components as canonicalComponents,
} from '../supervisor/fixtures.mjs';

const NOW = 1_900_000_000_000;

function utcSeconds(value) {
  return new Date(Math.floor(value / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function owner(componentId, overrides = {}) {
  const base = canonicalComponent(componentId);
  const publicSourceTimestamp = componentId === 'public-spot-source' || componentId === 'public-usdm-source'
    ? {
        sourceTimeMs: NOW - 100,
        receivedAtMs: NOW - 80,
        maxAgeMs: 5_000,
        authority: 'LIVE_PUBLIC',
        completeness: 'COMPLETE',
        sourceId: `restart-truth.${componentId}`,
      }
    : null;
  const recorded = componentId === 'capital-supervision' || componentId === 'reconciliation'
    ? {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
        truthLabel: 'RECORDED_REPLAY',
        authority: 'RECORDED_REPLAY',
        sourceTimestamp: null,
        freshness: null,
      }
    : {};
  return {
    ...base,
    ...(publicSourceTimestamp === null ? {} : {
      sourceTimestamp: publicSourceTimestamp,
      freshness: evaluateFreshness(publicSourceTimestamp, NOW),
      lastReceiveAtMs: NOW - 80,
      lastProcessAtMs: NOW - 60,
      lastSuccessAtMs: NOW - 40,
    }),
    ...recorded,
    ...overrides,
  };
}

function restartComponents(overrides = {}) {
  const replacements = new Map([
    ['public-spot-source', owner('public-spot-source', overrides['public-spot-source'])],
    ['public-usdm-source', owner('public-usdm-source', overrides['public-usdm-source'])],
    ['capital-supervision', owner('capital-supervision', overrides['capital-supervision'])],
    ['reconciliation', owner('reconciliation', overrides.reconciliation)],
  ]);
  return canonicalComponents().map((entry) => replacements.get(entry.componentId) ?? entry);
}

function supervisor(overrides = {}) {
  const base = {
    evaluatedAtMs: NOW,
    components: restartComponents(),
    summaries: {
      capital: {
        truthLabel: 'RECORDED_REPLAY',
        accountTruthState: 'AVAILABLE',
      },
      reconciliation: {
        truthLabel: 'RECORDED_REPLAY',
        status: 'EXACT',
        blocksNewExposure: false,
        evaluatedAtMs: NOW,
      },
    },
  };
  return {
    ...base,
    ...overrides,
    summaries: { ...base.summaries, ...(overrides.summaries ?? {}) },
  };
}

function ops(overrides = {}) {
  return {
    source: 'CANONICAL_SUPERVISOR_READBACK',
    observedAtUtc: utcSeconds(NOW),
    validUntilUtc: utcSeconds(NOW + 10 * 60_000),
    deploymentFrozen: false,
    exposureState: 'NONE',
    ambiguityState: 'NONE',
    recoveryState: 'NONE',
    currentSchemaVersion: 1,
    rollbackFloor: 1,
    ...overrides,
  };
}

test('canonical restart coordinator binds one exact supervisor cut to ops and retains one passive readback', async () => {
  const cut = supervisor();
  let supervisorReads = 0;
  let opsReads = 0;
  const coordinator = createCanonicalRestartTruthCoordinator({
    clock: { nowMs: () => NOW },
    readSupervisor() {
      supervisorReads += 1;
      return cut;
    },
    readOps(observedCut) {
      opsReads += 1;
      assert.strictEqual(observedCut, cut);
      return ops();
    },
  });

  assert.deepEqual(coordinator.readRestartTruth(NOW), {
    publicSourceTruth: 'UNKNOWN',
    accountTruth: 'UNAVAILABLE',
    reconciliationTruth: 'UNKNOWN',
    observedAtMs: NOW,
  });
  assert.equal(supervisorReads, 0);
  assert.equal(opsReads, 0);

  const refreshed = await coordinator.refreshRestartTruth(NOW);
  assert.deepEqual(refreshed, {
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs: NOW,
  });
  assert.strictEqual(coordinator.readRestartTruth(NOW), refreshed);
  assert.equal(supervisorReads, 1);
  assert.equal(opsReads, 1);
});

test('restart truth never upgrades stale synthetic active ambiguous recovery or malformed evidence', () => {
  const staleTimestamp = {
    sourceTimeMs: NOW - 10_000,
    receivedAtMs: NOW - 9_900,
    maxAgeMs: 5_000,
    authority: 'RECORDED_REPLAY',
    completeness: 'COMPLETE',
    sourceId: 'fixture.public-spot-source.stale',
  };
  const staleSources = supervisor({
    components: restartComponents({
      'public-spot-source': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED'],
        truthLabel: 'RECORDED_REPLAY',
        authority: 'RECORDED_REPLAY',
        readiness: 'BLOCKED',
        sourceTimestamp: staleTimestamp,
        freshness: evaluateFreshness(staleTimestamp, NOW),
      },
    }),
  });
  assert.equal(projectCanonicalRestartTruth(staleSources, ops(), NOW).publicSourceTruth, 'STALE');

  const syntheticCapital = supervisor({
    components: restartComponents({
      'capital-supervision': {
        releaseStatuses: ['BUILT_AND_TESTED', 'WIRED', 'SYNTHETIC_ONLY'],
        truthLabel: 'SYNTHETIC_ONLY',
        authority: 'SYNTHETIC_TEST',
      },
    }),
    summaries: { capital: { truthLabel: 'SYNTHETIC_ONLY', accountTruthState: 'SYNTHETIC_FIXTURE' } },
  });
  assert.equal(projectCanonicalRestartTruth(syntheticCapital, ops(), NOW).accountTruth, 'UNKNOWN');

  for (const hostileOps of [
    ops({ exposureState: 'ACTIVE' }),
    ops({ ambiguityState: 'AMBIGUOUS' }),
    ops({ recoveryState: 'RECOVERY_REQUIRED' }),
    ops({ validUntilUtc: 'malformed' }),
  ]) {
    const truth = projectCanonicalRestartTruth(supervisor(), hostileOps, NOW);
    assert.equal(truth.accountTruth, 'UNKNOWN');
    assert.equal(truth.reconciliationTruth, 'UNKNOWN');
  }

  assert.deepEqual(projectCanonicalRestartTruth({ evaluatedAtMs: NOW, components: [] }, ops(), NOW), {
    publicSourceTruth: 'UNKNOWN',
    accountTruth: 'UNAVAILABLE',
    reconciliationTruth: 'UNKNOWN',
    observedAtMs: NOW,
  });
});

test('restart truth rejects duplicate malformed truncated and semantically bogus canonical evidence', () => {
  const duplicate = supervisor({
    components: [...restartComponents(), owner('public-spot-source')],
  });
  const malformedTimestamp = supervisor({
    components: restartComponents({ 'public-spot-source': { sourceTimestamp: {} } }),
  });
  const missingFreshness = supervisor({
    components: restartComponents({ 'public-spot-source': { freshness: null } }),
  });
  const wrongOwner = supervisor({
    components: restartComponents({ 'public-spot-source': { owner: 'CAPITAL_SUPERVISION' } }),
  });
  const bogusAccount = supervisor({
    summaries: { capital: { truthLabel: 'RECORDED_REPLAY', accountTruthState: 'BOGUS' } },
  });
  const bogusReconciliation = supervisor({
    summaries: {
      reconciliation: {
        truthLabel: 'RECORDED_REPLAY',
        status: 'BOGUS',
        blocksNewExposure: false,
        evaluatedAtMs: NOW,
      },
    },
  });
  const truncatedOps = { ...ops() };
  delete truncatedOps.currentSchemaVersion;

  for (const hostile of [duplicate, malformedTimestamp, missingFreshness, wrongOwner]) {
    assert.deepEqual(projectCanonicalRestartTruth(hostile, ops(), NOW), {
      publicSourceTruth: 'UNKNOWN',
      accountTruth: 'UNAVAILABLE',
      reconciliationTruth: 'UNKNOWN',
      observedAtMs: NOW,
    });
  }
  assert.equal(projectCanonicalRestartTruth(bogusAccount, ops(), NOW).accountTruth, 'UNKNOWN');
  assert.equal(projectCanonicalRestartTruth(bogusReconciliation, ops(), NOW).reconciliationTruth, 'UNKNOWN');
  assert.equal(projectCanonicalRestartTruth(supervisor(), truncatedOps, NOW).accountTruth, 'UNKNOWN');
  assert.equal(projectCanonicalRestartTruth(supervisor(), truncatedOps, NOW).reconciliationTruth, 'UNKNOWN');
});

test('restart coordinator evaluates one async cut against a post-read injected clock', async () => {
  let currentMs = NOW;
  const supervisorCut = supervisor({ evaluatedAtMs: NOW + 1 });
  const coordinator = createCanonicalRestartTruthCoordinator({
    clock: { nowMs: () => currentMs },
    readSupervisor() {
      currentMs = NOW + 1;
      return supervisorCut;
    },
    readOps(observedCut) {
      assert.strictEqual(observedCut, supervisorCut);
      currentMs = NOW + 1_001;
      return ops({
        observedAtUtc: utcSeconds(NOW + 1_000),
        validUntilUtc: utcSeconds(NOW + 10 * 60_000 + 1_000),
      });
    },
  });

  assert.deepEqual(await coordinator.refreshRestartTruth(NOW), {
    publicSourceTruth: 'FRESH',
    accountTruth: 'FRESH',
    reconciliationTruth: 'FRESH',
    observedAtMs: NOW + 1_001,
  });
});
