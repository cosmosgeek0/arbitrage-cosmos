import {
  canonicalJson,
  deriveStateRevisionId,
  findSecretLikePaths,
  findSerializabilityIssues,
  isValidUtcMillis,
  stableHash128Hex,
} from '../contracts/index.js';
import { replayExecutionEvents } from './reducer.js';
import {
  EXECUTION_CHECKPOINT_SCHEMA,
  EXECUTION_CHECKPOINT_VERSION,
  NORMAL_BASIS_MAX_JOURNAL_ENTRIES,
  type CheckpointRestoreResult,
  type ExecutionCheckpoint,
  type ExecutionPlanState,
  type NormalBasisBaselineObservation,
  type NormalBasisOrderObservation,
} from './types.js';

const EPSILON = 1e-12;
const ACTIVE_NORMAL_BASIS_ATTEMPT_STATES = new Set([
  'SUBMISSION_STARTED',
  'WORKING',
  'AMBIGUOUS',
  'QUERY_STARTED',
  'CANCEL_REQUESTED',
]);
const TERMINAL_NORMAL_BASIS_ATTEMPT_STATES = new Set([
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'PROVEN_ABSENT',
]);

function quantitiesMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= EPSILON;
}

function normalBasisCheckpointIssue(state: ExecutionPlanState): string | null {
  const binding = state.plan.normalBasisBinding;
  const progress = state.normalBasisProgress;
  if (binding === undefined) {
    return progress === undefined
      ? null
      : 'unbound execution state cannot contain normal-Basis progress';
  }
  if (progress === undefined) return 'bound normal-Basis state is missing its replay projection';
  if (
    binding.planId !== state.plan.planId ||
    binding.correlationId !== state.plan.correlationId ||
    binding.termsFingerprint !== state.plan.termsFingerprint ||
    binding.symbol !== state.plan.symbol ||
    binding.risk.planId !== state.plan.planId ||
    binding.risk.correlationId !== state.plan.correlationId ||
    binding.risk.declaredMaxNakedDurationMs !== state.plan.maxNakedDurationMs
  ) {
    return 'normal-Basis binding does not match the restored plan identity or risk terms';
  }
  if (progress.bindingId !== binding.bindingId) {
    return 'normal-Basis replay projection has a different binding identity';
  }
  if (progress.deliveryGuarantee !== 'PROCESS_LOCAL_REPLAY_ONLY_REQUIRES_LEDGER_CAS') {
    return 'normal-Basis replay projection overstates its delivery guarantee';
  }
  if (progress.journal.length > NORMAL_BASIS_MAX_JOURNAL_ENTRIES) {
    return 'normal-Basis replay journal exceeds its immutable bound';
  }

  const progressEvents = state.eventLog
    .map((event, eventIndex) => ({ event, eventIndex }))
    .filter(({ event }) => event.type === 'NORMAL_BASIS_PROGRESS_OBSERVED');
  if (progressEvents.length !== progress.journal.length) {
    return 'normal-Basis replay journal does not map one-to-one to progress events';
  }

  const latestByClientOrderId = new Map<string, NormalBasisOrderObservation>();
  let latestBaseline: NormalBasisBaselineObservation | null = null;
  let latestBaselineEventIndex: number | null = null;
  let furthestStepIndex = -1;

  for (let index = 0; index < progress.journal.length; index += 1) {
    const observation = progress.journal[index];
    if (
      observation.journalIndex !== index ||
      !isValidUtcMillis(observation.occurredAtMs)
    ) {
      return 'normal-Basis replay journal indices or timestamps are invalid';
    }
    const mapped = progressEvents[index];
    if (
      mapped === undefined ||
      mapped.event.normalBasisObservation === undefined ||
      canonicalJson(mapped.event.normalBasisObservation) !== canonicalJson(observation)
    ) {
      return 'normal-Basis replay journal observation differs from its durable event';
    }

    if (observation.kind === 'BASELINE') {
      const expectedPreEventRevision = mapped.eventIndex;
      if (
        observation.bindingId !== binding.bindingId ||
        observation.observedStateRevision !== expectedPreEventRevision ||
        observation.observedStateRevisionId !== deriveStateRevisionId({
          scope: `execution:${state.plan.planId}`,
          revision: expectedPreEventRevision,
        }) ||
        !Number.isFinite(observation.spotSignedBaseQty) ||
        !Number.isFinite(observation.perpSignedBaseQty)
      ) {
        return 'normal-Basis baseline proof is not bound to the exact pre-event replay revision';
      }
      latestBaseline = observation;
      latestBaselineEventIndex = mapped.eventIndex;
      continue;
    }

    const stepIndex = binding.stepOrder.indexOf(observation.step);
    if (stepIndex < 0 || stepIndex < furthestStepIndex) {
      return 'normal-Basis replay journal violates the immutable four-leg order';
    }
    furthestStepIndex = stepIndex;

    const expectedIdentity = observation.step === 'SPOT_OPEN' || observation.step === 'PERP_OPEN'
      ? observation.attempt === 0
        ? binding.steps[observation.step].clientOrderId
        : null
      : binding.closeAttempts.find(
          (candidate) => candidate.step === observation.step && candidate.attempt === observation.attempt,
        )?.clientOrderId ?? null;
    if (expectedIdentity === null || observation.clientOrderId !== expectedIdentity) {
      return 'normal-Basis replay journal contains an invented or misbound order identity';
    }
    if (
      !Number.isFinite(observation.submittedQuantity) ||
      observation.submittedQuantity <= 0 ||
      !Number.isFinite(observation.cumulativeFilledQuantity) ||
      observation.cumulativeFilledQuantity < 0 ||
      observation.cumulativeFilledQuantity > observation.submittedQuantity + EPSILON
    ) {
      return 'normal-Basis replay journal contains an invalid submitted or filled quantity';
    }
    if (
      observation.state === 'FILLED' &&
      !quantitiesMatch(observation.cumulativeFilledQuantity, observation.submittedQuantity)
    ) {
      return 'normal-Basis FILLED evidence is not terminal for its submitted quantity';
    }
    if (
      observation.state === 'PROVEN_ABSENT' &&
      observation.cumulativeFilledQuantity > EPSILON
    ) {
      return 'normal-Basis proven-absent identity cannot carry a net fill';
    }

    const prior = latestByClientOrderId.get(observation.clientOrderId);
    if (
      prior !== undefined &&
      (
        prior.step !== observation.step ||
        prior.attempt !== observation.attempt ||
        !quantitiesMatch(prior.submittedQuantity, observation.submittedQuantity) ||
        prior.cumulativeFilledQuantity > observation.cumulativeFilledQuantity + EPSILON ||
        TERMINAL_NORMAL_BASIS_ATTEMPT_STATES.has(prior.state)
      )
    ) {
      return 'normal-Basis attempt history changes identity terms, regresses fill, or follows a terminal state';
    }
    latestByClientOrderId.set(observation.clientOrderId, observation);
  }

  for (const step of ['PERP_CLOSE', 'SPOT_CLOSE'] as const) {
    const attempts = [...latestByClientOrderId.values()]
      .filter((observation) => observation.step === step)
      .map((observation) => observation.attempt)
      .sort((left, right) => left - right);
    if (attempts.some((attempt, index) => attempt !== index)) {
      return 'normal-Basis close-attempt identities are not contiguous from attempt zero';
    }
  }

  const nonTerminalAttempts = [...latestByClientOrderId.values()].filter(
    (observation) => ACTIVE_NORMAL_BASIS_ATTEMPT_STATES.has(observation.state),
  );
  if (nonTerminalAttempts.length > 1) {
    return 'normal-Basis replay journal has more than one non-terminal order';
  }
  const workingOrAmbiguousAttempts = nonTerminalAttempts.filter(
    (observation) => observation.state === 'WORKING' || observation.state === 'AMBIGUOUS',
  );
  if (
    (workingOrAmbiguousAttempts.length === 0 && progress.workingOrAmbiguousClientOrderId !== null) ||
    (workingOrAmbiguousAttempts.length === 1 &&
      progress.workingOrAmbiguousClientOrderId !== workingOrAmbiguousAttempts[0]?.clientOrderId)
  ) {
    return 'normal-Basis active order projection does not match terminal journal evidence';
  }

  const netTerminalFill = (step: NormalBasisOrderObservation['step']): number | null => {
    const terminal = [...latestByClientOrderId.values()]
      .filter(
        (observation) => (
          observation.step === step &&
          TERMINAL_NORMAL_BASIS_ATTEMPT_STATES.has(observation.state)
        ),
      );
    return terminal.length === 0
      ? null
      : terminal.reduce((sum, observation) => sum + observation.cumulativeFilledQuantity, 0);
  };
  const spotOpened = netTerminalFill('SPOT_OPEN');
  const perpOpened = netTerminalFill('PERP_OPEN');
  const perpClosed = netTerminalFill('PERP_CLOSE');
  const spotClosed = netTerminalFill('SPOT_CLOSE');
  for (const step of binding.stepOrder) {
    const projected = progress.terminalNetFilledQuantityByStep[step];
    const derived = netTerminalFill(step);
    if (
      (projected === null) !== (derived === null) ||
      (projected !== null && derived !== null && !quantitiesMatch(projected, derived))
    ) {
      return 'normal-Basis terminal net-fill projection does not match its attempt journal';
    }
  }
  if (
    (perpClosed !== null && (perpOpened === null || perpClosed > perpOpened + EPSILON)) ||
    (spotClosed !== null && (spotOpened === null || spotClosed > spotOpened + EPSILON))
  ) {
    return 'normal-Basis replay journal closes more than its terminal net entry fill';
  }

  if (progress.action.disposition === 'ATTEMPT_BUDGET_EXHAUSTED') {
    const exhaustedStep = progress.next;
    if (exhaustedStep !== 'PERP_CLOSE' && exhaustedStep !== 'SPOT_CLOSE') {
      return 'normal-Basis attempt exhaustion is only valid for a close step';
    }
    const exhaustedTerminalAttempts = [...latestByClientOrderId.values()].filter(
      (observation) => (
        observation.step === exhaustedStep &&
        TERMINAL_NORMAL_BASIS_ATTEMPT_STATES.has(observation.state)
      ),
    );
    const opened = exhaustedStep === 'PERP_CLOSE' ? perpOpened : spotOpened;
    const closed = exhaustedStep === 'PERP_CLOSE' ? perpClosed : spotClosed;
    const residual = opened === null ? null : Math.max(0, opened - (closed ?? 0));
    if (
      nonTerminalAttempts.length !== 0 ||
      exhaustedTerminalAttempts.length !== binding.maxCloseAttempts ||
      progress.nextAttempt !== null ||
      progress.action.step !== exhaustedStep ||
      progress.action.attempt !== null ||
      progress.action.clientOrderId !== null ||
      progress.action.quantity === null ||
      progress.expectedQuantity === null ||
      residual === null ||
      residual <= EPSILON ||
      !quantitiesMatch(progress.action.quantity, residual) ||
      !quantitiesMatch(progress.expectedQuantity, residual) ||
      progress.complete ||
      progress.baselineFlat ||
      latestBaseline !== null
    ) {
      return 'normal-Basis exhausted-attempt projection lacks a terminal bounded journal and positive residual';
    }
    if (
      exhaustedStep === 'SPOT_CLOSE' &&
      (
        perpOpened === null ||
        perpClosed === null ||
        !quantitiesMatch(perpOpened, perpClosed)
      )
    ) {
      return 'normal-Basis Spot-close exhaustion is invalid before terminal USD-M close';
    }
  }

  const returnedToRiskBaseline = latestBaseline !== null &&
    quantitiesMatch(
      latestBaseline.spotSignedBaseQty,
      binding.risk.baseline.spotSignedBaseQty,
    ) &&
    quantitiesMatch(
      latestBaseline.perpSignedBaseQty,
      binding.risk.baseline.perpSignedBaseQty,
    );
  if (progress.baselineFlat !== returnedToRiskBaseline) {
    return 'normal-Basis baseline-flat projection does not match the latest bound proof';
  }
  if (
    progress.next === 'BASELINE_RECONCILIATION' ||
    progress.next === 'COMPLETE'
  ) {
    if (
      nonTerminalAttempts.length !== 0 ||
      spotOpened === null ||
      (
        spotOpened > EPSILON &&
        (
          perpOpened === null ||
          perpClosed === null ||
          spotClosed === null ||
          !quantitiesMatch(perpClosed, perpOpened) ||
          !quantitiesMatch(spotClosed, spotOpened)
        )
      )
    ) {
      return 'normal-Basis reconciliation begins before every terminal net fill is re-closed';
    }
  }
  if (
    progress.complete !== (progress.next === 'COMPLETE' && returnedToRiskBaseline) ||
    (progress.next === 'COMPLETE' && latestBaseline === null)
  ) {
    return 'normal-Basis completion lacks a revision-bound account-baseline proof';
  }
  if (
    progress.next === 'COMPLETE' &&
    (
      latestBaseline === null ||
      latestBaselineEventIndex !== state.eventLog.length - 1 ||
      state.revision !== latestBaseline.observedStateRevision + 1 ||
      state.stateRevisionId !== deriveStateRevisionId({
        scope: `execution:${state.plan.planId}`,
        revision: latestBaseline.observedStateRevision + 1,
      })
    )
  ) {
    return 'normal-Basis completion baseline proof is stale after a later aggregate event';
  }
  return null;
}

