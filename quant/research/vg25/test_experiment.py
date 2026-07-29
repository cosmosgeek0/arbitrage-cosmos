"""Synthetic, network-free contract tests for the sealed V-G25 evaluator."""

from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import sys
import zipfile
from collections.abc import Callable, Mapping, Sequence
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from research.vg25 import experiment as vg25


def _bar(day: date, volume: str = "10", price: str = "100") -> vg25.Bar:
    return vg25.Bar(day, Decimal(price), Decimal(volume))


def _daily_bars(
    start: date,
    count: int,
    *,
    volumes: Mapping[int, str] | None = None,
    prices: Mapping[int, str] | None = None,
) -> tuple[vg25.Bar, ...]:
    volume_overrides = volumes or {}
    price_overrides = prices or {}
    return tuple(
        _bar(
            start + timedelta(days=offset),
            volume_overrides.get(offset, "10"),
            price_overrides.get(offset, "100"),
        )
        for offset in range(count)
    )


def _episode(
    *,
    duration: int,
    recovered: bool,
    boundary_censored: bool = False,
) -> vg25.Episode:
    shock = date(2026, 1, 1)
    return vg25.Episode(
        "BTCUSDT",
        shock,
        Decimal("10"),
        duration,
        recovered,
        shock + timedelta(days=duration) if recovered else None,
        0,
        boundary_censored,
    )


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _read_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise AssertionError(f"expected JSON object with string keys: {path}")
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _write_bound_json(packet_path: Path, state: Path, value: Mapping[str, Any]) -> None:
    _write_json(packet_path, value)
    _write_json(state / packet_path.name, value)


def _refresh_checksums(packet: Path, checksums_path: Path) -> None:
    checksum_inputs = sorted(
        path for path in packet.iterdir() if path.is_file() and path != checksums_path
    )
    checksums_path.write_text(
        "".join(f"{_sha256(path)}  {path.name}\n" for path in checksum_inputs),
        encoding="utf-8",
    )


