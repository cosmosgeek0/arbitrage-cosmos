from __future__ import annotations

from fractions import Fraction

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.survival.contracts import (
    CauseSetV1,
    SubjectStatus,
    SubjectV1,
    SurvivalCohortV1,
    SurvivalTarget,
    TimeGridV1,
    fraction_to_fixed_point,
)
from quant_edge.survival.hazard_model import (
    DiscreteHazardModelV1,
    HazardModelConfigV1,
    PredictedBinV1,
    PredictionStatus,
    StratumBinV1,
    StratumPredictionV1,
    StratumTableV1,
    fit_discrete_hazard,
)
from quant_edge.survival.km import estimate_kaplan_meier

SECOND_NS = 1_000_000_000
CAUSES = CauseSetV1(cause_ids=("A", "B"))
GRID = TimeGridV1(
    grid_id="q11.test.grid",
    times_ns=(10 * SECOND_NS, 20 * SECOND_NS, 30 * SECOND_NS),
)


def subject(
    subject_id: str,
    seconds: int,
    cause_id: str | None,
    *,
    stratum_id: str = "HIGH",
) -> SubjectV1:
    return SubjectV1(
        subject_id=subject_id,
        group_id=subject_id,
        stratum_id=stratum_id,
        duration_ns=seconds * SECOND_NS,
        status=SubjectStatus.RIGHT_CENSORED if cause_id is None else SubjectStatus.EVENT,
        cause_id=cause_id,
        quality=QualityState.SYNTHETIC,
    )


def cohort(subjects: tuple[SubjectV1, ...]) -> SurvivalCohortV1:
    return SurvivalCohortV1(
        cohort_id="q11.test.hazard",
        target=SurvivalTarget.TIME_TO_CONVERGENCE,
        causes=CAUSES,
        posture=EvidencePosture.SYNTHETIC,
        subjects=subjects,
    )


def config(
    *,
    smoothing_numerator: int = 1,
    smoothing_denominator: int = 1,
    min_risk_set: int = 2,
) -> HazardModelConfigV1:
    return HazardModelConfigV1(
        model_version="q11.test.model.v1",
        grid=GRID,
        causes=CAUSES,
        smoothing=make_ratio(smoothing_numerator, smoothing_denominator),
        min_risk_set=min_risk_set,
    )


GOLDEN_COHORT = cohort(
    (
        subject("h1", 5, "A"),
        subject("h2", 10, "B"),
        subject("h3", 15, None),
        subject("h4", 25, "A"),
        subject("h5", 40, None),
        subject("l1", 30, "B", stratum_id="LOW"),
        subject("l2", 35, None, stratum_id="LOW"),
        subject("l3", 8, None, stratum_id="LOW"),
        subject("t1", 5, "A", stratum_id="THIN"),
    )
)


class TestFit:
    def test_hand_verified_sufficient_statistics(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        assert [table.stratum_id for table in model.strata] == ["HIGH", "LOW", "THIN"]
        high = model.strata[0]
        assert high.subjects == 5
        assert high.beyond_grid == 1
        assert [bin.as_mapping() for bin in high.bins] == [
            {
                "atRisk": 5,
                "binIndex": 0,
                "censored": 0,
                "endNs": str(10 * SECOND_NS),
                "events": [1, 1],
            },
            {
                "atRisk": 3,
                "binIndex": 1,
                "censored": 1,
                "endNs": str(20 * SECOND_NS),
                "events": [0, 0],
            },
            {
                "atRisk": 2,
                "binIndex": 2,
                "censored": 0,
                "endNs": str(30 * SECOND_NS),
                "events": [1, 0],
            },
        ]
        low = model.strata[1]
        assert low.subjects == 3
        assert low.beyond_grid == 1
        assert [bin.at_risk for bin in low.bins] == [3, 2, 2]
        assert [bin.censored for bin in low.bins] == [1, 0, 0]
        assert low.bins[2].events == (0, 1)

    def test_beyond_grid_subjects_stay_at_risk_everywhere(self) -> None:
        model = fit_discrete_hazard(
            cohort((subject("s1", 40, "A"), subject("s2", 5, "B"))), config()
        )
        table = model.strata[0]
        assert table.beyond_grid == 1
        assert [bin.at_risk for bin in table.bins] == [2, 1, 1]
        # The beyond-grid event never lands in any bin: administrative censoring.
        assert [bin.total_events for bin in table.bins] == [1, 0, 0]

    def test_rejects_mismatched_causes_and_types(self) -> None:
        other = HazardModelConfigV1(
            model_version="q11.test.model.v2",
            grid=GRID,
            causes=CauseSetV1(cause_ids=("A",)),
            smoothing=make_ratio(1, 1),
            min_risk_set=1,
        )
        with pytest.raises(ContractValueError, match="share one cause set"):
            fit_discrete_hazard(GOLDEN_COHORT, other)
        with pytest.raises(ContractValueError, match="SurvivalCohortV1"):
            fit_discrete_hazard("cohort", config())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="HazardModelConfigV1"):
            fit_discrete_hazard(GOLDEN_COHORT, "config")  # type: ignore[arg-type]


