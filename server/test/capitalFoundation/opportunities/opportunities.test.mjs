import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveOpportunityEligibilityPolicyRevision,
  evaluateOpportunityEligibility,
} from '../../../dist/capitalFoundation/opportunities/index.js';
import {
  assessCapitalTruth,
  createConservativeEconomicFactBinding,
} from '../../../dist/capitalFoundation/contracts/index.js';

const NOW = 1_800_000_000_000;

function capitalTruth(overrides = {}) {
  const source = {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 1_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId: 'foundation.read-model.basis',
    ...(overrides.source ?? {}),
  };
  return assessCapitalTruth({
    source,
    evaluatedAtMs: NOW,
    requiredValuePresent: true,
    revision: 'truth-r1',
    ...(overrides.assessment ?? {}),
  });
}

function intelligenceTruth(overrides = {}) {
  return {
    schemaVersion: '1',
    producerVersion: 'intelligence-1',
    configurationVersion: 'mi-cfg-1',
    featureVersion: null,
    authority: { kind: 'REPLAY_SUPPLIED', sourceId: 'mi.synthetic', dataset: 'evidence', endpointClass: 'INJECTED' },
    provenance: { sourceRecordIds: ['raw-1'], sourceSet: ['fixture'], transforms: ['reference-only'] },
    temporal: { sourceEventTimeMs: NOW - 100, sourceTransactionTimeMs: null, receivedTimeMs: NOW - 90, sequence: null },
    freshness: { basis: 'SOURCE_EVENT_TIME', evaluatedAtMs: NOW, ageMs: 100, maxAgeMs: 1_000, state: 'FRESH' },
    completeness: { state: 'COMPLETE', observedFields: ['reference'], missingFields: [], reasonCodes: [] },
    ...overrides,
  };
}

function economicFact(kind, value, sourceId) {
  if (value === null) return null;
  const owner = {
    FUNDING: 'BASIS_ENGINE',
    BORROW: 'FOUNDATION_BORROW_TRUTH',
    CAPITAL_OPPORTUNITY: 'CAPITAL_FOUNDATION',
  }[kind];
  return createConservativeEconomicFactBinding({
    kind,
    owner,
    value,
    unit: 'USDT',
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId,
    },
    ownerRevision: `${sourceId}-r1`,
    completeness: 'COMPLETE',
    evidenceIds: [`${sourceId}-e1`],
  });
}

function economics(overrides = {}) {
  const values = {
    valuationAsset: 'USDT',
    requestedCapital: '1000.00',
    expectedGrossEdge: '21.5',
    expectedNetEdge: '13.25',
    estimatedFees: '2',
    estimatedFunding: '-1',
    estimatedBorrowCost: '0',
    estimatedSpreadCost: '3.25',
    estimatedSlippage: '2',
    estimatedLatencyCost: '0.25',
    estimatedAdverseSelectionCost: '0.5',
    estimatedRecoveryCost: '0.75',
    estimatedCapitalOpportunityCost: '1.5',
    liquidityCapacity: '2500',
    exactSourceIds: ['economics-caller-1'],
    missingFields: [],
    ...overrides,
  };
  return {
    ...values,
    fundingFact: Object.hasOwn(overrides, 'fundingFact')
      ? overrides.fundingFact
      : economicFact('FUNDING', values.estimatedFunding, 'basis.funding-owner-1'),
    borrowFact: Object.hasOwn(overrides, 'borrowFact')
      ? overrides.borrowFact
      : economicFact('BORROW', values.estimatedBorrowCost, 'foundation.borrow-owner-1'),
    capitalOpportunityFact: Object.hasOwn(overrides, 'capitalOpportunityFact')
      ? overrides.capitalOpportunityFact
      : economicFact('CAPITAL_OPPORTUNITY', values.estimatedCapitalOpportunityCost, 'capital.opportunity-owner-1'),
  };
}