function checkpointPayload(state: ExecutionPlanState): Omit<ExecutionCheckpoint, 'checksum'> {
  return {
    schema: EXECUTION_CHECKPOINT_SCHEMA,
    version: EXECUTION_CHECKPOINT_VERSION,
    planId: state.plan.planId,
    revision: state.revision,
    state,
  };
}

/** Same state always yields the same checkpoint and checksum. */
export function createExecutionCheckpoint(state: ExecutionPlanState): Readonly<ExecutionCheckpoint> {
  const normalBasisIssue = normalBasisCheckpointIssue(state);
  if (normalBasisIssue !== null) {
    throw new TypeError(`invalid normal-Basis execution state: ${normalBasisIssue}`);
  }
  const payload = checkpointPayload(state);
  if (findSecretLikePaths(payload).length > 0 || findSerializabilityIssues(payload).length > 0) {
    throw new TypeError('execution checkpoint state must be secret-free canonical plain data');
  }
  return Object.freeze({ ...payload, checksum: stableHash128Hex(canonicalJson(payload)) });
}

/** Canonical JSON makes byte output independent of object key insertion order. */
export function serializeExecutionCheckpoint(state: ExecutionPlanState): string {
  return canonicalJson(createExecutionCheckpoint(state));
}

/**
 * Restores only after checksum verification and a full event replay. A
 * checksum-valid but reducer-inconsistent snapshot is still rejected.
 */
