"""Focused deterministic proofs for the frozen S-2K mechanics."""

from __future__ import annotations

import hashlib
import io
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import pytest
import research.s2k.experiment as s2k
from research.s2k.experiment import (
    GIT_OBJECT_ID_PATTERN,
    Bar,
    DayEvaluation,
    EvidenceError,
    Leg,
    Scenario,
    aggregate_capacity_proxy,
    average_ranks,
    bootstrap_family,
    evaluate_signal_day,
    exclusive_write,
    holm_adjust,
    leg_components,
    parse_archive,
    parse_checksum_sidecar,
    parse_microsecond_timestamp,
    realized_skewness,
    spearman,
    verify_sha256sums,
)


def test_microsecond_timestamp_rejects_milliseconds_and_misalignment() -> None:
    aligned = parse_microsecond_timestamp("1735689600000000", field="open")
    assert aligned == datetime(2025, 1, 1, tzinfo=UTC)
    with pytest.raises(EvidenceError):
        parse_microsecond_timestamp("1735689600000", field="open")
    with pytest.raises(EvidenceError):
        parse_microsecond_timestamp("1735689600000001", field="open")


def test_git_object_id_grammar_accepts_sha1_and_sha256() -> None:
    assert GIT_OBJECT_ID_PATTERN.fullmatch("a" * 40)
    assert GIT_OBJECT_ID_PATTERN.fullmatch("b" * 64)
    assert GIT_OBJECT_ID_PATTERN.fullmatch("c" * 41) is None


def test_checksum_sidecar_is_identity_bound() -> None:
    digest = "a" * 64
    assert (
        parse_checksum_sidecar(
            f"{digest}  BTCUSDT-5m-2025-01.zip\n".encode("ascii"),
            "BTCUSDT-5m-2025-01.zip",
        )
        == digest
    )
    with pytest.raises(EvidenceError):
        parse_checksum_sidecar(
            f"{digest}  ETHUSDT-5m-2025-01.zip\n".encode("ascii"),
            "BTCUSDT-5m-2025-01.zip",
        )


def test_realized_skewness_uses_prior_close_and_all_288_returns() -> None:
    signal_date = date(2025, 7, 2)
    start = datetime(2025, 7, 2, tzinfo=UTC)
    bars: dict[datetime, Bar] = {}
    previous = Decimal("100")
    bars[start - timedelta(minutes=5)] = Bar(
        start - timedelta(minutes=5),
        previous,
        previous,
        Decimal(1),
        previous,
    )
    close = previous
    for index in range(288):
        multiplier = Decimal("1.001") if index < 287 else Decimal("0.75")
        close *= multiplier
        timestamp = start + timedelta(minutes=5 * index)
        bars[timestamp] = Bar(
            timestamp,
            close,
            close,
            Decimal(1),
            close,
        )
    value = realized_skewness(bars, signal_date, 288)
    assert value is not None
    assert value < Decimal("-10")
    del bars[start + timedelta(minutes=5 * 12)]
    assert realized_skewness(bars, signal_date, 288) is None


def test_average_ranks_and_spearman_preserve_ties() -> None:
    ranks = average_ranks({"A": Decimal(1), "B": Decimal(1), "C": Decimal(3), "D": Decimal(4)})
    assert ranks == {
        "A": Decimal("1.5"),
        "B": Decimal("1.5"),
        "C": Decimal(3),
        "D": Decimal(4),
    }
    correlation = spearman(
        {"A": Decimal(1), "B": Decimal(2), "C": Decimal(3)},
        {"A": Decimal(3), "B": Decimal(2), "C": Decimal(1)},
    )
    assert correlation == Decimal(-1)


def test_costs_are_two_sided_and_monotone_for_flat_prices() -> None:
    leg = Leg(
        symbol="BTCUSDT",
        direction=1,
        notional=Decimal(125),
        entry_reference=Decimal(100),
        exit_reference=Decimal(100),
        entry_quote_volume=Decimal(1_000_000),
        exit_quote_volume=Decimal(1_000_000),
    )
    gross = leg_components(leg, Scenario("gross", Decimal(0), Decimal(0)))[0]
    base = leg_components(leg, Scenario("base", Decimal(10), Decimal(2)))[0]
    stress = leg_components(leg, Scenario("stress", Decimal(10), Decimal(5)))[0]
    assert gross == 0
    assert base < gross
    assert stress < base


