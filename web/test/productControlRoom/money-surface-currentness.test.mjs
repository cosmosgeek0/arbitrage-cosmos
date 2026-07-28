import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  basisRuntimeCurrent,
  decodeBasisRuntimeSnapshot,
  decodeDashboardPnlData,
  decodeVolumeRuntimeSnapshot,
  hasAttachedOpenProposal,
  volumeRuntimeCurrent,
} from '../../src/components/MoneySurfaceRuntime.ts';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 6, 28, 1, 0, 0);

function basisRow(symbol = 'BTCUSDT') {
  return {
    symbol,
    base: symbol.replace(/USDT$/, ''),
    state: 'IDLE',
    direction: 'long_spot_short_perp',
    spotBid: 100,
    spotAsk: 101,
    perpBid: 102,
    perpAsk: 103,
    markPrice: 102,
    spotSpreadBps: 1,
    perpSpreadBps: 1,
    quoteVolume24h: 1_000,
    executableGapPct: 1,
    alternateGapPct: -1,
    gapAgeMs: 100,
    persistTicks: 1,
    gapSlopePctPerMin: -0.1,
    gapStabilityCv: 0.1,
    fundingRate: -0.0001,
    nextFundingTs: NOW + 60_000,
    fundingCarryPct: -0.01,
    fundingFlipRisk: 0.2,
    expectedHoldMs: 60_000,
    costs: {
      feesPct: 0.1,
      slippagePct: 0.1,
      fundingDragPct: 0.01,
      borrowCostPct: 0,
      totalPct: 0.21,
    },
    netEdgePct: 0.79,
    depthScore: 0.8,
    slippagePct: 0.1,
    ladderBacked: true,
    bookPressure: 1.4,
    dataQuality: {
      score: 0.9,
      spotStalenessMs: 100,
      perpStalenessMs: 100,
      legSkewMs: 0,
      markDivergenceBps: 1,
      suspectReasons: [],
    },
    borrow: {
      status: 'not_needed',
      ok: true,
      rejectCode: null,
      human: 'No borrow needed',
      costPctOverHold: 0,
    },
    decisionKind: 'ignore',
    rejectCode: null,
    reason: 'Waiting',
    correlationId: null,
    decisionTs: NOW - 100,
    priority: { score: 1.2 },
    proposal: null,
  };
}

function basisProposal(status = 'open') {
  return {
    id: 'basis-proposal-1',
    status,
    netEdgePct: 0.79,
    confidence: 0.8,
    invalidation: 'Gap closes',
    stagedSizes: [{ stage: 1, fraction: 1, notionalUsd: 10 }],
  };
}

function basisSnapshot(rows = []) {
  return {
    updatedAt: NOW,
    status: {
      running: true,
      bookState: 'fresh',
      markState: 'fresh',
      universeSize: rows.length,
      watching: rows.filter((row) => row.state === 'WATCHING').length,
      focused: rows.filter((row) => row.state === 'FOCUS').length,
      openProposals: rows.filter((row) => row.state === 'PROPOSED').length,
      rejected: rows.filter((row) => row.decisionKind === 'reject').length,
      borrowBlocked: rows.filter((row) => row.rejectCode?.startsWith('borrow_')).length,
      verifiedBorrow: rows.filter((row) => row.borrow.status === 'available' && row.borrow.ok).length,
      dataQualityPassing: rows.filter((row) => row.dataQuality.score >= 0.8).length,
      lastBookTs: NOW - 100,
      lastMarkTs: NOW - 100,
      lastTickTs: NOW - 100,
      ticks: 1,
      lastError: null,
      bookSource: 'public book',
      markSource: 'public mark',
      borrowSource: 'private read not configured',
    },
    thresholds: {
      watchGapPct: 0.1,
      focusGapPct: 0.2,
      minNetBasisPct: 0.1,
      feesPct: 0.1,
      persistTicks: 3,
      maxSpreadBps: 10,
      minDepthScore: 0.5,
      minDataQuality: 0.8,
      intendedNotionalUsd: 10,
    },
    rows,
  };
}

