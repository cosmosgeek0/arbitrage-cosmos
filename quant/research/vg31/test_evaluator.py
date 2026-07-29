from __future__ import annotations

import inspect
import json
import zipfile
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from research.vg31 import evaluator as vg31


def make_bar(
    symbol: str,
    day: date,
    *,
    quote_volume: Decimal = Decimal("100"),
    open_price: Decimal = Decimal("10"),
) -> vg31.Bar:
    moment = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
    if day >= date(2025, 1, 1):
        open_time = int(moment.timestamp()) * 1_000_000
        close_time = open_time + 86_400_000_000 - 1
        unit = "MICROSECOND"
    else:
        open_time = int(moment.timestamp()) * 1_000
        close_time = open_time + 86_400_000 - 1
        unit = "MILLISECOND"
    fields = (
        str(open_time),
        str(open_price),
        str(open_price),
        str(open_price),
        str(open_price),
        "1",
        str(close_time),
        str(quote_volume),
        "1",
        "0.5",
        str(quote_volume / 2),
        "0",
    )
    return vg31.Bar(
        symbol=symbol,
        day=day,
        open=open_price,
        high=open_price,
        low=open_price,
        close=open_price,
        quote_volume=quote_volume,
        open_time=open_time,
        close_time=close_time,
        timestamp_unit=unit,
        fields=fields,
    )


def synthetic_bars(
    start: date,
    end_exclusive: date,
) -> dict[str, dict[date, vg31.Bar]]:
    bars: dict[str, dict[date, vg31.Bar]] = {}
    for symbol_index, symbol in enumerate(vg31.FIXED_COHORT):
        symbol_rows: dict[date, vg31.Bar] = {}
        for offset, day in enumerate(vg31.iter_days(start, end_exclusive)):
            volume = Decimal(1000 + symbol_index * 17 + ((offset * 37 + symbol_index) % 211))
            price = Decimal(10 + symbol_index) + Decimal(offset) / Decimal(100)
            symbol_rows[day] = make_bar(
                symbol,
                day,
                quote_volume=volume,
                open_price=price,
            )
        bars[symbol] = symbol_rows
    return bars


def active_signal(trial: vg31.Trial, entry_day: date) -> vg31.FormationSignal:
    matrix = tuple([Decimal("0.0625")] * 16)
    return vg31.FormationSignal(
        entry_day=entry_day,
        cutoff_day=entry_day - timedelta(days=2),
        recent_days=trial.recent_days,
        threshold=trial.threshold,
        recent_matrix=matrix,
        older_matrix=matrix,
        delta=trial.threshold,
        active=True,
    )


def test_protocol_freezes_exact_family_and_authority() -> None:
    protocol = json.loads(vg31.PROTOCOL_PATH.read_text(encoding="utf-8"))

    assert protocol["canonicalBaseCommit"] == vg31.BASE_COMMIT
    assert protocol["trials"]["attemptedCount"] == 12
    assert protocol["trials"]["recentWindows"] == [7, 14, 28]
    assert protocol["trials"]["thresholds"] == ["0.10", "0.20"]
    assert protocol["trials"]["holdDays"] == [3, 7]
    assert protocol["universe"]["fixedCohort"] == list(vg31.FIXED_COHORT)
    assert protocol["universe"]["memberRanking"] == "NONE"
    assert protocol["signal"]["priceInformationUsed"] is False
    assert protocol["authority"]["consumer"] == "N3 successor/final convergence"
    assert protocol["authority"]["capitalAuthority"] == "NONE"
    assert protocol["authority"]["delegationThreadSuffix"] == "7017"
    assert protocol["authority"]["taskSuffix"] == "521b"
    assert protocol["data"]["quoteVolumeFieldZeroBased"] == 7
    assert protocol["data"]["quoteVolumeFieldOneBased"] == 8
    assert protocol["data"]["zeroQuoteVolumePolicy"] == "VALID_CLASSIFIABLE_OBSERVATION"
    assert protocol["runControl"]["stateRoot"] == "quant/research/vg31"
    assert protocol["runControl"]["stateRootMode"] == "PACKET_LOCAL_EXCLUSIVE_WRITER_SCOPE"
    assert protocol["distinctness"]["collisionStopLaw"].endswith(
        "ANY_EXACT_SIGNAL_UNIVERSE_SCHEDULE_ALLOCATION_COLLISION_STOPS_UNMEASURED_BEFORE_ARCHIVE_OPEN"
    )
    assert protocol["statistics"]["pbo"]["actualChampionSelectionRulePbo"] == "UNMEASURED"
    assert protocol["statistics"]["pbo"]["selectionRuleReproduced"] is False
    assert protocol["verdictLaw"]["capitalVerdict"].startswith("NO_GO_ALWAYS")


