"""Network-free synthetic and semantic tests for V-G11."""

from __future__ import annotations

import hashlib
import io
import json
import os
import stat
import zipfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from research.vg11 import experiment as exp

D = Decimal


def _bar(
    day: date,
    *,
    open_price: str = "100",
    quote_volume: str = "10000000",
    trade_count: int = 100,
) -> exp.Bar:
    return exp.Bar(day, D(open_price), D(quote_volume), trade_count)


def _series(
    first: date,
    days: int,
    spikes: set[date],
) -> dict[date, exp.Bar]:
    result = {}
    for offset in range(days):
        day = first + timedelta(days=offset)
        result[day] = _bar(day, trade_count=200 if day in spikes else 100)
    return result


def _protocol() -> dict[str, Any]:
    protocol, _ = exp.load_json(exp.HERE / "protocol.v1.json")
    return protocol


def test_static_contract_and_shared_metadata_are_exact() -> None:
    exp._static_payloads()
    discovery, acquisition, marker = exp._validate_shared_metadata()
    assert discovery["universe"]["count"] == 605
    assert acquisition["artifactPairCount"] == 11245
    assert marker["networkPermitted"] is False


def test_signal_is_causal_and_price_invariant() -> None:
    first = date(2025, 5, 1)
    signal_day = first + timedelta(days=60)
    original = _series(first, 65, {signal_day})
    mutated = {
        day: exp.Bar(bar.day, D("999999") + D(index), bar.quote_volume, bar.trade_count)
        for index, (day, bar) in enumerate(original.items())
    }

    expected = (D("2"), D("2"), D("1"))
    assert exp.signal_qualifies(original, signal_day, D("1.5")) == expected
    assert exp.signal_qualifies(mutated, signal_day, D("1.5")) == expected
    assert exp.signal_qualifies(original, signal_day, D("3.0")) is None


def test_first_crossing_trade_and_volume_guards_fail_closed() -> None:
    first = date(2025, 5, 1)
    signal_day = first + timedelta(days=60)
    series = _series(first, 65, {signal_day - timedelta(days=1), signal_day})
    assert exp.signal_qualifies(series, signal_day, D("1.5")) is None

    weak_trade = _series(first, 65, set())
    weak_trade[signal_day] = _bar(signal_day, quote_volume="7000000", trade_count=110)
    assert exp.signal_qualifies(weak_trade, signal_day, D("1.5")) is None

    volume_shock = _series(first, 65, set())
    volume_shock[signal_day] = _bar(signal_day, quote_volume="5000000", trade_count=200)
    assert exp.signal_qualifies(volume_shock, signal_day, D("1.5")) is None


def test_cooldown_blocks_three_signal_dates_without_cross_sectional_ranking() -> None:
    first = date(2025, 5, 1)
    first_signal = first + timedelta(days=60)
    spikes = {first_signal, first_signal + timedelta(days=2), first_signal + timedelta(days=4)}
    bars = {
        "BUSDT": _series(first, 70, spikes),
        "AUSDT": _series(first, 70, spikes),
    }
    events = exp.evaluate_trial(
        bars,
        exp.date_range(first_signal, first_signal + timedelta(days=4)),
        threshold=D("1.5"),
    )
    assert [(event.symbol, event.signal_day) for event in events] == [
        ("AUSDT", first_signal),
        ("BUSDT", first_signal),
        ("AUSDT", first_signal + timedelta(days=4)),
        ("BUSDT", first_signal + timedelta(days=4)),
    ]


def test_cost_proxies_are_exact_and_monotonic() -> None:
    public_fee, base, stress, bnb = exp.net_returns(D("0.01"))
    assert public_fee == D("0.008")
    assert base == D("0.007")
    assert stress == D("0.003")
    assert bnb == D("0.0085")
    assert stress < base < public_fee < bnb


