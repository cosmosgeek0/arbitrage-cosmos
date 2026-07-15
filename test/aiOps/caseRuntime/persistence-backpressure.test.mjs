import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendDurableRecord,
  attachCaseProof,
  commitDurableEnvelope as commitDurableEnvelopeRaw,
  createCaseSnapshot,
  createDurableEnvelope,
  createDurableRecord,
  moveRecordToDeadLetter,
  nextCaseGeneration,
  readDurableEnvelope as readDurableEnvelopeRaw,
  recordAttempt,
  recordDurableAttempt,
  recordEffect,
  redriveDeadLetter,
  transitionCase,
} from '../../../server/dist/aiOps/caseRuntime/index.js';
import { shadowSpeculativeId } from '../../../server/dist/aiOps/caseRuntime/support.js';
import { canonicalJson } from '../../../server/dist/foundation/contracts/identity.js';
import { createSyntheticCaseProofAuthority, SyntheticCanonicalPersistencePort } from '../../../fixtures/aiOps/caseRuntime/synthetic-runtime.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const now = 1_700_000_300_000;
const capacity = Object.freeze({ maximumRecords: 37, criticalReserveRecords: 1 });
const persistenceCapacity = Object.freeze({ maximumRecords: 4_096, criticalReserveRecords: 256 });
const persistedCapacities = new Map();
const proofAuthority = createSyntheticCaseProofAuthority();
function evidenceBinding(snapshot, bundleDigest, additionalPointerIds = []) {
  const evidencePointerIds = [...new Set([...snapshot.currentGenerationEvidencePointerIds, ...additionalPointerIds])].sort();
  return Object.freeze({
    pointerSetDigest: sha256(canonicalJson(evidencePointerIds)),
    bindingDigest: sha256(canonicalJson({ evidenceBundleDigest: bundleDigest, evidencePointerIds })),
  });
}
const evidenceBindingReasons = (bundleDigest, binding) => [
  `EVIDENCE_BUNDLE_BOUND:${bundleDigest}`,
  `EVIDENCE_POINTER_SET_BOUND:${binding.pointerSetDigest}`,
];
const withCapacity = (binding, fallback = persistenceCapacity) => Object.freeze({
  ...binding,
  recordCapacity: binding.recordCapacity ?? persistedCapacities.get(binding.configKey) ?? fallback,
});
const commitDurableEnvelope = (binding, expected, envelope, deadline) => {
  const normalized = withCapacity(binding, envelope.recordCapacity);
  persistedCapacities.set(binding.configKey, normalized.recordCapacity);
  return commitDurableEnvelopeRaw(normalized, expected, envelope, deadline, proofAuthority);
};
const readDurableEnvelope = (binding, maximumBytes) => (
  readDurableEnvelopeRaw(withCapacity(binding), proofAuthority, maximumBytes)
);

function record(id, overrides = {}) {
  return createDurableRecord({
    kind: 'INBOX',
    caseId: 'case-persist-1',
    correlationId: `correlation-${id}`,
    idempotencyKey: `idempotency-${id}`,
    payloadDigest: sha256(`payload-${id}`),
    generation: 0,
    attemptNumber: 0,
    parentRecordId: null,
    attemptDisposition: null,
    priority: 'NORMAL',
    state: 'PENDING',
    occurredAtMs: now,
    ...overrides,
  });
}

function resealSnapshot(snapshot, overrides = {}) {
  const { snapshotDigest: _oldDigest, ...core } = { ...snapshot, ...overrides };
  return Object.freeze({ ...core, snapshotDigest: sha256(canonicalJson(core)) });
}

function completeDurableAttempt(
  envelope,
  sourceRecordId,
  outcomeAttemptId,
  disposition,
  startedAtMs,
  recordCapacity,
  maximumAttempts = 8,
  operationClass = 'PROVIDER',
) {
  const started = recordDurableAttempt(
    envelope,
    sourceRecordId,
    `${outcomeAttemptId}-started`,
    'STARTED',
    startedAtMs,
    recordCapacity,
    maximumAttempts,
    operationClass,
  );
  assert.notEqual(started.status, 'BACKPRESSURED');
  const outcome = recordDurableAttempt(
    started.envelope,
    sourceRecordId,
    outcomeAttemptId,
    disposition,
    startedAtMs + 1,
    recordCapacity,
    maximumAttempts,
    operationClass,
  );
  assert.notEqual(outcome.status, 'BACKPRESSURED');
  return outcome.envelope;
}

function escalatedCase(caseId) {
  let snapshot = createCaseSnapshot(caseId, `detect-${caseId}`, now, ['SYNTHETIC_DETECTION'], ['pointer-generation']);
  const step = (commandId, toState, offset, reasonCodes = [`TO_${toState}`]) => {
    const result = transitionCase(snapshot, {
      commandId,
      expectedRevision: snapshot.revision,
      expectedGeneration: snapshot.generation,
      toState,
      occurredAtMs: now + offset,
      reasonCodes,
      evidencePointerIds: [],
    }, proofAuthority);
    assert.equal(result.status, 'COMMITTED', result.reasonCode);
    snapshot = result.snapshot;
  };
  step(`${caseId}-dedup`, 'DEDUPED_OR_SUPPRESSED', 1);
  step(`${caseId}-open`, 'CASE_OPENED', 2);
  const bundleDigest = sha256(`${caseId}-bundle`);
  const frozenEvidence = evidenceBinding(snapshot, bundleDigest);
  snapshot = attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind: 'EVIDENCE_BUNDLE', caseId, generation: 0, artifactId: `${caseId}-bundle`,
    artifactDigest: frozenEvidence.bindingDigest, disposition: 'VALIDATED', recordedAtMs: now + 3,
  }), proofAuthority);
  step(`${caseId}-evidence`, 'EVIDENCE_FROZEN', 3, evidenceBindingReasons(bundleDigest, frozenEvidence));
  step(`${caseId}-quarantine`, 'QUARANTINED', 4);
  step(`${caseId}-owner`, 'OWNER_ATTENTION_REQUIRED', 5);
  step(`${caseId}-escalate`, 'ESCALATED', 6);
  return snapshot;
}

test('logical durable records are bounded and reserve capacity for critical facts', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-1', now, ['SYNTHETIC_DETECTION']);
  let envelope = createDurableEnvelope(snapshot);
  envelope = appendDurableRecord(envelope, record('one'), capacity).envelope;
  envelope = appendDurableRecord(envelope, record('two'), capacity).envelope;
  const refused = appendDurableRecord(envelope, record('three'), capacity);
  assert.equal(refused.status, 'BACKPRESSURED');
  assert.match(refused.resumeCursor, /^a2-resume-cursor:/u);
  assert.equal(refused.envelope.records.length, 2);
  const critical = appendDurableRecord(envelope, record('critical', { priority: 'CRITICAL', kind: 'GLOBAL_EFFECT' }), capacity);
  assert.equal(critical.status, 'APPENDED');
  assert.equal(critical.envelope.records.length, 3);
});

