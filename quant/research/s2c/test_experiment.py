from __future__ import annotations

import json
import math
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from research.s2c import experiment as exp


def write_zip(path: Path, member: str, text: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, text)


def test_protocol_freezes_second_moment_direction() -> None:
    protocol = exp.load_json(exp.PROTOCOL_PATH)
    assert protocol["family"]["direction"] == (
        "LONG_LOW_RESIDUAL_VOLATILITY_SHORT_HIGH_RESIDUAL_VOLATILITY"
    )
    forbidden = set(protocol["family"]["forbiddenInputs"])
    assert {"RESIDUAL_SIGN", "RESIDUAL_MOMENTUM", "REVERSAL", "FUNDING_RANK"} <= forbidden
    assert protocol["authority"]["executionAuthority"] == "NONE"
    assert protocol["authority"]["capitalAuthority"] == "NONE"


def test_planned_artifact_count_and_paths() -> None:
    rows = exp.planned_artifacts()
    assert len(rows) == 16 * (14 + 12 + 12)
    assert len(set(rows)) == len(rows)
    assert (
        exp.archive_relative("markPriceKlines", "BTCUSDT", "2026-06")
        == "markPriceKlines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip"
    )


def test_month_range_is_inclusive() -> None:
    assert exp.month_range("2025-11", "2026-02") == [
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    ]


def test_parse_kline_zip_accepts_exact_hourly_rows(tmp_path: Path) -> None:
    path = tmp_path / "BTCUSDT-1h-2026-01.zip"
    start = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
    rows = []
    for index in range(3):
        timestamp = start + index * exp.HOUR_MS
        rows.append(
            ",".join(
                [
                    str(timestamp),
                    "100",
                    "101",
                    "99",
                    "100.5",
                    "1",
                    str(timestamp + exp.HOUR_MS - 1),
                    "1000",
                    "2",
                    "0.5",
                    "500",
                    "0",
                ]
            )
        )
    write_zip(path, "BTCUSDT-1h-2026-01.csv", "\n".join(rows) + "\n")
    parsed = exp.parse_kline_zip(path)
    assert len(parsed) == 3
    assert parsed[1].open_time_ms == start + exp.HOUR_MS
    assert parsed[1].quote_volume == 1000


def test_parse_kline_zip_rejects_duplicate_timestamp(tmp_path: Path) -> None:
    path = tmp_path / "bad.zip"
    timestamp = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
    row = f"{timestamp},100,101,99,100,1,{timestamp + exp.HOUR_MS - 1},1000,2,1,1,0"
    write_zip(path, "bad.csv", f"{row}\n{row}\n")
    with pytest.raises(exp.ExperimentError, match="KLINE_TIMESTAMP_INVALID"):
        exp.parse_kline_zip(path)


def test_parse_funding_zip_requires_exact_schema(tmp_path: Path) -> None:
    good = tmp_path / "good.zip"
    timestamp = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
    write_zip(
        good,
        "funding.csv",
        f"calc_time,funding_interval_hours,last_funding_rate\n{timestamp},8,0.0001\n",
    )
    assert exp.parse_funding_zip(good) == [exp.Funding(timestamp, 8, 0.0001)]
    bad = tmp_path / "bad.zip"
    write_zip(bad, "funding.csv", f"time,rate\n{timestamp},0.0001\n")
    with pytest.raises(exp.ExperimentError, match="FUNDING_HEADER_INVALID"):
        exp.parse_funding_zip(bad)


def test_funding_window_requires_complete_declared_cadence() -> None:
    start = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
    complete = [
        exp.Funding(start + offset * exp.HOUR_MS, 8, 0.0001)
        for offset in (0, 8, 16, 24, 32)
    ]
    events = exp.funding_events_for_window(
        "BTCUSDT",
        complete,
        start + exp.HOUR_MS,
        start + 25 * exp.HOUR_MS,
    )
    assert [item.time_ms for item in events] == [
        start + 8 * exp.HOUR_MS,
        start + 16 * exp.HOUR_MS,
        start + 24 * exp.HOUR_MS,
    ]
    missing = [complete[0], *complete[2:]]
    with pytest.raises(exp.ExperimentError, match="FUNDING_COVERAGE_GAP"):
        exp.funding_events_for_window(
            "BTCUSDT",
            missing,
            start + exp.HOUR_MS,
            start + 25 * exp.HOUR_MS,
        )


def test_daily_maps_requires_complete_24_hour_day() -> None:
    start = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1000)
    complete = {
        start + index * exp.HOUR_MS: exp.HourBar(
            start + index * exp.HOUR_MS,
            100 + index,
            101 + index,
            1000,
        )
        for index in range(24)
    }
    closes, volumes = exp.daily_maps(complete)
    assert closes[date(2026, 1, 1)] == 124
    assert volumes[date(2026, 1, 1)] == 24_000
    complete.pop(start + 5 * exp.HOUR_MS)
    assert exp.daily_maps(complete) == ({}, {})


def synthetic_closes() -> dict[str, dict[date, float]]:
    symbols = ["BTCUSDT", "ETHUSDT", "LOW", "HIGH"]
    output: dict[str, dict[date, float]] = {symbol: {} for symbol in symbols}
    prices = dict.fromkeys(symbols, 100.0)
    start = date(2025, 1, 1)
    for index in range(90):
        day = start + timedelta(days=index)
        market_return = 0.002 * math.sin(index / 5) + 0.0003
        btc_return = market_return + 0.0001 * math.sin(index)
        eth_return = market_return - 0.0001 * math.sin(index)
        low_return = market_return + 0.0002 * math.cos(index * 1.7)
        high_return = market_return + 0.01 * math.cos(index * 1.7)
        for symbol, value in (
            ("BTCUSDT", btc_return),
            ("ETHUSDT", eth_return),
            ("LOW", low_return),
            ("HIGH", high_return),
        ):
            prices[symbol] *= math.exp(value)
            output[symbol][day] = prices[symbol]
    return output


