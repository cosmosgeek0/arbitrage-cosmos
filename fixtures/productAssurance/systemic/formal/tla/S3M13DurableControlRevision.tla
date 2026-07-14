-------------------- MODULE S3M13DurableControlRevision --------------------
EXTENDS Naturals, FiniteSets

\* SYNTHETIC_ONLY
\* SUPPORTING_EVIDENCE_ONLY
\* runtime_claim_closure NOT_PERMITTED
\* frozen donor df6b472993ca9659ce09cf5f72004981c6835f0d
\* TLA tooling not configured
\* Finite envelope: command IDs A and B compete at expected revision zero;
\* one atomic reservation, one publication, one inert replay, and one bounded
\* post-publication repair may occur.
VARIABLES phase, durableIntents, statusA, statusB, reservedBy, revision,
          expectedRevision, published, publicationGuardPass, replaySeen,
          replayRevision, replayPublicationCount, failurePending, posture,
          repair, sourceTruth, decision, capitalBefore, capital

vars == << phase, durableIntents, statusA, statusB, reservedBy, revision,
           expectedRevision, published, publicationGuardPass, replaySeen,
           replayRevision, replayPublicationCount, failurePending, posture,
           repair, sourceTruth, decision, capitalBefore, capital >>

Commands == {"A", "B"}

Init ==
  /\ phase = "PREPARE" /\ durableIntents = {} /\ statusA = "PREVIEWED"
  /\ statusB = "PREVIEWED" /\ reservedBy = "NONE" /\ revision = 0
  /\ expectedRevision = 0 /\ published = {} /\ ~publicationGuardPass
  /\ ~replaySeen /\ replayRevision = 0 /\ replayPublicationCount = 0
  /\ ~failurePending /\ posture = "OPEN" /\ ~repair
  /\ sourceTruth = "KNOWN" /\ decision = "UNKNOWN"
  /\ capitalBefore = 1 /\ capital = 1

ReserveA ==
  /\ phase = "PREPARE" /\ durableIntents = {}
  /\ revision = expectedRevision /\ reservedBy = "NONE"
  /\ phase' = "RESERVED" /\ durableIntents' = {"A"}
  /\ reservedBy' = "A" /\ revision' = 1
  /\ statusA' = "RESERVED"
  /\ UNCHANGED << statusB, expectedRevision, published,
                   publicationGuardPass, replaySeen, replayRevision,
                   replayPublicationCount, failurePending, posture, repair,
                   sourceTruth, decision, capitalBefore, capital >>

ReserveB ==
  /\ phase = "PREPARE" /\ durableIntents = {}
  /\ revision = expectedRevision /\ reservedBy = "NONE"
  /\ phase' = "RESERVED" /\ durableIntents' = {"B"}
  /\ reservedBy' = "B" /\ revision' = 1
  /\ statusB' = "RESERVED"
  /\ UNCHANGED << statusA, expectedRevision, published,
                   publicationGuardPass, replaySeen, replayRevision,
                   replayPublicationCount, failurePending, posture, repair,
                   sourceTruth, decision, capitalBefore, capital >>

PublishA ==
  /\ phase = "RESERVED" /\ reservedBy = "A"
  /\ posture = "OPEN" /\ ~repair /\ sourceTruth = "KNOWN"
  /\ phase' = "PUBLISHED" /\ published' = {"A"}
  /\ statusA' = "PUBLISHED" /\ statusB' = "REJECTED"
  /\ publicationGuardPass' = TRUE /\ decision' = "PASS"
  /\ UNCHANGED << durableIntents, reservedBy, revision, expectedRevision,
                   replaySeen, replayRevision, replayPublicationCount,
                   failurePending, posture, repair, sourceTruth,
                   capitalBefore, capital >>

PublishB ==
  /\ phase = "RESERVED" /\ reservedBy = "B"
  /\ posture = "OPEN" /\ ~repair /\ sourceTruth = "KNOWN"
  /\ phase' = "PUBLISHED" /\ published' = {"B"}
  /\ statusB' = "PUBLISHED" /\ statusA' = "REJECTED"
  /\ publicationGuardPass' = TRUE /\ decision' = "PASS"
  /\ UNCHANGED << durableIntents, reservedBy, revision, expectedRevision,
                   replaySeen, replayRevision, replayPublicationCount,
                   failurePending, posture, repair, sourceTruth,
                   capitalBefore, capital >>

ReplayPublishedCommand ==
  /\ phase = "PUBLISHED" /\ ~replaySeen
  /\ replaySeen' = TRUE /\ replayRevision' = revision
  /\ replayPublicationCount' = Cardinality(published)
  /\ UNCHANGED << phase, durableIntents, statusA, statusB, reservedBy,
                   revision, expectedRevision, published, publicationGuardPass,
                   failurePending, posture, repair, sourceTruth, decision,
                   capitalBefore, capital >>

FailAfterPublication ==
  /\ phase = "PUBLISHED" /\ ~failurePending
  /\ phase' = "FAILURE_PENDING" /\ failurePending' = TRUE
  /\ decision' = "UNKNOWN"
  /\ UNCHANGED << durableIntents, statusA, statusB, reservedBy, revision,
                   expectedRevision, published, publicationGuardPass,
                   replaySeen, replayRevision, replayPublicationCount,
                   posture, repair, sourceTruth, capitalBefore, capital >>

