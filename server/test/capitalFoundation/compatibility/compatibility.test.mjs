import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const NOW = 1_900_000_000_000;

// Instrument the first import. The compatibility barrel must stay pure.
let dateNowCalls = 0;
let fetchCalls = 0;
let timeoutCalls = 0;
let intervalCalls = 0;
let randomCalls = 0;
const realDateNow = Date.now;
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realRandom = Math.random;
const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

Date.now = function compatibilityCountedDateNow() {
  dateNowCalls += 1;
  return realDateNow();
};
globalThis.fetch = function compatibilityCountedFetch(...args) {
  fetchCalls += 1;
  return realFetch.apply(this, args);
};
globalThis.setTimeout = function compatibilityCountedTimeout(...args) {
  timeoutCalls += 1;
  return realSetTimeout.apply(this, args);
};
globalThis.setInterval = function compatibilityCountedInterval(...args) {
  intervalCalls += 1;
  return realSetInterval.apply(this, args);
};
Math.random = function compatibilityCountedRandom() {
  randomCalls += 1;
  return realRandom();
};

const compatibility = await import('../../../dist/capitalFoundation/scenarios/index.js');

Date.now = realDateNow;
globalThis.fetch = realFetch;
globalThis.setTimeout = realSetTimeout;
globalThis.setInterval = realSetInterval;
Math.random = realRandom;

const globalsAfter = new Set(Object.getOwnPropertyNames(globalThis));
const { assessCapitalTruth } = await import('../../../dist/capitalFoundation/contracts/index.js');
const { MAX_UTC_MS } = await import('../../../dist/foundation/contracts/index.js');

function source(sourceId, overrides = {}) {
  return {
    sourceTimeMs: NOW - 100,
    receivedAtMs: NOW - 90,
    maxAgeMs: 10_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
    ...overrides,
  };
}

function capitalTruth(sourceId, overrides = {}) {
  return assessCapitalTruth({
    source: source(sourceId, overrides.source),
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW,
    requiredValuePresent: overrides.requiredValuePresent ?? true,
    divergent: overrides.divergent ?? false,
    revision: overrides.revision ?? `${sourceId}-r1`,
    reasons: overrides.reasons ?? [],
    evidenceReferences: overrides.evidenceReferences ?? [],
  });
}

function intelligenceTruth(overrides = {}) {
  return {
    schemaVersion: 'mi-schema-1',
    producerVersion: 'mi-producer-1',
    configurationVersion: 'mi-config-1',
    featureVersion: 'mi-feature-1',
    authority: {
      kind: 'REPLAY_SUPPLIED',
      sourceId: 'mi.fixture',
      dataset: 'compatibility',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: ['mi-raw-1'],
      sourceSet: ['fixture'],
      transforms: ['normalize'],
    },
    temporal: {
      sourceEventTimeMs: NOW - 100,
      sourceTransactionTimeMs: null,
      receivedTimeMs: NOW - 90,
      sequence: null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: NOW,
      ageMs: 100,
      maxAgeMs: 10_000,
      state: 'FRESH',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['fixture'],
      missingFields: [],
      reasonCodes: [],
    },
    ...overrides,
  };
}

function exactEconomics(overrides = {}) {
  return {
    valuationAsset: 'USDT',
    requestedCapital: '1000',
    expectedGrossEdge: '20.5',
    expectedNetEdge: '12.25',
    estimatedFees: '1.25',
    estimatedFunding: '-0.5',
    estimatedBorrowCost: '0',
    estimatedSpreadCost: '2.5',
    estimatedSlippage: '1',
    estimatedLatencyCost: '0.25',
    estimatedAdverseSelectionCost: '0.5',
    estimatedRecoveryCost: '0.75',
    estimatedCapitalOpportunityCost: '1.5',
    liquidityCapacity: '5000',
    fundingSourceIds: ['funding-owner-1'],
    borrowSourceIds: ['borrow-owner-1'],
    capitalOpportunitySourceIds: ['capital-opportunity-owner-1'],
    exactSourceIds: ['exact-economics-1'],
    missingFields: [],
    ...overrides,
  };
}

