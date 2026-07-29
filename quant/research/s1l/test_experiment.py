from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.s1l import experiment as subject

D = Decimal


def bar(at_ms: int, price: str) -> subject.Bar:
    value = D(price)
    return subject.Bar(
        timestamp_ms=at_ms,
        open=value,
        high=value,
        low=value,
        close=value,
        volume=D("100"),
        quote_volume=D("10000"),
        count=100,
    )


def add_depth(store: subject.DataStore, symbol: str, fill: datetime, notional: str) -> None:
    snapshot = subject.timestamp_ms(fill - timedelta(seconds=30))
    store.depth.setdefault(symbol, {})[fill.date()] = [
        subject.DepthPoint(snapshot, D("-0.20"), D("10"), D(notional)),
        subject.DepthPoint(snapshot, D("0.20"), D("10"), D(notional)),
    ]


def synthetic_store() -> tuple[subject.DataStore, datetime, subject.TrialSpec]:
    delivery = datetime(2026, 6, 26, 8, tzinfo=UTC)
    trial = subject.TrialSpec("TEST", entry_dte=2, exit_dte=1)
    signal = delivery - timedelta(days=2)
    entry = signal + timedelta(hours=1)
    exit_at = delivery - timedelta(days=1) + timedelta(hours=1)
    store = subject.DataStore()
    dated = "BTCUSDT_260626"
    pair = "BTCUSDT"
    store.klines[dated] = {}
    store.klines[pair] = {}
    signal_ms = subject.timestamp_ms(signal)
    store.klines[dated][signal_ms] = bar(signal_ms, "110")
    store.klines[pair][signal_ms] = bar(signal_ms, "100")
    current = entry
    while current <= exit_at:
        at_ms = subject.timestamp_ms(current)
        fraction = D(int((current - entry).total_seconds())) / D(
            int((exit_at - entry).total_seconds())
        )
        dated_price = D("110") + (D("102") - D("110")) * fraction
        perp_price = D("100") + (D("101") - D("100")) * fraction
        store.klines[dated][at_ms] = bar(at_ms, str(dated_price))
        store.klines[pair][at_ms] = bar(at_ms, str(perp_price))
        current += timedelta(hours=1)
    funding_times = (
        datetime(2026, 6, 24, 16, tzinfo=UTC),
        datetime(2026, 6, 25, 0, tzinfo=UTC),
        datetime(2026, 6, 25, 8, tzinfo=UTC),
    )
    store.funding[pair] = [
        subject.FundingEvent(subject.timestamp_ms(value), 8, D("0.001")) for value in funding_times
    ]
    store.marks[pair] = {
        subject.timestamp_ms(value): bar(subject.timestamp_ms(value), "100")
        for value in funding_times
    }
    add_depth(store, dated, entry, "5000")
    add_depth(store, pair, entry, "6000")
    add_depth(store, dated, exit_at, "4000")
    add_depth(store, pair, exit_at, "7000")
    return store, delivery, trial


def cluster(value: str, delivery_index: int) -> subject.ClusterResult:
    decomposition = subject.Decomposition(net=D(value), reference_gross=D(value))
    return subject.ClusterResult(
        delivery=f"2024-{delivery_index + 1:02d}-01T08:00:00Z",
        decomposition=decomposition,
        path=((delivery_index, D(value)),),
        public_20bps_gross_capacity_usd=D("2000"),
        fills=8,
        funding_events=1,
        sides=(("BTCUSDT", -1), ("ETHUSDT", -1)),
    )


def trial_result(trial_id: str, offset: int) -> subject.TrialResult:
    spec = subject.TrialSpec(trial_id, 14 + offset, 1)
    scenario = subject.Scenario("STRESS", D("5"), D("20"))
    clusters = tuple(cluster(str(index + offset - 2), index) for index in range(8))
    return subject.trial_result_from_clusters(
        spec=spec,
        scenario=scenario,
        clusters=clusters,
        initial_capital=D("1000"),
    )


