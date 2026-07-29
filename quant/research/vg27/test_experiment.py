from __future__ import annotations

import copy
import hashlib
import itertools
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from . import experiment as vg27


def _bar(
    symbol: str,
    opened_at: datetime,
    *,
    price: Decimal = Decimal("100"),
    quote: Decimal = Decimal("1000"),
) -> vg27.Bar:
    opened_us = int((opened_at - datetime(1970, 1, 1, tzinfo=UTC)).total_seconds() * 1_000_000)
    return vg27.Bar(
        symbol,
        opened_at,
        price,
        price,
        price,
        price,
        quote,
        opened_us,
        opened_us + vg27.HOUR_US - 1,
    )


def _signal_bars(
    formation: datetime,
    trial: vg27.Trial,
    *,
    current_scale: Decimal = Decimal("1.5"),
) -> dict[str, dict[datetime, vg27.Bar]]:
    bars: dict[str, dict[datetime, vg27.Bar]] = {symbol: {} for symbol in vg27.COHORT}
    base = Decimal(5)
    for symbol_index, symbol in enumerate(vg27.COHORT):
        symbol_sign = Decimal(1 if symbol_index < 5 else -1)
        for lag in range(trial.lookback_weeks, 0, -1):
            row_sign = Decimal(1 if lag % 2 else -1)
            log_quote = base + symbol_sign * row_sign
            bars[symbol][formation - lag * vg27.WEEK] = _bar(
                symbol,
                formation - lag * vg27.WEEK,
                quote=log_quote.exp() - Decimal(1),
            )
        current_log_quote = base + symbol_sign * current_scale
        bars[symbol][formation] = _bar(
            symbol,
            formation,
            quote=current_log_quote.exp() - Decimal(1),
        )
        bars[symbol][formation + timedelta(hours=1)] = _bar(
            symbol,
            formation + timedelta(hours=1),
            price=Decimal("999999"),
            quote=Decimal("999999999"),
        )
    return bars


def _price_grid(
    start: datetime,
    end: datetime,
    *,
    entry: datetime,
    exit_at: datetime,
) -> dict[str, dict[datetime, vg27.Bar]]:
    bars: dict[str, dict[datetime, vg27.Bar]] = {symbol: {} for symbol in vg27.COHORT}
    for symbol in vg27.COHORT:
        for opened_at in vg27.hour_range(start, end + timedelta(hours=1)):
            price = Decimal("110") if opened_at >= exit_at else Decimal("100")
            bars[symbol][opened_at] = _bar(symbol, opened_at, price=price)
    return bars


def _artifact(root: Path, rows: list[str], *, month: str = "2025-01") -> dict[str, object]:
    symbol = "BTCUSDT"
    directory = root / "sources" / symbol / month
    directory.mkdir(parents=True)
    zip_name = f"{symbol}-1h-{month}.zip"
    zip_path = directory / zip_name
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(f"{symbol}-1h-{month}.csv", "\n".join(rows) + "\n")
    zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    checksum_path = directory / f"{zip_name}.CHECKSUM"
    checksum_path.write_bytes(f"{zip_sha}  {zip_name}\n".encode())
    return {
        "checksumBytes": checksum_path.stat().st_size,
        "checksumPath": str(checksum_path.relative_to(root)),
        "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
        "month": month,
        "symbol": symbol,
        "zipBytes": zip_path.stat().st_size,
        "zipPath": str(zip_path.relative_to(root)),
        "zipSha256": zip_sha,
    }


def _row(opened_at: datetime, *, close_delta: int = 0) -> str:
    opened_us = int((opened_at - datetime(1970, 1, 1, tzinfo=UTC)).total_seconds() * 1_000_000)
    closed_us = opened_us + vg27.HOUR_US - 1 + close_delta
    return f"{opened_us},100,101,99,100,10,{closed_us},1000,7,5,500,0"


