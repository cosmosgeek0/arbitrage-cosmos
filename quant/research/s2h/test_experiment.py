"""Network-free contract tests for the sealed S-2H experiment."""

from __future__ import annotations

import hashlib
import io
import json
import os
import urllib.request
import zipfile
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from research.s2h import experiment as sut

D = Decimal
DEFAULT_PRICE = D(100)
DEFAULT_QUOTE_VOLUME = D(1000)


@pytest.fixture(autouse=True)
def network_is_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn accidental public-source reads into loud test failures."""

    def reject_network(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("network access is forbidden in S-2H tests")

    monkeypatch.setattr(urllib.request, "urlopen", reject_network)


def archive_rows(
    interval: str,
    month: str,
    *,
    with_header: bool = False,
) -> list[list[str]]:
    year, month_number = (int(item) for item in month.split("-"))
    month_start = datetime(year, month_number, 1, tzinfo=UTC)
    step = timedelta(days=1) if interval == "1d" else timedelta(hours=1)
    count = sut.days_in_month(month) * (1 if interval == "1d" else 24)
    duration_us = sut.DAY_US if interval == "1d" else sut.HOUR_US
    rows: list[list[str]] = []
    if with_header:
        rows.append(
            [
                "open_time",
                "open",
                "high",
                "low",
                "close",
                "volume",
                "close_time",
                "quote_volume",
                "trades",
                "taker_base",
                "taker_quote",
                "ignore",
            ]
        )
    for index in range(count):
        opened_at = month_start + index * step
        opened_us = int(opened_at.timestamp() * 1_000_000)
        rows.append(
            [
                str(opened_us),
                "100",
                "102",
                "98",
                "101",
                "12",
                str(opened_us + duration_us - 1),
                str(1_000_000 + index),
                "7",
                "5",
                "500000",
                "0",
            ]
        )
    return rows


def archive_bytes(
    member_name: str,
    rows: list[list[str]],
    *,
    external_attr: int | None = None,
    extra_member: bool = False,
) -> bytes:
    payload = "".join(",".join(row) + "\n" for row in rows).encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        member = zipfile.ZipInfo(member_name)
        if external_attr is not None:
            member.create_system = 3
            member.external_attr = external_attr
        archive.writestr(member, payload)
        if extra_member:
            archive.writestr("unexpected.csv", payload)
    return output.getvalue()


def write_archive_pair(
    directory: Path,
    *,
    symbol: str = "AAAUSDT",
    interval: str = "1h",
    month: str = "2025-02",
    rows: list[list[str]] | None = None,
    member_name: str | None = None,
    external_attr: int | None = None,
    extra_member: bool = False,
) -> tuple[Path, Path]:
    name = f"{symbol}-{interval}-{month}.zip"
    raw = archive_bytes(
        member_name or f"{symbol}-{interval}-{month}.csv",
        rows if rows is not None else archive_rows(interval, month),
        external_attr=external_attr,
        extra_member=extra_member,
    )
    zip_path = directory / name
    checksum_path = directory / f"{name}.CHECKSUM"
    zip_path.write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    checksum_path.write_text(f"{digest}  {name}\n", encoding="ascii")
    return zip_path, checksum_path


def hour_bar(
    opened_at: datetime,
    *,
    opened: Decimal = DEFAULT_PRICE,
    closed: Decimal = DEFAULT_PRICE,
    quote_volume: Decimal = DEFAULT_QUOTE_VOLUME,
) -> sut.HourBar:
    return sut.HourBar(
        opened_at=opened_at,
        open=opened,
        high=max(opened, closed),
        low=min(opened, closed),
        close=closed,
        quote_volume=quote_volume,
        trades=1,
    )


def synthetic_series(
    *,
    target_day: date = date(2025, 7, 2),
) -> tuple[tuple[str, ...], dict[str, dict[datetime, sut.HourBar]]]:
    """Build 30 complete synthetic symbols with deliberately hostile unused prices."""

    symbols = tuple(f"S{index:02d}USDT" for index in range(30))
    previous_day = target_day - timedelta(days=1)
    series: dict[str, dict[datetime, sut.HourBar]] = {}
    for index, symbol in enumerate(symbols):
        symbol_series: dict[datetime, sut.HourBar] = {}
        prior_volume = D(1000 + index)
        for hour in range(24):
            key = sut.hour_key(previous_day, hour)
            symbol_series[key] = hour_bar(
                key,
                opened=D(100),
                closed=D(100),
                quote_volume=prior_volume,
            )

        # The boundary gap is uniquely increasing with symbol index.
        boundary = sut.hour_key(target_day, 0)
        symbol_series[boundary] = hour_bar(
            boundary,
            opened=D(70 + index),
            closed=D(9999),
            quote_volume=D(999_999_999),
        )
        formation = sut.hour_key(target_day, 1)
        symbol_series[formation] = hour_bar(
            formation,
            opened=D(7777),
            closed=D(8888),
            quote_volume=D(999_999_999),
        )
        for hour in range(2, 11):
            key = sut.hour_key(target_day, hour)
            opened = D(100)
            closed = D(100)
            if hour == 6:
                opened = D(110) if index < 3 else D(90) if index >= 27 else D(100)
                closed = D(400) if index < 3 else D(25) if index >= 27 else D(100)
            if hour == 10:
                opened = D(120) if index < 3 else D(80) if index >= 27 else D(100)
                closed = D(900) if index < 3 else D(10) if index >= 27 else D(100)
            symbol_series[key] = hour_bar(
                key,
                opened=opened,
                closed=closed,
                quote_volume=D(999_999_999),
            )
        series[symbol] = symbol_series
    return symbols, series


def replace_bar(
    series: dict[str, dict[datetime, sut.HourBar]],
    symbol: str,
    key: datetime,
    **changes: Decimal | int,
) -> None:
    original = series[symbol][key]
    values: dict[str, Any] = {
        "opened_at": original.opened_at,
        "open": original.open,
        "high": original.high,
        "low": original.low,
        "close": original.close,
        "quote_volume": original.quote_volume,
        "trades": original.trades,
    }
    values.update(changes)
    series[symbol][key] = sut.HourBar(**values)


def scenario_by_id(
    outcome: sut.DayOutcome,
    scenario_id: str,
) -> Decimal:
    return outcome.scenario_returns[scenario_id]


def pbo_evaluation(
    trial_id: str,
    monthly_returns: tuple[Decimal, ...],
) -> sut.TrialEvaluation:
    months = (
        date(2025, 7, 1),
        date(2025, 8, 1),
        date(2025, 9, 1),
        date(2025, 10, 1),
        date(2025, 11, 1),
        date(2025, 12, 1),
        date(2026, 1, 1),
        date(2026, 2, 1),
    )
    outcomes = tuple(
        sut.DayOutcome(
            day=day,
            active=False,
            cash_reason="SYNTHETIC_TEST_ROW",
            longs=(),
            shorts=(),
            gross_return=D(0),
            scenario_returns={"public_stress": value},
            capacity_proxy_usd=None,
            mark_returns={"public_stress": ()},
        )
        for day, value in zip(months, monthly_returns, strict=True)
    )
    accumulator = sut.ScenarioAccumulator(scenario=sut.CostScenario("public_stress", D(0), D(0)))
    accumulator.daily_returns.extend(monthly_returns)
    return sut.TrialEvaluation(
        spec=sut.TrialSpec(trial_id, 3, 6),
        scheduled_days=8,
        active_days=0,
        cash_days=8,
        distinct_symbols=(),
        capacities=(),
        days=outcomes,
        scenarios={"public_stress": accumulator},
    )


def test_daily_archive_accepts_exact_microsecond_grid_and_checksum(
    tmp_path: Path,
) -> None:
    zip_path, checksum_path = write_archive_pair(
        tmp_path,
        interval="1d",
        rows=archive_rows("1d", "2025-02", with_header=True),
    )

    bars = sut.parse_daily_archive(
        zip_path,
        checksum_path,
        symbol="AAAUSDT",
        month="2025-02",
    )

    assert len(bars) == 28
    assert bars[0].day == date(2025, 2, 1)
    assert bars[-1].day == date(2025, 2, 28)
    assert bars[-1].quote_volume == D(1_000_027)


def test_hour_archive_accepts_exact_microsecond_grid_and_checksum(
    tmp_path: Path,
) -> None:
    zip_path, checksum_path = write_archive_pair(tmp_path)

    bars = sut.parse_hour_archive(
        zip_path,
        checksum_path,
        symbol="AAAUSDT",
        month="2025-02",
    )

    assert len(bars) == 28 * 24
    assert bars[0].opened_at == datetime(2025, 2, 1, tzinfo=UTC)
    assert bars[-1].opened_at == datetime(2025, 2, 28, 23, tzinfo=UTC)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda rows: rows.__setitem__(0, rows[0][:-1]), "hourly column count"),
        (
            lambda rows: rows[0].__setitem__(
                0,
                str(int(rows[0][0]) // 1000),
            ),
            "hourly time grid",
        ),
        (lambda rows: rows[0].__setitem__(2, "99"), "hourly economic domain"),
    ],
)
def test_hour_archive_rejects_schema_time_and_domain_drift(
    tmp_path: Path,
    mutation: Callable[[list[list[str]]], None],
    message: str,
) -> None:
    rows = archive_rows("1h", "2025-02")
    mutation(rows)
    zip_path, checksum_path = write_archive_pair(tmp_path, rows=rows)

    with pytest.raises(sut.EvidenceError, match=message):
        sut.parse_hour_archive(
            zip_path,
            checksum_path,
            symbol="AAAUSDT",
            month="2025-02",
        )


def test_hour_archive_accepts_sparse_unique_aligned_rows(
    tmp_path: Path,
) -> None:
    rows = archive_rows("1h", "2025-02")
    expected_open_times = [
        int(row[0])
        for index, row in enumerate(rows)
        if index not in {0, 1, 125, 400, len(rows) - 1}
    ]
    sparse_rows = [
        row for index, row in enumerate(rows) if index not in {0, 1, 125, 400, len(rows) - 1}
    ]
    zip_path, checksum_path = write_archive_pair(tmp_path, rows=sparse_rows)

    bars = sut.parse_hour_archive(
        zip_path,
        checksum_path,
        symbol="AAAUSDT",
        month="2025-02",
    )

    assert [sut.timestamp_microseconds(bar.opened_at) for bar in bars] == expected_open_times


@pytest.mark.parametrize(
    "rows",
    [
        [],
        [*archive_rows("1h", "2025-02")[:2], archive_rows("1h", "2025-02")[1]],
        list(reversed(archive_rows("1h", "2025-02")[:2])),
    ],
)
def test_hour_archive_rejects_empty_duplicate_or_unsorted_rows(
    tmp_path: Path,
    rows: list[list[str]],
) -> None:
    zip_path, checksum_path = write_archive_pair(tmp_path, rows=rows)

    with pytest.raises(sut.EvidenceError, match=r"hourly (row count domain|time grid)"):
        sut.parse_hour_archive(
            zip_path,
            checksum_path,
            symbol="AAAUSDT",
            month="2025-02",
        )


def test_archive_rejects_checksum_filename_digest_and_member_drift(
    tmp_path: Path,
) -> None:
    zip_path, checksum_path = write_archive_pair(tmp_path)
    checksum_path.write_text(f"{'0' * 64}  {zip_path.name}\n", encoding="ascii")
    with pytest.raises(sut.EvidenceError, match="official checksum mismatch"):
        sut.parse_hour_archive(
            zip_path,
            checksum_path,
            symbol="AAAUSDT",
            month="2025-02",
        )

    checksum_path.write_text(
        f"{hashlib.sha256(zip_path.read_bytes()).hexdigest()}  other.zip\n",
        encoding="ascii",
    )
    with pytest.raises(sut.EvidenceError, match="checksum content mismatch"):
        sut.verify_pair(zip_path, checksum_path)

    other_directory = tmp_path / "wrong-member"
    other_directory.mkdir()
    wrong_zip, wrong_checksum = write_archive_pair(
        other_directory,
        member_name="wrong.csv",
    )
    with pytest.raises(sut.EvidenceError, match="unsafe or unexpected archive member"):
        sut.parse_hour_archive(
            wrong_zip,
            wrong_checksum,
            symbol="AAAUSDT",
            month="2025-02",
        )

    extra_directory = tmp_path / "extra-member"
    extra_directory.mkdir()
    extra_zip, extra_checksum = write_archive_pair(
        extra_directory,
        extra_member=True,
    )
    with pytest.raises(sut.EvidenceError, match="exactly one member"):
        sut.parse_hour_archive(
            extra_zip,
            extra_checksum,
            symbol="AAAUSDT",
            month="2025-02",
        )


def test_archive_rejects_symlink_member() -> None:
    raw = archive_bytes(
        "AAAUSDT-1h-2025-02.csv",
        archive_rows("1h", "2025-02"),
        external_attr=0o120777 << 16,
    )

    with pytest.raises(sut.EvidenceError, match="symlink archive member"):
        sut.single_zip_member(raw, "AAAUSDT-1h-2025-02.csv")


def test_evaluator_uses_causal_gap_then_fixed_02_entry_and_06_or_10_exit() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)

    six_hour = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        target_day,
    )
    ten_hour = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X10", 3, 10),
        target_day,
    )

    assert six_hour.active is True
    assert six_hour.longs == ("S00USDT", "S01USDT", "S02USDT")
    assert six_hour.shorts == ("S27USDT", "S28USDT", "S29USDT")
    assert six_hour.gross_return == D("0.1")
    assert ten_hour.gross_return == D("0.2")
    assert six_hour.mark_returns["gross"][0][0] == sut.hour_key(target_day, 2)
    assert six_hour.mark_returns["gross"][-1][0] == sut.hour_key(target_day, 6)
    assert ten_hour.mark_returns["gross"][-1][0] == sut.hour_key(target_day, 10)


def test_evaluator_ranks_only_boundary_open_over_prior_23_close() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)
    formation_key = sut.hour_key(target_day, 1)
    entry_key = sut.hour_key(target_day, 2)
    for index, symbol in enumerate(symbols):
        # Reverse both the unused formation values and entry cross-section.
        replace_bar(
            series,
            symbol,
            formation_key,
            open=D(10_000 - index),
            close=D(20_000 - index),
            high=D(20_000 - index),
            low=D(10_000 - index),
        )
        replace_bar(
            series,
            symbol,
            entry_key,
            open=D(500 - index),
            high=D(500 - index),
            low=D(500 - index),
            close=D(500 - index),
        )

    outcome = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        target_day,
    )

    assert outcome.longs == ("S00USDT", "S01USDT", "S02USDT")
    assert outcome.shorts == ("S27USDT", "S28USDT", "S29USDT")


def test_exact_k_by_k_or_cash_on_tail_boundary_tie() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)
    boundary_key = sut.hour_key(target_day, 0)
    replace_bar(
        series,
        "S03USDT",
        boundary_key,
        open=D(72),
        high=D(9999),
        low=D(72),
    )

    outcome = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        target_day,
    )

    assert outcome.active is False
    assert outcome.cash_reason == "ATOMIC_BOUNDARY_TIE"
    assert outcome.longs == ()
    assert outcome.shorts == ()
    assert all(value == 0 for value in outcome.scenario_returns.values())


def test_missing_any_universe_signal_clock_makes_whole_day_cash() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)
    del series["S15USDT"][sut.hour_key(target_day, 0)]

    outcome = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        target_day,
    )

    assert outcome.active is False
    assert outcome.cash_reason == "FROZEN_UNIVERSE_SIGNAL_CLOCK_INCOMPLETE"


def test_formation_at_01_after_boundary_close_needs_no_separate_01_bar() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)
    formation_bar_key = sut.hour_key(target_day, 1)
    for symbol in symbols:
        del series[symbol][formation_bar_key]

    outcome = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        target_day,
    )

    assert outcome.active is True
    assert outcome.longs == ("S00USDT", "S01USDT", "S02USDT")
    assert outcome.shorts == ("S27USDT", "S28USDT", "S29USDT")


@pytest.mark.parametrize(
    ("missing_hour", "message"),
    [
        (2, "selected entry or exit missing"),
        (6, "selected entry or exit missing"),
        (4, "selected hourly mark missing"),
    ],
)
def test_missing_selected_entry_exit_or_mark_is_terminal(
    missing_hour: int,
    message: str,
) -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)
    del series["S00USDT"][sut.hour_key(target_day, missing_hour)]

    with pytest.raises(sut.EvidenceError, match=message):
        sut.evaluate_day(
            series,
            symbols,
            sut.TrialSpec("K03_X06", 3, 6),
            target_day,
        )


def test_public_cost_scenarios_and_per_1000_identity_are_exact() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)
    evaluation = sut.evaluate_trial(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        (target_day,),
    )
    outcome = evaluation.days[0]

    assert outcome.gross_return == D("0.1")
    assert scenario_by_id(outcome, "gross") == D("0.1")
    assert scenario_by_id(outcome, "public_base") == D("0.096")
    assert scenario_by_id(outcome, "public_stress") == D("0.093")
    assert scenario_by_id(outcome, "fee_stress") == D("0.091")

    base = evaluation.scenario("public_base").as_mapping()
    assert base["startNavUsd"] == "1000"
    assert base["endNavUsd"] == "1096"
    assert base["grossPriceMoveUsd"] == "100"
    assert base["publicFeeUsd"] == "2"
    assert base["adverseExecutionUsd"] == "2"
    assert base["netUsdPerInitial1000"] == "96"
    assert base["identityResidualUsd"] == "0"
    assert base["borrowCostUsd"] is None
    assert base["accountEffectiveNetUsdPerInitial1000"] is None


def test_capacity_uses_only_prior_complete_day_quote_volume() -> None:
    target_day = date(2025, 7, 2)
    symbols, series = synthetic_series(target_day=target_day)

    outcome = sut.evaluate_day(
        series,
        symbols,
        sut.TrialSpec("K03_X06", 3, 6),
        target_day,
    )

    # 2 sides * K=3 * (24 prior hours * 1,000 quote volume) * 1 bp.
    assert outcome.capacity_proxy_usd == D("14.4")


def test_bootstrap_seed_is_deterministic_and_input_order_matters() -> None:
    returns = tuple(D(item) for item in ("0.01", "-0.02", "0.03", "0", "0.015"))

    first = sut.bootstrap_terminal_distribution(
        returns,
        block_length=2,
        replicates=128,
        seed=12345,
    )
    second = sut.bootstrap_terminal_distribution(
        returns,
        block_length=2,
        replicates=128,
        seed=12345,
    )
    other_seed = sut.bootstrap_terminal_distribution(
        returns,
        block_length=2,
        replicates=128,
        seed=54321,
    )

    assert first == second
    assert first != other_seed
    assert sut.stable_seed(10, "trial") == sut.stable_seed(10, "trial")
    assert sut.stable_seed(10, "trial") != sut.stable_seed(10, "other")


def test_holm_adjustment_is_monotone_and_family_wide() -> None:
    raw = {
        "K03_X06": 0.001,
        "K03_X10": 0.01,
        "K05_X06": 0.02,
        "K05_X10": 0.03,
        "K08_X06": 0.04,
        "K08_X10": 0.2,
    }

    adjusted = sut.holm_adjust(raw, 0.05)

    ordered = sorted(raw, key=lambda trial_id: raw[trial_id])
    adjusted_values: list[float] = []
    for trial_id in ordered:
        adjusted_value = adjusted[trial_id]["adjustedP"]
        assert isinstance(adjusted_value, float)
        adjusted_values.append(adjusted_value)
    assert adjusted_values == sorted(adjusted_values)
    assert adjusted["K03_X06"] == {
        "rawP": 0.001,
        "adjustedP": 0.006,
        "passed": True,
    }
    assert adjusted["K08_X10"]["passed"] is False
    assert set(adjusted) == set(raw)


def test_pbo_is_deterministic_70_split_diagnostic_only() -> None:
    evaluations = tuple(
        pbo_evaluation(
            spec.trial_id,
            tuple(D(index + month + 1) / D(10_000) for month in range(8)),
        )
        for index, spec in enumerate(sut.trial_specs())
    )

    first = sut.pbo_cscv(evaluations)
    second = sut.pbo_cscv(evaluations)

    assert first == second
    assert first["blocks"] == 8
    assert first["inSampleBlocks"] == 4
    assert first["splits"] == 70
    rows = first["rows"]
    pbo = first["pbo"]
    assert isinstance(rows, list)
    assert isinstance(pbo, float)
    assert len(rows) == 70
    assert first["role"] == "DIAGNOSTIC_ONLY_NOT_SELECTOR_PVALUE_LCB_OR_VERDICT_OVERRIDE"
    assert 0 <= pbo <= 1


def test_exclusive_marker_is_canonical_durable_and_cannot_be_rewritten(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "marker.v1.json"
    sut.write_exclusive_json(marker, {"z": 1, "a": 2})

    assert marker.read_bytes() == b'{"a":2,"z":1}\n'
    assert marker.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        sut.write_exclusive_json(marker, {"replacement": True})
    assert json.loads(marker.read_text()) == {"a": 2, "z": 1}


def test_exclusive_marker_survives_fsync_failure_and_consumes_name(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker = tmp_path / "marker.v1.json"

    def fail_fsync(_descriptor: int) -> None:
        raise OSError("synthetic fsync failure")

    monkeypatch.setattr(os, "fsync", fail_fsync)
    with pytest.raises(OSError, match="synthetic fsync failure"):
        sut.write_exclusive_json(marker, {"ordinal": 1})

    assert marker.exists()
    assert marker.stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        sut.write_exclusive_json(marker, {"ordinal": 2})


def test_canonical_json_rejects_nonfinite_floats(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Out of range float values"):
        sut.canonical_bytes({"invalid": float("nan")})
    invalid = tmp_path / "invalid.json"
    invalid.write_text('{"invalid":NaN}\n', encoding="utf-8")
    with pytest.raises(sut.EvidenceError, match="nonfinite JSON constant"):
        sut.load_json(invalid)


@pytest.mark.parametrize(
    "relative",
    [
        "../outside.bin",
        "nested/../../outside.bin",
        "/absolute.bin",
    ],
)
def test_safe_relative_path_rejects_traversal_and_absolute_paths(
    tmp_path: Path,
    relative: str,
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    (tmp_path / "outside.bin").write_bytes(b"outside")

    with pytest.raises(sut.EvidenceError, match="unsafe manifest relative path"):
        sut.safe_relative_path(root, relative)


def test_safe_relative_path_accepts_physical_file_and_rejects_symlink(
    tmp_path: Path,
) -> None:
    root = tmp_path / "root"
    root.mkdir()
    physical = root / "physical.bin"
    physical.write_bytes(b"evidence")
    symlink = root / "symlink.bin"
    symlink.symlink_to(physical)

    assert sut.safe_relative_path(root, "physical.bin") == physical
    with pytest.raises(sut.EvidenceError, match="manifest path contains symlink"):
        sut.safe_relative_path(root, "symlink.bin")


def test_ensure_physical_directory_rejects_symlink_component(
    tmp_path: Path,
) -> None:
    root = tmp_path / "state"
    root.mkdir(mode=0o700)
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "archives").symlink_to(outside, target_is_directory=True)

    with pytest.raises(sut.EvidenceError, match="directory path contains symlink"):
        sut.ensure_physical_directory(root, Path("archives/AAAUSDT/2025-02"))
    with pytest.raises(sut.EvidenceError, match="unsafe directory path"):
        sut.ensure_physical_directory(root, Path("../outside"))

    assert not (outside / "AAAUSDT").exists()


def test_acquire_pair_freezes_receipt_and_manifest_row_provenance_without_opening_member(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_root = tmp_path / "state"
    state_root.mkdir(mode=0o700)
    zip_name = "AAAUSDT-1h-2025-02.zip"
    zip_raw = archive_bytes(
        "AAAUSDT-1h-2025-02.csv",
        archive_rows("1h", "2025-02"),
    )
    zip_digest = hashlib.sha256(zip_raw).hexdigest()
    checksum_raw = f"{zip_digest}  {zip_name}\n".encode("ascii")
    zip_headers = {
        "etag": '"zip-etag"',
        "lastModified": "Mon, 03 Mar 2025 00:00:00 GMT",
        "contentLength": str(len(zip_raw)),
    }
    checksum_headers = {
        "etag": '"checksum-etag"',
        "lastModified": "Mon, 03 Mar 2025 00:00:01 GMT",
        "contentLength": str(len(checksum_raw)),
    }
    calls: list[str] = []

    def synthetic_request(
        url: str,
        *,
        attempts: int = 4,
    ) -> tuple[bytes, dict[str, str]]:
        assert attempts == 4
        calls.append(url)
        if url.endswith(".CHECKSUM"):
            return checksum_raw, checksum_headers
        return zip_raw, zip_headers

    monkeypatch.setattr(sut, "request_bytes", synthetic_request)
    row = sut.acquire_pair(state_root, "AAAUSDT", "2025-02")

    assert calls == [
        f"{sut.ARCHIVE_BASE}/AAAUSDT/1h/{zip_name}.CHECKSUM",
        f"{sut.ARCHIVE_BASE}/AAAUSDT/1h/{zip_name}",
    ]
    receipt_path = state_root / "archives/AAAUSDT/2025-02/receipt.v1.json"
    receipt = sut.load_json(receipt_path)
    assert receipt == {
        "schema": "cosmos.quant.research.s2h.source_pair_receipt.v1",
        "symbol": "AAAUSDT",
        "month": "2025-02",
        "interval": "1h",
        "zipUrl": f"{sut.ARCHIVE_BASE}/AAAUSDT/1h/{zip_name}",
        "checksumUrl": f"{sut.ARCHIVE_BASE}/AAAUSDT/1h/{zip_name}.CHECKSUM",
        "zipSha256": zip_digest,
        "checksumSha256": hashlib.sha256(checksum_raw).hexdigest(),
        "zipBytes": len(zip_raw),
        "checksumBytes": len(checksum_raw),
        "zipHeaders": zip_headers,
        "checksumHeaders": checksum_headers,
        "acquiredAtUtc": receipt["acquiredAtUtc"],
        "archiveMemberOpened": False,
    }
    assert row["receiptRelativePath"] == "archives/AAAUSDT/2025-02/receipt.v1.json"
    assert row["receiptSha256"] == sut.sha256_path(receipt_path)
    assert row["zipHeaders"] == zip_headers
    assert row["checksumHeaders"] == checksum_headers
    assert row["acquiredAtUtc"] == receipt["acquiredAtUtc"]
    assert row["archiveMemberOpened"] is False

    def reject_reacquisition(
        _url: str,
        *,
        attempts: int = 4,
    ) -> tuple[bytes, dict[str, str]]:
        raise AssertionError(f"cached acquisition called network with attempts={attempts}")

    monkeypatch.setattr(sut, "request_bytes", reject_reacquisition)
    assert sut.acquire_pair(state_root, "AAAUSDT", "2025-02") == row


def test_trial_family_is_exactly_six_frozen_k_by_exit_combinations() -> None:
    assert [(spec.trial_id, spec.tail_size, spec.exit_hour) for spec in sut.trial_specs()] == [
        ("K03_X06", 3, 6),
        ("K03_X10", 3, 10),
        ("K05_X06", 5, 6),
        ("K05_X10", 5, 10),
        ("K08_X06", 8, 6),
        ("K08_X10", 8, 10),
    ]
    assert {
        scenario.scenario_id: scenario.total_return_cost for scenario in sut.cost_scenarios()
    } == {
        "gross": D("0"),
        "public_base": D("0.004"),
        "public_stress": D("0.007"),
        "fee_stress": D("0.009"),
    }


def test_request_bytes_cannot_escape_network_closed_fixture() -> None:
    with pytest.raises(AssertionError, match="network access is forbidden"):
        sut.request_bytes("https://example.invalid/evidence", attempts=1)


def test_no_test_helper_touches_real_lifecycle_paths() -> None:
    """Guard this suite's own scope: all lifecycle paths remain package-owned."""

    lifecycle_paths: Iterator[Path] = iter(
        (
            sut.SCREEN_MARKER_PATH,
            sut.UNIVERSE_PATH,
            sut.SOURCE_MANIFEST_PATH,
            sut.FREEZE_PATH,
            sut.RUN_MARKER_PATH,
            sut.DEVELOPMENT_PATH,
            sut.SELECTION_PATH,
            sut.HOLDOUT_OPEN_PATH,
            sut.HOLDOUT_PATH,
            sut.RESULT_PATH,
        )
    )
    assert all(path.parent == sut.HERE for path in lifecycle_paths)
    assert os.environ.get("S2H_ALLOW_REAL_SOURCE_TESTS") is None
