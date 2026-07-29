from __future__ import annotations

import copy
import hashlib
import itertools
import zipfile
from collections.abc import Callable
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
    preserved = {
        name: vg27.packet_artifact(name).read_bytes()
        for name in (
            vg27.FREEZE_V1_NAME,
            vg27.FREEZE_V2_NAME,
            vg27.FREEZE_V1_SUPERSESSION_NAME,
            vg27.FREEZE_V2_SUPERSESSION_NAME,
        )
    }
    packet = tmp_path / "packet"
    packet.mkdir()
    monkeypatch.setattr(vg27, "PACKET_DIR", packet)
    for name, raw in preserved.items():
        vg27.write_exclusive(vg27.packet_artifact(name), raw)
    return packet


def _empty_bars() -> dict[str, dict[datetime, vg27.Bar]]:
    return {symbol: {} for symbol in vg27.COHORT}


def _synthetic_scenario(
    trial_id: str,
    scenario_name: str,
    *,
    net: str = "1",
) -> dict[str, object]:
    net_value = Decimal(net)
    ending = vg27.STARTING_USD + net_value
    fee = Decimal("0.25")
    adverse = Decimal("0.25")
    gross = net_value + fee + adverse
    activity = dict.fromkeys(
        (
            "2025-07",
            "2025-08",
            "2025-09",
            "2025-10",
            "2025-11",
            "2025-12",
            "2026-01",
        ),
        12,
    )
    activity["2026-02"] = 16
    return {
        "activeMonths": 8,
        "activityByMonth": activity,
        "adverseCostUsd": vg27.decimal_text(adverse),
        "costReconciliation": {
            "endingUsd": vg27.decimal_text(ending),
            "matches": True,
            "startingPlusGrossMinusFeeMinusAdverseUsd": vg27.decimal_text(ending),
        },
        "endingUsd": vg27.decimal_text(ending),
        "eventCount": 100,
        "executableCapacity": "UNMEASURED",
        "feeCostUsd": vg27.decimal_text(fee),
        "grossTradingPnlUsd": vg27.decimal_text(gross),
        "maxDrawdownFraction": "0.10",
        "maximumActualEntryToNominalScreenRatio": "1",
        "minimumNominalInitial1000ScreenUsd": "1000",
        "netUsdPer1k": net,
        "nominalInitial1000ScreenPass": True,
        "reinvestmentMayExceedNominalScreen": True,
        "scenario": scenario_name,
        "trialId": trial_id,
    }


def _synthetic_bootstrap() -> dict[str, object]:
    return {
        "blockHours": vg27.BOOTSTRAP_BLOCK_HOURS,
        "lower95UsdPer1k": "1",
        "medianUsdPer1k": "2",
        "observations": 6552,
        "oneSidedCenteredP": "0.01",
        "replicates": vg27.BOOTSTRAP_REPLICATES,
        "upper95UsdPer1k": "3",
    }


def _synthetic_development(*, authorized: bool) -> dict[str, object]:
    trial_ids = tuple(trial.trial_id for trial in vg27.trial_grid())
    champion = trial_ids[0]
    trials = {
        trial_id: {
            scenario.name: _synthetic_scenario(
                trial_id,
                scenario.name,
                net=("-1" if trial_id == champion else "-2")
                if not authorized and scenario.name == "base"
                else "1",
            )
            for scenario in vg27.scenarios()
        }
        for trial_id in trial_ids
    }
    gates = {
        "activeMonthsAtLeast8": True,
        "baseLcbPositive": True,
        "baseNetPositive": authorized,
        "drawdownAtMost20Pct": True,
        "holmAdjustedPBelow0.05": True,
        "nominalInitial1000ScreenAtLeast1000": True,
        "onEventsAtLeast100": True,
        "stressLcbPositive": True,
        "stressNetPositive": True,
        "whitePBelow0.05": True,
    }
    bootstrap = {
        name: {trial_id: _synthetic_bootstrap() for trial_id in trial_ids}
        for name in ("base", "stress")
    }
    return {
        "authorizedToOpenHoldout": authorized,
        "bootstrap": bootstrap,
        "champion": champion,
        "championEventConcentrationMaximumMonthFraction": "0.2",
        "diagnostics": {
            "pboAtMost0.5": True,
            "pboRole": "DIAGNOSTIC_ONLY_NEVER_SELECTION_OR_HOLDOUT_AUTHORIZATION",
        },
        "formalGates": gates,
        "holmAdjustedP": dict.fromkeys(trial_ids, "0.01"),
        "pbo": {
            "blocks": 8,
            "diagnosticOnlyNeverSelectionRescue": True,
            "distinctTrialPaths": 2,
            "probabilityOverfit": "0.25",
            "splitCount": 70,
            "status": "ESTIMATED",
        },
        "programWideMultiplicity": dict(vg27.PROGRAM_MULTIPLICITY),
        "trials": trials,
        "white": {
            "method": "CENTERED_SYNCHRONOUS_WHITE_MAX_STAT",
            "observed": "1",
            "pValue": "0.01",
            "trialCount": len(trial_ids),
        },
    }


