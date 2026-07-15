import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  comparePlanFrames,
  compileCampaign,
  materializePlanWindow,
  validateCorpus,
} from '../../fixtures/replayShadow/harness.mjs';

const corpus = JSON.parse(readFileSync(
  new URL('../../fixtures/replayShadow/corpus.v1.json', import.meta.url),
  'utf8',
));

function dataset(draft, datasetId) {
  const found = draft.datasets.find((row) => row.datasetId === datasetId);
  assert.ok(found, `missing ${datasetId}`);
  return found;
}

function corpusCase(name, mutate, expected) {
  test(`corpus rejects ${name}`, () => {
    const draft = structuredClone(corpus);
    mutate(draft);
    assert.throws(() => validateCorpus(draft), expected);
  });
}

corpusCase(
  'a non-shadow disposition',
  (draft) => { draft.disposition = 'SYNTHETIC_ONLY'; },
  /DISPOSITION_INVALID:\$\.disposition/,
);

corpusCase(
  'candidate binding',
  (draft) => { draft.candidateBinding = 'candidate-a'; },
  /CANDIDATE_BINDING_FORBIDDEN:\$\.candidateBinding/,
);

corpusCase(
  'enabled heavy execution',
  (draft) => { draft.heavyExecution = 'LOCAL_RUN'; },
  /HEAVY_EXECUTION_MUST_REMAIN_DEFERRED:\$\.heavyExecution/,
);

corpusCase(
  'a candidate-result fact key',
  (draft) => { draft.datasets[0].eventTape[0].facts.candidateCommit = 'candidate-a'; },
  /CANDIDATE_RESULT_KEY_FORBIDDEN:\$\.datasets\[0\]\.eventTape\[0\]\.facts\.candidateCommit/,
);

corpusCase(
  'a disguised expected-result fact key',
  (draft) => { draft.datasets[0].eventTape[0].facts.expectedLatencyMs = 10; },
  /CANDIDATE_RESULT_KEY_FORBIDDEN:.*expectedLatencyMs/,
);

corpusCase(
  'a result value',
  (draft) => { draft.datasets[0].eventTape[0].facts.sourceRef = 'success'; },
  /CANDIDATE_RESULT_VALUE_FORBIDDEN:.*sourceRef/,
);

corpusCase(
  'a commit-like identity',
  (draft) => { draft.datasets[0].eventTape[0].facts.sourceRef = 'a'.repeat(40); },
  /CANDIDATE_IDENTITY_FORBIDDEN:.*sourceRef/,
);

corpusCase(
  'a short commit-like identity',
  (draft) => { dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.sourceRef = '098f7b9'; },
  /CANDIDATE_IDENTITY_FORBIDDEN:.*sourceRef/,
);

corpusCase(
  'a prose candidate outcome assertion',
  (draft) => { dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.sourceRef = 'candidate passed'; },
  /CANDIDATE_ASSERTION_FORBIDDEN:.*sourceRef/,
);

corpusCase(
  'an unsupported event type',
  (draft) => { draft.datasets[0].eventTape[0].type = 'UNSUPPORTED_EVENT'; },
  /EVENT_TYPE_UNSUPPORTED:\$\.datasets\[0\]\.eventTape\[0\]\.type/,
);

corpusCase(
  'an open event-fact shape',
  (draft) => { delete dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.maxAgeMs; },
  /EXACT_KEYS_REQUIRED:.*eventTape\[0\]\.facts/,
);

corpusCase(
  'an event-fact accessor',
  (draft) => {
    Object.defineProperty(draft.datasets[0].eventTape[0].facts, 'sourceRef', {
      configurable: true,
      enumerable: true,
      get() { return 'synthetic.source.alpha'; },
    });
  },
  /ACCESSOR_FORBIDDEN:.*sourceRef/,
);

corpusCase(
  'an unsafe numeric observation',
  (draft) => { dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.sourceTimeMs = 1.5; },
  /UNSAFE_NUMBER_FORBIDDEN:.*sourceTimeMs/,
);

