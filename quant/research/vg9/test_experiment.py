from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg9 import experiment as e


def _zip_bytes(name: str, csv: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, csv)
    return buffer.getvalue()


def _install_archive(
    root: Path,
    *,
    venue: str,
    symbol: str,
    month: str,
    raw: bytes,
) -> e.ArchiveBinding:
    if venue == "SPOT":
        directory = root / symbol / month
        zip_name = f"{symbol}-1d-{month}.zip"
    else:
        directory = root / symbol / "1h"
        zip_name = f"{symbol}-1h-{month}.zip"
    directory.mkdir(parents=True)
    archive = directory / zip_name
    archive.write_bytes(raw)
    sidecar = directory / f"{zip_name}.CHECKSUM"
    sidecar.write_text(f"{hashlib.sha256(raw).hexdigest()}  {zip_name}\n")
    return e._archive_binding(
        venue=venue,
        root=root,
        sidecar=sidecar,
        symbol=symbol,
        month=month,
    )


def _spot_csv(
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-07",
    days: int = 1,
) -> tuple[str, bytes]:
    first = datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=UTC)
    rows: list[str] = []
    for offset in range(days):
        opened = first + timedelta(days=offset)
        open_us = int(opened.timestamp() * 1_000_000)
        rows.append(f"{open_us},10,12,9,11,100,{open_us + e.DAY_US - 1},1000000,5,50,500000,0")
    return f"{symbol}-1d-{month}.csv", ("\n".join(rows) + "\n").encode()


def _usd_m_csv(
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-07",
    hours: int = 24,
) -> tuple[str, bytes]:
    first = datetime.strptime(f"{month}-01", "%Y-%m-%d").replace(tzinfo=UTC)
    rows: list[str] = []
    for offset in range(hours):
        opened = first + timedelta(hours=offset)
        open_ms = int(opened.timestamp() * 1000)
        rows.append(f"{open_ms},10,12,9,11,100,{open_ms + e.HOUR_MS - 1},2000000,5,50,500000,0")
    return f"{symbol}-1h-{month}.csv", ("\n".join(rows) + "\n").encode()


def _series(
    symbols: list[str],
    first: date,
    last: date,
) -> tuple[dict[str, dict[date, e.SpotBar]], dict[str, dict[date, e.VolumeBar]]]:
    spot: dict[str, dict[date, e.SpotBar]] = {}
    usd_m: dict[str, dict[date, e.VolumeBar]] = {}
    for index, symbol in enumerate(symbols):
        spot[symbol] = {}
        usd_m[symbol] = {}
        cursor = first
        while cursor <= last:
            spot_volume = Decimal(1_000_000 + index * 10_000)
            usd_m_volume = Decimal(2_000_000 + index * 10_000)
            if symbol == "S07USDT":
                spot_volume *= 5
                usd_m_volume /= 2
            spot[symbol][cursor] = e.SpotBar(
                cursor,
                Decimal(10 + index),
                Decimal(11 + index),
                spot_volume,
            )
            usd_m[symbol][cursor] = e.VolumeBar(cursor, usd_m_volume)
            cursor += timedelta(days=1)
    return spot, usd_m


def test_protocol_freezes_level_spread_and_matched_incremental_gate() -> None:
    protocol = e.load_protocol()
    assert [spec.trial_id for spec in e.trial_specs(protocol)] == [
        "W14_F10",
        "W14_F20",
        "W28_F10",
        "W28_F20",
        "W56_F10",
        "W56_F20",
    ]
    forbidden = set(protocol["distinctness"]["forbiddenSignalInputs"])
    assert {"PRICE", "RETURN", "SHARE_ACCELERATION", "BASIS", "FUNDING"} <= forbidden
    assert protocol["signal"]["score"] == "NATURAL_LOG_SPOT_SHARE_DIV_USD_M_SHARE"
    assert protocol["gates"]["holdout"]["stressMatchedExcessLowerBoundPositive"] is True


