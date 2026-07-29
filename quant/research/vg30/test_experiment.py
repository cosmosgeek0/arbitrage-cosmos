from __future__ import annotations

import hashlib
import io
import os
import zipfile
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from research.vg30 import experiment as e

D = Decimal
DEFAULT_QUOTE_VOLUME = D("10000000")
DEFAULT_OPEN_PRICE = D("10")


def _bar(
    symbol: str,
    day: date,
    *,
    quote_volume: Decimal = DEFAULT_QUOTE_VOLUME,
    open_price: Decimal = DEFAULT_OPEN_PRICE,
) -> e.Bar:
    opened = datetime(day.year, day.month, day.day, tzinfo=UTC)
    open_us = int(opened.timestamp() * 1_000_000)
    fields = (
        str(open_us),
        str(open_price),
        str(open_price),
        str(open_price),
        str(open_price),
        "1",
        str(open_us + e.DAY_US - 1),
        str(quote_volume),
        "1",
        "0",
        "0",
        "0",
    )
    return e.Bar(
        symbol=symbol,
        day=day,
        open=open_price,
        quote_volume=quote_volume,
        open_time_us=open_us,
        close_time_us=open_us + e.DAY_US - 1,
        raw_fields=fields,
    )


def _feature_bars(
    *,
    sunday: date = date(2025, 6, 29),
    symbol_count: int = 30,
    same_top: bool = False,
) -> dict[str, dict[date, e.Bar]]:
    output: dict[str, dict[date, e.Bar]] = {}
    first = sunday - timedelta(days=60)
    for index in range(symbol_count):
        symbol = f"S{index:02d}USDT"
        series: dict[date, e.Bar] = {}
        for offset in range(61):
            day = first + timedelta(days=offset)
            quote = D("10000000")
            if day == sunday:
                anomaly = D("100") if same_top and index < 4 else D(index + 1)
                quote *= D(1) + anomaly
            series[day] = _bar(symbol, day, quote_volume=quote)
        output[symbol] = series
    return output


def _synthetic_feature(
    sunday: date,
    *,
    concentration: Decimal,
    k: int = 3,
) -> e.TailFeature:
    ranked = tuple((f"S{index:02d}USDT", D(100 - index)) for index in range(30))
    medians = tuple((symbol, D("10000000")) for symbol, _ in ranked)
    return e.TailFeature(
        sunday=sunday,
        tail_fraction=D("0.10"),
        k=k,
        concentration=concentration,
        ranked_anomalies=ranked,
        prior_30d_medians=medians,
        risk_set_size=30,
        risk_set_sha256=e.canonical_sha([symbol for symbol, _ in ranked]),
    )


def _active_observation(
    *,
    sunday: date = date(2025, 9, 7),
    medians: tuple[Decimal, ...] = (D("10000000"),) * 3,
) -> e.WeeklyObservation:
    return e.WeeklyObservation(
        sunday=sunday,
        entry_day=sunday + timedelta(days=2),
        exit_day=sunday + timedelta(days=9),
        active=True,
        reason="EVENT_ACTIVE_COMPLETE_COHORT",
        symbols=("AAAUSDT", "BBBUSDT", "CCCUSDT"),
        k=3,
        risk_set_size=30,
        concentration=D("0.8"),
        threshold=D("0.7"),
        gross_factors=(D("1.01"), D("1.02"), D("1.03")),
        prior_30d_medians=medians,
    )


def _archive_artifact(
    root: Path,
    rows: list[str],
    *,
    symbol: str = "AAAUSDT",
    month: str = "2025-03",
) -> dict[str, object]:
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(f"{symbol}-1d-{month}.csv", "".join(rows))
    zip_raw = stream.getvalue()
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    checksum_path = directory / f"{zip_path.name}.CHECKSUM"
    zip_path.write_bytes(zip_raw)
    checksum_raw = f"{hashlib.sha256(zip_raw).hexdigest()}  {zip_path.name}\n".encode()
    checksum_path.write_bytes(checksum_raw)
    return {
        "checksumBytes": len(checksum_raw),
        "checksumPath": checksum_path.relative_to(root).as_posix(),
        "checksumSha256": hashlib.sha256(checksum_raw).hexdigest(),
        "month": month,
        "state": "PRESENT",
        "symbol": symbol,
        "zipBytes": len(zip_raw),
        "zipPath": zip_path.relative_to(root).as_posix(),
        "zipSha256": hashlib.sha256(zip_raw).hexdigest(),
    }


