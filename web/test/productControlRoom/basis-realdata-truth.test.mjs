import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

import {
  basisRuntimeSnapshotCurrent,
  decodeBasisRuntimeSnapshot,
} from '../../src/lib/basisRuntime.ts';
import { privateReadFreshness } from '../../src/lib/privateRead.ts';

const BASIS_NOW = 1_800_000_000_000;

function basisRuntimePayload() {
  return {
    updatedAt: BASIS_NOW,
    status: {
      running: true,
      bookState: 'fresh',
      markState: 'fresh',
      universeSize: 1,
      watching: 0,
      focused: 1,
      openProposals: 1,
      rejected: 0,
      borrowBlocked: 0,
      verifiedBorrow: 1,
      dataQualityPassing: 1,
      lastBookTs: BASIS_NOW - 1_000,
      lastMarkTs: BASIS_NOW - 1_000,
      lastTickTs: BASIS_NOW - 1_000,
      ticks: 5,
      lastError: null,
      bookSource: 'Basis books owner',
      markSource: 'Basis marks owner',
      borrowSource: 'Basis borrow owner',
    },
    thresholds: {
      watchGapPct: 0.2,
      focusGapPct: 0.4,
      minNetBasisPct: 0.1,
      minQuoteVolume24hUsd: 10_000,
      feesPct: 0.2,
      persistTicks: 2,
      maxSpreadBps: 10,
      minDepthScore: 0.5,
      minDataQuality: 0.5,
      intendedNotionalUsd: 1_000,
    },
    rows: [{
      symbol: 'BTCUSDT',
      base: 'BTC',
      state: 'PROPOSED',
      direction: 'long_spot_short_perp',
      spotBid: 99,
      spotAsk: 100,
      perpBid: 101,
      perpAsk: 102,
      markPrice: 101,
      spotSpreadBps: 1,
      perpSpreadBps: 1,
      quoteVolume24h: 1_250_000,
      executableGapPct: 0.8,
      alternateGapPct: -0.8,
      gapAgeMs: 1_000,
      persistTicks: 3,
      gapSlopePctPerMin: 0.1,
      gapStabilityCv: 0.2,
      fundingRate: 0.0001,
      nextFundingTs: BASIS_NOW + 60_000,
      fundingCarryPct: 0.01,
      fundingFlipRisk: 0.1,
      expectedHoldMs: 60_000,
      costs: {
        feesPct: 0.2,
        slippagePct: 0.05,
        fundingDragPct: 0,
        borrowCostPct: 0,
        totalPct: 0.25,
      },
      netEdgePct: 0.56,
      depthScore: 0.9,
      slippagePct: 0.05,
      ladderBacked: true,
      bookPressure: 0,
      dataQuality: {
        score: 0.95,
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
      decisionKind: 'proposal',
      rejectCode: null,
      reason: 'Executable Basis proposal',
      correlationId: 'basis-correlation-one',
      decisionTs: BASIS_NOW - 2_000,
      priority: { score: 0.8 },
      proposal: {
        id: 'basis-one',
        status: 'open',
        netEdgePct: 0.56,
        confidence: 0.75,
        invalidation: 'Executable gap closes',
        stagedSizes: [{ stage: 1, fraction: 1, notionalUsd: 1_000 }],
      },
    }],
  };
}

function twoBasisRows() {
  const payload = basisRuntimePayload();
  const second = structuredClone(payload.rows[0]);
  second.symbol = 'ETHUSDT';
  second.base = 'ETH';
  second.correlationId = 'basis-correlation-two';
  second.proposal.id = 'basis-two';
  payload.rows.push(second);
  payload.status.universeSize = 2;
  payload.status.focused = 2;
  payload.status.openProposals = 2;
  payload.status.verifiedBorrow = 2;
  payload.status.dataQualityPassing = 2;
  return payload;
}

test('Basis runtime decoder is strict, detached, duplicate-safe, and time bounded', () => {
  const input = basisRuntimePayload();
  const decoded = decodeBasisRuntimeSnapshot(input);
  assert.ok(decoded);
  assert.equal(basisRuntimeSnapshotCurrent(decoded, BASIS_NOW), true);

  input.rows[0].reason = 'mutated after decode';
  input.rows[0].proposal.id = 'mutated-after-decode';
  assert.equal(decoded.rows[0].reason, 'Executable Basis proposal');
  assert.equal(decoded.rows[0].proposal.id, 'basis-one');
  assert.notEqual(decoded.rows, input.rows);

  const advancingProposal = basisRuntimePayload();
  advancingProposal.rows[0].proposal.status = 'updated';
  assert.ok(decodeBasisRuntimeSnapshot(advancingProposal));
  advancingProposal.rows[0].proposal.status = 'expired';
  assert.equal(decodeBasisRuntimeSnapshot(advancingProposal), null);

  const observedFractionalHold = basisRuntimePayload();
  observedFractionalHold.rows[0].expectedHoldMs = 15_031_832.257978078;
  assert.ok(decodeBasisRuntimeSnapshot(observedFractionalHold));

  const malformedRow = basisRuntimePayload();
  delete malformedRow.rows[0].dataQuality;
  assert.equal(decodeBasisRuntimeSnapshot(malformedRow), null);

  const malformedStatus = basisRuntimePayload();
  malformedStatus.status.bookState = 'warming';
  assert.equal(decodeBasisRuntimeSnapshot(malformedStatus), null);

  const inconsistentCount = basisRuntimePayload();
  inconsistentCount.status.openProposals = 0;
  assert.equal(decodeBasisRuntimeSnapshot(inconsistentCount), null);

  const inconsistentProposal = basisRuntimePayload();
  inconsistentProposal.rows[0].proposal.netEdgePct = 0.53;
  assert.equal(decodeBasisRuntimeSnapshot(inconsistentProposal), null);

  const duplicateSymbol = twoBasisRows();
  duplicateSymbol.rows[1].symbol = duplicateSymbol.rows[0].symbol;
  assert.equal(decodeBasisRuntimeSnapshot(duplicateSymbol), null);

  const duplicateProposal = twoBasisRows();
  duplicateProposal.rows[1].proposal.id = duplicateProposal.rows[0].proposal.id;
  assert.equal(decodeBasisRuntimeSnapshot(duplicateProposal), null);

  const hostile = basisRuntimePayload();
  Object.defineProperty(hostile.rows[0], 'reason', { get() { throw new Error('hostile accessor'); } });
  assert.equal(decodeBasisRuntimeSnapshot(hostile), null);

  const justCurrent = basisRuntimePayload();
  justCurrent.updatedAt = BASIS_NOW - 9_999;
  justCurrent.status.lastBookTs = BASIS_NOW - 9_999;
  justCurrent.status.lastMarkTs = BASIS_NOW - 9_999;
  justCurrent.status.lastTickTs = BASIS_NOW - 9_999;
  assert.equal(basisRuntimeSnapshotCurrent(decodeBasisRuntimeSnapshot(justCurrent), BASIS_NOW), true);

  const stale = structuredClone(justCurrent);
  stale.updatedAt = BASIS_NOW - 10_000;
  stale.status.lastBookTs = BASIS_NOW - 10_000;
  stale.status.lastMarkTs = BASIS_NOW - 10_000;
  stale.status.lastTickTs = BASIS_NOW - 10_000;
  assert.equal(basisRuntimeSnapshotCurrent(decodeBasisRuntimeSnapshot(stale), BASIS_NOW), false);

  const allowedSkew = basisRuntimePayload();
  allowedSkew.updatedAt = BASIS_NOW + 5_000;
  allowedSkew.status.lastBookTs = BASIS_NOW + 5_000;
  allowedSkew.status.lastMarkTs = BASIS_NOW + 5_000;
  allowedSkew.status.lastTickTs = BASIS_NOW + 5_000;
  assert.equal(basisRuntimeSnapshotCurrent(decodeBasisRuntimeSnapshot(allowedSkew), BASIS_NOW), true);

  const futureSkew = structuredClone(allowedSkew);
  futureSkew.updatedAt = BASIS_NOW + 5_001;
  futureSkew.status.lastBookTs = BASIS_NOW + 5_001;
  futureSkew.status.lastMarkTs = BASIS_NOW + 5_001;
  futureSkew.status.lastTickTs = BASIS_NOW + 5_001;
  assert.equal(basisRuntimeSnapshotCurrent(decodeBasisRuntimeSnapshot(futureSkew), BASIS_NOW), false);
});

test('Basis quality claims require coherent leg staleness while honest low-quality rows remain representable', () => {
  const boundary = basisRuntimePayload();
  boundary.rows[0].dataQuality.spotStalenessMs = 5_000;
  boundary.rows[0].dataQuality.perpStalenessMs = 5_000;
  boundary.rows[0].dataQuality.legSkewMs = 2_500;
  const decodedBoundary = decodeBasisRuntimeSnapshot(boundary);
  assert.ok(decodedBoundary);
  assert.equal(basisRuntimeSnapshotCurrent(decodedBoundary, BASIS_NOW), true);

  const honestLowQuality = basisRuntimePayload();
  honestLowQuality.rows[0].dataQuality.score = 0.1;
  honestLowQuality.rows[0].dataQuality.spotStalenessMs = 5_001;
  honestLowQuality.rows[0].dataQuality.perpStalenessMs = null;
  honestLowQuality.rows[0].dataQuality.legSkewMs = 2_501;
  honestLowQuality.rows[0].dataQuality.suspectReasons = ['leg_timestamp_skew'];
  honestLowQuality.status.dataQualityPassing = 0;
  const decodedLowQuality = decodeBasisRuntimeSnapshot(honestLowQuality);
  assert.ok(decodedLowQuality);
  assert.equal(basisRuntimeSnapshotCurrent(decodedLowQuality, BASIS_NOW), true);

  for (const mutate of [
    (quality) => { quality.spotStalenessMs = null; },
    (quality) => { quality.perpStalenessMs = null; },
    (quality) => { quality.spotStalenessMs = 5_001; },
    (quality) => { quality.perpStalenessMs = 5_001; },
    (quality) => { quality.legSkewMs = 2_501; },
  ]) {
    const incoherent = basisRuntimePayload();
    mutate(incoherent.rows[0].dataQuality);
    assert.equal(decodeBasisRuntimeSnapshot(incoherent), null);
    assert.equal(basisRuntimeSnapshotCurrent(incoherent, BASIS_NOW), false);
  }

  for (const threshold of [-0.1, 1.1]) {
    const malformedThreshold = basisRuntimePayload();
    malformedThreshold.thresholds.minDataQuality = threshold;
    assert.equal(decodeBasisRuntimeSnapshot(malformedThreshold), null);
  }
});

test('Basis canonical supervisor and expanded row evidence fail closed without inventing history', async (context) => {
  const cssHooks = registerHooks({
    load(url, hookContext, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, hookContext);
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });
  context.after(() => cssHooks.deregister());

  const {
    projectBasisProposalDeskGate,
    resolveBasisRowEvidence,
    resolveBasisSupervisorTruth,
  } = await import('../../src/pages/Strategies.tsx');
  const component = {
    observedLifecycle: 'READY',
    capability: 'LIVE_PUBLIC',
    truthLabel: 'LIVE_PUBLIC',
    blockerCode: null,
    canonicalPresentation: { status: 'operational', stateLabel: 'READY · LIVE PUBLIC' },
  };
  const summary = {
    truthLabel: 'LIVE_PUBLIC',
    candidateCount: 3,
    proposalCount: 1,
    rejectionCount: 4,
    lastDecisionAtMs: BASIS_NOW - 2_000,
    sourceRevision: null,
  };
  assert.deepEqual(resolveBasisSupervisorTruth({
    continuity: 'PROVEN',
    loading: false,
    bindingError: null,
    component,
    summary,
  }), {
    current: true,
    state: 'LIVE',
    label: 'Live',
    reason: null,
    candidateCount: 3,
    proposalCount: 1,
    rejectionCount: 4,
    lastDecisionAtMs: BASIS_NOW - 2_000,
    sourceRevision: null,
  });

  for (const input of [
    { continuity: 'BACKFILL', component, summary },
    {
      continuity: 'PROVEN',
      component: {
        ...component,
        observedLifecycle: 'DEGRADED',
        canonicalPresentation: { status: 'degraded', stateLabel: 'DEGRADED' },
      },
      summary,
    },
    { continuity: 'PROVEN', component: { ...component, capability: 'UNKNOWN' }, summary },
    { continuity: 'PROVEN', component, summary: { ...summary, truthLabel: 'UNAVAILABLE' } },
    { continuity: 'PROVEN', component: null, summary },
  ]) {
    const unavailable = resolveBasisSupervisorTruth({
      loading: false,
      bindingError: null,
      ...input,
    });
    assert.equal(unavailable.current, false);
    assert.equal(unavailable.state, 'UNAVAILABLE');
    assert.equal(unavailable.candidateCount, null);
    assert.equal(unavailable.proposalCount, null);
  }
  const warming = resolveBasisSupervisorTruth({
    continuity: 'PROVEN',
    loading: false,
    bindingError: null,
    component: {
      ...component,
      observedLifecycle: 'WARMING',
      capability: 'UNKNOWN',
      truthLabel: 'UNKNOWN',
      canonicalPresentation: { status: 'degraded', stateLabel: 'WARMING' },
    },
    summary: { ...summary, truthLabel: 'UNAVAILABLE' },
  });
  assert.equal(warming.state, 'STARTING');
  assert.equal(warming.reason, null);

  const emitted = resolveBasisRowEvidence(basisRuntimePayload().rows[0]);
  assert.equal(emitted.selectedDirection, 'Buy Spot · Sell Perp');
  assert.equal(emitted.alternateDirection, 'Sell Spot · Buy Perp');
  assert.equal(emitted.alternateGapPct, -0.8);
  assert.equal(emitted.historyBoundary, 'DECISION_OBSERVATION');
  assert.equal(emitted.proposal?.id, 'basis-one');
  assert.deepEqual(emitted.proposal?.stagedSizes, [
    { stage: 1, fraction: 1, notionalUsd: 1_000 },
  ]);

  const absent = resolveBasisRowEvidence({
    direction: 'short_spot_long_perp',
    alternateGapPct: null,
    decisionTs: null,
    correlationId: null,
    priority: null,
    proposal: null,
  });
  assert.equal(absent.historyBoundary, 'NONE');
  assert.equal(absent.priorityScore, null);
  assert.equal(absent.proposal, null);
  assert.deepEqual(projectBasisProposalDeskGate(false, true, 1), {
    current: false,
    recordCount: null,
    emptyState: 'CURRENT PROPOSAL SET UNKNOWN',
  });
});

test('Basis proposal economics and row truth preserve measured zero and withhold incomplete or incoherent values', async () => {
  const {
    basisProposalObservationCurrent,
    basisRowEconomicsComplete,
    buildBasisProposalEconomics,
    projectBasisRowRenderTruth,
    proposalBinding,
  } = await import('../../src/pages/Strategies.tsx');
  const row = basisRuntimePayload().rows[0];
  assert.equal(basisProposalObservationCurrent(row, 0.5), true);
  assert.equal(basisRowEconomicsComplete(row, 0.2, BASIS_NOW), true);
  assert.equal(proposalBinding(row, true), 'OPEN_RECORD_ALIGNED');

  const coherent = buildBasisProposalEconomics(row, true, 0.2, BASIS_NOW, 1_000, true);
  assert.equal(coherent.integrityLabel, 'COHERENT_COMPONENTS');
  assert.equal(coherent.borrowCostPct, 0);
  assert.equal(coherent.fundingDragPct, 0);
  assert.equal(coherent.totalCostPct, 0.25);
  assert.equal(coherent.netEdgePct, 0.56);

  const measuredZero = structuredClone(row);
  measuredZero.fundingRate = 0;
  measuredZero.fundingCarryPct = 0;
  measuredZero.costs.fundingDragPct = 0;
  measuredZero.costs.totalPct = 0.25;
  measuredZero.netEdgePct = 0.55;
  measuredZero.proposal.netEdgePct = 0.55;
  const zeroEconomics = buildBasisProposalEconomics(measuredZero, true, 0.2, BASIS_NOW, 1_000, true);
  assert.equal(zeroEconomics.fundingCarryPct, 0);
  assert.equal(zeroEconomics.borrowCostPct, 0);
  assert.equal(zeroEconomics.netEdgePct, 0.55);

  const fundingUnknown = structuredClone(row);
  fundingUnknown.fundingRate = null;
  fundingUnknown.nextFundingTs = null;
  fundingUnknown.fundingCarryPct = null;
  fundingUnknown.netEdgePct = null;
  const incomplete = buildBasisProposalEconomics(fundingUnknown, true, 0.2, BASIS_NOW, 1_000, true);
  assert.equal(incomplete.integrityLabel, 'INCOMPLETE_INPUTS');
  assert.equal(incomplete.fundingDragPct, null);
  assert.equal(incomplete.totalCostPct, null);
  assert.equal(incomplete.netEdgePct, null);
  assert.equal(incomplete.proposalNetEdgePct, 0.56);

  const costMismatch = structuredClone(row);
  costMismatch.costs.totalPct = 0.26;
  const mismatched = buildBasisProposalEconomics(costMismatch, true, 0.2, BASIS_NOW, 1_000, true);
  assert.equal(mismatched.integrityLabel, 'CONTRACT_MISMATCH');
  assert.equal(mismatched.totalCostPct, null);
  assert.equal(mismatched.netEdgePct, null);

  const stageMismatch = structuredClone(row);
  stageMismatch.proposal.stagedSizes[0].stage = 0;
  const invalidStage = buildBasisProposalEconomics(stageMismatch, true, 0.2, BASIS_NOW, 1_000, true);
  assert.equal(invalidStage.stagesConsistent, false);
  assert.equal(invalidStage.netEdgePct, null);

  const staleRow = structuredClone(row);
  staleRow.dataQuality.spotStalenessMs = 5_001;
  assert.equal(basisProposalObservationCurrent(staleRow, 0.5), false);
  const staleEconomics = buildBasisProposalEconomics(staleRow, false, 0.2, BASIS_NOW, 1_000, true);
  assert.equal(staleEconomics.integrityLabel, 'NOT_CURRENT');
  assert.equal(staleEconomics.grossGapPct, null);
  assert.equal(staleEconomics.netEdgePct, null);

  const suspectRow = structuredClone(row);
  suspectRow.dataQuality.suspectReasons = ['leg_timestamp_contradiction'];
  assert.equal(basisProposalObservationCurrent(suspectRow, 0.5), false);

  const reconciling = structuredClone(row);
  reconciling.state = 'WATCHING';
  assert.equal(proposalBinding(reconciling, true), 'OPEN_RECORD_RECONCILING');
  assert.equal(
    buildBasisProposalEconomics(reconciling, true, 0.2, BASIS_NOW, 1_000, true).netEdgePct,
    null,
  );

  const absentRenderValues = structuredClone(row);
  absentRenderValues.quoteVolume24h = null;
  absentRenderValues.executableGapPct = null;
  absentRenderValues.spotBid = null;
  absentRenderValues.spotAsk = null;
  absentRenderValues.perpBid = null;
  absentRenderValues.perpAsk = null;
  absentRenderValues.fundingRate = null;
  absentRenderValues.nextFundingTs = null;
  absentRenderValues.fundingCarryPct = null;
  absentRenderValues.spotSpreadBps = null;
  absentRenderValues.perpSpreadBps = null;
  absentRenderValues.alternateGapPct = null;
  absentRenderValues.gapAgeMs = null;
  assert.deepEqual(projectBasisRowRenderTruth(absentRenderValues, true), {
    quoteVolume24h: '24h volume UNKNOWN',
    executableGapPct: 'UNKNOWN',
    executionPrices: 'UNKNOWN / UNKNOWN',
    fundingRate: 'UNKNOWN',
    fundingSummary: 'Funding unavailable',
    grossGapPct: 'UNKNOWN',
    spreadBps: 'UNKNOWN / UNKNOWN',
    spotBidAsk: 'UNKNOWN / UNKNOWN',
    perpBidAsk: 'UNKNOWN / UNKNOWN',
    alternateGapPct: 'UNKNOWN',
    gapAgeMs: 'UNKNOWN',
    fundingCarryPct: 'UNKNOWN',
  });

  const zeroFundingTime = structuredClone(row);
  zeroFundingTime.nextFundingTs = 0;
  assert.equal(
    projectBasisRowRenderTruth(zeroFundingTime, true).fundingSummary,
    'Funding unavailable',
  );
});

test('Basis renders only canonically current runtime and exact account facts', async (context) => {
  const cssHooks = registerHooks({
    load(url, hookContext, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, hookContext);
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });
  context.after(() => cssHooks.deregister());

  const { resolveBasisAccountTruth, resolveBasisRuntimeTruth } = await import('../../src/pages/Strategies.tsx');
  const currentSnapshot = decodeBasisRuntimeSnapshot(basisRuntimePayload());
  assert.ok(currentSnapshot);

  const currentRuntime = resolveBasisRuntimeTruth({
    canonicalState: 'READY',
    canonicalReason: null,
    snapshot: currentSnapshot,
    requestError: null,
    nowMs: BASIS_NOW,
  });
  assert.deepEqual(currentRuntime, {
    current: true,
    state: 'LIVE',
    label: 'Live',
    reason: null,
  });

  for (const unavailable of [
    resolveBasisRuntimeTruth({
      canonicalState: 'UNAVAILABLE',
      canonicalReason: 'BASIS_ENGINE_BLOCKED',
      snapshot: currentSnapshot,
      requestError: null,
      nowMs: BASIS_NOW,
    }),
    resolveBasisRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshot: currentSnapshot,
      requestError: 'Basis read failed',
      nowMs: BASIS_NOW,
    }),
    resolveBasisRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshot: { ...currentSnapshot, status: { ...currentSnapshot.status, running: false } },
      requestError: null,
      nowMs: BASIS_NOW,
    }),
    resolveBasisRuntimeTruth({
      canonicalState: 'READY',
      canonicalReason: null,
      snapshot: { ...currentSnapshot, status: { ...currentSnapshot.status, bookState: 'stale' } },
      requestError: null,
      nowMs: BASIS_NOW,
    }),
  ]) {
    assert.equal(unavailable.current, false);
    assert.equal(unavailable.state, 'UNAVAILABLE');
  }

  const currentAccountInput = {
    source: 'STATE',
    requestError: null,
    freshnessState: 'CURRENT',
    freshnessReason: 'Current account truth',
    spotState: 'AVAILABLE',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'COMPLETE_CURRENT',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '0.00000000',
    marginState: 'AVAILABLE',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'COMPLETE_CURRENT',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'RECONCILED',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.00000000',
    liabilityCount: 0,
  };
  const currentZero = resolveBasisAccountTruth(currentAccountInput);
  assert.equal(currentZero.spotCurrent, true);
  assert.equal(currentZero.marginCurrent, true);
  assert.equal(currentZero.spotAvailableUsdt, '0.00000000');
  assert.equal(currentZero.marginLiabilityBtc, '0.00000000');
  assert.equal(currentZero.liabilityCount, 0);

  const stale = resolveBasisAccountTruth({
    source: 'STATE',
    requestError: null,
    freshnessState: 'STALE',
    freshnessReason: 'Stale account truth',
    spotState: 'AVAILABLE',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'COMPLETE_CURRENT',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '125.00000000',
    marginState: 'AVAILABLE',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'COMPLETE_CURRENT',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'RECONCILED',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.10000000',
    liabilityCount: 1,
  });
  assert.equal(stale.spotAvailableUsdt, null);
  assert.equal(stale.marginLiabilityBtc, null);

  const partial = resolveBasisAccountTruth({
    source: 'STATE',
    requestError: null,
    freshnessState: 'CURRENT',
    freshnessReason: 'Current account truth',
    spotState: 'PARTIAL',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'PARTIAL_SYMBOL_SCOPED',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '125.00000000',
    marginState: 'PARTIAL',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'PARTIAL_SYMBOL_SCOPED',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'PARTIAL',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.10000000',
    liabilityCount: 1,
  });
  assert.equal(partial.spotAvailableUsdt, null);
  assert.equal(partial.marginLiabilityBtc, null);

  const fallback = resolveBasisAccountTruth({
    source: 'FALLBACK',
    requestError: null,
    freshnessState: 'CURRENT',
    freshnessReason: 'Current account truth',
    spotState: 'AVAILABLE',
    spotFreshnessState: 'CURRENT',
    spotFreshnessReason: 'Current spot truth',
    spotCoverageState: 'COMPLETE_CURRENT',
    spotBalancesAvailable: true,
    spotAvailableUsdt: '125.00000000',
    marginState: 'AVAILABLE',
    marginFreshnessState: 'CURRENT',
    marginFreshnessReason: 'Current margin truth',
    marginCoverageState: 'COMPLETE_CURRENT',
    marginAssetsAvailable: true,
    liabilityReconciliationState: 'RECONCILED',
    liabilityFreshnessState: 'CURRENT',
    liabilityFreshnessReason: 'Current liability truth',
    marginLiabilityBtc: '0.00000000',
    liabilityCount: 0,
  });
  assert.equal(fallback.spotAvailableUsdt, '125.00000000');
  assert.equal(fallback.sourceLabel, 'Fallback Account Read');

  const now = 1_720_000_000_000;
  const future = privateReadFreshness({ state: 'AVAILABLE', observedAt: now + 1 }, now);
  const staleScoped = privateReadFreshness({ state: 'AVAILABLE', observedAt: now - 120_000 }, now);
  const scopedTimestampFailure = resolveBasisAccountTruth({
    ...currentAccountInput,
    spotFreshnessState: future.state,
    spotFreshnessReason: future.reason,
    marginFreshnessState: staleScoped.state,
    marginFreshnessReason: staleScoped.reason,
    liabilityFreshnessState: future.state,
    liabilityFreshnessReason: future.reason,
  });
  assert.equal(scopedTimestampFailure.spotAvailableUsdt, null);
  assert.equal(scopedTimestampFailure.marginLiabilityBtc, null);
});

