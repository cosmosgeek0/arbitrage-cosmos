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
  decodeBasisOpportunityRead,
  decodeVolumeOpportunityRead,
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
    executableGapPct: 0.8,
    fundingRate: 0.0001,
    quoteVolume24h: 1_250_000,
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
      human: 'No borrow needed',
    },
    proposal: {
      id,
      status: 'OPEN',
      netEdgePct,
      confidence: 0.75,
      invalidation: 'Executable gap closes',
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
      openProposals: 2,
      lastError: null,
      bookSource: 'Basis books owner',
      markSource: 'Basis mark owner',
    },
    rows: [
      { state: 'WATCHING', proposal: { id: 'watch-is-not-a-proposal' } },
      basisProposal({ id: 'basis-zero', symbol: 'ETHUSDT', base: 'ETH', netEdgePct: 0 }),
      basisProposal({ id: 'basis-positive', symbol: 'BTCUSDT', base: 'BTC', netEdgePct: 0.42 }),
    ],
  };
}

function volumePayload() {
  return {
    updatedAt: NOW,
    status: {
      running: true,
      streamState: 'open',
      bookState: 'fresh',
      openProposals: 1,
      source: 'Volume trade owner',
      bookSource: 'Volume book owner',
    },
    rows: [
      { state: 'FOCUS', proposal: { id: 'focus-is-not-a-proposal' } },
      {
        symbol: 'DOGEUSDT',
        base: 'DOGE',
        state: 'PROPOSED',
        reason: 'Published volume reason',
        price: 0.1,
        decisionTs: NOW - 3_000,
        topDepthUsd: 45_000,
        spreadBps: 1.2,
        volumeMultiple: { '1s': 4, '5s': 2.5 },
        tradeCountMultiple: { '5s': 3 },
        proposal: {
          id: 'volume-one',
          status: 'OPEN',
          direction: 'long',
          confidence: 0.6,
          reason: 'Published volume proposal reason',
          featureObservedAtMs: NOW - 4_000,
          expiresAtMs: NOW + 60_000,
        },
      },
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

  const facts = projectPublishedOpportunityFacts(basis, volume);
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
  const facts = projectPublishedOpportunityFacts(basis, volume);
  const html = renderToStaticMarkup(createElement(PublishedOpportunityFacts, {
    facts,
    query: '',
    basisTruth: projectOpportunitySourceTruth(basis, null),
    volumeTruth: projectOpportunitySourceTruth(volume, null),
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
  assert.equal(projectOpportunitySourceTruth(basis, null).label, 'CURRENT');
  assert.equal(projectOpportunitySourceTruth(basis, 'refresh failed').label, 'STALE LAST-KNOWN');
  assert.equal(projectOpportunitySourceTruth({ ...basis, countConsistent: false }, null).label, 'CONFLICT');
  assert.equal(projectOpportunitySourceTruth(null, 'read unavailable').label, 'UNAVAILABLE');
  assert.equal(projectOpportunitySourceTruth(null, null).label, 'LOADING');

  const malformedBasis = basisPayload();
  malformedBasis.rows[1].proposal.netEdgePct = Number.POSITIVE_INFINITY;
  assert.equal(decodeBasisOpportunityRead(malformedBasis), null);

  const malformedVolume = volumePayload();
  malformedVolume.rows[1].proposal = null;
  assert.equal(decodeVolumeOpportunityRead(malformedVolume), null);
});

test('Opportunities uses only existing passive engine reads and shared market truth', async () => {
  const source = await readFile(new URL('../../src/pages/Opportunities.tsx', import.meta.url), 'utf8');
  const endpoints = [...source.matchAll(/'(\/api\/[^']+)'/g)].map((match) => match[1]);

  assert.deepEqual(new Set(endpoints), new Set(['/api/engine/basis', '/api/engine/volume']));
  assert.match(source, /createSettledPoll<OpportunitySourceRead>/);
  assert.match(source, /\{ cache: 'no-store', signal \}/);
  assert.match(source, /basisPoll\.stop\(\)/);
  assert.match(source, /volumePoll\.stop\(\)/);
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
