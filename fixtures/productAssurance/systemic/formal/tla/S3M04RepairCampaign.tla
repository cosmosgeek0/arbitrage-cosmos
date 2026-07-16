-------------------- MODULE S3M04RepairCampaign --------------------
EXTENDS Naturals, FiniteSets

\* Finite envelope: two attempts, one crash, three fencing epochs, one quiet tick.
\* Restart equivalence is an abstraction: the sole durable store restores the
\* complete modeled campaign checkpoint, and no second restore authority exists.
VARIABLES phase, durable, attempts, generation, epoch, owner, authorizedEpochs,
          oldOwnerAuthorized, actionCommitted, completionEpoch,
          compensationFenceAcquired, compensationCommitEpoch, independent,
          quietTicks, incidentOpen, outcome, staleCompletionAvailable,
          staleCompletionRejected

vars == << phase, durable, attempts, generation, epoch, owner, authorizedEpochs,
           oldOwnerAuthorized, actionCommitted, completionEpoch,
           compensationFenceAcquired, compensationCommitEpoch, independent,
           quietTicks, incidentOpen, outcome, staleCompletionAvailable,
           staleCompletionRejected >>

Terminal == {"RECOVERED", "COMPENSATED", "QUARANTINED",
             "FAILED_ATTENTION_REQUIRED", "DURABLE_UNRESOLVED"}
RollbackTerminals == {"QUARANTINED", "FAILED_ATTENTION_REQUIRED",
                      "DURABLE_UNRESOLVED"}

Init ==
  /\ phase = "DETECTED" /\ ~durable /\ attempts = 0 /\ generation = 0
  /\ epoch = 0 /\ owner = "NONE" /\ authorizedEpochs = {}
  /\ ~oldOwnerAuthorized /\ ~actionCommitted /\ completionEpoch = 0
  /\ ~compensationFenceAcquired /\ compensationCommitEpoch = 0
  /\ independent = "NONE" /\ quietTicks = 0 /\ incidentOpen
  /\ outcome = "PENDING"
  /\ ~staleCompletionAvailable /\ ~staleCompletionRejected

Persist ==
  /\ phase = "DETECTED" /\ phase' = "CONTAINING" /\ durable' = TRUE
  /\ UNCHANGED << attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

Contain ==
  /\ phase = "CONTAINING" /\ phase' = "DIAGNOSING"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

Plan ==
  /\ phase = "DIAGNOSING" /\ phase' = "PLANNED"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

Acquire ==
  /\ phase = "PLANNED" /\ attempts < 2
  /\ phase' = "EXECUTING" /\ attempts' = attempts + 1 /\ epoch' = epoch + 1
  /\ owner' = IF generation = 0 THEN "P0" ELSE "P1"
  /\ authorizedEpochs' = {epoch + 1}
  /\ oldOwnerAuthorized' = (generation = 0)
  /\ UNCHANGED << durable, generation, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

ActionSuccess ==
  /\ phase = "EXECUTING" /\ ~staleCompletionAvailable
  /\ phase' = "VERIFYING"
  /\ actionCommitted' = TRUE /\ completionEpoch' = epoch
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, compensationFenceAcquired,
                   compensationCommitEpoch, independent, quietTicks,
                   incidentOpen, outcome, staleCompletionAvailable,
                   staleCompletionRejected >>

TransientFailure ==
  /\ phase = "EXECUTING" /\ ~staleCompletionAvailable
  /\ phase' = IF attempts < 2 THEN "RETRY_WAIT" ELSE "ROLLING_BACK"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

Retry ==
  /\ phase = "RETRY_WAIT" /\ attempts < 2
  /\ phase' = "EXECUTING" /\ attempts' = attempts + 1
  /\ UNCHANGED << durable, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

PermanentFailure ==
  /\ phase = "EXECUTING" /\ ~staleCompletionAvailable
  /\ phase' = "ROLLING_BACK"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

