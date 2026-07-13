import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateVolumeLifecycle } from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
import { feeEvidence } from '../exchangeTwin/fixtures.mjs';
import {
  crashRestartEvents,
  lifecycleInput,
  openProbe,
  planProbe,
  reconciliationEvent,
  twinForAction,
} from './fixtures.mjs';

test('an ACK without local fill observation remains pending and never becomes a fill', () => {
  const planned = planProbe();
  const evidence = twinForAction(planned.actionRequest, {
    includePrivate: false,
    reconcile: false,
  });
  const result = evaluateVolumeLifecycle(lifecycleInput({
    current: planned.projection,
    twinEvidence: evidence,
  }));
  assert.equal(result.disposition, 'HOLD');
  assert.equal(result.twinSettlement.state, 'PENDING');
  assert.equal(result.projection.positionQuantity, '0');
  assert.equal(result.projection.openedAtMs, null);
  assert.equal(result.projection.pendingAction.actionKey, planned.actionRequest.actionKey);
});

for (const [name, overrides] of [
  ['partial account truth', { authority: { accountTruth: 'PARTIAL' } }],
  ['stale market truth', { market: { truth: 'STALE' } }],
]) {
  test(`a pending ACK plus ${name} escalates to recovery`, () => {
    const planned = planProbe({ proposal: { proposalId: `volume-proposal-ack-${name.replaceAll(' ', '-')}` } });
    const result = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: `volume-proposal-ack-${name.replaceAll(' ', '-')}` },
      current: planned.projection,
      twinEvidence: twinForAction(planned.actionRequest, { includePrivate: false, reconcile: false }),
      ...overrides,
    }));
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.equal(result.projection.positionQuantity, '0');
    assert.equal(result.projection.pendingAction.actionKey, planned.actionRequest.actionKey);
  });
}

test('HTTP timeout is durable UNKNOWN and emits a reconciliation-only recovery handoff', () => {
  const planned = planProbe();
  const evidence = twinForAction(planned.actionRequest, {
    includePrivate: false,
    httpOutcome: 'TIMEOUT',
    reconcile: false,
  });
  const result = evaluateVolumeLifecycle(lifecycleInput({
    current: planned.projection,
    twinEvidence: evidence,
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.state, 'RECOVERY_REQUIRED');
  assert.equal(result.recoveryHandoff.kind, 'RECONCILIATION_REQUIRED');
  assert.equal(result.recoveryHandoff.recommendationOnly, true);
  assert.equal(result.recoveryHandoff.sendEligible, false);
  assert.equal(result.projection.pendingAction.actionKey, planned.actionRequest.actionKey);
  assert.equal(result.projection.settledTwinHistory.length, 0);
  assert.equal(result.projection.pendingTwinOutcomeRevision, result.recoveryHandoff.twinOutcomeRevision);

  const repeat = evaluateVolumeLifecycle(lifecycleInput({ current: result.projection, twinEvidence: evidence }));
  assert.equal(repeat.disposition, 'RECOVERY_REQUIRED');
  assert.equal(repeat.projection.projectionRevision, result.projection.projectionRevision);

  const corrected = evaluateVolumeLifecycle(lifecycleInput({
    current: result.projection,
    twinEvidence: twinForAction(planned.actionRequest),
  }));
  assert.equal(corrected.disposition, 'SETTLED');
  assert.equal(corrected.projection.positionQuantity, '0.02');
  assert.equal(corrected.projection.positionQuantityTruth, 'EXACT');
  assert.equal(corrected.projection.capitalUsageTruth, 'EXACT');
  assert.equal(corrected.projection.pendingAction, null);
  assert.equal(corrected.projection.pendingTwinStateRevision, null);
  assert.equal(corrected.projection.recoveryEvidenceActionKey, null);
  assert.equal(corrected.projection.lastSettledActionKey, planned.actionRequest.actionKey);
});

test('partial ENTRY observation records exposure before recovery and settles the original ticket', () => {
  const planned = planProbe({ proposal: { proposalId: 'volume-proposal-partial-entry' } });
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-partial-entry' },
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, { asks: [{ price: '100', quantity: '0.01' }] }),
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0.01');
  assert.equal(result.projection.positionQuantityTruth, 'EXACT');
  assert.equal(result.projection.pendingAction, null);
  assert.equal(result.projection.lastSettledActionKey, planned.actionRequest.actionKey);
  assert.ok(result.reasonCodes.includes('TWIN_PARTIAL_FILL_REQUIRES_RECOVERY'));
});

test('an observed fill is accounted before a missing canonical ticket forces recovery', () => {
  const planned = planProbe({ proposal: { proposalId: 'volume-proposal-binding-fill' } });
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-binding-fill' },
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest),
    occupancy: { activeRecords: [] },
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0.02');
  assert.equal(result.projection.pendingAction, null);
  assert.equal(result.projection.lastSettledActionKey, planned.actionRequest.actionKey);
  assert.ok(result.reasonCodes.includes('CANONICAL_OCCUPANCY_BINDING_MISMATCH'));
  assert.equal(result.recoveryHandoff.kind, 'POSITION_RECONSTRUCTION');
});

