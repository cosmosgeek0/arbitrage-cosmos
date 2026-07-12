from __future__ import annotations

from dataclasses import dataclass
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.features.baselines import RollingMedianMad
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.lake.contracts import require_strict_int
from quant_edge.regime.contracts import require_fixed_point

MAX_BASELINE_WINDOW: Final = 4_096
MAX_THRESHOLDS: Final = 8


@dataclass(frozen=True, slots=True)
class AlphabetConfigV1:
    """Robust median/MAD bucketing of observations into a bounded symbol alphabet.

    Symmetric strictly increasing thresholds in MAD units produce
    ``2 * len(thresholds) + 1`` symbols ordered from strong-down to strong-up.
    """

    baseline_window: int
    thresholds: tuple[FixedPointV1, ...]

    def __post_init__(self) -> None:
        require_strict_int(
            self.baseline_window,
            field="baseline_window",
            minimum=2,
            maximum=MAX_BASELINE_WINDOW,
        )
        if (
            not isinstance(self.thresholds, tuple)
            or not self.thresholds
            or len(self.thresholds) > MAX_THRESHOLDS
        ):
            raise ContractValueError(
                f"thresholds must be a tuple of 1..{MAX_THRESHOLDS} MAD-unit levels"
            )
        previous: int | None = None
        for index, threshold in enumerate(self.thresholds):
            require_fixed_point(threshold, field=f"thresholds[{index}]")
            if threshold.mantissa < 1:
                raise ContractValueError("thresholds must be strictly positive")
            if previous is not None and threshold.mantissa <= previous:
                raise ContractValueError("thresholds must strictly increase")
            previous = threshold.mantissa

    @property
    def symbol_count(self) -> int:
        return 2 * len(self.thresholds) + 1

    def as_mapping(self) -> dict[str, object]:
        return {
            "baselineWindow": self.baseline_window,
            "symbolCount": self.symbol_count,
            "thresholds": [threshold.as_mapping() for threshold in self.thresholds],
        }


class RobustDiscretizer:
    """Point-in-time symbolizer: classify against the prior window, then learn.

    Returns ``None`` until the baseline window is full; a zero-MAD baseline maps a
    zero deviation to the middle symbol and any other deviation to the extreme
    symbol on its side, a documented deterministic law.
    """

    __slots__ = ("__baseline", "__config")

    def __init__(self, config: AlphabetConfigV1) -> None:
        if not isinstance(config, AlphabetConfigV1):
            raise ContractValueError("config must be AlphabetConfigV1")
        self.__config = config
        self.__baseline = RollingMedianMad(config.baseline_window)

    @property
    def config(self) -> AlphabetConfigV1:
        return self.__config

    @property
    def warm(self) -> bool:
        return self.__baseline.count == self.__config.baseline_window

    def reset(self) -> None:
        self.__baseline = RollingMedianMad(self.__config.baseline_window)

    def classify_and_push(self, value: FixedPointV1) -> int | None:
        require_fixed_point(value, field="value")
        if not self.warm:
            self.__baseline.push(value)
            return None
        # A full window guarantees median/MAD exist; the classification uses only
        # strictly earlier values before the new value enters the baseline.
        median = cast(FixedPointV1, self.__baseline.median())
        mad = cast(FixedPointV1, self.__baseline.mad())
        symbol = _classify(
            deviation=value.mantissa - median.mantissa,
            mad_mantissa=mad.mantissa,
            thresholds=self.__config.thresholds,
        )
        self.__baseline.push(value)
        return symbol


def _classify(
    *,
    deviation: int,
    mad_mantissa: int,
    thresholds: tuple[FixedPointV1, ...],
) -> int:
    middle = len(thresholds)
    if mad_mantissa == 0:
        if deviation == 0:
            return middle
        return 2 * len(thresholds) if deviation > 0 else 0
    magnitude = abs(deviation) * FIXED_POINT_SCALE
    level = 0
    for threshold in thresholds:
        if magnitude > threshold.mantissa * mad_mantissa:
            level += 1
    return middle + level if deviation >= 0 else middle - level
