import { canonicalFixtureJson, cloneFrozenJson } from './values.mjs';

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function validControlState(value) {
  return value !== null
    && typeof value === 'object'
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
    && Number.isSafeInteger(value.generation)
    && value.generation >= 0
    && ['READ_ONLY', 'ADVISORY', 'VALIDATE_ONLY'].includes(value.safeMode)
    && typeof value.killSwitchEngaged === 'boolean'
    && typeof value.intakePaused === 'boolean'
    && Number.isSafeInteger(value.updatedAtMs)
    && typeof value.correlationId === 'string';
}

/** Atomic, bounded test double for SystemControlPersistencePort. */
export class InMemoryControlPersistence {
  #ledger;
  #current;
  #maximumReceipts;
  #maximumJournalEntries;
  #receipts = new Map();
  #journal = [];
  #failure = null;

  constructor(ledger, initialState, options = {}) {
    if (typeof ledger?.logEvent !== 'function') throw new TypeError('InMemoryControlPersistence requires a ledger double');
    if (!validControlState(initialState)) throw new TypeError('InMemoryControlPersistence requires a valid control state');
    this.#ledger = ledger;
    this.#current = cloneFrozenJson(initialState);
    this.#maximumReceipts = positiveSafeInteger(options.maximumReceipts ?? 512, 'maximumReceipts');
    this.#maximumJournalEntries = positiveSafeInteger(
      options.maximumJournalEntries ?? 2_000,
      'maximumJournalEntries',
    );
    Object.seal(this);
  }

  #recordJournal(entry) {
    if (this.#journal.length >= this.#maximumJournalEntries) {
      throw new RangeError('control persistence journal capacity exceeded');
    }
    this.#journal.push(Object.freeze(entry));
  }

  #assertJournalCapacity() {
    if (this.#journal.length >= this.#maximumJournalEntries) {
      throw new RangeError('control persistence journal capacity exceeded');
    }
  }

  failNext(error = new Error('INJECTED_CONTROL_PERSISTENCE_FAILURE')) {
    if (!(error instanceof Error)) throw new TypeError('failNext requires an Error');
    this.#failure = error;
  }

  async findControlMutation(key) {
    return this.#receipts.get(key) ?? null;
  }

  async commitControlMutation(commit) {
    if (this.#failure !== null) {
      const failure = this.#failure;
      this.#failure = null;
      throw failure;
    }
    this.#assertJournalCapacity();
    if (commit === null || typeof commit !== 'object') throw new TypeError('control persistence commit is required');
    const key = commit.request?.idempotencyKey;
    const digest = commit.requestDigest;
    if (typeof key !== 'string' || typeof digest !== 'string') throw new TypeError('control idempotency identity is required');
    const prior = this.#receipts.get(key);
    if (prior !== undefined) {
      this.#recordJournal({ operation: 'IDEMPOTENT_LOOKUP', idempotencyKey: key, replayed: true });
      return prior.requestDigest === digest
        ? Object.freeze({
            kind: 'IDEMPOTENT_REPLAY',
            requestDigest: prior.requestDigest,
            receipt: prior.receipt,
            runtimePublication: prior.runtimePublication,
          })
        : Object.freeze({ kind: 'IDEMPOTENCY_CONFLICT', requestDigest: prior.requestDigest });
    }
    if (commit.request.expectedRevision !== this.#current.revision) {
      this.#recordJournal({ operation: 'REVISION_CONFLICT', idempotencyKey: key, replayed: false });
      return Object.freeze({ kind: 'REVISION_CONFLICT', current: this.#current });
    }
    if (this.#receipts.size >= this.#maximumReceipts) throw new RangeError('control persistence receipt capacity exceeded');
    if (!validControlState(commit.before) || !validControlState(commit.after)) {
      throw new TypeError('control persistence states are invalid');
    }
    if (canonicalFixtureJson(commit.before) !== canonicalFixtureJson(this.#current)) {
      throw new Error('CONTROL_PERSISTENCE_BEFORE_STATE_MISMATCH');
    }
    const frozenBefore = cloneFrozenJson(commit.before);
    const frozenAfter = cloneFrozenJson(commit.after);
    const event = this.#ledger.logEvent('system.control.transition', null, {
      actor: {
        id: commit.actor?.id ?? null,
        source: commit.actor?.source ?? null,
      },
      applied: commit.applied,
      before: frozenBefore,
      after: frozenAfter,
      code: commit.code,
      correlationId: commit.request.correlationId,
      idempotencyKey: key,
      mutation: commit.request.mutation,
      reason: commit.request.reason,
      requestDigest: digest,
    });
    const receipt = cloneFrozenJson({
      applied: commit.applied,
      code: commit.code,
      before: frozenBefore,
      after: frozenAfter,
      ledgerEventId: event.id,
    });
    const runtimePublication = commit.applied
      && ['RESTART_COMPONENT', 'SET_COMPONENT_STATE'].includes(commit.request.mutation.command)
      ? 'PENDING'
      : 'NOT_REQUIRED';
    this.#current = receipt.after;
    this.#receipts.set(key, Object.freeze({ requestDigest: digest, receipt, runtimePublication }));
    this.#recordJournal({ operation: 'COMMITTED', idempotencyKey: key, replayed: false, ledgerEventId: event.id });
    return Object.freeze({ kind: 'COMMITTED', receipt, runtimePublication });
  }

  async markControlRuntimePublished(commit) {
    const prior = this.#receipts.get(commit.idempotencyKey);
    if (prior === undefined || prior.requestDigest !== commit.requestDigest) {
      throw new Error('CONTROL_RUNTIME_PUBLICATION_IDENTITY_MISMATCH');
    }
    if (prior.runtimePublication === 'PUBLISHED') {
      return Object.freeze({ kind: 'IDEMPOTENT_REPLAY' });
    }
    if (prior.runtimePublication !== 'PENDING' && prior.runtimePublication !== 'UNKNOWN') {
      throw new Error('CONTROL_RUNTIME_PUBLICATION_NOT_REQUIRED');
    }
    this.#receipts.set(commit.idempotencyKey, Object.freeze({
      ...prior,
      runtimePublication: 'PUBLISHED',
    }));
    return Object.freeze({ kind: 'PUBLISHED' });
  }

  snapshot() {
    return this.#current;
  }

  journalSnapshot() {
    return Object.freeze([...this.#journal]);
  }

  get calls() {
    return this.journalSnapshot();
  }
}

/**
 * Idempotent record persistence used by the deterministic VALIDATE_ONLY slice.
 * It stores the complete bounded record in the existing-ledger double exactly once.
 */
export class InMemoryValidateOnlyPersistence {
  #ledger;
  #maximumRecords;
  #maximumJournalEntries;
  #records = new Map();
  #journal = [];
  #failure = null;

  constructor(ledger, options = {}) {
    if (typeof ledger?.logEvent !== 'function') throw new TypeError('InMemoryValidateOnlyPersistence requires a ledger double');
    this.#ledger = ledger;
    this.#maximumRecords = positiveSafeInteger(options.maximumRecords ?? 512, 'maximumRecords');
    this.#maximumJournalEntries = positiveSafeInteger(
      options.maximumJournalEntries ?? 2_000,
      'maximumJournalEntries',
    );
    Object.seal(this);
  }

  #recordJournal(entry) {
    if (this.#journal.length >= this.#maximumJournalEntries) {
      throw new RangeError('validate-only persistence journal capacity exceeded');
    }
    this.#journal.push(Object.freeze(entry));
  }

  #assertJournalCapacity() {
    if (this.#journal.length >= this.#maximumJournalEntries) {
      throw new RangeError('validate-only persistence journal capacity exceeded');
    }
  }

  failNext(error = new Error('INJECTED_VALIDATE_ONLY_PERSISTENCE_FAILURE')) {
    if (!(error instanceof Error)) throw new TypeError('failNext requires an Error');
    this.#failure = error;
  }

  async persistValidateOnly(record) {
    if (this.#failure !== null) {
      const failure = this.#failure;
      this.#failure = null;
      throw failure;
    }
    this.#assertJournalCapacity();
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('validate-only persistence record must be an object');
    }
    if (record.schema !== 'cosmos.system-integration.validate-only.v1') {
      throw new TypeError('validate-only persistence schema is invalid');
    }
    if (typeof record.recordId !== 'string' || record.recordId.length < 1 || record.recordId.length > 160) {
      throw new TypeError('validate-only persistence recordId is invalid');
    }
    if (
      typeof record.rootCorrelationId !== 'string'
      || record.rootCorrelationId.length < 1
      || record.rootCorrelationId.length > 160
    ) {
      throw new TypeError('validate-only persistence rootCorrelationId is invalid');
    }
    if (
      record.operatorMode !== 'VALIDATE_ONLY'
      || record.liveExecutionPermitted !== false
      || record.executionAuthority !== 'NONE'
    ) throw new Error('VALIDATE_ONLY_EXECUTION_AUTHORITY_MUST_BE_NONE');
    const validTruthLabels = Array.isArray(record.truthLabels)
      && record.truthLabels.length === 2
      && record.truthLabels[1] === 'SYNTHETIC_ONLY'
      && (record.truthLabels[0] === 'DRY_RUN' || record.truthLabels[0] === 'UNAVAILABLE');
    if (!validTruthLabels) throw new Error('VALIDATE_ONLY_TRUTH_LABELS_REQUIRED');
    const frozen = cloneFrozenJson(record);
    const digest = canonicalFixtureJson(frozen);
    const prior = this.#records.get(frozen.recordId);
    if (prior !== undefined) {
      if (prior.digest !== digest) throw new Error('VALIDATE_ONLY_RECORD_ID_CONFLICT');
      this.#recordJournal({
        operation: 'IDEMPOTENT_REPLAY',
        recordId: frozen.recordId,
        persistenceId: prior.persistenceId,
      });
      return Object.freeze({ persistenceId: prior.persistenceId });
    }
    if (this.#records.size >= this.#maximumRecords) throw new RangeError('validate-only persistence capacity exceeded');
    const event = this.#ledger.logEvent('system.integration.validate_only', null, frozen);
    const persistenceId = `memory-validate-only:${event.id}`;
    this.#records.set(frozen.recordId, Object.freeze({ digest, persistenceId, record: frozen, ledgerEventId: event.id }));
    this.#recordJournal({
      operation: 'COMMITTED',
      recordId: frozen.recordId,
      persistenceId,
      ledgerEventId: event.id,
    });
    return Object.freeze({ persistenceId });
  }

  record(recordId) {
    return this.#records.get(recordId)?.record ?? null;
  }

  recordsSnapshot() {
    return Object.freeze([...this.#records.values()].map((entry) => entry.record));
  }

  journalSnapshot() {
    return Object.freeze([...this.#journal]);
  }

  get calls() {
    return this.journalSnapshot();
  }

  get records() {
    return new Map([...this.#records.entries()].map(([recordId, entry]) => [recordId, entry.record]));
  }
}
