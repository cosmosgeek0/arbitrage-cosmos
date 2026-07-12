from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1, round_half_even
from quant_edge.lake.contracts import require_contract_id, require_strict_int
from quant_edge.regime.contracts import require_fixed_point

MAX_PROFILE_POINTS: Final = 2_048
MAX_PROFILE_WINDOW: Final = 256
MAX_EVENTS: Final = 1_024


class ExclusionReason(StrEnum):
    FUTURE = "FUTURE"
    OVERLAP = "OVERLAP"
    SAME_EVENT = "SAME_EVENT"
    DEGENERATE = "DEGENERATE"


@dataclass(frozen=True, slots=True)
class EventIntervalV1:
    """Half-open ``[start, end)`` ordinal interval marking one event's extent."""

    start: int
    end: int

    def __post_init__(self) -> None:
        start = require_strict_int(self.start, field="start", minimum=0)
        require_strict_int(self.end, field="end", minimum=start + 1)

    def intersects(self, window_start: int, window_end: int) -> bool:
        return window_start < self.end and self.start < window_end

    def as_mapping(self) -> dict[str, object]:
        return {"end": self.end, "start": self.start}


@dataclass(frozen=True, slots=True)
class MatrixProfileConfigV1:
    """Earlier-only left profile law: a candidate window must end at or before the
    query window's start minus the embargo; overlap is impossible by construction."""

    profile_id: str
    window: int
    embargo: int

    def __post_init__(self) -> None:
        require_contract_id(self.profile_id, field="profile_id")
        require_strict_int(self.window, field="window", minimum=2, maximum=MAX_PROFILE_WINDOW)
        require_strict_int(self.embargo, field="embargo", minimum=0, maximum=MAX_PROFILE_POINTS)

    def as_mapping(self) -> dict[str, object]:
        return {"embargo": self.embargo, "profileId": self.profile_id, "window": self.window}


@dataclass(frozen=True, slots=True)
class MatrixProfileEntryV1:
    """The best strictly earlier analogue window for one query window, or honest
    absence; similarity is signed rho-squared quantized half-even to fixed point."""

    index: int
    query_degenerate: bool
    neighbor: int | None
    similarity: FixedPointV1 | None
    eligible_count: int

    def __post_init__(self) -> None:
        require_strict_int(self.index, field="index", minimum=0)
        if not isinstance(self.query_degenerate, bool):
            raise ContractValueError("query_degenerate must be boolean")
        if self.neighbor is not None:
            neighbor = require_strict_int(self.neighbor, field="neighbor", minimum=0)
            if neighbor >= self.index:
                raise ContractValueError("a neighbor must start strictly earlier than the query")
        if (self.similarity is not None) != (self.neighbor is not None):
            raise ContractValueError("similarity exists exactly when a neighbor exists")
        if self.similarity is not None:
            similarity = require_fixed_point(self.similarity, field="similarity")
            if abs(similarity.mantissa) > FIXED_POINT_SCALE:
                raise ContractValueError("similarity must lie inside [-1, 1]")
        require_strict_int(self.eligible_count, field="eligible_count", minimum=0)
        if self.neighbor is None and self.eligible_count > 0 and not self.query_degenerate:
            raise ContractValueError("eligible candidates require a neighbor")
        if self.query_degenerate and self.neighbor is not None:
            raise ContractValueError("a degenerate query has no neighbor")

    def as_mapping(self) -> dict[str, object]:
        return {
            "eligibleCount": self.eligible_count,
            "index": self.index,
            "neighbor": self.neighbor,
            "queryDegenerate": self.query_degenerate,
            "similarity": None if self.similarity is None else self.similarity.as_mapping(),
        }


@dataclass(frozen=True, slots=True)
class ExclusionCountsV1:
    """Measured exclusion truth; the acceptance gate requires these numbers."""

    future: int
    overlap: int
    same_event: int
    degenerate: int

    def __post_init__(self) -> None:
        for field_name in ("future", "overlap", "same_event", "degenerate"):
            require_strict_int(getattr(self, field_name), field=field_name, minimum=0)

    @property
    def total(self) -> int:
        return self.future + self.overlap + self.same_event + self.degenerate

    def as_mapping(self) -> dict[str, object]:
        return {
            "degenerate": self.degenerate,
            "future": self.future,
            "overlap": self.overlap,
            "sameEvent": self.same_event,
            "total": self.total,
        }


