import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addVolumeDecimals,
  deriveVolumeL07Binding,
  deriveVolumeRiskContextRevision,
  deriveVolumeTwinFixtureId,
  divideVolumeDecimals,
  evaluateVolumeLifecycle,
  multiplyVolumeDecimals,
  multiplyVolumePpm,
  projectVolumeProtectionRevision,
} from '../../../dist/liveEdge/adapters/volumeLifecycle/index.js';
import { runExchangeTwinScenario } from '../../../dist/liveEdge/adapters/exchangeTwin/index.js';
import {
  deriveVolumeActionKey,
  deriveVolumeIntentKey,
  finalizeProjection,
  validateLifecycleProjection,
} from '../../../dist/liveEdge/adapters/volumeLifecycle/validation.js';
import { feeEvidence, scenarioInput } from '../exchangeTwin/fixtures.mjs';
import {
  lifecycleInput,
  NOW,
  openProbe,
  planProbe,
  protectionPolicy,
  twinForAction,
} from './fixtures.mjs';

test('stage quantities cannot understate their bound notional and exact results stay bounded', () => {
  const blocked = planProbe({
    proposal: { proposalId: 'volume-proposal-incoherent-sizing' },
    sizing: { cuts: [
      { targetState: 'PROBE', cumulativeQuantity: '0.02', cumulativeNotionalQuote: '0.1', priceBound: '101' },
      { targetState: 'CONFIRM', cumulativeQuantity: '0.05', cumulativeNotionalQuote: '0.2', priceBound: '101' },
      { targetState: 'HOLD', cumulativeQuantity: '0.1', cumulativeNotionalQuote: '0.3', priceBound: '101' },
    ] },
  });
  assert.equal(blocked.disposition, 'BLOCKED');
  assert.ok(blocked.reasonCodes.includes('SIZING_QUANTITY_NOTIONAL_INCOHERENT'));
  assert.equal(blocked.actionRequest, null);

  assert.throws(() => addVolumeDecimals('9'.repeat(256), '1'), /overbound/u);
  assert.throws(() => multiplyVolumeDecimals('9'.repeat(256), '9'.repeat(256)), /overbound/u);
  assert.throws(() => divideVolumeDecimals('9'.repeat(256), '0.1'), /overbound/u);
  assert.throws(() => multiplyVolumePpm('9'.repeat(256), 999_999), /overbound/u);
});

test('risk-context derivation rejects hostile accessors without invoking them', () => {
  const hostile = lifecycleInput();
  const proposal = hostile.proposal;
  let getterHits = 0;
  Object.defineProperty(hostile, 'proposal', {
    enumerable: true,
    get() {
      getterHits += 1;
      return proposal;
    },
  });

  assert.throws(() => deriveVolumeRiskContextRevision(hostile), /enumerable data/u);
  assert.equal(getterHits, 0);
});

test('L07 binding derivation rejects incomplete hostile action records without invoking accessors', () => {
  let getterHits = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'actionKey', {
    enumerable: true,
    get() {
      getterHits += 1;
      return `l11action_${'a'.repeat(64)}`;
    },
  });

  assert.throws(() => deriveVolumeL07Binding(hostile), /enumerable data|closed schema/u);
  assert.equal(getterHits, 0);
  assert.throws(() => deriveVolumeL07Binding({}), /closed schema/u);
});

test('rehashed increasing actions cannot claim exit triggers and active stages cannot erase exposure', () => {
  const planned = planProbe({ proposal: { proposalId: 'volume-proposal-trigger-tamper' } });
  const forgedAction = {
    ...planned.actionRequest,
    triggerReasonCodes: ['VOLUME_REVERSAL'],
  };
  forgedAction.actionKey = deriveVolumeActionKey(forgedAction);
  const { projectionRevision: _plannedRevision, ...plannedMaterial } = planned.projection;
  const forgedPending = finalizeProjection({
    ...plannedMaterial,
    pendingAction: forgedAction,
  });
  assert.throws(() => validateLifecycleProjection(forgedPending), /increasing action/u);

  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-zero-confirm' } });
  const { projectionRevision: _openedRevision, ...openedMaterial } = opened.settled.projection;
  const zeroConfirm = finalizeProjection({
    ...openedMaterial,
    state: 'CONFIRM',
    openedAtMs: null,
    positionQuantity: '0',
    lastTransition: {
      ...openedMaterial.lastTransition,
      from: 'PROBE',
      to: 'CONFIRM',
      primaryReasonCode: 'FORGED_ZERO_CONFIRM',
      reasonCodes: ['FORGED_ZERO_CONFIRM'],
    },
  });
  assert.throws(() => validateLifecycleProjection(zeroConfirm), /requires retained exposure/u);
});

test('rehashed ENTRY and REDUCE quantities remain bound to retained stage and episode targets', () => {
  const entry = planProbe({ proposal: { proposalId: 'volume-proposal-entry-quantity-tamper' } });
  const forgedEntry = {
    ...entry.actionRequest,
    requestedQuantity: '0.05',
    maximumNotionalQuote: '5.2',
    mandateUsageAfterQuote: addVolumeDecimals(entry.actionRequest.mandateUsageBeforeQuote, '5.2'),
  };
  forgedEntry.intentKey = deriveVolumeIntentKey(forgedEntry);
  forgedEntry.actionKey = deriveVolumeActionKey(forgedEntry);
  const { projectionRevision: _entryRevision, ...entryMaterial } = entry.projection;
  const forgedEntryProjection = finalizeProjection({ ...entryMaterial, pendingAction: forgedEntry });
  assert.throws(() => validateLifecycleProjection(forgedEntryProjection), /retained sizing cut/u);

  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-reduce-quantity-tamper' } });
  const reduce = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-reduce-quantity-tamper' },
    current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const forgedReduce = {
    ...reduce.actionRequest,
    requestedQuantity: '0.015',
    maximumNotionalQuote: multiplyVolumeDecimals(reduce.actionRequest.priceBound, '0.015'),
  };
  forgedReduce.intentKey = deriveVolumeIntentKey(forgedReduce);
  forgedReduce.actionKey = deriveVolumeActionKey(forgedReduce);
  const { projectionRevision: _reduceRevision, ...reduceMaterial } = reduce.projection;
  const forgedReduceProjection = finalizeProjection({ ...reduceMaterial, pendingAction: forgedReduce });
  assert.throws(() => validateLifecycleProjection(forgedReduceProjection), /episode target/u);
});