export function restoreExecutionCheckpoint(serialized: string): CheckpointRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_PARSE_FAILED' as const,
      message: 'checkpoint is not valid JSON',
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint must be an object',
    });
  }
  const checkpoint = parsed as Record<string, unknown>;
  const exactKeys = ['checksum', 'planId', 'revision', 'schema', 'state', 'version'];
  if (Object.keys(checkpoint).sort().join('|') !== exactKeys.join('|')) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_UNKNOWN_FIELD' as const,
      message: 'checkpoint contains missing or unknown top-level fields',
    });
  }
  const secretPaths = findSecretLikePaths(checkpoint);
  if (secretPaths.length > 0) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_SECRET_FIELD_REJECTED' as const,
      message: `checkpoint contains forbidden secret-like fields: ${secretPaths.join(', ')}`,
    });
  }
  if (findSerializabilityIssues(checkpoint).length > 0) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint is not canonical plain data',
    });
  }
  if (checkpoint.schema !== EXECUTION_CHECKPOINT_SCHEMA || checkpoint.version !== EXECUTION_CHECKPOINT_VERSION) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_SCHEMA_UNSUPPORTED' as const,
      message: 'checkpoint schema or version is unsupported',
    });
  }
  if (typeof checkpoint.checksum !== 'string') {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint checksum is missing',
    });
  }
  const { checksum, ...payload } = checkpoint;
  let expected: string;
  try {
    expected = stableHash128Hex(canonicalJson(payload));
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint contains non-canonical data',
    });
  }
  if (checksum !== expected) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_CHECKSUM_MISMATCH' as const,
      message: 'checkpoint checksum does not match its payload',
    });
  }
  const candidate = checkpoint.state as Partial<ExecutionPlanState> | undefined;
  if (
    candidate === undefined ||
    !Array.isArray(candidate.eventLog) ||
    candidate.eventLog.length === 0 ||
    checkpoint.planId !== candidate.plan?.planId ||
    checkpoint.revision !== candidate.revision
  ) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint identity, revision, or event log is invalid',
    });
  }
  const replayed = replayExecutionEvents(candidate.eventLog);
  if (!replayed.applied) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: `checkpoint event stream is invalid (${replayed.reason})`,
    });
  }
  try {
    if (canonicalJson(replayed.state) !== canonicalJson(candidate)) {
      return Object.freeze({
        ok: false as const,
        code: 'CHECKPOINT_REPLAY_MISMATCH' as const,
        message: 'checkpoint snapshot does not match deterministic event replay',
      });
    }
  } catch {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: 'checkpoint state is not canonical plain data',
    });
  }
  const normalBasisIssue = normalBasisCheckpointIssue(replayed.state);
  if (normalBasisIssue !== null) {
    return Object.freeze({
      ok: false as const,
      code: 'CHECKPOINT_STATE_INVALID' as const,
      message: `checkpoint normal-Basis replay is invalid: ${normalBasisIssue}`,
    });
  }
  return Object.freeze({ ok: true as const, state: replayed.state });
}
