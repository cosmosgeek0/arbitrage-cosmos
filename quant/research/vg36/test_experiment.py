"""Network-free synthetic hostile tests for the sealed V-G36 packet."""

from __future__ import annotations

import hashlib
import json
import math
import os
import zipfile
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg36 import experiment as vg36
from research.vg36 import verify as vg36_verify


def _point_series(
    innovations: Sequence[float],
    *,
    start: date = date(2025, 1, 1),
    price: str = "100",
    quote_volume: str = "1000",
) -> tuple[vg36.CohortPoint, ...]:
    points: list[vg36.CohortPoint] = []
    logit = 0.0
    share = 0.5
    points.append(
        vg36.CohortPoint(
            start,
            (Decimal(price),) * len(vg36.COHORT),
            (Decimal(quote_volume),) * len(vg36.COHORT),
            share,
            logit,
            None,
        )
    )
    for offset, innovation in enumerate(innovations, start=1):
        logit += innovation
        share = 1.0 / (1.0 + math.exp(-logit))
        points.append(
            vg36.CohortPoint(
                start + timedelta(days=offset),
                (Decimal(price),) * len(vg36.COHORT),
                (Decimal(quote_volume),) * len(vg36.COHORT),
                share,
                logit,
                innovation,
            )
        )
    return tuple(points)


def _cohort_bars(
    shares: Sequence[Decimal],
    *,
    start: date = date(2025, 1, 1),
    price_shift: Decimal = Decimal(0),
    quote_scale: Decimal = Decimal(1),
) -> dict[str, tuple[vg36.Bar, ...]]:
    output: dict[str, tuple[vg36.Bar, ...]] = {}
    for symbol_index, symbol in enumerate(vg36.COHORT):
        quote = Decimal(1000 + symbol_index) * quote_scale
        output[symbol] = tuple(
            vg36.Bar(
                start + timedelta(days=offset),
                Decimal(100 + symbol_index) + price_shift,
                quote,
                quote * share,
            )
            for offset, share in enumerate(shares)
        )
    return output


def _constant_points(
    start: date,
    count: int,
    *,
    price: str = "100",
    quote_volume: str = "1000",
) -> tuple[vg36.CohortPoint, ...]:
    return _point_series(
        tuple(0.01 if offset % 2 == 0 else -0.01 for offset in range(count - 1)),
        start=start,
        price=price,
        quote_volume=quote_volume,
    )


def _bootstrap_zero(block_days: int = 7) -> vg36.BootstrapSummary:
    return vg36.BootstrapSummary(0.0, 0.0, 0.0, 0.0, 1.0, block_days, 8)


