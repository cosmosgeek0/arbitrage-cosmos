import type {
  LedgerPersistencePort,
  LedgerSchemaCompatibilityReadback,
  ProductBootReleasePersistenceInput,
  ProductBootReleaseRecord,
  ProductPersistenceAuditRecord,
  ProductPersistenceMutationResult,
  SystemJsonValue,
} from './types.js';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const REVISION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UNRESOLVED_VALUE = /^(?:REPLACE_ME|UNKNOWN|UNAVAILABLE|NOT_CONFIGURED)(?:_|$)/i;
const MAX_UTC_MS = 4_102_444_800_000;
const MAX_READBACK_ROWS = 100;
const OPERATION_TYPE = 'APPLICATION_BOOT' as const;
const UNKNOWN_SCHEMA_REVISION = 'UNKNOWN' as const;
const AUDIT_KIND = 'system.integration.product.persistence' as const;
const AUDIT_SCHEMA = 'cosmos.system-integration.boot-release.v1' as const;
const SENSITIVE_TEXT = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;

export type BootReleaseIdentityIssue =
  | 'TESTED_COMMIT_UNKNOWN'
  | 'DEPLOYED_COMMIT_UNKNOWN'
  | 'CONFIG_REVISION_UNKNOWN'
  | 'SCHEMA_REVISION_UNKNOWN'
  | 'MODEL_REVISION_UNKNOWN';

export type BootReleaseIdentityState = 'AVAILABLE' | 'PARTIAL' | 'UNKNOWN';
export type BootReleaseLifecycleState =
  | 'ACTIVE'
  | 'CRASH_PENDING'
  | 'CLEAN_COMPLETED'
  | 'UNCLEAN_COMPLETED';

export interface BootReleaseEnvironmentInput {
  readonly testedSha?: unknown;
  readonly deployedSha?: unknown;
  readonly configRevision?: unknown;
  readonly modelRevision?: unknown;
}

export interface BootReleaseClock {
  nowMs(): number;
}

export interface BootReleaseLifecycleProjection extends ProductBootReleaseRecord {
  readonly lifecycleState: BootReleaseLifecycleState;
  readonly identityState: BootReleaseIdentityState;
  readonly identityIssues: readonly BootReleaseIdentityIssue[];
  readonly deploymentMutationAuthority: 'NONE';
}

