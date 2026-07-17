-------------------- MODULE S3M06HaltRiskReduction --------------------
EXTENDS Naturals

\* Finite envelope: one operation, one halt interleaving, one approval use.
VARIABLES phase, posture, operation, riskEffect, riskGate, approvalBound,
          approvalIdentity, expectedIdentity, approvalUseIdentity,
          expectedUseIdentity, approvalScope, expectedScope, approvalVersion,
          expectedVersion, approvalExpiry, approvalUses, tick, beforeExposure,
          afterExposure, capacity, outcome

vars == << phase, posture, operation, riskEffect, riskGate, approvalBound,
           approvalIdentity, expectedIdentity, approvalUseIdentity,
           expectedUseIdentity, approvalScope, expectedScope, approvalVersion,
           expectedVersion, approvalExpiry, approvalUses, tick, beforeExposure,
           afterExposure, capacity, outcome >>

Init ==
  /\ phase = "IDLE" /\ posture = "OPEN" /\ operation = "NONE"
  /\ riskEffect = "NONE" /\ riskGate = "UNKNOWN" /\ approvalBound
  /\ approvalIdentity = "APPROVAL_1" /\ expectedIdentity = "APPROVAL_1"
  /\ approvalUseIdentity = "USE_1" /\ expectedUseIdentity = "USE_1"
  /\ approvalScope = "NONE" /\ expectedScope = "NONE"
  /\ approvalVersion = 1 /\ expectedVersion = 1 /\ approvalExpiry = 2
  /\ approvalUses = 0 /\ tick = 0 /\ beforeExposure = 2
  /\ afterExposure = 2 /\ capacity = "AVAILABLE" /\ outcome = "PENDING"

Propose(op, effect, scope) ==
  /\ phase = "IDLE" /\ phase' = "PROPOSED"
  /\ operation' = op /\ riskEffect' = effect
  /\ approvalScope' = scope /\ expectedScope' = scope
  /\ UNCHANGED << posture, riskGate, approvalBound, approvalIdentity,
                   expectedIdentity, approvalUseIdentity, expectedUseIdentity,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

\* Invalid approval material is explicitly reachable so identity, use identity,
\* scope, version, binding, and expiry checks are not singleton tautologies.
PresentWrongIdentity ==
  /\ phase = "PROPOSED" /\ approvalIdentity = "APPROVAL_1"
  /\ approvalIdentity' = "APPROVAL_OTHER"
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

DriftApprovalUseIdentity ==
  /\ phase = "PROPOSED" /\ approvalUseIdentity = "USE_1"
  /\ approvalUseIdentity' = "USE_OTHER"
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, approvalIdentity, expectedIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

PresentWrongScope ==
  /\ phase = "PROPOSED" /\ approvalScope /= "WRONG_SCOPE"
  /\ approvalScope' = "WRONG_SCOPE"
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, approvalIdentity, expectedIdentity,
                   approvalUseIdentity, expectedUseIdentity, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

PresentWrongVersion ==
  /\ phase = "PROPOSED" /\ approvalVersion = 1
  /\ approvalVersion' = 0
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, approvalIdentity, expectedIdentity,
                   approvalUseIdentity, expectedUseIdentity, approvalScope,
                   expectedScope, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

PresentUnboundApproval ==
  /\ phase = "PROPOSED" /\ approvalBound
  /\ approvalBound' = FALSE
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

EngageHalt ==
  /\ phase \in {"PROPOSED", "EVALUATED"} /\ posture = "OPEN"
  /\ posture' = "HALT_NEW_EXPOSURE"
  /\ UNCHANGED << phase, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

LosePostureTruth ==
  /\ phase = "PROPOSED" /\ posture = "OPEN" /\ posture' = "UNKNOWN"
  /\ UNCHANGED << phase, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

Evaluate ==
  /\ phase = "PROPOSED" /\ phase' = "EVALUATED"
  /\ riskGate' = IF riskEffect = "INCREASE"
                    THEN IF posture = "OPEN" THEN "ALLOW"
                         ELSE IF posture = "HALT_NEW_EXPOSURE" THEN "DENY" ELSE "UNKNOWN"
                    ELSE "ALLOW"
  /\ UNCHANGED << posture, operation, riskEffect, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity,
                   outcome >>

