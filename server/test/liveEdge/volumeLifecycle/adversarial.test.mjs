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
  deriveVolumeRecoveryConsumptionRevision,
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
  assert.throws(
    () => validateLifecycleProjection(zeroConfirm),
    /entry average and exact cost basis must be present together/u,
  );
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
  const evaluatedAtMs = opened.settled.projection.lastTransition.occurredAtMs + 1;
  for (const scenario of [
    { sizing: { state: 'UNAVAILABLE' } },
    { sizing: { observedAtMs: evaluatedAtMs + 1 } },
    { sizing: { observedAtMs: evaluatedAtMs - 6_000, validUntilMs: evaluatedAtMs + 100 } },
    { sizing: { observedAtMs: evaluatedAtMs }, authority: { riskEvaluatedAtMs: evaluatedAtMs - 1 } },
    { sizing: { validUntilMs: evaluatedAtMs } },
  ]) {
    const result = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: 'volume-proposal-risk-recheck-sizing' },
      evaluatedAtMs,
      current: opened.settled.projection,
      authority: { riskActionClass: 'EXIT', ...(scenario.authority ?? {}) },
      signals: { globalHalt: true },
      sizing: scenario.sizing,
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
      projectionRevision: planned.projection.projectionRevision,
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

    const recheckAtMs = resolved.projection.lastTransition.occurredAtMs + 20;
    const rechecked = evaluateVolumeLifecycle(lifecycleInput({
      proposal: { proposalId: `volume-proposal-recovery-${name.replace(' ', '-')}` },
      evaluatedAtMs: recheckAtMs,
      current: resolved.projection,
      authority: {
        riskActionClass: expectedKind,
        riskEvaluatedAtMs: recheckAtMs,
        riskExpiresAtMs: recheckAtMs + 5_000,
      },
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
  test(`${kind} no-fill requires one canonical recovery revision and a fresh Risk-bound retry`, () => {
    const proposal = { proposalId: `volume-proposal-${kind.toLowerCase()}-retry-lineage` };
    const opened = openProbe({ proposal });
    const planned = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      current: opened.settled.projection,
      authority: { riskActionClass: kind },
      signals,
    }));
    const result = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      current: planned.projection,
      authority: { riskActionClass: kind },
      signals,
      twinEvidence: twinForAction(planned.actionRequest, book),
    }));
    assert.equal(result.disposition, 'RECOVERY_REQUIRED');
    assert.equal(result.projection.positionQuantity, '0.02');
    assert.equal(result.projection.pendingAction, null);
    assert.ok(result.reasonCodes.includes('RISK_REDUCTION_PROVED_NO_FILL'));
    assert.equal(result.projection.lastNoFill.action.actionKey, planned.actionRequest.actionKey);
    assert.equal(result.projection.lastNoFill.action.kind, kind);
    assert.equal(result.projection.lastNoFill.action.ownerEvidenceRevision, planned.actionRequest.ownerEvidenceRevision);
    assert.equal(result.projection.lastNoFill.action.intentKey, planned.actionRequest.intentKey);
    assert.equal(result.projection.lastNoFill.evidenceKind, 'TWIN_NO_FILL');
    assert.equal(result.projection.lastNoFill.recoveryResolutionRevision, null);

    const unresolvedOnce = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: result.projection.lastTransition.occurredAtMs,
      current: result.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals,
    }));
    const unresolvedTwice = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: unresolvedOnce.projection.lastTransition.occurredAtMs,
      current: unresolvedOnce.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals,
    }));
    assert.equal(unresolvedOnce.disposition, 'RECOVERY_REQUIRED');
    assert.ok(unresolvedOnce.reasonCodes.includes('CANONICAL_RECOVERY_NOT_RESOLVED'));
    assert.equal(unresolvedTwice.projection.projectionRevision, unresolvedOnce.projection.projectionRevision);
    assert.equal(unresolvedTwice.projection.lastNoFill.action.actionKey, planned.actionRequest.actionKey);

    const resolutionRevision = `volume-${kind.toLowerCase()}-no-fill-resolved`;
    const resolutionAtMs = unresolvedTwice.projection.lastTransition.occurredAtMs + 20;
    const resolved = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: resolutionAtMs,
      current: unresolvedTwice.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals: {
        ...signals, reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT', recoveryRevision: resolutionRevision,
      },
    }));
    assert.equal(resolved.disposition, 'BLOCKED');
    assert.ok(resolved.reasonCodes.includes('CANONICAL_RECOVERY_RESOLVED_RISK_RECHECK_REQUIRED'));
    assert.equal(resolved.projection.pendingTwinStateRevision, null);
    assert.equal(resolved.projection.recoveryEvidenceActionKey, null);
    assert.equal(resolved.projection.lastRecoveryResolutionRevision, resolutionRevision);
    assert.equal(resolved.projection.lastNoFill.action.actionKey, planned.actionRequest.actionKey);
    assert.equal(resolved.projection.lastNoFill.action.kind, kind);
    assert.equal(resolved.projection.lastNoFill.action.ownerEvidenceRevision, planned.actionRequest.ownerEvidenceRevision);
    assert.equal(resolved.projection.lastNoFill.action.intentKey, planned.actionRequest.intentKey);
    assert.equal(resolved.projection.lastNoFill.recoveryResolutionRevision, resolutionRevision);

    const retryAtMs = resolutionAtMs + 20;
    const evidenceObservedAtMs = resolutionAtMs + 1;
    const evidenceValidUntilMs = evidenceObservedAtMs + 5_000;
    const staleRisk = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: retryAtMs,
      current: resolved.projection,
      authority: {
        riskActionClass: kind,
        riskEvaluatedAtMs: resolutionAtMs - 1,
        riskExpiresAtMs: retryAtMs + 5_000,
      },
      sizing: { observedAtMs: evidenceObservedAtMs, validUntilMs: evidenceValidUntilMs },
      market: { observedAtMs: evidenceObservedAtMs, validUntilMs: evidenceValidUntilMs },
      signals: {
        ...signals,
        observedAtMs: evidenceObservedAtMs,
        validUntilMs: evidenceValidUntilMs,
      },
    }));
    assert.equal(staleRisk.disposition, 'RECOVERY_REQUIRED');
    assert.ok(staleRisk.reasonCodes.includes('RISK_REDUCTION_OWNER_RECHECK_REQUIRED'));
    assert.equal(staleRisk.actionRequest, null);

    const staleRecoveryResolutionRevision = `volume-${kind.toLowerCase()}-stale-risk-recovery-r2`;
    const staleRecoveryResolutionAtMs = staleRisk.projection.lastTransition.occurredAtMs + 20;
    const resolvedStaleRecovery = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: staleRecoveryResolutionAtMs,
      current: staleRisk.projection,
      authority: { riskActionClass: 'RECOVERY' },
      sizing: {
        observedAtMs: staleRisk.projection.lastTransition.occurredAtMs + 5,
        validUntilMs: staleRecoveryResolutionAtMs + 5_000,
      },
      market: {
        observedAtMs: staleRisk.projection.lastTransition.occurredAtMs + 5,
        validUntilMs: staleRecoveryResolutionAtMs + 5_000,
      },
      signals: {
        ...signals,
        observedAtMs: staleRisk.projection.lastTransition.occurredAtMs + 5,
        validUntilMs: staleRecoveryResolutionAtMs + 5_000,
        reconciliationState: 'EXACT',
        recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT',
        recoveryRevision: staleRecoveryResolutionRevision,
      },
    }));
    assert.equal(resolvedStaleRecovery.disposition, 'BLOCKED');
    assert.deepEqual(resolvedStaleRecovery.projection.consumedRecoveryRevisions, [
      resolutionRevision,
      staleRecoveryResolutionRevision,
    ]);
    assert.equal(
      resolvedStaleRecovery.projection.lastNoFill.recoveryResolutionRevision,
      resolutionRevision,
    );
    assert.equal(resolvedStaleRecovery.projection.recoveryConsumptionHistory[1].noFill, null);

    const crossedKind = kind === 'REDUCE' ? 'EXIT' : 'REDUCE';
    const crossedSignals = crossedKind === 'EXIT'
      ? { ...signals, exhaustion: 'ABSENT', reversal: 'PRESENT' }
      : { ...signals, reversal: 'ABSENT', exhaustion: 'PRESENT' };
    const crossedStaleRisk = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: retryAtMs,
      current: resolved.projection,
      authority: {
        riskActionClass: crossedKind,
        riskEvaluatedAtMs: resolutionAtMs - 1,
        riskExpiresAtMs: retryAtMs + 5_000,
      },
      sizing: { observedAtMs: evidenceObservedAtMs, validUntilMs: retryAtMs + 5_000 },
      market: { observedAtMs: evidenceObservedAtMs, validUntilMs: retryAtMs + 5_000 },
      signals: {
        ...crossedSignals,
        observedAtMs: evidenceObservedAtMs,
        validUntilMs: retryAtMs + 5_000,
      },
    }));
    assert.equal(crossedStaleRisk.disposition, 'RECOVERY_REQUIRED');
    assert.ok(crossedStaleRisk.reasonCodes.includes('RISK_REDUCTION_OWNER_RECHECK_REQUIRED'));
    assert.equal(crossedStaleRisk.actionRequest, null);

    const retryInput = {
      proposal,
      evaluatedAtMs: retryAtMs,
      current: resolved.projection,
      authority: {
        riskActionClass: kind,
        riskEvaluatedAtMs: resolutionAtMs + 10,
        riskExpiresAtMs: retryAtMs + 5_000,
      },
      sizing: { observedAtMs: resolutionAtMs + 5, validUntilMs: retryAtMs + 5_000 },
      market: { observedAtMs: resolutionAtMs + 5, validUntilMs: retryAtMs + 5_000 },
      signals: {
        ...signals,
        observedAtMs: resolutionAtMs + 5,
        validUntilMs: retryAtMs + 5_000,
      },
      occupancy: { observedAtMs: retryAtMs, priorActions: [priorRecord(planned)] },
    };
    const boundRetryInput = lifecycleInput(retryInput);
    const retry = evaluateVolumeLifecycle(boundRetryInput);
    const deterministicRetry = evaluateVolumeLifecycle(lifecycleInput(retryInput));
    assert.equal(retry.disposition, 'PLANNED');
    assert.equal(retry.actionRequest.kind, kind);
    assert.equal(retry.projection.positionQuantity, '0.02');
    assert.equal(retry.actionRequest.requestedQuantity, kind === 'REDUCE' ? '0.01' : '0.02');
    assert.equal(retry.actionRequest.riskContextRevision, boundRetryInput.authority.riskContextRevision);
    assert.match(retry.actionRequest.recoveryRetryRevision, /^l11retry_[a-f0-9]{64}$/u);
    assert.notEqual(retry.actionRequest.intentKey, planned.actionRequest.intentKey);
    assert.notEqual(retry.actionRequest.actionKey, planned.actionRequest.actionKey);
    assert.deepEqual(deterministicRetry.actionRequest, retry.actionRequest);
    assertHardLabels(retry.actionRequest);

    const duplicate = evaluateVolumeLifecycle(lifecycleInput({
      ...retryInput,
      occupancy: {
        observedAtMs: retryAtMs,
        priorActions: [priorRecord(planned), priorRecord(retry)],
      },
    }));
    assert.equal(duplicate.disposition, 'NOOP_REPEAT');
    assert.ok(duplicate.reasonCodes.includes('ACTION_ALREADY_RECORDED'));
    assert.equal(duplicate.actionRequest, null);

    const refreshedRetryInput = {
      ...retryInput,
      evaluatedAtMs: retryAtMs + 1,
      authority: {
        riskActionClass: kind,
        riskEvaluatedAtMs: resolutionAtMs + 11,
        riskExpiresAtMs: retryAtMs + 5_001,
      },
      sizing: { observedAtMs: resolutionAtMs + 6, validUntilMs: retryAtMs + 5_001 },
      market: { observedAtMs: resolutionAtMs + 6, validUntilMs: retryAtMs + 5_001 },
      signals: {
        ...signals,
        observedAtMs: resolutionAtMs + 6,
        validUntilMs: retryAtMs + 5_001,
      },
      occupancy: { observedAtMs: retryAtMs + 1, priorActions: [priorRecord(planned)] },
    };
    const refreshedRetry = evaluateVolumeLifecycle(lifecycleInput(refreshedRetryInput));
    assert.equal(refreshedRetry.disposition, 'PLANNED');
    assert.equal(refreshedRetry.actionRequest.intentKey, retry.actionRequest.intentKey);
    assert.notEqual(refreshedRetry.actionRequest.actionKey, retry.actionRequest.actionKey);

    const intentDuplicate = evaluateVolumeLifecycle(lifecycleInput({
      ...refreshedRetryInput,
      occupancy: {
        observedAtMs: retryAtMs + 1,
        priorActions: [priorRecord(planned), priorRecord(retry)],
      },
    }));
    assert.equal(intentDuplicate.disposition, 'NOOP_REPEAT');
    assert.ok(intentDuplicate.reasonCodes.includes('ACTION_ALREADY_RECORDED'));
    assert.equal(intentDuplicate.actionRequest, null);

    const secondNoFill = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      current: retry.projection,
      authority: { riskActionClass: kind },
      signals,
      twinEvidence: twinForAction(retry.actionRequest, book),
    }));
    assert.equal(secondNoFill.disposition, 'RECOVERY_REQUIRED');
    assert.equal(secondNoFill.projection.lastNoFill.action.actionKey, retry.actionRequest.actionKey);
    assert.equal(secondNoFill.projection.lastNoFill.action.kind, kind);
    assert.equal(secondNoFill.projection.lastNoFill.action.intentKey, retry.actionRequest.intentKey);
    assert.equal(secondNoFill.projection.lastRecoveryResolutionRevision, resolutionRevision);

    const reusedResolution = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: secondNoFill.projection.lastTransition.occurredAtMs + 20,
      current: secondNoFill.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals: {
        ...signals,
        reconciliationState: 'EXACT',
        recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT',
        recoveryRevision: resolutionRevision,
      },
    }));
    assert.equal(reusedResolution.disposition, 'RECOVERY_REQUIRED');
    assert.ok(reusedResolution.reasonCodes.includes('CANONICAL_RECOVERY_NOT_RESOLVED'));
    assert.equal(reusedResolution.actionRequest, null);
    assert.equal(reusedResolution.projection.lastRecoveryResolutionRevision, resolutionRevision);

    const secondResolutionRevision = `volume-${kind.toLowerCase()}-no-fill-resolved-second`;
    const secondResolutionAtMs = secondNoFill.projection.lastTransition.occurredAtMs + 40;
    const resolvedSecond = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: secondResolutionAtMs,
      current: secondNoFill.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals: {
        ...signals,
        reconciliationState: 'EXACT',
        recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT',
        recoveryRevision: secondResolutionRevision,
      },
    }));
    assert.equal(resolvedSecond.disposition, 'BLOCKED');
    assert.deepEqual(resolvedSecond.projection.consumedRecoveryRevisions, [
      resolutionRevision,
      secondResolutionRevision,
    ]);
    assert.equal(
      resolvedSecond.projection.lastNoFill.recoveryResolutionRevision,
      secondResolutionRevision,
    );

    const { projectionRevision: _resolvedSecondRevision, ...resolvedSecondMaterial } = resolvedSecond.projection;
    const forgedEarlierRevision = `volume-${kind.toLowerCase()}-forged-consumed-r1`;
    const substitutedConsumedOnly = finalizeProjection({
      ...resolvedSecondMaterial,
      consumedRecoveryRevisions: [forgedEarlierRevision, secondResolutionRevision],
    });
    assert.throws(
      () => validateLifecycleProjection(substitutedConsumedOnly),
      /consumption record does not match consumed revision order/u,
    );
    const substitutedProof = finalizeProjection({
      ...resolvedSecondMaterial,
      consumedRecoveryRevisions: [forgedEarlierRevision, secondResolutionRevision],
      recoveryConsumptionHistory: resolvedSecond.projection.recoveryConsumptionHistory.map((record, index) => (
        index === 0 ? { ...record, recoveryResolutionRevision: forgedEarlierRevision } : record
      )),
    });
    assert.throws(
      () => validateLifecycleProjection(substitutedProof),
      /no-fill does not match its resolution revision/u,
    );
    const firstConsumption = resolvedSecond.projection.recoveryConsumptionHistory[0];
    const forgedFirstNoFill = {
      ...firstConsumption.noFill,
      recoveryResolutionRevision: forgedEarlierRevision,
    };
    const forgedFirstConsumption = {
      ...firstConsumption,
      recoveryResolutionRevision: forgedEarlierRevision,
      noFill: forgedFirstNoFill,
      consumptionRevision: deriveVolumeRecoveryConsumptionRevision({
        lifecycleId: resolvedSecond.projection.lifecycleId,
        recoveryResolutionRevision: forgedEarlierRevision,
        baseProjectionRevision: firstConsumption.baseProjectionRevision,
        noFill: forgedFirstNoFill,
        priorConsumptionRevision: null,
        outcomeSequence: firstConsumption.outcomeSequence,
      }),
    };
    const rehashedPrefixOnly = finalizeProjection({
      ...resolvedSecondMaterial,
      consumedRecoveryRevisions: [forgedEarlierRevision, secondResolutionRevision],
      recoveryConsumptionHistory: [
        forgedFirstConsumption,
        resolvedSecond.projection.recoveryConsumptionHistory[1],
      ],
    });
    assert.throws(
      () => validateLifecycleProjection(rehashedPrefixOnly),
      /Recovery consumption history is not a closed chain/u,
    );
    const truncatedPrefix = finalizeProjection({
      ...resolvedSecondMaterial,
      consumedRecoveryRevisions: [secondResolutionRevision],
      recoveryConsumptionHistory: [resolvedSecond.projection.recoveryConsumptionHistory[1]],
    });
    assert.throws(
      () => validateLifecycleProjection(truncatedPrefix),
      /Recovery consumption history is not a closed chain/u,
    );

    const thirdRetryAtMs = secondResolutionAtMs + 20;
    const thirdRetry = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: thirdRetryAtMs,
      current: resolvedSecond.projection,
      authority: {
        riskActionClass: kind,
        riskEvaluatedAtMs: secondResolutionAtMs + 10,
        riskExpiresAtMs: thirdRetryAtMs + 5_000,
      },
      sizing: { observedAtMs: secondResolutionAtMs + 5, validUntilMs: thirdRetryAtMs + 5_000 },
      market: { observedAtMs: secondResolutionAtMs + 5, validUntilMs: thirdRetryAtMs + 5_000 },
      signals: {
        ...signals,
        observedAtMs: secondResolutionAtMs + 5,
        validUntilMs: thirdRetryAtMs + 5_000,
      },
      occupancy: { priorActions: [priorRecord(planned), priorRecord(retry)] },
    }));
    assert.equal(thirdRetry.disposition, 'PLANNED');
    assert.notEqual(thirdRetry.actionRequest.intentKey, retry.actionRequest.intentKey);

    const thirdNoFill = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      current: thirdRetry.projection,
      authority: { riskActionClass: kind },
      signals,
      twinEvidence: twinForAction(thirdRetry.actionRequest, book),
    }));
    assert.equal(thirdNoFill.disposition, 'RECOVERY_REQUIRED');
    assert.deepEqual(thirdNoFill.projection.consumedRecoveryRevisions, [
      resolutionRevision,
      secondResolutionRevision,
    ]);

    const reusedFirstAfterSecond = evaluateVolumeLifecycle(lifecycleInput({
      proposal,
      evaluatedAtMs: thirdNoFill.projection.lastTransition.occurredAtMs + 20,
      current: thirdNoFill.projection,
      authority: { riskActionClass: 'RECOVERY' },
      signals: {
        ...signals,
        reconciliationState: 'EXACT',
        recoveryDisposition: 'RESOLVED',
        recoveryOutcome: 'NO_EFFECT',
        recoveryRevision: resolutionRevision,
      },
    }));
    assert.equal(reusedFirstAfterSecond.disposition, 'RECOVERY_REQUIRED');
    assert.ok(reusedFirstAfterSecond.reasonCodes.includes('CANONICAL_RECOVERY_NOT_RESOLVED'));
    assert.deepEqual(reusedFirstAfterSecond.projection.consumedRecoveryRevisions, [
      resolutionRevision,
      secondResolutionRevision,
    ]);
    assert.equal(
      reusedFirstAfterSecond.projection.lastRecoveryResolutionRevision,
      secondResolutionRevision,
    );
  });
}