const HARD_LABELS = Object.freeze({
  lifecycleAuthority: 'ADVISORY_LIFECYCLE_PROJECTION_ONLY',
  simulationAuthority: 'SYNTHETIC_FIXTURE',
  sendEligible: false,
  actionAuthority: 'NONE_RECORD_ONLY',
  externalActionAuthorization: 'NONE',
});

function assertHardLabels(value) {
  for (const [field, expected] of Object.entries(HARD_LABELS)) assert.equal(value[field], expected, field);
}

function priorRecord(planned, overrides = {}) {
  return {
    actionKey: planned.actionRequest.actionKey,
    intentKey: planned.actionRequest.intentKey,
    lifecycleId: planned.projection.lifecycleId,
    proposalId: planned.projection.proposalId,
    assessmentId: planned.projection.assessmentId,
    symbol: planned.projection.symbol,
    direction: planned.projection.direction,
    kind: planned.actionRequest.kind,
    state: 'PLANNED',
    recordedAtMs: planned.actionRequest.plannedAtMs,
    ...overrides,
  };
}

test('every decision, action, projection, recovery and terminal feedback retains the full hard boundary matrix', () => {
  const planned = planProbe();
  assertHardLabels(planned);
  assertHardLabels(planned.projection);
  assertHardLabels(planned.actionRequest);

  const timeout = evaluateVolumeLifecycle(lifecycleInput({
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, {
      includePrivate: false,
      httpOutcome: 'TIMEOUT',
      reconcile: false,
    }),
  }));
  assertHardLabels(timeout.recoveryHandoff);

  const noFillPlan = planProbe({ proposal: { proposalId: 'volume-proposal-no-fill-labels' } });
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-no-fill-labels' },
    current: noFillPlan.projection,
    twinEvidence: twinForAction(noFillPlan.actionRequest, { asks: [] }),
  }));
  assertHardLabels(terminal.feedbackHandoff);
});

for (const [name, signals, reason] of [
  ['global halt', { globalHalt: true }, 'GLOBAL_HALT_BLOCKS_INCREASE'],
  ['manual close', { manualClose: true }, 'MANUAL_CLOSE_BLOCKS_INCREASE'],
  ['thesis invalidation', { thesisInvalidated: true }, 'THESIS_INVALIDATED_BLOCKS_INCREASE'],
  ['unknown thesis', { thesisInvalidated: null }, 'THESIS_INVALIDATION_UNKNOWN_BLOCKS_INCREASE'],
  ['reversal', { reversal: 'PRESENT' }, 'VOLUME_REVERSAL_BLOCKS_INCREASE'],
  ['unknown reversal', { reversal: 'UNKNOWN' }, 'VOLUME_REVERSAL_UNKNOWN_BLOCKS_INCREASE'],
  ['exhaustion', { exhaustion: 'PRESENT' }, 'VOLUME_EXHAUSTION_BLOCKS_INCREASE'],
  ['unknown exhaustion', { exhaustion: 'UNKNOWN' }, 'VOLUME_EXHAUSTION_UNKNOWN_BLOCKS_INCREASE'],
  ['degraded source', { sourceState: 'DEGRADED' }, 'SOURCE_STATE_BLOCKS_INCREASE'],
  ['deteriorated depth', { spreadDepthState: 'DETERIORATED' }, 'SPREAD_DEPTH_BLOCKS_INCREASE'],
]) {
  test(`${name} cannot increase Volume exposure`, () => {
    const result = evaluateVolumeLifecycle(lifecycleInput({ signals }));
    assert.equal(result.disposition, 'BLOCKED');
    assert.ok(result.reasonCodes.includes(reason), result.reasonCodes.join(','));
    assert.equal(result.actionRequest, null);
  });
}

test('stage price bounds may tighten but never widen the exact market bound in either direction', () => {
  const long = evaluateVolumeLifecycle(lifecycleInput({
    sizing: { cuts: [
      { targetState: 'PROBE', cumulativeQuantity: '0.02', cumulativeNotionalQuote: '2.1', priceBound: '102' },
      { targetState: 'CONFIRM', cumulativeQuantity: '0.05', cumulativeNotionalQuote: '5.2', priceBound: '102' },
      { targetState: 'HOLD', cumulativeQuantity: '0.1', cumulativeNotionalQuote: '10.5', priceBound: '102' },
    ] },
  }));
  assert.ok(long.reasonCodes.includes('SIZING_PRICE_BOUND_WIDENED'));

  const short = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { direction: 'SHORT' },
    sizing: { cuts: [
      { targetState: 'PROBE', cumulativeQuantity: '0.02', cumulativeNotionalQuote: '2.1', priceBound: '98' },
      { targetState: 'CONFIRM', cumulativeQuantity: '0.05', cumulativeNotionalQuote: '5.2', priceBound: '98' },
      { targetState: 'HOLD', cumulativeQuantity: '0.1', cumulativeNotionalQuote: '10.5', priceBound: '98' },
    ] },
  }));
  assert.ok(short.reasonCodes.includes('SIZING_PRICE_BOUND_WIDENED'));
});

