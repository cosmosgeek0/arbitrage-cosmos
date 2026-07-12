from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast

from quant_edge.errors import ContractValueError
from quant_edge.features.domains import (
    BarSeriesV1,
    FeaturePointV1,
    FeatureSeriesV1,
    WallTimeBarSpecV1,
    build_bars,
)
from quant_edge.features.fixedpoint import round_half_even
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare
from quant_edge.labels.series import EvidenceSeriesV1, SeriesKind
from quant_edge.lake.contracts import require_strict_int

MAX_LAG_BARS: Final = 4
MIN_LAG_PAIRS: Final = 6
MIN_STABILITY_HALF_PAIRS: Final = MIN_LAG_PAIRS

# Lead-lag output is cross-market EVIDENCE for research ranking only; leadership is
# never a tradable-alpha claim and no cost/latency validation happens here.
EVIDENCE_ONLY: Final = "EVIDENCE_ONLY"


class LeadLagVerdict(StrEnum):
    SPOT_LEADS = "SPOT_LEADS"
    PERP_LEADS = "PERP_LEADS"
    CONTEMPORANEOUS = "CONTEMPORANEOUS"
    AMBIGUOUS = "AMBIGUOUS"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True, slots=True)
class LagCorrelationV1:
    """Signed r-squared between spot returns and perp returns shifted by one lag.

    A positive lag correlates the spot return at bar t with the perp return at bar
    ``t + lag``, so predictive-direction spot leadership shows up at positive lags.
    """

    lag_bars: int
    pair_count: int
    signed_r_squared: ExactRatioV1 | None

    def __post_init__(self) -> None:
        require_strict_int(
            self.lag_bars,
            field="lag_bars",
            minimum=-MAX_LAG_BARS,
            maximum=MAX_LAG_BARS,
        )
        require_strict_int(self.pair_count, field="pair_count", minimum=0)
        if self.signed_r_squared is not None and not isinstance(
            self.signed_r_squared, ExactRatioV1
        ):
            raise ContractValueError("signed_r_squared must be ExactRatioV1 or None")

    def as_mapping(self) -> dict[str, object]:
        return {
            "lagBars": self.lag_bars,
            "pairCount": self.pair_count,
            "signedRSquared": (
                None if self.signed_r_squared is None else self.signed_r_squared.as_mapping()
            ),
        }


@dataclass(frozen=True, slots=True)
class LeadLagReportV1:
    """Bounded lead-lag evidence between the Spot and perp legs of one pair."""

    verdict: LeadLagVerdict
    best_lag_bars: int | None
    correlations: tuple[LagCorrelationV1, ...]
    stability: ExactRatioV1 | None
    posture_note: str

    def __post_init__(self) -> None:
        if not isinstance(self.verdict, LeadLagVerdict):
            raise ContractValueError("verdict must be LeadLagVerdict")
        if self.best_lag_bars is not None:
            require_strict_int(
                self.best_lag_bars,
                field="best_lag_bars",
                minimum=-MAX_LAG_BARS,
                maximum=MAX_LAG_BARS,
            )
        if (self.best_lag_bars is None) != (
            self.verdict in (LeadLagVerdict.UNKNOWN, LeadLagVerdict.AMBIGUOUS)
        ):
            raise ContractValueError("a best lag exists exactly when the verdict names a leader")
        if not isinstance(self.correlations, tuple) or len(self.correlations) != (
            2 * MAX_LAG_BARS + 1
        ):
            raise ContractValueError("correlations must cover every lag exactly once")
        expected_lag = -MAX_LAG_BARS
        for correlation in self.correlations:
            if not isinstance(correlation, LagCorrelationV1):
                raise ContractValueError("correlations must contain LagCorrelationV1")
            if correlation.lag_bars != expected_lag:
                raise ContractValueError("correlations must be ordered by lag")
            expected_lag += 1
        if self.stability is not None and not isinstance(self.stability, ExactRatioV1):
            raise ContractValueError("stability must be ExactRatioV1 or None")
        if self.posture_note != EVIDENCE_ONLY:
            raise ContractValueError("lead-lag output is evidence only, never alpha")

    def as_mapping(self) -> dict[str, object]:
        return {
            "bestLagBars": self.best_lag_bars,
            "correlations": [correlation.as_mapping() for correlation in self.correlations],
            "postureNote": self.posture_note,
            "stability": None if self.stability is None else self.stability.as_mapping(),
            "verdict": self.verdict.value,
        }