test('record replay is idempotent while same key with changed payload fails closed', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-2', now, ['SYNTHETIC_DETECTION']);
  const envelope = createDurableEnvelope(snapshot);
  const first = record('one');
  const appended = appendDurableRecord(envelope, first, capacity);
  assert.equal(appendDurableRecord(appended.envelope, first, capacity).status, 'IDEMPOTENT');
  const conflict = createDurableRecord({
    kind: first.kind, caseId: first.caseId, correlationId: first.correlationId, idempotencyKey: first.idempotencyKey,
    payloadDigest: sha256('changed'), generation: first.generation, attemptNumber: first.attemptNumber,
    parentRecordId: first.parentRecordId, attemptDisposition: first.attemptDisposition, priority: first.priority,
    state: first.state, occurredAtMs: first.occurredAtMs,
  });
  assert.throws(() => appendDurableRecord(appended.envelope, conflict, capacity), /conflicting content/u);
});

test('durable constructors reject accessor records and hostile array method overrides', () => {
  let getterCalls = 0;
  const accessorInput = {
    kind: 'OUTBOX', caseId: 'case-hostile-constructor', correlationId: 'corr-hostile-constructor',
    idempotencyKey: 'hostile-constructor', payloadDigest: sha256('hostile-constructor'), generation: 0,
    attemptNumber: 0, parentRecordId: null, attemptDisposition: null, priority: 'NORMAL', state: 'PENDING',
  };
  Object.defineProperty(accessorInput, 'occurredAtMs', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return now;
    },
  });
  assert.throws(() => createDurableRecord(accessorInput), /accessor/u);
  assert.equal(getterCalls, 0);

  const snapshot = createCaseSnapshot('case-hostile-constructor', 'detect-hostile-constructor', now, ['SYNTHETIC_DETECTION']);
  const hostileRecords = [record('hostile-array-record', { caseId: snapshot.caseId })];
  Object.defineProperty(hostileRecords, 'filter', {
    value() {
      throw new Error('HOSTILE_FILTER_EXECUTED');
    },
  });
  assert.throws(() => createDurableEnvelope(snapshot, 0, hostileRecords), /custom array fields|unsupported field/u);
});

test('retry attempts advance contiguously, survive resume, and DLQ only after exhaustion', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-3', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  const source = record('poison', { kind: 'OUTBOX' });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'attempt-1', 'FAILED_RETRYABLE', now + 1, large);
  const replayedAttempt = recordDurableAttempt(envelope, source.recordId, 'attempt-1', 'FAILED_RETRYABLE', now + 2, large);
  assert.equal(replayedAttempt.status, 'IDEMPOTENT');
  assert.strictEqual(replayedAttempt.envelope, envelope);
  envelope = completeDurableAttempt(envelope, source.recordId, 'attempt-2', 'FAILED_RETRYABLE', now + 3, large);
  const resumePort = new SyntheticCanonicalPersistencePort(now + 10);
  const resumeBinding = Object.freeze({ posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.retry.checkpoint.v1', eventKind: 'a2.shadow.retry', port: resumePort });
  assert.equal(commitDurableEnvelope(resumeBinding, null, envelope, now + 100).status, 'COMMITTED');
  envelope = readDurableEnvelope(resumeBinding);
  assert.equal(envelope.records.filter((entry) => entry.kind === 'ATTEMPT').length, 4);
  assert.throws(() => moveRecordToDeadLetter(envelope, source.recordId, now + 5, 8, large), /not exhausted/u);
  let expectedSerialized = resumePort.getConfigValue(resumeBinding.configKey);
  for (let attempt = 3; attempt <= 8; attempt += 1) {
    envelope = completeDurableAttempt(envelope, source.recordId, `attempt-${attempt}`, 'FAILED_RETRYABLE', now + (attempt * 2) - 1, large);
    const attemptCommit = commitDurableEnvelope(resumeBinding, expectedSerialized, envelope, now + 100);
    assert.equal(attemptCommit.status, 'COMMITTED');
    expectedSerialized = attemptCommit.serialized;
  }
  const moved = moveRecordToDeadLetter(envelope, source.recordId, now + 17, 8, large);
  assert.equal(moved.status, 'APPENDED');
  assert.equal(commitDurableEnvelope(resumeBinding, expectedSerialized, moved.envelope, now + 100).status, 'COMMITTED');
  const deadLetter = moved.envelope.records.find((entry) => entry.kind === 'DLQ');
  assert.equal(deadLetter.payloadDigest, source.payloadDigest);
  assert.equal(deadLetter.attemptNumber, 8);
  assert.equal(moved.envelope.records.filter((entry) => entry.kind === 'ATTEMPT').length, 16);
  assert.equal(moveRecordToDeadLetter(moved.envelope, source.recordId, now + 18, 8, large).status, 'IDEMPOTENT');
});

test('terminal failure may dead-letter early, and redrive preserves attempt lineage rather than resetting it', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-redrive', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  const source = record('terminal', { kind: 'OUTBOX' });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'terminal-attempt-1', 'FAILED_TERMINAL', now + 1, large);
  assert.throws(() => recordDurableAttempt(envelope, source.recordId, 'terminal-attempt-forged', 'SUCCEEDED', now + 2, large), /terminal or ambiguous outcome/u);
  envelope = moveRecordToDeadLetter(envelope, source.recordId, now + 3, 8, large).envelope;
  const port = new SyntheticCanonicalPersistencePort(now + 10);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.redrive.v1', eventKind: 'a2.shadow.redrive', port };
  const persistedDlq = commitDurableEnvelope(binding, null, envelope, now + 100);
  assert.equal(persistedDlq.status, 'COMMITTED');
  const dlq = envelope.records.find((entry) => entry.kind === 'DLQ');
  const redriven = redriveDeadLetter(envelope, dlq.recordId, 'redrive-authorization-1', now + 4, large);
  assert.equal(redriven.status, 'APPENDED');
  assert.equal(commitDurableEnvelope(binding, persistedDlq.serialized, redriven.envelope, now + 100).status, 'COMMITTED');
  const replay = redriven.envelope.records.find((entry) => entry.parentRecordId === dlq.recordId);
  assert.equal(replay.attemptNumber, 1);
  assert.equal(redriveDeadLetter(redriven.envelope, dlq.recordId, 'redrive-authorization-1', now + 4, large).status, 'IDEMPOTENT');
  assert.throws(() => redriveDeadLetter(redriven.envelope, dlq.recordId, 'redrive-authorization-2', now + 4, large), /already redriven/u);
  const attempted = completeDurableAttempt(redriven.envelope, replay.recordId, 'terminal-attempt-2', 'SUCCEEDED', now + 5, large);
  assert.equal(attempted.records.find((entry) => entry.recordId === replay.recordId).attemptNumber, 1);
  assert.equal(attempted.records.find((entry) => entry.idempotencyKey === 'terminal-attempt-2').attemptNumber, 2);
  assert.throws(() => recordDurableAttempt(redriven.envelope, replay.recordId, 'caller-reselected-policy', 'STARTED', now + 5, large, 1), /fixed shadow retry policy/u);
});

