-------------------- MODULE S3M09NormalBasisLifecycle --------------------
EXTENDS Naturals

\* SYNTHETIC_ONLY. SUPPORTING_EVIDENCE_ONLY.
\* runtime_claim_closure: NOT_PERMITTED.
\* Frozen donor: df6b472993ca9659ce09cf5f72004981c6835f0d.
\* TLA tooling is not configured; this is a source-only abstraction.
\* Finite envelope: one durable plan, two unit legs, one cancellation request,
\* one possible late fill, one ambiguity proof, and one recovery submission.
VARIABLES phase, planDurable, submissions, terminalSubmissions,
          cancelRequested, cancelObserved, leg1Fill, leg2Fill, residual,
          sourceTruth, unknownSeen, outcome

vars == << phase, planDurable, submissions, terminalSubmissions,
           cancelRequested, cancelObserved, leg1Fill, leg2Fill, residual,
           sourceTruth, unknownSeen, outcome >>

Init ==
  /\ phase = "RAW" /\ ~planDurable /\ submissions = 0
  /\ terminalSubmissions = 0 /\ ~cancelRequested /\ ~cancelObserved
  /\ leg1Fill = 0 /\ leg2Fill = 0 /\ residual = 0
  /\ sourceTruth = "KNOWN" /\ ~unknownSeen /\ outcome = "PENDING"

PersistPlan ==
  /\ phase = "RAW" /\ phase' = "PLAN_DURABLE" /\ planDurable' = TRUE
  /\ UNCHANGED << submissions, terminalSubmissions, cancelRequested,
                   cancelObserved, leg1Fill, leg2Fill, residual, sourceTruth,
                   unknownSeen, outcome >>

SubmitFirstLeg ==
  /\ phase = "PLAN_DURABLE" /\ planDurable
  /\ phase' = "LEG1_SUBMITTED" /\ submissions' = 1
  /\ UNCHANGED << planDurable, terminalSubmissions, cancelRequested,
                   cancelObserved, leg1Fill, leg2Fill, residual, sourceTruth,
                   unknownSeen, outcome >>

ObserveFirstFill ==
  /\ phase = "LEG1_SUBMITTED" /\ phase' = "LEG1_FILLED"
  /\ leg1Fill' = 1 /\ residual' = 1
  /\ UNCHANGED << planDurable, submissions, terminalSubmissions,
                   cancelRequested, cancelObserved, leg2Fill, sourceTruth,
                   unknownSeen, outcome >>

SubmitSecondLeg ==
  /\ phase = "LEG1_FILLED" /\ phase' = "LEG2_SUBMITTED"
  /\ submissions' = 2
  /\ UNCHANGED << planDurable, terminalSubmissions, cancelRequested,
                   cancelObserved, leg1Fill, leg2Fill, residual, sourceTruth,
                   unknownSeen, outcome >>

ObserveSecondFill ==
  /\ phase = "LEG2_SUBMITTED" /\ phase' = "TERMINAL"
  /\ leg2Fill' = 1 /\ residual' = 0 /\ outcome' = "PASS"
  /\ terminalSubmissions' = submissions
  /\ UNCHANGED << planDurable, submissions, cancelRequested, cancelObserved,
                   leg1Fill, sourceTruth, unknownSeen >>

RequestCancel ==
  /\ phase = "LEG1_SUBMITTED" /\ phase' = "CANCEL_REQUESTED"
  /\ cancelRequested' = TRUE
  /\ UNCHANGED << planDurable, submissions, terminalSubmissions,
                   cancelObserved, leg1Fill, leg2Fill, residual, sourceTruth,
                   unknownSeen, outcome >>

ObserveCancellation ==
  /\ phase = "CANCEL_REQUESTED" /\ leg1Fill = 0
  /\ phase' = "TERMINAL" /\ cancelObserved' = TRUE
  /\ outcome' = "CANCELLED" /\ terminalSubmissions' = submissions
  /\ UNCHANGED << planDurable, submissions, cancelRequested, leg1Fill,
                   leg2Fill, residual, sourceTruth, unknownSeen >>

