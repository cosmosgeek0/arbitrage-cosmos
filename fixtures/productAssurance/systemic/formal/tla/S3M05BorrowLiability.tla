-------------------- MODULE S3M05BorrowLiability --------------------
EXTENDS Naturals

\* Finite envelope: principal two units, one interest unit, and one dispatch
\* for each borrow, short-open, short-close, and repay mutation.
VARIABLES phase, borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
          borrowSends, shortOpenSends, shortCloseSends, repaySends, principal,
          interest, shortExposure, externalLiability, localLiability, snapshot,
          unresolvedMutation, unresolvedReceipt, dependentClaim, outcome,
          generation, restoreTarget

vars == << phase, borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
           borrowSends, shortOpenSends, shortCloseSends, repaySends, principal,
           interest, shortExposure, externalLiability, localLiability, snapshot,
           unresolvedMutation, unresolvedReceipt, dependentClaim, outcome,
           generation, restoreTarget >>

Init ==
  /\ phase = "EMPTY" /\ ~borrowIntent /\ ~shortOpenIntent
  /\ ~shortCloseIntent /\ ~repayIntent
  /\ borrowSends = 0 /\ shortOpenSends = 0 /\ shortCloseSends = 0
  /\ repaySends = 0 /\ principal = 0 /\ interest = 0
  /\ shortExposure = 0 /\ externalLiability = "ZERO"
  /\ localLiability = "NONE" /\ snapshot = "CURRENT"
  /\ unresolvedMutation = "NONE" /\ unresolvedReceipt = "NONE"
  /\ dependentClaim = "KNOWN" /\ outcome = "PENDING"
  /\ generation = 0 /\ restoreTarget = "NONE"

PersistBorrow ==
  /\ phase = "EMPTY" /\ phase' = "BORROW_INTENT" /\ borrowIntent' = TRUE
  /\ UNCHANGED << shortOpenIntent, shortCloseIntent, repayIntent, borrowSends,
                   shortOpenSends, shortCloseSends, repaySends, principal,
                   interest, shortExposure, externalLiability, localLiability,
                   snapshot, unresolvedMutation, unresolvedReceipt,
                   dependentClaim, outcome, generation, restoreTarget >>

DispatchBorrow ==
  /\ phase = "BORROW_INTENT" /\ phase' = "BORROW_IN_FLIGHT"
  /\ borrowSends' = 1 /\ snapshot' = "NONE"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   shortOpenSends, shortCloseSends, repaySends, principal,
                   interest, shortExposure, externalLiability, localLiability,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

BorrowAck ==
  /\ phase = "BORROW_IN_FLIGHT" /\ phase' = "BORROWED"
  /\ principal' = 2 /\ externalLiability' = "TWO"
  /\ localLiability' = "OPEN" /\ snapshot' = "CURRENT"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   interest, shortExposure, unresolvedMutation,
                   unresolvedReceipt, dependentClaim, outcome, generation,
                   restoreTarget >>

BorrowRejected ==
  /\ phase = "BORROW_IN_FLIGHT" /\ phase' = "TERMINAL"
  /\ externalLiability' = "ZERO" /\ localLiability' = "NONE"
  /\ snapshot' = "CURRENT" /\ outcome' = "REJECTED"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, unresolvedMutation,
                   unresolvedReceipt, dependentClaim, generation, restoreTarget >>

BorrowLost ==
  /\ phase = "BORROW_IN_FLIGHT" /\ phase' = "BORROW_AMBIGUOUS"
  /\ externalLiability' = "UNKNOWN" /\ localLiability' = "UNRESOLVED"
  /\ snapshot' = "NONE" /\ unresolvedMutation' = "BORROW"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, unresolvedReceipt,
                   dependentClaim, outcome, generation, restoreTarget >>

ReconcileBorrowFound ==
  /\ phase = "BORROW_AMBIGUOUS" /\ phase' = "BORROWED"
  /\ principal' = 2 /\ externalLiability' = "TWO"
  /\ localLiability' = "OPEN" /\ snapshot' = "CURRENT"
  /\ unresolvedMutation' = "NONE"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   interest, shortExposure, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

