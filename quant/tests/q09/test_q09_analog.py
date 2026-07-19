from __future__ import annotations

from dataclasses import replace

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import QualityState
from quant_edge.regime.analog import (
    MAX_ANALOG_RECORDS,
    AnalogExclusionReason,
    AnalogNeighborV1,
    AnalogQueryV1,
    AnalogRecordV1,
    AnalogRetrievalV1,
    AnalogStatus,
    retrieve_analogs,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
HOUR_NS = 3_600 * SECOND_NS
HUNDREDTH = FIXED_POINT_SCALE // 100

MOTIF = (0, 30, 60, 30, 0, -30, -60, -30)


def _fp_window(deltas: tuple[int, ...]) -> tuple[FixedPointV1, ...]:
    return tuple(FixedPointV1((500 + delta) * HUNDREDTH) for delta in deltas)


def _record(
    record_id: str,
    *,
    end_offset_hours: int,
    deltas: tuple[int, ...] = MOTIF,
    symbol: str = "BNBUSDT",
    regime_id: str = "UNKNOWN",
    feature_id: str = "window-v1",
    outcome: str = "CONTINUATION",
    label_available_offset_hours: int | None = None,
    event_id: str | None = "event-record",
    completeness: QualityState = QualityState.SYNTHETIC,
) -> AnalogRecordV1:
    end_ns = BASE_NS + end_offset_hours * HOUR_NS
    label_available_ns = (
        end_ns + 2 * SECOND_NS
        if label_available_offset_hours is None
        else BASE_NS + label_available_offset_hours * HOUR_NS
    )
    return AnalogRecordV1(
        record_id=record_id,
        symbol=symbol,
        regime_id=regime_id,
        feature_id=feature_id,
        start_ns=end_ns - 8 * SECOND_NS,
        end_ns=end_ns,
        outcome_start_ns=end_ns,
        outcome_end_ns=end_ns + SECOND_NS,
        label_available_ns=label_available_ns,
        values=_fp_window(deltas),
        outcome_label=outcome,
        completeness=completeness,
        event_id=event_id,
    )


def _query(
    *,
    deltas: tuple[int, ...] = MOTIF,
    regime_id: str | None = None,
    embargo_hours: int = 1,
    event_id: str | None = "event-q",
) -> AnalogQueryV1:
    return AnalogQueryV1(
        query_id="query-1",
        symbol="BNBUSDT",
        regime_id=regime_id,
        feature_id="window-v1",
        start_ns=BASE_NS + 10 * HOUR_NS,
        cutoff_ns=BASE_NS + 10 * HOUR_NS + 8 * SECOND_NS,
        embargo_ns=embargo_hours * HOUR_NS,
        values=_fp_window(deltas),
        event_id=event_id,
    )


class TestAnalogContracts:
    def test_record_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="record_id"):
            _record("", end_offset_hours=1)
        with pytest.raises(ContractValueError, match="end_ns"):
            AnalogRecordV1(
                record_id="analog-1",
                symbol="BNBUSDT",
                regime_id="UNKNOWN",
                feature_id="window-v1",
                start_ns=BASE_NS,
                end_ns=BASE_NS,
                outcome_start_ns=BASE_NS + SECOND_NS,
                outcome_end_ns=BASE_NS + 2 * SECOND_NS,
                label_available_ns=BASE_NS + 3 * SECOND_NS,
                values=_fp_window(MOTIF),
                outcome_label="CONTINUATION",
                completeness=QualityState.SYNTHETIC,
                event_id=None,
            )
        with pytest.raises(ContractValueError, match="values"):
            AnalogRecordV1(
                record_id="analog-1",
                symbol="BNBUSDT",
                regime_id="UNKNOWN",
                feature_id="window-v1",
                start_ns=BASE_NS,
                end_ns=BASE_NS + SECOND_NS,
                outcome_start_ns=BASE_NS + SECOND_NS,
                outcome_end_ns=BASE_NS + 2 * SECOND_NS,
                label_available_ns=BASE_NS + 3 * SECOND_NS,
                values=(FixedPointV1(1),),
                outcome_label="CONTINUATION",
                completeness=QualityState.SYNTHETIC,
                event_id=None,
            )
        with pytest.raises(ContractValueError, match="completeness"):
            AnalogRecordV1(
                record_id="analog-1",
                symbol="BNBUSDT",
                regime_id="UNKNOWN",
                feature_id="window-v1",
                start_ns=BASE_NS,
                end_ns=BASE_NS + SECOND_NS,
                outcome_start_ns=BASE_NS + SECOND_NS,
                outcome_end_ns=BASE_NS + 2 * SECOND_NS,
                label_available_ns=BASE_NS + 3 * SECOND_NS,
                values=_fp_window(MOTIF),
                outcome_label="CONTINUATION",
                completeness="SYNTHETIC",  # type: ignore[arg-type]
                event_id=None,
            )
        with pytest.raises(ContractValueError, match="event_id"):
            _record("analog-1", end_offset_hours=1, event_id="")
        valid = _record("analog-1", end_offset_hours=1)
        with pytest.raises(ContractValueError, match="outcome_start_ns"):
            replace(valid, outcome_start_ns=valid.end_ns - 1)
        with pytest.raises(ContractValueError, match="outcome_end_ns"):
            replace(valid, outcome_end_ns=valid.outcome_start_ns)
        with pytest.raises(ContractValueError, match="label_available_ns"):
            replace(valid, label_available_ns=valid.outcome_end_ns - 1)
        mapping = valid.as_mapping()
        assert mapping["outcomeLabel"] == "CONTINUATION"
        assert mapping["outcomeStartNs"] == str(valid.outcome_start_ns)
        assert mapping["outcomeEndNs"] == str(valid.outcome_end_ns)
        assert mapping["labelAvailableNs"] == str(valid.label_available_ns)

    def test_query_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="query_id"):
            AnalogQueryV1(
                query_id="",
                symbol="BNBUSDT",
                regime_id=None,
                feature_id="window-v1",
                start_ns=BASE_NS,
                cutoff_ns=BASE_NS + SECOND_NS,
                embargo_ns=0,
                values=_fp_window(MOTIF),
                event_id=None,
            )
        with pytest.raises(ContractValueError, match="cutoff_ns"):
            AnalogQueryV1(
                query_id="query-1",
                symbol="BNBUSDT",
                regime_id=None,
                feature_id="window-v1",
                start_ns=BASE_NS,
                cutoff_ns=BASE_NS,
                embargo_ns=0,
                values=_fp_window(MOTIF),
                event_id=None,
            )
        with pytest.raises(ContractValueError, match="embargo_ns"):
            AnalogQueryV1(
                query_id="query-1",
                symbol="BNBUSDT",
                regime_id=None,
                feature_id="window-v1",
                start_ns=BASE_NS,
                cutoff_ns=BASE_NS + SECOND_NS,
                embargo_ns=-1,
                values=_fp_window(MOTIF),
                event_id=None,
            )
        with pytest.raises(ContractValueError, match="regime_id"):
            _query(regime_id="")
        mapping = _query().as_mapping()
        assert mapping["regimeId"] is None

    def test_neighbor_contract(self) -> None:
        with pytest.raises(ContractValueError, match="inside \\[-1, 1\\]"):
            AnalogNeighborV1(
                record_id="analog-1",
                end_ns=BASE_NS,
                similarity=FixedPointV1(2 * FIXED_POINT_SCALE),
                outcome_label="CONTINUATION",
                completeness=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="completeness"):
            AnalogNeighborV1(
                record_id="analog-1",
                end_ns=BASE_NS,
                similarity=FixedPointV1(0),
                outcome_label="CONTINUATION",
                completeness=None,  # type: ignore[arg-type]
            )

    def test_retrieval_contract_laws(self) -> None:
        neighbor = AnalogNeighborV1(
            record_id="analog-1",
            end_ns=BASE_NS,
            similarity=FixedPointV1(0),
            outcome_label="CONTINUATION",
            completeness=QualityState.SYNTHETIC,
        )
        exclusions = tuple(
            sorted(
                dict.fromkeys(AnalogExclusionReason, 0).items(),
                key=lambda item: item[0].value,
            )
        )
        with pytest.raises(ContractValueError, match="neighbors exist exactly"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=2,
                cohort_size=0,
                neighbors=(),
                outcome_counts=(),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="signal-free query"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.NO_QUERY_SIGNAL,
                requested_k=2,
                cohort_size=3,
                neighbors=(),
                outcome_counts=(),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="exhaust the cohort"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=2,
                cohort_size=5,
                neighbors=(neighbor,),
                outcome_counts=(("CONTINUATION", 1),),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="cover exactly the neighbors"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=2,
                cohort_size=1,
                neighbors=(neighbor,),
                outcome_counts=(("CONTINUATION", 2),),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="sorted by unique label"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=3,
                cohort_size=2,
                neighbors=(neighbor, neighbor),
                outcome_counts=(("FADE", 1), ("CONTINUATION", 1)),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="cover every reason once"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.NO_ANALOGS,
                requested_k=2,
                cohort_size=0,
                neighbors=(),
                outcome_counts=(),
                exclusion_counts=exclusions[:3],
            )
        with pytest.raises(ContractValueError, match="sorted by reason"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.NO_ANALOGS,
                requested_k=2,
                cohort_size=0,
                neighbors=(),
                outcome_counts=(),
                exclusion_counts=tuple(reversed(exclusions)),
            )
        with pytest.raises(ContractValueError, match="must be AnalogNeighborV1"):
            AnalogRetrievalV1(
                query_id="query-1",
                status=AnalogStatus.OK,
                requested_k=2,
                cohort_size=1,
                neighbors=(1,),  # type: ignore[arg-type]
                outcome_counts=(),
                exclusion_counts=exclusions,
            )
        with pytest.raises(ContractValueError, match="status must be AnalogStatus"):
            AnalogRetrievalV1(
                query_id="query-1",
                status="OK",  # type: ignore[arg-type]
                requested_k=2,
                cohort_size=0,
                neighbors=(),
                outcome_counts=(),
                exclusion_counts=exclusions,
            )


