from __future__ import annotations

from dataclasses import replace

import pytest

import quant_edge.n3_intake.decision as decision_module
from quant_edge.errors import ContractValueError
from quant_edge.lake.contracts import DigestV1
from quant_edge.n3_intake.contracts import (
    PACKET_ROLE_ORDER,
    AcceptanceState,
    ArtifactPinV1,
    ArtifactRole,
    DecisionState,
    EconomicEvidenceV1,
    EvidenceClass,
    GatePolicyV1,
    GateState,
    GitOidV1,
    HoldoutEvidenceV1,
    MetricState,
    MetricV1,
    PacketRole,
    ProvenanceV1,
    RegistryFamilyV1,
    RegistryV1,
    ResultPacketV1,
    TrialEvidenceV1,
)
from quant_edge.n3_intake.decision import _aggregate_results, assess_candidate


def _digest(seed: int) -> DigestV1:
    return DigestV1(f"{seed:064x}")


def _measured(value: int) -> MetricV1:
    return MetricV1(state=MetricState.MEASURED, value=value)


def _policy() -> GatePolicyV1:
    return GatePolicyV1(
        actual_fee_required=True,
        maker_entry_required=True,
        pbo_required=True,
        global_test_required=True,
        dsr_required=True,
        required_evidence_class=EvidenceClass.SEALED_FORWARD,
        minimum_net_microusd_per_1000=1_000_000,
        minimum_holdout_lower_bound_microusd_per_1000=500_000,
        # Two basis points of 1,000 USD is 0.20 USD, or 200,000 microusd.
        minimum_stress_net_microusd_per_1000=200_000,
        minimum_capacity_usd=10_000,
        maximum_drawdown_bps=250,
    )


def _family(
    role: PacketRole,
    seed: int,
    *,
    policy: GatePolicyV1 | None = None,
) -> RegistryFamilyV1:
    return RegistryFamilyV1(
        family_id=f"FAMILY_{role.value}",
        packet_role=role,
        trial_count=7,
        candidate_ids=tuple(
            f"CANDIDATE_{role.value}_{candidate_index:02d}" for candidate_index in range(7)
        ),
        trial_ledger_sha256=_digest(seed),
        multiplicity_method="HOLM_BONFERRONI",
        alpha_numerator=5,
        alpha_denominator=100,
        policy=_policy() if policy is None else policy,
    )


def _registry(*families: RegistryFamilyV1) -> RegistryV1:
    return RegistryV1(
        registry_id="N3I1_REGISTRY",
        base_commit=GitOidV1("a" * 40),
        families=families,
        raw_sha256=_digest(100),
        semantic_sha256=_digest(101),
    )


def _result(
    registry: RegistryV1,
    family: RegistryFamilyV1,
    seed: int,
) -> ResultPacketV1:
    return ResultPacketV1(
        schema="ResultPacketV1",
        role=family.packet_role,
        milestone=family.packet_role.value,
        registry_id=registry.registry_id,
        registry_sha256=registry.raw_sha256,
        family_id=family.family_id,
        candidate_id=family.candidate_ids[0],
        terminal_state=GateState.PASS,
        provenance=ProvenanceV1(
            base_commit=registry.base_commit,
            producer_commit=GitOidV1(f"{seed + 1:040x}"),
            producer_tree=GitOidV1(f"{seed + 2:040x}"),
            source_artifact_sha256=(
                family.trial_ledger_sha256,
                _digest(seed + 3),
            ),
        ),
        trials=TrialEvidenceV1(
            declared_count=family.trial_count,
            observed_count=family.trial_count,
            ledger_sha256=family.trial_ledger_sha256,
            multiplicity_method=family.multiplicity_method,
            multiplicity_state=GateState.PASS,
            pbo_state=GateState.PASS,
            global_test_state=GateState.PASS,
            dsr_state=GateState.PASS,
        ),
        holdout=HoldoutEvidenceV1(
            evidence_class=EvidenceClass.SEALED_FORWARD,
            state=GateState.PASS,
            single_use=True,
            opened_after_freeze=True,
            selection_inside_evaluation=True,
            reuse_count=1,
            lower_bound=_measured(family.policy.minimum_holdout_lower_bound_microusd_per_1000),
        ),
        economics=EconomicEvidenceV1(
            net=_measured(family.policy.minimum_net_microusd_per_1000),
            stress_net=_measured(family.policy.minimum_stress_net_microusd_per_1000),
            capacity_usd=_measured(family.policy.minimum_capacity_usd),
            max_drawdown_bps=_measured(family.policy.maximum_drawdown_bps),
            actual_fee_state=GateState.PASS,
            cost_complete_state=GateState.PASS,
            maker_entry_state=GateState.PASS,
            regime_coverage_state=GateState.PASS,
        ),
        reason_codes=(),
        raw_sha256=_digest(seed + 4),
        semantic_sha256=_digest(seed + 5),
    )


