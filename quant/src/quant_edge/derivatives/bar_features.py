from __future__ import annotations

import itertools
from typing import Final

from quant_edge.derivatives.basis_path import BASIS_ALIGNMENT
from quant_edge.features.domains import BarDomain, BarV1
from quant_edge.features.fixedpoint import (
    FP_ONE,
    FP_ZERO,
    FixedPointV1,
    fp_div,
    fp_from_int,
    fp_sub,
    round_half_even,
)
from quant_edge.features.primitives import FeatureImplementationV1
from quant_edge.features.registry import FeatureCardV1, FeatureRegistryV1

PERSISTENCE_WINDOW: Final = 8
CONVERGING_WINDOW: Final = 8

Q08_REGISTRY_VERSION: Final = "q08-derivatives-v1"


def _bar_basis(bar: BarV1) -> FixedPointV1 | None:
    """The quantized basis close of one complete bar, or None.

    Basis bars store fixed-point mantissas at ``BASIS_ALIGNMENT``; the division is
    exact by the basis-bar construction law and rounds half-even only if a foreign
    bar with non-multiple alignment is supplied.
    """

    if not bar.complete or bar.last_value_aligned is None:
        return None
    return FixedPointV1(round_half_even(bar.last_value_aligned, BASIS_ALIGNMENT))


def _closes(bars: tuple[BarV1, ...]) -> list[FixedPointV1]:
    return [close for close in (_bar_basis(bar) for bar in bars) if close is not None]


# -- basis gap velocity -----------------------------------------------------------------


class _StreamingGapVelocity:
    __slots__ = ("__previous",)

    def __init__(self) -> None:
        self.__previous: FixedPointV1 | None = None

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _bar_basis(bar)
        if close is None:
            return None
        previous = self.__previous
        self.__previous = close
        if previous is None:
            return None
        return fp_sub(close, previous)


def _batch_gap_velocity(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    if not bars or _bar_basis(bars[-1]) is None:
        return None
    closes = _closes(bars)
    if len(closes) < 2:
        return None
    return fp_sub(closes[-1], closes[-2])


# -- basis gap acceleration ---------------------------------------------------------------


class _StreamingGapAcceleration:
    __slots__ = ("__previous", "__previous_velocity")

    def __init__(self) -> None:
        self.__previous: FixedPointV1 | None = None
        self.__previous_velocity: FixedPointV1 | None = None

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _bar_basis(bar)
        if close is None:
            return None
        previous = self.__previous
        self.__previous = close
        if previous is None:
            return None
        velocity = fp_sub(close, previous)
        previous_velocity = self.__previous_velocity
        self.__previous_velocity = velocity
        if previous_velocity is None:
            return None
        return fp_sub(velocity, previous_velocity)


def _batch_gap_acceleration(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    if not bars or _bar_basis(bars[-1]) is None:
        return None
    closes = _closes(bars)
    if len(closes) < 3:
        return None
    latest = fp_sub(closes[-1], closes[-2])
    previous = fp_sub(closes[-2], closes[-3])
    return fp_sub(latest, previous)


# -- basis sign persistence -------------------------------------------------------------


def _sign(value: FixedPointV1) -> int:
    if value.mantissa > 0:
        return 1
    if value.mantissa < 0:
        return -1
    return 0


class _StreamingSignPersistence:
    __slots__ = ("__run", "__sign")

    def __init__(self) -> None:
        self.__sign = 0
        self.__run = 0

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _bar_basis(bar)
        if close is None:
            # An incomplete or empty bar breaks the run conservatively.
            self.__sign = 0
            self.__run = 0
            return None
        sign = _sign(close)
        if sign == 0:
            self.__sign = 0
            self.__run = 0
            return fp_from_int(0)
        if sign == self.__sign:
            self.__run = min(self.__run + 1, PERSISTENCE_WINDOW)
        else:
            self.__sign = sign
            self.__run = 1
        return fp_from_int(self.__run)


def _batch_sign_persistence(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    if not bars:
        return None
    latest = _bar_basis(bars[-1])
    if latest is None:
        return None
    sign = _sign(latest)
    if sign == 0:
        return fp_from_int(0)
    run = 0
    for bar in reversed(bars):
        close = _bar_basis(bar)
        if close is None or _sign(close) != sign or run == PERSISTENCE_WINDOW:
            break
        run += 1
    return fp_from_int(run)


# -- basis converging fraction ----------------------------------------------------------


def _converging_fraction(closes: list[FixedPointV1]) -> FixedPointV1:
    converging = sum(
        1
        for previous, current in itertools.pairwise(closes)
        if abs(current.mantissa) < abs(previous.mantissa)
    )
    return fp_div(fp_from_int(converging), fp_from_int(CONVERGING_WINDOW))


class _StreamingConvergingFraction:
    __slots__ = ("__closes",)

    def __init__(self) -> None:
        self.__closes: list[FixedPointV1] = []

    def update(self, bar: BarV1) -> FixedPointV1 | None:
        close = _bar_basis(bar)
        if close is None:
            # A broken window cannot pretend continuity across the break.
            self.__closes = []
            return None
        self.__closes.append(close)
        if len(self.__closes) > CONVERGING_WINDOW + 1:
            self.__closes.pop(0)
        if len(self.__closes) < CONVERGING_WINDOW + 1:
            return None
        return _converging_fraction(self.__closes)


def _batch_converging_fraction(bars: tuple[BarV1, ...]) -> FixedPointV1 | None:
    if not bars or _bar_basis(bars[-1]) is None:
        return None
    tail: list[FixedPointV1] = []
    for bar in reversed(bars):
        close = _bar_basis(bar)
        if close is None:
            break
        tail.append(close)
        if len(tail) == CONVERGING_WINDOW + 1:
            break
    if len(tail) < CONVERGING_WINDOW + 1:
        return None
    tail.reverse()
    return _converging_fraction(tail)


def _card(
    name: str,
    hypothesis: str,
    *,
    unit_id: str,
    update_rule: str,
    failure_modes: tuple[str, ...],
    lower_bound: FixedPointV1 | None = None,
    upper_bound: FixedPointV1 | None = None,
    computational_cost: str = "O_1_PER_BAR",
) -> FeatureCardV1:
    return FeatureCardV1(
        name=name,
        version="v1",
        economic_hypothesis=hypothesis,
        inputs=("basis_bar_series",),
        window_law=(
            "complete basis bars only; incomplete, empty or gap-intersecting bars "
            "yield no value; difference features use the last complete close and "
            "windowed features reset their windows at such bars"
        ),
        domain=BarDomain.WALL_TIME,
        normalization_cohort="spot-perp-pair-self",
        missing_behavior="missing basis evidence yields UNKNOWN, never zero",
        stale_behavior="staleness is judged by the value-layer freshness bound",
        unit_id=unit_id,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
        incremental_update_rule=update_rule,
        batch_reference=f"quant_edge.derivatives.bar_features:batch_{name}",
        streaming_implementation=f"quant_edge.derivatives.bar_features:streaming_{name}",
        provenance="Q08 13.6 derivatives family over the frozen Q06 harness",
        computational_cost=computational_cost,
        expected_failure_modes=failure_modes,
        test_binding="tests.q08.test_q08_bar_features",
        equivalence_tolerance_ulp=0,
    )


def basis_gap_velocity_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "basis_gap_velocity",
            "the speed of Spot/perp gap change carries convergence and dislocation "
            "information beyond the gap level itself",
            unit_id="RATIO_PER_BAR",
            update_rule="basis close of this bar minus the previous complete basis close",
            failure_modes=("EMPTY_BARS", "GAP_BROKEN_WINDOW", "PARTIAL_TAIL_BAR"),
        ),
        batch=_batch_gap_velocity,
        make_streaming=_StreamingGapVelocity,
    )


def basis_gap_acceleration_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "basis_gap_acceleration",
            "acceleration of the gap distinguishes building dislocations from decaying ones",
            unit_id="RATIO_PER_BAR_SQUARED",
            update_rule="first difference of consecutive basis gap velocities",
            failure_modes=("EMPTY_BARS", "GAP_BROKEN_WINDOW", "INSUFFICIENT_HISTORY"),
        ),
        batch=_batch_gap_acceleration,
        make_streaming=_StreamingGapAcceleration,
    )


