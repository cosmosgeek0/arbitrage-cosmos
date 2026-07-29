from __future__ import annotations

import hashlib
import json
import zipfile
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg15 import experiment as vg15


def _timestamp_us(day: date) -> int:
    opened = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return int(opened.timestamp()) * 1_000_000


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: str = "100",
    quote_volume: str = "10",
) -> vg15.Bar:
    opened = _timestamp_us(day)
    price = Decimal(open_price)
    return vg15.Bar(
        symbol=symbol,
        day=day,
        open=price,
        high=price + Decimal(1),
        low=price - Decimal(1),
        close=price,
        base_volume=Decimal(1),
        quote_volume=Decimal(quote_volume),
        open_time_us=opened,
        close_time_us=opened + 86_400_000_000 - 1,
    )


def _cohort_bars(start: date, end_exclusive: date) -> dict[str, dict[date, vg15.Bar]]:
    return {
        symbol: {day: _bar(symbol, day) for day in vg15.date_range(start, end_exclusive)}
        for symbol in vg15.COHORT
    }


def _scenario(
    days: tuple[date, ...],
    values: tuple[Decimal, ...],
    *,
    capacities: tuple[Decimal, ...] = (),
) -> vg15.ScenarioPath:
    equity = [vg15.STARTING_NOTIONAL_USD]
    for value in values:
        equity.append(equity[-1] * (Decimal(1) + value))
    return vg15.ScenarioPath(
        ending_days=days,
        daily_returns=values,
        equity_at_open=tuple(equity),
        transition_legs=len(capacities),
        on_days=len(values),
        off_days=0,
        transition_capacity_proxy_usd=capacities,
    )


def _evaluation(
    trial: vg15.Trial,
    days: tuple[date, ...],
    value: Decimal,
) -> vg15.DevelopmentEvaluation:
    returns = tuple(value for _day in days)
    scenario = _scenario(days, returns)
    paths = vg15.TrialPaths(
        trial=trial,
        gross=scenario,
        base=scenario,
        stress=scenario,
    )
    bootstrap = vg15.BootstrapSummary(
        mean=value,
        one_sided_95_lcb=value,
        two_sided_90_ucb=value,
        one_sided_p_value=Decimal("0.5"),
    )
    return vg15.DevelopmentEvaluation(
        paths=paths,
        bootstrap=bootstrap,
        fold_returns=(value, value, value, value),
        max_drawdown=Decimal(0),
        base_total_return=vg15.compound_return(returns),
        stress_mean=value,
        capacity_proxy_usd=None,
        holm_adjusted_p=Decimal(1),
        gates={},
    )


def _csv_row(
    day: date,
    *,
    open_time_delta_us: int = 0,
    close_time_delta_us: int = 0,
) -> str:
    opened = _timestamp_us(day) + open_time_delta_us
    closed = opened + 86_400_000_000 - 1 + close_time_delta_us
    return f"{opened},100,101,99,100,10,{closed},1000,7,5,500,0"


