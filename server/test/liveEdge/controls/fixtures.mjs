import { createHash } from 'node:crypto';

import {
  DURABLE_CONTROL_ACK_SCHEMA,
  DURABLE_CONTROL_SCHEMA,
  OPAQUE_OWNER_REFERENCE_SCHEMA,
} from '../../../dist/liveEdge/controls/index.js';

export const START_MS = 1_720_000_000_000;

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function ref(owner, id = `${owner.toLowerCase()}.fixture`, revision = 'revision.fixture.v1') {
  return Object.freeze({
    schema: OPAQUE_OWNER_REFERENCE_SCHEMA,
    owner,
    id,
    revision,
    digest: `sha256:${hash(`${owner}|${id}|${revision}`)}`,
  });
}

export function waitingRef(id = 'waiting-l08.fixture') {
  return Object.freeze({
    ...ref('L08_RECOVERY', id),
    validation: 'WAITING_L08',
  });
}

export const riskMeasure = ref('FOUNDATION_RISK', 'worst-case-risk.fixture', 'risk-measure.v1');
export const riskBound = Object.freeze({
  measure: riskMeasure,
  maximumPostActionValue: '5',
});

export const actions = Object.freeze({
  desired: Object.freeze({
    type: 'SET_COMPONENT_DESIRED_STATE',
    component: ref('FOUNDATION_CONTROL', 'control-plane-runtime'),
    desiredState: 'RUNNING',
  }),
  pause: Object.freeze({ type: 'PAUSE_INTAKE', scope: 'NEW_RISK' }),
  resume: Object.freeze({
    type: 'RESUME_INTAKE',
    scope: 'NEW_RISK',
    reconciliation: ref('FOUNDATION_RECONCILIATION'),
  }),
  configuration: Object.freeze({
    type: 'UPDATE_BOUNDED_CONFIGURATION',
    change: Object.freeze({
      setting: 'COMPONENT_STEP_TIMEOUT_MS',
      component: ref('FOUNDATION_CONTROL', 'control-plane-runtime'),
      valueMs: 5_000,
    }),
  }),
  approve: Object.freeze({
    type: 'APPROVE',
    proposal: ref('CAPITAL_RESERVATIONS', 'proposal.fixture'),
    approvalPolicy: waitingRef('approval-policy.fixture'),
    mode: 'VALIDATE_ONLY',
  }),
  arm: Object.freeze({
    type: 'ARM',
    approval: ref('CAPITAL_APPROVALS', 'approval.fixture'),
    armingPolicy: waitingRef('arming-policy.fixture'),
    mode: 'VALIDATE_ONLY',
  }),
  disarm: Object.freeze({
    type: 'DISARM',
    arm: ref('CAPITAL_APPROVALS', 'arm.fixture'),
    cause: 'SAFETY',
  }),
  rearm: Object.freeze({
    type: 'REARM',
    priorArm: ref('CAPITAL_APPROVALS', 'arm.fixture'),
    approval: ref('CAPITAL_APPROVALS', 'approval.fixture'),
    armingPolicy: waitingRef('rearm-policy.fixture'),
    mode: 'VALIDATE_ONLY',
  }),
  revoke: Object.freeze({
    type: 'REVOKE',
    targetKind: 'APPROVAL',
    target: ref('CAPITAL_APPROVALS', 'approval.fixture'),
  }),
  halt: Object.freeze({ type: 'HALT', scope: 'NEW_RISK', retainSupervision: true }),
  reconcile: Object.freeze({
    type: 'RECONCILE',
    scope: 'ACCOUNT_AND_EXCHANGE',
    target: ref('FOUNDATION_RECONCILIATION'),
  }),
  cancel: Object.freeze({
    type: 'CANCEL',
    order: ref('L06_MUTATION_JOURNAL', 'l06mut_fixture'),
    orderPolicy: waitingRef('order-policy.fixture'),
    riskBound,
  }),
  close: Object.freeze({
    type: 'CLOSE',
    position: ref('CAPITAL_POSITIONS', 'position.fixture'),
    orderPolicy: waitingRef('close-policy.fixture'),
    riskBound,
  }),
  reduce: Object.freeze({
    type: 'REDUCE',
    position: ref('CAPITAL_POSITIONS', 'position.fixture'),
    reductionBps: 2_500,
    orderPolicy: waitingRef('reduce-policy.fixture'),
    riskBound,
  }),
  recovery: Object.freeze({
    type: 'EXECUTE_PRECOMPUTED_RECOVERY_PLAN',
    recoveryPlan: waitingRef('recovery-plan.fixture'),
    riskBound,
  }),
  repay: Object.freeze({
    type: 'REPAY_LIABILITY',
    liability: ref('CAPITAL_POSITIONS', 'liability.fixture'),
    repaymentPolicy: waitingRef('repayment-policy.fixture'),
    riskBound,
  }),
  restart: Object.freeze({
    type: 'SAFE_RESTART_COMPONENT',
    component: ref('FOUNDATION_CONTROL', 'control-plane-runtime'),
    restartMode: 'SAFE_RECONCILE_FIRST',
  }),
  acknowledge: Object.freeze({
    type: 'ACKNOWLEDGE_RECOVERY',
    recovery: ref('FOUNDATION_EXECUTION', 'recovery.fixture'),
    observedRecoveryRevision: 'recovery.revision.v1',
    statement: 'AWARENESS_ONLY',
  }),
});

