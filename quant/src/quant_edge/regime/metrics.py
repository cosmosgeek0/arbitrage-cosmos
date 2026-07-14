from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from quant_edge.errors import ContractValueError
from quant_edge.labels.rational import ExactRatioV1, make_ratio, ratio_compare
from quant_edge.lake.contracts import require_contract_id, require_strict_int

MAX_SERIES_LENGTH: Final = 1_000_000


def _require_ordinals(value: object, *, field: str, limit: int) -> tuple[int, ...]:
    if not isinstance(value, tuple):
        raise ContractValueError(f"{field} must be a tuple of ordinals")
    previous: int | None = None
    for index, ordinal in enumerate(value):
        require_strict_int(ordinal, field=f"{field}[{index}]", minimum=0, maximum=limit - 1)
        if previous is not None and ordinal <= previous:
            raise ContractValueError(f"{field} must strictly increase")
        previous = ordinal
    return value


@dataclass(frozen=True, slots=True)
class DetectionReportV1:
    """Measured false-alarm and detection-delay truth for one detector run.

    An alarm within ``detection_window`` bars after a planted change detects it;
    only the first such alarm carries the delay, later ones are redundant; every
    other alarm is a false alarm. The false-alarm rate is exact false alarms over
    in-control bars (bars outside every detection window).
    """

    detector_id: str
    series_id: str
    series_length: int
    detection_window: int
    true_changes: tuple[int, ...]
    alarms: tuple[int, ...]
    detected: tuple[int, ...]
    delays: tuple[int, ...]
    missed: tuple[int, ...]
    false_alarms: tuple[int, ...]
    redundant_alarms: tuple[int, ...]
    in_control_bars: int

    def __post_init__(self) -> None:
        require_contract_id(self.detector_id, field="detector_id")
        require_contract_id(self.series_id, field="series_id")
        length = require_strict_int(
            self.series_length,
            field="series_length",
            minimum=1,
            maximum=MAX_SERIES_LENGTH,
        )
        require_strict_int(self.detection_window, field="detection_window", minimum=1)
        _require_ordinals(self.true_changes, field="true_changes", limit=length)
        _require_ordinals(self.alarms, field="alarms", limit=length)
        detected = _require_ordinals(self.detected, field="detected", limit=length)
        if not isinstance(self.delays, tuple) or len(self.delays) != len(detected):
            raise ContractValueError("delays must align one-to-one with detected changes")
        for index, delay in enumerate(self.delays):
            require_strict_int(
                delay,
                field=f"delays[{index}]",
                minimum=0,
                maximum=self.detection_window,
            )
        missed = _require_ordinals(self.missed, field="missed", limit=length)
        _require_ordinals(self.false_alarms, field="false_alarms", limit=length)
        _require_ordinals(self.redundant_alarms, field="redundant_alarms", limit=length)
        if tuple(sorted(detected + missed)) != self.true_changes:
            raise ContractValueError("detected and missed must partition the true changes")
        if len(self.false_alarms) + len(self.redundant_alarms) + len(detected) != len(self.alarms):
            raise ContractValueError("alarms must partition into detections, redundant and false")
        require_strict_int(
            self.in_control_bars,
            field="in_control_bars",
            minimum=0,
            maximum=length,
        )

    @property
    def false_alarm_rate(self) -> ExactRatioV1 | None:
        if self.in_control_bars == 0:
            return None
        return make_ratio(len(self.false_alarms), self.in_control_bars)

    @property
    def mean_delay(self) -> ExactRatioV1 | None:
        if not self.delays:
            return None
        return make_ratio(sum(self.delays), len(self.delays))

    @property
    def max_delay(self) -> int | None:
        return max(self.delays) if self.delays else None

    @property
    def detection_ratio(self) -> ExactRatioV1 | None:
        if not self.true_changes:
            return None
        return make_ratio(len(self.detected), len(self.true_changes))

    def as_mapping(self) -> dict[str, object]:
        false_rate = self.false_alarm_rate
        mean_delay = self.mean_delay
        detection = self.detection_ratio
        return {
            "alarms": list(self.alarms),
            "delays": list(self.delays),
            "detected": list(self.detected),
            "detectionRatio": None if detection is None else detection.as_mapping(),
            "detectionWindow": self.detection_window,
            "detectorId": self.detector_id,
            "falseAlarmRate": None if false_rate is None else false_rate.as_mapping(),
            "falseAlarms": list(self.false_alarms),
            "inControlBars": self.in_control_bars,
            "maxDelay": self.max_delay,
            "meanDelay": None if mean_delay is None else mean_delay.as_mapping(),
            "missed": list(self.missed),
            "redundantAlarms": list(self.redundant_alarms),
            "seriesId": self.series_id,
            "seriesLength": self.series_length,
            "trueChanges": list(self.true_changes),
        }


