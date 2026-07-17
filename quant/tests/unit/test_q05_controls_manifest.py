from __future__ import annotations

import pytest

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.errors import ContractValueError
from quant_edge.labels.controls import (
    ControlMatchResultV1,
    ControlMatchSpecV1,
    WindowFactsV1,
    match_controls,
)
from quant_edge.labels.disposition import (
    WindowQualityFactsV1,
    derive_disposition,
)
from quant_edge.labels.identity import SampleIdentityV1, VersionSetV1, make_sample_identity
from quant_edge.labels.manifest import (
    GroupWindowV1,
    LabelManifestV1,
    ManifestMemberV1,
    ObjectiveOutcomeReferenceV1,
    assign_evaluation_groups,
    build_label_manifest,
    make_manifest_member,
    outcome_reference,
)
from quant_edge.labels.outcomes import (
    BarrierSpecV1,
    CostScenarioV1,
    OutcomeDefinitionV1,
    SampleOutcomesV1,
    compute_sample_outcomes,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import EvidenceSeriesV1, PricePointV1, SeriesKind
from quant_edge.labels.stages import (
    StageDefinitionV1,
    StageEvidenceV1,
    generate_stage,
)
from quant_edge.lake.contracts import (
    EvidencePosture,
    ExactScaledValueV1,
    InstrumentIdentityV1,
)
from quant_edge.lake.governance import (
    OutcomeVisibility,
    OwnerAnnotationCohort,
    OwnerAnnotationOutcomeLinkV1,
    OwnerAnnotationTag,
    OwnerAnnotationV1,
    VisibleEvidenceRefV1,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000

MARKET_IDENTITY = InstrumentIdentityV1(
    instrument_id="test-binance-spot-BNBUSDT",
    base_size_unit_id="BNB",
    quote_price_unit_id="USDT",
)
DAY_NS = 86_400_000_000_000


def _scaled(coefficient: int, scale: int = 2) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=scale, unit_id="USDT")


def _instrument() -> PointInTimeInstrumentV1:
    return PointInTimeInstrumentV1(
        venue="binance",
        product="spot",
        symbol="BNBUSDT",
        base_asset_id="UNKNOWN_BASE",
        quote_asset_id="UNKNOWN_QUOTE",
        instrument_version="archive-v1",
        observed_at_ns=BASE_NS,
        missing_identity_fields=("base_asset_id", "quote_asset_id"),
    )


def _sample() -> SampleIdentityV1:
    return make_sample_identity(
        event_id="event-1",
        cohort_id="cohort-1",
        instrument=_instrument(),
        feature_lookback_start_ns=BASE_NS - 60 * SECOND_NS,
        feature_cutoff_ns=BASE_NS,
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + 3_600 * SECOND_NS,
        source_completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        source_completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        versions=VersionSetV1(
            dataset_version="ds-v1",
            feature_version="feat-v1",
            label_definition_version="label-v1",
            cost_assumption_version="cost-v1",
            execution_assumption_version="exec-v1",
        ),
    )


def _facts(
    window_id: str,
    *,
    symbol: str = "BNBUSDT",
    start_offset_s: int = -90_000,
    duration_s: int = 600,
    row_count: int = 120,
    range_num: int = 1,
    range_den: int = 100,
    regime_id: str = "regime-a",
    completeness_known: bool = True,
    gap_row_count: int = 0,
) -> WindowFactsV1:
    start = BASE_NS + start_offset_s * SECOND_NS
    return WindowFactsV1(
        window_id=window_id,
        symbol=symbol,
        window_start_ns=start,
        window_end_ns=start + duration_s * SECOND_NS,
        row_count=row_count,
        value_range_ratio=make_ratio(range_num, range_den),
        regime_id=regime_id,
        completeness_known=completeness_known,
        gap_row_count=gap_row_count,
    )


def _spec(max_controls: int = 4) -> ControlMatchSpecV1:
    return ControlMatchSpecV1(
        match_version="match-v1",
        liquidity_bucket_edges=(10, 100, 1_000),
        volatility_bucket_edges=(make_ratio(1, 200), make_ratio(1, 20)),
        time_of_day_bucket_ns=DAY_NS // 24,
        funding_cycle_ns=DAY_NS // 3,
        max_controls=max_controls,
    )


def _candidate_facts() -> WindowFactsV1:
    return _facts("candidate-1", start_offset_s=-90_000)


def _aligned_offset(days_back: int) -> int:
    """Offsets that keep the same time-of-day and funding-cycle buckets."""

    return -90_000 - days_back * 86_400


class TestControlMatching:
    def test_matching_axes_and_determinism(self) -> None:
        sample = _sample()
        candidate = _candidate_facts()
        pool = (
            _facts("pool-d", start_offset_s=_aligned_offset(1)),
            _facts("pool-a", start_offset_s=_aligned_offset(2)),
            _facts("pool-symbol", symbol="ETHUSDT", start_offset_s=_aligned_offset(3)),
            _facts("pool-liquidity", row_count=5_000, start_offset_s=_aligned_offset(4)),
            _facts("pool-volatility", range_num=1, range_den=10, start_offset_s=_aligned_offset(5)),
            _facts("pool-regime", regime_id="regime-b", start_offset_s=_aligned_offset(6)),
            _facts("pool-time", start_offset_s=_aligned_offset(1) + 7_200),
            _facts("pool-gapped", gap_row_count=3, start_offset_s=_aligned_offset(7)),
            _facts("pool-unknown", completeness_known=False, start_offset_s=_aligned_offset(8)),
            _facts("pool-overlap", start_offset_s=-30, duration_s=7_200),
        )

        result = match_controls(sample, candidate, pool, _spec())

        assert result.selected_window_ids == ("pool-a", "pool-d")
        rejections = dict(result.rejection_counts)
        assert rejections["SYMBOL_MISMATCH"] == 1
        assert rejections["LIQUIDITY_BUCKET_MISMATCH"] == 1
        assert rejections["VOLATILITY_BUCKET_MISMATCH"] == 1
        assert rejections["REGIME_MISMATCH"] == 1
        assert rejections["INCOMPLETE_EVIDENCE"] == 2
        assert rejections["OVERLAPS_FEATURE_OR_LABEL_INTERVAL"] == 1
        assert rejections["TIME_OF_DAY_MISMATCH"] + rejections["FUNDING_CYCLE_MISMATCH"] == 1
        again = match_controls(sample, candidate, pool, _spec())
        assert again.result_digest == result.result_digest

    def test_selection_is_bounded_and_sorted(self) -> None:
        sample = _sample()
        pool = tuple(
            _facts(f"pool-{index:02d}", start_offset_s=_aligned_offset(index + 1))
            for index in range(6)
        )

        result = match_controls(sample, _candidate_facts(), pool, _spec(max_controls=3))

        assert result.selected_window_ids == ("pool-00", "pool-01", "pool-02")

    def test_no_future_membership_field_exists(self) -> None:
        assert "future" not in {field.lower() for field in WindowFactsV1.__dataclass_fields__}
        assert "event" not in {
            field.lower().split("_")[0] for field in WindowFactsV1.__dataclass_fields__
        }

    def test_input_contracts(self) -> None:
        sample = _sample()
        with pytest.raises(ContractValueError):
            match_controls("sample", _candidate_facts(), (), _spec())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            match_controls(sample, "candidate", (), _spec())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            match_controls(sample, _facts("candidate", symbol="ETHUSDT"), (), _spec())
        with pytest.raises(ContractValueError):
            match_controls(sample, _candidate_facts(), [()], _spec())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            match_controls(sample, _candidate_facts(), ("window",), _spec())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            match_controls(sample, _candidate_facts(), (), "spec")  # type: ignore[arg-type]
        duplicate = _facts("pool-dup", start_offset_s=_aligned_offset(1))
        with pytest.raises(ContractValueError):
            match_controls(sample, _candidate_facts(), (duplicate, duplicate), _spec())

    def test_spec_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            _spec(max_controls=0)
        with pytest.raises(ContractValueError):
            ControlMatchSpecV1(
                match_version="v1",
                liquidity_bucket_edges=(),
                volatility_bucket_edges=(make_ratio(1, 2),),
                time_of_day_bucket_ns=DAY_NS,
                funding_cycle_ns=DAY_NS,
                max_controls=1,
            )
        with pytest.raises(ContractValueError):
            ControlMatchSpecV1(
                match_version="v1",
                liquidity_bucket_edges=(10, 10),
                volatility_bucket_edges=(make_ratio(1, 2),),
                time_of_day_bucket_ns=DAY_NS,
                funding_cycle_ns=DAY_NS,
                max_controls=1,
            )
        with pytest.raises(ContractValueError):
            ControlMatchSpecV1(
                match_version="v1",
                liquidity_bucket_edges=(10,),
                volatility_bucket_edges=(make_ratio(1, 2), make_ratio(1, 2)),
                time_of_day_bucket_ns=DAY_NS,
                funding_cycle_ns=DAY_NS,
                max_controls=1,
            )
        with pytest.raises(ContractValueError):
            ControlMatchSpecV1(
                match_version="v1",
                liquidity_bucket_edges=(10,),
                volatility_bucket_edges=(make_ratio(-1, 2),),
                time_of_day_bucket_ns=DAY_NS,
                funding_cycle_ns=DAY_NS,
                max_controls=1,
            )
        with pytest.raises(ContractValueError):
            ControlMatchSpecV1(
                match_version="v1",
                liquidity_bucket_edges=(10,),
                volatility_bucket_edges=(make_ratio(1, 2),),
                time_of_day_bucket_ns=7,
                funding_cycle_ns=DAY_NS,
                max_controls=1,
            )

    def test_window_facts_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            _facts("w", duration_s=0)
        with pytest.raises(ContractValueError):
            _facts("w", row_count=-1)
        with pytest.raises(ContractValueError):
            _facts("w", range_num=-1)
        with pytest.raises(ContractValueError):
            WindowFactsV1(
                window_id="w",
                symbol="BNBUSDT",
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + SECOND_NS,
                row_count=1,
                value_range_ratio="wide",  # type: ignore[arg-type]
                regime_id="regime-a",
                completeness_known=True,
                gap_row_count=0,
            )
        with pytest.raises(ContractValueError):
            WindowFactsV1(
                window_id="w",
                symbol="BNBUSDT",
                window_start_ns=BASE_NS,
                window_end_ns=BASE_NS + SECOND_NS,
                row_count=1,
                value_range_ratio=make_ratio(1, 2),
                regime_id="regime-a",
                completeness_known="yes",  # type: ignore[arg-type]
                gap_row_count=0,
            )

    def test_result_contract(self) -> None:
        result = match_controls(_sample(), _candidate_facts(), (), _spec())
        with pytest.raises(ContractValueError):
            ControlMatchResultV1(
                match_version=result.match_version,
                sample_id=result.sample_id,
                selected_window_ids=("b", "a"),
                rejection_counts=result.rejection_counts,
                result_digest=result.result_digest,
            )
        with pytest.raises(ContractValueError):
            ControlMatchResultV1(
                match_version=result.match_version,
                sample_id=result.sample_id,
                selected_window_ids=("z",),
                rejection_counts=result.rejection_counts,
                result_digest=result.result_digest,
            )
        assert result.as_mapping()["schema"] == "Q05ControlMatchResultV1"


def _series() -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        instrument=MARKET_IDENTITY,
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        price_points=(
            PricePointV1(
                event_time_ns=BASE_NS - 10 * SECOND_NS,
                ordinal=1,
                price=_scaled(10_000),
            ),
            PricePointV1(
                event_time_ns=BASE_NS + SECOND_NS,
                ordinal=2,
                price=_scaled(10_100),
            ),
        ),
        quote_points=(),
        known_gaps=(),
    )