test('partial EXIT observation retains the exact residual before recovery', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-partial-exit' } });
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-partial-exit' }, current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' }, signals: { reversal: 'PRESENT' },
  }));
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-partial-exit' }, current: exit.projection,
    twinEvidence: twinForAction(exit.actionRequest, { bids: [{ price: '100', quantity: '0.01' }] }),
    signals: { reversal: 'PRESENT' },
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0.01');
  assert.equal(result.projection.positionQuantityTruth, 'EXACT');
  assert.equal(result.projection.pendingAction, null);
  assert.ok(result.reasonCodes.includes('VOLUME_REVERSAL'));
  assert.ok(result.reasonCodes.includes('TWIN_PARTIAL_FILL_REQUIRES_RECOVERY'));
});

test('crash/restart through L07 cannot infer a fill and remains recovery-required', () => {
  const planned = planProbe();
  const evidence = twinForAction(planned.actionRequest, {
    reconcile: false,
    eventsTransform: crashRestartEvents,
  });
  const result = evaluateVolumeLifecycle(lifecycleInput({ current: planned.projection, twinEvidence: evidence }));
  assert.equal(evidence.twinState.orders[0].localTruth, 'RECOVERY_REQUIRED');
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.ok(result.reasonCodes.includes('TWIN_LOCAL_RECOVERY_REQUIRED'));
});

test('exact L07 reconciliation after restart settles the original action once without a duplicate request', () => {
  const planned = planProbe();
  const evidence = twinForAction(planned.actionRequest, {
    reconcile: false,
    eventsTransform: (events, fixture) => reconciliationEvent(crashRestartEvents(events, fixture), fixture),
  });
  const first = evaluateVolumeLifecycle(lifecycleInput({ current: planned.projection, twinEvidence: evidence }));
  const second = evaluateVolumeLifecycle(lifecycleInput({ current: planned.projection, twinEvidence: evidence }));
  assert.deepEqual(second, first);
  assert.equal(evidence.twinState.orders[0].localTruth, 'OBSERVED');
  assert.equal(first.disposition, 'SETTLED');
  assert.equal(first.projection.positionQuantity, '0.02');
  assert.equal(first.projection.lastSettledActionKey, planned.actionRequest.actionKey);
  assert.equal(first.actionRequest, null);
});

test('a twin fill outside the lifecycle price/notional bound records exposure truth and fails to recovery', () => {
  const planned = planProbe();
  const evidence = twinForAction(planned.actionRequest, {
    asks: [{ price: '106', quantity: '0.02' }],
  });
  const result = evaluateVolumeLifecycle(lifecycleInput({ current: planned.projection, twinEvidence: evidence }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.ok(result.reasonCodes.includes('TWIN_PRICE_BOUND_EXCEEDED'));
  assert.ok(result.reasonCodes.includes('TWIN_NOTIONAL_BOUND_EXCEEDED'));
  assert.equal(result.projection.positionQuantity, '0.02');
});

test('a fee-driven final ADD cap breach retains the full observed exposure and usage', () => {
  const proposal = { proposalId: 'volume-proposal-final-add-cap-breach' };
  const opened = openProbe({ proposal });
  const confirm = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: opened.settled.projection, authority: { riskActionClass: 'ADD' },
  }));
  const confirmed = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: confirm.projection, twinEvidence: twinForAction(confirm.actionRequest),
  }));
  const allowed = evaluateVolumeLifecycle(lifecycleInput({ proposal, current: confirmed.projection }));
  const finalAdd = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: allowed.projection, authority: { riskActionClass: 'ADD' },
  }));
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: finalAdd.projection,
    twinEvidence: twinForAction(finalAdd.actionRequest, { fee: feeEvidence({ takerRate: '0.3' }) }),
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0.1');
  assert.equal(result.projection.projectedMandateUsageQuote, '11.505');
  assert.equal(result.projection.positionQuantityTruth, 'EXACT');
  assert.ok(result.reasonCodes.includes('TWIN_FILL_EXCEEDS_SINGLE_MANDATE_CAP'));
});