test('the exact stage budget must fit current intended depth even when the minimum-depth floor passes', () => {
  const result = evaluateVolumeLifecycle(lifecycleInput({
    market: { intendedDepthQuote: '2', minimumDepthQuote: '1' },
  }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.deepEqual(result.reasonCodes, ['STAGE_DEPTH_INSUFFICIENT']);
});

test('market and signal prices must describe one current observation', () => {
  const result = evaluateVolumeLifecycle(lifecycleInput({ signals: { currentPrice: '100.1' } }));
  assert.equal(result.disposition, 'BLOCKED');
  assert.ok(result.reasonCodes.includes('MARKET_SIGNAL_PRICE_MISMATCH'));
});

test('SHORT inventory is asset, realm, quantity and freshness bound', () => {
  for (const sizing of [
    { inventoryAsset: 'ETH' },
    { inventoryAccountRealmId: 'account-realm:foreign' },
    { inventoryValidUntilMs: NOW },
  ]) {
    const result = evaluateVolumeLifecycle(lifecycleInput({ proposal: { direction: 'SHORT' }, sizing }));
    assert.equal(result.disposition, 'BLOCKED');
    assert.ok(result.reasonCodes.some((reason) => reason.startsWith('SHORT_INVENTORY_')));
  }
});

test('SHORT inventory quantity and freshness provenance changes every bound action identity', () => {
  const lower = planProbe({
    proposal: { direction: 'SHORT', proposalId: 'volume-proposal-short-inventory-lower' },
    sizing: { availableBaseQuantity: '0.1' },
  });
  const higher = planProbe({
    proposal: { direction: 'SHORT', proposalId: 'volume-proposal-short-inventory-higher' },
    sizing: { availableBaseQuantity: '0.2' },
  });
  assert.notEqual(lower.projection.entryEvidenceRevision, higher.projection.entryEvidenceRevision);
  assert.notEqual(lower.actionRequest.ownerEvidenceRevision, higher.actionRequest.ownerEvidenceRevision);
  assert.notEqual(lower.actionRequest.actionKey, higher.actionRequest.actionKey);
  assert.equal(lower.actionRequest.availableBaseQuantity, '0.1');
  assert.equal(higher.actionRequest.availableBaseQuantity, '0.2');
});

test('risk context is content-bound to proposal direction, advisory, sizing, policy and post-hash mutation', () => {
  const baseline = lifecycleInput();
  const variants = [
    lifecycleInput({ proposal: { direction: 'SHORT' } }),
    lifecycleInput({ advisory: { assessmentFingerprintSha256: 'b'.repeat(64), modelRevision: 'volume-model-revision-0002' } }),
    lifecycleInput({ sizing: { accountRealmId: 'account-realm:secondary' } }),
    lifecycleInput({ policy: protectionPolicy({ maximumLossBps: 499 }) }),
  ];
  const baselineRevision = deriveVolumeRiskContextRevision(baseline);
  for (const variant of variants) assert.notEqual(deriveVolumeRiskContextRevision(variant), baselineRevision);

  baseline.proposal.proposalDigest = 'volume-proposal-digest-mutated-after-risk';
  const blocked = evaluateVolumeLifecycle(baseline);
  assert.ok(blocked.reasonCodes.includes('RISK_CONTEXT_MISMATCH'));
});

test('risk verdict context must bind the exact current projection and exposure', () => {
  const entry = lifecycleInput();
  entry.authority.riskBoundPositionQuantity = '1';
  const blockedEntry = evaluateVolumeLifecycle(entry);
  assert.ok(blockedEntry.reasonCodes.includes('RISK_CONTEXT_MISMATCH'));

  const opened = openProbe();
  const exit = lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { manualClose: true },
  });
  exit.authority.riskBoundPositionQuantity = '0';
  const result = evaluateVolumeLifecycle(exit);
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.ok(result.reasonCodes.includes('RISK_REDUCTION_OWNER_RECHECK_REQUIRED'));
  assert.equal(result.actionRequest, null);
});

test('risk reduction refuses foreign, unavailable, future, stale or post-verdict sizing truth', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-risk-recheck-sizing' } });
  for (const sizing of [
    { state: 'UNAVAILABLE' },
    { observedAtMs: NOW + 1 },
    { observedAtMs: NOW - 6_000, validUntilMs: NOW + 100 },
    { observedAtMs: NOW },
    { validUntilMs: NOW },
  ]) {
    const result = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: 'volume-proposal-risk-recheck-sizing' },
      current: opened.settled.projection,
      authority: { riskActionClass: 'EXIT' },
      signals: { globalHalt: true },
      sizing,
    }));
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.ok(result.reasonCodes.includes('RISK_REDUCTION_OWNER_RECHECK_REQUIRED'));
    assert.equal(result.actionRequest, null);
  }

  const foreign = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-risk-recheck-sizing' },
    current: opened.settled.projection,
    authority: { riskActionClass: 'EXIT' },
    signals: { globalHalt: true },
    sizing: { accountRealmId: 'account-realm:foreign' },
  }));
  assert.equal(foreign.disposition, 'RECOVERY_REQUIRED');
  assert.ok(foreign.reasonCodes.includes('CURRENT_BINDING_MISMATCH'));
  assert.equal(foreign.actionRequest, null);
});

test('immutable Capital reservation/cap and exact entry evidence cannot drift under stable IDs', () => {
  const opened = openProbe();
  const capitalDrift = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { capitalMaximumQuote: '12', capitalMandateDigest: 'mutated-capital-digest' },
  }));
  assert.equal(capitalDrift.disposition, 'RECOVERY_REQUIRED');
  assert.ok(capitalDrift.reasonCodes.includes('CURRENT_BINDING_MISMATCH'));

  const evidenceDrift = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    proposal: { proposalDigest: 'mutated-proposal-digest' },
  }));
  assert.equal(evidenceDrift.disposition, 'RECOVERY_REQUIRED');
  assert.ok(evidenceDrift.reasonCodes.includes('CURRENT_BINDING_MISMATCH'));
});

test('PPM multiplication retains exact six-decimal multiplier precision', () => {
  assert.equal(multiplyVolumePpm('0.000001', 500_000), '0.0000005');
  assert.equal(multiplyVolumePpm('0.1', 333_333), '0.0333333');
  assert.equal(multiplyVolumePpm('1', 999_999), '0.999999');
});

test('a recent PLANNED symbol intent blocks a new proposal and a same-lifecycle active record blocks lost-current replay', () => {
  const planned = planProbe();
  const recent = evaluateVolumeLifecycle(lifecycleInput({
    proposal: {
      proposalId: 'volume-proposal-0002',
      proposalRevision: 'volume-proposal-revision-0002',
      proposalDigest: 'volume-proposal-digest-0002',
    },
    occupancy: { priorActions: [priorRecord(planned)] },
  }));
  assert.equal(recent.disposition, 'NOOP_REPEAT');

  const lostCurrent = evaluateVolumeLifecycle(lifecycleInput({
    occupancy: { activeRecords: [{
      recordId: 'same-lifecycle-position-record',
      recordRevision: 'same-lifecycle-position-revision',
      kind: 'POSITION',
      lifecycleId: planned.projection.lifecycleId,
      proposalId: planned.projection.proposalId,
      assessmentId: planned.projection.assessmentId,
      symbol: planned.projection.symbol,
      direction: planned.projection.direction,
      ownerFamily: 'VOLUME_LIFECYCLE_ADAPTER',
      state: 'ACTIVE',
      positionQuantity: '0.02',
      intentKey: null,
      actionKey: null,
    }] },
  }));
  assert.equal(lostCurrent.disposition, 'BLOCKED');
  assert.ok(lostCurrent.reasonCodes.includes('ONE_POSITION_LIMIT'));
});

