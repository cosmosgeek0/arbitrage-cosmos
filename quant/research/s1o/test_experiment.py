from __future__ import annotations

import json
import os
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import cast

import pytest

from . import experiment as s1o


def _write_archive(root: Path, spec: s1o.ArchiveSpec, member_name: str, text: str) -> Path:
    archive, checksum = s1o._archive_paths(root, spec)
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr(member_name, text)
    digest = s1o.sha256_file(archive)
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    return archive


def _bar(open_time_ms: int, close: str = "100", quote_volume: str = "4000000") -> s1o.Bar:
    return s1o.Bar(
        open_time_ms,
        open_time_ms + s1o.FIVE_MINUTES_MS - 1,
        Decimal(close),
        Decimal(quote_volume),
    )


def _source_manifest_fixture() -> dict[str, object]:
    records = [
        {
            "key": spec.key,
            "relative_archive": str(Path(spec.custody) / spec.relative_path),
            "relative_checksum": (str(Path(spec.custody) / spec.relative_path) + ".CHECKSUM"),
            "sha256": "a" * 64,
            "bytes": 1,
        }
        for spec in s1o.build_acquisition_plan()
    ]
    manifest: dict[str, object] = {
        "schema": "cosmos.s1o.data-manifest.v1",
        "protocol_sha256": s1o.sha256_file(s1o.PROTOCOL_PATH),
        "archive_count": len(records),
        "archives": records,
    }
    manifest["manifest_sha256"] = s1o.sha256_bytes(s1o.canonical_json_bytes(manifest))
    return manifest


def test_protocol_and_acquisition_plan_are_frozen_and_partitioned() -> None:
    protocol = s1o.load_protocol()
    assert protocol["schema"] == "cosmos.s1o.protocol.v1"
    specs = s1o.build_acquisition_plan()
    assert len(specs) == 437
    feb_funding = [
        spec for spec in specs if spec.dataset == "funding_rate" and spec.period == "2026-02"
    ]
    assert [spec.custody for spec in feb_funding] == ["development", "holdout"]
    assert all(spec.url.startswith(s1o.BASE_URL) for spec in specs)
    hypothesis = cast(dict[str, object], protocol["hypothesis"])
    assert hypothesis["family"] == "OWN_SYMBOL_TEMPORAL_FUNDING_SIGN_PERSISTENCE"
    excluded = cast(list[object], hypothesis["excluded_families"])
    assert "cross-sectional ranks or tails" in excluded
    assert "funding acceleration or second difference" in excluded


