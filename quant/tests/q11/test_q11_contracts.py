from __future__ import annotations

from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.contracts import (
    MAX_DURATION_NS,
    MAX_STRATA,
    MAX_SUBJECTS,
    CauseSetV1,
    CohortBuildResultV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeGridV1,
    TimeTableRowV1,
    build_cohort,
    event_time_table,
    fixed_point_to_fraction,
    fraction_to_fixed_point,
    require_probability,
)

SECOND_NS = 1_000_000_000
CAUSES = CauseSetV1(cause_ids=("A", "B"))


def subject(
    subject_id: str,
    seconds: int,
    cause_id: str | None,
    *,
    quality: QualityState = QualityState.SYNTHETIC,
    stratum_id: str = "ALL",
    group_id: str | None = None,
) -> SubjectV1:
    return SubjectV1(
        subject_id=subject_id,
        group_id=subject_id if group_id is None else group_id,
        stratum_id=stratum_id,
        duration_ns=seconds * SECOND_NS,
        status=SubjectStatus.RIGHT_CENSORED if cause_id is None else SubjectStatus.EVENT,
        cause_id=cause_id,
        quality=quality,
    )


def cohort(subjects: tuple[SubjectV1, ...], **overrides: object) -> SurvivalCohortV1:
    arguments: dict[str, object] = {
        "cohort_id": "q11.test.cohort",
        "target": SurvivalTarget.TIME_TO_CONVERGENCE,
        "causes": CAUSES,
        "posture": EvidencePosture.SYNTHETIC,
        "subjects": subjects,
    }
    arguments.update(overrides)
    return SurvivalCohortV1(**arguments)  # type: ignore[arg-type]


class TestQuantization:
    def test_fraction_round_trips_half_even(self) -> None:
        assert fraction_to_fixed_point(Fraction(1, 2)).mantissa == FIXED_POINT_SCALE // 2
        # 6/7 rounds up at the twelfth decimal: 857142857142.857... -> ...143.
        assert fraction_to_fixed_point(Fraction(6, 7)).mantissa == 857_142_857_143
        assert fixed_point_to_fraction(FixedPointV1(250_000_000_000)) == Fraction(1, 4)

    def test_rejects_wrong_types(self) -> None:
        with pytest.raises(ContractValueError, match="exact Fraction"):
            fraction_to_fixed_point(0.5)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="FixedPointV1"):
            fixed_point_to_fraction(1)  # type: ignore[arg-type]

    def test_require_probability_bounds(self) -> None:
        assert require_probability(FixedPointV1(0), field="p").mantissa == 0
        with pytest.raises(ContractValueError, match="inside"):
            require_probability(FixedPointV1(FIXED_POINT_SCALE + 1), field="p")
        with pytest.raises(ContractValueError, match="inside"):
            require_probability(FixedPointV1(-1), field="p")
        with pytest.raises(ContractValueError, match="FixedPointV1"):
            require_probability("0.5", field="p")


class TestCauseSet:
    def test_sorted_unique_causes(self) -> None:
        assert CAUSES.index_of("A") == 0
        assert CAUSES.index_of("B") == 1
        assert CAUSES.as_mapping() == {"causeIds": ["A", "B"]}

    def test_rejects_unsorted_duplicate_or_unregistered(self) -> None:
        with pytest.raises(ContractValueError, match="sorted"):
            CauseSetV1(cause_ids=("B", "A"))
        with pytest.raises(ContractValueError, match="sorted"):
            CauseSetV1(cause_ids=("A", "A"))
        with pytest.raises(ContractValueError, match="tuple of 1"):
            CauseSetV1(cause_ids=())
        with pytest.raises(ContractValueError, match="tuple of 1"):
            CauseSetV1(cause_ids=tuple(f"C{index}" for index in range(9)))
        with pytest.raises(ContractValueError, match="not registered"):
            CAUSES.index_of("MISSING")
        with pytest.raises(ContractValueError, match="cause_ids"):
            CauseSetV1(cause_ids=("bad id",))