BlockReductionCapacity ==
  /\ phase = "PROPOSED" /\ riskEffect = "REDUCE" /\ capacity = "AVAILABLE"
  /\ capacity' = "BLOCKED"
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, approvalIdentity, expectedIdentity,
                   approvalUseIdentity, expectedUseIdentity, approvalScope,
                   expectedScope, approvalVersion, expectedVersion,
                   approvalExpiry, approvalUses, tick, beforeExposure,
                   afterExposure, outcome >>

ExpireApproval ==
  /\ phase = "EVALUATED" /\ tick = 0 /\ tick' = 2
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, approvalIdentity, expectedIdentity,
                   approvalUseIdentity, expectedUseIdentity, approvalScope,
                   expectedScope, approvalVersion, expectedVersion,
                   approvalExpiry, approvalUses, beforeExposure, afterExposure,
                   capacity, outcome >>

\* A previously consumed approval can be presented again after evaluation;
\* ApprovalCurrent rejects it because the use count is no longer zero.
PresentUsedApproval ==
  /\ phase = "EVALUATED" /\ approvalUses = 0
  /\ approvalUses' = 1
  /\ UNCHANGED << phase, posture, operation, riskEffect, riskGate,
                   approvalBound, approvalIdentity, expectedIdentity,
                   approvalUseIdentity, expectedUseIdentity, approvalScope,
                   expectedScope, approvalVersion, expectedVersion,
                   approvalExpiry, tick, beforeExposure, afterExposure,
                   capacity, outcome >>

ApprovalCurrent ==
  /\ approvalBound /\ approvalIdentity = expectedIdentity
  /\ approvalUseIdentity = expectedUseIdentity
  /\ approvalScope = expectedScope /\ approvalVersion = expectedVersion
  /\ tick < approvalExpiry /\ approvalUses = 0

CommitIncrease ==
  /\ phase = "EVALUATED" /\ riskEffect = "INCREASE"
  /\ posture = "OPEN" /\ riskGate = "ALLOW" /\ ApprovalCurrent
  /\ phase' = "TERMINAL" /\ afterExposure' = 3
  /\ approvalUses' = 1 /\ outcome' = "APPLIED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry, tick,
                   beforeExposure, capacity >>

RejectRiskIncrease ==
  /\ phase = "EVALUATED" /\ riskEffect = "INCREASE"
  /\ ~(posture = "OPEN" /\ riskGate = "ALLOW")
  /\ phase' = "TERMINAL" /\ outcome' = "BLOCKED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity >>

RejectInvalidIncrease ==
  /\ phase = "EVALUATED" /\ riskEffect = "INCREASE"
  /\ posture = "OPEN" /\ riskGate = "ALLOW" /\ ~ApprovalCurrent
  /\ phase' = "TERMINAL" /\ outcome' = "BLOCKED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity >>

CommitReduction ==
  /\ phase = "EVALUATED" /\ riskEffect = "REDUCE"
  /\ capacity = "AVAILABLE" /\ ApprovalCurrent
  /\ phase' = "TERMINAL" /\ afterExposure' = 1
  /\ approvalUses' = 1 /\ outcome' = "APPLIED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry, tick,
                   beforeExposure, capacity >>

ReductionUnresolved ==
  /\ phase = "EVALUATED" /\ riskEffect = "REDUCE"
  /\ capacity = "BLOCKED" /\ ApprovalCurrent
  /\ phase' = "TERMINAL" /\ outcome' = "UNRESOLVED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity >>

RejectInvalidReduction ==
  /\ phase = "EVALUATED" /\ riskEffect = "REDUCE" /\ ~ApprovalCurrent
  /\ phase' = "TERMINAL" /\ outcome' = "BLOCKED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity >>

CommitReconcile ==
  /\ phase = "EVALUATED" /\ riskEffect = "NEUTRAL"
  /\ phase' = "TERMINAL" /\ outcome' = "APPLIED"
  /\ UNCHANGED << posture, operation, riskEffect, riskGate, approvalBound,
                   approvalIdentity, expectedIdentity, approvalUseIdentity,
                   expectedUseIdentity, approvalScope, expectedScope,
                   approvalVersion, expectedVersion, approvalExpiry,
                   approvalUses, tick, beforeExposure, afterExposure, capacity >>

