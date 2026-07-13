-------------------- MODULE S3M01AmbiguousMutation --------------------
EXTENDS Naturals

\* Supporting model source only. TLC is not configured in this packet.
\* Bounds: one intent, one external mutation, at most one crash generation.
\* Restart equivalence is an abstraction: the sole durable store restores the
\* complete modeled checkpoint, and no second restore authority exists.

VARIABLES phase, intentDurable, sendCount, external, receipt,
          postcondition, outcome, generation

vars == << phase, intentDurable, sendCount, external, receipt,
           postcondition, outcome, generation >>

Init ==
  /\ phase = "EMPTY"
  /\ intentDurable = FALSE
  /\ sendCount = 0
  /\ external = "NOT_APPLIED"
  /\ receipt = "NONE"
  /\ postcondition = "NONE"
  /\ outcome = "PENDING"
  /\ generation = 0

PersistIntent ==
  /\ phase = "EMPTY"
  /\ phase' = "INTENT_DURABLE"
  /\ intentDurable' = TRUE
  /\ UNCHANGED << sendCount, external, receipt, postcondition, outcome, generation >>

Dispatch ==
  /\ phase = "INTENT_DURABLE"
  /\ phase' = "IN_FLIGHT"
  /\ sendCount' = 1
  /\ external' = "UNKNOWN"
  /\ UNCHANGED << intentDurable, receipt, postcondition, outcome, generation >>

AckApplied ==
  /\ phase = "IN_FLIGHT"
  /\ phase' = "ACKNOWLEDGED"
  /\ external' = "APPLIED"
  /\ receipt' = "DURABLE"
  /\ UNCHANGED << intentDurable, sendCount, postcondition, outcome, generation >>

AckRejected ==
  /\ phase = "IN_FLIGHT"
  /\ phase' = "TERMINAL"
  /\ external' = "NOT_APPLIED"
  /\ receipt' = "DURABLE"
  /\ postcondition' = "AUTHORITATIVE_ABSENT"
  /\ outcome' = "REJECTED"
  /\ UNCHANGED << intentDurable, sendCount, generation >>

LoseResponse ==
  /\ phase = "IN_FLIGHT"
  /\ phase' = "AMBIGUOUS"
  /\ external' \in {"APPLIED", "UNKNOWN"}
  /\ receipt' = "UNKNOWN"
  /\ UNCHANGED << intentDurable, sendCount, postcondition, outcome, generation >>

Crash ==
  /\ phase \in {"IN_FLIGHT", "AMBIGUOUS"}
  /\ generation = 0
  /\ phase' = "RESTORING"
  /\ generation' = 1
  /\ UNCHANGED << intentDurable, sendCount, external, receipt, postcondition, outcome >>

Restore ==
  /\ phase = "RESTORING"
  /\ phase' = "AMBIGUOUS"
  /\ UNCHANGED << intentDurable, sendCount, external, receipt, postcondition, outcome, generation >>

BeginLookup ==
  /\ phase = "AMBIGUOUS"
  /\ phase' = "LOOKUP"
  /\ UNCHANGED << intentDurable, sendCount, external, receipt, postcondition, outcome, generation >>

LookupFound ==
  /\ phase \in {"LOOKUP", "ACKNOWLEDGED"}
  /\ external /= "NOT_APPLIED"
  /\ phase' = "TERMINAL"
  /\ external' = "APPLIED"
  /\ receipt' = "DURABLE"
  /\ postcondition' = "AUTHORITATIVE_APPLIED"
  /\ outcome' = "SUCCESS"
  /\ UNCHANGED << intentDurable, sendCount, generation >>

LookupAbsent ==
  /\ phase = "LOOKUP"
  /\ external /= "APPLIED"
  /\ phase' = "TERMINAL"
  /\ external' = "NOT_APPLIED"
  /\ receipt' = "DURABLE"
  /\ postcondition' = "AUTHORITATIVE_ABSENT"
  /\ outcome' = "REJECTED"
  /\ UNCHANGED << intentDurable, sendCount, generation >>

LookupUnavailable ==
  /\ phase = "LOOKUP"
  /\ phase' = "TERMINAL"
  /\ receipt' = "DURABLE"
  /\ postcondition' = "DURABLE_UNRESOLVED"
  /\ outcome' = "UNRESOLVED"
  /\ UNCHANGED << intentDurable, sendCount, external, generation >>

Next == PersistIntent \/ Dispatch \/ AckApplied \/ AckRejected \/ LoseResponse
        \/ Crash \/ Restore \/ BeginLookup \/ LookupFound \/ LookupAbsent
        \/ LookupUnavailable

Spec == Init /\ [][Next]_vars
        /\ WF_vars(Next)
        /\ WF_vars(Restore)
        /\ WF_vars(BeginLookup)

TypeOK ==
  /\ phase \in {"EMPTY", "INTENT_DURABLE", "IN_FLIGHT", "ACKNOWLEDGED",
                  "AMBIGUOUS", "RESTORING", "LOOKUP", "TERMINAL"}
  /\ intentDurable \in BOOLEAN
  /\ sendCount \in 0..1
  /\ external \in {"NOT_APPLIED", "APPLIED", "UNKNOWN"}
  /\ receipt \in {"NONE", "DURABLE", "UNKNOWN"}
  /\ postcondition \in {"NONE", "AUTHORITATIVE_APPLIED", "AUTHORITATIVE_ABSENT", "DURABLE_UNRESOLVED"}
  /\ outcome \in {"PENDING", "SUCCESS", "REJECTED", "UNRESOLVED"}
  /\ generation \in 0..1

\* S3-SAF-04
DurableIntentBeforeMutation == sendCount = 0 \/ intentDurable
\* S3-SAF-05
NoBlindResend == sendCount <= 1
\* S3-SAF-06
AuthoritativeSuccess == outcome /= "SUCCESS"
  \/ (postcondition = "AUTHORITATIVE_APPLIED" /\ receipt = "DURABLE")
DurableFactLaw == ~(receipt = "DURABLE" /\ external = "APPLIED" /\ outcome = "REJECTED")
\* S3-LIV-01 and S3-LIV-03 under Spec fairness assumptions.
MutationResolves == [](phase \in {"ACKNOWLEDGED", "AMBIGUOUS", "LOOKUP"}
  => <> (outcome \in {"SUCCESS", "REJECTED", "UNRESOLVED"}))
RestartReconstructsOrBlocks == [](phase = "RESTORING" => <> (phase /= "RESTORING"))

=============================================================================