def test_acquire_refuses_before_freeze_without_network(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    downloads: list[str] = []

    def refuse_freeze() -> dict[str, object]:
        raise s1o.EvidenceError("FREEZE_REQUIRED")

    def record_download(url: str, destination: Path) -> None:
        downloads.append(url)

    monkeypatch.setattr(s1o, "verify_freeze", refuse_freeze)
    monkeypatch.setattr(s1o, "_download", record_download)
    with pytest.raises(s1o.EvidenceError, match="FREEZE_REQUIRED"):
        s1o.acquire(tmp_path / "new-data-root")
    assert downloads == []
    assert not (tmp_path / "new-data-root").exists()


def test_freeze_artifact_is_create_once(tmp_path: Path) -> None:
    path = tmp_path / "freeze.json"
    original: dict[str, object] = {"schema": "freeze", "digest": "a"}
    s1o._create_immutable_json(path, original)
    s1o._create_immutable_json(path, original)
    with pytest.raises(s1o.EvidenceError, match="IMMUTABLE_ARTIFACT_MISMATCH"):
        s1o._create_immutable_json(path, {"schema": "freeze", "digest": "b"})
    assert json.loads(path.read_text(encoding="utf-8")) == original


def test_checksum_mismatch_fails_closed(tmp_path: Path) -> None:
    spec = s1o.ArchiveSpec("development", "metrics", "x", "sample.zip")
    archive = _write_archive(tmp_path, spec, "sample.csv", "a,b\n1,2\n")
    archive.write_bytes(archive.read_bytes() + b"tamper")
    with pytest.raises(s1o.EvidenceError, match="CHECKSUM_MISMATCH"):
        s1o.verify_archive(tmp_path, spec)


def test_symlink_hardlink_and_wrong_root_marker_fail_closed(tmp_path: Path) -> None:
    regular = tmp_path / "regular"
    regular.write_bytes(b"x")
    symlink = tmp_path / "symlink"
    symlink.symlink_to(regular)
    with pytest.raises(s1o.EvidenceError, match="REGULAR_FILE_REQUIRED"):
        s1o._regular_file_identity(symlink)

    hardlink = tmp_path / "hardlink"
    os.link(regular, hardlink)
    with pytest.raises(s1o.EvidenceError, match="HARDLINK_FORBIDDEN"):
        s1o._require_distinct_regular_files((regular, hardlink))

    data_root = tmp_path / "data-root"
    data_root.mkdir()
    (data_root / "S1O_DATA_ROOT.json").write_text(
        json.dumps(
            {
                "schema": "cosmos.s1o.data-root.v1",
                "protocol_sha256": s1o.sha256_file(s1o.PROTOCOL_PATH),
                "base_url": s1o.BASE_URL,
                "canonical_data_root": str(tmp_path / "wrong-root"),
            }
        ),
        encoding="utf-8",
    )
    (data_root / "S1O_DATA_MANIFEST.json").write_text("{}\n", encoding="utf-8")
    with pytest.raises(s1o.EvidenceError, match="DATA_ROOT_MARKER_MISMATCH"):
        s1o.verify_data_manifest(data_root)


def test_source_manifest_internal_rehash_cannot_hide_record_tamper() -> None:
    manifest = _source_manifest_fixture()
    assert s1o._validate_source_data_manifest_payload(manifest) == manifest["manifest_sha256"]
    records = cast(list[object], manifest["archives"])
    first = cast(dict[str, object], records[0])
    first["key"] = "tampered"
    without_digest = dict(manifest)
    without_digest.pop("manifest_sha256")
    manifest["manifest_sha256"] = s1o.sha256_bytes(s1o.canonical_json_bytes(without_digest))
    with pytest.raises(s1o.EvidenceError, match="DATA_MANIFEST_RECORD_FIELDS_MISMATCH"):
        s1o._validate_source_data_manifest_payload(manifest)


def test_stale_run_artifact_refuses_before_consumption(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(s1o, "GENERATED_ROOT", tmp_path)
    (tmp_path / "result.v1.json").write_text("{}\n", encoding="utf-8")
    with pytest.raises(s1o.EvidenceError, match="STALE_RUN_ARTIFACTS"):
        s1o._prepare_run_artifacts(_source_manifest_fixture())
    assert not (tmp_path / "RUN_CONSUMED.json").exists()
    assert not (tmp_path / "source-data-manifest.v1.json").exists()


def test_verified_source_manifest_is_copied_before_run_marker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(s1o, "GENERATED_ROOT", tmp_path)
    manifest = _source_manifest_fixture()
    s1o._prepare_run_artifacts(manifest)
    assert s1o.verify_source_data_manifest_copy() == manifest
    assert not (tmp_path / "RUN_CONSUMED.json").exists()
    changed = dict(manifest)
    changed["manifest_sha256"] = "0" * 64
    with pytest.raises(s1o.EvidenceError, match="IMMUTABLE_ARTIFACT_MISMATCH"):
        s1o._prepare_run_artifacts(changed)


def test_metrics_utc_text_funding_jitter_and_interval_transition_are_admitted(
    tmp_path: Path,
) -> None:
    metrics_spec = s1o.ArchiveSpec("development", "metrics", "x", "metrics.zip")
    _write_archive(
        tmp_path,
        metrics_spec,
        "metrics.csv",
        (
            "create_time,symbol,sum_open_interest,sum_open_interest_value,"
            "count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,"
            "count_long_short_ratio,sum_taker_long_short_vol_ratio\n"
            "2025-06-01 00:05:00,BTCUSDT,100,10000,1,1,1,1\n"
        ),
    )
    start = s1o.to_ms(datetime(2025, 6, 1, tzinfo=UTC))
    end = start + 10 * s1o.FIVE_MINUTES_MS
    rows = s1o._parse_oi(tmp_path, [metrics_spec], start, end)
    assert rows[0].timestamp_ms == start + s1o.FIVE_MINUTES_MS
    assert rows[0].open_interest == Decimal("100")

    funding_spec = s1o.ArchiveSpec("development", "funding_rate", "x", "funding.zip")
    first = 1_748_736_000_001
    second = first + 4 * 3_600_000 + 999
    _write_archive(
        tmp_path,
        funding_spec,
        "funding.csv",
        (
            "calc_time,funding_interval_hours,last_funding_rate\n"
            f"{first},8,0.0001\n"
            f"{second},4,0.0002\n"
        ),
    )
    events = s1o._parse_funding(tmp_path, [funding_spec], first, second + 1)
    assert [event.timestamp_ms for event in events] == [first, second]


def test_metrics_format_and_large_funding_jitter_fail_closed(tmp_path: Path) -> None:
    metrics_spec = s1o.ArchiveSpec("development", "metrics", "x", "metrics.zip")
    _write_archive(
        tmp_path,
        metrics_spec,
        "metrics.csv",
        (
            "create_time,symbol,sum_open_interest,sum_open_interest_value\n"
            "1748736300000,BTCUSDT,100,10000\n"
        ),
    )
    with pytest.raises(s1o.EvidenceError, match="METRICS_TIMESTAMP_FORMAT_INVALID"):
        s1o._parse_oi(tmp_path, [metrics_spec], 0, 2_000_000_000_000)

    funding_spec = s1o.ArchiveSpec("development", "funding_rate", "x", "funding.zip")
    first = 1_748_736_000_001
    second = first + 8 * 3_600_000 + 1_001
    _write_archive(
        tmp_path,
        funding_spec,
        "funding.csv",
        (
            "calc_time,funding_interval_hours,last_funding_rate\n"
            f"{first},8,0.0001\n"
            f"{second},8,0.0002\n"
        ),
    )
    with pytest.raises(s1o.EvidenceError, match="FUNDING_INTERVAL_GAP"):
        s1o._parse_funding(tmp_path, [funding_spec], first, second + 1)


@pytest.mark.parametrize(("open_interest", "open_interest_value"), [("0", "1"), ("1", "0")])
def test_nonpositive_oi_domain_fails_closed(
    tmp_path: Path, open_interest: str, open_interest_value: str
) -> None:
    spec = s1o.ArchiveSpec("development", "metrics", "x", "metrics.zip")
    _write_archive(
        tmp_path,
        spec,
        "metrics.csv",
        (
            "create_time,symbol,sum_open_interest,sum_open_interest_value\n"
            f"2025-06-01 00:05:00,BTCUSDT,{open_interest},{open_interest_value}\n"
        ),
    )
    start = s1o.to_ms(datetime(2025, 6, 1, tzinfo=UTC))
    with pytest.raises(s1o.EvidenceError, match="METRICS_DOMAIN_INVALID"):
        s1o._parse_oi(tmp_path, [spec], start, start + 2 * s1o.FIVE_MINUTES_MS)


@pytest.mark.parametrize(
    ("dataset", "close", "quote_volume", "error"),
    [
        ("mark_price_5m", "0", "0", "KLINE_CLOSE_DOMAIN_INVALID"),
        ("contract_5m", "-1", "1", "KLINE_CLOSE_DOMAIN_INVALID"),
        ("contract_5m", "1", "-1", "KLINE_QUOTE_VOLUME_DOMAIN_INVALID"),
    ],
)
def test_invalid_bar_domain_fails_closed(
    tmp_path: Path, dataset: str, close: str, quote_volume: str, error: str
) -> None:
    spec = s1o.ArchiveSpec("development", dataset, "x", "bars.zip")
    row = [
        "0",
        "1",
        "1",
        "1",
        close,
        "1",
        str(s1o.FIVE_MINUTES_MS - 1),
        quote_volume,
        "1",
        "1",
        "1",
        "0",
    ]
    _write_archive(tmp_path, spec, "bars.csv", ",".join(row) + "\n")
    with pytest.raises(s1o.EvidenceError, match=error):
        s1o._parse_bars(
            tmp_path,
            [spec],
            0,
            s1o.FIVE_MINUTES_MS,
            dataset,
        )


def test_load_boundary_completeness_matches_official_archive_clocks() -> None:
    start = 1_000 * s1o.FIVE_MINUTES_MS
    end = start + 2 * s1o.FIVE_MINUTES_MS
    funding = (s1o.FundingEvent(start + 1, 8, Decimal("0.0001")),)
    oi = (s1o.OIRow(start + s1o.FIVE_MINUTES_MS, Decimal("1"), Decimal("1")),)
    bars = (_bar(start), _bar(start + s1o.FIVE_MINUTES_MS))
    evidence = s1o.Evidence(funding, oi, bars, bars)
    s1o._validate_boundary_coverage(evidence, start, end, "fixture")

    with pytest.raises(s1o.EvidenceError, match="METRICS_BOUNDARY_INCOMPLETE"):
        s1o._validate_boundary_coverage(
            s1o.Evidence(
                funding,
                (s1o.OIRow(start, Decimal("1"), Decimal("1")),),
                bars,
                bars,
            ),
            start,
            end,
            "fixture",
        )
    with pytest.raises(s1o.EvidenceError, match="KLINE_BOUNDARY_INCOMPLETE"):
        s1o._validate_boundary_coverage(
            s1o.Evidence(funding, oi, bars[1:], bars),
            start,
            end,
            "fixture",
        )
    with pytest.raises(s1o.EvidenceError, match="FUNDING_START_BOUNDARY_INCOMPLETE"):
        s1o._validate_boundary_coverage(
            s1o.Evidence(
                (s1o.FundingEvent(start + 1_001, 8, Decimal("0.0001")),),
                oi,
                bars,
                bars,
            ),
            start,
            end,
            "fixture",
        )
    long_end = start + 9 * 3_600_000
    with pytest.raises(s1o.EvidenceError, match="FUNDING_END_BOUNDARY_INCOMPLETE"):
        s1o._validate_boundary_coverage(
            s1o.Evidence(
                (s1o.FundingEvent(start + 1, 8, Decimal("0.0001")),),
                (
                    s1o.OIRow(
                        start + s1o.FIVE_MINUTES_MS,
                        Decimal("1"),
                        Decimal("1"),
                    ),
                    s1o.OIRow(
                        long_end - s1o.FIVE_MINUTES_MS,
                        Decimal("1"),
                        Decimal("1"),
                    ),
                ),
                (_bar(start), _bar(long_end - s1o.FIVE_MINUTES_MS)),
                (_bar(start), _bar(long_end - s1o.FIVE_MINUTES_MS)),
            ),
            start,
            long_end,
            "fixture",
        )


def test_oi_asof_is_complete_bounded_and_future_hostile() -> None:
    cutoff = 1_000 * s1o.FIVE_MINUTES_MS
    rows = (
        s1o.OIRow(cutoff - 15 * 60_000, Decimal("90"), Decimal("9000")),
        s1o.OIRow(cutoff, Decimal("100"), Decimal("10000")),
        s1o.OIRow(cutoff + s1o.FIVE_MINUTES_MS, Decimal("999"), Decimal("99999")),
    )
    selected = s1o._asof_oi(rows, cutoff)
    assert selected is not None
    assert selected.timestamp_ms == cutoff
    assert selected.open_interest == Decimal("100")
    assert s1o._asof_oi(rows[:1], cutoff) is None


def test_jittered_event_uses_first_bar_close_after_exact_event() -> None:
    aligned = 2_000 * s1o.FIVE_MINUTES_MS
    bars = (_bar(aligned), _bar(aligned + s1o.FIVE_MINUTES_MS))
    selected = s1o._first_complete_bar_after(bars, aligned + 1)
    assert selected == bars[0]
    assert selected.close_time_ms - (aligned + 1) < s1o.FIVE_MINUTES_MS


def test_signal_is_own_symbol_lagged_and_holds_next_actual_settlement() -> None:
    current_ms = 10 * s1o.DAY_MS
    previous_ms = current_ms - 8 * 3_600_000
    next_ms = current_ms + 8 * 3_600_000
    funding = (
        s1o.FundingEvent(previous_ms, 8, Decimal("0.00010")),
        s1o.FundingEvent(current_ms, 8, Decimal("0.00010")),
        s1o.FundingEvent(next_ms, 8, Decimal("0.00012")),
    )
    baseline_cutoff = current_ms - 8 * 3_600_000 - s1o.FIVE_MINUTES_MS
    current_cutoff = current_ms - s1o.FIVE_MINUTES_MS
    oi = (
        s1o.OIRow(baseline_cutoff, Decimal("100"), Decimal("2000000000")),
        s1o.OIRow(current_cutoff, Decimal("102"), Decimal("2000000000")),
        s1o.OIRow(current_ms + s1o.FIVE_MINUTES_MS, Decimal("999"), Decimal("9")),
    )
    first_bar = current_ms - s1o.DAY_MS
    bars = tuple(_bar(first_bar + index * s1o.FIVE_MINUTES_MS) for index in range(288 + 8 * 12 + 3))
    evidence = s1o.Evidence(funding, oi, bars, bars)
    trial = s1o.Trial(8, Decimal("0.01"), Decimal("0.00005"))
    trades = s1o.evaluate_trial(trial, evidence, current_ms, next_ms + 1)
    assert len(trades) == 1
    trade = trades[0]
    assert trade.side == -1
    assert trade.next_settlement_ms == next_ms
    assert trade.entry_timestamp_ms == current_ms + s1o.FIVE_MINUTES_MS - 1
    assert trade.exit_timestamp_ms == next_ms + s1o.FIVE_MINUTES_MS - 1
    assert trade.oi_growth == Decimal("0.02")
    assert trade.price_pnl_usdt == 0
    assert trade.funding_pnl_usdt == Decimal("0.12000")
    assert trade.base_fee_proxy_usdt == Decimal("0.8")
    assert trade.base_adverse_fill_proxy_usdt == Decimal("0.4")
    assert trade.base_net_pnl_usdt == Decimal("-1.08000")
    assert trade.capacity_proxy_usdt >= Decimal("1000")


def test_cscv_pbo_uses_all_seventy_frozen_splits() -> None:
    daily = {
        trial.trial_id: tuple(Decimal(index + 1) / Decimal(1000) for index in range(224))
        for trial in s1o.frozen_trials()
    }
    diagnostic = s1o.cscv_pbo(daily)
    assert diagnostic["blocks"] == 8
    assert diagnostic["block_days"] == 28
    assert diagnostic["splits"] == 70
    selections = cast(dict[str, int], diagnostic["selection_counts"])
    pbo = Decimal(cast(str, diagnostic["pbo"]))
    assert sum(selections.values()) == 70
    assert pbo >= 0
    assert pbo <= 1


def test_multiple_testing_helpers_are_deterministic() -> None:
    raw = {
        "a": Decimal("0.01"),
        "b": Decimal("0.03"),
        "c": Decimal("0.20"),
    }
    assert s1o.holm_adjust(raw) == {
        "a": Decimal("0.03"),
        "b": Decimal("0.06"),
        "c": Decimal("0.20"),
    }
    daily = tuple(Decimal(index % 3) - Decimal("0.5") for index in range(28))
    first = s1o.bootstrap_trial(daily, seed=7, replicates=64)
    second = s1o.bootstrap_trial(daily, seed=7, replicates=64)
    assert first == second


def test_replay_recomputes_eight_trial_gates_champion_and_pbo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    trial_ids = sorted(trial.trial_id for trial in s1o.frozen_trials())
    expected_trials = {
        trial_id: {
            "trade_count": 0,
            "numeric_gate": "RECOMPUTED",
            "passed": False,
        }
        for trial_id in trial_ids
    }
    expected_pbo: dict[str, object] = {
        "schema": "cosmos.s1o.cscv-pbo.v1",
        "splits": 70,
        "pbo": "1.000000000000",
    }

    def lightweight_assessment(
        trades: dict[str, tuple[s1o.Trade, ...]], start_ms: int
    ) -> tuple[dict[str, dict[str, object]], str | None, dict[str, object]]:
        assert set(trades) == set(trial_ids)
        assert start_ms == s1o.to_ms(datetime(2025, 7, 1, tzinfo=UTC))
        return expected_trials, None, expected_pbo

    monkeypatch.setattr(s1o, "development_assessment", lightweight_assessment)
    result: dict[str, object] = {
        "schema": "cosmos.s1o.result.v1",
        "milestone": "S-1O",
        "strategy": "BTCUSDT_OWN_SYMBOL_OI_CONDITIONED_FUNDING_SIGN_PERSISTENCE",
        "protocol_sha256": s1o.sha256_file(s1o.PROTOCOL_PATH),
        "freeze_sha256": "f" * 64,
        "data_manifest_sha256": "d" * 64,
        "account_effective_fees": "UNKNOWN",
        "executable_depth": "UNKNOWN",
        "historical_filters": "UNKNOWN",
        "executable_capacity": "UNKNOWN",
        "metrics_semantic_derivation": ("UNMEASURED_OFFICIAL_ARCHIVE_DOCUMENTATION_ABSENT"),
        "go_structurally_reachable": False,
        "capital_disposition": "NO_GO",
        "verdict": "NO_GO",
        "reason": "NO_DEVELOPMENT_TRIAL_PASSED_ALL_FROZEN_GATES",
        "holdout_status": "UNOPENED",
        "development": {
            "trials": expected_trials,
            "cscv_pbo": expected_pbo,
            "champion": None,
            "trade_ledgers": {trial_id: [] for trial_id in trial_ids},
        },
    }
    assert s1o._verify_result_replay(result).stage == "NO_CHAMPION"

    tampered_gate = json.loads(json.dumps(result))
    tampered_gate["development"]["trials"][trial_ids[0]]["numeric_gate"] = "FORGED"
    with pytest.raises(s1o.EvidenceError, match="RESULT_DEVELOPMENT_ASSESSMENT_MISMATCH"):
        s1o._verify_result_replay(cast(dict[str, object], tampered_gate))

    tampered_pbo = json.loads(json.dumps(result))
    tampered_pbo["development"]["cscv_pbo"]["pbo"] = "0.000000000000"
    with pytest.raises(s1o.EvidenceError, match="RESULT_CSCV_PBO_MISMATCH"):
        s1o._verify_result_replay(cast(dict[str, object], tampered_pbo))

    tampered_champion = json.loads(json.dumps(result))
    tampered_champion["development"]["champion"] = trial_ids[0]
    with pytest.raises(s1o.EvidenceError, match="RESULT_CHAMPION_REPLAY_MISMATCH"):
        s1o._verify_result_replay(cast(dict[str, object], tampered_champion))

    missing_trial = json.loads(json.dumps(result))
    missing_trial["development"]["trade_ledgers"].pop(trial_ids[0])
    with pytest.raises(s1o.EvidenceError, match="RESULT_EIGHT_TRIAL_FAMILY_MISMATCH"):
        s1o._verify_result_replay(cast(dict[str, object], missing_trial))


def test_marker_content_and_digest_tamper_fail_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(s1o, "GENERATED_ROOT", tmp_path)
    source_manifest = _source_manifest_fixture()
    s1o.atomic_write(
        tmp_path / "source-data-manifest.v1.json",
        s1o.canonical_json_bytes(source_manifest),
    )
    freeze_payload: dict[str, object] = {
        "freeze_sha256": "f" * 64,
        "evaluator_sha256": "e" * 64,
    }
    result: dict[str, object] = {
        "freeze_sha256": freeze_payload["freeze_sha256"],
        "data_manifest_sha256": source_manifest["manifest_sha256"],
    }
    run_marker = {
        "schema": "cosmos.s1o.run-consumed.v1",
        "protocol_sha256": s1o.sha256_file(s1o.PROTOCOL_PATH),
        "freeze_sha256": freeze_payload["freeze_sha256"],
        "data_manifest_sha256": source_manifest["manifest_sha256"],
        "state": "CONSUMED_BEFORE_DEVELOPMENT_DECOMPRESSION",
    }
    s1o.atomic_write(tmp_path / "RUN_CONSUMED.json", s1o.canonical_json_bytes(run_marker))
    trial_id = s1o.frozen_trials()[0].trial_id
    assessment: dict[str, object] = {"passed": True, "gate": "bound"}
    champion = {
        "schema": "cosmos.s1o.champion-seal.v1",
        "protocol_sha256": s1o.sha256_file(s1o.PROTOCOL_PATH),
        "evaluator_sha256": freeze_payload["evaluator_sha256"],
        "trial_id": trial_id,
        "development_assessment_sha256": s1o.sha256_bytes(s1o.canonical_json_bytes(assessment)),
    }
    s1o.atomic_write(
        tmp_path / "champion.seal.v1.json",
        s1o.canonical_json_bytes(champion),
    )
    holdout = {
        "schema": "cosmos.s1o.holdout-opened.v1",
        "champion_seal_sha256": s1o.sha256_file(tmp_path / "champion.seal.v1.json"),
        "state": "CREATED_BEFORE_FIRST_HOLDOUT_MEMBER_ACCESS",
    }
    s1o.atomic_write(tmp_path / "HOLDOUT_OPENED.json", s1o.canonical_json_bytes(holdout))
    replay = s1o.ReplayState("HOLDOUT_COMPLETE", trial_id, assessment, True)

    marker_paths = (
        tmp_path / "source-data-manifest.v1.json",
        tmp_path / "RUN_CONSUMED.json",
        tmp_path / "champion.seal.v1.json",
        tmp_path / "HOLDOUT_OPENED.json",
    )
    for position, path in enumerate(marker_paths):
        reversed_mtime_ns = 4_000_000_000 - position * 1_000_000_000
        os.utime(path, ns=(reversed_mtime_ns, reversed_mtime_ns))
    expected = s1o._verify_run_markers(result, replay, freeze_payload, source_manifest)
    assert "champion.seal.v1.json" in expected
    assert "HOLDOUT_OPENED.json" in expected

    for path in marker_paths:
        os.utime(path, ns=(5_000_000_000, 5_000_000_000))
    assert s1o._verify_run_markers(result, replay, freeze_payload, source_manifest) == expected

    forged_result = dict(result)
    forged_result["data_manifest_sha256"] = "0" * 64
    with pytest.raises(s1o.EvidenceError, match="RESULT_SEAL_BINDING_MISMATCH"):
        s1o._verify_run_markers(forged_result, replay, freeze_payload, source_manifest)

    forged_champion = dict(champion)
    forged_champion["trial_id"] = s1o.frozen_trials()[1].trial_id
    s1o.atomic_write(
        tmp_path / "champion.seal.v1.json",
        s1o.canonical_json_bytes(forged_champion),
    )
    with pytest.raises(s1o.EvidenceError, match="CHAMPION_MARKER_MISMATCH"):
        s1o._verify_run_markers(result, replay, freeze_payload, source_manifest)

    s1o.atomic_write(
        tmp_path / "champion.seal.v1.json",
        s1o.canonical_json_bytes(champion),
    )
    forged_holdout = dict(holdout)
    forged_holdout["champion_seal_sha256"] = "0" * 64
    s1o.atomic_write(
        tmp_path / "HOLDOUT_OPENED.json",
        s1o.canonical_json_bytes(forged_holdout),
    )
    with pytest.raises(s1o.EvidenceError, match="HOLDOUT_MARKER_MISMATCH"):
        s1o._verify_run_markers(result, replay, freeze_payload, source_manifest)


def test_artifact_manifest_requires_exact_mandatory_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(s1o, "GENERATED_ROOT", tmp_path)
    names = {
        "acquisition-plan.v1.json",
        "freeze.v1.json",
        "source-data-manifest.v1.json",
        "RUN_CONSUMED.json",
        "result.v1.json",
    }
    ordered = (
        "acquisition-plan.v1.json",
        "freeze.v1.json",
        "source-data-manifest.v1.json",
        "RUN_CONSUMED.json",
        "result.v1.json",
    )
    for name in ordered:
        (tmp_path / name).write_text(f"{name}\n", encoding="utf-8")
    manifest: dict[str, object] = {
        "schema": "cosmos.s1o.artifact-manifest.v1",
        "files": [
            {
                "path": name,
                "sha256": s1o.sha256_file(tmp_path / name),
                "bytes": (tmp_path / name).stat().st_size,
            }
            for name in ordered
        ],
    }
    manifest["manifest_sha256"] = s1o.sha256_bytes(s1o.canonical_json_bytes(manifest))
    (tmp_path / "artifact-manifest.v1.json").write_bytes(s1o.canonical_json_bytes(manifest))
    assert s1o._verify_artifact_manifest(names) == manifest["manifest_sha256"]
    (tmp_path / "unexpected.json").write_text("{}\n", encoding="utf-8")
    with pytest.raises(s1o.EvidenceError, match="GENERATED_ARTIFACT_SET_MISMATCH"):
        s1o._verify_artifact_manifest(names)


def test_replay_verifier_rejects_trade_decomposition_tamper() -> None:
    current_ms = 10 * s1o.DAY_MS
    funding = (
        s1o.FundingEvent(current_ms - 8 * 3_600_000, 8, Decimal("0.0001")),
        s1o.FundingEvent(current_ms, 8, Decimal("0.0001")),
        s1o.FundingEvent(current_ms + 8 * 3_600_000, 8, Decimal("0.0001")),
    )
    baseline = current_ms - 8 * 3_600_000 - s1o.FIVE_MINUTES_MS
    oi = (
        s1o.OIRow(baseline, Decimal("100"), Decimal("2000000000")),
        s1o.OIRow(
            current_ms - s1o.FIVE_MINUTES_MS,
            Decimal("102"),
            Decimal("2000000000"),
        ),
    )
    bars = tuple(
        _bar(current_ms - s1o.DAY_MS + index * s1o.FIVE_MINUTES_MS)
        for index in range(288 + 8 * 12 + 3)
    )
    trade = s1o.evaluate_trial(
        s1o.Trial(8, Decimal("0"), Decimal("0.00005")),
        s1o.Evidence(funding, oi, bars, bars),
        current_ms,
        current_ms + 8 * 3_600_000 + 1,
    )[0]
    payload = s1o._trade_payload(trade)
    assert len(s1o._verify_trade_ledger([payload])) == 1
    payload["stress_net_pnl_usdt"] = "999.000000000000"
    with pytest.raises(s1o.EvidenceError, match="TRADE_DECOMPOSITION_MISMATCH"):
        s1o._verify_trade_ledger([payload])


def test_one_run_and_holdout_guards_refuse_early(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    marker = tmp_path / "RUN_CONSUMED.json"
    s1o.atomic_create(marker, {"state": "CONSUMED"})
    with pytest.raises(FileExistsError):
        s1o.atomic_create(marker, {"state": "CONSUMED_AGAIN"})

    monkeypatch.setattr(s1o, "GENERATED_ROOT", tmp_path / "generated")
    now = datetime(2025, 1, 1, tzinfo=UTC)
    with pytest.raises(s1o.EvidenceError, match="HOLDOUT_ACCESS_BEFORE_CHAMPION_SEAL"):
        s1o.load_evidence(tmp_path / "external", "holdout", now, now + timedelta(days=1))


def test_verdict_law_never_emits_go() -> None:
    assert s1o.holdout_assessment(())["passed"] is False
    protocol = s1o.load_protocol()
    law = cast(dict[str, object], protocol["verdict_law"])
    assert law["go"] == "STRUCTURALLY_UNREACHABLE"
    assert law["capital_disposition"] == "NO_GO"