def _archive_artifact(
    root: Path,
    rows: list[str],
    *,
    symbol: str = "BTCUSDT",
    month: str = "2025-07",
) -> dict[str, object]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1d-{month}.zip"
    zip_path = directory / zip_name
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(
            zip_name.removesuffix(".zip") + ".csv",
            ",".join(vg15.KLINE_HEADER) + "\n" + "\n".join(rows) + "\n",
        )
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_text(f"{zip_sha}  {zip_name}\n", encoding="ascii")
    return {
        "checksumPath": str(checksum_path.relative_to(root)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "symbol": symbol,
        "zipPath": str(zip_path.relative_to(root)),
        "zipSha256": zip_sha,
    }


def test_trial_grid_is_exact_frozen_family_of_twelve() -> None:
    assert tuple(trial.trial_id for trial in vg15.trial_grid()) == (
        "vg15-l20-b5000",
        "vg15-l20-b6000",
        "vg15-l20-b7000",
        "vg15-l20-b8000",
        "vg15-l40-b5000",
        "vg15-l40-b6000",
        "vg15-l40-b7000",
        "vg15-l40-b8000",
        "vg15-l60-b5000",
        "vg15-l60-b6000",
        "vg15-l60-b7000",
        "vg15-l60-b8000",
    )


def test_signal_is_cross_sectional_share_above_each_lagged_baseline() -> None:
    open_day = date(2025, 8, 1)
    bars = _cohort_bars(open_day - timedelta(days=21), open_day + timedelta(days=1))
    for index, symbol in enumerate(vg15.COHORT):
        bars[symbol][open_day - timedelta(days=1)] = _bar(
            symbol,
            open_day - timedelta(days=1),
            quote_volume="11" if index < 6 else "9",
        )
        bars[symbol][open_day] = _bar(symbol, open_day, quote_volume="999999999")
    half = vg15.Trial("half", 20, Decimal("0.50"))
    sixty = vg15.Trial("sixty", 20, Decimal("0.60"))
    assert vg15.target_at_open(bars, half, open_day)
    assert not vg15.target_at_open(bars, sixty, open_day)


def test_causal_baseline_excludes_both_signal_and_open_day() -> None:
    open_day = date(2025, 8, 1)
    bars = _cohort_bars(open_day - timedelta(days=21), open_day + timedelta(days=1))
    trial = vg15.Trial("causal", 20, Decimal("1"))
    for symbol in vg15.COHORT:
        bars[symbol][open_day - timedelta(days=1)] = _bar(
            symbol,
            open_day - timedelta(days=1),
            quote_volume="11",
        )
        bars[symbol][open_day] = _bar(symbol, open_day, quote_volume="0")
    assert vg15.target_at_open(bars, trial, open_day)
    for symbol in vg15.COHORT:
        bars[symbol][open_day] = _bar(symbol, open_day, quote_volume="999999999999")
    assert vg15.target_at_open(bars, trial, open_day)


def test_whole_cohort_units_do_not_rebalance_while_regime_stays_on() -> None:
    first = {symbol: Decimal(100) for symbol in vg15.COHORT}
    later = {symbol: Decimal(200 + index) for index, symbol in enumerate(vg15.COHORT)}
    portfolio = vg15.Portfolio(cash=vg15.STARTING_NOTIONAL_USD)
    assert vg15.transition_at_open(portfolio, True, first, Decimal(0))
    assert portfolio.units is not None
    frozen_units = dict(portfolio.units)
    assert not vg15.transition_at_open(portfolio, True, later, Decimal(0))
    assert portfolio.units == frozen_units
    assert set(portfolio.units) == set(vg15.COHORT)


def test_entry_exit_costs_and_capacity_are_recorded_on_both_transitions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 8, 1)
    bars = _cohort_bars(start, start + timedelta(days=3))
    for symbol in vg15.COHORT:
        bars[symbol][start + timedelta(days=1)] = _bar(
            symbol,
            start + timedelta(days=1),
            open_price="110",
        )
        bars[symbol][start + timedelta(days=2)] = _bar(
            symbol,
            start + timedelta(days=2),
            open_price="110",
        )
    monkeypatch.setattr(vg15, "target_at_open", lambda _bars, _trial, _day: True)
    monkeypatch.setattr(vg15, "capacity_at_open", lambda _bars, _day: Decimal("4321"))
    path = vg15.simulate_scenario(
        bars,
        vg15.Trial("test", 20, Decimal("0.5")),
        start,
        start + timedelta(days=3),
        Decimal("0.02"),
    )
    expected = Decimal(1000) / Decimal("1.02") * Decimal("1.10") * Decimal("0.98")
    assert path.transition_legs == 2
    assert path.transition_capacity_proxy_usd == (Decimal("4321"), Decimal("4321"))
    assert path.equity_at_open[-1] == expected


