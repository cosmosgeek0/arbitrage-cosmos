"""Focused synthetic proofs for the immutable V-G28 evaluator."""

from __future__ import annotations

import hashlib
import math
import random
import sys
import zipfile
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import cast

import pytest
from research.vg28 import experiment as vg28


def timestamp_us(moment: datetime) -> int:
    """Return exact UTC epoch microseconds."""

    return int(moment.timestamp()) * 1_000_000


def make_bar(
    symbol: str,
    opened_us: int,
    *,
    open_price: str = "100",
    quote_volume: str = "1000000",
) -> vg28.Bar:
    """Create one complete synthetic one-hour kline."""

    price = Decimal(open_price)
    return vg28.Bar(
        symbol=symbol,
        open_time_us=opened_us,
        open=price,
        high=price,
        low=price,
        close=price,
        base_volume=Decimal("1"),
        quote_volume=Decimal(quote_volume),
        close_time_us=opened_us + vg28.HOUR_US - 1,
    )


def full_symbol_bars(
    start_us: int,
    end_us: int,
    *,
    quote_volume: str = "1000000",
) -> dict[str, dict[int, vg28.Bar]]:
    """Create a common full-hour universe grid."""

    return {
        symbol: {
            opened: make_bar(
                symbol,
                opened,
                quote_volume=quote_volume,
            )
            for opened in range(start_us, end_us, vg28.HOUR_US)
        }
        for symbol in vg28.SYMBOLS
    }


def synthetic_path(
    direction: str,
    daily_return: Decimal,
    *,
    days: int = 16,
) -> vg28.ScenarioPath:
    """Build a minimal aligned path for inference/result unit tests."""

    dates = tuple(datetime(2025, 7, day + 1, tzinfo=UTC).date() for day in range(days))
    returns = (daily_return,) * days
    return vg28.ScenarioPath(
        direction=direction,
        fee_per_fill=Decimal(0),
        adverse_per_fill=Decimal(0),
        timeline_us=tuple(range(days)),
        hourly_returns=returns,
        daily_dates=dates,
        daily_returns=returns,
        equity_at_open=(vg28.STARTING_NOTIONAL_USD,) * days,
        cohorts=(),
        symbol_round_trips=0,
        symbol_fills=0,
        capacity_episode_proxies_usd=(),
    )


def test_trial_grid_is_exact_frozen_family_of_twelve() -> None:
    trials = vg28.trial_grid()
    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {(trial.window_hours, trial.threshold_z, trial.hold_hours) for trial in trials} == {
        (window, threshold, hold)
        for window in (1, 2, 4)
        for threshold in (Decimal("1.5"), Decimal("2.5"))
        for hold in (2, 6)
    }


def test_frozen_gate_thresholds_match_protocol() -> None:
    assert vg28.MIN_DEVELOPMENT_EPISODES == 40
    assert vg28.MIN_DEVELOPMENT_ACTIVE_DAYS == 30
    assert vg28.MIN_DEVELOPMENT_ACTIVE_MONTHS == 6
    assert vg28.MIN_HOLDOUT_EPISODES == 20
    assert vg28.MIN_HOLDOUT_ACTIVE_DAYS == 20
    assert vg28.MIN_HOLDOUT_ACTIVE_MONTHS == 3
    assert Decimal("0.15") == vg28.BASE_MAX_DRAWDOWN
    assert Decimal("0.20") == vg28.STRESS_MAX_DRAWDOWN
    assert Decimal("0.10") == vg28.WHITE_P_MAXIMUM
    assert Decimal("0.20") == vg28.PBO_MAXIMUM