export interface BootReleaseReadback {
  readonly source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE';
  readonly state: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE';
  readonly latest: Readonly<BootReleaseLifecycleProjection> | null;
  readonly history: readonly Readonly<BootReleaseLifecycleProjection>[];
  readonly crashPendingOperationIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export type BootReleasePersistenceFailureCode =
  | 'BOOT_RELEASE_LEDGER_CAPABILITY_UNAVAILABLE'
  | 'BOOT_RELEASE_READ_FAILED'
  | 'BOOT_RELEASE_WRITE_FAILED'
  | 'BOOT_RELEASE_VERSION_CONFLICT'
  | 'BOOT_RELEASE_IDEMPOTENCY_CONFLICT'
  | 'BOOT_RELEASE_CLOCK_INVALID'
  | 'BOOT_RELEASE_GENERATION_EXHAUSTED'
  | 'BOOT_RELEASE_NOT_STARTED';

export type BootReleasePersistenceResult =
  | {
      readonly ok: true;
      readonly disposition: 'COMMITTED_NEW' | 'IDEMPOTENT_REPLAY';
      readonly operationId: string;
      readonly generation: number;
      readonly ledgerEventId: number;
    }
  | {
      readonly ok: false;
      readonly code: BootReleasePersistenceFailureCode;
      readonly message: string;
      readonly currentRevision: string | null;
    };

type BootReleasePersistenceFailure = Extract<BootReleasePersistenceResult, { readonly ok: false }>;

export interface BootReleasePersistenceAdapterOptions {
  readonly ledger: Pick<
    LedgerPersistencePort,
    'compareAndSetProductBootReleaseRevision'
    | 'readProductBootReleaseRevisions'
    | 'readSchemaCompatibility'
  >;
  readonly clock: BootReleaseClock;
  readonly environment: Readonly<BootReleaseEnvironmentInput>;
}

interface ValidatedIdentity {
  readonly testedCommit: string | null;
  readonly deployedCommit: string | null;
  readonly configRevision: string | null;
  readonly schemaRevision: string;
  readonly modelRevision: string | null;
  readonly issues: readonly BootReleaseIdentityIssue[];
}

function validUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function exactFullSha(value: unknown): string | null {
  return typeof value === 'string' && FULL_GIT_SHA.test(value) ? value : null;
}

function exactRevision(value: unknown): string | null {
  return typeof value === 'string'
    && REVISION_ID.test(value)
    && !UNRESOLVED_VALUE.test(value)
    ? value
    : null;
}

function schemaRevision(
  readback: Readonly<LedgerSchemaCompatibilityReadback> | null,
): string {
  return readback?.state === 'AVAILABLE'
    && Number.isSafeInteger(readback.currentSchemaVersion)
    && (readback.currentSchemaVersion ?? 0) >= 1
    ? String(readback.currentSchemaVersion)
    : UNKNOWN_SCHEMA_REVISION;
}

function identityIssues(input: Readonly<{
  testedCommit: string | null;
  deployedCommit: string | null;
  configRevision: string | null;
  schemaRevision: string;
  modelRevision: string | null;
}>): readonly BootReleaseIdentityIssue[] {
  const issues: BootReleaseIdentityIssue[] = [];
  if (input.testedCommit === null) issues.push('TESTED_COMMIT_UNKNOWN');
  if (input.deployedCommit === null) issues.push('DEPLOYED_COMMIT_UNKNOWN');
  if (input.configRevision === null) issues.push('CONFIG_REVISION_UNKNOWN');
  if (input.schemaRevision === UNKNOWN_SCHEMA_REVISION) issues.push('SCHEMA_REVISION_UNKNOWN');
  if (input.modelRevision === null) issues.push('MODEL_REVISION_UNKNOWN');
  return Object.freeze(issues);
}

function identityState(issues: readonly BootReleaseIdentityIssue[]): BootReleaseIdentityState {
  if (issues.includes('TESTED_COMMIT_UNKNOWN') || issues.includes('SCHEMA_REVISION_UNKNOWN')) {
    return 'UNKNOWN';
  }
  return issues.length === 0 ? 'AVAILABLE' : 'PARTIAL';
}

function validateIdentity(
  environment: Readonly<BootReleaseEnvironmentInput>,
  compatibility: Readonly<LedgerSchemaCompatibilityReadback> | null,
): Readonly<ValidatedIdentity> {
  const identity = {
    testedCommit: exactFullSha(environment.testedSha),
    // Never infer a deployment from the tested commit. Deployment evidence is
    // published only when its independent composition input is a full SHA.
    deployedCommit: exactFullSha(environment.deployedSha),
    configRevision: exactRevision(environment.configRevision),
    schemaRevision: schemaRevision(compatibility),
    modelRevision: exactRevision(environment.modelRevision),
  };
  return Object.freeze({
    ...identity,
    issues: identityIssues(identity),
  });
}

function primaryBlocker(identity: Readonly<ValidatedIdentity>): string | null {
  if (identity.issues.includes('TESTED_COMMIT_UNKNOWN')) return 'TESTED_COMMIT_UNKNOWN';
  if (identity.issues.includes('SCHEMA_REVISION_UNKNOWN')) return 'SCHEMA_REVISION_UNKNOWN';
  return null;
}

function auditFor(
  input: Omit<ProductBootReleasePersistenceInput, 'audit'>,
  phase: 'STARTED' | 'CLEAN_COMPLETED' | 'UNCLEAN_COMPLETED',
): Readonly<ProductPersistenceAuditRecord> {
  const data: SystemJsonValue = {
    schema: AUDIT_SCHEMA,
    phase,
    operationId: input.operationId,
    operationType: input.operationType,
    generation: input.generation,
    testedCommit: input.testedCommit,
    deployedCommit: input.deployedCommit,
    configRevision: input.configRevision,
    schemaRevision: input.schemaRevision,
    modelRevision: input.modelRevision,
    startedAtMs: input.startedAtMs,
    completedAtMs: input.completedAtMs,
    clean: input.clean,
    blockerCode: input.blockerCode,
    correlationId: input.correlationId,
    identitySource: 'VALIDATED_COMPOSITION_INPUT',
    deploymentMutationAuthority: 'NONE',
  };
  return Object.freeze({
    kind: AUDIT_KIND,
    symbol: 'system-boot-release',
    data: Object.freeze(data),
  });
}

function failed(
  code: BootReleasePersistenceFailureCode,
  message: string,
  currentRevision: string | null = null,
): BootReleasePersistenceFailure {
  return Object.freeze({ ok: false, code, message, currentRevision });
}

function safeMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
  return message.length > 0 && !SENSITIVE_TEXT.test(message) ? message : fallback;
}