ReconcileBorrowAbsent ==
  /\ phase = "BORROW_AMBIGUOUS" /\ phase' = "TERMINAL"
  /\ externalLiability' = "ZERO" /\ localLiability' = "NONE"
  /\ snapshot' = "CURRENT" /\ unresolvedMutation' = "NONE"
  /\ outcome' = "REJECTED"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, unresolvedReceipt,
                   dependentClaim, generation, restoreTarget >>

ReconcileBorrowUnavailable ==
  /\ phase = "BORROW_AMBIGUOUS" /\ phase' = "PERSISTING_UNRESOLVED"
  /\ externalLiability' = "UNKNOWN" /\ localLiability' = "UNRESOLVED"
  /\ snapshot' = "NONE" /\ unresolvedMutation' = "BORROW"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, unresolvedReceipt,
                   dependentClaim, outcome, generation, restoreTarget >>

PersistShortOpen ==
  /\ phase = "BORROWED" /\ phase' = "SHORT_OPEN_INTENT"
  /\ shortOpenIntent' = TRUE
  /\ UNCHANGED << borrowIntent, shortCloseIntent, repayIntent, borrowSends,
                   shortOpenSends, shortCloseSends, repaySends, principal,
                   interest, shortExposure, externalLiability, localLiability,
                   snapshot, unresolvedMutation, unresolvedReceipt,
                   dependentClaim, outcome, generation, restoreTarget >>

OpenShort ==
  /\ phase = "SHORT_OPEN_INTENT" /\ phase' = "SHORT_OPEN"
  /\ shortOpenSends' = 1 /\ shortExposure' = 2
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortCloseSends, repaySends, principal, interest,
                   externalLiability, localLiability, snapshot,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

Accrue ==
  /\ phase = "SHORT_OPEN" /\ phase' = "INTEREST"
  /\ interest' = 1 /\ externalLiability' = "THREE"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, shortExposure, localLiability, snapshot,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

Overflow ==
  /\ phase = "INTEREST" /\ phase' = "PERSISTING_UNRESOLVED"
  /\ externalLiability' = "UNKNOWN" /\ localLiability' = "UNRESOLVED"
  /\ snapshot' = "NONE" /\ unresolvedMutation' = "LIABILITY"
  /\ dependentClaim' = "UNKNOWN"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, unresolvedReceipt,
                   outcome, generation, restoreTarget >>

PersistShortClose ==
  /\ phase \in {"SHORT_OPEN", "INTEREST"} /\ phase' = "SHORT_CLOSE_INTENT"
  /\ shortCloseIntent' = TRUE
  /\ UNCHANGED << borrowIntent, shortOpenIntent, repayIntent, borrowSends,
                   shortOpenSends, shortCloseSends, repaySends, principal,
                   interest, shortExposure, externalLiability, localLiability,
                   snapshot, unresolvedMutation, unresolvedReceipt,
                   dependentClaim, outcome, generation, restoreTarget >>

CloseShort ==
  /\ phase = "SHORT_CLOSE_INTENT" /\ phase' = "SHORT_CLOSED"
  /\ shortCloseSends' = 1 /\ shortExposure' = 0
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, repaySends, principal, interest,
                   externalLiability, localLiability, snapshot,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

PersistRepay ==
  /\ phase = "SHORT_CLOSED" /\ phase' = "REPAY_INTENT"
  /\ repayIntent' = TRUE /\ localLiability' = "REPAY_PENDING"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, borrowSends,
                   shortOpenSends, shortCloseSends, repaySends, principal,
                   interest, shortExposure, externalLiability, snapshot,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

DispatchRepay ==
  /\ phase = "REPAY_INTENT" /\ phase' = "REPAY_IN_FLIGHT"
  /\ repaySends' = 1 /\ snapshot' = "NONE"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, principal,
                   interest, shortExposure, externalLiability, localLiability,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