class TestSubject:
    def test_event_requires_cause_and_censored_forbids_it(self) -> None:
        event = subject("s1", 5, "A")
        assert event.is_event
        assert event.cause_id == "A"
        censored = subject("s2", 5, None)
        assert not censored.is_event
        assert censored.cause_id is None
        with pytest.raises(ContractValueError, match="carry a cause"):
            SubjectV1(
                subject_id="s3",
                group_id="s3",
                stratum_id="ALL",
                duration_ns=SECOND_NS,
                status=SubjectStatus.EVENT,
                cause_id=None,
                quality=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="only EVENT"):
            SubjectV1(
                subject_id="s4",
                group_id="s4",
                stratum_id="ALL",
                duration_ns=SECOND_NS,
                status=SubjectStatus.RIGHT_CENSORED,
                cause_id="A",
                quality=QualityState.SYNTHETIC,
            )

    def test_duration_and_type_bounds(self) -> None:
        with pytest.raises(ContractValueError, match="duration_ns"):
            subject("s1", 0, "A")
        with pytest.raises(ContractValueError, match="duration_ns"):
            SubjectV1(
                subject_id="s1",
                group_id="s1",
                stratum_id="ALL",
                duration_ns=MAX_DURATION_NS + 1,
                status=SubjectStatus.EVENT,
                cause_id="A",
                quality=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="status"):
            SubjectV1(
                subject_id="s1",
                group_id="s1",
                stratum_id="ALL",
                duration_ns=SECOND_NS,
                status="EVENT",  # type: ignore[arg-type]
                cause_id="A",
                quality=QualityState.SYNTHETIC,
            )
        with pytest.raises(ContractValueError, match="quality"):
            SubjectV1(
                subject_id="s1",
                group_id="s1",
                stratum_id="ALL",
                duration_ns=SECOND_NS,
                status=SubjectStatus.EVENT,
                cause_id="A",
                quality="COMPLETE",  # type: ignore[arg-type]
            )

    def test_eligibility_follows_quality(self) -> None:
        assert subject("s1", 5, "A", quality=QualityState.COMPLETE).is_eligible
        assert subject("s2", 5, "A", quality=QualityState.SYNTHETIC).is_eligible
        for quality in (
            QualityState.PARTIAL,
            QualityState.GAPPED,
            QualityState.STALE,
            QualityState.RECONSTRUCTING,
            QualityState.SAMPLED,
            QualityState.UNAVAILABLE,
            QualityState.UNKNOWN,
        ):
            assert not subject("s3", 5, "A", quality=quality).is_eligible

    def test_as_mapping_round_trip(self) -> None:
        mapping = subject("s1", 5, "A").as_mapping()
        assert mapping["durationNs"] == str(5 * SECOND_NS)
        assert mapping["status"] == "EVENT"
        assert subject("s2", 5, None).as_mapping()["causeId"] is None


class TestCohort:
    def test_accepts_synthetic_and_replay_only(self) -> None:
        built = cohort((subject("s1", 5, "A"),))
        assert built.size == 1
        replay = cohort(
            (subject("s1", 5, "A", quality=QualityState.COMPLETE),),
            posture=EvidencePosture.REPLAY,
        )
        assert replay.posture is EvidencePosture.REPLAY
        with pytest.raises(ContractValueError, match="no live market evidence"):
            cohort((subject("s1", 5, "A"),), posture=EvidencePosture.LIVE)
        with pytest.raises(ContractValueError, match="no live market evidence"):
            cohort((subject("s1", 5, "A"),), posture="SYNTHETIC")

    def test_rejects_bad_membership(self) -> None:
        with pytest.raises(ContractValueError, match="duplicate subject"):
            cohort((subject("s1", 5, "A"), subject("s1", 6, None)))
        with pytest.raises(ContractValueError, match="not in the cause set"):
            cohort((subject("s1", 5, "MISSING"),))
        with pytest.raises(ContractValueError, match="use build_cohort"):
            cohort((subject("s1", 5, "A", quality=QualityState.GAPPED),))
        with pytest.raises(ContractValueError, match="must be SubjectV1"):
            cohort((subject("s1", 5, "A"), "not-a-subject"))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="tuple of 1"):
            cohort(())
        with pytest.raises(ContractValueError, match="target"):
            cohort((subject("s1", 5, "A"),), target="TIME_TO_CONVERGENCE")
        with pytest.raises(ContractValueError, match="causes"):
            cohort((subject("s1", 5, "A"),), causes=("A",))

    def test_bounds_strata_and_size(self) -> None:
        too_many_strata = tuple(
            subject(f"s{index}", 5, "A", stratum_id=f"st{index}") for index in range(MAX_STRATA + 1)
        )
        with pytest.raises(ContractValueError, match="strata"):
            cohort(too_many_strata)

    def test_counts(self) -> None:
        built = cohort(
            (
                subject("s1", 5, "A"),
                subject("s2", 6, "B"),
                subject("s3", 7, "A"),
                subject("s4", 8, None),
            )
        )
        assert built.event_counts() == (2, 1)
        assert built.censored_count == 1