def test_trial_grid_is_exact_unique_twelve() -> None:
    trials = vg31.trial_grid()

    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert {trial.recent_days for trial in trials} == {7, 14, 28}
    assert {trial.threshold for trial in trials} == {Decimal("0.10"), Decimal("0.20")}
    assert {trial.hold_days for trial in trials} == {3, 7}


def test_prior_84_order_statistics_and_tie_rule_are_exact() -> None:
    target = date(2025, 6, 1)
    rows = {
        target - timedelta(days=85 - index): make_bar(
            "BTCUSDT",
            target - timedelta(days=85 - index),
            quote_volume=Decimal(index),
        )
        for index in range(1, 85)
    }
    rows[target] = make_bar("BTCUSDT", target, quote_volume=Decimal(21))
    assert vg31.state_for_day(rows, target) == 0
    rows[target] = make_bar("BTCUSDT", target, quote_volume=Decimal(42))
    assert vg31.state_for_day(rows, target) == 1
    rows[target] = make_bar("BTCUSDT", target, quote_volume=Decimal(63))
    assert vg31.state_for_day(rows, target) == 2
    rows[target] = make_bar("BTCUSDT", target, quote_volume=Decimal(64))
    assert vg31.state_for_day(rows, target) == 3


def test_state_excludes_current_and_future_from_quartiles() -> None:
    target = date(2025, 6, 1)
    rows = {
        target - timedelta(days=offset): make_bar(
            "BTCUSDT",
            target - timedelta(days=offset),
            quote_volume=Decimal(100 - offset),
        )
        for offset in range(84, 0, -1)
    }
    rows[target] = make_bar("BTCUSDT", target, quote_volume=Decimal(1000))
    before = vg31.state_for_day(rows, target)
    rows[target + timedelta(days=1)] = make_bar(
        "BTCUSDT", target + timedelta(days=1), quote_volume=Decimal("1e40")
    )
    rows[target] = make_bar("BTCUSDT", target, quote_volume=Decimal(1000), open_price=Decimal(1))
    assert before == 3
    assert vg31.state_for_day(rows, target) == before


def test_transition_matrix_is_joint_normalized_and_fixed_cohort() -> None:
    to_day = date(2025, 8, 1)
    bars = synthetic_bars(to_day - timedelta(days=100), to_day + timedelta(days=1))

    matrix = vg31.transition_matrix(bars, (to_day,))

    assert len(matrix) == 16
    assert sum(matrix) == Decimal(1)
    scaled = [value * Decimal(len(vg31.FIXED_COHORT)) for value in matrix]
    assert all(value == value.to_integral_value() for value in scaled)


def test_total_variation_has_exact_range_and_value() -> None:
    first = [Decimal(0)] * 16
    second = [Decimal(0)] * 16
    first[0] = Decimal(1)
    second[1] = Decimal(1)

    assert vg31.total_variation(first, first) == 0
    assert vg31.total_variation(first, second) == 1