def basis_sign_persistence_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "basis_sign_persistence",
            "how long the gap has kept one sign separates persistent dislocations "
            "from flickering noise",
            unit_id="COUNT",
            update_rule=(
                "length of the run of consecutive complete bars sharing the current "
                "nonzero basis sign, capped at the declared window; a zero basis "
                "yields zero"
            ),
            failure_modes=("EMPTY_BARS", "GAP_BROKEN_WINDOW", "ZERO_BASIS"),
            lower_bound=FP_ZERO,
            upper_bound=fp_from_int(PERSISTENCE_WINDOW),
        ),
        batch=_batch_sign_persistence,
        make_streaming=_StreamingSignPersistence,
    )


def basis_converging_fraction_feature() -> FeatureImplementationV1:
    return FeatureImplementationV1(
        card=_card(
            "basis_converging_fraction",
            "the fraction of recent bars whose absolute gap shrank measures how "
            "steadily the dislocation is closing",
            unit_id="RATIO",
            update_rule=(
                "over the last eight consecutive complete bar transitions, the "
                "fraction with strictly smaller absolute basis close"
            ),
            failure_modes=("GAP_BROKEN_WINDOW", "INSUFFICIENT_HISTORY"),
            lower_bound=FP_ZERO,
            upper_bound=FP_ONE,
            computational_cost="O_WINDOW_PER_BAR",
        ),
        batch=_batch_converging_fraction,
        make_streaming=_StreamingConvergingFraction,
    )


def q08_features() -> tuple[FeatureImplementationV1, ...]:
    return (
        basis_converging_fraction_feature(),
        basis_gap_acceleration_feature(),
        basis_gap_velocity_feature(),
        basis_sign_persistence_feature(),
    )


def q08_registry() -> FeatureRegistryV1:
    # The frozen registry law rejects duplicate or unsorted feature identities.
    implementations = q08_features()
    cards = tuple(sorted((impl.card for impl in implementations), key=lambda c: c.feature_id))
    return FeatureRegistryV1(registry_version=Q08_REGISTRY_VERSION, cards=cards)