corpusCase(
  'a boolean in an integer event fact',
  (draft) => { dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.sourceTimeMs = true; },
  /BOUNDED_SAFE_INTEGER_REQUIRED:.*sourceTimeMs/,
);

corpusCase(
  'a nested candidate binding',
  (draft) => { dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.sourceRef = { candidateBinding: 'candidate-a' }; },
  /CANDIDATE_RESULT_KEY_FORBIDDEN:.*candidateBinding/,
);

corpusCase(
  'a sparse event tape',
  (draft) => { draft.datasets[0].eventTape = new Array(1); },
  /SPARSE_ARRAY_FORBIDDEN:\$\.datasets\[0\]\.eventTape\[0\]/,
);

corpusCase(
  'non-monotone event offsets',
  (draft) => { dataset(draft, 'RS-DATA-STALE-001').eventTape[2].atOffsetMs = 5; },
  /EVENT_OFFSETS_NOT_MONOTONE:.*eventTape\[2\]\.atOffsetMs/,
);

corpusCase(
  'duplicate dataset identity',
  (draft) => { draft.datasets[1].datasetId = draft.datasets[0].datasetId; },
  /DUPLICATE_ID:\$\.datasets\[1\]\.datasetId/,
);

corpusCase(
  'a missing campaign dataset reference',
  (draft) => { draft.campaigns[0].datasetIds[0] = 'RS-DATA-MISSING-001'; },
  /REFERENCE_NOT_FOUND:\$\.campaigns\[0\]\.datasetIds\[0\]/,
);

corpusCase(
  'overlapping load phases',
  (draft) => { draft.campaigns[1].schedule.phases[1].startOffsetMs = 59999; },
  /PHASES_OVERLAP:\$\.campaigns\[1\]\.schedule\.phases\[1\]\.startOffsetMs/,
);

corpusCase(
  'a gap between load phases',
  (draft) => { draft.campaigns[1].schedule.phases[1].startOffsetMs = 60001; },
  /PHASE_TIMELINE_GAP:\$\.campaigns\[1\]\.schedule\.phases\[1\]\.startOffsetMs/,
);

corpusCase(
  'in-flight work above subject count',
  (draft) => { draft.campaigns[1].schedule.phases[1].maxInFlight = 33; },
  /MAX_IN_FLIGHT_EXCEEDS_SUBJECTS:\$\.campaigns\[1\]\.schedule\.phases\[1\]\.maxInFlight/,
);

corpusCase(
  'a non-ordered fault schedule',
  (draft) => { draft.campaigns[3].schedule.phases[0].faultSchedule[1].atIteration = 128; },
  /FAULT_SCHEDULE_NOT_STRICTLY_ORDERED:.*faultSchedule\[1\]\.atIteration/,
);

corpusCase(
  'an executable iteration unit',
  (draft) => { draft.campaigns[0].schedule.iterationUnit = 'NETWORK_REQUEST'; },
  /ITERATION_UNIT_INVALID:\$\.campaigns\[0\]\.schedule\.iterationUnit/,
);

corpusCase(
  'missing declared coverage',
  (draft) => {
    draft.datasets.find((row) => row.datasetId === 'RS-DATA-TRUNCATION-001').coverage = ['REPLAY_DATASET'];
    draft.campaigns.find((row) => row.campaignId === 'RS-CAMPAIGN-SOAK-001').coverage = [
      'RESTART_STORM',
      'PARTIAL_FILL_AMBIGUITY',
      'STALE_DATA',
      'CONNECTION_LOSS',
      'RATE_LIMIT',
      'CLOCK_SKEW',
      'RECOVERY_CAMPAIGN',
    ];
  },
  /REQUIRED_COVERAGE_MISSING:\$\.requiredCoverage\.SOAK_DEFINITION/,
);