def _csv_row(
    day: date,
    *,
    open_price: str = "10",
    quote_volume: str = "10000000",
) -> str:
    opened = datetime(day.year, day.month, day.day, tzinfo=UTC)
    open_us = int(opened.timestamp() * 1_000_000)
    close_us = open_us + e.DAY_US - 1
    return (
        f"{open_us},{open_price},{open_price},{open_price},{open_price},1,"
        f"{close_us},{quote_volume},1,0,0,0\n"
    )


def test_protocol_and_trial_family_are_exact() -> None:
    protocol = e.load_protocol()
    assert protocol["authority"] == e.AUTHORITY_CONTRACT
    assert protocol["signal"]["trialCount"] == 6
    assert [trial.trial_id for trial in e.trial_grid()] == [
        "VG30-P10-Q75",
        "VG30-P10-Q90",
        "VG30-P10-Q95",
        "VG30-P20-Q75",
        "VG30-P20-Q90",
        "VG30-P20-Q95",
    ]


def test_nearest_rank_and_tail_concentration_math() -> None:
    assert e.nearest_rank([D(4), D(1), D(3), D(2)], D("0.75")) == D(3)
    bars = _feature_bars()
    feature = e.tail_feature(bars, date(2025, 6, 29), D("0.10"))
    assert feature.k == 3
    expected = (D(30) + D(29) + D(28)) / sum((D(index) for index in range(1, 31)), D(0))
    assert feature.concentration == expected
    assert [symbol for symbol, _ in feature.ranked_anomalies[:3]] == [
        "S29USDT",
        "S28USDT",
        "S27USDT",
    ]


def test_top_k_ties_use_utf8_symbol_order() -> None:
    feature = e.tail_feature(
        _feature_bars(same_top=True),
        date(2025, 6, 29),
        D("0.10"),
    )
    assert feature.k == 3
    assert [symbol for symbol, _ in feature.ranked_anomalies[:3]] == [
        "S00USDT",
        "S01USDT",
        "S02USDT",
    ]


def test_signal_is_invariant_to_future_and_price_changes() -> None:
    sunday = date(2025, 6, 29)
    bars = _feature_bars(sunday=sunday)
    before = e.tail_feature(bars, sunday, D("0.20"))
    changed: dict[str, dict[date, e.Bar]] = {}
    for symbol, series in bars.items():
        changed_series = dict(series)
        for day, bar in tuple(changed_series.items()):
            changed_series[day] = e.Bar(
                symbol=bar.symbol,
                day=bar.day,
                open=D("999999"),
                quote_volume=bar.quote_volume,
                open_time_us=bar.open_time_us,
                close_time_us=bar.close_time_us,
                raw_fields=bar.raw_fields,
            )
        future = sunday + timedelta(days=1)
        changed_series[future] = _bar(
            symbol,
            future,
            quote_volume=D("999999999999"),
            open_price=D("1"),
        )
        changed[symbol] = changed_series
    after = e.tail_feature(changed, sunday, D("0.20"))
    assert after == before


