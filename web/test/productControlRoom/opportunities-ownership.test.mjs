import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.React = React;

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.css')) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: '' };
  },
});

const {
  PublishedOpportunityFacts,
  decodeCanonicalOpportunityRead,
  decodeBasisOpportunityRead,
  decodeVolumeOpportunityRead,
  projectCanonicalOpportunityTruth,
  projectOpportunitySourceTruth,
  projectPublishedOpportunityFacts,
} = await import('../../src/pages/Opportunities.tsx');

const NOW = 1_800_000_000_000;

function basisProposal({
  id,
  symbol,
  base,
  netEdgePct,
  state = 'PROPOSED',
}) {
  return {
    symbol,
    base,
    state,
    direction: 'long_spot_short_perp',
    reason: `Published reason for ${symbol}`,
    spotBid: 99,
    spotAsk: 100,
    perpBid: 101,
    perpAsk: 102,
    markPrice: 101,
    spotSpreadBps: 1,
    perpSpreadBps: 1,
    executableGapPct: 0.8,
    alternateGapPct: -0.8,
    gapAgeMs: 1_000,
    persistTicks: 3,
    gapSlopePctPerMin: 0.1,
    gapStabilityCv: 0.2,
    fundingRate: 0.0001,
    nextFundingTs: NOW + 60_000,
    fundingCarryPct: 0.01,
    fundingFlipRisk: 0.1,
    expectedHoldMs: 60_000,
    quoteVolume24h: 1_250_000,
    netEdgePct,
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
    decisionTs: NOW - 2_000,
    costs: {
      feesPct: 0.2,
      slippagePct: 0.05,
      fundingDragPct: 0.01,
      borrowCostPct: 0,
      totalPct: 0.26,
    },
    borrow: {
      status: 'not_needed',
      ok: true,
      rejectCode: null,
      human: 'No borrow needed',
      costPctOverHold: 0,
    },
    decisionKind: state === 'PROPOSED' ? 'proposal' : 'watch',
    rejectCode: null,
    correlationId: `correlation-${id}`,
    priority: { score: 0.8 },
    proposal: {
      id,
      status: 'OPEN',
      netEdgePct,
      confidence: 0.75,
      invalidation: 'Executable gap closes',
      stagedSizes: [],
    },
  };
}