corpusCase(
  'coverage declared only on an orphan fault reference',
  (draft) => {
    dataset(draft, 'RS-DATA-TRUNCATION-001').coverage = ['REPLAY_DATASET'];
    draft.campaigns.find((row) => row.campaignId === 'RS-CAMPAIGN-SOAK-001').coverage = [
      'RESTART_STORM',
      'PARTIAL_FILL_AMBIGUITY',
      'STALE_DATA',
      'CONNECTION_LOSS',
      'RATE_LIMIT',
      'CLOCK_SKEW',
      'RECOVERY_CAMPAIGN',
    ];
    draft.faultRefs[0].coverage.push('SOAK_DEFINITION');
  },
  /REQUIRED_COVERAGE_NOT_LINKED:\$\.requiredCoverage\.SOAK_DEFINITION/,
);

corpusCase(
  'a reduced hard-law limitation set',
  (draft) => { draft.limitations = ['SYNTHETIC_CORPUS_IS_NOT_PRODUCTION_EVIDENCE']; },
  /BOUNDED_ARRAY_REQUIRED:\$\.limitations/,
);

corpusCase(
  'a source receipt timestamp before source time',
  (draft) => {
    dataset(draft, 'RS-DATA-OUT-OF-ORDER-001').eventTape[1].facts.receivedAtMs = 1900000500201;
  },
  /SOURCE_RECEIPT_PRECEDES_SOURCE:.*receivedAtMs/,
);

corpusCase(
  'partial-fill evidence with a mismatched order identity',
  (draft) => {
    const reports = dataset(draft, 'RS-DATA-PARTIAL-AMBIGUITY-001').eventTape
      .filter((event) => event.type === 'EXECUTION_REPORT_OBSERVED');
    reports.at(-1).facts.symbol = 'OTHERSYNTHUSDT';
  },
  /PARTIAL_FILL_IDENTITY_CORRELATION_INVALID:/,
);

corpusCase(
  'a REST rate fact scoped to the stream budget',
  (draft) => {
    const status = dataset(draft, 'RS-DATA-RATE-LIMIT-001').eventTape
      .find((event) => event.type === 'STATUS_OBSERVED');
    status.facts.protocol = 'WEBSOCKET_STREAM';
    status.facts.budgetRef = 'STREAM_CONTROL_MESSAGES_1S';
  },
  /REST_RATE_SCOPE_MISMATCH:/,
);

corpusCase(
  'a restart terminal observation with a different storm correlation',
  (draft) => {
    dataset(draft, 'RS-DATA-RESTART-STORM-001').eventTape.at(-1).facts.stormCorrelationRef = 'synthetic-restart-storm-b';
  },
  /RESTART_STORM_CORRELATION_INVALID:/,
);

corpusCase(
  'a recovery fact attributed to the wrong canonical owner',
  (draft) => {
    dataset(draft, 'RS-DATA-RECOVERY-001').eventTape[2].facts.evidenceOwner = 'FOUNDATION_CONTROL_OWNER';
  },
  /RECOVERY_EVIDENCE_OWNER_INVALID:.*evidenceOwner/,
);

corpusCase(
  'a declared campaign fault that is not scheduled',
  (draft) => { draft.campaigns[0].schedule.phases[0].faultSchedule = []; },
  /CAMPAIGN_FAULT_UNSCHEDULED:\$\.campaigns\[0\]\.faultRefIds/,
);

corpusCase(
  'a cyclic fixture graph',
  (draft) => {
    const loop = {};
    loop.loop = loop;
    dataset(draft, 'RS-DATA-STALE-001').eventTape[0].facts.sourceRef = loop;
  },
  /JSON_DEPTH_LIMIT_EXCEEDED:/,
);

function planCase(name, mutate, expected) {
  test(`materialization rejects ${name}`, () => {
    const plan = structuredClone(compileCampaign(corpus, 'RS-CAMPAIGN-LOAD-001'));
    mutate(plan);
    assert.throws(() => materializePlanWindow(plan, { startOrdinal: 0, limit: 1 }), expected);
  });
}

planCase(
  'a candidate-specific plan key',
  (plan) => { plan.candidateCommit = 'candidate-a'; },
  /CANDIDATE_RESULT_KEY_FORBIDDEN:\$\.candidateCommit/,
);

