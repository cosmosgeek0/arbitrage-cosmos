from __future__ import annotations

from collections import deque
from typing import Final

from quant_edge.features.domains import BarDomain
from quant_edge.features.fixedpoint import FixedPointV1, round_half_even
from quant_edge.features.registry import FeatureCardV1
from quant_edge.micro.equivalence import MicroFeatureImplementationV1
from quant_edge.micro.inputs import TopOfBookPointV1

OFI_WINDOW: Final = 16
ALIGNED_TO_FP: Final = 10**26  # aligned integers sit at 10^38; fixed point at 10^12


def fp_from_aligned(value: int) -> FixedPointV1:
    sign = -1 if value < 0 else 1
    return FixedPointV1(sign * round_half_even(abs(value), ALIGNED_TO_FP))


def fp_from_fraction(numerator: int, denominator: int) -> FixedPointV1:
    sign = -1 if (numerator < 0) != (denominator < 0) else 1
    return FixedPointV1(sign * round_half_even(abs(numerator) * 10**12, abs(denominator)))


def _card(
    name: str,
    hypothesis: str,
    *,
    unit_id: str,
    update_rule: str,
    failure_modes: tuple[str, ...],
    cost: str,
) -> FeatureCardV1:
    return FeatureCardV1(
        name=name,
        version="v1",
        economic_hypothesis=hypothesis,
        inputs=("top_of_book_series",),
        window_law="event-driven over L1 observations; documented per-feature window",
        domain=BarDomain.EVENT_TIME,
        normalization_cohort="symbol-self",
        missing_behavior="missing or insufficient input yields UNKNOWN, never zero",
        stale_behavior="staleness is judged by the value-layer freshness bound",
        unit_id=unit_id,
        lower_bound=None,
        upper_bound=None,
        incremental_update_rule=update_rule,
        batch_reference=f"quant_edge.micro.l1:batch_{name}",
        streaming_implementation=f"quant_edge.micro.l1:streaming_{name}",
        provenance="Q07 v1 implemented from directive §13.1 over bookTicker-shaped L1",
        computational_cost=cost,
        expected_failure_modes=failure_modes,
        test_binding="tests.unit.test_q07_l1",
        equivalence_tolerance_ulp=0,
    )


def _ofi_term(previous: TopOfBookPointV1, current: TopOfBookPointV1) -> int:
    """Cont/Kukanov/Stoikov L1 order-flow imbalance term in aligned size units."""

    term = 0
    if current.bid_price_aligned >= previous.bid_price_aligned:
        term += current.bid_size_aligned
    if current.bid_price_aligned <= previous.bid_price_aligned:
        term -= previous.bid_size_aligned
    if current.ask_price_aligned <= previous.ask_price_aligned:
        term -= current.ask_size_aligned
    if current.ask_price_aligned >= previous.ask_price_aligned:
        term += previous.ask_size_aligned
    return term


class _StreamingOfi:
    __slots__ = ("__ops", "__previous", "__sum", "__terms")

    def __init__(self) -> None:
        self.__previous: TopOfBookPointV1 | None = None
        self.__terms: deque[int] = deque()
        self.__sum = 0
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: TopOfBookPointV1) -> FixedPointV1 | None:
        self.__ops = 1
        previous = self.__previous
        self.__previous = item
        if previous is None:
            return None
        term = _ofi_term(previous, item)
        self.__terms.append(term)
        self.__sum += term
        if len(self.__terms) > OFI_WINDOW:
            self.__sum -= self.__terms.popleft()
        return fp_from_aligned(self.__sum)


def batch_ofi_l1(items: tuple[TopOfBookPointV1, ...]) -> FixedPointV1 | None:
    if len(items) < 2:
        return None
    terms = [
        _ofi_term(items[index - 1], items[index])
        for index in range(max(1, len(items) - OFI_WINDOW), len(items))
    ]
    return fp_from_aligned(sum(terms))


class _StreamingQueueImbalance:
    __slots__ = ("__ops",)

    def __init__(self) -> None:
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: TopOfBookPointV1) -> FixedPointV1 | None:
        self.__ops = 1
        total = item.bid_size_aligned + item.ask_size_aligned
        return fp_from_fraction(item.bid_size_aligned - item.ask_size_aligned, total)


def batch_l1_queue_imbalance(
    items: tuple[TopOfBookPointV1, ...],
) -> FixedPointV1 | None:
    item = items[-1]
    total = item.bid_size_aligned + item.ask_size_aligned
    return fp_from_fraction(item.bid_size_aligned - item.ask_size_aligned, total)


class _StreamingMicropriceDisplacement:
    __slots__ = ("__ops",)

    def __init__(self) -> None:
        self.__ops = 0

    @property
    def last_update_ops(self) -> int:
        return self.__ops

    def update(self, item: TopOfBookPointV1) -> FixedPointV1 | None:
        self.__ops = 1
        return _displacement(item)


def _displacement(item: TopOfBookPointV1) -> FixedPointV1:
    """(microprice - mid) / mid as an exact rational, quantized once.

    micro = (Pb*Qa + Pa*Qb) / (Qb + Qa); mid = (Pb + Pa) / 2.
    displacement = (2*(Pb*Qa + Pa*Qb) - (Pb + Pa)*(Qb + Qa)) / ((Pb + Pa)*(Qb + Qa)).
    """

    weighted = item.bid_price_aligned * item.ask_size_aligned + (
        item.ask_price_aligned * item.bid_size_aligned
    )
    size_total = item.bid_size_aligned + item.ask_size_aligned
    mid_x2 = item.mid_aligned_x2
    return fp_from_fraction(2 * weighted - mid_x2 * size_total, mid_x2 * size_total)


def batch_microprice_displacement(
    items: tuple[TopOfBookPointV1, ...],
) -> FixedPointV1 | None:
    return _displacement(items[-1])


def ofi_l1_feature() -> MicroFeatureImplementationV1[TopOfBookPointV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "ofi_l1",
            "net L1 order-flow imbalance over best-quote transitions pressures the "
            "short-horizon mid",
            unit_id="SIZE_UNITS",
            update_rule=(
                f"Cont-style e_n term per transition; rolling sum over the last "
                f"{OFI_WINDOW} transitions"
            ),
            failure_modes=("SINGLE_OBSERVATION", "SIZE_UNIT_MIXING"),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_ofi_l1,
        make_streaming=_StreamingOfi,
        declared_max_update_ops=1,
    )


def l1_queue_imbalance_feature() -> MicroFeatureImplementationV1[TopOfBookPointV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "l1_queue_imbalance",
            "relative best-quote queue sizes proxy immediate book pressure",
            unit_id="RATIO",
            update_rule="(Qb - Qa) / (Qb + Qa) on each observation",
            failure_modes=("ZERO_TOTAL_SIZE_UNREPRESENTABLE",),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_l1_queue_imbalance,
        make_streaming=_StreamingQueueImbalance,
        declared_max_update_ops=1,
    )


def microprice_displacement_feature() -> MicroFeatureImplementationV1[TopOfBookPointV1]:
    return MicroFeatureImplementationV1(
        card=_card(
            "microprice_displacement",
            "size-weighted microprice displacement from mid anticipates micro moves",
            unit_id="RATIO",
            update_rule="exact rational (micro - mid) / mid per observation",
            failure_modes=("ZERO_TOTAL_SIZE_UNREPRESENTABLE",),
            cost="O_1_PER_UPDATE",
        ),
        batch=batch_microprice_displacement,
        make_streaming=_StreamingMicropriceDisplacement,
        declared_max_update_ops=1,
    )