def test_block_bootstrap_is_deterministic_and_clustered() -> None:
    first = date(2025, 7, 1)
    days = exp.date_range(first, first + timedelta(days=13))
    signals = tuple(
        exp.Signal(
            symbol=f"S{index}USDT",
            signal_day=day,
            entry_day=day + timedelta(days=1),
            exit_day=day + timedelta(days=3),
            threshold=D("1.5"),
            intensity_multiple=D("2"),
            trade_count_multiple=D("2"),
            quote_volume_multiple=D("1"),
            gross_return=D("0.02"),
            public_fee_net_return=D("0.018"),
            base_net_return=D("0.017"),
            stress_net_return=D("0.013"),
            bnb_conditional_net_return=D("0.0185"),
        )
        for index, day in enumerate(days)
    )
    first_result = exp.block_bootstrap_lower(
        signals,
        days,
        replicates=256,
        seed=7,
        block_days=7,
        lower_probability=D("0.01666666666666666666666666667"),
    )
    second_result = exp.block_bootstrap_lower(
        signals,
        days,
        replicates=256,
        seed=7,
        block_days=7,
        lower_probability=D("0.01666666666666666666666666667"),
    )
    assert first_result == second_result == D("0.013")


def _fixture_zip(symbol: str, month: str) -> bytes:
    day = date.fromisoformat(f"{month}-01")
    open_us = int(
        datetime(
            day.year,
            day.month,
            day.day,
            tzinfo=timezone.utc,  # noqa: UP017 - exercise system-compatible evaluator
        ).timestamp()
        * 1_000_000
    )
    row = f"{open_us},100,110,90,105,1,{open_us + exp.DAY_US - 1},10000000,100,0.5,5000000,0\n"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", row)
    return buffer.getvalue()


def test_archive_authentication_requires_manifest_and_sibling_sidecar(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    symbol = "TESTUSDT"
    month = "2025-05"
    archive_raw = _fixture_zip(symbol, month)
    archive_digest = hashlib.sha256(archive_raw).hexdigest()
    sidecar_raw = f"{archive_digest}  {symbol}-1d-{month}.zip\n".encode("ascii")
    directory = tmp_path / "archives" / symbol / month
    directory.mkdir(parents=True)
    archive_path = directory / f"{symbol}-1d-{month}.zip"
    sidecar_path = directory / f"{symbol}-1d-{month}.zip.CHECKSUM"
    archive_path.write_bytes(archive_raw)
    sidecar_path.write_bytes(sidecar_raw)
    row = {
        "zipSha256": archive_digest,
        "zipBytes": len(archive_raw),
        "checksumSha256": hashlib.sha256(sidecar_raw).hexdigest(),
    }
    monkeypatch.setattr(exp, "SHARED_ROOT", tmp_path)

    bars = exp.authenticate_archive(row, symbol=symbol, month=month)
    assert len(bars) == 1
    assert bars[0].trade_count == 100

    sidecar_path.write_text(f"{'0' * 64}  {symbol}-1d-{month}.zip\n", encoding="ascii")
    with pytest.raises(exp.EvidenceError, match="sidecar SHA mismatch"):
        exp.authenticate_archive(row, symbol=symbol, month=month)


def test_exclusive_marker_is_0600_and_create_once(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    exp.exclusive_write(marker, b"{}\n", mode=0o600)
    assert stat.S_IMODE(marker.stat().st_mode) == 0o600
    with pytest.raises(exp.EvidenceError, match="create-once"):
        exp.exclusive_write(marker, b"{}\n", mode=0o600)


def test_canonical_json_rejects_noncanonical_bytes(tmp_path: Path) -> None:
    path = tmp_path / "value.json"
    path.write_text(json.dumps({"b": 1, "a": 2}, indent=2), encoding="utf-8")
    with pytest.raises(exp.EvidenceError, match="not canonical"):
        exp.load_json(path)


def test_n3_projection_keeps_unknowns_null_and_authority_none() -> None:
    projection = exp.n3_projection("MEASURED", trial_observed=3, research_verdict="GO")
    assert projection["trialCountDeclared"] == 3
    assert projection["trialCountObserved"] == 3
    assert projection["authority"] == "NONE"
    assert projection["capitalVerdict"] == "NO_GO"
    for field in (
        "pbo",
        "deflatedSharpeRatio",
        "acceptedGlobalTest",
        "accountEffectiveFeeBpsPerFill",
        "executableCapacityUsd",
        "historicalFilterEligibility",
    ):
        assert projection[field] is None


def test_no_network_capability_is_imported() -> None:
    source = (exp.HERE / "experiment.py").read_text(encoding="utf-8")
    forbidden = ("urllib", "requests", "httpx", "socket.", "aiohttp")
    assert all(name not in source for name in forbidden)
    assert os.fspath(exp.STATE_ROOT).startswith("/private/tmp/cosmos-vg11-")