test('retry-exhausted DLQ entries cannot mint a fresh budget through redrive', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-exhausted-redrive', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  const source = record('exhausted-redrive', { kind: 'OUTBOX' });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    envelope = completeDurableAttempt(envelope, source.recordId, `exhausted-redrive-${attempt}`, 'FAILED_RETRYABLE', now + (attempt * 2) - 1, large);
  }
  envelope = moveRecordToDeadLetter(envelope, source.recordId, now + 17, 8, large).envelope;
  const dlq = envelope.records.find((entry) => entry.kind === 'DLQ');
  assert.throws(() => redriveDeadLetter(envelope, dlq.recordId, 'forged-fresh-budget', now + 10, large), /remaining authorized/u);
  assert.throws(() => redriveDeadLetter(envelope, dlq.recordId, 'caller-raised-cap', now + 10, large, 64), /fixed shadow retry policy/u);
});

test('STARTED reserves its outcome and terminal DLQ before work can begin', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-full', now, ['SYNTHETIC_DETECTION']);
  const tight = { maximumRecords: 17, criticalReserveRecords: 1 };
  const source = record('full', { kind: 'OUTBOX' });
  const refusedSource = appendDurableRecord(createDurableEnvelope(snapshot), source, tight);
  assert.equal(refusedSource.status, 'BACKPRESSURED');
  assert.equal(refusedSource.envelope.records.length, 0);

  const viable = { maximumRecords: 19, criticalReserveRecords: 1 };
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, viable).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'full-attempt-1', 'FAILED_TERMINAL', now + 1, viable);
  const result = moveRecordToDeadLetter(envelope, source.recordId, now + 3, 8, viable);
  assert.equal(result.status, 'APPENDED');
  assert.equal(result.envelope.records.length, 4);
});

test('delivery admission reserves retry and DLQ byte headroom before invoking a provider', () => {
  const snapshot = createCaseSnapshot('case-byte-reserve', 'detect-byte-reserve', now, ['SYNTHETIC_DETECTION']);
  const recordCapacity = { maximumRecords: 4_096, criticalReserveRecords: 256 };
  const records = Array.from({ length: 640 }, (_, index) => {
    const suffix = String(index).padStart(4, '0');
    return createDurableRecord({
      kind: 'GLOBAL_EFFECT',
      caseId: snapshot.caseId,
      correlationId: `c${suffix}${'x'.repeat(150)}`.slice(0, 160),
      idempotencyKey: `i${suffix}${'y'.repeat(150)}`.slice(0, 160),
      payloadDigest: sha256(`byte-payload-${suffix}`),
      generation: 0,
      attemptNumber: 0,
      parentRecordId: null,
      attemptDisposition: null,
      priority: 'CRITICAL',
      state: 'PENDING',
      occurredAtMs: now,
    });
  });
  const envelope = createDurableEnvelope(snapshot, 0, records, recordCapacity);
  const source = record('byte-reserve-source', { caseId: snapshot.caseId, kind: 'OUTBOX' });
  const refused = appendDurableRecord(envelope, source, recordCapacity);
  assert.equal(refused.status, 'BACKPRESSURED');
  assert.strictEqual(refused.envelope, envelope);
});

test('checkpoint admission reserves effect UNKNOWN and terminal readback bytes', () => {
  const snapshot = createCaseSnapshot('case-effect-byte-reserve', 'detect-effect-byte-reserve', now, ['SYNTHETIC_DETECTION']);
  const recordCapacity = { maximumRecords: 4_096, criticalReserveRecords: 256 };
  const records = Array.from({ length: 700 }, (_, index) => {
    const suffix = String(index).padStart(4, '0');
    return createDurableRecord({
      kind: 'GLOBAL_EFFECT',
      caseId: snapshot.caseId,
      correlationId: `c${suffix}${'x'.repeat(150)}`.slice(0, 160),
      idempotencyKey: `i${suffix}${'y'.repeat(150)}`.slice(0, 160),
      payloadDigest: sha256(`effect-byte-payload-${suffix}`),
      generation: 0,
      attemptNumber: 0,
      parentRecordId: null,
      attemptDisposition: null,
      priority: 'CRITICAL',
      state: 'PENDING',
      occurredAtMs: now,
    });
  });
  assert.doesNotThrow(() => createDurableEnvelope(snapshot, 0, records, recordCapacity));
  const withIntent = recordEffect(snapshot, {
    effectId: 'effect-byte-reserve', generation: 0, state: 'INTENT',
    payloadDigest: sha256('effect-byte-reserve'), recordedAtMs: now + 1,
  });
  assert.throws(
    () => createDurableEnvelope(withIntent, 0, records, recordCapacity),
    /strands reserved completion bytes/u,
  );
});

test('generation rollover requires a durable dead-letter closure for a terminal outcome', () => {
  const snapshot = escalatedCase('case-terminal-rollover');
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  const source = record('terminal-rollover', { caseId: snapshot.caseId, kind: 'OUTBOX', occurredAtMs: now + 6 });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'terminal-rollover-attempt', 'FAILED_TERMINAL', now + 7, large);
  assert.throws(() => nextCaseGeneration(envelope.caseSnapshot, 'terminal-rollover-generation', now + 9), /cannot strand unresolved/u);
  envelope = moveRecordToDeadLetter(envelope, source.recordId, now + 9, 8, large).envelope;
  const rolled = nextCaseGeneration(envelope.caseSnapshot, 'terminal-rollover-generation', now + 10);
  assert.doesNotThrow(() => createDurableEnvelope(rolled, envelope.revision, envelope.records, envelope.recordCapacity));
});

test('cross-case and stale-generation records are refused', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-isolation', now, ['SYNTHETIC_DETECTION']);
  const envelope = createDurableEnvelope(snapshot);
  assert.throws(() => appendDurableRecord(envelope, record('cross', { caseId: 'other-case' }), capacity), /different case/u);
  assert.throws(() => appendDurableRecord(envelope, record('stale', { generation: 1 }), capacity), /stale generation/u);
});

