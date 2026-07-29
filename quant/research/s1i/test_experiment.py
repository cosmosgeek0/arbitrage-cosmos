from __future__ import annotations

import io
import random
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.s1i import experiment as exp


def _zip(member: str, rows: list[str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, "\n".join(rows) + "\n")
    return buffer.getvalue()


def _month_kline_zip(symbol: str, month: str, *, premium: bool = False) -> bytes:
    grid = exp._exact_hour_grid(month)
    rows = [
        (
            "open_time,open,high,low,close,volume,close_time,quote_volume,"
            "count,taker_buy_volume,taker_buy_quote_volume,ignore"
        )
    ]
    for index, open_time in enumerate(grid):
        if premium:
            close = Decimal(index % 11 - 5) / Decimal("100000")
            rows.append(
                f"{open_time},{close},{close},{close},{close},0,"
                f"{open_time + exp.HOUR_MS - 1},0,999,0,0,0"
            )
        else:
            rows.append(
                f"{open_time},100,101,99,100,1,{open_time + exp.HOUR_MS - 1},1000000,10,1,100,0"
            )
    return _zip(f"{symbol}-1h-{month}.csv", rows)


def _synthetic_bundle(
    *, funding_settlement: bool = False
) -> tuple[exp.DataBundle, tuple[str, ...], int]:
    symbols = tuple(f"S{index:02d}USDT" for index in range(30))
    entry = int(datetime(2025, 7, 2, 1, tzinfo=UTC).timestamp() * 1000)
    exit_time = entry + 2 * exp.HOUR_MS
    bars: dict[str, dict[int, exp.Bar]] = {}
    premiums: dict[str, dict[int, exp.PremiumBar]] = {}
    funding: dict[str, tuple[exp.FundingEvent, ...]] = {}
    for index, symbol in enumerate(symbols):
        symbol_bars: dict[int, exp.Bar] = {}
        for offset in range(-24, 4):
            timestamp = entry + offset * exp.HOUR_MS
            exit_price = Decimal("100")
            if timestamp == exit_time and index < 6:
                exit_price = Decimal("101")
            elif timestamp == exit_time and index >= 24:
                exit_price = Decimal("99")
            symbol_bars[timestamp] = exp.Bar(
                timestamp,
                exit_price,
                exit_price,
                exit_price,
                exit_price,
                Decimal("100000000"),
            )
        signal = Decimal(index - 15) / Decimal("100000")
        symbol_premium = {
            entry - offset * exp.HOUR_MS: exp.PremiumBar(entry - offset * exp.HOUR_MS, signal)
            for offset in range(2, 8)
        }
        for day_offset in range(1, 31):
            training_entry = entry - day_offset * 24 * exp.HOUR_MS
            for offset in range(2, 8):
                timestamp = training_entry - offset * exp.HOUR_MS
                symbol_premium[timestamp] = exp.PremiumBar(timestamp, signal)
        symbol_premium[entry - exp.HOUR_MS] = exp.PremiumBar(entry - exp.HOUR_MS, -signal)
        symbol_premium[exit_time - exp.HOUR_MS] = exp.PremiumBar(
            exit_time - exp.HOUR_MS, Decimal("0")
        )
        bars[symbol] = symbol_bars
        premiums[symbol] = symbol_premium
        events = [
            exp.FundingEvent(entry - 8 * exp.HOUR_MS, 8, Decimal("0")),
            *(
                exp.FundingEvent(
                    entry - day_offset * 24 * exp.HOUR_MS - 8 * exp.HOUR_MS,
                    8,
                    Decimal("0"),
                )
                for day_offset in range(1, 31)
            ),
        ]
        if funding_settlement and index == 0:
            events.append(
                exp.FundingEvent(
                    entry + exp.HOUR_MS,
                    1,
                    Decimal("0.0001"),
                )
            )
        funding[symbol] = tuple(sorted(events, key=lambda event: event.time_ms))
    return exp.DataBundle(bars, premiums, funding), symbols, entry


def _cohort(entry: int, pnl: Decimal) -> exp.CohortResult:
    decomposition = exp.Decomposition(gross_price=pnl)
    return exp.CohortResult(
        entry_time_ms=entry,
        exit_time_ms=entry + exp.HOUR_MS,
        long_symbols=("LUSDT",),
        short_symbols=("SUSDT",),
        gross=exp.Decomposition(gross_price=pnl),
        base=exp.Decomposition(gross_price=pnl),
        stress=exp.Decomposition(gross_price=pnl),
        severe=decomposition,
        capacity_proxy_usd=Decimal("100000"),
        capacity_fit=True,
        premium_convergence=Decimal("0.001"),
        signal_funding_correlation=Decimal("0"),
        selected_funding_exposure_8h=Decimal("0"),
        residualization_training_pairs=900,
        funding_settlements=0,
    )


def _run(trial: exp.Trial, start: datetime, values: list[Decimal]) -> exp.TrialRun:
    cohorts = tuple(
        _cohort(
            int((start + timedelta(days=index, hours=1)).timestamp() * 1000),
            value,
        )
        for index, value in enumerate(values)
    )
    return exp.TrialRun(trial, len(cohorts), 0, {}, cohorts, 0)


def test_protocol_has_exact_predeclared_family() -> None:
    protocol, _ = exp.load_protocol()
    family = exp.trials(protocol)
    assert len(family) == 18
    assert len({trial.trial_id for trial in family}) == 18
    assert "lb06_tail20_hold02" in {trial.trial_id for trial in family}


def test_regular_and_premium_parsers_enforce_full_utc_grid() -> None:
    regular = exp.parse_kline_archive(
        _month_kline_zip("BTCUSDT", "2025-06"),
        symbol="BTCUSDT",
        month="2025-06",
    )
    premium = exp.parse_premium_archive(
        _month_kline_zip("BTCUSDT", "2025-06", premium=True),
        symbol="BTCUSDT",
        month="2025-06",
    )
    assert len(regular) == 720
    assert len(premium) == 720
    assert regular[0].quote_volume == Decimal("1000000")
    assert premium[0].close == Decimal("-0.00005")

    member = "BTCUSDT-1h-2025-06.csv"
    incomplete = _zip(
        member,
        [
            (
                "open_time,open,high,low,close,volume,close_time,quote_volume,"
                "count,taker_buy_volume,taker_buy_quote_volume,ignore"
            ),
            "1748736000000,100,101,99,100,1,1748739599999,1,1,1,1,0",
        ],
    )
    with pytest.raises(exp.EvidenceError, match="complete exact UTC month"):
        exp.parse_kline_archive(incomplete, symbol="BTCUSDT", month="2025-06")


def test_premium_parser_does_not_treat_generic_volume_fields_as_truth() -> None:
    grid = exp._exact_hour_grid("2025-06")
    rows = [
        (
            "open_time,open,high,low,close,volume,close_time,quote_volume,"
            "count,taker_buy_volume,taker_buy_quote_volume,ignore"
        )
    ]
    for open_time in grid:
        rows.append(
            f"{open_time},0,0,0,0.0001,999999,{open_time + exp.HOUR_MS - 1},888888,777,666,555,444"
        )
    parsed = exp.parse_premium_archive(
        _zip("BTCUSDT-1h-2025-06.csv", rows),
        symbol="BTCUSDT",
        month="2025-06",
    )
    assert parsed[0] == exp.PremiumBar(grid[0], Decimal("0.0001"))


def test_funding_parser_preserves_actual_irregular_timestamps() -> None:
    lower = int(datetime(2025, 7, 1, tzinfo=UTC).timestamp() * 1000)
    upper = int(datetime(2025, 8, 1, tzinfo=UTC).timestamp() * 1000)
    event_rows = [
        f"{lower + 1},8,0.0001",
        f"{lower + 8 * exp.HOUR_MS},4,-0.0002",
    ]
    cursor = lower + 12 * exp.HOUR_MS
    while cursor < upper:
        event_rows.append(f"{cursor},4,0.0001")
        cursor += 4 * exp.HOUR_MS
    raw = _zip(
        "BTCUSDT-fundingRate-2025-07.csv",
        [
            "calc_time,funding_interval_hours,last_funding_rate",
            *event_rows,
        ],
    )
    events = exp.parse_funding_archive(raw, symbol="BTCUSDT", month="2025-07")
    assert [event.interval_hours for event in events[:2]] == [8, 4]
    assert events[0].time_ms == lower + 1
    assert exp._latest_funding_rate_8h(events, lower + 9 * exp.HOUR_MS) == Decimal("-0.0004")


def test_premium_signal_applies_prior_coefficients_out_of_sample() -> None:
    premium = {
        "A": Decimal("0.001"),
        "B": Decimal("0.002"),
        "C": Decimal("0.003"),
    }
    funding = {
        "A": Decimal("0.0001"),
        "B": Decimal("0.0002"),
        "C": Decimal("0.0003"),
    }
    residuals, correlation = exp.residualize_premium_signal(
        premium,
        funding,
        intercept=Decimal("0"),
        slope=Decimal("10"),
    )
    assert set(residuals.values()) == {Decimal("0")}
    assert correlation == Decimal("0")


def test_selected_portfolio_funding_exposure_is_signed_dollar_weighted() -> None:
    exposure = exp.selected_portfolio_funding_exposure_8h(
        {
            "L1": Decimal("0.0001"),
            "L2": Decimal("0.0001"),
            "S1": Decimal("0.0003"),
            "S2": Decimal("0.0003"),
        },
        long_symbols=("L1", "L2"),
        short_symbols=("S1", "S2"),
    )
    assert exposure == Decimal("0.0001")


def test_residualization_coefficients_use_prior_same_anchor_panels_only() -> None:
    bundle, symbols, entry = _synthetic_bundle()
    coefficients = exp.fit_prior_residualization(
        bundle,
        symbols=symbols,
        trial=exp.Trial("lb06_tail20_hold02", 6, Decimal("0.20"), 2),
        entry_ms=entry,
        training_days=30,
        minimum_pairs=600,
    )
    assert coefficients is not None
    _, slope, pairs = coefficients
    assert slope == Decimal("0")
    assert pairs == 900


def test_signal_is_closed_bar_causal_and_dollar_neutral() -> None:
    bundle, symbols, entry = _synthetic_bundle()
    trial = exp.Trial("lb06_tail20_hold02", 6, Decimal("0.20"), 2)
    result, reason = exp.evaluate_cohort(
        bundle,
        symbols=symbols,
        trial=trial,
        entry_ms=entry,
        minimum_eligible=20,
        fee_rate=Decimal("0.0005"),
        adverse_rates=(
            Decimal("0.0002"),
            Decimal("0.0005"),
            Decimal("0.001"),
        ),
    )
    assert reason is None
    assert result is not None
    assert result.long_symbols == symbols[:6]
    assert result.short_symbols == symbols[-6:]
    assert result.gross.net > 0
    assert result.base.net < result.gross.net
    assert result.stress.net < result.base.net
    assert result.severe.net < result.stress.net
    assert result.gross.funding == Decimal("0")
    assert result.selected_funding_exposure_8h == Decimal("0")
    assert result.capacity_fit is True


def test_actual_funding_settlement_makes_selected_cohort_unmeasured() -> None:
    bundle, symbols, entry = _synthetic_bundle(funding_settlement=True)
    result, reason = exp.evaluate_cohort(
        bundle,
        symbols=symbols,
        trial=exp.Trial("lb06_tail20_hold02", 6, Decimal("0.20"), 2),
        entry_ms=entry,
        minimum_eligible=20,
        fee_rate=Decimal("0.0005"),
        adverse_rates=(
            Decimal("0.0002"),
            Decimal("0.0005"),
            Decimal("0.001"),
        ),
    )
    assert result is None
    assert reason == "SELECTED_FUNDING_SETTLEMENT_UNMEASURED"


def test_funding_at_entry_or_exit_boundary_is_unmeasured() -> None:
    entry = 100 * exp.HOUR_MS
    exit_time = entry + 2 * exp.HOUR_MS
    assert (
        exp._position_funding(
            events=(exp.FundingEvent(entry, 8, Decimal("0.0001")),),
            entry_ms=entry,
            exit_ms=exit_time,
        )
        is None
    )
    assert (
        exp._position_funding(
            events=(exp.FundingEvent(exit_time, 8, Decimal("0.0001")),),
            entry_ms=entry,
            exit_ms=exit_time,
        )
        is None
    )


def test_atomic_tail_refuses_to_split_boundary_ties() -> None:
    signals = {
        "A": Decimal("1"),
        "B": Decimal("2"),
        "C": Decimal("2"),
        "D": Decimal("2"),
        "E": Decimal("3"),
    }
    assert exp._atomic_tail(signals, 2, lowest=True) == ("A",)
    assert exp._atomic_tail(signals, 2, lowest=False) == ("E",)


def test_cost_decomposition_reconciles_and_is_monotonic() -> None:
    gross = exp._position_decomposition(
        entry=Decimal("100"),
        exit_price=Decimal("101"),
        notional=Decimal("100"),
        sign=1,
        fee_rate=Decimal("0"),
        adverse_rate=Decimal("0"),
    )
    base = exp._position_decomposition(
        entry=Decimal("100"),
        exit_price=Decimal("101"),
        notional=Decimal("100"),
        sign=1,
        fee_rate=Decimal("0.0005"),
        adverse_rate=Decimal("0.0002"),
    )
    stress = exp._position_decomposition(
        entry=Decimal("100"),
        exit_price=Decimal("101"),
        notional=Decimal("100"),
        sign=1,
        fee_rate=Decimal("0.0005"),
        adverse_rate=Decimal("0.0005"),
    )
    assert gross.net == gross.gross_price
    assert base.net == base.gross_price - base.fee - base.adverse
    assert gross.net > base.net > stress.net


def test_bootstrap_and_circular_blocks_are_seed_deterministic() -> None:
    first = exp.bootstrap_interval(
        [Decimal("1"), Decimal("-1"), Decimal("2")] * 10,
        replicates=128,
        block_length=3,
        seed=7,
    )
    second = exp.bootstrap_interval(
        [Decimal("1"), Decimal("-1"), Decimal("2")] * 10,
        replicates=128,
        block_length=3,
        seed=7,
    )
    assert first == second
    assert exp.circular_indices(10, 3, random.Random(4)) == (
        3,
        4,
        5,
        4,
        5,
        6,
        1,
        2,
        3,
        6,
    )


def test_multiplicity_and_pbo_do_not_turn_zero_into_evidence() -> None:
    protocol, _ = exp.load_protocol()
    family = exp.trials(protocol)
    start = datetime(2025, 7, 1, tzinfo=UTC)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int((start + timedelta(days=264)).timestamp() * 1000)
    zero_runs = {trial.trial_id: _run(trial, start, [Decimal("0")] * 264) for trial in family}
    multiplicity = exp.development_multiplicity(
        zero_runs,
        start_ms=start_ms,
        end_ms=end_ms,
        primary_id="lb06_tail20_hold02",
        replicates=128,
        block_length=7,
        seed=9,
    )
    assert multiplicity["primaryPass"] is False
    assert multiplicity["holmRejected"] == []

    pbo = exp.pbo_cscv(
        zero_runs,
        start_ms=start_ms,
        end_ms=end_ms,
        core_days=264,
        blocks=12,
    )
    assert pbo["status"] == "MEASURED"
    assert pbo["pbo"] == "1.00000000"
    assert pbo["splits"] == 924


def test_walk_forward_deploys_only_the_predeclared_primary() -> None:
    start = datetime(2025, 7, 1, tzinfo=UTC)
    end = datetime(2025, 11, 1, tzinfo=UTC)
    days = (end - start).days
    first = exp.Trial("a", 1, Decimal("0.2"), 1)
    second = exp.Trial("b", 1, Decimal("0.2"), 1)
    first_values = [Decimal("1") if index < 92 else Decimal("-1") for index in range(days)]
    second_values = [Decimal("0") if index < 92 else Decimal("2") for index in range(days)]
    result = exp.walk_forward(
        {
            "a": _run(first, start, first_values),
            "b": _run(second, start, second_values),
        },
        start_ms=int(start.timestamp() * 1000),
        end_ms=int(end.timestamp() * 1000),
        test_months=("2025-10",),
        primary_id="a",
    )
    folds = result["folds"]
    assert isinstance(folds, list)
    assert folds[0]["deployedTrialId"] == "a"
    assert folds[0]["testStressNetUsd"].startswith("-")


def test_incomplete_evidence_is_unknown_not_measured_failure() -> None:
    decisions = exp._preholdout_decisions(
        primary_summary={
            "completedCohorts": 799,
            "invalidCohorts": 1,
            "gross": {"grossPriceUsd": "-1"},
            "base": {"netUsd": "-1"},
            "stress": {"netUsd": "-2"},
        },
        multiplicity={"status": "UNKNOWN"},
        walk={"status": "UNKNOWN"},
        minimum_development=800,
        maximum_funding_correlation=Decimal("0.25"),
        maximum_selected_funding_exposure=Decimal("0.00005"),
    )
    assert {item["status"] for item in decisions} == {"UNKNOWN"}


def test_incomplete_holdout_is_unknown_not_measured_failure() -> None:
    decisions = exp._final_decisions(
        holdout_summary={
            "completedCohorts": 259,
            "invalidCohorts": 1,
            "distinctLongSymbols": 20,
            "distinctShortSymbols": 20,
            "gross": {"grossPriceUsd": "-1"},
            "base": {"netUsd": "-2"},
            "stress": {"netUsd": "-3"},
            "baseExitBoundaryMaximumDrawdownPct": "2",
            "meanAbsoluteOutOfSampleSignalFundingCorrelation": None,
            "meanAbsoluteSelectedPortfolioFundingExposure8h": None,
            "minimumCapacityProxyUsd": None,
            "allActualLegsFitVolumeProxy": True,
        },
        interval={"status": "UNKNOWN"},
        beta={"status": "UNKNOWN"},
        minimum_holdout=260,
        minimum_distinct=10,
        maximum_drawdown_pct=Decimal("20"),
        maximum_abs_beta=Decimal("0.25"),
        minimum_capacity=Decimal("1000"),
        maximum_funding_correlation=Decimal("0.25"),
        maximum_selected_funding_exposure=Decimal("0.00005"),
    )
    assert {item["status"] for item in decisions} == {"UNKNOWN"}


def test_conclusive_failure_precedes_unrelated_unknown() -> None:
    assert (
        exp._aggregate_decision_status(
            (
                {"gate": "measured", "status": "FAIL"},
                {"gate": "missing", "status": "UNKNOWN"},
            )
        )
        == "FAIL"
    )


def test_sealed_write_refuses_overwrite(tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    exp.exclusive_write(path, b"first")
    with pytest.raises(exp.EvidenceError, match="refusing to overwrite"):
        exp.exclusive_write(path, b"second")


def test_screen_binding_requires_the_frozen_june_bytes(tmp_path: Path) -> None:
    artifact = {
        "sha256": "a" * 64,
        "checksumSha256": "b" * 64,
        "bytes": 123,
    }
    screen = {
        "schema": "S1IScreenManifestV1",
        "protocolSha256": "c" * 64,
        "selected": [
            {
                "rank": 1,
                "symbol": "BTCUSDT",
                "quoteVolume": "1000",
                "artifact": artifact,
            }
        ],
    }
    screen_raw = exp.canonical_bytes(screen)
    exp.exclusive_write(tmp_path / exp.INVENTORY_NAME, screen_raw)
    freeze = {
        "bindings": {
            "screenManifestSha256": exp.sha256_bytes(screen_raw),
            "protocolSha256": "c" * 64,
        },
        "selectedCohort": [
            {
                "rank": 1,
                "symbol": "BTCUSDT",
                "screenQuoteVolume": "1000",
                "screenArchiveSha256": "a" * 64,
                "screenChecksumSha256": "b" * 64,
                "screenArchiveBytes": 123,
            }
        ],
    }
    lookup = {("klines", "BTCUSDT", "2025-06"): artifact}
    exp._verify_screen_bindings(tmp_path, freeze, lookup)
    with pytest.raises(exp.EvidenceError, match="differ from freeze"):
        exp._verify_screen_bindings(
            tmp_path,
            freeze,
            {
                ("klines", "BTCUSDT", "2025-06"): {
                    **artifact,
                    "sha256": "d" * 64,
                }
            },
        )


def test_full_frozen_packet_detects_freeze_drift(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, protocol_sha = exp.load_protocol()
    freeze = {
        "bindings": {
            "protocolSha256": protocol_sha,
            "officialSourceResearchSha256": exp.sha256_path(exp.OFFICIAL_SOURCES_PATH),
            "evaluatorSha256": exp.script_sha(),
        }
    }
    raw = exp.canonical_bytes(freeze)
    freeze_path = tmp_path / "freeze.json"
    exp.exclusive_write(freeze_path, raw)
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze_path)
    assert (
        exp._assert_frozen_packet(
            freeze,
            expected_freeze_sha=exp.sha256_bytes(raw),
        )
        == exp.script_sha()
    )
    freeze_path.write_bytes(raw + b" ")
    with pytest.raises(exp.EvidenceError, match="changed during the sealed run"):
        exp._assert_frozen_packet(
            freeze,
            expected_freeze_sha=exp.sha256_bytes(raw),
        )
