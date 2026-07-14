import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveRecoveryCampaignTraceDigest,
  projectExposureRecoverySnapshot,
  validateExposureRecoverySnapshot,
} from '../../../dist/liveEdge/adapters/exposureRecoveryProjection/index.js';
import { completeInput, recoveryRequiredInput, subject } from './fixtures.mjs';

function rebindSubject(input, identity) {
  input.subject = identity;
  input.canonicalTruth = { ...input.canonicalTruth, subject: identity };
  input.chain = input.chain.map((stage) => ({ ...stage, subject: identity }));
  input.riskRecheck = { ...input.riskRecheck, subject: identity };
  input.control = { ...input.control, subject: identity };
  input.exposure = { ...input.exposure, subject: identity };
  input.capital = { ...input.capital, subject: identity };
  input.reconciliation = { ...input.reconciliation, subject: identity };
  input.outstanding = { ...input.outstanding, subject: identity };
  input.recovery = { ...input.recovery, subject: identity };
  input.campaigns = input.campaigns.map((campaign) => resealCampaign({ ...campaign, subject: identity }));
  return input;
}

function resealCampaign(campaign) {
  const { traceDigest: _discarded, ...material } = campaign;
  return { ...material, traceDigest: deriveRecoveryCampaignTraceDigest(material) };
}

test('projects one deterministic deeply frozen owner-evidence snapshot', () => {
  const left = projectExposureRecoverySnapshot(completeInput());
  const right = projectExposureRecoverySnapshot(completeInput());
  assert.deepEqual(left, right);
  assert.equal(left.projectionStatus, 'COMPLETE_FOR_OWNER_REVIEW');
  assert.equal(left.projectionAuthority, 'OWNER_EVIDENCE_ADAPTER_ONLY');
  assert.equal(left.truthClass, 'SYNTHETIC_ONLY');
  assert.equal(left.sendEligible, false);
  assert.equal(left.canAuthorizeEntry, false);
  assert.equal(left.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(left.externalActionAuthorization, 'NONE');
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.exposure), true);
  assert.equal(Object.isFrozen(left.campaigns[0]), true);
  assert.deepEqual(validateExposureRecoverySnapshot(left), left);
});

test('requires confirmed fills and reconciled exchange truth instead of requested quantities', () => {
  const input = completeInput();
  input.exposure = { ...input.exposure, source: 'REQUESTED_ORDER_QUANTITY' };
  assert.throws(() => projectExposureRecoverySnapshot(input), /confirmed-fill/);
});

test('blocks cross-owner identity drift across the chain and owner projections', () => {
  const input = completeInput();
  input.chain[4] = { ...input.chain[4], subject: subject({ correlationId: 'forged-correlation' }) };
  assert.throws(() => projectExposureRecoverySnapshot(input), /different owner subject/);

  const capitalDrift = completeInput();
  capitalDrift.capital = { ...capitalDrift.capital, subject: subject({ accountRealmId: 'foreign-realm' }) };
  assert.throws(() => projectExposureRecoverySnapshot(capitalDrift), /different owner subject/);
});

test('requires a current passing risk recheck immediately before completed dispatch', () => {
  const stale = completeInput();
  stale.riskRecheck = { ...stale.riskRecheck, mutationAttemptAtMs: stale.riskRecheck.evaluatedAtMs + 11 };
  assert.throws(() => projectExposureRecoverySnapshot(stale), /not immediately bound/);

  const priorVerdict = completeInput();
  priorVerdict.riskRecheck = { ...priorVerdict.riskRecheck, currentTruthUsed: false };
  assert.throws(() => projectExposureRecoverySnapshot(priorVerdict), /current passing risk recheck/);
});

test('kill posture blocks increases while preserving observation, reduction, repayment, and recovery', () => {
  const snapshot = projectExposureRecoverySnapshot(completeInput());
  for (const entry of snapshot.control.admissions) {
    if (['ACTIVATE_PROPOSAL', 'OPEN_EXPOSURE', 'ADD_EXPOSURE', 'REPEAT_ENTRY'].includes(entry.action)) {
      assert.equal(entry.allowed, false, entry.action);
    } else {
      assert.equal(entry.allowed, true, entry.action);
    }
  }

  const blockedRecovery = completeInput();
  blockedRecovery.control.admissions[12] = {
    ...blockedRecovery.control.admissions[12],
    allowed: false,
  };
  assert.throws(() => projectExposureRecoverySnapshot(blockedRecovery), /must preserve RECOVERY/);
});

