#!/usr/bin/env python3
"""Checksum-bound, outcome-blind acquisition for S-2I.

This module deliberately never imports or opens a ZIP container.  Acquisition
may read publisher sidecars and opaque ZIP bytes only.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterable


PACKET_DIR = pathlib.Path(__file__).resolve().parent
PLAN_PATH = PACKET_DIR / "source_plan.v1.json"
MANIFEST_PATH = PACKET_DIR / "source_manifest.v1.json"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
USER_AGENT = "cosmos-s2i-public-research/1.0"
CANONICAL_RAW_ROOT = pathlib.Path(
    "/private/tmp/cosmos-s2i-spot-usdm-leadlag-v1-fbce/raw"
)
EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256 = (
    "483e30db51d81872e210c18693b266789fc10f1b409035afb66b30485d12219e"
)
EXPECTED_SYMBOLS = (
    "ADAUSDT",
    "BNBUSDT",
    "BTCUSDT",
    "DOGEUSDT",
    "ETHUSDT",
    "LINKUSDT",
    "SOLUSDT",
    "XRPUSDT",
)
EXPECTED_MONTHS = (
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
)
EXPECTED_DATASETS = (
    {
        "id": "spot_kline_1h",
        "partition": "spot",
        "template": (
            "data/spot/monthly/klines/{symbol}/1h/"
            "{symbol}-1h-{month}.zip"
        ),
    },
    {
        "id": "usdm_kline_1h",
        "partition": "futures/um",
        "template": (
            "data/futures/um/monthly/klines/{symbol}/1h/"
            "{symbol}-1h-{month}.zip"
        ),
    },
    {
        "id": "usdm_mark_kline_1h",
        "partition": "futures/um",
        "template": (
            "data/futures/um/monthly/markPriceKlines/{symbol}/1h/"
            "{symbol}-1h-{month}.zip"
        ),
    },
    {
        "id": "usdm_funding_rate",
        "partition": "futures/um",
        "template": (
            "data/futures/um/monthly/fundingRate/{symbol}/"
            "{symbol}-fundingRate-{month}.zip"
        ),
    },
)
EXPECTED_POLICY = {
    "archive_member_access_during_acquisition": "FORBIDDEN",
    "checksum_sidecar_required": True,
    "holdout_body_acquisition": (
        "ALLOWED_BEFORE_OUTCOMES_BUT_MEMBER_ACCESS_FORBIDDEN"
    ),
    "missing": "FAIL_CLOSED_NO_SUBSTITUTION",
    "publisher_replacement": "MANIFEST_SHA256_PINS_RETRIEVED_BYTES",
}


class AcquisitionError(RuntimeError):
    """Fail-closed acquisition error."""


@dataclass(frozen=True)
class PlannedArtifact:
    dataset: str
    symbol: str
    month: str
    key: str
    url: str
    checksum_url: str
    local_path: str
    lifecycle_partition: str


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        + "\n"
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_plan_failures(plan: Any) -> list[str]:
    failures: list[str] = []
    if not isinstance(plan, dict):
        return ["SOURCE_PLAN_NOT_OBJECT"]
    if (
        sha256_bytes(canonical_json_bytes(plan))
        != EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256
    ):
        failures.append("SOURCE_PLAN_SEMANTIC_DIGEST")
    if plan.get("schema") != "cosmos.s2i.source-plan.v1":
        failures.append("SOURCE_PLAN_SCHEMA")
    if plan.get("archive_base") != "https://data.binance.vision":
        failures.append("SOURCE_PLAN_ARCHIVE_BASE")
    if plan.get("symbols") != list(EXPECTED_SYMBOLS):
        failures.append("SOURCE_PLAN_SYMBOLS")
    if plan.get("months") != list(EXPECTED_MONTHS):
        failures.append("SOURCE_PLAN_MONTHS")
    if plan.get("datasets") != list(EXPECTED_DATASETS):
        failures.append("SOURCE_PLAN_DATASETS")
    if plan.get("policy") != EXPECTED_POLICY:
        failures.append("SOURCE_PLAN_POLICY")
    return failures


def validate_source_plan(plan: Any) -> dict[str, Any]:
    failures = source_plan_failures(plan)
    if failures:
        raise AcquisitionError("; ".join(failures))
    return plan


def load_json(path: pathlib.Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def atomic_write(path: pathlib.Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def lifecycle_partition(month: str) -> str:
    if month == "2025-06":
        return "WARMUP"
    if month <= "2026-02":
        return "DEVELOPMENT"
    return "EMBARGO_HOLDOUT"


def require_canonical_raw_root(raw_root: pathlib.Path) -> pathlib.Path:
    requested = raw_root.resolve()
    expected = CANONICAL_RAW_ROOT.resolve()
    if requested != expected:
        raise AcquisitionError(
            f"RAW_ROOT_NOT_CANONICAL expected={expected} found={requested}"
        )
    if raw_root.exists() and raw_root.is_symlink():
        raise AcquisitionError("RAW_ROOT_SYMLINK")
    return expected


def enumerate_plan(plan: dict[str, Any]) -> list[PlannedArtifact]:
    base = str(plan["archive_base"]).rstrip("/")
    artifacts: list[PlannedArtifact] = []
    seen: set[str] = set()
    for symbol in plan["symbols"]:
        for month in plan["months"]:
            for dataset in plan["datasets"]:
                key = str(dataset["template"]).format(symbol=symbol, month=month)
                if key in seen:
                    raise AcquisitionError(f"DUPLICATE_PLAN_KEY {key}")
                seen.add(key)
                url = f"{base}/{key}"
                artifacts.append(
                    PlannedArtifact(
                        dataset=str(dataset["id"]),
                        symbol=str(symbol),
                        month=str(month),
                        key=key,
                        url=url,
                        checksum_url=f"{url}.CHECKSUM",
                        local_path=key,
                        lifecycle_partition=lifecycle_partition(str(month)),
                    )
                )
    return sorted(artifacts, key=lambda item: item.key)


def parse_checksum(sidecar: bytes, expected_filename: str) -> str:
    try:
        text = sidecar.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise AcquisitionError("CHECKSUM_NOT_UTF8") from error
    fields = text.split()
    if len(fields) != 2:
        raise AcquisitionError(f"CHECKSUM_FIELDS {expected_filename}")
    digest = fields[0].lower()
    filename = fields[1].lstrip("*")
    if not HEX64.fullmatch(digest):
        raise AcquisitionError(f"CHECKSUM_DIGEST {expected_filename}")
    if pathlib.PurePosixPath(filename).name != expected_filename:
        raise AcquisitionError(
            f"CHECKSUM_FILENAME expected={expected_filename} found={filename}"
        )
    return digest


def response_metadata(response: Any) -> dict[str, Any]:
    headers = response.headers
    return {
        "content_length_header": headers.get("Content-Length"),
        "etag": headers.get("ETag"),
        "last_modified": headers.get("Last-Modified"),
        "status": int(getattr(response, "status", 200)),
    }


def fetch(url: str, attempts: int = 4) -> tuple[bytes, dict[str, Any]]:
    last_error: BaseException | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                payload = response.read()
                metadata = response_metadata(response)
                if metadata["status"] != 200:
                    raise AcquisitionError(
                        f"HTTP_STATUS {metadata['status']} {url}"
                    )
                return payload, metadata
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            last_error = error
            if isinstance(error, urllib.error.HTTPError) and error.code == 404:
                break
            if attempt + 1 < attempts:
                time.sleep(0.5 * (2**attempt))
    raise AcquisitionError(f"FETCH_FAILED {url} {last_error}")


def validate_local_target(raw_root: pathlib.Path, relative: str) -> pathlib.Path:
    pure = pathlib.PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts:
        raise AcquisitionError(f"PATH_ESCAPE {relative}")
    candidate = raw_root.joinpath(*pure.parts)
    resolved_root = raw_root.resolve()
    resolved_parent = candidate.parent.resolve()
    if resolved_root != resolved_parent and resolved_root not in resolved_parent.parents:
        raise AcquisitionError(f"PATH_ESCAPE {relative}")
    cursor = candidate.parent
    while cursor != raw_root.parent and cursor != cursor.parent:
        if cursor.exists() and cursor.is_symlink():
            raise AcquisitionError(f"SYMLINK_COMPONENT {cursor}")
        if cursor == raw_root:
            break
        cursor = cursor.parent
    if candidate.is_symlink():
        raise AcquisitionError(f"SYMLINK_TARGET {candidate}")
    return candidate


def acquire_one(
    artifact: PlannedArtifact, raw_root: pathlib.Path
) -> dict[str, Any]:
    target = validate_local_target(raw_root, artifact.local_path)
    sidecar_target = target.with_name(f"{target.name}.CHECKSUM")
    if sidecar_target.is_symlink():
        raise AcquisitionError(f"SYMLINK_SIDECAR {sidecar_target}")

    sidecar_bytes, sidecar_http = fetch(artifact.checksum_url)
    expected_digest = parse_checksum(sidecar_bytes, target.name)
    atomic_write(sidecar_target, sidecar_bytes)

    if target.exists():
        if not target.is_file():
            raise AcquisitionError(f"NON_FILE_TARGET {target}")
        actual_digest = sha256_file(target)
        archive_http: dict[str, Any] = {
            "content_length_header": str(target.stat().st_size),
            "etag": None,
            "last_modified": None,
            "status": 200,
            "reused_verified_local": True,
        }
    else:
        archive_bytes, archive_http = fetch(artifact.url)
        actual_digest = sha256_bytes(archive_bytes)
        if actual_digest != expected_digest:
            raise AcquisitionError(
                f"CHECKSUM_MISMATCH {artifact.key} "
                f"expected={expected_digest} actual={actual_digest}"
            )
        atomic_write(target, archive_bytes)

    if actual_digest != expected_digest:
        raise AcquisitionError(
            f"CHECKSUM_MISMATCH {artifact.key} "
            f"expected={expected_digest} actual={actual_digest}"
        )

    return {
        "archive_bytes": target.stat().st_size,
        "archive_sha256": actual_digest,
        "checksum_bytes": len(sidecar_bytes),
        "checksum_sha256": sha256_bytes(sidecar_bytes),
        "checksum_url": artifact.checksum_url,
        "dataset": artifact.dataset,
        "http": archive_http,
        "key": artifact.key,
        "lifecycle_partition": artifact.lifecycle_partition,
        "local_path": artifact.local_path,
        "month": artifact.month,
        "publisher_sha256": expected_digest,
        "sidecar_http": sidecar_http,
        "symbol": artifact.symbol,
        "url": artifact.url,
    }


def acquire(raw_root: pathlib.Path, workers: int) -> dict[str, Any]:
    if workers < 1 or workers > 16:
        raise AcquisitionError("WORKERS_OUT_OF_RANGE")
    require_canonical_raw_root(raw_root)
    raw_root.mkdir(parents=True, exist_ok=True)

    plan_bytes = PLAN_PATH.read_bytes()
    plan = validate_source_plan(json.loads(plan_bytes))
    artifacts = enumerate_plan(plan)
    results: list[dict[str, Any]] = []
    progress_lock = threading.Lock()
    completed = 0

    def task(item: PlannedArtifact) -> dict[str, Any]:
        nonlocal completed
        result = acquire_one(item, raw_root)
        with progress_lock:
            completed += 1
            if completed % 25 == 0 or completed == len(artifacts):
                print(f"acquired {completed}/{len(artifacts)}", flush=True)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(task, artifact) for artifact in artifacts]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())

    results.sort(key=lambda item: item["key"])
    manifest_core = {
        "archive_base": plan["archive_base"],
        "artifact_count": len(results),
        "artifacts": results,
        "created_at_utc": utc_now(),
        "outcome_member_access": "NONE",
        "raw_root_policy": "EXTERNAL_READ_ONLY_AFTER_ACQUISITION",
        "schema": "cosmos.s2i.source-manifest.v1",
        "source_plan_semantic_sha256": (
            EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256
        ),
        "source_plan_sha256": sha256_bytes(plan_bytes),
    }
    inventory_digest = sha256_bytes(
        canonical_json_bytes(
            [
                {
                    "archive_sha256": item["archive_sha256"],
                    "checksum_sha256": item["checksum_sha256"],
                    "key": item["key"],
                }
                for item in results
            ]
        )
    )
    manifest_core["inventory_sha256"] = inventory_digest
    atomic_write(MANIFEST_PATH, canonical_json_bytes(manifest_core))
    return manifest_core


def validate_manifest_semantics(
    manifest: dict[str, Any], plan: dict[str, Any]
) -> list[str]:
    failures: list[str] = []
    plan_failures = source_plan_failures(plan)
    if plan_failures:
        return plan_failures
    if manifest.get("schema") != "cosmos.s2i.source-manifest.v1":
        failures.append("MANIFEST_SCHEMA")
    plan_bytes = PLAN_PATH.read_bytes()
    if manifest.get("source_plan_sha256") != sha256_bytes(plan_bytes):
        failures.append("SOURCE_PLAN_HASH")
    if (
        manifest.get("source_plan_semantic_sha256")
        != EXPECTED_SOURCE_PLAN_SEMANTIC_SHA256
    ):
        failures.append("SOURCE_PLAN_SEMANTIC_HASH")
    if manifest.get("archive_base") != plan.get("archive_base"):
        failures.append("ARCHIVE_BASE")
    if manifest.get("outcome_member_access") != "NONE":
        failures.append("OUTCOME_MEMBER_ACCESS")
    expected = enumerate_plan(plan)
    actual = manifest.get("artifacts")
    if not isinstance(actual, list):
        return failures + ["ARTIFACTS_NOT_LIST"]
    if manifest.get("artifact_count") != len(expected) or len(actual) != len(
        expected
    ):
        failures.append("ARTIFACT_COUNT")
        return failures
    inventory_rows: list[dict[str, str]] = []
    for index, (planned, found) in enumerate(zip(expected, actual)):
        if not isinstance(found, dict):
            failures.append(f"ARTIFACT_NOT_OBJECT {index}")
            continue
        exact = {
            "checksum_url": planned.checksum_url,
            "dataset": planned.dataset,
            "key": planned.key,
            "lifecycle_partition": planned.lifecycle_partition,
            "local_path": planned.local_path,
            "month": planned.month,
            "symbol": planned.symbol,
            "url": planned.url,
        }
        for field, value in exact.items():
            if found.get(field) != value:
                failures.append(f"ARTIFACT_FIELD {index} {field}")
        archive_digest = found.get("archive_sha256")
        publisher_digest = found.get("publisher_sha256")
        checksum_digest = found.get("checksum_sha256")
        if (
            not isinstance(archive_digest, str)
            or not HEX64.fullmatch(archive_digest)
            or archive_digest != publisher_digest
        ):
            failures.append(f"ARCHIVE_PUBLISHER_DIGEST {index}")
        if not isinstance(checksum_digest, str) or not HEX64.fullmatch(
            checksum_digest
        ):
            failures.append(f"SIDECAR_DIGEST {index}")
        if not isinstance(found.get("archive_bytes"), int) or found[
            "archive_bytes"
        ] <= 0:
            failures.append(f"ARCHIVE_BYTES {index}")
        if not isinstance(found.get("checksum_bytes"), int) or found[
            "checksum_bytes"
        ] <= 0:
            failures.append(f"CHECKSUM_BYTES {index}")
        if (
            isinstance(archive_digest, str)
            and isinstance(checksum_digest, str)
        ):
            inventory_rows.append(
                {
                    "archive_sha256": archive_digest,
                    "checksum_sha256": checksum_digest,
                    "key": str(found.get("key")),
                }
            )
    expected_inventory = sha256_bytes(canonical_json_bytes(inventory_rows))
    if manifest.get("inventory_sha256") != expected_inventory:
        failures.append("INVENTORY_DIGEST")
    return failures


def verify_manifest_files(
    manifest: dict[str, Any], raw_root: pathlib.Path
) -> list[str]:
    failures: list[str] = []
    for item in manifest["artifacts"]:
        target = validate_local_target(raw_root, str(item["local_path"]))
        sidecar = target.with_name(f"{target.name}.CHECKSUM")
        if not target.is_file() or target.is_symlink():
            failures.append(f"ARCHIVE_MISSING {item['key']}")
            continue
        if not sidecar.is_file() or sidecar.is_symlink():
            failures.append(f"SIDECAR_MISSING {item['key']}")
            continue
        if sha256_file(target) != item["archive_sha256"]:
            failures.append(f"ARCHIVE_HASH {item['key']}")
        if sha256_file(sidecar) != item["checksum_sha256"]:
            failures.append(f"SIDECAR_HASH {item['key']}")
        try:
            publisher = parse_checksum(sidecar.read_bytes(), target.name)
        except AcquisitionError as error:
            failures.append(f"SIDECAR_PARSE {item['key']} {error}")
            continue
        if publisher != item["publisher_sha256"]:
            failures.append(f"PUBLISHER_HASH {item['key']}")
    return failures


def command_plan() -> int:
    plan = validate_source_plan(load_json(PLAN_PATH))
    artifacts = enumerate_plan(plan)
    counts: dict[str, int] = {}
    for item in artifacts:
        counts[item.lifecycle_partition] = (
            counts.get(item.lifecycle_partition, 0) + 1
        )
    print(
        json.dumps(
            {"artifact_count": len(artifacts), "partitions": counts},
            sort_keys=True,
        )
    )
    return 0


def command_acquire(raw_root: pathlib.Path, workers: int) -> int:
    manifest = acquire(raw_root, workers)
    failures = validate_manifest_semantics(
        manifest, load_json(PLAN_PATH)
    ) + verify_manifest_files(manifest, raw_root)
    if failures:
        raise AcquisitionError("; ".join(failures[:20]))
    print(
        json.dumps(
            {
                "artifact_count": manifest["artifact_count"],
                "inventory_sha256": manifest["inventory_sha256"],
                "manifest": str(MANIFEST_PATH),
                "status": "ACQUISITION_PASS_NO_OUTCOME_MEMBER_ACCESS",
            },
            sort_keys=True,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("plan")
    acquire_parser = subparsers.add_parser("acquire")
    acquire_parser.add_argument("--raw-root", type=pathlib.Path, required=True)
    acquire_parser.add_argument("--workers", type=int, default=8)
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    if arguments.command == "plan":
        return command_plan()
    if arguments.command == "acquire":
        return command_acquire(arguments.raw_root, arguments.workers)
    raise AcquisitionError(f"UNKNOWN_COMMAND {arguments.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AcquisitionError as error:
        print(f"S2I_ACQUISITION_STOP {error}")
        raise SystemExit(2)
