"""Focused deterministic tests for the sealed V-G37 experiment."""

from __future__ import annotations

import hashlib
import json
import math
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
from research.vg37 import experiment as vg37


def _bar(symbol: str, day: date, quote_volume: float, price: float = 100.0) -> vg37.Bar:
    open_time = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp() * 1_000_000)
    return vg37.Bar(
        symbol=symbol,
        day=day,
        open_price=price,
        close_price=price,
        quote_volume=quote_volume,
        open_time=open_time,
        close_time=open_time + 86_400_000_000 - 1,
    )


def _market_bars(entry_day: date, symbol_count: int = 205) -> dict[str, dict[date, vg37.Bar]]:
    cutoff = entry_day - timedelta(days=2)
    start = cutoff - timedelta(days=vg37.OLDER_WINDOW_DAYS + max(vg37.RECENT_WINDOWS))
    bars: dict[str, dict[date, vg37.Bar]] = {}
    for symbol_index in range(symbol_count):
        symbol = f"S{symbol_index:03d}USDT"
        symbol_bars: dict[date, vg37.Bar] = {}
        for day_index, day in enumerate(vg37.iter_days(start, cutoff)):
            common = math.sin(day_index / 4.0)
            idiosyncratic = math.sin(day_index * (symbol_index + 3) / 17.0)
            value = 10_000.0 + 500.0 * common + 50.0 * idiosyncratic
            symbol_bars[day] = _bar(symbol, day, value)
        bars[symbol] = symbol_bars
    return bars


def test_trial_grid_is_exactly_twelve_and_stable() -> None:
    trials = vg37.trial_grid()
    assert len(trials) == 12
    assert trials[0].trial_id == "R07_D05_H03"
    assert trials[-1].trial_id == "R28_D10_H07"
    assert len({trial.trial_id for trial in trials}) == 12


def test_average_ranks_use_average_ties() -> None:
    ranks = vg37._average_ranks(np.asarray([3.0, 1.0, 1.0, 8.0]))
    assert ranks.tolist() == [3.0, 1.5, 1.5, 4.0]


def test_pairwise_spearman_detects_alignment() -> None:
    matrix = np.asarray(
        [
            [1.0, 2.0, 3.0, 4.0],
            [10.0, 20.0, 30.0, 40.0],
            [7.0, 8.0, 9.0, 10.0],
        ]
    )
    score, keep = vg37.median_pairwise_spearman(matrix)
    assert score == pytest.approx(1.0)
    assert keep.tolist() == [True, True, True]


def test_pairwise_spearman_drops_constant_rows() -> None:
    matrix = np.asarray(
        [
            [1.0, 2.0, 3.0],
            [4.0, 5.0, 6.0],
            [9.0, 9.0, 9.0],
        ]
    )
    score, keep = vg37.median_pairwise_spearman(matrix)
    assert score == pytest.approx(1.0)
    assert keep.tolist() == [True, True, False]


def test_signal_is_price_invariant_and_lagged() -> None:
    entry = date(2025, 5, 5)
    bars = _market_bars(entry)
    symbols = tuple(sorted(bars))
    baseline = vg37.formation_signal(bars, symbols, entry, 28)
    assert baseline.valid
    future = entry + timedelta(days=30)
    for symbol, symbol_bars in bars.items():
        for day, bar in tuple(symbol_bars.items()):
            symbol_bars[day] = _bar(symbol, day, bar.quote_volume, price=9_999.0)
        symbol_bars[future] = _bar(symbol, future, 1e20, price=1e-9)
    changed = vg37.formation_signal(bars, symbols, entry, 28)
    assert changed == baseline


def test_signal_fails_closed_below_market_wide_minimum() -> None:
    entry = date(2025, 5, 5)
    bars = _market_bars(entry, symbol_count=vg37.MINIMUM_PANEL - 1)
    formation = vg37.formation_signal(bars, tuple(sorted(bars)), entry, 14)
    assert not formation.valid
    assert formation.invalid_reason == "MINIMUM_CAUSAL_PANEL_NOT_MET"


def test_candidate_universe_uses_only_required_prior_months() -> None:
    cutoff = date(2025, 5, 3)
    required = vg37.months_spanned(
        cutoff - timedelta(days=vg37.OLDER_WINDOW_DAYS + max(vg37.RECENT_WINDOWS)),
        cutoff,
    )
    index = {("FULLUSDT", month): {"symbol": "FULLUSDT", "month": month} for month in required}
    index[("FUTUREUSDT", "2025-06")] = {
        "symbol": "FUTUREUSDT",
        "month": "2025-06",
    }
    candidates = vg37.candidate_symbols_for_cutoff(index, cutoff, 28)
    assert candidates == ("FULLUSDT",)