ObserveLateFirstFill ==
  /\ phase = "CANCEL_REQUESTED" /\ ~cancelObserved
  /\ phase' = "RECONCILING" /\ leg1Fill' = 1 /\ residual' = 1
  /\ outcome' = "RECOVERING"
  /\ UNCHANGED << planDurable, submissions, terminalSubmissions,
                   cancelRequested, cancelObserved, leg2Fill, sourceTruth,
                   unknownSeen >>

LoseFirstLegResponse ==
  /\ phase = "LEG1_SUBMITTED" /\ phase' = "RECONCILING"
  /\ sourceTruth' = "UNKNOWN" /\ unknownSeen' = TRUE
  /\ leg1Fill' = 1 /\ residual' = 1 /\ outcome' = "UNKNOWN"
  /\ UNCHANGED << planDurable, submissions, terminalSubmissions,
                   cancelRequested, cancelObserved, leg2Fill >>

RecoverResidual ==
  /\ phase = "RECONCILING" /\ residual = 1
  /\ phase' = "TERMINAL" /\ submissions' = 2
  /\ terminalSubmissions' = 2 /\ leg2Fill' = 1 /\ residual' = 0
  /\ outcome' = "RECOVERED"
  /\ UNCHANGED << planDurable, cancelRequested, cancelObserved, leg1Fill,
                   sourceTruth, unknownSeen >>

ProveFirstLegAbsent ==
  /\ phase = "RECONCILING" /\ sourceTruth = "UNKNOWN"
  /\ phase' = "TERMINAL" /\ terminalSubmissions' = submissions
  /\ sourceTruth' = "KNOWN" /\ leg1Fill' = 0 /\ residual' = 0
  /\ outcome' = "NOT_APPLIED"
  /\ UNCHANGED << planDurable, submissions, cancelRequested, cancelObserved,
                   leg2Fill, unknownSeen >>

Next == PersistPlan \/ SubmitFirstLeg \/ ObserveFirstFill \/ SubmitSecondLeg
        \/ ObserveSecondFill \/ RequestCancel \/ ObserveCancellation
        \/ ObserveLateFirstFill \/ LoseFirstLegResponse \/ RecoverResidual
        \/ ProveFirstLegAbsent

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
  /\ phase \in {"RAW", "PLAN_DURABLE", "LEG1_SUBMITTED", "LEG1_FILLED",
                 "LEG2_SUBMITTED", "CANCEL_REQUESTED", "RECONCILING",
                 "TERMINAL"}
  /\ planDurable \in BOOLEAN /\ cancelRequested \in BOOLEAN
  /\ cancelObserved \in BOOLEAN /\ unknownSeen \in BOOLEAN
  /\ submissions \in 0..2 /\ terminalSubmissions \in 0..2
  /\ leg1Fill \in 0..1 /\ leg2Fill \in 0..1 /\ residual \in 0..1
  /\ sourceTruth \in {"KNOWN", "UNKNOWN"}
  /\ outcome \in {"PENDING", "UNKNOWN", "RECOVERING", "PASS",
                    "CANCELLED", "RECOVERED", "NOT_APPLIED"}

DurablePlanBeforeSubmit == submissions > 0 => planDurable

CancellationRequestIsNotFact ==
  cancelRequested /\ ~cancelObserved => outcome /= "CANCELLED"

ResidualConservation == residual = leg1Fill - leg2Fill

LateFillAccounted == leg1Fill = 1 => residual = 1 - leg2Fill

UnknownNeverPass == unknownSeen => outcome /= "PASS"

NoSubmitAfterTerminal ==
  phase = "TERMINAL" => submissions = terminalSubmissions

LifecycleResolves ==
  phase \in {"PLAN_DURABLE", "LEG1_SUBMITTED", "LEG1_FILLED",
             "LEG2_SUBMITTED"} ~> phase = "TERMINAL"

CancellationOrLateFillResolves ==
  phase = "CANCEL_REQUESTED" ~> phase = "TERMINAL"

ResidualEventuallyZero == residual = 1 ~> residual = 0

=====================================================================
