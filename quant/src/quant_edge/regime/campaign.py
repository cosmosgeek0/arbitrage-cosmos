"""Deterministic Q09 regime-layer campaign and golden-fixture builder.

Usage: ``python -m quant_edge.regime.campaign OUTPUT_ROOT``

Writes, byte-deterministically and without any network, environment or ambient-time
access:

- ``OUTPUT_ROOT/generated/q09/regime_golden_v1.json``
- ``OUTPUT_ROOT/generated/q09/regime_campaign.v1.json``
- ``OUTPUT_ROOT/generated/q09/regime_campaign.v1.md``

Everything here is SYNTHETIC fixture evidence proving the §13.4/§14.5/§14.7
machinery and measuring false alarms, detection delays, OOD behavior and
future/overlap exclusions; no detector, regime or analogue is claimed to be
predictive, validated or economically valuable.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from typing import Protocol

from quant_edge.canonical import canonical_json_bytes
from quant_edge.features.fixedpoint import FIXED_POINT_SCALE, FixedPointV1
from quant_edge.labels.rational import make_ratio
from quant_edge.lake.contracts import EvidencePosture, QualityState
from quant_edge.randomness import DeterministicRandom
from quant_edge.regime.alphabet import AlphabetConfigV1
from quant_edge.regime.analog import (
    AnalogQueryV1,
    AnalogRecordV1,
    AnalogRetrievalV1,
    retrieve_analogs,
)
from quant_edge.regime.anomaly import RobustAnomalyConfigV1, RobustAnomalyScorer
from quant_edge.regime.bocpd import BocpdConfigV1, BocpdDetector
from quant_edge.regime.contracts import (
    ObservationSeriesV1,
    ObservationV1,
    StepStatus,
    alarm_ordinals,
    run_series,
)
from quant_edge.regime.cusum import CusumConfigV1, TwoSidedCusum
from quant_edge.regime.matrix_profile import (
    EventIntervalV1,
    MatrixProfileConfigV1,
    MatrixProfileV1,
    compute_left_profile,
)
from quant_edge.regime.metrics import (
    DetectionReportV1,
    evaluate_anomaly_flags,
    evaluate_detection,
    evaluate_segmentation,
)
from quant_edge.regime.page_hinkley import PageHinkleyConfigV1, TwoSidedPageHinkley
from quant_edge.regime.pelt import PeltConfigV1, segment_pelt
from quant_edge.regime.soft_regime import SoftRegimeFilter, v1_regime_spec

CAMPAIGN_SEED = 20260712
BASE_NS = 1_772_000_000_000_000_000
SECOND_NS = 1_000_000_000
DETECTION_WINDOW = 24
SEGMENTATION_SLACK = 4
SEEDED_DETECTION_SERIES = 24
SEEDED_ANOMALY_SERIES = 12
SEEDED_PROFILE_SERIES = 12
SEEDED_ANALOG_BATCHES = 12

_HUNDREDTH = FIXED_POINT_SCALE // 100


class _MappedStep(Protocol):
    def as_mapping(self) -> dict[str, object]: ...


def _fp_hundredths(hundredths: int) -> FixedPointV1:
    return FixedPointV1(hundredths * _HUNDREDTH)


def _observation(index: int, hundredths: int) -> ObservationV1:
    return ObservationV1(
        event_time_ns=BASE_NS + index * SECOND_NS,
        ordinal=index,
        value=_fp_hundredths(hundredths),
        quality=QualityState.SYNTHETIC,
    )


def _series(series_id: str, hundredths: list[int]) -> ObservationSeriesV1:
    return ObservationSeriesV1(
        series_id=series_id,
        symbol="BNBUSDT",
        posture=EvidencePosture.SYNTHETIC,
        points=tuple(_observation(index, value) for index, value in enumerate(hundredths)),
    )


def _zigzag(index: int, phase: int, amplitude_hundredths: int) -> int:
    return ((index * 37 + phase) % 21 - 10) * amplitude_hundredths // 10


def _golden_change_values() -> tuple[list[int], tuple[int, ...]]:
    values = []
    for index in range(240):
        base = 1_000
        if index >= 80:
            base = 1_200
        if index >= 160:
            base = 900
        values.append(base + _zigzag(index, 0, 10))
    return values, (80, 160)


def _golden_anomaly_values() -> tuple[list[int], tuple[int, ...]]:
    spikes = {50: 150, 120: -120, 200: 200}
    values = []
    for index in range(240):
        values.append(1_000 + _zigzag(index, 0, 10) + spikes.get(index, 0))
    return values, tuple(sorted(spikes))


def _golden_profile_values() -> list[int]:
    motif = (0, 30, 60, 30, 0, -30, -60, -30)
    values = []
    for index in range(64):
        value = 500 + ((index * 13) % 7 - 3)
        if 8 <= index < 16:
            value += motif[index - 8]
        if 40 <= index < 48:
            value += motif[index - 40]
        values.append(value)
    return values


def _cusum_config() -> CusumConfigV1:
    return CusumConfigV1(
        detector_id="cusum-v1",
        reference=None,
        warmup=16,
        slack_k=_fp_hundredths(5),
        threshold_h=_fp_hundredths(50),
    )


def _page_hinkley_config() -> PageHinkleyConfigV1:
    return PageHinkleyConfigV1(
        detector_id="page-hinkley-v1",
        delta=_fp_hundredths(5),
        threshold_lambda=_fp_hundredths(80),
        warmup=16,
    )


def _alphabet_config() -> AlphabetConfigV1:
    return AlphabetConfigV1(
        baseline_window=16,
        thresholds=(FixedPointV1(FIXED_POINT_SCALE), FixedPointV1(3 * FIXED_POINT_SCALE)),
    )


def _bocpd_config() -> BocpdConfigV1:
    return BocpdConfigV1(
        detector_id="bocpd-v1",
        alphabet=_alphabet_config(),
        hazard=make_ratio(1, 100),
        run_cap=32,
        alarm_run_length=4,
        alarm_threshold=FixedPointV1(FIXED_POINT_SCALE // 2),
        alarm_warmup=12,
    )


def _pelt_config() -> PeltConfigV1:
    return PeltConfigV1(
        segmenter_id="pelt-v1",
        penalty=10 * FIXED_POINT_SCALE,
        min_segment_length=8,
    )


def _anomaly_config() -> RobustAnomalyConfigV1:
    return RobustAnomalyConfigV1(
        scorer_id="robust-anomaly-v1",
        window=16,
        z_threshold=FixedPointV1(6 * FIXED_POINT_SCALE),
    )


def _profile_config() -> MatrixProfileConfigV1:
    return MatrixProfileConfigV1(profile_id="left-profile-v1", window=8, embargo=0)


def _steps_digest(steps: tuple[_MappedStep, ...]) -> str:
    mappings = [step.as_mapping() for step in steps]
    return hashlib.sha256(
        canonical_json_bytes({"schema": "Q09StepVectorV1", "steps": mappings, "version": 1})
    ).hexdigest()


def _detection_run(
    series: ObservationSeriesV1,
    true_changes: tuple[int, ...],
) -> dict[str, tuple[DetectionReportV1, str]]:
    cusum = TwoSidedCusum(_cusum_config())
    cusum_steps = run_series(cusum, series)
    page_hinkley = TwoSidedPageHinkley(_page_hinkley_config())
    page_hinkley_steps = run_series(page_hinkley, series)
    bocpd = BocpdDetector(_bocpd_config())
    bocpd_steps = run_series(bocpd, series)
    runs: dict[str, tuple[tuple[int, ...], str, str]] = {
        "bocpd": (alarm_ordinals(bocpd_steps), _steps_digest(bocpd_steps), "bocpd-v1"),
        "cusum": (alarm_ordinals(cusum_steps), _steps_digest(cusum_steps), "cusum-v1"),
        "pageHinkley": (
            alarm_ordinals(page_hinkley_steps),
            _steps_digest(page_hinkley_steps),
            "page-hinkley-v1",
        ),
    }
    reports: dict[str, tuple[DetectionReportV1, str]] = {}
    for name, (alarms, digest, detector_id) in runs.items():
        report = evaluate_detection(
            detector_id=detector_id,
            series_id=series.series_id,
            series_length=len(series.points),
            detection_window=DETECTION_WINDOW,
            true_changes=true_changes,
            alarms=alarms,
        )
        reports[name] = (report, digest)
    return reports


def _verify_profile_law(profile: MatrixProfileV1) -> None:
    for entry in profile.entries:
        if entry.neighbor is None:
            continue
        if entry.neighbor + profile.window + profile.embargo > entry.index:
            raise ValueError("earlier-only law violated by a matrix profile neighbor")


def _verify_analog_law(query: AnalogQueryV1, retrieval: AnalogRetrievalV1) -> None:
    horizon = query.cutoff_ns - query.embargo_ns
    for neighbor in retrieval.neighbors:
        if neighbor.end_ns > horizon:
            raise ValueError("earlier-only law violated by an analog neighbor")


def _golden_analog_inputs() -> tuple[AnalogQueryV1, tuple[AnalogRecordV1, ...]]:
    motif = (0, 30, 60, 30, 0, -30, -60, -30)
    query_values = tuple(_fp_hundredths(500 + delta) for delta in motif)
    anti_values = tuple(_fp_hundredths(500 - delta) for delta in motif)
    flat_values = tuple(_fp_hundredths(500) for _ in motif)
    short_values = tuple(_fp_hundredths(500 + delta) for delta in motif[:4])
    hour = 3_600 * SECOND_NS

    def record(
        record_id: str,
        *,
        end_offset_ns: int,
        values: tuple[FixedPointV1, ...],
        symbol: str = "BNBUSDT",
        outcome: str = "CONTINUATION",
        event_id: str | None = None,
    ) -> AnalogRecordV1:
        return AnalogRecordV1(
            record_id=record_id,
            symbol=symbol,
            regime_id="UNKNOWN",
            feature_id="close-window-v1",
            start_ns=BASE_NS + end_offset_ns - 8 * SECOND_NS,
            end_ns=BASE_NS + end_offset_ns,
            values=values,
            outcome_label=outcome,
            completeness=QualityState.SYNTHETIC,
            event_id=event_id,
        )

    query = AnalogQueryV1(
        query_id="query-golden",
        symbol="BNBUSDT",
        regime_id=None,
        feature_id="close-window-v1",
        start_ns=BASE_NS + 10 * hour,
        cutoff_ns=BASE_NS + 10 * hour + 8 * SECOND_NS,
        embargo_ns=hour,
        values=query_values,
        event_id="event-golden",
    )
    records = (
        record("analog-close-match", end_offset_ns=2 * hour, values=query_values),
        record(
            "analog-anti-match",
            end_offset_ns=3 * hour,
            values=anti_values,
            outcome="FADE",
        ),
        record(
            "analog-weak-match",
            end_offset_ns=4 * hour,
            values=tuple(
                _fp_hundredths(500 + delta) for delta in (10, 40, 20, 45, -15, -5, -50, -20)
            ),
            outcome="UNKNOWN",
        ),
        record("analog-future", end_offset_ns=11 * hour, values=query_values),
        record(
            "analog-overlap",
            end_offset_ns=10 * hour + 4 * SECOND_NS,
            values=query_values,
        ),
        record(
            "analog-cohort",
            end_offset_ns=2 * hour,
            values=query_values,
            symbol="ETHUSDT",
        ),
        record(
            "analog-same-event",
            end_offset_ns=5 * hour,
            values=query_values,
            event_id="event-golden",
        ),
        record("analog-degenerate", end_offset_ns=6 * hour, values=flat_values),
        AnalogRecordV1(
            record_id="analog-shape",
            symbol="BNBUSDT",
            regime_id="UNKNOWN",
            feature_id="close-window-v1",
            start_ns=BASE_NS + hour,
            end_ns=BASE_NS + hour + 4 * SECOND_NS,
            values=short_values,
            outcome_label="CONTINUATION",
            completeness=QualityState.SYNTHETIC,
            event_id=None,
        ),
    )
    return query, records


def _build_golden() -> dict[str, object]:
    change_values, true_changes = _golden_change_values()
    change_series = _series("series-golden-change", change_values)
    detection = {
        name: {"report": report.as_mapping(), "stepsSha256": digest}
        for name, (report, digest) in sorted(_detection_run(change_series, true_changes).items())
    }

    segmentation = segment_pelt(
        tuple(_fp_hundredths(value) for value in change_values),
        _pelt_config(),
    )
    segmentation_report = evaluate_segmentation(
        segmenter_id=_pelt_config().segmenter_id,
        series_id=change_series.series_id,
        true_boundaries=true_changes,
        detected_boundaries=segmentation.boundaries,
        slack=SEGMENTATION_SLACK,
    )

    anomaly_values, injected = _golden_anomaly_values()
    anomaly_series = _series("series-golden-anomaly", anomaly_values)
    scorer = RobustAnomalyScorer(_anomaly_config())
    anomaly_steps = run_series(scorer, anomaly_series)
    flagged = tuple(step.ordinal for step in anomaly_steps if step.exceeds)
    anomaly_measurement = evaluate_anomaly_flags(
        scorer_id=_anomaly_config().scorer_id,
        series_id=anomaly_series.series_id,
        series_length=len(anomaly_series.points),
        injected=injected,
        flagged=flagged,
    )

    regime_filter = SoftRegimeFilter(v1_regime_spec())
    regime_steps = run_series(regime_filter, change_series)

    profile_values = tuple(_fp_hundredths(value) for value in _golden_profile_values())
    profile = compute_left_profile(
        profile_values,
        _profile_config(),
        events=(EventIntervalV1(start=20, end=36),),
    )
    _verify_profile_law(profile)

    query, records = _golden_analog_inputs()
    retrieval = retrieve_analogs(query, records, k=3)
    _verify_analog_law(query, retrieval)

    return {
        "analogRetrieval": retrieval.as_mapping(),
        "anomaly": {
            "measurement": anomaly_measurement.as_mapping(),
            "stepsSha256": _steps_digest(anomaly_steps),
        },
        "detection": detection,
        "matrixProfile": profile.as_mapping(),
        "schema": "Q09RegimeGoldenFixtureV1",
        "segmentation": {
            "report": segmentation_report.as_mapping(),
            "segmentation": segmentation.as_mapping(),
        },
        "softRegime": {
            "finalMapState": regime_steps[-1].map_state,
            "specId": v1_regime_spec().spec_id,
            "stepsSha256": _steps_digest(regime_steps),
            "warmupSteps": sum(1 for step in regime_steps if step.status is StepStatus.WARMUP),
        },
        "version": 1,
    }


def _seeded_change_values(
    rng: DeterministicRandom,
) -> tuple[list[int], tuple[int, ...]]:
    length = 200
    change_count = 1 + int(rng.next_u64() % 2)
    first = 60 + int(rng.next_u64() % 40)
    changes = [first]
    if change_count == 2:
        changes.append(first + 50 + int(rng.next_u64() % 20))
    amplitude = 5 + int(rng.next_u64() % 6)
    phase = int(rng.next_u64() % 21)
    values = []
    offset = 0
    for index in range(length):
        if index in changes:
            magnitude = 40 + 40 * int(rng.next_u64() % 4)
            sign = 1 if rng.next_u64() % 2 == 0 else -1
            offset += sign * magnitude
        values.append(1_000 + offset + _zigzag(index, phase, amplitude))
    return values, tuple(changes)


def _aggregate_detection(
    rng: DeterministicRandom,
) -> tuple[dict[str, dict[str, int]], dict[str, object]]:
    totals: dict[str, dict[str, int]] = {
        name: {
            "detected": 0,
            "delaySum": 0,
            "falseAlarms": 0,
            "inControlBars": 0,
            "missed": 0,
            "redundantAlarms": 0,
        }
        for name in ("bocpd", "cusum", "pageHinkley")
    }
    report_mappings = []
    for series_index in range(SEEDED_DETECTION_SERIES):
        values, changes = _seeded_change_values(rng)
        series = _series(f"series-seeded-change-{series_index:02d}", values)
        for name, (report, _) in sorted(_detection_run(series, changes).items()):
            report_mappings.append(report.as_mapping())
            bucket = totals[name]
            bucket["detected"] += len(report.detected)
            bucket["delaySum"] += sum(report.delays)
            bucket["falseAlarms"] += len(report.false_alarms)
            bucket["missed"] += len(report.missed)
            bucket["redundantAlarms"] += len(report.redundant_alarms)
            bucket["inControlBars"] += report.in_control_bars
    summary: dict[str, object] = {}
    for name, bucket in sorted(totals.items()):
        false_rate = (
            None
            if bucket["inControlBars"] == 0
            else make_ratio(bucket["falseAlarms"], bucket["inControlBars"]).as_mapping()
        )
        mean_delay = (
            None
            if bucket["detected"] == 0
            else make_ratio(bucket["delaySum"], bucket["detected"]).as_mapping()
        )
        summary[name] = {
            "aggregateFalseAlarmRate": false_rate,
            "aggregateMeanDelay": mean_delay,
            **dict(sorted(bucket.items())),
        }
    reports_digest = hashlib.sha256(
        canonical_json_bytes(
            {"reports": report_mappings, "schema": "Q09DetectionReportsV1", "version": 1}
        )
    ).hexdigest()
    return totals, {"perDetector": summary, "reportsSha256": reports_digest}


def _aggregate_anomaly(rng: DeterministicRandom) -> dict[str, object]:
    hits = 0
    injected_total = 0
    false_flags = 0
    clean_total = 0
    measurement_mappings = []
    for series_index in range(SEEDED_ANOMALY_SERIES):
        amplitude = 5 + int(rng.next_u64() % 6)
        phase = int(rng.next_u64() % 21)
        spike_count = 2 + int(rng.next_u64() % 3)
        spikes: dict[int, int] = {}
        while len(spikes) < spike_count:
            position = 20 + int(rng.next_u64() % 170)
            if position in spikes:
                continue
            magnitude = (100 + 50 * int(rng.next_u64() % 4)) * (
                1 if rng.next_u64() % 2 == 0 else -1
            )
            spikes[position] = magnitude
        values = [
            1_000 + _zigzag(index, phase, amplitude) + spikes.get(index, 0) for index in range(200)
        ]
        series = _series(f"series-seeded-anomaly-{series_index:02d}", values)
        scorer = RobustAnomalyScorer(_anomaly_config())
        steps = run_series(scorer, series)
        flagged = tuple(step.ordinal for step in steps if step.exceeds)
        measurement = evaluate_anomaly_flags(
            scorer_id=_anomaly_config().scorer_id,
            series_id=series.series_id,
            series_length=len(series.points),
            injected=tuple(sorted(spikes)),
            flagged=flagged,
        )
        measurement_mappings.append(measurement.as_mapping())
        hits += len(measurement.hits)
        injected_total += len(measurement.injected)
        false_flags += len(measurement.false_flags)
        clean_total += measurement.series_length - len(measurement.injected)
    return {
        "aggregateFalseFlagRatio": make_ratio(false_flags, clean_total).as_mapping(),
        "aggregateHitRatio": make_ratio(hits, injected_total).as_mapping(),
        "measurementsSha256": hashlib.sha256(
            canonical_json_bytes(
                {
                    "measurements": measurement_mappings,
                    "schema": "Q09AnomalyMeasurementsV1",
                    "version": 1,
                }
            )
        ).hexdigest(),
        "series": SEEDED_ANOMALY_SERIES,
    }


def _aggregate_profiles(rng: DeterministicRandom) -> dict[str, object]:
    config = _profile_config()
    degenerate = 0
    future = 0
    overlap = 0
    same_event = 0
    neighbor_total = 0
    entry_total = 0
    for _ in range(SEEDED_PROFILE_SERIES):
        amplitude = 3 + int(rng.next_u64() % 8)
        phase = int(rng.next_u64() % 21)
        values = tuple(
            _fp_hundredths(500 + _zigzag(index, phase, amplitude)) for index in range(96)
        )
        event_start = 20 + int(rng.next_u64() % 40)
        profile = compute_left_profile(
            values,
            config,
            events=(EventIntervalV1(start=event_start, end=event_start + 12),),
        )
        _verify_profile_law(profile)
        degenerate += profile.exclusions.degenerate
        future += profile.exclusions.future
        overlap += profile.exclusions.overlap
        same_event += profile.exclusions.same_event
        entry_total += len(profile.entries)
        neighbor_total += sum(1 for entry in profile.entries if entry.neighbor is not None)
    return {
        "entries": entry_total,
        "exclusionTotals": {
            "degenerate": degenerate,
            "future": future,
            "overlap": overlap,
            "sameEvent": same_event,
        },
        "neighbors": neighbor_total,
        "series": SEEDED_PROFILE_SERIES,
    }


def _aggregate_analogs(rng: DeterministicRandom) -> dict[str, object]:
    exclusion_totals = dict.fromkeys(
        ("COHORT", "DEGENERATE", "FUTURE", "OVERLAP", "SAME_EVENT", "SHAPE"),
        0,
    )
    neighbor_total = 0
    cohort_total = 0
    outcomes = ("CONTINUATION", "FADE", "UNKNOWN")
    hour = 3_600 * SECOND_NS
    for batch in range(SEEDED_ANALOG_BATCHES):
        amplitude = 3 + int(rng.next_u64() % 8)
        phase = int(rng.next_u64() % 21)
        records = []
        for index in range(40):
            values = tuple(
                _fp_hundredths(500 + _zigzag(offset + 8 * index, phase, amplitude))
                for offset in range(8)
            )
            end_offset = (index + 1) * hour
            records.append(
                AnalogRecordV1(
                    record_id=f"analog-{batch:02d}-{index:02d}",
                    symbol="BNBUSDT" if index % 5 != 4 else "ETHUSDT",
                    regime_id="UNKNOWN",
                    feature_id="close-window-v1",
                    start_ns=BASE_NS + end_offset - 8 * SECOND_NS,
                    end_ns=BASE_NS + end_offset,
                    values=values,
                    outcome_label=outcomes[int(rng.next_u64() % 3)],
                    completeness=QualityState.SYNTHETIC,
                    event_id=f"event-{batch:02d}" if index % 7 == 0 else None,
                )
            )
        query_values = tuple(
            _fp_hundredths(500 + _zigzag(offset + 3, phase, amplitude + 1)) for offset in range(8)
        )
        query = AnalogQueryV1(
            query_id=f"query-{batch:02d}",
            symbol="BNBUSDT",
            regime_id=None,
            feature_id="close-window-v1",
            start_ns=BASE_NS + 30 * hour,
            cutoff_ns=BASE_NS + 30 * hour + 8 * SECOND_NS,
            embargo_ns=2 * hour,
            values=query_values,
            event_id=f"event-{batch:02d}",
        )
        retrieval = retrieve_analogs(query, tuple(records), k=5)
        _verify_analog_law(query, retrieval)
        for reason, count in retrieval.exclusion_counts:
            exclusion_totals[reason.value] += count
        neighbor_total += len(retrieval.neighbors)
        cohort_total += retrieval.cohort_size
    return {
        "batches": SEEDED_ANALOG_BATCHES,
        "cohortTotal": cohort_total,
        "exclusionTotals": dict(sorted(exclusion_totals.items())),
        "neighbors": neighbor_total,
    }


def build_artifacts() -> tuple[bytes, bytes, bytes]:
    golden = _build_golden()
    fixture_bytes = canonical_json_bytes(golden)

    rng = DeterministicRandom.from_seed(CAMPAIGN_SEED)
    detection_totals, detection = _aggregate_detection(rng)
    anomaly = _aggregate_anomaly(rng)
    profiles = _aggregate_profiles(rng)
    analogs = _aggregate_analogs(rng)
    campaign = {
        "analogs": analogs,
        "anomaly": anomaly,
        "detection": detection,
        "evidencePosture": "SYNTHETIC_ONLY",
        "fixtureSha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "matrixProfiles": profiles,
        "schema": "Q09RegimeCampaignV1",
        "seed": str(CAMPAIGN_SEED),
        "version": 1,
    }
    campaign_bytes = canonical_json_bytes(campaign)

    lines = [
        "# Q09 regime campaign evidence (synthetic only)",
        "",
        f"- Seed: `{CAMPAIGN_SEED}`",
        f"- Golden fixture SHA-256: `{hashlib.sha256(fixture_bytes).hexdigest()}`",
        f"- Detection series: {SEEDED_DETECTION_SERIES}; anomaly series: "
        f"{SEEDED_ANOMALY_SERIES}; profile series: {SEEDED_PROFILE_SERIES}; "
        f"analog batches: {SEEDED_ANALOG_BATCHES}",
        "",
        "No detector, regime, anomaly score or analogue is claimed to be predictive,",
        "calibrated or economically valuable; these are machinery measurements.",
        "",
        "| Detector | Detected | Missed | False alarms | In-control bars | Delay sum |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, bucket in sorted(detection_totals.items()):
        lines.append(
            f"| `{name}` | {bucket['detected']} | {bucket['missed']} "
            f"| {bucket['falseAlarms']} | {bucket['inControlBars']} "
            f"| {bucket['delaySum']} |"
        )
    lines.extend(
        [
            "",
            "## Exclusion measurements",
            "",
            f"- Matrix profile exclusion totals: {profiles['exclusionTotals']}",
            f"- Analog exclusion totals: {analogs['exclusionTotals']}",
            "",
        ]
    )
    markdown_bytes = "\n".join(lines).encode("utf-8")
    return fixture_bytes, campaign_bytes, markdown_bytes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m quant_edge.regime.campaign OUTPUT_ROOT", file=sys.stderr)
        return 2
    output_root = Path(argv[1])
    fixture_bytes, campaign_bytes, markdown_bytes = build_artifacts()
    target = output_root / "generated" / "q09"
    target.mkdir(parents=True, exist_ok=True)
    (target / "regime_golden_v1.json").write_bytes(fixture_bytes)
    (target / "regime_campaign.v1.json").write_bytes(campaign_bytes)
    (target / "regime_campaign.v1.md").write_bytes(markdown_bytes)
    print(f"fixture sha256 {hashlib.sha256(fixture_bytes).hexdigest()}")
    print(f"campaign sha256 {hashlib.sha256(campaign_bytes).hexdigest()}")
    print(f"markdown sha256 {hashlib.sha256(markdown_bytes).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
