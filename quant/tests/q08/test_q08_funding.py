from __future__ import annotations

import pytest

from quant_edge.derivatives.funding import (
    FUNDING_CHANGE_FEATURE_ID,
    FUNDING_LEVEL_FEATURE_ID,
    TIME_TO_NEXT_FUNDING_FEATURE_ID,
    FundingEvidenceV1,
    FundingObservationV1,
    ScheduleIntervalVerdict,
    funding_change,
    funding_level,
    schedule_interval_verdict,
    time_to_next_funding,
)
from quant_edge.errors import ContractValueError
from quant_edge.features.values import FeatureValueStatus
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture

BASE_NS = 1_772_000_000_000_000_000
HOUR_NS = 3_600_000_000_000


def _observation(
    hours: int, ordinal: int, numerator: int, denominator: int
) -> FundingObservationV1:
    return FundingObservationV1(
        event_time_ns=BASE_NS + hours * HOUR_NS,
        ordinal=ordinal,
        rate=make_ratio(numerator, denominator),
    )


def _evidence(
    observations: tuple[FundingObservationV1, ...],
    schedule_hours: tuple[int, ...] = (8, 16, 24, 32),
) -> FundingEvidenceV1:
    return FundingEvidenceV1(
        symbol="BNBUSDT-PERP",
        posture=EvidencePosture.SYNTHETIC,
        completeness_start_ns=BASE_NS,
        completeness_end_ns=BASE_NS + 48 * HOUR_NS,
        observations=observations,
        schedule_times_ns=tuple(BASE_NS + hours * HOUR_NS for hours in schedule_hours),
    )


THREE = (
    _observation(8, 0, 1, 10_000),
    _observation(16, 1, 3, 20_000),
    _observation(24, 2, -1, 8_000),
)


class TestFundingEvidenceContract:
    def test_posture_ordering_and_interval_laws(self) -> None:
        with pytest.raises(ContractValueError, match="SYNTHETIC or REPLAY"):
            FundingEvidenceV1(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.LIVE,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + HOUR_NS,
                observations=(),
                schedule_times_ns=(),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            _evidence(()).__class__(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.SYNTHETIC,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS,
                observations=(),
                schedule_times_ns=(),
            )
        with pytest.raises(ContractValueError, match="time-ordered"):
            _evidence((_observation(16, 0, 1, 10_000), _observation(8, 1, 1, 10_000)))
        with pytest.raises(ContractValueError, match="strictly increase"):
            _evidence((_observation(8, 1, 1, 10_000), _observation(16, 1, 1, 10_000)))
        with pytest.raises(ContractValueError, match="inside the completeness"):
            _evidence((_observation(49, 0, 1, 10_000),))
        with pytest.raises(ContractValueError, match="schedule times must strictly increase"):
            _evidence(THREE, schedule_hours=(8, 8))
        with pytest.raises(ContractValueError, match="bounded tuple"):
            _evidence(list(THREE))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="FundingObservationV1"):
            _evidence(("rate",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="ExactRatioV1"):
            FundingObservationV1(event_time_ns=BASE_NS, ordinal=0, rate=0.0001)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="schedule_times_ns must be"):
            FundingEvidenceV1(
                symbol="BNBUSDT-PERP",
                posture=EvidencePosture.SYNTHETIC,
                completeness_start_ns=BASE_NS,
                completeness_end_ns=BASE_NS + HOUR_NS,
                observations=(),
                schedule_times_ns=[BASE_NS],  # type: ignore[arg-type]
            )

    def test_mapping_is_deterministic(self) -> None:
        mapping = _evidence(THREE).as_mapping()
        assert mapping["symbol"] == "BNBUSDT-PERP"
        observations = mapping["observations"]
        assert isinstance(observations, list)
        assert len(observations) == 3


