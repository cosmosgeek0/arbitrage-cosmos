from __future__ import annotations

import csv
import io
import json
import math
import zipfile
from pathlib import Path

import pytest
from research.s2a import experiment as subject


def bar(
    index: int,
    *,
    open_price: float = 100.0,
    close_price: float = 100.0,
    quote_volume: float = 1000.0,
    start_ms: int = 0,
) -> subject.Bar:
    open_ms = start_ms + index * subject.HOUR_MS
    return subject.Bar(
        open_ms=open_ms,
        close_ms=open_ms + subject.HOUR_MS - 1,
        open_price=open_price,
        close_price=close_price,
        quote_volume=quote_volume,
    )


def write_zip(path: Path, member: str, rows: list[list[str]]) -> None:
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerows(rows)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, stream.getvalue())


def test_parse_utc_ms_preserves_large_integer_precision() -> None:
    assert subject.parse_utc_ms("1751328000000000") == 1_751_328_000_000
    assert subject.parse_utc_ms("1751328000000.0") == 1_751_328_000_000


def test_log_returns_are_aligned_to_ending_bar() -> None:
    bars = [
        bar(0, close_price=100.0),
        bar(1, close_price=110.0),
        bar(2, close_price=99.0),
    ]
    values = subject.log_returns(bars)
    assert values[0] is None
    assert values[1] == pytest.approx(math.log(1.1))
    assert values[2] == pytest.approx(math.log(0.9))


def test_ols_residual_z_excludes_signal_hour() -> None:
    factor: list[float | None] = [None, *[value / 1000 for value in range(1, 12)]]
    contract: list[float | None] = [
        None,
        *[
            0.001 + 1.5 * float(value) + (0.0001 if index % 2 else -0.0001)
            for index, value in enumerate(factor[1:10])
        ],
        0.001 + 1.5 * float(factor[10]) + 0.02,
        0.001 + 1.5 * float(factor[11]),
    ]
    fit = subject.ols_residual_z(contract, factor, 10, 8, 1e-12)
    assert fit is not None
    beta, z_score = fit
    assert beta == pytest.approx(1.5, abs=0.02)
    assert z_score > 100


def test_ols_rejects_zero_factor_variance() -> None:
    factor: list[float | None] = [None, *([0.01] * 12)]
    contract: list[float | None] = [None, *([0.02] * 12)]
    assert subject.ols_residual_z(contract, factor, 10, 8, 1e-12) is None


def test_lagged_volume_uses_t_minus_one_and_earlier_baseline() -> None:
    bars = [bar(index, quote_volume=100.0) for index in range(12)]
    bars[9] = bar(9, quote_volume=250.0)
    bars[10] = bar(10, quote_volume=1_000_000.0)
    ratio = subject.lagged_volume_ratio(bars, signal_index=10, baseline_hours=8)
    assert ratio == pytest.approx(2.5)


def test_current_signal_hour_volume_cannot_change_confirmation() -> None:
    first = [bar(index, quote_volume=100.0) for index in range(12)]
    second = list(first)
    second[10] = bar(10, quote_volume=9_999_999.0)
    assert subject.lagged_volume_ratio(first, 10, 8) == subject.lagged_volume_ratio(second, 10, 8)


def test_factor_neutral_weights_have_unit_gross_and_zero_beta() -> None:
    weights = subject.factor_neutral_weights(
        "LONG",
        "SHORT",
        "BTC",
        {"LONG": 1.4, "SHORT": 0.8},
        0.35,
        0.7,
        0.35,
    )
    assert weights is not None
    assert sum(abs(value) for value in weights.values()) == pytest.approx(1.0)
    assert (weights["LONG"] * 1.4 + weights["SHORT"] * 0.8 + weights["BTC"]) == pytest.approx(
        0.0, abs=1e-12
    )


def test_factor_hedge_limit_rejects_extreme_beta_mismatch() -> None:
    weights = subject.factor_neutral_weights(
        "LONG",
        "SHORT",
        "BTC",
        {"LONG": 3.0, "SHORT": 0.1},
        0.1,
        0.7,
        0.35,
    )
    assert weights is None


def test_select_tails_requires_lagged_volume_on_both_sides() -> None:
    snapshot = subject.SignalSnapshot(
        betas={"A": 1.1, "B": 0.9, "C": 1.0},
        z_scores={"A": -2.1, "B": 2.2, "C": 0.0},
        volume_ratios={"A": 1.6, "B": 1.1, "C": 3.0},
    )
    assert subject.select_tails(snapshot, "BTC", 1.5, 1.25, 0.35, 0.7, 0.35) is None