export function previewRequest(action, overrides = {}) {
  return Object.freeze({
    schema: DURABLE_CONTROL_SCHEMA,
    version: 1,
    action,
    expectedConfigVersion: 11,
    reason: 'Operator confirms this bounded control.',
    ttlMs: 10_000,
    ...overrides,
  });
}

function completedReceipt(intent, outcome, firstLedgerEventId, secondLedgerEventId) {
  const awareness = outcome.kind === 'CONTROL_AWARENESS_RECORDED';
  const applied = awareness ? false : outcome.applied;
  return Object.freeze({
    schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1',
    version: 1,
    commandId: intent.commandId,
    previewDigest: intent.previewDigest,
    actionType: intent.actionType,
    disposition: awareness ? 'AWARENESS_RECORDED' : applied ? 'APPLIED' : 'NOOP',
    reasonCode: awareness ? 'AWARENESS_RECORDED' : applied ? 'CONTROL_APPLIED' : 'CONTROL_NOOP',
    actorBinding: intent.actorBinding,
    expectedConfigVersion: intent.expectedConfigVersion,
    committedControlRevision: intent.expectedControlRevision + 1,
    applied,
    recordedAtMs: outcome.occurredAtMs,
    ledgerEventIds: [firstLedgerEventId, secondLedgerEventId],
    recoveryStateChanged: false,
    externalActionAuthorization: 'NONE',
  });
}

