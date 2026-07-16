-------------------- MODULE S3M07CancellationBoundary --------------------
EXTENDS Naturals, FiniteSets

\* Finite envelope: one local child or one non-cancellable external mutation,
\* one crash/restart, and one fencing handoff.
VARIABLES phase, kind, cancelRequested, cancelObserved, cancellationObligation,
          durableIntent, externalDispatched, effectCommitted, generation,
          currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
          lastCommitEpoch, staleCallbackRejected, reporterContextStale, receipt,
          durableFactAccepted, authoritativePostcondition, externalTruth, outcome

vars == << phase, kind, cancelRequested, cancelObserved, cancellationObligation,
           durableIntent, externalDispatched, effectCommitted, generation,
           currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
           lastCommitEpoch, staleCallbackRejected, reporterContextStale, receipt,
           durableFactAccepted, authoritativePostcondition, externalTruth, outcome >>

Init ==
  /\ phase = "IDLE" /\ kind = "NONE"
  /\ cancelRequested = FALSE /\ cancelObserved = FALSE
  /\ cancellationObligation = FALSE /\ durableIntent = FALSE
  /\ externalDispatched = FALSE /\ effectCommitted = FALSE
  /\ generation = 0 /\ currentEpoch = 1 /\ owner = "P0"
  /\ authorizedEpochs = {1} /\ oldOwnerAuthorized = TRUE /\ lostOwner = FALSE
  /\ lastCommitEpoch = 0 /\ staleCallbackRejected = FALSE
  /\ reporterContextStale = FALSE /\ receipt = "NONE"
  /\ durableFactAccepted = FALSE /\ authoritativePostcondition = FALSE
  /\ externalTruth = "UNKNOWN" /\ outcome = "PENDING"

SelectLocalChild ==
  /\ phase = "IDLE" /\ phase' = "LOCAL_READY" /\ kind' = "LOCAL_CHILD"
  /\ UNCHANGED << cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, lastCommitEpoch, staleCallbackRejected,
                   reporterContextStale, receipt, durableFactAccepted,
                   authoritativePostcondition, externalTruth, outcome >>

SelectExternalMutation ==
  /\ phase = "IDLE" /\ phase' = "EXTERNAL_READY" /\ kind' = "EXTERNAL_MUTATION"
  /\ UNCHANGED << cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, lastCommitEpoch, staleCallbackRejected,
                   reporterContextStale, receipt, durableFactAccepted,
                   authoritativePostcondition, externalTruth, outcome >>

StartLocalChild ==
  /\ phase = "LOCAL_READY" /\ phase' = "LOCAL_RUNNING"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, lastCommitEpoch, staleCallbackRejected,
                   reporterContextStale, receipt, durableFactAccepted,
                   authoritativePostcondition, externalTruth, outcome >>

EnterLocalPrecommit ==
  /\ phase = "LOCAL_RUNNING" /\ phase' = "LOCAL_PRECOMMIT"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, lastCommitEpoch, staleCallbackRejected,
                   reporterContextStale, receipt, durableFactAccepted,
                   authoritativePostcondition, externalTruth, outcome >>

RequestLocalCancel ==
  /\ phase \in {"LOCAL_RUNNING", "LOCAL_PRECOMMIT"}
  /\ phase' = "LOCAL_CANCEL_REQUESTED" /\ cancelRequested' = TRUE
  /\ UNCHANGED << kind, cancelObserved, cancellationObligation, durableIntent,
                   externalDispatched, effectCommitted, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

\* A request alone is not the cancellation authority boundary. The child may
\* still commit before it observes the request; LIV-05 begins at observation.
CommitBeforeCancelObserved ==
  /\ phase = "LOCAL_CANCEL_REQUESTED" /\ ~cancelObserved
  /\ phase' = "TERMINAL" /\ effectCommitted' = TRUE
  /\ outcome' = "LOCAL_DONE"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved,
                   cancellationObligation, durableIntent, externalDispatched,
                   generation, currentEpoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, lostOwner, lastCommitEpoch,
                   staleCallbackRejected, reporterContextStale, receipt,
                   durableFactAccepted, authoritativePostcondition,
                   externalTruth >>

