from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import subprocess
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from pathlib import Path

import pytest
from research.vg12 import experiment as e
from research.vg12 import verify as v


def _canonical(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def _fake_git_snapshot() -> dict[str, object]:
    return {
        "schema": "VG12PreRunGitSnapshotV1",
        "repositoryRoot": "/synthetic",
        "packetRelativePath": "quant/research/vg12",
        "commit": "c" * 40,
        "tree": "t" * 40,
        "parent": e.load_protocol()[0]["canonicalBaseCommit"],
        "headBlobs": {},
    }


def _bars(
    symbols: list[str],
    first: date,
    last: date,
    *,
    base_concentrated: bool = False,
) -> dict[str, dict[date, e.Bar]]:
    output: dict[str, dict[date, e.Bar]] = {}
    for index, symbol in enumerate(symbols):
        series: dict[date, e.Bar] = {}
        current = first
        while current <= last:
            volume = Decimal(1_000_000 + (len(symbols) - index) * 10_000)
            if base_concentrated and last - timedelta(days=35) <= current <= last - timedelta(
                days=8
            ):
                volume = Decimal(100_000_000 if index == 0 else 10_000)
            if base_concentrated and last - timedelta(days=7) <= current <= last - timedelta(
                days=1
            ):
                volume = Decimal(2_000_000)
            price = 10.0 + index
            series[current] = e.Bar(current, price, price, volume)
            current += timedelta(days=1)
        output[symbol] = series
    return output


def _formation(
    *,
    broadening: bool,
    liquidity: dict[str, Decimal] | None = None,
) -> e.Formation:
    cohort = tuple(f"S{index:02d}USDT" for index in range(30))
    return e.Formation(
        formation_day=date(2025, 6, 30),
        entry_day=date(2025, 7, 1),
        exit_day=date(2025, 7, 8),
        valid=True,
        invalid_reason=None,
        cohort=cohort,
        liquidity=liquidity or dict.fromkeys(cohort, Decimal(10_000_000)),
        base_entropy=Decimal("0.5"),
        recent_entropy=Decimal("0.6") if broadening else Decimal("0.5"),
        broadening=broadening,
        eligible_symbols=30,
    )


def _archive_bytes(
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-03",
    opened: datetime | None = None,
    quote_volume: str = "1000000",
) -> tuple[bytes, bytes]:
    opened = opened or datetime(2025, 3, 1, tzinfo=UTC)
    open_us = int(opened.timestamp() * 1_000_000)
    close_us = open_us + e.DAY_US - 1
    row = f"{open_us},10,12,9,11,100,{close_us},{quote_volume},5,50,2,0\n"
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", row)
    raw = stream.getvalue()
    sidecar = f"{hashlib.sha256(raw).hexdigest()}  {symbol}-1d-{month}.zip\n".encode()
    return raw, sidecar


def _write_archive(
    root: Path,
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-03",
    opened: datetime | None = None,
) -> dict[str, object]:
    raw, sidecar = _archive_bytes(symbol=symbol, month=month, opened=opened)
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    archive_path = directory / f"{symbol}-1d-{month}.zip"
    archive_path.write_bytes(raw)
    (directory / f"{archive_path.name}.CHECKSUM").write_bytes(sidecar)
    return {
        "symbol": symbol,
        "month": month,
        "state": "DOWNLOADED_VERIFIED",
        "zipKey": f"data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{month}.zip",
        "zipFrozenEtag": '"zip-etag"',
        "zipFrozenLastModified": "2026-07-01T00:00:00Z",
        "zipListedBytes": len(raw),
        "zipBytes": len(raw),
        "zipSha256": hashlib.sha256(raw).hexdigest(),
        "checksumKey": f"data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{month}.zip.CHECKSUM",
        "checksumFrozenEtag": '"checksum-etag"',
        "checksumFrozenLastModified": "2026-07-01T00:00:00Z",
        "checksumListedBytes": len(sidecar),
        "checksumBytes": len(sidecar),
        "checksumSha256": hashlib.sha256(sidecar).hexdigest(),
    }


def _write_raw_archive(
    root: Path,
    raw: bytes,
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-03",
) -> dict[str, object]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True, exist_ok=True)
    name = f"{symbol}-1d-{month}.zip"
    sidecar = f"{hashlib.sha256(raw).hexdigest()}  {name}\n".encode()
    (directory / name).write_bytes(raw)
    (directory / f"{name}.CHECKSUM").write_bytes(sidecar)
    return {
        "symbol": symbol,
        "month": month,
        "zipBytes": len(raw),
        "zipSha256": hashlib.sha256(raw).hexdigest(),
        "checksumBytes": len(sidecar),
        "checksumSha256": hashlib.sha256(sidecar).hexdigest(),
    }


def _write_manifests(
    root: Path,
    *,
    symbols: list[str],
    rows: list[dict[str, object]] | None = None,
    discovery_months: list[str] | None = None,
) -> None:
    symbols = sorted(symbols)
    ordered = sorted(rows or [], key=lambda row: (str(row["symbol"]), str(row["month"])))
    row_lookup = {(str(row["symbol"]), str(row["month"])): row for row in ordered}
    target_months = discovery_months or list(e.month_range("2024-03", "2026-06"))
    symbol_raw = ("\n".join(symbols) + "\n").encode()
    inventories: list[dict[str, object]] = []
    absent: list[str] = []
    for symbol in symbols:
        months: dict[str, object] = {}
        for month in target_months:
            row = row_lookup.get((symbol, month))
            if row is None:
                absent.append(f"{symbol}|{month}")
                continue
            months[month] = {
                "zip": {
                    "key": row["zipKey"],
                    "etag": row["zipFrozenEtag"],
                    "lastModified": row["zipFrozenLastModified"],
                    "size": row["zipListedBytes"],
                },
                "checksum": {
                    "key": row["checksumKey"],
                    "etag": row["checksumFrozenEtag"],
                    "lastModified": row["checksumFrozenLastModified"],
                    "size": row["checksumListedBytes"],
                },
            }
        inventories.append({"symbol": symbol, "months": months})
    discovery = {
        "schema": "S1FArchiveDiscoveryV1",
        "state": "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED",
        "observedAtUtc": "2026-07-29T00:00:00Z",
        "targetMonths": target_months,
        "universe": {
            "symbols": symbols,
            "count": len(symbols),
            "sha256": hashlib.sha256(symbol_raw).hexdigest(),
        },
        "symbolInventories": inventories,
    }
    discovery_raw = _canonical(discovery)
    root.mkdir(parents=True, exist_ok=True)
    (root / "discovery.v1.json").write_bytes(discovery_raw)
    row_digests = [hashlib.sha256(_canonical(row)).hexdigest() for row in ordered]
    acquisition = {
        "schema": "S1FAcquisitionManifestV1",
        "state": "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED",
        "completedAtUtc": "2026-07-29T00:01:00Z",
        "discoverySha256": hashlib.sha256(discovery_raw).hexdigest(),
        "archiveBodiesDecompressed": False,
        "artifactPairs": ordered,
        "artifactPairCount": len(ordered),
        "artifactRowsSha256": hashlib.sha256(e.normalized_lines(row_digests)).hexdigest(),
        "absentSymbolMonths": absent,
        "absentSymbolMonthCount": len(absent),
        "absentSha256": hashlib.sha256(e.normalized_lines(absent)).hexdigest(),
    }
    (root / "acquisition-manifest.v1.json").write_bytes(_canonical(acquisition))


