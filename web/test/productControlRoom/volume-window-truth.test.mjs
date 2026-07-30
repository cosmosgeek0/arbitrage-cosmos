import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

function volumeRow(symbol = 'BTCUSDT') {
  return {
    symbol,
    base: symbol.replace(/USDT$/, ''),
    state: 'IDLE',
    price: 100,
    lastTradeTs: NOW - 100,
    baseline: {
      ready: true,
      samples: 30,
      confidence: 1,
      quotePerSecNorm: 1,
      tradesPerSecNorm: 1,
      quotePerMinMedian: 60,
      quotePerMinMad: 0,
      isDead: false,
    },
    windows: {
      '5s': {
        quoteVolume: 10,
        tradeCount: 2,
        avgTradeSize: 5,
        priceMovePct: -0.1,
        takerBuyRatio: 0.5,
        largeTradeCount: 0,
      },
    },
    volumeMultiple: { '5s': 2 },
    tradeCountMultiple: { '5s': 2 },
    spreadBps: 1,
    topDepthUsd: 1_000,
    depthScore: 0.8,
    depthVsNorm: 1.4,
    takerBuyRatio: 0.5,
    washScore: 0.1,
    accelerationPctPerMin: -0.2,
    focusReason: null,
    focusAgeMs: 0,
    decisionKind: 'ignore',
    rejectCode: null,
    reason: 'Volume within own baseline',
    correlationId: null,
    decisionTs: NOW - 100,
    proposal: null,
  };
}

function volumeSnapshot(rows = [volumeRow()]) {
  const baselineReady = rows.filter((row) => row.baseline.ready).length;
  return {
    updatedAt: NOW - 50,
    status: {
      running: true,
      streamState: 'open',
      streamConnections: 1,
      openConnections: 1,
      bookState: 'fresh',
      universeSize: rows.length,
      eligibleSize: rows.length,
      observedSymbols: rows.filter((row) => (
        row.lastTradeTs !== null
        && NOW - 50 - row.lastTradeTs >= 0
        && NOW - 50 - row.lastTradeTs < 60_000
      )).length,
      baselineReady,
      baselineTotal: rows.length,
      baselineCompleted: baselineReady,
      baselineFailed: 0,
      watching: rows.filter((row) => row.state === 'WATCHING').length,
      focused: rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length,
      openProposals: rows.filter((row) => (
        row.proposal != null
        && (row.proposal.status === 'open' || row.proposal.status === 'updated')
      )).length,
      lastTradeTs: NOW - 100,
      lastBookTs: NOW - 200,
      tradeMessages: 8_000,
      source: 'Binance Spot Aggregate Trade Streams',
      bookSource: 'Binance Spot All Book Tickers',
      baselineSource: 'Binance Spot 1m Klines',
    },
    thresholds: {
      volume1s: 2,
      volume5s: 2,
      tradeCount: 2,
      followthroughPct: 0.1,
      maxSpreadBps: 10,
      minDepthScore: 0.5,
      baselineMinutes: 30,
    },
    rows,
  };
}