test('ADD no-fill cannot auto-reissue without a new owner signal revision', () => {
  const opened = openProbe();
  const add = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  const noFill = evaluateVolumeLifecycle(lifecycleInput({
    current: add.projection,
    authority: { riskActionClass: 'ADD' },
    twinEvidence: twinForAction(add.actionRequest, { asks: [] }),
  }));
  assert.equal(noFill.disposition, 'SETTLED');
  const replay = evaluateVolumeLifecycle(lifecycleInput({
    current: noFill.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  assert.equal(replay.disposition, 'HOLD');
  assert.deepEqual(replay.reasonCodes, ['UNCHANGED_OWNER_EVIDENCE_AFTER_NO_FILL']);
  assert.equal(replay.actionRequest, null);
  const changedBookOnly = evaluateVolumeLifecycle(lifecycleInput({
    current: noFill.projection,
    authority: { riskActionClass: 'ADD' },
    market: { bookRevision: `book-revision:${'d'.repeat(24)}` },
  }));
  assert.equal(changedBookOnly.disposition, 'HOLD');
  assert.deepEqual(changedBookOnly.reasonCodes, ['UNCHANGED_INTENT_AFTER_NO_FILL']);
  assert.equal(changedBookOnly.actionRequest, null);
});

test('final staged ADD rechecks fresh confirmation and add permission after ADD_ALLOWED', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-final-add-recheck' } });
  const confirmPlan = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-final-add-recheck' },
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  const confirmed = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-final-add-recheck' },
    current: confirmPlan.projection,
    twinEvidence: twinForAction(confirmPlan.actionRequest),
    authority: { riskActionClass: 'ADD' },
  }));
  const allowed = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-final-add-recheck' },
    current: confirmed.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  assert.equal(allowed.projection.state, 'ADD_ALLOWED');
  const revoked = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-final-add-recheck' },
    current: allowed.projection,
    authority: { riskActionClass: 'ADD' },
    signals: { confirmation: 'FAILED', addPermission: 'BLOCKED' },
  }));
  assert.equal(revoked.disposition, 'BLOCKED');
  assert.deepEqual(revoked.reasonCodes, ['ADD_OWNER_EVIDENCE_NOT_CONFIRMED']);
  assert.equal(revoked.actionRequest, null);
});

test('risk-reducing EXIT remains approval-independent but pending exposure cannot hide a new halt', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-approval-independent-exit' } });
  const exit = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-approval-independent-exit' },
    current: opened.settled.projection,
    authority: {
      riskActionClass: 'EXIT', approvalState: 'MISSING', approvalId: null,
      approvalRevision: null, approvalExpiresAtMs: null,
    },
    signals: { globalHalt: true },
  }));
  assert.equal(exit.disposition, 'PLANNED');
  assert.equal(exit.actionRequest.kind, 'EXIT');
  assert.equal(exit.actionRequest.approvalId, null);
  const roundTrip = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-approval-independent-exit' },
    current: exit.projection,
    authority: {
      riskActionClass: 'EXIT', approvalState: 'MISSING', approvalId: null,
      approvalRevision: null, approvalExpiresAtMs: null,
    },
    signals: { globalHalt: true },
  }));
  assert.equal(roundTrip.disposition, 'RECOVERY_REQUIRED');
  assert.ok(roundTrip.reasonCodes.includes('PENDING_ACTION_DURING_EXIT_TRIGGER'));

  const entry = planProbe({ proposal: { proposalId: 'volume-proposal-pending-halt' } });
  const pending = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-pending-halt' },
    current: entry.projection,
    twinEvidence: twinForAction(entry.actionRequest, { includePrivate: false, reconcile: false }),
    signals: { globalHalt: true },
  }));
  assert.equal(pending.disposition, 'RECOVERY_REQUIRED');
  assert.ok(pending.reasonCodes.includes('PENDING_ACTION_DURING_EXIT_TRIGGER'));
  assert.ok(pending.reasonCodes.includes('GLOBAL_HALT'));
  assert.equal(pending.projection.pendingAction.actionKey, entry.actionRequest.actionKey);
});

for (const [name, signals, expectedKind] of [
  ['global halt', { globalHalt: true }, 'EXIT'],
  ['reversal', { reversal: 'PRESENT' }, 'EXIT'],
  ['exhaustion', { exhaustion: 'PRESENT' }, 'REDUCE'],
]) {
  test(`canonical recovery resolution cannot hide a persistent ${name}`, () => {
    const opened = openProbe({ proposal: { proposalId: `volume-proposal-recovery-${name.replace(' ', '-')}` } });
    const recovery = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: `volume-proposal-recovery-${name.replace(' ', '-')}` },
      current: opened.settled.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals,
    }));
    assert.equal(recovery.disposition, 'RECOVERY_REQUIRED');
    assert.ok(recovery.reasonCodes.includes('RISK_REDUCTION_OWNER_RECHECK_REQUIRED'));

    const resolved = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: `volume-proposal-recovery-${name.replace(' ', '-')}` },
      current: recovery.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals: {
        ...signals,
        reconciliationState: 'EXACT',
        recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT',
        recoveryRevision: `volume-recovery-persistent-${name.replace(' ', '-')}`,
      },
    }));
    assert.equal(resolved.disposition, 'BLOCKED');
    assert.equal(resolved.projection.state, 'PROBE');
    assert.equal(resolved.projection.positionQuantity, '0.02');
    assert.equal(resolved.actionRequest, null);
    assert.ok(resolved.reasonCodes.includes('CANONICAL_RECOVERY_RESOLVED_RISK_RECHECK_REQUIRED'));

    const rechecked = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: `volume-proposal-recovery-${name.replace(' ', '-')}` },
      current: resolved.projection,
      authority: { riskActionClass: expectedKind },
      signals,
    }));
    assert.equal(rechecked.disposition, 'PLANNED');
    assert.equal(rechecked.actionRequest.kind, expectedKind);
  });
}

