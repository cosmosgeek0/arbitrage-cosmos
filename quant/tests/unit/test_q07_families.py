from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1
from quant_edge.lake.contracts import DigestV1, ExactScaledValueV1
from quant_edge.micro import (
    SECTION_13_1_DISPOSITIONS,
    FamilyDisposition,
    FamilyRecordV1,
    MicroEquivalenceReportV1,
    MicroFeatureImplementationV1,
    TopOfBookPointV1,
    absorption_ratio_feature,
    activity_surprise_feature,
    add_intensity_feature,
    amihud_illiquidity_feature,
    band_flow_feature,
    book_slope_imbalance_feature,
    cancel_intensity_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    disposition_table_digest,
    effective_spread_feature,
    kyle_slope_feature,
    l1_queue_imbalance_feature,
    micro_vector_digest,
    microprice_displacement_feature,
    ofi_l1_feature,
    run_micro_equivalence,
    signed_trade_imbalance_feature,
    size_concentration_hhi_feature,
    spoof_pattern_semantics,
    trade_dispersion_feature,
    trade_intensity_feature,
    vwap_spread_at_size_feature,
)
from quant_edge.micro.activity import (
    MAX_ACTIVITY_HORIZONS,
    MAX_ACTIVITY_OBSERVATIONS,
    ActivityHorizonV1,
    ActivityObservationV1,
    ActivityState,
    activity_transitions,
)

ALL_FEATURE_FACTORIES = (
    absorption_ratio_feature,
    activity_surprise_feature,
    add_intensity_feature,
    amihud_illiquidity_feature,
    band_flow_feature,
    book_slope_imbalance_feature,
    cancel_intensity_feature,
    cumulative_band_imbalance_feature,
    depth_resiliency_feature,
    effective_spread_feature,
    kyle_slope_feature,
    l1_queue_imbalance_feature,
    microprice_displacement_feature,
    ofi_l1_feature,
    signed_trade_imbalance_feature,
    size_concentration_hhi_feature,
    trade_dispersion_feature,
    trade_intensity_feature,
    vwap_spread_at_size_feature,
)


def _activity_observation(
    ordinal: int,
    activity: int | None,
    *,
    spread: int | None = 2,
    depth: int | None = 100,
    peer: int | None = 10,
) -> ActivityObservationV1:
    return ActivityObservationV1(
        observation_id=f"activity-{ordinal}",
        event_time_ns=1_772_000_000_000_000_000 + ordinal,
        ordinal=ordinal,
        trades=None if activity is None else activity // 2,
        quote_updates=None if activity is None else activity - activity // 2,
        spread_ticks=spread,
        bid_depth=None if depth is None else depth // 2,
        ask_depth=None if depth is None else depth - depth // 2,
        peer_activity=peer,
    )


def _activity_horizon(horizon_id: str = "fast") -> ActivityHorizonV1:
    return ActivityHorizonV1(
        horizon_id=horizon_id,
        lookback=3,
        surprise_numerator=2,
        surprise_denominator=1,
        persistence_prints=2,
        controlled_spread_ticks=2,
    )