test('Volume reserves zero for current evidence and fails runtime, market, account, and research truth closed', async (context) => {
  const cssHooks = registerHooks({
    load(url, hookContext, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, hookContext);
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });
  context.after(() => cssHooks.deregister());
  const {
    VOLUME_RESEARCH_TRUTH,
    currentFactLabel,
    decodeVolumeRuntimeSnapshot,
    isRejectedVolumeRow,
    resolveVolumeRuntimeTruth,
    volumeRowsCurrent,
    windowCountLabel,
  } = await import('../../src/pages/VolumeScanner.tsx');

  assert.equal(windowCountLabel(undefined, 'tradeCount', ' Trades'), 'UNKNOWN');
  assert.equal(windowCountLabel(undefined, 'largeTradeCount'), 'UNKNOWN');

  assert.equal(windowCountLabel({ tradeCount: 0 }, 'tradeCount', ' Trades'), '0 Trades');
  assert.equal(windowCountLabel({ largeTradeCount: 0 }, 'largeTradeCount'), '0');

  assert.equal(windowCountLabel({ tradeCount: 12 }, 'tradeCount', ' Trades'), '12 Trades');
  assert.equal(windowCountLabel({ largeTradeCount: 3 }, 'largeTradeCount'), '3');

  assert.equal(currentFactLabel(false, 0), 'UNKNOWN');
  assert.equal(currentFactLabel(false, '12.50000000'), 'UNKNOWN');
  assert.equal(currentFactLabel(true, 0), 0);
  assert.equal(currentFactLabel(true, '12.50000000'), '12.50000000');
  assert.equal(currentFactLabel(true, null), 'UNKNOWN');

  const decoded = decodeVolumeRuntimeSnapshot(volumeSnapshot());
  assert.ok(decoded);
  assert.equal(volumeRowsCurrent(decoded), true);

  const explicitlyRejected = volumeRow();
  explicitlyRejected.state = 'REJECTED';
  assert.equal(isRejectedVolumeRow(explicitlyRejected), true);
  const cooldownRejected = volumeRow();
  cooldownRejected.state = 'COOLDOWN';
  assert.equal(isRejectedVolumeRow(cooldownRejected), true);
  const decisionRejected = volumeRow();
  decisionRejected.decisionKind = 'reject';
  decisionRejected.rejectCode = 'SPREAD_TOO_WIDE';
  assert.equal(isRejectedVolumeRow(decisionRejected), true);
  assert.equal(isRejectedVolumeRow(volumeRow()), false);

  const duplicateRows = [volumeRow(), volumeRow()];
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot(duplicateRows)), null);

  const negativeWindow = volumeRow();
  negativeWindow.windows['5s'].quoteVolume = -1;
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([negativeWindow])), null);

  const missingProposalField = volumeRow();
  delete missingProposalField.proposal;
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([missingProposalField])), null);

  assert.equal(decodeVolumeRuntimeSnapshot({
    ...volumeSnapshot(),
    status: { ...volumeSnapshot().status, baselineReady: 2 },
  }), null);
  assert.equal(decodeVolumeRuntimeSnapshot({
    ...volumeSnapshot(),
    status: { ...volumeSnapshot().status, openProposals: 1 },
  }), null);
  assert.equal(decodeVolumeRuntimeSnapshot({
    ...volumeSnapshot(),
    status: { ...volumeSnapshot().status, watching: -1 },
  }), null);

  const transitioningProposal = volumeRow();
  transitioningProposal.state = 'PROPOSED';
  transitioningProposal.decisionKind = 'proposal';
  const decodedTransition = decodeVolumeRuntimeSnapshot(volumeSnapshot([transitioningProposal]));
  assert.ok(decodedTransition);
  assert.equal(volumeRowsCurrent(decodedTransition), false);

  const futureRow = volumeRow();
  futureRow.lastTradeTs = NOW + 1;
  const decodedFutureRow = decodeVolumeRuntimeSnapshot(volumeSnapshot([futureRow]));
  assert.ok(decodedFutureRow);
  assert.equal(volumeRowsCurrent(decodedFutureRow), false);

  const nowMs = NOW;
  const currentStatus = {
    running: true,
    streamState: 'open',
    streamConnections: 4,
    openConnections: 4,
    bookState: 'fresh',
    eligibleSize: 16,
    observedSymbols: 16,
    lastTradeTs: nowMs - 100,
    lastBookTs: nowMs - 200,
    tradeMessages: 8_000,
  };
  const runtimeInput = (overrides = {}) => ({
    canonicalState: 'READY',
    canonicalReason: null,
    snapshotUpdatedAtMs: nowMs - 50,
    snapshotStatus: currentStatus,
    rowCount: 16,
    rowContractCurrent: true,
    requestError: null,
    nowMs,
    ...overrides,
  });

  assert.deepEqual(resolveVolumeRuntimeTruth(runtimeInput()), {
    current: true,
    state: 'CURRENT',
    label: 'Engine Feeds Current',
    reason: null,
  });
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    requestError: 'Volume runtime unavailable',
  })).state, 'UNAVAILABLE');
  assert.match(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotStatus: { ...currentStatus, running: false },
  })).reason, /^VOLUME_RUNTIME_STOPPED/);
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    canonicalState: 'UNAVAILABLE',
    canonicalReason: 'CANONICAL_CONTINUITY_UNKNOWN',
  })).reason, 'CANONICAL_CONTINUITY_UNKNOWN');
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    canonicalState: 'LOADING',
    snapshotUpdatedAtMs: null,
    snapshotStatus: null,
    rowCount: null,
    rowContractCurrent: null,
  })).state, 'STARTING');
  assert.match(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotStatus: { ...currentStatus, streamState: 'degraded' },
  })).reason, /^VOLUME_SOURCE_NOT_CURRENT/);
  assert.match(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotStatus: { ...currentStatus, openConnections: 3 },
  })).reason, /^VOLUME_STREAM_COVERAGE_NOT_CURRENT/);
  assert.match(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotStatus: { ...currentStatus, observedSymbols: 15 },
  })).reason, /^VOLUME_SYMBOL_COVERAGE_NOT_CURRENT/);
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    rowContractCurrent: false,
  })).reason, 'VOLUME_ROW_CONTRACT_NOT_CURRENT');
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotStatus: { ...currentStatus, tradeMessages: Number.NaN },
  })).reason, 'VOLUME_RUNTIME_CONTRACT_INVALID');
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotUpdatedAtMs: nowMs - 10_000,
  })).reason, 'VOLUME_SOURCE_TIMESTAMPS_NOT_CURRENT');
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    snapshotStatus: { ...currentStatus, lastBookTs: nowMs + 1 },
  })).reason, 'VOLUME_SOURCE_TIMESTAMPS_NOT_CURRENT');
  assert.equal(resolveVolumeRuntimeTruth(runtimeInput({
    canonicalState: 'LOADING',
  })).state, 'STARTING');

  assert.equal(VOLUME_RESEARCH_TRUTH.sourceCommit, '88751475d2b4f30b080ac947f478a4bbc38cbbdf');
  assert.equal(VOLUME_RESEARCH_TRUTH.terminalBlob, '26a8c1b068bdd9a63c0b1f9ea8e9b232c4b8aca8');
  assert.equal(VOLUME_RESEARCH_TRUTH.testStatus, 'INVALID_TEST');
  assert.equal(VOLUME_RESEARCH_TRUTH.measurementStatus, 'UNMEASURED');
  assert.equal(VOLUME_RESEARCH_TRUTH.goNoGo, 'NOT_APPLICABLE');
  assert.deepEqual(VOLUME_RESEARCH_TRUTH.economics, {
    eventSample: null,
    netSyntheticUsdtPer1000: null,
    netUsdPer1000: null,
    confidenceInterval95: null,
    drawdown: null,
  });
  assert.equal(VOLUME_RESEARCH_TRUTH.accountEffectiveFees, 'UNKNOWN');
  assert.equal(VOLUME_RESEARCH_TRUTH.capacity, 'UNKNOWN');
  assert.equal(VOLUME_RESEARCH_TRUTH.executionAuthority, 'NONE');
  assert.equal(VOLUME_RESEARCH_TRUTH.repairAuthority, 'NONE');
  assert.equal(VOLUME_RESEARCH_TRUTH.rerunAuthority, 'NONE');
  assert.equal(Object.isFrozen(VOLUME_RESEARCH_TRUTH), true);
  assert.equal(Object.isFrozen(VOLUME_RESEARCH_TRUTH.economics), true);
  assert.equal(Object.isFrozen(VOLUME_RESEARCH_TRUTH.reasonCodes), true);

  const source = await readFile(new URL('../../src/pages/VolumeScanner.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetchJson<unknown>\('\/api\/engine\/volume'/);
  assert.match(source, /const decoded = decodeVolumeRuntimeSnapshot\(raw\)/);
  assert.match(source, /const rows = volumeTruth\.current && Array\.isArray\(snapshot\?\.rows\) \? snapshot\.rows : \[\]/);
  assert.match(source, /const marketCurrent = marketStatus === 'CURRENT'/);
  assert.match(source, /const accountCurrent = privateReadSource !== 'PENDING'/);
  assert.match(source, /volumeTruth\.current \? snapshot\?\.status\.openProposals \?\? 'UNKNOWN' : 'UNKNOWN'/);
  assert.match(source, /Frozen Research Verdict · …bbdf/);
});