def _bind_synthetic_manifest_evidence(
    monkeypatch: pytest.MonkeyPatch,
    root: Path,
    *,
    base_protocol: dict[str, object] | None = None,
) -> dict[str, object]:
    if base_protocol is None:
        base_protocol = e.load_protocol()[0]
    protocol = copy.deepcopy(base_protocol)
    discovery_raw = (root / "discovery.v1.json").read_bytes()
    acquisition_raw = (root / "acquisition-manifest.v1.json").read_bytes()
    discovery = json.loads(discovery_raw)
    acquisition = json.loads(acquisition_raw)
    universe = discovery["universe"]
    evidence = {
        "discoverySha256": hashlib.sha256(discovery_raw).hexdigest(),
        "acquisitionSha256": hashlib.sha256(acquisition_raw).hexdigest(),
        "discoveryTargetMonths": discovery["targetMonths"],
        "discoveryTargetMonthCount": len(discovery["targetMonths"]),
        "candidateUniverseCount": universe["count"],
        "candidateUniverseSha256": universe["sha256"],
        "artifactPairCount": acquisition["artifactPairCount"],
        "absentSymbolMonthCount": acquisition["absentSymbolMonthCount"],
        "artifactRowsSha256": acquisition["artifactRowsSha256"],
        "absentSymbolMonthsSha256": acquisition["absentSha256"],
    }
    data = protocol["data"]
    assert isinstance(data, dict)
    data["sharedManifestEvidence"] = evidence
    protocol_sha = hashlib.sha256(_canonical(protocol)).hexdigest()

    def synthetic_load_protocol(_path: Path = e.PROTOCOL_PATH) -> tuple[dict[str, object], str]:
        return protocol, protocol_sha

    monkeypatch.setattr(e, "load_protocol", synthetic_load_protocol)
    return protocol


def _analysis(*, holdout: bool, passing: bool = True) -> dict[str, object]:
    count = 17 if holdout else 34
    broadening_count = 5 if holdout else 10
    cohort = [f"S{index:02d}USDT" for index in range(30)]
    required_months = (
        ["2026-03", "2026-04", "2026-05", "2026-06"]
        if holdout
        else [
            "2025-07",
            "2025-08",
            "2025-09",
            "2025-10",
            "2025-11",
            "2025-12",
            "2026-01",
            "2026-02",
        ]
    )
    strategy = {
        "validFormations": count,
        "broadeningFormations": broadening_count,
        "nonBroadeningOrTieFormations": count - broadening_count,
        "investedFormations": broadening_count,
        "scheduledFormations": count,
        "fills": broadening_count * 60,
        "distinctHeldSymbols": 30,
        "positiveExitMonths": len(required_months),
        "exitMonthReturns": dict.fromkeys(required_months, 0.01),
        "netUsdPerInitial1000": 10.0 if passing else -1.0,
        "weeklyCloseMaxDrawdownPct": 1.0,
        "topAssetPositiveGrossProfitSharePct": 10.0,
        "capacityProxy": {
            "maximumParticipationBps": 0.5,
            "minimumC1bpUsd": 2_000.0,
        },
    }
    scenario = {"strategy": strategy}
    return {
        "formations": [
            {
                "valid": True,
                "broadening": index < broadening_count,
                "cohort": cohort,
            }
            for index in range(count)
        ],
        "scenarios": {
            "GROSS": scenario,
            "BASE": scenario,
            "STRESS": scenario,
            "FEE_STRESS": scenario,
        },
        "stressInference": {
            "netUsdPerInitial1000Lcb5Pct": 1.0,
            "oneSidedP": 0.01,
            "matchedBenchmarkExcessUsdLcb5Pct": 1.0,
        },
    }


def test_protocol_is_single_fixed_distinct_trial_with_two_regimes() -> None:
    protocol, digest = e.load_protocol()
    assert len(digest) == 64
    assert protocol["trial"]["attemptedCount"] == 1
    assert protocol["trial"]["trialId"] == e.TRIAL_ID
    assert protocol["distinctness"]["notVG9"].startswith("NOT_SPOT_VERSUS")
    assert protocol["distinctness"]["notVG10"] == "NOT_TAKER_BUY_IMBALANCE"
    assert protocol["distinctness"]["notVG11"].startswith("NOT_TRADE_COUNT")
    assert (
        protocol["distinctness"]["siblingInspectionState"]
        == "CURRENT_SIBLING_PROTOCOL_BYTES_INSPECTED_PRE_FREEZE"
    )
    assert protocol["distinctness"]["siblingDistinctnessVerdict"] == ("MATERIAL_DISTINCTNESS_PASS")
    assert protocol["distinctness"]["siblingProtocolEvidence"]["VG8"]["protocolSha256"] == (
        "5dddd302a69be73494cb5ed06d674982a5ecebfa5dcc573799b2c0207965a579"
    )
    assert protocol["distinctness"]["siblingProtocolEvidence"]["VG10"]["gitState"] == (
        "UNTRACKED_AT_BASE"
    )
    shared_evidence = protocol["data"]["sharedManifestEvidence"]
    assert shared_evidence == e.frozen_shared_manifest_evidence()
    assert shared_evidence["discoveryTargetMonths"] == list(e.month_range("2024-03", "2026-06"))
    assert shared_evidence["artifactPairCount"] == 11_245
    assert shared_evidence["absentSymbolMonthCount"] == 5_695
    assert protocol["gates"]["development"]["minimumNonBroadeningOrTieFormations"] == 8
    assert protocol["gates"]["holdout"]["minimumNonBroadeningOrTieFormations"] == 4
    v.verify_protocol(protocol)


def test_first_formation_uses_exact_prior_120_days_through_sunday() -> None:
    entry = date(2025, 7, 1)
    formation = entry - timedelta(days=1)
    required = e.date_range(formation - timedelta(days=120), formation - timedelta(days=1))
    assert len(required) == 120
    assert required[0] == date(2025, 3, 2)
    assert required[-1] == date(2025, 6, 29)


def test_normalized_entropy_is_one_for_uniform_and_lower_for_concentration() -> None:
    uniform = e.normalized_entropy([Decimal(1)] * 30)
    concentrated = e.normalized_entropy([Decimal(1000)] + [Decimal(1)] * 29)
    assert uniform == Decimal(1)
    assert concentrated is not None
    assert 0 <= concentrated < uniform


