from __future__ import annotations

import hashlib
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg21 import experiment as vg21


def _bar(
    current: date,
    *,
    open_price: str = "100",
    close_price: str = "101",
    quote_volume: str = "10000000",
) -> vg21.Bar:
    return vg21.Bar(
        current,
        Decimal(open_price),
        max(Decimal(open_price), Decimal(close_price)) + 1,
        min(Decimal(open_price), Decimal(close_price)) - 1,
        Decimal(close_price),
        Decimal(quote_volume),
    )


def _csv_row(current: date, quote_volume: str = "10000000") -> str:
    opened = int(
        datetime(current.year, current.month, current.day, tzinfo=UTC).timestamp() * 1_000_000
    )
    return f"{opened},100,102,99,101,7,{opened + vg21.DAY_US - 1},{quote_volume},11,3,300,0\n"


def _record(zip_path: Path, symbol: str, month: str) -> vg21.JsonObject:
    raw = zip_path.read_bytes()
    return {
        "symbol": symbol,
        "month": month,
        "zipPath": str(zip_path),
        "zipBytes": len(raw),
        "zipSha256": hashlib.sha256(raw).hexdigest(),
    }


def test_trial_family_is_exactly_the_registered_twelve() -> None:
    values = vg21.trial_family()
    assert len(values) == 12
    assert len({value.trial_id for value in values}) == 12
    assert {value.lookback for value in values} == {30, 60}
    assert {value.top_fraction for value in values} == {
        Decimal("0.10"),
        Decimal("0.20"),
    }
    assert {value.hold_days for value in values} == {1, 3, 5}
    assert values[0].trial_id == "VG21-L30-Q10-H1"
    assert values[-1].trial_id == "VG21-L60-Q20-H5"


def test_canonical_bytes_are_sorted_utf8_and_newline_terminated() -> None:
    raw = vg21.canonical_bytes({"β": 2, "a": 1})
    assert raw == '{"a":1,"β":2}\n'.encode()
    assert vg21.sha256_bytes(raw) == hashlib.sha256(raw).hexdigest()


def test_write_json_once_refuses_overwrite(tmp_path: Path) -> None:
    target = tmp_path / "receipt.json"
    vg21.write_json_once(target, {"state": "FIRST"})
    assert json.loads(target.read_text()) == {"state": "FIRST"}
    with pytest.raises(vg21.ContractError, match="overwrite"):
        vg21.write_json_once(target, {"state": "SECOND"})


def test_sidecar_binds_digest_and_exact_filename() -> None:
    digest = "a" * 64
    name = "BTCUSDT-1d-2026-01.zip"
    vg21.verify_sidecar(f"{digest}  {name}\n".encode(), name, digest)
    with pytest.raises(vg21.ContractError, match="filename"):
        vg21.verify_sidecar(f"{digest}  OTHER.zip\n".encode(), name, digest)
    with pytest.raises(vg21.ContractError, match="advertised"):
        vg21.verify_sidecar(f"{'b' * 64}  {name}\n".encode(), name, digest)


def test_median_excluding_is_leave_one_out_for_odd_and_even_shapes() -> None:
    rows = tuple(
        (Decimal(value), symbol)
        for value, symbol in (("1", "A"), ("2", "B"), ("3", "C"), ("4", "D"))
    )
    positions = {symbol: index for index, (_, symbol) in enumerate(rows)}
    assert vg21.median_excluding(rows, positions, "A") == Decimal("3")
    assert vg21.median_excluding(rows, positions, "B") == Decimal("3")
    assert vg21.median_excluding(rows, positions, "D") == Decimal("2")
    assert vg21.median_excluding(rows, positions, "MISSING") == Decimal("2.5")


def test_archive_parser_accepts_one_complete_microsecond_daily_row(
    tmp_path: Path,
) -> None:
    symbol = "TESTUSDT"
    month = "2026-02"
    target = tmp_path / f"{symbol}-1d-{month}.zip"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(
            f"{symbol}-1d-{month}.csv",
            _csv_row(date(2026, 2, 1)),
        )
    bars, summary = vg21.parse_archive(_record(target, symbol, month))
    assert len(bars) == 1
    assert bars[0].day == date(2026, 2, 1)
    assert bars[0].quote_volume == Decimal("10000000")
    assert summary["validRowCount"] == 1


def test_archive_parser_rejects_identical_daily_duplicate(
    tmp_path: Path,
) -> None:
    symbol = "TESTUSDT"
    month = "2026-02"
    target = tmp_path / f"{symbol}-1d-{month}.zip"
    row = _csv_row(date(2026, 2, 1))
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", row + row)
    with pytest.raises(vg21.MeasurementError, match="DUPLICATE_IDENTICAL"):
        vg21.parse_archive(_record(target, symbol, month))


def test_archive_parser_rejects_conflicting_daily_duplicate(
    tmp_path: Path,
) -> None:
    symbol = "TESTUSDT"
    month = "2026-02"
    target = tmp_path / f"{symbol}-1d-{month}.zip"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(
            f"{symbol}-1d-{month}.csv",
            _csv_row(date(2026, 2, 1), "10000000") + _csv_row(date(2026, 2, 1), "20000000"),
        )
    with pytest.raises(vg21.MeasurementError, match="DUPLICATE_CONFLICTING"):
        vg21.parse_archive(_record(target, symbol, month))


def test_archive_parser_rejects_millisecond_timestamp(
    tmp_path: Path,
) -> None:
    symbol = "TESTUSDT"
    month = "2026-02"
    target = tmp_path / f"{symbol}-1d-{month}.zip"
    opened_ms = 1_769_904_000_000
    row = f"{opened_ms},100,102,99,101,7,{opened_ms + 86_400_000 - 1},10000000,11,3,300,0\n"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", row)
    with pytest.raises(vg21.MeasurementError, match="TIMESTAMP_UNIT_INVALID"):
        vg21.parse_archive(_record(target, symbol, month))


