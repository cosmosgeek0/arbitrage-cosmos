from __future__ import annotations

import hashlib
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path

import experiment as s1m
import pytest


def kline(
    time_ms: int,
    *,
    price: str = "100",
    high: str = "101",
    low: str = "99",
    quote: str = "1000000",
) -> s1m.Kline:
    return s1m.Kline(
        open_time_ms=time_ms,
        open=Decimal(price),
        high=Decimal(high),
        low=Decimal(low),
        close=Decimal(price),
        quote_volume=Decimal(quote),
    )


def test_protocol_freezes_exact_family_and_holdout() -> None:
    protocol = json.loads(s1m.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert protocol["trials"]["count"] == 16
    assert protocol["statistics"]["bootstrapReplicates"] == 4096
    assert protocol["calendar"]["holdoutStartInclusive"] == "2026-04-08T00:00:00Z"
    assert protocol["calendar"]["holdoutEndExclusive"] == "2026-07-01T00:00:00Z"
    assert protocol["terminal"]["authority"] == "NONE"
    assert protocol["costs"]["accountEffectiveFees"] == "UNKNOWN"


def test_trial_ledger_is_complete_unique_cartesian_family() -> None:
    ledger = s1m.build_trial_ledger()
    assert ledger["count"] == 16
    ids = [row["trialId"] for row in ledger["trials"]]
    assert ids == sorted(ids)
    assert len(set(ids)) == 16
    assert {row["lookbackFundingObservations"] for row in ledger["trials"]} == {63, 126}


def write_archive(
    root: Path, *, member_name: str = "BTCUSDT-fundingRate-2025-06.csv"
) -> s1m.ArchiveRef:
    reference = s1m.archive_ref(root, "BTCUSDT", "fundingRate", "2025-06")
    reference.zip_path.parent.mkdir(parents=True)
    with zipfile.ZipFile(reference.zip_path, "w") as archive:
        archive.writestr(
            member_name,
            "calc_time,funding_interval_hours,last_funding_rate\n1748736000001,8,-0.00000582\n",
        )
    digest = hashlib.sha256(reference.zip_path.read_bytes()).hexdigest()
    reference.checksum_path.write_text(f"{digest}  {reference.zip_path.name}\n", encoding="ascii")
    return reference


def test_archive_requires_publisher_checksum_and_exact_schema(tmp_path: Path) -> None:
    reference = write_archive(tmp_path)
    metadata = s1m.verified_archive(reference)
    assert metadata["verifiedSha256"] == metadata["expectedSha256"]
    assert metadata["header"] == list(s1m.SCHEMA_FUNDING)
    rows = list(s1m.iter_csv_rows(reference))
    assert rows[0]["funding_interval_hours"] == "8"


def test_archive_tamper_fails_closed_before_csv_read(tmp_path: Path) -> None:
    reference = write_archive(tmp_path)
    reference.zip_path.write_bytes(reference.zip_path.read_bytes() + b"tamper")
    with pytest.raises(s1m.ExperimentError, match="CHECKSUM_MISMATCH"):
        list(s1m.iter_csv_rows(reference))


def test_zip_member_path_is_rejected(tmp_path: Path) -> None:
    reference = write_archive(tmp_path, member_name="nested/data.csv")
    with pytest.raises(s1m.ExperimentError, match="ZIP_MEMBER_PATH"):
        s1m.verified_archive(reference)


def test_feature_z_uses_only_preceding_accelerations() -> None:
    base = 1_700_000_000_000
    events: list[s1m.FundingEvent] = []
    for index in range(70):
        normalized_bp = Decimal("10") if index == 65 else Decimal("0")
        events.append(
            s1m.FundingEvent(
                symbol="BTCUSDT",
                time_ms=base + index * 8 * s1m.HOUR_MS,
                interval_hours=Decimal("8"),
                rate=normalized_bp / Decimal("10000"),
            )
        )
    first_hour = ((base // s1m.HOUR_MS) + 1) * s1m.HOUR_MS - 24 * s1m.HOUR_MS
    last_hour = ((events[-1].time_ms // s1m.HOUR_MS) + 2) * s1m.HOUR_MS
    bars = {hour: kline(hour) for hour in range(first_hour, last_hour + s1m.HOUR_MS, s1m.HOUR_MS)}
    data = s1m.MarketData(
        funding={"BTCUSDT": events},
        contract={"BTCUSDT": bars},
        mark={"BTCUSDT": {hour: Decimal("100") for hour in bars}},
        daily_quote_volume={"BTCUSDT": {}},
    )
    features = s1m.feature_map(data, [63])[63]["BTCUSDT"]
    shock = next(feature for feature in features if feature.event_index == 65)
    assert shock.z == pytest.approx(200.0)
    assert shock.normalized_rate_bp == pytest.approx(10.0)


def test_funding_cash_flow_sign_and_taker_cost_decomposition() -> None:
    quantity = Decimal("1")
    positive_funding_paid_by_long = -Decimal(1) * quantity * Decimal("1000") * Decimal("0.001")
    assert positive_funding_paid_by_long == Decimal("-1")
    net, parts = s1m.taker_economics(
        side=1,
        quantity=quantity,
        entry_price=Decimal("1000"),
        exit_price=Decimal("1010"),
        cash_flows=[(1, Decimal("1"))],
        scenario="base",
    )
    assert parts["feesUsd"] == Decimal("0.8040")
    assert parts["adverseExecutionUsd"] == Decimal("0.4020")
    assert net == Decimal("9.7940")


def test_stress_scales_favorable_and_adverse_funding_separately() -> None:
    flows = [(1, Decimal("2")), (2, Decimal("-3"))]
    assert s1m.adjusted_funding(flows, "base") == Decimal("-1")
    assert s1m.adjusted_funding(flows, "stress") == Decimal("-3.5")
    assert s1m.adjusted_funding(flows, "severe") == Decimal("-6")


def test_maker_requires_strict_trade_through() -> None:
    filled, value = s1m.maker_diagnostic(
        side=1,
        entry_reference=Decimal("100"),
        exit_price=Decimal("101"),
        entry_hour=kline(0, low="99.98"),
        cash_flow_events=[],
        mark={},
    )
    assert filled is True
    assert value is not None
    not_filled, no_value = s1m.maker_diagnostic(
        side=1,
        entry_reference=Decimal("100"),
        exit_price=Decimal("101"),
        entry_hour=kline(0, low="99.99"),
        cash_flow_events=[],
        mark={},
    )
    assert not_filled is False
    assert no_value is None


def test_capacity_uses_minimum_of_prior_day_and_seven_day_median() -> None:
    entry_day = 20 * s1m.DAY_MS
    volumes = {
        entry_day - offset * s1m.DAY_MS: Decimal(str(value))
        for offset, value in enumerate(
            [0, 20_000_000, 40_000_000, 40_000_000, 40_000_000, 40_000_000, 40_000_000, 40_000_000]
        )
        if offset > 0
    }
    result = s1m.capacity_proxy("BTCUSDT", entry_day + s1m.HOUR_MS, {"BTCUSDT": volumes})
    assert result == Decimal("1000")


def test_bootstrap_is_synchronous_deterministic_and_holm_rejects_positive_family() -> None:
    family = {f"trial-{index:02d}": [float(index + 1)] * 28 for index in range(16)}
    first = s1m.bootstrap_family(family, replicates=512, seed=17)
    second = s1m.bootstrap_family(family, replicates=512, seed=17)
    assert first == second
    assert all(row["holmRejected"] for row in first.values())
    assert all(float(row["familywiseLowerBound"]) > 0 for row in first.values())


def test_pbo_reports_no_overfit_when_order_is_stable_in_every_block() -> None:
    family = {f"trial-{index:02d}": [float(index)] * 264 for index in range(16)}
    result = s1m.pbo(family)
    assert result["splits"] == 924
    assert result["overfitEvents"] == 0
    assert result["pbo"] == "0.000000000000"


def test_hourly_drawdown_includes_unrealized_mark_loss_and_exit_reserve() -> None:
    trade = s1m.Trade(
        symbol="BTCUSDT",
        side=1,
        signal_time_ms=0,
        entry_time_ms=0,
        exit_signal_time_ms=2 * s1m.HOUR_MS - 1,
        exit_time_ms=2 * s1m.HOUR_MS,
        entry_price=Decimal("100"),
        exit_price=Decimal("90"),
        quantity=Decimal("10"),
        funding_cash_flows=(),
        capacity_proxy_usd=Decimal("10000"),
        base_net=Decimal("-101.14"),
        stress_net=Decimal("-102.47"),
        severe_net=Decimal("-103.8"),
        base_decomposition={},
        stress_decomposition={},
        severe_decomposition={},
        maker_filled=False,
        maker_net=None,
    )
    data = s1m.MarketData(
        funding={"BTCUSDT": []},
        contract={"BTCUSDT": {}},
        mark={"BTCUSDT": {0: Decimal("100"), s1m.HOUR_MS: Decimal("80")}},
        daily_quote_volume={"BTCUSDT": {}},
    )
    amount, fraction = s1m.drawdown([trade], data, "base")
    assert amount > Decimal("200")
    assert fraction > Decimal("0.20")


def test_empty_sample_cannot_pass_capacity_or_admission() -> None:
    summary = {
        "completedTrades": 0,
        "activeWeeks": 0,
        "symbols": 0,
        "longTrades": 0,
        "shortTrades": 0,
        "baseNetUsdPerOriginal1000": "0",
        "stressNetUsdPerOriginal1000": "0",
        "removeBestSymbolStressNetUsd": "0",
        "removeBestMonthStressNetUsd": "0",
        "stressDrawdownFraction": "0",
        "capacity": {"everyTradePasses1000": False},
        "_baseNet": Decimal("0"),
        "_stressNet": Decimal("0"),
        "_removeBestSymbolStress": Decimal("0"),
        "_removeBestMonthStress": Decimal("0"),
        "_stressDrawdownFraction": Decimal("0"),
    }
    multiplicity = {
        "familywiseLowerBound": "0",
        "_familywiseLowerBound": 0.0,
        "holmRejected": False,
    }
    gates = s1m.development_gates(summary, multiplicity)
    assert not all(gates.values())
    assert gates["capacityProxyPass"] is False
    assert gates["minimumCompletedTakerTrades"] is False


def test_atomic_exclusive_marker_refuses_second_write(tmp_path: Path) -> None:
    marker = tmp_path / "RUN_CONSUMED.v1.json"
    s1m.write_json(marker, {"state": "CONSUMED"}, exclusive=True)
    with pytest.raises(s1m.ExperimentError, match="ONE_RUN_ARTIFACT_EXISTS"):
        s1m.write_json(marker, {"state": "SECOND"}, exclusive=True)
    assert json.loads(marker.read_text())["state"] == "CONSUMED"


def test_atomic_exclusive_marker_has_exactly_one_concurrent_winner(tmp_path: Path) -> None:
    marker = tmp_path / "HOLDOUT_OPEN.v1.json"

    def attempt(index: int) -> bool:
        try:
            s1m.write_json(marker, {"winner": index}, exclusive=True)
        except s1m.ExperimentError:
            return False
        return True

    with ThreadPoolExecutor(max_workers=8) as executor:
        outcomes = list(executor.map(attempt, range(8)))
    assert sum(outcomes) == 1
    assert json.loads(marker.read_text())["winner"] in range(8)


def test_month_boundary_validation_rejects_truncated_hourly_tail() -> None:
    first, last = s1m.month_hour_bounds("2025-06")
    rows = [kline(first), kline(last - s1m.HOUR_MS)]
    with pytest.raises(s1m.ExperimentError, match="MONTH_BOUNDARY_GAP"):
        s1m.validate_month_hours("BTCUSDT", "contract", "2025-06", rows)


def test_distinctness_names_every_prior_family() -> None:
    protocol = json.loads(s1m.PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert set(protocol["distinctness"]) == {
        "S-1C",
        "S-1D",
        "S-1G",
        "S-1H",
        "S-1I",
        "S-1J",
        "S-1K",
        "S-1L",
    }