export class SystemBootReleasePersistenceAdapter {
  private readonly ledger: BootReleasePersistenceAdapterOptions['ledger'];
  private readonly clock: Readonly<BootReleaseClock>;
  private readonly environment: Readonly<BootReleaseEnvironmentInput>;
  private startInput: Readonly<ProductBootReleasePersistenceInput> | null = null;
  private completionInput: Readonly<ProductBootReleasePersistenceInput> | null = null;
  private failureInput: Readonly<ProductBootReleasePersistenceInput> | null = null;
  private startLedgerEventId: number | null = null;
  private completionLedgerEventId: number | null = null;
  private completionAccepted = false;

  constructor(options: Readonly<BootReleasePersistenceAdapterOptions>) {
    if (!options || typeof options.clock?.nowMs !== 'function' || !options.ledger) {
      throw new TypeError('boot/release persistence requires injected Ledger, clock, and environment inputs');
    }
    this.ledger = options.ledger;
    this.clock = options.clock;
    this.environment = Object.freeze({
      testedSha: options.environment?.testedSha,
      deployedSha: options.environment?.deployedSha,
      configRevision: options.environment?.configRevision,
      modelRevision: options.environment?.modelRevision,
    });
  }

  private rows(limit: number):
    | { readonly ok: true; readonly value: readonly Readonly<ProductBootReleaseRecord>[] }
    | { readonly ok: false; readonly result: BootReleasePersistenceFailure } {
    if (typeof this.ledger.readProductBootReleaseRevisions !== 'function') {
      return {
        ok: false,
        result: failed(
          'BOOT_RELEASE_LEDGER_CAPABILITY_UNAVAILABLE',
          'existing Ledger lacks boot/release readback capability',
        ),
      };
    }
    try {
      return { ok: true, value: this.ledger.readProductBootReleaseRevisions(limit) };
    } catch (error) {
      return {
        ok: false,
        result: failed(
          'BOOT_RELEASE_READ_FAILED',
          safeMessage(error, 'boot/release readback failed'),
        ),
      };
    }
  }

  private compatibility(): Readonly<LedgerSchemaCompatibilityReadback> | null {
    if (typeof this.ledger.readSchemaCompatibility !== 'function') return null;
    try {
      return this.ledger.readSchemaCompatibility();
    } catch {
      return null;
    }
  }