for (const [kind, signals, book] of [
  ['REDUCE', { exhaustion: 'PRESENT' }, { bids: [] }],
  ['EXIT', { reversal: 'PRESENT' }, { bids: [] }],
]) {
  test(`${kind} no-fill preserves exposure and requires canonical recovery before retry`, () => {
    const opened = openProbe();
    const planned = evaluateVolumeLifecycle(lifecycleInput({
      current: opened.settled.projection,
      authority: { riskActionClass: kind },
      signals,
    }));
    const result = evaluateVolumeLifecycle(lifecycleInput({
      current: planned.projection,
      authority: { riskActionClass: kind },
      signals,
      twinEvidence: twinForAction(planned.actionRequest, book),
    }));
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.equal(result.projection.positionQuantity, '0.02');
    assert.equal(result.projection.pendingAction, null);
    assert.ok(result.reasonCodes.includes('RISK_REDUCTION_PROVED_NO_FILL'));
    const resolved = evaluateVolumeLifecycle(lifecycleInput({
      current: result.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals: {
        ...signals, reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT', recoveryRevision: `volume-${kind.toLowerCase()}-no-fill-resolved`,
      },
    }));
    assert.equal(resolved.disposition, 'BLOCKED');
    assert.ok(resolved.reasonCodes.includes('CANONICAL_RECOVERY_RESOLVED_RISK_RECHECK_REQUIRED'));
    assert.equal(resolved.projection.pendingTwinStateRevision, null);
    assert.equal(resolved.projection.recoveryEvidenceActionKey, null);
    assert.notEqual(resolved.projection.lastNoFillOwnerEvidenceRevision, null);
    assert.notEqual(resolved.projection.lastNoFillIntentKey, null);
  });
}

test('one exhaustion episode reduces from its original basis once, and a tighter policy uses the same anchor', () => {
  const policy = protectionPolicy();
  const opened = openProbe({ policy });
  const plan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    policy,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const reduced = evaluateVolumeLifecycle(lifecycleInput({
    current: plan.projection,
    policy,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
    twinEvidence: twinForAction(plan.actionRequest, { bids: [{ price: '100', quantity: '0.01' }] }),
  }));
  assert.equal(reduced.projection.positionQuantity, '0.01');

  const persistent = evaluateVolumeLifecycle(lifecycleInput({
    current: reduced.projection,
    policy,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  assert.equal(persistent.disposition, 'HOLD');
  assert.equal(persistent.actionRequest, null);

  const tightened = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: policy.policyRevision,
    effectiveFromMs: reduced.projection.lastTransition.occurredAtMs,
    exhaustionReductionTargetPpm: 400_000,
  });
  const adopted = projectVolumeProtectionRevision({
    projection: reduced.projection,
    currentPolicy: policy,
    proposedPolicy: tightened,
    evaluatedAtMs: reduced.projection.lastTransition.occurredAtMs,
  });
  assert.equal(adopted.decision.state, 'ACCEPTED');
  const further = evaluateVolumeLifecycle(lifecycleInput({
    current: adopted.projection,
    policy: tightened,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  assert.equal(further.actionRequest.requestedQuantity, '0.002');
  assert.equal(further.projection.reductionBasisQuantity, '0.02');
  assert.equal(further.projection.reductionTargetQuantity, '0.008');
});

test('ABSENT clears an exhaustion episode and a later PRESENT starts from the remaining position', () => {
  const opened = openProbe();
  const plan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const reduced = evaluateVolumeLifecycle(lifecycleInput({
    current: plan.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
    twinEvidence: twinForAction(plan.actionRequest, { bids: [{ price: '100', quantity: '0.01' }] }),
  }));
  const cleared = evaluateVolumeLifecycle(lifecycleInput({ current: reduced.projection }));
  assert.equal(cleared.projection.reductionEpisodeRevision, null);
  const next = evaluateVolumeLifecycle(lifecycleInput({
    current: cleared.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  assert.equal(next.actionRequest.requestedQuantity, '0.005');
});

test('persistent source degradation reduces once per bounded episode', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-source-episode' } });
  const plan = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-source-episode' }, current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' }, signals: { sourceState: 'STALE' },
  }));
  const reduced = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-source-episode' }, current: plan.projection,
    twinEvidence: twinForAction(plan.actionRequest, { bids: [{ price: '100', quantity: '0.01' }] }),
    signals: { sourceState: 'STALE' },
  }));
  const repeated = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-source-episode' }, current: reduced.projection,
    authority: { riskActionClass: 'REDUCE' }, signals: { sourceState: 'STALE' },
  }));
  assert.equal(repeated.disposition, 'HOLD');
  assert.deepEqual(repeated.reasonCodes, ['REDUCTION_TARGET_ALREADY_REACHED']);
  const cleared = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-source-episode' }, current: repeated.projection,
  }));
  assert.equal(cleared.projection.reductionEpisodeRevision, null);
  const next = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-source-episode' }, current: cleared.projection,
    authority: { riskActionClass: 'REDUCE' }, signals: { sourceState: 'STALE' },
  }));
  assert.equal(next.actionRequest.requestedQuantity, '0.005');
});

test('same settled twin evidence is a no-op, while orphan evidence enters recovery', () => {
  const opened = openProbe();
  const replay = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    twinEvidence: opened.twinEvidence,
  }));
  assert.equal(replay.disposition, 'NOOP_REPEAT');
  assert.equal(replay.projection.projectionRevision, opened.settled.projection.projectionRevision);

  const other = planProbe({ proposal: { proposalId: 'volume-proposal-orphan-0002' } });
  const orphan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    twinEvidence: twinForAction(other.actionRequest),
  }));
  assert.equal(orphan.disposition, 'RECOVERY_REQUIRED');
  assert.ok(orphan.reasonCodes.includes('ORPHAN_TWIN_EVIDENCE'));
  assert.equal(orphan.projection.recoveryEvidenceActionKey, null);
  assert.equal(orphan.recoveryHandoff.actionKey, null);
});

