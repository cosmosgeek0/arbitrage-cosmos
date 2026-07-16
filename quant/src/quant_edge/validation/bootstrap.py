"""Seeded circular block bootstrap confidence intervals (§16.3).

Replicates resample whole chronological blocks so serial dependence inside a block is
preserved. All arithmetic is exact; interval endpoints follow a documented empirical
order-statistic law and are published as integer fixed-point values. Insufficient or
degenerate inputs yield an ``INVALID`` report with a typed reason — never an interval.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FixedPointV1, round_half_even
from quant_edge.labels.rational import ExactRatioV1
from quant_edge.lake.contracts import require_reason_code, require_strict_int
from quant_edge.randomness import DeterministicRandom

FIXED_SCALE = 10**12
MAX_VALUES = 16_384
MAX_REPLICATES = 4_096
MIN_VALUES = 4


class BootstrapStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    INVALID = "INVALID"


@dataclass(frozen=True, slots=True)
class BootstrapSpecV1:
    """Declared bootstrap law: block length, replicates, coverage and seed."""

    seed: int
    block_length: int
    replicates: int
    coverage_per_myriad: int

    def __post_init__(self) -> None:
        require_strict_int(self.seed, field="seed", minimum=0)
        require_strict_int(self.block_length, field="block_length", minimum=1, maximum=MAX_VALUES)
        require_strict_int(self.replicates, field="replicates", minimum=8, maximum=MAX_REPLICATES)
        require_strict_int(
            self.coverage_per_myriad,
            field="coverage_per_myriad",
            minimum=5_000,
            maximum=9_999,
        )

    def as_mapping(self) -> dict[str, object]:
        return {
            "blockLength": self.block_length,
            "coveragePerMyriad": self.coverage_per_myriad,
            "replicates": self.replicates,
            "seed": str(self.seed),
        }


@dataclass(frozen=True, slots=True)
class BootstrapIntervalV1:
    """Percentile interval over circular-block replicate means."""

    status: BootstrapStatus
    reason: str | None
    point_estimate: FixedPointV1 | None
    lower: FixedPointV1 | None
    upper: FixedPointV1 | None
    value_count: int
    spec: BootstrapSpecV1

    def __post_init__(self) -> None:
        if not isinstance(self.status, BootstrapStatus):
            raise ContractValueError("status must be a BootstrapStatus")
        populated = (
            isinstance(self.point_estimate, FixedPointV1)
            and isinstance(self.lower, FixedPointV1)
            and isinstance(self.upper, FixedPointV1)
        )
        if self.status is BootstrapStatus.AVAILABLE:
            if not populated or self.reason is not None:
                raise ContractValueError("available intervals carry endpoints and no reason")
        else:
            if self.point_estimate is not None or self.lower is not None or self.upper is not None:
                raise ContractValueError("invalid intervals carry no endpoints")
            if self.reason is None:
                raise ContractValueError("invalid intervals carry a reason")
            require_reason_code(self.reason, field="reason")
        require_strict_int(self.value_count, field="value_count", minimum=0)
        if not isinstance(self.spec, BootstrapSpecV1):
            raise ContractValueError("spec must be BootstrapSpecV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "lower": None if self.lower is None else self.lower.as_mapping(),
            "pointEstimate": (
                None if self.point_estimate is None else self.point_estimate.as_mapping()
            ),
            "reason": self.reason,
            "spec": self.spec.as_mapping(),
            "status": self.status.value,
            "upper": None if self.upper is None else self.upper.as_mapping(),
            "valueCount": self.value_count,
        }


def _fixed(value: Fraction) -> FixedPointV1:
    return FixedPointV1(round_half_even(value.numerator * FIXED_SCALE, value.denominator))


def _invalid(reason: str, count: int, spec: BootstrapSpecV1) -> BootstrapIntervalV1:
    return BootstrapIntervalV1(
        status=BootstrapStatus.INVALID,
        reason=reason,
        point_estimate=None,
        lower=None,
        upper=None,
        value_count=count,
        spec=spec,
    )


def _order_statistic(sorted_values: list[Fraction], quantile: Fraction) -> Fraction:
    """Empirical quantile: value at index ceil(q * n) - 1 for q in (0, 1].

    The spec bounds coverage to (0.5, 1), so both interval quantiles satisfy
    0 < q < 1 and the index is always in range; no clamp is needed.
    """

    count = len(sorted_values)
    index = (quantile.numerator * count + quantile.denominator - 1) // quantile.denominator - 1
    return sorted_values[index]


def block_bootstrap_interval(
    values: tuple[ExactRatioV1, ...],
    spec: BootstrapSpecV1,
) -> BootstrapIntervalV1:
    """Circular block bootstrap percentile interval over the mean of ``values``."""

    if not isinstance(spec, BootstrapSpecV1):
        raise ContractValueError("spec must be BootstrapSpecV1")
    if not isinstance(values, tuple) or len(values) > MAX_VALUES:
        raise ContractValueError("values must be a tuple of at most MAX_VALUES entries")
    if any(not isinstance(value, ExactRatioV1) for value in values):
        raise ContractValueError("values must contain ExactRatioV1 entries")
    count = len(values)
    if count < MIN_VALUES:
        return _invalid("INSUFFICIENT_VALUES", count, spec)
    if spec.block_length > count:
        return _invalid("BLOCK_LONGER_THAN_SERIES", count, spec)

    series = [Fraction(value.numerator, value.denominator) for value in values]
    point = sum(series, Fraction(0)) / count
    rng = DeterministicRandom.from_seed(spec.seed)
    replicate_means: list[Fraction] = []
    blocks_needed = -(-count // spec.block_length)
    for _ in range(spec.replicates):
        drawn: list[Fraction] = []
        for _ in range(blocks_needed):
            start = rng.next_u64() % count
            for offset in range(spec.block_length):
                drawn.append(series[(start + offset) % count])
        trimmed = drawn[:count]
        replicate_means.append(sum(trimmed, Fraction(0)) / count)
    replicate_means.sort()

    alpha = Fraction(10_000 - spec.coverage_per_myriad, 10_000)
    lower = _order_statistic(replicate_means, alpha / 2)
    upper = _order_statistic(replicate_means, 1 - alpha / 2)
    return BootstrapIntervalV1(
        status=BootstrapStatus.AVAILABLE,
        reason=None,
        point_estimate=_fixed(point),
        lower=_fixed(lower),
        upper=_fixed(upper),
        value_count=count,
        spec=spec,
    )