CommitLocalEffect ==
  /\ phase = "LOCAL_PRECOMMIT" /\ phase' = "TERMINAL"
  /\ effectCommitted' = TRUE /\ outcome' = "LOCAL_DONE"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth >>

ObserveLocalCancel ==
  /\ phase = "LOCAL_CANCEL_REQUESTED" /\ phase' = "LOCAL_CANCEL_OBSERVED"
  /\ cancelObserved' = TRUE /\ cancellationObligation' = TRUE
  /\ UNCHANGED << kind, cancelRequested, durableIntent, externalDispatched,
                   effectCommitted, generation, currentEpoch, owner,
                   authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

StopCancelledChild ==
  /\ phase = "LOCAL_CANCEL_OBSERVED" /\ phase' = "TERMINAL"
  /\ cancellationObligation' = FALSE /\ outcome' = "CANCELLED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, durableIntent,
                   externalDispatched, effectCommitted, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth >>

PersistExternalIntent ==
  /\ phase = "EXTERNAL_READY" /\ phase' = "EXTERNAL_INTENT_DURABLE"
  /\ durableIntent' = TRUE
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   externalDispatched, effectCommitted, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

DispatchNoncancellableEffect ==
  /\ phase = "EXTERNAL_INTENT_DURABLE" /\ phase' = "EXTERNAL_DISPATCHED"
  /\ externalDispatched' = TRUE
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, effectCommitted, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

RequestParentCancel ==
  /\ phase = "EXTERNAL_DISPATCHED" /\ phase' = "EXTERNAL_CANCEL_REQUESTED"
  /\ cancelRequested' = TRUE
  /\ UNCHANGED << kind, cancelObserved, cancellationObligation, durableIntent,
                   externalDispatched, effectCommitted, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

ExternalAckApplied ==
  /\ phase = "EXTERNAL_DISPATCHED" /\ phase' = "RECONCILING"
  /\ externalTruth' = "APPLIED" /\ receipt' = "DURABLE"
  /\ lastCommitEpoch' = currentEpoch
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, staleCallbackRejected,
                   reporterContextStale, durableFactAccepted,
                   authoritativePostcondition, outcome >>

CrashAfterExternalDispatch ==
  /\ phase = "EXTERNAL_DISPATCHED" /\ generation = 0
  /\ phase' = "RESTORING" /\ generation' = 1 /\ lostOwner' = TRUE
  /\ owner' = "NONE" /\ authorizedEpochs' = {} /\ oldOwnerAuthorized' = FALSE
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, currentEpoch,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

DetachFencedReconciliation ==
  /\ phase = "EXTERNAL_CANCEL_REQUESTED" /\ phase' = "DETACHED_RECONCILING"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, lastCommitEpoch, staleCallbackRejected,
                   reporterContextStale, receipt, durableFactAccepted,
                   authoritativePostcondition, externalTruth, outcome >>

RestoreDetachedReconciliation ==
  /\ phase = "RESTORING" /\ phase' = "DETACHED_RECONCILING"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, lastCommitEpoch, staleCallbackRejected,
                   reporterContextStale, receipt, durableFactAccepted,
                   authoritativePostcondition, externalTruth, outcome >>

HandoffReconciliationEpoch ==
  /\ phase = "DETACHED_RECONCILING" /\ phase' = "DETACHED_CURRENT"
  /\ currentEpoch' = 2 /\ owner' = "P1" /\ authorizedEpochs' = {2}
  /\ oldOwnerAuthorized' = FALSE /\ lostOwner' = TRUE
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   lastCommitEpoch, staleCallbackRejected, reporterContextStale,
                   receipt, durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

RejectStaleAuthorityCallback ==
  /\ phase = "DETACHED_CURRENT" /\ ~staleCallbackRejected
  /\ staleCallbackRejected' = TRUE
  /\ UNCHANGED << phase, kind, cancelRequested, cancelObserved,
                   cancellationObligation, durableIntent, externalDispatched,
                   effectCommitted, generation, currentEpoch, owner,
                   authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   lastCommitEpoch, reporterContextStale, receipt,
                   durableFactAccepted, authoritativePostcondition,
                   externalTruth, outcome >>

