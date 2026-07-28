from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Any, cast

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "quant" / "scripts" / "s1b_spot_trend_discovery.py"
PLAN_PATH = REPO_ROOT / "quant" / "fixtures" / "s1b_spot_trend_plan_v1.json"


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("s1b_spot_trend_discovery", SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


S1B = load_module()
D = Decimal


def plan() -> dict[str, Any]:
    value, _ = S1B.load_plan(PLAN_PATH)
    return cast(dict[str, Any], value)


def bars(
    *,
    first: date,
    count: int,
    start_price: str,
    daily_step: str,
    quote_volume: str = "1000000000",
) -> list[Any]:
    price = D(start_price)
    step = D(daily_step)
    result = []
    for offset in range(count):
        current = price + step * offset
        result.append(
            S1B.Bar(
                first + timedelta(days=offset),
                current,
                current,
                current,
                current,
                D(quote_volume),
                100,
            )
        )
    return result


def test_frozen_plan_is_single_untuned_import_and_rejects_horizon_mutation(
    tmp_path: Path,
) -> None:
    loaded, digest = S1B.load_plan(PLAN_PATH)
    assert digest == hashlib.sha256(PLAN_PATH.read_bytes()).hexdigest()
    assert loaded["strategy"]["selection"]["attemptedHypotheses"] == 1
    assert loaded["strategy"]["selection"]["parameterSearch"] == "NONE"
    assert [item["pmaCalendarDays"] for item in loaded["strategy"]["sleeves"]] == [
        7,
        14,
        28,
        70,
        140,
    ]

    tampered = copy.deepcopy(loaded)
    tampered["strategy"]["sleeves"][0]["pmaCalendarDays"] = 6
    tampered_path = tmp_path / "tampered.json"
    tampered_path.write_text(json.dumps(tampered))
    with pytest.raises(S1B.EvidenceError, match="horizons changed"):
        S1B.load_plan(tampered_path)


def test_discover_cli_has_no_validation_input() -> None:
    parser = S1B.build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(
            [
                "discover",
                "--plan",
                str(PLAN_PATH),
                "--research-root",
                "/tmp/research",
                "--output",
                "/tmp/candidate",
                "--validation-root",
                "/tmp/holdout",
            ]
        )


def test_validation_acquisition_stops_before_network_without_candidate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    network_called = False

    def unexpected_network(_: str) -> bytes:
        nonlocal network_called
        network_called = True
        raise AssertionError("network must remain unopened")

    monkeypatch.setattr(S1B, "download", unexpected_network)
    with pytest.raises(S1B.EvidenceError, match="requires candidate and external authorization"):
        S1B.acquire(PLAN_PATH, "validation", tmp_path / "holdout", None, None)
    assert network_called is False


def test_validation_grant_is_atomic_and_one_shot(tmp_path: Path) -> None:
    grant = {
        "schema": "S1BValidationGrantV1",
        "state": "SEALED_UNOPENED",
        "candidateSha256": "a" * 64,
        "authorizationSha256": "d" * 64,
        "manifestSha256": "b" * 64,
        "planSha256": "c" * 64,
        "scriptSha256": S1B.script_sha(),
        "allowedOpenCount": 1,
        "grantId": "s1b-pma-v1-20260728",
    }
    (tmp_path / ".validation-grant.json").write_bytes(S1B.canonical_bytes(grant))
    S1B.consume_validation_grant(
        tmp_path,
        candidate_sha="a" * 64,
        authorization_sha="d" * 64,
        manifest_sha="b" * 64,
        plan_sha="c" * 64,
        grant_id="s1b-pma-v1-20260728",
    )
    opened = json.loads((tmp_path / ".validation-opened.json").read_text())
    assert opened["state"] == "CONSUMED_OPENED"
    assert opened["actualOpenCount"] == 1
    with pytest.raises(S1B.EvidenceError, match="already exists"):
        S1B.consume_validation_grant(
            tmp_path,
            candidate_sha="a" * 64,
            authorization_sha="d" * 64,
            manifest_sha="b" * 64,
            plan_sha="c" * 64,
            grant_id="s1b-pma-v1-20260728",
        )


def test_external_authorization_binds_exact_candidate_digest(tmp_path: Path) -> None:
    frozen_plan, plan_sha = S1B.load_plan(PLAN_PATH)
    candidate = {
        "candidateId": frozen_plan["strategy"]["candidateId"],
        "researchManifestSha256": "e" * 64,
    }
    authorization = {
        "schema": "S1BSpotTrendAuthorizationV1",
        "state": "FROZEN_BEFORE_VALIDATION_ACQUISITION",
        "grantId": frozen_plan["holdoutControl"]["grantId"],
        "candidateId": candidate["candidateId"],
        "candidateSha256": "a" * 64,
        "planSha256": plan_sha,
        "scriptSha256": S1B.script_sha(),
        "researchManifestSha256": "e" * 64,
        "authorizedValidationOpenCount": 1,
    }
    path = tmp_path / "authorization.json"
    path.write_bytes(S1B.canonical_bytes(authorization))
    _, digest = S1B.verify_authorization(
        path,
        candidate=candidate,
        candidate_sha="a" * 64,
        plan=frozen_plan,
        plan_sha=plan_sha,
    )
    assert digest == hashlib.sha256(path.read_bytes()).hexdigest()
    with pytest.raises(S1B.EvidenceError, match="authorization digest"):
        S1B.verify_authorization(
            path,
            candidate=candidate,
            candidate_sha="f" * 64,
            plan=frozen_plan,
            plan_sha=plan_sha,
        )


def test_output_reservation_fails_before_holdout_open(tmp_path: Path) -> None:
    output = tmp_path / "evidence.json"
    S1B.reserve_output(output)
    with pytest.raises(S1B.EvidenceError, match="already exists"):
        S1B.reserve_output(output)


def test_checksum_contract_detects_tampering() -> None:
    archive = b"official archive bytes"
    digest = hashlib.sha256(archive).hexdigest()
    checksum = f"{digest}  BTCUSDT-1d-2024-01.zip\n".encode()
    assert S1B.verify_checksum_text(checksum, "BTCUSDT-1d-2024-01.zip", archive) == digest
    with pytest.raises(S1B.EvidenceError, match="checksum mismatch"):
        S1B.verify_checksum_text(
            checksum,
            "BTCUSDT-1d-2024-01.zip",
            b"mutated archive bytes",
        )


def test_microsecond_transition_and_daily_geometry_are_normalized() -> None:
    day = date(2025, 1, 1)
    timestamp_us = int(
        S1B.datetime(day.year, day.month, day.day, tzinfo=S1B.UTC).timestamp() * 1_000_000
    )
    row = [
        str(timestamp_us),
        "100",
        "110",
        "90",
        "105",
        "1",
        str(timestamp_us + 86_399_999_999),
        "1000000",
        "10",
        "0.5",
        "500000",
        "0",
    ]
    parsed = S1B.parse_bar(row, "2025-01")
    assert parsed.day == day
    assert parsed.close == D("105")
    bad = list(row)
    bad[3] = "106"
    with pytest.raises(S1B.EvidenceError, match="geometry"):
        S1B.parse_bar(bad, "2025-01")


def test_no_signal_is_flat_zero_cost_and_zero_drawdown() -> None:
    history = bars(first=date(2023, 1, 1), count=140, start_price="100", daily_step="0")
    evaluation = bars(
        first=history[-1].day + timedelta(days=1),
        count=14,
        start_price="100",
        daily_step="0",
    )
    result = S1B.simulate(
        plan(),
        history,
        evaluation,
        adverse_execution_bps=D("10"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    assert result["economics"]["periodNetUsdPer1k"] == "0"
    assert result["economics"]["totalModeledCostUsd"] == "0"
    assert result["drawdown"]["dailyCloseMaxPct"] == "0"
    assert result["sample"]["stateChangingFills"] == 0


def test_constant_price_round_trip_loses_fees_and_wedge_and_stress_is_monotone() -> None:
    history = bars(first=date(2023, 1, 1), count=140, start_price="86.1", daily_step="0.1")
    evaluation = bars(
        first=history[-1].day + timedelta(days=1),
        count=1,
        start_price="100",
        daily_step="0",
    )
    base = S1B.simulate(
        plan(),
        history,
        evaluation,
        adverse_execution_bps=D("10"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    stress = S1B.simulate(
        plan(),
        history,
        evaluation,
        adverse_execution_bps=D("20"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    expected_no_rounding = D("1000") * (D("1") - D("0.001")) ** 2 * D("0.999") / D("1.001")
    assert D(base["economics"]["finalEquityUsd"]) <= expected_no_rounding
    assert D(base["economics"]["finalEquityUsd"]) >= expected_no_rounding - D("0.01")
    assert D(stress["economics"]["periodNetUsdPer1k"]) < D(base["economics"]["periodNetUsdPer1k"])
    assert base["sample"]["entries"] == 5
    assert base["sample"]["completedExits"] == 5
    assert base["sample"]["stateChangingFills"] == 10
    assert base["sample"]["nonTerminalTransitionDays"] == 1
    assert base["sample"]["distinctOrganicExitDays"] == 0
    assert base["sample"]["terminalFills"] == 5
    assert base["capacity"]["passed"] is True
    assert D("1000") - D(base["economics"]["finalEquityUsd"]) == pytest.approx(
        D(base["economics"]["totalModeledCostUsd"]),
        abs=D("0.00000000000000000001"),
    )


def test_higher_fee_cannot_improve_identical_strategy() -> None:
    history = bars(first=date(2023, 1, 1), count=140, start_price="86.1", daily_step="0.1")
    evaluation = bars(
        first=history[-1].day + timedelta(days=1),
        count=7,
        start_price="100",
        daily_step="0",
    )
    regular = plan()
    expensive = copy.deepcopy(regular)
    expensive["costs"]["regularSpotFeeBpsPerFill"] = "20"
    regular_result = S1B.simulate(
        regular,
        history,
        evaluation,
        adverse_execution_bps=D("10"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    expensive_result = S1B.simulate(
        expensive,
        history,
        evaluation,
        adverse_execution_bps=D("10"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    assert D(expensive_result["economics"]["finalEquityUsd"]) < D(
        regular_result["economics"]["finalEquityUsd"]
    )


def test_drawdown_and_circular_bootstrap_contracts_are_deterministic() -> None:
    peak = D("1000")
    peak_time = "t0"
    maximum = D("0")
    maximum_usd = D("0")
    trough = "t0"
    for timestamp, equity in (("t1", D("1100")), ("t2", D("880")), ("t3", D("900"))):
        peak, peak_time, maximum, maximum_usd, max_peak_time, trough = S1B.update_drawdown(
            equity,
            timestamp,
            peak=peak,
            peak_timestamp=peak_time,
            maximum=maximum,
            maximum_usd=maximum_usd,
            maximum_peak_timestamp=peak_time,
            trough_timestamp=trough,
        )
    assert maximum == D("0.2")
    assert maximum_usd == D("220")
    assert max_peak_time == "t1"
    assert trough == "t2"

    values = [D("0.001")] * 84
    first = S1B.circular_block_interval(values, block_length=7, replicates=64, seed=1234)
    second = S1B.circular_block_interval(values, block_length=7, replicates=64, seed=1234)
    assert first == second
    assert first["pointMeanDailyUsdPer1k"] == "1"
    assert first["lowerMeanDailyUsdPer1k"] == "1"
    with pytest.raises(S1B.EvidenceError, match="insufficient independent blocks"):
        S1B.circular_block_interval(
            [D("0.001")] * 83,
            block_length=7,
            replicates=64,
            seed=1234,
        )


def test_capacity_uses_only_prior_complete_volume_and_fails_closed() -> None:
    history = bars(
        first=date(2023, 1, 1),
        count=140,
        start_price="86.1",
        daily_step="0.1",
        quote_volume="1000000",
    )
    evaluation = bars(
        first=history[-1].day + timedelta(days=1),
        count=7,
        start_price="100",
        daily_step="0",
        quote_volume="999999999999",
    )
    result = S1B.simulate(
        plan(),
        history,
        evaluation,
        adverse_execution_bps=D("10"),
        capacity_bps=D("0.5"),
        include_uncertainty=False,
    )
    assert result["capacity"]["passed"] is False
    assert D(result["capacity"]["maxAggregateParticipationBps"]) > D("0.5")


def test_future_bar_does_not_change_first_open_signal() -> None:
    history = bars(first=date(2023, 1, 1), count=140, start_price="86.1", daily_step="0.1")
    first_day = history[-1].day + timedelta(days=1)
    low_future = bars(first=first_day, count=2, start_price="100", daily_step="-50")
    high_future = bars(first=first_day, count=2, start_price="100", daily_step="500")
    low_result = S1B.simulate(
        plan(),
        history,
        low_future,
        adverse_execution_bps=D("10"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    high_result = S1B.simulate(
        plan(),
        history,
        high_future,
        adverse_execution_bps=D("10"),
        capacity_bps=D("1"),
        include_uncertainty=False,
    )
    assert low_result["sample"]["entries"] >= 5
    assert high_result["sample"]["entries"] >= 5