def _synthetic_holdout(champion: str, *, go: bool = True) -> dict[str, object]:
    gates = {
        "baseLcbPositive": True,
        "baseNetPositive": go,
        "drawdownAtMost20Pct": True,
        "nominalInitial1000ScreenAtLeast1000": True,
        "stressLcbPositive": True,
        "stressNetPositive": True,
    }
    return {
        "confirmationGates": gates,
        "intervals": {
            "base": _synthetic_bootstrap(),
            "stress": _synthetic_bootstrap(),
        },
        "publicVerdict": "GO" if go else "NO_GO",
        "scenarios": {
            scenario.name: _synthetic_scenario(
                champion,
                scenario.name,
                net="-1" if not go and scenario.name == "base" else "1",
            )
            for scenario in vg27.scenarios()
        },
    }


def _frozen_state(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _isolate_packet(tmp_path, monkeypatch)
    _fake_manifest(tmp_path)
    for name in (vg27.FREEZE_V1_NAME, vg27.FREEZE_V2_NAME):
        vg27.write_exclusive(
            tmp_path / name,
            vg27.packet_artifact(name).read_bytes(),
        )
    vg27.freeze(tmp_path)


def _synthetic_manifest_reader(
    state_root: Path,
    phases: list[str],
) -> Callable[
    ...,
    tuple[dict[str, object], dict[str, dict[datetime, vg27.Bar]]],
]:
    def reader(
        root: Path,
        *,
        open_archives: bool,
        months: frozenset[str] | None = None,
    ) -> tuple[dict[str, object], dict[str, dict[datetime, vg27.Bar]]]:
        assert root == state_root
        manifest = vg27.load_json(root / vg27.SOURCE_MANIFEST_NAME, canonical=True)
        if open_archives:
            if months == frozenset(vg27.DEVELOPMENT_MONTHS):
                phases.append("DEVELOPMENT_OPENED")
            elif months == frozenset(vg27.HOLDOUT_MONTHS):
                assert vg27.receipt_state(root, vg27.DEVELOPMENT_SELECTION_NAME) == "MATCHED"
                assert vg27.receipt_state(root, vg27.HOLDOUT_MARKER_NAME) == "MATCHED"
                phases.append("HOLDOUT_OPENED_AFTER_SELECTION_AND_MARKER")
            else:
                raise AssertionError("unexpected open partition")
        return manifest, _empty_bars()

    return reader


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
    assert simulation.minimum_nominal_initial_1000_screen_usd == Decimal("2000")
    assert simulation.maximum_entry_to_screen_ratio is not None
    assert simulation.fee_cost_usd > 0
    assert simulation.adverse_cost_usd > 0
    assert simulation.ending_usd == (
        vg27.STARTING_USD
        + simulation.gross_trading_pnl_usd
        - simulation.fee_cost_usd
        - simulation.adverse_cost_usd
    )
    assert simulation.max_drawdown >= Decimal("0.0029")
    mapping = vg27.simulation_mapping(simulation)
    assert mapping["nominalInitial1000ScreenPass"] is True
    assert mapping["reinvestmentMayExceedNominalScreen"] is True
    assert mapping["executableCapacity"] == "UNMEASURED"


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
    assert pbo["splitCount"] == 70
    assert pbo["status"] == "NOT_ESTIMABLE"
    assert pbo["probabilityOverfit"] is None
    assert pbo["diagnosticOnlyNeverSelectionRescue"] is True
    distinct_paths = dict(paths)
    distinct_paths[vg27.trial_grid()[0].trial_id] = tuple(
        Decimal("0.002") if index % 11 == 0 else Decimal(0) for index in range(336)
    )
    estimated = vg27.cscv_pbo(distinct_paths)
    assert estimated["splitCount"] == 70
    assert estimated["status"] == "ESTIMATED"
    assert (
        vg27.average_oos_rank_percentile(
            {"a": 3.0, "b": 2.0, "c": 2.0, "d": 1.0},
            "b",
        )
        == 0.5
    )


def test_development_no_go_seals_selection_and_never_opens_holdout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    phases: list[str] = []
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, phases),
    )
    development = _synthetic_development(authorized=False)
    monkeypatch.setattr(vg27, "development_analysis", lambda _bars: development)
    monkeypatch.setattr(
        vg27,
        "holdout_analysis",
        lambda *_args: pytest.fail("development NO_GO opened holdout"),
    )
    result = vg27.run(tmp_path)
    assert result["status"] == "NO_GO"
    assert result["holdout"] == "UNOPENED"
    assert phases == ["DEVELOPMENT_OPENED"]
    assert vg27.receipt_state(tmp_path, vg27.DEVELOPMENT_SELECTION_NAME) == "MATCHED"
    assert vg27.receipt_state(tmp_path, vg27.HOLDOUT_MARKER_NAME) == "ABSENT"
    assert vg27.verify_semantic_state(tmp_path, check_inventory=False)["terminalStatus"] == "NO_GO"
    with pytest.raises(vg27.CustodyError, match="packet inventory absent"):
        vg27.verify(tmp_path)