Next == Propose("ENTRY", "INCREASE", "RISK_INCREASING")
        \/ Propose("REDUCE", "REDUCE", "RISK_REDUCING")
        \/ Propose("REPAY", "REDUCE", "RISK_REDUCING")
        \/ Propose("RECONCILE", "NEUTRAL", "OBSERVE")
        \/ PresentWrongIdentity \/ DriftApprovalUseIdentity
        \/ PresentWrongScope \/ PresentWrongVersion \/ PresentUnboundApproval
        \/ EngageHalt \/ LosePostureTruth \/ Evaluate
        \/ BlockReductionCapacity \/ ExpireApproval \/ PresentUsedApproval
        \/ CommitIncrease
        \/ RejectRiskIncrease \/ RejectInvalidIncrease
        \/ CommitReduction \/ ReductionUnresolved
        \/ RejectInvalidReduction \/ CommitReconcile
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
  /\ phase \in {"IDLE", "PROPOSED", "EVALUATED", "TERMINAL"}
  /\ posture \in {"OPEN", "HALT_NEW_EXPOSURE", "UNKNOWN"}
  /\ operation \in {"NONE", "ENTRY", "REDUCE", "REPAY", "RECONCILE"}
  /\ riskEffect \in {"NONE", "INCREASE", "REDUCE", "NEUTRAL"}
  /\ riskGate \in {"ALLOW", "DENY", "UNKNOWN"} /\ approvalBound \in BOOLEAN
  /\ approvalIdentity \in {"APPROVAL_1", "APPROVAL_OTHER"}
  /\ expectedIdentity \in {"APPROVAL_1"}
  /\ approvalUseIdentity \in {"USE_1", "USE_OTHER"}
  /\ expectedUseIdentity \in {"USE_1"}
  /\ approvalScope \in {"NONE", "RISK_INCREASING", "RISK_REDUCING", "OBSERVE",
                          "WRONG_SCOPE"}
  /\ expectedScope \in {"NONE", "RISK_INCREASING", "RISK_REDUCING", "OBSERVE"}
  /\ approvalVersion \in 0..1 /\ expectedVersion \in 1..1
  /\ approvalExpiry \in 2..2 /\ approvalUses \in 0..1 /\ tick \in 0..2
  /\ beforeExposure \in 2..2 /\ afterExposure \in 1..3
  /\ capacity \in {"AVAILABLE", "BLOCKED"}
  /\ outcome \in {"PENDING", "APPLIED", "BLOCKED", "UNRESOLVED"}

NoRiskIncreaseWhenDenied == afterExposure <= beforeExposure
  \/ (posture = "OPEN" /\ riskGate = "ALLOW")
ApprovalBinding == outcome /= "APPLIED" \/ riskEffect = "NEUTRAL"
  \/ (approvalBound /\ approvalIdentity = expectedIdentity
      /\ approvalUseIdentity = expectedUseIdentity
      /\ approvalScope = expectedScope /\ approvalVersion = expectedVersion
      /\ tick < approvalExpiry /\ approvalUses = 1)
InvalidApprovalRejected == phase /= "TERMINAL" \/ riskEffect = "NEUTRAL"
  \/ outcome = "BLOCKED"
  \/ (approvalBound /\ approvalIdentity = expectedIdentity
      /\ approvalUseIdentity = expectedUseIdentity
      /\ approvalScope = expectedScope /\ approvalVersion = expectedVersion
      /\ tick < approvalExpiry
      /\ ((outcome = "APPLIED" /\ approvalUses = 1)
          \/ (outcome = "UNRESOLVED" /\ approvalUses = 0)))
HaltPreservesRiskReduction == ~(posture = "HALT_NEW_EXPOSURE"
  /\ riskEffect = "REDUCE" /\ riskGate = "DENY")
  /\ ~(outcome = "APPLIED" /\ riskEffect = "REDUCE"
       /\ afterExposure >= beforeExposure)
=============================================================================