test('rehashed projections cannot forge no-fill action, evidence, or consumed recovery lineage', () => {
  const proposal = { proposalId: 'volume-proposal-forged-no-fill-lineage' };
  const opened = openProbe({ proposal });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const noFill = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: planned.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
    twinEvidence: twinForAction(planned.actionRequest, { bids: [] }),
  }));
  assert.equal(noFill.disposition, 'RECOVERY_REQUIRED');

  const foreignProposal = { proposalId: 'volume-proposal-foreign-no-fill-lineage' };
  const foreignOpened = openProbe({ proposal: foreignProposal });
  const foreignPlanned = evaluateVolumeLifecycle(lifecycleInput({
    proposal: foreignProposal,
    current: foreignOpened.settled.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
  }));
  const foreignNoFill = evaluateVolumeLifecycle(lifecycleInput({
    proposal: foreignProposal,
    current: foreignPlanned.projection,
    authority: { riskActionClass: 'REDUCE' },
    signals: { exhaustion: 'PRESENT' },
    twinEvidence: twinForAction(foreignPlanned.actionRequest, { bids: [] }),
  }));
  assert.equal(foreignNoFill.disposition, 'RECOVERY_REQUIRED');

  const supersedingConflict = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: noFill.projection,
    twinEvidence: twinForAction(foreignPlanned.actionRequest),
  }));
  assert.equal(supersedingConflict.disposition, 'RECOVERY_REQUIRED');
  assert.equal(supersedingConflict.projection.lastNoFill.action.actionKey,
    planned.actionRequest.actionKey);
  assert.equal(supersedingConflict.projection.unresolvedTwinConflict.kind,
    'ORPHAN_TWIN_EVIDENCE');
  assert.equal(supersedingConflict.projection.recoveryEvidenceActionKey,
    foreignPlanned.actionRequest.actionKey);

  const rehash = (projection, overrides) => {
    const { projectionRevision: _projectionRevision, ...material } = projection;
    return finalizeProjection({ ...material, ...overrides });
  };
  const forgedAction = {
    ...noFill.projection.lastNoFill.action,
    ownerEvidenceRevision: `l11owner_${'e'.repeat(64)}`,
  };
  forgedAction.actionKey = deriveVolumeActionKey(forgedAction);
  const forgedActionLineage = rehash(noFill.projection, {
    lastNoFill: {
      ...noFill.projection.lastNoFill,
      action: forgedAction,
    },
  });
  assert.throws(
    () => validateLifecycleProjection(forgedActionLineage),
    /fixture is not intrinsic|lineage is not retained/u,
  );

  const foreignSettled = foreignNoFill.projection.settledTwinHistory.at(-1);
  const foreignActionLineage = rehash(noFill.projection, {
    lastNoFill: foreignNoFill.projection.lastNoFill,
    lastSettledActionKey: foreignNoFill.projection.lastSettledActionKey,
    lastTwinStateRevision: foreignNoFill.projection.lastTwinStateRevision,
    lastTwinOutcomeRevision: foreignNoFill.projection.lastTwinOutcomeRevision,
    settledTwinHistory: [...noFill.projection.settledTwinHistory.slice(0, -1), foreignSettled],
    recoveryEvidenceActionKey: foreignNoFill.projection.recoveryEvidenceActionKey,
    recoveryEvidenceFixtureId: foreignNoFill.projection.recoveryEvidenceFixtureId,
    recoveryEvidenceTwinStateRevision: foreignNoFill.projection.recoveryEvidenceTwinStateRevision,
    recoveryEvidenceTwinOutcomeRevision: foreignNoFill.projection.recoveryEvidenceTwinOutcomeRevision,
    lastTransition: {
      ...noFill.projection.lastTransition,
      twinOutcomeRevision: foreignNoFill.projection.lastTransition.twinOutcomeRevision,
    },
  });
  assert.throws(
    () => validateLifecycleProjection(foreignActionLineage),
    /no-fill action is not bound to its lifecycle projection/u,
  );

  const forgedEvidenceLineage = rehash(noFill.projection, {
    lastNoFill: {
      ...noFill.projection.lastNoFill,
      twinOutcomeRevision: 'forged-no-fill-twin-outcome-revision',
    },
  });
  assert.throws(
    () => validateLifecycleProjection(forgedEvidenceLineage),
    /twin no-fill lineage is not retained/u,
  );

  const erasedTwinNoFillHead = rehash(noFill.projection, { lastNoFill: null });
  assert.throws(
    () => validateLifecycleProjection(erasedTwinNoFillHead),
    /current no-fill head does not match its latest twin outcome/u,
  );
  const strippedRiskNoFillRecoveryTuple = rehash(noFill.projection, {
    recoveryEvidenceActionKey: null,
    recoveryEvidenceFixtureId: null,
    recoveryEvidenceTwinStateRevision: null,
    recoveryEvidenceTwinOutcomeRevision: null,
  });
  assert.throws(
    () => validateLifecycleProjection(strippedRiskNoFillRecoveryTuple),
    /unresolved risk no-fill requires its exact recovery evidence tuple/u,
  );

  const resolutionRevision = 'volume-forged-lineage-resolution-r1';
  const resolved = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    evaluatedAtMs: noFill.projection.lastTransition.occurredAtMs + 20,
    current: noFill.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      exhaustion: 'PRESENT',
      reconciliationState: 'EXACT',
      recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT',
      recoveryRevision: resolutionRevision,
    },
  }));
  assert.equal(resolved.disposition, 'BLOCKED');

  const erasedResolvedNoFillHead = rehash(resolved.projection, { lastNoFill: null });
  assert.throws(
    () => validateLifecycleProjection(erasedResolvedNoFillHead),
    /current no-fill head does not match its latest recovery outcome/u,
  );

  const erasedConsumedHistory = rehash(resolved.projection, {
    consumedRecoveryRevisions: [],
  });
  assert.throws(
    () => validateLifecycleProjection(erasedConsumedHistory),
    /latest recovery resolution must match its consumed history/u,
  );

  const duplicatedConsumedHistory = rehash(resolved.projection, {
    consumedRecoveryRevisions: [resolutionRevision, resolutionRevision],
  });
  assert.throws(
    () => validateLifecycleProjection(duplicatedConsumedHistory),
    /consumed recovery revisions must be bounded and unique/u,
  );

  const forgedNoFillResolution = rehash(resolved.projection, {
    lastNoFill: {
      ...resolved.projection.lastNoFill,
      recoveryResolutionRevision: 'volume-forged-lineage-unconsumed-r2',
    },
  });
  assert.throws(
    () => validateLifecycleProjection(forgedNoFillResolution),
    /no-fill recovery revision is not retained as consumed/u,
  );
});

