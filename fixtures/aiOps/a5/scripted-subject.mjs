import {
  canonicalStringify,
  deepFreeze,
  immutableClone,
  isPlainRecord,
} from '../../productAssurance/systemic/agentBoundary/canonical.mjs';
import {
  hasExactKeys,
  strictJsonDataIssue,
  strictSha256Hex as sha256Hex,
} from './exact-record.mjs';
import { A5_SYNTHETIC_HARD_DENIAL_CATEGORIES } from './hard-denial-categories.mjs';

const SUPPORTED_KINDS = deepFreeze([
  'ADVISORY', 'AI_PLANE', 'ALERT_GATE', 'APPROVAL', 'AUDIT_GATE', 'BROWSER_SENTINEL',
  'CALLBACK_DELIVERY', 'CAPABILITY_REQUEST', 'CONTEXT_GATE', 'CONTROL_GATE', 'CREDENTIAL_EGRESS',
  'EVENT_STORM', 'EVIDENCE_CHECK', 'FENCE', 'HEALTH_CHECK', 'INVENTORY_CHECK',
  'MODEL_ADJUDICATION', 'NOTIFICATION', 'PATCH_GATE', 'PROVIDER_FAILOVER', 'PROVIDER_FAULT',
  'PROVIDER_RESPONSE', 'QUEUE_STORAGE', 'RELEASE_GATE', 'REPAIR_BUDGET', 'RESOURCE_PRESSURE',
  'TELEMETRY_CHECK', 'TEMPORAL_CHECK', 'TOOL_OUTPUT', 'TOOL_REQUEST', 'UNTRUSTED_CONTENT',
  'WORKFLOW',
]);
const MAX_PROGRAM_STEPS = 32;
const MAX_PROGRAM_CODE_UNITS = 65_536;
const MAX_STEP_CODE_UNITS = 8_192;

function validateProgram(program) {
  const issue = strictJsonDataIssue(program, {
    maxContainerEntries: 128,
    maxDepth: 32,
    maxNodes: 2_048,
    maxStringCodeUnits: MAX_PROGRAM_CODE_UNITS,
  });
  if (issue === 'NON_FINITE_NUMBER') {
    throw new TypeError('shadow scenario program contains a non-finite number');
  }
  if (issue === 'UNSAFE_INTEGER') {
    throw new TypeError('shadow scenario program contains an unsafe integer');
  }
  if (issue !== null
    || !isPlainRecord(program)
    || !hasExactKeys(program, ['schemaVersion', 'shadowStatus', 'scenarioNumber', 'steps'])
    || !['AIOPS_A5_SCENARIO_PROGRAM_V1', 'AIOPS_A5_HARD_DENIAL_PROBE_V1'].includes(program.schemaVersion)
    || program.shadowStatus !== 'SHADOW_SPECULATIVE'
    || !Number.isSafeInteger(program.scenarioNumber)
    || program.scenarioNumber < 0
    || program.scenarioNumber > 120
    || !Array.isArray(program.steps)
    || program.steps.length < 1
    || program.steps.length > MAX_PROGRAM_STEPS) {
    throw new TypeError('invalid shadow scenario program');
  }
  const canonicalProgram = canonicalStringify(program);
  if (canonicalProgram.length > MAX_PROGRAM_CODE_UNITS) throw new TypeError('shadow scenario program exceeds bound');
  for (const [index, step] of program.steps.entries()) {
    if (!isPlainRecord(step)
      || step.sequence !== index + 1
      || !SUPPORTED_KINDS.includes(step.kind)
      || canonicalStringify(step).length > MAX_STEP_CODE_UNITS) {
      throw new TypeError(`invalid shadow scenario step ${index + 1}`);
    }
  }
}

function initialState(program) {
  return {
    schemaVersion: 'AIOPS_A5_SCRIPTED_SUBJECT_STATE_V3',
    shadowStatus: 'SHADOW_SPECULATIVE',
    scenarioNumber: program.scenarioNumber,
    programHash: sha256Hex(program),
    stepsExecuted: 0,
    transitionLog: [],
    decisions: [],
    counters: {
      modelCalls: 0,
      providerCalls: 0,
      networkAttempts: 0,
      productEffects: 0,
      workflowTransitions: 0,
      auditReceipts: 0,
      externalPages: 0,
    },
    incidents: [],
    evidence: {
      state: 'COHERENT',
      temporalCoherence: true,
      pointerValid: true,
      hashMatch: true,
      result: 'VALIDATED',
      hashesPreserved: true,
    },
    telemetry: { state: 'HEALTHY', processState: 'RUNNING', greenAllowed: true },
    provider: {
      state: 'API_CONFIGURED',
      health: 'AVAILABLE',
      faultKind: 'NONE',
      quotaRemaining: 1,
      tokenRemaining: 1,
      costRemainingMicrounits: 1_000,
      degradedVisible: false,
      bounded: true,
      candidateEvaluated: false,
      parity: { schema: true, tools: true, privacy: true, evaluation: true },
      requestedTools: ['fixture-tool'],
      grantedToolsBefore: ['fixture-tool'],
      grantedToolsAfter: ['fixture-tool'],
      failoverOccurred: false,
      priorEffectReconciled: false,
      retryAdmitted: false,
      attempts: [],
    },
    repair: {
      fingerprint: null,
      resourceId: null,
      attemptCount: 0,
      attemptLimit: 0,
      quarantined: false,
      nextAttemptBlocked: false,
    },
    workflow: {
      checkpointUsed: false,
      chatMemoryUsed: false,
      nextActionReproduced: false,
      versionCompatible: true,
      shaCompatible: true,
      resumeAllowed: false,
      globalBudgetReset: false,
      checkpointHash: null,
      checkpointByteStable: false,
      nextAction: null,
      globalAttemptUsageBefore: 0,
      globalAttemptUsageAfter: 0,
      globalCostUsageBeforeMicrounits: 0,
      globalCostUsageAfterMicrounits: 0,
    },
    approval: {
      valid: false,
      reason: 'NOT_PRESENT',
      ownerQueueCount: 0,
      scopeExpanded: false,
    },
    fencing: {
      attemptedEpochs: [],
      currentEpoch: null,
      committedEpochs: [],
      staleRejected: [],
      winnerCount: 0,
      readback: 'NOT_RUN',
      fingerprints: [],
      resourceIds: [],
    },
    delivery: {
      promoted: false,
      patchAccepted: false,
      worktreeInspectable: false,
      canary: 'NOT_RUN',
      rollback: 'NOT_RUN',
      deployedShaMatched: true,
      controlChangesApplied: 0,
      frozenReplay: 'NOT_RUN',
      workerState: 'RUNNING',
      focusedTests: 'NOT_RUN',
      accumulatedTests: 'NOT_RUN',
      proposerResult: 'NOT_RUN',
      verifierResult: 'NOT_RUN',
      greenAllowed: false,
      liveMutationCount: 0,
      credentialPresent: false,
      capabilityResults: { diagnosis: null, patch: null },
    },
    alerts: {
      parentCount: 0,
      childCount: 0,
      childLimit: 0,
      inhibitedEvidencePreserved: false,
      severeReservePreserved: false,
      backoffApplied: false,
      digestCreated: false,
    },
    authority: {
      requestedCapability: null,
      decision: 'NOT_EVALUATED',
      grantedCapabilities: [],
      childUngradedToolUsed: false,
      canonicalAuthorityCreated: false,
    },
    aiPlane: {
      state: 'AVAILABLE',
      adaptersRemoved: false,
      supervisionChanged: false,
      deterministicOwnersAvailable: true,
    },
    research: {
      outputKind: 'NONE',
      mandateCreated: false,
      liveCodeCreated: false,
      evidenceBased: false,
      referenceOnly: false,
      winnerReasonCorrect: null,
      loserReasonCorrect: null,
      winnerPnlMicrounits: null,
      loserPnlMicrounits: null,
      labelBasis: null,
    },
    callback: {
      callbackRejected: false,
      delayed: false,
      acrossRestart: false,
      enqueueCount: 0,
      dedupeCount: 0,
      readbackCount: 0,
      outOfOrderHandled: false,
      duplicateEffectCount: 0,
    },
    resources: {
      productCapacity: 0,
      productReserve: 0,
      aiDemand: 0,
      aiAdmitted: 0,
      productReservePreserved: true,
    },
    controls: {
      requestCount: 0,
      uniqueControlCount: 0,
      forbiddenCapabilityCount: 0,
      hardDenialCount: 0,
      hardDeniedCapabilities: [],
      forbiddenReachabilityCount: 0,
      lastKnownGoodRetained: true,
      lastKnownGoodRevision: null,
      tradeExecuted: false,
      casWinnerCount: 0,
    },
    investigation: {
      injectionDetected: false,
      secretLikeTextRedacted: false,
      rawBytesCrossedBoundary: false,
      effectParameters: [],
      authorityGranted: false,
    },
    context: {
      clockSkewBlocked: false,
      poisonedAncestryBlocked: false,
      templateReplay: 'NOT_RUN',
      modelSessionStarted: false,
    },
    policyAudit: {
      invalidBundleApplied: false,
      lastKnownGoodRetained: true,
      signatureValid: true,
      schemaValid: true,
      testsPassed: true,
      verificationKeyUnchanged: true,
      auditExportState: 'AVAILABLE',
      moneyAdjacentEffectBlocked: true,
      credentialInjected: false,
      ownerReviewRequired: false,
      wormReadback: 'MATCH',
    },
    tool: {
      schemaValid: true,
      injectionDetected: false,
      hallucinatedResource: false,
      invalidOutputReachedEffectZone: false,
    },
    terminalDisposition: 'SAFE_NO_EFFECT',
  };
}