def test_monday_is_skipped_and_full_cohort_has_no_substitution() -> None:
    sunday = date(2025, 9, 7)
    features: dict[tuple[date, Decimal], e.TailFeature] = {}
    for offset in range(26, 0, -1):
        day = sunday - timedelta(days=7 * offset)
        features[(day, D("0.10"))] = _synthetic_feature(
            day,
            concentration=D("0.40") + D(26 - offset) / D(1000),
        )
    features[(sunday, D("0.10"))] = _synthetic_feature(
        sunday,
        concentration=D("0.90"),
    )
    bars: dict[str, dict[date, e.Bar]] = {}
    for index in range(4):
        symbol = f"S{index:02d}USDT"
        bars[symbol] = {
            sunday + timedelta(days=2): _bar(
                symbol, sunday + timedelta(days=2), open_price=D("10")
            ),
            sunday + timedelta(days=9): _bar(
                symbol, sunday + timedelta(days=9), open_price=D("11")
            ),
        }
    trial = e.Trial("VG30-P10-Q75", D("0.10"), D("0.75"))
    observation = e.build_observations(
        trial=trial,
        sundays=(sunday,),
        features=features,
        bars=bars,
    )[0]
    assert observation.entry_day.weekday() == 1
    assert observation.entry_day == sunday + timedelta(days=2)
    assert observation.exit_day == sunday + timedelta(days=9)
    assert observation.symbols == ("S00USDT", "S01USDT", "S02USDT")

    del bars["S01USDT"][sunday + timedelta(days=9)]
    with pytest.raises(e.MeasurementError, match="SELECTED_ENTRY_OR_EXIT_MISSING"):
        e.build_observations(
            trial=trial,
            sundays=(sunday,),
            features=features,
            bars=bars,
        )


def test_missing_required_risk_set_is_terminal_not_cash() -> None:
    with pytest.raises(e.MeasurementError, match="RISK_SET_BELOW_30"):
        e.tail_feature(
            _feature_bars(symbol_count=29),
            date(2025, 6, 29),
            D("0.10"),
        )


def test_liquid_symbol_with_undefined_anomaly_is_terminal_not_silently_dropped() -> None:
    sunday = date(2025, 6, 29)
    bars = _feature_bars(sunday=sunday, symbol_count=31)
    symbol = "S30USDT"
    for offset in range(31):
        day = sunday - timedelta(days=60 - offset)
        bars[symbol][day] = _bar(symbol, day, quote_volume=D(0))
    with pytest.raises(
        e.MeasurementError,
        match="ELIGIBLE_PRIOR_60_MEDIAN_NONPOSITIVE",
    ):
        e.tail_feature(bars, sunday, D("0.10"))


def test_missing_prior_26_sunday_history_is_terminal_not_warmup_cash() -> None:
    earliest = date(2025, 3, 2)
    sunday = date(2025, 7, 6)
    features = {
        (earliest, D("0.10")): _synthetic_feature(
            earliest,
            concentration=D("0.5"),
        )
    }
    trial = e.Trial("VG30-P10-Q75", D("0.10"), D("0.75"))
    with pytest.raises(
        e.MeasurementError,
        match="EXACT_PRIOR_26_SUNDAY_TAIL_HISTORY_UNAVAILABLE",
    ):
        e.build_observations(
            trial=trial,
            sundays=(sunday,),
            features=features,
            bars={},
        )


def test_non_return_warmup_exactly_covers_first_development_history() -> None:
    first_feature = e.SOURCE_START + timedelta(days=e.ANOMALY_LOOKBACK_DAYS)
    while first_feature.weekday() != 6:
        first_feature += timedelta(days=1)
    first_development = e.contained_sundays(
        e.DEVELOPMENT_START,
        e.DEVELOPMENT_END_EXCLUSIVE,
    )[0]
    assert first_feature == first_development - timedelta(days=7 * e.PRIOR_SUNDAYS)


def test_cost_math_matches_frozen_fill_accounting() -> None:
    fee_only = e.cost_adjusted_factor(D(1), fee=D("0.001"), adverse=D(0))
    assert fee_only == D("0.999") * D("0.999")
    base = e.cost_adjusted_factor(D(1), fee=D("0.001"), adverse=D("0.001"))
    expected = (D("0.999") / D("1.001")) * D("0.999") * D("0.999")
    assert base == expected
    assert e.cohort_factor(
        (D("1.1"), D("0.9")),
        fee=D(0),
        adverse=D(0),
    ) == D(1)


