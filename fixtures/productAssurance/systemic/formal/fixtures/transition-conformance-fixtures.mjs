export const FROZEN_L_TRANSITION_CONFORMANCE_SCHEMA = 'S3_FROZEN_L_TRANSITION_CONFORMANCE_V1';
export const FROZEN_L_TRANSITION_CONFORMANCE_COMMIT = 'df6b472993ca9659ce09cf5f72004981c6835f0d';

export const FROZEN_L_TRANSITION_CONFORMANCE_MODEL_IDS = Object.freeze([
  'S3-M08-ORDER-POLICY',
  'S3-M09-NORMAL-BASIS-LIFECYCLE',
  'S3-M10-REVERSE-BASIS-LIABILITY',
  'S3-M11-VOLUME-LIFECYCLE',
  'S3-M12-EXCHANGE-TWIN-AMBIGUITY',
  'S3-M13-DURABLE-CONTROL-REVISION',
]);

const SOURCE_TRUTH = 'SYNTHETIC_ONLY';
const AUTHORITY = 'SUPPORTING_EVIDENCE_ONLY';
const RUNTIME_CLAIM_CLOSURE = 'NOT_PERMITTED';

function refs(...entries) {
  return Object.freeze(entries.map(([path, symbol]) => Object.freeze({ path, symbol })));
}

function rows(modelId, status, implementationRefs, note, actionIds) {
  const honesty = Object.freeze({
    sourceTruth: SOURCE_TRUTH,
    authority: AUTHORITY,
    runtimeClaimClosure: RUNTIME_CLAIM_CLOSURE,
    note,
  });
  return actionIds.map((actionId) => Object.freeze({
    modelId,
    actionId,
    frozenCommit: FROZEN_L_TRANSITION_CONFORMANCE_COMMIT,
    status,
    implementationRefs,
    honesty,
  }));
}

const M08 = 'S3-M08-ORDER-POLICY';
const M09 = 'S3-M09-NORMAL-BASIS-LIFECYCLE';
const M10 = 'S3-M10-REVERSE-BASIS-LIABILITY';
const M11 = 'S3-M11-VOLUME-LIFECYCLE';
const M12 = 'S3-M12-EXCHANGE-TWIN-AMBIGUITY';
const M13 = 'S3-M13-DURABLE-CONTROL-REVISION';

const POLICY_PATH = 'server/src/liveEdge/adapters/executionPolicy/policy.ts';
const EXECUTION_CONTRACT_PATH = 'server/src/foundation/contracts/execution.ts';
const EXECUTION_REDUCER_PATH = 'server/src/foundation/execution/reducer.ts';
const NORMAL_BASIS_TWIN_PATH = 'server/src/liveEdge/adapters/normalBasis/twinAdapter.ts';
const NORMAL_BASIS_EVIDENCE_PATH = 'server/src/liveEdge/adapters/normalBasis/evidence.ts';
const REVERSE_BASIS_PATH = 'server/src/liveEdge/adapters/reverseBasisLifecycle/lifecycle.ts';
const VOLUME_PATH = 'server/src/liveEdge/adapters/volumeLifecycle/lifecycle.ts';
const EXCHANGE_TWIN_PATH = 'server/src/liveEdge/adapters/exchangeTwin/twin.ts';
const CONTROL_TYPES_PATH = 'server/src/liveEdge/controls/types.ts';
const CONTROL_ADAPTER_PATH = 'server/src/liveEdge/controls/adapter.ts';
const CONTROL_INTEGRITY_PATH = 'server/src/liveEdge/controls/integrity.ts';
const CONTROL_VALIDATION_PATH = 'server/src/liveEdge/controls/validation.ts';
const CONTROL_FIXTURE_PATH = 'server/test/liveEdge/controls/fixtures.mjs';

