-------------------- MODULE S3M03ExecutionFencing --------------------
EXTENDS Naturals, FiniteSets

\* Finite envelope: two processes, epochs 1 and 2, one overlap attempt,
\* one lost owner, and one stale transition/fact callback.
VARIABLES phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
          p1Authorized, lostOwner, overlapRejectionTested, callbackKind,
          callbackEpoch, transitionTested, factTested, factReceiptProven,
          durableFact, oldResurrected, commitEvidence, staleCommitRejected

vars == << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
           p1Authorized, lostOwner, overlapRejectionTested, callbackKind,
           callbackEpoch, transitionTested, factTested, factReceiptProven,
           durableFact, oldResurrected, commitEvidence, staleCommitRejected >>

CommitEvidenceType ==
  [commitEpoch: 1..2, authorityEpoch: 1..2, actor: {"P0", "P1"}]

Init ==
  /\ phase = "EMPTY" /\ tick = 0 /\ epoch = 0 /\ owner = "NONE"
  /\ authorizedEpochs = {} /\ ~p0Authorized /\ ~p1Authorized /\ ~lostOwner
  /\ ~overlapRejectionTested /\ callbackKind = "NONE" /\ callbackEpoch = 0
  /\ ~transitionTested /\ ~factTested /\ ~factReceiptProven
  /\ durableFact = "NONE" /\ ~oldResurrected
  /\ commitEvidence = {} /\ ~staleCommitRejected

AcquireP0 ==
  /\ phase = "EMPTY" /\ phase' = "P0_ACTIVE" /\ epoch' = 1
  /\ owner' = "P0" /\ authorizedEpochs' = {1} /\ p0Authorized' = TRUE
  /\ UNCHANGED << tick, p1Authorized, lostOwner, overlapRejectionTested,
                   callbackKind, callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   commitEvidence, staleCommitRejected >>

CommitP0 ==
  LET evidence == [commitEpoch |-> 1, authorityEpoch |-> epoch, actor |-> "P0"] IN
  /\ phase = "P0_ACTIVE" /\ owner = "P0" /\ p0Authorized
  /\ authorizedEpochs = {epoch} /\ evidence \notin commitEvidence
  /\ commitEvidence' = commitEvidence \cup {evidence}
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested, callbackKind,
                   callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   staleCommitRejected >>

StartOverlap ==
  /\ phase = "P0_ACTIVE" /\ phase' = "OVERLAP" /\ tick' = 1
  /\ UNCHANGED << epoch, owner, authorizedEpochs, p0Authorized, p1Authorized,
                   lostOwner, overlapRejectionTested, callbackKind, callbackEpoch,
                   transitionTested, factTested, factReceiptProven, durableFact,
                   oldResurrected, commitEvidence, staleCommitRejected >>

RejectP1WhileP0Current ==
  /\ phase = "OVERLAP" /\ p0Authorized /\ phase' = "OVERLAP_REJECTED"
  /\ overlapRejectionTested' = TRUE
  /\ UNCHANGED << tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, callbackKind, callbackEpoch,
                   transitionTested, factTested, factReceiptProven, durableFact,
                   oldResurrected, commitEvidence, staleCommitRejected >>

LoseP0 ==
  /\ phase \in {"OVERLAP", "OVERLAP_REJECTED"}
  /\ phase' = "P0_LOST" /\ lostOwner' = TRUE
  /\ UNCHANGED << tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, overlapRejectionTested, callbackKind,
                   callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   commitEvidence, staleCommitRejected >>

ExpireP0 ==
  /\ phase \in {"OVERLAP", "OVERLAP_REJECTED", "P0_LOST"}
  /\ phase' = "EXPIRED" /\ tick' = 2 /\ owner' = "NONE"
  /\ authorizedEpochs' = {} /\ p0Authorized' = FALSE
  /\ UNCHANGED << epoch, p1Authorized, lostOwner, overlapRejectionTested,
                   callbackKind, callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   commitEvidence, staleCommitRejected >>

AcquireP1 ==
  /\ phase = "EXPIRED" /\ phase' = "P1_ACTIVE" /\ epoch' = 2
  /\ owner' = "P1" /\ authorizedEpochs' = {2} /\ p1Authorized' = TRUE
  /\ UNCHANGED << tick, p0Authorized, lostOwner, overlapRejectionTested,
                   callbackKind, callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   commitEvidence, staleCommitRejected >>

CommitP1 ==
  LET evidence == [commitEpoch |-> 2, authorityEpoch |-> epoch, actor |-> "P1"] IN
  /\ phase = "P1_ACTIVE" /\ owner = "P1" /\ p1Authorized
  /\ authorizedEpochs = {epoch} /\ callbackKind = "NONE"
  /\ evidence \notin commitEvidence
  /\ commitEvidence' = commitEvidence \cup {evidence}
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested, callbackKind,
                   callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   staleCommitRejected >>

ResurrectOld ==
  /\ phase = "P1_ACTIVE" /\ callbackKind = "NONE" /\ ~oldResurrected
  /\ oldResurrected' = TRUE /\ p0Authorized' = FALSE
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p1Authorized,
                   lostOwner, overlapRejectionTested, callbackKind, callbackEpoch,
                   transitionTested, factTested, factReceiptProven, durableFact,
                   commitEvidence, staleCommitRejected >>