@dataclass(frozen=True, slots=True)
class MatrixProfileV1:
    profile_id: str
    window: int
    embargo: int
    point_count: int
    entries: tuple[MatrixProfileEntryV1, ...]
    exclusions: ExclusionCountsV1

    def __post_init__(self) -> None:
        require_contract_id(self.profile_id, field="profile_id")
        require_strict_int(self.window, field="window", minimum=2)
        require_strict_int(self.embargo, field="embargo", minimum=0)
        require_strict_int(self.point_count, field="point_count", minimum=self.window)
        if not isinstance(self.entries, tuple) or not self.entries:
            raise ContractValueError("entries must be a non-empty tuple")
        expected = self.point_count - self.window + 1
        if len(self.entries) != expected:
            raise ContractValueError("entries must cover every query window exactly once")
        for position, entry in enumerate(self.entries):
            if not isinstance(entry, MatrixProfileEntryV1):
                raise ContractValueError(f"entries[{position}] must be MatrixProfileEntryV1")
            if entry.index != position:
                raise ContractValueError("entry indexes must be dense and ordered")
        if not isinstance(self.exclusions, ExclusionCountsV1):
            raise ContractValueError("exclusions must be ExclusionCountsV1")

    def as_mapping(self) -> dict[str, object]:
        return {
            "embargo": self.embargo,
            "entries": [entry.as_mapping() for entry in self.entries],
            "exclusions": self.exclusions.as_mapping(),
            "pointCount": self.point_count,
            "profileId": self.profile_id,
            "window": self.window,
        }


class _WindowStatistics:
    """Prefix sums giving exact window sums and variance numerators."""

    __slots__ = ("__sum", "__sum_sq", "__window")

    def __init__(self, mantissas: list[int], window: int) -> None:
        self.__window = window
        self.__sum = [0]
        self.__sum_sq = [0]
        for mantissa in mantissas:
            self.__sum.append(self.__sum[-1] + mantissa)
            self.__sum_sq.append(self.__sum_sq[-1] + mantissa * mantissa)

    def window_sum(self, start: int) -> int:
        return self.__sum[start + self.__window] - self.__sum[start]

    def variance_numerator(self, start: int) -> int:
        window = self.__window
        linear = self.window_sum(start)
        square = self.__sum_sq[start + window] - self.__sum_sq[start]
        return window * square - linear * linear


def _correlation_beats(
    candidate_cov: int,
    candidate_var: int,
    incumbent_cov: int,
    incumbent_var: int,
) -> bool:
    """Exact strict comparison of Pearson correlations without square roots.

    Both windows share the query variance, so comparing ``cov / sqrt(var)`` is
    enough; signs decide first, then squared magnitudes cross-multiplied.
    """

    candidate_sign = 0 if candidate_cov == 0 else (1 if candidate_cov > 0 else -1)
    incumbent_sign = 0 if incumbent_cov == 0 else (1 if incumbent_cov > 0 else -1)
    if candidate_sign != incumbent_sign:
        return candidate_sign > incumbent_sign
    if candidate_sign == 0:
        return False
    candidate_magnitude = candidate_cov * candidate_cov * incumbent_var
    incumbent_magnitude = incumbent_cov * incumbent_cov * candidate_var
    if candidate_sign > 0:
        return candidate_magnitude > incumbent_magnitude
    return candidate_magnitude < incumbent_magnitude


def _signed_rho_squared(cov: int, query_var: int, candidate_var: int) -> FixedPointV1:
    sign = -1 if cov < 0 else 1
    mantissa = round_half_even(cov * cov * FIXED_POINT_SCALE, query_var * candidate_var)
    return FixedPointV1(sign * mantissa)