function canonical(strategy = 'BASIS', overrides = {}) {
  const basis = strategy === 'BASIS';
  return {
    kind: 'PROPOSAL',
    canonicalId: basis ? 'cprop_basis_fixture' : 'cprop_volume_fixture',
    source: strategy,
    sourceId: basis ? 'basis-proposal-1' : 'volume-proposal-1',
    symbol: basis ? 'BTCUSDT' : 'ETHUSDT',
    direction: basis ? 'long_spot_short_perp' : 'long',
    lifecycle: 'OPEN',
    sourceLifecycle: 'open',
    observedAt: source(basis ? 'foundation.read-model.basis' : 'foundation.read-model.volume'),
    expiresAtMs: NOW + 5_000,
    configVersion: basis ? 'basis-config-1' : 'volume-config-1',
    // These upstream values must never cross the adapter.
    netEdgePct: 91.234567,
    confidence: 0.876543,
    evidence: { financialFloat: 77.777 },
    sourceLocalRank: 3,
    borrowState: basis ? 'available' : 'not_needed',
    rejectionReasons: [],
    ...overrides,
  };
}

function bindings(strategy = 'BASIS', overrides = {}) {
  const basis = strategy === 'BASIS';
  return {
    metadata: {
      bindingId: `${strategy.toLowerCase()}-metadata-binding`,
      correlationId: basis ? 'basis-correlation-1' : 'volume-correlation-1',
      createdAtMs: NOW - 500,
      updatedAtMs: NOW - 100,
      truth: capitalTruth(`${strategy.toLowerCase()}.metadata`),
      ...(overrides.metadata ?? {}),
    },
    configuration: {
      bindingId: `${strategy.toLowerCase()}-configuration-binding`,
      revision: basis ? 'basis-config-1' : 'volume-config-1',
      truth: capitalTruth(`${strategy.toLowerCase()}.configuration`),
      ...(overrides.configuration ?? {}),
    },
    expiration: {
      bindingId: `${strategy.toLowerCase()}-expiration-binding`,
      expiresAtMs: NOW + 5_000,
      truth: capitalTruth(`${strategy.toLowerCase()}.expiration`),
      ...(overrides.expiration ?? {}),
    },
    instruments: basis
      ? {
          strategy: 'BASIS',
          bindingId: 'basis-instruments-binding',
          spotInstrumentId: 'BINANCE:SPOT:BTCUSDT',
          perpetualInstrumentId: 'BINANCE:USD_M_PERPETUAL:BTCUSDT',
          truth: capitalTruth('basis.instruments'),
          ...(overrides.instruments ?? {}),
        }
      : {
          strategy: 'VOLUME',
          bindingId: 'volume-instrument-binding',
          instrumentId: 'BINANCE:SPOT:ETHUSDT',
          truth: capitalTruth('volume.instrument'),
          ...(overrides.instruments ?? {}),
        },
  };
}

function basisSource(overrides = {}) {
  return {
    id: 'basis-proposal-1',
    correlationId: 'basis-correlation-1',
    strategy: 'basis',
    symbol: 'BTCUSDT',
    direction: 'long_spot_short_perp',
    createdTs: NOW - 500,
    updatedTs: NOW - 100,
    status: 'open',
    grossEdgePct: 44.444,
    netEdgePct: 33.333,
    fundingAdjPct: -2.222,
    suggestedNotionalUsd: 1234.567,
    confidence: 0.999,
    evidence: { float: 88.888 },
    stagedSizes: [{ stage: 1, fraction: 0.5, notionalUsd: 617.2835 }],
    invalidationSpec: { expiresTs: NOW + 5_000, gapClosesBelowPct: 1.1 },
    priority: { score: 99.999 },
    costBreakdown: { totalPct: 3.333 },
    ...overrides,
  };
}

