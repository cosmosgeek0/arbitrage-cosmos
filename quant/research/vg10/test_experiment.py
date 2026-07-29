from __future__ import annotations

# The suite intentionally uses stdlib unittest so network-free verification does
# not depend on pytest collection behavior.
# ruff: noqa: PT009, PT027
import io
import itertools
import json
import tempfile
import unittest
import urllib.request
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from quant.research.vg10 import experiment as vg

EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
NOW = datetime(2026, 7, 29, 16, 9, 15, tzinfo=UTC)


def micros(value: datetime) -> int:
    delta = value - EPOCH
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def csv_row(
    timestamp: datetime,
    *,
    interval_minutes: int = 15,
    price: str = "10",
    base: str = "10",
    quote: str = "100",
    taker_base: str = "6",
    taker_quote: str = "60",
) -> list[str]:
    return [
        str(micros(timestamp)),
        price,
        price,
        price,
        price,
        base,
        str(micros(timestamp) + interval_minutes * 60 * 1_000_000 - 1),
        quote,
        "1",
        taker_base,
        taker_quote,
        "0",
    ]


def archive_bytes(
    symbol: str,
    month: str,
    interval: str,
    rows: list[list[str]],
    *,
    member: str | None = None,
) -> tuple[bytes, bytes]:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        text = "".join(",".join(row) + "\n" for row in rows)
        archive.writestr(member or f"{symbol}-{interval}-{month}.csv", text)
    raw = buffer.getvalue()
    name = f"{symbol}-{interval}-{month}.zip"
    sidecar = f"{vg.sha256_bytes(raw)}  {name}\n".encode("ascii")
    return raw, sidecar


def full_month_rows(month: str) -> list[list[str]]:
    start, end = vg.month_bounds(month)
    rows: list[list[str]] = []
    current = start
    while current < end:
        rows.append(csv_row(current))
        current += timedelta(minutes=15)
    return rows


def bar(
    symbol: str,
    timestamp: datetime,
    *,
    price: str = "10",
    quote: str = "100",
    taker_quote: str = "60",
) -> vg.KlineBar:
    row = tuple(csv_row(timestamp, price=price, quote=quote, taker_quote=taker_quote))
    return vg.KlineBar(
        symbol=symbol,
        open_time=timestamp,
        open_price=Decimal(price),
        high_price=Decimal(price),
        low_price=Decimal(price),
        close_price=Decimal(price),
        base_volume=Decimal("10"),
        quote_volume=Decimal(quote),
        close_time_microseconds=micros(timestamp) + 15 * 60 * 1_000_000 - 1,
        trade_count=1,
        taker_buy_base_volume=Decimal("6"),
        taker_buy_quote_volume=Decimal(taker_quote),
        ignored=Decimal("0"),
        raw_row=row,
    )


def minimal_cohort() -> dict[str, object]:
    symbols = [f"X{index:02d}USDT" for index in range(40)]
    return {
        "schema": "VG10StaticCohortV1",
        "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
        "sourceMode": "READ_ONLY",
        "currentExchangeInfoUsed": False,
        "futureStatusFilterUsed": False,
        "selectedSymbols": symbols,
        "ranking": [
            {"rank": index, "symbol": symbol} for index, symbol in enumerate(symbols, start=1)
        ],
    }


def replace_json(path: Path, value: dict[str, object]) -> None:
    path.write_bytes(vg.canonical_bytes(value))


def initialize_synthetic_state(state: Path) -> dict[str, object]:
    source = dict(vg.source_freeze(state, now=NOW))
    packet_manifest = vg.require_mapping(source["packetManifest"], "packetManifest")
    vg.write_json_exclusive(
        state / "cohort-freeze-start.v1.json",
        {
            "schema": "VG10CohortFreezeStartV1",
            "startedAtUtc": vg.utc_text(NOW),
            "sourceFreezeSha256": vg.sha256_path(state / "source-freeze.v1.json"),
            "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
            "packetAggregateSha256": packet_manifest["aggregateSha256"],
        },
    )
    cohort = minimal_cohort()
    vg.write_json_exclusive(state / "cohort.v1.json", cohort)
    return cohort