def test_entropy_is_exactly_invariant_to_proportional_mass_and_zero_mass_is_cash() -> None:
    masses = [Decimal(index + 1) for index in range(30)]
    assert e.normalized_entropy(masses) == e.normalized_entropy(
        [value * Decimal("123456789.987654321") for value in masses]
    )
    assert e.normalized_entropy([Decimal(0)] * 30) is None
    assert not e.entropy_is_broadening(None, Decimal("0.9"))
    assert not e.entropy_is_broadening(Decimal("0.5"), Decimal("0.5") + e.ENTROPY_TOLERANCE)


def test_adversarial_proportional_windows_stay_cash_inside_frozen_context() -> None:
    raw_masses = [
        "299762002404557.033802015",
        "295454362964370023919.472",
        "856919267965343804880.483",
        "70959750013956200431.9716",
        "36785469346381952.4730737",
        "3711911254895.22445027947",
        "49468662383.042237905868",
        "44611442755871422247267.2",
        "1520303055353.61008304117",
        "94483342144582568879032.7",
        "14246098895418.8124575782",
        "207429375286668461708380",
        "61023802735088988347357.2",
        "51809021681894371681188.3",
        "1334913745227.01859449844",
        "20896485829958211740.9770",
        "13127405003134558.611471",
        "76713296391696217028.9646",
        "7280745841231193.03710847",
        "4971473981146696997.47811",
        "8465490059446818.66777104",
        "30385349829.0353759790331",
        "440083992989031948.787123",
        "94525202395.8748561394405",
        "1844879123830515390904.30",
        "62751389536443862.450764",
        "2424217270137.84602868716",
        "6454837526050716772557.3",
        "8324504558743.34751157306",
        "2356528279449417754.24898",
    ]
    masses = [Decimal(value) for value in raw_masses]
    factor = Decimal("1285260573.04256925")
    legacy_scaled = e.normalized_entropy([value * factor for value in masses])
    legacy_base = e.normalized_entropy(masses)
    assert legacy_scaled is not None
    assert legacy_base is not None
    legacy_delta = legacy_scaled - legacy_base
    assert legacy_delta == Decimal("3.356469215201391957279975262E-30")

    symbols = [f"S{index:02d}USDT" for index in range(30)]
    bars = _bars(symbols, date(2025, 3, 2), date(2025, 7, 8))
    with localcontext(prec=e.DECIMAL_PRECISION, rounding=ROUND_HALF_EVEN):
        for index, symbol in enumerate(symbols):
            for day in e.date_range(date(2025, 5, 26), date(2025, 6, 22)):
                bar = bars[symbol][day]
                bars[symbol][day] = e.Bar(day, bar.open_price, bar.close_price, masses[index] / 28)
            for day in e.date_range(date(2025, 6, 23), date(2025, 6, 29)):
                bar = bars[symbol][day]
                bars[symbol][day] = e.Bar(
                    day,
                    bar.open_price,
                    bar.close_price,
                    masses[index] * factor / 7,
                )
    formation = e.build_formation(bars, symbols, [], date(2025, 7, 1))
    assert formation.base_entropy == formation.recent_entropy
    assert not formation.broadening


def test_formation_selects_on_pre_signal_liquidity_and_enters_on_strict_broadening() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(31)]
    entry = date(2025, 7, 1)
    bars = _bars(
        symbols,
        date(2025, 3, 2),
        date(2025, 7, 8),
    )
    for day in e.date_range(date(2025, 5, 26), date(2025, 6, 22)):
        for index, symbol in enumerate(symbols):
            original = bars[symbol][day]
            bars[symbol][day] = e.Bar(
                day,
                original.open_price,
                original.close_price,
                Decimal(100_000_000 if index == 0 else 10_000),
            )
    for day in e.date_range(date(2025, 6, 23), date(2025, 6, 29)):
        for symbol in symbols:
            original = bars[symbol][day]
            bars[symbol][day] = e.Bar(
                day, original.open_price, original.close_price, Decimal(2_000_000)
            )
    # Huge recent mass cannot rescue the weakest lagged-liquidity member into the cohort.
    for day in e.date_range(date(2025, 6, 23), date(2025, 6, 29)):
        original = bars["S30USDT"][day]
        bars["S30USDT"][day] = e.Bar(
            day, original.open_price, original.close_price, Decimal(1_000_000_000_000)
        )
    formation = e.build_formation(bars, symbols, [], entry)
    assert formation.valid
    assert len(formation.cohort) == 30
    assert "S30USDT" not in formation.cohort
    assert formation.recent_entropy is not None
    assert formation.base_entropy is not None
    assert formation.recent_entropy > formation.base_entropy
    assert formation.broadening


def test_price_changes_cannot_change_cohort_or_entropy_signal() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    bars = _bars(
        symbols,
        date(2025, 3, 2),
        date(2025, 7, 8),
        base_concentrated=True,
    )
    first = e.build_formation(bars, symbols, [], date(2025, 7, 1))
    changed = {
        symbol: {
            day: e.Bar(day, bar.open_price * 1000, bar.close_price / 1000, bar.quote_volume)
            for day, bar in series.items()
        }
        for symbol, series in bars.items()
    }
    second = e.build_formation(changed, symbols, [], date(2025, 7, 1))
    assert second.cohort == first.cohort
    assert second.base_entropy == first.base_entropy
    assert second.recent_entropy == first.recent_entropy
    assert second.broadening == first.broadening


def test_semantic_anomaly_is_causal_and_does_not_poison_earlier_formation() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(31)]
    bars = _bars(symbols, date(2025, 3, 2), date(2025, 7, 8))
    future_issue = [
        {
            "symbol": "S00USDT",
            "month": "2025-08",
            "kind": "SEMANTIC_ANOMALY",
            "reason": "future",
        }
    ]
    current_issue = [
        {
            "symbol": "S00USDT",
            "month": "2025-06",
            "kind": "SEMANTIC_ANOMALY",
            "reason": "overlap",
        }
    ]
    before = e.build_formation(bars, symbols, future_issue, date(2025, 7, 1))
    affected = e.build_formation(bars, symbols, current_issue, date(2025, 7, 1))
    assert "S00USDT" in before.cohort
    assert "S00USDT" not in affected.cohort
    assert affected.valid


def test_tie_is_cash_and_benchmark_still_invests() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    bars = _bars(symbols, date(2025, 7, 1), date(2025, 7, 8))
    formation = _formation(broadening=False)
    strategy = e.simulation(bars, (formation,), e.Scenario("GROSS", 0, 0), benchmark=False)
    benchmark = e.simulation(bars, (formation,), e.Scenario("GROSS", 0, 0), benchmark=True)
    assert strategy.invested_formations == 0
    assert strategy.fills == 0
    assert strategy.terminal_nav == 1000
    assert benchmark.invested_formations == 1
    assert benchmark.fills == 60