def evaluate_detection(
    *,
    detector_id: str,
    series_id: str,
    series_length: int,
    detection_window: int,
    true_changes: tuple[int, ...],
    alarms: tuple[int, ...],
) -> DetectionReportV1:
    """Assign every alarm to exactly one bucket and measure delays exactly."""

    length = require_strict_int(
        series_length,
        field="series_length",
        minimum=1,
        maximum=MAX_SERIES_LENGTH,
    )
    require_strict_int(detection_window, field="detection_window", minimum=1)
    changes = _require_ordinals(true_changes, field="true_changes", limit=length)
    checked_alarms = _require_ordinals(alarms, field="alarms", limit=length)
    first_alarm: dict[int, int] = {}
    false_alarms = []
    redundant = []
    for alarm in checked_alarms:
        owner: int | None = None
        for change in changes:
            if change <= alarm <= change + detection_window:
                owner = change
        if owner is None:
            false_alarms.append(alarm)
        elif owner in first_alarm:
            redundant.append(alarm)
        else:
            first_alarm[owner] = alarm
    detected = tuple(sorted(first_alarm))
    delays = tuple(first_alarm[change] - change for change in detected)
    missed = tuple(change for change in changes if change not in first_alarm)
    covered = set()
    for change in changes:
        for ordinal in range(change, min(change + detection_window, length - 1) + 1):
            covered.add(ordinal)
    return DetectionReportV1(
        detector_id=detector_id,
        series_id=series_id,
        series_length=length,
        detection_window=detection_window,
        true_changes=changes,
        alarms=checked_alarms,
        detected=detected,
        delays=delays,
        missed=missed,
        false_alarms=tuple(false_alarms),
        redundant_alarms=tuple(redundant),
        in_control_bars=length - len(covered),
    )


@dataclass(frozen=True, slots=True)
class DetectionBudgetV1:
    """A declared measurement budget; meeting it is computed, never asserted."""

    budget_id: str
    max_false_alarm_rate: ExactRatioV1
    max_mean_delay: ExactRatioV1
    min_detection_ratio: ExactRatioV1

    def __post_init__(self) -> None:
        require_contract_id(self.budget_id, field="budget_id")
        for field_name in ("max_false_alarm_rate", "max_mean_delay", "min_detection_ratio"):
            ratio = getattr(self, field_name)
            if not isinstance(ratio, ExactRatioV1):
                raise ContractValueError(f"{field_name} must be ExactRatioV1")
            if ratio.is_negative:
                raise ContractValueError(f"{field_name} cannot be negative")

    def as_mapping(self) -> dict[str, object]:
        return {
            "budgetId": self.budget_id,
            "maxFalseAlarmRate": self.max_false_alarm_rate.as_mapping(),
            "maxMeanDelay": self.max_mean_delay.as_mapping(),
            "minDetectionRatio": self.min_detection_ratio.as_mapping(),
        }

    def verdict(self, report: DetectionReportV1) -> tuple[bool, tuple[str, ...]]:
        """Measured pass/fail with explicit failure reasons; unknowns fail closed."""

        if not isinstance(report, DetectionReportV1):
            raise ContractValueError("report must be DetectionReportV1")
        failures = []
        false_rate = report.false_alarm_rate
        if false_rate is None:
            failures.append("FALSE_ALARM_RATE_UNKNOWN")
        elif ratio_compare(false_rate, self.max_false_alarm_rate) > 0:
            failures.append("FALSE_ALARM_RATE_EXCEEDED")
        mean_delay = report.mean_delay
        if mean_delay is None:
            failures.append("MEAN_DELAY_UNKNOWN")
        elif ratio_compare(mean_delay, self.max_mean_delay) > 0:
            failures.append("MEAN_DELAY_EXCEEDED")
        detection = report.detection_ratio
        if detection is None:
            failures.append("DETECTION_RATIO_UNKNOWN")
        elif ratio_compare(detection, self.min_detection_ratio) < 0:
            failures.append("DETECTION_RATIO_BELOW_MINIMUM")
        return (not failures, tuple(failures))


