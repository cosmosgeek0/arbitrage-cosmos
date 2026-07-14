import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateVolumeLifecycle } from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
import { lifecycleInput, NOW, twinForAction } from './fixtures.mjs';

const cases = [
  ['expired proposal', { proposal: { expiresAtMs: NOW } }, 'PROPOSAL_EXPIRED'],
  ['expired assessment', { advisory: { expiresAtMs: NOW } }, 'ADVISORY_EXPIRED'],
  ['economically expired assessment', { advisory: { economicExpiresAtMs: NOW } }, 'ADVISORY_ECONOMICALLY_EXPIRED'],
  ['exhausted continuation proposal', { proposal: { marketStage: 'EXHAUSTED' } }, 'PROPOSAL_EXHAUSTED'],
  ['exhausted advisory evidence', { advisory: { exhaustion: 'PRESENT' } }, 'ADVISORY_EXHAUSTED'],
  ['unknown advisory exhaustion', { advisory: { exhaustion: 'UNKNOWN' } }, 'ADVISORY_EXHAUSTION_UNKNOWN'],
  ['reversal before entry', { advisory: { reversal: 'PRESENT' } }, 'ADVISORY_REVERSAL_PRESENT'],
  ['unknown market stage', { proposal: { marketStage: 'UNKNOWN' } }, 'PROPOSAL_STAGE_UNKNOWN'],
  ['stale advisory truth', { advisory: { sourceQuality: 'STALE' } }, 'ADVISORY_SOURCE_NOT_COMPLETE'],
  ['read-only system mode', { authority: { systemMode: 'READ_ONLY' } }, 'SYSTEM_MODE_NOT_VALIDATE_ONLY'],
  ['blocked Capital fixture', { authority: { capitalState: 'BLOCKED' } }, 'CAPITAL_NOT_ACTIVE'],
  ['blocked Foundation Risk fixture', { authority: { riskState: 'BLOCKED' } }, 'RISK_NOT_ALLOWED'],
  ['missing approval', { authority: { approvalState: 'MISSING', approvalId: null, approvalRevision: null, approvalExpiresAtMs: null } }, 'APPROVAL_NOT_VALIDATE_ONLY'],
  ['partial account truth', { authority: { accountTruth: 'PARTIAL' } }, 'ACCOUNT_TRUTH_NOT_COMPLETE'],
  ['unknown position truth', { authority: { positionTruth: 'UNKNOWN' } }, 'POSITION_TRUTH_NOT_COMPLETE'],
  ['stale market truth', { market: { truth: 'STALE' } }, 'MARKET_TRUTH_NOT_COMPLETE'],
  ['expired market evidence', { market: { validUntilMs: NOW } }, 'MARKET_EVIDENCE_EXPIRED'],
  ['insufficient depth', { market: { intendedDepthQuote: '9' } }, 'MARKET_DEPTH_INSUFFICIENT'],
  ['spread beyond bound', { market: { spreadBps: 51 } }, 'MARKET_SPREAD_EXCEEDED'],
  ['unavailable sizing', { sizing: { state: 'UNAVAILABLE' } }, 'SIZING_NOT_READY'],
  ['unknown occupancy truth', { occupancy: { truth: 'UNKNOWN' } }, 'OCCUPANCY_TRUTH_NOT_COMPLETE'],
  ['reconciliation mismatch at entry', { signals: { reconciliationState: 'MISMATCH' } }, 'RECONCILIATION_NOT_EXACT'],
];

for (const [name, overrides, reason] of cases) {
  test(`${name} blocks staged entry with ${reason}`, () => {
    const result = evaluateVolumeLifecycle(lifecycleInput(overrides));
    assert.equal(result.disposition, 'BLOCKED');
    assert.ok(result.reasonCodes.includes(reason), result.reasonCodes.join(','));
    assert.equal(result.actionRequest, null);
  });
}

test('feature/evidence revision disagreement blocks the advisory-to-Volume owner seam', () => {
  const result = evaluateVolumeLifecycle(lifecycleInput({
    advisory: { featureRevision: 'foreign-feature-revision-0001' },
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.ok(result.reasonCodes.includes('ADVISORY_BINDING_MISMATCH'));
});

test('explicit fade entry is accepted only with FADE stage and fade eligibility', () => {
  const rejected = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { entryKind: 'FADE', marketStage: 'EXHAUSTED' },
    advisory: { stage: 'EXHAUSTED', exhaustion: 'PRESENT', fadeEligible: false },
  }));
  assert.equal(rejected.disposition, 'BLOCKED');
  assert.ok(rejected.reasonCodes.includes('FADE_NOT_EXPLICITLY_ELIGIBLE'));

  const accepted = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { entryKind: 'FADE', marketStage: 'EXHAUSTED' },
    advisory: { stage: 'FADE', exhaustion: 'PRESENT', fadeEligible: true },
  }));
  assert.equal(accepted.disposition, 'PLANNED');
});

test('explicit FADE exhaustion can settle without immediately exiting the evidence it targets', () => {
  const owner = {
    proposal: { proposalId: 'volume-proposal-fade-roundtrip', entryKind: 'FADE', marketStage: 'EXHAUSTED' },
    advisory: { stage: 'FADE', exhaustion: 'PRESENT', fadeEligible: true },
    signals: { exhaustion: 'PRESENT' },
  };
  const planned = evaluateVolumeLifecycle(lifecycleInput(owner));
  assert.equal(planned.disposition, 'PLANNED');
  const settled = evaluateVolumeLifecycle(lifecycleInput({
    ...owner, current: planned.projection, twinEvidence: twinForAction(planned.actionRequest),
  }));
  assert.equal(settled.disposition, 'SETTLED');
  assert.equal(settled.projection.positionQuantity, '0.02');
  const held = evaluateVolumeLifecycle(lifecycleInput({
    ...owner, current: settled.projection, signals: { exhaustion: 'PRESENT', confirmation: 'PENDING' },
  }));
  assert.equal(held.disposition, 'HOLD');
  assert.equal(held.projection.positionQuantity, '0.02');
});

test('known zero cost and downside remain valid while missing fields never default to zero', () => {
  const knownZero = evaluateVolumeLifecycle(lifecycleInput({
    market: { expectedCostQuote: '0', expectedDownsideQuote: '0' },
  }));
  assert.equal(knownZero.disposition, 'PLANNED');

  const malformed = lifecycleInput();
  delete malformed.market.expectedCostQuote;
  assert.throws(() => evaluateVolumeLifecycle(malformed), /closed schema/u);
});

test('hostile accessors, secret-shaped fields, aliases and non-integer time fail before lifecycle evaluation', () => {
  const accessor = lifecycleInput();
  Object.defineProperty(accessor.market, 'currentPrice', { enumerable: true, get: () => '100' });
  assert.throws(() => evaluateVolumeLifecycle(accessor), /enumerable data/u);

  const secret = lifecycleInput();
  secret.market.apiSecret = 'forbidden';
  assert.throws(() => evaluateVolumeLifecycle(secret), /secret-shaped/u);

  const alias = lifecycleInput();
  alias.market.evidenceIds = alias.signals.evidenceIds;
  assert.throws(() => evaluateVolumeLifecycle(alias), /alias-free/u);

  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({ evaluatedAtMs: 1.5 })), /safe integers|UTC millisecond/u);
});