def test_diagnostic_champion_stress_tie_breaks_by_id_not_severe() -> None:
    base = synthetic_path("acceleration", Decimal(0))
    comparator = synthetic_path("deceleration", Decimal(0))
    stress = synthetic_path("acceleration", Decimal("0.01"))
    severe_high = synthetic_path("acceleration", Decimal("0.10"))
    severe_low = synthetic_path("acceleration", Decimal("-0.10"))

    def evaluation(trial_id: str, severe: vg28.ScenarioPath) -> vg28.DevelopmentEvaluation:
        paths = vg28.TrialPaths(
            trial=vg28.Trial(trial_id, 1, Decimal("1.5"), 2),
            gross=vg28.SleevePair(base, comparator),
            base=vg28.SleevePair(base, comparator),
            stress=vg28.SleevePair(stress, comparator),
            severe=vg28.SleevePair(severe, comparator),
        )
        return vg28.DevelopmentEvaluation(
            paths=paths,
            absolute_bootstrap=cast(vg28.BootstrapSummary, object()),
            comparator_bootstrap=cast(vg28.BootstrapSummary, object()),
            gates={"all": True},
        )

    chosen = vg28.diagnostic_champion(
        (evaluation("vg28-b", severe_high), evaluation("vg28-a", severe_low))
    )
    assert chosen.paths.trial.trial_id == "vg28-a"


def test_curvature_uses_three_adjacent_completed_windows_only() -> None:
    signal = timestamp_us(datetime(2025, 7, 1, 6, tzinfo=UTC))
    bars = {
        signal - 3 * vg28.HOUR_US: make_bar("BTCUSDT", signal - 3 * vg28.HOUR_US, quote_volume="2"),
        signal - 2 * vg28.HOUR_US: make_bar("BTCUSDT", signal - 2 * vg28.HOUR_US, quote_volume="4"),
        signal - vg28.HOUR_US: make_bar("BTCUSDT", signal - vg28.HOUR_US, quote_volume="16"),
        signal: make_bar("BTCUSDT", signal, quote_volume="999999999"),
    }
    expected = Decimal(16).ln() - Decimal(2) * Decimal(4).ln() + Decimal(2).ln()
    assert vg28.curvature_at(bars, signal, 1) == expected
    bars[signal] = make_bar("BTCUSDT", signal, quote_volume="1")
    assert vg28.curvature_at(bars, signal, 1) == expected


def test_robust_z_uses_exactly_twenty_eight_prior_values() -> None:
    prior = tuple(Decimal(index) for index in range(28))
    expected = (Decimal(30) - Decimal("13.5")) / (Decimal("1.4826") * Decimal(7))
    assert vg28.robust_z(Decimal(30), prior) == expected
    assert vg28.robust_z(Decimal(30), prior[:-1]) is None
    assert vg28.robust_z(Decimal(30), (Decimal(1),) * 28) is None


def test_all_qualifiers_enter_after_one_full_bar_and_fewer_than_three_is_cash() -> None:
    signal = timestamp_us(datetime(2025, 7, 1, tzinfo=UTC))
    bars = full_symbol_bars(
        signal - 24 * vg28.HOUR_US,
        signal + 24 * vg28.HOUR_US,
    )
    scores = {symbol: {signal: Decimal(0)} for symbol in vg28.SYMBOLS}
    liquidity = {symbol: {signal: True} for symbol in vg28.SYMBOLS}
    for symbol in vg28.SYMBOLS[:4]:
        scores[symbol][signal] = Decimal(3)
    trial = vg28.Trial("synthetic", 1, Decimal("2.5"), 2)
    cohorts = vg28.select_cohorts(
        scores,
        bars,
        trial,
        signal,
        signal + 24 * vg28.HOUR_US,
        "acceleration",
        liquidity,
    )
    assert len(cohorts) == 1
    assert cohorts[0].symbols == vg28.SYMBOLS[:4]
    assert cohorts[0].entry_us == signal + vg28.HOUR_US
    assert cohorts[0].exit_us == signal + 3 * vg28.HOUR_US
    scores[vg28.SYMBOLS[2]][signal] = Decimal(0)
    scores[vg28.SYMBOLS[3]][signal] = Decimal(0)
    assert (
        vg28.select_cohorts(
            scores,
            bars,
            trial,
            signal,
            signal + 24 * vg28.HOUR_US,
            "acceleration",
            liquidity,
        )
        == ()
    )