export const TRANSITION_CONFORMANCE_FIXTURES = Object.freeze([
  ...rows(M08, 'PARTIAL', refs(
    [POLICY_PATH, 'evaluateExecutionPolicyCore'],
    [POLICY_PATH, 'validateCandidate'],
  ), 'The model exposes distinct parse cuts for a frozen one-shot evaluator; the donor has no parse reducer transition.', [
    'PARSE_HALT_ACTIVE_POLICY',
    'PARSE_RECOVERY_POLICY',
    'PARSE_UNKNOWN_AUTHORITY_POLICY',
    'PARSE_UNKNOWN_DEPENDENCY_POLICY',
    'PARSE_VALID_BASE_POLICY',
  ]),
  ...rows(M08, 'PARTIAL', refs(
    [POLICY_PATH, 'validateAction'],
    [POLICY_PATH, 'validateTransitions'],
    [POLICY_PATH, 'validateLegTransitions'],
    [POLICY_PATH, 'validateCandidate'],
  ), 'The cancel-replace parse cut abstracts the frozen candidate action graph validators; it is not a runtime reducer event.', [
    'PARSE_CANCEL_REPLACE_POLICY',
    'VALIDATE_CANCEL_THEN_REPLACE',
  ]),
  ...rows(M08, 'PARTIAL', refs(
    [POLICY_PATH, 'evaluateExecutionPolicyCore'],
    [POLICY_PATH, 'finalizeDecision'],
  ), 'The donor can return a non-sendable planned decision, but this model transition is not an execution authorization or runtime send.', [
    'EVALUATE_AUTHORIZED_POLICY',
  ]),
  ...rows(M08, 'PARTIAL', refs(
    [POLICY_PATH, 'evaluateExecutionPolicyCore'],
    [POLICY_PATH, 'rejectGlobal'],
    [POLICY_PATH, 'rejectedInput'],
  ), 'The transition preserves the frozen evaluator fail-closed outcome while collapsing several input and global rejection branches.', [
    'REJECT_HALTED_POLICY',
    'REJECT_UNKNOWN_AUTHORITY',
    'REJECT_UNKNOWN_DEPENDENCY',
  ]),
  ...rows(M08, 'PARTIAL', refs(
    [POLICY_PATH, 'evaluateExecutionPolicyCore'],
    [POLICY_PATH, 'validateCandidate'],
    [POLICY_PATH, 'finalizeDecision'],
  ), 'The transition documents a bounded record-only recovery candidate; the donor supplies no recovery executor or capital mutation.', [
    'VALIDATE_RISK_REDUCING_RECOVERY',
  ]),

  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'PLAN_LIFECYCLE_TRANSITIONS'],
  ), 'This action maps to the frozen PREFLIGHT_STARTED plan reducer branch.', [
    'START_PREFLIGHT',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'PLAN_LIFECYCLE_TRANSITIONS'],
  ), 'These actions map one-for-one to the frozen PREFLIGHT_PASSED and PREFLIGHT_FAILED plan reducer branches.', [
    'PREFLIGHT_FAILED',
    'PREFLIGHT_PASSED',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'PLAN_LIFECYCLE_TRANSITIONS'],
  ), 'This action maps to the frozen OPENING_STARTED plan reducer branch.', [
    'BEGIN_OPENING',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'PLAN_LIFECYCLE_TRANSITIONS'],
  ), 'This action maps to the frozen PLAN_CANCELLED reducer branch while retaining the model cancellation boundary.', [
    'CANCEL_READY_PLAN',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'PLAN_LIFECYCLE_TRANSITIONS'],
  ), 'The model expiry cut collapses the frozen PROPOSAL_EXPIRED and ENTRY_WINDOW_EXPIRED reducer branches.', [
    'EXPIRE_READY_PLAN',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'LEG_LIFECYCLE_TRANSITIONS'],
  ), 'These actions map to frozen LEG_SUBMISSION_STARTED transitions for the represented opening leg.', [
    'SUBMIT_OPEN_SPOT',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'LEG_LIFECYCLE_TRANSITIONS'],
  ), 'These actions map to the frozen LEG_PARTIALLY_FILLED, LEG_FILLED, and LEG_RESPONSE_AMBIGUOUS branches.', [
    'OPEN_SPOT_AMBIGUOUS',
    'OPEN_SPOT_FULL_FILL',
    'OPEN_SPOT_PARTIAL_FILL',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'LEG_LIFECYCLE_TRANSITIONS'],
  ), 'These actions map to the frozen LEG_CANCEL_REQUESTED reducer branch without treating request as cancellation fact.', [
    'REQUEST_SPOT_CANCEL_AFTER_PARTIAL',
    'REQUEST_SPOT_CANCEL_WITHOUT_FILL',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'LEG_LIFECYCLE_TRANSITIONS'],
  ), 'This action maps to frozen LEG_CANCELLED accounting, whose cumulative fill is retained.', [
    'CANCEL_ACK_RETAINS_FILL',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'LEG_LIFECYCLE_TRANSITIONS'],
  ), 'The model resolves a bounded late-fill race through frozen fill and ambiguity branches; it is not a distinct donor event.', [
    'CANCEL_RACE_AMBIGUOUS',
    'LATE_FILL_WINS_CANCEL_RACE',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [NORMAL_BASIS_TWIN_PATH, 'runNormalBasisTwinLeg'],
  ), 'The model binds the second leg to observed first-leg fill; the donor splits that evidence adapter from Foundation leg submission.', [
    'SUBMIT_PERP_FROM_ACTUAL_SPOT_FILL',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [NORMAL_BASIS_TWIN_PATH, 'runNormalBasisTwinLeg'],
    [NORMAL_BASIS_EVIDENCE_PATH, 'evaluateNormalBasisOwnerAgreement'],
  ), 'The modeled matched hedge combines a frozen leg-fill transition with evidence-only owner agreement.', [
    'PERP_FILL_MATCHES_SPOT',
  ]),
  ...rows(M09, 'MAPPED', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'LEG_LIFECYCLE_TRANSITIONS'],
  ), 'This action maps to the frozen second-leg LEG_RESPONSE_AMBIGUOUS branch.', [
    'PERP_DELIVERY_AMBIGUOUS',
  ]),
  ...rows(M09, 'ABSENT', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [NORMAL_BASIS_EVIDENCE_PATH, 'evaluateNormalBasisOwnerAgreement'],
  ), 'The frozen files expose reconciliation and recovery-required evidence but no automatic normal-basis repair executor transition.', [
    'ENTER_NORMAL_BASIS_REPAIR',
    'PERSIST_REPAIR_UNAVAILABLE',
    'RECOVER_WITH_EXACT_PAIRED_HEDGE',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [NORMAL_BASIS_EVIDENCE_PATH, 'evaluateNormalBasisOwnerAgreement'],
  ), 'The model collapses frozen reconciliation start, resolution, unresolved, and evidence agreement cuts into one bounded action.', [
    'PERSIST_NORMAL_BASIS_UNRESOLVED',
    'RECONCILE_NORMAL_BASIS_EXACT',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [EXECUTION_CONTRACT_PATH, 'PLAN_LIFECYCLE_TRANSITIONS'],
  ), 'The paired-close request combines the frozen CLOSE_REQUESTED and CLOSING_STARTED plan transitions.', [
    'REQUEST_PAIRED_CLOSE',
  ]),
  ...rows(M09, 'PARTIAL', refs(
    [EXECUTION_REDUCER_PATH, 'reduceExecutionEvent'],
    [NORMAL_BASIS_EVIDENCE_PATH, 'evaluateNormalBasisOwnerAgreement'],
  ), 'The model combines multiple closing-leg and reconciliation events; exact or unavailable truth remains evidence-only.', [
    'CLOSE_BOTH_LEGS_EXACTLY',
    'CLOSE_RECONCILIATION_UNAVAILABLE',
  ]),

  ...rows(M10, 'MAPPED', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
  ), 'These actions map to frozen BORROW_OBSERVED event-fold outcomes.', [
    'OBSERVE_BORROW_CONFIRMED',
    'OBSERVE_BORROW_REJECTED_NO_EFFECT',
    'OBSERVE_BORROW_UNKNOWN',
  ]),
  ...rows(M10, 'PARTIAL', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
  ), 'The reconciliation action reuses the frozen BORROW_OBSERVED branch to replace ambiguous borrow evidence; it is not a separate donor event.', [
    'RECONCILE_BORROW_CONFIRMED',
  ]),
  ...rows(M10, 'MAPPED', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
    [REVERSE_BASIS_PATH, 'liabilityCurrentAt'],
  ), 'These actions map to frozen LIABILITY_OBSERVED projections, including explicit UNKNOWN and interest-bearing truth.', [
    'LIABILITY_TRUTH_UNAVAILABLE',
    'OBSERVE_BOUND_POSITIVE_LIABILITY',
    'OBSERVE_BOUND_ZERO_LIABILITY',
    'OBSERVE_ONE_INTEREST_UNIT',
  ]),
  ...rows(M10, 'PARTIAL', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
    [REVERSE_BASIS_PATH, 'projectOrder'],
  ), 'The model action is a bounded projection of the frozen ORDER_OBSERVED fold; it does not authorize or send an order.', [
    'FUTURES_EXIT_UNKNOWN',
    'FUTURES_HEDGE_MUTATION_UNKNOWN',
    'MARGIN_CANCEL_ORDERING_UNKNOWN',
    'MARGIN_COVER_UNKNOWN',
    'MARGIN_ENTRY_MUTATION_UNKNOWN',
    'OBSERVE_FUTURES_EXIT_EXACT',
    'OBSERVE_FUTURES_HEDGE_EXACT',
    'OBSERVE_LATE_MARGIN_FILL',
    'OBSERVE_MARGIN_CANCEL',
    'OBSERVE_MARGIN_COVER_EXACT',
    'OBSERVE_MARGIN_ENTRY_FULL',
    'OBSERVE_MARGIN_ENTRY_PARTIAL',
    'OBSERVE_MARGIN_ENTRY_REMAINDER',
  ]),
  ...rows(M10, 'PARTIAL', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
    [REVERSE_BASIS_PATH, 'computeExposure'],
  ), 'These actions project frozen REPAY_OBSERVED exact or ambiguous evidence and conserve the derived liability.', [
    'OBSERVE_EXACT_REPAY_CONFIRMED',
    'REPAY_MUTATION_UNKNOWN',
  ]),
  ...rows(M10, 'PARTIAL', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
    [REVERSE_BASIS_PATH, 'closureReasons'],
    [REVERSE_BASIS_PATH, 'deriveLifecycle'],
  ), 'The model closure cut combines frozen CLOSURE_RECONCILED evidence with derived exact-closure predicates.', [
    'CLOSURE_EVIDENCE_UNAVAILABLE',
    'OBSERVE_EXACT_FLAT_CLOSURE',
  ]),
  ...rows(M10, 'MAPPED', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
  ), 'This action maps to the frozen MANUAL_INTERVENTION event-fold branch.', [
    'ESCALATE_REVERSE_BASIS_MANUAL',
  ]),
  ...rows(M10, 'ABSENT', refs(
    [REVERSE_BASIS_PATH, 'applyEvent'],
    [REVERSE_BASIS_PATH, 'runReverseBasisLifecycle'],
  ), 'The frozen reverse-basis adapter returns an immutable finite event projection and has no runtime persistence transition.', [
    'PERSIST_BORROW_UNKNOWN',
    'PERSIST_REVERSE_BASIS_UNRESOLVED',
  ]),
  ...rows(M10, 'ABSENT', refs(
    [REVERSE_BASIS_PATH, 'actionForOrderObservation'],
    [REVERSE_BASIS_PATH, 'applyEvent'],
  ), 'The frozen owner accepts observations only; these model request or submit cuts have no donor mutation executor transition.', [
    'REQUEST_MARGIN_ENTRY_CANCEL',
    'REQUEST_PARTIAL_MARGIN_CANCEL',
    'SUBMIT_FUTURES_EXIT',
    'SUBMIT_FUTURES_HEDGE_FROM_ACTUAL_MARGIN_FILL',
    'SUBMIT_MARGIN_ENTRY_FROM_LIABILITY',
  ]),

  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'evaluateVolumeLifecycle'],
    [VOLUME_PATH, 'entryGateReasons'],
    [VOLUME_PATH, 'planIncreasingStage'],
  ), 'The modeled stage cut projects frozen entry gates and record-only stage planning; it is not a runtime reducer event.', [
    'ADMIT_ADD_ALLOWED_STAGE',
    'HOLD_TRIGGER_UNKNOWN',
    'OBSERVE_UNKNOWN_ENTRY_GATE',
    'OBSERVE_VOLUME_HALT_WHILE_FLAT',
    'PROBE_TRIGGER_UNKNOWN',
  ]),
  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'planIncreasingStage'],
    [VOLUME_PATH, 'actionRequest'],
  ), 'These actions map to frozen non-sendable ENTRY or ADD action-request construction only.', [
    'PLAN_RECORD_ONLY_ADD_TO_HOLD',
    'PLAN_RECORD_ONLY_CONFIRM_ADD',
    'PLAN_RECORD_ONLY_PROBE_ENTRY',
  ]),
  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'exitTriggers'],
    [VOLUME_PATH, 'planRiskReduction'],
    [VOLUME_PATH, 'actionRequest'],
  ), 'These actions map to frozen non-sendable REDUCE or EXIT planning; no cancel or execution authority is implied.', [
    'PLAN_ADD_ALLOWED_PROTECTIVE_EXIT',
    'PLAN_CONFIRM_PROTECTIVE_EXIT',
    'PLAN_HALT_PROTECTIVE_EXIT',
    'PLAN_PROTECTIVE_EXIT_AT_HALT',
    'PLAN_RECORD_ONLY_EXIT',
    'PLAN_RECORD_ONLY_REDUCTION',
    'PLAN_REMAINING_EXIT',
  ]),
  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'evaluateVolumeLifecycle'],
    [VOLUME_PATH, 'exitTriggers'],
    [VOLUME_PATH, 'recovery'],
  ), 'The model halt cut preserves the frozen rule that pending increasing work cannot become a new send; protective handling remains record-only.', [
    'HALT_WITH_CONFIRM_ADD_PENDING',
    'HALT_WITH_ENTRY_PENDING',
    'HALT_WITH_HOLD_ADD_PENDING',
  ]),
  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'twinSettlement'],
    [VOLUME_PATH, 'settleTwin'],
  ), 'These actions map to frozen exact or no-fill twin settlement projections, all of which remain non-sendable.', [
    'SETTLE_CONFIRM_ADD_FULL',
    'SETTLE_ENTRY_FULL',
    'SETTLE_ENTRY_NO_FILL',
    'SETTLE_EXIT_FULL',
    'SETTLE_HOLD_ADD_FULL',
    'SETTLE_REDUCTION_FULL',
  ]),
  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'twinSettlement'],
    [VOLUME_PATH, 'settleTwin'],
    [VOLUME_PATH, 'recovery'],
  ), 'These actions map unknown twin evidence to the frozen visible recovery projection; UNKNOWN is never promoted to PASS.', [
    'CONFIRM_ADD_TWIN_UNKNOWN',
    'ENTRY_TWIN_UNKNOWN',
    'EXIT_TWIN_UNKNOWN',
    'HOLD_ADD_TWIN_UNKNOWN',
    'REDUCTION_TWIN_UNKNOWN',
  ]),
  ...rows(M11, 'PARTIAL', refs(
    [VOLUME_PATH, 'evaluateVolumeLifecycle'],
    [VOLUME_PATH, 'settledTwinReplayMatches'],
    [VOLUME_PATH, 'recovery'],
  ), 'The action abstracts frozen exact no-effect recovery evidence consumption; the donor exposes no runtime recovery worker.', [
    'RESOLVE_RECOVERY_EXACT_NO_EFFECT',
  ]),
  ...rows(M11, 'ABSENT', refs(
    [VOLUME_PATH, 'evaluateVolumeLifecycle'],
    [VOLUME_PATH, 'recovery'],
  ), 'The frozen Volume adapter returns a recovery handoff but owns no durable store, retry scheduler, or persistence transition.', [
    'PERSIST_VOLUME_RECOVERY_UNRESOLVED',
  ]),

  ...rows(M12, 'PARTIAL', refs(
    [EXCHANGE_TWIN_PATH, 'createExchangeTwinState'],
    [EXCHANGE_TWIN_PATH, 'preflightPass'],
  ), 'The model load cut abstracts frozen twin state creation and preflight status evaluation.', [
    'LOAD_FRESH_TRADING_BOOK',
    'LOAD_HALT_STATUS',
    'LOAD_UNKNOWN_STATUS',
  ]),
  ...rows(M12, 'MAPPED', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
    [EXCHANGE_TWIN_PATH, 'executeAggressive'],
  ), 'This action maps to the frozen PLACE_DISPATCH event and its single synthetic venue execution projection.', [
    'DISPATCH_SINGLE_PLACEMENT',
  ]),
  ...rows(M12, 'PARTIAL', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
    [EXCHANGE_TWIN_PATH, 'executeAggressive'],
  ), 'These actions abstract frozen venue arrival and delivery ambiguity cuts around the placed twin order.', [
    'HTTP_ACK_NEW',
    'HTTP_DELIVERY_UNKNOWN',
  ]),
  ...rows(M12, 'MAPPED', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
    [EXCHANGE_TWIN_PATH, 'executeAggressive'],
  ), 'These actions map to frozen TRADE_EVIDENCE accounting with bounded full or pre-cancel fill evidence.', [
    'OBSERVE_TRADE_BEFORE_CANCEL',
    'OBSERVE_VENUE_FULL_FILL',
  ]),
  ...rows(M12, 'MAPPED', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
  ), 'These actions map to frozen CANCEL_DISPATCH handling before or after retained partial fill.', [
    'DISPATCH_CANCEL',
    'DISPATCH_CANCEL_AFTER_PARTIAL',
  ]),
  ...rows(M12, 'PARTIAL', refs(
    [EXCHANGE_TWIN_PATH, 'eventOrderingDomains'],
    [EXCHANGE_TWIN_PATH, 'sourceOrderIsProved'],
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
  ), 'These actions project frozen causal-order proof or unproved equal-time conflict; unproved ordering allocates no fill.', [
    'PROVE_CANCEL_FIRST',
    'PROVE_TRADE_FIRST',
    'UNPROVED_EQUAL_TIME_CANCEL_RACE',
  ]),
  ...rows(M12, 'ABSENT', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
  ), 'A dropped delivery is represented by absence of a donor event; the frozen reducer has no explicit DROP transition.', [
    'DROP_CANCEL_DELIVERY',
  ]),
  ...rows(M12, 'MAPPED', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
    [EXCHANGE_TWIN_PATH, 'checkpointExchangeTwin'],
  ), 'This action maps to the frozen CRASH cut over a caller-owned checkpoint.', [
    'CRASH_AFTER_PLACEMENT_DISPATCH',
  ]),
  ...rows(M12, 'MAPPED', refs(
    [EXCHANGE_TWIN_PATH, 'restoreExchangeTwin'],
    [EXCHANGE_TWIN_PATH, 'validateCommittedState'],
  ), 'This action maps to frozen checkpoint restoration and committed-state validation.', [
    'RESTORE_TWIN_CHECKPOINT',
  ]),
  ...rows(M12, 'PARTIAL', refs(
    [EXCHANGE_TWIN_PATH, 'reduceCanonical'],
    [EXCHANGE_TWIN_PATH, 'validateCommittedState'],
  ), 'These actions abstract frozen RECONCILIATION_OBSERVATION exact, mismatch, or unavailable results; only exact truth clears recovery.', [
    'APPLY_EXACT_RECONCILIATION',
    'RECONCILIATION_MISMATCH_VISIBLE',
    'RECONCILIATION_UNAVAILABLE_VISIBLE',
  ]),

  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.preview'],
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_ADAPTER_PATH, 'riskIncreasingByNature'],
    [CONTROL_ADAPTER_PATH, 'recoveryBlocked'],
    [CONTROL_ADAPTER_PATH, 'recheckRisk'],
  ), 'The model preview cuts abstract frozen schema, halt, recovery, risk, and competing-command guards before durable intent.', [
    'PREVIEW_COMPETING_COMMANDS',
    'PREVIEW_RISK_INCREASE_HALTED',
    'PREVIEW_RISK_INCREASE_OPEN',
    'PREVIEW_SAFE_HALT_DURING_REPAIR',
    'PREVIEW_UNKNOWN_RECOVERY',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.preview'],
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_VALIDATION_PATH, 'isWaitingL08Action'],
  ), 'The WAITING_L08 preview is a frozen non-publication guard, not an action dispatch or runtime claim.', [
    'PREVIEW_WAITING_L08_ACTION',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_ADAPTER_PATH, 'auditRejection'],
  ), 'These actions map to frozen pre-intent audited rejection paths; they reserve no control revision.', [
    'AUDIT_PREINTENT_HALT_REJECTION',
    'AUDIT_PREINTENT_UNKNOWN_REJECTION',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_ADAPTER_PATH, 'auditRejection'],
    [CONTROL_VALIDATION_PATH, 'isWaitingL08Action'],
  ), 'This action maps to frozen WAITING_L08 audited return without owner publication.', [
    'RETURN_WAITING_L08_WITHOUT_PUBLICATION',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_TYPES_PATH, 'CanonicalControlPersistencePort'],
    [CONTROL_INTEGRITY_PATH, 'prepareControlEventAppend'],
    [CONTROL_INTEGRITY_PATH, 'confirmControlEventAppend'],
    [CONTROL_FIXTURE_PATH, 'createHarness'],
  ), 'The intent append is production-contract-shaped, but atomic global revision reservation is proved only by the frozen synthetic harness.', [
    'APPEND_DURABLE_INTENT_AND_RESERVE_REVISION',
    'REJECT_C1_VERSION_CONFLICT',
  ]),
  ...rows(M13, 'ABSENT', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_INTEGRITY_PATH, 'prepareControlEventAppend'],
  ), 'The model crash cut has no frozen runtime restart orchestration; the nearest proof is a committed intent contract before publication.', [
    'CRASH_AFTER_DURABLE_CONTROL_INTENT',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_ADAPTER_PATH, 'replayResult'],
    [CONTROL_TYPES_PATH, 'CanonicalControlPersistencePort'],
  ), 'These actions map to frozen command lookup and replay logic, but the canonical persistence adapter is unwired.', [
    'RELOAD_DURABLE_CONTROL_LOOKUP',
    'REPLAY_TERMINAL_CONTROL_RESULT',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_ADAPTER_PATH, 'publish'],
    [CONTROL_ADAPTER_PATH, 'lifecycleCommand'],
  ), 'The action maps to frozen post-intent owner publication; all external action authority remains NONE.', [
    'PUBLISH_RESERVED_COMMAND',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_INTEGRITY_PATH, 'prepareControlEventAppend'],
    [CONTROL_INTEGRITY_PATH, 'confirmControlEventAppend'],
  ), 'This action maps to frozen known owner outcome finalization over the retained command journal contract.', [
    'FINALIZE_APPLIED_CONTROL_OUTCOME',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'finalizeRejected'],
    [CONTROL_INTEGRITY_PATH, 'prepareControlEventAppend'],
    [CONTROL_INTEGRITY_PATH, 'confirmControlEventAppend'],
  ), 'These actions map known owner rejection to the frozen rejected-outcome append or to its visible finalization failure.', [
    'FINALIZE_KNOWN_OWNER_REJECTION',
    'KNOWN_OWNER_REJECTION_FINALIZATION_FAILURE',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_ADAPTER_PATH, 'finalizeRejected'],
  ), 'These actions map post-intent expiry to frozen rejected finalization or a retained PENDING result when finalization fails.', [
    'EXPIRE_AFTER_INTENT_AND_FINALIZE_REJECTED',
    'EXPIRE_AFTER_INTENT_FINALIZATION_FAILURE',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'publish'],
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
  ), 'The model retains PENDING after a frozen owner publication throw because the post-intent outcome is ambiguous.', [
    'OWNER_THROW_REMAINS_PENDING',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'publish'],
    [CONTROL_ADAPTER_PATH, 'finalizeRejected'],
  ), 'The model retains PENDING when expiry is observed only after publication and the owner outcome is no longer safely reversible.', [
    'POST_PUBLICATION_EXPIRY_REMAINS_PENDING',
  ]),
  ...rows(M13, 'PARTIAL', refs(
    [CONTROL_ADAPTER_PATH, 'DurableControlCommandAdapter.submit'],
    [CONTROL_INTEGRITY_PATH, 'confirmControlEventAppend'],
  ), 'The model retains PENDING after a terminal append failure; canonical production persistence remains unwired.', [
    'TERMINAL_APPEND_FAILURE_REMAINS_PENDING',
  ]),
]);