AcceptStaleReporterDurableFact ==
  /\ phase = "DETACHED_CURRENT" /\ phase' = "RECONCILING"
  /\ reporterContextStale' = TRUE /\ receipt' = "DURABLE"
  /\ durableFactAccepted' = TRUE /\ externalTruth' = "APPLIED"
  /\ lastCommitEpoch' = currentEpoch
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, staleCallbackRejected,
                   authoritativePostcondition, outcome >>

DetachedLookupApplied ==
  /\ phase = "DETACHED_CURRENT" /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE" /\ externalTruth' = "APPLIED"
  /\ authoritativePostcondition' = TRUE /\ effectCommitted' = TRUE
  /\ lastCommitEpoch' = 2 /\ outcome' = "APPLIED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   staleCallbackRejected, reporterContextStale,
                   durableFactAccepted >>

DetachedLookupAbsent ==
  /\ phase = "DETACHED_CURRENT" /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE" /\ externalTruth' = "NOT_APPLIED"
  /\ authoritativePostcondition' = TRUE /\ lastCommitEpoch' = 2
  /\ outcome' = "NOT_APPLIED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, staleCallbackRejected, reporterContextStale,
                   durableFactAccepted >>

DetachedLookupUnavailable ==
  /\ phase = "DETACHED_CURRENT" /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE" /\ lastCommitEpoch' = 2
  /\ outcome' = "UNRESOLVED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, staleCallbackRejected,
                   reporterContextStale, durableFactAccepted,
                   authoritativePostcondition, externalTruth >>

ReconcileExternalApplied ==
  /\ phase = "RECONCILING" /\ externalTruth /= "NOT_APPLIED"
  /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE" /\ externalTruth' = "APPLIED"
  /\ authoritativePostcondition' = TRUE /\ effectCommitted' = TRUE
  /\ lastCommitEpoch' = currentEpoch /\ outcome' = "APPLIED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, generation, currentEpoch,
                   owner, authorizedEpochs, oldOwnerAuthorized, lostOwner,
                   staleCallbackRejected, reporterContextStale,
                   durableFactAccepted >>

ReconcileExternalAbsent ==
  /\ phase = "RECONCILING" /\ externalTruth /= "APPLIED"
  /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE" /\ externalTruth' = "NOT_APPLIED"
  /\ authoritativePostcondition' = TRUE /\ lastCommitEpoch' = currentEpoch
  /\ outcome' = "NOT_APPLIED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, staleCallbackRejected, reporterContextStale,
                   durableFactAccepted >>

ReconcileExternalUnavailable ==
  /\ phase = "RECONCILING" /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE" /\ lastCommitEpoch' = currentEpoch
  /\ outcome' = "UNRESOLVED"
  /\ UNCHANGED << kind, cancelRequested, cancelObserved, cancellationObligation,
                   durableIntent, externalDispatched, effectCommitted, generation,
                   currentEpoch, owner, authorizedEpochs, oldOwnerAuthorized,
                   lostOwner, staleCallbackRejected,
                   reporterContextStale, durableFactAccepted,
                   authoritativePostcondition, externalTruth >>

Next == SelectLocalChild \/ SelectExternalMutation \/ StartLocalChild
        \/ EnterLocalPrecommit \/ RequestLocalCancel \/ CommitLocalEffect
        \/ CommitBeforeCancelObserved \/ ObserveLocalCancel
        \/ StopCancelledChild \/ PersistExternalIntent
        \/ DispatchNoncancellableEffect \/ RequestParentCancel
        \/ ExternalAckApplied \/ CrashAfterExternalDispatch
        \/ DetachFencedReconciliation \/ RestoreDetachedReconciliation
        \/ HandoffReconciliationEpoch \/ RejectStaleAuthorityCallback
        \/ AcceptStaleReporterDurableFact \/ DetachedLookupApplied
        \/ DetachedLookupAbsent \/ DetachedLookupUnavailable
        \/ ReconcileExternalApplied \/ ReconcileExternalAbsent
        \/ ReconcileExternalUnavailable

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
        /\ WF_vars(StopCancelledChild)
        /\ WF_vars(RestoreDetachedReconciliation)
        /\ WF_vars(HandoffReconciliationEpoch)