class TestActivityTransitionFamily:
    def test_contracts_reject_bad_thresholds_and_order(self) -> None:
        with pytest.raises(ContractValueError, match="greater than one"):
            ActivityHorizonV1("fast", 3, 1, 1, 2, 2)
        with pytest.raises(ContractValueError, match="strictly chronological"):
            activity_transitions(
                (_activity_observation(1, 10), _activity_observation(1, 10)),
                (_activity_horizon(),),
            )
        with pytest.raises(ContractValueError, match="sorted and unique"):
            activity_transitions(
                (_activity_observation(0, 10),),
                (_activity_horizon("slow"), _activity_horizon("fast")),
            )

    def test_capacity_identity_gap_and_element_type_fail_closed(self) -> None:
        over_observations = tuple(
            _activity_observation(index, 10) for index in range(MAX_ACTIVITY_OBSERVATIONS + 1)
        )
        with pytest.raises(ContractValueError, match="bounded at 4096"):
            activity_transitions(over_observations, (_activity_horizon(),))

        over_horizons = tuple(
            _activity_horizon(f"horizon-{index:02d}") for index in range(MAX_ACTIVITY_HORIZONS + 1)
        )
        with pytest.raises(ContractValueError, match="bounded at 32"):
            activity_transitions((_activity_observation(0, 10),), over_horizons)

        with pytest.raises(ContractValueError, match="gap-free"):
            activity_transitions(
                (_activity_observation(0, 10), _activity_observation(2, 10)),
                (_activity_horizon(),),
            )
        with pytest.raises(ContractValueError, match="identifiers must be unique"):
            activity_transitions(
                (
                    _activity_observation(0, 10),
                    replace(_activity_observation(1, 10), observation_id="activity-0"),
                ),
                (_activity_horizon(),),
            )
        with pytest.raises(ContractValueError, match="ActivityHorizonV1"):
            activity_transitions(
                (_activity_observation(0, 10),),
                (object(),),  # type: ignore[arg-type]
            )

    def test_one_print_wake_persistence_and_fade_are_distinct(self) -> None:
        observations = tuple(
            _activity_observation(index, activity, spread=spread, depth=depth)
            for index, (activity, spread, depth) in enumerate(
                (
                    (10, 3, 100),
                    (10, 3, 100),
                    (10, 3, 100),
                    (50, 2, 130),
                    (100, 2, 150),
                    (200, 2, 170),
                    (10, 2, 170),
                )
            )
        )

        states = tuple(
            transition.state
            for transition in activity_transitions(observations, (_activity_horizon(),))
        )

        assert states == (
            ActivityState.WARMUP,
            ActivityState.WARMUP,
            ActivityState.WARMUP,
            ActivityState.ONE_PRINT_REJECTED,
            ActivityState.WAKE,
            ActivityState.PERSISTENT,
            ActivityState.FADING,
        )

    def test_spread_control_compression_liquidity_and_peer_abnormality(self) -> None:
        observations = tuple(
            _activity_observation(index, activity, spread=spread, depth=depth, peer=peer)
            for index, (activity, spread, depth, peer) in enumerate(
                ((10, 4, 100, 10), (10, 4, 100, 10), (10, 4, 100, 10), (50, 2, 150, 10))
            )
        )

        result = activity_transitions(observations, (_activity_horizon(),))[-1]

        assert result.controlled_spread is True
        assert result.compression is True
        assert result.liquidity_arrival is not None
        assert result.peer_abnormality is not None
        assert (result.liquidity_arrival.numerator, result.liquidity_arrival.denominator) == (1, 2)
        assert (result.peer_abnormality.numerator, result.peer_abnormality.denominator) == (5, 1)

    def test_missing_and_zero_baseline_truth_stays_unknown(self) -> None:
        observations = (
            *(_activity_observation(index, 0) for index in range(3)),
            _activity_observation(3, 50),
            _activity_observation(4, None, spread=None, depth=None, peer=None),
        )

        results = activity_transitions(observations, (_activity_horizon(),))

        assert results[3].state is ActivityState.UNKNOWN
        assert results[3].surprise is None
        assert results[4].state is ActivityState.UNKNOWN
        assert results[4].controlled_spread is None
        assert results[4].liquidity_arrival is None
        assert results[4].peer_abnormality is None

    def test_multi_horizon_output_is_prior_only_and_deterministic(self) -> None:
        prefix = tuple(_activity_observation(index, 10) for index in range(4))
        first = (*prefix, _activity_observation(4, 50))
        second = (*prefix, _activity_observation(4, 5_000))
        horizons = (
            _activity_horizon("fast"),
            ActivityHorizonV1("slow", 4, 2, 1, 2, 2),
        )

        left = activity_transitions(first, horizons)
        right = activity_transitions(first, horizons)
        changed_future = activity_transitions(second, horizons)

        assert left == right
        assert left[:4] == changed_future[:4]
        assert left[5:9] == changed_future[5:9]