class TestFundingLevel:
    def test_latest_rate_within_staleness_is_available(self) -> None:
        observed = funding_level(
            _evidence(THREE), as_of_ns=BASE_NS + 25 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert observed.feature_id == FUNDING_LEVEL_FEATURE_ID
        assert observed.status is FeatureValueStatus.AVAILABLE
        assert observed.value is not None
        # -1/8000 at the fixed-point scale.
        assert observed.value.mantissa == -125_000_000

    def test_missing_funding_is_unknown_never_zero(self) -> None:
        observed = funding_level(
            _evidence(()), as_of_ns=BASE_NS + 25 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert observed.status is FeatureValueStatus.UNKNOWN
        assert observed.value is None

    def test_stale_funding_is_stale_never_zero(self) -> None:
        observed = funding_level(
            _evidence(THREE), as_of_ns=BASE_NS + 40 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert observed.status is FeatureValueStatus.STALE
        assert observed.value is None

    def test_pre_observation_as_of_sees_nothing(self) -> None:
        observed = funding_level(
            _evidence(THREE), as_of_ns=BASE_NS + 7 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert observed.status is FeatureValueStatus.UNKNOWN

    def test_input_laws(self) -> None:
        with pytest.raises(ContractValueError, match="FundingEvidenceV1"):
            funding_level(None, as_of_ns=BASE_NS, max_staleness_ns=HOUR_NS)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="max_staleness_ns"):
            funding_level(_evidence(THREE), as_of_ns=BASE_NS, max_staleness_ns=0)


class TestFundingChange:
    def test_change_needs_two_observations(self) -> None:
        observed = funding_change(
            _evidence(THREE), as_of_ns=BASE_NS + 25 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert observed.feature_id == FUNDING_CHANGE_FEATURE_ID
        assert observed.status is FeatureValueStatus.AVAILABLE
        assert observed.value is not None
        # -1/8000 - 3/20000 = -11/40000.
        assert observed.value.mantissa == -275_000_000

    def test_one_observation_is_unknown(self) -> None:
        observed = funding_change(
            _evidence(THREE[:1]),
            as_of_ns=BASE_NS + 9 * HOUR_NS,
            max_staleness_ns=9 * HOUR_NS,
        )
        assert observed.status is FeatureValueStatus.UNKNOWN
        assert observed.value is None
        empty = funding_change(
            _evidence(()), as_of_ns=BASE_NS + 9 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert empty.status is FeatureValueStatus.UNKNOWN

    def test_stale_latest_observation_is_stale(self) -> None:
        observed = funding_change(
            _evidence(THREE), as_of_ns=BASE_NS + 40 * HOUR_NS, max_staleness_ns=9 * HOUR_NS
        )
        assert observed.status is FeatureValueStatus.STALE
        assert observed.value is None


class TestTimeToNextFunding:
    def test_next_known_schedule_time_yields_the_exact_delta(self) -> None:
        observed = time_to_next_funding(_evidence(THREE), as_of_ns=BASE_NS + 25 * HOUR_NS)
        assert observed.feature_id == TIME_TO_NEXT_FUNDING_FEATURE_ID
        assert observed.status is FeatureValueStatus.AVAILABLE
        assert observed.value is not None
        assert observed.value.mantissa == 7 * HOUR_NS * 10**12

    def test_no_known_future_schedule_is_unknown_not_a_default(self) -> None:
        observed = time_to_next_funding(
            _evidence(THREE, schedule_hours=()), as_of_ns=BASE_NS + 25 * HOUR_NS
        )
        assert observed.status is FeatureValueStatus.UNKNOWN
        assert observed.value is None
        past_only = time_to_next_funding(
            _evidence(THREE, schedule_hours=(8, 16)), as_of_ns=BASE_NS + 25 * HOUR_NS
        )
        assert past_only.status is FeatureValueStatus.UNKNOWN

    def test_input_laws(self) -> None:
        with pytest.raises(ContractValueError, match="FundingEvidenceV1"):
            time_to_next_funding(None, as_of_ns=BASE_NS)  # type: ignore[arg-type]


class TestScheduleIntervalVerdict:
    def test_uniform_spacing_is_unchanged(self) -> None:
        verdict = schedule_interval_verdict(_evidence(THREE), as_of_ns=BASE_NS + 33 * HOUR_NS)
        assert verdict is ScheduleIntervalVerdict.UNCHANGED

    def test_spacing_change_is_detected(self) -> None:
        verdict = schedule_interval_verdict(
            _evidence(THREE, schedule_hours=(8, 16, 20, 24)),
            as_of_ns=BASE_NS + 33 * HOUR_NS,
        )
        assert verdict is ScheduleIntervalVerdict.CHANGED

    def test_fewer_than_three_known_times_stay_unknown(self) -> None:
        verdict = schedule_interval_verdict(_evidence(THREE), as_of_ns=BASE_NS + 17 * HOUR_NS)
        assert verdict is ScheduleIntervalVerdict.UNKNOWN
        with pytest.raises(ContractValueError, match="FundingEvidenceV1"):
            schedule_interval_verdict(None, as_of_ns=BASE_NS)  # type: ignore[arg-type]