@dataclass(frozen=True, slots=True)
class SegmentationReportV1:
    """Boundary-error truth for one offline segmentation run."""

    segmenter_id: str
    series_id: str
    slack: int
    true_boundaries: tuple[int, ...]
    detected_boundaries: tuple[int, ...]
    matched: tuple[tuple[int, int], ...]
    missed: tuple[int, ...]
    spurious: tuple[int, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.segmenter_id, field="segmenter_id")
        require_contract_id(self.series_id, field="series_id")
        require_strict_int(self.slack, field="slack", minimum=0)
        _require_ordinals(
            self.true_boundaries,
            field="true_boundaries",
            limit=MAX_SERIES_LENGTH,
        )
        _require_ordinals(
            self.detected_boundaries,
            field="detected_boundaries",
            limit=MAX_SERIES_LENGTH,
        )
        if not isinstance(self.matched, tuple):
            raise ContractValueError("matched must be a tuple")
        matched_truth = []
        matched_detected = []
        for pair in self.matched:
            if not isinstance(pair, tuple) or len(pair) != 2:
                raise ContractValueError("matched must contain (truth, detected) pairs")
            truth, found = pair
            require_strict_int(truth, field="matched.truth", minimum=0)
            require_strict_int(found, field="matched.detected", minimum=0)
            if abs(found - truth) > self.slack:
                raise ContractValueError("a matched pair cannot exceed the slack")
            matched_truth.append(truth)
            matched_detected.append(found)
        missed = _require_ordinals(self.missed, field="missed", limit=MAX_SERIES_LENGTH)
        spurious = _require_ordinals(self.spurious, field="spurious", limit=MAX_SERIES_LENGTH)
        if tuple(sorted(matched_truth + list(missed))) != self.true_boundaries:
            raise ContractValueError("matched and missed must partition the true boundaries")
        if tuple(sorted(matched_detected + list(spurious))) != self.detected_boundaries:
            raise ContractValueError("matched and spurious must partition detections")

    @property
    def max_boundary_error(self) -> int | None:
        if not self.matched:
            return None
        return max(abs(found - truth) for truth, found in self.matched)

    @property
    def mean_boundary_error(self) -> ExactRatioV1 | None:
        if not self.matched:
            return None
        return make_ratio(
            sum(abs(found - truth) for truth, found in self.matched),
            len(self.matched),
        )

    def as_mapping(self) -> dict[str, object]:
        mean_error = self.mean_boundary_error
        return {
            "detectedBoundaries": list(self.detected_boundaries),
            "matched": [[truth, found] for truth, found in self.matched],
            "maxBoundaryError": self.max_boundary_error,
            "meanBoundaryError": None if mean_error is None else mean_error.as_mapping(),
            "missed": list(self.missed),
            "segmenterId": self.segmenter_id,
            "seriesId": self.series_id,
            "slack": self.slack,
            "spurious": list(self.spurious),
        }