def _record(
    *,
    disposition: FamilyDisposition = FamilyDisposition.ADOPT,
    features: tuple[str, ...] = ("ofi_l1:v1",),
    bullet: str = "a bullet",
    reason: str = "a reason",
) -> FamilyRecordV1:
    return FamilyRecordV1(
        bullet_id="13.1-99-test",
        bullet=bullet,
        disposition=disposition,
        reason=reason,
        implemented_features=features,
    )


class TestFamilyRecordContract:
    def test_contract_violations(self) -> None:
        with pytest.raises(ContractValueError):
            _record(bullet="  ")
        with pytest.raises(ContractValueError):
            _record(reason="")
        with pytest.raises(ContractValueError):
            _record(disposition="ADOPT")  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            _record(features=("z:v1", "a:v1"))  # unsorted
        with pytest.raises(ContractValueError):
            _record(disposition=FamilyDisposition.REJECT)  # features without adoption
        with pytest.raises(ContractValueError):
            _record(disposition=FamilyDisposition.ADAPT, features=())

    def test_mapping_shape(self) -> None:
        mapping = _record().as_mapping()

        assert mapping == {
            "bullet": "a bullet",
            "bulletId": "13.1-99-test",
            "disposition": "ADOPT",
            "implementedFeatures": ["ofi_l1:v1"],
            "reason": "a reason",
        }


class TestSection131Table:
    def test_every_bullet_is_answered_once(self) -> None:
        assert len(SECTION_13_1_DISPOSITIONS) == 17
        ordinals = [record.bullet_id.split("-")[1] for record in SECTION_13_1_DISPOSITIONS]
        assert ordinals == [f"{index:02d}" for index in range(1, 18)]

    def test_implemented_features_match_the_library_exactly(self) -> None:
        library_ids = {factory().card.feature_id for factory in ALL_FEATURE_FACTORIES}
        table_ids = {
            feature_id
            for record in SECTION_13_1_DISPOSITIONS
            for feature_id in record.implemented_features
        }

        assert len(library_ids) == 19
        assert table_ids == library_ids

    def test_unimplemented_families_name_their_reason(self) -> None:
        blocked = [
            record
            for record in SECTION_13_1_DISPOSITIONS
            if record.disposition
            in (FamilyDisposition.BLOCKED_DATA, FamilyDisposition.REFERENCE_ONLY)
        ]

        assert len(blocked) == 3
        for record in blocked:
            assert not record.implemented_features
            assert len(record.reason) > 20

    def test_digest_is_deterministic(self) -> None:
        first = disposition_table_digest()
        second = disposition_table_digest()

        assert isinstance(first, DigestV1)
        assert first == second

    def test_spoof_semantics_never_claim_intent(self) -> None:
        semantics = spoof_pattern_semantics()

        assert "possible_spoof_like_pattern" in semantics
        assert "never attribute individual intent" in semantics


