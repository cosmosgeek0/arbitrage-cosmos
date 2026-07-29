from __future__ import annotations

import hashlib
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg18 import experiment as vg18

D = Decimal


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: str = "100",
    quote_volume: str = "10000000",
    trade_count: int = 100,
) -> vg18.Bar:
    return vg18.Bar(
        symbol=symbol,
        day=day,
        open_price=D(open_price),
        quote_volume=D(quote_volume),
        trade_count=trade_count,
        row_digest=hashlib.sha256(f"{symbol}:{day}".encode()).hexdigest(),
    )


def _series(
    symbol: str,
    first: date,
    last: date,
    *,
    signal_day: date | None = None,
    signal_quote_volume: str = "20000000",
) -> dict[date, vg18.Bar]:
    result = {day: _bar(symbol, day) for day in vg18.date_range(first, last)}
    if signal_day is not None:
        result[signal_day] = _bar(
            symbol,
            signal_day,
            quote_volume=signal_quote_volume,
        )
    return result


def test_protocol_and_trial_grid_are_frozen() -> None:
    protocol = vg18.validate_protocol()
    trials = vg18.parse_trials()
    assert protocol["signal"]["priceInputsForSelection"] == []
    assert len(trials) == 12
    assert {(trial.cohort_size, trial.shock_floor, trial.hold_days) for trial in trials} == {
        (cohort, shock, hold)
        for cohort in (3, 5)
        for shock in (D("1.5"), D("2"), D("3"))
        for hold in (3, 7)
    }


def test_eligibility_excludes_frozen_non_crypto_and_leveraged_names() -> None:
    assert vg18.eligible_symbol("BTCUSDT")
    assert not vg18.eligible_symbol("USDCUSDT")
    assert not vg18.eligible_symbol("BTCUPUSDT")
    assert not vg18.eligible_symbol("btcusdt")


def test_signal_is_lagged_and_does_not_use_price() -> None:
    signal = date(2025, 7, 1)
    series = _series(
        "AAAUSDT",
        signal - timedelta(days=120),
        signal + timedelta(days=1),
        signal_day=signal,
    )
    first = vg18.candidate_for_symbol("AAAUSDT", series, signal)
    assert first is not None
    assert first.shock_multiple == D(2)
    series[signal] = _bar(
        "AAAUSDT",
        signal,
        open_price="999999",
        quote_volume="20000000",
    )
    second = vg18.candidate_for_symbol("AAAUSDT", series, signal)
    assert second == first
    for offset in range(61, 121):
        day = signal - timedelta(days=offset)
        series[day] = _bar("AAAUSDT", day, quote_volume="999999999")
    assert vg18.candidate_for_symbol("AAAUSDT", series, signal) != first


def test_full_cohort_is_cash_when_selected_entry_is_missing() -> None:
    signal = date(2025, 7, 1)
    first = signal - timedelta(days=120)
    last = signal + timedelta(days=4)
    bars = {
        f"A{index:02d}USDT": _series(
            f"A{index:02d}USDT",
            first,
            last,
            signal_day=signal,
            signal_quote_volume=str(30_000_000 - index * 100_000),
        )
        for index in range(30)
    }
    del bars["A00USDT"][signal + timedelta(days=1)]
    trial = vg18.Trial("T", 3, D("1.5"), 3)
    decision = vg18.build_decisions(bars, trial, signal, signal)[0]
    assert decision.state == "CASH"
    assert decision.selected == ()
    assert decision.reason == ("SELECTED_ENTRY_UNAVAILABLE_ENTIRE_SLEEVE_CASH_NO_REPLACEMENT")


def test_costs_are_applied_on_both_fills() -> None:
    signal = date(2025, 7, 1)
    entry = signal + timedelta(days=1)
    selected = vg18.Candidate(
        symbol="AAAUSDT",
        shock_multiple=D(2),
        mean_notional=D(2),
        baseline_mean_notional=D(1),
        trailing_median_quote_volume=D("10000000"),
    )
    decision = vg18.CohortDecision(
        signal_day=signal,
        entry_day=entry,
        exit_day=entry + timedelta(days=3),
        state="ACTIVE",
        reason="FULL_TOP_K_ACTIVE",
        eligible_symbol_count=30,
        candidates=(selected,),
        selected=(selected,),
        stress_capacity_proxy_usd=D(500),
    )
    bars = {
        "AAAUSDT": _series(
            "AAAUSDT",
            entry,
            entry + timedelta(days=3),
            signal_day=None,
        )
    }
    gross = vg18.simulate_scenario(bars, (decision,), hold_days=3, fee=D(0), adverse=D(0))
    stress = vg18.simulate_scenario(
        bars,
        (decision,),
        hold_days=3,
        fee=D("0.002"),
        adverse=D("0.0015"),
    )
    assert abs(gross.final_nav - D(1000)) < D("1E-40")
    assert stress.final_nav < gross.final_nav