class TestBuildCohort:
    def test_counts_every_ineligible_quality(self) -> None:
        result = build_cohort(
            cohort_id="q11.test.build",
            target=SurvivalTarget.TIME_TO_IGNITION,
            causes=CAUSES,
            posture=EvidencePosture.SYNTHETIC,
            candidates=(
                subject("s1", 5, "A"),
                subject("s2", 5, "A", quality=QualityState.GAPPED),
                subject("s3", 5, None, quality=QualityState.GAPPED),
                subject("s4", 5, None, quality=QualityState.STALE),
                subject("s5", 6, "B", quality=QualityState.COMPLETE),
            ),
        )
        assert result.cohort is not None
        assert result.cohort.size == 2
        assert result.excluded_by_quality == (
            (QualityState.GAPPED, 2),
            (QualityState.STALE, 1),
        )
        assert result.excluded_total == 3
        mapping = result.as_mapping()
        assert mapping["excludedByQuality"] == {"GAPPED": 2, "STALE": 1}

    def test_all_ineligible_yields_no_cohort_not_a_negative(self) -> None:
        result = build_cohort(
            cohort_id="q11.test.empty",
            target=SurvivalTarget.TIME_TO_IGNITION,
            causes=CAUSES,
            posture=EvidencePosture.SYNTHETIC,
            candidates=(subject("s1", 5, "A", quality=QualityState.UNKNOWN),),
        )
        assert result.cohort is None
        assert result.excluded_by_quality == ((QualityState.UNKNOWN, 1),)
        assert result.as_mapping()["cohort"] is None

    def test_rejects_bad_candidates(self) -> None:
        with pytest.raises(ContractValueError, match="candidates"):
            build_cohort(
                cohort_id="q11.test.bad",
                target=SurvivalTarget.TIME_TO_IGNITION,
                causes=CAUSES,
                posture=EvidencePosture.SYNTHETIC,
                candidates=(),
            )
        with pytest.raises(ContractValueError, match="must be SubjectV1"):
            build_cohort(
                cohort_id="q11.test.bad",
                target=SurvivalTarget.TIME_TO_IGNITION,
                causes=CAUSES,
                posture=EvidencePosture.SYNTHETIC,
                candidates=("nope",),  # type: ignore[arg-type]
            )

    def test_result_contract_shape(self) -> None:
        with pytest.raises(ContractValueError, match="cohort must be"):
            CohortBuildResultV1(cohort="x", excluded_by_quality=())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="must be a tuple"):
            CohortBuildResultV1(cohort=None, excluded_by_quality=[])  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="QualityState, count"):
            CohortBuildResultV1(
                cohort=None,
                excluded_by_quality=(("GAPPED", 1),),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="exclusion count"):
            CohortBuildResultV1(
                cohort=None,
                excluded_by_quality=((QualityState.GAPPED, 0),),
            )


