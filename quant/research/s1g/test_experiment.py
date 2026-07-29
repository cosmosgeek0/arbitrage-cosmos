"""Deterministic contract tests for the S-1G public-data Basis experiment."""

from __future__ import annotations

import hashlib
import json
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import cast

import pytest
from research.s1g import experiment
from research.s1g.experiment import (
    CANDIDATES,
    DAY_MS,
    HOUR_MS,
    PAIR_NOTIONAL_USD,
    WEEK_MS,
    ArchiveValidationError,
    Bar,
    BootstrapInterval,
    Candidate,
    CandidateEvaluation,
    CostBreakdown,
    CostScenario,
    CscvPboResult,
    Drawdown,
    FundingEvent,
    HoldoutAlreadyConsumedError,
    MarketData,
    ProtocolValidationError,
    Trade,
    archive_specs,
    classify_verdict,
    consume_holdout_once,
    cscv_pbo,
    cscv_pbo_result,
    evaluate_candidate,
    execute_entry,
    funding_pnl,
    holm_adjusted_pvalues,
    max_drawdown,
    quantize_quantity,
    read_verified_archive,
    reconcile_costs,
    scenario_costs,
    stationary_bootstrap_interval,
    validate_source_manifest,
    validate_trial_ledger,
    verify_frozen_protocol,
    verify_source_plan,
    volume_proxy_capacity,
)

ZERO = Decimal("0")
ONE = Decimal("1")


def _write_archive(
    root: Path,
    *,
    member_name: str,
    body: str,
    extra_members: tuple[tuple[str, str], ...] = (),
) -> tuple[Path, Path]:
    archive_path = root / "fixture.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(member_name, body)
        for name, contents in extra_members:
            archive.writestr(name, contents)
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    checksum_path = root / "fixture.zip.CHECKSUM"
    checksum_path.write_text(f"{digest}  {archive_path.name}\n", encoding="ascii")
    return archive_path, checksum_path


def _bar(
    ts_ms: int,
    *,
    open_price: str,
    high: str | None = None,
    low: str | None = None,
    close: str | None = None,
    quote_volume: str = "1000000",
) -> Bar:
    return Bar(
        ts_ms=ts_ms,
        open=Decimal(open_price),
        high=Decimal(high if high is not None else open_price),
        low=Decimal(low if low is not None else open_price),
        close=Decimal(close if close is not None else open_price),
        quote_volume=Decimal(quote_volume),
    )


def test_verified_archive_accepts_only_exact_checksum_and_single_expected_member(
    tmp_path: Path,
) -> None:
    member = "BTCUSDT-1m-2020-01.csv"
    body = "0,100,101,99,100.5,10,59999,1005,12,5,502.5,0\n"
    archive_path, checksum_path = _write_archive(
        tmp_path,
        member_name=member,
        body=body,
    )

    rows = read_verified_archive(
        archive_path,
        checksum_path,
        expected_member=member,
        schema="KLINE",
    )

    assert len(rows) == 1

    checksum_path.write_text(f"{'0' * 64}  {archive_path.name}\n", encoding="ascii")
    with pytest.raises(ArchiveValidationError, match="checksum"):
        read_verified_archive(
            archive_path,
            checksum_path,
            expected_member=member,
            schema="KLINE",
        )


@pytest.mark.parametrize(
    ("member_name", "extra_members", "error_pattern"),
    [
        ("../escape.csv", (), "member"),
        (
            "BTCUSDT-1m-2020-01.csv",
            (("unexpected.csv", "0,1,2,3,4,5,6,7,8,9,10,11\n"),),
            "single",
        ),
        ("wrong.csv", (), "expected"),
    ],
)
def test_archive_member_contract_fails_closed(
    tmp_path: Path,
    member_name: str,
    extra_members: tuple[tuple[str, str], ...],
    error_pattern: str,
) -> None:
    expected = "BTCUSDT-1m-2020-01.csv"
    archive_path, checksum_path = _write_archive(
        tmp_path,
        member_name=member_name,
        body="0,100,101,99,100,10,59999,1000,12,5,500,0\n",
        extra_members=extra_members,
    )

    with pytest.raises(ArchiveValidationError, match=error_pattern):
        read_verified_archive(
            archive_path,
            checksum_path,
            expected_member=expected,
            schema="KLINE",
        )


def test_kline_and_funding_schemas_reject_drift(tmp_path: Path) -> None:
    malformed_kline, malformed_kline_checksum = _write_archive(
        tmp_path,
        member_name="bad-kline.csv",
        body="0,100,101,99,100,10,59999,1000,12,5,500\n",
    )
    with pytest.raises(ArchiveValidationError, match="schema"):
        read_verified_archive(
            malformed_kline,
            malformed_kline_checksum,
            expected_member="bad-kline.csv",
            schema="KLINE",
        )

    funding_root = tmp_path / "funding"
    funding_root.mkdir()
    funding_archive, funding_checksum = _write_archive(
        funding_root,
        member_name="BTCUSDT-fundingRate-2020-01.csv",
        body=("calc_time,renamed_interval,last_funding_rate\n1577836800000,8,0.00010000\n"),
    )
    with pytest.raises(ArchiveValidationError, match="schema"):
        read_verified_archive(
            funding_archive,
            funding_checksum,
            expected_member="BTCUSDT-fundingRate-2020-01.csv",
            schema="FUNDING",
        )


def test_funding_schema_accepts_the_frozen_official_header(tmp_path: Path) -> None:
    member = "BTCUSDT-fundingRate-2020-01.csv"
    archive_path, checksum_path = _write_archive(
        tmp_path,
        member_name=member,
        body=("calc_time,funding_interval_hours,last_funding_rate\n1577836800000,8,0.00010000\n"),
    )

    rows = read_verified_archive(
        archive_path,
        checksum_path,
        expected_member=member,
        schema="FUNDING",
    )

    assert len(rows) == 2


def test_entry_is_causal_and_all_maker_attempts_nonfill_before_paired_fallback() -> None:
    signal_ts = 960_000
    # A same-timestamp range that crosses any plausible maker limit must not be
    # observed by a causal decision and cannot establish queue priority.
    spot_bars = (
        _bar(signal_ts, open_price="100", high="1000", low="1"),
        _bar(signal_ts + 60_000, open_price="101"),
    )
    perp_bars = (
        _bar(signal_ts, open_price="102", high="1000", low="1"),
        _bar(signal_ts + 60_000, open_price="103"),
    )

    execution = execute_entry(
        signal_ts_ms=signal_ts,
        spot_bars=spot_bars,
        perp_bars=perp_bars,
        quantity=Decimal("1"),
        maker_timeout_ms=60_000,
    )

    assert execution.maker_attempts == 2
    assert execution.maker_fills == 0
    assert execution.fallback_used is True
    assert execution.spot_fill.liquidity == "TAKER"
    assert execution.perp_fill.liquidity == "TAKER"
    assert execution.spot_fill.ts_ms == signal_ts + 60_000
    assert execution.perp_fill.ts_ms == signal_ts + 60_000
    assert execution.spot_fill.reference_price == Decimal("101")
    assert execution.perp_fill.reference_price == Decimal("103")


def test_entry_refuses_same_bar_or_unpaired_fallback() -> None:
    signal_ts = 1_980_000
    same_bar_only = (_bar(signal_ts, open_price="100"),)
    with pytest.raises(ValueError, match="fallback"):
        execute_entry(
            signal_ts_ms=signal_ts,
            spot_bars=same_bar_only,
            perp_bars=same_bar_only,
            quantity=Decimal("1"),
            maker_timeout_ms=60_000,
        )

    with pytest.raises(ValueError, match="paired"):
        execute_entry(
            signal_ts_ms=signal_ts,
            spot_bars=(
                _bar(signal_ts, open_price="100"),
                _bar(signal_ts + 60_000, open_price="101"),
            ),
            perp_bars=same_bar_only,
            quantity=Decimal("1"),
            maker_timeout_ms=60_000,
        )


def test_short_perpetual_funding_sign_and_open_interval_boundaries() -> None:
    events = (
        FundingEvent(ts_ms=100, rate=Decimal("0.01"), mark_price=Decimal("100")),
        FundingEvent(ts_ms=200, rate=Decimal("0.02"), mark_price=Decimal("100")),
        FundingEvent(ts_ms=300, rate=Decimal("-0.01"), mark_price=Decimal("120")),
        FundingEvent(ts_ms=400, rate=Decimal("0.50"), mark_price=Decimal("100")),
    )

    observed = funding_pnl(
        events,
        entry_ts_ms=100,
        exit_ts_ms=400,
        short_quantity=Decimal("2"),
    )

    # Entry and exit timestamps are deliberately excluded. A short receives
    # positive funding and pays negative funding: 2*100*.02 + 2*120*(-.01).
    assert observed == Decimal("1.6")