def test_costs_reduce_nav_and_weakest_leg_caps_equal_weight_c1bp() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    bars = _bars(symbols, date(2025, 7, 1), date(2025, 7, 8))
    liquidity = {
        symbol: Decimal(10_000_000 + index * 1_000_000) for index, symbol in enumerate(symbols)
    }
    formation = _formation(broadening=True, liquidity=liquidity)
    gross = e.simulation(bars, (formation,), e.Scenario("GROSS", 0, 0), benchmark=False)
    stress = e.simulation(bars, (formation,), e.Scenario("STRESS", 0.001, 0.0025), benchmark=False)
    assert stress.terminal_nav < gross.terminal_nav
    assert stress.fills == 60
    assert stress.c1bp_usd == [30 * float(min(liquidity.values())) * 0.0001]


def test_missing_held_entry_or_exit_is_terminal_measurement_error() -> None:
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    bars = _bars(symbols, date(2025, 7, 1), date(2025, 7, 8))
    del bars["S05USDT"][date(2025, 7, 8)]
    with pytest.raises(e.SelectedEvidenceError, match="entry/exit missing"):
        e.simulation(
            bars,
            (_formation(broadening=True),),
            e.Scenario("GROSS", 0, 0),
            benchmark=False,
        )


def test_bootstrap_is_seeded_deterministic_and_synchronous() -> None:
    returns = [0.01, -0.005, 0.002, 0.0] * 5
    benchmark = [0.003, -0.002, 0.001, 0.0] * 5
    first = e.bootstrap_packet(
        returns,
        benchmark_returns=benchmark,
        block_length=4,
        replicates=128,
        seed=12,
    )
    second = e.bootstrap_packet(
        returns,
        benchmark_returns=benchmark,
        block_length=4,
        replicates=128,
        seed=12,
    )
    assert first == second
    assert first["observations"] == 20
    assert 0 < float(first["oneSidedP"]) <= 1


def test_archive_parser_checks_digest_sidecar_microseconds_and_schema(tmp_path: Path) -> None:
    row = _write_archive(tmp_path)
    parsed = e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")
    assert parsed[0].day == date(2025, 3, 1)
    archive = tmp_path / "archives/AAAUSDT/2025-03/AAAUSDT-1d-2025-03.zip"
    archive.write_bytes(archive.read_bytes() + b"tamper")
    with pytest.raises(e.CustodyError, match="byte length changed"):
        e.parse_archive(tmp_path, row, "AAAUSDT", "2025-03")
    with pytest.raises(e.ArchiveSchemaError, match="not microseconds"):
        e.parse_timestamp("1740787200000", "AAAUSDT", "2025-03")