def _fake_manifest(root: Path) -> None:
    artifacts: list[dict[str, object]] = []
    for symbol, month in vg27.expected_artifact_keys():
        zip_path, checksum_path = vg27.source_paths(root, symbol, month)
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        zip_path.write_bytes(b"compressed-bytes-never-opened")
        zip_sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        checksum_path.write_bytes(f"{zip_sha}  {zip_path.name}\n".encode())
        archive_url = f"{vg27.ARCHIVE_BASE}/{symbol}/1h/{symbol}-1h-{month}.zip"
        artifacts.append(
            {
                "archiveUrl": archive_url,
                "checksumBytes": checksum_path.stat().st_size,
                "checksumPath": str(checksum_path.relative_to(root)),
                "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
                "checksumUrl": f"{archive_url}.CHECKSUM",
                "custodyMode": "PRESTAGED_VERIFIED_PUBLIC_BYTES",
                "month": month,
                "symbol": symbol,
                "zipBytes": zip_path.stat().st_size,
                "zipPath": str(zip_path.relative_to(root)),
                "zipSha256": zip_sha,
            }
        )
    vg27.write_exclusive(
        root / "source-manifest.v1.json",
        {
            "artifacts": artifacts,
            "createdAtUtc": "2026-07-29T00:00:00Z",
            "downloadedObjectCount": 0,
            "officialArchiveBase": vg27.ARCHIVE_BASE,
            "objectsOpened": 0,
            "prestagedObjectCount": len(vg27.expected_artifact_keys()) * 2,
            "version": "VG27SourceManifestV1",
        },
    )