def leg_feature_series(series: EvidenceSeriesV1, *, series_id: str) -> FeatureSeriesV1:
    """Project one leg's price evidence into the frozen Q06 feature-series shape."""

    if not isinstance(series, EvidenceSeriesV1):
        raise ContractValueError("series must be EvidenceSeriesV1")
    if series.kind is SeriesKind.EXECUTABLE_QUOTES:
        raise ContractValueError("lead-lag legs are price series, never executable quotes")
    points = tuple(
        FeaturePointV1(
            event_time_ns=point.event_time_ns,
            ordinal=point.ordinal,
            value=point.price,
            volume=None,
        )
        for point in series.price_points
    )
    return FeatureSeriesV1(
        series_id=series_id,
        symbol=series.symbol,
        posture=series.posture,
        completeness_start_ns=series.completeness_start_ns,
        completeness_end_ns=series.completeness_end_ns,
        points=points,
    )


def _bar_returns(bars: BarSeriesV1) -> list[int | None]:
    """Per-bar close-to-close returns as fixed-point mantissas; None when unknown."""

    returns: list[int | None] = []
    previous: int | None = None
    for bar in bars.bars:
        close = bar.last_value_aligned if bar.complete else None
        if close is None:
            returns.append(None)
            # A missing close breaks the return chain; the previous close is kept so
            # the chain resumes exactly like the frozen bar-return convention.
            continue
        if previous is None:
            returns.append(None)
        else:
            mantissa = _signed_round((close - previous) * 10**12, previous)
            returns.append(mantissa)
        previous = close
    return returns


def _signed_round(numerator: int, denominator: int) -> int:
    sign = -1 if (numerator < 0) != (denominator < 0) else 1
    return sign * round_half_even(abs(numerator), abs(denominator))


def _signed_r_squared(pairs: list[tuple[int, int]]) -> ExactRatioV1 | None:
    count = len(pairs)
    if count < MIN_LAG_PAIRS:
        return None
    sum_x = sum(pair[0] for pair in pairs)
    sum_y = sum(pair[1] for pair in pairs)
    covariance = count * sum(x * y for x, y in pairs) - sum_x * sum_y
    variance_x = count * sum(x * x for x, _ in pairs) - sum_x * sum_x
    variance_y = count * sum(y * y for _, y in pairs) - sum_y * sum_y
    if variance_x == 0 or variance_y == 0:
        return None
    sign = -1 if covariance < 0 else 1
    return make_ratio(sign * covariance * covariance, variance_x * variance_y)


def _lag_pairs(
    spot_returns: list[int | None],
    perp_returns: list[int | None],
    lag: int,
) -> list[tuple[int, int]]:
    pairs: list[tuple[int, int]] = []
    for index, spot_value in enumerate(spot_returns):
        perp_index = index + lag
        if spot_value is None or not 0 <= perp_index < len(perp_returns):
            continue
        perp_value = perp_returns[perp_index]
        if perp_value is None:
            continue
        pairs.append((spot_value, perp_value))
    return pairs


def _abs_ratio(value: ExactRatioV1) -> ExactRatioV1:
    return make_ratio(abs(value.numerator), value.denominator)


