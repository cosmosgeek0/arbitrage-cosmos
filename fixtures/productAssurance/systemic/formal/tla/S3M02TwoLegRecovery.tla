-------------------- MODULE S3M02TwoLegRecovery --------------------
EXTENDS Naturals

\* Finite envelope: two units per leg, one cancel/fill race, one crash.
\* Restart equivalence is an abstraction: the sole durable store restores the
\* complete modeled plan/checkpoint, and no second restore authority exists.
VARIABLES phase, planDurable, submitted, firstFilled, everFirstFilled,
          externalFirstFilled, authoritativeFirstFilled, authoritativeKnown,
          secondFilled, cancelRequested, cancelFinal, intake, accounting,
          postcondition, liabilityExplicit, unresolvedReceipt, generation,
          restoreTarget, restoredEquivalent

vars == << phase, planDurable, submitted, firstFilled, everFirstFilled,
           externalFirstFilled, authoritativeFirstFilled, authoritativeKnown,
           secondFilled, cancelRequested, cancelFinal, intake, accounting,
           postcondition, liabilityExplicit, unresolvedReceipt, generation,
           restoreTarget, restoredEquivalent >>

Init ==
  /\ phase = "EMPTY" /\ ~planDurable /\ ~submitted
  /\ firstFilled = 0 /\ everFirstFilled = 0 /\ externalFirstFilled = 0
  /\ authoritativeFirstFilled = 0 /\ ~authoritativeKnown /\ secondFilled = 0
  /\ ~cancelRequested /\ cancelFinal = "NONE" /\ intake = "OPEN"
  /\ accounting = "PENDING" /\ ~postcondition /\ ~liabilityExplicit
  /\ unresolvedReceipt = "NONE" /\ generation = 0
  /\ restoreTarget = "NONE" /\ restoredEquivalent

PersistPlan ==
  /\ phase = "EMPTY" /\ phase' = "PLAN_DURABLE" /\ planDurable' = TRUE
  /\ UNCHANGED << submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, accounting, postcondition,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

SubmitFirst ==
  /\ phase = "PLAN_DURABLE" /\ phase' = "IN_FLIGHT" /\ submitted' = TRUE
  /\ UNCHANGED << planDurable, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, accounting, postcondition,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

ObserveFirstFill(amount) ==
  /\ phase = "IN_FLIGHT" /\ amount \in 1..2
  /\ phase' = IF amount = 1 THEN "PARTIAL" ELSE "FILLED"
  /\ firstFilled' = amount /\ everFirstFilled' = amount
  /\ externalFirstFilled' = amount /\ authoritativeFirstFilled' = amount
  /\ authoritativeKnown' = TRUE /\ intake' = "HALTED"
  /\ UNCHANGED << planDurable, submitted, secondFilled, cancelRequested,
                   cancelFinal, accounting, postcondition, liabilityExplicit,
                   unresolvedReceipt, generation, restoreTarget,
                   restoredEquivalent >>

Ambiguous(actual) ==
  /\ phase = "IN_FLIGHT" /\ actual \in 0..2
  /\ phase' = "AMBIGUOUS" /\ externalFirstFilled' = actual
  /\ authoritativeKnown' = FALSE /\ intake' = "HALTED"
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   authoritativeFirstFilled, secondFilled, cancelRequested,
                   cancelFinal, accounting, postcondition, liabilityExplicit,
                   unresolvedReceipt, generation, restoreTarget,
                   restoredEquivalent >>

RequestCancel ==
  /\ phase = "PARTIAL" /\ phase' = "CANCEL_PENDING"
  /\ cancelRequested' = TRUE /\ authoritativeKnown' = FALSE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled, secondFilled,
                   cancelFinal, intake, accounting, postcondition,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

CancelWins ==
  /\ phase = "CANCEL_PENDING" /\ phase' = "RECOVERY"
  /\ cancelFinal' = "CANCELLED"
  /\ authoritativeFirstFilled' = externalFirstFilled
  /\ authoritativeKnown' = TRUE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, secondFilled, cancelRequested, intake,
                   accounting, postcondition, liabilityExplicit,
                   unresolvedReceipt, generation, restoreTarget,
                   restoredEquivalent >>

LateFillWins ==
  /\ phase = "CANCEL_PENDING" /\ phase' = "RECOVERY"
  /\ firstFilled' = 2 /\ everFirstFilled' = 2 /\ externalFirstFilled' = 2
  /\ authoritativeFirstFilled' = 2 /\ authoritativeKnown' = TRUE
  /\ cancelFinal' = "FILLED"
  /\ UNCHANGED << planDurable, submitted, secondFilled, cancelRequested,
                   intake, accounting, postcondition, liabilityExplicit,
                   unresolvedReceipt, generation, restoreTarget,
                   restoredEquivalent >>