test('retains mismatches, exposure, and manual intervention without hiding liability', () => {
  const snapshot = projectExposureRecoverySnapshot(recoveryRequiredInput());
  assert.equal(snapshot.projectionStatus, 'RECOVERY_REQUIRED');
  assert.equal(snapshot.componentEvidence.capitalExposed, true);
  assert.equal(snapshot.componentEvidence.operatorAttentionRequired, true);
  assert.equal(snapshot.reconciliation.orphanState, 'PRESENT');
  assert.equal(snapshot.recovery.ownerEndState, 'MANUAL_INTERVENTION');
  assert.equal(snapshot.recovery.recommendations[0].automatic, false);
});

test('copies Normal, Reverse, and Volume owner exposure without recomputing strategy economics', () => {
  const normal = projectExposureRecoverySnapshot(completeInput());
  assert.equal(normal.subject.strategy, 'NORMAL_BASIS');

  const reverseInput = rebindSubject(completeInput(), subject({
    strategy: 'REVERSE_BASIS',
    proposalId: 'proposal-reverse-btcusdt-1',
    planOrLifecycleId: 'lifecycle-reverse-btcusdt-1',
  }));
  reverseInput.reconciliation = {
    ...reverseInput.reconciliation,
    owner: 'OWNER_INJECTED_RECONCILIATION_EVIDENCE',
  };
  reverseInput.outstanding = {
    ...reverseInput.outstanding,
    owner: 'OWNER_INJECTED_RECONCILIATION_EVIDENCE',
  };
  reverseInput.exposure = {
    ...reverseInput.exposure,
    marginBase: '-0.03',
    futuresBaseEquivalent: '0.03',
    netBase: '0',
    grossNotional: '6',
    marginLiability: '0.03',
  };
  reverseInput.recovery = { ...reverseInput.recovery, ownerEndState: 'OPEN' };
  reverseInput.componentEvidence = { ...reverseInput.componentEvidence, capitalExposed: true };
  const reverse = projectExposureRecoverySnapshot(reverseInput);
  assert.equal(reverse.exposure.marginBase, '-0.03');
  assert.equal(reverse.exposure.marginLiability, '0.03');
  assert.equal(reverse.reconciliation.owner, 'OWNER_INJECTED_RECONCILIATION_EVIDENCE');

  const volumeInput = rebindSubject(completeInput(), subject({
    strategy: 'VOLUME',
    proposalId: 'proposal-volume-btcusdt-1',
    planOrLifecycleId: 'lifecycle-volume-btcusdt-1',
  }));
  volumeInput.reconciliation = {
    ...volumeInput.reconciliation,
    owner: 'OWNER_INJECTED_RECONCILIATION_EVIDENCE',
  };
  volumeInput.outstanding = {
    ...volumeInput.outstanding,
    owner: 'OWNER_INJECTED_RECONCILIATION_EVIDENCE',
  };
  volumeInput.exposure = {
    ...volumeInput.exposure,
    spotBase: '0.1',
    netBase: '0.1',
    grossNotional: '10',
    unhedgedNotional: '10',
    unhedgedSinceMs: volumeInput.exposure.observedAtMs - 100,
  };
  volumeInput.recovery = { ...volumeInput.recovery, ownerEndState: 'OPEN' };
  volumeInput.componentEvidence = { ...volumeInput.componentEvidence, capitalExposed: true };
  const volume = projectExposureRecoverySnapshot(volumeInput);
  assert.equal(volume.exposure.spotBase, '0.1');
  assert.equal(volume.exposure.unhedgedNotional, '10');
  assert.equal(volume.projectionStatus, 'COMPLETE_FOR_OWNER_REVIEW');
});

test('rejects forged CLOSED or RECOVERED outcomes with exposure, debt, or outstanding evidence', () => {
  for (const change of [
    { residualExposure: '1' },
    { residualLiability: '1' },
  ]) {
    const input = completeInput();
    input.recovery = { ...input.recovery, ...change };
    assert.throws(() => projectExposureRecoverySnapshot(input), /cannot hide residual/);
  }
  const ambiguous = completeInput();
  ambiguous.outstanding.ambiguousMutationReferences = ['ambiguous-client-id-1'];
  assert.throws(() => projectExposureRecoverySnapshot(ambiguous), /cannot hide residual/);
});