def test_equal_reference_notionals_are_dollar_neutral_before_costs() -> None:
    scenario = Scenario("gross", Decimal(0), Decimal(0))
    shared = {
        "notional": Decimal(125),
        "entry_reference": Decimal(100),
        "exit_reference": Decimal(110),
        "entry_quote_volume": Decimal(1_000_000),
        "exit_quote_volume": Decimal(1_000_000),
    }
    long_leg = Leg(symbol="LONGUSDT", direction=1, **shared)
    short_leg = Leg(symbol="SHORTUSDT", direction=-1, **shared)
    assert leg_components(long_leg, scenario)[0] == Decimal("12.5")
    assert leg_components(short_leg, scenario)[0] == Decimal("-12.5")
    assert leg_components(long_leg, scenario)[0] + leg_components(short_leg, scenario)[0] == 0


def test_seeded_block_bootstrap_and_holm_are_deterministic() -> None:
    primary = tuple(Decimal(index - 2) for index in range(7))
    secondary = tuple(Decimal(index) / Decimal(10) for index in range(7))
    first = bootstrap_family(primary, secondary, replicates=64, seed=99, block_length=3)
    second = bootstrap_family(primary, secondary, replicates=64, seed=99, block_length=3)
    assert first == second
    adjusted = holm_adjust({"primary": Fraction(1, 100), "secondary": Fraction(4, 100)})
    assert adjusted == {
        "primary": Fraction(2, 100),
        "secondary": Fraction(4, 100),
    }


def test_archive_member_schema_and_microseconds_are_verified(tmp_path: Path) -> None:
    symbol = "BTCUSDT"
    month = "2025-01"
    member_name = f"{symbol}-5m-{month}.csv"
    open_timestamp = 1_735_689_600_000_000
    close_timestamp = open_timestamp + 299_999_999
    row = (f"{open_timestamp},100,101,99,100.5,2,{close_timestamp},201,1,1,100,0\n").encode("ascii")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member_name, row)
    path = tmp_path / f"{symbol}-5m-{month}.zip"
    path.write_bytes(buffer.getvalue())
    bars, member = parse_archive(
        path,
        symbol=symbol,
        month=month,
        expected_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    )
    assert len(bars) == 1
    assert member["timestampUnit"] == "MICROSECONDS"
    assert member["columns"] == 12


def synthetic_cohort() -> tuple[date, tuple[str, ...], dict[str, dict[datetime, Bar]]]:
    """Build a complete small-price cohort with twenty distinct skew scores."""

    signal_date = date(2025, 7, 2)
    signal_start = datetime(2025, 7, 2, tzinfo=UTC)
    entry_timestamp = datetime(2025, 7, 3, 0, 5, tzinfo=UTC)
    exit_timestamp = datetime(2025, 7, 4, 0, 5, tzinfo=UTC)
    symbols = tuple(f"S{index:02d}USDT" for index in range(20))
    cohort: dict[str, dict[datetime, Bar]] = {}
    for symbol_index, symbol in enumerate(symbols):
        bars: dict[datetime, Bar] = {}
        close = Decimal(100 + symbol_index)
        bars[signal_start - timedelta(minutes=5)] = Bar(
            signal_start - timedelta(minutes=5),
            close,
            close,
            Decimal(1),
            close,
        )
        for bar_index in range(288):
            log_return = (
                Decimal("0.0001") if bar_index < 287 else -Decimal(symbol_index + 1) / Decimal(1000)
            )
            close *= log_return.exp()
            timestamp = signal_start + timedelta(minutes=5 * bar_index)
            bars[timestamp] = Bar(
                timestamp,
                close,
                close,
                Decimal(1000),
                close * Decimal(1000),
            )
        cursor = entry_timestamp
        while cursor < exit_timestamp:
            mark = close * (
                Decimal(1)
                + Decimal(symbol_index) / Decimal(10_000)
                + Decimal((cursor - entry_timestamp).seconds) / Decimal(1_000_000_000)
            )
            bars[cursor] = Bar(
                cursor,
                mark,
                mark,
                Decimal(1000),
                mark * Decimal(1000),
            )
            cursor += timedelta(minutes=5)
        exit_price = close * (Decimal(1) + Decimal(symbol_index + 1) / Decimal(1000))
        bars[exit_timestamp] = Bar(
            exit_timestamp,
            exit_price,
            exit_price,
            Decimal(1000),
            exit_price * Decimal(1000),
        )
        cohort[symbol] = bars
    return signal_date, symbols, cohort