def test_protocol_derives_complete_partitioned_plan() -> None:
    protocol, raw = subject.load_json(subject.PROTOCOL_PATH)
    plan = subject.build_source_plan(protocol, raw)
    checked_plan, checked_raw = subject.load_json(subject.PLAN_PATH)
    assert subject.canonical_bytes(plan) == checked_raw
    assert checked_plan == plan
    objects = plan["objects"]
    assert isinstance(objects, list)
    assert plan["objectCount"] == len(objects)
    assert len(objects) > 400
    assert {item["partition"] for item in objects if isinstance(item, dict)} == {
        "development",
        "holdout",
    }
    assert any(
        "bookDepth/BTCUSDT_230331/" in str(item["zipKey"])
        for item in objects
        if isinstance(item, dict)
    )
    assert not any(
        "continuousKlines" in str(item["zipKey"]) for item in objects if isinstance(item, dict)
    )


def test_linear_pair_pnl_funding_and_capacity_reconcile() -> None:
    store, delivery, trial = synthetic_store()
    result = subject.evaluate_underlying(
        pair="BTCUSDT",
        delivery=delivery,
        trial=trial,
        scenario=subject.Scenario("ZERO_COST", D(0), D(0)),
        store=store,
        gross_underlying_usd=D("500"),
    )
    quantity = D("500") / (D("110") + D("100"))
    expected_gross = -quantity * (D("102") - D("110")) + quantity * (D("101") - D("100"))
    expected_funding = -quantity * D("100") * D("0.001") * D(3)
    assert result.side_dated == -1
    assert result.decomposition.reference_gross == expected_gross
    assert result.decomposition.funding == expected_funding
    assert result.decomposition.net == expected_gross + expected_funding
    assert result.decomposition.residual() == 0
    assert result.public_20bps_capacity_scale == D("4000") / (quantity * D("102"))
    assert result.funding_events == 3


def test_adverse_execution_and_fees_reduce_both_directions() -> None:
    store, delivery, trial = synthetic_store()
    zero = subject.evaluate_underlying(
        pair="BTCUSDT",
        delivery=delivery,
        trial=trial,
        scenario=subject.Scenario("ZERO", D(0), D(0)),
        store=store,
        gross_underlying_usd=D("500"),
    )
    stress = subject.evaluate_underlying(
        pair="BTCUSDT",
        delivery=delivery,
        trial=trial,
        scenario=subject.Scenario("STRESS", D("5"), D("20")),
        store=store,
        gross_underlying_usd=D("500"),
    )
    assert stress.decomposition.adverse > 0
    assert stress.decomposition.fees > 0
    assert stress.decomposition.net < zero.decomposition.net
    assert stress.decomposition.residual() == 0
    assert stress.path[-1][1] == stress.decomposition.net


def test_funding_gap_fails_closed() -> None:
    store, delivery, trial = synthetic_store()
    store.funding["BTCUSDT"] = store.funding["BTCUSDT"][:1]
    with pytest.raises(subject.EvidenceError, match="coverage ends too early"):
        subject.evaluate_underlying(
            pair="BTCUSDT",
            delivery=delivery,
            trial=trial,
            scenario=subject.Scenario("ZERO", D(0), D(0)),
            store=store,
            gross_underlying_usd=D("500"),
        )


