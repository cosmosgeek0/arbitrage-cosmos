"""Synthetic, network-free tests for V-G7 protocol and evaluator boundaries."""

from __future__ import annotations

import hashlib
import json
import zipfile
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from research.vg7 import experiment


def protocol() -> dict[str, object]:
    value = json.loads(experiment.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def synthetic_bars() -> dict[str, dict[date, experiment.Bar]]:
    start = date(2025, 3, 1)
    bars: dict[date, experiment.Bar] = {}
    for offset in range(400):
        day = start + timedelta(days=offset)
        bars[day] = experiment.Bar(day, 100, 100.5, 99.5, 100, 20_000_000, 1_000)
    pivot_day = start + timedelta(days=95)
    bars[pivot_day] = experiment.Bar(
        pivot_day,
        100,
        101,
        90,
        95,
        80_000_000,
        8_000,
    )
    confirmation_day = pivot_day + timedelta(days=1)
    bars[confirmation_day] = experiment.Bar(
        confirmation_day,
        95,
        99,
        91,
        98,
        30_000_000,
        3_000,
    )
    entry_day = pivot_day + timedelta(days=2)
    bars[entry_day] = experiment.Bar(
        entry_day,
        98,
        100,
        97,
        99,
        20_000_000,
        2_000,
    )
    exit_day = entry_day + timedelta(days=3)
    bars[exit_day] = experiment.Bar(
        exit_day,
        105,
        106,
        104,
        105,
        20_000_000,
        2_000,
    )
    return {"TESTUSDT": bars}


def test_registered_family_is_exact_and_distinct() -> None:
    frozen = protocol()
    trials = experiment.build_trials(frozen)
    assert len(trials) == 36
    assert len({trial.trial_id for trial in trials}) == 36
    assert min(trial.volume_multiple for trial in trials) == 2
    assert experiment.nested(frozen, "distinctness", "notVg3").startswith("NO_CROSS_SECTIONAL")
    assert experiment.nested(frozen, "distinctness", "notVg4").startswith(
        "PIVOT_VOLUME_MULTIPLE_AT_LEAST_2X"
    )


def test_signal_requires_completed_confirmation_and_enters_t_plus_2() -> None:
    bars = synthetic_bars()
    pivot = date(2025, 3, 1) + timedelta(days=95)
    signals = experiment.signal_bases(
        bars,
        partition_start=pivot + timedelta(days=2),
        partition_end=pivot + timedelta(days=20),
    )
    assert len(signals) == 1
    assert signals[0].pivot_day == pivot
    assert signals[0].entry_day == pivot + timedelta(days=2)

    confirmation = bars["TESTUSDT"][pivot + timedelta(days=1)]
    bars["TESTUSDT"][pivot + timedelta(days=1)] = experiment.Bar(
        confirmation.day,
        confirmation.open,
        confirmation.high,
        89,
        confirmation.close,
        confirmation.quote_volume,
        confirmation.trade_count,
    )
    assert (
        experiment.signal_bases(
            bars,
            partition_start=pivot + timedelta(days=2),
            partition_end=pivot + timedelta(days=20),
        )
        == ()
    )


def test_confirmation_close_equal_to_pivot_midpoint_is_rejected() -> None:
    bars = synthetic_bars()
    pivot = date(2025, 3, 1) + timedelta(days=95)
    confirmation_day = pivot + timedelta(days=1)
    confirmation = bars["TESTUSDT"][confirmation_day]
    pivot_bar = bars["TESTUSDT"][pivot]
    midpoint = (pivot_bar.high + pivot_bar.low) / 2
    bars["TESTUSDT"][confirmation_day] = experiment.Bar(
        confirmation.day,
        94,
        confirmation.high,
        confirmation.low,
        midpoint,
        confirmation.quote_volume,
        confirmation.trade_count,
    )
    assert (
        experiment.signal_bases(
            bars,
            partition_start=pivot + timedelta(days=2),
            partition_end=pivot + timedelta(days=20),
        )
        == ()
    )


def test_costed_portfolio_and_capacity_proxy_are_causal() -> None:
    bars = synthetic_bars()
    pivot = date(2025, 3, 1) + timedelta(days=95)
    start = pivot + timedelta(days=2)
    end = start + timedelta(days=10)
    bases = experiment.signal_bases(bars, partition_start=start, partition_end=end)
    trial = experiment.Trial("SYNTHETIC", 4, -0.05, 0.40, 3)
    zero_cost = experiment.CostScenario("ZERO", 0, 0, False)
    stressed = experiment.CostScenario("STRESS", 10, 25, True)
    zero = experiment.evaluate_trial(
        trial=trial,
        scenario=zero_cost,
        bases=bases,
        bars_by_symbol=bars,
        partition_start=start,
        partition_end=end,
    )
    costed = experiment.evaluate_trial(
        trial=trial,
        scenario=stressed,
        bases=bases,
        bars_by_symbol=bars,
        partition_start=start,
        partition_end=end,
    )
    assert zero.round_trips == 1
    assert zero.fills == 2
    assert zero.net_per_initial_1000_usd == pytest.approx((1_000 / 3) * (105 / 98 - 1))
    assert costed.net_per_initial_1000_usd < zero.net_per_initial_1000_usd
    assert costed.supported_initial_capital_p05_usdt is not None
    assert costed.supported_initial_capital_p05_usdt > 5_000
    assert len(costed.daily_returns) == 10


def test_missing_future_bar_invalidates_instead_of_dropping_trade() -> None:
    bars = synthetic_bars()
    pivot = date(2025, 3, 1) + timedelta(days=95)
    start = pivot + timedelta(days=2)
    del bars["TESTUSDT"][start + timedelta(days=3)]
    bases = experiment.signal_bases(
        bars,
        partition_start=start,
        partition_end=start + timedelta(days=10),
    )
    with pytest.raises(
        experiment.EvidenceError,
        match="CLUSTERED_OPPORTUNITY_REQUIRED_BAR_UNAVAILABLE_TESTUSDT",
    ):
        experiment.evaluate_trial(
            trial=experiment.Trial("SYNTHETIC", 4, -0.05, 0.40, 3),
            scenario=experiment.CostScenario("STRESS", 10, 25, True),
            bases=bases,
            bars_by_symbol=bars,
            partition_start=start,
            partition_end=start + timedelta(days=10),
        )


def test_bootstrap_and_pbo_are_deterministic_and_development_aligned() -> None:
    returns = tuple(0.001 if index % 3 else -0.0005 for index in range(80))
    first = experiment.circular_bootstrap(
        returns,
        replicates=128,
        block_length=7,
        seed=2026072907,
    )
    second = experiment.circular_bootstrap(
        returns,
        replicates=128,
        block_length=7,
        seed=2026072907,
    )
    assert first == second
    series = {
        f"T{index:02d}": tuple(value - index * 0.000001 for value in returns) for index in range(36)
    }
    pbo = experiment.calculate_pbo(series)
    assert pbo["splitCount"] == 70
    assert pbo["purgeDaysAtAssignmentBoundary"] == 7
    assert 0 <= float(str(pbo["pbo"])) <= 1


def test_bootstrap_holm_statistic_tracks_compounded_log_growth() -> None:
    returns = (0.50, -0.40) * 40
    assert 1_000 * ((1.5 * 0.6) ** 40 - 1) < 0
    result = experiment.circular_bootstrap(
        returns,
        replicates=256,
        block_length=2,
        seed=2026072907,
    )
    assert result["oneSidedTestStatistic"] == "MEAN_DAILY_LOG_GROWTH"
    assert float(str(result["oneSidedCenteredPValue"])) > 0.05


def test_exact_july_first_entry_has_full_90_day_warmup() -> None:
    start = date(2025, 3, 1)
    bars = {
        start + timedelta(days=offset): experiment.Bar(
            start + timedelta(days=offset),
            100,
            100.5,
            99.5,
            100,
            20_000_000,
            1_000,
        )
        for offset in range(140)
    }
    pivot = date(2025, 6, 29)
    bars[pivot] = experiment.Bar(pivot, 100, 101, 90, 95, 80_000_000, 8_000)
    confirmation = pivot + timedelta(days=1)
    bars[confirmation] = experiment.Bar(confirmation, 95, 99, 91, 98, 30_000_000, 3_000)
    signals = experiment.signal_bases(
        {"TESTUSDT": bars},
        partition_start=date(2025, 7, 1),
        partition_end=date(2025, 7, 10),
    )
    assert len(signals) == 1
    assert signals[0].entry_day == date(2025, 7, 1)


def test_semantic_unavailability_is_allowed_only_in_warmup() -> None:
    experiment.require_measurement_months_semantically_available(
        ("AERGOUSDT|2025-03|DAILY_CLOSE_BOUNDARY_INVALID",),
        measurement_start=date(2025, 7, 1),
    )
    with pytest.raises(experiment.EvidenceError, match="MEASUREMENT_MONTH"):
        experiment.require_measurement_months_semantically_available(
            ("TESTUSDT|2025-07|DAILY_CLOSE_BOUNDARY_INVALID",),
            measurement_start=date(2025, 7, 1),
        )


def test_full_family_evaluation_discloses_all_36_trials() -> None:
    frozen = protocol()
    statistics_config = frozen["statistics"]
    assert isinstance(statistics_config, dict)
    bootstrap_config = statistics_config["bootstrap"]
    assert isinstance(bootstrap_config, dict)
    bootstrap_config["replicates"] = 16
    bars = synthetic_bars()
    pivot = date(2025, 3, 1) + timedelta(days=95)
    records, metrics, pbo = experiment.evaluate_family(
        protocol=frozen,
        bars=bars,
        start=pivot + timedelta(days=2),
        end=pivot + timedelta(days=162),
    )
    assert len(records) == 36
    assert len(metrics) == 36
    assert len({str(record["trialId"]) for record in records}) == 36
    assert pbo["splitCount"] == 70


def test_holm_is_step_down_and_family_wide() -> None:
    values = {"a": 0.001, "b": 0.01, "c": 0.5}
    adjusted = experiment.holm_adjusted(values, 0.05)
    assert adjusted["a"]["rejectAtFamilyWiseAlpha"] is True
    assert adjusted["c"]["rejectAtFamilyWiseAlpha"] is False
    assert float(str(adjusted["b"]["adjustedPValue"])) >= values["b"]


def write_archive(path: Path, *, milliseconds: bool = False) -> str:
    opened = datetime(2025, 7, 1, tzinfo=UTC)
    timestamp = int(opened.timestamp() * (1_000 if milliseconds else 1_000_000))
    day = 86_400_000 if milliseconds else experiment.DAY_US
    row = [
        str(timestamp),
        "100",
        "101",
        "99",
        "100.5",
        "10",
        str(timestamp + day - 1),
        "10000000",
        "100",
        "5",
        "5000000",
        "0",
    ]
    member = "TESTUSDT-1d-2025-07.csv"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, ",".join(row) + "\n")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_archive_parser_enforces_microseconds_and_member_contract(tmp_path: Path) -> None:
    valid = tmp_path / "TESTUSDT-1d-2025-07.zip"
    digest = write_archive(valid)
    bars = experiment.parse_archive(
        valid,
        symbol="TESTUSDT",
        month="2025-07",
        expected_sha=digest,
    )
    assert len(bars) == 1
    assert bars[0].day == date(2025, 7, 1)

    invalid = tmp_path / "invalid.zip"
    invalid_digest = write_archive(invalid, milliseconds=True)
    with pytest.raises(experiment.EvidenceError, match="MICROSECONDS"):
        experiment.parse_archive(
            invalid,
            symbol="TESTUSDT",
            month="2025-07",
            expected_sha=invalid_digest,
        )