function volumeRow(symbol = 'BTCUSDT') {
  return {
    symbol,
    base: symbol.replace(/USDT$/, ''),
    state: 'IDLE',
    price: 100,
    lastTradeTs: NOW - 100,
    baseline: {
      ready: false,
      samples: 0,
      confidence: 0,
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
    volumeMultiple: { '5s': null },
    tradeCountMultiple: { '5s': null },
    spreadBps: 1,
    topDepthUsd: 1_000,
    depthScore: 0.8,
    depthVsNorm: 1.4,
    takerBuyRatio: 0.5,
    washScore: 0.1,
    accelerationPctPerMin: -0.2,
    focusReason: null,
    focusAgeMs: 0,
    decisionKind: 'warming',
    rejectCode: null,
    reason: 'Baseline warming',
    correlationId: null,
    decisionTs: NOW - 100,
    proposal: null,
  };
}

function volumeProposal(status = 'open') {
  return {
    id: 'volume-proposal-1',
    status,
    direction: 'long',
    confidence: 0.8,
    reason: 'Volume expansion',
  };
}

function volumeSnapshot(rows = [volumeRow()]) {
  const baselineReady = rows.filter((row) => row.baseline.ready).length;
  return {
    updatedAt: NOW,
    status: {
      running: true,
      streamState: 'open',
      streamConnections: 1,
      openConnections: 1,
      bookState: 'fresh',
      universeSize: rows.length,
      eligibleSize: rows.length,
      observedSymbols: rows.filter((row) => row.lastTradeTs !== null && NOW - row.lastTradeTs < 60_000).length,
      baselineReady,
      baselineTotal: rows.length,
      baselineCompleted: baselineReady,
      baselineFailed: 0,
      watching: rows.filter((row) => row.state === 'WATCHING').length,
      focused: rows.filter((row) => row.state === 'FOCUS' || row.state === 'PROPOSED').length,
      openProposals: rows.filter((row) => row.proposal && ['open', 'updated'].includes(row.proposal.status)).length,
      lastTradeTs: NOW - 100,
      lastBookTs: NOW - 100,
      tradeMessages: 1,
      source: 'public aggregate trades',
      bookSource: 'public books',
      baselineSource: 'public klines',
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

test('Dashboard withholds retained supervisor and private facts from current presentation', async () => {
  const source = await read('pages/Dashboard.tsx');

  assert.match(source, /const productCurrent = retainedProductSnapshot !== null && productBinding\.continuity === 'PROVEN'/);
  assert.match(source, /const productSnapshot = productCurrent \? retainedProductSnapshot : null/);
  assert.match(source, /const privateReadGuard = projectPrivateReadGuard\(\{[\s\S]*?source: privateReadSource,[\s\S]*?error: privateReadError/);
  assert.match(source, /const privateGuardCurrent = privateReadGuard\.overallTone === 'ok'/);
  assert.match(source, /const pnlReadEnabled = compatibilityCurrent[\s\S]*?state\?\.privateAccountTruth === 'AVAILABLE'/);
  assert.match(source, /useDashboardSources\(refreshTick, pnlReadEnabled, pnlReadEnabled \? null : pnlReadBlocker\)/);
  const pnlHook = source.slice(
    source.indexOf('function useDashboardSources'),
    source.indexOf('function StatusMark'),
  );
  assert.match(pnlHook, /if \(!pnlReadEnabled\) \{[\s\S]*?data: null,[\s\S]*?error: pnlReadBlocker[\s\S]*?return;/);
  assert.ok(
    pnlHook.indexOf('if (!pnlReadEnabled)') < pnlHook.indexOf("fetchJson<unknown>('/api/pnl'"),
    'the compatibility/private guard must block a known-unavailable PnL request before the poll is created',
  );
  assert.match(pnlHook, /\[pnlReadBlocker, pnlReadEnabled, refreshTick\]/);
  assert.match(source, /label: 'Account Sync',[\s\S]*?privateReadGuard\.statusLabel[\s\S]*?tone: privateReadGuard\.overallTone/);
  assert.match(source, /const apiPostureTone: Tone = privateReadGuard\.permissionGuardTone/);
  assert.match(source, /const liabilitiesState = privateGuardCurrent[\s\S]*?: 'UNKNOWN'/);
  assert.match(source, /!privateGuardCurrent \|\| privatePresentation\.counts\.liabilities === null \? 'UNKNOWN'/);
  assert.match(source, /row\.id === 'basis' \? `Private Liabilities \$\{liabilitiesState\}`/);
  assert.doesNotMatch(source, /Private Liabilities \$\{privateRead\.reconciliation\.liabilities\.state\}/);
  assert.doesNotMatch(source, /projectPrivateRead\(privateRead\)/);
  assert.match(source, /label="Strategy Runtime"/);
  assert.doesNotMatch(source, /label="Available USDT"/);
  assert.match(source, /tone=\{compatibilityCurrent \? eventTone\(event\) : 'warn'\}/);
  assert.match(source, /tone: apiPostureTone/);
  assert.match(source, /<StatusMark tone=\{borrowTone\} \/>/);
});

test('Dashboard keeps missing fee rows unknown and labels retained evidence explicitly', async () => {
  const source = await read('pages/Dashboard.tsx');

  assert.match(source, /feesByAsset\.find\(\(fee\) => fee\.asset === 'USDT'\)\?\.amount \?\? null/);
  assert.doesNotMatch(source, /feesByAsset\.find\(\(fee\) => fee\.asset === 'USDT'\)\?\.amount \?\? 0/);
  assert.match(source, /const realizedTotal = pnlEvidenceAvailable && pnlDays\.length > 0/);
  assert.match(source, /STALE LAST-KNOWN · supervisor continuity/);
  assert.match(source, /Last received \$\{timeAgo\(latestObservedUpdate\)\}/);
  assert.match(source, /const basisCandidateCount = knownCount\(basisStrategy\?\.candidateCount\)/);
  assert.match(source, /const volumeProposalCount = knownCount\(volumeStrategy\?\.proposalCount\)/);
  assert.match(source, /tone=\{basisQueueTone\}/);
  assert.match(source, /tone=\{volumeQueueTone\}/);
  assert.doesNotMatch(source, /candidateCount === undefined|proposalCount === undefined/);
});

test('Opportunities separates canonical row absence from a search miss without deriving rows', async () => {
  const source = await read('pages/Opportunities.tsx');

  assert.match(source, /\) : query \? \(/);
  assert.match(source, /No Raw Market Facts Match Search/);
  assert.match(source, /No Raw Market Rows Available/);
  assert.match(source, /Source order remains authoritative; no fallback, scoring, or strategy row is fabricated/);
  assert.doesNotMatch(source, /\.sort\(/);
});

test('money-surface controls retain 24px targets and visible two-pixel focus treatment', async () => {
  const [dashboard, dashboardCss, opportunitiesCss] = await Promise.all([
    read('pages/Dashboard.tsx'),
    read('pages/Dashboard.css'),
    read('pages/Opportunities.css'),
  ]);

  assert.match(dashboard, /<div className="dcx-runtime-row" role="row"/);
  assert.match(dashboard, /aria-label=\{`Open \$\{row\.name\}; updated \$\{sourceAge\(row\.updatedAt\)\}`\}/);
  assert.doesNotMatch(dashboard, /<button className="dcx-runtime-row"/);
  assert.match(dashboardCss, /\.dcx-runtime-open > button \{[\s\S]*?min-height: 32px;/);
  assert.match(dashboardCss, /\.dcx-decisions \.dcx-section-head > button \{\s*min-height: 28px/);
  assert.match(dashboardCss, /outline: 2px solid color-mix/);
  assert.match(opportunitiesCss, /\.opportunityx-search button \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
  assert.match(opportunitiesCss, /outline: 2px solid color-mix/);
});

test('runtime decoders reject malformed transport values before money surfaces consume them', () => {
  assert.ok(decodeBasisRuntimeSnapshot(basisSnapshot()));
  assert.ok(decodeVolumeRuntimeSnapshot(volumeSnapshot()));
  assert.equal(decodeBasisRuntimeSnapshot({ ...basisSnapshot(), updatedAt: null }), null);
  assert.equal(decodeBasisRuntimeSnapshot({
    ...basisSnapshot(),
    status: { ...basisSnapshot().status, openProposals: '0' },
  }), null);
  assert.equal(decodeBasisRuntimeSnapshot({
    ...basisSnapshot(),
    status: { ...basisSnapshot().status, openProposals: 99 },
  }), null);
  assert.equal(decodeVolumeRuntimeSnapshot({
    ...volumeSnapshot(),
    status: { ...volumeSnapshot().status, lastTradeTs: 'recent' },
  }), null);
  assert.equal(decodeVolumeRuntimeSnapshot({
    ...volumeSnapshot(),
    status: { ...volumeSnapshot().status, baselineReady: 99, baselineTotal: 1 },
  }), null);
  assert.ok(decodeDashboardPnlData({
    realizedByDay: [],
    realizedBySymbol: [],
    feesByAsset: [],
    integrity: { state: 'UNKNOWN', complete: false, reasons: ['NO_DURABLE_PNL_EVIDENCE'] },
  }));
  assert.equal(decodeDashboardPnlData({
    realizedByDay: [{ day: '2026-07-28', usd: '0' }],
    realizedBySymbol: [],
    feesByAsset: [],
    integrity: { state: 'COMPLETE', complete: true, reasons: [] },
  }), null);
  assert.equal(decodeDashboardPnlData({
    realizedByDay: [],
    realizedBySymbol: [],
    feesByAsset: [],
    integrity: { state: 'COMPLETE', complete: false, reasons: [] },
  }), null);
});

test('runtime decoders reject incoherent source clocks and duplicate symbols while currentness requires full Volume coverage', () => {
  const basis = basisSnapshot([basisRow()]);
  const volume = volumeSnapshot();
  assert.ok(decodeBasisRuntimeSnapshot(basis));
  assert.ok(decodeVolumeRuntimeSnapshot(volume));

  assert.ok(decodeBasisRuntimeSnapshot(basisSnapshot([basisRow('AUSDT')])));
  assert.ok(decodeBasisRuntimeSnapshot(basisSnapshot([basisRow(`${'A'.repeat(16)}USDT`)])));
  const mismatchedBasisIdentity = basisRow('AUSDT');
  mismatchedBasisIdentity.base = 'B';
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([mismatchedBasisIdentity])), null);
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([basisRow('USDT')])), null);
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([basisRow(`${'A'.repeat(17)}USDT`)])), null);
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([basisRow('aUSDT')])), null);

  assert.equal(decodeBasisRuntimeSnapshot({
    ...basis,
    status: { ...basis.status, lastBookTs: basis.updatedAt + 1 },
  }), null);
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([basisRow(), basisRow()])), null);

  const openBasis = basisRow();
  openBasis.state = 'PROPOSED';
  openBasis.decisionKind = 'proposal';
  openBasis.proposal = basisProposal();
  const decodedOpenBasis = decodeBasisRuntimeSnapshot(basisSnapshot([openBasis]));
  assert.ok(decodedOpenBasis);
  assert.equal(hasAttachedOpenProposal(openBasis), true);
  assert.equal(basisRuntimeCurrent(decodedOpenBasis, NOW), true);

  const transitioningBasis = basisRow();
  transitioningBasis.state = 'PROPOSED';
  transitioningBasis.decisionKind = 'proposal';
  const decodedTransitioningBasis = decodeBasisRuntimeSnapshot(basisSnapshot([transitioningBasis]));
  assert.ok(decodedTransitioningBasis);
  assert.equal(hasAttachedOpenProposal(transitioningBasis), false);
  assert.equal(basisRuntimeCurrent(decodedTransitioningBasis, NOW), false);

  const historicalBasis = basisRow();
  historicalBasis.state = 'COOLDOWN';
  historicalBasis.decisionKind = 'proposal';
  const decodedHistoricalBasis = decodeBasisRuntimeSnapshot(basisSnapshot([historicalBasis]));
  assert.ok(decodedHistoricalBasis);
  assert.equal(basisRuntimeCurrent(decodedHistoricalBasis, NOW), true);

  const detachedOpenBasis = basisRow();
  detachedOpenBasis.decisionKind = 'proposal';
  detachedOpenBasis.proposal = basisProposal('updated');
  const decodedDetachedOpenBasis = decodeBasisRuntimeSnapshot(basisSnapshot([detachedOpenBasis]));
  assert.ok(decodedDetachedOpenBasis);
  assert.equal(basisRuntimeCurrent(decodedDetachedOpenBasis, NOW), false);

  const terminalBasisAttachment = basisRow();
  terminalBasisAttachment.state = 'PROPOSED';
  terminalBasisAttachment.decisionKind = 'proposal';
  terminalBasisAttachment.proposal = basisProposal('expired');
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([terminalBasisAttachment])), null);

  assert.equal(decodeVolumeRuntimeSnapshot({
    ...volume,
    status: { ...volume.status, lastBookTs: volume.updatedAt + 1 },
  }), null);

  const minimumVolumeIdentity = volumeRow('A');
  minimumVolumeIdentity.base = 'x';
  assert.ok(decodeVolumeRuntimeSnapshot(volumeSnapshot([minimumVolumeIdentity])));

  const maximumVolumeIdentity = volumeRow('A'.repeat(32));
  maximumVolumeIdentity.base = 'base/asset'.padEnd(24, '_');
  assert.ok(decodeVolumeRuntimeSnapshot(volumeSnapshot([maximumVolumeIdentity])));

  const overlongVolumeSymbol = volumeRow('A'.repeat(33));
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([overlongVolumeSymbol])), null);
  const emptyVolumeBase = volumeRow('BASEUSDT');
  emptyVolumeBase.base = '';
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([emptyVolumeBase])), null);
  const overlongVolumeBase = volumeRow('BASEUSDT');
  overlongVolumeBase.base = 'B'.repeat(25);
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([overlongVolumeBase])), null);

  const boundedFutureTrade = volumeRow('FUTUREUSDT');
  boundedFutureTrade.lastTradeTs = NOW + 5_000;
  const boundedFutureSnapshot = volumeSnapshot([boundedFutureTrade]);
  boundedFutureSnapshot.status.lastTradeTs = NOW + 5_000;
  const decodedBoundedFuture = decodeVolumeRuntimeSnapshot(boundedFutureSnapshot);
  assert.ok(decodedBoundedFuture);
  assert.equal(volumeRuntimeCurrent(decodedBoundedFuture, NOW), false);

  const futureRowPastStatus = volumeRow('ROWFUTUREUSDT');
  futureRowPastStatus.lastTradeTs = NOW + 5_000;
  const decodedFutureRowPastStatus = decodeVolumeRuntimeSnapshot(volumeSnapshot([futureRowPastStatus]));
  assert.ok(decodedFutureRowPastStatus);
  assert.equal(volumeRuntimeCurrent(decodedFutureRowPastStatus, NOW), false);

  const excessiveFutureTrade = volumeRow('TOOFUTUREUSDT');
  excessiveFutureTrade.lastTradeTs = NOW + 5_001;
  const excessiveFutureSnapshot = volumeSnapshot([excessiveFutureTrade]);
  excessiveFutureSnapshot.status.lastTradeTs = NOW + 5_001;
  assert.equal(decodeVolumeRuntimeSnapshot(excessiveFutureSnapshot), null);

  const undercovered = decodeVolumeRuntimeSnapshot({
    ...volume,
    status: {
      ...volume.status,
      universeSize: 2,
      eligibleSize: 2,
      baselineTotal: 2,
    },
  });
  assert.ok(undercovered);
  assert.equal(volumeRuntimeCurrent(undercovered, NOW), false);
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([volumeRow(), volumeRow()])), null);

  const proposed = volumeRow();
  proposed.state = 'PROPOSED';
  proposed.decisionKind = 'proposal';
  proposed.proposal = volumeProposal();
  const proposedSnapshot = volumeSnapshot([proposed]);
  const decodedProposed = decodeVolumeRuntimeSnapshot(proposedSnapshot);
  assert.ok(decodedProposed);
  assert.equal(volumeRuntimeCurrent(decodedProposed, NOW), true);
  assert.equal(decodeVolumeRuntimeSnapshot({
    ...proposedSnapshot,
    status: { ...proposedSnapshot.status, openProposals: 0 },
  }), null);

  const transitioningVolume = volumeRow();
  transitioningVolume.state = 'PROPOSED';
  transitioningVolume.decisionKind = 'proposal';
  transitioningVolume.proposal = volumeProposal('expired');
  const decodedTransitioningVolume = decodeVolumeRuntimeSnapshot(volumeSnapshot([transitioningVolume]));
  assert.ok(decodedTransitioningVolume);
  assert.equal(hasAttachedOpenProposal(transitioningVolume), false);
  assert.equal(volumeRuntimeCurrent(decodedTransitioningVolume, NOW), false);

  const detachedLifecycleVolume = volumeRow();
  detachedLifecycleVolume.state = 'PROPOSED';
  detachedLifecycleVolume.decisionKind = 'proposal';
  const decodedDetachedLifecycleVolume = decodeVolumeRuntimeSnapshot(volumeSnapshot([detachedLifecycleVolume]));
  assert.ok(decodedDetachedLifecycleVolume);
  assert.equal(volumeRuntimeCurrent(decodedDetachedLifecycleVolume, NOW), false);

  const historicalVolume = volumeRow();
  historicalVolume.state = 'COOLDOWN';
  historicalVolume.decisionKind = 'proposal';
  historicalVolume.proposal = volumeProposal('approved_manual');
  const decodedHistoricalVolume = decodeVolumeRuntimeSnapshot(volumeSnapshot([historicalVolume]));
  assert.ok(decodedHistoricalVolume);
  assert.equal(volumeRuntimeCurrent(decodedHistoricalVolume, NOW), true);

  const rejectedVolume = volumeRow();
  rejectedVolume.state = 'COOLDOWN';
  rejectedVolume.decisionKind = 'proposal';
  rejectedVolume.proposal = volumeProposal('rejected');
  assert.ok(decodeVolumeRuntimeSnapshot(volumeSnapshot([rejectedVolume])));

  const detachedOpenVolume = volumeRow();
  detachedOpenVolume.state = 'ACTIVE';
  detachedOpenVolume.decisionKind = 'proposal';
  detachedOpenVolume.proposal = volumeProposal('updated');
  const detachedOpenVolumeSnapshot = volumeSnapshot([detachedOpenVolume]);
  detachedOpenVolumeSnapshot.status.focused = 1;
  const decodedDetachedOpenVolume = decodeVolumeRuntimeSnapshot(detachedOpenVolumeSnapshot);
  assert.ok(decodedDetachedOpenVolume);
  assert.equal(volumeRuntimeCurrent(decodedDetachedOpenVolume, NOW), false);

  const unsupportedVolumeStatus = volumeRow();
  unsupportedVolumeStatus.proposal = volumeProposal('settled');
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([unsupportedVolumeStatus])), null);

  const activeWatching = volumeRow();
  activeWatching.state = 'ACTIVE';
  activeWatching.decisionKind = 'watch';
  const activeWatchingSnapshot = volumeSnapshot([activeWatching]);
  activeWatchingSnapshot.status.watching = 1;
  assert.ok(decodeVolumeRuntimeSnapshot(activeWatchingSnapshot));
  activeWatchingSnapshot.status.watching = 2;
  assert.equal(decodeVolumeRuntimeSnapshot(activeWatchingSnapshot), null);

  const activeFocused = volumeRow();
  activeFocused.state = 'ACTIVE';
  activeFocused.decisionKind = 'focus';
  const activeFocusedSnapshot = volumeSnapshot([activeFocused]);
  activeFocusedSnapshot.status.focused = 1;
  assert.ok(decodeVolumeRuntimeSnapshot(activeFocusedSnapshot));
  activeFocusedSnapshot.status.focused = 2;
  assert.equal(decodeVolumeRuntimeSnapshot(activeFocusedSnapshot), null);

  const activeDoubleClaimed = volumeRow();
  activeDoubleClaimed.state = 'ACTIVE';
  const activeDoubleClaimedSnapshot = volumeSnapshot([activeDoubleClaimed]);
  activeDoubleClaimedSnapshot.status.watching = 1;
  activeDoubleClaimedSnapshot.status.focused = 1;
  assert.equal(decodeVolumeRuntimeSnapshot(activeDoubleClaimedSnapshot), null);
});