function intake(overrides = {}) {
  const proposal = {
    sourceProposalId: 'bp-1',
    canonicalProposalId: 'cprop-bp-1',
    sourceCorrelationId: 'basis-correlation-1',
    strategy: 'BASIS',
    symbol: 'BTCUSDT',
    direction: 'long_spot_short_perp',
    sourceLifecycle: 'open',
    sourceRevision: 'r17',
    sourceConfigRevision: 'basis-cfg-1',
    createdAtMs: NOW - 500,
    updatedAtMs: NOW - 100,
    expiresAtMs: NOW + 5_000,
    intakeDigest: 'digest-bp-1',
    ...(overrides.proposal ?? {}),
  };
  return {
    proposal,
    economics: economics(overrides.economics),
    truth: overrides.truth ?? capitalTruth(overrides.capitalTruth),
    lossReport: {
      omittedFields: ['netEdgePct', 'confidence', 'evidence'],
      missingSourceFields: [],
      translationReasons: ['FLOAT_FINANCIAL_FIELDS_OMITTED'],
      financialNumbersAccepted: false,
    },
  };
}

function evidence(id = 'ev-1', overrides = {}) {
  const { truth: truthOverrides, ...rest } = overrides;
  return {
    evidenceId: id,
    kind: 'BOOK_TICKER',
    instrumentId: 'BTC-SPOT',
    exactFinancialFactIds: ['fact-1'],
    omittedNumericFields: ['bidPrice', 'askPrice'],
    ...rest,
    truth: intelligenceTruth(truthOverrides),
  };
}

function thesis(overrides = {}) {
  const { truth: truthOverrides, ...rest } = overrides;
  return {
    thesisPacketId: 'thesis-1',
    instrumentId: 'BTC-SPOT',
    hypothesis: 'SPOT_LED_EXPANSION',
    stage: 'EARLY_CHANGE',
    leadMarket: 'SPOT',
    supportingFactIds: ['fact-1'],
    conflictingFactIds: [],
    unavailableFactIds: [],
    tradeability: 'SUPPORTED',
    reasonCodes: [],
    omittedNumericFields: [],
    ...rest,
    truth: intelligenceTruth(truthOverrides),
  };
}

function candidate(overrides = {}) {
  const value = {
    intake: intake(overrides.intake),
    structure: { kind: 'BASIS_TWO_LEG', spotInstrumentId: 'BTC-SPOT', perpetualInstrumentId: 'BTC-PERP' },
    requiredEvidenceIds: ['ev-1'],
    evidenceReferences: [evidence()],
    thesisReference: null,
    conflictScope: { exclusiveCapitalClaimIds: [] },
    ...overrides,
  };
  return value;
}

function policy(overrides = {}) {
  const draft = {
    authority: {
      revision: 'pending-content-address',
      sourceId: 'operator.capital-policy',
      issuedAtMs: NOW - 10_000,
      effectiveFromMs: NOW - 5_000,
      effectiveUntilMs: NOW + 100_000,
    },
    acceptedProposalConfigRevisions: { BASIS: ['basis-cfg-1'], VOLUME: ['volume-cfg-1'] },
    acceptedEvidenceConfigRevisions: { BASIS: ['mi-cfg-1'], VOLUME: ['mi-cfg-1'] },
    evidenceRequirement: { BASIS: 'REQUIRED', VOLUME: 'REQUIRED' },
    basisMode: 'MANUAL_ARMED',
    volumeMode: 'ADVISORY',
    ...overrides,
  };
  return {
    ...draft,
    authority: {
      ...draft.authority,
      revision: deriveOpportunityEligibilityPolicyRevision(draft),
    },
  };
}

function one(input = candidate(), rules = policy(), now = NOW) {
  return evaluateOpportunityEligibility([input], rules, now).considerations[0];
}

test('normal Basis intake is eligible with a non-borrowing two-leg executable structure', () => {
  const result = one();
  assert.equal(result.status, 'ELIGIBLE');
  assert.equal(result.mode, 'MANUAL_ARMED');
  assert.deepEqual(result.legs.map(({ role, side, borrowRequired }) => ({ role, side, borrowRequired })), [
    { role: 'SPOT', side: 'LONG', borrowRequired: false },
    { role: 'PERPETUAL', side: 'SHORT', borrowRequired: false },
  ]);
  assert.deepEqual(result.reasons, ['PROPOSAL_OPEN']);
});

test('reverse Basis preserves the spot-borrow requirement and opposite hedge legs', () => {
  const result = one(candidate({ intake: intake({ proposal: { direction: 'short_spot_long_perp' } }) }));
  assert.equal(result.status, 'ELIGIBLE');
  assert.deepEqual(result.legs.map(({ side, borrowRequired }) => ({ side, borrowRequired })), [
    { side: 'SHORT', borrowRequired: true },
    { side: 'LONG', borrowRequired: false },
  ]);
});