def compute_left_profile(
    values: tuple[FixedPointV1, ...],
    config: MatrixProfileConfigV1,
    events: tuple[EventIntervalV1, ...] = (),
) -> MatrixProfileV1:
    """Deterministic earlier-only left matrix profile with measured exclusions.

    Candidates are walked per diagonal with O(1) incremental cross products, so
    the whole profile is exact integer arithmetic; ties keep the earliest start.
    """

    if not isinstance(values, tuple) or len(values) > MAX_PROFILE_POINTS:
        raise ContractValueError(f"values must be a tuple of at most {MAX_PROFILE_POINTS} points")
    if not isinstance(config, MatrixProfileConfigV1):
        raise ContractValueError("config must be MatrixProfileConfigV1")
    if not isinstance(events, tuple) or len(events) > MAX_EVENTS:
        raise ContractValueError(f"events must be a tuple of at most {MAX_EVENTS} intervals")
    for position, event in enumerate(events):
        if not isinstance(event, EventIntervalV1):
            raise ContractValueError(f"events[{position}] must be EventIntervalV1")
    window = config.window
    if len(values) < window:
        raise ContractValueError("the series is shorter than one window")
    mantissas = [require_fixed_point(value, field="values").mantissa for value in values]
    statistics = _WindowStatistics(mantissas, window)
    window_count = len(mantissas) - window + 1
    variances = [statistics.variance_numerator(start) for start in range(window_count)]
    event_sets = [
        frozenset(
            position
            for position, event in enumerate(events)
            if event.intersects(start, start + window)
        )
        for start in range(window_count)
    ]

    best_cov: list[int | None] = [None] * window_count
    best_var: list[int] = [0] * window_count
    best_index: list[int] = [0] * window_count
    eligible: list[int] = [0] * window_count
    future = 0
    overlap = 0
    same_event = 0
    degenerate = 0

    minimum_lag = window + config.embargo
    # Diagonals walk from the largest lag down so the earliest candidate is
    # visited first and exact correlation ties deterministically keep it.
    for lag in range(window_count - 1, minimum_lag - 1, -1):
        cross = sum(mantissas[lag + offset] * mantissas[offset] for offset in range(window))
        for query in range(lag, window_count):
            candidate = query - lag
            if query > lag:
                cross += (
                    mantissas[query + window - 1] * mantissas[candidate + window - 1]
                    - mantissas[query - 1] * mantissas[candidate - 1]
                )
            # Fixed exclusion precedence: temporal law first (counted per query
            # below), then degeneracy of either window, then same-event identity;
            # every ordered pair lands in exactly one measured bucket.
            if variances[query] == 0 or variances[candidate] == 0:
                degenerate += 1
                continue
            if event_sets[query] & event_sets[candidate]:
                same_event += 1
                continue
            eligible[query] += 1
            cov = window * cross - statistics.window_sum(query) * statistics.window_sum(candidate)
            incumbent = best_cov[query]
            if incumbent is None or _correlation_beats(
                cov,
                variances[candidate],
                incumbent,
                best_var[query],
            ):
                best_cov[query] = cov
                best_var[query] = variances[candidate]
                best_index[query] = candidate

    entries = []
    for query in range(window_count):
        query_degenerate = variances[query] == 0
        # Every candidate pair not visited above is excluded by the temporal law:
        # strictly later starts are FUTURE, earlier-but-too-close starts OVERLAP.
        future += window_count - 1 - query
        overlap += query - min(query, max(query - minimum_lag + 1, 0))
        if query_degenerate:
            entries.append(
                MatrixProfileEntryV1(
                    index=query,
                    query_degenerate=True,
                    neighbor=None,
                    similarity=None,
                    eligible_count=0,
                )
            )
            continue
        neighbor_cov = best_cov[query]
        if neighbor_cov is None:
            entries.append(
                MatrixProfileEntryV1(
                    index=query,
                    query_degenerate=False,
                    neighbor=None,
                    similarity=None,
                    eligible_count=0,
                )
            )
            continue
        entries.append(
            MatrixProfileEntryV1(
                index=query,
                query_degenerate=False,
                neighbor=best_index[query],
                similarity=_signed_rho_squared(
                    neighbor_cov,
                    variances[query],
                    best_var[query],
                ),
                eligible_count=eligible[query],
            )
        )
    return MatrixProfileV1(
        profile_id=config.profile_id,
        window=window,
        embargo=config.embargo,
        point_count=len(mantissas),
        entries=tuple(entries),
        exclusions=ExclusionCountsV1(
            future=future,
            overlap=overlap,
            same_event=same_event,
            degenerate=degenerate,
        ),
    )