test('campaign matrix covers every scenario and every durable crash fault cut without duplicates', () => {
  const snapshot = projectExposureRecoverySnapshot(completeInput());
  assert.equal(snapshot.campaigns.length, 20);
  const crash = snapshot.campaigns.find((entry) => entry.scenario === 'SERVER_CRASH_EVERY_TICKET_STATE');
  assert.equal(crash.replayWitnesses.length, 9);
  assert.equal(new Set(crash.replayWitnesses.map((entry) => entry.faultCut)).size, 9);
  assert.ok(snapshot.campaigns.every((entry) => entry.duplicateOrderCount === 0));
  assert.ok(snapshot.campaigns.every((entry) => entry.hiddenResidualExposure === false));
  assert.ok(snapshot.campaigns.every((entry) => entry.hiddenResidualLiability === false));

  const hidden = completeInput();
  hidden.campaigns[0] = { ...hidden.campaigns[0], hiddenResidualLiability: true };
  assert.throws(() => projectExposureRecoverySnapshot(hidden), /recovery proof invariants/);

  const missingState = completeInput();
  const crashIndex = missingState.campaigns.findIndex((entry) => entry.scenario === 'SERVER_CRASH_EVERY_TICKET_STATE');
  missingState.campaigns[crashIndex] = {
    ...missingState.campaigns[crashIndex],
    replayWitnesses: missingState.campaigns[crashIndex].replayWitnesses.slice(1),
  };
  missingState.campaigns[crashIndex] = resealCampaign(missingState.campaigns[crashIndex]);
  assert.throws(() => projectExposureRecoverySnapshot(missingState), /every valid durable owner-state fault cut/);

  const falseRestore = completeInput();
  const falseRestoreIndex = falseRestore.campaigns.findIndex(
    (entry) => entry.scenario === 'SERVER_CRASH_EVERY_TICKET_STATE',
  );
  const falseWitnesses = structuredClone(falseRestore.campaigns[falseRestoreIndex].replayWitnesses);
  falseWitnesses[3].restoredStateRevision = 'forged-restored-state-revision';
  falseRestore.campaigns[falseRestoreIndex] = resealCampaign({
    ...falseRestore.campaigns[falseRestoreIndex],
    replayWitnesses: falseWitnesses,
  });
  assert.throws(() => projectExposureRecoverySnapshot(falseRestore), /did not restore the exact cut state/);
});

test('campaign proof is trace-bound and replay cannot invent a second mutation identity', () => {
  const duplicate = completeInput();
  duplicate.campaigns[0] = resealCampaign({
    ...duplicate.campaigns[0],
    mutationIdentities: ['stable-mutation-1', 'stable-mutation-1'],
  });
  assert.throws(() => projectExposureRecoverySnapshot(duplicate), /must not contain duplicates/);

  const invented = completeInput();
  invented.campaigns[0] = resealCampaign({
    ...invented.campaigns[0],
    replayObservedMutationIdentities: ['new-mutation-after-restart'],
  });
  assert.throws(() => projectExposureRecoverySnapshot(invented), /introduced a mutation identity/);

  const hiddenTerminal = completeInput();
  hiddenTerminal.campaigns[0] = resealCampaign({
    ...hiddenTerminal.campaigns[0],
    terminalResidualLiability: '1',
  });
  assert.throws(() => projectExposureRecoverySnapshot(hiddenTerminal), /terminal trace hides residual/);

  const digestDrift = completeInput();
  digestDrift.campaigns[0] = { ...digestDrift.campaigns[0], terminalStateRevision: 'forged-terminal-revision' };
  assert.throws(() => projectExposureRecoverySnapshot(digestDrift), /trace digest does not bind/);
});

test('chain stages enforce canonical owners and cannot false-green past a blocked prerequisite', () => {
  const wrongOwner = completeInput();
  wrongOwner.chain[2] = { ...wrongOwner.chain[2], owner: 'STRATEGY_OWNER' };
  assert.throws(() => projectExposureRecoverySnapshot(wrongOwner), /not the canonical owner/);

  const blocked = completeInput();
  blocked.chain = blocked.chain.map((stage, index) => index < 6
    ? stage
    : { ...stage, status: 'OWNER_GATED', reasonCodes: ['EXTERNAL_AUTHORITY_REQUIRED'] });
  blocked.riskRecheck = {
    ...blocked.riskRecheck,
    disposition: 'FAIL',
    currentTruthUsed: true,
  };
  const snapshot = projectExposureRecoverySnapshot(blocked);
  assert.equal(snapshot.projectionStatus, 'BLOCKED');

  const impossible = completeInput();
  impossible.chain[5] = { ...impossible.chain[5], status: 'BLOCKED' };
  assert.throws(() => projectExposureRecoverySnapshot(impossible), /cannot be followed by a complete stage/);

  const falseNotApplicable = completeInput();
  falseNotApplicable.chain[0] = { ...falseNotApplicable.chain[0], status: 'NOT_APPLICABLE' };
  assert.throws(() => projectExposureRecoverySnapshot(falseNotApplicable), /only for owner-declared approval/);

  const approvalNotRequired = completeInput();
  approvalNotRequired.chain[3] = {
    ...approvalNotRequired.chain[3],
    status: 'NOT_APPLICABLE',
    reasonCodes: ['OWNER_DECLARED_NOT_REQUIRED'],
  };
  assert.equal(projectExposureRecoverySnapshot(approvalNotRequired).projectionStatus, 'COMPLETE_FOR_OWNER_REVIEW');
});