test('an observed full EXIT outside its SELL bound closes exposure before terminal recovery', () => {
  const proposal = { proposalId: 'volume-proposal-exit-price-breach' };
  const opened = openProbe({ proposal });
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' }, signals: { reversal: 'PRESENT' },
  }));
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: exit.projection,
    twinEvidence: twinForAction(exit.actionRequest, { bids: [{ price: '98', quantity: '0.02' }] }),
    signals: { reversal: 'PRESENT' },
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0');
  assert.equal(result.projection.positionQuantityTruth, 'EXACT');
  assert.equal(result.projection.recoveryResumeState, 'EXIT');
  assert.equal(result.projection.feedbackOutcomeRevision, null);
  assert.ok(result.projection.terminalOutcomeReasonCodes.includes('VOLUME_REVERSAL'));
  assert.ok(result.projection.terminalOutcomeReasonCodes.includes('TWIN_PRICE_BOUND_EXCEEDED'));
  assert.ok(result.projection.terminalOutcomeReasonCodes.includes('POSITION_SYNTHETICALLY_CLOSED'));
});

test('a proven no-fill probe is terminal and cannot be silently repeated', () => {
  const planned = planProbe();
  const evidence = twinForAction(planned.actionRequest, {
    asks: [],
  });
  const result = evaluateVolumeLifecycle(lifecycleInput({ current: planned.projection, twinEvidence: evidence }));
  assert.equal(result.disposition, 'TERMINAL');
  assert.equal(result.projection.state, 'EXIT');
  assert.equal(result.projection.positionQuantity, '0');
  assert.equal(result.feedbackHandoff.outcomeClass, 'HYPOTHETICAL_REPLAY');
  assert.equal(result.feedbackHandoff.realizedPnlAuthority, 'UNAVAILABLE');
});

test('reversal EXIT settles through L07 actual fill and emits synthetic feedback with every reason', () => {
  const opened = openProbe();
  const exitPlan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { reversal: 'PRESENT' },
  }));
  assert.equal(exitPlan.actionRequest.kind, 'EXIT');
  assert.equal(exitPlan.actionRequest.side, 'SELL');
  const evidence = twinForAction(exitPlan.actionRequest, {
    bids: [{ price: '100', quantity: '0.02' }],
  });
  const exited = evaluateVolumeLifecycle(lifecycleInput({
    current: exitPlan.projection,
    twinEvidence: evidence,
    signals: { reversal: 'PRESENT' },
  }));
  assert.equal(exited.disposition, 'TERMINAL');
  assert.equal(exited.projection.state, 'EXIT');
  assert.equal(exited.projection.positionQuantity, '0');
  assert.equal(exited.feedbackHandoff.terminalState, 'EXIT');
  assert.ok(exited.feedbackHandoff.reasonCodes.includes('VOLUME_REVERSAL'));
  assert.equal(exited.feedbackHandoff.externalActionAuthorization, 'NONE');
});

test('exhaustion REDUCE settles actual quantity and retains the same mandate usage projection', () => {
  const opened = openProbe();
  const reducePlan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const evidence = twinForAction(reducePlan.actionRequest, {
    bids: [{ price: '100', quantity: '0.01' }],
  });
  const reduced = evaluateVolumeLifecycle(lifecycleInput({
    current: reducePlan.projection,
    twinEvidence: evidence,
    signals: { exhaustion: 'PRESENT' },
  }));
  assert.equal(reduced.disposition, 'SETTLED');
  assert.equal(reduced.projection.state, 'REDUCE');
  assert.equal(reduced.projection.positionQuantity, '0.01');
  assert.equal(reduced.projection.projectedMandateUsageQuote, '2.002');
  assert.ok(reduced.projection.lastTransition.reasonCodes.includes('VOLUME_EXHAUSTION'));
});