def _outcomes() -> SampleOutcomesV1:
    return compute_sample_outcomes(
        _sample(),
        _series(),
        definition=OutcomeDefinitionV1(
            definition_version="outcome-v1",
            max_reference_staleness_ns=60 * SECOND_NS,
        ),
        barriers=BarrierSpecV1(
            spec_version="barrier-v1",
            up_ratio=make_ratio(1, 200),
            down_ratio=make_ratio(-1, 200),
        ),
        cost_scenarios=(
            CostScenarioV1(
                scenario_version="cost-a",
                total_cost_ratio=make_ratio(1, 1_000),
                submission_latency_ns=2 * SECOND_NS,
            ),
        ),
    )


def _member(outcomes: SampleOutcomesV1) -> ManifestMemberV1:
    disposition = derive_disposition(
        sample_id=outcomes.sample.sample_id,
        event_id=outcomes.sample.event_id,
        quality=WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=0,
            completeness_known=True,
        ),
        is_control_window=False,
    )
    stage = generate_stage(
        StageEvidenceV1(
            baseline_bucket_counts=(2, 2, 2),
            window_bucket_counts=(8, 12, 6),
            net_return_sign=1,
            window_complete=True,
            disorder_observed=False,
        ),
        StageDefinitionV1(
            definition_version="stage-v1",
            dormant_max_count=1,
            ignition_ratio=make_ratio(3, 1),
            continuation_floor_ratio=make_ratio(2, 1),
            fade_ceiling_ratio=make_ratio(1, 2),
        ),
    )
    return make_manifest_member(
        outcomes=outcomes,
        disposition=disposition,
        stage=stage,
        control_window_ids=("pool-a", "pool-d"),
    )