def _single_candidate() -> tuple[RegistryV1, RegistryFamilyV1, ResultPacketV1]:
    families = tuple(_family(role, index + 1) for index, role in enumerate(PACKET_ROLE_ORDER))
    registry = _registry(*families)
    family = families[0]
    return registry, family, _result(registry, family, 10)


def test_full_pass_is_verified_positive_at_inclusive_thresholds() -> None:
    registry, family, result = _single_candidate()

    assessment = assess_candidate(registry, family, result)

    assert assessment.status is DecisionState.VERIFIED_POSITIVE
    assert assessment.reason_codes == ("ALL_REQUIRED_GATES_PASS",)
    assert assessment.net.value == family.policy.minimum_net_microusd_per_1000
    assert (
        assessment.holdout_lower_bound.value
        == family.policy.minimum_holdout_lower_bound_microusd_per_1000
    )
    assert assessment.stress_net.value == family.policy.minimum_stress_net_microusd_per_1000
    assert assessment.capacity_usd.value == family.policy.minimum_capacity_usd
    assert assessment.max_drawdown_bps.value == family.policy.maximum_drawdown_bps


def test_each_measured_threshold_failure_is_no_go() -> None:
    registry, family, result = _single_candidate()
    policy = family.policy
    economics = result.economics
    holdout = result.holdout
    cases = (
        (
            "NET_BELOW_MINIMUM",
            replace(
                result,
                economics=replace(
                    economics,
                    net=_measured(policy.minimum_net_microusd_per_1000 - 1),
                ),
            ),
        ),
        (
            "HOLDOUT_LOWER_BOUND_BELOW_MINIMUM",
            replace(
                result,
                holdout=replace(
                    holdout,
                    lower_bound=_measured(policy.minimum_holdout_lower_bound_microusd_per_1000 - 1),
                ),
            ),
        ),
        (
            "STRESS_NET_BELOW_MINIMUM",
            replace(
                result,
                economics=replace(
                    economics,
                    stress_net=_measured(policy.minimum_stress_net_microusd_per_1000 - 1),
                ),
            ),
        ),
        (
            "CAPACITY_BELOW_MINIMUM",
            replace(
                result,
                economics=replace(
                    economics,
                    capacity_usd=_measured(policy.minimum_capacity_usd - 1),
                ),
            ),
        ),
        (
            "MAX_DRAWDOWN_ABOVE_MAXIMUM",
            replace(
                result,
                economics=replace(
                    economics,
                    max_drawdown_bps=_measured(policy.maximum_drawdown_bps + 1),
                ),
            ),
        ),
    )

    for expected_reason, failed_result in cases:
        assessment = assess_candidate(registry, family, failed_result)
        assert assessment.status is DecisionState.NO_GO, expected_reason
        assert expected_reason in assessment.reason_codes


def test_each_required_gate_fail_is_no_go() -> None:
    registry, family, result = _single_candidate()
    trials = result.trials
    economics = result.economics
    cases = (
        replace(result, terminal_state=GateState.FAIL),
        replace(
            result,
            trials=replace(trials, multiplicity_state=GateState.FAIL),
        ),
        replace(result, trials=replace(trials, pbo_state=GateState.FAIL)),
        replace(
            result,
            trials=replace(trials, global_test_state=GateState.FAIL),
        ),
        replace(result, trials=replace(trials, dsr_state=GateState.FAIL)),
        replace(result, holdout=replace(result.holdout, state=GateState.FAIL)),
        replace(
            result,
            economics=replace(economics, actual_fee_state=GateState.FAIL),
        ),
        replace(
            result,
            economics=replace(economics, cost_complete_state=GateState.FAIL),
        ),
        replace(
            result,
            economics=replace(economics, maker_entry_state=GateState.FAIL),
        ),
        replace(
            result,
            economics=replace(economics, regime_coverage_state=GateState.FAIL),
        ),
    )

    for failed_result in cases:
        assert assess_candidate(registry, family, failed_result).status is DecisionState.NO_GO