def test_monday_signal_uses_e_minus_2_and_disjoint_windows() -> None:
    entry = date(2025, 10, 6)
    bars = synthetic_bars(entry - timedelta(days=300), entry + timedelta(days=2))
    trial = vg31.Trial("fixture", 14, Decimal("0.10"), 3)

    signal = vg31.signal_for_entry(bars, trial, entry)

    assert signal.cutoff_day == entry - timedelta(days=2)
    assert signal.recent_days == 14
    assert Decimal(0) <= signal.delta <= Decimal(1)


def test_signal_is_invariant_to_sunday_and_all_prices() -> None:
    entry = date(2025, 10, 6)
    bars = synthetic_bars(entry - timedelta(days=300), entry + timedelta(days=2))
    trial = vg31.Trial("fixture", 28, Decimal("0.20"), 7)
    before = vg31.signal_for_entry(bars, trial, entry)
    sunday = entry - timedelta(days=1)
    for symbol in vg31.FIXED_COHORT:
        sunday_bar = bars[symbol][sunday]
        bars[symbol][sunday] = make_bar(
            symbol,
            sunday,
            quote_volume=sunday_bar.quote_volume * Decimal("1e9"),
            open_price=Decimal("1e9"),
        )
        for day, bar in list(bars[symbol].items()):
            if day <= entry:
                bars[symbol][day] = make_bar(
                    symbol,
                    day,
                    quote_volume=bar.quote_volume,
                    open_price=Decimal("0.01") + Decimal(day.toordinal() % 7),
                )

    after = vg31.signal_for_entry(bars, trial, entry)

    assert after == before


def test_signal_missing_member_is_terminal_not_smaller_cohort() -> None:
    entry = date(2025, 10, 6)
    bars = synthetic_bars(entry - timedelta(days=300), entry + timedelta(days=2))
    del bars[vg31.FIXED_COHORT[-1]]

    with pytest.raises(vg31.VG31Error, match="FIXED_MEMBER_ABSENT"):
        vg31.signal_for_entry(
            bars,
            vg31.Trial("fixture", 7, Decimal("0.10"), 3),
            entry,
        )


def test_simulation_holds_all_members_or_cash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 7, 7)
    end = start + timedelta(days=22)
    bars = synthetic_bars(start - timedelta(days=300), end + timedelta(days=1))
    trial = vg31.Trial("fixture", 7, Decimal("0.10"), 3)
    monkeypatch.setattr(
        vg31,
        "signal_for_entry",
        lambda _bars, supplied_trial, entry: active_signal(supplied_trial, entry),
    )

    result = vg31.simulate_trial(
        bars,
        trial,
        vg31.SCENARIOS[0],
        start,
        end,
    )

    assert result.active_spells == result.valid_formations
    assert result.distinct_held_symbols == len(vg31.FIXED_COHORT)
    assert result.fills == result.active_spells * len(vg31.FIXED_COHORT) * 2


def test_missing_entry_open_is_terminal_not_cash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 7, 7)
    end = start + timedelta(days=15)
    bars = synthetic_bars(start - timedelta(days=300), end + timedelta(days=1))
    del bars[vg31.FIXED_COHORT[0]][start]
    trial = vg31.Trial("fixture", 7, Decimal("0.10"), 3)
    monkeypatch.setattr(
        vg31,
        "signal_for_entry",
        lambda _bars, supplied_trial, entry: active_signal(supplied_trial, entry),
    )

    with pytest.raises(vg31.VG31Error, match="ENTRY_OPEN_MISSING"):
        vg31.simulate_trial(bars, trial, vg31.SCENARIOS[0], start, end)


def test_public_cost_scenarios_are_monotonic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2025, 7, 7)
    end = start + timedelta(days=22)
    bars = synthetic_bars(start - timedelta(days=300), end + timedelta(days=1))
    trial = vg31.Trial("fixture", 7, Decimal("0.10"), 3)
    monkeypatch.setattr(
        vg31,
        "signal_for_entry",
        lambda _bars, supplied_trial, entry: active_signal(supplied_trial, entry),
    )

    values = [
        vg31.simulate_trial(bars, trial, scenario, start, end).final_nav
        for scenario in vg31.SCENARIOS
    ]

    assert values[0] > values[1] > values[2] > values[3]