  private write(
    input: Readonly<ProductBootReleasePersistenceInput>,
  ): BootReleasePersistenceResult {
    if (typeof this.ledger.compareAndSetProductBootReleaseRevision !== 'function') {
      return failed(
        'BOOT_RELEASE_LEDGER_CAPABILITY_UNAVAILABLE',
        'existing Ledger lacks boot/release compare-and-set capability',
      );
    }
    let result: ProductPersistenceMutationResult;
    try {
      result = this.ledger.compareAndSetProductBootReleaseRevision(input);
    } catch (error) {
      return failed(
        'BOOT_RELEASE_WRITE_FAILED',
        safeMessage(error, 'boot/release persistence transaction failed'),
      );
    }
    if (result.disposition === 'VERSION_CONFLICT') {
      return failed(
        'BOOT_RELEASE_VERSION_CONFLICT',
        'boot/release compare-and-set revision changed',
        result.currentRevision,
      );
    }
    if (result.disposition === 'IDEMPOTENCY_CONFLICT') {
      return failed(
        'BOOT_RELEASE_IDEMPOTENCY_CONFLICT',
        'boot/release operation identity was reused with different evidence',
        result.currentRevision,
      );
    }
    if (result.ledgerEvent === null) {
      return failed(
        'BOOT_RELEASE_WRITE_FAILED',
        'committed boot/release persistence result is missing its Ledger event',
      );
    }
    return Object.freeze({
      ok: true,
      disposition: result.disposition,
      operationId: input.operationId,
      generation: input.generation,
      ledgerEventId: result.ledgerEvent.id,
    });
  }

  start(): BootReleasePersistenceResult {
    if (this.startInput === null) {
      const previous = this.rows(1);
      if (!previous.ok) return previous.result;
      const nowMs = this.clock.nowMs();
      if (!validUtcMillis(nowMs)) {
        return failed('BOOT_RELEASE_CLOCK_INVALID', 'boot clock returned invalid UTC milliseconds');
      }
      const priorGeneration = previous.value[0]?.generation ?? 0;
      if (!Number.isSafeInteger(priorGeneration) || priorGeneration >= Number.MAX_SAFE_INTEGER) {
        return failed('BOOT_RELEASE_GENERATION_EXHAUSTED', 'boot generation cannot advance safely');
      }
      const generation = priorGeneration + 1;
      const operationId = `system.application.boot.g${generation}`;
      const correlationId = `system-boot-g${generation}`;
      const identity = validateIdentity(this.environment, this.compatibility());
      const core = Object.freeze({
        operationId,
        operationType: OPERATION_TYPE,
        expectedLedgerEventId: null,
        generation,
        testedCommit: identity.testedCommit,
        deployedCommit: identity.deployedCommit,
        configRevision: identity.configRevision,
        schemaRevision: identity.schemaRevision,
        modelRevision: identity.modelRevision,
        startedAtMs: nowMs,
        completedAtMs: null,
        clean: null,
        blockerCode: primaryBlocker(identity),
        correlationId,
      });
      this.startInput = Object.freeze({ ...core, audit: auditFor(core, 'STARTED') });
    }
    const result = this.write(this.startInput);
    if (result.ok) this.startLedgerEventId = result.ledgerEventId;
    return result;
  }

  completeCleanShutdown(): BootReleasePersistenceResult {
    if (this.startInput === null || this.startLedgerEventId === null) {
      return failed('BOOT_RELEASE_NOT_STARTED', 'clean completion requires an accepted boot revision');
    }
    if (this.completionInput === null) {
      const completedAtMs = this.clock.nowMs();
      if (!validUtcMillis(completedAtMs) || completedAtMs < this.startInput.startedAtMs) {
        return failed('BOOT_RELEASE_CLOCK_INVALID', 'shutdown clock returned invalid or regressed UTC milliseconds');
      }
      const core = Object.freeze({
        operationId: this.startInput.operationId,
        operationType: this.startInput.operationType,
        expectedLedgerEventId: this.startLedgerEventId,
        generation: this.startInput.generation,
        testedCommit: this.startInput.testedCommit,
        deployedCommit: this.startInput.deployedCommit,
        configRevision: this.startInput.configRevision,
        schemaRevision: this.startInput.schemaRevision,
        modelRevision: this.startInput.modelRevision,
        startedAtMs: this.startInput.startedAtMs,
        completedAtMs,
        clean: true,
        blockerCode: this.startInput.blockerCode,
        correlationId: this.startInput.correlationId,
      });
      this.completionInput = Object.freeze({ ...core, audit: auditFor(core, 'CLEAN_COMPLETED') });
    }
    const result = this.write(this.completionInput);
    if (result.ok) {
      this.completionLedgerEventId = result.ledgerEventId;
      this.completionAccepted = true;
    }
    return result;
  }