EnterRepair ==
  /\ phase = "FAILURE_PENDING" /\ failurePending
  /\ phase' = "REPAIR" /\ repair' = TRUE /\ posture' = "REPAIR"
  /\ UNCHANGED << durableIntents, statusA, statusB, reservedBy, revision,
                   expectedRevision, published, publicationGuardPass,
                   replaySeen, replayRevision, replayPublicationCount,
                   failurePending, sourceTruth, decision, capitalBefore,
                   capital >>

ReduceDuringRepair ==
  /\ phase = "REPAIR" /\ capital > 0 /\ capital' = capital - 1
  /\ UNCHANGED << phase, durableIntents, statusA, statusB, reservedBy,
                   revision, expectedRevision, published, publicationGuardPass,
                   replaySeen, replayRevision, replayPublicationCount,
                   failurePending, posture, repair, sourceTruth, decision,
                   capitalBefore >>

ResolvePublicationFailure ==
  /\ phase \in {"FAILURE_PENDING", "REPAIR"} /\ failurePending
  /\ phase' = "TERMINAL" /\ failurePending' = FALSE
  /\ decision' = "RECONCILED"
  /\ UNCHANGED << durableIntents, statusA, statusB, reservedBy, revision,
                   expectedRevision, published, publicationGuardPass,
                   replaySeen, replayRevision, replayPublicationCount,
                   posture, repair, sourceTruth, capitalBefore, capital >>

EngageHalt ==
  /\ phase \in {"PREPARE", "RESERVED"} /\ posture = "OPEN"
  /\ posture' = "HALT" /\ decision' = "FAIL"
  /\ UNCHANGED << phase, durableIntents, statusA, statusB, reservedBy,
                   revision, expectedRevision, published, publicationGuardPass,
                   replaySeen, replayRevision, replayPublicationCount,
                   failurePending, repair, sourceTruth, capitalBefore, capital >>

LoseSourceTruth ==
  /\ phase \in {"PREPARE", "RESERVED"} /\ sourceTruth = "KNOWN"
  /\ sourceTruth' = "UNKNOWN" /\ decision' = "UNKNOWN"
  /\ UNCHANGED << phase, durableIntents, statusA, statusB, reservedBy,
                   revision, expectedRevision, published, publicationGuardPass,
                   replaySeen, replayRevision, replayPublicationCount,
                   failurePending, posture, repair, capitalBefore, capital >>

Next == ReserveA \/ ReserveB
        \/ PublishA \/ PublishB \/ ReplayPublishedCommand
        \/ FailAfterPublication \/ EnterRepair \/ ReduceDuringRepair
        \/ ResolvePublicationFailure \/ EngageHalt \/ LoseSourceTruth

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
        /\ WF_vars(PublishA) /\ WF_vars(PublishB)
        /\ WF_vars(ResolvePublicationFailure)

TypeOK ==
  /\ phase \in {"PREPARE", "RESERVED", "PUBLISHED", "FAILURE_PENDING",
                 "REPAIR", "TERMINAL"}
  /\ durableIntents \subseteq Commands
  /\ statusA \in {"PREVIEWED", "RESERVED", "PUBLISHED", "REJECTED"}
  /\ statusB \in {"PREVIEWED", "RESERVED", "PUBLISHED", "REJECTED"}
  /\ reservedBy \in {"NONE", "A", "B"} /\ revision \in 0..1
  /\ expectedRevision \in 0..0 /\ published \subseteq Commands
  /\ publicationGuardPass \in BOOLEAN /\ replaySeen \in BOOLEAN
  /\ replayRevision \in 0..1 /\ replayPublicationCount \in 0..1
  /\ failurePending \in BOOLEAN /\ posture \in {"OPEN", "HALT", "REPAIR"}
  /\ repair \in BOOLEAN /\ sourceTruth \in {"KNOWN", "UNKNOWN"}
  /\ decision \in {"UNKNOWN", "PASS", "FAIL", "RECONCILED"}
  /\ capitalBefore \in 1..1 /\ capital \in 0..1

DurableIntentBeforePublish == published \subseteq durableIntents

AtomicRevisionExcludesDualPublication ==
  Cardinality(published) <= 1
  /\ Cardinality(durableIntents) <= 1
  /\ (reservedBy = "NONE" => revision = expectedRevision)
  /\ (reservedBy \in Commands => revision = expectedRevision + 1)
  /\ (reservedBy = "A" => durableIntents = {"A"})
  /\ (reservedBy = "B" => durableIntents = {"B"})

ReplayIsInert ==
  ~replaySeen \/
    (revision = replayRevision /\ Cardinality(published) = replayPublicationCount)

PublicationGuardsHeld == published = {} \/ publicationGuardPass

RepairCapitalCeiling == ~repair \/ capital <= capitalBefore

UnknownNeverPass == sourceTruth /= "UNKNOWN" \/ decision /= "PASS"

PostPublicationFailureIsPending ==
  phase \notin {"FAILURE_PENDING", "REPAIR"} \/ failurePending

ReservationEventuallyResolves ==
  phase = "RESERVED" ~> (phase = "PUBLISHED" \/ posture = "HALT"
                         \/ sourceTruth = "UNKNOWN")

PublicationFailureEventuallyResolves ==
  failurePending ~> ~failurePending

CompetingCommandsReachOneDecision ==
  (statusA = "PREVIEWED" /\ statusB = "PREVIEWED") ~>
    (Cardinality(published) = 1 \/ posture = "HALT" \/ sourceTruth = "UNKNOWN")

=====================================================================