test('one canonical truth binding prevents double-counting revision drift', () => {
  for (const [field, value] of [
    ['reservationRevision', 'foreign-reservation-revision'],
    ['capitalPositionRevision', 'foreign-position-revision'],
    ['outstandingRevision', 'foreign-outstanding-revision'],
    ['reconciliationRevision', 'foreign-reconciliation-revision'],
  ]) {
    const input = completeInput();
    input.canonicalTruth = { ...input.canonicalTruth, [field]: value };
    assert.throws(() => projectExposureRecoverySnapshot(input), /canonical truth revisions diverge/, field);
  }
  const foreignMutation = completeInput();
  foreignMutation.riskRecheck = { ...foreignMutation.riskRecheck, mutationId: 'foreign-mutation-identity' };
  assert.throws(() => projectExposureRecoverySnapshot(foreignMutation), /canonical truth revisions diverge/);
});

test('complete capital economics cannot smuggle unknown funding, borrow, PnL, or capacity', () => {
  for (const field of ['availableCapacity', 'funding', 'borrowCost', 'fees', 'realizedPnl', 'unrealizedPnl']) {
    const input = completeInput();
    input.capital = { ...input.capital, [field]: null };
    assert.throws(() => projectExposureRecoverySnapshot(input), /cannot contain unknown values/, field);
  }
});

test('outstanding ambiguity or manual evidence requires explicit recovery and operator attention', () => {
  const input = completeInput();
  input.outstanding.ambiguousMutationReferences = ['ambiguous-owner-mutation-1'];
  input.recovery = { ...input.recovery, ownerEndState: 'OPEN' };
  input.componentEvidence = { ...input.componentEvidence, capitalExposed: true };
  assert.throws(() => projectExposureRecoverySnapshot(input), /requires explicit recovery/);

  input.recovery = {
    ...input.recovery,
    required: true,
    reasonCodes: ['AMBIGUOUS_MUTATION'],
    recommendations: [{
      owner: 'FOUNDATION_EXECUTION',
      kind: 'RESOLVE_EXISTING_MUTATION_IDENTITY',
      ownerRevision: input.outstanding.ownerRevision,
      automatic: false,
    }],
  };
  assert.throws(() => projectExposureRecoverySnapshot(input), /operatorAttentionRequired/);
});

test('owner residual exposure or liability cannot contradict a no-recovery projection', () => {
  for (const field of ['residualExposure', 'residualLiability']) {
    const input = completeInput();
    input.recovery = { ...input.recovery, ownerEndState: 'OPEN', [field]: '1' };
    input.componentEvidence = { ...input.componentEvidence, capitalExposed: true };
    assert.throws(() => projectExposureRecoverySnapshot(input), /requires explicit recovery/, field);
  }
});

test('cold start remains blocked when signed truth is owner-gated', () => {
  const input = completeInput();
  input.coldStart.steps = input.coldStart.steps.map((step, index) => index < 2
    ? step
    : {
        ...step,
        status: index === 2 ? 'OWNER_GATED' : 'NOT_STARTED',
        ownerRevision: null,
        observedAtMs: null,
        reasonCodes: index === 2 ? ['PRIVATE_READ_AUTHORITY_REQUIRED'] : ['PREREQUISITE_INCOMPLETE'],
      });
  input.coldStart.effectiveEntryMode = 'BLOCKED';
  const snapshot = projectExposureRecoverySnapshot(input);
  assert.equal(snapshot.projectionStatus, 'BLOCKED');
  assert.equal(snapshot.coldStart.startupPosture, 'HALTED');

  input.coldStart.effectiveEntryMode = 'OWNER_REVIEW_ONLY';
  assert.throws(() => projectExposureRecoverySnapshot(input), /must remain blocked/);
});

