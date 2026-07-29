from __future__ import annotations

import hashlib
import json
import math
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from research.vg23 import experiment as e
from research.vg23 import verify as v


def _microseconds(value: datetime) -> int:
    return int(value.timestamp() * 1_000_000)


def _archive_row(symbol: str, month: str, raw: bytes, sidecar: bytes) -> dict[str, object]:
    return {
        "symbol": symbol,
        "month": month,
        "zipBytes": len(raw),
        "zipSha256": hashlib.sha256(raw).hexdigest(),
        "checksumBytes": len(sidecar),
        "checksumSha256": hashlib.sha256(sidecar).hexdigest(),
    }


def _write_archive(
    root: Path,
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-03",
    quote_volume: str = "10000000",
    close_delta_us: int = e.DAY_US - 1,
) -> dict[str, object]:
    opened = datetime(2025, 3, 1, tzinfo=UTC)
    open_us = _microseconds(opened)
    close_us = open_us + close_delta_us
    csv_row = (f"{open_us},10,12,9,11,100,{close_us},{quote_volume},5,50,2,0\n").encode()
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    archive_path = directory / f"{symbol}-1d-{month}.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", csv_row)
    raw = archive_path.read_bytes()
    sidecar = f"{hashlib.sha256(raw).hexdigest()}  {archive_path.name}\n".encode()
    (directory / f"{archive_path.name}.CHECKSUM").write_bytes(sidecar)
    return _archive_row(symbol, month, raw, sidecar)


def _symbols() -> list[str]:
    return [*e.RISK_SLEEVE, *(f"S{index:02d}USDT" for index in range(20))]


def _bars(
    symbols: list[str],
    first: date,
    last: date,
    *,
    boosted: set[str] | None = None,
    price_multiplier: float = 1.0,
    recent_end: date | None = None,
) -> dict[str, dict[date, e.Bar]]:
    boosted = boosted or set()
    recent_end = recent_end or last
    output: dict[str, dict[date, e.Bar]] = {}
    for symbol_index, symbol in enumerate(symbols):
        series: dict[date, e.Bar] = {}
        current = first
        while current <= last:
            recent = recent_end - timedelta(days=4) <= current <= recent_end
            volume = 20_000_000.0 + symbol_index * 1000
            if symbol in boosted and recent:
                volume *= 4
            price = (10.0 + symbol_index) * price_multiplier
            series[current] = e.Bar(current, price, price, volume)
            current += timedelta(days=1)
        output[symbol] = series
    return output


def _formation(
    entry: date,
    *,
    boosted: set[str] | None = None,
    price_multiplier: float = 1.0,
) -> tuple[dict[str, dict[date, e.Bar]], e.Formation]:
    symbols = _symbols()
    bars = _bars(
        symbols,
        entry - timedelta(days=91),
        entry - timedelta(days=2),
        boosted=boosted,
        price_multiplier=price_multiplier,
        recent_end=entry - timedelta(days=2),
    )
    return bars, e.build_formation(bars, symbols, entry, 10_000_000, 20)


def test_month_range_is_closed_and_ordered() -> None:
    assert e.month_range("2025-11", "2026-02") == (
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
    )


def test_protocol_freezes_six_distinct_breadth_trials() -> None:
    protocol, digest = e.load_protocol()
    assert len(digest) == 64
    assert protocol["trials"]["trialIds"] == [
        "A150_S20",
        "A150_S35",
        "A150_S50",
        "A200_S20",
        "A200_S35",
        "A200_S50",
    ]
    forbidden = set(protocol["distinctness"]["explicitlyForbiddenSignalInputs"])
    assert {"PRICE_RETURN_SIGN_OR_RANK", "BREAKOUT", "REVERSAL"} <= forbidden
    assert "NO_CROSS_SECTIONAL_VOLUME_SHARE_SCORE" in protocol["distinctness"]["notVG8"]
    assert (
        protocol["data"]["developmentSchemaOnlySupportAuditBeforeFreeze"]
        == "DISCLOSED_AND_LIMITED_TO_SCHEMA_NO_PRICE_OR_VOLUME_OUTCOMES_RETAINED"
    )
    assert (
        protocol["data"]["economicOutcomeFieldAccessBeforeFreeze"] == "FORBIDDEN_AND_NOT_OBSERVED"
    )