def test_segment_boundary_forces_final_liquidation_without_final_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 8, 1)
    bars = _cohort_bars(start, start + timedelta(days=4))
    calls: list[date] = []

    def always_on(
        _bars: Mapping[str, Mapping[date, vg15.Bar]],
        _trial: vg15.Trial,
        day: date,
    ) -> bool:
        calls.append(day)
        return True

    monkeypatch.setattr(vg15, "target_at_open", always_on)
    monkeypatch.setattr(vg15, "capacity_at_open", lambda _bars, _day: Decimal("1000"))
    path = vg15.simulate_scenario(
        bars,
        vg15.Trial("test", 20, Decimal("0.5")),
        start,
        start + timedelta(days=4),
        Decimal(0),
    )
    assert calls == list(vg15.date_range(start, start + timedelta(days=4)))
    assert path.transition_legs == 2
    assert path.on_days == 3
    assert path.off_days == 0


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"a" * 64 + b"  TEST.zip\nextra", "invalid grammar"),
        (b"A" * 64 + b"  TEST.zip\n", "invalid grammar"),
        (b"a" * 63 + b"  TEST.zip\n", "invalid grammar"),
        (b"\xff" + b"a" * 64 + b"  TEST.zip\n", "not ASCII"),
    ],
)
def test_checksum_grammar_fails_closed(payload: bytes, message: str) -> None:
    with pytest.raises(vg15.VG15Error, match=message):
        vg15.verify_checksum_text(payload, "TEST.zip", "a" * 64)


def test_timestamp_requires_microseconds_and_exact_utc_midnight() -> None:
    with pytest.raises(vg15.VG15Error, match="microsecond"):
        vg15.parse_timestamp_us("1751328000000", field="openTime")
    value, parsed = vg15.parse_timestamp_us(
        str(_timestamp_us(date(2025, 7, 1))),
        field="openTime",
    )
    assert value == _timestamp_us(date(2025, 7, 1))
    assert parsed == datetime(2025, 7, 1, tzinfo=UTC)


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        (
            [_csv_row(day) for day in vg15.date_range(date(2025, 7, 1), date(2025, 8, 1))][:-1],
            "calendar gap",
        ),
        (
            [_csv_row(day) for day in vg15.date_range(date(2025, 7, 1), date(2025, 8, 1))]
            + [_csv_row(date(2025, 7, 1))],
            "duplicate UTC daily rows",
        ),
        (
            [_csv_row(date(2025, 7, 1), close_time_delta_us=1)]
            + [_csv_row(day) for day in vg15.date_range(date(2025, 7, 2), date(2025, 8, 1))],
            "close boundary",
        ),
        (
            [_csv_row(date(2025, 7, 1), open_time_delta_us=1)]
            + [_csv_row(day) for day in vg15.date_range(date(2025, 7, 2), date(2025, 8, 1))],
            "UTC daily open",
        ),
    ],
)
def test_archive_duplicate_gap_and_daily_boundaries_fail(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    rows: list[str],
    message: str,
) -> None:
    artifact = _archive_artifact(tmp_path, rows)
    monkeypatch.setattr(vg15, "SOURCE_ROOT", tmp_path)
    with pytest.raises(vg15.VG15Error, match=message):
        vg15.parse_archive(artifact)


def test_seeded_centered_circular_bootstrap_is_deterministic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg15, "BOOTSTRAP_REPLICATES", 64)
    monkeypatch.setattr(vg15, "BOOTSTRAP_BLOCK_DAYS", 2)
    returns = tuple(Decimal("0.01") for _index in range(14))
    first = vg15.circular_block_bootstrap(returns, seed=17)
    second = vg15.circular_block_bootstrap(returns, seed=17)
    assert first == second
    assert first.mean == Decimal("0.01")
    assert first.one_sided_95_lcb == Decimal("0.01")
    assert first.one_sided_p_value == Decimal(1) / Decimal(65)


def test_holm_adjustment_is_ordered_monotone_and_bounded() -> None:
    adjusted = vg15.holm_adjusted(
        {
            "second": Decimal("0.02"),
            "third": Decimal("0.20"),
            "first": Decimal("0.01"),
        }
    )
    assert adjusted == {
        "first": Decimal("0.03"),
        "second": Decimal("0.04"),
        "third": Decimal("0.20"),
    }


def test_pbo_is_explicitly_report_only() -> None:
    days = tuple(date.fromisoformat(f"{month}-15") for month in vg15.DEVELOPMENT_MONTHS)
    evaluations = tuple(
        _evaluation(trial, days, Decimal(index + 1) / Decimal("100000"))
        for index, trial in enumerate(vg15.trial_grid())
    )
    report = vg15.cscv_pbo(evaluations)
    assert report["method"] == "CSCV_8_MONTHS_CHOOSE_4_REPORT_ONLY"
    assert report["status"] == "MEASURED_REPORT_ONLY"
    assert report["splitCount"] == 70
    assert Decimal(str(report["pbo"])) >= 0
    assert Decimal(str(report["pbo"])) <= 1


