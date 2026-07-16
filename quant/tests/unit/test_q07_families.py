from __future__ import annotations

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
    amihud_illiquidity_feature,
    band_flow_feature,
    book_slope_imbalance_feature,
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

ALL_FEATURE_FACTORIES = (
    absorption_ratio_feature,
    amihud_illiquidity_feature,
    band_flow_feature,
    book_slope_imbalance_feature,
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

        assert len(library_ids) == 16
        assert table_ids == library_ids

    def test_unimplemented_families_name_their_reason(self) -> None:
        blocked = [
            record
            for record in SECTION_13_1_DISPOSITIONS
            if record.disposition
            in (FamilyDisposition.BLOCKED_DATA, FamilyDisposition.REFERENCE_ONLY)
        ]

        assert len(blocked) == 4
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
