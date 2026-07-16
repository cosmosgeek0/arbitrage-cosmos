from __future__ import annotations

from quant_edge.bootstrap.atlas import PointInTimeInstrumentV1
from quant_edge.labels.controls import ControlMatchSpecV1, WindowFactsV1, match_controls
from quant_edge.labels.disposition import (
    EventDisposition,
    WindowQualityFactsV1,
    derive_disposition,
)
from quant_edge.labels.identity import (
    SampleIdentityV1,
    VersionSetV1,
    make_sample_identity,
    with_cost_version,
)
from quant_edge.labels.manifest import (
    GroupWindowV1,
    assign_evaluation_groups,
    build_label_manifest,
    make_manifest_member,
)
from quant_edge.labels.outcomes import (
    BarrierSpecV1,
    CostScenarioV1,
    OutcomeDefinitionV1,
    OutcomeStatus,
    SampleOutcomesV1,
    compute_sample_outcomes,
)
from quant_edge.labels.rational import make_ratio
from quant_edge.labels.series import (
    EvidenceSeriesV1,
    GapIntervalV1,
    PricePointV1,
    SeriesKind,
)
from quant_edge.labels.stages import (
    StageDefinitionV1,
    StageEvidenceV1,
    generate_stage,
)
from quant_edge.lake.contracts import EvidencePosture, ExactScaledValueV1

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000


def _scaled(coefficient: int) -> ExactScaledValueV1:
    return ExactScaledValueV1(coefficient=coefficient, scale=2, unit_id="USDT")


def _point(offset_s: int, coefficient: int, ordinal: int) -> PricePointV1:
    return PricePointV1(
        event_time_ns=BASE_NS + offset_s * SECOND_NS,
        ordinal=ordinal,
        price=_scaled(coefficient),
    )


def _series(
    points: tuple[PricePointV1, ...],
    *,
    end_s: int = 7_200,
    gaps: tuple[GapIntervalV1, ...] = (),
) -> EvidenceSeriesV1:
    return EvidenceSeriesV1(
        series_id="series-1",
        symbol="BNBUSDT",
        kind=SeriesKind.TRADE_MID_PROXY,
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        completeness_end_ns=BASE_NS + end_s * SECOND_NS,
        price_points=points,
        quote_points=(),
        known_gaps=gaps,
    )


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


def _versions() -> VersionSetV1:
    return VersionSetV1(
        dataset_version="ds-v1",
        feature_version="feat-v1",
        label_definition_version="label-v1",
        cost_assumption_version="cost-v1",
        execution_assumption_version="exec-v1",
    )


def _sample(*, horizon_s: int = 3_600, cohort_id: str = "cohort-1") -> SampleIdentityV1:
    return make_sample_identity(
        event_id="event-1",
        cohort_id=cohort_id,
        instrument=_instrument(),
        feature_lookback_start_ns=BASE_NS - 60 * SECOND_NS,
        feature_cutoff_ns=BASE_NS,
        label_start_ns=BASE_NS,
        label_end_ns=BASE_NS + horizon_s * SECOND_NS,
        source_completeness_start_ns=BASE_NS - 120 * SECOND_NS,
        source_completeness_end_ns=BASE_NS + 7_200 * SECOND_NS,
        versions=_versions(),
    )