test('an unrelated recovery resolution does not consume an older twin no-fill', () => {
  const proposal = { proposalId: 'volume-proposal-unrelated-no-fill-resolution' };
  const opened = openProbe({ proposal });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  const noFill = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest, { asks: [] }),
  }));
  assert.equal(noFill.disposition, 'SETTLED');
  assert.equal(noFill.projection.lastNoFill.recoveryResolutionRevision, null);

  const recovery = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: noFill.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: { reconciliationState: 'MISMATCH' },
  }));
  assert.equal(recovery.disposition, 'RECOVERY_REQUIRED');
  assert.equal(recovery.projection.recoveryEvidenceActionKey, null);

  const resolved = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: recovery.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT', recoveryRevision: 'volume-unrelated-no-fill-resolution',
    },
  }));
  assert.equal(resolved.disposition, 'SETTLED');
  assert.equal(resolved.projection.lastNoFill.action.actionKey, planned.actionRequest.actionKey);
  assert.equal(resolved.projection.lastNoFill.recoveryResolutionRevision, null);
  assert.equal(resolved.projection.recoveryConsumptionHistory.at(-1).noFill, null);
});

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
    occupancy: lifecycleInput({
      current: reduced.projection,
      evaluatedAtMs: reduced.projection.lastTransition.occurredAtMs,
    }).occupancy,
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
  assert.equal(replay.projection.state, opened.settled.projection.state);
  assert.equal(replay.projection.positionQuantity, opened.settled.projection.positionQuantity);
  assert.ok(replay.projection.lastMarketObservedAtMs >= opened.settled.projection.lastMarketObservedAtMs);
  assert.ok(replay.projection.favorableExtremePrice >= opened.settled.projection.favorableExtremePrice);

  const other = planProbe({ proposal: { proposalId: 'volume-proposal-orphan-0002' } });
  const orphan = evaluateVolumeLifecycle(lifecycleInput({
    current: opened.settled.projection,
    twinEvidence: twinForAction(other.actionRequest),
  }));
  assert.equal(orphan.disposition, 'RECOVERY_REQUIRED');
  assert.ok(orphan.reasonCodes.includes('ORPHAN_TWIN_EVIDENCE'));
  assert.equal(orphan.projection.recoveryEvidenceActionKey, other.actionRequest.actionKey);
  assert.equal(orphan.recoveryHandoff.actionKey, other.actionRequest.actionKey);
  assert.equal(orphan.projection.positionQuantityTruth, 'UNKNOWN');
  assert.equal(orphan.projection.capitalUsageTruth, 'UNKNOWN');
  assert.equal(orphan.projection.unresolvedTwinConflict.kind, 'ORPHAN_TWIN_EVIDENCE');
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
  assert.equal(oldReplay.projection.state, confirmed.projection.state);
  assert.equal(oldReplay.projection.positionQuantity, confirmed.projection.positionQuantity);
  assert.ok(oldReplay.projection.lastMarketObservedAtMs >= confirmed.projection.lastMarketObservedAtMs);

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
  assert.equal(settledNewer.projection.positionQuantity, changedOld.projection.positionQuantity);
  assert.equal(settledNewer.projection.pendingAction.actionKey, finalPlan.actionRequest.actionKey);
  assert.equal(settledNewer.projection.lastSettledActionKey, latestSettledKey);
  assert.equal(settledNewer.projection.recoveryEvidenceActionKey, opened.planned.actionRequest.actionKey);
  assert.equal(settledNewer.projection.unresolvedTwinConflict.conflictRevision,
    changedOld.projection.unresolvedTwinConflict.conflictRevision);

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

  const conflictingLateFillInput = lifecycleInput({
    proposal,
    current: recovery.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: resolution,
    twinEvidence: twinForAction(planned.actionRequest),
  });
  conflictingLateFillInput.occupancy.activeRecords = conflictingLateFillInput.occupancy.activeRecords
    .filter((record) => record.kind === 'POSITION');
  const conflictingLateFill = evaluateVolumeLifecycle(conflictingLateFillInput);
  assert.equal(conflictingLateFill.disposition, 'RECOVERY_REQUIRED');
  assert.ok(conflictingLateFill.reasonCodes.includes('CANONICAL_RECOVERY_TWIN_EVIDENCE_CONFLICT'));
  assert.equal(conflictingLateFill.projection.positionQuantity, '0');
  assert.equal(conflictingLateFill.projection.pendingAction.actionKey, planned.actionRequest.actionKey);
  assert.equal(conflictingLateFill.projection.lastSettledActionKey, null);
  assert.equal(conflictingLateFill.projection.lastRecoveryResolutionRevision, null);
  assert.deepEqual(conflictingLateFill.projection.consumedRecoveryRevisions, []);
  assert.equal(conflictingLateFill.twinSettlement.state, 'FILLED');
  assert.equal(conflictingLateFill.projection.positionQuantityTruth, 'UNKNOWN');
  assert.equal(conflictingLateFill.projection.capitalUsageTruth, 'UNKNOWN');
  assert.equal(conflictingLateFill.projection.unresolvedTwinConflict.kind,
    'SIMULTANEOUS_CANONICAL_NO_EFFECT');

  const closedInput = lifecycleInput({
    proposal, current: recovery.projection, authority: { riskActionClass: 'RECOVERY' }, signals: resolution,
  });
  closedInput.occupancy.activeRecords = closedInput.occupancy.activeRecords
    .filter((record) => record.kind === 'POSITION');
  const closed = evaluateVolumeLifecycle(closedInput);
  assert.equal(closed.disposition, 'TERMINAL');
  assert.equal(closed.projection.state, 'EXIT');
  assert.equal(closed.projection.positionQuantity, '0');
  assert.equal(closed.projection.pendingAction, null);
  assert.equal(closed.projection.lastNoFill.action.intentKey, planned.actionRequest.intentKey);
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
    evaluatedAtMs: hold1.projection.lastTransition.occurredAtMs,
    market: { observedAtMs: hold1.projection.lastMarketObservedAtMs },
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
    evaluatedAtMs: recovery1.projection.lastTransition.occurredAtMs,
    current: recovery1.projection,
  }));
  const recovery3 = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-recovery-fixpoint' },
    evaluatedAtMs: recovery2.projection.lastTransition.occurredAtMs,
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
    occupancy: lifecycleInput({
      current: recovery.projection,
      evaluatedAtMs: recovery.projection.lastTransition.occurredAtMs,
    }).occupancy,
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
  assert.equal(future.projection.positionQuantity, '0');
  assert.equal(future.projection.entryCostBasisQuote, '0');
  assert.equal(future.projection.openedAtMs, null);
  assert.equal(future.projection.positionQuantityTruth, 'UNKNOWN');
  assert.equal(future.projection.capitalUsageTruth, 'UNKNOWN');
  assert.equal(future.projection.unresolvedTwinConflict.kind, 'TWIN_CHRONOLOGY_INVALID');
  const { projectionRevision: _futureRevision, ...futureMaterial } = future.projection;
  const strippedPendingTwinTuple = finalizeProjection({
    ...futureMaterial,
    pendingTwinStateRevision: null,
    pendingTwinOutcomeRevision: null,
  });
  assert.throws(
    () => validateLifecycleProjection(strippedPendingTwinTuple),
    /durably bound to recovery evidence/u,
  );
  const futureReplay = evaluateVolumeLifecycle(lifecycleInput({
    evaluatedAtMs: future.projection.lastTransition.occurredAtMs + 100,
    proposal: { proposalId: 'volume-proposal-future-twin' },
    current: future.projection,
    twinEvidence: twinForAction(futurePlan.actionRequest),
  }));
  assert.equal(futureReplay.disposition, 'RECOVERY_REQUIRED');
  assert.equal(futureReplay.projection.positionQuantity, '0');
  assert.equal(futureReplay.projection.unresolvedTwinConflict.conflictRevision,
    future.projection.unresolvedTwinConflict.conflictRevision);

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
  assert.equal(unknownFee.projection.unresolvedTwinConflict.kind,
    'TWIN_EFFECT_RECONSTRUCTION_REQUIRED');
  assert.notEqual(unknownFee.projection.favorableExtremePrice, null);
});