test('SHORT EXIT declares and respects the BUY price-bound cost', () => {
  const opened = openProbe({
    proposal: { direction: 'SHORT', proposalId: 'volume-proposal-short-exit-cost' },
  }, { bids: [{ price: '100', quantity: '0.02' }] });
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { direction: 'SHORT', proposalId: 'volume-proposal-short-exit-cost' },
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { reversal: 'PRESENT' },
    market: { riskReductionPriceBound: '101' },
  }));
  assert.equal(exit.actionRequest.side, 'BUY');
  assert.equal(exit.actionRequest.priceBound, '101');
  assert.equal(exit.actionRequest.maximumNotionalQuote, '2.02');
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { direction: 'SHORT', proposalId: 'volume-proposal-short-exit-cost' },
    current: exit.projection,
    twinEvidence: twinForAction(exit.actionRequest, { asks: [{ price: '101', quantity: '0.02' }] }),
    signals: { reversal: 'PRESENT' },
    market: { riskReductionPriceBound: '101' },
  }));
  assert.equal(terminal.disposition, 'TERMINAL');
  assert.equal(terminal.twinSettlement.filledQuoteNotional, '2.02');
  assert.ok(!terminal.reasonCodes.includes('TWIN_NOTIONAL_BOUND_EXCEEDED'));
});

test('SHORT exit uses retained entry inventory provenance when current available inventory is depleted', () => {
  const proposal = { direction: 'SHORT', proposalId: 'volume-proposal-short-depleted-exit' };
  const opened = openProbe({ proposal }, { bids: [{ price: '100', quantity: '0.02' }] });
  const sizing = { availableBaseQuantity: '0' };
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: opened.settled.projection, sizing,
    authority: { riskActionClass: 'EXIT' }, signals: { reversal: 'PRESENT' },
  }));
  assert.equal(exit.disposition, 'PLANNED');
  assert.equal(exit.actionRequest.availableBaseQuantity, '0.1');
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: exit.projection, sizing,
    twinEvidence: twinForAction(exit.actionRequest, { asks: [{ price: '101', quantity: '0.02' }] }),
    signals: { reversal: 'PRESENT' },
  }));
  assert.equal(terminal.disposition, 'TERMINAL');
  assert.equal(terminal.projection.positionQuantity, '0');
  const replay = evaluateVolumeLifecycle(lifecycleInput({ proposal, current: terminal.projection, sizing }));
  assert.equal(replay.disposition, 'TERMINAL');
});

test('base-fee EXIT preserves last exact quantity and hands reconstruction to recovery', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-exit-base-fee' } });
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-exit-base-fee' },
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { reversal: 'PRESENT' },
  }));
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-exit-base-fee' },
    current: exit.projection,
    twinEvidence: twinForAction(exit.actionRequest, {
      fee: feeEvidence({
        chargeBasis: 'BASE_QUANTITY', feeAsset: exit.actionRequest.baseAsset,
        takerRate: '0.001', quoteConversionRate: '100',
        quoteConversionBaseAsset: exit.actionRequest.baseAsset,
        quoteConversionQuoteAsset: exit.actionRequest.quoteAsset,
        quoteConversionUnit: 'QUOTE_ASSET_PER_FEE_ASSET',
      }),
    }),
    signals: { reversal: 'PRESENT' },
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.ok(result.reasonCodes.includes('TWIN_POSITION_QUANTITY_FEE_AMBIGUOUS'));
  assert.ok(result.reasonCodes.includes('VOLUME_REVERSAL'));
  assert.equal(result.projection.positionQuantity, opened.settled.projection.positionQuantity);
  assert.equal(result.projection.positionQuantityTruth, 'UNKNOWN');
  assert.equal(result.projection.pendingAction, null);
  assert.equal(result.projection.lastSettledActionKey, exit.actionRequest.actionKey);
  assert.equal(result.recoveryHandoff.actionKey, exit.actionRequest.actionKey);
  assert.equal(result.recoveryHandoff.kind, 'POSITION_RECONSTRUCTION');
});