def write_synthetic_acquisition(state: Path, phase: str) -> dict[str, object]:
    protocol = vg.load_protocol()
    cohort = vg.load_cohort(state)
    symbols = tuple(str(item) for item in cohort["selectedSymbols"])
    months = vg._phase_months(protocol, phase)
    marker: dict[str, object] = {
        "schema": f"VG10Acquire{phase.title()}StartV1",
        "startedAtUtc": vg.utc_text(NOW),
        "network": False,
        "offline": True,
        "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
        "cohortSha256": vg.sha256_path(state / "cohort.v1.json"),
        "candidateSealSha256": None,
        "holdoutOpenSha256": None,
    }
    if phase == "holdout":
        marker["candidateSealSha256"] = vg.sha256_path(state / "candidate-seal.v1.json")
        marker["holdoutOpenSha256"] = vg.sha256_path(state / "holdout-open.v1.json")
    vg.write_json_exclusive(state / f"acquire-{phase}-start.v1.json", marker)
    data = protocol["data"]
    records: list[dict[str, object]] = []
    for symbol in symbols:
        destination = state / "archives" / phase / symbol
        destination.mkdir(parents=True, exist_ok=True)
        for month in months:
            zip_name = f"{symbol}-15m-{month}.zip"
            sidecar_name = zip_name + ".CHECKSUM"
            raw = f"synthetic:{phase}:{symbol}:{month}".encode()
            digest = vg.sha256_bytes(raw)
            sidecar = f"{digest}  {zip_name}\n".encode()
            zip_path = destination / zip_name
            sidecar_path = destination / sidecar_name
            zip_path.write_bytes(raw)
            sidecar_path.write_bytes(sidecar)
            records.append(
                {
                    "symbol": symbol,
                    "month": month,
                    "url": str(data["archiveTemplate"]).format(symbol=symbol, month=month),
                    "sidecarUrl": str(data["sidecarTemplate"]).format(symbol=symbol, month=month),
                    "retrievalUtc": vg.utc_text(NOW),
                    "transport": "OFFLINE_EXPLICIT",
                    "status": {"sidecar": 200, "zip": 200},
                    "byteLength": {"sidecar": len(sidecar), "zip": len(raw)},
                    "etag": {"sidecar": None, "zip": None},
                    "lastModified": {"sidecar": None, "zip": None},
                    "checksumBytesSha256": vg.sha256_bytes(sidecar),
                    "expectedZipSha256": digest,
                    "observedZipSha256": digest,
                    "sidecarStateRelativePath": sidecar_path.relative_to(state).as_posix(),
                    "zipStateRelativePath": zip_path.relative_to(state).as_posix(),
                }
            )
    manifest: dict[str, object] = {
        "schema": f"VG10{phase.title()}AcquisitionManifestV1",
        "phase": phase,
        "createdAtUtc": vg.utc_text(NOW),
        "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
        "cohortSha256": vg.sha256_path(state / "cohort.v1.json"),
        "symbolCount": 40,
        "months": list(months),
        "archiveCount": len(records),
        "records": records,
    }
    vg.write_json_exclusive(state / f"acquisition-{phase}.v1.json", manifest)
    return manifest


def synthetic_development_analysis(*, passes: bool) -> dict[str, object]:
    protocol = vg.load_protocol()
    specs = {spec.trial_id: spec for spec in vg.trial_specs(protocol)}
    p_value = 0.001 if passes else 0.5
    lower = 0.01 if passes else -0.01
    adjusted = vg.holm_adjust(dict.fromkeys(specs, p_value))
    rank = 1.0 if passes else 16.0
    relative = 1.0 if passes else 0.0
    below = not passes
    blocks = tuple(str(item) for item in protocol["statistics"]["pbo"]["blocks"])
    first_trial = min(specs)
    splits: list[dict[str, object]] = []
    for train in itertools.combinations(blocks, 4):
        test = tuple(block for block in blocks if block not in train)
        splits.append(
            {
                "trainBlocks": list(train),
                "testBlocks": list(test),
                "selectedTrialId": first_trial,
                "outOfSampleAverageRank": rank,
                "outOfSampleRelativeRank": relative,
                "belowMedian": below,
            }
        )
    pbo_value = 0.0 if passes else 1.0
    pbo: dict[str, object] = {
        "splitCount": 70,
        "belowMedianCount": 0 if passes else 70,
        "pbo": pbo_value,
        "splits": splits,
    }
    gate = protocol["gates"]["development"]
    trials: dict[str, dict[str, object]] = {}
    passing_ids: list[str] = []
    for trial_id in sorted(specs):
        result: dict[str, object] = {
            "validFormations": 1000,
            "selectedObservations": 3000,
            "minimumEligibleSymbols": 20,
            "absolute7d": {
                "lower95": lower,
                "oneSidedCenteredNullP": p_value,
            },
            "matchedExcess7d": {
                "lower95": lower,
                "oneSidedCenteredNullP": p_value,
            },
            "absolute14d": {"lower95": lower},
            "matchedExcess14d": {"lower95": lower},
            "maximumDrawdownPct": 1.0,
            "maximumParticipationBps": 1.0,
            "holmAbsoluteP": adjusted[trial_id],
            "holmMatchedExcessP": adjusted[trial_id],
        }
        gates = list(
            vg.gate_trial(
                result,
                adjusted[trial_id],
                adjusted[trial_id],
                pbo_value,
                gate,
                development=True,
            )
        )
        result["gates"] = gates
        result["passesDevelopment"] = all(item["pass"] for item in gates)
        if result["passesDevelopment"]:
            passing_ids.append(trial_id)
        trials[trial_id] = result
    champion = vg.select_development_champion(passing_ids, trials, specs)
    return {
        "schema": "VG10DevelopmentAnalysisV1",
        "primaryScenario": "FEE_STRESS",
        "trialCount": 16,
        "trials": trials,
        "holmAbsolute": adjusted,
        "holmMatchedExcess": adjusted,
        "pbo": pbo,
        "passingTrialIds": passing_ids,
        "championTrialId": champion,
        "developmentGatesPass": champion is not None,
        "globalSiblingCampaignMultiplicity": "UNKNOWN_UNADJUSTED",
    }


def archive_count(manifest: dict[str, object]) -> int:
    value = manifest["archiveCount"]
    if not isinstance(value, int) or isinstance(value, bool):
        raise AssertionError("synthetic archive count is not an integer")
    return value


def write_synthetic_run_start(state: Path, phase: str) -> None:
    payload: dict[str, object] = {
        "schema": f"VG10{phase.title()}RunStartV1",
        "startedAtUtc": vg.utc_text(NOW),
        "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
        "cohortSha256": vg.sha256_path(state / "cohort.v1.json"),
    }
    if phase == "holdout":
        payload["candidateSealSha256"] = vg.sha256_path(state / "candidate-seal.v1.json")
        payload["holdoutOpenSha256"] = vg.sha256_path(state / "holdout-open.v1.json")
        payload["holdoutAcquisitionSha256"] = vg.sha256_path(state / "acquisition-holdout.v1.json")
    else:
        payload["acquisitionSha256"] = vg.sha256_path(state / "acquisition-development.v1.json")
    vg.write_json_exclusive(state / f"{phase}-run-start.v1.json", payload)


