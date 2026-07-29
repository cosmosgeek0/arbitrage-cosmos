"""Network-free hostile proof for the sealed V-G24 contract."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import random
import zipfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from research.vg24 import experiment as vg24

D = Decimal


def _patch_lifecycle_paths(
    root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Path]:
    paths = {
        "SOURCE_MANIFEST_PATH": root / "source-manifest.v1.json",
        "FREEZE_PATH": root / "freeze.v1.json",
        "RUN_MARKER_PATH": root / "run-marker.v1.json",
        "DEVELOPMENT_OPEN_PATH": root / "development-open.v1.json",
        "DEVELOPMENT_PATH": root / "development.v1.json",
        "SELECTION_PATH": root / "selection.v1.json",
        "HOLDOUT_OPEN_PATH": root / "holdout-open.v1.json",
        "RESULT_PATH": root / "result.v1.json",
        "TERMINAL_PATH": root / "terminal.v1.json",
        "SHA256SUMS_PATH": root / "SHA256SUMS",
    }
    monkeypatch.setattr(vg24, "HERE", root)
    for name, path in paths.items():
        monkeypatch.setattr(vg24, name, path)
    return paths


def _bar(
    symbol: str,
    day: date,
    *,
    open_price: str = "100",
    close: str = "100",
    quote_volume: str = "10000000",
) -> vg24.Bar:
    opened = (day - date(1970, 1, 1)).days * vg24.DAY_US
    open_value = D(open_price)
    close_value = D(close)
    return vg24.Bar(
        symbol,
        day,
        open_value,
        max(open_value, close_value) + D("1"),
        min(open_value, close_value) - D("1"),
        close_value,
        D(quote_volume),
        opened,
        opened + vg24.DAY_US - 1,
    )


def _archive_record(
    root: Path,
    *,
    symbol: str = "TESTUSDT",
    month: str = "2025-07",
    rows: list[str] | None = None,
    zip_bytes: bytes | None = None,
) -> dict[str, Any]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True, exist_ok=True)
    archive_name = f"{symbol}-1d-{month}.zip"
    archive_path = directory / archive_name
    if zip_bytes is None:
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr(
                archive_name.removesuffix(".zip") + ".csv",
                "".join(rows or []),
            )
    else:
        archive_path.write_bytes(zip_bytes)
    archive_raw = archive_path.read_bytes()
    archive_sha = hashlib.sha256(archive_raw).hexdigest()
    checksum_path = directory / f"{archive_name}.CHECKSUM"
    checksum_path.write_text(f"{archive_sha}  {archive_name}\n", encoding="ascii")
    checksum_raw = checksum_path.read_bytes()
    checksum_sha = hashlib.sha256(checksum_raw).hexdigest()
    pair_path = directory / "pair.v1.json"
    pair_path.write_text(
        json.dumps(
            {
                "checksumSha256": checksum_sha,
                "month": month,
                "symbol": symbol,
                "zipSha256": archive_sha,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    pair_raw = pair_path.read_bytes()
    return {
        "checksumBytes": len(checksum_raw),
        "checksumFrozenEtag": "checksum-etag",
        "checksumFrozenLastModified": "2026-01-01T00:00:00.000Z",
        "checksumPath": str(checksum_path.relative_to(root)),
        "checksumSha256": checksum_sha,
        "month": month,
        "pairBytes": len(pair_raw),
        "pairPath": str(pair_path.relative_to(root)),
        "pairSha256": hashlib.sha256(pair_raw).hexdigest(),
        "symbol": symbol,
        "zipBytes": len(archive_raw),
        "zipFrozenEtag": "zip-etag",
        "zipFrozenLastModified": "2026-01-01T00:00:00.000Z",
        "zipPath": str(archive_path.relative_to(root)),
        "zipSha256": archive_sha,
    }


def _daily_row(
    day: date,
    *,
    close_time_delta: int | None = None,
) -> str:
    opened = (day - date(1970, 1, 1)).days * vg24.DAY_US
    close_time = opened + vg24.DAY_US - 1 if close_time_delta is None else opened + close_time_delta
    return f"{opened},100,102,99,101,12,{close_time},1200,7,5,500,0\n"


def _simulation_panel(
    signal_day: date,
    symbols: tuple[str, ...],
) -> dict[str, dict[date, vg24.Bar]]:
    entry_day = signal_day + timedelta(days=2)
    start = entry_day - timedelta(days=30)
    end = entry_day + timedelta(days=5)
    panel: dict[str, dict[date, vg24.Bar]] = {}
    for index, symbol in enumerate(symbols):
        panel[symbol] = {
            day: _bar(
                symbol,
                day,
                open_price="100" if day < entry_day + timedelta(days=1) else "102",
                close="100" if day < entry_day else "101",
                quote_volume=str(10_000_000 + index),
            )
            for day in vg24.date_range(start, end)
        }
    return panel


def _signal(signal_day: date, targets: tuple[str, ...]) -> vg24.Signal:
    return vg24.Signal(
        signal_day,
        targets,
        {symbol: D(index) for index, symbol in enumerate(targets)},
        targets,
        targets,
        (),
        (),
    )


def test_trial_family_and_static_path_order_are_exact() -> None:
    assert [trial.trial_id for trial in vg24.trial_grid()] == [
        "VG24-K03-H1",
        "VG24-K03-H3",
        "VG24-K05-H1",
        "VG24-K05-H3",
        "VG24-K08-H1",
        "VG24-K08-H3",
    ]
    protocol = json.loads(vg24.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert protocol["trials"]["trialIdsInOrder"] == [trial.trial_id for trial in vg24.trial_grid()]
    assert tuple(sorted(vg24.STATIC_PATHS)) == vg24.STATIC_PATHS


def test_protocol_binds_dual_inference_capacity_and_local_claim_boundary() -> None:
    protocol = json.loads(vg24.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert protocol["formalDevelopmentGates"]["minimumOneBpCapacityProxyUsd"] == "1000"
    assert protocol["inference"]["bootstrap"]["blockLengthDays"] == 28
    assert protocol["inference"]["bootstrap"]["replicates"] == 4096
    assert set(protocol["inference"]["holm"]["families"]) == {
        "vsCash",
        "vsMatchedComparator",
    }
    assert protocol["inference"]["pbo"]["symmetricSplitCount"] == 70
    assert protocol["truthBoundary"]["localPositiveCanBeVerifiedPositive"] is False
    assert protocol["selection"]["runnerUpRescue"].startswith("FORBIDDEN")


def test_every_seal_is_exclusive_and_fsyncs_file_and_parent(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []
    real_fsync = os.fsync

    def tracked(descriptor: int) -> None:
        calls.append(descriptor)
        real_fsync(descriptor)

    monkeypatch.setattr(os, "fsync", tracked)
    path = tmp_path / "seal.v1.json"
    vg24.write_once(path, {"state": "SEALED"})
    assert len(calls) >= 2
    with pytest.raises(FileExistsError):
        vg24.write_once(path, {"state": "REPAIRED"})
    assert json.loads(path.read_text(encoding="utf-8")) == {"state": "SEALED"}


def test_metadata_freeze_never_constructs_or_lists_a_zip(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = _archive_record(tmp_path, zip_bytes=b"compressed-bytes-need-not-be-valid")
    source_record = {
        key: value
        for key, value in record.items()
        if key
        in {
            "checksumBytes",
            "checksumFrozenEtag",
            "checksumFrozenLastModified",
            "checksumSha256",
            "month",
            "symbol",
            "zipBytes",
            "zipFrozenEtag",
            "zipFrozenLastModified",
            "zipSha256",
        }
    }
    acquisition = {
        "artifactPairs": [source_record],
        "schema": "S1FAcquisitionManifestV1",
        "state": "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED",
    }
    discovery = {
        "exclusions": {
            "pairedLeveragedSha256": "a" * 64,
            "pairedLeveragedSymbols": [],
            "stableOrFiatSha256": "b" * 64,
            "stableOrFiatSymbols": [],
        },
        "universe": {"sha256": "c" * 64, "symbols": ["TESTUSDT"]},
    }
    monkeypatch.setattr(vg24, "SOURCE_MONTHS", ("2025-07",))
    monkeypatch.setattr(vg24, "COHORT_SIZE", 1)

    def forbidden(*args: object, **kwargs: object) -> None:
        del args, kwargs
        raise AssertionError("metadata freeze touched a ZIP container")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden)
    manifest = vg24.build_source_manifest(tmp_path, acquisition, discovery)
    assert manifest["recordCount"] == 1
    assert manifest["zipContainerConstructedDuringFreeze"] is False
    assert manifest["zipMemberAccessDuringFreeze"] is False


def test_first_member_access_requires_exact_clean_freeze_head(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bindings = {
        "distinctnessSha256": tmp_path / "DISTINCTNESS.md",
        "officialSourceResearchSha256": tmp_path / "OFFICIAL_SOURCE_RESEARCH.md",
        "officialSourcesSha256": tmp_path / "official_sources.v1.json",
        "protocolSha256": tmp_path / "protocol.v1.json",
        "readmeSha256": tmp_path / "README.md",
        "sourceManifestSha256": tmp_path / "source-manifest.v1.json",
        "testsSha256": tmp_path / "test_experiment.py",
    }
    for name, path in bindings.items():
        path.write_text(name, encoding="utf-8")
    freeze_path = tmp_path / "freeze.v1.json"
    monkeypatch.setattr(vg24, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg24, "DISTINCTNESS_PATH", bindings["distinctnessSha256"])
    monkeypatch.setattr(
        vg24,
        "SOURCE_RESEARCH_PATH",
        bindings["officialSourceResearchSha256"],
    )
    monkeypatch.setattr(vg24, "OFFICIAL_SOURCES_PATH", bindings["officialSourcesSha256"])
    monkeypatch.setattr(vg24, "PROTOCOL_PATH", bindings["protocolSha256"])
    monkeypatch.setattr(vg24, "README_PATH", bindings["readmeSha256"])
    monkeypatch.setattr(vg24, "SOURCE_MANIFEST_PATH", bindings["sourceManifestSha256"])
    monkeypatch.setattr(vg24, "TESTS_PATH", bindings["testsSha256"])
    static_commit = "a" * 40
    freeze_commit = "b" * 40
    freeze = {
        "baseCommit": vg24.BASE_COMMIT,
        "evaluatorSha256": vg24.sha256_path(Path(vg24.__file__)),
        "holdoutMaximumOpenCount": 1,
        "schema": "VG24FreezeV1",
        "sourceRoot": str(tmp_path.resolve()),
        "staticChangedPaths": list(vg24.STATIC_PATHS),
        "staticCommit": static_commit,
        "staticParentCommit": vg24.BASE_COMMIT,
        **{name: vg24.sha256_path(path) for name, path in bindings.items()},
    }
    freeze_path.write_bytes(vg24.canonical_bytes(freeze))
    git_state = {"head": "c" * 40, "status": ""}

    def fake_git(*args: str) -> str:
        if args[:3] == ("log", "-1", "--format=%H"):
            return freeze_commit
        if args[:3] == ("show", "-s", "--format=%P"):
            return static_commit
        if args[0] == "diff-tree":
            return "quant/research/vg24/freeze.v1.json\nquant/research/vg24/source-manifest.v1.json"
        if args == ("rev-parse", "HEAD"):
            return git_state["head"]
        if args == ("status", "--porcelain=v1"):
            return git_state["status"]
        raise AssertionError(args)

    monkeypatch.setattr(vg24, "git_output", fake_git)
    with pytest.raises(vg24.VG24Error, match="exact freeze-commit HEAD"):
        vg24.verify_freeze(tmp_path, require_freeze_head=True)
    git_state["head"] = freeze_commit
    git_state["status"] = " M quant/research/vg24/freeze.v1.json"
    with pytest.raises(vg24.VG24Error, match="clean freeze tree"):
        vg24.verify_freeze(tmp_path, require_freeze_head=True)
    git_state["status"] = ""
    assert vg24.verify_freeze(tmp_path, require_freeze_head=True) == freeze


def test_injected_ordinary_exception_seals_exact_unmeasured_receipt_chain(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _patch_lifecycle_paths(tmp_path, monkeypatch)
    paths["FREEZE_PATH"].write_bytes(vg24.canonical_bytes({"schema": "test-freeze"}))
    static_commit = "a" * 40
    freeze_head_requirements: list[bool] = []

    def frozen(
        state_root: Path,
        *,
        require_freeze_head: bool = False,
    ) -> dict[str, Any]:
        del state_root
        freeze_head_requirements.append(require_freeze_head)
        return {"staticCommit": static_commit}

    def injected() -> set[str]:
        raise KeyError("hostile injected ordinary exception")

    monkeypatch.setattr(vg24, "verify_freeze", frozen)
    monkeypatch.setattr(vg24, "source_symbols", injected)
    result = vg24.run_command(tmp_path)
    assert freeze_head_requirements == [True]
    assert result["verdict"] == "UNMEASURED"
    assert result["reason"] == "KeyError:'hostile injected ordinary exception'"
    terminal = vg24.load_json(paths["TERMINAL_PATH"])
    assert terminal["state"] == "TERMINAL_UNMEASURED_NO_REPAIR_NO_RERUN"
    expected_names = tuple(
        sorted(
            (
                "development-open.v1.json",
                "freeze.v1.json",
                "result.v1.json",
                "run-marker.v1.json",
                "terminal.v1.json",
            )
        )
    )
    actual_names = tuple(
        line.split("  ", 1)[1]
        for line in paths["SHA256SUMS_PATH"].read_text(encoding="utf-8").splitlines()
    )
    assert actual_names == expected_names
    assert vg24.verify_command(tmp_path)["verdict"] == "UNMEASURED"
    assert freeze_head_requirements == [True, False]

    development_open = vg24.load_json(paths["DEVELOPMENT_OPEN_PATH"])
    development_open["runMarkerSha256"] = "0" * 64
    paths["DEVELOPMENT_OPEN_PATH"].write_bytes(vg24.canonical_bytes(development_open))

    def sha_already_checked() -> None:
        return None

    monkeypatch.setattr(vg24, "verify_sha256s", sha_already_checked)
    with pytest.raises(vg24.VG24Error, match="development-open receipt chain"):
        vg24.verify_command(tmp_path)


def test_post_result_exception_preserves_measured_result_terminal_class(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    paths = _patch_lifecycle_paths(tmp_path, monkeypatch)
    paths["FREEZE_PATH"].write_bytes(vg24.canonical_bytes({"schema": "test-freeze"}))
    paths["RUN_MARKER_PATH"].write_bytes(vg24.canonical_bytes({"schema": "test-run"}))
    measured = {
        "localPublicScreenVerdict": "NO_GO",
        "verdict": "NO_GO",
    }
    paths["RESULT_PATH"].write_bytes(vg24.canonical_bytes(measured))
    returned = vg24.terminal_unmeasured(
        "RuntimeError:after result seal",
        {"staticCommit": "a" * 40},
    )
    assert returned == measured
    assert vg24.load_json(paths["RESULT_PATH"]) == measured
    assert vg24.load_json(paths["TERMINAL_PATH"])["state"] == "TERMINAL_SEALED_NO_REPAIR_NO_RERUN"
    with pytest.raises(vg24.VG24Error, match="cannot be reconciled"):
        vg24.terminal_state_for_result(
            {
                "localPublicScreenVerdict": "NO_GO",
                "verdict": "UNMEASURED",
            }
        )


def test_parser_accepts_exact_microsecond_daily_contract(tmp_path: Path) -> None:
    record = _archive_record(tmp_path, rows=[_daily_row(date(2025, 7, 1))])
    bars = vg24.parse_archive(record, tmp_path)
    assert len(bars) == 1
    assert bars[0].day == date(2025, 7, 1)
    assert bars[0].quote_volume == D("1200")


def test_parser_rejects_millisecond_timestamps(tmp_path: Path) -> None:
    day = date(2025, 7, 1)
    opened_ms = int(((day - date(1970, 1, 1)).days * vg24.DAY_US) / 1000)
    row = f"{opened_ms},100,102,99,101,12,{opened_ms + 86400000 - 1},1200,7,5,500,0\n"
    record = _archive_record(tmp_path, rows=[row])
    with pytest.raises(vg24.MeasurementError, match="millisecond timestamp"):
        vg24.parse_archive(record, tmp_path)


def test_only_publisher_partial_terminal_day_is_ineligible(tmp_path: Path) -> None:
    first = date(2025, 7, 1)
    partial = _daily_row(
        first + timedelta(days=1),
        close_time_delta=vg24.DAY_US // 2,
    )
    record = _archive_record(tmp_path, rows=[_daily_row(first), partial])
    assert [bar.day for bar in vg24.parse_archive(record, tmp_path)] == [first]

    root = tmp_path / "nonterminal"
    record = _archive_record(
        root,
        rows=[partial, _daily_row(first + timedelta(days=2))],
    )
    with pytest.raises(vg24.MeasurementError, match="daily close boundary"):
        vg24.parse_archive(record, root)

    root = tmp_path / "close-before-open"
    record = _archive_record(
        root,
        rows=[_daily_row(first, close_time_delta=-1)],
    )
    with pytest.raises(vg24.MeasurementError, match="close precedes open"):
        vg24.parse_archive(record, root)

    root = tmp_path / "wrong-month"
    record = _archive_record(
        root,
        rows=[_daily_row(date(2025, 8, 1), close_time_delta=vg24.DAY_US // 2)],
    )
    with pytest.raises(vg24.MeasurementError, match="outside archive month"):
        vg24.parse_archive(record, root)


@pytest.mark.parametrize(
    "row",
    [
        "{opened},100,102,99,101,12,{closed},-1,7,5,500,0\n",
        "{opened},Infinity,Infinity,99,101,12,{closed},1200,7,5,500,0\n",
    ],
)
def test_partial_terminal_row_still_requires_finite_valid_ohlcv(
    tmp_path: Path,
    row: str,
) -> None:
    day = date(2025, 7, 1)
    opened = (day - date(1970, 1, 1)).days * vg24.DAY_US
    record = _archive_record(
        tmp_path,
        rows=[
            row.format(
                opened=opened,
                closed=opened + vg24.DAY_US // 2,
            )
        ],
    )
    with pytest.raises(vg24.MeasurementError, match="invalid OHLCV"):
        vg24.parse_archive(record, tmp_path)


def test_parser_rejects_duplicate_full_day(tmp_path: Path) -> None:
    row = _daily_row(date(2025, 7, 1))
    record = _archive_record(tmp_path, rows=[row, row])
    with pytest.raises(vg24.MeasurementError, match="duplicate or unsorted"):
        vg24.parse_archive(record, tmp_path)


def test_dynamic_top30_uses_only_prior_thirty_days() -> None:
    day = date(2025, 7, 6)
    symbols = tuple(f"S{index:02d}USDT" for index in range(31))
    panel: dict[str, dict[date, vg24.Bar]] = {}
    for index, symbol in enumerate(symbols):
        panel[symbol] = {
            history_day: _bar(
                symbol,
                history_day,
                quote_volume=str(1_000_000 + index),
            )
            for history_day in vg24.prior_days(day, 30)
        }
        panel[symbol][day] = _bar(symbol, day, quote_volume="1")
        panel[symbol][day + timedelta(days=1)] = _bar(
            symbol,
            day + timedelta(days=1),
            quote_volume="999999999999",
        )
    before = vg24.dynamic_cohort(panel, day)
    for symbol in symbols[:5]:
        panel[symbol][day] = _bar(symbol, day, quote_volume="999999999999")
    assert vg24.dynamic_cohort(panel, day) == before
    assert len(before) == 30
    assert symbols[0] not in before


def test_robust_surprise_is_prior_only() -> None:
    day = date(2025, 7, 6)
    symbol = "TESTUSDT"
    series = {
        history_day: _bar(
            symbol,
            history_day,
            quote_volume=str(1_000_000 + index * index),
        )
        for index, history_day in enumerate(vg24.prior_days(day, 60))
    }
    series[day] = _bar(symbol, day, quote_volume="9000000")
    panel = {symbol: series}
    before = vg24.raw_surprise(panel, symbol, day)
    panel[symbol][day + timedelta(days=1)] = _bar(
        symbol,
        day + timedelta(days=1),
        quote_volume="999999999999999",
    )
    assert vg24.raw_surprise(panel, symbol, day) == before
    assert before is not None


def test_lag_two_fit_ends_at_source_d_minus_3_and_target_d_minus_1(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signal_day = date(2025, 7, 6)
    source_days = vg24.prior_days(signal_day - timedelta(days=2), 120)
    rng = random.Random(4242)
    shocks = [D(rng.randrange(-10_000, 10_001)) for _ in source_days]
    history: dict[date, dict[str, Decimal]] = {}
    for source_day, shock in zip(source_days, shocks, strict=True):
        history.setdefault(source_day, {})["IUSDT"] = shock
        history.setdefault(source_day, {}).setdefault("JUSDT", D(rng.randrange(-10_000, 10_001)))
        target_day = source_day + timedelta(days=2)
        history.setdefault(target_day, {})["JUSDT"] = shock
        history.setdefault(target_day, {}).setdefault("IUSDT", D(rng.randrange(-10_000, 10_001)))
    monkeypatch.setattr(vg24, "MINIMUM_FULL_PAIRS", 120)
    monkeypatch.setattr(vg24, "MINIMUM_HALF_PAIRS", 60)
    edge = vg24.fit_edge(history, signal_day, "IUSDT", "JUSDT")
    assert edge is not None
    assert edge.observations == 120

    future_changed = copy.deepcopy(history)
    future_changed[signal_day] = {"IUSDT": D("1e50"), "JUSDT": D("-1e50")}
    future_changed[signal_day + timedelta(days=1)] = {
        "IUSDT": D("-1e50"),
        "JUSDT": D("1e50"),
    }
    assert vg24.fit_edge(future_changed, signal_day, "IUSDT", "JUSDT") == edge

    missing_latest_source = copy.deepcopy(history)
    del missing_latest_source[signal_day - timedelta(days=3)]["IUSDT"]
    assert vg24.fit_edge(missing_latest_source, signal_day, "IUSDT", "JUSDT") is None
    missing_latest_target = copy.deepcopy(history)
    del missing_latest_target[signal_day - timedelta(days=1)]["JUSDT"]
    assert vg24.fit_edge(missing_latest_target, signal_day, "IUSDT", "JUSDT") is None


def test_active_sources_are_excluded_from_both_target_pools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signal_day = date(2025, 7, 6)
    cohort = ("AUSDT", "BUSDT", "CUSDT", "DUSDT")
    current = {
        "AUSDT": D("3"),
        "BUSDT": D("2.5"),
        "CUSDT": D("1"),
        "DUSDT": D("0"),
    }

    class Cache:
        def cohort(self, day: date) -> tuple[str, ...]:
            del day
            return cohort

        def residuals(self, day: date) -> dict[str, Decimal]:
            del day
            return current

    def eligible(
        history: object,
        day: date,
        source: str,
        target: str,
    ) -> vg24.Edge:
        del history, day
        return vg24.Edge(source, target, D("0.5"), D("0.5"), D("0.5"), D("0"), D("0.5"), 120)

    monkeypatch.setattr(vg24, "COHORT_SIZE", 4)
    monkeypatch.setattr(vg24, "fit_edge", eligible)
    signal = vg24.build_signal(Cache(), signal_day)  # type: ignore[arg-type]
    assert signal.active_sources == ("AUSDT", "BUSDT")
    assert set(signal.downstream) == {"CUSDT", "DUSDT"}
    assert set(signal.comparator) == {"CUSDT", "DUSDT"}


def test_monday_is_untouched_by_signal_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signal_day = date(2025, 7, 6)
    cohort = tuple(f"S{index:02d}USDT" for index in range(4))
    current = {
        symbol: D("3") if index == 0 else D(index) / D(10) for index, symbol in enumerate(cohort)
    }
    called: list[date] = []

    class Cache:
        def cohort(self, day: date) -> tuple[str, ...]:
            assert day == signal_day
            return cohort

        def residuals(self, day: date) -> dict[str, Decimal]:
            called.append(day)
            if day >= signal_day + timedelta(days=1):
                raise AssertionError("Monday or later reached signal construction")
            return current

    def eligible(
        history: object,
        day: date,
        source: str,
        target: str,
    ) -> vg24.Edge:
        del history, day
        return vg24.Edge(source, target, D("0.5"), D("0.5"), D("0.5"), D("0"), D("0.5"), 120)

    monkeypatch.setattr(vg24, "COHORT_SIZE", 4)
    monkeypatch.setattr(vg24, "fit_edge", eligible)
    vg24.build_signal(Cache(), signal_day)  # type: ignore[arg-type]
    assert max(called) == signal_day


def test_missing_preentry_makes_whole_cohort_and_comparator_cash() -> None:
    signal_day = date(2025, 7, 6)
    targets = ("AUSDT", "BUSDT", "CUSDT")
    panel = _simulation_panel(signal_day, targets)
    del panel["AUSDT"][signal_day + timedelta(days=1)]
    simulation = vg24.simulate_trial(
        panel,
        {signal_day: _signal(signal_day, targets)},
        (signal_day,),
        vg24.Trial("TEST", 3, 1),
    )
    assert simulation.active_weeks == 0
    assert simulation.cash_weeks == 1
    assert all(values == (D("0"),) for values in simulation.weekly_returns.values())
    assert all(values == (D("0"),) for values in simulation.comparator_weekly_returns.values())


def test_missing_postentry_exit_is_terminal_unmeasured() -> None:
    signal_day = date(2025, 7, 6)
    targets = ("AUSDT", "BUSDT", "CUSDT")
    panel = _simulation_panel(signal_day, targets)
    exit_day = signal_day + timedelta(days=3)
    del panel["AUSDT"][exit_day]
    with pytest.raises(vg24.MeasurementError, match="scheduled post-entry exit"):
        vg24.simulate_trial(
            panel,
            {signal_day: _signal(signal_day, targets)},
            (signal_day,),
            vg24.Trial("TEST", 3, 1),
        )


def test_comparator_preentry_failure_is_terminal_not_network_cash() -> None:
    signal_day = date(2025, 7, 6)
    network = ("AUSDT", "BUSDT", "CUSDT")
    comparator = ("DUSDT", "EUSDT", "FUSDT")
    panel = _simulation_panel(signal_day, (*network, *comparator))
    del panel["DUSDT"][signal_day + timedelta(days=1)]
    signal = vg24.Signal(
        signal_day,
        (*network, *comparator),
        {},
        network,
        comparator,
        (),
        (),
    )
    with pytest.raises(vg24.MeasurementError, match="comparator missing pre-entry"):
        vg24.simulate_trial(
            panel,
            {signal_day: signal},
            (signal_day,),
            vg24.Trial("TEST", 3, 1),
        )


def test_missing_posthoc_capacity_never_converts_valid_entry_to_cash() -> None:
    signal_day = date(2025, 7, 6)
    targets = ("AUSDT", "BUSDT", "CUSDT")
    panel = _simulation_panel(signal_day, targets)
    entry_day = signal_day + timedelta(days=2)
    del panel["AUSDT"][entry_day - timedelta(days=30)]
    simulation = vg24.simulate_trial(
        panel,
        {signal_day: _signal(signal_day, targets)},
        (signal_day,),
        vg24.Trial("TEST", 3, 1),
    )
    assert simulation.active_weeks == 1
    assert simulation.cash_weeks == 0
    assert simulation.capacity_complete is False
    assert simulation.capacities_usd == ()


def test_flat_price_cost_identity_and_scenario_monotonicity() -> None:
    returns = {
        name: vg24.round_trip_return(
            D("100"),
            D("100"),
            fee_bps=cost[0],
            adverse_bps=cost[1],
        )
        for name, cost in vg24.COSTS.items()
    }
    assert returns["gross"] == 0
    assert returns["publicBase"] < 0
    assert returns["publicStress"] < returns["publicBase"]
    assert returns["feeStress"] < returns["publicStress"]
    expected_base = ((D("0.999") / D("100.1")) * D("99.9") * D("0.999")) - D("1")
    assert returns["publicBase"] == expected_base


def test_capacity_is_one_bp_of_prior_only_quote_volume() -> None:
    entry = date(2025, 7, 8)
    exit_day = entry + timedelta(days=3)
    targets = ("AUSDT", "BUSDT", "CUSDT")
    panel = {
        symbol: {
            day: _bar(symbol, day, quote_volume="10000000")
            for day in vg24.date_range(entry - timedelta(days=30), exit_day)
        }
        for symbol in targets
    }
    before = vg24.capacity_proxy(panel, targets, entry, exit_day)
    for symbol in targets:
        panel[symbol][exit_day] = _bar(symbol, exit_day, quote_volume="999999999999")
        panel[symbol][exit_day + timedelta(days=1)] = _bar(
            symbol,
            exit_day + timedelta(days=1),
            quote_volume="999999999999",
        )
    assert vg24.capacity_proxy(panel, targets, entry, exit_day) == before == D("3000")
    for symbol in targets:
        for day in vg24.date_range(entry - timedelta(days=30), entry - timedelta(days=10)):
            panel[symbol][day] = _bar(symbol, day, quote_volume="20000000")
    assert cast_decimal(vg24.capacity_proxy(panel, targets, entry, exit_day)) > cast_decimal(before)


def cast_decimal(value: Decimal | None) -> Decimal:
    assert value is not None
    return value


def test_all_six_trials_share_the_full_cash_day_calendar() -> None:
    days = vg24.scheduled_sundays(date(2025, 7, 1), date(2026, 3, 1))
    signals = {day: vg24.Signal(day, (), {}, (), (), (), ()) for day in days}
    simulations = [vg24.simulate_trial({}, signals, days, trial) for trial in vg24.trial_grid()]
    assert len({simulation.signal_days for simulation in simulations}) == 1
    assert all(simulation.cash_weeks == len(days) for simulation in simulations)
    assert all(
        all(value == 0 for value in simulation.weekly_returns["publicStress"])
        for simulation in simulations
    )


def test_cost_drag_turnover_reconcile_and_matched_lcb_is_a_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signal_day = date(2025, 7, 6)
    targets = tuple(f"S{index:02d}USDT" for index in range(8))
    panel = _simulation_panel(signal_day, targets)
    simulation = vg24.simulate_trial(
        panel,
        {signal_day: _signal(signal_day, targets)},
        (signal_day,),
        vg24.Trial("TEST", 3, 1),
    )
    monkeypatch.setattr(vg24, "BOOTSTRAP_REPLICATES", 32)
    summary = vg24.simulation_summary(
        simulation,
        interval_seed=17,
        holm_cash_pvalue=0.001,
        holm_comparator_pvalue=0.001,
        white_cash_pvalue=0.001,
        white_comparator_pvalue=0.001,
        development=True,
    )
    decomposition = summary["costAndTurnoverDecomposition"]
    assert isinstance(decomposition, dict)
    for scenario in vg24.COSTS:
        row = decomposition[scenario]
        assert D(row["identityResidualUsd"]) == 0
        assert D(row["normalizedTwoWayTurnoverUsd"]) > 0
        assert row["turnoverFills"] == 6
    assert D(decomposition["publicBase"]["feeDragUsd"]) > 0
    summary["publicStressMatchedExcessOneSided95LowerUsd"] = "-0.0001"
    assert "PUBLIC_STRESS_COMPARATOR_EXCESS_INTERVAL_LOWER" in vg24.evaluate_gates(
        summary,
        development=True,
    )


def test_matched_interval_bootstraps_terminal_usd_difference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg24, "BOOTSTRAP_REPLICATES", 32)
    network = (D("0.01"), D("-0.005"), D("0"), D("0.02"))
    assert vg24.bootstrap_matched_excess_interval(
        network,
        network,
        seed=23,
    ) == (D("0"), D("0"))


def test_champion_tie_break_is_lower_h_then_k_then_lexicographic() -> None:
    days = (date(2025, 7, 6),)
    empty_signals = {days[0]: vg24.Signal(days[0], (), {}, (), (), (), ())}
    simulations = {
        trial.trial_id: vg24.simulate_trial({}, empty_signals, days, trial)
        for trial in vg24.trial_grid()
    }
    summaries = {
        trial_id: {
            "netUsdPerInitial1000": {"publicStress": "1"},
            "publicStressMatchedExcessOneSided95LowerUsd": "1",
        }
        for trial_id in simulations
    }
    assert vg24.select_champion(summaries, simulations) == "VG24-K03-H1"


def test_holdout_calendar_forbids_june_28_exit_beyond_partition() -> None:
    days = vg24.scheduled_sundays(vg24.HOLDOUT_START, vg24.HOLDOUT_END)
    assert days[0] == date(2026, 3, 1)
    assert days[-1] == date(2026, 6, 21)
    assert date(2026, 6, 28) not in days


def test_pbo_uses_exactly_eight_month_blocks_and_seventy_splits() -> None:
    days = vg24.scheduled_sundays(vg24.DEVELOPMENT_START, vg24.DEVELOPMENT_END)
    matrix = {
        trial.trial_id: tuple(
            D(((index + trial.target_count + trial.hold_days) % 9) - 4) / D("1000")
            for index in range(len(days))
        )
        for trial in vg24.trial_grid()
    }
    report = vg24.pbo_report(matrix, days)
    assert report["blockCount"] == 8
    assert report["splitCount"] == 70
    assert report["diagnosticOnly"] is True


def test_white_reality_check_requires_all_six_synchronous_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vg24, "BOOTSTRAP_REPLICATES", 32)
    matrix = {
        trial.trial_id: tuple(D(index + trial.target_count) / D("10000") for index in range(12))
        for trial in vg24.trial_grid()
    }
    report = vg24.white_reality_check(matrix)
    assert report["familySize"] == 6
    assert report["blockLengthDays"] == 28
    incomplete = dict(matrix)
    incomplete.pop(next(iter(incomplete)))
    with pytest.raises(vg24.MeasurementError, match="all six"):
        vg24.white_reality_check(incomplete)