function basisPayload() {
  return {
    updatedAt: NOW,
    status: {
      running: true,
      bookState: 'fresh',
      markState: 'fresh',
      universeSize: 3,
      watching: 1,
      focused: 2,
      openProposals: 2,
      rejected: 0,
      borrowBlocked: 0,
      verifiedBorrow: 0,
      dataQualityPassing: 3,
      lastBookTs: NOW - 1_000,
      lastMarkTs: NOW - 1_000,
      lastTickTs: NOW - 1_000,
      ticks: 3,
      lastError: null,
      bookSource: 'Basis books owner',
      markSource: 'Basis mark owner',
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
    rows: [
      basisProposal({
        id: 'watch-is-not-a-proposal',
        symbol: 'SOLUSDT',
        base: 'SOL',
        netEdgePct: 0.1,
        state: 'WATCHING',
      }),
      basisProposal({ id: 'basis-zero', symbol: 'ETHUSDT', base: 'ETH', netEdgePct: 0 }),
      basisProposal({ id: 'basis-positive', symbol: 'BTCUSDT', base: 'BTC', netEdgePct: 0.42 }),
    ],
  };
}

function volumeProposal({
  id,
  symbol,
  base,
  state = 'PROPOSED',
  proposalStatus = 'open',
}) {
  return {
    symbol,
    base,
    state,
    reason: `Published volume reason for ${symbol}`,
    price: 0.1,
    lastTradeTs: NOW - 1_000,
    baseline: {
      ready: true,
      samples: 3,
      confidence: 0.9,
      quotePerSecNorm: 1_000,
      tradesPerSecNorm: 10,
      quotePerMinMedian: 60_000,
      quotePerMinMad: 5_000,
      isDead: false,
    },
    windows: {},
    decisionTs: NOW - 3_000,
    topDepthUsd: 45_000,
    spreadBps: 1.2,
    depthScore: 0.9,
    depthVsNorm: 1.1,
    takerBuyRatio: 0.6,
    washScore: 0.1,
    accelerationPctPerMin: 0.2,
    focusReason: 'Owner-published focus',
    focusAgeMs: 3_000,
    decisionKind: state === 'PROPOSED' ? 'proposal' : 'focus',
    rejectCode: null,
    correlationId: `correlation-${id}`,
    volumeMultiple: { '1s': 4, '5s': 2.5 },
    tradeCountMultiple: { '5s': 3 },
    proposal: {
      id,
      status: proposalStatus,
      direction: 'long',
      confidence: 0.6,
      reason: state === 'PROPOSED' ? 'Published volume proposal reason' : 'Non-proposal owner row',
      featureObservedAtMs: NOW - 4_000,
      expiresAtMs: NOW + 60_000,
    },
  };
}

function volumePayload() {
  return {
    updatedAt: NOW,
    status: {
      running: true,
      streamState: 'open',
      streamConnections: 2,
      openConnections: 2,
      bookState: 'fresh',
      universeSize: 2,
      eligibleSize: 2,
      observedSymbols: 2,
      baselineReady: 2,
      baselineTotal: 2,
      baselineCompleted: 2,
      baselineFailed: 0,
      watching: 0,
      focused: 2,
      openProposals: 1,
      lastTradeTs: NOW - 1_000,
      lastBookTs: NOW - 1_000,
      tradeMessages: 10,
      source: 'Volume trade owner',
      bookSource: 'Volume book owner',
      baselineSource: 'Volume baseline owner',
    },
    thresholds: {
      volume1s: 3,
      volume5s: 2,
      tradeCount: 2,
      followthroughPct: 0.1,
      maxSpreadBps: 10,
      minDepthScore: 0.5,
      baselineMinutes: 2,
    },
    rows: [
      volumeProposal({
        id: 'focus-is-not-a-proposal',
        symbol: 'ADAUSDT',
        base: 'ADA',
        state: 'FOCUS',
        proposalStatus: 'expired',
      }),
      volumeProposal({ id: 'volume-one', symbol: 'DOGEUSDT', base: 'DOGE' }),
    ],
  };
}

test('Opportunities admits only owner-published PROPOSED rows and preserves Basis-then-Volume owner order', () => {
  const basis = decodeBasisOpportunityRead(basisPayload());
  const volume = decodeVolumeOpportunityRead(volumePayload());
  assert.ok(basis);
  assert.ok(volume);
  assert.equal(basis.countConsistent, true);
  assert.equal(volume.countConsistent, true);

  const facts = projectPublishedOpportunityFacts(basis, volume, NOW);
  assert.deepEqual(
    facts.map((fact) => `${fact.source}:${fact.proposalId}`),
    ['BASIS:basis-zero', 'BASIS:basis-positive', 'VOLUME:volume-one'],
  );
  assert.equal(facts.some((fact) => fact.proposalId.includes('watch')), false);
  assert.equal(facts.some((fact) => fact.proposalId.includes('focus')), false);
  assert.equal(facts[0].reportedNetEdgePct, 0, 'known zero must remain distinct from unknown');
  assert.equal(facts[2].reportedNetEdgePct, null, 'Volume net economics are not published');
});

test('Opportunities renders exact reported economics without green, profitability, or action claims', () => {
  const basis = decodeBasisOpportunityRead(basisPayload());
  const volume = decodeVolumeOpportunityRead(volumePayload());
  assert.ok(basis);
  assert.ok(volume);
  const facts = projectPublishedOpportunityFacts(basis, volume, NOW);
  const html = renderToStaticMarkup(createElement(PublishedOpportunityFacts, {
    facts,
    query: '',
    basisTruth: projectOpportunitySourceTruth(basis, null, NOW),
    volumeTruth: projectOpportunitySourceTruth(volume, null, NOW),
    coverageKnown: true,
  }));

  assert.match(html, /basis-zero/);
  assert.match(html, /0\.00%/);
  assert.match(html, /basis-positive/);
  assert.match(html, /\+0\.42%/);
  assert.match(html, /OWNER-REPORTED · NOT A PROFIT VERDICT/);
  assert.match(html, /NOT PUBLISHED BY VOLUME/);
  assert.match(html, /Fees · slippage · funding · borrow NOT PUBLISHED/);
  assert.match(html, /Published volume proposal reason/);
  assert.doesNotMatch(html, /class="[^"]*(?:positive|opportunityx-edge|opportunityx-state)/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, />\s*(?:Approve|Reject|Reserve|Trade|Execute|Watch)\s*</i);
});