def _isolate_packet(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    packet = tmp_path / "packet"
    packet.mkdir()
    monkeypatch.setattr(vg27, "PACKET_DIR", packet)
    return packet


def test_trial_grid_is_exact_twelve_and_stable() -> None:
    assert len(vg27.trial_grid()) == 12
    assert [trial.trial_id for trial in vg27.trial_grid()] == sorted(
        trial.trial_id for trial in vg27.trial_grid()
    )
    assert vg27.trial_grid()[0].trial_id == "VG27-L08-D150-H04"
    assert vg27.trial_grid()[-1].trial_id == "VG27-L26-D200-H12"
    assert vg27.FIRST_ELIGIBLE_FORMATION - 26 * vg27.WEEK == vg27.WARMUP_START


def test_signal_is_as_of_prior_matrix_and_threshold_boundary_is_on() -> None:
    formation = datetime(2025, 7, 2, tzinfo=UTC)
    trial = vg27.Trial("boundary", 8, Decimal("1.5"), 4)
    bars = _signal_bars(formation, trial)
    signal = vg27.signal_at(bars, trial, formation)
    assert signal.reference_dispersion == Decimal(1)
    assert abs(signal.current_dispersion - Decimal("1.5")) < Decimal("1e-40")
    assert signal.on


def test_signal_ignores_prices_and_future_rows_but_not_current_quote_volume() -> None:
    formation = datetime(2025, 7, 2, tzinfo=UTC)
    trial = vg27.Trial("causal", 8, Decimal("1.5"), 4)
    bars = _signal_bars(formation, trial)
    baseline = vg27.signal_at(bars, trial, formation)
    perturbed = copy.deepcopy(bars)
    for symbol in vg27.COHORT:
        current = perturbed[symbol][formation]
        perturbed[symbol][formation] = _bar(
            symbol, formation, price=Decimal("0.000001"), quote=current.quote_volume
        )
        perturbed[symbol][formation + timedelta(hours=1)] = _bar(
            symbol,
            formation + timedelta(hours=1),
            price=Decimal("999999999"),
            quote=Decimal("1e40"),
        )
    assert vg27.signal_at(perturbed, trial, formation) == baseline
    changed = copy.deepcopy(bars)
    for symbol in vg27.COHORT[:5]:
        changed[symbol][formation] = _bar(symbol, formation, quote=Decimal(0))
    assert (
        vg27.signal_at(changed, trial, formation).current_dispersion != baseline.current_dispersion
    )


def test_missing_one_required_member_is_terminal_not_cash() -> None:
    formation = datetime(2025, 7, 2, tzinfo=UTC)
    trial = vg27.Trial("missing", 8, Decimal("1.5"), 4)
    bars = _signal_bars(formation, trial)
    del bars[vg27.COHORT[-1]][formation]
    with pytest.raises(vg27.MeasurementError, match="required signal bar missing"):
        vg27.signal_at(bars, trial, formation)


def test_events_are_nonoverlapping_and_wait_one_full_hour(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = vg27.FIRST_ELIGIBLE_FORMATION
    trial = vg27.Trial("events", 8, Decimal("1.5"), 4)
    monkeypatch.setattr(
        vg27,
        "signal_at",
        lambda *_args: vg27.Signal(True, Decimal(2), Decimal(1), Decimal(5000)),
    )
    events = vg27.build_events({}, trial, start, start + timedelta(hours=25))
    assert events[0].entry_at == start + timedelta(hours=2)
    assert events[0].exit_at == start + timedelta(hours=6)
    assert all(left.exit_at <= right.entry_at for left, right in itertools.pairwise(events))
    assert vg27.build_events({}, trial, start, start + timedelta(hours=6)) == ()


def test_full_cohort_costs_capacity_drawdown_and_reconciliation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = datetime(2025, 7, 1, tzinfo=UTC)
    end = start + timedelta(hours=8)
    event = vg27.Event(
        start,
        start + timedelta(hours=2),
        start + timedelta(hours=6),
        Decimal("2000"),
    )
    monkeypatch.setattr(vg27, "build_events", lambda *_args: (event,))
    simulation = vg27.simulate(
        _price_grid(start, end, entry=event.entry_at, exit_at=event.exit_at),
        vg27.Trial("cost", 8, Decimal("1.5"), 4),
        vg27.Scenario("base", Decimal("0.0010"), Decimal("0.0005")),
        start,
        end,
    )
    assert simulation.minimum_capacity_usd == Decimal("2000")
    assert simulation.fee_cost_usd > 0
    assert simulation.adverse_cost_usd > 0
    assert simulation.ending_usd == (
        vg27.STARTING_USD
        + simulation.gross_trading_pnl_usd
        - simulation.fee_cost_usd
        - simulation.adverse_cost_usd
    )
    assert simulation.max_drawdown >= Decimal("0.0029")
    assert vg27.simulation_mapping(simulation)["publicCapacity1000Pass"] is True


def test_missing_held_mark_is_terminal_unmeasured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = datetime(2025, 7, 1, tzinfo=UTC)
    end = start + timedelta(hours=8)
    event = vg27.Event(
        start,
        start + timedelta(hours=2),
        start + timedelta(hours=6),
        Decimal("2000"),
    )
    monkeypatch.setattr(vg27, "build_events", lambda *_args: (event,))
    bars = _price_grid(start, end, entry=event.entry_at, exit_at=event.exit_at)
    del bars[vg27.COHORT[0]][start + timedelta(hours=3)]
    with pytest.raises(vg27.MeasurementError, match="required hourly mark bar missing"):
        vg27.simulate(
            bars,
            vg27.Trial("missing-mark", 8, Decimal("1.5"), 4),
            vg27.scenarios()[1],
            start,
            end,
        )


def test_microseconds_header_schema_close_boundary_and_grid(tmp_path: Path) -> None:
    start, end = vg27.month_bounds("2025-01")
    rows = [_row(hour) for hour in vg27.hour_range(start, end)]
    artifact = _artifact(tmp_path, rows)
    parsed = vg27.parse_archive(artifact, tmp_path)
    assert len(parsed) == 31 * 24
    bad_header = _artifact(
        tmp_path / "header",
        ["open_time," + ",".join(rows[0].split(",")[1:]), *rows[1:]],
    )
    with pytest.raises(vg27.MeasurementError, match="microsecond timestamp"):
        vg27.parse_archive(bad_header, tmp_path / "header")
    bad_close = _artifact(
        tmp_path / "close",
        [_row(start, close_delta=1), *rows[1:]],
    )
    with pytest.raises(vg27.MeasurementError, match="close boundary"):
        vg27.parse_archive(bad_close, tmp_path / "close")
    gap = _artifact(tmp_path / "gap", rows[:-1])
    with pytest.raises(vg27.MeasurementError, match="hourly grid"):
        vg27.parse_archive(gap, tmp_path / "gap")


def test_checksum_tamper_and_timestamp_milliseconds_fail(tmp_path: Path) -> None:
    with pytest.raises(vg27.MeasurementError, match="16-digit microsecond"):
        vg27.parse_timestamp_us("1735689600000", "openTime")
    with pytest.raises(vg27.CustodyError, match="does not bind"):
        vg27.verify_checksum_text(b"a" * 64 + b"  wrong.zip\n", "right.zip", "a" * 64)


def test_bootstrap_holm_white_and_pbo_are_deterministic() -> None:
    returns = tuple(Decimal("0.001") if index % 7 == 0 else Decimal(0) for index in range(336))
    indices_a = vg27.circular_indices(336, block=168, replicates=32, seed=7)
    indices_b = vg27.circular_indices(336, block=168, replicates=32, seed=7)
    assert indices_a == indices_b
    assert vg27.bootstrap_summary(returns, indices_a) == vg27.bootstrap_summary(returns, indices_b)
    assert vg27.holm_adjust({"b": 0.02, "a": 0.01, "c": 0.2}) == {
        "a": 0.03,
        "b": 0.04,
        "c": 0.2,
    }
    paths = {trial.trial_id: returns for trial in vg27.trial_grid()}
    white_p = vg27.white_max_stat(paths, indices_a)["pValue"]
    assert isinstance(white_p, str)
    assert float(white_p) > 0
    pbo = vg27.cscv_pbo(paths)
    assert pbo["blocks"] == 8
    assert pbo["diagnosticOnlyNeverSelectionRescue"] is True


def test_marker_interruption_only_finalizes_unmeasured_and_refuses_rerun(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate_packet(tmp_path, monkeypatch)
    vg27.write_exclusive(tmp_path / "development-open.v1.json", {"consumed": True})
    monkeypatch.setattr(
        vg27,
        "validate_freeze",
        lambda _root: pytest.fail("interrupted run must not validate or open sources"),
    )
    result = vg27.run(tmp_path)
    assert result["status"] == "UNMEASURED"
    assert result["interruptedAfterMarker"] is True
    with pytest.raises(vg27.CustodyError, match="rerun refused"):
        vg27.run(tmp_path)


def test_verify_hashes_but_never_opens_archives_or_recomputes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate_packet(tmp_path, monkeypatch)
    _fake_manifest(tmp_path)
    vg27.freeze(tmp_path)
    freeze_sha = vg27.sha256_path(vg27.packet_artifact(vg27.FREEZE_NAME))
    vg27.write_paired_exclusive(
        tmp_path,
        vg27.DEVELOPMENT_MARKER_NAME,
        {
            "createdAtUtc": "2026-07-29T00:00:00Z",
            "freezeSha256": freeze_sha,
            "phase": "DEVELOPMENT",
            "version": "VG27OpenMarkerV1",
        },
    )
    vg27.write_paired_exclusive(
        tmp_path,
        vg27.RESULT_NAME,
        {
            "accountProfitability": "UNKNOWN",
            "capitalVerdict": "NO_GO",
            "executionAuthority": "NONE",
            "freezeSha256": freeze_sha,
            "holdout": "UNOPENED",
            "moneyEffectUsd": "0",
            "status": "UNMEASURED",
            "version": "VG27ResultV1",
        },
    )
    vg27.seal(tmp_path)
    monkeypatch.setattr(
        zipfile,
        "ZipFile",
        lambda *_args, **_kwargs: pytest.fail("archive opened"),
    )
    monkeypatch.setattr(
        vg27,
        "development_analysis",
        lambda *_args: pytest.fail("returns recomputed"),
    )
    assert vg27.verify(tmp_path)["archiveBodiesOpened"] == 0
    first_zip, _ = vg27.source_paths(tmp_path, vg27.COHORT[0], vg27.MONTHS[0])
    first_zip.write_bytes(b"tampered")
    with pytest.raises(vg27.CustodyError, match="archive SHA-256 mismatch"):
        vg27.verify(tmp_path)


def test_scope_and_authority_are_frozen() -> None:
    protocol = vg27.validate_protocol()
    assert protocol["authority"]["capital"] == "NO_GO"
    assert protocol["authority"]["execution"] == "NONE"
    assert protocol["authority"]["moneyEffectUsd"] == "0"
    assert protocol["data"]["symbols"] == list(vg27.COHORT)
    assert (
        protocol["inference"]["cscvPbo"]["role"]
        == "DIAGNOSTIC_ONLY_NEVER_SELECTION_HOLDOUT_AUTHORIZATION_OR_RESCUE"
    )