test('delivery attempts, dead-letter moves, and redrives are fenced to the current case generation', () => {
  let snapshot = createCaseSnapshot('case-generation-fence', 'detect-generation-fence', now, ['SYNTHETIC_DETECTION'], ['pointer-generation']);
  const step = (id, toState, offset, reasonCodes = [`TO_${toState}`]) => {
    const result = transitionCase(snapshot, {
      commandId: id, expectedRevision: snapshot.revision, expectedGeneration: snapshot.generation,
      toState, occurredAtMs: now + offset, reasonCodes, evidencePointerIds: [],
    }, proofAuthority);
    assert.equal(result.status, 'COMMITTED', result.reasonCode);
    snapshot = result.snapshot;
  };
  step('generation-dedup', 'DEDUPED_OR_SUPPRESSED', 1);
  step('generation-open', 'CASE_OPENED', 2);
  const bundleDigest = sha256('generation-fence-bundle');
  const frozenEvidence = evidenceBinding(snapshot, bundleDigest);
  snapshot = attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind: 'EVIDENCE_BUNDLE', caseId: snapshot.caseId, generation: 0, artifactId: 'generation-fence-bundle',
    artifactDigest: frozenEvidence.bindingDigest, disposition: 'VALIDATED', recordedAtMs: now + 3,
  }), proofAuthority);
  step('generation-evidence', 'EVIDENCE_FROZEN', 3, evidenceBindingReasons(bundleDigest, frozenEvidence));
  step('generation-quarantine', 'QUARANTINED', 4);
  step('generation-owner', 'OWNER_ATTENTION_REQUIRED', 5);
  step('generation-escalate', 'ESCALATED', 6);
  const oldSource = record('old-generation', { caseId: snapshot.caseId, kind: 'OUTBOX', generation: 0, occurredAtMs: now + 6 });
  const generationCapacity = { maximumRecords: 32, criticalReserveRecords: 2 };
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), oldSource, generationCapacity).envelope;
  envelope = completeDurableAttempt(envelope, oldSource.recordId, 'old-generation-success', 'SUCCEEDED', now + 7, generationCapacity);
  snapshot = envelope.caseSnapshot;
  snapshot = nextCaseGeneration(snapshot, 'generation-rollover', now + 9);
  envelope = createDurableEnvelope(snapshot, envelope.revision, envelope.records, envelope.recordCapacity);
  assert.throws(() => recordDurableAttempt(envelope, oldSource.recordId, 'stale-attempt', 'STARTED', now + 10, generationCapacity), /stale generation/u);
  assert.throws(() => moveRecordToDeadLetter(envelope, oldSource.recordId, now + 10, 8, generationCapacity), /stale generation/u);
});

test('synthetic structural adapter commits one bounded CAS and resumes byte-stable state', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-4', now, ['SYNTHETIC_DETECTION']);
  const envelope = createDurableEnvelope(snapshot);
  const port = new SyntheticCanonicalPersistencePort(now + 10);
  const binding = Object.freeze({ posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.synthetic.checkpoint.v1', eventKind: 'a2.shadow.synthetic', port });
  const committed = commitDurableEnvelope(binding, null, envelope, now + 100);
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(port.events().length, 1);
  assert.deepEqual(readDurableEnvelope(binding), envelope);
  assert.equal(commitDurableEnvelope(binding, null, envelope, now + 100).status, 'VERSION_CONFLICT');
});

test('CAS replacement proves monotonic envelope and snapshot heads', () => {
  const initial = createCaseSnapshot('case-monotonic-cas', 'detect-monotonic-cas', now, ['SYNTHETIC_DETECTION']);
  const advancedResult = transitionCase(initial, {
    commandId: 'monotonic-dedup', expectedRevision: 0, expectedGeneration: 0, toState: 'DEDUPED_OR_SUPPRESSED',
    occurredAtMs: now + 1, reasonCodes: ['DEDUP_PROJECTED'], evidencePointerIds: [],
  });
  assert.equal(advancedResult.status, 'COMMITTED');
  const initialEnvelope = createDurableEnvelope(initial, 0);
  const current = createDurableEnvelope(advancedResult.snapshot, 1);
  const port = new SyntheticCanonicalPersistencePort(now + 10);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.monotonic.v1', eventKind: 'a2.shadow.monotonic', port };
  const first = commitDurableEnvelope(binding, null, initialEnvelope, now + 100);
  assert.equal(first.status, 'COMMITTED');
  const second = commitDurableEnvelope(binding, first.serialized, current, now + 100);
  assert.equal(second.status, 'COMMITTED');
  const staleReplacement = createDurableEnvelope(initial, 2);
  assert.throws(() => commitDurableEnvelope(binding, second.serialized, staleReplacement, now + 100), /stale or non-monotonic/u);
  assert.equal(port.events().length, 2);
});

test('canonical persistence rejects constructed guarded snapshots and replays successor guardrails', () => {
  let snapshot = createCaseSnapshot('case-guarded-cas', 'detect-guarded-cas', now, ['SYNTHETIC_DETECTION'], ['pointer-guarded']);
  const port = new SyntheticCanonicalPersistencePort(now + 20);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.guarded-cas.v1', eventKind: 'a2.shadow.guarded', port };
  let envelope = createDurableEnvelope(snapshot);
  let persisted = commitDurableEnvelope(binding, null, envelope, now + 100);
  assert.equal(persisted.status, 'COMMITTED');
  for (const [commandId, toState, offset] of [
    ['guarded-dedup', 'DEDUPED_OR_SUPPRESSED', 1],
    ['guarded-open', 'CASE_OPENED', 2],
  ]) {
    const result = transitionCase(snapshot, {
      commandId,
      expectedRevision: snapshot.revision,
      expectedGeneration: snapshot.generation,
      toState,
      occurredAtMs: now + offset,
      reasonCodes: [`TO_${toState}`],
      evidencePointerIds: [],
    }, proofAuthority);
    assert.equal(result.status, 'COMMITTED');
    snapshot = result.snapshot;
    envelope = createDurableEnvelope(snapshot, envelope.revision + 1);
    persisted = commitDurableEnvelope(binding, persisted.serialized, envelope, now + 100);
    assert.equal(persisted.status, 'COMMITTED');
  }
  const bundleDigest = sha256('guarded-cas-bundle');
  const frozenEvidence = evidenceBinding(snapshot, bundleDigest);
  const withProof = attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind: 'EVIDENCE_BUNDLE',
    caseId: snapshot.caseId,
    generation: snapshot.generation,
    artifactId: 'guarded-cas-bundle',
    artifactDigest: frozenEvidence.bindingDigest,
    disposition: 'VALIDATED',
    recordedAtMs: now + 3,
  }), proofAuthority);
  const legal = transitionCase(withProof, {
    commandId: 'guarded-evidence',
    expectedRevision: withProof.revision,
    expectedGeneration: withProof.generation,
    toState: 'EVIDENCE_FROZEN',
    occurredAtMs: now + 3,
    reasonCodes: evidenceBindingReasons(bundleDigest, frozenEvidence),
    evidencePointerIds: [],
  }, proofAuthority);
  assert.equal(legal.status, 'COMMITTED');
  const forged = resealSnapshot(legal.snapshot, { proofs: [] });
  const forgedEnvelope = createDurableEnvelope(forged, envelope.revision + 1);
  assert.throws(
    () => commitDurableEnvelope(binding, persisted.serialized, forgedEnvelope, now + 100),
    /successor guard replay failed/u,
  );
  assert.throws(() => commitDurableEnvelope({
    ...binding,
    configKey: 'a2.shadow.forged-initial.v1',
    port: new SyntheticCanonicalPersistencePort(now + 20),
  }, null, createDurableEnvelope(legal.snapshot), now + 100), /genuine initial case snapshot/u);
});

