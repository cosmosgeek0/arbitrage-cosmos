"""S-1B public-data-only Spot trend discovery with a one-shot untouched holdout.

The strategy and every decision rule live in the committed plan fixture.  The
``discover`` command has no validation input.  Validation data can only be acquired
after a passing candidate seal exists, and ``validate`` consumes an atomic grant
before reading any holdout archive.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_DOWN, Decimal, getcontext
from pathlib import Path
from typing import Any

getcontext().prec = 50

D = Decimal
DAY_MS = 86_400_000
USER_AGENT = "cosmos-s1b-public-research/1.0"


class EvidenceError(RuntimeError):
    """A fail-closed evidence or accounting error."""


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    quote_volume: Decimal
    trade_count: int


@dataclass(slots=True)
class Sleeve:
    horizon: int
    cash: Decimal
    base: Decimal = field(default_factory=lambda: D("0"))
    long: bool = False
    entries: int = 0
    exits: int = 0


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_file(path: Path) -> Path:
    if path.is_symlink():
        raise EvidenceError(f"symlink refused: {path}")
    if not path.is_file():
        raise EvidenceError(f"required file missing: {path}")
    return path


def sha256_path(path: Path) -> str:
    return sha256_bytes(safe_file(path).read_bytes())


def write_exclusive(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise EvidenceError(f"exclusive output already exists: {path}") from error
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def write_atomic(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists():
        raise EvidenceError(f"temporary path already exists: {temporary}")
    temporary.write_bytes(raw)
    os.replace(temporary, path)


def reserve_output(path: Path) -> None:
    write_exclusive(
        path,
        canonical_bytes(
            {
                "schema": "S1BValidationOutputReservationV1",
                "state": "RESERVED_BEFORE_HOLDOUT_OPEN",
            }
        ),
    )


def load_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = safe_file(path).read_bytes()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceError(f"invalid JSON: {path}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"JSON root must be an object: {path}")
    return value, raw


def nested(mapping: dict[str, Any], *keys: str) -> Any:
    value: Any = mapping
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            raise EvidenceError(f"plan field missing: {'.'.join(keys)}")
        value = value[key]
    return value


def load_plan(path: Path) -> tuple[dict[str, Any], str]:
    plan, raw = load_json(path)
    required = {
        ("schema",): "S1BSpotTrendPlanV1",
        ("strategy", "candidateId"): "btc-usdt-equal-weight-pma-1-2-4-10-20w:v1",
        ("strategy", "selection", "attemptedHypotheses"): 1,
        ("strategy", "selection", "parameterSearch"): "NONE",
        ("strategy", "symbol"): "BTCUSDT",
        ("data", "checksumRequired"): True,
        ("costs", "funding"): None,
    }
    for keys, expected in required.items():
        if keys == ("costs", "funding"):
            continue
        if nested(plan, *keys) != expected:
            raise EvidenceError(f"immutable plan field changed: {'.'.join(keys)}")
    horizons = [
        item.get("pmaCalendarDays")
        for item in nested(plan, "strategy", "sleeves")
        if isinstance(item, dict)
    ]
    if horizons != [7, 14, 28, 70, 140]:
        raise EvidenceError("immutable imported PMA horizons changed")
    if nested(plan, "strategy", "funding") != "NOT_APPLICABLE_SPOT_ONLY":
        raise EvidenceError("Spot-only funding contract changed")
    if nested(plan, "partitions", "validation", "openCount") != 1:
        raise EvidenceError("holdout open count must remain one")
    if nested(plan, "partitions", "validation", "reusedPriorClaimPeriod") is not False:
        raise EvidenceError("reused validation periods are forbidden")
    if nested(plan, "holdoutControl", "grantId") != "s1b-pma-v1-20260728":
        raise EvidenceError("holdout grant id changed")
    if nested(plan, "holdoutControl", "expectedValidationRoot") != (
        "/private/tmp/cosmos-s1b-pma-v1/validation"
    ):
        raise EvidenceError("holdout root changed")
    if nested(plan, "holdoutControl", "expectedValidationEvidencePath") != (
        "/private/tmp/cosmos-s1b-pma-v1/validation-evidence.json"
    ):
        raise EvidenceError("holdout evidence path changed")
    return plan, sha256_bytes(raw)


def script_sha() -> str:
    return sha256_path(Path(__file__).resolve())


def parse_month(value: str) -> tuple[int, int]:
    try:
        parsed = datetime.strptime(value, "%Y-%m").replace(tzinfo=UTC)
    except ValueError as error:
        raise EvidenceError(f"invalid month: {value}") from error
    return parsed.year, parsed.month


def month_range(first: str, last: str) -> list[str]:
    year, month = parse_month(first)
    end_year, end_month = parse_month(last)
    values: list[str] = []
    while (year, month) <= (end_year, end_month):
        values.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    if not values:
        raise EvidenceError("empty month range")
    return values


def partition_months(plan: dict[str, Any], partition: str) -> list[str]:
    bounds = nested(plan, "partitions", partition, "monthsInclusive")
    if (
        not isinstance(bounds, list)
        or len(bounds) != 2
        or not all(isinstance(value, str) for value in bounds)
    ):
        raise EvidenceError(f"invalid {partition} month bounds")
    return month_range(bounds[0], bounds[1])


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise EvidenceError(f"public archive HTTP status {response.status}")
            raw = response.read()
            if not isinstance(raw, bytes):
                raise EvidenceError("public archive response was not bytes")
            return raw
    except OSError as error:
        raise EvidenceError(f"public archive download failed: {url}") from error


def verify_checksum_text(raw: bytes, expected_name: str, archive_raw: bytes) -> str:
    try:
        fields = raw.decode("ascii").strip().split()
    except UnicodeDecodeError as error:
        raise EvidenceError("checksum is not ASCII") from error
    if len(fields) != 2 or fields[1].lstrip("*") != expected_name:
        raise EvidenceError(f"unexpected checksum contract for {expected_name}")
    declared = fields[0].lower()
    if len(declared) != 64 or any(character not in "0123456789abcdef" for character in declared):
        raise EvidenceError(f"invalid checksum digest for {expected_name}")
    actual = sha256_bytes(archive_raw)
    if actual != declared:
        raise EvidenceError(f"archive checksum mismatch for {expected_name}")
    return actual


def verify_candidate(
    candidate_path: Path,
    *,
    plan: dict[str, Any],
    plan_sha: str,
    require_research_pass: bool,
) -> tuple[dict[str, Any], str]:
    candidate, raw = load_json(candidate_path)
    if candidate.get("schema") != "S1BSpotTrendCandidateV1":
        raise EvidenceError("candidate schema mismatch")
    if candidate.get("candidateId") != nested(plan, "strategy", "candidateId"):
        raise EvidenceError("candidate id does not match frozen plan")
    if candidate.get("planSha256") != plan_sha:
        raise EvidenceError("candidate plan digest mismatch")
    if candidate.get("scriptSha256") != script_sha():
        raise EvidenceError("candidate script digest mismatch")
    if candidate.get("attemptedHypotheses") != 1:
        raise EvidenceError("candidate trial count changed")
    gate = candidate.get("researchGate")
    if require_research_pass and (not isinstance(gate, dict) or gate.get("passed") is not True):
        raise EvidenceError("research stop did not authorize holdout acquisition")
    return candidate, sha256_bytes(raw)


def expected_fixture_path(plan_path: Path, plan: dict[str, Any], field: str) -> Path:
    name = nested(plan, "holdoutControl", field)
    if not isinstance(name, str) or Path(name).name != name:
        raise EvidenceError(f"invalid frozen fixture name: {field}")
    return (plan_path.resolve().parent / name).resolve()


def verify_authorization(
    authorization_path: Path,
    *,
    candidate: dict[str, Any],
    candidate_sha: str,
    plan: dict[str, Any],
    plan_sha: str,
) -> tuple[dict[str, Any], str]:
    authorization, raw = load_json(authorization_path)
    required = {
        "schema": "S1BSpotTrendAuthorizationV1",
        "grantId": nested(plan, "holdoutControl", "grantId"),
        "candidateId": nested(plan, "strategy", "candidateId"),
        "candidateSha256": candidate_sha,
        "planSha256": plan_sha,
        "scriptSha256": script_sha(),
        "researchManifestSha256": candidate.get("researchManifestSha256"),
        "authorizedValidationOpenCount": 1,
    }
    if any(authorization.get(key) != value for key, value in required.items()):
        raise EvidenceError("external candidate authorization digest or binding mismatch")
    if authorization.get("state") != "FROZEN_BEFORE_VALIDATION_ACQUISITION":
        raise EvidenceError("candidate authorization is not in the frozen pre-holdout state")
    return authorization, sha256_bytes(raw)


def acquire(
    plan_path: Path,
    partition: str,
    output_root: Path,
    candidate_path: Path | None,
    authorization_path: Path | None,
) -> dict[str, Any]:
    plan, plan_sha = load_plan(plan_path)
    if partition not in {"research", "validation"}:
        raise EvidenceError("partition must be research or validation")
    candidate_sha: str | None = None
    authorization_sha: str | None = None
    if partition == "validation":
        if candidate_path is None or authorization_path is None:
            raise EvidenceError(
                "validation acquisition requires candidate and external authorization seals"
            )
        expected_candidate = expected_fixture_path(plan_path, plan, "expectedCandidateFixtureName")
        expected_authorization = expected_fixture_path(
            plan_path, plan, "expectedAuthorizationFixtureName"
        )
        if candidate_path.resolve() != expected_candidate:
            raise EvidenceError("candidate is not the frozen committed fixture path")
        if authorization_path.resolve() != expected_authorization:
            raise EvidenceError("authorization is not the frozen committed fixture path")
        candidate, candidate_sha = verify_candidate(
            candidate_path,
            plan=plan,
            plan_sha=plan_sha,
            require_research_pass=True,
        )
        _, authorization_sha = verify_authorization(
            authorization_path,
            candidate=candidate,
            candidate_sha=candidate_sha,
            plan=plan,
            plan_sha=plan_sha,
        )
    elif candidate_path is not None or authorization_path is not None:
        raise EvidenceError(
            "research acquisition must not receive a candidate, authorization, or holdout input"
        )

    output_root = output_root.resolve()
    if (
        partition == "validation"
        and output_root != Path(nested(plan, "holdoutControl", "expectedValidationRoot")).resolve()
    ):
        raise EvidenceError("validation acquisition root differs from the external frozen ledger")
    if output_root.exists() and any(output_root.iterdir()):
        raise EvidenceError(f"acquisition output must be new and empty: {output_root}")
    output_root.mkdir(parents=True, exist_ok=True)

    authority = nested(plan, "data", "authority").rstrip("/")
    archive_path = nested(plan, "data", "archivePath").strip("/")
    entries: list[dict[str, object]] = []
    for month in partition_months(plan, partition):
        filename = f"BTCUSDT-1d-{month}.zip"
        url = f"{authority}/{archive_path}/{filename}"
        archive_raw = download(url)
        checksum_raw = download(f"{url}.CHECKSUM")
        archive_sha = verify_checksum_text(checksum_raw, filename, archive_raw)
        archive_file = output_root / filename
        checksum_file = output_root / f"{filename}.CHECKSUM"
        write_exclusive(archive_file, archive_raw)
        write_exclusive(checksum_file, checksum_raw)
        entries.append(
            {
                "archiveByteCount": len(archive_raw),
                "archiveSha256": archive_sha,
                "archiveUrl": url,
                "checksumSha256": sha256_bytes(checksum_raw),
                "checksumUrl": f"{url}.CHECKSUM",
                "filename": filename,
                "month": month,
            }
        )

    manifest: dict[str, Any] = {
        "schema": "S1BBinanceArchiveManifestV1",
        "partition": partition,
        "planSha256": plan_sha,
        "scriptSha256": script_sha(),
        "authorizationSha256": authorization_sha,
        "symbol": "BTCUSDT",
        "interval": "1d",
        "archives": entries,
    }
    manifest_raw = canonical_bytes(manifest)
    write_exclusive(output_root / "manifest.json", manifest_raw)
    if partition == "validation":
        assert candidate_sha is not None
        assert authorization_sha is not None
        grant = {
            "schema": "S1BValidationGrantV1",
            "state": "SEALED_UNOPENED",
            "candidateSha256": candidate_sha,
            "authorizationSha256": authorization_sha,
            "manifestSha256": sha256_bytes(manifest_raw),
            "planSha256": plan_sha,
            "scriptSha256": script_sha(),
            "allowedOpenCount": 1,
            "grantId": nested(plan, "holdoutControl", "grantId"),
        }
        write_exclusive(output_root / ".validation-grant.json", canonical_bytes(grant))
    return manifest


def timestamp_ms(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as error:
        raise EvidenceError("non-integer kline timestamp") from error
    if value >= 100_000_000_000_000:
        value //= 1_000
    return value


def parse_bar(row: list[str], expected_month: str) -> Bar:
    if len(row) != 12:
        raise EvidenceError(f"kline row has {len(row)} columns, expected 12")
    open_time = timestamp_ms(row[0])
    if open_time % DAY_MS:
        raise EvidenceError("daily kline does not open at UTC midnight")
    day = datetime.fromtimestamp(open_time / 1_000, tz=UTC).date()
    if day.strftime("%Y-%m") != expected_month:
        raise EvidenceError("archive contains a row outside its declared month")
    try:
        open_price, high, low, close = (D(row[index]) for index in range(1, 5))
        quote_volume = D(row[7])
        trade_count = int(row[8])
    except (ValueError, ArithmeticError) as error:
        raise EvidenceError("invalid numeric kline field") from error
    if min(open_price, high, low, close) <= 0:
        raise EvidenceError("non-positive OHLC value")
    if low > min(open_price, close) or high < max(open_price, close) or low > high:
        raise EvidenceError("invalid OHLC geometry")
    if quote_volume < 0 or trade_count < 0:
        raise EvidenceError("negative volume or trade count")
    return Bar(day, open_price, high, low, close, quote_volume, trade_count)


def read_archive(path: Path, month: str) -> list[Bar]:
    raw = safe_file(path).read_bytes()
    expected_member = path.name.removesuffix(".zip") + ".csv"
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            members = archive.namelist()
            if members != [expected_member]:
                raise EvidenceError(f"unexpected ZIP members in {path.name}")
            member = archive.read(expected_member)
    except zipfile.BadZipFile as error:
        raise EvidenceError(f"invalid ZIP archive: {path.name}") from error
    rows = csv.reader(io.StringIO(member.decode("utf-8")))
    bars: list[Bar] = []
    for row in rows:
        if not row:
            continue
        if row[0].strip().lower() in {"open_time", "open time"}:
            continue
        bars.append(parse_bar([value.strip() for value in row], month))
    if not bars:
        raise EvidenceError(f"archive has no bars: {path.name}")
    return bars


def date_span(first: date, last: date) -> list[date]:
    if last < first:
        raise EvidenceError("date span is reversed")
    return [first + timedelta(days=offset) for offset in range((last - first).days + 1)]


def load_partition(
    plan: dict[str, Any],
    plan_sha: str,
    partition: str,
    root: Path,
) -> tuple[list[Bar], dict[str, Any], str]:
    root = root.resolve()
    manifest_path = root / "manifest.json"
    manifest, manifest_raw = load_json(manifest_path)
    if manifest.get("schema") != "S1BBinanceArchiveManifestV1":
        raise EvidenceError("archive manifest schema mismatch")
    if manifest.get("partition") != partition:
        raise EvidenceError("archive manifest partition mismatch")
    if manifest.get("planSha256") != plan_sha or manifest.get("scriptSha256") != script_sha():
        raise EvidenceError("archive manifest is not bound to current plan and code")
    archives = manifest.get("archives")
    if not isinstance(archives, list):
        raise EvidenceError("archive manifest entries missing")
    expected_months = partition_months(plan, partition)
    if [entry.get("month") for entry in archives if isinstance(entry, dict)] != expected_months:
        raise EvidenceError("archive manifest month set is incomplete or reordered")

    bars: list[Bar] = []
    for entry in archives:
        if not isinstance(entry, dict):
            raise EvidenceError("invalid archive manifest entry")
        month = entry.get("month")
        filename = entry.get("filename")
        if not isinstance(month, str) or not isinstance(filename, str):
            raise EvidenceError("archive entry is missing month or filename")
        archive_path = root / filename
        checksum_path = root / f"{filename}.CHECKSUM"
        if sha256_path(archive_path) != entry.get("archiveSha256"):
            raise EvidenceError(f"pinned archive digest mismatch: {filename}")
        if sha256_path(checksum_path) != entry.get("checksumSha256"):
            raise EvidenceError(f"pinned checksum digest mismatch: {filename}")
        verify_checksum_text(checksum_path.read_bytes(), filename, archive_path.read_bytes())
        bars.extend(read_archive(archive_path, month))

    if len({bar.day for bar in bars}) != len(bars):
        raise EvidenceError("duplicate UTC daily kline")
    bars.sort(key=lambda bar: bar.day)
    partition_spec = nested(plan, "partitions", partition)
    start_text = (
        partition_spec["warmupStartUtc"]
        if partition == "research"
        else partition_spec["evaluationStartUtc"]
    )
    first = date.fromisoformat(start_text)
    last = date.fromisoformat(partition_spec["evaluationEndUtcInclusive"])
    expected_days = date_span(first, last)
    actual_days = [bar.day for bar in bars if first <= bar.day <= last]
    if actual_days != expected_days:
        missing = sorted(set(expected_days) - set(actual_days))
        extra = sorted(set(actual_days) - set(expected_days))
        raise EvidenceError(f"daily coverage mismatch missing={missing[:3]} extra={extra[:3]}")
    return [bar for bar in bars if first <= bar.day <= last], manifest, sha256_bytes(manifest_raw)


def quantity_quantum(plan: dict[str, Any]) -> Decimal:
    market_step = D(nested(plan, "costs", "currentMarketLotStepSize"))
    if market_step > 0:
        return market_step
    precision = int(nested(plan, "costs", "currentBaseAssetPrecisionDecimals"))
    if not 0 <= precision <= 18:
        raise EvidenceError("invalid frozen base-asset precision")
    return D(1).scaleb(-precision)


def floor_quantity(value: Decimal, quantum: Decimal) -> Decimal:
    if value < 0 or quantum <= 0:
        raise EvidenceError("invalid quantity or quantum")
    return (value / quantum).to_integral_value(rounding=ROUND_DOWN) * quantum


def decimal_mean(values: list[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("mean of empty values")
    return sum(values, D("0")) / D(len(values))


def decimal_median(values: list[Decimal]) -> Decimal:
    if not values:
        raise EvidenceError("median of empty values")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / D("2")


def dstr(value: Decimal) -> str:
    if value == 0:
        return "0"
    return format(value.normalize(), "f")


class SplitMix64:
    """Small fixed algorithm; unlike language library RNGs, its stream is explicit."""

    def __init__(self, seed: int) -> None:
        self.state = seed & ((1 << 64) - 1)

    def next_u64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & ((1 << 64) - 1)
        value = self.state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & ((1 << 64) - 1)
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & ((1 << 64) - 1)
        return value ^ (value >> 31)


def percentile(sorted_values: list[Decimal], numerator: int, denominator: int) -> Decimal:
    index = (numerator * len(sorted_values) + denominator - 1) // denominator - 1
    return sorted_values[max(index, 0)]


def circular_block_interval(
    values: list[Decimal],
    *,
    block_length: int,
    replicates: int,
    seed: int,
) -> dict[str, str | int]:
    if block_length > len(values) or len(values) // block_length < 12:
        raise EvidenceError("insufficient independent blocks for declared bootstrap")
    rng = SplitMix64(seed)
    count = len(values)
    blocks_needed = (count + block_length - 1) // block_length
    replicate_means: list[Decimal] = []
    for _ in range(replicates):
        total = D("0")
        drawn = 0
        for _ in range(blocks_needed):
            start = rng.next_u64() % count
            for offset in range(block_length):
                if drawn == count:
                    break
                total += values[(start + offset) % count]
                drawn += 1
        replicate_means.append(total / D(count))
    replicate_means.sort()
    point = decimal_mean(values)
    return {
        "method": "CIRCULAR_BLOCK_BOOTSTRAP_PERCENTILE",
        "blockLengthDays": block_length,
        "replicates": replicates,
        "coveragePct": "95",
        "seed": str(seed),
        "valueCount": count,
        "pointMeanDailyReturn": dstr(point),
        "lowerMeanDailyReturn": dstr(percentile(replicate_means, 25, 1000)),
        "upperMeanDailyReturn": dstr(percentile(replicate_means, 975, 1000)),
        "pointMeanDailyUsdPer1k": dstr(point * D("1000")),
        "lowerMeanDailyUsdPer1k": dstr(percentile(replicate_means, 25, 1000) * D("1000")),
        "upperMeanDailyUsdPer1k": dstr(percentile(replicate_means, 975, 1000) * D("1000")),
    }


def update_drawdown(
    equity: Decimal,
    timestamp: str,
    *,
    peak: Decimal,
    peak_timestamp: str,
    maximum: Decimal,
    maximum_usd: Decimal,
    maximum_peak_timestamp: str,
    trough_timestamp: str,
) -> tuple[Decimal, str, Decimal, Decimal, str, str]:
    if equity > peak:
        return (
            equity,
            timestamp,
            maximum,
            maximum_usd,
            maximum_peak_timestamp,
            trough_timestamp,
        )
    if peak <= 0:
        raise EvidenceError("non-positive equity peak")
    drawdown = D("1") - equity / peak
    dollar = peak - equity
    if drawdown > maximum:
        return peak, peak_timestamp, drawdown, dollar, peak_timestamp, timestamp
    return (
        peak,
        peak_timestamp,
        maximum,
        maximum_usd,
        maximum_peak_timestamp,
        trough_timestamp,
    )


def signal(history: list[Bar], horizon: int) -> bool:
    if len(history) < horizon:
        raise EvidenceError(f"insufficient causal history for PMA {horizon}")
    closes = [bar.close for bar in history[-horizon:]]
    return closes[-1].ln() > decimal_mean([close.ln() for close in closes])


def capacity_reference(history: list[Bar]) -> Decimal:
    if len(history) < 7:
        raise EvidenceError("capacity screen needs seven complete prior UTC days")
    previous = history[-1].quote_volume
    trailing = decimal_median([bar.quote_volume for bar in history[-7:]])
    reference = min(previous, trailing)
    if reference <= 0:
        raise EvidenceError("non-positive public quote-volume capacity reference")
    return reference


def account_equity(sleeves: list[Sleeve], reference_price: Decimal) -> Decimal:
    return sum((sleeve.cash + sleeve.base * reference_price for sleeve in sleeves), D("0"))


def simulate(
    plan: dict[str, Any],
    history_seed: list[Bar],
    evaluation: list[Bar],
    *,
    adverse_execution_bps: Decimal,
    capacity_bps: Decimal,
    include_uncertainty: bool,
) -> dict[str, Any]:
    if not evaluation:
        raise EvidenceError("empty evaluation")
    fee = D(nested(plan, "costs", "regularSpotFeeBpsPerFill")) / D("10000")
    wedge = adverse_execution_bps / D("10000")
    min_notional = D(nested(plan, "costs", "currentMarketMinNotionalUsd"))
    order_quantum = quantity_quantum(plan)
    sleeves = [
        Sleeve(int(item["pmaCalendarDays"]), D(item["initialCashUsd"]))
        for item in nested(plan, "strategy", "sleeves")
    ]
    initial_equity = sum((sleeve.cash for sleeve in sleeves), D("0"))
    if initial_equity != D(nested(plan, "strategy", "initialCapitalUsd")):
        raise EvidenceError("sleeve cash does not reconcile to starting equity")

    history = list(history_seed)
    fee_usd = D("0")
    slippage_usd = D("0")
    rounding_usd = D("0")
    gross_turnover_usd = D("0")
    fills: list[dict[str, str | int]] = []
    daily_returns: list[Decimal] = []
    active_days = 0
    previous_equity = initial_equity
    peak_daily = initial_equity
    peak_daily_timestamp = f"{evaluation[0].day.isoformat()}T00:00:00Z"
    max_daily_dd = D("0")
    max_daily_dd_usd = D("0")
    max_daily_peak_timestamp = peak_daily_timestamp
    daily_trough_timestamp = peak_daily_timestamp
    peak_event = initial_equity
    peak_event_timestamp = peak_daily_timestamp
    max_event_dd = D("0")
    max_event_dd_usd = D("0")
    max_event_peak_timestamp = peak_event_timestamp
    event_trough_timestamp = peak_event_timestamp
    max_participation_bps = D("0")
    capacity_pass = True
    ruin = False
    nonterminal_transition_days: set[str] = set()
    organic_exit_days: set[str] = set()
    terminal_fill_count = 0
    current_underwater_days = 0
    longest_underwater_days = 0

    def observe_event(reference_price: Decimal, timestamp: str) -> None:
        nonlocal peak_event, peak_event_timestamp, max_event_dd, max_event_dd_usd
        nonlocal max_event_peak_timestamp
        nonlocal event_trough_timestamp, ruin
        equity = account_equity(sleeves, reference_price)
        if equity <= 0:
            ruin = True
        (
            peak_event,
            peak_event_timestamp,
            max_event_dd,
            max_event_dd_usd,
            max_event_peak_timestamp,
            event_trough_timestamp,
        ) = update_drawdown(
            equity,
            timestamp,
            peak=peak_event,
            peak_timestamp=peak_event_timestamp,
            maximum=max_event_dd,
            maximum_usd=max_event_dd_usd,
            maximum_peak_timestamp=max_event_peak_timestamp,
            trough_timestamp=event_trough_timestamp,
        )

    def record_capacity(event_fills: list[dict[str, str | int]], prior_history: list[Bar]) -> None:
        nonlocal max_participation_bps, capacity_pass
        if not event_fills:
            return
        total_notional = sum((D(str(fill["referenceNotionalUsd"])) for fill in event_fills), D("0"))
        reference = capacity_reference(prior_history)
        participation = total_notional / reference * D("10000")
        max_participation_bps = max(max_participation_bps, participation)
        allowed = reference * capacity_bps / D("10000")
        if total_notional > allowed:
            capacity_pass = False

    def buy(sleeve: Sleeve, reference_price: Decimal, timestamp: str) -> dict[str, str | int]:
        nonlocal fee_usd, slippage_usd, rounding_usd, gross_turnover_usd
        execution_price = reference_price * (D("1") + wedge)
        gross_quantity = floor_quantity(sleeve.cash / execution_price, order_quantum)
        quote_spent = gross_quantity * execution_price
        reference_notional = gross_quantity * reference_price
        if reference_notional < min_notional:
            raise EvidenceError("buy fell below frozen current minimum notional")
        theoretical_received = gross_quantity * (D("1") - fee)
        received = floor_quantity(theoretical_received, order_quantum)
        fee_value = gross_quantity * fee * reference_price
        rounding_value = (theoretical_received - received) * reference_price
        sleeve.cash -= quote_spent
        sleeve.base += received
        sleeve.long = True
        sleeve.entries += 1
        fee_usd += fee_value
        rounding_usd += rounding_value
        price_cost = gross_quantity * (execution_price - reference_price)
        slippage_usd += price_cost
        gross_turnover_usd += reference_notional
        return {
            "timestamp": timestamp,
            "side": "BUY",
            "horizonDays": sleeve.horizon,
            "referencePrice": dstr(reference_price),
            "executionPrice": dstr(execution_price),
            "referenceNotionalUsd": dstr(reference_notional),
            "feeUsd": dstr(fee_value),
            "adverseExecutionUsd": dstr(price_cost),
            "quantityRoundingUsd": dstr(rounding_value),
        }

    def sell(
        sleeve: Sleeve,
        reference_price: Decimal,
        timestamp: str,
        *,
        terminal: bool,
    ) -> dict[str, str | int]:
        nonlocal fee_usd, slippage_usd, gross_turnover_usd
        quantity = floor_quantity(sleeve.base, order_quantum)
        residual_dust = sleeve.base - quantity
        execution_price = reference_price * (D("1") - wedge)
        reference_notional = quantity * reference_price
        if reference_notional < min_notional:
            raise EvidenceError("sell fell below frozen current minimum notional")
        gross_quote = quantity * execution_price
        fee_value = gross_quote * fee
        sleeve.cash += gross_quote - fee_value
        sleeve.base = residual_dust
        sleeve.long = False
        sleeve.exits += 1
        fee_usd += fee_value
        price_cost = quantity * (reference_price - execution_price)
        slippage_usd += price_cost
        gross_turnover_usd += reference_notional
        return {
            "timestamp": timestamp,
            "side": "SELL",
            "horizonDays": sleeve.horizon,
            "referencePrice": dstr(reference_price),
            "executionPrice": dstr(execution_price),
            "referenceNotionalUsd": dstr(reference_notional),
            "feeUsd": dstr(fee_value),
            "adverseExecutionUsd": dstr(price_cost),
            "quantityRoundingUsd": "0",
            "residualBaseDust": dstr(residual_dust),
            "terminal": int(terminal),
        }

    for index, bar in enumerate(evaluation):
        if not history or history[-1].day != bar.day - timedelta(days=1):
            raise EvidenceError("evaluation history is not causally contiguous")
        open_timestamp = f"{bar.day.isoformat()}T00:00:00Z"
        observe_event(bar.open, open_timestamp)
        event_fills: list[dict[str, str | int]] = []
        for sleeve in sleeves:
            desired_long = signal(history, sleeve.horizon)
            if desired_long and not sleeve.long:
                event_fills.append(buy(sleeve, bar.open, open_timestamp))
                observe_event(bar.open, open_timestamp)
            elif not desired_long and sleeve.long:
                event_fills.append(sell(sleeve, bar.open, open_timestamp, terminal=False))
                observe_event(bar.open, open_timestamp)
        if event_fills:
            nonterminal_transition_days.add(bar.day.isoformat())
        if any(fill["side"] == "SELL" for fill in event_fills):
            organic_exit_days.add(bar.day.isoformat())
        fills.extend(event_fills)
        record_capacity(event_fills, history)

        if any(sleeve.long for sleeve in sleeves):
            active_days += 1
        close_timestamp = f"{bar.day.isoformat()}T23:59:59Z"
        if index == len(evaluation) - 1:
            terminal_fills: list[dict[str, str | int]] = []
            for sleeve in sleeves:
                if sleeve.long:
                    terminal_fills.append(sell(sleeve, bar.close, close_timestamp, terminal=True))
                    observe_event(bar.close, close_timestamp)
            terminal_fill_count += len(terminal_fills)
            fills.extend(terminal_fills)
            record_capacity(terminal_fills, history)

        equity = account_equity(sleeves, bar.close)
        if equity <= 0:
            ruin = True
        daily_return = equity / previous_equity - D("1")
        daily_returns.append(daily_return)
        previous_equity = equity
        (
            peak_daily,
            peak_daily_timestamp,
            max_daily_dd,
            max_daily_dd_usd,
            max_daily_peak_timestamp,
            daily_trough_timestamp,
        ) = update_drawdown(
            equity,
            close_timestamp,
            peak=peak_daily,
            peak_timestamp=peak_daily_timestamp,
            maximum=max_daily_dd,
            maximum_usd=max_daily_dd_usd,
            maximum_peak_timestamp=max_daily_peak_timestamp,
            trough_timestamp=daily_trough_timestamp,
        )
        if equity < peak_daily:
            current_underwater_days += 1
            longest_underwater_days = max(longest_underwater_days, current_underwater_days)
        else:
            current_underwater_days = 0
        observe_event(bar.close, close_timestamp)
        history.append(bar)

    final_equity = account_equity(sleeves, evaluation[-1].close)
    if any(sleeve.long or sleeve.base != 0 for sleeve in sleeves):
        raise EvidenceError("terminal liquidation did not leave the account flat")
    if sum(sleeve.entries for sleeve in sleeves) != sum(sleeve.exits for sleeve in sleeves):
        raise EvidenceError("entries and completed exits do not reconcile")

    mean_daily = decimal_mean(daily_returns)
    annualized = (D("1") + mean_daily) ** 365 - D("1")
    result: dict[str, Any] = {
        "denomination": {
            "ledgerAsset": "USDT",
            "usdReportingAssumption": "1_USDT_EQUALS_1_USD",
            "depegRiskModeled": False,
        },
        "scenario": {
            "feeBpsPerFill": dstr(fee * D("10000")),
            "adverseExecutionBpsPerFill": dstr(adverse_execution_bps),
            "capacityParticipationBps": dstr(capacity_bps),
            "fundingUsd": "0",
        },
        "sample": {
            "calendarDays": len(evaluation),
            "nonOverlappingSevenDayBlocks": len(evaluation) // 7,
            "nonOverlapping28DayBlocks": len(evaluation) // 28,
            "activeDays": active_days,
            "symbols": 1,
            "entries": sum(sleeve.entries for sleeve in sleeves),
            "completedExits": sum(sleeve.exits for sleeve in sleeves),
            "stateChangingFills": len(fills),
            "nonTerminalTransitionDays": len(nonterminal_transition_days),
            "distinctOrganicExitDays": len(organic_exit_days),
            "terminalFills": terminal_fill_count,
        },
        "economics": {
            "initialEquityUsd": dstr(initial_equity),
            "finalEquityUsd": dstr(final_equity),
            "periodNetUsdPer1k": dstr((final_equity / initial_equity - D("1")) * D("1000")),
            "meanDailyNetUsdPer1k": dstr(mean_daily * D("1000")),
            "annualizedExpectedNetUsdPer1k": dstr(annualized * D("1000")),
            "feeCostUsd": dstr(fee_usd),
            "adverseExecutionCostUsd": dstr(slippage_usd),
            "quantityRoundingCostUsd": dstr(rounding_usd),
            "totalModeledCostUsd": dstr(fee_usd + slippage_usd + rounding_usd),
            "grossTurnoverUsd": dstr(gross_turnover_usd),
            "grossTurnoverTimesInitialEquity": dstr(gross_turnover_usd / initial_equity),
            "fundingUsd": "0",
        },
        "drawdown": {
            "dailyCloseMaxPct": dstr(max_daily_dd * D("100")),
            "dailyCloseMaxUsd": dstr(max_daily_dd_usd),
            "dailyClosePeakTimestamp": max_daily_peak_timestamp,
            "dailyCloseTroughTimestamp": daily_trough_timestamp,
            "dailyCloseLongestUnderwaterDays": longest_underwater_days,
            "eventPathMaxPct": dstr(max_event_dd * D("100")),
            "eventPathMaxUsd": dstr(max_event_dd_usd),
            "eventPathPeakTimestamp": max_event_peak_timestamp,
            "eventPathTroughTimestamp": event_trough_timestamp,
            "eventPathMeaning": "EVERY_DAILY_OPEN_PRE_FILL_PLUS_FILL_EVENTS_AND_DAILY_CLOSE_MARKS",
        },
        "capacity": {
            "passed": capacity_pass,
            "maxAggregateParticipationBps": dstr(max_participation_bps),
            "screen": "PUBLIC_TRAILING_QUOTE_VOLUME_NOT_HISTORICAL_DEPTH",
        },
        "executionFilters": {
            "currentPublicSnapshotPassed": True,
            "snapshotUtc": nested(plan, "costs", "currentPublicFilterSnapshotUtc"),
            "responseSha256": nested(plan, "costs", "currentPublicFilterResponseSha256"),
            "marketLotStepSize": nested(plan, "costs", "currentMarketLotStepSize"),
            "quantityQuantum": dstr(order_quantum),
            "historicalContinuity": "UNKNOWN",
        },
        "ruin": ruin,
        "fillsSha256": sha256_bytes(canonical_bytes(fills)),
    }
    if include_uncertainty:
        uncertainty = nested(plan, "uncertainty")
        result["uncertainty"] = {
            "primary": circular_block_interval(
                daily_returns,
                block_length=int(uncertainty["primaryBlockLengthDays"]),
                replicates=int(uncertainty["replicates"]),
                seed=int(uncertainty["seed"]),
            ),
            "sevenDaySensitivity": circular_block_interval(
                daily_returns,
                block_length=int(uncertainty["sensitivityBlockLengthDays"]),
                replicates=int(uncertainty["replicates"]),
                seed=int(uncertainty["seed"]) + 1,
            ),
            "dependenceCaveat": "BLOCKS_PRESERVE_LOCAL_DEPENDENCE_BUT_ARE_NOT_INDEPENDENT_TRADES",
        }
    return result


def gate_result(
    result: dict[str, Any],
    stress: dict[str, Any],
    rules: dict[str, Any],
    *,
    validation: bool,
) -> dict[str, Any]:
    sample = result["sample"]
    economics = result["economics"]
    drawdown = result["drawdown"]
    checks: dict[str, bool] = {
        "calendarDays": sample["calendarDays"] >= int(rules["minCalendarDays"]),
        "nonOverlappingSevenDayBlocks": sample["nonOverlappingSevenDayBlocks"]
        >= int(rules["minNonOverlappingSevenDayBlocks"]),
        "nonOverlapping28DayBlocks": sample["nonOverlapping28DayBlocks"]
        >= int(rules["minNonOverlapping28DayBlocks"]),
        "nonTerminalTransitionDays": sample["nonTerminalTransitionDays"]
        >= int(rules["minNonTerminalTransitionDays"]),
        "distinctOrganicExitDays": sample["distinctOrganicExitDays"]
        >= int(rules["minDistinctOrganicExitDays"]),
        "basePeriodNetPositive": D(economics["periodNetUsdPer1k"]) > 0,
        "stressPeriodNetPositive": D(stress["economics"]["periodNetUsdPer1k"]) > 0,
        "drawdownWithinCap": D(drawdown["dailyCloseMaxPct"])
        <= D(rules["maxDailyCloseDrawdownPct"]),
        "baseCapacity": result["capacity"]["passed"] is True,
        "stressCapacity": stress["capacity"]["passed"] is True,
        "completeData": True,
        "notRuin": result["ruin"] is False and stress["ruin"] is False,
    }
    if validation:
        checks["bootstrapLowerPositive"] = (
            D(result["uncertainty"]["primary"]["lowerMeanDailyUsdPer1k"]) > 0
        )
    else:
        checks["baseMeanDailyPositive"] = D(economics["meanDailyNetUsdPer1k"]) > 0
    failed = sorted(name for name, passed in checks.items() if not passed)
    return {"passed": not failed, "checks": checks, "failedChecks": failed}


def bars_for_research(plan: dict[str, Any], bars: list[Bar]) -> tuple[list[Bar], list[Bar]]:
    start = date.fromisoformat(nested(plan, "partitions", "research", "evaluationStartUtc"))
    history = [bar for bar in bars if bar.day < start]
    evaluation = [bar for bar in bars if bar.day >= start]
    if len(history) < 140:
        raise EvidenceError("research warmup does not cover the longest imported PMA")
    return history, evaluation


def candidate_seed(bars: list[Bar]) -> list[dict[str, str]]:
    return [
        {
            "day": bar.day.isoformat(),
            "close": dstr(bar.close),
            "quoteVolume": dstr(bar.quote_volume),
        }
        for bar in bars[-140:]
    ]


def discover(plan_path: Path, data_root: Path, output: Path) -> dict[str, Any]:
    if "validation" in str(data_root).lower() or "validation" in str(output).lower():
        raise EvidenceError("discover paths must not be named as validation inputs")
    plan, plan_sha = load_plan(plan_path)
    bars, _, manifest_sha = load_partition(plan, plan_sha, "research", data_root)
    history, evaluation = bars_for_research(plan, bars)
    costs = nested(plan, "costs")
    capacity = nested(plan, "capacity")
    base = simulate(
        plan,
        history,
        evaluation,
        adverse_execution_bps=D(costs["baseAdverseExecutionBpsPerFill"]),
        capacity_bps=D(capacity["baseParticipationBpsOfReference"]),
        include_uncertainty=True,
    )
    stress = simulate(
        plan,
        history,
        evaluation,
        adverse_execution_bps=D(costs["stressAdverseExecutionBpsPerFill"]),
        capacity_bps=D(capacity["stressParticipationBpsOfReference"]),
        include_uncertainty=False,
    )
    severe = simulate(
        plan,
        history,
        evaluation,
        adverse_execution_bps=D(costs["severeAdverseExecutionBpsPerFill"]),
        capacity_bps=D(capacity["stressParticipationBpsOfReference"]),
        include_uncertainty=False,
    )
    gate = gate_result(
        base,
        stress,
        nested(plan, "stopRules", "research"),
        validation=False,
    )
    result: dict[str, Any] = {
        "schema": "S1BSpotTrendCandidateV1" if gate["passed"] else "S1BResearchStopV1",
        "candidateId": nested(plan, "strategy", "candidateId"),
        "attemptedHypotheses": 1,
        "selectionPenalty": "ZERO_ADDITIONAL_PENALTY_SINGLE_IMPORTED_UNTUNED_HYPOTHESIS",
        "planSha256": plan_sha,
        "scriptSha256": script_sha(),
        "researchManifestSha256": manifest_sha,
        "researchPeriod": {
            "startUtc": evaluation[0].day.isoformat(),
            "endUtcInclusive": evaluation[-1].day.isoformat(),
        },
        "researchGate": gate,
        "base": base,
        "stress": stress,
        "severe": severe,
        "validationSeedBars": candidate_seed(bars),
        "validationState": "NOT_ACQUIRED_NOT_OPENED",
    }
    write_exclusive(output, canonical_bytes(result))
    return result


def seed_to_bars(candidate: dict[str, Any]) -> list[Bar]:
    values = candidate.get("validationSeedBars")
    if not isinstance(values, list) or len(values) != 140:
        raise EvidenceError("candidate validation seed must contain exactly 140 research bars")
    bars: list[Bar] = []
    for value in values:
        if not isinstance(value, dict):
            raise EvidenceError("invalid validation seed bar")
        day = date.fromisoformat(str(value["day"]))
        close = D(str(value["close"]))
        quote_volume = D(str(value["quoteVolume"]))
        bars.append(Bar(day, close, close, close, close, quote_volume, 0))
    if [bar.day for bar in bars] != date_span(bars[0].day, bars[-1].day):
        raise EvidenceError("candidate validation seed is not contiguous")
    return bars


def consume_validation_grant(
    root: Path,
    *,
    candidate_sha: str,
    authorization_sha: str,
    manifest_sha: str,
    plan_sha: str,
    grant_id: str,
) -> None:
    grant_path = root / ".validation-grant.json"
    grant, _ = load_json(grant_path)
    required = {
        "schema": "S1BValidationGrantV1",
        "state": "SEALED_UNOPENED",
        "candidateSha256": candidate_sha,
        "authorizationSha256": authorization_sha,
        "manifestSha256": manifest_sha,
        "planSha256": plan_sha,
        "scriptSha256": script_sha(),
        "allowedOpenCount": 1,
        "grantId": grant_id,
    }
    if any(grant.get(key) != value for key, value in required.items()):
        raise EvidenceError("validation grant does not match the frozen candidate and inputs")
    opened_path = root / ".validation-opened.json"
    opened = {
        **required,
        "state": "CONSUMED_OPENED",
        "actualOpenCount": 1,
    }
    write_exclusive(opened_path, canonical_bytes(opened))


def preflight_validation_manifest(
    manifest: dict[str, Any],
    *,
    plan: dict[str, Any],
    plan_sha: str,
    authorization_sha: str,
) -> None:
    if manifest.get("schema") != "S1BBinanceArchiveManifestV1":
        raise EvidenceError("holdout manifest schema mismatch")
    if manifest.get("partition") != "validation":
        raise EvidenceError("holdout manifest is not the validation partition")
    if manifest.get("planSha256") != plan_sha:
        raise EvidenceError("holdout manifest plan digest mismatch")
    if manifest.get("scriptSha256") != script_sha():
        raise EvidenceError("holdout manifest script digest mismatch")
    if manifest.get("authorizationSha256") != authorization_sha:
        raise EvidenceError("holdout manifest authorization digest mismatch")
    archives = manifest.get("archives")
    if not isinstance(archives, list):
        raise EvidenceError("holdout manifest archives missing")
    actual_months = [entry.get("month") for entry in archives if isinstance(entry, dict)]
    if actual_months != partition_months(plan, "validation"):
        raise EvidenceError("holdout manifest month ledger mismatch")


def validate(
    plan_path: Path,
    candidate_path: Path,
    authorization_path: Path,
    data_root: Path,
    output: Path,
) -> dict[str, Any]:
    plan, plan_sha = load_plan(plan_path)
    if candidate_path.resolve() != expected_fixture_path(
        plan_path, plan, "expectedCandidateFixtureName"
    ):
        raise EvidenceError("candidate is not the frozen committed fixture path")
    if authorization_path.resolve() != expected_fixture_path(
        plan_path, plan, "expectedAuthorizationFixtureName"
    ):
        raise EvidenceError("authorization is not the frozen committed fixture path")
    if (
        data_root.resolve()
        != Path(nested(plan, "holdoutControl", "expectedValidationRoot")).resolve()
    ):
        raise EvidenceError("validation root differs from the external frozen ledger")
    if (
        output.resolve()
        != Path(nested(plan, "holdoutControl", "expectedValidationEvidencePath")).resolve()
    ):
        raise EvidenceError("validation evidence path differs from the external frozen ledger")
    candidate, candidate_sha = verify_candidate(
        candidate_path,
        plan=plan,
        plan_sha=plan_sha,
        require_research_pass=True,
    )
    _, authorization_sha = verify_authorization(
        authorization_path,
        candidate=candidate,
        candidate_sha=candidate_sha,
        plan=plan,
        plan_sha=plan_sha,
    )
    manifest, manifest_raw = load_json(data_root.resolve() / "manifest.json")
    preflight_validation_manifest(
        manifest,
        plan=plan,
        plan_sha=plan_sha,
        authorization_sha=authorization_sha,
    )
    manifest_sha = sha256_bytes(manifest_raw)
    reserve_output(output.resolve())
    consume_validation_grant(
        data_root.resolve(),
        candidate_sha=candidate_sha,
        authorization_sha=authorization_sha,
        manifest_sha=manifest_sha,
        plan_sha=plan_sha,
        grant_id=nested(plan, "holdoutControl", "grantId"),
    )
    evaluation, _, loaded_manifest_sha = load_partition(plan, plan_sha, "validation", data_root)
    if loaded_manifest_sha != manifest_sha:
        raise EvidenceError("validation manifest changed after grant consumption")
    seed = seed_to_bars(candidate)
    if seed[-1].day + timedelta(days=1) != evaluation[0].day:
        raise EvidenceError("research seed and validation partition are not contiguous")

    costs = nested(plan, "costs")
    capacity = nested(plan, "capacity")
    base = simulate(
        plan,
        seed,
        evaluation,
        adverse_execution_bps=D(costs["baseAdverseExecutionBpsPerFill"]),
        capacity_bps=D(capacity["baseParticipationBpsOfReference"]),
        include_uncertainty=True,
    )
    stress = simulate(
        plan,
        seed,
        evaluation,
        adverse_execution_bps=D(costs["stressAdverseExecutionBpsPerFill"]),
        capacity_bps=D(capacity["stressParticipationBpsOfReference"]),
        include_uncertainty=False,
    )
    severe = simulate(
        plan,
        seed,
        evaluation,
        adverse_execution_bps=D(costs["severeAdverseExecutionBpsPerFill"]),
        capacity_bps=D(capacity["stressParticipationBpsOfReference"]),
        include_uncertainty=False,
    )
    gate = gate_result(
        base,
        stress,
        nested(plan, "stopRules", "validation"),
        validation=True,
    )
    verdict = (
        nested(plan, "stopRules", "validation", "passLabel")
        if gate["passed"]
        else nested(plan, "stopRules", "validation", "failLabel")
    )
    result = {
        "schema": "S1BSpotTrendValidationEvidenceV1",
        "candidateId": candidate["candidateId"],
        "candidateSha256": candidate_sha,
        "authorizationSha256": authorization_sha,
        "planSha256": plan_sha,
        "scriptSha256": script_sha(),
        "validationManifestSha256": manifest_sha,
        "validationOpenCount": 1,
        "validationPeriod": {
            "startUtc": evaluation[0].day.isoformat(),
            "endUtcInclusive": evaluation[-1].day.isoformat(),
        },
        "base": base,
        "stress": stress,
        "severe": severe,
        "validationGate": gate,
        "verdict": {
            "label": verdict,
            "capitalReady": False,
            "testedCandidateProfitable": gate["passed"],
            "broaderFamilyProfitability": "UNKNOWN",
            "historicalBboDepth": "UNKNOWN",
            "permissibleNextStep": (
                "PUBLIC_DATA_FORWARD_SHADOW_ONLY" if gate["passed"] else "STOP"
            ),
        },
        "dataLimits": [
            "OFFICIAL_ARCHIVE_HAS_NO_HISTORICAL_BBO_QUEUE_OR_DEPTH",
            "SPREAD_IMPACT_AND_DELAY_ARE_PREDECLARED_ADVERSE_WEDGES_NOT_MEASURED_BOOK_REPLAY",
            "CURRENT_PUBLIC_FILTERS_ARE_NOT_HISTORICAL_FILTER_CONTINUITY_PROOF",
            "BTCUSDT_ONLY_NO_CROSS_SECTION_OR_ASSET_SURVIVORSHIP_CLAIM",
            "USDT_CASH_YIELD_ZERO_AND_STABLECOIN_RISK_UNMODELED",
            "NO_TAXES_BNB_DISCOUNT_PRIVATE_FEE_TIER_OR_ACCOUNT_CONSTRAINTS",
        ],
    }
    write_atomic(output.resolve(), canonical_bytes(result))
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    acquire_parser = subparsers.add_parser("acquire")
    acquire_parser.add_argument("--plan", required=True, type=Path)
    acquire_parser.add_argument("--partition", required=True, choices=("research", "validation"))
    acquire_parser.add_argument("--output-root", required=True, type=Path)
    acquire_parser.add_argument("--candidate", type=Path)
    acquire_parser.add_argument("--authorization", type=Path)

    discover_parser = subparsers.add_parser("discover")
    discover_parser.add_argument("--plan", required=True, type=Path)
    discover_parser.add_argument("--research-root", required=True, type=Path)
    discover_parser.add_argument("--output", required=True, type=Path)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--plan", required=True, type=Path)
    validate_parser.add_argument("--candidate", required=True, type=Path)
    validate_parser.add_argument("--authorization", required=True, type=Path)
    validate_parser.add_argument("--validation-root", required=True, type=Path)
    validate_parser.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "acquire":
            result = acquire(
                args.plan,
                args.partition,
                args.output_root,
                args.candidate,
                args.authorization,
            )
        elif args.command == "discover":
            result = discover(args.plan, args.research_root, args.output)
        else:
            result = validate(
                args.plan,
                args.candidate,
                args.authorization,
                args.validation_root,
                args.output,
            )
    except EvidenceError as error:
        print(f"S1B_FAIL_CLOSED: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