function volumeSource(overrides = {}) {
  return {
    id: 'volume-proposal-1',
    correlationId: 'volume-correlation-1',
    strategy: 'volume_spike',
    symbol: 'ETHUSDT',
    direction: 'long',
    createdTs: NOW - 500,
    updatedTs: NOW - 100,
    status: 'open',
    grossEdgePct: 11.111,
    netEdgePct: 9.999,
    fundingAdjPct: -1.111,
    suggestedNotionalUsd: 2222.222,
    confidence: 0.888,
    evidence: { float: 66.666 },
    ...overrides,
  };
}

function canonicalInput(overrides = {}) {
  const binding = bindings('BASIS', overrides.bindings);
  return {
    canonical: canonical('BASIS', overrides.canonical),
    ...binding,
    economics: exactEconomics(overrides.economics),
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW,
  };
}

test('compatibility barrel import is authority-free and reuses only public contract validators', () => {
  assert.equal(dateNowCalls, 0, 'compatibility import invariant: no Date.now');
  assert.equal(fetchCalls, 0, 'compatibility import invariant: no fetch');
  assert.equal(timeoutCalls, 0, 'compatibility import invariant: no timers');
  assert.equal(intervalCalls, 0, 'compatibility import invariant: no intervals');
  assert.equal(randomCalls, 0, 'compatibility import invariant: no randomness');
  assert.deepEqual([...globalsAfter].filter((name) => !globalsBefore.has(name)), []);
  for (const file of ['types.js', 'proposalCompatibility.js', 'index.js']) {
    const compiled = readFileSync(new URL(`../../../dist/capitalFoundation/scenarios/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(compiled, /from ['"].*(?:engine\/basis|engine\/volume|intelligenceFoundation)/,
      `${file} must erase every upstream type-only import`);
  }
  const proposalCompiled = readFileSync(
    new URL('../../../dist/capitalFoundation/scenarios/proposalCompatibility.js', import.meta.url),
    'utf8',
  );
  assert.match(proposalCompiled, /import \{ isValidUtcMillis \} from ['"]\.\.\/\.\.\/foundation\/contracts\/index\.js['"];/,
    'UTC validation must reuse the public Foundation contract helper');
  const intelligenceCompiled = readFileSync(
    new URL('../../../dist/capitalFoundation/scenarios/intelligenceCompatibility.js', import.meta.url),
    'utf8',
  );
  assert.match(
    intelligenceCompiled,
    /import \{ validateTruthMetadata \} from ['"]\.\.\/\.\.\/intelligenceFoundation\/contracts\/index\.js['"];/,
    'Market Intelligence truth must reuse its public validator',
  );
  assert.doesNotMatch(intelligenceCompiled, /from ['"].*(?:engine\/basis|engine\/volume)/,
    'Market Intelligence compatibility must not gain an engine runtime dependency');
});

test('canonical intake is deterministic, revision-honest, and evaluation-clock independent', () => {
  const first = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput());
  const later = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({ evaluatedAtMs: NOW + 50 }));
  assert.equal(first.proposal.sourceRevision, null);
  assert.equal(first.proposal.intakeDigest, later.proposal.intakeDigest);
  assert.equal(first.lossReport.financialNumbersAccepted, false);
  assert.ok(first.lossReport.missingSourceFields.includes('sourceRevision'));
  for (const field of [
    'canonical.sourceCorrelationId',
    'canonical.sourceCreatedAtMs',
    'canonical.sourceRevision',
  ]) {
    assert.ok(first.lossReport.missingSourceFields.includes(field),
      `canonical-only loss must name ${field}`);
  }
  assert.ok(first.lossReport.translationReasons.includes('CALLER_BOUND_MISSING_ENGINE_METADATA'));
  const changed = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    economics: { estimatedFees: '1.26' },
  }));
  assert.notEqual(first.proposal.intakeDigest, changed.proposal.intakeDigest,
    'exact caller economics must participate in immutable intake identity');
});

test('intake digest binds stable truth contradictions but not the evaluation clock', () => {
  const clean = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput());
  const divergentInstrumentTruth = capitalTruth('basis.instruments', {
    divergent: true,
    revision: 'basis.instruments-r1',
  });
  const divergent = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    bindings: { instruments: { truth: divergentInstrumentTruth } },
  }));
  assert.notEqual(clean.proposal.intakeDigest, divergent.proposal.intakeDigest,
    'binding truth contradiction must invalidate immutable intake identity');
  const staleInstrumentTruth = capitalTruth('basis.instruments', {
    source: { sourceTimeMs: NOW - 20_000 },
    revision: 'basis.instruments-r1',
  });
  const stale = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    bindings: { instruments: { truth: staleInstrumentTruth } },
  }));
  assert.notEqual(clean.proposal.intakeDigest, stale.proposal.intakeDigest,
    'binding source provenance and declared truth must participate in intake identity');
});

test('strict source projection drops hostile nested extras from output and digest', () => {
  const clean = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput());
  const metadataTruth = capitalTruth('basis.metadata');
  const instrumentTruth = capitalTruth('basis.instruments');
  const hostile = compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    canonical: {
      observedAt: { ...source('foundation.read-model.basis'), financialFloat: 77.777 },
    },
    bindings: {
      metadata: {
        truth: { ...metadataTruth, source: { ...metadataTruth.source, financialFloat: 77.777 } },
      },
      instruments: {
        truth: { ...instrumentTruth, source: { ...instrumentTruth.source, financialFloat: 77.777 } },
      },
    },
  }));
  assert.equal(hostile.proposal.intakeDigest, clean.proposal.intakeDigest,
    'unknown structural extras must not influence safe intake identity');
  assert.equal(JSON.stringify(hostile).includes('77.777'), false,
    'unknown nested numbers must not cross the compatibility boundary');
  assert.deepEqual(Object.keys(hostile.truth.source).sort(), [
    'authority', 'completeness', 'maxAgeMs', 'receivedAtMs', 'sourceId', 'sourceTimeMs',
  ]);
});

test('canonical adapter rejects divergent config and expiry bindings', () => {
  assert.throws(() => compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    bindings: { configuration: { revision: 'other-config' } },
  })), /configuration binding diverges/);
  assert.throws(() => compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    bindings: { expiration: { expiresAtMs: NOW + 6_000 } },
  })), /expiration binding diverges/);
});

test('compatibility timestamps reuse the Foundation UTC bound', () => {
  assert.throws(() => compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    evaluatedAtMs: MAX_UTC_MS + 1,
  })), /valid injected source and evaluation times/);
});

test('caller economics rejects JavaScript numbers and noncanonical decimal strings', () => {
  assert.throws(() => compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    economics: { requestedCapital: 1000 },
  })), /exact decimal/);
  assert.throws(() => compatibility.adaptCanonicalProposalToCapitalIntake(canonicalInput({
    economics: { estimatedFees: '01.250' },
  })), /canonical non-negative decimal/);
});

test('Basis adapter binds two legs and reports every upstream float family as omitted', () => {
  const binding = bindings('BASIS');
  const result = compatibility.adaptBasisProposalToCapitalCandidate({
    source: basisSource(),
    canonical: canonical('BASIS'),
    ...binding,
    economics: exactEconomics(),
    evaluatedAtMs: NOW,
  });
  assert.deepEqual(result.structure, {
    kind: 'BASIS_TWO_LEG',
    spotInstrumentId: 'BINANCE:SPOT:BTCUSDT',
    perpetualInstrumentId: 'BINANCE:USD_M_PERPETUAL:BTCUSDT',
  });
  for (const path of [
    'source.costBreakdown',
    'source.invalidationSpec.gapClosesBelowPct',
    'source.invalidationSpec.spreadAboveBps',
    'source.priority',
    'source.stagedSizes',
  ]) {
    assert.ok(result.intake.lossReport.omittedFields.includes(path), `missing loss path ${path}`);
  }
  assert.equal(result.intake.proposal.expiresAtMs, NOW + 5_000,
    'Basis machine expiry must survive through its explicit binding');
  assert.equal(result.intake.lossReport.omittedFields.includes('source.invalidationSpec.expiresTs'), false,
    'preserved Basis machine expiry must not be reported as omitted');
  const serialized = JSON.stringify(result);
  for (const forbidden of ['44.444', '33.333', '1234.567', '88.888', '99.999']) {
    assert.equal(serialized.includes(forbidden), false, `raw float ${forbidden} crossed the adapter`);
  }
});

test('Basis machine expiry must exactly match canonical and caller-bound expiry', () => {
  const binding = bindings('BASIS');
  assert.throws(() => compatibility.adaptBasisProposalToCapitalCandidate({
    source: basisSource({ invalidationSpec: { expiresTs: NOW + 6_000 } }),
    canonical: canonical('BASIS'),
    ...binding,
    economics: exactEconomics(),
    evaluatedAtMs: NOW,
  }), /Basis machine expiry diverges/);
  assert.throws(() => compatibility.adaptBasisProposalToCapitalCandidate({
    source: basisSource({ invalidationSpec: { expiresTs: NOW + 5_000.5 } }),
    canonical: canonical('BASIS'),
    ...binding,
    economics: exactEconomics(),
    evaluatedAtMs: NOW,
  }), /Basis machine expiry diverges/);
});

test('Basis adapter output is deeply frozen and does not alias caller arrays or truth', () => {
  const binding = bindings('BASIS');
  const economics = exactEconomics();
  const mutableConfigurationTruth = {
    ...binding.configuration.truth,
    source: { ...binding.configuration.truth.source },
    freshness: { ...binding.configuration.truth.freshness },
    reasons: [...binding.configuration.truth.reasons],
    evidenceReferences: [...binding.configuration.truth.evidenceReferences],
  };
  binding.configuration.truth = mutableConfigurationTruth;
  const result = compatibility.adaptBasisProposalToCapitalCandidate({
    source: basisSource(), canonical: canonical('BASIS'), ...binding, economics, evaluatedAtMs: NOW,
  });
  economics.exactSourceIds.push('late-source');
  mutableConfigurationTruth.reasons.push('late-reason');
  assert.deepEqual(result.intake.economics.exactSourceIds, ['exact-economics-1']);
  assert.equal(result.intake.truth.reasons.includes('late-reason'), false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.intake));
  assert.ok(Object.isFrozen(result.intake.truth.source));
  assert.ok(Object.isFrozen(result.intake.lossReport.omittedFields));
});

test('Volume adapter uses only explicit provenance bindings and one caller-bound instrument', () => {
  const binding = bindings('VOLUME');
  const result = compatibility.adaptVolumeProposalToCapitalCandidate({
    source: volumeSource(),
    canonical: canonical('VOLUME'),
    ...binding,
    economics: exactEconomics({
      expectedGrossEdge: null,
      expectedNetEdge: null,
      missingFields: ['expectedGrossEdge', 'expectedNetEdge'],
    }),
    evaluatedAtMs: NOW,
  });
  assert.deepEqual(result.structure, {
    kind: 'VOLUME_DIRECTIONAL',
    instrumentId: 'BINANCE:SPOT:ETHUSDT',
  });
  assert.equal(result.intake.proposal.sourceConfigRevision, 'volume-config-1');
  assert.equal(result.intake.proposal.expiresAtMs, NOW + 5_000);
  assert.equal(result.intake.proposal.sourceRevision, null);
  assert.ok(result.intake.lossReport.omittedFields.includes('source.suggestedNotionalUsd'));
  assert.equal(JSON.stringify(result).includes('2222.222'), false);
});

test('raw and canonical source identity or lifecycle disagreement fails closed', () => {
  const binding = bindings('BASIS');
  assert.throws(() => compatibility.adaptBasisProposalToCapitalCandidate({
    source: basisSource({ symbol: 'ETHUSDT' }),
    canonical: canonical('BASIS'),
    ...binding,
    economics: exactEconomics(),
    evaluatedAtMs: NOW,
  }), /diverges from canonical/);
  assert.throws(() => compatibility.adaptBasisProposalToCapitalCandidate({
    source: basisSource({ status: 'expired' }),
    canonical: canonical('BASIS'),
    ...binding,
    economics: exactEconomics(),
    evaluatedAtMs: NOW,
  }), /diverges from canonical/);
});

const EVIDENCE_KINDS = [
  'TRADE', 'BOOK_TICKER', 'DEPTH_SNAPSHOT', 'DEPTH_DELTA', 'MARK_PRICE',
  'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION', 'BORROW', 'CONTEXT',
];

test('every Market Intelligence evidence kind omits numerics and promotes no exact financial fact', () => {
  for (const kind of EVIDENCE_KINDS) {
    const output = compatibility.adaptMarketIntelligenceEvidenceReference({
      id: `evidence-${kind}`,
      kind,
      instrument: { instrumentId: 'BINANCE:SPOT:BTCUSDT' },
      truth: intelligenceTruth(),
      price: 12345.6789,
      quoteQuantity: 98765.4321,
    });
    assert.deepEqual(output.exactFinancialFactIds, [], `${kind} must not promote floats`);
    assert.ok(output.omittedNumericFields.length > 0, `${kind} must report numeric loss`);
    assert.equal(JSON.stringify(output).includes('12345.6789'), false);
    assert.ok(Object.isFrozen(output.truth.provenance.sourceRecordIds));
  }
});

test('Market Intelligence evidence output does not alias upstream truth metadata', () => {
  const truth = intelligenceTruth();
  const output = compatibility.adaptMarketIntelligenceEvidenceReference({
    id: 'evidence-alias', kind: 'TRADE', instrument: { instrumentId: 'instrument-1' }, truth,
  });
  truth.provenance.sourceRecordIds.push('late-record');
  truth.completeness.reasonCodes.push('late-reason');
  assert.deepEqual(output.truth.provenance.sourceRecordIds, ['mi-raw-1']);
  assert.deepEqual(output.truth.completeness.reasonCodes, []);
});

test('Market Intelligence truth projection strips hostile extras and rejects numeric time floats', () => {
  const hostileTruth = {
    ...intelligenceTruth(),
    financialFloat: 77.777,
    freshness: { ...intelligenceTruth().freshness, financialFloat: 66.666 },
    temporal: { ...intelligenceTruth().temporal, financialFloat: 55.555 },
  };
  const evidence = compatibility.adaptMarketIntelligenceEvidenceReference({
    id: 'evidence-hostile-truth', kind: 'TRADE', instrument: { instrumentId: 'instrument-1' },
    truth: hostileTruth,
  });
  assert.equal(JSON.stringify(evidence).includes('77.777'), false);
  assert.equal(JSON.stringify(evidence).includes('66.666'), false);
  assert.equal(JSON.stringify(evidence).includes('55.555'), false);
  assert.deepEqual(Object.keys(evidence.truth.freshness).sort(), [
    'ageMs', 'basis', 'evaluatedAtMs', 'maxAgeMs', 'state',
  ]);
  const thesis = compatibility.adaptMarketIntelligenceThesisReference({
    id: 'thesis-hostile-truth', instrumentId: 'instrument-1',
    hypothesis: 'UNCLASSIFIED_ANOMALY', stage: 'UNCLASSIFIED', leadMarket: 'UNKNOWN',
    supporting: [], conflicting: [], neutral: [], unavailable: [], reasonCodes: [],
    tradeability: { state: 'UNKNOWN', reasonCodes: [] }, truth: hostileTruth,
  });
  assert.equal(JSON.stringify(thesis).includes('77.777'), false);
  assert.equal(JSON.stringify(thesis).includes('66.666'), false);
  assert.throws(() => compatibility.adaptMarketIntelligenceEvidenceReference({
    id: 'evidence-float-age', kind: 'TRADE', instrument: { instrumentId: 'instrument-1' },
    truth: intelligenceTruth({
      freshness: { ...intelligenceTruth().freshness, ageMs: 12.5 },
    }),
  }), /freshness age must match/);
  const zeroAgeTruth = intelligenceTruth({
    temporal: {
      ...intelligenceTruth().temporal,
      sourceEventTimeMs: NOW,
      receivedTimeMs: NOW,
    },
    freshness: {
      ...intelligenceTruth().freshness,
      evaluatedAtMs: NOW,
      ageMs: 0,
      maxAgeMs: 0,
      state: 'FRESH',
    },
  });
  assert.doesNotThrow(() => compatibility.adaptMarketIntelligenceEvidenceReference({
    id: 'evidence-zero-max-age', kind: 'TRADE', instrument: { instrumentId: 'instrument-1' },
    truth: zeroAgeTruth,
  }), 'upstream permits an exact zero maximum age when age is also zero');
});

test('Market Intelligence truth rejects hostile public-contract violations before projection', () => {
  const base = intelligenceTruth();
  const hostile = [
    ['authority-kind', intelligenceTruth({
      authority: { ...base.authority, kind: 'CALLER_ASSERTED' },
    }), /invalid authority or version metadata/],
    ['endpoint-class', intelligenceTruth({
      authority: { ...base.authority, endpointClass: 'PRIVATE_SECRET_ENDPOINT' },
    }), /invalid authority or version metadata/],
    ['empty-provenance', intelligenceTruth({
      provenance: { ...base.provenance, sourceSet: [] },
    }), /sourceSet cannot be empty/],
    ['reversed-sequence', intelligenceTruth({
      temporal: { ...base.temporal, sequence: { first: '9', last: '8', previous: '7' } },
    }), /sequence first must not exceed last/],
    ['nondecimal-sequence', intelligenceTruth({
      temporal: { ...base.temporal, sequence: { first: 'not-decimal', last: '9', previous: null } },
    }), /sequence identifiers must be decimal strings/],
    ['contradictory-completeness', intelligenceTruth({
      completeness: {
        state: 'COMPLETE', observedFields: ['fixture'], missingFields: ['price'], reasonCodes: [],
      },
    }), /complete truth cannot list missing fields/],
    ['unavailable-with-age', intelligenceTruth({
      freshness: {
        basis: 'UNAVAILABLE', evaluatedAtMs: NOW, ageMs: 0, maxAgeMs: null, state: 'UNAVAILABLE',
      },
    }), /unavailable truth cannot claim an age/],
    ['nested-secret', intelligenceTruth({
      diagnostic: { apiSecret: 'must-never-cross' },
    }), /SECRET_FIELD_REJECTED/],
  ];
  for (const [label, truth, expected] of hostile) {
    assert.throws(() => compatibility.adaptMarketIntelligenceEvidenceReference({
      id: `evidence-hostile-${label}`,
      kind: 'TRADE',
      instrument: { instrumentId: 'instrument-1' },
      truth,
    }), expected, label);
  }
});

function thesisFact(id, overrides = {}) {
  return {
    id,
    fact: `fact-${id}`,
    polarity: 'SUPPORTING',
    reasonCode: `reason-${id}`,
    featureIds: [],
    evidenceIds: [],
    observationStartMs: NOW - 500,
    observationEndMs: NOW - 100,
    truth: intelligenceTruth(),
    ...overrides,
  };
}

test('Market Intelligence thesis adapter preserves fact identities and tradeability without numeric observations', () => {
  const input = {
    id: 'thesis-1',
    instrumentId: 'BINANCE:SPOT:BTCUSDT',
    hypothesis: 'SPOT_LED_EXPANSION',
    stage: 'CONTINUATION',
    changedFirst: 'spot',
    changedAtMs: NOW - 500,
    leadMarket: 'SPOT',
    supporting: [thesisFact('support-2'), thesisFact('support-1')],
    conflicting: [thesisFact('conflict-1', { polarity: 'CONFLICTING' })],
    neutral: [thesisFact('neutral-1', { polarity: 'NEUTRAL' })],
    unavailable: [thesisFact('unavailable-1', { polarity: 'UNAVAILABLE' })],
    tradeability: {
      state: 'SUPPORTED',
      reasonCodes: ['tradeable'],
      requiredEvidenceIds: ['evidence-1'],
      missingEvidenceKinds: [],
    },
    analogueIds: [],
    reasonCodes: ['thesis-current'],
    truth: intelligenceTruth(),
  };
  const output = compatibility.adaptMarketIntelligenceThesisReference(input);
  assert.deepEqual(output.supportingFactIds, ['support-1', 'support-2']);
  assert.deepEqual(output.conflictingFactIds, ['conflict-1']);
  assert.deepEqual(output.unavailableFactIds, ['unavailable-1']);
  assert.deepEqual(output.reasonCodes, [
    'CAPITAL_COMPAT_NEUTRAL_FACT_IDENTITIES_OMITTED',
    'thesis-current',
    'tradeable',
  ]);
  assert.equal(output.tradeability, 'SUPPORTED');
  assert.ok(output.omittedNumericFields.includes('changedAtMs'));
  assert.ok(output.omittedNumericFields.includes('neutral[].observationStartMs'));
  assert.equal(JSON.stringify(output).includes('neutral-1'), false,
    'unrepresentable neutral fact identities must be omitted with a named loss reason');
  assert.equal(JSON.stringify(output).includes(String(NOW - 500)), false,
    'thesis observation timestamps outside truth metadata must be omitted');
});

test('Market Intelligence thesis output is deeply frozen and alias-safe', () => {
  const input = {
    id: 'thesis-alias', instrumentId: 'instrument-1', hypothesis: 'UNCLASSIFIED_ANOMALY',
    stage: 'UNCLASSIFIED', leadMarket: 'UNKNOWN', supporting: [thesisFact('support-1')],
    conflicting: [], neutral: [], unavailable: [], reasonCodes: ['initial'],
    tradeability: { state: 'UNKNOWN', reasonCodes: ['not-enough-evidence'] },
    truth: intelligenceTruth(),
  };
  const output = compatibility.adaptMarketIntelligenceThesisReference(input);
  input.supporting.push(thesisFact('late-support'));
  input.reasonCodes.push('late-reason');
  input.truth.provenance.transforms.push('late-transform');
  assert.deepEqual(output.supportingFactIds, ['support-1']);
  assert.deepEqual(output.reasonCodes, ['initial', 'not-enough-evidence']);
  assert.deepEqual(output.truth.provenance.transforms, ['normalize']);
  assert.ok(Object.isFrozen(output));
  assert.ok(Object.isFrozen(output.supportingFactIds));
  assert.ok(Object.isFrozen(output.truth.provenance.transforms));
});

test('Market Intelligence thesis rejects hostile leadership and tradeability vocabulary', () => {
  const base = {
    id: 'thesis-hostile', instrumentId: 'instrument-1', hypothesis: 'UNCLASSIFIED_ANOMALY',
    stage: 'UNCLASSIFIED', leadMarket: 'UNKNOWN', supporting: [], conflicting: [],
    neutral: [], unavailable: [], reasonCodes: [], tradeability: { state: 'UNKNOWN', reasonCodes: [] },
    truth: intelligenceTruth(),
  };
  assert.throws(() => compatibility.adaptMarketIntelligenceThesisReference({
    ...base,
    leadMarket: 'EXCHANGE_GUESSED',
  }), /invalid leadership or tradeability/);
  assert.throws(() => compatibility.adaptMarketIntelligenceThesisReference({
    ...base,
    tradeability: { state: 'EXECUTABLE', reasonCodes: [] },
  }), /invalid leadership or tradeability/);
});
