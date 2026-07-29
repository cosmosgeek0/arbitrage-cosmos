"""Focused hostile contract tests for the sealed V-G29 evaluator."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg29 import experiment


def _bar(
    day: date,
    *,
    open_price: Decimal = Decimal("100"),
    close_price: Decimal = Decimal("100"),
    quote_volume: Decimal = Decimal("1000000000"),
    range_fraction: Decimal = Decimal("0.01"),
) -> experiment.Bar:
    return experiment.Bar(
        day=day,
        open_price=open_price,
        high_price=max(open_price, close_price) * (Decimal(1) + range_fraction),
        low_price=min(open_price, close_price) * (Decimal(1) - range_fraction),
        close_price=close_price,
        quote_volume=quote_volume,
    )


def _simulation(
    trial: experiment.Trial,
    weekly_returns: tuple[Decimal, ...],
) -> experiment.Simulation:
    return experiment.Simulation(
        trial=trial,
        adverse_bps_per_fill=25,
        weekly_returns=weekly_returns,
        final_net_usd_per_1000=experiment.compounded_net_usd_per_1000(weekly_returns),
        active_weeks=len(weekly_returns),
        round_trips=len(weekly_returns) * 10,
        distinct_assets=experiment.symbols(),
        maximum_close_mark_drawdown=Decimal("0.10"),
        minimum_capacity_headroom=Decimal("2"),
        minimum_stress_capacity_headroom=Decimal("1.5"),
        regime_breadths=tuple(Decimal("1") for _ in weekly_returns),
    )


def test_protocol_closes_exact_family_and_full_cohort() -> None:
    values = experiment.trials()
    assert len(values) == 8
    assert len({value.trial_id for value in values}) == 8
    assert len(experiment.symbols()) == 10
    assert experiment.symbols() == tuple(sorted(experiment.symbols()))
    protocol = experiment.protocol()
    bootstrap = experiment.require_mapping(protocol["bootstrap"], "bootstrap")
    multiplicity = experiment.require_mapping(protocol["multiplicity"], "multiplicity")
    replicates = experiment.require_int(bootstrap["replicates"], "replicates")
    external_factor = experiment.require_int(
        multiplicity["externalNamedVGAttemptFactor"], "externalFactor"
    )
    minimum_external_p = Decimal(len(values) * external_factor) / Decimal(replicates + 1)
    assert minimum_external_p < Decimal("0.05")


def test_checksum_sidecar_requires_exact_digest_and_filename() -> None:
    digest = "a" * 64
    experiment.verify_sidecar(
        f"{digest}  BTCUSDT-1d-2024-01.zip\n".encode(),
        "BTCUSDT-1d-2024-01.zip",
        digest,
    )
    with pytest.raises(experiment.ContractError, match="digest mismatch"):
        experiment.verify_sidecar(
            f"{'b' * 64}  BTCUSDT-1d-2024-01.zip\n".encode(),
            "BTCUSDT-1d-2024-01.zip",
            digest,
        )
    with pytest.raises(experiment.ContractError, match="filename mismatch"):
        experiment.verify_sidecar(
            f"{digest}  ETHUSDT-1d-2024-01.zip\n".encode(),
            "BTCUSDT-1d-2024-01.zip",
            digest,
        )


def test_timestamp_unit_switch_is_exact() -> None:
    old_day = date(2024, 12, 31)
    old_open_ms = int(datetime(2024, 12, 31, tzinfo=UTC).timestamp() * 1000)
    old_close_ms = int(datetime(2025, 1, 1, tzinfo=UTC).timestamp() * 1000) - 1
    assert experiment._timestamp_to_day(str(old_open_ms), str(old_close_ms), "2024-12") == old_day

    new_day = date(2025, 1, 1)
    new_open_us = int(datetime(2025, 1, 1, tzinfo=UTC).timestamp() * 1_000_000)
    new_close_us = int(datetime(2025, 1, 2, tzinfo=UTC).timestamp() * 1_000_000) - 1
    assert experiment._timestamp_to_day(str(new_open_us), str(new_close_us), "2025-01") == new_day
    with pytest.raises(experiment.MeasurementError, match="unit mismatch"):
        experiment._timestamp_to_day(str(new_open_us // 1000), str(new_close_us // 1000), "2025-01")


def test_elasticity_break_is_invariant_to_future_mutation() -> None:
    start = date(2024, 1, 1)
    bars: dict[date, experiment.Bar] = {}
    for offset in range(220):
        day = start + timedelta(days=offset)
        fraction = Decimal((offset % 13) + 1) / Decimal(1000)
        volume = Decimal(1_000_000 + ((offset * 7919) % 250_000))
        bars[day] = _bar(day, quote_volume=volume, range_fraction=fraction)
    cutoff = start + timedelta(days=199)
    original = experiment.elasticity_break(bars, cutoff, 14, 84)
    future = cutoff + timedelta(days=1)
    mutated = dict(bars)
    mutated[future] = _bar(
        future,
        quote_volume=Decimal("999999999999999"),
        range_fraction=Decimal("0.40"),
    )
    assert experiment.elasticity_break(mutated, cutoff, 14, 84) == original


def test_simulation_cost_arithmetic_and_full_cohort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start = date(2024, 1, 1)
    bars: dict[str, dict[date, experiment.Bar]] = {}
    for symbol in experiment.symbols():
        bars[symbol] = {
            start + timedelta(days=offset): _bar(start + timedelta(days=offset))
            for offset in range(240)
        }

    def positive_break(
        _bars: object,
        _cutoff: date,
        _short_days: int,
        _baseline_days: int,
    ) -> Decimal:
        return Decimal(1)

    monkeypatch.setattr(experiment, "elasticity_break", positive_break)
    trial = experiment.Trial(14, 84, Decimal("0.60"))
    entry = date(2024, 7, 15)
    measured = experiment.simulate(trial, bars, entry, entry, 10)
    fee = Decimal("0.001")
    adverse = Decimal("0.001")
    expected_equity = (
        Decimal(1000)
        * (Decimal(1) - fee)
        * (Decimal(1) - adverse)
        * (Decimal(1) - fee)
        / (Decimal(1) + adverse)
    )
    assert abs(measured.final_net_usd_per_1000 - (expected_equity - Decimal(1000))) < Decimal(
        "1e-40"
    )
    assert measured.active_weeks == 1
    assert measured.round_trips == 10
    assert measured.distinct_assets == experiment.symbols()

    bars[experiment.symbols()[0]].pop(entry + timedelta(days=7))
    with pytest.raises(experiment.MeasurementError, match="entry or exit"):
        experiment.simulate(trial, bars, entry, entry, 10)


def test_circular_bootstrap_and_interval_are_reproducible() -> None:
    first = experiment.circular_block_indices(11, 4, experiment.SplitMix64(29))
    second = experiment.circular_block_indices(11, 4, experiment.SplitMix64(29))
    assert first == second
    assert len(first) == 11
    assert all(0 <= value < 11 for value in first)
    path = tuple(Decimal("0.01") if index % 2 == 0 else Decimal("-0.004") for index in range(20))
    interval_one = experiment.bootstrap_interval(
        path, replicates=64, block_length=4, seed=29, label="test"
    )
    interval_two = experiment.bootstrap_interval(
        path, replicates=64, block_length=4, seed=29, label="test"
    )
    assert interval_one == interval_two
    assert (
        interval_one.lower_net_usd_per_1000
        <= interval_one.point_net_usd_per_1000
        <= interval_one.upper_net_usd_per_1000
    )


def test_holm_adjustment_is_monotone_and_bounded() -> None:
    adjusted = experiment.holm_adjust(
        {
            "a": Decimal("0.001"),
            "b": Decimal("0.02"),
            "c": Decimal("0.04"),
            "d": Decimal("0.50"),
        }
    )
    assert adjusted == {
        "a": Decimal("0.004"),
        "b": Decimal("0.06"),
        "c": Decimal("0.08"),
        "d": Decimal("0.50"),
    }


def test_pbo_enumerates_all_symmetric_splits_deterministically() -> None:
    family: dict[str, experiment.Simulation] = {}
    for trial_index, trial in enumerate(experiment.trials()):
        path = tuple(
            Decimal(trial_index - 3) / Decimal(1000)
            + (Decimal("0.002") if (week + trial_index) % 3 == 0 else Decimal("-0.001"))
            for week in range(48)
        )
        family[trial.trial_id] = _simulation(trial, path)
    first = experiment.probability_of_backtest_overfitting(family)
    second = experiment.probability_of_backtest_overfitting(family)
    assert first == second
    assert first[1] == 70
    assert Decimal(0) <= first[0] <= Decimal(1)


def test_atomic_write_once_denies_second_run_marker(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    experiment.write_json_once(marker, {"state": "CONSUMED"})
    with pytest.raises(FileExistsError):
        experiment.write_json_once(marker, {"state": "SECOND_RUN"})


def test_holdout_open_denied_when_development_gates_fail(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    champion_path = tmp_path / "champion.json"
    holdout_path = tmp_path / "holdout.json"
    monkeypatch.setattr(experiment, "CHAMPION_SEAL_PATH", champion_path)
    monkeypatch.setattr(experiment, "HOLDOUT_OPEN_PATH", holdout_path)
    with pytest.raises(experiment.ContractError, match="gate failure"):
        experiment._open_holdout(
            "f" * 40,
            experiment.trials()[0].trial_id,
            {"allGatesPass": False},
        )
    assert not champion_path.exists()
    assert not holdout_path.exists()


def test_gate_evidence_rejects_contradictory_pass_flag() -> None:
    with pytest.raises(experiment.ContractError, match="contradicts"):
        experiment._validate_gate_partition(
            {
                "gateFailures": ["STRESS_NET_NOT_POSITIVE"],
                "allGatesPass": True,
                "champion": {"trialId": experiment.trials()[0].trial_id},
            },
            "holdout",
        )


def test_unavailable_execution_truth_never_becomes_numeric_zero() -> None:
    truth = experiment._result_truth("NO_GO")
    assert truth["accountEffectiveFee"] == "UNKNOWN"
    assert truth["accountExecutableProfitability"] == "UNKNOWN"
    assert truth["executableCapacity"] == "UNMEASURED"
    assert all(value != 0 for value in truth.values())