def test_cost_decomposition_reconciles_exactly_without_hidden_netting() -> None:
    costs = reconcile_costs(
        gross_basis_usd=Decimal("12.50"),
        funding_usd=Decimal("4.25"),
        spot_fees_usd=Decimal("1.25"),
        futures_fees_usd=Decimal("0.75"),
        spread_usd=Decimal("0.50"),
        slippage_usd=Decimal("0.25"),
        rounding_usd=Decimal("0.10"),
    )

    assert costs.gross_basis_usd == Decimal("12.50")
    assert costs.funding_usd == Decimal("4.25")
    assert costs.spot_fees_usd == Decimal("1.25")
    assert costs.futures_fees_usd == Decimal("0.75")
    assert costs.spread_usd == Decimal("0.50")
    assert costs.slippage_usd == Decimal("0.25")
    assert costs.rounding_usd == Decimal("0.10")
    assert costs.net_usd == Decimal("13.90")
    assert costs.net_usd == (
        costs.gross_basis_usd
        + costs.funding_usd
        - costs.spot_fees_usd
        - costs.futures_fees_usd
        - costs.spread_usd
        - costs.slippage_usd
        - costs.rounding_usd
    )


def test_stress_costs_are_monotone_and_keep_components_separate() -> None:
    base = CostScenario(
        spot_taker_fee_bps=Decimal("10"),
        futures_taker_fee_bps=Decimal("5"),
        spread_bps_per_fill=Decimal("1"),
        slippage_bps_per_fill=Decimal("1"),
    )
    stress = CostScenario(
        spot_taker_fee_bps=Decimal("10"),
        futures_taker_fee_bps=Decimal("10"),
        spread_bps_per_fill=Decimal("5"),
        slippage_bps_per_fill=Decimal("5"),
    )

    base_costs = scenario_costs(pair_notional_usd=Decimal("500"), scenario=base)
    stress_costs = scenario_costs(pair_notional_usd=Decimal("500"), scenario=stress)

    assert base_costs.spot_fees_usd == Decimal("1")
    assert base_costs.futures_fees_usd == Decimal("0.5")
    assert base_costs.spread_usd == Decimal("0.2")
    assert base_costs.slippage_usd == Decimal("0.2")
    assert base_costs.net_usd == Decimal("-1.9")
    assert stress_costs.net_usd < base_costs.net_usd
    assert stress_costs.spot_fees_usd >= base_costs.spot_fees_usd
    assert stress_costs.futures_fees_usd >= base_costs.futures_fees_usd
    assert stress_costs.spread_usd >= base_costs.spread_usd
    assert stress_costs.slippage_usd >= base_costs.slippage_usd


def test_quantity_rounds_down_and_capacity_uses_weakest_causal_leg() -> None:
    quantity = quantize_quantity(
        target_notional_usd=Decimal("400"),
        reference_price=Decimal("30000"),
        quantity_step=Decimal("0.001"),
    )
    assert quantity == Decimal("0.013")
    assert quantity * Decimal("30000") == Decimal("390")

    capacity = volume_proxy_capacity(
        spot_previous_day_quote_usd=Decimal("30000000"),
        spot_trailing7_median_quote_usd=Decimal("25000000"),
        futures_previous_day_quote_usd=Decimal("22000000"),
        futures_trailing7_median_quote_usd=Decimal("20000000"),
        participation_bps=Decimal("0.5"),
    )
    assert capacity == Decimal("1000")

    with pytest.raises(ValueError, match="positive"):
        quantize_quantity(
            target_notional_usd=Decimal("400"),
            reference_price=ZERO,
            quantity_step=Decimal("0.001"),
        )


def test_frozen_candidate_ledger_identity_and_capital_are_exact() -> None:
    assert Decimal("400") == PAIR_NOTIONAL_USD
    assert tuple(candidate.candidate_id for candidate in CANDIDATES) == (
        "s1g-l06-h01-b000",
        "s1g-l06-h01-b005",
        "s1g-l06-h03-b000",
        "s1g-l06-h03-b005",
        "s1g-l06-h07-b000",
        "s1g-l06-h07-b005",
        "s1g-l18-h01-b000",
        "s1g-l18-h01-b005",
        "s1g-l18-h03-b000",
        "s1g-l18-h03-b005",
        "s1g-l18-h07-b000",
        "s1g-l18-h07-b005",
    )


def test_drawdown_uses_the_full_event_path_not_endpoints() -> None:
    drawdown = max_drawdown(
        (
            Decimal("1000"),
            Decimal("1200"),
            Decimal("900"),
            Decimal("1200"),
        )
    )

    assert drawdown.max_drawdown_usd == Decimal("300")
    assert drawdown.max_drawdown_bps == Decimal("2500")


def test_holm_adjustment_is_exact_and_order_invariant() -> None:
    first = holm_adjusted_pvalues(
        {
            "a": Decimal("0.001"),
            "b": Decimal("0.02"),
            "c": Decimal("0.03"),
            "d": Decimal("0.9"),
        }
    )
    second = holm_adjusted_pvalues(
        {
            "d": Decimal("0.9"),
            "c": Decimal("0.03"),
            "b": Decimal("0.02"),
            "a": Decimal("0.001"),
        }
    )

    assert first == second
    assert first == {
        "a": Decimal("0.004"),
        "b": Decimal("0.06"),
        "c": Decimal("0.06"),
        "d": Decimal("0.9"),
    }


def test_pbo_and_bootstrap_are_deterministic_under_frozen_inputs() -> None:
    persistent_leader = (
        tuple(Decimal("9") for _ in range(12)),
        tuple(Decimal("1") for _ in range(12)),
        tuple(Decimal("2") if index % 2 == 0 else Decimal("1") for index in range(12)),
    )
    assert cscv_pbo(persistent_leader) == ZERO
    assert cscv_pbo(persistent_leader) == cscv_pbo(persistent_leader)

    values = tuple(Decimal("2") for _ in range(8))
    first = stationary_bootstrap_interval(
        values,
        replicates=999,
        expected_block_length=4,
        seed=7,
        alpha=Decimal("0.05"),
    )
    second = stationary_bootstrap_interval(
        values,
        replicates=999,
        expected_block_length=4,
        seed=7,
        alpha=Decimal("0.05"),
    )

    assert first == second
    assert first.lower == Decimal("16")
    assert first.point == Decimal("16")
    assert first.upper == Decimal("16")


def test_cscv_pbo_preserves_exact_numerator_and_denominator() -> None:
    persistent_leader = (
        tuple(Decimal("9") for _ in range(12)),
        tuple(Decimal("1") for _ in range(12)),
        tuple(Decimal("2") if index % 2 == 0 else Decimal("1") for index in range(12)),
    )

    result = cscv_pbo_result(persistent_leader)

    assert result.underperform_count == 0
    assert result.split_count == 924
    assert result.value == ZERO


def test_walk_forward_early_exact_ties_are_total_and_causal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scores = {candidate.candidate_id: tuple(ZERO for _ in range(52)) for candidate in CANDIDATES}

    def unavailable_bootstrap(*_args: object, **_kwargs: object) -> BootstrapInterval:
        raise AssertionError("bootstrap must not be called before four prior weeks")

    monkeypatch.setattr(experiment, "stationary_bootstrap_interval", unavailable_bootstrap)
    for prior_weeks in (1, 2, 3):
        ranked = experiment._walk_forward_rank(scores, prior_weeks=prior_weeks)
        assert ranked == tuple(candidate.candidate_id for candidate in CANDIDATES)

    calls: list[tuple[Decimal, ...]] = []

    def available_bootstrap(
        values: tuple[Decimal, ...],
        **_kwargs: object,
    ) -> BootstrapInterval:
        calls.append(values)
        return BootstrapInterval(ZERO, ZERO, ZERO, 9999, Decimal("0.05"))

    monkeypatch.setattr(experiment, "stationary_bootstrap_interval", available_bootstrap)
    ranked = experiment._walk_forward_rank(scores, prior_weeks=4)
    assert ranked == tuple(candidate.candidate_id for candidate in CANDIDATES)
    assert len(calls) == 12
    assert all(len(values) == 4 for values in calls)

    causal_scores = dict(scores)
    causal_scores[CANDIDATES[0].candidate_id] = (
        Decimal("10"),
        ZERO,
        *(ZERO for _ in range(50)),
    )
    causal_scores[CANDIDATES[1].candidate_id] = (
        Decimal("9"),
        Decimal("1000"),
        *(ZERO for _ in range(50)),
    )
    assert (
        experiment._walk_forward_rank(causal_scores, prior_weeks=1)[0] == CANDIDATES[0].candidate_id
    )
    assert (
        experiment._walk_forward_rank(causal_scores, prior_weeks=2)[0] == CANDIDATES[1].candidate_id
    )