def test_metadata_enumeration_does_not_open_zip_body(tmp_path: Path) -> None:
    spot_root = tmp_path / "spot"
    usd_m_root = tmp_path / "usd-m"
    raw = b"intentionally-not-a-zip"
    _install_archive(
        spot_root,
        venue="SPOT",
        symbol="AAAUSDT",
        month="2025-07",
        raw=raw,
    )
    _install_archive(
        usd_m_root,
        venue="USD_M",
        symbol="AAAUSDT",
        month="2025-07",
        raw=raw,
    )
    protocol = e.load_protocol()
    protocol["data"]["spotRoot"] = str(spot_root)
    protocol["data"]["usdMRoot"] = str(usd_m_root)
    pairs = e.enumerate_source_pairs(protocol, ("2025-07",))
    assert pairs["2025-07"][0].spot.expected_zip_sha256 == hashlib.sha256(raw).hexdigest()
    with pytest.raises(e.DataError, match="invalid ZIP"):
        e.parse_spot_archive(pairs["2025-07"][0].spot)


def test_spot_microseconds_and_usd_m_milliseconds_normalize(tmp_path: Path) -> None:
    spot_name, spot_csv = _spot_csv()
    spot_binding = _install_archive(
        tmp_path / "spot",
        venue="SPOT",
        symbol="AAAUSDT",
        month="2025-07",
        raw=_zip_bytes(spot_name, spot_csv),
    )
    usd_name, usd_csv = _usd_m_csv()
    usd_binding = _install_archive(
        tmp_path / "usd-m",
        venue="USD_M",
        symbol="AAAUSDT",
        month="2025-07",
        raw=_zip_bytes(usd_name, usd_csv),
    )
    assert e.parse_spot_archive(spot_binding)[0].day == date(2025, 7, 1)
    daily = e.parse_usd_m_archive(usd_binding)
    assert daily == (e.VolumeBar(date(2025, 7, 1), Decimal(48_000_000)),)


def test_spot_rejects_millisecond_unit_after_2025(tmp_path: Path) -> None:
    opened = datetime(2025, 7, 1, tzinfo=UTC)
    open_ms = int(opened.timestamp() * 1000)
    csv = (f"{open_ms},10,12,9,11,100,{open_ms + 86_400_000 - 1},1000000,5,50,500000,0\n").encode()
    binding = _install_archive(
        tmp_path,
        venue="SPOT",
        symbol="AAAUSDT",
        month="2025-07",
        raw=_zip_bytes("AAAUSDT-1d-2025-07.csv", csv),
    )
    with pytest.raises(e.DataError, match="microseconds"):
        e.parse_spot_archive(binding)


def test_usd_m_partial_day_is_unavailable_not_fabricated_zero(tmp_path: Path) -> None:
    name, csv = _usd_m_csv(hours=23)
    binding = _install_archive(
        tmp_path,
        venue="USD_M",
        symbol="AAAUSDT",
        month="2025-07",
        raw=_zip_bytes(name, csv),
    )
    assert e.parse_usd_m_archive(binding) == ()


def test_tampered_archive_is_rejected_before_decompression(tmp_path: Path) -> None:
    name, csv = _spot_csv()
    binding = _install_archive(
        tmp_path,
        venue="SPOT",
        symbol="AAAUSDT",
        month="2025-07",
        raw=_zip_bytes(name, csv),
    )
    binding.path.write_bytes(binding.path.read_bytes() + b"tamper")
    with pytest.raises(e.CustodyError, match="byte length changed"):
        e.parse_spot_archive(binding)


def test_signal_is_price_free_and_has_no_future_volume_lookahead() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    formation_day = date(2025, 8, 25)
    spot, usd_m = _series(
        symbols,
        formation_day - timedelta(days=60),
        formation_day + timedelta(days=8),
    )
    spec = e.TrialSpec("W14_F10", 14, Decimal("0.10"))
    baseline = e.build_formation(spot, usd_m, formation_day, spec)
    assert baseline is not None
    assert baseline.spread_rank[0] == "S07USDT"
    changed_spot: dict[str, dict[date, e.SpotBar]] = {}
    changed_usd_m: dict[str, dict[date, e.VolumeBar]] = {}
    for symbol in symbols:
        changed_spot[symbol] = {}
        changed_usd_m[symbol] = {}
        for day, bar in spot[symbol].items():
            future = day >= formation_day
            changed_spot[symbol][day] = e.SpotBar(
                day,
                bar.open_price * Decimal(1000),
                bar.close_price / Decimal(1000),
                bar.quote_volume * (Decimal(999) if future else Decimal(1)),
            )
        for day, bar in usd_m[symbol].items():
            changed_usd_m[symbol][day] = e.VolumeBar(
                day,
                bar.quote_volume * (Decimal(777) if day >= formation_day else Decimal(1)),
            )
    changed = e.build_formation(changed_spot, changed_usd_m, formation_day, spec)
    assert changed is not None
    assert changed.spread_rank == baseline.spread_rank
    assert changed.spot_rank == baseline.spot_rank
    assert changed.selected_count == baseline.selected_count


