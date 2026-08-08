"""Pure, deterministic N3-I1 candidate and batch decision policy."""

from __future__ import annotations

from collections.abc import Mapping

from quant_edge.errors import ContractValueError
from quant_edge.n3_intake.contracts import (
    PACKET_ROLE_ORDER,
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    CandidateAssessmentV1,
    DecisionState,
    EvidenceClass,
    GateState,
    IntakeDecisionV1,
    MetricState,
    MetricV1,
    PacketRole,
    RegistryFamilyV1,
    RegistryV1,
    ResultPacketV1,
    _derive_intake_decision,
)


def _record_required_gate(
    state: GateState,
    name: str,
    no_go_reasons: list[str],
    unknown_reasons: list[str],
) -> None:
    if state is GateState.FAIL:
        no_go_reasons.append(f"{name}_FAIL")
    elif state is not GateState.PASS:
        unknown_reasons.append(f"{name}_{state.value}")


def _canonical_reasons(reasons: list[str]) -> tuple[str, ...]:
    return tuple(sorted(set(reasons)))


def _record_minimum_metric(
    metric: MetricV1,
    minimum: int,
    name: str,
    no_go_reasons: list[str],
    unknown_reasons: list[str],
) -> None:
    if metric.state is not MetricState.MEASURED:
        unknown_reasons.append(f"{name}_{metric.state.value}")
    elif metric.value is None:
        unknown_reasons.append(f"{name}_VALUE_MISSING")
    elif metric.value < minimum:
        no_go_reasons.append(f"{name}_BELOW_MINIMUM")


def _record_maximum_metric(
    metric: MetricV1,
    maximum: int,
    name: str,
    no_go_reasons: list[str],
    unknown_reasons: list[str],
) -> None:
    if metric.state is not MetricState.MEASURED:
        unknown_reasons.append(f"{name}_{metric.state.value}")
    elif metric.value is None:
        unknown_reasons.append(f"{name}_VALUE_MISSING")
    elif metric.value > maximum:
        no_go_reasons.append(f"{name}_ABOVE_MAXIMUM")