test('runtime decoders bound only semantically nonnegative and unit-interval money fields', () => {
  const negativePrice = basisRow();
  negativePrice.spotBid = -1;
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([negativePrice])), null);

  const invalidBasisScore = basisRow();
  invalidBasisScore.dataQuality.score = 1.01;
  assert.equal(decodeBasisRuntimeSnapshot(basisSnapshot([invalidBasisScore])), null);

  const negativeVolume = volumeRow();
  negativeVolume.windows['5s'].quoteVolume = -1;
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([negativeVolume])), null);

  const invalidRatio = volumeRow();
  invalidRatio.takerBuyRatio = 1.01;
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([invalidRatio])), null);

  const falseReadyBaseline = volumeRow();
  falseReadyBaseline.baseline.ready = true;
  falseReadyBaseline.baseline.samples = 1;
  assert.equal(decodeVolumeRuntimeSnapshot(volumeSnapshot([falseReadyBaseline])), null);

  const historicalProposalDecision = volumeRow();
  historicalProposalDecision.decisionKind = 'proposal';
  const decodedHistoricalProposalDecision = decodeVolumeRuntimeSnapshot(volumeSnapshot([historicalProposalDecision]));
  assert.ok(decodedHistoricalProposalDecision);
  assert.equal(volumeRuntimeCurrent(decodedHistoricalProposalDecision, NOW), true);
});

