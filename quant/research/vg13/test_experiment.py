"""Network-free semantic and lifecycle tests for the V-G13 packet."""

from __future__ import annotations

import hashlib
import json
import math
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from research.vg13 import experiment


def protocol() -> dict[str, object]:
    value = json.loads(experiment.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def synthetic_cross_section() -> dict[str, dict[date, experiment.Bar]]:
    start = date(2025, 1, 1)
    result: dict[str, dict[date, experiment.Bar]] = {}
    for index in range(35):
        symbol = f"S{index:02d}USDT"
        if index in {28, 29, 30}:
            amplitude = 0.0001 + index * 0.000001
        elif index >= 31:
            amplitude = 0.04 + index * 0.0001
        else:
            amplitude = 0.004 + index * 0.00005
        bars: dict[date, experiment.Bar] = {}
        for offset in range(130):
            day = start + timedelta(days=offset)
            close = 100.0 * math.exp(amplitude if offset % 2 else 0.0)
            bars[day] = experiment.Bar(
                day=day,
                open=100.0 + index / 100.0,
                close=close,
                quote_volume=20_000_000.0 + index * 1_000_000.0,
            )
        result[symbol] = bars
    return result


def test_protocol_family_control_and_collision_are_exact() -> None:
    frozen = protocol()
    trials = experiment.build_trials(frozen)
    assert [trial.trial_id for trial in trials] == [
        "H07_K03",
        "H07_K05",
        "H07_K08",
        "H14_K03",
        "H14_K05",
        "H14_K08",
    ]
    assert experiment.nested(
        frozen, "signal", "attributionControl", "insufficientMatches"
    ).startswith("TERMINAL_UNMEASURED")
    assert experiment.nested(frozen, "gates", "development", "pboMaximum") == "0.50"
    assert experiment.sha256_path(experiment.COLLISION_PATH) == experiment.nested(
        frozen, "sourceFreeze", "collisionMatrixSha256"
    )


def test_rank_gap_selects_low_rv_and_matches_notional_high_rv_control() -> None:
    bars = synthetic_cross_section()
    signal_day = date(2025, 1, 1) + timedelta(days=110)
    formation = experiment.build_formation(
        bars,
        signal_day=signal_day,
        trial=experiment.Trial("H07_K03", 7, 3),
    )
    assert formation.eligible_count == 35
    assert [item.symbol for item in formation.selected] == [
        "S30USDT",
        "S29USDT",
        "S28USDT",
    ]
    assert len(formation.controls) == 3
    assert all(item.notional_percentile >= 0.80 for item in formation.controls)
    assert all(item.rv_percentile >= 0.60 for item in formation.controls)
    assert not (
        {item.symbol for item in formation.selected} & {item.symbol for item in formation.controls}
    )


def test_percentile_midrank_is_deterministic() -> None:
    ranks = experiment.percentile_ranks({"B": 2.0, "A": 1.0, "C": 2.0, "D": 4.0})
    assert ranks["A"] == 0.0
    assert ranks["B"] == ranks["C"] == pytest.approx(0.5)
    assert ranks["D"] == 1.0


def test_eligibility_uses_90_prior_bars_and_prior_30d_liquidity() -> None:
    bars = synthetic_cross_section()
    signal_day = date(2025, 1, 1) + timedelta(days=110)
    del bars["S00USDT"][signal_day - timedelta(days=50)]
    formation = experiment.build_formation(
        bars,
        signal_day=signal_day,
        trial=experiment.Trial("H07_K03", 7, 3),
    )
    assert formation.eligible_count == 34
    for offset in range(1, 31):
        original = bars["S01USDT"][signal_day - timedelta(days=offset)]
        bars["S01USDT"][signal_day - timedelta(days=offset)] = experiment.Bar(
            original.day, original.open, original.close, 1_000_000.0
        )
    formation = experiment.build_formation(
        bars,
        signal_day=signal_day,
        trial=experiment.Trial("H07_K03", 7, 3),
    )
    assert formation.eligible_count == 33


def test_notional_matched_control_uses_same_seven_day_sleeve_schedule() -> None:
    start = date(2025, 7, 1)
    selected = experiment.RankedName("LOWRVUSDT", 0.9, 0.1, 0.8)
    control = experiment.RankedName("HIGHRVUSDT", 0.9, 0.9, 0.0)
    formations = tuple(
        experiment.Formation(
            signal_day=entry - timedelta(days=1),
            entry_day=entry,
            selected=(selected,),
            controls=(control,),
            eligible_count=25,
        )
        for entry in experiment.daterange(start, start + timedelta(days=9))
    )
    bars: dict[str, dict[date, experiment.Bar]] = {
        "LOWRVUSDT": {},
        "HIGHRVUSDT": {},
    }
    for day in experiment.daterange(start, start + timedelta(days=16)):
        low_rv_open = 110.0 if day >= start + timedelta(days=7) else 100.0
        bars["LOWRVUSDT"][day] = experiment.Bar(day, low_rv_open, 100.0, 20_000_000.0)
        bars["HIGHRVUSDT"][day] = experiment.Bar(day, 100.0, 100.0, 20_000_000.0)
    scenario = experiment.CostScenario("BASE", 10.0, 10.0)
    signal_metrics = experiment.simulate_portfolio(
        formations,
        bars_by_symbol=bars,
        entry_start=start,
        entry_end=start + timedelta(days=9),
        top_k=3,
        scenario=scenario,
        control=False,
    )
    control_metrics = experiment.simulate_portfolio(
        formations,
        bars_by_symbol=bars,
        entry_start=start,
        entry_end=start + timedelta(days=9),
        top_k=3,
        scenario=scenario,
        control=True,
    )
    assert signal_metrics.completed_round_trips == 10
    assert control_metrics.completed_round_trips == 10
    assert signal_metrics.end_usd > control_metrics.end_usd
    assert signal_metrics.daily_dates == control_metrics.daily_dates


def write_archive(
    path: Path,
    *,
    days: tuple[int, ...] = (0, 1, 2),
    duplicate: bool = False,
) -> str:
    opened = datetime(2025, 7, 1, tzinfo=UTC)
    rows: list[str] = []
    offsets = list(days)
    if duplicate:
        offsets.append(days[-1])
    for offset in offsets:
        timestamp = int(opened.timestamp() * 1_000_000) + offset * experiment.DAY_US
        rows.append(
            ",".join(
                [
                    str(timestamp),
                    "100",
                    "101",
                    "99",
                    "100.5",
                    "10",
                    str(timestamp + experiment.DAY_US - 1),
                    "20000000",
                    "100",
                    "5",
                    "10000000",
                    "0",
                ]
            )
        )
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("TESTUSDT-1d-2025-07.csv", "\n".join(rows) + "\n")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_archive_parser_accepts_exact_microsecond_daily_rows(tmp_path: Path) -> None:
    archive = tmp_path / "TESTUSDT-1d-2025-07.zip"
    digest = write_archive(archive)
    bars = experiment.parse_archive(
        archive, symbol="TESTUSDT", month="2025-07", expected_sha=digest
    )
    assert [bar.day for bar in bars] == [
        date(2025, 7, 1),
        date(2025, 7, 2),
        date(2025, 7, 3),
    ]


@pytest.mark.parametrize(
    ("days", "duplicate", "message"),
    [
        ((0, 2), False, "gapped"),
        ((0, 1), True, "duplicate"),
    ],
)
def test_archive_parser_fails_closed_on_gap_or_duplicate(
    tmp_path: Path,
    days: tuple[int, ...],
    duplicate: bool,
    message: str,
) -> None:
    archive = tmp_path / "TESTUSDT-1d-2025-07.zip"
    digest = write_archive(archive, days=days, duplicate=duplicate)
    with pytest.raises(experiment.EvidenceError, match=message):
        experiment.parse_archive(archive, symbol="TESTUSDT", month="2025-07", expected_sha=digest)


def test_merge_bars_refuses_internal_gap() -> None:
    first = date(2025, 7, 1)
    left = {"TESTUSDT": {first: experiment.Bar(first, 1, 1, 20_000_000)}}
    third = first + timedelta(days=2)
    right = {"TESTUSDT": {third: experiment.Bar(third, 1, 1, 20_000_000)}}
    with pytest.raises(experiment.EvidenceError, match="gapped necessary"):
        experiment.merge_bars(left, right)


def test_external_marker_is_exclusive_and_exact(tmp_path: Path) -> None:
    marker = tmp_path / "marker.v1.json"
    raw = experiment.exclusive_external_marker(marker, {"attempt": 1})
    assert marker.read_bytes() == raw
    with pytest.raises(experiment.EvidenceError, match="already consumed"):
        experiment.exclusive_external_marker(marker, {"attempt": 2})


def test_bootstrap_holm_and_pbo_are_deterministic() -> None:
    values = tuple(0.001 if index % 3 else -0.0001 for index in range(243))
    first = experiment.bootstrap_stats(
        values, seed=13, replicates=128, block_length=7, compound=False
    )
    second = experiment.bootstrap_stats(
        values, seed=13, replicates=128, block_length=7, compound=False
    )
    assert first == second
    holm = experiment.holm_adjusted({"a": 0.001, "b": 0.02, "c": 0.8}, 0.05)
    assert holm["a"]["rejectAtFamilyWiseAlpha"] is True
    dates = tuple(date(2025, 7, 1) + timedelta(days=index) for index in range(236))
    series = {
        f"T{trial}": (dates, tuple(value - trial * 0.000001 for value in values[:236]))
        for trial in range(6)
    }
    pbo = experiment.calculate_pbo(series)
    assert pbo["splitCount"] == 70
    assert 0 <= float(str(pbo["pbo"])) <= 1


def test_terminal_result_preserves_unknowns_and_no_authority() -> None:
    result = experiment.terminal_result(
        phase="DEVELOPMENT",
        reason="gapped row",
        freeze_sha="a" * 64,
        development_marker_sha="b" * 64,
    )
    assert result["verdict"] == "UNMEASURED"
    assert result["holdoutOpened"] is False
    assert result["repairOrRerunAllowed"] is False
    assert result["truth"] == experiment.TRUTH
