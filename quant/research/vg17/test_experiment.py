"""Hostile focused tests for the frozen V-G17 experiment."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
import research.vg17.experiment as exp


def make_bar(
    symbol: str,
    day: date,
    *,
    open_price: str = "100",
    close_price: str = "101",
    quote_volume: str = "100000000",
) -> exp.Bar:
    open_value = Decimal(open_price)
    close_value = Decimal(close_price)
    return exp.Bar(
        symbol=symbol,
        day=day,
        open=open_value,
        high=max(open_value, close_value),
        low=min(open_value, close_value),
        close=close_value,
        quote_volume=Decimal(quote_volume),
    )


def dense_bars(start: date, end: date) -> dict[str, dict[date, exp.Bar]]:
    output: dict[str, dict[date, exp.Bar]] = {}
    for symbol_index, symbol in enumerate(exp.symbols(), start=1):
        values: dict[date, exp.Bar] = {}
        for offset, day in enumerate(exp.dates(start, end)):
            base = Decimal(100 + symbol_index) + Decimal(offset) / 10
            close = base * (Decimal("1.001") + Decimal(symbol_index) / Decimal(100_000))
            values[day] = make_bar(
                symbol,
                day,
                open_price=str(base),
                close_price=str(close),
                quote_volume=str(20_000_000 + symbol_index * 1_000_000),
            )
        output[symbol] = values
    return output


def test_protocol_and_trial_grid_are_exact() -> None:
    grid = exp.trials()
    assert len(grid) == 12
    assert tuple(item.trial_id for item in grid) == (
        "vg17-l07-k03",
        "vg17-l07-k06",
        "vg17-l07-k09",
        "vg17-l14-k03",
        "vg17-l14-k06",
        "vg17-l14-k09",
        "vg17-l28-k03",
        "vg17-l28-k06",
        "vg17-l28-k09",
        "vg17-l56-k03",
        "vg17-l56-k06",
        "vg17-l56-k09",
    )
    protocol = exp.protocol()
    assert protocol["baseCommit"] == "a169b123fb186d1943a75ad648552c4d95be1be1"
    assert exp.symbols() == tuple(sorted(exp.symbols()))


def test_impact_term_has_declared_units_and_future_mutation_is_causal() -> None:
    start = date(2025, 5, 1)
    end = date(2025, 8, 10)
    bars = dense_bars(start, end)
    symbol = exp.symbols()[0]
    terms = exp.daily_impact_terms(bars)
    day = start + timedelta(days=1)
    bar = bars[symbol][day]
    prior = bars[symbol][day - timedelta(days=1)]
    expected = (
        abs((bar.close / prior.close).ln())
        * Decimal(10_000)
        * Decimal(1_000_000)
        / bar.quote_volume
    )
    assert terms[(symbol, day)] == expected

    entry_day = date(2025, 7, 15)
    signal_day = entry_day - timedelta(days=2)
    before = exp.impact_score(symbol, signal_day, 28, bars, terms)
    assert before is not None
    future_day = entry_day + timedelta(days=10)
    original = bars[symbol][future_day]
    bars[symbol][future_day] = make_bar(
        symbol,
        future_day,
        open_price=str(original.open),
        close_price="999999",
        quote_volume=str(original.quote_volume),
    )
    after = exp.impact_score(symbol, signal_day, 28, bars, exp.daily_impact_terms(bars))
    assert after == before


def test_cohort_cash_and_boundary_tie_laws() -> None:
    start = date(2025, 5, 1)
    end = date(2025, 7, 31)
    bars = dense_bars(start, end)
    trial = exp.Trial("vg17-l07-k03", 7, 3)
    entry = date(2025, 7, 20)

    only_fourteen = {symbol: bars[symbol] for symbol in exp.symbols()[:14]}
    selection = exp.select_cohort(
        entry, trial, only_fourteen, exp.daily_impact_terms(only_fourteen)
    )
    assert selection.selected == ()
    assert selection.reason == "ELIGIBLE_COHORT_BELOW_15"

    tied = dense_bars(start, end)
    template = tied[exp.symbols()[0]]
    for symbol in exp.symbols():
        tied[symbol] = {
            day: make_bar(
                symbol,
                day,
                open_price=str(bar.open),
                close_price=str(bar.close),
                quote_volume=str(bar.quote_volume),
            )
            for day, bar in template.items()
        }
    tied_selection = exp.select_cohort(entry, trial, tied, exp.daily_impact_terms(tied))
    assert tied_selection.eligible_count == 20
    assert tied_selection.selected == ()
    assert tied_selection.reason == "BOUNDARY_TIE_OR_EMPTY"


def test_seven_sleeves_next_open_costs_and_no_leverage() -> None:
    start = date(2025, 6, 1)
    end = date(2025, 7, 14)
    bars = dense_bars(start, end)
    trial = exp.Trial("vg17-l07-k03", 7, 3)
    path_start = date(2025, 7, 1)
    entry_end = date(2025, 7, 7)
    selected = exp.symbols()[:3]
    cache = {
        (trial.trial_id, day): exp.Selection(day, day - timedelta(days=2), selected, 20, "SELECTED")
        for day in exp.dates(path_start, entry_end)
    }
    terms = exp.daily_impact_terms(bars)
    base = exp.simulate(
        trial,
        10,
        bars,
        terms,
        start_day=path_start,
        entry_end_day=entry_end,
        path_end_day=end,
        selection_cache=cache,
    )
    stress = exp.simulate(
        trial,
        25,
        bars,
        terms,
        start_day=path_start,
        entry_end_day=entry_end,
        path_end_day=end,
        selection_cache=cache,
    )
    assert base.active_entry_days == 7
    assert base.round_trips == 21
    assert base.daily_equity[-1] <= Decimal(1_100)
    assert stress.final_net_usd < base.final_net_usd
    assert stress.minimum_stress_participation_headroom is not None


def test_drawdown_includes_initial_capital_and_exit_capacity_uses_exit_notional() -> None:
    assert exp.maximum_drawdown((Decimal(900), Decimal(800))) == Decimal("0.20")

    start = date(2025, 6, 1)
    entry_day = date(2025, 7, 1)
    exit_day = entry_day + timedelta(days=7)
    bars = dense_bars(start, exit_day)
    trial = exp.Trial("vg17-l07-k03", 7, 3)
    selected = exp.symbols()[:3]
    first = selected[0]
    original = bars[first][exit_day]
    bars[first][exit_day] = make_bar(
        first,
        exit_day,
        open_price="1000",
        close_price="1000",
        quote_volume=str(original.quote_volume),
    )
    cache = {
        (trial.trial_id, entry_day): exp.Selection(
            entry_day, entry_day - timedelta(days=2), selected, 20, "SELECTED"
        )
    }
    simulation = exp.simulate(
        trial,
        10,
        bars,
        exp.daily_impact_terms(bars),
        start_day=entry_day,
        entry_end_day=entry_day,
        path_end_day=exit_day,
        selection_cache=cache,
    )
    assert simulation.minimum_stress_participation_headroom is not None
    assert simulation.minimum_stress_participation_headroom < Decimal(5)


def test_family_bootstrap_is_synchronous_deterministic_and_full_family() -> None:
    matrix = {
        trial.trial_id: tuple(
            Decimal(index + trial.lookback_days - trial.selected_count) / Decimal(100)
            for index in range(40)
        )
        for trial in exp.trials()
    }
    first = exp.family_bootstrap(matrix, block_length=7, replicates=32, seed=123)
    second = exp.family_bootstrap(matrix, block_length=7, replicates=32, seed=123)
    assert first == second
    assert tuple(sorted(first.trial_intervals)) == tuple(
        sorted(item.trial_id for item in exp.trials())
    )
    assert Decimal(0) < first.white_reality_p_value <= Decimal(1)

    with pytest.raises(exp.ContractError, match="twelve"):
        exp.family_bootstrap(
            {"one": (Decimal(1),) * 40},
            block_length=7,
            replicates=32,
            seed=123,
        )


def test_pbo_uses_twelve_twenty_day_blocks_and_924_splits() -> None:
    matrix = {
        trial.trial_id: tuple(
            Decimal((index % 20) + trial.lookback_days - trial.selected_count)
            for index in range(243)
        )
        for trial in exp.trials()
    }
    report = exp.pbo_report(matrix)
    assert report["blockCount"] == 12
    assert report["splitCount"] == 924
    assert report["status"] == "AVAILABLE"


def test_checksum_filename_digest_and_timestamp_laws() -> None:
    archive = b"zip bytes"
    digest = hashlib.sha256(archive).hexdigest()
    exp.verify_sidecar(
        f"{digest}  BTCUSDT-1d-2025-07.zip\n".encode(),
        "BTCUSDT-1d-2025-07.zip",
        digest,
    )
    with pytest.raises(exp.MeasurementError, match="filename mismatch"):
        exp.verify_sidecar(
            f"{digest}  ETHUSDT-1d-2025-07.zip\n".encode(),
            "BTCUSDT-1d-2025-07.zip",
            digest,
        )
    open_us = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1_000_000)
    _, parsed_day = exp.parse_timestamp_us(str(open_us), "open")
    assert parsed_day == date(2025, 7, 1)
    close_us = open_us + 86_400_000_000 - 1
    exp.parse_close_timestamp_us(str(close_us), parsed_day, "close")
    with pytest.raises(exp.MeasurementError, match="daily close"):
        exp.parse_close_timestamp_us(str(close_us - 999_999), parsed_day, "close")
    with pytest.raises(exp.MeasurementError, match="microsecond"):
        exp.parse_timestamp_us(str(open_us // 1_000), "open")


def archive_bytes(symbol: str, month: str, *, duplicate: bool = False) -> bytes:
    start = date.fromisoformat(f"{month}-01")
    next_month = (start + timedelta(days=32)).replace(day=1)
    rows: list[str] = []
    for day in exp.dates(start, next_month - timedelta(days=1)):
        open_us = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp() * 1_000_000)
        close_us = open_us + 86_400_000_000 - 1
        rows.append(
            ",".join(
                (
                    str(open_us),
                    "100",
                    "102",
                    "99",
                    "101",
                    "1000",
                    str(close_us),
                    "100000000",
                    "100",
                    "500",
                    "50000000",
                    "0",
                )
            )
        )
    if duplicate:
        rows.insert(2, rows[1])
    payload = ("\n".join(rows) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr(f"{symbol}-1d-{month}.csv", payload)
    return output.getvalue()


def test_archive_parser_rejects_duplicate_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    symbol = "BTCUSDT"
    month = "2025-07"
    archive = tmp_path / f"{symbol}-1d-{month}.zip"
    sidecar = archive.with_name(f"{archive.name}.CHECKSUM")
    payload = archive_bytes(symbol, month, duplicate=True)
    archive.write_bytes(payload)
    archive_digest = hashlib.sha256(payload).hexdigest()
    sidecar_payload = f"{archive_digest}  {archive.name}\n".encode()
    sidecar.write_bytes(sidecar_payload)
    monkeypatch.setattr(exp, "source_root", lambda: tmp_path)
    record: dict[str, object] = {
        "archivePath": archive.name,
        "archiveSha256": archive_digest,
        "checksumPath": sidecar.name,
        "checksumSha256": hashlib.sha256(sidecar_payload).hexdigest(),
        "month": month,
        "symbol": symbol,
    }
    with pytest.raises(exp.MeasurementError, match="duplicate or unsorted"):
        exp.parse_archive(record)


def test_exclusive_create_and_null_terminal_truth(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "once.json"
    exp.write_json_once(target, {"a": 1})
    assert json.loads(target.read_text()) == {"a": 1}
    with pytest.raises(exp.ContractError, match="forbids overwrite"):
        exp.write_json_once(target, {"a": 2})

    monkeypatch.setattr(exp, "sha256_path", lambda _path: "0" * 64)
    result = exp.base_result(
        verdict="UNMEASURED",
        development={"metrics": None, "status": "UNMEASURED"},
        holdout={"metrics": None, "openCount": 0, "state": "UNOPENED_UNTOUCHED"},
        reason={"code": "SYNTHETIC_FAILURE"},
    )
    assert result["verdict"] == "UNMEASURED"
    capacity = exp.require_mapping(result["capacityTruth"], "capacityTruth")
    assert capacity["executableCapacityUsd"] is None