test('confirmed-borrow cut with liability truth not yet observed stays recovery-required and cannot fabricate zero debt', () => {
  const input = completeInput();
  input.exposure = {
    ...input.exposure,
    completeness: 'UNKNOWN',
    spotBase: null,
    marginBase: null,
    futuresBaseEquivalent: null,
    netBase: null,
    grossNotional: null,
    marginLiability: null,
    unhedgedNotional: null,
    unhedgedSinceMs: null,
  };
  input.reconciliation = {
    ...input.reconciliation,
    status: 'UNKNOWN',
    orphanState: 'UNKNOWN',
    reasonCodes: ['LIABILITY_TRUTH_NOT_YET_OBSERVED'],
  };
  input.outstanding.ambiguousMutationReferences = ['confirmed-borrow-awaiting-liability-truth'];
  input.recovery = {
    ...input.recovery,
    required: true,
    ownerEndState: 'MANUAL_INTERVENTION',
    residualExposure: null,
    residualLiability: null,
    reasonCodes: ['CONFIRMED_BORROW_LIABILITY_UNKNOWN'],
    recommendations: [{
      owner: 'FOUNDATION_RECONCILIATION',
      kind: 'RESTORE_CURRENT_MARGIN_LIABILITY_TRUTH',
      ownerRevision: input.reconciliation.revision,
      automatic: false,
    }],
  };
  input.componentEvidence = {
    capitalExposed: true,
    operatorAttentionRequired: true,
    ownerRevision: 'component-owner-confirmed-borrow-cut',
    reasonCodes: ['LIABILITY_UNKNOWN', 'OPERATOR_ATTENTION_REQUIRED'],
  };
  const snapshot = projectExposureRecoverySnapshot(input);
  assert.equal(snapshot.projectionStatus, 'RECOVERY_REQUIRED');
  assert.equal(snapshot.exposure.marginLiability, null);
  assert.equal(snapshot.recovery.residualLiability, null);
  assert.ok(snapshot.outstanding.ambiguousMutationReferences.includes(
    'confirmed-borrow-awaiting-liability-truth',
  ));
});

test('unknown truth cannot be presented as no capital exposure or no operator attention', () => {
  const input = completeInput();
  input.exposure = {
    ...input.exposure,
    completeness: 'UNKNOWN',
    spotBase: null,
    marginBase: null,
    futuresBaseEquivalent: null,
    netBase: null,
    grossNotional: null,
    marginLiability: null,
    unhedgedNotional: null,
  };
  input.recovery = {
    ...input.recovery,
    required: true,
    ownerEndState: 'MANUAL_INTERVENTION',
    reasonCodes: ['EXPOSURE_TRUTH_UNKNOWN'],
    recommendations: [{
      owner: 'FOUNDATION_RECONCILIATION',
      kind: 'RESTORE_CURRENT_EXCHANGE_TRUTH',
      ownerRevision: input.reconciliation.revision,
      automatic: false,
    }],
  };
  assert.throws(() => projectExposureRecoverySnapshot(input), /capitalExposed may be false/);

  input.componentEvidence = {
    ...input.componentEvidence,
    capitalExposed: true,
  };
  assert.throws(() => projectExposureRecoverySnapshot(input), /operatorAttentionRequired/);
});

test('hostile accessors, inherited records, secret fields, and post-build tampering fail closed', () => {
  let getterCalls = 0;
  const accessor = completeInput();
  Object.defineProperty(accessor, 'subject', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return subject();
    },
  });
  assert.throws(() => projectExposureRecoverySnapshot(accessor), /accessors/);
  assert.equal(getterCalls, 0);

  const lengthAccessor = completeInput();
  Object.defineProperty(lengthAccessor.capital, 'length', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'hidden';
    },
  });
  assert.throws(() => projectExposureRecoverySnapshot(lengthAccessor), /accessors/);
  assert.equal(getterCalls, 0);

  const inherited = Object.create({ subject: subject() });
  Object.assign(inherited, completeInput());
  assert.throws(() => projectExposureRecoverySnapshot(inherited), /plain objects/);

  const sensitive = completeInput();
  sensitive.capital.apiKey = 'forbidden';
  assert.throws(() => projectExposureRecoverySnapshot(sensitive), /sensitive field/);

  const openSchema = completeInput();
  openSchema.capital.unexpectedField = 'forbidden';
  assert.throws(() => projectExposureRecoverySnapshot(openSchema), /exact closed schema/);

  for (const arrayName of ['chain', 'campaigns']) {
    const sparse = completeInput();
    delete sparse[arrayName][1];
    assert.throws(() => projectExposureRecoverySnapshot(sparse), /must not be sparse/, arrayName);
  }

  const snapshot = structuredClone(projectExposureRecoverySnapshot(completeInput()));
  snapshot.exposure.netBase = '1';
  assert.throws(() => validateExposureRecoverySnapshot(snapshot), /not reproducible|capitalExposed/);
});
