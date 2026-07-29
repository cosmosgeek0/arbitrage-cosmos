"""Network-free focused acceptance tests for the sealed S-1K evaluator."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from research.s1k import experiment as exp

D = Decimal


def test_frozen_trial_family_is_complete() -> None:
    protocol, _ = exp.load_protocol()
    trials = exp.trial_specs(protocol)

    assert len(trials) == 18
    assert len({trial.trial_id for trial in trials}) == 18
    assert "F00050_BASIS_MR_H168" in {trial.trial_id for trial in trials}


def test_archive_paths_keep_product_and_dataset_distinct() -> None:
    assert exp.archive_relative("cm", "fundingRate", "BTCUSD_PERP", "2026-06") == (
        "data/futures/cm/monthly/fundingRate/BTCUSD_PERP/BTCUSD_PERP-fundingRate-2026-06.zip"
    )
    assert exp.archive_relative("um", "markPriceKlines", "BTCUSDT", "2026-06") == (
        "data/futures/um/monthly/markPriceKlines/BTCUSDT/1h/BTCUSDT-1h-2026-06.zip"
    )


def test_inverse_and_linear_price_pnl_identity() -> None:
    face = D("1000")
    coin_entry = D("100")
    coin_exit = D("110")
    usd_entry = D("100")
    usd_exit = D("105")
    coin_pnl_coin = face * (D(1) / coin_entry - D(1) / coin_exit)
    usd_quantity = face / coin_entry
    direct = coin_pnl_coin * usd_exit - usd_quantity * (usd_exit - usd_entry)

    combined = exp.combined_price_pnl(
        1,
        coin_entry,
        coin_exit,
        usd_entry,
        usd_exit,
        face,
    )

    assert abs(combined - direct) < D("1e-44")
    reverse = exp.combined_price_pnl(
        -1,
        coin_entry,
        coin_exit,
        usd_entry,
        usd_exit,
        face,
    )
    assert abs(reverse + direct) < D("1e-44")


def test_funding_cashflow_direction_is_relative() -> None:
    relative = D("0.0012") - D("0.0004")

    assert D(1) * exp.FACE_USD * relative == D("0.8")
    assert D(-1) * exp.FACE_USD * relative == D("-0.8")


def test_public_proxy_costs_are_exact_and_monotone() -> None:
    maker_fee, maker_adverse = exp.round_trip_cost(exp.MAKER_FEE_BPS, exp.MAKER_ADVERSE_BPS)
    stress_fee, stress_adverse = exp.round_trip_cost(exp.STRESS_FEE_BPS, exp.STRESS_ADVERSE_BPS)

    assert (maker_fee, maker_adverse) == (D("0.8"), D("0.4"))
    assert (stress_fee, stress_adverse) == (D("2"), D("4"))
    assert stress_fee + stress_adverse > maker_fee + maker_adverse


def test_kline_parser_handles_header_and_keeps_auxiliary_volume() -> None:
    raw = (
        b"open_time,open,high,low,close,volume,close_time,base_asset_volume\n"
        b"1735689600000,100,101,99,100.5,12,1735693199999,7.5\n"
    )

    parsed = exp.parse_kline_csv(raw)

    assert parsed[1735689600000].open == D("100")
    assert parsed[1735689600000].close == D("100.5")
    assert parsed[1735689600000].auxiliary_volume == D("7.5")


def test_funding_parser_requires_actual_interval() -> None:
    raw = (
        b"calc_time,funding_interval_hours,last_funding_rate\n"
        b"1735689600001,8,0.0001\n"
        b"1735718400000,8,-0.0002\n"
    )

    parsed = exp.parse_funding_csv(raw)

    assert parsed == [
        exp.FundingEvent(1735689600001, 8, D("0.0001")),
        exp.FundingEvent(1735718400000, 8, D("-0.0002")),
    ]


def test_funding_coverage_fails_closed() -> None:
    start = 1735689600000
    events = [exp.FundingEvent(start, 8, D("0.0001"))]

    with pytest.raises(exp.EvidenceError, match="incomplete"):
        exp.funding_sum(events, start, start + 168 * exp.HOUR_MS, require_coverage=True)


def test_funding_coverage_rejects_missing_middle_event() -> None:
    start = 1735689600000
    events = [
        exp.FundingEvent(start, 8, D("0.0001")),
        exp.FundingEvent(start + 8 * exp.HOUR_MS, 8, D("0.0001")),
        exp.FundingEvent(start + 24 * exp.HOUR_MS, 8, D("0.0001")),
    ]

    with pytest.raises(exp.EvidenceError, match="missing middle"):
        exp.funding_window(
            events,
            start,
            start + 32 * exp.HOUR_MS,
            require_coverage=True,
        )


def test_funding_interval_transition_fails_closed() -> None:
    start = 1735689600000
    events = [
        exp.FundingEvent(start, 8, D("0.0001")),
        exp.FundingEvent(start + 8 * exp.HOUR_MS, 4, D("0.0001")),
        exp.FundingEvent(start + 12 * exp.HOUR_MS, 4, D("0.0001")),
    ]

    with pytest.raises(exp.EvidenceError, match="transition is unmeasured"):
        exp.funding_window(
            events,
            start,
            start + 16 * exp.HOUR_MS,
            require_coverage=True,
        )


def test_event_time_funding_uses_asynchronous_mark_normalization() -> None:
    entry = datetime(2025, 1, 6, 1, tzinfo=UTC)
    series = _series(entry, prior_usd_rate="0", exit_coin="100")
    event_hours = [
        entry.replace(hour=8),
        entry.replace(hour=16),
        (entry + timedelta(days=1)).replace(hour=0),
    ]
    series.coin_funding = [
        exp.FundingEvent(
            int(event.timestamp() * 1000),
            8,
            D("0.001") if index == 0 else D("0"),
        )
        for index, event in enumerate(event_hours)
    ]
    series.usd_funding = [
        exp.FundingEvent(
            int(event.timestamp() * 1000) + 1,
            8,
            D("0.002") if index == 0 else D("0"),
        )
        for index, event in enumerate(event_hours)
    ]
    for event in event_hours:
        stamp = int(event.timestamp() * 1000)
        series.coin_mark[stamp] = exp.Bar(stamp, D("100"), D("100"), D("0"))
        series.usd_mark[stamp] = exp.Bar(stamp, D("110"), D("110"), D("0"))

    cashflow = exp.hold_funding_cashflow(
        series,
        int(entry.timestamp() * 1000),
        int((entry + timedelta(days=1)).timestamp() * 1000),
        1,
        D("100"),
    )

    assert cashflow == D("1.1")


def test_current_metadata_rejects_base_asset_mismatch() -> None:
    pair = exp.PairSpec("BTC", "BTCUSD_PERP", "BTCUSDT")
    raw = {
        "serverTime": 1,
        "symbols": [
            {
                "symbol": "BTCUSDT",
                "baseAsset": "ETH",
                "quoteAsset": "USDT",
                "marginAsset": "USDT",
                "contractType": "PERPETUAL",
                "status": "TRADING",
                "filters": [],
            }
        ],
    }

    with pytest.raises(exp.EvidenceError, match="base-asset identity"):
        exp.compact_exchange_info(raw, (pair,), "um")


def _series(
    entry: datetime,
    *,
    prior_usd_rate: str,
    exit_coin: str,
) -> exp.PairSeries:
    first_hour = entry - timedelta(days=29)
    last_hour = entry + timedelta(days=8)
    trade_coin: dict[int, exp.Bar] = {}
    mark_coin: dict[int, exp.Bar] = {}
    trade_usd: dict[int, exp.Bar] = {}
    mark_usd: dict[int, exp.Bar] = {}
    cursor = first_hour.replace(minute=0, second=0, microsecond=0)
    exit_ms = int((entry + timedelta(days=7)).timestamp() * 1000)
    while cursor <= last_hour:
        stamp = int(cursor.timestamp() * 1000)
        coin_open = D(exit_coin) if stamp == exit_ms else D("100")
        coin_bar = exp.Bar(stamp, coin_open, coin_open, D("30000"))
        usd_bar = exp.Bar(stamp, D("100"), D("100"), D("3000000"))
        trade_coin[stamp] = coin_bar
        mark_coin[stamp] = exp.Bar(stamp, D("100"), D("100"), D("0"))
        trade_usd[stamp] = usd_bar
        mark_usd[stamp] = exp.Bar(stamp, D("100"), D("100"), D("0"))
        cursor += timedelta(hours=1)
    funding_start = entry - timedelta(days=8)
    funding_end = entry + timedelta(days=8)
    coin_funding: list[exp.FundingEvent] = []
    usd_funding: list[exp.FundingEvent] = []
    cursor = funding_start.replace(hour=0, minute=0, second=0, microsecond=0)
    while cursor <= funding_end:
        stamp = int(cursor.timestamp() * 1000)
        coin_funding.append(exp.FundingEvent(stamp, 8, D("0")))
        usd_funding.append(exp.FundingEvent(stamp, 8, D(prior_usd_rate)))
        cursor += timedelta(hours=8)
    return exp.PairSeries(
        trade_coin,
        mark_coin,
        coin_funding,
        trade_usd,
        mark_usd,
        usd_funding,
    )


def test_cohort_selects_largest_causal_relative_funding_and_charges_costs() -> None:
    entry = datetime(2025, 1, 6, 1, tzinfo=UTC)
    pair_specs = (
        exp.PairSpec("BTC", "BTCUSD_PERP", "BTCUSDT"),
        exp.PairSpec("ETH", "ETHUSD_PERP", "ETHUSDT"),
        exp.PairSpec("BNB", "BNBUSD_PERP", "BNBUSDT"),
    )
    series = {
        "BTC": _series(entry, prior_usd_rate="0.00010", exit_coin="101"),
        "ETH": _series(entry, prior_usd_rate="0.00005", exit_coin="100"),
        "BNB": _series(entry, prior_usd_rate="0.00002", exit_coin="100"),
    }
    trial = exp.TrialSpec("TEST", D("0"), "NONE", 168)

    result = exp.evaluate_cohort(
        pair_specs,
        series,
        int(entry.timestamp() * 1000),
        trial,
    )

    assert result.selected == "BTC"
    assert abs(
        result.gross_usd - result.maker_net_usd - result.fee_maker_usd - result.adverse_maker_usd
    ) < D("1e-44")
    assert abs(
        result.gross_usd - result.stress_net_usd - result.fee_stress_usd - result.adverse_stress_usd
    ) < D("1e-44")
    assert abs(result.gross_usd - result.maker_net_usd - D("1.2")) < D("0.01")
    assert abs(result.gross_usd - result.stress_net_usd - D("6")) < D("0.02")
    assert result.capacity_usd is not None
    assert result.capacity_usd >= D("1000")


def test_selected_missing_exit_fails_without_replacement() -> None:
    entry = datetime(2025, 1, 6, 1, tzinfo=UTC)
    pair_specs = (
        exp.PairSpec("BTC", "BTCUSD_PERP", "BTCUSDT"),
        exp.PairSpec("ETH", "ETHUSD_PERP", "ETHUSDT"),
        exp.PairSpec("BNB", "BNBUSD_PERP", "BNBUSDT"),
    )
    series = {
        "BTC": _series(entry, prior_usd_rate="0.00010", exit_coin="101"),
        "ETH": _series(entry, prior_usd_rate="0.00005", exit_coin="100"),
        "BNB": _series(entry, prior_usd_rate="0.00002", exit_coin="100"),
    }
    del series["BTC"].coin_trade[int((entry + timedelta(days=7)).timestamp() * 1000)]

    with pytest.raises(exp.EvidenceError, match="selected exit bar missing"):
        exp.evaluate_cohort(
            pair_specs,
            series,
            int(entry.timestamp() * 1000),
            exp.TrialSpec("TEST", D("0"), "NONE", 168),
        )


def test_nonselected_future_gap_cannot_change_causal_ranking() -> None:
    entry = datetime(2025, 1, 6, 1, tzinfo=UTC)
    pair_specs = (
        exp.PairSpec("BTC", "BTCUSD_PERP", "BTCUSDT"),
        exp.PairSpec("ETH", "ETHUSD_PERP", "ETHUSDT"),
        exp.PairSpec("BNB", "BNBUSD_PERP", "BNBUSDT"),
    )
    series = {
        "BTC": _series(entry, prior_usd_rate="0.00010", exit_coin="101"),
        "ETH": _series(entry, prior_usd_rate="0.00005", exit_coin="100"),
        "BNB": _series(entry, prior_usd_rate="0.00002", exit_coin="100"),
    }
    del series["BNB"].coin_trade[int((entry + timedelta(days=7)).timestamp() * 1000)]

    result = exp.evaluate_cohort(
        pair_specs,
        series,
        int(entry.timestamp() * 1000),
        exp.TrialSpec("TEST", D("0"), "NONE", 168),
    )

    assert result.selected == "BTC"


def test_no_entry_is_valid_zero_not_missing_evidence() -> None:
    entry = datetime(2025, 1, 6, 1, tzinfo=UTC)
    pair_specs = (
        exp.PairSpec("BTC", "BTCUSD_PERP", "BTCUSDT"),
        exp.PairSpec("ETH", "ETHUSD_PERP", "ETHUSDT"),
        exp.PairSpec("BNB", "BNBUSD_PERP", "BNBUSDT"),
    )
    series = {
        "BTC": _series(entry, prior_usd_rate="0.00010", exit_coin="101"),
        "ETH": _series(entry, prior_usd_rate="0.00005", exit_coin="100"),
        "BNB": _series(entry, prior_usd_rate="0.00002", exit_coin="100"),
    }

    result = exp.evaluate_cohort(
        pair_specs,
        series,
        int(entry.timestamp() * 1000),
        exp.TrialSpec("TEST", D("1"), "NONE", 168),
    )

    assert result.selected is None
    assert result.maker_net_usd == 0
    assert result.capacity_usd is None


def test_bootstrap_is_seeded_and_holm_is_monotone() -> None:
    values = tuple(D(index) / D("10") for index in range(12))
    first = exp.circular_block_bootstrap_means(values, replicates=32, block_length=4, seed=7)
    second = exp.circular_block_bootstrap_means(values, replicates=32, block_length=4, seed=7)

    assert first == second
    adjusted = exp.holm_adjust({"a": D("0.01"), "b": D("0.02"), "c": D("0.5")})
    assert adjusted == {"a": D("0.03"), "b": D("0.04"), "c": D("0.5")}


def test_pbo_is_diagnostic_and_deterministic() -> None:
    matrix = {
        "a": tuple(D("1") if index % 2 == 0 else D("-1") for index in range(16)),
        "b": tuple(D("0.5") for _ in range(16)),
        "c": tuple(D("-0.2") for _ in range(16)),
    }

    first = exp.pbo_cscv(matrix)
    second = exp.pbo_cscv(matrix)

    assert first == second
    assert D(0) <= first <= D(1)


def test_drawdown_uses_cumulative_weekly_proxy_net() -> None:
    assert exp.maximum_drawdown((D("5"), D("-2"), D("-4"), D("3"))) == D("6")


def test_missing_exact_execution_classifies_measurement_unmeasured() -> None:
    assert (
        exp.classify_measurement(
            proxy_gate_pass=True,
            exact_execution_and_risk_measured=False,
        )
        == "UNMEASURED"
    )
    assert (
        exp.classify_measurement(
            proxy_gate_pass=False,
            exact_execution_and_risk_measured=True,
        )
        == "NO_GO"
    )


def test_committed_freeze_refuses_dirty_scope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    freeze.write_bytes(b"{}\n")
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze)

    def fake_git_output(arguments: list[str] | tuple[str, ...]) -> bytes:
        if arguments[:2] == ["log", "-1"]:
            return (b"a" * 40) + b"\n"
        if arguments[0] == "show":
            return b"{}\n"
        if arguments[0] == "rev-list":
            return (b"a" * 40) + b" a169b123fb186d1943a75ad648552c4d95be1be1\n"
        if arguments[0] == "diff-tree":
            return b"quant/research/s1k/freeze.v1.json\n"
        if arguments[0] == "status":
            return b" M quant/research/s1k/experiment.py\n"
        raise AssertionError(arguments)

    monkeypatch.setattr(exp, "git_output", fake_git_output)

    with pytest.raises(exp.EvidenceError, match="scope must be clean"):
        exp.committed_freeze(require_scope_clean=True)


def test_terminal_receipts_authenticate_and_reject_tamper(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze = tmp_path / "freeze.v1.json"
    freeze.write_bytes(b"{}\n")
    monkeypatch.setattr(exp, "FREEZE_PATH", freeze)
    monkeypatch.setattr(
        exp,
        "committed_freeze",
        lambda *, require_scope_clean: "a" * 40,
    )
    discovery = tmp_path / "discovery.v1.json"
    acquisition = tmp_path / "acquisition.v1.json"
    run_marker = tmp_path / "run-marker.v1.json"
    candidate = tmp_path / "candidate-seal.v1.json"
    holdout = tmp_path / "holdout-open.v1.json"
    discovery.write_bytes(b"{}\n")
    acquisition.write_bytes(b"{}\n")
    run_marker_value = {
        "schema": "S1KRunMarkerV1",
        "freezeSha256": exp.sha256_path(freeze),
        "freezeCommit": "a" * 40,
        "acquisitionSha256": exp.sha256_path(acquisition),
        "archiveBodiesOpenedBeforeMarker": False,
        "exclusiveRun": 1,
    }
    run_marker.write_bytes(exp.canonical_bytes(run_marker_value))
    champion = {"trialId": "TEST"}
    candidate_value = {
        "schema": "S1KCandidateSealV1",
        "freezeSha256": exp.sha256_path(freeze),
        "acquisitionSha256": exp.sha256_path(acquisition),
        "runMarkerSha256": exp.sha256_path(run_marker),
        "developmentLedgerSha256": exp.sha256_bytes(exp.canonical_bytes([])),
        "champion": champion,
        "pbo": "0.5",
    }
    candidate.write_bytes(exp.canonical_bytes(candidate_value))
    holdout_value = {
        "schema": "S1KHoldoutOpenV1",
        "freezeSha256": exp.sha256_path(freeze),
        "runMarkerSha256": exp.sha256_path(run_marker),
        "candidateSealSha256": exp.sha256_path(candidate),
        "champion": champion,
        "allowedOpenCount": 1,
        "consumedOpenCount": 1,
        "openedArchiveMonths": ["2025-07", "2026-06"],
    }
    holdout.write_bytes(exp.canonical_bytes(holdout_value))
    result: dict[str, Any] = {
        "schema": "S1KCoinMUsdMRelativeFundingBasisResultV1",
        "state": "TERMINAL_PROXY_MEASURED_EXECUTION_UNMEASURED",
        "measurementVerdict": "UNMEASURED",
        "capitalVerdict": "NO_GO",
        "executionAuthority": "NONE",
        "champion": champion,
        "headline": {"pbo": "0.5"},
        "development": {"trialLedger": []},
        "multiplicity": {"pbo": "0.5"},
        "bindings": {
            "freezeSha256": exp.sha256_path(freeze),
            "discoverySha256": exp.sha256_path(discovery),
            "acquisitionSha256": exp.sha256_path(acquisition),
            "runMarkerSha256": exp.sha256_path(run_marker),
            "candidateSealSha256": exp.sha256_path(candidate),
            "holdoutOpenSha256": exp.sha256_path(holdout),
        },
    }

    exp.validate_terminal_artifacts(tmp_path, result)
    result["development"]["trialLedger"] = [{"trialId": "TAMPER"}]

    with pytest.raises(exp.EvidenceError, match="terminal state"):
        exp.validate_terminal_artifacts(tmp_path, result)

    result["development"]["trialLedger"] = []
    holdout_value["consumedOpenCount"] = 2
    holdout.write_bytes(exp.canonical_bytes(holdout_value))
    result["bindings"]["holdoutOpenSha256"] = exp.sha256_path(holdout)

    with pytest.raises(exp.EvidenceError, match="holdout receipt"):
        exp.validate_terminal_artifacts(tmp_path, result)


def test_exclusive_marker_refuses_second_write(tmp_path: Path) -> None:
    marker = tmp_path / "run-marker.v1.json"
    exp.atomic_write(marker, b"{}\n", exclusive=True)

    with pytest.raises(exp.EvidenceError, match="already exists"):
        exp.atomic_write(marker, b"{}\n", exclusive=True)