test('Opportunities source truth fails closed for retained, conflicting, unavailable, and malformed reads', () => {
  const basis = decodeBasisOpportunityRead(basisPayload());
  assert.ok(basis);
  assert.equal(projectOpportunitySourceTruth(basis, null, NOW).label, 'CURRENT');
  assert.equal(projectOpportunitySourceTruth(basis, 'refresh failed', NOW).label, 'STALE LAST-KNOWN');
  assert.equal(projectOpportunitySourceTruth({ ...basis, countConsistent: false }, null, NOW).label, 'CONFLICT');
  assert.equal(projectOpportunitySourceTruth(null, 'read unavailable', NOW).label, 'UNAVAILABLE');
  assert.equal(projectOpportunitySourceTruth(null, null, NOW).label, 'LOADING');

  const malformedBasis = basisPayload();
  malformedBasis.rows[1].proposal.netEdgePct = Number.POSITIVE_INFINITY;
  assert.equal(decodeBasisOpportunityRead(malformedBasis), null);

  const malformedVolume = volumePayload();
  malformedVolume.rows[1].proposal = null;
  assert.equal(decodeVolumeOpportunityRead(malformedVolume), null);
});

test('Opportunities canonical projection admits trustworthy zero and exposes exact unavailable reasons', () => {
  const zero = decodeCanonicalOpportunityRead({
    state: 'AVAILABLE',
    evaluatedAtMs: NOW,
    reasonCodes: [],
    view: {},
    identities: [],
    losses: [],
    ownerOrderedCanonicalIds: {
      basis: { decisions: [], proposals: [] },
      volume: { decisions: [], proposals: [] },
    },
    maximumActionAuthority: 'ADVISORY',
    capitalReservationAuthority: 'NONE',
    executionAuthority: 'NONE',
  });
  assert.ok(zero);
  assert.equal(zero.proposalCount, 0);
  assert.deepEqual(projectCanonicalOpportunityTruth(zero, null), {
    label: 'AVAILABLE',
    detail: '0 canonical proposals · ADVISORY / NONE / NONE',
  });

  const unavailable = decodeCanonicalOpportunityRead({
    state: 'UNAVAILABLE',
    evaluatedAtMs: NOW,
    reasonCodes: ['BASIS_OPPORTUNITY_OWNER_UNAVAILABLE'],
    view: null,
    identities: [],
    losses: [],
    ownerOrderedCanonicalIds: null,
    maximumActionAuthority: 'ADVISORY',
    capitalReservationAuthority: 'NONE',
    executionAuthority: 'NONE',
  });
  assert.ok(unavailable);
  assert.deepEqual(projectCanonicalOpportunityTruth(unavailable, null), {
    label: 'UNAVAILABLE',
    detail: 'BASIS_OPPORTUNITY_OWNER_UNAVAILABLE',
  });
  assert.equal(decodeCanonicalOpportunityRead({
    ...unavailable,
    maximumActionAuthority: 'EXECUTE',
  }), null);
});