def test_all_horizons_share_one_calendar_grid() -> None:
    signal = date(2025, 7, 1)
    entry = signal + timedelta(days=1)

    def cash_decision(hold_days: int) -> vg18.CohortDecision:
        return vg18.CohortDecision(
            signal_day=signal,
            entry_day=entry,
            exit_day=entry + timedelta(days=hold_days),
            state="CASH",
            reason="FULL_TOP_K_DOES_NOT_CLEAR_SHOCK_FLOOR",
            eligible_symbol_count=30,
            candidates=(),
            selected=(),
            stress_capacity_proxy_usd=None,
        )

    h3 = vg18.simulate_scenario({}, (cash_decision(3),), hold_days=3, fee=D(0), adverse=D(0))
    h7 = vg18.simulate_scenario({}, (cash_decision(7),), hold_days=7, fee=D(0), adverse=D(0))
    assert h3.dates == h7.dates
    assert h3.dates[-1] == entry + timedelta(days=7)
    assert all(value == 0 for value in h3.daily_returns)
    assert all(value == 0 for value in h7.daily_returns)


def _archive_row(day: date) -> list[str]:
    open_dt = datetime(day.year, day.month, day.day, tzinfo=UTC)
    open_us = int(open_dt.timestamp()) * 1_000_000
    close_us = open_us + vg18.DAY_US - 1
    return [
        str(open_us),
        "10",
        "11",
        "9",
        "10",
        "100",
        str(close_us),
        "1000",
        "10",
        "50",
        "500",
        "0",
    ]


def _write_archive(
    root: Path,
    *,
    rows: list[list[str]],
) -> dict[str, object]:
    symbol = "AAAUSDT"
    month = "2025-01"
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    csv_name = f"{symbol}-1d-{month}.csv"
    body = "".join(",".join(row) + "\n" for row in rows).encode("ascii")
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(csv_name, body)
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = zip_path.with_name(zip_path.name + ".CHECKSUM")
    checksum_path.write_text(f"{zip_sha}  {zip_path.name}\n", encoding="ascii")
    return {
        "checksumPath": str(checksum_path.relative_to(root)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "symbol": symbol,
        "zipPath": str(zip_path.relative_to(root)),
        "zipSha256": zip_sha,
    }


def test_exact_duplicate_is_causally_ineligible(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    row = _archive_row(date(2025, 1, 1))
    artifact = _write_archive(tmp_path, rows=[row, row])
    monkeypatch.setattr(vg18, "SOURCE_ROOT", tmp_path)
    bars, anomalies = vg18.parse_archive(artifact)
    assert bars == ()
    assert len(anomalies) == 1
    assert anomalies[0].kind == "EXACT_DUPLICATE_SYMBOL_DAY_CAUSALLY_INELIGIBLE"


def test_conflicting_duplicate_is_terminal_unmeasured(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    first = _archive_row(date(2025, 1, 1))
    second = list(first)
    second[1] = "10.5"
    artifact = _write_archive(tmp_path, rows=[first, second])
    monkeypatch.setattr(vg18, "SOURCE_ROOT", tmp_path)
    with pytest.raises(vg18.TerminalMeasurementError, match="CONFLICTING_DUPLICATE"):
        vg18.parse_archive(artifact)


def test_millisecond_timestamp_is_rejected() -> None:
    with pytest.raises(vg18.TerminalMeasurementError, match="microsecond"):
        vg18.parse_timestamp_us("1735689600000", field="openTime")


def test_unmeasured_never_publishes_false_zero_economics() -> None:
    phase, result = vg18.terminal_unmeasured(
        phase="development",
        reason="SOURCE_SEMANTICS_INVALID",
        holdout_opened=False,
    )
    assert phase["economics"] is None
    assert result["verdict"] == "UNMEASURED"
    assert result["accountEffectiveFees"] is None
    assert result["capitalDecision"] == "NO_GO"


def test_pbo_is_not_an_input_to_gate_evaluation() -> None:
    assert "pbo" not in vg18._gate_metrics.__annotations__


def test_exclusive_writer_refuses_overwrite(tmp_path: Path) -> None:
    target = tmp_path / "marker.json"
    vg18.exclusive_write(target, b"one", mode=0o600)
    with pytest.raises(vg18.VG18Error, match="create-once"):
        vg18.exclusive_write(target, b"two", mode=0o600)
    assert target.read_bytes() == b"one"


def test_body_consumption_receipt_is_one_shot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    marker = tmp_path / "run-marker.v1.json"
    marker.write_bytes(vg18.canonical_bytes({"schema": "Marker"}))
    monkeypatch.setattr(vg18, "STATE_ROOT", tmp_path / "state")
    monkeypatch.setattr(vg18, "git_head", lambda: "a" * 40)
    vg18._consume_body_once(
        phase="development",
        marker_path=marker,
        marker_commit="b" * 40,
    )
    with pytest.raises(vg18.VG18Error, match="create-once"):
        vg18._consume_body_once(
            phase="development",
            marker_path=marker,
            marker_commit="b" * 40,
        )


def test_fixed_point_mapping_uses_declared_integer_scale() -> None:
    assert vg18.fixed_mapping_to_decimal(
        {"mantissa": "125000000000", "scale": "1000000000000"}
    ) == D("0.125")