def test_formation_days_never_cross_partition_boundary() -> None:
    values = vg37.formation_days(date(2025, 10, 1), date(2025, 10, 31), hold_days=7)
    assert values[-1] == date(2025, 10, 20)
    assert all(value.weekday() == 0 for value in values)
    assert all(value + timedelta(days=7) <= date(2025, 10, 31) for value in values)


def test_episode_builder_ignores_overlapping_signal() -> None:
    trial = vg37.Trial("T", recent_days=7, threshold=0.05, hold_days=7)
    first = date(2025, 5, 5)
    formations = {
        (day, 7): vg37.Formation(
            entry_day=day,
            cutoff_day=day - timedelta(days=2),
            recent_days=7,
            eligible_symbols=250,
            recent_sync=0.4,
            older_sync=0.2,
            shock=0.2,
            valid=True,
            invalid_reason=None,
        )
        for day in vg37.formation_days(first, date(2025, 5, 31), 7)
    }
    episodes = vg37.build_episodes(trial, formations, first, date(2025, 5, 31))
    assert episodes[0] == (first, first + timedelta(days=7))
    assert episodes[1][0] == first + timedelta(days=7)


def test_holm_adjustment_is_monotone() -> None:
    adjusted = vg37.holm_adjust({"a": 0.001, "b": 0.02, "c": 0.04})
    assert adjusted["a"] == pytest.approx(0.003)
    assert adjusted["b"] == pytest.approx(0.04)
    assert adjusted["c"] == pytest.approx(0.04)


def test_bootstrap_is_seeded_and_reports_interval() -> None:
    values = [0.001 * math.sin(index / 3.0) for index in range(80)]
    first = vg37.bootstrap_summary(values, block_length=7, seed=123)
    second = vg37.bootstrap_summary(values, block_length=7, seed=123)
    assert first == second
    assert first["lower90Usdt"] <= first["upper90Usdt"]
    assert 0.0 < first["oneSidedP"] <= 1.0


def test_pbo_has_all_seventy_splits() -> None:
    series = {
        f"T{trial}": [0.001 * math.sin(day + trial) for day in range(80)] for trial in range(12)
    }
    result = vg37.pbo_diagnostic(series)
    assert result["splits"] == 70
    assert 0.0 <= result["pbo"] <= 1.0


def test_parse_archive_rejects_row_outside_declared_month(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source"
    monkeypatch.setattr(vg37, "SOURCE_ROOT", source)
    symbol = "TESTUSDT"
    month = "2025-01"
    root = source / "archives" / symbol / month
    root.mkdir(parents=True)
    zip_path = root / f"{symbol}-1d-{month}.zip"
    member = f"{symbol}-1d-{month}.csv"
    outside = date(2025, 2, 1)
    open_time = int(
        datetime(outside.year, outside.month, outside.day, tzinfo=UTC).timestamp() * 1_000_000
    )
    row = f"{open_time},1,1,1,1,1,{open_time + 86_400_000_000 - 1},100,1,1,1,0\n"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(member, row)
    checksum_path = root / f"{zip_path.name}.CHECKSUM"
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path.write_text(f"{zip_sha}  {zip_path.name}\n", encoding="utf-8")
    pair_path = root / "pair.v1.json"
    pair_path.write_text("{}\n", encoding="utf-8")
    entry = {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumRelativePath": str(checksum_path.relative_to(source)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "pairRelativePath": str(pair_path.relative_to(source)),
        "pairSha256": hashlib.sha256(pair_path.read_bytes()).hexdigest(),
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipRelativePath": str(zip_path.relative_to(source)),
        "zipSha256": zip_sha,
    }
    with pytest.raises(vg37.VG37Error, match="ROW_OUTSIDE_DECLARED_MONTH"):
        vg37.parse_archive(entry)


def test_protocol_forbids_nonpublic_and_signal_price_inputs() -> None:
    protocol = json.loads(vg37.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert protocol["authority"]["executionAuthority"] == "NONE"
    assert protocol["signal"]["priceInformationUsed"] is False
    assert protocol["data"]["sharedSourceMode"] == "READ_ONLY"
    assert protocol["runControl"]["allowedDevelopmentRunCount"] == 1
    assert protocol["runControl"]["allowedHoldoutOpenCount"] == 1


def test_source_has_no_network_or_private_client_import() -> None:
    source = vg37.EXPERIMENT_PATH.read_text(encoding="utf-8")
    for forbidden in ("requests", "urllib", "httpx", "boto3", "ccxt"):
        assert f"import {forbidden}" not in source
        assert f"from {forbidden}" not in source