def test_equal_base_quantity_removes_common_price_shift() -> None:
    store, delivery, trial = synthetic_store()
    entry = delivery - timedelta(days=trial.entry_dte) + timedelta(hours=1)
    exit_at = delivery - timedelta(days=trial.exit_dte) + timedelta(hours=1)
    current = entry
    while current <= exit_at:
        at_ms = subject.timestamp_ms(current)
        shift = (
            D(int((current - entry).total_seconds()))
            / D(int((exit_at - entry).total_seconds()))
            * D("10")
        )
        store.klines["BTCUSDT_260626"][at_ms] = bar(at_ms, str(D("110") + shift))
        store.klines["BTCUSDT"][at_ms] = bar(at_ms, str(D("100") + shift))
        current += timedelta(hours=1)
    store.funding["BTCUSDT"] = [
        subject.FundingEvent(event.timestamp_ms, event.interval_hours, D(0))
        for event in store.funding["BTCUSDT"]
    ]
    result = subject.evaluate_underlying(
        pair="BTCUSDT",
        delivery=delivery,
        trial=trial,
        scenario=subject.Scenario("ZERO", D(0), D(0)),
        store=store,
        gross_underlying_usd=D("500"),
    )
    assert result.decomposition.reference_gross == 0
    assert result.decomposition.net == 0


def test_zero_basis_still_requires_complete_evidence() -> None:
    store, delivery, trial = synthetic_store()
    signal_ms = subject.timestamp_ms(delivery - timedelta(days=trial.entry_dte))
    store.klines["BTCUSDT_260626"][signal_ms] = bar(signal_ms, "100")
    exit_ms = subject.timestamp_ms(delivery - timedelta(days=trial.exit_dte) + timedelta(hours=1))
    del store.klines["BTCUSDT_260626"][exit_ms]
    with pytest.raises(subject.EvidenceError, match="required hourly bar missing"):
        subject.evaluate_underlying(
            pair="BTCUSDT",
            delivery=delivery,
            trial=trial,
            scenario=subject.Scenario("ZERO", D(0), D(0)),
            store=store,
            gross_underlying_usd=D("500"),
        )


def test_depth_must_be_directional_and_fresh() -> None:
    store, delivery, trial = synthetic_store()
    fill = delivery - timedelta(days=trial.entry_dte) + timedelta(hours=1)
    assert subject.directional_depth(store, "BTCUSDT_260626", subject.timestamp_ms(fill), -1) == D(
        "5000"
    )
    store.depth["BTCUSDT_260626"][fill.date()] = [
        subject.DepthPoint(
            subject.timestamp_ms(fill - timedelta(seconds=61)),
            D("-0.20"),
            D("1"),
            D("10"),
        )
    ]
    with pytest.raises(subject.EvidenceError, match="older than 60 seconds"):
        subject.directional_depth(store, "BTCUSDT_260626", subject.timestamp_ms(fill), -1)


def test_bootstrap_and_pbo_are_deterministic_and_complete() -> None:
    family = {f"T{index}": trial_result(f"T{index}", index) for index in range(6)}
    draws_a = subject.circular_draws(8, replicates=32, block_length=2, seed=7)
    draws_b = subject.circular_draws(8, replicates=32, block_length=2, seed=7)
    assert draws_a == draws_b
    pbo = subject.pbo_cscv(family)
    assert pbo["splits"] == 70
    selection_counts = pbo["selectionCounts"]
    assert isinstance(selection_counts, dict)
    assert sum(selection_counts.values()) == 70
    stats = subject.development_statistics(
        family,
        "T5",
        replicates=128,
        block_length=2,
        seed=9,
        alpha=D("0.05"),
    )
    assert stats["replicates"] == 128
    adjusted = stats["holmAdjustedP"]
    assert isinstance(adjusted, dict)
    assert set(adjusted) == set(family)