def test_walk_forward_carries_equity_peak_cooldown_and_terminal_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[int, Decimal, Decimal | None, int | None, bool]] = []
    monkeypatch.setattr(
        experiment,
        "_walk_forward_rank",
        lambda *_args, **_kwargs: tuple(candidate.candidate_id for candidate in CANDIDATES),
    )

    def fake_evaluate(
        candidate: Candidate,
        _data: MarketData,
        *,
        start_ms: int,
        initial_realized_usd: Decimal,
        initial_running_peak_usd: Decimal | None,
        initial_cooldown_until_ms: int | None,
        initial_terminal_stop: bool,
        **_kwargs: object,
    ) -> CandidateEvaluation:
        calls.append(
            (
                start_ms,
                initial_realized_usd,
                initial_running_peak_usd,
                initial_cooldown_until_ms,
                initial_terminal_stop,
            )
        )
        week = (start_ms - experiment.DEVELOPMENT_START_MS) // WEEK_MS
        score = Decimal("1") if week == 0 else Decimal("-101") if week == 1 else ZERO
        ending_equity = Decimal("1000") + initial_realized_usd + score
        ending_peak = max(cast(Decimal, initial_running_peak_usd), Decimal("1002"))
        terminal = initial_terminal_stop or week == 1
        cooldown = (
            start_ms + WEEK_MS + DAY_MS if week == 0 else cast(int, initial_cooldown_until_ms)
        )
        return CandidateEvaluation(
            candidate=candidate,
            weekly_primary_usd=(score,),
            weekly_stress_usd=(score,),
            weekly_severe_usd=(score,),
            trades=(),
            drawdown=Drawdown(
                ending_peak - ending_equity,
                ZERO,
                ending_peak,
                ending_equity,
            ),
            stress_drawdown=Drawdown(ZERO, ZERO, Decimal("1000"), Decimal("1000")),
            active_week_count=0,
            paired_maker_attempt_count=0,
            ending_primary_equity_usd=ending_equity,
            ending_running_peak_usd=ending_peak,
            ending_cooldown_until_ms=cooldown,
            terminal_stop=terminal,
            minimum_capacity_usd=ZERO,
            minimum_stress_capacity_usd=ZERO,
        )

    monkeypatch.setattr(experiment, "evaluate_candidate", fake_evaluate)
    _, selected_ids, selected_values, maximum_drawdown = experiment._walk_forward_diagnostic(
        MarketData((), (), (), ())
    )

    assert len(selected_ids) == 52
    assert selected_values[:3] == (Decimal("1"), Decimal("-101"), ZERO)
    week_one_first_call = calls[12]
    assert week_one_first_call[1] == Decimal("1")
    assert week_one_first_call[2] == Decimal("1002")
    assert week_one_first_call[3] == experiment.DEVELOPMENT_START_MS + WEEK_MS + DAY_MS
    week_two_first_call = calls[24]
    assert week_two_first_call[1] == Decimal("-100")
    assert week_two_first_call[4] is True
    assert maximum_drawdown == Decimal("102")


def test_expired_cooldown_from_inactive_week_is_safely_clamped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + WEEK_MS
    bars = tuple(
        _bar(timestamp, open_price="100", quote_volume="2000000")
        for timestamp in range(0, end_ms, HOUR_MS)
    )

    observed = evaluate_candidate(
        Candidate(6, 1, ZERO),
        MarketData(bars, bars, bars, ()),
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=1,
        initial_cooldown_until_ms=0,
    )

    assert observed.trades == ()
    assert observed.ending_cooldown_until_ms == start_ms


@pytest.mark.parametrize(
    ("actual_fee_state", "maker_entry_state"),
    [
        ("UNKNOWN", "PASS"),
        ("PASS", "UNKNOWN"),
        ("UNKNOWN", "UNKNOWN"),
    ],
)
def test_unknown_actual_fee_or_maker_truth_can_never_be_go(
    actual_fee_state: str,
    maker_entry_state: str,
) -> None:
    verdict = classify_verdict(
        economic_pass=True,
        actual_fee_state=actual_fee_state,
        maker_entry_state=maker_entry_state,
        evidence_class="HISTORICAL_VALIDATION",
        holdout_state="PASS",
    )

    assert verdict == "UNMEASURED"


def test_measured_economic_failure_is_no_go() -> None:
    assert (
        classify_verdict(
            economic_pass=False,
            actual_fee_state="UNKNOWN",
            maker_entry_state="UNKNOWN",
            evidence_class="HISTORICAL_VALIDATION",
            holdout_state="PASS",
        )
        == "NO_GO"
    )


def test_public_module_cannot_upgrade_even_from_synthetic_pass_strings() -> None:
    assert (
        classify_verdict(
            economic_pass=True,
            actual_fee_state="PASS",
            maker_entry_state="PASS",
            evidence_class="SEALED_FORWARD",
            holdout_state="PASS",
        )
        == "UNMEASURED"
    )