test('PnL decoder rejects invalid calendar days, negative fees, integrity contradictions, and mismatched totals', () => {
  const complete = {
    realizedByDay: [{ day: '2024-02-29', usd: 3 }],
    realizedBySymbol: [{ symbol: 'BTCUSDT', usd: 3 }],
    feesByAsset: [{ asset: 'USDT', amount: 0.1 }],
    integrity: { state: 'COMPLETE', complete: true, reasons: [] },
  };
  assert.ok(decodeDashboardPnlData(complete));
  assert.ok(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: 'AUSDT', usd: 3 }],
  }));
  assert.ok(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: `${'A'.repeat(16)}USDT`, usd: 3 }],
  }));
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: 'USDT', usd: 3 }],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: `${'A'.repeat(17)}USDT`, usd: 3 }],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: 'BTCBUSD', usd: 3 }],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: 'btcUSDT', usd: 3 }],
  }), null);
  assert.ok(decodeDashboardPnlData({
    ...complete,
    feesByAsset: [{ asset: 'A', amount: 0.1 }],
  }));
  assert.ok(decodeDashboardPnlData({
    ...complete,
    feesByAsset: [{ asset: '🪙'.repeat(20), amount: 0.1 }],
  }));
  assert.equal(decodeDashboardPnlData({
    ...complete,
    feesByAsset: [{ asset: 'A'.repeat(21), amount: 0.1 }],
  }), null);
  for (const asset of ['A/B', 'A\\B', 'A B', 'A\u200bB', 'A\u0000B', '\ud800']) {
    assert.equal(decodeDashboardPnlData({
      ...complete,
      feesByAsset: [{ asset, amount: 0.1 }],
    }), null);
  }
  assert.ok(decodeDashboardPnlData({
    ...complete,
    realizedByDay: [],
    realizedBySymbol: [],
  }));
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedByDay: [],
    realizedBySymbol: [],
    feesByAsset: [],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedByDay: [],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [],
  }), null);
  assert.ok(decodeDashboardPnlData({
    ...complete,
    integrity: { state: 'PARTIAL', complete: false, reasons: ['INCOMPLETE_FILL_EVIDENCE'] },
  }));
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedByDay: [],
    integrity: { state: 'PARTIAL', complete: false, reasons: ['INCOMPLETE_FILL_EVIDENCE'] },
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [],
    integrity: { state: 'PARTIAL', complete: false, reasons: ['INCOMPLETE_FILL_EVIDENCE'] },
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedByDay: [{ day: '2026-02-29', usd: 3 }],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    feesByAsset: [{ asset: 'USDT', amount: -0.1 }],
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    integrity: { state: 'COMPLETE', complete: true, reasons: ['CONTRADICTION'] },
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    integrity: { state: 'PARTIAL', complete: false, reasons: [] },
  }), null);
  assert.equal(decodeDashboardPnlData({
    ...complete,
    realizedBySymbol: [{ symbol: 'BTCUSDT', usd: 4 }],
  }), null);
});

