from __future__ import annotations

import math
import warnings

import pytest

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, MAX_FIXED_MANTISSA, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import QualityState
from quant_edge.models.quantize import quantize_binary64
from quant_edge.regime.alphabet import AlphabetConfigV1
from quant_edge.regime.anomaly import (
    AnomalyReason,
    AnomalyStepV1,
    DisorderAssessmentV1,
    DisorderConfigV1,
    DisorderReason,
    DisorderState,
    RobustAnomalyConfigV1,
    RobustAnomalyScorer,
    fuse_disorder,
)
from quant_edge.regime.contracts import ObservationV1, StepStatus
from quant_edge.regime.ood_challengers import (
    OodBenchmarkSpecV1,
    OodChallengerResultV1,
    OodMethod,
    OodStatus,
    benchmark_ood_challengers,
)
from quant_edge.regime.soft_regime import (
    RegimeSpecV1,
    RegimeStepV1,
    SoftRegimeFilter,
    v1_regime_spec,
)

BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
HUNDREDTH = FIXED_POINT_SCALE // 100
THOUSANDTH = FIXED_POINT_SCALE // 1_000


def _ood_spec(*, max_samples: int = 128) -> OodBenchmarkSpecV1:
    return OodBenchmarkSpecV1(
        seed=20260718,
        max_samples=max_samples,
        max_features=4,
        contamination=make_ratio(1, 4),
        isolation_estimators=16,
        half_space_trees=8,
        half_space_depth=4,
        autoencoder_hidden_units=2,
        autoencoder_max_iterations=512,
        autoencoder_max_function_calls=16_384,
    )


def _ood_fixture() -> tuple[
    tuple[tuple[FixedPointV1, ...], ...], tuple[tuple[FixedPointV1, ...], ...]
]:
    training = tuple(
        (
            FixedPointV1(((index % 7) - 3) * HUNDREDTH),
            FixedPointV1((((index * 3) % 11) - 5) * HUNDREDTH),
        )
        for index in range(40)
    )
    assessment = (
        (FixedPointV1(0), FixedPointV1(0)),
        (FixedPointV1(10 * FIXED_POINT_SCALE), FixedPointV1(10 * FIXED_POINT_SCALE)),
    )
    return training, assessment


