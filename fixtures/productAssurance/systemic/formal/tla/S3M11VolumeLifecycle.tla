-------------------- MODULE S3M11VolumeLifecycle --------------------
EXTENDS Naturals

\* SYNTHETIC_ONLY
\* SUPPORTING_EVIDENCE_ONLY
\* runtime_claim_closure NOT_PERMITTED
\* frozen donor df6b472993ca9659ce09cf5f72004981c6835f0d
\* TLA tooling not configured
\* Finite envelope: one record-only Volume lifecycle over PROBE, CONFIRM,
\* ADD_ALLOWED, HOLD, REDUCE, EXIT, and RECOVERY; at most one ENTRY or ADD
\* record; one halt; one twin ambiguity; and capital in 0..2.
VARIABLES phase, posture, sourceTruth, unknownSeen, action, sendable,
          riskIncreaseRecords, haltSnapshot, capitalBefore, capital,
          recoveryCeiling, pendingTwin, decision

vars == << phase, posture, sourceTruth, unknownSeen, action, sendable,
           riskIncreaseRecords, haltSnapshot, capitalBefore, capital,
           recoveryCeiling, pendingTwin, decision >>

Init ==
  /\ phase = "PROBE" /\ posture = "OPEN" /\ sourceTruth = "KNOWN"
  /\ ~unknownSeen /\ action = "NONE" /\ ~sendable
  /\ riskIncreaseRecords = 0 /\ haltSnapshot = 0
  /\ capitalBefore = 1 /\ capital = 1 /\ recoveryCeiling = 1
  /\ ~pendingTwin /\ decision = "UNKNOWN"

ConfirmProbe ==
  /\ phase = "PROBE" /\ phase' = "CONFIRM"
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, action, sendable,
                   riskIncreaseRecords, haltSnapshot, capitalBefore, capital,
                   recoveryCeiling, pendingTwin, decision >>

RecordEntry ==
  /\ phase = "CONFIRM" /\ posture = "OPEN" /\ sourceTruth = "KNOWN"
  /\ riskIncreaseRecords = 0
  /\ phase' = "HOLD" /\ action' = "ENTRY" /\ sendable' = FALSE
  /\ riskIncreaseRecords' = 1 /\ capital' = 2 /\ decision' = "PASS"
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, haltSnapshot,
                   capitalBefore, recoveryCeiling, pendingTwin >>

AllowAdd ==
  /\ phase = "CONFIRM" /\ posture = "OPEN" /\ sourceTruth = "KNOWN"
  /\ phase' = "ADD_ALLOWED" /\ decision' = "PASS"
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, action, sendable,
                   riskIncreaseRecords, haltSnapshot, capitalBefore, capital,
                   recoveryCeiling, pendingTwin >>

RecordAdd ==
  /\ phase = "ADD_ALLOWED" /\ posture = "OPEN" /\ sourceTruth = "KNOWN"
  /\ riskIncreaseRecords = 0
  /\ phase' = "HOLD" /\ action' = "ADD" /\ sendable' = FALSE
  /\ riskIncreaseRecords' = 1 /\ capital' = 2
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, haltSnapshot,
                   capitalBefore, recoveryCeiling, pendingTwin, decision >>

EngageHalt ==
  /\ phase \in {"PROBE", "CONFIRM", "ADD_ALLOWED", "HOLD", "REDUCE"}
  /\ posture = "OPEN" /\ posture' = "HALT"
  /\ phase' = "EXIT" /\ action' = "EXIT"
  /\ haltSnapshot' = riskIncreaseRecords /\ sendable' = FALSE
  /\ decision' = IF sourceTruth = "UNKNOWN" THEN "UNKNOWN" ELSE "FAIL"
  /\ UNCHANGED << sourceTruth, unknownSeen, riskIncreaseRecords,
                   capitalBefore, capital, recoveryCeiling, pendingTwin >>

BeginReduce ==
  /\ phase \in {"ADD_ALLOWED", "HOLD"} /\ capital > 0
  /\ phase' = "REDUCE" /\ action' = "REDUCE" /\ sendable' = FALSE
  /\ capital' = capital - 1
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, riskIncreaseRecords,
                   haltSnapshot, capitalBefore, recoveryCeiling, pendingTwin,
                   decision >>