def test_capacity_proxy_uses_k_times_weakest_prior_median() -> None:
    summary = e._capacity_summary(
        (_active_observation(medians=(D("10000000"), D("20000000"), D("30000000"))),)
    )
    assert e.decimal_value(summary["baseP05Usdt"], "baseP05Usdt") == D("3000")
    assert e.decimal_value(summary["stressP05Usdt"], "stressP05Usdt") == D("1500")
    assert summary["executableCapacity"] is None


def test_gate_inputs_are_not_rounded_across_capacity_or_drawdown_boundaries() -> None:
    metrics = {
        "capacity": {"stressP05Usdt": e.decimal_text(D("999.9999999999996"))},
        "scenarios": {
            "base": {"netMeanUsdtPer1000PerWeek": "1"},
            "stress": {
                "maximumDrawdown": e.decimal_text(D("0.2000000000004")),
                "netMeanUsdtPer1000PerWeek": "1",
            },
        },
        "selection": {
            "activeCohorts": 6,
            "activeMonths": ["2026-03", "2026-04", "2026-05"],
            "distinctHeldSymbols": [
                "AAAUSDT",
                "BBBUSDT",
                "CCCUSDT",
                "DDDUSDT",
                "EEEUSDT",
            ],
            "maxSingleSymbolSelectionShare": "0.20",
        },
    }
    interval = {"oneSided95LcbUsdtPer1000PerWeek": "1"}
    reasons = e.holdout_gate_reasons(
        metrics,
        base_interval=interval,
        stress_interval=interval,
    )
    assert "STRESS_CAPACITY_PROXY_P05_BELOW_1000" in reasons
    assert "STRESS_MAXIMUM_DRAWDOWN_ABOVE_0_20" in reasons


def test_drawdown_uses_observed_nav_path() -> None:
    assert e.maximum_drawdown((D("1000"), D("1100"), D("880"))) == D("0.20")