test('green runtime posture requires bounded source time and complete live coverage', () => {
  const basis = decodeBasisRuntimeSnapshot(basisSnapshot());
  const volume = decodeVolumeRuntimeSnapshot(volumeSnapshot());
  assert.ok(basis);
  assert.ok(volume);
  assert.equal(basisRuntimeCurrent(basis, NOW), true);
  assert.equal(volumeRuntimeCurrent(volume, NOW), true);
  assert.equal(basisRuntimeCurrent({
    ...basis,
    status: { ...basis.status, lastBookTs: NOW - 10_001 },
  }, NOW), false);
  assert.equal(volumeRuntimeCurrent({
    ...volume,
    status: { ...volume.status, lastTradeTs: NOW - 10_001 },
  }, NOW), false);
  assert.equal(volumeRuntimeCurrent({
    ...volume,
    status: { ...volume.status, observedSymbols: 0 },
  }, NOW), false);
  assert.equal(basisRuntimeCurrent({
    ...basis,
    updatedAt: NOW - 10_001,
    status: {
      ...basis.status,
      lastBookTs: NOW - 10_001,
      lastMarkTs: NOW - 10_001,
    },
  }, NOW), false);
  assert.equal(volumeRuntimeCurrent({
    ...volume,
    updatedAt: NOW + 1,
    status: {
      ...volume.status,
      lastTradeTs: NOW + 1,
      lastBookTs: NOW + 1,
    },
  }, NOW), false);

  const actionableBasisRow = (dataQuality) => {
    const row = basisRow();
    row.state = 'PROPOSED';
    row.decisionKind = 'proposal';
    row.proposal = basisProposal();
    row.dataQuality = dataQuality;
    return row;
  };
  const boundaryRow = actionableBasisRow({
    score: 1,
    spotStalenessMs: 5_000,
    perpStalenessMs: 5_000,
    legSkewMs: 2_500,
    markDivergenceBps: 1,
    suspectReasons: [],
  });
  const boundary = decodeBasisRuntimeSnapshot(basisSnapshot([boundaryRow]));
  assert.ok(boundary);
  assert.equal(basisRuntimeCurrent(boundary, NOW), true);

  const honestStaleRow = actionableBasisRow({
    score: 0.1,
    spotStalenessMs: 5_001,
    perpStalenessMs: 100,
    legSkewMs: 4_901,
    markDivergenceBps: 1,
    suspectReasons: ['leg_timestamp_skew'],
  });
  const honestStale = decodeBasisRuntimeSnapshot(basisSnapshot([honestStaleRow]));
  assert.ok(honestStale);
  assert.equal(basisRuntimeCurrent(honestStale, NOW), true);

  for (const dataQuality of [
    {
      score: 1,
      spotStalenessMs: null,
      perpStalenessMs: 100,
      legSkewMs: null,
      markDivergenceBps: 1,
      suspectReasons: [],
    },
    {
      score: 1,
      spotStalenessMs: 5_001,
      perpStalenessMs: 100,
      legSkewMs: 4_901,
      markDivergenceBps: 1,
      suspectReasons: [],
    },
    {
      score: 1,
      spotStalenessMs: 100,
      perpStalenessMs: 100,
      legSkewMs: 2_501,
      markDivergenceBps: 1,
      suspectReasons: [],
    },
  ]) {
    const hostileRow = actionableBasisRow(dataQuality);
    const hostileSnapshot = basisSnapshot([hostileRow]);
    assert.equal(decodeBasisRuntimeSnapshot(hostileSnapshot), null);
    assert.equal(basisRuntimeCurrent(hostileSnapshot, NOW), false);
  }
});