def _outcomes(
    series: EvidenceSeriesV1,
    sample: SampleIdentityV1,
) -> SampleOutcomesV1:
    return compute_sample_outcomes(
        sample,
        series,
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


BASE_POINTS = (_point(-10, 10_000, 1), _point(1, 10_100, 2))


class TestSection11SevenLaws:
    def test_law_1_future_value_injection_cannot_alter_earlier_features(self) -> None:
        """§11.7(1): nothing after the feature cutoff can change pre-cutoff evidence."""

        sample = _sample()
        original = _outcomes(_series(BASE_POINTS), sample)
        injected_points = (*BASE_POINTS, _point(50, 99_000, 3), _point(60, 12, 4))
        injected = _outcomes(_series(injected_points), sample)

        assert injected.pre_cutoff_digest == original.pre_cutoff_digest
        assert injected.sample.sample_id == original.sample.sample_id
        # The label-side outcomes may of course change; the pre-cutoff truth cannot.
        assert injected.series_digest != original.series_digest

    def test_law_2_moving_the_label_end_cannot_change_earlier_hashes(self) -> None:
        """§11.7(2): the label interval is not an input to pre-cutoff evidence."""

        short = _outcomes(_series(BASE_POINTS), _sample(horizon_s=60))
        long = _outcomes(_series(BASE_POINTS), _sample(horizon_s=3_600))

        assert short.pre_cutoff_digest == long.pre_cutoff_digest
        assert short.sample.sample_id != long.sample.sample_id

    def test_law_3_adjacent_windows_of_one_event_share_one_group(self) -> None:
        """§11.7(3): splits of one episode cannot cross an evaluation boundary."""

        windows = tuple(
            GroupWindowV1(
                window_id=f"w-{index}",
                symbol="BNBUSDT",
                start_ns=BASE_NS + index * 600 * SECOND_NS,
                end_ns=BASE_NS + (index * 600 + 590) * SECOND_NS,
            )
            for index in range(3)
        )
        groups = assign_evaluation_groups(windows, adjacency_gap_ns=30 * SECOND_NS)

        assert len(set(groups.values())) == 1

    def test_law_4_censored_cases_remain_censored(self) -> None:
        """§11.7(4): recomputation never coerces a censored outcome into a value."""

        truncated = _series(BASE_POINTS, end_s=90)
        sample = _sample()
        first = _outcomes(truncated, sample)
        second = _outcomes(truncated, sample)

        censored = [
            outcome for outcome in first.horizons if outcome.status is OutcomeStatus.CENSORED
        ]
        assert censored, "the fixture must actually censor"
        assert all(outcome.gross_return is None for outcome in censored)
        assert first.canonical_bytes() == second.canonical_bytes()
        # An excursion over the truncated window is honestly censored too.
        assert first.excursion.status is OutcomeStatus.CENSORED

    def test_law_5_cost_version_change_creates_a_new_label_version(self) -> None:
        """§11.7(5): cost assumptions are identity, not a mutable knob."""

        sample = _sample()
        recosted = with_cost_version(sample, "cost-v2")
        original_outcomes = _outcomes(_series(BASE_POINTS), sample)
        recosted_outcomes = _outcomes(_series(BASE_POINTS), recosted)

        assert recosted.sample_id != sample.sample_id
        assert recosted_outcomes.outcome_id != original_outcomes.outcome_id

    def test_law_6_gapped_evidence_is_data_invalid_not_a_negative(self) -> None:
        """§11.7(6): a gap is missing truth, never a quiet zero outcome."""

        gap = GapIntervalV1(
            start_ns=BASE_NS + 10 * SECOND_NS,
            end_ns=BASE_NS + 20 * SECOND_NS,
        )
        outcomes = _outcomes(_series(BASE_POINTS, gaps=(gap,)), _sample())
        gapped_horizons = [
            outcome
            for outcome in outcomes.horizons
            if outcome.horizon_ns > 10 * SECOND_NS and outcome.status is OutcomeStatus.DATA_INVALID
        ]
        assert gapped_horizons
        assert all(outcome.gross_return is None for outcome in gapped_horizons)

        disposition = derive_disposition(
            sample_id=outcomes.sample.sample_id,
            event_id=outcomes.sample.event_id,
            quality=WindowQualityFactsV1(
                gap_row_count=2,
                duplicate_row_count=0,
                completeness_known=True,
            ),
            is_control_window=False,
        )
        assert disposition.disposition is EventDisposition.DATA_INVALID

    def test_law_7_cohorts_are_reproducible_from_manifests(self) -> None:
        """§11.7(7): acted/rejected/control cohorts rebuild byte-identically."""

        stage_definition = StageDefinitionV1(
            definition_version="stage-v1",
            dormant_max_count=1,
            ignition_ratio=make_ratio(3, 1),
            continuation_floor_ratio=make_ratio(2, 1),
            fade_ceiling_ratio=make_ratio(1, 2),
        )
        clean = WindowQualityFactsV1(
            gap_row_count=0,
            duplicate_row_count=0,
            completeness_known=True,
        )

        def _build_manifest() -> bytes:
            members = []
            for cohort_id, asserted, is_control in (
                ("cohort-acted", EventDisposition.ACTED, False),
                ("cohort-rejected", EventDisposition.REJECTED, False),
                ("cohort-quiet", None, True),
            ):
                sample = _sample(cohort_id=cohort_id)
                outcomes = _outcomes(_series(BASE_POINTS), sample)
                disposition = derive_disposition(
                    sample_id=sample.sample_id,
                    event_id=sample.event_id,
                    quality=clean,
                    is_control_window=is_control,
                    asserted=asserted,
                )
                stage = generate_stage(
                    StageEvidenceV1(
                        baseline_bucket_counts=(2, 2, 2),
                        window_bucket_counts=(8, 12, 6),
                        net_return_sign=1,
                        window_complete=True,
                        disorder_observed=False,
                    ),
                    stage_definition,
                )
                controls = match_controls(
                    sample,
                    WindowFactsV1(
                        window_id="candidate-1",
                        symbol="BNBUSDT",
                        window_start_ns=BASE_NS - 90_000 * SECOND_NS,
                        window_end_ns=BASE_NS - 89_400 * SECOND_NS,
                        row_count=120,
                        value_range_ratio=make_ratio(1, 100),
                        regime_id="regime-a",
                        completeness_known=True,
                        gap_row_count=0,
                    ),
                    (
                        WindowFactsV1(
                            window_id="pool-a",
                            symbol="BNBUSDT",
                            window_start_ns=BASE_NS - (90_000 + 86_400) * SECOND_NS,
                            window_end_ns=BASE_NS - (89_400 + 86_400) * SECOND_NS,
                            row_count=120,
                            value_range_ratio=make_ratio(1, 100),
                            regime_id="regime-a",
                            completeness_known=True,
                            gap_row_count=0,
                        ),
                    ),
                    ControlMatchSpecV1(
                        match_version="match-v1",
                        liquidity_bucket_edges=(10, 100, 1_000),
                        volatility_bucket_edges=(make_ratio(1, 200), make_ratio(1, 20)),
                        time_of_day_bucket_ns=86_400_000_000_000 // 24,
                        funding_cycle_ns=86_400_000_000_000 // 3,
                        max_controls=4,
                    ),
                )
                members.append(
                    make_manifest_member(
                        outcomes=outcomes,
                        disposition=disposition,
                        stage=stage,
                        control_window_ids=controls.selected_window_ids,
                    )
                )
            manifest = build_label_manifest(
                versions=_versions(),
                match_version="match-v1",
                members=tuple(members),
            )
            return manifest.canonical_bytes()

        first = _build_manifest()
        second = _build_manifest()

        assert first == second
        assert b'"ACTED":1' in first
        assert b'"REJECTED":1' in first
        assert b'"QUIET_CONTROL":1' in first
