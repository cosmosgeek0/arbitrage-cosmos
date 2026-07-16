-------------------- MODULE S3M10ReverseBasisLiability --------------------
EXTENDS Naturals

\* SYNTHETIC_ONLY. SUPPORTING_EVIDENCE_ONLY.
\* runtime_claim_closure: NOT_PERMITTED.
\* Frozen donor: df6b472993ca9659ce09cf5f72004981c6835f0d.
\* TLA tooling is not configured; this is a source-only abstraction.
\* Finite envelope: one unit borrow, one reverse-basis order, one close,
\* one repay-to-zero, and one UNKNOWN borrow-response reconciliation.
VARIABLES phase, sourceTruth, unknownSeen, durableBorrowIntent, borrowUnits,
          repayUnits, liability, orderOpen, orderSubmissions, outcome

vars == << phase, sourceTruth, unknownSeen, durableBorrowIntent, borrowUnits,
           repayUnits, liability, orderOpen, orderSubmissions, outcome >>

Init ==
  /\ phase = "RAW" /\ sourceTruth = "KNOWN" /\ ~unknownSeen
  /\ ~durableBorrowIntent /\ borrowUnits = 0 /\ repayUnits = 0
  /\ liability = 0 /\ ~orderOpen /\ orderSubmissions = 0
  /\ outcome = "PENDING"

PersistBorrowIntent ==
  /\ phase = "RAW" /\ phase' = "BORROW_INTENT"
  /\ durableBorrowIntent' = TRUE
  /\ UNCHANGED << sourceTruth, unknownSeen, borrowUnits, repayUnits,
                   liability, orderOpen, orderSubmissions, outcome >>

ConfirmBorrow ==
  /\ phase = "BORROW_INTENT" /\ durableBorrowIntent
  /\ phase' = "BORROWED" /\ borrowUnits' = 1 /\ liability' = 1
  /\ outcome' = "BORROWED"
  /\ UNCHANGED << sourceTruth, unknownSeen, durableBorrowIntent, repayUnits,
                   orderOpen, orderSubmissions >>

LoseBorrowResponse ==
  /\ phase = "BORROW_INTENT" /\ durableBorrowIntent
  /\ phase' = "UNKNOWN_RECOVERY" /\ sourceTruth' = "UNKNOWN"
  /\ unknownSeen' = TRUE /\ borrowUnits' = 1 /\ liability' = 1
  /\ outcome' = "UNKNOWN"
  /\ UNCHANGED << durableBorrowIntent, repayUnits, orderOpen,
                   orderSubmissions >>

ProveBorrowApplied ==
  /\ phase = "UNKNOWN_RECOVERY" /\ phase' = "BORROWED"
  /\ sourceTruth' = "KNOWN" /\ outcome' = "BORROWED"
  /\ UNCHANGED << unknownSeen, durableBorrowIntent, borrowUnits, repayUnits,
                   liability, orderOpen, orderSubmissions >>

ProveBorrowAbsent ==
  /\ phase = "UNKNOWN_RECOVERY" /\ phase' = "CLOSED"
  /\ sourceTruth' = "KNOWN" /\ borrowUnits' = 0 /\ liability' = 0
  /\ outcome' = "NOT_APPLIED"
  /\ UNCHANGED << unknownSeen, durableBorrowIntent, repayUnits, orderOpen,
                   orderSubmissions >>

SubmitReverseOrder ==
  /\ phase = "BORROWED" /\ sourceTruth = "KNOWN"
  /\ liability = 1 /\ orderSubmissions = 0
  /\ phase' = "ORDERED" /\ orderOpen' = TRUE
  /\ orderSubmissions' = 1 /\ outcome' = "ORDER_OPEN"
  /\ UNCHANGED << sourceTruth, unknownSeen, durableBorrowIntent, borrowUnits,
                   repayUnits, liability >>

BeginClose ==
  /\ phase = "ORDERED" /\ orderOpen
  /\ phase' = "CLOSING" /\ orderOpen' = FALSE /\ outcome' = "CLOSING"
  /\ UNCHANGED << sourceTruth, unknownSeen, durableBorrowIntent, borrowUnits,
                   repayUnits, liability, orderSubmissions >>

RepayToZero ==
  /\ phase = "CLOSING" /\ liability = 1
  /\ phase' = "REPAID" /\ repayUnits' = 1 /\ liability' = 0
  /\ outcome' = "REPAID"
  /\ UNCHANGED << sourceTruth, unknownSeen, durableBorrowIntent, borrowUnits,
                   orderOpen, orderSubmissions >>

SealClosed ==
  /\ phase = "REPAID" /\ liability = 0 /\ phase' = "CLOSED"
  /\ outcome' = IF unknownSeen THEN "CLOSED_WITH_RECONCILED_HISTORY"
                 ELSE "PASS"
  /\ UNCHANGED << sourceTruth, unknownSeen, durableBorrowIntent, borrowUnits,
                   repayUnits, liability, orderOpen, orderSubmissions >>

Next == PersistBorrowIntent \/ ConfirmBorrow \/ LoseBorrowResponse
        \/ ProveBorrowApplied \/ ProveBorrowAbsent \/ SubmitReverseOrder
        \/ BeginClose \/ RepayToZero \/ SealClosed

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
  /\ phase \in {"RAW", "BORROW_INTENT", "BORROWED", "UNKNOWN_RECOVERY",
                 "ORDERED", "CLOSING", "REPAID", "CLOSED"}
  /\ sourceTruth \in {"KNOWN", "UNKNOWN"}
  /\ unknownSeen \in BOOLEAN /\ durableBorrowIntent \in BOOLEAN
  /\ borrowUnits \in 0..1 /\ repayUnits \in 0..1 /\ liability \in 0..1
  /\ orderOpen \in BOOLEAN /\ orderSubmissions \in 0..1
  /\ outcome \in {"PENDING", "UNKNOWN", "BORROWED", "NOT_APPLIED",
                    "ORDER_OPEN", "CLOSING", "REPAID", "PASS",
                    "CLOSED_WITH_RECONCILED_HISTORY"}

DurableIntentBeforeBorrow == borrowUnits > 0 => durableBorrowIntent

ExactLiabilityConservation == liability = borrowUnits - repayUnits

UnknownNeverPass == unknownSeen => outcome /= "PASS"

NoOrderAfterRepayOrClosure ==
  phase \in {"REPAID", "CLOSED"} => ~orderOpen

AtMostOneOrder == orderSubmissions <= 1

BorrowAmbiguityResolves ==
  phase = "UNKNOWN_RECOVERY" ~> phase \in {"BORROWED", "CLOSED"}

LiabilityEventuallyRepaid == phase = "CLOSING" ~> liability = 0

LifecycleEventuallyCloses ==
  phase \in {"ORDERED", "CLOSING", "REPAID"} ~> phase = "CLOSED"

=====================================================================
