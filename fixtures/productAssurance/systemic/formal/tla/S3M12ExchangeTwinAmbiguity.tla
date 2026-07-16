-------------------- MODULE S3M12ExchangeTwinAmbiguity --------------------
EXTENDS Naturals

\* SYNTHETIC_ONLY
\* SUPPORTING_EVIDENCE_ONLY
\* runtime_claim_closure NOT_PERMITTED
\* frozen donor df6b472993ca9659ce09cf5f72004981c6835f0d
\* TLA tooling not configured
\* Finite envelope: one order, one cancellation, one equal-time ambiguity,
\* one fill unit, one crash/restore, and one exact reconciliation result.
VARIABLES phase, durableIntent, orderCount, cancelCount, equalTime,
          sourceProved, truth, unknownSeen, fillUnits, allocatedFill,
          fillBeforeCancel, cancelAck, generation, outcome

vars == << phase, durableIntent, orderCount, cancelCount, equalTime,
           sourceProved, truth, unknownSeen, fillUnits, allocatedFill,
           fillBeforeCancel, cancelAck, generation, outcome >>

Init ==
  /\ phase = "IDLE" /\ ~durableIntent /\ orderCount = 0
  /\ cancelCount = 0 /\ ~equalTime /\ ~sourceProved
  /\ truth = "UNKNOWN" /\ ~unknownSeen /\ fillUnits = 0
  /\ allocatedFill = 0 /\ fillBeforeCancel = 0 /\ ~cancelAck
  /\ generation = 0 /\ outcome = "PENDING"

PersistOrderIntent ==
  /\ phase = "IDLE" /\ phase' = "INTENT_DURABLE"
  /\ durableIntent' = TRUE
  /\ UNCHANGED << orderCount, cancelCount, equalTime, sourceProved, truth,
                   unknownSeen, fillUnits, allocatedFill, fillBeforeCancel,
                   cancelAck, generation, outcome >>

SubmitOrder ==
  /\ phase = "INTENT_DURABLE" /\ durableIntent /\ orderCount = 0
  /\ phase' = "SUBMITTED" /\ orderCount' = 1
  /\ UNCHANGED << durableIntent, cancelCount, equalTime, sourceProved, truth,
                   unknownSeen, fillUnits, allocatedFill, fillBeforeCancel,
                   cancelAck, generation, outcome >>

ObserveFillBeforeCancel ==
  /\ phase = "SUBMITTED" /\ fillUnits = 0
  /\ fillUnits' = 1 /\ allocatedFill' = 1 /\ sourceProved' = TRUE
  /\ truth' = "APPLIED"
  /\ UNCHANGED << phase, durableIntent, orderCount, cancelCount, equalTime,
                   unknownSeen, fillBeforeCancel, cancelAck, generation,
                   outcome >>

RequestCancel ==
  /\ phase = "SUBMITTED" /\ cancelCount = 0
  /\ phase' = "CANCEL_REQUESTED" /\ cancelCount' = 1
  /\ fillBeforeCancel' = fillUnits
  /\ UNCHANGED << durableIntent, orderCount, equalTime, sourceProved, truth,
                   unknownSeen, fillUnits, allocatedFill, cancelAck,
                   generation, outcome >>

ObserveEqualTimeUnproved ==
  /\ phase = "CANCEL_REQUESTED" /\ fillBeforeCancel = 0
  /\ phase' = "AMBIGUOUS" /\ equalTime' = TRUE
  /\ sourceProved' = FALSE /\ truth' = "UNKNOWN" /\ unknownSeen' = TRUE
  /\ fillUnits' = 0 /\ allocatedFill' = 0 /\ outcome' = "UNKNOWN"
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, fillBeforeCancel,
                   cancelAck, generation >>

ObserveCancelAck ==
  /\ phase \in {"CANCEL_REQUESTED", "AMBIGUOUS"}
  /\ phase' = "RECONCILING" /\ cancelAck' = TRUE
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, equalTime,
                   sourceProved, truth, unknownSeen, fillUnits, allocatedFill,
                   fillBeforeCancel, generation, outcome >>

CrashDuringReconciliation ==
  /\ phase \in {"AMBIGUOUS", "RECONCILING"} /\ generation = 0
  /\ phase' = "CRASHED" /\ generation' = 1
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, equalTime,
                   sourceProved, truth, unknownSeen, fillUnits, allocatedFill,
                   fillBeforeCancel, cancelAck, outcome >>