class TestManifestAndLinkage:
    def test_manifest_is_reproducible_from_identical_inputs(self) -> None:
        outcomes = _outcomes()
        manifest = build_label_manifest(
            versions=outcomes.sample.versions,
            match_version="match-v1",
            members=(_member(outcomes),),
        )
        rebuilt = build_label_manifest(
            versions=outcomes.sample.versions,
            match_version="match-v1",
            members=(_member(outcomes),),
        )

        assert manifest.canonical_bytes() == rebuilt.canonical_bytes()
        assert manifest.manifest_id.startswith("q05manifest:")
        mapping = manifest.as_mapping()
        assert mapping["dispositionCounts"] == {"MISSED": 1}
        assert mapping["stageCounts"] == {"CONTINUATION": 1}

    def test_manifest_contracts(self) -> None:
        outcomes = _outcomes()
        member = _member(outcomes)
        manifest = build_label_manifest(
            versions=outcomes.sample.versions,
            match_version="match-v1",
            members=(member,),
        )
        with pytest.raises(ContractValueError):
            LabelManifestV1(
                manifest_id="q05manifest:forged",
                versions=manifest.versions,
                match_version=manifest.match_version,
                members=manifest.members,
            )
        with pytest.raises(ContractValueError):
            LabelManifestV1(
                manifest_id=manifest.manifest_id,
                versions="versions",  # type: ignore[arg-type]
                match_version=manifest.match_version,
                members=manifest.members,
            )
        with pytest.raises(ContractValueError):
            LabelManifestV1(
                manifest_id=manifest.manifest_id,
                versions=manifest.versions,
                match_version=manifest.match_version,
                members=(),
            )
        with pytest.raises(ContractValueError):
            LabelManifestV1(
                manifest_id=manifest.manifest_id,
                versions=manifest.versions,
                match_version=manifest.match_version,
                members=(member, member),
            )
        with pytest.raises(ContractValueError):
            LabelManifestV1(
                manifest_id=manifest.manifest_id,
                versions=manifest.versions,
                match_version=manifest.match_version,
                members=("member",),  # type: ignore[arg-type]
            )

    def test_member_contracts(self) -> None:
        outcomes = _outcomes()
        member = _member(outcomes)
        with pytest.raises(ContractValueError):
            ManifestMemberV1(
                sample_id=member.sample_id,
                event_id=member.event_id,
                cohort_id=member.cohort_id,
                disposition="MISSED",  # type: ignore[arg-type]
                stage=member.stage,
                outcome_id=member.outcome_id,
                outcome_sha256=member.outcome_sha256,
                control_window_ids=member.control_window_ids,
            )
        with pytest.raises(ContractValueError):
            ManifestMemberV1(
                sample_id=member.sample_id,
                event_id=member.event_id,
                cohort_id=member.cohort_id,
                disposition=member.disposition,
                stage="UNKNOWN",  # type: ignore[arg-type]
                outcome_id=member.outcome_id,
                outcome_sha256=member.outcome_sha256,
                control_window_ids=member.control_window_ids,
            )
        with pytest.raises(ContractValueError):
            ManifestMemberV1(
                sample_id=member.sample_id,
                event_id=member.event_id,
                cohort_id=member.cohort_id,
                disposition=member.disposition,
                stage=member.stage,
                outcome_id=member.outcome_id,
                outcome_sha256="short",
                control_window_ids=member.control_window_ids,
            )
        with pytest.raises(ContractValueError):
            ManifestMemberV1(
                sample_id=member.sample_id,
                event_id=member.event_id,
                cohort_id=member.cohort_id,
                disposition=member.disposition,
                stage=member.stage,
                outcome_id=member.outcome_id,
                outcome_sha256=member.outcome_sha256,
                control_window_ids=("b", "a"),
            )
        with pytest.raises(ContractValueError):
            make_manifest_member(
                outcomes="outcomes",  # type: ignore[arg-type]
                disposition=member.disposition,  # type: ignore[arg-type]
                stage=member.stage,  # type: ignore[arg-type]
                control_window_ids=(),
            )

    def test_member_requires_matching_sample(self) -> None:
        outcomes = _outcomes()
        foreign = derive_disposition(
            sample_id="sample-other",
            event_id="event-other",
            quality=WindowQualityFactsV1(
                gap_row_count=0,
                duplicate_row_count=0,
                completeness_known=True,
            ),
            is_control_window=False,
        )
        stage = generate_stage(
            StageEvidenceV1(
                baseline_bucket_counts=(2,),
                window_bucket_counts=(2,),
                net_return_sign=0,
                window_complete=True,
                disorder_observed=False,
            ),
            StageDefinitionV1(
                definition_version="stage-v1",
                dormant_max_count=1,
                ignition_ratio=make_ratio(3, 1),
                continuation_floor_ratio=make_ratio(2, 1),
                fade_ceiling_ratio=make_ratio(1, 2),
            ),
        )
        with pytest.raises(ContractValueError):
            make_manifest_member(
                outcomes=outcomes,
                disposition=foreign,
                stage=stage,
                control_window_ids=(),
            )

    def test_outcome_reference_feeds_the_accepted_annotation_link(self) -> None:
        outcomes = _outcomes()
        reference = outcome_reference(outcomes, available_at_ms=1_772_000_010_000)

        assert reference.objective_outcome_owner == "quantEdgeLabels"
        assert reference.objective_outcome_id == outcomes.outcome_id
        annotation = OwnerAnnotationV1(
            target_event_id="event-1",
            target_event_sha256="b" * 64,
            cohort=OwnerAnnotationCohort.MISSED,
            annotator_id="owner",
            annotated_at_ms=1_772_000_005_000,
            evidence_cutoff_ms=1_772_000_000_000,
            visible_evidence=(
                VisibleEvidenceRefV1(
                    evidence_id="evidence-1",
                    sha256="a" * 64,
                    available_at_ms=1_772_000_000_000,
                ),
            ),
            outcome_visibility=OutcomeVisibility.HIDDEN,
            tags=(OwnerAnnotationTag.PLAUSIBLE_PRECURSOR,),
            rationale="early activity looked like a plausible precursor",
        )
        link = OwnerAnnotationOutcomeLinkV1(
            annotation=annotation,
            objective_outcome_owner=reference.objective_outcome_owner,
            objective_outcome_id=reference.objective_outcome_id,
            objective_outcome_sha256=reference.objective_outcome_sha256,
            objective_outcome_available_at_ms=reference.objective_outcome_available_at_ms,
            linked_at_ms=1_772_000_020_000,
            linkage_method_version="linkage-v1",
        )

        assert link.link_id.startswith("owner-annotation-outcome-link-sha256-")

    def test_outcome_reference_contracts(self) -> None:
        with pytest.raises(ContractValueError):
            outcome_reference("outcomes", available_at_ms=1_772_000_010_000)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            ObjectiveOutcomeReferenceV1(
                objective_outcome_owner="someoneElse",
                objective_outcome_id="q05outcome:x",
                objective_outcome_sha256="a" * 64,
                objective_outcome_available_at_ms=1_772_000_010_000,
            )
        with pytest.raises(ContractValueError):
            ObjectiveOutcomeReferenceV1(
                objective_outcome_owner="quantEdgeLabels",
                objective_outcome_id="q05outcome:x",
                objective_outcome_sha256="short",
                objective_outcome_available_at_ms=1_772_000_010_000,
            )
        reference = outcome_reference(_outcomes(), available_at_ms=1_772_000_010_000)
        assert reference.as_mapping()["objectiveOutcomeOwner"] == "quantEdgeLabels"