class TestRetrieveAnalogs:
    def test_rejects_bad_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="query must be AnalogQueryV1"):
            retrieve_analogs(None, (), k=1)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match=f"at most {MAX_ANALOG_RECORDS}"):
            retrieve_analogs(_query(), [], k=1)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="k"):
            retrieve_analogs(_query(), (), k=0)
        with pytest.raises(ContractValueError, match="records\\[0\\]"):
            retrieve_analogs(_query(), (1,), k=1)  # type: ignore[arg-type]

    def test_each_exclusion_reason_is_measured(self) -> None:
        records = (
            _record("analog-cohort-symbol", end_offset_hours=1, symbol="ETHUSDT"),
            _record("analog-shape-feature", end_offset_hours=1, feature_id="other-v1"),
            _record("analog-shape-length", end_offset_hours=1, deltas=MOTIF[:4]),
            _record("analog-future", end_offset_hours=11),
            _record("analog-embargo", end_offset_hours=10),
            _record(
                "analog-label-unavailable",
                end_offset_hours=1,
                label_available_offset_hours=10,
            ),
            _record("analog-same-event", end_offset_hours=2, event_id="event-q"),
            _record("analog-unknown-event", end_offset_hours=2, event_id=None),
            _record("analog-degenerate", end_offset_hours=2, deltas=(0,) * 8),
            _record("analog-good", end_offset_hours=3),
        )
        retrieval = retrieve_analogs(_query(), records, k=2)
        counts = dict(retrieval.exclusion_counts)
        assert counts[AnalogExclusionReason.COHORT] == 1
        assert counts[AnalogExclusionReason.SHAPE] == 2
        assert counts[AnalogExclusionReason.FUTURE] == 3
        assert counts[AnalogExclusionReason.OVERLAP] == 0
        assert counts[AnalogExclusionReason.SAME_EVENT] == 2
        assert counts[AnalogExclusionReason.DEGENERATE] == 1
        assert retrieval.cohort_size == 1
        assert retrieval.neighbors[0].record_id == "analog-good"

    def test_overlap_is_excluded_before_ranking(self) -> None:
        overlapping = AnalogRecordV1(
            record_id="analog-overlapping",
            symbol="BNBUSDT",
            regime_id="UNKNOWN",
            feature_id="window-v1",
            start_ns=BASE_NS + 10 * HOUR_NS - 4 * SECOND_NS,
            end_ns=BASE_NS + 10 * HOUR_NS + 4 * SECOND_NS,
            outcome_start_ns=BASE_NS + 10 * HOUR_NS + 4 * SECOND_NS,
            outcome_end_ns=BASE_NS + 10 * HOUR_NS + 5 * SECOND_NS,
            label_available_ns=BASE_NS + 10 * HOUR_NS + 6 * SECOND_NS,
            values=_fp_window(MOTIF),
            outcome_label="CONTINUATION",
            completeness=QualityState.SYNTHETIC,
            event_id=None,
        )
        retrieval = retrieve_analogs(_query(embargo_hours=0), (overlapping,), k=1)
        counts = dict(retrieval.exclusion_counts)
        assert counts[AnalogExclusionReason.OVERLAP] == 1
        assert retrieval.status is AnalogStatus.NO_ANALOGS

    def test_regime_cohort_filter_applies_when_requested(self) -> None:
        records = (
            _record("analog-regime-a", end_offset_hours=1, regime_id="QUIET"),
            _record("analog-regime-b", end_offset_hours=2, regime_id="VOLATILE"),
        )
        unfiltered = retrieve_analogs(_query(), records, k=2)
        assert unfiltered.cohort_size == 2
        filtered = retrieve_analogs(_query(regime_id="QUIET"), records, k=2)
        assert filtered.cohort_size == 1
        assert filtered.neighbors[0].record_id == "analog-regime-a"

    def test_ranking_is_correlation_order_with_deterministic_ties(self) -> None:
        anti = tuple(-delta for delta in MOTIF)
        weak = (10, 40, 20, 45, -15, -5, -50, -20)
        records = (
            _record("analog-anti", end_offset_hours=1, deltas=anti, outcome="FADE"),
            _record("analog-weak", end_offset_hours=2, deltas=weak, outcome="UNKNOWN"),
            _record("analog-exact-late", end_offset_hours=4),
            _record("analog-exact-early", end_offset_hours=3),
        )
        retrieval = retrieve_analogs(_query(), records, k=4)
        names = [neighbor.record_id for neighbor in retrieval.neighbors]
        # Equal perfect correlations tie-break by earlier end time.
        assert names == [
            "analog-exact-early",
            "analog-exact-late",
            "analog-weak",
            "analog-anti",
        ]
        similarities = [neighbor.similarity.mantissa for neighbor in retrieval.neighbors]
        assert similarities[0] == FIXED_POINT_SCALE
        assert similarities[1] == FIXED_POINT_SCALE
        assert 0 < similarities[2] < FIXED_POINT_SCALE
        assert similarities[3] == -FIXED_POINT_SCALE

    def test_tie_on_end_time_breaks_by_record_id(self) -> None:
        records = (
            _record("analog-b", end_offset_hours=1),
            _record("analog-a", end_offset_hours=1),
        )
        retrieval = retrieve_analogs(_query(), records, k=2)
        names = [neighbor.record_id for neighbor in retrieval.neighbors]
        assert names == ["analog-a", "analog-b"]

    def test_k_truncates_but_outcome_counts_follow_neighbors(self) -> None:
        records = tuple(
            _record(f"analog-{index:02d}", end_offset_hours=index + 1, outcome="FADE")
            for index in range(5)
        )
        retrieval = retrieve_analogs(_query(), records, k=2)
        assert retrieval.cohort_size == 5
        assert len(retrieval.neighbors) == 2
        assert retrieval.outcome_counts == (("FADE", 2),)

    def test_no_query_signal_degrades_gracefully(self) -> None:
        retrieval = retrieve_analogs(
            _query(deltas=(0,) * 8),
            (_record("analog-good", end_offset_hours=1),),
            k=1,
        )
        assert retrieval.status is AnalogStatus.NO_QUERY_SIGNAL
        assert retrieval.neighbors == ()
        assert retrieval.cohort_size == 0

    def test_mapping_round_trips(self) -> None:
        retrieval = retrieve_analogs(
            _query(),
            (_record("analog-good", end_offset_hours=1),),
            k=1,
        )
        mapping = retrieval.as_mapping()
        assert mapping["status"] == "OK"
        assert mapping["outcomeCounts"] == {"CONTINUATION": 1}
        exclusion_counts = mapping["exclusionCounts"]
        assert isinstance(exclusion_counts, dict)
        assert exclusion_counts["FUTURE"] == 0
