"""Deterministic synthetic tests for the frozen V-G22 evaluator."""

from __future__ import annotations

import importlib.util
import math
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import pytest


def load_subject() -> ModuleType:
    path = Path(__file__).with_name("experiment.py")
    spec = importlib.util.spec_from_file_location("vg22_experiment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load V-G22 evaluator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


vg22 = cast(Any, load_subject())


def trial(*, lookback: int = 20, min_gap: int = 1, hold_days: int = 1) -> Any:
    return vg22.Trial(
        f"VG22-L{lookback:02d}-G{min_gap}-H{hold_days}",
        lookback,
        min_gap,
        hold_days,
    )


def bar(
    day: date,
    *,
    open_price: str = "100",
    close: str = "100",
    quote_volume: str = "10000000",
) -> Any:
    return vg22.Bar(
        day=day,
        open=Decimal(open_price),
        high=max(Decimal(open_price), Decimal(close)) + Decimal("1"),
        low=min(Decimal(open_price), Decimal(close)) - Decimal("1"),
        close=Decimal(close),
        quote_volume=Decimal(quote_volume),
    )


def make_market(
    *,
    signal_day: date = date(2025, 6, 30),
    risk_count: int = 25,
    candidate_count: int = 7,
    entry_open: str = "100",
    entry_close: str = "100",
    exit_open: str = "110",
) -> dict[str, dict[date, Any]]:
    """Build a 30-day-eligible market with deterministic adjacent regime gaps."""

    candidate_volumes = (
        "30000000",
        "30000000",
        "29000000",
        "29000000",
        "28000000",
        "27000000",
        "26000000",
    )
    candidate_closes = ("101", "102", "101", "101", "101", "101", "101")
    market: dict[str, dict[date, Any]] = {}
    start = signal_day - timedelta(days=35)
    end = signal_day + timedelta(days=3)
    for index in range(risk_count):
        symbol = f"T{index:02d}USDT"
        series: dict[date, Any] = {}
        current = start
        while current <= end:
            series[current] = bar(current)
            current += timedelta(days=1)
        if index < candidate_count:
            series[signal_day] = bar(
                signal_day,
                close=candidate_closes[index],
                quote_volume=candidate_volumes[index],
            )
        entry_day = signal_day + timedelta(days=1)
        exit_day = signal_day + timedelta(days=2)
        series[entry_day] = bar(
            entry_day,
            open_price=entry_open,
            close=entry_close,
        )
        series[exit_day] = bar(exit_day, open_price=exit_open, close=exit_open)
        market[symbol] = series
    return market


def patch_packet(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    protocol_value = vg22.load_json(vg22.PROTOCOL_PATH)
    protocol_value["data"]["sourceRoot"] = str(tmp_path.resolve())
    paths = {
        "PROTOCOL_PATH": "protocol.v1.json",
        "SOURCE_MANIFEST_PATH": "source_manifest.v1.json",
        "FREEZE_PATH": "freeze.v1.json",
        "DEVELOPMENT_OPEN_PATH": "development-open.v1.json",
        "HOLDOUT_OPEN_PATH": "holdout-open.v1.json",
        "RUN_MARKER_PATH": "run-marker.v1.json",
        "DEVELOPMENT_PATH": "development.v1.json",
        "SELECTION_PATH": "selection.v1.json",
        "RESULT_PATH": "result.v1.json",
        "SHA256SUMS_PATH": "SHA256SUMS",
    }
    monkeypatch.setattr(vg22, "PACKET", tmp_path)
    for name, filename in paths.items():
        monkeypatch.setattr(vg22, name, tmp_path / filename)
    monkeypatch.setattr(vg22, "EXPECTED_SOURCE_ROOT", str(tmp_path.resolve()))
    for filename in (
        "source_manifest.v1.json",
        "OFFICIAL_SOURCE_RESEARCH.md",
        "official_sources.v1.json",
        "README.md",
        "test_experiment.py",
    ):
        (tmp_path / filename).write_text(f"synthetic {filename}\n", encoding="utf-8")
    (tmp_path / "protocol.v1.json").write_bytes(vg22.canonical_bytes(protocol_value))


def freeze_packet(tmp_path: Path) -> dict[str, Any]:
    return cast(dict[str, Any], vg22.freeze_command(tmp_path, "b" * 40))


def write_exact_sha256s() -> None:
    paths = sorted(
        path
        for path in vg22.PACKET.rglob("*")
        if path.is_file()
        and path != vg22.SHA256SUMS_PATH
        and "__pycache__" not in path.relative_to(vg22.PACKET).parts
    )
    lines = [
        f"{vg22.sha256_file(path)}  {path.relative_to(vg22.PACKET).as_posix()}" for path in paths
    ]
    vg22.SHA256SUMS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_trial_family_is_exactly_twelve_and_stable() -> None:
    family = vg22.trials()
    assert len(family) == 12
    assert len({item.trial_id for item in family}) == 12
    assert {item.lookback for item in family} == {20, 40, 60}
    assert {item.min_gap for item in family} == {1, 2}
    assert {item.hold_days for item in family} == {1, 3}


def test_empirical_terciles_use_frozen_lower_boundaries() -> None:
    values = [Decimal(value) for value in ("1", "2", "3", "4", "5", "6")]
    assert vg22.empirical_tercile(values, 1) == Decimal("2")
    assert vg22.empirical_tercile(values, 2) == Decimal("4")

    current = date(2025, 2, 1)
    history = vg22.previous_days(current, 6)
    for volume, expected in (("2", 0), ("4", 1), ("4.0001", 2)):
        series = {
            day: bar(day, quote_volume=str(index)) for index, day in enumerate(history, start=1)
        }
        series[current] = bar(current, quote_volume=volume)
        assert vg22.quote_volume_regime(series, current, 6) == expected


def test_each_adjacent_regime_is_strictly_prior_only_and_ignores_future() -> None:
    signal_day = date(2025, 3, 1)
    previous_day = signal_day - timedelta(days=1)
    series = {
        day: bar(day, quote_volume=volume)
        for day, volume in zip(
            vg22.previous_days(previous_day, 6),
            ("1", "2", "3", "4", "100", "101"),
            strict=True,
        )
    }
    series[previous_day] = bar(previous_day, quote_volume="5")
    series[signal_day] = bar(signal_day, quote_volume="5")
    series[signal_day + timedelta(days=1)] = bar(
        signal_day + timedelta(days=1),
        quote_volume="6",
    )

    previous_before = vg22.quote_volume_regime(series, previous_day, 6)
    current_before = vg22.quote_volume_regime(series, signal_day, 6)
    assert previous_before == 2
    assert current_before == 1

    series[signal_day] = bar(signal_day, quote_volume="5000000")
    series[signal_day + timedelta(days=1)] = bar(
        signal_day + timedelta(days=1),
        quote_volume="999999999999",
    )
    assert vg22.quote_volume_regime(series, previous_day, 6) == previous_before
    series[signal_day] = bar(signal_day, quote_volume="5")
    assert vg22.quote_volume_regime(series, signal_day, 6) == current_before


def test_adjacent_gap_direction_and_rank_are_deterministic() -> None:
    signal_day = date(2025, 6, 30)
    market = make_market(signal_day=signal_day)
    previous_day = signal_day - timedelta(days=1)
    market["T05USDT"][previous_day] = bar(previous_day, quote_volume="30000000")
    market["T06USDT"][signal_day] = bar(
        signal_day,
        close="99",
        quote_volume="31000000",
    )

    selected, risk_count = vg22.select_assets(market, signal_day, trial())

    assert risk_count == 25
    assert [item.symbol for item in selected] == [
        "T01USDT",
        "T00USDT",
        "T02USDT",
        "T03USDT",
        "T04USDT",
    ]
    assert all(item.regime_gap >= 1 and item.close_ratio > Decimal("1") for item in selected)
    assert all(
        isinstance(item.quote_volume_ratio, Decimal) and isinstance(item.close_ratio, Decimal)
        for item in selected
    )
    assert "T05USDT" not in {item.symbol for item in selected}
    assert "T06USDT" not in {item.symbol for item in selected}


@pytest.mark.parametrize(
    ("risk_count", "candidate_count", "expected_risk"),
    [(19, 7, 19), (25, 2, 25)],
)
def test_minimum_risk_and_cohort_gates_fall_back_to_cash(
    risk_count: int,
    candidate_count: int,
    expected_risk: int,
) -> None:
    signal_day = date(2025, 6, 30)
    selected, observed_risk = vg22.select_assets(
        make_market(
            signal_day=signal_day,
            risk_count=risk_count,
            candidate_count=candidate_count,
        ),
        signal_day,
        trial(),
    )
    assert observed_risk == expected_risk
    assert selected == []


@pytest.mark.parametrize("invalid_kind", ["missing", "nonpositive"])
def test_missing_or_invalid_history_is_ineligible_and_stays_cash(
    invalid_kind: str,
) -> None:
    signal_day = date(2025, 6, 30)
    market = make_market(signal_day=signal_day)
    for series in market.values():
        if invalid_kind == "missing":
            del series[signal_day - timedelta(days=7)]
        else:
            series[signal_day] = bar(signal_day, quote_volume="0")

    selected, risk_count = vg22.select_assets(market, signal_day, trial())
    assert selected == []
    assert risk_count == 0

    simulation = vg22.simulate(
        market,
        trial(),
        signal_day + timedelta(days=1),
        signal_day + timedelta(days=2),
        vg22.BASE_ADVERSE,
        "BASE",
    )
    assert simulation.final_nav == Decimal("1000")
    assert simulation.round_trips == 0
    assert simulation.capacity_proxy_nominal_usdt is None
    assert vg22.simulation_mapping(simulation, include_series=False)["entryCoverage"] is None


@pytest.mark.parametrize("same_value", [True, False])
def test_duplicate_full_bar_is_unmeasured_without_deduplication(
    monkeypatch: pytest.MonkeyPatch,
    same_value: bool,
) -> None:
    duplicate_day = date(2025, 7, 1)
    first = bar(duplicate_day, close="100")
    second = first if same_value else bar(duplicate_day, close="101")
    records = (
        {"month": "2025-07", "symbol": "BTCUSDT", "source": "first"},
        {"month": "2025-07", "symbol": "BTCUSDT", "source": "second"},
    )
    monkeypatch.setattr(vg22, "manifest_records", lambda _months: records)
    monkeypatch.setattr(
        vg22,
        "parse_archive",
        lambda record: (
            [first if record["source"] == "first" else second],
            {"month": "2025-07", "symbol": "BTCUSDT"},
        ),
    )

    with pytest.raises(vg22.MeasurementError, match="duplicate full bar"):
        vg22.load_bars({"2025-07"})


def test_raw_duplicate_is_detected_before_invalid_row_skip(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    symbol = "BTCUSDT"
    month = "2025-07"
    archive_name = f"{symbol}-1d-{month}.zip"
    archive_path = tmp_path / archive_name
    archive_raw = b"synthetic archive envelope"
    archive_path.write_bytes(archive_raw)
    day = date(2025, 7, 1)
    open_us = (day - date(1970, 1, 1)).days * vg22.DAY_US
    close_us = open_us + vg22.DAY_US - 1
    invalid_row = f"{open_us},100,101,99,100,1,{close_us},0,10,0.5,500,0\n"
    raw_csv = (invalid_row + invalid_row).encode()

    class SyntheticMember:
        filename = f"{symbol}-1d-{month}.csv"

        def is_dir(self) -> bool:
            return False

    class SyntheticArchive:
        def __enter__(self) -> SyntheticArchive:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def infolist(self) -> list[SyntheticMember]:
            return [SyntheticMember()]

        def read(self, _member: SyntheticMember) -> bytes:
            return raw_csv

    monkeypatch.setattr(vg22.zipfile, "ZipFile", lambda *_args, **_kwargs: SyntheticArchive())
    record = {
        "month": month,
        "symbol": symbol,
        "zipBytes": len(archive_raw),
        "zipPath": str(archive_path),
        "zipSha256": vg22.sha256_bytes(archive_raw),
    }

    with pytest.raises(vg22.MeasurementError, match="duplicate or unsorted raw open time"):
        vg22.parse_archive(record)


@pytest.mark.parametrize("adverse", [Decimal("0.001"), Decimal("0.0025")])
def test_fee_and_adverse_cost_identity(adverse: Decimal) -> None:
    allocation = Decimal("1000")
    raw_entry = Decimal("100")
    raw_exit = Decimal("110")
    quantity = allocation * (Decimal("1") - vg22.FEE_RATE) / (raw_entry * (Decimal("1") + adverse))
    position = vg22.Position(
        symbol="BTCUSDT",
        allocation=allocation,
        quantity=quantity,
        raw_entry=raw_entry,
        adverse_entry=raw_entry * (Decimal("1") + adverse),
        exit_day=date(2025, 7, 2),
        prior_adv=Decimal("10000000"),
    )

    accounting = vg22.trade_accounting(position, raw_exit, adverse)
    expected_final = (
        allocation
        * (Decimal("1") - Decimal("0.001"))
        / (Decimal("1") + adverse)
        * (raw_exit / raw_entry)
        * (Decimal("1") - adverse)
        * (Decimal("1") - Decimal("0.001"))
    )
    assert accounting.net_pnl == expected_final - allocation
    assert accounting.gross_pnl == Decimal("100")
    assert (
        accounting.gross_pnl
        - accounting.entry_fee_cost
        - accounting.exit_fee_cost
        - accounting.adverse_execution_cost
        == accounting.net_pnl
    )


def test_signal_day_enters_only_at_next_open_and_reports_capacity_truth() -> None:
    signal_day = date(2025, 6, 30)
    simulation = vg22.simulate(
        make_market(signal_day=signal_day, entry_open="100", exit_open="110"),
        trial(),
        signal_day + timedelta(days=1),
        signal_day + timedelta(days=2),
        vg22.BASE_ADVERSE,
        "BASE",
    )
    assert simulation.round_trips == 5
    assert simulation.selected_allocations == 5
    assert simulation.gross_pnl == Decimal("100")

    result = vg22.simulation_mapping(simulation, include_series=True)
    assert result["publicFeeScenarioPerSideBps"] == 10
    assert result["adverseExecutionScenarioPerSideBps"] == 10
    assert result["allInPublicScenarioPerSideBps"] == 20
    assert result["capacityProxyLabel"] == ("PRIOR_30D_QUOTE_VOLUME_ONE_BP_PARTICIPATION_PROXY")
    assert result["capacityProxyNominalUsdt"] == "5000.00"
    assert result["executableCapacity"] == "UNMEASURED"
    assert result["orderBookDataUsed"] is False
    assert result["orderBookInference"] == "NONE"


def test_maximum_drawdown_is_computed_from_daily_nav() -> None:
    signal_day = date(2025, 6, 30)
    simulation = vg22.simulate(
        make_market(
            signal_day=signal_day,
            entry_open="100",
            entry_close="120",
            exit_open="90",
        ),
        trial(),
        signal_day + timedelta(days=1),
        signal_day + timedelta(days=2),
        vg22.BASE_ADVERSE,
        "BASE",
    )
    peak = Decimal("1000")
    expected = Decimal("0")
    for _, nav in simulation.daily_nav:
        peak = max(peak, nav)
        expected = max(expected, (peak - nav) / peak)
    assert expected > Decimal("0")
    assert simulation.max_drawdown == expected


def test_pbo_has_eight_blocks_and_seventy_symmetric_splits() -> None:
    matrix = {
        item.trial_id: [math.sin(day + index) / 1000 + index / 100_000 for day in range(80)]
        for index, item in enumerate(vg22.trials())
    }
    report = vg22.pbo_report(matrix)
    repeated = vg22.pbo_report(matrix)
    assert report["status"] == "AVAILABLE"
    assert report["diagnosticOnly"] is True
    assert report["blockCount"] == 8
    assert report["splitCount"] == 70
    assert report["selectionStatistic"] == "COMPOUNDED_NET_USD_PER_1000"
    assert report["distinctCanonicalDailyReturnSeriesCount"] == 12
    assert vg22.SHA256_RE.fullmatch(report["canonicalDailyReturnSeriesSha256"])
    assert (
        report["canonicalDailyReturnSeriesSha256"] == repeated["canonicalDailyReturnSeriesSha256"]
    )


def test_pbo_identical_compounded_net_matrix_is_unavailable() -> None:
    identical = [0.001, -0.0005, 0.0002, 0.0, 0.0004, -0.0001, 0.0003, 0.0002]
    matrix = {item.trial_id: identical for item in vg22.trials()}
    report = vg22.pbo_report(matrix)
    repeated = vg22.pbo_report(matrix)
    assert report["status"] == "UNAVAILABLE"
    assert report["pbo"] is None
    assert report["reason"] == "FEWER_THAN_TWO_DISTINCT_TRIAL_SERIES"
    assert report["distinctCanonicalDailyReturnSeriesCount"] == 1
    assert vg22.SHA256_RE.fullmatch(report["canonicalDailyReturnSeriesSha256"])
    assert (
        report["canonicalDailyReturnSeriesSha256"] == repeated["canonicalDailyReturnSeriesSha256"]
    )


def test_measured_trial_ledger_has_exact_family_statuses_and_metrics() -> None:
    rows: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(vg22.trials()):
        passes = index % 2 == 0
        rows[item.trial_id] = {
            "bootstrap": {
                "oneSidedPValue": "0.0100000000",
                "status": "AVAILABLE",
            },
            "developmentBaseNetUsdPer1000": f"{index + 1}.0000000000",
            "developmentGatePass": passes,
            "developmentStressNetUsdPer1000": f"{index + 0.5:.10f}",
            "gateEvidence": {
                "distinctAssetCount": 30 + index,
                "gates": {
                    "sample": True,
                    "stressNetPositive": passes,
                },
                "roundTripCount": 100 + index,
                "validCohortDayCount": 80 + index,
            },
        }

    ledger = vg22.trial_ledger(rows)
    required = {
        "bootstrapStatus",
        "developmentBaseNetUsdPer1000",
        "developmentStressNetUsdPer1000",
        "distinctAssets",
        "failedGates",
        "pValueOrNull",
        "roundTrips",
        "status",
        "trialId",
        "validCohortDays",
    }
    assert len(ledger) == 12
    assert [row["trialId"] for row in ledger] == [item.trial_id for item in vg22.trials()]
    assert all(required <= set(row) for row in ledger)
    for index, row in enumerate(ledger):
        passes = index % 2 == 0
        assert row["status"] == ("MEASURED_GATE_PASS" if passes else "MEASURED_GATE_FAIL")
        assert row["developmentGatePass"] is passes
        assert row["developmentBaseNetUsdPer1000"] is not None
        assert row["developmentStressNetUsdPer1000"] is not None
        assert row["bootstrapStatus"] == "AVAILABLE"
        assert row["pValueOrNull"] == "0.0100000000"
        assert row["roundTrips"] == 100 + index
        assert row["validCohortDays"] == 80 + index
        assert row["distinctAssets"] == 30 + index
        assert row["failedGates"] == ([] if passes else ["stressNetPositive"])


def test_unmeasured_trial_ledger_has_null_metrics_and_failed_reason() -> None:
    reason = "DEVELOPMENT_MEASUREMENT_ERROR"
    ledger = vg22.trial_ledger(None, unavailable_reason=reason)
    null_fields = (
        "developmentBaseNetUsdPer1000",
        "developmentStressNetUsdPer1000",
        "developmentGatePass",
        "distinctAssets",
        "pValueOrNull",
        "roundTrips",
        "validCohortDays",
    )
    assert len(ledger) == 12
    assert [row["trialId"] for row in ledger] == [item.trial_id for item in vg22.trials()]
    for row in ledger:
        assert row["status"] == "UNMEASURED"
        assert row["bootstrapStatus"] == "UNAVAILABLE"
        assert row["failedGates"] == [reason]
        assert all(row[field] is None for field in null_fields)


def test_preacquired_holdout_warmup_and_outcome_months_are_distinct() -> None:
    proto = vg22.protocol()
    data = proto["data"]
    assert data["holdoutWarmupArchiveMonths"] == ["2026-01", "2026-02"]
    assert data["holdoutArchiveMonths"] == [
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
    ]
    assert set(data["holdoutWarmupArchiveMonths"]).isdisjoint(data["holdoutArchiveMonths"])
    assert proto["holdout"]["compressedArchiveBytesPreAcquired"] is True
    assert proto["holdout"]["compressedArchivesChecksumAuthenticatedBeforeFreeze"] is True
    split = vg22.split_plan_binding(proto)
    expected = proto["lifecycle"]["freezeBindings"]["expectedSplitPlanSha256"]
    assert vg22.sha256_bytes(vg22.canonical_bytes(split)) == expected


def test_freeze_binds_official_sources(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    patch_packet(monkeypatch, tmp_path)
    frozen = freeze_packet(tmp_path)
    verified = vg22.verify_freeze()
    proto = vg22.protocol()
    bindings = proto["lifecycle"]["freezeBindings"]
    assert verified["schema"] == "VG22FreezeV1"
    assert frozen["canonicalParentSha"] == vg22.CANONICAL_PARENT_SHA
    assert frozen["parentCommit"] == vg22.CANONICAL_PARENT_SHA
    assert frozen["preOutcomeCommit"] == "b" * 40
    assert frozen["trialFamilySha256"] == bindings["expectedTrialFamilySha256"]
    assert frozen["splitPlanSha256"] == bindings["expectedSplitPlanSha256"]
    assert frozen["officialSourcesSha256"] == vg22.sha256_file(
        tmp_path / "official_sources.v1.json"
    )

    (tmp_path / "official_sources.v1.json").write_text("tampered\n", encoding="utf-8")
    with pytest.raises(vg22.ContractError, match="freeze mismatch: officialSourcesSha256"):
        vg22.verify_freeze()


def test_write_once_uses_exclusive_creation_and_preserves_first_receipt(
    tmp_path: Path,
) -> None:
    receipt = tmp_path / "receipt.v1.json"
    vg22.write_json_once(receipt, {"openCount": 1})
    original = receipt.read_bytes()
    with pytest.raises(vg22.ContractError, match="refusing to overwrite"):
        vg22.write_json_once(receipt, {"openCount": 2})
    assert receipt.read_bytes() == original
    assert vg22.os.O_EXCL != 0


def test_sha256_inventory_requires_the_exact_sorted_packet_set(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    patch_packet(monkeypatch, tmp_path)
    freeze_packet(tmp_path)
    write_exact_sha256s()
    vg22.verify_sha256s()

    (tmp_path / "undeclared.txt").write_text("not declared\n", encoding="utf-8")
    with pytest.raises(vg22.ContractError, match="SHA256SUMS exact-set mismatch"):
        vg22.verify_sha256s()


def test_development_measurement_failure_consumes_once_and_reports_without_holdout(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    patch_packet(monkeypatch, tmp_path)
    freeze_packet(tmp_path)
    vg22.write_json_once(
        vg22.DEVELOPMENT_OPEN_PATH,
        {
            "developmentOpenCount": 1,
            "freezeSha256": vg22.sha256_file(vg22.FREEZE_PATH),
            "holdoutMaximumOpenCount": 1,
            "holdoutOpenCount": 0,
            "openedAtUtc": "2026-07-29T00:00:00.000Z",
            "schema": "VG22DevelopmentOpenV1",
            "sourceManifestSha256": vg22.sha256_file(vg22.SOURCE_MANIFEST_PATH),
        },
    )

    result = vg22.terminal_development_measurement_failure(
        vg22.MeasurementError("duplicate full bar")
    )
    development = vg22.load_json(vg22.DEVELOPMENT_PATH)
    development_open = vg22.load_json(vg22.DEVELOPMENT_OPEN_PATH)
    marker = vg22.load_json(vg22.RUN_MARKER_PATH)
    assert result["verdict"] == "UNMEASURED"
    assert result["holdoutOpenCount"] == 0
    assert result["lockedTrialId"] is None
    assert result["selectionSha256"] is None
    assert result["base"]["netUsdPer1000"] is None
    assert result["base"]["maximumDrawdown"] is None
    assert result["base"]["capacityProxyNominalUsdt"] is None
    assert result["base"]["executableCapacity"] == "UNMEASURED"
    assert result["pbo"]["pbo"] is None
    assert development["attemptedTrialCount"] == 12
    assert development["completedTrialCount"] == 0
    assert development["frozenTrialCount"] == 12
    assert len(development["trialLedger"]) == 12
    assert development["status"] == "UNMEASURED"
    assert development_open["developmentOpenCount"] == 1
    assert development_open["holdoutOpenCount"] == 0
    assert marker["holdoutOpenCount"] == 0
    assert marker["holdoutOpenSha256"] is None
    assert marker["developmentOpenSha256"] == vg22.sha256_file(vg22.DEVELOPMENT_OPEN_PATH)
    assert marker["state"] == "COMPLETE"
    assert not vg22.SELECTION_PATH.exists()
    assert not vg22.HOLDOUT_OPEN_PATH.exists()

    write_exact_sha256s()
    report = vg22.report_command(tmp_path)
    assert report["authenticatedWithoutRecomputation"] is True
    assert report["verdict"] == "UNMEASURED"
    assert report["holdoutOpenCount"] == 0
    assert report["baseNetUsdPer1000"] is None
    assert report["stressNetUsdPer1000"] is None

    with pytest.raises(vg22.ContractError, match="collided with sealed evidence"):
        vg22.terminal_development_measurement_failure(
            vg22.MeasurementError("second open forbidden")
        )


def test_report_rejects_tampered_terminal_result(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    patch_packet(monkeypatch, tmp_path)
    freeze_packet(tmp_path)
    vg22.write_json_once(
        vg22.DEVELOPMENT_OPEN_PATH,
        {
            "developmentOpenCount": 1,
            "freezeSha256": vg22.sha256_file(vg22.FREEZE_PATH),
            "holdoutMaximumOpenCount": 1,
            "holdoutOpenCount": 0,
            "openedAtUtc": "2026-07-29T00:00:00.000Z",
            "schema": "VG22DevelopmentOpenV1",
            "sourceManifestSha256": vg22.sha256_file(vg22.SOURCE_MANIFEST_PATH),
        },
    )
    vg22.terminal_development_measurement_failure(vg22.MeasurementError("sealed failure"))
    result = vg22.load_json(vg22.RESULT_PATH)
    result["reason"] = "tampered"
    vg22.RESULT_PATH.write_bytes(vg22.canonical_bytes(result))

    with pytest.raises(vg22.ContractError, match="run marker does not bind result"):
        vg22.report_command(tmp_path)