def test_feature_own_surprise_uses_prior_volume_only() -> None:
    end = date(2026, 1, 31)
    start = end - timedelta(days=80)
    series = {current: _bar(current, quote_volume="10000000") for current in vg21.days(start, end)}
    series[end] = _bar(end, quote_volume="20000000")
    engine = vg21.FeatureEngine({"TESTUSDT": series})
    surprise = engine.surprise("TESTUSDT", end)
    assert surprise is not None
    assert abs(surprise - Decimal(2).ln()) < Decimal("1e-40")
    assert engine.surprise("TESTUSDT", start + timedelta(days=59)) is None


def test_factor_is_leave_one_out_and_requires_thirty_others() -> None:
    current = date(2026, 1, 31)
    start = current - timedelta(days=80)
    bars: dict[str, dict[date, vg21.Bar]] = {}
    for index in range(31):
        symbol = f"S{index:02d}USDT"
        rows = {
            day: _bar(
                day,
                quote_volume=str(
                    10_000_000 + index * 1000 + (day - start).days * (index + 1) * 100
                ),
            )
            for day in vg21.days(start, current)
        }
        bars[symbol] = rows
    engine = vg21.FeatureEngine(bars)
    assert engine.factor(current, "S00USDT") is not None
    assert engine.factor(current, "MISSING") is not None
    reduced = vg21.FeatureEngine(dict(list(bars.items())[:30]))
    assert reduced.factor(current, "S00USDT") is None
    assert reduced.factor(current, "MISSING") is not None


def test_trade_cost_scenarios_are_monotone_and_attributed() -> None:
    allocation = Decimal("1000")
    base = vg21.trade_values(
        allocation,
        Decimal("100"),
        Decimal("105"),
        vg21.BASE_ADVERSE,
    )
    stress = vg21.trade_values(
        allocation,
        Decimal("100"),
        Decimal("105"),
        vg21.STRESS_ADVERSE,
    )
    severe = vg21.trade_values(
        allocation,
        Decimal("100"),
        Decimal("105"),
        vg21.SEVERE_ADVERSE,
    )
    assert base[0] > stress[0] > severe[0]
    actual, gross, fee_cost, adverse_cost = base
    assert gross - fee_cost - adverse_cost == actual - allocation
    assert fee_cost > 0
    assert adverse_cost > 0


def test_capacity_uses_thirty_prior_days_and_excludes_information_day() -> None:
    information_day = date(2026, 2, 1)
    rows = {
        information_day - timedelta(days=offset): _bar(
            information_day - timedelta(days=offset),
            quote_volume="10000000",
        )
        for offset in range(30, 0, -1)
    }
    rows[information_day] = _bar(information_day, quote_volume="999999999999")
    assert vg21.trailing_capacity(rows, information_day, Decimal("0.0001")) == Decimal("1000")


def test_bootstrap_is_seeded_and_centered() -> None:
    values = [Decimal(index) / 1000 for index in range(-20, 20)]
    first = vg21.bootstrap_means(values, block_days=5, seed=123, replicates=64)
    second = vg21.bootstrap_means(values, block_days=5, seed=123, replicates=64)
    centered = vg21.bootstrap_means(values, block_days=5, seed=123, replicates=64, centered=True)
    assert first == second
    assert first != centered
    assert first == sorted(first)
    assert vg21.empirical_lower(first) <= statistics_mean(first)


def statistics_mean(values: list[Decimal]) -> Decimal:
    return sum(values, Decimal(0)) / len(values)


def test_plus_one_p_value_never_returns_zero() -> None:
    value = vg21.one_sided_p_value(
        Decimal("100"),
        [Decimal("-1"), Decimal("0"), Decimal("1")],
    )
    assert value == Decimal("0.25")


def test_holm_stops_at_first_failed_step_down_threshold() -> None:
    selected = vg21.holm_selected(
        {
            "A": Decimal("0.001"),
            "B": Decimal("0.03"),
            "C": Decimal("0.04"),
        },
        Decimal("0.05"),
    )
    assert selected == {"A"}


def test_pbo_has_seventy_symmetric_splits_for_eight_blocks() -> None:
    rows = [[Decimal(trial + block) for block in range(8)] for trial in range(12)]
    report = vg21.pbo_cscv(rows)
    assert report["status"] == "AVAILABLE"
    assert report["splitCount"] == 70
    assert Decimal(report["pbo"]) >= 0
    assert Decimal(report["pbo"]) <= 1


def test_null_economics_never_coerces_unmeasured_to_zero() -> None:
    economics = vg21.null_economics()
    assert economics["netUsdPer1000"] is None
    assert economics["pbo"] is None
    assert economics["maxDrawdown"] is None
    assert economics["capacityProxyUsd"] is None
    assert economics["executableCapacity"] == "UNMEASURED"
    costs = economics["costs"]
    assert isinstance(costs, dict)
    assert costs["accountEffectiveFee"] == "UNKNOWN"


def test_profit_share_counts_positive_profit_only() -> None:
    values = [Decimal("5"), Decimal("3"), Decimal("-100"), Decimal("2")]
    assert vg21._profit_share(values, 1) == Decimal("0.5")
    assert vg21._profit_share(values, 2) == Decimal("0.8")


def test_parser_requires_an_explicit_subcommand() -> None:
    with pytest.raises(SystemExit):
        vg21.parser().parse_args([])