planCase(
  'a non-null candidate binding',
  (plan) => { plan.candidateBinding = 'candidate-a'; },
  /CANDIDATE_BINDING_FORBIDDEN:\$\.plan\.candidateBinding/,
);

planCase(
  'an empty phase dataset mix',
  (plan) => { plan.phases[0].datasetMix = []; },
  /BOUNDED_ARRAY_REQUIRED:\$\.plan\.phases\[0\]\.datasetMix/,
);

planCase(
  'an unsupported workload pace',
  (plan) => { plan.phases[0].pace = 'MAX_THROUGHPUT'; },
  /PACE_INVALID:\$\.plan\.phases\[0\]\.pace/,
);

planCase(
  'a gap in compiled ordinals',
  (plan) => { plan.phases[1].startOrdinal += 1; },
  /PLAN_ORDINAL_GAP:\$\.plan\.phases\[1\]\.startOrdinal/,
);

planCase(
  'a gap in the compiled phase timeline',
  (plan) => { plan.phases[1].startOffsetMs += 1; },
  /PHASE_TIMELINE_GAP:\$\.plan\.phases\[1\]\.startOffsetMs/,
);

planCase(
  'a phase iteration-range mismatch',
  (plan) => { plan.phases[0].endOrdinalExclusive -= 1; },
  /PLAN_PHASE_ITERATION_RANGE_INVALID:\$\.plan\.phases\[0\]\.endOrdinalExclusive/,
);

planCase(
  'a fault outside the compiled campaign set',
  (plan) => { plan.phases[1].faultSchedule[0].faultRefId = 'RS-F-MISSING-001'; },
  /FAULT_OUTSIDE_CAMPAIGN_SET:.*faultRefId/,
);

planCase(
  'an accessor inside a compiled phase',
  (plan) => {
    Object.defineProperty(plan.phases[0], 'datasetMix', {
      configurable: true,
      enumerable: true,
      get() { return ['RS-DATA-STALE-001']; },
    });
  },
  /ACCESSOR_FORBIDDEN:.*datasetMix/,
);

test('materialization rejects hostile window options', () => {
  const plan = compileCampaign(corpus, 'RS-CAMPAIGN-LATENCY-001');
  assert.throws(
    () => materializePlanWindow(plan, { startOrdinal: 0, limit: 1, expectedResult: 'PASS' }),
    /CANDIDATE_RESULT_KEY_FORBIDDEN:\$\.expectedResult/,
  );
  assert.throws(
    () => materializePlanWindow(plan, { startOrdinal: -1, limit: 1 }),
    /BOUNDED_SAFE_INTEGER_REQUIRED:\$\.options\.startOrdinal/,
  );
  assert.throws(
    () => materializePlanWindow(plan, { startOrdinal: 0, limit: 1025 }),
    /BOUNDED_SAFE_INTEGER_REQUIRED:\$\.options\.limit/,
  );
});

test('frame comparison rejects open, candidate-specific, and non-contiguous shapes', () => {
  const plan = compileCampaign(corpus, 'RS-CAMPAIGN-LATENCY-001');
  const options = { startOrdinal: 0, limit: 3 };
  const frames = materializePlanWindow(plan, options);

  const open = structuredClone(frames);
  delete open[0].datasetId;
  assert.throws(() => comparePlanFrames(plan, options, frames, open), /EXACT_KEYS_REQUIRED:\$\.rightFrames\[0\]/);

  const candidate = structuredClone(frames);
  candidate[0].expectedResult = 'UNKNOWN';
  assert.throws(() => comparePlanFrames(plan, options, frames, candidate), /CANDIDATE_RESULT_KEY_FORBIDDEN:.*expectedResult/);

  const nonContiguous = structuredClone(frames);
  nonContiguous[1].ordinal += 1;
  assert.throws(() => comparePlanFrames(plan, options, frames, nonContiguous), /FRAME_ORDINALS_NOT_CONTIGUOUS:\$\.rightFrames\[1\]\.ordinal/);
});