def test_matched_comparator_has_same_count_and_stress_cost_is_adverse() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    formation_day = date(2025, 8, 25)
    spot, usd_m = _series(
        symbols,
        formation_day - timedelta(days=60),
        formation_day + timedelta(days=8),
    )
    spec = e.TrialSpec("W14_F10", 14, Decimal("0.10"))
    formation = e.build_formation(spot, usd_m, formation_day, spec)
    assert formation is not None
    base, stress = e.scenarios(e.load_protocol())
    base_run = e.simulate(
        spot=spot,
        formations=(formation,),
        spec=spec,
        scenario=base,
        comparator=False,
    )
    stress_run = e.simulate(
        spot=spot,
        formations=(formation,),
        spec=spec,
        scenario=stress,
        comparator=False,
    )
    matched = e.simulate(
        spot=spot,
        formations=(formation,),
        spec=spec,
        scenario=stress,
        comparator=True,
    )
    assert stress_run.terminal_nav < base_run.terminal_nav
    assert stress_run.round_trips == matched.round_trips == formation.selected_count


def test_canonical_schedule_plan_keeps_holdout_out_of_folds() -> None:
    samples, plan = e.build_schedule_plan()
    assert len(samples.samples) == 43
    assert len(plan.holdout_sample_ids) == 17
    fold_ids = {
        sample_id
        for fold in plan.folds
        for sample_id in (*fold.train_sample_ids, *fold.validation_sample_ids)
    }
    assert not fold_ids & set(plan.holdout_sample_ids)


def test_holdout_guard_requires_marker_and_candidate_binding(tmp_path: Path) -> None:
    _, plan = e.build_schedule_plan()
    candidate = {
        "walkForwardPlanSha256": plan.digest().hexdigest,
        "champion": "W14_F10",
    }
    candidate_path = tmp_path / "candidate_seal.v1.json"
    candidate_path.write_text(json.dumps(candidate))
    with pytest.raises(e.CustodyError, match="marker"):
        e.guarded_open_holdout_schedule(tmp_path)
    marker = {"candidateSealSha256": e.sha256_path(candidate_path)}
    (tmp_path / "holdout_opened.v1.json").write_text(json.dumps(marker))
    opened = e.guarded_open_holdout_schedule(tmp_path)
    assert len(opened) == 17


def test_development_one_shot_refuses_contaminated_state(tmp_path: Path) -> None:
    (tmp_path / "development_opened.v1.json").write_text("{}")
    with pytest.raises(e.CustodyError, match="already consumed"):
        e.run_development(tmp_path)


def test_terminal_evidence_seal_copies_without_recomputation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        e,
        "_packet_binding",
        lambda: {
            "freezeSha256": "a" * 64,
            "protocolSha256": "b" * 64,
            "sourceManifestSha256": "c" * 64,
        },
    )
    state = tmp_path / "state"
    state.mkdir()
    (state / "development_opened.v1.json").write_text('{"schema":"marker"}\n')
    (state / "development_result.v1.json").write_text('{"schema":"result","status":"NO_GO"}\n')
    target = tmp_path / "tracked"
    manifest = e.seal_evidence(state, target)
    assert manifest["stage"] == "DEVELOPMENT_TERMINAL"
    assert manifest["outcomesRecomputedDuringSeal"] is False
    assert (target / "SHA256SUMS").is_file()


def test_source_contains_no_network_or_money_boundary() -> None:
    source = Path(e.__file__).read_text()
    forbidden = (
        "requests.",
        "urllib",
        "socket.",
        "api_key",
        "create_order",
        "withdraw",
        "transfer",
    )
    assert all(token not in source.lower() for token in forbidden)