def test_model_point_ranks_residual_volatility_not_sign() -> None:
    closes = synthetic_closes()
    formation = date(2025, 4, 1)
    low = exp.model_point("LOW", formation, 63, closes)
    high = exp.model_point("HIGH", formation, 63, closes)
    assert low is not None
    assert high is not None
    assert low.residual_volatility < high.residual_volatility
    assert abs(low.beta - 1) < 0.2
    assert abs(high.beta - 1) < 1


def test_model_point_rejects_nonconsecutive_window() -> None:
    closes = synthetic_closes()
    del closes["HIGH"][date(2025, 3, 10)]
    assert exp.model_point("HIGH", date(2025, 4, 1), 63, closes) is None


def test_formation_schedule_has_one_hour_lag_and_no_cross_boundary() -> None:
    start = exp.utc_ms("2025-07-01T00:00:00Z")
    end = exp.utc_ms("2025-08-01T00:00:00Z")
    values = exp.formation_times(start, end)
    assert datetime.fromtimestamp(values[0] / 1000, UTC).weekday() == 0
    assert datetime.fromtimestamp(values[0] / 1000, UTC).hour == 0
    assert values[-1] + 7 * exp.DAY_MS + exp.HOUR_MS < end


def test_bootstrap_is_seeded_and_reports_interval() -> None:
    first = exp.bootstrap_statistics([1.0, -0.5, 2.0, 0.25, 1.5], 77)
    second = exp.bootstrap_statistics([1.0, -0.5, 2.0, 0.25, 1.5], 77)
    assert first == second
    assert first["point"] == 4.25
    assert first["lower95"] <= first["point"] <= first["upper95"]
    assert 0 < first["oneSidedCenteredP"] <= 1


def test_holm_adjustment_is_monotone() -> None:
    adjusted = exp.holm_adjust({"A": 0.01, "B": 0.02, "C": 0.5})
    assert adjusted["A"] == pytest.approx(0.03)
    assert adjusted["B"] >= adjusted["A"]
    assert adjusted["C"] >= adjusted["B"]


def test_maximum_drawdown_uses_fixed_1000_capital() -> None:
    assert exp.maximum_drawdown_pct([100, -50, -100, 25]) == pytest.approx(15)


def formation(identifier: str, month: int, value: float) -> exp.FormationResult:
    timestamp = int(datetime(2025, month, 10, 1, tzinfo=UTC).timestamp() * 1000)
    return exp.FormationResult(
        trial_id=identifier,
        formation_time_ms=timestamp - exp.HOUR_MS,
        entry_time_ms=timestamp,
        exit_time_ms=timestamp + 7 * exp.DAY_MS,
        valid=True,
        reason=None,
        low_symbols=("ADAUSDT", "SOLUSDT"),
        high_symbols=("DOGEUSDT", "XRPUSDT"),
        factor_hedge_usd=0,
        factor_exposure_after_hedge_usd=0,
        gross_price_pnl_usd=value,
        funding_pnl_usd=0,
        scenario_net_usd={
            "gross": value,
            "base": value,
            "stress": value,
            "severe": value,
        },
        scenario_cost_usd={"gross": 0, "base": 0, "stress": 0, "severe": 0},
        public_capacity_usd=20_000,
    )


def test_cscv_pbo_uses_all_70_symmetric_splits() -> None:
    trials: dict[str, list[exp.FormationResult]] = {}
    for trial_index in range(6):
        identifier = f"T{trial_index}"
        trials[identifier] = [
            formation(
                identifier,
                month if month <= 12 else month - 12,
                float((trial_index + 1) * ((month % 3) - 1)),
            )
            for month in range(7, 15)
        ]
        for index, item in enumerate(trials[identifier]):
            if index >= 6:
                replacement = datetime(2026, index - 5, 10, 1, tzinfo=UTC)
                trials[identifier][index] = exp.FormationResult(
                    **{**item.__dict__, "entry_time_ms": int(replacement.timestamp() * 1000)}
                )
    result = exp.pbo(trials)
    assert result["splits"] == 70
    assert 0 <= result["probability"] <= 1


def test_development_gate_fails_unknown_capacity() -> None:
    summary = {
        "validFormations": 40,
        "distinctTradeSymbols": 14,
        "scenarios": {
            "stress": {
                "positiveMonths": 8,
                "netUsdPer1000": 10,
                "interval95UsdPer1000": [1, 20],
                "maximumDrawdownPct": 2,
            }
        },
        "publicCapacityProxyUsd": {"p05": None},
    }
    rows = exp.development_gate_rows(summary, 0.01, 0.01, 0.1)
    assert not rows["publicCapacityP05AtLeast10000"]
    assert not all(rows.values())


def test_result_protocol_keeps_public_fee_separate_from_account_truth() -> None:
    protocol = exp.load_json(exp.PROTOCOL_PATH)
    sources = exp.load_json(exp.SOURCES_PATH)
    assert protocol["costs"]["accountEffectiveFee"] == "UNKNOWN"
    assert sources["feeTruth"]["publicBaseFeeBpPerFill"] == 5
    assert sources["feeTruth"]["accountEffectiveFee"] == "UNKNOWN"


def test_static_json_files_are_valid_objects() -> None:
    for path in (exp.PROTOCOL_PATH, exp.SOURCES_PATH, exp.SOURCE_PLAN_PATH):
        assert isinstance(json.loads(path.read_text(encoding="utf-8")), dict)