test('CAS replacement retains exact event and auxiliary-ledger lineage', () => {
  const payloadDigest = sha256('auxiliary-lineage-payload');
  let snapshot = createCaseSnapshot('case-auxiliary-cas', 'detect-auxiliary-cas', now, ['SYNTHETIC_DETECTION']);
  const source = record('auxiliary-source', { caseId: snapshot.caseId, kind: 'OUTBOX', payloadDigest });
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'auxiliary-attempt', 'SUCCEEDED', now + 1, large);
  snapshot = envelope.caseSnapshot;
  const port = new SyntheticCanonicalPersistencePort(now + 10);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.auxiliary-lineage.v1', eventKind: 'a2.shadow.auxiliary', port };
  const first = commitDurableEnvelope(binding, null, envelope, now + 100);
  assert.equal(first.status, 'COMMITTED');
  const droppedAuxiliary = createDurableEnvelope(
    createCaseSnapshot(snapshot.caseId, 'detect-auxiliary-cas', now, ['SYNTHETIC_DETECTION']),
    envelope.revision + 1,
    envelope.records,
    envelope.recordCapacity,
  );
  assert.throws(() => commitDurableEnvelope(binding, first.serialized, droppedAuxiliary, now + 100), /attempt.*(?:dropped|owner)/u);

  const cleanPort = new SyntheticCanonicalPersistencePort(now + 10);
  const cleanBinding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.event-lineage.v1', eventKind: 'a2.shadow.event', port: cleanPort };
  const canonical = createDurableEnvelope(createCaseSnapshot('case-event-lineage', 'detect-event-a', now, ['EVENT_A']));
  const canonicalCommit = commitDurableEnvelope(cleanBinding, null, canonical, now + 100);
  const alternate = createDurableEnvelope(createCaseSnapshot('case-event-lineage', 'detect-event-b', now, ['EVENT_B']), 1);
  assert.throws(() => commitDurableEnvelope(cleanBinding, canonicalCommit.serialized, alternate, now + 100), /head changed without an event revision/u);
});

test('resumed envelopes reject impossible attempt histories', () => {
  const snapshot = createCaseSnapshot('case-impossible-attempts', 'detect-impossible-attempts', now, ['SYNTHETIC_DETECTION']);
  const source = record('impossible-source', { caseId: snapshot.caseId, kind: 'OUTBOX' });
  const attempt = (id, number, disposition, occurredAtMs) => createDurableRecord({
    kind: 'ATTEMPT', caseId: source.caseId, correlationId: source.correlationId, idempotencyKey: id,
    payloadDigest: sha256(canonicalJson({
      sourceRecordId: source.recordId,
      sourcePayloadDigest: source.payloadDigest,
      attemptNumber: number,
      disposition,
      operationClass: 'PROVIDER',
    })),
    generation: 0, attemptNumber: number, parentRecordId: source.recordId, attemptDisposition: disposition,
    operationClass: 'PROVIDER', priority: 'CRITICAL', state: 'DELIVERED', occurredAtMs,
  });
  const started = attempt('impossible-started', 1, 'STARTED', now + 1);
  const terminal = attempt('impossible-terminal', 1, 'FAILED_TERMINAL', now + 2);
  const afterTerminal = attempt('impossible-after-terminal', 2, 'STARTED', now + 3);
  assert.throws(() => createDurableEnvelope(snapshot, 0, [source, started, terminal, afterTerminal]), /continues after a terminal/u);
  const laterFirst = attempt('impossible-later-first', 1, 'FAILED_RETRYABLE', now + 3);
  const timeRegression = attempt('impossible-time-regression', 2, 'STARTED', now + 2);
  assert.throws(() => createDurableEnvelope(snapshot, 0, [source, started, laterFirst, timeRegression]), /does not preserve source lineage/u);
});