def test_select_tails_rejects_exact_boundary_tie() -> None:
    snapshot = subject.SignalSnapshot(
        betas={"A": 1.1, "B": 1.2, "C": 0.9},
        z_scores={"A": -2.0, "B": -2.0, "C": 2.1},
        volume_ratios={"A": 2.0, "B": 2.0, "C": 2.0},
    )
    assert subject.select_tails(snapshot, "BTC", 1.5, 1.25, 0.35, 0.7, 0.35) is None


def test_cohort_pnl_books_price_funding_and_costs() -> None:
    selection = subject.Selection(
        long_symbol="A",
        short_symbol="B",
        weights={"A": 0.45, "B": -0.45, "BTC": -0.10},
    )
    funding = {
        "A": [subject.Funding(subject.HOUR_MS * 2, 0.001)],
        "B": [subject.Funding(subject.HOUR_MS * 2, 0.001)],
        "BTC": [subject.Funding(subject.HOUR_MS * 2, 0.001)],
    }
    mark_prices = {
        "A": {subject.HOUR_MS * 2: 105.0},
        "B": {subject.HOUR_MS * 2: 95.0},
        "BTC": {subject.HOUR_MS * 2: 100.0},
    }
    scenarios = [
        subject.CostScenario("gross", 0.0, 0.0),
        subject.CostScenario("base", 0.0005, 0.0005),
    ]
    result = subject.cohort_pnl(
        selection,
        {"A": 100.0, "B": 100.0, "BTC": 100.0},
        {"A": 110.0, "B": 90.0, "BTC": 100.0},
        funding,
        mark_prices,
        subject.HOUR_MS,
        subject.HOUR_MS * 3,
        1000.0,
        scenarios,
    )
    assert result["gross"] == pytest.approx(90.055)
    assert result["base"] < result["gross"]


def test_funding_interval_excludes_entry_and_includes_exit() -> None:
    events = [
        subject.Funding(subject.HOUR_MS, 0.01),
        subject.Funding(subject.HOUR_MS * 2, 0.02),
        subject.Funding(subject.HOUR_MS * 3, 0.03),
    ]
    cashflow = subject.funding_cashflow(
        events,
        {subject.HOUR_MS * 2: 110.0},
        weight=0.5,
        capital_usd=1000.0,
        entry_price=100.0,
        entry_ms=subject.HOUR_MS,
        exit_ms=subject.HOUR_MS * 2,
    )
    assert cashflow == pytest.approx(-11.0)


def test_capacity_proxy_respects_largest_weighted_leg() -> None:
    selection = subject.Selection(
        long_symbol="A",
        short_symbol="B",
        weights={"A": 0.5, "B": -0.4, "BTC": -0.1},
    )
    value = subject.capacity_proxy_usd(
        selection,
        {"A": 1_000_000.0, "B": 2_000_000.0, "BTC": 10_000_000.0},
        0.0001,
    )
    assert value == pytest.approx(200.0)


def test_holm_adjust_is_monotone_and_bounded() -> None:
    adjusted = subject.holm_adjust({"a": 0.01, "b": 0.03, "c": 0.9})
    assert adjusted["a"] == pytest.approx(0.03)
    assert adjusted["b"] == pytest.approx(0.06)
    assert adjusted["c"] == pytest.approx(0.9)


def test_cscv_pbo_is_deterministic_and_diagnostic() -> None:
    series = {
        "a": [float(index % 3 - 1) for index in range(24)],
        "b": [float((index + 1) % 3 - 1) for index in range(24)],
    }
    first = subject.cscv_pbo(series, 4)
    second = subject.cscv_pbo(series, 4)
    assert first == second
    assert first["role"] == "DIAGNOSTIC_ONLY"
    assert first["splits"] == 6


def test_maximum_drawdown_uses_fixed_bankroll() -> None:
    assert subject.maximum_drawdown_fraction([10.0, -30.0, 5.0], 1000.0) == pytest.approx(0.03)


def test_parse_checksum_binds_filename() -> None:
    digest = "a" * 64
    assert subject.parse_checksum(f"{digest}  x.zip\n", "x.zip") == digest
    with pytest.raises(ValueError, match="filename mismatch"):
        subject.parse_checksum(f"{digest}  y.zip\n", "x.zip")


def test_build_trials_is_exact_frozen_family() -> None:
    protocol = json.loads((Path(__file__).parent / "protocol.v1.json").read_text())
    trials = subject.build_trials(protocol)
    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12


def test_parse_complete_kline_month(tmp_path: Path) -> None:
    month = "2026-02"
    start_ms, end_ms = subject.month_bounds(month)
    rows = [
        [
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_volume",
            "count",
            "taker_buy_volume",
            "taker_buy_quote_volume",
            "ignore",
        ]
    ]
    for open_ms in range(start_ms, end_ms, subject.HOUR_MS):
        rows.append(
            [
                str(open_ms),
                "100",
                "101",
                "99",
                "100",
                "10",
                str(open_ms + subject.HOUR_MS - 1),
                "1000",
                "2",
                "5",
                "500",
                "0",
            ]
        )
    path = tmp_path / "BTCUSDT-1h-2026-02.zip"
    write_zip(path, "BTCUSDT-1h-2026-02.csv", rows)
    member, bars = subject.parse_kline_zip(path, month)
    assert member.endswith(".csv")
    assert len(bars) == 28 * 24