test('Opportunities withholds stale, skewed, expired, duplicate, inconsistent, and incomplete facts', () => {
  const currentBasis = decodeBasisOpportunityRead(basisPayload());
  const currentVolume = decodeVolumeOpportunityRead(volumePayload());
  assert.ok(currentBasis);
  assert.ok(currentVolume);

  const staleBasisPayload = basisPayload();
  staleBasisPayload.updatedAt = NOW - 10_000;
  staleBasisPayload.status.lastBookTs = NOW - 10_000;
  staleBasisPayload.status.lastMarkTs = NOW - 10_000;
  staleBasisPayload.status.lastTickTs = NOW - 10_000;
  const staleBasis = decodeBasisOpportunityRead(staleBasisPayload);
  assert.ok(staleBasis);
  assert.equal(projectOpportunitySourceTruth(staleBasis, null, NOW).label, 'STALE LAST-KNOWN');
  assert.deepEqual(
    projectPublishedOpportunityFacts(staleBasis, currentVolume, NOW).map((fact) => fact.source),
    ['VOLUME'],
  );

  const futureVolumePayload = volumePayload();
  futureVolumePayload.updatedAt = NOW + 5_001;
  futureVolumePayload.status.lastTradeTs = NOW + 5_001;
  futureVolumePayload.status.lastBookTs = NOW + 5_001;
  const futureVolume = decodeVolumeOpportunityRead(futureVolumePayload);
  assert.ok(futureVolume);
  assert.equal(projectOpportunitySourceTruth(futureVolume, null, NOW).label, 'STALE LAST-KNOWN');
  assert.deepEqual(projectPublishedOpportunityFacts(null, futureVolume, NOW), []);

  const futureFactPayload = volumePayload();
  futureFactPayload.rows[1].proposal.featureObservedAtMs = NOW + 5_001;
  futureFactPayload.rows[1].proposal.expiresAtMs = NOW + 60_000;
  const futureFact = decodeVolumeOpportunityRead(futureFactPayload);
  assert.ok(futureFact);
  assert.deepEqual(projectPublishedOpportunityFacts(null, futureFact, NOW), []);

  const expiredPayload = volumePayload();
  expiredPayload.rows[1].proposal.expiresAtMs = NOW;
  const expired = decodeVolumeOpportunityRead(expiredPayload);
  assert.ok(expired);
  assert.equal(projectOpportunitySourceTruth(expired, null, NOW).detail, 'VOLUME_PROPOSAL_EXPIRED');
  assert.deepEqual(projectPublishedOpportunityFacts(null, expired, NOW), []);

  const duplicateVolumeSymbol = volumePayload();
  duplicateVolumeSymbol.rows[1].symbol = duplicateVolumeSymbol.rows[0].symbol;
  assert.equal(decodeVolumeOpportunityRead(duplicateVolumeSymbol), null);

  const duplicateVolumeProposal = volumePayload();
  duplicateVolumeProposal.rows[1].proposal.id = duplicateVolumeProposal.rows[0].proposal.id;
  assert.equal(decodeVolumeOpportunityRead(duplicateVolumeProposal), null);

  const inconsistentVolumeCount = volumePayload();
  inconsistentVolumeCount.status.openProposals = 2;
  assert.equal(decodeVolumeOpportunityRead(inconsistentVolumeCount), null);

  const incompleteBasis = basisPayload();
  incompleteBasis.rows[1].proposal.confidence = null;
  assert.equal(decodeBasisOpportunityRead(incompleteBasis), null);

  const incompleteVolume = volumePayload();
  incompleteVolume.rows[1].proposal.expiresAtMs = null;
  assert.equal(decodeVolumeOpportunityRead(incompleteVolume), null);

  const detachedInput = volumePayload();
  const detached = decodeVolumeOpportunityRead(detachedInput);
  assert.ok(detached);
  detachedInput.rows[1].proposal.reason = 'mutated after decode';
  detachedInput.rows[1].proposal.id = 'mutated-after-decode';
  assert.equal(detached.facts[0].reason, 'Published volume proposal reason');
  assert.equal(detached.facts[0].proposalId, 'volume-one');
});

test('Opportunities uses only existing passive engine reads and shared market truth', async () => {
  const source = await readFile(new URL('../../src/pages/Opportunities.tsx', import.meta.url), 'utf8');
  const endpoints = [...source.matchAll(/'(\/api\/[^']+)'/g)].map((match) => match[1]);

  assert.deepEqual(new Set(endpoints), new Set([
    '/api/engine/basis',
    '/api/engine/volume',
    '/api/system-integration/opportunities',
  ]));
  assert.match(source, /createSettledPoll<OpportunitySourceRead>/);
  assert.match(source, /\{ cache: 'no-store', signal \}/);
  assert.match(source, /basisPoll\.stop\(\)/);
  assert.match(source, /volumePoll\.stop\(\)/);
  assert.match(source, /canonicalPoll\.stop\(\)/);
  assert.match(source, /row\.state !== 'PROPOSED'/);
  assert.match(source, /projectPublishedOpportunityFacts/);
  assert.match(source, /executableBasisBestPct/);
  assert.match(source, /executableBasisSide/);
  assert.match(source, /fundingAnnualPct/);
  assert.match(source, /perpVolume24h/);
  assert.match(source, /STALE LAST-KNOWN/);
  assert.match(source, /OWNER-REPORTED · NOT A PROFIT VERDICT/);

  assert.doesNotMatch(source, /state\.proposals|NO_ACTIVE_LEGACY_PROPOSALS/);
  assert.doesNotMatch(source, /\.sort\s*\(|netAfterFees|sideForBasis|Math\.abs|Math\.max|Math\.min/);
  assert.doesNotMatch(source, /method:\s*['"]POST|\/api\/(?:private|orders?|proposals?|trade|live|kill)/);
  assert.doesNotMatch(source, /className=\{?['"][^'"]*(?:positive|opportunityx-edge)/);
  assert.doesNotMatch(source, /approve|rejectProposal|reserveCapital|executeProposal/i);
});