RepayOutcome ==
  /\ phase = "REPAY_IN_FLIGHT" /\ phase' = "RECONCILING"
  /\ externalLiability' \in {"ZERO", "ONE", "UNKNOWN"}
  /\ unresolvedMutation' = "REPAY"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, localLiability, snapshot,
                   unresolvedReceipt, dependentClaim, outcome, generation,
                   restoreTarget >>

ReconcileZero ==
  /\ phase = "RECONCILING" /\ externalLiability = "ZERO"
  /\ phase' = "TERMINAL" /\ localLiability' = "CLOSED"
  /\ snapshot' = "CURRENT" /\ unresolvedMutation' = "NONE"
  /\ outcome' = "SUCCESS"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, externalLiability,
                   unresolvedReceipt, dependentClaim, generation, restoreTarget >>

ReconcileRemaining ==
  /\ phase = "RECONCILING" /\ externalLiability = "ONE"
  /\ phase' = "PERSISTING_UNRESOLVED"
  /\ localLiability' = "UNRESOLVED" /\ snapshot' = "CURRENT"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, externalLiability,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

ReconcileUnavailable ==
  /\ phase = "RECONCILING" /\ externalLiability = "UNKNOWN"
  /\ phase' = "PERSISTING_UNRESOLVED"
  /\ localLiability' = "UNRESOLVED" /\ snapshot' = "NONE"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, externalLiability,
                   unresolvedMutation, unresolvedReceipt, dependentClaim,
                   outcome, generation, restoreTarget >>

\* Terminal unresolved liability is forbidden until this explicit durable
\* persistence step yields a durable receipt.
PersistUnresolvedLiability ==
  /\ phase = "PERSISTING_UNRESOLVED" /\ phase' = "UNRESOLVED_DURABLE"
  /\ unresolvedReceipt' = "DURABLE"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, externalLiability,
                   localLiability, snapshot, unresolvedMutation, dependentClaim,
                   outcome, generation, restoreTarget >>

TerminalUnresolved ==
  /\ phase = "UNRESOLVED_DURABLE" /\ unresolvedReceipt = "DURABLE"
  /\ phase' = "TERMINAL" /\ outcome' = "UNRESOLVED"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, externalLiability,
                   localLiability, snapshot, unresolvedMutation,
                   unresolvedReceipt, dependentClaim, generation, restoreTarget >>

Crash ==
  /\ phase \in {"BORROW_IN_FLIGHT", "REPAY_IN_FLIGHT"} /\ generation = 0
  /\ phase' = "RESTORING" /\ generation' = 1
  /\ restoreTarget' = IF phase = "BORROW_IN_FLIGHT" THEN "BORROW_AMBIGUOUS" ELSE "RECONCILING"
  /\ externalLiability' = "UNKNOWN"
  /\ unresolvedMutation' = IF phase = "BORROW_IN_FLIGHT" THEN "BORROW" ELSE "REPAY"
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, localLiability, snapshot,
                   unresolvedReceipt, dependentClaim, outcome >>

Restore ==
  /\ phase = "RESTORING" /\ phase' = restoreTarget
  /\ UNCHANGED << borrowIntent, shortOpenIntent, shortCloseIntent, repayIntent,
                   borrowSends, shortOpenSends, shortCloseSends, repaySends,
                   principal, interest, shortExposure, externalLiability,
                   localLiability, snapshot, unresolvedMutation,
                   unresolvedReceipt, dependentClaim, outcome, generation,
                   restoreTarget >>

Next == PersistBorrow \/ DispatchBorrow \/ BorrowAck \/ BorrowRejected \/ BorrowLost
        \/ ReconcileBorrowFound \/ ReconcileBorrowAbsent
        \/ ReconcileBorrowUnavailable \/ PersistShortOpen \/ OpenShort \/ Accrue
        \/ Overflow \/ PersistShortClose \/ CloseShort \/ PersistRepay
        \/ DispatchRepay \/ RepayOutcome \/ ReconcileZero \/ ReconcileRemaining
        \/ ReconcileUnavailable \/ PersistUnresolvedLiability
        \/ TerminalUnresolved \/ Crash \/ Restore