Crash ==
  /\ phase = "EXECUTING" /\ generation = 0 /\ ~staleCompletionAvailable
  /\ phase' = "RESTORING" /\ generation' = 1
  /\ owner' = "NONE" /\ authorizedEpochs' = {} /\ oldOwnerAuthorized' = FALSE
  /\ staleCompletionAvailable' = TRUE
  /\ UNCHANGED << durable, attempts, epoch, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionRejected >>

Restore ==
  /\ phase = "RESTORING"
  /\ phase' = IF attempts < 2 THEN "PLANNED" ELSE "ROLLING_BACK"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

\* A completion emitted by the pre-crash epoch is surfaced and rejected before
\* any current-epoch success or failure can advance the campaign.
RejectStaleCompletion ==
  /\ phase = "EXECUTING" /\ staleCompletionAvailable
  /\ staleCompletionAvailable' = FALSE /\ staleCompletionRejected' = TRUE
  /\ UNCHANGED << phase, durable, attempts, generation, epoch, owner,
                   authorizedEpochs, oldOwnerAuthorized, actionCommitted,
                   completionEpoch, compensationFenceAcquired,
                   compensationCommitEpoch, independent, quietTicks,
                   incidentOpen, outcome >>

VerifyPass ==
  /\ phase = "VERIFYING" /\ phase' = "QUIET" /\ independent' = "PASS"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   quietTicks, incidentOpen, outcome, staleCompletionAvailable,
                   staleCompletionRejected >>

VerifyFail ==
  /\ phase = "VERIFYING" /\ phase' = "ROLLING_BACK" /\ independent' = "FAIL"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   quietTicks, incidentOpen, outcome, staleCompletionAvailable,
                   staleCompletionRejected >>

\* Missing independent evidence is not a rollback success signal. It fails
\* closed into quarantine with the incident still open.
VerifyUnavailable ==
  /\ phase = "VERIFYING" /\ phase' = "QUARANTINED"
  /\ independent' = "UNKNOWN" /\ outcome' = "QUARANTINED"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   quietTicks, incidentOpen, staleCompletionAvailable,
                   staleCompletionRejected >>

Quiet ==
  /\ phase = "QUIET" /\ quietTicks = 0 /\ quietTicks' = 1
  /\ UNCHANGED << phase, durable, attempts, generation, epoch, owner,
                   authorizedEpochs, oldOwnerAuthorized, actionCommitted,
                   completionEpoch, compensationFenceAcquired,
                   compensationCommitEpoch, independent, incidentOpen, outcome,
                   staleCompletionAvailable, staleCompletionRejected >>

Recover ==
  /\ phase = "QUIET" /\ quietTicks = 1 /\ independent = "PASS"
  /\ phase' = "RECOVERED" /\ incidentOpen' = FALSE /\ outcome' = "RECOVERED"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, staleCompletionAvailable,
                   staleCompletionRejected >>

\* Compensation is a separately fenced effect. ROLLING_BACK can only acquire
\* a fresh epoch or fail closed; it cannot commit compensation directly.
AcquireCompensationFence ==
  /\ phase = "ROLLING_BACK" /\ epoch < 3
  /\ phase' = "COMPENSATING" /\ epoch' = epoch + 1
  /\ owner' = IF generation = 0 THEN "P0" ELSE "P1"
  /\ authorizedEpochs' = {epoch + 1} /\ oldOwnerAuthorized' = FALSE
  /\ compensationFenceAcquired' = TRUE
  /\ UNCHANGED << durable, attempts, generation, actionCommitted,
                   completionEpoch, compensationCommitEpoch, independent,
                   quietTicks, incidentOpen, outcome, staleCompletionAvailable,
                   staleCompletionRejected >>

CompensationSucceeded ==
  /\ phase = "COMPENSATING" /\ compensationFenceAcquired
  /\ owner /= "NONE" /\ authorizedEpochs = {epoch}
  /\ phase' = "COMPENSATED" /\ compensationCommitEpoch' = epoch
  /\ outcome' = "COMPENSATED"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, independent, quietTicks,
                   incidentOpen, staleCompletionAvailable,
                   staleCompletionRejected >>