def write_synthetic_body_open_attempt(state: Path, phase: str, *, archives: int) -> None:
    payload: dict[str, object] = {
        "schema": f"VG10{phase.title()}BodyOpenAttemptV1",
        "attemptedAtUtc": vg.utc_text(NOW),
        "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
        "cohortSha256": vg.sha256_path(state / "cohort.v1.json"),
        "acquisitionSha256": vg.sha256_path(state / f"acquisition-{phase}.v1.json"),
        "candidateSealSha256": None,
        "holdoutOpenSha256": None,
        "expectedArchiveCount": archives,
        "archiveMemberBodiesRead": "UNMEASURED_MAY_BE_NONZERO",
        "allExpectedArchiveBodiesLoaded": False,
    }
    if phase == "holdout":
        payload["candidateSealSha256"] = vg.sha256_path(state / "candidate-seal.v1.json")
        payload["holdoutOpenSha256"] = vg.sha256_path(state / "holdout-open.v1.json")
    vg.write_json_exclusive(state / f"{phase}-body-open-attempt.v1.json", payload)


def write_synthetic_body_open(state: Path, phase: str, *, archives: int) -> None:
    attempt_path = state / f"{phase}-body-open-attempt.v1.json"
    payload: dict[str, object] = {
        "schema": f"VG10{phase.title()}BodyOpenV1",
        "openedAtUtc": vg.utc_text(NOW),
        "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
        "cohortSha256": vg.sha256_path(state / "cohort.v1.json"),
        "acquisitionSha256": vg.sha256_path(state / f"acquisition-{phase}.v1.json"),
        "candidateSealSha256": None,
        "holdoutOpenSha256": None,
        "bodyOpenAttemptSha256": vg.sha256_path(attempt_path),
        "expectedArchiveCount": archives,
        "loadedArchiveBodyCount": archives,
        "allExpectedArchiveBodiesLoaded": True,
    }
    if phase == "holdout":
        payload["candidateSealSha256"] = vg.sha256_path(state / "candidate-seal.v1.json")
        payload["holdoutOpenSha256"] = vg.sha256_path(state / "holdout-open.v1.json")
    vg.write_json_exclusive(state / f"{phase}-body-open.v1.json", payload)


def write_synthetic_development_chain(
    state: Path,
    *,
    passes: bool = True,
) -> dict[str, object]:
    archives = archive_count(write_synthetic_acquisition(state, "development"))
    write_synthetic_run_start(state, "development")
    write_synthetic_body_open_attempt(state, "development", archives=archives)
    write_synthetic_body_open(state, "development", archives=archives)
    analysis = synthetic_development_analysis(passes=passes)
    analysis.update(
        {
            "completedAtUtc": vg.utc_text(NOW),
            "protocolSha256": vg.sha256_path(vg.PROTOCOL_PATH),
            "cohortSha256": vg.sha256_path(state / "cohort.v1.json"),
            "acquisitionSha256": vg.sha256_path(state / "acquisition-development.v1.json"),
        }
    )
    vg.write_json_exclusive(state / "development-result.v1.json", analysis)
    return analysis


class ProtocolTests(unittest.TestCase):
    def test_protocol_freezes_exact_distinct_family(self) -> None:
        protocol = vg.load_protocol()
        self.assertEqual(len(vg.trial_specs(protocol)), 16)
        self.assertEqual(
            vg.trial_specs(protocol)[0].trial_id,
            "D14_P3_K03_H02",
        )
        forbidden = protocol["distinctness"]["explicitlyForbiddenSignalInputs"]
        self.assertIn("RAW_VOLUME_TIME_OF_DAY_RESIDUAL", forbidden)
        self.assertEqual(
            protocol["distinctness"]["timeOfDayAdjustment"],
            "TAKER_BUY_IMBALANCE_ONLY_NEVER_RAW_VOLUME",
        )
        for sibling in range(15, 39):
            self.assertIn(f"notVG{sibling}", protocol["distinctness"])
        self.assertIn("PRICE_IMPACT_EFFICIENCY", forbidden)
        self.assertIn("ABNORMAL_VOLUME_BREADTH_ALLOCATION", forbidden)

    def test_month_range_is_closed_and_ordered(self) -> None:
        self.assertEqual(
            vg.month_range("2025-12", "2026-02"),
            ("2025-12", "2026-01", "2026-02"),
        )

    def test_decision_schedule_does_not_overlap_at_max_h(self) -> None:
        decisions = vg.decisions_between(
            datetime(2025, 7, 1, tzinfo=UTC),
            datetime(2025, 7, 3, tzinfo=UTC),
            (0, 6, 12, 18),
        )
        self.assertEqual(len(decisions), 8)
        vg.assert_nonoverlap(decisions, 4)
        with self.assertRaises(vg.EvidenceError):
            vg.assert_nonoverlap(
                (
                    datetime(2025, 7, 1, 0, tzinfo=UTC),
                    datetime(2025, 7, 1, 3, tzinfo=UTC),
                ),
                4,
            )

    def test_paired_leveraged_policy_does_not_drop_jup(self) -> None:
        protocol = vg.load_protocol()
        self.assertFalse(vg.excluded_base_asset("JUPUSDT", protocol, {"JUPUSDT"}))
        discovered = {"BTCUPUSDT", "BTCDOWNUSDT", "JUPUSDT"}
        self.assertTrue(vg.excluded_base_asset("BTCUPUSDT", protocol, discovered))
        self.assertTrue(vg.excluded_base_asset("BTCDOWNUSDT", protocol, discovered))
        self.assertTrue(vg.excluded_base_asset("BULLUSDT", protocol, discovered))
        self.assertTrue(vg.excluded_base_asset("USDEUSDT", protocol, discovered))
        self.assertFalse(vg.excluded_base_asset("JUPUSDT", protocol, discovered))