def test_protocol_requires_python_313_shebang_and_hash_seed() -> None:
    protocol, _digest = e.load_protocol()
    assert Path(e.__file__).read_text().splitlines()[0] == "#!/usr/bin/env python3.13"
    assert protocol["runControl"]["pythonExact"] == "3.13.14"
    assert protocol["runControl"]["pythonHashSeed"] == "0"


def test_trial_specs_decode_abnormality_and_saturation() -> None:
    protocol, _digest = e.load_protocol()
    specs = e.trial_specs(protocol)
    assert specs[0] == e.TrialSpec("A150_S20", 1.5, 0.2)
    assert specs[-1] == e.TrialSpec("A200_S50", 2.0, 0.5)


def test_alternate_state_root_is_rejected(tmp_path: Path) -> None:
    protocol, _digest = e.load_protocol()
    with pytest.raises(e.CustodyError, match="state root differs"):
        e.enforce_state_root(protocol, tmp_path)


def test_alternate_source_root_is_rejected(tmp_path: Path) -> None:
    protocol, _digest = e.load_protocol()
    with pytest.raises(e.CustodyError, match="source root differs"):
        e.enforce_source_root(protocol, tmp_path)


def test_parse_archive_verifies_official_sidecar(tmp_path: Path) -> None:
    row = _write_archive(tmp_path)
    bars = e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")
    assert len(bars) == 1
    assert bars[0].day == date(2025, 3, 1)
    assert bars[0].quote_volume == 10_000_000


def test_parse_archive_rejects_tampered_zip(tmp_path: Path) -> None:
    row = _write_archive(tmp_path)
    path = tmp_path / "archives/AAAUSDT/2025-03/AAAUSDT-1d-2025-03.zip"
    path.write_bytes(path.read_bytes() + b"tamper")
    with pytest.raises(e.CustodyError, match="byte length changed"):
        e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")


def test_parse_archive_rejects_partial_daily_bar(tmp_path: Path) -> None:
    row = _write_archive(tmp_path, close_delta_us=3 * 60 * 60 * 1_000_000 - 1)
    with pytest.raises(e.ArchiveSchemaError, match="daily close boundary invalid"):
        e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")


def test_parse_timestamp_rejects_post_transition_milliseconds() -> None:
    with pytest.raises(e.ArchiveSchemaError, match="not microseconds"):
        e.parse_timestamp("1740787200000", "AAAUSDT", "2025-03")


def test_abnormal_breadth_uses_own_history_and_not_price() -> None:
    entry = date(2025, 7, 1)
    boosted = set(_symbols()[:11])
    _bars_one, formation = _formation(entry, boosted=boosted)
    assert formation.valid
    spec = e.TrialSpec("A150_S50", 1.5, 0.5)
    assert e.breadth_for(formation, spec) == pytest.approx(0.5)
    _bars_two, repriced = _formation(entry, boosted=boosted, price_multiplier=100)
    assert repriced.abnormal_ratios == formation.abnormal_ratios
    assert e.breadth_for(repriced, spec) == pytest.approx(0.5)


def test_continuous_exposure_saturates_without_symbol_selection() -> None:
    entry = date(2025, 7, 1)
    boosted = set(_symbols()[:11])
    _bars_value, formation = _formation(entry, boosted=boosted)
    low_saturation = e.TrialSpec("A150_S20", 1.5, 0.2)
    high_saturation = e.TrialSpec("A150_S50", 1.5, 0.5)
    assert e.exposure_for(formation, low_saturation) == 1
    assert e.exposure_for(formation, high_saturation) == pytest.approx(1)
    targets = e.target_weights((formation,), high_saturation, benchmark=False)
    assert targets == ({"BTCUSDT": 0.5, "ETHUSDT": 0.5},)
    assert not (set(targets[0]) & set(formation.eligible_symbols) - set(e.RISK_SLEEVE))


def test_partial_breadth_scales_fixed_sleeve_continuously() -> None:
    entry = date(2025, 7, 1)
    boosted = set(_symbols()[:4])
    _bars_value, formation = _formation(entry, boosted=boosted)
    spec = e.TrialSpec("A150_S50", 1.5, 0.5)
    breadth = e.breadth_for(formation, spec)
    targets = e.target_weights((formation,), spec, benchmark=False)[0]
    assert breadth == pytest.approx(4 / 22)
    assert sum(targets.values()) == pytest.approx(breadth / 0.5)
    assert targets["BTCUSDT"] == targets["ETHUSDT"]