test('future and stale account timestamps never become current', () => {
  const now = 1_720_000_000_000;
  const future = privateReadFreshness({ state: 'AVAILABLE', observedAt: now + 1 }, now);
  const stale = privateReadFreshness({ state: 'AVAILABLE', observedAt: now - 120_000 }, now);
  assert.equal(future.state, 'UNKNOWN');
  assert.equal(stale.state, 'STALE');
});

test('Basis source consumes existing owners without new account, market, or execution effects', async () => {
  const source = await readFile(new URL('../../src/pages/Strategies.tsx', import.meta.url), 'utf8');
  assert.equal(source.match(/fetchJson\('\/api\/engine\/basis'/g)?.length, 1);
  assert.match(source, /useProductControlRoomContext\(\)/);
  assert.match(source, /projectPrivateRead\(privateRead, accountNow\)/);
  assert.match(source, /spotFreshnessState: spotFreshness\.state/);
  assert.match(source, /liabilityFreshnessState: liabilityFreshness\.state/);
  assert.match(source, /const rows = basisTruth\.current \?/);
  assert.match(source, /binding\.snapshot\?\.dashboard\.summaries\.strategies\.basis/);
  assert.match(source, /aria-label="Canonical Basis Supervisor Cut"/);
  assert.match(source, /aria-label="Truthful Basis Proposal Desk"/);
  assert.match(source, /basisProposalObservationCurrent\(row, snapshot\.thresholds\.minDataQuality\)/);
  assert.match(source, /basisRowEconomicsComplete\(/);
  assert.match(source, /const watchWritable = stateStatus === 'CURRENT' && basisTruth\.current/);
  assert.match(source, /const rowWatchWritable = watchWritable && rowCurrent/);
  assert.match(source, /disabled=\{!rowWatchWritable\}/);
  assert.match(source, /if \(rowWatchWritable\) void toggleWatch\(row\.symbol\)/);
  assert.match(source, /Gross \{renderTruth\.grossGapPct\}/);
  assert.match(source, /Cost \{rowEconomicsCurrent/);
  assert.equal(source.match(/toggleWatch\(row\.symbol\)/g)?.length, 1);
  assert.match(source, /accountTruth\.spotAvailableUsdt \?\? 'UNKNOWN'/);
  assert.match(source, /accountTruth\.marginLiabilityBtc \?\? 'UNKNOWN'/);
  assert.doesNotMatch(source, /\/api\/private-account|\/api\/markets|placeOrder|executeOrder|method:\s*['"]POST['"]/);
  assert.doesNotMatch(source, /fixture|synthetic/i);
});