  /**
   * Replaces an already-written clean marker when the final durability
   * checkpoint or synchronous database close fails. The immutable boot
   * identity and completion timestamp stay unchanged; only its clean outcome
   * and blocker advance through the same Ledger CAS row.
   */
  markShutdownFailure(
    blockerCode: BootReleaseShutdownFailureBlocker,
  ): BootReleasePersistenceResult {
    if (this.completionInput === null || this.completionLedgerEventId === null) {
      return failed('BOOT_RELEASE_NOT_STARTED', 'unclean completion requires an accepted clean completion revision');
    }
    if (this.failureInput === null) {
      const core = Object.freeze({
        operationId: this.completionInput.operationId,
        operationType: this.completionInput.operationType,
        expectedLedgerEventId: this.completionLedgerEventId,
        generation: this.completionInput.generation,
        testedCommit: this.completionInput.testedCommit,
        deployedCommit: this.completionInput.deployedCommit,
        configRevision: this.completionInput.configRevision,
        schemaRevision: this.completionInput.schemaRevision,
        modelRevision: this.completionInput.modelRevision,
        startedAtMs: this.completionInput.startedAtMs,
        completedAtMs: this.completionInput.completedAtMs,
        clean: false,
        blockerCode,
        correlationId: this.completionInput.correlationId,
      });
      this.failureInput = Object.freeze({ ...core, audit: auditFor(core, 'UNCLEAN_COMPLETED') });
    }
    const result = this.write(this.failureInput);
    if (result.ok) {
      this.completionLedgerEventId = result.ledgerEventId;
      this.completionAccepted = false;
    }
    return result;
  }

  readback(limit = 20): Readonly<BootReleaseReadback> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_READBACK_ROWS) {
      return Object.freeze({
        source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
        state: 'UNAVAILABLE',
        latest: null,
        history: Object.freeze([]),
        crashPendingOperationIds: Object.freeze([]),
        reasonCodes: Object.freeze(['BOOT_RELEASE_READ_LIMIT_INVALID']),
      });
    }
    const source = this.rows(limit);
    if (!source.ok) {
      return Object.freeze({
        source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
        state: 'UNAVAILABLE',
        latest: null,
        history: Object.freeze([]),
        crashPendingOperationIds: Object.freeze([]),
        reasonCodes: Object.freeze([source.result.code]),
      });
    }
    const history = Object.freeze(source.value.map((record) => {
      const issues = identityIssues(record);
      const isCurrent = this.startLedgerEventId !== null
        && record.operationId === this.startInput?.operationId;
      const lifecycleState: BootReleaseLifecycleState = record.completedAtMs !== null
        ? record.clean === true ? 'CLEAN_COMPLETED' : 'UNCLEAN_COMPLETED'
        : isCurrent && !this.completionAccepted ? 'ACTIVE' : 'CRASH_PENDING';
      return Object.freeze({
        ...record,
        lifecycleState,
        identityState: identityState(issues),
        identityIssues: issues,
        deploymentMutationAuthority: 'NONE' as const,
      });
    }));
    if (history.length === 0) {
      return Object.freeze({
        source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
        state: 'EMPTY',
        latest: null,
        history,
        crashPendingOperationIds: Object.freeze([]),
        reasonCodes: Object.freeze(['BOOT_RELEASE_HISTORY_EMPTY']),
      });
    }
    const crashPendingOperationIds = Object.freeze(history
      .filter((record) => record.lifecycleState === 'CRASH_PENDING')
      .map((record) => record.operationId));
    return Object.freeze({
      source: 'SYSTEM_INTEGRATION_LEDGER_BOOT_RELEASE',
      state: 'AVAILABLE',
      latest: history[0] ?? null,
      history,
      crashPendingOperationIds,
      reasonCodes: Object.freeze([
        ...new Set([
          ...history[0].identityIssues,
          ...(crashPendingOperationIds.length > 0 ? ['CRASH_PENDING_BOOT_PRESENT'] : []),
        ]),
      ]),
    });
  }
}