CancelAckLost ==
  /\ phase = "CANCEL_PENDING" /\ phase' = "AMBIGUOUS"
  /\ authoritativeKnown' = FALSE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled, secondFilled,
                   cancelRequested, cancelFinal, intake, accounting,
                   postcondition, liabilityExplicit, unresolvedReceipt,
                   generation, restoreTarget, restoredEquivalent >>

StartRecovery ==
  /\ phase \in {"PARTIAL", "FILLED"} /\ authoritativeKnown
  /\ phase' = "RECOVERY"
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, accounting, postcondition,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

BeginLookup ==
  /\ phase = "AMBIGUOUS" /\ phase' = "FIRST_LEG_LOOKUP"
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, accounting, postcondition,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

LookupResolved ==
  /\ phase = "FIRST_LEG_LOOKUP" /\ phase' = "RECOVERY"
  /\ firstFilled' = externalFirstFilled
  /\ everFirstFilled' = IF externalFirstFilled > everFirstFilled
                         THEN externalFirstFilled ELSE everFirstFilled
  /\ authoritativeFirstFilled' = externalFirstFilled
  /\ authoritativeKnown' = TRUE
  /\ UNCHANGED << planDurable, submitted, externalFirstFilled, secondFilled,
                   cancelRequested, cancelFinal, intake, accounting,
                   postcondition, liabilityExplicit, unresolvedReceipt,
                   generation, restoreTarget, restoredEquivalent >>

BeginUnresolved ==
  /\ phase \in {"FIRST_LEG_LOOKUP", "RECOVERY", "CANCEL_RESTORED"}
  /\ phase' = "PERSISTING_UNRESOLVED"
  /\ accounting' = "PENDING" /\ postcondition' = FALSE
  /\ liabilityExplicit' = FALSE /\ unresolvedReceipt' = "NONE"
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, generation, restoreTarget,
                   restoredEquivalent >>

Crash ==
  /\ phase \in {"PARTIAL", "FILLED", "CANCEL_PENDING", "AMBIGUOUS"}
  /\ generation = 0 /\ phase' = "RESTORING" /\ generation' = 1
  /\ restoreTarget' = IF phase = "CANCEL_PENDING"
                        THEN "CANCEL_RESTORED" ELSE "FIRST_LEG_LOOKUP"
  /\ authoritativeKnown' = FALSE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled, secondFilled,
                   cancelRequested, cancelFinal, intake, accounting,
                   postcondition, liabilityExplicit, unresolvedReceipt,
                   restoredEquivalent >>

Restore ==
  /\ phase = "RESTORING" /\ phase' = restoreTarget
  /\ restoredEquivalent' = (planDurable /\ submitted)
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, accounting, postcondition,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget >>

CancelSettledAfterCrash ==
  /\ phase = "CANCEL_RESTORED" /\ phase' = "FIRST_LEG_LOOKUP"
  /\ cancelFinal' = "CANCELLED" /\ externalFirstFilled' = 1
  /\ authoritativeKnown' = FALSE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   authoritativeFirstFilled, secondFilled, cancelRequested,
                   intake, accounting, postcondition, liabilityExplicit,
                   unresolvedReceipt, generation, restoreTarget,
                   restoredEquivalent >>

LateFillAfterCrash ==
  /\ phase = "CANCEL_RESTORED" /\ phase' = "FIRST_LEG_LOOKUP"
  /\ cancelFinal' = "FILLED" /\ externalFirstFilled' = 2
  /\ everFirstFilled' = 2 /\ authoritativeKnown' = FALSE
  /\ UNCHANGED << planDurable, submitted, firstFilled,
                   authoritativeFirstFilled, secondFilled, cancelRequested,
                   intake, accounting, postcondition, liabilityExplicit,
                   unresolvedReceipt, generation, restoreTarget,
                   restoredEquivalent >>

Hedge ==
  /\ phase = "RECOVERY" /\ authoritativeKnown
  /\ authoritativeFirstFilled = externalFirstFilled
  /\ phase' = "TERMINAL" /\ secondFilled' = authoritativeFirstFilled
  /\ accounting' = "HEDGED" /\ postcondition' = TRUE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, cancelRequested, cancelFinal, intake,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

Close ==
  /\ phase = "RECOVERY" /\ authoritativeKnown
  /\ authoritativeFirstFilled = externalFirstFilled
  /\ phase' = "TERMINAL" /\ secondFilled' = authoritativeFirstFilled
  /\ accounting' = "CLOSED" /\ postcondition' = TRUE
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, cancelRequested, cancelFinal, intake,
                   liabilityExplicit, unresolvedReceipt, generation,
                   restoreTarget, restoredEquivalent >>

