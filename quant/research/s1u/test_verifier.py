"""Hostile tests for the independent, network-free S-1U verifier."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from research.s1u.experiment import canonical_bytes, sha256_file
from research.s1u.verifier import (
    FROZEN_FILES,
    validate_freeze,
    verified_funding_rows,
    verified_kline_rows,
    verify_checksum_file,
    verify_manifest,
    verify_run_marker,
)

PACKET = Path(__file__).resolve().parent


def write_json(path: Path, value: object) -> None:
    path.write_bytes(canonical_bytes(value))


def test_checksum_verifier_rejects_packet_tamper(tmp_path: Path) -> None:
    payload = tmp_path / "artifact.json"
    payload.write_text('{"sealed":true}\n', encoding="utf-8")
    (tmp_path / "SHA256SUMS").write_text(
        f"{sha256_file(payload)}  artifact.json\n", encoding="utf-8"
    )
    proof = verify_checksum_file(tmp_path)
    assert proof["files"] == 1
    payload.write_text('{"sealed":false}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="checksum mismatch"):
        verify_checksum_file(tmp_path)


def test_run_marker_mismatch_is_rejected(tmp_path: Path) -> None:
    packet = tmp_path / "packet"
    raw = tmp_path / "raw"
    packet.mkdir()
    raw.mkdir()
    base = {
        "schema": "s1u.run-consumed.v1",
        "strategy_id": "S-1U",
        "state": "CONSUMED_BEFORE_FIRST_SOURCE_BODY_REQUEST",
        "one_run_id": "1" * 64,
        "freeze_commit": "a" * 40,
        "run_started_utc": "2026-07-29T00:00:00+00:00",
        "raw_root": str(raw.resolve()),
        "rerun_allowed": False,
    }
    tracked = dict(base)
    tracked["terminal_verdict"] = "NO_GO"
    tracked["holdout_state"] = "UNOPENED"
    write_json(packet / "RUN_CONSUMED.v1.json", tracked)
    write_json(packet / "RUN_STARTED.v1.json", base)
    write_json(raw / "RUN_CONSUMED.v1.json", base)
    assert verify_run_marker(packet, raw)["one_run_id"] == "1" * 64
    tracked["freeze_commit"] = "b" * 40
    write_json(packet / "changed.json", tracked)
    (packet / "RUN_CONSUMED.v1.json").write_bytes((packet / "changed.json").read_bytes())
    with pytest.raises(ValueError, match="run marker mismatch"):
        verify_run_marker(packet, raw)


def test_unopened_manifest_row_must_have_no_body_or_derived_hash(tmp_path: Path) -> None:
    packet = tmp_path / "packet"
    raw = tmp_path / "raw"
    packet.mkdir()
    raw.mkdir()
    protocol = json.loads((PACKET / "protocol.v1.json").read_text(encoding="utf-8"))
    protocol["universe"]["symbols"] = ["BTCUSDT"]
    protocol["window"]["development_months"] = []
    protocol["window"]["holdout_months"] = ["2026-06"]
    marker = {"one_run_id": "2" * 64}
    row = {
        "dataset": "klines",
        "symbol": "BTCUSDT",
        "month": "2026-06",
        "phase": "SEALED_HOLDOUT",
        "url": (
            "https://data.binance.vision/data/futures/um/monthly/"
            "klines/BTCUSDT/5m/BTCUSDT-5m-2026-06.zip"
        ),
        "checksum_url": (
            "https://data.binance.vision/data/futures/um/monthly/"
            "klines/BTCUSDT/5m/BTCUSDT-5m-2026-06.zip.CHECKSUM"
        ),
        "state": "NOT_REQUESTED_UNOPENED",
    }
    funding_row = dict(row)
    funding_row.update(
        {
            "dataset": "fundingRate",
            "url": (
                "https://data.binance.vision/data/futures/um/monthly/"
                "fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-06.zip"
            ),
            "checksum_url": (
                "https://data.binance.vision/data/futures/um/monthly/"
                "fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-06.zip.CHECKSUM"
            ),
        }
    )
    manifest = {
        "schema": "s1u.source-manifest.v1",
        "publisher": "Binance",
        "public_only": True,
        "one_run_id": marker["one_run_id"],
        "objects": [row, funding_row],
    }
    write_json(packet / "source_manifest.v1.json", manifest)
    development = {"all_development_gates_pass": False}
    proof = verify_manifest(packet, raw, protocol, marker, development)
    assert proof == {
        "objects": 2,
        "verified": 0,
        "unopened": 2,
        "not_acquired": 0,
        "verified_unmeasured": 0,
    }
    manifest["objects"][0]["phase"] = "PREHISTORY_OR_DEVELOPMENT"
    write_json(packet / "phase-tampered.json", manifest)
    (packet / "source_manifest.v1.json").write_bytes((packet / "phase-tampered.json").read_bytes())
    with pytest.raises(ValueError, match="phase/month"):
        verify_manifest(packet, raw, protocol, marker, development)
    manifest["objects"][0]["phase"] = "SEALED_HOLDOUT"
    manifest["objects"][0]["actual_sha256"] = "0" * 64
    write_json(packet / "tampered.json", manifest)
    (packet / "source_manifest.v1.json").write_bytes((packet / "tampered.json").read_bytes())
    with pytest.raises(ValueError, match="body-derived"):
        verify_manifest(packet, raw, protocol, marker, development)


def test_manifest_requires_exact_archive_identity(tmp_path: Path) -> None:
    packet = tmp_path / "packet"
    raw = tmp_path / "raw"
    packet.mkdir()
    raw.mkdir()
    protocol = json.loads((PACKET / "protocol.v1.json").read_text(encoding="utf-8"))
    protocol["universe"]["symbols"] = ["BTCUSDT"]
    protocol["window"]["development_months"] = []
    protocol["window"]["holdout_months"] = ["2026-06"]
    marker = {"one_run_id": "3" * 64}
    objects = []
    for dataset, relative in (
        ("klines", "klines/BTCUSDT/5m/BTCUSDT-5m-2026-06.zip"),
        ("fundingRate", "fundingRate/BTCUSDT/BTCUSDT-fundingRate-2026-06.zip"),
    ):
        url = f"{protocol['sources']['root']}/{relative}"
        objects.append(
            {
                "dataset": dataset,
                "symbol": "BTCUSDT",
                "month": "2026-06",
                "phase": "SEALED_HOLDOUT",
                "url": url,
                "checksum_url": f"{url}.CHECKSUM",
                "state": "NOT_REQUESTED_UNOPENED",
            }
        )
    objects[0]["url"] = f"{protocol['sources']['root']}/klines/ETHUSDT/5m/wrong.zip"
    objects[0]["checksum_url"] = f"{objects[0]['url']}.CHECKSUM"
    write_json(
        packet / "source_manifest.v1.json",
        {
            "schema": "s1u.source-manifest.v1",
            "publisher": "Binance",
            "public_only": True,
            "one_run_id": marker["one_run_id"],
            "objects": objects,
        },
    )
    with pytest.raises(ValueError, match="archive identity"):
        verify_manifest(
            packet,
            raw,
            protocol,
            marker,
            {"all_development_gates_pass": False},
        )


def test_freeze_requires_every_required_input(tmp_path: Path) -> None:
    hashes: dict[str, str] = {}
    for name in FROZEN_FILES:
        path = tmp_path / name
        path.write_text(f"{name}\n", encoding="utf-8")
        hashes[name] = sha256_file(path)
    validate_freeze(tmp_path, {"schema": "s1u.freeze.v1", "frozen_files": hashes})
    hashes.pop("verifier.py")
    with pytest.raises(ValueError, match="exact required"):
        validate_freeze(tmp_path, {"schema": "s1u.freeze.v1", "frozen_files": hashes})


def test_independent_archive_parser_fails_closed_on_schema(tmp_path: Path) -> None:
    kline = tmp_path / "BTCUSDT-5m-2025-01.zip"
    kline_member = "BTCUSDT-5m-2025-01.csv"
    kline_header = (
        "open_time,open,high,low,close,volume,close_time,quote_volume,count,"
        "taker_buy_volume,taker_buy_quote_volume,ignore\n"
    )
    kline_row = "1735689600000,100,101,99,100,2,1735689899999,200,10,1,100,0\n"
    with zipfile.ZipFile(kline, "w") as archive:
        archive.writestr(kline_member, kline_header + kline_row)
    parsed = verified_kline_rows(kline)
    assert len(parsed) == 1
    assert parsed[0].quote_volume == 200.0

    funding = tmp_path / "BTCUSDT-fundingRate-2025-01.zip"
    funding_member = "BTCUSDT-fundingRate-2025-01.csv"
    with zipfile.ZipFile(funding, "w") as archive:
        archive.writestr(
            funding_member,
            "calc_time,funding_interval_hours,last_funding_rate\n1735689600015,8,0.0001\n",
        )
    assert verified_funding_rows(funding) == [1_735_689_600_015]

    with zipfile.ZipFile(kline, "w") as archive:
        archive.writestr(kline_member, "open_time,wrong\n1,2\n")
    with pytest.raises(ValueError, match="schema mismatch"):
        verified_kline_rows(kline)


def test_verifier_is_independent_and_has_no_network_imports() -> None:
    source = (PACKET / "verifier.py").read_text(encoding="utf-8")
    assert "from research.s1u.experiment" not in source
    assert "import urllib" not in source
    assert "import requests" not in source
    assert "import socket" not in source
    assert '"git", "show"' in source
    assert '"git", "merge-base"' in source