export type BootReleaseShutdownFailureBlocker =
  | 'LEDGER_FINAL_CHECKPOINT_FAILED'
  | 'LEDGER_CLOSE_FAILED';

export type BootReleaseShutdownFinalizationFailureCode =
  | 'LEDGER_FINAL_PREFLIGHT_FAILED'
  | 'BOOT_RELEASE_COMPLETION_FAILED'
  | BootReleaseShutdownFailureBlocker;

export type BootReleaseShutdownFinalizationResult =
  | { readonly ok: true; readonly code: 'CLEAN_SHUTDOWN_DURABLE' }
  | {
      readonly ok: false;
      readonly code: BootReleaseShutdownFinalizationFailureCode;
      readonly uncleanRecorded: boolean;
    };

export interface BootReleaseShutdownLedgerPort {
  probeWritable(force?: boolean): boolean;
  flushForCleanShutdown(): boolean;
  close(): void;
}

function shutdownFailed(
  code: BootReleaseShutdownFinalizationFailureCode,
  uncleanRecorded = false,
): Readonly<BootReleaseShutdownFinalizationResult> {
  return Object.freeze({ ok: false, code, uncleanRecorded });
}

function tryFlush(ledger: Readonly<BootReleaseShutdownLedgerPort>): boolean {
  try {
    return ledger.flushForCleanShutdown() === true;
  } catch {
    return false;
  }
}

/**
 * Final persistence step after every listener, stream, timer, and component
 * has stopped. Any failure after that irreversible boundary is a failed
 * shutdown, never a retryable refusal or a clean outcome.
 */
export function finalizeSystemBootReleaseCleanShutdown(
  lifecycle: SystemBootReleasePersistenceAdapter,
  ledger: BootReleaseShutdownLedgerPort,
): Readonly<BootReleaseShutdownFinalizationResult> {
  let writable = false;
  try {
    writable = ledger.probeWritable(true) === true;
  } catch {
    writable = false;
  }
  // This first checkpoint both verifies WAL checkpointability and raises the
  // connection to FULL synchronous durability before writing the clean row.
  if (!writable || !tryFlush(ledger)) {
    return shutdownFailed('LEDGER_FINAL_PREFLIGHT_FAILED');
  }

  const completed = lifecycle.completeCleanShutdown();
  if (!completed.ok) return shutdownFailed('BOOT_RELEASE_COMPLETION_FAILED');

  if (!tryFlush(ledger)) {
    const unclean = lifecycle.markShutdownFailure('LEDGER_FINAL_CHECKPOINT_FAILED');
    if (unclean.ok) tryFlush(ledger);
    return shutdownFailed('LEDGER_FINAL_CHECKPOINT_FAILED', unclean.ok);
  }

  try {
    ledger.close();
  } catch {
    const unclean = lifecycle.markShutdownFailure('LEDGER_CLOSE_FAILED');
    if (unclean.ok) tryFlush(ledger);
    return shutdownFailed('LEDGER_CLOSE_FAILED', unclean.ok);
  }
  return Object.freeze({ ok: true, code: 'CLEAN_SHUTDOWN_DURABLE' });
}

export function createSystemBootReleasePersistenceAdapter(
  options: Readonly<BootReleasePersistenceAdapterOptions>,
): SystemBootReleasePersistenceAdapter {
  return new SystemBootReleasePersistenceAdapter(options);
}