def assess_candidate(
    registry: RegistryV1,
    family: RegistryFamilyV1,
    result: ResultPacketV1,
) -> CandidateAssessmentV1:
    """Reduce one already-verified and already-joined result to signed gate truth.

    Acceptance is deliberately absent from this reduction. The caller handles
    document acceptance once, at batch aggregation.
    """

    if family not in registry.families:
        raise ContractValueError("family is not a member of the bound registry")
    if result.role is not family.packet_role or result.family_id != family.family_id:
        raise ContractValueError("result role/family does not match the bound registry family")
    if result.candidate_id not in family.candidate_ids:
        raise ContractValueError("result candidate is not in the frozen registry family")
    if result.registry_id != registry.registry_id:
        raise ContractValueError("result registry_id does not match the bound registry")
    if result.registry_sha256 != registry.raw_sha256:
        raise ContractValueError("result registry_sha256 does not match registry raw bytes")
    if result.provenance.base_commit != registry.base_commit:
        raise ContractValueError("result base commit does not match the bound registry")
    if result.trials.declared_count != family.trial_count:
        raise ContractValueError("result declared trial count does not match the frozen family")
    if result.trials.ledger_sha256 != family.trial_ledger_sha256:
        raise ContractValueError("result trial ledger does not match the frozen family")
    if family.trial_ledger_sha256 not in result.provenance.source_artifact_sha256:
        raise ContractValueError("result provenance does not bind the frozen trial ledger")
    if result.trials.multiplicity_method != family.multiplicity_method:
        raise ContractValueError("result multiplicity method does not match the frozen family")

    policy = family.policy
    trials = result.trials
    holdout = result.holdout
    economics = result.economics

    # Reason order is policy order, not input or mapping order. Any unresolved
    # material fact takes precedence over a known failure so a failed peer can
    # never mask incomplete evidence and allow another role to promote the batch.
    no_go_reasons: list[str] = []
    unknown_reasons: list[str] = []

    _record_required_gate(
        result.terminal_state,
        "TERMINAL",
        no_go_reasons,
        unknown_reasons,
    )

    _record_required_gate(
        trials.multiplicity_state,
        "MULTIPLICITY",
        no_go_reasons,
        unknown_reasons,
    )
    if policy.pbo_required:
        _record_required_gate(
            trials.pbo_state,
            "PBO",
            no_go_reasons,
            unknown_reasons,
        )
    if policy.global_test_required:
        _record_required_gate(
            trials.global_test_state,
            "GLOBAL_TEST",
            no_go_reasons,
            unknown_reasons,
        )
    if policy.dsr_required:
        _record_required_gate(
            trials.dsr_state,
            "DSR",
            no_go_reasons,
            unknown_reasons,
        )

    _record_required_gate(
        holdout.state,
        "HOLDOUT",
        no_go_reasons,
        unknown_reasons,
    )
    if holdout.single_use is False:
        no_go_reasons.append("HOLDOUT_NOT_SINGLE_USE")
    elif holdout.single_use is None:
        unknown_reasons.append("HOLDOUT_SINGLE_USE_UNKNOWN")
    if holdout.opened_after_freeze is False:
        no_go_reasons.append("HOLDOUT_OPENED_BEFORE_FREEZE")
    elif holdout.opened_after_freeze is None:
        unknown_reasons.append("HOLDOUT_OPENED_AFTER_FREEZE_UNKNOWN")
    if holdout.selection_inside_evaluation is False:
        no_go_reasons.append("SELECTION_OUTSIDE_EVALUATION")
    elif holdout.selection_inside_evaluation is None:
        unknown_reasons.append("SELECTION_INSIDE_EVALUATION_UNKNOWN")
    if holdout.reuse_count is None:
        unknown_reasons.append("HOLDOUT_REUSE_COUNT_UNKNOWN")
    elif holdout.reuse_count > 1:
        no_go_reasons.append("HOLDOUT_REUSED")
    elif holdout.reuse_count != 1:
        unknown_reasons.append("HOLDOUT_REUSE_COUNT_MISMATCH")

    if policy.actual_fee_required:
        _record_required_gate(
            economics.actual_fee_state,
            "ACTUAL_FEE",
            no_go_reasons,
            unknown_reasons,
        )
    _record_required_gate(
        economics.cost_complete_state,
        "COST_COMPLETE",
        no_go_reasons,
        unknown_reasons,
    )
    if policy.maker_entry_required:
        _record_required_gate(
            economics.maker_entry_state,
            "MAKER_ENTRY",
            no_go_reasons,
            unknown_reasons,
        )
    _record_required_gate(
        economics.regime_coverage_state,
        "REGIME_COVERAGE",
        no_go_reasons,
        unknown_reasons,
    )

    _record_minimum_metric(
        economics.net,
        policy.minimum_net_microusd_per_1000,
        "NET",
        no_go_reasons,
        unknown_reasons,
    )
    _record_minimum_metric(
        holdout.lower_bound,
        policy.minimum_holdout_lower_bound_microusd_per_1000,
        "HOLDOUT_LOWER_BOUND",
        no_go_reasons,
        unknown_reasons,
    )
    _record_minimum_metric(
        economics.stress_net,
        policy.minimum_stress_net_microusd_per_1000,
        "STRESS_NET",
        no_go_reasons,
        unknown_reasons,
    )
    _record_minimum_metric(
        economics.capacity_usd,
        policy.minimum_capacity_usd,
        "CAPACITY",
        no_go_reasons,
        unknown_reasons,
    )
    _record_maximum_metric(
        economics.max_drawdown_bps,
        policy.maximum_drawdown_bps,
        "MAX_DRAWDOWN",
        no_go_reasons,
        unknown_reasons,
    )

    if trials.observed_count != family.trial_count:
        unknown_reasons.append("TRIAL_OBSERVED_COUNT_MISMATCH")
    if holdout.evidence_class is EvidenceClass.UNMEASURED:
        unknown_reasons.append("HOLDOUT_EVIDENCE_CLASS_UNMEASURED")
    elif holdout.evidence_class is not policy.required_evidence_class:
        no_go_reasons.append("HOLDOUT_EVIDENCE_CLASS_MISMATCH")

    # Producer reason codes are retained separately. Without a frozen producer
    # taxonomy their severity cannot be inferred, so any nonempty tuple is a
    # material unresolved fact and can never coexist with a positive decision.
    if result.reason_codes:
        unknown_reasons.append("SOURCE_REASON_CODES_PRESENT")

    if unknown_reasons:
        status = DecisionState.UNKNOWN
        reason_codes = _canonical_reasons(no_go_reasons + unknown_reasons)
    elif no_go_reasons:
        status = DecisionState.NO_GO
        reason_codes = _canonical_reasons(no_go_reasons)
    else:
        status = DecisionState.VERIFIED_POSITIVE
        reason_codes = ("ALL_REQUIRED_GATES_PASS",)

    return CandidateAssessmentV1(
        role=result.role,
        family_id=family.family_id,
        candidate_id=result.candidate_id,
        status=status,
        reason_codes=reason_codes,
        source_reason_codes=result.reason_codes,
        raw_sha256=result.raw_sha256,
        semantic_sha256=result.semantic_sha256,
        net=economics.net,
        holdout_lower_bound=holdout.lower_bound,
        stress_net=economics.stress_net,
        capacity_usd=economics.capacity_usd,
        max_drawdown_bps=economics.max_drawdown_bps,
    )