test('retained twin history makes old exact replay inert and changed replay coherently recoverable', () => {
  const proposal = { proposalId: 'volume-proposal-retained-replay' };
  const opened = openProbe({ proposal });
  const confirmPlan = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: opened.settled.projection, authority: { riskActionClass: 'ADD' },
  }));
  const confirmed = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: confirmPlan.projection, twinEvidence: twinForAction(confirmPlan.actionRequest),
  }));
  assert.equal(confirmed.projection.settledTwinHistory.length, 2);

  const oldReplay = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: confirmed.projection, twinEvidence: opened.twinEvidence,
  }));
  assert.equal(oldReplay.disposition, 'NOOP_REPEAT');
  assert.equal(oldReplay.projection.projectionRevision, confirmed.projection.projectionRevision);

  const addAllowed = evaluateVolumeLifecycle(lifecycleInput({ proposal, current: confirmed.projection }));
  const finalPlan = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: addAllowed.projection, authority: { riskActionClass: 'ADD' },
  }));
  const pendingReplay = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: finalPlan.projection, twinEvidence: opened.twinEvidence,
  }));
  assert.equal(pendingReplay.disposition, 'NOOP_REPEAT');
  assert.equal(pendingReplay.projection.pendingAction.actionKey, finalPlan.actionRequest.actionKey);

  const latestSettledKey = finalPlan.projection.lastSettledActionKey;
  const changedOld = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: finalPlan.projection,
    twinEvidence: twinForAction(opened.planned.actionRequest, { asks: [] }),
  }));
  assert.equal(changedOld.disposition, 'RECOVERY_REQUIRED');
  assert.equal(changedOld.projection.lastSettledActionKey, latestSettledKey);
  assert.equal(changedOld.projection.recoveryEvidenceActionKey, opened.planned.actionRequest.actionKey);
  assert.equal(changedOld.recoveryHandoff.actionKey, opened.planned.actionRequest.actionKey);
  assert.equal(changedOld.projection.positionQuantityTruth, 'UNKNOWN');
  assert.equal(changedOld.projection.capitalUsageTruth, 'UNKNOWN');

  const settledNewer = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: changedOld.projection, twinEvidence: twinForAction(finalPlan.actionRequest),
  }));
  assert.equal(settledNewer.disposition, 'RECOVERY_REQUIRED');
  assert.equal(settledNewer.projection.positionQuantity, '0.1');
  assert.equal(settledNewer.projection.pendingAction, null);
  assert.equal(settledNewer.projection.lastSettledActionKey, finalPlan.actionRequest.actionKey);
  assert.equal(settledNewer.projection.recoveryEvidenceActionKey, opened.planned.actionRequest.actionKey);

  const recoveryReplay = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: settledNewer.projection, twinEvidence: opened.twinEvidence,
  }));
  assert.equal(recoveryReplay.disposition, 'RECOVERY_REQUIRED');
  assert.notEqual(recoveryReplay.recoveryHandoff, null);
  assert.equal(recoveryReplay.projection.recoveryEvidenceActionKey, opened.planned.actionRequest.actionKey);
});

test('an exact historical replay cannot contaminate an unrelated pending recovery scope', () => {
  const proposal = { proposalId: 'volume-proposal-unrelated-exact-replay' };
  const opened = openProbe({ proposal });
  const pendingAdd = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  const recovery = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: pendingAdd.projection,
    signals: { globalHalt: true },
  }));
  assert.equal(recovery.disposition, 'RECOVERY_REQUIRED');
  assert.equal(recovery.projection.pendingAction.actionKey, pendingAdd.actionRequest.actionKey);
  assert.equal(recovery.projection.recoveryEvidenceActionKey, null);

  const replayed = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: recovery.projection,
    twinEvidence: opened.twinEvidence,
  }));
  assert.equal(replayed.disposition, 'RECOVERY_REQUIRED');
  assert.equal(replayed.projection.pendingAction.actionKey, pendingAdd.actionRequest.actionKey);
  assert.equal(replayed.projection.recoveryEvidenceActionKey, null);

  const resolutionInput = lifecycleInput({
    proposal,
    current: replayed.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT',
      recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT',
      recoveryRevision: 'volume-unrelated-exact-replay-resolved',
    },
  });
  resolutionInput.occupancy.activeRecords = resolutionInput.occupancy.activeRecords
    .filter((record) => record.kind === 'POSITION');
  const resolved = evaluateVolumeLifecycle(resolutionInput);
  assert.equal(resolved.disposition, 'SETTLED');
  assert.equal(resolved.projection.pendingAction, null);
  assert.equal(resolved.projection.recoveryEvidenceActionKey, null);
});

test('canonical NO_EFFECT recovery closes a pending ticket only after occupancy proves it absent', () => {
  const proposal = { proposalId: 'volume-proposal-ticket-closure' };
  const planned = planProbe({ proposal });
  const recovery = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: planned.projection, signals: { globalHalt: true },
  }));
  assert.equal(recovery.disposition, 'RECOVERY_REQUIRED');
  assert.notEqual(recovery.projection.pendingAction, null);
  const resolution = {
    globalHalt: true, reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
    recoveryOutcome: 'NO_EFFECT', recoveryRevision: 'volume-ticket-closure-revision',
  };
  const stillOpen = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: recovery.projection, authority: { riskActionClass: 'RECOVERY' }, signals: resolution,
  }));
  assert.equal(stillOpen.disposition, 'RECOVERY_REQUIRED');
  assert.notEqual(stillOpen.projection.pendingAction, null);
  assert.ok(stillOpen.reasonCodes.includes('CANONICAL_OCCUPANCY_BINDING_MISMATCH'));

  const closed = evaluateVolumeLifecycle(lifecycleInput({
    proposal, current: recovery.projection, authority: { riskActionClass: 'RECOVERY' }, signals: resolution,
    occupancy: { activeRecords: [] },
  }));
  assert.equal(closed.disposition, 'TERMINAL');
  assert.equal(closed.projection.state, 'EXIT');
  assert.equal(closed.projection.positionQuantity, '0');
  assert.equal(closed.projection.pendingAction, null);
  assert.equal(closed.projection.lastNoFillIntentKey, planned.actionRequest.intentKey);
  assert.ok(closed.reasonCodes.includes('ENTRY_CANONICAL_NO_EFFECT'));
});

test('unchanged HOLD, terminal and unresolved recovery projections reach a fixpoint without revision churn', () => {
  const opened = openProbe();
  const hold1 = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    signals: { confirmation: 'PENDING' },
  }));
  const hold2 = evaluateVolumeLifecycle(lifecycleInput({
    current: hold1.projection,
    signals: { confirmation: 'PENDING' },
  }));
  assert.equal(hold2.projection.projectionRevision, hold1.projection.projectionRevision);

  const noFillPlan = planProbe({ proposal: { proposalId: 'volume-proposal-terminal-fixpoint' } });
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-fixpoint' },
    current: noFillPlan.projection,
    twinEvidence: twinForAction(noFillPlan.actionRequest, { asks: [] }),
  }));
  const terminalReplay = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-fixpoint' },
    current: terminal.projection,
  }));
  assert.equal(terminalReplay.projection.projectionRevision, terminal.projection.projectionRevision);
  assert.equal(terminalReplay.feedbackHandoff, null);

  const timeoutPlan = planProbe({ proposal: { proposalId: 'volume-proposal-recovery-fixpoint' } });
  const recovery1 = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-fixpoint' },
    current: timeoutPlan.projection,
    twinEvidence: twinForAction(timeoutPlan.actionRequest, {
      includePrivate: false, httpOutcome: 'TIMEOUT', reconcile: false,
    }),
  }));
  const recovery2 = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-fixpoint' },
    current: recovery1.projection,
  }));
  const recovery3 = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-fixpoint' },
    current: recovery2.projection,
  }));
  assert.equal(recovery3.projection.projectionRevision, recovery2.projection.projectionRevision);
});

