from __future__ import annotations

import importlib.util
import json
import sys
import zipfile
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

SUBJECT_PATH = Path(__file__).with_name("experiment.py")


@pytest.fixture(scope="module")
def subject() -> ModuleType:
    spec = importlib.util.spec_from_file_location("s1v_experiment_under_test", SUBJECT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _write_zip(path: Path, member: str, body: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, body)


def _bar(subject: ModuleType, time_ms: int, price: str = "100", quote: str = "10000000") -> Any:
    return subject.Bar(
        time_ms,
        Decimal(price),
        Decimal(price),
        Decimal(price),
        Decimal(price),
        time_ms + subject.HOUR_MS - 1,
        Decimal(quote),
    )


def _passing_development_summary(trial_id: str, metric: str) -> dict[str, Any]:
    return {
        "active_cohorts": 24,
        "active_weeks": 12,
        "base_bonferroni_lcb": metric,
        "base_net_usd_per_1000": "1",
        "distinct_traded_symbols": 12,
        "holm_adjusted_p": "0.01",
        "public_capacity_proxy_usd": {"minimum": "1000", "p05": "1000"},
        "remove_best_month_stress_net_usd_per_1000": "1",
        "remove_best_symbol_stress_net_usd_per_1000": "1",
        "severe_hourly_marked_equity_max_drawdown": "0.01",
        "stress_bonferroni_lcb": metric,
        "stress_net_usd_per_1000": "1",
        "trial_id": trial_id,
        "valid_decision_epochs": 60,
    }


def _position(subject: ModuleType, symbol: str, stress: str) -> Any:
    return subject.Position(
        symbol,
        1,
        Decimal(1),
        Decimal(1),
        Decimal(1),
        Decimal(0),
        Decimal(0),
        {"stress": Decimal(stress)},
        {},
        Decimal(0),
    )


def _cohort(
    subject: ModuleType,
    entry_ms: int,
    exit_ms: int,
    stress: str,
    positions: tuple[Any, ...] = (),
    capacity: str = "0",
) -> Any:
    return subject.Cohort(
        entry_ms,
        entry_ms,
        exit_ms,
        (),
        positions,
        {
            "base": Decimal(stress),
            "stress": Decimal(stress),
            "severe": Decimal(stress),
        },
        (),
        Decimal(capacity),
    )


def test_trial_family_is_exact_frozen_cartesian_product(subject: ModuleType) -> None:
    trials = subject.trial_family()

    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert trials[0].trial_id == "c3_x1p25_h6"
    assert trials[-1].trial_id == "c6_x1p75_h24"
    observed = {
        (trial.compression_observations, trial.expansion_ratio, trial.hold_hours)
        for trial in trials
    }
    assert observed == {
        (compression, expansion, hold)
        for compression in (3, 6)
        for expansion in (Decimal("1.25"), Decimal("1.75"))
        for hold in (6, 12, 24)
    }


def test_canonical_json_and_create_once_are_strict(subject: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    subject.write_once_json(path, {"z": 1, "a": 2})

    assert path.read_bytes() == b'{"a":2,"z":1}\n'
    with pytest.raises(subject.ContractError, match="CREATE_ONCE_REFUSED"):
        subject.write_once_json(path, {"replacement": True})


def test_checksum_is_bound_to_exact_archive_filename(subject: ModuleType) -> None:
    digest = "a1" * 32
    assert (
        subject.parse_checksum(
            f"{digest}  BTCUSDT-1h-2025-06.zip\n".encode("ascii"),
            "BTCUSDT-1h-2025-06.zip",
        )
        == digest
    )
    with pytest.raises(subject.EvidenceError, match="CHECKSUM_FILENAME_INVALID"):
        subject.parse_checksum(
            f"{digest}  OTHER.zip\n".encode("ascii"),
            "BTCUSDT-1h-2025-06.zip",
        )


def test_archive_reader_rejects_nested_or_multiple_members(
    subject: ModuleType, tmp_path: Path
) -> None:
    nested = tmp_path / "nested.zip"
    _write_zip(nested, "../rows.csv", "x\n")
    with pytest.raises(subject.EvidenceError, match="ZIP_MEMBER_INVALID"):
        subject.archive_member_bytes(nested)

    multiple = tmp_path / "multiple.zip"
    with zipfile.ZipFile(multiple, "w") as archive:
        archive.writestr("one.csv", "x\n")
        archive.writestr("two.csv", "x\n")
    with pytest.raises(subject.EvidenceError, match="ZIP_MEMBER_COUNT_INVALID"):
        subject.archive_member_bytes(multiple)


def test_funding_parser_preserves_milliseconds_and_rejects_interval_gap(
    subject: ModuleType, tmp_path: Path
) -> None:
    valid = tmp_path / "funding.zip"
    start_ms, end_ms = subject.month_bounds_ms("2025-06")
    times = [start_ms + 1, *range(start_ms + 8 * subject.HOUR_MS, end_ms, 8 * subject.HOUR_MS)]
    body = "calc_time,funding_interval_hours,last_funding_rate\n" + "".join(
        f"{time_ms},8,0.0001\n" for time_ms in times
    )
    _write_zip(
        valid,
        "funding.csv",
        body,
    )
    rows = subject.read_funding_archive(valid, "2025-06")
    assert rows[0].time_ms == start_ms + 1
    assert rows[0].normalized_rate == Decimal("0.0001")

    invalid = tmp_path / "gap.zip"
    _write_zip(
        invalid,
        "gap.csv",
        "calc_time,funding_interval_hours,last_funding_rate\n"
        "1748736000000,1,0.0001\n"
        "1748743202000,1,0.0002\n",
    )
    with pytest.raises(subject.EvidenceError, match="FUNDING_CHRONOLOGY_INVALID"):
        subject.read_funding_archive(invalid, "2025-06")


def test_funding_parser_enforces_first_and_last_month_boundaries(
    subject: ModuleType, tmp_path: Path
) -> None:
    start_ms, end_ms = subject.month_bounds_ms("2025-06")
    stale_first = tmp_path / "stale-first.zip"
    first_times = range(start_ms + 16 * subject.HOUR_MS, end_ms, 8 * subject.HOUR_MS)
    _write_zip(
        stale_first,
        "funding.csv",
        "calc_time,funding_interval_hours,last_funding_rate\n"
        + "".join(f"{time_ms},8,0.0001\n" for time_ms in first_times),
    )
    with pytest.raises(subject.EvidenceError, match="FUNDING_FIRST_BOUNDARY_STALE"):
        subject.read_funding_archive(stale_first, "2025-06")

    stale_last = tmp_path / "stale-last.zip"
    last_times = range(start_ms, end_ms - 8 * subject.HOUR_MS, 8 * subject.HOUR_MS)
    _write_zip(
        stale_last,
        "funding.csv",
        "calc_time,funding_interval_hours,last_funding_rate\n"
        + "".join(f"{time_ms},8,0.0001\n" for time_ms in last_times),
    )
    with pytest.raises(subject.EvidenceError, match="FUNDING_LAST_BOUNDARY_STALE"):
        subject.read_funding_archive(stale_last, "2025-06")


def test_kline_parser_accepts_only_causal_hourly_fields(
    subject: ModuleType, tmp_path: Path
) -> None:
    path = tmp_path / "bars.zip"
    _write_zip(
        path,
        "bars.csv",
        "open_time,open,high,low,close,volume,close_time,quote_volume,count,"
        "taker_buy_volume,taker_buy_quote_volume,ignore\n"
        "1748736000000,100,101,99,100.5,2,1748739599999,200,3,1,100,0\n",
    )
    bars = subject.read_kline_archive(path, "2025-06")
    assert bars[0].open_price == Decimal("100")
    assert bars[0].quote_volume == Decimal("200")


def test_strict_clock_uses_0800_row_first_at_0900(subject: ModuleType) -> None:
    eight = 8 * subject.HOUR_MS
    rows = (
        subject.FundingRow(0, 8, Decimal("0.0001")),
        subject.FundingRow(eight, 8, Decimal("0.0002")),
        subject.FundingRow(eight + 1, 8, Decimal("0.0003")),
    )
    funding = {"BTCUSDT": rows}

    assert subject._latest_index(rows, eight) == 0
    assert subject._latest_index(rows, eight + subject.HOUR_MS) == 2
    assert subject.changed_decision_epoch(funding, eight) is False
    assert subject.changed_decision_epoch(funding, eight + subject.HOUR_MS) is True


def test_changed_epoch_missing_latest_member_is_invalid_evidence(subject: ModuleType) -> None:
    hour = subject.HOUR_MS
    market = subject.MarketData(
        funding={
            "AUSDT": (subject.FundingRow(0, 8, Decimal("0.0001")),),
            "BUSDT": (subject.FundingRow(2 * hour, 8, Decimal("0.0002")),),
        },
        mark={},
        contract={},
    )

    with pytest.raises(subject.EvidenceError, match="LATEST_FUNDING_ROW_MISSING"):
        subject.build_snapshots(market, ("AUSDT", "BUSDT"), hour, 2 * hour)


def test_first_latest_row_builds_valid_snapshot_without_innovation(subject: ModuleType) -> None:
    hour = subject.HOUR_MS
    market = subject.MarketData(
        funding={"AUSDT": (subject.FundingRow(0, 8, Decimal("0.0001")),)},
        mark={},
        contract={},
    )

    snapshots = subject.build_snapshots(market, ("AUSDT",), hour, 2 * hour)

    assert len(snapshots) == 1
    assert snapshots[0].innovations == ()
    assert snapshots[0].baseline is None


def test_one_missing_prior_forces_entire_thirty_member_epoch_to_cash(
    subject: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hour = subject.HOUR_MS
    symbols = tuple(f"S{index:02d}USDT" for index in range(30))
    funding: dict[str, tuple[Any, ...]] = {}
    for index, symbol in enumerate(symbols[:-1]):
        if index < 3:
            prior_rate, latest_rate = Decimal("0.001"), Decimal("0.002")
        elif index < 6:
            prior_rate, latest_rate = Decimal("0.002"), Decimal("0.001")
        else:
            prior_rate = latest_rate = Decimal("0.001")
        funding[symbol] = (
            subject.FundingRow(0, 8, prior_rate),
            subject.FundingRow(hour, 8, latest_rate),
        )
    funding[symbols[-1]] = (subject.FundingRow(hour, 8, Decimal("0.001")),)
    market = subject.MarketData(funding=funding, mark={}, contract={})

    control = subject.build_snapshots(market, symbols[:-1], 2 * hour, 3 * hour)
    snapshots = subject.build_snapshots(market, symbols, 2 * hour, 3 * hour)

    assert len(control[0].innovations) == 29
    assert snapshots[0].innovations == ()
    monkeypatch.setattr(subject, "transition_passes", lambda *_args: True)

    def forbidden_build(*_args: Any) -> None:
        raise AssertionError("mixed-prior warmup epoch must remain cash")

    monkeypatch.setattr(subject, "build_cohort", forbidden_build)
    result = subject.evaluate_trial(
        market,
        snapshots,
        subject.Trial("test", 3, Decimal("1.25"), 6),
        2 * hour,
        30 * hour,
    )

    assert result.cohorts == ()
    assert result.valid_cash_epochs == 1


def test_transition_requires_own_baselines_and_current_expansion(subject: ModuleType) -> None:
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    snapshots = (
        *(subject.Snapshot(index, Decimal("1"), Decimal("2"), ()) for index in range(3)),
        subject.Snapshot(3, Decimal("3"), Decimal("2"), ()),
    )
    assert subject.transition_passes(snapshots, 3, trial) is True

    broken = list(snapshots)
    broken[1] = subject.Snapshot(1, Decimal("3"), Decimal("2"), ())
    assert subject.transition_passes(tuple(broken), 3, trial) is False


def test_innovation_tails_exclude_zero_and_matching_is_global_minimum(
    subject: ModuleType,
) -> None:
    longs = (
        subject.Innovation("L1USDT", Decimal("3"), Decimal("0"), Decimal("3")),
        subject.Innovation("L2USDT", Decimal("2"), Decimal("4"), Decimal("6")),
        subject.Innovation("L3USDT", Decimal("1"), Decimal("5"), Decimal("6")),
    )
    shorts = (
        subject.Innovation("S1USDT", Decimal("-3"), Decimal("1"), Decimal("-2")),
        subject.Innovation("S2USDT", Decimal("-2"), Decimal("3"), Decimal("1")),
        subject.Innovation("S3USDT", Decimal("-1"), Decimal("6"), Decimal("5")),
    )
    matching = subject.exact_matching(longs, shorts)

    assert matching == (
        ("L1USDT", "S1USDT"),
        ("L2USDT", "S2USDT"),
        ("L3USDT", "S3USDT"),
    )
    tails = subject.innovation_tails(
        (
            *longs,
            *shorts,
            subject.Innovation("ZUSDT", Decimal(0), Decimal(1), Decimal(1)),
        )
    )
    assert tails is not None
    assert {item.symbol for item in tails[0]} == {"L1USDT", "L2USDT", "L3USDT"}


def test_costs_charge_actual_entry_and_exit_notional(subject: ModuleType) -> None:
    entry = Decimal("100")
    exit_notional = Decimal("110")
    assert subject.scenario_cost(entry, exit_notional, "base") == Decimal("0.126")
    assert subject.scenario_cost(entry, exit_notional, "stress") == Decimal("0.273")
    assert subject.scenario_cost(entry, exit_notional, "severe") == Decimal("0.42")


def test_capacity_requires_trailing_24h_and_prior_seven_complete_days(
    subject: ModuleType,
) -> None:
    entry = 10 * subject.DAY_MS
    bars = {
        time_ms: _bar(subject, time_ms, quote="100")
        for time_ms in range(2 * subject.DAY_MS, entry, subject.HOUR_MS)
    }
    assert subject.causal_capacity_input(bars, entry) == Decimal("2400")

    del bars[entry - subject.HOUR_MS]
    with pytest.raises(subject.EvidenceError, match="TRAILING_24H_CAPACITY_INCOMPLETE"):
        subject.causal_capacity_input(bars, entry)


def test_funding_cashflow_excludes_boundaries_and_floors_mark_lookup(
    subject: ModuleType,
) -> None:
    hour = subject.HOUR_MS
    entry = 8 * hour
    exit_ms = 10 * hour
    market = subject.MarketData(
        funding={
            "BTCUSDT": (
                subject.FundingRow(entry, 8, Decimal("0.1")),
                subject.FundingRow(9 * hour + 1, 8, Decimal("0.1")),
                subject.FundingRow(exit_ms, 8, Decimal("0.1")),
            )
        },
        mark={"BTCUSDT": {9 * hour: _bar(subject, 9 * hour, "100")}},
        contract={"BTCUSDT": {}},
    )

    value = subject.funding_cashflow(market, "BTCUSDT", 1, Decimal("1"), entry, exit_ms)
    assert value == Decimal("-10")


def test_daily_vector_books_full_net_only_on_utc_exit_day(subject: ModuleType) -> None:
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    cohort = _cohort(
        subject,
        subject.DAY_MS,
        subject.DAY_MS + 5 * subject.HOUR_MS,
        "7",
    )
    result = subject.TrialResult(trial, (cohort,), 0, 0, 1)
    days = (0, subject.DAY_MS, 2 * subject.DAY_MS)

    assert subject.daily_vector(result, days, "stress") == (
        Decimal(0),
        Decimal(7),
        Decimal(0),
    )


def test_bootstrap_holm_and_white_are_deterministic(subject: ModuleType) -> None:
    vectors = {
        trial.trial_id: {
            scenario: tuple(Decimal((index + len(trial.trial_id)) % 5 - 2) for index in range(40))
            for scenario in subject.COSTS
        }
        for trial in subject.trial_family()
    }
    paths = subject.bootstrap_paths(40, replicates=64, seed=7)
    first, first_white = subject.bootstrap_trial_statistics(vectors, paths)
    second, second_white = subject.bootstrap_trial_statistics(vectors, paths)
    adjusted = subject.holm_adjust(
        {
            trial_id: max(values["base"]["p_value"], values["stress"]["p_value"])
            for trial_id, values in first.items()
        }
    )

    assert first == second
    assert first_white == second_white
    assert set(adjusted) == set(vectors)
    assert all(Decimal(0) <= value <= Decimal(1) for value in adjusted.values())


def test_bootstrap_golden_circular_paths_and_one_sided_ties(subject: ModuleType) -> None:
    assert subject.bootstrap_paths(5, replicates=2, seed=7, block_days=3) == (
        (2, 3, 4, 1, 2),
        (3, 4, 0, 0, 1),
    )
    paths = subject.bootstrap_paths(4, replicates=8, seed=3, block_days=2)
    constant = {"a": {scenario: (Decimal(1),) * 4 for scenario in subject.COSTS}}
    zeros = {"a": {scenario: (Decimal(0),) * 4 for scenario in subject.COSTS}}

    constant_stats, _ = subject.bootstrap_trial_statistics(constant, paths)
    zero_stats, _ = subject.bootstrap_trial_statistics(zeros, paths)

    assert constant_stats["a"]["base"]["p_value"] == Decimal(1) / Decimal(9)
    assert zero_stats["a"]["base"]["p_value"] == 1
    assert constant_stats["a"]["base"] == constant_stats["a"]["stress"]


def test_holm_step_down_and_white_scenarios_are_separate(subject: ModuleType) -> None:
    assert subject.holm_adjust(
        {"a": Decimal("0.01"), "b": Decimal("0.03"), "c": Decimal("0.04")}
    ) == {
        "a": Decimal("0.03"),
        "b": Decimal("0.06"),
        "c": Decimal("0.06"),
    }
    vectors = {
        "a": {
            "base": (Decimal(3), Decimal(-1), Decimal(0), Decimal(0)),
            "stress": (Decimal(1),) * 4,
            "severe": (Decimal(0),) * 4,
        },
        "b": {
            "base": (Decimal(0),) * 4,
            "stress": (Decimal(2), Decimal(0), Decimal(0), Decimal(0)),
            "severe": (Decimal(0),) * 4,
        },
    }
    paths = subject.bootstrap_paths(4, replicates=8, seed=3, block_days=2)

    _, white = subject.bootstrap_trial_statistics(vectors, paths)

    assert white == {
        "base": Decimal(3) / Decimal(9),
        "stress": Decimal(1) / Decimal(9),
    }


def test_empirical_quantile_uses_frozen_one_based_nearest_rank(subject: ModuleType) -> None:
    values = tuple(Decimal(index) for index in range(1, 4097))
    probability = Decimal(1) - Decimal("0.05") / Decimal(12)

    assert subject.empirical_quantile(values, probability) == Decimal(4079)
    assert subject.empirical_quantile(values, Decimal(0)) == Decimal(1)


def test_cross_partition_signal_is_valid_cash_before_build(
    subject: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    score_end = 100 * subject.HOUR_MS
    snapshot = subject.Snapshot(score_end - subject.HOUR_MS, Decimal(1), Decimal(1), ())
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    monkeypatch.setattr(subject, "transition_passes", lambda *_args: True)
    monkeypatch.setattr(subject, "innovation_tails", lambda *_args: ((), ()))

    def forbidden_build(*_args: Any) -> None:
        raise AssertionError("cross-partition cohort must not be built")

    monkeypatch.setattr(subject, "build_cohort", forbidden_build)
    result = subject.evaluate_trial(
        subject.MarketData({}, {}, {}),
        (snapshot,),
        trial,
        0,
        score_end,
    )

    assert result.cohorts == ()
    assert result.valid_cash_epochs == 1


def test_exact_partition_boundary_exit_is_cash_before_build(
    subject: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    score_end = 100 * subject.HOUR_MS
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    snapshot = subject.Snapshot(
        score_end - trial.hold_hours * subject.HOUR_MS,
        Decimal(1),
        Decimal(1),
        (),
    )
    monkeypatch.setattr(subject, "transition_passes", lambda *_args: True)
    monkeypatch.setattr(subject, "innovation_tails", lambda *_args: ((), ()))

    def forbidden_build(*_args: Any) -> None:
        raise AssertionError("exact-boundary cohort must not be built")

    monkeypatch.setattr(subject, "build_cohort", forbidden_build)
    result = subject.evaluate_trial(
        subject.MarketData({}, {}, {}),
        (snapshot,),
        trial,
        0,
        score_end,
    )

    assert result.cohorts == ()
    assert result.valid_cash_epochs == 1


def test_cscv_has_924_splits_and_conservative_ties(subject: ModuleType) -> None:
    results = tuple(subject.TrialResult(trial, (), 264, 0, 264) for trial in subject.trial_family())
    days = tuple(range(0, 264 * subject.DAY_MS, subject.DAY_MS))

    pbo = subject.cscv_pbo(results, days)

    assert pbo["splits"] == 924
    assert pbo["pbo"] == "1"
    assert pbo["authority"] == "DIAGNOSTIC_ONLY"


def test_cscv_excludes_exit_on_first_purge_day(subject: ModuleType) -> None:
    days = tuple(range(0, 264 * subject.DAY_MS, subject.DAY_MS))
    boundary_cohort = subject.Cohort(
        0,
        0,
        20 * subject.DAY_MS,
        (),
        (),
        {"stress": Decimal("100")},
        (),
        Decimal(0),
    )
    family = subject.trial_family()
    results = (
        subject.TrialResult(family[0], (boundary_cohort,), 0, 0, 1),
        *(subject.TrialResult(trial, (), 0, 0, 1) for trial in family[1:]),
    )

    scores = subject._cscv_block_scores(results, days)

    assert scores[family[0].trial_id][0] == 0


def test_severe_drawdown_uses_fixed_thousand_dollar_denominator(subject: ModuleType) -> None:
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    cohort = subject.Cohort(
        0,
        0,
        2,
        (),
        (),
        {"severe": Decimal(0)},
        ((0, Decimal(100)), (1, Decimal(0))),
        Decimal(0),
    )
    result = subject.TrialResult(trial, (cohort,), 0, 0, 1)

    assert subject.severe_max_drawdown(result) == Decimal("0.10")


def test_robustness_uses_all_negative_ascii_and_earliest_ties(subject: ModuleType) -> None:
    january, _ = subject.month_bounds_ms("2025-01")
    february, _ = subject.month_bounds_ms("2025-02")
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    cohorts = (
        _cohort(
            subject,
            january,
            january + subject.HOUR_MS,
            "-2",
            (
                _position(subject, "AUSDT", "-1"),
                _position(subject, "CUSDT", "-1"),
            ),
        ),
        _cohort(
            subject,
            february,
            february + subject.HOUR_MS,
            "-2",
            (
                _position(subject, "BUSDT", "-1"),
                _position(subject, "DUSDT", "-1"),
            ),
        ),
    )
    result = subject.TrialResult(trial, cohorts, 0, 0, 2)

    assert subject.robustness_targets(result) == ("AUSDT", "2025-01")
    assert subject.robustness(result) == (Decimal("-2"), Decimal("-2"))


def test_holdout_capacity_uses_minimum_p05_dict_and_result_preserves_it(
    subject: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    trial = subject.Trial("test", 3, Decimal("1.25"), 6)
    cohorts = tuple(
        _cohort(
            subject,
            index * subject.DAY_MS,
            index * subject.DAY_MS + subject.HOUR_MS,
            "1",
            capacity="999" if index == 0 else "2000",
        )
        for index in range(21)
    )
    trial_result = subject.TrialResult(trial, cohorts, 0, 0, 21)
    summary = subject.pointwise_holdout_summary(
        trial_result,
        tuple(range(0, 30 * subject.DAY_MS, subject.DAY_MS)),
    )

    assert summary["public_capacity_proxy_usd"] == {
        "minimum": "999",
        "p05": "2000",
    }
    assert subject.holdout_gates(summary)["base_capacity_min_usd_gte"] is False

    for name in (
        "candidate_seal.v1.json",
        "development.v1.json",
        "freeze.v1.json",
        "holdout.v1.json",
        "holdout_open.v1.json",
        "protocol.v1.json",
        "run_consumed.v1.json",
        "source_manifest.v1.json",
        "trial_ledger.v1.json",
    ):
        (tmp_path / name).write_text(name, encoding="utf-8")
    monkeypatch.setattr(subject, "HERE", tmp_path)
    development = {
        "pbo": {"pbo": "0.4"},
        "reported_trial_id": "test",
        "trials": [{"holm_adjusted_p": "0.01", "trial_id": "test"}],
        "white_reality_check_p_by_scenario": {"base": "0.01", "stress": "0.01"},
    }
    measured = subject.measured_result(
        "1" * 40,
        development,
        trial_result,
        {"all_gates_pass": False, "summary": summary},
    )

    assert measured["public_capacity_proxy"] == {
        "minimum": "999",
        "p05": "2000",
    }


def test_screen_ledger_keeps_excluded_success_and_derives_top30(
    subject: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        subject,
        "MEMBER_OPEN_COUNTS",
        {"development": 0, "holdout": 0, "screen": 0},
    )
    monkeypatch.setattr(subject, "MEMBER_OPEN_STAGE", None)
    monkeypatch.setattr(
        subject,
        "archive_path",
        lambda _root, kind, symbol, _month: Path(f"{kind}__{symbol}"),
    )
    monkeypatch.setattr(
        subject,
        "source_record",
        lambda _root, kind, symbol, _month: {
            "availability": "AVAILABLE",
            "sidecar_sha256": f"{symbol}-{kind}-sidecar",
            "zip_sha256": f"{symbol}-{kind}-zip",
        },
    )

    def read_funding(_path: Path, _month: str) -> tuple[Any, ...]:
        subject.MEMBER_OPEN_COUNTS["screen"] += 1
        return (subject.FundingRow(0, 8, Decimal("0.0001")),)

    def read_kline(path: Path, _month: str) -> tuple[Any, ...]:
        subject.MEMBER_OPEN_COUNTS["screen"] += 1
        kind, symbol = path.name.split("__", 1)
        quote = str(int(symbol[1:3]) + 1) if kind == "klines_1h" else "0"
        return (_bar(subject, 0, quote=quote),)

    monkeypatch.setattr(subject, "read_funding_archive", read_funding)
    monkeypatch.setattr(subject, "read_kline_archive", read_kline)
    monkeypatch.setattr(subject, "require_complete_month", lambda *_args: None)
    subject.set_member_open_stage("screen")
    symbols = tuple(f"S{index:02d}USDT" for index in range(31))

    attempts = subject.evaluate_screen_attempts(tmp_path, symbols)
    ranked = subject.rank_successful_screen_attempts(attempts)
    selected = ranked[:30]

    assert len(attempts) == 31
    assert all(attempt["archive_member_open_count"] == 3 for attempt in attempts)
    assert sum(attempt["archive_member_open_count"] for attempt in attempts) == 93
    assert subject.MEMBER_OPEN_COUNTS["screen"] == 93
    assert attempts[0]["symbol"] == "S00USDT"
    assert attempts[0]["status"] == "SUCCESS"
    assert "S00USDT" not in {row["symbol"] for row in selected}
    assert selected[0]["symbol"] == "S30USDT"


def test_screen_partial_invalid_open_counts_reconcile_without_fabrication(
    subject: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        subject,
        "MEMBER_OPEN_COUNTS",
        {"development": 0, "holdout": 0, "screen": 0},
    )
    monkeypatch.setattr(subject, "MEMBER_OPEN_STAGE", None)
    monkeypatch.setattr(
        subject,
        "archive_path",
        lambda _root, kind, symbol, _month: Path(f"{kind}__{symbol}"),
    )
    monkeypatch.setattr(
        subject,
        "source_record",
        lambda _root, _kind, _symbol, _month: {
            "availability": "AVAILABLE",
            "sidecar_sha256": "sidecar",
            "zip_sha256": "zip",
        },
    )

    def read_funding(_path: Path, _month: str) -> tuple[Any, ...]:
        subject.MEMBER_OPEN_COUNTS["screen"] += 1
        return (subject.FundingRow(0, 8, Decimal("0.0001")),)

    def read_kline(path: Path, _month: str) -> tuple[Any, ...]:
        subject.MEMBER_OPEN_COUNTS["screen"] += 1
        kind, symbol = path.name.split("__", 1)
        if kind == "klines_1h" and symbol == "AUSDT":
            raise subject.EvidenceError("KLINE_FIELD_INVALID", symbol)
        return (_bar(subject, 0),)

    monkeypatch.setattr(subject, "read_funding_archive", read_funding)
    monkeypatch.setattr(subject, "read_kline_archive", read_kline)
    monkeypatch.setattr(subject, "require_complete_month", lambda *_args: None)
    subject.set_member_open_stage("screen")

    attempts = subject.evaluate_screen_attempts(tmp_path, ("AUSDT", "BUSDT"))

    invalid, successful = attempts
    assert invalid == {
        "archive_member_open_count": 2,
        "reason_code": "KLINE_FIELD_INVALID",
        "status": "INVALID_EVIDENCE",
        "symbol": "AUSDT",
    }
    assert successful["archive_member_open_count"] == 3
    assert successful["status"] == "SUCCESS"
    assert sum(attempt["archive_member_open_count"] for attempt in attempts) == 5
    assert subject.MEMBER_OPEN_COUNTS["screen"] == 5


def test_screen_member_reads_remain_after_both_markers(
    subject: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    root = tmp_path / "source"
    root.mkdir()
    writes: list[tuple[Path, dict[str, Any]]] = []
    binding = {"static": "bound"}
    monkeypatch.setattr(subject, "HERE", tmp_path)
    monkeypatch.setattr(subject, "source_root_guard", lambda _path: root)
    monkeypatch.setattr(
        subject,
        "load_canonical_json",
        lambda _path, _schema: {"bound_files": binding},
    )
    monkeypatch.setattr(subject, "bound_files", lambda _names: binding)
    monkeypatch.setattr(subject, "sha256_file", lambda _path: "0" * 64)
    monkeypatch.setattr(
        subject,
        "write_once_json",
        lambda path, value: writes.append((path, dict(value))),
    )
    monkeypatch.setattr(
        subject,
        "MEMBER_OPEN_COUNTS",
        {"development": 0, "holdout": 0, "screen": 0},
    )
    monkeypatch.setattr(subject, "MEMBER_OPEN_STAGE", None)

    def candidates(_root: Path) -> tuple[str, ...]:
        assert [path.name for path, _value in writes] == [
            "screen_consumed.v1.json",
            "screen_consumed.v1.json",
        ]
        assert subject.MEMBER_OPEN_COUNTS["screen"] == 0
        return ()

    monkeypatch.setattr(subject, "candidate_symbols", candidates)

    universe = subject.screen(root)

    assert universe["screen_attempt_count"] == 0
    assert universe["screen_attempts"] == []
    assert universe["screen_archive_member_open_count"] == 0
    assert writes[0][1]["screen_archive_member_open_count_before"] == 0
    assert writes[0][1]["marker_created_before_first_member"] is True


def test_terminal_unmeasured_economics_are_null_not_cash(
    subject: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    for name in (
        "freeze.v1.json",
        "protocol.v1.json",
        "run_consumed.v1.json",
        "source_manifest.v1.json",
        "trial_ledger.v1.json",
    ):
        (tmp_path / name).write_text(name, encoding="utf-8")
    monkeypatch.setattr(subject, "HERE", tmp_path)
    result = subject.terminal_unmeasured_result("1" * 40, "INVALID_EVIDENCE")

    assert result["verdict"] == "UNMEASURED_RUN_CONSUMED_NO_RERUN"
    assert result["strategy_verdict"] == "UNMEASURED"
    assert result["reported_trial_id"] is None
    assert set(result["net_usd_per_1000_by_scenario"].values()) == {None}
    assert result["causal_and_activity_counters"] is None
    assert result["remove_best_symbol_and_month_stress_net"] is None
    assert result["severe_hourly_marked_equity_max_drawdown"] is None
    assert result["white_reality_check_p_by_scenario"] is None
    assert result["capital_authority"] == "NO_GO"
    assert result["executable_capacity"] == "UNKNOWN"
    assert result["effects"]["money_moved_usd"] == 0


def test_static_protocol_encodes_latest_causal_rules(subject: ModuleType) -> None:
    protocol = json.loads(Path(__file__).with_name("protocol.v1.json").read_text())

    assert protocol["schema"] == "cosmos.quant.research.s1v.protocol.v1"
    assert protocol["window"]["holdout_start"] == "2026-04-08T00:00:00Z"
    assert protocol["costs"]["scenarios"]["base"] == {
        "adverse_execution_bp_per_fill": 2.0,
        "public_fee_bp_per_fill": 4.0,
        "round_trip_bp_per_leg_at_unchanged_notional": 12.0,
    }
    assert protocol["matching"]["method"] == "enumerate all 3! perfect matchings"
    assert protocol["statistics"]["pbo"]["splits"] == 924


def test_development_gate_keys_exactly_match_frozen_protocol(subject: ModuleType) -> None:
    protocol = json.loads(Path(__file__).with_name("protocol.v1.json").read_text())
    champion = _passing_development_summary("test", "1")
    gates = subject.development_gates(
        champion,
        {"base": Decimal("0.01"), "stress": Decimal("0.01")},
        {"pbo": "0.4"},
    )
    frozen_keys = set(protocol["development_gates"]) - {"all_must_pass_before_candidate_seal"}

    assert set(gates) == frozen_keys
    assert all(gates.values())


def test_activity_gate_threshold_edges_fail_one_below(subject: ModuleType) -> None:
    summary = _passing_development_summary("test", "1")
    summary.update(
        {
            "active_cohorts": 23,
            "active_weeks": 11,
            "distinct_traded_symbols": 11,
            "valid_decision_epochs": 59,
        }
    )

    gates = subject.development_gates(
        summary,
        {"base": Decimal("0.01"), "stress": Decimal("0.01")},
        {"pbo": "0.4"},
    )

    assert gates["active_cohorts_min"] is False
    assert gates["active_weeks_min"] is False
    assert gates["distinct_traded_symbols_min"] is False
    assert gates["valid_causal_decision_epochs_min"] is False


def test_champion_selection_uses_complete_tie_break_chain(subject: ModuleType) -> None:
    identifiers = ("low", "z", "y", "x", "a")
    results = tuple(
        subject.TrialResult(
            subject.Trial(identifier, 3, Decimal("1.25"), 6),
            (),
            0,
            0,
            60,
        )
        for identifier in identifiers
    )
    summaries = {
        identifier: _passing_development_summary(
            identifier,
            "1" if identifier == "low" else "2",
        )
        for identifier in identifiers
    }
    summaries["low"]["stress_net_usd_per_1000"] = "100"
    summaries["z"]["stress_net_usd_per_1000"] = "1"
    for identifier in ("y", "x", "a"):
        summaries[identifier]["stress_net_usd_per_1000"] = "2"
    summaries["y"]["severe_hourly_marked_equity_max_drawdown"] = "0.2"
    for identifier in ("z", "x", "a"):
        summaries[identifier]["severe_hourly_marked_equity_max_drawdown"] = "0.1"

    champion = subject.select_champion(
        results,
        tuple(summaries[identifier] for identifier in identifiers),
    )

    assert champion.trial.trial_id == "a"


def test_champion_is_best_metric_among_gate_passing_trials(subject: ModuleType) -> None:
    top = subject.Trial("top", 3, Decimal("1.25"), 6)
    lower = subject.Trial("lower", 3, Decimal("1.25"), 12)
    results = (
        subject.TrialResult(top, (), 0, 0, 60),
        subject.TrialResult(lower, (), 0, 0, 60),
    )
    top_summary = _passing_development_summary("top", "10")
    top_summary["base_net_usd_per_1000"] = "-1"
    lower_summary = _passing_development_summary("lower", "1")

    rows, champion, reported = subject.gate_and_select_development_trials(
        results,
        (top_summary, lower_summary),
        {"base": Decimal("0.01"), "stress": Decimal("0.01")},
        {"pbo": "0.4"},
    )

    assert champion is not None
    assert champion.trial.trial_id == "lower"
    assert reported.trial.trial_id == "lower"
    assert (
        next(row for row in rows if row["trial_id"] == "top")["passes_all_development_gates"]
        is False
    )


def test_no_eligible_trial_has_null_champion_and_metric_report_trial(
    subject: ModuleType,
) -> None:
    top = subject.Trial("top", 3, Decimal("1.25"), 6)
    lower = subject.Trial("lower", 3, Decimal("1.25"), 12)
    results = (
        subject.TrialResult(top, (), 0, 0, 60),
        subject.TrialResult(lower, (), 0, 0, 60),
    )
    top_summary = _passing_development_summary("top", "10")
    lower_summary = _passing_development_summary("lower", "1")
    top_summary["base_net_usd_per_1000"] = "-1"
    lower_summary["base_net_usd_per_1000"] = "-1"

    rows, champion, reported = subject.gate_and_select_development_trials(
        results,
        (top_summary, lower_summary),
        {"base": Decimal("0.01"), "stress": Decimal("0.01")},
        {"pbo": "0.4"},
    )

    assert champion is None
    assert reported.trial.trial_id == "top"
    assert all(row["passes_all_development_gates"] is False for row in rows)