def test_parse_complete_mark_price_month_ignores_volume_slots(tmp_path: Path) -> None:
    month = "2026-02"
    start_ms, end_ms = subject.month_bounds(month)
    rows = [
        [
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_volume",
            "count",
            "taker_buy_volume",
            "taker_buy_quote_volume",
            "ignore",
        ]
    ]
    for open_ms in range(start_ms, end_ms, subject.HOUR_MS):
        rows.append(
            [
                str(open_ms),
                "100",
                "101",
                "99",
                "100",
                "ignored",
                str(open_ms + subject.HOUR_MS - 1),
                "ignored",
                "ignored",
                "ignored",
                "ignored",
                "ignored",
            ]
        )
    path = tmp_path / "mark.zip"
    write_zip(path, "mark.csv", rows)
    member, bars = subject.parse_mark_price_zip(path, month)
    assert member == "mark.csv"
    assert len(bars) == 28 * 24


def test_parse_kline_rejects_missing_hour(tmp_path: Path) -> None:
    month = "2026-02"
    start_ms, _ = subject.month_bounds(month)
    rows = [
        [
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_volume",
            "count",
            "taker_buy_volume",
            "taker_buy_quote_volume",
            "ignore",
        ]
    ]
    rows.append(
        [
            str(start_ms),
            "100",
            "101",
            "99",
            "100",
            "10",
            str(start_ms + subject.HOUR_MS - 1),
            "1000",
            "2",
            "5",
            "500",
            "0",
        ]
    )
    path = tmp_path / "bad.zip"
    write_zip(path, "bad.csv", rows)
    with pytest.raises(ValueError, match="incomplete hourly month"):
        subject.parse_kline_zip(path, month)


def test_parse_funding_requires_on_hour_rows(tmp_path: Path) -> None:
    month = "2026-02"
    start_ms, _ = subject.month_bounds(month)
    path = tmp_path / "funding.zip"
    write_zip(
        path,
        "funding.csv",
        [
            ["calc_time", "funding_interval_hours", "last_funding_rate"],
            [str(start_ms + 16), "8", "0.0001"],
            [str(start_ms + 8 * subject.HOUR_MS - 16), "8", "-0.0002"],
        ],
    )
    _, events = subject.parse_funding_zip(path, month)
    assert [event.rate for event in events] == [0.0001, -0.0002]
    assert [event.timestamp_ms for event in events] == [
        start_ms,
        start_ms + 8 * subject.HOUR_MS,
    ]


def test_parse_funding_rejects_off_hour(tmp_path: Path) -> None:
    month = "2026-02"
    start_ms, _ = subject.month_bounds(month)
    path = tmp_path / "funding.zip"
    write_zip(
        path,
        "funding.csv",
        [
            ["calc_time", "funding_interval_hours", "last_funding_rate"],
            [str(start_ms + 1001), "8", "0.0001"],
        ],
    )
    with pytest.raises(ValueError, match="invalid funding row"):
        subject.parse_funding_zip(path, month)


def test_validate_funding_grid_rejects_missing_settlement() -> None:
    events = [
        subject.Funding(0, 0.0001, 8),
        subject.Funding(8 * subject.HOUR_MS, 0.0001, 8),
        subject.Funding(24 * subject.HOUR_MS, 0.0001, 8),
    ]
    with pytest.raises(ValueError, match="missing or irregular"):
        subject.validate_funding_grid(events, 0, 32 * subject.HOUR_MS)


def test_validate_funding_grid_rejects_interval_transition() -> None:
    events = [
        subject.Funding(0, 0.0001, 8),
        subject.Funding(8 * subject.HOUR_MS, 0.0001, 4),
    ]
    with pytest.raises(ValueError, match="transition"):
        subject.validate_funding_grid(events, 0, 12 * subject.HOUR_MS)


def test_member_is_marked_before_schema_validation(tmp_path: Path) -> None:
    path = tmp_path / "bad.zip"
    write_zip(path, "bad.csv", [["wrong_header"]])
    opened: list[str] = []
    with pytest.raises(ValueError, match="schema"):
        subject.parse_kline_zip(path, "2026-02", opened.append)
    assert opened == ["bad.csv"]


def test_git_sha_validator_accepts_repository_sha1() -> None:
    assert subject.GIT_SHA_40.fullmatch("a169b123fb186d1943a75ad648552c4d95be1be1")