Spec == Init /\ [][Next]_vars /\ WF_vars(Next) /\ WF_vars(Restore)

TypeOK ==
  /\ phase \in {"EMPTY", "BORROW_INTENT", "BORROW_IN_FLIGHT", "BORROW_AMBIGUOUS",
                  "BORROWED", "SHORT_OPEN_INTENT", "SHORT_OPEN", "INTEREST",
                  "SHORT_CLOSE_INTENT", "SHORT_CLOSED", "REPAY_INTENT",
                  "REPAY_IN_FLIGHT", "RECONCILING", "PERSISTING_UNRESOLVED",
                  "UNRESOLVED_DURABLE", "RESTORING", "TERMINAL"}
  /\ borrowIntent \in BOOLEAN /\ shortOpenIntent \in BOOLEAN
  /\ shortCloseIntent \in BOOLEAN /\ repayIntent \in BOOLEAN
  /\ borrowSends \in 0..1 /\ shortOpenSends \in 0..1
  /\ shortCloseSends \in 0..1 /\ repaySends \in 0..1
  /\ principal \in 0..2 /\ interest \in 0..1 /\ shortExposure \in 0..2
  /\ externalLiability \in {"ZERO", "ONE", "TWO", "THREE", "UNKNOWN"}
  /\ localLiability \in {"NONE", "OPEN", "REPAY_PENDING", "UNRESOLVED", "CLOSED"}
  /\ snapshot \in {"NONE", "CURRENT"}
  /\ unresolvedMutation \in {"NONE", "BORROW", "REPAY", "LIABILITY"}
  /\ unresolvedReceipt \in {"NONE", "DURABLE"}
  /\ dependentClaim \in {"KNOWN", "UNKNOWN"}
  /\ outcome \in {"PENDING", "SUCCESS", "REJECTED", "UNRESOLVED"}
  /\ generation \in 0..1
  /\ restoreTarget \in {"NONE", "BORROW_AMBIGUOUS", "RECONCILING"}

DurableMutationIntent ==
  /\ (borrowSends = 0 \/ borrowIntent)
  /\ (shortOpenSends = 0 \/ shortOpenIntent)
  /\ (shortCloseSends = 0 \/ shortCloseIntent)
  /\ (repaySends = 0 \/ repayIntent)
NoBlindResend == borrowSends <= 1 /\ shortOpenSends <= 1
  /\ shortCloseSends <= 1 /\ repaySends <= 1
AuthoritativeClose == outcome /= "SUCCESS"
  \/ (snapshot = "CURRENT" /\ externalLiability = "ZERO" /\ shortExposure = 0)
LiabilityExplicit ==
  /\ (localLiability /= "CLOSED"
      \/ (snapshot = "CURRENT" /\ externalLiability = "ZERO"))
  /\ (phase /= "TERMINAL" \/ externalLiability = "ZERO"
      \/ (localLiability = "UNRESOLVED" /\ outcome = "UNRESOLVED"
          /\ unresolvedReceipt = "DURABLE"
          /\ ((externalLiability = "UNKNOWN" /\ snapshot = "NONE")
              \/ (externalLiability \in {"ONE", "TWO", "THREE"}
                  /\ snapshot = "CURRENT"))))
\* M05 deliberately makes no S3-SAF-10 approval-binding claim; M06 owns it.
MutationResolves == [](unresolvedMutation /= "NONE"
  => <>(unresolvedMutation = "NONE" \/ outcome = "UNRESOLVED"))
RepayResolves == [](repaySends = 1 => <>(outcome \in {"SUCCESS", "UNRESOLVED"}))
\* Whole-checkpoint restart equivalence is abstracted by the sole durable
\* intent store: borrow intent always survives, and repay intent survives on
\* the repay-recovery branch. No second restoration authority is modeled.
RestartReconstructsOrBlocks == [](phase = "RESTORING"
  => <> (phase /= "RESTORING" /\ borrowIntent
         /\ (restoreTarget /= "RECONCILING" \/ repayIntent)))

=============================================================================