def test_freeze_source_row_authenticates_bytes_without_opening_zip(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zip_path = tmp_path / "BTCUSDT-1d-2025-07.zip"
    zip_path.write_bytes(b"authenticated compressed bytes, deliberately not a ZIP")
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = tmp_path / f"{zip_path.name}.CHECKSUM"
    checksum_path.write_text(f"{digest}  {zip_path.name}\n", encoding="ascii")
    monkeypatch.setattr(
        vg15,
        "expected_archive_paths",
        lambda _symbol, _month: (zip_path, checksum_path),
    )
    monkeypatch.setattr(vg15, "SOURCE_ROOT", tmp_path)

    def forbidden_zip_open(*_args: object, **_kwargs: object) -> zipfile.ZipFile:
        raise AssertionError("freeze boundary opened an archive")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_zip_open)
    row = vg15.source_artifact_row(
        {
            "checksumBytes": checksum_path.stat().st_size,
            "checksumFrozenEtag": "checksum-etag",
            "checksumFrozenLastModified": "now",
            "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
            "month": "2025-07",
            "state": "DOWNLOADED_VERIFIED",
            "symbol": "BTCUSDT",
            "zipBytes": zip_path.stat().st_size,
            "zipFrozenEtag": "zip-etag",
            "zipFrozenLastModified": "now",
            "zipSha256": digest,
        }
    )
    assert row["zipSha256"] == digest


def test_holdout_lifecycle_requires_seal_and_is_single_use(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seal_path = tmp_path / "candidate-seal.v1.json"
    open_path = tmp_path / "holdout-open.v1.json"
    monkeypatch.setattr(vg15, "CANDIDATE_SEAL_PATH", seal_path)
    monkeypatch.setattr(vg15, "HOLDOUT_OPEN_PATH", open_path)
    with pytest.raises(vg15.VG15Error, match="candidate seal"):
        vg15.open_holdout_once({"candidate": {"trialId": "vg15-l20-b5000"}})
    seal_path.write_text(
        json.dumps({"candidate": {"trialId": "vg15-l20-b5000"}}) + "\n",
        encoding="utf-8",
    )
    receipt = vg15.open_holdout_once({"candidate": {"trialId": "vg15-l20-b5000"}})
    assert receipt["reuseCount"] == 1
    assert receipt["state"] == "HOLDOUT_OPENED_ONCE"
    with pytest.raises(vg15.VG15Error, match="already opened"):
        vg15.open_holdout_once({"candidate": {"trialId": "vg15-l20-b5000"}})


def test_development_no_go_keeps_holdout_unopened(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg15, "FREEZE_PATH", tmp_path / "freeze.v1.json")
    monkeypatch.setattr(vg15, "SOURCE_MANIFEST_PATH", tmp_path / "source-manifest.v1.json")
    monkeypatch.setattr(vg15, "PROTOCOL_PATH", tmp_path / "protocol.v1.json")
    monkeypatch.setattr(vg15, "HOLDOUT_OPEN_PATH", tmp_path / "holdout-open.v1.json")
    for path in (vg15.FREEZE_PATH, vg15.SOURCE_MANIFEST_PATH, vg15.PROTOCOL_PATH):
        path.write_text("{}\n", encoding="utf-8")
    days = tuple(date.fromisoformat(f"{month}-15") for month in vg15.DEVELOPMENT_MONTHS)
    evaluation = _evaluation(vg15.trial_grid()[0], days, Decimal("-0.001"))
    result = vg15.development_no_go_result(
        marker_sha="a" * 64,
        source_manifest={"state": "FROZEN"},
        evaluations=(evaluation,),
        pbo={"status": "MEASURED_REPORT_ONLY"},
    )
    holdout = result["holdout"]
    assert isinstance(holdout, dict)
    assert holdout == {
        "archiveBodiesOpened": False,
        "metrics": None,
        "reuseCount": 0,
        "state": "UNOPENED_UNTOUCHED",
    }
    assert not vg15.HOLDOUT_OPEN_PATH.exists()