class TestTimeGrid:
    GRID = TimeGridV1(
        grid_id="q11.test.grid",
        times_ns=(10 * SECOND_NS, 20 * SECOND_NS, 40 * SECOND_NS),
    )

    def test_right_closed_binning_law(self) -> None:
        assert self.GRID.bin_index(1) == 0
        assert self.GRID.bin_index(10 * SECOND_NS) == 0
        assert self.GRID.bin_index(10 * SECOND_NS + 1) == 1
        assert self.GRID.bin_index(20 * SECOND_NS) == 1
        assert self.GRID.bin_index(40 * SECOND_NS) == 2
        assert self.GRID.bin_index(40 * SECOND_NS + 1) is None
        assert self.GRID.bin_count == 3
        assert self.GRID.end_ns == 40 * SECOND_NS

    def test_index_of_time_requires_exact_grid_times(self) -> None:
        assert self.GRID.index_of_time(20 * SECOND_NS) == 1
        with pytest.raises(ContractValueError, match="not a grid time"):
            self.GRID.index_of_time(15 * SECOND_NS)
        with pytest.raises(ContractValueError, match="not a grid time"):
            self.GRID.index_of_time(41 * SECOND_NS)

    def test_rejects_bad_grids(self) -> None:
        with pytest.raises(ContractValueError, match="strictly increase"):
            TimeGridV1(grid_id="g", times_ns=(SECOND_NS, SECOND_NS))
        with pytest.raises(ContractValueError, match="tuple of 1"):
            TimeGridV1(grid_id="g", times_ns=())
        with pytest.raises(ContractValueError, match="times_ns"):
            TimeGridV1(grid_id="g", times_ns=(0,))

    def test_as_mapping(self) -> None:
        assert self.GRID.as_mapping()["timesNs"] == [
            str(10 * SECOND_NS),
            str(20 * SECOND_NS),
            str(40 * SECOND_NS),
        ]


class TestTimeTable:
    def test_aggregates_exact_counts_with_shrinking_risk_set(self) -> None:
        table = event_time_table(
            (
                subject("s1", 2, "A"),
                subject("s2", 2, None),
                subject("s3", 2, "A"),
                subject("s4", 5, "B"),
                subject("s5", 9, None),
            ),
            CAUSES,
        )
        assert [row.as_mapping() for row in table] == [
            {"atRisk": 5, "censored": 1, "events": [2, 0], "timeNs": str(2 * SECOND_NS)},
            {"atRisk": 2, "censored": 0, "events": [0, 1], "timeNs": str(5 * SECOND_NS)},
            {"atRisk": 1, "censored": 1, "events": [0, 0], "timeNs": str(9 * SECOND_NS)},
        ]
        assert table[0].total_events == 2

    def test_rejects_bad_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="subjects"):
            event_time_table((), CAUSES)
        with pytest.raises(ContractValueError, match="must be SubjectV1"):
            event_time_table(("nope",), CAUSES)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="CauseSetV1"):
            event_time_table((subject("s1", 2, "A"),), ("A",))  # type: ignore[arg-type]

    def test_row_contract(self) -> None:
        with pytest.raises(ContractValueError, match="at least one departure"):
            TimeTableRowV1(time_ns=SECOND_NS, at_risk=3, events=(0, 0), censored=0)
        with pytest.raises(ContractValueError, match="exceed the risk set"):
            TimeTableRowV1(time_ns=SECOND_NS, at_risk=1, events=(1, 0), censored=1)
        with pytest.raises(ContractValueError, match="events"):
            TimeTableRowV1(time_ns=SECOND_NS, at_risk=1, events=(), censored=1)
        with pytest.raises(ContractValueError, match="events\\[0\\]"):
            TimeTableRowV1(time_ns=SECOND_NS, at_risk=1, events=(-1,), censored=1)


def test_max_subjects_bound_is_enforced() -> None:
    with pytest.raises(ContractValueError, match=f"1..{MAX_SUBJECTS}"):
        event_time_table(
            tuple(subject(f"s{index}", 1, "A") for index in range(MAX_SUBJECTS + 1)),
            CAUSES,
        )