test('a simultaneous halt after an observed ENTRY fill exposes the synthetic position and requires a new risk recheck', () => {
  const planned = planProbe();
  const result = evaluateVolumeLifecycle(lifecycleInput({
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest),
    signals: { globalHalt: true },
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0.02');
  assert.equal(result.actionRequest, null);
  assert.ok(result.reasonCodes.includes('POST_SETTLEMENT_RISK_RECHECK_REQUIRED'));
  assert.ok(result.reasonCodes.includes('GLOBAL_HALT'));
});

test('active stale market/signal/occupancy truth never advances the favorable extreme or hides the one-position invariant', () => {
  const opened = openProbe();
  for (const overrides of [
    { signals: { validUntilMs: NOW } },
    { occupancy: { truth: 'UNKNOWN' } },
  ]) {
    const result = evaluateVolumeLifecycle(lifecycleInput({ current: opened.settled.projection, ...overrides }));
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.equal(result.projection.favorableExtremePrice, opened.settled.projection.favorableExtremePrice);
  }
});

test('terminal reconciliation mismatch reopens recovery, and stale owner truth cannot resolve recovery', () => {
  const plan = planProbe({ proposal: { proposalId: 'volume-proposal-terminal-reconcile' } });
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-reconcile' },
    current: plan.projection,
    twinEvidence: twinForAction(plan.actionRequest, { asks: [] }),
  }));
  const mismatch = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-reconcile' },
    current: terminal.projection,
    signals: { reconciliationState: 'MISMATCH' },
  }));
  assert.equal(mismatch.disposition, 'RECOVERY_REQUIRED');

  const staleResolve = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-terminal-reconcile' },
    current: mismatch.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT',
      recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT',
      recoveryRevision: 'volume-stale-recovery-revision',
      validUntilMs: NOW,
    },
  }));
  assert.equal(staleResolve.disposition, 'RECOVERY_REQUIRED');
  assert.notEqual(staleResolve.primaryReasonCode, 'CANONICAL_RECOVERY_RESOLVED');
});

test('an ambiguous pending action defers every protection revision atomically', () => {
  const policy = protectionPolicy();
  const planned = planProbe({ policy });
  const recovery = evaluateVolumeLifecycle(lifecycleInput({
    policy,
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, {
      includePrivate: false, httpOutcome: 'TIMEOUT', reconcile: false,
    }),
  }));
  const wider = protectionPolicy({
    revisionSequence: 2,
    priorPolicyRevision: policy.policyRevision,
    effectiveFromMs: recovery.projection.lastTransition.occurredAtMs,
    maximumLossBps: policy.maximumLossBps + 1,
  });
  assert.throws(() => projectVolumeProtectionRevision({
    projection: recovery.projection,
    currentPolicy: policy,
    proposedPolicy: wider,
    evaluatedAtMs: recovery.projection.lastTransition.occurredAtMs,
  }), /cannot supersede a pending action/u);
});

test('L07 proof is intrinsically bound to the action lineage and cannot be relabeled from another Volume action', () => {
  const target = planProbe();
  const foreign = planProbe({ proposal: { proposalId: 'volume-proposal-lineage-foreign' } });
  const foreignTwin = twinForAction(foreign.actionRequest);
  const relabeled = {
    ...foreignTwin,
    actionKey: target.actionRequest.actionKey,
    fixtureId: deriveVolumeTwinFixtureId(target.actionRequest.actionKey),
  };
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    current: target.projection,
    twinEvidence: relabeled,
  })), /fixture binding/u);
});

test('an action-scoped L07 proof rejects even an inert sibling fixture', () => {
  const target = planProbe();
  const sibling = planProbe({ proposal: { proposalId: 'volume-proposal-sibling' } });
  const targetTwin = twinForAction(target.actionRequest);
  const siblingTwin = twinForAction(sibling.actionRequest);
  const events = targetTwin.twinState.processedEvents.map((item) => item.event);
  const multi = runExchangeTwinScenario(scenarioInput({
    fixture: targetTwin.twinState.orders[0].fixture,
    events,
    overrides: {
      scenarioId: 'scenario-l11-multi-order-hostile',
      seed: 'seed-l11-multi-order-hostile',
      fixtures: [targetTwin.twinState.orders[0].fixture, siblingTwin.twinState.orders[0].fixture],
    },
  }));
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    current: target.projection,
    twinEvidence: { ...targetTwin, twinState: multi },
  })), /exactly one L11 action/u);
});

test('future twin effects and unknown fee conversion fail to recovery', () => {
  const futurePlan = planProbe({ proposal: { proposalId: 'volume-proposal-future-twin' } });
  const future = evaluateVolumeLifecycle(lifecycleInput({
    evaluatedAtMs: futurePlan.actionRequest.plannedAtMs + 5,
    proposal: { proposalId: 'volume-proposal-future-twin' },
    current: futurePlan.projection,
    twinEvidence: twinForAction(futurePlan.actionRequest),
  }));
  assert.equal(future.disposition, 'RECOVERY_REQUIRED');
  assert.ok(future.reasonCodes.includes('TWIN_CHRONOLOGY_INVALID'));

  const feePlan = planProbe({ proposal: { proposalId: 'volume-proposal-fee-unknown' } });
  const unknownFee = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-fee-unknown' },
    current: feePlan.projection,
    twinEvidence: twinForAction(feePlan.actionRequest, {
      fee: feeEvidence({ feeAsset: 'BNB', quoteConversionRate: null }),
    }),
  }));
  assert.equal(unknownFee.disposition, 'RECOVERY_REQUIRED');
  assert.ok(unknownFee.reasonCodes.includes('TWIN_FEE_CONVERSION_UNKNOWN'));
  assert.equal(unknownFee.projection.positionQuantity, '0.02');
  assert.equal(unknownFee.projection.positionQuantityTruth, 'EXACT');
  assert.equal(unknownFee.projection.capitalUsageTruth, 'UNKNOWN');
  assert.notEqual(unknownFee.projection.favorableExtremePrice, null);
});