QueueStaleTransition ==
  /\ phase = "P1_ACTIVE" /\ callbackKind = "NONE" /\ ~transitionTested
  /\ callbackKind' = "NEW_TRANSITION" /\ callbackEpoch' = 1
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested,
                   transitionTested, factTested, factReceiptProven, durableFact,
                   oldResurrected, commitEvidence, staleCommitRejected >>

RejectStaleTransition ==
  /\ callbackKind = "NEW_TRANSITION" /\ callbackEpoch /= epoch
  /\ callbackKind' = "NONE" /\ callbackEpoch' = 0 /\ transitionTested' = TRUE
  /\ staleCommitRejected' = TRUE
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected, commitEvidence >>

QueueFact(proven) ==
  /\ phase = "P1_ACTIVE" /\ callbackKind = "NONE" /\ ~factTested
  /\ callbackKind' = IF proven THEN "DURABLE_FACT" ELSE "UNPROVED_FACT"
  /\ callbackEpoch' = 1 /\ factReceiptProven' = proven
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested,
                   transitionTested, factTested, durableFact, oldResurrected,
                   commitEvidence, staleCommitRejected >>

DeliverFact ==
  /\ callbackKind \in {"DURABLE_FACT", "UNPROVED_FACT"}
  /\ callbackKind' = "NONE" /\ callbackEpoch' = 0 /\ factTested' = TRUE
  /\ durableFact' = IF factReceiptProven THEN "RECEIVED" ELSE "UNKNOWN"
  /\ UNCHANGED << phase, tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested,
                   transitionTested, factReceiptProven, oldResurrected,
                   commitEvidence, staleCommitRejected >>

Finish ==
  /\ phase = "P1_ACTIVE" /\ callbackKind = "NONE" /\ phase' = "TERMINAL"
  /\ UNCHANGED << tick, epoch, owner, authorizedEpochs, p0Authorized,
                   p1Authorized, lostOwner, overlapRejectionTested, callbackKind,
                   callbackEpoch, transitionTested, factTested,
                   factReceiptProven, durableFact, oldResurrected,
                   commitEvidence, staleCommitRejected >>

Next == AcquireP0 \/ CommitP0 \/ StartOverlap \/ RejectP1WhileP0Current
        \/ LoseP0 \/ ExpireP0 \/ AcquireP1 \/ CommitP1 \/ ResurrectOld
        \/ QueueStaleTransition \/ RejectStaleTransition \/ QueueFact(TRUE)
        \/ QueueFact(FALSE) \/ DeliverFact \/ Finish
Spec == Init /\ [][Next]_vars /\ WF_vars(Next) /\ WF_vars(ExpireP0)
        /\ WF_vars(RejectStaleTransition) /\ WF_vars(DeliverFact)

TypeOK ==
  /\ phase \in {"EMPTY", "P0_ACTIVE", "OVERLAP", "OVERLAP_REJECTED",
                  "P0_LOST", "EXPIRED", "P1_ACTIVE", "TERMINAL"}
  /\ tick \in 0..2 /\ epoch \in 0..2 /\ owner \in {"NONE", "P0", "P1"}
  /\ authorizedEpochs \subseteq 0..2 /\ Cardinality(authorizedEpochs) <= 1
  /\ p0Authorized \in BOOLEAN /\ p1Authorized \in BOOLEAN
  /\ lostOwner \in BOOLEAN /\ overlapRejectionTested \in BOOLEAN
  /\ callbackKind \in {"NONE", "NEW_TRANSITION", "DURABLE_FACT", "UNPROVED_FACT"}
  /\ callbackEpoch \in 0..2 /\ transitionTested \in BOOLEAN /\ factTested \in BOOLEAN
  /\ factReceiptProven \in BOOLEAN /\ durableFact \in {"NONE", "RECEIVED", "UNKNOWN"}
  /\ oldResurrected \in BOOLEAN /\ commitEvidence \subseteq CommitEvidenceType
  /\ staleCommitRejected \in BOOLEAN

SingleEpochAuthority == Cardinality(authorizedEpochs) <= 1
  /\ (authorizedEpochs = {} \/ authorizedEpochs = {epoch})
  /\ ~(p0Authorized /\ p1Authorized)
  /\ (~p0Authorized \/ (owner = "P0" /\ epoch = 1 /\ authorizedEpochs = {1}))
  /\ (~p1Authorized \/ (owner = "P1" /\ epoch = 2 /\ authorizedEpochs = {2}))
\* Reachable CommitP0/CommitP1 states make this non-vacuous; a stale callback
\* would record mismatched commit and authority epochs instead of satisfying it.
NoStaleCommit == \A evidence \in commitEvidence:
  evidence.commitEpoch = evidence.authorityEpoch
DurableFactLaw == ~(factTested /\ factReceiptProven) \/ durableFact = "RECEIVED"
UnprovedFactUnknown == ~(factTested /\ ~factReceiptProven) \/ durableFact = "UNKNOWN"
LostOwnerLosesAuthority == [](lostOwner /\ p0Authorized => <> ~p0Authorized)
CallbacksResolve == [](callbackKind /= "NONE" => <> (callbackKind = "NONE"))

=============================================================================