test('proposal source ID, canonical ID, authority, nullable revision warning, and immutable intake digest are preserved', () => {
  const source = candidate({ intake: intake({ proposal: { sourceRevision: null } }) });
  const result = one(source);
  assert.equal(result.status, 'ELIGIBLE');
  assert.equal(result.proposal.sourceProposalId, 'bp-1');
  assert.equal(result.proposal.canonicalProposalId, 'cprop-bp-1');
  assert.equal(result.proposal.sourceRevision, null);
  assert.equal(result.proposal.intakeDigest, 'digest-bp-1');
  assert.equal(result.truth.source.sourceId, 'foundation.read-model.basis');
  assert.equal(result.truth.source.authority, 'SYNTHETIC_TEST');
  assert.equal(result.truth.revision, 'truth-r1');
  assert.ok(result.reasons.includes('PROPOSAL_REVISION_UNKNOWN'));
});

test('divergent intake truth cannot be laundered back to complete by a fresh raw source', () => {
  const result = one(candidate({
    intake: intake({ truth: capitalTruth({ assessment: { divergent: true } }) }),
  }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.truth.completeness, 'DIVERGENT');
  assert.ok(result.reasons.includes('PROPOSAL_TRUTH_INCOMPLETE'));
});

test('expired, rejected, and invalidated engine proposals are terminally blocked', () => {
  for (const [sourceLifecycle, code] of [
    ['expired', 'PROPOSAL_EXPIRED'],
    ['rejected', 'PROPOSAL_REJECTED'],
    ['invalidated', 'PROPOSAL_INVALIDATED'],
  ]) {
    const result = one(candidate({ intake: intake({ proposal: { sourceLifecycle } }) }));
    assert.equal(result.status, 'BLOCKED', sourceLifecycle);
    assert.ok(result.reasons.includes(code), sourceLifecycle);
    assert.equal(result.reasons.includes('PROPOSAL_OPEN'), false, sourceLifecycle);
  }
});

test('an otherwise open proposal whose explicit expiry has elapsed is blocked', () => {
  const result = one(candidate({ intake: intake({ proposal: { expiresAtMs: NOW } }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('PROPOSAL_EXPIRED'));
});

test('unknown lifecycle cannot be reinterpreted as an open proposal', () => {
  const result = one(candidate({ intake: intake({ proposal: { sourceLifecycle: 'approved_manual' } }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('PROPOSAL_TRUTH_INCOMPLETE'));
});

test('proposal configuration mismatch fails closed', () => {
  const result = one(candidate({ intake: intake({ proposal: { sourceConfigRevision: 'basis-cfg-old' } }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('PROPOSAL_CONFIG_MISMATCH'));
});

test('missing required evidence is named and blocks capital eligibility', () => {
  const result = one(candidate({ evidenceReferences: [] }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.evidenceTruth, 'UNKNOWN');
  assert.ok(result.reasons.includes('EVIDENCE_MISSING'));
});

test('stale evidence remains stale and cannot authorize capital', () => {
  const result = one(candidate({ evidenceReferences: [evidence('ev-1', { truth: { freshness: { basis: 'SOURCE_EVENT_TIME', evaluatedAtMs: NOW, ageMs: 2_000, maxAgeMs: 1_000, state: 'STALE' } } })] }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.evidenceTruth, 'STALE');
  assert.ok(result.reasons.includes('EVIDENCE_STALE'));
});

test('evidence is aged against the injected clock rather than an old FRESH label', () => {
  const result = one(candidate(), policy(), NOW + 2_000);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.evidenceTruth, 'STALE');
  assert.ok(result.reasons.includes('EVIDENCE_STALE'));
});

test('duplicate evidence identity with divergent content is blocked deterministically', () => {
  const first = evidence();
  const second = evidence('ev-1', { kind: 'DEPTH_SNAPSHOT' });
  const result = one(candidate({ evidenceReferences: [first, second] }));
  const reversed = one(candidate({ evidenceReferences: [second, first] }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.evidenceTruth, 'DIVERGENT');
  assert.ok(result.reasons.includes('EVIDENCE_DIVERGENT'));
  assert.equal(JSON.stringify(result), JSON.stringify(reversed));
});

test('evidence configuration divergence is explicit', () => {
  const result = one(candidate({ evidenceReferences: [evidence('ev-1', { truth: { configurationVersion: 'mi-cfg-old' } })] }));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('EVIDENCE_DIVERGENT'));
});

test('thesis fact classified as both supporting and conflicting blocks eligibility', () => {
  const thesisReference = thesis({ supportingFactIds: ['fact-overlap'], conflictingFactIds: ['fact-overlap'] });
  const result = one(candidate({ thesisReference }));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('EVIDENCE_DIVERGENT'));
});

test('Market Intelligence BLOCKED thesis is a hard block even without conflicting fact IDs', () => {
  const result = one(candidate({ thesisReference: thesis({ tradeability: 'BLOCKED', reasonCodes: ['POLICY_BLOCK'] }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.evidenceTruth, 'DIVERGENT');
  assert.ok(result.reasons.includes('EVIDENCE_DIVERGENT'));
});

test('thesis configuration mismatch fails closed like an evidence configuration mismatch', () => {
  const result = one(candidate({ thesisReference: thesis({ truth: { configurationVersion: 'mi-cfg-old' } }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.evidenceTruth, 'DIVERGENT');
  assert.ok(result.reasons.includes('EVIDENCE_DIVERGENT'));
});

test('evidence and thesis instruments must bind to the proposed executable structure', () => {
  const evidenceMismatch = one(candidate({ evidenceReferences: [evidence('ev-1', { instrumentId: 'ETH-SPOT' })] }));
  const thesisMismatch = one(candidate({ thesisReference: thesis({ instrumentId: 'ETH-SPOT' }) }));
  for (const result of [evidenceMismatch, thesisMismatch]) {
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.evidenceTruth, 'DIVERGENT');
    assert.ok(result.reasons.includes('EVIDENCE_DIVERGENT'));
  }
});

test('Volume remains one-leg directional intelligence in ADVISORY mode', () => {
  const input = candidate({
    intake: intake({ proposal: { sourceProposalId: 'vp-1', canonicalProposalId: 'cprop-vp-1', strategy: 'VOLUME', direction: 'short', sourceConfigRevision: 'volume-cfg-1', intakeDigest: 'digest-vp-1' } }),
    structure: { kind: 'VOLUME_DIRECTIONAL', instrumentId: 'BTC-SPOT' },
  });
  const result = one(input);
  assert.equal(result.status, 'ADVISORY');
  assert.equal(result.mode, 'ADVISORY');
  assert.deepEqual(result.legs.map(({ role, side, borrowRequired }) => ({ role, side, borrowRequired })), [
    { role: 'DIRECTIONAL', side: 'SHORT', borrowRequired: null },
  ]);
  assert.ok(result.reasons.includes('VOLUME_ADVISORY_ONLY'));
});

test('Volume VALIDATE_ONLY is explicit but still cannot become capital eligible', () => {
  const input = candidate({
    intake: intake({ proposal: { sourceProposalId: 'vp-1', canonicalProposalId: 'cprop-vp-1', strategy: 'VOLUME', direction: 'long', sourceConfigRevision: 'volume-cfg-1', intakeDigest: 'digest-vp-1' } }),
    structure: { kind: 'VOLUME_DIRECTIONAL', instrumentId: 'BTC-SPOT' },
  });
  const result = one(input, policy({ volumeMode: 'VALIDATE_ONLY' }));
  assert.equal(result.status, 'ADVISORY');
  assert.equal(result.mode, 'VALIDATE_ONLY');
  assert.ok(result.reasons.includes('VOLUME_CALIBRATION_BLOCKED'));
});

test('hostile policy cannot grant Volume MANUAL_ARMED authority', () => {
  assert.throws(() => one(candidate(), policy({ volumeMode: 'MANUAL_ARMED' })), /Volume mode cannot grant capital authority/);
});

test('eligibility policy revision content-addresses every policy semantic except its own value', () => {
  const original = policy();
  assert.equal(deriveOpportunityEligibilityPolicyRevision(original), original.authority.revision);
  assert.equal(deriveOpportunityEligibilityPolicyRevision({
    ...original,
    authority: { ...original.authority, revision: 'ignored-by-derivation-only' },
  }), original.authority.revision);

  const sameRevisionMutations = [
    ['basis mode', { ...original, basisMode: 'VALIDATE_ONLY' }],
    ['volume mode', { ...original, volumeMode: 'VALIDATE_ONLY' }],
    ['Basis proposal configs', {
      ...original,
      acceptedProposalConfigRevisions: {
        ...original.acceptedProposalConfigRevisions,
        BASIS: [...original.acceptedProposalConfigRevisions.BASIS, 'basis-cfg-2'],
      },
    }],
    ['Volume proposal configs', {
      ...original,
      acceptedProposalConfigRevisions: {
        ...original.acceptedProposalConfigRevisions,
        VOLUME: [...original.acceptedProposalConfigRevisions.VOLUME, 'volume-cfg-2'],
      },
    }],
    ['Basis evidence configs', {
      ...original,
      acceptedEvidenceConfigRevisions: {
        ...original.acceptedEvidenceConfigRevisions,
        BASIS: [...original.acceptedEvidenceConfigRevisions.BASIS, 'mi-cfg-2'],
      },
    }],
    ['Volume evidence configs', {
      ...original,
      acceptedEvidenceConfigRevisions: {
        ...original.acceptedEvidenceConfigRevisions,
        VOLUME: [...original.acceptedEvidenceConfigRevisions.VOLUME, 'mi-cfg-2'],
      },
    }],
    ['Basis evidence requirement', {
      ...original,
      evidenceRequirement: { ...original.evidenceRequirement, BASIS: 'OPTIONAL' },
    }],
    ['Volume evidence requirement', {
      ...original,
      evidenceRequirement: { ...original.evidenceRequirement, VOLUME: 'OPTIONAL' },
    }],
    ['authority source', {
      ...original,
      authority: { ...original.authority, sourceId: 'operator.widened-capital-policy' },
    }],
    ['authority issue time', {
      ...original,
      authority: { ...original.authority, issuedAtMs: original.authority.issuedAtMs - 1 },
    }],
    ['authority effective time', {
      ...original,
      authority: { ...original.authority, effectiveFromMs: original.authority.effectiveFromMs + 1 },
    }],
    ['authority expiry', {
      ...original,
      authority: { ...original.authority, effectiveUntilMs: original.authority.effectiveUntilMs + 1 },
    }],
  ];

  for (const [label, changed] of sameRevisionMutations) {
    assert.notEqual(deriveOpportunityEligibilityPolicyRevision(changed), original.authority.revision, label);
    assert.throws(
      () => evaluateOpportunityEligibility([candidate()], changed, NOW),
      /policy revision does not match policy content/,
      label,
    );
  }
});

test('a hostile full-bundle widening cannot retain a restrictive eligibility revision', () => {
  const restrictive = policy({ basisMode: 'VALIDATE_ONLY', volumeMode: 'VALIDATE_ONLY' });
  const widened = {
    ...restrictive,
    authority: {
      ...restrictive.authority,
      sourceId: 'operator.widened-policy',
      effectiveUntilMs: restrictive.authority.effectiveUntilMs + 50_000,
    },
    acceptedProposalConfigRevisions: {
      BASIS: [...restrictive.acceptedProposalConfigRevisions.BASIS, 'basis-cfg-any'],
      VOLUME: [...restrictive.acceptedProposalConfigRevisions.VOLUME, 'volume-cfg-any'],
    },
    acceptedEvidenceConfigRevisions: {
      BASIS: [...restrictive.acceptedEvidenceConfigRevisions.BASIS, 'mi-cfg-any'],
      VOLUME: [...restrictive.acceptedEvidenceConfigRevisions.VOLUME, 'mi-cfg-any'],
    },
    evidenceRequirement: { BASIS: 'OPTIONAL', VOLUME: 'OPTIONAL' },
    basisMode: 'MANUAL_ARMED',
    volumeMode: 'ADVISORY',
  };
  assert.equal(widened.authority.revision, restrictive.authority.revision);
  assert.notEqual(deriveOpportunityEligibilityPolicyRevision(widened), restrictive.authority.revision);
  assert.throws(
    () => evaluateOpportunityEligibility([candidate()], widened, NOW),
    /policy revision does not match policy content/,
  );
});

test('set-like policy lists are order-stable while duplicate revisions fail closed', () => {
  const forward = policy({
    acceptedProposalConfigRevisions: {
      BASIS: ['basis-cfg-2', 'basis-cfg-1'],
      VOLUME: ['volume-cfg-2', 'volume-cfg-1'],
    },
    acceptedEvidenceConfigRevisions: {
      BASIS: ['mi-cfg-2', 'mi-cfg-1'],
      VOLUME: ['mi-cfg-3', 'mi-cfg-1'],
    },
  });
  const reversedDraft = {
    ...forward,
    authority: { ...forward.authority, revision: 'pending-reordered-address' },
    acceptedProposalConfigRevisions: {
      BASIS: [...forward.acceptedProposalConfigRevisions.BASIS].reverse(),
      VOLUME: [...forward.acceptedProposalConfigRevisions.VOLUME].reverse(),
    },
    acceptedEvidenceConfigRevisions: {
      BASIS: [...forward.acceptedEvidenceConfigRevisions.BASIS].reverse(),
      VOLUME: [...forward.acceptedEvidenceConfigRevisions.VOLUME].reverse(),
    },
  };
  const reversed = {
    ...reversedDraft,
    authority: {
      ...reversedDraft.authority,
      revision: deriveOpportunityEligibilityPolicyRevision(reversedDraft),
    },
  };
  assert.equal(reversed.authority.revision, forward.authority.revision);
  assert.equal(
    JSON.stringify(evaluateOpportunityEligibility([candidate()], forward, NOW)),
    JSON.stringify(evaluateOpportunityEligibility([candidate()], reversed, NOW)),
  );

  const duplicate = {
    ...forward,
    acceptedProposalConfigRevisions: {
      ...forward.acceptedProposalConfigRevisions,
      BASIS: ['basis-cfg-1', 'basis-cfg-1'],
    },
  };
  assert.throws(
    () => deriveOpportunityEligibilityPolicyRevision(duplicate),
    /must not contain duplicate revisions/,
  );
  assert.throws(
    () => evaluateOpportunityEligibility([candidate()], duplicate, NOW),
    /must not contain duplicate revisions/,
  );
});

test('advisory Volume intelligence cannot hard-veto an otherwise eligible Basis opportunity', () => {
  const basis = candidate();
  const volume = candidate({
    intake: intake({ proposal: { sourceProposalId: 'vp-1', canonicalProposalId: 'cprop-vp-1', strategy: 'VOLUME', direction: 'long', sourceConfigRevision: 'volume-cfg-1', intakeDigest: 'digest-vp-1' } }),
    structure: { kind: 'VOLUME_DIRECTIONAL', instrumentId: 'BTC-SPOT' },
  });
  const batch = evaluateOpportunityEligibility([volume, basis], policy(), NOW);
  assert.equal(batch.conflicts.length, 0);
  assert.equal(batch.considerations.find((result) => result.proposal.strategy === 'BASIS').status, 'ELIGIBLE');
  assert.equal(batch.considerations.find((result) => result.proposal.strategy === 'VOLUME').status, 'ADVISORY');
});

test('same-symbol proposals are both blocked with symmetric conflict IDs', () => {
  const a = candidate();
  const b = candidate({ intake: intake({ proposal: { sourceProposalId: 'bp-2', canonicalProposalId: 'cprop-bp-2', direction: 'short_spot_long_perp', intakeDigest: 'digest-bp-2' } }) });
  const batch = evaluateOpportunityEligibility([a, b], policy(), NOW);
  assert.equal(batch.conflicts.length, 1);
  assert.ok(batch.conflicts[0].kinds.includes('SAME_SYMBOL'));
  for (const result of batch.considerations) {
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.reasons.includes('CONFLICTING_OPPORTUNITY'));
    assert.equal(result.conflictingConsiderationIds.length, 1);
  }
});

test('shared instrument conflicts even when symbols differ', () => {
  const a = candidate();
  const b = candidate({
    intake: intake({ proposal: { sourceProposalId: 'bp-2', canonicalProposalId: 'cprop-bp-2', symbol: 'ETHUSDT', intakeDigest: 'digest-bp-2' } }),
    structure: { kind: 'BASIS_TWO_LEG', spotInstrumentId: 'ETH-SPOT', perpetualInstrumentId: 'BTC-PERP' },
    evidenceReferences: [evidence('ev-1', { instrumentId: 'BTC-PERP' })],
  });
  const batch = evaluateOpportunityEligibility([a, b], policy(), NOW);
  assert.deepEqual(batch.conflicts[0].kinds, ['SHARED_INSTRUMENT']);
  assert.deepEqual(batch.conflicts[0].sharedKeys, ['instrument:BTC-PERP']);
});

test('shared exclusive capital claim conflicts without treating every common collateral pool as exclusive', () => {
  const a = candidate({ conflictScope: { exclusiveCapitalClaimIds: ['locked-slice-7'] } });
  const b = candidate({
    intake: intake({ proposal: { sourceProposalId: 'bp-2', canonicalProposalId: 'cprop-bp-2', symbol: 'ETHUSDT', intakeDigest: 'digest-bp-2' } }),
    structure: { kind: 'BASIS_TWO_LEG', spotInstrumentId: 'ETH-SPOT', perpetualInstrumentId: 'ETH-PERP' },
    evidenceReferences: [evidence('ev-1', { instrumentId: 'ETH-SPOT' })],
    conflictScope: { exclusiveCapitalClaimIds: ['locked-slice-7'] },
  });
  const batch = evaluateOpportunityEligibility([a, b], policy(), NOW);
  assert.deepEqual(batch.conflicts[0].kinds, ['SHARED_EXCLUSIVE_CAPITAL_CLAIM']);
  assert.deepEqual(batch.conflicts[0].sharedKeys, ['capital:locked-slice-7']);
});

test('already expired proposal cannot poison a valid proposal through conflict discovery', () => {
  const expired = candidate({ intake: intake({ proposal: { sourceLifecycle: 'expired' } }) });
  const valid = candidate({ intake: intake({ proposal: { sourceProposalId: 'bp-2', canonicalProposalId: 'cprop-bp-2', intakeDigest: 'digest-bp-2' } }) });
  const batch = evaluateOpportunityEligibility([expired, valid], policy(), NOW);
  assert.equal(batch.conflicts.length, 0);
  assert.equal(batch.considerations.find((result) => result.proposal.sourceProposalId === 'bp-2').status, 'ELIGIBLE');
});

test('caller-supplied exact economics are canonicalized without importing engine float fields', () => {
  const result = one(candidate({ intake: intake({ economics: { requestedCapital: '+001000.000', expectedNetEdge: '00013.2500' } }) }));
  assert.equal(result.economics.requestedCapital, '1000');
  assert.equal(result.economics.expectedNetEdge, '13.25');
  assert.equal('confidence' in result, false);
  assert.equal('score' in result, false);
});

test('hostile float injection becomes missing truth rather than financial arithmetic', () => {
  const result = one(candidate({ intake: intake({ economics: { requestedCapital: 1000.25, expectedNetEdge: 13.25 } }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.economics.requestedCapital, null);
  assert.equal(result.economics.expectedNetEdge, null);
  assert.ok(result.economics.missingFields.includes('requestedCapital'));
  assert.ok(result.reasons.includes('CONSERVATIVE_ECONOMICS_INCOMPLETE'));
});

test('all-in economics blocks when latency, adverse-selection, recovery, or capital-opportunity truth is absent', () => {
  const result = one(candidate({
    intake: intake({
      economics: {
        estimatedLatencyCost: null,
        estimatedAdverseSelectionCost: null,
        estimatedRecoveryCost: null,
        estimatedCapitalOpportunityCost: null,
        fundingFact: null,
        borrowFact: null,
        capitalOpportunityFact: null,
        missingFields: [],
      },
    }),
  }));
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(
    result.economics.missingFields.filter((field) => field.startsWith('estimated')),
    [
      'estimatedAdverseSelectionCost',
      'estimatedCapitalOpportunityCost',
      'estimatedLatencyCost',
      'estimatedRecoveryCost',
    ],
  );
  assert.ok(result.reasons.includes('CONSERVATIVE_ECONOMICS_INCOMPLETE'));
  assert.equal(result.economics.fundingFact, null);
  assert.ok(result.economics.missingFields.includes('fundingFact'));
  assert.ok(result.economics.missingFields.includes('borrowFact'));
  assert.ok(result.economics.missingFields.includes('capitalOpportunityFact'));
});

test('arbitrary source IDs cannot bind owner economics or produce eligibility', () => {
  const forged = economics({
    exactSourceIds: ['funding-owner-1', 'borrow-owner-1', 'capital-opportunity-owner-1'],
    fundingFact: null,
    borrowFact: null,
    capitalOpportunityFact: null,
  });
  const result = one(candidate({ intake: intake({ economics: forged }) }));
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('CONSERVATIVE_ECONOMICS_INCOMPLETE'));
  assert.ok(result.economics.missingFields.includes('fundingFact'));
});

test('freshness is reevaluated against injected now rather than trusting an old fresh label', () => {
  const result = one(candidate(), policy(), NOW + 2_000);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.truth.completeness, 'STALE');
  assert.ok(result.reasons.includes('PROPOSAL_TRUTH_INCOMPLETE'));
});

test('optional absent evidence remains honestly UNKNOWN without fabricating a block', () => {
  const input = candidate({ requiredEvidenceIds: [], evidenceReferences: [] });
  const rules = policy({ evidenceRequirement: { BASIS: 'OPTIONAL', VOLUME: 'OPTIONAL' } });
  const result = one(input, rules);
  assert.equal(result.status, 'ELIGIBLE');
  assert.equal(result.evidenceTruth, 'UNKNOWN');
  assert.deepEqual(result.evidencePacketIds, []);
});

test('batch output is byte-equivalent under input permutation', () => {
  const a = candidate({ intake: intake({ proposal: { symbol: 'BTCUSDT' } }) });
  const b = candidate({
    intake: intake({ proposal: { sourceProposalId: 'bp-2', canonicalProposalId: 'cprop-bp-2', symbol: 'ETHUSDT', intakeDigest: 'digest-bp-2' } }),
    structure: { kind: 'BASIS_TWO_LEG', spotInstrumentId: 'ETH-SPOT', perpetualInstrumentId: 'ETH-PERP' },
  });
  assert.equal(
    JSON.stringify(evaluateOpportunityEligibility([a, b], policy(), NOW)),
    JSON.stringify(evaluateOpportunityEligibility([b, a], policy(), NOW)),
  );
});

test('identical duplicate proposal intake is idempotently collapsed', () => {
  const source = candidate();
  const single = evaluateOpportunityEligibility([source], policy(), NOW);
  const duplicate = evaluateOpportunityEligibility([source, source], policy(), NOW);
  assert.equal(duplicate.considerations.length, 1);
  assert.equal(JSON.stringify(duplicate), JSON.stringify(single));
});

test('divergent reuse of one proposal identity is blocked and permutation-stable', () => {
  const first = candidate();
  const second = candidate({
    intake: intake({ proposal: { symbol: 'ETHUSDT', intakeDigest: 'digest-bp-divergent' } }),
    structure: { kind: 'BASIS_TWO_LEG', spotInstrumentId: 'ETH-SPOT', perpetualInstrumentId: 'ETH-PERP' },
    requiredEvidenceIds: ['ev-2'],
    evidenceReferences: [evidence('ev-2', { instrumentId: 'ETH-SPOT' })],
  });
  const forward = evaluateOpportunityEligibility([first, second], policy(), NOW);
  const reverse = evaluateOpportunityEligibility([second, first], policy(), NOW);
  assert.equal(forward.considerations.length, 1);
  assert.equal(forward.considerations[0].status, 'BLOCKED');
  assert.equal(forward.considerations[0].truth.completeness, 'DIVERGENT');
  assert.ok(forward.considerations[0].reasons.includes('PROPOSAL_TRUTH_INCOMPLETE'));
  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
});

test('result graph is frozen against post-evaluation mutation', () => {
  const source = candidate();
  const batch = evaluateOpportunityEligibility([source], policy(), NOW);
  source.intake.proposal.symbol = 'MUTATED';
  source.evidenceReferences[0].evidenceId = 'MUTATED';
  assert.equal(batch.considerations[0].proposal.symbol, 'BTCUSDT');
  assert.deepEqual(batch.considerations[0].evidencePacketIds, ['ev-1']);
  assert.ok(Object.isFrozen(batch));
  assert.ok(Object.isFrozen(batch.considerations[0]));
});