def test_capacity_uses_only_through_e_minus_2() -> None:
    entry = date(2025, 10, 6)
    bars = synthetic_bars(entry - timedelta(days=60), entry + timedelta(days=2))
    before = vg31.capacity_for_entry(bars, entry)
    for symbol in vg31.FIXED_COHORT:
        for day in (entry - timedelta(days=1), entry):
            bar = bars[symbol][day]
            bars[symbol][day] = make_bar(
                symbol,
                day,
                quote_volume=Decimal("1e30"),
                open_price=bar.open,
            )

    assert vg31.capacity_for_entry(bars, entry) == before


def test_parse_bar_enforces_utc_daily_and_timestamp_era() -> None:
    valid = make_bar("BTCUSDT", date(2025, 1, 2))
    assert vg31.parse_bar("BTCUSDT", valid.fields, 1).day == date(2025, 1, 2)
    zero_volume = list(valid.fields)
    zero_volume[7] = "0"
    assert vg31.parse_bar("BTCUSDT", zero_volume, 1).quote_volume == 0
    invalid = list(valid.fields)
    invalid[0] = str(int(invalid[0]) + 1)

    with pytest.raises(vg31.VG31Error, match="OPEN_NOT_UTC_DAY_BOUNDARY"):
        vg31.parse_bar("BTCUSDT", invalid, 1)


def test_archive_loader_rejects_even_identical_duplicate_days(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    symbol = "BTCUSDT"
    month = "2025-01"
    row = make_bar(symbol, date(2025, 1, 2)).fields
    zip_path = tmp_path / f"{symbol}-1d-{month}.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", ",".join(row) + "\n" + ",".join(row) + "\n")
    monkeypatch.setattr(vg31, "_artifact_paths", lambda *_args: (zip_path, tmp_path, tmp_path))

    with pytest.raises(vg31.VG31Error, match="DUPLICATE_OR_CONFLICTING_DAY"):
        vg31._load_archive(symbol, month)


def test_transition_window_must_be_consecutive() -> None:
    target = date(2025, 8, 1)
    bars = synthetic_bars(target - timedelta(days=100), target + timedelta(days=1))

    with pytest.raises(vg31.VG31Error, match="TRANSITION_WINDOW_NOT_CONSECUTIVE"):
        vg31.transition_matrix(bars, (target - timedelta(days=2), target))


def test_bootstrap_and_white_are_seed_deterministic() -> None:
    values = tuple(0.001 if index % 3 else -0.0005 for index in range(120))
    first = vg31.bootstrap_inference(values, seed=31, replicates=64, block_length=7)
    second = vg31.bootstrap_inference(values, seed=31, replicates=64, block_length=7)
    white_first = vg31.white_reality_check(
        {"a": values, "b": tuple(item / 2 for item in values)},
        seed=32,
        replicates=64,
        block_length=7,
    )
    white_second = vg31.white_reality_check(
        {"a": values, "b": tuple(item / 2 for item in values)},
        seed=32,
        replicates=64,
        block_length=7,
    )

    assert first == second
    assert white_first == white_second


def test_family_rank_heuristic_never_claims_selection_rule_pbo() -> None:
    paths = {
        trial_id: vg31.PathMetrics(
            trial_id=trial_id,
            scenario="PUBLIC_STRESS",
            start_day=date(2025, 7, 1),
            end_exclusive=date(2026, 3, 1),
            final_nav=Decimal("1000"),
            net_usdt=Decimal("0"),
            valid_formations=30,
            active_spells=20,
            fills=480,
            distinct_held_symbols=12,
            maximum_drawdown_pct=Decimal("0"),
            positive_months=0,
            active_capacity_p05_usdt=Decimal("1000"),
            daily_log_returns=(0.0,),
            monthly_net_usdt=(
                *(
                    (f"2025-{month:02d}", Decimal(index))
                    for index, month in enumerate(range(7, 13), start=1)
                ),
                ("2026-01", Decimal("7")),
                ("2026-02", Decimal("8")),
            ),
        )
        for trial_id in ("a", "b")
    }

    diagnostic = vg31.pbo_cscv(paths)

    assert diagnostic["selectionRuleReproduced"] is False
    assert diagnostic["pboOfImplementedSelectionRule"] is None
    assert diagnostic["status"] == "HEURISTIC_ONLY_NOT_SELECTION_RULE_PBO"