def _install_verifier_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    full_go_chain: bool,
) -> dict[str, Path]:
    packet = tmp_path / "packet"
    state = tmp_path / "state"
    packet.mkdir()
    state.mkdir()
    paths = {
        "packet": packet,
        "state": state,
        "protocol": packet / "protocol.v1.json",
        "manifest": packet / "source_manifest.v1.json",
        "freeze": packet / "freeze.v1.json",
        "marker": packet / "run-marker.v1.json",
        "development": packet / "development.v1.json",
        "selection": packet / "selection.v1.json",
        "result": packet / "result.v1.json",
        "holdout_marker": packet / "holdout-open-marker.v1.json",
        "holdout": packet / "holdout.v1.json",
        "checksums": packet / "SHA256SUMS",
    }
    protocol = {"data": {"stateRoot": str(state)}}
    _write_json(paths["protocol"], protocol)
    _write_json(paths["manifest"], {"synthetic": True})
    _write_json(paths["freeze"], {"version": "VG25FreezeV1"})
    protocol_sha = _sha256(paths["protocol"])
    freeze_sha = _sha256(paths["freeze"])
    marker = {
        "version": "VG25RunMarkerV1",
        "protocolSha256": protocol_sha,
        "freezeSha256": freeze_sha,
    }
    _write_bound_json(paths["marker"], state, marker)
    marker_sha = _sha256(paths["marker"])
    champion = "VG25-S25-R125-H07"
    development_gates = {"syntheticDevelopmentGate": full_go_chain}
    development = {
        "version": "VG25DevelopmentV1",
        "freezeSha256": freeze_sha,
        "runMarkerSha256": marker_sha,
        "championTrialId": champion,
        "developmentGates": development_gates,
        "allDevelopmentGatesPass": full_go_chain,
    }
    _write_bound_json(paths["development"], state, development)
    result: dict[str, Any] = {
        "version": "VG25ResultV1",
        "verdict": "PUBLIC_RESEARCH_GO" if full_go_chain else "NO_GO",
        "disposition": ("ALL_PUBLIC_GATES_PASS" if full_go_chain else "DEVELOPMENT_GATE_FAILURE"),
        "protocolSha256": protocol_sha,
        "freezeSha256": freeze_sha,
        "runMarkerSha256": marker_sha,
        "developmentOpened": True,
        "holdoutOpened": full_go_chain,
        "developmentSha256": _sha256(paths["development"]),
        "championTrialId": champion,
        "developmentGates": development_gates,
        "capitalAuthority": "NONE",
        "accountEffectiveFee": "UNKNOWN",
        "executableCapacity": "UNMEASURED",
        "causalIdentification": "NOT_CLAIMED",
        "consumer": "N3 successor/final convergence",
        "moneyEffectUsd": 0,
    }
    if full_go_chain:
        selection = {
            "version": "VG25SelectionV1",
            "freezeSha256": freeze_sha,
            "runMarkerSha256": marker_sha,
            "developmentSha256": _sha256(paths["development"]),
            "championTrialId": champion,
        }
        _write_bound_json(paths["selection"], state, selection)
        selection_sha = _sha256(paths["selection"])
        holdout_marker = {
            "version": "VG25HoldoutOpenMarkerV1",
            "freezeSha256": freeze_sha,
            "selectionSha256": selection_sha,
            "championTrialId": champion,
        }
        _write_bound_json(paths["holdout_marker"], state, holdout_marker)
        holdout_gates = {"syntheticHoldoutGate": True}
        holdout = {
            "version": "VG25HoldoutV1",
            "freezeSha256": freeze_sha,
            "selectionSha256": selection_sha,
            "holdoutMarkerSha256": _sha256(paths["holdout_marker"]),
            "championTrialId": champion,
            "holdoutGates": holdout_gates,
            "allHoldoutGatesPass": True,
        }
        _write_bound_json(paths["holdout"], state, holdout)
        result.update(
            {
                "selectionSha256": selection_sha,
                "holdoutSha256": _sha256(paths["holdout"]),
                "holdoutGates": holdout_gates,
            }
        )
    _write_bound_json(paths["result"], state, result)
    _refresh_checksums(packet, paths["checksums"])

    monkeypatch.setattr(vg25, "PACKET_DIR", packet)
    monkeypatch.setattr(vg25, "PROTOCOL_PATH", paths["protocol"])
    monkeypatch.setattr(vg25, "SOURCE_MANIFEST_PATH", paths["manifest"])
    monkeypatch.setattr(vg25, "FREEZE_PATH", paths["freeze"])
    monkeypatch.setattr(vg25, "RUN_MARKER_PATH", paths["marker"])
    monkeypatch.setattr(vg25, "DEVELOPMENT_PATH", paths["development"])
    monkeypatch.setattr(vg25, "SELECTION_PATH", paths["selection"])
    monkeypatch.setattr(vg25, "RESULT_PATH", paths["result"])
    monkeypatch.setattr(vg25, "HOLDOUT_MARKER_PATH", paths["holdout_marker"])
    monkeypatch.setattr(vg25, "HOLDOUT_PATH", paths["holdout"])
    monkeypatch.setattr(vg25, "SHA256SUMS_PATH", paths["checksums"])
    monkeypatch.setattr(vg25, "_verify_freeze", lambda *_args: {})
    monkeypatch.setattr(vg25, "_validate_manifest_shape", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(vg25, "_verify_external_inputs", lambda *_args: None)

    def forbid_zip_open(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("terminal verifier reopened a ZIP")

    monkeypatch.setattr(zipfile, "ZipFile", forbid_zip_open)
    return paths


def test_trial_ledger_is_exactly_the_generated_sealed_family() -> None:
    protocol = vg25.load_protocol()
    specs = vg25.generate_trial_specs(protocol)
    ledger = json.loads((vg25.PACKET_DIR / "trial_ledger.v1.json").read_text(encoding="utf-8"))

    assert len(specs) == 12
    assert len({spec.trial_id for spec in specs}) == 12
    assert ledger["attemptedCount"] == 12
    assert ledger["outcomesOpened"] == 0
    assert [trial["trialId"] for trial in ledger["trials"]] == [spec.trial_id for spec in specs]
    assert all(trial["status"] == "SEALED_UNOPENED" for trial in ledger["trials"])
    assert [
        (
            trial["shockThreshold"],
            trial["recoveryMultiple"],
            trial["maximumRecoveryHorizonDays"],
        )
        for trial in ledger["trials"]
    ] == [
        (
            str(spec.shock_threshold),
            str(spec.recovery_multiple),
            spec.maximum_horizon_days,
        )
        for spec in specs
    ]


def test_trial_family_mismatch_fails_closed() -> None:
    protocol = vg25.load_protocol()
    protocol["trialFamily"]["attemptedCount"] = 11
    with pytest.raises(vg25.VG25Error, match="TRIAL_FAMILY_MISMATCH"):
        vg25.generate_trial_specs(protocol)


def test_prior_only_baseline_crossing_freezes_baseline_and_enters_r_plus_two() -> None:
    origin = date(2025, 1, 1)
    shock_offset = 65
    bars = _daily_bars(
        origin,
        76,
        volumes={shock_offset: "30", shock_offset + 1: "12", shock_offset + 2: "12"},
        prices={shock_offset + 4: "100", shock_offset + 5: "110"},
    )
    spec = vg25.TrialSpec("SYNTHETIC", Decimal("2.5"), Decimal("1.25"), 7)
    shock_day = origin + timedelta(days=shock_offset)

    episodes, trades = vg25.detect_episodes(
        "BTCUSDT",
        bars,
        spec,
        shock_day,
        origin + timedelta(days=76),
    )

    assert len(episodes) == 1
    assert episodes[0].shock_day == shock_day
    assert episodes[0].frozen_baseline == Decimal("10")
    assert episodes[0].duration_days == 2
    assert episodes[0].recovered is True
    assert len(trades) == 1
    assert trades[0].signal_day == shock_day + timedelta(days=2)
    assert trades[0].entry_day == shock_day + timedelta(days=4)
    assert trades[0].exit_day == shock_day + timedelta(days=5)
    assert trades[0].gross_factor == pytest.approx(1.1)


def test_shock_requires_crossing_from_strictly_below_threshold() -> None:
    origin = date(2025, 1, 1)
    start_offset = 65
    bars = _daily_bars(
        origin,
        75,
        volumes={
            start_offset - 1: "30",
            start_offset: "30",
            start_offset + 1: "10",
            start_offset + 2: "10",
        },
    )
    spec = vg25.TrialSpec("SYNTHETIC", Decimal("2.5"), Decimal("1.25"), 7)

    episodes, trades = vg25.detect_episodes(
        "BTCUSDT",
        bars,
        spec,
        origin + timedelta(days=start_offset),
        origin + timedelta(days=75),
    )

    assert episodes == ()
    assert trades == ()


def test_recovery_confirmation_at_inclusive_horizon_is_recovered() -> None:
    origin = date(2025, 1, 1)
    shock_offset = 65
    bars = _daily_bars(
        origin,
        82,
        volumes={
            shock_offset: "30",
            shock_offset + 1: "20",
            shock_offset + 2: "20",
            shock_offset + 3: "20",
            shock_offset + 4: "20",
            shock_offset + 5: "20",
            shock_offset + 6: "12",
            shock_offset + 7: "12",
        },
    )
    spec = vg25.TrialSpec("SYNTHETIC", Decimal("2.5"), Decimal("1.25"), 7)
    shock_day = origin + timedelta(days=shock_offset)

    episodes, trades = vg25.detect_episodes(
        "BTCUSDT",
        bars,
        spec,
        shock_day,
        origin + timedelta(days=82),
    )

    assert len(episodes) == 1
    assert episodes[0].duration_days == 7
    assert episodes[0].recovered is True
    assert trades[0].entry_day == shock_day + timedelta(days=9)


def test_censor_closes_episode_and_next_day_crossing_can_rearm() -> None:
    origin = date(2025, 1, 1)
    shock_offset = 65
    bars = _daily_bars(
        origin,
        73,
        volumes={
            shock_offset: "100",
            shock_offset + 1: "100",
            shock_offset + 2: "10",
            shock_offset + 3: "100",
            shock_offset + 4: "100",
            shock_offset + 5: "100",
        },
    )
    spec = vg25.TrialSpec("SYNTHETIC", Decimal("2.5"), Decimal("1.25"), 2)
    shock_day = origin + timedelta(days=shock_offset)

    episodes, trades = vg25.detect_episodes(
        "BTCUSDT",
        bars,
        spec,
        shock_day,
        shock_day + timedelta(days=7),
    )

    assert [episode.shock_day for episode in episodes] == [
        shock_day,
        shock_day + timedelta(days=3),
    ]
    assert [episode.duration_days for episode in episodes] == [2, 2]
    assert all(not episode.recovered for episode in episodes)
    assert trades == ()


def test_partition_boundary_censors_recovery_that_cannot_complete_lifecycle() -> None:
    origin = date(2025, 1, 1)
    shock_offset = 65
    shock_day = origin + timedelta(days=shock_offset)
    bars = _daily_bars(
        origin,
        72,
        volumes={shock_offset: "30", shock_offset + 1: "10", shock_offset + 2: "10"},
    )
    spec = vg25.TrialSpec("SYNTHETIC", Decimal("2.5"), Decimal("1.25"), 7)

    episodes, trades = vg25.detect_episodes(
        "BTCUSDT",
        bars,
        spec,
        shock_day,
        shock_day + timedelta(days=4),
    )

    assert len(episodes) == 1
    assert episodes[0].recovered is False
    assert episodes[0].boundary_censored is True
    assert episodes[0].recovery_confirmation_day is None
    assert trades == ()


def test_exact_cost_factor_matches_preregistered_multiplicative_equation() -> None:
    gross = 1.1
    fee_bp = 10
    adverse_bp = 2
    expected = (
        gross
        * ((1.0 - adverse_bp / 10_000) / (1.0 + adverse_bp / 10_000))
        * (1.0 - fee_bp / 10_000) ** 2
    )

    assert vg25._net_factor(gross, fee_bp, adverse_bp) == pytest.approx(expected)
    assert vg25._net_factor(1.0, 0, 0) == 1.0


def test_partition_uses_equal_weight_cohort_and_cash_on_every_other_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2026, 1, 1)
    end = start + timedelta(days=3)
    bars = {
        "AAAUSDT": _daily_bars(start, 3),
        "BBBUSDT": _daily_bars(start, 3),
    }
    trades = {
        "AAAUSDT": vg25.Trade(
            "AAAUSDT", start - timedelta(days=2), start, start + timedelta(days=1), 1.1, 2_000
        ),
        "BBBUSDT": vg25.Trade(
            "BBBUSDT", start - timedelta(days=2), start, start + timedelta(days=1), 0.9, 3_000
        ),
    }

    def synthetic_detect(
        symbol: str,
        _bars: Sequence[vg25.Bar],
        _spec: vg25.TrialSpec,
        _partition_start: date,
        _partition_end: date,
        lookback: int = 60,
    ) -> tuple[tuple[vg25.Episode, ...], tuple[vg25.Trade, ...]]:
        assert lookback == 60
        return (), (trades[symbol],)

    monkeypatch.setattr(vg25, "detect_episodes", synthetic_detect)
    protocol = vg25.load_protocol()
    spec = vg25.TrialSpec("SYNTHETIC", Decimal("2.5"), Decimal("1.25"), 7)

    evaluation = vg25._evaluate_partition(protocol, bars, spec, start, end)

    report = evaluation.report
    assert report["completedCohorts"] == 1
    assert report["tradeCount"] == 2
    assert report["cohorts"][0]["symbols"] == ["AAAUSDT", "BBBUSDT"]
    assert report["cohorts"][0]["grossReturn"] == pytest.approx(0.0)
    assert report["gross"]["netUsdPer1000"] == pytest.approx(0.0)
    assert len(evaluation.stress_log_returns) == 3
    assert evaluation.stress_log_returns[1:] == (0.0, 0.0)
    expected_stress = (vg25._net_factor(1.1, 10, 10) + vg25._net_factor(0.9, 10, 10)) / 2
    assert evaluation.stress_log_returns[0] == pytest.approx(math.log(expected_stress))
    assert report["capacity"]["minimumSupportedCapitalUsd"] == 4_000


def test_supported_capital_uses_prior_thirty_day_medians_for_both_legs() -> None:
    start = date(2025, 1, 1)
    bars = {
        bar.day: bar
        for bar in _daily_bars(
            start,
            40,
            volumes=dict.fromkeys(range(40), "20000000"),
        )
    }
    entry = start + timedelta(days=35)
    exit_day = entry + timedelta(days=1)

    assert vg25._supported_capital(bars, entry, exit_day, 30) == 2_000
    with pytest.raises(vg25.MeasurementError, match="CAPACITY_LOOKBACK_INCOMPLETE"):
        vg25._supported_capital(bars, start + timedelta(days=29), start + timedelta(days=30), 30)


def test_kaplan_meier_updates_recoveries_before_censors_and_reports_rmst() -> None:
    result = vg25.kaplan_meier(
        (
            _episode(duration=2, recovered=True),
            _episode(duration=2, recovered=False),
            _episode(duration=3, recovered=True),
        ),
        horizon=4,
    )

    assert result["episodeCount"] == 3
    assert result["recoveredCount"] == 2
    assert result["rightCensoredCount"] == 1
    assert result["medianRecoveryDays"] == 3
    assert result["restrictedMeanRecoveryDays"] == pytest.approx(8 / 3)
    assert result["curve"][0] == {
        "day": 0,
        "atRisk": 3,
        "recoveries": 0,
        "censored": 0,
        "survival": 1.0,
    }
    assert result["curve"][2] == {
        "day": 2,
        "atRisk": 3,
        "recoveries": 1,
        "censored": 1,
        "survival": pytest.approx(2 / 3),
    }
    assert result["curve"][3]["atRisk"] == 1
    assert result["curve"][3]["survival"] == 0.0


def test_kaplan_meier_refuses_to_turn_empty_or_time_zero_censoring_into_zero() -> None:
    empty = vg25.kaplan_meier((), horizon=7)
    time_zero_only = vg25.kaplan_meier(
        (_episode(duration=0, recovered=False, boundary_censored=True),),
        horizon=7,
    )

    assert empty["status"] == "NOT_ESTIMABLE_NO_EPISODES"
    assert empty["restrictedMeanRecoveryDays"] is None
    assert empty["curve"] == []
    assert time_zero_only["status"] == "NOT_ESTIMABLE_ONLY_TIME_ZERO_CENSORS"
    assert time_zero_only["restrictedMeanRecoveryDays"] is None
    assert time_zero_only["curve"] == [
        {
            "day": 0,
            "atRisk": 1,
            "recoveries": 0,
            "censored": 1,
            "survival": 1.0,
        }
    ]


def test_circular_bootstrap_is_deterministic_contiguous_wrapped_and_bounded() -> None:
    first = vg25.circular_block_indices(7, 3, 5, 250725)
    second = vg25.circular_block_indices(7, 3, 5, 250725)

    assert first == second
    assert len(first) == 5
    assert all(len(sample) == 7 for sample in first)
    assert all(0 <= index < 7 for sample in first for index in sample)
    for sample in first:
        assert all(sample[offset + 1] == (sample[offset] + 1) % 7 for offset in (0, 1, 3, 4))
    with pytest.raises(ValueError, match="positive"):
        vg25.circular_block_indices(0, 3, 5, 1)


def test_bootstrap_bounds_use_exact_zero_based_floor_and_ceiling_rules() -> None:
    series = (math.log(1.01), math.log(1.02), math.log(0.99))
    indices = tuple((index,) for index in range(3)) * 20
    estimates = sorted(1000.0 * math.expm1(series[index]) for (index,) in indices)
    expected_lower = estimates[math.floor(0.05 * (len(estimates) - 1))]
    expected_upper = estimates[math.ceil(0.95 * (len(estimates) - 1))]

    lower, upper = vg25._bootstrap_net_bounds(series, indices)
    assert lower == pytest.approx(expected_lower)
    assert upper == pytest.approx(expected_upper)


def test_family_inference_constructs_one_shared_draw_set_per_block_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    protocol = vg25.load_protocol()
    protocol["inference"]["bootstrap"].update(
        {"replicates": 4, "seed": 99, "primaryBlockLengthDays": 2, "sensitivityBlockLengthDays": 3}
    )
    calls: list[tuple[int, int, int, int]] = []

    def controlled_indices(
        length: int,
        block_length: int,
        replicates: int,
        seed: int,
    ) -> tuple[tuple[int, ...], ...]:
        calls.append((length, block_length, replicates, seed))
        return tuple(tuple(range(length)) for _ in range(replicates))

    monkeypatch.setattr(vg25, "circular_block_indices", controlled_indices)
    stress = {
        "A": (0.01, 0.0, -0.01, 0.02, 0.0, 0.01, -0.01, 0.0),
        "B": (0.0, 0.01, 0.0, -0.01, 0.02, 0.0, 0.01, -0.01),
    }
    benchmark = dict.fromkeys(stress, (0.0,) * 8)

    result = vg25._family_inference(protocol, stress, benchmark)

    assert calls == [(8, 2, 4, 99), (8, 3, 4, 99)]
    assert set(result["trials"]) == {"A", "B"}
    assert result["bootstrapReplicates"] == 4


def test_holm_adjustment_is_step_down_monotone_and_ties_by_id() -> None:
    adjusted = vg25.holm_adjust({"B": 0.01, "A": 0.01, "C": 0.04, "D": 0.5})

    assert adjusted == {"A": 0.04, "B": 0.04, "C": 0.08, "D": 0.5}


def test_white_reality_check_uses_centered_family_maximum() -> None:
    matrix = {
        "A": (0.03, 0.01, 0.02, 0.00),
        "B": (0.01, 0.01, 0.01, 0.01),
    }
    indices = ((0, 1, 2, 3), (0, 0, 0, 0), (3, 3, 3, 3))

    result = vg25._white_reality_check(matrix, indices)

    assert result["bestTrialId"] == "A"
    assert result["observedBestMeanDailyExcessLogReturn"] == pytest.approx(0.015)
    assert result["familySize"] == 2
    assert result["pValue"] == pytest.approx(0.5)


def test_cscv_pbo_uses_all_seventy_splits_and_is_diagnostic_only() -> None:
    result = vg25.cscv_pbo(
        {
            "A": (0.02, 0.02, 0.02, 0.02, -0.01, -0.01, -0.01, -0.01),
            "B": (-0.01, -0.01, -0.01, -0.01, 0.02, 0.02, 0.02, 0.02),
            "C": (0.0,) * 8,
        }
    )

    assert result["status"] == "AVAILABLE"
    assert result["splitCount"] == 70
    assert 0 <= result["probabilityBacktestOverfitting"] <= 1
    assert result["role"] == "DIAGNOSTIC_ONLY_NOT_A_P_VALUE_OR_GATE"
    assert sum(result["selectionCounts"].values()) == 70
    assert vg25.cscv_pbo({}) == {"status": "UNAVAILABLE", "reason": "EMPTY_TRIAL_MATRIX"}
    assert vg25.cscv_pbo({"A": (0.0,) * 8, "B": (0.0,) * 7}) == {
        "status": "UNAVAILABLE",
        "reason": "INCOMPLETE_TRIAL_MATRIX",
    }


@pytest.mark.parametrize(
    ("row_mutation", "reason"),
    [
        (lambda row: row.__setitem__(0, "1735689600000"), "TIMESTAMP_NOT_MICROSECONDS"),
        (lambda row: row.__setitem__(0, "1735689600000001"), "KLINE_OPEN_NOT_WHOLE_SECOND"),
        (lambda row: row.__setitem__(1, "NaN"), "NON_FINITE_KLINE_VALUE"),
        (lambda row: row.__setitem__(1, "0"), "INVALID_KLINE_DOMAIN"),
        (lambda row: row.__setitem__(7, "-1"), "INVALID_KLINE_DOMAIN"),
        (lambda row: row.__setitem__(6, "1735775999999998"), "KLINE_CLOSE_TIME_MISMATCH"),
        (lambda row: row.__setitem__(2, "98"), "INVALID_KLINE_OHLC_ORDER"),
    ],
)
def test_kline_parser_rejects_invalid_timestamp_and_decimal_domains(
    row_mutation: Callable[[list[str]], None],
    reason: str,
) -> None:
    row = [
        "1735689600000000",
        "100",
        "101",
        "99",
        "100",
        "1",
        "1735775999999999",
        "10",
        "1",
        "0.5",
        "5",
        "0",
    ]
    row_mutation(row)
    columns = vg25.load_protocol()["data"]["klineColumnsZeroBased"]

    with pytest.raises(vg25.MeasurementError, match=reason):
        vg25._parse_bar(row, columns)


def test_publisher_sidecar_parser_rejects_wrong_name_shape_and_digest(tmp_path: Path) -> None:
    sidecar = tmp_path / "archive.zip.CHECKSUM"
    sidecar.write_text(f"{'a' * 64}  other.zip\n", encoding="utf-8")
    with pytest.raises(vg25.VG25Error, match="PUBLISHER_CHECKSUM_FILENAME_MISMATCH"):
        vg25._parse_publisher_checksum(sidecar, "archive.zip")

    sidecar.write_text("not-a-digest archive.zip\n", encoding="utf-8")
    with pytest.raises(vg25.VG25Error, match="PUBLISHER_CHECKSUM_DIGEST_INVALID"):
        vg25._parse_publisher_checksum(sidecar, "archive.zip")

    sidecar.write_text(f"{'a' * 64}\n", encoding="utf-8")
    with pytest.raises(vg25.VG25Error, match="PUBLISHER_CHECKSUM_FORMAT_INVALID"):
        vg25._parse_publisher_checksum(sidecar, "archive.zip")


def test_archive_loader_rejects_multiple_zip_members(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_root = tmp_path / "state"
    archive_path = state_root / "raw/BTCUSDT/test.zip"
    archive_path.parent.mkdir(parents=True)
    with zipfile.ZipFile(archive_path, "w") as handle:
        handle.writestr("first.csv", b"")
        handle.writestr("second.csv", b"")
    protocol = vg25.load_protocol()
    protocol["data"]["stateRoot"] = str(state_root)
    protocol["data"]["symbols"] = ["BTCUSDT"]
    manifest = {
        "archives": [
            {
                "symbol": "BTCUSDT",
                "month": "2025-01",
                "archive": {"path": "raw/BTCUSDT/test.zip"},
            }
        ]
    }

    with pytest.raises(vg25.MeasurementError, match="ZIP_MEMBER_COUNT_NOT_ONE"):
        vg25._load_bars(
            protocol,
            manifest,
            ("2025-01",),
            date(2025, 1, 1),
            date(2025, 2, 1),
        )


def test_exclusive_json_write_fsyncs_file_and_directory_and_never_overwrites(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fsync_descriptors: list[int] = []

    def record_fsync(descriptor: int) -> None:
        fsync_descriptors.append(descriptor)

    monkeypatch.setattr(os, "fsync", record_fsync)
    target = tmp_path / "marker.json"
    vg25._write_json_exclusive(target, {"marker": "CONSUMED"})

    assert json.loads(target.read_text(encoding="utf-8")) == {"marker": "CONSUMED"}
    assert len(fsync_descriptors) == 2
    with pytest.raises(FileExistsError):
        vg25._write_json_exclusive(target, {"marker": "OVERWRITE"})
    assert json.loads(target.read_text(encoding="utf-8")) == {"marker": "CONSUMED"}


def test_freeze_verification_rejects_mutated_bound_input(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    packet = tmp_path / "packet"
    quant = tmp_path / "quant"
    state = tmp_path / "state"
    packet.mkdir()
    quant.mkdir()
    state.mkdir()
    protocol_path = packet / "protocol.v1.json"
    manifest_path = packet / "source_manifest.v1.json"
    freeze_path = packet / "freeze.v1.json"
    bound_path = packet / "bound.txt"
    protocol_path.write_text("{}\n", encoding="utf-8")
    manifest_path.write_text("{}\n", encoding="utf-8")
    state_manifest_path = state / manifest_path.name
    state_manifest_path.write_text("{}\n", encoding="utf-8")
    bound_path.write_text("sealed\n", encoding="utf-8")
    freeze_object = {
        "version": "VG25FreezeV1",
        "protocolSha256": _sha256(protocol_path),
        "sourceManifestSha256": _sha256(manifest_path),
        "stateSourceManifestSha256": _sha256(state_manifest_path),
        "stateRoot": str(state),
        "git": {
            "canonicalBase": "base",
            "authorityHead": "head",
            "authorityTree": "sealed-tree",
        },
        "runtime": {
            "python": sys.version,
            "implementation": platform.python_implementation(),
            "uvVersion": "uv synthetic",
        },
        "inputs": [
            {
                "path": "quant/research/vg25/bound.txt",
                "sha256": _sha256(bound_path),
                "bytes": bound_path.stat().st_size,
            }
        ],
    }
    _write_json(freeze_path, freeze_object)
    _write_json(state / freeze_path.name, freeze_object)
    monkeypatch.setattr(vg25, "PACKET_DIR", packet)
    monkeypatch.setattr(vg25, "QUANT_DIR", quant)
    monkeypatch.setattr(vg25, "PROTOCOL_PATH", protocol_path)
    monkeypatch.setattr(vg25, "SOURCE_MANIFEST_PATH", manifest_path)
    monkeypatch.setattr(vg25, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg25, "_uv_version", lambda: "uv synthetic")
    monkeypatch.setattr(vg25, "_git_is_ancestor", lambda *_args: True)
    monkeypatch.setattr(vg25, "_git_output", lambda *_args: "sealed-tree")
    protocol = {
        "canonicalBase": "base",
        "lifecycle": {
            "freezeBoundPacketPaths": ["bound.txt"],
            "freezeBoundRuntimePathsRelativeToQuant": [],
        },
    }

    assert vg25._verify_freeze(protocol, state) == freeze_object
    bound_path.write_text("mutated\n", encoding="utf-8")
    with pytest.raises(vg25.VG25Error, match=r"FREEZE_INPUT_HASH_MISMATCH:bound\.txt"):
        vg25._verify_freeze(protocol, state)


def test_run_git_precondition_requires_one_exact_freeze_only_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_object = {"git": {"authorityHead": "sealed-authority"}}
    responses = {
        ("status", "--porcelain=v1", "--untracked-files=all"): "",
        ("rev-parse", "HEAD"): "run-head",
        ("rev-parse", "run-head^"): "sealed-authority",
        (
            "diff",
            "--name-only",
            "sealed-authority",
            "run-head",
        ): "quant/research/vg25/freeze.v1.json",
    }

    def controlled_git(*arguments: str) -> str:
        return responses[arguments]

    monkeypatch.setattr(vg25, "_git_output", controlled_git)
    vg25._require_run_git_precondition(freeze_object)

    responses[("diff", "--name-only", "sealed-authority", "run-head")] = (
        "quant/research/vg25/freeze.v1.json\nquant/research/vg25/protocol.v1.json"
    )
    with pytest.raises(vg25.VG25Error, match="RUN_HEAD_DIFF_NOT_EXACT_FREEZE"):
        vg25._require_run_git_precondition(freeze_object)


def test_terminal_verifier_accepts_measured_development_failure_without_opening_zip(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _install_verifier_fixture(
        tmp_path,
        monkeypatch,
        full_go_chain=False,
    )

    verified = vg25.verify()

    assert verified == {
        "status": "PASS",
        "verdict": "NO_GO",
        "resultSha256": _sha256(paths["result"]),
        "developmentOpened": True,
        "holdoutOpened": False,
        "verifiedSha256SumEntries": 6,
        "sourceArchivesReopened": 0,
        "statisticsRecomputed": False,
        "networkUsed": False,
    }


def test_terminal_verifier_rejects_no_go_without_development_measurement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _install_verifier_fixture(
        tmp_path,
        monkeypatch,
        full_go_chain=False,
    )
    paths["development"].unlink()
    (paths["state"] / paths["development"].name).unlink()
    result = _read_json_object(paths["result"])
    result["developmentOpened"] = False
    for key in ("developmentSha256", "championTrialId", "developmentGates"):
        result.pop(key)
    _write_bound_json(paths["result"], paths["state"], result)
    _refresh_checksums(paths["packet"], paths["checksums"])

    with pytest.raises(vg25.VG25Error, match="INVALID_NO_GO_CHAIN"):
        vg25.verify()


def test_terminal_verifier_rejects_gate_and_all_summary_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _install_verifier_fixture(
        tmp_path,
        monkeypatch,
        full_go_chain=False,
    )
    development = _read_json_object(paths["development"])
    development["allDevelopmentGatesPass"] = True
    _write_bound_json(paths["development"], paths["state"], development)
    result = _read_json_object(paths["result"])
    result["developmentSha256"] = _sha256(paths["development"])
    _write_bound_json(paths["result"], paths["state"], result)
    _refresh_checksums(paths["packet"], paths["checksums"])

    with pytest.raises(
        vg25.VG25Error,
        match="INVALID_GATE_SUMMARY:allDevelopmentGatesPass",
    ):
        vg25.verify()


def test_terminal_verifier_rejects_champion_chain_mismatch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _install_verifier_fixture(
        tmp_path,
        monkeypatch,
        full_go_chain=True,
    )
    selection = _read_json_object(paths["selection"])
    selection["championTrialId"] = "VG25-S50-R150-H14"
    _write_bound_json(paths["selection"], paths["state"], selection)
    result = _read_json_object(paths["result"])
    result["selectionSha256"] = _sha256(paths["selection"])
    _write_bound_json(paths["result"], paths["state"], result)
    _refresh_checksums(paths["packet"], paths["checksums"])

    with pytest.raises(vg25.VG25Error, match="SELECTION_CHAMPION_MISMATCH"):
        vg25.verify()


def test_terminal_verifier_rejects_go_without_both_result_gate_families(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _install_verifier_fixture(
        tmp_path,
        monkeypatch,
        full_go_chain=True,
    )
    result = _read_json_object(paths["result"])
    result.pop("developmentGates")
    result.pop("holdoutGates")
    _write_bound_json(paths["result"], paths["state"], result)
    _refresh_checksums(paths["packet"], paths["checksums"])

    with pytest.raises(
        vg25.VG25Error,
        match="RESULT_DEVELOPMENT_GATES_COPY_MISMATCH",
    ):
        vg25.verify()
