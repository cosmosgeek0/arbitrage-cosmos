#!/usr/bin/env python3
"""Acquire and schema-audit the frozen S-1Z Binance-public source matrix."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

PACKET = Path(__file__).resolve().parent
PROTOCOL_PATH = PACKET / "protocol.v1.json"
MANIFEST_PATH = PACKET / "source-manifest.v1.json"
AUDIT_PATH = PACKET / "input-audit.v1.json"
STATE_ROOT = Path(
    os.environ.get(
        "S1Z_STATE_ROOT",
        "/private/tmp/cosmos-s1z-residual-momentum-1be1-8fad-state",
    )
)
RAW_ROOT = STATE_ROOT / "raw"
BASE_URL = "https://data.binance.vision/"
EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo"
SOURCE_START_MS = 1_735_689_600_000  # 2025-01-01T00:00:00Z
EVALUATION_END_MS = 1_750_550_400_000 + 365 * 86_400_000
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
CHECKSUM_RE = re.compile(r"^([0-9a-fA-F]{64})[ \t]+\*?([^\r\n]+)[\r\n]*$")


class AcquisitionError(RuntimeError):
    """Source acquisition or audit refusal."""


@dataclass(frozen=True, slots=True)
class ArtifactSpec:
    dataset: str
    symbol: str
    month: str
    key: str
    filename: str


@dataclass(frozen=True, slots=True)
class ArtifactReceipt:
    checksumLastModified: str | None
    checksumSha256: str
    checksumUrl: str
    dataset: str
    filename: str
    month: str
    publisherSha256: str
    symbol: str
    zipBytes: int
    zipEtag: str | None
    zipLastModified: str | None
    zipSha256: str
    zipUrl: str


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_protocol() -> dict[str, Any]:
    raw = PROTOCOL_PATH.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise AcquisitionError("protocol must be a JSON object")
    return cast(dict[str, Any], value)


def protocol_lists() -> tuple[tuple[str, ...], tuple[str, ...]]:
    protocol = load_protocol()
    universe = cast(dict[str, Any], protocol["universe"])
    data = cast(dict[str, Any], protocol["data"])
    factors = tuple(cast(list[str], universe["factorOnly"]))
    trade = tuple(cast(list[str], universe["tradeSymbols"]))
    months = tuple(cast(list[str], data["months"]))
    symbols = tuple(sorted((*factors, *trade)))
    if len(symbols) != 16 or len(set(symbols)) != 16:
        raise AcquisitionError("protocol must freeze exactly 16 unique symbols")
    if len(months) != 18 or tuple(sorted(months)) != months:
        raise AcquisitionError("protocol must freeze 18 sorted months")
    return symbols, months


def artifact_specs() -> tuple[ArtifactSpec, ...]:
    symbols, months = protocol_lists()
    specs: list[ArtifactSpec] = []
    for symbol in symbols:
        for month in months:
            for dataset in ("klines", "markPriceKlines"):
                filename = f"{symbol}-1h-{month}.zip"
                key = f"data/futures/um/monthly/{dataset}/{symbol}/1h/{filename}"
                specs.append(ArtifactSpec(dataset, symbol, month, key, filename))
            filename = f"{symbol}-fundingRate-{month}.zip"
            key = f"data/futures/um/monthly/fundingRate/{symbol}/{filename}"
            specs.append(ArtifactSpec("fundingRate", symbol, month, key, filename))
    return tuple(specs)


def atomic_write(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.part")
    with temporary.open("wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def fetch(url: str, *, attempts: int = 4) -> tuple[bytes, dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "cosmos-s1z-public-research/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                headers = {key.lower(): value for key, value in response.headers.items()}
                return response.read(), headers
        except (TimeoutError, urllib.error.URLError, OSError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(float(2**attempt))
    raise AcquisitionError(f"unable to fetch {url}: {last_error}")


def parse_checksum(raw: bytes, expected_filename: str) -> str:
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as error:
        raise AcquisitionError(f"{expected_filename}.CHECKSUM is not ASCII") from error
    match = CHECKSUM_RE.fullmatch(text)
    if match is None:
        raise AcquisitionError(f"{expected_filename}.CHECKSUM has invalid grammar")
    digest, filename = match.groups()
    if filename != expected_filename:
        raise AcquisitionError(
            f"publisher filename mismatch: expected {expected_filename}, found {filename}"
        )
    return digest.lower()


def acquire_one(spec: ArtifactSpec) -> ArtifactReceipt:
    zip_url = BASE_URL + spec.key
    checksum_url = zip_url + ".CHECKSUM"
    zip_path = RAW_ROOT / spec.key
    checksum_path = zip_path.with_name(zip_path.name + ".CHECKSUM")

    checksum_headers: dict[str, str] = {}
    if checksum_path.exists():
        checksum_raw = checksum_path.read_bytes()
    else:
        checksum_raw, checksum_headers = fetch(checksum_url)
        atomic_write(checksum_path, checksum_raw)
    publisher_sha = parse_checksum(checksum_raw, spec.filename)

    zip_headers: dict[str, str] = {}
    if zip_path.exists() and sha256_path(zip_path) == publisher_sha:
        pass
    else:
        zip_raw, zip_headers = fetch(zip_url)
        if sha256_bytes(zip_raw) != publisher_sha:
            raise AcquisitionError(f"publisher checksum mismatch for {spec.key}")
        atomic_write(zip_path, zip_raw)
    observed_sha = sha256_path(zip_path)
    if observed_sha != publisher_sha:
        raise AcquisitionError(f"local checksum mismatch for {spec.key}")

    return ArtifactReceipt(
        checksumLastModified=checksum_headers.get("last-modified"),
        checksumSha256=sha256_bytes(checksum_raw),
        checksumUrl=checksum_url,
        dataset=spec.dataset,
        filename=spec.filename,
        month=spec.month,
        publisherSha256=publisher_sha,
        symbol=spec.symbol,
        zipBytes=zip_path.stat().st_size,
        zipEtag=zip_headers.get("etag"),
        zipLastModified=zip_headers.get("last-modified"),
        zipSha256=observed_sha,
        zipUrl=zip_url,
    )


def acquire() -> None:
    if MANIFEST_PATH.exists() or AUDIT_PATH.exists():
        raise AcquisitionError("source manifest or audit already exists")
    specs = artifact_specs()
    receipts: list[ArtifactReceipt] = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(acquire_one, spec): spec for spec in specs}
        for future in as_completed(futures):
            spec = futures[future]
            try:
                receipts.append(future.result())
            except Exception as error:
                raise AcquisitionError(f"acquisition stopped at {spec.key}: {error}") from error

    exchange_raw, exchange_headers = fetch(EXCHANGE_INFO_URL)
    exchange_value = json.loads(exchange_raw)
    if not isinstance(exchange_value, dict):
        raise AcquisitionError("exchangeInfo did not return a JSON object")
    exchange_path = STATE_ROOT / "exchangeInfo.json"
    atomic_write(exchange_path, canonical_bytes(exchange_value))
    exchange_sha = sha256_path(exchange_path)

    symbols, months = protocol_lists()
    artifacts = [asdict(receipt) for receipt in sorted(receipts, key=lambda item: item.zipUrl)]
    manifest: dict[str, object] = {
        "artifactCount": len(artifacts),
        "artifacts": artifacts,
        "exchangeInfo": {
            "currentSnapshotOnly": True,
            "etag": exchange_headers.get("etag"),
            "lastModified": exchange_headers.get("last-modified"),
            "sha256": exchange_sha,
            "url": EXCHANGE_INFO_URL,
        },
        "months": list(months),
        "protocolSha256": sha256_path(PROTOCOL_PATH),
        "retrievedAt": utc_now(),
        "schemaVersion": "s1z.source-manifest.v1",
        "sourceRoot": str(STATE_ROOT),
        "symbols": list(symbols),
    }
    if len(artifacts) != 864:
        raise AcquisitionError(f"expected 864 artifacts, found {len(artifacts)}")
    atomic_write(MANIFEST_PATH, canonical_bytes(manifest))
    print(f"ACQUIRED artifacts={len(artifacts)} manifest={sha256_path(MANIFEST_PATH)}")


def audit_zip_container(path: Path, expected_member: str) -> tuple[int, int, int]:
    """Read only the ZIP central directory; never decompress a source body."""
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].is_dir():
                raise AcquisitionError(f"{path.name} must contain one regular member")
            if members[0].filename != expected_member:
                raise AcquisitionError(f"{path.name} member mismatch: {members[0].filename}")
            member = members[0]
            return member.CRC, member.compress_size, member.file_size
    except (OSError, zipfile.BadZipFile) as error:
        raise AcquisitionError(f"{path.name} is not a valid ZIP") from error


def load_manifest() -> dict[str, Any]:
    raw = MANIFEST_PATH.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict) or value.get("schemaVersion") != "s1z.source-manifest.v1":
        raise AcquisitionError("source manifest schema mismatch")
    if raw != canonical_bytes(value):
        raise AcquisitionError("source manifest is not canonical JSON")
    return cast(dict[str, Any], value)


def audit() -> None:
    if AUDIT_PATH.exists():
        raise AcquisitionError("input audit already exists")
    manifest = load_manifest()
    exchange_receipt = cast(dict[str, Any], manifest["exchangeInfo"])
    exchange_path = STATE_ROOT / "exchangeInfo.json"
    if sha256_path(exchange_path) != exchange_receipt["sha256"]:
        raise AcquisitionError("frozen exchangeInfo digest mismatch")
    exchange_value = json.loads(exchange_path.read_bytes())
    if not isinstance(exchange_value, dict) or not isinstance(exchange_value.get("symbols"), list):
        raise AcquisitionError("frozen exchangeInfo schema mismatch")
    current_symbols = {
        item["symbol"]: item
        for item in exchange_value["symbols"]
        if isinstance(item, dict) and isinstance(item.get("symbol"), str)
    }
    selected_symbols, _ = protocol_lists()
    for symbol in selected_symbols:
        item = current_symbols.get(symbol)
        if item is None:
            raise AcquisitionError(f"{symbol} missing from frozen exchangeInfo")
        required = {
            "contractType": "PERPETUAL",
            "marginAsset": "USDT",
            "quoteAsset": "USDT",
            "status": "TRADING",
        }
        for field, expected in required.items():
            if item.get(field) != expected:
                raise AcquisitionError(
                    f"{symbol} current {field} is {item.get(field)!r}, expected {expected}"
                )
        onboard = item.get("onboardDate")
        if not isinstance(onboard, int) or onboard >= SOURCE_START_MS:
            raise AcquisitionError(f"{symbol} onboardDate does not predate source window")
    artifacts = cast(list[dict[str, Any]], manifest["artifacts"])
    by_url = {cast(str, item["zipUrl"]): item for item in artifacts}
    reports: list[dict[str, object]] = []
    for spec in artifact_specs():
        url = BASE_URL + spec.key
        item = by_url.get(url)
        if item is None:
            raise AcquisitionError(f"manifest missing {url}")
        path = RAW_ROOT / spec.key
        observed_sha = sha256_path(path)
        if observed_sha != item["zipSha256"] or observed_sha != item["publisherSha256"]:
            raise AcquisitionError(f"frozen digest mismatch for {spec.filename}")
        checksum_path = path.with_name(path.name + ".CHECKSUM")
        if sha256_path(checksum_path) != item["checksumSha256"]:
            raise AcquisitionError(f"frozen sidecar mismatch for {spec.filename}")
        expected_member = spec.filename.removesuffix(".zip") + ".csv"
        crc32, compressed_bytes, uncompressed_bytes = audit_zip_container(path, expected_member)
        reports.append(
            {
                "bodyOpened": False,
                "centralDirectoryCrc32": crc32,
                "compressedBytes": compressed_bytes,
                "dataset": spec.dataset,
                "member": expected_member,
                "month": spec.month,
                "symbol": spec.symbol,
                "uncompressedBytes": uncompressed_bytes,
            }
        )

    report: dict[str, object] = {
        "artifactCount": len(reports),
        "auditedAt": utc_now(),
        "currentMetadataGate": "PASS_NOT_HISTORICAL_MEMBERSHIP_PROOF",
        "economicValuesEmitted": False,
        "sourceBodiesOpened": False,
        "rowValidation": "DEFERRED_UNTIL_EXCLUSIVE_CONSUMPTION",
        "reports": reports,
        "schemaVersion": "s1z.input-audit.v1",
        "sourceManifestSha256": sha256_path(MANIFEST_PATH),
        "status": "PASS",
    }
    if len(reports) != 864:
        raise AcquisitionError(f"expected 864 audit reports, found {len(reports)}")
    atomic_write(AUDIT_PATH, canonical_bytes(report))
    print(f"AUDIT_PASS artifacts={len(reports)} audit={sha256_path(AUDIT_PATH)}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("acquire", "audit"))
    args = parser.parse_args()
    try:
        if args.command == "acquire":
            acquire()
        else:
            audit()
    except AcquisitionError as error:
        print(f"STOP {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