def test_deceleration_is_a_matched_long_only_comparator() -> None:
    signal = timestamp_us(datetime(2025, 7, 1, tzinfo=UTC))
    bars = full_symbol_bars(
        signal - 24 * vg28.HOUR_US,
        signal + 24 * vg28.HOUR_US,
    )
    scores = {symbol: {signal: Decimal(0)} for symbol in vg28.SYMBOLS}
    liquidity = {symbol: {signal: True} for symbol in vg28.SYMBOLS}
    for symbol in vg28.SYMBOLS[:3]:
        scores[symbol][signal] = Decimal("-3")
    cohort = vg28.select_cohorts(
        scores,
        bars,
        vg28.Trial("synthetic", 1, Decimal("2.5"), 2),
        signal,
        signal + 24 * vg28.HOUR_US,
        "deceleration",
        liquidity,
    )[0]
    assert cohort.direction == "deceleration"
    assert cohort.symbols == vg28.SYMBOLS[:3]
    path = vg28.simulate_sleeve(
        bars,
        (cohort,),
        signal,
        signal + 24 * vg28.HOUR_US,
        Decimal(0),
        Decimal(0),
        "deceleration",
    )
    assert abs(path.equity_at_open[-1] - vg28.STARTING_NOTIONAL_USD) < Decimal("1e-40")
    assert all(value >= 0 for value in path.equity_at_open)


def test_per_fill_cost_is_charged_on_entry_and_exit() -> None:
    start = timestamp_us(datetime(2025, 7, 1, tzinfo=UTC))
    bars = full_symbol_bars(start, start + vg28.DAY_US)
    symbols = vg28.SYMBOLS[:3]
    for symbol in symbols:
        bars[symbol][start + vg28.HOUR_US] = make_bar(
            symbol, start + vg28.HOUR_US, open_price="100"
        )
        bars[symbol][start + 3 * vg28.HOUR_US] = make_bar(
            symbol, start + 3 * vg28.HOUR_US, open_price="110"
        )
    cohort = vg28.Cohort(
        direction="acceleration",
        signal_us=start,
        entry_us=start + vg28.HOUR_US,
        exit_us=start + 3 * vg28.HOUR_US,
        symbols=symbols,
        public_capacity_proxy_usd=Decimal("1000"),
    )
    fee = Decimal("0.001")
    adverse = Decimal("0.001")
    path = vg28.simulate_sleeve(
        bars,
        (cohort,),
        start,
        start + vg28.DAY_US,
        fee,
        adverse,
        "acceleration",
    )
    expected = (
        Decimal(1000)
        / (Decimal(1) + fee)
        / (Decimal(1) + adverse)
        * Decimal("1.10")
        * (Decimal(1) - adverse)
        * (Decimal(1) - fee)
    )
    immediate_exit_value = (
        Decimal(1000)
        / (Decimal(1) + fee)
        / (Decimal(1) + adverse)
        * (Decimal(1) - adverse)
        * (Decimal(1) - fee)
    )
    assert abs(path.equity_at_open[1] - immediate_exit_value) < Decimal("1e-40")
    assert abs(path.equity_at_open[-1] - expected) < Decimal("1e-40")
    assert path.symbol_fills == 6
    assert path.symbol_round_trips == 3


def test_capacity_uses_prior_completed_24h_and_equal_weight_bottleneck() -> None:
    signal = timestamp_us(datetime(2025, 7, 1, tzinfo=UTC))
    bars = full_symbol_bars(
        signal - 24 * vg28.HOUR_US,
        signal + vg28.HOUR_US,
        quote_volume="100",
    )
    symbols = vg28.SYMBOLS[:3]
    least = symbols[-1]
    for opened in range(signal - 24 * vg28.HOUR_US, signal, vg28.HOUR_US):
        bars[least][opened] = make_bar(least, opened, quote_volume="50")
    expected = Decimal(3) * Decimal(24 * 50) * Decimal("0.0001")
    assert vg28.episode_capacity_proxy(bars, symbols, signal) == expected
    bars[least][signal] = make_bar(least, signal, quote_volume="999999999")
    assert vg28.episode_capacity_proxy(bars, symbols, signal) == expected