def test_holm_is_monotone_and_bounded() -> None:
    adjusted = vg31.holm_adjust({"a": Decimal("0.001"), "b": Decimal("0.02"), "c": Decimal("0.9")})

    assert Decimal(0) <= adjusted["a"] <= adjusted["b"] <= adjusted["c"] <= Decimal(1)


def test_freeze_inventory_never_constructs_zip_reader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden_zip(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("freeze attempted to construct ZipFile")

    monkeypatch.setattr(zipfile, "ZipFile", forbidden_zip)

    manifest = vg31.build_source_manifest()

    assert manifest["archiveBodiesOpenedByVG31DuringFreeze"] is False
    assert manifest["artifactCount"] == len(vg31.FIXED_COHORT) * len(vg31.SOURCE_MONTHS)
    assert manifest["sourceMode"] == "READ_ONLY"


def test_freeze_code_path_contains_no_archive_open() -> None:
    source = inspect.getsource(vg31.build_source_manifest)

    assert "ZipFile" not in source
    assert "_load_archive" not in source
    assert "archive.read" not in source


def test_run_writes_marker_before_development_load(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    run_marker = tmp_path / "state" / "run.json"
    terminal = tmp_path / "state" / "terminal.json"
    result = tmp_path / "result.json"
    monkeypatch.setattr(vg31, "STATE_ROOT", tmp_path / "state")
    monkeypatch.setattr(vg31, "RUN_MARKER_PATH", run_marker)
    monkeypatch.setattr(vg31, "CANDIDATE_SEAL_PATH", tmp_path / "state" / "candidate.json")
    monkeypatch.setattr(vg31, "HOLDOUT_MARKER_PATH", tmp_path / "state" / "holdout.json")
    monkeypatch.setattr(vg31, "TERMINAL_CORE_PATH", terminal)
    monkeypatch.setattr(vg31, "RESULT_PATH", result)
    freeze_path = tmp_path / "freeze.json"
    freeze_path.write_text("{}\n")
    monkeypatch.setattr(vg31, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg31, "assert_frozen", lambda: {})
    monkeypatch.setattr(vg31, "assert_runtime_contract", lambda: None)
    monkeypatch.setattr(
        vg31,
        "frozen_candidate_snapshot",
        lambda: {"baseHead": vg31.BASE_COMMIT, "baseTree": "tree"},
    )

    def fail_after_marker(_months: object) -> dict[str, dict[date, vg31.Bar]]:
        assert run_marker.exists()
        raise vg31.VG31Error("SYNTHETIC_STOP")

    monkeypatch.setattr(vg31, "load_bars", fail_after_marker)

    vg31.run()

    assert json.loads(result.read_text())["verdict"] == "UNMEASURED"
    assert "SYNTHETIC_STOP" in json.loads(result.read_text())["blocker"]
    assert json.loads(result.read_text())["terminalPhase"] == "DEVELOPMENT_LOAD"


def test_development_failure_keeps_holdout_unopened(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(vg31, "STATE_ROOT", tmp_path / "state")
    monkeypatch.setattr(vg31, "RUN_MARKER_PATH", tmp_path / "state" / "run.json")
    monkeypatch.setattr(vg31, "CANDIDATE_SEAL_PATH", tmp_path / "state" / "candidate.json")
    monkeypatch.setattr(vg31, "HOLDOUT_MARKER_PATH", tmp_path / "state" / "holdout.json")
    monkeypatch.setattr(vg31, "TERMINAL_CORE_PATH", tmp_path / "state" / "terminal.json")
    monkeypatch.setattr(vg31, "RESULT_PATH", tmp_path / "result.json")
    freeze_path = tmp_path / "freeze.json"
    freeze_path.write_text("{}\n")
    monkeypatch.setattr(vg31, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg31, "assert_frozen", lambda: {})
    monkeypatch.setattr(vg31, "assert_runtime_contract", lambda: None)
    monkeypatch.setattr(
        vg31,
        "frozen_candidate_snapshot",
        lambda: {"baseHead": vg31.BASE_COMMIT, "baseTree": "tree"},
    )

    def fake_load(months: object) -> dict[str, dict[date, vg31.Bar]]:
        assert isinstance(months, tuple)
        calls.append(months)
        return {}

    monkeypatch.setattr(vg31, "load_bars", fake_load)
    monkeypatch.setattr(
        vg31,
        "evaluate_development",
        lambda _bars: ({"championTrialId": None}, None),
    )

    vg31.run()

    assert calls == [vg31.DEVELOPMENT_MONTHS]
    assert not (tmp_path / "state" / "holdout.json").exists()
    assert json.loads((tmp_path / "result.json").read_text())["verdict"] == "NO_GO"


def test_holdout_failure_is_consumed_unmeasured_and_verifiable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    state = tmp_path / "state"
    paths = {
        "RUN_MARKER_PATH": state / "run.json",
        "CANDIDATE_SEAL_PATH": state / "candidate.json",
        "HOLDOUT_MARKER_PATH": state / "holdout.json",
        "TERMINAL_CORE_PATH": state / "terminal.json",
        "RESULT_PATH": tmp_path / "result.json",
    }
    monkeypatch.setattr(vg31, "STATE_ROOT", state)
    for name, path in paths.items():
        monkeypatch.setattr(vg31, name, path)
    freeze_path = tmp_path / "freeze.json"
    freeze_path.write_text("{}\n")
    monkeypatch.setattr(vg31, "FREEZE_PATH", freeze_path)
    monkeypatch.setattr(vg31, "assert_frozen", lambda: {})
    monkeypatch.setattr(vg31, "assert_runtime_contract", lambda: None)
    monkeypatch.setattr(
        vg31,
        "frozen_candidate_snapshot",
        lambda: {"baseHead": vg31.BASE_COMMIT, "baseTree": "tree"},
    )
    champion = vg31.trial_grid()[0]
    trial_rows = {
        trial.trial_id: {
            "gates": dict.fromkeys(
                vg31.DEVELOPMENT_GATE_NAMES,
                trial.trial_id == champion.trial_id,
            ),
            "inference": {"lcb5Usdt": "1"},
            "paths": {"PUBLIC_STRESS": {"active_spells": 20, "net_usdt": "1"}},
        }
        for trial in vg31.trial_grid()
    }
    development = {
        "championTrialId": champion.trial_id,
        "qualifyingTrialIds": [champion.trial_id],
        "trialCount": 12,
        "trials": trial_rows,
    }
    calls = 0

    def fake_load(_months: object) -> dict[str, dict[date, vg31.Bar]]:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise vg31.VG31Error("SYNTHETIC_HOLDOUT_STOP")
        return {}

    monkeypatch.setattr(vg31, "load_bars", fake_load)
    monkeypatch.setattr(vg31, "evaluate_development", lambda _bars: (development, champion))

    vg31.run()

    result = json.loads(paths["RESULT_PATH"].read_text())
    assert result["verdict"] == "UNMEASURED"
    assert result["terminalPhase"] == "HOLDOUT_LOAD"
    assert result["holdout"] is None
    assert paths["CANDIDATE_SEAL_PATH"].is_file()
    assert paths["HOLDOUT_MARKER_PATH"].is_file()
    monkeypatch.setattr(vg31, "_validate_preoutcome_snapshot", lambda _value: None)
    vg31.verify_terminal_state(result)


def test_runtime_contract_requires_frozen_hash_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PYTHONHASHSEED", "0")
    vg31.assert_runtime_contract()
    monkeypatch.setenv("PYTHONHASHSEED", "1")
    with pytest.raises(vg31.VG31Error, match="PYTHONHASHSEED_MISMATCH"):
        vg31.assert_runtime_contract()


def test_write_once_rejects_changed_marker_bytes(tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    vg31.write_once_or_match(path, {"count": 1})
    vg31.write_once_or_match(path, {"count": 1})

    with pytest.raises(vg31.VG31Error, match="EXISTING_BYTES_DIFFER"):
        vg31.write_once_or_match(path, {"count": 2})


def test_one_use_marker_refuses_even_identical_bytes(tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    vg31.write_exclusive(path, {"count": 1})

    with pytest.raises(vg31.VG31Error, match="ONE_USE_STATE_ALREADY_EXISTS"):
        vg31.write_exclusive(path, {"count": 1})


def test_development_gates_cannot_be_rescued_by_pbo() -> None:
    source = inspect.getsource(vg31.development_gate_rows)

    assert "pbo" not in source.lower()
    assert set(vg31.development_gate_rows.__annotations__) >= {
        "stress",
        "inference",
        "holm_p",
        "white_p",
    }


def test_official_sources_are_exact_revision_pins() -> None:
    sources: Mapping[str, Any] = json.loads(vg31.OFFICIAL_SOURCES_PATH.read_text(encoding="utf-8"))
    repositories = sources["repositories"]

    assert len(repositories) == 2
    assert all(len(item["head"]) == 40 for item in repositories)
    assert all(
        len(document["sha256"]) == 64 for item in repositories for document in item["documents"]
    )
    assert sources["mutableObservations"][0]["contentImmutable"] is False


def test_lifecycle_state_paths_are_packet_local_and_coherent() -> None:
    assert vg31.STATE_ROOT == vg31.HERE
    assert all(
        path.parent == vg31.HERE
        for path in (
            vg31.RUN_MARKER_PATH,
            vg31.CANDIDATE_SEAL_PATH,
            vg31.HOLDOUT_MARKER_PATH,
            vg31.TERMINAL_CORE_PATH,
            vg31.RESULT_PATH,
        )
    )
    if not vg31.RESULT_PATH.exists():
        assert not vg31.RUN_MARKER_PATH.exists()
        assert not vg31.CANDIDATE_SEAL_PATH.exists()
        assert not vg31.HOLDOUT_MARKER_PATH.exists()
        assert not vg31.TERMINAL_CORE_PATH.exists()
        return
    result = json.loads(vg31.RESULT_PATH.read_text(encoding="utf-8"))
    assert vg31.RUN_MARKER_PATH.is_file()
    assert vg31.TERMINAL_CORE_PATH.is_file()
    development = result["development"]
    if development is None:
        assert result["verdict"] == "UNMEASURED"
        assert not vg31.CANDIDATE_SEAL_PATH.exists()
        assert not vg31.HOLDOUT_MARKER_PATH.exists()
        assert result["holdout"] is None
    elif development["championTrialId"] is None:
        assert not vg31.CANDIDATE_SEAL_PATH.exists()
        assert not vg31.HOLDOUT_MARKER_PATH.exists()
        assert result["holdout"] is None
    elif result["verdict"] == "UNMEASURED":
        assert result["terminalPhase"] in {
            "CANDIDATE_SEAL",
            "HOLDOUT_MARKER",
            "HOLDOUT_LOAD",
            "HOLDOUT_EVALUATION",
        }
        assert result["holdout"] is None
    else:
        assert vg31.CANDIDATE_SEAL_PATH.is_file()
        assert vg31.HOLDOUT_MARKER_PATH.is_file()
        assert isinstance(result["holdout"], dict)