def test_benchmark_is_constant_full_proxy_sleeve() -> None:
    entry = date(2025, 7, 1)
    _bars_value, formation = _formation(entry, boosted=set())
    first = e.TrialSpec("A150_S20", 1.5, 0.2)
    second = e.TrialSpec("A200_S50", 2.0, 0.5)
    expected = ({"BTCUSDT": 0.5, "ETHUSDT": 0.5},)
    assert e.target_weights((formation,), first, benchmark=True) == expected
    assert e.target_weights((formation,), second, benchmark=True) == expected


def test_invalid_formation_moves_strategy_and_benchmark_to_cash() -> None:
    formation = e.Formation(
        date(2025, 7, 1),
        date(2025, 6, 29),
        False,
        "SPARSE",
        (),
        {},
        {},
    )
    spec = e.TrialSpec("A150_S20", 1.5, 0.2)
    assert e.target_weights((formation,), spec, benchmark=False) == ({},)
    assert e.target_weights((formation,), spec, benchmark=True) == ({},)


def test_flat_price_round_trip_matches_received_asset_fee_formula() -> None:
    symbols = _symbols()
    entry = date(2025, 7, 1)
    bars = _bars(
        symbols,
        entry - timedelta(days=91),
        entry + timedelta(days=7),
        boosted=set(symbols),
        recent_end=entry - timedelta(days=2),
    )
    formation = e.build_formation(bars, symbols, entry, 10_000_000, 20)
    spec = e.TrialSpec("A150_S20", 1.5, 0.2)
    fee = 0.001
    adverse = 0.001
    run = e.simulation(
        bars=bars,
        formations=(formation,),
        spec=spec,
        cost=e.Scenario("TEST", fee, adverse),
        benchmark=False,
    )
    multiplier = (1 - fee) / (1 + adverse) * (1 - adverse) * (1 - fee)
    assert run.terminal_nav == pytest.approx(1000 * multiplier)
    assert len(run.fills) == 4
    assert all(fill.participation_bps is not None for fill in run.fills)


def test_simulation_summary_reports_breadth_allocation_and_capacity() -> None:
    symbols = _symbols()
    entry = date(2025, 7, 1)
    bars = _bars(
        symbols,
        entry - timedelta(days=91),
        entry + timedelta(days=7),
        boosted=set(symbols[:11]),
        recent_end=entry - timedelta(days=2),
    )
    formation = e.build_formation(bars, symbols, entry, 10_000_000, 20)
    run = e.simulation(
        bars=bars,
        formations=(formation,),
        spec=e.TrialSpec("A150_S50", 1.5, 0.5),
        cost=e.Scenario("PUBLIC_STRESS", 0.001, 0.0025),
        benchmark=False,
    )
    summary = e.simulation_summary(run, {"status": "FIXTURE"})
    assert summary["breadth"]["observations"] == 1
    assert summary["allocation"]["riskSleeve"] == ["BTCUSDT", "ETHUSDT"]
    assert summary["capacityProxy"]["c1bpUsd"] is not None
    assert summary["capacityProxy"]["c1bpStrategyCapitalUsd"] == summary["capacityProxy"]["c1bpUsd"]
    assert summary["capacityProxy"]["minimumPerFillNotionalAt1bpUsd"] is not None
    assert summary["capacityProxy"]["fillsMissingProxy"] == 0


def test_missing_fill_liquidity_nulls_every_numeric_capacity_proxy() -> None:
    symbols = _symbols()
    entry = date(2025, 7, 1)
    bars = _bars(
        symbols,
        entry - timedelta(days=91),
        entry + timedelta(days=7),
        boosted=set(symbols),
        recent_end=entry - timedelta(days=2),
    )
    formation = e.build_formation(bars, symbols, entry, 10_000_000, 20)
    run = e.simulation(
        bars=bars,
        formations=(formation,),
        spec=e.TrialSpec("A150_S20", 1.5, 0.2),
        cost=e.Scenario("PUBLIC_STRESS", 0.001, 0.0025),
        benchmark=False,
    )
    run.fills.append(e.Fill(entry, "MISSINGUSDT", "BUY", 1.0, 1.0, 0.0, 0.0, None))
    capacity = e.simulation_summary(run, {"status": "FIXTURE"})["capacityProxy"]
    assert capacity["status"] == "UNMEASURED_REQUIRED_FILL_LIQUIDITY_MISSING"
    assert capacity["fillsMissingProxy"] == 1
    for field in (
        "maximumParticipationBps",
        "p95ParticipationBps",
        "c1bpUsd",
        "c1bpStrategyCapitalUsd",
        "minimumPerFillNotionalAt1bpUsd",
    ):
        assert capacity[field] is None