test('resume rejects effect-parent attempts, cross-kind redrives, and attempt lineages beyond the fixed policy', () => {
  const snapshot = createCaseSnapshot('case-hostile-resume', 'detect-hostile-resume', now, ['SYNTHETIC_DETECTION']);
  const effect = record('hostile-effect-parent', {
    caseId: snapshot.caseId,
    kind: 'GLOBAL_EFFECT',
    priority: 'CRITICAL',
  });
  const effectAttempt = createDurableRecord({
    kind: 'ATTEMPT',
    caseId: snapshot.caseId,
    correlationId: effect.correlationId,
    idempotencyKey: 'hostile-effect-attempt',
    payloadDigest: sha256('hostile-effect-attempt'),
    generation: 0,
    attemptNumber: 1,
    parentRecordId: effect.recordId,
    attemptDisposition: 'SUCCEEDED',
    operationClass: 'GLOBAL_EFFECT',
    priority: 'CRITICAL',
    state: 'DELIVERED',
    occurredAtMs: now + 1,
  });
  assert.throws(() => createDurableEnvelope(snapshot, 0, [effect, effectAttempt]), /attempt parent kind/u);

  const source = record('hostile-redrive', { caseId: snapshot.caseId, kind: 'OUTBOX' });
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'hostile-terminal', 'FAILED_TERMINAL', now + 1, large);
  envelope = moveRecordToDeadLetter(envelope, source.recordId, now + 3, 8, large).envelope;
  const deadLetter = envelope.records.find((entry) => entry.kind === 'DLQ');
  const crossKindChild = createDurableRecord({
    kind: 'CASE',
    caseId: snapshot.caseId,
    correlationId: source.correlationId,
    idempotencyKey: 'hostile-cross-kind-redrive',
    payloadDigest: source.payloadDigest,
    generation: 0,
    attemptNumber: deadLetter.attemptNumber,
    parentRecordId: deadLetter.recordId,
    attemptDisposition: null,
    priority: source.priority,
    state: 'PENDING',
    occurredAtMs: now + 4,
  });
  assert.throws(
    () => createDurableEnvelope(snapshot, envelope.revision, [...envelope.records, crossKindChild]),
    /redrive does not preserve source lineage/u,
  );

  let exhausted = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    exhausted = completeDurableAttempt(exhausted, source.recordId, `hostile-cap-${attempt}`, 'FAILED_RETRYABLE', now + (attempt * 2) - 1, large);
  }
  const ninth = createDurableRecord({
    kind: 'ATTEMPT',
    caseId: snapshot.caseId,
    correlationId: source.correlationId,
    idempotencyKey: 'hostile-cap-9',
    payloadDigest: sha256(canonicalJson({
      sourceRecordId: source.recordId,
      sourcePayloadDigest: source.payloadDigest,
      attemptNumber: 9,
      disposition: 'STARTED',
      operationClass: 'PROVIDER',
    })),
    generation: 0,
    attemptNumber: 9,
    parentRecordId: source.recordId,
    attemptDisposition: 'STARTED',
    operationClass: 'PROVIDER',
    priority: 'CRITICAL',
    state: 'DELIVERED',
    occurredAtMs: now + 17,
  });
  assert.throws(
    () => createDurableEnvelope(snapshot, exhausted.revision, [...exhausted.records, ninth]),
    /fixed shadow retry policy/u,
  );
});

test('canonical replacement cannot reorder the append-only durable record ledger', () => {
  const snapshot = createCaseSnapshot('case-record-order', 'detect-record-order', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 64, criticalReserveRecords: 2 };
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), record('order-a', { caseId: snapshot.caseId }), large).envelope;
  envelope = appendDurableRecord(envelope, record('order-b', { caseId: snapshot.caseId }), large).envelope;
  const port = new SyntheticCanonicalPersistencePort(now + 20);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.record-order.v1', eventKind: 'a2.shadow.record-order', port };
  const first = commitDurableEnvelope(binding, null, envelope, now + 100);
  assert.equal(first.status, 'COMMITTED');
  const reordered = createDurableEnvelope(snapshot, envelope.revision + 1, [...envelope.records].reverse(), envelope.recordCapacity);
  assert.throws(() => commitDurableEnvelope(binding, first.serialized, reordered, now + 100), /durable record ledger rewrote prior lineage/u);
});

test('workflow attempt numbering remains independent across durable source records', () => {
  const payloadA = sha256('source-a-payload');
  const payloadB = sha256('source-b-payload');
  let snapshot = createCaseSnapshot('case-independent-attempts', 'detect-independent-attempts', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 64, criticalReserveRecords: 2 };
  const sourceA = record('independent-a', { caseId: snapshot.caseId, kind: 'OUTBOX', payloadDigest: payloadA });
  const sourceB = record('independent-b', { caseId: snapshot.caseId, kind: 'OUTBOX', payloadDigest: payloadB });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), sourceA, large).envelope;
  envelope = appendDurableRecord(envelope, sourceB, large).envelope;
  envelope = completeDurableAttempt(envelope, sourceA.recordId, 'workflow-attempt-a', 'SUCCEEDED', now + 1, large, 8, 'PROVIDER');
  envelope = completeDurableAttempt(envelope, sourceB.recordId, 'workflow-attempt-b', 'SUCCEEDED', now + 3, large, 8, 'EVIDENCE_READ');
  const result = commitDurableEnvelope({
    posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.independent-attempts.v1', eventKind: 'a2.shadow.independent',
    port: new SyntheticCanonicalPersistencePort(now + 10),
  }, null, envelope, now + 100);
  assert.equal(result.status, 'COMMITTED');
  assert.deepEqual(
    envelope.records.filter((entry) => entry.kind === 'ATTEMPT' && entry.attemptDisposition !== 'STARTED').map((entry) => entry.attemptNumber),
    [1, 1],
  );
});

test('canonical commit reconciles workflow attempts and global-effect intents to durable adapter records', () => {
  const payloadDigest = sha256('reconciled-payload');
  let snapshot = createCaseSnapshot('case-reconciled-ledgers', 'detect-reconciled-ledgers', now, ['SYNTHETIC_DETECTION']);
  const source = record('reconciled-source', { caseId: snapshot.caseId, kind: 'OUTBOX', payloadDigest });
  snapshot = recordAttempt(snapshot, {
    attemptId: 'reconciled-attempt-started', sourceRecordId: source.recordId, attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'STARTED', recordedAtMs: now + 1, payloadDigest,
  });
  snapshot = recordAttempt(snapshot, {
    attemptId: 'reconciled-attempt', sourceRecordId: source.recordId, attemptBaseline: 0, operationClass: 'PROVIDER', generation: 0, attemptNumber: 1,
    disposition: 'SUCCEEDED', recordedAtMs: now + 2, payloadDigest,
  });
  const unreconciledPort = new SyntheticCanonicalPersistencePort(now + 10);
  const unreconciledBinding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.unreconciled.v1', eventKind: 'a2.shadow.unreconciled', port: unreconciledPort };
  assert.throws(() => commitDurableEnvelope(unreconciledBinding, null, createDurableEnvelope(snapshot), now + 100), /not reconciled/u);
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = recordDurableAttempt(envelope, source.recordId, 'reconciled-attempt-started', 'STARTED', now + 1, large).envelope;
  envelope = recordDurableAttempt(envelope, source.recordId, 'reconciled-attempt', 'SUCCEEDED', now + 2, large).envelope;
  snapshot = envelope.caseSnapshot;
  snapshot = recordEffect(snapshot, {
    effectId: 'reconciled-effect', generation: 0, state: 'INTENT', payloadDigest: sha256('reconciled-effect'), recordedAtMs: now + 3,
  });
  envelope = createDurableEnvelope(snapshot, envelope.revision, envelope.records, envelope.recordCapacity);
  const effectRecord = createDurableRecord({
    kind: 'GLOBAL_EFFECT', caseId: snapshot.caseId, correlationId: 'correlation-reconciled-effect',
    idempotencyKey: 'reconciled-effect', payloadDigest: sha256('reconciled-effect'), generation: 0,
    attemptNumber: 0, parentRecordId: null, attemptDisposition: null, priority: 'CRITICAL', state: 'PENDING', occurredAtMs: now + 3,
  });
  envelope = appendDurableRecord(envelope, effectRecord, large).envelope;
  const port = new SyntheticCanonicalPersistencePort(now + 10);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.reconciled.v1', eventKind: 'a2.shadow.reconciled', port };
  assert.equal(commitDurableEnvelope(binding, null, envelope, now + 100).status, 'COMMITTED');
  assert.deepEqual(readDurableEnvelope(binding), envelope);
});