BeginExit ==
  /\ phase \in {"ADD_ALLOWED", "HOLD", "REDUCE"}
  /\ phase' = "EXIT" /\ action' = "EXIT" /\ sendable' = FALSE
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, riskIncreaseRecords,
                   haltSnapshot, capitalBefore, capital, recoveryCeiling,
                   pendingTwin, decision >>

LoseTwinTruth ==
  /\ phase \in {"HOLD", "REDUCE", "EXIT"} /\ ~pendingTwin /\ ~unknownSeen
  /\ phase' = "RECOVERY" /\ posture' = "REPAIR"
  /\ sourceTruth' = "UNKNOWN" /\ unknownSeen' = TRUE
  /\ pendingTwin' = TRUE /\ recoveryCeiling' = capital
  /\ decision' = "UNKNOWN" /\ sendable' = FALSE
  /\ UNCHANGED << action, riskIncreaseRecords, haltSnapshot, capitalBefore,
                   capital >>

ReduceRecovery ==
  /\ phase = "RECOVERY" /\ posture = "REPAIR" /\ capital > 0
  /\ capital' = capital - 1 /\ action' = "REDUCE" /\ sendable' = FALSE
  /\ UNCHANGED << phase, posture, sourceTruth, unknownSeen,
                   riskIncreaseRecords, haltSnapshot, capitalBefore,
                   recoveryCeiling, pendingTwin, decision >>

ReconcileTwin ==
  /\ phase = "RECOVERY" /\ pendingTwin
  /\ phase' = "EXIT" /\ sourceTruth' = "KNOWN" /\ pendingTwin' = FALSE
  /\ action' = "EXIT" /\ sendable' = FALSE /\ decision' = "RECONCILED"
  /\ UNCHANGED << posture, unknownSeen, riskIncreaseRecords, haltSnapshot,
                   capitalBefore, capital, recoveryCeiling >>

FinishExit ==
  /\ phase = "EXIT" /\ ~pendingTwin
  /\ phase' = "CLOSED" /\ capital' = 0 /\ sendable' = FALSE
  /\ decision' = IF unknownSeen THEN "RECONCILED" ELSE "PASS"
  /\ UNCHANGED << posture, sourceTruth, unknownSeen, action,
                   riskIncreaseRecords, haltSnapshot, capitalBefore,
                   recoveryCeiling, pendingTwin >>

Next == ConfirmProbe \/ RecordEntry \/ AllowAdd \/ RecordAdd \/ EngageHalt
        \/ BeginReduce \/ BeginExit \/ LoseTwinTruth \/ ReduceRecovery
        \/ ReconcileTwin \/ FinishExit

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
        /\ WF_vars(ReconcileTwin) /\ WF_vars(FinishExit)

TypeOK ==
  /\ phase \in {"PROBE", "CONFIRM", "ADD_ALLOWED", "HOLD", "REDUCE",
                 "EXIT", "RECOVERY", "CLOSED"}
  /\ posture \in {"OPEN", "HALT", "REPAIR"}
  /\ sourceTruth \in {"KNOWN", "UNKNOWN"} /\ unknownSeen \in BOOLEAN
  /\ action \in {"NONE", "ENTRY", "ADD", "REDUCE", "EXIT"}
  /\ sendable \in BOOLEAN /\ riskIncreaseRecords \in 0..1
  /\ haltSnapshot \in 0..1 /\ capitalBefore \in 1..1
  /\ capital \in 0..2 /\ recoveryCeiling \in 0..2
  /\ pendingTwin \in BOOLEAN
  /\ decision \in {"UNKNOWN", "PASS", "FAIL", "RECONCILED"}

RecordOnly == ~sendable

HaltForbidsEntryAndAdd ==
  posture = "HALT" => riskIncreaseRecords = haltSnapshot

ExitIsNonSendable == action /= "EXIT" \/ ~sendable

RecoveryCapitalCeiling ==
  posture /= "REPAIR" \/ capital <= recoveryCeiling

PendingTwinIsRecovery == ~pendingTwin \/ phase = "RECOVERY"

UnknownNeverSettlesPass == ~unknownSeen \/ decision /= "PASS"

VolumeObligationResolves ==
  phase \in {"CONFIRM", "ADD_ALLOWED", "HOLD", "REDUCE", "EXIT", "RECOVERY"}
    ~> phase = "CLOSED"

TwinReconciliationResolves == pendingTwin ~> ~pendingTwin

ExitEventuallyCloses == phase = "EXIT" ~> phase = "CLOSED"

=====================================================================
