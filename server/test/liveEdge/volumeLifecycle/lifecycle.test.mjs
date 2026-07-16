import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVolumeLifecycle,
} from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
import { finalizeProjection } from '../../../dist/liveEdge/adapters/volumeLifecycle/validation.js';
import {
  lifecycleInput,
  openProbe,
  planProbe,
  twinForAction,
} from './fixtures.mjs';

test('staged LONG lifecycle applies PROBE, CONFIRM and HOLD through distinct accepted-L07 proofs under one mandate cap', () => {
  const probe = openProbe();
  assert.equal(probe.settled.projection.state, 'PROBE');
  assert.equal(probe.settled.projection.positionQuantity, '0.02');
  assert.equal(probe.settled.projection.projectedMandateUsageQuote, '2.002');

  const confirmPlan = evaluateVolumeLifecycle(lifecycleInput({
    current: probe.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  assert.equal(confirmPlan.disposition, 'PLANNED');
  assert.equal(confirmPlan.actionRequest.kind, 'ADD');
  assert.equal(confirmPlan.actionRequest.stageTo, 'CONFIRM');
  assert.equal(confirmPlan.actionRequest.requestedQuantity, '0.03');
  assert.equal(confirmPlan.actionRequest.maximumNotionalQuote, '3.198');
  const confirmEvidence = twinForAction(confirmPlan.actionRequest);
  const confirmed = evaluateVolumeLifecycle(lifecycleInput({
    current: confirmPlan.projection,
    twinEvidence: confirmEvidence,
    authority: { riskActionClass: 'ADD' },
  }));
  assert.equal(confirmed.disposition, 'SETTLED');
  assert.equal(confirmed.projection.state, 'CONFIRM');
  assert.equal(confirmed.projection.positionQuantity, '0.05');
  assert.equal(confirmed.projection.projectedMandateUsageQuote, '5.005');

  const allowed = evaluateVolumeLifecycle(lifecycleInput({
    current: confirmed.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  assert.equal(allowed.disposition, 'SETTLED');
  assert.equal(allowed.projection.state, 'ADD_ALLOWED');

  const holdPlan = evaluateVolumeLifecycle(lifecycleInput({
    current: allowed.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  assert.equal(holdPlan.disposition, 'PLANNED');
  assert.equal(holdPlan.actionRequest.stageTo, 'HOLD');
  assert.equal(holdPlan.actionRequest.requestedQuantity, '0.05');
  assert.equal(holdPlan.actionRequest.maximumNotionalQuote, '5.495');
  const holdEvidence = twinForAction(holdPlan.actionRequest);
  const held = evaluateVolumeLifecycle(lifecycleInput({
    current: holdPlan.projection,
    twinEvidence: holdEvidence,
    authority: { riskActionClass: 'ADD' },
  }));

  assert.equal(held.disposition, 'SETTLED');
  assert.equal(held.projection.state, 'HOLD');
  assert.equal(held.projection.positionQuantity, '0.1');
  assert.equal(held.projection.projectedMandateUsageQuote, '10.01');
  assert.equal(held.projection.capitalMandateId, 'capital-mandate-0001');
  assert.deepEqual(
    [probe.planned, confirmPlan, holdPlan].map((item) => item.actionRequest.capitalMandateId),
    ['capital-mandate-0001', 'capital-mandate-0001', 'capital-mandate-0001'],
  );
  assert.ok([probe.planned, confirmPlan, holdPlan].every((item) => item.actionRequest.sendEligible === false));
});

test('inventory-backed SHORT lifecycle remains Spot-only and settles a directional probe without Futures or borrow authority', () => {
  const opened = openProbe({ proposal: { direction: 'SHORT' } }, {
    bids: [{ price: '100', quantity: '0.02' }],
  });
  assert.equal(opened.planned.actionRequest.side, 'SELL');
  assert.equal(opened.planned.projection.direction, 'SHORT');
  assert.equal(opened.settled.projection.state, 'PROBE');
  assert.equal(opened.settled.projection.positionQuantity, '0.02');
  assert.equal(opened.twinEvidence.twinState.product, 'SPOT');
  assert.equal(opened.settled.actionAuthority, 'NONE_RECORD_ONLY');
});

test('outputs are deeply frozen, deterministic and carry no live authority', () => {
  const input = lifecycleInput();
  const first = evaluateVolumeLifecycle(input);
  const second = evaluateVolumeLifecycle(structuredClone(input));
  assert.deepEqual(second, first);
  assert.equal(first.lifecycleAuthority, 'ADVISORY_LIFECYCLE_PROJECTION_ONLY');
  assert.equal(first.simulationAuthority, 'SYNTHETIC_FIXTURE');
  assert.equal(first.sendEligible, false);
  assert.equal(first.externalActionAuthorization, 'NONE');
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.projection));
  assert.ok(Object.isFrozen(first.actionRequest));
  assert.throws(() => { first.reasonCodes.push('MUTATED'); }, TypeError);
});

test('an exact previously recorded action is a no-op and cannot create a second stage request', () => {
  const planned = planProbe();
  const replay = evaluateVolumeLifecycle(lifecycleInput({
    occupancy: {
      priorActions: [{
        actionKey: planned.actionRequest.actionKey,
        intentKey: planned.actionRequest.intentKey,
        lifecycleId: planned.projection.lifecycleId,
        proposalId: planned.projection.proposalId,
        assessmentId: planned.projection.assessmentId,
        symbol: planned.projection.symbol,
        direction: planned.projection.direction,
        kind: planned.actionRequest.kind,
        state: 'PLANNED',
        recordedAtMs: planned.projection.stageEnteredAtMs,
      }],
    },
  }));
  assert.equal(replay.disposition, 'NOOP_REPEAT');
  assert.equal(replay.actionRequest, null);
  assert.deepEqual(replay.reasonCodes, ['NO_REPEAT_LIFECYCLE']);
});

test('one active Volume ticket or position on the symbol blocks a new lifecycle', () => {
  const blocked = evaluateVolumeLifecycle(lifecycleInput({
    occupancy: {
      activeRecords: [{
        recordId: 'foreign-volume-record-0001',
        recordRevision: 'foreign-volume-record-revision-0001',
        projectionRevision: null,
        kind: 'POSITION',
        lifecycleId: 'foreign-volume-lifecycle-0001',
        proposalId: 'foreign-volume-proposal-0001',
        assessmentId: 'foreign-volume-assessment-0001',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        ownerFamily: 'FOREIGN_STRATEGY',
        state: 'ACTIVE',
        positionQuantity: '1',
        intentKey: null,
        actionKey: null,
      }],
    },
  }));
  assert.equal(blocked.disposition, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes('ONE_POSITION_LIMIT'));
  assert.equal(blocked.projection, null);
});

test('a terminal proposal or assessment record cannot reopen even after the no-repeat time window', () => {
  const blocked = evaluateVolumeLifecycle(lifecycleInput({
    occupancy: {
      priorActions: [{
        actionKey: `l11action_${'b'.repeat(64)}`,
        intentKey: `l11intent_${'c'.repeat(64)}`,
        lifecycleId: 'closed-volume-lifecycle-0001',
        proposalId: 'volume-proposal-0001',
        assessmentId: 'volume-assessment-0001',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        kind: 'ENTRY',
        state: 'TERMINAL',
        recordedAtMs: 1,
      }],
    },
  }));
  assert.equal(blocked.disposition, 'NOOP_REPEAT');
  assert.ok(blocked.reasonCodes.includes('NO_REPEAT_LIFECYCLE'));
});

test('three sizing cuts cannot each assume the full mandate cap', () => {
  const blocked = evaluateVolumeLifecycle(lifecycleInput({
    sizing: {
      cuts: [
        { targetState: 'PROBE', cumulativeQuantity: '0.02', cumulativeNotionalQuote: '10', priceBound: '101' },
        { targetState: 'CONFIRM', cumulativeQuantity: '0.05', cumulativeNotionalQuote: '10.1', priceBound: '101' },
        { targetState: 'HOLD', cumulativeQuantity: '0.1', cumulativeNotionalQuote: '10.2', priceBound: '101' },
      ],
    },
  }));
  assert.equal(blocked.disposition, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes('SIZING_STAGE_CAP_INVALID'));
});

test('a short proposal without exact pre-owned inventory proof is blocked', () => {
  const blocked = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { direction: 'SHORT' },
    sizing: {
      availableBaseQuantity: null,
      inventoryRevision: null,
      inventoryAsset: null,
      inventoryAccountRealmId: null,
      inventoryObservedAtMs: null,
      inventoryValidUntilMs: null,
    },
  }));
  assert.equal(blocked.disposition, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes('SHORT_INVENTORY_NOT_PROVED'));
});

test('canonical occupancy rejects rehashed favorable-extreme forks before normal or bound-twin evaluation', () => {
  for (const direction of ['LONG', 'SHORT']) {
    const proposal = {
      proposalId: `volume-proposal-${direction.toLowerCase()}-projection-anchor`,
      direction,
    };
    const opened = openProbe({ proposal });
    const honest = opened.settled.projection;
    const { projectionRevision: _revision, ...material } = honest;
    const forgedPrice = direction === 'LONG' ? '90' : '110';
    const forged = finalizeProjection({
      ...material,
      currentPrice: forgedPrice,
      favorableExtremePrice: forgedPrice,
    });
    const anchoredInput = lifecycleInput({ proposal, current: honest });
    anchoredInput.current = forged;
    assert.throws(
      () => evaluateVolumeLifecycle(anchoredInput),
      /does not match canonical occupancy lineage/u,
    );
  }

  const proposal = { proposalId: 'volume-proposal-pending-projection-anchor' };
  const opened = openProbe({ proposal });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  const { projectionRevision: _revision, ...material } = planned.projection;
  const forgedPending = finalizeProjection({
    ...material,
    currentPrice: '90',
    favorableExtremePrice: '90',
  });
  const anchoredPendingInput = lifecycleInput({
    proposal,
    current: planned.projection,
    authority: { riskActionClass: 'ADD' },
    twinEvidence: twinForAction(planned.actionRequest, { asks: [] }),
  });
  anchoredPendingInput.current = forgedPending;
  assert.throws(
    () => evaluateVolumeLifecycle(anchoredPendingInput),
    /does not match canonical occupancy lineage/u,
  );

  const missingPositionAnchorInput = lifecycleInput({
    proposal,
    current: planned.projection,
    authority: { riskActionClass: 'ADD' },
    occupancy: { activeRecords: [] },
    twinEvidence: twinForAction(planned.actionRequest, { asks: [] }),
  });
  missingPositionAnchorInput.current = forgedPending;
  assert.throws(
    () => evaluateVolumeLifecycle(missingPositionAnchorInput),
    /does not match canonical occupancy lineage/u,
  );
});