def test_holdout_opens_only_after_paired_selection_and_marker(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    phases: list[str] = []
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, phases),
    )
    development = _synthetic_development(authorized=True)
    champion = str(development["champion"])
    monkeypatch.setattr(vg27, "development_analysis", lambda _bars: development)
    monkeypatch.setattr(
        vg27,
        "holdout_analysis",
        lambda _bars, _champion: _synthetic_holdout(champion),
    )
    result = vg27.run(tmp_path)
    assert result["status"] == "GO"
    assert phases == [
        "DEVELOPMENT_OPENED",
        "HOLDOUT_OPENED_AFTER_SELECTION_AND_MARKER",
    ]
    assert vg27.verify_semantic_state(tmp_path, check_inventory=False)["terminalStatus"] == "GO"


def test_development_open_failure_is_verifiable_unmeasured_and_refuses_rerun(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    base_reader = _synthetic_manifest_reader(tmp_path, [])

    def fail_after_marker(
        root: Path,
        *,
        open_archives: bool,
        months: frozenset[str] | None = None,
    ) -> tuple[dict[str, object], dict[str, dict[datetime, vg27.Bar]]]:
        if open_archives:
            raise vg27.MeasurementError("synthetic development body failure")
        return base_reader(root, open_archives=False, months=months)

    monkeypatch.setattr(vg27, "validate_manifest", fail_after_marker)
    result = vg27.run(tmp_path)
    assert result["status"] == "UNMEASURED"
    assert result["holdout"] == "UNOPENED"
    assert (
        vg27.verify_semantic_state(tmp_path, check_inventory=False)["terminalStatus"]
        == "UNMEASURED"
    )
    with pytest.raises(vg27.CustodyError, match="rerun refused"):
        vg27.run(tmp_path)


def test_first_packet_marker_create_failure_leaves_retryable_zero_receipts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    monkeypatch.setattr(
        vg27,
        "development_analysis",
        lambda _bars: _synthetic_development(authorized=False),
    )
    original_publish = vg27.write_packet_authority_exclusive

    def fail_first_packet_publish(path: Path, value: object | bytes) -> None:
        if path == vg27.packet_artifact(vg27.DEVELOPMENT_MARKER_NAME):
            raise OSError("synthetic failure before packet authority publication")
        original_publish(path, value)

    monkeypatch.setattr(
        vg27,
        "write_packet_authority_exclusive",
        fail_first_packet_publish,
    )
    with pytest.raises(OSError, match="before packet authority publication"):
        vg27.run(tmp_path)
    assert set(vg27.receipt_states(tmp_path).values()) == {"ABSENT"}
    assert not vg27.packet_artifact(vg27.CUSTODY_TERMINAL_NAME).exists()
    assert not vg27.packet_artifact(vg27.CUSTODY_TERMINAL_NAME).is_symlink()
    monkeypatch.setattr(
        vg27,
        "write_packet_authority_exclusive",
        original_publish,
    )
    assert vg27.run(tmp_path)["status"] == "NO_GO"


def test_truncated_packet_marker_is_bound_custody_unmeasured_and_sealable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    marker_path = vg27.packet_artifact(vg27.DEVELOPMENT_MARKER_NAME)
    marker_path.write_bytes(b'{"truncated":')
    terminal = vg27.run(tmp_path)
    evidence = vg27.required_mapping(terminal["receiptEvidence"], "receiptEvidence")
    marker_evidence = vg27.required_mapping(
        evidence[vg27.DEVELOPMENT_MARKER_NAME],
        "marker evidence",
    )
    packet_evidence = vg27.required_mapping(
        marker_evidence["packet"],
        "packet evidence",
    )
    assert packet_evidence["authorityJson"] == "INVALID_OR_NONCANONICAL"
    assert packet_evidence["sha256"] == vg27.sha256_path(marker_path)
    assert vg27.seal(tmp_path)["semanticStatus"] == "VERIFIED_CUSTODY_UNMEASURED"
    assert vg27.verify(tmp_path)["terminalStatus"] == "UNMEASURED"


def test_symlink_packet_marker_is_bound_non_authorizing_and_sealable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    marker_path = vg27.packet_artifact(vg27.DEVELOPMENT_MARKER_NAME)
    marker_path.symlink_to(tmp_path / "never-follow-this-target")
    terminal = vg27.run(tmp_path)
    evidence = vg27.required_mapping(terminal["receiptEvidence"], "receiptEvidence")
    marker_evidence = vg27.required_mapping(
        evidence[vg27.DEVELOPMENT_MARKER_NAME],
        "marker evidence",
    )
    packet_evidence = vg27.required_mapping(
        marker_evidence["packet"],
        "packet evidence",
    )
    assert packet_evidence["kind"] == "SYMLINK"
    assert packet_evidence["authorityJson"] == "INVALID_NONREGULAR"
    assert vg27.seal(tmp_path)["semanticStatus"] == "VERIFIED_CUSTODY_UNMEASURED"
    assert vg27.verify(tmp_path)["terminalStatus"] == "UNMEASURED"


def test_partial_development_marker_replica_is_custody_terminal_and_sealable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    original_write = vg27.write_exclusive

    def fail_external_marker(path: Path, value: object | bytes) -> None:
        if path == tmp_path / vg27.DEVELOPMENT_MARKER_NAME:
            raise OSError("synthetic replica interruption")
        original_write(path, value)

    monkeypatch.setattr(vg27, "write_exclusive", fail_external_marker)
    terminal = vg27.run(tmp_path)
    assert terminal["status"] == "UNMEASURED"
    states = vg27.required_mapping(terminal["receiptStates"], "receiptStates")
    assert states[vg27.DEVELOPMENT_MARKER_NAME] == "PACKET_ONLY"
    assert vg27.seal(tmp_path)["semanticStatus"] == "VERIFIED_CUSTODY_UNMEASURED"
    assert vg27.verify(tmp_path)["terminalAuthority"] == vg27.CUSTODY_TERMINAL_NAME


def test_partial_result_replica_is_custody_terminal_and_sealable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    monkeypatch.setattr(
        vg27,
        "development_analysis",
        lambda _bars: _synthetic_development(authorized=False),
    )
    original_write = vg27.write_exclusive

    def fail_external_result(path: Path, value: object | bytes) -> None:
        if path == tmp_path / vg27.RESULT_NAME:
            raise OSError("synthetic result replica interruption")
        original_write(path, value)

    monkeypatch.setattr(vg27, "write_exclusive", fail_external_result)
    terminal = vg27.run(tmp_path)
    assert terminal["status"] == "UNMEASURED"
    states = vg27.required_mapping(terminal["receiptStates"], "receiptStates")
    assert states[vg27.RESULT_NAME] == "PACKET_ONLY"
    assert vg27.seal(tmp_path)["semanticStatus"] == "VERIFIED_CUSTODY_UNMEASURED"
    assert vg27.verify(tmp_path)["terminalStatus"] == "UNMEASURED"


def test_forged_go_with_cost_and_net_contradiction_is_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    development = _synthetic_development(authorized=True)
    champion = str(development["champion"])
    monkeypatch.setattr(vg27, "development_analysis", lambda _bars: development)
    monkeypatch.setattr(
        vg27,
        "holdout_analysis",
        lambda _bars, _champion: _synthetic_holdout(champion),
    )
    assert vg27.run(tmp_path)["status"] == "GO"
    result = vg27.load_json(vg27.packet_artifact(vg27.RESULT_NAME), canonical=True)
    result["holdout"]["scenarios"]["base"]["netUsdPer1k"] = "-1"
    raw = vg27.canonical_bytes(result)
    vg27.packet_artifact(vg27.RESULT_NAME).write_bytes(raw)
    (tmp_path / vg27.RESULT_NAME).write_bytes(raw)
    with pytest.raises(vg27.CustodyError, match="ending and net do not reconcile"):
        vg27.verify(tmp_path)


def test_wrong_development_champion_is_rejected_before_holdout_authority(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    development = _synthetic_development(authorized=True)
    development["champion"] = vg27.trial_grid()[1].trial_id
    monkeypatch.setattr(vg27, "development_analysis", lambda _bars: development)
    monkeypatch.setattr(
        vg27,
        "holdout_analysis",
        lambda *_args: pytest.fail("wrong champion reached holdout"),
    )
    result = vg27.run(tmp_path)
    assert result["status"] == "UNMEASURED"
    assert vg27.receipt_state(tmp_path, vg27.DEVELOPMENT_SELECTION_NAME) == "ABSENT"
    assert vg27.receipt_state(tmp_path, vg27.HOLDOUT_MARKER_NAME) == "ABSENT"
    assert "frozen selection rule" in str(result["reason"])


def test_non_2048_bootstrap_receipt_is_rejected() -> None:
    development = _synthetic_development(authorized=True)
    bootstrap = vg27.required_mapping(development["bootstrap"], "bootstrap")
    base = vg27.required_mapping(bootstrap["base"], "base bootstrap")
    champion = str(development["champion"])
    summary = vg27.required_mapping(base[champion], "champion bootstrap")
    summary["replicates"] = 1024
    with pytest.raises(vg27.CustodyError, match="replicate count invalid"):
        vg27.validate_development_report(development)


def test_forged_holdout_marker_selection_binding_is_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    development = _synthetic_development(authorized=True)
    champion = str(development["champion"])
    monkeypatch.setattr(vg27, "development_analysis", lambda _bars: development)
    monkeypatch.setattr(
        vg27,
        "holdout_analysis",
        lambda _bars, _champion: _synthetic_holdout(champion),
    )
    assert vg27.run(tmp_path)["status"] == "GO"
    marker = vg27.load_json(
        vg27.packet_artifact(vg27.HOLDOUT_MARKER_NAME),
        canonical=True,
    )
    marker["developmentSelectionSha256"] = "0" * 64
    raw = vg27.canonical_bytes(marker)
    vg27.packet_artifact(vg27.HOLDOUT_MARKER_NAME).write_bytes(raw)
    (tmp_path / vg27.HOLDOUT_MARKER_NAME).write_bytes(raw)
    with pytest.raises(vg27.CustodyError, match="selection binding invalid"):
        vg27.verify(tmp_path)


def test_verify_hashes_but_never_opens_archives_or_recomputes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _frozen_state(tmp_path, monkeypatch)
    original_validate_manifest = vg27.validate_manifest
    monkeypatch.setattr(
        vg27,
        "validate_manifest",
        _synthetic_manifest_reader(tmp_path, []),
    )
    monkeypatch.setattr(
        vg27,
        "development_analysis",
        lambda _bars: _synthetic_development(authorized=False),
    )
    assert vg27.run(tmp_path)["status"] == "NO_GO"
    vg27.seal(tmp_path)
    monkeypatch.setattr(vg27, "validate_manifest", original_validate_manifest)
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
    assert vg27.FREEZE_NAME == "freeze.v3.json"
    assert vg27.sha256_path(vg27.packet_artifact(vg27.FREEZE_V1_NAME)) == (vg27.FREEZE_V1_SHA256)
    assert vg27.sha256_path(vg27.packet_artifact(vg27.FREEZE_V2_NAME)) == (vg27.FREEZE_V2_SHA256)
    assert protocol["authority"]["capital"] == "NO_GO"
    assert protocol["authority"]["execution"] == "NONE"
    assert protocol["authority"]["moneyEffectUsd"] == "0"
    assert protocol["data"]["symbols"] == list(vg27.COHORT)
    assert (
        protocol["inference"]["cscvPbo"]["role"]
        == "DIAGNOSTIC_ONLY_NEVER_SELECTION_HOLDOUT_AUTHORIZATION_OR_RESCUE"
    )