def test_holm_adjustment_is_monotone() -> None:
    adjusted = e.holm_adjust({"A": 0.001, "B": 0.02, "C": 0.03})
    assert adjusted["A"] == pytest.approx(0.003)
    assert adjusted["B"] == pytest.approx(0.04)
    assert adjusted["C"] == pytest.approx(0.04)


def test_bootstrap_is_deterministic() -> None:
    returns = [0.01, -0.005, 0.002, 0.0, 0.004, -0.001, 0.003] * 3
    first = e.bootstrap_packet(returns, block_length=7, replicates=128, seed=11)
    second = e.bootstrap_packet(returns, block_length=7, replicates=128, seed=11)
    assert first == second
    assert first["observations"] == 21


def test_pbo_uses_all_seventy_symmetric_splits() -> None:
    months = [f"2025-{month:02d}" for month in range(7, 13)] + ["2026-01", "2026-02"]
    trial_ids = ("A150_S20", "A150_S35", "A150_S50", "A200_S20", "A200_S35", "A200_S50")
    runs: dict[str, e.Simulation] = {}
    for trial_index, trial_id in enumerate(trial_ids):
        daily = [
            (date.fromisoformat(f"{month}-01"), (trial_index - month_index % 2) / 10_000)
            for month_index, month in enumerate(months)
        ]
        runs[trial_id] = e.Simulation(
            "PUBLIC_STRESS",
            trial_id,
            False,
            8,
            8,
            [],
            16,
            set(e.RISK_SLEEVE),
            [],
            [],
            daily,
            daily,
            [0.5] * 8,
            [1.0] * 8,
            {},
            [],
            1000 * math.prod(1 + value for _, value in daily),
        )
    result = e.pbo_cscv(runs, months)
    assert result["splits"] == 70
    assert result["blockObservationCounts"] == dict.fromkeys(months, 1)
    assert 0 <= float(result["pbo"]) <= 1


def test_checksum_inventory_detects_row_drift() -> None:
    lookup = {
        ("AAAUSDT", "2025-03"): {
            "zipSha256": "a" * 64,
            "checksumSha256": "b" * 64,
            "zipBytes": 10,
            "checksumBytes": 88,
        }
    }
    first = e.normalized_inventory_digest(lookup, ("AAAUSDT",), ("2025-03",))
    lookup[("AAAUSDT", "2025-03")]["zipBytes"] = 11
    second = e.normalized_inventory_digest(lookup, ("AAAUSDT",), ("2025-03",))
    assert first[0] != second[0]


def test_marker_record_rejects_noncanonical_bytes(tmp_path: Path) -> None:
    payload = {"schema": "Marker", "value": 1}
    (tmp_path / "run-marker.v1.json").write_text(json.dumps(payload, indent=2))
    with pytest.raises(e.CustodyError, match="not canonical"):
        e.marker_record(tmp_path, "run-marker.v1.json")