PersistUnresolved ==
  /\ phase = "PERSISTING_UNRESOLVED" /\ phase' = "TERMINAL"
  /\ accounting' = "UNRESOLVED" /\ liabilityExplicit' = TRUE
  /\ unresolvedReceipt' = "DURABLE"
  /\ UNCHANGED << planDurable, submitted, firstFilled, everFirstFilled,
                   externalFirstFilled, authoritativeFirstFilled,
                   authoritativeKnown, secondFilled, cancelRequested,
                   cancelFinal, intake, postcondition, generation,
                   restoreTarget, restoredEquivalent >>

RecoveryStep == Hedge \/ Close \/ BeginUnresolved \/ PersistUnresolved
Next == PersistPlan \/ SubmitFirst \/ (\E amount \in 1..2: ObserveFirstFill(amount))
        \/ (\E actual \in 0..2: Ambiguous(actual)) \/ RequestCancel
        \/ CancelWins \/ LateFillWins \/ CancelAckLost \/ StartRecovery
        \/ BeginLookup \/ LookupResolved \/ BeginUnresolved \/ Crash \/ Restore
        \/ CancelSettledAfterCrash \/ LateFillAfterCrash \/ Hedge \/ Close
        \/ PersistUnresolved
Spec == Init /\ [][Next]_vars /\ WF_vars(Next) /\ WF_vars(Restore)
        /\ WF_vars(RecoveryStep)

TypeOK ==
  /\ phase \in {"EMPTY", "PLAN_DURABLE", "IN_FLIGHT", "PARTIAL", "FILLED",
                  "AMBIGUOUS", "FIRST_LEG_LOOKUP", "CANCEL_PENDING",
                  "CANCEL_RESTORED", "RESTORING", "RECOVERY",
                  "PERSISTING_UNRESOLVED", "TERMINAL"}
  /\ planDurable \in BOOLEAN /\ submitted \in BOOLEAN
  /\ firstFilled \in 0..2 /\ everFirstFilled \in 0..2
  /\ externalFirstFilled \in 0..2 /\ authoritativeFirstFilled \in 0..2
  /\ authoritativeKnown \in BOOLEAN /\ secondFilled \in 0..2
  /\ cancelRequested \in BOOLEAN
  /\ cancelFinal \in {"NONE", "CANCELLED", "FILLED"}
  /\ intake \in {"OPEN", "HALTED"}
  /\ accounting \in {"PENDING", "HEDGED", "CLOSED", "UNRESOLVED"}
  /\ postcondition \in BOOLEAN /\ liabilityExplicit \in BOOLEAN
  /\ unresolvedReceipt \in {"NONE", "DURABLE"}
  /\ generation \in 0..1
  /\ restoreTarget \in {"NONE", "FIRST_LEG_LOOKUP", "CANCEL_RESTORED"}
  /\ restoredEquivalent \in BOOLEAN

DurablePlanBeforeSubmit == ~submitted \/ planDurable
AuthoritativeTerminal == ~(accounting \in {"HEDGED", "CLOSED"})
  \/ (postcondition /\ authoritativeKnown
      /\ authoritativeFirstFilled = externalFirstFilled
      /\ secondFilled >= authoritativeFirstFilled)
ExposureAccounted == phase /= "TERMINAL" \/ externalFirstFilled = 0
  \/ (postcondition /\ authoritativeKnown
      /\ authoritativeFirstFilled = externalFirstFilled
      /\ secondFilled >= externalFirstFilled)
  \/ (accounting = "UNRESOLVED" /\ liabilityExplicit
      /\ unresolvedReceipt = "DURABLE")
UnresolvedDurable == accounting /= "UNRESOLVED"
  \/ (liabilityExplicit /\ unresolvedReceipt = "DURABLE")
\* M02 models intake halt as part of recovery, but does not claim S3-SAF-08;
\* S3-SAF-10 approval binding is owned and checked by M06.
RecoveryTerminates == [](phase \in {"IN_FLIGHT", "CANCEL_PENDING",
  "CANCEL_RESTORED", "AMBIGUOUS", "FIRST_LEG_LOOKUP", "RECOVERY",
  "PERSISTING_UNRESOLVED"}
  => <> (phase = "TERMINAL"
         /\ accounting \in {"HEDGED", "CLOSED", "UNRESOLVED"}))
RestartReconstructsOrBlocks == [](phase = "RESTORING"
  => <> (phase /= "RESTORING" /\ restoredEquivalent))

=============================================================================