def evaluate_segmentation(
    *,
    segmenter_id: str,
    series_id: str,
    true_boundaries: tuple[int, ...],
    detected_boundaries: tuple[int, ...],
    slack: int,
) -> SegmentationReportV1:
    """Greedy in-order one-to-one boundary matching within the declared slack."""

    require_strict_int(slack, field="slack", minimum=0)
    truths = _require_ordinals(true_boundaries, field="true_boundaries", limit=MAX_SERIES_LENGTH)
    found = _require_ordinals(
        detected_boundaries,
        field="detected_boundaries",
        limit=MAX_SERIES_LENGTH,
    )
    matched = []
    used = [False] * len(found)
    for truth in truths:
        best: int | None = None
        for index, detected in enumerate(found):
            if used[index] or abs(detected - truth) > slack:
                continue
            if best is None or abs(detected - truth) < abs(found[best] - truth):
                best = index
        if best is not None:
            used[best] = True
            matched.append((truth, found[best]))
    missed = tuple(truth for truth in truths if truth not in {pair[0] for pair in matched})
    spurious = tuple(detected for index, detected in enumerate(found) if not used[index])
    return SegmentationReportV1(
        segmenter_id=segmenter_id,
        series_id=series_id,
        slack=slack,
        true_boundaries=truths,
        detected_boundaries=found,
        matched=tuple(matched),
        missed=missed,
        spurious=spurious,
    )


@dataclass(frozen=True, slots=True)
class AnomalyMeasurementV1:
    """Hit/false truth for the anomaly baseline on injected-outlier series."""

    scorer_id: str
    series_id: str
    series_length: int
    injected: tuple[int, ...]
    flagged: tuple[int, ...]
    hits: tuple[int, ...]
    missed: tuple[int, ...]
    false_flags: tuple[int, ...]

    def __post_init__(self) -> None:
        require_contract_id(self.scorer_id, field="scorer_id")
        require_contract_id(self.series_id, field="series_id")
        length = require_strict_int(
            self.series_length,
            field="series_length",
            minimum=1,
            maximum=MAX_SERIES_LENGTH,
        )
        injected = _require_ordinals(self.injected, field="injected", limit=length)
        _require_ordinals(self.flagged, field="flagged", limit=length)
        hits = _require_ordinals(self.hits, field="hits", limit=length)
        missed = _require_ordinals(self.missed, field="missed", limit=length)
        false_flags = _require_ordinals(self.false_flags, field="false_flags", limit=length)
        if tuple(sorted(hits + missed)) != injected:
            raise ContractValueError("hits and missed must partition the injected ordinals")
        if tuple(sorted(hits + false_flags)) != self.flagged:
            raise ContractValueError("hits and false flags must partition the flags")

    @property
    def hit_ratio(self) -> ExactRatioV1 | None:
        if not self.injected:
            return None
        return make_ratio(len(self.hits), len(self.injected))

    @property
    def false_flag_ratio(self) -> ExactRatioV1 | None:
        clean = self.series_length - len(self.injected)
        if clean == 0:
            return None
        return make_ratio(len(self.false_flags), clean)

    def as_mapping(self) -> dict[str, object]:
        hit_ratio = self.hit_ratio
        false_ratio = self.false_flag_ratio
        return {
            "falseFlagRatio": None if false_ratio is None else false_ratio.as_mapping(),
            "falseFlags": list(self.false_flags),
            "flagged": list(self.flagged),
            "hitRatio": None if hit_ratio is None else hit_ratio.as_mapping(),
            "hits": list(self.hits),
            "injected": list(self.injected),
            "missed": list(self.missed),
            "scorerId": self.scorer_id,
            "seriesId": self.series_id,
            "seriesLength": self.series_length,
        }


def evaluate_anomaly_flags(
    *,
    scorer_id: str,
    series_id: str,
    series_length: int,
    injected: tuple[int, ...],
    flagged: tuple[int, ...],
) -> AnomalyMeasurementV1:
    length = require_strict_int(
        series_length,
        field="series_length",
        minimum=1,
        maximum=MAX_SERIES_LENGTH,
    )
    injected_checked = _require_ordinals(injected, field="injected", limit=length)
    flagged_checked = _require_ordinals(flagged, field="flagged", limit=length)
    injected_set = set(injected_checked)
    hits = tuple(ordinal for ordinal in flagged_checked if ordinal in injected_set)
    hit_set = set(hits)
    missed = tuple(ordinal for ordinal in injected_checked if ordinal not in hit_set)
    false_flags = tuple(ordinal for ordinal in flagged_checked if ordinal not in injected_set)
    return AnomalyMeasurementV1(
        scorer_id=scorer_id,
        series_id=series_id,
        series_length=length,
        injected=injected_checked,
        flagged=flagged_checked,
        hits=hits,
        missed=missed,
        false_flags=false_flags,
    )