test('known-converted base fee records exposure but requires exact position reconstruction', () => {
  const plan = planProbe({ proposal: { proposalId: 'volume-proposal-base-fee' } });
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-base-fee' },
    current: plan.projection,
    twinEvidence: twinForAction(plan.actionRequest, {
      fee: feeEvidence({
        chargeBasis: 'BASE_QUANTITY',
        feeAsset: plan.actionRequest.baseAsset,
        takerRate: '0.001',
        quoteConversionRate: '100',
        quoteConversionBaseAsset: plan.actionRequest.baseAsset,
        quoteConversionQuoteAsset: plan.actionRequest.quoteAsset,
        quoteConversionUnit: 'QUOTE_ASSET_PER_FEE_ASSET',
      }),
    }),
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.ok(result.reasonCodes.includes('TWIN_POSITION_QUANTITY_FEE_AMBIGUOUS'));
  assert.equal(result.projection.positionQuantity, '0.02');
  assert.equal(result.projection.positionQuantityTruth, 'UNKNOWN');
  assert.equal(result.projection.capitalUsageTruth, 'EXACT');
  assert.equal(result.projection.pendingAction, null);
  assert.equal(result.projection.lastSettledActionKey, plan.actionRequest.actionKey);
  assert.equal(result.recoveryHandoff.actionKey, plan.actionRequest.actionKey);
  assert.equal(result.recoveryHandoff.kind, 'POSITION_RECONSTRUCTION');
  assert.notEqual(result.projection.favorableExtremePrice, null);

  const unresolved = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-base-fee' },
    current: result.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT', recoveryRevision: 'volume-base-fee-recovery',
    },
  }));
  assert.equal(unresolved.disposition, 'RECOVERY_REQUIRED');
  assert.equal(unresolved.projection.positionQuantityTruth, 'UNKNOWN');
});

test('observed price/notional breach records synthetic exposure before recovery', () => {
  const planned = planProbe({ proposal: { proposalId: 'volume-proposal-bound-breach' } });
  const result = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-bound-breach' },
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, {
      asks: [{ price: '106', quantity: '0.02' }],
    }),
  }));
  assert.equal(result.disposition, 'RECOVERY_REQUIRED');
  assert.equal(result.projection.positionQuantity, '0.02');
  assert.notEqual(result.projection.favorableExtremePrice, null);
  assert.ok(result.reasonCodes.includes('TWIN_PRICE_BOUND_EXCEEDED'));
});

test('terminal exposure, terminal pending ENTRY and visible-action tampering fail closed validation', () => {
  const planned = planProbe({ proposal: { proposalId: 'volume-proposal-corruption' } });
  const terminal = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' },
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, { asks: [] }),
  }));

  const exposedExit = structuredClone(terminal.projection);
  exposedExit.positionQuantity = '0.01';
  exposedExit.feedbackOutcomeRevision = null;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: exposedExit,
  })), /exposure before|terminal EXIT/u);

  const reopenedExit = structuredClone(terminal.projection);
  reopenedExit.feedbackOutcomeRevision = null;
  reopenedExit.pendingAction = structuredClone(planned.actionRequest);
  reopenedExit.pendingActionBaseProjectionRevision = planned.actionRequest.projectionRevision;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: reopenedExit,
  })), /pending action cannot already be settled|pending ENTRY|terminal EXIT/u);

  const tamperedPending = structuredClone(planned.projection);
  tamperedPending.pendingAction.priceBound = '102';
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: tamperedPending,
  })), /(?:intent|action) key does not match visible semantics/u);

  const missingReasons = structuredClone(terminal.projection);
  missingReasons.terminalOutcomeReasonCodes = null;
  missingReasons.feedbackOutcomeRevision = null;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: missingReasons,
  })), /terminal EXIT must retain/u);

  const forgedFeedback = structuredClone(terminal.projection);
  forgedFeedback.feedbackOutcomeRevision = `l11feedback_${'f'.repeat(64)}`;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: forgedFeedback,
  })), /feedback revision does not match/u);

  const forgedReasons = structuredClone(terminal.projection);
  forgedReasons.terminalOutcomeReasonCodes = ['FORGED_TERMINAL_REASON'];
  forgedReasons.feedbackOutcomeRevision = null;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: forgedReasons,
  })), /must match the terminal transition/u);
});

test('pending REDUCE action cannot diverge from its retained reduction episode', () => {
  const opened = openProbe({ proposal: { proposalId: 'volume-proposal-reduction-lineage' } });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-reduction-lineage' }, current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' }, signals: { exhaustion: 'PRESENT' },
  }));
  const tampered = structuredClone(planned.projection);
  tampered.reductionEpisodeRevision = `l11reduction_${'f'.repeat(64)}`;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-reduction-lineage' }, current: tampered,
    authority: { riskActionClass: 'REDUCE' }, signals: { exhaustion: 'PRESENT' },
  })), /not bound to its reduction episode/u);
});

test('recovery tuples reject partial, foreign and transition-mismatched correlation', () => {
  const planned = planProbe({ proposal: { proposalId: 'volume-proposal-recovery-tuple' } });
  const recovered = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-tuple' }, current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, {
      includePrivate: false, httpOutcome: 'TIMEOUT', reconcile: false,
    }),
  }));
  const partial = structuredClone(recovered.projection);
  partial.recoveryEvidenceFixtureId = null;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-tuple' }, current: partial,
  })), /correlation must be wholly present/u);

  const foreign = structuredClone(recovered.projection);
  foreign.recoveryEvidenceActionKey = `l11action_${'e'.repeat(64)}`;
  foreign.recoveryEvidenceFixtureId = `l11fixture_${'e'.repeat(64)}`;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-tuple' }, current: foreign,
  })), /action is not retained|pending twin revisions must match/u);

  const mismatched = structuredClone(recovered.projection);
  mismatched.lastTransition.twinOutcomeRevision = `l11twin_${'d'.repeat(64)}`;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-tuple' }, current: mismatched,
  })), /outcome must bind/u);
});