class TestOodChallengerBenchmark:
    def test_catalog_evaluates_all_eight_bounded_research_methods(self) -> None:
        training, assessment = _ood_fixture()

        results = benchmark_ood_challengers(
            training,
            assessment,
            labels=(False, True),
            spec=_ood_spec(),
        )

        assert tuple(result.method for result in results) == tuple(OodMethod)
        assert all(result.status is OodStatus.EVALUATED_RESEARCH_ONLY for result in results)
        autoencoder = results[-1]
        assert autoencoder.method is OodMethod.AUTOENCODER
        assert autoencoder.reason is None
        assert len(autoencoder.scores) == len(assessment)
        assert autoencoder.scores[1].mantissa > autoencoder.scores[0].mantissa

    def test_scores_and_digests_are_deterministic_and_fixed_point(self) -> None:
        training, assessment = _ood_fixture()
        first = benchmark_ood_challengers(
            training, assessment, labels=(False, True), spec=_ood_spec()
        )
        second = benchmark_ood_challengers(
            training, assessment, labels=(False, True), spec=_ood_spec()
        )

        assert first == second
        for result in first:
            assert result.score_digest is not None
            assert len(result.scores) == 2
            assert all(isinstance(score, FixedPointV1) for score in result.scores)

    def test_ecod_and_copod_match_versioned_train_only_reference_equations(self) -> None:
        negative_skew = (-10, 0, 0, 0, 0, 0, 0, 0)
        positive_skew = (0, 0, 0, 0, 0, 0, 0, 10)
        symmetric = (-3, -2, -1, 0, 0, 1, 2, 3)
        training = tuple(
            tuple(
                FixedPointV1(column[index] * FIXED_POINT_SCALE)
                for column in (negative_skew, positive_skew, symmetric)
            )
            for index in range(8)
        )
        assessment = (
            (
                FixedPointV1(FIXED_POINT_SCALE),
                FixedPointV1(-FIXED_POINT_SCALE),
                FixedPointV1(0),
            ),
        )

        by_method = {
            result.method: result
            for result in benchmark_ood_challengers(
                training, assessment, labels=None, spec=_ood_spec()
            )
        }

        # n=8 gives the held-out rank denominator 9. The first two assessment
        # coordinates oppose their training skew, while the third has exact zero skew.
        expected_ecod = 2 * math.log(9) + 2 * math.log(3 / 2)
        expected_copod = math.log(9) + 2 * math.log(3 / 2)
        assert by_method[OodMethod.ECOD].scores == (
            quantize_binary64(expected_ecod, field="expected ECOD"),
        )
        assert by_method[OodMethod.COPOD].scores == (
            quantize_binary64(expected_copod, field="expected COPOD"),
        )
        assert expected_ecod > expected_copod

    def test_assessment_batch_cannot_change_an_existing_score(self) -> None:
        training, assessment = _ood_fixture()
        one = benchmark_ood_challengers(training, assessment[:1], labels=None, spec=_ood_spec())
        two = benchmark_ood_challengers(training, assessment, labels=None, spec=_ood_spec())

        by_method_one = {result.method: result for result in one}
        by_method_two = {result.method: result for result in two}
        for method in OodMethod:
            assert by_method_one[method].status is OodStatus.EVALUATED_RESEARCH_ONLY
            assert by_method_two[method].status is OodStatus.EVALUATED_RESEARCH_ONLY
            assert by_method_one[method].scores == (by_method_two[method].scores[0],)

    def test_half_space_trees_match_reference_terminal_mass_golden(self) -> None:
        training, assessment = _ood_fixture()

        result = next(
            challenger
            for challenger in benchmark_ood_challengers(
                training, assessment, labels=None, spec=_ood_spec()
            )
            if challenger.method is OodMethod.HALF_SPACE_TREES
        )

        # Eight depth-four trees over a forty-row reference window have maximum
        # paper mass 8 * 40 * 2**4 = 5120. The deterministic workspaces terminate
        # at raw mass scores 1680 and 42; public scores invert that low-is-anomalous
        # ordering after exact normalization.
        assert result.scores == (
            FixedPointV1(671_875_000_000),
            FixedPointV1(991_796_875_000),
        )
        assert result.score_digest is not None
        assert (
            result.score_digest.hexdigest
            == "6a865a0094bb83bc3cff5a1879057d10a2eabe38754eee68869d0d33f32c3731"
        )

    def test_obvious_synthetic_outlier_is_recalled_by_the_bounded_battery(self) -> None:
        training, assessment = _ood_fixture()

        results = benchmark_ood_challengers(
            training, assessment, labels=(False, True), spec=_ood_spec()
        )

        recalls = tuple(
            result.top_k_recall
            for result in results
            if result.status is OodStatus.EVALUATED_RESEARCH_ONLY
        )
        assert len(recalls) == 8
        assert sum(recall == make_ratio(1, 1) for recall in recalls) >= 6

    def test_robust_pca_resists_bounded_training_contamination(self) -> None:
        clean = tuple(
            (
                FixedPointV1((index - 16) * FIXED_POINT_SCALE // 40),
                FixedPointV1(
                    (index - 16) * FIXED_POINT_SCALE // 40
                    + ((index % 3) - 1) * FIXED_POINT_SCALE // 1_000
                ),
            )
            for index in range(32)
        )
        contamination = tuple(
            (
                FixedPointV1(value * FIXED_POINT_SCALE),
                FixedPointV1(-value * FIXED_POINT_SCALE),
            )
            for value in (10, -10, 12, -12, 9, -9, 11, -11)
        )
        assessment = (
            (
                FixedPointV1(35 * FIXED_POINT_SCALE // 100),
                FixedPointV1(35 * FIXED_POINT_SCALE // 100),
            ),
            (
                FixedPointV1(35 * FIXED_POINT_SCALE // 100),
                FixedPointV1(-35 * FIXED_POINT_SCALE // 100),
            ),
        )

        def robust_pca(
            training: tuple[tuple[FixedPointV1, ...], ...],
        ) -> OodChallengerResultV1:
            return next(
                result
                for result in benchmark_ood_challengers(
                    training,
                    assessment,
                    labels=(False, True),
                    spec=_ood_spec(),
                )
                if result.method is OodMethod.ROBUST_PCA
            )

        uncontaminated = robust_pca(clean)
        contaminated = robust_pca(clean + contamination)

        assert contaminated.status is OodStatus.EVALUATED_RESEARCH_ONLY
        assert contaminated.scores == uncontaminated.scores
        assert contaminated.score_digest == uncontaminated.score_digest
        assert contaminated.scores[1].mantissa > contaminated.scores[0].mantissa
        assert contaminated.top_k_recall == make_ratio(1, 1)

    def test_absent_labels_never_fabricate_recall(self) -> None:
        training, assessment = _ood_fixture()

        results = benchmark_ood_challengers(training, assessment, labels=None, spec=_ood_spec())

        assert all(result.top_k_recall is None for result in results)

    def test_capacity_width_and_label_mismatches_fail_closed(self) -> None:
        training, assessment = _ood_fixture()
        with pytest.raises(ContractValueError, match="bounded by max_samples"):
            benchmark_ood_challengers(
                training, assessment, labels=None, spec=_ood_spec(max_samples=8)
            )
        with pytest.raises(ContractValueError, match="feature widths must match"):
            benchmark_ood_challengers(
                training,
                ((FixedPointV1(0),),),
                labels=None,
                spec=_ood_spec(),
            )
        with pytest.raises(ContractValueError, match="labels must align"):
            benchmark_ood_challengers(training, assessment, labels=(True,), spec=_ood_spec())

        one_row = training[:1]
        tiny = benchmark_ood_challengers(one_row, assessment, labels=None, spec=_ood_spec())
        assert all(result.status is OodStatus.DATA_INSUFFICIENT for result in tiny)
        assert all(not result.scores for result in tiny)

        collinear = tuple(
            (FixedPointV1(index * HUNDREDTH), FixedPointV1(index * 2 * HUNDREDTH))
            for index in range(8)
        )
        with warnings.catch_warnings(record=True) as emitted:
            warnings.simplefilter("always")
            degenerate = benchmark_ood_challengers(
                collinear,
                assessment,
                labels=None,
                spec=_ood_spec(),
            )
        assert emitted == []
        by_method = {result.method: result for result in degenerate}
        for method in (OodMethod.ROBUST_COVARIANCE, OodMethod.ROBUST_PCA):
            assert by_method[method].status is OodStatus.DATA_INSUFFICIENT
            assert by_method[method].scores == ()

    def test_invalid_contamination_and_non_fixed_inputs_are_rejected(self) -> None:
        with pytest.raises(ContractValueError, match=r"\(0, 0.5\)"):
            OodBenchmarkSpecV1(1, 8, 2, make_ratio(1, 2), 8, 4, 2)
        with pytest.raises(ContractValueError, match="half-space tree capacity"):
            OodBenchmarkSpecV1(1, 8, 2, make_ratio(1, 4), 8, 128, 16)
        with pytest.raises(ContractValueError, match="autoencoder_max_iterations"):
            OodBenchmarkSpecV1(
                1,
                8,
                2,
                make_ratio(1, 4),
                8,
                4,
                2,
                autoencoder_max_iterations=2,
            )
        training, assessment = _ood_fixture()
        malformed = (*training[:-1], (FixedPointV1(0), 0))
        with pytest.raises(ContractValueError, match="must contain FixedPointV1"):
            benchmark_ood_challengers(
                malformed,  # type: ignore[arg-type]
                assessment,
                labels=None,
                spec=_ood_spec(),
            )


def _observation(
    index: int,
    hundredths: int,
    quality: QualityState = QualityState.SYNTHETIC,
    *,
    event_time_index: int | None = None,
) -> ObservationV1:
    return ObservationV1(
        event_time_ns=BASE_NS
        + (index if event_time_index is None else event_time_index) * SECOND_NS,
        ordinal=index,
        value=FixedPointV1(hundredths * HUNDREDTH),
        quality=quality,
    )


def _fp_thousandths(thousandths: int) -> FixedPointV1:
    return FixedPointV1(thousandths * THOUSANDTH)


def _tiny_spec(*, floor_mantissa: int = THOUSANDTH) -> RegimeSpecV1:
    return RegimeSpecV1(
        spec_id="spec-tiny",
        states=("CALM", "WILD"),
        alphabet=AlphabetConfigV1(
            baseline_window=3,
            thresholds=(FixedPointV1(FIXED_POINT_SCALE), FixedPointV1(3 * FIXED_POINT_SCALE)),
        ),
        transition=(
            (_fp_thousandths(800), _fp_thousandths(200)),
            (_fp_thousandths(200), _fp_thousandths(800)),
        ),
        emission=(
            (
                _fp_thousandths(20),
                _fp_thousandths(150),
                _fp_thousandths(660),
                _fp_thousandths(150),
                _fp_thousandths(20),
            ),
            (
                _fp_thousandths(300),
                _fp_thousandths(150),
                _fp_thousandths(100),
                _fp_thousandths(150),
                _fp_thousandths(300),
            ),
        ),
        floor=FixedPointV1(floor_mantissa),
    )


class TestRegimeSpec:
    def test_v1_spec_is_lawful_and_maps(self) -> None:
        spec = v1_regime_spec()
        mapping = spec.as_mapping()
        assert mapping["states"] == ["QUIET", "TRENDING", "VOLATILE", "DISORDERED"]
        for row in spec.transition:
            assert sum(entry.mantissa for entry in row) == FIXED_POINT_SCALE
        for row in spec.emission:
            assert sum(entry.mantissa for entry in row) == FIXED_POINT_SCALE

    def test_rejects_bad_states(self) -> None:
        spec = v1_regime_spec()
        with pytest.raises(ContractValueError, match="spec_id"):
            RegimeSpecV1(
                spec_id="",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=spec.emission,
                floor=spec.floor,
            )
        with pytest.raises(ContractValueError, match="states must be a tuple"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=("ONLY",),
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=spec.emission,
                floor=spec.floor,
            )
        with pytest.raises(ContractValueError, match="unique"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=("A", "A", "B", "C"),
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=spec.emission,
                floor=spec.floor,
            )
        with pytest.raises(ContractValueError, match="alphabet must be AlphabetConfigV1"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=None,  # type: ignore[arg-type]
                transition=spec.transition,
                emission=spec.emission,
                floor=spec.floor,
            )

    def test_rejects_bad_transition_and_emission(self) -> None:
        spec = v1_regime_spec()
        with pytest.raises(ContractValueError, match="transition must carry one row"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=spec.transition[:3],
                emission=spec.emission,
                floor=spec.floor,
            )
        bad_row = (spec.transition[0][0],) * 3
        with pytest.raises(ContractValueError, match="width"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=(bad_row, *spec.transition[1:]),
                emission=spec.emission,
                floor=spec.floor,
            )
        unnormalized = (
            FixedPointV1(1),
            FixedPointV1(1),
            FixedPointV1(1),
            FixedPointV1(1),
        )
        with pytest.raises(ContractValueError, match="sum exactly to one"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=(unnormalized, *spec.transition[1:]),
                emission=spec.emission,
                floor=spec.floor,
            )
        with pytest.raises(ContractValueError, match="emission must carry one row"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=spec.emission[:2],
                floor=spec.floor,
            )
        zero_emission = (
            FixedPointV1(0),
            FixedPointV1(0),
            FixedPointV1(FIXED_POINT_SCALE),
            FixedPointV1(0),
            FixedPointV1(0),
        )
        with pytest.raises(ContractValueError, match="below the required minimum"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=(zero_emission, *spec.emission[1:]),
                floor=spec.floor,
            )

    def test_rejects_bad_floor(self) -> None:
        spec = v1_regime_spec()
        with pytest.raises(ContractValueError, match="floor cannot be negative"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=spec.emission,
                floor=FixedPointV1(-1),
            )
        with pytest.raises(ContractValueError, match="leave room for evidence"):
            RegimeSpecV1(
                spec_id="spec-1",
                states=spec.states,
                alphabet=spec.alphabet,
                transition=spec.transition,
                emission=spec.emission,
                floor=FixedPointV1(FIXED_POINT_SCALE // 4),
            )


class TestRegimeStepContract:
    def test_rejects_bad_probabilities_and_uncertainty(self) -> None:
        with pytest.raises(ContractValueError, match="sum exactly to one"):
            RegimeStepV1(
                spec_id="spec-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=0,
                probabilities=(1, 2),
                map_state="CALM",
                uncertainty=FixedPointV1(0),
            )
        with pytest.raises(ContractValueError, match="at least two states"):
            RegimeStepV1(
                spec_id="spec-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=0,
                probabilities=(FIXED_POINT_SCALE,),
                map_state="CALM",
                uncertainty=FixedPointV1(0),
            )
        with pytest.raises(ContractValueError, match="uncertainty must equal"):
            RegimeStepV1(
                spec_id="spec-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                symbol=0,
                probabilities=(FIXED_POINT_SCALE - 5, 5),
                map_state="CALM",
                uncertainty=FixedPointV1(0),
            )
        with pytest.raises(ContractValueError, match="symbol exists exactly"):
            RegimeStepV1(
                spec_id="spec-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.WARMUP,
                symbol=1,
                probabilities=(FIXED_POINT_SCALE - 5, 5),
                map_state="CALM",
                uncertainty=FixedPointV1(5),
            )
        with pytest.raises(ContractValueError, match="status must be StepStatus"):
            RegimeStepV1(
                spec_id="spec-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=1,  # type: ignore[arg-type]
                symbol=None,
                probabilities=(FIXED_POINT_SCALE - 5, 5),
                map_state="CALM",
                uncertainty=FixedPointV1(5),
            )

    def test_mapping_round_trips(self) -> None:
        step = RegimeStepV1(
            spec_id="spec-1",
            ordinal=0,
            event_time_ns=BASE_NS,
            status=StepStatus.OK,
            symbol=2,
            probabilities=(FIXED_POINT_SCALE - 5, 5),
            map_state="CALM",
            uncertainty=FixedPointV1(5),
        )
        mapping = step.as_mapping()
        assert mapping["probabilities"] == [str(FIXED_POINT_SCALE - 5), "5"]
        assert mapping["mapState"] == "CALM"


class TestSoftRegimeFilter:
    def test_rejects_bad_spec_observation_and_order(self) -> None:
        with pytest.raises(ContractValueError, match="spec must be RegimeSpecV1"):
            SoftRegimeFilter(None)  # type: ignore[arg-type]
        regime_filter = SoftRegimeFilter(_tiny_spec())
        with pytest.raises(ContractValueError, match="observation must be ObservationV1"):
            regime_filter.update(None)  # type: ignore[arg-type]
        regime_filter.update(_observation(0, 1_000))
        with pytest.raises(ContractValueError, match="ordinal-ordered"):
            regime_filter.update(_observation(0, 1_000))
        with pytest.raises(ContractValueError, match="event-time-ordered"):
            regime_filter.update(_observation(1, 1_000, event_time_index=-1))

    def test_warmup_keeps_uniform_posterior(self) -> None:
        regime_filter = SoftRegimeFilter(_tiny_spec())
        step = regime_filter.update(_observation(0, 1_000))
        assert step.status is StepStatus.WARMUP
        assert step.symbol is None
        assert step.probabilities == (FIXED_POINT_SCALE // 2, FIXED_POINT_SCALE // 2)

    def test_probabilities_always_sum_exactly_and_respect_floor(self) -> None:
        floor = 2 * THOUSANDTH
        regime_filter = SoftRegimeFilter(_tiny_spec(floor_mantissa=floor))
        for index in range(40):
            value = 1_000 + ((index * 37) % 21 - 10) // 10
            if index in (20, 25, 30):
                value += 400
            step = regime_filter.update(_observation(index, value))
            assert sum(step.probabilities) == FIXED_POINT_SCALE
            if step.status is StepStatus.OK:
                for mass in step.probabilities:
                    assert mass >= floor

    def test_extreme_symbols_move_map_state_toward_wild(self) -> None:
        regime_filter = SoftRegimeFilter(_tiny_spec())
        for index in range(3):
            regime_filter.update(_observation(index, 1_000))
        wild_mass_before: int | None = None
        step: RegimeStepV1 | None = None
        for index in range(3, 9):
            step = regime_filter.update(_observation(index, 1_000 + 300 * (index % 2)))
            if wild_mass_before is None:
                wild_mass_before = step.probabilities[1]
        assert step is not None
        assert wild_mass_before is not None
        assert step.probabilities[1] > wild_mass_before
        assert step.map_state == "WILD"
        assert step.uncertainty.mantissa == FIXED_POINT_SCALE - max(step.probabilities)

    def test_stale_suppresses_and_gap_resets_to_uniform(self) -> None:
        regime_filter = SoftRegimeFilter(_tiny_spec())
        for index in range(6):
            regime_filter.update(_observation(index, 1_000 + 300 * (index % 2)))
        suppressed = regime_filter.update(_observation(6, 1_000, QualityState.STALE))
        assert suppressed.status is StepStatus.SUPPRESSED
        reset = regime_filter.update(_observation(7, 1_000, QualityState.PARTIAL))
        assert reset.status is StepStatus.RESET
        assert reset.probabilities == (FIXED_POINT_SCALE // 2, FIXED_POINT_SCALE // 2)
        assert regime_filter.update(_observation(8, 1_000)).status is StepStatus.WARMUP


class TestAnomalyConfigAndStep:
    def test_config_rejects_bad_fields_and_maps(self) -> None:
        with pytest.raises(ContractValueError, match="scorer_id"):
            RobustAnomalyConfigV1(scorer_id="", window=4, z_threshold=FixedPointV1(1))
        with pytest.raises(ContractValueError, match="window"):
            RobustAnomalyConfigV1(scorer_id="scorer-1", window=1, z_threshold=FixedPointV1(1))
        with pytest.raises(ContractValueError, match="z_threshold"):
            RobustAnomalyConfigV1(scorer_id="scorer-1", window=4, z_threshold=FixedPointV1(0))
        mapping = RobustAnomalyConfigV1(
            scorer_id="scorer-1",
            window=4,
            z_threshold=FixedPointV1(1),
        ).as_mapping()
        assert mapping["scoreSemantics"] == "UNCALIBRATED_SCORE"

    def test_step_contract_laws(self) -> None:
        with pytest.raises(ContractValueError, match="only an OK step may exceed"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.WARMUP,
                score=None,
                exceeds=True,
                persistence=1,
                reasons=(AnomalyReason.THRESHOLD_EXCEEDED,),
            )
        with pytest.raises(ContractValueError, match="persistence counts"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                score=FixedPointV1(0),
                exceeds=False,
                persistence=2,
                reasons=(),
            )
        with pytest.raises(ContractValueError, match="reasons exist exactly"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                score=FixedPointV1(10 * FIXED_POINT_SCALE),
                exceeds=True,
                persistence=1,
                reasons=(),
            )
        with pytest.raises(ContractValueError, match="reasons must contain AnomalyReason"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                score=FixedPointV1(10 * FIXED_POINT_SCALE),
                exceeds=True,
                persistence=1,
                reasons=("THRESHOLD_EXCEEDED",),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="reasons must be a tuple"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                score=FixedPointV1(0),
                exceeds=False,
                persistence=0,
                reasons=[],  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="status must be StepStatus"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status="OK",  # type: ignore[arg-type]
                score=None,
                exceeds=False,
                persistence=0,
                reasons=(),
            )
        with pytest.raises(ContractValueError, match="exceeds must be boolean"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                score=None,
                exceeds=1,  # type: ignore[arg-type]
                persistence=0,
                reasons=(),
            )
        with pytest.raises(ContractValueError, match="score"):
            AnomalyStepV1(
                scorer_id="scorer-1",
                ordinal=0,
                event_time_ns=BASE_NS,
                status=StepStatus.OK,
                score=1.5,  # type: ignore[arg-type]
                exceeds=False,
                persistence=0,
                reasons=(),
            )


class TestRobustAnomalyScorer:
    def _scorer(self, *, window: int = 4, threshold_units: int = 6) -> RobustAnomalyScorer:
        return RobustAnomalyScorer(
            RobustAnomalyConfigV1(
                scorer_id="scorer-1",
                window=window,
                z_threshold=FixedPointV1(threshold_units * FIXED_POINT_SCALE),
            )
        )

    def test_rejects_bad_config_observation_and_order(self) -> None:
        with pytest.raises(ContractValueError, match="config must be RobustAnomalyConfigV1"):
            RobustAnomalyScorer(None)  # type: ignore[arg-type]
        scorer = self._scorer()
        with pytest.raises(ContractValueError, match="observation must be ObservationV1"):
            scorer.update(None)  # type: ignore[arg-type]
        scorer.update(_observation(0, 1_000))
        with pytest.raises(ContractValueError, match="ordinal-ordered"):
            scorer.update(_observation(0, 1_000))
        with pytest.raises(ContractValueError, match="event-time-ordered"):
            scorer.update(_observation(1, 1_000, event_time_index=-1))

    def test_warmup_then_scores_and_flags_spikes_with_persistence(self) -> None:
        scorer = self._scorer()
        for index, value in enumerate((1_000, 1_010, 990, 1_005)):
            step = scorer.update(_observation(index, value))
            assert step.status is StepStatus.WARMUP
            assert step.score is None
        calm = scorer.update(_observation(4, 1_003))
        assert calm.status is StepStatus.OK
        assert calm.score is not None
        assert not calm.exceeds
        spike = scorer.update(_observation(5, 1_500))
        assert spike.exceeds
        assert spike.persistence == 1
        assert spike.reasons == (AnomalyReason.THRESHOLD_EXCEEDED,)
        second = scorer.update(_observation(6, 1_600))
        assert second.persistence == 2
        settled = scorer.update(_observation(7, 1_004))
        assert not settled.exceeds
        assert settled.persistence == 0

    def test_zero_mad_zero_deviation_scores_zero(self) -> None:
        scorer = self._scorer(window=3)
        for index in range(3):
            scorer.update(_observation(index, 1_000))
        step = scorer.update(_observation(3, 1_000))
        assert step.status is StepStatus.OK
        assert step.score == FixedPointV1(0)
        assert not step.exceeds

    def test_zero_mad_nonzero_deviation_is_unbounded_surprise(self) -> None:
        scorer = self._scorer(window=3)
        for index in range(3):
            scorer.update(_observation(index, 1_000))
        step = scorer.update(_observation(3, 1_001))
        assert step.exceeds
        assert step.score is None
        assert step.reasons == (AnomalyReason.ZERO_MAD_DEVIATION,)

    def test_near_zero_mad_extreme_deviation_is_bounded_surprise(self) -> None:
        scorer = self._scorer(window=3)
        for index, mantissa in enumerate((-1, 0, 1)):
            scorer.update(
                ObservationV1(
                    event_time_ns=BASE_NS + index * SECOND_NS,
                    ordinal=index,
                    value=FixedPointV1(mantissa),
                    quality=QualityState.SYNTHETIC,
                )
            )

        step = scorer.update(
            ObservationV1(
                event_time_ns=BASE_NS + 3 * SECOND_NS,
                ordinal=3,
                value=FixedPointV1(MAX_FIXED_MANTISSA),
                quality=QualityState.SYNTHETIC,
            )
        )

        assert step.exceeds
        assert step.score is None
        assert step.reasons == (AnomalyReason.THRESHOLD_EXCEEDED,)

    def test_stale_suppresses_and_gap_resets(self) -> None:
        scorer = self._scorer()
        for index, value in enumerate((1_000, 1_010, 990, 1_005)):
            scorer.update(_observation(index, value))
        scorer.update(_observation(4, 1_500))
        suppressed = scorer.update(_observation(5, 1_500, QualityState.STALE))
        assert suppressed.status is StepStatus.SUPPRESSED
        assert suppressed.persistence == 1
        reset = scorer.update(_observation(6, 1_500, QualityState.GAPPED))
        assert reset.status is StepStatus.RESET
        assert reset.persistence == 0
        assert scorer.update(_observation(7, 1_500)).status is StepStatus.WARMUP


class TestDisorderFusion:
    def _config(self) -> DisorderConfigV1:
        return DisorderConfigV1(
            fusion_id="fusion-1",
            alarm_recency_bars=5,
            persistence_watch=2,
            persistence_ood=4,
            uncertainty_threshold=FixedPointV1(FIXED_POINT_SCALE // 2),
        )

    def test_config_rejects_bad_fields(self) -> None:
        with pytest.raises(ContractValueError, match="fusion_id"):
            DisorderConfigV1(
                fusion_id="",
                alarm_recency_bars=5,
                persistence_watch=2,
                persistence_ood=4,
                uncertainty_threshold=FixedPointV1(1),
            )
        with pytest.raises(ContractValueError, match="persistence_ood"):
            DisorderConfigV1(
                fusion_id="fusion-1",
                alarm_recency_bars=5,
                persistence_watch=4,
                persistence_ood=2,
                uncertainty_threshold=FixedPointV1(1),
            )
        with pytest.raises(ContractValueError, match="uncertainty_threshold"):
            DisorderConfigV1(
                fusion_id="fusion-1",
                alarm_recency_bars=5,
                persistence_watch=2,
                persistence_ood=4,
                uncertainty_threshold=FixedPointV1(0),
            )
        mapping = self._config().as_mapping()
        assert mapping["persistenceOod"] == 4

    def test_assessment_contract(self) -> None:
        with pytest.raises(ContractValueError, match="state must be DisorderState"):
            DisorderAssessmentV1(fusion_id="fusion-1", state="NORMAL", reasons=())  # type: ignore[arg-type]
        with pytest.raises(ContractValueError, match="reasons must be a tuple"):
            DisorderAssessmentV1(
                fusion_id="fusion-1",
                state=DisorderState.NORMAL,
                reasons=[],  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="reasons must contain DisorderReason"):
            DisorderAssessmentV1(
                fusion_id="fusion-1",
                state=DisorderState.NORMAL,
                reasons=("INPUT_QUALITY",),  # type: ignore[arg-type]
            )
        with pytest.raises(ContractValueError, match="sorted"):
            DisorderAssessmentV1(
                fusion_id="fusion-1",
                state=DisorderState.WATCH,
                reasons=(
                    DisorderReason.REGIME_UNCERTAIN,
                    DisorderReason.ANOMALY_PERSISTENCE_WATCH,
                ),
            )
        mapping = DisorderAssessmentV1(
            fusion_id="fusion-1",
            state=DisorderState.NORMAL,
            reasons=(),
        ).as_mapping()
        assert mapping["state"] == "NORMAL"

    def test_bad_quality_is_unknown(self) -> None:
        assessment = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.GAPPED,
            last_alarm_age=None,
            anomaly_persistence=0,
            regime_uncertainty=FixedPointV1(0),
        )
        assert assessment.state is DisorderState.UNKNOWN
        assert assessment.reasons == (DisorderReason.INPUT_QUALITY,)

    def test_quiet_inputs_are_normal(self) -> None:
        assessment = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=None,
            anomaly_persistence=0,
            regime_uncertainty=FixedPointV1(0),
        )
        assert assessment.state is DisorderState.NORMAL
        assert assessment.reasons == ()

    def test_recent_changepoint_is_disordered(self) -> None:
        assessment = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=3,
            anomaly_persistence=0,
            regime_uncertainty=FixedPointV1(0),
        )
        assert assessment.state is DisorderState.DISORDERED
        assert DisorderReason.RECENT_CHANGEPOINT in assessment.reasons
        aged_out = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=6,
            anomaly_persistence=0,
            regime_uncertainty=FixedPointV1(0),
        )
        assert aged_out.state is DisorderState.NORMAL

    def test_persistence_escalates_watch_then_ood(self) -> None:
        watch = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=None,
            anomaly_persistence=2,
            regime_uncertainty=FixedPointV1(0),
        )
        assert watch.state is DisorderState.WATCH
        assert watch.reasons == (DisorderReason.ANOMALY_PERSISTENCE_WATCH,)
        ood = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=None,
            anomaly_persistence=4,
            regime_uncertainty=FixedPointV1(0),
        )
        assert ood.state is DisorderState.OOD_SUSPECT
        assert ood.reasons == (DisorderReason.ANOMALY_PERSISTENCE_OOD,)

    def test_ood_outranks_disordered(self) -> None:
        assessment = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=1,
            anomaly_persistence=9,
            regime_uncertainty=FixedPointV1(0),
        )
        assert assessment.state is DisorderState.OOD_SUSPECT
        assert assessment.reasons == (
            DisorderReason.ANOMALY_PERSISTENCE_OOD,
            DisorderReason.RECENT_CHANGEPOINT,
        )

    def test_regime_uncertainty_and_unavailability_watch(self) -> None:
        uncertain = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=None,
            anomaly_persistence=0,
            regime_uncertainty=FixedPointV1(FIXED_POINT_SCALE // 2),
        )
        assert uncertain.state is DisorderState.WATCH
        assert uncertain.reasons == (DisorderReason.REGIME_UNCERTAIN,)
        unavailable = fuse_disorder(
            config=self._config(),
            input_quality=QualityState.COMPLETE,
            last_alarm_age=None,
            anomaly_persistence=0,
            regime_uncertainty=None,
        )
        assert unavailable.state is DisorderState.WATCH
        assert unavailable.reasons == (DisorderReason.REGIME_STATE_UNAVAILABLE,)

    def test_rejects_bad_inputs(self) -> None:
        with pytest.raises(ContractValueError, match="config must be DisorderConfigV1"):
            fuse_disorder(
                config=None,  # type: ignore[arg-type]
                input_quality=QualityState.COMPLETE,
                last_alarm_age=None,
                anomaly_persistence=0,
                regime_uncertainty=None,
            )
        with pytest.raises(ContractValueError, match="last_alarm_age"):
            fuse_disorder(
                config=self._config(),
                input_quality=QualityState.COMPLETE,
                last_alarm_age=-1,
                anomaly_persistence=0,
                regime_uncertainty=None,
            )
        with pytest.raises(ContractValueError, match="regime_uncertainty"):
            fuse_disorder(
                config=self._config(),
                input_quality=QualityState.COMPLETE,
                last_alarm_age=None,
                anomaly_persistence=0,
                regime_uncertainty=0.5,  # type: ignore[arg-type]
            )