def _leader(correlations: list[LagCorrelationV1]) -> tuple[LeadLagVerdict, int | None]:
    best: LagCorrelationV1 | None = None
    tied = False
    for correlation in correlations:
        observed = correlation.signed_r_squared
        if observed is None or correlation.pair_count < MIN_LAG_PAIRS:
            continue
        if best is None:
            best = correlation
            continue
        # The selection loop only keeps correlations with observed values.
        best_observed = cast(ExactRatioV1, best.signed_r_squared)
        comparison = ratio_compare(_abs_ratio(observed), _abs_ratio(best_observed))
        if comparison > 0:
            best = correlation
            tied = False
        elif comparison == 0:
            tied = True
    if best is None:
        return LeadLagVerdict.UNKNOWN, None
    best_value = cast(ExactRatioV1, best.signed_r_squared)
    if tied or best_value.is_zero:
        return LeadLagVerdict.AMBIGUOUS, None
    if best.lag_bars > 0:
        return LeadLagVerdict.SPOT_LEADS, best.lag_bars
    if best.lag_bars < 0:
        return LeadLagVerdict.PERP_LEADS, best.lag_bars
    return LeadLagVerdict.CONTEMPORANEOUS, 0


def lead_lag_report(
    *,
    spot_series: EvidenceSeriesV1,
    perp_series: EvidenceSeriesV1,
    wall_width_ns: int,
    anchor_ns: int,
) -> LeadLagReportV1:
    """Lagged signed r-squared between leg returns on shared wall bars.

    Sparse evidence stays UNKNOWN; equal-strength lags stay AMBIGUOUS; the verdict
    is research evidence for attention ranking, never a tradable-alpha claim, and
    Granger/transfer-entropy challengers are deferred to the model phases.
    """

    spot_bars = build_bars(
        leg_feature_series(spot_series, series_id="leadlag-spot"),
        WallTimeBarSpecV1(wall_width_ns=wall_width_ns, anchor_ns=anchor_ns),
    )
    perp_bars = build_bars(
        leg_feature_series(perp_series, series_id="leadlag-perp"),
        WallTimeBarSpecV1(wall_width_ns=wall_width_ns, anchor_ns=anchor_ns),
    )
    spot_returns = _bar_returns(spot_bars)
    perp_returns = _bar_returns(perp_bars)

    correlations: list[LagCorrelationV1] = []
    for lag in range(-MAX_LAG_BARS, MAX_LAG_BARS + 1):
        pairs = _lag_pairs(spot_returns, perp_returns, lag)
        correlations.append(
            LagCorrelationV1(
                lag_bars=lag,
                pair_count=len(pairs),
                signed_r_squared=_signed_r_squared(pairs),
            )
        )

    verdict, best_lag = _leader(correlations)

    stability: ExactRatioV1 | None = None
    if verdict in (
        LeadLagVerdict.SPOT_LEADS,
        LeadLagVerdict.PERP_LEADS,
        LeadLagVerdict.CONTEMPORANEOUS,
    ):
        stability = _half_split_stability(spot_returns, perp_returns, verdict)

    return LeadLagReportV1(
        verdict=verdict,
        best_lag_bars=best_lag,
        correlations=tuple(correlations),
        stability=stability,
        posture_note=EVIDENCE_ONLY,
    )


def _half_split_stability(
    spot_returns: list[int | None],
    perp_returns: list[int | None],
    verdict: LeadLagVerdict,
) -> ExactRatioV1 | None:
    """The fraction of the two return halves whose own verdict matches the whole.

    Halves too sparse for their own verdict make stability UNKNOWN rather than
    fabricating agreement.
    """

    midpoint = len(spot_returns) // 2
    agreements = 0
    for half in (slice(0, midpoint), slice(midpoint, len(spot_returns))):
        half_correlations = []
        for lag in range(-MAX_LAG_BARS, MAX_LAG_BARS + 1):
            pairs = _lag_pairs(spot_returns[half], perp_returns[half], lag)
            half_correlations.append(
                LagCorrelationV1(
                    lag_bars=lag,
                    pair_count=len(pairs),
                    signed_r_squared=_signed_r_squared(pairs),
                )
            )
        half_verdict, _ = _leader(half_correlations)
        if half_verdict is LeadLagVerdict.UNKNOWN:
            return None
        agreements += int(half_verdict is verdict)
    return make_ratio(agreements, 2)