RestoreDurableRace ==
  /\ phase = "CRASHED" /\ durableIntent
  /\ phase' = "RESTORED"
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, equalTime,
                   sourceProved, truth, unknownSeen, fillUnits, allocatedFill,
                   fillBeforeCancel, cancelAck, generation, outcome >>

ResumeExactReconciliation ==
  /\ phase = "RESTORED" /\ phase' = "RECONCILING"
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, equalTime,
                   sourceProved, truth, unknownSeen, fillUnits, allocatedFill,
                   fillBeforeCancel, cancelAck, generation, outcome >>

ReconcileApplied ==
  /\ phase = "RECONCILING"
  /\ phase' = "TERMINAL" /\ sourceProved' = TRUE /\ truth' = "APPLIED"
  /\ fillUnits' = 1 /\ allocatedFill' = 1 /\ outcome' = "APPLIED"
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, equalTime,
                   unknownSeen, fillBeforeCancel, cancelAck, generation >>

ReconcileAbsent ==
  /\ phase = "RECONCILING" /\ fillBeforeCancel = 0
  /\ phase' = "TERMINAL" /\ sourceProved' = TRUE
  /\ truth' = "NOT_APPLIED" /\ fillUnits' = 0 /\ allocatedFill' = 0
  /\ outcome' = "NOT_APPLIED"
  /\ UNCHANGED << durableIntent, orderCount, cancelCount, equalTime,
                   unknownSeen, fillBeforeCancel, cancelAck, generation >>

Next == PersistOrderIntent \/ SubmitOrder \/ ObserveFillBeforeCancel
        \/ RequestCancel \/ ObserveEqualTimeUnproved \/ ObserveCancelAck
        \/ CrashDuringReconciliation \/ RestoreDurableRace
        \/ ResumeExactReconciliation \/ ReconcileApplied \/ ReconcileAbsent

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
        /\ WF_vars(RestoreDurableRace) /\ WF_vars(ResumeExactReconciliation)

TypeOK ==
  /\ phase \in {"IDLE", "INTENT_DURABLE", "SUBMITTED", "CANCEL_REQUESTED",
                 "AMBIGUOUS", "RECONCILING", "CRASHED", "RESTORED",
                 "TERMINAL"}
  /\ durableIntent \in BOOLEAN /\ orderCount \in 0..1
  /\ cancelCount \in 0..1 /\ equalTime \in BOOLEAN
  /\ sourceProved \in BOOLEAN
  /\ truth \in {"UNKNOWN", "APPLIED", "NOT_APPLIED"}
  /\ unknownSeen \in BOOLEAN /\ fillUnits \in 0..1
  /\ allocatedFill \in 0..1 /\ fillBeforeCancel \in 0..1
  /\ cancelAck \in BOOLEAN /\ generation \in 0..1
  /\ outcome \in {"PENDING", "UNKNOWN", "APPLIED", "NOT_APPLIED"}

DurableIntentBeforeOrder == orderCount = 0 \/ durableIntent

OneOrderCancelRace == orderCount <= 1 /\ cancelCount <= 1

EqualTimeUnprovedAllocatesNoFill ==
  ~(equalTime /\ ~sourceProved) \/ allocatedFill = 0

CancelAckRetainsPriorFills == ~cancelAck \/ fillUnits >= fillBeforeCancel

UnknownNeverObserved ==
  truth /= "UNKNOWN" \/ outcome \notin {"APPLIED", "NOT_APPLIED"}

ExactTerminalReconciliation ==
  phase /= "TERMINAL" \/
    (sourceProved /\
      ((truth = "APPLIED" /\ fillUnits = 1 /\ allocatedFill = 1)
       \/ (truth = "NOT_APPLIED" /\ fillUnits = 0 /\ allocatedFill = 0)))

AmbiguityEventuallyReconciles ==
  phase = "AMBIGUOUS" ~> phase = "TERMINAL"

CrashEventuallyRestores == phase = "CRASHED" ~> phase = "RESTORED"

CancelEventuallySettles ==
  phase = "CANCEL_REQUESTED" ~> phase = "TERMINAL"

=====================================================================