def _write_json(path: Path, value: Mapping[str, vg36.JsonValue]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _source_pair(root: Path, symbol: str, month: str, payload: bytes) -> tuple[Path, Path]:
    directory = root / symbol / "1d"
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / f"{symbol}-1d-{month}.zip"
    archive.write_bytes(payload)
    sidecar = archive.with_name(f"{archive.name}.CHECKSUM")
    sidecar.write_text(f"{hashlib.sha256(payload).hexdigest()}  {archive.name}\n", encoding="ascii")
    return archive, sidecar


def _kline_row(day: date) -> list[str]:
    start = int(datetime(day.year, day.month, day.day, tzinfo=UTC).timestamp() * 1_000_000)
    close = start + 86_400_000_000 - 1
    return [
        str(start),
        "100",
        "110",
        "90",
        "105",
        "10",
        str(close),
        "1000",
        "12",
        "4",
        "600",
        "0",
    ]


def _archive_fixture(root: Path, symbol: str, month: str, *, extra: bool = False) -> Path:
    archive, _ = _source_pair(root, symbol, month, b"placeholder")
    start, end = vg36._month_bounds(month)
    rows = [_kline_row(day) for day in vg36._date_range(start, end)]
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as container:
        member = archive.name.removesuffix(".zip") + ".csv"
        csv_text = "\n".join(",".join(row) for row in rows) + "\n"
        container.writestr(member, csv_text)
        if extra:
            container.writestr("extra.csv", csv_text)
    return archive


def test_protocol_and_grid_are_exact() -> None:
    protocol = vg36.load_protocol()
    vg36.validate_protocol(protocol)
    assert len(vg36.trial_grid()) == 12
    assert len({trial.trial_id for trial in vg36.trial_grid()}) == 12
    assert {trial.lookback for trial in vg36.trial_grid()} == {20, 60}
    assert {trial.threshold for trial in vg36.trial_grid()} == {1.5, 2.5}
    assert {trial.hold_days for trial in vg36.trial_grid()} == {1, 3, 5}
    mutated = dict(protocol)
    mutated["costScenarios"] = [{"id": "drift", "perExecutedSideBps": 999}]
    with pytest.raises(vg36.MeasurementError, match="semantic digest"):
        vg36.validate_protocol(mutated)


def test_prior_only_isolated_negative_shock_and_continuation_suppression() -> None:
    points = _point_series((0.1, -0.1, 0.2, 0.0, -1.0, -2.0, 0.1))
    trial = vg36.TrialSpec(3, 1.5, 1, "synthetic")
    signals = vg36.detect_signals(points, trial)
    assert tuple(signal.day for signal in signals) == (date(2025, 1, 6),)
    assert signals[0].previous_z_score > -1.0
    assert signals[0].z_score <= -1.5


def test_future_mutation_cannot_change_formed_signals() -> None:
    base = _point_series((0.1, -0.1, 0.2, 0.0, -1.0, 0.1))
    extended = (*base, *_point_series((100.0, -100.0), start=date(2025, 1, 7))[1:])
    trial = vg36.TrialSpec(3, 1.5, 1, "synthetic")
    cutoff = date(2025, 1, 6)
    before = tuple(signal for signal in vg36.detect_signals(base, trial) if signal.day <= cutoff)
    after = tuple(signal for signal in vg36.detect_signals(extended, trial) if signal.day <= cutoff)
    assert before == after


def test_signal_is_invariant_to_price_and_quote_volume_level() -> None:
    innovations = (
        *(0.03 * math.sin(offset / 2.0) for offset in range(1, 30)),
        -1.0,
    )
    logit = 0.0
    shares: list[Decimal] = [Decimal("0.5")]
    for innovation in innovations:
        logit += innovation
        shares.append(Decimal(str(1.0 / (1.0 + math.exp(-logit)))))
    original = vg36.build_cohort_points(_cohort_bars(shares))
    mutated = vg36.build_cohort_points(
        _cohort_bars(shares, price_shift=Decimal("9000"), quote_scale=Decimal("17"))
    )
    trial = vg36.TrialSpec(20, 1.5, 3, "synthetic")
    assert vg36.detect_signals(original, trial) == vg36.detect_signals(mutated, trial)
    assert tuple(point.share for point in original) == tuple(point.share for point in mutated)


def test_parser_discards_raw_volume_trade_count_and_taker_base_from_signal_bar() -> None:
    original = _kline_row(date(2025, 3, 1))
    mutated = list(original)
    mutated[2] = "120"
    mutated[3] = "80"
    mutated[4] = "102"
    mutated[5] = "999999999"
    mutated[8] = "999999999"
    mutated[9] = "777777777"
    assert vg36._parse_kline_row(original, "BTCUSDT", 1) == vg36._parse_kline_row(
        mutated, "BTCUSDT", 1
    )


def test_zero_prior_mad_is_terminal_not_zero_score() -> None:
    points = _point_series((0.1,) * 10)
    with pytest.raises(vg36.MeasurementError, match="MAD"):
        vg36.standardized_innovations(points, 3)


def test_embargo_holding_suppression_and_exact_exit() -> None:
    start = date(2025, 1, 1)
    calendar = tuple(start + timedelta(days=offset) for offset in range(15))
    signals = tuple(
        vg36.ShockSignal(start + timedelta(days=offset), -3.0, 0.0) for offset in (2, 3, 4, 7, 8)
    )
    trial = vg36.TrialSpec(20, 1.5, 3, "synthetic")
    trades = vg36.schedule_trades(signals, calendar, trial, start, calendar[-1])
    assert trades == (
        vg36.Trade(calendar[2], calendar[4], calendar[7]),
        vg36.Trade(calendar[7], calendar[9], calendar[12]),
    )


def test_boundary_censored_trade_is_not_admitted() -> None:
    start = date(2025, 1, 1)
    calendar = tuple(start + timedelta(days=offset) for offset in range(10))
    signal = vg36.ShockSignal(calendar[6], -3.0, 0.0)
    trial = vg36.TrialSpec(20, 1.5, 3, "synthetic")
    assert vg36.schedule_trades((signal,), calendar, trial, start, calendar[-1]) == ()


def test_prepartition_signal_is_admitted_when_entry_and_exit_are_inside() -> None:
    start = date(2025, 1, 1)
    calendar = tuple(start + timedelta(days=offset) for offset in range(12))
    signal = vg36.ShockSignal(calendar[3], -3.0, 0.0)
    trial = vg36.TrialSpec(20, 1.5, 3, "synthetic")
    assert vg36.schedule_trades((signal,), calendar, trial, calendar[5], calendar[-1]) == (
        vg36.Trade(calendar[3], calendar[5], calendar[8]),
    )


def test_round_trip_cost_is_applied_once_per_side() -> None:
    start = date(2025, 1, 1)
    points = _constant_points(start, 36)
    first_open = start + timedelta(days=30)
    final_open = start + timedelta(days=35)
    trade = vg36.Trade(
        first_open,
        first_open + timedelta(days=1),
        first_open + timedelta(days=4),
    )
    path = vg36.simulate_scenario(points, (trade,), first_open, final_open, "fee", 10)
    expected = 1000.0 * 0.999 * 0.999
    assert path.strategy_equity[-1] == pytest.approx(expected, abs=1e-10)
    assert path.transition_count == 2


@pytest.mark.parametrize(("scenario_id", "basis_points"), vg36.COST_SCENARIOS)
def test_every_frozen_cost_scenario_is_exact(scenario_id: str, basis_points: int) -> None:
    start = date(2025, 1, 1)
    points = _constant_points(start, 2)
    equity, transitions = vg36._simulate_equity(
        points,
        (vg36.Trade(start, start, start + timedelta(days=1)),),
        basis_points,
        always_on=True,
    )
    factor = 1.0 - basis_points / 10_000.0
    assert scenario_id in {"gross", "fee_only", "base", "stress", "severe"}
    assert equity[-1] == pytest.approx(1000.0 * factor * factor, abs=1e-10)
    assert transitions == 2


def test_identical_boundary_trade_has_zero_always_on_excess() -> None:
    start = date(2025, 1, 1)
    points = _constant_points(start, 36)
    first_open = start + timedelta(days=30)
    final_open = start + timedelta(days=35)
    trade = vg36.Trade(first_open, first_open, final_open)
    path = vg36.simulate_scenario(points, (trade,), first_open, final_open, "base", 20)
    assert path.strategy_equity == path.comparator_equity
    assert all(value == pytest.approx(0.0, abs=1e-15) for value in path.excess_daily_returns)


def test_capacity_proxy_uses_only_prior_30_days() -> None:
    start = date(2025, 1, 1)
    points = list(_constant_points(start, 40, quote_volume="1000"))
    entry = start + timedelta(days=35)
    by_day = {point.day: point for point in points}
    calendar = tuple(point.day for point in points)
    baseline = vg36.lagged_capacity_proxy(by_day, calendar, entry)
    points[35] = vg36.CohortPoint(
        points[35].day,
        points[35].open_prices,
        (Decimal("999999999"),) * len(vg36.COHORT),
        points[35].share,
        points[35].logit_share,
        points[35].innovation,
    )
    points[-1] = vg36.CohortPoint(
        points[-1].day,
        points[-1].open_prices,
        (Decimal("1"),) * len(vg36.COHORT),
        points[-1].share,
        points[-1].logit_share,
        points[-1].innovation,
    )
    mutated = vg36.lagged_capacity_proxy(
        {point.day: point for point in points},
        tuple(point.day for point in points),
        entry,
    )
    assert baseline == mutated == pytest.approx(1.2)


def test_holm_is_monotone_and_bounded() -> None:
    adjusted = vg36.holm_adjust({"a": 0.01, "b": 0.02, "c": 0.5})
    assert adjusted == pytest.approx({"a": 0.03, "b": 0.04, "c": 0.5})
    assert all(0.0 <= value <= 1.0 for value in adjusted.values())


def test_white_max_stat_is_deterministic_and_family_aware() -> None:
    observations = {
        "a": (0.01, 0.0, 0.01, 0.0),
        "b": (0.0, 0.0, 0.0, 0.0),
    }
    first = vg36.white_max_stat_p_value(observations, 2, 64, 7)
    second = vg36.white_max_stat_p_value(observations, 2, 64, 7)
    assert first == second
    assert 0.0 < first <= 1.0


def test_cscv_pbo_has_exact_eight_choose_four_denominator() -> None:
    months = (
        *(date(2025, month, 1) for month in range(7, 13)),
        date(2026, 1, 1),
        date(2026, 2, 1),
    )
    evaluations: list[vg36.TrialEvaluation] = []
    for trial_index, trial in enumerate(vg36.trial_grid()):
        returns = tuple(
            (trial_index + 1) * 0.0001 * (1 if month_index % 2 == 0 else -0.5)
            for month_index in range(8)
        )
        equity = tuple(1000.0 * (1.0 + value) for value in returns)
        path = vg36.ScenarioPath(
            "base",
            20,
            months,
            equity,
            (1000.0,) * 8,
            returns,
            (0.0,) * 8,
            returns,
            (),
            0,
            (),
        )
        evaluations.append(
            vg36.TrialEvaluation(
                trial,
                (path,),
                _bootstrap_zero(),
                _bootstrap_zero(),
                _bootstrap_zero(14),
                _bootstrap_zero(14),
                returns,
                returns,
            )
        )
    report = vg36.cscv_pbo(evaluations)
    assert report["combinationCount"] == 70
    assert (
        report["role"]
        == "REPORT_ONLY_MEAN_EXCESS_FAMILY_DIAGNOSTIC_NEVER_SELECTS_RESCUES_OR_VETOES"
    )
    assert report["limitations"] == [
        "MEAN_EXCESS_FAMILY_DIAGNOSTIC_NOT_GATE_AND_LCB_SELECTION_PROCEDURE",
        "NO_MULTI_DAY_HOLDING_PURGE_AT_MONTH_BOUNDARIES",
    ]


def test_parse_archive_accepts_one_exact_member_and_microseconds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "archives"
    symbol = "BTCUSDT"
    month = "2025-03"
    archive = _archive_fixture(root, symbol, month)
    monkeypatch.setattr(vg36, "ARCHIVE_ROOT", root)
    artifact: vg36.JsonObject = {
        "archivePath": str(archive),
        "archiveSha256": _sha(archive),
        "month": month,
        "symbol": symbol,
    }
    bars = vg36.parse_archive(artifact)
    assert len(bars) == 31
    assert bars[0].taker_buy_share == Decimal("0.6")


def test_parse_archive_rejects_extra_member(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "archives"
    symbol = "BTCUSDT"
    month = "2025-03"
    archive = _archive_fixture(root, symbol, month, extra=True)
    monkeypatch.setattr(vg36, "ARCHIVE_ROOT", root)
    artifact: vg36.JsonObject = {
        "archivePath": str(archive),
        "archiveSha256": _sha(archive),
        "month": month,
        "symbol": symbol,
    }
    with pytest.raises(vg36.MeasurementError, match="exactly one"):
        vg36.parse_archive(artifact)


def test_millisecond_timestamp_is_rejected() -> None:
    row = _kline_row(date(2025, 3, 1))
    row[0] = str(int(row[0]) // 1000)
    with pytest.raises(vg36.MeasurementError, match="microsecond"):
        vg36._parse_kline_row(row, "BTCUSDT", 1)


def test_acquisition_hashes_compressed_bytes_without_zip_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "archives"
    _source_pair(root, "AAAUSDT", "2025-03", b"not-a-zip-but-compressed-bytes")
    monkeypatch.setattr(vg36, "ARCHIVE_ROOT", root)
    monkeypatch.setattr(vg36, "COHORT", ("AAAUSDT",))
    monkeypatch.setattr(vg36, "SOURCE_MONTHS", ("2025-03",))

    def forbidden_zip(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("pre-outcome source binding opened a ZIP")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_zip)
    rows = vg36._source_rows()
    assert len(rows) == 1
    assert isinstance(rows[0], dict)
    assert rows[0]["archiveSha256"] == hashlib.sha256(b"not-a-zip-but-compressed-bytes").hexdigest()


def test_source_hardlink_collision_is_terminal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "archives"
    first, _ = _source_pair(root, "AAAUSDT", "2025-03", b"same")
    second_dir = root / "BBBUSDT" / "1d"
    second_dir.mkdir(parents=True)
    second = second_dir / "BBBUSDT-1d-2025-03.zip"
    os.link(first, second)
    sidecar = second.with_name(f"{second.name}.CHECKSUM")
    sidecar.write_text(f"{hashlib.sha256(b'same').hexdigest()}  {second.name}\n")
    monkeypatch.setattr(vg36, "ARCHIVE_ROOT", root)
    monkeypatch.setattr(vg36, "COHORT", ("AAAUSDT", "BBBUSDT"))
    monkeypatch.setattr(vg36, "SOURCE_MONTHS", ("2025-03",))
    with pytest.raises(vg36.MeasurementError, match="collision"):
        vg36._source_rows()


def test_exclusive_marker_refuses_second_writer(tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    vg36._write_json_exclusive(path, {"schema": "one"})
    with pytest.raises(FileExistsError):
        vg36._write_json_exclusive(path, {"schema": "two"})
    assert vg36._read_json(path) == {"schema": "one"}


def test_direct_child_rejects_merge_even_when_first_parent_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    child = "a" * 40
    parent = "b" * 40
    other_parent = "c" * 40

    def fake_git(*arguments: str) -> str:
        if arguments == ("rev-parse", child):
            return child
        if arguments == ("rev-parse", parent):
            return parent
        if arguments == ("rev-list", "--parents", "-n", "1", child):
            return f"{child} {parent} {other_parent}"
        raise AssertionError(arguments)

    monkeypatch.setattr(vg36, "_git_output", fake_git)
    with pytest.raises(vg36.MeasurementError, match="direct child"):
        vg36._require_direct_child(child, parent, "synthetic")


def test_json_reader_rejects_duplicate_nonfinite_and_noncanonical_values(tmp_path: Path) -> None:
    duplicate = tmp_path / "duplicate.json"
    duplicate.write_text('{"a":1,"a":2}\n')
    with pytest.raises(vg36.MeasurementError, match="duplicate"):
        vg36._read_json(duplicate)
    nonfinite = tmp_path / "nonfinite.json"
    nonfinite.write_text('{"a":NaN}\n')
    with pytest.raises(vg36.MeasurementError, match="nonfinite"):
        vg36._read_json(nonfinite)
    noncanonical = tmp_path / "noncanonical.json"
    noncanonical.write_text('{\n  "a": 1\n}\n')
    with pytest.raises(vg36.MeasurementError, match="not canonical"):
        vg36._read_canonical_json(noncanonical)


def test_post_marker_keyboard_interrupt_becomes_terminal_unmeasured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[str] = []
    monkeypatch.setattr(vg36, "_require_prerun_absence", lambda: None)
    monkeypatch.setattr(vg36, "validate_frozen_identity", lambda: ({}, {}, "frozen-head"))
    monkeypatch.setattr(vg36, "_consume_run_marker", lambda _freeze, _head: {})

    def interrupt(*_args: object, **_kwargs: object) -> dict[str, tuple[vg36.Bar, ...]]:
        raise KeyboardInterrupt

    def terminal(reason: str) -> vg36.JsonObject:
        captured.append(reason)
        return {"localVerdict": "UNMEASURED", "verdict": "UNMEASURED"}

    monkeypatch.setattr(vg36, "_load_bars", interrupt)
    monkeypatch.setattr(vg36, "_terminal_unmeasured", terminal)
    result = vg36.run_experiment()
    assert result["verdict"] == "UNMEASURED"
    assert captured == ["KeyboardInterrupt: "]


def test_terminal_verifier_rehashes_sources_without_zip_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    packet = tmp_path / "packet"
    source_root = tmp_path / "archives"
    packet.mkdir()
    archive, sidecar = _source_pair(source_root, "AAAUSDT", "2025-03", b"sealed")
    protocol = packet / "protocol.v1.json"
    source_file = packet / "source.py"
    acquisition_path = packet / "acquisition-manifest.v1.json"
    manifest_path = packet / "source-manifest.v1.json"
    freeze_path = packet / "freeze.v1.json"
    marker_path = packet / "run-marker.v1.json"
    result_path = packet / "result.v1.json"
    checksums_path = packet / "SHA256SUMS"
    protocol.write_text("{}\n")
    source_file.write_text("sealed = True\n")
    artifact: vg36.JsonObject = {
        "archiveBytes": archive.stat().st_size,
        "archivePath": str(archive),
        "archiveSha256": _sha(archive),
        "checksumBytes": sidecar.stat().st_size,
        "checksumPath": str(sidecar),
        "checksumSha256": _sha(sidecar),
        "month": "2025-03",
        "publisherArchiveSha256": _sha(archive),
        "symbol": "AAAUSDT",
    }
    acquisition: vg36.JsonObject = {
        "archiveBodiesOpened": False,
        "archiveRoot": str(source_root),
        "archiveRootMutation": "FORBIDDEN",
        "artifactCount": 1,
        "artifacts": [artifact],
        "baseCommit": vg36.BASE_COMMIT,
        "createdAtUtc": "2026-07-29T00:00:00Z",
        "gitHead": "a" * 40,
        "protocolSha256": _sha(protocol),
        "schema": "VG36CompressedSourceAcquisitionV1",
        "sourceState": "PUBLISHER_CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED",
    }
    _write_json(acquisition_path, acquisition)
    manifest: vg36.JsonObject = {
        "archiveBodiesOpened": False,
        "archiveRoot": str(source_root),
        "artifactCount": 1,
        "artifacts": [artifact],
        "cohort": ["AAAUSDT"],
        "months": ["2025-03"],
        "protocolSha256": _sha(protocol),
        "schema": "VG36FrozenCompressedSourceManifestV1",
        "sourceState": "PUBLISHER_CHECKSUM_VERIFIED_COMPRESSED_BYTES_NOT_OPENED",
    }
    _write_json(manifest_path, manifest)
    freeze: vg36.JsonObject = {
        "acquisitionSha256": _sha(acquisition_path),
        "archiveBodiesOpened": False,
        "baseCommit": vg36.BASE_COMMIT,
        "gitHeadBeforeFreezeOutputs": "a" * 40,
        "protocolSha256": _sha(protocol),
        "schema": "VG36PreOutcomeFreezeV1",
        "sourceFileSha256": {
            "protocol.v1.json": _sha(protocol),
            "source.py": _sha(source_file),
        },
        "sourceManifestSha256": _sha(manifest_path),
    }
    _write_json(freeze_path, freeze)
    marker: vg36.JsonObject = {
        "freezeSha256": _sha(freeze_path),
        "gitHead": "b" * 40,
        "holdoutAuthorized": False,
        "holdoutOpened": False,
        "protocolSha256": _sha(protocol),
        "schema": "VG36ExclusiveRunMarkerV1",
        "sourceManifestSha256": _sha(manifest_path),
    }
    _write_json(marker_path, marker)
    result: vg36.JsonObject = {
        **vg36._terminal_truth(),
        "candidateSealSha256": None,
        "candidateSealed": False,
        "developmentMaterialized": False,
        "developmentSha256": None,
        "disposition": "TERMINAL_DEFECT_NO_REPAIR_NO_RERUN",
        "holdoutAuthorized": False,
        "holdoutBodyOpenReceiptSha256": None,
        "holdoutMarkerSha256": None,
        "holdoutOpened": False,
        "holdoutOutcomeMaterialized": False,
        "holdoutSha256": None,
        "localVerdict": "UNMEASURED",
        "reason": "synthetic terminal defect",
        "runMarkerSha256": _sha(marker_path),
        "schema": "VG36TerminalResultV1",
        "verdict": "UNMEASURED",
    }
    _write_json(result_path, result)

    monkeypatch.setattr(vg36, "PACKET_DIR", packet)
    monkeypatch.setattr(vg36, "PROTOCOL_PATH", protocol)
    monkeypatch.setattr(vg36, "SOURCE_FILES", (protocol, source_file))
    monkeypatch.setattr(vg36, "ACQUISITION_PATH", acquisition_path)
    monkeypatch.setattr(vg36, "SOURCE_MANIFEST_PATH", manifest_path)
    monkeypatch.setattr(vg36, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg36, "RUN_MARKER_PATH", marker_path)
    monkeypatch.setattr(vg36, "DEVELOPMENT_PATH", packet / "development.v1.json")
    monkeypatch.setattr(vg36, "CANDIDATE_SEAL_PATH", packet / "candidate-seal.v1.json")
    monkeypatch.setattr(vg36, "HOLDOUT_MARKER_PATH", packet / "holdout-marker.v1.json")
    monkeypatch.setattr(vg36, "HOLDOUT_BODY_OPEN_PATH", packet / "holdout-body-open.v1.json")
    monkeypatch.setattr(vg36, "HOLDOUT_PATH", packet / "holdout.v1.json")
    monkeypatch.setattr(vg36, "RESULT_PATH", result_path)
    monkeypatch.setattr(vg36, "SHA256SUMS_PATH", checksums_path)
    monkeypatch.setattr(vg36, "ARCHIVE_ROOT", source_root)
    monkeypatch.setattr(vg36, "COHORT", ("AAAUSDT",))
    monkeypatch.setattr(vg36, "SOURCE_MONTHS", ("2025-03",))
    monkeypatch.setattr(vg36, "load_protocol", lambda: {})
    monkeypatch.setattr(vg36, "_require_direct_child", lambda *_args: None)
    monkeypatch.setattr(vg36, "_require_exclusive_scope", lambda *_args: None)
    monkeypatch.setattr(
        vg36_verify,
        "_verify_git_identity",
        lambda _acquisition, _freeze, _expected: "c" * 40,
    )
    vg36.write_sha256s()

    def forbidden_zip(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("terminal verifier opened a ZIP")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_zip)
    verified = vg36_verify.verify_packet()
    assert verified["archiveBodiesOpened"] is False
    assert verified["verdict"] == "UNMEASURED"
    (packet / "unexpected.txt").write_text("unexpected\n")
    with pytest.raises(vg36.MeasurementError, match="file set"):
        vg36_verify.verify_packet()


def test_no_go_verifier_rejects_holdout_lifecycle_collision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    result: vg36.JsonObject = {
        "candidateSealed": False,
        "developmentMaterialized": True,
        "developmentSha256": "0" * 64,
        "disposition": "VALID_DEVELOPMENT_GATE_FAILURE_HOLDOUT_UNOPENED",
        "holdoutAuthorized": False,
        "holdoutOpened": False,
        "holdoutOutcomeMaterialized": False,
        "localVerdict": "NO_GO",
        "verdict": "NO_GO",
    }
    development: vg36.JsonObject = {
        "allTrialEvaluations": [
            {"trial": {"trialId": trial.trial_id}} for trial in vg36.trial_grid()
        ],
        "championTrialId": None,
        "gateResults": {trial.trial_id: {"synthetic_gate": False} for trial in vg36.trial_grid()},
    }
    development_path = tmp_path / "development.json"
    development_path.write_text("{}\n")
    result["developmentSha256"] = _sha(development_path)
    holdout = tmp_path / "holdout.json"
    holdout.write_text("{}\n")
    monkeypatch.setattr(vg36, "DEVELOPMENT_PATH", development_path)
    monkeypatch.setattr(vg36, "CANDIDATE_SEAL_PATH", tmp_path / "candidate.json")
    monkeypatch.setattr(vg36, "HOLDOUT_MARKER_PATH", tmp_path / "marker.json")
    monkeypatch.setattr(vg36, "HOLDOUT_BODY_OPEN_PATH", tmp_path / "body-open.json")
    monkeypatch.setattr(vg36, "HOLDOUT_PATH", holdout)
    with pytest.raises(vg36.MeasurementError, match="opened"):
        vg36_verify._verify_development_no_go(result, development)