def test_four_week_holdout_interval_is_descriptive_without_decision_authority(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    costs = CostBreakdown(
        gross_basis_usd=Decimal("2"),
        funding_usd=ZERO,
        spot_fees_usd=ZERO,
        futures_fees_usd=ZERO,
        spread_usd=ZERO,
        slippage_usd=ZERO,
        rounding_usd=ZERO,
        latency_usd=ZERO,
        net_usd=Decimal("2"),
    )
    trades = tuple(
        Trade(
            candidate_id=CANDIDATES[0].candidate_id,
            entry_ts_ms=index * 2,
            exit_ts_ms=index * 2 + 1,
            exit_reason="SYNTHETIC",
            quantity=ONE,
            capacity_usd=Decimal("2000"),
            stress_capacity_usd=Decimal("1500"),
            primary=costs,
            stress=costs,
            severe=costs,
        )
        for index in range(6)
    )
    evaluation = CandidateEvaluation(
        candidate=CANDIDATES[0],
        weekly_primary_usd=(ONE, ONE, ONE, ONE),
        weekly_stress_usd=(ONE, ONE, ONE, ONE),
        weekly_severe_usd=(ONE, ONE, ONE, ONE),
        trades=trades,
        drawdown=Drawdown(ZERO, ZERO, Decimal("1000"), Decimal("1000")),
        stress_drawdown=Drawdown(ZERO, ZERO, Decimal("1000"), Decimal("1000")),
        active_week_count=4,
        paired_maker_attempt_count=6,
        ending_primary_equity_usd=Decimal("1004"),
        ending_running_peak_usd=Decimal("1004"),
        ending_cooldown_until_ms=0,
        terminal_stop=False,
        minimum_capacity_usd=Decimal("2000"),
        minimum_stress_capacity_usd=Decimal("1500"),
    )
    monkeypatch.setattr(experiment, "evaluate_candidate", lambda *_args, **_kwargs: evaluation)
    development_result = tmp_path / "development-result.json"
    development_result.write_text(
        json.dumps(
            {
                "candidateDigest": "a" * 64,
                "selectedCandidateId": CANDIDATES[0].candidate_id,
            }
        ),
        encoding="utf-8",
    )
    holdout_root = tmp_path / "holdout"
    marker = tmp_path / "holdout.consumed.json"
    marker.write_text(
        json.dumps(
            {
                "candidateDigest": "a" * 64,
                "candidateId": CANDIDATES[0].candidate_id,
                "developmentMarkerSha256": "b" * 64,
                "developmentSourceManifestSha256": "c" * 64,
                "freezeSha256": "d" * 64,
                "holdoutRoot": str(holdout_root.resolve()),
                "protocolSha256": "e" * 64,
                "sourcePlanSha256": "f" * 64,
                "trialLedgerSha256": "1" * 64,
            }
        ),
        encoding="utf-8",
    )
    evaluation_marker = tmp_path / "holdout.evaluation.consumed.json"
    evaluation_marker.write_text("{}", encoding="utf-8")

    result = experiment.run_holdout(
        MarketData((), (), (), ()),
        development_result_path=development_result,
        marker_path=marker,
        evaluation_marker_path=evaluation_marker,
        holdout_source_manifest_digest="2" * 64,
        holdout_root=holdout_root,
    )

    assert result["economicPass"] is False
    assert result["proxyEconomicPass"] is True
    assert result["holdoutState"] == "UNMEASURED"
    assert result["localVerdict"] == "UNMEASURED"
    assert result["verifiedPositiveCount"] is None
    assert result["crediblePositiveCount"] is None
    assert result["proxyPositiveCount"] == 1
    uncertainty = cast(dict[str, object], result["uncertainty"])
    assert uncertainty["approximateEffectiveBlocks"] == "1"
    assert uncertainty["nominalIntervalUse"] == "DESCRIPTIVE_ONLY"
    assert uncertainty["state"] == "UNMEASURED_INSUFFICIENT_EFFECTIVE_BLOCKS"

    scarce = CandidateEvaluation(
        candidate=evaluation.candidate,
        weekly_primary_usd=evaluation.weekly_primary_usd,
        weekly_stress_usd=evaluation.weekly_stress_usd,
        weekly_severe_usd=evaluation.weekly_severe_usd,
        trades=evaluation.trades[:5],
        drawdown=evaluation.drawdown,
        stress_drawdown=evaluation.stress_drawdown,
        active_week_count=evaluation.active_week_count,
        paired_maker_attempt_count=evaluation.paired_maker_attempt_count,
        ending_primary_equity_usd=evaluation.ending_primary_equity_usd,
        ending_running_peak_usd=evaluation.ending_running_peak_usd,
        ending_cooldown_until_ms=evaluation.ending_cooldown_until_ms,
        terminal_stop=evaluation.terminal_stop,
        minimum_capacity_usd=evaluation.minimum_capacity_usd,
        minimum_stress_capacity_usd=evaluation.minimum_stress_capacity_usd,
    )
    monkeypatch.setattr(experiment, "evaluate_candidate", lambda *_args, **_kwargs: scarce)
    scarce_result = experiment.run_holdout(
        MarketData((), (), (), ()),
        development_result_path=development_result,
        marker_path=marker,
        evaluation_marker_path=evaluation_marker,
        holdout_source_manifest_digest="2" * 64,
        holdout_root=holdout_root,
    )
    assert cast(dict[str, bool], scarce_result["gates"])["sample"] is False
    assert scarce_result["proxyEconomicPass"] is False
    assert scarce_result["holdoutState"] == "FAIL"
    assert scarce_result["localVerdict"] == "NO_GO"
    assert scarce_result["proxyPositiveCount"] == 0


def test_terminal_packets_share_public_unknown_truth() -> None:
    result = experiment._terminal_unmeasured_result(
        stage="SYNTHETIC",
        failure_class="SYNTHETIC_FAILURE",
        provenance={},
    )

    assert result["accountEffectiveFeeState"] == "UNKNOWN"
    assert result["historicalDepthState"] == "UNKNOWN"
    assert result["historicalFilterContinuity"] == "UNKNOWN"
    assert result["liquidationState"] == "UNKNOWN"
    assert result["n3EquivalentDecisionState"] == "UNKNOWN"
    assert result["positiveEdgeClaim"] == "NOT_MADE"
    assert result["verifiedPositiveCount"] is None
    assert result["crediblePositiveCount"] is None
    assert result["proxyPositiveCount"] is None
    assert result["observedProxyPositive"] is None


def test_holdout_marker_is_create_once_and_preserves_original_bytes(tmp_path: Path) -> None:
    marker = tmp_path / "holdout.consumed.json"
    first_payload = {"candidateDigest": "a" * 64, "holdoutRoot": "/fixed/root"}
    second_payload = {"candidateDigest": "b" * 64, "holdoutRoot": "/other/root"}

    consume_holdout_once(marker, first_payload)
    original = marker.read_bytes()
    with pytest.raises(HoldoutAlreadyConsumedError):
        consume_holdout_once(marker, second_payload)

    assert marker.read_bytes() == original
    assert json.loads(original) == first_payload


def test_holdout_marker_allows_exactly_one_concurrent_consumer(tmp_path: Path) -> None:
    marker = tmp_path / "holdout.consumed.json"
    barrier = threading.Barrier(9)
    payloads = tuple(
        {"candidateDigest": f"{index:064x}", "holdoutRoot": "/fixed/root"} for index in range(8)
    )

    def attempt(payload: dict[str, str]) -> str:
        barrier.wait()
        try:
            consume_holdout_once(marker, payload)
        except HoldoutAlreadyConsumedError:
            return "already-consumed"
        return "created"

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = tuple(executor.submit(attempt, payload) for payload in payloads)
        barrier.wait()
        outcomes = tuple(future.result(timeout=5) for future in futures)

    assert outcomes.count("created") == 1
    assert outcomes.count("already-consumed") == 7
    assert json.loads(marker.read_bytes()) in payloads


def _cli_base_args(
    *,
    command: str,
    here: Path,
    raw_root: Path,
    output: Path,
) -> list[str]:
    return [
        command,
        "--protocol",
        str(here / "protocol.v1.json"),
        "--freeze",
        str(here / "protocol.freeze.v1.json"),
        "--source-plan",
        str(here / "source_plan.v1.json"),
        "--trial-ledger",
        str(here / "trial_ledger.v1.json"),
        "--raw-root",
        str(raw_root),
        "--output",
        str(output),
    ]


def test_broken_symlink_counts_as_preexisting_holdout_custody(tmp_path: Path) -> None:
    root = tmp_path / "holdout"
    authorization = tmp_path / "holdout.consumed.json"
    evaluation = tmp_path / "holdout.evaluation.consumed.json"
    manifest = tmp_path / "holdout-source-manifest.v1.json"
    authorization.symlink_to(tmp_path / "missing-target")

    conflicts = experiment._holdout_custody_conflicts(
        holdout_root=root,
        authorization_marker=authorization,
        evaluation_marker=evaluation,
        holdout_manifest=manifest,
    )

    assert conflicts == ("HOLDOUT_AUTHORIZATION_MARKER",)


def test_development_refuses_preopened_holdout_before_any_acquisition(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    here = tmp_path / "research"
    here.mkdir()
    raw_root = tmp_path / "raw"
    (raw_root / "holdout").mkdir(parents=True)
    monkeypatch.setattr(experiment, "HERE", here)
    monkeypatch.setattr(experiment, "FIXED_RAW_ROOT", raw_root)
    monkeypatch.setattr(
        experiment,
        "_preflight",
        lambda _args: ("a" * 64, "b" * 64, "c" * 64, "d" * 64),
    )

    def forbidden_acquisition(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("development acquisition must not start")

    monkeypatch.setattr(experiment, "acquire_partition", forbidden_acquisition)
    output = here / "development-source-manifest.v1.json"
    status = experiment.main(
        _cli_base_args(
            command="acquire-development",
            here=here,
            raw_root=raw_root,
            output=output,
        )
    )

    assert status == 2
    assert not output.exists()
    result = json.loads((here / "result.v1.json").read_text(encoding="utf-8"))
    assert result["stage"] == "PREDEVELOPMENT_HOLDOUT_CUSTODY"
    assert result["localVerdict"] == "UNMEASURED"
    provenance = cast(dict[str, object], result["provenance"])
    assert provenance["protocolSha256"] == "a" * 64
    assert provenance["sourcePlanSha256"] == "b" * 64
    assert provenance["trialLedgerSha256"] == "c" * 64
    assert provenance["freezeSha256"] == "d" * 64


@pytest.mark.parametrize(
    ("artifact", "broken_symlink"),
    [
        ("HOLDOUT_ROOT", False),
        ("HOLDOUT_ROOT", True),
        ("HOLDOUT_AUTHORIZATION_MARKER", False),
        ("HOLDOUT_AUTHORIZATION_MARKER", True),
        ("HOLDOUT_EVALUATION_MARKER", False),
        ("HOLDOUT_EVALUATION_MARKER", True),
        ("HOLDOUT_SOURCE_MANIFEST", False),
        ("HOLDOUT_SOURCE_MANIFEST", True),
    ],
)
def test_preexisting_holdout_acquisition_publishes_terminal_receipt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    artifact: str,
    broken_symlink: bool,
) -> None:
    here = tmp_path / "research"
    here.mkdir()
    raw_root = tmp_path / "raw"
    raw_root.mkdir()
    paths = {
        "HOLDOUT_ROOT": raw_root / "holdout",
        "HOLDOUT_AUTHORIZATION_MARKER": raw_root / "holdout.consumed.json",
        "HOLDOUT_EVALUATION_MARKER": raw_root / "holdout.evaluation.consumed.json",
        "HOLDOUT_SOURCE_MANIFEST": here / "holdout-source-manifest.v1.json",
    }
    preexisting_path = paths[artifact]
    if broken_symlink:
        preexisting_path.symlink_to(tmp_path / "missing-target")
    elif artifact == "HOLDOUT_ROOT":
        preexisting_path.mkdir()
    else:
        preexisting_path.write_text("preexisting", encoding="utf-8")
    development_result = here / "development-result.v1.json"
    development_result.write_text(
        json.dumps(
            {
                "candidateDigest": "1" * 64,
                "selectedCandidateId": CANDIDATES[0].candidate_id,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(experiment, "HERE", here)
    monkeypatch.setattr(experiment, "FIXED_RAW_ROOT", raw_root)
    monkeypatch.setattr(
        experiment,
        "_preflight",
        lambda _args: ("a" * 64, "b" * 64, "c" * 64, "d" * 64),
    )
    monkeypatch.setattr(experiment, "validate_source_manifest", lambda *_args, **_kwargs: "e" * 64)

    def forbidden_acquisition(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("holdout acquisition must not start")

    monkeypatch.setattr(experiment, "acquire_partition", forbidden_acquisition)
    args = _cli_base_args(
        command="acquire-holdout",
        here=here,
        raw_root=raw_root,
        output=here / "holdout-source-manifest.v1.json",
    )
    args.extend(
        [
            "--development-result",
            str(here / "development-result.v1.json"),
            "--development-source-manifest",
            str(here / "development-source-manifest.v1.json"),
            "--marker",
            str(raw_root / "holdout.consumed.json"),
        ]
    )

    assert experiment.main(args) == 2
    result = json.loads((here / "result.v1.json").read_text(encoding="utf-8"))
    assert result["stage"] == "HOLDOUT_ACQUISITION_PREEXISTING_CUSTODY"
    assert result["failureClass"] == "PREEXISTING_HOLDOUT_CUSTODY"
    provenance = cast(dict[str, object], result["provenance"])
    assert provenance["preexistingHoldoutArtifacts"] == [artifact]
    assert preexisting_path.is_symlink() if broken_symlink else preexisting_path.exists()


def test_development_oserror_after_marker_creates_terminal_receipt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    here = tmp_path / "research"
    here.mkdir()
    raw_root = tmp_path / "raw"
    monkeypatch.setattr(experiment, "HERE", here)
    monkeypatch.setattr(experiment, "FIXED_RAW_ROOT", raw_root)
    monkeypatch.setattr(
        experiment,
        "_preflight",
        lambda _args: ("a" * 64, "b" * 64, "c" * 64, "d" * 64),
    )
    monkeypatch.setattr(experiment, "validate_source_manifest", lambda *_args, **_kwargs: "e" * 64)
    monkeypatch.setattr(
        experiment,
        "load_partition",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("synthetic")),
    )
    output = here / "development-result.v1.json"
    args = _cli_base_args(
        command="run-development",
        here=here,
        raw_root=raw_root,
        output=output,
    )
    args.extend(
        [
            "--source-manifest",
            str(here / "development-source-manifest.v1.json"),
            "--marker",
            str(raw_root / "development.consumed.json"),
        ]
    )

    assert experiment.main(args) == 2
    assert (raw_root / "development.consumed.json").is_file()
    development = json.loads(output.read_text(encoding="utf-8"))
    terminal = json.loads((here / "result.v1.json").read_text(encoding="utf-8"))
    assert development["developmentGate"] == "UNMEASURED"
    assert terminal["stage"] == "DEVELOPMENT_AFTER_CONSUMPTION"
    assert terminal["failureClass"] == "OSError"
    assert terminal["verifiedPositiveCount"] is None


def test_holdout_acquisition_oserror_after_marker_creates_terminal_receipt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    here = tmp_path / "research"
    here.mkdir()
    raw_root = tmp_path / "raw"
    monkeypatch.setattr(experiment, "HERE", here)
    monkeypatch.setattr(experiment, "FIXED_RAW_ROOT", raw_root)
    monkeypatch.setattr(
        experiment,
        "_preflight",
        lambda _args: ("a" * 64, "b" * 64, "c" * 64, "d" * 64),
    )
    monkeypatch.setattr(experiment, "validate_source_manifest", lambda *_args, **_kwargs: "e" * 64)
    authorization = {
        "candidateDigest": "1" * 64,
        "candidateId": CANDIDATES[0].candidate_id,
        "developmentMarkerSha256": "2" * 64,
        "developmentResultSha256": "3" * 64,
        "developmentSourceManifestSha256": "e" * 64,
    }
    monkeypatch.setattr(
        experiment,
        "_authorization_payload",
        lambda **_kwargs: authorization,
    )
    monkeypatch.setattr(
        experiment,
        "acquire_partition",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("synthetic")),
    )
    args = _cli_base_args(
        command="acquire-holdout",
        here=here,
        raw_root=raw_root,
        output=here / "holdout-source-manifest.v1.json",
    )
    args.extend(
        [
            "--development-result",
            str(here / "development-result.v1.json"),
            "--development-source-manifest",
            str(here / "development-source-manifest.v1.json"),
            "--marker",
            str(raw_root / "holdout.consumed.json"),
        ]
    )

    assert experiment.main(args) == 2
    assert (raw_root / "holdout.consumed.json").is_file()
    terminal = json.loads((here / "result.v1.json").read_text(encoding="utf-8"))
    assert terminal["stage"] == "HOLDOUT_ACQUISITION_AFTER_CONSUMPTION"
    assert terminal["failureClass"] == "OSError"
    assert terminal["verifiedPositiveCount"] is None


def test_holdout_evaluation_oserror_preserves_marker_and_terminal_provenance(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    here = tmp_path / "research"
    here.mkdir()
    raw_root = tmp_path / "raw"
    raw_root.mkdir()
    monkeypatch.setattr(experiment, "HERE", here)
    monkeypatch.setattr(experiment, "FIXED_RAW_ROOT", raw_root)
    monkeypatch.setattr(
        experiment,
        "_preflight",
        lambda _args: ("a" * 64, "b" * 64, "c" * 64, "d" * 64),
    )
    monkeypatch.setattr(experiment, "validate_source_manifest", lambda *_args, **_kwargs: "e" * 64)
    authorization = {
        "candidateDigest": "1" * 64,
        "candidateId": CANDIDATES[0].candidate_id,
        "developmentMarkerSha256": "2" * 64,
        "developmentResultSha256": "3" * 64,
        "developmentSourceManifestSha256": "e" * 64,
        "experimentPySha256": "4" * 64,
        "freezeSha256": "d" * 64,
        "holdoutRoot": str(raw_root / "holdout"),
        "protocolSha256": "a" * 64,
        "sourcePlanSha256": "b" * 64,
        "trialLedgerSha256": "c" * 64,
    }
    monkeypatch.setattr(
        experiment,
        "_authorization_payload",
        lambda **_kwargs: authorization,
    )
    marker = raw_root / "holdout.consumed.json"
    marker.write_bytes(experiment._canonical_json_bytes(authorization))
    (here / "development-result.v1.json").write_text("{}", encoding="utf-8")
    holdout_manifest = here / "holdout-source-manifest.v1.json"
    holdout_manifest.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(
        experiment,
        "load_partition",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("synthetic")),
    )
    evaluation_marker = raw_root / "holdout.evaluation.consumed.json"
    args = _cli_base_args(
        command="run-holdout",
        here=here,
        raw_root=raw_root,
        output=here / "result.v1.json",
    )
    args.extend(
        [
            "--development-result",
            str(here / "development-result.v1.json"),
            "--development-source-manifest",
            str(here / "development-source-manifest.v1.json"),
            "--marker",
            str(marker),
            "--evaluation-marker",
            str(evaluation_marker),
            "--source-manifest",
            str(holdout_manifest),
        ]
    )

    assert experiment.main(args) == 2
    marker_bytes = evaluation_marker.read_bytes()
    terminal = json.loads((here / "result.v1.json").read_text(encoding="utf-8"))
    assert terminal["stage"] == "HOLDOUT_EVALUATION_AFTER_CONSUMPTION"
    assert terminal["failureClass"] == "OSError"
    provenance = cast(dict[str, object], terminal["provenance"])
    assert (
        provenance["authorizationMarkerSha256"] == hashlib.sha256(marker.read_bytes()).hexdigest()
    )
    assert provenance["evaluationMarkerSha256"] == hashlib.sha256(marker_bytes).hexdigest()
    assert provenance["developmentMarkerSha256"] == "2" * 64


def test_source_matrix_and_trial_ledger_are_exact_and_semantically_valid(
    tmp_path: Path,
) -> None:
    assert len(archive_specs("development")) == 48
    assert len(archive_specs("holdout")) == 4
    source_plan_path = experiment.HERE / "source_plan.v1.json"
    assert verify_source_plan(source_plan_path)
    mutated_plan = json.loads(source_plan_path.read_text(encoding="utf-8"))
    mutated_plan["partitions"][0]["months"][0] = "2019-12"
    mutated_plan_path = tmp_path / "source-plan-mutated.json"
    mutated_plan_path.write_text(json.dumps(mutated_plan), encoding="utf-8")
    with pytest.raises(ProtocolValidationError, match="products"):
        verify_source_plan(mutated_plan_path)

    ledger_path = experiment.HERE / "trial_ledger.v1.json"
    assert validate_trial_ledger(ledger_path)
    mutated = json.loads(ledger_path.read_text(encoding="utf-8"))
    mutated["trials"][0]["L"] = 7
    mutated_path = tmp_path / "trial-ledger-mutated.json"
    mutated_path.write_text(json.dumps(mutated), encoding="utf-8")
    with pytest.raises(ProtocolValidationError, match="candidate family"):
        validate_trial_ledger(mutated_path)


def test_funding_month_boundaries_reject_truncation() -> None:
    month_start = datetime(2020, 1, 1, tzinfo=UTC)
    month_end = datetime(2020, 2, 1, tzinfo=UTC)
    rows: list[tuple[str, ...]] = [("calc_time", "funding_interval_hours", "last_funding_rate")]
    timestamp = month_start
    while timestamp < month_end:
        rows.append(
            (
                str(int(timestamp.timestamp() * 1000)),
                "8",
                "0.0001",
            )
        )
        timestamp += timedelta(hours=8)

    experiment._validate_complete_funding_month(tuple(rows), "2020-01")
    with pytest.raises(ArchiveValidationError, match="leading boundary"):
        experiment._validate_complete_funding_month(
            (rows[0], *rows[2:]),
            "2020-01",
        )
    with pytest.raises(ArchiveValidationError, match="trailing boundary"):
        experiment._validate_complete_funding_month(
            tuple(rows[:-1]),
            "2020-01",
        )


def test_cross_month_funding_cadence_is_checked() -> None:
    first = int(datetime(2020, 1, 31, 16, tzinfo=UTC).timestamp() * 1000)
    second = int(datetime(2020, 2, 1, 0, tzinfo=UTC).timestamp() * 1000)
    events = (
        FundingEvent(first, Decimal("0.0001"), Decimal("100")),
        FundingEvent(second, Decimal("0.0001"), Decimal("100")),
    )

    experiment._validate_funding_cadence(events, (Decimal("8"), Decimal("8")))
    with pytest.raises(ArchiveValidationError, match="cadence conflicts"):
        experiment._validate_funding_cadence(events, (Decimal("8"), Decimal("4")))


def test_source_manifest_recomputes_exact_raw_object_set(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    spec = experiment.ArchiveSpec(
        source_id="SPOT_KLINES_1M",
        month="2020-01",
        url=(
            "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2020-01.zip"
        ),
        local_relative_path="development/SPOT_KLINES_1M/fixture.zip",
        expected_member="fixture.csv",
        schema="KLINE",
    )
    monkeypatch.setattr(experiment, "archive_specs", lambda _partition: (spec,))
    archive_root = tmp_path / "development" / "SPOT_KLINES_1M"
    archive_root.mkdir(parents=True)
    archive_path, checksum_path = _write_archive(
        archive_root,
        member_name="fixture.csv",
        body="0,100,100,100,100,1,59999,100,1,1,100,0\n",
    )
    manifest = {
        "archives": [
            {
                "archiveSha256": hashlib.sha256(archive_path.read_bytes()).hexdigest(),
                "checksumSha256": hashlib.sha256(checksum_path.read_bytes()).hexdigest(),
                "expectedMember": "fixture.csv",
                "localRelativePath": spec.local_relative_path,
                "month": "2020-01",
                "schema": "KLINE",
                "sourceId": "SPOT_KLINES_1M",
                "url": spec.url,
            }
        ],
        "decoded": False,
        "partition": "development",
        "schema": "S1GSourceManifestV1",
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    assert validate_source_manifest(
        "development",
        raw_root=tmp_path,
        manifest_path=manifest_path,
    )
    mutations: tuple[tuple[str, str], ...] = (
        ("archiveSha256", "0" * 64),
        ("checksumSha256", "1" * 64),
        ("expectedMember", "other.csv"),
        ("url", f"{spec.url}.tampered"),
    )
    for field, value in mutations:
        tampered = deepcopy(manifest)
        cast(dict[str, object], cast(list[object], tampered["archives"])[0])[field] = value
        manifest_path.write_text(json.dumps(tampered), encoding="utf-8")
        with pytest.raises(
            ProtocolValidationError,
            match="source manifest differs from recomputed raw custody",
        ):
            validate_source_manifest(
                "development",
                raw_root=tmp_path,
                manifest_path=manifest_path,
            )
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (archive_root / "unexpected").write_text("x", encoding="ascii")
    with pytest.raises(ProtocolValidationError, match="object set"):
        validate_source_manifest(
            "development",
            raw_root=tmp_path,
            manifest_path=manifest_path,
        )


def test_h7_trade_duration_accounting_and_capacity_integration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + 2 * WEEK_MS
    timestamps = range(0, end_ms, HOUR_MS)
    spot = tuple(
        _bar(timestamp, open_price="100", quote_volume="2000000") for timestamp in timestamps
    )
    perp = tuple(
        _bar(timestamp, open_price="110", quote_volume="2000000")
        for timestamp in range(0, end_ms, HOUR_MS)
    )
    funding = tuple(
        FundingEvent(
            ts_ms=timestamp,
            rate=Decimal("0.0001"),
            mark_price=Decimal("110"),
        )
        for timestamp in range(0, end_ms, 8 * HOUR_MS)
    )
    data = MarketData(
        spot_bars=spot,
        perp_bars=perp,
        mark_bars=perp,
        funding_events=funding,
    )

    observed = evaluate_candidate(
        Candidate(6, 7, ZERO),
        data,
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=2,
    )

    assert len(observed.trades) == 1
    trade = observed.trades[0]
    assert trade.exit_reason == "MAX_HOLD"
    assert trade.quantity == Decimal("3.636")
    assert trade.exit_ts_ms - trade.entry_ts_ms == 604_800_000
    assert trade.primary.funding_usd == Decimal("0.8399160")
    assert trade.primary.net_usd == Decimal("-2.2143240")
    assert trade.stress.net_usd == Decimal("-3.7414440")
    assert trade.severe.net_usd == Decimal("-8.3228040")
    assert trade.primary.net_usd > trade.stress.net_usd > trade.severe.net_usd
    assert observed.weekly_primary_usd == (
        Decimal("-2.2543200"),
        Decimal("0.0399960"),
    )
    assert sum(observed.weekly_primary_usd, ZERO) == trade.primary.net_usd
    assert trade.capacity_usd == Decimal("2400") * Decimal("1000") / Decimal("399.96")
    assert trade.stress_capacity_usd == trade.capacity_usd / Decimal(2)


def _single_signal_hourly_market(
    *,
    end_ms: int,
    signal_ts_ms: int,
    fallback_perp_open: str,
    fallback_perp_close: str | None = None,
    post_fallback_perp_open: str | None = None,
    positive_basis_from_ts_ms: int = 0,
) -> MarketData:
    fallback = signal_ts_ms + HOUR_MS
    spot = tuple(
        _bar(timestamp, open_price="100", quote_volume="2000000")
        for timestamp in range(0, end_ms, HOUR_MS)
    )
    perp_rows: list[Bar] = []
    for timestamp in range(0, end_ms, HOUR_MS):
        open_price = (
            post_fallback_perp_open
            if post_fallback_perp_open is not None and timestamp > fallback
            else fallback_perp_open
            if timestamp == fallback
            else "110"
            if timestamp >= positive_basis_from_ts_ms
            else "100"
        )
        close = (
            fallback_perp_close
            if timestamp == fallback and fallback_perp_close is not None
            else open_price
        )
        perp_rows.append(
            _bar(
                timestamp,
                open_price=open_price,
                high=str(max(Decimal(open_price), Decimal(close))),
                low=str(min(Decimal(open_price), Decimal(close))),
                close=close,
                quote_volume="2000000",
            )
        )
    funding = tuple(
        FundingEvent(
            ts_ms=signal_ts_ms - offset * 8 * HOUR_MS,
            rate=Decimal("0.0001"),
            mark_price=Decimal("110"),
        )
        for offset in reversed(range(7))
    )
    return MarketData(
        spot_bars=spot,
        perp_bars=tuple(perp_rows),
        mark_bars=tuple(perp_rows),
        funding_events=funding,
    )


def test_skipped_fallback_preserves_paired_maker_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + 4 * WEEK_MS
    data = _single_signal_hourly_market(
        end_ms=end_ms,
        signal_ts_ms=start_ms,
        fallback_perp_open="100",
    )

    observed = evaluate_candidate(
        Candidate(6, 1, ZERO),
        data,
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=4,
    )
    mapping = experiment._evaluation_mapping(observed)
    execution = cast(dict[str, object], mapping["modeledExecution"])

    assert observed.trades == ()
    assert observed.paired_maker_attempt_count == 1
    assert execution["makerAttempts"] == 2
    assert execution["pairedTakerFallbackEntries"] == 0
    assert execution["pairedFallbackSkips"] == 1


def test_entry_open_liquidation_point_is_in_drawdown_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + WEEK_MS
    data = _single_signal_hourly_market(
        end_ms=end_ms,
        signal_ts_ms=start_ms,
        fallback_perp_open="110",
        fallback_perp_close="100",
        post_fallback_perp_open="100",
    )

    observed = evaluate_candidate(
        Candidate(6, 1, ZERO),
        data,
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=1,
    )

    assert len(observed.trades) == 1
    assert observed.drawdown.max_drawdown_usd == Decimal("3.054240")
    assert observed.drawdown.trough_usd == Decimal("996.945760")
    assert observed.stress_drawdown.max_drawdown_usd == Decimal("4.581360")
    assert observed.stress_drawdown.trough_usd == Decimal("995.418640")


def test_entry_open_terminal_drawdown_exits_after_fill_minute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + WEEK_MS
    data = _single_signal_hourly_market(
        end_ms=end_ms,
        signal_ts_ms=start_ms,
        fallback_perp_open="110",
        fallback_perp_close="100",
        post_fallback_perp_open="100",
    )

    observed = evaluate_candidate(
        Candidate(6, 1, ZERO),
        data,
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=1,
        initial_realized_usd=Decimal("-99"),
        initial_running_peak_usd=Decimal("1000"),
    )

    assert len(observed.trades) == 1
    trade = observed.trades[0]
    assert trade.exit_reason == "TERMINAL_DRAWDOWN_10_PERCENT"
    assert trade.exit_ts_ms == trade.entry_ts_ms + HOUR_MS
    assert observed.drawdown.max_drawdown_usd > Decimal("100")
    assert observed.terminal_stop is True


def test_boundary_liquidation_updates_drawdown_and_terminal_stop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + WEEK_MS
    base = _single_signal_hourly_market(
        end_ms=end_ms,
        signal_ts_ms=start_ms,
        fallback_perp_open="110",
    )
    perp = list(base.perp_bars)
    final = perp[-1]
    perp[-1] = _bar(
        final.ts_ms,
        open_price="110",
        high="150",
        low="110",
        close="150",
        quote_volume="2000000",
    )

    observed = evaluate_candidate(
        Candidate(6, 7, ZERO),
        MarketData(base.spot_bars, tuple(perp), base.mark_bars, base.funding_events),
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=1,
        force_flat_at_end=True,
    )

    assert observed.primary_net_usd < Decimal("-100")
    assert observed.drawdown.max_drawdown_usd > Decimal("100")
    assert observed.drawdown.trough_usd == observed.ending_primary_equity_usd
    assert observed.terminal_stop is True
    assert observed.trades[0].exit_reason == "BASIS_WIDENED_100BP"


def test_fallback_at_week_boundary_counts_only_fill_week(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + 2 * WEEK_MS
    signal = start_ms + WEEK_MS - HOUR_MS
    data = _single_signal_hourly_market(
        end_ms=end_ms,
        signal_ts_ms=signal,
        fallback_perp_open="110",
        positive_basis_from_ts_ms=signal - HOUR_MS,
    )

    observed = evaluate_candidate(
        Candidate(6, 1, ZERO),
        data,
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=2,
    )

    assert len(observed.trades) == 1
    assert observed.trades[0].entry_ts_ms == start_ms + WEEK_MS
    assert observed.active_week_count == 1


def test_exit_at_week_boundary_does_not_inflate_next_active_week(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    boundary = start_ms + WEEK_MS
    end_ms = start_ms + 2 * WEEK_MS
    signal = boundary - DAY_MS - HOUR_MS
    data = _single_signal_hourly_market(
        end_ms=end_ms,
        signal_ts_ms=signal,
        fallback_perp_open="110",
        positive_basis_from_ts_ms=signal - HOUR_MS,
    )

    observed = evaluate_candidate(
        Candidate(6, 1, ZERO),
        data,
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=2,
    )

    assert len(observed.trades) == 1
    assert observed.trades[0].exit_ts_ms == boundary
    assert observed.active_week_count == 1


def test_exit_capacity_uses_price_changed_actual_notional(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(experiment, "MINUTE_MS", HOUR_MS)
    monkeypatch.setattr(experiment, "MAKER_TIMEOUT_MS", HOUR_MS)
    start_ms = 7 * DAY_MS
    end_ms = start_ms + 2 * WEEK_MS
    exit_timestamp = start_ms + HOUR_MS + 7 * DAY_MS
    spot: list[Bar] = []
    perp: list[Bar] = []
    for timestamp in range(0, end_ms, HOUR_MS):
        if timestamp >= exit_timestamp:
            spot_price, perp_price = "125", "137.5"
        else:
            spot_price, perp_price = "100", "110"
        spot.append(_bar(timestamp, open_price=spot_price, quote_volume="2000000"))
        perp.append(_bar(timestamp, open_price=perp_price, quote_volume="2000000"))
    funding = tuple(
        FundingEvent(timestamp, Decimal("0.0001"), Decimal("110"))
        for timestamp in range(0, end_ms, 8 * HOUR_MS)
    )

    observed = evaluate_candidate(
        Candidate(6, 7, ZERO),
        MarketData(tuple(spot), tuple(perp), tuple(perp), funding),
        start_ms=start_ms,
        end_ms=end_ms,
        expected_weeks=2,
    )

    trade = observed.trades[0]
    exit_notional = Decimal("3.636") * Decimal("137.5")
    assert exit_notional == Decimal("499.9500")
    assert trade.capacity_usd == Decimal("2400") * Decimal("1000") / exit_notional
    assert trade.stress_capacity_usd == Decimal("1200") * Decimal("1000") / exit_notional
    assert trade.capacity_usd < Decimal("2400") * Decimal("1000") / Decimal("399.96")


def test_development_filters_ineligible_leader_and_binds_family_statistics(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    zero_costs = CostBreakdown(
        gross_basis_usd=ZERO,
        funding_usd=ZERO,
        spot_fees_usd=ZERO,
        futures_fees_usd=ZERO,
        spread_usd=ZERO,
        slippage_usd=ZERO,
        rounding_usd=ZERO,
        latency_usd=ZERO,
        net_usd=ZERO,
    )
    fake_trade = Trade(
        candidate_id="synthetic",
        entry_ts_ms=0,
        exit_ts_ms=1,
        exit_reason="SYNTHETIC",
        quantity=Decimal("1"),
        capacity_usd=Decimal("2000"),
        stress_capacity_usd=Decimal("1500"),
        primary=zero_costs,
        stress=zero_costs,
        severe=zero_costs,
    )
    evaluations: dict[str, CandidateEvaluation] = {}
    for index, candidate in enumerate(CANDIDATES):
        weekly = (
            tuple(Decimal("2") for _ in range(52))
            if index == 0
            else tuple(Decimal("1.5") for _ in range(52))
            if index == 1
            else tuple(Decimal("-1") for _ in range(52))
        )
        evaluations[candidate.candidate_id] = CandidateEvaluation(
            candidate=candidate,
            weekly_primary_usd=weekly,
            weekly_stress_usd=weekly,
            weekly_severe_usd=weekly,
            trades=tuple(fake_trade for _ in range(11 if index == 0 else 12)),
            drawdown=Drawdown(ZERO, ZERO, Decimal("1000"), Decimal("1000")),
            stress_drawdown=Drawdown(
                ZERO,
                ZERO,
                Decimal("1000"),
                Decimal("1000"),
            ),
            active_week_count=8,
            paired_maker_attempt_count=12,
            ending_primary_equity_usd=Decimal("1100"),
            ending_running_peak_usd=Decimal("1100"),
            ending_cooldown_until_ms=0,
            terminal_stop=False,
            minimum_capacity_usd=Decimal("2000"),
            minimum_stress_capacity_usd=Decimal("1500"),
        )

    monkeypatch.setattr(
        experiment,
        "evaluate_candidate",
        lambda candidate, *_args, **_kwargs: evaluations[candidate.candidate_id],
    )
    walk_scores = {
        candidate_id: evaluation.weekly_primary_usd
        for candidate_id, evaluation in evaluations.items()
    }
    monkeypatch.setattr(
        experiment,
        "_walk_forward_diagnostic",
        lambda _data: (
            walk_scores,
            tuple(CANDIDATES[0].candidate_id for _ in range(52)),
            walk_scores[CANDIDATES[0].candidate_id],
            ZERO,
        ),
    )

    def fake_interval(
        values: tuple[Decimal, ...],
        **_kwargs: object,
    ) -> BootstrapInterval:
        point = sum(values, ZERO)
        return BootstrapInterval(point, point, point, 9999, Decimal("0.05"))

    monkeypatch.setattr(experiment, "stationary_bootstrap_interval", fake_interval)
    monkeypatch.setattr(
        experiment,
        "_centered_bootstrap_pvalue",
        lambda *_args, **_kwargs: Decimal("0.001"),
    )
    seen_pbo: list[tuple[tuple[Decimal, ...], ...]] = []

    def fake_pbo(rows: tuple[tuple[Decimal, ...], ...]) -> CscvPboResult:
        seen_pbo.append(rows)
        return CscvPboResult(93, 924)

    monkeypatch.setattr(experiment, "cscv_pbo_result", fake_pbo)
    monkeypatch.setattr(
        experiment,
        "_evaluation_mapping",
        lambda item: {"candidateId": item.candidate.candidate_id},
    )

    fixed_raw_root = tmp_path / "fixed-raw"
    monkeypatch.setattr(experiment, "FIXED_RAW_ROOT", fixed_raw_root)
    development_marker = fixed_raw_root / "development.consumed.json"
    development_marker.parent.mkdir(parents=True)
    development_marker_payload = {
        "experimentPySha256": experiment._sha256_file(Path(experiment.__file__)),
        "freezeSha256": "e" * 64,
        "protocolSha256": "b" * 64,
        "sourceManifestSha256": "a" * 64,
        "sourcePlanSha256": "c" * 64,
        "trialLedgerSha256": "d" * 64,
    }
    development_marker.write_bytes(experiment._canonical_json_bytes(development_marker_payload))
    development_marker_digest = hashlib.sha256(development_marker.read_bytes()).hexdigest()

    result = experiment.run_development(
        MarketData((), (), (), ()),
        development_marker_digest=development_marker_digest,
        source_manifest_digest="a" * 64,
        protocol_digest="b" * 64,
        source_plan_digest="c" * 64,
        trial_ledger_digest="d" * 64,
    )

    assert result["topMeasuredCandidateId"] == CANDIDATES[0].candidate_id
    assert result["selectedCandidateId"] == CANDIDATES[1].candidate_id
    assert result["developmentGate"] == "PASS"
    candidate_eligibility = cast(
        dict[str, dict[str, bool]],
        result["candidateEligibility"],
    )
    walk_forward = cast(dict[str, object], result["walkForward"])
    pbo_result = cast(dict[str, object], result["pbo"])
    holm_result = cast(dict[str, object], result["holm"])
    assert candidate_eligibility[CANDIDATES[0].candidate_id]["sample"] is False
    assert walk_forward["steps"] == 52
    assert len(cast(list[str], walk_forward["oneWeekAheadWeeklyUsd"])) == 52
    assert pbo_result["splitCount"] == 924
    assert pbo_result["underperformCount"] == 93
    assert Decimal(cast(str, pbo_result["value"])) == Decimal(93) / Decimal(924)
    assert len(cast(dict[str, str], holm_result["rawPValues"])) == 12
    assert len(seen_pbo) == 1
    assert len(seen_pbo[0]) == 12
    assert all(len(row) == 12 for row in seen_pbo[0])
    for trial_index, candidate in enumerate(CANDIDATES):
        weekly = evaluations[candidate.candidate_id].weekly_primary_usd
        for block_index in range(12):
            offset = 4 + 4 * block_index
            assert seen_pbo[0][trial_index][block_index] == sum(
                weekly[offset : offset + 4],
                ZERO,
            )

    result_path = tmp_path / "development-result.json"
    result_path.write_text(json.dumps(result), encoding="utf-8")
    authorization = experiment._authorization_payload(
        development_result_path=result_path,
        development_marker_path=development_marker,
        development_source_manifest_digest="a" * 64,
        freeze_digest="e" * 64,
        protocol_digest="b" * 64,
        source_plan_digest="c" * 64,
        trial_ledger_digest="d" * 64,
        holdout_root=fixed_raw_root / "holdout",
    )
    assert authorization["candidateId"] == CANDIDATES[1].candidate_id

    tampered = deepcopy(result)
    tampered_seal = cast(dict[str, object], tampered["candidateSeal"])
    tampered_seal["experimentPySha256"] = "f" * 64
    result_path.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(ProtocolValidationError, match="digest"):
        experiment._authorization_payload(
            development_result_path=result_path,
            development_marker_path=development_marker,
            development_source_manifest_digest="a" * 64,
            freeze_digest="e" * 64,
            protocol_digest="b" * 64,
            source_plan_digest="c" * 64,
            trial_ledger_digest="d" * 64,
            holdout_root=fixed_raw_root / "holdout",
        )

    semantically_tampered = deepcopy(result)
    semantic_seal = cast(dict[str, object], semantically_tampered["candidateSeal"])
    candidate_payload = cast(dict[str, object], semantic_seal["candidate"])
    candidate_payload["hold_days"] = 7
    semantically_tampered["candidateDigest"] = hashlib.sha256(
        experiment._canonical_json_bytes(semantic_seal)
    ).hexdigest()
    result_path.write_text(json.dumps(semantically_tampered), encoding="utf-8")
    with pytest.raises(ProtocolValidationError, match="candidate seal differs"):
        experiment._authorization_payload(
            development_result_path=result_path,
            development_marker_path=development_marker,
            development_source_manifest_digest="a" * 64,
            freeze_digest="e" * 64,
            protocol_digest="b" * 64,
            source_plan_digest="c" * 64,
            trial_ledger_digest="d" * 64,
            holdout_root=fixed_raw_root / "holdout",
        )


def test_freeze_binds_protocol_runner_plan_ledger_and_tests(tmp_path: Path) -> None:
    protocol = experiment.HERE / "protocol.v1.json"
    freeze = experiment.HERE / "protocol.freeze.v1.json"
    assert verify_frozen_protocol(protocol, freeze)

    mutated = json.loads(freeze.read_text(encoding="utf-8"))
    mutated.pop("experimentPySha256")
    mutated_path = tmp_path / "mutated-freeze.json"
    mutated_path.write_text(json.dumps(mutated), encoding="utf-8")
    with pytest.raises(ProtocolValidationError, match="experimentPySha256"):
        verify_frozen_protocol(protocol, mutated_path)