def test_required_gate_unknown_and_unmeasured_are_unknown() -> None:
    registry, family, result = _single_candidate()

    for state in (GateState.UNKNOWN, GateState.UNMEASURED):
        trials = result.trials
        economics = result.economics
        cases = (
            replace(result, terminal_state=state),
            replace(result, trials=replace(trials, multiplicity_state=state)),
            replace(result, trials=replace(trials, pbo_state=state)),
            replace(result, trials=replace(trials, global_test_state=state)),
            replace(result, trials=replace(trials, dsr_state=state)),
            replace(result, holdout=replace(result.holdout, state=state)),
            replace(result, economics=replace(economics, actual_fee_state=state)),
            replace(result, economics=replace(economics, cost_complete_state=state)),
            replace(result, economics=replace(economics, maker_entry_state=state)),
            replace(
                result,
                economics=replace(economics, regime_coverage_state=state),
            ),
        )

        for incomplete_result in cases:
            assert (
                assess_candidate(registry, family, incomplete_result).status
                is DecisionState.UNKNOWN
            )


def test_required_holdout_nulls_are_unknown() -> None:
    registry, family, result = _single_candidate()
    holdout = result.holdout
    cases = (
        replace(result, holdout=replace(holdout, single_use=None)),
        replace(result, holdout=replace(holdout, opened_after_freeze=None)),
        replace(
            result,
            holdout=replace(holdout, selection_inside_evaluation=None),
        ),
        replace(result, holdout=replace(holdout, reuse_count=None)),
    )

    for incomplete_result in cases:
        assert assess_candidate(registry, family, incomplete_result).status is DecisionState.UNKNOWN


def test_each_required_metric_unknown_or_not_estimable_is_unknown() -> None:
    registry, family, result = _single_candidate()

    for state in (MetricState.UNKNOWN, MetricState.NOT_ESTIMABLE):
        missing = MetricV1(state=state, value=None)
        economics = result.economics
        cases = (
            replace(result, economics=replace(economics, net=missing)),
            replace(result, holdout=replace(result.holdout, lower_bound=missing)),
            replace(result, economics=replace(economics, stress_net=missing)),
            replace(result, economics=replace(economics, capacity_usd=missing)),
            replace(
                result,
                economics=replace(economics, max_drawdown_bps=missing),
            ),
        )

        for incomplete_result in cases:
            assert (
                assess_candidate(registry, family, incomplete_result).status
                is DecisionState.UNKNOWN
            )


def test_observed_count_mismatch_is_unknown() -> None:
    registry, family, result = _single_candidate()
    mismatched_result = replace(
        result,
        trials=replace(
            result.trials,
            observed_count=family.trial_count - 1,
        ),
    )

    assert assess_candidate(registry, family, mismatched_result).status is DecisionState.UNKNOWN


def test_known_wrong_evidence_class_is_no_go() -> None:
    registry, family, result = _single_candidate()
    mismatched_result = replace(
        result,
        holdout=replace(
            result.holdout,
            evidence_class=EvidenceClass.HISTORICAL_VALIDATION,
        ),
    )

    assessment = assess_candidate(registry, family, mismatched_result)

    assert assessment.status is DecisionState.NO_GO
    assert assessment.reason_codes == ("HOLDOUT_EVIDENCE_CLASS_MISMATCH",)


def test_frozen_declared_count_and_ledger_binding_mismatches_raise_upstream() -> None:
    registry, family, result = _single_candidate()
    trials = result.trials
    cases = (
        replace(
            result,
            trials=replace(
                trials,
                declared_count=family.trial_count - 1,
                observed_count=family.trial_count - 1,
            ),
        ),
        replace(result, trials=replace(trials, ledger_sha256=_digest(999))),
    )

    for mismatched_result in cases:
        with pytest.raises(ContractValueError):
            assess_candidate(registry, family, mismatched_result)


def test_candidate_must_be_a_frozen_registry_family_member() -> None:
    registry, family, result = _single_candidate()

    with pytest.raises(
        ContractValueError,
        match="result candidate is not in the frozen registry family",
    ):
        assess_candidate(
            registry,
            family,
            replace(result, candidate_id="CANDIDATE_NOT_FROZEN"),
        )


def test_known_holdout_integrity_violations_are_no_go() -> None:
    registry, family, result = _single_candidate()
    holdout = result.holdout
    cases = (
        replace(result, holdout=replace(holdout, single_use=False)),
        replace(result, holdout=replace(holdout, opened_after_freeze=False)),
        replace(
            result,
            holdout=replace(holdout, selection_inside_evaluation=False),
        ),
        replace(
            result,
            holdout=replace(holdout, single_use=False, reuse_count=2),
        ),
    )

    for invalid_result in cases:
        assert assess_candidate(registry, family, invalid_result).status is DecisionState.NO_GO