def test_binance_archive_timestamp_transition_and_utc_boundary_are_strict() -> None:
    day = date(2025, 3, 1)
    row = tuple(_csv_row(day).strip().split(","))
    parsed = e.parse_kline_row("AAAUSDT", "2025-03", row, context="synthetic")
    assert parsed.day == day
    millisecond = list(row)
    millisecond[0] = str(int(millisecond[0]) // 1000)
    millisecond[6] = str(int(millisecond[6]) // 1000)
    with pytest.raises(e.MeasurementError, match="microsecond"):
        e.parse_kline_row(
            "AAAUSDT",
            "2025-03",
            tuple(millisecond),
            context="synthetic",
        )
    prior_day = date(2024, 12, 1)
    prior_row = list(_csv_row(prior_day).strip().split(","))
    prior_row[0] = str(int(prior_row[0]) // 1000)
    prior_row[6] = str(int(prior_row[6]) // 1000)
    prior = e.parse_kline_row(
        "AAAUSDT",
        "2024-12",
        tuple(prior_row),
        context="synthetic",
    )
    assert prior.day == prior_day
    assert prior.close_time_us == prior.open_time_us + e.DAY_US - 1
    with pytest.raises(e.MeasurementError, match="millisecond"):
        e.parse_kline_row(
            "AAAUSDT",
            "2024-12",
            tuple(_csv_row(prior_day).strip().split(",")),
            context="synthetic",
        )


def test_adjacent_exact_duplicate_canonicalizes_but_conflict_and_nonadjacent_fail(
    tmp_path: Path,
) -> None:
    day1 = date(2025, 3, 1)
    day2 = date(2025, 3, 2)
    exact = _csv_row(day1)
    artifact = _archive_artifact(tmp_path / "exact", [exact, exact])
    bars, duplicates = e.parse_archive(artifact, source_root=tmp_path / "exact")
    assert len(bars) == 1
    assert len(duplicates) == 1

    conflict = _archive_artifact(
        tmp_path / "conflict",
        [exact, _csv_row(day1, open_price="11")],
    )
    with pytest.raises(e.MeasurementError, match="CONFLICTING_DUPLICATE"):
        e.parse_archive(conflict, source_root=tmp_path / "conflict")

    nonadjacent = _archive_artifact(
        tmp_path / "nonadjacent",
        [exact, _csv_row(day2), exact],
    )
    with pytest.raises(e.MeasurementError, match="NON_ADJACENT_DUPLICATE"):
        e.parse_archive(nonadjacent, source_root=tmp_path / "nonadjacent")


def test_exclusive_marker_cannot_replay_and_is_mode_0600(tmp_path: Path) -> None:
    marker = tmp_path / "marker.json"
    e.write_exclusive(marker, b"{}\n", mode=0o600)
    assert os.stat(marker).st_mode & 0o777 == 0o600
    with pytest.raises(e.CustodyError, match="already exists"):
        e.write_exclusive(marker, b"{}\n", mode=0o600)


def test_failed_development_never_authorizes_holdout() -> None:
    failed = {
        "gates": {"failed": ["BASE_NET_MEAN_NOT_POSITIVE"], "passed": False},
        "selectedChampionTrialId": "VG30-P10-Q75",
        "status": "MEASURED",
    }
    assert e.holdout_open_authorized(failed) is False
    result = {
        "candidateSealed": False,
        "holdoutOpened": False,
    }
    names = e.terminal_expected_names(result)
    assert "candidate.v1.json" not in names
    assert "holdout-open.v1.json" not in names
    assert "holdout-result.v1.json" not in names


def test_null_diagnostics_are_not_false_zero() -> None:
    observations = [
        {
            "active": False,
            "entryDay": (date(2025, 7, 1) + timedelta(days=7 * index)).isoformat(),
        }
        for index in range(34)
    ]
    scenarios = {
        "base": {
            "weeklyNetUsdtPer1000": ["0"] * 34,
        }
    }
    metrics = {
        trial_id: {"observations": observations, "scenarios": scenarios} for trial_id in ("A", "B")
    }
    pbo = e.pbo_diagnostic(metrics)
    assert pbo["status"] == "UNDEFINED"
    assert pbo["pbo"] is None
    assert pbo["reason"] == "FEWER_THAN_TWO_DISTINCT_TRIAL_SERIES"
    assert e._capacity_summary(())["stressP05Usdt"] is None


def test_pbo_mean_score_ties_are_undefined_not_zero() -> None:
    months = (
        *(f"2025-{month:02d}" for month in range(7, 13)),
        "2026-01",
        "2026-02",
    )
    observations = [
        {"active": False, "entryDay": f"{month}-{day:02d}"} for month in months for day in (1, 8)
    ]
    metrics = {
        "A": {
            "observations": observations,
            "scenarios": {"base": {"weeklyNetUsdtPer1000": ["1", "-1"] * 8}},
        },
        "B": {
            "observations": observations,
            "scenarios": {"base": {"weeklyNetUsdtPer1000": ["-1", "1"] * 8}},
        },
    }
    pbo = e.pbo_diagnostic(metrics)
    assert pbo["status"] == "UNDEFINED"
    assert pbo["pbo"] is None
    assert pbo["reason"] == "ONE_OR_MORE_CSCV_MEAN_SCORE_TIES"


def test_synchronized_bootstrap_and_holm_are_deterministic() -> None:
    draws_a = e.circular_draw_indices(8, replicates=32, seed=7)
    draws_b = e.circular_draw_indices(8, replicates=32, seed=7)
    assert draws_a == draws_b
    interval = e.bootstrap_interval(
        tuple(D(index) for index in range(1, 9)),
        draws_a,
    )
    assert interval["replicates"] == 32
    adjusted = e.holm_adjusted({"A": D("0.01"), "B": D("0.03"), "C": D("0.04")})
    assert adjusted == {"A": D("0.03"), "B": D("0.06"), "C": D("0.06")}


def _write_checksum_packet(packet: Path, names: tuple[str, ...]) -> None:
    packet.mkdir()
    for index, name in enumerate(names):
        (packet / name).write_bytes(f"payload-{index}\n".encode())
    rows = [
        f"{hashlib.sha256((packet / name).read_bytes()).hexdigest()}  {name}\n"
        for name in sorted(names)
    ]
    (packet / "SHA256SUMS").write_text("".join(rows), encoding="ascii")


def test_checksum_verifier_rejects_tamper_and_extra_inventory(tmp_path: Path) -> None:
    names = ("a.json", "b.md")
    packet = tmp_path / "packet"
    _write_checksum_packet(packet, names)
    e.verify_checksums(packet=packet, expected_names=names)
    (packet / "a.json").write_text("tampered\n", encoding="utf-8")
    with pytest.raises(e.CustodyError, match="checksum mismatch"):
        e.verify_checksums(packet=packet, expected_names=names)

    packet2 = tmp_path / "packet2"
    _write_checksum_packet(packet2, names)
    (packet2 / "extra.txt").write_text("extra\n", encoding="utf-8")
    with pytest.raises(e.CustodyError, match="directory inventory drifted"):
        e.verify_checksums(packet=packet2, expected_names=names)

    packet3 = tmp_path / "packet3"
    _write_checksum_packet(packet3, names)
    (packet3 / ".hidden-directory").mkdir()
    with pytest.raises(e.CustodyError, match="invalid entry"):
        e.verify_checksums(packet=packet3, expected_names=names)


def test_source_freeze_binds_exact_present_and_absent_inventory(tmp_path: Path) -> None:
    root = tmp_path / "source"
    symbol = "AAAUSDT"
    month = "2025-01"
    directory = root / "archives" / symbol / month
    directory.mkdir(parents=True)
    zip_raw = b"compressed-zip-bytes-not-opened"
    zip_path = directory / f"{symbol}-1d-{month}.zip"
    checksum_path = directory / f"{zip_path.name}.CHECKSUM"
    zip_path.write_bytes(zip_raw)
    checksum_raw = f"{hashlib.sha256(zip_raw).hexdigest()}  {zip_path.name}\n".encode()
    checksum_path.write_bytes(checksum_raw)
    pair = {
        "checksumBytes": len(checksum_raw),
        "checksumFrozenEtag": "checksum-etag",
        "checksumFrozenLastModified": "2026-07-01T00:00:00.000Z",
        "checksumKey": (f"data/spot/monthly/klines/{symbol}/1d/{zip_path.name}.CHECKSUM"),
        "checksumListedBytes": len(checksum_raw),
        "checksumSha256": hashlib.sha256(checksum_raw).hexdigest(),
        "month": month,
        "state": "DOWNLOADED_VERIFIED",
        "symbol": symbol,
        "zipBytes": len(zip_raw),
        "zipFrozenEtag": "zip-etag",
        "zipFrozenLastModified": "2026-07-01T00:00:00.000Z",
        "zipKey": f"data/spot/monthly/klines/{symbol}/1d/{zip_path.name}",
        "zipListedBytes": len(zip_raw),
        "zipSha256": hashlib.sha256(zip_raw).hexdigest(),
    }
    pair_receipt = {key: pair[key] for key in e.PAIR_FIELDS} | {"schema": "S1FLocalArchivePairV1"}
    (directory / "pair.v1.json").write_bytes(e.canonical_bytes(pair_receipt))

    protocol = e.load_protocol()
    universe_contract = protocol["universe"]
    discovery = {
        "exclusions": {
            "pairedLeveragedSha256": universe_contract["excludedPairedLeveragedSha256"],
            "pairedLeveragedSymbols": universe_contract["excludedPairedLeveragedSymbols"],
            "stableOrFiatSha256": universe_contract["excludedStableOrFiatSha256"],
            "stableOrFiatSymbols": universe_contract["excludedStableOrFiatSymbols"],
        },
        "schema": "S1FArchiveDiscoveryV1",
        "state": "METADATA_ONLY_NO_ARCHIVE_BODY_OPENED",
        "symbolInventories": [
            {
                "months": {
                    month: {
                        "checksum": {
                            "etag": pair["checksumFrozenEtag"],
                            "key": pair["checksumKey"],
                            "lastModified": pair["checksumFrozenLastModified"],
                            "size": pair["checksumListedBytes"],
                        },
                        "zip": {
                            "etag": pair["zipFrozenEtag"],
                            "key": pair["zipKey"],
                            "lastModified": pair["zipFrozenLastModified"],
                            "size": pair["zipListedBytes"],
                        },
                    }
                },
                "symbol": symbol,
            }
        ],
        "universe": {
            "count": 1,
            "sha256": hashlib.sha256(e.normalized_lines([symbol])).hexdigest(),
            "symbols": [symbol],
        },
    }
    discovery_raw = e.canonical_bytes(discovery)
    root.mkdir(exist_ok=True)
    (root / "discovery.v1.json").write_bytes(discovery_raw)
    absent = [f"{symbol}|{value}" for value in e.SOURCE_MONTHS if value != month]
    acquisition = {
        "absentSha256": hashlib.sha256(e.normalized_lines(absent)).hexdigest(),
        "absentSymbolMonthCount": len(absent),
        "absentSymbolMonths": absent,
        "archiveBodiesDecompressed": False,
        "artifactPairCount": 1,
        "artifactPairs": [pair],
        "artifactRowsSha256": hashlib.sha256(
            e.normalized_lines([e.canonical_sha(pair)])
        ).hexdigest(),
        "discoverySha256": hashlib.sha256(discovery_raw).hexdigest(),
        "schema": "S1FAcquisitionManifestV1",
        "state": "CHECKSUM_VERIFIED_ARCHIVES_NOT_DECOMPRESSED",
    }
    (root / "acquisition-manifest.v1.json").write_bytes(e.canonical_bytes(acquisition))
    frozen = e._source_inventory(source_root=root, enforce_shared_pins=False)
    assert frozen["inventoryPresentCount"] == 1
    assert frozen["inventoryAbsentCount"] == len(e.SOURCE_MONTHS) - 1
    assert frozen["inventoryRowCount"] == len(e.SOURCE_MONTHS)

    absent_zip, _absent_checksum, _absent_pair = e.expected_archive_paths(root, symbol, "2025-02")
    absent_zip.parent.mkdir(parents=True)
    absent_zip.write_bytes(b"forbidden")
    with pytest.raises(e.CustodyError, match="absent identity has local bytes"):
        e._source_inventory(source_root=root, enforce_shared_pins=False)


def test_exact_terminal_inventory_rejects_holdout_without_candidate() -> None:
    with pytest.raises(e.CustodyError, match="without a candidate"):
        e.terminal_expected_names({"candidateSealed": False, "holdoutOpened": True})


def test_verdict_semantics_reject_gate_contradiction() -> None:
    development = {
        "gates": {"failed": ["BASE_NET_MEAN_NOT_POSITIVE"], "passed": False},
        "pbo": {"pbo": None, "status": "UNDEFINED"},
        "selectedChampionTrialId": "VG30-P10-Q75",
        "status": "MEASURED",
    }
    result = {
        "candidateSealed": False,
        "development": {
            "gates": development["gates"],
            "pbo": development["pbo"],
            "selectedChampionTrialId": development["selectedChampionTrialId"],
            "status": development["status"],
        },
        "holdout": None,
        "holdoutOpened": False,
        "publicScenarioVerdict": "NO_GO",
        "reason": "ONE_OR_MORE_FROZEN_DEVELOPMENT_GATES_FAILED",
    }
    e.verify_verdict_semantics(result, development, None)
    result["publicScenarioVerdict"] = "GO"
    with pytest.raises(e.CustodyError, match="contradicts"):
        e.verify_verdict_semantics(result, development, None)