class TestEvaluationGroups:
    def test_adjacent_windows_of_one_episode_share_a_group(self) -> None:
        windows = (
            GroupWindowV1(
                window_id="w-1",
                symbol="BNBUSDT",
                start_ns=BASE_NS,
                end_ns=BASE_NS + 600 * SECOND_NS,
            ),
            GroupWindowV1(
                window_id="w-2",
                symbol="BNBUSDT",
                start_ns=BASE_NS + 630 * SECOND_NS,
                end_ns=BASE_NS + 1_200 * SECOND_NS,
            ),
            GroupWindowV1(
                window_id="w-3",
                symbol="BNBUSDT",
                start_ns=BASE_NS + 10_000 * SECOND_NS,
                end_ns=BASE_NS + 10_600 * SECOND_NS,
            ),
            GroupWindowV1(
                window_id="w-other",
                symbol="ETHUSDT",
                start_ns=BASE_NS,
                end_ns=BASE_NS + 600 * SECOND_NS,
            ),
        )

        groups = assign_evaluation_groups(windows, adjacency_gap_ns=60 * SECOND_NS)

        assert groups["w-1"] == groups["w-2"]
        assert groups["w-1"] != groups["w-3"]
        assert groups["w-1"] != groups["w-other"]
        assert assign_evaluation_groups(windows, adjacency_gap_ns=60 * SECOND_NS) == groups

    def test_group_contracts(self) -> None:
        window = GroupWindowV1(
            window_id="w-1",
            symbol="BNBUSDT",
            start_ns=BASE_NS,
            end_ns=BASE_NS + SECOND_NS,
        )
        with pytest.raises(ContractValueError):
            assign_evaluation_groups((window, window), adjacency_gap_ns=0)
        with pytest.raises(ContractValueError):
            assign_evaluation_groups(("window",), adjacency_gap_ns=0)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError):
            assign_evaluation_groups((window,), adjacency_gap_ns=-1)
        with pytest.raises(ContractValueError):
            GroupWindowV1(
                window_id="w-1",
                symbol="BNBUSDT",
                start_ns=BASE_NS,
                end_ns=BASE_NS,
            )
        assert assign_evaluation_groups((), adjacency_gap_ns=0) == {}