def test_archive_parser_accepts_zero_quote_volume_and_localizes_internal_faults(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    zero_raw, _ = _archive_bytes(quote_volume="0")
    row = _write_raw_archive(tmp_path / "zero", zero_raw)
    assert e.parse_archive(tmp_path / "zero", row, "AAAUSDT", "2025-03")[0].quote_volume == 0

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("AAAUSDT-1d-2025-03.csv", b"\xff\xfe")
    bad_row = _write_raw_archive(tmp_path / "decode", stream.getvalue())
    with pytest.raises(e.ArchiveSchemaError, match="internal semantics"):
        e.parse_archive(tmp_path / "decode", bad_row, "AAAUSDT", "2025-03")

    compressed = io.BytesIO()
    with zipfile.ZipFile(compressed, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("AAAUSDT-1d-2025-03.csv", b"0" * 200_000)
    ratio_row = _write_raw_archive(tmp_path / "ratio", compressed.getvalue())
    with pytest.raises(e.ArchiveSchemaError, match="compression ratio"):
        e.parse_archive(tmp_path / "ratio", ratio_row, "AAAUSDT", "2025-03")

    unsupported = io.BytesIO()
    with zipfile.ZipFile(unsupported, "w", zipfile.ZIP_BZIP2) as archive:
        archive.writestr("AAAUSDT-1d-2025-03.csv", b"not admitted")
    method_row = _write_raw_archive(tmp_path / "method", unsupported.getvalue())
    with pytest.raises(e.ArchiveSchemaError, match="method/flag/size"):
        e.parse_archive(tmp_path / "method", method_row, "AAAUSDT", "2025-03")

    flagged = bytearray(_archive_bytes()[0])
    local = flagged.index(b"PK\x03\x04")
    central = flagged.index(b"PK\x01\x02")
    for offset in (local + 6, central + 8):
        flags = int.from_bytes(flagged[offset : offset + 2], "little") | 0x4000
        flagged[offset : offset + 2] = flags.to_bytes(2, "little")
    flag_row = _write_raw_archive(tmp_path / "flags", bytes(flagged))
    with pytest.raises(e.ArchiveSchemaError, match="method/flag/size"):
        e.parse_archive(tmp_path / "flags", flag_row, "AAAUSDT", "2025-03")

    stored = io.BytesIO()
    with zipfile.ZipFile(stored, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr(
            "AAAUSDT-1d-2025-03.csv",
            (b"1740787200000000,10,12,9,11,100,1740873599999999,1000000,5,50,2,0\n"),
        )
    corrupt = bytearray(stored.getvalue())
    name_length = int.from_bytes(corrupt[26:28], "little")
    extra_length = int.from_bytes(corrupt[28:30], "little")
    data_offset = 30 + name_length + extra_length
    corrupt[data_offset] ^= 0x01
    crc_row = _write_raw_archive(tmp_path / "crc", bytes(corrupt))
    with pytest.raises(e.ArchiveSchemaError, match="internal semantics"):
        e.parse_archive(tmp_path / "crc", crc_row, "AAAUSDT", "2025-03")

    oversized_row = dict(row)
    oversized_row["zipBytes"] = e.MAXIMUM_ZIP_BYTES + 1
    with pytest.raises(e.CustodyError, match="ZIP size outside bounds"):
        e.parse_archive(tmp_path / "zero", oversized_row, "AAAUSDT", "2025-03")
    oversized_sidecar = dict(row)
    oversized_sidecar["checksumBytes"] = e.MAXIMUM_CHECKSUM_BYTES + 1
    with pytest.raises(e.CustodyError, match="sidecar size outside bounds"):
        e.parse_archive(tmp_path / "zero", oversized_sidecar, "AAAUSDT", "2025-03")

    archive_path = tmp_path / "zero/archives/AAAUSDT/2025-03/AAAUSDT-1d-2025-03.zip"
    sidecar_path = archive_path.with_name(f"{archive_path.name}.CHECKSUM")
    original_sidecar = sidecar_path.read_bytes()
    reads = 0
    real_read = os.read

    def observed_read(descriptor: int, size: int) -> bytes:
        nonlocal reads
        reads += 1
        return real_read(descriptor, size)

    monkeypatch.setattr(os, "read", observed_read)
    sidecar_path.write_bytes(b"x" * (e.MAXIMUM_CHECKSUM_BYTES + 1))
    checksum_bytes = row["checksumBytes"]
    assert isinstance(checksum_bytes, int)
    with pytest.raises(e.CustodyError, match="sidecar size outside bounds"):
        e.read_bounded_regular(
            sidecar_path,
            expected_bytes=checksum_bytes,
            maximum_bytes=e.MAXIMUM_CHECKSUM_BYTES,
            label="sidecar",
        )
    assert reads == 0

    sidecar_path.write_bytes(original_sidecar)
    archive_path.write_bytes(b"x" * (e.MAXIMUM_ZIP_BYTES + 1))
    with pytest.raises(e.CustodyError, match="ZIP size outside bounds"):
        e.parse_archive(tmp_path / "zero", row, "AAAUSDT", "2025-03")
    assert reads == 0


def test_bounded_leaf_reader_rejects_symlink_and_nonregular_before_content_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = tmp_path / "payload"
    payload.write_bytes(b"x")
    symlink = tmp_path / "symlink"
    symlink.symlink_to(payload)
    directory = tmp_path / "directory"
    directory.mkdir()
    reads = 0
    real_read = os.read

    def observed_read(descriptor: int, size: int) -> bytes:
        nonlocal reads
        reads += 1
        return real_read(descriptor, size)

    monkeypatch.setattr(os, "read", observed_read)
    with pytest.raises(e.CustodyError, match="unavailable"):
        e.read_bounded_regular(
            symlink,
            expected_bytes=1,
            maximum_bytes=1,
            label="ZIP",
        )
    with pytest.raises(e.CustodyError, match="not a regular file"):
        e.read_bounded_regular(
            directory,
            expected_bytes=1,
            maximum_bytes=1,
            label="sidecar",
        )
    assert reads == 0


def test_required_exit_month_bucket_must_have_an_observation() -> None:
    returns = [(date(2025, 7, 8), 0.01)]
    with pytest.raises(e.EvidenceError, match="has no return"):
        e.positive_exit_months(returns, ["2025-07", "2025-08"])


def test_freeze_and_independent_verifier_read_manifests_without_archives(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source"
    symbols = [f"S{index:02d}USDT" for index in range(30)]
    _write_manifests(source, symbols=symbols)
    protocol = _bind_synthetic_manifest_evidence(monkeypatch, source)
    freeze_path = tmp_path / "freeze.v1.json"
    payload = e.freeze(
        source,
        freeze_path=freeze_path,
        packet_dir=e.PACKET_DIR,
        strict_paths=False,
    )
    assert payload["archiveBodiesOpenedByVG12"] is False
    assert payload["sharedArtifactPairCount"] == 0
    assert payload["sharedAbsentSymbolMonthCount"] == 30 * 28
    assert payload["targetArtifactPairCount"] == 0
    assert payload["targetAbsentPairCount"] == 30 * 16
    v.verify_source_manifests(
        source,
        payload,
        protocol,
        strict_paths=False,
    )
    assert freeze_path.read_bytes() == _canonical(payload)


def test_full_manifest_superset_is_authenticated_before_exact_target_slice(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source"
    outside = _write_archive(
        source,
        month="2024-03",
        opened=datetime(2024, 3, 1, tzinfo=UTC),
    )
    inside = _write_archive(source, month="2025-03")
    _write_manifests(source, symbols=["AAAUSDT"], rows=[outside, inside])
    protocol = _bind_synthetic_manifest_evidence(monkeypatch, source)
    discovery, _, acquisition, _, symbols, lookup = e.validate_source_manifests(
        source,
        protocol,
    )
    assert discovery["targetMonths"] == list(e.month_range("2024-03", "2026-06"))
    assert acquisition["artifactPairCount"] == 2
    assert symbols == ("AAAUSDT",)
    assert set(lookup) == {("AAAUSDT", "2025-03")}

    payload = e.build_freeze(source, strict_paths=False)
    assert payload["sharedArtifactPairCount"] == 2
    assert payload["sharedAbsentSymbolMonthCount"] == 26
    assert payload["targetArtifactPairCount"] == 1
    assert payload["targetAbsentPairCount"] == 15
    v.verify_source_manifests(
        source,
        payload,
        protocol,
        strict_paths=False,
    )


def test_protocol_evidence_rejects_coherent_target_only_manifest_replacement(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    _write_manifests(
        source,
        symbols=["AAAUSDT"],
        discovery_months=list(e.month_range("2025-03", "2026-06")),
    )
    protocol = e.load_protocol()[0]
    discovery_raw = (source / "discovery.v1.json").read_bytes()
    acquisition_raw = (source / "acquisition-manifest.v1.json").read_bytes()
    coherent_freeze = {
        "sharedDiscoverySha256": hashlib.sha256(discovery_raw).hexdigest(),
        "sharedAcquisitionSha256": hashlib.sha256(acquisition_raw).hexdigest(),
    }
    with pytest.raises(e.CustodyError, match="live shared-manifest bytes"):
        e.validate_source_manifests(source, protocol)
    with pytest.raises(v.VerificationError, match="byte binding"):
        v.verify_source_manifests(
            source,
            coherent_freeze,
            protocol,
            strict_paths=False,
        )


def test_protocol_evidence_rejects_coherent_out_of_scope_pair_deletion(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source"
    outside = _write_archive(
        source,
        month="2024-03",
        opened=datetime(2024, 3, 1, tzinfo=UTC),
    )
    inside = _write_archive(source, month="2025-03")
    _write_manifests(source, symbols=["AAAUSDT"], rows=[outside, inside])
    protocol = _bind_synthetic_manifest_evidence(monkeypatch, source)
    freeze = e.build_freeze(source, strict_paths=False)

    discovery_path = source / "discovery.v1.json"
    discovery = json.loads(discovery_path.read_bytes())
    del discovery["symbolInventories"][0]["months"]["2024-03"]
    discovery_raw = _canonical(discovery)
    discovery_path.write_bytes(discovery_raw)

    acquisition_path = source / "acquisition-manifest.v1.json"
    acquisition = json.loads(acquisition_path.read_bytes())
    acquisition["discoverySha256"] = hashlib.sha256(discovery_raw).hexdigest()
    acquisition["artifactPairs"] = [
        row for row in acquisition["artifactPairs"] if row["month"] != "2024-03"
    ]
    acquisition["artifactPairCount"] = len(acquisition["artifactPairs"])
    row_digests = [
        hashlib.sha256(_canonical(row)).hexdigest() for row in acquisition["artifactPairs"]
    ]
    acquisition["artifactRowsSha256"] = hashlib.sha256(e.normalized_lines(row_digests)).hexdigest()
    acquisition["absentSymbolMonths"] = sorted(
        [*acquisition["absentSymbolMonths"], "AAAUSDT|2024-03"]
    )
    acquisition["absentSymbolMonthCount"] = len(acquisition["absentSymbolMonths"])
    acquisition["absentSha256"] = hashlib.sha256(
        e.normalized_lines(acquisition["absentSymbolMonths"])
    ).hexdigest()
    acquisition_raw = _canonical(acquisition)
    acquisition_path.write_bytes(acquisition_raw)

    freeze.update(
        {
            "sharedDiscoverySha256": hashlib.sha256(discovery_raw).hexdigest(),
            "sharedAcquisitionSha256": hashlib.sha256(acquisition_raw).hexdigest(),
            "sharedArtifactRowsSha256": acquisition["artifactRowsSha256"],
            "sharedArtifactPairCount": acquisition["artifactPairCount"],
            "sharedAbsentSymbolMonthsSha256": acquisition["absentSha256"],
            "sharedAbsentSymbolMonthCount": acquisition["absentSymbolMonthCount"],
        }
    )
    with pytest.raises(e.CustodyError, match="live shared-manifest bytes"):
        e.build_freeze(source, strict_paths=False)
    with pytest.raises(v.VerificationError, match="byte binding"):
        v.verify_source_manifests(
            source,
            freeze,
            protocol,
            strict_paths=False,
        )


def test_out_of_scope_row_metadata_and_digest_tampering_are_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source"
    outside = _write_archive(
        source,
        month="2024-03",
        opened=datetime(2024, 3, 1, tzinfo=UTC),
    )
    _write_manifests(source, symbols=["AAAUSDT"], rows=[outside])
    protocol = _bind_synthetic_manifest_evidence(monkeypatch, source)
    freeze = e.build_freeze(source, strict_paths=False)
    acquisition_path = source / "acquisition-manifest.v1.json"
    acquisition = json.loads(acquisition_path.read_bytes())
    acquisition["artifactPairs"][0]["zipBytes"] += 1
    row_digests = [
        hashlib.sha256(_canonical(row)).hexdigest() for row in acquisition["artifactPairs"]
    ]
    acquisition["artifactRowsSha256"] = hashlib.sha256(e.normalized_lines(row_digests)).hexdigest()
    acquisition_raw = _canonical(acquisition)
    acquisition_path.write_bytes(acquisition_raw)

    freeze["sharedAcquisitionSha256"] = hashlib.sha256(acquisition_raw).hexdigest()
    freeze["sharedArtifactRowsSha256"] = acquisition["artifactRowsSha256"]
    with pytest.raises(v.VerificationError, match="byte binding"):
        v.verify_source_manifests(
            source,
            freeze,
            protocol,
            strict_paths=False,
        )
    with pytest.raises(e.CustodyError, match="live shared-manifest bytes"):
        e.build_freeze(source, strict_paths=False)

    _write_manifests(source, symbols=["AAAUSDT"], rows=[outside])
    acquisition = json.loads(acquisition_path.read_bytes())
    acquisition["artifactRowsSha256"] = "0" * 64
    acquisition_path.write_bytes(_canonical(acquisition))
    discovery = json.loads((source / "discovery.v1.json").read_bytes())
    with pytest.raises(e.CustodyError, match="artifact row digest"):
        e.validate_artifact_rows(
            discovery,
            acquisition,
            ("AAAUSDT",),
            e.discovery_months(discovery),
        )
    with pytest.raises(e.CustodyError, match="live shared-manifest bytes"):
        e.build_freeze(source, strict_paths=False)


def test_out_of_scope_absence_tampering_and_noncontiguous_target_subset_are_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source"
    production_protocol = e.load_protocol()[0]
    _write_manifests(source, symbols=["AAAUSDT"])
    _bind_synthetic_manifest_evidence(
        monkeypatch,
        source,
        base_protocol=production_protocol,
    )
    acquisition_path = source / "acquisition-manifest.v1.json"
    acquisition = json.loads(acquisition_path.read_bytes())
    acquisition["absentSymbolMonths"].remove("AAAUSDT|2024-03")
    acquisition["absentSymbolMonthCount"] = len(acquisition["absentSymbolMonths"])
    acquisition["absentSha256"] = hashlib.sha256(
        e.normalized_lines(acquisition["absentSymbolMonths"])
    ).hexdigest()
    acquisition_path.write_bytes(_canonical(acquisition))
    with pytest.raises(e.CustodyError, match="absence coverage"):
        e.validate_artifact_rows(
            json.loads((source / "discovery.v1.json").read_bytes()),
            acquisition,
            ("AAAUSDT",),
            e.month_range("2024-03", "2026-06"),
        )
    with pytest.raises(e.CustodyError, match="live shared-manifest bytes"):
        e.build_freeze(source, strict_paths=False)

    gapped_months = list(e.month_range("2024-03", "2026-06"))
    gapped_months.remove("2025-09")
    _write_manifests(
        source,
        symbols=["AAAUSDT"],
        discovery_months=gapped_months,
    )
    _bind_synthetic_manifest_evidence(
        monkeypatch,
        source,
        base_protocol=production_protocol,
    )
    with pytest.raises(e.CustodyError, match="continuous ordered discovery subset"):
        e.build_freeze(source, strict_paths=False)


def test_manifest_row_and_absence_digests_are_exactly_recomputed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "source"
    row = _write_archive(source)
    _write_manifests(source, symbols=["AAAUSDT"], rows=[row])
    _bind_synthetic_manifest_evidence(monkeypatch, source)
    acquisition_path = source / "acquisition-manifest.v1.json"
    acquisition = json.loads(acquisition_path.read_bytes())
    acquisition["artifactRowsSha256"] = "0" * 64
    acquisition_path.write_bytes(_canonical(acquisition))
    with pytest.raises(e.CustodyError, match="artifact row digest"):
        e.validate_artifact_rows(
            json.loads((source / "discovery.v1.json").read_bytes()),
            acquisition,
            ("AAAUSDT",),
            e.month_range("2024-03", "2026-06"),
        )
    _write_manifests(source, symbols=["AAAUSDT"], rows=[row])
    acquisition = json.loads(acquisition_path.read_bytes())
    acquisition["absentSha256"] = "0" * 64
    acquisition_path.write_bytes(_canonical(acquisition))
    with pytest.raises(e.CustodyError, match="absence digest"):
        e.validate_artifact_rows(
            json.loads((source / "discovery.v1.json").read_bytes()),
            acquisition,
            ("AAAUSDT",),
            e.month_range("2024-03", "2026-06"),
        )


def test_run_writes_markers_before_each_archive_phase_and_refuses_rerun(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    protocol, _ = e.load_protocol()
    symbols = tuple(f"S{index:02d}USDT" for index in range(30))
    all_bars = _bars(list(symbols), date(2025, 3, 2), date(2026, 6, 30))
    state_root = tmp_path / "state"
    result_path = tmp_path / "result.v1.json"
    receipt_path = tmp_path / "run-receipt.v1.json"
    freeze_path = tmp_path / "freeze.v1.json"
    source_root = tmp_path / "source"
    source_root.mkdir()
    freeze_payload = {
        "sourceRoot": str(source_root),
    }

    def fake_load_frozen(
        **_: object,
    ) -> tuple[
        dict[str, object],
        dict[str, str],
        dict[str, object],
        tuple[str, ...],
        dict[tuple[str, str], object],
        dict[str, str],
    ]:
        return (
            protocol,
            freeze_payload,
            {},
            symbols,
            {},
            {
                "protocolSha256": "a" * 64,
                "freezeSha256": "f" * 64,
                "sharedDiscoverySha256": "b" * 64,
                "sharedAcquisitionSha256": "c" * 64,
                "targetArtifactInventorySha256": "d" * 64,
            },
        )

    calls = 0

    def fake_load_bars(
        _root: Path,
        _lookup: object,
        _symbols: object,
        _months: object,
    ) -> tuple[dict[str, dict[date, e.Bar]], list[dict[str, str]]]:
        nonlocal calls
        calls += 1
        assert (state_root / "run-marker.v1.json").is_file()
        if calls == 1:
            assert not (state_root / "candidate-seal.v1.json").exists()
            return (
                {
                    symbol: {day: bar for day, bar in series.items() if day <= date(2026, 2, 28)}
                    for symbol, series in all_bars.items()
                },
                [],
            )
        assert (state_root / "candidate-seal.v1.json").is_file()
        assert (state_root / "holdout-open.v1.json").is_file()
        return (
            {
                symbol: {day: bar for day, bar in series.items() if day >= date(2026, 3, 1)}
                for symbol, series in all_bars.items()
            },
            [],
        )

    monkeypatch.setattr(e, "load_frozen", fake_load_frozen)
    monkeypatch.setattr(e, "load_bars", fake_load_bars)
    monkeypatch.setattr(e, "preflight_git_snapshot", lambda *_: _fake_git_snapshot())
    real_period_gates = e.evaluate_period_gates

    def qualification_override(
        gate_protocol: dict[str, object],
        period_name: str,
        analysis: dict[str, object],
    ) -> list[dict[str, object]]:
        if period_name == "development":
            return [
                {
                    "gateId": "SYNTHETIC_DEVELOPMENT_QUALIFICATION",
                    "observed": 1,
                    "operator": ">=",
                    "threshold": 1,
                    "passed": True,
                }
            ]
        return real_period_gates(gate_protocol, period_name, analysis)

    monkeypatch.setattr(e, "evaluate_period_gates", qualification_override)
    result = e.run_experiment(
        state_root=state_root,
        source_root=source_root,
        freeze_path=freeze_path,
        result_path=result_path,
        receipt_path=receipt_path,
        strict_paths=False,
    )
    assert calls == 2
    assert result["measurementVerdict"] == "NO_GO"
    assert result_path.is_file()
    assert receipt_path.is_file()
    assert (state_root / "run-marker.v1.json").is_file()
    assert (state_root / "candidate-seal.v1.json").is_file()
    assert (state_root / "holdout-open.v1.json").is_file()
    with pytest.raises(e.EvidenceError, match="already exists"):
        e.run_experiment(
            state_root=state_root,
            source_root=source_root,
            freeze_path=freeze_path,
            result_path=result_path,
            receipt_path=receipt_path,
            strict_paths=False,
        )


def test_failed_development_is_terminal_no_go_and_never_opens_holdout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    protocol, _ = e.load_protocol()
    symbols = tuple(f"S{index:02d}USDT" for index in range(30))
    bars = _bars(list(symbols), date(2025, 3, 2), date(2026, 2, 28))
    state_root = tmp_path / "state"
    result_path = tmp_path / "result.v1.json"
    receipt_path = tmp_path / "run-receipt.v1.json"
    source_root = tmp_path / "source"
    source_root.mkdir()
    calls = 0

    def fake_load_frozen(
        **_: object,
    ) -> tuple[
        dict[str, object],
        dict[str, str],
        dict[str, object],
        tuple[str, ...],
        dict[tuple[str, str], object],
        dict[str, str],
    ]:
        return (
            protocol,
            {"sourceRoot": str(source_root)},
            {},
            symbols,
            {},
            {"freezeSha256": "f" * 64},
        )

    def fake_load_bars(
        _root: Path,
        _lookup: object,
        _symbols: object,
        _months: object,
    ) -> tuple[dict[str, dict[date, e.Bar]], list[dict[str, str]]]:
        nonlocal calls
        calls += 1
        return bars, []

    monkeypatch.setattr(e, "load_frozen", fake_load_frozen)
    monkeypatch.setattr(e, "load_bars", fake_load_bars)
    monkeypatch.setattr(e, "preflight_git_snapshot", lambda *_: _fake_git_snapshot())
    result = e.run_experiment(
        state_root=state_root,
        source_root=source_root,
        freeze_path=tmp_path / "freeze.v1.json",
        result_path=result_path,
        receipt_path=receipt_path,
        strict_paths=False,
    )
    assert calls == 1
    assert result["measurementVerdict"] == "NO_GO"
    assert result["state"] == "TERMINAL_DEVELOPMENT_NO_GO_HOLDOUT_UNOPENED"
    assert result["development"] is not None
    assert result["holdout"] is None
    assert not (state_root / "candidate-seal.v1.json").exists()
    assert not (state_root / "holdout-open.v1.json").exists()


def test_every_terminal_result_requires_global_and_retrospective_limitations() -> None:
    protocol, _ = e.load_protocol()
    limitations = e.result_limitations(protocol)
    assert "GLOBAL_VG_SEARCH_MULTIPLICITY_UNRESOLVED" in limitations
    assert any(value.startswith("MARCH_TO_JUNE_2026_IS_RETROSPECTIVE") for value in limitations)
    result = e.terminal_unmeasured(
        protocol,
        {"freezeSha256": "f" * 64},
        started_at="2026-07-29T00:00:00Z",
        phase="HOLDOUT_ARCHIVE_OPEN",
        error=e.SelectedEvidenceError("missing"),
        source_issues=[],
        pre_run_git=_fake_git_snapshot(),
    )
    assert result["measurementVerdict"] == "UNMEASURED"
    assert result["limitations"] == limitations
    assert result["development"] is None
    assert result["holdout"] is None


def test_interruption_finalizer_handles_marker_only_then_existing_receipt(
    tmp_path: Path,
) -> None:
    _protocol, protocol_sha = e.load_protocol()
    freeze_path = tmp_path / "freeze.v1.json"
    freeze = {
        "schema": "VG12FreezeV1",
        "protocolSha256": protocol_sha,
        "packetSourceSha256": e.packet_source_bindings(),
    }
    freeze_path.write_bytes(_canonical(freeze))
    state_root = tmp_path / "state"
    state_root.mkdir()
    pre_run_git = _fake_git_snapshot()
    run_marker = {
        "schema": "VG12RunMarkerV1",
        "state": "SOLE_DEVELOPMENT_ARCHIVE_OPEN_RUN_CONSUMED",
        "startedAtUtc": "2026-07-29T00:00:00Z",
        "protocolSha256": protocol_sha,
        "freezeSha256": hashlib.sha256(_canonical(freeze)).hexdigest(),
        "preRunGitSha256": hashlib.sha256(_canonical(pre_run_git)).hexdigest(),
        "preRunCommit": pre_run_git["commit"],
        "preRunTree": pre_run_git["tree"],
        "preRunParent": pre_run_git["parent"],
        "preRunGit": pre_run_git,
        "trialId": e.TRIAL_ID,
        "attemptedTrialCount": 1,
        "allowedRunCount": 1,
        "consumedRunCount": 1,
        "networkPermitted": False,
        "sharedSourceMutationPermitted": False,
    }
    for name, digest in e.packet_source_bindings().items():
        run_marker[f"packet:{name}"] = digest
    (state_root / "run-marker.v1.json").write_bytes(_canonical(run_marker))
    result_path = tmp_path / "result.v1.json"
    receipt_path = tmp_path / "run-receipt.v1.json"
    first = e.finalize_unmeasured_only(
        state_root=state_root,
        freeze_path=freeze_path,
        result_path=result_path,
        receipt_path=receipt_path,
        strict_paths=False,
    )
    assert first["reasonCode"] == "INTERRUPTED_RUN_FINALIZED_WITHOUT_REOPEN"
    draft_path = state_root / e.TERMINAL_DRAFT_NAME
    assert result_path.read_bytes() == draft_path.read_bytes()
    entries, _ = e.read_phase_journal(state_root)
    assert [entry["phase"] for entry in entries] == [
        "RUN_MARKER_WRITTEN",
        "TERMINAL_FINALIZING",
    ]
    receipt = json.loads(receipt_path.read_bytes())
    run_sha = hashlib.sha256(_canonical(run_marker)).hexdigest()
    e.authenticate_receipt_copy(receipt, run_marker_sha256=run_sha)

    result_path.unlink()
    second = e.finalize_unmeasured_only(
        state_root=state_root,
        freeze_path=freeze_path,
        result_path=result_path,
        receipt_path=receipt_path,
        strict_paths=False,
    )
    assert second == first
    assert result_path.read_bytes() == draft_path.read_bytes()
    assert len(e.read_phase_journal(state_root)[0]) == 2

    journal_state = tmp_path / "state-after-terminal-journal"
    journal_state.mkdir()
    (journal_state / "run-marker.v1.json").write_bytes(_canonical(run_marker))
    e.append_phase(
        journal_state,
        "RUN_MARKER_WRITTEN",
        run_marker_sha256=run_sha,
        detail_sha256=str(run_marker["preRunGitSha256"]),
    )
    fixed_draft = e.terminal_unmeasured(
        e.load_protocol()[0],
        {
            "protocolSha256": protocol_sha,
            "freezeSha256": run_marker["freezeSha256"],
            "preRunGitSha256": run_marker["preRunGitSha256"],
            "preRunCommit": run_marker["preRunCommit"],
            "preRunTree": run_marker["preRunTree"],
            "preRunParent": run_marker["preRunParent"],
            "runMarkerSha256": run_sha,
        },
        started_at="2026-07-29T00:00:00Z",
        phase="DEVELOPMENT_ARCHIVE_OPEN",
        error=e.CustodyError("synthetic process interruption"),
        source_issues=[],
        pre_run_git=pre_run_git,
    )
    fixed_draft["completedAtUtc"] = "2026-07-29T00:00:07Z"
    fixed_record = e.persist_terminal_draft(journal_state, fixed_draft)
    e.append_phase(
        journal_state,
        "TERMINAL_FINALIZING",
        run_marker_sha256=run_sha,
        detail_sha256=str(fixed_record["sha256"]),
    )
    journal_result = tmp_path / "result-after-terminal-journal.v1.json"
    recovered = e.finalize_unmeasured_only(
        state_root=journal_state,
        freeze_path=freeze_path,
        result_path=journal_result,
        receipt_path=tmp_path / "receipt-after-terminal-journal.v1.json",
        strict_paths=False,
    )
    assert recovered == fixed_draft
    assert journal_result.read_bytes() == _canonical(fixed_draft)
    assert recovered["completedAtUtc"] == "2026-07-29T00:00:07Z"

    (state_root / "run-marker.v1.json").unlink()
    e.authenticate_receipt_copy(receipt, run_marker_sha256=run_sha)


def test_git_preflight_requires_clean_direct_child_and_head_blobs(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*args: str) -> str:
        completed = subprocess.run(
            ("git", "-C", str(repo), *args),
            check=True,
            capture_output=True,
            text=True,
        )
        return completed.stdout.strip()

    git("init", "-q")
    git("config", "user.email", "vg12@example.invalid")
    git("config", "user.name", "VG12 Test")
    (repo / "seed").write_text("base\n")
    git("add", "seed")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    packet = repo / "quant/research/vg12"
    packet.mkdir(parents=True)
    for name in (
        "OFFICIAL_SOURCE_RESEARCH.md",
        "README.md",
        "experiment.py",
        "protocol.v1.json",
        "test_experiment.py",
        "verify.py",
        "freeze.v1.json",
    ):
        (packet / name).write_text(f"{name}\n")
    git("add", "quant/research/vg12")
    git("commit", "-qm", "packet")
    snapshot = e.preflight_git_snapshot(
        packet, packet / "freeze.v1.json", {"canonicalBaseCommit": base}
    )
    assert snapshot["parent"] == base
    assert len(snapshot["headBlobs"]) == 7
    (packet / "README.md").write_text("dirty\n")
    with pytest.raises(e.CustodyError, match="clean and committed"):
        e.preflight_git_snapshot(packet, packet / "freeze.v1.json", {"canonicalBaseCommit": base})


def test_hostile_forged_go_and_gate_observation_are_rejected() -> None:
    protocol, _ = e.load_protocol()
    development = _analysis(holdout=False)
    holdout = _analysis(holdout=True)
    decisions = [
        *v.reconstructed_period_gates(protocol, "development", development),
        *v.reconstructed_period_gates(protocol, "holdout", holdout),
    ]
    result: dict[str, object] = {
        "development": development,
        "holdout": holdout,
        "gateDecisions": decisions,
        "measurementVerdict": "GO",
    }
    assert v.verify_result_semantics(result, protocol) == decisions
    forged = json.loads(json.dumps(result))
    forged["gateDecisions"][0]["observed"] = 999_999
    with pytest.raises(v.VerificationError, match="gate roster"):
        v.verify_result_semantics(forged, protocol)
    forged_verdict = json.loads(json.dumps(result))
    forged_verdict["measurementVerdict"] = "NO_GO"
    with pytest.raises(v.VerificationError, match="verdict"):
        v.verify_result_semantics(forged_verdict, protocol)