test('terminal feedback survives a post-fill reconciliation recovery and emits exactly once', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-terminal-feedback-recovery' } });
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-feedback-recovery' },
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { reversal: 'PRESENT' },
  }));
  const mismatch = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-feedback-recovery' },
    current: exit.projection,
    twinEvidence: twinForAction(exit.actionRequest),
    signals: { reversal: 'PRESENT', reconciliationState: 'MISMATCH' },
  }));
  assert.equal(mismatch.disposition, 'RECOVERY_REQUIRED');
  assert.equal(mismatch.feedbackHandoff, null);
  assert.equal(mismatch.projection.feedbackOutcomeRevision, null);
  assert.ok(mismatch.projection.terminalOutcomeReasonCodes.includes('VOLUME_REVERSAL'));

  const resolved = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-feedback-recovery' },
    current: mismatch.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT', recoveryRevision: 'volume-terminal-feedback-recovered',
    },
  }));
  assert.equal(resolved.disposition, 'TERMINAL');
  assert.ok(resolved.feedbackHandoff.reasonCodes.includes('VOLUME_REVERSAL'));

  const replay = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-feedback-recovery' },
    current: resolved.projection,
  }));
  assert.equal(replay.disposition, 'TERMINAL');
  assert.equal(replay.feedbackHandoff, null);
  assert.equal(replay.projection.feedbackOutcomeRevision, resolved.projection.feedbackOutcomeRevision);
});

test('canonical reconciliation mismatch enters recovery and resolves only from explicit owner evidence', () => {
  const opened = openProbe();
  const mismatched = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    signals: { reconciliationState: 'MISMATCH' },
  }));
  assert.equal(mismatched.disposition, 'RECOVERY_REQUIRED');
  assert.equal(mismatched.recoveryHandoff.kind, 'POSITION_RECONSTRUCTION');

  const unresolved = evaluateVolumeLifecycle(lifecycleInput({
    current: mismatched.projection,
    signals: { reconciliationState: 'EXACT', recoveryDisposition: 'PENDING' },
  }));
  assert.equal(unresolved.disposition, 'RECOVERY_REQUIRED');

  const resolved = evaluateVolumeLifecycle(lifecycleInput({
    current: mismatched.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT',
      recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT',
      recoveryRevision: 'volume-recovery-revision-0001',
    },
  }));
  assert.equal(resolved.disposition, 'SETTLED');
  assert.equal(resolved.projection.state, 'PROBE');
  assert.equal(resolved.primaryReasonCode, 'CANONICAL_RECOVERY_RESOLVED');
  assert.equal(resolved.projection.lastRecoveryResolutionRevision, 'volume-recovery-revision-0001');

  const independentlyResolved = evaluateVolumeLifecycle(lifecycleInput({
    current: mismatched.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT',
      recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT',
      recoveryRevision: 'volume-recovery-revision-0002',
    },
  }));
  assert.equal(independentlyResolved.projection.lastRecoveryResolutionRevision,
    'volume-recovery-revision-0002');
  assert.notEqual(independentlyResolved.projection.projectionRevision,
    resolved.projection.projectionRevision);
  assert.notEqual(independentlyResolved.decisionRevision, resolved.decisionRevision);
});

test('a second active lifecycle discovered after entry escalates to recovery rather than hiding exposure', () => {
  const opened = openProbe();
  const result = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    occupancy: {
      activeRecords: [{
        recordId: 'foreign-volume-ticket-record-0001',
        recordRevision: 'foreign-volume-ticket-revision-0001',
        kind: 'TICKET',
        lifecycleId: 'foreign-volume-ticket-0001',
        proposalId: 'foreign-volume-proposal-0001',
        assessmentId: 'foreign-volume-assessment-0001',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        ownerFamily: 'FOREIGN_STRATEGY',
        state: 'ACTIVE',
        positionQuantity: null,
        intentKey: `l11intent_${'d'.repeat(64)}`,
        actionKey: `l11action_${'e'.repeat(64)}`,
      }],
    },
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.ok(result.reasonCodes.includes('ONE_POSITION_LIMIT'));
  assert.equal(result.recoveryHandoff.kind, 'POSITION_RECONSTRUCTION');
});