export function createHarness(options = {}) {
  const clock = { value: START_MS };
  const calls = {
    identity: 0,
    state: 0,
    truth: 0,
    riskPreview: 0,
    riskRecheck: 0,
    lookup: 0,
    append: 0,
    inspect: 0,
    publish: 0,
    foundation: 0,
  };
  const snapshot = {
    configVersion: 11,
    controlRevision: 7,
    recoveryState: options.recoveryState ?? 'CLEAR',
    halted: options.halted ?? false,
    intakePaused: options.intakePaused ?? false,
    observedAtMs: clock.value,
    foundationRuntime: {
      revision: 3,
      desiredState: 'STOPPED',
      phase: 'STOPPED',
    },
  };
  const truth = {
    status: options.truthStatus ?? 'CURRENT_COMPLETE',
    truthRevision: 'exchange-truth.v1',
    accountRealmId: 'account.fixture',
    observedAtMs: clock.value,
    riskMeasure: {
      definition: riskMeasure,
      value: options.currentRiskValue ?? '10',
    },
  };
  const journals = new Map();
  const idempotency = new Map();
  const rejectionAudits = [];
  let commandCounter = 0;
  let ledgerEventCounter = 100;

  const identityValue = options.identity ?? {
    authenticated: true,
    subjectId: 'operator.fixture',
    sessionId: 'session.fixture',
    source: 'CLOUDFLARE_ACCESS',
    audience: 'L14_DURABLE_CONTROLS',
    authenticatedAtMs: START_MS - 1_000,
    expiresAtMs: START_MS + 120_000,
  };

  function makeAck(request, disposition, extras = {}) {
    const committed = disposition === 'COMMITTED_NEW' || disposition === 'IDEMPOTENT_REPLAY';
    return Object.freeze({
      schema: DURABLE_CONTROL_ACK_SCHEMA,
      version: 1,
      owner: 'SYSTEM_INTEGRATION_LEDGER',
      disposition,
      commandId: request.event.commandId,
      eventId: request.event.eventId,
      idempotencyKey: request.idempotencyKey,
      appendRequestDigest: request.appendRequestDigest,
      expectedJournalVersion: request.expectedJournalVersion,
      committedJournalVersion: committed ? request.expectedJournalVersion + 1 : null,
      previousHeadDigest: request.previousHeadDigest,
      committedHeadDigest: committed ? request.nextHeadDigest : null,
      appendedCount: disposition === 'COMMITTED_NEW' ? 1 : 0,
      ledgerEventId: committed ? (extras.ledgerEventId ?? ++ledgerEventCounter) : null,
      committedAtMs: committed ? (extras.committedAtMs ?? clock.value) : null,
      currentConfigVersion: snapshot.configVersion,
      currentControlRevision: snapshot.controlRevision,
      failureCode: extras.failureCode ?? null,
      externalActionAuthorization: 'NONE',
      ...extras,
    });
  }

  const deps = {
    clock: {
      nowMs() { return clock.value; },
    },
    identity: {
      async resolve() {
        calls.identity += 1;
        if (options.onIdentity) await options.onIdentity({ clock, calls });
        return identityValue;
      },
    },
    previewAuthority: {
      async mintCommandId(seed) {
        commandCounter += 1;
        if (options.onMint) {
          const result = await options.onMint({ seed, commandCounter, clock, calls });
          if (result !== undefined) return result;
        }
        return `cmd_${hash(`${seed}|${commandCounter}`).slice(0, 32)}`;
      },
      async seal(digest, actorBinding) {
        return `l14tag_${hash(`test-seal|${digest}|${actorBinding}`)}`;
      },
      async verify(digest, actorBinding, tag) {
        if (options.onVerify) await options.onVerify({ clock, calls });
        return tag === `l14tag_${hash(`test-seal|${digest}|${actorBinding}`)}`;
      },
    },
    state: {
      async read() {
        calls.state += 1;
        if (options.onState) await options.onState({ clock, calls, snapshot });
        snapshot.observedAtMs = clock.value;
        return structuredClone(snapshot);
      },
    },
    exchangeTruth: {
      async read(action) {
        calls.truth += 1;
        if (options.onTruth) await options.onTruth({ action, clock, calls, truth });
        truth.observedAtMs = clock.value;
        return structuredClone(truth);
      },
    },
    risk: {
      async preview(action, currentTruth, nowMs) {
        calls.riskPreview += 1;
        if (options.onRiskPreview) {
          const result = await options.onRiskPreview({ action, currentTruth, nowMs, clock, calls });
          if (result !== undefined) return result;
        }
        return Object.freeze({
          truthRevision: currentTruth.truthRevision,
          measureRevision: action.riskBound.measure.revision,
          currentValue: currentTruth.riskMeasure.value,
          maximumPostActionValue: action.riskBound.maximumPostActionValue,
          evaluatedAtMs: nowMs,
          authority: 'FOUNDATION_RISK',
        });
      },
      async recheck(action, witness, currentTruth, nowMs) {
        calls.riskRecheck += 1;
        if (options.onRiskRecheck) {
          const result = await options.onRiskRecheck({ action, witness, currentTruth, nowMs, clock, calls });
          if (result !== undefined) return result;
        }
        return Object.freeze({
          allowed: true,
          reasonCode: 'CONTROL_APPLIED',
          projectedPostActionValue: action.riskBound.maximumPostActionValue,
          measureRevision: action.riskBound.measure.revision,
          evaluatedAtMs: nowMs,
          authority: 'FOUNDATION_RISK',
        });
      },
    },
    persistence: {
      async lookup(commandId) {
        calls.lookup += 1;
        const journal = journals.get(commandId);
        if (!journal) return { kind: 'NOT_FOUND', journalVersion: 0, headDigest: null };
        if (journal.receipt) {
          return {
            kind: 'COMPLETED',
            previewDigest: journal.previewDigest,
            actorBinding: journal.actorBinding,
            journalVersion: journal.version,
            headDigest: journal.headDigest,
            receipt: journal.receipt,
          };
        }
        if (journal.rejection) {
          return {
            kind: 'REJECTED',
            previewDigest: journal.previewDigest,
            actorBinding: journal.actorBinding,
            journalVersion: journal.version,
            headDigest: journal.headDigest,
            rejection: journal.rejection,
          };
        }
        return {
          kind: 'PENDING',
          previewDigest: journal.previewDigest,
          actorBinding: journal.actorBinding,
          journalVersion: journal.version,
          headDigest: journal.headDigest,
        };
      },
      async append(request) {
        calls.append += 1;
        if (options.onAppend) {
          const override = await options.onAppend({ request, clock, calls, snapshot, makeAck, journals, idempotency });
          if (override !== undefined) return override;
        }
        const priorKey = idempotency.get(request.idempotencyKey);
        if (priorKey) {
          return priorKey.digest === request.appendRequestDigest
            ? makeAck(request, 'IDEMPOTENT_REPLAY', { ledgerEventId: priorKey.ledgerEventId })
            : makeAck(request, 'IDEMPOTENCY_CONFLICT', { failureCode: 'IDEMPOTENCY_CONFLICT' });
        }
        if (request.event.kind === 'CONTROL_INTENT_COMMITTED') {
          if (snapshot.configVersion !== request.event.expectedConfigVersion
            || snapshot.controlRevision !== request.event.expectedControlRevision) {
            return makeAck(request, 'VERSION_CONFLICT', {
              failureCode: snapshot.configVersion !== request.event.expectedConfigVersion
                ? 'STALE_CONFIG_VERSION'
                : 'STALE_CONTROL_REVISION',
            });
          }
          if (clock.value >= request.event.expiresAtMs) {
            return makeAck(request, 'EXPIRED', { failureCode: 'COMMAND_EXPIRED' });
          }
        }
        const current = journals.get(request.event.commandId);
        const currentVersion = current?.version ?? 0;
        const currentHead = current?.headDigest ?? null;
        if (request.expectedJournalVersion !== currentVersion || request.previousHeadDigest !== currentHead) {
          return makeAck(request, 'VERSION_CONFLICT', { failureCode: 'STALE_CONTROL_REVISION' });
        }
        if (request.event.kind === 'CONTROL_INTENT_COMMITTED') {
          // The canonical persistence transaction reserves the global control
          // revision before publication, so two command IDs cannot apply the
          // same optimistic version.
          snapshot.controlRevision = request.event.expectedControlRevision + 1;
        }
        const ledgerEventId = ++ledgerEventCounter;
        const ack = makeAck(request, 'COMMITTED_NEW', { ledgerEventId });
        idempotency.set(request.idempotencyKey, { digest: request.appendRequestDigest, ledgerEventId });
        if (request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === false) {
          rejectionAudits.push(Object.freeze({ event: request.event, ledgerEventId }));
          return ack;
        }
        const next = current ?? {
          previewDigest: request.event.previewDigest,
          actorBinding: request.event.actorBinding,
          events: [],
        };
        next.events.push({ event: request.event, ledgerEventId });
        next.version = request.expectedJournalVersion + 1;
        next.headDigest = request.nextHeadDigest;
        if (request.event.kind === 'CONTROL_APPLIED' || request.event.kind === 'CONTROL_AWARENESS_RECORDED') {
          next.receipt = completedReceipt(
            next.events[0].event,
            request.event,
            next.events[0].ledgerEventId,
            ledgerEventId,
          );
        }
        if (request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === true) {
          const intent = next.events[0].event;
          next.rejection = Object.freeze({
            schema: 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1',
            version: 1,
            commandId: intent.commandId,
            previewDigest: intent.previewDigest,
            actionType: intent.actionType,
            actorBinding: intent.actorBinding,
            reasonCode: request.event.reasonCode,
            expectedConfigVersion: intent.expectedConfigVersion,
            committedControlRevision: intent.expectedControlRevision + 1,
            recordedAtMs: request.event.occurredAtMs,
            ledgerEventIds: [next.events[0].ledgerEventId, ledgerEventId],
            recoveryStateChanged: false,
            externalActionAuthorization: 'NONE',
          });
        }
        journals.set(request.event.commandId, next);
        return ack;
      },
    },
    owner: {
      async inspect(action) {
        calls.inspect += 1;
        if (options.onInspect) {
          const result = await options.onInspect({ action, clock, calls, snapshot });
          if (result !== undefined) return result;
        }
        return {
          accepted: true,
          reasonCode: 'CONTROL_APPLIED',
          riskIncreasing: ['RESUME_INTAKE', 'UPDATE_BOUNDED_CONFIGURATION'].includes(action.type),
        };
      },
      async publishCommitted(action, context) {
        calls.publish += 1;
        const base = {
          accepted: true,
          applied: true,
          reasonCode: 'CONTROL_APPLIED',
          evaluatedAtMs: clock.value,
          deadlineAtMs: context.expiresAtMs,
          deadlineHonored: clock.value < context.expiresAtMs,
          observedConfigVersion: snapshot.configVersion,
          observedControlRevision: snapshot.controlRevision,
        };
        if (options.onPublish) {
          const result = await options.onPublish({ action, context, clock, calls, snapshot });
          if (result !== undefined) return { ...base, ...result, evaluatedAtMs: result.evaluatedAtMs ?? clock.value };
        }
        return { ...base, evaluatedAtMs: clock.value, deadlineHonored: clock.value < context.expiresAtMs };
      },
    },
    foundation: {
      issue(request) {
        calls.foundation += 1;
        if (options.onFoundation) return options.onFoundation({ request, clock, calls, snapshot });
        return {
          ok: true,
          value: {
            commandId: `cmd_${hash(JSON.stringify(request)).slice(0, 16)}`,
            correlationId: `cor_${hash(JSON.stringify(request)).slice(0, 16)}`,
            command: request.command,
            revision: request.revision,
            applied: true,
            detail: 'accepted by synthetic Foundation fixture',
          },
        };
      },
    },
  };

  return { clock, calls, snapshot, truth, journals, rejectionAudits, deps, identityValue, makeAck };
}
