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
PROTOCOL_PATH = Path(__file__).with_name("protocol.v1.json")


@pytest.fixture(scope="module")
def subject() -> ModuleType:
    spec = importlib.util.spec_from_file_location("s1q_experiment_under_test", SUBJECT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def protocol() -> dict[str, Any]:
    value = json.loads(PROTOCOL_PATH.read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return value


def test_protocol_freezes_two_stage_seal_and_unknown_authority(
    subject: ModuleType, protocol: dict[str, Any]
) -> None:
    sealing = protocol["sealing"]
    authority = protocol["official_source_freeze"]

    assert protocol["schema"] == "cosmos.s1q.protocol.v1"
    assert "preseal.v1.json" in sealing["preseal"]
    assert "June 2025" in sealing["june_screen_rule"]
    assert "freeze.v1.json" in sealing["final_freeze"]
    assert "July 2025 through March 2026" in sealing["run_marker_created_before"]
    assert authority["publication_causality"] == "UNKNOWN"
    assert authority["archive_rate_type"] == "UNKNOWN"
    assert authority["account_effective_commission"] == "UNKNOWN"
    assert authority["go_structurally_reachable"] is False
    assert (
        subject.sha256_path(subject.PACKET_DIR / "OFFICIAL_SOURCE_RESEARCH.md")
        == authority["sha256"]
        == subject.SOURCE_NOTE_SHA256
    )


def test_protocol_freezes_materially_distinct_event_family(
    protocol: dict[str, Any],
) -> None:
    distinctness = protocol["distinctness"]
    event = protocol["event"]

    assert distinctness["family"].startswith("CROSS_SECTIONAL_PAIRED")
    assert "funding-level rank" in distinctness["not_s1n"]
    assert "same-sign persistence" in distinctness["not_s1o"]
    assert "volume lead" in distinctness["not_s1p"]
    assert "acceleration" in distinctness["not_s1m"]
    assert event["transition"] == {
        "negative_to_positive": "SHORT",
        "positive_to_negative": "LONG",
    }
    assert "at least two long and two short" in event["cross_section"]
    assert event["event_funding"] == "Not booked."


def test_trial_family_is_exact_and_primary_predeclared(subject: ModuleType) -> None:
    trials = subject.trial_family()

    assert len(trials) == 12
    assert len({trial.trial_id for trial in trials}) == 12
    assert [trial.trial_id for trial in trials if trial.primary] == ["shock_1bps_hold_3h"]
    assert subject.primary_trial().trial_id == "shock_1bps_hold_3h"


@pytest.mark.parametrize(
    ("symbol", "expected"),
    [
        ("BTCUSDT", True),
        ("1000PEPEUSDT", True),
        ("USDCUSDT", False),
        ("BTCDOWNUSDT", False),
        ("BTCUSDC", False),
        ("btcusdt", False),
    ],
)
def test_symbol_candidate_is_historical_key_based(
    subject: ModuleType, symbol: str, expected: bool
) -> None:
    assert subject.is_symbol_candidate(symbol) is expected


def test_checksum_sidecar_is_exactly_filename_bound(subject: ModuleType) -> None:
    digest = "a1" * 32

    assert (
        subject.parse_checksum_sidecar(
            f"{digest}  BTCUSDT-1h-2025-06.zip\n".encode(),
            "BTCUSDT-1h-2025-06.zip",
        )
        == digest
    )
    with pytest.raises(subject.CustodyError):
        subject.parse_checksum_sidecar(f"{digest}  OTHER.zip\n".encode(), "BTCUSDT-1h-2025-06.zip")


def test_holdout_publisher_record_defers_zip_payload_read(
    subject: ModuleType, tmp_path: Path
) -> None:
    zip_path = subject.archive_path(tmp_path, "fundingRate", "BTCUSDT", "2026-04")
    zip_path.parent.mkdir(parents=True)
    zip_path.write_bytes(b"not a zip and intentionally not hash verified")
    declared = "b2" * 32
    zip_path.with_name(zip_path.name + ".CHECKSUM").write_text(
        f"{declared}  {zip_path.name}\n", encoding="ascii"
    )

    record = subject.publisher_record(
        tmp_path,
        "fundingRate",
        "BTCUSDT",
        "2026-04",
        verify_zip_payload=False,
    )

    assert record["publisher_sha256"] == declared
    assert record["zip_sha256"] is None
    assert record["zip_verification"] == "DEFERRED_UNTOUCHED"
    with pytest.raises(subject.CustodyError, match="checksum mismatch"):
        subject.publisher_record(
            tmp_path,
            "fundingRate",
            "BTCUSDT",
            "2026-04",
            verify_zip_payload=True,
        )


def _write_zip(path: Path, member: str, body: str) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(member, body)


def test_funding_parser_enforces_header_order_and_monotonicity(
    subject: ModuleType, tmp_path: Path
) -> None:
    valid = tmp_path / "BTCUSDT-fundingRate-2025-06.zip"
    _write_zip(
        valid,
        "BTCUSDT-fundingRate-2025-06.csv",
        "calc_time,funding_interval_hours,last_funding_rate\n"
        "1748736000000,8,0.0001\n"
        "1748764800000,8,-0.0002\n",
    )

    rows = subject.read_funding_archive(valid, "2025-06")

    assert [row.rate for row in rows] == [Decimal("0.0001"), Decimal("-0.0002")]

    invalid = tmp_path / "invalid.zip"
    _write_zip(
        invalid,
        "invalid.csv",
        "calc_time,funding_interval_hours,last_funding_rate\n"
        "1748764800000,8,0.0001\n"
        "1748736000000,8,-0.0002\n",
    )
    with pytest.raises(subject.CustodyError, match="out-of-order"):
        subject.read_funding_archive(invalid, "2025-06")


def test_kline_parser_enforces_hourly_schema(subject: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "BTCUSDT-1h-2025-06.zip"
    _write_zip(
        path,
        "BTCUSDT-1h-2025-06.csv",
        "open_time,open,high,low,close,volume,close_time,quote_volume,count,"
        "taker_buy_volume,taker_buy_quote_volume,ignore\n"
        "1748736000000,100,101,99,100.5,2,1748739599999,200,3,1,100,0\n",
    )

    rows = subject.read_kline_archive(path, "2025-06")

    assert rows[0].open_price == Decimal("100")
    assert rows[0].quote_volume == Decimal("200")


def _market(subject: ModuleType) -> Any:
    hour = subject.HOUR_MS
    event = subject.DEV_START_MS + 8 * hour
    funding: dict[str, tuple[Any, ...]] = {}
    contract: dict[str, dict[int, Any]] = {}
    mark: dict[str, dict[int, Any]] = {}
    daily_quote: dict[str, dict[int, Decimal]] = {}
    rates = {
        "LONG1USDT": (Decimal("0.0001"), Decimal("-0.0001")),
        "LONG2USDT": (Decimal("0.0002"), Decimal("-0.0002")),
        "SHORT1USDT": (Decimal("-0.0001"), Decimal("0.0001")),
        "SHORT2USDT": (Decimal("-0.0002"), Decimal("0.0002")),
    }
    for symbol, pair in rates.items():
        funding[symbol] = (
            subject.FundingRow(event - 8 * hour, 8, pair[0]),
            subject.FundingRow(event, 8, pair[1]),
        )
        contract[symbol] = {
            event + hour: subject.KlineRow(
                event + hour, Decimal("100"), event + 2 * hour - 1, Decimal("1000000")
            ),
            event + 2 * hour: subject.KlineRow(
                event + 2 * hour, Decimal("101"), event + 3 * hour - 1, Decimal("1000000")
            ),
            event + 4 * hour: subject.KlineRow(
                event + 4 * hour, Decimal("101"), event + 5 * hour - 1, Decimal("1000000")
            ),
            event + 7 * hour: subject.KlineRow(
                event + 7 * hour, Decimal("101"), event + 8 * hour - 1, Decimal("1000000")
            ),
        }
        mark[symbol] = {}
        prior_day = subject.day_start_ms(event + hour) - subject.DAY_MS
        daily_quote[symbol] = {prior_day: Decimal("10000000")}
    return subject.MarketData(funding, contract, mark, daily_quote, frozenset())


def test_flips_require_adjacent_equal_cadence_nonzero_rows(subject: ModuleType) -> None:
    market = _market(subject)
    flips = subject.funding_flips(market, subject.DEV_START_MS, subject.DEV_END_MS)
    values = next(iter(flips.values()))

    assert len(values) == 4
    assert {item.side for item in values} == {-1, 1}

    symbol = "LONG1USDT"
    previous, current = market.funding[symbol]
    market.funding[symbol] = (
        previous,
        subject.FundingRow(current.time_ms, 4, current.rate),
    )
    changed = subject.funding_flips(market, subject.DEV_START_MS, subject.DEV_END_MS)
    assert all(item.symbol != symbol for group in changed.values() for item in group)


def test_missing_funding_cell_invalidates_the_complete_month(
    subject: ModuleType,
) -> None:
    market = _market(subject)
    event = next(iter(subject.funding_flips(market, subject.DEV_START_MS, subject.DEV_END_MS)))
    month = subject.datetime.fromtimestamp(event / 1000, tz=subject.UTC).strftime("%Y-%m")
    market.unmeasured_funding_months = frozenset({month})

    flips = subject.funding_flips(market, subject.DEV_START_MS, subject.DEV_END_MS)

    assert flips == {}


def test_missing_inventory_cell_is_explicit_and_not_substituted(
    subject: ModuleType, tmp_path: Path
) -> None:
    record = subject.inventory_record(
        tmp_path,
        "fundingRate",
        "FUNUSDT",
        "2026-05",
        verify_zip_payload=False,
    )

    assert record["availability"] == "UNAVAILABLE"
    assert record["symbol"] == "FUNUSDT"
    assert record["reason"] == "ZIP_OR_ADJACENT_PUBLISHER_CHECKSUM_MISSING"


def test_paired_cohort_is_equal_side_notional_and_costed(subject: ModuleType) -> None:
    market = _market(subject)
    flips = subject.funding_flips(market, subject.DEV_START_MS, subject.DEV_END_MS)
    trial = next(item for item in subject.trial_family() if item.trial_id == "shock_0bps_hold_1h")

    cohorts = subject.evaluate_trial(market, flips, trial)

    assert len(cohorts) == 1
    cohort = cohorts[0]
    assert sum(
        (item.assigned_usd for item in cohort.positions if item.side == 1),
        Decimal(0),
    ) == Decimal("500")
    assert sum(
        (item.assigned_usd for item in cohort.positions if item.side == -1),
        Decimal(0),
    ) == Decimal("500")
    assert all(item.capacity_usd >= item.assigned_usd for item in cohort.positions)
    assert sum((item.base_net for item in cohort.positions), Decimal(0)) == cohort.base_net


def test_bootstrap_and_cscv_are_deterministic_and_complete(subject: ModuleType) -> None:
    vectors = {
        trial.trial_id: tuple(Decimal(index % 3 - 1) for index in range(120))
        for trial in subject.trial_family()
    }

    first, first_reality = subject.bootstrap_statistics(vectors)
    second, second_reality = subject.bootstrap_statistics(vectors)
    pbo, cells = subject.cscv_pbo(vectors)

    assert first == second
    assert first_reality == second_reality
    assert cells == 924
    assert Decimal(0) <= pbo <= Decimal(1)


def test_measured_failure_is_separate_from_structural_unknown(
    subject: ModuleType,
) -> None:
    summary = {
        "active_iso_weeks": 0,
        "capacity_proxy_pass": True,
        "cohort_count": 0,
        "familywise_bootstrap_lcb_usd_per_day": "-1",
        "holm_adjusted_p": "1",
        "leave_best_month_stress_total_usd": "-1",
        "leave_best_symbol_stress_total_usd": "-1",
        "stress_maximum_drawdown_usd": "0",
        "unique_long_symbols": 0,
        "unique_short_symbols": 0,
    }

    measured = subject.development_gate_map(summary, Decimal("0.75"), 924, Decimal("1"))
    structural = subject.structural_gate_map()

    assert not all(measured.values())
    assert set(structural.values()) == {False}
    assert "publication_causality_known" not in measured
    assert structural["publication_causality_known"] is False


def test_create_once_refuses_replacement(subject: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / "marker.json"

    subject.create_once(path, {"value": 1})

    with pytest.raises(subject.SealError, match="already exists"):
        subject.create_once(path, {"value": 2})
    assert json.loads(path.read_text(encoding="utf-8")) == {"value": 1}


def test_shared_and_state_paths_are_exact(subject: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(subject.SealError, match="shared root"):
        subject.guard_roots(tmp_path, subject.EXPECTED_STATE_ROOT)