def test_unknown_evidence_dominates_a_known_failure_within_candidate() -> None:
    registry, family, result = _single_candidate()
    failed_and_unknown = replace(
        result,
        terminal_state=GateState.UNKNOWN,
        trials=replace(result.trials, pbo_state=GateState.UNMEASURED),
        economics=replace(
            result.economics,
            net=MetricV1(state=MetricState.UNKNOWN, value=None),
            cost_complete_state=GateState.FAIL,
        ),
    )

    assessment = assess_candidate(registry, family, failed_and_unknown)

    assert assessment.status is DecisionState.UNKNOWN
    assert "COST_COMPLETE_FAIL" in assessment.reason_codes
    assert "NET_UNKNOWN" in assessment.reason_codes
    assert "PBO_UNMEASURED" in assessment.reason_codes
    assert "TERMINAL_UNKNOWN" in assessment.reason_codes


def test_mandatory_policy_gates_cannot_be_disabled() -> None:
    with pytest.raises(ContractValueError):
        replace(_policy(), actual_fee_required=False)
    with pytest.raises(ContractValueError):
        replace(_policy(), maker_entry_required=False)
    with pytest.raises(ContractValueError):
        replace(_policy(), pbo_required=False)
    with pytest.raises(ContractValueError):
        replace(_policy(), global_test_required=False)
    with pytest.raises(ContractValueError):
        replace(_policy(), dsr_required=False)


def test_source_reason_codes_always_block_verified_positive() -> None:
    registry, family, result = _single_candidate()

    assessment = assess_candidate(
        registry,
        family,
        replace(result, reason_codes=("SOURCE_CAVEAT_PRESENT",)),
    )

    assert assessment.status is DecisionState.UNKNOWN
    assert assessment.reason_codes == ("SOURCE_REASON_CODES_PRESENT",)
    assert assessment.source_reason_codes == ("SOURCE_CAVEAT_PRESENT",)


def _accepted_pin(
    role: ArtifactRole,
    raw_sha256: DigestV1,
    seed: int,
) -> ArtifactPinV1:
    return ArtifactPinV1(
        role=role,
        raw_sha256=raw_sha256,
        byte_length=256,
        producer_commit=GitOidV1(f"{seed + 1:040x}"),
        producer_tree=GitOidV1(f"{seed + 2:040x}"),
        relative_path=f"quant/research/n3i1/{role.value}.json",
        acceptance=AcceptanceState.ACCEPTED,
        acceptance_sha256=_digest(seed + 3),
    )


def _full_batch() -> tuple[
    RegistryV1,
    ArtifactPinV1,
    dict[PacketRole, ArtifactPinV1],
    dict[PacketRole, ResultPacketV1],
]:
    families = tuple(_family(role, index + 1) for index, role in enumerate(PACKET_ROLE_ORDER))
    registry = _registry(*families)
    results: dict[PacketRole, ResultPacketV1] = {}
    result_pins: dict[PacketRole, ArtifactPinV1] = {}
    for index, family in enumerate(families):
        seed = 10 + (index * 10)
        result = _result(registry, family, seed)
        if index > 0:
            result = replace(result, terminal_state=GateState.FAIL)
        results[family.packet_role] = result
        result_pins[family.packet_role] = _accepted_pin(
            ArtifactRole(family.packet_role.value),
            result.raw_sha256,
            300 + index,
        )
    registry_pin = _accepted_pin(
        ArtifactRole.S_META1,
        registry.raw_sha256,
        200,
    )
    return registry, registry_pin, result_pins, results


def _nonaccepted_pin(
    pin: ArtifactPinV1,
    acceptance: AcceptanceState,
) -> ArtifactPinV1:
    return replace(
        pin,
        acceptance=acceptance,
        acceptance_sha256=None,
    )


def _replace_result_pin(
    result_pins: dict[PacketRole, ArtifactPinV1],
    role: PacketRole,
    pin: ArtifactPinV1,
) -> dict[PacketRole, ArtifactPinV1]:
    replaced = dict(result_pins)
    replaced[role] = pin
    return replaced