def test_liquidity_screen_excludes_signal_day_and_future() -> None:
    signal = timestamp_us(datetime(2025, 7, 1, 18, tzinfo=UTC))
    start = signal - 31 * vg28.DAY_US
    end = signal + vg28.DAY_US
    bars = {
        opened: make_bar("BTCUSDT", opened, quote_volume="500000")
        for opened in range(start, end, vg28.HOUR_US)
    }
    assert vg28.liquidity_eligible(bars, signal)
    for opened in range(
        signal - 18 * vg28.HOUR_US,
        signal + 6 * vg28.HOUR_US,
        vg28.HOUR_US,
    ):
        bars[opened] = make_bar("BTCUSDT", opened, quote_volume="0")
    assert vg28.liquidity_eligible(bars, signal)


def test_circular_bootstrap_is_seeded_and_reports_interval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg28, "BOOTSTRAP_REPLICATES", 64)
    monkeypatch.setattr(vg28, "BOOTSTRAP_BLOCK_DAYS", 2)
    values = tuple(Decimal("0.01") for _ in range(14))
    first = vg28.circular_block_bootstrap(values, seed=19)
    second = vg28.circular_block_bootstrap(values, seed=19)
    assert first == second
    assert first.mean_daily_return == Decimal("0.01")
    assert first.lower_one_sided_95_total_return == first.total_return
    assert first.lower_95_total_return == first.upper_95_total_return
    assert first.one_sided_p_value == Decimal(1) / Decimal(65)


def test_comparator_bootstrap_uses_paired_terminal_pnl_difference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg28, "BOOTSTRAP_REPLICATES", 64)
    monkeypatch.setattr(vg28, "BOOTSTRAP_BLOCK_DAYS", 2)
    acceleration = (Decimal("0.10"), Decimal("-0.05")) * 7
    comparator = (Decimal("0.02"), Decimal("0.01")) * 7
    summary = vg28.paired_terminal_difference_bootstrap(
        acceleration,
        comparator,
        seed=28,
    )
    terminal_difference = vg28.compound_return(acceleration) - vg28.compound_return(comparator)
    virtual_spread = vg28.compound_return(
        tuple(left - right for left, right in zip(acceleration, comparator, strict=True))
    )
    assert summary.total_return == terminal_difference
    assert summary.total_return != virtual_spread


def test_circular_indices_are_deterministic_and_in_range() -> None:
    first = vg28.circular_indices(20, 7, random.Random(28))
    second = vg28.circular_indices(20, 7, random.Random(28))
    assert first == second
    assert len(first) == 20
    assert all(0 <= index < 20 for index in first)


def test_holm_is_monotone_in_sorted_raw_p_order() -> None:
    adjusted = vg28.holm_adjusted(
        {
            "a": Decimal("0.001"),
            "b": Decimal("0.01"),
            "c": Decimal("0.03"),
        }
    )
    assert adjusted == {
        "a": Decimal("0.003"),
        "b": Decimal("0.02"),
        "c": Decimal("0.03"),
    }


def test_white_reality_check_covers_exact_twelve_aligned_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg28, "BOOTSTRAP_REPLICATES", 64)
    monkeypatch.setattr(vg28, "BOOTSTRAP_BLOCK_DAYS", 2)
    paths = {
        f"trial-{index:02d}": tuple(
            Decimal(str(0.0001 * index + 0.001 * math.sin(day + index))) for day in range(32)
        )
        for index in range(12)
    }
    first = vg28.white_reality_check(paths, seed=7)
    second = vg28.white_reality_check(paths, seed=7)
    assert first == second
    assert first["trialCount"] == 12
    assert first["replicates"] == 64


def test_cscv_pbo_uses_eight_blocks_and_all_seventy_splits() -> None:
    paths = {
        f"trial-{trial:02d}": tuple(
            Decimal(str((trial + 1) * ((day % 9) - 4) / 1_000_000)) for day in range(80)
        )
        for trial in range(12)
    }
    report = vg28.cscv_pbo(paths)
    assert report["blockCount"] == 8
    assert report["splitCount"] == 70
    assert report["status"] == "MEASURED"