def test_pre_entry_missing_is_cash_but_post_entry_missing_is_unmeasured() -> None:
    signal_date, symbols, bars = synthetic_cohort()
    scenarios = (
        Scenario("gross", Decimal(0), Decimal(0)),
        Scenario("publicRegular", Decimal(10), Decimal(0)),
        Scenario("base", Decimal(10), Decimal(2)),
        Scenario("stress", Decimal(10), Decimal(5)),
        Scenario("severe", Decimal(10), Decimal(10)),
    )
    complete = evaluate_signal_day(
        signal_date=signal_date,
        bars_by_symbol=bars,
        symbols=symbols,
        scenarios=scenarios,
        tail_size=4,
        notional_per_leg=Decimal(125),
        bars_per_day=288,
    )
    assert complete.active
    entry_timestamp = datetime(2025, 7, 3, 0, 5, tzinfo=UTC)
    entry_bar = bars[symbols[0]].pop(entry_timestamp)
    pre_entry_missing = evaluate_signal_day(
        signal_date=signal_date,
        bars_by_symbol=bars,
        symbols=symbols,
        scenarios=scenarios,
        tail_size=4,
        notional_per_leg=Decimal(125),
        bars_per_day=288,
    )
    assert not pre_entry_missing.active
    assert pre_entry_missing.cash_reason == f"PRE_ENTRY_BAR_UNAVAILABLE_{symbols[0]}"
    assert pre_entry_missing.rank_ic is None
    bars[symbols[0]][entry_timestamp] = entry_bar
    exit_timestamp = datetime(2025, 7, 4, 0, 5, tzinfo=UTC)
    bars[symbols[0]].pop(exit_timestamp)
    with pytest.raises(EvidenceError, match="post-entry exit"):
        evaluate_signal_day(
            signal_date=signal_date,
            bars_by_symbol=bars,
            symbols=symbols,
            scenarios=scenarios,
            tail_size=4,
            notional_per_leg=Decimal(125),
            bars_per_day=288,
        )


def test_capacity_aggregates_shared_transition_bar_by_symbol() -> None:
    timestamp = datetime(2025, 7, 4, 0, 5, tzinfo=UTC)

    def row(signal_date: date, weight: Decimal) -> DayEvaluation:
        return DayEvaluation(
            signal_date=signal_date,
            signal_valid=True,
            active=True,
            cash_reason=None,
            low_symbols=("BTCUSDT",),
            high_symbols=(),
            scenario_pnl={"base": Decimal(0)},
            decompositions={},
            rank_ic=Decimal(0),
            capacity_events={
                (timestamp, "BTCUSDT"): (weight, Decimal(100_000)),
                (timestamp, "ETHUSDT"): (Decimal("0.05"), Decimal(1_000_000)),
            },
            mark_pnl={"base": ()},
        )

    packet = aggregate_capacity_proxy(
        (
            row(date(2025, 7, 2), Decimal("0.15")),
            row(date(2025, 7, 3), Decimal("0.125")),
        ),
        participation_bps=Decimal(1),
        target_capital_usd=Decimal(1000),
    )
    assert packet["executionTimestampObservationCount"] == 1
    assert packet["symbolExecutionPairCount"] == 2
    assert packet["maximumAggregateAbsoluteWeight"] == "0.275"
    assert packet["minimumUsd"] == "36.36363636"


def test_exclusive_marker_write_refuses_replay(tmp_path: Path) -> None:
    marker = tmp_path / "RUN_STARTED.v1.json"
    exclusive_write(marker, b'{"ordinal":1}\n')
    with pytest.raises(FileExistsError):
        exclusive_write(marker, b'{"ordinal":2}\n')
    assert marker.read_bytes() == b'{"ordinal":1}\n'


def test_checksum_verifier_rejects_uncovered_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    artifact = tmp_path / "result.v1.json"
    artifact.write_bytes(b"{}\n")
    (tmp_path / "SHA256SUMS").write_text(
        f"{hashlib.sha256(artifact.read_bytes()).hexdigest()}  {artifact.name}\n",
        encoding="ascii",
    )
    (tmp_path / "unexpected").mkdir()
    monkeypatch.setattr(s2k, "PACKAGE_DIR", tmp_path)
    with pytest.raises(EvidenceError, match="unexpected terminal packet directory"):
        verify_sha256sums()