class TestImplementationContract:
    def test_contract_violations(self) -> None:
        good = ofi_l1_feature()
        with pytest.raises(ContractValueError):
            MicroFeatureImplementationV1(
                card="card",  # type: ignore[arg-type]
                batch=good.batch,
                make_streaming=good.make_streaming,
                declared_max_update_ops=1,
            )
        with pytest.raises(ContractValueError):
            MicroFeatureImplementationV1(
                card=good.card,
                batch="batch",  # type: ignore[arg-type]
                make_streaming=good.make_streaming,
                declared_max_update_ops=1,
            )
        with pytest.raises(ContractValueError):
            MicroFeatureImplementationV1(
                card=good.card,
                batch=good.batch,
                make_streaming=good.make_streaming,
                declared_max_update_ops=0,
            )

    def test_every_card_is_complete_and_bound(self) -> None:
        for factory in ALL_FEATURE_FACTORIES:
            implementation = factory()
            card = implementation.card
            assert card.version == "v1"
            assert card.equivalence_tolerance_ulp == 0
            assert card.test_binding.startswith("tests.unit.test_q07_")
            assert implementation.declared_max_update_ops >= 1

    def test_activity_surprise_is_canonical_and_batch_streaming_equivalent(self) -> None:
        observations = tuple(
            ActivityObservationV1(
                observation_id=f"feature-{index}",
                event_time_ns=1_772_000_000_000_000_000 + index,
                ordinal=index,
                trades=1 if index < 4 else 8,
                quote_updates=1 if index < 4 else 8,
                spread_ticks=1,
                bid_depth=100,
                ask_depth=100,
                peer_activity=2,
            )
            for index in range(6)
        )

        report = run_micro_equivalence(activity_surprise_feature(), observations)

        assert report.feature_id == "activity_surprise:v1"
        assert report.passed
        assert report.compared_values == 2
        assert report.max_update_ops == 1


class TestEquivalenceReportContract:
    def test_report_laws(self) -> None:
        digest = micro_vector_digest((None,))
        base = {
            "feature_id": "ofi_l1:v1",
            "items": 4,
            "compared_values": 3,
            "status_mismatches": 0,
            "max_ulp_deviation": 0,
            "tolerance_ulp": 0,
            "max_update_ops": 1,
            "declared_max_update_ops": 1,
            "passed": True,
            "streaming_vector_digest": digest,
        }
        report = MicroEquivalenceReportV1(**base)  # type: ignore[arg-type]
        assert report.as_mapping()["streamingVectorSha256"] == digest.hexdigest

        with pytest.raises(ContractValueError):
            MicroEquivalenceReportV1(**{**base, "passed": False})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            MicroEquivalenceReportV1(**{**base, "max_ulp_deviation": 1})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            MicroEquivalenceReportV1(**{**base, "max_update_ops": 2})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            MicroEquivalenceReportV1(**{**base, "items": -1})  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            MicroEquivalenceReportV1(
                **{**base, "streaming_vector_digest": "digest"}  # type: ignore[arg-type]
            )

    def test_runner_contract_violations(self) -> None:
        with pytest.raises(ContractValueError):
            run_micro_equivalence("implementation", ())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            run_micro_equivalence(ofi_l1_feature(), [])  # type: ignore[arg-type]

    def test_runner_counts_status_mismatches(self) -> None:
        honest = l1_queue_imbalance_feature()
        lying: MicroFeatureImplementationV1[TopOfBookPointV1] = MicroFeatureImplementationV1(
            card=honest.card,
            batch=lambda items: None,
            make_streaming=honest.make_streaming,
            declared_max_update_ops=1,
        )
        point = TopOfBookPointV1(
            event_time_ns=1_772_000_000_000_000_000,
            ordinal=1,
            bid_price=ExactScaledValueV1(coefficient=10_000, scale=2, unit_id="USDT"),
            bid_size=ExactScaledValueV1(coefficient=500, scale=2, unit_id="USDT"),
            ask_price=ExactScaledValueV1(coefficient=10_010, scale=2, unit_id="USDT"),
            ask_size=ExactScaledValueV1(coefficient=300, scale=2, unit_id="USDT"),
        )

        report = run_micro_equivalence(lying, (point, point))

        assert not report.passed
        assert report.status_mismatches == 2
        assert report.compared_values == 0

    def test_vector_digest_separates_vectors(self) -> None:
        empty = micro_vector_digest(())
        with_none = micro_vector_digest((None,))
        with_value = micro_vector_digest((FixedPointV1(1),))

        assert len({empty.hexdigest, with_none.hexdigest, with_value.hexdigest}) == 3