CompensationFailed ==
  /\ phase = "COMPENSATING" /\ compensationFenceAcquired
  /\ owner /= "NONE" /\ authorizedEpochs = {epoch}
  /\ phase' = "COMPENSATION_FAILED" /\ compensationCommitEpoch' = epoch
  /\ outcome' = "PENDING"
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, independent, quietTicks,
                   incidentOpen, staleCompletionAvailable,
                   staleCompletionRejected >>

RollbackTerminal(result) ==
  /\ phase = "ROLLING_BACK" /\ result \in RollbackTerminals
  /\ phase' = result /\ outcome' = result
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen,
                   staleCompletionAvailable, staleCompletionRejected >>

HandleCompensationFailure(result) ==
  /\ phase = "COMPENSATION_FAILED" /\ result \in RollbackTerminals
  /\ phase' = result /\ outcome' = result
  /\ UNCHANGED << durable, attempts, generation, epoch, owner, authorizedEpochs,
                   oldOwnerAuthorized, actionCommitted, completionEpoch,
                   compensationFenceAcquired, compensationCommitEpoch,
                   independent, quietTicks, incidentOpen,
                   staleCompletionAvailable, staleCompletionRejected >>

Next == Persist \/ Contain \/ Plan \/ Acquire \/ ActionSuccess \/ TransientFailure
        \/ Retry \/ PermanentFailure \/ Crash \/ Restore \/ RejectStaleCompletion
        \/ VerifyPass \/ VerifyFail \/ VerifyUnavailable \/ Quiet \/ Recover
        \/ AcquireCompensationFence \/ CompensationSucceeded
        \/ CompensationFailed
        \/ (\E result \in RollbackTerminals: RollbackTerminal(result))
        \/ (\E result \in RollbackTerminals: HandleCompensationFailure(result))
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
  /\ phase \in {"DETECTED", "CONTAINING", "DIAGNOSING", "PLANNED", "EXECUTING",
                  "RETRY_WAIT", "RESTORING", "VERIFYING", "QUIET", "ROLLING_BACK",
                  "COMPENSATING", "COMPENSATION_FAILED"} \cup Terminal
  /\ durable \in BOOLEAN /\ attempts \in 0..2 /\ generation \in 0..1
  /\ epoch \in 0..3 /\ owner \in {"NONE", "P0", "P1"}
  /\ authorizedEpochs \subseteq 0..3 /\ Cardinality(authorizedEpochs) <= 1
  /\ oldOwnerAuthorized \in BOOLEAN /\ actionCommitted \in BOOLEAN
  /\ completionEpoch \in 0..3 /\ compensationFenceAcquired \in BOOLEAN
  /\ compensationCommitEpoch \in 0..3
  /\ independent \in {"NONE", "PASS", "FAIL", "UNKNOWN"}
  /\ quietTicks \in 0..1 /\ incidentOpen \in BOOLEAN
  /\ outcome \in Terminal \cup {"PENDING"}
  /\ staleCompletionAvailable \in BOOLEAN /\ staleCompletionRejected \in BOOLEAN

SingleRepairEpoch == authorizedEpochs = {} \/ authorizedEpochs = {epoch}
CurrentCompletion == completionEpoch = 0
  \/ (completionEpoch <= epoch
      /\ (~(phase \in {"VERIFYING", "QUIET", "RECOVERED"})
          \/ completionEpoch = epoch))
CurrentCompensationCommit == compensationCommitEpoch = 0
  \/ (compensationFenceAcquired /\ compensationCommitEpoch = epoch
      /\ owner /= "NONE" /\ authorizedEpochs = {epoch})
StaleCompletionCannotCommit == ~staleCompletionAvailable \/ completionEpoch = 0
RecoveryRequiresIndependentProof == phase /= "RECOVERED"
  \/ (actionCommitted /\ independent = "PASS" /\ quietTicks = 1)
IncidentClearLaw == incidentOpen
  \/ (phase = "RECOVERED" /\ independent = "PASS" /\ quietTicks = 1)
AttemptBudgetBounded == attempts <= 2
RepairTerminates == [](durable => <> (phase \in Terminal))
RestartReconstructs == [](phase = "RESTORING" => <> (phase /= "RESTORING"))

=============================================================================