test('corrupt envelope digest is refused before any synthetic persistence write', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-corrupt', now, ['SYNTHETIC_DETECTION']);
  const envelope = createDurableEnvelope(snapshot);
  const port = new SyntheticCanonicalPersistencePort(now + 10);
  const binding = { posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.synthetic.checkpoint.v1', eventKind: 'a2.shadow.synthetic', port };
  assert.throws(() => commitDurableEnvelope(binding, null, { ...envelope, envelopeDigest: '0'.repeat(64) }, now + 100), /digest mismatch/u);
  assert.equal(port.events().length, 0);
  assert.equal(port.getConfigValue(), null);
});

test('missing canonical binding and expired commit deadline are honest failures', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-5', now, ['SYNTHETIC_DETECTION']);
  const envelope = createDurableEnvelope(snapshot);
  const unavailable = commitDurableEnvelope({
    posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.synthetic.checkpoint.v1', eventKind: 'a2.shadow.synthetic', port: { getConfigValue: () => null },
  }, null, envelope, now + 100);
  assert.equal(unavailable.status, 'BINDING_UNAVAILABLE');
  const deadline = commitDurableEnvelope({
    posture: 'SYNTHETIC_ONLY', configKey: 'a2.shadow.synthetic.checkpoint.v1', eventKind: 'a2.shadow.synthetic', port: new SyntheticCanonicalPersistencePort(now + 10),
  }, null, envelope, now + 10);
  assert.equal(deadline.status, 'DEADLINE_EXCEEDED');
});

test('adapter records global-effect intent only; no delivery or applied claim exists', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-6', now, ['SYNTHETIC_DETECTION']);
  const intent = record('effect', { kind: 'GLOBAL_EFFECT', priority: 'CRITICAL', state: 'PENDING' });
  const appended = appendDurableRecord(createDurableEnvelope(snapshot), intent, capacity);
  assert.equal(appended.envelope.records[0].kind, 'GLOBAL_EFFECT');
  assert.equal(appended.envelope.records[0].state, 'PENDING');
  assert.equal('dispatch' in appended.envelope.records[0], false);
  assert.throws(() => recordDurableAttempt(appended.envelope, intent.recordId, 'effect-delivery-forged', 'SUCCEEDED', now + 1, capacity), /effect-authority/u);
  assert.throws(() => createDurableRecord({
    ...intent,
    state: 'DELIVERED',
  }), /intent-only/u);
  assert.throws(() => appendDurableRecord(createDurableEnvelope(snapshot), createDurableRecord({
    ...intent,
    kind: 'DLQ',
    state: 'DEAD_LETTERED',
    parentRecordId: intent.recordId,
    idempotencyKey: 'forged-dlq',
  }), capacity), /dedicated adapters/u);
});

test('fixed retry policy is enforced while attempts are recorded and cannot be caller-reselected', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-persist-retry-cap', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 32, criticalReserveRecords: 2 };
  const source = record('retry-cap', { kind: 'OUTBOX' });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'retry-cap-1', 'FAILED_RETRYABLE', now + 1, large);
  assert.throws(() => recordDurableAttempt(envelope, source.recordId, 'caller-cap-1', 'STARTED', now + 3, large, 1), /fixed shadow retry policy/u);
  for (let attempt = 2; attempt <= 8; attempt += 1) {
    envelope = completeDurableAttempt(envelope, source.recordId, `retry-cap-${attempt}`, 'FAILED_RETRYABLE', now + (attempt * 2) - 1, large);
  }
  assert.throws(() => recordDurableAttempt(envelope, source.recordId, 'retry-cap-9', 'STARTED', now + 17, large), /attempt budget exhausted/u);
});

test('structural resume rejects premature DLQ, impossible redrive, and child-before-parent histories', () => {
  const snapshot = createCaseSnapshot('case-persist-1', 'detect-structural-parity', now, ['SYNTHETIC_DETECTION']);
  const large = { maximumRecords: 64, criticalReserveRecords: 2 };
  const source = record('structural-parity', { kind: 'OUTBOX' });
  let envelope = appendDurableRecord(createDurableEnvelope(snapshot), source, large).envelope;
  envelope = completeDurableAttempt(envelope, source.recordId, 'structural-attempt-1', 'FAILED_RETRYABLE', now + 1, large);
  const lastAttempt = envelope.records.filter((entry) => entry.kind === 'ATTEMPT').at(-1);
  const prematureDlq = createDurableRecord({
    kind: 'DLQ',
    caseId: source.caseId,
    correlationId: source.correlationId,
    idempotencyKey: shadowSpeculativeId('a2-dlq-key', {
      sourceRecordId: source.recordId,
      sourceIdempotencyKey: source.idempotencyKey,
    }),
    payloadDigest: source.payloadDigest,
    generation: source.generation,
    attemptNumber: lastAttempt.attemptNumber,
    parentRecordId: source.recordId,
    attemptDisposition: null,
    priority: 'CRITICAL',
    state: 'DEAD_LETTERED',
    occurredAtMs: now + 3,
  });
  assert.throws(
    () => createDurableEnvelope(envelope.caseSnapshot, envelope.revision + 1, [...envelope.records, prematureDlq], large),
    /does not prove source failure lineage/u,
  );

  let ambiguous = appendDurableRecord(createDurableEnvelope(snapshot), record('ambiguous-redrive', { kind: 'OUTBOX' }), large).envelope;
  const ambiguousSource = ambiguous.records[0];
  ambiguous = completeDurableAttempt(ambiguous, ambiguousSource.recordId, 'ambiguous-attempt-1', 'UNKNOWN', now + 10, large);
  ambiguous = moveRecordToDeadLetter(ambiguous, ambiguousSource.recordId, now + 12, 8, large).envelope;
  const dlq = ambiguous.records.find((entry) => entry.kind === 'DLQ');
  const impossibleRedrive = createDurableRecord({
    kind: ambiguousSource.kind,
    caseId: ambiguousSource.caseId,
    correlationId: ambiguousSource.correlationId,
    idempotencyKey: 'ambiguous-redrive-forged',
    payloadDigest: ambiguousSource.payloadDigest,
    generation: ambiguousSource.generation,
    attemptNumber: dlq.attemptNumber,
    parentRecordId: dlq.recordId,
    attemptDisposition: null,
    priority: ambiguousSource.priority,
    state: 'PENDING',
    occurredAtMs: now + 13,
  });
  assert.throws(
    () => createDurableEnvelope(ambiguous.caseSnapshot, ambiguous.revision + 1, [...ambiguous.records, impossibleRedrive], large),
    /redrive does not preserve source lineage/u,
  );
  assert.throws(
    () => createDurableEnvelope(envelope.caseSnapshot, envelope.revision, [...envelope.records].reverse(), large),
    /precedes its parent/u,
  );
});