def test_sidecar_requires_exact_publisher_filename_and_digest() -> None:
    digest = "a" * 64
    assert (
        experiment.parse_sidecar(
            f"{digest}  TESTUSDT-1d-2025-07.zip\n".encode(),
            "TESTUSDT-1d-2025-07.zip",
        )
        == digest
    )
    with pytest.raises(experiment.EvidenceError):
        experiment.parse_sidecar(
            f"{digest}  OTHER.zip\n".encode(),
            "TESTUSDT-1d-2025-07.zip",
        )


def test_path_guard_refuses_escape(tmp_path: Path) -> None:
    with pytest.raises(experiment.EvidenceError, match="outside"):
        experiment.guarded_output(tmp_path / "escape.json")


def test_required_cost_gate_cannot_be_rescued_by_diagnostic_cell() -> None:
    base = experiment.RunMetrics(
        signal_events=100,
        clustered_events=100,
        executable_opportunities=100,
        suppressed_partition_boundary=0,
        rejected_portfolio_conflict=0,
        round_trips=40,
        fills=80,
        distinct_symbols=tuple(f"S{index}" for index in range(10)),
        active_weeks=20,
        active_months=8,
        start_usd=1_000,
        end_usd=1_010,
        net_per_initial_1000_usd=10,
        max_daily_close_marked_drawdown_pct=5,
        supported_initial_capital_min_usdt=1_500,
        supported_initial_capital_p05_usdt=2_000,
        supported_initial_capital_median_usdt=3_000,
        daily_returns=(0.001,) * 100,
    )
    failed = replace(base, end_usd=990, net_per_initial_1000_usd=-10)
    gates = experiment.development_gate_status(
        metrics=failed,
        bootstrap={"oneSidedLower05NetPer1000Usd": "1"},
        holm={"rejectAtFamilyWiseAlpha": True},
        scenario_metrics={
            "BASE": base,
            "STRESS": base,
            "FEE_STRESS": failed,
            "SEVERE_DIAGNOSTIC": base,
        },
    )
    assert gates["requiredCostScenariosPositive"] is False
    assert experiment.all_passed(gates) is False