class TestPredict:
    def test_hand_verified_laplace_predictions(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        prediction = model.predict("HIGH")
        assert prediction is not None
        assert prediction.known_bins == 3
        # alpha=1, K=2: bin0 denom 8, bin1 denom 6, bin2 denom 5.
        expected_hazards = (
            (Fraction(1, 4), Fraction(1, 4)),
            (Fraction(1, 6), Fraction(1, 6)),
            (Fraction(2, 5), Fraction(1, 5)),
        )
        expected_survival = (Fraction(1, 2), Fraction(1, 3), Fraction(2, 15))
        expected_cif_a = (Fraction(1, 4), Fraction(1, 3), Fraction(7, 15))
        expected_cif_b = (Fraction(1, 4), Fraction(1, 3), Fraction(2, 5))
        for index, predicted in enumerate(prediction.bins):
            assert predicted.status is PredictionStatus.KNOWN
            assert predicted.hazards is not None
            assert predicted.incidence is not None
            assert predicted.hazards[0] == fraction_to_fixed_point(expected_hazards[index][0])
            assert predicted.hazards[1] == fraction_to_fixed_point(expected_hazards[index][1])
            assert predicted.survival == fraction_to_fixed_point(expected_survival[index])
            assert predicted.incidence[0] == fraction_to_fixed_point(expected_cif_a[index])
            assert predicted.incidence[1] == fraction_to_fixed_point(expected_cif_b[index])

    def test_smoothed_outcome_simplex_is_conserved(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        prediction = model.predict("LOW")
        assert prediction is not None
        final = prediction.bins[-1]
        assert final.survival is not None
        assert final.incidence is not None
        total = final.survival.mantissa + sum(value.mantissa for value in final.incidence)
        assert abs(total - 10**12) <= 3

    def test_thin_stratum_is_unknown_from_the_first_thin_bin(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        prediction = model.predict("THIN")
        assert prediction is not None
        assert prediction.known_bins == 0
        for predicted in prediction.bins:
            assert predicted.status is PredictionStatus.UNKNOWN
            assert predicted.hazards is None
            assert predicted.survival is None
            assert predicted.incidence is None

    def test_unknown_is_a_suffix_once_risk_set_thins(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config(min_risk_set=3))
        prediction = model.predict("HIGH")
        assert prediction is not None
        assert prediction.known_bins == 2
        assert prediction.bins[2].status is PredictionStatus.UNKNOWN

    def test_unseen_stratum_returns_none(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        assert model.predict("UNSEEN") is None
        assert model.stratum("UNSEEN") is None

    def test_horizon_accessors(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        prediction = model.predict("HIGH")
        assert prediction is not None
        assert prediction.survival_at(10 * SECOND_NS) == fraction_to_fixed_point(Fraction(1, 2))
        assert prediction.event_probability_at(0, 20 * SECOND_NS) == (
            fraction_to_fixed_point(Fraction(1, 3))
        )
        with pytest.raises(ContractValueError, match="not a grid time"):
            prediction.survival_at(15 * SECOND_NS)
        with pytest.raises(ContractValueError, match="cause_id_index"):
            prediction.event_probability_at(5, 20 * SECOND_NS)
        thin = model.predict("THIN")
        assert thin is not None
        assert thin.survival_at(10 * SECOND_NS) is None
        assert thin.event_probability_at(0, 10 * SECOND_NS) is None

    def test_life_table_equals_km_on_aligned_grid(self) -> None:
        # Durations only on bin ends, no smoothing: the model's survival is KM.
        aligned = cohort(
            (
                subject("s1", 10, "A"),
                subject("s2", 10, None),
                subject("s3", 20, "B"),
                subject("s4", 30, "A"),
                subject("s5", 30, None),
            )
        )
        model = fit_discrete_hazard(aligned, config(smoothing_numerator=0, min_risk_set=1))
        prediction = model.predict("HIGH")
        assert prediction is not None
        km = estimate_kaplan_meier(aligned)
        for predicted in prediction.bins:
            assert predicted.survival == km.survival_at(predicted.end_ns)


class TestConfigAndContracts:
    def test_config_validation(self) -> None:
        with pytest.raises(ContractValueError, match="grid"):
            HazardModelConfigV1(
                model_version="m",
                grid="grid",  # type: ignore[arg-type]
                causes=CAUSES,
                smoothing=make_ratio(1, 1),
                min_risk_set=1,
            )
        with pytest.raises(ContractValueError, match="causes"):
            HazardModelConfigV1(
                model_version="m",
                grid=GRID,
                causes=("A",),  # type: ignore[arg-type]
                smoothing=make_ratio(1, 1),
                min_risk_set=1,
            )
        with pytest.raises(ContractValueError, match="smoothing"):
            HazardModelConfigV1(
                model_version="m",
                grid=GRID,
                causes=CAUSES,
                smoothing=1,  # type: ignore[arg-type]
                min_risk_set=1,
            )
        with pytest.raises(ContractValueError, match="smoothing"):
            HazardModelConfigV1(
                model_version="m",
                grid=GRID,
                causes=CAUSES,
                smoothing=make_ratio(-1, 1),
                min_risk_set=1,
            )
        with pytest.raises(ContractValueError, match="smoothing"):
            HazardModelConfigV1(
                model_version="m",
                grid=GRID,
                causes=CAUSES,
                smoothing=make_ratio(1_001, 1),
                min_risk_set=1,
            )
        with pytest.raises(ContractValueError, match="min_risk_set"):
            HazardModelConfigV1(
                model_version="m",
                grid=GRID,
                causes=CAUSES,
                smoothing=make_ratio(1, 1),
                min_risk_set=0,
            )
        assert config().as_mapping()["minRiskSet"] == 2

    def test_bin_and_table_contracts(self) -> None:
        with pytest.raises(ContractValueError, match="exceed the bin risk set"):
            StratumBinV1(bin_index=0, end_ns=SECOND_NS, at_risk=1, events=(1, 1), censored=0)
        with pytest.raises(ContractValueError, match="non-empty"):
            StratumBinV1(bin_index=0, end_ns=SECOND_NS, at_risk=1, events=(), censored=0)
        with pytest.raises(ContractValueError, match="events\\[0\\]"):
            StratumBinV1(bin_index=0, end_ns=SECOND_NS, at_risk=1, events=(-1,), censored=0)
        valid_bin = StratumBinV1(
            bin_index=0, end_ns=SECOND_NS, at_risk=1, events=(1, 0), censored=0
        )
        with pytest.raises(ContractValueError, match="dense and ordered"):
            StratumTableV1(
                stratum_id="s",
                subjects=1,
                beyond_grid=0,
                bins=(
                    StratumBinV1(
                        bin_index=1, end_ns=SECOND_NS, at_risk=1, events=(1, 0), censored=0
                    ),
                ),
            )
        with pytest.raises(ContractValueError, match="non-empty"):
            StratumTableV1(stratum_id="s", subjects=1, beyond_grid=0, bins=())
        with pytest.raises(ContractValueError, match="StratumBinV1"):
            StratumTableV1(
                stratum_id="s",
                subjects=1,
                beyond_grid=0,
                bins=("x",),  # type: ignore[arg-type]
            )
        table = StratumTableV1(stratum_id="s", subjects=1, beyond_grid=0, bins=(valid_bin,))
        assert table.as_mapping()["subjects"] == 1

    def test_model_contract(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        with pytest.raises(ContractValueError, match="config"):
            DiscreteHazardModelV1(config="c", strata=model.strata)  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="non-empty"):
            DiscreteHazardModelV1(config=model.config, strata=())
        with pytest.raises(ContractValueError, match="StratumTableV1"):
            DiscreteHazardModelV1(config=model.config, strata=("x",))  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="sorted"):
            DiscreteHazardModelV1(config=model.config, strata=(model.strata[1], model.strata[0]))
        short_table = StratumTableV1(
            stratum_id="zz",
            subjects=1,
            beyond_grid=0,
            bins=(
                StratumBinV1(bin_index=0, end_ns=SECOND_NS, at_risk=1, events=(1, 0), censored=0),
            ),
        )
        with pytest.raises(ContractValueError, match="every grid bin"):
            DiscreteHazardModelV1(config=model.config, strata=(short_table,))
        misaligned = StratumTableV1(
            stratum_id="zz",
            subjects=1,
            beyond_grid=0,
            bins=tuple(
                StratumBinV1(
                    bin_index=index,
                    end_ns=GRID.times_ns[index],
                    at_risk=1,
                    events=(1,) if index == 0 else (0,),
                    censored=0,
                )
                for index in range(3)
            ),
        )
        with pytest.raises(ContractValueError, match="align with the cause set"):
            DiscreteHazardModelV1(config=model.config, strata=(misaligned,))
        assert isinstance(model.as_mapping()["strata"], list)

    def test_predicted_bin_contract(self) -> None:
        with pytest.raises(ContractValueError, match="KNOWN bins must carry"):
            PredictedBinV1(
                bin_index=0,
                end_ns=SECOND_NS,
                status=PredictionStatus.KNOWN,
                hazards=None,
                survival=None,
                incidence=None,
            )
        with pytest.raises(ContractValueError, match="UNKNOWN bins must carry no"):
            PredictedBinV1(
                bin_index=0,
                end_ns=SECOND_NS,
                status=PredictionStatus.UNKNOWN,
                hazards=None,
                survival=fraction_to_fixed_point(Fraction(1, 2)),
                incidence=None,
            )
        with pytest.raises(ContractValueError, match="PredictionStatus"):
            PredictedBinV1(
                bin_index=0,
                end_ns=SECOND_NS,
                status="KNOWN",  # type: ignore[arg-type]
                hazards=None,
                survival=None,
                incidence=None,
            )

    def test_stratum_prediction_contract(self) -> None:
        model = fit_discrete_hazard(GOLDEN_COHORT, config())
        prediction = model.predict("HIGH")
        assert prediction is not None
        with pytest.raises(ContractValueError, match="grid"):
            StratumPredictionV1(
                stratum_id="s",
                grid="grid",  # type: ignore[arg-type]
                known_bins=0,
                bins=prediction.bins,
            )
        with pytest.raises(ContractValueError, match="every grid bin"):
            StratumPredictionV1(stratum_id="s", grid=GRID, known_bins=1, bins=prediction.bins[:1])
        with pytest.raises(ContractValueError, match="prefix"):
            StratumPredictionV1(stratum_id="s", grid=GRID, known_bins=1, bins=prediction.bins)
        with pytest.raises(ContractValueError, match="PredictedBinV1"):
            StratumPredictionV1(
                stratum_id="s",
                grid=GRID,
                known_bins=0,
                bins=("x", "y", "z"),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="dense and ordered"):
            StratumPredictionV1(
                stratum_id="s",
                grid=GRID,
                known_bins=3,
                bins=(prediction.bins[0], prediction.bins[2], prediction.bins[1]),
            )
        assert prediction.as_mapping()["knownBins"] == 3