test('settled recovery effects cannot be moved behind a later twin outcome', () => {
  const proposal = { proposalId: 'volume-proposal-recovery-outcome-order' };
  const opened = openProbe({ proposal });
  const planned = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: opened.settled.projection,
    authority: { riskActionClass: 'ADD' },
  }));
  const settled = evaluateVolumeLifecycle(lifecycleInput({
    proposal,
    current: planned.projection,
    twinEvidence: twinForAction(planned.actionRequest),
  }));
  assert.equal(settled.projection.settledTwinHistory.length, 2);
  const { projectionRevision: _revision, ...material } = settled.projection;
  const forgedHistory = finalizeProjection({
    ...material,
    settledTwinHistory: settled.projection.settledTwinHistory.map((record, index) => (
      index === 0 ? { ...record, settlementState: 'RECOVERY_REQUIRED' } : record
    )),
  });
  assert.throws(
    () => validateLifecycleProjection(forgedHistory),
    /settled recovery effect must be the latest retained twin outcome/u,
  );
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
  assert.equal(result.projection.unresolvedTwinConflict.kind,
    'TWIN_EFFECT_RECONSTRUCTION_REQUIRED');
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

  const { projectionRevision: _revision, ...material } = result.projection;
  const forgedExactPosition = finalizeProjection({
    ...material,
    positionQuantityTruth: 'EXACT',
  });
  assert.throws(
    () => validateLifecycleProjection(forgedExactPosition),
    /reconstruction truth flags do not match/u,
  );
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
  assert.equal(result.projection.unresolvedTwinConflict.kind,
    'TWIN_EFFECT_RECONSTRUCTION_REQUIRED');

  const noEffect = evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-bound-breach' },
    current: result.projection,
    authority: { riskActionClass: 'RECOVERY' },
    signals: {
      reconciliationState: 'EXACT', recoveryDisposition: 'RESOLVED',
      recoveryOutcome: 'NO_EFFECT', recoveryRevision: 'volume-bound-breach-no-effect',
    },
  }));
  assert.equal(noEffect.disposition, 'RECOVERY_REQUIRED');
  assert.deepEqual(noEffect.projection.consumedRecoveryRevisions, []);
  assert.equal(noEffect.projection.unresolvedTwinConflict.conflictRevision,
    result.projection.unresolvedTwinConflict.conflictRevision);

  const { projectionRevision: _revision, ...material } = result.projection;
  const strippedConflict = finalizeProjection({ ...material, unresolvedTwinConflict: null });
  assert.throws(
    () => validateLifecycleProjection(strippedConflict),
    /durable reconstruction conflict|durable twin conflict|settled twin recovery effect/u,
  );
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
  })), /exposure before|terminal EXIT|latest no-fill action/u);

  const reopenedExit = structuredClone(terminal.projection);
  reopenedExit.feedbackOutcomeRevision = null;
  reopenedExit.pendingAction = structuredClone(planned.actionRequest);
  reopenedExit.pendingActionBaseProjectionRevision = planned.actionRequest.projectionRevision;
  assert.throws(() => evaluateVolumeLifecycle(lifecycleInput({
    proposal: { proposalId: 'volume-proposal-corruption' }, current: reopenedExit,
  })), /pending action cannot already be settled|pending ENTRY|terminal EXIT|repeats the retained no-fill intent/u);

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