def test_no_go_peer_does_not_hide_a_separate_verified_positive() -> None:
    registry, registry_pin, result_pins, results = _full_batch()
    reverse_order_results = dict(reversed(tuple(results.items())))

    decision = _aggregate_results(
        registry,
        reverse_order_results,
        registry_pin,
        result_pins,
    )

    assert decision.status is DecisionState.VERIFIED_POSITIVE
    assert decision.credible_positive_count == 1
    assert tuple(item.role for item in decision.assessments) == PACKET_ROLE_ORDER
    assert decision.authority == "NONE"


def test_pending_acceptance_makes_batch_unknown() -> None:
    registry, registry_pin, result_pins, results = _full_batch()

    registry_unknown = _aggregate_results(
        registry,
        results,
        _nonaccepted_pin(registry_pin, AcceptanceState.PENDING),
        result_pins,
    )
    assert registry_unknown.status is DecisionState.UNKNOWN
    assert registry_unknown.credible_positive_count is None
    assert "REGISTRY_ACCEPTANCE_PENDING" in registry_unknown.reason_codes

    for role in PACKET_ROLE_ORDER:
        pending_results = dict(result_pins)
        pending_results[role] = _nonaccepted_pin(
            pending_results[role],
            AcceptanceState.PENDING,
        )
        result_unknown = _aggregate_results(
            registry,
            results,
            registry_pin,
            pending_results,
        )
        assert result_unknown.status is DecisionState.UNKNOWN
        assert result_unknown.credible_positive_count is None
        assert f"{role.value}_ACCEPTANCE_PENDING" in result_unknown.reason_codes


def test_unknown_assessment_makes_accepted_batch_unknown() -> None:
    registry, registry_pin, result_pins, results = _full_batch()
    family = registry.families[2]
    unknown_result = replace(
        _result(registry, family, 30),
        economics=replace(
            _result(registry, family, 30).economics,
            capacity_usd=MetricV1(state=MetricState.NOT_ESTIMABLE, value=None),
        ),
        raw_sha256=_digest(800),
        semantic_sha256=_digest(801),
    )
    results_with_unknown = dict(results)
    results_with_unknown[family.packet_role] = unknown_result
    pins_with_unknown = _replace_result_pin(
        result_pins,
        family.packet_role,
        _accepted_pin(
            ArtifactRole(family.packet_role.value),
            unknown_result.raw_sha256,
            800,
        ),
    )

    decision = _aggregate_results(
        registry,
        results_with_unknown,
        registry_pin,
        pins_with_unknown,
    )

    assert decision.status is DecisionState.UNKNOWN
    assert decision.credible_positive_count is None


def test_all_accepted_with_no_positive_is_no_go_zero() -> None:
    registry, registry_pin, result_pins, results = _full_batch()
    family = registry.families[0]
    no_go_result = replace(
        _result(registry, family, 10),
        economics=replace(
            _result(registry, family, 10).economics,
            net=_measured(family.policy.minimum_net_microusd_per_1000 - 1),
        ),
    )
    results_without_positive = dict(results)
    results_without_positive[family.packet_role] = no_go_result

    decision = _aggregate_results(
        registry,
        results_without_positive,
        registry_pin,
        result_pins,
    )

    assert decision.status is DecisionState.NO_GO
    assert decision.credible_positive_count == 0
    assert decision.reason_codes == ("NO_CREDIBLE_POSITIVE",)


def test_mixed_fail_and_unknown_cannot_promote_a_positive_peer() -> None:
    registry, registry_pin, result_pins, results = _full_batch()
    mixed_role = PacketRole.S1C
    mixed_result = results[mixed_role]
    mixed_result = replace(
        mixed_result,
        economics=replace(
            mixed_result.economics,
            net=MetricV1(state=MetricState.UNKNOWN, value=None),
        ),
    )
    results_with_mixed = dict(results)
    results_with_mixed[mixed_role] = mixed_result

    decision = _aggregate_results(
        registry,
        results_with_mixed,
        registry_pin,
        result_pins,
    )

    mixed_assessment = next(
        assessment for assessment in decision.assessments if assessment.role is mixed_role
    )
    assert mixed_assessment.status is DecisionState.UNKNOWN
    assert "TERMINAL_FAIL" in mixed_assessment.reason_codes
    assert "NET_UNKNOWN" in mixed_assessment.reason_codes
    assert decision.status is DecisionState.UNKNOWN
    assert decision.credible_positive_count is None


def test_assessment_aggregator_symbol_is_removed() -> None:
    assert not hasattr(decision_module, "aggregate_decision")
