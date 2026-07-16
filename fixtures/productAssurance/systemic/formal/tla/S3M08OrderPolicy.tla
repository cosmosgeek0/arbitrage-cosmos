-------------------- MODULE S3M08OrderPolicy --------------------
EXTENDS Naturals

\* SYNTHETIC_ONLY. SUPPORTING_EVIDENCE_ONLY.
\* runtime_claim_closure: NOT_PERMITTED.
\* Frozen donor: df6b472993ca9659ce09cf5f72004981c6835f0d.
\* TLA tooling is not configured; this is a source-only abstraction.
\* Finite envelope: one policy evaluation, one halt/unknown/repair choice,
\* one bounded-capital order decision, and one submission at most.
VARIABLES phase, posture, sourceTruth, repair, capitalBefore, capitalAfter,
          orderSubmitted, decision

vars == << phase, posture, sourceTruth, repair, capitalBefore, capitalAfter,
           orderSubmitted, decision >>

Init ==
  /\ phase = "RAW" /\ posture = "OPEN" /\ sourceTruth = "KNOWN"
  /\ ~repair /\ capitalBefore = 1 /\ capitalAfter = 1
  /\ ~orderSubmitted /\ decision = "UNKNOWN"

StartEvaluation ==
  /\ phase = "RAW" /\ phase' = "EVALUATE"
  /\ UNCHANGED << posture, sourceTruth, repair, capitalBefore, capitalAfter,
                   orderSubmitted, decision >>

EngageHalt ==
  /\ phase \in {"RAW", "EVALUATE", "PLANNED"} /\ ~orderSubmitted
  /\ posture' = "HALT"
  /\ phase' = IF phase = "PLANNED" THEN "REJECTED" ELSE phase
  /\ decision' = IF phase = "PLANNED" THEN "FAIL" ELSE decision
  /\ UNCHANGED << sourceTruth, repair, capitalBefore, capitalAfter,
                   orderSubmitted >>

LoseSourceTruth ==
  /\ phase \in {"RAW", "EVALUATE"} /\ sourceTruth = "KNOWN"
  /\ sourceTruth' = "UNKNOWN"
  /\ UNCHANGED << phase, posture, repair, capitalBefore, capitalAfter,
                   orderSubmitted, decision >>

EnterRepair ==
  /\ phase \in {"RAW", "EVALUATE", "PLANNED"} /\ ~orderSubmitted
  /\ repair' = TRUE
  /\ phase' = IF phase = "PLANNED" THEN "REJECTED" ELSE phase
  /\ decision' = IF phase = "PLANNED" THEN "FAIL" ELSE decision
  /\ UNCHANGED << posture, sourceTruth, capitalBefore, capitalAfter,
                   orderSubmitted >>

PlanOrder ==
  /\ phase = "EVALUATE" /\ posture = "OPEN"
  /\ sourceTruth = "KNOWN" /\ ~repair
  /\ phase' = "PLANNED" /\ decision' = "PASS"
  /\ UNCHANGED << posture, sourceTruth, repair, capitalBefore, capitalAfter,
                   orderSubmitted >>

RejectOrder ==
  /\ phase = "EVALUATE"
  /\ ~(posture = "OPEN" /\ sourceTruth = "KNOWN" /\ ~repair)
  /\ phase' = "REJECTED"
  /\ decision' = IF sourceTruth = "UNKNOWN" THEN "UNKNOWN" ELSE "FAIL"
  /\ UNCHANGED << posture, sourceTruth, repair, capitalBefore, capitalAfter,
                   orderSubmitted >>

SubmitPlannedOrder ==
  /\ phase = "PLANNED" /\ posture = "OPEN"
  /\ sourceTruth = "KNOWN" /\ ~repair /\ ~orderSubmitted
  /\ orderSubmitted' = TRUE /\ capitalAfter' = 2
  /\ UNCHANGED << phase, posture, sourceTruth, repair, capitalBefore,
                   decision >>

ReduceDuringRepair ==
  /\ repair /\ capitalAfter = 1 /\ capitalAfter' = 0
  /\ UNCHANGED << phase, posture, sourceTruth, repair, capitalBefore,
                   orderSubmitted, decision >>

Next == StartEvaluation \/ EngageHalt \/ LoseSourceTruth \/ EnterRepair
        \/ PlanOrder \/ RejectOrder \/ SubmitPlannedOrder
        \/ ReduceDuringRepair

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
  /\ phase \in {"RAW", "EVALUATE", "PLANNED", "REJECTED"}
  /\ posture \in {"OPEN", "HALT"}
  /\ sourceTruth \in {"KNOWN", "UNKNOWN"}
  /\ repair \in BOOLEAN /\ orderSubmitted \in BOOLEAN
  /\ capitalBefore \in 0..1 /\ capitalAfter \in 0..2
  /\ decision \in {"UNKNOWN", "PASS", "FAIL"}

NoOrderAfterHalt == posture = "HALT" => ~orderSubmitted

RepairCapitalCeiling == repair => capitalAfter <= capitalBefore

UnknownNeverPass == sourceTruth = "UNKNOWN" => decision /= "PASS"

PlannedDecisionSound ==
  phase = "PLANNED" =>
    posture = "OPEN" /\ sourceTruth = "KNOWN" /\ ~repair

EvaluationResolves ==
  phase = "EVALUATE" ~> phase \in {"PLANNED", "REJECTED"}

PlannedOrderResolves ==
  phase = "PLANNED" ~> (orderSubmitted \/ phase = "REJECTED")

=============================================================