def test_zip_csv_rejects_multiple_members(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("one.csv", "a\n1\n")
        archive.writestr("two.csv", "a\n2\n")
    path = tmp_path / "bad.zip"
    path.write_bytes(buffer.getvalue())
    with pytest.raises(subject.EvidenceError, match="exactly one member"):
        subject.zip_csv_bytes(path, subject.sha256_path(path))


def test_zip_csv_rejects_excessive_compression_ratio(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("bomb.csv", b"0" * 1_000_000)
    path = tmp_path / "bomb.zip"
    path.write_bytes(buffer.getvalue())
    with pytest.raises(subject.EvidenceError, match="compression ratio"):
        subject.zip_csv_bytes(path, subject.sha256_path(path))


def test_headerless_official_kline_schema_is_decoded_positionally() -> None:
    raw = b"1680220800000,28000,28100,27900,28050,12.5,1680224399999,350625,42,6.0,168300,0\n"
    parsed = subject.parse_kline_csv(raw, source="fixture")
    value = parsed[1680220800000]
    assert value.open == D("28000")
    assert value.close == D("28050")
    assert value.quote_volume == D("350625")
    assert value.count == 42
    hostile = raw.replace(b",42,", b",42,unexpected,")
    with pytest.raises(subject.EvidenceError, match="positional width"):
        subject.parse_kline_csv(hostile, source="hostile")


def test_exclusive_write_refuses_clobber(tmp_path: Path) -> None:
    path = tmp_path / "marker.json"
    subject.exclusive_write(path, b"first\n")
    with pytest.raises(subject.EvidenceError, match="already exists"):
        subject.exclusive_write(path, b"second\n")
    assert path.read_bytes() == b"first\n"


def test_frozen_listing_etag_binds_downloaded_bytes() -> None:
    subject.verify_listing_etag(b"abc", "900150983cd24fb0d6963f7d28e17f72", key="fixture")
    with pytest.raises(subject.EvidenceError, match="do not match"):
        subject.verify_listing_etag(b"abd", "900150983cd24fb0d6963f7d28e17f72", key="fixture")


def test_verified_acquisition_rejects_self_declared_forgery(tmp_path: Path) -> None:
    freeze_raw = b"frozen\n"
    key = "data/sample.zip"
    checksum_key = f"{key}.CHECKSUM"
    frozen_zip = b"good"
    forged_zip = b"evil"
    forged_sha = subject.sha256_bytes(forged_zip)
    checksum_raw = f"{forged_sha}  sample.zip\n".encode()
    checksum_etag = hashlib.md5(checksum_raw, usedforsecurity=False).hexdigest()
    frozen = {
        "discovery": {
            "objects": [
                {
                    "partition": "development",
                    "zip": {
                        "key": key,
                        "size": len(frozen_zip),
                        "etag": hashlib.md5(frozen_zip, usedforsecurity=False).hexdigest(),
                    },
                    "checksum": {
                        "key": checksum_key,
                        "size": len(checksum_raw),
                        "etag": checksum_etag,
                    },
                }
            ]
        }
    }
    cache = tmp_path / "cache" / "data"
    cache.mkdir(parents=True)
    (cache / "sample.zip").write_bytes(forged_zip)
    (cache / "sample.zip.CHECKSUM").write_bytes(checksum_raw)
    manifest = {
        "status": "CHECKSUM_VERIFIED_ZIP_BYTES_NOT_DECOMPRESSED",
        "freezeSha256": subject.sha256_bytes(freeze_raw),
        "objectCount": 1,
        "objects": [
            {
                "zipKey": key,
                "checksumKey": checksum_key,
                "partition": "development",
                "zipSize": len(frozen_zip),
                "zipSha256": forged_sha,
                "checksumSha256": subject.sha256_bytes(checksum_raw),
                "listingEtag": hashlib.md5(frozen_zip, usedforsecurity=False).hexdigest(),
                "checksumListingEtag": checksum_etag,
            }
        ],
    }
    (tmp_path / "acquisition.v1.json").write_bytes(subject.canonical_bytes(manifest))
    with pytest.raises(subject.EvidenceError, match="do not match frozen"):
        subject.verified_acquisition(tmp_path, frozen, freeze_raw)


def test_protocol_json_is_canonicalizable() -> None:
    protocol, _ = subject.load_json(subject.PROTOCOL_PATH)
    round_trip = json.loads(subject.canonical_bytes(protocol))
    assert round_trip["schema"] == "S1LUsdMQuarterlyPerpetualCalendarBasisProtocolV1"
    assert subject.sizing_contract(protocol, ("BTCUSDT", "ETHUSDT")) == (
        D("1000"),
        D("1000"),
        D("500"),
    )