def _aggregate_results(
    registry: RegistryV1,
    results_by_role: Mapping[PacketRole, ResultPacketV1],
    registry_pin: ArtifactPinV1,
    result_pins_by_role: Mapping[PacketRole, ArtifactPinV1],
) -> IntakeDecisionV1:
    """Re-assess and aggregate exact pinned result packets without masking."""

    if set(results_by_role) != set(PACKET_ROLE_ORDER):
        raise ContractValueError("results must contain the complete PACKET_ROLE_ORDER")
    if not isinstance(registry_pin, ArtifactPinV1):
        raise ContractValueError("registry_pin must be ArtifactPinV1")
    if registry_pin.role is not ArtifactRole.S_META1:
        raise ContractValueError("registry pin role must be S_META1")
    if registry_pin.raw_sha256 != registry.raw_sha256:
        raise ContractValueError("registry pin does not match the adapted registry bytes")
    if registry_pin.acceptance is AcceptanceState.REJECTED:
        raise ContractValueError("REJECTED registry pin is invalid input")
    if set(result_pins_by_role) != set(PACKET_ROLE_ORDER):
        raise ContractValueError("result pins must contain the complete PACKET_ROLE_ORDER")
    family_by_role = {family.packet_role: family for family in registry.families}
    ordered_assessments: list[CandidateAssessmentV1] = []
    ordered_pins: list[ArtifactPinV1] = []
    for role in PACKET_ROLE_ORDER:
        result = results_by_role[role]
        if not isinstance(result, ResultPacketV1):
            raise ContractValueError("results must contain ResultPacketV1 values")
        if result.role is not role:
            raise ContractValueError("result mapping key does not match packet role")
        pin = result_pins_by_role[role]
        if not isinstance(pin, ArtifactPinV1):
            raise ContractValueError("result pin must be ArtifactPinV1")
        if pin.role is not ArtifactRole(role.value):
            raise ContractValueError("result pin artifact role does not match its packet role")
        if pin.raw_sha256 != result.raw_sha256:
            raise ContractValueError("result pin does not match its adapted result bytes")
        if pin.acceptance is AcceptanceState.REJECTED:
            raise ContractValueError(f"REJECTED {role.value} pin is invalid input")
        family = family_by_role[role]
        ordered_assessments.append(assess_candidate(registry, family, result))
        ordered_pins.append(pin)

    unknown_reasons: list[str] = []
    if registry_pin.acceptance is not AcceptanceState.ACCEPTED:
        unknown_reasons.append(f"REGISTRY_ACCEPTANCE_{registry_pin.acceptance.value}")
    for role in PACKET_ROLE_ORDER:
        acceptance = result_pins_by_role[role].acceptance
        if acceptance is not AcceptanceState.ACCEPTED:
            unknown_reasons.append(f"{role.value}_ACCEPTANCE_{acceptance.value}")
    for assessment in ordered_assessments:
        if assessment.status is DecisionState.UNKNOWN:
            unknown_reasons.append(f"{assessment.role.value}_ASSESSMENT_UNKNOWN")

    if unknown_reasons:
        status = DecisionState.UNKNOWN
        credible_positive_count = None
        reason_codes = _canonical_reasons(unknown_reasons)
    else:
        credible_positive_count = sum(
            assessment.status is DecisionState.VERIFIED_POSITIVE
            for assessment in ordered_assessments
        )
        if credible_positive_count > 0:
            status = DecisionState.VERIFIED_POSITIVE
            reason_codes = ("CREDIBLE_POSITIVE_PRESENT",)
        else:
            status = DecisionState.NO_GO
            reason_codes = ("NO_CREDIBLE_POSITIVE",)

    return _derive_intake_decision(
        registry_raw_sha256=registry.raw_sha256,
        registry_semantic_sha256=registry.semantic_sha256,
        registry_pin=registry_pin,
        result_pins=tuple(ordered_pins),
        status=status,
        reason_codes=reason_codes,
        assessments=tuple(ordered_assessments),
        credible_positive_count=credible_positive_count,
    )