def test_holdout_serializes_actual_stress_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg28, "BOOTSTRAP_REPLICATES", 32)
    monkeypatch.setattr(vg28, "BOOTSTRAP_BLOCK_DAYS", 2)
    base_acceleration = synthetic_path("acceleration", Decimal("0.001"))
    stress_acceleration = synthetic_path("acceleration", Decimal("-0.002"))
    comparator = synthetic_path("deceleration", Decimal(0))
    paths = vg28.TrialPaths(
        trial=vg28.Trial("synthetic", 1, Decimal("1.5"), 2),
        gross=vg28.SleevePair(base_acceleration, comparator),
        base=vg28.SleevePair(base_acceleration, comparator),
        stress=vg28.SleevePair(stress_acceleration, comparator),
        severe=vg28.SleevePair(stress_acceleration, comparator),
    )
    metrics, _ = vg28.holdout_analysis(paths)
    base_net = metrics["base"]["acceleration"]["netUsdPer1000"]
    stress_net = metrics["stress"]["acceleration"]["netUsdPer1000"]
    assert base_net != stress_net
    assert stress_net == vg28.path_metrics(stress_acceleration)["netUsdPer1000"]


def csv_row(opened_us: int, **overrides: str) -> str:
    """Return one headerless official-shape hourly row."""

    fields = [
        str(opened_us),
        "100",
        "101",
        "99",
        "100",
        "10",
        str(opened_us + vg28.HOUR_US - 1),
        "1000",
        "7",
        "5",
        "500",
        "0",
    ]
    indices = {
        "open_time": 0,
        "open": 1,
        "high": 2,
        "low": 3,
        "close": 4,
        "base_volume": 5,
        "close_time": 6,
        "quote_volume": 7,
    }
    for name, value in overrides.items():
        fields[indices[name]] = value
    return ",".join(fields)


def archive_artifact(
    objects: Path,
    *,
    month: str = "2025-01",
    rows: list[str] | None = None,
    member_name: str | None = None,
) -> dict[str, object]:
    """Write one temporary hash-bound archive and sidecar."""

    objects.mkdir(parents=True)
    symbol = "BTCUSDT"
    archive_name = f"{symbol}-1h-{month}.zip"
    start = timestamp_us(datetime.strptime(month + "-01", "%Y-%m-%d").replace(tzinfo=UTC))
    end = timestamp_us(vg28.next_month(vg28.month_start(month)))
    payload_rows = (
        [csv_row(opened) for opened in range(start, end, vg28.HOUR_US)] if rows is None else rows
    )
    archive_path = objects / archive_name
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            member_name or f"{symbol}-1h-{month}.csv",
            "\n".join(payload_rows) + "\n",
        )
    archive_sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum = f"{archive_sha}  {archive_name}\n".encode("ascii")
    checksum_path = objects / f"{archive_name}.CHECKSUM"
    checksum_path.write_bytes(checksum)
    return {
        "archiveName": archive_name,
        "archiveSha256": archive_sha,
        "checksumName": f"{archive_name}.CHECKSUM",
        "checksumSha256": hashlib.sha256(checksum).hexdigest(),
        "month": month,
        "symbol": symbol,
    }