test('cross-source reservation refuses work before durable bytes or the case attempt ledger can be stranded', () => {
  const snapshot = createCaseSnapshot('case-cross-source-reserve', 'detect-cross-source-reserve', now, ['SYNTHETIC_DETECTION']);
  const ample = { maximumRecords: 4_096, criticalReserveRecords: 1 };
  let envelope = createDurableEnvelope(snapshot, 0, [], ample);
  let appendedCount = 0;
  for (let index = 0; index < 15; index += 1) {
    const appended = appendDurableRecord(envelope, record(`cross-source-${index}`, { caseId: snapshot.caseId }), ample);
    if (appended.status === 'BACKPRESSURED') break;
    assert.equal(appended.status, 'APPENDED');
    envelope = appended.envelope;
    appendedCount += 1;
  }
  assert.ok(appendedCount > 0 && appendedCount < 16);
  const refused = appendDurableRecord(envelope, record('cross-source-refused', { caseId: snapshot.caseId }), ample);
  assert.equal(refused.status, 'BACKPRESSURED');
  assert.strictEqual(refused.envelope, envelope);
});

test('canonical CAS accepts only an exact one-event owner receipt', () => {
  const snapshot = createCaseSnapshot('case-cas-receipt', 'detect-cas-receipt', now, ['SYNTHETIC_DETECTION']);
  const envelope = createDurableEnvelope(snapshot);
  const binding = (result) => ({
    posture: 'SYNTHETIC_ONLY',
    configKey: `a2.shadow.cas-receipt-${String(result.committed)}.v1`,
    eventKind: 'a2.shadow.cas-receipt',
    port: {
      getConfigValue: () => null,
      compareAndSetConfigValueAndLogEvents: () => result,
    },
  });
  assert.throws(
    () => commitDurableEnvelope(binding({ committed: 1 }), null, envelope, now + 100),
    /non-boolean commit disposition/u,
  );
  assert.throws(
    () => commitDurableEnvelope(binding({ committed: true, events: [] }), null, envelope, now + 100),
    /one audit event/u,
  );
  assert.throws(
    () => commitDurableEnvelope(binding({
      committed: true,
      events: [{ id: 1, ts: now + 1, kind: 'wrong-kind', symbol: null, data: {} }],
    }), null, envelope, now + 100),
    /does not match the committed envelope/u,
  );
});

test('persistence captures binding fields before proof and owner callbacks can mutate caller objects', () => {
  let snapshot = createCaseSnapshot('case-binding-capture', 'detect-binding-capture', now, ['SYNTHETIC_DETECTION']);
  snapshot = attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind: 'BUDGET_ADMISSION',
    caseId: snapshot.caseId,
    generation: snapshot.generation,
    artifactId: 'binding-capture-proof',
    artifactDigest: sha256('binding-capture-proof'),
    disposition: 'VALIDATED',
    recordedAtMs: now,
  }), proofAuthority);
  const envelope = createDurableEnvelope(snapshot);
  const mutableEnvelope = JSON.parse(canonicalJson(envelope));
  const expectedCommittedBytes = canonicalJson(mutableEnvelope);
  const originalPort = new SyntheticCanonicalPersistencePort(now + 1);
  const mutableBinding = {
    posture: 'SYNTHETIC_ONLY',
    configKey: 'a2.shadow.binding-capture.v1',
    eventKind: 'a2.shadow.binding-capture',
    recordCapacity: { ...envelope.recordCapacity },
    port: originalPort,
  };
  const mutatingVerifier = {
    posture: 'SYNTHETIC_ONLY',
    verifyDigest(digest, signature) {
      mutableBinding.recordCapacity.maximumRecords = 1;
      mutableBinding.port = { getConfigValue: () => null };
      mutableEnvelope.caseSnapshot.state = 'RESOLVED';
      return proofAuthority.verifyDigest(digest, signature);
    },
    verifyArtifactValidation(proof) {
      mutableBinding.configKey = 'forged-key';
      return proofAuthority.verifyArtifactValidation(proof);
    },
  };
  const committed = commitDurableEnvelopeRaw(mutableBinding, null, mutableEnvelope, now + 100, mutatingVerifier);
  assert.equal(committed.status, 'COMMITTED');
  assert.equal(committed.serialized, expectedCommittedBytes);
  assert.equal(originalPort.getConfigValue('a2.shadow.binding-capture.v1'), committed.serialized);

  const readBinding = {
    posture: 'SYNTHETIC_ONLY',
    configKey: 'a2.shadow.read-capture.v1',
    eventKind: 'a2.shadow.read-capture',
    recordCapacity: { ...envelope.recordCapacity },
    port: {
      getConfigValue() {
        readBinding.recordCapacity.maximumRecords = 1;
        return canonicalJson(envelope);
      },
    },
  };
  assert.deepEqual(readDurableEnvelopeRaw(readBinding, proofAuthority), envelope);
});

test('durable resume revalidates persisted case proofs with the artifact owner', () => {
  let snapshot = createCaseSnapshot('case-read-proof', 'detect-read-proof', now, ['SYNTHETIC_DETECTION']);
  snapshot = attachCaseProof(snapshot, proofAuthority.issueValidatedProof({
    proofKind: 'BUDGET_ADMISSION',
    caseId: snapshot.caseId,
    generation: snapshot.generation,
    artifactId: 'read-proof-artifact',
    artifactDigest: sha256('read-proof-artifact'),
    disposition: 'VALIDATED',
    recordedAtMs: now,
  }), proofAuthority);
  const envelope = createDurableEnvelope(snapshot);
  const binding = {
    posture: 'SYNTHETIC_ONLY',
    configKey: 'a2.shadow.read-proof.v1',
    eventKind: 'a2.shadow.read-proof',
    recordCapacity: envelope.recordCapacity,
    port: { getConfigValue: () => canonicalJson(envelope) },
  };
  const rejectingVerifier = {
    posture: 'SYNTHETIC_ONLY',
    verifyDigest: () => false,
    verifyArtifactValidation: () => false,
  };
  assert.throws(
    () => readDurableEnvelopeRaw(binding, rejectingVerifier),
    /unverified proof/u,
  );
});