class ArchiveContractTests(unittest.TestCase):
    def test_public_archive_authority_redirect_and_size_are_closed(self) -> None:
        valid = (
            "https://data.binance.vision/data/spot/monthly/klines/"
            "BTCUSDT/15m/BTCUSDT-15m-2026-01.zip"
        )
        vg._validate_public_archive_url(valid)
        invalid = (
            valid.replace("https://", "http://"),
            valid.replace("data.binance.vision", "data.binance.vision.evil.example"),
            valid.replace("data.binance.vision", "user@data.binance.vision"),
            valid.replace("data.binance.vision", "data.binance.vision:443"),
            valid.replace("/BTCUSDT/", "/../"),
        )
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(vg.EvidenceError):
                vg._validate_public_archive_url(url)
        with self.assertRaisesRegex(vg.EvidenceError, "redirects are forbidden"):
            vg._NoRedirectHandler().redirect_request(
                urllib.request.Request(valid),
                None,
                302,
                "Found",
                {},
                valid,
            )
        with self.assertRaisesRegex(vg.EvidenceError, "exceeds frozen byte cap"):
            vg._read_bounded(io.BytesIO(b"123456789"), 8)

    def test_imbalance_formula_and_bounds(self) -> None:
        item = bar("AAAUSDT", datetime(2025, 6, 1, tzinfo=UTC), quote="100", taker_quote="75")
        self.assertEqual(item.imbalance, Decimal("0.5"))

    def test_microsecond_timestamp_rejects_milliseconds_and_preserves_exact_value(self) -> None:
        with self.assertRaises(vg.EvidenceError):
            vg.parse_microsecond_timestamp("1735689600000", "open")
        raw = "1735689600000001"
        parsed_raw, parsed = vg.parse_microsecond_timestamp(raw, "open")
        self.assertEqual(parsed_raw, int(raw))
        self.assertEqual(parsed.microsecond, 1)

    def test_checksum_member_schema_and_month_validation(self) -> None:
        row = csv_row(datetime(2025, 6, 1, tzinfo=UTC))
        raw, sidecar = archive_bytes("AAAUSDT", "2025-06", "15m", [row])
        parsed, duplicates = vg.parse_kline_archive(
            raw,
            sidecar,
            symbol="AAAUSDT",
            month="2025-06",
            interval="15m",
            require_full_month=False,
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(duplicates, 0)
        with self.assertRaises(vg.EvidenceError):
            vg.parse_kline_archive(
                raw + b"x",
                sidecar,
                symbol="AAAUSDT",
                month="2025-06",
                interval="15m",
                require_full_month=False,
            )
        bad_raw, bad_sidecar = archive_bytes("AAAUSDT", "2025-06", "15m", [row], member="wrong.csv")
        with self.assertRaises(vg.EvidenceError):
            vg.parse_kline_archive(
                bad_raw,
                bad_sidecar,
                symbol="AAAUSDT",
                month="2025-06",
                interval="15m",
                require_full_month=False,
            )
        outside_raw, outside_sidecar = archive_bytes(
            "AAAUSDT",
            "2025-06",
            "15m",
            [csv_row(datetime(2025, 7, 1, tzinfo=UTC))],
        )
        with self.assertRaises(vg.EvidenceError):
            vg.parse_kline_archive(
                outside_raw,
                outside_sidecar,
                symbol="AAAUSDT",
                month="2025-06",
                interval="15m",
                require_full_month=False,
            )

    def test_full_month_15m_grid_is_mandatory(self) -> None:
        rows = full_month_rows("2025-02")
        raw, sidecar = archive_bytes("AAAUSDT", "2025-02", "15m", rows)
        parsed, _ = vg.parse_kline_archive(
            raw,
            sidecar,
            symbol="AAAUSDT",
            month="2025-02",
            interval="15m",
        )
        self.assertEqual(len(parsed), 28 * 96)
        missing_raw, missing_sidecar = archive_bytes("AAAUSDT", "2025-02", "15m", rows[:-1])
        with self.assertRaisesRegex(vg.EvidenceError, "full 15m month"):
            vg.parse_kline_archive(
                missing_raw,
                missing_sidecar,
                symbol="AAAUSDT",
                month="2025-02",
                interval="15m",
            )

    def test_duplicate_policy_collapses_only_identical_daily_rows(self) -> None:
        timestamp = datetime(2025, 4, 1, tzinfo=UTC)
        row = csv_row(timestamp, interval_minutes=24 * 60)
        raw, sidecar = archive_bytes("AAAUSDT", "2025-04", "1d", [row, row])
        parsed, duplicates = vg.parse_kline_archive(
            raw,
            sidecar,
            symbol="AAAUSDT",
            month="2025-04",
            interval="1d",
            collapse_identical_duplicates=True,
            require_full_month=False,
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(duplicates, 1)
        conflicting = list(row)
        conflicting[7] = "101"
        conflict_raw, conflict_sidecar = archive_bytes(
            "AAAUSDT", "2025-04", "1d", [row, conflicting]
        )
        with self.assertRaises(vg.EvidenceError):
            vg.parse_kline_archive(
                conflict_raw,
                conflict_sidecar,
                symbol="AAAUSDT",
                month="2025-04",
                interval="1d",
                collapse_identical_duplicates=True,
                require_full_month=False,
            )

    def test_taker_components_cannot_exceed_totals(self) -> None:
        timestamp = datetime(2025, 6, 1, tzinfo=UTC)
        row = csv_row(timestamp, base="10", taker_base="11")
        raw, sidecar = archive_bytes("AAAUSDT", "2025-06", "15m", [row])
        with self.assertRaisesRegex(vg.EvidenceError, "taker_buy_base"):
            vg.parse_kline_archive(
                raw,
                sidecar,
                symbol="AAAUSDT",
                month="2025-06",
                interval="15m",
                require_full_month=False,
            )


class SignalAndEconomicsTests(unittest.TestCase):
    def test_causal_median_has_no_future_or_price_lookahead(self) -> None:
        decision = datetime(2025, 7, 1, 6, tzinfo=UTC)
        symbol = "AAAUSDT"
        bars: dict[datetime, vg.KlineBar] = {}
        for offset in (4, 3, 2, 1):
            current = decision - timedelta(minutes=15 * offset)
            bars[current] = bar(symbol, current, price="1000", taker_quote="75")
            for day_offset in range(1, 15):
                prior = current - timedelta(days=day_offset)
                bars[prior] = bar(symbol, prior, price=str(day_offset), taker_quote="50")
        first = vg.causal_signal_snapshot({symbol: bars}, (symbol,), decision, 14)
        bars[decision + timedelta(minutes=15)] = bar(
            symbol, decision + timedelta(minutes=15), price="999999", taker_quote="0"
        )
        second = vg.causal_signal_snapshot({symbol: bars}, (symbol,), decision, 14)
        self.assertEqual(first.scores, second.scores)
        self.assertEqual(first.scores[symbol], Decimal("0.5"))
        self.assertEqual(first.positive_counts[symbol], 4)

    def test_rank_and_neutral_benchmark_are_deterministic_and_disjoint(self) -> None:
        decision = datetime(2025, 7, 1, tzinfo=UTC)
        symbols = [f"S{index:02d}USDT" for index in range(20)]
        scores = {symbol: Decimal(index) / Decimal("100") for index, symbol in enumerate(symbols)}
        positives = dict.fromkeys(symbols, 4)
        snapshot = vg.SignalSnapshot(decision, scores, positives)
        selected, benchmark = vg.select_formation(
            snapshot, vg.TrialSpec(14, 3, 3, 2), minimum_eligible=20
        )
        self.assertEqual(selected, ("S19USDT", "S18USDT", "S17USDT"))
        self.assertEqual(benchmark, ("S00USDT", "S01USDT", "S02USDT"))
        self.assertTrue(set(selected).isdisjoint(benchmark))

    def test_sparse_persistence_is_synchronous_inactive_cash_not_unmeasured(self) -> None:
        decision = datetime(2025, 7, 1, tzinfo=UTC)
        symbols = [f"S{index:02d}USDT" for index in range(20)]
        snapshot = vg.SignalSnapshot(
            decision,
            {symbol: Decimal(index) for index, symbol in enumerate(symbols)},
            {symbol: (4 if index < 4 else 0) for index, symbol in enumerate(symbols)},
        )
        observation = vg.formation_observation(
            {},
            snapshot,
            vg.TrialSpec(14, 4, 5, 2),
            minimum_eligible=20,
        )
        self.assertFalse(observation.active)
        self.assertEqual(observation.strategy_gross_factor, Decimal("1"))
        self.assertEqual(observation.benchmark_gross_factor, Decimal("1"))
        self.assertEqual(observation.selected, ())
        fee_stress = vg.Scenario("FEE_STRESS", Decimal("20"), Decimal("25"))
        daily = vg.daily_compounded_returns((observation,), fee_stress)
        self.assertEqual(daily[0][1:], (0.0, 0.0))

    def test_missing_price_after_actual_selection_is_terminal_evidence_failure(self) -> None:
        decision = datetime(2025, 7, 1, tzinfo=UTC)
        symbols = [f"S{index:02d}USDT" for index in range(20)]
        snapshot = vg.SignalSnapshot(
            decision,
            {symbol: Decimal(index) for index, symbol in enumerate(symbols)},
            dict.fromkeys(symbols, 4),
        )
        with self.assertRaisesRegex(vg.EvidenceError, "missing selected wait"):
            vg.formation_observation(
                {},
                snapshot,
                vg.TrialSpec(14, 3, 3, 2),
                minimum_eligible=20,
            )

    def test_entry_exit_timing_and_capacity_proxy(self) -> None:
        decision = datetime(2025, 7, 1, 6, tzinfo=UTC)
        symbols = [f"S{index:02d}USDT" for index in range(20)]
        snapshot = vg.SignalSnapshot(
            decision,
            {symbol: Decimal(index) for index, symbol in enumerate(symbols)},
            dict.fromkeys(symbols, 4),
        )
        bars_by_symbol: dict[str, dict[datetime, vg.KlineBar]] = {}
        for symbol in symbols:
            bars_by_symbol[symbol] = {
                decision: bar(symbol, decision, quote="1000000"),
                decision + timedelta(minutes=15): bar(
                    symbol, decision + timedelta(minutes=15), price="10"
                ),
                decision + timedelta(hours=2, minutes=15): bar(
                    symbol, decision + timedelta(hours=2, minutes=15), price="11"
                ),
            }
        observation = vg.formation_observation(
            bars_by_symbol,
            snapshot,
            vg.TrialSpec(14, 3, 3, 2),
            minimum_eligible=20,
        )
        self.assertTrue(observation.active)
        self.assertEqual(observation.strategy_gross_factor, Decimal("1.1"))
        self.assertLess(observation.maximum_participation_bps, Decimal("10"))

    def test_cost_accounting_is_multiplicative(self) -> None:
        scenario = vg.Scenario("FEE_STRESS", Decimal("20"), Decimal("25"))
        expected = Decimal("1.1") * (Decimal("0.998") ** 2) * Decimal("0.9975") / Decimal("1.0025")
        self.assertEqual(vg.apply_scenario(Decimal("1.1"), scenario), expected)


class StatisticsAndGateTests(unittest.TestCase):
    def test_bootstrap_is_seeded_and_deterministic(self) -> None:
        first = vg.circular_block_indices(30, 7, 32, 123)
        second = vg.circular_block_indices(30, 7, 32, 123)
        self.assertEqual(first, second)
        self.assertEqual(
            vg.bootstrap_statistics([0.01] * 30, first),
            vg.bootstrap_statistics([0.01] * 30, second),
        )

    def test_holm_is_monotone_in_sorted_raw_p_order(self) -> None:
        adjusted = vg.holm_adjust({"b": 0.02, "a": 0.01, "c": 0.5})
        self.assertEqual(adjusted["a"], 0.03)
        self.assertEqual(adjusted["b"], 0.04)
        self.assertEqual(adjusted["c"], 0.5)

    def test_pbo_uses_all_70_splits_deterministically(self) -> None:
        blocks = (
            *(f"2025-{month:02d}" for month in range(7, 13)),
            "2026-01",
            "2026-02",
        )
        values = {
            f"T{trial:02d}": {
                block: (trial + 1) * (block_index + 1) / 10000
                for block_index, block in enumerate(blocks)
            }
            for trial in range(16)
        }
        first = vg.pbo_cscv(values, blocks)
        second = vg.pbo_cscv(values, blocks)
        self.assertEqual(first, second)
        self.assertEqual(first["splitCount"], 70)
        self.assertEqual(len(first["splits"]), 70)

    def test_gate_boundary_and_champion_order_are_frozen(self) -> None:
        summary = {
            "validFormations": 1000,
            "selectedObservations": 3000,
            "minimumEligibleSymbols": 20,
            "absolute7d": {"lower95": 0.01},
            "matchedExcess7d": {"lower95": 0.02},
            "absolute14d": {"lower95": 0.005},
            "matchedExcess14d": {"lower95": 0.006},
            "maximumDrawdownPct": 20.0,
            "maximumParticipationBps": 10.0,
        }
        gate = vg.load_protocol()["gates"]["development"]
        decisions = vg.gate_trial(summary, 0.05, 0.05, 0.20, gate, development=True)
        self.assertTrue(all(item["pass"] for item in decisions))
        spec_a = vg.TrialSpec(14, 3, 3, 2)
        spec_b = vg.TrialSpec(28, 4, 5, 4)
        results = {
            spec_a.trial_id: {
                "matchedExcess7d": {"lower95": 0.02},
                "absolute7d": {"lower95": 0.01},
                "matchedExcess14d": {"lower95": 0.005},
                "maximumDrawdownPct": 5.0,
            },
            spec_b.trial_id: {
                "matchedExcess7d": {"lower95": 0.03},
                "absolute7d": {"lower95": 0.01},
                "matchedExcess14d": {"lower95": 0.005},
                "maximumDrawdownPct": 5.0,
            },
        }
        champion = vg.select_development_champion(
            tuple(results),
            results,
            {spec_a.trial_id: spec_a, spec_b.trial_id: spec_b},
        )
        self.assertEqual(champion, spec_b.trial_id)


class LifecycleTests(unittest.TestCase):
    def test_manifest_is_content_addressed_and_source_freeze_detects_drift(self) -> None:
        manifest = vg.packet_manifest()
        self.assertEqual(
            manifest["aggregateSha256"],
            vg.sha256_bytes(vg.canonical_bytes(manifest["files"])),
        )
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            vg.source_freeze(state, now=NOW)
            receipt_path = state / "source-freeze.v1.json"
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["packetManifest"]["aggregateSha256"] = "0" * 64
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            with self.assertRaises(vg.EvidenceError):
                vg.verify_source_freeze(state)

    def test_holdout_source_is_not_touched_before_candidate_seal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "state"
            offline = root / "untouched-holdout"
            offline.mkdir()
            sentinel = offline / "sentinel"
            sentinel.write_text("untouched", encoding="utf-8")
            initialize_synthetic_state(state)
            with self.assertRaisesRegex(vg.LifecycleError, "before candidate seal"):
                vg.acquire_archives(
                    state,
                    "holdout",
                    now=NOW,
                    offline_source=offline,
                    network=False,
                )
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "untouched")
            self.assertFalse((state / "acquire-holdout-start.v1.json").exists())
            self.assertFalse((state / "result.v1.json").exists())

    def test_one_use_holdout_open_replay_is_terminal_unmeasured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            write_synthetic_development_chain(state)
            vg.candidate_seal(state, now=NOW)
            vg.holdout_open(state, now=NOW)
            with self.assertRaises(vg.LifecycleError):
                vg.holdout_open(state, now=NOW + timedelta(seconds=1))
            result = vg.read_json(state / "result.v1.json")
            self.assertEqual(result["researchVerdict"], "UNMEASURED")
            self.assertEqual(result["capitalVerdict"], "NO_GO")
            self.assertEqual(result["executionAuthority"], "NONE")

    def test_candidate_seal_rejects_fabricated_three_field_development(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            analysis = write_synthetic_development_chain(state)
            fabricated = {
                "schema": analysis["schema"],
                "championTrialId": analysis["championTrialId"],
                "developmentGatesPass": True,
            }
            replace_json(state / "development-result.v1.json", fabricated)
            with self.assertRaises(vg.EvidenceError):
                vg.candidate_seal(state, now=NOW)

    def test_post_open_coherent_candidate_and_development_mutation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            write_synthetic_development_chain(state)
            candidate = dict(vg.candidate_seal(state, now=NOW))
            vg.holdout_open(state, now=NOW)
            development = dict(vg.read_json(state / "development-result.v1.json"))
            trials = {
                key: dict(value)
                for key, value in vg.require_mapping(
                    development["trials"], "development trials"
                ).items()
            }
            original = str(development["championTrialId"])
            target = next(trial_id for trial_id in sorted(trials) if trial_id != original)
            target_result = trials[target]
            matched = dict(vg.require_mapping(target_result["matchedExcess7d"], "matchedExcess7d"))
            matched["lower95"] = 0.5
            target_result["matchedExcess7d"] = matched
            gate = vg.load_protocol()["gates"]["development"]
            target_result["gates"] = list(
                vg.gate_trial(
                    target_result,
                    float(target_result["holmAbsoluteP"]),
                    float(target_result["holmMatchedExcessP"]),
                    float(vg.require_mapping(development["pbo"], "pbo")["pbo"]),
                    gate,
                    development=True,
                )
            )
            trials[target] = target_result
            development["trials"] = trials
            development["championTrialId"] = target
            replace_json(state / "development-result.v1.json", development)
            spec = next(
                item for item in vg.trial_specs(vg.load_protocol()) if item.trial_id == target
            )
            candidate.update(
                {
                    "championTrialId": target,
                    "champion": {
                        "D": spec.days,
                        "P": spec.persistence,
                        "K": spec.top_k,
                        "HHours": spec.holding_hours,
                    },
                    "developmentResultSha256": vg.sha256_path(state / "development-result.v1.json"),
                }
            )
            replace_json(state / "candidate-seal.v1.json", candidate)
            with self.assertRaisesRegex(vg.EvidenceError, "holdout-open .*binding mismatch"):
                vg.validate_holdout_open_chain(state)

    def test_manifest_rejects_protocol_month_substitution_and_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            manifest = write_synthetic_acquisition(state, "development")
            substituted = dict(manifest)
            substituted["months"] = list(vg._phase_months(vg.load_protocol(), "holdout"))
            replace_json(state / "acquisition-development.v1.json", substituted)
            with self.assertRaisesRegex(vg.EvidenceError, "declared inventory"):
                vg.validate_acquisition_manifest(state, "development")
            replace_json(state / "acquisition-development.v1.json", manifest)
            escaped = dict(manifest)
            records = [
                dict(vg.require_mapping(item, "record"))
                for item in vg.require_list(manifest["records"], "records")
            ]
            records[0]["zipStateRelativePath"] = "../escaped.zip"
            escaped["records"] = records
            replace_json(state / "acquisition-development.v1.json", escaped)
            with self.assertRaisesRegex(vg.EvidenceError, "absolute or escapes"):
                vg.validate_acquisition_manifest(state, "development")

    def test_run_marker_is_not_reported_as_archive_body_open(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            write_synthetic_acquisition(state, "development")
            write_synthetic_run_start(state, "development")
            vg.write_terminal_result(
                state,
                "UNMEASURED",
                "DEVELOPMENT_POST_MARKER_FAILURE",
                now=NOW,
                evidence={"holdoutOpened": False},
            )
            verified = vg.verify_final(state)
            self.assertTrue(verified["developmentRunMarkerConsumed"])
            self.assertFalse(verified["developmentArchiveBodyOpenAttempted"])
            self.assertFalse(verified["developmentAllArchiveBodiesLoaded"])
            self.assertEqual(verified["developmentArchiveBodyOpenState"], "NOT_ATTEMPTED")
            self.assertEqual(verified["holdoutArchiveBodyOpenState"], "NOT_ATTEMPTED")
            self.assertNotIn("developmentArchiveBodiesOpened", verified)
            self.assertNotIn("holdoutArchiveBodiesOpened", verified)

    def test_post_marker_body_read_failure_is_not_reported_as_unopened(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            archives = archive_count(write_synthetic_acquisition(state, "development"))
            write_synthetic_run_start(state, "development")
            write_synthetic_body_open_attempt(state, "development", archives=archives)
            vg.write_terminal_result(
                state,
                "UNMEASURED",
                "EVIDENCE_INVALID",
                now=NOW,
                evidence={
                    "message": "synthetic parser failure",
                    "holdoutOpened": False,
                    "developmentArchiveBodyOpenAttempted": True,
                    "developmentAllArchiveBodiesLoaded": False,
                },
            )
            verified = vg.verify_final(state)
            self.assertTrue(verified["developmentRunMarkerConsumed"])
            self.assertTrue(verified["developmentArchiveBodyOpenAttempted"])
            self.assertFalse(verified["developmentAllArchiveBodiesLoaded"])
            self.assertEqual(
                verified["developmentArchiveBodyOpenState"],
                "ATTEMPTED_MEMBER_READ_COUNT_UNMEASURED",
            )
            self.assertEqual(verified["researchVerdict"], "UNMEASURED")

    def test_body_open_receipt_requires_attempt_and_exact_count(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            archives = archive_count(write_synthetic_acquisition(state, "development"))
            write_synthetic_run_start(state, "development")
            write_synthetic_body_open_attempt(state, "development", archives=archives)
            write_synthetic_body_open(state, "development", archives=archives)
            attempt_path = state / "development-body-open-attempt.v1.json"
            attempt_path.unlink()
            vg.write_terminal_result(
                state,
                "UNMEASURED",
                "DEVELOPMENT_POST_MARKER_FAILURE",
                now=NOW,
                evidence={"holdoutOpened": False},
            )
            with self.assertRaisesRegex(vg.EvidenceError, "lacks attempt receipt"):
                vg.verify_final(state)
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            archives = archive_count(write_synthetic_acquisition(state, "development"))
            write_synthetic_run_start(state, "development")
            write_synthetic_body_open_attempt(state, "development", archives=archives)
            write_synthetic_body_open(state, "development", archives=archives)
            body_path = state / "development-body-open.v1.json"
            body = dict(vg.read_json(body_path))
            body["loadedArchiveBodyCount"] = archives - 1
            replace_json(body_path, body)
            with self.assertRaisesRegex(vg.EvidenceError, "archive-body count mismatch"):
                vg.validate_body_open_receipt(
                    state,
                    "development",
                    vg.load_protocol(),
                    vg.load_cohort(state),
                )

    def test_holdout_body_open_chain_is_bound_and_truthful(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            write_synthetic_development_chain(state)
            vg.candidate_seal(state, now=NOW)
            vg.holdout_open(state, now=NOW)
            archives = archive_count(write_synthetic_acquisition(state, "holdout"))
            write_synthetic_run_start(state, "holdout")
            write_synthetic_body_open_attempt(state, "holdout", archives=archives)
            write_synthetic_body_open(state, "holdout", archives=archives)
            protocol = vg.load_protocol()
            cohort = vg.load_cohort(state)
            attempt = vg.validate_body_open_attempt_receipt(state, "holdout", protocol, cohort)
            self.assertEqual(attempt["archiveMemberBodiesRead"], "UNMEASURED_MAY_BE_NONZERO")
            self.assertIs(attempt["allExpectedArchiveBodiesLoaded"], False)
            receipt = vg.validate_body_open_receipt(state, "holdout", protocol, cohort)
            self.assertEqual(receipt["loadedArchiveBodyCount"], archives)
            self.assertIs(receipt["allExpectedArchiveBodiesLoaded"], True)

    def test_planted_holdout_body_attempt_is_refused_after_development_no_go(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            write_synthetic_development_chain(state, passes=False)
            development_sha = vg.sha256_path(state / "development-result.v1.json")
            vg.write_terminal_result(
                state,
                "NO_GO",
                "DEVELOPMENT_GATES_FAILED_HOLDOUT_UNOPENED",
                now=NOW,
                evidence={
                    "developmentResultSha256": development_sha,
                    "holdoutOpened": False,
                },
            )
            vg.write_json_exclusive(state / "holdout-body-open-attempt.v1.json", {})
            with self.assertRaisesRegex(vg.EvidenceError, "attempt lacks run chain"):
                vg.verify_final(state)

    def test_offline_acquisition_receipt_freezes_required_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            offline = root / "offline"
            state = root / "state"
            offline.mkdir()
            state.mkdir()
            row = csv_row(datetime(2025, 6, 1, tzinfo=UTC))
            raw, sidecar = archive_bytes("AAAUSDT", "2025-06", "15m", [row])
            (offline / "AAAUSDT-15m-2025-06.zip").write_bytes(raw)
            (offline / "AAAUSDT-15m-2025-06.zip.CHECKSUM").write_bytes(sidecar)
            receipt = vg._acquire_one(
                symbol="AAAUSDT",
                month="2025-06",
                state=state,
                phase="development",
                protocol=vg.load_protocol(),
                retrieval_time=NOW,
                offline_source=offline,
                network=False,
            )
            self.assertEqual(receipt["status"], {"sidecar": 200, "zip": 200})
            self.assertEqual(receipt["checksumBytesSha256"], vg.sha256_bytes(sidecar))
            self.assertEqual(receipt["expectedZipSha256"], vg.sha256_bytes(raw))
            self.assertEqual(receipt["observedZipSha256"], vg.sha256_bytes(raw))
            self.assertEqual(
                receipt["url"],
                "https://data.binance.vision/data/spot/monthly/klines/"
                "AAAUSDT/15m/AAAUSDT-15m-2025-06.zip",
            )
            self.assertIn("etag", receipt)
            self.assertIn("lastModified", receipt)

    def test_terminal_classification_and_final_verification_are_truthful(self) -> None:
        payload = vg.terminal_result_payload("GO", "HOLDOUT_GATES_PASSED", now=NOW)
        self.assertEqual(payload["capitalVerdict"], "NO_GO")
        self.assertEqual(payload["executionAuthority"], "NONE")
        self.assertEqual(payload["accountEffectiveFees"], "UNKNOWN")
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            initialize_synthetic_state(state)
            write_synthetic_development_chain(state, passes=False)
            development_sha = vg.sha256_path(state / "development-result.v1.json")
            vg.write_terminal_result(
                state,
                "NO_GO",
                "DEVELOPMENT_GATES_FAILED_HOLDOUT_UNOPENED",
                now=NOW,
                evidence={
                    "developmentResultSha256": development_sha,
                    "holdoutOpened": False,
                },
            )
            verified = vg.verify_final(state)
            self.assertFalse(verified["archivesDecompressedDuringVerification"])
            self.assertTrue(verified["developmentRunMarkerConsumed"])
            self.assertTrue(verified["developmentArchiveBodyOpenAttempted"])
            self.assertTrue(verified["developmentAllArchiveBodiesLoaded"])
            self.assertEqual(
                verified["developmentArchiveBodyOpenState"],
                "ALL_EXPECTED_BODIES_LOADED_AND_VALIDATED",
            )
            self.assertFalse(verified["holdoutOpened"])


if __name__ == "__main__":
    unittest.main()