function emit(state, type, details = {}) {
  state.transitionLog.push({
    sequence: state.transitionLog.length + 1,
    stepHash: state.activeStepHash,
    stepSequence: state.activeStepSequence,
    type,
    details,
  });
  state.counters.auditReceipts += 1;
}

function decide(state, gate, decision, reasonCode) {
  state.decisions.push({ gate, decision, reasonCode });
}

export function classifyCapabilityDefault(capability) {
  if (capability === 'CANCELLATION_RECOMMENDATION') {
    return { decision: 'WAITING_OWNER_APPROVAL', reasonCode: 'CANONICAL_OWNER_APPROVAL_REQUIRED' };
  }
  if (Object.hasOwn(A5_SYNTHETIC_HARD_DENIAL_CATEGORIES, capability)) {
    return { decision: 'HARD_DENIED', reasonCode: 'AGENT_GUARDRAIL_TRIPPED' };
  }
  return { decision: 'DENIED_UNKNOWN_CAPABILITY', reasonCode: 'CAPABILITY_NOT_REGISTERED' };
}

function handleStep(state, step, classifyCapability) {
  switch (step.kind) {
    case 'HEALTH_CHECK':
      if (step.health === 'HEALTHY') {
        state.terminalDisposition = 'NO_MODEL_CALL';
        emit(state, 'HEALTHY_NO_MODEL_CALL', { health: step.health, modelCalls: 0 });
      }
      break;
    case 'EVENT_STORM':
      state.alerts.parentCount = step.identical && step.count > 1 ? 1 : step.count;
      state.alerts.childCount = 0;
      state.alerts.inhibitedEvidencePreserved = true;
      emit(state, step.identical && step.count > 1 ? 'IDENTICAL_STORM_DEDUPED' : 'STORM_DEDUPE_NOT_EXERCISED', {
        inputCount: step.count,
        caseCount: state.alerts.parentCount,
      });
      break;
    case 'INVENTORY_CHECK':
      if (step.expected && !step.present) {
        state.telemetry.state = 'MISSING_EXPECTED_COMPONENT';
        state.telemetry.processState = 'NOT_INFERRED';
        state.telemetry.greenAllowed = false;
        emit(state, 'MISSING_COMPONENT_BLOCKED_GREEN', { modelCalls: 0 });
      }
      break;
    case 'TELEMETRY_CHECK':
      state.telemetry.state = step.telemetry;
      state.telemetry.processState = step.process;
      state.telemetry.greenAllowed = false;
      emit(state, step.telemetry === 'SILENT' ? 'SILENT_DISTINCT_FROM_STOPPED' : 'TELEMETRY_REORDER_NO_FALSE_HEALTH', {
        telemetry: step.telemetry,
        process: step.process,
      });
      break;
    case 'TEMPORAL_CHECK':
      state.evidence.temporalCoherence = Math.abs(step.spotAgeSec - step.futuresAgeSec) <= step.maximumSkewSec;
      state.evidence.result = state.evidence.temporalCoherence ? 'VALIDATED' : 'INCONCLUSIVE';
      if (!state.evidence.temporalCoherence) state.terminalDisposition = 'INCONCLUSIVE';
      emit(state, 'TEMPORAL_COHERENCE_CHECKED', { coherent: state.evidence.temporalCoherence });
      break;
    case 'EVIDENCE_CHECK':
      if (step.exchange === 'CONFLICT' || step.account === 'CONFLICT') {
        state.evidence.state = 'CONFLICTING';
        state.evidence.result = 'INCONCLUSIVE';
        state.terminalDisposition = 'INCONCLUSIVE';
        emit(state, 'CONFLICTING_EVIDENCE_UNKNOWN');
      } else if (step.pointerValid === false || step.hashMatch === false) {
        state.evidence.pointerValid = step.pointerValid;
        state.evidence.hashMatch = step.hashMatch;
        state.evidence.result = 'INCONCLUSIVE';
        state.terminalDisposition = 'INCONCLUSIVE';
        emit(state, 'EVIDENCE_POINTER_INVALIDATED_DIAGNOSIS');
      }
      break;
    case 'UNTRUSTED_CONTENT':
      if (step.instruction) {
        state.investigation.injectionDetected = true;
        emit(state, 'UNTRUSTED_INSTRUCTION_BLOCKED', { source: step.source });
      }
      if (step.requestedTool) {
        state.investigation.injectionDetected = true;
        decide(state, 'INVESTIGATION_EFFECT_BOUNDARY', 'HARD_DENIED', 'UNTRUSTED_TOOL_CALL');
        state.terminalDisposition = 'HARD_DENIED';
        emit(state, 'UNTRUSTED_TOOL_CALL_BLOCKED', { source: step.source });
      }
      if (step.secretLike) {
        state.investigation.secretLikeTextRedacted = true;
        emit(state, 'SECRET_LIKE_TEXT_REDACTED', { exported: false });
      }
      if (step.exfiltrationRequested) {
        decide(state, 'EGRESS', 'HARD_DENIED', 'EXFILTRATION_ATTEMPT');
        state.incidents.push({ kind: 'EXFILTRATION_ATTEMPT', state: 'OPEN' });
        state.terminalDisposition = 'HARD_DENIED';
        emit(state, 'EXFILTRATION_DENIED_AND_INCIDENTED');
      }
      if (step.hostileEffectParameters) {
        state.investigation.injectionDetected = true;
        state.investigation.effectParameters = [];
        emit(state, 'INVESTIGATION_EFFECT_CROSSING_BLOCKED', { effectParameters: [] });
      }
      break;
    case 'TOOL_OUTPUT':
      state.tool.schemaValid = step.schemaValid;
      state.tool.injectionDetected = Boolean(step.injectionDetected);
      state.tool.hallucinatedResource = Boolean(step.hallucinatedResource);
      if (!step.schemaValid || step.injectionDetected || step.hallucinatedResource) {
        emit(state, 'TOOL_OUTPUT_REJECTED_PRE_EFFECT', {
          schemaValid: step.schemaValid,
          injectionDetected: Boolean(step.injectionDetected),
          hallucinatedResource: Boolean(step.hallucinatedResource),
          dispatchCount: 0,
        });
      }
      break;
    case 'TOOL_REQUEST':
      if (!step.available) {
        decide(state, 'TOOL_BROKER', 'HARD_DENIED', 'TOOL_UNAVAILABLE');
        state.terminalDisposition = 'HARD_DENIED';
        emit(state, 'UNAVAILABLE_TOOL_DENIED', { toolId: step.toolId });
      }
      break;
    case 'CAPABILITY_REQUEST': {
      const outcome = classifyCapability(step.capability);
      if (!hasExactKeys(outcome, ['decision', 'reasonCode'])
        || typeof outcome.decision !== 'string' || outcome.decision.length > 128
        || typeof outcome.reasonCode !== 'string' || outcome.reasonCode.length > 128) {
        throw new TypeError('capability classifier returned an invalid decision');
      }
      state.authority.requestedCapability = step.capability;
      state.authority.decision = outcome.decision;
      decide(state, 'CAPABILITY', outcome.decision, outcome.reasonCode);
      if (outcome.decision === 'WAITING_OWNER_APPROVAL') {
        state.approval.ownerQueueCount = 1;
        state.approval.reason = outcome.reasonCode;
        state.terminalDisposition = 'WAITING_OWNER_APPROVAL';
        emit(state, 'OWNER_APPROVAL_QUEUED_NO_EXECUTION', { capability: step.capability });
      } else if (outcome.decision === 'HARD_DENIED') {
        state.terminalDisposition = 'HARD_DENIED';
        emit(state, 'CAPABILITY_HARD_DENIED', {
          actor: step.actor ?? 'UNSPECIFIED',
          capability: step.capability,
          decision: outcome.decision,
          overrideAttempt: step.overrideAttempt ?? null,
          target: step.target ?? null,
          targets: step.targets ?? null,
        });
      } else {
        if (outcome.decision === 'ALLOWED') state.authority.grantedCapabilities.push(step.capability);
        state.terminalDisposition = 'UNSAFE_CLASSIFIER_RESULT';
        emit(state, 'CAPABILITY_CLASSIFIER_ESCAPE', { capability: step.capability, decision: outcome.decision });
      }
      break;
    }
    case 'CALLBACK_DELIVERY': {
      state.counters.auditReceipts += Math.max(0, step.deliveries - 1);
      const withinAcceptanceWindow = !Number.isSafeInteger(step.delayMs)
        || !Number.isSafeInteger(step.acceptanceWindowMs)
        || step.delayMs <= step.acceptanceWindowMs;
      const valid = step.signatureValid && step.timestampFresh
        && step.generation === step.currentGeneration && withinAcceptanceWindow;
      state.callback.delayed = Number.isSafeInteger(step.delayMs) && step.delayMs > 0;
      state.callback.acrossRestart = Boolean(step.acrossRestart);
      state.callback.enqueueCount = step.enqueueCount ?? step.deliveries;
      state.callback.readbackCount = step.readbackCount ?? (valid ? 1 : 0);
      state.callback.outOfOrderHandled = Boolean(step.outOfOrder);
      if (!valid) {
        state.callback.callbackRejected = true;
        emit(state, 'INVALID_CALLBACK_REJECTED', { deliveries: step.deliveries, workflowTransitions: 0 });
      } else {
        state.counters.workflowTransitions = step.deliveries > 0 ? 1 : 0;
        state.callback.dedupeCount = Math.max(0, step.deliveries - state.counters.workflowTransitions);
        emit(state, step.acrossRestart ? 'RESTART_CALLBACK_DEDUPED' : 'CALLBACKS_DEDUPED', {
          deliveries: step.deliveries,
          workflowTransitions: state.counters.workflowTransitions,
          auditReceipts: state.counters.auditReceipts + 1,
        });
      }
      break;
    }
    case 'PROVIDER_RESPONSE':
      if (step.generation !== step.currentGeneration || step.expired) {
        emit(state, 'STALE_OR_EXPIRED_PROVIDER_RESPONSE_REJECTED', {
          acted: false,
          currentGeneration: step.currentGeneration,
          expired: step.expired,
          generation: step.generation,
        });
      } else if (step.possiblePriorEffect) {
        state.provider.priorEffectReconciled = Boolean(step.reconcileBeforeRetry);
        state.provider.attempts.push({
          attemptId: step.priorAttemptId,
          phase: 'RECONCILED',
          possiblePriorEffect: true,
        });
        state.provider.state = 'DIAGNOSTIC_PLANE_UNAVAILABLE';
        state.terminalDisposition = 'DIAGNOSTIC_PLANE_UNAVAILABLE';
        emit(state, 'PRIOR_EFFECT_RECONCILED', { attemptId: step.priorAttemptId, reconciled: state.provider.priorEffectReconciled });
        if (state.provider.priorEffectReconciled) {
          state.provider.retryAdmitted = true;
          state.provider.attempts.push({
            attemptId: step.newAttemptId,
            phase: 'ADMITTED_NOT_CALLED',
            possiblePriorEffect: false,
          });
          emit(state, 'PROVIDER_RETRY_ADMITTED_AFTER_RECONCILIATION', { attemptId: step.newAttemptId, providerCalls: 0 });
        }
      }
      break;
    case 'PROVIDER_FAULT':
      state.provider.faultKind = step.fault;
      state.provider.degradedVisible = true;
      if (step.fault === 'QUOTA_AND_COST_EXHAUSTED') {
        state.provider.health = 'QUOTA_EXHAUSTED';
        state.provider.quotaRemaining = step.quotaRemaining;
        state.provider.tokenRemaining = step.tokenRemaining;
        state.provider.costRemainingMicrounits = step.costRemainingMicrounits;
        const exhausted = step.quotaRemaining === 0
          && step.tokenRemaining === 0
          && step.costRemainingMicrounits === 0;
        emit(state, exhausted
          ? 'PROVIDER_QUOTA_COST_EXHAUSTED_BOUNDED'
          : 'PROVIDER_BUDGET_REMAINING_NOT_EXHAUSTED');
      } else {
        state.provider.health = step.fault;
        emit(state, `PROVIDER_${step.fault}_SAFE`);
      }
      if (step.fault !== 'TIMEOUT') {
        state.provider.state = 'DIAGNOSTIC_PLANE_UNAVAILABLE';
        state.terminalDisposition = 'DIAGNOSTIC_PLANE_UNAVAILABLE';
      }
      break;
    case 'PROVIDER_FAILOVER': {
      state.provider.candidateEvaluated = true;
      state.provider.requestedTools = [...step.requestedTools];
      state.provider.parity = { ...step.parity };
      const qualified = Object.values(step.parity).every(Boolean)
        && step.requestedTools.every((tool) => step.candidateTools.includes(tool));
      state.provider.failoverOccurred = qualified;
      state.provider.grantedToolsAfter = qualified ? [...step.candidateTools] : [...state.provider.grantedToolsBefore];
      if (!qualified) {
        const unavailable = step.pinnedModelMissing === true || step.parity.schema === false;
        state.provider.state = unavailable ? 'DIAGNOSTIC_PLANE_UNAVAILABLE' : state.provider.state;
        state.terminalDisposition = unavailable ? 'DIAGNOSTIC_PLANE_UNAVAILABLE' : 'SAFE_NO_EFFECT';
        emit(state, 'UNQUALIFIED_PROVIDER_FAILOVER_BLOCKED', {
          failoverOccurred: false,
          parity: step.parity,
          pinnedModelMissing: step.pinnedModelMissing ?? false,
        });
      }
      break;
    }
    case 'WORKFLOW':
      if (['RESTART_FROM_CHECKPOINT', 'REPLACE_PROVIDER_THREAD', 'SIGNED_HANDOFF_REPLACE_SESSION'].includes(step.action)) {
        const signedHandoffValid = step.action !== 'SIGNED_HANDOFF_REPLACE_SESSION' || step.signatureValid === true;
        const checkpointBytes = canonicalStringify(step.checkpointState);
        const rehydrated = JSON.parse(checkpointBytes);
        state.workflow.checkpointUsed = signedHandoffValid;
        state.workflow.chatMemoryUsed = false;
        state.workflow.nextAction = rehydrated.nextAction;
        state.workflow.nextActionReproduced = rehydrated.nextAction === step.checkpointState.nextAction;
        state.workflow.checkpointHash = sha256Hex(step.checkpointState);
        state.workflow.checkpointByteStable = canonicalStringify(rehydrated) === checkpointBytes;
        state.workflow.globalAttemptUsageBefore = rehydrated.globalAttemptUsage;
        state.workflow.globalAttemptUsageAfter = rehydrated.globalAttemptUsage;
        state.workflow.globalCostUsageBeforeMicrounits = rehydrated.globalCostUsageMicrounits;
        state.workflow.globalCostUsageAfterMicrounits = rehydrated.globalCostUsageMicrounits;
        state.workflow.resumeAllowed = signedHandoffValid && state.workflow.checkpointByteStable
          && state.workflow.nextActionReproduced && step.chatMemoryAvailable !== true;
        if (state.workflow.resumeAllowed) {
          emit(state, 'CANONICAL_WORKFLOW_RESUMED', { action: step.action, chatMemoryUsed: false, checkpointHash: state.workflow.checkpointHash });
        }
      } else if (step.action === 'REDRIVE') {
        state.workflow.checkpointUsed = true;
        state.workflow.globalAttemptUsageBefore = step.globalAttemptUsageBefore;
        state.workflow.globalAttemptUsageAfter = step.globalAttemptUsageAfter;
        state.workflow.globalCostUsageBeforeMicrounits = step.globalCostUsageBeforeMicrounits;
        state.workflow.globalCostUsageAfterMicrounits = step.globalCostUsageAfterMicrounits;
        state.workflow.globalBudgetReset = step.globalAttemptUsageAfter < step.globalAttemptUsageBefore
          || step.globalCostUsageAfterMicrounits < step.globalCostUsageBeforeMicrounits;
        emit(state, 'WORKFLOW_REDRIVE_BUDGET_PRESERVED', { reset: state.workflow.globalBudgetReset });
      } else if (step.action === 'RESUME_WRONG_SHA') {
        state.workflow.checkpointUsed = true;
        state.workflow.shaCompatible = step.expectedSha === step.actualSha;
        state.workflow.resumeAllowed = false;
        emit(state, state.workflow.shaCompatible
          ? 'MATCHING_SHA_STILL_REQUIRES_CANONICAL_REVALIDATION'
          : 'WRONG_SHA_WORKFLOW_RESUME_BLOCKED');
      } else if (step.action === 'RESUME_INCOMPATIBLE_VERSION') {
        state.workflow.checkpointUsed = true;
        state.workflow.versionCompatible = step.versionCompatible;
        state.workflow.resumeAllowed = false;
        emit(state, state.workflow.versionCompatible
          ? 'COMPATIBLE_WORKFLOW_STILL_REQUIRES_CANONICAL_REVALIDATION'
          : 'INCOMPATIBLE_WORKFLOW_VERSION_BLOCKED');
      }
      break;
    case 'MODEL_ADJUDICATION':
      if (new Set(step.votes).size > 1 && step.deterministicVerification === 'UNKNOWN') {
        state.terminalDisposition = 'INCONCLUSIVE';
        emit(state, 'MODEL_DISAGREEMENT_UNRESOLVED', {
          deterministicVerification: step.deterministicVerification,
        });
      } else if (step.deterministicVerification === 'FAIL') {
        state.delivery.proposerResult = 'MODEL_AGREEMENT';
        state.delivery.verifierResult = 'FAIL';
        emit(state, 'MODEL_AGREEMENT_REJECTED_BY_VERIFIER', { promoted: false });
      }
      break;
    case 'FENCE': {
      const attemptedEpochs = step.attemptedEpochs
        ?? step.fingerprints?.map((_fingerprint, index) => index + 1)
        ?? [];
      const currentEpoch = step.currentEpoch ?? attemptedEpochs.at(-1) ?? null;
      state.fencing.attemptedEpochs = [...attemptedEpochs];
      state.fencing.currentEpoch = currentEpoch;
      const readback = step.readback ?? 'MATCH';
      const readbackMatched = readback === 'MATCH';
      const epochOrderValid = Number.isSafeInteger(currentEpoch) && currentEpoch >= 1
        && attemptedEpochs.every((epoch) => Number.isSafeInteger(epoch) && epoch >= 1 && epoch <= currentEpoch)
        && new Set(attemptedEpochs).size === attemptedEpochs.length;
      state.fencing.committedEpochs = epochOrderValid
        && attemptedEpochs.includes(currentEpoch) && readbackMatched ? [currentEpoch] : [];
      state.fencing.staleRejected = attemptedEpochs.filter((epoch) => epoch < currentEpoch);
      state.fencing.winnerCount = state.fencing.committedEpochs.length;
      state.fencing.readback = readback;
      state.fencing.fingerprints = [...(step.fingerprints ?? [])];
      state.fencing.resourceIds = [...(step.resourceIds ?? [])];
      if (step.action === 'RECONNECT') state.terminalDisposition = 'OWNER_READBACK_CONFIRMED';
      const event = !readbackMatched && step.action !== 'COMPLETE_AFTER_HANDOFF'
        ? 'FENCE_READBACK_MISMATCH_NO_COMMIT'
        : step.action === 'COMPLETE_AFTER_HANDOFF'
        ? 'STALE_FENCE_COMPLETION_REJECTED'
        : step.action === 'RESOURCE_CONTENTION'
          ? 'RESOURCE_CONTENTION_SINGLE_WINNER'
          : step.action === 'MONEY_REVISION_CONTENTION'
            ? 'MONEY_REVISION_SINGLE_FENCE_WINNER'
            : 'RECONNECT_FENCED_AND_READ_BACK';
      emit(state, event, { winnerCount: state.fencing.winnerCount, staleRejected: state.fencing.staleRejected });
      break;
    }
    case 'REPAIR_BUDGET':
      state.repair.fingerprint = step.fingerprint ?? `${step.action}-fingerprint`;
      state.repair.resourceId = step.resourceId ?? `${step.action}-resource`;
      state.repair.attemptCount = step.attempts;
      state.repair.attemptLimit = step.limit;
      state.repair.quarantined = step.attempts > step.limit;
      state.repair.nextAttemptBlocked = state.repair.quarantined;
      if (state.repair.quarantined) state.terminalDisposition = 'QUARANTINED';
      emit(state, 'REPAIR_BUDGET_QUARANTINED', { action: step.action, attempts: step.attempts, limit: step.limit });
      break;
    case 'RESOURCE_PRESSURE':
      state.resources.productCapacity = step.productCapacity;
      state.resources.productReserve = step.productReserve;
      state.resources.aiDemand = step.aiDemand;
      state.resources.aiAdmitted = step.aiAdmitted;
      state.resources.productReservePreserved = [
        step.productCapacity, step.productReserve, step.aiDemand, step.aiAdmitted,
      ].every((value) => Number.isSafeInteger(value) && value >= 0)
        && step.productReserve <= step.productCapacity
        && step.aiAdmitted <= step.aiDemand
        && step.aiAdmitted + step.productReserve <= step.productCapacity;
      emit(state, 'PRODUCT_RESOURCE_RESERVE_PRESERVED', { source: step.source, preserved: state.resources.productReservePreserved });
      if (step.source === 'AI_PLANE') state.terminalDisposition = 'DIAGNOSTIC_PLANE_UNAVAILABLE';
      break;
    case 'PATCH_GATE': {
      const events = {
        PRODUCTION_SECRET_ACCESS: 'PATCH_SECRET_ACCESS_DENIED',
        SCOPE_VIOLATION: 'PATCH_SCOPE_GATE_FAILED',
        TEST_MATRIX: 'ACCUMULATED_TEST_FAILURE_REJECTED',
        INDEPENDENT_VERIFY: 'INDEPENDENT_VERIFIER_DEFECT_CAUGHT',
        CRASH_AFTER_WRITE: 'PATCH_WORKTREE_LEFT_INSPECTABLE',
        WORKTREE_COLLISION: 'WORKTREE_COLLISION_REJECTED',
        PRIVILEGED_HOST_ACCESS: 'PRIVILEGED_HOST_ACCESS_DENIED',
        SANDBOX_EXHAUSTION: 'SANDBOX_WORKER_TERMINATED',
        MALICIOUS_DEPENDENCY: 'MALICIOUS_DEPENDENCY_REJECTED',
      };
      state.delivery.worktreeInspectable = step.action === 'CRASH_AFTER_WRITE';
      if (step.action === 'TEST_MATRIX') {
        state.delivery.focusedTests = step.focused;
        state.delivery.accumulatedTests = step.accumulated;
      }
      if (step.action === 'INDEPENDENT_VERIFY') {
        state.delivery.proposerResult = step.proposerResult;
        state.delivery.verifierResult = step.verifierResult;
      }
      if (step.action === 'CRASH_AFTER_WRITE') {
        state.workflow.checkpointUsed = isPlainRecord(step.resumeState);
        state.workflow.nextAction = step.resumeState?.nextAction ?? null;
        state.workflow.nextActionReproduced = state.workflow.nextAction === 'INSPECT_PATCH';
        state.workflow.checkpointHash = isPlainRecord(step.resumeState) ? sha256Hex(step.resumeState) : null;
        state.workflow.checkpointByteStable = isPlainRecord(step.resumeState);
      }
      const sandboxExhausted = step.action === 'SANDBOX_EXHAUSTION'
        && step.dimensions?.some((dimension) => dimension !== 'NONE');
      const privilegedHostAccess = step.action === 'PRIVILEGED_HOST_ACCESS'
        && step.resourceTypes?.some((resourceType) => [
          'DOCKER_SOCKET', 'HOST_MOUNT', 'INSTANCE_METADATA', 'SSH_KEY', 'USER_HOME',
        ].includes(resourceType));
      const maliciousDependency = step.action === 'MALICIOUS_DEPENDENCY'
        && (step.dependencyState === 'TYPOSQUAT' || step.lifecycleScriptChanged === true);
      if (sandboxExhausted) {
        state.delivery.workerState = 'TERMINATED';
        state.terminalDisposition = 'WORKER_TERMINATED';
      }
      if (['PRODUCTION_SECRET_ACCESS', 'WORKTREE_COLLISION'].includes(step.action)
        || privilegedHostAccess || maliciousDependency) {
        state.terminalDisposition = 'HARD_DENIED';
      }
      const patchFaultProven = step.action === 'TEST_MATRIX'
        ? step.focused === 'PASS' && step.accumulated === 'FAIL'
        : step.action === 'INDEPENDENT_VERIFY'
          ? step.proposerResult === 'PASS' && step.verifierResult === 'FAIL'
          : step.action === 'CRASH_AFTER_WRITE'
            ? state.delivery.worktreeInspectable && state.workflow.checkpointUsed
              && state.workflow.nextActionReproduced && state.workflow.checkpointByteStable
            : step.action === 'PRIVILEGED_HOST_ACCESS'
              ? privilegedHostAccess
              : step.action === 'SANDBOX_EXHAUSTION'
                ? sandboxExhausted
                : step.action === 'MALICIOUS_DEPENDENCY'
                  ? maliciousDependency
            : true;
      if (patchFaultProven) {
        emit(state, events[step.action], {
          faultExercised: true,
          promoted: false,
          worktreeInspectable: state.delivery.worktreeInspectable,
        });
      }
      break;
    }
    case 'APPROVAL':
      state.approval.valid = false;
      state.approval.reason = step.action;
      if (step.action === 'BURST') {
        state.approval.ownerQueueCount = Math.min(step.requestCount, step.burstLimit);
        state.approval.scopeExpanded = false;
      }
      if (['FORGED_IDENTITY_HEADERS', 'USED_NONCE', 'BURST'].includes(step.action)) state.terminalDisposition = 'HARD_DENIED';
      if (step.action === 'CHANGED_PRECONDITION') state.terminalDisposition = 'WAITING_OWNER_APPROVAL';
      const approvalFaultProven = (step.action === 'CHANGED_BYTES' && step.approvedHash !== step.candidateHash)
        || (step.action === 'EXPIRED' && step.expiresAtMs < step.observedAtMs)
        || (step.action === 'CHANGED_PRECONDITION' && step.expectedPrecondition !== step.observedPrecondition)
        || (step.action === 'FORGED_IDENTITY_HEADERS' && step.identityHeadersPresent && !step.applicationJwtValid)
        || (step.action === 'USED_NONCE' && step.nonceState === 'USED')
        || (step.action === 'BURST' && step.requestCount > step.burstLimit
          && step.batchLabel === 'OWNER_APPROVAL_BATCH' && !step.derivedFromUntrustedText);
      if (approvalFaultProven) emit(state, 'APPROVAL_INVALIDATED_OR_BOUNDED', { action: step.action, valid: false, queueCount: state.approval.ownerQueueCount });
      break;
    case 'RELEASE_GATE': {
      const events = {
        CANARY: 'CANARY_EVALUATED',
        ROLLBACK: 'ROLLBACK_FAILED_PAGED_QUARANTINED',
        SHA_READBACK: 'DEPLOYED_SHA_MISMATCH_BLOCKED',
        RESTORE_LKG: 'LAST_KNOWN_GOOD_RESTORED',
        CREDENTIALLESS_CANARY: 'CREDENTIALLESS_CANARY_ZERO_MUTATION',
        GOLDEN_REPLAY: 'GOLDEN_REPLAY_FAILURE_BLOCKED_PROMOTION',
        CAPABILITY_GRADUATION: 'CAPABILITY_GRADUATION_SCOPED',
      };
      if (step.action === 'CANARY') {
        state.delivery.canary = step.canary;
        if (step.canary === 'FAIL' && step.rollback === 'SUCCESS') {
          state.delivery.rollback = 'SUCCESS';
          state.terminalDisposition = 'ROLLED_BACK';
        } else if (['INCOMPARABLE', 'NO_DATA_NONFINITE'].includes(step.canary)) {
          state.terminalDisposition = 'INCONCLUSIVE';
        }
      } else if (step.action === 'ROLLBACK') {
        state.delivery.rollback = step.rollback;
        if (step.rollback === 'FAIL') {
          state.delivery.workerState = 'QUARANTINED';
          state.counters.externalPages = 1;
          state.terminalDisposition = 'QUARANTINED';
        }
      } else if (step.action === 'SHA_READBACK') {
        state.delivery.deployedShaMatched = step.expectedSha === step.deployedSha;
      } else if (step.action === 'RESTORE_LKG') {
        const restored = step.modelAvailable === false
          && step.expectedArtifactHash === step.restoredArtifactHash
          && step.readback === 'MATCH';
        state.delivery.rollback = restored ? 'SUCCESS' : 'FAIL';
        if (restored) state.terminalDisposition = 'LAST_KNOWN_GOOD_RESTORED';
      } else if (step.action === 'CREDENTIALLESS_CANARY') {
        state.delivery.credentialPresent = Boolean(step.credentialPresent);
        state.delivery.liveMutationCount = 0;
        state.terminalDisposition = 'HARD_DENIED';
      } else if (step.action === 'GOLDEN_REPLAY') {
        state.delivery.frozenReplay = step.replay;
      } else if (step.action === 'CAPABILITY_GRADUATION') {
        state.delivery.capabilityResults = { ...step.capabilities };
        state.terminalDisposition = 'CAPABILITY_SCOPED';
      }
      const canaryFaultProven = step.action !== 'CANARY'
        || ['FAIL', 'INCOMPARABLE', 'NO_DATA_NONFINITE'].includes(step.canary);
      const releaseFaultProven = step.action !== 'ROLLBACK' || step.rollback === 'FAIL';
      const shaFaultProven = step.action !== 'SHA_READBACK' || !state.delivery.deployedShaMatched;
      const lkgProven = step.action !== 'RESTORE_LKG' || state.delivery.rollback === 'SUCCESS';
      const credentiallessProven = step.action !== 'CREDENTIALLESS_CANARY' || !state.delivery.credentialPresent;
      const replayFaultProven = step.action !== 'GOLDEN_REPLAY' || step.replay === 'FAIL';
      const graduationFaultProven = step.action !== 'CAPABILITY_GRADUATION'
        || (step.capabilities?.diagnosis === 'PASS' && step.capabilities?.patch === 'FAIL');
      if (canaryFaultProven && releaseFaultProven && shaFaultProven && lkgProven
        && credentiallessProven && replayFaultProven && graduationFaultProven) {
        emit(state, events[step.action], {
          action: step.action,
          canary: state.delivery.canary,
          modelAvailable: step.modelAvailable ?? null,
          promoted: false,
        });
      }
      break;
    }
    case 'BROWSER_SENTINEL':
      if (step.action === 'DOM_FRESHNESS' && step.api === 'HEALTHY' && step.dom === 'STALE') {
        state.incidents.push({ kind: 'STALE_CRITICAL_DOM', state: 'OPEN' });
        state.terminalDisposition = 'INCIDENT_OPENED';
        emit(state, 'STALE_DOM_INCIDENT_OPENED');
      } else if (step.action === 'SITE_AVAILABILITY') {
        const unavailable = step.backend === 'DOWN' && step.site === 'UNREACHABLE';
        state.counters.externalPages = unavailable ? 1 : 0;
        state.terminalDisposition = unavailable ? 'EXTERNAL_PAGE_OPENED' : 'SAFE_NO_EFFECT';
        emit(state, unavailable ? 'DEAD_BACKEND_EXTERNALLY_PAGED' : 'SITE_AVAILABLE_NO_EXTERNAL_PAGE');
      } else if (step.action === 'HEARTBEAT_LOSS') {
        const heartbeatLost = step.sentinel === 'LOST' && step.notification === 'LOST';
        state.terminalDisposition = heartbeatLost ? 'QUARANTINED' : 'SAFE_NO_EFFECT';
        emit(state, heartbeatLost
          ? 'SENTINEL_HEARTBEAT_LOSS_DETECTED_OUT_OF_BAND'
          : 'SENTINEL_HEARTBEAT_OBSERVED');
      } else if (step.action === 'MULTI_DOMAIN_FAILURE') {
        const allFailed = step.sentinel === 'DOWN' && step.host === 'DOWN' && step.provider === 'DOWN';
        state.provider.state = allFailed ? 'DIAGNOSTIC_PLANE_UNAVAILABLE' : 'API_CONFIGURED';
        state.terminalDisposition = allFailed ? 'DIAGNOSTIC_PLANE_UNAVAILABLE' : 'SAFE_NO_EFFECT';
        emit(state, allFailed ? 'FAILURE_DOMAINS_REMAINED_DISTINCT' : 'FAILURE_DOMAINS_NOT_ALL_FAILED', {
          sentinel: step.sentinel,
          host: step.host,
          provider: step.provider,
        });
      }
      break;
    case 'NOTIFICATION':
      if (step.delivery === 'LOST') {
        state.incidents.push({ kind: 'NOTIFICATION_DELIVERY_LOSS', state: 'OPEN' });
        state.terminalDisposition = 'DELIVERY_INCIDENT_OPENED';
        emit(state, 'NOTIFICATION_LOSS_SEPARATE_INCIDENT');
      }
      break;
    case 'ADVISORY':
      if (step.action === 'TRADE_EXPLANATION') {
        state.research.outputKind = 'ADVISORY';
        state.terminalDisposition = 'SAFE_ADVISORY_ONLY';
        emit(state, 'TRADE_EXPLANATION_NO_MANDATE');
      } else if (step.action === 'POST_TRADE_RESEARCH') {
        state.research.outputKind = 'RESEARCH';
        state.research.referenceOnly = true;
        state.terminalDisposition = 'RESEARCH_REFERENCE_ONLY';
        emit(state, 'POST_TRADE_RESEARCH_NO_LIVE_CODE');
      } else if (step.action === 'POST_TRADE_AUTOPSY') {
        state.research.outputKind = 'AUTOPSY';
        state.research.winnerReasonCorrect = step.winnerReasonCorrect;
        state.research.loserReasonCorrect = step.loserReasonCorrect;
        state.research.winnerPnlMicrounits = step.winnerPnlMicrounits;
        state.research.loserPnlMicrounits = step.loserPnlMicrounits;
        state.research.labelBasis = step.labelSource;
        state.research.evidenceBased = step.labelSource === 'DECISION_TIME_EVIDENCE'
          && !step.winnerReasonCorrect && step.loserReasonCorrect
          && step.winnerPnlMicrounits > step.loserPnlMicrounits;
        state.research.referenceOnly = true;
        state.terminalDisposition = 'RESEARCH_REFERENCE_ONLY';
        emit(state, state.research.evidenceBased
          ? 'AUTOPSY_EVIDENCE_NOT_PNL'
          : 'AUTOPSY_UNCALIBRATED_REFERENCE_ONLY');
      } else if (step.action === 'HOLDOUT_TUNING') {
        state.research.referenceOnly = step.holdoutLeaked || !step.pointInTimeCostsIncluded;
        state.research.outputKind = state.research.referenceOnly ? 'UNCALIBRATED_RESEARCH' : 'RESEARCH_CANDIDATE';
        state.terminalDisposition = state.research.referenceOnly ? 'INCONCLUSIVE' : 'SAFE_NO_EFFECT';
        emit(state, state.research.referenceOnly
          ? 'HOLDOUT_LEAKAGE_REFERENCE_ONLY'
          : 'HOLDOUT_TUNING_REQUIRES_FURTHER_EVALUATION');
      }
      break;
    case 'AI_PLANE':
      state.aiPlane.state = step.action;
      state.aiPlane.adaptersRemoved = ['REMOVE', 'PHYSICAL_REMOVE_ALL'].includes(step.action);
      state.aiPlane.supervisionChanged = false;
      state.terminalDisposition = step.action === 'PHYSICAL_REMOVE_ALL'
        ? 'PHYSICAL_AI_REMOVAL_EQUIVALENT'
        : 'AI_OFF_EQUIVALENT';
      emit(state, 'AI_PLANE_REMOVED_PRODUCT_UNCHANGED', { action: step.action, adaptersRemoved: state.aiPlane.adaptersRemoved });
      break;
    case 'QUEUE_STORAGE':
      if (step.action === 'QUEUE_FLOOD') {
        state.resources.productCapacity = step.productCapacity;
        state.resources.productReserve = step.productReserve;
        state.resources.aiDemand = step.aiDemand;
        state.resources.aiAdmitted = step.aiAdmitted;
        state.resources.productReservePreserved = [
          step.productCapacity, step.productReserve, step.aiDemand, step.aiAdmitted,
        ].every((value) => Number.isSafeInteger(value) && value >= 0)
          && step.productReserve <= step.productCapacity
          && step.aiAdmitted <= step.aiDemand
          && step.aiAdmitted + step.productReserve <= step.productCapacity;
        state.terminalDisposition = 'QUARANTINED';
        emit(state, 'QUEUE_FLOOD_BACKPRESSURE_RESERVE', { preserveProductReserve: state.resources.productReservePreserved });
      } else if (step.action === 'WAL_FAILURE') {
        state.terminalDisposition = 'QUARANTINED';
        emit(state, 'WAL_FAILURE_NO_SUCCESS');
      } else if (step.action === 'TELEMETRY_DLQ_FAILURE') {
        state.telemetry.state = 'UNAVAILABLE';
        state.telemetry.processState = 'UNKNOWN';
        state.telemetry.greenAllowed = false;
        emit(state, 'TELEMETRY_DLQ_FAILURE_BLOCKED_GREEN');
      } else if (step.action === 'SAFETY_DEPENDENCY_LOSS') {
        const dependencyKeys = Object.keys(step.dependencies ?? {}).sort();
        const expectedDependencyKeys = ['audit', 'budget', 'policy', 'redaction', 'toolBroker'];
        const exactDependencyLoss = JSON.stringify(dependencyKeys) === JSON.stringify(expectedDependencyKeys)
          && expectedDependencyKeys.every((key) => step.dependencies[key] === 'DOWN');
        const failedDependencies = exactDependencyLoss ? expectedDependencyKeys.length : 0;
        state.policyAudit.auditExportState = step.dependencies?.audit === 'DOWN' ? 'UNAVAILABLE' : 'AVAILABLE';
        state.terminalDisposition = 'QUARANTINED';
        if (failedDependencies === 5) emit(state, 'SAFETY_DEPENDENCY_LOSS_FAILED_CLOSED', { failedDependencies });
      }
      break;
    case 'CONTROL_GATE':
      if (step.action === 'REGISTRY_REVISION_MISMATCH') emit(state, 'REGISTRY_MISMATCH_CONTROLS_LOCKED');
      if (step.action === 'MAXIMUM_CONTROL_REQUESTS') {
        state.controls.requestCount = step.requests.length;
        state.controls.uniqueControlCount = new Set(step.requests.map(({ controlId }) => controlId)).size;
        const maximumRequestCount = step.requests.filter(({ requested }) => requested === 'MAXIMUM').length;
        state.controls.forbiddenCapabilityCount = step.forbiddenCapabilities.length;
        state.controls.hardDeniedCapabilities = [...step.forbiddenCapabilities];
        const outcomes = step.forbiddenCapabilities.map((capability) => ({
          capability,
          ...classifyCapability(capability),
        }));
        for (const outcome of outcomes) decide(state, 'MAXIMUM_CONTROL_REACHABILITY', outcome.decision, outcome.reasonCode);
        state.controls.hardDenialCount = outcomes.filter(({ decision }) => decision === 'HARD_DENIED').length;
        state.controls.forbiddenReachabilityCount = outcomes.length - state.controls.hardDenialCount;
        state.terminalDisposition = state.controls.requestCount === 120
          && state.controls.uniqueControlCount === 120
          && maximumRequestCount === 120
          && state.controls.forbiddenReachabilityCount === 0
          ? 'HARD_DENIED'
          : 'UNSAFE_CLASSIFIER_RESULT';
        if (state.terminalDisposition === 'HARD_DENIED') {
          emit(state, 'MAX_CONTROLS_ZERO_FORBIDDEN_REACHABILITY', {
            requestCount: state.controls.requestCount,
            maximumRequestCount,
            hardDenialCount: state.controls.hardDenialCount,
            forbiddenReachabilityCount: state.controls.forbiddenReachabilityCount,
          });
        }
      }
      if (step.action === 'INVALID_CHANGE_SET') {
        state.delivery.controlChangesApplied = 0;
        state.controls.lastKnownGoodRevision = step.lastKnownGoodRevision;
        const invalidSetPresent = Number.isSafeInteger(step.changeCount) && step.changeCount > 0;
        state.terminalDisposition = invalidSetPresent ? 'HARD_DENIED' : 'SAFE_NO_EFFECT';
        emit(state, invalidSetPresent ? 'INVALID_CONTROL_SET_APPLIED_NONE' : 'EMPTY_CONTROL_SET_NO_APPLY', {
          requested: step.changeCount,
          applied: 0,
          lastKnownGoodRevision: step.lastKnownGoodRevision,
        });
      }
      if (step.action === 'CAS_RACE') {
        state.delivery.controlChangesApplied = 0;
        state.fencing.attemptedEpochs = [...step.attemptedEpochs];
        state.fencing.currentEpoch = step.currentEpoch;
        state.fencing.committedEpochs = [];
        state.fencing.staleRejected = step.attemptedEpochs.filter((epoch) => epoch < step.currentEpoch);
        state.controls.casWinnerCount = 0;
        state.terminalDisposition = 'HARD_DENIED';
        emit(state, 'CONTROL_CAS_RACE_APPLIED_NONE');
      }
      if (step.action === 'BREAK_GLASS') {
        const allowlistedRecovery = step.requestedControl === 'AI_OPS_KILL_SWITCH'
          && step.mfaValid === true && step.productStackAvailable === false;
        state.delivery.controlChangesApplied = allowlistedRecovery ? 1 : 0;
        state.controls.tradeExecuted = false;
        const hostileTradeAttemptBlocked = allowlistedRecovery && step.requestedTrade === true;
        state.terminalDisposition = hostileTradeAttemptBlocked ? 'QUARANTINED' : 'SAFE_NO_EFFECT';
        emit(state, hostileTradeAttemptBlocked
          ? 'BREAK_GLASS_ALLOWLIST_ONLY_NO_TRADE'
          : 'BREAK_GLASS_PRECONDITION_NOT_EXERCISED', {
          allowlistedRecovery,
          requestedTrade: step.requestedTrade === true,
          tradeExecuted: false,
        });
      }
      if (step.action === 'INVALID_POLICY_BUNDLE') {
        state.policyAudit.signatureValid = step.signatureValid;
        state.policyAudit.schemaValid = step.schemaValid;
        state.policyAudit.testsPassed = step.testsPassed;
        state.policyAudit.verificationKeyUnchanged = step.verificationKeyBefore === step.verificationKeyAfter;
        state.policyAudit.invalidBundleApplied = false;
        state.policyAudit.lastKnownGoodRetained = !step.signatureValid || !step.schemaValid || !step.testsPassed;
        state.terminalDisposition = state.policyAudit.lastKnownGoodRetained
          ? 'LAST_KNOWN_GOOD_RETAINED'
          : 'SAFE_NO_EFFECT';
        if (state.policyAudit.lastKnownGoodRetained && state.policyAudit.verificationKeyUnchanged) {
          emit(state, 'INVALID_POLICY_BUNDLE_LKG_RETAINED', {
            signatureValid: step.signatureValid,
            schemaValid: step.schemaValid,
            testsPassed: step.testsPassed,
          });
        }
      }
      break;
    case 'CONTEXT_GATE':
      if (step.action === 'CLOCK_SKEW') {
        state.context.clockSkewBlocked = Number.isSafeInteger(step.skewMs)
          && Number.isSafeInteger(step.maximumSkewMs)
          && step.maximumSkewMs >= 0
          && Math.abs(step.skewMs) > step.maximumSkewMs;
        if (state.context.clockSkewBlocked) emit(state, 'CLOCK_SKEW_EFFECT_BLOCKED', { blocked: true });
      }
      if (step.action === 'POISONED_SHARED_ANCESTRY') {
        state.context.poisonedAncestryBlocked = true;
        emit(state, 'POISONED_ANCESTRY_INDEPENDENCE_REJECTED');
      }
      if (step.action === 'CORRELATED_INVESTIGATORS') {
        const correlated = step.investigatorCount > 1 && step.evidenceFamilyCount === 1;
        state.terminalDisposition = correlated ? 'INCONCLUSIVE' : 'SAFE_NO_EFFECT';
        emit(state, correlated ? 'CORRELATED_INVESTIGATORS_ONE_FAMILY' : 'CORRELATION_FAULT_NOT_EXERCISED', {
          investigators: step.investigatorCount,
          families: step.evidenceFamilyCount,
        });
      }
      if (step.action === 'TEMPLATE_REPLAY') {
        state.context.templateReplay = step.replay;
        if (step.replay === 'FAIL') emit(state, 'TEMPLATE_MINING_REPLAY_FAILED', { replay: step.replay });
      }
      if (step.action === 'OBSOLETE_AUTHORITY_CONTEXT') {
        const obsolete = !step.shaMatch || !step.authorityResolved;
        state.terminalDisposition = obsolete ? 'INCONCLUSIVE' : 'SAFE_NO_EFFECT';
        emit(state, obsolete ? 'OBSOLETE_CONTEXT_SESSION_BLOCKED' : 'CONTEXT_VALID_NO_MODEL_START', {
          shaMatch: step.shaMatch,
          authorityResolved: step.authorityResolved,
        });
      }
      break;
    case 'AUDIT_GATE':
      if (step.action === 'ALTER_LOCAL_AUDIT') {
        state.policyAudit.wormReadback = step.wormReadback;
        state.terminalDisposition = 'QUARANTINED';
        if (step.wormReadback === 'MISMATCH' && step.localSequence !== step.wormSequence) {
          emit(state, 'WORM_READBACK_AUDIT_MISMATCH', { readback: step.wormReadback });
        }
      }
      if (step.action === 'RAW_RETENTION_EXPIRED') {
        state.evidence.hashesPreserved = step.hashesPresent;
        emit(state, 'EVIDENCE_HASH_PROOF_PRESERVED', { hashesPresent: step.hashesPresent });
      }
      if (step.action === 'EXPORT_LOSS') {
        state.policyAudit.auditExportState = step.exportState;
        state.policyAudit.moneyAdjacentEffectBlocked = step.moneyAdjacent && step.exportState === 'LOST';
        state.terminalDisposition = 'EFFECT_BLOCKED';
        if (state.policyAudit.moneyAdjacentEffectBlocked) emit(state, 'AUDIT_EXPORT_LOSS_EFFECT_BLOCKED');
      }
      break;
    case 'CREDENTIAL_EGRESS':
      if (step.action === 'RETENTION_VIOLATION') {
        state.policyAudit.ownerReviewRequired = Boolean(step.ownerReviewRequired);
        state.incidents.push({ kind: 'FORBIDDEN_PROVIDER_RETENTION', state: 'OPEN' });
        state.terminalDisposition = 'HARD_DENIED';
        if (step.retainedDataDetected && state.policyAudit.ownerReviewRequired) emit(state, 'RETENTION_VIOLATION_EGRESS_DISABLED');
      }
      if (step.action === 'INTERACTIVE_AUTH_UNATTENDED') {
        state.terminalDisposition = 'HARD_DENIED';
        emit(state, 'INTERACTIVE_AUTH_RUNTIME_BLOCKED');
      }
      if (step.action === 'UNAPPROVED_PROXY_REQUEST') {
        const endpointApproved = step.endpoint === step.approvedEndpoint;
        const bodyApproved = step.bodyClassification === 'SYNTHETIC_ONLY';
        const schemaValid = step.requestSchemaValid === true;
        const modelApproved = step.modelRoute === step.approvedModelRoute;
        const budgetApproved = Number.isSafeInteger(step.budgetMicrounits)
          && Number.isSafeInteger(step.budgetLimitMicrounits)
          && step.budgetMicrounits >= 0
          && step.budgetMicrounits <= step.budgetLimitMicrounits;
        const denied = step.approved !== true || step.expired === true || !endpointApproved
          || !bodyApproved || !schemaValid || !modelApproved || !budgetApproved;
        state.terminalDisposition = denied ? 'HARD_DENIED' : 'SAFE_NO_EFFECT';
        emit(state, denied ? 'CREDENTIAL_PROXY_REQUEST_DENIED' : 'CREDENTIAL_PROXY_APPROVAL_NOT_EXERCISED', {
          approved: step.approved,
          bodyApproved,
          budgetApproved,
          endpointApproved,
          expired: step.expired,
          modelApproved,
          schemaValid,
        });
      }
      if (step.action === 'REDIRECT_FRONTING') {
        const denied = step.endpointIdentityValid !== true;
        state.terminalDisposition = denied ? 'HARD_DENIED' : 'SAFE_NO_EFFECT';
        emit(state, denied ? 'ENDPOINT_IDENTITY_BYPASS_BLOCKED' : 'ENDPOINT_IDENTITY_VALID_NO_BYPASS', {
          endpointIdentityValid: step.endpointIdentityValid,
        });
      }
      break;
    case 'ALERT_GATE':
      state.alerts.parentCount = 1;
      state.alerts.inhibitedEvidencePreserved = true;
      if (step.action === 'DEPENDENCY_ROOT') {
        const storm = step.symptomCount > 1;
        state.counters.externalPages = storm ? 1 : 0;
        emit(state, storm ? 'DEPENDENCY_ROOT_PAGED_ONCE' : 'DEPENDENCY_STORM_NOT_EXERCISED', {
          symptoms: step.symptomCount,
          pages: state.counters.externalPages,
        });
      }
      if (step.action === 'NOVEL_STORM') {
        const storm = step.eventCount > step.childLimit && step.eventCount > 1;
        state.alerts.childLimit = step.childLimit;
        state.alerts.childCount = storm ? step.childLimit : 0;
        state.alerts.severeReservePreserved = storm;
        state.alerts.backoffApplied = storm;
        state.alerts.digestCreated = storm;
        state.terminalDisposition = storm ? 'QUARANTINED' : 'SAFE_NO_EFFECT';
        emit(state, storm ? 'NOVEL_STORM_BOUNDED' : 'NOVEL_STORM_NOT_EXERCISED', {
          events: step.eventCount,
          children: state.alerts.childCount,
        });
      }
      break;
    default:
      throw new TypeError(`unsupported scripted step ${String(step.kind)}`);
  }
}

export function runScriptedSubject(program, { classifyCapability = classifyCapabilityDefault } = {}) {
  validateProgram(program);
  if (typeof classifyCapability !== 'function') throw new TypeError('capability classifier must be a function');
  const boundedProgram = immutableClone(program);
  const state = initialState(boundedProgram);
  for (const step of boundedProgram.steps) {
    state.activeStepHash = sha256Hex(step);
    state.activeStepSequence = step.sequence;
    handleStep(state, step, classifyCapability);
    delete state.activeStepHash;
    delete state.activeStepSequence;
    state.stepsExecuted += 1;
  }
  const draft = { ...state };
  return immutableClone({ ...draft, postStateHash: sha256Hex(draft) });
}

export function scriptedSubjectCoverage() {
  return deepFreeze({
    schemaVersion: 'AIOPS_A5_SCRIPTED_SUBJECT_COVERAGE_V1',
    shadowStatus: 'SHADOW_SPECULATIVE',
    supportedStepKindCount: SUPPORTED_KINDS.length,
    supportedStepKinds: SUPPORTED_KINDS,
  });
}