test('scanner rows expose one real disclosure control and stale watch mutation is disabled', async () => {
  const [basis, volume] = await Promise.all([
    read('pages/Strategies.tsx'),
    read('pages/VolumeScanner.tsx'),
  ]);
  for (const source of [basis, volume]) {
    assert.match(source, /className="volx-row"|className="basx-row"/);
    assert.match(source, /role="row"/);
    assert.match(source, /className="volx-disclosure"/);
    assert.match(source, /aria-controls=\{isExpanded \? detailId : undefined\}/);
    assert.match(source, /truthCurrent && row\.state === 'PROPOSED' && hasAttachedOpenProposal\(row\)/);
    assert.match(source, /Watch Unavailable/);
    assert.match(source, /aria-pressed=\{watching\}/);
    assert.doesNotMatch(source, /aria-pressed=\{watchWritable \? watching : false\}/);
    assert.match(source, /stateStatus === 'CURRENT'/);
    assert.match(source, /STALE LAST-KNOWN · current proposals withheld/);
  }
  assert.match(basis, /const watchWritable = stateStatus === 'CURRENT' && liveFeed;/);
  assert.match(basis, /const rowCurrent = liveFeed && row\.dataQuality\.score >= snapshot\.thresholds\.minDataQuality;/);
  assert.match(basis, /const rowWatchWritable = watchWritable && rowCurrent;/);
  assert.match(basis, /stateTone\(row, rowCurrent\)/);
  assert.match(basis, /edgeTone\(row, rowCurrent\)/);
  assert.match(basis, /className=\{rowWatchWritable && watching \? 'active' : ''\}/);
  assert.match(basis, /disabled=\{!rowWatchWritable\}/);
  assert.match(basis, /if \(rowWatchWritable\) void toggleWatch\(row\.symbol\)/);
  assert.match(basis, /rowWatchWritable \? watching \? 'Watching' : 'Watch' : watching \? 'Watching · Change Unavailable' : 'Watch Unavailable'/);
  assert.match(volume, /const watchWritable = stateStatus === 'CURRENT' && engineFeedsCurrent;/);
  assert.match(volume, /disabled=\{!watchWritable\}/);
  assert.match(basis, /rows\.filter\(hasAttachedOpenProposal\)\.length/);
  assert.match(basis, /filter === 'proposals'\) return hasAttachedOpenProposal\(row\)/);
  assert.match(basis, /lifecycle\/store reconciliation/);
  assert.match(basis, /Historical Proposal Decision/);
  assert.match(basis, /No Open Attachment · Lifecycle Reconciling/);
  assert.match(volume, /Proposal Expired/);
  assert.match(volume, /Proposal Rejected/);
  assert.match(volume, /Closed Store Record/);
  assert.match(basis, /Watch changes require current compatibility, current Basis runtime truth, and row data quality at or above the configured minimum/);
  assert.match(volume, /Watch changes require current compatibility and Volume runtime truth/);
});

test('money-surface view selectors use native toggle-group semantics', async () => {
  const sources = await Promise.all([
    read('pages/Strategies.tsx'),
    read('pages/VolumeScanner.tsx'),
    read('pages/Opportunities.tsx'),
  ]);

  for (const source of sources) {
    assert.match(source, /role="group"/);
    assert.match(source, /aria-pressed=\{(?:filter|view) === item\.id\}/);
    assert.doesNotMatch(source, /role="tablist"|role="tab"/);
  }
});