def install_synthetic_run_boundary(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> dict[str, Path]:
    names = {
        "DEVELOPMENT_MARKER_PATH": "development-run-marker.v1.json",
        "CANDIDATE_SEAL_PATH": "candidate-seal.v1.json",
        "HOLDOUT_MARKER_PATH": "holdout-open-marker.v1.json",
        "RESULT_PATH": "result.v1.json",
        "VERDICT_PATH": "VERDICT.md",
        "ROW_PATH": "PROPOSED_RUN_SECTION5_ROW.md",
        "CHECKSUMS_PATH": "SHA256SUMS",
    }
    paths = {name: tmp_path / filename for name, filename in names.items()}
    for name, path in paths.items():
        monkeypatch.setattr(experiment, name, path)

    def local_exclusive_write(path: Path, raw: bytes) -> None:
        if path.exists():
            raise experiment.EvidenceError(f"exclusive output already exists: {path.name}")
        path.write_bytes(raw)

    frozen_protocol = protocol()
    monkeypatch.setattr(experiment, "exclusive_write", local_exclusive_write)
    monkeypatch.setattr(experiment, "assert_git_scope", lambda *, require_clean: None)
    monkeypatch.setattr(
        experiment,
        "load_protocol",
        lambda: (frozen_protocol, "p" * 64),
    )
    monkeypatch.setattr(experiment, "load_freeze", lambda: ({}, "f" * 64))
    monkeypatch.setattr(
        experiment,
        "load_source_manifest",
        lambda: ({"stateRoot": str(tmp_path)}, "s" * 64),
    )
    monkeypatch.setattr(experiment, "git_head", lambda: "1" * 40)
    monkeypatch.setattr(
        experiment,
        "seal_outputs",
        lambda **_arguments: None,
    )
    return paths


def synthetic_family_record(*, eligible: bool) -> dict[str, object]:
    metrics = {
        "activeMonthCount": 8,
        "activeWeekCount": 24,
        "capacityProxy": {
            "supportedInitialCapitalMedianUsdt": "5000",
            "supportedInitialCapitalMinUsdt": "2000",
            "supportedInitialCapitalP05Usdt": "2500",
            "verifiedExecutableCapacity": "UNMEASURED",
        },
        "distinctSymbolCount": 10,
        "distinctSymbols": [f"S{index}" for index in range(10)],
        "endUsd": "1010",
        "fills": 120,
        "maxDailyCloseMarkedDrawdownPct": "5",
        "netPerInitial1000Usd": "10",
        "selectedRoundTrips": 60,
        "signalEvents": 100,
        "startUsd": "1000",
    }
    scenarios = {
        name: {"metrics": metrics}
        for name in (
            "PUBLIC_FEE_ONLY",
            "BASE",
            "STRESS",
            "FEE_STRESS",
            "SEVERE_DIAGNOSTIC",
        )
    }
    return {
        "bootstrap": {
            "confidenceIntervalNetPer1000Usd": {
                "lower95": "1",
                "upper95": "20",
            }
        },
        "developmentEligible": eligible,
        "gates": {"synthetic": eligible},
        "holm": {"rejectAtFamilyWiseAlpha": eligible},
        "scenarios": scenarios,
        "trialId": "V02_R03_W25_H03",
    }


def test_development_marker_precedes_first_archive_parse_and_rerun_is_refused(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    paths = install_synthetic_run_boundary(monkeypatch, tmp_path)

    def fail_after_marker(
        _state_root: Path,
        _manifest: object,
        _months: object,
    ) -> tuple[dict[str, dict[date, experiment.Bar]], tuple[str, ...]]:
        assert paths["DEVELOPMENT_MARKER_PATH"].exists()
        raise experiment.EvidenceError("SYNTHETIC_FIRST_PARSE_FAILURE")

    monkeypatch.setattr(experiment, "load_bars", fail_after_marker)
    result = experiment.run(tmp_path)
    assert result["verdict"] == "UNMEASURED"
    assert str(result["reason"]).startswith("DEVELOPMENT_EVIDENCEERROR")
    assert not paths["HOLDOUT_MARKER_PATH"].exists()
    with pytest.raises(experiment.EvidenceError, match="rerun refused"):
        experiment.run(tmp_path)


def test_no_eligible_development_keeps_holdout_unopened(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    paths = install_synthetic_run_boundary(monkeypatch, tmp_path)
    record = synthetic_family_record(eligible=False)
    monkeypatch.setattr(experiment, "load_bars", lambda *_args: ({}, ()))
    monkeypatch.setattr(
        experiment,
        "evaluate_family",
        lambda **_arguments: ([record], {}, {"pbo": "0.5"}),
    )
    result = experiment.run(tmp_path)
    assert result["verdict"] == "NO_GO"
    assert experiment.nested(result, "holdout", "state") == "SEALED_UNOPENED"
    assert not paths["CANDIDATE_SEAL_PATH"].exists()
    assert not paths["HOLDOUT_MARKER_PATH"].exists()


def test_candidate_seal_and_holdout_marker_precede_holdout_parse_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    paths = install_synthetic_run_boundary(monkeypatch, tmp_path)
    record = synthetic_family_record(eligible=True)
    calls = 0

    def staged_load(
        _state_root: Path,
        _manifest: object,
        _months: object,
    ) -> tuple[dict[str, dict[date, experiment.Bar]], tuple[str, ...]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            return {}, ()
        assert paths["CANDIDATE_SEAL_PATH"].exists()
        assert paths["HOLDOUT_MARKER_PATH"].exists()
        raise experiment.EvidenceError("SYNTHETIC_HOLDOUT_PARSE_FAILURE")

    monkeypatch.setattr(experiment, "load_bars", staged_load)
    monkeypatch.setattr(
        experiment,
        "evaluate_family",
        lambda **_arguments: ([record], {}, {"pbo": "0.5"}),
    )
    result = experiment.run(tmp_path)
    assert result["verdict"] == "UNMEASURED"
    assert experiment.nested(result, "development", "state") == "CONSUMED_VALID"
    assert experiment.nested(result, "holdout", "state") == "CONSUMED_INVALID"
    assert str(result["reason"]).startswith("HOLDOUT_EVIDENCEERROR")