def test_archive_parser_accepts_exact_headerless_microsecond_hour_grid(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    objects = tmp_path / "objects"
    artifact = archive_artifact(objects)
    monkeypatch.setattr(vg28, "OBJECTS_ROOT", objects)
    bars = vg28.parse_archive(artifact)
    assert len(bars) == 744
    assert bars[0].open_time_us == timestamp_us(datetime(2025, 1, 1, tzinfo=UTC))
    assert bars[-1].quote_volume == Decimal(1000)


def test_archive_parser_rejects_header_and_wrong_member(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    objects = tmp_path / "header" / "objects"
    artifact = archive_artifact(
        objects,
        rows=[",".join(vg28.KLINE_FIELDS)],
    )
    monkeypatch.setattr(vg28, "OBJECTS_ROOT", objects)
    with pytest.raises(vg28.VG28Error, match="headerless"):
        vg28.parse_archive(artifact)
    other_objects = tmp_path / "member" / "objects"
    other = archive_artifact(other_objects, member_name="../escape.csv")
    monkeypatch.setattr(vg28, "OBJECTS_ROOT", other_objects)
    with pytest.raises(vg28.VG28Error, match="member inventory"):
        vg28.parse_archive(other)


def test_archive_parser_rejects_hash_tamper_and_millisecond_time(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    objects = tmp_path / "tamper" / "objects"
    artifact = archive_artifact(objects)
    monkeypatch.setattr(vg28, "OBJECTS_ROOT", objects)
    archive_path = objects / cast(str, artifact["archiveName"])
    archive_path.write_bytes(archive_path.read_bytes() + b"tamper")
    with pytest.raises(vg28.VG28Error, match="hash mismatch"):
        vg28.parse_archive(artifact)
    millis_objects = tmp_path / "millis" / "objects"
    start = timestamp_us(datetime(2025, 1, 1, tzinfo=UTC))
    end = timestamp_us(datetime(2025, 2, 1, tzinfo=UTC))
    rows = [csv_row(opened) for opened in range(start, end, vg28.HOUR_US)]
    rows[0] = csv_row(start // 1000)
    millis = archive_artifact(millis_objects, rows=rows)
    monkeypatch.setattr(vg28, "OBJECTS_ROOT", millis_objects)
    with pytest.raises(vg28.VG28Error, match="microsecond"):
        vg28.parse_archive(millis)


@pytest.mark.parametrize(
    "payload",
    [
        b"a" * 64 + b"  A.zip\nextra",
        b"A" * 64 + b"  A.zip\n",
        b"a" * 63 + b"  A.zip\n",
        b"\xff" + b"a" * 64 + b"  A.zip\n",
    ],
)
def test_checksum_grammar_fails_closed(payload: bytes) -> None:
    with pytest.raises(vg28.VG28Error):
        vg28.verify_checksum_text(payload, "A.zip", "a" * 64)


def test_json_evidence_and_run_marker_are_exclusive_create(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "receipt.json"
    vg28.write_json_once(target, {"value": 1})
    with pytest.raises(FileExistsError):
        vg28.write_json_once(target, {"value": 2})
    marker = tmp_path / "run-marker.v1.json"
    result = tmp_path / "result.v1.json"
    freeze = tmp_path / "freeze.v1.json"
    source = tmp_path / "source-manifest.v1.json"
    freeze.write_text("freeze")
    source.write_text("source")
    monkeypatch.setattr(vg28, "RUN_MARKER_PATH", marker)
    monkeypatch.setattr(vg28, "RESULT_PATH", result)
    monkeypatch.setattr(vg28, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg28, "SOURCE_MANIFEST_PATH", source)
    monkeypatch.setattr(
        vg28,
        "git_output",
        lambda *arguments: "" if arguments[0] == "status" else "f" * 40,
    )
    receipt = {"evaluatorSha256": "e" * 64}
    assert len(vg28.consume_run_marker(receipt)) == 64
    with pytest.raises(vg28.VG28Error, match="already consumed"):
        vg28.consume_run_marker(receipt)


def test_validate_freeze_rejects_non_descendant_runtime_head(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    manifest = tmp_path / "source-manifest.v1.json"
    fingerprint = vg28.canonical_sha([vg28.trial_mapping(trial) for trial in vg28.trial_grid()])
    vg28.write_json_once(
        freeze,
        {
            "baseCommit": vg28.BASE_COMMIT,
            "gitHead": "f" * 40,
            "pythonImplementation": sys.implementation.name,
            "pythonVersion": sys.version,
            "schema": "VG28PreOutcomeFreezeV1",
            "state": "READY_FOR_ONE_ARCHIVE_DECOMPRESSION_RUN",
            "trialCount": 12,
            "trialFingerprintSha256": fingerprint,
        },
    )
    vg28.write_json_once(manifest, {})
    monkeypatch.setattr(vg28, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg28, "SOURCE_MANIFEST_PATH", manifest)
    monkeypatch.setattr(vg28, "required_static_hashes", lambda: {})
    monkeypatch.setattr(vg28, "manifest_records", lambda _: [])
    monkeypatch.setattr(vg28, "validate_scope_lineage", lambda: "c" * 40)
    monkeypatch.setattr(vg28, "git_output", lambda *_: "x" * 40)
    with pytest.raises(vg28.VG28Error, match="descended from the frozen head"):
        vg28.validate_freeze()


def test_failed_development_gates_cannot_seal_or_open_holdout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg28, "CANDIDATE_SEAL_PATH", tmp_path / "candidate-seal.v1.json")
    monkeypatch.setattr(vg28, "HOLDOUT_OPEN_PATH", tmp_path / "holdout-open.v1.json")
    champion = vg28.DevelopmentEvaluation(
        paths=cast(vg28.TrialPaths, object()),
        absolute_bootstrap=cast(vg28.BootstrapSummary, object()),
        comparator_bootstrap=cast(vg28.BootstrapSummary, object()),
        gates={"strictGate": False},
    )
    with pytest.raises(vg28.VG28Error, match="every gate"):
        vg28.seal_candidate(champion, (), {}, {})
    assert not vg28.HOLDOUT_OPEN_PATH.exists()


def test_keyboard_interrupt_after_marker_becomes_terminal_unmeasured(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    protocol = tmp_path / "protocol.v1.json"
    source = tmp_path / "source-manifest.v1.json"
    marker = tmp_path / "run-marker.v1.json"
    result_path = tmp_path / "result.v1.json"
    for path in (freeze, protocol, source):
        path.write_text("{}")
    monkeypatch.setattr(vg28, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg28, "PROTOCOL_PATH", protocol)
    monkeypatch.setattr(vg28, "SOURCE_MANIFEST_PATH", source)
    monkeypatch.setattr(vg28, "RUN_MARKER_PATH", marker)
    monkeypatch.setattr(vg28, "RESULT_PATH", result_path)
    monkeypatch.setattr(
        vg28,
        "HOLDOUT_OPEN_PATH",
        tmp_path / "holdout-open.v1.json",
    )
    monkeypatch.setattr(
        vg28,
        "validate_freeze",
        lambda: ({}, {"sourceScope": "PUBLIC"}),
    )

    def consume(_: object) -> str:
        vg28.write_json_once(marker, {"schema": "TEST"})
        return vg28.sha256_path(marker)

    def interrupt(*_: object) -> object:
        raise KeyboardInterrupt

    monkeypatch.setattr(vg28, "consume_run_marker", consume)
    monkeypatch.setattr(vg28, "load_bars", interrupt)
    vg28.run_experiment()
    result = vg28.load_json(result_path)
    assert result["verdict"]["status"] == "UNMEASURED"
    assert result["verdict"]["reasons"] == ["CATCHABLE_INTERRUPTION_KEYBOARDINTERRUPT"]


def test_unmeasured_economics_are_null_not_numeric_zero(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    protocol = tmp_path / "protocol.v1.json"
    source = tmp_path / "source-manifest.v1.json"
    freeze.write_text("{}")
    protocol.write_text("{}")
    source.write_text("{}")
    monkeypatch.setattr(vg28, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg28, "PROTOCOL_PATH", protocol)
    monkeypatch.setattr(vg28, "SOURCE_MANIFEST_PATH", source)
    monkeypatch.setattr(vg28, "HOLDOUT_OPEN_PATH", tmp_path / "holdout-open.v1.json")
    result = vg28.terminal_unmeasured_result(
        "m" * 64,
        {"sourceScope": "PUBLIC"},
        "SYNTHETIC_FAILURE",
    )
    edge = result["netEdge"]
    assert edge["netUsdPer1000"] is None
    assert edge["publicCapacityP05Usd"] is None
    assert edge["intervalUsdPer1000"] == {
        "lower95": None,
        "upper95": None,
    }
    assert result["accountEffectiveFeeRate"]["value"] is None
    assert result["capacityTruth"]["executableCapacityUsd"] is None
    handoff = vg28.render_handoff(result)
    assert handoff.count("\n") == 1
    assert handoff.startswith("- item=`2026-07-29 V-G28 ")
    assert "net/95% interval/public capacity=UNMEASURED/UNMEASURED/" in handoff
    assert "PRESERVED_WAITING(N3 successor/final convergence)" in handoff


def test_measured_handoff_is_exactly_one_result_derived_row() -> None:
    metric = {
        "activeDayCount": 40,
        "activeMonthCount": 8,
        "capacityP05Usd": "1250.000000000000",
        "episodeCount": 50,
        "maxDrawdown": "0.050000000000",
        "netUsdPer1000": "12.500000000000",
    }
    candidate: dict[str, object] = {
        scenario: {"acceleration": dict(metric)}
        for scenario in ("gross", "base", "stress", "severe")
    }
    candidate.update(
        {
            "gates": {"baseNetPositive": True, "holmAdjustedPBelow005": False},
            "holmAdjustedPValue": "0.120000000000",
            "trial": {"trialId": "vg28-w1-z15-h2"},
        }
    )
    result = {
        "schema": "VG28TerminalProfitabilityVerdictV1",
        "development": {
            "candidateRows": [candidate],
            "pbo": {"pbo": "0.300000000000"},
            "whiteRealityCheck": {"pValue": "0.220000000000"},
        },
        "holdout": {"metrics": None, "state": "UNOPENED_UNTOUCHED"},
        "netEdge": {
            "intervalUsdPer1000": {
                "lower95": "-5.000000000000",
                "upper95": "30.000000000000",
            },
            "netUsdPer1000": "12.500000000000",
            "publicCapacityP05Usd": "1250.000000000000",
            "trialId": "vg28-w1-z15-h2",
        },
        "verdict": {"status": "NO_GO"},
    }
    handoff = vg28.render_handoff(result)
    assert handoff.count("\n") == 1
    assert "Holm/White/PBO=0.120000000000/0.220000000000/0.300000000000" in handoff
    assert "failed gates=1" in handoff
    assert "PROFITABILITY_NO_GO; CAPITAL_NO_GO" in handoff


def test_result_binding_rejects_go_with_unopened_holdout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    protocol = tmp_path / "protocol.v1.json"
    source = tmp_path / "source-manifest.v1.json"
    marker = tmp_path / "run-marker.v1.json"
    for path in (freeze, protocol, source):
        path.write_text("{}")
    vg28.write_json_once(
        marker,
        {
            "freezeSha256": vg28.sha256_path(freeze),
            "schema": "VG28ExclusiveRunMarkerV1",
            "sourceManifestSha256": vg28.sha256_path(source),
        },
    )
    monkeypatch.setattr(vg28, "FREEZE_PATH", freeze)
    monkeypatch.setattr(vg28, "PROTOCOL_PATH", protocol)
    monkeypatch.setattr(vg28, "SOURCE_MANIFEST_PATH", source)
    monkeypatch.setattr(vg28, "RUN_MARKER_PATH", marker)
    monkeypatch.setattr(
        vg28,
        "CANDIDATE_SEAL_PATH",
        tmp_path / "candidate-seal.v1.json",
    )
    monkeypatch.setattr(
        vg28,
        "HOLDOUT_OPEN_PATH",
        tmp_path / "holdout-open.v1.json",
    )
    result = {
        "baseCommit": vg28.BASE_COMMIT,
        "freezeSha256": vg28.sha256_path(freeze),
        "protocolSha256": vg28.sha256_path(protocol),
        "runMarkerSha256": vg28.sha256_path(marker),
        "schema": "VG28TerminalProfitabilityVerdictV1",
        "sourceManifestSha256": vg28.sha256_path(source),
        "verdict": {"status": "GO"},
        "netEdge": {
            "intervalUsdPer1000": {"lower95": "1", "upper95": "2"},
            "netUsdPer1000": "1",
            "publicCapacityP05Usd": "1000",
            "trialId": "vg28-w1-z15-h2",
        },
        "holdout": {
            "metrics": None,
            "reuseCount": 0,
            "state": "UNOPENED_UNTOUCHED",
        },
    }
    with pytest.raises(vg28.VG28Error, match="unopened holdout"):
        vg28.verify_result_bindings(result)