TypeOK ==
  /\ phase \in {"IDLE", "LOCAL_READY", "LOCAL_RUNNING", "LOCAL_PRECOMMIT",
                 "LOCAL_CANCEL_REQUESTED", "LOCAL_CANCEL_OBSERVED",
                 "EXTERNAL_READY", "EXTERNAL_INTENT_DURABLE", "EXTERNAL_DISPATCHED",
                 "EXTERNAL_CANCEL_REQUESTED", "RESTORING", "DETACHED_RECONCILING",
                 "DETACHED_CURRENT", "RECONCILING", "TERMINAL"}
  /\ kind \in {"NONE", "LOCAL_CHILD", "EXTERNAL_MUTATION"}
  /\ cancelRequested \in BOOLEAN /\ cancelObserved \in BOOLEAN
  /\ cancellationObligation \in BOOLEAN /\ durableIntent \in BOOLEAN
  /\ externalDispatched \in BOOLEAN /\ effectCommitted \in BOOLEAN
  /\ generation \in 0..1 /\ currentEpoch \in 1..2
  /\ owner \in {"NONE", "P0", "P1"} /\ authorizedEpochs \subseteq {1, 2}
  /\ oldOwnerAuthorized \in BOOLEAN /\ lostOwner \in BOOLEAN
  /\ lastCommitEpoch \in 0..2 /\ staleCallbackRejected \in BOOLEAN
  /\ reporterContextStale \in BOOLEAN /\ receipt \in {"NONE", "DURABLE"}
  /\ durableFactAccepted \in BOOLEAN /\ authoritativePostcondition \in BOOLEAN
  /\ externalTruth \in {"UNKNOWN", "APPLIED", "NOT_APPLIED"}
  /\ outcome \in {"PENDING", "LOCAL_DONE", "CANCELLED", "APPLIED",
                    "NOT_APPLIED", "UNRESOLVED"}

SingleEpochAuthority == Cardinality(authorizedEpochs) <= 1
  /\ \A epoch \in authorizedEpochs: epoch = currentEpoch
NoStaleCommit == lastCommitEpoch = 0
  \/ (lastCommitEpoch = currentEpoch /\ lastCommitEpoch \in authorizedEpochs)
DurableFactLaw == ~reporterContextStale \/ (receipt = "DURABLE" /\ durableFactAccepted)
\* SAF-03 is transition-sensitive: after a durable APPLIED fact exists, no
\* later reconciliation state may regress or discard it.
DurableAppliedFactPreserved == [](receipt = "DURABLE" /\ externalTruth = "APPLIED"
  => [] (externalTruth = "APPLIED"))
DurableIntentBeforeMutation == ~externalDispatched \/ durableIntent
AuthoritativeExternalTerminal == outcome \notin {"APPLIED", "NOT_APPLIED"}
  \/ authoritativePostcondition
LocalCancellationStopsEffect == [](cancellationObligation
  => <> (phase = "TERMINAL" /\ outcome = "CANCELLED" /\ ~effectCommitted))
\* Lost-owner authority is represented as an immediate fencing safety step in
\* this abstraction, so no separate (vacuous) liveness property is claimed.
\* This whole-checkpoint equivalence is an abstraction under the modeled sole
\* durable store: restoring durable intent means the complete checkpoint is
\* reconstructed, with no second restore authority able to diverge from it.
RestartReconstructs == [](phase = "RESTORING"
  => <> (phase /= "RESTORING" /\ durableIntent))
ExternalReconciles == [](externalDispatched /\ outcome = "PENDING"
  => <> (outcome \in {"APPLIED", "NOT_APPLIED", "UNRESOLVED"}))

=============================================================================