def test_exclusive_marker_write_refuses_overwrite(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    e.write_exclusive(marker, b"first\n")
    with pytest.raises(e.EvidenceError, match="refusing to overwrite"):
        e.write_exclusive(marker, b"second\n")
    assert marker.read_bytes() == b"first\n"


def test_terminal_core_reconstructs_exact_final_result(tmp_path: Path) -> None:
    core = {"schema": "VG23ResultV1", "bindings": {"freezeSha256": "a" * 64}}
    terminal_sha = e.write_terminal_result_core(
        tmp_path,
        core,
        terminal_phase="FIXTURE",
    )
    record = e.marker_record(tmp_path, e.TERMINAL_CORE_FILENAME)
    assert record is not None
    recovered = e.result_core_from_terminal_record(record)
    final = e.reconstruct_final_result(
        recovered,
        terminal_core_sha=terminal_sha,
        run_receipt_sha="b" * 64,
    )
    assert core["bindings"] == {"freezeSha256": "a" * 64}
    assert final["bindings"]["terminalResultCoreSha256"] == terminal_sha
    assert final["bindings"]["runReceiptSha256"] == "b" * 64


def test_terminal_commit_binds_receipt_and_external_core(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_root = tmp_path / "state"
    state_root.mkdir()
    result_path = tmp_path / "result.v1.json"
    receipt_path = tmp_path / "run-receipt.v1.json"
    monkeypatch.setattr(e, "RESULT_PATH", result_path)
    monkeypatch.setattr(e, "RUN_RECEIPT_PATH", receipt_path)
    run_marker = {
        "schema": "VG23RunMarkerV1",
        "state": "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED",
        "allowedRunCount": 1,
        "consumedRunCount": 1,
        "networkPermitted": False,
        "sharedSourceMutationPermitted": False,
    }
    run_path = state_root / "run-marker.v1.json"
    e.write_exclusive(run_path, e.canonical_bytes(run_marker))
    core = e.terminal_unmeasured(
        {"runMarkerSha256": e.sha256_path(run_path)},
        started_at="2026-07-29T00:00:00Z",
        phase="FIXTURE",
        error=e.EvidenceError("FIXTURE"),
    )
    result = e.commit_terminal_result(state_root, core, terminal_phase="FIXTURE")
    receipt, receipt_raw = e.load_json(receipt_path)
    terminal_record = receipt["markers"]["terminalResultCore"]
    recovered_core = e.result_core_from_terminal_record(terminal_record)
    assert result == e.reconstruct_final_result(
        recovered_core,
        terminal_core_sha=terminal_record["sha256"],
        run_receipt_sha=e.sha256_bytes(receipt_raw),
    )
    assert e.load_json(result_path)[0] == result


def test_data_free_finalizer_closes_consumed_marker(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state_root = tmp_path / "state"
    state_root.mkdir()
    monkeypatch.setattr(e, "RESULT_PATH", tmp_path / "result.v1.json")
    monkeypatch.setattr(e, "RUN_RECEIPT_PATH", tmp_path / "run-receipt.v1.json")

    def accept_fixture_state(
        _protocol: object,
        requested: Path,
    ) -> Path:
        return requested

    monkeypatch.setattr(e, "enforce_state_root", accept_fixture_state)
    binding_names = (
        "protocolSha256",
        "freezeSha256",
        "evaluatorSha256",
        "verifierSha256",
        "officialSourceResearchSha256",
        "sharedDiscoverySha256",
        "sharedAcquisitionSha256",
        "targetArtifactInventorySha256",
        "sourceFreezeCommit",
        "sourceFreezeTree",
    )
    run_marker = {
        "schema": "VG23RunMarkerV1",
        "state": "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED",
        "startedAtUtc": "2026-07-29T00:00:00Z",
        "allowedRunCount": 1,
        "consumedRunCount": 1,
        "networkPermitted": False,
        "sharedSourceMutationPermitted": False,
        **{
            name: "a" * 40 if name.endswith(("Commit", "Tree")) else "b" * 64
            for name in binding_names
        },
    }
    e.write_exclusive(
        state_root / "run-marker.v1.json",
        e.canonical_bytes(run_marker),
    )
    result = e.finalize_interrupted(state_root)
    assert result["measurementVerdict"] == "UNMEASURED"
    assert result["terminalPhase"] == "INTERRUPTED_AFTER_RUN_MARKER"
    assert (state_root / e.TERMINAL_CORE_FILENAME).is_file()
    assert e.RESULT_PATH.is_file()
    assert e.RUN_RECEIPT_PATH.is_file()

    recovered_root = tmp_path / "recovered-state"
    recovered_root.mkdir()
    recovered_result_path = tmp_path / "recovered-result.v1.json"
    recovered_receipt_path = tmp_path / "recovered-receipt.v1.json"
    monkeypatch.setattr(e, "RESULT_PATH", recovered_result_path)
    monkeypatch.setattr(e, "RUN_RECEIPT_PATH", recovered_receipt_path)
    e.write_exclusive(
        recovered_root / "run-marker.v1.json",
        e.canonical_bytes(run_marker),
    )
    measured_core = {
        "schema": "VG23ResultV1",
        "bindings": {"runMarkerSha256": "c" * 64},
        "measurementVerdict": "NO_GO",
    }
    e.write_terminal_result_core(
        recovered_root,
        measured_core,
        terminal_phase="FROZEN_GATE_EVALUATION",
    )
    recovered = e.finalize_interrupted(recovered_root)
    receipt = e.load_json(recovered_receipt_path)[0]
    assert recovered["measurementVerdict"] == "NO_GO"
    assert receipt["terminalPhase"] == "FROZEN_GATE_EVALUATION"
    assert (
        receipt["markers"]["terminalResultCore"]["payload"]["terminalPhase"]
        == "FROZEN_GATE_EVALUATION"
    )


def test_terminal_core_rejects_result_payload_tamper() -> None:
    core = {"schema": "VG23ResultV1", "bindings": {"freezeSha256": "a" * 64}}
    payload = {
        "schema": "VG23TerminalResultCoreV1",
        "state": "IMMUTABLE_PRE_RECEIPT_TERMINAL_RESULT_CORE",
        "resultCoreSha256": e.sha256_bytes(e.canonical_bytes(core)),
        "resultCore": {**core, "measurementVerdict": "GO"},
    }
    with pytest.raises(e.CustodyError, match="payload digest mismatch"):
        e.result_core_from_terminal_record({"payload": payload})
    with pytest.raises(v.VerificationError, match="payload digest mismatch"):
        v.result_core_from_terminal_payload(payload)


def test_independent_verifier_rejects_unmeasured_capacity_claims() -> None:
    protocol, _digest = e.load_protocol()
    result = e.terminal_unmeasured(
        {},
        started_at="2026-07-29T00:00:00Z",
        phase="FIXTURE",
        error=e.EvidenceError("FIXTURE"),
    )
    v.verify_verdict(protocol, result)
    result["headline"]["capacity"] = {"c1bpUsd": "1000"}
    with pytest.raises(v.VerificationError, match="measured state"):
        v.verify_verdict(protocol, result)


def test_independent_verifier_rejects_known_executable_capacity() -> None:
    protocol, _digest = e.load_protocol()
    result = e.terminal_unmeasured(
        {},
        started_at="2026-07-29T00:00:00Z",
        phase="FIXTURE",
        error=e.EvidenceError("FIXTURE"),
    )
    result["capacityTruth"]["historicalExecutableBookCapacity"] = "KNOWN"
    with pytest.raises(v.VerificationError, match="capacity truth boundary drift"):
        v.verify_verdict(protocol, result)


def test_independent_gate_recomputation_matches_evaluator() -> None:
    protocol, _digest = e.load_protocol()
    champion_id = "A150_S20"
    development: dict[str, object] = {
        "championTrialId": champion_id,
        "trials": {
            champion_id: {
                "strategy": {
                    "validFormations": 34,
                    "holdingSpells": 68,
                    "fills": 30,
                    "distinctHeldSymbols": 2,
                    "positiveMonths": 6,
                    "netUsdPerInitial1000": "10",
                    "bootstrap": {"lower5PctNetUsdPer1k": "1"},
                },
                "holmAdjustedP": "0.01",
            }
        },
        "whiteRealityCheckVersusCash": {"pValue": "0.01"},
        "whiteRealityCheckVersusMatchedBenchmark": {"pValue": "0.01"},
    }
    stress = {
        "validFormations": 17,
        "holdingSpells": 34,
        "fills": 12,
        "distinctHeldSymbols": 2,
        "positiveMonths": 4,
        "netUsdPerInitial1000": "5",
        "bootstrap": {"lower5PctNetUsdPer1k": "1"},
        "dailyCloseMaxDrawdownPct": "10",
        "concentration": {
            "topAssetPositiveGrossProfitSharePct": "50",
            "topFiveHoldingSpellPositiveGrossProfitSharePct": "50",
        },
        "capacityProxy": {
            "fillsMissingProxy": 0,
            "maximumParticipationBps": "0.5",
            "c1bpUsd": "2000",
        },
    }
    holdout: dict[str, object] = {
        "PUBLIC_BASE": {"strategy": {"netUsdPerInitial1000": "6"}},
        "PUBLIC_STRESS": {
            "strategy": stress,
            "oneSidedP": "0.01",
            "matchedBenchmarkExcess": {"lower5PctNetUsdPer1k": "1"},
        },
        "FEE_STRESS": {"strategy": {"netUsdPerInitial1000": "4"}},
    }
    evaluator_rows, verdict = e.evaluate_gates(
        protocol,
        development,
        champion_id,
        holdout,
    )
    verifier_rows = v.expected_gate_decisions(
        protocol,
        {"development": development, "holdout": holdout},
    )
    assert evaluator_rows == verifier_rows
    assert verdict == "GO"


def test_result_verdict_vocabulary_is_closed() -> None:
    protocol = json.loads(e.PROTOCOL_PATH.read_text())
    law = protocol["verdictLaw"]
    assert {key for key in law if key in {"GO", "NO_GO", "UNMEASURED"}} == {
        "GO",
        "NO_GO",
        "UNMEASURED",
    }
